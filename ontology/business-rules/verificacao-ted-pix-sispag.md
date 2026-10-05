---
name: verificacao-ted-pix-sispag
type: business-rule
entity: LotePagamento
invariant: I13
ontology_version: "0.36.0"
implementation_status: planned
status: active
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/interface/auth/Permission.ts
  - src/backend/jobs/probe-duplicidade-titulos.ts
  - src/backend/jobs/probe-canal-por-fornecedor.ts
  - docs/bpmn/sispag-pagamento-proposto.bpmn
last_review: 2026-10-05
has_canonical_test: false
---

# Business Rule — verificação dos itens TED/PIX do lote SISPAG (I13)

> **Origem:** ADR-0063 (2026-10-05), BPMN proposto do SISPAG. Quatro controles sobre os itens
> TED/PIX entre a montagem e a remessa: **duplicidade**, **canal habitual**, **dados de pagamento** e
> **conferência por segunda pessoa**. Nenhum deles escreve no Conexos.

## Onde se aplica

Só a itens com `modalidade ∈ {TED, PIX}`. `BOLETO` e item sem modalidade **nunca** são verificados:
o boleto o banco valida pelo código de barras, e o código só é confirmado na remessa (ADR-0040).
`CREDITO_CONTA` legado: não verificado (não é oferecido).

## Invariantes

| # | Regra | Quando |
|---|---|---|
| **I13a** | **Momento.** A verificação (`verificarItensTedPix`) roda (1) logo depois de `atualizarModalidadeItem` definir TED ou PIX, só para aquele item, e (2) no `finalizarLote` (L3), para todos os itens TED/PIX do lote. **Nunca** na ingestão das 07h: o `fin064` não traz forma de pagamento (probe: 0%). Trocar o item para `BOLETO` ou "a definir" descarta as alertas abertas dele (evento na trilha). | edição, finalizar |
| **I13b** | **Falha fechada.** Leitura do Conexos que falha (fin064, cmn025) **não decide**: o item fica `verificacaoEstado = PENDENTE` e nenhuma alerta é criada nem descartada por ausência. O `finalizarLote` re-roda a verificação; item ainda `PENDENTE` barra com `PaymentCheckPendingError`. Falha de leitura **nunca** retira item nem abre pendência de cadastro. | sempre |
| **I13c** | **Duplicidade FORTE.** Para o título do item, existe outro título com o **mesmo favorecido** (`pesCod`, ou `pesCodFor` quando o `pesCod` vem vazio) e o **mesmo número de NF normalizado** (`docEspNumero` só dígitos, sem zeros à esquerda; número vazio após normalizar não casa) e **`docCod` diferente**, de **qualquer tipo de documento**, **inclusive já pago**. Fonte: `fin064` lido ao vivo, sem filtro de `vldPago`. | verificação |
| **I13d** | **Duplicidade FRACA.** Outro título do mesmo favorecido com o **mesmo valor em centavos** e **vencimento a ±15 dias**, `docCod` diferente. Um par que é FORTE não gera também FRACA. A janela de ±15 dias é configuração do tenant (default 15). | verificação |
| **I13e** | **Parcelas não são duplicidade.** Títulos do mesmo `(filCod, docCod)` nunca são contraparte um do outro. | verificação |
| **I13f** | **Duplicidade bloqueia.** Toda `AlertaItemLote` de duplicidade (FORTE ou FRACA) `ABERTA` barra o `finalizarLote` (`PendingDuplicateAlertError`, com a lista por item). Resolução pela analista, item a item e alerta a alerta, só em `RASCUNHO` (`resolverAlertaDuplicidade`): **JUSTIFICAR** (justificativa de texto livre obrigatória, quem/quando; o item fica) ou **RETIRAR** (o item sai do lote e o título ganha um `BloqueioDuplicidade`). | finalizar |
| **I13g** | **Bloqueio por duplicidade.** Título com `BloqueioDuplicidade` `ATIVO` ("retirado por duplicidade — cancelamento pendente no Conexos"; quem/quando/motivo) **não entra** em `formarLotesAutomaticos` nem em `incluirTituloNoLote` (`DuplicateHoldError`). O bloqueio se **encerra sozinho** quando o título some do `fin064` (`ativo = false` na ingestão, ou cancelado) e é **desfeito** pela analista com motivo, auditado. **Nenhuma escrita no ERP:** o cancelamento é ato humano no Conexos. | inclusão, formação, ingestão |
| **I13h** | **Justificativa estável.** Na re-verificação, a alerta com a **mesma contraparte** (mesmo `(filCod, docCod)` do outro título) e o mesmo tipo mantém a resolução. **Contraparte nova** gera alerta nova `ABERTA`. Contraparte que deixou de casar (cancelada, inativa) fecha a alerta como `OBSOLETA` (evento na trilha). | verificação |
| **I13i** | **Canal habitual (não bloqueia).** Item TED/PIX cujo favorecido tem `PerfilCanalFornecedor` com confiança **ALTA** e grupo dominante **diferente de `TED_PIX`** (`BOLETO` ou `OUTROS`) gera `AlertaItemLote` `CANAL_HABITUAL`. Sem perfil, ou perfil não ALTA: nenhuma alerta. Não bloqueia o finalizar nem a remessa; é mostrada na conferência. Grupos: `BOLETO`, `TED_PIX` (TED e PIX são um grupo só), `OUTROS` (tributo, histórico não reconhecido, SISPAG sem canal). | verificação |
| **I13j** | **Dados de pagamento.** O destino é resolvido pela **mesma função** de I10 (`DestinoPagamentoResolver`: cadastro `cmn025` primeiro, depois `ExcecaoDestino` `APROVADA`). (1) **Sem dado no cadastro e sem exceção aprovada:** o item **sai do lote** (remoção pelo sistema, ator `sistema`, motivo `SEM_DADO_PAGAMENTO`, auditada) e abre-se `PendenciaCadastro` do favorecido e tipo (`CONTA` para TED, `CHAVE_PIX` para PIX). (2) **Sem dado no cadastro, com exceção `APROVADA`:** o item **fica** (destino `EXCECAO`, ADR-0061 inalterada) e a `PendenciaCadastro` é aberta do mesmo jeito. (3) **Cadastro com dado:** nada. A analista nunca digita conta/chave no lote. | verificação |
| **I13k** | **Pendência de cadastro.** No máximo uma `PendenciaCadastro` `ABERTA` por (favorecido, tipo); nova ocorrência acrescenta o título de origem. `ABERTA → RESOLVIDA` **só automaticamente**, quando o cadastro passa a ter o dado (reconferido ao abrir/atualizar a fila e em toda verificação). Fila "Pendências de cadastro" visível a quem tem **`sispag:cadastro`**. Sem e-mail. | verificação, fila |
| **I13l** | **Conferência por segunda pessoa.** Lote com ≥1 item `TED` ou `PIX` (`exigeConferencia`, derivado) só sai de `FINALIZADO` para `REMESSA_GERADA` (L8) se **conferido** (`conferidoPor` não nulo): `ConferenceRequiredError`. Lote só de boleto não exige. `conferirLote` (L12) exige **`sispag:conferir`** e que o conferente **não** seja `finalizadoPor`, nem `incluidoPor` de nenhum item, nem `criadoPor` de lote manual (`SelfConferenceError`), comparado pelo **username canônico do usuário autenticado** no backend (espelho de I12b). `devolverLote` (L13) volta a `RASCUNHO` com motivo obrigatório e limpa a conferência; `reabrirLote` (L4) também limpa. | L4, L8, L12, L13 |
| **I13m** | **Trilha.** Todo evento de verificação (alerta criada, justificada, retirada, obsoleta, descartada), de bloqueio (criado, encerrado, desfeito), de pendência (aberta, origem acrescentada, resolvida), de remoção pelo sistema e de conferência/devolução é registrado com ator e instante, só-inclusão. Conta/chave mascaradas (I10h). | sempre |

## Visão do conferente (I13l)

Por item TED/PIX: favorecido, conta ou chave PIX **mascarada** (como a tela atual, I10h), origem do
destino (`CADASTRO`/`EXCECAO`), valor, alertas de duplicidade **com a justificativa** e alertas de
canal. Itens boleto aparecem sem esse detalhe.

## Configuração do tenant (não ontologia)

| Parâmetro | Default (Columbia) |
|---|---|
| Janela de vencimento da duplicidade FRACA | ±15 dias |
| Perfil ALTA: mínimo de pagamentos com casamento único | 5 |
| Perfil ALTA: mínimo de meses distintos | 3 |
| Perfil ALTA: participação mínima do grupo dominante | 95% |

Os defaults vêm das probes de 2026-10-05; são ponto de partida, ajustáveis sem ADR.

## Erros nomeados

| Erro | Onde | HTTP sugerido |
|---|---|---|
| `PaymentCheckPendingError` | `finalizarLote` com item `verificacaoEstado = PENDENTE` | 409 |
| `PendingDuplicateAlertError` | `finalizarLote` com alerta de duplicidade `ABERTA` | 409 |
| `ItemsRemovedByCheckError` | `finalizarLote` em que a verificação retirou item(ns) (I13j-1); o lote fica `RASCUNHO` com a retirada gravada | 409 |
| `DuplicateHoldError` | `incluirTituloNoLote` de título com `BloqueioDuplicidade` `ATIVO` | 409 |
| `ConferenceRequiredError` | `gerarRemessa` (L8) de lote com `exigeConferencia` sem conferência | 409 |
| `SelfConferenceError` | `conferirLote` por quem finalizou, incluiu item ou criou o lote manual | 403 |

Falta de permissão (`sispag:conferir`, `sispag:cadastro`) segue o 403 genérico do `requirePermission`.

## Ver também

`decisions/0063-*.md` · `entities/alerta-item-lote.md` · `entities/bloqueio-duplicidade.md` ·
`entities/pendencia-cadastro.md` · `entities/perfil-canal-fornecedor.md` ·
`state-machines/lote-pagamento.md` (L3, L4, L8, L12, L13) · `business-rules/destino-pagamento-sispag.md`
(I10) · `business-rules/excecao-destino-sispag.md` (I12) · `_inbox/sispag-verificacoes-ted-pix-gap.md`
