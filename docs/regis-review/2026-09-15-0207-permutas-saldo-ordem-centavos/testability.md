---
qa: Testability
qa_slug: testability
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-testability
generated_at: 2026-09-15T02:45:00Z
scope: backend+frontend
score: 8.0
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Kavex ajusta a definição de "saldo restante" e "totalmente pago" (ADR-0046 D1/D2/D3) — muda dois predicados de gate, a ordem de escolha do motivo, e a fórmula de dedução das alocações do `mnyTitPermutar` | Uma mudança que atravessa 5 camadas: constante de domínio (`ToleranciaResiduo`) → serviço puro novo (`SaldoAlocacaoAdiantamentoService`) → repositório com SQL novo de 5 joins + guarda de frescor (`listConsumosFinalizados`) + `ON CONFLICT` com `IS DISTINCT FROM` (`replaceBorderoCache`) → serviços que consomem (`GestaoPermutasService`, `AlocacaoPermutasService`, `EleicaoPermutasService`, `ElegibilidadeService`) → apresentação (`page.tsx` + `montarHistorico`) | Delta da branch `fix/permutas-saldo-ordem-centavos`: 27 arquivos de código (~1.9k SLOC), 8 arquivos de teste novos/ampliados (~1.7k SLOC), 0 migration, script one-shot `validate-permutas-saldo-ordem-centavos-v1.ts` (736 LOC) | Desenvolvimento local com Jest + ts-jest e mocks do `PostgreeDatabaseClient`; sem harness Postgres real para o domínio de permutas (14 `*.integration.test.ts` existem em `routes/recebimentos.*`, **0 em `*/permutas/**`**). Deploy em Render (backend) + Vercel (frontend). Ground-truth valida ao vivo, read-only, contra Conexos-hml. | O engenheiro consegue provar em unidade que (1) as 12 fronteiras de dinheiro da ADR — 12860, 9328, 4 não-consumidos, 43 INOX → `ja-permutado`, 28 residuais, 8721, 5 residuais ≥R$21 seguem `nao-pago`, doc 4058 sobrepago negativo, fronteiras R$1,00/R$1,01 — retornam o valor exato do ERP; (2) a guarda de frescor não permite super-alocação após "Finalizar" via painel; (3) a dedupe do Histórico não gera warning React de `key` duplicada; (4) o ground-truth cai vermelho quando algo real diverge do ERP. | 12/12 casos canônicos pinados em `describe`/`it` com asserção numérica ±0,01; ≥1 asserção sobre o SQL da guarda de frescor (`b.atualizado_em < r.started_at`) e sobre o `ON CONFLICT ... IS DISTINCT FROM`; asserções pontuais + de paridade e de dedupe em `montarHistorico`; ground-truth 247 linhas 0 DIVERGENTE em execução ao vivo antes do PR; suíte agregada +1.9% em 5min sem flake. |

Contra-caso concreto que este ciclo trata: o defeito de definição — `saldoRestante = valorPermutar/taxa − Σ TODAS as alocações` — travou 128 adiantamentos com o ERP já tendo abatido a linha, produzindo saldo negativo (12860: −R$19.257,73) e teto de alocação erroneamente apertado (9328: R$4.304,94 quando o ERP diz R$39.652,47). O bug simétrico anterior (PR #111, ADR-0044) passou por todos os gates *mockados* porque o validador escrevia a própria fórmula. A regra deste ciclo é: (a) o validador **importa** a função de produção; (b) o teste unitário pina cada caso do ERP como número; (c) casos que dependem da guarda de frescor caem no ground-truth ao vivo, não no unit test.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por camada — arquivos `.test.ts(x)` tocados vs sources tocados no delta** (interface, service, repository, jobs, frontend) | Interface (`ToleranciaResiduo`): **1/1 (100%)** · Service (`SaldoAlocacaoAdiantamento`, `Elegibilidade`, `Eleicao`, `Alocacao`, `Gestao`, `Reconciliacao`): **6/6 (100%)** · Repository (`PermutaExecucaoRepository`, `PermutaAlocacaoRepository`): **2/2 (100%)** · Jobs (`validate-*-v1.ts`): **0/1 (0%; é one-shot read-only, aceitável)** · Frontend (`historico.ts`, `page.tsx`, `types.ts`): **1/3 (33%)** · Client (`ConexosTitulosClient.ts` só comentários): **N/A** | ≥ 0.5 por camada com código de produção; jobs one-shot exceção justificada; frontend `page.tsx` sem teste é gap conhecido (Client Component de 800+ LOC) | ⚠️ `page.tsx` sem teste é pré-existente; delta EXTRAI `montarHistorico` (redução líquida da superfície não-testada) | `_shared-metrics.md` §Delta · `find src -name '*.test.*'` |
| Testes novos no delta (contagem `it`/`test`) | `ToleranciaResiduo`: **13** · `ElegibilidadeService`: **+9** (blocos ADR-0046) · `EleicaoPermutasService`: **+4** (docs 8721, 3754, cliente-filtro 0,10/1,01) · `PermutaExecucaoRepository`: **+3** (`listConsumosFinalizados` × 3, freshness guard × 2) · `PermutaAlocacaoRepository`: **+1** (`listByAdiantamento`) · `SaldoAlocacaoAdiantamentoService`: **12** · `GestaoPermutasService`: **+7** (12860, 9328×2, 9335/9869/9870/10307 tabelizados, consumo de outro adto, ja-permutado com alocações) · `AlocacaoPermutasService`: **+4** (teto ADR-0046 × 3, invoice 0,02 segue aberta) · `historico.test.ts`: **9** = **62 testes novos** no delta | ≥ 40 para um delta de 27 arquivos que muda regra monetária | ✅ | `grep -cE '^\s+it\(\|^\s+it\.each' <arquivo>` |
| Suíte agregada backend | **135 suítes / 1953 testes** (baseline 128/~1890 → +7 suítes/+63 testes) | +N > 0, gate verde, tempo local < 5min | ✅ | `_shared-metrics.md` §Gate results |
| Suíte agregada frontend | **40 suítes / 328 testes** (+1 suíte / +9 testes com `historico.test.ts`) | +N > 0 | ✅ | `_shared-metrics.md` |
| **Casos canônicos da ADR-0046 pinados em unit test** (12 fronteiras exigidas na entrevista) | 12/12: **12860** (`GestaoPermutasService.test.ts:806-814`, esperado 30.364,73 ±0,005) · **9328** (`:816-826`, esperado 39.652,47 em `it.each` sobre `permuta-manual` + `casamento-manual`) · **9335/9869/9870/10307** (`:828-840`, `it.each` sobre 4 docs sem consumo) · **43 INOX → JA_PERMUTADO** (`ElegibilidadeService.test.ts:240-248` + `EleicaoPermutasService.test.ts:325-338`) · **28 residuais** (fronteira em `ToleranciaResiduo.test.ts:14-33` + representantes em `ElegibilidadeService.test.ts:250-266`) · **8721** (`EleicaoPermutasService.test.ts:299-312`, R$0,02 → `pago=true`, motivo ≠ `nao-pago`) · **5 residuais ≥R$21 seguem `nao-pago`** (`ToleranciaResiduo.test.ts:46-50` + `EleicaoPermutasService.test.ts:314-323`, doc 3754 R$21,01) · **doc 4058 negativo −R$34.088,65** (`ToleranciaResiduo.test.ts:52-60`) · **fronteiras R$1,00 / R$1,01** (`ToleranciaResiduo.test.ts:14-33, 41-44` + `ElegibilidadeService.test.ts:250-266`) · **Histórico dedupe** (`historico.test.ts:222-244`, dedup cross-process × ja-permutado e automática × ja-permutado; `:257-272` chaves únicas) · **teto do `alocar`** (`AlocacaoPermutasService.test.ts:279-300`, aceita 39.000 se outra consumida, `AlocacaoSaldoError` com disponivel 4.304,94 se não) | 12/12 com asserção numérica ±0,01 | ✅ | Vistoria linha-a-linha dos 8 arquivos de teste do delta |
| **Guarda de frescor testada** (invariante `atualizado_em` só anda quando `bor_vld_finalizado`/`bor_cod_estornado` mudam) | ⚠️ **1 asserção de shape do SQL** (`PermutaExecucaoRepository.test.ts:453-475`, `replaceBorderoCache`) + **1 asserção sobre `updateBorderoCacheSituacao`** (`:492-503`) + **1 asserção sobre a query `listConsumosFinalizados`** (`:514-533`, contém `b.atualizado_em < r.started_at`); **0 teste comportamental** (dois `replaceBorderoCache` seguidos com mesma situação → `atualizado_em` inalterado) | ≥1 teste comportamental via Postgres real ou via mock de `now()` que prove o não-avanço do carimbo | ⚠️ Parcial — a asserção depende do casamento string-a-string do CASE | `PermutaExecucaoRepository.test.ts:453-475` |
| **SQL do `listConsumosFinalizados` (D3) exercitado contra Postgres real** | ❌ **0 testes de integração** contra pg real no domínio de permutas (`find src/backend -name '*.integration.test.ts' -path '*permutas*'` → vazio); a query nova une 5 tabelas (`permuta_alocacao_execucao`, `permuta_bordero`, `permuta_adiantamento`, `permuta_eleicao_run`) e depende da coluna `last_ingest_run_id` (adicionada em migração anterior) + `started_at` — asserção existe só via `sql.includes(...)` | ≥1 teste que aplique o SQL contra um Postgres real (docker-compose.test.yml ou testcontainer) provando: (a) join semântico entre `permuta_bordero` e `permuta_alocacao_execucao` por `(fil_cod, bor_cod)`; (b) filtro `b.atualizado_em < r.started_at` com timestamps de segundo | ❌ Gap real, MAS pré-existente (delta segue o padrão do repo) | `find src/backend -name '*.integration.test.ts'` = 14 arquivos, todos em `routes/recebimentos.*` |
| **Ground-truth ao vivo (V1+V2+V3)** re-executável e importa código de produção | ✅ 247 linhas / **0 DIVERGENTE** / 6 EXPLICADO / 1 SEM_GROUND_TRUTH (V3). Script (736 LOC) importa `ToleranciaResiduo`, `ElegibilidadeService.avaliarElegibilidade`, `SaldoAlocacaoAdiantamentoService.{naoConsumido, somaNaoConsumida}` de produção — **não reimplementa a regra** (comentário `:29-30`: "Importa as funções de produção em vez de reimplementar a regra: um validador que reescreve a fórmula valida a si mesmo") | Todas as linhas EXATO/OK_CENTAVO/EXPLICADO; 0 DIVERGENTE; script recusa PRD sem `PROBE_ALLOW_PRD=1` | ✅ (aprende com ADR-0044/PR #111) | `_shared-metrics.md` §Gate results + `validate-permutas-saldo-ordem-centavos-v1.ts:1-72` |
| **Ground-truth script tem cobertura de teste unitário próprio** | ❌ **0 testes**; 736 LOC de comparação classificatória (EXATO/OK_CENTAVO/DIVERGENTE/EXPLICADO/SEM_GROUND_TRUTH) sem asserção de que os limites e a classificação estão corretos | ≥1 teste sobre a função de classificação (dado par `(nosso, esperado)`, veredito esperado), para que uma tolerância trocada de sinal seja pega em CI | ⚠️ Aceitável para one-shot; melhora se o script for re-usado | `find src/backend/jobs -name 'validate-*.test.ts'` vazio (padrão do repo) |
| **DI seam usado nos testes** (constructor injection vs `container.resolve`) | ✅ 100% dos testes do delta usam `new <Service>(mockRepo)` — nenhum `container.resolve` nos 8 arquivos de teste novos/ampliados. `GestaoPermutasService.test.ts:39-45` injeta o `SaldoAlocacaoAdiantamentoService` **real** com o `PermutaExecucaoRepository` mockado ("a regra 'consumida' é exercida de verdade, só a query é fingida") — integração de serviços em unidade | 100% construtor; 0 container | ✅ | `grep -n 'container.resolve\|new .*Service(' src/backend/domain/service/permutas/*.test.ts` |
| **Comparação de dinheiro em centavos** (`Math.round(v*100)`) no código de fronteira | ✅ `ToleranciaResiduo.ts:48-49` usa `Math.round(v*100) <= LIMITE_BRL*100`; teste dedicado com `0.1+0.2`, `1.0000000001`, `0.7+0.1+0.2`, `1.0099999999` (`ToleranciaResiduo.test.ts:28-33, 81-88`) | Nenhuma comparação `> 0`/`=== 0` sobre float direto na fronteira monetária | ✅ | `ToleranciaResiduo.ts:48-49` |
| **Extração de lógica de apresentação para função pura testável** | ✅ `montarHistorico` extraído de `page.tsx` (121 LOC de pura) + teste dedicado de 273 LOC cobrindo paridade das 4 categorias, ja-permutado com/sem borderô, tipo Cross-process vs "Já permutado", dedupe, unicidade de chaves | Nova lógica em `page.tsx` deve ser pura + coberta | ✅ | `historico.ts` + `historico.test.ts:222-272` |
| **Property-based testing** (`fast-check`) sobre `ToleranciaResiduo` (fronteira monetária, `NaN`, `±Infinity`) | ❌ 0 uso de `fast-check` no delta; `Number.isFinite` está no código (`ToleranciaResiduo.ts:42`) mas não é testado explicitamente contra `NaN`/`±Infinity`; `fast-check` não é dep do backend (`grep fast-check src/backend/package.json` vazio; existe no frontend) | ≥1 property test provando `∀ x ∈ (-∞, +∞) sem NaN`, `adiantamentoTotalmentePago({valorAberto: x}) ⇔ |x| ≤ 1` | ⚠️ Gap opcional — 13 casos hand-picked cobrem o essencial | `grep -rn fast-check src/backend` vazio |
| **Cobertura Jest (backend, `--coverage`)** — thresholds enforçados no `jest.config.cjs` | ⚠️ Não coletada (modo `--quick`); baseline global 72/54/78%, `./domain/service/` 88%/60%; delta adiciona `SaldoAlocacaoAdiantamentoService.ts` (108 LOC, 12 testes puros + I/O) que provavelmente entra acima do piso | Manter ≥ 88% lines / 60% branches em `domain/service/` (piso atual do CI) | ⚠️ Não medível no run `--quick` | `src/backend/jest.config.cjs:39-48` |
| **CI executa `npm test -- --coverage`** | ✅ `.github/workflows/ci.yml` roda `npm test -- --coverage` em backend e frontend (gates bloqueadores) | Gate presente | ✅ | `.github/workflows/ci.yml:27, 46` |
| Tamanho do maior arquivo de teste tocado no delta | `EleicaoPermutasService.test.ts` = **1348 LOC** (delta +75); `GestaoPermutasService.test.ts` = **952 LOC** (delta +172) | ≤ 500 LOC por arquivo de teste (heurística Bass — sinal de sujeição sob teste) | ⚠️ Pré-existente; delta agrava marginalmente (adicionou blocos ADR-0046 no fim) | `wc -l src/backend/domain/service/permutas/*.test.ts` |
| **Determinismo temporal do delta** (`new Date()`/`Date.now()` em código NOVO) | ✅ O código novo do delta (`ToleranciaResiduo`, `SaldoAlocacaoAdiantamentoService`, `listConsumosFinalizados`, `montarHistorico`) **não lê o relógio**; o carimbo `atualizado_em` vem do `now()` do próprio Postgres via `CASE ... THEN now() ELSE ...`; o cotejamento `criadoEm >= atualizadoEm` no `naoConsumido` usa timestamps já materializados na entrada | 0 `new Date()`/`Date.now()` no código novo | ✅ | `grep -n 'new Date()\|Date.now' <arquivos novos>` = 0 |
| Cobertura de teste do fluxo end-to-end de UI (`page.tsx` do painel — 800+ LOC, agora usa `montarHistorico`) | ❌ 0 testes (pré-existente; `find app/permutas -name 'page.test.*'` vazio); filtros `permutaManualCompleta` (`page.tsx:562`), `pendenteByDocCod` e `pendentes.filter(p => p.status === 'ja-permutado')` (na chamada `montarHistorico`) só saem no navegador | ≥1 teste `render(<Page/>)` ou extração das restantes closures (`permutaManualCompleta`, `casamentoTrabalho`) para módulo puro | ⚠️ Pré-existente; delta reduziu superfície | `find src/frontend/app/permutas -name 'page.test.*'` vazio |

> ⚠️ **Não medível localmente**: `--coverage` completo (rodada de 5-10 min) foi pulado por causa da flag `--quick` do gate. O CI `.github/workflows/ci.yml` roda com `--coverage` e o `coverageThreshold` do `jest.config.cjs:39-48` já é enforçador; a probabilidade de regressão silenciosa está mitigada pelo próprio gate.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `SaldoAlocacaoAdiantamentoService` separa **pura** (`naoConsumido`, `somaNaoConsumida`) de **I/O** (`carregarConsumosPorAdiantamento`, `somaNaoConsumidaDoAdiantamento`) — a regra é exercitável sem tocar em banco (`SaldoAlocacaoAdiantamentoService.test.ts` §"puro" 92 LOC vs §"I/O" 35 LOC). `ToleranciaResiduo` é `class` estático com 2 predicados discretos importáveis por qualquer chamador (validador ground-truth incluso). `PermutaExecucaoRepository.listConsumosFinalizados(adto?)` recebe filtro opcional para reduzir superfície. | ✅ | `SaldoAlocacaoAdiantamentoService.ts:52-107` · `ToleranciaResiduo.ts:19-50` · `PermutaExecucaoRepository.ts:188-211` |
| Record/Playback (Recordable Test Cases) | ⚠️ Ausente para os retornos do Conexos que alimentam `EleicaoPermutasService` — `buildDetalheConexos` (`EleicaoPermutasService.test.ts:286-297`) usa fixtures inline (`{ valorPermutar: 0, valorAberto: 0.02, valorPermutado: 20373009.87 }`). Os payloads reais do ERP para docs 8721/3754/12860/9328 **não** são gravados em `__fixtures__/*.json`. Deltas futuros na taxonomia do wire (`ConexosTitulosClient.mapDetalheTitulos`) exigem repetir o hand-crafting; um payload salvo daria contrato-de-mudança grátis. | ⚠️ | `find src/backend/domain -name "__fixtures__" -path "*permuta*"` vazio |
| Sandbox | ⚠️ Único sandbox real é o mock do `PostgreeDatabaseClient` (in-memory). Nenhum `docker-compose.test.yml`, nenhum testcontainer, nenhum `*.integration.test.ts` no domínio permutas (14 existem em `routes/recebimentos.*`, provando que a infra existe no repo — só não foi propagada para permutas). O SQL novo de 5 joins do `listConsumosFinalizados` e o `ON CONFLICT ... IS DISTINCT FROM ...` do `replaceBorderoCache` ficam sem sandbox onde exercitar as semânticas do Postgres. Sandbox AO VIVO existe — `validate-permutas-saldo-ordem-centavos-v1.ts` roda read-only contra Conexos-hml — cobre a semântica do ERP, não a do Postgres nosso. | ⚠️ Pré-existente; delta introduz +1 query complexa sem cobertura de banco real | `find src/backend -name '*.integration.test.ts' -path '*permuta*'` vazio; `find src -name 'docker-compose*'` vazio |
| Executable Assertions | ✅ `ToleranciaResiduo.ts:42` usa `Number.isFinite` para negar `NaN`/`Infinity`; `SaldoAlocacaoAdiantamentoService.naoConsumido:70` teto explícito `Math.min(Math.max(0, valorResidualUsd), valorAlocado)` (defende resíduo maior que alocado — teste `SaldoAlocacaoAdiantamentoService.test.ts:62-67`); `PermutaExecucaoRepository.mapConsumo` (`:592-620`) descarta status fora da união terminal explicitamente (teste `:573-586`, "status fora da união terminal é descartado — sem cast"); `AlocacaoPermutasService.alocar` (via `SaldoAlocacaoAdiantamentoService`) mantém `AlocacaoSaldoError` com detalhe numérico do `disponivel` (teste `AlocacaoPermutasService.test.ts:289-300`). | ✅ | Vistoriado |
| Abstract Data Sources | ✅ `PostgreeDatabaseClient` é abstraído via tsyringe; `SaldoAlocacaoAdiantamentoService` recebe **os dois** repositórios (não sabe de SQL). O `naoConsumido`/`somaNaoConsumida` são reutilizados no ground-truth (`validate-permutas-saldo-ordem-centavos-v1.ts:17-22`), provando a portabilidade. Clock não é abstraído — mas o código novo do delta não lê `Date.now()`/`new Date()`. | ✅ (para o delta) | `SaldoAlocacaoAdiantamentoService.ts:44-49` (DI) · `validate-permutas-saldo-ordem-centavos-v1.ts:17-22` (reuso) |
| Limit Structural Complexity | ✅ `SaldoAlocacaoAdiantamentoService` cria uma **única fonte** da regra "quanto ainda não foi abatido" (docblock `:16-19`); antes, a soma bruta acontecia em `GestaoPermutasService.exporGestao` E no teto de `AlocacaoPermutasService.alocar`, com risco de divergirem. `montarHistorico` extraído de `page.tsx` corta 121 LOC de closure aninhada em Client Component. `sumByAdiantamento` foi **removido** de `PermutaAlocacaoRepository` (tasks.md Task 4 AC: `grep -rn "sumByAdiantamento" src/backend` → 0), eliminando o caminho antigo. | ✅ | `SaldoAlocacaoAdiantamentoService.ts:16-19` · `historico.ts` (121 LOC) · `PermutaAlocacaoRepository.ts` (não tem mais `sumByAdiantamento`) |
| Limit Non-Determinism | ✅ **para o delta**: código novo não lê o relógio; comparação temporal usa timestamps já materializados (`criadoEm >= atualizadoEm`, ambos vindos do `now()` do Postgres). Fronteira monetária é comparada em centavos (`Math.round(v*100)`) — imune ao ruído de float provado pelos testes `0.1+0.2`, `1.0000000001`, `1.0099999999`. Ordem de execução: os testes não usam `beforeAll`/`afterAll` para partilhar estado (verificado em 8 arquivos). ⚠️ **Pré-existente:** 8 chamadas `new Date()`/`Date.now()` em `IngestaoPermutasService`/`EleicaoPermutasService` que a ADR-0046 depende (`started_at` do run) — não injetadas por `ClockProvider`, mas o comportamento em teste é mockado via `PermutaSnapshotRepository.findLatestIngestFinishedAt`. | ✅ delta / ⚠️ pré-existente | `grep -n 'new Date()' <arquivos novos>` = 0 |

## 4. Findings (achados)

### F-testability-1: SQL do `listConsumosFinalizados` (5 joins + guarda de frescor) só validado por casamento de string; 0 teste contra Postgres real

- **Severidade**: P2 (era P1 sem o ground-truth ao vivo; este mitiga a exposição de produção)
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211` (query nova); teste `PermutaExecucaoRepository.test.ts:505-586` (string-match)
- **Evidência (objetiva)**:
  ```
  find src/backend -name '*.integration.test.ts' -path '*permuta*'  → vazio
  find src/backend -name '*.integration.test.ts'                    → 14 (todos routes/recebimentos.*)
  find src -name 'docker-compose*'                                  → vazio
  ```
  A query une 5 tabelas (`permuta_alocacao_execucao e`, `permuta_bordero b`, `permuta_adiantamento a`, `permuta_eleicao_run r`) e depende de invariantes semânticas do Postgres: (a) o join `(fil_cod, bor_cod)` cobre a PK real da migration 0020 (nº de borderô é sequencial por filial — colidiria entre filiais se joinado só por `bor_cod`); (b) a coluna `last_ingest_run_id` precisa estar preenchida (repositório carimba em `PermutaRelationalRepository.ts:321, 415, 453`); (c) `b.atualizado_em < r.started_at` compara `timestamp with time zone` vs `timestamp with time zone`, com skew de segundos entre relógio do app (`startedAt = new Date()` em `IngestaoPermutasService.ts:74`) e do Postgres (`now()`). Nenhum teste exercita essas semânticas contra pg real — os 3 testes do bloco (`:514-586`) só asseguram que o SQL contém as strings esperadas.
- **Impacto técnico**: um refactor futuro que troque o join por `USING (bor_cod)` (removendo o `AND b.fil_cod = e.fil_cod`) passa nos testes de string se as strings esperadas forem atualizadas, mas produz colisão silenciosa entre filiais quando o mesmo `bor_cod` existe em 2 filiais.
- **Impacto de negócio**: hoje mitigado pelo `validate-permutas-saldo-ordem-centavos-v1.ts` (ground-truth ao vivo, 247 linhas, 0 DIVERGENTE) — MAS o script roda **manualmente antes do PR**, não em CI. Uma regressão entre PRs (ou em hotfix com `--urgent`) só é pega ao vivo.
- **Métrica de baseline**: 0/1 testes de integração cobrindo a nova query; 14 integrações existem em outra área do repo (padrão está no repo, não foi aplicado); ground-truth ao vivo compensa mas não é gate de CI.

### F-testability-2: Guarda de frescor (`ON CONFLICT ... IS DISTINCT FROM ...`) testada só por shape de SQL, sem prova comportamental

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (asserção codificada no schema não é exercitada em runtime)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:494-547` (`replaceBorderoCache` + `updateBorderoCacheSituacao`); teste `PermutaExecucaoRepository.test.ts:453-503`
- **Evidência (objetiva)**: o teste `renova atualizado_em SÓ quando a situação muda (guarda de frescor, ADR-0046)` (`:453-475`) faz UMA chamada de `replaceBorderoCache` e assere que o SQL contém as strings `bor_vld_finalizado IS DISTINCT FROM EXCLUDED.bor_vld_finalizado`, `bor_cod_estornado IS DISTINCT FROM EXCLUDED.bor_cod_estornado`, `atualizado_em = CASE WHEN ... THEN now() ELSE permuta_bordero.atualizado_em END`. Não existe teste comportamental que prove o cenário canônico do ADR (linha 60 da tasks): "o botão 'Atualizar' da tela de Borderôs não pode empurrar o carimbo depois do `started_at` da ingestão" — duas chamadas seguidas de `replaceBorderoCache` com a mesma situação. Requer Postgres real ou substituto de `now()`.
- **Impacto técnico**: se alguém, em refactor, trocar `IS DISTINCT FROM` por `!=` (semântica diferente para `NULL`), o teste continua vermelho até que os literais sejam atualizados — mas atualizar os literais é o primeiro reflexo. A propriedade comportamental (o `now()` só progride sob mudança real) não é enforçada de outra forma.
- **Impacto de negócio**: cenário concreto do ADR (linha 220-222 de `0046-*.md`): logo depois de "Finalizar" pelo painel, um Refresh de tela empurraria `atualizado_em` para depois do `started_at` da ingestão, desfazendo a guarda; o adto voltaria à aba com o saldo cheio e o teto do `alocar` aceitaria realocar o mesmo valor. É o caminho **mais comum** do painel, não canto raro.
- **Métrica de baseline**: 2 asserções sobre a string do SQL; 0 asserções comportamentais sobre `now()` não-progredindo; 0 casos com Postgres real onde a semântica do `IS DISTINCT FROM` sobre `NULL` seja provada.

### F-testability-3: Script ground-truth (`validate-permutas-saldo-ordem-centavos-v1.ts`, 736 LOC) não tem teste unitário próprio

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (a lógica que classifica EXATO/OK_CENTAVO/DIVERGENTE/EXPLICADO/SEM_GROUND_TRUTH não é testada)
- **Localização**: `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` (novo, 736 LOC); `find src/backend/jobs -name 'validate-*.test.ts'` → vazio (padrão do repo — validadores anteriores como `validate-invoice-pago-detalhe-v1.ts` também não têm)
- **Evidência (objetiva)**: o script já aprendeu com ADR-0044/PR #111 e **importa** a lógica de produção (`ToleranciaResiduo`, `ElegibilidadeService.avaliarElegibilidade`, `SaldoAlocacaoAdiantamentoService.{naoConsumido, somaNaoConsumida}`) em vez de reimplementar. Isso elimina uma classe de defeito. Persiste, porém, a lógica de comparação: tolerância `TOL = 0.01`, veredito por delta com sinal (`Δ > 0` → EXPLICADO conservador; `Δ < 0` → DIVERGENTE perigoso). Se, em manutenção futura, alguém inverter o sinal do delta (comum quando se refatora "esperado" vs "observado"), 0 DIVERGENTE em produção pode virar 0 EXPLICADO em produção — silencioso.
- **Impacto técnico**: o gate ground-truth passa a produzir falso-verde. Não há salvaguarda downstream: o Regis-Review lê o output do script como fonte da verdade (`_shared-metrics.md` §Gate results, 0 DIVERGENTE).
- **Impacto de negócio**: baixo hoje (script one-shot desta feature); médio quando o script for re-usado por analista para investigar residuais novos e comparar contra ERP.
- **Métrica de baseline**: 0 testes cobrindo a função de classificação; 3 vetores da tabela (V1, V2, V3) sem asserção de canary (dado par `(nosso=100, esperado=100)` → EXATO; `(100, 100.005)` → OK_CENTAVO; `(100, 90)` → DIVERGENTE; `(100, 110)` → EXPLICADO).

### F-testability-4: `page.tsx` do painel (800+ LOC, Client Component) segue sem teste; filtros críticos (`permutaManualCompleta`, `pendentes.filter(p => p.status === 'ja-permutado')`) fora de módulo puro

- **Severidade**: P3 (delta REDUZ a superfície — extraiu `montarHistorico` para pura; problema é pré-existente)
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/frontend/app/permutas/page.tsx:557-563` (`permutaManualCompleta`, `SALDO_TOL`); `:591-600` (chamada de `montarHistorico`); nenhum `page.test.tsx`
- **Evidência (objetiva)**: `find src/frontend/app/permutas -name 'page.test.*'` → vazio. `page.tsx` importa `montarHistorico` (extraído nesta feature ✅), mas mantém `permutaManualCompleta = (p) => adtoExecutado(p.docCod) && p.saldoRestante !== undefined && p.saldoRestante <= SALDO_TOL` como closure inline. O filtro `pendentes.filter(p => p.status === 'ja-permutado')` que alimenta `jaPermutados` também é inline. Se `SALDO_TOL` divergir da constante de domínio (`ToleranciaResiduo.LIMITE_BRL`), a UI diverge do backend em silêncio.
- **Impacto técnico**: `SALDO_TOL` (no frontend) e `LIMITE_BRL = 1` (no backend `ToleranciaResiduo.ts`) não estão amarrados por teste. `grep -n 'SALDO_TOL' src/frontend` retornaria a definição isolada; se alguém subir o teto do backend para R$2, o frontend segue filtrando por outro valor.
- **Impacto de negócio**: o filtro `permutaManualCompleta` decide se um adto sai da aba de trabalho para o Histórico. Divergência silenciosa retornaria o comportamento pré-ADR: adto fica em duas abas.
- **Métrica de baseline**: 0 testes sobre `page.tsx`; 2 closures inline que dependem de constantes de domínio não amarradas; extração de `montarHistorico` reduziu 121 LOC (progresso, não fim).

### F-testability-5: Fronteira monetária de `ToleranciaResiduo` sem property-based test (`fast-check`) — 13 casos hand-picked, `NaN`/`±Infinity` implícitos

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (space of inputs)
- **Localização**: `src/backend/domain/interface/permutas/ToleranciaResiduo.test.ts` (90 LOC, 13 casos); `ToleranciaResiduo.ts:42` (`Number.isFinite` guard)
- **Evidência (objetiva)**: os 13 casos cobrem 0, 0.10, 1.00, 1.01, 1000, `undefined`, `0.1+0.2`, `1.0000000001`, `0.7+0.1+0.2`, `1.0099999999`, `-0.02`, `-34088.65`, `-1.01`. Faltam `NaN`, `+Infinity`, `-Infinity`, valores exponenciais grandes (`1e20`). O guard `Number.isFinite` (`:42`) está no código, mas se algum consumidor passar `NaN` (ex.: `valorAberto` vindo de `parseFloat` com string inválida no `ConexosTitulosClient.mapDetalheTitulos`), o comportamento silenciosamente cai no `pago` do wire — sem prova. `fast-check` não é dep do backend (`grep fast-check src/backend/package.json` vazio; é dep do frontend).
- **Impacto técnico**: baixo — os predicados são estáticos e a superfície de entrada é controlada pelo `EleicaoPermutasService`. Property test seria upgrade, não correção.
- **Impacto de negócio**: baixo direto; médio como precedente (a mesma classe de defeito com números que "não são números" apareceu em outros deltas do repo, por ex. `variacaoResultado NaN` mencionado em follow-ups anteriores).
- **Métrica de baseline**: 13 casos hand-picked; 0 property tests; 3 valores extremos-do-Number sem cobertura.

## 5. Cards Kanban

### [testability-1] Cobrir com Postgres real a query `listConsumosFinalizados` e a guarda de frescor do cache de borderô

- **Problema**
  > As duas peças novas de SQL mais complexas do delta — `listConsumosFinalizados` (5 joins + `b.atualizado_em < r.started_at` + `bor_cod_estornado IS NULL`) e o `ON CONFLICT ... IS DISTINCT FROM ...` do `replaceBorderoCache`/`updateBorderoCacheSituacao` — são exercitadas só por casamento de string em teste (`PermutaExecucaoRepository.test.ts:453-475, 514-586`). O padrão de integração existe no repo (14 `*.integration.test.ts` em `routes/recebimentos.*`), mas não foi aplicado a permutas (`find src/backend -name '*.integration.test.ts' -path '*permuta*'` → vazio). Refactor que troque `USING(bor_cod)` por `USING(bor_cod)` sem `fil_cod` produz colisão silenciosa entre filiais; refactor que troque `IS DISTINCT FROM` por `!=` (semântica NULL diferente) refaz o bug canônico do "Finalizar → refresh → saldo cheio".

- **Melhoria Proposta**
  > Criar `src/backend/domain/repository/permutas/PermutaExecucaoRepository.integration.test.ts` seguindo o padrão de `routes/recebimentos.*.integration.test.ts`. Cobrir 3 cenários: (a) `listConsumosFinalizados` — inserir 2 execuções `settled` em `bor_cod` idênticos de filiais diferentes e provar que só a da filial certa aparece; (b) guarda de frescor — inserir uma execução com `b.atualizado_em > r.started_at` e provar que NÃO aparece; (c) `replaceBorderoCache` — invocar duas vezes com mesma situação e provar que `atualizado_em` não avançou. Tactic Bass: Sandbox + Executable Assertions. Infra: reaproveitar o `docker-compose` que hoje suporta `recebimentos.integration.test.ts` (ou introduzir se ainda não existir separado — o repo já tem `MigrationRunner`).

- **Resultado Esperado**
  > `find src/backend -name '*.integration.test.ts' -path '*permuta*'` sobe de 0 → **≥1**. 3 casos de banco real (join cross-filial, guarda de frescor, `IS DISTINCT FROM` sob `NULL`) pinados em CI. Refactor futuro que quebre a semântica cai vermelho localmente, não em produção.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2-5d — reuso do harness `recebimentos.*.integration.test.ts` reduz para 2d; setup do zero eleva para 5d)
- **Findings relacionados**: F-testability-1, F-testability-2
- **Métricas de sucesso**:
  - Testes de integração no domínio permutas: 0 → **≥3** (join, guarda de frescor, ON CONFLICT)
  - Semânticas do Postgres exercitadas sob PR: 0 → **3** (`IS DISTINCT FROM` sobre NULL, join composto (fil_cod, bor_cod), comparação `timestamptz` de segundos)
- **Risco de não fazer**: o ground-truth ao vivo (247 linhas, 0 DIVERGENTE) passa a ser o único guardião das duas semânticas. Ele roda **antes do PR**, não em CI; hotfixes com `--urgent` pulam. Uma regressão do join cross-filial produziria contagem incorreta de "consumido" e o teto do `alocar` daria super-alocação — mesmo bug simétrico ao 12860/9328 que este delta corrige.
- **Dependências**: Levantar (ou reaproveitar) o `docker-compose.test.yml` que `routes/recebimentos.*.integration.test.ts` já pressupõe.

### [testability-2] Amarrar `SALDO_TOL` do frontend à constante de domínio `ToleranciaResiduo.LIMITE_BRL` e extrair filtros de `page.tsx`

- **Problema**
  > `src/frontend/app/permutas/page.tsx:557-563` mantém `permutaManualCompleta = (p) => adtoExecutado(p.docCod) && p.saldoRestante !== undefined && p.saldoRestante <= SALDO_TOL` como closure inline em Client Component de 800+ LOC. `SALDO_TOL` não referencia `ToleranciaResiduo.LIMITE_BRL`, então divergência silenciosa entre back e front (se o teto do backend subir para R$2, o front continua filtrando por outra coisa). O filtro `pendentes.filter(p => p.status === 'ja-permutado')` que alimenta `jaPermutados` também é inline. `find src/frontend/app/permutas -name 'page.test.*'` → vazio (nenhuma cobertura).

- **Melhoria Proposta**
  > (1) Extrair `permutaManualCompleta` e a partição `{ jaPermutados, multiplasManuais, ... }` para módulo puro (`src/frontend/app/permutas/components/particionar.ts` ou análogo, seguindo o padrão de `historico.ts` deste delta). (2) Exportar `LIMITE_BRL` num módulo compartilhado (opção A: pacote comum consumido por FE+BE; opção B: espelho no FE com teste que carrega o BE e falha se divergirem — este repo é monorepo, viável). (3) Adicionar suite de teste ao módulo extraído. Tactic Bass: Limit Structural Complexity + Specialized Interfaces.

- **Resultado Esperado**
  > `page.tsx` deixa de conter closures que dependem de constantes de domínio não-amarradas. Testes de módulo puro cobrem `permutaManualCompleta` e a partição — de 0 → **≥5 casos**. Divergência entre back e front do teto de R$1,00 vira erro de compilação (opção A) ou teste vermelho (opção B).

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - LOC de closures em `page.tsx` que dependem de constante de domínio: **2** → **0**
  - Constante `LIMITE_BRL` amarrada por teste back↔front: **não** → **sim**
- **Risco de não fazer**: retorno do defeito pré-ADR-0046 (adto em duas abas) se o teto do backend subir e o FE não acompanhar. Perda silenciosa da confiança na tela do painel.
- **Dependências**: `historico.ts` (padrão de extração deste delta) já valida a abordagem.

### [testability-3] Adicionar teste unitário à função de classificação do `validate-permutas-saldo-ordem-centavos-v1.ts` (canary sobre sinal do delta)

- **Problema**
  > O script ground-truth (736 LOC) importa a lógica de produção — grande vitória sobre PR #111 — mas a **classificação** (EXATO / OK_CENTAVO / DIVERGENTE / EXPLICADO / SEM_GROUND_TRUTH, baseada em `TOL = 0.01` e no sinal do delta) não tem teste. Se em manutenção futura alguém inverter `esperado − nosso` por `nosso − esperado`, o veredito "DIVERGENTE (perigoso)" vira "EXPLICADO (conservador)" e o script relata 0 DIVERGENTE em produção — falso-verde. Padrão do repo (`find src/backend/jobs -name 'validate-*.test.ts'` vazio) tolera one-shots, mas este script é o único guardião de duas invariantes do banco (F-testability-1) que hoje não têm cobertura de integração.

- **Melhoria Proposta**
  > Extrair a função de classificação para módulo puro (`classificarLinhaGroundTruth`), importável tanto pelo script quanto por teste. Adicionar `validate-permutas-saldo-ordem-centavos-v1.test.ts` com 4 casos canary: (a) `(nosso=100, esperado=100)` → EXATO; (b) `(100, 100.005)` → OK_CENTAVO; (c) `(100, 90)` → DIVERGENTE; (d) `(100, 110)` → EXPLICADO. Documentar o sinal esperado na docstring da função. Tactic Bass: Executable Assertions.

- **Resultado Esperado**
  > Função de classificação testada: **0** → **≥4 casos canary**. Uma inversão de sinal futura cai vermelho em CI antes de virar 0 DIVERGENTE-com-falso-verde em produção.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3, F-testability-1 (mitigação parcial)
- **Métricas de sucesso**:
  - Testes cobrindo a classificação do ground-truth: 0 → **4**
  - Vertentes do veredito com canary: **0/5** → **4/5** (SEM_GROUND_TRUTH é degenerado)
- **Risco de não fazer**: dado que o ground-truth ao vivo é hoje a única defesa contra F-testability-1 (SQL sem Postgres real) e F-testability-2 (guarda de frescor sem comportamento), um falso-verde na classificação apaga as duas defesas de uma vez. Custo direto = repetição do padrão PR #111.
- **Dependências**: nenhum (pode ser feito isoladamente); complementar a `testability-1`.

### [testability-4] Property-based test em `ToleranciaResiduo` cobrindo `NaN`/`±Infinity` (fast-check no backend)

- **Problema**
  > `ToleranciaResiduo.test.ts` tem 13 casos hand-picked cobrindo fronteira monetária e ruído de float, mas não exercita `NaN`, `+Infinity`, `-Infinity`, exponenciais grandes (`1e20`). O guard `Number.isFinite` (`ToleranciaResiduo.ts:42`) está no código sem teste correspondente. `fast-check` já é dep do frontend, não do backend (`grep fast-check src/backend/package.json` vazio). Se um `parseFloat` num consumidor futuro (ex.: `ConexosTitulosClient.mapDetalheTitulos`) produzir `NaN` para `valorAberto`, o predicado cai silenciosamente no `pago` do wire.

- **Melhoria Proposta**
  > Adicionar `fast-check` como devDep do backend (`cd src/backend && npm i -D fast-check`) e escrever 3 property tests em `ToleranciaResiduo.test.ts`: (a) `fc.assert(fc.property(fc.double({noNaN: false}), (x) => adiantamentoTotalmentePago({valorAberto: x}) ⇔ Number.isFinite(x) && Math.round(Math.abs(x)*100) <= 100))`; (b) simétrico para `semSaldoPermutar`; (c) `NaN`, `±Infinity` explicitamente. Tactic Bass: Limit Non-Determinism (space of inputs).

- **Resultado Esperado**
  > Cobertura de fronteira monetária sobe de **13 casos hand-picked** → **13 + 3 properties com centenas de amostras cada rodada**. `NaN`/`±Infinity` explicitamente testados: **0** → **3**.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - `fast-check` dep no backend: **não** → **sim**
  - Property tests em `ToleranciaResiduo.test.ts`: 0 → **3**
  - Casos `NaN`/`±Infinity`: 0 → **3**
- **Risco de não fazer**: baixo direto; mantém padrão de defesa "hand-picked apenas" que já produziu incidentes em outras áreas do repo (variação `NaN`). Débito herdável.
- **Dependências**: nenhum.

## 6. Notas do agente

- **Decisões de escopo**: rodei `--quick` (sem `--coverage`), então a rastreabilidade fina de cobertura de linhas por arquivo do delta não foi coletada; o CI `.github/workflows/ci.yml` roda com `--coverage` e o `coverageThreshold` do `jest.config.cjs:39-48` já protege. **Não re-levantei** achados pré-existentes já presentes em `2026-09-08-2011/testability.md` (migração sem teste automatizado; exhaustividade `: never` em 1/6 sítios; `ClockProvider` ausente em 8 chamadas `new Date()` de `Ingestao`/`Eleicao`) porque o delta desta feature **não introduz nem agrava** essas dívidas.
- **Cross-QA detectadas**: (a) F-testability-1/F-testability-2 sobrepõem-se a **Fault Tolerance** (a guarda de frescor é a defesa contra super-alocação) e a **Deployability** (falta gate de CI que rode ground-truth ou integração); (b) F-testability-4 sobrepõe-se a **Modifiability** (`page.tsx` de 800+ LOC com closures que dependem de constantes de domínio); (c) F-testability-3 sobrepõe-se a **Integrability** (o script é o único contrato executável contra o wire do Conexos para os campos `mnyTitPermutar`/`mnyTitAberto`); (d) `ToleranciaResiduo` como constante única back/front sobrepõe-se a **Integrability**.
- **Métricas que tentei e falhei**: cobertura de branches por arquivo do delta (`--quick`); tempo de execução da suíte agregada com o delta (não medido — o gate registrou "verde", não "duração").
- **Observação positiva**: este é um delta testability-net-positivo. `SaldoAlocacaoAdiantamentoService` cria uma única fonte da regra (antes espalhada em `GestaoPermutasService` e `AlocacaoPermutasService`); `montarHistorico` extrai 121 LOC de closure de Client Component para pura testada; o validador ground-truth aprende com ADR-0044 e importa a produção. Os 12 casos canônicos do ERP estão pinados por asserção numérica ±0,01. Se houvesse P0, seria pino de vazamento, não de fronteira.
