# Regis-Review — follow-ups do tweak `permutas-saldo-ordem-centavos` (ADR-0046)

**Branch:** `fix/permutas-saldo-ordem-centavos` · **Data:** 2026-09-15 · **Run:** `docs/regis-review/2026-09-15-0207-permutas-saldo-ordem-centavos/`
**Resultado do gate:** score consolidado **7,9** · **0 P0 · 0 P1** · 14 P2 · 9 P3 (23 cards após dedupe cross-QA).
Nenhum card re-entrou no loop (só P0 re-entra). Detalhe de cada card (Problema / Melhoria / Resultado) em
[`KANBAN.md`](../../docs/regis-review/2026-09-15-0207-permutas-saldo-ordem-centavos/KANBAN.md) e narrativa em
[`REPORT.md`](../../docs/regis-review/2026-09-15-0207-permutas-saldo-ordem-centavos/REPORT.md).

Resolvido pelo pipeline (não é follow-up): `bump-versao-v0.36.5` — delta só `fix` → patch.

## Top riscos
1. **R-1** Reuso silencioso de `bor_cod` em execuções terminais → saldo superestimado → super-alocação (`detectar-reuso-borcod`).
2. **R-2** Convergência da nova semântica invisível pós-deploy (`observabilidade-frescor-convergencia`, `comment-atualizado-em`, `rollout-observabilidade`).
3. **R-3** `listConsumosFinalizados` sem teste com Postgres real, sem EXPLAIN, sem índice dedicado (`integracao-postgres-permutas`, `perf-indices-listconsumos`).
4. **R-4** Validador AO VIVO com 2 de 3 guards enforçados no código (`validador-write-guards`, `validador-classificacao-test`).
5. **R-5** `/permutas/gestao` sem RBAC e payload maior (`alocacoes` em `ja-permutado`) (`rbac-gestao-alocacoes`).

## P2
| Card | Título | Esforço | QAs |
|---|---|---|---|
| `comment-atualizado-em` | Documentar em SQL a nova semântica de `permuta_bordero.atualizado_em` | S | IN/DP |
| `perf-indices-listconsumos` | EXPLAIN ANALYZE + `durationMs` + índices dedicados para `listConsumosFinalizados` | S | PE/AV |
| `detectar-reuso-borcod` | Detectar reuso de `bor_cod` para execuções terminais | S | FT/AV/PE |
| `validador-write-guards` | Enforçar `CONEXOS_WRITE_ENABLED=false`/`CONEXOS_DRY_RUN=true` no `main()` do validador | S | SE |
| `validador-classificacao-test` | Teste unitário da classificação do validador (canary de sinal) | S | TE/SE |
| `rollout-observabilidade` | Documentar e observar a janela de rollout do fix D3 | S | DP/AV |
| `rbac-gestao-alocacoes` | Reavaliar leitura sem RBAC de `/permutas/gestao` com o payload expandido | S | SE |
| `kill-switch-saldo` | Kill-switch da regra do `saldoRestante` (`PERMUTAS_SALDO_NAO_CONSUMIDO_ENABLED`) | S | DP |
| `saldoneg-helper` | Helper único `saldoNegDoAdto(adto)` e migração dos 5 call sites | S | MO |
| `observabilidade-frescor-convergencia` | Instrumentar a janela de convergência/frescor pós-deploy | M | DP/AV/IN/FT |
| `unificar-reconciliacao-saldo` | Teto do adto na reconciliação via `SaldoAlocacaoAdiantamentoService` (inclui F1 do tasks.md: baixa lê saldo do banco) | M | AV/FT |
| `reconciliacao-periodica-erp` | Reconciliação DB↔ERP periódica do saldo consumido (reaproveita o script GTV) | M | FT |
| `integracao-postgres-permutas` | Postgres real para `listConsumosFinalizados` e a guarda de frescor | M | TE/PE/AV/IN |

## P3
| Card | Título |
|---|---|
| `runbook-convergencia-pos-deploy` | Sequência e efeito do 1º ingest pós-deploy no runbook |
| `mover-tolerancia-libs` | Mover `ToleranciaResiduo` de `domain/interface/permutas/` para `domain/libs/permutas/` |
| `tolerancia-usd-consolidada` | Consolidar tolerâncias em USD num helper + amarrar `SALDO_TOL` FE↔BE |
| `log-duracao-gestao` | `durationMs` no log do `exporGestao` e do `listConsumosFinalizados` |
| `crescimento-execucao-doc` | Limites de crescimento previstos de `permuta_alocacao_execucao` |
| `existsby-auto-alocacao` | Trocar `listAtivas()` full-scan dos auto-alocadores por `existsBy…`/`countBy…` |
| `skew-clock-app-db` | Instrumentar skew de relógio app↔Postgres |
| `alarme-validador-prd` | Alarme de execução do validador AO VIVO em PRD |
| `property-tolerancia-fastcheck` | Property-based test em `ToleranciaResiduo` (`NaN`/`±Infinity`) |

## Follow-ups de implementação (do tasks.md / AutoLoopRunner)
- **F5** doc 34138: re-gravação da alocação após `settled` renova `atualizado_em` → a regra por versão deixa de contar a baixa (lado seguro; adto já `ja-permutado`).
- **F6** 3569/4228: execuções `settled` apontando para `bor_cod` reutilizado pelo ERP (1824/1825) — a limpeza I-Write-7 só trata `error`. Relacionado a `detectar-reuso-borcod`.
- **F7** `derivarPagoDosTitulos` exportada como função (pré-existente).
- Dados (não código): 4 invoices BRL idênticas no processo 524; 27 proformas "nada pago" há > 6 meses; 5 resíduos ≥ R$21 em verificação com a Columbia.
