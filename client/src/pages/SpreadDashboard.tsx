import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw,
  TrendingUp,
  BarChart3,
  Table2,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  ExternalLink,
  FileDown,
  Eye,
  EyeOff,
  X,
  ClipboardCheck,
} from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import { sortRatings } from "../lib/ratings";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRate(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function formatDuration(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}a`;
}

const RATING_COLORS: Record<string, string> = {
  "AAA.br": "#10b981",
  "AA+.br": "#34d399",
  "AA.br": "#6ee7b7",
  "AA-.br": "#a7f3d0",
  "A+.br": "#38bdf8",
  "A.br": "#60a5fa",
  "A-.br": "#93c5fd",
  "BBB+.br": "#fbbf24",
  "BBB.br": "#f59e0b",
  "BBB-.br": "#d97706",
  "BB+.br": "#f97316",
  "BB.br": "#ef4444",
  "BB-.br": "#dc2626",
  "B+.br": "#b91c1c",
  "B.br": "#991b1b",
};

function getRatingColor(rating: string | null | undefined): string {
  if (!rating) return "#6b7280";
  return RATING_COLORS[rating] || "#6b7280";
}

// ─── Componente de filtros ────────────────────────────────────────────────────

interface FiltersState {
  durationRange: [number, number];
  indexadores: string[];
  incentivado: "todos" | "sim" | "nao";
  ratings: string[];
  setores: string[];
  tipos: string[];
}

const DEFAULT_FILTERS: FiltersState = {
  durationRange: [0, 20],
  indexadores: [],
  incentivado: "todos",
  ratings: [],
  setores: [],
  tipos: [],
};

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        {title}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function CheckItem({
  id,
  label,
  checked,
  onToggle,
  color,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} className="h-3.5 w-3.5" />
      <Label htmlFor={id} className="text-xs cursor-pointer flex items-center gap-1.5">
        {color && (
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        {label}
      </Label>
    </div>
  );
}

// ─── Modal de Relatório de Qualidade ─────────────────────────────────────────

type MatchReportRow = {
  id: number;
  codigoCetip: string;
  isin: string | null;
  tipo: "DEB" | "CRI" | "CRA" | null;
  dataReferencia: string | null;
  emissorAnbima: string | null;
  emissorMoodys: string | null;
  numeroEmissaoSnd: number | null;
  numeroEmissaoMoodys: string | null;
  instrumentoMoodys: string | null;
  rating: string | null;
  setor: string | null;
  scoreMatch: number | null;
  indexador: string | null;
  incentivado: boolean | null;
  durationAnos: number | null;
  taxaIndicativa: number | null;
  zspread: number | null;
  isOutlier: boolean | null;
};

function downloadCsv(rows: MatchReportRow[]) {
  const headers = [
    "Código CETIP",
    "ISIN",
    "Tipo",
    "Data Referência",
    "Emissor ANBIMA",
    "Emissor Moody's",
    "Nº Emissão (SND)",
    "Nº Emissão (Moody's)",
    "Instrumento Moody's",
    "Rating",
    "Setor",
    "Score Match",
    "Indexador",
    "Incentivado",
    "Duration (anos)",
    "Taxa Indicativa",
    "Z-spread (bps)",
    "Outlier",
  ];

  const escape = (v: string | number | boolean | null | undefined) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        escape(r.codigoCetip),
        escape(r.isin),
        escape(r.tipo),
        escape(r.dataReferencia),
        escape(r.emissorAnbima),
        escape(r.emissorMoodys),
        escape(r.numeroEmissaoSnd),
        escape(r.numeroEmissaoMoodys),
        escape(r.instrumentoMoodys),
        escape(r.rating),
        escape(r.setor),
        escape(r.scoreMatch != null ? r.scoreMatch.toFixed(4) : null),
        escape(r.indexador),
        escape(r.incentivado ? "Sim" : "Não"),
        escape(r.durationAnos != null ? r.durationAnos.toFixed(2) : null),
        escape(r.taxaIndicativa != null ? (r.taxaIndicativa * 100).toFixed(4) : null),
        escape(r.zspread != null ? (r.zspread * 100).toFixed(2) : null),
        escape(r.isOutlier ? "Sim" : "Não"),
      ].join(",")
    ),
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio-qualidade-matches-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MatchReportModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [showOutliersOnly, setShowOutliersOnly] = useState(false);
  const reportQuery = trpc.spread.getMatchReport.useQuery();
  const data = reportQuery.data || [];

  const filtered = useMemo(() => {
    let rows = data;
    if (showOutliersOnly) rows = rows.filter((r) => r.isOutlier);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.codigoCetip?.toLowerCase().includes(q) ||
          r.emissorAnbima?.toLowerCase().includes(q) ||
          r.emissorMoodys?.toLowerCase().includes(q) ||
          r.rating?.toLowerCase().includes(q) ||
          r.instrumentoMoodys?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, search, showOutliersOnly]);

  const outlierCount = useMemo(() => data.filter((r) => r.isOutlier).length, [data]);
  const hasData = data.length > 0;
  const hasNullScores = hasData && data.every((r) => r.scoreMatch == null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[95vw] max-w-7xl h-[90vh] flex flex-col">

        {/* Header do modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">Verificação Manual de Matches</h2>
              <p className="text-xs text-muted-foreground">
                Compare o que veio da ANBIMA com o que foi encontrado na Moody's para cada emissão
                {hasData && ` · ${data.length} pares · ${outlierCount} outliers`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasData && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadCsv(filtered as MatchReportRow[])}
                className="text-xs h-7 gap-1.5"
              >
                <FileDown className="h-3.5 w-3.5" />
                Exportar CSV ({filtered.length})
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Aviso de dados antigos */}
        {hasNullScores && (
          <div className="mx-6 mt-3 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex-shrink-0">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Dados desatualizados.</span>{" "}
              Os registros no banco foram gerados por uma versão anterior do sistema e não possuem os campos de rastreabilidade (emissor Moody's, instrumento, score de similaridade).
              {" "}<span className="font-semibold">Execute uma nova sincronização</span> com as planilhas para popular esses campos e habilitar a verificação completa.
            </div>
          </div>
        )}

        {/* Controles */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border flex-shrink-0 mt-2">
          <input
            type="text"
            placeholder="Buscar por código CETIP, emissor, instrumento Moody's ou rating..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 h-8 px-3 text-xs bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => setShowOutliersOnly(!showOutliersOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              showOutliersOnly
                ? "border-yellow-500/50 text-yellow-400 bg-yellow-500/10"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {showOutliersOnly ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showOutliersOnly ? "Apenas outliers" : "Todos"}
          </button>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {filtered.length} registros
          </span>
        </div>

        {/* Cabeçalho explicativo das colunas */}
        <div className="flex-1 overflow-auto">
          {reportQuery.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                {/* Linha de agrupamento de colunas */}
                <tr className="bg-muted/30 border-b border-border/60">
                  <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground/70 whitespace-nowrap" colSpan={2}>
                    IDENTIFICAÇÃO
                  </th>
                  <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-blue-400/70 whitespace-nowrap border-l border-blue-500/20" colSpan={2}>
                    ← ANBIMA DATA
                  </th>
                  <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-emerald-400/70 whitespace-nowrap border-l border-emerald-500/20" colSpan={3}>
                    MOODY'S LOCAL →
                  </th>
                    <th className="px-3 py-2 text-center text-[10px] font-semibold text-muted-foreground/70 whitespace-nowrap border-l border-border/60" colSpan={3}>
                    RESULTADO
                  </th>
                </tr>
                {/* Linha de nomes das colunas */}
                <tr className="bg-card border-b border-border">
                  {/* Identificação */}
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">Código CETIP</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">Tipo</th>
                  {/* ANBIMA */}
                  <th className="px-3 py-2 text-left font-semibold text-blue-400 whitespace-nowrap border-l border-blue-500/20">Emissor (ANBIMA)</th>
                  <th className="px-3 py-2 text-center font-semibold text-blue-400 whitespace-nowrap">Nº Emissão (SND)</th>
                  {/* Moody's */}
                  <th className="px-3 py-2 text-left font-semibold text-emerald-400 whitespace-nowrap border-l border-emerald-500/20">Emissor (Moody's)</th>
                  <th className="px-3 py-2 text-center font-semibold text-emerald-400 whitespace-nowrap">Nº Emissão</th>
                  <th className="px-3 py-2 text-left font-semibold text-emerald-400 whitespace-nowrap">Instrumento Moody's</th>
                  {/* Resultado */}
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-l border-border/60">Rating</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Score</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const zspreadBps = row.zspread != null ? Math.round(row.zspread * 100) : null;
                  const score = row.scoreMatch;
                  const scoreColor =
                    score == null
                      ? "text-muted-foreground"
                      : score >= 0.9
                      ? "text-emerald-400"
                      : score >= 0.75
                      ? "text-yellow-400"
                      : "text-orange-400";
                  const scoreBg =
                    score == null
                      ? ""
                      : score >= 0.9
                      ? "bg-emerald-500/10"
                      : score >= 0.75
                      ? "bg-yellow-500/10"
                      : "bg-orange-500/10";
                  // Verificar se os nomes de emissor são iguais (match exato)
                  const emissorMatch =
                    row.emissorAnbima && row.emissorMoodys
                      ? row.emissorAnbima.toLowerCase().includes(
                          row.emissorMoodys.split(" ")[0].toLowerCase()
                        ) ||
                        row.emissorMoodys.toLowerCase().includes(
                          row.emissorAnbima.split(" ")[0].toLowerCase()
                        )
                      : null;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-border/40 hover:bg-accent/30 transition-colors ${
                        row.isOutlier ? "bg-yellow-500/5" : i % 2 === 0 ? "" : "bg-white/[0.02]"
                      }`}
                    >
                      {/* Identificação */}
                      <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap font-semibold">
                        <a
                          href={`https://www.debentures.com.br/exploreosnd/consultaadados/emissoesdedebentures/caracteristicas_d.asp?tip_deb=publicas&selecao=${row.codigoCetip}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-blue-400 hover:underline transition-colors flex items-center gap-1"
                          title="Verificar no SND (debentures.com.br)"
                        >
                          {row.codigoCetip}
                          <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                        {row.tipo || "—"}
                      </td>
                      {/* ANBIMA */}
                      <td className="px-3 py-2.5 border-l border-blue-500/10">
                        <span className="text-blue-300 max-w-[200px] block truncate" title={row.emissorAnbima || ""}>
                          {row.emissorAnbima || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.numeroEmissaoSnd != null ? (
                          <span className="font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-[11px]">
                            {row.numeroEmissaoSnd}ª
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 text-[10px]">sem SND</span>
                        )}
                      </td>
                      {/* Moody's */}
                      <td className="px-3 py-2.5 border-l border-emerald-500/10">
                        <span
                          className={`max-w-[200px] block truncate ${
                            emissorMatch === true
                              ? "text-emerald-300"
                              : emissorMatch === false
                              ? "text-orange-300"
                              : "text-muted-foreground"
                          }`}
                          title={row.emissorMoodys || ""}
                        >
                          {row.emissorMoodys || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.numeroEmissaoMoodys ? (
                          <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px]">
                            {row.numeroEmissaoMoodys}ª
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.instrumentoMoodys ? (
                          <a
                            href={`https://moodyslocal.com.br/?s=${encodeURIComponent((row.emissorMoodys || row.codigoCetip).split(' ').slice(0, 2).join(' '))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-emerald-400 hover:underline transition-colors max-w-[240px] block truncate text-[11px] flex items-center gap-1"
                            title={`${row.instrumentoMoodys} — verificar na Moody's Local`}
                          >
                            <span className="truncate">{row.instrumentoMoodys}</span>
                            <ExternalLink className="h-2.5 w-2.5 opacity-50 flex-shrink-0" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50 text-[10px]">—</span>
                        )}
                      </td>
                      {/* Resultado */}
                      <td className="px-3 py-2.5 border-l border-border/40">
                        {row.rating ? (
                          <span className="font-bold text-[11px]" style={{ color: getRatingColor(row.rating) }}>
                            {row.rating}
                          </span>
                        ) : "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-center rounded-sm ${scoreBg}`}>
                        <span className={`font-mono text-[11px] font-bold ${scoreColor}`}>
                          {score != null ? score.toFixed(3) : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.isOutlier ? (
                          <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 rounded">
                            Outlier
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-400/70">✓</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!reportQuery.isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              {data.length === 0 ? (
                <>
                  <ClipboardCheck className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Nenhum dado disponível</p>
                  <p className="text-xs opacity-60">Execute uma sincronização com as planilhas para gerar os matches</p>
                </>
              ) : (
                <p className="text-sm">Nenhum registro encontrado para a busca</p>
              )}
            </div>
          )}
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-6 py-3 border-t border-border flex-shrink-0 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-foreground">Score:</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> ≥ 0.90 Excelente</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> 0.75–0.89 Bom</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> 0.65–0.74 Limiar</span>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <span className="font-semibold text-foreground">Emissor:</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Nomes compatíveis</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Verificar manualmente</span>
          </div>
          <span className="ml-auto">Outliers: pontos a ±3σ da média por rating (mín. 5 emissões)</span>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SpreadDashboard() {
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [activeView, setActiveView] = useState<"scatter" | "bar" | "table">("scatter");
  const [tableSearch, setTableSearch] = useState("");
  const [showOutliers, setShowOutliers] = useState(false);
  const [showMatchReport, setShowMatchReport] = useState(false);
  // Universo de análise: IPCA SPREAD (Z-spread sobre NTN-B) ou DI SPREAD (spread sobre CDI)
  const [universo, setUniverso] = useState<"IPCA" | "DI" | "todos">("todos");

  // Estado dos dois arquivos de upload
  const [moodysFile, setMoodysFile] = useState<File | null>(null);
  const [anbimaFile, setAnbimaFile] = useState<File | null>(null);
  const moodysInputRef = useRef<HTMLInputElement>(null);
  const anbimaInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const filterOptions = trpc.spread.getFilterOptions.useQuery();
  const syncState = trpc.spread.getSyncState.useQuery(undefined, { refetchInterval: 3000 });
  const lastSync = trpc.spread.getLastSync.useQuery();

  const analysisQuery = trpc.spread.getAnalysis.useQuery({
    durationMin: filters.durationRange[0],
    durationMax: filters.durationRange[1],
    indexadores: filters.indexadores.length ? filters.indexadores : undefined,
    incentivado:
      filters.incentivado === "todos"
        ? undefined
        : filters.incentivado === "sim",
    ratings: filters.ratings.length ? filters.ratings : undefined,
    setores: filters.setores.length ? filters.setores : undefined,
    tipos: filters.tipos.length ? filters.tipos : undefined,
  });

  const zspreadByRating = trpc.spread.getZspreadByRating.useQuery({
    durationMin: filters.durationRange[0],
    durationMax: filters.durationRange[1],
    indexadores: filters.indexadores.length ? filters.indexadores : undefined,
    incentivado:
      filters.incentivado === "todos"
        ? undefined
        : filters.incentivado === "sim",
    ratings: filters.ratings.length ? filters.ratings : undefined,
    setores: filters.setores.length ? filters.setores : undefined,
    tipos: filters.tipos.length ? filters.tipos : undefined,
  });
  const triggerSync = trpc.spread.triggerSync.useMutation({
    onSuccess: () => {
      toast.success("Sincronização iniciada", {
        description: "Os dados serão atualizados em alguns instantes.",
      });
      setMoodysFile(null);
      setAnbimaFile(null);
    },
    onError: (err) => {
      toast.error("Erro ao iniciar sincronização", { description: err.message });
    },
  });

  const handleMoodysFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
        toast.error("Arquivo inválido", { description: "Selecione um arquivo .xlsx da Moody's" });
        return;
      }
      setMoodysFile(file);
    }
  };

  const handleAnbimaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
        toast.error("Arquivo inválido", { description: "Selecione um arquivo .xlsx da ANBIMA Data" });
        return;
      }
      setAnbimaFile(file);
    }
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    return btoa(binary);
  };

  const handleSync = async () => {
    if (!moodysFile) {
      toast.error("Planilha Moody's obrigatória", {
        description: "Faça o download em moodyslocal.com.br e selecione o arquivo .xlsx",
      });
      moodysInputRef.current?.click();
      return;
    }
    if (!anbimaFile) {
      toast.error("Planilha ANBIMA Data obrigatória", {
        description: "Faça o download em data.anbima.com.br e selecione o arquivo .xlsx",
      });
      anbimaInputRef.current?.click();
      return;
    }
    try {
      const [moodysBase64, anbimaBase64] = await Promise.all([
        fileToBase64(moodysFile),
        fileToBase64(anbimaFile),
      ]);
      triggerSync.mutate({
        moodysFileBase64: moodysBase64,
        anbimaFileBase64: anbimaBase64,
      });
    } catch (err) {
      toast.error("Erro ao processar arquivos", {
        description: err instanceof Error ? err.message : "Tente novamente",
      });
    }
  };

   // Dados processados
  const allData = analysisQuery.data || [];
  const isSyncing = syncState.data?.status === "running";

  // 1. Filtrar por score mínimo 0.85 (nunca exibir matches de baixa confiança)
  const highScoreData = useMemo(() => {
    return allData.filter((r) => {
      const score = (r as { scoreMatch?: number | null }).scoreMatch;
      // Se scoreMatch é null (dados antigos), manter; se preenchido, exigir ≥ 0.85
      return score == null || score >= 0.85;
    });
  }, [allData]);

  // 2. Filtrar por universo (IPCA SPREAD vs DI SPREAD)
  const universoData = useMemo(() => {
    if (universo === "todos") return highScoreData;
    if (universo === "IPCA") {
      return highScoreData.filter((r) => {
        const idx = (r as { indexador?: string | null }).indexador;
        return idx === "IPCA SPREAD";
      });
    }
    // DI: inclui DI SPREAD e DI PERCENTUAL
    return highScoreData.filter((r) => {
      const idx = (r as { indexador?: string | null }).indexador;
      return idx === "DI SPREAD" || idx === "DI PERCENTUAL";
    });
  }, [highScoreData, universo]);

  // 3. Filtrar outliers (por padrão, ocultar outliers)
  const analysisData = useMemo(() => {
    if (showOutliers) return universoData;
    return universoData.filter((r) => !(r as { isOutlier?: boolean }).isOutlier);
  }, [universoData, showOutliers]);
  const outlierCount = useMemo(
    () => universoData.filter((r) => (r as { isOutlier?: boolean }).isOutlier).length,
    [universoData]
  );

  // Rótulo do eixo Y conforme universo
  const yAxisLabel = universo === "IPCA"
    ? "Z-Spread sobre NTN-B (bps)"
    : universo === "DI"
    ? "Spread sobre CDI (bps)"
    : "Z-Spread / Spread (bps)";

  // Filtrar tabela por busca
  const filteredTableData = useMemo(() => {
    if (!tableSearch) return analysisData;
    const q = tableSearch.toLowerCase();
    return analysisData.filter(
      (r) =>
        r.emissorNome?.toLowerCase().includes(q) ||
        r.codigoCetip?.toLowerCase().includes(q) ||
        r.isin?.toLowerCase().includes(q) ||
        r.rating?.toLowerCase().includes(q)
    );
  }, [analysisData, tableSearch]);

  // Dados para scatter chart
  const scatterData = useMemo(() => {
    return analysisData
      .filter((r) => r.zspread != null && r.durationAnos != null && r.rating)
      .map((r) => ({
        x: Number(r.durationAnos),
        y: Math.round(Number(r.zspread) * 100), // em bps
        rating: r.rating,
        emissor: r.emissorNome,
        cetip: r.codigoCetip,
        color: getRatingColor(r.rating),
      }));
  }, [analysisData]);

  // Agrupar scatter por rating para o Legend
  const ratingGroups = useMemo(() => {
    const ratings = Array.from(new Set(scatterData.map((d) => d.rating).filter(Boolean)));
    return sortRatings(ratings as string[]);
  }, [scatterData]);

  const toggleFilter = <K extends keyof FiltersState>(
    key: K,
    value: string,
    arr: string[]
  ) => {
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    setFilters((f) => ({ ...f, [key]: next }));
  };

  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const hasActiveFilters =
    filters.indexadores.length > 0 ||
    filters.ratings.length > 0 ||
    filters.setores.length > 0 ||
    filters.tipos.length > 0 ||
    filters.incentivado !== "todos" ||
    filters.durationRange[0] > 0 ||
    filters.durationRange[1] < 20;

  const sortedRatingOptions = useMemo(() => {
    return sortRatings(filterOptions.data?.ratings || []);
  }, [filterOptions.data?.ratings]);

  return (
    <>
      {/* Modal de relatório de qualidade */}
      {showMatchReport && <MatchReportModal onClose={() => setShowMatchReport(false)} />}

      <div className="flex h-screen bg-background overflow-hidden">
        {/* ── Sidebar de filtros ─────────────────────────────────────────────── */}
        <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
          {/* Logo / Header */}
          <div className="px-4 py-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-sm font-bold text-sidebar-foreground">Spread Analyzer</h1>
                <p className="text-xs text-muted-foreground">Crédito Corporativo</p>
              </div>
            </div>
          </div>

          {/* Status de sincronização */}
          <div className="px-4 py-3 border-b border-sidebar-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Última atualização</span>
              {isSyncing ? (
                <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-400">
                  <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                  Sincronizando
                </Badge>
              ) : syncState.data?.status === "success" ? (
                <Badge variant="outline" className="text-xs border-emerald-500/50 text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                  OK
                </Badge>
              ) : syncState.data?.status === "error" ? (
                <Badge variant="outline" className="text-xs border-red-500/50 text-red-400">
                  <AlertCircle className="h-2.5 w-2.5 mr-1" />
                  Erro
                </Badge>
              ) : null}
            </div>
            {lastSync.data?.finalizadoEm && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(lastSync.data.finalizadoEm).toLocaleString("pt-BR")}
              </p>
            )}
            {isSyncing && syncState.data?.progress && (
              <p className="text-xs text-yellow-400 mt-1">{syncState.data.progress.step}</p>
            )}

            {/* Upload dos dois arquivos */}
            <input
              ref={moodysInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleMoodysFileChange}
            />
            <input
              ref={anbimaInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleAnbimaFileChange}
            />
            <div className="mt-2 space-y-1.5">
              {/* Botão Moody's */}
              <button
                onClick={() => moodysInputRef.current?.click()}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs border transition-colors ${
                  moodysFile
                    ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                    : "border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                <Upload className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {moodysFile ? moodysFile.name : "Planilha Moody's (.xlsx)"}
                </span>
              </button>
              {/* Botão ANBIMA */}
              <button
                onClick={() => anbimaInputRef.current?.click()}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs border transition-colors ${
                  anbimaFile
                    ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                    : "border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                <Upload className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {anbimaFile ? anbimaFile.name : "Planilha ANBIMA Data (.xlsx)"}
                </span>
              </button>
              {/* Links de download */}
              <div className="flex gap-2 pt-0.5">
                <a
                  href="https://moodyslocal.com.br"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Moody's
                </a>
                <a
                  href="https://data.anbima.com.br/datasets/data-debentures-precificacao-anbima"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  ANBIMA Data
                </a>
              </div>
              {/* Botão Atualizar */}
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Sincronizando..." : "Atualizar dados"}
              </button>
            </div>
          </div>

          {/* Filtros */}
          <ScrollArea className="flex-1 px-4 py-3">
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="w-full mb-3 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1 rounded border border-dashed border-border hover:border-primary/50 transition-colors"
              >
                Limpar filtros
              </button>
            )}

            {/* Duration */}
            <FilterSection title="Duration (anos)">
              <div className="px-1 pb-1">
                <Slider
                  min={0}
                  max={20}
                  step={0.5}
                  value={filters.durationRange}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, durationRange: v as [number, number] }))
                  }
                  className="mt-2"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                  <span>{filters.durationRange[0]}a</span>
                  <span>{filters.durationRange[1]}a</span>
                </div>
              </div>
            </FilterSection>

            <Separator className="my-3 bg-sidebar-border" />

            {/* Rating */}
            <FilterSection title="Rating (Moody's Local)">
              {sortedRatingOptions.map((r) => (
                <CheckItem
                  key={r}
                  id={`rating-${r}`}
                  label={r}
                  checked={filters.ratings.includes(r)}
                  onToggle={() => toggleFilter("ratings", r, filters.ratings)}
                  color={getRatingColor(r)}
                />
              ))}
            </FilterSection>

            <Separator className="my-3 bg-sidebar-border" />

            {/* Produto */}
            <FilterSection title="Produto" defaultOpen={false}>
              {(filterOptions.data?.tipos || []).map((t) => (
                <CheckItem
                  key={t}
                  id={`tipo-${t}`}
                  label={t === "DEB" ? "Debênture" : t === "CRI" ? "CRI" : "CRA"}
                  checked={filters.tipos.includes(t)}
                  onToggle={() => toggleFilter("tipos", t, filters.tipos)}
                />
              ))}
            </FilterSection>

            <Separator className="my-3 bg-sidebar-border" />

            {/* Isenção fiscal */}
            <FilterSection title="Isenção Fiscal">
              {[
                { value: "todos", label: "Todos" },
                { value: "sim", label: "Incentivado (Lei 12.431)" },
                { value: "nao", label: "Não incentivado" },
              ].map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    id={`isencao-${opt.value}`}
                    name="isencao"
                    checked={filters.incentivado === opt.value}
                    onChange={() =>
                      setFilters((f) => ({ ...f, incentivado: opt.value as FiltersState["incentivado"] }))
                    }
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <Label htmlFor={`isencao-${opt.value}`} className="text-xs cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </FilterSection>

            <Separator className="my-3 bg-sidebar-border" />

            {/* Indexador */}
            <FilterSection title="Indexador" defaultOpen={false}>
              {(filterOptions.data?.indexadores || []).map((idx) => (
                <CheckItem
                  key={idx}
                  id={`idx-${idx}`}
                  label={idx}
                  checked={filters.indexadores.includes(idx)}
                  onToggle={() => toggleFilter("indexadores", idx, filters.indexadores)}
                />
              ))}
            </FilterSection>

            <Separator className="my-3 bg-sidebar-border" />

            {/* Setor */}
            <FilterSection title="Setor" defaultOpen={false}>
              {(filterOptions.data?.setores || []).map((s) => (
                <CheckItem
                  key={s}
                  id={`setor-${s}`}
                  label={s}
                  checked={filters.setores.includes(s)}
                  onToggle={() => toggleFilter("setores", s, filters.setores)}
                />
              ))}
            </FilterSection>

            <Separator className="my-3 bg-sidebar-border" />
          </ScrollArea>
        </aside>

        {/* ── Conteúdo principal ─────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {universo === "IPCA" ? "Z-Spread sobre NTN-B" : universo === "DI" ? "Spread sobre CDI" : "Análise de Spread"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {analysisData.length} ativos com spread calculado
                {!showOutliers && outlierCount > 0 && (
                  <span className="ml-1 text-yellow-500/80">· {outlierCount} outliers ocultos</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Seletor de universo */}
              <div className="flex items-center gap-0.5 bg-secondary rounded-md p-0.5">
                {([
                  { key: "todos", label: "Todos" },
                  { key: "IPCA", label: "IPCA+" },
                  { key: "DI", label: "DI+" },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setUniverso(key)}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                      universo === key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Botão Relatório de Qualidade */}
              {allData.length > 0 && (
                <button
                  onClick={() => setShowMatchReport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Relatório de Qualidade
                </button>
              )}

              {/* Toggle outliers */}
              {outlierCount > 0 && (
                <button
                  onClick={() => setShowOutliers(!showOutliers)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    showOutliers
                      ? "border-yellow-500/50 text-yellow-400 bg-yellow-500/10"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  title={showOutliers ? "Ocultar outliers" : "Mostrar outliers"}
                >
                  {showOutliers ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {showOutliers ? `Outliers visíveis (${outlierCount})` : `Outliers (${outlierCount})`}
                </button>
              )}

              {/* Toggle de visualização */}
              <div className="flex items-center gap-1 bg-secondary rounded-md p-0.5">
                {(
                  [
                    { key: "scatter", icon: TrendingUp, label: "Dispersão" },
                    { key: "bar", icon: BarChart3, label: "Por Rating" },
                    { key: "table", icon: Table2, label: "Tabela" },
                  ] as const
                ).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setActiveView(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      activeView === key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {/* Conteúdo da view */}
          <div className="flex-1 overflow-hidden p-6">
            {analysisQuery.isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : allData.length === 0 ? (
              <EmptyState
                onSync={handleSync}
                isSyncing={isSyncing}
                onMoodysSelect={() => moodysInputRef.current?.click()}
                onAnbimaSelect={() => anbimaInputRef.current?.click()}
                moodysFile={moodysFile}
                anbimaFile={anbimaFile}
              />
            ) : activeView === "scatter" ? (
              <ScatterView data={scatterData} ratingGroups={ratingGroups} yAxisLabel={yAxisLabel} />
            ) : activeView === "bar" ? (
              <BarView data={zspreadByRating.data || []} yAxisLabel={yAxisLabel} />
            ) : (
              <TableView
                data={filteredTableData}
                search={tableSearch}
                onSearchChange={setTableSearch}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  onSync,
  isSyncing,
  onMoodysSelect,
  onAnbimaSelect,
  moodysFile,
  anbimaFile,
}: {
  onSync: () => void;
  isSyncing: boolean;
  onMoodysSelect: () => void;
  onAnbimaSelect: () => void;
  moodysFile: File | null;
  anbimaFile: File | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center max-w-lg mx-auto">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <TrendingUp className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground mb-1">Nenhum dado disponível</h3>
        <p className="text-sm text-muted-foreground">
          Faça o download das planilhas e selecione os arquivos para iniciar a análise.
        </p>
      </div>

      {/* Instruções de download */}
      <div className="w-full grid grid-cols-2 gap-3 text-left">
        <div className="border border-border rounded-lg p-3 bg-card/50">
          <p className="text-xs font-semibold text-foreground mb-1">1. Planilha Moody's</p>
          <p className="text-xs text-muted-foreground mb-2">
            Acesse e baixe a planilha de ratings em formato .xlsx
          </p>
          <a
            href="https://moodyslocal.com.br"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            moodyslocal.com.br <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="border border-border rounded-lg p-3 bg-card/50">
          <p className="text-xs font-semibold text-foreground mb-1">2. Planilha ANBIMA Data</p>
          <p className="text-xs text-muted-foreground mb-2">
            Baixe o dataset de precificação de debêntures (.xlsx)
          </p>
          <a
            href="https://data.anbima.com.br/datasets/data-debentures-precificacao-anbima"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            data.anbima.com.br <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 w-full max-w-xs">
        <Button
          variant="outline"
          onClick={onMoodysSelect}
          className={`w-full ${moodysFile ? "border-emerald-500/50 text-emerald-400" : ""}`}
        >
          <Upload className="h-4 w-4 mr-2" />
          {moodysFile ? moodysFile.name : "Selecionar planilha Moody's"}
        </Button>
        <Button
          variant="outline"
          onClick={onAnbimaSelect}
          className={`w-full ${anbimaFile ? "border-emerald-500/50 text-emerald-400" : ""}`}
        >
          <Upload className="h-4 w-4 mr-2" />
          {anbimaFile ? anbimaFile.name : "Selecionar planilha ANBIMA Data"}
        </Button>
        <Button
          onClick={onSync}
          disabled={isSyncing || (!moodysFile && !anbimaFile)}
          className="w-full"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Sincronizando..." : "Iniciar sincronização"}
        </Button>
      </div>
    </div>
  );
}

// ─── Scatter Chart ────────────────────────────────────────────────────────────

interface ScatterPoint {
  x: number;
  y: number;
  rating: string | null | undefined;
  emissor: string | null | undefined;
  cetip: string;
  color: string;
}

function ScatterView({
  data,
  ratingGroups,
  yAxisLabel = "Z-Spread (bps)",
}: {
  data: ScatterPoint[];
  ratingGroups: string[];
  yAxisLabel?: string;
}) {
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: ScatterPoint }[] }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-popover border border-border rounded-lg p-3 text-xs shadow-xl">
        <p className="font-semibold text-foreground mb-1">{d.emissor || d.cetip}</p>
        <p className="text-muted-foreground">Código: {d.cetip}</p>
        <p>
          Rating:{" "}
          <span className="font-medium" style={{ color: d.color }}>
            {d.rating || "—"}
          </span>
        </p>
        <p>Duration: {d.x.toFixed(2)} anos</p>
        <p>
          Z-spread:{" "}
          <span className={d.y >= 0 ? "text-emerald-400" : "text-red-400"}>
            {d.y > 0 ? "+" : ""}{d.y} bps
          </span>
        </p>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        {ratingGroups.map((r) => (
          <span key={r} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: getRatingColor(r) }}
            />
            {r}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.01 240)" />
          <XAxis
            dataKey="x"
            name="Duration"
            type="number"
            label={{
              value: "Duration (anos)",
              position: "insideBottom",
              offset: -10,
              fill: "oklch(0.55 0.02 240)",
              fontSize: 11,
            }}
            tick={{ fill: "oklch(0.55 0.02 240)", fontSize: 11 }}
            tickFormatter={(v) => `${v}a`}
          />
          <YAxis
            dataKey="y"
            name="Z-spread"
            label={{
              value: yAxisLabel,
              angle: -90,
              position: "insideLeft",
              offset: 10,
              fill: "oklch(0.55 0.02 240)",
              fontSize: 11,
            }}
            tick={{ fill: "oklch(0.55 0.02 240)", fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="oklch(0.35 0.01 240)" strokeDasharray="4 4" />
          <Tooltip content={<CustomTooltip />} />
          <Scatter
            data={data}
            fill="#60a5fa"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            shape={(props: any) => {
              const { cx = 0, cy = 0, payload } = props;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={payload?.color || "#60a5fa"}
                  fillOpacity={0.8}
                  stroke={payload?.color || "#60a5fa"}
                  strokeWidth={0.5}
                />
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BarView({
  data,
  yAxisLabel = "Spread médio (bps)",
}: {
  data: { rating: string; avgZspread: number; count: number; minZspread: number; maxZspread: number }[];
  yAxisLabel?: string;
}) {
  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const order = sortRatings([a.rating, b.rating]);
      return order.indexOf(a.rating) - order.indexOf(b.rating);
    });
  }, [data]);

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { value: number }[];
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    const d = sorted.find((r) => r.rating === label);
    return (
      <div className="bg-popover border border-border rounded-lg p-3 text-xs shadow-xl">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        <p>
          Z-spread médio:{" "}
          <span className="text-primary font-medium">
            {Math.round(payload[0].value)} bps
          </span>
        </p>
        {d && (
          <>
            <p className="text-muted-foreground">
              Mín: {Math.round(d.minZspread * 100)} bps | Máx: {Math.round(d.maxZspread * 100)} bps
            </p>
            <p className="text-muted-foreground">{d.count} ativos</p>
          </>
        )}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={sorted.map((d) => ({
          ...d,
          avgZspreadBps: Math.round(d.avgZspread * 100),
        }))}
        margin={{ top: 10, right: 20, bottom: 60, left: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.01 240)" />
        <XAxis
          dataKey="rating"
          tick={{ fill: "oklch(0.55 0.02 240)", fontSize: 11 }}
          angle={-45}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ fill: "oklch(0.55 0.02 240)", fontSize: 11 }}
          label={{
            value: yAxisLabel,
            angle: -90,
            position: "insideLeft",
            offset: 10,
            fill: "oklch(0.55 0.02 240)",
            fontSize: 11,
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="oklch(0.35 0.01 240)" strokeDasharray="4 4" />
        <Bar dataKey="avgZspreadBps" radius={[3, 3, 0, 0]}>
          {sorted.map((entry) => (
            <Cell key={entry.rating} fill={getRatingColor(entry.rating)} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

type AnalysisRow = {
  id: number;
  codigoCetip: string;
  isin: string | null;
  tipo: "DEB" | "CRI" | "CRA" | null;
  emissorNome: string | null;
  setor: string | null;
  indexador: string | null;
  incentivado: boolean | null;
  rating: string | null;
  tipoMatch: "emissao" | "emissor" | "sem_match" | null;
  taxaIndicativa: number | null;
  durationAnos: number | null;
  dataReferencia: string | null;
  ntnbReferencia: string | null;
  ntnbTaxa: number | null;
  zspread: number | null;
};

function TableView({
  data,
  search,
  onSearchChange,
}: {
  data: AnalysisRow[];
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Buscar por emissor, código, ISIN ou rating..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 h-8 px-3 text-xs bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {data.length} resultados
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs financial-table">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2.5 text-left">Emissor</th>
              <th className="px-3 py-2.5 text-left">Código</th>
              <th className="px-3 py-2.5 text-left">Tipo</th>
              <th className="px-3 py-2.5 text-left">Indexador</th>
              <th className="px-3 py-2.5 text-center">Incentivado</th>
              <th className="px-3 py-2.5 text-left">Rating</th>
              <th className="px-3 py-2.5 text-right">Duration</th>
              <th className="px-3 py-2.5 text-right">Taxa Indicativa</th>
              <th className="px-3 py-2.5 text-left">NTN-B Ref.</th>
              <th className="px-3 py-2.5 text-right">Z-spread</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const zspreadBps = row.zspread != null ? Math.round(row.zspread * 100) : null;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-border/50 hover:bg-accent/30 transition-colors ${
                    i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-foreground max-w-[160px] truncate">
                    {row.emissorNome || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{row.codigoCetip}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
                      {row.tipo || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.indexador || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {row.incentivado ? (
                      <span className="text-emerald-400 text-[10px] font-medium">Sim</span>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">Não</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.rating ? (
                      <span
                        className="font-semibold text-[11px]"
                        style={{ color: getRatingColor(row.rating) }}
                      >
                        {row.rating}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatDuration(row.durationAnos)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {formatRate(row.taxaIndicativa)}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">
                    {row.ntnbReferencia || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {zspreadBps != null ? (
                      <span className={zspreadBps >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {zspreadBps > 0 ? "+" : ""}{zspreadBps} bps
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Nenhum resultado encontrado
          </div>
        )}
      </div>
    </div>
  );
}
