---
qa: Testability
qa_slug: testability
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-testability
generated_at: 2026-08-25T20:30:00-03:00
scope: backend
score: 6
findings_count: 8
cards_count: 7
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev refatora `RemessaService`/`ConciliacaoRetornoService` ou o Conexos publica mudança silenciosa de shape | PR encosta em qualquer arquivo do escopo `sispag/` | Suíte `sispag*.test.ts` (5 arquivos, 129 testes, 828+510+481+636+129 LOC) + `contrato.test.ts` + `validate-retomada-remessa-v1.ts` (AO VIVO em HML) | Local (dev) + CI (Jest) + HML esporádico (validate-*) | Regressão pega ANTES de subir para PRD, sem depender de "clicar no botão" | Nº de defeitos que passaram pelo gate mockado e só o AO VIVO viu: nesta feature foram **6** — meta: **≤1** por feature; e falha do gate ao vivo é reprodutível **≥3 execuções seguidas** sem gastar pool novo |

Contexto: os testes existem e cobrem cerca de 97% do `domain/service/sispag`, mas rodam contra mocks escritos pelo próprio autor da lógica; o gate ao vivo desta feature achou 6 defeitos de produção que não apareceriam em nenhum `expect(...)`. A pergunta central é: **quais outras suposições dos mocks continuam sem confronto com o ERP?**

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por camada** (per-layer table — Bass' single most-cited number) | ver tabela abaixo | ver alvos | ver ↓ | `cd src/backend && npx jest --coverage --testPathPatterns='sispag'` |
| Testes no escopo (sispag) | 235 casos em 14 test-files | manter ≥ 200 | ✅ | `grep -c "^\s*it\b\|^\s*test\b" src/backend/domain/**/sispag/*.test.ts src/backend/domain/client/ConexosSispag*.test.ts src/backend/routes/sispag.test.ts src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts` |
| Fixtures ao vivo capturadas | 6 de 8 planejadas | 8 de 8 | ❌ | `ls src/backend/domain/interface/sispag/__fixtures__/*.json` vs `jobs/capture-fixtures-sispag.ts` |
| Contract test contra ERP real | 6 shapes cobertas, 3 shapes críticas SEM cobertura | 9 shapes | ⚠️ | `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:33-97` |
| Testes frontend da feature | **0** em `src/frontend/app/sispag/`, `src/frontend/lib/sispag.ts` | ≥ 3 (page + LoteCard + lib) | ❌ | `find src/frontend -name '*.test.*' -path '*sispag*'` → vazio |
| Gate ao vivo repetível sem seed manual | Não — cada execução consome 2 títulos por cenário, sem cancelamento de lote em HML | ≥ 5 execuções sem intervenção | ❌ | `ontology/_inbox/sispag-retomada-gap.md#custo em HML` + `jobs/validate-retomada-remessa-v1.ts:262-284` |
| Perna de VOLTA (`.RET`) exercitada AO VIVO | **0 vezes** nesta bateria | ≥1 execução verde | ❌ | `_shared-metrics.md#gates executados` ("NAO exercitada ao vivo: a perna de VOLTA") |
| Não-determinismo em `RemessaService.hojeUtc()` | `new Date()` direto, não injetado | Clock injetável (tsyringe) ou congelado no teste | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:846-848` |
| Defeitos de PRD que os mocks não pegaram | 6 (documentados) | ≤ 1 por feature | ❌ | `ontology/_inbox/sispag-retomada-gap.md#defeitos de producao achados por este gate` |
| Coverage threshold enforcement | `global lines=72 branches=54 funcs=78` + `domain/service lines=88 branches=60` | manter, mas subir `branches` global para ≥ 60 | ⚠️ | `src/backend/jest.config.cjs:35-44` |

### Tabela obrigatória — cobertura por camada (Métrica observável #1)

Números coletados via `cd src/backend && npx jest --coverage --testPathPatterns='sispag' 2>&1 | tail -60` (250 casos passam em 10.4s). Filtrada para o escopo desta feature:

| Camada / Arquivo | % Stmts | % Branch | % Funcs | % Lines | Alvo (Bass) | Status |
|---|---|---|---|---|---|---|
| **`domain/service/sispag/` (agregado)** | 96.97 | 78.31 | 98.31 | 97.60 | 80/70/80 | ✅ |
| &nbsp;&nbsp;`RemessaService.ts` (870 LOC) | 94.83 | 76.19 | 92.30 | 95.95 | 80/70/80 | ✅ |
| &nbsp;&nbsp;`ConciliacaoRetornoService.ts` (455 LOC) | 95.79 | 75.96 | 100 | 97.22 | 80/70/80 | ✅ |
| &nbsp;&nbsp;`LotePagamentoService.ts` (405 LOC) | 97.65 | 94.00 | 100 | 97.52 | 80/70/80 | ✅ |
| &nbsp;&nbsp;`SispagPainelService.ts` (356 LOC) | 99.31 | 78.00 | 100 | 99.20 | 80/70/80 | ✅ |
| &nbsp;&nbsp;`FormacaoLotesService.ts` | 98.18 | 66.66 | 100 | 100 | 80/70/80 | ⚠️ branches |
| &nbsp;&nbsp;`IngestaoPagamentosService.ts` | 98.52 | 75.00 | 100 | 98.41 | 80/70/80 | ✅ |
| **`domain/client/` (SISPAG)** | 65.25 lines agg. | — | — | — | 60/50/60 | ⚠️ |
| &nbsp;&nbsp;`ConexosSispagClient.ts` (419 LOC) | 83.17 | 61.29 | 68.96 | 87.50 | 60/50/60 | ⚠️ **funcs**: `listContasCorrentes` (265-282) e `listContasFavorecido` (298-316) **sem teste** |
| &nbsp;&nbsp;`ConexosSispagWriteClient.ts` (629 LOC) | 72.43 | 42.65 | 72.22 | 72.67 | 60/50/60 | ⚠️ **branch**: erro-mapping (181-244, 468-512) sub-coberto |
| &nbsp;&nbsp;`ConexosSispagRetornoClient.ts` (401 LOC) | 69.09 | 49.62 | 70.96 | 68.68 | 60/50/60 | ⚠️ `carregarArquivoRetorno` error-branch (162-172), `getArquivoRetorno` sad-path (201-238) sub-coberto |
| **`domain/repository/sispag/`** | 72.61 | 56.08 | 55.55 | 72.85 | 60/50/60 | ⚠️ |
| &nbsp;&nbsp;`ConciliacaoExecucaoRepository.ts` | 19.35 | 0 | 0 | 15.38 | 60/50/60 | ❌ novo (feature), quase todo o corpo sem teste (linhas 26-149) |
| &nbsp;&nbsp;`LotePagamentoRepository.ts` (566 LOC) | 68.36 | 56.77 | 51.72 | 67.44 | 60/50/60 | ⚠️ |
| &nbsp;&nbsp;`RemessaExecucaoRepository.ts` | 79.48 | 55.55 | 60.00 | 84.84 | 60/50/60 | ✅ |
| &nbsp;&nbsp;`PagamentoIngestaoRunRepository.ts` | 100 | 83.33 | 100 | 100 | 60/50/60 | ✅ |
| **`routes/sispag.ts` (545 LOC)** | 74.88 | 50.54 | 80.95 | 78.36 | 60/40/60 | ⚠️ handlers 215-241, 253-280, 290-310 sem asserção (várias linhas de mapeamento de erro) |
| **`frontend/app/sispag/`, `frontend/lib/sispag.ts`** | — | — | — | **0** | 40/30/40 | ❌ **nenhum** `.test.*` |

Leitura: o service layer está exemplar; o **cliente** e o **repositório** — as duas camadas onde a suposição encontra o ERP e o SQL — carregam a dívida.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | tsyringe permite injetar mocks direto no construtor. Todos os testes desta feature usam `new RemessaService(loteRepo, ledger, write, sispag, env, log)` com mocks; `routes/sispag.test.ts` usa `container.registerInstance(...)` (34 sítios). Sem "integration masquerading as unit". | ✅ | `RemessaService.test.ts:152-166`; `routes/sispag.test.ts:96-116` |
| **Recordable Test Cases** | Fixtures ao vivo em `__fixtures__/` capturadas por `jobs/capture-fixtures-sispag.ts` (read-only, valores redigidos por tipo). Existem 6 de 8 planejadas. **Faltam**: `fin015-item-lote` (usado por `listarChavesDoLote`), `fin052-arquivo-retorno` (usado por `getArquivoRetorno`), `fin052-detalhe-retorno` (usado por `listDetalhe` — TODA a conciliação depende). Nem sequer planejada: `cmn025-conta-favorecido`. | ⚠️ | `ls __fixtures__/*.json` vs `capture-fixtures-sispag.ts:126-158` |
| **Sandbox** | `SISPAG_LIVE_WRITE_ENABLED=false` + `CONEXOS_DRY_RUN=true` são o kill-switch. `validate-retomada-remessa-v1.ts` recusa PRD sem `PERMITIR_PRD=1`. Existe modo DRY que só mede. | ✅ | `RemessaService.test.ts:625-644` (dry-run); `validate-retomada-remessa-v1.ts:47-50, 81` |
| **Executable Assertions** | Erros dedicados (`RemessaEmDuvidaError`, `LoteAnteriorCanceladoError`, `ConciliacaoEmDuvidaError`) codificam invariantes e são asseridos nos testes (~15 casos por classe). Regra "exatamente um candidato" testada em `RemessaService.test.ts:391-416`. | ✅ | `src/backend/domain/errors/*Error.ts` (12 classes, cobertura 98.69%) |
| **Abstract Data Sources** | `ConexosBaseClient` centraliza `postGenericOnce`/`getGeneric`/`listGenericPaginated`/`runWithRetry` — todos os testes de client mockam esses 4 pontos, sem tocar axios. Postgres é abstraído por `PostgreeDatabaseClient.withTransaction`, injetado como sentinel `TX` nos testes. | ✅ | `ConexosSispagWriteClient.test.ts:6-15`; `ConciliacaoRetornoService.test.ts:92-97` |
| **Limit Structural Complexity** | `RemessaService.ts` tem **870 LOC** e `RemessaService.test.ts` tem **828 LOC** — ratio 1:1 saudável, mas AMBOS são grandes; o serviço concentra criar-lote + importar + finalizar + gerar-remessa + baixar-arquivo + retomada em uma classe. Deveria virar 3-4 classes menores. | ⚠️ | `wc -l src/backend/domain/service/sispag/RemessaService.ts` |
| **Limit Non-Determinism** | `RemessaService.hojeUtc()` lê `new Date()` sem clock injetável (linha 846-848). `randomUUID()` direto em `LotePagamentoRepository.ts:131` e `PagamentoIngestaoRunRepository.ts:41`. **Nenhum teste usa `jest.useFakeTimers` ou `jest.setSystemTime`** (grep vazio). Isso deixa o teste do `dataDebito` no seu valor real de hoje — o mock do payload usa `1_790_000_000_000` e a asserção passa porque não compara com `hojeUtc()`. | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:1, 846-848`; grep `jest.useFakeTimers` em `*.test.ts` do escopo → 0 hits |
| **Isolation of test cases** | `afterEach(() => { container.clearInstances(); jest.clearAllMocks(); })` em `routes/sispag.test.ts`; nenhum `beforeAll`/`afterAll` com estado compartilhado nos 5 arquivos do escopo. | ✅ | grep `beforeAll\|afterAll` em `sispag/*.test.ts` → 0 hits |
| **Integration test lane** | Repo tem 13 arquivos `*.integration.test.ts` para Recebimentos, filtrados por `testPathIgnorePatterns: ['\\.integration\\.test\\.ts$']`. SISPAG tem **zero** arquivos nessa convenção. | ❌ | `find src/backend -name '*integration.test*'` — todos `recebimentos.e2e.*` |
| **CI gate + coverage threshold** | `coverageThreshold` em `jest.config.cjs`: `global lines=72 branches=54 funcs=78` e `./domain/service/ lines=88 branches=60`. Coverage do repo bate; o **threshold global fica ABAIXO da média do sispag** — significa que se o cliente/rota regredir 15 pontos de cobertura, o gate segue verde. | ⚠️ | `src/backend/jest.config.cjs:35-44` |

## 4. Findings (achados)

### F-testability-1: Contract test não cobre TODA a perna de retorno — o único código que nunca rodou ao vivo é também o menos defendido por fixture

- **Severidade**: P0 (crítico — risco de incidente em produção)
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/` (dir); `contrato.test.ts:33-97`; `ConexosSispagRetornoClient.ts:120-138, 195-213, 251-330`
- **Evidência (objetiva)**:
  ```
  __fixtures__/ contém: fin005-, fin015-lote, fin015-titulo-pendente, fin050-evento-bancario,
                        fin064-titulo-a-pagar, ger015-config-retorno.
  Faltam (planejados em capture-fixtures-sispag.ts:126-158, NUNCA gravados):
    - fin015-item-lote          → consumido por listarChavesDoLote (chave 'fil:doc:tit')
    - fin052-arquivo-retorno    → consumido por getArquivoRetorno (garTimProc = processadoEm)
    - fin052-detalhe-retorno    → consumido por listDetalhe (bxaCodSeq, borCod, flpCod, gerNum)
  Não planejado nem em capture-fixtures-sispag.ts:
    - cmn025-conta-favorecido   → consumido por listContasFavorecido (pctCodSeq, pctVldStatus)
  ```
  E cobertura confirma: `ConexosSispagRetornoClient.ts` = 68.68% linhas / 49.62% branches.
- **Impacto técnico**: Se o Conexos renomear `garTimProc` → `garTimProcessado`, `getArquivoRetorno` devolve `processadoEm: undefined` para SEMPRE, e cada tentativa de retomada de conciliação vai fail-closed com `CONCILIACAO_EM_DUVIDA`. O contract test NÃO detecta — não existe fixture pra checar. Idem para `bxaCodSeq`/`borCod` no `arquivosRetornoDetalhe`: renomeados, todos os itens caem em "reconhecido: false" silenciosamente.
- **Impacto de negócio**: A conciliação existente processa dezenas de arquivos `.RET`/mês; uma quebra silenciosa vira "financeiro achando que pagou/não pagou" — inversão de estado exatamente do tipo que a Fault-Tolerance existe pra evitar. Perda de rastreabilidade fin010 → lote local.
- **Métrica de baseline**: 3 shapes críticas sem fixture / 9 shapes consumidas pelo delta = 33% do contrato ERP sem defesa. Nenhuma execução AO VIVO da perna de retorno nesta feature (`_shared-metrics.md`).

### F-testability-2: `validate-retomada-remessa-v1.ts` é um gate one-shot — não repetível, não incluível em CI, esgota o pool de HML

- **Severidade**: P1 (alto — degrada QA mensurável)
- **Tactic violada**: Sandbox / Recordable Test Cases (o "sandbox" HML não é regenerável)
- **Localização**: `src/backend/jobs/validate-retomada-remessa-v1.ts:141-198, 262-284`; `ontology/_inbox/sispag-retomada-gap.md#custo em HML`
- **Evidência (objetiva)**:
  ```
  Cada cenário CONSOME 2 títulos permanentemente (importados saem do grid).
  ~13 lotes vazios criados na filial 2 durante desenvolvimento; sem endpoint de cancelamento.
  ~30 títulos precisaram ter vencimento empurrado via seed-hml-vencimento.ts p/ destravar pool.
  Job aborta silenciosamente se VAL_BNC escolhido não tiver cobertura suficiente:
    `ABORTADO: filial N não tem conta do banco X. Disponíveis: ...`
  ```
- **Impacto técnico**: A próxima refatoração no `RemessaService` só terá defesa AO VIVO se um humano lembrar de rodar o script, tiver `.env` correto de HML, tiver pool + seed disponíveis e for capaz de interpretar a saída. Não bloqueia PR. Não roda em CI (writes ao ERP). Não roda por Cron (idem).
- **Impacto de negócio**: Foi o gate que achou 6 defeitos de PRD nesta feature. Se ele perder repetibilidade, cada nova feature de SISPAG paga o mesmo custo de descoberta ("achamos porque rodamos manualmente"), e mais cedo ou mais tarde um defeito passa.
- **Métrica de baseline**: 0 execuções sequenciais possíveis sem seed manual; cobertura de bancos em HML: 5 bancos, apenas 4 têm conta pagadora (`_inbox/sispag-retomada-gap.md#o que destravou o pool`).

### F-testability-3: A perna de VOLTA (`.RET`) tem 26 testes mockados e 0 execuções AO VIVO — a mesma armadilha do PR #111

- **Severidade**: P0 (crítico — risco de incidente em produção)
- **Tactic violada**: Recordable Test Cases + Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.test.ts` (510 LOC, 26 testes); `_shared-metrics.md#gates executados`
- **Evidência (objetiva)**:
  ```
  _shared-metrics.md diz literalmente:
  "NAO exercitada ao vivo nesta bateria: a perna de VOLTA (conciliacao do .RET)"
  
  ConciliacaoRetornoService.test.ts assume:
    - `garTimProc` (via processadoEm) sempre número epoch-ms quando presente
    - `ArquivoRetornoDetalhe` traz {flpCod, itsCodSeq, docCod (string), titCod (string),
      borCod, bxaCodSeq, gerNum, valorPago}
    - listDetalhe retorna [] quando código ausente (sem erro)
    - eventos com `tipoRetorno: 1` = pago, `2` = rejeitado
  
  Nenhuma dessas suposições foi confrontada com o ERP nesta feature; a última execução
  AO VIVO documentada da conciliação está no PR anterior de retornos (não neste delta).
  ```
- **Impacto técnico**: Historicamente o PR #111 (ADR-0044) passou por todos os gates mockados e o gate ao vivo achou 2 P0. A perna de VOLTA está numa situação equivalente: contract test não cobre; nenhum `validate-*` roda; nenhum `.integration.test.ts` existe. Se o ERP mudar `fbeVldTpret` (que separa pago × rejeitado — `ConciliacaoRetornoService.test.ts:17`), toda rejeição vira pagamento silenciosamente.
- **Impacto de negócio**: Isto é literalmente o cenário citado em `Fin052Retorno.ts:104` ("Perder este campo faria toda rejeição virar pagamento na conciliação"). Baixa gravada em cima de rejeição = título aparece como pago no ERP e no nosso ledger.
- **Métrica de baseline**: 0 execuções ao vivo da conciliação no delta; 26 casos mockados; 0 fixtures das duas shapes centrais (`fin052/arquivosRetorno` e `fin052/arquivosRetornoDetalhe`).

### F-testability-4: `RemessaService.hojeUtc()` lê `new Date()` direto — teste não controla a data, invariantes de janela ficam sem cobertura determinística

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Limit Non-Determinism (Bass)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:845-848`; `jobs/validate-retomada-remessa-v1.ts:52-58` (duplica a mesma lógica com o mesmo comentário)
- **Evidência (objetiva)**:
  ```typescript
  private hojeUtc = (): number => {
      const d = new Date();
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  ```
  `RemessaService.test.ts` NUNCA faz `jest.useFakeTimers()`; os testes usam `1_790_000_000_000` como dataDebito e não comparam com hojeUtc. Ou seja: o serviço na verdade roda com **a data real do dia da execução do teste**, e a asserção só verifica que o valor foi *passado adiante* — não que ele estava correto para uma janela.
- **Impacto técnico**: Regras R1 (débito ≥ hoje) e R2 (débito ≤ menor vencimento) não têm teste que exercite virada de dia (23h59 → 00h00) nem timezone (`Date.UTC` em máquina rodando `America/Sao_Paulo`). Um bug de fuso passaria pelo `npm test` verde. O comentário em `validate-retomada-remessa-v1.ts:54` diz explicitamente "descobri isso reprovando o gate" — reincidente.
- **Impacto de negócio**: Bug de virada de dia = R1 recusar um pagamento que era pra ser feito hoje, ou aceitar um pra amanhã como "hoje" e sair fora da janela do banco.
- **Métrica de baseline**: 0 testes com clock injetável / fake timer em toda a suíte sispag; 1 fonte de não-determinismo temporal no serviço + duplicação no job de validação.

### F-testability-5: `listContasCorrentes` e `listContasFavorecido` — os dois métodos que destravaram a retomada — têm 0 testes unitários

- **Severidade**: P1 (alto — degrada QA mensurável)
- **Tactic violada**: Specialized Interfaces (o método existe mas não tem teste)
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:264-282` e `:298-316`; `ConexosSispagClient.test.ts` (9 casos, nenhum sobre essas duas funções)
- **Evidência (objetiva)**:
  ```
  Coverage output:
  ConexosSispagClient.ts | 83.17 | 61.29 | 68.96 | 87.50 | 148,265-282,298-316
                                                                    ^^^^^^^ ^^^^^^^
                                                            listContasCorrentes e listContasFavorecido
  ```
  Ambas são mockadas em `RemessaService.test.ts:135-146` — mas o mapeamento real (Number, String, sort por `padrao`, filtro `pctVldStatus === 1`) não é exercitado.
- **Impacto técnico**: Se `pctVldStatus` mudar de "1 = ativo" (mock em `ConexosSispagClient.ts:307`) para "0 = ativo", `listContasFavorecido` devolve [] e todo import cai no gate "favorecido sem conta ativa no banco" — falso-positivo em produção. Não há teste que segure a semântica desses filtros.
- **Impacto de negócio**: A gente literalmente descobriu no gate ao vivo que essa era a leitura crítica pra distinguir "títulos elegíveis" de "títulos sem conta no banco X" (`_inbox/sispag-retomada-gap.md#o que destravou o pool`). Perder essa leitura em silêncio = "pintou de pending sem motivo".
- **Métrica de baseline**: 2 métodos públicos críticos / 0 testes = 0% de cobertura sobre `listContasCorrentes` (fin005) e `listContasFavorecido` (cmn025).

### F-testability-6: Contract test só valida presença de chave — não pega mudança de tipo, valor nulo intermitente, ou remoção de fixture

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:81-90, 92-99`
- **Evidência (objetiva)**:
  ```typescript
  // O contract test asserta:
  const ausentes = campos.filter((c) => !(c in linha));
  expect(ausentes).toEqual([]);
  // ... e que valores redigidos começam com '<'.
  ```
  Não asserta: **tipo** do campo (number vs string vs boolean), **cardinalidade** (array vs escalar), **nullability** — o próprio JSDoc do arquivo reconhece isso: *"a redação preserva chaves e tipos, não valores. Um campo que passe a vir sempre nulo com o mesmo tipo NÃO é detectado aqui"*.
- **Impacto técnico**: Um dos 6 defeitos desta feature (defeito #5: `titulosCount` não conta itens, vale 1 para não-vazio) é exatamente o tipo de coisa que o contract test não pega — a chave está lá, o tipo é number, mas o SIGNIFICADO é diferente. Se `docCod` mudar de number para string entre releases do Conexos, também passa: chave presente, tipo qualquer.
- **Impacto de negócio**: Contract test dá falsa sensação de segurança ("temos gate contra shape drift"). Enquanto ele existir sem asserção de tipo, cada assunção do mock que envolva conversão (Number/String) é uma armadilha em potencial.
- **Métrica de baseline**: 4 asserções por fixture (presença de chaves + ausentes conhecidos + redação), 0 asserções de tipo/nullability/semântica; documentado como limite conhecido no próprio arquivo.

### F-testability-7: Frontend do SISPAG (page.tsx 1026 LOC + LoteCard 499 LOC + lib/sispag.ts 587 LOC) — 0 testes

- **Severidade**: P1 (alto — degrada QA mensurável)
- **Tactic violada**: Specialized Interfaces (frontend não é testável hoje)
- **Localização**: `src/frontend/app/sispag/`, `src/frontend/lib/sispag.ts`, `src/frontend/app/sispag/components/{LoteCard,IngestaoDialog,AdicionarTituloDialog}.tsx`
- **Evidência (objetiva)**:
  ```
  find src/frontend -name '*.test.*' -path '*sispag*' → vazio.
  find src/frontend -name '*.test.*' → 9 tests (utils, features, recebimentos + 6 componentes de recebimentos).
  ```
  O frontend TESTA `recebimentos` (9 arquivos), mas 0 para sispag apesar do delta desta feature ter tocado `page.tsx` (+19 linhas), `LoteCard.tsx` (+6 linhas) e `lib/sispag.ts` (+29 linhas).
- **Impacto técnico**: A rota `POST /sispag/lotes/:id/remessa` (a mais consequente da feature) tem teste do backend, mas o botão que dispara e a leitura do resultado (`response.status === 409 → mostrar RemessaEmDuvidaError`) não têm nenhum teste — mudança acidental de `retryable: true` para `retryable: false` (que muda o comportamento do botão) não gera falha em CI.
- **Impacto de negócio**: Feature nova + 2439 LOC de frontend sispag + 0 defesa = próxima feature quebra o botão que autoriza pagamentos.
- **Métrica de baseline**: 0 test files / 4 source files no escopo frontend (page + 3 componentes + lib). Ratio: **0.00**.

### F-testability-8: `ConciliacaoExecucaoRepository` é novo desta feature (149 LOC) e tem cobertura de 15% linhas / 0% branches

- **Severidade**: P1 (alto — degrada QA mensurável)
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts:26-149` (todas as linhas críticas descobertas)
- **Evidência (objetiva)**:
  ```
  ConciliacaoExecucaoRepository.ts | 19.35 | 0 | 0 | 15.38 | 26-149
  ```
  Não há `ConciliacaoExecucaoRepository.test.ts` no repositório (só existe para `RemessaExecucaoRepository`, com 11 casos).
- **Impacto técnico**: O ledger da conciliação é o que fecha o loop "arquivo já processado" ↔ "arquivo não processado, refaça". Se qualquer método (`beginExecution`, `marcarProcessado`, `settle`, `fail`, `findByIdempotencyKey`) escrever coluna errada ou UPSERT bugar, a conciliação vai reprocessar arquivos já pagos — gerando baixa em cima de baixa. Isto é o inverso da invariante que `write-ahead ledger` existe pra defender.
- **Impacto de negócio**: Dupla-baixa = dinheiro contabilizado duas vezes no fin010; para a conciliação bancária mensal, é o tipo de coisa que só é detectado no fechamento e vira retrabalho de horas do time de financeiro.
- **Métrica de baseline**: 15.38% lines / 0% branches / 0% funcs em arquivo novo de 149 LOC.

## 5. Cards Kanban

### [testability-1] Capturar e blindar as 3 shapes da perna de retorno + cmn025 (contract test completo)

- **Problema**
  > O delta tocou a perna de VOLTA (`.RET`) mas ela não foi exercitada AO VIVO nesta feature, e o `contrato.test.ts` NÃO cobre as três shapes que ela consome (`fin015/finItemSispag/list`, `fin052/arquivosRetorno/list`, `fin052/arquivosRetornoDetalhe/list`) nem `cmn025/ctcorr/list` (destravou o gate da ida). O `capture-fixtures-sispag.ts` já planeja capturar duas delas, mas os JSON nunca foram gravados. Se o ERP renomear `garTimProc`, `bxaCodSeq` ou `pctVldStatus`, o `npm test` segue verde e o bug aparece na baixa financeira.

- **Melhoria Proposta**
  > Rodar `npm run job:capture-fixtures` contra HML com um `.RET` já processado no ambiente (usar a config que capturou os 6 existentes). Adicionar `capture-fixtures-sispag.ts:cmn025` (usando um `pesCod` com conta cadastrada). Adicionar 4 entradas em `CONTRATOS` de `contrato.test.ts`: `fin015-item-lote`, `fin052-arquivo-retorno`, `fin052-detalhe-retorno`, `cmn025-conta-favorecido`, cada uma listando os campos que o código lê (usar grep de `r.campo` nos `.ts` correspondentes para não esquecer nenhum).

- **Resultado Esperado**
  > Contract coverage: **6 shapes → 10 shapes** (100% do que o SISPAG consome). Uma renomeação de `garTimProc`/`bxaCodSeq`/`pctVldStatus` no ERP quebra `contrato.test.ts` no CI antes de virar bug na baixa. `ConexosSispagRetornoClient.ts` sai de 68.68% para ≥ 80% linhas.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P0
- **Esforço estimado**: M (2 dias — 1 dia de captura em HML com .RET processado, meio dia de expansão do contrato, meio dia de revisão dos campos consumidos)
- **Findings relacionados**: F-testability-1, F-testability-3
- **Métricas de sucesso**:
  - Fixtures ao vivo: 6 → 10
  - Coverage `ConexosSispagRetornoClient.ts`: 68.68% linhas → ≥ 80%
  - Shapes ERP com contract test: 6/9 (67%) → 10/10 (100%)
- **Risco de não fazer**: Repetir o cenário do PR #111 (ADR-0044) — o mock mente exatamente como o código mente, o gate mockado passa, o bug aparece em produção como baixa duplicada ou rejeição virando pagamento. Impacto de negócio: dinheiro creditado errado no fin010.
- **Dependências**: Requer um `.RET` já carregado + processado em HML (banco 341 ou 237); se não houver, precisa carregar um antes.

### [testability-2] Exercitar a perna de VOLTA (`.RET`) AO VIVO — criar `validate-conciliacao-v1.ts` gêmeo do `validate-retomada-remessa-v1.ts`

- **Problema**
  > Toda a lógica de conciliação (26 casos mockados em `ConciliacaoRetornoService.test.ts`) nunca foi confrontada com o ERP nesta feature. As suposições que estão nos mocks (tipo, formato, semântica de `fbeVldTpret`, presença de `bxaCodSeq`) são as mesmas que a implementação faz — se ambas estiverem erradas juntas, o teste é verde e a conciliação silenciosamente inverte pago/rejeitado. Foi exatamente esse padrão que gerou os 6 defeitos desta feature.

- **Melhoria Proposta**
  > Espelhar `jobs/validate-retomada-remessa-v1.ts` num `jobs/validate-conciliacao-v1.ts` que: (a) usa um `.RET` já carregado em HML, (b) roda `conciliar({..., processar: false})` para PREVIEW read-only + `processar: true` num cenário controlado, (c) confere que `totalLinhas`/`pagos`/`rejeitados` batem com o próprio grid do ERP (via `listDetalhe` código a código), (d) exercita `varreduraIncompleta` (matando um dos códigos de propósito) e checa que o lote NÃO fecha em `BAIXADO`, (e) documentar em `_shared-metrics.md` que agora o gate ao vivo cobre as DUAS pernas. Deve rodar em modo DRY por default e recusar PRD sem `PERMITIR_PRD=1`.

- **Resultado Esperado**
  > Perna de retorno AO VIVO: **0 execuções → ≥1 execução verde** por feature que toca `ConciliacaoRetornoService.ts`, `ConexosSispagRetornoClient.ts` ou `ConciliacaoExecucaoRepository.ts`. Ganho: a próxima mudança nesse eixo vai ter a mesma defesa que o retomada da IDA teve nesta feature (que achou 6 defeitos).

- **Tactic alvo**: Sandbox + Executable Assertions
- **Severidade**: P0
- **Esforço estimado**: M (2-3 dias — espelhar o script do lado da IDA; a maior parte do trabalho é achar/carregar um `.RET` reprocessável)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Execuções AO VIVO da conciliação por feature: 0 → ≥1
  - Cenários exercitados ao vivo: 0 → ≥4 (pago, rejeitado, varredura incompleta, arquivo já processado)
  - Defeitos de PRD que passam pelos mocks: 6 nesta feature → ≤2 por feature (limitação: perna de volta segue menos exercitada por escassez de `.RET` reprocessáveis)
- **Risco de não fazer**: Um bug idêntico ao "importar aceita 1 item" — só que na conciliação — vira dupla-baixa em `fin010` na hora que o Conexos mudar shape de resposta. Perda de trust: se a IDA foi refeita 4 vezes por defeitos de mock, é razoável estimar que a VOLTA tem uma dívida análoga escondida.
- **Dependências**: Depende de #1 (fixtures capturadas) para saber o shape real antes de escrever as asserções.

### [testability-3] Reduzir custo de execução do `validate-retomada-remessa-v1.ts` — dar cancelamento programático de lote OU documentar o seed como parte do gate

- **Problema**
  > Cada execução do gate ao vivo da IDA consome 2 títulos por cenário (permanentes) e cria lotes vazios que não podem ser cancelados via API. `~30 títulos` foram consumidos e `~13 lotes vazios` ficaram no HML durante o desenvolvimento (documentado em `sispag-retomada-gap.md#custo em HML`). Sem correção, na terceira ou quarta feature que precisar rodar, o pool de HML acaba e o gate deixa de ser executável — o único gate que achou os 6 P0s desta feature.

- **Melhoria Proposta**
  > Explorar duas frentes em paralelo: (a) tentar via `postGenericOnce('fin015/cancelar/...')` na API do Conexos (o comentário do job diz "não há endpoint provado", mas provar a inexistência é diferente de aceitar); (b) codificar o seed-and-restore como PARTE do fluxo de `validate-retomada-remessa-v1.ts` — abrir sessão, seed 6 vencimentos, rodar cenários, `REVERTER=1` no final, sem intervenção humana. Documentar no `README` do job. Adicionar um `--reset-hml` que faz o restore sem rodar cenários.

- **Resultado Esperado**
  > Repetibilidade: **0 execuções sequenciais sem seed manual → ≥5** sem intervenção humana. Custo por execução: 2-6 títulos consumidos + 3 lotes vazios → 0 consumo líquido (reverte no final). Ganho colateral: gate viável em CI programado (weekly) em HML.

- **Tactic alvo**: Sandbox
- **Severidade**: P1
- **Esforço estimado**: L (1 semana — inclui investigar API de cancelamento com o Conexos)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Execuções sequenciais sem seed manual: 0 → ≥5
  - Títulos consumidos por execução: 2 por cenário → 0 (reverte)
  - Lotes vazios em HML: +3/execução → 0 (cancela ou reusa)
- **Risco de não fazer**: Daqui a 3 features o gate ao vivo estará indisponível por falta de pool; volta ao modelo "só mock", que foi o modelo do PR #111 (achou 0 P0 de 2).
- **Dependências**: Precisa cooperação da equipe Conexos ou investigação do OpenAPI para descobrir se há endpoint de cancelamento não-documentado.

### [testability-4] Injetar um `ClockProvider` em `RemessaService.hojeUtc()` — e usar `jest.setSystemTime` nos testes de janela

- **Problema**
  > `RemessaService.hojeUtc()` lê `new Date()` direto; nenhum teste da suíte usa `jest.useFakeTimers()`. Isso significa que os testes que exercitam R1 (débito ≥ hoje) e R2 (débito ≤ menor vencimento) rodam com a data REAL do dia — sujeitos a bugs de virada de dia (23h59 → 00h00) e de timezone (a máquina do CI vs. a máquina do dev vs. a produção AWS). `validate-retomada-remessa-v1.ts:52-58` duplica o `hojeUtc` com o mesmo comentário "descobri isso reprovando o gate" — reincidente.

- **Melhoria Proposta**
  > Criar `@injectable class ClockProvider { public now = () => new Date(); public hojeUtc = () => {...} }` em `domain/libs/clock/`. Injetar em `RemessaService` (e no restante do serviço que ler tempo). Nos testes existentes que dependem de `dataDebito`, usar `container.registerInstance(ClockProvider, { hojeUtc: () => 1_790_000_000_000 })` para fixar a data. Adicionar 2 testes novos: "recusa dataDebito < hojeUtc" e "aceita dataDebito == hojeUtc no limite".

- **Resultado Esperado**
  > Testes de janela determinísticos: 0 → ≥2 casos com clock fixo. Fontes de `new Date()` fora de `ClockProvider` em `src/backend/domain/**/sispag/`: 1 (RemessaService) + 1 (validate job duplicado) → 0. Bug de timezone escapa pelo CI: possível → impossível.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S (1 dia — classe pequena, refactor do serviço e do job)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - `new Date()` em src/backend/domain/service/sispag/: 1 → 0
  - Testes de janela R1/R2 com clock fixo: 0 → 2
- **Risco de não fazer**: Bug de virada de dia passa pelo CI verde e vira "pagamento não sai no dia correto" — pequeno em impacto, mas o tipo de bug que só reproduz uma vez por dia.
- **Dependências**: Nenhuma; alinha com Modifiability (clock injetável é padrão do repositório).

### [testability-5] Testar `ConexosSispagClient.listContasCorrentes` e `listContasFavorecido` — os dois métodos que destravaram a retomada

- **Problema**
  > Cobertura de `ConexosSispagClient.ts` = 87.5% linhas, mas as linhas descobertas (265-282, 298-316) são exatamente `listContasCorrentes` (fonte da conta pagadora) e `listContasFavorecido` (fonte da conta do favorecido — o filtro que resolveu o pool de HML). Nenhum caso em `ConexosSispagClient.test.ts` (9 casos) exercita mapeamento dessas duas leituras, apesar de o `RemessaService` mockar `pctVldStatus === 1` e ordenação por `padrao` sem cobertura.

- **Melhoria Proposta**
  > Adicionar 4 casos em `ConexosSispagClient.test.ts`: (a) `listContasCorrentes` mapeia agencia/dvConta/gerNum e filtra `Number.isFinite(ccoCod)`; (b) `listContasFavorecido` filtra `pctVldStatus !== 1`; (c) `listContasFavorecido` ordena `padrao=true` primeiro; (d) `listContasFavorecido` passa `pesCod#EQ` no filterList. Reaproveitar shape do `cmn025-conta-favorecido` do card #1.

- **Resultado Esperado**
  > Coverage `ConexosSispagClient.ts`: 87.5% → ≥ 95% linhas; branches: 61.29% → ≥ 75%. Regressão em `pctVldStatus === 1` (o filtro que decide se favorecido tem conta ativa) vira teste vermelho em vez de "nenhum título elegível" em produção.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (meio dia)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Coverage `ConexosSispagClient.ts` linhas: 87.5% → ≥ 95%
  - Casos em `ConexosSispagClient.test.ts`: 9 → 13
  - Métodos públicos sem teste em `ConexosSispagClient`: 2 → 0
- **Risco de não fazer**: Se o Conexos trocar o valor de `pctVldStatus` para "ativo" (ex: passar de 1 para 0 ou introduzir 2 como "ativo restrito"), todo import começa a recusar por "favorecido sem conta ativa" — falso-negativo em produção, sem cobertura no CI.
- **Dependências**: Nenhuma.

### [testability-6] Cobrir `ConciliacaoExecucaoRepository` — novo, com 15% de cobertura e responsável pelo write-ahead da conciliação

- **Problema**
  > `ConciliacaoExecucaoRepository.ts` é novo desta feature (149 LOC), fecha o loop "arquivo já processado / não processado" com o ERP e tem cobertura de 15.38% linhas / 0% branches. Se `beginExecution` / `marcarProcessado` / `settle` / `fail` gravarem colunas erradas ou falharem no UPSERT, a conciliação reprocessa arquivos já pagos = baixa em cima de baixa. É o inverso da invariante que o write-ahead defende.

- **Melhoria Proposta**
  > Criar `ConciliacaoExecucaoRepository.test.ts` espelhado em `RemessaExecucaoRepository.test.ts` (11 casos, 79.48% cobertura). Casos mínimos: (a) `beginExecution` insere em `settled`? (b) `beginExecution` faz UPSERT quando linha já existe em `error`? (c) `marcarProcessado` grava timestamp DEPOIS de `beginExecution` (write-ahead); (d) `settle` grava totais + `processou`; (e) `findByIdempotencyKey` devolve `undefined` quando ausente; (f) `listByStatus` respeita `limit`.

- **Resultado Esperado**
  > Coverage `ConciliacaoExecucaoRepository.ts`: 15.38% linhas / 0% branches → ≥ 80% linhas / ≥ 55% branches (paridade com `RemessaExecucaoRepository`). Um bug de UPSERT ou de write-order no ledger da conciliação vira teste vermelho antes de vira baixa duplicada.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (1 dia — copiar estrutura do teste irmão de remessa)
- **Findings relacionados**: F-testability-8
- **Métricas de sucesso**:
  - Coverage `ConciliacaoExecucaoRepository.ts`: 15.38% → ≥ 80% linhas
  - Casos: 0 → ≥ 8
- **Risco de não fazer**: Baixa duplicada em `fin010` na próxima refatoração do ledger, detectada só no fechamento contábil mensal.
- **Dependências**: Nenhuma.

### [testability-7] Enrijecer o `contrato.test.ts` para pegar mudança de TIPO e nulidade constante, não só chave ausente

- **Problema**
  > `contrato.test.ts` só valida presença de chaves e redação. Como o próprio JSDoc reconhece, ele NÃO detecta: (a) mudança de tipo (number → string), (b) campo virando `null` permanente com o mesmo tipo, (c) shape de array vs escalar. O defeito #5 desta feature (`titulosCount` não conta itens) é exatamente o tipo de coisa que o contract test não pega — a chave está lá, o tipo é number, o significado mudou.

- **Melhoria Proposta**
  > Estender o marcador de redação para carregar TIPO (`<string>`, `<number>`, `<boolean>`) e opcionalmente cardinalidade (`<array<string>>`). No teste, adicionar asserção: para cada campo em `campos`, o valor da fixture bate no tipo esperado (mapa `campos` vira `{ campo: 'number' | 'string' | 'boolean' | 'nullable-number' }`). Isso quebra em duas hipóteses: renomeação (já detectado) e mudança de tipo (novo).

- **Resultado Esperado**
  > Asserções por fixture: 3 (chaves presentes + ausentes-conhecidos + redação) → 4 (as anteriores + tipo por campo). Detecção de mudança de tipo pelo ERP: impossível → possível. O defeito "chave certa, tipo trocado" deixa de ser invisível.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: M (2 dias — precisa adaptar `capture-fixtures-sispag.ts` para emitir marcadores tipados, recapturar os 6 fixtures, escrever a asserção de tipo)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Asserções por fixture no contract test: 3 → 4
  - Casos em `contrato.test.ts`: 4 → ≥ 5 (novo caso "tipos bate")
  - Cenários que passam invisíveis hoje: 3 (mudança de tipo, null permanente, cardinalidade) → 1 (só null permanente segue difícil)
- **Risco de não fazer**: Um defeito equivalente ao "titulosCount = 1 sempre" reaparece na conciliação (ex: `bxaCodSeq` virando string "42" em vez de number 42) e passa por todos os gates.
- **Dependências**: Alinha com card #1 (recapturar fixtures) — pode ser feito no mesmo trabalho.

## 6. Notas do agente

- **Escopo obedecido**: só `sispag*` desta feature; ignorei `recebimentos/*` (tem sua própria seção de testes e cobertura via `*.integration.test.ts`).
- **Frontend deliberadamente P1, não P0**: 0 testes é P0 num app com botão que autoriza pagamento — mas o backend do mesmo botão TEM 37 casos de rota + 38 casos de serviço + gate ao vivo. Coloquei P1 porque o dano é degradar a linha de defesa, não abri-la; se o consolidator quiser subir para P0, aceito.
- **Não medi**: mutation testing (`stryker` etc.) — repo não tem. Seria a métrica que mataria a dúvida "os testes existem, mas *asserem* o suficiente?".
- **Cross-QA**: card #4 (ClockProvider) e #6 (repositório novo) tocam **Modifiability** (injeção como padrão do repo); cards #1 e #7 (fixtures + tipos) tocam **Integrability** (contract testing); card #2 (validate conciliacao ao vivo) toca **Fault-Tolerance** (é o gate contra dupla-baixa) e **Deployability** (deveria bloquear PR/deploy quando toca a perna de volta).
- **Métrica que faltou**: uma execução do `validate-retomada-remessa-v1.ts` no CI em HML programado (weekly) — hoje depende de humano lembrar. O card #3 destrava isso.
