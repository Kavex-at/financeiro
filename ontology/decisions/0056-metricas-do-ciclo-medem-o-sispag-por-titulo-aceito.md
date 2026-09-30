---
adr_number: 0056
title: As métricas do ciclo passam a medir o SISPAG — título de remessa gerada aceito pelo banco, na semana da geração
date: 2026-09-30
status: accepted
type: amend
related_entities: [LotePagamento, ItemLote]
related_actions: []
related_integrations: [kavex-report-ciclo]
evidence:
  - src/backend/migrations/0070_metricas_ciclo_sispag.sql
  - src/backend/migrations/vwMetricasCiclo.integration.test.ts
  - src/backend/migrations/vwMetricasCiclo.test.ts
  - src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
  - src/frontend/app/metricas/page.tsx
  - ontology/_inbox/metricas-sispag-mapa.md
supersedes_decisions: []
amends_decisions: [0045, 0052]
---

# ADR 0056: o SISPAG entra nas métricas do ciclo

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `fix/metricas-sispag`.
**Emenda a ADR-0045** (frentes medidas) **e estende a ADR-0052** (data pelo encerramento) ao ledger
da remessa. `entity_changed = false`: read-model + carimbo de auditoria em `remessa_execucao`;
nenhuma entidade, ação ou estado novo. Duas chaves de `metrica` novas.

## Contexto

O report do ciclo 7 (25/09) disse: *"O SISPAG ainda não é medido."* A Frente II levou a maior parte
da capacidade do ciclo e era a única sem número. Em 28/09 a Columbia confirmou duas remessas geradas
por nós e aceitas pelo banco (lotes `635d9c77`, fil 2/flp 24, R$ 275,00, e `3ea0f6ef`, fil 1/flp 8,
R$ 1.856,16), e nada disso aparecia na tela.

Até a ADR-0055 (PR #97) o nosso banco não sabia o que o banco respondeu: o `.RET` é processado
nativamente do lado da Columbia. Agora a sincronização de lotes grava
`lote_pagamento_item.situacao` ∈ `AGENDADO | PAGO | REJEITADO | SEM_RETORNO` (invariante I11), e a
medição pode ler a resposta do banco sem integração nova.

## Decisões (Yuri, entrevista de 29/09 e 30/09)

- **D1 — Evento: remessa gerada E aceita pelo banco.** O que o nosso ledger sozinho sabe (remessa
  gerada) não basta.
- **D2 — Unidade: o título.** O CNAB aceita e rejeita título a título, não arquivo. Rótulo:
  *"X de Y títulos, Z aguardando retorno"*.
- **D3 — Aceito = `situacao` ∈ {AGENDADO, PAGO}.** PAGO implica aceito. O `.RET` real de 24/09 trouxe
  só BD "PAGAMENTO AGENDADO"; a baixa veio depois, manual (borderô 22320). Aceite e pagamento são
  momentos e fontes diferentes, e a métrica mede o primeiro. `NULL` (ainda não sincronizado) e
  `SEM_RETORNO` contam como **aguardando**, nunca como rejeitado.
- **D4 — R$ = `lote_pagamento_item.valor`** (snapshot da inclusão). `valor_pago` só existe depois da
  baixa e zeraria os AGENDADO.
- **D5 — Semana da GERAÇÃO da remessa**, pela 1ª execução `settled` do lote, datada por
  `COALESCE(encerrado_em, criado_em)` — a regra da ADR-0052. Um aceite que chega depois recalcula
  aquela semana: a série é recalculada, não remendada.
- **D6 — Lote `CANCELADO` fica fora** (sai a `PG160901.REM` de 16/09). Execução `error` e dry-run
  também: o denominador são títulos que de fato foram ao banco.

- **D7 — Audiência: quem tem `metricas:ver` vê o SISPAG, mesmo sem `sispag:ver`.** Aceito pelo Yuri em
  30/09 (Regis-Review, card security-1). A rota `/metricas/ciclo` exige só `metricas:ver` (ADR-0053) e
  as duas chaves `sispag_*` saem na mesma resposta, sem filtro por módulo. O que se expõe é agregado
  semanal (% e R$ dos títulos aceitos); nenhum título, credor, CNPJ ou conta sai por esta rota. É o
  mesmo tratamento que Permutas e Recebimentos já tinham. Se um dia a tela passar a mostrar dado por
  título, a decisão volta a ser revista.

## Consequências

- `remessa_execucao.encerrado_em` (migration 0070), carimbado por `settle` (1º encerramento, imóvel)
  e `fail` (a falha). Backfill `= atualizado_em` nas terminais: exato para as 6 `settled` de produção
  (todas encerraram segundos após nascer, nenhuma re-clicada).
- Chaves novas `sispag_titulos_aceitos_pct` (só em semana com título enviado — nunca 0/0) e
  `sispag_valor_aceito` (toda semana; R$ 0 sem aceite). Frente `'SISPAG (Frente II)'`.
- **Nenhum número de Permutas ou Recebimentos muda**: a função da 0065 é mantida linha a linha
  (guarda estática por subsequência) e um teste de integração compara as duas frentes com e sem SISPAG.
- A tela `/metricas` ganha dois KPIs e duas colunas. O `kavex-report-ciclo` lê a rota, então a frente
  entra sozinha; a frase "SISPAG ainda não é medido" sai do texto do report.
- **Leitura em produção em 30/09, antes da 1ª sincronização:** semana 18–25/09 com 2 títulos enviados
  (R$ 2.131,16) e 25/09–02/10 com 11 (R$ 8.832,91), **0 aceitos em ambas** porque `situacao` ainda é
  NULL em todos. O número só fica verdadeiro depois que o cron `sincronizar-lotes-sispag` rodar.

## Alternativas rejeitadas

- **Medir por arquivo de remessa:** um arquivo com 1 título rejeitado em 10 não tem resposta limpa.
- **Semana do retorno:** exige uma data de aceite confiável, que só existe para PAGO (`pago_em`).
- **Job próprio `sync-retorno-sispag`** (plano original do mapa): redundante depois da ADR-0055.
