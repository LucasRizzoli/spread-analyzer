/**
 * Serviço de sincronização — orquestra todos os serviços e persiste no banco
 */
import { getDb } from "../db";
import {
  moodysRatings,
  anbimaAssets,
  ntnbCurve,
  spreadAnalysis,
  syncLog,
} from "../../drizzle/schema";
import { parseMoodysXlsx, MoodysRatingRow } from "./moodysScraperService";
import { fetchNtnbCurve, fetchDebentures, fetchCriCra } from "./anbimaFeedService";
import { fetchAnbimaDataAssets } from "./anbimaDataService";
import { calculateSpreads } from "./spreadCalculatorService";
import { eq } from "drizzle-orm";

export interface SyncProgress {
  step: string;
  done: number;
  total: number;
}

export type SyncStatus = "idle" | "running" | "success" | "error";

// Estado global de sincronização (simples, sem Redis)
let currentSyncStatus: SyncStatus = "idle";
let currentSyncProgress: SyncProgress = { step: "", done: 0, total: 0 };
let lastSyncAt: Date | null = null;
let lastSyncError: string | null = null;

export function getSyncState() {
  return {
    status: currentSyncStatus,
    progress: currentSyncProgress,
    lastSyncAt,
    lastSyncError,
  };
}

export async function runFullSync(
  moodysBuffer: Buffer,
  onProgress?: (p: SyncProgress) => void
): Promise<void> {
  if (currentSyncStatus === "running") {
    throw new Error("Sincronização já em andamento");
  }

  currentSyncStatus = "running";
  currentSyncError = null;
  let logId: number | null = null;

  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");

  const report = (step: string, done = 0, total = 0) => {
    currentSyncProgress = { step, done, total };
    onProgress?.({ step, done, total });
    console.log(`[Sync] ${step} (${done}/${total})`);
  };

  try {
    // Registrar início no log
    const [logResult] = await db.insert(syncLog).values({
      tipo: "full_sync",
      status: "running",
      mensagem: "Sincronização iniciada",
    });
    logId = (logResult as { insertId: number }).insertId;

    // ── 1. Processar planilha da Moody's (enviada pelo usuário) ─────────────
    report("Processando planilha da Moody's...", 0, 1);
    const moodysData: MoodysRatingRow[] = parseMoodysXlsx(moodysBuffer);
    report("Planilha da Moody's processada", 1, 1);

    // Limpar e reinserir ratings
    await db.delete(moodysRatings);
    for (let i = 0; i < moodysData.length; i += 100) {
      const batch = moodysData.slice(i, i + 100);
      await db.insert(moodysRatings).values(
        batch.map((r) => ({
          setor: r.setor || null,
          emissor: r.emissor,
          produto: r.produto || null,
          instrumento: r.instrumento || null,
          objeto: r.objeto || null,
          rating: r.rating,
          perspectiva: r.perspectiva || null,
          dataAtualizacao: r.dataAtualizacao || null,
          numeroEmissao: r.numeroEmissao || null,
        }))
      );
    }
    report(`${moodysData.length} ratings da Moody's salvos`, moodysData.length, moodysData.length);

    // ── 2. ANBIMA Feed: NTN-B ────────────────────────────────────────────────
    report("Coletando curva NTN-B...", 0, 1);
    const ntnbData = await fetchNtnbCurve();
    report("Curva NTN-B coletada", 1, 1);

    if (ntnbData.length > 0) {
      const dataRef = ntnbData[0].data_referencia;
      await db.delete(ntnbCurve).where(eq(ntnbCurve.dataReferencia, dataRef));
      await db.insert(ntnbCurve).values(
        ntnbData.map((n) => ({
          dataReferencia: n.data_referencia,
          codigoCetip: n.codigo_selic,
          vencimento: n.vencimento || null,
          taxaIndicativa: String(n.taxa_indicativa),
          durationAnos: String(n.durationAnos),
        }))
      );
      report(`${ntnbData.length} vértices NTN-B salvos`, ntnbData.length, ntnbData.length);
    }

    // ── 3. ANBIMA Feed: Debêntures + CRI/CRA ─────────────────────────────────
    report("Coletando debêntures e CRI/CRA...", 0, 2);
    const [debenturesData, criCraData] = await Promise.all([
      fetchDebentures(),
      fetchCriCra(),
    ]);
    report("Debêntures e CRI/CRA coletados", 2, 2);

    const totalAtivos = debenturesData.length + criCraData.length;
    report(`${totalAtivos} ativos coletados da ANBIMA Feed`, totalAtivos, totalAtivos);

    // ── 4. ANBIMA Data: metadados cadastrais (ISIN, emissor, incentivado) ────
    // Coletar apenas ativos que ainda não temos no banco ou que precisam de update
    const ativosParaBuscar = [
      ...debenturesData.map((d) => ({ codigoCetip: d.codigo_ativo, tipo: "DEB" as const })),
      ...criCraData.map((c) => ({ codigoCetip: c.codigo_ativo, tipo: c.tipo as "CRI" | "CRA" })),
    ];

    report("Coletando dados cadastrais (ANBIMA Data)...", 0, ativosParaBuscar.length);

    // Buscar apenas uma amostra para não demorar demais (máx 200 ativos)
    const sampleSize = Math.min(ativosParaBuscar.length, 200);
    const sample = ativosParaBuscar.slice(0, sampleSize);

    const anbimaDataResults = await fetchAnbimaDataAssets(sample, (done, total) => {
      report("Coletando dados cadastrais (ANBIMA Data)...", done, total);
    });

    // Salvar/atualizar ativos no banco
    for (const asset of anbimaDataResults) {
      await db
        .insert(anbimaAssets)
        .values({
          codigoCetip: asset.codigoCetip,
          isin: asset.isin || null,
          tipo: asset.tipo,
          emissorNome: asset.emissorNome || null,
          emissorCnpj: asset.emissorCnpj || null,
          setor: asset.setor || null,
          numeroEmissao: asset.numeroEmissao || null,
          numeroSerie: asset.numeroSerie || null,
          dataEmissao: asset.dataEmissao || null,
          dataVencimento: asset.dataVencimento || null,
          remuneracao: asset.remuneracao || null,
          indexador: asset.indexador || null,
          incentivado: asset.incentivado,
        })
        .onDuplicateKeyUpdate({
          set: {
            isin: asset.isin || null,
            emissorNome: asset.emissorNome || null,
            emissorCnpj: asset.emissorCnpj || null,
            setor: asset.setor || null,
            numeroEmissao: asset.numeroEmissao || null,
            incentivado: asset.incentivado,
          },
        });
    }

    // Atualizar preços dos ativos do Feed
    for (const deb of debenturesData) {
      await db
        .update(anbimaAssets)
        .set({
          taxaIndicativa: String(deb.taxa_indicativa),
          taxaCompra: String(deb.taxa_compra),
          taxaVenda: String(deb.taxa_venda),
          durationDias: deb.duration,
          durationAnos: String(deb.durationAnos),
          dataReferencia: deb.data_referencia,
          indexador: deb.indexador || null,
          remuneracao: deb.remuneracao || null,
        })
        .where(eq(anbimaAssets.codigoCetip, deb.codigo_ativo));
    }

    for (const cri of criCraData) {
      await db
        .update(anbimaAssets)
        .set({
          taxaIndicativa: String(cri.taxa_indicativa),
          taxaCompra: String(cri.taxa_compra),
          taxaVenda: String(cri.taxa_venda),
          durationDias: cri.duration,
          durationAnos: String(cri.durationAnos),
          dataReferencia: cri.data_referencia,
          indexador: cri.indexador || null,
          remuneracao: cri.remuneracao || null,
        })
        .where(eq(anbimaAssets.codigoCetip, cri.codigo_ativo));
    }

    // ── 5. Cruzamento e cálculo de Z-spread ──────────────────────────────────
    report("Calculando Z-spreads...", 0, 1);

    // Buscar ratings com IDs do banco
    const moodysFromDb = await db.select().from(moodysRatings);
    const ntnbFromDb = await db.select().from(ntnbCurve);

    const ntnbItems = ntnbFromDb.map((n) => ({
      codigo_selic: n.codigoCetip,
      data_referencia: n.dataReferencia,
      vencimento: n.vencimento || "",
      taxa_indicativa: Number(n.taxaIndicativa),
      duration: 0,
      durationAnos: Number(n.durationAnos),
    }));

    const moodysWithId = moodysFromDb.map((m) => ({
      id: m.id,
      setor: m.setor || "",
      emissor: m.emissor,
      produto: m.produto || "",
      instrumento: m.instrumento || "",
      objeto: m.objeto || "",
      rating: m.rating,
      perspectiva: m.perspectiva || "",
      dataAtualizacao: m.dataAtualizacao || "",
      numeroEmissao: m.numeroEmissao || null,
    }));

    const anbimaDataFromDb = await db.select().from(anbimaAssets);
    const anbimaDataForCalc = anbimaDataFromDb.map((a) => ({
      codigoCetip: a.codigoCetip,
      isin: a.isin || null,
      tipo: a.tipo,
      emissorNome: a.emissorNome || "",
      emissorCnpj: a.emissorCnpj || "",
      setor: a.setor || "",
      numeroEmissao: a.numeroEmissao || null,
      numeroSerie: a.numeroSerie || null,
      dataEmissao: a.dataEmissao || null,
      dataVencimento: a.dataVencimento || null,
      remuneracao: a.remuneracao || "",
      indexador: a.indexador || "",
      incentivado: a.incentivado || false,
    }));

    const spreadResults = calculateSpreads(
      debenturesData,
      criCraData,
      anbimaDataForCalc,
      moodysWithId,
      ntnbItems
    );

    // Salvar resultados
    await db.delete(spreadAnalysis);
    for (let i = 0; i < spreadResults.length; i += 100) {
      const batch = spreadResults.slice(i, i + 100);
      await db.insert(spreadAnalysis).values(
        batch.map((s) => ({
          codigoCetip: s.codigoCetip,
          isin: s.isin || null,
          tipo: s.tipo,
          emissorNome: s.emissorNome || null,
          setor: s.setor || null,
          indexador: s.indexador || null,
          incentivado: s.incentivado,
          rating: s.rating || null,
          tipoMatch: s.tipoMatch,
          moodysRatingId: s.moodysRatingId || null,
          taxaIndicativa: s.taxaIndicativa ? String(s.taxaIndicativa) : null,
          durationAnos: s.durationAnos ? String(s.durationAnos) : null,
          dataReferencia: s.dataReferencia || null,
          ntnbReferencia: s.ntnbReferencia || null,
          ntnbTaxa: s.ntnbTaxa ? String(s.ntnbTaxa) : null,
          ntnbDuration: s.ntnbDuration ? String(s.ntnbDuration) : null,
          zspread: s.zspread ? String(s.zspread) : null,
        }))
      );
    }

    report(`${spreadResults.length} spreads calculados e salvos`, spreadResults.length, spreadResults.length);

    // Atualizar log
    if (logId) {
      await db
        .update(syncLog)
        .set({
          status: "success",
          mensagem: `Sincronização concluída: ${moodysData.length} ratings, ${totalAtivos} ativos, ${spreadResults.length} spreads`,
          totalProcessados: spreadResults.length,
          finalizadoEm: new Date(),
        })
        .where(eq(syncLog.id, logId));
    }

    currentSyncStatus = "success";
    lastSyncAt = new Date();
    currentSyncProgress = { step: "Sincronização concluída!", done: 1, total: 1 };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Sync] Erro:", msg);
    currentSyncStatus = "error";
    lastSyncError = msg;

    if (logId) {
      const db2 = await getDb();
      if (db2) {
        await db2
          .update(syncLog)
          .set({
            status: "error",
            mensagem: msg,
            finalizadoEm: new Date(),
          })
          .where(eq(syncLog.id, logId));
      }
    }

    throw error;
  }
}

// Variável para evitar erro de referência
let currentSyncError: string | null = null;
