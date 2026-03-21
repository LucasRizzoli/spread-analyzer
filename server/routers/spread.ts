import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  getSpreadAnalysis,
  getSpreadFiltersOptions,
  getZspreadByRating,
  getLastSyncLog,
  getSyncLogs,
  getMatchQualityReport,
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
   * Retorna relatório de qualidade dos matches para verificação manual.
   * Inclui todos os campos de rastreabilidade: emissor ANBIMA, emissor Moody's,
   * número de emissão SND, instrumento Moody's, score de similaridade e outlier.
   */
  getMatchReport: publicProcedure.query(async () => {
    const data = await getMatchQualityReport();
    return data.map((row) => ({
      ...row,
      scoreMatch: row.scoreMatch ? Number(row.scoreMatch) : null,
      durationAnos: row.durationAnos ? Number(row.durationAnos) : null,
      taxaIndicativa: row.taxaIndicativa ? Number(row.taxaIndicativa) : null,
      zspread: row.zspread ? Number(row.zspread) : null,
    }));
  }),

  /**
   * Dispara sincronização com os dois arquivos em base64 (via tRPC)
   * - moodysFileBase64: planilha MOODYS_LOCAL_BRAZIL_*.xlsx
   * - anbimaFileBase64: planilha debentures-precos-*.xlsx
   */
  triggerSync: protectedProcedure
    .input(
      z.object({
        moodysFileBase64: z.string(),
        anbimaFileBase64: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const moodysBuffer = Buffer.from(input.moodysFileBase64, "base64");
      const anbimaBuffer = Buffer.from(input.anbimaFileBase64, "base64");
      // Rodar em background sem bloquear a resposta
      runFullSync(moodysBuffer, anbimaBuffer).catch((err) => {
        console.error("[Sync] Erro na sincronização:", err);
      });
      return { started: true, message: "Sincronização iniciada em background" };
    }),
});
