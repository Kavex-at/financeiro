---
name: invariante-rateio
type: business-rule
entity: Recebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Receb-1
related_files: []
last_review: 2026-07-24
has_canonical_test: false
---

# Regra: invariante-rateio (balanço da alocação do recebimento) — STUB (Fase 0/3)

> **Invariante I-Receb-1 — Balanço do rateio.** Para um `Recebimento`, a soma das parcelas alocadas
> **não pode exceder** o valor recebido; **toda parcela tem uma finalidade identificada**; e a
> **diferença não alocada é registrada explicitamente**. **STUB (Fase 0)** — o enunciado é travado
> agora (é invariante do domínio); o enforcement completo (teste canônico, tolerâncias) é **Fase 3**
> (motor de rateio). Ver `entities/recebimento.md` e `entities/rateio-recebimento.md`.

## Enunciado

```
Σ RateioRecebimento.valorAlocado ≤ Recebimento.valorRecebido
∀ parcela: parcela.finalidade ≠ ∅
Recebimento.diferencaNaoAlocada = valorRecebido − Σ valorAlocado   (registrada)
```

- **Σ ≤ recebido:** nunca alocar mais do que entrou (espelha o anti-super-pagamento de Permutas —
  não se distribui dinheiro que não existe).
- **Toda parcela com finalidade:** cada `RateioRecebimento` aponta explicitamente para que serve
  (documento/componente) — sem alocação "solta".
- **Diferença registrada:** a sobra (`valorRecebido − Σ`) é registrada no `Recebimento`
  (`diferencaNaoAlocada`) e pode virar `CreditoCliente` (Fase 4) — nunca é silenciosamente perdida.

## Human-in-the-loop / sem baixa incorreta

Ligado ao invariante transversal (ADR-0002): match/rateio incerto vai à fila manual; a analista
aprova antes de executar. O balanço é a rede que impede uma execução desbalanceada.

## Teste canônico (a escrever no TDD — Fase 3)

- `has_canonical_test: false` — casos: rateio exato (Σ = recebido, diferença 0); rateio parcial (Σ <
  recebido, diferença registrada); tentativa de Σ > recebido → **bloqueado**; parcela sem finalidade →
  **bloqueado**. Fixado pelo TaskScoper/TDD na Fase 3.

## Universalidade

Universal: um valor recebido só pode ser distribuído até o seu montante, com destino identificado e a
sobra registrada — invariante de qualquer contas-a-receber. A estrutura é do domínio; independe do tenant.
</content>
</invoke>
