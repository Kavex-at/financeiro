---
qa: Availability
qa_slug: availability
run_id: 2026-10-08-1958-sispag-titulos
agent: qa-availability
generated_at: 2026-10-08T20:10:00Z
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Clica em exportar com até 5000 chaves enquanto o Postgres está lento/indisponível | `POST /sispag/titulos/exportar` → `TitulosAPagarExportService` | Operação normal, Render (instância única) | Export é READ-ONLY e local: falha de forma isolada (erro HTTP), sem efeito colateral em Conexos/Nexxera, sem afetar remessa/lote | 0 escrita externa; falha do export não degrada as demais rotas (limitador `heavyRouteLimiter`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas em sistema externo no delta | 0 (rota lê `titulo_a_pagar` + lotes locais) | 0 | ✅ | `TitulosAPagarExportService.ts:61-66` |
| Chamadas HTTP externas no delta (precisariam de Executor/timeout) | 0 | n/a | ✅ | `TitulosAPagarExportService.ts` (sem client) |
| Entrada validada (Zod) com teto | 1..5000 chaves, regex por chave | teto definido | ✅ | `routes/sispag.ts` (schema `exportarTitulosAPagarSchema`) |
| Corpo cabe no limite do Express | 5000 chaves < 100 KB (teste existente) | cabe | ✅ | `routes/sispag.test.ts`, `buildApp.ts:56` |
| Rate limit na rota | `heavyRouteLimiter` | presente | ✅ | `routes/sispag.ts` (rota nova) |
| Queries por export | 3 paralelas (`listAtivos` relê a carteira inteira, ~1,5 mil linhas) | limitado | ⚠️ | `TitulosAPagarExportService.ts:80-84` |
| Timeout explícito de query/rota no delta | não definido no delta | definido | ⚠️ | ausência no código do delta |
| Testes backend / frontend | 4072 / 908 verdes | verde | ✅ | `_shared-metrics.md` |
| Alarmes CloudWatch, DLQ, `shared_account_id` | N/A: não existe `infra/` | n/a | ⚠️ | CLAUDE.md |

> ⚠️ **Não medível localmente**: latência/taxa de erro reais do export e MTTR. Requer logs de produção (Render). Recomendação: o log `títulos a pagar exportados` já leva `requestId`; adicionar `durationMs`.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Sem health-check novo; fora do escopo do delta | N/A | rota de leitura sem dependência nova |
| Heartbeat | Sem processo de longa duração no delta | N/A | — |
| Monitor | Log de negócio com contagens (`pedidos`, `titulos`, `ignorados`); sem alarme | ⚠️ parcial | `TitulosAPagarExportService.ts:60-65` |
| Timestamp | Nome do arquivo com data BRT; sem ordenação de eventos | N/A | leitura apenas |
| Sanity Checking | Regex por chave, teto 5000, `!t.pago`, chave ausente ignorada e contada | ✅ presente | `routes/sispag.ts`, `:93` |
| Condition Monitoring | Sem métrica de carga do export | ❌ ausente | — |
| Voting | Sem redundância computacional | N/A | — |
| Exception Detection | `asyncHandler` + 400 com `flatten()`; erro de DB propaga ao handler global | ✅ presente | `routes/sispag.ts` |
| Self-Test | Sem self-test | N/A | fora do escopo |
| Active Redundancy | Instância única (Render) | N/A | decisão de infra pré-existente |
| Passive Redundancy | Idem | N/A | idem |
| Spare | Idem | N/A | idem |
| Exception Handling | Erro → HTTP 5xx tratado pelo middleware; sem estado parcial | ✅ presente | `routes/sispag.ts` |
| Rollback | Sem mutação, nada a reverter | N/A | read-only |
| Software Upgrade | Fora do delta | N/A | — |
| Retry | Sem retry; usuário reexecuta (idempotente por natureza) | ⚠️ parcial | export é idempotente |
| Ignore Faulty Behavior | Chaves obsoletas ignoradas e contadas | ✅ presente | `TitulosAPagarExportService.ts:92-98` |
| Degradation | Export é acessório: falhar não bloqueia seleção/remessa; filtro de comprometidos reduz ruído sem mudar ADR-0064 | ✅ presente | `page.tsx` |
| Reconfiguration | Fora do delta | N/A | — |
| Shadow | Sem | N/A | — |
| State Resynchronization | Valores vêm da carteira persistida, não do cliente; chaves obsoletas tolerantes | ✅ presente | `TitulosAPagarExportService.ts:72-76` |
| Escalating Restart | Fora do delta | N/A | — |
| Non-Stop Forwarding | Sem | N/A | — |
| Removal from Service | Sem | N/A | — |
| Transactions | Leitura sem escrita; 3 selects em `Promise.all` sem snapshot único (risco de leitura levemente inconsistente, aceitável) | ⚠️ parcial | `:80-84` |
| Predictive Model | Sem | ❌ ausente | — |
| Exception Prevention | Zod + teto + rate limit evitam payload/loop abusivo | ✅ presente | `routes/sispag.ts` |
| Increase Competence Set | Cap 5000 = `TITULOS_CAP`; ExcelJS em memória, ~5000 linhas | ✅ presente | `_shared-metrics.md` |

## 4. Findings

### F-availability-1: Export sem `durationMs` nem statement timeout explícito
- **Severidade**: P2
- **Tactic violada**: Monitor / Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/TitulosAPagarExportService.ts:80-84`, `:60-65`
- **Evidência (objetiva)**:
  ```
  const [ativos, emRascunho, comprometidos] = await Promise.all([ listAtivos(), ... ])
  ```
  Nenhum timeout ou duração registrada no delta.
- **Impacto técnico**: query lenta segura conexão do pool compartilhado com as rotas de remessa/lote.
- **Impacto de negócio**: improvável, mas export lento pode atrasar o fluxo do analista.
- **Métrica de baseline**: 3 queries por export, ~1,5 mil linhas na carteira; latência real não medida.

### F-availability-2: Leitura sem filtrar por chave no SQL (relê a carteira inteira)
- **Severidade**: P3
- **Tactic violada**: Increase Competence Set
- **Localização**: `TitulosAPagarExportService.ts:80-84`
- **Evidência (objetiva)**: `listAtivos()` + filtro em memória pelas chaves.
- **Impacto técnico**: custo cresce com a carteira, não com o pedido.
- **Impacto de negócio**: nenhum hoje.
- **Métrica de baseline**: ~1,5 mil linhas vs. teto 5000.

Sem P0/P1: o delta é read-only, sem I/O externo, sem fila e sem escrita financeira.

## 5. Cards Kanban

### [availability-1] Registrar duração do export e limitar tempo de query
- **Problema**
  > O export não registra `durationMs` e não tem limite de tempo próprio; query lenta ocuparia o pool compartilhado sem sinal.
- **Melhoria Proposta**
  > Incluir `durationMs` no log `títulos a pagar exportados` e aplicar `statement_timeout` nas leituras do export (tactic Monitor).
- **Resultado Esperado**
  > Latência do export observável; queries limitadas (hoje: sem medição → p95 acompanhado).
- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Log com `durationMs`: ausente → presente
- **Risco de não fazer**: lentidão do export só descoberta por reclamação.
- **Dependências**: nenhuma

### [availability-2] Filtrar a carteira por chaves no SQL quando o pedido for pequeno
- **Problema**
  > O export relê toda a carteira ativa para atender qualquer quantidade de chaves.
- **Melhoria Proposta**
  > Repositório com busca por chaves (`= ANY($1)`, parametrizado) usada quando `chaves.length` for pequeno.
- **Resultado Esperado**
  > Custo proporcional ao pedido (hoje ~1,5 mil linhas lidas por export → apenas as pedidas).
- **Tactic alvo**: Increase Competence Set
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Linhas lidas por export pequeno: ~1,5 mil → ≈ nº de chaves
- **Risco de não fazer**: custo cresce com a carteira; baixo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de e832057; `--quick`, sem testes rodados (baselines de `_shared-metrics.md`).
- Sem `infra/`: DLQ, alarmes e blast radius multi-tenant não medíveis. Frontend não avaliado em profundidade.
- Cross-QA: Performance (F-availability-2) e Testability (consolidator).
