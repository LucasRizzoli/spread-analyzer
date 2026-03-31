/**
 * Utilitários de ordenação de ratings e normalização de nomes de emissores.
 *
 * NOTA: As funções `calculateSpreads`, `matchRatings` e `interpolateNtnb` foram
 * removidas nesta versão pois são código morto — o sync atual usa `crossByEmissao`
 * e `markOutliers` definidos diretamente no syncService.ts.
 * Manter apenas o que é efetivamente importado por outros módulos.
 */

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

function normalizeEmissor(name: string): string {
  let n = normalizeString(name);
  for (const suffix of CORP_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suffix}\\b`, "g"), "").trim();
  }
  return n.replace(/\s+/g, " ").trim();
}

export function normalizeEmissorName(name: string): string {
  return normalizeEmissor(name);
}

export function extractEmissaoNumber(texto: string): number | null {
  const match = texto.match(/(\d+)[ªaº°]?\s*[Ee]miss[aã]o/) ||
    texto.match(/[Ee]miss[aã]o\s+(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ─── Tipos compartilhados ─────────────────────────────────────────────────────

export type TipoMatch = "emissao" | "emissor" | "sem_match";
