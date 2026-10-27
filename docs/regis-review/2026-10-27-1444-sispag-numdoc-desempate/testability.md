---
qa: Testability
qa_slug: testability
run_id: 2026-10-27-1444-sispag-numdoc-desempate
agent: qa-testability
generated_at: 2026-10-27T14:44:00Z
scope: backend+frontend (feature delta — I15s / ADR-0079)
score: 9
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev / analista | Mudar a regra de desempate (I15s âncora de número) sem derrubar as outras invariantes do motor (I15c/d/f/h/o/p) | `MotorSugestaoBoleto`, `RegraSugestaoBoleto`, `BoletoSuggestionService`, `TituloAPagarRepository`, FE schema/rótulo | PR em worktree, gates já verdes | Cada cláusula do ADR-0079 (D1–D10) tem teste determinístico e isolado via DI | 100 % das cláusulas cobertas; 0 testes não determinísticos; feature verde em < 10 s de jest focado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de cláusulas ADR-0079 (D1–D10) em testes do delta | 10/10 | 10/10 | ✅ | `MotorSugestaoBoleto.numero.test.ts` (18 casos) + `RegraSugestaoBoleto.test.ts` (normalizar + MIN_DIGITOS) + `BoletoSuggestionService.test.ts` (I15s wiring + degrade) + `TituloAPagarRepository.test.ts` (`listNumerosDocumento`) + `sispag.sugestaoBoleto.test.ts` + `sugestaoBoleto.desfecho.test.ts` |
| Testes do arquivo-chave `MotorSugestaoBoleto.numero.test.ts` | 18 | ≥ 15 | ✅ | spec do TaskScoper T5 |
| Determinismo: clock injetado em todos os suites do delta | 2/2 (`BankingCalendar.withClock`) | 2/2 | ✅ | `MotorSugestaoBoleto.numero.test.ts:16`, `BoletoSuggestionService.test.ts:32` |
| DI por construtor nos testes do delta (sem `container.resolve` do serviço) | 2/2 | 2/2 | ✅ | `new MotorSugestaoBoleto(...)`, `new BoletoSuggestionService(...)` |
| Fail-soft da leitura nova (degrade flag `numeroAncoraDesligada`) coberto | 1 caso serviço + 1 caso motor | ≥ 1+1 | ✅ | `BoletoSuggestionService.test.ts:325`, `MotorSugestaoBoleto.numero.test.ts:131` |
| SQL de `listNumerosDocumento` sem filtro `ativo`, parametrizado | asserção presente (`not.toMatch(/ativo/i)`) | presente | ✅ | `TituloAPagarRepository.test.ts:175` |
| Rede/HTTP/Clock real em testes do delta | 0 | 0 | ✅ | grep: nenhum `axios`, `fetch`, `setTimeout`, `Date.now` sem clock |
| Suites globais verdes com delta aplicado | BE 283/5313 · FE 114/1260 | tudo verde | ✅ | `_shared-metrics.md` |
| Property-based (`fast-check`) em `normalizarNumero` / detector de duplicata | 0 | ≥ 1 (opcional) | ⚠️ | grep sem `fc.` nos arquivos do delta |
| Teste de integração Postgres real para `listNumerosDocumento` | 0 | 0 (padrão do repo é unit-mock; já aceito) | N/A | padrão `TituloAPagarRepository.test.ts` |

> ⚠️ **Não medível localmente**: a precisão (82 % em 22 pares) prometida no ADR-0079 depende do pool PRD; o critério de aceite "reconferir precisão com fin064 completo" é observação de produção, não teste automatizado. Recomendação: job somente-leitura que compara âncoras × vínculos ERP mensalmente (ou view do painel), fora deste PR.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Motor exposto como classe pura (`analisar`/`desfechos`/`sugerir`), serviço recebe tudo via construtor; teste constrói com mocks | ✅ | `MotorSugestaoBoleto.numero.test.ts:17-22` |
| Recordable Test Cases | Caso real do ADR-0079 (NELSON 25037/25041) codificado como fixture no teste | ✅ | `MotorSugestaoBoleto.numero.test.ts:100-128` |
| Sandbox | Serviço resolvido com `Proxy` espião de `ConexosClient` (herança do suite legado) | ✅ | `BoletoSuggestionService.test.ts:1117+` (zero chamada ao Conexos) |
| Executable Assertions | Asserções sobre `sinais.includes(NUMERO_CONFIAVEL)`, situação, `confirmavel`, reserva (`compartilhado`) | ✅ | arquivo do delta inteiro |
| Abstract Data Sources | DB abstraído em `PostgreeDatabaseClient`; repo testado com `selectMany`/`selectFirst` mockados; motor recebe `titulosDoCredor` por entrada | ✅ | `TituloAPagarRepository.test.ts:20-30` |
| Limit Structural Complexity | `MotorSugestaoBoleto.ts` cresceu de 1023 → 1148 LOC (+12 %); limiar interno (`NUMERO_CONFIAVEL_MIN_DIGITOS`) exportado | ⚠️ | `_shared-metrics.md` LOC |
| Limit Non-Determinism | `BankingCalendar.withClock(() => new Date('2026-10-26T15:00:00Z'))`; `ditSeq` monotônico; sem `Date.now`, `setTimeout`, `Math.random` no delta | ✅ | `MotorSugestaoBoleto.numero.test.ts:16,65` |

## 4. Findings

### F-testability-1: cláusulas D1–D10 do ADR-0079 têm teste 1-para-1

- **Severidade**: P3 (observação positiva — não vira card)
- **Tactic**: Executable Assertions · Recordable Test Cases
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.numero.test.ts`
- **Evidência**: 18 `it(...)` cobrem o caso real, degrade flag, 10 desqualificadores, 4 cenários de precedência, incluindo DPS × número divergentes → `AMBIGUA` (D5), outra parcela do mesmo documento NÃO desqualifica (D7), boleto sem emissor não ancora (D8), escopo por `pesCod` (D9).
- **Impacto técnico/negócio**: baseline sólida para refactors futuros do motor.
- **Métrica de baseline**: 10/10 cláusulas cobertas.

### F-testability-2: `MotorSugestaoBoleto.ts` ultrapassa 1000 LOC

- **Severidade**: P2
- **Tactic**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` (1148 LOC)
- **Evidência**: `_shared-metrics.md` — crescimento de 1023 → 1148 LOC nesta feature; test file do motor dividido em 3 (`.test.ts` 878, `.dps.test.ts` 183, `.numero.test.ts` 380), reflexo direto do tamanho do SUT.
- **Impacto técnico**: cada nova âncora obriga reler o arquivo todo; TDDGuide/PatternGuardian ficam mais caros.
- **Impacto de negócio**: próxima regra (ex.: âncora por histórico de credor rejeitada neste ADR) vai disputar o mesmo arquivo.
- **Métrica de baseline**: 1148 LOC em um único service.

### F-testability-3: `normalizarNumero` sem teste de propriedade

- **Severidade**: P3
- **Tactic**: Executable Assertions (property-based)
- **Localização**: `src/backend/domain/service/sispag/RegraSugestaoBoleto.test.ts:379-390`
- **Evidência**: 4 asserções pontuais (`'0025037' → '25037'`, `'NF 25.037-A' → '25037'`, `undefined → ''`, `'000' → ''`). `fast-check` é dependência instalada.
- **Impacto**: borda numérica (strings exóticas de credor novo) só aparece em PRD.
- **Métrica de baseline**: 0 property tests.

### F-testability-4: risco residual TIME LOG do ADR-0079 não é teste

- **Severidade**: P3
- **Tactic**: Recordable Test Cases
- **Localização**: ADR-0079 §Consequências "Risco residual conhecido"
- **Evidência**: o cluster TIME LOG (4 falsos no estudo de 79 pares) é descrito em prosa; não há teste que fixe o comportamento esperado (ancorar um dos boletos idênticos é aceito — efeito financeiro nulo).
- **Impacto**: se um futuro refactor mudar o critério, a regressão passaria silenciosa.
- **Métrica de baseline**: 0 testes nomeando o cluster.

## 5. Cards Kanban

### [testability-1] Quebrar `MotorSugestaoBoleto` em módulos por âncora

- **Problema**
  > O motor tem 1148 LOC e já foi dividido em 3 arquivos de teste (`.test`, `.dps.test`, `.numero.test`). Cada âncora nova (I15p DPS, I15s número) vai somando. O custo de leitura cresce linearmente para o PatternGuardian e para o próximo autor.
- **Melhoria Proposta**
  > Extrair cada âncora (`AncoraOrdemDps` já existe; criar `AncoraNumeroConfiavel`) para um colaborador injetado, mantendo o motor como orquestrador de camada 0. Tactic: Limit Structural Complexity.
- **Resultado Esperado**
  > `MotorSugestaoBoleto.ts` 1148 LOC → ≤ 800 LOC; nova âncora passa a nascer num arquivo próprio ≤ 250 LOC.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**: LOC do motor 1148 → ≤ 800; arquivos de teste por âncora ≤ 1 novo por regra.
- **Risco de não fazer**: próxima âncora (watchlist cita "aprender por credor") inflá-lo para > 1300 LOC.
- **Dependências**: nenhuma (refactor isolado; cross-QA com Modifiability).

### [testability-2] Property-based em `normalizarNumero` e detector de duplicata

- **Problema**
  > A normalização é hoje a única barreira de entrada entre strings cruas do ERP (`doc_esp_numero` arbitrário) e o critério de identidade. 4 asserções pontuais não cobrem combinações improváveis (letras + separadores + zeros intercalados).
- **Melhoria Proposta**
  > Adicionar `fc.property` em `RegraSugestaoBoleto.test.ts` que gere strings alfanuméricas e verifique idempotência (`norm(norm(x)) === norm(x)`) e invariante "≥ 4 dígitos ⇒ aceita como âncora". Tactic: Executable Assertions.
- **Resultado Esperado**
  > Property tests em `normalizarNumero` 0 → ≥ 2; `fast-check` passa a ser usado em código do SISPAG (hoje 0 usos neste domínio).
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**: ≥ 2 propriedades verdes; shrinker não encontra contra-exemplo em 1000 runs.
- **Risco de não fazer**: credor com numeração exótica cria falso NUMERO_CONFIAVEL.

### [testability-3] Teste nomeando o cluster TIME LOG (risco residual aceito)

- **Problema**
  > O ADR-0079 aceita o cluster TIME LOG (4 falsos sobre 79 vínculos, efeito financeiro nulo), mas não há teste que ancore essa aceitação. Qualquer refactor que mude silenciosamente o comportamento passa.
- **Melhoria Proposta**
  > Codificar 1 caso em `MotorSugestaoBoleto.numero.test.ts` com dois boletos de mesmo valor, dia e emissor e número igual ao do título: a âncora escolhe um; o teste documenta a aceitação ("efeito financeiro nulo"). Tactic: Recordable Test Cases.
- **Resultado Esperado**
  > Testes nomeando o cluster TIME LOG 0 → 1.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**: 1 teste verde fixando o comportamento aceito pelo ADR.
- **Risco de não fazer**: regressão silenciosa invisível ao PatternGuardian.

## 6. Notas do agente

- Escopo estritamente o delta `git diff main` + untracked. Nenhum defeito do delta se enquadra em P0 — a feature está densamente coberta (18 testes do motor + fail-soft do serviço + schema FE + repositório).
- Cross-QA: F-testability-2 ↔ Modifiability (quebrar motor); F-testability-3 ↔ (nada no run reduzido); fail-soft `numeroAncoraDesligada` ↔ Fault Tolerance se incluído num próximo run.
- Métrica de precisão em PRD (82 %) é observacional, não automatizável aqui — registrada como ⚠ não medível.
