---
name: PermutaCandidata
type: entity
ontology_version: "0.2"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
  - src/backend/domain/service/permutas/GestaoPermutasService.ts
  - src/backend/domain/service/permutas/IngestaoPermutasService.ts
  - src/backend/domain/repository/permutas/PermutaRelationalRepository.ts
  - src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts
  - src/backend/domain/interface/permutas/PermutaCandidata.ts
  - src/backend/domain/service/permutas/ElegibilidadeService.ts
  - src/backend/domain/interface/permutas/EstadoElegibilidade.ts
  - src/backend/migrations/0012_estado_permuta_manual.sql
  - src/backend/migrations/0054_estado_ja_permutado.sql
  - src/backend/domain/interface/permutas/Gestao.ts
  - src/frontend/app/permutas/page.tsx
properties:
  - priCod
  - adiantamento
  - invoiceCasada
  - declaracaoImportacao
  - variacaoCambial
  - aging
  - estadoElegibilidade
  - motivoBloqueio
  - tipoPermuta
  - autoElegivel
  - gatesAvaliados
relationships:
  - "PermutaCandidata 1—1 Adiantamento (lado-débito)"
  - "PermutaCandidata 1—1 Invoice (lado-crédito, quando casada)"
  - "PermutaCandidata 1—1 DeclaracaoImportacao (data-base)"
  - "PermutaCandidata 1—1 VariacaoCambial (derivada)"
  - "PermutaCandidata 1—* Permuta (alocação consumada; permuta-manual/casamento-manual originam alocações, ADR-0008)"
state_machine: elegibilidade-permuta-candidata
last_review: 2026-09-08
universality_evidence:
  - "docs-contexto/03_ontologia_financeiro.md §2 Frente I (backlog elegível com aging)"
  - "ontology/glossary.md — 'Backlog elegível' / 'Pendência bloqueada'"
  - "Interview permutas-painel-elegiveis Axis 1 — pendência elegível (NÃO executada nesta fatia)"
  - "Columbia (priCod=1153): PDF processo 2048"
  - "ADR-0010 — auto-casamento Simples N:1 parcial (greedy + teto da invoice); caso 1408 ZNSHINE"
  - "ADR-0014 — múltipla AUTOMÁTICA + reclassificação ultrapassa-invoice; flag derivada autoElegivel; aba 'Simples'→'Automáticas'"
  - "ADR-0043 — `ja-permutado` promovido a estado (adto pago com saldo 100% consumido é conclusão, não reprovação). Medido em PRD 2026-09-08 (run 1c1acefe): 80 dos 329 'bloqueados' eram conclusões; 13.434 no histórico de 250 runs"
---

# PermutaCandidata

> A **pendência elegível em si**: a composição (`Adiantamento` + `Invoice` casada +
> `DeclaracaoImportacao` + `VariacaoCambial` + `aging` + estado de elegibilidade) que o
> painel READ-ONLY expõe. É uma **candidata**, **NÃO** uma permuta consumada.

## Por que "candidata" e não "Permuta"

A `PermutaCandidata` é a **pendência** (a sugestão automática + sinalização de N:M); a
`Permuta` é o **ato de reconciliar** (a alocação adto↔invoice). Desde **ADR-0008**, a
entidade `Permuta` consumada **já existe** como **alocação** rascunho (`permuta_alocacao`) —
ver `entities/permuta.md`. O que ainda **não** existe é a **baixa efetiva na `fin010`** (ação
`reconciliarPermuta`, write-back no ERP, Etapa 6 / BAIXAS PERMUTAS) — risco arquitetural #1
(ADR-0002/0003 O3), que é a **Fase 3**. Uma candidata em `permuta-manual` ou `casamento-manual`
é a **origem** das alocações `Permuta` (o analista distribui o saldo em invoices).

## Definição de domínio

Uma `PermutaCandidata` é produzida pela cadeia de ações `elegerAdiantamentos` →
`avaliarElegibilidade` → `casarInvoice` → `calcularVariacaoCambial` → `exporNoPainel`.
Ela só é **elegível** quando passa nos **4 gates** **E** tem **INVOICE casada** (invariante
I3 / business-rule `elegibilidade-permuta`). Caso contrário, é **bloqueada** (reportada, não
contada como falha — ver glossary "Pendência bloqueada").

## Propriedades

| Propriedade | Tipo | Origem | Notas |
|-------------|------|--------|-------|
| `priCod` | string | `Adiantamento.priCod` | Chave do processo. |
| `filCod` | number | `Adiantamento.filCod` | **Invariante multi-filial I6** — filial da candidata. Persistido em `permuta_candidata_snapshot.fil_cod` (P0-2 RESOLVIDO; antes sempre `NULL`). |
| `adiantamento` | `Adiantamento` | composição | Lado-débito (carrega o `filCod` canônico). |
| `invoiceCasada` | `Invoice?` | `casarInvoice` | Lado-crédito = exatamente 1 invoice FINALIZADA (P0-6 RESOLVIDO; 0 → `sem-invoice`/bloqueada, >1 → `casamento-manual` com motivo `composto-nm`, ADR-0005). |
| `declaracaoImportacao` | `DeclaracaoImportacao?` | Gate 4 | D.I XOR DUIMP (existência/XOR + data-base via `cdiDtaCi`/`dioDtaDesembaraco`; P0-4 RESOLVIDO, probe 2026-06-18). |
| `variacaoCambial` | `VariacaoCambial?` | `calcularVariacaoCambial` | Classificação por TAXA de câmbio (P0-1 RESOLVIDO). |
| `aging` | number (dias) | derivado | Âncora = data-base (P0-8 RESOLVIDO); `aging = hoje − dataBase`. Leitura da data-base RESOLVIDA (P0-4, probe 2026-06-18) — coluna aging popula. |
| `estadoElegibilidade` | enum | máquina de estado | `descoberta \| elegivel \| casamento-manual \| permuta-manual \| ja-permutado \| bloqueada` (ver state-machine; `casamento-manual` = N:M pós-4-gates mesmo processo, ADR-0005; `permuta-manual` = cliente-filtro cross-process, ADR-0007; `ja-permutado` = pago com saldo 100% consumido, estado CONCLUÍDO e terminal, ADR-0043). **Persistido em `permuta_adiantamento.estado_elegibilidade` E, íntegro, em `permuta_candidata_snapshot.status`** — a projeção binária do snapshot foi revogada (ADR-0043). |
| `motivoBloqueio` | enum? | `casarInvoice` / `avaliarElegibilidade` / `EleicaoPermutasService` | Motivo informativo. Para `bloqueada`: `sem-invoice \| nao-pago \| sem-saldo-permutar \| di-duimp-ambos \| data-base-indisponivel \| detail-indisponivel \| falha-gate` (fallback). Para `casamento-manual`: `composto-nm \| multiplas-invoices` (N:M, ADR-0005). Para `permuta-manual`: `cliente-filtro` (ADR-0007). Para `ja-permutado`: `ja-permutado` (ADR-0043). **Os motivos por gate (`nao-pago`, `sem-saldo-permutar`, `di-duimp-ambos`) são produzidos desde 2026-06-19 — listá-los aqui é sincronização de drift documental (ADR-0043), não taxonomia nova.** |
| `tipoPermuta` | enum (derivado) | `GestaoPermutasService` | **Não persiste** (apresentação/abas). `simples \| multiplas \| cross-over \| cross-process`, derivado do estado + cardinalidade do processo (ADR-0009). **ADR-0014:** pode ser **reclassificado** quando o casamento simples ultrapassa a invoice (`simples → cross-over/multiplas`, `GestaoPermutasService.ts:309-320`). |
| `autoElegivel` | boolean? (derivado) | `GestaoPermutasService.toPendente` | **Não persiste** (apresentação). `true` quando a múltipla (1 adto casamento-manual no processo) **cobre todas as invoices** do processo (`saldoNeg + 1 ≥ Σ invoices`, USD) → vira **AUTOMÁTICA** (`GestaoPermutasService.ts:322-335`, ADR-0014). Ver `business-rules/multipla-automatica.md`. |
| `gatesAvaliados` | registro | `avaliarElegibilidade` | Resultado de cada um dos 4 gates (auditoria I5). |

## Cardinalidade — 1:1 vs N:M (P0-5/P0-6 — RESOLVIDO)

- O auto-casamento (`tipoPermuta = simples`) executa o **1:1 (direto)** **e** o
  **1 invoice : N adiantamentos**. Desde **ADR-0010**, o N:1 distribui o **em-aberto vivo da invoice**
  (`Invoice.valorAbertoNegociado`) entre os adtos casados — **greedy** (maior saldo primeiro; desempate
  por aging), com **teto** = em-aberto da invoice; o adto consumido em parte mantém o saldo restante em
  aberto (auto-casamento ficou **parcial**, como o manual). O casamento expõe `saldoRestante`
  (`CasamentoAdiantamento.saldoRestante`, coluna "Saldo restante" na aba Simples). Ver
  `business-rules/distribuicao-simples-greedy`. READ-ONLY (só o snapshot `permuta_casamento`).
- O caso **N:M (composto)** (várias proformas/invoices no mesmo processo) **EXISTE e é
  FREQUENTE**. **ADR-0005:** como passa os 4 gates, deixou de ser `bloqueada` e passou ao estado
  **`casamento-manual`** (motivo informativo `composto-nm` / `multiplas-invoices`) — pronto para o
  analista **escolher a invoice**. A **alocação/escrita final é Fatia 2**: o shape pode evoluir
  para coleções com alocação (watchlist). Nesta fatia, sinalizamos o N:M sem executá-lo.

## Estado de elegibilidade

Ver `ontology/state-machines/elegibilidade-permuta-candidata.md`. Resumo:
`descoberta → elegivel` (4 gates + 1 INVOICE casada, auto 1:1); `descoberta → casamento-manual`
(4 gates + N:M >1 INVOICE mesmo processo — falta o analista alocar a invoice, ADR-0005);
`descoberta → permuta-manual` (cliente-filtro pago + saldo, D.I dispensada, cross-process,
ADR-0007); `descoberta → ja-permutado` (pago, Gate 2 reprovado com `valorPermutado > 0` — saldo consumido em
permuta anterior; estado CONCLUÍDO e **terminal**, ADR-0043); `descoberta → bloqueada` (falhou
algum gate / 0 INVOICE / anomalia XOR / data-base indisponível). Desde ADR-0043, `bloqueada`
significa **passivo dependente de terceiro** e nada além disso.

**`ja-permutado` deixou de ser derivação de apresentação.** Até 2026-09-08 o caso era gravado como
`bloqueada` + motivo e promovido a status próprio só em `GestaoPermutasService.toPendente` ("sem
novo estado no banco"). A derivação continua correta na tela, mas passa a **ler o estado direto**
em vez de reconstruí-lo pelo motivo. O estado `executada` (baixa na `fin010`) é a **Fase 3**
(ADR-0013).

## Invariantes aplicáveis

- **I1** human-in-the-loop · **I3** elegibilidade estrita · **I4** sem escrita ·
  **I5** auditoria por execução · **I6** multi-filial. Ver `business-rules/elegibilidade-permuta.md`.
