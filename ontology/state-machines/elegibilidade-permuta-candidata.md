---
name: elegibilidade-permuta-candidata
type: state-machine
entity: PermutaCandidata
ontology_version: "0.2"
# REVISTO no fechamento do ciclo `permuta-snapshot-estados` (2026-09-08): segue
# `partial`, e por um motivo só — `EXECUTADA` (T5, baixa na fin010) é gated por
# CONEXOS_WRITE_ENABLED/CONEXOS_DRY_RUN, e dry-run não transiciona. Os estados de
# elegibilidade (T1-T4 e o T6 desta ADR) estão TODOS implementados e persistidos,
# incluindo `JA_PERMUTADO` (migration 0054).
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0005_estado_casamento_manual.sql
  - src/backend/migrations/0012_estado_permuta_manual.sql
  - src/backend/migrations/0054_estado_ja_permutado.sql
  - src/backend/domain/interface/permutas/EstadoElegibilidade.ts
  - src/backend/domain/service/permutas/ElegibilidadeService.ts
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
  - src/backend/domain/service/permutas/GestaoPermutasService.ts
  - src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts
last_review: 2026-09-14
states: [DESCOBERTA, ELEGIVEL, CASAMENTO_MANUAL, PERMUTA_MANUAL, JA_PERMUTADO, BLOQUEADA, EXECUTADA]
out_of_scope_states: []
---

# Estado de Elegibilidade — PermutaCandidata

> Ciclo de vida do **estado de elegibilidade** de uma `PermutaCandidata` nesta fatia
> READ-ONLY. Estados como **constantes tipadas** (nunca strings cruas — P3 / Domain State
> Machines). Cada transição é uma **ação nomeada** com regra explícita e vigência.

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `DESCOBERTA` | `'descoberta'` | Adiantamento eleito; ainda não avaliado. |
| `ELEGIVEL` | `'elegivel'` | Passou nos 4 gates **E** tem exatamente 1 INVOICE casada (I3) — auto 1:1. |
| `CASAMENTO_MANUAL` | `'casamento-manual'` | Passou nos **4 gates**, mas o casamento é **N:M** (>1 INVOICE FINALIZADA) **no mesmo processo**: falta **só o analista escolher/alocar a invoice**. **Não é reprovação** (≠ BLOQUEADA). Escopo: motivos `composto-nm` / `multiplas-invoices` (ADR-0005). Mantém o motivo informativo. |
| `PERMUTA_MANUAL` | `'permuta-manual'` | Adto de **cliente-filtro** (importador cadastrado, `ClienteFiltro`/ADR-0007) **pago e com saldo a permutar**, pronto para **permuta manual CROSS-PROCESS** (a invoice vem de OUTRO processo, escolhida pelo analista). **Gate 4 (D.I) NÃO é exigido** — a D.I/data-base virá da invoice escolhida. Motivo informativo: `cliente-filtro`. **Não é reprovação** (≠ BLOQUEADA). |
| `JA_PERMUTADO` | `'ja-permutado'` | Adiantamento **pago** cujo saldo a permutar já foi **100% consumido** numa permuta anterior (`valorPermutar ≤ R$1,00` **E** `valorPermutado > 0`, `mnyTitPermuta` do detalhe; tolerância de resíduo ADR-0046). Vale **com ou sem D.I** (ADR-0046). Estado **CONCLUÍDO** — o trabalho foi feito —, **não** reprovação de mérito (≠ `BLOQUEADA`). Motivo informativo: `ja-permutado`. **Terminal**: sem saldo, não origina alocação nem T5. **ADR-0043.** |
| `BLOQUEADA` | `'bloqueada'` | Falhou ≥1 gate, sem INVOICE casada (0), ou data-base indisponível. Reportada **com motivo** (taxonomia abaixo), não é falha. Desde ADR-0043 significa **passivo dependente de terceiro ou de leitura**, e nada além disso. **N:M deixou de cair aqui** (→ `CASAMENTO_MANUAL`, ADR-0005); adto de cliente-filtro pago+saldo também sai daqui (→ `PERMUTA_MANUAL`, ADR-0007); **adto já permutado também sai daqui** (→ `JA_PERMUTADO`, ADR-0043). |

## Taxonomia de motivos do estado `BLOQUEADA` (P0-5/P0-6/P0-8 — RESOLVIDO)

Toda candidata `bloqueada` carrega um **motivo** (`PermutaCandidata.motivoBloqueio`):

| Motivo | Valor | Origem | Significado |
|--------|-------|--------|-------------|
| Composto N:M | `'composto-nm'` | `casarInvoice` | Várias proformas/invoices no processo — N:M. **Desde ADR-0005, NÃO é mais bloqueio: leva a `CASAMENTO_MANUAL`** (motivo informativo). A escrita final (escolha da invoice) é Fatia 2. |
| Sem invoice | `'sem-invoice'` | `casarInvoice` | 0 INVOICE FINALIZADA no processo (aguardando emissão). **Segue `BLOQUEADA`.** |
| Múltiplas invoices | `'multiplas-invoices'` | `casarInvoice` | >1 INVOICE FINALIZADA (mesma família N:M de `composto-nm`). **Desde ADR-0005 → `CASAMENTO_MANUAL`**, não bloqueio. |
| Não pago | `'nao-pago'` | `avaliarElegibilidade` (Gate 3) | Adiantamento **não** totalmente pago (`mnyTitAberto > R$1,00`, ADR-0046). Causa-raiz de maior prioridade (o saldo a permutar deriva do valor pago). **Segue `BLOQUEADA`.** |
| Sem saldo a permutar | `'sem-saldo-permutar'` | `avaliarElegibilidade` (Gate 2) | Pago, mas `mnyTitPermutar ≤ R$1,00` (ADR-0046) **e nunca houve permuta** (`valorPermutado = 0`). **Segue `BLOQUEADA`.** Distingue-se de `ja-permutado` (saldo consumido → estado `JA_PERMUTADO`, ADR-0043). |
| D.I e DUIMP ambos | `'di-duimp-ambos'` | `avaliarElegibilidade` (Gate 4) | Anomalia XOR — D.I **e** DUIMP no mesmo processo. **Segue `BLOQUEADA`.** |
| Falha de gate | `'falha-gate'` | `avaliarElegibilidade` | **Fallback não esperado** — gate reprovado sem motivo específico mapeado. Os motivos por gate acima o substituíram em 2026-06-19. |
| Data-base indisponível | `'data-base-indisponivel'` | `avaliarElegibilidade` (Gate 4) | Gate 4 sem D.I **nem** DUIMP — sem âncora de data-base. **Só é o motivo quando o adto está pago e tem saldo** (prioridade ADR-0046). |
| Detalhe indisponível | `'detail-indisponivel'` | `elegerAdiantamentos` (Gate 2, `getMnyTitPermutar`) | **Blip transiente** do Conexos — a leitura do DETALHE da PROFORMA (`getMnyTitPermutar`) falhou após retries e lançou `ConexosError`. **NÃO é reprovação legítima** (`falha-gate`): a candidata pode ser elegível; ficou bloqueada porque não conseguimos ler o valor a permutar. Re-avaliável na próxima run (idempotente). Introduzido em P0-3. |

> **Sincronização de drift documental (2026-09-08, ADR-0043).** As linhas `nao-pago`,
> `sem-saldo-permutar` e `di-duimp-ambos` **não são taxonomia nova**: já eram produzidas pelo código
> desde 2026-06-19 (`ElegibilidadeService.motivoDoGateFalho`) e documentadas em
> `actions/avaliar-elegibilidade.md`; faltavam **aqui**. Medido em PRD 2026-09-08: `nao-pago` com 35
> casos vivos e 7.810 históricos. Mudar a taxonomia de motivos segue **fora de escopo** deste ciclo —
> isto é só documentar o que já existe.

### Prioridade de escolha do motivo (ADR-0046)

Quando mais de um gate falha, vale **uma** ordem, que é também a ordem de avaliação:

```
1. nao-pago                                  (Gate 3: mnyTitAberto > R$1,00)
2. ja-permutado  |  sem-saldo-permutar       (Gate 2: valorPermutar ≤ R$1,00; valorPermutado > 0 ou = 0)
3. data-base-indisponivel  |  di-duimp-ambos (Gate 4: nenhuma | ambas as declarações)
4. casamento de invoice                      (sem-invoice | composto-nm/multiplas-invoices | 1:1)
```

A ausência de D.I **nunca** mascara motivo de pagamento ou de saldo. I2 não muda. Um adto pago, com
saldo e sem D.I segue `data-base-indisponivel` na avaliação e, se for de cliente-filtro, é roteado por T4.

### Motivo informativo do estado `PERMUTA_MANUAL` (ADR-0007)

| Motivo | Valor | Origem | Significado |
|--------|-------|--------|-------------|
| Cliente-filtro | `'cliente-filtro'` | `EleicaoPermutasService` (override de roteamento) | O importador (`pesCod`) do adto está no cadastro `ClienteFiltro` **ativo**, e o adto está **pago + com saldo a permutar**. Roteado para permuta manual cross-process em vez de `BLOQUEADA`. A invoice (de outro processo) é escolhida na alocação (`Permuta`/ADR-0008). |

### Motivo informativo do estado `JA_PERMUTADO` (ADR-0043)

| Motivo | Valor | Origem | Significado |
|--------|-------|--------|-------------|
| Já permutado | `'ja-permutado'` | `avaliarElegibilidade` (Gate 2, `ElegibilidadeService.motivoDoGateFalho`) | Gate 3 (TOTALMENTE PAGO) passou e o Gate 2 reprovou com `valorPermutado > 0`: o saldo foi consumido numa permuta anterior. Distingue-se de `sem-saldo-permutar` (nunca teve saldo → segue `BLOQUEADA`). Mesmo padrão de `composto-nm` / `cliente-filtro`: **motivo informativo de um estado que não é reprovação.** |

> Nota: `composto-nm` e `multiplas-invoices` pertencem à mesma família (mais de 1 invoice).
> Use `multiplas-invoices` se quiser distinguir do composto N:M de proformas; senão `composto-nm`
> cobre o caso geral de N:M. **ADR-0005 (Yuri, 2026-06-18):** N:M deixou de ser `BLOQUEADA` e
> passou ao estado `CASAMENTO_MANUAL` — os 4 gates passaram; falta só a escolha da invoice pelo
> analista (a baixa/escrita final é Fatia 2). Os motivos `composto-nm`/`multiplas-invoices` viram
> **informativos** (qual sabor de N:M), não bloqueio.

> **`EXECUTADA` agora está EM ESCOPO (Fase 3, ADR-0013).** A alocação rascunho
> (`permuta_alocacao`, ADR-0008) é **consumida** pela ação `reconciliarPermuta`
> (`ReconciliacaoPermutaService`), que executa a **baixa efetiva na `fin010`** via o handshake
> de 5 chamadas (`fin010-write-contract.md`). A escrita é **gated** (flags
> `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`, homologação-first) e idempotente por par adto↔invoice
> (`permuta_alocacao_execucao`, `idempotencia-reconciliacao.md`). O risco #1 deixa de estar intocado.

## Transições

| # | De → Para | Ação (nomeada) | Regra | Vigência |
|---|-----------|----------------|-------|----------|
| T1 | `DESCOBERTA → ELEGIVEL` | `avaliarElegibilidade` + `casarInvoice` | 4 gates satisfeitos **E** exatamente 1 INVOICE casada (I3) — auto 1:1. Gate 4 valida XOR + data-base (`cdiDtaCi`/`dioDtaDesembaraco`; P0-4 RESOLVIDO, probe 2026-06-18). | 2026-06-18 |
| T2 | `DESCOBERTA → BLOQUEADA` | `avaliarElegibilidade` / `casarInvoice` | Qualquer gate falho (`falha-gate`), 0 invoice (`sem-invoice`), sem D.I nem DUIMP (`data-base-indisponivel`), ou detalhe da PROFORMA indisponível após retries (`detail-indisponivel`, P0-3 — blip transiente, não reprovação). Anota `motivoBloqueio` pela prioridade única (ADR-0046: `nao-pago` → `sem-saldo-permutar` → `data-base-indisponivel`/`di-duimp-ambos` → `sem-invoice`). **N:M NÃO entra mais aqui (→ T3); adto já permutado NÃO entra mais aqui (→ T6, ADR-0043), nem quando também não tem D.I (ADR-0046).** | 2026-06-18 (rev. 2026-09-14) |
| T3 | `DESCOBERTA → CASAMENTO_MANUAL` | `avaliarElegibilidade` + `casarInvoice` | **4 gates satisfeitos** mas casamento **N:M** (>1 INVOICE FINALIZADA → `composto-nm` / `multiplas-invoices`) **no mesmo processo**. Falta só o analista alocar a invoice; a baixa é Fase 3. Anota `motivoBloqueio` informativo. **ADR-0005.** | 2026-06-18 |
| T4 | `DESCOBERTA → PERMUTA_MANUAL` | `elegerAdiantamentos` (override `ClienteFiltro`) | Importador do adto está no cadastro `ClienteFiltro` ativo **E** adto `pago && saldoPermutar > R$1,00` — `pago` = `|mnyTitAberto| ≤ R$1,00`, mesmos predicados dos Gates 2/3 (ADR-0046) — (seria `BLOQUEADA`, mas é cliente-filtro). Gate 4 (D.I) dispensado — a invoice cross-process traz a data-base. Motivo informativo `cliente-filtro`. **ADR-0007.** | 2026-06-20 |
| T5 | `{ELEGIVEL, CASAMENTO_MANUAL, PERMUTA_MANUAL} → EXECUTADA` | `reconciliarPermuta` | Alocação(ões) do adto baixadas no ERP `fin010` (handshake de 5 chamadas). Por par adto↔invoice; idempotente (par `settled` é pulado). **Gated** por `CONEXOS_WRITE_ENABLED`+`CONEXOS_DRY_RUN`; dry-run não transiciona. **ADR-0013.** | 2026-06-23 |
| T6 | `DESCOBERTA → JA_PERMUTADO` | `avaliarElegibilidade` | Gate 3 (TOTALMENTE PAGO, `|mnyTitAberto| ≤ R$1,00`) **satisfeito** e Gate 2 (`valorPermutar > R$1,00`) **reprovado** com `valorPermutado > 0` — saldo consumido em permuta anterior. A prioridade de causa-raiz é preservada (`nao-pago` do Gate 3 vence o Gate 2), então T6 só dispara em adto **pago**. **O Gate 4 não impede T6**: sem D.I, o adto pago e sem saldo é `JA_PERMUTADO` (ADR-0046). Anota o motivo informativo `ja-permutado`. **Terminal.** **ADR-0043.** | 2026-09-08 (rev. 2026-09-14) |

> **Decisão de terminalidade (ADR-0043).** `JA_PERMUTADO` **não** é origem de T5 (`→ EXECUTADA`).
> A razão é de domínio, não de implementação: T5 consome **alocações** (`permuta_alocacao`), e uma
> alocação exige saldo a permutar; um adto com `valorPermutar = 0` não tem o que alocar. Chegar a
> `JA_PERMUTADO` é justamente o registro de que a permuta **já aconteceu** — uma aresta para
> `EXECUTADA` permitiria contar a mesma permuta duas vezes.
>
> **Ressalva — terminal não é imortal.** Esta máquina é **recomputada do zero a cada run** (ver
> Notas: não há persistência de transição no ERP). Se o Conexos estornar a permuta anterior, o
> `valorPermutar` volta a ser > R$1,00 e a **próxima eleição reclassifica** a candidata. "Terminal" aqui
> significa **sem aresta de saída dentro de uma run** — o mesmo sentido que já vale para `BLOQUEADA`.

```
                  elegerAdiantamentos
                          │
                          ▼
                    ┌───────────┐
                    │ DESCOBERTA│
                    └─────┬─────┘
   ┌───────────┬──────────────┬──────┴───────┬──────────────┐
T1 ✓         T3 ◐           T4 ◓           T6 ●           T2 ✗
(4 gates     (4 gates,      (cliente-      (pago, Gate 2   (gate falho /
 + 1 INV)     N:M >1 INV     filtro,        reprovado com   0 INVOICE /
   │          mesmo proc)    pago+saldo,    valorPermutado   XOR /
   │             │           cross-proc)      > 0)           data-base)
   ▼             ▼               ▼              ▼               ▼
┌─────────┐ ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐
│ ELEGIVEL│ │ CASAMENTO_MANUAL │ │PERMUTA_MANUAL│ │ JA_PERMUTADO │ │ BLOQUEADA│
└─────────┘ └──────────────────┘ └──────────────┘ └──────────────┘ └──────────┘
                                                  (terminal: saldo 0,
                                                   não origina T5)
   ┊             ┊                     ┊
   ┊             └──────── alocação N:M (Permuta) ───────┘
   ┊                  (distribui saldo em invoices,
   ┊                   ADR-0008/0009 — Fase 2)
   ▼                       ┊
   └────────── T5: reconciliarPermuta (baixa fin010, ADR-0013) ──────────┐
                                                                          ▼
                                                                    ┌──────────┐
                                                                    │ EXECUTADA│  (gated: dry-run ≠ executa)
                                                                    └──────────┘
```

> **CASAMENTO_MANUAL** e **PERMUTA_MANUAL** convergem na **alocação** (entidade `Permuta`,
> `permuta_alocacao`): desde o adendo de **ADR-0009** ambos usam o mesmo mecanismo de
> distribuir o saldo de 1 adiantamento em VÁRIAS invoices (parcial). Diferença: casamento-manual
> busca **o próprio processo** (mesma filial); permuta-manual busca **outro processo**.

## Classificação derivada `tipoPermuta` (apresentação — ADR-0009)

`tipoPermuta` **NÃO é um estado** (não persiste no banco, sem migration). É um rótulo
**derivado** calculado em `GestaoPermutasService` a partir do estado + cardinalidade do
processo, só para as **abas** da área de trabalho:

| Rótulo | Deriva de | Cardinalidade |
|--------|-----------|---------------|
| `simples` | `ELEGIVEL` | 1:1 (auto-casável). |
| `multiplas` | `CASAMENTO_MANUAL` com **1** adto no `priCod` | 1 adto → N invoices (mesmo processo). |
| `cross-over` | `CASAMENTO_MANUAL` com **>1** adto no `priCod` | N adtos ↔ M invoices (mesmo processo). |
| `cross-process` | `PERMUTA_MANUAL` | invoice em OUTRO processo (cliente-filtro). |

Regra de corte (casamento-manual): `nº de adtos casamento-manual no priCod > 1 → cross-over,
senão multiplas`. Por ser derivado, mudar a regra é ajuste de derivação — sem reseed.

## Notas

- Idempotência: re-rodar o job recomputa o estado do zero a cada execução (não há
  persistência de transição no ERP). O snapshot/auditoria por execução é persistido em
  Postgres (I5 / migration-debt O5).
- **Fidelidade da projeção (ADR-0043).** O snapshot por execução
  (`permuta_candidata_snapshot.status`) grava **o estado inteiro** da máquina — não uma projeção
  binária `elegivel|bloqueada`. Até 2026-09-08, três estados (`casamento-manual`, `permuta-manual`
  e o `ja-permutado` que morava dentro de `bloqueada`) eram achatados na escrita
  (`PermutaSnapshotRepository.ts:320-323`) **e** na leitura (`:353`), e o header da mesma run
  divergia do próprio snapshot em **2,06×** (329 × 677, run `1c1acefe`, 2026-09-08). Header e
  snapshot passam a convergir **por construção**. Ver
  `business-rules/fidelidade-snapshot-eleicao.md`.
- Aging (âncora = data-base, P0-8 RESOLVIDO; leitura gated em P0-4) é propriedade da candidata,
  não estado — não cria transição.
