---
name: staleness-por-pipeline
type: business-rule
entity: JobRun
ontology_version: "0.22"
implementation_status: implemented
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
| `sispag-pagamentos` | `0 10 * * *` + `0 15,19 * * 1-5` (ADR-0060) | 24h (fim de semana) | **30h** | 6h |
| `sispag-reaper` | `10,25,40,55 * * * *` | 8,4h medido (cron pede 15min) | **12h** | ~3,6h sobre o pior gap |
| `sispag-perfil-canal` (ADR-0063) | `17 6 * * 0` | 7 dias (semanal) | **9 dias** | 1 execução atrasada; leitura falha ou zero perfis já fecha `error` |

## O reaper ganhou trilha (2026-09-01)

Ele nasceu sem escrever linha de run, e por isso era o único job que o painel não conseguia vigiar
— justamente aquele cuja cegueira o comentário do próprio workflow já registrava (*"uma queda na
sexta à noite ficaria invisível até segunda"*). A ironia era completa: o job que existe para tornar
visível o que ninguém vê era o invisível.

Agora escreve em `job_execucao` como qualquer outro (ADR-0042, follow-up 2). O limite nasceu
em 1h (três execuções de 15min perdidas), mas a cadência do cron não é a cadência real.

**Revisto em 2026-09-29: 1h → 12h.** O GitHub dispara este schedule só 5–7× por dia. Medido de 15
a 29/09/2026 (90 runs): gap mediano de 4h, máximo de 8,4h. Com 1h o painel mostrava o reaper
"Parado" quase o dia todo e o detector emitia `job-parado` a cada hora, ruído que treina o time a
ignorar o canal. 12h cobre o pior gap observado com folga e ainda denuncia um reaper morto em meio
dia. Se o reaper sair do GitHub Actions para um scheduler que respeite 15min, o limite volta a ser
derivado do cron.

**Nenhum pipeline resta como `sem-trilha`.** A lista `PIPELINES_SEM_TRILHA` continua existindo, e
vazia, porque o problema volta: todo job novo que nascer sem trilha entra ali para ser LISTADO como
cego em vez de sumir da tela.

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
