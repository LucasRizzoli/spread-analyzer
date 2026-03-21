/**
 * Serviço de sincronização — processa as planilhas da Moody's e ANBIMA Data
 * e persiste os dados cruzados no banco de dados.
 *
 * Fluxo:
 * 1. Parsear planilha Moody's → ratings por emissão
 * 2. Parsear planilha ANBIMA Data → ativos com Z-spread já calculado (data mais recente)
 * 3. Cruzar por fuzzy matching (emissor)
 * 4. Persistir resultados no banco
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

export type TipoMatch = "emissao" | "emissor" | "sem_match";

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
  // Campos do cruzamento com Moody's
  rating: string | null;
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
 * Realiza o cruzamento entre os ativos da ANBIMA e os ratings da Moody's
 * Estratégia:
 * 1. Match por emissor (fuzzy) — usa o melhor rating disponível para o emissor
 * 2. Prefere ratings de emissão específica quando disponíveis
 */
function crossRatings(
  assets: AnbimaAsset[],
  ratings: MoodysRatingRow[]
): SpreadResult[] {
  // Pré-processar ratings: normalizar nomes para matching
  const ratingsNormalized = ratings.map((r) => ({
    ...r,
    emissorNorm: normalizeEmissor(r.emissor),
  }));

  // Separar ratings de emissão e de emissor (corporativo)
  const ratingsEmissao = ratingsNormalized.filter((r) => r.isEmissao);
  const ratingsEmissor = ratingsNormalized.filter((r) => !r.isEmissao);

  const results: SpreadResult[] = [];

  for (const asset of assets) {
    const emissorNormAsset = normalizeEmissor(asset.emissor);

    let bestRating: string | null = null;
    let bestSetor: string | null = null;
    let tipoMatch: TipoMatch = "sem_match";
    let bestScore = 0;

    // ── Etapa 1: tentar match por rating de emissão específica ───────────────
    for (const r of ratingsEmissao) {
      const score = diceCoefficient(emissorNormAsset, r.emissorNorm);
      if (score > bestScore && score >= 0.65) {
        bestScore = score;
        bestRating = r.rating;
        bestSetor = r.setor;
        tipoMatch = "emissor"; // match por emissor (rating de emissão)
      }
    }

    // ── Etapa 2: fallback para rating corporativo do emissor ─────────────────
    if (tipoMatch === "sem_match" || bestScore < 0.65) {
      for (const r of ratingsEmissor) {
        const score = diceCoefficient(emissorNormAsset, r.emissorNorm);
        if (score > bestScore && score >= 0.65) {
          bestScore = score;
          bestRating = r.rating;
          bestSetor = r.setor;
          tipoMatch = "emissor";
        }
      }
    }

    // Se score muito baixo, marcar como sem match
    if (bestScore < 0.65) {
      bestRating = null;
      bestSetor = null;
      tipoMatch = "sem_match";
    }

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
      rating: bestRating,
      setor: bestSetor,
      tipoMatch,
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
    report(`${moodysData.length} ratings da Moody's processados`, 1, 1);

    // ── 2. Parsear planilha ANBIMA Data ───────────────────────────────────────
    report("Processando planilha ANBIMA Data...", 0, 1);
    const anbimaData = parseAnbimaDataXlsx(anbimaBuffer);
    if (anbimaData.length === 0) {
      throw new Error(
        "Nenhum ativo encontrado na planilha ANBIMA Data. Verifique se o arquivo está correto."
      );
    }
    report(`${anbimaData.length} ativos ANBIMA processados`, 1, 1);

    // ── 3. Persistir ratings da Moody's ──────────────────────────────────────
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

    // ── 4. Persistir ativos ANBIMA ────────────────────────────────────────────
    report("Salvando ativos ANBIMA no banco...", 0, 1);
    await db.delete(anbimaAssets);
    for (let i = 0; i < anbimaData.length; i += BATCH) {
      const batch = anbimaData.slice(i, i + BATCH);
      await db.insert(anbimaAssets).values(
        batch.map((a) => ({
          codigoCetip: a.codigoAtivo,
          isin: null,
          tipo: "DEB" as const,
          emissorNome: a.emissor,
          emissorCnpj: null,
          setor: null,
          numeroEmissao: null,
          numeroSerie: null,
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
        }))
      );
    }
    report(`${anbimaData.length} ativos ANBIMA salvos`, 1, 1);

    // ── 5. Cruzamento e cálculo de Z-spread ──────────────────────────────────
    report("Cruzando ratings com ativos...", 0, anbimaData.length);
    const spreadResults = crossRatings(anbimaData, moodysData);
    report(
      `${spreadResults.length} cruzamentos realizados`,
      spreadResults.length,
      spreadResults.length
    );

    // ── 6. Persistir resultados de spread ─────────────────────────────────────
    report("Salvando análise de spread...", 0, 1);
    await db.delete(spreadAnalysis);
    for (let i = 0; i < spreadResults.length; i += BATCH) {
      const batch = spreadResults.slice(i, i + BATCH);
      await db.insert(spreadAnalysis).values(
        batch.map((s) => ({
          codigoCetip: s.codigoCetip,
          isin: null,
          tipo: "DEB" as const,
          emissorNome: s.emissorNome || null,
          setor: s.setor || null,
          indexador: s.tipoRemuneracao || null,
          incentivado: s.lei12431,
          rating: s.rating || null,
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

    const comRating = spreadResults.filter(
      (s) => s.tipoMatch !== "sem_match"
    ).length;
    const semMatch = spreadResults.filter(
      (s) => s.tipoMatch === "sem_match"
    ).length;

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
          mensagem: `Concluído: ${moodysData.length} ratings, ${anbimaData.length} ativos, ${comRating} com rating, ${semMatch} sem match`,
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
