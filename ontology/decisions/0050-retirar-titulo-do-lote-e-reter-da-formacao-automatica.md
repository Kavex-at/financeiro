---
adr_number: 0050
title: "SISPAG: retirar um título do lote pela aba de títulos e retê-lo da formação automática até alguém lotá-lo à mão ou liberar a retenção"
date: 2026-09-22
status: accepted
type: addition
related_entities: [TituloAPagar, LotePagamento]
related_actions: [reterTituloDaFormacao, gerenciarLoteCandidato, formarLotesAutomaticos, montarPainelPagamentos]
related_business_rules: [retencao-formacao-automatica, elegibilidade-titulo-lote, nao-duplicacao-titulo-lote]
related_state_machines: [lote-pagamento]
evidence:
  - "Pedido da analista via usuário (2026-09-22): tirar um título do lote automático exige abrir o lote e achar o título"
  - "src/backend/domain/repository/sispag/TituloAPagarRepository.ts:195-208 (listElegiveisParaFormacao): título retirado e deixado solto volta a ser lotado na rodada seguinte"
  - "src/backend/domain/repository/sispag/TituloAPagarRepository.ts:98-109 (upsertMany): UPSERT por allowlist de colunas"
supersedes_decisions: []
amends_decisions: [0018]
---

# ADR 0050: retirar o título do lote e retê-lo da formação automática

> **Status `accepted`** em 2026-09-22 (aprovada pelo usuário). A ADR-0049 está reservada pela branch
> `fix/sispag-data-pagamento` (data de débito da remessa), por isso este número é 0050.

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Frente:** II (SISPAG)
**Branch:** `fix/sispag-reter-titulo-lote` · **Feature:** `/feature-tweak` `sispag-reter-titulo-lote`
**Decisões de negócio (usuário, 2026-09-22):** ação "Retirar do lote" na linha do título, só quando ele
está num lote RASCUNHO, com o lote identificado e linkado; retirar grava uma marca "não lotar
automaticamente"; inclusão manual continua permitida; PR separado da data de débito. Na aprovação
(mesma data): a lixeira dentro de um lote **automático** também retém (P1-1). O que ficou fora de
escopo está registrado em `_inbox/sispag-retirar-titulo-lote-gap.md` (P1-2).
**Relacionado:** ADR-0006 (autor vem do JWT), ADR-0015 (I2/I3/I4), ADR-0018 (formação automática),
ADR-0047 (configuração do analista com soft-delete, `ExcecaoPermuta`).

## Contexto

A analista trabalha quase sempre com os lotes automáticos (ADR-0018). Às vezes um título não deve sair
no pagamento do dia: está em negociação, o fornecedor pediu para segurar, falta documento. Hoje ela
precisa abrir o lote, achar o título e removê-lo lá (`removerTituloDoLote`, que já existe: só em
RASCUNHO, e converte o lote automático em manual com `marcarManual`).

Remover não basta. `formarLotesAutomaticos` roda depois de toda ingestão e elege todo título ativo,
aprovado, não pago, a vencer em até 7 dias e **fora de qualquer lote RASCUNHO**. O título retirado e
deixado solto satisfaz tudo isso, e a rodada seguinte o põe num lote novo. A decisão da analista dura
até o próximo cron. Falta um lugar onde ela fique registrada.

## Decisões

### D1: a retenção é estado do título, persistido fora de `titulo_a_pagar`

No modelo, é uma propriedade de `TituloAPagar` (`retencaoFormacao`: ativa ou não, quem, quando, por
quê). Na persistência, fica numa **tabela própria** com chave natural `(fil_cod, doc_cod, tit_cod)`.

Uma coluna em `titulo_a_pagar` **sobreviveria** à ingestão de hoje: o `upsertMany` só sobrescreve as
colunas que lista, e o anti-fantasma só marca `ativo=false`, não apaga a linha. Mesmo assim fica a
tabela própria, por três razões:

1. **`titulo_a_pagar` é espelho do ERP.** Tudo nela sai de novo na próxima ingestão, e a carteira já
   foi purgada uma vez (migration 0030). Estado que só o analista produz não pode depender de a
   allowlist do UPSERT continuar omitindo a coluna. Um refactor para `SET` de todas as colunas, ou um
   rebuild da carteira, apagaria as decisões sem nenhum teste falhar. A ADR-0047 rejeitou pelo mesmo
   motivo o "UPDATE manual no banco".
2. **Trilha.** Reter, liberar e reter de novo são eventos distintos, cada um com autor. Uma coluna
   guarda só o estado corrente; linhas com soft-delete guardam o histórico.
3. **Precedente.** `ClienteFiltro` (ADR-0007) e `ExcecaoPermuta` (ADR-0047) já são configuração do
   analista em tabela própria, com soft-delete e no máximo uma linha ativa por chave.

Sem FK para `titulo_a_pagar`, para que um rebuild da carteira não leve as decisões junto. Custo: um
`NOT EXISTS` a mais em `listElegiveisParaFormacao` e um `LEFT JOIN` na listagem do painel.

*(Alternativa: entidade nova `RetencaoTitulo`. Rejeitada: não tem ciclo de vida nem relações além do
título. É um fato sobre o título, e a ontologia prefere propriedade a entidade. A tabela própria é
decisão de persistência, não de modelo.)*

### D2: novo invariante I8, a formação automática não lota título retido

`formarLotesAutomaticos` exclui do pool todo título com retenção ativa. A inclusão manual
(`incluirTituloNoLote`) **não** é barrada. I8 vale só para o caminho automático; I2, I3 e I4 não
mudam. Ver `business-rules/retencao-formacao-automatica.md`.

### D3: "Retirar do lote" remove o item e retém o título na mesma transação

Na aba "Títulos a pagar", a linha do título que está num lote RASCUNHO mostra o lote (id, link) e a
ação "Retirar do lote". A ação é `removerTituloDoLote` (L2, sem mudança: só RASCUNHO, `marcarManual`
no lote automático, optimistic lock) **mais** a gravação da retenção, numa transação só. Se uma parte
falha, nenhuma acontece: título fora do lote sem retenção voltaria no próximo cron.

**A lixeira dentro do lote também retém quando o lote é automático** (P1-1, respondida em 2026-09-22).
Quem remove um título de um lote que o cron montou está dizendo a mesma coisa: "esse não". O serviço lê
`automatico` **antes** de `marcarManual` virar o lote para manual, na mesma transação que remove o item
e grava a retenção; ler depois daria sempre `false`. Num lote **manual**, a remoção continua como hoje,
sem retenção: a analista está rearranjando o próprio lote e pode querer mover o título para outro.

### D4: incluir o título num lote à mão libera a retenção

`incluirTituloNoLote` libera, na mesma transação, a retenção ativa do título, gravando
`removidoPor` = quem incluiu e `motivoRemocao = 'incluido-no-lote'`.

Por quê: o usuário definiu a retenção como válida "até ele ser lotado à mão". Mantê-la ativa com o
título dentro de um lote deixaria o badge "Não lotar automaticamente" num título lotado. Enquanto o
título está no lote, o anti-join (I3) já o protege da formação.

Consequência aceita: se esse lote for cancelado depois, ou o título for removido de um lote manual, ele
volta ao pool automático, como qualquer título hoje. Para segurá-lo de novo, "Retirar do lote".

*(Alternativa: manter a retenção até ação explícita. Rejeitada pelo badge contraditório e por exigir um
segundo clique que vai ser esquecido.)*

### D5: liberar a retenção é ação explícita na linha

A linha do título retido mostra o badge "Não lotar automaticamente" (autor, data e motivo no detalhe)
e a ação "Liberar para lote automático". Soft-delete com `removidoPor`/`removidoEm` e
`motivoRemocao = 'liberado'`. O título volta ao pool na rodada seguinte, se ainda for elegível.

### D6: escopo, auditoria e identidade

- `motivo` opcional, texto livre de até 500 caracteres. Sem enum de motivos (watchlist).
- Autor sempre do JWT (ADR-0006), nunca do corpo da requisição. Mutações com `requireRole('admin')`,
  como as demais do lote.
- No máximo uma retenção ativa por título (índice único parcial).
- A retenção não expira. Título que fica pago, inativo ou vencido mantém a marca, inerte, porque a
  formação já não o elegeria. Ver P2-1 no gap.
- Nenhuma escrita no ERP (I1).

## Consequências

- A decisão da analista de segurar um título sobrevive ao cron e à ingestão.
- A aba de títulos passa a saber **em qual** lote RASCUNHO o título está (hoje recebe só `emLote`). É
  projeção da relação `ItemLote` que já existe, não conceito novo.
- A ADR-0018 D2 ganha um filtro: elegível à formação **e** sem retenção ativa.
- Retirar de um lote automático continua convertendo o lote em manual (`marcarManual`). Esse lote deixa
  de ser desfeito pelo passo de vencidos, como já acontece hoje com a remoção pela tela do lote.

## Universalidade

Segurar uma obrigação fora da **proposta automática** de pagamento sem proibir o pagamento manual é
conceito padrão de contas a pagar: no SAP é o *payment block* do item em aberto, no Oracle o *hold*.
Quem automatiza a montagem do lote precisa de uma válvula para a exceção. A **estrutura** (retenção com
autor, data e motivo, respeitada só pelo caminho automático) é do domínio; os **valores** (quais
títulos, por quê) são dados do tenant. A evidência de cliente é uma só (Columbia), então a confirmação
do Francinei fica como P2 no gap, sem bloquear.
