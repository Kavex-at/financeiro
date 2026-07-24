---
name: NotaDebitoEletronica
type: entity
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
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
> emitida" — nunca emitir duas vezes). O contrato de emissão (endpoint/trigger no Conexos) é
> **confirmado na Fase 5**, junto do write O3. Ver `integrations/conexos.md` (superfície NDe).

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

## Fora de escopo (Fase 0 — SKELETON)

- Endpoint/trigger de emissão no Conexos, campos wire, formato do número da NDe: **Fase 5** (confirmar
  junto do write O3). Ver `integrations/conexos.md` (superfície de escrita NDe).
- A emissão idempotente e reversível é modelada na regra `business-rules/idempotencia-quitacao-nde.md`
  (skeleton) — spec completa na Fase 5.
</content>
</invoke>
