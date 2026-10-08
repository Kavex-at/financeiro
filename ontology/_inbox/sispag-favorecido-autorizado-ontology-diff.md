# Ontology Diff Proposal — sispag-favorecido-autorizado (2026-10-08)

> **Status: PROPOSTA, nada escrito em `ontology/` além deste arquivo.** Fonte:
> `_inbox/sispag-favorecido-autorizado-interview.md` (P0 respondidos em 2026-10-08 = decididos).
> ADR proposta: **0065** (livre na branch e em `origin/main`, que vão até 0064; nenhuma outra
> branch/worktree tem 006x). Versão proposta: **0.38.0** (`_coverage.json` = 0.37.0 na branch e em
> `origin/main`; `_index.json._meta.version` está em 0.36.0, drift pré-existente, corrigir junto).

## 0. Análise de candidatos

| # | Candidato | A1/A2/A3 · B · C · D · E | Decisão |
|---|---|---|---|
| 1 | Entidade `FavorecidoAutorizado` (par fornecedor+destino aprovado por 2 pessoas) | A1 parcial (1 cliente; controle clássico de tesouraria: "vendor bank master verification"), A2 Y, A3 Y · onto · Y · não duplica (substitui `ExcecaoDestino`, que era o oposto: dado fora do cadastro) · entidade | **ACCEPT** (revisão Francinei recomendada, não bloqueante) |
| 2 | State machine `favorecido-autorizado` | idem · onto · Y · nova · estados de #1 | **ACCEPT** |
| 3 | Business rule nova **I14** (autorização + fingerprint) | onto | **ACCEPT** |
| 4 | Reescrita I13 (j, m), remoção I13i/k/l | onto | **ACCEPT** |
| 5 | Reescrita I10 (resolvedor só cadastro) | onto | **ACCEPT** |
| 6 | Lote: L3 retira e finaliza, L4/L8 mudam, L12/L13 saem | onto | **ACCEPT** |
| 7 | Remover `ExcecaoDestino` (+ SM, I12, 6 actions) | — | **ACCEPT (remoção)** |
| 8 | Remover `PendenciaCadastro`, `sispag:cadastro` | — | **ACCEPT (remoção)** |
| 9 | Remover conferência por lote (`conferirLote`, `devolverLote`, `sispag:conferir`, atributos) | — | **ACCEPT (remoção)** |
| 10 | `CANAL_HABITUAL` sai de `AlertaItemLote` | — | **ACCEPT (remoção)**; perfil fica |
| 11 | Ação read-only `listarCandidatosAutorizacao` (relatório) | A2 Y · onto (ação), colunas/tela = UI | **ACCEPT** a ação; layout **REJECT-NOT-DOMAIN** |
| 12 | Algoritmo HMAC-SHA256, segredo do tenant, formato da máscara | — | **REJECT-CONFIG/impl** (a ontologia diz "fingerprint keyed, não reversível"; o algoritmo é implementação) |
| 13 | Flag `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED` | — | **REJECT-CONFIG** (a garantia "TED/PIX nunca sem a guarda" é ontologia, I14k; o nome da flag não) |
| 14 | Selo de conferência / máscara parcial / botão "reconferir" / revelar (P1 aberto) | UI + 1 ação | **Proposta, aguardando OK** (§9) |
| 15 | Titularidade da conta TED (B4) | A? (precisa probe `ctcorr`) | **REJECT-PREMATURE** → watchlist |

## 1. Arquivos tocados (após aprovação)

| Arquivo | Operação |
|---|---|
| `entities/favorecido-autorizado.md` | **novo** |
| `state-machines/favorecido-autorizado.md` | **novo** |
| `business-rules/favorecido-autorizado-sispag.md` (I14) | **novo** |
| `actions/sispag/{solicitar,aprovar,rejeitar,revogar}-autorizacao-favorecido.md` | **novos** (4) |
| `actions/sispag/verificar-destino-autorizado.md` | **novo** (ação do sistema) |
| `actions/sispag/listar-candidatos-autorizacao.md` | **novo** (read-only) |
| `business-rules/verificacao-ted-pix-sispag.md` (I13) | reescrita parcial |
| `business-rules/destino-pagamento-sispag.md` (I10) | reescrita parcial |
| `state-machines/lote-pagamento.md` | L2, L3, L4, L8; L12/L13 removidas |
| `entities/lote-pagamento.md` | atributos removidos/novos |
| `entities/alerta-item-lote.md`, `entities/perfil-canal-fornecedor.md`, `entities/usuario.md` | emendas |
| `actions/sispag/{verificar-itens-ted-pix,finalizar-lote}.md` | emendas |
| `entities/excecao-destino.md`, `entities/pendencia-cadastro.md`, `state-machines/excecao-destino.md`, `business-rules/excecao-destino-sispag.md`, `actions/sispag/{registrar,aprovar,rejeitar,revogar}-excecao-destino.md`, `carregar-excecoes-destino-planilha.md`, `aposentar-excecoes-substituidas.md`, `conferir-lote.md`, `devolver-lote.md` | **removidos** (14 arquivos; história fica em git + ADR-0061/0063/0065) |
| `glossary.md`, `relationships.md`, `CHANGELOG.md` | emendas (§8) |
| `decisions/0065-sispag-favorecido-autorizado.md` | **nova** (§7) |

## 2. Entidade nova — `FavorecidoAutorizado`

Code-facing: **`AuthorizedPayee`** (constante `AUTHORIZED_PAYEE_STATE`). Tabelas propostas:
**`sispag_favorecido_autorizado`** + trilha só-inclusão **`sispag_favorecido_autorizado_evento`**
(trigger recusa UPDATE/DELETE/TRUNCATE).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `pesCod` · `credor` | number · string | Favorecido no `cmn025`; `credor` = snapshot do nome. Sem `filCod` (cadastro é global). |
| `modalidade` | `TED \| PIX` | **Chave junto com `pesCod`** (B1). |
| `estado` | enum | `PENDENTE \| AUTORIZADO \| REJEITADO \| REAPROVACAO_PENDENTE \| REVOGADO`. **No máx. 1 vigente** (`PENDENTE`/`AUTORIZADO`/`REAPROVACAO_PENDENTE`) por (`pesCod`, `modalidade`) — índice parcial. |
| `fingerprint` | string | HMAC do destino normalizado que o resolvedor I10 escolhe **no momento da aprovação** (B2). TED: banco+agência+DV+conta+DV; PIX: tipo+chave normalizada. Nulo em `PENDENTE`. |
| `fingerprintChaveId` | string | Versão do segredo usado (rotação do segredo ≠ "destino mudou"; ver §10-3). |
| `destinoMascarado` | string | Exibição (I10h). O valor completo **não** é persistido (fonte = `cmn025`). |
| `avisos` | lista | Ex.: `PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO` (B3). Não bloqueiam. |
| `fingerprintObservado` · `destinoObservadoMascarado` | string? | Preenchidos ao abrir `REAPROVACAO_PENDENTE` ("antes × agora"). |
| `origemSolicitacao` | `ITEM \| RELATORIO \| MANUAL` | De onde veio o pedido. |
| `solicitadoPor` · `solicitadoEm` | string · Date | Usuário autenticado (`sispag:executar`); `sistema` na reaprovação. |
| `decididoPor` · `decididoEm` · `motivoDecisao` | string? · Date? · string? | Aprovação/rejeição/revogação; motivo obrigatório em rejeição e revogação. |
| `ultimaConferenciaEm` · `ultimaConferenciaResultado` | Date? · enum? | `IGUAL \| DIFERENTE \| SEM_DADO \| FALHA_LEITURA`. Alimenta o selo (§9). |
| `versao` | number | Lock otimista. |

Relações: `FavorecidoAutorizado N—1 Favorecido (pesCod, sem entidade local)`;
`ItemLote N—0..1 FavorecidoAutorizado` (id gravado no congelamento I10f, só trilha);
`FavorecidoAutorizado 1—N EventoFavorecidoAutorizado` (ledger, não entidade).
**Sem expiração.**

`universality_evidence`: (1) entrevista Columbia/Yuri 2026-10-08 (conferência por lote rejeitada;
troca de conta no `cmn025` era o vetor não coberto); (2) controle universal de contas a pagar:
dados bancários do fornecedor aprovados por segunda pessoa e revalidados a cada pagamento
(estrutura = ontologia; lista e destinos = dado operacional); (3) 1 cliente: revisar com Francinei.

## 3. State machine nova — `favorecido-autorizado`

| # | De → Para | Ação | Guarda / efeito |
|---|---|---|---|
| F1 | `(novo) → PENDENTE` | `solicitarAutorizacaoFavorecido` | `sispag:executar`. Sem vigente para o par. Nunca nasce `AUTORIZADO` (inclusive vindo do relatório). |
| F2 | `PENDENTE → AUTORIZADO` | `aprovarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; aprovador ≠ `solicitadoPor` (id autenticado, backend). Lê `cmn025` ao vivo; recusa se `fingerprintEsperado` (o que a tela mostrou) ≠ atual (409). Sem dado no `cmn025` → recusa. Grava `fingerprint`. |
| F3 | `PENDENTE → REJEITADO` | `rejeitarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; motivo. Terminal. |
| F4 | `AUTORIZADO → REAPROVACAO_PENDENTE` | `verificarDestinoAutorizado` (**sistema**) | Leitura OK e fingerprint atual ≠ gravado. Alerta `SISPAG_DESTINO_ALTERADO` (dedup `pesCod`+`modalidade`). Falha de leitura **nunca** dispara (I14f). |
| F5 | `REAPROVACAO_PENDENTE → AUTORIZADO` | `aprovarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; **um** aprovador basta (solicitante = `sistema`; ver §10-1). Grava novo fingerprint. |
| F6 | `AUTORIZADO \| REAPROVACAO_PENDENTE → REVOGADO` | `revogarAutorizacaoFavorecido` | `sispag:autorizar_favorecido`; motivo. Terminal. Novo pedido = novo registro (F1). |

Terminais: `REJEITADO`, `REVOGADO`. Só `AUTORIZADO` com fingerprint igual libera pagamento.

## 4. Invariantes

### 4.1 I14 nova — `business-rules/favorecido-autorizado-sispag.md`

| # | Regra |
|---|---|
| **I14a** | Item `TED`/`PIX` só vai à remessa se existe `FavorecidoAutorizado` `AUTORIZADO` para (`pesCod`, `modalidade`) **e** o destino que o resolvedor I10 escolhe ao vivo tem o mesmo fingerprint. Boleto nunca é verificado. |
| **I14b** | Fingerprint = HMAC (segredo do tenant) do destino normalizado escolhido pelo resolvedor na aprovação. Resolvedor passar a escolher outra conta/chave = "destino mudou". Valor completo não é persistido. |
| **I14c** | Duas pessoas: solicitar com `sispag:executar`; aprovar/rejeitar/revogar com `sispag:autorizar_favorecido`; aprovador ≠ solicitante (backend). Reaprovação aberta pelo sistema: 1 aprovador. Aprovação confere o fingerprint mostrado contra o atual (anti-TOCTOU). |
| **I14d** | Função única `verificarDestinoAutorizado`, resultados: `OK` \| `SEM_DADO_PAGAMENTO` \| `FAVORECIDO_NAO_AUTORIZADO` \| `DESTINO_ALTERADO` \| `FALHA_LEITURA` (precedência nesta ordem após OK). |
| **I14e** | **Onde roda e o efeito:** (1) `atualizarModalidadeItem` TED/PIX → **só aviso** no item + atalho "pedir autorização", nunca retira (C1); (2) `finalizarLote` → **autoritativa**, retira o item (I13j); (3) `gerarRemessa` (L8) → **barra o lote inteiro** antes de qualquer escrita, erro nomeado por item (C3); (4) aprovação (sanidade, F2/F5). `DESTINO_ALTERADO` em qualquer ponto dispara F4. |
| **I14f** | Falha fechada: `FALHA_LEITURA` não autoriza, não retira, não abre reaprovação; item fica `verificacaoEstado = PENDENTE` (I13b); L8 barra. |
| **I14g** | Revogação vale para lote ainda não importado no `fin015`; destino já congelado (I10f) segue o lote nativo. |
| **I14h** | Sem expiração. |
| **I14i** | Dado de pagamento só leitura no lote; nenhum destino fora do `cmn025`; nada é escrito no `cmn025`. |
| **I14j** | Trilha só-inclusão: solicitado, aprovado, rejeitado, reaprovação aberta (antes × agora mascarados), revogado, destino revelado, item retirado/barrado com motivo. Nunca valor completo em log/ledger/erro (I10h). |
| **I14k** | TED/PIX **não é oferecido** enquanto a guarda I14 não estiver habilitada no tenant (flag = config). Nunca existe estado com TED/PIX e sem controle anti-troca de conta. |

Erros nomeados (sugestão): `PayeeNotAuthorizedAtRemittanceError` (L8, 409, lista por item),
`PayeeApprovalBySolicitorError` (403), `PayeeDestinationChangedSinceShownError` (409, F2/F5),
`PayeeWithoutPaymentDataError` (F2, 422).

### 4.2 I13 — antes × depois

| Letra | Antes | Depois |
|---|---|---|
| I13a | verificação ao definir TED/PIX e no finalizar; trocar p/ boleto descarta alertas | **mantém**; no passo (1) o resultado de I14 é só aviso |
| I13b | falha fechada; "nunca abre pendência de cadastro" | **mantém**, sem a menção à pendência |
| I13c–h | duplicidade FORTE/FRACA, JUSTIFICAR/RETIRAR, `BloqueioDuplicidade` | **inalteradas** (D1); justificativa deixa de ter conferente |
| I13i | canal habitual gera `AlertaItemLote CANAL_HABITUAL` | **REMOVIDA** — perfil só alimenta o relatório (§6) |
| I13j | sem cadastro e sem exceção → retira + `PendenciaCadastro`; com exceção → fica + pendência | **Reescrita:** no `finalizarLote`, item com resultado I14 ≠ OK **sai do lote** (ator `sistema`, motivo `SEM_DADO_PAGAMENTO` \| `FAVORECIDO_NAO_AUTORIZADO` \| `DESTINO_ALTERADO`, auditado); a mensagem de `SEM_DADO_PAGAMENTO` diz "pedir ao responsável pelo cadastro do Conexos". O lote **finaliza na mesma chamada** com os restantes (resposta lista os retirados). Se esvaziar: fica `RASCUNHO`, retiradas gravadas (`BatchEmptiedByCheckError`, 409). Duplicidade aberta / item `PENDENTE` continuam barrando — nesse caso as retiradas ficam gravadas e o lote fica `RASCUNHO`. |
| I13k | `PendenciaCadastro`, fila `sispag:cadastro` | **REMOVIDA** |
| I13l | conferência por 2ª pessoa (L12/L13) | **REMOVIDA** (letra não reaproveitada) |
| I13m | trilha inclui pendência e conferência | **Reescrita:** verificação, alertas de duplicidade, bloqueio, retirada pelo sistema (com motivo); autorização vai para I14j |

Erros I13: **saem** `ItemsRemovedByCheckError`, `ConferenceRequiredError`, `SelfConferenceError`;
**ficam** `PaymentCheckPendingError`, `PendingDuplicateAlertError`, `DuplicateHoldError`;
**entra** `BatchEmptiedByCheckError`. Seção "Visão do conferente" sai. Config do tenant: limiares
do perfil ficam (usados no relatório).

### 4.3 I10 — antes × depois

| Letra | Antes | Depois |
|---|---|---|
| Resolvedor | 1. cadastro; 2. `ExcecaoDestino` `APROVADA`; 3. nenhum | **só passo 1** (cadastro, ordem I10k p/ PIX, default p/ TED); senão nenhum |
| I10a | sem destino barra finalizar/envio | finalizar: retira (I13j); envio: barra (I14e-3) |
| I10b | oferta livre, retira e abre pendência; tela mostra origem CADASTRO/EXCECAO | oferta livre (com I14k); tela mostra destino mascarado + selo I14 |
| I10c | TED em qualquer banco | **inalterada** |
| I10d | PIX só com chave do cadastro ou exceção (CPF/CNPJ) | PIX só com chave do **cadastro** (qualquer tipo) |
| I10e | exceção não editada no item | **Reescrita:** destino nunca é editado no item/lote; só `cmn025` |
| I10f | congelamento; marca d'água inclui `excecaoDestinoId` | **mantém**; marca d'água sem `excecaoDestinoId`; grava `favorecidoAutorizadoId` (trilha) |
| I10g | trilha da exceção (I12e); `..._destino_audit` histórico | trilha de destino = I14j; ver §10-4 sobre `lote_pagamento_item_destino_audit` |
| I10h | mascarado; revelar só para quem edita | mascarado; revelar só `sispag:autorizar_favorecido`, auditado (§9) |
| I10i | titularidade bloqueante da exceção | **REMOVIDA** → vira aviso na aprovação (I14c / B3) |
| I10j | já revogada | sem mudança |
| I10k | preferência CPF/CNPJ do cadastro | **inalterada** (agora também define o fingerprint PIX) |
| Seções | "Formato do destino (cadastro da exceção)", H3/H5, adendos 0061 | **saem**; H3/H5 viram irrelevantes (todo TED vai por `pctCodSeq`, todo PIX por chave do `cmnPessoasPix`) |

## 5. `LotePagamento` — state machine e entidade

| Transição | Antes | Depois |
|---|---|---|
| L2 | destino do cadastro ou `ExcecaoDestino`; TED/PIX pode retirar item | destino só `cmn025`; definir TED/PIX **só avisa** (I14e-1), nunca retira |
| L3 | verificação retira → `ItemsRemovedByCheckError`, não finaliza | verificação retira **e finaliza** com os restantes; vazio → fica `RASCUNHO` (`BatchEmptiedByCheckError`); duplicidade/`PENDENTE` barram como hoje |
| L4 | limpa conferência | só reabre (nada de conferência) |
| L8 | guarda `exigeConferencia ⇒ conferido` | guarda **I14a** por item TED/PIX, antes de qualquer escrita (`PayeeNotAuthorizedAtRemittanceError`); ver §10-2 sobre retomada |
| L12 `conferirLote` | `FINALIZADO → FINALIZADO` | **REMOVIDA** (número não reaproveitado) |
| L13 `devolverLote` | `FINALIZADO → RASCUNHO` | **REMOVIDA** (número não reaproveitado) |
| Estado `FINALIZADO` | "aguardando conferência" com TED/PIX | sem atributo de conferência; lotes nesse estado no deploy passam pela guarda nova de L8 (E3) |

Atributos `LotePagamento` / `ItemLote`:

| Atributo | Depois |
|---|---|
| `conferidoPor/Em`, `devolvidoPor/Em`, `motivoDevolucao`, `exigeConferencia` | **removidos** |
| `itens[].destinoOrigem` | **removido** (sempre cadastro) |
| `itens[].excecaoDestinoId` | **removido** (coluna dropada ou inerte, E4) |
| `itens[].verificacaoEstado` | mantém |
| `itens[].favorecidoAutorizadoId` | **novo**, gravado no congelamento I10f (só rastreio) |
| `itens[].autorizacaoAviso` (derivado) | **novo**: `OK \| SEM_DADO_PAGAMENTO \| FAVORECIDO_NAO_AUTORIZADO \| DESTINO_ALTERADO \| null` — selo do item (C1) |

## 6. Remoções, permissões, alertas, relatório

| Item | Antes | Depois |
|---|---|---|
| `ExcecaoDestino` (entity, SM, I12, 6 actions) | implementada (ADR-0061) | **apagada**, inclusive tabelas/trilha/triggers (E4: 0 registros em prod) |
| `PendenciaCadastro` | implementada | **apagada**; motivo (b) = retirada auditada + seção do relatório |
| `AlertaItemLote.tipo` | `DUPLICIDADE_FORTE \| DUPLICIDADE_FRACA \| CANAL_HABITUAL` | sem `CANAL_HABITUAL`; relação com `PerfilCanalFornecedor` sai |
| `PerfilCanalFornecedor` | consumido por I13i | consumido só pelo relatório; `calcularPerfilCanal` fica |
| `sispag:excecao` | cadastrar/aprovar exceção | **convertida** em `sispag:autorizar_favorecido` (concessões migradas; `Administrador` recebe) |
| `sispag:conferir` | L12/L13 | **removida** |
| `sispag:cadastro` | fila de pendências | **removida** |
| `Alerta` operacional | `SISPAG_EXCECAO_DIVERGENCIA` | sai; entra `SISPAG_DESTINO_ALTERADO` (dedup `pesCod`+`modalidade`) |

**Ação nova read-only `listarCandidatosAutorizacao`** (`actions/sispag/listar-candidatos-autorizacao.md`,
`sispag:ver`): por favorecido pago por TED/PIX ou com perfil `TED_PIX`: `pesCod`, credor, grupo
dominante, participação, nº pagamentos, meses, confiança (`PerfilCanalFornecedor`), tem conta/chave
no `cmn025`, estado da autorização por modalidade, e seção "TED/PIX retirados por falta de dado".
Sem escrita no ERP. A partir da linha, `solicitarAutorizacaoFavorecido` (`sispag:executar`) cria
`PENDENTE`, nunca aprova. Colunas e exportação = UI.

## 7. ADR-0065 (rascunho)

```yaml
adr_number: 065
title: SISPAG — favorecido autorizado substitui conferência por lote e exceção de destino
date: 2026-10-08
status: accepted   # após OK do Yuri
type: change
related_entities: [FavorecidoAutorizado, LotePagamento, AlertaItemLote, PerfilCanalFornecedor, ExcecaoDestino, PendenciaCadastro, Usuario]
supersedes: [ADR-0061]
amends: [ADR-0054, ADR-0063]
```

- **Contexto:** Columbia rejeitou a conferência por lote (tempo da analista, contra o objetivo de
  automatizar). Nenhuma regra comparava o `cmn025` com um valor aprovado; a troca de conta só era
  pega pela conferência humana.
- **Decisão:** 2ª pessoa **uma vez por (favorecido, modalidade, destino)**, não por lote; fingerprint
  revalidado em toda verificação; destino só do `cmn025`; item que falha sai do lote no finalizar e
  barra a remessa se falhar depois; sem expiração; revogável.
- **Supersede ADR-0061 integral** (exceção, I12, `sispag:excecao`, titularidade bloqueante).
- **Emenda ADR-0063:** remove I13i/k/l, L12/L13, `PendenciaCadastro`, `sispag:conferir`,
  `sispag:cadastro`, `ItemsRemovedByCheckError`; L3 finaliza após retirar.
- **Emenda ADR-0054:** D1 mantida (nada escrito no cadastro); H3/H5 deixam de importar; I10i sai.
- **Rejeitado:** manter conferência por lote (custo recorrente); pinar o conjunto de contas
  (qualquer conta nova invalidaria); PIX só CPF/CNPJ (menos elegíveis; a 2ª pessoa decide);
  pré-preencher a lista pelo perfil de canal (o perfil é estatística, não aprovação).
- **Consequências:** com flags TED/PIX desligadas em prod (E1) não há migração de comportamento;
  bootstrap da lista via relatório validado com a Columbia antes de ligar (E2).

## 8. Docs e índices a atualizar após aprovação

**Docs:** `glossary.md` (saem "Exceção de destino", "Pendência de cadastro", "Conferência";
entram "Favorecido autorizado", "Fingerprint do destino", "Reaprovação"); `relationships.md`
(linhas 33–34 trocadas pelas relações de §2); `entities/usuario.md` (catálogo de permissões);
`CHANGELOG.md` (v0.38.0). `docs/regis-review/*` são históricos: não tocar. `CLAUDE.md`/`README.md`
não citam os conceitos.

**`_index.json`:**
- `entities`: − `ExcecaoDestino`, − `PendenciaCadastro`; + `FavorecidoAutorizado` (planned);
  `AlertaItemLote`, `PerfilCanalFornecedor`, `LotePagamento` → notas/`impl_files` atualizadas.
- `actions`: − 6 de exceção, − `conferirLote`, − `devolverLote`; + `solicitar/aprovar/rejeitar/revogarAutorizacaoFavorecido`,
  `verificarDestinoAutorizado`, `listarCandidatosAutorizacao` (planned).
- `business_rules`: − `excecao-destino-sispag`; + `favorecido-autorizado-sispag` (planned);
  `verificacao-ted-pix-sispag` → `partial` + `open_gap` "ADR-0065 à frente do código".
- `state_machines`: − `excecao-destino`; + `favorecido-autorizado` (planned).
- `_meta.version` 0.36.0 → **0.38.0** (corrige drift), `last_feature` = `sispag-favorecido-autorizado`.

**`_coverage.json` (summary):**

| Campo | Antes | Depois |
|---|---|---|
| version | 0.37.0 | 0.38.0 |
| entities_total / implemented / planned / pct | 26 / 19 / 5 / 73 | 25 / 17 / 6 / 68 |
| actions_total / implemented / planned / pct | 38 / 30 / 7 / 79 | 36 / 23 / 12 / 64 |
| business_rules_total / implemented / planned / with_tests | 27 / 17 / 10 / 13 | 27 / 16 / 11 / 12 |
| state_machines_total / implemented / planned | 6 / 2 / 3 | 6 / 1 / 4 |

(Sem contador `partial` para regras: I13 fica contada como implemented, com `open_gap`, como nas
versões anteriores. Drift pré-existente entre `_index` e `_coverage` mantido; aplicado só o delta.)

**Watchlist:** titularidade da conta TED no `ctcorr` (B4) — probe antes de modelar.

## 9. P1 em aberto — destino mascarado (**proposta, aguardando OK**)

| # | Proposta | Onde cai na ontologia |
|---|---|---|
| 1 | Selo: "igual ao Conexos (lido HH:MM) · igual ao aprovado em DD/MM por X" / "diferente do aprovado" | `ultimaConferenciaEm/Resultado` (§2) + `ItemLote.autorizacaoAviso`; texto = UI |
| 2 | Máscara parcial: banco e agência completos, conta com 4 últimos; PIX tipo + trecho; nome do favorecido | `destinoMascarado`; formato = implementação (emenda I10h) |
| 3 | Botão "reconferir com o Conexos" | chama `verificarDestinoAutorizado` (pode disparar F4) com `sispag:ver` |
| 4 | Revelar completo só `sispag:autorizar_favorecido`, auditado | I10h + I14j; lido ao vivo do `cmn025` (não está no nosso banco) |

## 10. Pontos de discordância / contradições

1. **Reaprovação com uma pessoa enfraquece justamente o vetor de fraude.** A troca de conta no
   `cmn025` é o caso que a 2ª pessoa existe para pegar; em F5 um único aprovador (que pode ser quem
   alterou o cadastro) re-libera. Sugestão: exigir que alguém com `sispag:executar` "confirme o pedido"
   (vira o solicitante) e manter aprovador ≠ solicitante; ou aprovador ≠ último aprovador. Default
   aceito pelo usuário mantido no diff; **peço reconfirmação**.
2. **L8 × retomada (I10f/ADR-0039).** "Barra antes de qualquer escrita" só faz sentido na 1ª
   tentativa. Numa retomada com lote nativo já criado/importado, barrar deixa órfão no `fin015`.
   Proposta: a guarda I14 roda só quando não há lote nativo; na retomada vale o destino congelado
   (mesmo regime que I12g tinha).
3. **Rotação do segredo HMAC** invalidaria todos os fingerprints e jogaria todo mundo em
   reaprovação. Por isso `fingerprintChaveId`: comparar só na mesma versão; rotação = recálculo
   assistido, não "destino mudou".
4. **E4 "apagar trilha e tabelas"** — ambíguo se inclui `lote_pagamento_item_destino_audit`
   (ADR-0054, anterior à exceção). Assumo que **não** (é trilha do destino manual por item, já
   histórica); confirmar.
5. **Autorizado + `cmn025` sem dado** (conta desativada sem substituta): proposto `SEM_DADO_PAGAMENTO`
   **sem** abrir reaprovação (nada novo a aprovar; se a mesma conta voltar, casa de novo). Confirmar.
6. **B6 × §9-4:** B6 (aceito) = completo exibido na tela de aprovação; §9-4 = revelar por botão,
   auditado. Proponho §9-4 também na aprovação (cada revelação auditada).
7. **L3 vazio fica `RASCUNHO` × ADR-0064 L5** (RASCUNHO esvaziado por `mover` vai a `CANCELADO`).
   Comportamentos diferentes para "lote vazio" são aceitáveis (um é ação do sistema no finalizar,
   outro efeito colateral de mover), mas registrar na ADR para não parecer inconsistência.
8. Universalidade de `FavorecidoAutorizado`: só 1 cliente; o conceito é controle padrão de
   tesouraria, então aceito, mas `universality_evidence` precisa da revisão do Francinei.

---
Responder: **approve** · **edit [arquivo] [instrução]** · **reject [motivo]** · **partial [itens]**.
