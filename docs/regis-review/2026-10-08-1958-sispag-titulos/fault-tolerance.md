---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-08-1958
agent: qa-fault-tolerance
generated_at: 2026-10-08T20:10:00Z
scope: all
score: 9
findings_count: 1
cards_count: 1
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Duplo clique / retry no botão "Exportar títulos a pagar", ou falha do Postgres durante a leitura | `POST /sispag/titulos/exportar` + `TitulosAPagarExportService` + `ExportarTitulosAPagarBotao` | Operação normal, carteira ~1,5 mil títulos, teto 5000 | Export é read-only: repetir é inócuo; falha vira erro 5xx tratado e `toast.error`; nenhum estado persistido é alterado | 0 escritas financeiras no delta; 0 estado preso; falha visível ao usuário em 100% dos casos |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas (DB/ERP) introduzidas pelo delta | 0 | 0 para rota de leitura | ✅ | `TitulosAPagarExportService.ts` (só `listAtivos`, `listTitulosEm*`) |
| Idempotência do endpoint | Natural (read-only, sem efeito colateral) | idempotente | ✅ | `routes/sispag.ts` rota `/titulos/exportar` |
| Validação de entrada (Zod, teto 1..5000) | presente | 100% | ✅ | `exportarTitulosAPagarSchema` |
| Chave obsoleta (título sai da carteira) tratada | ignorada e contada em `ignorados` no log | detectada, não silenciosa | ✅ | `TitulosAPagarExportService.ts:118` |
| Falha de mutação com notificação no frontend | `toast.error` no catch | 100% | ✅ | `ExportarTitulosAPagarBotao.tsx:26-30` |
| Chamadas externas no delta | 0 (sem Conexos) | n/a | ✅ | `_shared-metrics.md` |
| Snapshot consistente entre as 3 leituras | não (3 queries em `Promise.all`, sem transação) | consistência de leitura best-effort | ⚠️ | `TitulosAPagarExportService.ts:77-81` |
| Timeout explícito da query de export | não medido no delta (herdado do pool) | statement_timeout | ⚠️ | não medível localmente (`--quick`) |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod valida formato e cardinalidade das chaves; 400 com detalhes | ✅ presente | `routes/sispag.ts` schema |
| Idempotent Replay | Operação read-only; reexecução produz a mesma planilha | ✅ presente | service `exportar` |
| Condition Monitoring | Log `BUSINESS_INFO` com `pedidos/titulos/ignorados` | ✅ presente | `TitulosAPagarExportService.ts:65-69` |
| Comparison | Chaves pedidas vs. carteira atual (stale detectado) | ✅ presente | `:98-104,118` |
| Timeout | Sem timeout específico no delta | ⚠️ parcial | pool herdado |
| Rollback / Compensating Transaction | N/A: nenhuma escrita a desfazer | N/A | read-only |
| Quarantine / Reconcile / stuck-state reaper | N/A: não há máquina de estado nova; ADR-0064 inalterado | N/A | delta |
| Audit trail | N/A: leitura não muta estado; log informativo com requestId basta | N/A | — |
| Frontend failure notification | `toast.error` + `finally` libera o botão; sessão expirada tratada | ✅ presente | `ExportarTitulosAPagarBotao.tsx` |

## 4. Findings (achados)

### F-fault-tolerance-1: Export lê três fontes sem snapshot consistente

- **Severidade**: P3
- **Tactic violada**: Comparison (consistência entre leituras)
- **Localização**: `src/backend/domain/service/sispag/TitulosAPagarExportService.ts:77-81`
- **Evidência (objetiva)**:
  ```
  const [ativos, emRascunho, comprometidos] = await Promise.all([...])
  ```
- **Impacto técnico**: Se um lote for finalizado entre as leituras, a coluna "Lote" pode divergir por uma linha numa planilha pontual; nada é persistido.
- **Impacto de negócio**: Desprezível; planilha é de consulta, não de execução.
- **Métrica de baseline**: 0 escritas; janela de divergência de milissegundos, ~1,5 mil linhas.

## 5. Cards Kanban

### [fault-tolerance-1] Documentar o export como leitura best-effort

- **Problema**
  > As três leituras do export não compartilham snapshot; hoje isso não é registrado como decisão.

- **Melhoria Proposta**
  > Adicionar comentário/ADR curto no service: leitura best-effort aceita porque o export é read-only; se a coluna "Lote" virar base de decisão, usar uma transação `REPEATABLE READ`.

- **Resultado Esperado**
  > Decisão explícita registrada (0 → 1 nota); sem mudança de comportamento.

- **Tactic alvo**: Comparison
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Decisão documentada: 0 → 1
- **Risco de não fazer**: Alguém reutiliza o service para fluxo de escrita assumindo consistência que não existe.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick`: apenas o delta de e832057; sem varreduras globais de SQS/DLQ/transações (nenhuma toca o delta).
- Delta não adiciona escrita financeira, SQS nem chamada Conexos; risco de dupla execução inexistente.
- Cross-QA: timeout/statement_timeout da query se liga a Performance; teto 5000 + `heavyRouteLimiter` a Availability/Security.
