/**
 * Serviço de cruzamento de dados e cálculo de Z-spread
 *
 * Lógica de matching (3 etapas):
 * 1. Match por ISIN (via ANBIMA Data) — mais confiável
 * 2. Match por emissor + número de emissão (fuzzy)
 * 3. Match por emissor apenas (fallback)
 *
 * Z-spread = taxa_indicativa_papel - taxa_ntnb_duration_mais_proxima
 * (separado por indexador: IPCA+ usa NTN-B; outros indexadores não calculamos NTN-B ref)
 */
import Fuse from "fuse.js";
import type { MoodysRatingRow } from "./moodysScraperService";
import type { NtnbItem, DebentureFeedItem, CriCraFeedItem } from "./anbimaFeedService";
import type { AnbimaDataAsset } from "./anbimaDataService";

// ─── Ordenação de ratings Moody's Local ──────────────────────────────────────

const RATING_ORDER: Record<string, number> = {
  "AAA.br": 1,
  "AA+.br": 2,
  "AA.br": 3,
  "AA-.br": 4,
  "A+.br": 5,
  "A.br": 6,
  "A-.br": 7,
  "BBB+.br": 8,
  "BBB.br": 9,
  "BBB-.br": 10,
  "BB+.br": 11,
  "BB.br": 12,
  "BB-.br": 13,
  "B+.br": 14,
  "B.br": 15,
  "B-.br": 16,
  "CCC.br": 17,
  "CC.br": 18,
  "C.br": 19,
  "D.br": 20,
};

export function getRatingOrder(rating: string): number {
  return RATING_ORDER[rating] ?? 99;
}

export function sortRatings(ratings: string[]): string[] {
  return Array.from(new Set(ratings)).sort((a, b) => getRatingOrder(a) - getRatingOrder(b));
}

// ─── Normalização de strings para matching ───────────────────────────────────

function normalizeString(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Sufixos corporativos a remover para melhorar o matching
const CORP_SUFFIXES = [
  "S A", "SA", "S/A", "LTDA", "EIRELI", "ME", "EPP",
  "CIA", "COMPANHIA", "GRUPO", "HOLDING", "PARTICIPACOES",
  "PARTICIPAÇÕES", "EMPREENDIMENTOS", "INVESTIMENTOS",
];

export function normalizeEmissorName(name: string): string {
  return normalizeEmissor(name);
}

export function extractEmissaoNumber(texto: string): number | null {
  const match = texto.match(/(\d+)[ªaº°]?\s*[Ee]miss[aã]o/) ||
    texto.match(/[Ee]miss[aã]o\s+(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeEmissor(name: string): string {
  let n = normalizeString(name);
  for (const suffix of CORP_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suffix}\\b`, "g"), "").trim();
  }
  return n.replace(/\s+/g, " ").trim();
}

// ─── Tipos de resultado ───────────────────────────────────────────────────────

export type TipoMatch = "emissao" | "emissor" | "sem_match";

export interface SpreadResult {
  codigoCetip: string;
  isin: string | null;
  tipo: "DEB" | "CRI" | "CRA";
  emissorNome: string;
  setor: string;
  indexador: string;
  incentivado: boolean;
  rating: string | null;
  tipoMatch: TipoMatch;
  moodysRatingId: number | null;
  taxaIndicativa: number;
  durationAnos: number;
  dataReferencia: string;
  ntnbReferencia: string | null;
  ntnbTaxa: number | null;
  ntnbDuration: number | null;
  zspread: number | null;
}

// ─── Interpolação da curva NTN-B ─────────────────────────────────────────────

/**
 * Encontra a NTN-B de duration mais próxima e interpola linearmente
 * entre os dois vértices adjacentes
 */
export function interpolateNtnb(
  targetDuration: number,
  ntnbCurve: NtnbItem[]
): { codigo: string; taxa: number; duration: number } | null {
  if (!ntnbCurve.length) return null;

  const sorted = [...ntnbCurve].sort((a, b) => a.durationAnos - b.durationAnos);

  // Extrapolação para duration menor que o menor vértice
  if (targetDuration <= sorted[0].durationAnos) {
    return {
      codigo: sorted[0].codigo_selic,
      taxa: sorted[0].taxa_indicativa,
      duration: sorted[0].durationAnos,
    };
  }

  // Extrapolação para duration maior que o maior vértice
  const last = sorted[sorted.length - 1];
  if (targetDuration >= last.durationAnos) {
    return {
      codigo: last.codigo_selic,
      taxa: last.taxa_indicativa,
      duration: last.durationAnos,
    };
  }

  // Interpolação linear entre os dois vértices adjacentes
  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i];
    const upper = sorted[i + 1];
    if (targetDuration >= lower.durationAnos && targetDuration <= upper.durationAnos) {
      const ratio =
        (targetDuration - lower.durationAnos) / (upper.durationAnos - lower.durationAnos);
      const taxa = lower.taxa_indicativa + ratio * (upper.taxa_indicativa - lower.taxa_indicativa);
      // Retorna o vértice mais próximo como referência
      const refVertex =
        Math.abs(targetDuration - lower.durationAnos) <
        Math.abs(targetDuration - upper.durationAnos)
          ? lower
          : upper;
      return {
        codigo: refVertex.codigo_selic,
        taxa: Math.round(taxa * 1000000) / 1000000,
        duration: targetDuration,
      };
    }
  }

  return null;
}

// ─── Matching Moody's × ANBIMA ───────────────────────────────────────────────

interface MoodysWithId extends MoodysRatingRow {
  id: number;
}

export function matchRatings(
  asset: {
    codigoCetip: string;
    isin: string | null;
    emissorNome: string;
    numeroEmissao: string | null;
  },
  moodysRatings: MoodysWithId[]
): { rating: string; tipoMatch: TipoMatch; moodysId: number } | null {
  // ── Etapa 1: Match por ISIN ──────────────────────────────────────────────
  // (ISIN não está na base Moody's diretamente, mas pode ser usado para
  //  confirmar match quando o objeto contém o código do papel)
  // Esta etapa é tratada externamente via ANBIMA Data

  // ── Etapa 2: Match por emissor + número de emissão ───────────────────────
  if (asset.numeroEmissao) {
    const emissaoMatches = moodysRatings.filter((m) => {
      if (!m.numeroEmissao) return false;
      if (m.numeroEmissao !== asset.numeroEmissao) return false;
      const normMoodys = normalizeEmissor(m.emissor);
      const normAsset = normalizeEmissor(asset.emissorNome);
      // Verifica se um contém o outro (para lidar com nomes abreviados)
      return normMoodys.includes(normAsset) || normAsset.includes(normMoodys);
    });

    if (emissaoMatches.length === 1) {
      return {
        rating: emissaoMatches[0].rating,
        tipoMatch: "emissao",
        moodysId: emissaoMatches[0].id,
      };
    }
  }

  // ── Etapa 3: Fuzzy match por emissor ────────────────────────────────────
  const normalizedMoodys = moodysRatings.map((m) => ({
    ...m,
    _normalized: normalizeEmissor(m.emissor),
  }));

  const fuse = new Fuse(normalizedMoodys, {
    keys: ["_normalized"],
    threshold: 0.3,
    includeScore: true,
  });

  const normalizedAssetEmissor = normalizeEmissor(asset.emissorNome);
  const results = fuse.search(normalizedAssetEmissor);

  if (results.length > 0 && results[0].score !== undefined && results[0].score < 0.3) {
    const best = results[0].item;
    // Preferir rating de emissão específica se disponível para este emissor
    const emissaoSpecific = moodysRatings.find(
      (m) => m.emissor === best.emissor && m.produto?.toLowerCase().includes("debênture")
    );
    const chosen = emissaoSpecific || best;
    return {
      rating: chosen.rating,
      tipoMatch: "emissor",
      moodysId: chosen.id,
    };
  }

  return null;
}

// ─── Cálculo principal ────────────────────────────────────────────────────────

export function calculateSpreads(
  debenturesFeed: DebentureFeedItem[],
  criCraFeed: CriCraFeedItem[],
  anbimaDataAssets: AnbimaDataAsset[],
  moodysRatings: MoodysWithId[],
  ntnbCurve: NtnbItem[]
): SpreadResult[] {
  // Indexar ANBIMA Data por código CETIP para lookup rápido
  const dataIndex = new Map<string, AnbimaDataAsset>();
  for (const a of anbimaDataAssets) {
    dataIndex.set(a.codigoCetip.toUpperCase(), a);
  }

  const results: SpreadResult[] = [];

  // Processar debêntures
  for (const deb of debenturesFeed) {
    const cetip = deb.codigo_ativo.toUpperCase();
    const dataAsset = dataIndex.get(cetip);

    const match = matchRatings(
      {
        codigoCetip: cetip,
        isin: dataAsset?.isin || null,
        emissorNome: dataAsset?.emissorNome || deb.emissor,
        numeroEmissao: dataAsset?.numeroEmissao != null ? String(dataAsset.numeroEmissao) : null,
      },
      moodysRatings
    );

    // Calcular Z-spread apenas para indexador IPCA+
    let ntnbRef: { codigo: string; taxa: number; duration: number } | null = null;
    const isIpca =
      deb.indexador?.toUpperCase().includes("IPCA") ||
      deb.remuneracao?.toUpperCase().includes("IPCA");

    if (isIpca && deb.durationAnos > 0) {
      ntnbRef = interpolateNtnb(deb.durationAnos, ntnbCurve);
    }

    const zspread =
      ntnbRef && deb.taxa_indicativa > 0
        ? Math.round((deb.taxa_indicativa - ntnbRef.taxa) * 1000000) / 1000000
        : null;

    results.push({
      codigoCetip: cetip,
      isin: dataAsset?.isin || null,
      tipo: "DEB",
      emissorNome: dataAsset?.emissorNome || deb.emissor,
      setor: dataAsset?.setor || "",
      indexador: deb.indexador || "",
      incentivado: dataAsset?.incentivado || false,
      rating: match?.rating || null,
      tipoMatch: match?.tipoMatch || "sem_match",
      moodysRatingId: match?.moodysId || null,
      taxaIndicativa: deb.taxa_indicativa,
      durationAnos: deb.durationAnos,
      dataReferencia: deb.data_referencia,
      ntnbReferencia: ntnbRef?.codigo || null,
      ntnbTaxa: ntnbRef?.taxa || null,
      ntnbDuration: ntnbRef?.duration || null,
      zspread,
    });
  }

  // Processar CRI/CRA
  for (const cri of criCraFeed) {
    const cetip = cri.codigo_ativo.toUpperCase();
    const dataAsset = dataIndex.get(cetip);

    const match = matchRatings(
      {
        codigoCetip: cetip,
        isin: dataAsset?.isin || null,
        emissorNome: dataAsset?.emissorNome || cri.emissor,
        numeroEmissao: dataAsset?.numeroEmissao != null ? String(dataAsset.numeroEmissao) : null,
      },
      moodysRatings
    );

    const isIpca =
      cri.indexador?.toUpperCase().includes("IPCA") ||
      cri.remuneracao?.toUpperCase().includes("IPCA");

    let ntnbRef: { codigo: string; taxa: number; duration: number } | null = null;
    if (isIpca && cri.durationAnos > 0) {
      ntnbRef = interpolateNtnb(cri.durationAnos, ntnbCurve);
    }

    const zspread =
      ntnbRef && cri.taxa_indicativa > 0
        ? Math.round((cri.taxa_indicativa - ntnbRef.taxa) * 1000000) / 1000000
        : null;

    results.push({
      codigoCetip: cetip,
      isin: dataAsset?.isin || null,
      tipo: cri.tipo,
      emissorNome: dataAsset?.emissorNome || cri.emissor,
      setor: dataAsset?.setor || "",
      indexador: cri.indexador || "",
      incentivado: dataAsset?.incentivado || false,
      rating: match?.rating || null,
      tipoMatch: match?.tipoMatch || "sem_match",
      moodysRatingId: match?.moodysId || null,
      taxaIndicativa: cri.taxa_indicativa,
      durationAnos: cri.durationAnos,
      dataReferencia: cri.data_referencia,
      ntnbReferencia: ntnbRef?.codigo || null,
      ntnbTaxa: ntnbRef?.taxa || null,
      ntnbDuration: ntnbRef?.duration || null,
      zspread,
    });
  }

  return results;
}
