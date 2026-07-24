---
name: separacao-multa-juros
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

# Regra: separacao-multa-juros — STUB (Fase 4)

> **STUB (Fase 0) — spec completa na Fase 4 (OfficeHours próprio).** Um recebimento pode conter
> **multa** e **juros** além do principal; a conciliação precisa **separar** esses componentes e
> destiná-los corretamente. Esta regra é uma instância de `RegraRecebimento`. **Nada é fixado aqui.**

## O que falta definir (Fase 4)

- **Informado × calculado:** a multa/juros vem informada (no crédito/documento) ou é **calculada**
  (por atraso/taxa)?
- **Destino por parcela:** para onde vai cada componente (principal × multa × juros) no rateio/baixa.
- **Divergência esperado × pago:** como tratar quando o valor recebido diverge do esperado.

## Onde atua

Aplicada em `aplicarRegrasRecebimento` (Módulo 4); os componentes viram `componente` nas parcelas de
`RateioRecebimento` (`PRINCIPAL | MULTA | JUROS`). Ver `entities/rateio-recebimento.md`.

## Universalidade (provisória)

Separar principal/multa/juros de um recebimento é universal em contas-a-receber. A estrutura
(componentes na parcela + regra versionada) é do domínio; a política (informado × calculado, contas de
destino, tolerância de divergência) é config/decisão da Columbia, a confirmar na Fase 4.
</content>
</invoke>
