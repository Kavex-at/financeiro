---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-19-1603
agent: qa-modifiability
generated_at: 2026-08-19T16:35:00-03:00
scope: backend + frontend
score: 7
findings_count: 9
cards_count: 8
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time da Columbia (após PV-01 fechar) | Definir `ftbVldStatus = 7` como `CONCLUIDA` (ou `REJEITADA`) para os 13 casos vistos em produção | `ETAPA_STATUS_ERP` map em `src/backend/domain/interface/aprovacoes/constants.ts` | Frente V em runtime (job + painel) | Editar UMA linha do map; todos os títulos com etapa `INDETERMINADO+7` são reclassificáveis por migration/reingestão sem tocar em service/UI | ≤ 1 arquivo modificado, 0 novos arquivos, 0 mudanças em testes de contrato (StatusWorkflowResolver, DuracaoCalculator, UI) |
| PO (após PV-04/PV-07 fecharem) | Passar a mostrar `docDtaFinalizacao` como marco zero do relógio | `IngestaoAprovacoesService.processarTitulo` + `DuracaoCalculator.calcularTempoTotalSegundos` + `TrilhaDrawer.MarcoZero` | Painel em produção, ingestão diária rodando | Adicionar 1 campo no `DocPagarRow` do gateway; passar `dataFinalizacao` no `titulo`; remover a lacuna `SEM_DATA_FINALIZACAO` quando presente | ≤ 4 arquivos backend + ≤ 2 frontend; regra de "não estimar" preservada; tempo médio recalculável por migration |
| Ops (ADR-0038 hoje libera Frente V só fora de prod) | Ligar/desligar a Frente V em produção sem redeploy | Env `APROVACOES_ENABLED` + `aprovacoesGate` no Express | Runtime em Render | Mudar a variável no dashboard e reiniciar processo (~30s) — nenhum código toca a bandeira | Tempo de "flip" < 5 min; 0 commits necessários |

## 2. Métricas observadas

### 2.1 Métricas principais

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC do maior arquivo do delta Frente V (frontend) | `page.tsx` = 632 | ≤ 400 (p95 do delta) | ❌ | `wc -l src/frontend/app/aprovacoes/page.tsx` |
| LOC do segundo maior (frontend) | `TrilhaDrawer.tsx` = 540 | ≤ 400 | ❌ | `wc -l …/TrilhaDrawer.tsx` |
| LOC do maior serviço backend Frente V | `AprovacoesPainelService.ts` = 340 | ≤ 400 (p95 backend) | ✅ | `wc -l …/AprovacoesPainelService.ts` |
| LOC do `lib/aprovacoes.ts` (contrato + fetch + tipos) | 345 | ≤ 300 (só o contrato justifica) | ⚠️ | `wc -l src/frontend/lib/aprovacoes.ts` |
| LOC do job de ingestão | `ingest-aprovacoes.ts` = 106 | ≤ 150 | ✅ | `wc -l …/jobs/ingest-aprovacoes.ts` |
| LOC de `probe-aprovacoes-fin026.ts` | 532 | não aplicável (probe/sonda descartável) | ⚠️ | `wc -l …/jobs/probe-aprovacoes-fin026.ts` |
| Distribuição LOC backend (`src/backend`, sem testes) | p50 = 33 · p95 = 375 · max = 2415 · n = 595 | p50 ≤ 150 · p95 ≤ 400 · max ≤ 600 | ⚠️ (max estoura ~4×; herança pré-Frente V) | `find src/backend -name '*.ts' -not -name '*.test.ts'` (fora de node_modules) |
| Distribuição LOC frontend (`src/frontend`, `.tsx`, sem testes) | p50 = 100 · p95 = 758 · max = 1041 · n = 78 | p50 ≤ 150 · p95 ≤ 400 · max ≤ 600 | ❌ | `find src/frontend -name '*.tsx'` |
| Cognitive complexity `IngestaoAprovacoesService.executar` | **33** (limite Biome: 15) | ≤ 15 | ❌ | `npx biome check` em `IngestaoAprovacoesService.ts` |
| Cognitive complexity `TituloAprovacaoRepository.mapRow` | **16** | ≤ 15 | ❌ | `npx biome check` em `TituloAprovacaoRepository.ts` |
| Total de warnings `noExcessiveCognitiveComplexity` no backend inteiro | 1 (`ConexosCadastroClient.ts:120`) — os 2 do delta são suprimidos pelo `overrides` de Frente V | ≤ 1 (nível repositório) | ⚠️ | `cd src/backend && npx biome check 2>&1 \| grep noExcessiveCognitiveComplexity` |
| Cognitive complexity frontend Frente V | ⚠️ **Não medível**: frontend usa `eslint`, não Biome (`src/frontend/package.json` linta com `eslint .`) | — | ⚠️ | `cat src/frontend/package.json` |
| Duplicação de tipos backend↔frontend (Frente V) | 100% do superfície do contrato: `StatusWorkflow` (5 valores), `EtapaStatus` (4), `Lacuna` (5), `LACUNA_DESCRICAO` (5 strings), `AprovacaoListItem` (~17 campos), `EtapaTrilha` (~13), `TrilhaResponse`, `AprovacoesFiltros`. Nenhum é importado do backend | 0 réplica de vocabulário (só DTO) OU réplica gerada por script | ❌ | `diff <(grep -E "^export (type\|interface\|const)" src/backend/domain/interface/aprovacoes/constants.ts) <(grep -E "^export (type\|interface\|const)" src/frontend/lib/aprovacoes.ts)` |
| Fan-out do maior arquivo do delta (`page.tsx`) | 17 imports | ≤ 15 | ⚠️ | `grep -c "^import " src/frontend/app/aprovacoes/page.tsx` |
| Fan-out do `IngestaoAprovacoesService.ts` | 10 imports | ≤ 15 | ✅ | idem |
| Fan-in do `constants.ts` (o "único ponto de tradução do `ftbVldStatus`") | 16 arquivos (2 code, o resto testes) | — (constants por natureza têm fan-in alto — o *que importa* é que a promessa de single-point-of-change se mantém: só o `EtapaStatusResolver` LÊ o map; o `IngestaoAprovacoesService` só PRESERVA o número bruto; o frontend só EXIBE o valor cru) | ✅ | `grep -rln "from.*aprovacoes/constants" src/backend src/frontend` |
| Fan-in dos serviços do delta | Painel=1 (rota), Ingestao=1 (job), Etapa/StatusWorkflow=1 (Ingestao), Duracao=2 (Ingestao + Painel) | fan-in coerente com propósito | ✅ | `grep -rl "from '.*aprovacoes/<Nome>" src` |
| Layer-skipping no delta | **1 violação**: `src/backend/routes/aprovacoes.ts:6` importa `ConexosCadastroClient` (Client) direto — rota → client, pulando Service. Mesmo padrão herdado da Frente IV; fallback de listagem de filiais quando o JWT não carrega a claim | 0 | ⚠️ | `grep -n "from.*client/" src/backend/routes/aprovacoes.ts` |
| Magic numbers em código de negócio (delta) | 6 constantes com valor cru: `PAGE_SIZE=500` e `MAX_PAGINAS=200` (`IngestaoAprovacoesService`); `DOZE_MESES_MS = 365*24*60*60*1000` (`ingest-aprovacoes.ts`); `APROVACOES_INGEST_LOCK_KEY = 918273649` (constants); `PAGE_SIZE=25` e `BUSCA_DEBOUNCE_MS=300` (`page.tsx`); `PAGE_SIZE_MAX=100`, `PAGE_SIZE_PADRAO=25` (route) — 8 no total. As 3 primeiras são regras de negócio (janela de backfill, ritmo da varredura); as demais são convenções de UI/API | Janela e ritmo de backfill externalizados no `EnvironmentProvider`; UI/API magic numbers acesos com nome (aceitável) | ⚠️ | `grep -rEn "const [A-Za-z_]+ = [0-9]{2,}" src/backend/domain/service/aprovacoes src/backend/jobs/ingest-aprovacoes.ts src/frontend/app/aprovacoes` |
| Cobertura ontológica Frente V (`_coverage.json` v0.20.0) | Entidades: 2/2 `implemented` (`TituloAprovacao`, `EtapaAprovacao`); Actions: 3/3 `implemented`; Business rules: 3/3 com teste canônico; State machines: 2/2 `implemented`; Integração: `conexos-aprovacao-trilha` implemented | 100% delta indexado | ✅ | `grep -n "aprovacao\|Aprovacao" ontology/_coverage.json` |
| Drift ontologia↔código Frente V | 3 entradas abertas em `ontology/_watchlist.md`: (a) nomes de tabela `titulo_aprovacao`/`etapa_aprovacao` (texto) vs `aprovacao_titulo`/`aprovacao_etapa` (migration 0049); (b) `state-machines/etapa-aprovacao.md` descreve regra de status por comparação de timestamps, mas o `EtapaStatusResolver` decide pela ação (`LIBERAR`/`APROVAR`); (c) exclusão mútua da ingestão vive no JOB (`withAdvisoryLock`), não no `IngestaoAprovacoesService` | 0 | ⚠️ | `head -530 ontology/_coverage.json` (seção `_watchlist`) |
| Defer-binding runtime (feature flag Frente V) | `APROVACOES_ENABLED` env, fail-safe: default `true` fora de prod, `false` em prod; `APROVACOES_ENABLED=true` explícito em prod libera. Kill-switch sem redeploy | flip < 5 min | ✅ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:60-79` |
| Defer-binding do gateway do ERP | Port `TrilhaAprovacaoGatewayInterface` (Symbol token) tem 1 implementação hoje (`ConexosAprovacoesClient`, `psq014+fin026`, N chamadas por título). Quando PV-07 liberar `fin103`, é uma implementação nova + 1 linha em `aprovacoesContainer.ts` | port sem escrita + swap por container | ✅ | `src/backend/domain/aprovacoesContainer.ts:24-33`, `src/backend/domain/interface/aprovacoes/ports.ts:23-57` |
| Superfície do port do gateway (escrita inexpressável) | 2 métodos, ambos `list*`. Escrita (`trocaBloqueio`, `regerarBloqueios`, `aplicarComando`) NÃO cabe no tipo — mudar a Frente V para escrever exige mudar o *contrato* do port, não só a implementação | 0 métodos de escrita | ✅ | `src/backend/domain/interface/aprovacoes/ports.ts:34-57` |

### 2.2 Apêndice A — Top-10 maiores arquivos do delta Frente V

| # | Path | LOC | Camada | Observação |
|---|---|---:|---|---|
| 1 | `src/frontend/app/aprovacoes/page.tsx` | 632 | UI (Client Component) | ❌ Split Module: KPIs, filtros, tabela, drawer, adaptador `TabelaFiltro` num único arquivo |
| 2 | `src/backend/jobs/probe-aprovacoes-fin026.ts` | 532 | Sonda descartável | Ignorar: probe read-only, produto de investigação (não roda em prod); tratamento futuro = mover para `scripts/` |
| 3 | `src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx` | 540 | UI (Dialog) | ❌ Split Module: `EtapaItem`, `MarcoZero`, `TempoDaEtapa`, `LacunasBloco`, `CabecalhoTitulo`, `TrilhaSkeleton`, o próprio `TrilhaDrawer` — 7 componentes num único arquivo |
| 4 | `src/frontend/lib/aprovacoes.ts` | 345 | Contrato + fetch client | ⚠️ 100% do contrato TS espelhado do backend (sem geração) + 1 dicionário `LACUNA_DESCRICAO` duplicado |
| 5 | `src/backend/jobs/probe-aprovacoes-trilha.ts` | 347 | Sonda descartável | idem #2 |
| 6 | `src/backend/domain/service/aprovacoes/AprovacoesPainelService.ts` | 340 | Service | ✅ Dentro do p95 backend (375); coesão alta (só READ) |
| 7 | `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts` | 267 | Service | ❌ `executar` com cognitive complexity 33 (loop aninhado + retomada + cursor) → Split Module |
| 8 | `src/frontend/app/aprovacoes/components/status-badges.tsx` | 232 | UI | ✅ Alta coesão |
| 9 | `src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts` | 211 | Repository | ⚠️ `mapRow` com cognitive 16; SQL de `list` é `WHERE`-composto (aceitável) |
| 10 | `src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts` | 187 | Repository | ✅ |

### 2.3 Apêndice B — Top-10 símbolos por fan-in dentro do delta Frente V

| # | Símbolo | Arquivo | Fan-in (dentro do delta) | Papel |
|---|---|---|---:|---|
| 1 | `constants.ts` (STATUS_WORKFLOW, ETAPA_STATUS, ETAPA_STATUS_ERP, LACUNA, LACUNA_DESCRICAO, ACAO_CONCLUSIVA, ACAO_REJEICAO, DOC_TIP, APROVACOES_INGEST_LOCK_KEY) | `src/backend/domain/interface/aprovacoes/constants.ts` | 16 (5 impl + 11 testes/rota/job/etc.) | Vocabulário compartilhado. **Se este arquivo mudar, muda muita coisa — mas a promessa é que só *adicionar* linhas ao `ETAPA_STATUS_ERP` já resolve PV-01.** |
| 2 | `ports.ts` (tokens + interfaces) | `src/backend/domain/interface/aprovacoes/ports.ts` | 8 | Seam entre camadas |
| 3 | `EtapaAprovacao.ts` (interface + `FinTituloBloqRow`) | `src/backend/domain/interface/aprovacoes/EtapaAprovacao.ts` | 6 | Modelo |
| 4 | `TituloAprovacao.ts` (interface + `DocPagarRow` + `AprovacaoIngestaoRun`) | `src/backend/domain/interface/aprovacoes/TituloAprovacao.ts` | 5 | Modelo |
| 5 | `DuracaoCalculator` | `src/backend/domain/service/aprovacoes/DuracaoCalculator.ts` | 2 (Ingestao + Painel) | Regra de duração — a única com uso cruzado entre serviços |
| 6 | `AprovacoesPainelService` | `src/backend/domain/service/aprovacoes/AprovacoesPainelService.ts` | 1 (rota) | Único caller: rota |
| 7 | `IngestaoAprovacoesService` | `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts` | 1 (job) | Único caller: job |
| 8 | `EtapaStatusResolver` | `src/backend/domain/service/aprovacoes/EtapaStatusResolver.ts` | 1 (Ingestao) | Único caller |
| 9 | `StatusWorkflowResolver` | `src/backend/domain/service/aprovacoes/StatusWorkflowResolver.ts` | 1 (Ingestao) | Único caller |
| 10 | `descreverLacuna` + `formatDuracaoSegundos` + `AprovacaoListItem` (contrato TS do frontend) | `src/frontend/lib/aprovacoes.ts` | 3 (page, TrilhaDrawer, status-badges) | Contrato replicado |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Aplicado bem no backend (5 serviços pequenos com uma responsabilidade cada); NÃO aplicado no frontend do delta (`page.tsx` 632 LOC, `TrilhaDrawer.tsx` 540 LOC, cada um com 4-7 componentes/funções internos). `IngestaoAprovacoesService.executar` (33 de cognitive) é candidato natural a subdividir | ⚠️ parcial | `wc -l src/frontend/app/aprovacoes/page.tsx`; `wc -l …/TrilhaDrawer.tsx`; biome em `IngestaoAprovacoesService.ts:75` |
| **Increase Semantic Coherence** | Excelente no backend: `EtapaStatusResolver` só decide status; `StatusWorkflowResolver` só agrega; `DuracaoCalculator` só calcula 3 durações; `AprovacoesPainelService` só lê; `IngestaoAprovacoesService` só ingere. Cada um usa ≤ 1 entidade nova como resultado. No frontend, `page.tsx` mistura orquestração de estado, KPIs, filtros, tabela e wrapper do drawer | ✅ (backend) / ⚠️ (frontend) | `src/backend/domain/service/aprovacoes/*.ts`; `page.tsx:119-632` |
| **Encapsulate** | Constants no `interface/aprovacoes/constants.ts` são o único *ponto de tradução* do `ftbVldStatus` — a promessa é encapsulamento de segredo do ERP. Verificado por grep: só `EtapaStatusResolver.ts:43` lê o map; `IngestaoAprovacoesService.ts:248` só copia `linha.ftbVldStatus` para `statusErp` (número bruto); frontend só exibe o cru (`TrilhaDrawer.tsx:244`, `status-badges.tsx:95`). **PV-01 realmente é uma edição em uma linha** | ✅ | `grep -rn "ETAPA_STATUS_ERP" src/backend`; `grep -rn "ftbVldStatus\|statusErp" src` |
| **Use an Intermediary** | `TrilhaAprovacaoGatewayInterface` (Symbol token) é intermediário entre `IngestaoAprovacoesService` e `ConexosAprovacoesClient`. Substitui-se a implementação inteira sem tocar o serviço — exatamente o cenário PV-07 (troca de `psq014+fin026` por `fin103` massivo). `PostgreeDatabaseClient` idem no lado do banco | ✅ | `src/backend/domain/interface/aprovacoes/ports.ts:34-57`; `src/backend/domain/aprovacoesContainer.ts` |
| **Restrict Dependencies** | Regra do CLAUDE.md (Lambda→Service→Repository→Client) *quase* seguida no delta: **1 violação** em `routes/aprovacoes.ts:6` (rota importa `ConexosCadastroClient` direto para o fallback de listagem de filiais). Herdado do padrão da Frente IV — não é falha nova, mas cimenta o débito | ⚠️ parcial | `grep -n "from.*client/" src/backend/routes/aprovacoes.ts` |
| **Refactor** | 2 refactors óbvios pendentes: (a) `IngestaoAprovacoesService.executar` (cognitive 33) → extrair `processarFilial(filCod, retomada)` e `processarPagina(rows, filCod, pagina, runId)`; (b) `TituloAprovacaoRepository.mapRow` (cognitive 16) → tabela de coerções em vez de 22 `?? undefined`/`Number()` inline | ⚠️ dívida documentada | biome em `IngestaoAprovacoesService.ts:75`, `TituloAprovacaoRepository.ts:186` |
| **Abstract Common Services** | `DuracaoCalculator` é o candidato canônico: usado em Ingestao E Painel, com 3 métodos que se tocariam se estivessem espalhados. `LACUNA_DESCRICAO` NÃO virou serviço comum (é duplicado no frontend); `descreverLacuna` no frontend reimplementa a lookup | ⚠️ parcial | `DuracaoCalculator.ts`; `src/frontend/lib/aprovacoes.ts:59-80` |
| **Defer Binding** | Feature flag `APROVACOES_ENABLED` (runtime, fail-safe em prod); DI por Symbol token para o gateway (troca de impl por container); `APROVACOES_BACKFILL_DESDE`, `FILS`, `RETOMAR` como env do job. **Faltando externalizar**: `PAGE_SIZE` (500), `MAX_PAGINAS` (200), `DOZE_MESES_MS` (365d) — estão como const no código; se o cliente quiser um backfill de 24 meses, hoje é edit de código + redeploy | ⚠️ parcial | `EnvironmentProvider.ts:74-79`; `IngestaoAprovacoesService.ts:25-28`; `ingest-aprovacoes.ts:35` |

## 4. Findings (achados)

### F-modifiability-1: `IngestaoAprovacoesService.executar` estoura 2× o teto de cognitive complexity

- **Severidade**: P1
- **Tactic violada**: Refactor / Split Module
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:75-140`
- **Evidência (objetiva)**:
  ```
  domain\service\aprovacoes\IngestaoAprovacoesService.ts:75:82 lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 33 detected (max: 15).
  ```
- **Impacto técnico**: A função tem loop-de-loop com continuação da retomada, escrita do cursor no meio e try/catch abraçando o corpo. Toda mudança em regra de retomada (PV-08: mudar janela; ou eventual PV-07: trocar per-título por bulk `fin103`) toca este bloco denso — risco alto de regressão em backfill de 23k títulos.
- **Impacto de negócio**: Um bug em retomada não repete um título — repete um dia de ingestão. Custa quota do ERP e retarda a estreia do painel em prod.
- **Métrica de baseline**: cognitive = 33 (limite Biome = 15); 65 linhas na função; 3 níveis de aninhamento de loop.

### F-modifiability-2: `page.tsx` e `TrilhaDrawer.tsx` violam Split Module

- **Severidade**: P1
- **Tactic violada**: Split Module
- **Localização**: `src/frontend/app/aprovacoes/page.tsx:1-632`, `src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx:1-540`
- **Evidência (objetiva)**:
  ```
  632 src/frontend/app/aprovacoes/page.tsx
  540 src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx
  ```
  `page.tsx` combina: `PainelSkeleton`, `EtapaAtualCelula`, hook `useTabelaFiltro`-alike inteiro, KPIs, filtros (busca + status chips + filial + fornecedor + duas datas), a tabela (13 colunas), a paginação e o wrapper do drawer.
  `TrilhaDrawer.tsx`: 7 componentes internos (`TempoDaEtapa`, `CampoEtapa`, `EtapaItem`, `MarcoZero`, `LacunasBloco`, `CabecalhoTitulo`, `TrilhaSkeleton`, e o próprio `TrilhaDrawer`).
- **Impacto técnico**: Frontend usa `eslint`, não Biome — o teto de cognitive não é *medido* aqui, mas 632 LOC num único Client Component com ~10 `useState`, 3 `useEffect`, 7 `useCallback` e 3 `useMemo` já força a re-render toda tela a cada tecla digitada no filtro de busca (mitigado por debounce, mas o custo mental de mudança está no arquivo).
- **Impacto de negócio**: Cada iteração de UI da Frente V (por exemplo, adicionar filtro por alçada quando PV-10 fechar, ou coluna de finalização quando PV-04 fechar) toca este mesmo arquivo. Tempo de PR e risco de conflito crescem linearmente.
- **Métrica de baseline**: `page.tsx` = 632 LOC (58% acima do p95 do frontend, 400); `TrilhaDrawer.tsx` = 540 LOC (35% acima).

### F-modifiability-3: Contrato TS 100% duplicado entre backend e frontend, sem geração

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services / Encapsulate
- **Localização**: `src/frontend/lib/aprovacoes.ts:26-192` vs `src/backend/domain/interface/aprovacoes/constants.ts` + `AprovacoesPainelService.ts:26-103`
- **Evidência (objetiva)**:
  - `StatusWorkflow` (5 strings) — replicado literal
  - `EtapaStatus` (4 strings) — replicado literal
  - `Lacuna` (5 códigos) — replicado literal
  - `LACUNA_DESCRICAO` (5 frases em pt-BR) — replicado literal
  - `AprovacaoListItem` (17 campos) — replicado com comentários próprios
  - `EtapaTrilha` (13 campos), `TrilhaResponse`, `AprovacoesListResponse`, `AprovacoesFiltros`, `EtapaAtualResumo` — todos replicados
  O próprio arquivo confirma: `// Códigos de lacuna — espelho um-a-um de LACUNA em backend/domain/interface/aprovacoes/constants.ts` (`lib/aprovacoes.ts:47-49`).
- **Impacto técnico**: A promessa de single-point-of-change do `constants.ts` só vale se PV-01 for uma mudança apenas de *mapa* (número → estado existente). Se PV-01 introduzir um estado novo (ex: `SUSPENSA`), o desenvolvedor tem de editar 2 uniões `EtapaStatus` (backend + frontend) e o dicionário `LACUNA_DESCRICAO` em ambos lados. O TypeScript não pega essa dessincronização — o frontend é *string-typed*.
- **Impacto de negócio**: Uma lacuna nova adicionada no backend e não replicada no frontend cai no fallback `descreverLacuna(codigo) ?? codigo` (`lib/aprovacoes.ts:79`): o analista vê o código bruto (`STATUS_ETAPA_DESCONHECIDO`) em vez da frase pt-BR. Isso é *by design* (o comentário explicita), mas o custo é retrabalho a cada nova lacuna.
- **Métrica de baseline**: 5 uniões de strings + 5 interfaces + 1 dicionário duplicados; 345 LOC no arquivo frontend, dos quais ~120 são só declarações de tipo/constante.

### F-modifiability-4: Janela de backfill, tamanho de página e teto de páginas hardcoded no serviço

- **Severidade**: P2
- **Tactic violada**: Defer Binding
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:25-28`; `src/backend/jobs/ingest-aprovacoes.ts:35`
- **Evidência (objetiva)**:
  ```
  IngestaoAprovacoesService.ts:25: const PAGE_SIZE = 500;
  IngestaoAprovacoesService.ts:28: const MAX_PAGINAS = 200;
  ingest-aprovacoes.ts:35: const DOZE_MESES_MS = 365 * 24 * 60 * 60 * 1000;
  ```
- **Impacto técnico**: `PAGE_SIZE * MAX_PAGINAS = 100.000` = teto silencioso de títulos por filial por run. Se uma filial excedeu 100k títulos em 12 meses e ninguém percebeu, os títulos mais antigos simplesmente não entram — sem erro. Mudar janela para 24 meses (cenário provável quando a Frente V for ampliada além de contas a pagar) é edit + redeploy.
- **Impacto de negócio**: O parâmetro que o cliente mais provavelmente vai querer mudar (janela) é o que exige mais atrito para mudar. `APROVACOES_BACKFILL_DESDE` no job já é override runtime — falta apenas o mesmo tratamento como default configurável.
- **Métrica de baseline**: 3 magic numbers de negócio no delta; 0 no `EnvironmentVars` do modelo.

### F-modifiability-5: Drift ontológico Frente V (3 entradas em `_watchlist.md`)

- **Severidade**: P2
- **Tactic violada**: Encapsulate (a ontologia é o encapsulamento do domínio; drift = capa vazando)
- **Localização**: `ontology/_coverage.json:518-522` (`_watchlist`)
- **Evidência (objetiva)**:
  - **Watch 1**: `entities/titulo-aprovacao.md`, `entities/etapa-aprovacao.md`, `business-rules/idempotencia-ingestao-aprovacao.md` e ADR-0038 D3 falam em `titulo_aprovacao`/`etapa_aprovacao`; a `migration 0049` criou `aprovacao_titulo`/`aprovacao_etapa`.
  - **Watch 2**: `state-machines/etapa-aprovacao.md` diz "`statusErp=2` → CONCLUIDA exige `agidoEm > recebidoEm`; senão PENDENTE"; o `EtapaStatusResolver.ts:56-77` decide pela AÇÃO (`LIBERAR`/`APROVAR`), não pela comparação de timestamps.
  - **Watch 3**: A exclusão mútua do backfill vive em `jobs/ingest-aprovacoes.ts:77` (`withAdvisoryLock`), não no `IngestaoAprovacoesService`; o contrato de teste da regra `idempotencia-ingestao-aprovacao` menciona "duas runs simultâneas falham" e não há teste desse cenário.
- **Impacto técnico**: A ontologia é a fonte que o `OntologyCurator` e o `PatternGuardian` consultam para saber "o que muda quando". Nomes trocados fazem o próximo `/feature-tweak` da Frente V ler o `.md` errado, escrever a migration errada, ou reimplementar a regra de status por timestamp.
- **Impacto de negócio**: Cada dia de drift multiplica o custo de onboarding e o risco de o próximo desenvolvedor "consertar" um `EtapaStatusResolver` para bater com o `.md` obsoleto.
- **Métrica de baseline**: 3 divergências abertas; 0 endereçadas neste run.

### F-modifiability-6: Rota `aprovacoes` importa Client (`ConexosCadastroClient`) — layer-skip legada

- **Severidade**: P3
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/routes/aprovacoes.ts:6, 43-46`
- **Evidência (objetiva)**:
  ```
  6: import ConexosCadastroClient from '../domain/client/ConexosCadastroClient.js';
  43: const cadastro = container.resolve(ConexosCadastroClient);
  44: const filiais = await cadastro.listFiliais();
  ```
- **Impacto técnico**: Padrão herdado da Frente IV (mesma fallback). Quando a claim `filiais` do JWT for provisionada (PV-09), o `resolverFilCodsAcessiveis` some — o layer-skip também. Enquanto isso, cada nova rota que copiar o padrão perpetua a violação.
- **Impacto de negócio**: Baixo hoje (é uma leitura idempotente); custo real aparece quando alguém confundir "rota pode chamar client" como convenção.
- **Métrica de baseline**: 1 import cross-layer no delta; 1 no gêmeo `routes/recebimentos.ts`.

### F-modifiability-7: `descreverLacuna` no frontend duplica lookup do backend com fallback silencioso

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/lib/aprovacoes.ts:78-80`
- **Evidência (objetiva)**:
  ```
  export function descreverLacuna(codigo: string): string {
    return LACUNA_DESCRICAO[codigo as Lacuna] ?? codigo
  }
  ```
- **Impacto técnico**: Se o backend adicionar `LACUNA.RESPONSAVEL_INVALIDO` (por exemplo), o frontend renderiza literal `RESPONSAVEL_INVALIDO` até o próximo PR de UI. É o comportamento *desejado* (o comentário explicita) — mas isso é uma decisão de produto, não de arquitetura, e amarra o painel a PRs em duas partes do repositório.
- **Impacto de negócio**: PR em cadeia (backend cria lacuna → frontend traduz). Custo do dev que não sabe da regra: 1 dia de "por que o analista vê `ACAO_ETAPA_DESCONHECIDA` em maiúscula?".
- **Métrica de baseline**: 1 dicionário duplicado; 5 strings pt-BR replicadas.

### F-modifiability-8: `TituloAprovacaoRepository.mapRow` no limite (cognitive 16)

- **Severidade**: P3
- **Tactic violada**: Refactor
- **Localização**: `src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts:186-210`
- **Evidência (objetiva)**:
  ```
  TituloAprovacaoRepository.ts:186:68 lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 16 detected (max: 15).
  ```
- **Impacto técnico**: 22 campos com `?? undefined`, `Number()`, `new Date(as string)`. Cada coluna nova (data_finalizacao real quando PV-04 fechar, ex.) toca o mapper.
- **Impacto de negócio**: Baixo. É código de conversão, testado pelo `AprovacoesSql.test.ts`.
- **Métrica de baseline**: cognitive = 16 (limite 15).

### F-modifiability-9: Probes `fin026` e `trilha` (879 LOC combinadas) misturados com jobs de produção

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/jobs/probe-aprovacoes-fin026.ts` (532), `src/backend/jobs/probe-aprovacoes-trilha.ts` (347)
- **Evidência (objetiva)**:
  ```
  532 src/backend/jobs/probe-aprovacoes-fin026.ts
  347 src/backend/jobs/probe-aprovacoes-trilha.ts
  ```
- **Impacto técnico**: Sondas descartáveis dividem espaço com o `ingest-aprovacoes.ts` (o único job real). Elas puxam LOC do delta e inflacionam qualquer métrica de "código do backend Frente V".
- **Impacto de negócio**: Baixo, mas quem lê o diretório `jobs/` acha que a Frente V tem 3 jobs para operar — não é o caso.
- **Métrica de baseline**: 879 LOC em sondas; 106 LOC no job real; ratio 8:1 sondagem/produção.

## 5. Cards Kanban

### [modifiability-1] Extrair `processarFilial` e `processarPagina` do `IngestaoAprovacoesService.executar`

- **Problema**
  > `IngestaoAprovacoesService.executar` tem cognitive complexity 33 (mais que o dobro do limite Biome de 15) por concentrar 3 laços aninhados (filiais → páginas → títulos), retomada e escrita de cursor no mesmo bloco. Quando PV-07 fechar e a varredura mudar para `fin103` em massa, ou quando PV-08 mudar a janela padrão, o risco de regressão em 23k títulos por filial é alto.
- **Melhoria Proposta**
  > Aplicar **Split Module** e **Refactor**: extrair `processarFilial(filCod, retomada, runId, params)` e `processarPagina(rows, filCod, pagina, runId, params)` como métodos privados; `executar` volta a ser orquestração + retomar/finalizar (< 15 de cognitive). Backing tests já existem em `IngestaoAprovacoesService.test.ts` (255 linhas cobrindo casos canônicos) — usar como safety net.
- **Resultado Esperado**
  > `executar` com cognitive ≤ 15; método `processarFilial` isolável para PV-07 (novo gateway `fin103` reusa `processarPagina`).
- **Tactic alvo**: Split Module + Refactor
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - cognitive complexity do `executar`: 33 → ≤ 15
  - LOC do método: 65 → ≤ 25
- **Risco de não fazer**: um bug no cursor de retomada devolve fantasmas ou pula título. Detectável só em janela de 23k linhas.
- **Dependências**: nenhuma

### [modifiability-2] Quebrar `page.tsx` da Frente V em módulos por responsabilidade

- **Problema**
  > `src/frontend/app/aprovacoes/page.tsx` tem 632 LOC (58% acima do p95 do frontend). Concentra estado global do painel, KPIs, 5 filtros, tabela de 13 colunas e wrapper do drawer. Toda coluna nova (finalização quando PV-04 fechar) ou filtro novo (alçada quando PV-10 fechar) reabre este arquivo.
- **Melhoria Proposta**
  > Aplicar **Split Module**: extrair `components/KpisCards.tsx` (contagens da página), `components/FiltrosBar.tsx` (chips de status + filtros de fornecedor + emissão + limpar), `components/AprovacoesTable.tsx` (a tabela com 13 colunas), `hooks/useAprovacoesQuery.ts` (estado dos filtros + fetch + adaptador `TabelaFiltro`). `page.tsx` fica com < 200 LOC, só orquestração.
- **Resultado Esperado**
  > `page.tsx` ≤ 200 LOC. Cada novo filtro ou coluna toca 1 arquivo, não 5.
- **Tactic alvo**: Split Module + Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - `page.tsx` LOC: 632 → ≤ 200
  - `page.test.tsx` (210 linhas) continua passando sem edição de setup
- **Risco de não fazer**: cada PR de UI toca `page.tsx`, colisão em rebase, tempo de code review alto.
- **Dependências**: nenhuma; compatível com [modifiability-3]

### [modifiability-3] Quebrar `TrilhaDrawer.tsx` em componentes por bloco visual

- **Problema**
  > `TrilhaDrawer.tsx` tem 540 LOC com 7 componentes internos (`TempoDaEtapa`, `EtapaItem`, `MarcoZero`, `LacunasBloco`, `CabecalhoTitulo`, `CampoEtapa`, `TrilhaSkeleton`) num único arquivo. A timeline vertical, o cabeçalho e o marco zero são reutilizáveis (analítico da Fase 2 provavelmente vai remontar por responsável).
- **Melhoria Proposta**
  > Aplicar **Split Module**: mover cada componente para `components/trilha/` (`EtapaItem.tsx`, `MarcoZero.tsx`, `LacunasBloco.tsx`, `CabecalhoTitulo.tsx`, `TempoDaEtapa.tsx`). O `TrilhaDrawer.tsx` fica ~120 LOC (só o Dialog + estados de loading/erro).
- **Resultado Esperado**
  > Nenhum arquivo do drawer > 200 LOC. `EtapaItem` reutilizável no analítico Fase 2 sem copy/paste.
- **Tactic alvo**: Split Module
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - `TrilhaDrawer.tsx` LOC: 540 → ≤ 200
  - `TrilhaDrawer.test.tsx` continua verde sem mudanças de import
- **Risco de não fazer**: Fase 2 do analítico duplica a lógica de EtapaItem/MarcoZero.
- **Dependências**: nenhuma

### [modifiability-4] Externalizar `PAGE_SIZE`, `MAX_PAGINAS` e janela de backfill no `EnvironmentProvider`

- **Problema**
  > `PAGE_SIZE=500`, `MAX_PAGINAS=200` (`IngestaoAprovacoesService.ts:25-28`) e `DOZE_MESES_MS = 365*24*60*60*1000` (`ingest-aprovacoes.ts:35`) são hardcoded. O produto teto silencioso é 100k títulos/filial/run; a janela default é 12 meses. Mudar qualquer um exige edit + redeploy. Cada mudança nesses valores toca o serviço, o que casa mal com a promessa de "read-only, só um flip".
- **Melhoria Proposta**
  > Aplicar **Defer Binding**: adicionar `aprovacoesIngestPageSize`, `aprovacoesIngestMaxPaginas`, `aprovacoesBackfillDias` a `EnvironmentVars`; resolver por env (`APROVACOES_INGEST_PAGE_SIZE`, `APROVACOES_INGEST_MAX_PAGINAS`, `APROVACOES_BACKFILL_DIAS`) com defaults 500, 200, 365. Serviço passa a receber os valores por construtor via `EnvironmentProvider`.
- **Resultado Esperado**
  > Ajustar a janela para 24 meses ou aumentar o teto por filial vira mudança de dashboard (Render), não commit.
- **Tactic alvo**: Defer Binding (configuration files)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - magic numbers de negócio no delta: 3 → 0
  - tempo médio para trocar janela de backfill: ~1 dia (edit + PR + release) → ~5 min (dashboard)
- **Risco de não fazer**: 6 meses depois, o cliente pede 24 meses de histórico e a mudança é 1 PR + release.
- **Dependências**: nenhuma; segue o padrão de `resolveIngestDias` para Frente IV

### [modifiability-5] Sanear a duplicação backend↔frontend do contrato Frente V

- **Problema**
  > `src/frontend/lib/aprovacoes.ts` replica *literalmente* 5 uniões (`StatusWorkflow`, `EtapaStatus`, `Lacuna`), 5 interfaces (`AprovacaoListItem`, `EtapaTrilha`, `TrilhaResponse`, `AprovacoesListResponse`, `AprovacoesFiltros`) e o dicionário `LACUNA_DESCRICAO` (5 frases). Nenhuma pesquisa/geração garante que ambos os lados evoluam juntos. Quando PV-01 introduzir um estado novo, é edit em 2 lados.
- **Melhoria Proposta**
  > Aplicar **Abstract Common Services**: extrair `packages/contracts/aprovacoes.ts` (ou, no monorepo atual, mover as constantes e uniões para `src/shared/aprovacoes-contract.ts` importado por ambos). Tipos DTO puros TypeScript compilam nos dois lados sem runtime. `LACUNA_DESCRICAO` fica no shared, `descreverLacuna` importa dele. Alternativa mínima: gerar o `lib/aprovacoes.ts` a partir do backend via script `scripts/gen-frontend-contract.ts` acionado no `prebuild`.
- **Resultado Esperado**
  > Editar `constants.ts` no backend propaga automaticamente ao frontend. Um estado novo em `StatusWorkflow` quebra o build do frontend em vez de virar bug silencioso.
- **Tactic alvo**: Abstract Common Services + Encapsulate
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3, F-modifiability-7
- **Métricas de sucesso**:
  - Definições de tipos duplicadas: 10 → 0
  - Sincronização `LACUNA_DESCRICAO`: manual (comentário) → geração automática ou import compartilhado
- **Risco de não fazer**: cada nova lacuna vira PR em cadeia; cada estado novo vira bug de renderização.
- **Dependências**: depende de decisão do time sobre `packages/shared` (o repo hoje não tem — a alternativa "codegen no prebuild" é mais barata)

### [modifiability-6] Fechar drift ontológico Frente V (3 entradas do watchlist)

- **Problema**
  > `ontology/_coverage.json` `_watchlist` registra 3 divergências: (1) nomes de tabela `titulo_aprovacao`/`etapa_aprovacao` no texto vs `aprovacao_titulo`/`aprovacao_etapa` na migration 0049; (2) `state-machines/etapa-aprovacao.md` descreve regra de status por timestamp, `EtapaStatusResolver` decide por ação; (3) advisory lock vive no JOB e não no serviço, sem teste da regra de idempotência para gatilhos alternativos.
- **Melhoria Proposta**
  > Aplicar **Encapsulate**: rodar `/retro-ontology` focado na Frente V — corrigir nomes de tabela nos `.md`, reescrever `state-machines/etapa-aprovacao.md` para bater com o `EtapaStatusResolver` (ou o contrário, com ADR justificando), e adicionar teste "second run bails" com dublê do advisory lock ou mover a exclusão para o serviço.
- **Resultado Esperado**
  > 0 entradas Frente V no `_watchlist`; próximo `/feature-tweak` lê `.md` que descreve o código que roda.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - `_watchlist` entries Frente V: 3 → 0
  - `_index.json` vs `_coverage.json` de itens Frente V: bate 1:1
- **Risco de não fazer**: OntologyCurator do próximo `/feature-tweak` da Frente V lê `.md` obsoleto e prescreve reimplementação errada.
- **Dependências**: nenhuma

### [modifiability-7] Migrar layer-skip da rota (client direto) para um `FiliaisService`

- **Problema**
  > `routes/aprovacoes.ts:6-46` importa e resolve `ConexosCadastroClient` diretamente para a listagem de filiais (fallback do JWT sem claim). É layer-skip herdado da Frente IV. Não é bug hoje, mas cimenta o antipattern — o `PatternGuardian` só passa porque ele já convive com o padrão em `recebimentos`.
- **Melhoria Proposta**
  > Aplicar **Restrict Dependencies**: criar `FiliaisService.listar()` (ou `AutorizacaoFilialService`) que envolve `ConexosCadastroClient` + cache. A rota chama o service. Quando PV-09 fechar (claim `filiais` no JWT), o serviço vira wrapper trivial da claim e o cache some.
- **Resultado Esperado**
  > 0 imports cross-layer no delta Frente V; padrão para replicar na Frente IV posteriormente.
- **Tactic alvo**: Restrict Dependencies + Use an Intermediary
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - imports cross-layer em `routes/aprovacoes.ts`: 1 → 0
- **Risco de não fazer**: rota nova copia o padrão; débito escala.
- **Dependências**: PV-09 (claim `filiais` no JWT) pode tornar isso obsoleto

### [modifiability-8] Mover probes fora de `jobs/` (`scripts/probes/` ou similar)

- **Problema**
  > `src/backend/jobs/probe-aprovacoes-fin026.ts` (532 LOC) e `probe-aprovacoes-trilha.ts` (347 LOC) são sondas de investigação, não jobs de produção. Ocupam o mesmo diretório do `ingest-aprovacoes.ts` (106 LOC, o único job real).
- **Melhoria Proposta**
  > Aplicar **Increase Semantic Coherence**: mover probes para `src/backend/scripts/probes/` (ou similar) e atualizar `package.json` `scripts` para refletir. Deixar comentário em cada um: "read-only, descartável, produto de investigação".
- **Resultado Esperado**
  > `jobs/` contém apenas jobs de produção; ratio sonda/produção em `jobs/` cai de 8:1 para 0.
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-9
- **Métricas de sucesso**:
  - LOC em `src/backend/jobs/`: 3473 → ~2600 (menos 879 das probes)
  - `jobs/` só contém jobs de produção
- **Risco de não fazer**: novo dev abre `jobs/`, vê 3 arquivos "aprovacoes", tenta rodar o probe achando que é o job.
- **Dependências**: nenhuma

## 6. Notas do agente

- **F-modifiability-8** (mapRow cognitive 16) foi mantida como P3 sem card dedicado — o esforço de refactor é grande e a probabilidade de bug baixa; a melhoria vem naturalmente quando PV-04 adicionar `dataFinalizacao` no mapper. Se o consolidator quiser um card, extrair "converter mapRow para tabela de coerções" como escalável a repositórios similares.
- Frontend usa `eslint`, não Biome — cognitive complexity dos arquivos frontend do delta (`page.tsx` 632, `TrilhaDrawer.tsx` 540) não é medida hoje pela mesma vara do backend. Sugerido: cross-check com **Testability** (arquivos gigantes tendem a testes gigantes; `page.test.tsx` já tem 210 linhas e Trilha `.test.tsx` está grande). Verificar se o consolidator quer alertar sobre Biome unificado para o repo inteiro.
- **Cross-QA**: (a) **Integrability** — F-modifiability-3 (duplicação de contrato) toca o boundary HTTP; a solução (contract package/gen) melhora os dois QAs de uma vez. (b) **Testability** — F-modifiability-1 (executar cognitive 33) e F-modifiability-2 (page.tsx 632 LOC) casam com o argumento canônico "hard to test = hard to modify"; a fatoração melhora ambos. (c) **Deployability** — F-modifiability-4 (magic numbers em regra de negócio) é literalmente "config não externalizada = cada mudança = redeploy"; alinhar com o card equivalente de Deployability se existir.
- Métrica que tentei coletar e falhei: fan-in *global* dos serviços do delta (busca timed out em 120s no worktree Windows por conta do tamanho de `node_modules/`). Reportei fan-in restrito ao delta — suficiente para as tactics de coupling porque nada fora do delta importa esses serviços novos.
- Escopo: não avaliei o probe `probe-aprovacoes-fin026.ts` linha-a-linha (é descartável, ver card [modifiability-8]) — só o contei.
