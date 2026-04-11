/**
 * Router tRPC para busca de emissões comparáveis
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { comparableSearches } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { runComparableSearch } from "../services/comparableAgents";

export const comparableRouter = router({
  /**
   * Inicia uma busca de emissões comparáveis.
   * Cria o registro no banco, roda os agentes em background e retorna o ID.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string().min(10).max(1000) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Banco de dados indisponível");

      // Criar registro inicial
      const [inserted] = await db
        .insert(comparableSearches)
        .values({
          userId: ctx.user.id,
          query: input.query,
          status: "running",
        });

      const searchId = inserted.insertId as number;

      // Rodar agentes em background
      (async () => {
        const progressLog: string[] = [];
        try {
          const dbInner = await getDb();
          if (!dbInner) throw new Error("DB indisponível");
          const { attributes, searchTerms, results } = await runComparableSearch(
            input.query,
            (step, detail) => {
              const msg = detail ? `[${step}] ${detail}` : `[${step}]`;
              progressLog.push(msg);
              console.log(`[Comparable #${searchId}] ${msg}`);
            }
          );

          await dbInner
            .update(comparableSearches)
            .set({
              status: "done",
              attributes: attributes as any,
              searchTerms: searchTerms as any,
              results: results as any,
            })
            .where(eq(comparableSearches.id, searchId));
        } catch (err: any) {
          console.error(`[Comparable #${searchId}] Erro:`, err);
          const dbErr = await getDb();
          if (dbErr) {
            await dbErr
              .update(comparableSearches)
              .set({
                status: "error",
                errorMessage: err?.message || "Erro desconhecido",
              })
              .where(eq(comparableSearches.id, searchId));
          }
        }
      })();

      return { searchId };
    }),

  /**
   * Retorna o status e resultados de uma busca pelo ID.
   * O frontend faz polling a cada 3s até status=done|error.
   */
  getSearch: protectedProcedure
    .input(z.object({ searchId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Banco de dados indisponível");
      const [row] = await db
        .select()
        .from(comparableSearches)
        .where(eq(comparableSearches.id, input.searchId))
        .limit(1);

      if (!row || row.userId !== ctx.user.id) {
        throw new Error("Busca não encontrada");
      }

      return {
        id: row.id,
        query: row.query,
        status: row.status,
        attributes: row.attributes,
        searchTerms: row.searchTerms,
        results: row.results,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt,
      };
    }),

  /**
   * Lista o histórico de buscas do usuário
   */
  listSearches: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
      .select({
        id: comparableSearches.id,
        query: comparableSearches.query,
        status: comparableSearches.status,
        createdAt: comparableSearches.createdAt,
      })
      .from(comparableSearches)
      .where(eq(comparableSearches.userId, ctx.user.id))
      .orderBy(desc(comparableSearches.createdAt))
      .limit(20);

    return rows;
  }),
});
