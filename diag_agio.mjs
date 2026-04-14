import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Datas mais recentes de cada universo
const [[debRow]] = await conn.execute(`SELECT MAX(dataReferencia) as d FROM spread_analysis WHERE tipo='DEB'`);
const [[criRow]] = await conn.execute(`SELECT MAX(dataReferencia) as d FROM spread_analysis WHERE tipo IN ('CRI','CRA')`);
const debDate = debRow.d;
const criDate = criRow.d;
console.log(`DEB data: ${debDate} | CRI/CRA data: ${criDate}\n`);

// Comparação por rating + indexador
const [rows] = await conn.execute(`
  SELECT 
    tipo,
    indexador,
    rating,
    COUNT(*) as n,
    ROUND(AVG(CAST(zspread AS DECIMAL(10,4))), 4) as media_zspread,
    ROUND(MIN(CAST(zspread AS DECIMAL(10,4))), 4) as min_zspread,
    ROUND(MAX(CAST(zspread AS DECIMAL(10,4))), 4) as max_zspread
  FROM spread_analysis
  WHERE zspread IS NOT NULL
    AND isOutlier = 0
    AND (
      (tipo = 'DEB' AND dataReferencia = ?)
      OR (tipo IN ('CRI','CRA') AND dataReferencia = ?)
    )
    AND indexador IN ('IPCA SPREAD', 'DI SPREAD')
    AND rating IN ('AAA.br','AA+.br','AA.br','AA-.br','A+.br','A.br','A-.br')
  GROUP BY tipo, indexador, rating
  ORDER BY indexador, rating, tipo
`, [debDate, criDate]);

console.log('=== Comparação DEB vs CRI/CRA por Rating e Indexador ===\n');
console.table(rows);

// Calcular ágio CRI/CRA vs DEB para cada rating+indexador
console.log('\n=== Ágio CRI/CRA sobre DEB (mesmos ratings) ===\n');
const debMap = {};
const criMap = {};
for (const r of rows) {
  const key = `${r.indexador}|${r.rating}`;
  if (r.tipo === 'DEB') debMap[key] = r;
  else {
    if (!criMap[key]) criMap[key] = { ...r, tipos: [r.tipo] };
    else {
      // Combinar CRI e CRA
      const prev = criMap[key];
      const totalN = prev.n + r.n;
      criMap[key] = {
        ...prev,
        tipo: 'CRI+CRA',
        n: totalN,
        media_zspread: ((prev.media_zspread * prev.n + r.media_zspread * r.n) / totalN).toFixed(4),
      };
    }
  }
}

const agio = [];
for (const key of Object.keys(criMap)) {
  const cri = criMap[key];
  const deb = debMap[key];
  if (!deb) continue;
  const [indexador, rating] = key.split('|');
  const agioBps = ((parseFloat(cri.media_zspread) - parseFloat(deb.media_zspread)) * 100).toFixed(1);
  const agioPct = ((parseFloat(cri.media_zspread) / parseFloat(deb.media_zspread) - 1) * 100).toFixed(1);
  agio.push({
    indexador,
    rating,
    'DEB (bps)': (parseFloat(deb.media_zspread) * 100).toFixed(1),
    'CRI/CRA (bps)': (parseFloat(cri.media_zspread) * 100).toFixed(1),
    'Ágio (bps)': agioBps,
    'Ágio (%)': `${agioPct}%`,
    'n DEB': deb.n,
    'n CRI/CRA': cri.n,
  });
}
console.table(agio);

await conn.end();
