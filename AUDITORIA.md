# Auditoria Completa — Spread Analyzer
**Data:** 31/03/2026 | **Auditor:** Manus AI | **Versão auditada:** d1fa1f01 → v4.2+

---

## Sumário Executivo

O projeto é uma aplicação de análise de spreads de crédito de mercado de capitais brasileiro, com stack React 19 + tRPC 11 + Drizzle ORM + MySQL. A auditoria identificou **um bug crítico de fluxo de dados já corrigido** (filtro de outliers não propagava o universo ao backend), **dois bugs de comparação de tipo** no banco (scoreMin como string vs decimal), e uma série de pontos de atenção em segurança, resiliência e manutenibilidade. O código tem boa estrutura geral, mas o arquivo `SpreadDashboard.tsx` (2.430 linhas) é um monólito que precisa de decomposição urgente.

---

## FRENTE 1 — Teste de Sanidade Funcional

**Sumário:** Todas as funcionalidades principais existem de ponta a ponta. O bug crítico do filtro de outliers foi corrigido nesta sessão. Dois endpoints usam `publicProcedure` onde deveriam ser protegidos.

| Funcionalidade | Status | Problema encontrado | Sugestão |
|---|---|---|---|
| Upload e sync de planilhas Moody's + ANBIMA | ✅ Ok | — | — |
| Cálculo de Z-spread e match de ratings | ✅ Ok | — | — |
| Filtro de outliers nos gráficos | ✅ Corrigido | **Bug crítico:** universo não era passado ao backend; query retornava todos os indexadores e filtrava no frontend, causando inconsistência de cache com o toggle de outliers | Corrigido: `indexadoresEfetivos` derivado do universo e passado na query |
| Gráfico de dispersão (scatter) | ✅ Ok | — | — |
| Gráfico de barras por rating | ✅ Ok | — | — |
| Calculadora de spread esperado (pricing) | ✅ Ok | — | — |
| Tabela de ativos com busca | ✅ Ok | — | — |
| Aba Dados / histórico de snapshots | ✅ Ok | — | — |
| Autenticação OAuth (login/logout) | ✅ Ok | — | — |
| `triggerSync` protegido por autenticação | ✅ Ok | Correto: `protectedProcedure` | — |
| `getAnalysis` exposto publicamente | ⚠️ Parcial | Dados financeiros acessíveis sem autenticação | Avaliar se dados são públicos ou requerem login |
| Filtro de scoreMin no banco | ⚠️ Corrigido | Comparação `gte(scoreMatch, String(0.80))` usa comparação lexicográfica; funciona por coincidência com DECIMAL(5,4) mas é tecnicamente incorreto | Corrigido: `CAST(scoreMatch AS DECIMAL(5,4)) >= 0.80` |
| Race condition no triggerSync | ⚠️ Parcial | Guard `if (currentSyncStatus === "running") return` existe, mas é in-memory; em múltiplas instâncias do servidor, dois syncs simultâneos são possíveis | Adicionar lock no banco (tabela `sync_lock`) |
| Fallback quando banco indisponível | ✅ Ok | Retorna arrays vazios com `console.warn` | — |

**Top 3 ações prioritárias:**
1. Avaliar se `getAnalysis` e outros endpoints de leitura devem ser `protectedProcedure` (dados de mercado podem ser sensíveis).
2. Adicionar validação de tamanho máximo nos arquivos base64 do `triggerSync` (atualmente sem limite — risco de DoS).
3. Adicionar lock de banco para o sync (evitar execuções paralelas em múltiplas instâncias).

---

## FRENTE 2 — Eliminação de Código Morto e Pontos Cegos

**Sumário:** O código morto mais significativo é o import `between` no `db.ts` (nunca usado) e o `gte` que foi substituído pelo `sql` CAST. O `SpreadDashboard.tsx` tem handlers de arquivo (`handleMoodysFileChange`, `handleAnbimaFileChange`, `fileToBase64`, `handleSync`) que existem no componente principal mas são passados como props para subcomponentes — não é código morto, mas é acoplamento desnecessário.

| Localização | Tipo de problema | Ação recomendada |
|---|---|---|
| `server/db.ts:96` — import `between` | Import não usado | Remover |
| `server/db.ts:96` — import `gte` | Import não mais usado (substituído por `sql`) | Remover |
| `client/src/pages/SpreadDashboard.tsx` — `ScatterView` e `BarView` | Componentes definidos no mesmo arquivo mas nunca exportados | Mover para `client/src/components/charts/` |
| `server/services/spreadCalculatorService.ts` — comentário sobre funções removidas | Comentário órfão de código removido | Limpar comentário |
| `client/src/components/AIChatBox.tsx`, `Map.tsx` | Componentes importados pelo template mas não usados no projeto | Manter (são do template), mas não importar em páginas |
| `SpreadDashboard.tsx` — `universoData` e `highScoreData` | Código morto após refatoração | Já removidos nesta sessão |
| `server/services/syncService.ts` — múltiplos `console.log` de debug | Logs de debug em produção | Converter para logging estruturado ou remover |

**Top 3 ações prioritárias:**
1. Remover imports `between` e `gte` do `db.ts` (agora substituídos por `sql`).
2. Extrair `ScatterView`, `BarView`, `AnaliseView`, `TableView` e `DadosView` do `SpreadDashboard.tsx` para arquivos separados.
3. Converter `console.log` do `syncService.ts` para logging estruturado (ou condicional em `NODE_ENV !== 'production'`).

---

## FRENTE 3 — Eficiência e Coesão do Código

**Sumário:** A arquitetura geral é sólida. O principal problema de eficiência é o `SpreadDashboard.tsx` como monólito (2.430 linhas, 5+ componentes, 15+ hooks). O cache in-memory de `getLatestDataReferencia` (TTL 60s) é uma boa prática. A duplicação de `RATING_ORDER` entre frontend e backend é o problema de coesão mais relevante.

| Prioridade | Descrição | Refatoração sugerida |
|---|---|---|
| **Alta** | `SpreadDashboard.tsx` com 2.430 linhas — viola Single Responsibility, dificulta manutenção e testes | Extrair cada view (`ScatterView`, `BarView`, `AnaliseView`, `TableView`, `DadosView`) para `client/src/components/charts/` |
| **Alta** | `RATING_ORDER` duplicado em `client/src/lib/ratings.ts` e `server/services/spreadCalculatorService.ts` | Mover para `shared/ratings.ts` e importar dos dois lados |
| **Alta** | Duas queries `getAnalysis` por render (`analysisQuery` + `outlierCountQuery`) — dobra a carga no banco | Consolidar em uma única query que retorna `{ data, outlierCount }`, ou usar `staleTime` para evitar refetch desnecessário |
| **Média** | `byRatingData` calculado no frontend a partir de `analysisData` — duplica lógica já existente em `getZspreadByRating` no backend | Usar `trpc.spread.getZspreadByRating` diretamente (já existe e é mais eficiente) |
| **Média** | `calcPricing` (calculadora de spread esperado) definida inline no `SpreadDashboard.tsx` | Extrair para `client/src/lib/pricing.ts` e testar com Vitest |
| **Média** | `getSpreadAnalysis` sem paginação — retorna todos os registros da data mais recente | Adicionar `limit` opcional (padrão 500) para proteger contra crescimento de dados |
| **Baixa** | `fileToBase64` definida no componente React — lógica de negócio no frontend | Mover para `client/src/lib/fileUtils.ts` |
| **Baixa** | `isOutlierTrue` definida inline no componente — usada em dois lugares | Extrair para `shared/utils.ts` |

**Top 3 ações prioritárias:**
1. Consolidar as duas queries `getAnalysis` em uma única, retornando `{ rows, outlierCount }` para reduzir carga no banco.
2. Mover `RATING_ORDER` para `shared/ratings.ts` para eliminar duplicação entre frontend e backend.
3. Decompor `SpreadDashboard.tsx` em arquivos menores (meta: < 400 linhas por arquivo).

---

## FRENTE 4 — Organização e Saúde do Banco de Dados

**Sumário:** O schema é bem normalizado para o domínio. Os índices cobrem os padrões de acesso mais comuns. O principal problema é a ausência de um índice composto em `(dataReferencia, indexador)` que é o padrão de acesso mais frequente da aplicação.

| Tabela/Coluna | Problema | Impacto estimado | Correção recomendada |
|---|---|---|---|
| `spread_analysis` — ausência de índice `(dataReferencia, indexador)` | Toda query de análise filtra por `dataReferencia` E `indexador`; sem índice composto, o banco faz full scan no índice de `dataReferencia` | **Alto** com crescimento de dados | `CREATE INDEX idx_spread_data_indexador ON spread_analysis(dataReferencia, indexador)` |
| `spread_analysis.scoreMatch` — tipo `DECIMAL(5,4)` comparado como string | Comparação `gte(scoreMatch, String(0.80))` é lexicográfica; corrigido nesta sessão com CAST | **Médio** — pode filtrar incorretamente em edge cases | ✅ Corrigido: `CAST(scoreMatch AS DECIMAL(5,4)) >= 0.80` |
| `spread_analysis.dataReferencia` — tipo `VARCHAR(16)` | Datas armazenadas como string (`"20/03/2026"`); comparação lexicográfica funciona apenas para formato `DD/MM/YYYY` se os anos forem iguais | **Médio** — pode ordenar incorretamente entre anos | Migrar para `DATE` ou usar formato `YYYY-MM-DD` |
| `spread_analysis` — sem soft delete | Hard delete implícito; dados históricos de ativos removidos são perdidos | **Baixo** para o uso atual | Avaliar se histórico de ativos é necessário |
| `historical_snapshots` — sem índice em `(indexador, snapshotAt)` | Queries de histórico filtram por indexador e ordenam por data | **Médio** com crescimento | Adicionar `INDEX idx_snapshot_indexador_at ON historical_snapshots(indexador, snapshotAt)` |
| `sync_log.alertas` — tipo `JSON` | Dados de alertas em JSON sem validação de schema | **Baixo** | Documentar schema esperado do JSON |

**Top 3 ações prioritárias:**
1. Adicionar índice composto `(dataReferencia, indexador)` na `spread_analysis` — maior ganho de performance.
2. Migrar `dataReferencia` de `VARCHAR` para `DATE` ou padronizar para `YYYY-MM-DD`.
3. Adicionar índice `(indexador, snapshotAt)` na `historical_snapshots`.

---

## FRENTE 5 — Segurança e Exposição de Dados

**Sumário:** Não há segredos hardcoded. As variáveis de ambiente são gerenciadas pela plataforma. O principal risco é a ausência de limite de tamanho nos arquivos base64 enviados ao `triggerSync`, que pode causar DoS por memória.

| Vulnerabilidade | Severidade | Vetor de ataque | Correção |
|---|---|---|---|
| `triggerSync` sem validação de tamanho de arquivo | **Alta** | Upload de arquivo base64 de vários GB pode esgotar memória do servidor | Adicionar `z.string().max(50_000_000)` (≈37MB base64 ≈ 27MB arquivo) no schema Zod |
| `fast-xml-parser` vulnerabilidade crítica (CVE via `@aws-sdk/client-s3`) | **Crítica** (dependência transitiva) | Entity encoding bypass via regex injection em DOCTYPE | Atualizar `@aws-sdk/client-s3` para versão que usa `fast-xml-parser >= 5.3.5` |
| Endpoints de leitura (`getAnalysis`, `getFilterOptions`, etc.) sem autenticação | **Média** | Dados financeiros acessíveis publicamente sem login | Avaliar se dados são públicos; se não, migrar para `protectedProcedure` |
| `console.log` com dados de negócio no `syncService.ts` | **Baixa** | Logs podem expor dados de spreads em sistemas de log centralizados | Remover ou tornar condicional em produção |
| Token ANBIMA cacheado em memória (`cachedToken` em `anbimaAuth.ts`) | **Baixa** | Em caso de leak de memória, token pode ser exposto | Aceitável para o contexto; documentar comportamento |

**Top 3 ações prioritárias:**
1. Adicionar limite de tamanho no schema Zod do `triggerSync` (proteção contra DoS).
2. Atualizar `@aws-sdk/client-s3` para corrigir a vulnerabilidade crítica do `fast-xml-parser`.
3. Definir explicitamente quais endpoints são públicos vs. protegidos (documentar decisão).

---

## FRENTE 6 — Resiliência, Observabilidade e Operabilidade

**Sumário:** O sistema tem boa resiliência básica (retry na ANBIMA Data API, guard de sync duplicado, fallback quando banco indisponível). A observabilidade é limitada a `console.log` sem estrutura. Não há health check endpoint.

| Cenário de falha | Comportamento atual | Comportamento esperado | Correção sugerida |
|---|---|---|---|
| Banco de dados indisponível | Retorna arrays vazios com `console.warn` | ✅ Aceitável | Adicionar health check endpoint `/api/health` |
| API ANBIMA indisponível durante sync | Retry com 3 tentativas + `console.warn` | ✅ Aceitável | Expor falha no `syncLog.alertas` |
| Dois syncs simultâneos (multi-instância) | Guard in-memory (`currentSyncStatus === "running"`) | Falha silenciosa em multi-instância | Lock no banco: `INSERT INTO sync_lock ... ON DUPLICATE KEY UPDATE` |
| Arquivo XLSX malformado enviado | `Buffer.from(base64)` pode gerar buffer inválido; erro não tratado explicitamente | Erro capturado pelo `.catch()` e logado | Adicionar validação do magic bytes do XLSX antes de processar |
| `getLatestDataReferencia` retorna null (banco vazio) | Retorna todos os registros sem filtro de data | ✅ Aceitável para banco vazio | — |
| Timeout em chamadas à ANBIMA Feed API | Sem timeout explícito definido | Timeout de 30s | Adicionar `signal: AbortSignal.timeout(30_000)` nas chamadas fetch |

**Top 3 ações prioritárias:**
1. Adicionar endpoint `/api/health` que verifica conectividade com banco e retorna status JSON.
2. Adicionar timeout explícito (30s) nas chamadas à ANBIMA Feed API.
3. Validar magic bytes do arquivo XLSX antes de processar (evitar crash com arquivos malformados).

---

## FRENTE 7 — Qualidade dos Contratos e Validação de Dados

**Sumário:** Os contratos tRPC são bem definidos com Zod. O principal problema é a inconsistência de tipos entre banco (DECIMAL como string) e frontend (Number). A conversão é feita no router, mas de forma manual e sem garantia de cobertura total.

| Contrato/Camada | Problema de consistência | Risco | Correção |
|---|---|---|---|
| `spreadAnalysis.zspread` — DECIMAL no banco, convertido para `Number` no router | Conversão manual em `getAnalysis`: `zspread: row.zspread ? Number(row.zspread) : null` | Se `zspread = 0`, a conversão retorna `null` (falsy check incorreto) | Usar `row.zspread !== null ? Number(row.zspread) : null` |
| `spreadAnalysis.durationAnos` — mesmo problema | `durationAnos: row.durationAnos ? Number(row.durationAnos) : null` | Duration = 0 seria tratado como null | Usar `row.durationAnos !== null ? Number(row.durationAnos) : null` |
| `scoreMatch` — DECIMAL(5,4) comparado como string | Corrigido nesta sessão com CAST SQL | — | ✅ Corrigido |
| `isOutlier` — boolean no schema, pode chegar como `0/1` do banco | Normalização `val === true \|\| val === 1` no frontend | Inconsistência silenciosa | Normalizar no router antes de retornar ao cliente |
| `dataReferencia` — VARCHAR no banco, string no frontend | Formato `DD/MM/YYYY` assumido sem validação | Dados com formato diferente quebram a ordenação | Validar formato ao inserir |
| Zod schema do `triggerSync` sem limite de tamanho | `z.string()` sem `.max()` | DoS por arquivo grande | `z.string().max(50_000_000)` |

**Top 3 ações prioritárias:**
1. Corrigir conversão falsy de `zspread` e `durationAnos` (usar `!== null` em vez de `? Number : null`).
2. Normalizar `isOutlier` no router (não no frontend) para garantir tipo consistente.
3. Adicionar `.max()` no Zod schema do `triggerSync`.

---

## FRENTE 8 — Gestão de Dependências e Saúde do Ecossistema

**Sumário:** 41 vulnerabilidades encontradas pelo `pnpm audit` (1 crítica, 19 altas, 18 moderadas, 3 baixas). A maioria são dependências transitivas do template. A vulnerabilidade crítica é no `fast-xml-parser` via `@aws-sdk/client-s3`.

| Dependência/Módulo | Problema | Impacto | Ação recomendada |
|---|---|---|---|
| `fast-xml-parser < 5.3.5` (via `@aws-sdk/client-s3`) | CVE: entity encoding bypass via regex injection | **Crítico** | `pnpm update @aws-sdk/client-s3` para versão com `fast-xml-parser >= 5.3.5` |
| `picomatch < 4.0.4` (via `@builder.io/vite-plugin-jsx-loc`) | Vulnerabilidade de alta severidade | **Alto** (dev only) | Atualizar `@builder.io/vite-plugin-jsx-loc` ou aguardar patch |
| `xlsx` (SheetJS) | Biblioteca pesada para parsing de XLSX; versão Community Edition tem limitações | **Médio** | Avaliar substituição por `exceljs` (mais leve e mantida) |
| `recharts` + `recharts` no frontend | Biblioteca de gráficos pesada (~500KB) | **Baixo** | Considerar `lightweight-charts` para gráficos financeiros |
| Duplicação `client/src/lib/ratings.ts` e `server/services/spreadCalculatorService.ts` | Mesma lógica em dois lugares | **Médio** | Mover para `shared/ratings.ts` |

**Top 3 ações prioritárias:**
1. `pnpm update @aws-sdk/client-s3` para corrigir vulnerabilidade crítica.
2. Mover `RATING_ORDER` para `shared/ratings.ts` para eliminar duplicação.
3. Avaliar substituição de `xlsx` por `exceljs` (melhor manutenção e licença mais clara).

---

## FRENTE 9 — Experiência do Desenvolvedor e Manutenibilidade

**Sumário:** O projeto tem boa estrutura de pastas e scripts de automação. O principal problema de manutenibilidade é o `SpreadDashboard.tsx` monolítico e a ausência de testes para a lógica de frontend (calculadora de pricing, `calcPricing`).

| Área | Problema de manutenibilidade | Impacto no longo prazo | Sugestão |
|---|---|---|---|
| `SpreadDashboard.tsx` (2.430 linhas) | Arquivo impossível de navegar; qualquer mudança requer leitura de contexto extenso | **Alto** | Decompor em arquivos < 400 linhas |
| `calcPricing` sem testes | Lógica de negócio crítica (pricing de crédito) sem cobertura | **Alto** | Adicionar testes Vitest em `client/src/lib/pricing.test.ts` |
| `syncService.ts` (750+ linhas) | Serviço monolítico com múltiplas responsabilidades | **Médio** | Separar em `matchingService.ts`, `outlierService.ts`, `snapshotService.ts` |
| Ausência de testes de integração | Apenas testes unitários; fluxo completo de sync não testado | **Médio** | Adicionar teste de integração com banco em memória |
| `TODO` em `server/db.ts:92` | Comentário placeholder do template | **Baixo** | Remover ou substituir por comentário relevante |
| Ausência de README do projeto | README é do template, não do projeto | **Médio** | Criar `README.md` com instruções de setup, variáveis de ambiente e fluxo de dados |

**Top 3 ações prioritárias:**
1. Extrair `calcPricing` para `client/src/lib/pricing.ts` e cobrir com Vitest.
2. Decompor `SpreadDashboard.tsx` em componentes menores.
3. Criar `README.md` do projeto com fluxo de dados e instruções de setup.

---

## Plano de Ação Consolidado

Ordenado por **Impacto × Esforço** (prioridade: Alto Impacto + Baixo Esforço primeiro):

| # | Ação | Impacto | Esforço | Frente |
|---|---|---|---|---|
| 1 | ✅ Corrigir bug do filtro de outliers (universo não passado ao backend) | Alto | Baixo | F1 |
| 2 | ✅ Corrigir `scoreMin` comparação string vs decimal (CAST SQL) | Alto | Baixo | F4/F7 |
| 3 | Corrigir conversão falsy de `zspread` e `durationAnos` (`!== null`) | Alto | Baixo | F7 |
| 4 | Adicionar limite de tamanho no `triggerSync` (Zod `.max()`) | Alto | Baixo | F5/F7 |
| 5 | `pnpm update @aws-sdk/client-s3` (vulnerabilidade crítica) | Alto | Baixo | F8 |
| 6 | Adicionar índice `(dataReferencia, indexador)` na `spread_analysis` | Alto | Baixo | F4 |
| 7 | Normalizar `isOutlier` no router (não no frontend) | Médio | Baixo | F7 |
| 8 | Consolidar duas queries `getAnalysis` em uma | Médio | Médio | F3 |
| 9 | Mover `RATING_ORDER` para `shared/ratings.ts` | Médio | Baixo | F3/F8 |
| 10 | Extrair `calcPricing` para `client/src/lib/pricing.ts` + testes Vitest | Alto | Médio | F9 |
| 11 | Adicionar endpoint `/api/health` | Médio | Baixo | F6 |
| 12 | Decompor `SpreadDashboard.tsx` em arquivos menores | Alto | Alto | F9 |
| 13 | Migrar `dataReferencia` de `VARCHAR` para `DATE` | Médio | Médio | F4 |
| 14 | Adicionar timeout nas chamadas ANBIMA Feed API | Médio | Baixo | F6 |
| 15 | Criar `README.md` do projeto | Baixo | Baixo | F9 |

---

## Scorecard Final

| Frente | Nota | Justificativa |
|---|---|---|
| F1 — Sanidade Funcional | **7/10** | Funcionalidades principais ok; bug crítico de outliers corrigido; endpoints sem autenticação |
| F2 — Código Morto | **8/10** | Poucos imports não usados; maior problema é o monólito |
| F3 — Eficiência e Coesão | **6/10** | Duas queries duplicadas; `byRatingData` recalculado no frontend; monólito de 2.430 linhas |
| F4 — Banco de Dados | **7/10** | Schema bem normalizado; índices básicos presentes; falta índice composto crítico; `dataReferencia` como VARCHAR |
| F5 — Segurança | **6/10** | Sem segredos hardcoded; vulnerabilidade crítica em dependência transitiva; sem limite de tamanho no upload |
| F6 — Resiliência | **7/10** | Retry na ANBIMA; fallback no banco; sem timeout explícito; sem health check |
| F7 — Contratos e Validação | **7/10** | Zod bem usado; conversão falsy de decimais é bug silencioso; `isOutlier` normalizado no frontend |
| F8 — Dependências | **5/10** | 41 vulnerabilidades (1 crítica); duplicação de lógica entre frontend/backend |
| F9 — Manutenibilidade | **6/10** | Boa estrutura de pastas; monólito crítico; sem testes de `calcPricing`; sem README do projeto |
| **Geral** | **6.6/10** | Projeto funcional com boa arquitetura base; principais débitos são o monólito, as vulnerabilidades de dependências e a ausência de testes para lógica de negócio crítica |
