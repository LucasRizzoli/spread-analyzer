import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Buscar todos os dados sem filtro de outlier
const [rows] = await conn.execute(`
  SELECT rating, indexador, zspread, isOutlier, tipo
  FROM spread_analysis
  WHERE (
    (tipo = 'DEB' AND dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis WHERE tipo = 'DEB'))
    OR (tipo IN ('CRI','CRA') AND dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis WHERE tipo IN ('CRI','CRA')))
  )
  AND scoreMatch >= 0.80
  ORDER BY CAST(durationAnos AS DECIMAL(10,4)) ASC
`);

// Contar outliers por instrumento (modo individual do banco)
const byTipo = {};
for (const r of rows) {
  if (!byTipo[r.tipo]) byTipo[r.tipo] = { total: 0, outliers: 0 };
  byTipo[r.tipo].total++;
  if (r.isOutlier) byTipo[r.tipo].outliers++;
}
console.log('Por instrumento (banco):', JSON.stringify(byTipo, null, 2));
console.log('Total rows:', rows.length);
console.log('Total outliers individuais (banco):', rows.filter(r => r.isOutlier).length);

// Simular applyUnifiedOutliers
const getUniverso = (indexador) => {
  const t = (indexador || '').toUpperCase();
  if (t.includes('IPCA')) return 'IPCA';
  if (t.includes('DI SPREAD') || t === 'DI SPREAD') return 'DI_SPREAD';
  if (t.includes('DI PERCENTUAL') || t === 'DI PERCENTUAL') return 'DI_PCT';
  if (t.includes('DI')) return 'DI_SPREAD';
  return 'OUTRO';
};

const byGroup = new Map();
for (const r of rows) {
  const key = `${r.rating}|${getUniverso(r.indexador)}`;
  if (!byGroup.has(key)) byGroup.set(key, []);
  byGroup.get(key).push(r);
}

let unifiedOutliers = 0;
for (const [key, group] of byGroup.entries()) {
  const n = group.length;
  if (n < 5) {
    console.log(`  ${key}: n=${n} — sem remoção (amostra insuficiente)`);
    continue;
  }
  const spreads = group.map(r => Number(r.zspread || 0));
  let cutLow, cutHigh;
  if (n >= 20) {
    const sorted = [...spreads].sort((a,b) => a-b);
    const k = Math.floor(n * 0.10);
    cutLow = sorted[k]; cutHigh = sorted[n-1-k];
  } else {
    const sigma = n >= 10 ? 2.5 : 2.0;
    const mean = spreads.reduce((s,v) => s+v, 0) / n;
    const variance = spreads.reduce((s,v) => s + Math.pow(v-mean,2), 0) / (n-1);
    const stdDev = Math.sqrt(variance);
    cutLow = mean - sigma * stdDev; cutHigh = mean + sigma * stdDev;
  }
  let out = 0;
  for (const s of spreads) if (s < cutLow || s > cutHigh) out++;
  unifiedOutliers += out;
  console.log(`  ${key}: n=${n}, outliers=${out}, corte=[${cutLow.toFixed(4)}, ${cutHigh.toFixed(4)}]`);
}
console.log('\nTotal outliers unificados (on-the-fly):', unifiedOutliers);
console.log('Diferença vs banco:', unifiedOutliers - rows.filter(r => r.isOutlier).length);

await conn.end();
