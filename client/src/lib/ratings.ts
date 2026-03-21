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
  return Array.from(new Set(ratings)).sort(
    (a, b) => getRatingOrder(a) - getRatingOrder(b)
  );
}
