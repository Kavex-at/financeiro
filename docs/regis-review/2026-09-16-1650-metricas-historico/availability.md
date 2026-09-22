---
qa: Availability
qa_slug: availability
run_id: 2026-09-16-1650-metricas-historico
agent: qa-availability
generated_at: 2026-09-18T00:00:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre/recarrega `/metricas` no navegador | `GET /metricas/ciclo?historico=true` passa a resolver `metricas.historico_inicio()` (2026-08-07) em vez de `metricas.serie_inicio()` (2026-09-11) e a ler ~6 janelas semanais em vez de 1 | `routes/metricas.ts` → `MetricasCicloService.ler` → `MetricasCicloRepository.listar`/`serieInicio` → Postgres via `PostgreeDatabaseClient` (pool `max=5`, sem `statement_timeout` de query) | Produção Render (processo Express único), `BootMigrator` migra antes do `app.listen`; `kavex-report-ciclo` consome a mesma rota sem `historico` | Se a função/consulta falha, o erro sobe sem mascarar (sem `catch` silencioso no caminho) e a tela mostra estado de erro com retry manual; não há timeout de query nem de `fetch` no browser além do `connectionTimeoutMillis` (5s) de obtenção de conexão do pool e do retry de erro transitório (3× 200ms) no client de banco | Nenhum número fictício exibido em falha (comprovado por teste); a chamada do report permanece byte-a-byte idêntica à de antes do delta (comprovado por teste); ausência de timeout de query e de kill-switch específico para a leitura ampliada |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rota do report (`kavex-report-ciclo`, sem `?historico`) muda de comportamento no delta | 0 mudanças — `piso(undefined)` resolve para `metricas.serie_inicio()`, a mesma função/consulta de antes | 0 | ✅ | `src/backend/routes/metricas.test.ts:117-124` (`'sem o parâmetro, a chamada é a de antes da ADR-0048'`); `MetricasCicloRepository.ts:37-40,84` |
| Falha na leitura (função ausente, erro SQL) chega à UI como erro explícito, não como número zerado/fictício | Testado: `res.ok=false` → `fetchMetricasCiclo` lança `Error` com o status HTTP | 100% dos casos de erro viram exceção visível | ✅ | `src/frontend/lib/metricas.test.ts:100-105` (`'erro de leitura vira exceção com o status — a tela não finge número'`); `src/frontend/app/metricas/page.tsx:52-58,90-99` (estado `erro` → `EmptyState` + botão "Tentar de novo") |
| Ordem migração-antes-de-tráfego (evita rodar com `metricas.historico_inicio()` inexistente) | `BootMigrator.startServer`: `runMigrations()` roda e só então `listen()`; falha de migração derruba o processo (Render mantém a versão anterior) | Garantida | ✅ | `src/backend/http/bootstrap.ts:38-49`; `src/backend/migrations/BootMigrator.ts:1-38` (não alterado pelo delta) |
| `statement_timeout` explícito na consulta de `/metricas/ciclo` (app, fora de migration) | 0 — `Pool({ connectionString, idleTimeoutMillis, connectionTimeoutMillis, max })` não define `statement_timeout`; só as migrations têm `SET LOCAL statement_timeout = '10min'` | Timeout de query explícito no client de app | ❌ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:60-66`; `grep -rn "statement_timeout" src/backend` → só `migrations/runMigrations.ts:28` |
| Kill-switch (env var) para desligar `?historico=true` sem redeploy | 0 — comparar com `SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, todos com `sync:false` no dashboard do Render | Presente para uma leitura que pode ser desligada sob incidente | ❌ | `render.yaml` (flags existentes); nenhuma equivalente para `historico`/`metricas` |
| Volume de dados varrido pela janela ampliada (contexto de risco) | ~177 baixas `settled` de Permutas registradas ao todo em 2026-09-14 (comentário da 0058); a janela de 6 semanas cobre a MESMA grade de sexta-feira que a série vigente, só adiciona 5 janelas | — (informativo) | ⚠️ **Não medível localmente**: contagem de linhas em produção hoje (18/09). Requer consulta ao Postgres de produção. | `src/backend/migrations/0058_vw_metricas_ciclo.sql` (comentário "Em 2026-09-14 (177 settled)") |
| Retry no client de banco cobre a leitura ampliada | `RetryExecutor` (3 tentativas, 200ms+jitter) só dispara em 4 padrões de erro transitório de conexão (`MaxClientsInSessionMode`, `Connection terminated`, `too many clients`, `ECONNRESET`); erro de função ausente ou de negócio NÃO é retentado | Retry restrito a falhas transitórias, sem retentar erro determinístico | ✅ | `PostgreeDatabaseClient.ts:33-40,69-73` (`isTransientConnectionError`) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — leitura síncrona request/response, sem processo a sondar | N/A | Fora do escopo do delta |
| Heartbeat | N/A — sem processo de fundo introduzido pelo delta | N/A | Fora do escopo do delta |
| Monitor | Sem alarme/dashboard sobre erro ou duração de `GET /metricas/ciclo` (nem antes, nem depois do delta) | ❌ | `grep -rn "historico_inicio\|metricas_ciclo" src/backend` → só código de domínio, nenhum alerta associado |
| Timestamp | `janela_inicio`/`janela_fim`/`apurado_ate` seguem timestampados explicitamente; piso em vigor (`serieInicio`) devolvido para a tela rotular a série corretamente (não mistura piso antigo com semanas novas) | ✅ | `MetricaCiclo.ts:44-52`; `MetricasCicloRepository.ts:79-86` |
| Sanity Checking | Zod no boundary recusa `historico` fora de `true`/`false` (400 antes de tocar o serviço); Zod no repositório valida forma da linha antes de devolver | ✅ | `routes/metricas.ts:14-19`; `routes/metricas.test.ts:78-86` |
| Condition Monitoring | N/A — read-model determinístico, sem métrica própria de deriva introduzida pelo delta | N/A | Fora do escopo |
| Voting | N/A — fonte única de verdade (ledger via função SQL) | N/A | Read-model sobre um único ledger |
| Exception Detection | Erro de leitura (SQL ou HTTP) propaga como exceção visível; teste explícito prova que a UI não mascara com zero | ✅ | `src/frontend/lib/metricas.test.ts:100-105` |
| Self-Test | `vwMetricasCiclo.integration.test.ts`/`.test.ts` cobrem os dois pisos contra Postgres real no CI (`backend-sql`, Postgres 17) — já rodado nesta run, 19/19 verde (ver `_shared-metrics.md`) | ✅ | `_shared-metrics.md`; `vwMetricasCiclo.integration.test.ts` |
| Active Redundancy | N/A — leitor único, sem redundância a manter | N/A | Read-model síncrono |
| Passive Redundancy | N/A — replicação é responsabilidade do Postgres gerenciado (Supabase), fora do delta | N/A | Fora do escopo |
| Spare | N/A — sem processo standby aplicável a uma leitura HTTP síncrona | N/A | Fora do escopo |
| Exception Handling | `errorMiddleware` central acha 500 genérico sem vazar detalhe; `asyncHandler` encaminha toda rejeição a ele; nenhum `catch` silencioso no caminho do delta | ✅ | `src/backend/http/errorMiddleware.ts:12-32`; `src/backend/http/asyncHandler.ts` |
| Rollback | Migração 0060 é aditiva e idempotente (`CREATE OR REPLACE`, `REVOKE` re-rodáveis); falha de boot mantém a versão anterior no ar (Render) | ✅ | `0060_metricas_historico_inicio.sql` (comentário final); `BootMigrator.ts` |
| Software Upgrade | `CREATE OR REPLACE FUNCTION` cobre upgrade in-place da função; sem versionamento de schema em paralelo (não necessário — função nova, não redefinição) | ✅ | `0060_metricas_historico_inicio.sql:35-42` |
| Retry | `RetryExecutor` no client de banco cobre erro transitório de conexão (3×200ms+jitter); escopo correto — NÃO retenta erro de função ausente/SQL, que é determinístico | ✅ | `PostgreeDatabaseClient.ts:33-40` |
| Ignore Faulty Behavior | N/A — o delta não descarta linha por comportamento faltoso; a subnotificação de agosto (borderô excluído) é decisão de negócio documentada, não fault-ignoring | N/A | `0060_metricas_historico_inicio.sql` (seção "RESSALVA QUE A TELA NÃO EXIBE") |
| Degradation | Ausente: nenhum modo degradado específico para a leitura de 6 semanas — uma falha em `historico=true` derruba a leitura inteira (não cai para a janela de 1 semana como fallback) | ⚠️ parcial | `MetricasCicloService.ler` chama `Promise.all` sem fallback; `page.tsx` só tem "tentar de novo" |
| Reconfiguration | Ausente: nenhum kill-switch/env var para desligar `historico=true` sem redeploy, ao contrário de `SISPAG_ENABLED`/`RECEBIMENTOS_ENABLED`/`CONEXOS_WRITE_ENABLED` | ❌ | `render.yaml`; ver F-availability-2 |
| Shadow | N/A — sem tráfego em sombra | N/A | Fora do escopo |
| State Resynchronization | N/A — sem estado local a ressincronizar; cada leitura é derivada do ledger no momento | N/A | Read-model |
| Escalating Restart | N/A — sem processo próprio dedicado a este caminho | N/A | Fora do escopo |
| Non-Stop Forwarding | N/A — sem separação plano de controle/dados | N/A | Fora do escopo |
| Removal from Service | Ausente para este caminho específico (ver Reconfiguration); o padrão existe no repositório para outras integrações (`CONEXOS_WRITE_ENABLED` etc.) mas não foi estendido aqui | ❌ | `render.yaml` |
| Transactions | Migração roda dentro da transação implícita do `runMigrations` (herdado, cobre a 0060); a leitura em si é um único `SELECT`, sem necessidade de transação | ✅ | `runMigrations.ts:11-29` |
| Predictive Model | N/A — fora do escopo do delta | N/A | Fora do escopo |
| Exception Prevention | `historico` validado como `enum(['true','false'])` (não `coerce.boolean()`, que confundiria `'false'` com `true`) e nunca interpolado no SQL — os dois pisos são strings fixas escolhidas por booleano, não pelo valor da requisição | ✅ | `routes/metricas.ts:14-19`; `MetricasCicloRepository.ts:26-35` (comentário sobre não ser "injeção com outro nome") |
| Increase Competence Set | Migração e código documentam extensivamente a decisão (ADR-0048) e o motivo da grade de sexta-feira coincidir; próximo mantenedor não precisa recalcular a decisão | ✅ | `0060_metricas_historico_inicio.sql:1-33`; `ontology/decisions/0048-*.md` |

## 4. Findings (achados)

### F-availability-1: Leitura de `?historico=true` sem `statement_timeout` de query no client de app

- **Severidade**: P2
- **Tactic violada**: Timeout (dentro de Exception Handling/Removal from Service)
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:60-66`
- **Evidência (objetiva)**:
  ```ts
  const pool = new Pool({
      connectionString: envVars.databaseConnectionString,
      idleTimeoutMillis: this.poolIdleTimeoutMillis,       // 10000
      connectionTimeoutMillis: this.poolConnectionTimeoutMillis, // 5000
      max: this.poolMaxConnections,                         // 5
  });
  ```
  Nenhum `statement_timeout`. O único `statement_timeout` do repositório é o das migrations (`SET LOCAL statement_timeout = '10min'`, `migrations/runMigrations.ts:28`), que não cobre consultas da aplicação.
- **Impacto técnico**: uma consulta de `metricas.metricas_ciclo()` que trave (lock, plano ruim, crescimento do ledger) não tem teto de tempo — fica presa até o cliente cancelar ou o servidor derrubar a conexão. Com `poolMaxConnections=5` compartilhado por toda a API, algumas consultas presas simultaneamente esgotam o pool e degradam outras rotas, não só `/metricas`.
- **Impacto de negócio**: hoje o volume é pequeno (~177 baixas de Permutas ao todo em 2026-09-14, por comentário da migration 0058) e o risco é baixo; a lacuna é estrutural e vale endereçar antes do volume crescer, para não descobrir o limite em produção durante o fechamento semanal.
- **Métrica de baseline**: 0 ocorrências de `statement_timeout` fora de `migrations/runMigrations.ts` (`grep -rn "statement_timeout" src/backend`).

### F-availability-2: Sem kill-switch para `?historico=true`

- **Severidade**: P2
- **Tactic violada**: Reconfiguration / Removal from Service
- **Localização**: `render.yaml` (ausência); `src/frontend/lib/metricas.ts:56` (`fetchMetricasCiclo` sempre embute `?historico=true`, sem gate)
- **Evidência (objetiva)**: o repositório já tem o padrão de kill-switch por env var para funcionalidades sensíveis (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, todos `sync:false` no dashboard do Render), mas a leitura ampliada de `historico=true` não tem equivalente — desligá-la exige reverter e reimplantar o front.
- **Impacto técnico**: se a leitura de 6 semanas se mostrar lenta ou custosa em produção, a única mitigação é redeploy, não um toggle operacional.
- **Impacto de negócio**: MTTR maior num incidente restrito a esta tela — o operador não tem um botão de emergência equivalente ao que já existe para SISPAG/Recebimentos/Conexos.
- **Métrica de baseline**: 0 env vars associadas a `historico`/`metricas` em `render.yaml`, contra 3 kill-switches existentes para outras integrações sensíveis.

### F-availability-3: Falha na leitura ampliada derruba a tela inteira, sem degradar para a janela de 1 semana

- **Severidade**: P3
- **Tactic violada**: Degradation
- **Localização**: `src/backend/domain/service/metricas/MetricasCicloService.ts:33-40` (`Promise.all([serieInicio(historico), listar(historico)])`); `src/frontend/app/metricas/page.tsx:52-58`
- **Evidência (objetiva)**: `ler()` sempre usa o MESMO piso nas duas chamadas (comentário no código: "O MESMO piso nas duas leituras"), por desenho — correto para não descasar o rótulo da série dos dados. Mas não há fallback: se `metricas.historico_inicio()` falhar (por exemplo, downgrade manual do schema fora do `BootMigrator`), a tela cai para o estado de erro completo em vez de tentar a leitura antiga de 1 semana como degradação.
- **Impacto técnico**: em uma falha específica do piso `historico`, o usuário perde a tela inteira em vez de ver a semana vigente (que é o que a tela mostrava antes da ADR-0048).
- **Impacto de negócio**: baixo — cenário exige uma falha isolada em `metricas.historico_inicio()` com `metricas.serie_inicio()` ainda saudável, algo que o `BootMigrator` já torna improvável (achado consistente com F-availability-2: mesma superfície, mitigação diferente).
- **Métrica de baseline**: não medível localmente — depende de um cenário de falha parcial de schema que não ocorre nos testes automatizados atuais (`routes/metricas.test.ts`, `MetricasCicloService.test.ts` testam a chamada, não a falha parcial de piso).

## 5. Cards Kanban

### [availability-1] Definir `statement_timeout` de query no client de Postgres da aplicação

- **Problema**
  > `PostgreeDatabaseClient` configura `connectionTimeoutMillis` (obtenção de conexão) e `idleTimeoutMillis`, mas nenhum `statement_timeout` para a query em si. A leitura de `/metricas/ciclo?historico=true` agora varre ~6 semanas em vez de 1, e é a primeira consulta de leitura do repositório a crescer de escopo por parâmetro do cliente — sem teto de tempo, uma consulta presa pode segurar uma das 5 conexões do pool compartilhado por toda a API.

- **Melhoria Proposta**
  > Acrescentar `statement_timeout` (tactic Timeout, dentro de Exception Handling) ao `Pool` do `PostgreeDatabaseClient` — por exemplo via `options: '-c statement_timeout=Xs'` na connection string ou `SET statement_timeout` por conexão adquirida. Escolher um valor generoso o bastante para o pior caso atual (poucas centenas de linhas) mas finito, e documentar por que o valor escolhido é seguro para o volume de hoje.

- **Resultado Esperado**
  > `statement_timeout` explícito no client de app: 0 → 1 (grep `statement_timeout` em `PostgreeDatabaseClient.ts`). Uma consulta patológica falha rápido e libera a conexão, em vez de prender o pool indefinidamente.

- **Tactic alvo**: Exception Handling (Timeout)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `statement_timeout` configurado no client de app: 0 → 1
  - Teste cobrindo timeout de query (mock ou integração): 0 → ≥1
- **Risco de não fazer**: conforme o ledger de Permutas/Recebimentos crescer, uma consulta lenta em `/metricas` pode esgotar o pool de 5 conexões e degradar rotas não relacionadas (ex.: painel de operação).
- **Dependências**: nenhuma.

### [availability-2] Kill-switch por env var para `?historico=true`

- **Problema**
  > A leitura de 6 semanas não tem um toggle operacional equivalente aos já existentes para SISPAG, Recebimentos e Conexos (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`). Se a leitura ampliada se mostrar problemática em produção, a única saída é reverter e reimplantar o frontend.

- **Melhoria Proposta**
  > Introduzir uma env var (ex.: `METRICAS_HISTORICO_ENABLED`, `sync:false` no `render.yaml`, seguindo o padrão dos flags existentes) lida por `fetchMetricasCiclo` — ou, mais simples, por uma rota de configuração que a tela consulta — que permite desligar `?historico=true` sem redeploy, voltando ao comportamento anterior à ADR-0048 (tactic Reconfiguration/Removal from Service).

- **Resultado Esperado**
  > Kill-switch operacional para a leitura ampliada: 0 → 1, no mesmo padrão dos 3 flags existentes em `render.yaml`. MTTR de um incidente restrito a esta tela cai de "tempo de um deploy" para "tempo de trocar uma env var no dashboard".

- **Tactic alvo**: Reconfiguration
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Env vars de kill-switch cobrindo `historico`: 0 → 1
- **Risco de não fazer**: um incidente isolado nesta tela consome o mesmo MTTR de um deploy completo, em vez do MTTR de um toggle — inconsistente com o padrão já adotado pelo time para outras integrações sensíveis.
- **Dependências**: nenhuma.

### [availability-3] Fallback para a janela vigente quando o piso `historico` falhar

- **Problema**
  > `MetricasCicloService.ler` usa o mesmo piso (`historico` ou `serie`) nas duas chamadas em paralelo, sem fallback: uma falha isolada em `metricas.historico_inicio()` (com `metricas.serie_inicio()` saudável) derruba a tela inteira, mesmo que a leitura de 1 semana continuasse funcionando exatamente como antes da ADR-0048.

- **Melhoria Proposta**
  > Avaliar (não necessariamente implementar já — é P3) um fallback explícito no service: se a leitura com `historico=true` falhar, tentar novamente com o piso da série vigente e sinalizar na UI que o histórico está indisponível, em vez de vazio. Tactic Degradation — a mesma lógica usada para "% não sai com 0/0" aplicada ao nível da leitura inteira.

- **Resultado Esperado**
  > Uma falha isolada no piso do histórico degrada para a semana vigente em vez de falhar por completo. Métrica: cobertura de teste do caminho de fallback, 0 → ≥1.

- **Tactic alvo**: Degradation
- **Severidade**: P3
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Teste de fallback do piso `historico` → `serie`: 0 → ≥1
- **Risco de não fazer**: baixo — depende de uma falha parcial de schema que o `BootMigrator` já torna improvável; adiar é defensável.
- **Dependências**: nenhuma; pode ser adiado para um `/feature-tweak` futuro se P1/P0 não aparecerem no consolidado.

## 6. Notas do agente

- Escopo restrito ao delta (`--quick`), 7 arquivos de produção, conforme `_shared-metrics.md`. Gates de lint/typecheck/test já rodados por outro agente — não re-executados aqui.
- Baseline herdado da run `2026-09-14-1624-metricas-ciclo` (score 7, mesma feature antes deste tweak): a arquitetura de leitura (sem role de banco dedicado, `kavex-report-ciclo` via API) mudou desde aquela run — a versão com `metricas_ciclo_leitor`/`SECURITY DEFINER` descrita ali foi removida antes de produção (ver comentário em `0058_vw_metricas_ciclo.sql`). Os achados desta run não repetem os daquela.
- As 4 perguntas do orquestrador foram respondidas diretamente: (1) risco de degradação por leitura maior é baixo hoje dado o volume (~177 linhas), mas estrutural (F-availability-1); (2) função ausente não é alcançável no caminho de deploy real por causa do `BootMigrator` (ordem migração-antes-de-tráfego), e se ocorrer por outra via, falha rápido e visível (não mascarado); (3) o report não é exposto a nenhum caminho novo — comprovado por teste; (4) não há retry/timeout/circuit-breaker específico para esta leitura além do `RetryExecutor` genérico de erro transitório de conexão, que corretamente NÃO retenta erro de função ausente.
