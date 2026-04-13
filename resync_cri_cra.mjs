/**
 * Script para re-sincronizar dados CRI/CRA usando o arquivo já no S3.
 * Executa runCriCraSync com o buffer do arquivo baixado.
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import https from "https";
import http from "http";

// Baixar o arquivo do S3
const S3_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663462519828/ibSgD3x7K24f8UHUmWHZV3/cri-cra/1776107381684-certificados-recebiveis-precos-13-04-2026-12-45-51.xls";

function download(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

console.log("[ResyncCriCra] Baixando arquivo do S3...");
const buffer = await download(S3_URL);
console.log(`[ResyncCriCra] Arquivo baixado: ${buffer.length} bytes`);

// Importar o serviço de sync
const { runCriCraSync } = await import("./server/services/criCraSyncService.js");

console.log("[ResyncCriCra] Iniciando sync...");
const result = await runCriCraSync(buffer);
console.log("[ResyncCriCra] Resultado:", JSON.stringify(result, null, 2));
