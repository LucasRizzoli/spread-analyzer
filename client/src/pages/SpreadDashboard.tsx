import { useState, useMemo, useRef, useEffect } from "react";
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
  Database,
  TrendingDown,
  Activity,
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
  ComposedChart,
  Line,
  LineChart,
  Legend,
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

// Escala semântica: verde escuro (AAA) → verde claro → amarelo → laranja → vermelho → vinho (B)
// Quanto pior o crédito, mais "quente" a cor — intuitivo para análise de risco
const RATING_COLORS: Record<string, string> = {
  "AAA.br":  "#16a34a", // verde escuro — melhor qualidade
  "AA+.br":  "#22c55e", // verde médio
  "AA.br":   "#86efac", // verde claro
  "AA-.br":  "#bef264", // verde-amarelado
  "A+.br":   "#facc15", // amarelo
  "A.br":    "#fb923c", // laranja
  "A-.br":   "#f97316", // laranja escuro
  "BBB+.br": "#ef4444", // vermelho — grau especulativo começa aqui
  "BBB.br":  "#dc2626", // vermelho escuro
  "BBB-.br": "#b91c1c", // vinho claro
  "BB+.br":  "#991b1b", // vinho
  "BB.br":   "#7f1d1d", // vinho escuro
  "BB-.br":  "#6b0f0f", // vinho muito escuro
  "B+.br":   "#450a0a", // quase preto-vinho
  "B.br":    "#3b0000", // preto-vinho — pior qualidade
};

function getRatingColor(rating: string | null | undefined): string {
  if (!rating) return "#6b7280";
  return RATING_COLORS[rating] || "#6b7280";
}

// ─── Componente de filtros ────────────────────────────────────────────────────

interface FiltersState {
  durationRange: [number, number];
  indexadores: string[];
  ratings: string[];
  setores: string[];
}

const DEFAULT_FILTERS: FiltersState = {
  durationRange: [0, 20],
  indexadores: [],
  ratings: [],
  setores: [],
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
  durationAnos: number | null;
  taxaIndicativa: number | null;
  zspread: number | null;
  isOutlier: boolean | null;
};

function downloadCsv(rows: MatchReportRow[]) {
  const headers = [
    "Código CETIP",
    "ISIN",
    "Data Referência",
    "Emissor ANBIMA",
    "Emissor Moody's",
    "Nº Emissão (ANBIMA Data)",
    "Nº Emissão (Moody's)",
    "Instrumento Moody's",
    "Rating",
    "Setor",
    "Score Match",
    "Indexador",
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
    // Nunca exibir matches com score < 0.80 no relatório de qualidade
    let rows = data.filter((r) => r.scoreMatch == null || r.scoreMatch >= 0.80); // limiar único: 0.80
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
                  <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground/70 whitespace-nowrap" colSpan={1}>
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
                  {/* ANBIMA */}
                  <th className="px-3 py-2 text-left font-semibold text-blue-400 whitespace-nowrap border-l border-blue-500/20">Emissor (ANBIMA)</th>
                  <th className="px-3 py-2 text-center font-semibold text-blue-400 whitespace-nowrap">Nº Emissão (ANBIMA)</th>
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
                      : score >= 0.80
                      ? "text-yellow-400"
                      : "text-orange-400";
                  const scoreBg =
                    score == null
                      ? ""
                      : score >= 0.9
                      ? "bg-emerald-500/10"
                      : score >= 0.80
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
                          href={`https://data.anbima.com.br/debentures/${row.codigoCetip}/caracteristicas`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-blue-400 hover:underline transition-colors flex items-center gap-1"
                          title="Ver no ANBIMA Data"
                        >
                          {row.codigoCetip}
                          <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                        </a>
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
                          <span className="text-muted-foreground/50 text-[10px]">sem dados</span>
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
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> ≥ 0.90 Confiável</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> 0.80–0.89 Bom</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> &lt; 0.85 Excluído</span>
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
  const [activeView, setActiveView] = useState<"analise" | "table" | "dados">("analise");
  const [tableSearch, setTableSearch] = useState("");
  const [showOutliers, setShowOutliers] = useState(false);
  // Universo de análise: IPCA SPREAD (Z-spread sobre NTN-B), DI SPREAD (spread sobre CDI em bps) ou DI PERCENTUAL (% do CDI)
  const [universo, setUniverso] = useState<"IPCA" | "DI" | "DI_PCT">("IPCA");
  // Métrica do gráfico Por Rating: média ou mediana
  const [metrica, setMetrica] = useState<"media" | "mediana">("media");

  // Estado dos dois arquivos de upload
  const [moodysFile, setMoodysFile] = useState<File | null>(null);
  const [anbimaFile, setAnbimaFile] = useState<File | null>(null);
  const moodysInputRef = useRef<HTMLInputElement>(null);
  const anbimaInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const filterOptions = trpc.spread.getFilterOptions.useQuery();
  const syncState = trpc.spread.getSyncState.useQuery(undefined, { refetchInterval: 3000 });
  const lastSync = trpc.spread.getLastSync.useQuery();

  const windowSummary = trpc.spread.getWindowSummary.useQuery();
  const historicalSnapshots = trpc.spread.getHistoricalSnapshots.useQuery({ limit: 90 });

  const analysisQuery = trpc.spread.getAnalysis.useQuery({
    durationMin: filters.durationRange[0],
    durationMax: filters.durationRange[1],
    indexadores: filters.indexadores.length ? filters.indexadores : undefined,
    ratings: filters.ratings.length ? filters.ratings : undefined,
    setores: filters.setores.length ? filters.setores : undefined,
    excludeOutliers: !showOutliers,
    scoreMin: 0.80,
  });

  // Query separada apenas para contar outliers — sempre sem filtro de exclusão,
  // para que o botão de toggle apareça mesmo quando outliers estão ocultos.
  const outlierCountQuery = trpc.spread.getAnalysis.useQuery({
    durationMin: filters.durationRange[0],
    durationMax: filters.durationRange[1],
    indexadores: filters.indexadores.length ? filters.indexadores : undefined,
    ratings: filters.ratings.length ? filters.ratings : undefined,
    setores: filters.setores.length ? filters.setores : undefined,
    excludeOutliers: false,
    scoreMin: 0.80,
  });

  // Mapear universo para indexadores correspondentes
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

  // 1. Filtrar por score mínimo 0.80 (nunca exibir matches de baixa confiança)
  const highScoreData = useMemo(() => {
    return allData.filter((r) => {
      const score = (r as { scoreMatch?: number | null }).scoreMatch;
      // Se scoreMatch é null (dados antigos), manter; se preenchido, exigir ≥ 0.80
      return score == null || score >= 0.80;
    });
  }, [allData]);

  // 2. Filtrar por universo (IPCA SPREAD vs DI SPREAD vs DI PERCENTUAL)
  const universoData = useMemo(() => {
    if (universo === "IPCA") {
      return highScoreData.filter((r) => {
        const idx = (r as { indexador?: string | null }).indexador;
        return idx === "IPCA SPREAD";
      });
    }
    if (universo === "DI") {
      // DI+: spread sobre CDI em bps (ex: CDI + 1,5% a.a.)
      return highScoreData.filter((r) => {
        const idx = (r as { indexador?: string | null }).indexador;
        return idx === "DI SPREAD";
      });
    }
    // % DI: percentual do CDI (ex: 110% do CDI) — métrica diferente, eixo diferente
    return highScoreData.filter((r) => {
      const idx = (r as { indexador?: string | null }).indexador;
      return idx === "DI PERCENTUAL";
    });
  }, [highScoreData, universo]);

  // 3. Outliers já filtrados no backend via excludeOutliers.
  // isOutlier pode chegar como boolean ou 0/1 do banco — normalizar para boolean.
  const isOutlierTrue = (r: unknown) => {
    const val = (r as { isOutlier?: boolean | number | null }).isOutlier;
    return val === true || val === 1;
  };
  const analysisData = universoData;
  // Contagem de outliers filtrada pelo universo atual — garante que o número bate com os gráficos.
  const outlierCount = useMemo(() => {
    const raw = outlierCountQuery.data || [];
    // Aplicar o mesmo filtro de universo que é aplicado em universoData
    const inUniverse = raw.filter((r) => {
      const idx = (r as { indexador?: string | null }).indexador;
      if (universo === "IPCA") return idx === "IPCA SPREAD";
      if (universo === "DI") return idx === "DI SPREAD";
      return idx === "DI PERCENTUAL";
    });
    return inUniverse.filter(isOutlierTrue).length;
  }, [outlierCountQuery.data, universo]);

  // Rótulo do eixo Y conforme universo
  const yAxisLabel = "Spread (bps)";

  // byRating: agregado em memória a partir de analysisData (fonte única de verdade)
  // Isso garante que o gráfico de barras responde a TODOS os filtros (outliers, duration, setor, rating)
  const byRatingData = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const r of analysisData) {
      if (r.zspread == null || !r.rating) continue;
      const zs = Number(r.zspread);
      if (!isFinite(zs)) continue;
      if (!groups.has(r.rating)) groups.set(r.rating, []);
      groups.get(r.rating)!.push(zs);
    }
    const result: {
      rating: string;
      avgZspread: number;
      medianZspread: number;
      count: number;
      minZspread: number;
      maxZspread: number;
    }[] = [];
    for (const [rating, vals] of Array.from(groups.entries())) {
      const sorted = [...vals].sort((a, b) => a - b);
      const n = sorted.length;
      const avg = sorted.reduce((s, v) => s + v, 0) / n;
      const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
      result.push({
        rating,
        avgZspread: avg,
        medianZspread: median,
        count: n,
        minZspread: sorted[0],
        maxZspread: sorted[n - 1],
      });
    }
    return result;
  }, [analysisData]);

  // Filtrar tabela por busca
  const filteredTableData = useMemo(() => {
    if (!tableSearch) return analysisData;
    const q = tableSearch.toLowerCase();
    return analysisData.filter(
      (r) =>
        r.emissorNome?.toLowerCase().includes(q) ||
        r.codigoCetip?.toLowerCase().includes(q) ||
        r.isin?.toLowerCase().includes(q) ||
        r.rating?.toLowerCase().includes(q) ||
        r.instrumentoMoodys?.toLowerCase().includes(q) ||
        r.emissorMoodys?.toLowerCase().includes(q)
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
    filters.ratings.length > 0 ||
    filters.setores.length > 0 ||
    filters.durationRange[0] > 0 ||
    filters.durationRange[1] < 20;

  const sortedRatingOptions = useMemo(() => {
    return sortRatings(filterOptions.data?.ratings || []);
  }, [filterOptions.data?.ratings]);

  return (
    <>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* ── Sidebar de filtros ─────────────────────────────────────────────── */}
        <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
          {/* Logo / Header */}
          <div className="px-4 py-4 border-b border-sidebar-border">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663462519828/ibSgD3x7K24f8UHUmWHZV3/apex-logo-white_aff8676f.webp"
              alt="Apex"
              className="h-8 w-auto object-contain"
            />
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
                {universo === "IPCA" ? "Spread sobre NTN-B de mesma Duration" : universo === "DI" ? "Spread sobre o CDI (DI+)" : "Percentual do CDI (% DI)"}
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
                  { key: "IPCA", label: "IPCA+" },
                  { key: "DI", label: "DI+" },
                  { key: "DI_PCT", label: "% DI" },
                ] as const)
                  .filter(({ key }) => {
                    // Ocultar % DI se não há ativos DI PERCENTUAL no banco
                    if (key === "DI_PCT") {
                      const available = filterOptions.data?.indexadores || [];
                      return available.some((idx) => idx.toUpperCase().includes("DI PERCENTUAL"));
                    }
                    return true;
                  })
                  .map(({ key, label }) => (
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
              {/* Toggle Média/Mediana — visível na aba Análise */}
              {activeView === "analise" && (
                <div className="flex items-center gap-1 bg-secondary rounded-md p-0.5">
                  {(["media", "mediana"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMetrica(m)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        metrica === m
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "media" ? "Média" : "Mediana"}
                    </button>
                  ))}
                </div>
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
                    { key: "analise", icon: TrendingUp, label: "Análise" },
                    { key: "table", icon: Table2, label: "Tabela" },
                    { key: "dados", icon: Database, label: "Dados" },
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
            ) : activeView === "analise" ? (
              <AnaliseView
                scatterData={scatterData}
                ratingGroups={ratingGroups}
                byRatingData={byRatingData}
                yAxisLabel={yAxisLabel}
                metrica={metrica}
                analysisData={analysisData}
              />
            ) : activeView === "dados" ? (
              <DadosView
                windowSummary={windowSummary.data || null}
                snapshots={historicalSnapshots.data || []}
                isSyncing={isSyncing}
                syncProgress={syncState.data?.progress?.step || null}
                moodysFile={moodysFile}
                anbimaFile={anbimaFile}
                onMoodysSelect={() => moodysInputRef.current?.click()}
                onAnbimaSelect={() => anbimaInputRef.current?.click()}
                onSync={handleSync}
                lastSync={lastSync.data || null}
              />
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

// ─── Análise View (Dispersão + Por Rating + Calculadora) ────────────────────────

const SHRINKAGE_K = 5;

function calcPricing(
  targetRating: string,
  targetDuration: number,
  data: { rating: string | null | undefined; durationAnos: number | null; zspread: number | null }[]
): {
  pointEst: number;
  lo: number;
  hi: number;
  n: number;
  comparaveis: { emissorNome: string | null | undefined; codigoCetip: string; durationAnos: number | null; zspread: number | null }[];
  approach: string;
  inversao: boolean;
  nextRatingKey: string | null;
} | null {
  const ratingOrder = {
    "AAA.br": 1, "AA+.br": 2, "AA.br": 3, "AA-.br": 4, "A+.br": 5, "A.br": 6, "A-.br": 7,
    "BBB+.br": 8, "BBB.br": 9, "BBB-.br": 10, "BB+.br": 11, "BB.br": 12, "BB-.br": 13,
    "B+.br": 14, "B.br": 15, "B-.br": 16, "CCC.br": 17, "CC.br": 18, "C.br": 19, "D.br": 20,
  } as Record<string, number>;
  const ratingIdx = ratingOrder[targetRating];
  if (ratingIdx === undefined) return null;

  const validData = data.filter(
    (d) => d.rating && d.durationAnos != null && d.zspread != null
  ) as { rating: string; durationAnos: number; zspread: number; emissorNome?: string | null; codigoCetip: string }[];

  if (validData.length === 0) return null;

  // Comparáveis diretos: mesmo rating, duration ±2 anos
  const directRating = validData.filter(
    (d) => d.rating === targetRating && Math.abs(d.durationAnos - targetDuration) <= 2
  );

  // Comparáveis adjacentes: rating ±1 nível, duration ±2 anos
  const adjacentRating = validData.filter(
    (d) =>
      d.rating !== targetRating &&
      Math.abs((ratingOrder[d.rating] ?? 99) - ratingIdx) <= 1 &&
      Math.abs(d.durationAnos - targetDuration) <= 2
  );

  // Linha estrutural global: regressão OLS spread ~ duration
  const allSpreads = validData.map((d) => d.zspread * 100);
  const allDurs = validData.map((d) => d.durationAnos);
  const globalMean = allSpreads.reduce((a, b) => a + b, 0) / allSpreads.length;
  const meanDur = allDurs.reduce((a, b) => a + b, 0) / allDurs.length;
  const num = validData.reduce((a, d) => a + (d.durationAnos - meanDur) * (d.zspread * 100 - globalMean), 0);
  const den = validData.reduce((a, d) => a + (d.durationAnos - meanDur) ** 2, 0);
  const globalSlope = den ? num / den : 0;
  const globalEst = globalMean - globalSlope * meanDur + globalSlope * targetDuration;

  // Bucket efetivo: diretos + adjacentes com peso 0.7
  const adjVals = adjacentRating.map((d) => d.zspread * 100 * 0.7);
  const directVals = directRating.map((d) => d.zspread * 100);
  const effectiveVals =
    directVals.length >= 3 ? directVals : [...directVals, ...adjVals];

  const n = directVals.length;
  const w = n / (n + SHRINKAGE_K);
  const bucketMean = effectiveVals.length
    ? effectiveVals.reduce((a, b) => a + b, 0) / effectiveVals.length
    : globalEst;
  const pointEst = w * bucketMean + (1 - w) * globalEst;

  // Intervalo de confiança t-student
  const tCrit = n >= 10 ? 1.96 : n >= 5 ? 2.13 : n >= 3 ? 2.92 : 3.18;
  const std =
    effectiveVals.length > 1
      ? Math.sqrt(
          effectiveVals.reduce((a, b) => a + (b - bucketMean) ** 2, 0) /
            (effectiveVals.length - 1)
        )
      : 40;
  const se = std / Math.sqrt(Math.max(1, effectiveVals.length));
  const lo = Math.max(0, pointEst - tCrit * se);
  const hi = pointEst + tCrit * se;

  // Detectar inversão
  const ratingKeys = Object.keys(ratingOrder).sort(
    (a, b) => ratingOrder[a] - ratingOrder[b]
  );
  const nextKey = ratingKeys.find((r) => ratingOrder[r] === ratingIdx + 1) || null;
  const nextMedian = nextKey
    ? (() => {
        const vals = validData
          .filter((d) => d.rating === nextKey)
          .map((d) => d.zspread * 100)
          .sort((a, b) => a - b);
        if (!vals.length) return null;
        const m = Math.floor(vals.length / 2);
        return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
      })()
    : null;
  const inversao = nextMedian !== null && pointEst < nextMedian * 0.95;

  const approach =
    n >= 3
      ? "bucket direto"
      : n >= 1
      ? "bucket + adjacentes (shrinkage)"
      : "linha global (sem comparáveis diretos)";

  return {
    pointEst,
    lo,
    hi,
    n,
    comparaveis: directRating.map((d) => ({
      emissorNome: (d as unknown as { emissorNome?: string | null }).emissorNome,
      codigoCetip: d.codigoCetip,
      durationAnos: d.durationAnos,
      zspread: d.zspread,
    })),
    approach,
    inversao,
    nextRatingKey: nextKey,
  };
}

function AnaliseView({
  scatterData,
  ratingGroups,
  byRatingData,
  yAxisLabel,
  metrica,
  analysisData,
}: {
  scatterData: ScatterPoint[];
  ratingGroups: string[];
  byRatingData: {
    rating: string;
    avgZspread: number;
    medianZspread: number;
    count: number;
    minZspread: number;
    maxZspread: number;
  }[];
  yAxisLabel: string;
  metrica: "media" | "mediana";
  analysisData: AnalysisRow[];
}) {
  const [pricingRating, setPricingRating] = useState("AA-.br");
  const [pricingDur, setPricingDur] = useState(4);
  const [pricingResult, setPricingResult] = useState<ReturnType<typeof calcPricing>>(null);

  const ratingsDisponiveis = useMemo(() => {
    const set = new Set(analysisData.map((d) => d.rating).filter(Boolean) as string[]);
    return sortRatings(Array.from(set));
  }, [analysisData]);

  const handleCalc = () => {
    const result = calcPricing(pricingRating, pricingDur, analysisData as unknown as { rating: string | null | undefined; durationAnos: number | null; zspread: number | null }[]);
    setPricingResult(result);
  };

  // Recalcular automaticamente quando os dados mudam
  useEffect(() => {
    if (analysisData.length > 0) {
      const result = calcPricing(pricingRating, pricingDur, analysisData as unknown as { rating: string | null | undefined; durationAnos: number | null; zspread: number | null }[]);
      setPricingResult(result);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingRating, pricingDur, analysisData]);

  return (
    <div className="h-full overflow-hidden flex flex-col gap-3">
      {/* ── Linha superior: Scatter + Barras lado a lado ── */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3">
        {/* Scatter */}
        <div className="flex flex-col gap-2 min-h-0 bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
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
          <div className="flex-1 min-h-0">
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
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload as ScatterPoint;
                    if (!d) return null;
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
                  }}
                />
                <Scatter
                  data={scatterData}
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
        </div>

        {/* Barras por rating */}
        <div className="min-h-0 bg-card border border-border rounded-lg p-3">
          <BarView data={byRatingData} yAxisLabel={yAxisLabel} metrica={metrica} />
        </div>
      </div>

      {/* ── Linha inferior: Calculadora full-width ── */}
      <div className="flex-shrink-0 bg-card border border-border rounded-lg p-4">
        <div className="flex gap-6 items-start">
          {/* Controles: rating + duration + botao */}
          <div className="flex-shrink-0 w-64">
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground">Spread Esperado</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Estimativa com IC 95% · shrinkage hierárquico</p>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Rating</label>
                <select
                  value={pricingRating}
                  onChange={(e) => setPricingRating(e.target.value)}
                  className="w-full h-8 px-2 text-xs bg-input border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {ratingsDisponiveis.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                  Duration — {pricingDur.toFixed(1)} anos
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={15}
                  step={0.5}
                  value={pricingDur}
                  onChange={(e) => setPricingDur(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>0.5a</span>
                  <span>15a</span>
                </div>
              </div>
              <button
                onClick={handleCalc}
                className="w-full h-8 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Calcular
              </button>
            </div>
          </div>

          {/* Resultado */}
          <div className="flex-1 min-w-0">
            {pricingResult ? (
              <div className="space-y-3">
                {pricingResult.inversao && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>
                      Inversão: spread estimado ({Math.round(pricingResult.pointEst)} bps) inferior ao rating{" "}
                      {pricingResult.nextRatingKey} abaixo.
                    </span>
                  </div>
                )}
                <div className="flex items-end gap-6">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Ponto médio</p>
                    <p className="text-2xl font-bold font-mono text-primary">
                      {Math.round(pricingResult.pointEst)}
                      <span className="text-sm font-normal text-muted-foreground ml-1">bps</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">IC 95%</p>
                    <p className="text-sm font-mono text-foreground">
                      [{Math.round(pricingResult.lo)} — {Math.round(pricingResult.hi)}]
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Comparáveis</p>
                    <p className="text-sm font-bold text-foreground">{pricingResult.n}</p>
                  </div>
                </div>
                {(() => {
                  const range = Math.max(500, pricingResult.hi * 1.1);
                  const pct = (v: number) => Math.min(100, Math.max(0, (v / range) * 100));
                  return (
                    <div className="relative h-6 bg-muted rounded overflow-hidden">
                      <div className="absolute h-full bg-primary/20" style={{ left: `${pct(pricingResult.lo)}%`, width: `${pct(pricingResult.hi) - pct(pricingResult.lo)}%` }} />
                      <div className="absolute top-1 bottom-1 w-0.5 bg-primary rounded" style={{ left: `${pct(pricingResult.pointEst)}%`, transform: "translateX(-50%)" }} />
                      <span className="absolute text-[9px] text-primary font-bold" style={{ left: `${pct(pricingResult.lo)}%`, top: "50%", transform: "translateY(-50%) translateX(-50%)" }}>{Math.round(pricingResult.lo)}</span>
                      <span className="absolute text-[9px] text-primary font-bold" style={{ left: `${pct(pricingResult.hi)}%`, top: "50%", transform: "translateY(-50%) translateX(-50%)" }}>{Math.round(pricingResult.hi)}</span>
                    </div>
                  );
                })()}
                {pricingResult.comparaveis.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Papéis comparáveis</p>
                    <div className="flex flex-wrap gap-1.5">
                      {pricingResult.comparaveis.slice(0, 8).map((c, i) => (
                        <div key={i} className="px-2 py-1 rounded bg-muted border border-border text-[10px] text-foreground">
                          <span className="font-medium">{c.emissorNome || c.codigoCetip}</span>
                          {" · "}{c.durationAnos?.toFixed(1)}a{" · "}
                          <span className="text-primary font-semibold">{c.zspread != null ? Math.round(c.zspread * 100) : "—"} bps</span>
                        </div>
                      ))}
                      {pricingResult.comparaveis.length > 8 && (
                        <span className="text-[10px] text-muted-foreground self-center">+{pricingResult.comparaveis.length - 8} mais</span>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
                  Abordagem: <em>{pricingResult.approach}</em>. Peso do bucket = n/(n+5). IC usa distribuição t com (n−1) g.l.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground">
                Selecione rating e duration para calcular o spread esperado.
              </div>
            )}
          </div>
        </div>
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
  yAxisLabel = "Spread (bps)",
  metrica = "media",
}: {
  data: { rating: string; avgZspread: number; medianZspread?: number; count: number; minZspread: number; maxZspread: number }[];
  yAxisLabel?: string;
  metrica?: "media" | "mediana";
}) {
  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const order = sortRatings([a.rating, b.rating]);
      return order.indexOf(a.rating) - order.indexOf(b.rating);
    });
  }, [data]);
  // Regressão linear simples sobre índice ordinal dos ratings
  const regression = useMemo(() => {
    if (sorted.length < 2) return { trendData: [], slope: 0, intercept: 0 };
    const xs = sorted.map((_, i) => i);
    const ys = sorted.map((d) => {
      const val = metrica === "mediana" ? (d.medianZspread ?? d.avgZspread) : d.avgZspread;
      return Math.round(val * 100);
    });
    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const trendData = sorted.map((d, i) => {
      const val = metrica === "mediana" ? (d.medianZspread ?? d.avgZspread) : d.avgZspread;
      return {
        rating: d.rating,
        spreadBps: Math.round(val * 100),
        trend: Math.round(slope * i + intercept),
      };
    });
    return { trendData, slope, intercept };
  }, [sorted, metrica]);

  const { trendData, slope } = regression;

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
          {metrica === "mediana" ? "Mediana" : "Média"}:{" "}
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
    <div className="flex flex-col h-full">
      {/* Gráfico */}
      <div className="flex-1" style={{ minHeight: "200px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={trendData}
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
            <Bar dataKey="spreadBps" radius={[3, 3, 0, 0]}>
              {trendData.map((entry) => (
                <Cell key={entry.rating} fill={getRatingColor(entry.rating)} fillOpacity={0.85} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="trend"
              stroke="oklch(0.75 0.15 60)"
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 3"
              name="Tendência"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

type AnalysisRow = {
  id: number;
  codigoCetip: string;
  isin: string | null;
  emissorNome: string | null;
  setor: string | null;
  indexador: string | null;
  rating: string | null;
  tipoMatch: "emissao" | "emissor" | "sem_match" | null;
  taxaIndicativa: number | null;
  durationAnos: number | null;
  dataReferencia: string | null;
  ntnbReferencia: string | null;
  ntnbTaxa: number | null;
  zspread: number | null;
  // Campos de matching (qualidade)
  emissorMoodys: string | null;
  numeroEmissaoSnd: number | null;
  numeroEmissaoMoodys: string | null;
  instrumentoMoodys: string | null;
  scoreMatch: number | null;
  isOutlier: boolean | null;
  incentivado: boolean | null;
  spreadIncentivadoSemGrossUp: number | null;
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
  const hasMatchData = data.some((r) => r.scoreMatch != null || r.emissorMoodys != null);

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Buscar por emissor, código, ISIN, instrumento Moody's ou rating..."
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
          <thead className="sticky top-0 z-10">
            {/* Linha de agrupamento */}
            <tr className="bg-muted/30 border-b border-border/60">
              <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground/70 whitespace-nowrap" colSpan={1}>
                IDENTIFICAÇÃO
              </th>
              <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-blue-400/70 whitespace-nowrap border-l border-blue-500/20" colSpan={3}>
                ← ANBIMA DATA
              </th>
              {hasMatchData && (
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-emerald-400/70 whitespace-nowrap border-l border-emerald-500/20" colSpan={3}>
                  MOODY'S LOCAL →
                </th>
              )}
              <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-muted-foreground/70 whitespace-nowrap border-l border-border/60" colSpan={hasMatchData ? 5 : 4}>
                SPREAD
              </th>
            </tr>
            {/* Linha de nomes das colunas */}
            <tr className="bg-card border-b border-border">
              {/* Identificação */}
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">Código</th>
              {/* ANBIMA */}
              <th className="px-3 py-2 text-left font-semibold text-blue-400 whitespace-nowrap border-l border-blue-500/20">Emissor</th>
              <th className="px-3 py-2 text-left font-semibold text-blue-400 whitespace-nowrap">Indexador</th>
              <th className="px-3 py-2 text-center font-semibold text-blue-400 whitespace-nowrap">Nº Emissão</th>
              {/* Moody's */}
              {hasMatchData && (
                <>
                  <th className="px-3 py-2 text-left font-semibold text-emerald-400 whitespace-nowrap border-l border-emerald-500/20">Instrumento Moody's</th>
                  <th className="px-3 py-2 text-left font-semibold text-emerald-400 whitespace-nowrap">Rating</th>
                  <th className="px-3 py-2 text-center font-semibold text-emerald-400 whitespace-nowrap">Score</th>
                </>
              )}
              {/* Spread */}
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap border-l border-border/60">Duration</th>
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">Taxa Indicativa</th>
              {!hasMatchData && <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">NTN-B Ref.</th>}
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">Z-spread</th>
              <th
                className="px-3 py-2 text-right font-semibold text-amber-400/80 whitespace-nowrap"
                title="Spread ajustado pelo benefício fiscal da isenção de IR, conforme metodologia ANBIMA. Disponível apenas para debêntures incentivadas (Lei 12.431)."
              >
                Spread Ajustado
              </th>
              {hasMatchData && <th className="px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Status</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const zspreadBps = row.zspread != null ? Math.round(row.zspread * 100) : null;
              const score = row.scoreMatch;
              const scoreColor =
                score == null ? "text-muted-foreground"
                : score >= 0.9 ? "text-emerald-400"
                : score >= 0.80 ? "text-yellow-400"
                : "text-orange-400";
              const scoreBg =
                score == null ? ""
                : score >= 0.9 ? "bg-emerald-500/10"
                : score >= 0.80 ? "bg-yellow-500/10"
                : "bg-orange-500/10";
              return (
                <tr
                  key={row.id}
                  className={`border-b border-border/50 hover:bg-accent/30 transition-colors ${
                    row.isOutlier ? "bg-yellow-500/5" : i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                  }`}
                >
                  {/* Identificação */}
                  <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap font-semibold">
                    <a
                      href={`https://data.anbima.com.br/debentures/${row.codigoCetip}/caracteristicas`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-400 hover:underline transition-colors flex items-center gap-1"
                      title="Ver no ANBIMA Data"
                    >
                      {row.codigoCetip}
                      <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                    </a>
                  </td>
                  {/* ANBIMA */}
                  <td className="px-3 py-2 font-medium text-blue-300 max-w-[160px] truncate border-l border-blue-500/10" title={row.emissorNome || ""}>
                    {row.emissorNome || "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.indexador || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {row.numeroEmissaoSnd != null ? (
                      <span className="font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-[11px]">
                        {row.numeroEmissaoSnd}ª
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-[10px]">—</span>
                    )}
                  </td>
                  {/* Moody's */}
                  {hasMatchData && (
                    <>
                      <td className="px-3 py-2 border-l border-emerald-500/10">
                        {row.instrumentoMoodys ? (
                          <a
                            href={`https://moodyslocal.com.br/?s=${encodeURIComponent((row.emissorMoodys || row.codigoCetip).split(' ').slice(0, 2).join(' '))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-emerald-400 hover:underline transition-colors max-w-[200px] block truncate text-[11px] flex items-center gap-1"
                            title={`${row.instrumentoMoodys} — verificar na Moody's Local`}
                          >
                            <span className="truncate">{row.instrumentoMoodys}</span>
                            <ExternalLink className="h-2.5 w-2.5 opacity-50 flex-shrink-0" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.rating ? (
                          <span className="font-semibold text-[11px]" style={{ color: getRatingColor(row.rating) }}>
                            {row.rating}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={`px-3 py-2 text-center rounded-sm ${scoreBg}`}>
                        <span className={`font-mono text-[11px] font-bold ${scoreColor}`}>
                          {score != null ? score.toFixed(3) : "—"}
                        </span>
                      </td>
                    </>
                  )}
                  {/* Spread */}
                  <td className="px-3 py-2 text-right tabular-nums border-l border-border/60">
                    {formatDuration(row.durationAnos)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {formatRate(row.taxaIndicativa)}
                  </td>
                  {!hasMatchData && (
                    <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">
                      {row.ntnbReferencia || "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {zspreadBps != null ? (
                      <span className={zspreadBps >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {zspreadBps > 0 ? "+" : ""}{zspreadBps} bps
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Spread Ajustado (só para incentivadas) */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.incentivado && row.spreadIncentivadoSemGrossUp != null ? (
                      <span
                        className="text-amber-400 font-semibold"
                        title="Spread s/ gross-up (ANBIMA): spread calculado sobre a taxa líquida equivalente, já ajustado pelo benefício fiscal da isenção de IR"
                      >
                        {(row.spreadIncentivadoSemGrossUp * 100) > 0 ? "+" : ""}{Math.round(row.spreadIncentivadoSemGrossUp * 100)} bps
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40 text-[10px]">—</span>
                    )}
                  </td>
                  {hasMatchData && (
                    <td className="px-3 py-2 text-center">
                      {row.isOutlier ? (
                        <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 rounded">
                          Outlier
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-400/70">✓</span>
                      )}
                    </td>
                  )}
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

// ─── Dados View ───────────────────────────────────────────────────────────────

type SnapshotRow = {
  id: number;
  snapshotAt: Date | string | number;
  dataRefIni: string;
  dataRefFim: string;
  indexador: string;
  rating: string;
  nPapeis: number;
  mediaSpread: number | null;
  medianaSpread: number | null;
  p25Spread: number | null;
  p75Spread: number | null;
  stdSpread: number | null;
};

type WindowSummary = {
  dataMin: string | null;
  dataMax: string | null;
  totalPapeis: number;
  totalDatas: number;
  totalCetips: number;
  totalOutliers: number;
};

type LastSyncRow = {
  finalizadoEm?: Date | string | number | null;
  status?: string | null;
  totalAtivos?: number | null;
  matchedAtivos?: number | null;
  dataReferencia?: string | null;
};

function DadosView({
  windowSummary,
  snapshots,
  isSyncing,
  syncProgress,
  moodysFile,
  anbimaFile,
  onMoodysSelect,
  onAnbimaSelect,
  onSync,
  lastSync,
}: {
  windowSummary: WindowSummary | null;
  snapshots: SnapshotRow[];
  isSyncing: boolean;
  syncProgress: string | null;
  moodysFile: File | null;
  anbimaFile: File | null;
  onMoodysSelect: () => void;
  onAnbimaSelect: () => void;
  onSync: () => void;
  lastSync: LastSyncRow | null;
}) {
  const [dragOver, setDragOver] = useState<"moodys" | "anbima" | null>(null);
  const [selectedIndexador, setSelectedIndexador] = useState<string>("IPCA SPREAD");
  const [selectedMetrica, setSelectedMetrica] = useState<"media" | "mediana">("mediana");

  // Indexadores disponíveis nos snapshots
  const indexadoresDisponiveis = useMemo(() => {
    const set = new Set(snapshots.map((s) => s.indexador));
    return Array.from(set).sort();
  }, [snapshots]);

  // Filtrar snapshots pelo indexador selecionado
  const snapshotsFiltrados = useMemo(() => {
    return snapshots.filter((s) => s.indexador === selectedIndexador);
  }, [snapshots, selectedIndexador]);

  // Agrupar por dataRefFim e rating para o gráfico de linha
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const s of snapshotsFiltrados) {
      if (!byDate.has(s.dataRefFim)) byDate.set(s.dataRefFim, {});
      const val = selectedMetrica === "media" ? s.mediaSpread : s.medianaSpread;
      if (val != null) {
        byDate.get(s.dataRefFim)![s.rating] = Math.round(Number(val) * 100);
      }
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [snapshotsFiltrados, selectedMetrica]);

  // Ratings presentes nos snapshots filtrados
  const ratingsPresentes = useMemo(() => {
    const set = new Set(snapshotsFiltrados.map((s) => s.rating));
    return sortRatings(Array.from(set));
  }, [snapshotsFiltrados]);

  const handleDrop = (tipo: "moodys" | "anbima") => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return;
    }
    // Simular clique no input correto
    if (tipo === "moodys") onMoodysSelect();
    else onAnbimaSelect();
  };

  return (
    <div className="h-full overflow-y-auto space-y-6 pr-1">
      {/* ── Seção 1: Janela Ativa ── */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Janela Ativa
        </h3>
        {windowSummary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Período</p>
              <p className="text-sm font-semibold text-foreground">
                {windowSummary.dataMin
                  ? new Date(windowSummary.dataMin + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                  : "—"}
                {" → "}
                {windowSummary.dataMax
                  ? new Date(windowSummary.dataMax + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                  : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{windowSummary.totalDatas} datas</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Total de Registros</p>
              <p className="text-sm font-semibold text-foreground">{windowSummary.totalPapeis.toLocaleString("pt-BR")}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{windowSummary.totalCetips} CETIPs únicos</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Outliers</p>
              <p className="text-sm font-semibold text-yellow-400">{windowSummary.totalOutliers}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {windowSummary.totalPapeis > 0
                  ? ((windowSummary.totalOutliers / windowSummary.totalPapeis) * 100).toFixed(1)
                  : "0"}% do total
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Último Sync</p>
              <p className="text-sm font-semibold text-foreground">
                {lastSync?.finalizadoEm
                  ? new Date(lastSync.finalizadoEm as number).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                  : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {lastSync?.matchedAtivos != null ? `${lastSync.matchedAtivos} matches` : "—"}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground text-center">
            Nenhum dado na janela ativa. Faça a primeira sincronização abaixo.
          </div>
        )}
      </section>

      {/* ── Seção 2: Upload ── */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          Atualizar Dados
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {/* Drop zone Moody's */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver("moodys"); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop("moodys")}
            onClick={onMoodysSelect}
            className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
              dragOver === "moodys"
                ? "border-primary bg-primary/10"
                : moodysFile
                ? "border-emerald-500/60 bg-emerald-500/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            {moodysFile ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <p className="text-xs font-medium text-emerald-400 text-center truncate max-w-full px-2">{moodysFile.name}</p>
                <p className="text-[10px] text-muted-foreground">{(moodysFile.size / 1024).toFixed(0)} KB</p>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">Planilha Moody's</p>
                <p className="text-[10px] text-muted-foreground text-center">
                  Arraste ou clique para selecionar<br />
                  <a
                    href="https://moodyslocal.com.br"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline"
                  >
                    moodyslocal.com.br
                  </a>
                </p>
              </>
            )}
          </div>

          {/* Drop zone ANBIMA */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver("anbima"); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop("anbima")}
            onClick={onAnbimaSelect}
            className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
              dragOver === "anbima"
                ? "border-primary bg-primary/10"
                : anbimaFile
                ? "border-emerald-500/60 bg-emerald-500/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            {anbimaFile ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <p className="text-xs font-medium text-emerald-400 text-center truncate max-w-full px-2">{anbimaFile.name}</p>
                <p className="text-[10px] text-muted-foreground">{(anbimaFile.size / 1024).toFixed(0)} KB</p>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">Planilha ANBIMA Data</p>
                <p className="text-[10px] text-muted-foreground text-center">
                  Arraste ou clique para selecionar<br />
                  <a
                    href="https://data.anbima.com.br/datasets/data-debentures-precificacao-anbima"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline"
                  >
                    data.anbima.com.br
                  </a>
                </p>
              </>
            )}
          </div>
        </div>

        {/* Botão de sync + progresso */}
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Sincronizando..." : "Atualizar dados"}
        </button>
        {isSyncing && syncProgress && (
          <div className="mt-2 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
            <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
            <span>{syncProgress}</span>
          </div>
        )}
      </section>

      {/* ── Seção 3: Histórico ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            Histórico de Spreads
          </h3>
          <div className="flex items-center gap-2">
            {/* Seletor de indexador */}
            {indexadoresDisponiveis.length > 1 && (
              <div className="flex items-center gap-1 bg-secondary rounded-md p-0.5">
                {indexadoresDisponiveis.map((idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedIndexador(idx)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      selectedIndexador === idx
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {idx === "IPCA SPREAD" ? "IPCA+" : idx === "DI SPREAD" ? "DI+" : "% DI"}
                  </button>
                ))}
              </div>
            )}
            {/* Seletor de métrica */}
            <div className="flex items-center gap-1 bg-secondary rounded-md p-0.5">
              {(["mediana", "media"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSelectedMetrica(m)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    selectedMetrica === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "media" ? "Média" : "Mediana"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <TrendingDown className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhum histórico disponível ainda.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              O histórico será construído automaticamente a cada sincronização.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-4">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: string) =>
                    new Date(v + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                  }
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `${v}bps`}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "11px",
                  }}
                  labelFormatter={(v: string) =>
                    new Date(v + "T12:00:00").toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })
                  }
                  formatter={(value: number, name: string) => [`${value} bps`, name]}
                />
                <Legend
                  wrapperStyle={{ fontSize: "10px", paddingTop: "8px" }}
                />
                {ratingsPresentes.map((rating) => (
                  <Line
                    key={rating}
                    type="monotone"
                    dataKey={rating}
                    stroke={RATING_COLORS[rating] || "#94a3b8"}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
