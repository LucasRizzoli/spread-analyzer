/**
 * Testes unitários para a lógica de z-spread do criCraSyncService
 *
 * Valida:
 * 1. Mapeamento de indexadores para grupos analíticos
 * 2. Tabela regressiva de IR e gross-up (apenas CRI/CRA)
 * 3. Cálculo de z-spread por grupo (com gross-up aplicado):
 *    - IPCA SPREAD: fórmula geométrica com taxaGrossUp
 *    - DI SPREAD: taxaGrossUp diretamente (% a.a.)
 *    - DI PERCENTUAL: taxaIndicativa − 100 (sem gross-up)
 * 4. Interpolação linear da curva NTN-B
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

// ── Tabela regressiva de IR ──────────────────────────────────────────────────

function aliquotaIR(diasAteVencimento: number): number {
  if (diasAteVencimento <= 180) return 0.225;
  if (diasAteVencimento <= 360) return 0.200;
  if (diasAteVencimento <= 720) return 0.175;
  return 0.150;
}

function grossUpIR(taxaLiquida: number, diasAteVencimento: number): number {
  const aliq = aliquotaIR(diasAteVencimento);
  return taxaLiquida / (1 - aliq);
}

// ── calcZspread com gross-up ─────────────────────────────────────────────────

function calcZspread(
  grupo: string,
  taxaIndicativa: number | null,
  taxaCorrecao: number | null,
  durationAnos: number | null,
  ntnbVertices: NtnbVertex[],
  diasAteVencimento: number | null = null,
): { zspread: number | null; ntnbTaxa: number | null; taxaGrossUp: number | null } {
  if (grupo === "IPCA SPREAD") {
    if (taxaIndicativa == null || durationAnos == null || ntnbVertices.length === 0) {
      return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    }
    const ntnbTaxa = interpolateNtnb(durationAnos, ntnbVertices);
    if (ntnbTaxa == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    const taxaGrossUp = diasAteVencimento != null
      ? grossUpIR(taxaIndicativa, diasAteVencimento)
      : taxaIndicativa;
    const zspread = ((1 + taxaGrossUp / 100) / (1 + ntnbTaxa / 100) - 1) * 100;
    return { zspread, ntnbTaxa, taxaGrossUp };
  }
  if (grupo === "DI SPREAD") {
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    const taxaGrossUp = diasAteVencimento != null
      ? grossUpIR(taxaIndicativa, diasAteVencimento)
      : taxaIndicativa;
    return { zspread: taxaGrossUp, ntnbTaxa: null, taxaGrossUp };
  }
  if (grupo === "DI PERCENTUAL") {
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    return { zspread: taxaIndicativa - 100, ntnbTaxa: null, taxaGrossUp: null };
  }
  return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
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

// ── Testes da tabela regressiva de IR ────────────────────────────────────────

describe("aliquotaIR — tabela regressiva brasileira", () => {
  it("retorna 22,5% para prazo ≤ 180 dias", () => {
    expect(aliquotaIR(1)).toBe(0.225);
    expect(aliquotaIR(90)).toBe(0.225);
    expect(aliquotaIR(180)).toBe(0.225);
  });

  it("retorna 20,0% para prazo entre 181 e 360 dias", () => {
    expect(aliquotaIR(181)).toBe(0.200);
    expect(aliquotaIR(270)).toBe(0.200);
    expect(aliquotaIR(360)).toBe(0.200);
  });

  it("retorna 17,5% para prazo entre 361 e 720 dias", () => {
    expect(aliquotaIR(361)).toBe(0.175);
    expect(aliquotaIR(540)).toBe(0.175);
    expect(aliquotaIR(720)).toBe(0.175);
  });

  it("retorna 15,0% para prazo > 720 dias", () => {
    expect(aliquotaIR(721)).toBe(0.150);
    expect(aliquotaIR(1000)).toBe(0.150);
    expect(aliquotaIR(3650)).toBe(0.150);
  });
});

describe("grossUpIR — cálculo do gross-up", () => {
  it("gross-up correto para prazo > 720 dias (IR = 15%): 8% → 9.4118%", () => {
    // 8 / (1 - 0.15) = 8 / 0.85 = 9.4118%
    expect(grossUpIR(8.0, 1000)).toBeCloseTo(9.4118, 3);
  });

  it("gross-up correto para prazo ≤ 180 dias (IR = 22,5%): 8% → 10.3226%", () => {
    // 8 / (1 - 0.225) = 8 / 0.775 = 10.3226%
    expect(grossUpIR(8.0, 90)).toBeCloseTo(10.3226, 3);
  });

  it("gross-up correto para prazo 181-360 dias (IR = 20%): 8% → 10.0%", () => {
    // 8 / (1 - 0.20) = 8 / 0.80 = 10.0%
    expect(grossUpIR(8.0, 270)).toBeCloseTo(10.0, 4);
  });

  it("gross-up correto para prazo 361-720 dias (IR = 17,5%): 8% → 9.6970%", () => {
    // 8 / (1 - 0.175) = 8 / 0.825 = 9.6970%
    expect(grossUpIR(8.0, 500)).toBeCloseTo(9.6970, 3);
  });

  it("gross-up é sempre maior que a taxa original", () => {
    expect(grossUpIR(5.0, 100)).toBeGreaterThan(5.0);
    expect(grossUpIR(5.0, 300)).toBeGreaterThan(5.0);
    expect(grossUpIR(5.0, 500)).toBeGreaterThan(5.0);
    expect(grossUpIR(5.0, 1000)).toBeGreaterThan(5.0);
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

// ── Testes de z-spread com gross-up (IPCA SPREAD) ────────────────────────────

describe("calcZspread — IPCA SPREAD com gross-up de IR", () => {
  it("sem diasAteVencimento: usa taxaIndicativa diretamente (sem gross-up)", () => {
    // Comportamento legado: sem diasAteVencimento, não aplica gross-up
    const { zspread, ntnbTaxa, taxaGrossUp } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES, null);
    expect(ntnbTaxa).toBeCloseTo(6.80, 4);
    expect(taxaGrossUp).toBeCloseTo(8.00, 4); // sem gross-up, igual à taxa original
    const expected = ((1.08 / 1.068) - 1) * 100;
    expect(zspread).toBeCloseTo(expected, 4);
  });

  it("com diasAteVencimento > 720 dias (IR=15%): gross-up eleva a taxa e o z-spread", () => {
    // taxaIndicativa = 8.00%, IR = 15% → taxaGrossUp = 8/0.85 = 9.4118%
    // zspread = (1.094118 / 1.068 − 1) × 100
    const { zspread, ntnbTaxa, taxaGrossUp } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES, 1000);
    expect(ntnbTaxa).toBeCloseTo(6.80, 4);
    expect(taxaGrossUp).toBeCloseTo(8.0 / 0.85, 3);
    const expectedGrossUp = 8.0 / 0.85;
    const expectedZspread = ((1 + expectedGrossUp / 100) / (1 + 6.80 / 100) - 1) * 100;
    expect(zspread).toBeCloseTo(expectedZspread, 3);
    // z-spread com gross-up deve ser maior que sem gross-up
    const { zspread: zspreadSemGrossUp } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES, null);
    expect(zspread!).toBeGreaterThan(zspreadSemGrossUp!);
  });

  it("com diasAteVencimento ≤ 180 dias (IR=22,5%): gross-up máximo", () => {
    // taxaIndicativa = 8.00%, IR = 22.5% → taxaGrossUp = 8/0.775 = 10.3226%
    const { taxaGrossUp } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES, 90);
    expect(taxaGrossUp).toBeCloseTo(8.0 / 0.775, 3);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", null, null, 3.0, NTNB_VERTICES, 1000);
    expect(zspread).toBeNull();
  });

  it("retorna null quando durationAnos é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 8.00, null, null, NTNB_VERTICES, 1000);
    expect(zspread).toBeNull();
  });

  it("retorna null quando curva NTN-B está vazia", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, [], 1000);
    expect(zspread).toBeNull();
  });

  it("z-spread negativo quando taxa gross-up < NTN-B", () => {
    // taxaIndicativa = 5.00%, IR = 15% → taxaGrossUp = 5/0.85 = 5.882% < NTN-B 6.80%
    const { zspread } = calcZspread("IPCA SPREAD", 5.00, null, 3.0, NTNB_VERTICES, 1000);
    expect(zspread).toBeLessThan(0);
  });
});

// ── Testes de z-spread com gross-up (DI SPREAD) ──────────────────────────────

describe("calcZspread — DI SPREAD com gross-up de IR", () => {
  it("sem diasAteVencimento: usa taxaIndicativa diretamente (sem gross-up)", () => {
    const { zspread, taxaGrossUp } = calcZspread("DI SPREAD", 3.4896, 1.5, null, [], null);
    expect(zspread).toBeCloseTo(3.4896, 4);
    expect(taxaGrossUp).toBeCloseTo(3.4896, 4);
  });

  it("com diasAteVencimento > 720 dias (IR=15%): gross-up eleva o spread", () => {
    // taxaIndicativa = 3.4896%, IR = 15% → taxaGrossUp = 3.4896/0.85 = 4.1054%
    const { zspread, taxaGrossUp } = calcZspread("DI SPREAD", 3.4896, 1.5, null, [], 1000);
    const expectedGrossUp = 3.4896 / 0.85;
    expect(taxaGrossUp).toBeCloseTo(expectedGrossUp, 3);
    expect(zspread).toBeCloseTo(expectedGrossUp, 3);
    // Deve ser maior que sem gross-up
    expect(zspread!).toBeGreaterThan(3.4896);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI SPREAD", null, 1.5, null, [], 1000);
    expect(zspread).toBeNull();
  });

  it("ignora taxaCorrecao — usa apenas taxaIndicativa (com gross-up)", () => {
    const { zspread } = calcZspread("DI SPREAD", 3.49, 1.5, null, [], 1000);
    // Deve ser gross-up de 3.49, não de 1.5
    expect(zspread).toBeCloseTo(3.49 / 0.85, 3);
    expect(zspread).not.toBeCloseTo(1.5, 1);
  });
});

// ── Testes de z-spread DI PERCENTUAL (sem gross-up) ──────────────────────────

describe("calcZspread — DI PERCENTUAL (sem gross-up)", () => {
  it("calcula z-spread DI MULTIPLICATIVO: taxaIndicativa − 100 (sem gross-up)", () => {
    const { zspread, ntnbTaxa, taxaGrossUp } = calcZspread("DI PERCENTUAL", 108.694, null, null, [], 1000);
    expect(ntnbTaxa).toBeNull();
    expect(taxaGrossUp).toBeNull(); // DI PERCENTUAL não aplica gross-up
    expect(zspread).toBeCloseTo(8.694, 4);
  });

  it("diasAteVencimento não afeta DI PERCENTUAL", () => {
    const { zspread: z1 } = calcZspread("DI PERCENTUAL", 108.694, null, null, [], 90);
    const { zspread: z2 } = calcZspread("DI PERCENTUAL", 108.694, null, null, [], 1000);
    expect(z1).toBeCloseTo(z2!, 4); // Mesmo resultado independente do prazo
  });

  it("z-spread zero quando papel rende exatamente 100% do CDI", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 100.0, null, null, [], 1000);
    expect(zspread).toBeCloseTo(0.0, 4);
  });

  it("z-spread negativo quando papel rende menos de 100% do CDI", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 96.0, null, null, [], 1000);
    expect(zspread).toBeCloseTo(-4.0, 4);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", null, null, null, [], 1000);
    expect(zspread).toBeNull();
  });
});

describe("calcZspread — grupo desconhecido", () => {
  it("retorna null para grupo desconhecido", () => {
    const { zspread, ntnbTaxa } = calcZspread("PRE FIXADO", 12.0, null, 3.0, NTNB_VERTICES, 1000);
    expect(zspread).toBeNull();
    expect(ntnbTaxa).toBeNull();
  });

  it("retorna null para grupo vazio", () => {
    const { zspread } = calcZspread("", 12.0, null, 3.0, NTNB_VERTICES, 1000);
    expect(zspread).toBeNull();
  });
});

describe("consistência com dados reais do banco (com gross-up)", () => {
  it("CRA023000RT (IPCA SPREAD, venc > 720 dias): gross-up eleva z-spread vs sem gross-up", () => {
    const vertices: NtnbVertex[] = [
      { durationAnos: 3.0, taxaIndicativa: 7.71 },
      { durationAnos: 4.0, taxaIndicativa: 7.73 },
    ];
    const { zspread: zSem } = calcZspread("IPCA SPREAD", 10.9085, null, 3.26, vertices, null);
    const { zspread: zCom, taxaGrossUp } = calcZspread("IPCA SPREAD", 10.9085, null, 3.26, vertices, 1000);
    // Com gross-up (IR=15%): taxaGrossUp = 10.9085/0.85 = 12.833%
    expect(taxaGrossUp).toBeCloseTo(10.9085 / 0.85, 2);
    expect(zCom!).toBeGreaterThan(zSem!);
  });

  it("23F1514014 (DI SPREAD, venc > 720 dias): gross-up eleva spread", () => {
    const { zspread, taxaGrossUp } = calcZspread("DI SPREAD", 3.4896, 1.5, 1.84, [], 1000);
    expect(taxaGrossUp).toBeCloseTo(3.4896 / 0.85, 3);
    expect(zspread).toBeCloseTo(3.4896 / 0.85, 3);
  });

  it("CRA025006NA (DI PERCENTUAL): gross-up NÃO aplicado mesmo com diasAteVencimento", () => {
    const { zspread, taxaGrossUp } = calcZspread("DI PERCENTUAL", 108.694, null, 2.96, [], 1000);
    expect(taxaGrossUp).toBeNull();
    expect(zspread).toBeCloseTo(8.694, 4);
  });
});
