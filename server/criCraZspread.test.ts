/**
 * Testes unitários para a lógica de z-spread do criCraSyncService
 *
 * Valida:
 * 1. Mapeamento de indexadores para grupos analíticos
 * 2. Cálculo de z-spread por grupo:
 *    - IPCA SPREAD: fórmula geométrica (1+taxa/100)/(1+NTN-B/100)−1 × 100 (% a.a.)
 *    - DI SPREAD: taxaIndicativa diretamente (% a.a.)
 *    - DI PERCENTUAL: taxaIndicativa − 100 (%)
 * 3. Interpolação linear da curva NTN-B
 *
 * Escala dos dados:
 *   - taxaIndicativa: % a.a. (ex: 7.9946 = 7,9946% a.a.)
 *   - taxaCorrecao: % a.a. (ex: 1.5 = 1,5% a.a. sobre CDI) — NÃO usado no cálculo
 *   - ntnbVertices.taxaIndicativa: % a.a. (ex: 6.80 = 6,80% a.a.)
 *   - zspread resultado: % a.a. para IPCA SPREAD e DI SPREAD
 *                        % do CDI acima de 100% para DI PERCENTUAL
 */

import { describe, it, expect } from "vitest";

// ── Funções extraídas do criCraSyncService para teste ────────────────────────

function mapIndexadorToGrupo(tipoRemuneracao: string): string | null {
  const t = tipoRemuneracao.toUpperCase().trim();
  if (t.includes("IPCA")) return "IPCA SPREAD";
  if (t.includes("DI") && t.includes("ADITIVO")) return "DI SPREAD";
  if (t.includes("DI") && t.includes("MULTIPLICATIVO")) return "DI PERCENTUAL";
  return null;
}

interface NtnbVertex {
  durationAnos: number;
  taxaIndicativa: number; // % a.a. (ex: 6.80 = 6,80% a.a.)
}

function interpolateNtnb(durationAnos: number, vertices: NtnbVertex[]): number | null {
  if (!vertices.length) return null;
  const sorted = [...vertices].sort((a, b) => a.durationAnos - b.durationAnos);
  if (durationAnos <= sorted[0].durationAnos) return sorted[0].taxaIndicativa;
  if (durationAnos >= sorted[sorted.length - 1].durationAnos) return sorted[sorted.length - 1].taxaIndicativa;
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
  const t = (durationAnos - lower.durationAnos) / (upper.durationAnos - lower.durationAnos);
  return lower.taxaIndicativa + t * (upper.taxaIndicativa - lower.taxaIndicativa);
}

function calcZspread(
  grupo: string,
  taxaIndicativa: number | null,
  taxaCorrecao: number | null,
  durationAnos: number | null,
  ntnbVertices: NtnbVertex[],
): { zspread: number | null; ntnbTaxa: number | null } {
  if (grupo === "IPCA SPREAD") {
    if (taxaIndicativa == null || durationAnos == null || ntnbVertices.length === 0) {
      return { zspread: null, ntnbTaxa: null };
    }
    const ntnbTaxa = interpolateNtnb(durationAnos, ntnbVertices);
    if (ntnbTaxa == null) return { zspread: null, ntnbTaxa: null };
    // Fórmula geométrica: (1 + taxaCRI/100) / (1 + taxaNTNB/100) − 1, resultado × 100 → % a.a.
    const zspread = ((1 + taxaIndicativa / 100) / (1 + ntnbTaxa / 100) - 1) * 100;
    return { zspread, ntnbTaxa };
  }
  if (grupo === "DI SPREAD") {
    // Usar taxaIndicativa diretamente (taxa de mercado do papel em % a.a.)
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null };
    return { zspread: taxaIndicativa, ntnbTaxa: null };
  }
  if (grupo === "DI PERCENTUAL") {
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null };
    return { zspread: taxaIndicativa - 100, ntnbTaxa: null };
  }
  return { zspread: null, ntnbTaxa: null };
}

// ── Curva NTN-B de exemplo (valores em % a.a.) ───────────────────────────────

const NTNB_VERTICES: NtnbVertex[] = [
  { durationAnos: 1.0, taxaIndicativa: 6.50 },
  { durationAnos: 3.0, taxaIndicativa: 6.80 },
  { durationAnos: 5.0, taxaIndicativa: 7.00 },
  { durationAnos: 10.0, taxaIndicativa: 7.30 },
];

// ── Testes de mapeamento de indexadores ──────────────────────────────────────

describe("mapIndexadorToGrupo", () => {
  it("mapeia IPCA para IPCA SPREAD", () => {
    expect(mapIndexadorToGrupo("IPCA")).toBe("IPCA SPREAD");
    expect(mapIndexadorToGrupo("IPCA SPREAD")).toBe("IPCA SPREAD");
    expect(mapIndexadorToGrupo("ipca")).toBe("IPCA SPREAD");
  });

  it("mapeia DI ADITIVO para DI SPREAD", () => {
    expect(mapIndexadorToGrupo("DI ADITIVO")).toBe("DI SPREAD");
    expect(mapIndexadorToGrupo("di aditivo")).toBe("DI SPREAD");
  });

  it("mapeia DI MULTIPLICATIVO para DI PERCENTUAL", () => {
    expect(mapIndexadorToGrupo("DI MULTIPLICATIVO")).toBe("DI PERCENTUAL");
    expect(mapIndexadorToGrupo("di multiplicativo")).toBe("DI PERCENTUAL");
  });

  it("retorna null para PRE FIXADO", () => {
    expect(mapIndexadorToGrupo("PRE FIXADO")).toBeNull();
    expect(mapIndexadorToGrupo("PRÉ FIXADO")).toBeNull();
  });

  it("retorna null para indexadores desconhecidos", () => {
    expect(mapIndexadorToGrupo("IGPM")).toBeNull();
    expect(mapIndexadorToGrupo("")).toBeNull();
  });
});

// ── Testes de interpolação NTN-B ─────────────────────────────────────────────

describe("interpolateNtnb", () => {
  it("retorna null para curva vazia", () => {
    expect(interpolateNtnb(3.0, [])).toBeNull();
  });

  it("retorna o menor vértice quando duration está abaixo do mínimo", () => {
    expect(interpolateNtnb(0.5, NTNB_VERTICES)).toBe(6.50);
  });

  it("retorna o maior vértice quando duration está acima do máximo", () => {
    expect(interpolateNtnb(15.0, NTNB_VERTICES)).toBe(7.30);
  });

  it("interpola corretamente entre 1a e 3a (ponto médio = 2a)", () => {
    const result = interpolateNtnb(2.0, NTNB_VERTICES);
    expect(result).toBeCloseTo(6.65, 4);
  });

  it("interpola corretamente entre 3a e 5a (ponto médio = 4a)", () => {
    const result = interpolateNtnb(4.0, NTNB_VERTICES);
    expect(result).toBeCloseTo(6.90, 4);
  });

  it("retorna o valor exato quando duration coincide com vértice", () => {
    expect(interpolateNtnb(5.0, NTNB_VERTICES)).toBe(7.00);
  });

  it("interpola corretamente entre 5a e 10a (ponto 75% = 8.75a)", () => {
    const result = interpolateNtnb(8.75, NTNB_VERTICES);
    expect(result).toBeCloseTo(7.225, 4);
  });
});

// ── Testes de cálculo de z-spread ────────────────────────────────────────────

describe("calcZspread — IPCA SPREAD (fórmula geométrica)", () => {
  it("calcula z-spread IPCA corretamente: fórmula geométrica", () => {
    // taxaIndicativa = 8.00% a.a., NTN-B interpolada para 3a = 6.80%
    // zspread = (1.0800 / 1.0680 − 1) × 100 = 1.1236% a.a.
    const { zspread, ntnbTaxa } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES);
    expect(ntnbTaxa).toBeCloseTo(6.80, 4);
    const expected = ((1.08 / 1.068) - 1) * 100;
    expect(zspread).toBeCloseTo(expected, 4);
  });

  it("calcula z-spread com dados reais da planilha (CRA021002NF)", () => {
    // taxaIndicativa = 7.9946% a.a., duration = 3.26a
    // NTN-B interpolada para 3.26a ≈ 6.826%
    // zspread = (1.079946 / 1.06826 − 1) × 100
    const { zspread, ntnbTaxa } = calcZspread("IPCA SPREAD", 7.9946, null, 3.26, NTNB_VERTICES);
    expect(ntnbTaxa).toBeCloseTo(6.826, 2);
    const ntnb = ntnbTaxa!;
    const expected = ((1 + 7.9946 / 100) / (1 + ntnb / 100) - 1) * 100;
    expect(zspread).toBeCloseTo(expected, 4);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", null, null, 3.0, NTNB_VERTICES);
    expect(zspread).toBeNull();
  });

  it("retorna null quando durationAnos é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 8.00, null, null, NTNB_VERTICES);
    expect(zspread).toBeNull();
  });

  it("retorna null quando curva NTN-B está vazia", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, []);
    expect(zspread).toBeNull();
  });

  it("z-spread negativo quando taxa < NTN-B (papel abaixo da curva)", () => {
    // taxaIndicativa = 6.00% < NTN-B 6.80% → zspread = (1.06/1.068 − 1) × 100 < 0
    const { zspread } = calcZspread("IPCA SPREAD", 6.00, null, 3.0, NTNB_VERTICES);
    expect(zspread).toBeLessThan(0);
    const expected = ((1.06 / 1.068) - 1) * 100;
    expect(zspread).toBeCloseTo(expected, 4);
  });

  it("z-spread alto para papel de rating baixo (taxa 14.73%)", () => {
    // taxaIndicativa = 14.73% a.a., duration 1.68a
    // NTN-B para 1.68a ≈ 6.602%
    // zspread = (1.1473 / 1.06602 − 1) × 100 ≈ 7.62% a.a.
    const { zspread } = calcZspread("IPCA SPREAD", 14.73, null, 1.68, NTNB_VERTICES);
    expect(zspread).toBeGreaterThan(6.0);
  });

  it("fórmula geométrica difere da subtração aritmética", () => {
    // Confirma que o resultado NÃO é simplesmente taxaIndicativa − ntnbTaxa
    const { zspread, ntnbTaxa } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES);
    const aritmetico = 8.00 - ntnbTaxa!;
    // Geométrico deve ser ligeiramente diferente (menor) que aritmético
    expect(zspread).not.toBeCloseTo(aritmetico, 3);
    expect(zspread).toBeLessThan(aritmetico);
  });
});

describe("calcZspread — DI SPREAD (usa taxaIndicativa)", () => {
  it("calcula z-spread DI SPREAD: usa taxaIndicativa diretamente", () => {
    // taxaIndicativa = 3.4896% a.a. → z-spread = 3.4896% a.a.
    const { zspread, ntnbTaxa } = calcZspread("DI SPREAD", 3.4896, 1.5, null, []);
    expect(ntnbTaxa).toBeNull();
    expect(zspread).toBeCloseTo(3.4896, 4);
  });

  it("ignora taxaCorrecao — usa apenas taxaIndicativa", () => {
    // taxaCorrecao = 1.5, taxaIndicativa = 3.49 → deve usar 3.49, não 1.5
    const { zspread } = calcZspread("DI SPREAD", 3.49, 1.5, null, []);
    expect(zspread).toBeCloseTo(3.49, 4);
    expect(zspread).not.toBeCloseTo(1.5, 1);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI SPREAD", null, 1.5, null, []);
    expect(zspread).toBeNull();
  });

  it("ignora ntnbVertices para DI SPREAD", () => {
    const { zspread } = calcZspread("DI SPREAD", 2.95, 0.95, null, NTNB_VERTICES);
    expect(zspread).toBeCloseTo(2.95, 4);
  });

  it("spread pequeno (taxa indicativa baixa)", () => {
    const { zspread } = calcZspread("DI SPREAD", 0.65, 0.30, null, []);
    expect(zspread).toBeCloseTo(0.65, 4);
  });
});

describe("calcZspread — DI PERCENTUAL", () => {
  it("calcula z-spread DI MULTIPLICATIVO: taxaIndicativa − 100", () => {
    const { zspread, ntnbTaxa } = calcZspread("DI PERCENTUAL", 108.694, null, null, []);
    expect(ntnbTaxa).toBeNull();
    expect(zspread).toBeCloseTo(8.694, 4);
  });

  it("z-spread zero quando papel rende exatamente 100% do CDI", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 100.0, null, null, []);
    expect(zspread).toBeCloseTo(0.0, 4);
  });

  it("z-spread negativo quando papel rende menos de 100% do CDI", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 96.0, null, null, []);
    expect(zspread).toBeCloseTo(-4.0, 4);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", null, null, null, []);
    expect(zspread).toBeNull();
  });

  it("ignora taxaCorrecao para DI PERCENTUAL", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 101.5, 0.5, null, []);
    expect(zspread).toBeCloseTo(1.5, 4);
  });
});

describe("calcZspread — grupo desconhecido", () => {
  it("retorna null para grupo desconhecido", () => {
    const { zspread, ntnbTaxa } = calcZspread("PRE FIXADO", 12.0, null, 3.0, NTNB_VERTICES);
    expect(zspread).toBeNull();
    expect(ntnbTaxa).toBeNull();
  });

  it("retorna null para grupo vazio", () => {
    const { zspread } = calcZspread("", 12.0, null, 3.0, NTNB_VERTICES);
    expect(zspread).toBeNull();
  });
});

describe("consistência com dados reais do banco", () => {
  it("CRA023000RT (IPCA SPREAD): taxa=10.9085, ntnb≈7.72 → zspread geométrico", () => {
    const vertices: NtnbVertex[] = [
      { durationAnos: 3.0, taxaIndicativa: 7.71 },
      { durationAnos: 4.0, taxaIndicativa: 7.73 },
    ];
    const { zspread, ntnbTaxa } = calcZspread("IPCA SPREAD", 10.9085, null, 3.26, vertices);
    expect(ntnbTaxa).toBeCloseTo(7.715, 1);
    // Geométrico: (1.109085 / 1.07715 − 1) × 100 ≈ 2.96% a.a.
    const expected = ((1.109085 / 1.07715) - 1) * 100;
    expect(zspread).toBeCloseTo(expected, 2);
  });

  it("23F1514014 (DI SPREAD): taxaIndicativa=3.4896 → zspread=3.4896% a.a.", () => {
    const { zspread } = calcZspread("DI SPREAD", 3.4896, 1.5, 1.84, []);
    expect(zspread).toBeCloseTo(3.4896, 4);
  });

  it("CRA025006NA (DI PERCENTUAL): taxaIndicativa=108.694 → zspread=8.694%", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 108.694, null, 2.96, []);
    expect(zspread).toBeCloseTo(8.694, 4);
  });
});
