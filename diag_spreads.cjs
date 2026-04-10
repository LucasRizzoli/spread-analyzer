const mysql = require("mysql2/promise");

(async () => {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: Number(m[4]), user: m[1], password: m[2],
    database: m[5].split("?")[0], ssl: { rejectUnauthorized: false }
  });

  const [rows] = await conn.execute(
    `SELECT rating, indexador, zspread, codigoCetip, isOutlier
     FROM spread_analysis
     WHERE zspread IS NOT NULL AND indexador LIKE '%IPCA%'
     ORDER BY rating, CAST(zspread AS DECIMAL(10,6))`
  );

  // Agrupar por rating
  const groups = new Map();
  for (const r of rows) {
    const key = r.rating;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ cetip: r.codigoCetip, spread: Number(r.zspread) * 10000, outlier: r.isOutlier });
  }

  console.log("\n=== SPREADS IPCA+ POR RATING (em bps) ===\n");
  for (const [rating, group] of groups.entries()) {
    const spreads = group.map(g => g.spread);
    const n = spreads.length;
    const mean = spreads.reduce((s,v) => s+v, 0) / n;
    const std = n > 1 ? Math.sqrt(spreads.reduce((s,v) => s + Math.pow(v-mean,2), 0) / (n-1)) : 0;
    const min = Math.min(...spreads);
    const max = Math.max(...spreads);
    const cut3sigma_hi = mean + 3 * std;
    const cut2sigma_hi = mean + 2 * std;
    const cut25sigma_hi = mean + 2.5 * std;
    const outliers3 = spreads.filter(s => s > cut3sigma_hi || s < mean - 3*std).length;
    const outliers2 = spreads.filter(s => s > cut2sigma_hi || s < mean - 2*std).length;
    const outliers25 = spreads.filter(s => s > cut25sigma_hi || s < mean - 2.5*std).length;
    const currentOutliers = group.filter(g => g.outlier).length;

    console.log(`${rating} (n=${n})`);
    console.log(`  Spreads: min=${min.toFixed(0)} | mean=${mean.toFixed(0)} | max=${max.toFixed(0)} | std=${std.toFixed(0)} bps`);
    console.log(`  Corte ±3σ: [${(mean-3*std).toFixed(0)}, ${cut3sigma_hi.toFixed(0)}] → ${outliers3} outliers`);
    console.log(`  Corte ±2,5σ: [${(mean-2.5*std).toFixed(0)}, ${cut25sigma_hi.toFixed(0)}] → ${outliers25} outliers`);
    console.log(`  Corte ±2σ: [${(mean-2*std).toFixed(0)}, ${cut2sigma_hi.toFixed(0)}] → ${outliers2} outliers`);
    console.log(`  Atualmente marcados: ${currentOutliers}`);
    if (max > cut3sigma_hi) {
      const outlierPapeis = group.filter(g => g.spread > cut3sigma_hi);
      console.log(`  Papéis acima de ±3σ: ${outlierPapeis.map(g => `${g.cetip}(${g.spread.toFixed(0)}bps)`).join(', ')}`);
    }
    console.log();
  }

  await conn.end();
})();
