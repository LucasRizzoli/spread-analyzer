/**
 * Analisa a sobreposição de CETIPs entre as datas de referência no banco.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '/home/ubuntu/spread-analyzer/.env' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL não definida'); process.exit(1); }

// MySQL via mysql2
const mysql = require('mysql2/promise');

// Parse da connection string mysql://user:pass@host:port/db
const url = new URL(DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: url.port || 3306,
  user: url.username,
  password: url.password,
  database: url.pathname.replace('/', ''),
  ssl: { rejectUnauthorized: false },
});

const [rows] = await conn.execute(`
  SELECT dataReferencia, codigoCetip
  FROM spread_analysis
  ORDER BY dataReferencia, codigoCetip
`);

await conn.end();

// Agrupar por data
const byDate = {};
for (const row of rows) {
  const d = row.dataReferencia;
  if (!byDate[d]) byDate[d] = new Set();
  byDate[d].add(row.codigoCetip);
}

const dates = Object.keys(byDate).sort();
console.log(`\n=== DATAS CARREGADAS (${dates.length}) ===`);
for (const d of dates) {
  console.log(`  ${d}: ${byDate[d].size} ativos únicos`);
}

// Interseção entre todas as datas
let intersection = new Set(byDate[dates[0]]);
for (const d of dates.slice(1)) {
  intersection = new Set([...intersection].filter(c => byDate[d].has(c)));
}
const lastSize = byDate[dates[dates.length-1]].size;
console.log(`\n=== ATIVOS PRESENTES EM TODAS AS ${dates.length} DATAS ===`);
console.log(`  Total: ${intersection.size} ativos (${((intersection.size / lastSize)*100).toFixed(1)}% da última planilha)`);

// Novos/saindo por data
console.log(`\n=== VARIAÇÃO ENTRE DATAS CONSECUTIVAS ===`);
for (let i = 1; i < dates.length; i++) {
  const prev = byDate[dates[i-1]];
  const curr = byDate[dates[i]];
  const novos = [...curr].filter(c => !prev.has(c));
  const saindo = [...prev].filter(c => !curr.has(c));
  console.log(`  ${dates[i-1]} → ${dates[i]}:`);
  console.log(`    Permaneceram: ${curr.size - novos.length} | Novos: ${novos.length} | Saíram: ${saindo.length}`);
  if (novos.length > 0 && novos.length <= 30) {
    console.log(`    Novos CETIPs: ${novos.join(', ')}`);
  }
  if (saindo.length > 0 && saindo.length <= 30) {
    console.log(`    Saíram CETIPs: ${saindo.join(', ')}`);
  }
}

// Sobreposição par-a-par
console.log(`\n=== SOBREPOSIÇÃO PAR-A-PAR ===`);
for (let i = 0; i < dates.length; i++) {
  for (let j = i+1; j < dates.length; j++) {
    const a = byDate[dates[i]];
    const b = byDate[dates[j]];
    const common = [...a].filter(c => b.has(c)).length;
    const pct = ((common / Math.max(a.size, b.size)) * 100).toFixed(1);
    console.log(`  ${dates[i]} ↔ ${dates[j]}: ${common} em comum (${pct}% de sobreposição)`);
  }
}

// Distribuição de frequência
const cetipCount = {};
for (const row of rows) {
  if (!cetipCount[row.codigoCetip]) cetipCount[row.codigoCetip] = new Set();
  cetipCount[row.codigoCetip].add(row.dataReferencia);
}
const dist = {};
for (const datas of Object.values(cetipCount)) {
  const n = datas.size;
  dist[n] = (dist[n] || 0) + 1;
}
console.log(`\n=== DISTRIBUIÇÃO: EM QUANTAS DATAS CADA ATIVO APARECE ===`);
for (const n of Object.keys(dist).sort((a,b) => Number(a)-Number(b))) {
  const pct = ((dist[n] / Object.keys(cetipCount).length) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(dist[n] / Object.keys(cetipCount).length * 40));
  console.log(`  ${n} data(s): ${String(dist[n]).padStart(4)} ativos (${pct.padStart(5)}%)  ${bar}`);
}
console.log(`\n  Total de CETIPs únicos na base: ${Object.keys(cetipCount).length}`);
