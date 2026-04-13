/**
 * Parser da planilha ANBIMA de CRIs e CRAs
 * Formato: certificados-recebiveis-precos-DD-MM-YYYY-HH-MM-SS.xls (OOXML mascarado)
 *
 * Colunas (linha 0 = cabeçalho):
 * 0  Data de referência
 * 1  Tipo (CRI / CRA)
 * 2  Código (CETIP)
 * 3  Emissor (securitizadora)
 * 4  Devedor (empresa real — campo chave para matching Moody's)
 * 5  Tipo de remuneração (IPCA / DI ADITIVO / DI MULTIPLICATIVO / PRE FIXADO)
 * 6  Taxa de correção (spread sobre indexador, em % a.a.)
 * 7  Série
 * 8  Emissão
 * 9  Data de vencimento
 * 10 Taxa de compra
 * 11 Taxa de venda
 * 12 Taxa indicativa (taxa total de mercado, em % a.a.)
 * 13 PU Indicativo
 * 14 Desvio padrão
 * 15 Duration (dias úteis)
 * 16 % PU par
 * 17 % VNE
 * 18 % REUNE
 * 19 Referência NTN-B (data da NTN-B de referência para IPCA)
 */

import ExcelJS from "exceljs";

export interface CriCraRow {
  dataReferencia: string;        // "DD/MM/YYYY" → normalizado para "YYYY-MM-DD"
  tipo: "CRI" | "CRA";
  codigoCetip: string;
  emissor: string;               // securitizadora
  devedor: string | null;        // empresa real (campo para matching Moody's)
  tipoRemuneracao: string;       // IPCA / DI ADITIVO / DI MULTIPLICATIVO / PRE FIXADO
  taxaCorrecao: number | null;   // spread sobre indexador (% a.a.)
  serie: string | null;
  numeroEmissao: string | null;
  dataVencimento: string | null; // "DD/MM/YYYY" → "YYYY-MM-DD"
  taxaIndicativa: number | null; // taxa total de mercado (% a.a.)
  durationDU: number | null;     // duration em dias úteis
  durationAnos: number | null;   // duration em anos (durationDU / 252)
  refNtnb: string | null;        // data da NTN-B de referência ("DD/MM/YYYY")
}

/** Normaliza data "DD/MM/YYYY" → "YYYY-MM-DD" */
function normDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // Já no formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Formato DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // Pode ser um número serial do Excel (dias desde 1900-01-01)
  const n = Number(v);
  if (!isNaN(n) && n > 40000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export async function parseCriCraXlsx(buffer: Buffer | ArrayBuffer): Promise<{
  rows: CriCraRow[];
  dataRefFim: string | null;
  totalLinhas: number;
}> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha vazia ou sem abas");

  const rows: CriCraRow[] = [];
  let headerFound = false;
  let dataRefFim: string | null = null;

  ws.eachRow((row: ExcelJS.Row, rowNumber: number) => {
    const vals = row.values as unknown[];
    // ExcelJS usa índice 1-based; normalizar para 0-based
    const v = (i: number) => vals[i + 1];

    // Detectar linha de cabeçalho
    if (!headerFound) {
      const first = String(v(0) ?? "").toLowerCase();
      if (first.includes("data") || first.includes("referência") || first.includes("referencia")) {
        headerFound = true;
      }
      return;
    }

    const tipo = String(v(1) ?? "").trim().toUpperCase();
    if (tipo !== "CRI" && tipo !== "CRA") return;

    const codigo = String(v(2) ?? "").trim();
    if (!codigo) return;

    const taxaIndicativa = toNum(v(12));
    // Só processar registros com taxa indicativa preenchida
    if (taxaIndicativa == null) return;

    const durationDU = toNum(v(15));
    const durationAnos = durationDU != null ? Math.round((durationDU / 252) * 10000) / 10000 : null;

    const dataRef = normDate(v(0));
    if (dataRef && (!dataRefFim || dataRef > dataRefFim)) {
      dataRefFim = dataRef;
    }

    rows.push({
      dataReferencia: dataRef ?? "",
      tipo: tipo as "CRI" | "CRA",
      codigoCetip: codigo,
      emissor: String(v(3) ?? "").trim(),
      devedor: v(4) ? String(v(4)).trim() || null : null,
      tipoRemuneracao: String(v(5) ?? "").trim().toUpperCase(),
      taxaCorrecao: toNum(v(6)),
      serie: v(7) ? String(v(7)).trim() || null : null,
      numeroEmissao: v(8) ? String(v(8)).trim() || null : null,
      dataVencimento: normDate(v(9)),
      taxaIndicativa,
      durationDU,
      durationAnos,
      refNtnb: normDate(v(19)),
    });
  });

  return { rows, dataRefFim, totalLinhas: rows.length };
}
