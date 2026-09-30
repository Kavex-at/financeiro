---
qa: Performance
qa_slug: performance
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-performance
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 9
findings_count: 2
cards_count: 1
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta metricas-sispag)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/metricas` | `GET /metricas/ciclo` executa a função SQL com a nova CTE `sispag_itens` (JOIN LATERAL por item sobre `remessa_execucao`) | Função de métricas (migration 0070), `RemessaExecucaoRepository.settle/fail`, `metricas/page.tsx` | Produção: ~30 itens de lote, 10 linhas em `remessa_execucao`; leitura esporádica | Calcular as janelas semanais sem varredura desnecessária; escritas de settle/fail sem custo extra | Função < 50 ms com o volume atual; crescimento linear em itens, sem N+1 na aplicação; +0 round-trips nas escritas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Linhas varridas pela CTE SISPAG (itens × lookup lateral) | ~30 itens × ≤10 linhas de remessa (índice em `lote_id`) | < 10k linhas por chamada | ✅ | 0070:125-143; volumes informados |
| Índice de apoio ao LATERAL (`remessa_execucao.lote_id`) | existe (`idx_remessa_execucao_lote`) | presente | ✅ | migrations/0049:99 |
| Índice `lote_pagamento_item(lote_id)` | coberto pelo UNIQUE (lote_id, fil_cod, doc_cod, tit_cod) | presente | ✅ | migrations/0023:43 |
| Índice `lote_pagamento.status` (filtro `<> 'CANCELADO'`) | existe, mas o predicado `<>` não o usa; irrelevante a 30 linhas | n/a | ✅ | migrations/0023:51 |
| Lookup LATERAL repetido por item (mesmo `lote_id`) | 1 execução por item, não por lote | 1 por lote | ⚠️ | 0070:134-143 |
| CTE `sispag_itens` sem filtro de janela (varre todos os itens da história) | todos os itens, sempre | limitado às semanas exibidas | ⚠️ | 0070:125-143 |
| Round-trips extras em `settle`/`fail` | 0 (uma coluna a mais no mesmo UPDATE) | 0 | ✅ | RemessaExecucaoRepository.ts:180-207 |
| Peso do bundle frontend na rota `/metricas` | +2 KPIs, +2 colunas; sem novas dependências | sem novas deps | ✅ | git diff page.tsx |
| Timeouts / timers manuais / pool | N/A no delta (sem novo cliente externo, sem setTimeout) | — | ✅ | git diff |
| Cold start / bundle Lambda / SQS | ⚠️ **Não medível localmente**: não há Lambda/SQS/infra no repo. Recomendação: medir após a migração para Lambda | — | — | CLAUDE.md (Estado Atual) |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: métrica calculada sob demanda, sem amostragem | N/A | — |
| Limit Event Response | N/A: sem eventos/filas no delta | N/A | — |
| Prioritize Events | N/A: sem fila | N/A | — |
| Reduce Overhead | Cálculo em uma única função SQL (sem N+1 na aplicação); `encerrado_em` acrescentado ao UPDATE existente | ✅ presente | 0070; RemessaExecucaoRepository.ts:180 |
| Bound Execution Times | Sem `statement_timeout` próprio; função barata a este volume (padrão herdado da 0065) | ⚠️ parcial | 0070 |
| Increase Resource Efficiency | LATERAL ... LIMIT 1 com índice em `lote_id`; ineficiência residual: lookup por item e sem janela | ⚠️ parcial | 0070:134-143 |
| Increase Resources | N/A: sem infra AWS | N/A | — |
| Increase Concurrency | N/A: leitura única por requisição | N/A | — |
| Maintain Multiple Copies of Computations | N/A: sem réplicas de processamento no delta | N/A | — |
| Maintain Multiple Copies of Data | Sem cache da métrica; a página lê por requisição | ⚠️ parcial | page.tsx |
| Bound Queue Sizes | N/A: sem fila | N/A | — |
| Schedule Resources | N/A: sem escalonamento no delta | N/A | — |
| Index discipline | `lote_id` indexado nos dois lados; `encerrado_em` não indexado (não é predicado isolado) | ✅ presente | 0049:99; 0023:43 |

## 4. Findings (achados)

### F-performance-1: LATERAL executa por item e a CTE não é limitada à janela exibida

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/migrations/0070_metricas_ciclo_sispag.sql:125-143`
- **Evidência (objetiva)**:
  ```
  FROM lote_pagamento_item i JOIN lote_pagamento l ...
  JOIN LATERAL (SELECT ... FROM remessa_execucao x WHERE x.lote_id = i.lote_id
                AND x.dry_run = false AND x.status = 'settled'
                ORDER BY COALESCE(x.encerrado_em, x.criado_em) LIMIT 1) r ON true
  ```
  Todos os itens de lotes não cancelados entram, mesmo fora das semanas exibidas; o mesmo lote é reavaliado por cada item.
- **Impacto técnico**: custo cresce O(itens) por chamada. Com ~30 itens, 10 remessas e índice em `lote_id` é desprezível; só relevante na casa de dezenas de milhares de itens.
- **Impacto de negócio**: nenhum hoje.
- **Métrica de baseline**: ~30 itens × ≤10 remessas = ~300 comparações por chamada (estimativa dos volumes informados; sem EXPLAIN em produção).

### F-performance-2: Sem teto de tempo nem cache no endpoint de métricas (pré-existente)

- **Severidade**: P3
- **Tactic violada**: Bound Execution Times
- **Localização**: rota `GET /metricas/ciclo` e função SQL (padrão herdado da 0065; **pré-existente**)
- **Evidência (objetiva)**: o delta acrescenta uma CTE à função existente e não introduz `statement_timeout` nem cache.
- **Impacto técnico**: sem número que justifique ação neste volume; registrado como observação.
- **Impacto de negócio**: nenhum hoje.
- **Métrica de baseline**: n/d (sem tempo medido em produção).

## 5. Cards Kanban

### [performance-1] Agregar SISPAG por lote e limitar às semanas exibidas na função de métricas

- **Problema**
  > A CTE `sispag_itens` do 0070 resolve o LATERAL uma vez por item e varre toda a história de itens a cada `GET /metricas/ciclo`. Hoje custa ~300 comparações (30 itens × ≤10 remessas), sem efeito visível; é crescimento linear sem teto.

- **Melhoria Proposta**
  > Em migration futura: resolver a 1ª remessa `settled` uma vez por lote (CTE agrupada por `lote_id`) e juntar aos itens; filtrar itens pela janela das semanas exibidas. Tactic: Increase Resource Efficiency. Executar só quando o volume passar de ~5k itens ou a função passar de 100 ms; medir antes com `EXPLAIN ANALYZE`.

- **Resultado Esperado**
  > Execuções do lookup por chamada: nº de itens (~30) → nº de lotes (~10); tempo da função estável com o crescimento do histórico.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - Execuções do lookup lateral por chamada: ~30 → ~10 (nº de lotes)
  - Tempo p95 da função de métricas: medir baseline → manter < 100 ms com 10x o volume
- **Risco de não fazer**: baixo; com 10x o volume atual (~300 itens) ainda desprezível. Só afeta se o histórico crescer ordens de grandeza.
- **Dependências**: nenhuma; adiar até haver EXPLAIN em produção.

## 6. Notas do agente

- Escopo restrito ao delta; nada pré-existente foi promovido a P0/P1 (F-performance-2 é pré-existente). Sem baseline de produção além dos volumes informados, tudo ≤ P3.
- `settle`/`fail`: `encerrado_em` no mesmo UPDATE, sem round-trip extra.
- Frontend: sem novas deps; 2 KPIs e 2 colunas a mais, impacto de render desprezível.
- Cross-QA: o backfill `UPDATE remessa_execucao` da 0070 (10 linhas, sem risco de lock) é assunto de Deployability; índices/migrations são assunto de Modifiability.
