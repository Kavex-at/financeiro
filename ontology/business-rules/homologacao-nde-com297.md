---
name: homologacao-nde-com297
type: business-rule
entity: NotaDebitoEletronica
ontology_version: "0.12"
implementation_status: partial
status: draft
owners: [yuri]
invariant: I-Receb-3
related_files:
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/service/recebimentos/ContingenciaDecider.ts
  - src/backend/domain/interface/recebimentos/HomologacaoNde.ts
  - src/backend/domain/errors/HomologacaoRejeitadaError.ts
  - src/backend/domain/errors/VldTpNfAusenteError.ts
  - src/backend/domain/errors/VldTpNfDesconhecidoError.ts
last_review: 2026-07-30
has_canonical_test: true
---

# Regra: homologacao-nde-com297 (homologação da NDe fiscal — 200≠sucesso + rota fail-loud)

> **Invariante I-Receb-3 — Uma homologação de NDe só conta como emitida quando o ERP confirma; a rota
> (normal × contingência) é decidida por `vldTpNf` de forma fail-loud; e a escrita é irreversível
> (nunca homologa 2×).** Implementada e testada; go-live gated (ver info-gaps).

## Contexto

A NDe *eletrônica* é homologada no `com297` (`POST com297/{homologaNfe|homologaNfeContingencia}/{docCod}`,
body `{}`). O controller Angular original toma **três** decisões que a automação precisa replicar — e
duas delas **falham inseguras** no UI. Esta regra fixa o comportamento **seguro**.

## R1 — HTTP 200 ≠ sucesso (branch obrigatório em `docVldComvalidacoes`)

O corpo carrega `docVldComvalidacoes`; o `customizedSuccess: true` do controller suprime o toast
"tudo certo" default justamente p/ permitir distinguir:

- `1` → **emitida** (sucesso limpo).
- `2` → **emitida com aviso** (homologada, mas validações pendentes — abre com194, mostra *aviso*, não
  sucesso). Registrar o aviso; a NDe está emitida.
- qualquer outro → **RECUSA** (`HomologacaoRejeitadaError`, `motivo=validacao`). **Nunca** marcar um
  200 como concluído — isso marcaria homologações falhas como sucesso.

## R2 — Rota por `vldTpNf`, fail-loud (invertendo o predicado do UI)

Fonte: `finDocIsContingenciaHomologacao` = `["11","12"].indexOf(o.finDoc.vldTpNf) !== -1`. É uma função
pura de um campo, mas **falha aberta** (sem `finDoc` → `undefined` → normal) e roteia **qualquer** valor
não-`{11,12}` p/ normal. Invertemos:

| `vldTpNf` (normalizado a string) | Rota | Erro |
|---|---|---|
| `"11"` | contingência (aviso DPEC) | — |
| `"12"` | contingência (aviso SCAN) | — |
| ∈ allowlist normal (`NDE_NORMAL_TP_NF_CONHECIDOS`) | normal (`homologaNfe`) | — |
| ausente / vazio | — | **`VldTpNfAusenteError`** (não herda o silent-normal do UI) |
| qualquer outro | — | **`VldTpNfDesconhecidoError`** (recusa + alerta) |

- **String estrita:** um `11` numérico de payload não casa o whitelist de strings → normalize no
  boundary (`normalizeVldTpNf`); não deixe o deserializador decidir o tipo.
- **Decidida no POST-time:** a rota sai de `vldTpNf` no momento da chamada; passe o valor decidido e
  deixe o servidor rejeitar divergência — não deixe um read velho escolher o endpoint.
- O aviso DPEC/SCAN (`"11" → DPEC`, `"12" → SCAN`) **só** muda o texto do dialog, **não** a rota.

## R3 — Escrita irreversível (nunca homologa 2×)

- `postGenericOnce` (tentativa única, sem 401-retry) — um re-POST poderia homologar 2×.
- Erros **não-retryable** (validação **e** upstream) → o retry do pipeline nunca re-POSTa; falha
  fecha-se (fail-closed) e reconcilia pelo ledger write-ahead, que recusa re-emitir uma NDe já
  `emitida` (`business-rules/idempotencia-quitacao-nde.md`, `idempotencyKey` UNIQUE por `Recebimento`).

## Teste canônico

`ConexosNdeClient.test.ts` (branch dos 3 casos de `docVldComvalidacoes`, verbo por rota, `postGenericOnce`
única, upstream fail-closed) + `ContingenciaDecider.test.ts` (whitelist/allowlist/ausente/desconhecido,
normalização string) + `ConexosNdeEmitter.test.ts` (fallback pendente, dry-run, emitida, fail-loud).

## Fora de escopo / info-gaps

- **SEED de `NDE_NORMAL_TP_NF_CONHECIDOS`** a partir da distribuição real de `vldTpNf` (P0 gate-before-
  live). Vazio hoje → docs normais são **recusados** de propósito (a regra é uma *assertion*, não uma
  *assumption*). Ver `_inbox/recebimentos-nde-com297-gap.md`.
- Enum completo de `docVldComvalidacoes` + campo exato do `numeroNde` — confirmar no HAR.
