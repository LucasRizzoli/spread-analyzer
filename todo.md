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
