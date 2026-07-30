---
name: aplicarRegrasRecebimento
type: action
entity: Recebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
preconditions:
  - "Recebimento rascunho com rateio (ratearRecebimento)."
  - "RegraRecebimento configuradas e versionadas (Fase 4)."
postconditions:
  - "Regras aplicadas sobre o rateio (encomenda %, adiantamento-cliente, multa/juros)."
  - "Cada decisão de regra carrega um rationale registrado (explicável + auditável)."
  - "Versão da regra aplicada fica citada no Recebimento."
  - "Nenhuma escrita no ERP (I1) — ajusta o rascunho local."
side_effects:
  - "Escrita LOCAL: parcelas/componentes ajustados + rationale por decisão."
---

# aplicarRegrasRecebimento — regras de negócio (Módulo 4) — SKELETON

> **SKELETON (Fase 0). Implementação = Fase 4 (Módulo 4) — OfficeHours-heavy, uma entrevista por
> regra.** Aplica as `RegraRecebimento` **configuráveis + versionadas + explicáveis** sobre o rateio:
> encomenda (0,1% / 0,9%), adiantamento de cliente (→ `CreditoCliente`), separação de multa/juros.
> Cada decisão carrega um **rationale registrado** (auditoria). As três regras concretas são
> modeladas cada uma no seu OfficeHours na Fase 4 — ver os stubs em `business-rules/`. Ver
> `entities/regra-recebimento.md`.

## Regras a aplicar (STUBS — Fase 4)

- `business-rules/encomenda-percentuais.md` — 0,1% / 0,9% (base, significado, contas, arredondamento).
- `business-rules/adiantamento-cliente.md` — identificação + ciclo do `CreditoCliente`.
- `business-rules/separacao-multa-juros.md` — informado × calculado, destino por parcela, divergência.

## Invariante (SKELETON)

- **Explicável + versionada:** toda decisão de regra cita a **versão** aplicada e um **rationale**
  (por que aquele valor/conta). É a base da auditabilidade (Eixo 3 da entrevista).

## Por que está na ontologia (universalidade)

Universal: aplicar regras de negócio configuráveis e auditáveis sobre a conciliação (percentuais,
tratamento de adiantamento, multa/juros) existe em qualquer contas-a-receber; os **valores** variam por
cliente. A estrutura (motor de regras versionado + rationale) é do domínio; as alíquotas/contas/critérios
são config do cliente (Fase 4).

## Fora de escopo (Fase 0 — SKELETON)

- **Toda a semântica das 3 regras** (alíquotas, contas de destino, critérios): **Fase 4**.
