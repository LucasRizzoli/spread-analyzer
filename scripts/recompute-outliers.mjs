/**
 * Script para re-executar o algoritmo adaptativo de outliers
 * sobre os dados atuais do banco sem precisar de um novo upload.
 *
 * Uso: node scripts/recompute-outliers.mjs
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Buscar todos os registros da data mais recente
const [rows] = await conn.execute(
  `SELECT id, rating, indexador, CAST(zspread AS DECIMAL(10,6)) as zspread
   FROM spread_analysis
   WHERE dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis)
   ORDER BY rating, indexador, CAST(zspread AS DECIMAL(10,6))`
);

console.log(`Registros encontrados: ${rows.length}`);

// 2. Agrupar por rating + universo
const getUniverso = (indexador) => {
  const t = (indexador || "").toUpperCase();
  if (t.includes("IPCA")) return "IPCA";
  if (t === "DI SPREAD" || t.includes("DI SPREAD")) return "DI_SPREAD";
  if (t === "DI PERCENTUAL" || t.includes("DI PERCENTUAL")) return "DI_PCT";
  if (t.includes("DI")) return "DI_SPREAD";
  return "OUTRO";
};

const byGroup = new Map();
for (const r of rows) {
  const universo = getUniverso(r.indexador);
  const key = `${r.rating}|${universo}`;
  if (!byGroup.has(key)) byGroup.set(key, []);
  byGroup.get(key).push(r);
}

// 3. Calcular outliers por grupo com algoritmo adaptativo
const outlierIds = new Set();
const nonOutlierIds = new Set();

for (const [key, group] of byGroup.entries()) {
  const n = group.length;
  const spreads = group.map((r) => parseFloat(r.zspread));

  if (n < 5) {
    console.log(`  ${key}: n=${n} → sem remoção (amostra insuficiente)`);
    group.forEach((r) => nonOutlierIds.add(r.id));
    continue;
  }

  let cutLow, cutHigh;

  if (n >= 20) {
    // Winsorização 10%
    const sorted = [...spreads].sort((a, b) => a - b);
    const k = Math.floor(n * 0.10);
    cutLow  = sorted[k];
    cutHigh = sorted[n - 1 - k];
    console.log(`  ${key}: n=${n} → winsorização 10% | corte: [${cutLow.toFixed(4)}, ${cutHigh.toFixed(4)}]`);
  } else {
    // Z-score adaptativo
    const sigma = n >= 10 ? 2.5 : 2.0;
    const mean = spreads.reduce((s, v) => s + v, 0) / n;
    const variance = spreads.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
    const stdDev = Math.sqrt(variance);
    cutLow  = mean - sigma * stdDev;
    cutHigh = mean + sigma * stdDev;
    console.log(`  ${key}: n=${n} → ±${sigma}σ | média=${mean.toFixed(4)} σ=${stdDev.toFixed(4)} | corte: [${cutLow.toFixed(4)}, ${cutHigh.toFixed(4)}]`);
  }

  let groupOutliers = 0;
  for (let i = 0; i < group.length; i++) {
    const v = spreads[i];
    if (v < cutLow || v > cutHigh) {
      outlierIds.add(group[i].id);
      groupOutliers++;
    } else {
      nonOutlierIds.add(group[i].id);
    }
  }
  console.log(`    → ${groupOutliers} outliers marcados`);
}

console.log(`\nTotal outliers: ${outlierIds.size} / ${rows.length}`);

// 4. Atualizar banco
if (outlierIds.size > 0) {
  const ids = Array.from(outlierIds).join(",");
  await conn.execute(`UPDATE spread_analysis SET isOutlier = 1 WHERE id IN (${ids})`);
  console.log(`✓ ${outlierIds.size} registros marcados como outlier`);
}

if (nonOutlierIds.size > 0) {
  const ids = Array.from(nonOutlierIds).join(",");
  await conn.execute(`UPDATE spread_analysis SET isOutlier = 0 WHERE id IN (${ids})`);
  console.log(`✓ ${nonOutlierIds.size} registros desmarcados como outlier`);
}

await conn.end();
console.log("\nConcluído.");
