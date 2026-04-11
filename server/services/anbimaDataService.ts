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
 * Tenta buscar dados de um único ativo via ANBIMA Data (uma tentativa).
 * Retorna o registro ou null em caso de falha.
 */
async function fetchOneAttempt(
  context: BrowserContext,
  key: string
): Promise<AnbimaDataRecord | null> {
   const page = await context.newPage();
  try {
    // Criar a promise de waitForResponse ANTES de navegar,
    // mas envolver tudo em try/catch para garantir que TimeoutError nunca escapa.
    let apiResponsePromise: Promise<import('playwright').Response> | null = null;
    try {
      apiResponsePromise = page.waitForResponse(
        (r) =>
          r.url().includes("data-api.prd.anbima.com.br") &&
          r.url().toLowerCase().includes(key.toLowerCase()) &&
          r.url().includes("caracteristicas"),
        { timeout: 15000 }
      );
    } catch {
      apiResponsePromise = null;
    }

    try {
      await page.goto(
        `https://data.anbima.com.br/debentures/${key}/caracteristicas`,
        { waitUntil: "commit", timeout: 20000 }
      );
    } catch {
      // timeout de navegação — continua tentando capturar a resposta da API
    }

    let apiData: AnbimaBffResponse | null = null;
    try {
      if (apiResponsePromise) {
        const apiResponse = await apiResponsePromise;
        const json = await apiResponse.json();
        if (json && (json.isin || json.codigo_b3 || json.emissao)) {
          apiData = json as AnbimaBffResponse;
        }
      }
    } catch {
      // API não respondeu dentro do timeout — tratar como null silenciosamente
    }

    if (!apiData) return null;

    const d = apiData as AnbimaBffResponse;
    const emissao = d.emissao || {};
    const emissor = emissao.emissor || {};

    const numeroEmissaoRaw = emissao.numero_emissao;
    const numeroEmissao = numeroEmissaoRaw
      ? parseInt(String(numeroEmissaoRaw), 10)
      : NaN;

    if (isNaN(numeroEmissao)) return null;

    const empresa = emissor.nome || emissor.razao_social || "";
    const cnpj = emissor.cnpj || "";
    return {
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
      emissorNome: empresa,
      emissorCnpj: cnpj,
      incentivado: d.lei === true,
    };
  } finally {
    await page.close();
  }
}

/**
 * Busca dados de um único ativo via ANBIMA Data com retry até 3 tentativas.
 * Só descarta silenciosamente após a terceira falha consecutiva.
 */
async function fetchOne(
  context: BrowserContext,
  codigoCetip: string
): Promise<AnbimaDataRecord | null> {
  const key = codigoCetip.toUpperCase();

  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const record = await fetchOneAttempt(context, key);
      if (record) {
        cache.set(key, record);
        return record;
      }
      // Retornou null (ativo não encontrado, sem erro de exceção) — não adianta tentar novamente
      cache.set(key, null);
      return null;
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        console.warn(`[ANBIMA Data] Falha definitiva após ${MAX_RETRIES} tentativas para ${key}:`, (err as Error).message);
        cache.set(key, null);
        return null;
      }
      console.warn(`[ANBIMA Data] Tentativa ${attempt}/${MAX_RETRIES} falhou para ${key}, tentando novamente...`);
      // Aguardar 1s antes de tentar novamente
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  cache.set(key, null);
  return null;
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

    // Inicializar sessão visitando a homepage para estabelecer cookies/tokens.
    // Usa 'commit' (apenas aguarda início da resposta HTTP) para não bloquear em scripts pesados.
    // Falha aqui é não-fatal: cada fetchOne funciona de forma independente.
    try {
      const initPage = await context.newPage();
      await initPage.goto("https://data.anbima.com.br", {
        waitUntil: "commit",
        timeout: 10000,
      });
      await initPage.waitForTimeout(1000); // aguardar cookies de sessão serem definidos
      await initPage.close();
    } catch (initErr) {
      console.warn("[ANBIMA Data] Aviso: falha ao carregar homepage de inicialização:", (initErr as Error).message);
      // Continua mesmo sem a inicialização — fetchOne funciona de forma independente
    }

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
