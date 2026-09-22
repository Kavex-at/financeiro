---
adr_number: 0048
title: A tela Métricas recua para 2026-08-07 e o report semanal continua ancorado no ciclo 6 — dois pisos, um contrato
date: 2026-09-16
status: accepted
type: amend
related_entities: []
related_actions: []
related_integrations: [kavex-report-ciclo]
evidence:
  - src/backend/migrations/0060_metricas_historico_inicio.sql
  - src/backend/migrations/vwMetricasCiclo.test.ts
  - src/backend/routes/metricas.test.ts
  - ontology/_inbox/metricas-historico-6-semanas-tasks.md
supersedes_decisions: []
amends_decisions: [0045]
---

# ADR 0048: a tela mostra seis semanas; o report continua medindo a partir do ciclo 6

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `fix/metricas-historico-6-semanas`.
**Emenda a ADR-0045, D4** ("sem backfill"). `entity_changed = false`: read-model, sem entidade, ação
ou estado novo. Nenhuma chave de `metrica` nasce, muda de nome ou muda de definição.

> Número de ADR reservado por esta branch, como a 0045 fez. Houve colisão de numeração com `main`
> antes (`c2e9eae`) — e houve de novo: esta ADR nasceu 0047 e a migration nasceu 0059, e as duas
> foram renumeradas (0048 / 0060) no rebase de 2026-09-22 porque a exceção manual de Permutas chegou ao
> `main` primeiro com os mesmos números.

## Contexto

A ADR-0045 entregou `/metricas` e o `GET /metricas/ciclo`, e fixou o início da série em
`2026-09-11 18:00` (ciclo 6). Aberta em produção em **2026-09-16**, a tela mostra `—` em tudo. Isso
não é defeito, é a D4 funcionando: existe **uma** janela, `11/09 18:00 → 18/09 18:00`, ainda aberta
(`parcial = true`); as linhas de `%` só saem `WHERE tentativas > 0`; sem execução de permuta ou SN
desde sexta, restam as duas linhas de `R$` valendo zero. O `page.tsx` cai na semana parcial e os
KPIs saem vazios.

A D4 recusou o backfill por três razões que **continuam válidas e não são revogadas aqui**: o ledger
de permutas apaga linha quando o borderô é excluído; as definições da 0058 (em especial "concluída =
borderô FINALIZADO", D3) não existiam antes de 2026-09-14; e número reconstruído parece medido e não
é.

O que a D4 não previu foi o custo do lado oposto: a primeira semana no ar é também a primeira semana
em que alguém abre a tela, e uma tela de métricas que nasce vazia não é lida como "a série começou
agora" — é lida como defeito. O ledger tem dado desde 2026-06-22, e a própria validação da ADR-0045
percorreu 12 semanas com 48 comparações e 0 divergência, o que significa que a função já foi provada
sobre exatamente o histórico que a D4 optou por não emitir.

## Decisões

### D1 — Dois pisos, não um piso movido

`metricas.serie_inicio()` **não muda**. Continua `2026-09-11 18:00`, continua sendo o que
`vw_metricas_ciclo` usa, e continua sendo o que o `kavex-report-ciclo` lê. A migration 0060 é
**aditiva**: acrescenta `metricas.historico_inicio()` = `2026-08-07 18:00` e não redefine nada da
0058.

**Descartado:** mover `serie_inicio()` para trás. Era a mudança de uma linha que a própria D4
antecipava ("a mudança é uma linha numa migration nova"), e é a errada aqui. A Seção 3 do report
passaria a exibir semanas de agosto que nenhum ciclo reportou, e o "série iniciada em" mudaria de
sentido retroativamente. Decisão do Yuri (2026-09-16): **só a tela recua**.

### D2 — `2026-08-07 18:00`, porque é sexta

As duas datas são sexta-feira e distam **exatamente 35 dias**. O
`generate_series(p_serie_inicio, p_agora, INTERVAL '7 days')` da 0058 passa a emitir
`08-07, 08-14, 08-21, 08-28, 09-04, 09-11`: **a mesma grade**, cinco janelas a mais. Nenhuma janela
fechada muda de fronteira, logo nenhuma linha que o report já leu muda de valor. Um piso que não
caísse numa sexta teria rebatido a grade inteira e reescrito todo número já reportado — é o tipo de
mudança que a 0058 chama de "quebra anotada no report", e não é o que se está fazendo.

Seis janelas ao todo (cinco fechadas + a em curso) é o que o Yuri pediu por "últimas semanas".

### D3 — Recuo é opt-in na rota, não default

`GET /metricas/ciclo` sem parâmetro responde **exatamente** o que responde hoje. O recuo exige
`?historico=true`, e é a tela quem o passa.

Isto não é cerimônia. O `metrics.py` declara `--inicio`/`--fim` como `required=True` e sempre filtra
a própria janela, então na prática ele não veria as semanas novas de qualquer jeito. Mas "na prática
não veria" é uma propriedade do script do outro lado, que pode mudar sem nos avisar; opt-in é uma
propriedade **desta** rota. A garantia da D1 passa a não depender de como o consumidor chama.

**Consequência dirigida:** com `historico=true`, o `serieInicio` da resposta é o piso **em vigor**
(`2026-08-07T18:00:00`), não `serie_inicio()`. O rodapé "Série iniciada em 07/08/2026" e a tabela
passam a contar a mesma história. Devolver `2026-09-11` ao lado de semanas de agosto seria marcar as
recuperadas sem dizer que as está marcando — o contrário da D4 abaixo.

### D4 — Semana recuperada não é marcada

Decisão do Yuri (2026-09-16): as semanas de agosto aparecem como qualquer outra. Nenhuma coluna
`reconstruido`, nenhum chip, nenhuma nota de rodapé.

Isto **contraria a inclinação da ADR-0045** ("número reconstruído parece medido e não é") e é
deliberado. A diferença material entre as semanas antigas e as novas, aqui, é menor do que a 0045
supunha: não há recálculo nem heurística — as linhas saem da **mesma função**, sobre o **mesmo
ledger**, com as **mesmas definições** da 0058. O que muda é só até onde o `generate_series` começa.
O risco remanescente é de **subnotificação** (ver Consequências), não de número inventado.

`parcial` continua marcado. Não é a mesma coisa e a D4 não o afrouxa: `parcial` diz que o número
**ainda vai mudar** até sexta 18:00, e a regra da 0045 — "número parcial nunca aparece sem o horário
de corte" — segue inteira.

## Consequências

- **+** A tela deixa de nascer vazia. Na leitura de 2026-09-16 passa a mostrar cinco semanas
  fechadas, e os KPIs passam a exibir a última **fechada** (`04/09 → 11/09`) em vez da parcial.
- **+** O report não muda: nem código, nem resposta, nem `serieInicio`. `vw_metricas_ciclo` intocada.
- **+** Migration aditiva: nada da 0058 é redefinido, nada precisa ser revertido para voltar atrás —
  basta a tela parar de passar `historico=true`.
- **−** **`2026-08-07` é fixo e envelhece.** Em dezembro a tela mostrará ~18 semanas, não 6. A janela
  deslizante foi oferecida e recusada (o Yuri escolheu a data fixa). Quando a tabela ficar longa, o
  conserto é paginar ou deslizar — decisão de então, não desta ADR.
- **−** **As semanas de agosto podem subnotificar Permutas.** `permuta_alocacao_execucao` apaga linha
  quando o borderô é excluído (ADR-0045, D4), então uma baixa cujo borderô sumiu não está mais lá
  para ser contada. Quanto mais antiga a semana, mais exposta. O conserto de fundo continua sendo a
  tabela de eventos append-only já registrada como follow-up na 0045; esta ADR não o antecipa, e a
  D4 acima decide conscientemente não avisar o leitor na tela.
- **−** Dois pisos coexistem e podem divergir sem que nada quebre. Mitigado por ambos viverem na
  mesma migration-família (`metricas.*_inicio()`), por guardas estáticas em `vwMetricasCiclo.test.ts`
  e por teste de rota nos dois caminhos.
