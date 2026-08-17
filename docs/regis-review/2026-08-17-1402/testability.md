---
qa: Testability
qa_slug: testability
run_id: 2026-08-17-1402
agent: qa-testability
generated_at: 2026-08-17T14:02:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review

> Escopo: DELTA da feature `fix/nde-painel-lista` (aba NDe do painel de recebimentos + hidratação
> best-effort via com297). Não avalia a testabilidade repo-wide — só o que a feature adicionou,
> mudou e o que ficou visível de dívida pré-existente ao passar por ela.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev tocando `RecebimentosPainelService.hidratarNdes` ou `NdeRepository.listParaPainel` para atender novo requisito da aba NDe | Alteração de comportamento (ex.: mudar `PAINEL_NDE_HIDRATACAO_LOTE` de 5 → 10, adicionar filtro, ajustar derivação de `pendente/erro`) | `RecebimentosPainelService` (7 dependências) + `NdeRepository` (LEFT JOIN sobre `solicitacao_numerario_execucao`) + `NdeTable` (React) | Dev local com `jest --watch`, sem Postgres real | Suíte controla os collaborators com mocks unitários, prova a invariante alterada, roda em segundos | # casos de teste que exercitam a invariante alterada ≥ 1; tempo do feedback loop ≤ 10s por arquivo; 0 regressões nos e2e da rota `/recebimentos` que já eram verdes |

Cenário concreto do delta: o painel agora depende do `com297` para descobrir se o SEFAZ autorizou;
a resposta chega ASSÍNCRONA e a hidratação é best-effort. O ponto de risco de testabilidade é
observar o comportamento em **lote** (`LOTE=5`) e o comportamento em **falha silenciosa**
(`.catch(() => undefined)` em três lugares).

## 2. Métricas observadas

**Métrica observável #1 — cobertura por camada tocada pelo delta:**

| Camada (arquivo do delta) | LOC não-teste | LOC teste | Casos de teste (`it(`) | Ratio teste/impl | Alvo | Status |
|---|---|---|---|---|---|---|
| `domain/repository/recebimentos/NdeRepository.ts` | 185 | 178 | 6 | 0.96 | ≥ 0.8 | ✅ |
| `domain/service/recebimentos/RecebimentosPainelService.ts` | 326 | 241 | 15 (9 pré-existentes + 6 novos) | 0.74 | ≥ 0.6 | ✅ |
| `frontend/app/recebimentos/components/NdeTable.tsx` | 139 | 67 | 6 | 0.48 | ≥ 0.4 | ✅ |
| `routes/recebimentos.*.e2e.*.test.ts` (aba NDe end-to-end) | — | — | **0** | — | ≥ 1 (smoke) | ❌ |

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Casos novos adicionados pelo delta (backend) | 12 (6 NdeRepository + 6 RecebimentosPainelService) | ≥ 1 por invariante nova | ✅ | `git diff main -- '*.test.ts' | grep -c '^+.*it('` |
| Casos novos adicionados pelo delta (frontend) | 6 (arquivo novo `NdeTable.test.tsx`) | ≥ 1 por status derivado | ✅ | `jest --listTests` |
| Fakes e2e que exercitam a aba NDe ponta-a-ponta | 0 / 9 arquivos | ≥ 1 (smoke `/recebimentos` com 1 NDe emitida + 1 pendente) | ❌ | `grep -c "listParaPainel: async (): Promise<AnyRecord\[\]> => \[\]" src/backend/routes/*.test.ts` = 9 |
| `PAINEL_NDE_HIDRATACAO_LOTE` provado por teste | 0 casos verificam tamanho do lote | 1 caso (concorrência por batch) | ❌ | `RecebimentosPainelService.test.ts:232` — mede só o cap total (`toHaveLength(20)`), não o LOTE=5 |
| Assertions de SQL como string (`expect(sql).toContain(...)`) | 16 em `NdeRepository.test.ts` | Complementadas por 1 integration test de Postgres real | ⚠️ | `grep -c "expect(sql)" NdeRepository.test.ts` |
| Integration tests com Postgres real cobrindo o novo LEFT JOIN | 0 | ≥ 1 caso por SQL não-trivial | ❌ | Não existe `docker-compose.test.yml` — pré-existente, declarado no comment de `RecebimentoExecucaoRepository.test.ts:147` (dívida `testability-1`) |
| Dependências no construtor de `RecebimentosPainelService` | 7 | ≤ 5 (Bass — Limit Structural Complexity) | ⚠️ | `RecebimentosPainelService.ts:109-120` |
| Sítios de non-determinism no delta (`new Date()`, `Math.random`) | 3 (`RecebimentosPainelService.ts:150`, `NdeRepository.ts:161,182`) | Injetáveis via `ClockProvider` | ⚠️ | `grep -n "new Date" delta files` |
| Testes usam `jest.useFakeTimers()` no delta | 0 | 1 para o `geradoEm` (senão o snapshot muda no ano-novo) | ⚠️ | grep no arquivo de teste |
| Chamadas suprimidas por `.catch(() => undefined)` no delta sem observability | 3 (fiscalClient, setNdeAutorizado, updateNumeroNde) | 0 (log estruturado + assertion no teste) | ❌ | `RecebimentosPainelService.ts:282, 297, 300` |
| LogService injetado em `RecebimentosPainelService` | não (0/7 deps) | sim (irmãos `ConexosNdeEmitter`, `ProcessoProviderConexos`, `NumerarioAclChecker` injetam) | ❌ | `grep -c "logService" RecebimentosPainelService.ts` = 0 |
| Regressão introduzida pelo delta nos e2e da rota `/recebimentos` | 0 | 0 | ✅ | `_shared-metrics.md` — 14 falhas idênticas às da `main` (env `COM297_GCD_NOTA_DEBITO`) |
| Coverage (lines/branches) do delta | não medido | 80% / 70% | ⚠️ | `--quick`: não rodar `--coverage` |

> ⚠️ **Não medível localmente**: coverage numérica por linha/branch. Requer `jest --coverage`
> (contra-indicado por `--quick`). Recomendação: rodar em uma segunda passada ou colocar em CI.

> ⚠️ **Não medível localmente**: comportamento real do `Promise.all(lote)` sob rate-limit do
> Conexos. Requer sandbox com o `com297` mockado a nível HTTP (nock/msw) — o teste atual mocka o
> client TypeScript, não o transporte.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `NdeRepositoryInterface`, `SolicitacaoNumerarioExecucaoRepositoryInterface`, `ProcessoProviderInterface` injetados via token — trocáveis por fake em teste sem tsyringe. | ✅ | `RecebimentosPainelService.ts:16-26`, `RecebimentosPainelService.test.ts:70-79` |
| Record/Playback (Recordable Test Cases) | Ausente para respostas do `com297`. A NDe é hidratada com um objeto literal `{ vldAutorizado: 0/1, docEspNumero: '000123' }`, não com uma fixture de resposta real do ERP. | ❌ | `RecebimentosPainelService.test.ts:186-206` — não há `__fixtures__/com297/*.json` |
| Sandbox | Nenhum sandbox de Postgres real para o novo LEFT JOIN. O SQL é validado por match de string. Pré-existente (`testability-1`), agravado pelo delta que adiciona 46 LOC de SQL novo (`PAINEL_FROM_WHERE`). | ❌ | `NdeRepository.test.ts` — 16 `expect(sql).toContain(...)` |
| Executable Assertions | `expect(sql).not.toMatch(/'\s*\+|\$\{/)` protege contra SQL injection por interpolação. Boa executable assertion contra Rule #5. | ✅ | `NdeRepository.test.ts:35, 88, 175` |
| Abstract Data Sources | `PostgreeDatabaseClient` é injetável e mockado por interface (`selectFirst`, `selectMany`, `update`) — troca sem tocar Repository. | ✅ | `NdeRepository.test.ts:7-13` |
| Limit Structural Complexity | `RecebimentosPainelService` tem **7 deps** no construtor; o `build()` do teste tem 5 stubs opcionais. Cada novo teste da classe carrega o mesmo prólogo. Está no limite superior. | ⚠️ | `RecebimentosPainelService.ts:109-120`, `RecebimentosPainelService.test.ts:22-80` |
| Limit Non-Determinism | `new Date().toISOString()` em `montarPainel` (linha 150) — o `geradoEm` da resposta muda a cada teste. Testes atuais evitam assertar sobre ele; sem `useFakeTimers`, snapshot testing seria flake. `hidratarUma` compartilha `Promise.all` — ordem entre chamadas do lote não é determinística e não é asserted. | ⚠️ | `RecebimentosPainelService.ts:150, 260` |

## 4. Findings (achados)

### F-testability-1: aba NDe não tem cobertura ponta-a-ponta — 9 fakes e2e devolvem `[]`

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces (interface existe, mas nenhum caso e2e a exercita ligada à HTTP + service + repository real)
- **Localização**: `src/backend/routes/recebimentos.e2e.test.ts:604-606`, `recebimentos.e2e.falhas.test.ts:650-652`, `recebimentos.e2e.gates.test.ts:528-530`, `recebimentos.e2e.retomada.test.ts:611-613`, `recebimentos.e2e.hmlWrite.integration.test.ts:182-184`, `recebimentos.e2e.hmlTituloCondicao.integration.test.ts:186-188`, `recebimentos.e2e.hmlTituloOrdem.integration.test.ts:181-183`, `recebimentos.e2e.hmlTituloZero.integration.test.ts:175-177`, `recebimentos.e2e.prodWrite.integration.test.ts:185-187`
- **Evidência**:
  ```ts
  // 9 arquivos, o mesmo padrão:
  listParaPainel: async (): Promise<AnyRecord[]> => [],
  contarPendentes: async (): Promise<number> => 0,
  updateNumeroNde: async (): Promise<void> => undefined,
  ```
- **Impacto técnico**: nenhum e2e prova que a rota `GET /recebimentos` devolve `painel.ndes` no shape que a `NdeTable` consome. A tipagem casa (testes de contrato TS existem), mas uma mudança no serializer/roteador que corrompa o campo passa verde. O ponto de encontro entre o serviço e a rota — que a IX (Recebimentos-Painel) descreve — está sem smoke.
- **Impacto de negócio**: analista abre a aba NDe em produção e vê linha errada; o time só descobre pelo suporte. Regresso 0 → produção porque nenhum canário exercita o caminho HTTP.
- **Métrica de baseline**: 0 casos e2e cobrindo a aba NDe / 9 suítes onde o fake foi estendido.

### F-testability-2: `PAINEL_NDE_HIDRATACAO_LOTE=5` é código sem testemunha

- **Severidade**: P1
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:258-265`, teste em `RecebimentosPainelService.test.ts:232-240`
- **Evidência**:
  ```ts
  // Impl: itera em lotes de 5 chamadas paralelas
  for (let i = 0; i < candidatas.length; i += PAINEL_NDE_HIDRATACAO_LOTE) {
      const lote = candidatas.slice(i, i + PAINEL_NDE_HIDRATACAO_LOTE);
      const hidratadas = await Promise.all(lote.map((nde) => this.hidratarUma(nde)));
      ...
  }
  // Teste: só prova o TOTAL de chamadas (cap = 20), não o tamanho do lote
  expect((fiscalClient.lerDocParaPolling as jest.Mock).mock.calls).toHaveLength(20);
  ```
- **Impacto técnico**: alguém sobe `PAINEL_NDE_HIDRATACAO_LOTE` para 20 (elimina o lote) e todo teste passa; a intenção documentada no comment de bloco — "sem teto, abrir o painel seria uma rajada no ERP" — deixa de ser defendida. Rate-limit do Conexos vira roleta em produção.
- **Impacto de negócio**: abertura simultânea do painel por N analistas (turno da manhã) dispara N×20 chamadas concorrentes no `com297`. Se o ERP throttling, todos os painéis degradam para "aguardando SEFAZ" mesmo com NDes já autorizadas.
- **Métrica de baseline**: 0 casos que provam o LOTE=5 / 1 caso que prova o CAP=20.

### F-testability-3: SQL do LEFT JOIN é validado por match de string, sem sandbox Postgres

- **Severidade**: P2
- **Tactic violada**: Sandbox (herdada do débito repo-wide `testability-1`)
- **Localização**: `src/backend/domain/repository/recebimentos/NdeRepository.ts:22-27, 88-101, 103-115` — `PAINEL_FROM_WHERE` de 6 linhas com 4 predicados de negócio (`fil_cod = ANY($filCods)`, `dry_run = false`, `COALESCE(nde_dispensada, false) = false`, `nd_doc_cod IS NOT NULL OR n.id IS NOT NULL`) + `NOT (COALESCE(status_emissao,'') = 'emitida' AND COALESCE(nde_autorizado,false) = true)` no COUNT
- **Evidência**:
  ```ts
  // NdeRepository.test.ts: 16 asserções são substring-match
  expect(sql).toContain('LEFT JOIN nota_debito_eletronica');
  expect(sql).toContain('e.dry_run = false');
  expect(sql).toContain("COALESCE(n.status_emissao, '') = 'emitida'");
  ```
- **Impacto técnico**: qualquer refactor de whitespace ou renomeação de alias que preserve a string mas mude semântica (`ON n.idempotency_key = e.idempotency_key` → `ON n.id = e.id`) passa. E o inverso: um `NOT` esquecido no COUNT (que faria o KPI contar autorizadas como pendentes) só aparece em prod porque o teste procura pela substring, não pelo resultado.
- **Impacto de negócio**: card de "NDes pendentes" mostra número diferente da lista logo abaixo. Analista perde confiança no painel; suporte recebe "o painel está mentindo".
- **Métrica de baseline**: 0 integration tests com Postgres real / 6 casos que dependem da semântica do SQL.

### F-testability-4: `.catch(() => undefined)` em 3 sítios apaga sinais que testes não conseguem observar

- **Severidade**: P1
- **Tactic violada**: Executable Assertions + Limit Non-Determinism (fault silencioso escondendo estado)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:282, 297, 300` (também `line 197` no `enriquecerComModalidade`, pré-existente)
- **Evidência**:
  ```ts
  const status = await this.fiscalClient.lerDocParaPolling(...).catch(() => undefined);
  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(() => undefined);
  await this.ndeRepo.updateNumeroNde(nde.idempotencyKey, numeroNde).catch(() => undefined);
  ```
  A classe não injeta `LogService` (0/7 deps), enquanto os irmãos próximos injetam:
  ```
  ConexosNdeEmitter.ts:38, ProcessoProviderConexos.ts:47, NumerarioAclChecker.ts:39
  ```
- **Impacto técnico**: se o `com297` começar a devolver 500 sistematicamente, ninguém vê. O KPI `ndePendentes` fica alto e o painel diz "aguardando SEFAZ" para tudo — sem um sinal para o time saber que a causa é o ERP e não o SEFAZ. Testes hoje não podem asserir `expect(logService.warn).toHaveBeenCalled()` porque não existe `logService`.
- **Impacto de negócio**: MTTR de incidente ERP↔financeiro fica alto (time descobre pela reclamação do analista, não por dashboard). É uma degradação silenciosa de um QA de observabilidade — daí o gancho com Fault Tolerance no consolidator.
- **Métrica de baseline**: 3 catches silenciosos, 0 calls a `logService.warn`, 0 casos de teste que asseguram observação de falha.

### F-testability-5: `RecebimentosPainelService` tem 7 dependências — builder de teste pesado

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `RecebimentosPainelService.ts:109-120` (constructor), `RecebimentosPainelService.test.ts:22-80` (builder)
- **Evidência**: constructor com `transacaoRepo`, `runRepo`, `base`, `processoProvider`, `execucaoRepo`, `ndeRepo`, `fiscalClient`. O `build()` de teste tem 5 parâmetros opcionais e monta 7 stubs. Cada novo teste da classe paga o custo de conhecer todos.
- **Impacto técnico**: sinaliza que a classe começa a fazer duas coisas — montar a página de transações E orquestrar a hidratação de NDe. O teste é a lupa: 15 casos, dois `describe` blocks, dois eixos.
- **Impacto de negócio**: baixo direto; alto indireto — próxima feature (Módulo 2 de Recebimentos) adiciona 8ª dep e o serviço vira God object.
- **Métrica de baseline**: 7 deps (limiar de Bass = 5); test file 241 LOC (limiar de saúde = 500, mas trajetória preocupa).

### F-testability-6: `new Date()` em fonte não é injetável — o `geradoEm` é não-determinístico

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `RecebimentosPainelService.ts:150` (`geradoEm: new Date().toISOString()`), `NdeRepository.ts:161, 182` (`new Date(r.emitida_em ...)`)
- **Evidência**: o serviço lê o relógio do sistema; nenhum teste do delta faz `jest.useFakeTimers()`. Snapshot testing sobre o response ficaria flake.
- **Impacto técnico**: baixo hoje (nenhum teste asserta o campo); alto se um snapshot ou uma property-based test for adicionada — precisará antes injetar um `ClockProvider`.
- **Impacto de negócio**: nenhum imediato; convenção que se estabelece agora se propaga.
- **Métrica de baseline**: 3 sítios de `new Date()` no delta, 0 abstrações de clock.

## 5. Cards Kanban

### [testability-1] Adicionar smoke e2e da aba NDe em pelo menos uma suíte de rota

- **Problema**
  > A feature estende os fakes de `NdeRepository` em 9 arquivos e2e — todos devolvendo `[]` / `0`. Nenhum caso ponta-a-ponta prova que a rota `GET /recebimentos` serializa o campo `painel.ndes` no shape esperado pela `NdeTable`. Uma mudança futura no roteador que corrompa o shape passa verde.

- **Melhoria Proposta**
  > Em `recebimentos.e2e.test.ts` (a suíte "canônica" da rota), montar UMA `NdePainelRow` no fake de `listParaPainel` (uma NDe emitida + autorizada, uma pendente com `ndDocCod`, uma erro) e assertar via `supertest` que `body.ndes.length === 3` e que `body.ndes[0].statusEmissao === 'emitida'`. Não precisa integrar Postgres — só ligar a rota ao service ao fake. Tactic: **Specialized Interfaces**.

- **Resultado Esperado**
  > Existe ≥ 1 caso e2e que exercita `GET /recebimentos → ndes[]` ponta-a-ponta. Regressão de serializer pega em CI.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos e2e cobrindo a aba NDe: 0 → ≥ 1
  - Suítes e2e que exercitam `body.ndes`: 0 / 9 → 1 / 9
- **Risco de não fazer**: em 6 meses, alguém troca o serializer do painel; contrato de resposta muda; frontend quebra em produção porque nenhum e2e viu.
- **Dependências**: nenhuma

### [testability-2] Provar `PAINEL_NDE_HIDRATACAO_LOTE=5` com um teste de concorrência

- **Problema**
  > O código itera em lotes de 5 (`for (i = 0; i < candidatas.length; i += 5)`), mas o único caso existente prova apenas o CAP total (`toHaveLength(20)`). Uma mudança de `LOTE=5` para `LOTE=20` (que elimina o batching) passa verde. A intenção de "não estourar rate-limit do Conexos" fica sem defensor.

- **Melhoria Proposta**
  > Adicionar caso em `RecebimentosPainelService.test.ts` que instrumenta `fiscalClient.lerDocParaPolling` para contar chamadas concorrentes (um contador `inFlight`, incrementa no início do mock, decrementa no fim). Assertar `expect(maxInFlight).toBeLessThanOrEqual(PAINEL_NDE_HIDRATACAO_LOTE)`. Tactic: **Executable Assertions**.

- **Resultado Esperado**
  > O tamanho do lote passa a ser uma invariante executável. Mudanças no `LOTE` só passam se ajustarem tanto a constante quanto o teste.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos que provam o LOTE: 0 → 1
  - Concorrência máxima observada nos testes: não medida → ≤ 5
- **Risco de não fazer**: uma refactor "para acelerar o painel" remove o batching sem que nenhum teste avise; primeiro incidente é o rate-limit do Conexos derrubando o painel em horário de pico.
- **Dependências**: nenhuma

### [testability-3] Injetar `LogService` em `RecebimentosPainelService` e assertar warns em teste

- **Problema**
  > Três `catch(() => undefined)` na hidratação (fiscalClient, setNdeAutorizado, updateNumeroNde) apagam sinais de degradação. O serviço não injeta `LogService` — irmãos próximos (`ConexosNdeEmitter`, `ProcessoProviderConexos`, `NumerarioAclChecker`) injetam. Falha sistemática do `com297` fica invisível para o time.

- **Melhoria Proposta**
  > Injetar `LogService` como 8ª dep. Nos três `.catch`, chamar `logService.warn({ event: 'nde-painel-hidratacao-falhou', idempotencyKey, cause: e })`. No teste, o `build()` já constrói o stub — asserta `expect(logService.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'nde-painel-hidratacao-falhou' }))` no caso "ERP fora do ar não derruba o painel". Tactic: **Executable Assertions** + Fault Tolerance (Ping/Echo indireto via logs).

- **Resultado Esperado**
  > Falhas de hidratação viram sinal observável em CloudWatch (quando migrar para Lambda) ou nos logs Render (hoje). Testes protegem contra alguém "limpar" o log.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Catches silenciosos: 3 → 0
  - Calls a `logService.warn` na hidratação: 0 → 3
  - Casos de teste que asseguram o warn: 0 → 3
- **Risco de não fazer**: incidente do `com297` em produção só é descoberto por reclamação de analista. MTTR alto por default.
- **Dependências**: cross-QA (Fault Tolerance).

### [testability-4] Criar integration test com Postgres real para o LEFT JOIN da aba NDe

- **Problema**
  > As 16 asserções `expect(sql).toContain(...)` do `NdeRepository.test.ts` provam a string do SQL, não seu comportamento. Um `NOT` esquecido no COUNT (que faria o KPI contar autorizadas como pendentes) passa. O gap de sandbox Postgres é pré-existente (`testability-1` já mencionado em `RecebimentoExecucaoRepository.test.ts:147`), mas o delta adiciona 46 LOC de SQL novo (`PAINEL_FROM_WHERE`) sem essa rede de segurança.

- **Melhoria Proposta**
  > Criar `NdeRepository.integration.test.ts` que, quando `PGHOST` estiver disponível (ver skip com `describe.skip` local, `describe` no CI), sobe schema mínimo (`solicitacao_numerario_execucao` + `nota_debito_eletronica`), insere 4 execuções (uma autorizada, uma pendente sem NDe, uma dry-run, uma dispensada) e prova: (a) `listParaPainel` devolve 2 linhas; (b) `contarPendentes` devolve 1. Tactic: **Sandbox** + **Recordable Test Cases**.

- **Resultado Esperado**
  > O LEFT JOIN + `PAINEL_FROM_WHERE` + COUNT ficam protegidos por casos que rodam contra Postgres real (opcionalmente skip em dev sem `PGHOST`).

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — requer scaffolding `docker-compose.test.yml` + migrations mínimas
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Integration tests do delta: 0 → ≥ 4 casos (autorizada, pendente, dry-run, dispensada)
  - Cobertura de branches do `derivarStatusEmissao`: string-match → comportamento
- **Risco de não fazer**: em 6 meses, refactor de SQL introduz bug de KPI que só aparece em produção; débito `testability-1` continua bloqueando qualquer teste de comportamento repo-wide.
- **Dependências**: `docker-compose.test.yml` (débito repo-wide `testability-1`). Considerar cross-QA (Deployability — gate de CI antes de deploy).

### [testability-5] Extrair `NdePainelOrchestrator` de `RecebimentosPainelService`

- **Problema**
  > O serviço tem 7 dependências e o test builder tem 5 parâmetros opcionais. A classe faz duas coisas: monta o painel de transações E orquestra a hidratação de NDe (que tem 3 collaborators só para si — `ndeRepo`, `fiscalClient`, `execucaoRepo`). Próxima feature adiciona 8ª dep.

- **Melhoria Proposta**
  > Extrair `NdePainelOrchestrator` com o método `hidratarNdes` e suas 3 deps. `RecebimentosPainelService` passa a ter 5 deps (4 originais + orchestrator) e chama `orchestrator.hidratarNdes(ndesDoBanco)`. Testes de hidratação migram para `NdePainelOrchestrator.test.ts`. Tactic: **Limit Structural Complexity**.

- **Resultado Esperado**
  > Cada classe tem no máximo 5 deps. Test builders ficam menores. Testes de hidratação ficam com 3 stubs em vez de 7.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M (2–5d) — mecânico mas toca DI container
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Deps de `RecebimentosPainelService`: 7 → ≤ 5
  - Stubs no `build()` do teste: 7 → 4
- **Risco de não fazer**: próxima feature (Módulo 2 de Recebimentos) adiciona 8ª dep; serviço vira God object; testes ficam de 300 → 500 LOC.
- **Dependências**: cross-QA (Modifiability).

### [testability-6] Introduzir `ClockProvider` injetável para eliminar `new Date()` do painel

- **Problema**
  > `geradoEm: new Date().toISOString()` em `RecebimentosPainelService.ts:150` e `new Date(r.emitida_em)` em `NdeRepository.ts:161,182` leem o relógio do sistema. Snapshot testing ou property-based test sobre o response ficaria flake sem `useFakeTimers`. Convenção estabelecida agora se replica.

- **Melhoria Proposta**
  > Criar `libs/clock/ClockProvider.ts` com `now(): Date`. Injetar em `RecebimentosPainelService` (`geradoEm: this.clock.now().toISOString()`). No teste, stubar `clock.now` para retornar uma data fixa. Tactic: **Limit Non-Determinism**.

- **Resultado Esperado**
  > Testes podem congelar o tempo sem `jest.useFakeTimers`; snapshot testing passa a ser viável.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Sítios de `new Date()` em sources do delta: 3 → 0
  - Deps injetáveis para tempo: 0 → 1 (`ClockProvider`)
- **Risco de não fazer**: baixo direto; alto quando alguém tentar property-based testing (deps `fast-check` presente) e descobrir que o response não é determinístico.
- **Dependências**: cross-QA (Modifiability — clock como abstração reutilizável).

## 6. Notas do agente

- Escopo estrito ao DELTA. As 14 falhas na suíte backend são pré-existentes (env `COM297_GCD_NOTA_DEBITO`) e igualmente vermelhas na `main`; não conto como regressão do delta.
- `--quick`: NÃO rodei `--coverage`. Métrica #1 (cobertura por camada) usa ratio LOC-teste/LOC-fonte + contagem de `it()` como proxy — declaradamente não é branch coverage.
- Cross-QA para o `qa-consolidator`:
  - `testability-3` (LogService no painel) sobrepõe **Fault Tolerance** (Ping/Echo — sinal de degradação).
  - `testability-4` (Postgres real) sobrepõe **Deployability** (gate de integração antes do deploy) e é o mesmo débito `testability-1` já registrado em `RecebimentoExecucaoRepository.test.ts:147`.
  - `testability-5` (extrair orchestrator) sobrepõe **Modifiability** (Reduce Coupling / Increase Cohesion).
  - `testability-6` (`ClockProvider`) sobrepõe **Modifiability** (Encapsulate).
- Score 7/10: 12 casos de teste unitário novos com boa articulação de invariantes (COUNT vs lista, LEFT JOIN vs INNER, best-effort vs derrubar painel), MAS o LOTE=5 não tem testemunha, o com297 não tem fixture gravada, o LogService não é injetado e nenhum e2e exercita a aba ponta-a-ponta.
