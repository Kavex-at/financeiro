---
adr_number: 0051
title: As métricas do ciclo datam cada execução pelo encerramento, não pela criação — e a série é recalculada, não remendada
date: 2026-09-28
status: accepted
type: amend
related_entities: [Permuta, SolicitacaoNumerario]
related_actions: []
related_integrations: [kavex-report-ciclo]
evidence:
  - src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql
  - src/backend/migrations/vwMetricasCiclo.integration.test.ts
  - src/backend/migrations/vwMetricasCiclo.test.ts
  - src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts
  - src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts
  - ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md
supersedes_decisions: []
amends_decisions: [0045]
---

# ADR 0051: uma baixa conta na semana em que aconteceu

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `worktree-metrica-ciclo-data-conclusao`
(`/feature-tweak`). **Emenda a ADR-0045** (a regra "tentativa atribuída à semana do `criado_em`").
`entity_changed = false`: read-model + carimbo de auditoria nos ledgers; nenhuma entidade, ação,
estado ou chave de `metrica` nova.

## Contexto

Quando uma permuta falha e é reexecutada, o sistema **atualiza a mesma linha** do ledger (upsert por
`idempotency_key`) em vez de criar outra. A medição (0058) conta a linha na semana do `criado_em` —
a da **primeira tentativa**, não a da liquidação.

A baixa de **R$ 150.061,81** liquidada em **14/09** (id 341, adto 4471 × invoice 4755, borderô 2466)
teve a primeira tentativa em **10/08**, então contou em agosto. Por isso a semana **11–18/09** — o
primeiro número de operação publicado à Columbia — saiu **R$ 0,00**. Medido em 18/09: **2 linhas em
190**, **R$ 503.066,69** na série inteira (a outra: id 270, R$ 353.004,88, criada 03/07, liquidada
14/08). Declarado ao cliente na Seção 3 do report do ciclo 6.

## Decisões

### D1 — Cada execução é datada por quando terminou

A janela de cada linha passa a ser escolhida por `COALESCE(encerrado_em, criado_em)`, nas duas
frentes. Linha em voo (sem encerramento) continua na semana em que nasceu. Vale para o numerador e
para o denominador: uma tentativa que falhou e depois liquidou é **uma** tentativa, na semana da
liquidação.

### D2 — Coluna nova `encerrado_em`, e não `atualizado_em`

`atualizado_em` anda **depois** do encerramento: o `beginExecution` de um re-clique sobre linha
`settled` preserva o status mas carimba `atualizado_em`; o `clearBorCod` idem; na SN,
`setEtapa`/`setNdeAutorizado`/`setRevisaoHumana` rodam depois do settle (a autorização SEFAZ é
assíncrona). Datar por ela trocaria um erro por outro: uma baixa de agosto migraria para a semana de
um clique qualquer.

`encerrado_em` é carimbado só pelo repositório, nos três terminais:

| Escrita | Carimbo |
|---|---|
| `markSettled` / `markParcial` | `now()` no **primeiro** encerramento; se a linha já era terminal, mantém (`COALESCE`) |
| `markError` | `now()` — o instante da falha; um retry que liquide sobrescreve no `markSettled` |
| qualquer outra | não toca |

### D3 — Backfill por `atualizado_em`, declarado como aproximação

Linhas terminais já gravadas recebem `encerrado_em = atualizado_em`. É a única fonte disponível e é
exatamente a que produziu a medição de 18/09. Limite conhecido: numa linha `settled` re-clicada
depois de liquidar, `atualizado_em` é o clique. O backfill não toca `criado_em` nem `atualizado_em`,
então é reversível sem perda.

### D4 — Recalcular a série, não remendar

A função lê o estado atual: toda janela passa a refletir a regra nova de uma vez, **na mesma grade de
sextas 18:00** — os pisos (`serie_inicio`, `historico_inicio`) e o `generate_series` não mudam, e um
guard estático prova isso. Nenhuma linha de correção avulsa, nenhuma janela especial.

Consequência aceita (e é o objetivo):

- **Report:** muda um número já publicado à Columbia — **11–18/09: R$ 0,00 → R$ 150.061,81**. A linha
  de `%` dessa semana também muda (passa a contar a baixa como tentativa concluída); o valor exato
  sai da consulta de validação.
- **Tela Métricas (seis semanas):** mudam também as semanas de agosto que continham essas baixas.
- O antes/depois é mostrado **no report do ciclo em que este delta entra** — a consulta read-only está
  em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`.

**Descartado:** chave de `metrica` nova (ex.: `permutas_valor_baixado_v2`). A definição de negócio
("baixado na semana") não mudou; o que estava errado era a data que a respondia. Chave nova
obrigaria o report a costurar duas séries para dizer a mesma coisa.

**Descartado:** criar linha nova por tentativa (append-only). É o conserto de fundo já aberto desde a
0045 (tabela de eventos), mas mexe na idempotência da baixa — fora do escopo de uma correção de
medição.

## Consequências

- Contrato da função e da view (9 colunas + `parcial`/`apurado_ate`) idêntico.
- Continua valendo a ressalva da 0045: o ledger de permutas apaga linha quando o borderô é excluído.
- O report congela o número no ciclo em que o leu; a partir deste delta, o número de 11–18/09 lido
  pela API difere do publicado no ciclo 6 — é a quebra anotada que a 0058 prevê.
