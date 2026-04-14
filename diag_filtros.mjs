import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

try {
  const env = readFileSync('/home/ubuntu/spread-analyzer/.env', 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
} catch {}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Simular a query padrão sem filtros (como o sistema carrega na abertura)
// Filtros padrão: sem filtro de tipo, sem filtro de rating, sem filtro de setor
// indexadores: IPCA SPREAD (padrão ao abrir)
// isOutlier: false (outliers ocultos por padrão)
// durationAnos: 0 a 20

console.log('='.repeat(60));
console.log('DIAGNÓSTICO: O que aparece no sistema vs o que está no banco');
console.log('='.repeat(60));

// 1. Sem nenhum filtro
const [total] = await conn.execute(`
  SELECT tipo, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA')
  GROUP BY tipo
`);
console.log('\n1. Total no banco (sem filtros):');
console.table(total);

// 2. Sem outliers (filtro padrão do sistema)
const [semOutlier] = await conn.execute(`
  SELECT tipo, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND (isOutlier = 0 OR isOutlier IS NULL)
  GROUP BY tipo
`);
console.log('\n2. Sem outliers (isOutlier=0):');
console.table(semOutlier);

// 3. Apenas IPCA SPREAD (indexador padrão ao abrir o sistema)
const [ipcaOnly] = await conn.execute(`
  SELECT tipo, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND indexador = 'IPCA SPREAD'
  GROUP BY tipo
`);
console.log('\n3. Apenas IPCA SPREAD (indexador padrão):');
console.table(ipcaOnly);

// 4. IPCA SPREAD sem outliers
const [ipcaSemOutlier] = await conn.execute(`
  SELECT tipo, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND indexador = 'IPCA SPREAD' AND (isOutlier = 0 OR isOutlier IS NULL)
  GROUP BY tipo
`);
console.log('\n4. IPCA SPREAD + sem outliers:');
console.table(ipcaSemOutlier);

// 5. Quantos são outliers por indexador
const [outliers] = await conn.execute(`
  SELECT tipo, indexador, 
    SUM(CASE WHEN isOutlier = 1 THEN 1 ELSE 0 END) as outliers,
    SUM(CASE WHEN isOutlier = 0 OR isOutlier IS NULL THEN 1 ELSE 0 END) as nao_outliers,
    COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA')
  GROUP BY tipo, indexador
  ORDER BY tipo, indexador
`);
console.log('\n5. Outliers por tipo e indexador:');
console.table(outliers);

// 6. Verificar se há problema de dataReferencia (dados de datas diferentes)
const [datas] = await conn.execute(`
  SELECT tipo, dataReferencia, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA')
  GROUP BY tipo, dataReferencia
  ORDER BY tipo, dataReferencia DESC
`);
console.log('\n6. Distribuição por data de referência:');
console.table(datas);

// 7. Verificar se a query do sistema filtra por dataReferencia mais recente
const [maxData] = await conn.execute(`
  SELECT MAX(dataReferencia) as max_data FROM spread_analysis WHERE tipo IN ('CRI','CRA')
`);
const maxDataRef = maxData[0].max_data;
console.log(`\n7. Data de referência mais recente: ${maxDataRef}`);

const [naDataMax] = await conn.execute(`
  SELECT tipo, indexador, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND dataReferencia = ?
  GROUP BY tipo, indexador
  ORDER BY tipo, indexador
`, [maxDataRef]);
console.log(`   Papéis na data ${maxDataRef}:`);
console.table(naDataMax);

await conn.end();
