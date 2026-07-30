---
name: NotaDebitoEletronica
type: entity
ontology_version: "0.12"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/service/recebimentos/ConexosNdeEmitter.ts
  - src/backend/domain/service/recebimentos/ContingenciaDecider.ts
  - src/backend/domain/interface/recebimentos/HomologacaoNde.ts
  - src/backend/domain/interface/recebimentos/NotaDebitoEletronica.ts
properties:
  - id
  - recebimentoId
  - filCod
  - correlationId
  - numeroNde
  - valor
  - moeda
  - statusEmissao
  - idempotencyKey
  - erpResponse
  - emitidaEm
  - emitidaPor
relationships:
  - "NotaDebitoEletronica 1—1 Recebimento (via recebimentoId — a NDe é o artefato terminal de uma conciliação executada)"
  - "NotaDebitoEletronica N—1 Filial (via filCod)"
last_review: 2026-07-24
universality_evidence:
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1 + Decisão 1 (Yuri, 2026-07-24): NDe é EMITIDA pelo Conexos ERP (não sistema fiscal separado, não auto-gerada)"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §1 / Fase 5 — a NDe é o output terminal do Módulo 5 (borderô + quitação + emitir NDe)"
  - "Conceito de negócio Columbia: a Nota de Débito Eletrônica é o artefato que fecha a conciliação de recebimento (a automação foi originalmente enquadrada como 'automatizar a NDe')"
---

# NotaDebitoEletronica (NDe — artefato terminal da conciliação)

> **SKELETON (Fase 0).** A `NotaDebitoEletronica` (NDe) é o **artefato terminal** de um `Recebimento`
> executado — **emitida pelo Conexos ERP** (decisão Yuri, 2026-07-24): **não** é um sistema fiscal
> separado, **não** é auto-gerada por nós. Modelamos a NDe como (1) uma **ação disparada no ERP**
> (`executarRecebimento` chama a emissão) e (2) um **registro local** para **idempotência** ("já
> emitida" — nunca emitir duas vezes).

> **⚠️ Atualização (2026-07-30, ADR-0024) — canal FISCAL pinado ao com297.** O contrato de emissão
> ficou concreto e **corrige** a suposição do plano §8.B ("NDe = com299 `docVldTipo=7`"). A NDe
> **eletrônica** é um **documento fiscal de SAÍDA gerado no `com297`** (Fiscais de Saída) e
> **HOMOLOGADO** (autorização SEFAZ) — é a homologação que a torna *eletrônica*. O `com299`
> (`docVldTipo=7` / Solicitação de Numerário) é a leg **FINANCEIRA** que a *precede*, não a NDe fiscal.
> O passo **TERMINAL contratado** desta fatia é a **homologação** — ver
> `integrations/conexos-com297-homologacao.md` e `business-rules/homologacao-nde-com297.md`. A leg de
> **GERAÇÃO** do documento com297 (produto `41978` / número `0` / tipo de nota de débito "Pagamento
> antecipado" / observações) ainda é **UI-only** no docx (info-gap — mints o `docCod`).

**Cadeia real (docx):** `com299` (doc financeiro do adiantamento) → `fin014` (baixa) → **`com297`
(gerar doc fiscal + homologar) = NDe eletrônica**.

## Definição de domínio

A NDe fecha a conciliação: uma vez o `Recebimento` aprovado, rateado e a baixa/quitação registrada no
ERP, o ERP **emite a NDe**. O usuário enquadrou o objetivo do projeto como "automatizar a NDe" — mas a
NDe é o **último passo** de um pipeline de conciliação de 6 módulos, não um artefato isolado (ver
`ontology/_inbox/frente-iv-recebimentos-nde-plan.md §1`).

O registro local existe **só para idempotência e auditoria**: a fonte da verdade da NDe é o ERP. Uma
re-execução do `Recebimento` (retry) **não** pode emitir uma segunda NDe — garantido pela
`idempotencyKey` e pela regra `business-rules/idempotencia-quitacao-nde.md`.

## Propriedades (SKELETON — wire/contrato a confirmar na Fase 5)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `id` | string (uuid) | `nota_debito_eletronica.id` | Identidade local. |
| `recebimentoId` | string (uuid) | `nota_debito_eletronica.recebimento_id` | FK → o `Recebimento` que a originou (1:1). |
| `filCod` | number | `nota_debito_eletronica.fil_cod` | Filial. Nunca `null`. |
| `correlationId` | string | `nota_debito_eletronica.correlation_id` | Propagado do `Recebimento`/`TransacaoBancaria` — fecha o rastro ponta-a-ponta (Módulo 6). |
| `numeroNde` | string? | ERP (retorno da emissão) | Número da NDe atribuído pelo Conexos. `null` até emitir. |
| `valor` | number | `nota_debito_eletronica.valor` | Valor da NDe. |
| `moeda` | string | `nota_debito_eletronica.moeda` | Moeda. |
| `statusEmissao` | enum | `nota_debito_eletronica.status_emissao` | `pendente \| emitida \| erro` — write-ahead (espelha `permuta_alocacao_execucao`). |
| `idempotencyKey` | string | `nota_debito_eletronica.idempotency_key` | UNIQUE — garante uma NDe por `Recebimento`. Ver `idempotencia-quitacao-nde`. |
| `erpResponse` | json? | `nota_debito_eletronica.erp_response` | Resposta crua do ERP (auditoria). |
| `emitidaEm` | Date? | `nota_debito_eletronica.emitida_em` | Timestamp da emissão confirmada. |
| `emitidaPor` | string? | `nota_debito_eletronica.emitida_por` | Ator/execução que disparou. |

## Contrato de HOMOLOGAÇÃO (2026-07-30, ADR-0024) — passo terminal

A **homologação** (autorização do documento fiscal) está **implementada e testada**, live-capable e
gated OFF:

- `POST com297/{verbo}/{docCod}`, body `{}` — `docCod` no **PATH**. `verbo ∈ {homologaNfe,
  homologaNfeContingencia}`, decidido por `vldTpNf` (`ContingenciaDecider`).
- **HTTP 200 ≠ sucesso** — branch obrigatório em `docVldComvalidacoes` (`1` emitida / `2` emitida-com-
  aviso / `default` **recusa**). Ver `business-rules/homologacao-nde-com297.md`.
- Escrita fiscal **irreversível** → `postGenericOnce` (sem 401-retry) + erros **não-retryable** (fail-
  closed). Idempotência: uma NDe por `Recebimento` (`idempotencyKey` UNIQUE +
  `business-rules/idempotencia-quitacao-nde.md`).
- **`numeroNde`** atribuído na homologação (campo wire exato = best-effort, `docEspNumero` —
  confirmar no HAR).

## Fora de escopo (ainda) — info-gaps (`_inbox/recebimentos-nde-com297-gap.md`)

- **Leg de GERAÇÃO com297** (mints o `docCod`): endpoints de gerar-documento (produto `41978`, número
  `0`), setar "Tipo de nota de débito = Pagamento antecipado" (Mais Ações → Fiscal) e gerar-
  observações — hoje só **UI** no docx. Enquanto ausente, `ConexosNdeEmitter` cai no fallback
  `pendente` (o pipeline nunca quebra) e o token `NDE_EMITTER_TOKEN` segue no stub.
- **Seed** de `NDE_NORMAL_TP_NF_CONHECIDOS` a partir da distribuição real de `vldTpNf` (P0 gate-before-
  live) — enquanto vazio, docs normais são **recusados** de propósito (fail-loud).
