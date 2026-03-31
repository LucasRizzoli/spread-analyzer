const mysql = require('mysql2/promise');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('DATABASE_URL not set'); process.exit(1); }

  const conn = await mysql.createConnection(url);

  // Por rating com scoreMin >= 0.80
  const [rowsScore] = await conn.execute(`
    SELECT 
      rating,
      COUNT(*) as total,
      SUM(isOutlier) as outliers,
      SUM(CASE WHEN isOutlier = 0 THEN 1 ELSE 0 END) as nao_outliers
    FROM spread_analysis
    WHERE indexador = 'IPCA SPREAD'
      AND dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis)
      AND CAST(scoreMatch AS DECIMAL(5,4)) >= 0.80
    GROUP BY rating
    ORDER BY rating
  `);
  console.log('\n=== Por rating (scoreMin >= 0.80) ===');
  console.table(rowsScore);

  // Totais
  const [total] = await conn.execute(`
    SELECT 
      COUNT(*) as total, 
      SUM(isOutlier) as outliers,
      SUM(CASE WHEN isOutlier = 0 THEN 1 ELSE 0 END) as nao_outliers
    FROM spread_analysis
    WHERE indexador = 'IPCA SPREAD'
      AND dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis)
      AND CAST(scoreMatch AS DECIMAL(5,4)) >= 0.80
  `);
  console.log('\n=== Totais (scoreMin >= 0.80) ===');
  console.table(total);

  // Verificar o que excludeOutliers=true retorna
  const [noOutliers] = await conn.execute(`
    SELECT COUNT(*) as total
    FROM spread_analysis
    WHERE indexador = 'IPCA SPREAD'
      AND dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis)
      AND CAST(scoreMatch AS DECIMAL(5,4)) >= 0.80
      AND isOutlier = 0
  `);
  console.log('\n=== Com excludeOutliers=true ===');
  console.table(noOutliers);

  await conn.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
