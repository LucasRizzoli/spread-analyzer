import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Activity,
  BarChart3,
  Table2,
  Calculator,
} from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  Line,
  LabelList,
  ReferenceLine,
} from "recharts";
import { sortRatings } from "../lib/ratings";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RATING_COLORS: Record<string, string> = {
  "AAA.br":  "#16a34a",
  "AA+.br":  "#22c55e",
  "AA.br":   "#86efac",
  "AA-.br":  "#bef264",
  "A+.br":   "#facc15",
  "A.br":    "#fb923c",
  "A-.br":   "#f97316",
  "BBB+.br": "#ef4444",
  "BBB.br":  "#dc2626",
  "BBB-.br": "#b91c1c",
  "BB+.br":  "#991b1b",
  "BB.br":   "#7f1d1d",
  "BB-.br":  "#6b0f0f",
};

function getRatingColor(rating: string | null | undefined): string {
  if (!rating) return "#6b7280";
  return RATING_COLORS[rating] || "#6b7280";
}

function formatRate(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function formatDuration(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}a`;
}

// ─── FilterSection ────────────────────────────────────────────────────────────

function FilterSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
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

function CheckItem({ id, label, checked, onToggle, color }: { id: string; label: string; checked: boolean; onToggle: () => void; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} className="h-3.5 w-3.5" />
      <Label htmlFor={id} className="text-xs cursor-pointer flex items-center gap-1.5">
        {color && <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
        {label}
      </Label>
    </div>
  );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface CriCraRow {
  id: number;
  codigoCetip: string;
  tipo: string | null;
  devedor?: string | null;
  emissorSecuritizadora?: string | null;
  rating: string | null;
  indexador: string | null;
  durationAnos: number | null;
  taxaIndicativa: number | null;
  zspread: number | null;
  isOutlier: boolean | null;
  dataReferencia: string | null;
  setor: string | null;
}

interface FiltersState {
  durationRange: [number, number];
  indexadores: string[];
  ratings: string[];
  tipos: string[];
}

const DEFAULT_FILTERS: FiltersState = {
  durationRange: [0, 20],
  indexadores: [],
  ratings: [],
  tipos: [],
};

// ─── Scatter View ─────────────────────────────────────────────────────────────

function ScatterView({ data }: { data: CriCraRow[] }) {
  const points = useMemo(() =>
    data
      .filter((r) => r.durationAnos != null && r.zspread != null)
      .map((r) => ({
        x: Number(r.durationAnos!.toFixed(2)),
        y: Math.round(Number(r.zspread) * 10000) / 100,
        rating: r.rating || "—",
        cetip: r.codigoCetip,
        devedor: r.devedor || r.emissorSecuritizadora || "—",
        tipo: r.tipo || "—",
        indexador: r.indexador || "—",
        taxa: r.taxaIndicativa,
        color: getRatingColor(r.rating),
      })),
    [data]
  );

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: typeof points[0] }[] }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs max-w-xs">
        <p className="font-semibold text-foreground mb-1">{d.cetip}</p>
        <p className="text-muted-foreground mb-1 truncate">{d.devedor}</p>
        <p className="text-muted-foreground mb-1">{d.tipo} · {d.indexador}</p>
        <div className="flex gap-3 mt-1">
          <span className="text-muted-foreground">Duration: <span className="text-foreground font-medium">{d.x.toFixed(2)}a</span></span>
          <span className="text-muted-foreground">Z-spread: <span className="text-primary font-semibold">{d.y.toFixed(0)}bps</span></span>
        </div>
        {d.taxa != null && <p className="text-muted-foreground mt-1">Taxa: <span className="text-foreground">{(d.taxa * 100).toFixed(2)}%</span></p>}
        {d.rating && <p className="text-muted-foreground mt-1">Rating: <span className="font-medium" style={{ color: d.color }}>{d.rating}</span></p>}
      </div>
    );
  };

  if (!points.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Activity className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
        <p className="text-xs text-muted-foreground mt-1">Envie a planilha CRI/CRA na aba Dados para começar.</p>
      </div>
    );
  }

  const ys = points.map((p) => p.y);
  const yMin = Math.floor(Math.min(...ys) / 50) * 50 - 50;
  const yMax = Math.ceil(Math.max(...ys) / 50) * 50 + 50;

  return (
    <div className="h-full flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Z-spread × Duration — CRI/CRA</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{points.length} papéis · cores por rating do devedor</p>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
            <XAxis
              type="number"
              dataKey="x"
              name="Duration"
              domain={[0, "auto"]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v: number) => `${v}a`}
              label={{ value: "Duration (anos)", position: "insideBottom", offset: -5, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Z-spread"
              domain={[yMin, yMax]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v: number) => `${v}bps`}
              width={55}
            />
            <Tooltip content={<CustomTooltip />} />
            <Scatter
              data={points}
              fill="#6b7280"
              shape={(props: { cx?: number; cy?: number; payload?: typeof points[0] }) => {
                const { cx = 0, cy = 0, payload } = props;
                return <circle cx={cx} cy={cy} r={4} fill={payload?.color || "#6b7280"} fillOpacity={0.8} stroke="none" />;
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Bar View ─────────────────────────────────────────────────────────────────

function BarView({ data }: { data: CriCraRow[] }) {
  const byRating = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of data) {
      if (!r.rating || r.zspread == null || r.isOutlier) continue;
      const bps = Number(r.zspread) * 10000;
      if (!map.has(r.rating)) map.set(r.rating, []);
      map.get(r.rating)!.push(bps);
    }
    const result: { rating: string; media: number; n: number; trend?: number }[] = [];
    Array.from(map.entries()).forEach(([rating, vals]) => {
      const media = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
      result.push({ rating, media: Math.round(media), n: vals.length });
    });
    const sorted = sortRatings(result.map((r) => r.rating));
    const final = sorted.map((r) => result.find((x: { rating: string; media: number; n: number }) => x.rating === r)!).filter(Boolean);
    // Calcular linha de tendência linear
    if (final.length >= 2) {
      const n = final.length;
      const xs = final.map((_, i) => i);
      const ys = final.map((r) => r.media);
      const sumX = xs.reduce((a, b) => a + b, 0);
      const sumY = ys.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
      const sumX2 = xs.reduce((a, x) => a + x * x, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      final.forEach((r, i) => { r.trend = Math.round(intercept + slope * i); });
    }
    return final;
  }, [data]);

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; payload: typeof byRating[0] }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const trendPayload = payload.find((p) => p.name === "Tendência");
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
        <p className="font-semibold mb-2" style={{ color: getRatingColor(label) }}>{label}</p>
        <p className="text-muted-foreground">Média: <span className="text-foreground font-semibold">{d.media} bps</span></p>
        <p className="text-muted-foreground">Papéis: <span className="text-foreground">{d.n}</span></p>
        {trendPayload && <p className="text-yellow-400 mt-1">Tendência: {trendPayload.value} bps</p>}
      </div>
    );
  };

  if (!byRating.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
        <p className="text-xs text-muted-foreground mt-1">Envie a planilha CRI/CRA na aba Dados para começar.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Spread Médio por Rating — CRI/CRA</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Média do z-spread (bps) por rating do devedor · outliers excluídos</p>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={byRating} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
            <XAxis dataKey="rating" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `${v}bps`} width={55} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="media" name="Média" radius={[4, 4, 0, 0]}>
              {byRating.map((entry) => (
                <Cell key={entry.rating} fill={getRatingColor(entry.rating)} fillOpacity={0.85} />
              ))}
              <LabelList dataKey="media" position="top" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} formatter={(v: number) => `${v}`} />
            </Bar>
            <Line
              type="monotone"
              dataKey="trend"
              name="Tendência"
              stroke="#eab308"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ fill: "#eab308", r: 3 }}
            >
              <LabelList dataKey="trend" position="top" style={{ fontSize: 9, fill: "#eab308", fontWeight: 600 }} formatter={(v: number) => `${v}`} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({ data }: { data: CriCraRow[] }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"zspread" | "durationAnos" | "taxaIndicativa">("zspread");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    let rows = [...data];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.codigoCetip?.toLowerCase().includes(q) ||
          r.devedor?.toLowerCase().includes(q) ||
          r.emissorSecuritizadora?.toLowerCase().includes(q) ||
          r.rating?.toLowerCase().includes(q) ||
          r.tipo?.toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      const av = a[sortField] ?? -Infinity;
      const bv = b[sortField] ?? -Infinity;
      return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return rows;
  }, [data, search, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  if (!data.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Table2 className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
        <p className="text-xs text-muted-foreground mt-1">Envie a planilha CRI/CRA na aba Dados para começar.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-shrink-0">
        <input
          type="text"
          placeholder="Buscar por CETIP, devedor, rating..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-8 px-3 rounded-md bg-muted/50 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground shrink-0">{filtered.length} papéis</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">CETIP</th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Tipo</th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Devedor</th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Rating</th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Indexador</th>
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("durationAnos")}>
                Duration {sortField === "durationAnos" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="px-3 py-2 text-right font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("taxaIndicativa")}>
                Taxa {sortField === "taxaIndicativa" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="px-3 py-2 text-right font-semibold text-primary cursor-pointer hover:text-primary/80" onClick={() => toggleSort("zspread")}>
                Z-spread {sortField === "zspread" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="px-3 py-2 text-center font-semibold text-muted-foreground">Outlier</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${r.isOutlier ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-mono text-foreground">{r.codigoCetip}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{r.tipo || "—"}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={r.devedor || ""}>{r.devedor || "—"}</td>
                <td className="px-3 py-2">
                  {r.rating ? (
                    <span className="font-semibold text-xs" style={{ color: getRatingColor(r.rating) }}>{r.rating}</span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.indexador || "—"}</td>
                <td className="px-3 py-2 text-right text-foreground">{formatDuration(r.durationAnos)}</td>
                <td className="px-3 py-2 text-right text-foreground">{formatRate(r.taxaIndicativa)}</td>
                <td className="px-3 py-2 text-right font-semibold text-primary">
                  {r.zspread != null ? `${Math.round(Number(r.zspread) * 10000)}bps` : "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.isOutlier ? <span className="text-yellow-400 text-[10px]">⚠</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Calculadora ──────────────────────────────────────────────────────────────

function CalculadoraView({ data }: { data: CriCraRow[] }) {
  const [calcRating, setCalcRating] = useState("AA-.br");
  const [calcDuration, setCalcDuration] = useState(3.0);
  const [calcIndexador, setCalcIndexador] = useState("IPCA SPREAD");
  const [resultado, setResultado] = useState<{ spreadEsperado: number; ntnb: number; taxaTotal: number } | null>(null);

  const ntnbQuery = trpc.spread.getNtnbCurve.useQuery();

  const ratingsDisponiveis = useMemo(() => {
    const set = new Set(data.filter((r) => r.rating && !r.isOutlier).map((r) => r.rating!));
    return sortRatings(Array.from(set));
  }, [data]);

  useEffect(() => {
    if (!ntnbQuery.data || !data.length) return;
    // Calcular spread médio para o rating e indexador selecionados
    const papeis = data.filter(
      (r) => r.rating === calcRating && r.indexador === calcIndexador && !r.isOutlier && r.zspread != null
    );
    if (!papeis.length) { setResultado(null); return; }
    const mediaSpread = papeis.reduce((a, r) => a + Number(r.zspread), 0) / papeis.length;
    // Interpolar NTN-B para a duration
    const curva = [...ntnbQuery.data].sort((a, b) => a.durationAnos - b.durationAnos);
    let ntnb = 0;
    if (curva.length === 0) { setResultado(null); return; }
    if (calcDuration <= curva[0].durationAnos) {
      ntnb = curva[0].taxaNtnb;
    } else if (calcDuration >= curva[curva.length - 1].durationAnos) {
      ntnb = curva[curva.length - 1].taxaNtnb;
    } else {
      const lower = curva.filter((p) => p.durationAnos <= calcDuration).pop()!;
      const upper = curva.find((p) => p.durationAnos > calcDuration)!;
      const t = (calcDuration - lower.durationAnos) / (upper.durationAnos - lower.durationAnos);
      ntnb = lower.taxaNtnb + t * (upper.taxaNtnb - lower.taxaNtnb);
    }
    setResultado({
      spreadEsperado: Math.round(mediaSpread * 10000),
      ntnb: ntnb * 100,
      taxaTotal: (ntnb + mediaSpread) * 100,
    });
  }, [calcRating, calcDuration, calcIndexador, data, ntnbQuery.data]);

  return (
    <div className="h-full flex flex-col gap-6 max-w-lg">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          Calculadora de Precificação — CRI/CRA
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Estime a taxa de mercado com base no spread médio do rating e indexador selecionados</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tipo de Indexador</label>
          <div className="flex gap-2">
            {["IPCA SPREAD", "DI SPREAD"].map((idx) => (
              <button
                key={idx}
                onClick={() => setCalcIndexador(idx)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  calcIndexador === idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {idx === "IPCA SPREAD" ? "IPCA+" : "DI+"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Rating do Devedor</label>
          <select
            value={calcRating}
            onChange={(e) => setCalcRating(e.target.value)}
            className="w-full h-9 px-3 rounded-md bg-muted/50 border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ratingsDisponiveis.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Duration desejada: <span className="text-foreground font-semibold">{calcDuration.toFixed(1)} anos</span>
          </label>
          <Slider
            value={[calcDuration]}
            onValueChange={([v]) => setCalcDuration(v)}
            min={0.5}
            max={15}
            step={0.5}
            className="w-full"
          />
        </div>
      </div>

      {resultado ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">NTN-B Implícita</p>
            <p className="text-lg font-bold text-foreground">{resultado.ntnb.toFixed(2)}%</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">para {calcDuration.toFixed(1)}a</p>
          </div>
          <div className="bg-card border border-primary/30 rounded-lg p-4 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Spread Esperado ({calcRating})</p>
            <p className="text-lg font-bold text-primary">{resultado.spreadEsperado}bps</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">média do rating</p>
          </div>
          <div className="bg-card border border-emerald-500/30 rounded-lg p-4 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Taxa Total</p>
            <p className="text-lg font-bold text-emerald-400">{resultado.taxaTotal.toFixed(2)}%</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">IPCA + spread</p>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <AlertCircle className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Sem dados para {calcRating} no indexador {calcIndexador === "IPCA SPREAD" ? "IPCA+" : "DI+"}.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CriCraDashboard() {
  const [activeView, setActiveView] = useState<"scatter" | "barras" | "tabela" | "calculadora">("scatter");
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [showOutliers, setShowOutliers] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const analysisQuery = trpc.criCra.getAnalysis.useQuery({
    durationMin: filters.durationRange[0],
    durationMax: filters.durationRange[1],
    indexadores: filters.indexadores.length ? filters.indexadores : undefined,
    ratings: filters.ratings.length ? filters.ratings : undefined,
    tipos: filters.tipos.length ? filters.tipos : undefined,
    excludeOutliers: !showOutliers,
  });

  const filterOptionsQuery = trpc.criCra.getFilterOptions.useQuery();

  const data: CriCraRow[] = analysisQuery.data ?? [];

  const views = [
    { key: "scatter" as const, icon: Activity, label: "Scatter" },
    { key: "barras" as const, icon: BarChart3, label: "Barras" },
    { key: "tabela" as const, icon: Table2, label: "Tabela" },
    { key: "calculadora" as const, icon: Calculator, label: "Calculadora" },
  ];

  const toggleFilter = (field: "indexadores" | "ratings" | "tipos", value: string) => {
    setFilters((prev) => {
      const arr = prev[field];
      return { ...prev, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  };

  const filterOptions = filterOptionsQuery.data;
  const allRatings = sortRatings(filterOptions?.ratings ?? []);
  const allIndexadores = filterOptions?.indexadores ?? [];
  const allTipos = filterOptions?.tipos ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar de filtros */}
      {sidebarOpen && (
        <div className="w-56 flex-shrink-0 border-r border-border bg-card/50 flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filtros</span>
            <button onClick={() => setSidebarOpen(false)} className="text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3 w-3 rotate-90" />
            </button>
          </div>
          <ScrollArea className="flex-1 p-4">
            <FilterSection title="Duration (anos)">
              <div className="px-1 pt-1 pb-2">
                <Slider
                  value={filters.durationRange}
                  onValueChange={(v) => setFilters((f) => ({ ...f, durationRange: v as [number, number] }))}
                  min={0} max={20} step={0.5}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{filters.durationRange[0]}a</span>
                  <span>{filters.durationRange[1]}a</span>
                </div>
              </div>
            </FilterSection>

            {allTipos.length > 0 && (
              <FilterSection title="Tipo">
                {allTipos.map((t) => (
                  <CheckItem key={t} id={`tipo-${t}`} label={t} checked={filters.tipos.includes(t)} onToggle={() => toggleFilter("tipos", t)} />
                ))}
              </FilterSection>
            )}

            {allIndexadores.length > 0 && (
              <FilterSection title="Indexador">
                {allIndexadores.map((idx) => (
                  <CheckItem key={idx} id={`idx-${idx}`} label={idx === "IPCA SPREAD" ? "IPCA+" : idx === "DI SPREAD" ? "DI+" : "% DI"} checked={filters.indexadores.includes(idx)} onToggle={() => toggleFilter("indexadores", idx)} />
                ))}
              </FilterSection>
            )}

            {allRatings.length > 0 && (
              <FilterSection title="Rating do Devedor">
                {allRatings.map((r) => (
                  <CheckItem key={r} id={`r-${r}`} label={r} checked={filters.ratings.includes(r)} onToggle={() => toggleFilter("ratings", r)} color={getRatingColor(r)} />
                ))}
              </FilterSection>
            )}

            <FilterSection title="Exibição" defaultOpen={false}>
              <CheckItem id="show-outliers" label="Mostrar outliers" checked={showOutliers} onToggle={() => setShowOutliers((v) => !v)} />
            </FilterSection>
          </ScrollArea>
        </div>
      )}

      {/* Conteúdo principal */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barra de navegação de views */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-card/30 flex-shrink-0">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="mr-2 text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3 w-3 -rotate-90" />
            </button>
          )}
          {views.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeView === key ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {analysisQuery.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <span>{data.length} papéis</span>
            )}
          </div>
        </div>

        {/* View ativa */}
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          {analysisQuery.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : activeView === "scatter" ? (
            <ScatterView data={data} />
          ) : activeView === "barras" ? (
            <BarView data={data} />
          ) : activeView === "tabela" ? (
            <TableView data={data} />
          ) : (
            <CalculadoraView data={data} />
          )}
        </div>
      </div>
    </div>
  );
}
