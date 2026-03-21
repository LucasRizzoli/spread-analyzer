/**
 * Serviço de processamento da planilha de ratings da Moody's Local
 * Estratégia: o usuário faz o download manual do .xlsx e envia via upload
 */
import * as XLSX from "xlsx";

export interface MoodysRatingRow {
  setor: string;
  emissor: string;
  produto: string;
  instrumento: string;
  objeto: string;
  rating: string;
  perspectiva: string;
  dataAtualizacao: string;
  numeroEmissao: string | null;
}

/**
 * Extrai o número da emissão de strings como:
 * "4ª Emissão de Debêntures - Série Única"
 * "2ª Emissão de CRI"
 * "10ª Emissão"
 */
function extractNumeroEmissao(objeto: string): string | null {
  if (!objeto) return null;
  const match = objeto.match(/(\d+)[ªaº°]\s*[Ee]miss[ãa]o/i);
  return match ? match[1] : null;
}

/**
 * Parseia o buffer do arquivo .xlsx da Moody's
 */
export function parseMoodysXlsx(buffer: Buffer): MoodysRatingRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha da Moody's está vazia ou inválida");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

  if (rows.length === 0) throw new Error("Nenhuma linha encontrada na planilha da Moody's");

  const result = rows.map((row: Record<string, string>) => {
    // Normalizar nomes de colunas (podem variar levemente entre versões)
    const keys = Object.keys(row);
    const get = (patterns: string[]): string => {
      for (const pat of patterns) {
        const key = keys.find((k) => k.toLowerCase().includes(pat.toLowerCase()));
        if (key) return String(row[key] || "").trim();
      }
      return "";
    };

    const objeto = get(["objeto", "emiss"]);
    return {
      setor: get(["setor"]),
      emissor: get(["emissor"]),
      produto: get(["produto"]),
      instrumento: get(["instrumento"]),
      objeto,
      rating: get(["rating", "classif"]),
      perspectiva: get(["perspectiva", "outlook"]),
      dataAtualizacao: get(["data", "atualiz", "date"]),
      numeroEmissao: extractNumeroEmissao(objeto),
    };
  }).filter((r: MoodysRatingRow) => r.emissor && r.rating);

  console.log(`[Moody's] ${result.length} ratings parseados do arquivo`);
  return result;
}
