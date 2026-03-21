/**
 * Serviço de coleta de dados cadastrais via ANBIMA Data
 * Usa Playwright para obter o token reCAPTCHA e chamar a API interna
 * Retorna ISIN, código CETIP, emissor, número de emissão, incentivado, etc.
 */
import { chromium, type BrowserContext } from "playwright";

export interface AnbimaDataAsset {
  codigoCetip: string;
  isin: string | null;
  tipo: "DEB" | "CRI" | "CRA";
  emissorNome: string;
  emissorCnpj: string;
  setor: string;
  numeroEmissao: string | null;
  numeroSerie: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  remuneracao: string;
  indexador: string;
  incentivado: boolean;
}

interface AnbimaDataApiResponse {
  isin?: string;
  codigo_b3?: string;
  lei?: boolean;
  emissao?: {
    numero_emissao?: number | string;
    serie?: string;
    data_emissao?: string;
    data_vencimento?: string;
    emissor?: {
      nome?: string;
      cnpj?: string;
      setor?: string;
    };
    remuneracao?: string;
    indexador?: string;
  };
}

/**
 * Busca dados cadastrais de um ativo específico via ANBIMA Data
 * Usa o contexto do browser para ter o token reCAPTCHA válido
 */
async function fetchAssetFromAnbimaData(
  context: BrowserContext,
  codigoCetip: string,
  tipo: "DEB" | "CRI" | "CRA"
): Promise<AnbimaDataAsset | null> {
  const page = await context.newPage();
  try {
    const tipoPath = tipo === "DEB" ? "debentures" : tipo === "CRI" ? "cri" : "cra";
    const url = `https://data.anbima.com.br/${tipoPath}/${codigoCetip}/caracteristicas`;

    // Interceptar chamadas de API
    let apiData: AnbimaDataApiResponse | null = null;

    page.on("response", async (response) => {
      const reqUrl = response.url();
      if (
        reqUrl.includes("data-api.prd.anbima.com.br") &&
        reqUrl.includes(codigoCetip.toLowerCase())
      ) {
        try {
          const json = await response.json();
          if (json && (json.isin || json.codigo_b3)) {
            apiData = json as AnbimaDataApiResponse;
          }
        } catch {
          // Ignora erros de parse
        }
      }
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

    // Aguardar um pouco para garantir que as chamadas de API foram feitas
    await page.waitForTimeout(2000);

    if (!apiData) return null;

    const data = apiData as AnbimaDataApiResponse;
    const emissao = data.emissao || {};
    const emissor = emissao.emissor || {};

    return {
      codigoCetip,
      isin: data.isin || null,
      tipo,
      emissorNome: emissor.nome || "",
      emissorCnpj: emissor.cnpj || "",
      setor: emissor.setor || "",
      numeroEmissao: emissao.numero_emissao ? String(emissao.numero_emissao) : null,
      numeroSerie: emissao.serie || null,
      dataEmissao: emissao.data_emissao || null,
      dataVencimento: emissao.data_vencimento || null,
      remuneracao: emissao.remuneracao || "",
      indexador: emissao.indexador || "",
      incentivado: data.lei === true,
    };
  } catch (err) {
    console.warn(`[ANBIMA Data] Erro ao buscar ${codigoCetip}:`, err);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Busca dados cadastrais de uma lista de ativos em lotes
 * Reutiliza o mesmo contexto do browser para eficiência
 */
export async function fetchAnbimaDataAssets(
  ativos: Array<{ codigoCetip: string; tipo: "DEB" | "CRI" | "CRA" }>,
  onProgress?: (done: number, total: number) => void
): Promise<AnbimaDataAsset[]> {
  if (ativos.length === 0) return [];

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();

  // Navegar para a homepage primeiro para estabelecer sessão/cookies
  const initPage = await context.newPage();
  await initPage.goto("https://data.anbima.com.br", { waitUntil: "networkidle", timeout: 20000 });
  await initPage.close();

  const results: AnbimaDataAsset[] = [];
  const BATCH_SIZE = 3; // Processar 3 ativos em paralelo para não sobrecarregar

  for (let i = 0; i < ativos.length; i += BATCH_SIZE) {
    const batch = ativos.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((a) => fetchAssetFromAnbimaData(context, a.codigoCetip, a.tipo))
    );

    for (const result of batchResults) {
      if (result) results.push(result);
    }

    onProgress?.(Math.min(i + BATCH_SIZE, ativos.length), ativos.length);
  }

  await browser.close();
  return results;
}
