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

import { and, asc, between, desc, inArray, isNotNull, sql } from "drizzle-orm";
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
  incentivado?: boolean;
  ratings?: string[];
  setores?: string[];
  tipos?: string[];
  excludeOutliers?: boolean;
}

export async function getSpreadAnalysis(filters: SpreadFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (filters.durationMin !== undefined || filters.durationMax !== undefined) {
    const min = filters.durationMin ?? 0;
    const max = filters.durationMax ?? 100;
    conditions.push(between(spreadAnalysis.durationAnos, String(min), String(max)));
  }

  if (filters.indexadores?.length) {
    conditions.push(inArray(spreadAnalysis.indexador, filters.indexadores));
  }

  if (filters.incentivado !== undefined) {
    conditions.push(eq(spreadAnalysis.incentivado, filters.incentivado));
  }

  if (filters.ratings?.length) {
    conditions.push(inArray(spreadAnalysis.rating, filters.ratings));
  }

  if (filters.setores?.length) {
    conditions.push(inArray(spreadAnalysis.setor, filters.setores));
  }

  if (filters.tipos?.length) {
    conditions.push(inArray(spreadAnalysis.tipo, filters.tipos as ("DEB" | "CRI" | "CRA")[]));
  }

  return db
    .select()
    .from(spreadAnalysis)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(spreadAnalysis.durationAnos));
}

export async function getSpreadFiltersOptions() {
  const db = await getDb();
  if (!db) return { indexadores: [], setores: [], ratings: [], tipos: [] };

  const [indexadores, setores, ratings, tipos] = await Promise.all([
    db.selectDistinct({ value: spreadAnalysis.indexador }).from(spreadAnalysis).where(isNotNull(spreadAnalysis.indexador)).orderBy(asc(spreadAnalysis.indexador)),
    db.selectDistinct({ value: spreadAnalysis.setor }).from(spreadAnalysis).where(isNotNull(spreadAnalysis.setor)).orderBy(asc(spreadAnalysis.setor)),
    db.selectDistinct({ value: spreadAnalysis.rating }).from(spreadAnalysis).where(isNotNull(spreadAnalysis.rating)).orderBy(asc(spreadAnalysis.rating)),
    db.selectDistinct({ value: spreadAnalysis.tipo }).from(spreadAnalysis).where(isNotNull(spreadAnalysis.tipo)),
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

  const conditions = [
    isNotNull(spreadAnalysis.rating),
    isNotNull(spreadAnalysis.zspread),
  ];
  if (filters.durationMin !== undefined || filters.durationMax !== undefined) {
    const min = filters.durationMin ?? 0;
    const max = filters.durationMax ?? 100;
    conditions.push(between(spreadAnalysis.durationAnos, String(min), String(max)));
  }
  if (filters.indexadores?.length) {
    conditions.push(inArray(spreadAnalysis.indexador, filters.indexadores));
  }
  if (filters.incentivado !== undefined) {
    conditions.push(eq(spreadAnalysis.incentivado, filters.incentivado));
  }
  if (filters.ratings?.length) {
    conditions.push(inArray(spreadAnalysis.rating, filters.ratings));
  }
  if (filters.setores?.length) {
    conditions.push(inArray(spreadAnalysis.setor, filters.setores));
  }
  if (filters.tipos?.length) {
    conditions.push(inArray(spreadAnalysis.tipo, filters.tipos as ("DEB" | "CRI" | "CRA")[]));
  }
  if (filters.excludeOutliers) {
    conditions.push(eq(spreadAnalysis.isOutlier, false));
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
      zspread: spreadAnalysis.zspread,
      // Outlier
      isOutlier: spreadAnalysis.isOutlier,
    })
    .from(spreadAnalysis)
    .orderBy(asc(spreadAnalysis.rating), asc(spreadAnalysis.emissorNome));
}
