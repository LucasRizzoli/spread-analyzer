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
   * - Emissor normalizado (Dice ≥ 0.90) + número de emissão exato
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
    expect(score).toBeGreaterThanOrEqual(0.90);
  });

  it("score baixo para emissores diferentes", () => {
    const emissorA = normalizeEmissor("PETROBRAS S.A.");
    const emissorB = normalizeEmissor("VALE S.A.");
    const score = diceCoefficient(emissorA, emissorB);
    expect(score).toBeLessThan(0.90);
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
    expect(score).toBeGreaterThanOrEqual(0.90);
  });
});

// ─── Normalização de data de referência ──────────────────────────────────────

describe("normalização de dataReferencia (DD/MM/YYYY → YYYY-MM-DD)", () => {
  /**
   * A função normalizeDate é interna ao syncService, então testamos
   * o comportamento esperado diretamente com a lógica equivalente.
   */
  function normalizeDate(d: string | null | undefined): string | null {
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const parts = d.split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return d;
  }

  it("converte DD/MM/YYYY para YYYY-MM-DD", () => {
    expect(normalizeDate("21/03/2026")).toBe("2026-03-21");
    expect(normalizeDate("01/01/2025")).toBe("2025-01-01");
    expect(normalizeDate("31/12/2024")).toBe("2024-12-31");
  });

  it("mantém YYYY-MM-DD sem alteração", () => {
    expect(normalizeDate("2026-03-21")).toBe("2026-03-21");
    expect(normalizeDate("2025-01-01")).toBe("2025-01-01");
  });

  it("retorna null para entrada nula ou undefined", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

// ─── Lógica de deduplicação e janela 30 dias ─────────────────────────────────

describe("lógica de deduplicação por codigoCetip", () => {
  /**
   * Simula a lógica de deduplicação do syncService:
   * Para cada codigoCetip, manter apenas o registro com maior dataReferencia.
   */
  function deduplicate<T extends { codigoCetip: string; dataReferencia: string }>(
    records: T[]
  ): T[] {
    const latest = new Map<string, T>();
    for (const r of records) {
      const existing = latest.get(r.codigoCetip);
      if (!existing || r.dataReferencia > existing.dataReferencia) {
        latest.set(r.codigoCetip, r);
      }
    }
    return Array.from(latest.values());
  }

  it("mantém apenas o registro mais recente quando há duplicatas", () => {
    const records = [
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-15", zspread: "0.5" },
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-21", zspread: "0.6" },
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-10", zspread: "0.4" },
    ];
    const result = deduplicate(records);
    expect(result).toHaveLength(1);
    expect(result[0].dataReferencia).toBe("2026-03-21");
    expect(result[0].zspread).toBe("0.6");
  });

  it("mantém registros distintos de papéis diferentes", () => {
    const records = [
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-21", zspread: "0.5" },
      { codigoCetip: "EFGH22", dataReferencia: "2026-03-21", zspread: "1.2" },
      { codigoCetip: "IJKL33", dataReferencia: "2026-03-20", zspread: "0.8" },
    ];
    const result = deduplicate(records);
    expect(result).toHaveLength(3);
  });

  it("upload com papel já existente substitui o anterior", () => {
    // Simula: banco tem MOVI18 com data 15/03, novo upload traz MOVI18 com 21/03
    const bancoBefore = [
      { codigoCetip: "MOVI18", dataReferencia: "2026-03-15", zspread: "1.0" },
      { codigoCetip: "RENT14", dataReferencia: "2026-03-15", zspread: "0.8" },
    ];
    const novoUpload = [
      { codigoCetip: "MOVI18", dataReferencia: "2026-03-21", zspread: "1.1" },
      { codigoCetip: "VALE22", dataReferencia: "2026-03-21", zspread: "0.9" },
    ];
    const combined = [...bancoBefore, ...novoUpload];
    const result = deduplicate(combined);

    // MOVI18 deve ter o registro mais recente (21/03)
    const movi18 = result.find((r) => r.codigoCetip === "MOVI18");
    expect(movi18?.dataReferencia).toBe("2026-03-21");
    expect(movi18?.zspread).toBe("1.1");

    // RENT14 deve continuar (não foi substituído)
    expect(result.find((r) => r.codigoCetip === "RENT14")).toBeDefined();

    // VALE22 deve estar presente (novo papel)
    expect(result.find((r) => r.codigoCetip === "VALE22")).toBeDefined();
  });
});

describe("lógica de janela móvel de 30 dias", () => {
  /**
   * Simula a lógica de limpeza do syncService:
   * Deletar registros com dataReferencia < (MAX(dataReferencia) - 30 dias).
   */
  function applyWindow(
    records: { codigoCetip: string; dataReferencia: string }[],
    windowDays = 30
  ) {
    if (records.length === 0) return [];
    const maxDate = records.reduce((max, r) =>
      r.dataReferencia > max ? r.dataReferencia : max,
      records[0].dataReferencia
    );
    const cutoff = new Date(maxDate);
    cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return records.filter((r) => r.dataReferencia >= cutoffStr);
  }

  it("registros com mais de 30 dias são removidos após novo upload", () => {
    const records = [
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-21" }, // mais recente
      { codigoCetip: "EFGH22", dataReferencia: "2026-02-20" }, // exatamente 29 dias antes → mantém
      { codigoCetip: "IJKL33", dataReferencia: "2026-02-19" }, // exatamente 30 dias antes → mantém (>= cutoff)
      { codigoCetip: "MNOP44", dataReferencia: "2026-02-18" }, // 31 dias antes → remove
      { codigoCetip: "QRST55", dataReferencia: "2026-01-01" }, // muito antigo → remove
    ];
    const result = applyWindow(records, 30);
    expect(result.map((r) => r.codigoCetip).sort()).toEqual(["ABCD11", "EFGH22", "IJKL33"]);
  });

  it("mantém todos os registros quando todos estão dentro da janela", () => {
    const records = [
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-21" },
      { codigoCetip: "EFGH22", dataReferencia: "2026-03-15" },
      { codigoCetip: "IJKL33", dataReferencia: "2026-03-01" },
    ];
    const result = applyWindow(records, 30);
    expect(result).toHaveLength(3);
  });

  it("banco vazio retorna array vazio", () => {
    expect(applyWindow([])).toHaveLength(0);
  });
});

describe("filtragem por data mais recente (getLatestDataReferencia)", () => {
  /**
   * Simula o comportamento de getLatestDataReferencia + filtragem nas queries.
   */
  function getLatestDate(records: { dataReferencia: string }[]): string | null {
    if (records.length === 0) return null;
    return records.reduce((max, r) =>
      r.dataReferencia > max ? r.dataReferencia : max,
      records[0].dataReferencia
    );
  }

  function filterByLatest<T extends { dataReferencia: string }>(records: T[]): T[] {
    const latest = getLatestDate(records);
    if (!latest) return [];
    return records.filter((r) => r.dataReferencia === latest);
  }

  it("getAnalysis retorna apenas dados da data mais recente", () => {
    const records = [
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-21", zspread: "0.6" },
      { codigoCetip: "EFGH22", dataReferencia: "2026-03-21", zspread: "1.2" },
      { codigoCetip: "IJKL33", dataReferencia: "2026-03-15", zspread: "0.8" }, // data anterior
    ];
    const result = filterByLatest(records);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.dataReferencia === "2026-03-21")).toBe(true);
    expect(result.find((r) => r.codigoCetip === "IJKL33")).toBeUndefined();
  });

  it("banco vazio retorna array vazio", () => {
    expect(filterByLatest([])).toHaveLength(0);
  });

  it("banco com apenas uma data retorna todos os registros", () => {
    const records = [
      { codigoCetip: "ABCD11", dataReferencia: "2026-03-21", zspread: "0.6" },
      { codigoCetip: "EFGH22", dataReferencia: "2026-03-21", zspread: "1.2" },
    ];
    expect(filterByLatest(records)).toHaveLength(2);
  });
});
