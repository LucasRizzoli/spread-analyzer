import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Total por tipo
const [byTipo] = await conn.execute(`
  SELECT tipo, COUNT(*) as total, 
         SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) as com_rating,
         SUM(CASE WHEN rating IS NULL THEN 1 ELSE 0 END) as sem_rating,
         SUM(CASE WHEN zspread IS NOT NULL THEN 1 ELSE 0 END) as com_zspread
  FROM spread_analysis 
  GROUP BY tipo
  ORDER BY tipo
`);
console.log('=== Por Tipo ===');
console.table(byTipo);

// CRI/CRA com rating — distribuição por indexador
const [comRating] = await conn.execute(`
  SELECT tipo, indexador, rating, COUNT(*) as total
  FROM spread_analysis
  WHERE tipo IN ('CRI', 'CRA') AND rating IS NOT NULL
  GROUP BY tipo, indexador, rating
  ORDER BY tipo, indexador, rating
`);
console.log('\n=== CRI/CRA COM rating (por indexador+rating) ===');
console.table(comRating);

// CRI/CRA sem rating — amostras para entender o motivo
const [semRating] = await conn.execute(`
  SELECT tipo, emissor_nome, codigo_cetip, indexador, taxa_indicativa, score_match, rating
  FROM spread_analysis
  WHERE tipo IN ('CRI', 'CRA') AND rating IS NULL
  LIMIT 15
`);
console.log('\n=== Amostras CRI/CRA SEM rating ===');
console.table(semRating);

// Verificar: CRI/CRA sem rating — qual campo está nulo? emissor_moodys?
const [motivos] = await conn.execute(`
  SELECT tipo,
    SUM(CASE WHEN emissor_moodys IS NULL THEN 1 ELSE 0 END) as sem_emissor_moodys,
    SUM(CASE WHEN score_match IS NULL THEN 1 ELSE 0 END) as sem_score,
    SUM(CASE WHEN score_match < 0.80 THEN 1 ELSE 0 END) as score_abaixo_080,
    SUM(CASE WHEN score_match >= 0.80 THEN 1 ELSE 0 END) as score_acima_080,
    MIN(score_match) as score_min,
    MAX(score_match) as score_max,
    AVG(score_match) as score_avg
  FROM spread_analysis
  WHERE tipo IN ('CRI', 'CRA') AND rating IS NULL
  GROUP BY tipo
`);
console.log('\n=== Motivos de sem rating (CRI/CRA) ===');
console.table(motivos);

await conn.end();
