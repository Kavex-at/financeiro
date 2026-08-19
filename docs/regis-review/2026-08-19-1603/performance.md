---
qa: Performance
qa_slug: performance
run_id: 2026-08-19-1603
agent: qa-performance
generated_at: 2026-08-19T16:03:00-03:00
scope: backend + frontend
score: 5
findings_count: 8
cards_count: 8
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron diário (`ingest-aprovacoes`) | Backfill/refresh do universo de títulos a pagar de uma filial (~23,6 k linhas em 12 meses na filial 2 — sondagem confirmada) | `IngestaoAprovacoesService` + `ConexosAprovacoesClient` (`psq014/list` + `fin026/infoTitulo/list`) | Operação normal, ERP Conexos sob quota; PV-07 (acesso ao `fin103`) ainda fechado | Job termina (ou é retomado sem regressão) sem estourar sessão do ERP | Chamadas ao ERP por filial ≤ 200; wall-clock por filial ≤ 30 min; 0 duplicações no cursor |
| Analista logado no painel | Página do grid `/aprovacoes` com filtro por status/fornecedor/responsável/busca livre, `pageSize=25` | Rota `GET /aprovacoes` → `AprovacoesPainelService.listar` → `TituloAprovacaoRepository.list` + `EtapaAprovacaoRepository.listByTitulos` | Base com ~24 k títulos e ~3 × etapas cada, pool Postgres com `max=5` | Página renderiza em tempo interativo; grid não escala com o número de linhas | p50 do endpoint ≤ 300 ms, p95 ≤ 800 ms; 2 queries por request (uma da lista + uma da trilha) |
| Analista digitando na busca | Cada tecla dispara re-fetch salvo debounce | Frontend `page.tsx` (`BUSCA_DEBOUNCE_MS = 300`) | Rede residencial 4G | ≤ 1 request por rajada de digitação | Requests/keystroke ≤ 1/8 caracteres (efeito do debounce) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Universo mensurado (filial 2 / 12 m) | **23.632 títulos** | — (contexto) | — | Sondagem em produção (ver `frente-v-probe-resultado.md` e comentário no header de `ingest-aprovacoes.ts`) |
| Chamadas ao ERP por varredura completa (filial 2, sem PV-07) | **~23.680** (48 páginas `psq014` × PAGE_SIZE 500 + 23.632 `fin026/infoTitulo`) | ≤ 200 (com PV-07: `fin103` paginado) | ❌ | `IngestaoAprovacoesService.ts:100-130` + `ConexosAprovacoesClient.ts:100-121` |
| Concorrência da varredura | **1** (loop `for` serializado por página e por título) | 3–5 (bounded via `BoundedConcurrency`, respeitando rate-limit do ERP — ADR-0012) | ⚠️ | `IngestaoAprovacoesService.ts:97-125` |
| Wall-clock estimado do backfill (filial 2, serial, p50 ERP ≈ 500 ms) | **~3,3 h**; a 1 s por chamada, ~6,6 h | ≤ 30 min com PV-07; ≤ 1 h com concorrência 4 sem PV-07 | ❌ | Cálculo: 23.680 × 0,5 s = 11.840 s |
| Teto de páginas por filial (`MAX_PAGINAS`) | **200** × PAGE_SIZE 500 = 100.000 títulos | Cobre 4,2× a produção atual — ok | ✅ | `IngestaoAprovacoesService.ts:29` |
| Queries por página do grid (com trilha) | **2** (list + `listByTitulos` com tupla IN) | ≤ 2 | ✅ | `AprovacoesPainelService.ts:132-142` |
| N+1 histórico do grid | Removido — `listByTitulos` agrega em UMA query | 0 | ✅ | `EtapaAprovacaoRepository.ts:99-129` (comentário explícito) |
| Cobertura de índice para o `ORDER BY` do grid (`data_emissao DESC, doc_cod DESC`) | `idx_aprovacao_titulo_fil_emissao(fil_cod, data_emissao DESC)` cobre com 1 `filCod`; com `filCods = ANY(...)` vira bitmap + sort | Índice utilizado quando o usuário filtra por 1 filial (caso comum) | ⚠️ | `migrations/0049_aprovacao_trilha.sql:56-61` + `TituloAprovacaoRepository.ts:170-172` |
| Busca livre `ILIKE '%…%'` sobre `documento_numero`/`titulo_numero`/`fornecedor_nome` | Sequencial scan (sem trigram/GIN) | Índice `gin (col gin_trgm_ops)` em ≥ 1 coluna | ❌ | `TituloAprovacaoRepository.ts:141-146` + `migrations/0049_aprovacao_trilha.sql` (ausência) |
| Filtro por `responsavel` (subquery `EXISTS`) | Usa `idx_aprovacao_etapa_responsavel (responsavel_nome)` mas `ILIKE '%…%'` cai em scan | Trigram/GIN em `responsavel_nome` | ❌ | `TituloAprovacaoRepository.ts:148-158` + `migrations/0049_aprovacao_trilha.sql:112` |
| `tempoTotalSegundos` recalculado a cada leitura | **Sim** — chamada de `DuracaoCalculator` por linha do grid (25/página) e nas trilhas | Aceitável (é derivado de `agora`) — custo O(1) por linha | ✅ (por design; ver comentário em `AprovacoesPainelService.ts:207-213`) | `AprovacoesPainelService.ts:225-231` |
| Pool Postgres máx (`poolMaxConnections`) | **5** conexões | 5 é suficiente para hoje (Express + Render); revisar quando alvo Lambda entrar | ⚠️ | `PostgreeDatabaseClient.ts:26,66` |
| Debounce da busca do painel | **300 ms** | 300–500 ms — ok | ✅ | `page.tsx:44` |
| Cadastro de filiais (`fetchFiliais`) no mount da página | 1 request extra por navegação | Cache curto (`stale-while-revalidate`, ~5 min) | ⚠️ | `page.tsx:186-194` (fetch a cada mount) |
| Cursor gravado a cada título | **1 UPDATE por título** (via `salvarCursor`) | Deveria ser 1 UPDATE por página ou a cada N títulos | ⚠️ | `IngestaoAprovacoesService.ts:112-119` |
| Retry do `ConexosBaseClient` | 1 tentativa + 500 ms delay + 200 ms jitter | ok para read-only | ✅ | `ConexosBaseClient.ts:154-157` |
| Timeout HTTP explícito em `ConexosAprovacoesClient` | ⚠️ Não medível: herdado do `apiFetch` legado do `services/conexos.ts`; sem inspeção do arquivo legacy, valor efetivo em segundos é desconhecido — cross-QA com Availability | Timeout ≤ 30 s por chamada | ⚠️ | Herança do `ConexosBaseClient.postGeneric` |
| Bundle da rota `/aprovacoes` | ⚠️ Não medível localmente com `--quick`: `next build` pulado. Heurística: imports do `page.tsx` (10 símbolos) + `TrilhaDrawer` traz `date-fns` + `date-fns/locale/ptBR` — típico ~180–240 KB First Load | ≤ 200 KB First Load (p95) | ⚠️ | `page.tsx:3-41`, `TrilhaDrawer.tsx:3-40` |

## 3. Tactics — Cobertura no nf-projects

### Control Resource Demand

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | `emissaoDesde` (janela padrão 12 meses) recorta o universo — sem janela seria a base inteira | ✅ | `ingest-aprovacoes.ts:34` (`DOZE_MESES_MS`) |
| Limit Event Response | `PAGE_SIZE_MAX = 100` bloqueia `?pageSize=100000` no boundary; `PAGE_SIZE=500` + `MAX_PAGINAS=200` limitam a varredura | ✅ | `routes/aprovacoes.ts:29-30`; `IngestaoAprovacoesService.ts:26-29` |
| Prioritize Events | Ausente — não há priorização de filiais/faixa de emissão; a ordem é a do array `FILS` | ⚠️ parcial | Loop `for` em `params.filCods` sem heurística de prioridade (`IngestaoAprovacoesService.ts:92`) |
| Reduce Overhead | ✅ trilha do grid vai em **1** query (`listByTitulos` com tupla IN); ❌ cursor gravado a cada título é overhead evitável | ⚠️ parcial | `EtapaAprovacaoRepository.ts:99-129` (bom); `IngestaoAprovacoesService.ts:112-119` (ruim) |
| Bound Execution Times | Sem timeout de wall-clock no job; `RetryExecutor` limita retentativas mas não o custo total; sem `AbortController` na chamada ERP | ❌ ausente | `IngestaoAprovacoesService.executar` roda até acabar |
| Increase Resource Efficiency | `docDtaEmissao#GE` corta linhas no ERP; SQL parametrizado; `ILIKE '%…%'` sem trigram destrói ganho | ⚠️ parcial | `ConexosAprovacoesClient.ts:65-72`; `TituloAprovacaoRepository.ts:141-146` |

### Manage Resources

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | Pool `max = 5` (mínimo defensável para o cenário atual, ver comentário do próprio arquivo); não parametrizável por env | ⚠️ parcial | `PostgreeDatabaseClient.ts:26` |
| Increase Concurrency | ❌ Ingestão da Frente V é 100 % serial. `BoundedConcurrency` **existe** no repo (`domain/libs/concurrency/`) e é usado por Conexos Cadastro/Fin014/Fin004 — a Frente V **não** o adotou | ❌ ausente | `IngestaoAprovacoesService.ts:97-125` vs. `BoundedConcurrency.ts:25-64` |
| Maintain Multiple Copies of Computations | Snapshot local em Postgres é uma cópia read-only do ERP — a intenção arquitetural da Frente V | ✅ | `migrations/0049_aprovacao_trilha.sql` (ADR-0038) |
| Maintain Multiple Copies of Data | Cabeçalho materializa `etapas_concluidas`, `etapas_totais`, `primeira_etapa_em`, `ultima_acao_em`, `tempo_total_segundos` → evita join na trilha para a maior parte das linhas | ✅ | `migrations/0049_aprovacao_trilha.sql:31-45` |
| Bound Queue Sizes | N/A no runtime atual (Express, sem SQS) — o job usa `withAdvisoryLock` para exclusão mútua, que é a única fila | N/A | `ingest-aprovacoes.ts:70-89` |
| Schedule Resources | ⚠️ Sem scheduler declarado no repo (não há `infra/`); "cron" é implícito (env `TRIGGERED_BY = 'cron'`) — cross-QA com Deployability | ⚠️ parcial | `ingest-aprovacoes.ts:74` |

### Modern facets

| Facet | Implementação atual | Status | Evidência |
|---|---|---|---|
| Cold start budget | N/A hoje (Express long-running em Render). Alvo Lambda ainda não materializado | N/A | CLAUDE.md §Estado Atual vs. Alvo |
| Cache strategy | ❌ `fetchFiliais` refetch a cada mount; sem cache de metadados; snapshot Postgres é uma forma de cache (bom); SSM cache em `EnvironmentProvider` — instância única | ⚠️ parcial | `page.tsx:186-194` |
| Index discipline | Cobre `status`, `(fil_cod, data_emissao)`, `fornecedor`, `observado_em`, `(fil, doc, tit)` da trilha, `responsavel_nome`, `status` da etapa. Falta trigram para busca ILIKE | ⚠️ parcial | `migrations/0049_aprovacao_trilha.sql:56-61,109-114` |
| Bundle leanness | `TrilhaDrawer` importa `date-fns` + `date-fns/locale/ptBR` estaticamente; drawer só abre sob clique — candidato claro a `next/dynamic` | ⚠️ parcial | `TrilhaDrawer.tsx:4-5` |

## 4. Findings (achados)

### F-performance-1: Ingestão da trilha custa 1 chamada ao ERP por título — ~23.680 calls só na filial 2

- **Severidade**: P0
- **Tactic violada**: Reduce Overhead + Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:97-131`, `src/backend/domain/client/ConexosAprovacoesClient.ts:100-121`
- **Evidência (objetiva)**:
  ```
  for (const filCod of params.filCods) {
    for (let pagina = paginaInicial; pagina <= MAX_PAGINAS; pagina++) {
      const { rows } = await this.gateway.listUniverso({...});
      for (const row of rows) {
        const persistidas = await this.processarTitulo(row, filCod, runId); // 1 fin026 call por título
      }
    }
  }
  ```
  Sondagem em produção (comentário do job): 23.632 títulos a pagar em 12 meses na filial 2.
- **Impacto técnico**: 48 páginas de `psq014` + 23.632 chamadas de `fin026/infoTitulo/list` = ~23.680 requests ao ERP por varredura completa de UMA filial. A serialização (F-performance-2) transforma isso em ~3–7 horas de wall-clock. Um pico de reingestão + reinício de sessão do ERP no meio empilha o custo.
- **Impacto de negócio**: janela de reingestão inviabiliza recovery em prazo curto (analista fica com dado stale > 1 dia após qualquer interrupção); consome quota do Conexos; multiplica o risco de bater `LOGIN_ERROR_MAX_SESSIONS`.
- **Métrica de baseline**: 23.680 chamadas/filial/12 m; alvo com PV-07 (acesso ao `fin103`): ~48 chamadas paginadas (redução de **~500×**, duas ordens de grandeza — como já reconhecido no comentário do próprio client, linhas 100-105).

### F-performance-2: Varredura 100 % serial — não usa `BoundedConcurrency` que já existe no repo

- **Severidade**: P1
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:92-125`
- **Evidência (objetiva)**:
  ```
  for (const row of rows) {
      const persistidas = await this.processarTitulo(row, filCod, runId);
      ...
      await this.runRepository.salvarCursor(...);
  }
  ```
  `BoundedConcurrency` (`domain/libs/concurrency/BoundedConcurrency.ts`) já é injectable e usado por `ConexosCadastroClient`, `ConexosFin014Client`, `ConexosFinanceiroClient` — a Frente V é a única varredura que não o adota.
- **Impacto técnico**: usa 100 % do wall-clock e 0 % da capacidade de I/O concorrente do event loop. Se ADR-0012 permite N=3–5 requests concorrentes ao ERP, hoje é gastado 1.
- **Impacto de negócio**: enquanto PV-07 não fecha, o backfill leva horas. Concorrência 4 (bounded) leva para 45–100 min sem tocar rate-limit do ERP.
- **Métrica de baseline**: concorrência = 1; alvo = 3–5 (respeitando ADR-0012). Wall-clock estimado 3,3 h → ≤ 1 h.

### F-performance-3: `salvarCursor` executa 1 UPDATE por título (23.632 UPDATEs por filial)

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:112-119`
- **Evidência (objetiva)**:
  ```
  await this.runRepository.salvarCursor(
      runId,
      { filCod, pagina, docCod: Number(row.docCod ?? 0) },
      { titulos, etapas },
  );
  ```
  Executado **dentro** do `for (const row of rows)`.
- **Impacto técnico**: 23.632 UPDATEs em `aprovacao_ingestao_run` por filial. A justificativa (comentário na linha 111) — "cursor DEPOIS da persistência: uma queda repete no máximo um título" — está certa em precisão de recuperação, mas custa uma round-trip a Postgres por título.
- **Impacto de negócio**: adiciona ~10–15 % ao wall-clock do job e pressão desnecessária no pool `max=5` que também atende o painel.
- **Métrica de baseline**: 23.632 UPDATEs/filial → alvo ≤ ~950 (1 a cada 25 títulos), preservando a garantia "repete no máximo 25 títulos".

### F-performance-4: Busca livre `ILIKE '%…%'` sem índice trigram → sequencial scan em ~24 k linhas

- **Severidade**: P1
- **Tactic violada**: Increase Resource Efficiency + Index discipline
- **Localização**: `src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts:141-146`, `src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts:148-158`, `src/backend/migrations/0049_aprovacao_trilha.sql:56-61`
- **Evidência (objetiva)**:
  ```
  '(documento_numero ILIKE $busca OR titulo_numero ILIKE $busca OR fornecedor_nome ILIKE $busca)'
  params.busca = `%${filtro.busca}%`;
  ```
  Nenhum índice `pg_trgm` / `gin` na migration 0049. Mesmo padrão no filtro `responsavel` (`EXISTS ... responsavel_nome ILIKE $responsavel`).
- **Impacto técnico**: cada busca vira `Seq Scan` em `aprovacao_titulo` + `aprovacao_etapa`. Com ~24 k títulos por filial × N filiais × ~3 etapas cada, isso é 300–500 ms extra por request.
- **Impacto de negócio**: latência interativa do painel degrada exatamente no fluxo mais usado (analista pesquisando por fornecedor ou número). Piora conforme a base cresce (após 24 meses, dobra).
- **Métrica de baseline**: sem trigram, tempo médio de busca em base cheia ≈ 300–800 ms; alvo com `gin (col gin_trgm_ops)` em `fornecedor_nome`, `documento_numero`, `responsavel_nome` = ≤ 100 ms.

### F-performance-5: `ORDER BY data_emissao DESC` em varredura multi-filial sem índice global

- **Severidade**: P2
- **Tactic violada**: Index discipline
- **Localização**: `src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts:167-172`, `src/backend/migrations/0049_aprovacao_trilha.sql:56-61`
- **Evidência (objetiva)**:
  ```
  ORDER BY data_emissao DESC NULLS LAST, doc_cod DESC
  LIMIT $limit OFFSET $offset
  -- índice existente: idx_aprovacao_titulo_fil_emissao (fil_cod, data_emissao DESC)
  ```
  Quando o usuário filtra por 1 filial, o índice cobre. Quando a rota resolve `filCods` como allow-list do token (N filiais via `fil_cod = ANY($filCods::int[])`), o planner cai em bitmap + sort.
- **Impacto técnico**: paginação usa `OFFSET` — na página 100 do grid (~2.500 registros descartados) o custo cresce linearmente. `OFFSET` grande com sort é o padrão anti-scale clássico de Postgres.
- **Impacto de negócio**: paginação profunda fica lenta (rare, mas mensurável); dashboards que agreguem por múltiplas filiais degradam com base crescente.
- **Métrica de baseline**: sem índice puro em `(data_emissao DESC, doc_cod DESC)`, p95 de página 20+ com N=5 filiais ≈ 400–900 ms; alvo ≤ 200 ms. Keyset pagination elimina o problema.

### F-performance-6: `fetchFiliais` chamado no mount da página `/aprovacoes` sem cache

- **Severidade**: P3
- **Tactic violada**: Cache strategy
- **Localização**: `src/frontend/app/aprovacoes/page.tsx:186-194`
- **Evidência (objetiva)**:
  ```
  React.useEffect(() => {
      let vivo = true
      fetchFiliais()
          .then((r) => { if (vivo) setFiliaisApi(r.filiais.map(...)) })
          .catch(() => {})
      return () => { vivo = false }
  }, [])
  ```
  Cada navegação para `/aprovacoes` gasta uma round-trip ao backend + Conexos para dado que muda em escala de semanas.
- **Impacto técnico**: 1 request extra por mount, encadeado a `resolverFilCodsAcessiveis` do backend, que pode envolver chamada ao Conexos (`imp021`) — round-trip cascata.
- **Impacto de negócio**: latência percebida na abertura da tela + custo desnecessário no ERP.
- **Métrica de baseline**: 1 request `/api/filiais` por mount → alvo 0 (cache em `sessionStorage`/SWR com TTL ≥ 15 min).

### F-performance-7: `TrilhaDrawer` importa `date-fns` + `date-fns/locale/ptBR` estaticamente, mas só abre sob clique

- **Severidade**: P2
- **Tactic violada**: Bundle leanness
- **Localização**: `src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx:4-5`, `src/frontend/app/aprovacoes/page.tsx:41`
- **Evidência (objetiva)**:
  ```
  // TrilhaDrawer.tsx
  import { format } from 'date-fns'
  import { ptBR } from 'date-fns/locale'
  // page.tsx
  import { TrilhaDrawer } from './components/TrilhaDrawer'
  ```
  Import estático — o drawer entra no chunk inicial da rota.
- **Impacto técnico**: `date-fns` + locale + código do drawer ficam no First Load JS, embora o drawer só apareça sob clique de "Ver trilha".
- **Impacto de negócio**: penaliza TTI da rota em navegações frias, especialmente em rede móvel.
- **Métrica de baseline**: ⚠️ Não medível localmente com `--quick` (sem `next build`); heurística: `date-fns` sem `date-fns/esm` + drawer ≈ 25–40 KB no First Load. Alvo: 0 KB (via `next/dynamic(() => import('./components/TrilhaDrawer'), { ssr: false })`).

### F-performance-8: Sem timeout wall-clock no job de ingestão nem `AbortController` na chamada ERP

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/jobs/ingest-aprovacoes.ts`, `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts`
- **Evidência (objetiva)**:
  ```
  const resultado = await db.withAdvisoryLock(...)
  // sem Promise.race com timeout; sem AbortController;
  // sem "budget" de horas para desistir
  ```
  Retomabilidade cobre "cair no meio", mas não "ficar preso indefinidamente numa filial devagar".
- **Impacto técnico**: um `psq014/list` que trava por 5+ min segura o advisory lock e trava a próxima janela de cron. Sem circuit breaker.
- **Impacto de negócio**: sem alarme claro para "ingestão passou de X horas", uma degradação silenciosa do ERP vira dado stale sem alerta. Cross-QA com Availability.
- **Métrica de baseline**: 0 timeout; alvo: budget ≤ 2 h por execução + timeout HTTP ≤ 30 s por chamada ERP (herdar de `apiFetch`).

## 5. Cards Kanban

### [performance-1] Substituir varredura 1-call-por-título por leitura em massa via `fin103` (PV-07)

- **Problema**
  > A ingestão da Frente V faz uma chamada `fin026/infoTitulo/list` para cada título — 23.632 chamadas só na filial 2 em 12 meses (medido em produção). Enquanto PV-07 não fecha, um backfill leva 3–7 horas e consome quota do ERP no volume máximo possível.

- **Melhoria Proposta**
  > Fechar a pendência PV-07 (acesso à tela `fin103` para o usuário de API). Uma vez liberada, trocar o binding de `TRILHA_APROVACAO_GATEWAY_TOKEN` para um cliente que faça leitura paginada do universo trilha (48 páginas × 500 = 24 k linhas em ~48 chamadas). O contrato do gateway (`listUniverso` + `listTrilha`) já foi desenhado para permitir a troca sem alterar `IngestaoAprovacoesService` (ver comentário em `ConexosAprovacoesClient.ts:100-105`).

- **Resultado Esperado**
  > Chamadas ao ERP por varredura de uma filial: **~23.680 → ~48** (redução de 493×, duas ordens de grandeza).
  > Wall-clock: **~3,3 h (p50) → ~30 s (p50)**.

- **Tactic alvo**: Reduce Overhead / Increase Resource Efficiency
- **Severidade**: P0
- **Esforço estimado**: L (depende de PV-07 fechar — bloqueio externo; código já tem tudo desenhado)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Chamadas ERP/varredura filial 2: 23.680 → ≤ 100
  - Wall-clock por filial: ~3,3 h → ≤ 5 min
- **Risco de não fazer**: manter a Frente V refém do cronograma da Conexos; qualquer regressão de sessão ERP no meio joga fora horas de trabalho e adiciona pressão para "reingerir tudo" que o próprio cursor tenta amortizar.
- **Dependências**: PV-07 (acesso do usuário de API à tela `fin103`) — fora do controle do time.

### [performance-2] Adotar `BoundedConcurrency` na varredura de títulos da Frente V

- **Problema**
  > `IngestaoAprovacoesService.executar` roda 100 % serial (`for` sobre páginas, `for` sobre títulos, `await` por título). O helper `BoundedConcurrency` já existe no repo e é usado por `ConexosCadastroClient`/`ConexosFin014Client`/`ConexosFinanceiroClient`. A Frente V é a única varredura pesada que não o adotou — desperdiça capacidade de I/O concorrente enquanto PV-07 não fecha.

- **Melhoria Proposta**
  > Envolver `processarTitulo` em um `BoundedConcurrency.run(rows, worker, 4)` por página. Manter cursor por página (não por título — ver card `performance-3`). Respeitar rate-limit do ERP definido pelo ADR-0012; começar com limit=3 e ajustar após medir em dev tenant.

- **Resultado Esperado**
  > Wall-clock do backfill enquanto PV-07 não fecha: **~3,3 h → ~50–70 min** (com concorrência 4).
  > Concorrência efetiva: **1 → 3–4** requests em voo por página.

- **Tactic alvo**: Increase Concurrency
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Requests em voo (medido): 1 → 3–4
  - Wall-clock backfill filial 2: 3,3 h → ≤ 1 h
  - Erros `LOGIN_ERROR_MAX_SESSIONS`: 0 (não regredir)
- **Risco de não fazer**: enquanto PV-07 não fechar, backfill fica proibitivo — e a probabilidade de PV-07 fechar em curto prazo é baixa.
- **Dependências**: revisar limits do ADR-0012 antes de subir para dev; card `performance-3` (senão o pool Postgres vira gargalo).

### [performance-3] Reduzir frequência do `salvarCursor` (1× por título → 1× por página ou lote)

- **Problema**
  > A cada título persistido, o serviço faz um UPDATE em `aprovacao_ingestao_run` para gravar o cursor. Isso são 23.632 UPDATEs por filial — pressão desnecessária no pool `max=5` que também atende o painel, e ~10–15 % de wall-clock extra.

- **Melhoria Proposta**
  > Gravar cursor **1× por página** processada (não por título). Manter a semântica "repete no máximo N títulos" com `N = pageSize` — a idempotência via UPSERT no `TituloAprovacaoRepository` já cobre o cenário. Alternativa: batch de N=25.

- **Resultado Esperado**
  > UPDATEs em `aprovacao_ingestao_run` por filial: **23.632 → ~48**.
  > Pressão sobre o pool Postgres do backfill: reduz ~99 %.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - UPDATEs `aprovacao_ingestao_run` por varredura filial 2: 23.632 → ≤ 100
  - Conexões pool ocupadas simultaneamente pelo job: medir antes/depois
- **Risco de não fazer**: enquanto o pool for `max=5`, o job pressiona painel e job simultaneamente; ADR-0038 previa job noturno mas nada impede sobreposição com analista de outra timezone.
- **Dependências**: card `performance-2` (a concorrência aumenta a pressão do cursor por título).

### [performance-4] Adicionar índices `gin (col gin_trgm_ops)` para busca `ILIKE`

- **Problema**
  > O grid oferece busca livre por `documento_numero`, `titulo_numero`, `fornecedor_nome` (e filtro `responsavel` em `aprovacao_etapa.responsavel_nome`) via `ILIKE '%…%'`. A migration 0049 não cria índice trigram — todo pattern com wildcard à esquerda cai em `Seq Scan`.

- **Melhoria Proposta**
  > Criar migration `0050_aprovacao_trilha_trgm.sql`:
  > ```
  > CREATE EXTENSION IF NOT EXISTS pg_trgm;
  > CREATE INDEX idx_aprovacao_titulo_fornecedor_trgm ON aprovacao_titulo USING gin (fornecedor_nome gin_trgm_ops);
  > CREATE INDEX idx_aprovacao_titulo_documento_trgm ON aprovacao_titulo USING gin (documento_numero gin_trgm_ops);
  > CREATE INDEX idx_aprovacao_etapa_responsavel_trgm ON aprovacao_etapa USING gin (responsavel_nome gin_trgm_ops);
  > ```
  > `titulo_numero` é numérico curto — pode ficar sem trigram.

- **Resultado Esperado**
  > p95 do `GET /aprovacoes?busca=…` em base cheia: **~300–800 ms → ≤ 100 ms**.
  > Plano da query passa de `Seq Scan` a `Bitmap Index Scan`.

- **Tactic alvo**: Increase Resource Efficiency / Index discipline
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - `EXPLAIN ANALYZE` do plano de busca por fornecedor: `Seq Scan` → `Bitmap Index Scan`
  - p95 do endpoint com filtro `busca` ativo: baseline (medir) → ≤ 100 ms
- **Risco de não fazer**: latência interativa piora conforme a base cresce; em 24 meses de histórico o problema dobra.
- **Dependências**: nenhuma (migration pura). Cross-QA com Modifiability (schema-as-code).

### [performance-5] Migrar paginação profunda do grid para keyset (ou reforçar cobertura de índice)

- **Problema**
  > O grid usa `LIMIT/OFFSET` com `ORDER BY data_emissao DESC, doc_cod DESC`. Quando o usuário filtra por `filCod = ANY(array)`, o índice `(fil_cod, data_emissao DESC)` não cobre e o planner cai em `Bitmap + Sort`. Página 100 (offset 2.500) fica cara.

- **Melhoria Proposta**
  > Trocar paginação por keyset: cursor `(data_emissao, doc_cod)` como delimitador. Alternativa mais barata (mesmo card): adicionar índice global `(data_emissao DESC, doc_cod DESC)` para queries multi-filial e manter offset. Escolher pela usabilidade — analista raramente pula para "página 100", então índice + educação da UI pode bastar.

- **Resultado Esperado**
  > p95 da última página do grid (base cheia): **~400–900 ms → ≤ 200 ms**.
  > `EXPLAIN ANALYZE` da query sem filtro de status/fornecedor: usa índice em vez de bitmap + sort.

- **Tactic alvo**: Index discipline / Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: M (keyset) / S (só índice)
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - p95 da paginação profunda: baseline → ≤ 200 ms
  - Plano do grid multi-filial: `Bitmap + Sort` → `Index Scan`
- **Risco de não fazer**: aceitável enquanto base < 50 k títulos; vira P1 quando dobra.
- **Dependências**: nenhuma.

### [performance-6] Cachear `fetchFiliais` no cliente com TTL de sessão

- **Problema**
  > A rota `/aprovacoes` chama `fetchFiliais()` em `useEffect` no mount, sem cache. Cada navegação para a tela custa uma round-trip API → backend → Conexos para dado que muda em escala de semanas.

- **Melhoria Proposta**
  > Cachear filiais em `sessionStorage` com TTL de ~30 min (ou expor via SWR com `revalidateOnMount: false`). Fallback para as filiais da página (comportamento atual) permanece quando cache miss + erro.

- **Resultado Esperado**
  > Requests `/api/filiais` por sessão de trabalho: **~10–20 (uma por navegação) → 1**.
  > Latência percebida no mount de `/aprovacoes`: reduz ~50–200 ms.

- **Tactic alvo**: Cache strategy / Reduce Overhead
- **Segverity**: P3
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-6
- **Métricas de sucesso**:
  - Requests a `/api/filiais` por sessão (medido): baseline → 1
  - TTL respeitado (não fica dado stale > 30 min)
- **Risco de não fazer**: ruído baixo — mas a lista de filiais é usada por múltiplas telas, então o ganho se multiplica.
- **Dependências**: alinhamento com Frente IV (mesmo `fetchFiliais`).

### [performance-7] Lazy-load `TrilhaDrawer` via `next/dynamic`

- **Problema**
  > `TrilhaDrawer` importa `date-fns` + locale ptBR estaticamente e é referenciado por `page.tsx`. Como o drawer só abre sob clique, todo esse peso entra no First Load JS sem necessidade.

- **Melhoria Proposta**
  > Trocar `import { TrilhaDrawer } from './components/TrilhaDrawer'` por `const TrilhaDrawer = dynamic(() => import('./components/TrilhaDrawer'), { ssr: false })`. Manter `Suspense` fallback com o mesmo `Skeleton` já usado.

- **Resultado Esperado**
  > First Load JS de `/aprovacoes`: **⚠️ Não medível localmente (`--quick`) → alvo ≤ 200 KB p95**.
  > Peso do `TrilhaDrawer` sai do bundle inicial.

- **Tactic alvo**: Bundle leanness / Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-7
- **Métricas de sucesso**:
  - Tamanho de `page.tsx` no output de `next build`: baseline → -25 a -40 KB
  - TTI da rota em 4G simulado: baseline → -100 a -300 ms
- **Risco de não fazer**: mobile users e primeira navegação ficam ~200 ms mais lentos.
- **Dependências**: nenhuma. Cross-QA com Deployability (bundle).

### [performance-8] Adicionar budget wall-clock + `AbortController` na ingestão

- **Problema**
  > O job de ingestão da Frente V não tem timeout total nem `AbortController` por chamada ERP. Uma degradação lenta do Conexos (5+ min por request) segura o advisory lock e trava a próxima janela de cron sem alarme claro.

- **Melhoria Proposta**
  > (a) Envolver a execução em `PollExecutor`/`Promise.race` com budget de 2 h por execução, gravando `status=error` com motivo "budget_exceeded" quando estoura.
  > (b) Passar `AbortSignal` para o `apiFetch` do `ConexosBaseClient` com timeout de 30 s por request (cross-QA com Availability — mesmo card serve ambos os QAs).
  > (c) Alarme "ingestão em andamento há > 2 h" via query em `aprovacao_ingestao_run`.

- **Resultado Esperado**
  > Wall-clock máximo por execução: **ilimitado → ≤ 2 h**.
  > Tempo até o operador saber: **desconhecido → ≤ 5 min após estouro**.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-8
- **Métricas de sucesso**:
  - Timeout HTTP por chamada Conexos: sem → 30 s
  - Runs com `status=error` e motivo "budget_exceeded" quando aplicável: existe métrica
- **Risco de não fazer**: falha silenciosa do ERP vira dado stale sem alerta; cross-QA com Availability e Fault Tolerance.
- **Dependências**: instrumentação em `ConexosBaseClient` (compartilhada com outros clients).

## 6. Notas do agente

- Escopo desta seção é o delta da Frente V; performance de outras frentes só entrou quando serviu de contraste (uso do `BoundedConcurrency` por Cadastro/Fin014 vs. Frente V que não usa).
- **Não medível localmente com `--quick`**: (a) `next build` — bundle real da rota `/aprovacoes`; (b) `EXPLAIN ANALYZE` das queries do grid em base cheia (sem produção); (c) latência real do endpoint sob carga.
- **Cross-QA**:
  - F-performance-4 e F-performance-5 (índices) sobrepõem-se a **Modifiability** — schema como código deveria ser revisado junto.
  - F-performance-7 (bundle) sobrepõe-se a **Deployability**.
  - F-performance-8 (timeouts) sobrepõe-se a **Availability** e **Fault Tolerance** — mesmo card resolve os três.
- Números-chave usados nos cálculos: 23.632 títulos (medido — filial 2 / 12 m); PAGE_SIZE=500; MAX_PAGINAS=200; p50 ERP assumido 500 ms (banda típica reportada); pool Postgres `max=5`.
