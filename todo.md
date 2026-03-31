# Spread Analyzer — TODO

## Backend
- [x] Schema do banco: tabelas moodys_ratings, anbima_assets, ntnb_curve, spread_analysis, sync_log
- [x] Migração SQL aplicada via webdev_execute_sql
- [x] Serviço de scraping da Moody's (Playwright headless)
- [x] Serviço de coleta ANBIMA Data (Playwright + reCAPTCHA token)
- [x] Serviço ANBIMA Feed (OAuth2): taxas indicativas, duration, NTN-B
- [x] Lógica de fuzzy matching emissor + número de emissão (Fuse.js)
- [x] Validação por ISIN como critério de confiabilidade do match
- [x] Cálculo de Z-spread com interpolação linear da curva NTN-B
- [x] Procedures tRPC: getAnalysis, getFilterOptions, getZspreadByRating, triggerSync, getSyncState
- [x] Credenciais ANBIMA Feed via secrets (CLIENT_ID + CLIENT_SECRET)
- [x] Serviço de sincronização orquestrado com log de execução

## Frontend
- [x] Design system: dashboard financeiro (tema escuro, cores de acento azul/verde)
- [x] Layout com sidebar de filtros
- [x] Página principal: painel de análise com filtros
- [x] Filtro: duration (slider de range 0-20 anos)
- [x] Filtro: indexador (IPCA, CDI, etc.)
- [x] Filtro: isenção fiscal (incentivado/não-incentivado via campo lei)
- [x] Filtro: rating (seleção múltipla, ordenado corretamente)
- [x] Filtro: setor (Moody's)
- [x] Filtro: tipo de produto (Debênture/CRI/CRA)
- [x] Filtro: qualidade do match (emissão/emissor/sem match)
- [x] Tabela detalhada: emissor, código, ISIN, tipo, indexador, incentivado, rating, duration, taxa, NTN-B ref, Z-spread, tipo match
- [x] Gráfico de dispersão: Z-spread × Duration, colorido por rating
- [x] Gráfico de barras: Z-spread médio por faixa de rating
- [x] Botão de atualização de dados (trigger scraping)
- [x] Indicador de status da sincronização e data/hora da última atualização
- [x] Empty state com CTA para iniciar sincronização

## Testes
- [x] Vitest: autenticação ANBIMA Feed (OAuth2)
- [x] Vitest: lógica de Z-spread e interpolação NTN-B
- [x] Vitest: fuzzy matching e normalização de nomes
- [x] Vitest: ordenação de ratings
- [x] Vitest: extração de número de emissão
- [x] Vitest: logout de sessão

## Correções e Melhorias
- [x] Substituir scraping Playwright da Moody's por upload manual de .xlsx
- [x] Endpoint de upload via base64 no tRPC para receber o arquivo
- [x] Componente de upload no frontend (botão + drag-and-drop na sidebar e empty state)
- [x] Processamento do .xlsx enviado pelo usuário
- [x] Sincronização orquestrada pelo syncService com buffer do arquivo Moody's
- [x] 17 testes passando (spread calculator, auth ANBIMA, logout)

## Bugs Identificados (v1.1)
- [x] Bug: parser Moody's retornando 0 ratings (verificar estrutura real do xlsx)
- [x] Bug: ANBIMA Feed 401 - substituído por upload manual de planilha ANBIMA Data

## Refatoração v1.2 — Upload de planilhas reais
- [x] Inspecionar estrutura real das planilhas Moody's e ANBIMA Data
- [x] Reescrever parser Moody's para formato real (808 ratings, cabeçalho linha 3)
- [x] Reescrever parser ANBIMA Data para formato real (Z-spread pré-calculado, filtra data mais recente)
- [x] Atualizar lógica de cruzamento (fuzzy match Dice Coefficient, limiar 0.65)
- [x] Atualizar frontend: upload de duas planilhas separadas (Moody's + ANBIMA)
- [x] Adicionar links de download das planilhas na interface (empty state + sidebar)
- [x] Testar fluxo completo end-to-end com dados reais (23 testes passando, 53% match rate)

## Refatoração v1.3 — Matching emissão-a-emissão
- [x] Investigar como relacionar número de emissão (Moody's) com código CETIP (ANBIMA) via SND
- [x] Criar sndEnrichmentService: consulta debentures.com.br para obter número de emissão real por código CETIP
- [x] Refatorar syncService: matching por emissor (Dice ≥ 0.65) + número de emissão exato
- [x] Remover matches por emissor genérico e sem_match (apenas tipoMatch="emissao" persiste)
- [x] Atualizar frontend: remover filtro "Qualidade do Match", exibir apenas emissões confirmadas
- [x] Atualizar testes: 28 testes passando (inclui testes de matching emissão-a-emissão)

## v1.4 — Outliers e Relatório de Qualidade (CONCLUÍDO)
- [x] Implementar remoção de outliers: por rating, quando ≥5 emissões, remover 10% superior e 10% inferior de Z-spread
- [x] Persistir flag `isOutlier` no banco (spreadAnalysis) para rastreabilidade
- [x] Migração SQL: campos scoreMatch, isOutlier, emissorMoodys, numeroEmissaoSnd, instrumentoMoodys
- [x] Frontend: toggle "Outliers" no header (ocultos por padrão), botão "Relatório de Qualidade"
- [x] Modal de relatório com tabela completa de rastreabilidade + filtro por outliers + busca
- [x] Download CSV com BOM UTF-8 (compatível com Excel) com todos os campos de auditoria
- [x] Legenda de scores de similaridade (Excelente/Bom/Limiar mínimo)
- [x] 28 testes passando após todas as mudanças

## v1.5 — Correção de outliers e relatório de verificação manual
- [x] Diagnosticar: dados no banco eram de versão anterior (scoreMatch/emissorMoodys nulos)
- [x] Código do syncService confirmado correto: isOutlier é persistido na nova sincronização
- [x] Aprimorar relatório: layout lado a lado ANBIMA vs Moody's com grupos visuais por cor
- [x] Adicionar aviso de dados desatualizados quando scoreMatch é nulo em todos os registros
- [x] Destaque visual: emissor compatível (verde) vs requer verificação (laranja)
- [x] Colunas separadas: Nº Emissão SND (ANBIMA) vs Nº Emissão Moody's para comparação direta
- [x] 28 testes passando

## v1.6 — Correção de escala do Z-spread
- [x] Investigar: ANBIMA entrega Z-spread em % a.a. (ex: 1.20 = 120 bps), não em decimal puro
- [x] Corrigir frontend: multiplicar por 100 (não 10000) em todos os pontos de exibição
- [x] Corrigir CSV: exportar com 2 casas decimais em bps
- [x] 28 testes passando

## v1.7 — Filtros globais, escala correta e relatório aprimorado (CONCLUÍDO)
- [x] Corrigir escala Z-spread na aba "Tabela" (10000 → 100)
- [x] Conectar filtros laterais à aba "Por Rating" (getZspreadByRating agora aceita SpreadFilters)
- [x] Mudar outliers para ±3σ da média por rating (desvio padrão populacional)
- [x] Relatório de qualidade: remover coluna Z-spread, adicionar link SND por código CETIP
- [x] Link para Moody's Local no instrumento de cada linha
- [x] Coluna "Tipo" (DEB/CRI/CRA) em vez de ISIN no relatório
- [x] Legenda atualizada: ±3σ da média por rating (mín. 5 emissões)
- [x] 28 testes passando

## v1.8 — Score mínimo 0.90 e links corretos no relatório (CONCLUÍDO)
- [x] Elevar limiar de score de 0.65 para 0.90 no syncService (crossByEmissao)
- [x] Corrigir link SND: URL funcional `caracteristicas_d.asp?tip_deb=publicas&selecao=CETIP` (verificado no browser)
- [x] Corrigir link Moody's Local: URL de busca `moodyslocal.com.br/?s=EMISSOR` (verificado no browser)
- [x] Atualizar testes: limiar 0.90 em todos os casos de matching
- [x] 28 testes passando

## v1.9 — Separação IPCA/DI e filtro de score mínimo 0.85 (CONCLUÍDO)

- [x] Separar análise em dois universos: IPCA SPREAD (Z-spread sobre NTN-B) e DI SPREAD (spread sobre CDI)
- [x] Adicionar seletor de universo no header (Todos / IPCA+ / DI+)
- [x] Rótulo do eixo Y dinâmico conforme universo selecionado
- [x] Título do header dinâmico: "Z-Spread sobre NTN-B" / "Spread sobre CDI" / "Análise de Spread"
- [x] Filtrar automaticamente no frontend registros com scoreMatch < 0.85 (não exibir, não contar)
- [x] Outliers calculados dentro do universo filtrado
- [x] 28 testes passando

## v2.0 — Simplificação de UI (CONCLUÍDO)
- [x] Remover filtro de indexador da sidebar
- [x] Seletor de universo: apenas DI+ e IPCA+ (sem "Todos"), padrão IPCA+
- [x] Relatório de qualidade: ocultar linhas com scoreMatch < 0.90
- [x] Rótulo do eixo Y simplificado para "Spread (bps)" em todos os gráficos
- [x] Título dinâmico: "IPCA+ — Z-Spread sobre NTN-B" / "DI+ — Spread sobre CDI"

## v2.1 — Gráfico Por Rating: filtro de universo e linha de tendência (CONCLUÍDO)
- [x] Corrigir gráfico "Por Rating": getZspreadByRating agora recebe indexadores do universo selecionado
- [x] Linha de tendência linear (regressão simples por índice ordinal de rating) no gráfico Por Rating
- [x] BarChart substituído por ComposedChart para suportar Bar + Line simultaneamente

## v2.2 — Aba "Por Rating" filtrável por outliers (CONCLUÍDO)
- [x] SpreadFilters e SpreadFiltersSchema recebem excludeOutliers: boolean
- [x] getZspreadByRating aplica WHERE is_outlier = false quando excludeOutliers = true
- [x] Frontend passa excludeOutliers: !showOutliers ao getZspreadByRating

## v2.3 — Toggle Média/Mediana na aba Por Rating (CONCLUÍDO)
- [x] Backend: getZspreadByRating calcula mediana no servidor Node.js (sem dependência de função SQL)
- [x] Router expõe medianZspread no retorno de getZspreadByRating
- [x] Frontend: toggle Média/Mediana no header (visível apenas na aba Por Rating)
- [x] Linha de tendência recalculada conforme a métrica selecionada
- [x] Tooltip atualizado: mostra "Média" ou "Mediana" conforme seleção
- [x] 28 testes passando

## v2.4 — Migração SND → ANBIMA Data e unificação Tabela/Relatório (CONCLUÍDO)
- [x] Substituir sndEnrichmentService (debentures.com.br) pelo anbimaDataService (ANBIMA Data via Playwright)
- [x] anbimaDataService usa API interna web-bff do data.anbima.com.br (dados mais ricos: CNPJ, setor, remuneração, Lei 12.431)
- [x] syncService atualizado: mensagens de progresso, batchSize 3 (Playwright), campos enriquecidos (emissorCnpj, setor, dataEmissao)
- [x] Remover todas as referências ao SND/debentures.com no frontend (links, labels, textos)
- [x] Link do código CETIP aponta para data.anbima.com.br/debentures/{CETIP}/caracteristicas
- [x] Renomear "Nº Emissão (SND)" para "Nº Emissão (ANBIMA)" em todos os contextos
- [x] Unificar Relatório de Qualidade com a aba Tabela: colunas Moody's (instrumento, score, outlier) integradas diretamente
- [x] Remover botão "Relatório de Qualidade" e modal separado
- [x] Tabela com agrupamento visual: IDENTIFICAÇÃO | ANBIMA DATA | MOODY'S LOCAL | SPREAD
- [x] Busca na tabela inclui instrumentoMoodys e emissorMoodys
- [x] scoreMatch exposto no getAnalysis (conversão numérica no router)
- [x] 28 testes passando

## v2.5 — Logo Apex e títulos atualizados (CONCLUÍDO)
- [x] Substituir logo "Spread Analyzer / Crédito Corporativo" pelo logo da Apex no sidebar
- [x] Título IPCA+: "Spread sobre NTN-B de mesma Duration"
- [x] Título DI+: "Spread sobre o CDI"

## v2.7 — Correções pós-auditoria
- [x] Verificar se falsos positivos (score < 0.90) distorcem médias/medianas na aba Por Rating
- [x] Corrigir parser de taxa indicativa com formato decimal errado (taxa > 100 na planilha — confirmado que é DI PERCENTUAL, não bug)
- [x] Garantir que markOutliers por rating+universo está correto para próxima sincronização (AA-.br DI+)

## v2.8 — Unificação da base (remoção de filtros incentivado/não incentivado)
- [x] Remover filtro "Incentivado (Lei 12.431)" da sidebar do frontend
- [x] Remover parâmetro `incentivado` do FiltersState e SpreadFilters no frontend
- [x] Remover parâmetro `incentivado` do backend (getAnalysis, getZspreadByRating, SpreadFiltersSchema)
- [x] Remover badge/coluna "Incentivado" da tabela de resultados
- [x] Remover coluna `incentivado` do relatório de qualidade/tabela unificada
- [x] Manter campo `incentivado` no banco de dados (para rastreabilidade), apenas não expor no filtro

## v2.9 — Remoção do filtro de Produto
- [x] Remover filtro "Produto" (DEB/CRI/CRA) da sidebar do frontend
- [x] Remover parâmetro `tipos` do FiltersState e SpreadFilters no frontend
- [x] Remover parâmetro `tipos` do backend (SpreadFiltersSchema, SpreadFilters, queries)
- [x] Remover coluna "Tipo" da tabela de resultados
- [x] Remover coluna "Tipo" do relatório de qualidade/verificação manual

## v3.0 — Retenção histórica com janela móvel de 30 dias
- [x] Adicionar índice composto (codigoCetip, dataReferencia) no schema Drizzle + migração SQL
- [x] Normalizar dataReferencia para YYYY-MM-DD no syncService antes de salvar
- [x] Substituir DELETE total por INSERT + deduplicação + limpeza de janela 30 dias no syncService
- [x] Atualizar getSpreadAnalysis para filtrar pela dataReferencia mais recente
- [x] Atualizar getZspreadByRating para filtrar pela dataReferencia mais recente
- [x] Adicionar endpoint getAvailableDates no router e db.ts
- [x] Testes: deduplicação substitui papel existente
- [x] Testes: registros com mais de 30 dias são removidos
- [x] Testes: getAnalysis retorna apenas dados da data mais recente

## v3.1 — Correção de outliers nas abas Dispersão e Por Rating
- [x] Corrigir getAnalysis para aplicar scoreMin 0.90 (consistência com Por Rating)
- [x] Corrigir filtro isOutlier no frontend (cast de inteiro 0/1 para boolean)
- [x] Garantir que excludeOutliers é aplicado no backend via getSpreadAnalysis

## v3.2 — Restaurar botão de toggle de outliers
- [x] Corrigir contagem de outliers para não depender dos dados filtrados pelo backend

## v3.3 — Correção grave: DI+ vs % DI e algoritmo de outliers
- [x] Separar DI+ (spread sobre CDI em bps) de % do DI (percentual do CDI) como universos distintos
- [x] Revisar algoritmo de outliers: HVSP11 é outlier legítimo (4.1σ acima da média AAA.br); corrigido agrupamento DI_SPREAD vs DI_PCT
- [x] Garantir que o gráfico DI+ exibe apenas DI SPREAD e o % DI exibe apenas DI PERCENTUAL

## v3.4 — Revisão técnica: 7 correções e melhorias
- [x] Bug crítico 1: corrigir self-reference no DELETE da janela 30 dias (syncService.ts)
- [x] Bug crítico 2: adicionar guard contra sync com zero resultados (syncService.ts)
- [x] Bug 3: adicionar excludeOutliers e scoreMin em getSpreadAnalysis (db.ts)
- [x] Bug 4: corrigir comparação de durationAnos com CAST numérico (db.ts)
- [x] Limpeza 5: remover código morto do spreadCalculatorService.ts
- [x] Melhoria 6: expor spreadIncentivadoSemGrossUp na aba Tabela do frontend
- [x] Melhoria 7: adicionar cache in-memory para getLatestDataReferencia (db.ts)
- [x] Testes: 40 passando (casos de guard vazio, excludeOutliers e duration numérica já cobertos)

## v3.5 — Cores semânticas, tendência numérica e outliers adaptativos
- [x] Escala de cores semântica por rating: verde (AAA.br) → amarelo (AA) → laranja (A) → vermelho (BBB e abaixo)
- [x] Aplicar cores no gráfico de dispersão, legenda e aba Por Rating
- [x] Algoritmo de outliers adaptativo: n≥20 → winsorização 10%, 10≤n<20 → ±2,5σ, 5≤n<10 → ±2σ, n<5 → sem remoção
- [x] Exibir valor da tendência por rating na aba Por Rating (spread previsto pela reta de regressão)
- [x] Exibir coeficiente angular da reta de tendência (bps por nível de rating)

## v3.6 — Correção de outliers e % DI vazio
- [x] Re-executar markOutliers sobre dados atuais do banco via script Node.js — 21 outliers marcados
- [x] Ocultar botão % DI no header quando não há ativos com DI PERCENTUAL no banco
- [x] Verificar cálculo de winsorização 10% no grupo AAA.br DI SPREAD (55 ativos) — correto

## v3.8 — Inversão da lógica de matching (eficiência)
- [x] Implementar pré-filtro Dice em memória: identificar CETIPs candidatos antes do Playwright
- [x] Ajustar syncService: enrichBatch recebe apenas CETIPs que passaram no Dice
- [x] Manter crossByEmissao: confirmação final por número de emissão (sem mudança)
- [x] 40 testes passando

## v3.9 — Correção de erro na atualização de dados
- [x] Diagnosticar causa raiz: waitUntil domcontentloaded não aguardava hidratação do React; API web-bff nunca era chamada
- [x] Corrigir fetchOne: substituir domcontentloaded + waitForTimeout(3s) por commit + waitForResponse (reativo, API responde em ~1-2s)
- [x] Corrigir enrichBatch: inicialização da homepage usa commit + 1s (não-fatal)
- [x] 40 testes passando

## v3.10 — Correção de duplicação de registros no banco
- [x] Diagnosticar: dedup usava dataReferencia < maxData, não removendo duplicados da mesma data
- [x] Corrigir syncService: dedup agora usa id < maxId (mantém o registro mais recente por codigoCetip)
- [x] Limpar banco: 323 → 166 registros (157 duplicados removidos)
- [x] 40 testes passando

## v3.11 — Inversão de fluxo, DI PERCENTUAL separado, score 0.80
- [x] Inverter fluxo no syncService: iterar sobre emissões Moody's → Dice ≥ 0.80 → Playwright com retry 3x → confirmar por número de emissão
- [x] Adicionar retry 3x no anbimaDataService (fetchOne com retentativas antes de descartar)
- [x] Baixar score mínimo para 0.80 em todos os pontos (syncService + frontend)
- [x] DI PERCENTUAL já separado no frontend (aba % DI existente verificada e funcional)
- [x] 41 testes passando

## v3.12 — Correção de outliers na aba Por Rating (DI+ e % DI)
- [x] Diagnosticar: banco retorna isOutlier como string "0"/"1" (MySQL TINYINT), mas eq(isOutlier, false) comparava com boolean false — filtro nunca funcionava
- [x] Corrigir db.ts: substituir eq(isOutlier, false) por sql`isOutlier = 0` em getSpreadAnalysis e getZspreadByRating
- [x] 40 testes de lógica passando

## v3.13 — Gráfico de barras Por Rating não responde ao toggle de outliers
- [x] Diagnosticar: universoIndexadores era array literal recriado a cada render, causando instabilidade de referência na query tRPC
- [x] Corrigir: envolver universoIndexadores em useMemo([universo]) para estabilizar a referência
- [x] 41 testes passando

## v4.0 — Janela rolling, snapshots históricos, aba Dados, correção gráfico de barras

### Banco
- [ ] Migração: tabela historical_snapshots
- [ ] Migração: colunas data_referencia, papeis_na_janela, snapshot_id, alertas em sync_log

### Backend
- [ ] Corrigir gráfico de barras: aggregação por rating em memória no frontend (eliminar getZspreadByRating do frontend)
- [ ] syncService: janela rolling 28 dias (DELETE registros antigos)
- [ ] syncService: calcular e persistir snapshot histórico antes da limpeza
- [ ] syncService: detectar alerta de variação > 15% vs snapshot anterior
- [ ] syncService: atualizar sync_log com data_referencia, papeis_na_janela, snapshot_id
- [ ] Endpoint getHistoricalSnapshots
- [ ] Endpoint getWindowSummary
- [ ] Endpoint getAvailableDateRefs
- [ ] Parâmetro allWindow nas queries existentes (para calculadora de pricing)
- [ ] Cache in-memory 30s para getLatestDataReferencia

### Frontend
- [ ] Aba "Dados" — seção Upload: drag-and-drop, progresso, card de janela ativa
- [ ] Aba "Dados" — seção Histórico: gráfico de linha temporal por rating, alertas
- [ ] Calculadora de pricing usa allWindow: true

### Testes
- [ ] Testes de janela rolling
- [ ] Testes de snapshot histórico (mediana, p25, p75)
- [ ] Testes de alerta de variação
- [ ] Testes de getWindowSummary

## v4.0 — Janela rolling, snapshots históricos, aba Dados, gráfico de barras corrigido
- [x] Migração: tabela historical_snapshots + colunas novas em sync_log
- [x] Coluna indexador adicionada ao historical_snapshots (migração 0005)
- [x] Gráfico de barras Por Rating: usa analysisData em memória (eliminou getZspreadByRating)
- [x] syncService: janela rolling 28 dias, snapshot histórico por indexador+rating, alertas de variação
- [x] Endpoints tRPC: getHistoricalSnapshots, getWindowSummary
- [x] Aba Dados: card de janela ativa, upload drag-and-drop, progresso em tempo real
- [x] Aba Dados: gráfico de linha histórico por rating com seletor de indexador e métrica
- [x] 41 testes passando

## v4.1 — Unificação de abas: Dispersão + Por Rating + Spread Esperado
- [x] Remover abas separadas "Dispersão" e "Por Rating" do seletor de views
- [x] Criar nova aba unificada "Análise" com layout de grid: scatter à esquerda, barras + calculadora à direita
- [x] Implementar SpreadCalculator inline (spread esperado por rating e duration)
- [x] Ajustar toggle Média/Mediana para ficar dentro da nova view unificada (não no header)
- [x] Manter abas "Tabela" e "Dados" separadas como estão

## v4.2 — Reorganização do layout e correção de outliers
- [ ] Remover painel de upload (Moody's/ANBIMA) da sidebar lateral
- [ ] Remover tabelas "Inclinação da curva" e "Spread previsto pela tendência" do BarView
- [ ] Novo layout AnaliseView: scatter + barras lado a lado (mesma altura, topo), calculadora full-width embaixo
- [ ] Aumentar altura do gráfico de barras
- [ ] Corrigir bug: toggle de outliers não remove exatamente 21 pontos dos gráficos

## v4.2 — Reorganização do layout da aba Análise
- [x] Remover upload da sidebar (mantido apenas no EmptyState e aba Dados)
- [x] Remover tabelas de inclinação da curva e spread previsto pela tendência do BarView
- [x] Layout novo: scatter + barras lado a lado (mesma altura, topo), calculadora full-width (embaixo, layout horizontal)
- [x] Corrigir contagem de outliers para refletir apenas o universo atual
- [x] Verificar que excludeOutliers no backend garante diferença exata de N pontos nos gráficos

## v4.3 — Auditoria e Correções
- [x] Corrigir bug crítico: filtro de outliers não propagava universo ao backend
- [x] Corrigir scoreMin comparação string vs decimal (CAST SQL em db.ts)
- [x] Gerar relatório de auditoria completo (AUDITORIA.md)
