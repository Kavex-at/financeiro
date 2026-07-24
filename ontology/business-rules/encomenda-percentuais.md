---
name: encomenda-percentuais
type: business-rule
entity: RegraRecebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
has_canonical_test: false
---

# Regra: encomenda-percentuais (0,1% / 0,9%) — STUB (Fase 4)

> **STUB (Fase 0) — spec completa na Fase 4 (OfficeHours próprio).** A conciliação de recebimento
> aplica percentuais de **encomenda** (0,1% e 0,9%) sobre uma base a definir. Esta regra é uma
> instância de `RegraRecebimento` (configurável + versionada + explicável). **Nada de semântica é
> fixado aqui** — só o registro de que a regra existe e será modelada.

## O que falta definir (Fase 4)

- **Base de cálculo** de cada percentual (sobre o quê incide 0,1% × 0,9%).
- **Significado** de cada percentual (o que representam).
- **Contas/documentos de destino** de cada parcela.
- **Política de arredondamento**.

## Onde atua

Aplicada em `aplicarRegrasRecebimento` (Módulo 4) sobre as parcelas de `RateioRecebimento`; cada
decisão carrega rationale + versão da regra. Ver `entities/regra-recebimento.md`.

## Universalidade (provisória)

Percentuais de encomenda/serviço sobre valores recebidos são comuns em contas-a-receber de trading; a
**estrutura** (regra versionada + rationale) é do domínio, os **valores** (0,1% / 0,9%, base, contas)
são config do cliente Columbia — a confirmar na Fase 4.
</content>
</invoke>
