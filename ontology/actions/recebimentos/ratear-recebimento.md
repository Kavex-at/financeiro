---
name: ratearRecebimento
type: action
entity: Recebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
preconditions:
  - "Recebimento rascunho com match confiável (atribuirBaixa)."
postconditions:
  - "RateioRecebimento parcelas criadas (rascunho revisável) distribuindo valorRecebido por documentos/processos/componentes."
  - "Invariante do rateio garantido: Σ valorAlocado ≤ valorRecebido; toda parcela com finalidade; diferença não alocada registrada."
  - "Nenhuma escrita no ERP (I1) — rascunho local, revisável antes do confirm."
side_effects:
  - "Escrita LOCAL das parcelas de rateio + auditoria (mirror de permuta_alocacao)."
---

# ratearRecebimento — distribuir o valor recebido (Módulo 3) — SKELETON

> **SKELETON (Fase 0). Implementação = Fase 3 (Módulo 3).** Distribui o valor de um `Recebimento`
> sobre um ou mais `DocumentoAReceber` / processos / componentes, gerando parcelas
> `RateioRecebimento` — **rascunho revisável** antes do confirm, **espelhando o `permuta_alocacao`**
> da Frente I. Enforça o **invariante do rateio** (`business-rules/invariante-rateio.md`):
> `Σ valorAlocado ≤ valorRecebido`, toda parcela com finalidade, diferença não alocada registrada.
> Ver `entities/rateio-recebimento.md`.

## Regra (SKELETON — motor de distribuição na Fase 3)

- Distribui o `valorRecebido` por parcelas (`RateioRecebimento`), cada uma com `documento`,
  `finalidade` e `valorAlocado`.
- **Revisável:** a analista ajusta parcelas antes de aprovar o `Recebimento` (nada toca o ERP até a
  execução, Fase 5).
- **Balanço:** `Σ ≤ recebido`; sobra vira `diferencaNaoAlocada` no `Recebimento` (pode virar
  `CreditoCliente`, Fase 4).
- A estratégia concreta (greedy por saldo / por vencimento / por componente) é **Fase 3**.

## Por que está na ontologia (universalidade)

Universal: um crédito recebido raramente casa 1:1 com um único recebível — distribuí-lo por vários
documentos/componentes com saldo, de forma revisável e balanceada, é intrínseco à conciliação. A
estrutura (rascunho revisável + invariante de balanço + finalidade por parcela) é do domínio; a
heurística de distribuição é calibração.

## Fora de escopo (Fase 0 — SKELETON)

- Motor de distribuição, enum de componentes, interação com regras (multa/juros/encomenda): **Fase 3/4**.
