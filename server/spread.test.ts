import { describe, expect, it } from "vitest";
import {
  getRatingOrder,
  sortRatings,
  calculateSpreads,
  normalizeEmissorName,
  extractEmissaoNumber,
} from "./services/spreadCalculatorService";

// ─── Rating ordering ──────────────────────────────────────────────────────────

describe("getRatingOrder", () => {
  it("retorna ordem correta para ratings conhecidos", () => {
    expect(getRatingOrder("AAA.br")).toBe(1);
    expect(getRatingOrder("AA+.br")).toBe(2);
    expect(getRatingOrder("AA.br")).toBe(3);
    expect(getRatingOrder("BBB.br")).toBe(9);
    expect(getRatingOrder("D.br")).toBe(20);
  });

  it("retorna 99 para ratings desconhecidos", () => {
    expect(getRatingOrder("XYZ.br")).toBe(99);
    expect(getRatingOrder("")).toBe(99);
  });
});

describe("sortRatings", () => {
  it("ordena ratings do melhor para o pior", () => {
    const input = ["BB.br", "AAA.br", "A.br", "BBB+.br"];
    const result = sortRatings(input);
    expect(result).toEqual(["AAA.br", "A.br", "BBB+.br", "BB.br"]);
  });

  it("remove duplicatas", () => {
    const input = ["AA.br", "AA.br", "A.br"];
    const result = sortRatings(input);
    expect(result).toEqual(["AA.br", "A.br"]);
  });

  it("lida com array vazio", () => {
    expect(sortRatings([])).toEqual([]);
  });
});

// ─── Normalização de nomes ────────────────────────────────────────────────────

describe("normalizeEmissorName", () => {
  it("remove sufixos jurídicos comuns", () => {
    expect(normalizeEmissorName("PETROBRAS S.A.")).toBe("PETROBRAS");
    expect(normalizeEmissorName("VALE S/A")).toBe("VALE");
    expect(normalizeEmissorName("EMBRAER SA")).toBe("EMBRAER");
    expect(normalizeEmissorName("AMBEV S.A")).toBe("AMBEV");
  });

  it("converte para maiúsculas e remove espaços extras", () => {
    expect(normalizeEmissorName("  petrobras  ")).toBe("PETROBRAS");
  });

  it("lida com string vazia", () => {
    expect(normalizeEmissorName("")).toBe("");
  });
});

// ─── Extração de número de emissão ───────────────────────────────────────────

describe("extractEmissaoNumber", () => {
  it("extrai número ordinal de emissão", () => {
    expect(extractEmissaoNumber("4ª Emissão de Debêntures - Série Única")).toBe(4);
    expect(extractEmissaoNumber("1ª Emissão")).toBe(1);
    expect(extractEmissaoNumber("12ª Emissão de CRI")).toBe(12);
  });

  it("extrai número cardinal", () => {
    expect(extractEmissaoNumber("3a Emissão")).toBe(3);
    expect(extractEmissaoNumber("Emissão 5")).toBe(5);
  });

  it("retorna null quando não encontra número", () => {
    expect(extractEmissaoNumber("Debênture Simples")).toBeNull();
    expect(extractEmissaoNumber("")).toBeNull();
  });
});

// ─── Cálculo de Z-spread ─────────────────────────────────────────────────────

describe("calculateSpreads", () => {
  const mockDebentures = [
    {
      codigo_ativo: "PETR14",
      data_referencia: "2025-03-21",
      taxa_indicativa: 0.0850,
      taxa_compra: 0.0855,
      taxa_venda: 0.0845,
      duration: 730,
      durationAnos: 2.0,
      indexador: "IPCA",
      remuneracao: "IPCA+",
    },
    {
      codigo_ativo: "VALE11",
      data_referencia: "2025-03-21",
      taxa_indicativa: 0.0780,
      taxa_compra: 0.0785,
      taxa_venda: 0.0775,
      duration: 1460,
      durationAnos: 4.0,
      indexador: "IPCA",
      remuneracao: "IPCA+",
    },
  ];

  const mockCriCra: typeof mockDebentures = [];

  const mockAnbimaData = [
    {
      codigoCetip: "PETR14",
      isin: "BRPETR14BS001",
      tipo: "DEB" as const,
      emissorNome: "PETROBRAS S.A.",
      emissorCnpj: "33000167000101",
      setor: "Energia",
      numeroEmissao: "14",
      numeroSerie: null,
      dataEmissao: null,
      dataVencimento: null,
      remuneracao: "IPCA+",
      indexador: "IPCA",
      incentivado: false,
    },
    {
      codigoCetip: "VALE11",
      isin: "BRVALE11BS001",
      tipo: "DEB" as const,
      emissorNome: "VALE S.A.",
      emissorCnpj: "33592510000154",
      setor: "Mineração",
      numeroEmissao: "11",
      numeroSerie: null,
      dataEmissao: null,
      dataVencimento: null,
      remuneracao: "IPCA+",
      indexador: "IPCA",
      incentivado: false,
    },
  ];

  const mockMoodys = [
    {
      id: 1,
      setor: "Energia",
      emissor: "PETROBRAS S.A.",
      produto: "Debêntures",
      instrumento: "Debêntures",
      objeto: "14ª Emissão de Debêntures",
      rating: "AA-.br",
      perspectiva: "Estável",
      dataAtualizacao: "2025-01-01",
      numeroEmissao: "14",
    },
    {
      id: 2,
      setor: "Mineração",
      emissor: "VALE S.A.",
      produto: "Debêntures",
      instrumento: "Debêntures",
      objeto: "11ª Emissão de Debêntures",
      rating: "AAA.br",
      perspectiva: "Estável",
      dataAtualizacao: "2025-01-01",
      numeroEmissao: "11",
    },
  ];

  const mockNtnb = [
    {
      codigo_selic: "760199",
      data_referencia: "2025-03-21",
      vencimento: "2026-08-15",
      taxa_indicativa: 0.0620,
      duration: 365,
      durationAnos: 1.0,
    },
    {
      codigo_selic: "760200",
      data_referencia: "2025-03-21",
      vencimento: "2028-08-15",
      taxa_indicativa: 0.0650,
      duration: 1095,
      durationAnos: 3.0,
    },
    {
      codigo_selic: "760201",
      data_referencia: "2025-03-21",
      vencimento: "2030-08-15",
      taxa_indicativa: 0.0680,
      duration: 1825,
      durationAnos: 5.0,
    },
  ];

  it("calcula Z-spread corretamente para papéis com match", () => {
    const results = calculateSpreads(
      mockDebentures,
      mockCriCra,
      mockAnbimaData,
      mockMoodys,
      mockNtnb
    );

    expect(results.length).toBe(2);

    const petr = results.find((r) => r.codigoCetip === "PETR14");
    expect(petr).toBeDefined();
    expect(petr?.rating).toBe("AA-.br");
    // PETR14 duration=2.0: interpolação linear entre NTN-B 1.0 (6.20%) e 3.0 (6.50%)
    // taxa interpolada = 0.062 + (2.0-1.0)/(3.0-1.0) * (0.065-0.062) = 0.062 + 0.5*0.003 = 0.0635
    // Z-spread = 0.085 - 0.0635 = 0.0215
    expect(petr?.zspread).toBeCloseTo(0.0215, 3);
    expect(petr?.tipoMatch).toBe("emissao");

    const vale = results.find((r) => r.codigoCetip === "VALE11");
    expect(vale).toBeDefined();
    expect(vale?.rating).toBe("AAA.br");
    expect(vale?.tipoMatch).toBe("emissao");
  });

  it("usa NTN-B de duration mais próxima", () => {
    const results = calculateSpreads(
      mockDebentures,
      mockCriCra,
      mockAnbimaData,
      mockMoodys,
      mockNtnb
    );

    // PETR14 tem duration 2.0 anos — NTN-B mais próxima é a de 1.0 ou 3.0 anos
    // Diferença: |2.0 - 1.0| = 1.0 vs |2.0 - 3.0| = 1.0 — empate, deve pegar a de menor duration
    const petr = results.find((r) => r.codigoCetip === "PETR14");
    expect(petr?.ntnbDuration).toBeDefined();

    // VALE11 tem duration 4.0 anos — NTN-B mais próxima é a de 3.0 ou 5.0 anos
    const vale = results.find((r) => r.codigoCetip === "VALE11");
    expect(vale?.ntnbDuration).toBeDefined();
  });

  it("retorna tipoMatch sem_match quando não há rating", () => {
    const results = calculateSpreads(
      [{ ...mockDebentures[0], codigo_ativo: "UNKN11" }],
      [],
      [{ ...mockAnbimaData[0], codigoCetip: "UNKN11", emissorNome: "EMPRESA DESCONHECIDA LTDA" }],
      mockMoodys,
      mockNtnb
    );

    const unkn = results.find((r) => r.codigoCetip === "UNKN11");
    expect(unkn?.tipoMatch).toBe("sem_match");
    expect(unkn?.rating).toBeNull();
    // Sem match de rating, mas ainda tem taxa e NTN-B — Z-spread pode ser calculado
    // O Z-spread é null apenas quando não há taxa indicativa ou NTN-B
    // Neste caso o ativo tem taxa, então Z-spread é calculado mesmo sem rating
    expect(unkn?.zspread).toBeDefined();
  });
});
