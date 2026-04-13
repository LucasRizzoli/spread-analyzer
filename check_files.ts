import { getDb } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB não disponível");

  const [rows] = await db.execute(sql`
    SELECT * FROM uploaded_files WHERE tipo = 'cri_cra' ORDER BY id DESC LIMIT 3
  `) as any;

  console.log("Arquivos CRI/CRA no banco:");
  for (const r of rows as any[]) {
    console.log(JSON.stringify(r));
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
