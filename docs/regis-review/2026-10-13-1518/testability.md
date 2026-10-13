---
qa: Testability
qa_slug: testability
run_id: 2026-10-13-1518
agent: qa-testability
generated_at: 2026-10-13T15:40:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

Escopo: apenas o delta de `fix/sispag-sync-ao-abrir` vs `origin/main` (modo `--quick`, sem rodar cobertura global).

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na regra de TTL, cooldown ou "run presa" da passada de L11 | `SincronizacaoPassadaService` (gatilhos: abertura da tela, botão, cron) | Teste unitário com relógio injetado e Postgres mockado | Forçar cada estado (`fresca`, `atualizada`, `em_andamento`, `falha_recente`) sem rede, sem banco e sem esperar | 100% dos estados alcançáveis em teste; 0 dependência de relógio real; regressão de fronteira detectada pela suíte |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (delta) | ⚠️ **Não medível**: `--quick`, sem `--coverage`. Proxy por arquivo: 1 serviço novo (270 LOC) com 256 LOC de teste e 14 `it` cobrindo os 4 estados; job reescrito com 6 `it`; rota com 4 `describe` novos | ≥80% linhas / ≥70% branches em `domain/service` | ⚠️ | `git diff --stat`, `grep -n "it(" SincronizacaoPassadaService.test.ts` |
| Suítes do delta executadas localmente | 3 suítes, 125/125 verdes (3,85 s) | 100% verde | ✅ | `npx jest SincronizacaoPassadaService sincronizar-lotes routes/sispag.test` |
| Gates da branch (backend/frontend) | 4058/4058 e 893/893 | verde | ✅ | `_shared-metrics.md` |
| Razão arquivo-teste/fonte no delta | 5 arquivos de teste backend + 3 frontend para 3 fontes backend novos/alterados significativos | ≥0,5 | ✅ | `git diff --stat` |
| Relógio injetável no serviço novo | `agora?: number` em `sincronizarSeDefasada` e `forcar`; `executarPassada`/`rodar` sem relógio | ClockProvider ou parâmetro em todos os caminhos | ⚠️ parcial | `SincronizacaoPassadaService.ts:104,149` |
| Leituras de `Date.now()` no serviço novo | 2 (ambas com fallback de `agora`) | 0 sem override | ⚠️ | `grep -n "Date.now" SincronizacaoPassadaService.ts` |
| Testes de fronteira (TTL, 10 min, cooldown) | 0 de 3 fronteiras testadas no valor exato; testes usam 10/45 min, 1/20 min, 2/6 min | 3/3 | ❌ | `SincronizacaoPassadaService.test.ts:164-226` |
| Testes de integração com Postgres real para a trava/`listRecentRuns` | 0 (o `withAdvisoryLock` é mock; só `PostgreeDatabaseClient.test.ts` cobre a trava, e com pool mockado) | ≥1 | ⚠️ | `grep withAdvisoryLock *.test.ts` |
| Chamadas de rede reais em teste (delta) | 0 | 0 | ✅ | inspeção dos testes do delta |
| Assert de log nos caminhos de erro do serviço | Não assertado: nenhum `it` verifica `logService.error` com `FLOW_ERROR` em `rodar`/`fechar` | ≥1 por caminho de erro | ⚠️ | `SincronizacaoPassadaService.test.ts:118-150` |
| Ferramenta de teste de propriedade no delta | 0 usos de `fast-check` | n/a (P3) | ⚠️ | inspeção |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Construtor com 5 dependências via `@inject`; testes montam o serviço com `setup()` e mocks | ✅ presente | `SincronizacaoPassadaService.ts:92-98` |
| Recordable Test Cases | Sem fixtures gravadas; o resumo de L11 é construído à mão em `setup()` | ⚠️ parcial | `SincronizacaoPassadaService.test.ts:18-87` |
| Sandbox | Tudo mockado (repo, db, serviço de L11); sem sandbox Postgres para a trava | ⚠️ parcial | `withAdvisoryLock: jest.fn` |
| Executable Assertions | Run em `job_execucao` como relógio do TTL; `redactErrorMessage` no erro | ✅ presente | `SincronizacaoPassadaService.ts:206-219` |
| Abstract Data Sources | `JobExecucaoRepository` e `PostgreeDatabaseClient` injetados | ✅ presente | construtor |
| Limit Structural Complexity | Serviço único de 270 LOC substitui lógica duplicada entre job, rota e botão; teste de 256 LOC (<500) | ✅ presente | `git diff --stat` |
| Limit Non-Determinism | Relógio injetável só no caminho de decisão; `new Date(agora)` determinístico; o `finishedAt` real vem do banco | ⚠️ parcial | `SincronizacaoPassadaService.ts:104,162` |

## 4. Findings

### F-testability-1: Fronteiras de TTL, run presa e cooldown não são testadas no valor exato

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoPassadaService.test.ts:164-226`; regras em `SincronizacaoPassadaService.ts:114-137`
- **Evidência (objetiva)**:
  ```
  fresca:        finishedAt: ha(10)   (TTL padrão >10)
  defasada:      finishedAt: ha(45)
  running:       ha(1) vs ha(20)     (limite RUN_PRESA_MS = 10 min)
  falha:         ha(2) vs ha(6)      (cooldown 5 min)
  ```
- **Impacto técnico**: trocar `<` por `<=` ou mudar `RUN_PRESA_MS` não quebra nenhum teste; as três comparações `agora - Date.parse(x) < limite` são o núcleo da regra de ADR-0066.
- **Impacto de negócio**: um off-by-one faria a tela disparar passadas de ~25 s e consumir o pool de 5 conexões do Postgres a mais, ou deixar a tela sem atualizar por mais um ciclo, sem ninguém notar.
- **Métrica de baseline**: 0 de 3 fronteiras com teste no valor exato (TTL, 10 min, cooldown).

### F-testability-2: A decisão de "passada recente" depende de relógio do app contra `finishedAt` do banco, sem teste de skew; relógio só injetável em dois métodos

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `SincronizacaoPassadaService.ts:104,149,162`
- **Evidência (objetiva)**:
  ```
  const agora = input.agora ?? Date.now();      // app
  agora - Date.parse(ultimoSucesso) < ttlMs     // ultimoSucesso vem de job_execucao.finished_at (banco)
  ultimaSincronizacaoEm: new Date(agora).toISOString()   // inventado, não é o finishedAt da run
  ```
- **Impacto técnico**: o parâmetro `agora` é uma costura ad hoc (campo de produção usado só por teste) em vez de um `ClockProvider`; `ultimaSincronizacaoEm` em `atualizada` é o instante da requisição, não o `finished_at` gravado, e nenhum teste detecta a divergência (~25 s).
- **Impacto de negócio**: o rótulo "atualizado há X min" pode divergir do que a próxima abertura calcula; baixo risco, mas é a mesma fonte de verdade em dois relógios.
- **Métrica de baseline**: 2 leituras de `Date.now()` no serviço; 0 testes de skew app/banco.

### F-testability-3: Trava de concorrência (advisory lock) e ordenação de `listRecentRuns` só provadas com mocks

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `SincronizacaoPassadaService.test.ts` (`setup`, `travaOcupada`); `JobExecucaoRepository.ts:97-106`
- **Evidência (objetiva)**:
  ```
  perde a corrida pela trava → em_andamento     (travaOcupada simulado pelo mock)
  ORDER BY started_at DESC LIMIT $limit         (a lógica `const [ultima] = runs` assume essa ordem)
  ```
- **Impacto técnico**: a invariante "uma passada por vez entre servidor e runner do GitHub" depende de `pg_try_advisory_lock` real e da ordenação do SQL; hoje nenhum teste toca Postgres.
- **Impacto de negócio**: três gatilhos (tela, botão, cron) disputam o pool de 5 conexões; uma regressão aqui só aparece em produção como passadas duplicadas ou como erro de leitura no Conexos.
- **Métrica de baseline**: 0 testes de integração para a trava e para `listRecentRuns`.

### F-testability-4: Caminhos de erro do serviço não assertam o log emitido

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `SincronizacaoPassadaService.test.ts:118-150`; `SincronizacaoPassadaService.ts:222-234,258-259`
- **Evidência (objetiva)**:
  ```
  it('TODAS as leituras falharam → run error ...')   // checa finishRun, não logService.error
  it('exceção do serviço → run error ... REDIGIDA')  // idem
  ```
- **Impacto técnico**: o log `FLOW_ERROR` é o único sinal que o operador vê às 2h (incidente de 23/09); pode sumir sem teste vermelho.
- **Impacto de negócio**: incidente de credencial vencida volta a passar como "success" silencioso na leitura do log.
- **Métrica de baseline**: 0 de 2 caminhos de erro com assert de log.

## 5. Cards Kanban

### [testability-1] Testar as fronteiras exatas de TTL, run presa e cooldown

- **Problema**
  > As três comparações de tempo que decidem se a tela dispara uma passada de ~25 s são testadas só com valores bem afastados do limite (10/45, 1/20, 2/6 min). Trocar `<` por `<=` não quebra teste algum.

- **Melhoria Proposta**
  > Em `SincronizacaoPassadaService.test.ts`, adicionar casos de fronteira (TTL-1 ms, TTL exato, 10 min exato, cooldown exato) usando `agora` injetado, e um caso `it.each` com os limites vindos de `sispagLotesSyncTtlMin`/`sispagLotesSyncCooldownMin` configurados distintos do padrão. Opcional: caso com `fast-check` (propriedade: `agora - finishedAt < ttl` ⇔ `fresca`).

- **Resultado Esperado**
  > Mutação `<` → `<=` nas 3 comparações derruba pelo menos 1 teste cada.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Fronteiras com teste exato: 0/3 → 3/3
  - `it` em `sincronizarSeDefasada`: 10 → ≥14
- **Risco de não fazer**: ajuste futuro do TTL/cooldown vira regressão silenciosa no pool de conexões.
- **Dependências**: nenhuma

### [testability-2] Extrair o relógio para um ClockProvider injetável e alinhar `ultimaSincronizacaoEm` ao `finished_at` da run

- **Problema**
  > O relógio é um campo opcional `agora` nas entradas públicas e dois `Date.now()` de fallback; `ultimaSincronizacaoEm` em `atualizada` é o instante da requisição, não o `finished_at` real da run.

- **Melhoria Proposta**
  > Criar `ClockProvider` (`@singleton() @injectable()`, `now(): number`), injetar no serviço e remover `agora` da API; devolver `passada.finishedAt` (ou ler a run) em `ultimaSincronizacaoEm`. Adotar o mesmo provider nos demais serviços com `Date.now()` (ver Modifiability). Teste de skew: relógio do app ±2 min vs `finished_at`.

- **Resultado Esperado**
  > `Date.now()` no serviço: 2 → 0; API pública sem parâmetro de teste; 1 teste de skew novo.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: M (2–5d, se estendido a outros serviços; S só neste)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Leituras diretas de `Date.now()` no serviço: 2 → 0
  - Testes de skew app/banco: 0 → 1
- **Risco de não fazer**: a decisão de TTL continua misturando dois relógios sem cobertura.
- **Dependências**: card de Modifiability sobre clock injetável (cross-QA)

### [testability-3] Teste de integração da trava e de `listRecentRuns` contra Postgres real, e asserts de log nos erros

- **Problema**
  > A invariante "uma passada por vez" e a ordenação `started_at DESC` só são provadas por mocks; os caminhos de erro não assertam o log `FLOW_ERROR`.

- **Melhoria Proposta**
  > Criar `describe('integration: SincronizacaoPassadaService')` (Postgres de teste, marcado e fora do `npm test` padrão) com 2 conexões disputando `SISPAG_SINCRONIZACAO_LOCK_KEY` e um caso de `listRecentRuns` com run `running` intercalada. Nos 2 testes de erro existentes, acrescentar `expect(logService.error).toHaveBeenCalledWith(...FLOW_ERROR...)`.

- **Resultado Esperado**
  > Integração com Postgres real para a trava: 0 → 2 casos; caminhos de erro com assert de log: 0/2 → 2/2.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - Casos de integração (trava + ordenação): 0 → 3
  - Asserts de log em erro: 0/2 → 2/2
- **Risco de não fazer**: passadas duplicadas ou log mudo só descobertos em produção.
- **Dependências**: banco de teste no CI (ver Deployability)

## 6. Notas do agente

- Escopo estrito ao delta; modo `--quick`: sem cobertura, métrica 1 por camada não medível (proxy por arquivo). Rodei as 3 suítes do delta (125/125 verdes).
- Nenhum P0/P1: não há caminho de dinheiro nem transição de lote sem teste; o serviço novo cobre 4/4 estados de retorno.
- Cross-QA: clock injetável (Modifiability); banco de teste no CI (Deployability); trava e `em_andamento` (Fault Tolerance/Performance, pool de 5 conexões).
- `LoteCard.test.tsx`, `page.test.tsx` e `useCarteiraAoAbrir.test.ts` só foram avaliados pelo tamanho e pelo resultado verde dos gates, não linha a linha.
