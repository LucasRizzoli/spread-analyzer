/**
 * Baixa as planilhas ANBIMA únicas do S3 e compara os CETIPs brutos entre elas.
 */
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '/home/ubuntu/spread-analyzer/.env' });

const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const https = require('https');
const http = require('http');

const DATABASE_URL = process.env.DATABASE_URL;
const url = new URL(DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname, port: url.port || 3306,
  user: url.username, password: url.password,
  database: url.pathname.replace('/', ''), ssl: { rejectUnauthorized: false }
});

// Buscar uma chave S3 por nome de arquivo (a mais recente)
const [rows] = await conn.execute(`
  SELECT nomeArquivo, s3Key, s3Url
  FROM uploaded_files
  WHERE tipo = 'anbima'
  ORDER BY uploadadoEm DESC
`);
await conn.end();

// Pegar uma entrada por nome de arquivo único
const unique = {};
for (const r of rows) {
  if (!unique[r.nomeArquivo]) unique[r.nomeArquivo] = r;
}

// Função para baixar arquivo via URL
function downloadFile(fileUrl) {
  return new Promise((resolve, reject) => {
    const proto = fileUrl.startsWith('https') ? https : http;
    proto.get(fileUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Função para extrair CETIPs de uma planilha ANBIMA
function extractCetips(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  // Encontrar coluna "Código" ou "Código do Ativo" ou "CETIP"
  let headerRow = -1;
  let cetipCol = -1;
  let dataRefCol = -1;
  
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j]).toLowerCase().trim();
      if (cell === 'código' || cell === 'codigo' || cell === 'código do ativo' || cell === 'codigo do ativo') {
        headerRow = i;
        cetipCol = j;
      }
      if (cell === 'data de referência' || cell === 'data de referencia' || cell === 'data referência') {
        dataRefCol = j;
      }
    }
    if (cetipCol >= 0) break;
  }
  
  if (cetipCol < 0) {
    // Tentar coluna A (índice 0) como fallback
    console.warn('  Coluna CETIP não encontrada, usando coluna A como fallback');
    cetipCol = 0;
    headerRow = 0;
  }
  
  const cetips = new Set();
  let dataRef = null;
  
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const cetip = String(row[cetipCol] || '').trim().toUpperCase();
    if (cetip && cetip.length >= 4 && cetip.length <= 12 && /^[A-Z0-9]+$/.test(cetip)) {
      cetips.add(cetip);
    }
    if (!dataRef && dataRefCol >= 0 && row[dataRefCol]) {
      dataRef = String(row[dataRefCol]).trim();
    }
  }
  
  return { cetips, dataRef, totalRows: data.length - headerRow - 1 };
}

// Baixar e processar cada planilha única
console.log(`\nBaixando ${Object.keys(unique).length} planilhas únicas do S3...\n`);
const results = {};

for (const [nome, entry] of Object.entries(unique)) {
  process.stdout.write(`  ${nome}... `);
  try {
    const buffer = await downloadFile(entry.s3Url);
    const { cetips, dataRef, totalRows } = extractCetips(buffer);
    results[nome] = { cetips, dataRef, totalRows, s3Key: entry.s3Key };
    console.log(`OK — ${cetips.size} CETIPs únicos (${totalRows} linhas, data ref: ${dataRef || 'não encontrada'})`);
  } catch (e) {
    console.log(`ERRO: ${e.message}`);
    results[nome] = { cetips: new Set(), dataRef: null, totalRows: 0, error: e.message };
  }
}

const names = Object.keys(results).sort();

// Comparação par-a-par
console.log('\n=== COMPARAÇÃO PAR-A-PAR DE CETIPs BRUTOS ===');
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = results[names[i]].cetips;
    const b = results[names[j]].cetips;
    const common = [...a].filter(c => b.has(c)).length;
    const onlyA = [...a].filter(c => !b.has(c)).length;
    const onlyB = [...b].filter(c => !a.has(c)).length;
    const pct = ((common / Math.max(a.size, b.size)) * 100).toFixed(1);
    console.log(`\n  ${names[i]}`);
    console.log(`  ↔ ${names[j]}`);
    console.log(`  Em comum: ${common} | Só na 1ª: ${onlyA} | Só na 2ª: ${onlyB} | Sobreposição: ${pct}%`);
  }
}

// Distribuição de frequência
console.log('\n=== DISTRIBUIÇÃO: EM QUANTAS PLANILHAS CADA CETIP APARECE ===');
const allCetips = {};
for (const [nome, r] of Object.entries(results)) {
  for (const c of r.cetips) {
    if (!allCetips[c]) allCetips[c] = [];
    allCetips[c].push(nome);
  }
}
const dist = {};
for (const planilhas of Object.values(allCetips)) {
  const n = planilhas.length;
  dist[n] = (dist[n] || 0) + 1;
}
const total = Object.keys(allCetips).length;
for (const n of Object.keys(dist).sort((a, b) => Number(a) - Number(b))) {
  const pct = ((dist[n] / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(dist[n] / total * 40));
  console.log(`  ${n} planilha(s): ${String(dist[n]).padStart(5)} CETIPs (${pct.padStart(5)}%)  ${bar}`);
}
console.log(`\n  Total de CETIPs únicos nas planilhas brutas: ${total}`);
console.log(`  Total de CETIPs únicos no banco (pós-match): 165`);
console.log(`  Descartados pelo cruzamento Moody's: ${total - 165} (${(((total - 165) / total) * 100).toFixed(1)}%)`);
