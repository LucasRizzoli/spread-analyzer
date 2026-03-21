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
