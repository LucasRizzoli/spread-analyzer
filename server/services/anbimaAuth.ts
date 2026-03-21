/**
 * Serviço de autenticação OAuth2 para a ANBIMA Feed API
 * Endpoint: https://api.anbima.com.br/feed/precos-indices/v1/
 */

const ANBIMA_TOKEN_URL = "https://api.anbima.com.br/oauth/access-token";
const ANBIMA_BASE_URL = "https://api.anbima.com.br/feed/precos-indices/v1";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAnbimaToken(): Promise<string> {
  const now = Date.now();

  // Retorna token em cache se ainda válido (com margem de 60s)
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.ANBIMA_CLIENT_ID;
  const clientSecret = process.env.ANBIMA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("ANBIMA_CLIENT_ID e ANBIMA_CLIENT_SECRET são obrigatórios");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(ANBIMA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });

  if (response.status !== 200 && response.status !== 201) {
    const body = await response.text();
    throw new Error(`Falha ao obter token ANBIMA: ${response.status} — ${body}`);
  }

  const data = (await response.json()) as TokenResponse;

  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return cachedToken.token;
}

export async function anbimaFetch<T>(path: string): Promise<T> {
  const token = await getAnbimaToken();

  // A ANBIMA usa headers proprietários: client_id + access_token (não Authorization: Bearer)
  // Ref: https://developers.anbima.com.br/pt/documentacao/precos-indices/autenticacao/
  const response = await fetch(`${ANBIMA_BASE_URL}${path}`, {
    headers: {
      "client_id": process.env.ANBIMA_CLIENT_ID!,
      "access_token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ANBIMA Feed API error ${response.status} for ${path}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export { ANBIMA_BASE_URL };
