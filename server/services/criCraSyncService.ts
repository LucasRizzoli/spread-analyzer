/**
 * Serviço de sincronização para planilhas CRI/CRA da ANBIMA
 *
 * Fluxo:
 * 1. Parsear planilha CRI/CRA → lista de CriCraRow com taxa indicativa e duration
 * 2. Buscar CDI anualizado via API BCB (série 4389) para gross-up DI+/DI%
 * 3. Para cada ativo, calcular z-spread com gross-up de IR conforme o indexador:
 *    - IPCA SPREAD: gross-up direto sobre taxa total; fórmula geométrica com NTN-B
 *    - DI ADITIVO: gross-up composto (1+CDI)×(1+spread)/(1−IR)−1; z-spread = bruto−CDI
 *    - DI MULTIPLICATIVO: gross-up composto sobre retorno total; z-spread = bruto−CDI
 *    - PRE FIXADO: descartado
 * 4. Cruzar o devedor com a planilha Moody's (Dice ≥ SCORE_MIN_THRESHOLD no nome do devedor)
 * 5. Descartar registros sem match de rating (igual às debêntures)
 * 6. Marcar outliers por rating+grupo analítico
 * 7. Persistir em spread_analysis com tipo CRI ou CRA e indexador = grupo analítico
 * 8. Gravar snapshot histórico
 *
 * Grupos analíticos:
 *   IPCA → "IPCA SPREAD"
 *   DI ADITIVO → "DI SPREAD"
 *   DI MULTIPLICATIVO → "DI PERCENTUAL"
 */

import { getDb, getNtnbImplicitaCurve } from "../db";
import { moodysRatings, spreadAnalysis, historicalSnapshots } from "../../drizzle/schema";
import { parseCriCraXlsx, CriCraRow } from "./criCraParser";
import { normalizeEmissor } from "./moodysScraperService";
import { sql } from "drizzle-orm";
import { CRI_CRA_SCORE_MIN_THRESHOLD } from "../../shared/const";

// ── Busca do CDI via API BCB ───────────────────────────────────────────────────

/**
 * Busca o CDI anualizado mais recente via API pública do Banco Central (SGS série 4389).
 * Retorna o CDI em % a.a. (ex: 14.65 = 14,65% a.a.)
 * Em caso de falha, usa fallback baseado na SELIC (SELIC − 0,10%).
 */
export async function fetchCdiAnual(fallbackSelic?: number): Promise<number> {
  const FALLBACK_CDI = fallbackSelic != null ? fallbackSelic - 0.10 : 14.55;
  try {
    const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json";
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { data: string; valor: string }[];
    if (!data.length) throw new Error("Resposta vazia");
    const cdi = parseFloat(data[0].valor);
    if (!isFinite(cdi) || cdi <= 0) throw new Error(`Valor inválido: ${data[0].valor}`);
    console.log(`[CriCraSync] CDI anualizado (BCB): ${cdi}% a.a. (${data[0].data})`);
    return cdi;
  } catch (err) {
    console.warn(`[CriCraSync] Falha ao buscar CDI via BCB: ${err}. Usando fallback: ${FALLBACK_CDI}% a.a.`);
    return FALLBACK_CDI;
  }
}

// ── Estado global de sync CRI/CRA ──────────────────────────────────────────

export type CriCraSyncStatus = "idle" | "running" | "success" | "error";

let criCraSyncStatus: CriCraSyncStatus = "idle";
let criCraSyncProgress = { step: "", done: 0, total: 0 };
let criCraLastSyncAt: Date | null = null;
let criCraLastSyncError: string | null = null;

export function getCriCraSyncState() {
  return {
    status: criCraSyncStatus,
    progress: criCraSyncProgress,
    lastSyncAt: criCraLastSyncAt,
    lastSyncError: criCraLastSyncError,
  };
}

// ── Mapeamento de indexador para grupo analítico ─────────────────────────────

/**
 * Mapeia o tipoRemuneracao da planilha para o grupo analítico padronizado.
 * Retorna null para indexadores não suportados (ex: PRE FIXADO).
 */
function mapIndexadorToGrupo(tipoRemuneracao: string): string | null {
  const t = tipoRemuneracao.toUpperCase().trim();
  if (t.includes("IPCA")) return "IPCA SPREAD";
  if (t.includes("DI") && t.includes("ADITIVO")) return "DI SPREAD";
  if (t.includes("DI") && t.includes("MULTIPLICATIVO")) return "DI PERCENTUAL";
  // PRE FIXADO e outros: descartar
  return null;
}

// ── Tabela regressiva de IR ─────────────────────────────────────────────────

/**
 * Retorna a alíquota de IR aplicável conforme o prazo restante até o vencimento.
 * Tabela regressiva brasileira (renda fixa, pessoa física):
 *   ≤ 180 dias  → 22,5%
 *   ≤ 360 dias  → 20,0%
 *   ≤ 720 dias  → 17,5%
 *   > 720 dias  → 15,0%
 */
function aliquotaIR(diasAteVencimento: number): number {
  if (diasAteVencimento <= 180) return 0.225;
  if (diasAteVencimento <= 360) return 0.200;
  if (diasAteVencimento <= 720) return 0.175;
  return 0.150;
}

/**
 * Calcula o gross-up da taxa para base pré-IR.
 * taxaGrossUp = taxaLiquida / (1 − aliquotaIR)
 * Aplicado APENAS para CRI/CRA (não para debêntures).
 */
function grossUpIR(taxaLiquida: number, diasAteVencimento: number): number {
  const aliq = aliquotaIR(diasAteVencimento);
  return taxaLiquida / (1 - aliq);
}

// ── Cálculo de z-spread por indexador ────────────────────────────────────────

/**
 * Calcula o z-spread conforme o grupo analítico do indexador.
 *
 * Para CRI/CRA, aplica gross-up de IR para colocar na mesma base pré-IR das debêntures.
 *
 * IPCA SPREAD:
 *   taxaGrossUp = taxaIndicativa / (1 − aliquotaIR)
 *   z-spread = fórmula geométrica com taxaGrossUp
 *
 * DI SPREAD (DI ADITIVO) — fórmula composta:
 *   O título paga CDI + spread isento. Para encontrar o equivalente tributado:
 *   fatorIsento = (1 + CDI/100) × (1 + spread/100)
 *   fatorBruto  = fatorIsento / (1 − aliquotaIR)
 *   taxaBruta   = (fatorBruto − 1) × 100  [% a.a. total]
 *   z-spread    = taxaBruta − CDI  [spread equivalente sobre CDI, base pré-IR]
 *   Onde spread = taxaCorrecao (spread contratado, % a.a.)
 *
 * DI PERCENTUAL (DI MULTIPLICATIVO) — fórmula composta:
 *   O título paga (taxaIndicativa/100) × CDI isento. Para encontrar o equivalente tributado:
 *   taxaIsenta  = (taxaIndicativa/100) × (CDI/100)  [retorno total isento, decimal]
 *   fatorIsento = 1 + taxaIsenta
 *   fatorBruto  = fatorIsento / (1 − aliquotaIR)
 *   taxaBruta   = (fatorBruto − 1) × 100  [% a.a. total]
 *   z-spread    = taxaBruta − CDI  [spread equivalente sobre CDI, base pré-IR]
 *
 * Quando cdiAnual não é fornecido (null), DI SPREAD e DI PERCENTUAL retornam null.
 */
function calcZspread(
  grupo: string,
  taxaIndicativa: number | null,
  taxaCorrecao: number | null,
  durationAnos: number | null,
  ntnbVertices: NtnbVertex[],
  diasAteVencimento: number | null,
  cdiAnual: number | null = null,
): { zspread: number | null; ntnbTaxa: number | null; taxaGrossUp: number | null } {
  if (grupo === "IPCA SPREAD") {
    if (taxaIndicativa == null || durationAnos == null || ntnbVertices.length === 0) {
      return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    }
    const ntnbTaxa = interpolateNtnb(durationAnos, ntnbVertices);
    if (ntnbTaxa == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    // Gross-up direto sobre a taxa total isenta
    const taxaGrossUp = diasAteVencimento != null
      ? grossUpIR(taxaIndicativa, diasAteVencimento)
      : taxaIndicativa;
    // Fórmula geométrica com taxa gross-up
    const zspread = ((1 + taxaGrossUp / 100) / (1 + ntnbTaxa / 100) - 1) * 100;
    return { zspread, ntnbTaxa, taxaGrossUp };
  }

  if (grupo === "DI SPREAD") {
    // Usa taxaIndicativa = spread de mercado sobre CDI (% a.a.)
    // A planilha ANBIMA reporta apenas o spread adicional sobre o CDI
    // Gross-up simples: o spread isento deve ser ajustado para base pré-IR
    // z-spread = taxaIndicativa / (1 − IR)
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    const aliq = diasAteVencimento != null ? aliquotaIR(diasAteVencimento) : 0.150;
    const zspread = taxaIndicativa / (1 - aliq);
    return { zspread, ntnbTaxa: null, taxaGrossUp: zspread };
  }

  if (grupo === "DI PERCENTUAL") {
    // Usa taxaIndicativa = % do CDI (ex: 100.38 = 100,38% do CDI)
    // Retorno total isento = (taxaIndicativa/100) × CDI
    // Gross-up do retorno total: taxaBruta = taxaIsenta / (1 − IR)
    // Z-spread = taxaBruta − CDI (spread equivalente sobre CDI, base pré-IR)
    if (taxaIndicativa == null || cdiAnual == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    const aliq = diasAteVencimento != null ? aliquotaIR(diasAteVencimento) : 0.150;
    // Retorno total isento em % a.a.
    const taxaIsenta = (taxaIndicativa / 100) * cdiAnual;
    // Gross-up: taxa bruta equivalente
    const taxaBruta = taxaIsenta / (1 - aliq);
    // Z-spread = taxa bruta − CDI
    const zspread = taxaBruta - cdiAnual;
    return { zspread, ntnbTaxa: null, taxaGrossUp: taxaBruta };
  }

  return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
}

// ── Dice Coefficient ────────────────────────────────────────────────────────

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const set: string[] = [];
    for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2));
    return set;
  };
  const aB = bigrams(a);
  const bB = bigrams(b);
  const bSet = new Map<string, number>();
  for (const bg of bB) bSet.set(bg, (bSet.get(bg) ?? 0) + 1);
  let matches = 0;
  for (const bg of aB) {
    const cnt = bSet.get(bg) ?? 0;
    if (cnt > 0) { matches++; bSet.set(bg, cnt - 1); }
  }
  return (2 * matches) / (aB.length + bB.length);
}

// ── Interpolação linear na curva NTN-B ──────────────────────────────────────

interface NtnbVertex {
  durationAnos: number;
  taxaIndicativa: number;
}

/**
 * Interpola linearmente a taxa NTN-B para uma duration específica.
 * Usa os dois vértices mais próximos (um abaixo e um acima).
 * Se a duration estiver fora do range, extrapola com o vértice mais próximo.
 */
function interpolateNtnb(durationAnos: number, vertices: NtnbVertex[]): number | null {
  if (!vertices.length) return null;
  const sorted = [...vertices].sort((a, b) => a.durationAnos - b.durationAnos);

  // Abaixo do mínimo: usar o menor vértice
  if (durationAnos <= sorted[0].durationAnos) return sorted[0].taxaIndicativa;
  // Acima do máximo: usar o maior vértice
  if (durationAnos >= sorted[sorted.length - 1].durationAnos) return sorted[sorted.length - 1].taxaIndicativa;

  // Encontrar os dois vértices adjacentes
  let lower = sorted[0];
  let upper = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].durationAnos <= durationAnos && sorted[i + 1].durationAnos >= durationAnos) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }

  if (upper.durationAnos === lower.durationAnos) return lower.taxaIndicativa;

  // Interpolação linear
  const t = (durationAnos - lower.durationAnos) / (upper.durationAnos - lower.durationAnos);
  return lower.taxaIndicativa + t * (upper.taxaIndicativa - lower.taxaIndicativa);
}

// ── Função principal de sync ─────────────────────────────────────────────────

export async function runCriCraSync(fileBuffer: Buffer, dataRefFimOverride?: string): Promise<{
  totalProcessados: number;
  totalComRating: number;
  totalSemRating: number;
  dataReferencia: string | null;
}> {
  if (criCraSyncStatus === "running") {
    throw new Error("Sync CRI/CRA já em execução");
  }

  criCraSyncStatus = "running";
  criCraSyncProgress = { step: "Iniciando", done: 0, total: 0 };
  criCraLastSyncError = null;

  try {
    const db = await getDb();
    if (!db) throw new Error("Banco de dados não disponível");

    // ── 1. Parsear planilha CRI/CRA ──────────────────────────────────────────
    criCraSyncProgress = { step: "Parseando planilha CRI/CRA", done: 0, total: 0 };
    const { rows, dataRefFim } = await parseCriCraXlsx(fileBuffer);
    const dataRef = dataRefFimOverride ?? dataRefFim;

    console.log(`[CriCraSync] ${rows.length} registros parseados, data ref: ${dataRef}`);

    if (!rows.length) throw new Error("Nenhum registro válido encontrado na planilha");

    // ── 2. Carregar curva NTN-B (calculada a partir das debêntures IPCA SPREAD) ─
    criCraSyncProgress = { step: "Carregando curva NTN-B", done: 0, total: rows.length };
    // Usa engenharia reversa sobre as debêntures IPCA SPREAD já no banco:
    //   taxaNtnb = (1 + taxaIndicativa/100) / (1 + zspread/100) - 1
    // Retorna taxaNtnb em decimal (ex: 0.0680 = 6,80% a.a.)
    const ntnbImplicitaPoints = await getNtnbImplicitaCurve();
    // getNtnbImplicitaCurve() retorna taxaNtnb em decimal (ex: 0.0640 = 6.40% a.a.)
    // Converter para % a.a. para que a interpolação e o cálculo de z-spread usem a mesma escala
    const ntnbVertices: NtnbVertex[] = ntnbImplicitaPoints
      .filter(p => p.durationAnos > 0 && p.taxaNtnb > 0)
      .map(p => ({
        durationAnos: p.durationAnos,
        taxaIndicativa: p.taxaNtnb * 100, // decimal → % a.a. (ex: 0.0640 → 6.40)
      }));

    console.log(`[CriCraSync] ${ntnbVertices.length} vértices NTN-B implícita carregados`);
    if (ntnbVertices.length === 0) {
      console.warn("[CriCraSync] ATENÇÃO: curva NTN-B implícita vazia — z-spreads IPCA não serão calculados. Faça o sync de debêntures primeiro.");
    }

    // ── 3. Carregar ratings Moody's ───────────────────────────────────────────
    criCraSyncProgress = { step: "Carregando ratings Moody's", done: 0, total: rows.length };
    const moodysRows = await db.select().from(moodysRatings);
    // Filtrar apenas ratings de emissão/dívida (excluir Rating de Emissor, Rating Corporativo, etc.)
    // Mesma lógica das debêntures: isEmissao = produto IN ('Rating de Dívida', 'Rating de Emissão')
    const PRODUTOS_EMISSAO = new Set(["Rating de Dívida", "Rating de Emissão"]);
    const moodysNormalized = moodysRows
      .filter((r: typeof moodysRows[0]) => PRODUTOS_EMISSAO.has(r.produto ?? ""))
      .map((r: typeof moodysRows[0]) => ({
        ...r,
        emissorNorm: normalizeEmissor(r.emissor),
      }));

    const totalMoodys = moodysRows.length;
    const totalEmissao = moodysNormalized.length;
    console.log(`[CriCraSync] ${totalEmissao} ratings de emissão/dívida carregados (de ${totalMoodys} total)`);

    // ── 3b. Buscar CDI anualizado via API BCB (para gross-up DI+/DI%) ─────────────
    criCraSyncProgress = { step: "Buscando CDI via API BCB", done: 0, total: rows.length };
    const cdiAnual = await fetchCdiAnual();

    // ── 4. Processar cada ativo ─────────────────────────────────────────────────────
    criCraSyncProgress = { step: "Calculando z-spreads e cruzando ratings", done: 0, total: rows.length };

    interface ProcessedResult {
      row: CriCraRow;
      grupo: string;           // Grupo analítico: "IPCA SPREAD" | "DI SPREAD" | "DI PERCENTUAL"
      zspread: number | null;
      taxaGrossUp: number | null;  // Taxa gross-up de IR (apenas CRI/CRA IPCA/DI SPREAD)
      ntnbTaxa: number | null;
      rating: string | null;
      setor: string | null;
      scoreMatch: number | null;
      moodysRatingId: number | null;
      emissorMoodys: string | null;
    }

    const results: ProcessedResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      criCraSyncProgress = { step: "Calculando z-spreads e cruzando ratings", done: i + 1, total: rows.length };

      // Mapear indexador para grupo analítico; descartar PRE FIXADO e outros
      const grupo = mapIndexadorToGrupo(row.tipoRemuneracao);
      if (!grupo) {
        // PRE FIXADO e indexadores não suportados: pular
        continue;
      }

      // Calcular dias corridos até o vencimento (para gross-up de IR)
      let diasAteVencimento: number | null = null;
      if (row.dataVencimento) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const venc = new Date(row.dataVencimento + "T00:00:00");
        const diffMs = venc.getTime() - hoje.getTime();
        diasAteVencimento = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }

      // Calcular z-spread conforme o grupo analítico (com gross-up de IR para CRI/CRA)
      const { zspread, ntnbTaxa, taxaGrossUp } = calcZspread(
        grupo,
        row.taxaIndicativa,
        row.taxaCorrecao,
        row.durationAnos,
        ntnbVertices,
        diasAteVencimento,
        cdiAnual,
      );

      // Cruzar devedor com Moody's
      let rating: string | null = null;
      let setor: string | null = null;
      let scoreMatch: number | null = null;
      let moodysRatingId: number | null = null;
      let emissorMoodys: string | null = null;

      const devedorNorm = row.devedor ? normalizeEmissor(row.devedor) : null;
      if (devedorNorm) {
        let bestScore = 0;
        let bestMatch: typeof moodysNormalized[0] | null = null;

        for (const m of moodysNormalized) {
          const score = diceCoefficient(devedorNorm, m.emissorNorm);
          if (score > bestScore && score >= CRI_CRA_SCORE_MIN_THRESHOLD) {
            bestScore = score;
            bestMatch = m;
          }
        }

        if (bestMatch) {
          rating = bestMatch.rating;
          setor = bestMatch.setor ?? null;
          scoreMatch = bestScore;
          moodysRatingId = bestMatch.id;
          emissorMoodys = bestMatch.emissor;
        }
      }

      results.push({ row, grupo, zspread, taxaGrossUp, ntnbTaxa, rating, setor, scoreMatch, moodysRatingId, emissorMoodys });
    }

    const comRating = results.filter(r => r.rating != null);
    const semRating = results.filter(r => r.rating == null);
    console.log(`[CriCraSync] ${comRating.length} com rating, ${semRating.length} sem rating`);

    // ── 5. Marcar outliers por rating+indexador ───────────────────────────────
    criCraSyncProgress = { step: "Marcando outliers", done: 0, total: results.length };

    // Agrupar por rating + grupo analítico (apenas registros com rating e z-spread)
    const groups = new Map<string, ProcessedResult[]>();
    for (const r of results) {
      if (!r.rating || r.zspread == null) continue;
      const key = `${r.rating}|${r.grupo}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const outlierSet = new Set<string>();
    for (const [, group] of Array.from(groups.entries())) {
      const n = group.length;
      const spreads = group.map((r: ProcessedResult) => r.zspread!);
      // Mesmo algoritmo adaptativo das debêntures:
      // n < 5: sem remoção | n >= 20: winsorização 10% | 5-19: ±2σ ou ±2.5σ
      if (n < 5) continue;
      let cutLow: number;
      let cutHigh: number;
      if (n >= 20) {
        const sorted = [...spreads].sort((a, b) => a - b);
        const k = Math.floor(n * 0.10);
        cutLow  = sorted[k];
        cutHigh = sorted[n - 1 - k];
      } else {
        const sigma = n >= 10 ? 2.5 : 2.0;
        const mean = spreads.reduce((s, v) => s + v, 0) / n;
        const variance = spreads.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
        const stdDev = Math.sqrt(variance);
        cutLow  = mean - sigma * stdDev;
        cutHigh = mean + sigma * stdDev;
      }
      for (const r of group) {
        if (r.zspread! < cutLow || r.zspread! > cutHigh) {
          outlierSet.add(r.row.codigoCetip);
        }
      }
    }

    // ── 6. Persistir em spread_analysis — apenas com rating Moody's ───────────
    criCraSyncProgress = { step: "Salvando no banco", done: 0, total: results.length };

    // Descartar registros sem match de rating (igual às debêntures)
    const toInsert = results.filter(r => r.rating != null).map(r => ({
      codigoCetip: r.row.codigoCetip,
      isin: null,
      tipo: r.row.tipo as "CRI" | "CRA",
      emissorNome: r.row.devedor ?? r.row.emissor,
      setor: r.setor ?? null,
      // Salvar o grupo analítico como indexador (padronizado)
      indexador: r.grupo,
      incentivado: false,
      rating: r.rating ?? null,
      tipoMatch: (r.rating ? "emissor" : "sem_match") as "emissor" | "sem_match",
      moodysRatingId: r.moodysRatingId ?? null,
      taxaIndicativa: r.row.taxaIndicativa != null ? String(r.row.taxaIndicativa) : null,
      durationAnos: r.row.durationAnos != null ? String(r.row.durationAnos) : null,
      dataReferencia: r.row.dataReferencia || dataRef || null,
      ntnbReferencia: r.row.refNtnb ?? null,
      ntnbTaxa: r.ntnbTaxa != null ? String(r.ntnbTaxa) : null,
      ntnbDuration: null,
      dataVencimento: r.row.dataVencimento ?? null,
      zspread: r.zspread != null ? String(r.zspread) : null,
      // Preservar taxa original (sem gross-up) em spreadIncentivadoSemGrossUp
      spreadIncentivadoSemGrossUp: r.row.taxaIndicativa != null ? String(r.row.taxaIndicativa) : null,
      scoreMatch: r.scoreMatch != null ? String(r.scoreMatch) : null,
      isOutlier: outlierSet.has(r.row.codigoCetip),
      emissorMoodys: r.emissorMoodys ?? null,
      numeroEmissaoSnd: null,
      numeroEmissaoMoodys: r.row.numeroEmissao ?? null,
      instrumentoMoodys: null,
    }));

    // UPSERT em lotes de 100
    const BATCH = 100;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);
      await db.insert(spreadAnalysis).values(batch).onDuplicateKeyUpdate({
        set: {
          tipo: sql`VALUES(tipo)`,
          emissorNome: sql`VALUES(emissorNome)`,
          setor: sql`VALUES(setor)`,
          indexador: sql`VALUES(indexador)`,
          rating: sql`VALUES(rating)`,
          tipoMatch: sql`VALUES(tipoMatch)`,
          moodysRatingId: sql`VALUES(moodysRatingId)`,
          taxaIndicativa: sql`VALUES(taxaIndicativa)`,
          durationAnos: sql`VALUES(durationAnos)`,
          ntnbReferencia: sql`VALUES(ntnbReferencia)`,
          ntnbTaxa: sql`VALUES(ntnbTaxa)`,
          zspread: sql`VALUES(zspread)`,
          scoreMatch: sql`VALUES(scoreMatch)`,
          isOutlier: sql`VALUES(isOutlier)`,
          emissorMoodys: sql`VALUES(emissorMoodys)`,
          updatedAt: sql`NOW()`,
        },
      });
      criCraSyncProgress = { step: "Salvando no banco", done: Math.min(i + BATCH, toInsert.length), total: toInsert.length };
    }

    // ── 7. Deduplicar + janela rolling 28 dias (igual syncService de debêntures) ─────────
    criCraSyncProgress = { step: "Deduplicando e aplicando janela rolling de 28 dias...", done: 0, total: 1 };

    // Passo A: Remover duplicatas exatas (mesmo codigoCetip + mesma dataReferencia)
    // Para cada par, manter apenas o registro com maior id
    await db.execute(sql`
      DELETE sa FROM spread_analysis sa
      INNER JOIN (
        SELECT codigoCetip, dataReferencia, MAX(id) AS maxId
        FROM spread_analysis
        WHERE tipo IN ('CRI', 'CRA')
        GROUP BY codigoCetip, dataReferencia
      ) latest ON sa.codigoCetip = latest.codigoCetip
        AND sa.dataReferencia = latest.dataReferencia
      WHERE sa.id < latest.maxId
        AND sa.tipo IN ('CRI', 'CRA')
    `);

    // Passo B: Janela rolling de 28 dias — remover registros com dataReferencia
    // anterior a MAX(dataReferencia) - 28 dias (apenas CRI/CRA)
    await db.execute(sql`
      DELETE FROM spread_analysis
      WHERE tipo IN ('CRI', 'CRA')
        AND dataReferencia < (
          SELECT data_ref FROM (
            SELECT DATE_FORMAT(
              DATE_SUB(MAX(dataReferencia), INTERVAL 28 DAY),
              '%Y-%m-%d'
            ) AS data_ref
            FROM spread_analysis
            WHERE tipo IN ('CRI', 'CRA')
          ) AS tmp
        )
    `);

    console.log("[CriCraSync] Deduplicação e janela rolling de 28 dias aplicadas");
    criCraSyncProgress = { step: "Deduplicando e aplicando janela rolling de 28 dias...", done: 1, total: 1 };

    // ── 8. Gravar snapshots históricos ────────────────────────────────────────────────────────────────────────────────────
    criCraSyncProgress = { step: "Gravando snapshots históricos", done: 0, total: 1 };
    const finalDataRef = dataRef ?? new Date().toISOString().slice(0, 10);
    const [snapshotRows] = await db.execute(sql`
      SELECT rating, zspread, dataReferencia, indexador
      FROM spread_analysis
      WHERE dataReferencia = ${finalDataRef}
        AND tipo IN ('CRI', 'CRA')
        AND isOutlier = 0
        AND zspread IS NOT NULL
        AND rating IS NOT NULL
    `) as unknown as { rating: string; zspread: string; indexador: string | null }[][];

    const snapshotData = (snapshotRows || []) as { rating: string; zspread: string; indexador: string | null }[];

    // Agrupar por indexador + rating
    const snapGroups = new Map<string, number[]>();
    for (const row of snapshotData) {
      const key = `${row.indexador ?? "IPCA SPREAD"}|${row.rating}`;
      if (!snapGroups.has(key)) snapGroups.set(key, []);
      snapGroups.get(key)!.push(parseFloat(row.zspread));
    }

    for (const [key, vals] of Array.from(snapGroups.entries())) {
      const [indexador, rating] = key.split("|");
      if (!vals.length) continue;
      const sorted = [...vals].sort((a: number, b: number) => a - b);
      const mean = vals.reduce((s: number, v: number) => s + v, 0) / vals.length;
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      const std = Math.sqrt(vals.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / vals.length);

      await db.insert(historicalSnapshots).values({
        snapshotAt: new Date(),
        dataRefIni: finalDataRef,
        dataRefFim: finalDataRef,
        indexador: `${indexador} (CRI/CRA)`,
        rating,
        nPapeis: vals.length,
        mediaSpread: String(mean),
        medianaSpread: String(median),
        p25Spread: String(p25),
        p75Spread: String(p75),
        stdSpread: String(std),
      }).onDuplicateKeyUpdate({
        set: {
          nPapeis: sql`VALUES(nPapeis)`,
          mediaSpread: sql`VALUES(mediaSpread)`,
          medianaSpread: sql`VALUES(medianaSpread)`,
          p25Spread: sql`VALUES(p25Spread)`,
          p75Spread: sql`VALUES(p75Spread)`,
          stdSpread: sql`VALUES(stdSpread)`,
          snapshotAt: sql`VALUES(snapshotAt)`,
        },
      });
    }

    criCraSyncStatus = "success";
    criCraLastSyncAt = new Date();
    criCraSyncProgress = { step: "Concluído", done: toInsert.length, total: toInsert.length };

    return {
      totalProcessados: toInsert.length,
      totalComRating: comRating.length,
      totalSemRating: semRating.length,
      dataReferencia: dataRef,
    };

  } catch (err) {
    criCraSyncStatus = "error";
    criCraLastSyncError = err instanceof Error ? err.message : String(err);
    console.error("[CriCraSync] Erro:", criCraLastSyncError);
    throw err;
  }
}
