---
adr_number: 0064
title: "SISPAG: lotes automáticos por filial × vencimento (boletos juntos) e mover títulos para um lote manual"
date: 2026-10-06
status: accepted
type: amendment
related_entities: [LotePagamento, ItemLote, TituloAPagar]
related_actions: [formarLotesAutomaticos, gerenciarLoteCandidato, montarPainelPagamentos]
related_business_rules: [nao-duplicacao-titulo-lote, lote-uma-filial]
related_state_machines: [lote-pagamento]
evidence:
  - "Decisões do usuário (2026-10-06), lote paralelo A/B/C de melhorias SISPAG, Grupo A"
supersedes_decisions: []
amends_decisions: ["0018", "0050"]
---

# ADR 0064: lotes automáticos por vencimento e mover títulos para um lote manual

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Frente:** II (SISPAG)
**Branch:** `feat/sispag-lotes-vencimento-mover` · **Feature:** `/feature-tweak LotePagamento`
(escopo decidido pelo usuário, entrevista dispensada) · `entity_changed = false`.

> **Numeração.** Este ADR e a versão do app podem ser re-sequenciados no merge: os grupos A/B/C do
> mesmo lote de melhorias rodam em paralelo.

## Contexto

1. A formação automática (ADR-0018, emendada pela ADR-0021) agrupava só por filial: uma filial com
   títulos vencendo em dias diferentes recebia um lote misturando datas, e o fatiamento em 25 cortava
   o grupo na ordem da consulta, misturando boletos e TED/PIX nos lotes resultantes.
2. Para levar a um lote manual um título que o cron já tinha lotado, a analista tinha de "Retirar do
   lote" um a um (ADR-0050) e só então selecioná-lo. Com vários títulos, o caminho é lento.
3. A regra I3 (`nao-duplicacao-titulo-lote`) já dizia que o invariante de domínio é "não em dois lotes
   vivos", com FINALIZADO "reservado". O código só checava RASCUNHO: um título num lote finalizado ou
   com remessa gerada aparecia livre no painel e podia entrar noutro lote.

## Decisões

### D1: formação automática agrupa por filial × dia de vencimento

Um lote por filial por data de vencimento. O dia é o civil UTC do epoch do ERP
(`BankingCalendar.fromErpEpoch`), a mesma regra da janela de débito. I4 continua garantida porque a
filial está na chave. O teto de 25 títulos por lote não muda.

### D2: no fatiamento, boletos juntos

Grupo com até 25 títulos fica num lote só, misto ou não. Acima disso, o número de lotes é sempre o
mínimo, ⌈n/25⌉. Se esse mínimo comporta separar boletos (`temBoleto`) e não-boletos
(⌈b/25⌉ + ⌈m/25⌉ = ⌈n/25⌉), eles saem em lotes distintos, sem nenhum misto. Senão, os boletos vêm
primeiro e contíguos, e no máximo um lote sai misto.

*Interpretação registrada:* "sempre que a contagem permitir" foi lida como "sem criar lote extra".
Separar sempre (zero mistos, às vezes um lote a mais) é a alternativa se a operação preferir.

### D3: incluir com `mover` — o título sai do lote RASCUNHO de origem na mesma transação

`POST /sispag/lotes/:id/itens` aceita `mover: true`. Se o título está noutro lote RASCUNHO, na mesma
transação e sob o mesmo advisory lock do título:

- o item sai da origem, e só se ela ainda é RASCUNHO (senão `LoteEstadoInvalidoError`, nada muda);
- as alertas vivas do item na origem são descartadas (como na lixeira, ADR-0063);
- a origem vira manual (`marcarManual`, a mesma semântica de quando a analista edita um lote
  automático) e tem a versão bumpada (quem estiver com ela aberta recebe conflito);
- o item entra no destino;
- a origem que ficou sem itens é **cancelada** (`CANCELADO`, L5, executada pelo sistema dentro da
  ação da analista).

Todas as validações do incluir seguem: destino RASCUNHO, mesma filial (I4), bloqueio de duplicidade
(I13g), re-leitura autoritativa no Conexos (I2). Sem `mover`, título noutro RASCUNHO continua barrado
por I3 (`TituloEmOutroLoteError`).

O movimento é atômico por título. A criação do lote manual com N títulos são N movimentos: se algum
falhar, os demais seguem e a tela lista as falhas (mesmo comportamento do "Criar lote" de antes).

### D4: título em lote comprometido não entra nem se move

`FINALIZADO` e `REMESSA_GERADA` comprometem o título. Incluir (com ou sem `mover`) recusa com
`TitleInCommittedBatchError` (409, `TITULO_EM_LOTE_COMPROMETIDO`). O painel projeta
`loteComprometido { id, status }` e a aba de títulos desabilita a seleção, explicando: lote
finalizado pede reabrir aquele lote; com remessa gerada, o pagamento já foi para o banco.

`RETORNADO` ficou de fora de propósito: o lote retornado tem itens rejeitados que precisam voltar a
ser pagos, e bloqueá-los aqui exigiria antes decidir como um item rejeitado sai do lote retornado.
Pergunta aberta (ver "Em aberto").

### D5: a UX principal é seleção + confirmação; "Retirar do lote" fica

Na aba de títulos a analista pode selecionar títulos soltos e títulos em lotes RASCUNHO. "Criar lote"
com algum título em lote abre uma confirmação que lista, por lote de origem, os títulos que saem, e
avisa quando a origem vira manual ou fica vazia e é cancelada. Só os títulos que estavam na lista
confirmada vão com `mover: true`; título que entrou num lote depois da confirmação é recusado pelo
servidor. O "Retirar do lote" por título (ADR-0050) continua, porque não custa nada mantê-lo.

## Alternativas rejeitadas

- **Endpoint em lote "criar lote manual com N títulos" numa transação só.** Seguraria a transação
  durante N re-leituras no Conexos (I2 precisa delas fora do lock, por causa do pool de 5 conexões)
  ou faria as leituras antes e gravaria depois, abrindo janela entre leitura e escrita. O mover por
  título mantém o desenho que já existe.
- **Retirar e incluir como duas chamadas da tela.** Um erro entre as duas deixaria o título solto,
  fora dos dois lotes, sem a analista saber.
- **Bloquear também `RETORNADO`.** Ver D4.

## Consequências

- Mais lotes automáticos por filial (um por dia de vencimento), menores e de data única.
- I3 passa a cobrir lotes comprometidos no código, como a regra já descrevia.
- Nenhuma tabela, coluna ou migration nova. Nenhuma escrita no ERP (I1).

## Em aberto

- Item rejeitado de um lote `RETORNADO`: como volta a um lote novo (hoje não é bloqueado nem movido).
