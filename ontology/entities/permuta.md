---
name: Permuta
type: entity
ontology_version: "0.4"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0014_permuta_alocacao.sql
  - src/backend/migrations/0018_permuta_bordero_cache.sql
  - src/backend/migrations/0019_permuta_perf_indexes.sql
  - src/backend/domain/repository/permutas/PermutaAlocacaoRepository.ts
  - src/backend/domain/service/permutas/AlocacaoPermutasService.ts
  - src/backend/domain/service/permutas/GestaoPermutasService.ts
  - src/backend/domain/service/permutas/BorderoGestaoService.ts
  - src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts
  - src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts
  - src/backend/migrations/0015_permuta_alocacao_execucao.sql
  - src/backend/migrations/0056_permuta_execucao_parcial.sql
  - src/backend/routes/permutas.ts
  - src/frontend/app/permutas/page.tsx
properties:
  - adiantamentoDocCod
  - invoiceDocCod
  - invoicePriCod
  - valorAlocado
  - moeda
  - variacaoClassificacao
  - variacaoResultado
  - variacaoDelta
  - taxaAdiantamento
  - taxaInvoice
  - criadoPor
relationships:
  - "Permuta N—1 Adiantamento (lado-débito, via adiantamentoDocCod — links livres, NÃO assume priCod igual)"
  - "Permuta N—1 Invoice (lado-crédito, via invoiceDocCod — pode ser de OUTRO processo, cross-process)"
  - "Permuta 1—1 VariacaoCambial (derivada pela taxa da invoice sobre o valor PARCIAL alocado)"
  - "Permuta *—1 PermutaCandidata (a candidata em permuta-manual/casamento-manual é a origem da alocação)"
last_review: 2026-09-08
universality_evidence:
  - "ADR-0008 — alocação manual N:M cross-process (a Permuta consumada nasce como ALOCAÇÃO)"
  - "ADR-0010 — o auto-casamento Simples também ficou PARCIAL (mesma semântica de teto/residual)"
  - "ADR-0004 — a Permuta consumada já era backlog explícito da Fatia 2 (Etapa 6 / BAIXAS PERMUTAS)"
  - "ADR-0014 — múltipla automática (adto cobre todas as invoices), auto-alocação atômica no Baixar, ciclo de vida do borderô"
  - "docs-contexto/03_ontologia_financeiro.md §2 Frente I — reconciliação PROFORMA × INVOICE"
  - "ontology/glossary.md — 'Permuta' (reconciliação adiantamento ↔ invoice)"
  - "Columbia + INOX-TECH (priCod=1153): cross-process N:M validado com o time (2026-06-20), 290 adtos + 21 invoices, 0 D.I no processo"
  - "Conceito universal de comex: abater o adiantamento (PROFORMA) contra a fatura (INVOICE) definitiva, com variação cambial"
  - "ADR-0044 — baixa parcial como estado terminal + serialização por adiantamento (Regis-Review 2026-09-08, R-1/R-2, duas derivações independentes)"
---

# Permuta (consumada / alocação)

> A **Permuta consumada**: a reconciliação efetiva entre um `Adiantamento` (PROFORMA,
> lado-débito) e uma `Invoice` (lado-crédito). Materializada como uma **ALOCAÇÃO
> rascunho** (`permuta_alocacao`) — o analista monta quem-casa-com-quem e por quanto;
> a **baixa final no ERP** (`fin010`, ação `reconciliarPermuta`) é a **Fase 3** (ADR-0013),
> agora **implementada** (handshake de 5 chamadas, write-ahead em `permuta_alocacao_execucao`),
> mas **gated**: roda em **dry-run por padrão** e a escrita real exige `CONEXOS_WRITE_ENABLED`
> + `CONEXOS_DRY_RUN=false`, validada em homologação primeiro. Segue `implementation_status: partial`
> até a validação em produção do 1º caso real.

## Por que "Permuta" e não mais "candidata"

A `PermutaCandidata` modela a **pendência elegível** (a sugestão automática 1:1 e a
sinalização de N:M). A `Permuta` modela o **ato de reconciliar** — a decisão humana de
abater X do adiantamento A contra a invoice B. Desde **ADR-0008**, essa decisão é
persistida como **alocação** (`permuta_alocacao`), que **sobrevive à re-ingestão** (≠
`permuta_casamento`, recomputada por run). É a semente da baixa no ERP.

A `Permuta` nasce a partir de uma `PermutaCandidata` em estado **`permuta-manual`**
(cross-process, cliente-filtro, ADR-0007) **ou** **`casamento-manual`** (N:M no mesmo
processo, ADR-0005). Desde o adendo de **ADR-0009** (2026-06-21), os dois tipos usam o
**mesmo mecanismo de alocação** — a diferença é só o escopo de busca da invoice
(próprio processo vs outro processo).

## Definição de domínio

Uma `Permuta` é um **link adto↔invoice com valor parcial** em moeda negociada (USD). A
reconciliação é **N:M e incremental**: um adiantamento pode abater parte de várias
invoices; uma invoice pode ser composta por vários adiantamentos. O saldo pode ficar
**parcialmente em aberto** (alocação incremental — não exige fechamento exato).

> **Nota (ADR-0010):** a semântica **parcial + teto da invoice** deixou de ser exclusiva do fluxo
> manual (`permuta_alocacao`). O **auto-casamento Simples** (1 invoice : N adtos, `permuta_casamento`,
> recomputado por run) passou a distribuir o em-aberto vivo da invoice de forma **greedy** com teto e a
> deixar saldo residual em aberto — ver `entities/permuta-candidata.md` e
> `business-rules/distribuicao-simples-greedy`. Ambos os fluxos seguem **READ-ONLY** no ERP.

## Propriedades

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `adiantamentoDocCod` | string | `permuta_alocacao.adiantamento_doc_cod` | Lado-débito (PROFORMA). Parte da UNIQUE `(adto, invoice)`. |
| `invoiceDocCod` | string | `permuta_alocacao.invoice_doc_cod` | Lado-crédito (INVOICE). Parte da UNIQUE `(adto, invoice)`. |
| `invoicePriCod` | string? | `permuta_alocacao.invoice_pri_cod` | Processo da invoice — **pode diferir** do processo do adto (cross-process). Para `casamento-manual` DEVE igualar o priCod do adto (trava de escopo, ADR-0009). |
| `valorAlocado` | number | `permuta_alocacao.valor_alocado` | Valor PARCIAL em **moeda negociada (USD)**. Σ por adto ≤ saldo a permutar; Σ por invoice ≤ valor em aberto. |
| `moeda` | string? | `permuta_alocacao.moeda` | Moeda negociada — **igual** nos dois lados (trava de moeda, ADR-0009; não permuta USD × BRL). |
| `variacaoClassificacao` | enum? | `permuta_alocacao.variacao_classificacao` | `juros \| desconto` (ver `business-rules/classificacao-juros-desconto`). |
| `variacaoResultado` | number? | `permuta_alocacao.variacao_resultado` | Resultado da variação cambial sobre o valor parcial. |
| `variacaoDelta` | number? | `permuta_alocacao.variacao_delta` | `valorAlocado × (taxaAdiantamento − taxaInvoice)`. |
| `taxaAdiantamento` | number? | `permuta_alocacao.taxa_adiantamento` | Taxa de câmbio do adiantamento. |
| `taxaInvoice` | number? | `permuta_alocacao.taxa_invoice` | Taxa de câmbio da invoice (data-base = D.I da invoice). |
| `criadoPor` | string? | `permuta_alocacao.criado_por` | Auditoria (I5): analista que montou a alocação. |

## Invariantes aplicáveis

- **I-Permuta-1 (saldo do adto):** `Σ(valorAlocado por adiantamento) ≤ saldo a permutar do adto`
  (moeda negociada = `saldoPermutar(BRL) / taxa`). Excesso → `AlocacaoSaldoError` (HTTP 422).
- **I-Permuta-2 (saldo da invoice):** `Σ(valorAlocado por invoice) ≤ valor em aberto da invoice`.
  Excesso → `AlocacaoSaldoError` (HTTP 422).
- **I-Permuta-3 (mesma filial):** adto e invoice na **mesma filial** — o `priCod` não é único
  entre filiais; a busca é escopada por `filCod` do adiantamento (ADR-0009, correção crítica).
- **I-Permuta-4 (mesma moeda):** moeda negociada **igual** nos dois lados (ADR-0009).
- **I-Permuta-5 (invoice com D.I):** a invoice escolhida DEVE ter **D.I/DUIMP em aberto** — a
  data-base/variação cambial vem dela (o adto do cliente-filtro não tem D.I). Invoice sem D.I é
  omitida da busca (ADR-0007/0008).
- **I4 (sem escrita no ERP):** a alocação é rascunho na tabela própria; **nenhuma** baixa no
  `fin010` ainda. Ver "Fora de escopo".

## Cardinalidade

N:M com valores parciais. Cada linha de `permuta_alocacao` é **um** par adto↔invoice (UNIQUE);
a permuta completa de um adiantamento é o **conjunto** de suas alocações. `GestaoPermutasService`
calcula `saldoRestante` (saldo − Σ alocado) e expõe as `alocacoes` por adiantamento.

## Fonte de leitura (Conexos)

- `AlocacaoPermutasService.buscarInvoices(priCod, filCod)` — busca LIVE de invoices por processo
  (escopada à filial), enriquece valor/taxa negociada (`com308`), valida D.I (`imp019`/`imp223`).
- A alocação em si é persistida **localmente** (`permuta_alocacao`), não no ERP.

## Fase 3 — write-back `fin010` (implementado, gated)

- A **baixa/reconciliação efetiva** no ERP Conexos (`fin010`, BAIXAS PERMUTAS, Etapa 6) é a
  **Fase 3** (ADR-0013) — o risco arquitetural #1. Antes "intocado"; agora **implementado e
  validado-em-homologação**, ainda **gated** por flags (`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`).
- A ação **`reconciliarPermuta`** (`ReconciliacaoPermutaService`) consome as alocações de um
  adiantamento e executa a baixa **adto a adto** via o **handshake de 5 chamadas** do `fin010`
  (`fin010-write-contract.md`). Write-ahead + idempotência em `permuta_alocacao_execucao`
  (`idempotencia-reconciliacao.md`).
- **Anti-super-pagamento:** o valor a baixar vem do **em-aberto vivo do ERP** (passo 2), não do
  rascunho local; em-aberto ≤ 0 → aborta.
- **Serializada por adiantamento (ADR-0044).** Uma reconciliação em voo por `adiantamentoDocCod`; a
  segunda requisição concorrente recebe 409 sem tocar o ERP (**I-Recon-5**). O ledger write-ahead
  cobre interrupção; o lock cobre concorrência.
- **Cobertura insuficiente é barrada antes de escrever (ADR-0044).** Se a **cobertura em aberto** dos
  títulos da invoice não alcança o `valorAlocado`, a execução aborta **antes do primeiro POST** com
  `AlocacaoSemCoberturaError` (422) — nada escrito, nada a estornar (**I-Write-8a**). A cobertura é
  **derivada** (`titMnyValorMneg − titMnyTotPago / titFltTaxaMneg`), não a face: `titVldStatus` é
  ciclo de vida do registro, não "em aberto" — refutado por sonda em produção (emenda ADR-0044).
- **Baixa parcial é estado, não silêncio (ADR-0044).** Para o que a pré-checagem não alcança (título
  **renegociado/cancelado após a alocação**, ou lista incompleta), a execução termina em **`parcial`**
  com o resíduo gravado — nunca em `settled`. O resíduo se resolve **re-alocando** o par (chave nova
  ⇒ novo lançamento), e o adiantamento **continua na fila de elegibilidade**. Ver **I-Recon-6/7** e
  o badge `parcial-aguardando-finalizacao` em `state-machines/status-permuta-bordero.md` (B1').
- **Pendente de validação em produção:** o 1º caso real controlado (reversível, com o analista
  acompanhando). Casos ainda não observados no ERP: finalização do borderô e `DESCONTO`.

## v0.7.0 (2026-06-24, ADR-0014) — classificação automática, atomicidade e ciclo do borderô

### Múltipla AUTOMÁTICA (adto cobre todas as invoices do processo)
Um `casamento-manual` único do processo (`tipoPermuta = multiplas`) cujo `saldoNeg` cobre `Σ` das
invoices do processo (`saldoNeg + 1 ≥ Σ`, USD) é promovido a **AUTOMÁTICA**: na aba "Automáticas"
aparece como **casamentos sintéticos pré-distribuídos** (adto → cada invoice, valor cheio) e
"Processar" vira baixa real auto-alocada. Σ invoices > adto → segue manual. Não se aplica a
`cross-over` nem aos reclassificados. Ver `business-rules/multipla-automatica.md`.
Código: `GestaoPermutasService.ts:322-335` (autoElegivel), `:144-173` (synth);
`AlocacaoPermutasService.autoAlocarSeElegivel` (`:300-349`).

### Reclassificação "ultrapassa invoice"
Casamento simples cujos adtos ultrapassam o em-aberto da invoice (`Σ saldoNeg − Σ valorASerUsado > 1`)
cai para manual: N adtos → `cross-over`; 1 adto → `multiplas`. Ver
`business-rules/reclassificacao-ultrapassa-invoice.md`. Código:
`GestaoPermutasService.adtosQueUltrapassamInvoice` (`:219-251`).

### Auto-alocação no Baixar (ATÔMICA)
"Processar"/Baixar de caso automático sem rascunho cria os rascunhos de `permuta_alocacao` sozinho
(do casamento simples OU do processo na múltipla) antes da baixa, **all-or-nothing** — falha parcial
reverte (sem meia-permuta). Ver `business-rules/auto-alocacao-atomica.md`. Código:
`AlocacaoPermutasService.criarRascunhosAtomico` (`:357-391`), gatilho em
`ReconciliacaoPermutaService.ts:97-109`. Novo invariante **I-Permuta-8**.

### Status PERMUTA → BORDERÔ (ciclo de vida)
Por adiantamento com baixa `settled`: borderô EM CADASTRO → `aguardando-finalizacao`; FINALIZADO →
`finalizado`; CANCELADO/ESTORNADO/REMOVIDO → a permuta **reabre** (volta a `pendente`). Consulta lazy
`GET /permutas/status` (`routes/permutas.ts:579-587`), separada do `/gestao`. Ver
`state-machines/status-permuta-bordero.md` (ADR-0044 acrescenta **B1'**: baixa `parcial` +
borderô EM CADASTRO → `parcial-aguardando-finalizacao`, badge que afirma as DUAS pendências sem
tirar o adto da fila). Código: `BorderoGestaoService.statusPorAdiantamento`
(`:429-487`). **Estorno e "Liberar" removidos da UI** (sem borderô travado; `removerDaTrilha`
removido — risco de dupla-baixa, Regis-Review R-1 P0).

### Cache de borderôs (`permuta_bordero`)
Cache local dos borderôs de permuta do `fin010` (`borVldTipo=2`) — tabela `permuta_bordero` (migration
`0018`), populada na ingestão (`BorderoGestaoService.refreshCache`, `:381-418`), lida pela aba
Borderôs do banco (LIMIT 500 recentes, `GET /permutas/borderos`; `?live=true` = refresh ao vivo). As
ações de borderô atualizam o cache na hora; índices do hot path em migration `0019`. A situação viva
(em cadastro/finalizado/cancelado/estornado) é derivada na leitura (`situacaoDoItem`, `:496-504`).
