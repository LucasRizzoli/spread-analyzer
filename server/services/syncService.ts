/**
 * Serviço de sincronização — processa as planilhas da Moody's e ANBIMA Data
 * e persiste os dados cruzados no banco de dados.
 *
 * Fluxo:
 * 1. Parsear planilha Moody's → ratings por emissão específica
 * 2. Parsear planilha ANBIMA Data → ativos com Z-spread (data mais recente)
 * 3. Enriquecer cada código CETIP via ANBIMA Data (data.anbima.com.br) → número de emissão real
 * 4. Cruzar por emissor normalizado (Dice ≥ 0.90) + número de emissão exato
 * 5. Marcar outliers: por rating, quando ≥5 emissões, remover 10% superior e 10% inferior de Z-spread
 * 6. Persistir resultados com scoreMatch, isOutlier e campos de rastreabilidade
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
import { enrichBatch, clearAnbimaDataCache, AnbimaDataRecord as SndRecord } from "./anbimaDataService";
import { eq, sql } from "drizzle-orm";

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
  scoreMatch: number;
  // Rastreabilidade para relatório de qualidade
  emissorMoodys: string;
  numeroEmissaoMoodys: string;
  instrumentoMoodys: string;
  // Marcador de outlier (preenchido após o matching)
  isOutlier: boolean;
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
 * Para cada ativo ANBIMA que foi enriquecido com número de emissão via ANBIMA Data,
 * busca na Moody's o rating de emissão com mesmo emissor (fuzzy ≥ 0.90) e
 * mesmo número de emissão.
 *
 * Retorna apenas os ativos com match confirmado — sem fallback para rating de emissor.
 * Inclui scoreMatch e campos de rastreabilidade para o relatório de qualidade.
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
    let bestEmissorMoodys = "";
    let bestNumeroEmissaoMoodys = "";
    let bestInstrumentoMoodys = "";

    for (const r of ratingsEmissao) {
      // Filtro primário: número de emissão deve ser idêntico
      if (r.emissaoNum !== numeroEmissaoAsset) continue;

      // Filtro secundário: nome do emissor deve ser similar (Dice ≥ 0.90)
      const score = diceCoefficient(emissorNormAsset, r.emissorNorm);
      if (score >= 0.90 && score > bestScore) {
        bestScore = score;
        bestRating = r.rating;
        bestSetor = r.setor;
        bestEmissorMoodys = r.emissor;
        bestNumeroEmissaoMoodys = r.numeroEmissao || "";
        bestInstrumentoMoodys = r.instrumento || "";
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
      scoreMatch: bestScore,
      emissorMoodys: bestEmissorMoodys,
      numeroEmissaoMoodys: bestNumeroEmissaoMoodys,
      instrumentoMoodys: bestInstrumentoMoodys,
      isOutlier: false,
    });
  }

  return results;
}

/**
 * Marca outliers por rating+universo usando ±3 desvios padrão da média:
 * Para cada combinação de (rating, universo) com ≥5 emissões, calcula média e desvio
 * padrão do Z-spread. Pontos a 3 ou mais desvios padrão da média são marcados como
 * isOutlier = true.
 *
 * O agrupamento por universo (IPCA vs DI) é essencial: misturar os dois universos
 * faria com que ativos DI+ (spreads menores em bps) fossem penalizados ao serem
 * comparados com ativos IPCA+ do mesmo rating.
 *
 * Os outliers são mantidos no banco para rastreabilidade, mas marcados
 * para serem excluídos do gráfico de dispersão por padrão.
 */
function markOutliers(results: SpreadResult[]): {
  marked: SpreadResult[];
  outlierCount: number;
  ratingStats: Record<string, { total: number; outliers: number; cutLow: number; cutHigh: number; mean: number; stdDev: number }>;
} {
  // Determinar universo de cada ativo (IPCA ou DI) para agrupar separadamente
  const getUniverso = (tipoRemuneracao: string): string => {
    const t = tipoRemuneracao.toUpperCase();
    if (t.includes("IPCA")) return "IPCA";
    if (t.includes("DI")) return "DI";
    return "OUTRO";
  };

  // Agrupar por rating + universo (ex: "AA-.br|IPCA", "AA-.br|DI")
  const byRating = new Map<string, SpreadResult[]>();
  for (const r of results) {
    const universo = getUniverso(r.tipoRemuneracao);
    const key = `${r.rating}|${universo}`;
    if (!byRating.has(key)) byRating.set(key, []);
    byRating.get(key)!.push(r);
  }

  const ratingStats: Record<string, { total: number; outliers: number; cutLow: number; cutHigh: number; mean: number; stdDev: number }> = {};
  let outlierCount = 0;

  for (const [rating, group] of Array.from(byRating.entries())) {
    // Apenas grupos com \u22655 emiss\u00f5es recebem tratamento de outlier
    if (group.length < 5) {
      ratingStats[rating] = { total: group.length, outliers: 0, cutLow: -Infinity, cutHigh: Infinity, mean: 0, stdDev: 0 };
      continue;
    }

    const n = group.length;
    const spreads = group.map((r) => r.zSpread);

    // Calcular m\u00e9dia
    const mean = spreads.reduce((s, v) => s + v, 0) / n;

    // Calcular desvio padr\u00e3o (popula\u00e7\u00e3o)
    const variance = spreads.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Limites: m\u00e9dia \u00b1 3 * desvio padr\u00e3o
    const cutLow = mean - 3 * stdDev;
    const cutHigh = mean + 3 * stdDev;

    let outliers = 0;
    for (const item of group) {
      if (item.zSpread < cutLow || item.zSpread > cutHigh) {
        item.isOutlier = true;
        outliers++;
        outlierCount++;
      }
    }

    ratingStats[rating] = { total: n, outliers, cutLow, cutHigh, mean, stdDev };
  }

  return { marked: results, outlierCount, ratingStats };
}

// ── Função principal de sincronização ────────────────────────────────────────

export async function runFullSync(
  moodysBuffer: Buffer,
  anbimaBuffer: Buffer,
  onProgress?: (p: SyncProgress) => void
): Promise<{ total: number; comRating: number; semMatch: number; outliers: number }> {
  if (currentSyncStatus === "running") {
    throw new Error("Sincronização já em andamento");
  }

  currentSyncStatus = "running";
  lastSyncError = null;
  clearAnbimaDataCache();

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

    // ── 3. Enriquecer via ANBIMA Data ─────────────────────────────────────────────────
    report(
      `Consultando ANBIMA Data para ${anbimaData.length} ativos...`,
      0,
      anbimaData.length
    );
    const codigos = anbimaData.map((a) => a.codigoAtivo);
    // ANBIMA Data usa Playwright (browser headless) — batchSize 3 para não sobrecarregar
    const sndMap = await enrichBatch(codigos, 3, (done, total) => {
      report(`Consultando ANBIMA Data (${done}/${total})...`, done, total);
    });
    const enriquecidos = sndMap.size;
    report(
      `${enriquecidos} de ${anbimaData.length} ativos enriquecidos via ANBIMA Data`,
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
            // Preferir dados do ANBIMA Data quando disponíveis (mais ricos que a planilha)
            emissorNome: snd?.empresa || a.emissor,
            emissorCnpj: snd?.cnpj || null,
            setor: snd?.setor || null,
            numeroEmissao: snd ? String(snd.numeroEmissao) : null,
            numeroSerie: snd?.serie || null,
            dataEmissao: snd?.dataEmissao || null,
            dataVencimento: snd?.dataVencimento || a.dataVencimento || null,
            remuneracao: snd?.remuneracao || a.remuneracao || null,
            indexador: a.tipoRemuneracao || null,
            incentivado: snd?.lei12431 ?? a.lei12431,
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

    // ── 7. Marcar outliers por rating ─────────────────────────────────────────
    report("Identificando outliers por rating...", 0, 1);
    const { marked, outlierCount, ratingStats } = markOutliers(spreadResults);
    console.log("[Sync] Estatísticas de outliers por rating:");
    for (const [rating, stats] of Object.entries(ratingStats)) {
      if (stats.outliers > 0) {
        console.log(
          `  ${rating}: ${stats.total} emissões, ${stats.outliers} outliers (corte: ${(stats.cutLow * 10000).toFixed(0)}bps–${(stats.cutHigh * 10000).toFixed(0)}bps)`
        );
      }
    }
    report(`${outlierCount} outliers identificados`, 1, 1);

    // ── 8. Persistir resultados de spread ─────────────────────────────────────
    report("Salvando análise de spread...", 0, 1);

    // Normalizar dataReferencia para YYYY-MM-DD (de DD/MM/YYYY)
    const normalizeDate = (d: string | null | undefined): string | null => {
      if (!d) return null;
      // Se já está no formato YYYY-MM-DD, retornar como está
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      // Converter DD/MM/YYYY → YYYY-MM-DD
      const parts = d.split("/");
      if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
      return d;
    };

    for (let i = 0; i < marked.length; i += BATCH) {
      const batch = marked.slice(i, i + BATCH);
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
          dataReferencia: normalizeDate(s.dataReferencia),
          ntnbReferencia: s.referenciaNtnb || null,
          ntnbTaxa: null,
          ntnbDuration: null,
          dataVencimento: normalizeDate(s.dataVencimento),
          zspread: String(s.zSpread),
          spreadIncentivadoSemGrossUp: s.spreadIncentivadoSemGrossUp !== null ? String(s.spreadIncentivadoSemGrossUp) : null,
          scoreMatch: String(s.scoreMatch.toFixed(4)),
          isOutlier: s.isOutlier,
          emissorMoodys: s.emissorMoodys || null,
          numeroEmissaoSnd: s.numeroEmissao,
          numeroEmissaoMoodys: s.numeroEmissaoMoodys || null,
          instrumentoMoodys: s.instrumentoMoodys || null,
        }))
      );
    }

    // ── 9. Deduplicação: manter apenas o registro mais recente por codigoCetip ──
    report("Deduplicando registros por papel...", 0, 1);
    // Para cada codigoCetip com múltiplos registros, deletar todos exceto o de maior dataReferencia
    // (em caso de empate na data, manter o de maior id)
    await db.execute(sql`
      DELETE sa FROM spread_analysis sa
      INNER JOIN (
        SELECT codigoCetip, MAX(dataReferencia) AS maxData
        FROM spread_analysis
        GROUP BY codigoCetip
      ) latest ON sa.codigoCetip = latest.codigoCetip
      WHERE sa.dataReferencia < latest.maxData
    `);
    report("Deduplicação concluída", 1, 1);

    // ── 10. Limpeza de janela: deletar registros com mais de 30 dias ─────────
    report("Aplicando janela de 30 dias...", 0, 1);
    await db.execute(sql`
      DELETE FROM spread_analysis
      WHERE dataReferencia < DATE_FORMAT(
        DATE_SUB(
          STR_TO_DATE(
            (SELECT MAX(dataReferencia) FROM spread_analysis AS sa2),
            '%Y-%m-%d'
          ),
          INTERVAL 30 DAY
        ),
        '%Y-%m-%d'
      )
    `);
    report("Janela de 30 dias aplicada", 1, 1);

    const comRating = marked.length;
    const semMatch = anbimaData.length - comRating;

    report(
      "Sincronização concluída!",
      marked.length,
      marked.length
    );

    // Atualizar log
    if (logId) {
      await db
        .update(syncLog)
        .set({
          status: "success",
          mensagem: `Concluído: ${moodysData.length} ratings Moody's, ${anbimaData.length} ativos ANBIMA, ${enriquecidos} enriquecidos via ANBIMA Data, ${comRating} com match de emissão, ${outlierCount} outliers marcados`,
          totalProcessados: marked.length,
          finalizadoEm: new Date(),
        })
        .where(eq(syncLog.id, logId));
    }

    currentSyncStatus = "success";
    lastSyncAt = new Date();

    return { total: marked.length, comRating, semMatch, outliers: outlierCount };
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
