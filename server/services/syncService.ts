/**
 * Serviço de sincronização — processa as planilhas da Moody's e ANBIMA Data
 * e persiste os dados cruzados no banco de dados.
 *
 * Fluxo (v3.11 — invertido: parte da Moody's):
 * 1. Parsear planilha Moody's → ratings por emissão específica
 * 2. Parsear planilha ANBIMA Data → ativos com Z-spread (data mais recente)
 * 3. Para cada emissão Moody's com número de emissão, buscar candidatos ANBIMA
 *    via Dice ≥ 0.70 (pré-filtro em memória, sem browser)
 * 4. Enriquecer via ANBIMA Data (Playwright, retry 3x) APENAS os CETIPs candidatos
 * 5. Confirmar match por número de emissão idêntico + Dice ≥ 0.70
 * 6. Marcar outliers: por rating+universo, critério adaptativo
 * 7. Persistir resultados com scoreMatch, isOutlier e campos de rastreabilidade
 */
import { getDb, invalidateLatestDateCache } from "../db";
import {
  moodysRatings,
  anbimaAssets,
  spreadAnalysis,
  syncLog,
  historicalSnapshots,
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
import { SCORE_MIN_THRESHOLD } from "../../shared/const";

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
 * Pré-filtro Dice invertido: parte das emissões Moody's (com número de emissão)
 * e para cada uma busca candidatos na planilha ANBIMA com Dice ≥ 0.70.
 *
 * Retorna os códigos CETIP únicos que têm ao menos um candidato plausível
 * na Moody's — sem abrir nenhuma aba do browser.
 *
 * Garante cobertura total: toda emissão Moody's é verificada.
 */
function preFilterByCandidates(
  assets: AnbimaAsset[],
  ratings: MoodysRatingRow[]
): string[] {
  // Pré-processar ativos ANBIMA normalizados com seus CETIPs
  const assetsNorm = assets.map((a) => ({
    cetip: a.codigoAtivo,
    norm: normalizeEmissor(a.emissor),
  }));

  // Emissões Moody's com número de emissão preenchido
  const emissoesMoodys = ratings
    .filter((r) => r.isEmissao && r.numeroEmissao !== null)
    .map((r) => normalizeEmissor(r.emissor));

  const candidatosSet = new Set<string>();

  for (const moodysNorm of emissoesMoodys) {
    for (const asset of assetsNorm) {
      if (diceCoefficient(asset.norm, moodysNorm) >= SCORE_MIN_THRESHOLD) {
        candidatosSet.add(asset.cetip);
      }
    }
  }

  return Array.from(candidatosSet);
}

/**
 * Realiza o cruzamento emissão-a-emissão (v3.11 — invertido: parte da Moody's):
 * Para cada emissão Moody's com número de emissão, busca na planilha ANBIMA
 * o ativo com emissor similar (Dice ≥ 0.70) que foi enriquecido com o mesmo
 * número de emissão via ANBIMA Data.
 *
 * Garante cobertura total: toda emissão Moody's é verificada.
 * Retorna apenas os ativos com match confirmado.
 */
function crossByEmissao(
  assets: AnbimaAsset[],
  ratings: MoodysRatingRow[],
  sndMap: Map<string, SndRecord>
): SpreadResult[] {
  // Pré-processar emissões Moody's com número de emissão
  const ratingsEmissao = ratings
    .filter((r) => r.isEmissao && r.numeroEmissao !== null)
    .map((r) => ({
      ...r,
      emissorNorm: normalizeEmissor(r.emissor),
      emissaoNum: parseInt(r.numeroEmissao!, 10),
    }))
    .filter((r) => !isNaN(r.emissaoNum));

  // Pré-processar ativos ANBIMA enriquecidos (com número de emissão do Playwright)
  const assetsEnriquecidos = assets
    .map((a) => {
      const snd = sndMap.get(a.codigoAtivo.toUpperCase());
      if (!snd) return null;
      return { asset: a, snd, emissorNorm: normalizeEmissor(a.emissor) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Mapa CETIP → resultado para evitar duplicatas (um CETIP pode ter match com múltiplos ratings)
  const resultMap = new Map<string, SpreadResult>();

  // Iterar sobre cada emissão Moody's e procurar o melhor ativo ANBIMA correspondente
  for (const r of ratingsEmissao) {
    let bestAsset: typeof assetsEnriquecidos[0] | null = null;
    let bestScore = 0;

    for (const item of assetsEnriquecidos) {
      // Filtro primário: número de emissão deve ser idêntico
      if (item.snd.numeroEmissao !== r.emissaoNum) continue;

      // Filtro secundário: nome do emissor deve ser similar (Dice ≥ 0.70)
      const score = diceCoefficient(item.emissorNorm, r.emissorNorm);
      if (score >= SCORE_MIN_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestAsset = item;
      }
    }

    if (!bestAsset) continue;

    const cetip = bestAsset.asset.codigoAtivo;

    // Se já existe um match para este CETIP, manter o de maior score
    const existing = resultMap.get(cetip);
    if (existing && existing.scoreMatch >= bestScore) continue;

    resultMap.set(cetip, {
      codigoCetip: cetip,
      emissorNome: bestAsset.asset.emissor,
      tipoRemuneracao: bestAsset.asset.tipoRemuneracao,
      remuneracao: bestAsset.asset.remuneracao,
      dataVencimento: bestAsset.asset.dataVencimento,
      taxaIndicativa: bestAsset.asset.taxaIndicativa,
      duration: bestAsset.asset.duration,
      referenciaNtnb: bestAsset.asset.referenciaNtnb,
      zSpread: bestAsset.asset.zSpread,
      spreadIncentivadoSemGrossUp: bestAsset.asset.spreadIncentivadoSemGrossUp,
      lei12431: bestAsset.asset.lei12431,
      dataReferencia: bestAsset.asset.dataReferencia,
      isin: bestAsset.snd.isin || null,
      numeroEmissao: bestAsset.snd.numeroEmissao,
      rating: r.rating,
      setor: r.setor,
      tipoMatch: "emissao",
      scoreMatch: bestScore,
      emissorMoodys: r.emissor,
      numeroEmissaoMoodys: r.numeroEmissao || "",
      instrumentoMoodys: r.instrumento || "",
      isOutlier: false,
    });
  }

  return Array.from(resultMap.values());
}

/**
 * Marca outliers por rating+universo usando critério adaptativo:
 *
 * Critério adaptativo por tamanho de grupo:
 * - n < 5:  Sem remoção — amostra insuficiente para qualquer critério estatístico.
 * - 5 ≤ n < 10: ±2σ amostral — grupos pequenos têm alta variância amostral;
 *   usar 2σ captura extremos óbvios sem ser excessivamente conservador.
 * - 10 ≤ n < 20: ±2,5σ amostral — grupos médios com mais estabilidade.
 * - n ≥ 20: Winsorização 10% — corta os 10% extremos de cada lado (P10–P90),
 *   robusto para distribuições assimétricas típicas de spreads de crédito.
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
  // Determinar universo de cada ativo para agrupar separadamente.
  // DI SPREAD (bps sobre CDI) e DI PERCENTUAL (% do CDI) são métricas diferentes
  // e devem ter seus próprios limites de outlier.
  const getUniverso = (tipoRemuneracao: string): string => {
    const t = tipoRemuneracao.toUpperCase();
    if (t.includes("IPCA")) return "IPCA";
    if (t === "DI SPREAD" || t.includes("DI SPREAD")) return "DI_SPREAD";
    if (t === "DI PERCENTUAL" || t.includes("DI PERCENTUAL")) return "DI_PCT";
    if (t.includes("DI")) return "DI_SPREAD"; // fallback para outros formatos DI
    return "OUTRO";
  };

  // Agrupar por rating + universo (ex: "AA-.br|IPCA", "AA-.br|DI_SPREAD", "AA-.br|DI_PCT")
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
    const n = group.length;
    const spreads = group.map((r) => r.zSpread);

    // n < 5: amostra insuficiente — sem remoção
    if (n < 5) {
      ratingStats[rating] = { total: n, outliers: 0, cutLow: -Infinity, cutHigh: Infinity, mean: 0, stdDev: 0 };
      continue;
    }

    let cutLow: number;
    let cutHigh: number;
    let mean = 0;
    let stdDev = 0;

    if (n >= 20) {
      // Winsorização 10%: corta os 10% extremos de cada lado (P10–P90)
      const sorted = [...spreads].sort((a, b) => a - b);
      const k = Math.floor(n * 0.10);
      cutLow  = sorted[k];
      cutHigh = sorted[n - 1 - k];
      // mean/stdDev calculados sobre o núcleo (para stats)
      const core = sorted.slice(k, n - k);
      mean = core.reduce((s, v) => s + v, 0) / core.length;
      const variance = core.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / core.length;
      stdDev = Math.sqrt(variance);
    } else {
      // Grupos médios/pequenos: z-score com sigma adaptativo
      // 10 ≤ n < 20 → ±2,5σ | 5 ≤ n < 10 → ±2σ
      const sigma = n >= 10 ? 2.5 : 2.0;
      mean = spreads.reduce((s, v) => s + v, 0) / n;
      const variance = spreads.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
      stdDev = Math.sqrt(variance);
      cutLow  = mean - sigma * stdDev;
      cutHigh = mean + sigma * stdDev;
    }

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

    // ── 3. Pré-filtro Dice invertido: parte das emissões Moody's ────────────
    // Para cada emissão Moody's com número de emissão, busca candidatos ANBIMA
    // com Dice ≥ 0.70. Garante cobertura total das emissões Moody's.
    report("Identificando candidatos ANBIMA para cada emissão Moody's (Dice ≥ 0.70)...", 0, 1);
    const candidatosCetip = preFilterByCandidates(anbimaData, moodysData);
    const emissoesMoodysCount = moodysData.filter((r) => r.isEmissao && r.numeroEmissao !== null).length;
    report(
      `${candidatosCetip.length} de ${anbimaData.length} ativos ANBIMA são candidatos (cobertura: ${emissoesMoodysCount} emissões Moody's verificadas)`,
      1,
      1
    );
    console.log(`[Sync] Pré-filtro Dice invertido: ${candidatosCetip.length}/${anbimaData.length} candidatos ANBIMA para ${emissoesMoodysCount} emissões Moody's`);

    // ── 4. Enriquecer via ANBIMA Data — APENAS os candidatos ─────────────────
    report(
      `Consultando ANBIMA Data para ${candidatosCetip.length} candidatos...`,
      0,
      candidatosCetip.length
    );
    // ANBIMA Data usa Playwright (browser headless) — batchSize 3 para não sobrecarregar
    const sndMap = await enrichBatch(candidatosCetip, 3, (done, total) => {
      report(`Consultando ANBIMA Data (${done}/${total})...`, done, total);
    });
    const enriquecidos = sndMap.size;
    report(
      `${enriquecidos} de ${candidatosCetip.length} candidatos enriquecidos via ANBIMA Data`,
      enriquecidos,
      candidatosCetip.length
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

    // ── 8. Guard: abortar se nenhum resultado foi produzido ────────────────────
    if (marked.length === 0) {
      throw new Error(
        "Nenhuma emissão com match foi produzida neste sync. " +
        "Verifique se as planilhas estão corretas e se o enriquecimento via ANBIMA Data funcionou. " +
        "Os dados existentes no banco foram preservados."
      );
    }

    // ── 9. Persistir resultados de spread ─────────────────────────────────────
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
      ).onDuplicateKeyUpdate({
        // Ao sincronizar a mesma planilha (mesmo papel, mesma data), atualiza os dados
        // sem criar duplicata. Preserva a serie historica de outras datas intacta.
        set: {
          rating: sql`VALUES(rating)`,
          tipoMatch: sql`VALUES(tipoMatch)`,
          taxaIndicativa: sql`VALUES(taxaIndicativa)`,
          durationAnos: sql`VALUES(durationAnos)`,
          zspread: sql`VALUES(zspread)`,
          spreadIncentivadoSemGrossUp: sql`VALUES(spreadIncentivadoSemGrossUp)`,
          scoreMatch: sql`VALUES(scoreMatch)`,
          isOutlier: sql`VALUES(isOutlier)`,
          emissorNome: sql`VALUES(emissorNome)`,
          setor: sql`VALUES(setor)`,
          indexador: sql`VALUES(indexador)`,
        },
      });
    }

    // -- Passo B: Snapshot historico (antes da limpeza) --
    report("Calculando snapshot historico...", 0, 1);
    const snapshotNow = new Date();

    // Determinar a data de referência da planilha recém-sincronizada
    // (cada planilha tem uma única data; o snapshot deve ser calculado
    //  APENAS com os papéis dessa data, não com todo o histórico acumulado)
    const dataAtualRows = await db.execute(sql`
      SELECT MAX(dataReferencia) AS dataMax FROM spread_analysis
    `) as unknown as { dataMax: string }[][];
    const dataRefFim = ((dataAtualRows[0] || []) as { dataMax: string }[])[0]?.dataMax || "";
    const dataRefIni = dataRefFim;

    const windowRows = await db.execute(sql`
      SELECT rating, zspread, dataReferencia, indexador
      FROM spread_analysis
      WHERE isOutlier = 0
      AND zspread IS NOT NULL
      AND dataReferencia = ${dataRefFim}
    `) as unknown as { rating: string; zspread: string; dataReferencia: string; indexador: string | null }[][];
    const windowData = (windowRows[0] || []) as { rating: string; zspread: string; dataReferencia: string; indexador: string | null }[];

    // Segregar por indexador + rating
    const byIndexadorRatingMap = new Map<string, Map<string, number[]>>();
    for (const row of windowData) {
      if (!row.rating || row.zspread == null) continue;
      const zs = parseFloat(row.zspread);
      if (!isFinite(zs)) continue;
      const idx = row.indexador || "OUTROS";
      if (!byIndexadorRatingMap.has(idx)) byIndexadorRatingMap.set(idx, new Map());
      const ratingMap = byIndexadorRatingMap.get(idx)!;
      if (!ratingMap.has(row.rating)) ratingMap.set(row.rating, []);
      ratingMap.get(row.rating)!.push(zs);
    }

    const calcPercentile = (sorted: number[], p: number): number => {
      const idx = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
    };

    const snapshotRows: typeof historicalSnapshots.$inferInsert[] = [];
    for (const [indexador, ratingMap] of Array.from(byIndexadorRatingMap.entries())) {
      for (const [rating, vals] of Array.from(ratingMap.entries())) {
        const sorted = [...vals].sort((a, b) => a - b);
        const n = sorted.length;
        const media = sorted.reduce((s, v) => s + v, 0) / n;
        const mediana = n % 2 === 0
          ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
          : sorted[Math.floor(n / 2)];
        const p25 = calcPercentile(sorted, 25);
        const p75 = calcPercentile(sorted, 75);
        const variance = sorted.reduce((s, v) => s + Math.pow(v - media, 2), 0) / n;
        const std = Math.sqrt(variance);
        snapshotRows.push({
          snapshotAt: snapshotNow,
          dataRefIni,
          dataRefFim,
          indexador,
          rating,
          nPapeis: n,
          mediaSpread: String(media.toFixed(4)),
          medianaSpread: String(mediana.toFixed(4)),
          p25Spread: String(p25.toFixed(4)),
          p75Spread: String(p75.toFixed(4)),
          stdSpread: String(std.toFixed(4)),
        });
      }
    }

    let snapshotId: number | null = null;
    if (snapshotRows.length > 0) {
      // UPSERT: se já existe snapshot para (dataRefFim, indexador, rating), atualiza em vez de inserir
      const [snapResult] = await db.insert(historicalSnapshots).values(snapshotRows).onDuplicateKeyUpdate({
        set: {
          snapshotAt: snapshotNow,
          dataRefIni: snapshotRows[0].dataRefIni,
          nPapeis: sql`VALUES(nPapeis)`,
          mediaSpread: sql`VALUES(mediaSpread)`,
          medianaSpread: sql`VALUES(medianaSpread)`,
          p25Spread: sql`VALUES(p25Spread)`,
          p75Spread: sql`VALUES(p75Spread)`,
          stdSpread: sql`VALUES(stdSpread)`,
        },
      });
      snapshotId = (snapResult as { insertId?: number }).insertId || null;
    }
    report(`Snapshot historico criado/atualizado (${snapshotRows.length} ratings)`, 1, 1);

    // -- Passo C: Deduplicacao + janela rolling 28 dias --
    // A chave de deduplicacao e (codigoCetip, dataReferencia): cada papel pode ter
    // um registro por data de referencia, preservando a serie historica completa.
    // Apenas duplicatas exatas (mesmo papel, mesma data) sao removidas.
    report("Deduplicando e aplicando janela rolling de 28 dias...", 0, 1);
    await db.execute(sql`
      DELETE sa FROM spread_analysis sa
      INNER JOIN (
        SELECT codigoCetip, dataReferencia, MAX(id) AS maxId
        FROM spread_analysis
        GROUP BY codigoCetip, dataReferencia
      ) latest ON sa.codigoCetip = latest.codigoCetip
        AND sa.dataReferencia = latest.dataReferencia
      WHERE sa.id < latest.maxId
    `);
    await db.execute(sql`
      DELETE FROM spread_analysis
      WHERE tipo = 'DEB'
        AND dataReferencia < (
          SELECT data_ref FROM (
            SELECT DATE_FORMAT(
              DATE_SUB(MAX(dataReferencia), INTERVAL 28 DAY),
              '%Y-%m-%d'
            ) AS data_ref
            FROM spread_analysis
            WHERE tipo = 'DEB'
          ) AS tmp
        )
    `);
    report("Janela rolling de 28 dias aplicada", 1, 1);

    // -- Passo D: Detectar variacao de spread por rating --
    const ALERT_THRESHOLD = parseFloat(process.env.ALERT_THRESHOLD_PCT || "15") / 100;
    const alertas: { rating: string; variacao_pct: number; de: number; para: number }[] = [];

    if (snapshotId && snapshotRows.length > 0) {
      const prevSnapshotRows = await db.execute(sql`
        SELECT rating, mediaSpread
        FROM historical_snapshots
        WHERE id < ${snapshotId}
        ORDER BY snapshotAt DESC
        LIMIT ${snapshotRows.length * 2}
      `) as unknown as { rating: string; mediaSpread: string }[][];

      const prevMap = new Map<string, number>();
      for (const row of ((prevSnapshotRows[0] || []) as { rating: string; mediaSpread: string }[])) {
        if (!prevMap.has(row.rating)) {
          prevMap.set(row.rating, parseFloat(row.mediaSpread));
        }
      }

      for (const snap of snapshotRows) {
        const prev = prevMap.get(snap.rating);
        if (prev == null || prev === 0) continue;
        const atual = parseFloat(snap.mediaSpread as string);
        const variacao = Math.abs((atual - prev) / prev);
        if (variacao > ALERT_THRESHOLD) {
          alertas.push({
            rating: snap.rating,
            variacao_pct: parseFloat((variacao * 100).toFixed(1)),
            de: Math.round(prev * 10000),
            para: Math.round(atual * 10000),
          });
        }
      }
    }

    if (alertas.length > 0) {
      console.log(`[Sync] ${alertas.length} alertas de variacao detectados:`);
      for (const a of alertas) {
        console.log(`  ${a.rating}: ${a.variacao_pct}% (${a.de} -> ${a.para} bps)`);
      }
    }

    const comRating = marked.length;
    const semMatch = anbimaData.length - comRating;

    report("Sincronizacao concluida!", marked.length, marked.length);

    // -- Passo E: Atualizar sync_log --
    if (logId) {
      // Obter a data de referência mais recente dos dados processados
      const normalizeDate = (d: string | null | undefined): string | null => {
        if (!d) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
        const parts = d.split("/");
        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
        return d;
      };
      const maxDataRef = marked
        .map((s) => normalizeDate(s.dataReferencia))
        .filter((d): d is string => !!d)
        .reduce((a, b) => (a > b ? a : b), "") || null;
      await db
        .update(syncLog)
        .set({
          status: "success",
          mensagem: `Concluido: ${moodysData.length} ratings Moody's, ${anbimaData.length} ativos ANBIMA, ${enriquecidos} enriquecidos via ANBIMA Data, ${comRating} com match de emissao, ${outlierCount} outliers marcados${alertas.length > 0 ? `, ${alertas.length} alertas de variacao` : ""}`,
          totalProcessados: marked.length,
          papeisNaJanela: comRating,
          alertas: alertas.length > 0 ? alertas : null,
          finalizadoEm: new Date(),
          dataReferencia: maxDataRef,
        })
        .where(eq(syncLog.id, logId));
    }

    invalidateLatestDateCache();
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
