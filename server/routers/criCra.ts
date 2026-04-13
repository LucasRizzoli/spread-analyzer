import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { uploadedFiles, spreadAnalysis } from "../../drizzle/schema";
import { runCriCraSync, getCriCraSyncState } from "../services/criCraSyncService";
import { storagePut } from "../storage";
import { eq, sql, and, isNotNull, inArray } from "drizzle-orm";
import { sortRatings } from "../services/spreadCalculatorService";

const CriCraFiltersSchema = z.object({
  durationMin: z.number().min(0).max(100).optional(),
  durationMax: z.number().min(0).max(100).optional(),
  indexadores: z.array(z.string()).optional(),
  ratings: z.array(z.string()).optional(),
  setores: z.array(z.string()).optional(),
  tipos: z.array(z.string()).optional(), // CRI / CRA
  excludeOutliers: z.boolean().optional(),
});

export const criCraRouter = router({
  /**
   * Upload de planilha CRI/CRA e disparo do sync
   */
  uploadAndSync: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileBase64: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Banco não disponível");

      // Decodificar base64 e fazer upload para S3
      const buffer = Buffer.from(input.fileBase64, "base64");
      const s3Key = `cri-cra/${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(s3Key, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // Registrar na tabela uploaded_files
      await db.insert(uploadedFiles).values({
        tipo: "cri_cra",
        nomeArquivo: input.fileName,
        s3Key,
        s3Url: url,
        tamanhoBytes: buffer.length,
      });

      // Disparar sync em background (não aguardar)
      runCriCraSync(buffer).catch((err: Error) => {
        console.error("[CriCraRouter] Erro no sync:", err.message);
      });

      return { success: true, message: "Upload realizado. Processamento iniciado em background." };
    }),

  /**
   * Status do sync CRI/CRA
   */
  getSyncStatus: publicProcedure.query(() => {
    return getCriCraSyncState();
  }),

  /**
   * Lista planilhas CRI/CRA enviadas
   */
  getUploadedFiles: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const files = await db.select().from(uploadedFiles)
      .where(eq(uploadedFiles.tipo, "cri_cra"))
      .orderBy(sql`uploadadoEm DESC`);
    return files;
  }),

  /**
   * Retorna dados de análise CRI/CRA com filtros
   */
  getAnalysis: publicProcedure
    .input(CriCraFiltersSchema.optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [
        inArray(spreadAnalysis.tipo, ["CRI", "CRA"]),
        isNotNull(spreadAnalysis.zspread),
      ];

      if (input?.excludeOutliers !== false) {
        conditions.push(eq(spreadAnalysis.isOutlier, false));
      }
      if (input?.indexadores?.length) {
        conditions.push(inArray(spreadAnalysis.indexador, input.indexadores));
      }
      if (input?.ratings?.length) {
        conditions.push(inArray(spreadAnalysis.rating, input.ratings));
      }
      if (input?.setores?.length) {
        conditions.push(inArray(spreadAnalysis.setor, input.setores));
      }
      if (input?.tipos?.length) {
        conditions.push(inArray(spreadAnalysis.tipo, input.tipos as ("CRI" | "CRA")[]));
      }

      const rows = await db.select().from(spreadAnalysis)
        .where(and(...conditions))
        .orderBy(sql`dataReferencia DESC, durationAnos ASC`);

      return rows.map(r => ({
        ...r,
        taxaIndicativa: r.taxaIndicativa ? Number(r.taxaIndicativa) : null,
        durationAnos: r.durationAnos ? Number(r.durationAnos) : null,
        ntnbTaxa: r.ntnbTaxa ? Number(r.ntnbTaxa) : null,
        zspread: r.zspread ? Number(r.zspread) : null,
        scoreMatch: r.scoreMatch ? Number(r.scoreMatch) : null,
      }));
    }),

  /**
   * Z-spread médio/mediana por rating (para gráfico de barras)
   */
  getZspreadByRating: publicProcedure
    .input(CriCraFiltersSchema.optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const whereClause = sql`
        tipo IN ('CRI', 'CRA')
        AND zspread IS NOT NULL
        AND rating IS NOT NULL
        ${input?.excludeOutliers !== false ? sql`AND isOutlier = 0` : sql``}
        ${input?.indexadores?.length ? sql`AND indexador IN (${sql.join(input.indexadores.map(i => sql`${i}`), sql`, `)})` : sql``}
        ${input?.tipos?.length ? sql`AND tipo IN (${sql.join(input.tipos.map(t => sql`${t}`), sql`, `)})` : sql``}
      `;

      const [rows] = await db.execute(sql`
        SELECT
          rating,
          COUNT(*) as count,
          AVG(zspread) as avgZspread,
          -- Mediana via percentile
          AVG(CASE WHEN zspread_rank BETWEEN FLOOR((total_count+1)/2) AND CEIL((total_count+1)/2) THEN zspread END) as medianZspread,
          MIN(zspread) as minZspread,
          MAX(zspread) as maxZspread
        FROM (
          SELECT
            rating,
            zspread,
            ROW_NUMBER() OVER (PARTITION BY rating ORDER BY zspread) as zspread_rank,
            COUNT(*) OVER (PARTITION BY rating) as total_count
          FROM spread_analysis
          WHERE ${whereClause}
        ) ranked
        GROUP BY rating
        ORDER BY rating
      `) as unknown as { rating: string; count: string; avgZspread: string; medianZspread: string; minZspread: string; maxZspread: string }[][];

      const data = (rows || []) as { rating: string; count: string; avgZspread: string; medianZspread: string; minZspread: string; maxZspread: string }[];

      return data
        .filter(r => r.rating)
        .map(r => ({
          rating: r.rating,
          avgZspread: Number(r.avgZspread),
          medianZspread: Number(r.medianZspread),
          count: Number(r.count),
          minZspread: Number(r.minZspread),
          maxZspread: Number(r.maxZspread),
        }));
    }),

  /**
   * Opções de filtro disponíveis
   */
  getFilterOptions: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { indexadores: [], ratings: [], setores: [], tipos: [], datas: [] };

    const [rows] = await db.execute(sql`
      SELECT DISTINCT
        indexador, rating, setor, tipo,
        dataReferencia
      FROM spread_analysis
      WHERE tipo IN ('CRI', 'CRA')
        AND zspread IS NOT NULL
    `) as unknown as { indexador: string | null; rating: string | null; setor: string | null; tipo: string | null; dataReferencia: string | null }[][];

    const data = (rows || []) as { indexador: string | null; rating: string | null; setor: string | null; tipo: string | null; dataReferencia: string | null }[];

    return {
      indexadores: Array.from(new Set(data.map(r => r.indexador).filter(Boolean) as string[])).sort(),
      ratings: sortRatings(Array.from(new Set(data.map(r => r.rating).filter(Boolean) as string[]))),
      setores: Array.from(new Set(data.map(r => r.setor).filter(Boolean) as string[])).sort(),
      tipos: Array.from(new Set(data.map(r => r.tipo).filter(Boolean) as string[])).sort(),
      datas: Array.from(new Set(data.map(r => r.dataReferencia).filter(Boolean) as string[])).sort().reverse(),
    };
  }),

  /**
   * Curva NTN-B para precificação (reutiliza a mesma do sistema de debêntures)
   */
  getNtnbCurve: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const [rows] = await db.execute(sql`
      SELECT codigoCetip, vencimento, taxaIndicativa, durationAnos, dataReferencia
      FROM ntnb_curve
      ORDER BY durationAnos ASC
    `) as unknown as { codigoCetip: string; vencimento: string; taxaIndicativa: string; durationAnos: string; dataReferencia: string }[][];
    return (rows || []).map((r: { codigoCetip: string; vencimento: string; taxaIndicativa: string; durationAnos: string; dataReferencia: string }) => ({
      ...r,
      taxaIndicativa: Number(r.taxaIndicativa),
      durationAnos: Number(r.durationAnos),
    }));
  }),
});
