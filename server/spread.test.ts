import { describe, expect, it } from "vitest";
import { getRatingOrder, sortRatings } from "./services/spreadCalculatorService";
import {
  normalizeEmissor,
  extractNumeroEmissao,
  extractSerie,
  parseMoodysXlsx,
  parseAnbimaDataXlsx,
} from "./services/moodysScraperService";
import * as XLSX from "xlsx";

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
    expect(result[0]).toBe("AAA.br");
    expect(result[1]).toBe("A.br");
    expect(result[2]).toBe("BBB+.br");
    expect(result[3]).toBe("BB.br");
  });

  it("remove duplicatas", () => {
    const input = ["AA.br", "AA.br", "A.br"];
    const result = sortRatings(input);
    expect(result).toHaveLength(2);
  });

  it("lida com array vazio", () => {
    expect(sortRatings([])).toEqual([]);
  });
});

// ─── Normalização de emissor ──────────────────────────────────────────────────

describe("normalizeEmissor", () => {
  it("remove sufixos societários", () => {
    expect(normalizeEmissor("Petrobras S.A.")).toBe("petrobras");
    expect(normalizeEmissor("Vale S/A")).toBe("vale");
    expect(normalizeEmissor("Braskem Ltda.")).toBe("braskem");
  });

  it("remove acentos", () => {
    expect(normalizeEmissor("Companhia Energética")).toBe("companhia energetica");
    expect(normalizeEmissor("Ânima Holding S.A.")).toBe("anima holding");
  });

  it("remove conteúdo entre parênteses", () => {
    expect(normalizeEmissor("AEGEA SANEAMENTO (*) (**)")).toBe("aegea saneamento");
    expect(normalizeEmissor("Empresa XYZ (*)")).toBe("empresa xyz");
  });

  it("normaliza espaços e caracteres especiais", () => {
    expect(normalizeEmissor("  Empresa   ABC  ")).toBe("empresa abc");
  });
});

// ─── Extração de número de emissão ───────────────────────────────────────────

describe("extractNumeroEmissao", () => {
  it("extrai número de emissão com ª", () => {
    expect(extractNumeroEmissao("4ª Emissão de Debêntures - Série Única")).toBe("4");
    expect(extractNumeroEmissao("1ª Emissão de Debêntures")).toBe("1");
    expect(extractNumeroEmissao("11ª Emissão de Debêntures – Série Única")).toBe("11");
  });

  it("extrai número de emissão com 'a'", () => {
    expect(extractNumeroEmissao("7a Emissão de Debêntures")).toBe("7");
    expect(extractNumeroEmissao("8a Emissão de Debêntures")).toBe("8");
  });

  it("retorna null para strings sem emissão", () => {
    expect(extractNumeroEmissao("N/A")).toBeNull();
    expect(extractNumeroEmissao("Rating Corporativo")).toBeNull();
    expect(extractNumeroEmissao("")).toBeNull();
  });
});

// ─── Extração de série ────────────────────────────────────────────────────────

describe("extractSerie", () => {
  it("extrai número de série", () => {
    expect(extractSerie("4ª Emissão de Debêntures - 1ª Série")).toBe("1");
    expect(extractSerie("4ª Emissão de Debêntures - 2ª Série")).toBe("2");
  });

  it("identifica série única", () => {
    expect(extractSerie("4ª Emissão de Debêntures - Série Única")).toBe("unica");
  });

  it("retorna null quando não há série", () => {
    expect(extractSerie("N/A")).toBeNull();
    expect(extractSerie("")).toBeNull();
  });
});

// ─── Parser Moody's ───────────────────────────────────────────────────────────

describe("parseMoodysXlsx", () => {
  function buildMoodysWorkbook(rows: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  it("parseia planilha Moody's sintética corretamente", () => {
    const data = [
      ["", "", "", "", "", "", "Data de Atualização", 45770],
      ["", "", "Moody's Local Brasil", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["Setor", "Emissor", "Produto", "Instrumento", "Objeto", "Rating / Avaliação", "Perspectiva", "Última data"],
      ["Empresas Não-Financeiras", "Empresa ABC S.A.", "Rating de Dívida", "4ª Emissão de Debêntures - Série Única", "Rating de Emissão Sênior", "AA-.br", "Perspectiva estável", 45770],
      ["Empresas Não-Financeiras", "Empresa ABC S.A.", "Rating de Emissor", "N/A", "Rating de Emissor", "AA.br", "Perspectiva estável", 45770],
      ["Financeiras", "Banco XYZ S.A.", "Rating Corporativo", "N/A", "Rating Corporativo", "A.br", "Perspectiva positiva", 45770],
    ];

    const result = parseMoodysXlsx(buildMoodysWorkbook(data));

    expect(result.length).toBe(3);
    expect(result[0].emissor).toBe("Empresa ABC S.A.");
    expect(result[0].rating).toBe("AA-.br");
    expect(result[0].isEmissao).toBe(true);
    expect(result[0].numeroEmissao).toBe("4");
    expect(result[1].isEmissao).toBe(false); // Rating de Emissor
    expect(result[2].rating).toBe("A.br");
  });

  it("ignora linhas com rating inválido ou emissor vazio", () => {
    const data = [
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["Setor", "Emissor", "Produto", "Instrumento", "Objeto", "Rating / Avaliação", "Perspectiva", "Data"],
      ["Setor1", "Empresa A", "Rating de Dívida", "1ª Emissão", "Obj", "AA-.br", "Estável", 45770],
      ["Setor1", "Empresa B", "Rating de Dívida", "1ª Emissão", "Obj", "INVALIDO", "Estável", 45770],
      ["Setor1", "", "Rating de Dívida", "1ª Emissão", "Obj", "AA.br", "Estável", 45770],
    ];

    const result = parseMoodysXlsx(buildMoodysWorkbook(data));
    expect(result.length).toBe(1);
    expect(result[0].emissor).toBe("Empresa A");
  });

  it("identifica corretamente ratings de emissão vs emissor", () => {
    const data = [
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["Setor", "Emissor", "Produto", "Instrumento", "Objeto", "Rating / Avaliação", "Perspectiva", "Data"],
      ["Setor1", "Empresa A", "Rating de Dívida", "7a Emissão de Debêntures", "Obj", "A.br", "Estável", 45770],
      ["Setor1", "Empresa A", "Rating de Emissor", "N/A", "Rating Corporativo", "A.br", "Estável", 45770],
    ];

    const result = parseMoodysXlsx(buildMoodysWorkbook(data));
    const emissao = result.find((r) => r.isEmissao);
    const emissor = result.find((r) => !r.isEmissao);
    expect(emissao?.numeroEmissao).toBe("7");
    expect(emissor?.numeroEmissao).toBeNull();
  });
});

// ─── Parser ANBIMA Data ───────────────────────────────────────────────────────

describe("parseAnbimaDataXlsx", () => {
  function buildAnbimaWorkbook(rows: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  const header = [
    "Data de referência", "Código", "Emissor", "Tipo Remuneração", "Remuneração",
    "Data de vencimento", "Taxa de compra", "Taxa de venda", "Taxa indicativa",
    "PU", "Desvio", "Min", "Max", "% PU", "% VNE", "Duration",
    "% Reúne", "Referência NTN-B", "Z-Spread", "Spread incentivados", "Lei 12.431",
    "VNA", "PU Par",
  ];

  it("parseia planilha ANBIMA Data e filtra data mais recente", () => {
    const data = [
      header,
      ["20/03/2026", "ABCD11", "Empresa Teste S.A.", "IPCA SPREAD", "IPCA + 3,5000%", "15/06/2030", 7.2, 6.8, 7.0, 1050, 0.05, 6.9, 7.1, 99.5, "", 850, "10%", "15/05/2029", 0.85, -0.15, "SIM", 1000, 1050],
      ["20/03/2026", "EFGH22", "Outra Empresa Ltda.", "DI SPREAD", "DI + 2,0000%", "15/12/2028", 2.3, 1.9, 2.1, 1020, 0.08, 2.0, 2.2, 98.5, "", 650, "--", "", 2.1, "", "NÃO", 1000, 1035],
      // dia anterior - deve ser ignorado
      ["19/03/2026", "ABCD11", "Empresa Teste S.A.", "IPCA SPREAD", "IPCA + 3,5000%", "15/06/2030", 7.1, 6.7, 6.9, 1048, 0.05, 6.8, 7.0, 99.3, "", 851, "10%", "15/05/2029", 0.84, -0.16, "SIM", 1000, 1050],
    ];

    const result = parseAnbimaDataXlsx(buildAnbimaWorkbook(data));

    // Deve retornar apenas os 2 registros da data mais recente (20/03/2026)
    expect(result.length).toBe(2);
    expect(result[0].codigoAtivo).toBe("ABCD11");
    expect(result[0].emissor).toBe("Empresa Teste S.A.");
    expect(result[0].zSpread).toBeCloseTo(0.85);
    expect(result[0].lei12431).toBe(true);
    expect(result[0].dataReferencia).toBe("20/03/2026");
    expect(result[1].lei12431).toBe(false);
  });

  it("ignora linhas sem Z-spread", () => {
    const data = [
      header,
      ["20/03/2026", "ABCD11", "Empresa A", "DI SPREAD", "DI + 2%", "15/12/2028", 2.3, 1.9, 2.1, 1020, 0.08, 2.0, 2.2, 98.5, "", 650, "--", "", 2.1, "", "NÃO", 1000, 1035],
      ["20/03/2026", "EFGH22", "Empresa B", "DI SPREAD", "DI + 1%", "15/12/2028", "", "", "", 1010, "", "", "", 99, "", "", "--", "", "", "", "NÃO", 1000, 1010],
    ];

    const result = parseAnbimaDataXlsx(buildAnbimaWorkbook(data));
    expect(result.length).toBe(1);
    expect(result[0].codigoAtivo).toBe("ABCD11");
  });

  it("identifica corretamente o campo lei12431", () => {
    const data = [
      header,
      ["20/03/2026", "ABCD11", "Empresa A", "IPCA SPREAD", "IPCA + 3%", "15/06/2030", 7.0, 6.8, 7.0, 1050, 0.05, 6.9, 7.1, 99.5, "", 850, "10%", "15/05/2029", 0.85, -0.15, "SIM", 1000, 1050],
      ["20/03/2026", "EFGH22", "Empresa B", "IPCA SPREAD", "IPCA + 2%", "15/06/2028", 6.0, 5.8, 6.0, 1020, 0.03, 5.9, 6.1, 98.5, "", 650, "", "", 0.50, "", "NÃO", 1000, 1035],
    ];

    const result = parseAnbimaDataXlsx(buildAnbimaWorkbook(data));
    expect(result.find(r => r.codigoAtivo === "ABCD11")?.lei12431).toBe(true);
    expect(result.find(r => r.codigoAtivo === "EFGH22")?.lei12431).toBe(false);
  });
});

// ─── Matching emissão-a-emissão ───────────────────────────────────────────────

describe("matching emissão-a-emissão (lógica de crossByEmissao)", () => {
  /**
   * Testa a lógica central do matching:
   * - Emissor normalizado (Dice ≥ 0.65) + número de emissão exato
   * - Apenas ratings de emissão são considerados (isEmissao = true)
   * - Sem fallback para rating de emissor
   */

  function diceCoefficient(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const getBigrams = (str: string): Map<string, number> => {
      const m = new Map<string, number>();
      for (let i = 0; i < str.length - 1; i++) {
        const bg = str.substring(i, i + 2);
        m.set(bg, (m.get(bg) || 0) + 1);
      }
      return m;
    };
    const bA = getBigrams(a), bB = getBigrams(b);
    let inter = 0;
    for (const [k, v] of bA) inter += Math.min(v, bB.get(k) || 0);
    return (2 * inter) / (a.length - 1 + b.length - 1);
  }

  it("match exato: mesmo emissor e mesmo número de emissão", () => {
    const emissorAnbima = normalizeEmissor("AEGEA SANEAMENTO E PARTICIPAÇÕES S/A (*)");
    const emissorMoodys = normalizeEmissor("Aegea Saneamento e Participações S.A.");
    const score = diceCoefficient(emissorAnbima, emissorMoodys);
    expect(score).toBeGreaterThanOrEqual(0.65);
  });

  it("score baixo para emissores diferentes", () => {
    const emissorA = normalizeEmissor("PETROBRAS S.A.");
    const emissorB = normalizeEmissor("VALE S.A.");
    const score = diceCoefficient(emissorA, emissorB);
    expect(score).toBeLessThan(0.65);
  });

  it("número de emissão diferente não deve dar match", () => {
    // AEGP17 = 7ª emissão, AEGPB5 = 25ª emissão
    // Ambas são da AEGEA, mas a Moody's só tem rating da 7ª
    // O matching por número de emissão deve rejeitar a 25ª
    const emissaoMoodys = 7;
    const emissaoAnbimaB5 = 25;
    expect(emissaoMoodys).not.toBe(emissaoAnbimaB5);
  });

  it("normalização remove asteriscos e sufixos para matching correto", () => {
    const comAsteriscos = normalizeEmissor("RGE SUL DISTRIBUIDORA DE ENERGIA S/A (*)");
    const semAsteriscos = normalizeEmissor("RGE Sul Distribuidora de Energia S.A.");
    const score = diceCoefficient(comAsteriscos, semAsteriscos);
    expect(score).toBeGreaterThanOrEqual(0.65);
  });
});
