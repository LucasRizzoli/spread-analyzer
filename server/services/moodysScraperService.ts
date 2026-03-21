/**
 * Serviço de processamento das planilhas de ratings da Moody's Local e ANBIMA Data
 *
 * Estrutura real do arquivo Moody's:
 * - Linha 0: metadados (data de atualização)
 * - Linha 1: título
 * - Linha 2: vazia
 * - Linha 3: cabeçalho (Setor, Emissor, Produto, Instrumento, Objeto, Rating, Perspectiva, Data)
 * - Linha 4+: dados
 *
 * Estrutura real do arquivo ANBIMA Data (debêntures):
 * - Linha 0: cabeçalho
 * - Linha 1+: dados
 * Colunas: [0]DataRef [1]Código [2]Emissor [3]TipoRem [4]Remuneração [5]Vencimento
 *          [6]TaxaCompra [7]TaxaVenda [8]TaxaIndicativa [9]PU [10]DesvPad
 *          [11]IntMin [12]IntMax [13]%PUpar [14]%VNE [15]Duration [16]%Reune
 *          [17]RefNTNB [18]ZSpread [19]SpreadIncentivado [20]Lei12431 [21]VNA [22]PUPar
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
  serie: string | null;
  isEmissao: boolean;
}

export interface AnbimaAsset {
  codigoAtivo: string;
  emissor: string;
  tipoRemuneracao: string;
  remuneracao: string;
  dataVencimento: string;
  taxaIndicativa: number | null;
  duration: number | null;
  referenciaNtnb: string | null;
  zSpread: number;
  spreadIncentivadoSemGrossUp: number | null;
  lei12431: boolean;
  dataReferencia: string;
}

/**
 * Normaliza nome de emissor para fuzzy matching
 * Remove acentos, sufixos societários e caracteres especiais
 */
export function normalizeEmissor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s*\([^)]*\)\s*/g, " ") // remove conteúdo entre parênteses (ex: "(*)", "(**)")
    .replace(/\s+(s\.?\/?\s*a\.?|ltda\.?|eireli|me|epp|s\.a\.?)\.?\s*$/i, "") // remove sufixos societários
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai o número da emissão de strings como:
 * "4ª Emissão de Debêntures - Série Única"
 * "7a Emissão de Debêntures"
 * "10ª Emissão"
 */
export function extractNumeroEmissao(instrumento: string): string | null {
  if (!instrumento) return null;
  const match = instrumento.match(/(\d+)[ªaº°]\s*[Ee]miss[ãa]o/i);
  if (match) return match[1];
  const match2 = instrumento.match(/[Ee]miss[ãa]o\s+(\d+)/i);
  return match2 ? match2[1] : null;
}

/**
 * Extrai a série do instrumento
 * "1ª Série" → "1", "Série Única" → "unica"
 */
export function extractSerie(instrumento: string): string | null {
  if (!instrumento) return null;
  const matchUnica = instrumento.match(/s[eé]rie\s+[uú]nica/i);
  if (matchUnica) return "unica";
  const match = instrumento.match(/(\d+)[ªaº°]\s*s[eé]rie/i);
  return match ? match[1] : null;
}

/**
 * Converte número serial do Excel para string de data legível
 */
function excelDateToString(serial: number | string): string {
  if (!serial) return "";
  const num = Number(serial);
  if (isNaN(num) || num < 1) return String(serial);
  const date = new Date((num - 25569) * 86400 * 1000);
  return date.toISOString().split("T")[0];
}

/**
 * Parseia o buffer do arquivo .xlsx da Moody's Local
 */
export function parseMoodysXlsx(buffer: Buffer): MoodysRatingRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha da Moody's está vazia ou inválida");

  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    defval: "",
    header: 1,
  });

  if (allRows.length === 0) throw new Error("Nenhuma linha encontrada na planilha da Moody's");

  const result: MoodysRatingRow[] = [];

  // Encontrar linha do cabeçalho (contém "Setor" na col 0)
  let startRow = 4; // fallback
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    if (String(allRows[i]?.[0] || "").trim() === "Setor") {
      startRow = i + 1;
      break;
    }
  }

  for (let i = startRow; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row || row.length < 6) continue;

    const setor = String(row[0] || "").trim();
    const emissor = String(row[1] || "").trim();
    const produto = String(row[2] || "").trim();
    const instrumento = String(row[3] || "").trim();
    const objeto = String(row[4] || "").trim();
    const rating = String(row[5] || "").trim();
    const perspectiva = String(row[6] || "").trim();
    const dataRaw = row[7];

    if (!emissor || !rating) continue;
    // Valida rating no formato escala brasileira
    if (!rating.match(/^(AAA|AA[+\-]?|A[+\-]?|BBB[+\-]?|BB[+\-]?|B[+\-]?|CCC|CC|C|D)\.br$/i)) continue;

    const dataAtualizacao = typeof dataRaw === "number"
      ? excelDateToString(dataRaw)
      : String(dataRaw || "").trim();

    const isEmissao = produto === "Rating de Dívida" || produto === "Rating de Emissão";

    result.push({
      setor,
      emissor,
      produto,
      instrumento,
      objeto,
      rating,
      perspectiva,
      dataAtualizacao,
      numeroEmissao: extractNumeroEmissao(instrumento),
      serie: extractSerie(instrumento),
      isEmissao,
    });
  }

  console.log(`[Moody's] ${result.length} ratings parseados (${allRows.length} linhas totais)`);
  return result;
}

/**
 * Parseia o buffer do arquivo .xlsx do ANBIMA Data (debêntures/CRI/CRA)
 * O Z-spread já vem calculado pela ANBIMA — não precisamos recalcular
 */
export function parseAnbimaDataXlsx(buffer: Buffer): AnbimaAsset[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha ANBIMA Data está vazia ou inválida");

  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    defval: "",
    header: 1,
  });

  if (allRows.length < 2) throw new Error("Nenhum dado encontrado na planilha ANBIMA Data");

  const result: AnbimaAsset[] = [];

  // Encontrar a data de referência mais recente no arquivo
  // (o arquivo pode conter múltiplos dias de dados)
  const datasSet = new Set<string>();
  for (let i = 1; i < allRows.length; i++) {
    const d = String(allRows[i]?.[0] || "").trim();
    if (d) datasSet.add(d);
  }
  const datasOrdenadas = Array.from(datasSet).sort((a, b) => {
    const parseDate = (s: string) => {
      const parts = s.split("/");
      if (parts.length === 3) {
        return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime();
      }
      return 0;
    };
    return parseDate(a) - parseDate(b);
  });
  const dataRecente = datasOrdenadas[datasOrdenadas.length - 1] || "";
  console.log(`[ANBIMA Data] Usando data mais recente: ${dataRecente} (${datasOrdenadas.length} datas no arquivo)`);

  // Linha 0 é o cabeçalho, dados começam na linha 1
  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row || !row[1]) continue;

    // Filtrar apenas a data mais recente
    const dataRow = String(row[0] || "").trim();
    if (dataRecente && dataRow !== dataRecente) continue;

    const codigoAtivo = String(row[1] || "").trim();
    const emissor = String(row[2] || "").trim();
    const tipoRemuneracao = String(row[3] || "").trim();
    const remuneracao = String(row[4] || "").trim();
    const dataVencimento = String(row[5] || "").trim();
    const taxaIndicativa = row[8] !== "" ? parseFloat(String(row[8])) : null;
    const duration = row[15] !== "" ? parseFloat(String(row[15])) : null;
    const referenciaNtnb = String(row[17] || "").trim() || null;
    const zSpreadRaw = row[18];
    const zSpread = zSpreadRaw !== "" && zSpreadRaw !== undefined ? parseFloat(String(zSpreadRaw)) : NaN;
    const spreadIncentivadoRaw = row[19];
    const spreadIncentivadoSemGrossUp = spreadIncentivadoRaw !== "" && spreadIncentivadoRaw !== undefined
      ? parseFloat(String(spreadIncentivadoRaw))
      : null;
    const lei12431 = String(row[20] || "").trim().toUpperCase() === "SIM";
    const dataReferencia = dataRow;

    if (!codigoAtivo || !emissor) continue;
    if (isNaN(zSpread)) continue; // ignora ativos sem Z-spread calculado

    result.push({
      codigoAtivo,
      emissor,
      tipoRemuneracao,
      remuneracao,
      dataVencimento,
      taxaIndicativa: taxaIndicativa !== null && !isNaN(taxaIndicativa) ? taxaIndicativa : null,
      duration: duration !== null && !isNaN(duration) ? duration : null,
      referenciaNtnb,
      zSpread,
      spreadIncentivadoSemGrossUp,
      lei12431,
      dataReferencia,
    });
  }

  console.log(`[ANBIMA Data] ${result.length} ativos parseados com Z-spread (${allRows.length - 1} linhas totais)`);
  return result;
}
