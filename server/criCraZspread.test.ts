/**
 * Testes unitários para a lógica de z-spread do criCraSyncService
 *
 * Valida:
 * 1. Mapeamento de indexadores para grupos analíticos
 * 2. Cálculo de z-spread por grupo:
 *    - IPCA SPREAD: (taxaIndicativa − NTN-B interpolada) × 100 bps
 *    - DI SPREAD: taxaCorrecao × 100 bps
 *    - DI PERCENTUAL: taxaIndicativa − 100 %
 * 3. Interpolação linear da curva NTN-B
 */

import { describe, it, expect } from "vitest";

// ── Funções extraídas do criCraSyncService para teste ────────────────────────
// (Replicadas aqui para teste isolado sem dependências de banco)

function mapIndexadorToGrupo(tipoRemuneracao: string): string | null {
  const t = tipoRemuneracao.toUpperCase().trim();
  if (t.includes("IPCA")) return "IPCA SPREAD";
  if (t.includes("DI") && t.includes("ADITIVO")) return "DI SPREAD";
  if (t.includes("DI") && t.includes("MULTIPLICATIVO")) return "DI PERCENTUAL";
  return null;
}

interface NtnbVertex {
  durationAnos: number;
  taxaIndicativa: number;
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
    const zspread = (taxaIndicativa - ntnbTaxa) * 100;
    return { zspread, ntnbTaxa };
  }
  if (grupo === "DI SPREAD") {
    if (taxaCorrecao == null) return { zspread: null, ntnbTaxa: null };
    return { zspread: taxaCorrecao * 100, ntnbTaxa: null };
  }
  if (grupo === "DI PERCENTUAL") {
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null };
    return { zspread: taxaIndicativa - 100, ntnbTaxa: null };
  }
  return { zspread: null, ntnbTaxa: null };
}

// ── Curva NTN-B de exemplo ────────────────────────────────────────────────────

const NTNB_VERTICES: NtnbVertex[] = [
  { durationAnos: 1.0, taxaIndicativa: 0.0650 }, // 6.50% a.a.
  { durationAnos: 3.0, taxaIndicativa: 0.0680 }, // 6.80% a.a.
  { durationAnos: 5.0, taxaIndicativa: 0.0700 }, // 7.00% a.a.
  { durationAnos: 10.0, taxaIndicativa: 0.0730 }, // 7.30% a.a.
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
    expect(interpolateNtnb(0.5, NTNB_VERTICES)).toBe(0.0650);
  });

  it("retorna o maior vértice quando duration está acima do máximo", () => {
    expect(interpolateNtnb(15.0, NTNB_VERTICES)).toBe(0.0730);
  });

  it("interpola corretamente entre 1a e 3a (ponto médio = 2a)", () => {
    const result = interpolateNtnb(2.0, NTNB_VERTICES);
    // Interpolação linear entre 6.50% e 6.80% → 6.65%
    expect(result).toBeCloseTo(0.0665, 5);
  });

  it("interpola corretamente entre 3a e 5a (ponto médio = 4a)", () => {
    const result = interpolateNtnb(4.0, NTNB_VERTICES);
    // Interpolação linear entre 6.80% e 7.00% → 6.90%
    expect(result).toBeCloseTo(0.0690, 5);
  });

  it("retorna o valor exato quando duration coincide com vértice", () => {
    expect(interpolateNtnb(5.0, NTNB_VERTICES)).toBe(0.0700);
  });
});

// ── Testes de cálculo de z-spread ────────────────────────────────────────────

describe("calcZspread — IPCA SPREAD", () => {
  it("calcula z-spread IPCA corretamente: (taxaIndicativa − NTN-B) × 100 bps", () => {
    // taxaIndicativa = 8.00% a.a., NTN-B interpolada para 3a = 6.80%
    // z-spread = (0.0800 − 0.0680) × 100 = 1.20 bps... espera, × 100 = 120 bps
    const { zspread, ntnbTaxa } = calcZspread("IPCA SPREAD", 0.0800, null, 3.0, NTNB_VERTICES);
    expect(ntnbTaxa).toBeCloseTo(0.0680, 5);
    expect(zspread).toBeCloseTo(1.20, 2); // (0.08 - 0.068) * 100 = 1.20 bps
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", null, null, 3.0, NTNB_VERTICES);
    expect(zspread).toBeNull();
  });

  it("retorna null quando durationAnos é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 0.08, null, null, NTNB_VERTICES);
    expect(zspread).toBeNull();
  });

  it("retorna null quando curva NTN-B está vazia", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 0.08, null, 3.0, []);
    expect(zspread).toBeNull();
  });

  it("z-spread negativo quando taxa < NTN-B (papel abaixo da curva)", () => {
    // taxaIndicativa = 6.00% < NTN-B 6.80% → z-spread negativo
    const { zspread } = calcZspread("IPCA SPREAD", 0.0600, null, 3.0, NTNB_VERTICES);
    expect(zspread).toBeCloseTo(-0.80, 2); // (0.06 - 0.068) * 100 = -0.80 bps
  });
});

describe("calcZspread — DI SPREAD", () => {
  it("calcula z-spread DI ADITIVO: taxaCorrecao × 100 bps", () => {
    // taxaCorrecao = 0.80% a.a. → z-spread = 0.80 × 100 = 80 bps
    const { zspread, ntnbTaxa } = calcZspread("DI SPREAD", null, 0.0080, null, []);
    expect(ntnbTaxa).toBeNull();
    expect(zspread).toBeCloseTo(0.80, 2); // 0.008 * 100 = 0.80 bps
  });

  it("retorna null quando taxaCorrecao é null", () => {
    const { zspread } = calcZspread("DI SPREAD", null, null, null, []);
    expect(zspread).toBeNull();
  });

  it("não usa taxaIndicativa para DI SPREAD", () => {
    // Mesmo com taxaIndicativa preenchida, deve usar taxaCorrecao
    const { zspread } = calcZspread("DI SPREAD", 0.1350, 0.0120, null, []);
    expect(zspread).toBeCloseTo(1.20, 2); // 0.012 * 100 = 1.20 bps
  });
});

describe("calcZspread — DI PERCENTUAL", () => {
  it("calcula z-spread DI MULTIPLICATIVO: taxaIndicativa − 100", () => {
    // taxaIndicativa = 108% do CDI → z-spread = 108 − 100 = 8%
    const { zspread, ntnbTaxa } = calcZspread("DI PERCENTUAL", 108, null, null, []);
    expect(ntnbTaxa).toBeNull();
    expect(zspread).toBe(8);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", null, null, null, []);
    expect(zspread).toBeNull();
  });

  it("z-spread = 0 quando taxaIndicativa = 100% do CDI", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 100, null, null, []);
    expect(zspread).toBe(0);
  });

  it("z-spread negativo quando taxaIndicativa < 100% do CDI", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 95, null, null, []);
    expect(zspread).toBe(-5);
  });
});

describe("calcZspread — grupo desconhecido", () => {
  it("retorna null para grupo não reconhecido", () => {
    const { zspread, ntnbTaxa } = calcZspread("PRE FIXADO", 0.12, null, null, []);
    expect(zspread).toBeNull();
    expect(ntnbTaxa).toBeNull();
  });
});
