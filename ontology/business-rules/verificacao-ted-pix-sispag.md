---
name: verificacao-ted-pix-sispag
type: business-rule
entity: LotePagamento
invariant: I13
ontology_version: "0.38.0"
implementation_status: partial
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
last_review: 2026-10-08
has_canonical_test: true
---

# Business Rule — verificação dos itens TED/PIX do lote SISPAG (I13)

> **Origem:** ADR-0063 (2026-10-05), BPMN proposto do SISPAG. **Revisada pela ADR-0065
> (2026-10-08):** a conferência por segunda pessoa (I13l), o alerta de canal habitual (I13i) e a
> pendência de cadastro (I13k) saem; dados de pagamento passam a incluir a **autorização do
> favorecido** (I14). Ficam dois controles sobre os itens TED/PIX entre a montagem e a remessa:
> **duplicidade** e **dados de pagamento/autorização**. Nenhum deles escreve no Conexos.
>
> **Ontologia à frente do código** (ADR-0065): I13j/m e os erros abaixo ainda não estão implementados.

## Onde se aplica

Só a itens com `modalidade ∈ {TED, PIX}`. `BOLETO` e item sem modalidade **nunca** são verificados:
o boleto o banco valida pelo código de barras, e o código só é confirmado na remessa (ADR-0040).
`CREDITO_CONTA` legado: não verificado (não é oferecido).

## Invariantes

| # | Regra | Quando |
|---|---|---|
| **I13a** | **Momento.** A verificação (`verificarItensTedPix`) roda (1) logo depois de `atualizarModalidadeItem` definir TED ou PIX, só para aquele item, e (2) no `finalizarLote` (L3), para todos os itens TED/PIX do lote. Em (1) o resultado da autorização (I14) é **só aviso** no item; em (2) é autoritativo. **Nunca** na ingestão das 07h: o `fin064` não traz forma de pagamento (probe: 0%). Trocar o item para `BOLETO` ou "a definir" descarta as alertas abertas dele (evento na trilha). | edição, finalizar |
| **I13b** | **Falha fechada.** Leitura do Conexos que falha (fin064, cmn025) **não decide**: o item fica `verificacaoEstado = PENDENTE` e nenhuma alerta é criada nem descartada por ausência. O `finalizarLote` re-roda a verificação; item ainda `PENDENTE` barra com `PaymentCheckPendingError`. Falha de leitura **nunca** retira item nem abre reaprovação (I14f). | sempre |
| **I13c** | **Duplicidade FORTE.** Para o título do item, existe outro título com o **mesmo favorecido** (`pesCod`, ou `pesCodFor` quando o `pesCod` vem vazio) e o **mesmo número de NF normalizado** (`docEspNumero` só dígitos, sem zeros à esquerda; número vazio após normalizar não casa) e **`docCod` diferente**, de **qualquer tipo de documento**, **inclusive já pago**. Fonte: `fin064` lido ao vivo, sem filtro de `vldPago`. | verificação |
| **I13d** | **Duplicidade FRACA.** Outro título do mesmo favorecido com o **mesmo valor em centavos** e **vencimento a ±15 dias**, `docCod` diferente. Um par que é FORTE não gera também FRACA. A janela de ±15 dias é configuração do tenant (default 15). | verificação |
| **I13e** | **Parcelas não são duplicidade.** Títulos do mesmo `(filCod, docCod)` nunca são contraparte um do outro. | verificação |
| **I13f** | **Duplicidade bloqueia.** Toda `AlertaItemLote` de duplicidade (FORTE ou FRACA) `ABERTA` barra o `finalizarLote` (`PendingDuplicateAlertError`, com a lista por item). Resolução pela analista, item a item e alerta a alerta, só em `RASCUNHO` (`resolverAlertaDuplicidade`): **JUSTIFICAR** (justificativa de texto livre obrigatória, quem/quando; o item fica) ou **RETIRAR** (o item sai do lote e o título ganha um `BloqueioDuplicidade`). | finalizar |
| **I13g** | **Bloqueio por duplicidade.** Título com `BloqueioDuplicidade` `ATIVO` ("retirado por duplicidade — cancelamento pendente no Conexos"; quem/quando/motivo) **não entra** em `formarLotesAutomaticos` nem em `incluirTituloNoLote` (`DuplicateHoldError`). O bloqueio se **encerra sozinho** quando o título some do `fin064` (`ativo = false` na ingestão, ou cancelado) e é **desfeito** pela analista com motivo, auditado. **Nenhuma escrita no ERP:** o cancelamento é ato humano no Conexos. | inclusão, formação, ingestão |
| **I13h** | **Justificativa estável.** Na re-verificação, a alerta com a **mesma contraparte** (mesmo `(filCod, docCod)` do outro título) e o mesmo tipo mantém a resolução. **Contraparte nova** gera alerta nova `ABERTA`. Contraparte que deixou de casar (cancelada, inativa) fecha a alerta como `OBSOLETA` (evento na trilha). | verificação |
| ~~**I13i**~~ | **REMOVIDA (ADR-0065).** Canal habitual não gera mais alerta no item; `PerfilCanalFornecedor` só alimenta o relatório `listarCandidatosAutorizacao`. | — |
| **I13j** | **Dados de pagamento e autorização.** O destino vem **só do cadastro** (`DestinoPagamentoResolver`, I10) e é conferido por `verificarDestinoAutorizado` (I14d). No `finalizarLote`, item com resultado `SEM_DADO_PAGAMENTO`, `FAVORECIDO_NAO_AUTORIZADO` ou `DESTINO_ALTERADO` **sai do lote** (remoção pelo sistema, ator `sistema`, motivo gravado, auditada); para `SEM_DADO_PAGAMENTO` a mensagem é "favorecido sem conta/chave no cadastro do Conexos — pedir ao responsável pelo cadastro". O lote **finaliza na mesma chamada** com os itens restantes e a resposta lista os retirados. Se o lote **esvaziar**, fica `RASCUNHO` com as retiradas gravadas (`BatchEmptiedByCheckError`). Se ainda houver duplicidade `ABERTA` ou item `PENDENTE`, a finalização é barrada (I13b/f) e as retiradas ficam gravadas. A analista nunca digita conta/chave no lote. | verificação |
| ~~**I13k**~~ | **REMOVIDA (ADR-0065).** Sem `PendenciaCadastro` nem fila `sispag:cadastro`; a falta de dado aparece na trilha do lote e no relatório. | — |
| ~~**I13l**~~ | **REMOVIDA (ADR-0065).** Sem conferência por lote; a 2ª pessoa passou para a aprovação do favorecido (I14c). Letra não reaproveitada. | — |
| **I13m** | **Trilha.** Todo evento de verificação (alerta criada, justificada, retirada, obsoleta, descartada), de bloqueio (criado, encerrado, desfeito) e de remoção pelo sistema (com motivo) é registrado com ator e instante, só-inclusão. Eventos de autorização estão em I14j. Conta/chave mascaradas (I10h). | sempre |

## Configuração do tenant (não ontologia)

| Parâmetro | Default (Columbia) |
|---|---|
| Janela de vencimento da duplicidade FRACA | ±15 dias |
| Perfil ALTA (relatório): mínimo de pagamentos com casamento único | 5 |
| Perfil ALTA (relatório): mínimo de meses distintos | 3 |
| Perfil ALTA: participação mínima do grupo dominante | 95% |

Os defaults vêm das probes de 2026-10-05; são ponto de partida, ajustáveis sem ADR.

## Erros nomeados

| Erro | Onde | HTTP sugerido |
|---|---|---|
| `PaymentCheckPendingError` | `finalizarLote` com item `verificacaoEstado = PENDENTE` | 409 |
| `PendingDuplicateAlertError` | `finalizarLote` com alerta de duplicidade `ABERTA` | 409 |
| `BatchEmptiedByCheckError` | `finalizarLote` em que a verificação retirou todos os itens (I13j); o lote fica `RASCUNHO` com a retirada gravada | 409 |
| `DuplicateHoldError` | `incluirTituloNoLote` de título com `BloqueioDuplicidade` `ATIVO` | 409 |
| `PayeeNotAuthorizedAtRemittanceError` | `gerarRemessa` (L8) sem lote nativo, item TED/PIX que falha I14a | 409 |

Saíram (ADR-0065): `ItemsRemovedByCheckError`, `ConferenceRequiredError`, `SelfConferenceError`.

## Ver também

`decisions/0063-*.md` · `entities/alerta-item-lote.md` · `entities/bloqueio-duplicidade.md` ·
`entities/perfil-canal-fornecedor.md` · `entities/favorecido-autorizado.md` ·
`state-machines/lote-pagamento.md` (L3, L4, L8) · `business-rules/destino-pagamento-sispag.md`
(I10) · `business-rules/favorecido-autorizado-sispag.md` (I14) · `decisions/0065-*.md` · `_inbox/sispag-verificacoes-ted-pix-gap.md`
