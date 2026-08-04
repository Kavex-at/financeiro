---
name: RegraRecebimento
type: entity
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - tipo
  - versao
  - vigenteDe
  - vigenteAte
  - parametros
  - explicacao
  - ativo
relationships:
  - "RegraRecebimento 1—N Recebimento (uma regra versionada é aplicada a N recebimentos, com rationale registrado no Recebimento)"
last_review: 2026-07-24
universality_evidence:
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1 + Eixo 3: RegraRecebimento (configurável, versionada, explicável); modelagem profunda DEFERIDA à Fase 4"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §4 / Fase 4 — motor de regras configurável+versionado (encomenda / adiantamento-cliente / multa-juros)"
  - "Conceito universal de financeiro: regras de negócio de conciliação (percentuais, separação de multa/juros, tratamento de adiantamento) variam por cliente e mudam no tempo — precisam ser configuráveis, versionadas e auditáveis"
---

# RegraRecebimento (regra de conciliação configurável e versionada) — SKELETON

> **SKELETON (Fase 0) — só a forma; modelagem profunda DEFERIDA à Fase 4.** Uma `RegraRecebimento` é
> uma **regra de negócio de conciliação** — encomenda (0,1% / 0,9%), adiantamento de cliente,
> separação de multa/juros — que é **configurável**, **versionada** e **explicável** (invariante do
> Eixo 3). Cada decisão de regra aplicada a um `Recebimento` carrega um **rationale registrado**
> (auditoria). As três regras concretas serão modeladas **cada uma em seu próprio OfficeHours** na
> Fase 4 (ver os stubs em `business-rules/`).

## Por que é entidade (e não só código de regra)

As regras variam por cliente e mudam no tempo (uma alíquota muda, um critério é refinado). Modelar a
regra como **entidade versionada** — não como constante hardcoded — permite: (1) **configurar** o
valor por tenant; (2) **versionar** (uma execução antiga cita a versão que aplicou); (3) **explicar**
(o rationale de cada aplicação). É a estrutura que a torna auditável — a mesma doutrina de
"estrutura na ontologia, valores em config do cliente" já aplicada em `ClienteFiltro`.

## Distinção — estrutura (ontologia) × valores (config do cliente)

A **estrutura** (uma regra tem tipo, versão, vigência, parâmetros, explicação) é do domínio e vive na
ontologia. Os **valores** (quais percentuais, quais contas de destino, qual critério de identificação)
são **config do cliente** (Columbia) e serão fixados na Fase 4. Ver os stubs:
`business-rules/encomenda-percentuais.md`, `business-rules/adiantamento-cliente.md`,
`business-rules/separacao-multa-juros.md`.

## Propriedades (SKELETON — spec completa na Fase 4)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `id` | string (uuid) | `regra_recebimento.id` | Identidade da regra. |
| `tipo` | enum | `regra_recebimento.tipo` | `ENCOMENDA \| ADIANTAMENTO_CLIENTE \| MULTA_JUROS \| …` — enum na Fase 4. |
| `versao` | number | `regra_recebimento.versao` | Versão da regra (uma execução cita a versão aplicada). |
| `vigenteDe` | Date | `regra_recebimento.vigente_de` | Início da vigência (regra muda no tempo). |
| `vigenteAte` | Date? | `regra_recebimento.vigente_ate` | Fim da vigência (`null` = vigente). |
| `parametros` | json | `regra_recebimento.parametros` | Valores configuráveis (percentuais, contas, critérios) — **config do cliente**. |
| `explicacao` | string | `regra_recebimento.explicacao` | Texto explicável do que a regra faz (base do rationale). |
| `ativo` | boolean | `regra_recebimento.ativo` | Regra ligada/desligada. |

## Fora de escopo (Fase 0 — SKELETON)

- **Toda a semântica das 3 regras** (encomenda %, adiantamento de cliente, multa/juros): **Fase 4**,
  um OfficeHours por regra. Este arquivo modela apenas que existe uma entidade de regra
  **configurável + versionada + explicável**; nenhuma alíquota, conta ou critério é fixado aqui.
