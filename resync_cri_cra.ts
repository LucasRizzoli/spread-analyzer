/**
 * Script para re-sincronizar dados CRI/CRA usando o arquivo já no S3.
 */
import https from "https";
import { runCriCraSync } from "./server/services/criCraSyncService";

function download(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

const S3_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663462519828/ibSgD3x7K24f8UHUmWHZV3/cri-cra/1776107381684-certificados-recebiveis-precos-13-04-2026-12-45-51.xls";

console.log("[ResyncCriCra] Baixando arquivo do S3...");
const buffer = await download(S3_URL);
console.log(`[ResyncCriCra] Arquivo baixado: ${buffer.length} bytes`);

console.log("[ResyncCriCra] Iniciando sync...");
const result = await runCriCraSync(buffer);
console.log("[ResyncCriCra] Resultado:", JSON.stringify(result, null, 2));
process.exit(0);
