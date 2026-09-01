# invoice-pago-detalhe — tasks

> **Slug/branch:** `fix/invoice-pago-detalhe` (o slug é contrato com o webhook do quadro).
> **Tipo:** bug de implementação — **sem diff de ontologia de REGRA**. A regra
> `pago ⟺ saldo em aberto === 0` (estrita, decisão Yuri 2026-06-18 em `residual-pago-centavos`)
> permanece intacta; o que estava errado era a FONTE do dado.
> **Origem:** relato da Simone (2026-08-25) — invoices já liquidadas na aba "Invoices em aberto".

## Diagnóstico (medido, não inferido)

Sonda read-only `jobs/probe-invoice-pago.ts` contra PRD, filial 2 (2026-08-28):

| Medição | Resultado |
|---|---|
| INVOICEs finalizadas na filial 2 | 1146 |
| `mnyTitAberto` no `com298/list` | **null em 1146/1146** |
| `mnyTitPago` / `mnyTitValor` no list | null em 1146/1146 |
| campo `pago` no list | **ausente** em 1146/1146 |
| `isPago(row)` = true | **0 de 1146** |
| filtro `mnyTitAberto#GT: 0` (branch C) | **rejeitado** pelo ERP (HTTP 500) |
| divergência lista × detalhe (amostra 40) | **30 divergem, 30 delas "lista diz ABERTA, detalhe diz PAGA"** |

**Consequência:** `WHERE NOT stale AND NOT pago` é **no-op** — a aba mostra TODAS as invoices
finalizadas da filial, não as em aberto. ~75% da amostra era lixo. A Simone viu "algumas" porque
a tela estava filtrada por exportador (FFPV).

Caso canônico — doc **14042** (filial 2, processo 1953, ref `0085INX/26`):
- row do `com298/list`: `mnyTitAberto: null`, `mnyTitPago: null` → `isPago = false` → aparece na aba;
- `getDetalheTitulos`: `pago: true`, `valorAberto: 0`, `valorTotal: 2032384.41` (bate com a tela do ERP).

## Correção escolhida — custo ZERO de chamadas (descoberta da sonda)

A hipótese inicial era hidratar via `getDetalheTitulos` (+1 GET por invoice, dobrando o fan-out da
ingestão). A sonda encontrou caminho melhor: o **`com308/financeiroAPagar/list/{docCod}` — que a
ingestão JÁ chama para toda invoice** (`hidratarInvoiceNegociada` → `listTitulosAPagar`, para
valor/taxa negociada) — aceita `titMnyTotPago` no `fieldList` explícito.

Derivação `Σ titMnyValor − Σ titMnyTotPago === 0` validada contra o DETALHE (ground truth):
**30/30 concordam, 0 divergências**. Doc 14042: face `2032384.41`, pago `2032384.41` → `pago = true`.

> O com308 também expõe um campo `pago`, mas é **enum** (valores observados 1/2/3 — 21/2/7 na
> amostra), não booleano. NÃO usar sem evidência do significado de cada valor; a identidade
> monetária está provada. Registrado como pergunta aberta em `integrations/conexos.md`.

## Tasks

### Task 1: `com308` passa a trazer o valor pago do título

**Files to change:**
- `domain/client/ConexosTitulosClient.ts`
- `domain/client/permutas/conexosPermutasSchemas.ts`

**Acceptance criteria:**
- `npm run typecheck` verde.
- Teste unitário prova que uma row com `titMnyTotPago` mapeia para `valorPago`.
- A ausência do campo devolve `undefined`, não `0` — `0` significaria "nada pago" e é semanticamente diferente de "não sei".

**Dependencies:** none

Adicionar `titMnyTotPago` ao `fieldList` de `listTitulosAPagar` e mapear para `valorPago?: number`
em `TituloAPagar` (via `parseOptionalNumber`, como os campos irmãos). Campo opcional no
`com308RowSchema`.

### Task 2: a ingestão deriva `pago` dos títulos, não da row do list

**Files to change:**
- `domain/service/permutas/EleicaoPermutasService.ts` (`hidratarInvoiceNegociada`)

**Acceptance criteria:**
- Teste de regressão com os valores REAIS do doc 14042 (face/pago `2032384.41` → `pago: true`).
- Caso parcialmente pago (face > pago) → `pago: false`.
- Caso "com308 lançou" → `pago: false`.

**Dependencies:** Task 1

Derivar `pago` de `Σ titMnyValor − Σ titMnyTotPago === 0` (estrito, sem epsilon).

**Fallback conservador** (mantém a convenção das duas correções anteriores): com308 falhou, sem
títulos, ou algum título sem `valorPago`/`valorBrl` → `pago = false`. NUNCA inferir `pago=true`
sem prova — esconder uma invoice em aberto é pior do que mostrar uma paga.

### Task 3: agendar o cron da ingestão

**Files to change:**
- `render.yaml`

**Acceptance criteria:**
- Serviço `type: cron` no `render.yaml` rodando `npm run job:ingest-permutas`, com os mesmos envs do serviço web.

**Dependencies:** Task 2

Decisão do Yuri: incluir neste PR. `jobs/ingest-permutas.ts` existe desde sempre com o crontab
`0 6 * * *` **documentado no header e nunca configurado**; o `render.yaml` só declara `type: web`.
Sem isso, o `pago` corrigido só é recalculado quando alguém clica em "Ingerir" — uma invoice
liquidada DEPOIS da última ingestão continua aparecendo.

### Task 4: registrar a evidência de wire na ontologia

**Files to change:**
- `ontology/integrations/conexos.md`
- `ontology/entities/invoice.md`

**Acceptance criteria:**
- Nenhuma REGRA alterada — só evidência de integração.
- Sem ADR (a regra do `pago` não mudou).

**Dependencies:** Task 2

Registrar: (a) o `com298/list` **também não popula** `mnyTitAberto`/`mnyTitPago`/`mnyTitValor` no
lado INVOICE (1146/1146) — a evidência de 2026-06-18 era só sobre as 411 PROFORMAs e foi
generalizada sem medição; (b) `mnyTitAberto` **não serve como filtro** (`#GT` → 500);
(c) o com308 carrega `titMnyTotPago` e a derivação bate 30/30 com o detalhe; (d) o enum `pago`
do com308 como pergunta aberta.

### Task 5: a sonda fica no repo

**Files to change:**
- `jobs/probe-invoice-pago.ts`

**Acceptance criteria:**
- `jobs/probe-invoice-pago.ts` commitado (convenção: 40+ probes versionados).
- Read-only, com o gate `PROBE_ALLOW_PRD=1`.

**Dependencies:** none

## Fora de escopo (follow-ups)
- **Backfill:** desnecessário — a ingestão faz UPSERT com `pago = EXCLUDED.pago`, então a primeira
  execução após o deploy corrige as 1146 linhas sozinha. (Com a Task 3, isso passa a acontecer sozinho.)
- **Enum `pago` do com308** (1/2/3): decodificar em sonda futura; pode simplificar a Task 2.
- **`titVldStatus#EQ '1'`** no com308: a soma ignora títulos com outro status. Não deu divergência
  em 30/30, mas é risco residual — o fallback conservador cobre.
