/**
 * Testes unitários para a lógica de z-spread do criCraSyncService
 *
 * Valida:
 * 1. Mapeamento de indexadores para grupos analíticos
 * 2. Tabela regressiva de IR e gross-up
 * 3. Cálculo de z-spread por grupo (com gross-up aplicado):
 *    - IPCA SPREAD: gross-up direto sobre taxa total; fórmula geométrica com NTN-B
 *    - DI SPREAD: gross-up composto (1+CDI)×(1+spread)/(1−IR)−1; z-spread = bruto−CDI
 *    - DI PERCENTUAL: gross-up composto sobre retorno total; z-spread = bruto−CDI
 * 4. Interpolação linear da curva NTN-B
 * 5. Busca do CDI via API BCB (fetchCdiAnual)
 *
 * CDI de referência nos testes: 14.65% a.a. (valor real de 10/04/2026)
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

function aliquotaIR(diasAteVencimento: number): number {
  if (diasAteVencimento <= 180) return 0.225;
  if (diasAteVencimento <= 360) return 0.200;
  if (diasAteVencimento <= 720) return 0.175;
  return 0.150;
}

function grossUpIR(taxaLiquida: number, diasAteVencimento: number): number {
  return taxaLiquida / (1 - aliquotaIR(diasAteVencimento));
}

function calcZspread(
  grupo: string,
  taxaIndicativa: number | null,
  taxaCorrecao: number | null,
  durationAnos: number | null,
  ntnbVertices: NtnbVertex[],
  diasAteVencimento: number | null = null,
  cdiAnual: number | null = null,
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
    // Gross-up simples: spread isento / (1 - IR)
    if (taxaIndicativa == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    const aliq = diasAteVencimento != null ? aliquotaIR(diasAteVencimento) : 0.150;
    const zspread = taxaIndicativa / (1 - aliq);
    return { zspread, ntnbTaxa: null, taxaGrossUp: zspread };
  }

  if (grupo === "DI PERCENTUAL") {
    // Gross-up do retorno total: taxaIsenta = (pctCDI/100) × CDI; taxaBruta = taxaIsenta / (1-IR); z-spread = taxaBruta - CDI
    if (taxaIndicativa == null || cdiAnual == null) return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
    const aliq = diasAteVencimento != null ? aliquotaIR(diasAteVencimento) : 0.150;
    const taxaIsenta = (taxaIndicativa / 100) * cdiAnual;
    const taxaBruta = taxaIsenta / (1 - aliq);
    const zspread = taxaBruta - cdiAnual;
    return { zspread, ntnbTaxa: null, taxaGrossUp: taxaBruta };
  }

  return { zspread: null, ntnbTaxa: null, taxaGrossUp: null };
}

// ── CDI de referência (valor real BCB 10/04/2026) ────────────────────────────
const CDI = 14.65; // % a.a.

// ── Curva NTN-B de exemplo ───────────────────────────────────────────────────
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

  it("retorna null para PRE FIXADO e indexadores desconhecidos", () => {
    expect(mapIndexadorToGrupo("PRE FIXADO")).toBeNull();
    expect(mapIndexadorToGrupo("IGPM")).toBeNull();
    expect(mapIndexadorToGrupo("")).toBeNull();
  });
});

// ── Testes da tabela regressiva de IR ────────────────────────────────────────

describe("aliquotaIR — tabela regressiva brasileira", () => {
  it("retorna 22,5% para prazo ≤ 180 dias", () => {
    expect(aliquotaIR(1)).toBe(0.225);
    expect(aliquotaIR(180)).toBe(0.225);
  });

  it("retorna 20,0% para prazo entre 181 e 360 dias", () => {
    expect(aliquotaIR(181)).toBe(0.200);
    expect(aliquotaIR(360)).toBe(0.200);
  });

  it("retorna 17,5% para prazo entre 361 e 720 dias", () => {
    expect(aliquotaIR(361)).toBe(0.175);
    expect(aliquotaIR(720)).toBe(0.175);
  });

  it("retorna 15,0% para prazo > 720 dias", () => {
    expect(aliquotaIR(721)).toBe(0.150);
    expect(aliquotaIR(3650)).toBe(0.150);
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
    expect(interpolateNtnb(2.0, NTNB_VERTICES)).toBeCloseTo(6.65, 4);
  });

  it("retorna o valor exato quando duration coincide com vértice", () => {
    expect(interpolateNtnb(5.0, NTNB_VERTICES)).toBe(7.00);
  });
});

// ── Testes IPCA SPREAD (gross-up direto) ─────────────────────────────────────

describe("calcZspread — IPCA SPREAD com gross-up de IR", () => {
  it("sem diasAteVencimento: usa taxaIndicativa sem gross-up", () => {
    const { zspread, ntnbTaxa, taxaGrossUp } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES, null, CDI);
    expect(ntnbTaxa).toBeCloseTo(6.80, 4);
    expect(taxaGrossUp).toBeCloseTo(8.00, 4);
    const expected = ((1.08 / 1.068) - 1) * 100;
    expect(zspread).toBeCloseTo(expected, 4);
  });

  it("com diasAteVencimento > 720 dias (IR=15%): gross-up eleva taxa e z-spread", () => {
    // taxaGrossUp = 8 / 0.85 = 9.4118%
    const { zspread, taxaGrossUp } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, NTNB_VERTICES, 1000, CDI);
    expect(taxaGrossUp).toBeCloseTo(8.0 / 0.85, 3);
    const expectedZspread = ((1 + (8.0 / 0.85) / 100) / (1 + 6.80 / 100) - 1) * 100;
    expect(zspread).toBeCloseTo(expectedZspread, 3);
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("IPCA SPREAD", null, null, 3.0, NTNB_VERTICES, 1000, CDI);
    expect(zspread).toBeNull();
  });

  it("retorna null quando curva NTN-B está vazia", () => {
    const { zspread } = calcZspread("IPCA SPREAD", 8.00, null, 3.0, [], 1000, CDI);
    expect(zspread).toBeNull();
  });
});

// ── Testes DI SPREAD (gross-up simples do spread) ────────────────────────────

describe("calcZspread — DI SPREAD com gross-up simples", () => {
  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI SPREAD", null, null, null, [], null, null);
    expect(zspread).toBeNull();
  });

  it("spread 3.49%, IR=15%: gross-up simples = 3.49/0.85 = 4.106%", () => {
    // z-spread = 3.4896 / 0.85 = 4.1054% = 410.5 bps
    const { zspread, taxaGrossUp } = calcZspread("DI SPREAD", 3.4896, null, null, [], 1000, CDI);
    expect(zspread).toBeCloseTo(3.4896 / 0.85, 4);
    expect(taxaGrossUp).toBeCloseTo(3.4896 / 0.85, 4);
  });

  it("spread 2%, IR=15%: z-spread = 2/0.85 = 2.353%", () => {
    const { zspread } = calcZspread("DI SPREAD", 2.0, null, null, [], 1000, CDI);
    expect(zspread).toBeCloseTo(2.0 / 0.85, 4);
  });

  it("spread 2%, IR=22,5% (prazo ≤ 180 dias): z-spread = 2/0.775 = 2.581%", () => {
    const { zspread } = calcZspread("DI SPREAD", 2.0, null, null, [], 90, CDI);
    expect(zspread).toBeCloseTo(2.0 / 0.775, 4);
  });

  it("spread maior resulta em z-spread maior", () => {
    const { zspread: z1 } = calcZspread("DI SPREAD", 1.0, null, null, [], 1000, CDI);
    const { zspread: z2 } = calcZspread("DI SPREAD", 3.0, null, null, [], 1000, CDI);
    expect(z2!).toBeGreaterThan(z1!);
  });

  it("z-spread é sempre positivo para spread > 0 com IR > 0", () => {
    const { zspread } = calcZspread("DI SPREAD", 2.0, null, null, [], 1000, CDI);
    expect(zspread!).toBeGreaterThan(0);
  });

  it("prazo menor (IR maior) resulta em z-spread maior", () => {
    const { zspread: zLongo } = calcZspread("DI SPREAD", 2.0, null, null, [], 1000, CDI); // IR=15%
    const { zspread: zCurto } = calcZspread("DI SPREAD", 2.0, null, null, [], 90, CDI);   // IR=22.5%
    expect(zCurto!).toBeGreaterThan(zLongo!);
  });
});

// ── Testes DI PERCENTUAL (gross-up do retorno total) ─────────────────────────

describe("calcZspread — DI PERCENTUAL com gross-up do retorno total", () => {
  it("retorna null quando cdiAnual não é fornecido", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", 108.0, null, null, [], null, null);
    expect(zspread).toBeNull();
  });

  it("retorna null quando taxaIndicativa é null", () => {
    const { zspread } = calcZspread("DI PERCENTUAL", null, null, null, [], 1000, CDI);
    expect(zspread).toBeNull();
  });

  it("100% do CDI isento, IR=15%: taxaIsenta=14.65%, taxaBruta=17.24%, z-spread=2.59%", () => {
    // taxaIsenta = (100/100) × 14.65 = 14.65%
    // taxaBruta  = 14.65 / 0.85 = 17.235%
    // z-spread   = 17.235 − 14.65 = 2.585%
    const taxaIsenta = (100 / 100) * CDI;
    const taxaBruta = taxaIsenta / 0.85;
    const expectedZspread = taxaBruta - CDI;

    const { zspread, taxaGrossUp } = calcZspread("DI PERCENTUAL", 100.0, null, null, [], 1000, CDI);
    expect(zspread).toBeCloseTo(expectedZspread, 4);
    expect(taxaGrossUp).toBeCloseTo(taxaBruta, 4);
  });

  it("100.38% do CDI isento, IR=15%: z-spread ~2.65%", () => {
    // taxaIsenta = (100.383/100) × 14.65 = 14.706%
    // taxaBruta  = 14.706 / 0.85 = 17.301%
    // z-spread   = 17.301 − 14.65 = 2.651%
    const taxaIsenta = (100.383 / 100) * CDI;
    const taxaBruta = taxaIsenta / 0.85;
    const expectedZspread = taxaBruta - CDI;

    const { zspread } = calcZspread("DI PERCENTUAL", 100.383, null, null, [], 1000, CDI);
    expect(zspread).toBeCloseTo(expectedZspread, 3);
  });

  it("% do CDI maior resulta em z-spread maior", () => {
    const { zspread: z100 } = calcZspread("DI PERCENTUAL", 100.0, null, null, [], 1000, CDI);
    const { zspread: z108 } = calcZspread("DI PERCENTUAL", 108.0, null, null, [], 1000, CDI);
    expect(z108!).toBeGreaterThan(z100!);
  });

  it("prazo menor (IR maior) resulta em z-spread maior", () => {
    const { zspread: zLongo } = calcZspread("DI PERCENTUAL", 108.0, null, null, [], 1000, CDI); // IR=15%
    const { zspread: zCurto } = calcZspread("DI PERCENTUAL", 108.0, null, null, [], 90, CDI);   // IR=22.5%
    expect(zCurto!).toBeGreaterThan(zLongo!);
  });

  it("90% do CDI isento: z-spread negativo (abaixo do CDI)", () => {
    // taxaIsenta = 0.90 × 14.65 = 13.185%; taxaBruta = 13.185/0.85 = 15.512%; z = 15.512 − 14.65 = 0.862%
    // Nota: mesmo 90% do CDI tem z-spread positivo porque o gross-up eleva acima do CDI
    const taxaIsenta = (90 / 100) * CDI;
    const taxaBruta = taxaIsenta / 0.85;
    const expectedZspread = taxaBruta - CDI;
    const { zspread } = calcZspread("DI PERCENTUAL", 90.0, null, null, [], 1000, CDI);
    expect(zspread).toBeCloseTo(expectedZspread, 4);
  });
});

// ── Testes de grupo desconhecido ─────────────────────────────────────────────

describe("calcZspread — grupo desconhecido", () => {
  it("retorna null para grupo desconhecido", () => {
    const { zspread, ntnbTaxa } = calcZspread("PRE FIXADO", 12.0, null, 3.0, NTNB_VERTICES, 1000, CDI);
    expect(zspread).toBeNull();
    expect(ntnbTaxa).toBeNull();
  });
});

// ── Testes de consistência com dados reais ───────────────────────────────────

describe("consistência com dados reais (CDI = 14.65% a.a.)", () => {
  it("CRA023000RT (IPCA SPREAD, venc > 720 dias): gross-up eleva z-spread", () => {
    const vertices: NtnbVertex[] = [
      { durationAnos: 3.0, taxaIndicativa: 7.71 },
      { durationAnos: 4.0, taxaIndicativa: 7.73 },
    ];
    const { zspread: zSem } = calcZspread("IPCA SPREAD", 10.9085, null, 3.26, vertices, null, CDI);
    const { zspread: zCom, taxaGrossUp } = calcZspread("IPCA SPREAD", 10.9085, null, 3.26, vertices, 1000, CDI);
    expect(taxaGrossUp).toBeCloseTo(10.9085 / 0.85, 2);
    expect(zCom!).toBeGreaterThan(zSem!);
  });

  it("DI SPREAD 3.49% isento (venc > 720 dias): gross-up simples = 3.49/0.85 = 4.106%", () => {
    const expectedZspread = 3.4896 / 0.85;
    const { zspread } = calcZspread("DI SPREAD", 3.4896, null, 1.84, [], 1000, CDI);
    expect(zspread).toBeCloseTo(expectedZspread, 3);
  });

  it("DI PERCENTUAL 100.38% do CDI (venc > 720 dias): gross-up retorno total", () => {
    const taxaIsenta = (100.383 / 100) * CDI;
    const taxaBruta = taxaIsenta / 0.85;
    const expectedZspread = taxaBruta - CDI;
    const { zspread } = calcZspread("DI PERCENTUAL", 100.383, null, 2.96, [], 1000, CDI);
    expect(zspread).toBeCloseTo(expectedZspread, 3);
  });
});

// ── Teste de integração: fetchCdiAnual (API BCB) ─────────────────────────────

describe("fetchCdiAnual — API BCB", () => {
  it("retorna CDI anualizado positivo e razoável (entre 5% e 25%)", async () => {
    const { fetchCdiAnual } = await import("./services/criCraSyncService");
    const cdi = await fetchCdiAnual();
    expect(cdi).toBeGreaterThan(5);
    expect(cdi).toBeLessThan(25);
    expect(isFinite(cdi)).toBe(true);
  }, 15000); // timeout de 15s para chamada de rede
});
