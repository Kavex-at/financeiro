---
qa: Availability
qa_slug: availability
run_id: 2026-10-06-1506
agent: qa-availability
generated_at: 2026-10-06T15:30:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review (delta `1e68bd7..HEAD`, sispag-lotes-vencimento-mover)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (ou cron de formação) | Move título entre lotes RASCUNHO enquanto outro processo finaliza/gera remessa do mesmo lote, ou a tx falha no meio | `LotePagamentoService.incluirTitulo` + `LotePagamentoRepository` | Operação normal, concorrência analista x cron x finalização | Move é atômico (tx + advisory lock); título em lote comprometido é recusado; falha reverte tudo | 0 títulos perdidos ou duplicados em lotes; 0 itens adicionados a lote FINALIZADO/REMESSA_GERADA após o gate |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Mover atômico (saída+entrada na mesma tx) | sim | sim | ✅ | LotePagamentoService.ts `retirarDaOrigem` dentro de `withTransaction` |
| Guard de lote comprometido | sim, dentro da tx e sob advisory lock por título | sim | ✅ | `loteComprometidoComTitulo` |
| Guard RASCUNHO na origem (DELETE condicional, rowCount 0 aborta) | sim | sim | ✅ | `removerItemDeRascunho` |
| Guard RASCUNHO no lote DESTINO dentro da tx | não (checado em `exigirLote` antes da tx; INSERT sem condição de status) | sim | ⚠️ | LotePagamentoService.ts (`exigirLote`) vs `adicionarItem` |
| Lock de título vs. `finalizar` | advisory lock só em incluirTitulo; `finalizar` não verificado no delta | serializado | ⚠️ | LotePagamentoService.ts `lockKey` |
| Idempotência do mover (repetição) | `ON CONFLICT DO NOTHING` no destino; origem sem item não reaparece | idempotente | ✅ | `adicionarItem` |
| IO externo novo (timeout/retry) | delta não adiciona IO externo novo | n/a | ✅ | git diff |
| DLQ / alarmes / shared_account_id | N/A: não existe `infra/` | n/a | N/A | CLAUDE.md |
| Testes de availability do delta | cobrem mover atômico, bloqueio comprometido, origem não-rascunho (lidos do diff; suíte não reexecutada) | presentes | ✅ | LotePagamentoService.test.ts |

> ⚠️ **Não medível localmente**: MTTR e taxa real de conflitos de mover. Requer logs de produção. Recomendação: métrica de contagem diária de `TitleInCommittedBatchError` e `LoteVersaoConflitoError`.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Sem alteração no delta | N/A | delta sem health-check |
| Heartbeat | Sem alteração | N/A | — |
| Monitor | Audit `moverTitulo` com origem/cancelamento; sem métrica | ⚠️ parcial | `audit('moverTitulo')` |
| Timestamp | `atualizado_em`/`versao` bumpados na origem | ✅ presente | `cancelarSeVazio`, `tocarLote` |
| Sanity Checking | Guard de estado comprometido e de origem RASCUNHO | ✅ presente | `TitleInCommittedBatchError`, `removerItemDeRascunho` |
| Condition Monitoring | Sem alteração | N/A | — |
| Voting | Não aplicável | N/A | — |
| Exception Detection | Erros tipados novos | ✅ presente | LotePagamentoService.ts |
| Self-Test | Ausente | ❌ ausente | — |
| Active Redundancy | Não aplicável ao delta | N/A | — |
| Passive Redundancy | Não aplicável | N/A | — |
| Spare | Não aplicável | N/A | — |
| Exception Handling | Falha de lock vira `LoteVersaoConflitoError` (retry pela UI) | ✅ presente | handler do advisory lock |
| Rollback | Tx única reverte saída+entrada | ✅ presente | `withTransaction` |
| Software Upgrade | Não aplicável | N/A | — |
| Retry | Retry manual via conflito; sem IO externo para executor | ⚠️ parcial | idem |
| Ignore Faulty Behavior | Não aplicável | N/A | — |
| Degradation | Origem vazia é cancelada, sem lote fantasma | ✅ presente | `cancelarSeVazio` |
| Reconfiguration | Não aplicável | N/A | — |
| Shadow | Não aplicável | N/A | — |
| State Resynchronization | Origem aberta em outra tela recebe conflito de versão | ✅ presente | `tocarLote` |
| Escalating Restart | Não aplicável | N/A | — |
| Non-Stop Forwarding | Não aplicável | N/A | — |
| Removal from Service | Não aplicável ao delta | N/A | — |
| Transactions | Tx + advisory lock por título | ✅ presente | `incluirTitulo` |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | Painel projeta `loteComprometido` e serviço recusa | ✅ presente | SispagPainelService.ts |
| Increase Competence Set | Não aplicável | N/A | — |

## 4. Findings

### F-availability-1: Lote destino não é revalidado como RASCUNHO dentro da tx
- **Severidade**: P2
- **Tactic violada**: Sanity Checking / Transactions
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts` (`exigirLote` antes da tx; `adicionarItem` sem condição de status)
- **Evidência (objetiva)**:
  ```
  exigirLote fora da tx; INSERT ... ON CONFLICT DO NOTHING sem checar lote.status.
  Lock é por título, não por lote.
  ```
- **Impacto técnico**: janela estreita em que título entra num lote recém-FINALIZADO.
- **Impacto de negócio**: título pago sem a revisão da analista; baixo (janela de milissegundos, pré-existente).
- **Métrica de baseline**: 1 janela de race identificada; 0 incidentes medidos (não medível localmente).

### F-availability-2: DELETE da origem lê status do lote sem lock da linha do lote
- **Severidade**: P2
- **Tactic violada**: Transactions
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` `removerItemDeRascunho`
- **Evidência (objetiva)**:
  ```
  DELETE ... USING lote_pagamento l WHERE l.status='RASCUNHO'  -- sem FOR UPDATE no lote
  ```
- **Impacto técnico**: finalização concorrente da origem pode passar; título sai de lote já finalizado.
- **Impacto de negócio**: lote finalizado com um título a menos que o aprovado; detectável, sem duplicidade financeira.
- **Métrica de baseline**: 1 caminho de race; 0 incidentes medidos.

### F-availability-3: Sem métrica dos conflitos/bloqueios novos
- **Severidade**: P3
- **Tactic violada**: Monitor
- **Localização**: `LotePagamentoService.ts`
- **Evidência (objetiva)**: sem contador de `TitleInCommittedBatchError`; só audit.
- **Impacto técnico**: frequência de colisão analista x cron invisível.
- **Impacto de negócio**: ajustes de UX/cron sem dados.
- **Métrica de baseline**: 0 métricas.

Nenhum P0: o fluxo de escrita é atômico, bloqueia lote comprometido e não adiciona IO externo.

## 5. Cards Kanban

### [availability-1] Revalidar status do lote dentro da tx do incluir/mover
- **Problema**
  > O lote destino é checado como RASCUNHO fora da tx e o INSERT não condiciona o status; `finalizar` concorrente não é serializado com o incluir (F-availability-1, F-availability-2).
- **Melhoria Proposta**
  > Dentro da tx, `SELECT status ... FOR UPDATE` no destino (e na origem em `removerItemDeRascunho`) antes de mutar; recusar se não for RASCUNHO. Tactic: Transactions.
- **Resultado Esperado**
  > Caminhos de race 2 -> 0, com teste de concorrência finalizar x incluir.
- **Tactic alvo**: Transactions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - Caminhos de race conhecidos: 2 -> 0
- **Risco de não fazer**: lote finalizado divergente do aprovado, raro e difícil de reproduzir.
- **Dependências**: nenhuma

### [availability-2] Contar bloqueios e conflitos do mover
- **Problema**
  > Sem métrica de `TitleInCommittedBatchError` / `LoteVersaoConflitoError` (F-availability-3).
- **Melhoria Proposta**
  > Log estruturado com chave filtrável e contagem diária no painel de operação. Tactic: Monitor.
- **Resultado Esperado**
  > Séries de conflito observáveis: 0 -> 2.
- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Séries de conflito observáveis: 0 -> 2
- **Risco de não fazer**: ajuste de UX/cron sem dados.
- **Dependências**: nenhuma

### [availability-3] Teste de integração de concorrência do mover
- **Problema**
  > Os testes do delta são unitários; a atomicidade real sob concorrência não é exercitada.
- **Melhoria Proposta**
  > Teste com Postgres: dois movers simultâneos do mesmo título e mover x finalizar. Tactic: Transactions.
- **Resultado Esperado**
  > Cenários concorrentes cobertos: 0 -> 2.
- **Tactic alvo**: Transactions
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - Testes de concorrência: 0 -> 2
- **Risco de não fazer**: regressões de atomicidade passam despercebidas.
- **Dependências**: availability-1

## 6. Notas do agente

- Escopo: só o delta; sem `infra/`, DLQ, alarmes e timeouts não se aplicam.
- Suíte não reexecutada; testes citados vêm do diff.
- Cross-QA: Testability (concorrência sem teste de integração).
