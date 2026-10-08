---
name: favorecido-autorizado-sispag
type: business-rule
entity: FavorecidoAutorizado
invariant: I14
ontology_version: "0.38.0"
implementation_status: planned
status: active
owners: [yuri]
related_files: []
last_review: 2026-10-08
has_canonical_test: false
---

# Business Rule: favorecido autorizado SISPAG (I14)

> **Origem:** ADR-0065 (2026-10-08). A guarda humana anti-fraude sai da conferência por lote e vai
> para a **aprovação do par (favorecido, destino)**, uma vez por destino. O destino é **sempre** o do
> cadastro do Conexos (`cmn025`); nada é escrito nele.

| # | Regra |
|---|---|
| **I14a** | Item `TED`/`PIX` só vai à remessa se existe `FavorecidoAutorizado` `AUTORIZADO` para (`pesCod`, `modalidade`) **e** o destino que o resolvedor I10 escolhe ao vivo tem o mesmo fingerprint. Boleto nunca é verificado. |
| **I14b** | **Fingerprint** = HMAC (segredo do tenant, versão em `fingerprintChaveId`) do destino normalizado que o resolvedor escolhe **na aprovação** (TED: conta default; PIX: ordem I10k). Resolvedor passar a escolher outra conta/chave = "destino mudou". O valor completo não é persistido. Algoritmo e segredo são implementação. |
| **I14c** | **Duas pessoas, sempre.** Solicitar (ou confirmar a reaprovação) com `sispag:executar`; aprovar, rejeitar e revogar com `sispag:autorizar_favorecido`; **aprovador ≠ solicitante**, no backend. A reaprovação aberta pelo sistema exige o mesmo par (F5 + F6). A aprovação confere o fingerprint mostrado contra o atual (anti-TOCTOU). Aviso não bloqueante quando a chave PIX não é o CPF/CNPJ do favorecido. |
| **I14d** | Função única `verificarDestinoAutorizado`, resultado: `OK` \| `SEM_DADO_PAGAMENTO` \| `FAVORECIDO_NAO_AUTORIZADO` \| `DESTINO_ALTERADO` \| `FALHA_LEITURA`. Precedência (quando não OK): falha de leitura, sem dado, não autorizado, destino alterado. Autorizado e sem dado no `cmn025` = `SEM_DADO_PAGAMENTO`, **sem** reaprovação. |
| **I14e** | **Onde roda e o efeito:** (1) `atualizarModalidadeItem` TED/PIX: **só aviso** no item (`autorizacaoAviso`) com atalho "pedir autorização", nunca retira; (2) `finalizarLote`: **autoritativa**, retira o item (I13j); (3) `gerarRemessa` (L8), **só enquanto não existe lote nativo no `fin015`**: barra o lote inteiro antes de qualquer escrita, erro nomeado por item; existindo lote nativo, vale o destino congelado (I10f); (4) aprovação (F2/F6) e "reconferir com o Conexos". `DESTINO_ALTERADO` em qualquer ponto dispara F4. |
| **I14f** | **Falha fechada:** `FALHA_LEITURA` não autoriza, não retira, não abre reaprovação; o item fica `verificacaoEstado = PENDENTE` (I13b) e L8 barra. |
| **I14g** | Revogar vale para lote ainda não importado no `fin015`; destino já congelado (I10f) segue o lote nativo, sem reescrita. |
| **I14h** | **Sem expiração.** |
| **I14i** | Dado de pagamento é só leitura no lote. Nenhum destino fora do `cmn025`; nada é escrito no `cmn025`. |
| **I14j** | **Trilha só-inclusão:** solicitado/confirmado, aprovado, rejeitado, reaprovação aberta (antes × agora mascarados), revogado, destino revelado, item retirado ou remessa barrada (com motivo). Nunca valor completo em log, ledger ou mensagem de erro (I10h). |
| **I14k** | TED/PIX **não é oferecido** enquanto esta guarda não estiver habilitada no tenant (flag = configuração). Nunca existe estado com TED/PIX e sem controle de troca de conta. |
| **I14l** | **Exibição:** destino sempre mascarado (banco e agência completos, conta com os 4 últimos dígitos; PIX com tipo e trecho), com o selo "igual ao Conexos (lido HH:MM) · igual ao aprovado em DD/MM por X" ou "diferente do aprovado". O valor completo só aparece pelo botão **"revelar"**, para quem tem `sispag:autorizar_favorecido`, em qualquer tela (inclusive a de aprovação), lido ao vivo do `cmn025` e auditado (I14j). |

## Erros nomeados (sugestão)

| Erro | Onde | HTTP |
|---|---|---|
| `PayeeNotAuthorizedAtRemittanceError` | `gerarRemessa` (L8), lista por item | 409 |
| `PayeeApprovalBySolicitorError` | F2/F6 por quem solicitou/confirmou | 403 |
| `PayeeReapprovalNotConfirmedError` | F6 sem `solicitadoPor` | 409 |
| `PayeeDestinationChangedSinceShownError` | F2/F6, fingerprint mostrado ≠ atual | 409 |
| `PayeeWithoutPaymentDataError` | F2/F6, `cmn025` sem dado | 422 |

## Ver também

`decisions/0065-*.md` · `entities/favorecido-autorizado.md` · `state-machines/favorecido-autorizado.md` ·
`business-rules/destino-pagamento-sispag.md` (I10) · `business-rules/verificacao-ted-pix-sispag.md` (I13)
