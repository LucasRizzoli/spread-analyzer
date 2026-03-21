/**
 * Serviço de sincronização — processa as planilhas da Moody's e ANBIMA Data
 * e persiste os dados cruzados no banco de dados.
 *
 * Fluxo:
 * 1. Parsear planilha Moody's → ratings por emissão específica
 * 2. Parsear planilha ANBIMA Data → ativos com Z-spread (data mais recente)
 * 3. Enriquecer cada código CETIP via SND (debentures.com.br) → número de emissão real
 * 4. Cruzar por emissor normalizado + número de emissão exato
 * 5. Persistir apenas os ativos com match confirmado de emissão
 */
import { getDb } from "../db";
import {
  moodysRatings,
  anbimaAssets,
  spreadAnalysis,
  syncLog,
} from "../../drizzle/schema";
import {
  parseMoodysXlsx,
  parseAnbimaDataXlsx,
  normalizeEmissor,
  MoodysRatingRow,
  AnbimaAsset,
} from "./moodysScraperService";
import { enrichBatch, clearSndCache, SndRecord } from "./sndEnrichmentService";
import { eq } from "drizzle-orm";

export interface SyncProgress {
  step: string;
  done: number;
  total: number;
}

export type SyncStatus = "idle" | "running" | "success" | "error";

// Estado global de sincronização (in-memory)
let currentSyncStatus: SyncStatus = "idle";
let currentSyncProgress: SyncProgress = { step: "", done: 0, total: 0 };
let lastSyncAt: Date | null = null;
let lastSyncError: string | null = null;

export function getSyncState() {
  return {
    status: currentSyncStatus,
    progress: currentSyncProgress,
    lastSyncAt,
    lastSyncError,
  };
}

// ── Tipos de resultado do cruzamento ─────────────────────────────────────────

export type TipoMatch = "emissao";

export interface SpreadResult {
  codigoCetip: string;
  emissorNome: string;
  tipoRemuneracao: string;
  remuneracao: string;
  dataVencimento: string;
  taxaIndicativa: number | null;
  duration: number | null;
  referenciaNtnb: string | null;
  zSpread: number;
  spreadIncentivadoSemGrossUp: number | null;
  lei12431: boolean;
  dataReferencia: string;
  isin: string | null;
  numeroEmissao: number | null;
  // Campos do cruzamento com Moody's
  rating: string;
  setor: string | null;
  tipoMatch: TipoMatch;
}

// ── Lógica de cruzamento ──────────────────────────────────────────────────────

/**
 * Calcula score de similaridade entre dois strings normalizados (0-1)
 * Baseado em bigrams (Dice coefficient)
 */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = (str: string): Map<string, number> => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);

  let intersection = 0;
  for (const entry of Array.from(bigramsA.entries())) {
    const countB = bigramsB.get(entry[0]) || 0;
    intersection += Math.min(entry[1], countB);
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/**
 * Realiza o cruzamento emissão-a-emissão:
 * Para cada ativo ANBIMA que foi enriquecido com número de emissão via SND,
 * busca na Moody's o rating de emissão com mesmo emissor (fuzzy ≥ 0.65) e
 * mesmo número de emissão.
 *
 * Retorna apenas os ativos com match confirmado — sem fallback para rating de emissor.
 */
function crossByEmissao(
  assets: AnbimaAsset[],
  ratings: MoodysRatingRow[],
  sndMap: Map<string, SndRecord>
): SpreadResult[] {
  // Pré-processar ratings: apenas emissões específicas (isEmissao = true)
  const ratingsEmissao = ratings
    .filter((r) => r.isEmissao && r.numeroEmissao !== null)
    .map((r) => ({
      ...r,
      emissorNorm: normalizeEmissor(r.emissor),
      emissaoNum: parseInt(r.numeroEmissao!, 10),
    }))
    .filter((r) => !isNaN(r.emissaoNum));

  const results: SpreadResult[] = [];

  for (const asset of assets) {
    const sndRecord = sndMap.get(asset.codigoAtivo.toUpperCase());

    // Sem enriquecimento SND → não é possível identificar a emissão
    if (!sndRecord) continue;

    const emissorNormAsset = normalizeEmissor(asset.emissor);
    const numeroEmissaoAsset = sndRecord.numeroEmissao;

    // Buscar na Moody's: mesmo número de emissão + emissor similar
    let bestRating: string | null = null;
    let bestSetor: string | null = null;
    let bestScore = 0;

    for (const r of ratingsEmissao) {
      // Filtro primário: número de emissão deve ser idêntico
      if (r.emissaoNum !== numeroEmissaoAsset) continue;

      // Filtro secundário: nome do emissor deve ser similar (Dice ≥ 0.65)
      const score = diceCoefficient(emissorNormAsset, r.emissorNorm);
      if (score >= 0.65 && score > bestScore) {
        bestScore = score;
        bestRating = r.rating;
        bestSetor = r.setor;
      }
    }

    // Sem match de emissão → ignorar este ativo
    if (!bestRating) continue;

    results.push({
      codigoCetip: asset.codigoAtivo,
      emissorNome: asset.emissor,
      tipoRemuneracao: asset.tipoRemuneracao,
      remuneracao: asset.remuneracao,
      dataVencimento: asset.dataVencimento,
      taxaIndicativa: asset.taxaIndicativa,
      duration: asset.duration,
      referenciaNtnb: asset.referenciaNtnb,
      zSpread: asset.zSpread,
      spreadIncentivadoSemGrossUp: asset.spreadIncentivadoSemGrossUp,
      lei12431: asset.lei12431,
      dataReferencia: asset.dataReferencia,
      isin: sndRecord.isin || null,
      numeroEmissao: numeroEmissaoAsset,
      rating: bestRating,
      setor: bestSetor,
      tipoMatch: "emissao",
    });
  }

  return results;
}

// ── Função principal de sincronização ────────────────────────────────────────

export async function runFullSync(
  moodysBuffer: Buffer,
  anbimaBuffer: Buffer,
  onProgress?: (p: SyncProgress) => void
): Promise<{ total: number; comRating: number; semMatch: number }> {
  if (currentSyncStatus === "running") {
    throw new Error("Sincronização já em andamento");
  }

  currentSyncStatus = "running";
  lastSyncError = null;
  clearSndCache();

  let logId: number | null = null;

  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");

  const report = (step: string, done = 0, total = 0) => {
    currentSyncProgress = { step, done, total };
    onProgress?.({ step, done, total });
    console.log(`[Sync] ${step} (${done}/${total})`);
  };

  try {
    // Registrar início no log
    const [logResult] = await db.insert(syncLog).values({
      tipo: "full_sync",
      status: "running",
      mensagem: "Sincronização iniciada",
    });
    logId = (logResult as any).insertId;

    // ── 1. Parsear planilha da Moody's ────────────────────────────────────────
    report("Processando planilha da Moody's...", 0, 1);
    const moodysData = parseMoodysXlsx(moodysBuffer);
    if (moodysData.length === 0) {
      throw new Error(
        "Nenhum rating encontrado na planilha da Moody's. Verifique se o arquivo está correto."
      );
    }
    const emissaoCount = moodysData.filter((r) => r.isEmissao).length;
    report(
      `${moodysData.length} ratings da Moody's processados (${emissaoCount} de emissão)`,
      1,
      1
    );

    // ── 2. Parsear planilha ANBIMA Data ───────────────────────────────────────
    report("Processando planilha ANBIMA Data...", 0, 1);
    const anbimaData = parseAnbimaDataXlsx(anbimaBuffer);
    if (anbimaData.length === 0) {
      throw new Error(
        "Nenhum ativo encontrado na planilha ANBIMA Data. Verifique se o arquivo está correto."
      );
    }
    report(`${anbimaData.length} ativos ANBIMA processados`, 1, 1);

    // ── 3. Enriquecer via SND ─────────────────────────────────────────────────
    report(
      `Consultando SND para ${anbimaData.length} ativos...`,
      0,
      anbimaData.length
    );
    const codigos = anbimaData.map((a) => a.codigoAtivo);
    const sndMap = await enrichBatch(codigos, 8, (done, total) => {
      report(`Consultando SND (${done}/${total})...`, done, total);
    });
    const enriquecidos = sndMap.size;
    report(
      `${enriquecidos} de ${anbimaData.length} ativos enriquecidos via SND`,
      enriquecidos,
      anbimaData.length
    );

    // ── 4. Persistir ratings da Moody's ──────────────────────────────────────
    report("Salvando ratings no banco...", 0, 1);
    await db.delete(moodysRatings);
    const BATCH = 200;
    for (let i = 0; i < moodysData.length; i += BATCH) {
      const batch = moodysData.slice(i, i + BATCH);
      await db.insert(moodysRatings).values(
        batch.map((r) => ({
          setor: r.setor || null,
          emissor: r.emissor,
          produto: r.produto || null,
          instrumento: r.instrumento || null,
          objeto: r.objeto || null,
          rating: r.rating,
          perspectiva: r.perspectiva || null,
          dataAtualizacao: r.dataAtualizacao || null,
          numeroEmissao: r.numeroEmissao || null,
        }))
      );
    }
    report(`${moodysData.length} ratings salvos`, 1, 1);

    // ── 5. Persistir ativos ANBIMA ────────────────────────────────────────────
    report("Salvando ativos ANBIMA no banco...", 0, 1);
    await db.delete(anbimaAssets);
    for (let i = 0; i < anbimaData.length; i += BATCH) {
      const batch = anbimaData.slice(i, i + BATCH);
      await db.insert(anbimaAssets).values(
        batch.map((a) => {
          const snd = sndMap.get(a.codigoAtivo.toUpperCase());
          return {
            codigoCetip: a.codigoAtivo,
            isin: snd?.isin || null,
            tipo: "DEB" as const,
            emissorNome: a.emissor,
            emissorCnpj: null,
            setor: null,
            numeroEmissao: snd ? String(snd.numeroEmissao) : null,
            numeroSerie: snd?.serie || null,
            dataEmissao: null,
            dataVencimento: a.dataVencimento || null,
            remuneracao: a.remuneracao || null,
            indexador: a.tipoRemuneracao || null,
            incentivado: a.lei12431,
            taxaIndicativa:
              a.taxaIndicativa !== null ? String(a.taxaIndicativa) : null,
            taxaCompra: null,
            taxaVenda: null,
            durationDias:
              a.duration !== null ? Math.round(a.duration) : null,
            durationAnos:
              a.duration !== null
                ? String((a.duration / 252).toFixed(4))
                : null,
            dataReferencia: a.dataReferencia || null,
          };
        })
      );
    }
    report(`${anbimaData.length} ativos ANBIMA salvos`, 1, 1);

    // ── 6. Cruzamento emissão-a-emissão ──────────────────────────────────────
    report("Cruzando emissões com ratings...", 0, anbimaData.length);
    const spreadResults = crossByEmissao(anbimaData, moodysData, sndMap);
    report(
      `${spreadResults.length} emissões com rating confirmado`,
      spreadResults.length,
      spreadResults.length
    );

    // ── 7. Persistir resultados de spread ─────────────────────────────────────
    report("Salvando análise de spread...", 0, 1);
    await db.delete(spreadAnalysis);
    for (let i = 0; i < spreadResults.length; i += BATCH) {
      const batch = spreadResults.slice(i, i + BATCH);
      await db.insert(spreadAnalysis).values(
        batch.map((s) => ({
          codigoCetip: s.codigoCetip,
          isin: s.isin,
          tipo: "DEB" as const,
          emissorNome: s.emissorNome || null,
          setor: s.setor || null,
          indexador: s.tipoRemuneracao || null,
          incentivado: s.lei12431,
          rating: s.rating,
          tipoMatch: s.tipoMatch,
          moodysRatingId: null,
          taxaIndicativa:
            s.taxaIndicativa !== null ? String(s.taxaIndicativa) : null,
          durationAnos:
            s.duration !== null
              ? String((s.duration / 252).toFixed(4))
              : null,
          dataReferencia: s.dataReferencia || null,
          ntnbReferencia: s.referenciaNtnb || null,
          ntnbTaxa: null,
          ntnbDuration: null,
          zspread: String(s.zSpread),
        }))
      );
    }

    const comRating = spreadResults.length;
    const semMatch = anbimaData.length - comRating;

    report(
      "Sincronização concluída!",
      spreadResults.length,
      spreadResults.length
    );

    // Atualizar log
    if (logId) {
      await db
        .update(syncLog)
        .set({
          status: "success",
          mensagem: `Concluído: ${moodysData.length} ratings Moody's, ${anbimaData.length} ativos ANBIMA, ${enriquecidos} enriquecidos via SND, ${comRating} com match de emissão`,
          totalProcessados: spreadResults.length,
          finalizadoEm: new Date(),
        })
        .where(eq(syncLog.id, logId));
    }

    currentSyncStatus = "success";
    lastSyncAt = new Date();

    return { total: spreadResults.length, comRating, semMatch };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Sync] Erro na sincronização:", msg);
    currentSyncStatus = "error";
    lastSyncError = msg;

    if (logId) {
      const db2 = await getDb();
      if (db2) {
        await db2
          .update(syncLog)
          .set({ status: "error", mensagem: msg, finalizadoEm: new Date() })
          .where(eq(syncLog.id, logId));
      }
    }

    throw error;
  }
}
