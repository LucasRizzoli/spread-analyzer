import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  getSpreadAnalysis,
  getSpreadFiltersOptions,
  getZspreadByRating,
  getLastSyncLog,
  getSyncLogs,
} from "../db";
import { getSyncState, runFullSync } from "../services/syncService";
import { sortRatings } from "../services/spreadCalculatorService";

const SpreadFiltersSchema = z.object({
  durationMin: z.number().min(0).max(100).optional(),
  durationMax: z.number().min(0).max(100).optional(),
  indexadores: z.array(z.string()).optional(),
  incentivado: z.boolean().optional(),
  ratings: z.array(z.string()).optional(),
  setores: z.array(z.string()).optional(),
  tipos: z.array(z.string()).optional(),
  tiposMatch: z.array(z.string()).optional(),
});

export const spreadRouter = router({
  /**
   * Retorna os dados de análise de spread com filtros aplicados
   */
  getAnalysis: publicProcedure
    .input(SpreadFiltersSchema.optional())
    .query(async ({ input }) => {
      const data = await getSpreadAnalysis(input || {});
      return data.map((row) => ({
        ...row,
        taxaIndicativa: row.taxaIndicativa ? Number(row.taxaIndicativa) : null,
        durationAnos: row.durationAnos ? Number(row.durationAnos) : null,
        ntnbTaxa: row.ntnbTaxa ? Number(row.ntnbTaxa) : null,
        ntnbDuration: row.ntnbDuration ? Number(row.ntnbDuration) : null,
        zspread: row.zspread ? Number(row.zspread) : null,
      }));
    }),

  /**
   * Retorna as opções disponíveis para os filtros (valores únicos do banco)
   */
  getFilterOptions: publicProcedure.query(async () => {
    const options = await getSpreadFiltersOptions();
    return {
      ...options,
      ratings: sortRatings(options.ratings),
    };
  }),

  /**
   * Retorna Z-spread médio por faixa de rating (para gráfico de barras)
   */
  getZspreadByRating: publicProcedure
    .input(SpreadFiltersSchema.optional())
    .query(async () => {
      const data = await getZspreadByRating();
      return data
        .filter((r) => r.rating)
        .map((r) => ({
          rating: r.rating!,
          avgZspread: Number(r.avgZspread),
          count: Number(r.count),
          minZspread: Number(r.minZspread),
          maxZspread: Number(r.maxZspread),
        }))
        .sort((a, b) => {
          const order = sortRatings([a.rating, b.rating]);
          return order.indexOf(a.rating) - order.indexOf(b.rating);
        });
    }),

  /**
   * Retorna o estado atual da sincronização
   */
  getSyncState: publicProcedure.query(() => {
    return getSyncState();
  }),

  /**
   * Retorna o último log de sincronização
   */
  getLastSync: publicProcedure.query(async () => {
    return getLastSyncLog();
  }),

  /**
   * Retorna histórico de sincronizações
   */
  getSyncHistory: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      return getSyncLogs(input?.limit || 10);
    }),

  /**
   * Dispara sincronização com base64 do arquivo Moody's (via tRPC)
   * O arquivo é enviado como base64 para contornar limitações de multipart no tRPC
   */
  triggerSync: protectedProcedure
    .input(z.object({ moodysFileBase64: z.string() }))
    .mutation(async ({ input }) => {
      const moodysBuffer = Buffer.from(input.moodysFileBase64, "base64");
      // Rodar em background sem bloquear a resposta
      runFullSync(moodysBuffer).catch((err) => {
        console.error("[Sync] Erro na sincronização:", err);
      });
      return { started: true, message: "Sincronização iniciada em background" };
    }),
});
