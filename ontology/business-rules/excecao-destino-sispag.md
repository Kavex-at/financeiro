---
name: excecao-destino-sispag
type: business-rule
entity: ExcecaoDestino
invariant: I12
ontology_version: "0.33.0"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/service/sispag/ExcecaoSubstituicaoService.ts
  - src/backend/domain/service/sispag/ExcecaoDestinoService.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/migrations/0075_sispag_excecao_destino.sql
  - src/backend/domain/libs/sispag/ExcecaoDestinoRule.test.ts
last_review: 2026-10-05
has_canonical_test: false
---

# Business Rule: exceção de destino SISPAG (I12)

> **Origem:** ADR-0061 (2026-10-05). Complementa `destino-pagamento-sispag` (I10): o cadastro do
> Conexos manda; a exceção é fallback aprovado por segunda pessoa. Cadastro ruim ou ausente é
> problema operacional da Columbia a corrigir no Conexos; a exceção é ponte.

| # | Regra |
|---|---|
| **I12a** | `ExcecaoDestino` é **por favorecido** (`pesCod`) e por tipo (`CONTA` \| `CHAVE_PIX`), reutilizável em qualquer lote. No máximo **1 `APROVADA` por (favorecido, tipo)**; nova aprovada move a anterior para `SUBSTITUIDA`. |
| **I12b** | **Dupla validação no backend, não só na UI:** `aprovadoPor ≠ cadastradoPor`, comparado pelo id do usuário autenticado. Permissão **única** `sispag:excecao` (cadastrar, aprovar, rejeitar, revogar); a separação de funções é só esta regra. Vale para TED e PIX. Violação: `ExcecaoAprovacaoProprioCadastranteError` / `ExcecaoSemPermissaoError`. |
| **I12c** | **Cadastro vence:** a exceção só entra na resolução se o cadastro não tem destino válido para a modalidade. Quando o cadastro passa a ter, a `APROVADA` vai a `SUBSTITUIDA` (automático, nunca usada). Valor do cadastro diferente do da exceção: evento `DIVERGENCIA_CADASTRO` na trilha (valores mascarados). Igual: só `SUBSTITUIDA`. |
| **I12d** | **Carga em planilha:** cria só `PENDENTE` (`origem = PLANILHA`, `cargaId`); nenhum caminho cria `APROVADA` direto. Regra de recarga: gap Q10 (proposta: linha idêntica ignorada; diferente = nova `PENDENTE`, a aprovada vigente segue valendo). |
| **I12e** | **Trilha só-inclusão** de todos os eventos (cadastro, aprovação, rejeição, revogação, substituição, divergência, uso): quem, quando, antes/depois mascarados na leitura e completos no banco; mesmo padrão e trigger de `lote_pagamento_item_destino_audit`. |
| **I12f** | **Falha fechada:** `finalizarLote` barra item TED/PIX sem destino resolvível (cadastro ou exceção `APROVADA`); o envio reconfere ao vivo (cadastro primeiro, depois exceção + I10i) antes do `criarLote`. `PENDENTE`/`REJEITADA`/`REVOGADA`/`SUBSTITUIDA` nunca resolvem. |
| **I12g** | Revogar vale para lotes ainda não importados no `fin015`; destino já congelado (I10f) segue o cancelamento do lote nativo, sem reescrita. |
| **I12h** | **Sem expiração.** A exceção aprovada vive até ser revogada ou substituída pelo cadastro. **Revogar:** qualquer pessoa com `sispag:excecao`, inclusive quem cadastrou. |
| **I12i** | **PIX só com chave CPF/CNPJ** igual ao `pdcDocFederal` do favorecido (I10i). Outros tipos de chave estão fora de escopo. Titularidade conferida no cadastro da exceção e de novo no envio. |

## Premissas e flags

H3/H5 (o `fin015` aceita destino sem `pctCodSeq`) seguem **não provadas**; `SISPAG_TED_ENABLED` e
`SISPAG_PIX_ENABLED` seguem desligadas por padrão. Nome da flag de exceção: gap Q6.

## Ver também

`decisions/0061-*.md` · `entities/excecao-destino.md` · `state-machines/excecao-destino.md` ·
`business-rules/destino-pagamento-sispag.md` · `_inbox/sispag-excecao-gap.md`
