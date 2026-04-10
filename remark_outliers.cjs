/**
 * Script para remarcar outliers no banco usando o algoritmo adaptativo restaurado:
 * - n < 5: sem remoção
 * - 5 ≤ n < 10: ±2σ amostral
 * - 10 ≤ n < 20: ±2,5σ amostral
 * - n ≥ 20: winsorização 10% (P10–P90)
 *
 * Agrupa por rating + universo (IPCA, DI_SPREAD, DI_PCT) e por dataReferencia.
 */
const mysql = require("mysql2/promise");

function getUniverso(indexador) {
  const t = (indexador || "").toUpperCase();
  if (t.includes("IPCA")) return "IPCA";
  if (t === "DI SPREAD" || t.includes("DI SPREAD")) return "DI_SPREAD";
  if (t === "DI PERCENTUAL" || t.includes("DI PERCENTUAL")) return "DI_PCT";
  if (t.includes("DI")) return "DI_SPREAD";
  return "OUTRO";
}

(async () => {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: Number(m[4]), user: m[1], password: m[2],
    database: m[5].split("?")[0], ssl: { rejectUnauthorized: false }
  });

  // Buscar todos os registros com spread
  const [rows] = await conn.execute(
    `SELECT id, rating, indexador, zspread, dataReferencia FROM spread_analysis WHERE zspread IS NOT NULL`
  );

  // Agrupar por dataReferencia + rating + universo
  const groups = new Map();
  for (const r of rows) {
    const universo = getUniverso(r.indexador);
    const key = `${r.dataReferencia}|${r.rating}|${universo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: r.id, spread: Number(r.zspread) });
  }

  const outlierIds = new Set();
  const stats = [];

  for (const [key, group] of groups.entries()) {
    const n = group.length;
    const spreads = group.map(g => g.spread);

    if (n < 5) continue;

    let cutLow, cutHigh, mean = 0, stdDev = 0;

    if (n >= 20) {
      const sorted = [...spreads].sort((a, b) => a - b);
      const k = Math.floor(n * 0.10);
      cutLow  = sorted[k];
      cutHigh = sorted[n - 1 - k];
      const core = sorted.slice(k, n - k);
      mean = core.reduce((s, v) => s + v, 0) / core.length;
      const variance = core.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / core.length;
      stdDev = Math.sqrt(variance);
    } else {
      const sigma = n >= 10 ? 2.5 : 2.0;
      mean = spreads.reduce((s, v) => s + v, 0) / n;
      const variance = spreads.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
      stdDev = Math.sqrt(variance);
      cutLow  = mean - sigma * stdDev;
      cutHigh = mean + sigma * stdDev;
    }

    let outliers = 0;
    for (const item of group) {
      if (item.spread < cutLow || item.spread > cutHigh) {
        outlierIds.add(item.id);
        outliers++;
      }
    }

    if (outliers > 0) {
      stats.push({ key, n, outliers, cutLow: (cutLow*10000).toFixed(0), cutHigh: (cutHigh*10000).toFixed(0), mean: (mean*10000).toFixed(0) });
    }
  }

  console.log(`\nTotal de registros: ${rows.length}`);
  console.log(`Grupos com n≥5: ${[...groups.values()].filter(g => g.length >= 5).length}`);
  console.log(`Outliers identificados: ${outlierIds.size}`);

  if (stats.length > 0) {
    console.log("\nGrupos com outliers:");
    for (const s of stats) {
      console.log(`  ${s.key}: n=${s.n}, ${s.outliers} outliers, corte=[${s.cutLow}, ${s.cutHigh}] bps, mean=${s.mean} bps`);
    }
  }

  // Primeiro: zerar todos os outliers
  await conn.execute(`UPDATE spread_analysis SET isOutlier = 0`);

  // Depois: marcar os outliers identificados
  if (outlierIds.size > 0) {
    const ids = [...outlierIds].join(",");
    await conn.execute(`UPDATE spread_analysis SET isOutlier = 1 WHERE id IN (${ids})`);
  }

  console.log(`\n✓ Banco atualizado: ${outlierIds.size} outliers marcados.`);

  await conn.end();
})();
