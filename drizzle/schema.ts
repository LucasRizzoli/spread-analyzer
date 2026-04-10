import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  index,
  uniqueIndex,
  datetime,
  date,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Ratings da Moody's Local — scraped da planilha pública
 */
export const moodysRatings = mysqlTable(
  "moodys_ratings",
  {
    id: int("id").autoincrement().primaryKey(),
    setor: varchar("setor", { length: 128 }),
    emissor: varchar("emissor", { length: 256 }).notNull(),
    produto: varchar("produto", { length: 128 }),
    instrumento: varchar("instrumento", { length: 256 }),
    objeto: varchar("objeto", { length: 512 }),
    rating: varchar("rating", { length: 32 }).notNull(),
    perspectiva: varchar("perspectiva", { length: 64 }),
    dataAtualizacao: varchar("dataAtualizacao", { length: 32 }),
    // Número da emissão extraído do campo "objeto" (ex: "4ª Emissão")
    numeroEmissao: varchar("numeroEmissao", { length: 16 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_moodys_emissor").on(t.emissor)]
);

export type MoodysRating = typeof moodysRatings.$inferSelect;

/**
 * Ativos cadastrais da ANBIMA Data (debêntures, CRI, CRA)
 * Obtidos via Playwright + reCAPTCHA token
 */
export const anbimaAssets = mysqlTable(
  "anbima_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    codigoCetip: varchar("codigoCetip", { length: 16 }).notNull().unique(),
    isin: varchar("isin", { length: 32 }),
    tipo: mysqlEnum("tipo", ["DEB", "CRI", "CRA"]).notNull(),
    emissorNome: varchar("emissorNome", { length: 256 }),
    emissorCnpj: varchar("emissorCnpj", { length: 20 }),
    setor: varchar("setor", { length: 128 }),
    numeroEmissao: varchar("numeroEmissao", { length: 16 }),
    numeroSerie: varchar("numeroSerie", { length: 16 }),
    dataEmissao: varchar("dataEmissao", { length: 16 }),
    dataVencimento: varchar("dataVencimento", { length: 16 }),
    remuneracao: varchar("remuneracao", { length: 128 }),
    indexador: varchar("indexador", { length: 32 }),
    incentivado: boolean("incentivado").default(false),
    // Dados de preço (atualizados diariamente)
    taxaIndicativa: decimal("taxaIndicativa", { precision: 10, scale: 6 }),
    taxaCompra: decimal("taxaCompra", { precision: 10, scale: 6 }),
    taxaVenda: decimal("taxaVenda", { precision: 10, scale: 6 }),
    durationDias: int("durationDias"),
    durationAnos: decimal("durationAnos", { precision: 8, scale: 4 }),
    dataReferencia: varchar("dataReferencia", { length: 16 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_anbima_isin").on(t.isin),
    index("idx_anbima_emissor").on(t.emissorNome),
    index("idx_anbima_tipo").on(t.tipo),
  ]
);

export type AnbimaAsset = typeof anbimaAssets.$inferSelect;

/**
 * Curva NTN-B — vértices da curva livre de risco IPCA
 * Obtidos via ANBIMA Feed API
 */
export const ntnbCurve = mysqlTable("ntnb_curve", {
  id: int("id").autoincrement().primaryKey(),
  dataReferencia: varchar("dataReferencia", { length: 16 }).notNull(),
  codigoCetip: varchar("codigoCetip", { length: 16 }).notNull(),
  vencimento: varchar("vencimento", { length: 16 }),
  taxaIndicativa: decimal("taxaIndicativa", { precision: 10, scale: 6 }),
  durationAnos: decimal("durationAnos", { precision: 8, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NtnbCurve = typeof ntnbCurve.$inferSelect;

/**
 * Resultado do cruzamento: ativo ANBIMA + rating Moody's + Z-spread calculado
 */
export const spreadAnalysis = mysqlTable(
  "spread_analysis",
  {
    id: int("id").autoincrement().primaryKey(),
    // Referência ao ativo
    codigoCetip: varchar("codigoCetip", { length: 16 }).notNull(),
    isin: varchar("isin", { length: 32 }),
    tipo: mysqlEnum("tipo", ["DEB", "CRI", "CRA"]),
    emissorNome: varchar("emissorNome", { length: 256 }),
    setor: varchar("setor", { length: 128 }),
    indexador: varchar("indexador", { length: 32 }),
    incentivado: boolean("incentivado").default(false),
    // Rating Moody's
    rating: varchar("rating", { length: 32 }),
    tipoMatch: mysqlEnum("tipoMatch", ["emissao", "emissor", "sem_match"]).default("sem_match"),
    moodysRatingId: int("moodysRatingId"),
    // Dados de preço
    taxaIndicativa: decimal("taxaIndicativa", { precision: 10, scale: 6 }),
    durationAnos: decimal("durationAnos", { precision: 8, scale: 4 }),
    dataReferencia: varchar("dataReferencia", { length: 16 }),
    // NTN-B de referência
    ntnbReferencia: varchar("ntnbReferencia", { length: 16 }),
    ntnbTaxa: decimal("ntnbTaxa", { precision: 10, scale: 6 }),
    ntnbDuration: decimal("ntnbDuration", { precision: 8, scale: 4 }),
    // Data de vencimento do ativo
    dataVencimento: varchar("dataVencimento", { length: 16 }),
    // Z-spread calculado (em pontos percentuais)
    zspread: decimal("zspread", { precision: 10, scale: 6 }),
    // Spread incentivados sem gross-up (coluna da ANBIMA, apenas para Lei 12.431)
    spreadIncentivadoSemGrossUp: decimal("spreadIncentivadoSemGrossUp", { precision: 10, scale: 6 }),
    // Qualidade do match e outlier
    scoreMatch: decimal("scoreMatch", { precision: 5, scale: 4 }),
    isOutlier: boolean("isOutlier").default(false),
    // Informações de enriquecimento SND
    emissorMoodys: varchar("emissorMoodys", { length: 256 }),
    numeroEmissaoSnd: int("numeroEmissaoSnd"),
    numeroEmissaoMoodys: varchar("numeroEmissaoMoodys", { length: 16 }),
    instrumentoMoodys: varchar("instrumentoMoodys", { length: 256 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_spread_cetip").on(t.codigoCetip),
    uniqueIndex("uq_spread_cetip_data").on(t.codigoCetip, t.dataReferencia),
    index("idx_spread_data_ref").on(t.dataReferencia),
    index("idx_spread_rating").on(t.rating),
    index("idx_spread_tipo").on(t.tipo),
    index("idx_spread_indexador").on(t.indexador),
  ]
);

export type SpreadAnalysis = typeof spreadAnalysis.$inferSelect;

/**
 * Log de sincronizações
 */
export const syncLog = mysqlTable("sync_log", {
  id: int("id").autoincrement().primaryKey(),
  tipo: varchar("tipo", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["running", "success", "error"]).notNull(),
  mensagem: text("mensagem"),
  totalProcessados: int("totalProcessados").default(0),
  totalErros: int("totalErros").default(0),
  iniciadoEm: timestamp("iniciadoEm").defaultNow().notNull(),
  finalizadoEm: timestamp("finalizadoEm"),
  // v4.0: campos de janela rolling e snapshot
  dataReferencia: varchar("dataReferencia", { length: 16 }),
  papeisNaJanela: int("papeisNaJanela"),
  snapshotId: int("snapshotId"),
  alertas: json("alertas"),
});

export type SyncLog = typeof syncLog.$inferSelect;

/**
 * Snapshots históricos agregados por rating
 * Calculados a cada sync bem-sucedido — nunca deletados
 */
export const historicalSnapshots = mysqlTable(
  "historical_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    snapshotAt: datetime("snapshotAt").notNull(),
    dataRefIni: varchar("dataRefIni", { length: 16 }).notNull(),
    dataRefFim: varchar("dataRefFim", { length: 16 }).notNull(),
    indexador: varchar("indexador", { length: 32 }).notNull().default("IPCA SPREAD"),
    rating: varchar("rating", { length: 20 }).notNull(),
    nPapeis: int("nPapeis").notNull(),
    mediaSpread: decimal("mediaSpread", { precision: 10, scale: 4 }),
    medianaSpread: decimal("medianaSpread", { precision: 10, scale: 4 }),
    p25Spread: decimal("p25Spread", { precision: 10, scale: 4 }),
    p75Spread: decimal("p75Spread", { precision: 10, scale: 4 }),
    stdSpread: decimal("stdSpread", { precision: 10, scale: 4 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_snapshot_at_rating").on(t.snapshotAt, t.rating),
    index("idx_snapshot_rating").on(t.rating),
    uniqueIndex("uq_snapshot_date_idx_rating").on(t.dataRefFim, t.indexador, t.rating),
  ]
);

export type HistoricalSnapshot = typeof historicalSnapshots.$inferSelect;

/**
 * Backlog de planilhas enviadas (Moody's e ANBIMA)
 * Arquivos armazenados no S3 para reprocessamento futuro
 */
export const uploadedFiles = mysqlTable(
  "uploaded_files",
  {
    id: int("id").autoincrement().primaryKey(),
    tipo: mysqlEnum("tipo", ["moodys", "anbima"]).notNull(),
    nomeArquivo: varchar("nomeArquivo", { length: 256 }).notNull(),
    dataReferencia: varchar("dataReferencia", { length: 16 }),
    s3Key: varchar("s3Key", { length: 512 }).notNull(),
    s3Url: text("s3Url").notNull(),
    tamanhoBytes: int("tamanhoBytes"),
    uploadadoEm: timestamp("uploadadoEm").defaultNow().notNull(),
  },
  (t) => [
    index("idx_uploaded_tipo").on(t.tipo),
    index("idx_uploaded_data_ref").on(t.dataReferencia),
  ]
);

export type UploadedFile = typeof uploadedFiles.$inferSelect;
