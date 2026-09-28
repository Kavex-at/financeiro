# Regis-Review — métricas do ciclo datadas pelo encerramento (ADR-0052) — follow-ups

Run: `docs/regis-review/2026-09-28-1534-metricas-encerramento/` (REPORT.md, KANBAN.md).
Escopo: delta da branch `worktree-metrica-ciclo-data-conclusao`. **0 P0** — nada re-entrou no loop.
Score 7,7/10. 13 cards ativos (1 P1 · 9 P2 · 3 P3). **Não implementados** — lista completa e
ordenada no `KANBAN.md` do run.

## Os que importam primeiro

| Card | P | O quê |
|---|---|---|
| `testability-1` (+ `fault-tolerance-2`) | P1 | Teste contra Postgres real chamando `markError → markSettled → markSettled` dos repositórios (hoje só regex em SQL mockado). Verificado à mão na revisão (T1 → T2 → T2 preservado; trigger 0057 recusa `markError` em baixa confirmada), não codificado. Estender `vwMetricasCiclo.integration.test.ts` — o glob do `test:sql` só cobre `migrations/`. |
| `deployability-1` + `fault-tolerance-3` | P2 | ✅ Consulta rodada em produção em 2026-09-28 (resultado em `metricas-ciclo-data-encerramento-validacao.md`). Achou o lote de 17/08 na SN, e a SN ficou sem backfill. Resta automatizar a verificação (hoje é manual). |
| `modifiability-1` (+ `integrability-1`) + `availability-1` | P2 | "Quais status são terminais" está em SQL literal em 5 escritas; um status terminal novo compila e regride o bug. Fonte única ligada às unions TS e/ou barreira no esquema. |
| `security-1` | P2 | Marcar a procedência do `encerrado_em` (medido × backfill por `atualizado_em`). |
| `performance-1` | P2 | Registrar no `performance-1` antigo (`metricas-historico-6-semanas-regis-followups.md`) que o índice futuro precisa ser de expressão `COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo'`. Custo inalterado pelo delta (medido: 12,8 ms / 6 janelas, 193 ms / 111 janelas, 5 mil linhas). |

## Resolvido nesta revisão, sem código

- `fault-tolerance-1`: linha `error` reaberta por retry mantém o `encerrado_em` da falha enquanto em
  voo. Documentado como intencional (cabeçalho da 0065 e ADR-0052 D1): retentativa presa conta onde
  falhou por último.
