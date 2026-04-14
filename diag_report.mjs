import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

// Carregar .env manualmente
try {
  const env = readFileSync('/home/ubuntu/spread-analyzer/.env', 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
} catch {}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(70));
console.log('RELATÓRIO: CRI/CRA — Cobertura Moody\'s vs Sistema');
console.log('='.repeat(70));

// 1. Total na planilha ANBIMA CRI/CRA (spread_analysis inclui todos os persistidos)
// Os descartados (sem rating) NÃO estão no banco — precisamos do log do último sync
// Mas podemos inferir pelo total parseado (1556) vs persistidos (379)
console.log('\n📊 1. VISÃO GERAL DO PROCESSAMENTO (último sync)');
console.log('-'.repeat(50));
console.log('  Total parseado da planilha ANBIMA CRI/CRA : 1.556 papéis');
console.log('  Com match Moody\'s (score ≥ 0.80)         :   379 papéis (24,4%)');
console.log('  Sem match / descartados                   : 1.177 papéis (75,6%)');

// 2. Quantos emissores únicos de CRI/CRA estão na Moody's
const [moodysTotal] = await conn.execute(`
  SELECT COUNT(*) as total, COUNT(DISTINCT emissor) as emissores_unicos
  FROM moodys_ratings
`);
console.log('\n📋 2. COBERTURA NA PLANILHA MOODY\'S');
console.log('-'.repeat(50));
console.log(`  Total de ratings na planilha Moody's      : ${moodysTotal[0].total}`);
console.log(`  Emissores únicos na planilha Moody's      : ${moodysTotal[0].emissores_unicos}`);

// 3. Emissores Moody's que aparecem em CRI/CRA no sistema
const [moodysNoCriCra] = await conn.execute(`
  SELECT COUNT(DISTINCT emissorMoodys) as emissores_com_match,
         COUNT(*) as papeis_no_sistema
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND emissorMoodys IS NOT NULL
`);
console.log(`  Emissores Moody's com match em CRI/CRA     : ${moodysNoCriCra[0].emissores_com_match}`);
console.log(`  Papéis CRI/CRA no sistema (com rating)     : ${moodysNoCriCra[0].papeis_no_sistema}`);

// 4. Distribuição por tipo e indexador no sistema
const [dist] = await conn.execute(`
  SELECT tipo, indexador, COUNT(*) as total,
    ROUND(AVG(scoreMatch),4) as score_medio,
    ROUND(MIN(scoreMatch),4) as score_min,
    ROUND(MAX(scoreMatch),4) as score_max
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA')
  GROUP BY tipo, indexador
  ORDER BY tipo, indexador
`);
console.log('\n📈 3. PAPÉIS NO SISTEMA — POR TIPO E INDEXADOR');
console.log('-'.repeat(50));
console.table(dist);

// 5. Top emissores com mais papéis no sistema
const [topEmissores] = await conn.execute(`
  SELECT tipo, emissorMoodys, COUNT(*) as papeis, 
    ROUND(AVG(scoreMatch),4) as score_medio,
    GROUP_CONCAT(DISTINCT rating ORDER BY rating) as ratings
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND emissorMoodys IS NOT NULL
  GROUP BY tipo, emissorMoodys
  ORDER BY papeis DESC
  LIMIT 20
`);
console.log('\n🏢 4. TOP EMISSORES COM MAIS PAPÉIS NO SISTEMA');
console.log('-'.repeat(50));
console.table(topEmissores);

// 6. Distribuição de scores de match
const [scores] = await conn.execute(`
  SELECT tipo,
    SUM(CASE WHEN scoreMatch >= 0.95 THEN 1 ELSE 0 END) as score_095_mais,
    SUM(CASE WHEN scoreMatch >= 0.90 AND scoreMatch < 0.95 THEN 1 ELSE 0 END) as score_090_095,
    SUM(CASE WHEN scoreMatch >= 0.85 AND scoreMatch < 0.90 THEN 1 ELSE 0 END) as score_085_090,
    SUM(CASE WHEN scoreMatch >= 0.80 AND scoreMatch < 0.85 THEN 1 ELSE 0 END) as score_080_085,
    COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA')
  GROUP BY tipo
`);
console.log('\n🎯 5. DISTRIBUIÇÃO DE SCORES DE MATCH');
console.log('-'.repeat(50));
console.table(scores);

// 7. Papéis por rating no sistema
const [porRating] = await conn.execute(`
  SELECT tipo, rating, COUNT(*) as papeis
  FROM spread_analysis
  WHERE tipo IN ('CRI','CRA') AND rating IS NOT NULL
  GROUP BY tipo, rating
  ORDER BY tipo, 
    FIELD(rating,'AAA.br','AA+.br','AA.br','AA-.br','A+.br','A.br','A-.br','BBB+.br','BBB.br','BBB-.br')
`);
console.log('\n⭐ 6. PAPÉIS POR RATING NO SISTEMA');
console.log('-'.repeat(50));
console.table(porRating);

await conn.end();
