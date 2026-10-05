---
qa: Availability
qa_slug: availability
run_id: 2026-10-05-1645
agent: qa-availability
generated_at: 2026-10-05T16:45:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista / job de envio SISPAG | Favorecido sem destino válido no cadastro; exceção revogada ou falha de leitura (cmn025 / `excecao_destino`) entre o finalizar e o envio | `DestinoPagamentoResolver`, `RemessaService` (pré-voo + montar `fin015`), `ExcecaoSubstituicaoService` | Operação normal, flag `SISPAG_EXCECAO_DESTINO_ENABLED` ligada; retomada de lote nativo já criado | Falha fechada ANTES de `criarLote`; item vai ao fluxo de exceção; retomada fixa o destino da tentativa anterior; falha ao aposentar exceção não bloqueia o envio | 0 remessas com destino divergente; 0 lote nativo pela metade; 0 envio bloqueado por falha de housekeeping |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| typecheck / lint backend | limpo / 0 erros | limpo | ✅ | `_shared-metrics.md` |
| Testes backend (jest / test:sql) | 3726+ verdes / 86 verdes (inclui 0075, repositório e serviço de exceção) | 100% verdes | ✅ | `_shared-metrics.md` |
| Retomada fail-closed por divergência de destino (`excecaoId`) | presente (`aplicarFixado`, `diverge()`) | presente | ✅ | `RemessaService.ts` ~1327-1360 |
| Destino da exceção persistido no ledger só como referência | sim (`assinar` grava `excecaoId`) | sim | ✅ | `RemessaService.ts` `assinar` |
| Escritas não atômicas no uso da exceção | 2 (`setExcecaoDestinoItem` + `marcarUso`, sem tx) | 1 tx | ⚠️ | `RemessaService.ts` `registrarUsoDaExcecao` |
| Catch que engole erro no escopo | 1 (`cadastroVence`, com `Logger.warn` redigido, intencional) | 0 silenciosos | ⚠️ | `DestinoPagamentoResolver.ts` `cadastroVence` |
| Agendamento do `aposentar-excecoes-substituidas` | script rodado à mão (sem scheduler) | cron/EventBridge | ⚠️ | `jobs/aposentar-excecoes-substituidas.ts`; CLAUDE.md ("jobs ... não há scheduler") |
| Alarmes CloudWatch / DLQ / timeouts por cliente | não aplicável: sem `infra/` | — | ⚠️ | CLAUDE.md |

> ⚠️ **Não medível localmente**: MTTR real, taxa de itens em exceção, tempo `candidato → conciliado`. Requer logs/métricas de produção. Recomendação: dashboard com a duração das transições do lote SISPAG e contagem de exceções por estado (`PENDENTE`/`APROVADA`/`SUBSTITUIDA`).
> ⚠️ **Não medível**: razão Executor/HTTP e timeouts de clientes não foram reavaliados: o diff não toca clientes HTTP.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A: sem componente de topologia no escopo | N/A | — |
| Heartbeat | N/A: sem processo longo no escopo | N/A | — |
| Monitor | Logger.warn nas falhas de aposentadoria; sem alarme (sem infra) | ⚠️ parcial | `DestinoPagamentoResolver.ts` `cadastroVence` |
| Timestamp | Trilha de auditoria da exceção com eventos (USO, aprovação) e `substituida_em` | ✅ presente | `ExcecaoDestinoRepository.ts` `sqlTransicao` |
| Sanity Checking | Titularidade da exceção conferida com documento ao vivo; destino resolvido conferido no pré-voo | ✅ presente | `RemessaService.ts` `destinoConferidoDoItem` |
| Condition Monitoring | Sem métrica de exceções pendentes/idade | ❌ ausente | — |
| Voting | N/A: sem réplicas computando o mesmo resultado | N/A | — |
| Exception Detection | `DestinoPagamentoAusenteError` agregada; `diverge()` na retomada | ✅ presente | `RemessaService.ts` pré-voo |
| Self-Test | Probe `probe-destino-manual-uso.ts` manual | ⚠️ parcial | `jobs/probe-destino-manual-uso.ts` |
| Active Redundancy | N/A: sem infra própria | N/A | — |
| Passive Redundancy | N/A: idem | N/A | — |
| Spare | N/A: idem | N/A | — |
| Exception Handling | Erros tipados; leitura que falha sobe e o envio falha fechado | ✅ presente | `DestinoPagamentoResolver.ts` `excecao` |
| Rollback | Retomada fixa ao destino registrado; sem compensação do item/ledger | ⚠️ parcial | `RemessaService.ts` `aplicarFixado` |
| Software Upgrade | Migração 0075 testada contra Postgres 17; assinatura legada `MANUAL` ainda lida | ✅ presente | `assinaturaDestinoSchema` |
| Retry | Retomada idempotente do uso (`item.excecaoDestinoId === d.excecaoId`) | ⚠️ parcial | `registrarUsoDaExcecao` |
| Ignore Faulty Behavior | Falha ao aposentar exceção é ignorada; cadastro segue | ✅ presente | `cadastroVence` |
| Degradation | Sem destino válido, o item cai na exceção/analista; flag desligada = comportamento do `main` | ✅ presente | `DestinoPagamentoResolver.ts` docstring |
| Reconfiguration | Kill-switches `SISPAG_EXCECAO_DESTINO_ENABLED`, `sispagLiveWriteEnabled` | ✅ presente | `RemessaService.ts` flags |
| Shadow | Sem modo sombra para a regra de exceção | ❌ ausente | — |
| State Resynchronization | Estado da exceção relido ao vivo no envio; sem reconciliação periódica | ⚠️ parcial | `findAprovada` |
| Escalating Restart | N/A: sem runtime gerenciado neste repo | N/A | — |
| Non-Stop Forwarding | N/A: sem plano de dados redundante | N/A | — |
| Removal from Service | Exceção revogada/substituída deixa de resolver (só `APROVADA`) | ✅ presente | `findAprovada` |
| Transactions | Transição com trava otimista `WHERE estado = $de`; uso (2 escritas) sem tx | ⚠️ parcial | `sqlTransicao` |
| Predictive Model | Sem previsão de exceções | ❌ ausente | — |
| Exception Prevention | Zod na assinatura; titularidade antes de enviar; aposentadoria I12c | ✅ presente | `assinaturaDestinoSchema` |
| Increase Competence Set | N/A: sem lógica de auto-reparo adicional necessária | N/A | — |

## 4. Findings

### F-availability-1: Registro de uso da exceção não é atômico nem reparável
- **Severidade**: P2
- **Tactic violada**: Transactions
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` `registrarUsoDaExcecao` (~1185-1209); `ExcecaoDestinoRepository.ts:375-386`
- **Evidência (objetiva)**:
  ```
  if (item.excecaoDestinoId === d.excecaoId) return;   // guarda de idempotência
  await this.loteRepo.setExcecaoDestinoItem(...);       // escrita 1
  await this.excecoes.marcarUso(...);                   // escrita 2 (append de auditoria)
  ```
- **Impacto técnico**: se a escrita 2 falhar após a 1, a retomada vê o item já apontando para a exceção e pula `marcarUso`. A trilha USO fica sem o evento, e a exceção segue `APROVADA`.
- **Impacto de negócio**: trilha de auditoria de pagamento sem o evento de uso; não há perda financeira, o destino sai correto.
- **Métrica de baseline**: 2 escritas sem transação; 0 testes de falha parcial no escopo (não medido, só inspeção).

### F-availability-2: Aposentadoria de exceções depende de job manual e erros só vão a log
- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Monitor
- **Localização**: `DestinoPagamentoResolver.ts` `cadastroVence`; `src/backend/jobs/aposentar-excecoes-substituidas.ts`
- **Evidência (objetiva)**: catch com `Logger.warn(...)` e sem contador ou alarme; job sem scheduler (CLAUDE.md).
- **Impacto técnico**: exceção obsoleta `APROVADA` permanece elegível a resolver até alguém rodar o job. Isso é seguro porque o cadastro vence, mas é invisível.
- **Impacto de negócio**: acúmulo silencioso de destinos manuais aprovados que ninguém usa mais.
- **Métrica de baseline**: 1 catch que engole erro; 0 alarmes; 1 job manual.

### F-availability-3: Sem observabilidade operacional das exceções (sem baseline de produção)
- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: escopo inteiro (sem `infra/`)
- **Evidência (objetiva)**: nenhuma métrica/alarme de exceções por estado ou idade.
- **Impacto técnico**: não se sabe quantos itens ficam parados na fila de exceção nem por quanto tempo.
- **Impacto de negócio**: pagamento atrasado só aparece quando o fornecedor reclama.
- **Métrica de baseline**: não medível localmente (ver seção 2).

## 5. Cards Kanban

### [availability-1] Tornar atômico o registro de uso da exceção
- **Problema**
  > `registrarUsoDaExcecao` faz duas escritas separadas; falha na segunda deixa o item ligado sem o evento USO, e a guarda de idempotência impede o reparo na retomada.
- **Melhoria Proposta**
  > Executar `setExcecaoDestinoItem` e `marcarUso` na mesma transação (`TransactionClient`), ou fazer a guarda checar o evento USO. Tocar `RemessaService.ts` e `ExcecaoDestinoRepository.ts`.
- **Resultado Esperado**
  > Item ligado ⇔ evento USO gravado; teste de falha parcial verde.
- **Tactic alvo**: Transactions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Escritas não atômicas: 2 → 0
  - Testes de falha parcial: 0 → 1
- **Risco de não fazer**: trilha de auditoria com buracos em reconstrução de incidente.
- **Dependências**: nenhuma

### [availability-2] Agendar a aposentadoria de exceções e contar falhas
- **Problema**
  > O job de aposentadoria é manual e as falhas de `cadastroVence` só geram `Logger.warn`; ninguém é avisado quando acumulam.
- **Melhoria Proposta**
  > Agendar o job (cron do GitHub Actions, como os demais crons) e emitir um `Alerta` do painel de operação quando o número de falhas passar de um limiar.
- **Resultado Esperado**
  > Exceções substituídas aposentadas em ≤1 dia; falhas visíveis no painel.
- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Execução do job: manual → diária
  - Alarmes sobre falha de aposentadoria: 0 → 1
- **Risco de não fazer**: destinos manuais obsoletos permanecem aprovados e invisíveis.
- **Dependências**: nenhuma

### [availability-3] Instrumentar a fila de exceções de destino
- **Problema**
  > Sem métrica da idade e do volume de exceções `PENDENTE`/`APROVADA`, não há como defender SLA nem detectar fila parada.
- **Melhoria Proposta**
  > Expor contagem e idade da exceção mais antiga por estado no painel de operação (`SispagPainelService`, `Alerta`).
- **Resultado Esperado**
  > Baseline de produção coletável; alerta se `PENDENTE` > N dias.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Métricas de exceção no painel: 0 → 3
- **Risco de não fazer**: atraso de pagamento só detectado por reclamação.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: apenas arquivos de `sispag-excecao-destino`. Não reavaliei Executor, DLQ, timeout nem alarmes (não há `infra/`; o diff não toca clientes HTTP).
- Pontos fortes: falha fechada, fixação do destino na retomada, "cadastro vence", kill-switches. Nenhum P0 (sem baseline numérico de perda).
- Cross-QA: F-1 conversa com fault-tolerance (atomicidade); F-2/F-3 com deployability (scheduler).
