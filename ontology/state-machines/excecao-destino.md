---
name: excecao-destino
type: state-machine
entity: ExcecaoDestino
ontology_version: "0.1"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts
  - src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts
  - src/backend/migrations/0075_sispag_excecao_destino.sql
last_review: 2026-10-05
---

# State machine: ExcecaoDestino (ADR-0061)

Estados: `PENDENTE`, `APROVADA`, `REJEITADA`, `SUBSTITUIDA`, `REVOGADA`. Terminais:
`REJEITADA`, `SUBSTITUIDA`, `REVOGADA`. Só `APROVADA` resolve destino; `PENDENTE` nunca é usada no
envio. Todas as transições exigem `sispag:excecao` e gravam evento na trilha só-inclusão.

| # | Transição | Ação | Guarda / efeito |
|---|---|---|---|
| E1 | `(novo) → PENDENTE` | `registrarExcecaoDestino` (manual) / `carregarExcecoesDestinoPlanilha` (lote) | Formato (`DestinoManualValidator`); titularidade I10i lida ao vivo; PIX só chave CPF/CNPJ. Nunca nasce `APROVADA`. |
| E2 | `PENDENTE → APROVADA` | `aprovarExcecaoDestino` | I12b: aprovador ≠ cadastrante (id do usuário autenticado). Reconfere I10i. Move a `APROVADA` anterior do mesmo (favorecido, tipo) para `SUBSTITUIDA`. |
| E3 | `PENDENTE → REJEITADA` | `rejeitarExcecaoDestino` | Qualquer pessoa com `sispag:excecao` (o cadastrante pode retirar a própria); motivo obrigatório. |
| E4 | `APROVADA → SUBSTITUIDA` | `aposentarExcecoesSubstituidas` ou E2 de outra exceção | Cadastro passou a ter destino válido (I12c) ou nova aprovada. Se o valor do cadastro difere, evento `DIVERGENCIA_CADASTRO`. |
| E5 | `APROVADA → REVOGADA` | `revogarExcecaoDestino` | **Qualquer** pessoa com `sispag:excecao`, inclusive quem cadastrou; motivo obrigatório. Sem expiração: não há transição por tempo. |

Vale para lotes ainda não importados no `fin015`; destino já congelado (I10f) segue o regime do
lote nativo (I12g).
