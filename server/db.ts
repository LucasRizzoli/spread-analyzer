import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.

// ─── Spread Analysis Queries ──────────────────────────────────────────────────

import { and, asc, between, desc, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  anbimaAssets,
  moodysRatings,
  ntnbCurve,
  spreadAnalysis,
  syncLog,
} from "../drizzle/schema";

export interface SpreadFilters {
  durationMin?: number;
  durationMax?: number;
  indexadores?: string[];
  ratings?: string[];
  setores?: string[];
  excludeOutliers?: boolean;
  scoreMin?: number;
}

/**
 * Cache in-memory para getLatestDataReferencia.
 * TTL de 60 segundos para evitar N queries desnecessárias por request.
 */
let _latestDateCache: { value: string | null; expiresAt: number } | null = null;

/** Invalida o cache (chamar após cada sync bem-sucedido) */
export function invalidateLatestDateCache(): void {
  _latestDateCache = null;
}

/**
 * Retorna a data de referência mais recente disponível no banco.
 * Resultado é cacheado por 60 segundos para reduzir queries repetidas.
 */
async function getLatestDataReferencia(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<string | null> {
  const now = Date.now();
  if (_latestDateCache && now < _latestDateCache.expiresAt) {
    return _latestDateCache.value;
  }
  const result = await db
    .select({ maxDate: sql<string>`MAX(${spreadAnalysis.dataReferencia})` })
    .from(spreadAnalysis);
  const value = result[0]?.maxDate ?? null;
  _latestDateCache = { value, expiresAt: now + 60_000 };
  return value;
}

export async function getSpreadAnalysis(filters: SpreadFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const latestDate = await getLatestDataReferencia(db);
  const conditions = latestDate
    ? [sql`${spreadAnalysis.dataReferencia} = ${latestDate}`]
    : [];

  if (filters.durationMin !== undefined || filters.durationMax !== undefined) {
    const min = filters.durationMin ?? 0;
    const max = filters.durationMax ?? 100;
    // CAST para DECIMAL evita comparação lexicográfica de strings ("9.5" > "10.0" seria errado)
    conditions.push(
      sql`CAST(${spreadAnalysis.durationAnos} AS DECIMAL(10,4)) BETWEEN ${min} AND ${max}`
    );
  }

  if (filters.indexadores?.length) {
    conditions.push(inArray(spreadAnalysis.indexador, filters.indexadores));
  }

  if (filters.ratings?.length) {
    conditions.push(inArray(spreadAnalysis.rating, filters.ratings));
  }

  if (filters.setores?.length) {
    conditions.push(inArray(spreadAnalysis.setor, filters.setores));
  }
  if (filters.excludeOutliers) {
    conditions.push(sql`${spreadAnalysis.isOutlier} = 0`);
  }
  if (filters.scoreMin !== undefined) {
    conditions.push(gte(spreadAnalysis.scoreMatch, String(filters.scoreMin)));
  }
  return db
    .select()
    .from(spreadAnalysis)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`CAST(${spreadAnalysis.durationAnos} AS DECIMAL(10,4)) ASC`);
}

export async function getSpreadFiltersOptions() {
  const db = await getDb();
  if (!db) return { indexadores: [], setores: [], ratings: [], tipos: [] };

  const latestDate = await getLatestDataReferencia(db);
  const dateFilter = latestDate
    ? sql`${spreadAnalysis.dataReferencia} = ${latestDate}`
    : isNotNull(spreadAnalysis.dataReferencia);

  const [indexadores, setores, ratings, tipos] = await Promise.all([
    db.selectDistinct({ value: spreadAnalysis.indexador }).from(spreadAnalysis).where(and(isNotNull(spreadAnalysis.indexador), dateFilter)).orderBy(asc(spreadAnalysis.indexador)),
    db.selectDistinct({ value: spreadAnalysis.setor }).from(spreadAnalysis).where(and(isNotNull(spreadAnalysis.setor), dateFilter)).orderBy(asc(spreadAnalysis.setor)),
    db.selectDistinct({ value: spreadAnalysis.rating }).from(spreadAnalysis).where(and(isNotNull(spreadAnalysis.rating), dateFilter)).orderBy(asc(spreadAnalysis.rating)),
    db.selectDistinct({ value: spreadAnalysis.tipo }).from(spreadAnalysis).where(and(isNotNull(spreadAnalysis.tipo), dateFilter)),
  ]);

  return {
    indexadores: indexadores.map((r) => r.value).filter(Boolean) as string[],
    setores: setores.map((r) => r.value).filter(Boolean) as string[],
    ratings: ratings.map((r) => r.value).filter(Boolean) as string[],
    tipos: tipos.map((r) => r.value).filter(Boolean) as string[],
  };
}

export async function getZspreadByRating(filters: SpreadFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const latestDate = await getLatestDataReferencia(db);
  const conditions = [
    isNotNull(spreadAnalysis.rating),
    isNotNull(spreadAnalysis.zspread),
    ...(latestDate ? [sql`${spreadAnalysis.dataReferencia} = ${latestDate}`] : []),
  ];
  if (filters.durationMin !== undefined || filters.durationMax !== undefined) {
    const min = filters.durationMin ?? 0;
    const max = filters.durationMax ?? 100;
    // CAST para DECIMAL evita comparação lexicográfica de strings
    conditions.push(
      sql`CAST(${spreadAnalysis.durationAnos} AS DECIMAL(10,4)) BETWEEN ${min} AND ${max}`
    );
  }
  if (filters.indexadores?.length) {
    conditions.push(inArray(spreadAnalysis.indexador, filters.indexadores));
  }
  if (filters.ratings?.length) {
    conditions.push(inArray(spreadAnalysis.rating, filters.ratings));
  }
  if (filters.setores?.length) {
    conditions.push(inArray(spreadAnalysis.setor, filters.setores));
  }
  if (filters.excludeOutliers) {
    conditions.push(sql`${spreadAnalysis.isOutlier} = 0`);
  }
  if (filters.scoreMin !== undefined) {
    conditions.push(gte(spreadAnalysis.scoreMatch, String(filters.scoreMin)));
  }

  // Buscar todos os valores brutos para calcular mediana no servidor
  const rows = await db
    .select({
      rating: spreadAnalysis.rating,
      zspread: spreadAnalysis.zspread,
    })
    .from(spreadAnalysis)
    .where(and(...conditions))
    .orderBy(asc(spreadAnalysis.rating));

  // Agrupar por rating e calcular média, mediana, min, max
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.rating || row.zspread === null || row.zspread === undefined) continue;
    const v = Number(row.zspread);
    if (!isFinite(v)) continue;
    if (!grouped.has(row.rating)) grouped.set(row.rating, []);
    grouped.get(row.rating)!.push(v);
  }

  const calcMedian = (vals: number[]): number => {
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  return Array.from(grouped.entries()).map(([rating, vals]) => ({
    rating,
    avgZspread: vals.reduce((s, v) => s + v, 0) / vals.length,
    medianZspread: calcMedian(vals),
    count: vals.length,
    minZspread: Math.min(...vals),
    maxZspread: Math.max(...vals),
  }));
}

export async function getLastSyncLog() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(syncLog).orderBy(desc(syncLog.iniciadoEm)).limit(1);
  return result[0] || null;
}

export async function getSyncLogs(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(syncLog).orderBy(desc(syncLog.iniciadoEm)).limit(limit);
}

/**
 * Retorna todos os dados de spread com campos de rastreabilidade para
 * o relatório de qualidade dos matches (verificação manual).
 * Inclui: emissor ANBIMA, emissor Moody's, número de emissão SND,
 * instrumento Moody's, score de similaridade e flag de outlier.
 */
export async function getMatchQualityReport() {
  const db = await getDb();
  if (!db) return [];

  const latestDate = await getLatestDataReferencia(db);
  const dateCondition = latestDate
    ? sql`${spreadAnalysis.dataReferencia} = ${latestDate}`
    : undefined;

  return db
    .select({
      id: spreadAnalysis.id,
      codigoCetip: spreadAnalysis.codigoCetip,
      isin: spreadAnalysis.isin,
      tipo: spreadAnalysis.tipo,
      dataReferencia: spreadAnalysis.dataReferencia,
      // Emissor ANBIMA
      emissorAnbima: spreadAnalysis.emissorNome,
      // Dados do match Moody's
      emissorMoodys: spreadAnalysis.emissorMoodys,
      // Nota: campo ainda se chama numeroEmissaoSnd no schema DB por compatibilidade histórica,
      // mas agora é populado via ANBIMA Data (não mais pelo SND/debentures.com.br)
      numeroEmissaoSnd: spreadAnalysis.numeroEmissaoSnd,
      numeroEmissaoMoodys: spreadAnalysis.numeroEmissaoMoodys,
      instrumentoMoodys: spreadAnalysis.instrumentoMoodys,
      rating: spreadAnalysis.rating,
      setor: spreadAnalysis.setor,
      scoreMatch: spreadAnalysis.scoreMatch,
      // Dados financeiros
      indexador: spreadAnalysis.indexador,
      incentivado: spreadAnalysis.incentivado,
      durationAnos: spreadAnalysis.durationAnos,
      taxaIndicativa: spreadAnalysis.taxaIndicativa,
      dataVencimento: spreadAnalysis.dataVencimento,
      zspread: spreadAnalysis.zspread,
      spreadIncentivadoSemGrossUp: spreadAnalysis.spreadIncentivadoSemGrossUp,
      // Outlier
      isOutlier: spreadAnalysis.isOutlier,
    })
    .from(spreadAnalysis)
    .where(dateCondition)
    .orderBy(asc(spreadAnalysis.rating), asc(spreadAnalysis.emissorNome));
}

/**
 * Retorna as datas de referência distintas disponíveis no banco,
 * ordenadas da mais recente para a mais antiga.
 * Usado para navegação histórica futura.
 */
export async function getAvailableDates(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .selectDistinct({ dataReferencia: spreadAnalysis.dataReferencia })
    .from(spreadAnalysis)
    .where(isNotNull(spreadAnalysis.dataReferencia))
    .orderBy(desc(spreadAnalysis.dataReferencia));

  return rows.map((r) => r.dataReferencia).filter(Boolean) as string[];
}

// ─── Historical Snapshots Queries ────────────────────────────────────────────

import { historicalSnapshots } from "../drizzle/schema";

/**
 * Retorna os snapshots históricos agrupados por data de referência final.
 * Usado para o gráfico de linha temporal na aba Dados.
 */
export async function getHistoricalSnapshots(limit = 90) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(historicalSnapshots)
    .orderBy(desc(historicalSnapshots.snapshotAt))
    .limit(limit * 12); // até 12 ratings por snapshot

  return rows.map((r) => ({
    ...r,
    mediaSpread: r.mediaSpread ? Number(r.mediaSpread) : null,
    medianaSpread: r.medianaSpread ? Number(r.medianaSpread) : null,
    p25Spread: r.p25Spread ? Number(r.p25Spread) : null,
    p75Spread: r.p75Spread ? Number(r.p75Spread) : null,
    stdSpread: r.stdSpread ? Number(r.stdSpread) : null,
  }));
}

/**
 * Retorna o resumo da janela ativa: datas, total de papéis, último sync.
 */
export async function getWindowSummary() {
  const db = await getDb();
  if (!db) return null;

  const [dateRange] = await db.execute(sql`
    SELECT
      MIN(dataReferencia) AS dataMin,
      MAX(dataReferencia) AS dataMax,
      COUNT(*) AS totalPapeis,
      COUNT(DISTINCT dataReferencia) AS totalDatas,
      COUNT(DISTINCT codigoCetip) AS totalCetips,
      SUM(CASE WHEN isOutlier = 1 THEN 1 ELSE 0 END) AS totalOutliers
    FROM spread_analysis
  `) as unknown as { dataMin: string; dataMax: string; totalPapeis: number; totalDatas: number; totalCetips: number; totalOutliers: number }[][];

  const summary = (dateRange as unknown as { dataMin: string; dataMax: string; totalPapeis: number; totalDatas: number; totalCetips: number; totalOutliers: number }[])[0];
  if (!summary) return null;

  return {
    dataMin: summary.dataMin || null,
    dataMax: summary.dataMax || null,
    totalPapeis: Number(summary.totalPapeis) || 0,
    totalDatas: Number(summary.totalDatas) || 0,
    totalCetips: Number(summary.totalCetips) || 0,
    totalOutliers: Number(summary.totalOutliers) || 0,
  };
}
