---
name: Invoice
type: entity
ontology_version: "0.4"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosClient.ts
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
  - src/backend/domain/service/permutas/AlocacaoPermutasService.ts
  - src/backend/domain/service/permutas/IngestaoPermutasService.ts
  - src/backend/domain/repository/permutas/PermutaRelationalRepository.ts
  - src/backend/migrations/0009_invoice_taxa.sql
  - src/backend/migrations/0017_invoice_importador.sql
properties:
  - docCod
  - priCod
  - dataEmissao
  - valor
  - moeda
  - pago
  - exportador
  - valorAbertoNegociado
  - pesCod
  - importador
relationships:
  - "Invoice N—1 Adiantamento (mesmo priCod; casamento via casarInvoice)"
  - "Invoice 1—1 PermutaCandidata (lado-crédito da candidata, quando casada)"
  - "Invoice 1—N Permuta (lado-crédito da alocação; pode ser cross-process, ADR-0008)"
last_review: 2026-06-24
universality_evidence:
  - "docs/proposta/Proposta_Kavex_Columbia_Financeiro.md — Frente I (adiantamento ↔ invoice)"
  - "docs-contexto/03_ontologia_financeiro.md §2 Frente I"
  - "ontology/glossary.md — 'Invoice / Fatura'"
  - "Columbia (priCod=1153): com298 tpdCod=128"
  - "Conceito universal de comex: fatura definitiva do exportador (lado-crédito)"
  - "ADR-0010 — valorAbertoNegociado é o TETO do lado-crédito no auto-casamento Simples"
  - "ADR-0014 — importador (cliente) hidratado via imp021 em TODAS as invoices; universo completo de invoices finalizadas"
---

# Invoice (Fatura)

> **Lado-crédito** da permuta: a fatura definitiva emitida pelo exportador, contra a
> qual o `Adiantamento` é reconciliado. É o documento INVOICE finalizado no Conexos.

## Definição de domínio

Uma `Invoice` é o documento financeiro definitivo do mesmo **processo** (`priCod`) do
`Adiantamento`. A permuta consiste em casar um adiantamento (débito) com sua invoice
(crédito). Nesta Fatia 1 só **lemos** a invoice e verificamos se há uma "casada" para o
processo — não há baixa/reconciliação.

## Propriedades

| Propriedade | Tipo | Imutável | Origem (wire) | Notas |
|-------------|------|----------|---------------|-------|
| `docCod` | string | sim | `com298.docCod` | Identidade do documento. |
| `priCod` | string | sim | `com298.priCod` | Código do processo — chave de casamento com o Adiantamento. |
| `dataEmissao` | Date | sim | `com298.docDtaEmissao` | Data de emissão. |
| `valor` | number | não | `com298.docMnyValor` | Valor de face (entrada do cálculo de variação cambial). |
| `moeda` | string | sim | `com298.moeEspSigla` | Moeda. |
| `pago` | boolean | não | derivado: `Σ titMnyValor − Σ titMnyTotPago === 0` (com308) | Estado de pagamento — **discrimina a aba "Invoices em aberto"** (`WHERE NOT stale AND NOT pago`). **NÃO** vem da row do `com298/list`: ali os agregados de título são `null` em 1146/1146 INVOICEs (sonda `probe-invoice-pago`, 2026-08-28), o que fazia o filtro ser no-op e a aba exibir invoices liquidadas. Regra estrita, sem epsilon (decisão `residual-pago-centavos`). Sem prova (com308 falhou / título sem os campos) → `false` conservador: a invoice segue visível. |
| `exportador` | string? | não | `com298.dpeNomPessoa` | Exibição. |
| `valorAbertoNegociado` | number? | não | `getDetalheTitulos` → `mnyTitAberto / taxaInvoice` | **Em-aberto vivo** em moeda negociada (USD) — o **TETO** do lado-crédito no auto-casamento Simples (ADR-0010). Fallback `valorMoedaNegociada`; ausente ⇒ sem teto (comportamento legado). |
| `pesCod` | string? | não | `imp021` (processo) → `permuta_invoice.pes_cod` | **Chave do importador (cliente)** do processo da invoice — hidratado na ingestão via `imp021` para TODAS as invoices (ADR-0014, migration `0017`). |
| `importador` | string? | não | `imp021` (processo) → `permuta_invoice.importador` | **Nome do importador (cliente)** — habilita busca/contagem de invoices por cliente no universo completo. Quando a invoice não tem importador próprio, a apresentação cai no join por processo (adto), `GestaoPermutasService.ts:138-142`. |

## Discriminador de tipo (INVOICE)

- `tpdCod = 128` (`TPD_INVOICE`) + `vldStatus = '3'` (FINALIZADO).

## Definição de "INVOICE casada" (P0-6 + P0-5 — RESOLVIDO)

- **"casada" = exatamente 1 INVOICE FINALIZADA no processo.**
  - **0** invoices → `PermutaCandidata` **bloqueada** (motivo `sem-invoice`, aguardando emissão).
  - **>1** invoices → caso **N:M** → **bloqueada** (motivo `composto-nm`); N:M é frequente mas
    vai para **backlog** nesta fatia (não processado). Ver `actions/casar-invoice.md`,
    `business-rules/elegibilidade-permuta.md` e a taxonomia de motivos na state-machine.

## Fonte de leitura (Conexos)

- `ConexosClient.listFinanceiroAPagar({ docTip: 'INVOICE', priCods: [proc], filCod })` → `tpdCod=128`, FINALIZADO.
- `getDetalheTitulos` → `mnyTitAberto` (BRL) ÷ `taxaInvoice` = `valorAbertoNegociado` (em-aberto vivo,
  hidratado na eleição por `EleicaoPermutasService.computeVariacao`).
- **Universo completo (ADR-0014):** `ConexosClient.listInvoicesFinalizadas({ filCod })`
  (`src/backend/domain/client/ConexosClient.ts:709+`, `tpdCod=128`, `vldStatus IN finalizado`) lista
  **TODAS** as invoices finalizadas da filial — não só as de processos com adiantamento. A ingestão
  hidrata valor/taxa negociada (com308) e o importador (imp021) de cada uma
  (`EleicaoPermutasService.computeCandidatas.todasInvoices`, `:213-313`;
  `IngestaoPermutasService.toInvoiceRows`, `:282-347`). Cap-hit de paginação é logado (Regis-Review
  2026-06-24-2011, Integrability P1).

## Cliente (importador) — busca por cliente (ADR-0014)

O **importador** (cliente Columbia) do processo é hidratado via `imp021` para **todas** as invoices
(migration `0017_invoice_importador.sql`: colunas `pes_cod` + `importador`). Habilita a busca/contagem
de invoices por cliente em todas as abas e no detalhe. O adto tem o importador; a invoice não tinha —
agora ela carrega o seu, e a apresentação prefere o da própria invoice, caindo no join por processo
quando ausente (`GestaoPermutasService.ts:138-142`). Estrutura (invoice carrega o cliente do
processo) é do domínio; **quais** clientes são config do tenant.

## Teto do auto-casamento Simples (ADR-0010)

No casamento automático **1 invoice : N adiantamentos** (`tipoPermuta = simples`), `valorAbertoNegociado`
é o **teto** distribuído entre os adiantamentos casados — Σ valor usado **≤** em-aberto vivo da invoice
(invariante `I-Permuta-2` aplicada ao auto-casamento). Ver `business-rules/distribuicao-simples-greedy`.

## Fora de escopo (Fatia 1)

- Sem escrita. O casamento aqui é apenas para **expor** a candidata; a reconciliação é a Fatia 2.
