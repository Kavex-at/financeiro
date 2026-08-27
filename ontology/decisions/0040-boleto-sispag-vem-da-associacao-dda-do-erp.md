---
id: ADR-0040
title: O boleto do SISPAG vem da associação DDA do próprio ERP
status: accepted
date: 2026-08-27
supersedes: []
related: [ADR-0015, ADR-0016, ADR-0013, ADR-0039]
owners: [yuri]
---

# ADR-0040 — O boleto do SISPAG vem da associação DDA do próprio ERP

## Contexto

O SISPAG tratava boleto, PIX e TED do mesmo jeito. A modalidade por item existia
(`lote_pagamento_item.modalidade`, migration 0031) e a auto-detecção de boleto era
`temBoleto = Boolean(fin064.titEspCodbar)`. Só que **`titEspCodbar` nunca vem preenchido**.

Sondagem read-only em produção (2026-08-27, `ontology/_inbox/sispag-boleto-dda-sondagem.md`):

| Fonte | Amostra | Com `titEspCodbar` |
|---|---|---|
| `fin064/list` (carteira) | 2000 | **0 (0%)** |
| `fin015/…/titulosPendentes/list` | 2173 | **0 (0%)** |
| `com308.finTituloFin` | 50 | **0 (0%)** |

Consequências que estavam em produção:

1. `temBoleto` era **sempre `false`** — a auto-detecção nunca disparou.
2. Todo item ia à analista como "a definir".
3. Escolhendo BOLETO, o import mandava `titEspCodbar: ''` — **remessa com segmento J sem
   código de barras**, que o banco não liquida.
4. `MODALIDADE_NATIVA.BOLETO = 7` estava errado para 89% dos boletos reais (medido: `6` =
   boleto do mesmo banco, 32 itens; `7` = outro banco, 4 itens).

O código de barras existe no `fin124` (Importação de Arquivo DDA): 143 arquivos, **100% dos
itens com `ditEspCodbar`**. Mas o item DDA **não guarda documento/título** (0% de `docCod`), e o
pool **não é por filial** — as 4 filiais devolvem os mesmos itens, porque o DDA é da conta
pagadora. Casar por valor+vencimento dá candidato único para ~1/3 dos itens, com ambiguidade
entre filiais. **Matching nosso não é confiável.**

## Decisão

**Quem casa boleto com título é o ERP. Nós pedimos, respondemos uma pergunta, e lemos o
resultado.**

1. O sinal de "este pagamento tem boleto" é o flag **`titVldReflexoDdaAssoc`** do grid de
   pendentes do `fin015` — o único vínculo pagamento↔boleto que existe no ERP.
2. No import, `ConexosSispagWriteClient.importarTitulos` manda `titVldReflexoDdaAssoc: 1` para
   os títulos que têm esse flag (`associarDda`). O ERP então anexa `itsNumCodbar`, marca
   `vldVinculoDda = 1` e **deriva a modalidade do banco emissor do código de barras**.
3. Esse caminho passa por uma **pergunta do ERP**,
   `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`, respondida automaticamente com `YES`.
4. `titEspCodbar` **não vai mais** no payload do import.
5. Item marcado BOLETO sem boleto DDA é **barrado no envio** (`BoletoSemCodigoBarrasError`),
   não no rascunho.

### Protocolo de resposta a QUESTION (medido, não documentado pelo Conexos)

Re-POST do **mesmo body** com `answers: { "<question.id>": "YES" }` — um `Map<String,String>`
chaveado pelo **`id`**, não pelo `key`, e não um array. Sete outros encodings devolvem a mesma
pergunta; o array devolve `Cannot deserialize LinkedHashMap<String,String> from Array value`,
que foi o que entregou o tipo.

O POST que devolve `QUESTION` **não importa nada** (medido: contagem de itens do lote inalterada
antes da resposta). A pergunta é um pré-commit, não escrita parcial — por isso o re-POST não é
retry cego e não conflita com a doutrina de escrita não-idempotente (ADR-0013).

## Por que auto-responder, se a doutrina é não auto-responder

`ErpPerguntaError` existe justamente para **não** decidir por quem opera. Isso continua valendo:
a allowlist tem **uma chave exata**, e qualquer outra pergunta — em especial
`PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO`, que **altera a
forma de pagamento** — continua subindo para decisão humana. Envelope com duas perguntas também
não é auto-respondível, mesmo contendo a allowlistada.

A diferença material: responder `YES` aqui **não escolhe nada**. Só confirma o uso do boleto que
o próprio ERP já casou com aquele título. A alternativa — subir 409 para a analista a cada
boleto — transformaria o caminho normal do pagamento em exceção manual.

## Consequências

- `titulo_a_pagar.tem_boleto` muda de fonte: passa a ser preenchido pela ingestão a partir do
  flag de DDA, não do `titEspCodbar`. O `mapTitulo` do `fin064` devolve `false` por construção.
- O grid de pendentes exige um `flpCod`; a ingestão usa o **lote nativo mais recente da conta
  como contexto de leitura** (não o modifica; o grid lista a filial inteira). Filial sem lote
  degrada para `tem_boleto = false` com `BUSINESS_WARN` — nunca derruba a rodada.
- `modalidadesDisponiveisDoLote` ganha uma terceira fonte: BOLETO sai do DDA, PIX do `fin064`,
  TED/crédito da conta do favorecido.
- Boleto **não exige conta do favorecido** — o destino é o próprio código de barras. Exigir
  conta rejeitava justamente o caso em que o boleto existe.
- `MODALIDADE_NATIVA.BOLETO` vira quase morto: para boleto com DDA quem decide é o ERP, e boleto
  sem DDA é barrado antes.

## Alternativas descartadas

- **Ingerir o `fin124` e casar por conta própria.** Pool global sem vínculo; ~1/3 de match único
  e ambíguo entre filiais. Erro de matching aqui = pagar o boleto errado.
- **Pedir à Columbia que associe o DDA à mão no ERP antes.** Empurra trabalho manual para
  destravar automação — e o flag mostra que o ERP já faz isso sozinho.
- **Deixar a analista digitar o barcode.** É o que acontece hoje (73% dos itens boleto reais têm
  barras sem `vldVinculoDda`) e é exatamente o trabalho que a frente existe para eliminar.

## Pendências

- **P1:** confirmar com a Flávia se o caminho DDA cobre 100% dos boletos ou se sobra resíduo
  digitado à mão. Ver `sispag-boleto-dda-sondagem.md` §6.
- **Go-live:** a associação foi provada em HML. A primeira remessa real com boleto deve ser
  acompanhada (o `.REM` gerado precisa mostrar segmento J com barras).
