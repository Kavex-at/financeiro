---
qa: Performance
qa_slug: performance
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-performance
generated_at: 2026-10-05T21:45:00-03:00
scope: backend
score: 9
findings_count: 2
cards_count: 1
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (execução de permuta N:M) | Execução de uma permuta com várias pernas/títulos, cada um passando por `baixarTitulo` | `ReconciliacaoPermutaService.baixarTitulo` + novo `limitarAoDisponivelDoAdto` | Operação normal, ERP Conexos com p99 de 2–10s por chamada | O teto do líquido é calculado em memória, sem I/O novo, e não altera a latência da baixa | 0 chamadas ERP/DB adicionais por baixa; overhead de CPU < 1 ms por baixa; chamadas fin010 por baixa inalteradas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas ERP adicionadas por baixa | 0 (só aritmética `round2` + 1 log condicional) | 0 | ✅ | `git show c099a55`, `ReconciliacaoPermutaService.ts` (`limitarAoDisponivelDoAdto`) |
| Chamadas DB adicionadas por baixa | 0 no caminho feliz (`excesso <= 0` retorna antes do log); 1 escrita de log (`LogService`) só quando há excesso | ≤ 1 | ✅ | mesmo arquivo |
| Latência do caminho feliz | O(1), sem await de I/O (o `await` só existe nos ramos de log) | O(1) | ✅ | leitura do diff |
| N+1 introduzido no serviço | 0 (nenhum loop novo; roda dentro do loop de títulos já existente, sem I/O) | 0 | ✅ | diff |
| Job `validate-permuta-centavos-adto-v1`: SELECT sem LIMIT | 1 (`WHERE dry_run=false AND request_payload ? 'bxaMnyValorPermuta' ORDER BY id`); 196 linhas em prod | n/a (job manual, não API/SQS) | ⚠️ aceitável | `src/backend/jobs/validate-permuta-centavos-adto-v1.ts:66-71` |
| Job: transação read-only, conexão fechada | `BEGIN READ ONLY`, `ROLLBACK`, `client.end()` antes do loop | sim | ✅ | job linhas 61-73 |
| Bundle / deps / pool | Sem dependência nova, sem alteração de pool | sem delta | ✅ | diff (só `.ts` + docs) |
| Cold start, p95 de API, concorrência SQS | ⚠️ **Não medível localmente**: sem `infra/`, sem CloudWatch. Recomendação: instrumentar duração de `baixarTitulo` (log com `durationMs`). | n/a | ⚠️ | `_shared-metrics.md` |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: não há amostragem no delta | N/A | — |
| Limit Event Response | N/A: sem eventos novos | N/A | — |
| Prioritize Events | N/A: sem filas no delta | N/A | — |
| Reduce Overhead | O teto reaproveita o `bxaMnyValorPermuta` já lido no passo 3, sem nova leitura ao ERP | ✅ presente | `ReconciliacaoPermutaService.ts` (chamada após `ancorarVariacaoNoAdto`) |
| Bound Execution Times | Sem timeout novo; aritmética pura, sem espera | ✅ (N/A para I/O) | diff |
| Increase Resource Efficiency | Early return em `bxaMnyValorPermuta === undefined` e `!(excesso > 0)` | ✅ presente | `limitarAoDisponivelDoAdto` |
| Increase Resources | N/A | N/A | — |
| Increase Concurrency | N/A: função pura, sem estado compartilhado, segura sob concorrência | N/A | — |
| Maintain Multiple Copies of Computations | N/A | N/A | — |
| Maintain Multiple Copies of Data | N/A: nenhum cache novo necessário | N/A | — |
| Bound Queue Sizes | N/A | N/A | — |
| Schedule Resources | N/A | N/A | — |
| Cold start budget | Sem import novo no serviço; job novo não entra em Lambda | ✅ | diff |
| Index discipline | Job filtra por `dry_run` e `request_payload ?` em `permuta_alocacao_execucao`, scan sequencial sobre ~196 linhas reais | ⚠️ parcial (irrelevante hoje) | job linha 66 |

## 4. Findings

### F-performance-1: Job de validação lê todo o ledger sem LIMIT e processa em loop sequencial

- **Severidade**: P3
- **Tactic violada**: Bound Queue Sizes (carga de leitura sem limite)
- **Localização**: `src/backend/jobs/validate-permuta-centavos-adto-v1.ts:66-71`
- **Evidência (objetiva)**:
  ```
  SELECT bor_cod, adiantamento_doc_cod, invoice_doc_cod, request_payload
    FROM permuta_alocacao_execucao
   WHERE dry_run = false AND request_payload ? 'bxaMnyValorPermuta'
   ORDER BY id
  ```
- **Impacto técnico**: Carrega todas as linhas em memória, mas o job é manual e read-only. O `limitar` só faz `await` de logs, sem I/O.
- **Impacto de negócio**: Nenhum hoje. O job é descartável, ground-truth pontual.
- **Métrica de baseline**: 196 linhas lidas, execução de segundos.

### F-performance-2: Log síncrono (`await logService`) no caminho de baixa quando há excesso

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `ReconciliacaoPermutaService.ts`, ramos de `warn`/`info` em `limitarAoDisponivelDoAdto`
- **Evidência (objetiva)**:
  ```
  await this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, ... });
  await this.logService.info({ type: LOG_TYPE.BUSINESS_INFO, ... });
  ```
- **Impacto técnico**: Um await de log, só no ramo com excesso (3 de 196 execuções reais, ~1,5%). Custo desprezível frente a 5 chamadas ERP por baixa a 2–10s p99.
- **Impacto de negócio**: Nenhum mensurável.
- **Métrica de baseline**: 3/196 baixas (1,5%) disparam o log; 0 ms de I/O no caminho feliz.

## 5. Cards Kanban

### [performance-1] Registrar duração de `baixarTitulo` para medir latência por baixa

- **Problema**
  > O delta não adiciona I/O, mas não há medição de latência por baixa (fin010 com 5 passos contra um ERP de p99 2–10s). Sem `durationMs` não dá para provar que mudanças futuras não regridem a execução N:M.

- **Melhoria Proposta**
  > Adicionar `durationMs` no log final de `baixarTitulo` (Reduce Overhead / observabilidade) e, opcionalmente, métrica por passo. Tocar `ReconciliacaoPermutaService.ts`. Nenhuma ação no delta atual é bloqueante.

- **Resultado Esperado**
  > Latência por baixa passa de não medida para p95 observável em log; baseline definido para detectar regressão > 20%.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - Cobertura de `durationMs` nos logs de baixa: 0% → 100%
  - Chamadas ERP/DB adicionais por baixa: 0 → 0 (sem regressão)
- **Risco de não fazer**: Uma regressão de latência na execução N:M só seria percebida por reclamação da analista.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de c099a55. A mudança é aritmética em memória, sem I/O novo, sem dependência nova, sem loop novo. Nenhum P0/P1.
- Não medível: cold start, p95 e concorrência (sem `infra/` nem CloudWatch). O job novo roda à mão, fora de Lambda.
- Cross-QA: o `await` de log e o teto sem timeout próprio não tocam Availability/Fault Tolerance. A ausência de índice em `permuta_alocacao_execucao` (schema fora do delta) fica para Modifiability.
