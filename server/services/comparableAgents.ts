/**
 * Sistema de Multi-Agentes para Busca de Emissões Comparáveis
 *
 * Agentes:
 *  1. Orquestrador — extrai atributos estruturados e gera termos de busca criativos
 *  2. Interno      — busca na base ANBIMA local (~1.284 ativos)
 *  3. Web          — Google Search + visita a fontes (gestoras, CVM, notícias)
 *  4. Sintetizador — consolida, deduplicata e gera relatório com contexto de negócio
 */

import { invokeLLM } from "../_core/llm";
import { chromium } from "playwright";
import { getDb } from "../db";
import { anbimaAssets } from "../../drizzle/schema";
import { like, or } from "drizzle-orm";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface ComparableResult {
  id: string;
  fonte: "interno" | "web" | "noticia";
  titulo: string;
  emissor: string;
  tipo: string; // CRI, CRA, Debênture, etc.
  finalidade: string; // contexto do negócio — o mais importante
  indexador?: string;
  prazo?: string;
  volume?: string;
  taxa?: string;
  rating?: string;
  setor?: string;
  estruturador?: string;
  dataEmissao?: string;
  relevancia: number; // 0–100
  justificativa: string; // por que é comparável
  url?: string;
  fonteNome?: string;
}

export interface SearchAttributes {
  tipo?: string;        // CRI, CRA, Debênture, FII, etc.
  finalidade?: string;  // "terreno", "obra", "fábrica", etc.
  indexador?: string;   // IPCA, CDI, prefixado
  prazo?: string;       // "curto", "médio", "longo" ou "X anos"
  setor?: string;       // imobiliário, agro, infraestrutura, etc.
  emissor?: string;     // nome da empresa se mencionado
  volume?: string;      // tamanho da emissão se mencionado
}

export interface ProgressCallback {
  (step: string, detail?: string): void;
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
Analise a descrição de uma emissão e extraia atributos estruturados, depois gere termos de busca criativos para encontrar emissões comparáveis.

Responda APENAS com JSON válido no formato especificado.`,
      },
      {
        role: "user",
        content: `Descrição da emissão: "${query}"

Retorne JSON com:
{
  "attributes": {
    "tipo": "tipo do instrumento (CRI, CRA, Debênture, FII, CCI, etc.)",
    "finalidade": "finalidade principal do financiamento em palavras-chave",
    "indexador": "indexador (IPCA, CDI, prefixado, IGPM, etc.)",
    "prazo": "prazo estimado",
    "setor": "setor econômico (imobiliário, agronegócio, infraestrutura, energia, etc.)",
    "emissor": "nome do emissor se mencionado",
    "volume": "volume se mencionado"
  },
  "searchTerms": [
    "array com 8 a 12 termos de busca criativos para Google",
    "cada termo deve ser uma string com 2-5 palavras entre aspas quando necessário",
    "variar entre: termos técnicos, nomes de setores, termos jurídicos, termos de negócio",
    "incluir variações em português e inglês quando relevante",
    "focar em encontrar: prospectos, relatórios de gestoras, notícias, análises"
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
                tipo: { type: "string" },
                finalidade: { type: "string" },
                indexador: { type: "string" },
                prazo: { type: "string" },
                setor: { type: "string" },
                emissor: { type: "string" },
                volume: { type: "string" },
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

  onProgress("orquestrador", `Atributos extraídos: ${parsed.attributes.tipo} | ${parsed.attributes.finalidade} | ${parsed.attributes.setor}`);
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
    // Busca por setor, emissor, remuneração (indexador), tipo
    const conditions = [];
    if (attributes.setor) {
      conditions.push(like(anbimaAssets.setor, `%${attributes.setor}%`));
    }
    if (attributes.emissor) {
      conditions.push(like(anbimaAssets.emissorNome, `%${attributes.emissor}%`));
    }
    if (attributes.indexador) {
      const idx = attributes.indexador.toUpperCase();
      conditions.push(
        or(
          like(anbimaAssets.remuneracao, `%${idx}%`),
          like(anbimaAssets.indexador, `%${idx}%`)
        )
      );
    }

    const query = conditions.length > 0
      ? db.select().from(anbimaAssets).where(or(...conditions)).limit(50)
      : db.select().from(anbimaAssets).limit(30);

    const rows = await query;

    for (const row of rows) {
      if (!row.emissorNome) continue;
      results.push({
        id: `interno-${row.codigoCetip}`,
        fonte: "interno",
        titulo: `${row.codigoCetip} — ${row.emissorNome}`,
        emissor: row.emissorNome || "",
        tipo: row.tipo || "Debênture",
        finalidade: row.remuneracao || "Não especificada",
        indexador: row.indexador || undefined,
        prazo: row.dataVencimento ? `Vencimento: ${row.dataVencimento}` : undefined,
        setor: row.setor || undefined,
        dataEmissao: row.dataEmissao || undefined,
        relevancia: 60,
        justificativa: `Ativo da base ANBIMA local — ${row.emissorNome}, ${row.indexador || ""}`,
        fonteNome: "Base ANBIMA Local",
      });
    }

    onProgress("interno", `${results.length} ativos encontrados na base local`);
  } catch (e) {
    console.error("[Agente Interno] Erro:", e);
  }

  return results;
}

// ── Agente 3: Web / Notícias ──────────────────────────────────────────────────

const SEARCH_SOURCES = [
  "site:anbima.com.br",
  "site:cvm.gov.br",
  "site:b3.com.br",
  "site:infomoney.com.br",
  "site:valoreconomico.com.br",
  "site:braziljournal.com",
  "site:kinea.com.br OR site:vinci.com.br OR site:btgpactual.com OR site:xpasset.com.br",
];

async function searchGoogle(term: string, browser: import("playwright").Browser): Promise<{ title: string; url: string; snippet: string }[]> {
  const page = await browser.newPage();
  const results: { title: string; url: string; snippet: string }[] = [];
  try {
    const query = encodeURIComponent(term);
    await page.goto(`https://www.google.com/search?q=${query}&num=5&hl=pt-BR`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(1500);

    const items = await page.evaluate(() => {
      const results: { title: string; url: string; snippet: string }[] = [];
      const divs = document.querySelectorAll("div.g, div[data-sokoban-container]");
      divs.forEach((div) => {
        const a = div.querySelector("a[href]") as HTMLAnchorElement;
        const h3 = div.querySelector("h3");
        const snippet = div.querySelector("div[data-sncf], div.VwiC3b, span.aCOpRe");
        if (a && h3 && a.href.startsWith("http") && !a.href.includes("google.com")) {
          results.push({
            title: h3.textContent || "",
            url: a.href,
            snippet: snippet?.textContent || "",
          });
        }
      });
      return results.slice(0, 5);
    });
    results.push(...items);
  } catch {
    // ignora erros de busca
  } finally {
    await page.close();
  }
  return results;
}

async function extractPageContent(url: string, browser: import("playwright").Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1000);
    const content = await page.evaluate(() => {
      // Remover scripts, styles, nav, footer
      ["script", "style", "nav", "footer", "header", "aside"].forEach((tag) => {
        document.querySelectorAll(tag).forEach((el) => el.remove());
      });
      return document.body?.innerText?.slice(0, 4000) || "";
    });
    return content;
  } catch {
    return "";
  } finally {
    await page.close();
  }
}

export async function webAgent(
  attributes: SearchAttributes,
  searchTerms: string[],
  onProgress: ProgressCallback
): Promise<ComparableResult[]> {
  onProgress("web", "Iniciando pesquisa na web...");

  const results: ComparableResult[] = [];
  let browser: import("playwright").Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

    // Selecionar os 5 termos mais relevantes para não demorar demais
    const termsToSearch = searchTerms.slice(0, 5);
    const allLinks: { title: string; url: string; snippet: string; term: string }[] = [];

    for (const term of termsToSearch) {
      onProgress("web", `Pesquisando: "${term}"`);
      const links = await searchGoogle(term, browser);
      allLinks.push(...links.map((l) => ({ ...l, term })));
    }

    // Deduplicar por URL
    const uniqueLinks = Array.from(
      new Map(allLinks.map((l) => [l.url, l])).values()
    ).slice(0, 10); // visitar no máximo 10 páginas

    onProgress("web", `${uniqueLinks.length} páginas únicas encontradas, extraindo conteúdo...`);

    // Extrair conteúdo das páginas mais relevantes
    const pageContents: { url: string; title: string; snippet: string; content: string }[] = [];
    for (const link of uniqueLinks.slice(0, 8)) {
      onProgress("web", `Lendo: ${link.url.slice(0, 60)}...`);
      const content = await extractPageContent(link.url, browser);
      if (content.length > 200) {
        pageContents.push({ url: link.url, title: link.title, snippet: link.snippet, content });
      }
    }

    onProgress("web", `Analisando ${pageContents.length} páginas com IA...`);

    if (pageContents.length === 0) return [];

    // LLM analisa o conteúdo e extrai emissões comparáveis
    const llmResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um analista especializado em mercado de capitais brasileiro.
Analise o conteúdo de páginas web e extraia informações sobre emissões de renda fixa estruturada (CRI, CRA, Debêntures, FII, etc.) que sejam comparáveis à operação descrita.

FOCO PRINCIPAL: contexto do negócio — qual a finalidade real do financiamento, quem é a empresa, qual o projeto, qual o setor.
Taxa, prazo e volume são secundários.

Retorne APENAS JSON válido.`,
        },
        {
          role: "user",
          content: `Busco emissões comparáveis a: "${attributes.tipo || ""} para ${attributes.finalidade || ""}, setor ${attributes.setor || ""}, indexador ${attributes.indexador || ""}".

Conteúdo das páginas encontradas:
${pageContents.map((p, i) => `
--- Página ${i + 1}: ${p.title} ---
URL: ${p.url}
Snippet: ${p.snippet}
Conteúdo: ${p.content.slice(0, 1500)}
`).join("\n")}

Extraia até 8 emissões comparáveis encontradas nestas páginas. Para cada uma retorne:
{
  "emissor": "nome da empresa emissora",
  "tipo": "CRI/CRA/Debênture/etc",
  "finalidade": "descrição detalhada da finalidade — o que a empresa vai fazer com o dinheiro, qual o projeto, qual o ativo subjacente",
  "contexto_negocio": "contexto mais amplo: setor, momento de mercado, estratégia da empresa",
  "indexador": "indexador se encontrado",
  "prazo": "prazo se encontrado",
  "volume": "volume se encontrado (R$ X mi/bi)",
  "taxa": "taxa se encontrada",
  "rating": "rating se encontrado",
  "estruturador": "banco/gestora estruturadora se encontrado",
  "data_emissao": "data aproximada se encontrada",
  "relevancia": número de 0 a 100 indicando similaridade com a busca,
  "justificativa": "por que esta emissão é comparável — foque no contexto de negócio",
  "url": "URL da fonte"
}`,
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
                    emissor: { type: "string" },
                    tipo: { type: "string" },
                    finalidade: { type: "string" },
                    contexto_negocio: { type: "string" },
                    indexador: { type: "string" },
                    prazo: { type: "string" },
                    volume: { type: "string" },
                    taxa: { type: "string" },
                    rating: { type: "string" },
                    estruturador: { type: "string" },
                    data_emissao: { type: "string" },
                    relevancia: { type: "number" },
                    justificativa: { type: "string" },
                    url: { type: "string" },
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

    const content = llmResponse.choices[0].message.content;
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

    for (const e of parsed.emissoes || []) {
      if (!e.emissor || e.relevancia < 20) continue;
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
        justificativa: `${e.justificativa}\n\nContexto: ${e.contexto_negocio}`,
        url: e.url || undefined,
        fonteNome: new URL(e.url || "https://web.com").hostname.replace("www.", ""),
      });
    }

    onProgress("web", `${results.length} emissões comparáveis encontradas na web`);
  } catch (e) {
    console.error("[Agente Web] Erro:", e);
    onProgress("web", "Erro na pesquisa web — continuando com resultados parciais");
  } finally {
    await browser?.close();
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
    const key = `${r.emissor.toLowerCase()}-${r.tipo.toLowerCase()}`;
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

  // LLM faz a síntese final com foco em contexto de negócio
  const llmResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um analista sênior de mercado de capitais brasileiro especializado em renda fixa estruturada.
Sua tarefa é produzir uma análise comparativa de emissões, com foco em inteligência de negócio — não apenas números.
O usuário quer entender o contexto por trás das operações: quem emitiu, para quê, qual o projeto, qual a estratégia.`,
      },
      {
        role: "user",
        content: `Busca original: "${query}"
Atributos: ${JSON.stringify(attributes)}

Emissões candidatas encontradas:
${candidates.map((c, i) => `${i + 1}. ${c.titulo}
   Finalidade: ${c.finalidade}
   Justificativa: ${c.justificativa}
   Relevância atual: ${c.relevancia}
   Fonte: ${c.fonteNome || c.fonte}
`).join("\n")}

Reavalie a relevância de cada emissão (0-100) considerando:
- Similaridade da finalidade/contexto de negócio (peso 50%)
- Tipo de instrumento (peso 20%)
- Setor econômico (peso 20%)
- Indexador/estrutura financeira (peso 10%)

Retorne JSON com o array reordenado e relevâncias atualizadas.`,
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
                  index: { type: "number" },
                  relevancia_final: { type: "number" },
                  nota_analista: { type: "string" },
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

  // Ordenar por relevância final
  finalResults.sort((a, b) => b.relevancia - a.relevancia);

  onProgress("sintetizador", `Análise concluída — ${finalResults.length} emissões comparáveis ranqueadas`);
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

  // 3. Sintetizador
  const finalResults = await synthesizerAgent(query, attributes, internalResults, webResults, onProgress);

  return { attributes, searchTerms, results: finalResults };
}
