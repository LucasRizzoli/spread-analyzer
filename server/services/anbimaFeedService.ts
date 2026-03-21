/**
 * Serviço de coleta de dados via ANBIMA Feed API (OAuth2)
 * Endpoints: NTN-B (curva livre de risco) + Debêntures + CRI/CRA
 */
import { anbimaFetch } from "./anbimaAuth";

// ─── Tipos da API ─────────────────────────────────────────────────────────────

export interface NtnbItem {
  codigo_selic: string;
  data_referencia: string;
  vencimento: string;
  taxa_indicativa: number;
  duration: number; // em dias úteis
  durationAnos: number;
}

export interface DebentureFeedItem {
  codigo_ativo: string;
  data_referencia: string;
  nome_ativo: string;
  taxa_indicativa: number;
  taxa_compra: number;
  taxa_venda: number;
  duration: number; // dias úteis
  durationAnos: number;
  remuneracao: string;
  indexador: string;
  percentual_indexador: number;
  emissor: string;
}

export interface CriCraFeedItem {
  codigo_ativo: string;
  data_referencia: string;
  nome_ativo: string;
  taxa_indicativa: number;
  taxa_compra: number;
  taxa_venda: number;
  duration: number;
  durationAnos: number;
  remuneracao: string;
  indexador: string;
  emissor: string;
  tipo: "CRI" | "CRA";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converte duration em dias úteis para anos (base 252)
 */
function diasUteisParaAnos(dias: number): number {
  return Math.round((dias / 252) * 10000) / 10000;
}

/**
 * Formata data para o padrão da API: YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Retorna a data de referência mais recente (hoje ou D-1 se fim de semana)
 */
function getDataReferencia(): string {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0) now.setUTCDate(now.getUTCDate() - 2); // domingo → sexta
  if (day === 6) now.setUTCDate(now.getUTCDate() - 1); // sábado → sexta
  return formatDate(now);
}

// ─── NTN-B ────────────────────────────────────────────────────────────────────

interface AnbimaNtnbRaw {
  codigo_selic?: string;
  CodigoSelic?: string;
  data_referencia?: string;
  DataReferencia?: string;
  vencimento?: string;
  Vencimento?: string;
  taxa_indicativa?: number | string;
  TaxaIndicativa?: number | string;
  duration?: number | string;
  Duration?: number | string;
}

export async function fetchNtnbCurve(dataRef?: string): Promise<NtnbItem[]> {
  const data = dataRef || getDataReferencia();
  const raw = await anbimaFetch<AnbimaNtnbRaw[]>(
    `/titulos-publicos/anbima?data-referencia=${data}&codigo-selic=760199`
  );

  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    const durationDias = Number(item.duration ?? item.Duration ?? 0);
    return {
      codigo_selic: String(item.codigo_selic ?? item.CodigoSelic ?? "760199"),
      data_referencia: String(item.data_referencia ?? item.DataReferencia ?? data),
      vencimento: String(item.vencimento ?? item.Vencimento ?? ""),
      taxa_indicativa: Number(item.taxa_indicativa ?? item.TaxaIndicativa ?? 0),
      duration: durationDias,
      durationAnos: diasUteisParaAnos(durationDias),
    };
  });
}

// ─── Debêntures ───────────────────────────────────────────────────────────────

interface AnbimaDebRaw {
  codigo_ativo?: string;
  CodigoAtivo?: string;
  data_referencia?: string;
  DataReferencia?: string;
  nome_ativo?: string;
  NomeAtivo?: string;
  taxa_indicativa?: number | string;
  TaxaIndicativa?: number | string;
  taxa_compra?: number | string;
  TaxaCompra?: number | string;
  taxa_venda?: number | string;
  TaxaVenda?: number | string;
  duration?: number | string;
  Duration?: number | string;
  remuneracao?: string;
  Remuneracao?: string;
  indexador?: string;
  Indexador?: string;
  percentual_indexador?: number | string;
  PercentualIndexador?: number | string;
  emissor?: string;
  Emissor?: string;
}

export async function fetchDebentures(dataRef?: string): Promise<DebentureFeedItem[]> {
  const data = dataRef || getDataReferencia();
  const raw = await anbimaFetch<AnbimaDebRaw[]>(
    `/debentures/anbima?data-referencia=${data}`
  );

  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    const durationDias = Number(item.duration ?? item.Duration ?? 0);
    return {
      codigo_ativo: String(item.codigo_ativo ?? item.CodigoAtivo ?? ""),
      data_referencia: String(item.data_referencia ?? item.DataReferencia ?? data),
      nome_ativo: String(item.nome_ativo ?? item.NomeAtivo ?? ""),
      taxa_indicativa: Number(item.taxa_indicativa ?? item.TaxaIndicativa ?? 0),
      taxa_compra: Number(item.taxa_compra ?? item.TaxaCompra ?? 0),
      taxa_venda: Number(item.taxa_venda ?? item.TaxaVenda ?? 0),
      duration: durationDias,
      durationAnos: diasUteisParaAnos(durationDias),
      remuneracao: String(item.remuneracao ?? item.Remuneracao ?? ""),
      indexador: String(item.indexador ?? item.Indexador ?? ""),
      percentual_indexador: Number(item.percentual_indexador ?? item.PercentualIndexador ?? 0),
      emissor: String(item.emissor ?? item.Emissor ?? ""),
    };
  }).filter((d) => d.codigo_ativo && d.taxa_indicativa > 0);
}

// ─── CRI/CRA ──────────────────────────────────────────────────────────────────

interface AnbimaCriCraRaw {
  codigo_ativo?: string;
  CodigoAtivo?: string;
  data_referencia?: string;
  DataReferencia?: string;
  nome_ativo?: string;
  NomeAtivo?: string;
  taxa_indicativa?: number | string;
  TaxaIndicativa?: number | string;
  taxa_compra?: number | string;
  TaxaCompra?: number | string;
  taxa_venda?: number | string;
  TaxaVenda?: number | string;
  duration?: number | string;
  Duration?: number | string;
  remuneracao?: string;
  Remuneracao?: string;
  indexador?: string;
  Indexador?: string;
  emissor?: string;
  Emissor?: string;
  tipo?: string;
}

export async function fetchCriCra(dataRef?: string): Promise<CriCraFeedItem[]> {
  const data = dataRef || getDataReferencia();

  const [criRaw, craRaw] = await Promise.all([
    anbimaFetch<AnbimaCriCraRaw[]>(`/cri/anbima?data-referencia=${data}`).catch(() => []),
    anbimaFetch<AnbimaCriCraRaw[]>(`/cra/anbima?data-referencia=${data}`).catch(() => []),
  ]);

  const mapItem = (item: AnbimaCriCraRaw, tipo: "CRI" | "CRA"): CriCraFeedItem => {
    const durationDias = Number(item.duration ?? item.Duration ?? 0);
    return {
      codigo_ativo: String(item.codigo_ativo ?? item.CodigoAtivo ?? ""),
      data_referencia: String(item.data_referencia ?? item.DataReferencia ?? data),
      nome_ativo: String(item.nome_ativo ?? item.NomeAtivo ?? ""),
      taxa_indicativa: Number(item.taxa_indicativa ?? item.TaxaIndicativa ?? 0),
      taxa_compra: Number(item.taxa_compra ?? item.TaxaCompra ?? 0),
      taxa_venda: Number(item.taxa_venda ?? item.TaxaVenda ?? 0),
      duration: durationDias,
      durationAnos: diasUteisParaAnos(durationDias),
      remuneracao: String(item.remuneracao ?? item.Remuneracao ?? ""),
      indexador: String(item.indexador ?? item.Indexador ?? ""),
      emissor: String(item.emissor ?? item.Emissor ?? ""),
      tipo,
    };
  };

  return [
    ...(Array.isArray(criRaw) ? criRaw.map((i) => mapItem(i, "CRI")) : []),
    ...(Array.isArray(craRaw) ? craRaw.map((i) => mapItem(i, "CRA")) : []),
  ].filter((d) => d.codigo_ativo && d.taxa_indicativa > 0);
}
