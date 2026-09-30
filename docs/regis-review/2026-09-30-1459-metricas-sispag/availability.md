---
qa: Availability
qa_slug: availability
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-availability
generated_at: 2026-09-30T15:10:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Deploy da migration 0070 / analista abrindo a tela Métricas / cron `sincronizar-lotes-sispag` atrasado | Função `metricas.metricas_ciclo` recriada com nova CTE SISPAG; remessa `settle`/`fail` passa a escrever `encerrado_em`; aceite do banco ainda NULL | `0070_metricas_ciclo_sispag.sql`, `RemessaExecucaoRepository.settle/fail`, `GET /metricas/ciclo`, `app/metricas/page.tsx` | Produção Render + Supabase, sem Terraform, migração no boot (`BootMigrator`) | A escrita da remessa não pode falhar nem duplicar por causa do novo carimbo; falha na métrica SISPAG não pode derrubar Permutas/Recebimentos; aceite ausente vira "aguardando retorno", nunca "rejeitado" | 0 regressões no caminho de remessa (o SQL de `settle`/`fail` só ganha uma coluna); leitura das 3 frentes segue disponível; migration reaplicável (idempotente) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migration 0070 idempotente | `ADD COLUMN IF NOT EXISTS`, `UPDATE ... WHERE encerrado_em IS NULL`, `CREATE OR REPLACE FUNCTION` | 100% reaplicável | ✅ | `0070_metricas_ciclo_sispag.sql:38-47` |
| Linhas tocadas pelo backfill | 10 (6 settled + 4 error, conforme cabeçalho da migration, medido em prod 2026-09-30) | lock curto | ✅ | comentário `0070:25-28` |
| Escritas de remessa alteradas | 2 (`settle`, `fail`); intermediárias testadas como intactas | só terminais | ✅ | `RemessaExecucaoRepository.ts:180-183,206`; test `:145-178` |
| Testes do delta | backend 178 suites/3242 ✅; test:sql Postgres 17 real 4 suites/48 ✅; front 64 suites/658 ✅ | verde | ✅ | `_shared-metrics.md` |
| Arquivos novos com I/O externo (Executor/timeout) | 0; o delta é SQL + UI | n/a | ✅ N/A | `git diff --stat origin/main HEAD` |
| `statement_timeout` na leitura `metricas_ciclo` | não configurado em `MetricasCicloRepository.ts` (grep de "timeout" vazio); **pré-existente** | explícito | ⚠️ pré-existente | `MetricasCicloRepository.ts` |
| DLQ / alarmes CloudWatch | ⚠️ **Não medível localmente**: não há `infra/`, SQS ou CloudWatch (Render + GH Actions) | — | ⚠️ | CLAUDE.md, seção Layout |
| Refs a `shared_account_id` no delta | 0; sem tenants AWS | 0 | ✅ | delta |
| Catch silencioso novo no delta | 0 | 0 | ✅ | diff |
| MTTR / disponibilidade real de `/metricas/ciclo` | ⚠️ **Não medível localmente**: requer logs/uptime do Render. Recomendação: instrumentar latência e taxa de erro da rota e a idade do último `sincronizar-lotes-sispag` bem-sucedido. | — | ⚠️ | — |
| Títulos aceitos na semana corrente | 0 de 11 (situacao NULL até o cron sincronizar) | — | ⚠️ informativo | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum no delta; sem health-check dedicado da view de métricas | ❌ ausente | — |
| Heartbeat | O cron de sync de lotes não emite heartbeat consumido pela métrica (pré-existente) | ❌ ausente | ADR-0056 |
| Monitor | Sem alarmes; o KPI mostra "sem remessa na semana" e a função devolve `parcial`/`apurado_ate` | ⚠️ parcial | `page.tsx:157-160` |
| Timestamp | `encerrado_em` dá o instante do 1º encerramento, imóvel em `settled` | ✅ presente | `RemessaExecucaoRepository.ts:180-183` |
| Sanity Checking | Aceito só `AGENDADO`/`PAGO`; NULL = aguardando; lote CANCELADO e execução `error` excluídos | ✅ presente | `0070:5-16` |
| Condition Monitoring | Ausente para a defasagem do cron de sync | ❌ ausente | F-availability-2 |
| Voting | N/A — sem réplicas computando o mesmo resultado | N/A | — |
| Exception Detection | `fail` registra mensagem + carimbo; a tela trata métrica ausente | ⚠️ parcial | `RemessaExecucaoRepository.ts:206` |
| Self-Test | Suíte SQL contra Postgres 17 real valida a função | ✅ presente | `vwMetricasCiclo.integration.test.ts` |
| Active Redundancy | N/A — Render instância única, fora do escopo do delta | N/A | — |
| Passive Redundancy | N/A — idem; Supabase gerenciado | N/A | — |
| Spare | N/A — sem infra própria | N/A | — |
| Exception Handling | Erros da rota via `asyncHandler`; repos lançam | ✅ presente | `routes/metricas.ts:38-60` |
| Rollback | Reversão documentada (`SET encerrado_em = NULL` + reaplicar função da 0065); sem down-migration automática | ⚠️ parcial | `0070:28` |
| Software Upgrade | `CREATE OR REPLACE FUNCTION` mantém o contrato; coluna nullable sem lock longo | ✅ presente | `0070:38-70` |
| Retry | Retry de remessa reusa a linha; `settle` mantém o 1º `encerrado_em`, `fail` sobrescreve e um retry que liquida corrige | ✅ presente | `RemessaExecucaoRepository.ts:180-183,206` |
| Ignore Faulty Behavior | N/A — sem fonte de dado suspeita filtrada no delta | N/A | — |
| Degradation | Aceite tardio recalcula a semana; sem remessa exibe rótulo em vez de erro; `historico` opt-in | ✅ presente | `page.tsx`, `routes/metricas.ts:26-30` |
| Reconfiguration | N/A — sem topologia dinâmica no delta | N/A | — |
| Shadow | N/A — sem operação paralela de versões da função | N/A | — |
| State Resynchronization | Série recalculada quando o sync grava a situação; backfill alinha `encerrado_em` | ✅ presente | `0070:10-16,45-47` |
| Escalating Restart | N/A — Render reinicia o processo; nada no delta | N/A | — |
| Non-Stop Forwarding | N/A — sem plano de dados/controle separados | N/A | — |
| Removal from Service | Sem como desligar só a CTE SISPAG | ❌ ausente | F-availability-1 |
| Transactions | `settle`/`fail` são um UPDATE atômico por linha; migration sem BEGIN/COMMIT no arquivo (depende do runner) | ⚠️ parcial | F-availability-3 |
| Predictive Model | N/A — sem dado de tendência | N/A | — |
| Exception Prevention | Zod na query; `historico` como enum; SQL parametrizado | ✅ presente | `routes/metricas.ts:15-21` |
| Increase Competence Set | A tela distingue "aguardando retorno" de "rejeitado" | ✅ presente | `0070:5-10` |

## 4. Findings

### F-availability-1: Uma única função SQL serve as 3 frentes; erro na CTE SISPAG derruba todas

- **Severidade**: P2
- **Tactic violada**: Removal from Service (isolamento de falha)
- **Localização**: `src/backend/migrations/0070_metricas_ciclo_sispag.sql:53-264`, `MetricasCicloRepository.ts`
- **Evidência (objetiva)**:
  ```
  CREATE OR REPLACE FUNCTION metricas.metricas_ciclo(...) — CTEs permutas, recebimentos e sispag em um único SELECT
  ```
- **Impacto técnico**: uma exceção em runtime na CTE SISPAG (dado inesperado em `lote_pagamento_item`) falha a query inteira e a tela perde as 3 frentes.
- **Impacto de negócio**: relatório semanal do ciclo (kavex-report-ciclo) indisponível. Sem impacto em escrita financeira.
- **Métrica de baseline**: 0 incidentes observados; 48 testes SQL em Postgres real cobrem a função. Sem número de falha, P2.

### F-availability-2: Aceite depende do cron de sync sem sinal de defasagem na métrica

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Heartbeat
- **Localização**: `0070:5-10`; `page.tsx:157-160`
- **Evidência (objetiva)**:
  ```
  situacao NULL antes da 1ª sincronização → "aguardando retorno". Semana 25/09–02/10: 11 títulos enviados, 0 aceitos.
  ```
- **Impacto técnico**: se o cron falhar (precedente: Bad Credentials congelou a carteira em 23/09, run com 0 títulos aparece como success), o KPI fica em 0% e é indistinguível de "banco ainda não retornou".
- **Impacto de negócio**: leitura errada do desempenho SISPAG na reunião semanal. O cron é pré-existente; o delta passa a depender dele.
- **Métrica de baseline**: 0 de 11 títulos aceitos na semana corrente; sem série de defasagem medida.

### F-availability-3: Migration sem transação explícita; backfill e troca da função no mesmo arquivo

- **Severidade**: P3
- **Tactic violada**: Transactions / Rollback
- **Localização**: `0070:38-70`; `src/backend/migrations/migrate.ts`
- **Evidência (objetiva)**:
  ```
  Sem BEGIN/COMMIT em 0070; reversão só descrita em comentário
  ```
- **Impacto técnico**: falha no meio deixa coluna criada sem a função nova. Mitigado: todos os passos são idempotentes, reaplicar converge. Não verifiquei se o runner envolve o arquivo em transação.
- **Impacto de negócio**: nenhum observado; 10 linhas de backfill.
- **Métrica de baseline**: 10 linhas afetadas; 0 falhas observadas.

## 5. Cards Kanban

### [availability-1] Expor o estado do sync de lotes junto do KPI SISPAG

- **Problema**
  > O KPI "Pagamentos aceitos" depende de `lote_pagamento_item.situacao`, preenchida pelo cron `sincronizar-lotes-sispag`. Se o cron falha ou atrasa, 0% parece rejeição do banco (0 de 11 aceitos hoje).
- **Melhoria Proposta**
  > Condition Monitoring: devolver na leitura o instante do último sync bem-sucedido e avisar na tela quando passar do limite (ex.: 24h). Tocar `MetricasCicloRepository`, `MetricasCicloService`, `page.tsx`.
- **Resultado Esperado**
  > Defasagem do sync visível: 0 sinais hoje → 1 aviso quando o sync passar de 24h.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Aviso de sync atrasado: ausente → presente
- **Risco de não fazer**: leitura de 0% como rejeição em semana de falha do cron.
- **Dependências**: nenhuma

### [availability-2] Isolar a falha por frente na leitura de métricas

- **Problema**
  > As 3 frentes saem de uma só função SQL; erro na CTE de uma indisponibiliza toda a tela.
- **Melhoria Proposta**
  > Removal from Service / Degradation: leitura por frente no service (ou funções por frente), devolvendo as demais com marca `indisponível`. Só vale se houver evidência de erro em produção.
- **Resultado Esperado**
  > Frentes servidas independentemente: 0 de 3 → 2 de 3 disponíveis com 1 CTE falha.
- **Tactic alvo**: Removal from Service
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Frentes disponíveis com 1 CTE falha: 0 de 3 → 2 de 3
- **Risco de não fazer**: baixo; um incidente de métricas apaga o relatório inteiro.
- **Dependências**: nenhuma

### [availability-3] Garantir transação explícita nas migrations de função + backfill

- **Problema**
  > A 0070 mistura DDL, backfill e `CREATE OR REPLACE` sem BEGIN/COMMIT visível; a reversão só existe em comentário.
- **Melhoria Proposta**
  > Transactions: confirmar que o runner executa cada arquivo em transação, ou embrulhar em `BEGIN; ... COMMIT;`; guardar o down como script.
- **Resultado Esperado**
  > Migração tudo-ou-nada: estado parcial possível → impossível.
- **Tactic alvo**: Transactions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Estado parcial após falha: possível → impossível
- **Risco de não fazer**: baixo; a migration é idempotente.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta. O carimbo `encerrado_em` no `settle`/`fail` não altera a idempotência da remessa (`WHERE idempotency_key`, sem novo caminho de escrita); sem P0/P1 por falta de baseline numérico de falha.
- Não medíveis: alarmes/DLQ/CloudWatch (sem `infra/`), MTTR real; `statement_timeout` do pool é pré-existente e não foi aprofundado.
- Cross-QA: F-availability-1 toca Modifiability (função monolítica); F-availability-3 toca Deployability (runner de migrations).
