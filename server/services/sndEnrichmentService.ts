/**
 * Serviço de enriquecimento via SND (Sistema Nacional de Debêntures)
 * Fonte: debentures.com.br — API pública que retorna código CETIP → número de emissão + ISIN
 *
 * Exemplo de resposta TSV:
 * AEGPB5  AEGEA SANEAMENTO E PARTICIPACOES S/A  UNI  025  -  Registrado  BRAEGPDBS0M5  ...
 *
 * O número de emissão no SND é o campo "Emissao" (4ª coluna, base 1-indexed).
 * O código CETIP NÃO codifica o número de emissão diretamente.
 */

const SND_BASE_URL =
  "https://www.debentures.com.br/exploreosnd/consultaadados/emissoesdedebentures/caracteristicas_e.asp";

export interface SndRecord {
  codigoCetip: string;
  empresa: string;
  serie: string;
  numeroEmissao: number;
  isin: string;
}

// Cache em memória para evitar requisições repetidas durante uma sincronização
const cache = new Map<string, SndRecord | null>();

/**
 * Consulta o SND para um único código CETIP.
 * Retorna null se o código não for encontrado ou a requisição falhar.
 */
export async function fetchSndRecord(codigoCetip: string): Promise<SndRecord | null> {
  const key = codigoCetip.toUpperCase();

  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  try {
    const url = `${SND_BASE_URL}?op_exc=N&ativo=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SpreadAnalyzer/1.0)" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      cache.set(key, null);
      return null;
    }

    const text = await res.text();
    const record = parseSndResponse(text, key);
    cache.set(key, record);
    return record;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/**
 * Enriquece um lote de códigos CETIP em paralelo (com concorrência limitada).
 * Retorna um Map de codigoCetip → SndRecord (apenas os encontrados).
 */
export async function enrichBatch(
  codigos: string[],
  concurrency = 8,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, SndRecord>> {
  const result = new Map<string, SndRecord>();
  const unique = Array.from(new Set(codigos.map((c) => c.toUpperCase())));
  let done = 0;

  // Processar em chunks de `concurrency`
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const records = await Promise.all(chunk.map((c) => fetchSndRecord(c)));

    records.forEach((rec, idx) => {
      if (rec) result.set(chunk[idx], rec);
    });

    done += chunk.length;
    onProgress?.(done, unique.length);

    // Pequeno delay entre chunks para não sobrecarregar o servidor
    if (i + concurrency < unique.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return result;
}

/**
 * Limpa o cache em memória (útil entre sincronizações).
 */
export function clearSndCache(): void {
  cache.clear();
}

// ─── Parser interno ───────────────────────────────────────────────────────────

function parseSndResponse(text: string, codigoCetip: string): SndRecord | null {
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // A linha de dados começa com o código CETIP
    if (!trimmed.toUpperCase().startsWith(codigoCetip.toUpperCase())) continue;

    const parts = trimmed.split("\t").map((s) => s.trim());
    if (parts.length < 7) continue;

    const codigo = parts[0];
    const empresa = parts[1];
    const serie = parts[2];
    const emissaoStr = parts[3];
    const isin = parts[6];

    const numeroEmissao = parseInt(emissaoStr, 10);
    if (!codigo || isNaN(numeroEmissao)) continue;

    return {
      codigoCetip: codigo,
      empresa,
      serie,
      numeroEmissao,
      isin,
    };
  }

  return null;
}
