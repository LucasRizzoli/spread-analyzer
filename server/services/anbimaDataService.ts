/**
 * Serviço de coleta de dados cadastrais via ANBIMA Data
 * Substitui o sndEnrichmentService (debentures.com.br), que será descontinuado.
 *
 * Usa Playwright para interceptar a API interna web-bff do data.anbima.com.br:
 *   https://data-api.prd.anbima.com.br/web-bff/v1/debentures/{CETIP}/caracteristicas
 *
 * Expõe a mesma interface que o sndEnrichmentService (enrichBatch, AnbimaDataRecord)
 * para facilitar a substituição no syncService sem alterar a lógica de cruzamento.
 */
import { chromium, type Browser, type BrowserContext } from "playwright";

// ── Interfaces públicas ───────────────────────────────────────────────────────

/**
 * Registro de dados cadastrais de uma debênture — compatível com SndRecord anterior.
 * Campos adicionais (setor, cnpj, etc.) enriquecem o banco além do que o SND fornecia.
 */
export interface AnbimaDataRecord {
  codigoCetip: string;
  isin: string;
  serie: string;
  numeroEmissao: number;
  // Campos extras que o ANBIMA Data fornece (SND não fornecia)
  empresa: string;
  cnpj: string;
  setor: string;
  dataEmissao: string | null;
  dataVencimento: string | null;
  remuneracao: string;
  lei12431: boolean;
  // Aliases de compatibilidade com código que usava AnbimaDataAsset (interface antiga)
  emissorNome: string;   // alias de empresa
  emissorCnpj: string;  // alias de cnpj
  incentivado: boolean; // alias de lei12431
}

// Mantém alias para compatibilidade com código que importava AnbimaDataAsset
export type AnbimaDataAsset = AnbimaDataRecord;

// ── Estrutura interna da API web-bff ─────────────────────────────────────────

interface AnbimaBffResponse {
  tipo?: string;
  isin?: string;
  codigo_b3?: string;
  lei?: boolean;
  artigo?: string | null;
  remuneracao?: string;
  setor?: string;
  data_vencimento?: string;
  numero_serie?: string;
  indexador?: { nome?: string } | string;
  emissao?: {
    numero_emissao?: number | string;
    data_emissao?: string;
    emissor?: {
      nome?: string;
      cnpj?: string;
      setor?: string;
      razao_social?: string;
    };
  };
}

// ── Cache em memória (reutilizado entre chamadas na mesma sincronização) ──────

const cache = new Map<string, AnbimaDataRecord | null>();

export function clearAnbimaDataCache(): void {
  cache.clear();
}

// ── Funções internas ──────────────────────────────────────────────────────────

/**
 * Busca dados de um único ativo via ANBIMA Data, interceptando a chamada web-bff.
 * Retorna null se o ativo não for encontrado ou ocorrer erro.
 */
async function fetchOne(
  context: BrowserContext,
  codigoCetip: string
): Promise<AnbimaDataRecord | null> {
  const key = codigoCetip.toUpperCase();

  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const page = await context.newPage();
  try {
    let apiData: AnbimaBffResponse | null = null;

    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("data-api.prd.anbima.com.br") &&
        url.toLowerCase().includes(key.toLowerCase()) &&
        url.includes("caracteristicas")
      ) {
        try {
          const json = await response.json();
          if (json && (json.isin || json.codigo_b3 || json.emissao)) {
            apiData = json as AnbimaBffResponse;
          }
        } catch {
          // ignora erros de parse
        }
      }
    });

    await page.goto(
      `https://data.anbima.com.br/debentures/${key}/caracteristicas`,
      { waitUntil: "networkidle", timeout: 25000 }
    );
    await page.waitForTimeout(1500);

    if (!apiData) {
      cache.set(key, null);
      return null;
    }

    const d = apiData as AnbimaBffResponse;
    const emissao = d.emissao || {};
    const emissor = emissao.emissor || {};

    const numeroEmissaoRaw = emissao.numero_emissao;
    const numeroEmissao = numeroEmissaoRaw
      ? parseInt(String(numeroEmissaoRaw), 10)
      : NaN;

    if (isNaN(numeroEmissao)) {
      cache.set(key, null);
      return null;
    }

    const empresa = emissor.nome || emissor.razao_social || "";
    const cnpj = emissor.cnpj || "";
    const record: AnbimaDataRecord = {
      codigoCetip: key,
      isin: d.isin || d.codigo_b3 || "",
      serie: d.numero_serie || "",
      numeroEmissao,
      empresa,
      cnpj,
      setor: d.setor || emissor.setor || "",
      dataEmissao: emissao.data_emissao || null,
      dataVencimento: d.data_vencimento || null,
      remuneracao: d.remuneracao || "",
      lei12431: d.lei === true,
      // Aliases de compatibilidade
      emissorNome: empresa,
      emissorCnpj: cnpj,
      incentivado: d.lei === true,
    };

    cache.set(key, record);
    return record;
  } catch (err) {
    console.warn(`[ANBIMA Data] Erro ao buscar ${key}:`, err);
    cache.set(key, null);
    return null;
  } finally {
    await page.close();
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Enriquece um lote de códigos CETIP via ANBIMA Data.
 * Interface idêntica ao enrichBatch do sndEnrichmentService para substituição direta.
 *
 * @param codigos   Lista de códigos CETIP
 * @param batchSize Quantos ativos processar em paralelo (padrão: 3)
 * @param onProgress Callback de progresso (done, total)
 * @returns Map de codigoCetip → AnbimaDataRecord (apenas os encontrados)
 */
export async function enrichBatch(
  codigos: string[],
  batchSize = 3,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, AnbimaDataRecord>> {
  const result = new Map<string, AnbimaDataRecord>();
  if (codigos.length === 0) return result;

  const unique = Array.from(new Set(codigos.map((c) => c.toUpperCase())));

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    context = await browser.newContext();

    // Inicializar sessão visitando a homepage para estabelecer cookies/tokens
    const initPage = await context.newPage();
    await initPage.goto("https://data.anbima.com.br", {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    await initPage.close();

    let done = 0;

    for (let i = 0; i < unique.length; i += batchSize) {
      const chunk = unique.slice(i, i + batchSize);
      const records = await Promise.all(
        chunk.map((c) => fetchOne(context!, c))
      );

      records.forEach((rec, idx) => {
        if (rec) result.set(chunk[idx], rec);
      });

      done += chunk.length;
      onProgress?.(Math.min(done, unique.length), unique.length);
    }
  } finally {
    await browser?.close();
  }

  return result;
}

/**
 * Busca dados cadastrais de uma lista de ativos (interface legada).
 * Mantida para compatibilidade com código que chamava fetchAnbimaDataAssets.
 */
export async function fetchAnbimaDataAssets(
  ativos: Array<{ codigoCetip: string; tipo?: "DEB" | "CRI" | "CRA" }>,
  onProgress?: (done: number, total: number) => void
): Promise<AnbimaDataRecord[]> {
  const codigos = ativos.map((a) => a.codigoCetip);
  const map = await enrichBatch(codigos, 3, onProgress);
  return Array.from(map.values());
}
