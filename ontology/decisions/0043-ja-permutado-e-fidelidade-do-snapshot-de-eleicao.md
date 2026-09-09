---
adr_number: 0043
title: "`ja-permutado` vira estado; o snapshot da eleição para de mentir"
date: 2026-09-08
status: accepted
type: modification
related_entities: [PermutaCandidata, JobRun]
supersedes_decisions:
  - "0005 §migration (snapshot mantém CHECK binária por back-compat do /painel)"
  - "0012 §migration (idem)"
---

# ADR 0043: `ja-permutado` vira estado; o snapshot da eleição para de mentir

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex)
**Frente:** I — Permutas · **Branch:** `fix/permuta-snapshot-estados`
**Relacionado:** ADR-0005 (casamento-manual), ADR-0007 (permuta-manual), ADR-0009 (tipoPermuta
derivado), ADR-0013 (Fase 3 / EXECUTADA), ADR-0042 (JobRun read-model),
state-machine `elegibilidade-permuta-candidata`, business-rules `elegibilidade-permuta` e
`fidelidade-snapshot-eleicao`

## Contexto — a run se contradiz dentro da própria transação

`permuta_candidata_snapshot.status` é **binário** por construção
(`CHECK (status IN ('elegivel','bloqueada'))`, migration 0001), mas `ESTADO_ELEGIBILIDADE` tem
**5 valores**. Duas gravações catch-all achatam a informação:

- **escrita** — `PermutaSnapshotRepository.ts:320-323`:
  `candidata.estadoElegibilidade === ELEGIVEL ? 'elegivel' : 'bloqueada'`
- **leitura** — `PermutaSnapshotRepository.ts:353` (`mapSnapshotRow`):
  `r.status === 'elegivel' ? 'elegivel' : 'bloqueada'`

Diagnosticado e **reconfirmado ao vivo** (read-only) em 2026-09-08, run
`1c1acefe-398e-4b5d-9c82-49ff5e061e83`, `finished_at` 2026-09-08 18:16 UTC:

| Fonte (mesma run) | `elegivel` | `bloqueada` |
|---|---|---|
| header `permuta_eleicao_run` (predicado estrito, `EleicaoPermutasService.ts:336-338`) | 27 | **329** |
| snapshot `permuta_candidata_snapshot` | 27 | **677** |

Total de candidatas: 704. **A mesma run se contradiz por 2,06× dentro da mesma transação.**

### Verdade relacional (`permuta_adiantamento`, `stale IS NOT TRUE`)

| Estado | Qtd | Motivos |
|---|---|---|
| `bloqueada` | **329** | `data-base-indisponivel` 211 · `ja-permutado` 80 · `nao-pago` 35 · `sem-invoice` 3 |
| `permuta-manual` | 300 | `cliente-filtro` |
| `casamento-manual` | 48 | `composto-nm` |
| `elegivel` | 26 | — |

Passivo externo **real**: **249** (`data-base-indisponivel` + `nao-pago` + `sem-invoice`).
Logo, 677 / 249 = **2,72× de inflação** no número que a operação lê como "culpa de terceiro".

### O custo já foi pago uma vez

Os **348 itens** que são a **nossa** fila de trabalho (300 cross-process + 48 N:M) apareciam como
passivo de terceiro. O relatório de impacto v1 alarmou com "backlog bloqueado crescente" e teve de
ser corrigido depois (`docs/impacto/CORRECOES-2026-08-24.md` §1). Não é um erro cosmético: é um
número que já produziu uma conclusão errada sobre a operação do cliente.

## Decisão

### 1. `ja-permutado` é promovido a estado de domínio de primeira classe

Passa a existir em `ESTADO_ELEGIBILIDADE`, em `permuta_adiantamento.estado_elegibilidade` **e** no
snapshot. Até aqui era `BLOQUEADA` + `motivoBloqueio='ja-permutado'`, promovido a status próprio
**só na apresentação** (`GestaoPermutasService.ts:263-281`, com o comentário explícito "sem novo
estado no banco (zero migration/reseed)").

Semanticamente é um estado **CONCLUÍDO** — o adiantamento foi pago e teve o saldo 100% consumido
numa permuta anterior —, **não** uma reprovação de mérito. O próprio código já dizia isso
(`EstadoElegibilidade.ts:47-52`). Um estado concluído dentro do balde de reprovados é uma
classificação errada que a apresentação vinha desfazendo item a item.

**Consequência aceita:** `total_bloqueadas` cai de **329 para 249** — o passivo externo real. Os 80
`ja-permutado` saem do balde. O motivo `ja-permutado` **permanece**, como motivo informativo do novo
estado, no mesmo padrão de `composto-nm`/`casamento-manual` e `cliente-filtro`/`permuta-manual`.

### 2. `JA_PERMUTADO` é terminal

Não é origem de T5 (`→ EXECUTADA`). Razão de domínio, não de implementação: T5 consome
**alocações** (`permuta_alocacao`), e alocação exige saldo a permutar; um adto com
`valorPermutar = 0` não tem o que alocar. Chegar a `JA_PERMUTADO` é justamente o registro de que a
permuta **já aconteceu** — uma aresta para `EXECUTADA` permitiria contar a mesma permuta duas vezes.

**Ressalva registrada na state-machine:** a máquina é recomputada do zero a cada run. Se o ERP
estornar a permuta anterior, o `valorPermutar` volta a ser > 0 e a próxima eleição reclassifica a
candidata. "Terminal" significa **sem aresta de saída dentro de uma run** — o mesmo sentido que já
vale para `BLOQUEADA`.

### 3. A projeção binária do snapshot é revogada

O snapshot passa a gravar o **estado inteiro** da máquina (migration `0054`, estendendo a CHECK de
`permuta_candidata_snapshot.status` para os 5 valores), com backfill determinístico do histórico
(§Backfill). Escrita e leitura deixam de ter ramo catch-all.

### 4. Revogação explícita da decisão de back-compat das migrations 0005 e 0012

Ambas documentaram, por escrito, a decisão de **não** tocar a CHECK do snapshot:

> *"NÃO toca o `permuta_candidata_snapshot` (0001), cuja CHECK segue `elegivel|bloqueada` — o
> `casamento-manual` é mapeado para `bloqueada` no snapshot (back-compat `/painel` do PR#2)."*
> — migration 0005; a 0012 repete o argumento para `permuta-manual`.

**A justificativa caducou:** `GET /permutas/painel` não tem **nenhum** consumidor no frontend —
zero call sites. Uma decisão de compatibilidade cuja contraparte não existe não é conservadorismo,
é uma mentira mantida por inércia, e ela custou 348 itens mal classificados por ~3 meses. Fica
revogada aqui, por escrito, para que ninguém a re-derive lendo as migrations antigas.

### 5. `GET /permutas/painel` e `PainelService` são removidos

Rota (`routes/permutas.ts:773-781`), service (`domain/service/permutas/PainelService.ts`) e testes.
Os probes migram para a taxonomia nova: `probe-impacto-verificacao.ts`
(`WHERE s.status='bloqueada'`) e `probe-impacto-narrativa.ts` (`estado_elegibilidade='bloqueada'`).

**Nota ontológica:** `PainelService` **nunca constou de `_index.json`**; a ação `exporNoPainel`
segue implementada por `GestaoPermutasService` + `src/frontend/app/permutas/page.tsx`. A remoção
não deixa ação órfã — ela deixa a ação com **um** implementador em vez de dois, sendo que o segundo
era o que achatava.

### 6. O header da run ganha os buckets que faltam — 5 buckets

`permuta_eleicao_run` passa a registrar, além de `total_elegiveis` e `total_bloqueadas`:
`total_casamento_manual`, `total_permuta_manual` e `total_ja_permutado`.

Sem isso, "Últimas rodadas" (`JobRunReadModel.ts:184`, que expõe `bloqueadas: r.totalBloqueadas`)
continuaria cega para os 348 itens da nossa própria fila.

#### Premissa registrada — como se chegou a 5

A escolha inicial do Yuri na entrevista foi **"4 buckets"**. A promoção de `ja-permutado` a estado
de primeira classe (Decisão 1) veio **depois** dessa escolha, o que tornou "4" incoerente com a
própria máquina de estados. Apontada a incoerência, **o Yuri confirmou explicitamente 5 em
2026-09-08**. Razão dele: se `ja-permutado` é estado de primeira classe, deixá-lo fora do header
**recria em menor escala exatamente o apagamento que este ciclo corrige** — os **13.434**
`ja-permutado` históricos sumiriam do agregado.

### 7. Invariante de convergência header ↔ snapshot

Header e snapshot da mesma run passam a bater **por construção** — mesmo predicado, uma fonte só de
contagem. Hoje divergem 329 × 677. Formalizada em
`ontology/business-rules/fidelidade-snapshot-eleicao.md` (invariante I5), com teste canônico.

### 8. Sincronização de drift documental na taxonomia de motivos

`nao-pago`, `sem-saldo-permutar` e `di-duimp-ambos` passam a constar das tabelas de motivo da
state-machine e da entity. **Não é mudança de taxonomia** — que segue fora de escopo deste ciclo:
esses motivos são produzidos pelo código desde 2026-06-19
(`ElegibilidadeService.motivoDoGateFalho`) e já estavam documentados em
`actions/avaliar-elegibilidade.md`; faltavam nos outros dois arquivos. Evidência de que são vivos e
não hipotéticos: `nao-pago` com **35 casos vivos** e **7.810 históricos**.

## Backfill — reconciliação, não heurística

Universo: **152.516 linhas** de snapshot, **250 runs**, período 2026-06-20 → 2026-09-08.

**Condição de determinismo:** **0** linhas com `status='bloqueada' AND motivo_bloqueio IS NULL`.
Todo registro histórico carrega o motivo que o classifica, então a reclassificação por motivo é
determinística sobre o universo inteiro. `multiplas-invoices` tem **0** ocorrências históricas.

**Validação cruzada (medida antes do commit) — o argumento forte.** Sobre as **250 runs
`kind='eleicao'`**:

| Agregado | Header (soma) | Snapshot reclassificado pela regra proposta |
|---|---|---|
| `total_bloqueadas` | **64.893** | **64.893** |
| `total_elegiveis` | **7.883** | **7.883** |

Batem **exatamente**. Isto muda a natureza da operação: o backfill **não é reconstrução heurística
a partir do motivo** — é **reconciliação com um valor íntegro já gravado**, que confirma a regra.
É verificável linha a linha antes do commit, e não depende de confiar na taxonomia de motivos: a
taxonomia está sendo *auditada* pelo header, não *assumida*.

**Linhas `kind='ingest'`:** as **264** existentes (250 `success` + 14 `error`) **não têm** linhas de
snapshot e têm os totais zerados. As colunas novas nascem `0` nelas **sem caso especial** — nenhum
ramo condicional no backfill.

**O header histórico também se move.** Com a Decisão 1 aplicada ao passado:

| Coluna | Antes | Depois |
|---|---|---|
| `total_bloqueadas` (soma, 250 runs) | 64.893 | **51.459** |
| `total_ja_permutado` (soma, 250 runs) | — | **13.434** |

O backfill **precisa reescrever `total_bloqueadas`**, e não apenas preencher as colunas novas: sem
isso a invariante de convergência (Decisão 7) **nasce violada no histórico** — o header diria 64.893
enquanto o snapshot reclassificado diria 51.459.

## Alternativas rejeitadas

- **(a) View de compatibilidade** preservando a projeção `elegivel|bloqueada`. Mantém a mentira
  disponível, com custo de manutenção permanente e **sem nenhum consumidor** que a justifique.
- **(b) Entidade nova para "adiantamento esgotado"** (`PermutaConcluida` / `AdiantamentoEsgotado`).
  É **estado** de `PermutaCandidata`, não entidade: o adto, o processo, a invoice e o aging são os
  mesmos; só o estado difere. Criar entidade duplicaria o agregado inteiro para representar uma
  transição.
- **(c) Corrigir só a leitura** (`mapSnapshotRow`). Não resolve nada: a informação já se perdeu na
  **escrita** — a coluna nunca chegou a conter o estado.

## Consequências

- **Séries históricas de "bloqueadas" mudam de significado** após o backfill. A queda de 677 → 249
  (run viva) e de 64.893 → 51.459 (agregado histórico) é **correção de classificação**, não melhora
  operacional. Qualquer relatório que compare antes/depois precisa dizer isso explicitamente, sob
  pena de repetir — com o sinal invertido — o erro que o relatório de impacto v1 cometeu.
- `bloqueada` passa a ter um significado único e defensável: **passivo dependente de terceiro ou de
  leitura**. É o número que pode ir para uma conversa com o cliente sem ressalva.
- O painel ao vivo (`GestaoPermutasService`) **não muda de comportamento** — ele já contava os 5
  estados corretamente. O que muda é que a derivação passa a **ler o estado** em vez de
  reconstruí-lo a partir do motivo.
- Migration `0054` e a remoção de rota/service/testes são **tarefas de implementação** (TaskScoper),
  não estrutura ontológica.
