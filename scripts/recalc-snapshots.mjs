/**
 * Recalcula os snapshots históricos para cada data existente no banco,
 * usando apenas os papéis daquela data específica (não o acumulado).
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

// Ler DATABASE_URL do ambiente (injetado pelo servidor)
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}

const conn = await mysql.createConnection(dbUrl);

// 1. Buscar todas as datas distintas
const [dates] = await conn.execute(
  'SELECT DISTINCT dataReferencia FROM spread_analysis WHERE dataReferencia IS NOT NULL ORDER BY dataReferencia'
);
console.log(`Datas encontradas: ${dates.map(r => r.dataReferencia).join(', ')}`);

// 2. Para cada data, calcular os snapshots corretos
for (const { dataReferencia } of dates) {
  console.log(`\nProcessando data: ${dataReferencia}`);

  const [rows] = await conn.execute(
    `SELECT rating, zspread, indexador
     FROM spread_analysis
     WHERE isOutlier = 0
       AND zspread IS NOT NULL
       AND dataReferencia = ?`,
    [dataReferencia]
  );

  // Agrupar por indexador + rating
  const groups = new Map();
  for (const row of rows) {
    if (!row.rating || row.zspread == null) continue;
    const zs = parseFloat(row.zspread);
    if (!isFinite(zs)) continue;
    const idx = row.indexador || 'OUTROS';
    const key = `${idx}|||${row.rating}`;
    if (!groups.has(key)) groups.set(key, { indexador: idx, rating: row.rating, vals: [] });
    groups.get(key).vals.push(zs);
  }

  const calcPercentile = (sorted, p) => {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  };

  for (const { indexador, rating, vals } of groups.values()) {
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    const media = sorted.reduce((s, v) => s + v, 0) / n;
    const mediana = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const p25 = calcPercentile(sorted, 25);
    const p75 = calcPercentile(sorted, 75);
    const variance = sorted.reduce((s, v) => s + Math.pow(v - media, 2), 0) / n;
    const std = Math.sqrt(variance);

    // UPSERT: chave única (dataRefFim, indexador, rating)
    await conn.execute(
      `INSERT INTO historical_snapshots
         (snapshotAt, dataRefIni, dataRefFim, indexador, rating, nPapeis,
          mediaSpread, medianaSpread, p25Spread, p75Spread, stdSpread, createdAt)
       VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         snapshotAt = NOW(),
         dataRefIni = VALUES(dataRefIni),
         nPapeis = VALUES(nPapeis),
         mediaSpread = VALUES(mediaSpread),
         medianaSpread = VALUES(medianaSpread),
         p25Spread = VALUES(p25Spread),
         p75Spread = VALUES(p75Spread),
         stdSpread = VALUES(stdSpread)`,
      [
        dataReferencia, dataReferencia, indexador, rating, n,
        media.toFixed(4), mediana.toFixed(4),
        p25.toFixed(4), p75.toFixed(4), std.toFixed(4)
      ]
    );
    console.log(`  ${indexador} | ${rating}: n=${n}, média=${(media*100).toFixed(2)}bps`);
  }
}

await conn.end();
console.log('\nSnapshots recalculados com sucesso!');
