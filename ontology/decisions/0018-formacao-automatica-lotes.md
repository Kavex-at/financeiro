---
adr_number: 0018
title: SISPAG — Formação AUTOMÁTICA de lotes candidatos (cron pós-ingestão + manual); a-vencer ≤7d por filial×classe×banco; auto-lote vencido → desfazer/liberar; nasce RASCUNHO para revisão
date: 2026-07-08
status: accepted
type: change
related_entities: [LotePagamento, ItemLote, TituloAPagar]
related_actions: [formarLotesAutomaticos, gerenciarLoteCandidato, ingerirPagamentos]
supersedes_decisions: []
---

> ℹ️ **Amendado por [ADR-0021](./0021-internacional-fora-do-escopo.md) (2026-07-18):** a **classe**
> nacional × internacional **saiu** do agrupamento. Internacional é câmbio manual da tesouraria (fora do
> escopo do SISPAG) e é **filtrado na ingestão** — não há títulos internacionais na carteira. Onde este
> ADR diz **filial × classe × banco (I4/I7)**, leia **filial (I4)** (banco degenera por `banco`-null;
> classe deixou de existir). O invariante **I7** foi aposentado e a coluna `internacional` removida
> (migration 0030). O restante do ADR-0018 (cron pós-ingestão + manual, a-vencer ≤7d, desfazer-vencidos,
> anti-join, nasce RASCUNHO para revisão, cron nunca toca manual/finalizado) segue **vigente**.

# ADR 0018: Formação automática de lotes candidatos SISPAG

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:** `feat/sispag-ingestao-pagamentos`
**Relacionado:** ADR-0015 (Fatia 1+2 — painel + montagem de lote + gate; invariantes I2/I3/I4),
ADR-0016 (ingestão de pagamentos — carteira `TituloAPagar` persistida, cron + manual, advisory-lock),
ADR-0017 (lote uniforme nacional × internacional — I7, `internacional` persistido). **`entity_changed
= true`** (nova propriedade `automatico` em `LotePagamento`; nova ação `formarLotesAutomaticos`; novo
comportamento de ciclo de vida — auto-lote RASCUNHO vencido é DESFEITO). **Fontes:** implementação da
formação automática (Fatia 2.5) sobre a carteira já ingerida.

## Contexto

Com a carteira persistida (ADR-0016) e a montagem manual do lote candidato (ADR-0015, `gerenciarLote
Candidato`) mais a uniformidade nacional/internacional (ADR-0017, I7), a analista já consegue montar
lotes à mão. O gargalo residual é **trabalho manual repetitivo**: todo dia ela abre um lote por filial
e por classe e inclui os títulos que vencem em breve — uma tarefa mecânica e determinística que o
sistema pode **pré-fazer**. Falta um passo de **formação automática** que proponha os lotes candidatos,
deixando a analista no papel de **revisar e aprovar** (human-in-the-loop) em vez de digitar.

O padrão de cadência já está validado na ingestão (cron + manual, advisory-lock, operação convergente).
Esta fatia **aplica o mesmo padrão à formação de lotes** — encadeada logo após a ingestão.

## Decisões

### D1 — Formação automática por cron encadeado à ingestão (+ trigger manual)
Um cron `job:formar-lotes` roda **logo após** o cron de ingestão (a carteira já está fresca no banco) e
monta os lotes candidatos automaticamente; um `POST /sispag/lotes/formar` (botão FE "Formar lotes
automáticos", `requireRole('admin')`) dispara o **mesmo** compute (`FormacaoLotesService.formar`)
manualmente. Espelha `ingerirPagamentos` (ADR-0016): cron + manual sobre o mesmo serviço, advisory-lock
(`FORMACAO_LOCK_KEY`), sem segundo caminho de domínio. *(Alternativa: formar sob demanda no request do
painel — rejeitada: acoplaria a latência da montagem ao carregamento da tela e não daria a cadência
diária previsível que a operação pede.)*

### D2 — Elegibilidade = a-vencer ≤7d + aprovado/não-pago (I2) + I4 + I7
Só entram na formação títulos **A VENCER** com vencimento ≤ **7 dias** (vencidos **excluídos**),
aprovados na alçada e não pagos (I2), agrupados respeitando I4 (uma filial) e I7 (uma classe). O
`TituloAPagarRepository.listElegiveisParaFormacao(maxDias)` faz o filtro a-vencer + **anti-join** contra
qualquer lote RASCUNHO (não repesca título já em rascunho, I3). *(Alternativa: incluir vencidos —
rejeitada: um título vencido exige tratamento/negociação da analista, não entra num lote montado
automaticamente; o valor 7 dias é o horizonte de config do tenant sobre a estrutura "montar o que vence
em breve".)*

### D3 — Agrupamento filial × classe × banco (caveat: banco-null → degenera para filial × classe)
Os elegíveis são agrupados por **filial × classe (nacional/internacional) × banco**, coerente com a
chave do arquivo de remessa nativo. **Caveat:** o `banco` é **nulo** nos títulos a-pagar (o `fin064`
não o carrega **antes** do pagamento — o banco/conta só se resolve no trilho de remessa, downstream),
então **hoje o agrupamento degenera para filial × classe**. `banco` fica registrado como dimensão
**estrutural** (para quando uma fonte de banco/conta existir) — **candidato a follow-up** quando essa
fonte surgir, coerente com a pergunta em aberto `agrupamento-banco-conta` (Flávia) já registrada em
`lote-uma-filial.md`. *(Alternativa: agrupar só por filial × classe e não modelar banco — rejeitada:
deixar `banco` na chave estrutural torna a promoção futura barata, sem reseed, quando a fonte existir.)*

### D4 — Auto-lote RASCUNHO vencido → DESFAZER/LIBERAR (sem status VENCIDO)
Em cada rodada, todo lote **automático** ainda em **RASCUNHO** que passou a conter **≥1 título
VENCIDO** é **deletado** (desfeito) e seus títulos **liberados** de volta ao pool
(`LotePagamentoRepository.desfazerAutomaticosVencidos`) — porque só a-vencer é elegível a lote
automático. **Não** se introduz um status `VENCIDO` no ciclo de vida: o lote automático é
**descartável e re-formável**, distinto do `CANCELADO` (decisão explícita da analista) e do lote manual
(intocável pelo cron). *(Alternativa: mover o lote para um status VENCIDO ou remover só o título vencido
— rejeitada: o auto-lote é um artefato efêmero re-derivável a cada rodada; desfazê-lo inteiro e
re-formar mantém a máquina de estados simples e a convergência trivial, sem um estado extra que só
existiria para o caminho automático.)*

### D5 — Auto-lotes são CANDIDATOS RASCUNHO para revisão; cron nunca toca manual/finalizado
Os lotes formados nascem **RASCUNHO** (badge "automático") em "Lotes candidatos" — a analista os
**revisa** (inclui/remove títulos, cancela) e **finaliza** (o gate `finalizarLote`, human-in-the-loop).
A formação **só** cria/desfaz lotes **automáticos RASCUNHO**: lotes **manuais**, **FINALIZADOS** e
**CANCELADOS** são **intocáveis** — o trabalho da analista e o downstream nunca são sobrescritos pelo
cron. *(Alternativa: formar lotes já FINALIZADOS — rejeitada: contraria o human-in-the-loop; a
finalização é o gate de controle da analista, não do robô.)*

### D6 — READ-ONLY no ERP (I1) mantido
A formação lê a carteira **do banco** (já ingerida — sem novo fan-out ao Conexos) e escreve **só** no
Postgres (`lote_pagamento` com `automatico=true`, `lote_pagamento_item`; migration `0026_lote_
automatico.sql` adiciona `lote_pagamento.automatico BOOLEAN`). Nenhuma escrita no ERP — remessa/baixa
seguem deferidas para a fatia de transporte, gated como em Permutas.

## Consequências

- A operação diária ganha os lotes **pré-montados** logo após a ingestão — a analista passa de
  *digitar* para *revisar/aprovar*, reduzindo trabalho manual sem perder o controle (gate mantido).
- O ciclo de vida do lote ganha uma distinção nova: **auto-lote RASCUNHO é efêmero/re-formável**
  (desfeito quando vence), enquanto manual/finalizado são estáveis — modelado sem status extra.
- `LotePagamento` ganha a propriedade `automatico` (formado pelo cron vs. montado à mão), que também
  dirige o **badge** de UI e o escopo do que o cron pode desfazer.
- O agrupamento por `banco` fica **latente** (degenerado por `banco`-null) — follow-up documentado para
  quando uma fonte de banco/conta pré-pagamento existir.
- A operação é **convergente/idempotente**: desfazer-vencidos + anti-join fazem cron e manual
  convergirem ao mesmo conjunto de auto-lotes sem duplicar nem tocar o manual.

## Universalidade

A **estrutura** (pré-formar lotes de pagamento das obrigações a vencer, pela mesma chave do arquivo de
remessa, como candidatos que o analista revisa; desfazer o que venceu; não repescar o que já está em
rascunho) é universal em qualquer contas-a-pagar de trading com comex — é a automação natural sobre a
montagem manual que o ADR-0015 já modelou. Os **valores** (janela de 7 dias, cadência do cron, quais
dimensões de agrupamento estão efetivamente disponíveis) são config do tenant/ERP — recalibráveis sem
mudar a estrutura da ação.

## Reuso da Fatia anterior + Frente I

Cadência cron + manual sobre o mesmo compute e advisory-lock (`FORMACAO_LOCK_KEY` espelha o lock da
ingestão, ADR-0016); anti-join/não-duplicação (I3, `nao-duplicacao-titulo-lote`); invariantes de
uniformidade I4 (`lote-uma-filial`) e I7 (`lote-uniforme-nacional-internacional`, ADR-0017); agregado
lote+itens com snapshot (`ItemLote`, como `permuta_alocacao` da Frente I); READ-ONLY no ERP (I1). Não
se reinventa nada — a formação automática é a camada de conveniência sobre a montagem manual já
validada.
