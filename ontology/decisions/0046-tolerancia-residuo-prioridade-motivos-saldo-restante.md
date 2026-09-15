---
adr_number: 0046
title: "Tolerância de resíduo de R$1,00 na elegibilidade, prioridade completa dos motivos e saldo restante sem dupla contagem"
date: 2026-09-14
status: accepted
type: change
related_entities: [PermutaCandidata, Adiantamento, Permuta]
related_actions: [avaliarElegibilidade, elegerAdiantamentos, alocarPermuta, exporNoPainel]
related_business_rules: [elegibilidade-permuta, di-xor-duimp, fin010-write-contract]
related_state_machines: [elegibilidade-permuta-candidata, status-permuta-bordero]
evidence:
  - ontology/_inbox/permutas-saldo-ordem-centavos-interview.md
supersedes_decisions: []
amends_decisions: [0008, 0043]
closes_followups: [residual-pago-centavos]
---

# ADR 0046: resíduo de R$1,00 é zero, a falta de D.I não mascara pagamento, e o saldo restante não conta o consumido duas vezes

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Frente:** I — Permutas
**Branch:** `fix/permutas-saldo-ordem-centavos` · **Feature:** `/feature-tweak` `permutas-saldo-ordem-centavos`
**Decisões de negócio:** tech@kavex.at, 2026-09-14 (perguntas estruturadas na entrevista).
**Relacionado:** ADR-0008 (alocação N:M, I-Permuta-1), ADR-0020 (âncora I-Write-6, teto R$1,00),
ADR-0043 (`JA_PERMUTADO`), ADR-0044 (terminal `parcial`, `valor_residual_usd`).

## Contexto

Análise dos bloqueados do painel de Permutas com o banco real (ingestão 2026-09-14 15:36 UTC,
read-only). Três defeitos, um deles de **regra**:

### 1. Resíduo de centavos trava a fila (mudança de regra)

- Gate 2 hoje: `valorPermutar > 0`. Gate 3 hoje: `mnyTitAberto === 0` (estrito, decisão provisória do
  Yuri em 2026-06-18 no follow-up `residual-pago-centavos`, "manter estrito por ora").
- **28** adtos `permuta-manual` (INOX) já baixados seguem na fila com `valorPermutar` residual de
  USD 0,00–0,02 (R$ < 0,15). Ex.: docs 10208, 10571, 10865, 11286, 17081, 17872, 21145, 25895, 7639,
  9879. Todos anteriores à âncora I-Write-6 (commit c798bbf, 2026-07-17), que hoje já evita esse
  resíduo nas baixas novas.
- Doc **8721** (COPPER, proc 124): `mnyTitAberto` = **R$ 0,02** sobre R$ 20.373.009,89,
  `valorPermutar = 0`. Hoje `BLOQUEADA/nao-pago`.
- Resíduos **reais** que não podem ser absorvidos: R$ 21,01 / 327,10 / 1.472,06 / 1.621,34 /
  2.175,86 (docs 3754, 20418, 5885, 21841, 4576), em verificação com a Columbia.

### 2. "Sem D.I" mascara "não pago" e "já permutado" (bug de implementação)

A prioridade `nao-pago → (ja-permutado | sem-saldo-permutar) → di-duimp-ambos` estava documentada,
mas `data-base-indisponivel` não constava da lista, e o código (`ElegibilidadeService.ts:84-91`) o
devolve **antes** dos outros motivos. Dos **208** adtos `data-base-indisponivel`:

- **67 pagos e sem saldo** (INOX 1153: 63; proc 202: 4). **43** deles têm execução real `settled`
  pelo painel (**R$ 18,0 mi** baixados): permutas concluídas exibidas como "Bloqueada — Sem D.I" e
  fora do Histórico.
- **50 não pagos** (38 sem saldo, 12 com saldo): deveriam aparecer como "Não totalmente pago".

### 3. Saldo restante desconta o consumido duas vezes (bug de definição)

`saldoRestante = valorPermutar/taxa − Σ TODAS as alocações` (`GestaoPermutasService.ts:350-355`;
teto em `AlocacaoPermutasService.alocar`, `:241-257`). Mas `valorPermutar` (`mnyTitPermutar`) **já
vem abatido pelo ERP** para o que foi baixado em borderô **finalizado**. Evidência, 128 adtos com
execução real `settled`/`parcial`:

| `borVldFinalizado` do borderô | ERP abateu `mnyTitPermutar`? | adtos |
|---|---|---|
| 1 (finalizado) | **sim** | **125** (+4 com histórico 1,2) |
| 1 | não | 2 · "outro" 1 |
| 0 (em cadastro) | não | 2 |
| 2 / 2,3 | não | 4 |
| borderô ausente de `permuta_bordero` | não | 4 |

Em todos, `permuta_adiantamento.last_seen_at` é posterior à execução. **O ERP só abate quando o
borderô é finalizado.** Casos canônicos:

- adto **12860** (INOX): vmn USD 79.987,19; alocado 49.622,46 (borderô 19981 finalizado); ERP
  `valorPermutar/taxa` = 30.364,73. Tela: **−19.257,73** (sai da aba Cross-process). Correto: **30.364,73**.
- adto **9328**: vmn 75.000; alocado 35.347,53 (borderô 19534 finalizado); ERP 39.652,47. Tela e teto
  de nova alocação: **4.304,94**. Correto: **39.652,47**.
- adtos **9335, 9869, 9870** (borderôs 19254/19255/19256, ausentes do cache) e **10307** (borderô
  14944, `borVldFinalizado=2`): ERP **não** abateu, a alocação deve continuar descontando (hoje correto).

## Decisão

### D1. Tolerância absoluta de resíduo: R$ 1,00 (BRL), nos Gates 2 e 3

```
TOLERANCIA_RESIDUO_BRL = 1,00

gate2(adto) ⇔ valorPermutar  > TOLERANCIA_RESIDUO_BRL     // há saldo a permutar
gate3(adto) ⇔ |mnyTitAberto| ≤ TOLERANCIA_RESIDUO_BRL     // TOTALMENTE PAGO
```

- `valorPermutar ≤ R$1,00` = **sem saldo**: `ja-permutado` (estado `JA_PERMUTADO`) se
  `valorPermutado > 0`, senão `sem-saldo-permutar`.
- **Em aberto NEGATIVO (sobrepagamento) não é "pago".** O Gate 3 compara o **valor absoluto**: `mnyTitAberto = −R$ 34.088,65` (doc 4058, observado no ground truth de 2026-09-14) segue `nao-pago`, como já era com `=== 0` e como diz o flag estrito do ERP. Ler `≤ R$1,00` literalmente o aprovaria. Emenda da implementação (AutoLoopRunner), coberta por teste.
- O roteamento de cliente-filtro (T4, ADR-0007) usa **os mesmos predicados**: pago(≤ R$1,00) e
  saldo(> R$1,00).
- **Mesmo teto** da âncora I-Write-6 (`ReconciliacaoPermutaService` `limiteResiduo = 1`, ADR-0020),
  pelo mesmo motivo: absoluto e não proporcional, para que um saldo real pequeno de um adto grande
  nunca seja absorvido como "centavos". O ideal é **uma única constante de domínio** para os dois usos.
- **Escopo: a elegibilidade do ADIANTAMENTO.** Não muda o `pago` estrito do wire
  (`mapDetalheTitulos`, que também serve a invoices), nem `Invoice.pago` (aba "Invoices em aberto",
  `derivarPagoDosTitulos`), nem o `pago` dos títulos do SISPAG (`elegibilidade-titulo-lote`), nem a
  cobertura da baixa (I-Write-8a). Estender a tolerância a qualquer um deles exige decisão própria.
- **I3 muda de significado num ponto só:** "TOTALMENTE PAGO" passa a ser "em aberto ≤ R$ 1,00" e "há
  saldo a permutar" passa a ser "saldo > R$ 1,00". A estrutura de I3 (4 gates + INVOICE casada) não muda.

### D2. Prioridade completa e única dos motivos

```
1. nao-pago                                   (Gate 3)
2. ja-permutado  |  sem-saldo-permutar        (Gate 2; estado JA_PERMUTADO | BLOQUEADA)
3. data-base-indisponivel  |  di-duimp-ambos  (Gate 4; nenhuma | ambas as declarações)
4. casamento de invoice  (sem-invoice | composto-nm/multiplas-invoices | 1:1)
```

- A falta de D.I/DUIMP **nunca** mascara motivo de pagamento ou de saldo. Um adto pago, sem saldo e
  com `valorPermutado > 0` é `JA_PERMUTADO` mesmo sem D.I.
- O roteamento de cliente-filtro não muda: pago, com saldo e sem D.I segue
  `BLOQUEADA/data-base-indisponivel` na avaliação e é roteado para `PERMUTA_MANUAL`.
- **I2 (D.I XOR DUIMP) não muda.** Muda só a ordem em que o motivo é escolhido.

### D3. Saldo restante do adiantamento = saldo do ERP − alocações ainda não consumidas pelo ERP

```
saldoRestanteNeg(adto) = valorPermutar(BRL) / taxa  −  Σ naoConsumido(alocação do adto)

aplicavel(execução, aloc)  ⇔ execucao.criado_em ≥ alocacao.atualizado_em     // versão ATUAL da alocação

borderoConsumido(execução) ⇔ permuta_bordero (join por fil_cod, bor_cod)
                             com bor_vld_finalizado = 1 ∧ bor_cod_estornado IS NULL
                             // estornado vence; 2 = cancelado; 0/ausente = em cadastro
                           ∧ bordero.atualizado_em < started_at da ingestão que leu por último
                             o valorPermutar do adto (permuta_adiantamento.last_ingest_run_id)
                             // guarda de frescor

consumida(execução)        ⇔ dry_run = false ∧ status ∈ {settled, parcial}
                           ∧ aplicavel ∧ borderoConsumido

naoConsumido(aloc) = valor_alocado                            se não há execução consumida aplicável
                   = 0                                        se a execução consumida aplicável é settled
                   = min(valor_residual_usd, valor_alocado)   se a execução consumida aplicável é parcial
```

- **Não consumida** (continua descontando): rascunho sem execução, `pending`, `reconciling`, `error`,
  `settled`/`parcial` em borderô em cadastro, cancelado ou estornado, e borderô com **status
  desconhecido** (ausente do cache `permuta_bordero`). Também continua descontando a execução de uma
  **versão anterior** da alocação e a execução cujo borderô só foi visto finalizado **depois** do
  início da ingestão que carimbou o `valorPermutar`. Na dúvida, subestimar o saldo: isso nunca permite
  super-alocação.
- **Uma única fonte da regra** para todo lugar que desconta alocações do saldo do adto: a tela
  (`GestaoPermutasService`, `permuta-manual` e `casamento-manual`) e o teto de I-Permuta-1
  (`AlocacaoPermutasService.alocar`).
- **I-Permuta-1 continua** (`Σ alocado ≤ saldo a permutar`, ADR-0008). O que muda é que "alocado"
  passa a significar "alocado e ainda não abatido pelo ERP", porque o outro lado já vem líquido.
- **Por versão, não por soma do par.** `permuta_alocacao` tem **uma** linha por par. Re-alocar
  sobrescreve `valor_alocado` e `atualizado_em`, e a execução **não** guarda o valor que executou
  (`valor_baixado` está em BRL). O que as execuções de versões anteriores consumiram já saiu do
  `valorPermutar` do ERP e não está em nenhuma linha de alocação, então elas não abatem a versão
  atual. O casamento execução ↔ versão usa `criado_em ≥ atualizado_em` (mesmo relógio, o `now()` do
  Postgres), nunca o formato da chave de idempotência, que só ganhou o timestamp na v0.6.0.
- **Guarda de frescor.** O botão Finalizar grava `bor_vld_finalizado = 1` no cache na hora, mas o
  `valorPermutar` do adto só é relido na próxima ingestão. Por isso a execução só conta como consumida
  se o cache viu o borderô finalizado **antes** do início dessa ingestão. Para isso, o refresh do cache
  só renova `permuta_bordero.atualizado_em` quando a situação do borderô muda.

### D4. Histórico lista os `ja-permutado` com borderô do painel

Os adtos que passam a `JA_PERMUTADO` por D1/D2 e têm borderô gerado pelo painel continuam aparecendo
na aba Histórico, sem duplicar entrada (adto + borderô). É consequência de apresentação de D1/D2, não
estado novo.

## Consequências

- Os 28 resíduos INOX e o doc 8721 saem da fila. Os 67 pagos e sem saldo marcados como sem D.I viram
  `JA_PERMUTADO` ou `sem-saldo-permutar`. Os 50 não pagos marcados como sem D.I viram `nao-pago`. O
  bucket `data-base-indisponivel` do header da eleição **encolhe** e `total_ja_permutado` / `nao-pago`
  crescem: é correção, não regressão de dado.
- A tela e o teto de alocação de 12860 e 9328 passam a bater com o ERP. Os 4 não abatidos seguem
  descontando.
- **Sem janela de superestimação (D3):** um borderô finalizado **depois** do início da última ingestão
  continua descontando até a ingestão seguinte reler o `valorPermutar`. O saldo fica **subestimado**
  por até ~6h, que é o sentido seguro. Até a 1ª ingestão pós-deploy, as linhas antigas do cache têm
  `atualizado_em` posterior ao último `started_at` e seguem descontando, como hoje. O skew entre o
  relógio do app (`started_at`) e o do banco (`atualizado_em`) é de segundos, e as leituras de detalhe
  levam minutos depois do start. A baixa não revalida o saldo do adto ao vivo (follow-up).
- **Risco residual (D3), nomeado:** 2 adtos (+1 "outro") com borderô `borVldFinalizado=1` **não**
  tiveram o `mnyTitPermutar` abatido. Sem a guarda de frescor, eles contariam como consumidos e o saldo
  ficaria maior que o real, que é o sentido **não** conservador. A explicação provável é "finalizado
  depois da última ingestão", caso que a guarda já cobre. A validação ao vivo (GroundTruthValidator)
  precisa confirmar esses casos antes do merge. Se forem estorno ou cancelamento que o cache não
  refletiu, a regra fica como está. Se o ERP de fato não abateu, a regra ganha uma condição.
- Não muda nenhuma entidade, estado, transição ou taxonomia de motivos. Mudam dois predicados de gate
  (D1), a ordem de escolha do motivo (D2) e a definição de "alocado" em I-Permuta-1 (D3).
- Fecha o follow-up `residual-pago-centavos` (P2) **para o adiantamento**. `Invoice.pago` segue
  estrito. O gap herdado pelo SISPAG (`elegibilidade-titulo-lote`) segue aberto.
- Ontologia à frente do código até a implementação desta branch entrar (`_coverage.json` registra).

## Alternativas rejeitadas

- **R$ 0,10.** Cobre o doc 8721 (R$ 0,02) e a maioria dos resíduos INOX (R$ < 0,15), mas não todos. E
  cria um segundo teto ao lado do R$1,00 da âncora I-Write-6, que já absorve resíduo de
  arredondamento de taxa. Dois tetos para o mesmo fenômeno divergiriam.
- **USD 0,05 na moeda negociada.** O resíduo nasce do arredondamento da taxa, que escala com o valor,
  e o ERP informa `mnyTitAberto`/`mnyTitPermutar` em **BRL**. Converter para aplicar o teto mete a taxa
  (arredondada a 3 casas) dentro do próprio teste de arredondamento. Também quebra a paridade com
  I-Write-6.
- **Tolerância só no Gate 2.** Resolve os 28 resíduos de saldo, mas deixa o 8721 (`aberto` = R$ 0,02,
  saldo 0) bloqueado como `nao-pago`. Pago e saldo são as duas faces do mesmo resíduo.
- **Tolerância proporcional (% do valor).** Rejeitada pelo mesmo argumento de I-Write-6: num adto de
  R$ 20 mi, 0,01% já absorveria R$ 2.000, que é saldo real.
- **Subtrair todas as alocações (status quo).** Conta duas vezes o que o ERP já abateu (125 de 128
  casos). Produz saldo negativo (12860) e trava alocação legítima (9328).
- **Não subtrair nenhuma alocação** (confiar só no `valorPermutar`). Permitiria super-alocar sobre
  rascunhos e execuções em borderô ainda em cadastro, que o ERP não abateu (9335/9869/9870/10307).
- **Somar o baixado de todas as execuções consumidas do par, com piso zero.** Superestima o saldo
  justamente na parcial re-alocada. Ex.: alocado 100, parcial com resíduo 10 em borderô finalizado (o
  ERP abate 90), e o analista re-aloca o par para 10. A fórmula dá `max(0, 10 − 90) = 0`: o saldo fica
  10 acima do real e permite super-alocação. A regra por versão dá 10. E nem seria computável, porque a
  execução não guarda o 100.
- **Aceitar a janela de ≤ 6h sem guarda de frescor.** Logo depois de Finalizar pelo painel, o cache já
  diz "finalizado", mas o `valorPermutar` ainda não foi abatido. O adto voltaria à aba de trabalho com o
  saldo cheio e o teto do `alocar` aceitaria alocar de novo o mesmo valor. Esse é o caminho **mais
  comum**, não um canto raro, e fere o princípio "subestimar nunca permite super-alocação".
- **Subtrair só as alocações sem execução `settled`, independente do status do borderô.** Trata como
  consumido o que está em borderô em cadastro, cancelado, estornado ou fora do cache, casos em que o
  ERP **não** abateu (8 adtos na evidência). Superestima o saldo, que é o sentido perigoso.
