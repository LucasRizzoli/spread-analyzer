/**
 * Serviço de scraping da planilha de ratings da Moody's Local
 * Estratégia: Playwright headless → extrai link do .xlsx → baixa e parseia
 */
import { chromium } from "playwright";
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
 * Busca o link mais recente do .xlsx no site da Moody's Local
 */
async function getMoodysXlsxUrl(): Promise<string> {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto("https://moodyslocal.com.br", { waitUntil: "networkidle", timeout: 30000 });

    // Aceitar cookies se o banner aparecer
    try {
      await page.click('button:has-text("Aceitar")', { timeout: 3000 });
    } catch {
      // Sem banner de cookies
    }

    // Aguardar o link do xlsx aparecer
    await page.waitForSelector('a[href*="MOODYS_LOCAL_BRAZIL"]', { timeout: 15000 });

    const href = await page.$eval(
      'a[href*="MOODYS_LOCAL_BRAZIL"]',
      (el) => (el as HTMLAnchorElement).href
    );

    return href;
  } finally {
    await browser.close();
  }
}

/**
 * Baixa e parseia o arquivo .xlsx da Moody's
 */
async function downloadAndParseXlsx(url: string): Promise<MoodysRatingRow[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar xlsx da Moody's: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

  return rows.map((row: Record<string, string>) => {
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
}

/**
 * Função principal: scraping completo da Moody's
 */
export async function scrapeMoodysRatings(): Promise<MoodysRatingRow[]> {
  const url = await getMoodysXlsxUrl();
  console.log(`[Moody's] Baixando planilha: ${url}`);
  const rows = await downloadAndParseXlsx(url);
  console.log(`[Moody's] ${rows.length} ratings encontrados`);
  return rows;
}
