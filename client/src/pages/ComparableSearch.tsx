import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Loader2,
  ExternalLink,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Building2,
  Globe,
  Database,
  RotateCcw,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ComparableResult {
  id: string;
  fonte: "interno" | "web" | "noticia";
  titulo: string;
  emissor: string;
  tipo: string;
  finalidade: string;
  indexador?: string;
  prazo?: string;
  volume?: string;
  taxa?: string;
  rating?: string;
  setor?: string;
  estruturador?: string;
  dataEmissao?: string;
  relevancia: number;
  justificativa: string;
  url?: string;
  fonteNome?: string;
}

interface SearchAttributes {
  tipo?: string;
  finalidade?: string;
  indexador?: string;
  prazo?: string;
  setor?: string;
  emissor?: string;
  volume?: string;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ComparableSearch() {
  const [query, setQuery] = useState("");
  const [activeSearchId, setActiveSearchId] = useState<number | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const searchMutation = trpc.comparable.search.useMutation({
    onSuccess: (data) => {
      setActiveSearchId(data.searchId);
      setPollingEnabled(true);
    },
    onError: (err) => {
      toast.error(`Erro ao iniciar busca: ${err.message}`);
    },
  });

  const searchResult = trpc.comparable.getSearch.useQuery(
    { searchId: activeSearchId! },
    {
      enabled: !!activeSearchId && pollingEnabled,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "done" || status === "error") return false;
        return 3000;
      },
    }
  );

  const searchHistory = trpc.comparable.listSearches.useQuery();

  // Parar polling quando concluído
  useEffect(() => {
    if (searchResult.data?.status === "done" || searchResult.data?.status === "error") {
      setPollingEnabled(false);
    }
  }, [searchResult.data?.status]);

  const handleSearch = () => {
    if (query.trim().length < 10) {
      toast.error("Descreva a emissão com mais detalhes (mínimo 10 caracteres)");
      return;
    }
    setActiveSearchId(null);
    setExpandedCards(new Set());
    searchMutation.mutate({ query: query.trim() });
  };

  const handleHistoryClick = (id: number) => {
    setActiveSearchId(id);
    setPollingEnabled(false);
  };

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isRunning = searchMutation.isPending || searchResult.data?.status === "running";
  const results = (searchResult.data?.results as ComparableResult[] | null) || [];
  const attributes = searchResult.data?.attributes as SearchAttributes | null;
  const searchTerms = searchResult.data?.searchTerms as string[] | null;

  const getRelevanciaColor = (r: number) => {
    if (r >= 75) return "text-emerald-400";
    if (r >= 50) return "text-yellow-400";
    return "text-orange-400";
  };

  const getFonteIcon = (fonte: string) => {
    if (fonte === "interno") return <Database className="h-3 w-3" />;
    if (fonte === "web") return <Globe className="h-3 w-3" />;
    return <FileText className="h-3 w-3" />;
  };

  const getFonteBadgeClass = (fonte: string) => {
    if (fonte === "interno") return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    if (fonte === "web") return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  };

  return (
    <div className="flex h-full gap-0">
      {/* Sidebar de histórico */}
      <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="px-4 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-sidebar-foreground">Comparáveis</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Busca inteligente de emissões similares
          </p>
        </div>

        <div className="px-3 py-3 border-b border-sidebar-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Histórico
          </p>
          <ScrollArea className="h-[calc(100vh-200px)]">
            {searchHistory.data?.length === 0 && (
              <p className="text-xs text-muted-foreground px-1">Nenhuma busca ainda</p>
            )}
            {searchHistory.data?.map((s) => (
              <button
                key={s.id}
                onClick={() => handleHistoryClick(s.id)}
                className={`w-full text-left px-2 py-2 rounded text-xs mb-1 transition-colors hover:bg-sidebar-accent ${
                  activeSearchId === s.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {s.status === "done" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                  ) : s.status === "error" ? (
                    <AlertCircle className="h-3 w-3 text-red-400 flex-shrink-0" />
                  ) : (
                    <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
                  )}
                  <span className="truncate font-medium">{s.query.slice(0, 40)}{s.query.length > 40 ? "..." : ""}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" />
                  <span>{new Date(s.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
              </button>
            ))}
          </ScrollArea>
        </div>
      </aside>

      {/* Conteúdo principal */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Campo de busca */}
        <div className="p-6 border-b border-border bg-card/50">
          <div className="max-w-3xl">
            <h2 className="text-base font-semibold mb-1">Descreva a emissão que você quer comparar</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Seja específico sobre a finalidade, setor, tipo de instrumento e qualquer característica relevante.
              O sistema vai buscar na base interna e na web.
            </p>
            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSearch();
                }}
                placeholder="Ex: CRI para financiamento de terreno para loteamento residencial, IPCA+, prazo 5 anos, devedor incorporadora de médio porte..."
                className="flex-1 min-h-[80px] max-h-[160px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                disabled={isRunning}
              />
              <Button
                onClick={handleSearch}
                disabled={isRunning || query.trim().length < 10}
                className="self-end h-10 gap-2"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {isRunning ? "Buscando..." : "Buscar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Ctrl+Enter para buscar</p>
          </div>
        </div>

        {/* Área de resultados */}
        <ScrollArea className="flex-1">
          <div className="p-6">
            {/* Status da busca em andamento */}
            {isRunning && (
              <div className="max-w-3xl mb-6">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm font-medium">Agentes trabalhando...</span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { key: "orquestrador", label: "Orquestrador", desc: "Interpretando a emissão e gerando termos de busca" },
                      { key: "interno", label: "Agente Interno", desc: "Buscando na base ANBIMA local" },
                      { key: "web", label: "Agente Web", desc: "Pesquisando no Google, gestoras, CVM e notícias" },
                      { key: "sintetizador", label: "Sintetizador", desc: "Consolidando e ranqueando resultados" },
                    ].map((agent) => (
                      <div key={agent.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
                        <span className="font-medium text-foreground">{agent.label}:</span>
                        <span>{agent.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Atributos extraídos */}
            {attributes && searchResult.data?.status === "done" && (
              <div className="max-w-3xl mb-4">
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Atributos identificados</p>
                  <div className="flex flex-wrap gap-1.5">
                    {attributes.tipo && (
                      <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-300 border-blue-500/30">
                        Tipo: {attributes.tipo}
                      </Badge>
                    )}
                    {attributes.finalidade && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                        Finalidade: {attributes.finalidade}
                      </Badge>
                    )}
                    {attributes.setor && (
                      <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-300 border-purple-500/30">
                        Setor: {attributes.setor}
                      </Badge>
                    )}
                    {attributes.indexador && (
                      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-300 border-amber-500/30">
                        Indexador: {attributes.indexador}
                      </Badge>
                    )}
                    {attributes.prazo && (
                      <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-300 border-orange-500/30">
                        Prazo: {attributes.prazo}
                      </Badge>
                    )}
                  </div>
                  {searchTerms && searchTerms.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground mb-1">Termos pesquisados:</p>
                      <div className="flex flex-wrap gap-1">
                        {searchTerms.map((t, i) => (
                          <span key={i} className="text-xs bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Erro */}
            {searchResult.data?.status === "error" && (
              <div className="max-w-3xl mb-4">
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-300">Erro na busca</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{searchResult.data.errorMessage}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Resultados */}
            {results.length > 0 && (
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-medium">{results.length} emissões comparáveis encontradas</span>
                  <span className="text-xs text-muted-foreground">— ordenadas por relevância</span>
                </div>

                <div className="space-y-3">
                  {results.map((result, idx) => {
                    const isExpanded = expandedCards.has(result.id);
                    return (
                      <div
                        key={result.id}
                        className="rounded-lg border border-border bg-card overflow-hidden"
                      >
                        {/* Header do card */}
                        <div
                          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-accent/30 transition-colors"
                          onClick={() => toggleCard(result.id)}
                        >
                          {/* Número de ranking */}
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                            {idx + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-medium text-sm">{result.emissor}</span>
                              <Badge variant="outline" className="text-xs">
                                {result.tipo}
                              </Badge>
                              <span className={`flex items-center gap-1 text-xs border rounded px-1.5 py-0.5 ${getFonteBadgeClass(result.fonte)}`}>
                                {getFonteIcon(result.fonte)}
                                {result.fonteNome || result.fonte}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {result.finalidade}
                            </p>
                          </div>

                          <div className="flex-shrink-0 flex items-center gap-2">
                            <div className="text-right">
                              <div className={`text-sm font-bold ${getRelevanciaColor(result.relevancia)}`}>
                                {result.relevancia}%
                              </div>
                              <div className="text-xs text-muted-foreground">relevância</div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {/* Detalhes expandidos */}
                        {isExpanded && (
                          <div className="border-t border-border p-4 bg-background/50">
                            {/* Grid de características */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4 text-xs">
                              {result.setor && (
                                <div>
                                  <span className="text-muted-foreground">Setor:</span>{" "}
                                  <span className="font-medium">{result.setor}</span>
                                </div>
                              )}
                              {result.indexador && (
                                <div>
                                  <span className="text-muted-foreground">Indexador:</span>{" "}
                                  <span className="font-medium">{result.indexador}</span>
                                </div>
                              )}
                              {result.prazo && (
                                <div>
                                  <span className="text-muted-foreground">Prazo:</span>{" "}
                                  <span className="font-medium">{result.prazo}</span>
                                </div>
                              )}
                              {result.volume && (
                                <div>
                                  <span className="text-muted-foreground">Volume:</span>{" "}
                                  <span className="font-medium">{result.volume}</span>
                                </div>
                              )}
                              {result.taxa && (
                                <div>
                                  <span className="text-muted-foreground">Taxa:</span>{" "}
                                  <span className="font-medium">{result.taxa}</span>
                                </div>
                              )}
                              {result.rating && (
                                <div>
                                  <span className="text-muted-foreground">Rating:</span>{" "}
                                  <span className="font-medium">{result.rating}</span>
                                </div>
                              )}
                              {result.estruturador && (
                                <div>
                                  <span className="text-muted-foreground">Estruturador:</span>{" "}
                                  <span className="font-medium">{result.estruturador}</span>
                                </div>
                              )}
                              {result.dataEmissao && (
                                <div>
                                  <span className="text-muted-foreground">Data:</span>{" "}
                                  <span className="font-medium">{result.dataEmissao}</span>
                                </div>
                              )}
                            </div>

                            <Separator className="my-3" />

                            {/* Justificativa */}
                            <div className="mb-3">
                              <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                                Por que é comparável
                              </p>
                              <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
                                {result.justificativa}
                              </p>
                            </div>

                            {/* Link para fonte */}
                            {result.url && (
                              <a
                                href={result.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                                Ver fonte original
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Estado vazio */}
            {!isRunning && !activeSearchId && (
              <div className="max-w-3xl">
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <Sparkles className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                  <h3 className="text-sm font-medium mb-1">Busca inteligente de emissões comparáveis</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                    Descreva a emissão que você quer analisar. O sistema usa múltiplos agentes de IA para buscar
                    emissões similares na base interna e na web — com foco no contexto de negócio.
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-xs text-left">
                    <div className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Database className="h-3.5 w-3.5 text-blue-400" />
                        <span className="font-medium">Base Interna</span>
                      </div>
                      <p className="text-muted-foreground">~1.274 ativos ANBIMA com dados de mercado</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Globe className="h-3.5 w-3.5 text-purple-400" />
                        <span className="font-medium">Web & Notícias</span>
                      </div>
                      <p className="text-muted-foreground">Google, gestoras, CVM, InfoMoney, Valor</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Building2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="font-medium">Contexto</span>
                      </div>
                      <p className="text-muted-foreground">Foco em finalidade, empresa e projeto</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
