---
qa: Testability
qa_slug: testability
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-testability
generated_at: 2026-07-29T02:50:00Z
scope: all
score: 8
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/QA rodando o pipeline de gate (CI + pre-merge) | Nova ação "Processar → Solicitação de Numerário (encomenda)" adicionada — build do payload `GerDocProcessoSelectionDTOCab` + seam DRY-RUN-only para `com299/gerDocProcesso` | `SolicitacaoNumerarioService`, `ProcessoProviderStub` (port), rota `/recebimentos/transacoes/:txnId/solicitacao-numerario`, `AlocarProcessosDialog`, `lib/recebimentos.ts` | Desenvolvimento (jest local + CI) — sem HML Conexos, sem HAR do `gcdCod` real | Todos os ramos observáveis (build de payload, authz por-filial, boundary Zod, seam NotImplementedError, fallback do FE) exercitados por testes determinísticos que nunca tocam Conexos/DB/rede | 100% linhas + ≥ 87% branches nos 4 arquivos-fonte do delta; 34 testes verdes; zero flakes por tempo/rede; `enviarAoErp` garantidamente falha em runtime se alguém tentar cabear-o |

> Bass: o custo de testar essa feature é *baixo por design* — a decisão-chave foi separar o `Processo` (behind `ProcessoProviderInterface`) da fonte real (Conexos/matching engine), e ISOLAR o envio ERP num seam (`enviarAoErp`) que lança `NotImplementedError`. Cada teste substitui um port e afirma sobre o shape retornado; nenhum precisa negociar com Conexos, DB ou timers.

## 2. Métricas observadas

### 2.1 Cobertura por camada (delta SN) — Métrica #1

Coletada com `jest --coverage --collectCoverageFrom` restrito aos arquivos do delta (comando abaixo em §2.3).

| Arquivo | Stmts | Branch | Funcs | Lines | Uncovered lines |
|---|---|---|---|---|---|
| `domain/service/recebimentos/SolicitacaoNumerarioService.ts` | 100% | 50% | 100% | 100% | L83 (fallback `moeCod \|\| SOLICITACAO_NUMERARIO_MOE_COD` — ramo do OR curto-circuitado) |
| `domain/service/recebimentos/stubs/ProcessoProviderStub.ts` | 100% | 87.5% | 100% | 100% | L27 (`p.contraparte ?? p.dpeNomPessoa` — ramo do `??`) |
| `domain/errors/NotImplementedError.ts` | 100% | 50% | 100% | 100% | L21 (default do `message ?? …`) |
| `routes/recebimentos.ts` | 93.33% | 63.63% | 75% | 93.33% | L37-38 (GET `/painel` stub), L79 / L169 / L217 (`throw err` para erros não-`FilialForbiddenError`) |
| **Agregado do delta** | **95.68%** | **67.64%** | **90.9%** | **95.45%** | — |

### 2.2 Métricas gerais

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Backend jest (suites/tests) — baseline global | 75 / 740 verdes | 100% verde | ✅ | `_shared-metrics.md` §Gate baselines |
| Frontend jest (suites/tests) — baseline global | 20 / 104 verdes | 100% verde | ✅ | `_shared-metrics.md` §Gate baselines |
| Testes do delta SN — backend (arquivos tocados) | 3 suites / 21 tests | ≥ 1 suite por arquivo produtivo + happy/authz/boundary | ✅ | `cd src/backend && npx jest domain/service/recebimentos/SolicitacaoNumerarioService.test.ts domain/service/recebimentos/stubs/ProcessoProviderStub.test.ts routes/recebimentos.test.ts` |
| Testes do delta SN — frontend | 2 suites / 13 tests | ≥ 1 suite por módulo tocado (lib + componente) | ✅ | `cd src/frontend && npx jest lib/recebimentos.test.ts app/recebimentos/components/AlocarProcessosDialog.test.tsx` |
| `it()` por arquivo (delta SN) | Service 6 · Stub 4 · Route 11 · lib FE 10 · Dialog 3 | ≥ 3 por unidade não-trivial | ✅ | `grep -c "^\s*it("` |
| Testes que fazem rede real (unit) | 0 | 0 | ✅ | `apiFetch` mockado em `lib/recebimentos.test.ts:15`; rota testada via `fetch` local a `http://127.0.0.1:0` (loopback, sem Conexos) — `bootstrapAppContainer` mockado em `routes/recebimentos.test.ts:8-10` |
| LOC dos arquivos de teste do delta | 88 / 44 / 287 / 162 / 121 | ≤ 500 por arquivo | ✅ | `wc -l` (nenhum > 500) |
| Uso de fixtures compartilhadas | `processoFixture` + `processoCandidatosSeed` (fonte única BE) + `fixtureProcessos` (FE) | Fixtures nomeadas, reutilizáveis | ✅ | `domain/interface/recebimentos/__fixtures__/processo.fixture.ts:1-53` |
| DI seam usado por teste (constructor-injection vs `container.resolve`) | Service: `new SolicitacaoNumerarioService(logStub)` (BE unit); Route: `container.registerInstance(RecebimentoPipelineService, { run })` + `container.registerInstance(PROCESSO_PROVIDER_TOKEN, …)` | Constructor-injection nas units, `registerInstance` nas de rota | ✅ | `SolicitacaoNumerarioService.test.ts:9`, `routes/recebimentos.test.ts:83, 179-181` |
| Tempo / não-determinismo — leitura de `new Date()` em código-fonte tocado | 3 sites (`routes/recebimentos.ts:38,87,232`) + 1 no FE (`lib/recebimentos.ts:396,515`) | 0 ou clock injetável | ⚠️ | `grep -n "new Date"` — o serviço RECEBE `dataReferencia` (bom), mas a ROTA constrói `new Date()` inline e o passa; nenhum teste afirma sobre datas de emissão/vencimento retornadas pela rota |
| Randomness / UUID gerado em source | 0 (correlationId vem do body com Zod `.uuid()`) | 0 | ✅ | `grep "Math.random\|randomUUID\|randomBytes"` no delta = vazio |
| Uso de `fast-check` (property-based) na feature | 0 | ≥ 1 property para o builder de payload (invariantes: `payload.valor == items[0].total`; `docConfig.gcdDesNome == payload.gcdDesNome`; `dryRun === true`) | ⚠️ | `grep "fc\.\|fast-check"` no delta = 0; dep já existe no repo |
| CI gate `npm test -- --coverage` | ✅ presente | Presente e bloqueante | ✅ | `.github/workflows/ci.yml:26, 46` |
| Threshold de cobertura enforçado (BE) | global `{lines:72, branches:54, functions:78}` + `./domain/service/` `{lines:88, branches:60}` | Presente; SN respeita | ✅ | `src/backend/jest.config.cjs:34-44` |
| Threshold de cobertura enforçado (FE) | global `{lines:20, branches:9, functions:14}` — FLOORS MUITO BAIXOS (herdados) + `./lib/auth/` `{lines:24}` | Elevar após adicionar testes; hoje só previne regressão trivial | ⚠️ | `src/frontend/jest.config.js:35-44` — comentário admite dilüição por UI sem teste |
| Log assertion (BE) — `logService.info` em happy path é verificado? | Não afirmado explicitamente | Verificar pelo menos que o BUSINESS_INFO é emitido com `dryRun:true` (Observability sem PII) | ⚠️ | `SolicitacaoNumerarioService.ts:97-107` emite log; `SolicitacaoNumerarioService.test.ts` monta `logStub = { info: jest.fn() }` mas nunca chama `expect(logStub.info).toHaveBeenCalledWith(...)` |
| Cobertura da branch **"não-`FilialForbiddenError`"** (ramo `throw err`) nas 3 rotas | 0/3 rotas | 3/3 (garantir que o `errorMiddleware` cata + o handler não engole) | ⚠️ | `routes/recebimentos.ts:79, 169, 217` — uncovered nas 3 rotas |
| Estados observáveis do modal ("loading", "empty", "erro", "resultado", "processando") testados | 3/5 (list, empty, happy) — **faltam** `erro` (setErro) e `processandoPri` (spinner/disabled) | 5/5 | ⚠️ | `AlocarProcessosDialog.test.tsx:87-121` — sem `mockFetch.mockRejectedValue` (branch de erro L97-99) nem asserção sobre `disabled` durante `processandoPri` (L212-218) |

### 2.3 Comandos-fonte (reproduzíveis)

```
# Baseline global
cd src/backend  && npm test
cd src/frontend && npm test

# Delta SN — backend (21 tests / 3 suites)
cd src/backend && npx jest \
  domain/service/recebimentos/SolicitacaoNumerarioService.test.ts \
  domain/service/recebimentos/stubs/ProcessoProviderStub.test.ts \
  routes/recebimentos.test.ts

# Delta SN — frontend (13 tests / 2 suites)
cd src/frontend && npx jest \
  lib/recebimentos.test.ts \
  app/recebimentos/components/AlocarProcessosDialog.test.tsx

# Cobertura scoped no delta (§2.1)
cd src/backend && npx jest --coverage \
  --collectCoverageFrom='domain/service/recebimentos/SolicitacaoNumerarioService.ts' \
  --collectCoverageFrom='domain/service/recebimentos/stubs/ProcessoProviderStub.ts' \
  --collectCoverageFrom='domain/errors/NotImplementedError.ts' \
  --collectCoverageFrom='routes/recebimentos.ts' \
  domain/service/recebimentos/SolicitacaoNumerarioService.test.ts \
  domain/service/recebimentos/stubs/ProcessoProviderStub.test.ts \
  routes/recebimentos.test.ts
```

> Todos os comandos rodaram localmente em 2026-07-29 no worktree `~/kavex-worktrees/recebimentos-alocar-sn`.
>
> ⚠️ **Não medível localmente**: cobertura em produção (mutation testing, coverage on real prod calls). Requer instrumentação de mutantes (`stryker`) — não é dep do repo. Recomendação: postergar até o wire real do `enviarAoErp` existir.

## 3. Tactics — Cobertura no nf-projects

Bass & Clements ch.10 (Testability tactics). Nomenclatura canônica em inglês.

### Control and Observe System State

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `ProcessoProviderInterface` (port com `Symbol` token) + `ProcessoProviderStub` como implementação in-memory swappable → routes/service consomem o port, jamais Conexos direto. `SolicitacaoNumerarioService.enviarAoErp` é um **seam explícito** com semântica `NotImplementedError` (501, não-retryable) para provar que o teste NUNCA aciona ERP por acidente. | ✅ presente | `domain/interface/recebimentos/ports.ts:220-236, 351`; `stubs/ProcessoProviderStub.ts:15-31`; `routes/recebimentos.ts:171`; `SolicitacaoNumerarioService.ts:117-121`; `errors/NotImplementedError.ts:11-26` |
| Record/Playback (Recordable Test Cases) | Fixtures deterministas (`processoFixture`, `processoCandidatosSeed`) espelhadas BE→FE (`fixtureProcessos` em `lib/recebimentos.ts:368-389` reflete o seed do stub). **Não há gravação de HAR** do com299 real (esperado — HAR chega em HML, ver `_shared-metrics.md` §arch context). | ⚠️ parcial | `__fixtures__/processo.fixture.ts:1-53`; `lib/recebimentos.ts:368-389` |
| Sandbox | O feature *é* um sandbox por design: `dryRun:true` é o único caminho alcançável; o wire real está deliberadamente ausente. A rota `POST /solicitacao-numerario` NÃO tem side-effect fora do log (não persiste, não emite SQS, não POSTa). | ✅ presente | `SolicitacaoNumerarioService.ts:32-42` (docstring), `routes/recebimentos.ts:192-198` |
| Executable Assertions | Zod nos boundaries (rota) + `NotImplementedError` como *guard* dinâmico que faz o teste falhar se alguém tentar invocar o seam de envio. Tipos `SolicitacaoNumerarioDryRun` com `dryRun: true` literal também são um invariante em nível de tipo. | ✅ presente | `routes/recebimentos.ts:181-190, 205-209`; `SolicitacaoNumerarioService.test.ts:78-87`; `GerDocProcesso.ts:131-135` |
| Abstract Data Sources | Provider stub troca a fonte "Conexos + matching engine" por fixtures via um `Symbol` DI. Nenhum SQL no delta; `bootstrapAppContainer` é mockado no teste de rota (sem DB/rede). | ✅ presente | `routes/recebimentos.test.ts:8-10, 179-182`; `ports.ts:351` |

### Limit Complexity

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Limit Structural Complexity | Camadas curtas: rota (Zod + authz + resolve + delegate) → service (função pura de build) → provider (stub). Nenhum arquivo do delta > 300 LOC (maior: `routes/recebimentos.ts` 240 + `recebimentos.test.ts` 287). `SolicitacaoNumerarioService.gerar` é uma função pura sem I/O (fácil de testar sem mocks). | ✅ presente | `wc -l` §2.2; `SolicitacaoNumerarioService.ts:58-110` |
| Limit Non-Determinism | Service **recebe** `dataReferencia: Date` do caller (excelente controle no teste — L11 fixa `new Date('2026-07-28T12:00:00.000Z')`). MAS a **rota** faz `new Date()` inline (`routes/recebimentos.ts:232`) e o teste de rota NÃO afirma sobre `docDtaEmissao`/`dtaVencimento` do payload retornado — ramo temporal fica não-verificável determinsticamente pela rota. O FE também faz `new Date().toISOString()` no fallback (`lib/recebimentos.ts:396`) sem `jest.useFakeTimers`. Zero uso de RNG no delta. | ⚠️ parcial | `SolicitacaoNumerarioService.ts:58` (bom); `routes/recebimentos.ts:38, 87, 232` (ruim); `lib/recebimentos.ts:396, 515`; `SolicitacaoNumerarioService.test.ts:11` |

## 4. Findings

### F-testability-1: cobertura excelente por arquivo, mas dois ramos de erro nas 3 rotas ficam sem teste

- **Severidade**: P2 (médio — débito técnico defensável; risco baixo mas mensurável)
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/routes/recebimentos.ts:79, 169, 217`
- **Evidência (objetiva)**:
  ```
  # jest --coverage (§2.1)
  routes/recebimentos.ts | 93.33% stmts | 63.63% branch | uncovered: 37-38, 79, 169, 217
  # L79 / L169 / L217 são todos o "throw err" quando o erro NÃO é FilialForbiddenError
  ```
- **Impacto técnico**: se um dia `assertUserCanActOnFilial` (ou outra função síncrona no `try`) lançar um erro diferente de `FilialForbiddenError`, o `errorMiddleware` recebe — o teste não garante essa propagação nas 3 rotas. Baixa probabilidade hoje (o único throw hoje é `FilialForbiddenError`), mas a regressão silenciosa é ruim de rastrear.
- **Impacto de negócio**: potencial `500` mascarado como `403` ou vice-versa em um erro futuro → analista vê mensagem errada, ticket de suporte ruidoso.
- **Métrica de baseline**: branches em `routes/recebimentos.ts` = 63.63% (14/22 branches cobertos). Ramo "não-Forbidden throw" = 0/3 rotas.

### F-testability-2: `SolicitacaoNumerarioService` emite BUSINESS_INFO sem PII, mas nenhum teste afirma o log

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (log como observação estruturada)
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107`; `SolicitacaoNumerarioService.test.ts:7`
- **Evidência (objetiva)**:
  ```typescript
  // service emite:
  void this.logService.info({
      type: 'BUSINESS_INFO',
      message: 'gerarSolicitacaoNumerario (dry-run) — nenhuma chamada ao ERP',
      data: { dryRun: true, priCod, filCod, gcdDesNome, ator },
  });
  // teste declara:
  const logStub = { info: jest.fn(), ... };
  // …e NUNCA chama expect(logStub.info).toHaveBeenCalledWith(...)
  ```
- **Impacto técnico**: se alguém remover o log (ou incluir PII — `dpeNomPessoa`/`priEspRefcliente`) no `data`, nenhum teste falha. A afirmação de que o log carrega `dryRun:true` (Observability sem PII) só é verdadeira por convenção.
- **Impacto de negócio**: LGPD cross-QA (Security) — vazamento de nome de cliente/ref para log em produção não seria detectado no gate. Também compromete auditoria (o "dry-run — nenhuma chamada ao ERP" é a única prova estruturada de que o envio foi simulado).
- **Métrica de baseline**: asserções sobre `logStub.info` no service SN = 0.

### F-testability-3: rota constrói `new Date()` inline sem clock injetável — timestamps do payload ficam não-verificáveis

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/routes/recebimentos.ts:38, 87, 232`; `src/frontend/lib/recebimentos.ts:396, 515`
- **Evidência (objetiva)**:
  ```typescript
  // routes/recebimentos.ts:232
  const result = service.gerar({
      processo: { ... },
      valorTransacao: parsed.data.valorTransacao,
      dataReferencia: new Date(),   // ← não-injetável
      ator,
  });
  ```
  ```typescript
  // routes/recebimentos.test.ts:240-258
  it('200 returns dryRun payload with the encomenda gcd config', async () => {
      // Asserta filCod, priCod, valor, gcdDesNome. NÃO asserta docDtaEmissao/dtaVencimento.
  });
  ```
- **Impacto técnico**: o service unit test fixa `new Date('2026-07-28T12:00:00.000Z')` e afirma `docDtaEmissao`/`dtaVencimento` (`SolicitacaoNumerarioService.test.ts:65-74`) — bom. Mas a rota constrói o `Date` sozinha e o teste de rota não afirma essas 2 chaves do payload, então uma regressão que troque `dataReferencia: new Date()` por `new Date(0)` ou `undefined` passaria despercebida no gate de rota. Mesmo problema no fallback local do FE (`buildDryRunFallback`).
- **Impacto de negócio**: `dtaVencimento` errado no payload real (quando `enviarAoErp` for wired) → borderô com vencimento incorreto no ERP; risco financeiro real quando o seam for cabeado. Hoje mitigado por `dryRun:true`, mas o gate não protege contra a regressão.
- **Métrica de baseline**: sites não-injetáveis de `new Date()` no delta (BE+FE) = 5. Testes que afirmam sobre o timestamp emitido pela ROTA = 0.

### F-testability-4: modal `AlocarProcessosDialog` tem 3/5 estados observáveis testados

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.test.tsx:87-121`; UI em `AlocarProcessosDialog.tsx:81-126, 155-172`
- **Evidência (objetiva)**:
  ```
  Estados observáveis do modal:
    - loading (skeleton)            → NÃO testado
    - erro   (EmptyState "não foi possível carregar", setErro) → NÃO testado (L97-99 do .tsx)
    - vazio  (EmptyState "Nenhum processo candidato") → ✅ testado
    - lista  (Table + botão "Processar") → ✅ testado
    - processando (spinner + disabled) → NÃO afirmado (L212-218 do .tsx)
    - processado (Badge "processado (simulação)" + PayloadPreview) → ✅ testado
  ```
- **Impacto técnico**: uma regressão que quebre o skeleton (`aria-busy="true"`) ou remova a mensagem de erro do `EmptyState` passa despercebida. O `disabled={processandoPri === p.priCod}` também não é verificado — dupla-submissão silenciosa.
- **Impacto de negócio**: analista poderia clicar "Processar" duas vezes em rápida sucessão e disparar 2 dry-runs (hoje inócuo; quando o seam for cabeado, é uma potencial dupla-emissão). Cross-QA com Availability (idempotência da UI).
- **Métrica de baseline**: estados testados no dialog = 3/5. `it()` no dialog test = 3.

### F-testability-5: fallbacks silenciosos do FE (`try/catch` genérico) reduzem observabilidade de falhas

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/lib/recebimentos.ts:450-452, 489-491, 521-523`
- **Evidência (objetiva)**:
  ```typescript
  } catch {
      return fixtureProcessos.filter((p) => p.filCod === filCod)
  }
  ```
- **Impacto técnico**: o `catch {}` sem `console.warn` / `logger` faz o teste do fallback (`lib/recebimentos.test.ts:123-128`) provar que retorna fixture — mas em produção, um 500 do backend fica invisível para o QA/analista (a tela renderiza fixture como se fosse "banco"). O `fonte: 'fixture' | 'banco'` só é setado corretamente em `fetchPainelRecebimentos`; `fetchProcessosParaTransacao` e `processarSolicitacaoNumerario` não devolvem essa marca.
- **Impacto de negócio**: durante o demo, a review pode achar que o ERP está integrado quando na verdade caiu no fixture. Cross-QA com Deployability (falta de sinal de "modo demo" impede detectar prod-vs-fixture).
- **Métrica de baseline**: `catch {}` sem log = 3 sites; funções que devolvem `fonte:'fixture'|'banco'` = 1/3 (`fetchPainelRecebimentos` só).

### F-testability-6: nenhuma property-based test para o builder do payload (fast-check é dep instalada)

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.test.ts` (ausente)
- **Evidência (objetiva)**:
  ```
  grep "fc\.\|fast-check" no delta = 0 usos
  dep `fast-check` presente no repo (CLAUDE.md §Frontend Testing)
  ```
- **Impacto técnico**: os 5 exemplos do service test são "gold masters" — cobrem casos típicos mas não invariantes universais (`payload.valor === items[0].total === items[0].tmpMnyValor` para todo `valorTransacao ∈ ℝ⁺`; `payload.docDtaEmissao === payload.dtaVencimento` para toda `dataReferencia`; `moeCod = processo.moeCod || DEFAULT`).
- **Impacto de negócio**: baixo hoje (dry-run), mas o builder é a única linha de defesa entre a UX e o ERP quando o seam for cabeado — vale a pena defender as invariantes com uma property.
- **Métrica de baseline**: properties = 0. Invariantes candidatas facilmente enumeráveis = ≥ 3.

## 5. Cards Kanban

### [testability-1] Cobrir o ramo `throw err` (não-`FilialForbiddenError`) nas 3 rotas de recebimentos

- **Problema**
  > As 3 rotas de recebimentos (`/pipeline/run`, `/transacoes/:txnId/processos`, `/transacoes/:txnId/solicitacao-numerario`) fazem `throw err` quando o erro do `assertUserCanActOnFilial` não é `FilialForbiddenError`. Nenhum dos 3 sites é exercitado pelos testes atuais — `routes/recebimentos.ts` fica em 63.63% de branches. O ramo existe para deixar o `errorMiddleware` catar erros inesperados; sem teste, uma regressão que engula o erro passa despercebida.

- **Melhoria Proposta**
  > Adicionar 3 testes (um por rota) que injetam um `assertUserCanActOnFilial` que lança um `Error` genérico (por exemplo mockando `../http/filialAuthz.js` com `jest.spyOn`) e afirmam que a resposta é `500` (ou o comportamento definido pelo `errorMiddleware`) — provando que o `throw err` propaga. Tactic Bass: **Executable Assertions**. Arquivos a tocar: `src/backend/routes/recebimentos.test.ts`.

- **Resultado Esperado**
  > Branches em `routes/recebimentos.ts`: **63.63% → ≥ 80%**. Ramo "não-`FilialForbiddenError`" coberto em 3/3 rotas.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - `routes/recebimentos.ts` branch coverage: 63.63% → ≥ 80%
  - Testes na suíte de rotas: 11 → 14
- **Risco de não fazer**: regressão silenciosa quando alguma dependência do `try` (Zod change, novo pre-check) começar a lançar tipo diferente; um `500` pode virar `undefined` sem alarme.
- **Dependências**: nenhuma.

### [testability-2] Afirmar o BUSINESS_INFO emitido pelo `SolicitacaoNumerarioService` (guard de LGPD + auditoria dry-run)

- **Problema**
  > O `SolicitacaoNumerarioService.gerar` emite um `logService.info` com `type:'BUSINESS_INFO'`, `dryRun:true` e um `data` propositalmente sem PII (só `priCod`, `filCod`, `gcdDesNome`, `ator`). O teste mocka `logService.info = jest.fn()` mas nunca afirma sobre a chamada. Se um dev adicionar `dpeNomPessoa` ou `priEspRefcliente` ao `data` (violando o guard de PII do MetricsPort do módulo 6), o gate não detecta. Também é a única prova estruturada de que a chamada foi dry-run — remover o log deixa a auditoria cega.

- **Melhoria Proposta**
  > Adicionar 1 asserção no `SolicitacaoNumerarioService.test.ts`: `expect(logStub.info).toHaveBeenCalledWith(expect.objectContaining({ type:'BUSINESS_INFO', data: expect.objectContaining({ dryRun:true, priCod:…, filCod:…, gcdDesNome:… }) }))` e uma segunda que afirma `expect(logStub.info).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dpeNomPessoa: expect.anything() }) }))` (negativa explícita anti-PII). Tactic Bass: **Executable Assertions**.

- **Resultado Esperado**
  > `logService.info` do service passa a ser um contrato testado (não só uma convenção). Cross-QA com Security: guard automatizado anti-PII em log.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤ 0.25d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Asserções em `logStub.info` no test SN: 0 → 2 (positiva + negativa)
  - Testes na suíte SN service: 6 → 8
- **Risco de não fazer**: PII vaza para log sem detecção; ou o log é removido em refactor e a auditoria "dry-run" desaparece.
- **Dependências**: nenhuma.

### [testability-3] Injetar clock na rota SN + afirmar `docDtaEmissao`/`dtaVencimento` no teste de rota

- **Problema**
  > A rota `POST /solicitacao-numerario` constrói `new Date()` inline (`routes/recebimentos.ts:232`) e o passa como `dataReferencia` para o service. O service unit test já fixa a data e afirma sobre `docDtaEmissao`/`dtaVencimento` (bom); o teste de rota, porém, NÃO afirma essas 2 chaves. Uma regressão que troque `dataReferencia: new Date()` por `new Date(0)` ou `undefined` passaria no gate. Quando `enviarAoErp` for cabeado, isto vira risco financeiro (vencimento errado no ERP).

- **Melhoria Proposta**
  > (a) Extrair um `getNow: () => Date` do service ou do handler (via DI ou parâmetro default) para permitir fake clock (`jest.useFakeTimers().setSystemTime(new Date('2026-07-28…'))`). (b) Adicionar asserções no teste de rota SN: `expect(body.payload.docDtaEmissao).toBe(FIXED_ISO)` e `expect(body.payload.dtaVencimento).toBe(FIXED_ISO)`. Aplicar o mesmo padrão para `routes/recebimentos.ts:38, 87` e o `buildDryRunFallback` do FE (`lib/recebimentos.ts:396`). Tactic Bass: **Limit Non-Determinism**. Cross-QA com Modifiability (clock injetável = uma dependência a menos).

- **Resultado Esperado**
  > Sites `new Date()` não-injetáveis no delta (BE+FE): **5 → ≤ 1** (só o painel stub). Testes de rota afirmando timestamps do payload: **0 → 1**.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - `new Date()` inline no delta: 5 → ≤ 1
  - Asserções sobre `docDtaEmissao`/`dtaVencimento` no teste de rota: 0 → 2
- **Risco de não fazer**: regressão silenciosa do timestamp; risco real quando o wire ao ERP existir (vencimento errado no borderô).
- **Dependências**: nenhuma; alinhar com o padrão de clock que a Frente IV eventualmente adotar.

### [testability-4] Cobrir os 2 estados restantes do `AlocarProcessosDialog` (erro + processando)

- **Problema**
  > O dialog tem 5 estados observáveis (loading, erro, vazio, lista, processando, processado) e o teste cobre 3 (lista/vazio/processado). Falta o ramo de erro (`setErro`, EmptyState "Não foi possível carregar") e o ramo `processandoPri` (spinner + `disabled` do botão). Regressões que quebrem esses estados passam despercebidas; um analista poderia clicar "Processar" duas vezes em rápida sucessão (potencial dupla-emissão quando o seam ERP for cabeado).

- **Melhoria Proposta**
  > Adicionar 2 testes em `AlocarProcessosDialog.test.tsx`: (1) `mockFetch.mockRejectedValue(new Error('boom'))` → afirmar que "Não foi possível carregar" e a mensagem `'boom'` aparecem; (2) usar `mockProcessar.mockImplementation(() => new Promise(r => setTimeout(r, 50)))` para segurar a promessa e afirmar `expect(botao).toBeDisabled()` durante o processamento. Tactic Bass: **Executable Assertions**. Cross-QA com Availability (proteção contra dupla-submissão).

- **Resultado Esperado**
  > Estados testados no dialog: **3/5 → 5/5**. Testes no dialog: **3 → 5**.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤ 0.5d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Estados testados: 3/5 → 5/5
  - Testes no dialog: 3 → 5
- **Risco de não fazer**: regressão silenciosa da UX de erro; dupla-submissão silenciosa quando o wire ao ERP existir.
- **Dependências**: nenhuma.

### [testability-5] Marcar `fonte:'fixture'|'backend'` nos fallbacks de `fetchProcessosParaTransacao` e `processarSolicitacaoNumerario`

- **Problema**
  > `fetchProcessosParaTransacao` e `processarSolicitacaoNumerario` fazem `try { … } catch { return fallback }` sem sinalizar ao chamador que caiu no fixture nem logar a falha. `fetchPainelRecebimentos` já tem `fonte:'fixture'|'banco'` — as outras duas não. Durante uma review de negócio, a UI mostra o payload dry-run "com sucesso" mesmo quando o backend está fora do ar; o QA acredita estar exercitando a integração quando na verdade é fixture puro.

- **Melhoria Proposta**
  > (a) Mudar as duas funções para devolverem `{ fonte:'backend'|'fixture', data:… }` (ou aceitar um callback `onFallback`) e propagar até o dialog, que pode mostrar um badge "modo simulação local"; (b) adicionar `console.warn` no `catch` para o console do browser gravar a falha; (c) adicionar testes que afirmam a marca `fonte:'fixture'` no fallback e `fonte:'backend'` no happy. Tactic Bass: **Executable Assertions** (visibilidade da falha silenciosa). Cross-QA com Deployability (sinal claro de "backend caiu, fallback ativo").

- **Resultado Esperado**
  > Funções com marca `fonte`: **1/3 → 3/3**. `catch {}` totalmente silencioso no delta: **3 → 0**.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: M (2–3d — inclui propagar até o UI)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Funções que expõem `fonte`: 1/3 → 3/3
  - `catch {}` silenciosos: 3 → 0
- **Risco de não fazer**: durante o demo/HML, alguém aprova a feature acreditando ter visto o backend responder quando era fixture; falha real do ERP não é detectada até vir tickets de negócio.
- **Dependências**: alinhar com o padrão de indicação de modo demo que a Frente IV já usa em `fetchPainelRecebimentos` (`fonte:'banco'|'fixture'`).

### [testability-6] Adicionar 1 property-based test para as invariantes do builder de payload SN

- **Problema**
  > `SolicitacaoNumerarioService.gerar` é uma função pura ideal para property testing, mas os 5 testes atuais são gold-masters (exemplos fixos). O repo já tem `fast-check` como dep. Invariantes universais óbvias — `payload.valor === items[0].total === items[0].tmpMnyValor`, `payload.docDtaEmissao === payload.dtaVencimento`, `moeCod = processo.moeCod || DEFAULT` — só são defendidas para os 3 valores exemplo. Cobrir a branch L83 (`moeCod || DEFAULT`) explicitamente é um efeito colateral bem-vindo.

- **Melhoria Proposta**
  > 1 property em `SolicitacaoNumerarioService.test.ts`: `fc.assert(fc.property(fc.float({min:0.01, max:1e9, noNaN:true}), fc.integer({min:0, max:999}), (valor, moeCod) => { const out = service.gerar({ processo: buildProcesso({ moeCod }), valorTransacao: valor, dataReferencia: DATA, ator:'a' }); expect(out.payload.valor).toBe(valor); expect(out.payload.items[0].total).toBe(valor); expect(out.payload.moeCod).toBe(moeCod || SOLICITACAO_NUMERARIO_MOE_COD); }))`. Tactic Bass: **Executable Assertions**.

- **Resultado Esperado**
  > Properties no delta SN: **0 → 1**. Branch coverage do service: **50% → 100%** (elimina L83 uncovered).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤ 0.25d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Properties no service SN: 0 → 1
  - Branch coverage `SolicitacaoNumerarioService.ts`: 50% → 100%
- **Risco de não fazer**: baixo hoje (dry-run); médio quando o seam for cabeado (o builder é a última barreira antes do ERP).
- **Dependências**: nenhuma; `fast-check` já é dep.

## 6. Notas do agente

- **Score 8/10**: o delta SN é um dos exemplos mais limpos de testabilidade do repo — coverage média 95.45% linhas, 90.9% funções nos 4 arquivos-fonte, DI seams bem desenhados (`ProcessoProviderInterface` + `NotImplementedError` seam), fixtures espelhadas BE↔FE, zero rede real nos units. Perde 2 pontos pelos ramos de erro não cobertos (F-1), pelo clock não-injetável na rota (F-3) e pela ausência de asserção de log (F-2 — que também é um cross-QA para Security/LGPD).
- **Cross-QA detectados** para o consolidator: (a) F-2 (asserção de log) ↔ Security (guard anti-PII); (b) F-3 (clock não-injetável) ↔ Modifiability (injeção de dependência do clock); (c) F-4 (estado "processando") ↔ Availability (idempotência da UI, dupla-submissão); (d) F-5 (fallback silencioso) ↔ Deployability (sinal de "modo demo"); (e) `NotImplementedError` como seam explícito ↔ Fault Tolerance (garantia de que não há caminho de escrita alcançável).
- **Métricas que tentei coletar e não pude**: mutation testing (`stryker` não é dep do repo); cobertura em produção (sem CloudWatch — CLAUDE.md deixa claro que a infra AWS é *alvo*, não presente).
- **Baselines-chave**: 21 tests / 3 suites BE do delta; 13 tests / 2 suites FE do delta; total 34 novos testes verdes. `npx jest` scoped: BE 2.97s, FE 1.79s — feedback loop rápido.
