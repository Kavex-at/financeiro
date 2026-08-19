---
qa: Availability
qa_slug: availability
run_id: 2026-08-19-1603
agent: qa-availability
generated_at: 2026-08-19T16:03:00-03:00
scope: backend
score: 6
findings_count: 9
cards_count: 7
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Contexto do delta: a Frente V (`feat/frente-v-aprovacoes`) é um *vertical slice* composto por
(a) um job de ingestão que faz **1 chamada ao ERP por título** — 23.632 títulos só na filial 2 em
12 meses — com cursor de retomada em `aprovacao_ingestao_run` protegido por advisory lock, e
(b) um painel Next.js que lê **do Postgres local**, nunca do ERP (ADR-0038 D3). A rota é
read-only no ERP; o gate `APROVACOES_ENABLED` é fail-safe em produção. Nada disso jamais rodou
contra um Postgres real ou contra o ERP real — só contra dublês (ver
`docs/runbooks/frente-v-primeira-ingestao.md`).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| ERP Conexos (`psq014`/`fin026`) | Indisponibilidade transitória (5xx/timeout) durante o backfill de ~23.6k títulos | `IngestaoAprovacoesService.executar` + `ConexosAprovacoesClient.listTrilha` | Backfill inicial em homologação; produção ainda não estreou | Retomar do cursor gravado após o último título persistido, sem varredura duplicada e sem duplicar linhas no snapshot | 0 títulos perdidos; snapshot mantém `observado_em` da última execução completa; MTTR do backfill ≤ 1 janela de execução manual |
| ERP Conexos | Recusa determinística (4xx) para UM título específico | `IngestaoAprovacoesService.processarTitulo` | Backfill em curso | Registrar a lacuna, pular o título e continuar a varredura em vez de abortar a run inteira | ≥ 99% dos títulos processados na presença de 1 título "poison"; hoje = 0% após o título problemático |
| Analista consumindo o painel | ERP fora do ar por horas | `routes/aprovacoes.ts` → `AprovacoesPainelService` → Postgres local | Produção | Servir o snapshot local com `snapshotEm` exibido (invariante I7 — degradação anunciada) | 100% disponibilidade do painel independentemente do ERP; usuário vê a idade do dado |
| Runner do job (Render/CI) | OOM-kill ou deploy no meio da run | `AprovacaoIngestaoRunRepository` | Backfill em curso | Advisory lock cai com a sessão; run permanece `running`+`finished_at IS NULL`; próxima chamada com `RETOMAR=1` continua do cursor | 100% dos títulos já persistidos preservados; janela até detectar a run pendurada = **hoje não é medida** (F-availability-6) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Timeout HTTP explícito no cliente Conexos | 40.000 ms | ≤ 30.000 ms para leitura não-idempotente | ⚠️ | `src/backend/services/conexos.ts:121` (axios.create timeout) |
| Retentativas por chamada ao ERP (leitura) | 2 tentativas totais (`retries: 2`, `delayMs: 500`, `jitterMs: 200`) sem backoff exponencial | 3–5 tentativas com backoff exponencial + jitter completo | ⚠️ | `src/backend/domain/client/ConexosBaseClient.ts:141-149` + `RetryExecutor.ts:38-53` |
| Classificação de erro determinístico (4xx não-transiente) | Presente — `isDeterministicRefusal` gate no `shouldRetry` (408/429 continuam retentáveis) | Manter | ✅ | `src/backend/domain/errors/ErpResponseReader.ts:57-62` |
| Retry policy no repositório de banco | 3 tentativas, 200 ms + jitter, whitelisted em erros conhecidos (`MaxClientsInSessionMode`, `ECONNRESET`, …) | Manter | ✅ | `PostgreeDatabaseClient.ts:34-43` |
| Advisory lock no job de ingestão | Presente — `withAdvisoryLock(APROVACOES_INGEST_LOCK_KEY, …)`; segunda execução sai sem escrever | Manter | ✅ | `src/backend/jobs/ingest-aprovacoes.ts:71-83` + `PostgreeDatabaseClient.ts:137-155` |
| Cursor de retomada gravado **depois** de cada título persistido | Presente — `salvarCursor(runId, {filCod, pagina, docCod}, {titulos, etapas})` chamado após `processarTitulo` | Manter | ✅ | `IngestaoAprovacoesService.ts:118-124` + `AprovacaoIngestaoRunRepository.ts:41-70` |
| Idempotência do snapshot | UPSERT por chave natural `(filCod, docCod, titCod)` — repetir um título é inócuo | Manter | ✅ | `AprovacoesSql` + `IngestaoAprovacoesService.ts:174-208` |
| Tolerância a "poison title" (Ignore Faulty Behavior) | Ausente — try/catch envolve o loop inteiro; um único título com 4xx determinístico aborta a run inteira | Skip do título com lacuna registrada; run continua | ❌ | `IngestaoAprovacoesService.ts:96-138` (não há try por título) |
| Cron do job de ingestão | **Ausente** — `.github/workflows/` tem 4 workflows (`ci`, `ingest-extratos`, `ingest-permutas`, `ingest-sispag`); `ingest-aprovacoes.yml` **não existe** | Cron configurado (ex.: diário) + alerta de idade do snapshot | ❌ | `ls .github/workflows/` |
| Watchdog para runs `running` órfãs | Ausente — nenhuma query alerta sobre `status='running' AND finished_at IS NULL AND started_at < now() - <threshold>` | Job/consulta que sinaliza runs pareadas há > X horas | ❌ | grep sem hits em `src/backend` |
| Circuit breaker no cliente do ERP | Ausente — `retries: 2` isoladas por chamada; nenhum "abrir após N falhas consecutivas" | Breaker que aborta o job cedo quando o ERP está fora | ❌ | grep `CircuitBreaker\|opossum\|breaker` sem hits em `src/backend` (0 imports) |
| Endpoint `/health` | Estático: `res.json({ status: 'ok', version: APP_VERSION })` — não bate no DB nem valida sessão do ERP | Sondar DB + sessão do ERP (SID) e responder 200/503 | ⚠️ | `src/backend/index.ts:78` |
| Kill-switch de leitura em produção | Presente — `aprovacoesGate` retorna 403 quando `APROVACOES_ENABLED !== 'true'` em produção; alterável no dashboard do Render sem redeploy | Manter | ✅ | `src/backend/http/aprovacoesGate.ts:14-22` + `EnvironmentProvider.ts:73-79` |
| Escritas no ERP na Frente V | 0 — cliente não expõe `postGenericOnce`/`postGeneric` de escrita (ADR-0038 D2) | Manter | ✅ | `ConexosAprovacoesClient.ts` (só `postGeneric` de leitura via base) |
| Painel desacoplado do ERP em runtime | Presente — leitura sai do Postgres local; `snapshotEm` exposto na UI (I7) | Manter | ✅ | `AprovacoesPainelService.ts` + `routes/aprovacoes.ts:100-118` |
| Sanity checking na fronteira HTTP | Presente — Zod em `listQuerySchema` e `trilhaParamsSchema`; ID revalidado no service (`parseId`) | Manter | ✅ | `routes/aprovacoes.ts:65-82` |
| Sanity checking em SQL | Presente — CHECK em `status_workflow`, `status`, `status` da run + PK composta com `fil_cod` obrigatório (invariante I5) | Manter | ✅ | `migrations/0049_aprovacao_trilha.sql` |
| Observabilidade externa (Sentry/Datadog/OpsGenie) | 0 imports/refs — logs vão a stdout do Render | Instrumentar erros do job e do gate em serviço externo | ❌ | grep sem hits |

> ⚠️ **Não medível localmente**: MTTR real da ingestão em produção. Requer instrumentação de
> duração das transições `running → success|error` na tabela `aprovacao_ingestao_run` + dashboard
> externo. Recomendação: expor `finished_at - started_at` como métrica agregada (p50/p95) e
> alarme quando `now() - max(finished_at where status='success') > 24h` (idade máxima do snapshot
> aceitável).
>
> ⚠️ **Não medível localmente**: taxa real de 4xx determinístico do ERP por título. Requer a
> primeira ingestão contra ERP real (runbook `docs/runbooks/frente-v-primeira-ingestao.md`).
> Enquanto isso, F-availability-1 é dimensionado por *design* (0 caminhos de skip), não por
> incidência observada.

## 3. Tactics — Cobertura no nf-projects

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | `/health` estático — não testa DB nem sessão do ERP | ⚠️ parcial | `src/backend/index.ts:78` |
| Heartbeat | Sem heartbeat do job — não há sinal periódico de "estou vivo" durante o backfill | ❌ ausente | busca por batidas periódicas no service não retorna nada |
| Monitor | Logs `console.log`/`console.error` para stdout do Render; sem coletor externo | ⚠️ parcial | `ingest-aprovacoes.ts:96` + ausência de SDK de observabilidade |
| Timestamp | `observado_em`, `started_at`, `finished_at`, `cursor_doc_cod` gravados em todo registro | ✅ presente | `migrations/0049_aprovacao_trilha.sql` (`observado_em`, `started_at`, `finished_at`) |
| Sanity Checking | Zod na fronteira HTTP + CHECK em SQL + `parseId` no service | ✅ presente | `routes/aprovacoes.ts:65-82`, `migrations/0049_aprovacao_trilha.sql` (CHECK) |
| Condition Monitoring | Tabela `aprovacao_ingestao_run` guarda estado, mas nenhum consumidor externo verifica run pendurada | ⚠️ parcial | `AprovacaoIngestaoRunRepository.ts:91-118` sem watchdog acoplado |
| Voting | N/A | N/A | Fonte única (ERP → Postgres local); sem redundância comparável |
| Exception Detection | `asyncHandler` + `respondHandlerError` + `ConexosError` classificado por `ErpResponseReader` | ✅ presente | `http/asyncHandler.ts`, `errors/ErpResponseReader.ts:57-62` |
| Self-Test | Runbook declara que o SQL nunca rodou contra Postgres real e a ingestão nunca contra o ERP | ❌ ausente | `docs/runbooks/frente-v-primeira-ingestao.md` §Prefácio |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A | N/A | Render single-instance; sem replicação hot-hot |
| Passive Redundancy | N/A | N/A | idem |
| Spare | N/A | N/A | idem |
| Exception Handling | Try/catch envolve o loop inteiro; single-title 4xx aborta a run | ⚠️ parcial | `IngestaoAprovacoesService.ts:96-138` |
| Rollback | Nenhuma escrita no ERP (D2); DB writes são UPSERT por título — desnecessário reverter | ✅ presente | `ConexosAprovacoesClient.ts` (só leitura) |
| Software Upgrade | N/A | N/A | Render redeploy padrão; não há hot-swap de código do job |
| Retry | `RetryExecutor` com 2 tentativas totais, 500ms fixo + jitter 200ms; `shouldRetry` gate 4xx determinístico | ⚠️ parcial | `ConexosBaseClient.ts:141-149` + `RetryExecutor.ts:38-53` — sem backoff exponencial |
| Ignore Faulty Behavior | Não existe caminho para pular um título problemático; a run aborta | ❌ ausente | `IngestaoAprovacoesService.ts:96-138` (loop sem catch por título) |
| Degradation | ADR-0038 D3: painel lê snapshot local, jamais o ERP — degradação deliberada e anunciada por `snapshotEm` | ✅ presente | `AprovacoesPainelService.ts` + I7 (`AprovacoesListResponse.snapshotEm`) |
| Reconfiguration | `APROVACOES_ENABLED` no dashboard do Render alterna o gate sem redeploy | ✅ presente | `aprovacoesGate.ts:14-22` + `EnvironmentProvider.ts:73-79` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A | N/A | Não há deploy shadow do job |
| State Resynchronization | Cursor `(cursor_fil_cod, cursor_pagina, cursor_doc_cod)` + UPSERT idempotente + `RETOMAR=1` | ✅ presente | `IngestaoAprovacoesService.ts:102-124` + `AprovacaoIngestaoRunRepository.ts:41-70` |
| Escalating Restart | `process.exit(1)` em falha, mas nenhuma escalada automática — depende do runner externo | ⚠️ parcial | `ingest-aprovacoes.ts:96-101` |
| Non-Stop Forwarding | N/A | N/A | Job batch — não roteia tráfego |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | Advisory lock evita ingestões concorrentes; gate `APROVACOES_ENABLED` remove a rota | ✅ presente | `ingest-aprovacoes.ts:71-83`, `aprovacoesGate.ts:14-22` |
| Transactions | `withTransaction` disponível no `PostgreeDatabaseClient`; ingest não envelopa cada título em transação explícita — depende do UPSERT/atomicidade do `sincronizarTrilha` | ⚠️ parcial | `PostgreeDatabaseClient.ts:103-125` + `IngestaoAprovacoesService.ts:161` (chamada única a `sincronizarTrilha`) |
| Predictive Model | Ausente — nenhum alerta antecipa degradação do ERP ou saturação | ❌ ausente | busca vazia |
| Exception Prevention | Cliente read-only por construção (ADR-0038 D2); Zod + regex no ID; `filCod` proibido de vir com default (I5) | ✅ presente | `ConexosAprovacoesClient.ts` (docstring D2) + `routes/aprovacoes.ts:78-82` |
| Increase Competence Set | Lacunas de primeira classe (`LACUNA.*`) + status `INDETERMINADO` explícito para `ftbVldStatus=7` (PV-01); `status_erp` bruto preservado para reclassificação futura sem re-ingestão | ✅ presente | `migrations/0049_aprovacao_trilha.sql` (`status_erp`, `lacunas`) + `constants.ts` |

## 4. Findings (achados)

### F-availability-1: Ingestão aborta a run inteira em falha determinística de UM título

- **Severidade**: P1 (alto — bloqueia o backfill de 23.632 títulos até intervenção manual)
- **Tactic violada**: Ignore Faulty Behavior
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:96-138`
- **Evidência (objetiva)**:
  ```
  try {
      for (const filCod of params.filCods) {
          for (let pagina = paginaInicial; pagina <= MAX_PAGINAS; pagina++) {
              const { rows } = await this.gateway.listUniverso(...);
              for (const row of rows) {
                  const persistidas = await this.processarTitulo(row, filCod, runId); // ← lança propaga
                  ...
              }
          }
      }
  } catch (error) {
      await this.runRepository.finalizar(runId, 'error', mensagem);
      throw error;
  }
  ```
  Qualquer erro dentro de `processarTitulo` (4xx determinístico não-retentado por `shouldRetry`) escapa
  do loop e aborta a run. Na retomada com `RETOMAR=1`, o cursor aponta para o **último título que
  gravou com sucesso** (não para o que falhou), então o loop cai no mesmo título e falha de novo.
- **Impacto técnico**: um único título com payload divergente do esperado (código de doc órfão,
  filial obsoleta, status novo do ERP) transforma o backfill num loop infinito de "roda → falha
  no título N → roda → falha no título N". Não há degradação parcial: 100% dos títulos posteriores
  ao poison ficam ausentes do snapshot até alguém entrar no banco e mexer no cursor à mão.
- **Impacto de negócio**: o painel entra no ar com um snapshot **incompleto por filial** (títulos
  emitidos após a data do problema não aparecem), e o cliente vê "SEM_WORKFLOW" para títulos que
  na verdade têm trilha — o falso negativo é indistinguível de um bug de I5. Frente V estreia
  com dado errado.
- **Métrica de baseline**: 0 caminhos `catch` por título nas linhas 96-138 de `IngestaoAprovacoesService.ts`.
  1 título poison → 100% dos títulos remanescentes da varredura ficam sem processar.

### F-availability-2: Job de ingestão sem cron — nenhum refresh automático do snapshot

- **Severidade**: P1 (alto — anula a tactic Degradation em que o painel se apoia)
- **Tactic violada**: Heartbeat + Condition Monitoring (não há sinal periódico; a idade do snapshot
  cresce sem alarme)
- **Localização**: `.github/workflows/` (ausência de `ingest-aprovacoes.yml`); `docs/runbooks/frente-v-primeira-ingestao.md` (execução manual `npm run job:ingest-aprovacoes`)
- **Evidência (objetiva)**:
  ```
  $ ls .github/workflows/
  ci.yml
  ingest-extratos.yml
  ingest-permutas.yml
  ingest-sispag.yml
  # ingest-aprovacoes.yml NÃO existe
  ```
- **Impacto técnico**: o painel serve `snapshotEm` da última execução manual. Sem cron, essa
  data envelhece indefinidamente. A invariante I7 obriga a UI a exibir a idade, mas exibir "45
  dias atrás" não é degradação sustentável, é dado velho maquiado como recente.
- **Impacto de negócio**: a Degradation deliberada (D3, painel desacoplado do ERP) só compensa
  se o snapshot é fresco. Sem cron, a tactic vira "painel de dados congelados". O cliente aceita
  atraso mensurável, não atraso indefinido.
- **Métrica de baseline**: `ingest-aprovacoes.yml` = 0 arquivos; idade média do snapshot em
  produção após 30 dias sem intervenção = 30 dias.

### F-availability-3: Retry sem backoff exponencial em varredura de 23k+ chamadas

- **Severidade**: P1 (alto — amplifica falha transiente em falha total do backfill)
- **Tactic violada**: Retry
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts:141-149` + `src/backend/domain/libs/executor/RetryExecutor.ts:38-53`
- **Evidência (objetiva)**:
  ```
  this.retryExecutor = new RetryExecutor({
      retries: 2,
      delayMs: 500,
      shouldLog: true,
      jitterMs: 200,
      shouldRetry: (error) => !ErpResponseReader.isDeterministicRefusal(error),
  });
  ```
  `RetryExecutor.execute`: `wait = delayMs + Math.random()*jitterMs` — constante entre iterações,
  sem crescimento exponencial. `retries: 2` = 2 tentativas totais, não 1+2.
- **Impacto técnico**: numa degradação transiente do ERP de mais de ~1s, ambas as tentativas
  caem juntas. Cada título com falha derruba o backfill (via F-availability-1). Além disso, uma
  janela de indisponibilidade curta pode encavalar as tentativas de dezenas de títulos em
  paralelo (pilha do executor não coordena entre chamadas).
- **Impacto de negócio**: uma "piscada" de 2 segundos do ERP — evento rotineiro — faz o
  backfill inteiro precisar de intervenção. Para uma frente que se anuncia como assistida por
  humano, isso é frequência de alerta que o time de operações não vai sustentar.
- **Métrica de baseline**: `delayMs: 500`, `retries: 2` em `ConexosBaseClient.ts:141-149`. Janela
  máxima de tolerância a degradação transiente < 1.4s (0.5 + 0.2 jitter + 0.5 + 0.2 jitter).

### F-availability-4: Nenhum self-test — SQL nunca rodou contra Postgres real, ingest nunca contra ERP

- **Severidade**: P1 (alto — a primeira execução em produção é o primeiro contato com dependências reais)
- **Tactic violada**: Self-Test
- **Localização**: `docs/runbooks/frente-v-primeira-ingestao.md` (declaração explícita da lacuna)
- **Evidência (objetiva)**:
  ```
  O SQL desta frente nunca tocou um Postgres real (não há banco na máquina de desenvolvimento;
  os testes usam dublês) e a ingestão nunca rodou — o job foi exercitado só contra fakes.
  ```
- **Impacto técnico**: sintaxe SQL, tipos de coluna, comportamento do UPSERT, semântica do
  advisory lock em transação-pool (Supavisor) — tudo isso é testado só contra dublês. A
  primeira ingestão pode falhar por motivos completamente diferentes de bug de negócio:
  `text` vs `varchar`, `TIMESTAMPTZ` vs `TIMESTAMP`, statement_timeout do banco alvo, etc.
- **Impacto de negócio**: risco de estreia adiada por falha infra que o teste não capturaria.
  A frente já carrega 10 pendências de validação de negócio (`frente-v-pendencias-validacao.md`);
  somar falha infra alonga o TTFA (time-to-first-availability) da frente para o cliente.
- **Métrica de baseline**: 0 execuções contra ERP real; 0 execuções contra Postgres real. Cobertura
  de teste = 100% dos caminhos com dublês, 0% com dependências reais.

### F-availability-5: `/health` estático não sonda dependências

- **Severidade**: P2 (médio — reduz visibilidade de falha de dependência, não causa falha)
- **Tactic violada**: Ping/Echo
- **Localização**: `src/backend/index.ts:78`
- **Evidência (objetiva)**:
  ```
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: APP_VERSION }));
  ```
- **Impacto técnico**: se o Postgres cair mas o processo Express seguir vivo, `/health` continua
  200 e nenhum consumidor externo (Render, load balancer, uptime robot) enxerga a
  indisponibilidade. Idem para sessão do ERP expirada.
- **Impacto de negócio**: o painel volta 500 antes de o operador ver alarme externo. Erra a
  premissa de "degradação anunciada" da Frente V.
- **Métrica de baseline**: 0 dependências verificadas por `/health`; healthcheck só valida `res.json`.

### F-availability-6: Nenhum watchdog para runs órfãs em `running`

- **Severidade**: P2 (médio — depende de outro operador para destravar; risco moderado)
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts:91-118`
- **Evidência (objetiva)**: `ultimaRunRetomavel()` **espera** que exista uma run pendurada e a
  devolve para retomada, mas nenhum consumidor externo alerta que ela existe. Sem
  `RETOMAR=1` explícito no próximo `npm run job:ingest-aprovacoes`, a run fica órfã indefinidamente
  e a próxima ingestão inicia uma nova run (dobra trabalho).
- **Impacto técnico**: um OOM-kill do runner deixa a tabela com `status='running'` até alguém
  reparar. Uma segunda ingestão sem `RETOMAR=1` cria uma nova run em paralelo até o advisory
  lock impedir; se as janelas não colidirem no lock, o backfill dobra de custo no ERP.
- **Impacto de negócio**: quota consumida em dobro no ERP (constrangimento com Conexos) e
  latência na estreia do painel para o cliente.
- **Métrica de baseline**: 0 alertas/queries sobre `finished_at IS NULL AND started_at < now() - interval '2h'`.

### F-availability-7: Nenhum circuit breaker — job insiste durante indisponibilidade prolongada do ERP

- **Severidade**: P2 (médio — desperdício de recurso, não perda de dado)
- **Tactic violada**: Removal from Service (do lado do consumidor do ERP)
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts` (sem breaker) + `IngestaoAprovacoesService.ts` (sem short-circuit por falhas consecutivas)
- **Evidência (objetiva)**: 0 hits para `CircuitBreaker|opossum|breaker` em `src/backend`. A única
  proteção é o `retries: 2` isolado por chamada.
- **Impacto técnico**: com ERP fora do ar, cada título consome `2 * (timeout_axios + delayMs) ~= 2 * 40.5s = 81s`
  antes de propagar. Para 23.632 títulos, o job insistiria por ~22 dias antes de "descobrir"
  que o ERP está indisponível.
- **Impacto de negócio**: uma janela de indisponibilidade de 30 min do ERP no meio de um
  backfill custa uma execução manual e horas de operação; a mesma falha, com breaker, custaria
  minutos.
- **Métrica de baseline**: 0 breakers configurados; pior caso de detecção de indisponibilidade
  do ERP = `MAX_PAGINAS * PAGE_SIZE * (2 * 40s + jitter)` = ~22 dias.

### F-availability-8: Sem observabilidade externa — erros só em stdout do Render

- **Severidade**: P2 (médio — atrasa detecção)
- **Tactic violada**: Monitor
- **Localização**: sem imports Sentry/Datadog/OpsGenie em `src/backend`; `ingest-aprovacoes.ts:96`
  loga em `console.error` e sai
- **Evidência (objetiva)**: `grep Sentry|Datadog|OpsGenie|newrelic src/backend` → 0 hits.
- **Impacto técnico**: uma run que falhou com `finalizar(runId,'error',mensagem)` só é notada por
  quem abrir o log do Render ou consultar a tabela `aprovacao_ingestao_run` à mão.
- **Impacto de negócio**: MTTD (mean time to detect) de erro do job = "quando alguém lembrar de
  olhar". Se combinada com F-availability-2 (sem cron), o painel pode envelhecer semanas sem que
  ninguém perceba.
- **Métrica de baseline**: 0 integrações de observabilidade em backend.

### F-availability-9: Cursor não filtra rows dentro da página retomada — reprocessa até 500 títulos

- **Severidade**: P3 (baixo — inócuo por causa do UPSERT, mas custa quota no ERP)
- **Tactic violada**: State Resynchronization (subótima)
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:101-116`
- **Evidência (objetiva)**:
  ```
  const paginaInicial =
      retomada?.cursorFilCod === filCod ? (retomada.cursorPagina ?? 1) : 1;

  for (let pagina = paginaInicial; pagina <= MAX_PAGINAS; pagina++) {
      const { rows } = await this.gateway.listUniverso(...);
      for (const row of rows) {  // sem filtro por row.docCod > cursorDocCod
          ...
      }
  }
  ```
  O cursor guarda `cursor_doc_cod` (linha 122-124), mas o loop de linhas não o consulta para
  pular títulos já processados.
- **Impacto técnico**: retomar no meio de uma página custa até 500 chamadas extras ao ERP para
  produzir o mesmo UPSERT. Inócuo para o dado, mas consome quota e alonga a janela do backfill.
- **Impacto de negócio**: cada retomada = alguns minutos extras contra o ERP. Aceitável, mas
  ineficiente para a operação diária.
- **Métrica de baseline**: `PAGE_SIZE = 500` em `IngestaoAprovacoesService.ts:26`; custo de
  retomada no pior caso = 500 chamadas × latência p95 do ERP.

## 5. Cards Kanban

### [availability-1] Tolerar título "poison" no backfill (skip + registra lacuna)

- **Problema**
  > Hoje, uma falha determinística (4xx não-transiente) em UM título aborta a run inteira e a
  > retomada com `RETOMAR=1` cai no mesmo título. O backfill de 23.632 títulos fica travado por
  > 1 título ruim, e todos os títulos posteriores ficam ausentes do snapshot — indistinguíveis
  > de `SEM_WORKFLOW` na UI.

- **Melhoria Proposta**
  > Envelopar `processarTitulo` num try/catch dedicado dentro do loop de rows. Em erro
  > determinístico (`ErpResponseReader.isDeterministicRefusal`), gravar uma linha em
  > `aprovacao_titulo` com `lacunas: ['INGESTAO_FALHOU']` + `status_workflow: 'INDETERMINADO'`,
  > incrementar o cursor **incluindo o docCod problemático**, e continuar. Em erro transitório
  > (rede/timeout/5xx), propagar como hoje (deixa a run falhar para retomar).
  > Tactic alvo: Ignore Faulty Behavior + Increase Competence Set (adicionar `LACUNA.INGESTAO_FALHOU`).
  > Arquivos: `IngestaoAprovacoesService.ts` (lines 96-138), `interface/aprovacoes/constants.ts`
  > (novo membro em `LACUNA`).

- **Resultado Esperado**
  > Um título poison degrada 1 linha (com lacuna visível) em vez de derrubar a varredura.
  > Métrica: com N títulos poison presentes, títulos processados = total_universo - N (era 0
  > após o primeiro poison).

- **Tactic alvo**: Ignore Faulty Behavior
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Títulos processados com 1 título poison presente: 0 → total_universo − 1
  - Aparição da lacuna `INGESTAO_FALHOU` na UI para exigir triagem
- **Risco de não fazer**: 6 meses sem essa tolerância significam que qualquer variação de payload
  do ERP (schema drift) trava o painel para o cliente com um snapshot parcial e sem alarme.
- **Dependências**: nenhuma

### [availability-2] Cronificar `ingest-aprovacoes` + alerta de idade do snapshot

- **Problema**
  > O job só roda manualmente (`npm run job:ingest-aprovacoes`). Sem cron, `snapshotEm` cresce
  > indefinidamente e a Degradation deliberada (D3) vira "painel de dados congelados", violando
  > a premissa da tactic.

- **Melhoria Proposta**
  > Adicionar `.github/workflows/ingest-aprovacoes.yml` espelhando `ingest-permutas.yml` (mesmas
  > secrets, mesmo runner) com cron inicial de 1× por dia (ex.: `0 6 * * *`) restrito às filiais
  > acordadas. Instrumentar uma consulta simples no boot da API que retorna 200/503 conforme
  > `now() - max(finished_at where status='success') <= 48h`, ou publicar essa métrica em um
  > endpoint dedicado `/aprovacoes/snapshot-age` para robô de uptime bater. Tactic alvo:
  > Heartbeat + Monitor.

- **Resultado Esperado**
  > Snapshot com idade limitada, alarme quando ela ultrapassar o alvo. Métrica: idade máxima
  > observável do snapshot em produção ≤ 48h (era ilimitada).

- **Tactic alvo**: Heartbeat
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2, F-availability-8
- **Métricas de sucesso**:
  - `.github/workflows/ingest-aprovacoes.yml`: 0 → 1 arquivo
  - Idade p95 do snapshot em produção: N/A → ≤ 48h
  - Alarme de idade excedida: 0 → 1
- **Risco de não fazer**: o painel vai ao ar apoiado numa premissa (dados frescos) que não é
  garantida em runtime — o cliente vai reclamar de dado "atrasado" e o time descobre pelo
  cliente, não pela plataforma.
- **Dependências**: primeira ingestão em homologação (Card 4)

### [availability-3] Backoff exponencial + mais tentativas no cliente de leitura do ERP

- **Problema**
  > `RetryExecutor` está com `retries: 2` e `delayMs: 500` fixos (com jitter). Janela de
  > tolerância a transiente < 1.4s — abaixo do típico de piscadas de rede num integrador que
  > carrega 23k+ chamadas por rodada. Combinado com F-availability-1, uma piscada breve = run
  > abortada.

- **Melhoria Proposta**
  > Adicionar suporte a `backoffFactor` no `RetryExecutor` (delay = base × factor^n + jitter).
  > Instanciar dedicado no `ConexosBaseClient` de leitura com `retries: 4`, `delayMs: 300`,
  > `backoffFactor: 2` (300ms → 600 → 1200 → 2400 + jitter). Manter `shouldRetry` como está.
  > Tactic alvo: Retry.

- **Resultado Esperado**
  > Janela de tolerância a transiente ~5s; taxa de falhas em rodada estável em cenário de
  > piscadas curtas. Métrica: MTTF por título (falhas por 1000 chamadas) medida na primeira
  > ingestão real.

- **Tactic alvo**: Retry
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Janela máxima de degradação transiente tolerada: 1.4s → ~5s
  - Runs abortadas por causa transiente em N=10 execuções piloto: baseline TBD → 0
- **Risco de não fazer**: cada piscada do ERP vira intervenção manual; frente pouco sustentável
  em regime de operação diária.
- **Dependências**: nenhuma; independente do Card 1 mas complementar

### [availability-4] Smoke test de estreia: SQL + ingestão contra homologação real

- **Problema**
  > Toda a Frente V foi testada só contra dublês. O SQL nunca tocou Postgres real; a ingestão
  > nunca tocou ERP real. A primeira execução em produção é o primeiro teste real de
  > infraestrutura, misturado com todas as pendências de negócio (PV-01..PV-10).

- **Melhoria Proposta**
  > Executar o roteiro do runbook `docs/runbooks/frente-v-primeira-ingestao.md` § Fase 1 em
  > homologação (`FILS=3` primeiro, depois `FILS=2`) antes da estreia em produção. Instrumentar
  > o resultado como *acceptance evidence* no ADR-0038 (uma seção "Estreia") com contagens,
  > lacunas observadas e tempo de ingestão. Tactic alvo: Self-Test.

- **Resultado Esperado**
  > Contato controlado com dependências reais antes de estrear em produção. Métrica: 1 rodada
  > completa contra homologação + banco real, com números publicados no ADR.

- **Tactic alvo**: Self-Test
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Execuções contra ERP real: 0 → ≥ 1
  - Execuções contra Postgres real: 0 → ≥ 1
  - Métricas de idempotência confirmadas (re-run não dobra `COUNT(*)`): baseline TBD → confirmado
- **Risco de não fazer**: estreia adiada por falha infra descoberta em produção; retrabalho
  no runbook.
- **Dependências**: banco de homologação provisionado com sessão de ERP válida

### [availability-5] `/health` sonda DB e sessão do ERP

- **Problema**
  > `/health` responde 200 estático mesmo com Postgres fora ou sessão do ERP expirada. Nenhum
  > consumidor externo (uptime robô, Render, load balancer) consegue diferenciar processo vivo
  > de processo servindo erro.

- **Melhoria Proposta**
  > Adicionar `/health/deep` que executa `SELECT 1` no `PostgreeDatabaseClient` e `ensureSid`
  > no `ConexosBaseClient` com timeout de 2s; devolve 200 quando ambos passam, 503 caso contrário.
  > Manter `/health` raso para probe de liveness. Tactic alvo: Ping/Echo.

- **Resultado Esperado**
  > Uptime robô/Render enxerga a diferença entre "processo vivo" e "processo saudável".
  > Métrica: taxa de false-green de healthcheck em cenário de DB fora: 100% → ≤ 5%.

- **Tactic alvo**: Ping/Echo
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Endpoints de health: 1 (raso) → 2 (raso + deep)
  - Detecção de DB fora pelo healthcheck: 0% → 100%
- **Risco de não fazer**: falhas de dependência descobertas pelo cliente, não pela plataforma.
- **Dependências**: nenhuma

### [availability-6] Watchdog para runs `running` órfãs

- **Problema**
  > `AprovacaoIngestaoRunRepository.ultimaRunRetomavel()` existe, mas ninguém consulta
  > proativamente. Runs órfãs (OOM-kill, deploy no meio) ficam em `running` até alguém entrar
  > no banco. Sem `RETOMAR=1`, a próxima ingestão inicia nova run e dobra trabalho no ERP.

- **Melhoria Proposta**
  > Adicionar uma query no boot ou num endpoint interno (`GET /aprovacoes/health/runs`) que
  > liste runs com `status='running' AND finished_at IS NULL AND started_at < now() - interval '2h'`.
  > Se combinada com o Card 2, o cron de ingest lê essa lista antes de rodar e aciona
  > `RETOMAR=1` automaticamente quando há órfã. Tactic alvo: Condition Monitoring.

- **Resultado Esperado**
  > Runs órfãs detectadas e retomadas sem intervenção humana. Métrica: tempo entre orfandade
  > e retomada: manual (ilimitado) → ≤ 1 janela de cron.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-6
- **Métricas de sucesso**:
  - Runs órfãs abandonadas por > 24h em produção: baseline TBD → 0
  - Retomada automática de run órfã: manual → automática via cron
- **Risco de não fazer**: quota ERP consumida em dobro em cenários de crash + relançamento manual.
- **Dependências**: Card 2 (cron)

### [availability-7] Circuit breaker no cliente Conexos para short-circuitar backfill em outage prolongado

- **Problema**
  > Sem breaker, uma indisponibilidade prolongada do ERP faz o job iterar 23k+ chamadas gastando
  > 40s cada em timeout antes de propagar a falha. Detecção de outage por parte do job = ~22
  > dias no pior caso.

- **Melhoria Proposta**
  > Adicionar um contador de falhas consecutivas por sessão do `ConexosBaseClient` (ex.: se 20
  > chamadas seguidas retornam erro transiente, abrir o breaker por 30 min). No `IngestaoAprovacoesService`,
  > interpretar `CircuitOpenError` como sinal para chamar `finalizar(runId,'error','ERP fora')`
  > e sair sem cursor apontando para o meio da página (para retomada limpa). Considerar
  > `opossum` ou implementação in-house com base em `RetryExecutor`. Tactic alvo: Removal from
  > Service.

- **Resultado Esperado**
  > Backfill aborta cedo em outage prolongado, libera slot do runner, alerta via cron reintroduz
  > o job quando o ERP volta. Métrica: tempo até detecção de outage do ERP pelo job: ~22 dias → ~10 min.

- **Tactic alvo**: Removal from Service
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-7
- **Métricas de sucesso**:
  - Chamadas ao ERP durante outage de 1h: potencialmente ~4500 (retry) → ≤ ~50 (breaker abre)
  - Tempo até `finalizar(runId,'error')` em outage: até ~22 dias → ≤ 15 min
- **Risco de não fazer**: uma janela de indisponibilidade custa ao time uma execução completa
  de operação manual, e o relacionamento com Conexos sofre com o volume de tentativas.
- **Dependências**: Card 3 (backoff), para não confundir "breaker abrindo" com "retry
  amplificando").

## 6. Notas do agente

- Não invoquei `npm test` (flag `--quick`); métricas de teste vêm do `_shared-metrics.md`.
- Não medí MTTR/MTTD reais — a Frente V nunca rodou contra ERP nem contra Postgres real
  (declaração explícita no runbook `docs/runbooks/frente-v-primeira-ingestao.md`); qualquer
  número real seria fabricado. Marcado como não medível.
- Assumi que P0 exige risco de perda de dado ou double-write. Como a Frente V é read-only no
  ERP e o snapshot local é UPSERT idempotente, nenhum finding foi classificado como P0.
- Cross-QA: F-availability-4 (self-test) conversa com **qa-testability** (cobertura de dublês
  vs. execução real) e com **qa-deployability** (roteiro de estreia); F-availability-8
  (observabilidade) conversa com **qa-fault-tolerance** e **qa-performance** (métricas de
  latência do job). Sinalizar ao consolidator para agrupar essas melhorias.
