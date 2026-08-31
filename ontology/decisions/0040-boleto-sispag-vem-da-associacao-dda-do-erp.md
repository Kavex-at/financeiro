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

## Emenda (2026-08-28) — endurecimentos do Regis-Review

A review do delta (`docs/regis-review/2026-08-28-0249-sispag-boleto-dda/`) passou no gate com
0 P0, mas os quatro P1 foram implementados na mesma branch. Três mudam o que este ADR decidiu:

1. **Freio de incidente próprio.** `SISPAG_DDA_ASSOC_ENABLED` (default **true**) desliga só a
   associação DDA. Antes, conter um bug deste caminho exigia `SISPAG_LIVE_WRITE_ENABLED=false`,
   que derruba remessa E conciliação — 100% do SISPAG para conter algo que afeta 31–35% dos
   itens. Desligado, todo BOLETO cai em `BoletoSemCodigoBarrasError`: é o comportamento
   pré-ADR-0040, mas falhando alto em vez de mandar barras vazia.

2. **`titVldReflexoDdaAssoc` é validado, não coagido.** Era
   `Number(r.titVldReflexoDdaAssoc ?? 0) === 1` — e essa coerção transformaria um rename do
   Conexos em "a carteira inteira não tem boleto", que é a MESMA classe de defeito que este ADR
   corrigiu. Agora há `PENDENTE_DDA_SCHEMA` (`z.union([literal(0), literal(1)])`), e o grid
   inteiro ilegível vira `ConexosError` explícito — não um Set vazio silencioso. Ilegibilidade
   parcial (uma linha suja) segue tolerada; só a total é tratada como quebra de contrato.
   A ingestão também passou a registrar a taxa de boleto DDA por filial a cada rodada.

3. **O painel lê do banco; só o envio lê ao vivo.** `modalidadesDisponiveisDoLote` refazia o
   grid de pendentes a cada abertura de lote — +7 requisições Conexos na filial 2 para chegar
   à resposta que a ingestão já gravou em `tem_boleto`. Passa a ler
   `TituloAPagarRepository.listChavesComBoleto`.

   **Isto NÃO enfraquece o anti-drift**, e vale registrar por quê: o painel decide o que o
   dropdown OFERECE; quem decide o que vira dinheiro é `montarItensImport`, que continua lendo
   o grid AO VIVO no momento do import e barrando com `BoletoSemCodigoBarrasError`. Um
   `tem_boleto` de até 24 h desatualiza uma tela — nunca deixa sair remessa sem barras.

   Efeito colateral bem-vindo: `SispagPainelService` deixou de depender do
   `ConexosSispagWriteClient` (era um service read-only importando a superfície de escrita).

4. **O envelope da pergunta virou fixture.** `__fixtures__/2026-08-27-fin015-question-barcode.json`
   guarda o wire real capturado em HML, coberto pelo `contrato.test.ts`. O `id` deixou de ser
   `.optional()` no `QUESTION_SCHEMA`: sem ele não há como chavear o `answers`, e recusar é
   melhor que mandar `{ undefined: 'YES' }` ao ERP.

## Pendências

- **P1:** confirmar com a Flávia se o caminho DDA cobre 100% dos boletos ou se sobra resíduo
  digitado à mão. Ver `sispag-boleto-dda-sondagem.md` §6.
- ~~**Go-live:** acompanhar a primeira remessa real com boleto.~~ **FECHADO (2026-08-31).**
  A cadeia inteira foi provada ponta a ponta em HML — `titVldReflexoDdaAssoc` → `importarTitulos`
  com auto-resposta → `itsNumCodbar` no item → `gerarRemessa` → **segmento J com 44 dígitos e DV
  válido** no `PG310801.REM` (banco 341, R$ 5.720,68, o mesmo barcode do item DDA do `fin124`).
  O item saiu com modalidade **6**, confirmando o encoding na nossa própria trilha (o teste
  anterior, com boleto 745, saiu 7).

  A conferência humana virou **gate automático**: `RemessaCnabValidator` recusa o arquivo antes
  de ele ficar disponível. Evidência deixada em HML: lote `flp 34` (fil 2, bnc 4) e a remessa
  `PG310801.REM`.

  Dois achados de operação nesse caminho: `sugerirRemessa` devolve `numRemessa` vazio em HML
  (a conta não tem sequência configurada — em produção esse número é controle bancário e não
  pode ser inventado), e `ccoCod = 1` na filial 2 é conta **Banestes**, não Itaú — a armadilha
  que a migration 0049 descreve.
