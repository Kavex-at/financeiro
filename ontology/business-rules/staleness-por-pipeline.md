---
name: staleness-por-pipeline
type: business-rule
entity: JobRun
ontology_version: "0.22"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-01
has_canonical_test: false
---

# Regra: staleness-por-pipeline

> O limite de "parado" é **por pipeline**, derivado da cadência real do seu cron. Um limite global
> estaria errado para todos eles ao mesmo tempo.

## Limites

| Pipeline | Cron | Maior gap normal | **Limite** | Folga |
|---|---|---|---|---|
| `recebimentos-extratos` | `20 * * * *` | 1h | **3h** | 2 execuções perdidas |
| `permutas-eleicao` | `0 9,15,21 * * *` | 12h (21h→9h) | **18h** | 1 execução perdida |
| `sispag-pagamentos` | `0 10 * * *` | 24h | **30h** | 6h |
| `sispag-reaper` | `10,25,40,55 * * * *` | 15min | **1h** | 3 execuções perdidas |

## Como os números foram escolhidos

Cada limite é o maior gap normal **mais** folga para ao menos uma execução perdida. Schedules do GH
Actions são best-effort: uma execução atrasada é comportamento esperado, não incidente. Alertar na
primeira perdida treinaria o time a ignorar o canal — que é o modo de falha mais caro de um sistema
de alerta, porque ele desativa todos os outros alertas junto.

A folga do `sispag-pagamentos` é proporcionalmente a menor (6h em 24h) porque é o pipeline de
cadência mais lenta: uma janela maior significaria descobrir a falha quase um dia depois.

## A confirmar

Se a ingestão SISPAG **não** roda aos fins de semana, o limite de 30h dispara falso todo domingo e
precisa de exceção por dia da semana. O cron atual (`0 10 * * *`) dispara todos os dias, então a
premissa aqui é que uma run bem-sucedida é esperada diariamente. Verificar no primeiro fim de semana
após o deploy antes de considerar a regra estável.
