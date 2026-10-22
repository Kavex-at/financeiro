---
adr_number: 0076
title: SISPAG — prontidão do lote em rascunho (o que barra, o que sai, e finalizar respeita a situação de pagamento)
date: 2026-10-22
status: proposed
type: change
related_entities: [LotePagamento, ItemLote, TituloAPagar, AlertaItemLote]
related_business_rules: [prontidao-lote, situacao-pagamento-titulo, elegibilidade-titulo-lote, verificacao-ted-pix-sispag, favorecido-autorizado-sispag]
continues: [0075, 0063, 0065]
evidence:
  - ontology/_inbox/sispag-situacao-pagamento-plan.md (§5 PR C, decisões D18–D21)
  - "mockup do maintainer, aba '2 · Lotes em rascunho' (`~/Downloads/SISPAG Rascunhos de Tela.html`, 'Segunda rodada'); o estado 'Confira' do mockup foi DESCARTADO depois dele (P1-1 do plano)"
  - "levantamento de código 2026-10-22: nenhum cálculo de 'pronto para finalizar' nem endpoint de finalização em massa; a lista de lotes não ordena; `finalizarLote` não consulta a situação de pagamento (LotePagamentoService.ts:608-676)"
---

# ADR 0076: prontidão do lote em rascunho

**Branch:** `worktree-sispag-situacao-lotes` (PR C do plano). Decisões tomadas pelo maintainer em
2026-10-22 (D18–D21). **Ontologia à frente do código:** tudo `planned`.

## Contexto

A ADR-0075 fez a tela de títulos dizer, por título, se ele pode ser pago. A aba de lotes em rascunho
ainda não diz nada até a analista clicar em **Finalizar**: só então descobre o alerta de duplicidade
aberto, o item sem forma, o ajuste de centavos em curso, ou vê itens TED/PIX **sumirem** do lote
(a verificação em modo RETIRAR tira o favorecido não autorizado sem barrar). E a finalização **não olha
a situação de pagamento**: um título que ficou bloqueado depois de entrar no lote (aprovação revogada,
venceu, é permuta) é finalizado e segue para a remessa.

## Decisão

1. **Prontidão calculada no backend, sobre dados já gravados (D18).** `GET /sispag/lotes` devolve, para
   cada lote em RASCUNHO, um resumo `prontidao`: estado (`PRONTO` | `COM_PENDENCIA`), quantos itens vão
   ao finalizar, quantos barram, quantos saem, e a lista de pendências. Nenhuma chamada ao Conexos: é a
   mesma regra para a tela e para a finalização em massa, e a lista com 40 lotes continua rápida. O
   aviso de TED/PIX é o da **última verificação** gravada no item (ADR-0065) e a tela diz isso; a
   finalização continua relendo ao vivo.
2. **Dois efeitos, sem "confira" (I20b).** Cada pendência ou **barra a finalização** (a finalização
   recusa enquanto existir) ou **sai do lote** (a finalização retira o item, que volta a Títulos a pagar).
   Não existe pendência "só para conferir": o estado "Pronto, confira" foi descartado (P1-1).
3. **Finalizar respeita a situação de pagamento (D19, I20d).** Item cujo título está `BLOQUEADO` pela
   regra da ADR-0075 **barra** a finalização, com o motivo, o dono e a ação do título. Item cuja situação
   não pôde ser avaliada (fora da carteira, fonte caída) também barra: é o fail-closed da I19s aplicado
   à finalização. Na finalização, aprovação, pagamento e vencimento são relidos AO VIVO (como na
   inclusão, `avaliarVivo`); na lista, valem os gravados.
4. **Finalizar em massa sem endpoint novo (D20).** "Finalizar os N lotes prontos" abre uma confirmação
   com os lotes e o total; cada lote é finalizado pelo endpoint que já existe, um de cada vez, e o
   resultado sai por lote. Um lote que falha não desfaz os outros.
5. **"O boleto vence antes do título" não vira pendência de lote (D21).** Confirmar o boleto já exige
   reconhecer o aviso (ADR-0072), então não sobra nada a mostrar no lote.

## Consequências

- (+) A analista vê, com o card fechado, o que falta em cada lote, e finaliza de uma vez os que estão
  prontos.
- (+) Fecha a última porta da ADR-0075: título bloqueado não chega à remessa por ter entrado no lote
  antes de bloquear.
- (−) A finalização passa a ler o `fin064` para cada item (aprovação, pagamento e vencimento ao vivo),
  como a inclusão já faz. Lote de 30 itens = 30 leituras a mais. Aceito pela consistência com a I19s.
- (−) O "pronto" da lista pode discordar da finalização quando a carteira gravada está velha
  (ex.: aprovado no Conexos depois da última ingestão). A finalização decide e diz o motivo.
- (−) A situação de pagamento na lista depende das mesmas fontes da ADR-0075; fonte caída vira
  pendência "situação não conferida", que barra.
