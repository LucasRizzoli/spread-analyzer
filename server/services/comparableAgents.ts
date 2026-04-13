/**
 * Sistema de Multi-Agentes para Busca de Emissões Comparáveis
 *
 * Agentes:
 *  1. Orquestrador — extrai atributos estruturados e gera termos de busca criativos
 *  2. Interno      — busca na base ANBIMA local (~1.274 ativos) com mapeamento correto
 *  3. Web          — Serper.dev (Google Search API) + visita a fontes via Playwright
 *  4. Sintetizador — consolida, deduplica e gera relatório com contexto de negócio
 */

import { invokeLLM } from "../_core/llm";
import { chromium } from "playwright";
import { getDb } from "../db";
import { anbimaAssets } from "../../drizzle/schema";
import { like, or, and } from "drizzle-orm";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface ComparableResult {
  id: string;
  fonte: "interno" | "web" | "noticia";
  titulo: string;
  emissor: string;
  tipo: string;
  finalidade: string;
  indexador?: string;
  prazo?: string;
  volume?: string;
  taxa?: string;
  rating?: string;
  setor?: string;
  estruturador?: string;
  dataEmissao?: string;
  relevancia: number;
  justificativa: string;
  url?: string;
  fonteNome?: string;
}

export interface SearchAttributes {
  tipo?: string;
  finalidade?: string;
  indexador?: string;
  prazo?: string;
  setor?: string;
  emissor?: string;
  volume?: string;
}

export interface ProgressCallback {
  (step: string, detail?: string): void;
}

// ── Mapeamentos: termos genéricos do LLM → valores reais do banco ─────────────

const SETOR_MAP: Record<string, string[]> = {
  imobiliário:      ["Serviços Imobiliários"],
  imobiliario:      ["Serviços Imobiliários"],
  agronegócio:      ["Alimentos e Bebidas"],
  agronegocio:      ["Alimentos e Bebidas"],
  agro:             ["Alimentos e Bebidas"],
  infraestrutura:   ["Transporte e Logística", "Energia Elétrica", "Saneamento", "Petróleo e Gás"],
  energia:          ["Energia Elétrica", "Petróleo e Gás"],
  transporte:       ["Transporte e Logística"],
  logística:        ["Transporte e Logística"],
  logistica:        ["Transporte e Logística"],
  saneamento:       ["Saneamento"],
  saúde:            ["Assistência Médica"],
  saude:            ["Assistência Médica"],
  "assistência médica": ["Assistência Médica"],
  tecnologia:       ["TI e Telecomunicações"],
  telecomunicações: ["TI e Telecomunicações"],
  telecomunicacoes: ["TI e Telecomunicações"],
  mineração:        ["Mineração"],
  mineracao:        ["Mineração"],
  financeiro:       ["Financeiro"],
  varejo:           ["Comércio Atacadista e Varejista"],
  atacado:          ["Comércio Atacadista e Varejista"],
  comércio:         ["Comércio Atacadista e Varejista"],
  comercio:         ["Comércio Atacadista e Varejista"],
  locação:          ["Locação de Veículos"],
  locacao:          ["Locação de Veículos"],
  veículos:         ["Locação de Veículos"],
  veiculos:         ["Locação de Veículos"],
  petróleo:         ["Petróleo e Gás"],
  petroleo:         ["Petróleo e Gás"],
  gás:              ["Petróleo e Gás"],
  gas:              ["Petróleo e Gás"],
  indústria:        ["Indústria e Comércio"],
  industria:        ["Indústria e Comércio"],
};

const INDEXADOR_MAP: Record<string, string> = {
  ipca:      "IPCA SPREAD",
  cdi:       "DI SPREAD",
  di:        "DI SPREAD",
  prefixado: "PREFIXADO",
  "pré":     "PREFIXADO",
  pre:       "PREFIXADO",
  igpm:      "IPCA SPREAD", // aproximação
  igp:       "IPCA SPREAD",
};

function mapSetor(setor: string): string[] {
  const lower = setor.toLowerCase().trim();
  // Busca exata primeiro
  if (SETOR_MAP[lower]) return SETOR_MAP[lower];
  // Busca parcial
  const matched: string[] = [];
  for (const [key, vals] of Object.entries(SETOR_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      matched.push(...vals);
    }
  }
  // Deduplicar
  return matched.length > 0 ? Array.from(new Set(matched)) : [setor];
}

function mapIndexador(indexador: string): string {
  const lower = indexador.toLowerCase().trim();
  for (const [key, val] of Object.entries(INDEXADOR_MAP)) {
    if (lower.includes(key)) return val;
  }
  return indexador.toUpperCase();
}

// ── Agente 1: Orquestrador ────────────────────────────────────────────────────

export async function orchestratorAgent(
  query: string,
  onProgress: ProgressCallback
): Promise<{ attributes: SearchAttributes; searchTerms: string[] }> {
  onProgress("orquestrador", "Interpretando descrição da emissão...");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em mercado de capitais brasileiro (renda fixa estruturada).
Analise a descrição de uma emissão e extraia atributos estruturados, depois gere termos de busca criativos para encontrar emissões comparáveis no Google.

Gere termos de busca REAIS e ESPECÍFICOS que um analista usaria para pesquisar no Google — não exemplos genéricos.
Varie entre: termos técnicos, nomes de setores, termos jurídicos, termos do negócio subjacente, variações em português e inglês.
Foque em encontrar: prospectos de emissão, relatórios de gestoras, notícias financeiras, análises setoriais.

Responda APENAS com JSON válido no formato especificado.`,
      },
      {
        role: "user",
        content: `Descrição da emissão: "${query}"

Retorne JSON com:
{
  "attributes": {
    "tipo": "tipo do instrumento (CRI, CRA, Debênture, FII, CCI, etc.)",
    "finalidade": "finalidade principal do financiamento em palavras-chave concretas",
    "indexador": "indexador (IPCA, CDI, prefixado, IGPM, etc.)",
    "prazo": "prazo estimado",
    "setor": "setor econômico (imobiliário, agronegócio, infraestrutura, energia, transporte, etc.)",
    "emissor": "nome do emissor se mencionado, senão string vazia",
    "volume": "volume se mencionado, senão string vazia"
  },
  "searchTerms": [
    "10 termos de busca reais e específicos para Google",
    "ex: 'CRI aquisição terreno incorporadora prospecto'",
    "ex: 'debênture infraestrutura rodovias emissão 2024'",
    "ex: 'CRI loteamento residencial IPCA securitização'",
    "incluir termos com nomes de setores específicos, tipos de projetos, termos jurídicos",
    "incluir ao menos 2 termos em inglês quando relevante",
    "incluir ao menos 1 termo com 'prospecto' ou 'relatório gestora' ou 'emissão'"
  ]
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "orchestrator_output",
        strict: true,
        schema: {
          type: "object",
          properties: {
            attributes: {
              type: "object",
              properties: {
                tipo:       { type: "string" },
                finalidade: { type: "string" },
                indexador:  { type: "string" },
                prazo:      { type: "string" },
                setor:      { type: "string" },
                emissor:    { type: "string" },
                volume:     { type: "string" },
              },
              required: ["tipo", "finalidade", "indexador", "prazo", "setor", "emissor", "volume"],
              additionalProperties: false,
            },
            searchTerms: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["attributes", "searchTerms"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

  onProgress("orquestrador", `Atributos: ${parsed.attributes.tipo} | ${parsed.attributes.finalidade} | ${parsed.attributes.setor}`);
  return parsed;
}

// ── Agente 2: Interno ─────────────────────────────────────────────────────────

export async function internalAgent(
  attributes: SearchAttributes,
  onProgress: ProgressCallback
): Promise<ComparableResult[]> {
  onProgress("interno", "Buscando na base ANBIMA local...");

  const db = await getDb();
  if (!db) return [];

  const results: ComparableResult[] = [];

  try {
    const conditions = [];

    // Setor: mapear termos genéricos para valores reais do banco
    if (attributes.setor) {
      const setorTerms = mapSetor(attributes.setor);
      const setorConds = setorTerms.map((s) => like(anbimaAssets.setor, `%${s}%`));
      conditions.push(setorConds.length === 1 ? setorConds[0] : or(...setorConds));
    }

    // Emissor: busca por nome
    if (attributes.emissor && attributes.emissor.trim().length > 2) {
      conditions.push(like(anbimaAssets.emissorNome, `%${attributes.emissor}%`));
    }

    // Indexador: mapear para valores reais do banco
    if (attributes.indexador) {
      const mappedIdx = mapIndexador(attributes.indexador);
      conditions.push(like(anbimaAssets.indexador, `%${mappedIdx}%`));
    }

    // Se não há condições, retornar amostra representativa
    const rows = await (conditions.length > 0
      ? db.select().from(anbimaAssets).where(or(...conditions)).limit(50)
      : db.select().from(anbimaAssets).limit(20));

    for (const row of rows) {
      if (!row.emissorNome) continue;

      // Calcular relevância baseada em correspondência
      let relevancia = 50;
      if (attributes.setor) {
        const setorTerms = mapSetor(attributes.setor);
        if (setorTerms.some((s) => row.setor?.includes(s))) relevancia += 20;
      }
      if (attributes.indexador) {
        const mappedIdx = mapIndexador(attributes.indexador);
        if (row.indexador?.includes(mappedIdx.split(" ")[0])) relevancia += 15;
      }
      if (attributes.emissor && row.emissorNome?.toLowerCase().includes(attributes.emissor.toLowerCase())) {
        relevancia += 25;
      }

      results.push({
        id: `interno-${row.codigoCetip}`,
        fonte: "interno",
        titulo: `${row.tipo || "DEB"} — ${row.emissorNome}`,
        emissor: row.emissorNome || "",
        tipo: row.tipo === "DEB" ? "Debênture" : (row.tipo || "Debênture"),
        finalidade: `Emissão de ${row.tipo === "DEB" ? "debênture" : row.tipo || "debênture"} no setor de ${row.setor || "não especificado"}`,
        indexador: row.indexador || undefined,
        prazo: row.dataVencimento ? `Vencimento: ${row.dataVencimento}` : undefined,
        setor: row.setor || undefined,
        taxa: row.taxaIndicativa ? `${(Number(row.taxaIndicativa) * 100).toFixed(2)}% a.a.` : undefined,
        dataEmissao: row.dataEmissao || undefined,
        relevancia: Math.min(relevancia, 95),
        justificativa: `Ativo da base ANBIMA — ${row.emissorNome} (${row.setor || "setor não especificado"}), indexado a ${row.indexador || "não especificado"}, vencimento ${row.dataVencimento || "não especificado"}.`,
        fonteNome: "Base ANBIMA Local",
      });
    }

    onProgress("interno", `${results.length} ativos encontrados na base local`);
  } catch (e) {
    console.error("[Agente Interno] Erro:", e);
    onProgress("interno", "Erro na busca interna");
  }

  return results;
}

// ── Agente 3: Web / Notícias ──────────────────────────────────────────────────

/**
 * Busca no Google via Serper.dev API
 * Fallback: tenta Bing via Playwright se SERPER_API_KEY não estiver configurada
 */
async function searchSerper(
  term: string
): Promise<{ title: string; url: string; snippet: string }[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: term,
        gl: "br",
        hl: "pt-br",
        num: 8,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json() as {
      organic?: { title: string; link: string; snippet: string }[];
      news?: { title: string; link: string; snippet: string }[];
    };

    const items: { title: string; url: string; snippet: string }[] = [];
    for (const r of [...(data.organic || []), ...(data.news || [])]) {
      if (r.link && r.title) {
        items.push({ title: r.title, url: r.link, snippet: r.snippet || "" });
      }
    }
    return items.slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Extrai conteúdo textual de uma página via Playwright
 */
async function extractPageContent(
  url: string,
  browser: import("playwright").Browser
): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => {
      ["script", "style", "nav", "footer", "header", "aside", "iframe"].forEach((tag) => {
        document.querySelectorAll(tag).forEach((el) => el.remove());
      });
      return document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 5000) || "";
    });
    return content;
  } catch {
    return "";
  } finally {
    await page.close().catch(() => {});
  }
}

export async function webAgent(
  attributes: SearchAttributes,
  searchTerms: string[],
  onProgress: ProgressCallback
): Promise<ComparableResult[]> {
  onProgress("web", "Iniciando pesquisa na web...");

  const hasSerper = !!process.env.SERPER_API_KEY;
  if (!hasSerper) {
    onProgress("web", "⚠️ SERPER_API_KEY não configurada — busca web desativada");
    return [];
  }

  const results: ComparableResult[] = [];
  let browser: import("playwright").Browser | null = null;

  try {
    // Usar os 6 primeiros termos
    const termsToSearch = searchTerms.slice(0, 6);
    const allLinks: { title: string; url: string; snippet: string; term: string }[] = [];

    for (const term of termsToSearch) {
      onProgress("web", `Pesquisando: "${term}"`);
      const links = await searchSerper(term);
      allLinks.push(...links.map((l) => ({ ...l, term })));
    }

    // Deduplicar por URL, excluindo domínios inúteis
    const SKIP_DOMAINS = ["youtube.com", "facebook.com", "twitter.com", "instagram.com", "linkedin.com", "wikipedia.org"];
    const uniqueLinks = Array.from(
      new Map(allLinks.map((l) => [l.url, l])).values()
    ).filter((l) => !SKIP_DOMAINS.some((d) => l.url.includes(d))).slice(0, 10);

    onProgress("web", `${uniqueLinks.length} páginas encontradas, extraindo conteúdo...`);

    if (uniqueLinks.length === 0) return [];

    // Lançar Playwright para extrair conteúdo das páginas
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const pageContents: { url: string; title: string; snippet: string; content: string }[] = [];

    // Processar em lotes de 3 para não sobrecarregar
    for (let i = 0; i < Math.min(uniqueLinks.length, 8); i++) {
      const link = uniqueLinks[i];
      onProgress("web", `Lendo: ${new URL(link.url).hostname}...`);
      const content = await extractPageContent(link.url, browser);
      if (content.length > 150) {
        pageContents.push({ url: link.url, title: link.title, snippet: link.snippet, content });
      }
    }

    onProgress("web", `Analisando ${pageContents.length} páginas com IA...`);

    if (pageContents.length === 0) {
      // Usar apenas snippets dos resultados de busca como fallback
      onProgress("web", "Usando snippets dos resultados de busca...");
      const snippetContent = uniqueLinks.map((l) =>
        `Título: ${l.title}\nURL: ${l.url}\nResumo: ${l.snippet}`
      ).join("\n\n");

      return await analyzeContentWithLLM(snippetContent, attributes, uniqueLinks[0]?.url || "");
    }

    // LLM analisa o conteúdo completo
    const fullContent = pageContents.map((p, i) =>
      `--- Página ${i + 1}: ${p.title} ---\nURL: ${p.url}\nResumo: ${p.snippet}\nConteúdo: ${p.content.slice(0, 2000)}`
    ).join("\n\n");

    const llmResults = await analyzeContentWithLLM(fullContent, attributes, "");
    results.push(...llmResults);

    onProgress("web", `${results.length} emissões comparáveis encontradas na web`);
  } catch (e) {
    console.error("[Agente Web] Erro:", e);
    onProgress("web", "Erro na pesquisa web — continuando com resultados parciais");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return results;
}

async function analyzeContentWithLLM(
  content: string,
  attributes: SearchAttributes,
  fallbackUrl: string
): Promise<ComparableResult[]> {
  const llmResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um analista especializado em mercado de capitais brasileiro (renda fixa estruturada: CRI, CRA, Debêntures, FII).

MISSÃO: Extrair informações sobre emissões reais encontradas no conteúdo das páginas web.

FOCO PRINCIPAL: contexto do negócio — qual a finalidade real do financiamento, quem é a empresa, qual o projeto, qual o setor, qual a estratégia.
Taxa, prazo e volume são informações secundárias.

IMPORTANTE: Extraia apenas emissões REAIS encontradas no conteúdo. Não invente dados.`,
      },
      {
        role: "user",
        content: `Busco emissões comparáveis a: "${attributes.tipo || "renda fixa"} para ${attributes.finalidade || "financiamento"}, setor ${attributes.setor || "não especificado"}, indexador ${attributes.indexador || "não especificado"}".

Conteúdo das páginas:
${content.slice(0, 8000)}

Extraia até 8 emissões comparáveis reais encontradas neste conteúdo. Para cada uma retorne JSON com os campos solicitados.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "web_results",
        strict: true,
        schema: {
          type: "object",
          properties: {
            emissoes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  emissor:         { type: "string" },
                  tipo:            { type: "string" },
                  finalidade:      { type: "string" },
                  contexto_negocio:{ type: "string" },
                  indexador:       { type: "string" },
                  prazo:           { type: "string" },
                  volume:          { type: "string" },
                  taxa:            { type: "string" },
                  rating:          { type: "string" },
                  estruturador:    { type: "string" },
                  data_emissao:    { type: "string" },
                  relevancia:      { type: "number" },
                  justificativa:   { type: "string" },
                  url:             { type: "string" },
                },
                required: ["emissor", "tipo", "finalidade", "contexto_negocio", "indexador", "prazo", "volume", "taxa", "rating", "estruturador", "data_emissao", "relevancia", "justificativa", "url"],
                additionalProperties: false,
              },
            },
          },
          required: ["emissoes"],
          additionalProperties: false,
        },
      },
    },
  });

  const content2 = llmResponse.choices[0].message.content;
  const parsed = JSON.parse(typeof content2 === "string" ? content2 : JSON.stringify(content2));

  const results: ComparableResult[] = [];
  for (const e of parsed.emissoes || []) {
    if (!e.emissor || e.relevancia < 15) continue;
    let hostname = "web";
    try { hostname = new URL(e.url || fallbackUrl || "https://web.com").hostname.replace("www.", ""); } catch {}
    results.push({
      id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fonte: "web",
      titulo: `${e.tipo} — ${e.emissor}`,
      emissor: e.emissor,
      tipo: e.tipo,
      finalidade: e.finalidade,
      indexador: e.indexador || undefined,
      prazo: e.prazo || undefined,
      volume: e.volume || undefined,
      taxa: e.taxa || undefined,
      rating: e.rating || undefined,
      estruturador: e.estruturador || undefined,
      dataEmissao: e.data_emissao || undefined,
      relevancia: e.relevancia,
      justificativa: `${e.justificativa}\n\n**Contexto:** ${e.contexto_negocio}`,
      url: e.url || fallbackUrl || undefined,
      fonteNome: hostname,
    });
  }
  return results;
}

// ── Agente 4: Sintetizador ────────────────────────────────────────────────────

export async function synthesizerAgent(
  query: string,
  attributes: SearchAttributes,
  internalResults: ComparableResult[],
  webResults: ComparableResult[],
  onProgress: ProgressCallback
): Promise<ComparableResult[]> {
  onProgress("sintetizador", "Consolidando e ranqueando resultados...");

  const all = [...webResults, ...internalResults];
  if (all.length === 0) return [];

  // Deduplicar por emissor + tipo (manter o de maior relevância)
  const deduped = new Map<string, ComparableResult>();
  for (const r of all) {
    const key = `${r.emissor.toLowerCase().slice(0, 20)}-${r.tipo.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || r.relevancia > existing.relevancia) {
      deduped.set(key, r);
    }
  }

  const candidates = Array.from(deduped.values())
    .sort((a, b) => b.relevancia - a.relevancia)
    .slice(0, 20);

  if (candidates.length === 0) return [];

  onProgress("sintetizador", `Gerando análise comparativa de ${candidates.length} emissões...`);

  const llmResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um analista sênior de mercado de capitais brasileiro especializado em renda fixa estruturada.
Sua tarefa é produzir uma análise comparativa de emissões com foco em inteligência de negócio.
O usuário quer entender o contexto por trás das operações: quem emitiu, para quê, qual o projeto, qual a estratégia da empresa.

Pesos para relevância:
- Similaridade da finalidade/contexto de negócio: 50%
- Tipo de instrumento: 20%
- Setor econômico: 20%
- Indexador/estrutura financeira: 10%`,
      },
      {
        role: "user",
        content: `Busca original: "${query}"
Atributos identificados: tipo=${attributes.tipo}, finalidade=${attributes.finalidade}, setor=${attributes.setor}, indexador=${attributes.indexador}

Emissões candidatas:
${candidates.map((c, i) => `${i + 1}. [${c.fonte.toUpperCase()}] ${c.titulo}
   Setor: ${c.setor || "não especificado"}
   Finalidade: ${c.finalidade}
   Indexador: ${c.indexador || "não especificado"}
   Relevância atual: ${c.relevancia}
`).join("\n")}

Reavalie cada emissão e retorne JSON com relevâncias atualizadas e nota do analista.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "synthesis_output",
        strict: true,
        schema: {
          type: "object",
          properties: {
            ranked: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index:            { type: "number" },
                  relevancia_final: { type: "number" },
                  nota_analista:    { type: "string" },
                },
                required: ["index", "relevancia_final", "nota_analista"],
                additionalProperties: false,
              },
            },
          },
          required: ["ranked"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = llmResponse.choices[0].message.content;
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

  const finalResults: ComparableResult[] = [];
  for (const r of parsed.ranked || []) {
    const idx = r.index - 1;
    if (idx >= 0 && idx < candidates.length) {
      const candidate = { ...candidates[idx] };
      candidate.relevancia = r.relevancia_final;
      if (r.nota_analista) {
        candidate.justificativa = `${candidate.justificativa}\n\n**Nota do analista:** ${r.nota_analista}`;
      }
      finalResults.push(candidate);
    }
  }

  finalResults.sort((a, b) => b.relevancia - a.relevancia);
  onProgress("sintetizador", `Análise concluída — ${finalResults.length} emissões ranqueadas`);
  return finalResults;
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function runComparableSearch(
  query: string,
  onProgress: ProgressCallback
): Promise<{ attributes: SearchAttributes; searchTerms: string[]; results: ComparableResult[] }> {
  // 1. Orquestrador
  const { attributes, searchTerms } = await orchestratorAgent(query, onProgress);

  // 2. Agentes em paralelo (interno + web)
  onProgress("paralelo", "Executando agentes em paralelo...");
  const [internalResults, webResults] = await Promise.all([
    internalAgent(attributes, onProgress),
    webAgent(attributes, searchTerms, onProgress),
  ]);

  // 3. Sintetizador (só se houver resultados)
  const allRaw = [...internalResults, ...webResults];
  if (allRaw.length === 0) {
    onProgress("sintetizador", "Nenhum resultado encontrado para sintetizar");
    return { attributes, searchTerms, results: [] };
  }

  const finalResults = await synthesizerAgent(query, attributes, internalResults, webResults, onProgress);
  return { attributes, searchTerms, results: finalResults };
}
