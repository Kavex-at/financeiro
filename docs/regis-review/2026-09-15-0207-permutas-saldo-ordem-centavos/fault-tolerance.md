---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-fault-tolerance
generated_at: 2026-09-15T02:07:00-03:00
scope: backend
score: 8.5
findings_count: 6
cards_count: 3
---

# Fault Tolerance — Regis-Review

> **Escopo estrito do delta** (`git diff origin/main..HEAD`, commits `74d65e6…9b6097e`). Este QA é o
> dono do delta: o objetivo é NÃO deixar o novo `saldoRestante` habilitar dupla-baixa,
> super-alocação ou terminal errado quando o mundo falha no meio. Verificação adversarial:
> traçando `SaldoAlocacaoAdiantamentoService`, `PermutaExecucaoRepository.listConsumosFinalizados`,
> `ToleranciaResiduo`, e os call sites em `AlocacaoPermutasService.alocar` /
> `GestaoPermutasService.exporGestao`, sem confiar em teste passando. Findings pré-existentes que
> continuam abertos (reaper de `parcial`, runbook de rollback, F1 baixa lê saldo do banco) NÃO são
> re-abertos aqui — permanecem no follow-up do run `2026-09-08-1955-permutas-baixa-integridade` e no
> tasks/interview desta feature (F1). Só re-flago quando o delta os PIORA.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica **Finalizar** no painel de Borderôs às 14:00 (borderô 19981 do adto 12860, USD 49.622,46) | Cache local grava `bor_vld_finalizado=1` na hora; próxima ingestão só às 20:00 | `SaldoAlocacaoAdiantamentoService.somaNaoConsumida` + `PermutaExecucaoRepository.listConsumosFinalizados` (guarda de frescor `b.atualizado_em < r.started_at`) | Prod pós-deploy, `permuta_adiantamento.last_ingest_run_id` ainda apontando para a run das 14:00 (`started_at=13:52`) | Execução NÃO conta como consumida até a ingestão seguinte reler `mnyTitPermutar` — `saldoRestante = valorPermutar/taxa − valorAlocado` (subestima em USD 30.364,73 por até ~6h). Teto do `alocar` recusa nova alocação sobre o adto até lá | **0** super-alocações no adto 12860 na janela pós-Finalizar; **0** baixas com resíduo de dupla-contagem; UX conservadora aceita — a ADR-0046 D3 documenta esse trade-off explicitamente |
| Analista re-abre um adto pago cuja `mnyTitPermutar` caiu a R$ 0,15 (INOX, 28 casos) e o ERP tem `mnyTitPermuta > 0` | `ElegibilidadeService.avaliarElegibilidade` é chamado com `valorPermutar=0.15`, `valorPermutado=5000`, sem declaração | `ElegibilidadeService.motivoDoGateFalho` (prioridade única — ADR-0046 D2) + `ToleranciaResiduo.semSaldoPermutar` | Prod, ADR-0046 aplicada; adto anteriormente exibido como `BLOQUEADA/data-base-indisponivel` | Adto vira `JA_PERMUTADO/ja-permutado` (terminal correto); o Histórico lista ele com o borderô do painel (Fix 4) — não some do olho do analista | **43** INOX (R$ 18,0 mi baixados) migram para `ja-permutado`; **0** adtos executados aparecendo como "Bloqueada — Sem D.I"; **0** entradas duplicadas no Histórico (dedupe por `${docCod}:${borCod}`) |
| Analista re-clica **Salvar** numa alocação já SETTLED (par adto↔invoice já baixado) | `PermutaAlocacaoRepository.upsertAlocacao` faz ON CONFLICT → `atualizado_em = now()` incondicional | `SaldoAlocacaoAdiantamentoService.naoConsumido` (regra por versão: `execucao.criadoEm >= alocacao.atualizadoEm`) | Prod, alocação com execução `settled` histórica | Execução SETTLED antiga (criadoEm < novo atualizadoEm) deixa de ser aplicável → `naoConsumido = valorAlocado` (integral) → `saldoRestante` cai; teto do `alocar` recusa reuso do saldo até nova baixa | **0** super-alocação por re-save acidental; saldo restante SUBESTIMADO (fail-safe) até re-execução criar nova versão |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Fonte única da regra "consumido" (tela + teto do `alocar`) | 1 (`SaldoAlocacaoAdiantamentoService`) — mesmo método `naoConsumido/somaNaoConsumida` chamado em `GestaoPermutasService.exporGestao` e `AlocacaoPermutasService.alocar` | 1 | ✅ | `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:44-102`; call sites `GestaoPermutasService.ts:74-91,343-348`; `AlocacaoPermutasService.ts:242-257` |
| Guarda de frescor `b.atualizado_em < r.started_at` no SQL de consumos | presente (INNER JOIN `permuta_eleicao_run r ON r.id = a.last_ingest_run_id`) | presente | ✅ | `PermutaExecucaoRepository.ts:188-211` |
| `replaceBorderoCache` só bump `atualizado_em` quando situação muda | `CASE WHEN … IS DISTINCT FROM … THEN now() ELSE permuta_bordero.atualizado_em END` — para `bor_vld_finalizado` E `bor_cod_estornado` | conditional | ✅ | `PermutaExecucaoRepository.ts:580-583`; mesmo padrão em `updateBorderoCacheSituacao:604-608` |
| `updateBorderoCacheSituacao` (Aprovar/Cancelar no painel) usa a MESMA regra | idem | idem | ✅ | `PermutaExecucaoRepository.ts:604-608` |
| Join do consumo por PAR completo `(fil_cod, bor_cod)` (borCod é sequencial POR FILIAL) | `JOIN permuta_bordero b ON b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod` | PK completa | ✅ | `PermutaExecucaoRepository.ts:195` |
| Regra "por versão" no matching execução↔alocação (`criadoEm >= atualizadoEm`) | mesmo relógio (Postgres `now()` em `upsertAlocacao` e `beginExecution`) | mesmo relógio | ✅ | `SaldoAlocacaoAdiantamentoService.ts:53-58`; `PermutaAlocacaoRepository.ts:79`; `PermutaExecucaoRepository.ts:347` |
| `parcial` com `valor_residual_usd` respeitado (min piso 0, teto no `valorAlocado`) | `Math.min(Math.max(0, maisRecente.valorResidualUsd), alocacao.valorAlocado)` | fail-safe nos dois lados | ✅ | `SaldoAlocacaoAdiantamentoService.ts:67`; teste `SaldoAlocacaoAdiantamentoService.test.ts` (valor 100/resíduo 10 = 10; resíduo 150 = 100; resíduo undefined = 100) |
| `mapConsumo` filtra status fora de `settled`/`parcial` (defesa em profundidade contra CHECK futuro) | guard explícito, `return null` — sem cast `as` | fail-closed | ✅ | `PermutaExecucaoRepository.ts:630-642` |
| `ToleranciaResiduo` reusa **UMA** constante (baixa + gates) — `LIMITE_BRL = 1` | 1 (âncora I-Write-6 = gate 2 = gate 3) | 1 | ✅ | `src/backend/domain/interface/permutas/ToleranciaResiduo.ts:22`; consumido em `ElegibilidadeService.ts:78`; `EleicaoPermutasService.ts:806,820`; `ReconciliacaoPermutaService.ts:935` |
| `adiantamentoTotalmentePago` usa `Math.abs(valorAberto)` (blinda contra sobrepagamento negativo) | `abs` presente; doc 4058 (`mnyTitAberto = −R$ 34.088,65`) segue `nao-pago` no ground truth | `abs` + doc de motivo | ✅ | `ToleranciaResiduo.ts:38-46` (docblock + implementação); ground-truth `validate-permutas-saldo-ordem-centavos-v1.ts:V2` — 1 EXPLICADO |
| Comparação em CENTAVOS (evita float noise na fronteira) | `Math.round(v * 100) <= LIMITE_BRL * 100` | inteiros | ✅ | `ToleranciaResiduo.ts:48-49`; teste `ToleranciaResiduo.test.ts` cobre `0.1+0.2`, `1.0000000001` na fronteira |
| Cap do `alocar` fail-safe quando saldo já negativo | `valorAlocado > saldoAdtoNeg − jaAdto + 0.005` → recusa se `saldoAdtoNeg − jaAdto ≤ 0` | recusa | ✅ | `AlocacaoPermutasService.ts:247-257` |
| Rollback do delta seguro (sem migration nova) | `git diff --stat --diff-filter=A -- 'src/backend/migrations/**'` → 0 arquivos; a única mudança de schema seria conceitual (semântica de `atualizado_em`), retro-compatível | forward-only sem CHECK novo | ✅ | delta commits `74d65e6…9b6097e` — nenhum `src/backend/migrations/` |
| Compensation atômica em `criarRascunhosAtomico` (auto-alocação em lote) preservada | remove os já criados no meio se `alocar` falhar; delta só INJETA o novo serviço, não muda o path | preservado | ✅ | `AlocacaoPermutasService.ts:395-437` |
| Ground-truth AO VIVO 247 linhas, 0 DIVERGENTE (V1 saldo + V2 gates + V3 fronteira) | 247 EXATO/OK_CENTAVO + 6 EXPLICADO + 1 SEM_GROUND_TRUTH | 0 DIVERGENTE | ✅ | `_shared-metrics.md` linha "Ground truth LIVE"; script `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` |
| Cobertura da baixa contra saldo AO VIVO do adto (F1 do interview) | ausente — `ReconciliacaoPermutaService.reconciliarSerializado:189` chama `findAdiantamento` (DB), não `getDetalheTitulos` | live check | ⚠️ (herdado, delta não muda) | `ReconciliacaoPermutaService.ts:189,198` |
| Robustez a **borCod reuse** por estorno + realocação do número (bordos terminais) | JOIN `(fil_cod, bor_cod)` casa o número em uso NO MOMENTO do query; se um novo borderô X reusar código depois de estorno do velho, execução antiga (settled/parcial ainda com `bor_cod = X`) casaria com o novo | ver F-fault-tolerance-2 | ⚠️ | `PermutaExecucaoRepository.ts:195` + evidência de reuso em `clearBorCod` docblock `:288-296` (obs de prod) |
| Baseline de testes do delta | 135 suites / 1953 testes back + 40 suites / 328 testes front — 0 falhas | verde | ✅ | `_shared-metrics.md` "Gate results at green" |

⚠️ **Não medível localmente**: frequência real de reuso de `bor_cod` para execuções TERMINAIS (settled/parcial estornadas + código reusado). Evidência de reuso EXISTE para `error` executions (bor 2436, 2771 documentados em `clearBorCod`); para terminais é probabilística. Recomendação: instrumentar contador `permuta_bordero_reuso_terminal` na próxima ingestão (`COUNT DISTINCT (fil_cod, bor_cod)` × execuções terminais por PAR + timestamp anterior/posterior).

⚠️ **Não medível localmente**: skew de relógio real app↔Postgres (`started_at` vem de `new Date()` no Node, `atualizado_em` do `now()` do Postgres). Direção fault-tolerant: SUBESTIMAR consumo → conservador (não permite super-alocação); só piora UX (saldo aparece menor). Recomendação: healthcheck periódico logando `SELECT now() - $appNow` e alertando se |skew| > 30s.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — sem hot spare para `mnyTitPermutar` do ERP; leitura é síncrona ao vivo na ingestão | N/A | — |
| Replacement | N/A | N/A | — |
| Predictive Model | Cap do `alocar` predice a super-alocação ANTES do POST no ERP (`saldoAdtoNeg − jaAdto + 0.005 < valorAlocado` ⇒ `AlocacaoSaldoError`) | ✅ | `AlocacaoPermutasService.ts:247-257` |
| Increase Competence Set | Fresco-guard NUNCA aceita bordero cujo status é desconhecido (`b.atualizado_em ≥ r.started_at` ⇒ não consumido); linha ausente do cache ⇒ INNER JOIN exclui ⇒ não consumido — fail-closed em todos os `?` | ✅ | `PermutaExecucaoRepository.ts:195,197,202` |
| Sanity Checking | `Math.round(v*100)` em centavos elimina ruído de float; `Math.abs(valorAberto)` blinda sobrepagamento; `Math.max(0, valorResidualUsd)` e `Math.min(...alocado)` blindam resíduo perverso | ✅ | `ToleranciaResiduo.ts:38-49`; `SaldoAlocacaoAdiantamentoService.ts:67` |
| Comparison | Ground-truth script `validate-permutas-saldo-ordem-centavos-v1.ts` compara nosso `naoConsumido` com o `mnyTitPermutar/taxa − Σ consumidos` do ERP para 247 linhas (tolerância R$0,01/USD 0,01) | ✅ | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts`; resultado em `_shared-metrics.md` |
| Voting | N/A — sem replicação | N/A | — |
| Timestamp | `criadoEm >= atualizadoEm` — mesmo relógio (Postgres `now()`) no `beginExecution` (execução) E no `upsertAlocacao` (versão da alocação) | ✅ | `PermutaExecucaoRepository.ts:333,347`; `PermutaAlocacaoRepository.ts:65,79` |
| Timeout | herdado do `ConexosClient` (fora do delta) | ✅ (herdado) | — |
| Condition Monitoring | GTV live script rodou e anexou resultados ao PR; **mas** nenhum job rotineiro compara consumido↔ERP após deploy (mesmo gap herdado do run anterior — F1 daquele) | ⚠️ herdado | `_shared-metrics.md` (script one-off); ausência do reaper documentada em `docs/regis-review/2026-09-08-1955-permutas-baixa-integridade/fault-tolerance.md` |
| Self-Test | N/A | N/A | — |
| Redundancy | N/A | N/A | — |
| Rollback | Delta é **puramente code-only** (sem migration nova); revert seguro do commit `9b6097e…74d65e6` retorna a implementação antiga sem perder dado — `permuta_bordero.atualizado_em` volta ao regime anterior (renovado a todo refresh), o que faz o guard velho seguir subestimando (comportamento pré-delta), NÃO super-alocação | ✅ | `git diff --stat --diff-filter=A -- 'src/backend/migrations/**'` = 0; `PermutaExecucaoRepository.ts:580-583` (mudança semântica retro-compatível) |
| Repair State / Reintroduction | Rescreve `permuta_bordero` a cada refresh (`replaceBorderoCache`) sem perder o carimbo semântico; a 1ª ingestão pós-deploy reconstrói consumo consistente sem intervenção humana | ✅ | `PermutaExecucaoRepository.ts:556-592`; ADR-0046 "Consequências" ("até a 1ª ingestão pós-deploy, seguem descontando, como hoje") |
| Idempotent Replay | `SaldoAlocacaoAdiantamentoService` é 100% puro sobre `AlocacaoVersao[]` + `ConsumoExecucaoRow[]` — mesma entrada, mesma saída, sem side effects; call site (`alocar`) refresca a lista a cada chamada | ✅ | `SaldoAlocacaoAdiantamentoService.ts:50-79`; `AlocacaoPermutasService.ts:247` (query fresca por request) |
| Compensating Transaction | `criarRascunhosAtomico` (herdado) — reverte os já criados se um `alocar` falhar; delta INJETA o novo serviço sem quebrar o path | ✅ (herdado, preservado) | `AlocacaoPermutasService.ts:395-437` |
| Reconcile (Gray & Reuter §11) | script GTV é uma reconciliação MANUAL 1× (247 linhas). Sem job periódico DB↔ERP (dívida herdada de `2026-09-08-1955`, não do delta) | ⚠️ herdado | — |
| Quarantine | `mapConsumo` retorna `null` para status inesperado (fail-closed em vez de crash) — defesa em profundidade se o CHECK do banco for expandido no futuro | ✅ | `PermutaExecucaoRepository.ts:630-642` |
| Human-in-the-Loop / MTTR (autoral) | Fix 4 — adtos `ja-permutado` com borderô aparecem no Histórico (não somem do olho); o card `jaPermutado` da tela conta os sem-borderô também | ✅ | `historico.ts:75-83`; `page.tsx:559-561`; `GestaoPermutasService.ts:342-348` |

## 4. Findings (achados)

### F-fault-tolerance-1: Guarda de frescor `b.atualizado_em < r.started_at` — semânticas alinhadas, direção fail-safe verificada

- **Severidade**: N/A — verificação da mudança principal do delta.
- **Tactic (posit)**: Sanity Checking + Timestamp + Increase Competence Set.
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211` (`listConsumosFinalizados`) + `:580-583`/`:604-608` (`replaceBorderoCache`/`updateBorderoCacheSituacao` só bump quando situação muda).
- **Evidência (traçada)**:
  - INNER JOIN triplo: `permuta_alocacao_execucao e` × `permuta_bordero b (fil_cod, bor_cod)` × `permuta_adiantamento a (last_ingest_run_id)` × `permuta_eleicao_run r (id)`. Adto sem `last_ingest_run_id` (fresco) ⇒ NENHUM consumo devolvido ⇒ `saldoRestante = valorPermutar/taxa − Σ TODAS alocações` (mesmo comportamento pré-delta, conservador).
  - Filtro `b.atualizado_em < r.started_at`: um borderô finalizado DEPOIS do início da run corrente NÃO conta como consumido. Rodada seguinte o `started_at` avança → passa a contar. Documentado em ADR-0046 D3 ("subestimar ≤ 6h").
  - `replaceBorderoCache` (ingestão + botão "Atualizar" da tela de Borderôs) e `updateBorderoCacheSituacao` (Aprovar/Cancelar do painel) usam `CASE WHEN … IS DISTINCT FROM … THEN now() ELSE permuta_bordero.atualizado_em END` — o carimbo só avança quando a **situação** (finalizado/estornado) muda, então o "Atualizar" não desfaz o consumo.
  - **Direção de skew app↔DB analisada**: `started_at` vem de `new Date()` no Node (`IngestaoPermutasService.ts:74`); `atualizado_em` vem do `now()` do Postgres. Toda combinação de skew (app ahead / behind, borderô finalizado logo antes / depois) resulta em SUBESTIMAR o consumo (⇒ subestimar `saldoRestante`), que é o sentido conservador. Nenhuma janela em que skew cause super-alocação.
- **Sem card** — mudança principal do delta verificada; a regra é fail-safe em todos os cantos analisados.

### F-fault-tolerance-2: Reuso de `bor_cod` para execuções TERMINAIS pode fazer `listConsumosFinalizados` casar com bordero errado (P2)

- **Severidade**: **P2** — probabilidade **baixa** (requer estorno + reuso do mesmo `(fil_cod, bor_cod)` para outro adto), impacto **médio** (dupla-contagem invertida: alocação legítima aparece como "consumida" ⇒ `saldoRestante` OVERSTATED em até `valorAlocado`).
- **Tactic violada**: Sanity Checking (identidade estável do borderô ao longo do tempo — assumida, não verificada).
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211` (`listConsumosFinalizados` — JOIN por `(fil_cod, bor_cod)`) + `:288-296` (docblock do `clearBorCod` documentando reuso observado em produção).
- **Evidência (traçada)**:
  - `bor_cod` é sequencial POR FILIAL. O docblock de `clearBorCod` documenta reuso REAL em prod: "o borderô 2771 da execução 399 hoje contém baixas do doc 6708; o 2436 da execução 341, do doc 5155". `clearBorCod` só limpa linhas `status='error'`. Linhas `settled`/`parcial` mantêm o `bor_cod` original **para sempre**.
  - Cenário (interleaving concreto):
    1. Adto A tem execução `settled` no par (adto A, invoice X), `bor_cod = 1824`, `fil_cod = 1`. `permuta_bordero(1, 1824)`: `bor_vld_finalizado=1`. ERP abateu `mnyTitPermutar` do A.
    2. Yuri estorna o borderô 1824 no ERP. Próxima ingestão marca `bor_cod_estornado != NULL` na row do cache. Filtro `bor_cod_estornado IS NULL` falha ⇒ NÃO conta como consumido ⇒ alocação do A é descontada de novo (correto — o ERP restaurou o `mnyTitPermutar`).
    3. Meses depois, ERP cria um NOVO borderô com número `1824` na filial `1` (para OUTRO adto B). Cache antigo é DELETADO (via `deleteBorderoCache` ou pelo `DELETE ... NOT IN (...)` no fim de `replaceBorderoCache`); insert novo cria `permuta_bordero(1, 1824)` com `bor_cod_estornado = NULL, bor_vld_finalizado = 1` (finalizado).
    4. `atualizado_em` do novo cache = `now()` do momento da (in)finalização. Se a próxima ingestão inicia depois disso, filtro passa ⇒ execução ANTIGA do adto A (que ainda tem `bor_cod = 1824, fil_cod = 1` na trilha) casa com o NOVO borderô do adto B ⇒ conta como consumida ⇒ `naoConsumido(alocação_A) = 0` ⇒ `saldoRestante(A) = valorPermutar/taxa − 0` (superestima em `valorAlocado`).
    5. Teto do `alocar` aceita re-alocar sobre o adto A. Se o baixa vier depois, ela também acha que tem saldo — a única defesa nesse ponto é a pré-checagem I-Write-8a (que confere Σ em-aberto vivo dos títulos da INVOICE, não o `mnyTitPermutar` do ADTO). Uma segunda baixa que não estoure em outro par pode causar `parcial` inesperado.
  - Guarda de frescor NÃO cobre este cenário: ela é temporal, o reuso é de identidade. Como o `bor_cod` da execução velha aponta agora para uma row de cache legitimamente finalizada há tempo, o filtro passa.
  - **Contra-medida existente parcial**: `deleteBorderoCache` para o borderô velho não zera o `bor_cod` das execuções `settled/parcial` (só `clearBorCod` faz, e só para `error`). A trilha guarda o número original.
  - **Frequência real**: sem baseline (a instrumentação sugerida na Seção 2 não existe). Estimativa razoável: baixa — estorno de borderô já finalizado é evento raro; reuso do mesmo par (filial, número) dentro do mesmo tenant também.
- **Impacto técnico**: `saldoRestante` maior que a realidade em `valorAlocado` da execução antiga; teto do `alocar` deixa passar re-alocação; baixa subsequente pode virar `parcial` com resíduo inesperado.
- **Impacto de negócio**: risco monetário limitado ao valor da alocação antiga do par estornado. Recuperação: a próxima ingestão relê `mnyTitPermutar` do adto A (que o ERP restaurou), então `valorPermutar/taxa` desce e o teto se ajusta — janela ≤ 6h.
- **Métrica de baseline**: 0 casos observados em produção (evidência de reuso existe para `error`, não para terminais); 0 job de detecção. **P2 justificado: sem baseline numérico e cenário requer 3 condições simultâneas.**

### F-fault-tolerance-3: Baixa continua lendo saldo do adto do banco (não live) — delta NÃO piora, mas expõe saldos maiores ao analista (P2 herdado)

- **Severidade**: **P2** — pré-existente (F1 do interview); o delta NÃO altera `ReconciliacaoPermutaService.reconciliarSerializado:189` (`findAdiantamento(DB)`), mas AGORA a tela mostra números CORRETOS e (para 128 adtos) MAIORES do que antes. Analista tende a alocar mais.
- **Tactic violada**: Sanity Checking (validação AO VIVO do saldo do adto no momento da baixa).
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:189` (`findAdiantamento`) + `:198` (`saldoNegDoAdto(adto.valorPermutar, adto.taxa)`) — mesmo comportamento pré-delta.
- **Evidência (traçada)**:
  - `reconciliarSerializado` chama `findAdiantamento` (DB, snapshot da última ingestão). `saldoAdtoNeg` deriva do `valorPermutar` gravado. É usado APENAS como âncora de resíduo (`ancorarVariacaoNoAdto`, R$1,00) — não gate de cobertura.
  - Cobertura por título (`assertCobertura` I-Write-8a) usa em-aberto vivo dos títulos (`getDetalheTitulos` da INVOICE), não do adto. O anti-drift em cada `baixarTitulo` também é per-título.
  - **Pior caso**: entre a última ingestão (adto 12860 mostra `saldoRestante = 30.364,73`) e a baixa, alguém no ERP mexe manualmente no adto — a baixa não perceberia até a próxima ingestão. Mas nada trava o `alocar` de super-alocar sobre um adto que o ERP já esvaziou por fora.
  - **Delta impact**: antes, para os 128 adtos afetados, `saldoRestante` era zero/negativo e o teto do `alocar` já rejeitava. Agora é o valor CORRETO — 30.364,73 no caso do 12860 — o que é o COMPORTAMENTO PRETENDIDO. Não é uma regressão FT, é a consequência esperada de corrigir a dupla-contagem. F1 continua sendo uma dívida atacável por conta própria.
- **Sem novo card** — já está no follow-up F1 do tasks do delta. Este finding só documenta que o delta NÃO piora nem melhora o gap.

### F-fault-tolerance-4: Delta puramente code-only — rollback trivial (sem migration nova)

- **Severidade**: N/A — verificação de rollback.
- **Tactic (posit)**: Rollback.
- **Localização**: `git diff --stat origin/main..HEAD -- 'src/backend/migrations/**'` → 0 arquivos.
- **Evidência (traçada)**:
  - Nenhum arquivo em `src/backend/migrations/` no delta (confirmado no `_shared-metrics.md`, seção "Delta"; nenhum arquivo `0057_*` ou similar).
  - Mudança semântica em `permuta_bordero.atualizado_em` (CASE conditional) é retro-compatível: se o código voltar ao regime pré-delta (renovar sempre), `listConsumosFinalizados` — que sumiria do código — deixaria de importar. Enquanto o novo query estiver instalado, um cache com `atualizado_em` renovado a cada refresh apenas SUBESTIMA consumo (`b.atualizado_em ≥ r.started_at` mais frequente ⇒ menos consumos ⇒ menos desconto ⇒ conservador).
  - `ToleranciaResiduo.LIMITE_BRL = 1` reusa a mesma constante já em produção no `ReconciliacaoPermutaService` (I-Write-6 desde ADR-0020, `limiteResiduo = 1`) — apenas moveu para uma classe compartilhada. Rollback do delta continua tendo o teto igual em ambos os lados.
  - `beginExecution` e `markSettled/markParcial` NÃO foram tocados por este delta — a proteção contra dupla-baixa por rollback do delta `parcial` (ADR-0044, cardado em `2026-09-08-1955-permutas-baixa-integridade` como card `fault-tolerance-2`) segue como estava, sem novo risco.
- **Sem card** — em contraste com o delta `parcial`, este delta é code-only e retro-compatível; nenhum runbook novo é necessário.

### F-fault-tolerance-5: Fronteira de tolerância (R$ 1,00) tem cobertura de fronteira e blinda sobrepagamento negativo

- **Severidade**: N/A — verificação da mudança de regra.
- **Tactic (posit)**: Sanity Checking.
- **Localização**: `src/backend/domain/interface/permutas/ToleranciaResiduo.ts:22-49`; teste `ToleranciaResiduo.test.ts` + ground-truth V3.
- **Evidência (traçada)**:
  - Comparação em CENTAVOS (`Math.round(v*100) <= 100`) elimina float noise. Teste verifica `0.1 + 0.2` e `1.0000000001` na fronteira → veredito estável.
  - `Math.abs(valorAberto)` blinda sobrepagamento negativo (doc 4058, `mnyTitAberto = −R$ 34.088,65` observado no GTV live). Sem `abs`, `−34.088,65 ≤ 1` seria TRUE e o adto vira "pago" indevidamente. Com `abs`, `34.088,65 > 1` → segue `nao-pago` (correto — anomalia, não resíduo).
  - `valorAberto` ausente E `pago` ausente ⇒ `false` (conservador; NUNCA inferimos pago sem prova). Documentado no docblock.
  - Fronteira exata (R$ 1,00 = paga; R$ 1,01 = não-paga) coberta pelos testes; ADR nomeia como SEM_GROUND_TRUTH (V3) porque não há documento real EXATAMENTE em 1,00/1,01, então a garantia é o teste unitário — aceitável dado o custo de fabricar um documento real no ERP.
  - Escopo cirúrgico: `ConexosTitulosClient.mapDetalheTitulos` (wire) NÃO foi alterado (`git diff` vazio no arquivo — critério aceito pela Task 2). Invoice, SISPAG e cobertura da baixa (I-Write-8a) SEGUEM ESTRITO — a tolerância só entra na hidratação do adiantamento (`EleicaoPermutasService.buildCandidata`). Não há vazamento semântico.
- **Sem card** — mudança verificada; a única emenda (`abs` do valor aberto negativo) foi cardada pelo AutoLoopRunner e coberta por teste ANTES do merge.

### F-fault-tolerance-6: Prioridade única dos motivos + Histórico de `ja-permutado` — sem duplicação, sem perda de visibilidade

- **Severidade**: N/A — verificação de Fix 2 + Fix 4.
- **Tactic (posit)**: Human-in-the-Loop / MTTR + Idempotent Replay (dedupe).
- **Localização**: `ElegibilidadeService.ts:132-172` (`motivoDoGateFalho` — prioridade única) + `historico.ts:44-116` (`montarHistorico` — dedupe).
- **Evidência (traçada)**:
  - `motivoDoGateFalho` é o ÚNICO lugar que resolve motivo — não há mais early-return em `avaliarElegibilidade`. Estado (`JA_PERMUTADO` vs `BLOQUEADA`) é DERIVADO do motivo, não recalculado no call site. Um adto pago+sem-saldo+valorPermutado>0 vira `JA_PERMUTADO` mesmo sem D.I (fix do bloqueio "Sem D.I mascarando ja-permutado").
  - Roteamento cliente-filtro (`EleicaoPermutasService.ts:820`) usa os MESMOS predicados (`ToleranciaResiduo.semSaldoPermutar`) → um adto com resíduo R$ 0,15 não é roteado para `PERMUTA_MANUAL` (deixa de aparecer na fila de trabalho, correto).
  - `historico.ts` monta o histórico com dedupe por `${adtoDocCod}:${borCod}` (Map). Ordem de push: casamentosSugeridos → múltiplas → cross-over → cross-process → jaPermutados. Um adto que estava em `permuta-manual` e migrou para `ja-permutado` (Fix 3) não pode aparecer nas duas listas simultaneamente (status é único no snapshot).
  - Adtos `ja-permutado` SEM `statusPorAdto[docCod]` (permuta feita fora do painel) NÃO aparecem no Histórico — visibilidade é via o card contador `jaPermutado` da home. Consciente (docblock em `GestaoPermutasService.ts:347-348`).
  - `tipoDoJaPermutado` deriva o rótulo (`Cross-process` vs `Já permutado`) das alocações REAIS (`invoicePriCod ≠ detalhe.priCod`), não do cadastro de cliente-filtro (que muda com o tempo). Reflete o que DE FATO aconteceu.
- **Sem card** — verificado; o único risco residual é o adto `ja-permutado` sem borderô do painel ficar apenas no card contador, o que é intencional (o painel de trabalho não deve poluir com adtos que nada tem para fazer).

## 5. Cards Kanban

### [fault-tolerance-1] Instrumentar detecção de reuso de `bor_cod` para execuções terminais

- **Problema**
  > `listConsumosFinalizados` (`PermutaExecucaoRepository.ts:188-211`) casa execução↔borderô por `(fil_cod, bor_cod)` — a PK do cache. Prod já mostra reuso de `bor_cod` para execuções `error` (documentado em `clearBorCod:288-296`); não temos evidência de reuso PARA execuções terminais (`settled`/`parcial`), mas o cenário requer só 3 condições: estorno do borderô original + reuso do número + finalização do novo. Se ocorrer, o `saldoRestante` do adto antigo é OVERSTATED em `valorAlocado` (execução antiga é contada como consumida indevidamente), habilitando super-alocação — a única defesa a jusante é a pré-checagem I-Write-8a por título da INVOICE, que não confere `mnyTitPermutar` do ADTO.

- **Melhoria Proposta**
  > (1) Query de detecção diária no `permuta_bordero` + `permuta_alocacao_execucao`: `SELECT (fil_cod, bor_cod), COUNT(DISTINCT adiantamento_doc_cod) AS adtos_distintos FROM permuta_alocacao_execucao WHERE bor_cod IS NOT NULL AND status IN ('settled', 'parcial') GROUP BY 1 HAVING COUNT(DISTINCT adiantamento_doc_cod) > 1` — qualquer resultado indica reuso terminal e é alerta imediato. (2) Se aparecer, avaliar `clearBorCod` também para `settled/parcial` cujo `permuta_bordero.bor_cod_estornado IS NOT NULL` no momento da chamada, migrando o `bor_cod` para uma coluna histórica (`bor_cod_original`). (3) Enquanto isso, esta detecção não bloqueia release; entra como job/relatório no `_inbox` de operação.

- **Resultado Esperado**
  > Casos de reuso terminal detectados em ≤ 24h. Se `adtos_distintos > 1` = alerta operacional. Métrica: `permuta_bordero_reuso_terminal_count = 0` (target) — desvio ⇒ investigar.

- **Tactic alvo**: Sanity Checking + Condition Monitoring (Bass)
- **Severidade**: **P2**
- **Esforço estimado**: **S** (≤ 1 d) — SQL + job simples.
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Query de detecção: ausente → presente + agendada
  - `permuta_bordero_reuso_terminal_count`: N/A → 0 esperado
- **Risco de não fazer**: super-alocação silenciosa sobre adto cuja execução casou com bordero de OUTRO adto. Recuperação existe (próxima ingestão relê `mnyTitPermutar`), mas janela ≤ 6h de exposição.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Instrumentar skew de relógio app↔Postgres (fresh guard depende dele)

- **Problema**
  > A guarda de frescor `b.atualizado_em < r.started_at` compara um timestamp gravado pelo Postgres (`now()` em `replaceBorderoCache`/`updateBorderoCacheSituacao`) com um timestamp gravado pelo Node (`new Date()` em `IngestaoPermutasService.ts:74`, persistido em `permuta_eleicao_run.started_at`). Toda direção de skew analisada resulta em SUBESTIMAR consumo (conservador, fail-safe), mas skews grandes (dezenas de minutos) prolongariam a janela em que `saldoRestante` fica visualmente maior que o real, sem que ninguém saiba. Deploys em ambientes com clock drift (containers, VMs pausadas) são realistas.

- **Melhoria Proposta**
  > (1) Adicionar healthcheck periódico (job noturno) que loga `SELECT extract(epoch from now() - $appNow::timestamptz)` com `$appNow = new Date().toISOString()` do Node. Emite `BUSINESS_WARN` se `|skew| > 30s`. (2) Documentar em ADR-0046 que a guarda de frescor pressupõe skew ≤ minutos; alertar operação se ambientes futuros (novos tenants) rodarem com relógios livres. (3) Alternativa mais defensiva (opcional): usar `now()` do Postgres para `started_at` também, escrevendo `INSERT ... VALUES ($id, now(), ...) RETURNING started_at` e devolvendo ao app — elimina o skew inteiramente. Requer refactor pequeno em `PermutaRelationalRepository.insertIngestRunHeader:207-238`.

- **Resultado Esperado**
  > Skew visível em log/alerta. Se opção (3) for implementada, skew = 0 por construção.

- **Tactic alvo**: Timestamp + Condition Monitoring (Bass)
- **Severidade**: **P3**
- **Esforço estimado**: **S** (healthcheck) ou **M** (refactor `started_at`)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Skew instrumentado: ausente → presente
  - `|skew_app_db|` p95: N/A → ≤ 30s
- **Risco de não fazer**: se um deploy futuro tiver clock drift severo, saldos ficam subestimados por horas sem alerta. Direção segura, mas invisível a operação.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Reconciliação DB↔ERP periódica do saldo consumido (herança + reforço pós-delta)

- **Problema**
  > O ground-truth `validate-permutas-saldo-ordem-centavos-v1.ts` (247 linhas, 0 DIVERGENTE) foi rodado UMA vez, antes do merge. Sem job periódico, o painel post-deploy pode divergir do ERP sem que ninguém veja — e agora a divergência tem duas fontes novas: (a) guarda de frescor com skew ainda não instrumentado; (b) reuso de `bor_cod` sem detecção. Cardado no run anterior como dívida de Reconcile (Gray & Reuter §11) e reforçado aqui pelo delta introduzir consumidores da hipótese "cache == ERP".

- **Melhoria Proposta**
  > Reaproveitar o script `validate-permutas-saldo-ordem-centavos-v1.ts` como job semanal (`reconciliacao-permutas-saldo.ts`, cron 7d), lendo o mesmo catálogo de 128 adtos + amostra rotativa. Emite `BUSINESS_WARN` para cada linha DIVERGENTE não explicada e resumo agregado. Rodar em Render/cron externo (repo não tem `infra/`).

- **Resultado Esperado**
  > Divergências saldo(nosso) vs saldo(ERP) detectadas em ≤ 7 dias. `divergentes_semanais = 0` esperado; > 0 = ticket aberto automaticamente.

- **Tactic alvo**: Reconcile (Gray & Reuter §11)
- **Severidade**: **P2** (herdado; reforçado pelo delta)
- **Esforço estimado**: **M** (2-3d — script já existe, precisa envelopar em job periódico + notificação)
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-3 (delta impact); dívida original do run `2026-09-08-1955-permutas-baixa-integridade` (nota da Seção 3, "Reconcile")
- **Métricas de sucesso**:
  - Job periódico: 0 → 1
  - Cobertura de amostragem: 247 linhas one-off → 100 linhas/semana (rotativas) + amostra fixa
- **Risco de não fazer**: divergência silenciosa acumula; um caso de reuso `bor_cod` ou saldo stale pode passar semanas sem detecção operacional.
- **Dependências**: nenhuma (script pronto).

## 6. Notas do agente

- **Escopo estrito**: findings/cards fora do delta que ainda estão abertos (reaper de `parcial`, runbook de rollback do delta ADR-0044, F1 do interview) permanecem nos follow-ups originais e NÃO são re-abertos aqui. F1 (baixa lê saldo do banco) recebe um finding específico neste run só para registrar que o delta NÃO piora nem melhora.
- **Positivo em série**: o delta é conservador em TODAS as direções analisadas — clock skew, reuso de bordero (mitigado pela guarda de frescor no direção temporal), re-save acidental de alocação settled, sobrepagamento negativo, primeira ingestão pós-deploy, ingestão falhando no meio. Nenhum P0. A única fresta arquitetural nova é a suposição de identidade estável do `bor_cod` (F-2).
- **Cross-QA para o consolidator**:
  - F-fault-tolerance-1 (freshness guard verificação) toca **Testability** (o comportamento depende do relógio; testes unitários usam clock injetado) e **Performance** (a nova query soma JOIN triplo — validar seletividade, cross-ref com qa-performance).
  - F-fault-tolerance-2 (reuso `bor_cod`) toca **Modifiability** (a decisão de manter `bor_cod` original na trilha é anti-débito, mas expõe reuso — cross-ref com qa-modifiability se houver discussão de esquema).
  - F-fault-tolerance-3 (F1 herdado) toca **Availability** (baixa fail-safe via anti-drift) e **Testability** (cobertura live vs mocks).
  - Ground-truth script (`validate-permutas-saldo-ordem-centavos-v1.ts`) atende também Testability e Integrability — o consolidator pode citá-lo nos três QAs.
