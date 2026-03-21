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
