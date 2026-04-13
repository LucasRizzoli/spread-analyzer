/**
 * Re-sincroniza os dados CRI/CRA com as fórmulas corrigidas:
 * - IPCA SPREAD: fórmula geométrica (1+taxa)/(1+NTN-B)−1
 * - DI SPREAD: taxaIndicativa diretamente
 * - Score mínimo: 0.80 (unificado com debêntures)
 */
import { getDb } from "./server/db";
import { spreadAnalysis, historicalSnapshots, uploadedFiles } from "./drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { runCriCraSync } from "./server/services/criCraSyncService";
import axios from "axios";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB não disponível");

  // 1. Buscar o arquivo CRI/CRA mais recente no banco
  const [rawFiles] = await db.execute(sql`
    SELECT * FROM uploaded_files WHERE tipo = 'cri_cra' ORDER BY uploadadoEm DESC LIMIT 1
  `) as any;
  const files = rawFiles as any[];

  if (!files.length) {
    console.error("Nenhum arquivo CRI/CRA encontrado no banco");
    process.exit(1);
  }

  const file = files[0];
  console.log(`Arquivo: ${file.nomeArquivo} (${file.uploadadoEm})`);
  console.log(`URL: ${file.s3Url}`);

  // 2. Baixar o arquivo do S3
  const response = await axios.get(file.s3Url, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data);
  console.log(`Arquivo baixado: ${buffer.length} bytes`);

  // 3. Limpar dados CRI/CRA existentes
  console.log("Limpando dados CRI/CRA existentes...");
  const deleted = await db.delete(spreadAnalysis)
    .where(inArray(spreadAnalysis.tipo, ["CRI", "CRA"]));
  console.log(`Deletados: ${(deleted as any)[0]?.affectedRows ?? "?"} registros`);

  // Limpar snapshots históricos de CRI/CRA
  await db.delete(historicalSnapshots)
    .where(and(
      sql`indexador IN ('IPCA SPREAD', 'DI SPREAD', 'DI PERCENTUAL')`,
      sql`rating IS NOT NULL`
    ));

  // 4. Re-sincronizar
  console.log("Re-sincronizando com novas fórmulas...");
  const result = await runCriCraSync(buffer);
  console.log(`\nResultado:`);
  console.log(`  Total processados: ${result.totalProcessados}`);
  console.log(`  Com rating: ${result.totalComRating}`);
  console.log(`  Sem rating: ${result.totalSemRating}`);
  console.log(`  Data referência: ${result.dataReferencia}`);

  // 5. Verificar distribuição por rating+grupo
  const [rows] = await db.execute(sql`
    SELECT rating, indexador, COUNT(*) as n,
           ROUND(AVG(zspread * 100), 1) as mediaSpreadBps,
           ROUND(MIN(zspread * 100), 1) as minSpread,
           ROUND(MAX(zspread * 100), 1) as maxSpread
    FROM spread_analysis
    WHERE tipo IN ('CRI', 'CRA')
      AND dataReferencia = (SELECT MAX(dataReferencia) FROM spread_analysis WHERE tipo IN ('CRI','CRA'))
      AND isOutlier = 0
      AND zspread IS NOT NULL
    GROUP BY rating, indexador
    ORDER BY indexador, rating
  `) as any;

  console.log("\nDistribuição por rating+grupo (sem outliers, data mais recente):");
  for (const r of rows as any[]) {
    console.log(`  ${r.indexador} | ${r.rating}: n=${r.n}, média=${r.mediaSpreadBps}bps, min=${r.minSpread}, max=${r.maxSpread}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
