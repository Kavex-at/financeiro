---
name: Recebimento
type: entity
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - correlationId
  - transacaoBancariaId
  - filCod
  - classificacaoMatch
  - status
  - valorRecebido
  - valorAlocado
  - diferencaNaoAlocada
  - regrasAplicadas
  - rateios
  - resultadoExecucao
  - ndeId
  - versao
  - criadoPor
  - aprovadoPor
  - executadoPor
  - estornadoPor
  - criadoEm
relationships:
  - "Recebimento 1—1 TransacaoBancaria (via transacaoBancariaId — o crédito que originou a conciliação)"
  - "Recebimento 1—N DocumentoAReceber (os recebíveis baixados por esta conciliação)"
  - "Recebimento 1—N RateioRecebimento (agregado — as parcelas de alocação, revisáveis antes do confirm)"
  - "Recebimento 1—N RegraRecebimento (as regras versionadas aplicadas, com rationale)"
  - "Recebimento 1—1 NotaDebitoEletronica (a NDe emitida na execução, quando aplicável)"
last_review: 2026-07-24
universality_evidence:
  - "docs-contexto/03_ontologia_financeiro.md — Frente IV: a conciliação de recebimento é o agregado que liga crédito↔recebível↔rateio↔execução"
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1: Recebimento (agregado de reconciliação; rascunho→aprovado→executado→estornado)"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §4 — Recebimento é o agregado da reconciliação (mirror do LotePagamento do SISPAG)"
  - "Conceito universal de financeiro: a conciliação de um crédito recebido contra recebíveis, revisada por um humano e executada com auditoria, é o núcleo de qualquer contas-a-receber assistida"
---

# Recebimento (agregado de conciliação — Frente IV)

> **SKELETON (Fase 0).** Um `Recebimento` é o **agregado de reconciliação**: liga um crédito
> (`TransacaoBancaria`) a um ou mais `DocumentoAReceber`, carrega a **classificação do match**, o
> **rateio** (`RateioRecebimento`), as **regras aplicadas** (`RegraRecebimento`) e o **resultado da
> execução** (borderô + quitação + NDe). É o **espelho inbound do `LotePagamento`** (agregado local
> persistido, montado/revisado pelo analista antes de qualquer efeito no ERP). Ciclo de vida:
> **rascunho → aprovado → executado → estornado** (ver `state-machines/recebimento.md`).

## Definição de domínio

O `Recebimento` é a **raiz de consistência** da conciliação: as invariantes (Σ alocado ≤ valor
recebido; toda parcela com finalidade; execução idempotente e reversível) são garantidas na fronteira
do agregado. Ele nasce **rascunho** (após o matching e o rateio), é **aprovado** pela analista
(*human-in-the-loop*, ADR-0002), **executado** (baixa no ERP + emissão da NDe, gated e idempotente) e
pode ser **estornado** (undo controlado — estorno bancário, erro operacional, conciliação incorreta).

É um **agregado LOCAL persistido** (banco próprio), não do ERP — espelha a doutrina do
`LotePagamento` (rascunho persistido que sobrevive à re-leitura) e da alocação de Permutas.

## Propriedades (SKELETON)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `id` | string (uuid) | `recebimento.id` | Identidade da conciliação. |
| `correlationId` | string | `recebimento.correlation_id` | Propagado da `TransacaoBancaria` — rastreio ponta-a-ponta (Módulo 6). |
| `transacaoBancariaId` | string (uuid) | `recebimento.transacao_id` | FK → o crédito conciliado. |
| `filCod` | number | `recebimento.fil_cod` | **Invariante multi-filial** — filial do crédito/recebíveis. Nunca `null`. |
| `classificacaoMatch` | enum | `recebimento.classificacao_match` | `unica \| multiplas \| parcial \| nenhuma` — resultado do `atribuirBaixa`. `nenhuma`/incerto → fila manual. |
| `status` | enum | `recebimento.status` | `rascunho \| aprovado \| executado \| estornado` — constantes tipadas. Ver `state-machines/recebimento.md`. |
| `valorRecebido` | number | `recebimento.valor_recebido` | Valor do crédito (do movimento) — teto do rateio. |
| `valorAlocado` | number | derivado (Σ rateios) | Soma alocada nos recebíveis (invariante: `≤ valorRecebido`). |
| `diferencaNaoAlocada` | number | derivado | `valorRecebido − valorAlocado` — **registrada explicitamente** (invariante do rateio). Pode virar `CreditoCliente` (Fase 4). |
| `regrasAplicadas` | RegraRecebimento[] | join | As regras versionadas aplicadas + rationale (Fase 4). |
| `rateios` | RateioRecebimento[] | join | As parcelas de alocação (agregado). |
| `resultadoExecucao` | json? | `recebimento.resultado_execucao` | Confirmação do ERP (borderô/quitação) + NDe. `null` enquanto não executado. |
| `ndeId` | string? (uuid) | FK → `NotaDebitoEletronica` | A NDe emitida na execução (quando aplicável). `null` até executar. |
| `versao` | number | `recebimento.versao` | Controle otimista de concorrência (espelha o I6 do lote). |
| `criadoPor` | string | `recebimento.criado_por` | Auditoria. |
| `aprovadoPor` | string? | `recebimento.aprovado_por` | Quem aprovou (gate human-in-the-loop). `null` enquanto rascunho. |
| `executadoPor` | string? | `recebimento.executado_por` | Quem disparou a execução. |
| `estornadoPor` | string? | `recebimento.estornado_por` | Quem estornou (quando aplicável). |
| `criadoEm` | Date | `recebimento.criado_em` | Timestamp de criação. |

## Invariantes aplicáveis (SKELETON — spec completa na Fase 3/5)

- **Human-in-the-loop:** o `Recebimento` só sai de `rascunho` por aprovação humana (ADR-0002). Match
  incerto nunca vira baixa automática (ver `business-rules/invariante-rateio.md` e a fila manual).
- **Balanço do rateio:** `Σ valorAlocado ≤ valorRecebido`; toda parcela tem finalidade; a diferença
  não alocada é registrada. Ver `business-rules/invariante-rateio.md`.
- **Execução idempotente + reversível:** um retry nunca produz duas quitações nem duas NDe; o estorno
  é controlado. Ver `business-rules/idempotencia-quitacao-nde.md`.
- **Auditoria + correlation id** ponta-a-ponta (Nexxera → quitação → NDe).

## Distinção — inbound (esta) × outbound (`LotePagamento`)

`Recebimento` concilia **dinheiro que entrou** contra recebíveis; `LotePagamento` (SISPAG) agrupa
**obrigações a pagar** para remessa. Espelham-se em forma (agregado local, revisável, gate humano,
auditoria, concorrência otimista) mas correm em direções opostas. Ver `entities/lote-pagamento.md`.

## Fora de escopo (Fase 0 — SKELETON)

- Motor de matching (Fase 2), motor de rateio (Fase 3), motor de regras (Fase 4), execução/baixa + NDe
  (Fase 5). Este arquivo modela a **forma** do agregado; as regras profundas são fatias próprias.
</content>
</invoke>
