---
qa: Testability
qa_slug: testability
run_id: 2026-07-24-2153
agent: qa-testability
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 7.5
findings_count: 8
cards_count: 6
---

# Testability — Regis-Review

Scope: Frente IV base scaffold só (interfaces + ports + coordinator + stubs + repositories +
migrações). O scaffold é intencionalmente **contracts-first / fully-stubbed** — não se cobra lógica de
negócio ausente. O que se cobra é a **qualidade dos seams**: cada um dos 6 módulos futuros vai ser
construído por outra pessoa contra estes contratos. Se as costuras não forem controláveis,
observáveis e determinísticas hoje, cada equipe paga a fatura de testabilidade seis vezes.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev de Módulo 2/3/4/5/6 escrevendo TDD contra a port do seu módulo | Precisa substituir 1 stub por implementação real e validar hand-off na coordinator sem tocar código de outro módulo | `RecebimentoPipelineService` coordinator + `ports.ts` + `registerRecebimentosPorts()` + stubs + fixtures + `recebimento_execucao` ledger | Desenvolvimento local (`npm test`, sem Postgres real); CI gate com coverage floors (`domain/service/` 88% lines / 60% branches) | Trocar um `container.register(TOKEN, { useClass: RealImpl })` e re-rodar a coordinator test com **1 real + 7 stubs** deve compilar, passar e detectar quebra de contrato pela port | Tempo médio de "stub→real" ≤ 30 min sem alterar código de terceiros; **0** cross-module diffs por swap; branch coverage do coordinator ≥ 80%; **100%** das transições do state-machine testadas |

Cenário-alvo, resumido: "quando o time de Matching (Módulo 2) publicar `MatchingEngineReal`, o teste
do coordenador com 1-real-7-stubs precisa provar que (a) a port foi respeitada, (b) o hand-off
Matching→Rateio não regride e (c) o ledger de idempotência ainda protege a etapa de execução — sem
que a pessoa de Matching precise ler o código de Execução."

## 2. Métricas observadas

Fonte primária: `src/backend/coverage/coverage-final.json` (gerado pela run mencionada no
`_shared-metrics.md`) e leitura direta dos arquivos do escopo.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por camada — recebimentos (STATEMENTS / BRANCHES / FUNCTIONS)** | interface 100%/100%/100% ; service 98.47%/**66.67%**/92.59% ; **repository 54.17%/12.90%/18.52%** ; container 97.06%/50%/100% | interface 100/100/100 ; service ≥88/≥60/≥90 ; repository ≥60/≥40/≥60 | ⚠️ repository muito abaixo | `coverage/coverage-final.json` agregado por diretório |
| Coverage gate `domain/service/` (jest.config.cjs) | lines ≥ 88, branches ≥ 60 | manter | ✅ atendido — service branches 66.67% > 60 | `src/backend/jest.config.cjs:32-35` |
| Arquivos-fonte scaffold sem `.test.ts` dedicado | **6** de 15 (todos os 6 repositórios + `recebimentosContainer.ts` + `recebimentosGate.ts` + `routes/recebimentos.ts`) | ≤ 2 (só container/routes/http podem ficar em teste de integração) | ❌ | `find` cruzado interface∪service∪repository vs `*.test.ts` |
| Ratio `.test.ts / .ts` **do scaffold** | 3 / 24 = **0.125** | ≥ 0.5 no scaffold (contratos-first exige uma test-per-seam) | ❌ | `find src/backend/domain/{interface,repository,service}/recebimentos -name '*.ts'` |
| Testes que resolvem coordinator via container (não `new`) | 1 (o `RecebimentoPipelineService.test.ts` faz `container.resolve`) | 100% dos testes do coordinator | ✅ | `RecebimentoPipelineService.test.ts:54,59,71,76,89,98` |
| Branches do coordinator **não** cobertas | 2 (fallback `rateios[0]?.documentoDocCod ?? ''` e `documentoTitCod ?? ''`) — branch "rateios vazio" nunca exercitada | 0 | ⚠️ | derivado de `coverage-final.json` (`branchMap` do coordinator) |
| Stages do pipeline exercitadas no coordinator test | 5/5 (`importarTransacoes`, `atribuirBaixa`, `ratearRecebimento`, `aplicarRegras`, `executarRecebimento`) | 5/5 | ✅ | `RecebimentoPipelineService.test.ts:58-102` |
| Branch de idempotência (`alreadySettled`) coberta | ✅ 1 teste dedicado (`recebimentoExecucaoRepository → settled`) | ≥ 1 | ✅ | `RecebimentoPipelineService.test.ts:83-95` |
| Branch de erro do coordinator (`markError`, throw pós-`markSettled`) coberta | ❌ 0 — o método `execucaoRepository.markError` **nunca é chamado** pelo coordinator; e não há teste que force um throw dentro de `executarRecebimento` para verificar rollback/observabilidade | ≥ 1 | ❌ | `grep -n markError RecebimentoPipelineService.{ts,test.ts}` |
| Assertion em `metrics.emit` (evento por stage) | ❌ 0 — o teste intitulado "propagates the correlation id through every metrics stage" só verifica `result.correlationId === 'corr-0001'`, o que é o valor devolvido pelo próprio input; **o `MetricsPortStub` nunca é espionado**, `withCorrelationId` é pass-through, e nenhum `expect(metrics.emit).toHaveBeenCalledWith(...)` existe | ≥ 5 asserts (um por stage) | ❌ | `grep -n "metrics.emit\|expect.*metrics" RecebimentoPipelineService.test.ts` |
| Assertion nos PARAMS anti-hardcode (`borVldTipo`, `contaDestino`) chegando à ERP port | ❌ 0 — `ErpReceivablesGatewayStub.criarBordero` não é espionado, então o invariante "borVldTipo é PARAM (nunca 2 hardcoded)" fica **não protegido no coordinator** | ≥ 1 | ❌ | `RecebimentoPipelineService.test.ts:31-32,66` |
| Transições do state-machine Recebimento testadas (R2, R3, R4, R5) | 4/4 legais + 4 ilegais | 4/4 | ✅ | `recebimentoTransitions.test.ts:14-49` |
| Transições do state-machine TransacaoBancaria testadas (TB2–TB5) | 6 legais + 2 ilegais (falta explicitamente `IMPORTADA→ERRO`) | 100% | ⚠️ | `recebimentoTransitions.test.ts:66-126` |
| Schemas Zod testados (7 entidades) | 7/7 (positivo) + 3 malformados | 7/7 + malformado em cada schema (7) | ⚠️ 3/7 malformados | `schemas.test.ts` |
| Fixtures compartilhadas disponíveis para todo o time | 3 (`recebimento`, `transacaoBancaria`, `documentoAReceber`) | ≥ 6 (falta `CreditoCliente`, `NotaDebitoEletronica`, `RegraRecebimento`) | ⚠️ | `ls src/backend/domain/interface/recebimentos/__fixtures__/` |
| CI gate rodando `npm test` | ✅ presente (verificado pelo orchestrator) | presente + coverage floors | ✅ | `_shared-metrics.md` (675/675 verde) |
| `beforeAll`/`afterAll` com estado compartilhado no scaffold | 0 (o coordinator usa `beforeEach`/`afterEach` com `container.reset()`) | 0 | ✅ | `RecebimentoPipelineService.test.ts:43-51` |
| `Math.random` / `Date.now` / `new Date()` em código do scaffold **fora de teste/fixture** | 3 (todas em `RecebimentoExecucaoRepository.ts` via `now()` **do lado SQL** — determinístico do ponto de vista do coordinator; 0 no `RecebimentoPipelineService.ts`) | 0 no coordinator | ✅ | `grep -n "new Date\\|Date.now\\|Math.random" RecebimentoPipelineService.ts` |

> ⚠️ **Não medível localmente (declarado explicitamente):** cobertura da SQL parametrizada dos 6
> repositórios em Postgres real — os repos foram deliberadamente escritos "reais mas magros" e o
> teste do coordenador substitui o `PostgreeDatabaseClient` por um duplo com `selectFirst/update`
> mockados. Isso é a decisão correta para o scaffold (sem docker-compose para o CI ainda), mas
> significa que a corretude do SQL (colunas, `ON CONFLICT DO UPDATE`, invariante "settled preservado")
> só será provada quando o `_migrations/*.integration.test.ts` — ou um `describe('integration: …')` no
> padrão do CLAUDE.md — chegar. Recomendação: card `testability-4`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** (test-only seams no código) | Todo módulo do pipeline tem uma `*Interface` port e um `Symbol()` token. O coordinator injeta **exclusivamente** via `@inject(TOKEN)` (não `new`) — trocar um token registra a implementação real sem tocar em consumidores. | ✅ presente | `ports.ts:129-183, 269-284`; `RecebimentoPipelineService.ts:61-82`; `recebimentosContainer.ts:40-64` |
| **Sandbox** (ambiente controlado para testes sem side-effects) | 8 stubs `@injectable()` determinísticos em `service/recebimentos/stubs/` cobrindo cada port externa (Nexxera, Matching, Rateio, Regras, ERP, NDe, Metrics, Ingestão). Zero rede/DB/timer real; toda saída é fixa e reproduzível. `beforeEach` reseta o container e re-registra os stubs. | ✅ presente | `service/recebimentos/stubs/*.ts` (8 arquivos); `RecebimentoPipelineService.test.ts:43-51` |
| **Recordable Test Cases** (fixtures) | 3 fixtures + factories (`build*`) em `interface/recebimentos/__fixtures__/` compartilhadas entre o coordinator test e o `schemas.test.ts`. **Falta cobertura para as 3 entidades restantes** (`CreditoCliente`, `NotaDebitoEletronica`, `RegraRecebimento`) — cada equipe vai reinventar. | ⚠️ parcial | `interface/recebimentos/__fixtures__/*.fixture.ts` (3 arquivos); `schemas.test.ts:34-71` (define inline em vez de fixture) |
| **Executable Assertions** (invariantes ativos em produção) | Guards puros `assertTransitionRecebimento` / `assertTransitionTransacao` são chamados dentro do coordinator (`executarRecebimento`) e lançam `IllegalTransitionError` (statusCode 409, retryable false, HandlerError contract). `computeValorAlocado`/`computeDiferencaNaoAlocada`/`isRateioBalanceado` são funções puras derivadas testadas. | ✅ presente | `recebimentoTransitions.ts:36-97`; `RecebimentoPipelineService.ts:194,244`; `recebimentoTransitions.test.ts:128-144` |
| **Abstract Data Sources** (DB/ERP/queue atrás de uma abstração) | `PostgreeDatabaseClient` é a única porta ao DB (tests injetam um duplo). `ErpReceivablesGatewayInterface` e `NexxeraGatewayInterface` isolam Conexos/Nexxera. `NdeEmitterInterface` isola o emissor NDe. Coordinator não toca `axios`/pool nunca. | ✅ presente | `RecebimentoExecucaoRepository.ts:23-26` (só via `PostgreeDatabaseClient`); `ports.ts:132-171` |
| **Limit Structural Complexity** (unidade sob teste pequena e coesa) | Maior arquivo do scaffold: `RecebimentoPipelineService.ts` (265 LOC) — dentro do orçamento para um coordinator com 5 stages. Cada stage é um método `private = async` isolado; cada module futuro é uma classe atrás de uma port. `recebimentosContainer.ts` isolado (65 LOC). Maior test: `RecebimentoPipelineService.test.ts` (103 LOC) — enxuto. | ✅ presente | `wc -l` em cada arquivo; `RecebimentoPipelineService.ts:97-264` (métodos independentes) |
| **Limit Non-Determinism** (relógio, aleatoriedade, ordem) | Coordinator é 100% determinístico: `new Date()` só aparece em fixtures (aceitável) e em SQL `now()` no ledger (isolado no DB, não no processo). Nenhum `Math.random` / `crypto.randomUUID` no scaffold. `withCorrelationId` do stub é pass-through — não introduz async-context. Testes usam `beforeEach` com `container.reset()`, sem estado compartilhado. | ✅ presente | `grep "Math.random\|Date.now\|new Date()" src/backend/domain/{service,repository}/recebimentos/*.ts` |

## 4. Findings (achados)

### F-testability-1: Coverage de repositórios do scaffold é 54% lines / 12.9% branches — **6 novos repositórios sem nenhum arquivo `.test.ts`**

- **Severidade**: P1
- **Tactic violada**: Specialized Interfaces (a interface existe, mas sem teste dedicado ela não é uma "seam testada"); Abstract Data Sources
- **Localização**: `src/backend/domain/repository/recebimentos/{TransacaoRepository,RecebimentoRepository,RecebimentoExecucaoRepository,CreditoClienteRepository,RegraRecebimentoRepository,NdeRepository}.ts`
- **Evidência (objetiva)**:
  ```
  find src/backend/domain/repository/recebimentos -name '*.test.ts' → 0 files
  coverage/coverage-final.json (agregado):
    TOTAL repository/recebimentos → S: 54.17% B: 12.90% F: 18.52%
    RecebimentoExecucaoRepository.ts (o ledger de idempotência!) → S:80% B:23.08% F:50%
    TransacaoRepository, NdeRepository, CreditoClienteRepository, RegraRecebimentoRepository → F: 0%
  ```
- **Impacto técnico**: os métodos "reais mas magros" do ledger (`beginExecution` com o `CASE WHEN status='settled' THEN … END`, `markSettled`, `markError`) foram escritos para **preservar idempotência mesmo em retry** — mas essa cláusula SQL não tem nenhum teste que a exercite. O coordinator test injeta um duplo do `PostgreeDatabaseClient` que devolve `{status:'reconciling'}` fixo; o SQL real nunca roda.
- **Impacto de negócio**: se um dev de Módulo 5 refatorar o ledger e quebrar o `CASE WHEN`, retentativa de uma quitação já settled vai regravar `pending`/`reconciling`, o coordinator não vai detectar `alreadySettled` e vai emitir uma segunda NDe — a exata classe de bug que o ledger existe para prevenir (I-Receb-2). Sem teste, quem descobre é a produção.
- **Métrica de baseline**: 0 arquivos `.test.ts` para 6 repositórios; branches cobertas 12.90%; funções cobertas 18.52%.

### F-testability-2: Coordinator test não faz **assertion em `metrics.emit`** — o teste "propagates the correlation id through every metrics stage" é vazio

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (a observabilidade prometida no §3 do spec — "every stage emits events under one correlation id" — não é validada)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.test.ts:69-73`
- **Evidência (objetiva)**:
  ```typescript
  it('propagates the correlation id through every metrics stage', async () => {
      const service = container.resolve(RecebimentoPipelineService);
      const result = await service.run(buildInput());
      expect(result.correlationId).toBe('corr-0001');   // ← só verifica que o CAMPO do input voltou intacto
  });
  ```
  O `MetricsPortStub.withCorrelationId` é pass-through e `MetricsPortStub.emit` só chama `logService.info`; nenhum `jest.spyOn(metrics, 'emit')`, nenhum `toHaveBeenCalledWith({ stage: 'importarTransacoes', correlationId: 'corr-0001', outcome: 'ok' })`. O coordinator hoje emite **11 eventos** de métricas por run (5 stages × 2 (started/ok) + 1 alreadySettled path) e nenhum é verificado.
- **Impacto técnico**: se um teammate remover `this.metrics.emit(...)` de uma stage ("estava dando ruído no log"), todos os testes continuam verdes. A promessa contratual do Módulo 6 — "correlation id em todo evento" — não tem gate automatizado.
- **Impacto de negócio**: quando Frente IV entrar em produção e um recebimento ficar preso em `pending`, o ops-eng vai buscar por `correlation_id` no CloudWatch e descobrir que metade das stages não emitiu evento. MTTR de incidente sobe de "grep de 30 s" para "leitura de código".
- **Métrica de baseline**: 0 assertions em `metrics.emit`; 11 eventos de métrica emitidos por run.

### F-testability-3: **Invariante anti-hardcode não protegida** — `borVldTipo` e `contaDestino` como PARAMS chegam à ERP port sem verificação em teste

- **Severidade**: P1
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.test.ts:31-32,66,102`; `RecebimentoPipelineService.ts:219-236`
- **Evidência (objetiva)**:
  ```typescript
  // buildInput() passa borVldTipo:2 e contaDestino:'55795-4';
  // ErpReceivablesGatewayStub apenas devolve { borCod: 999000, dryRun: params.dryRun }.
  // O teste checa result.resultadoExecucao.borCod === 999000 mas NÃO
  // expect(erpSpy.criarBordero).toHaveBeenCalledWith(expect.objectContaining({ borVldTipo: 2, contaDestino: '55795-4' })).
  ```
  O CLAUDE.md rule + o spec (§3 "borVldTipo is a PARAM (not hardcoded 2)") é anotação em comentário no `ports.ts:81` — não é asserção executável.
- **Impacto técnico**: um refactor do coordinator que troque `input.borVldTipo` por `2` literal passa 675/675 tests. O regressão-defesa que motiva a existência dos PARAMS não existe.
- **Impacto de negócio**: o mesmo bug que a Frente II (SISPAG) já sofreu — `borVldTipo` hardcoded → borderô emitido no ambiente errado / conta errada — pode reaparecer na Frente IV sem sinal.
- **Métrica de baseline**: 0 asserts em `criarBordero(params)` e `gravarBaixa(params)` verificando propagação de PARAMS; 2 PARAMS críticos declarados no `RunPipelineInput`.

### F-testability-4: Coordinator nunca exercita **caminho de erro / `markError`** — ledger de rollback é código morto em teste

- **Severidade**: P1
- **Tactic violada**: Sandbox + Limit Non-Determinism (cenários de falha)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts` (não chama `execucaoRepository.markError`); `RecebimentoPipelineService.test.ts` (nenhum teste com stub que joga)
- **Evidência (objetiva)**:
  ```
  grep -n "markError" src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts
    → 0 hits (o método existe na interface mas o coordinator nunca o invoca)
  Cenários de falha exercitados: happy-path × dryRun (t/f) × alreadySettled = 3
  Cenários de falha ausentes:
    - erp.criarBordero rejeita → ledger fica em 'reconciling' órfão
    - ndeEmitter.emitir rejeita → baixa gravada mas NDe pendente (I-Receb-2)
    - assertTransitionRecebimento lança IllegalTransitionError → 409 propagado
    - matching lança → nenhuma emissão de métrica 'error'
  ```
- **Impacto técnico**: o cenário mais importante do ledger — "ERP falhou, precisamos re-tentar sem duplicar" — não tem teste. Quando um teammate implementar `ErpReceivablesGatewayReal` e ele começar a rejeitar 500s, o comportamento do coordinator é totalmente não-verificado.
- **Impacto de negócio**: quitação em produção que falhou parcialmente (borderô criado + NDe pendente) fica em estado indeterminado, sem `erro_mensagem` no ledger, exigindo intervenção manual. Compliance financeira (rastreabilidade da execução) fica frágil.
- **Métrica de baseline**: 0 testes de caminho de erro; 4 cenários de falha identificáveis não cobertos; `markError` chamado 0 vezes na coverage.

### F-testability-5: Fixtures cobrem 3 de 7 entidades — 3 equipes vão criar fixtures redundantes

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/interface/recebimentos/__fixtures__/`
- **Evidência (objetiva)**:
  ```
  ls src/backend/domain/interface/recebimentos/__fixtures__/
    documentoAReceber.fixture.ts
    recebimento.fixture.ts
    transacaoBancaria.fixture.ts
  Faltam: creditoCliente.fixture.ts (Módulo 4), notaDebitoEletronica.fixture.ts (Módulo 5),
          regraRecebimento.fixture.ts (Módulo 4), rawMovimento.fixture.ts (Módulo 1)
  Efeito: schemas.test.ts:34-71 define objetos inline em vez de reusar factory.
  ```
- **Impacto técnico**: 4 dos 6 teammates vão precisar rolar `build*` na primeira PR. Sem `buildRegraRecebimento({...})`, dois testes de Módulo 4 vão diferir no `vigenteDe` só porque cada dev arbitrou uma data.
- **Impacto de negócio**: divergência de fixtures = tempo perdido em code review pedindo "poderia extrair um factory?" repetidamente.
- **Métrica de baseline**: 3/7 fixtures = **43%** de cobertura; ~4 futuras PRs vão precisar adicioná-las.

### F-testability-6: `schemas.test.ts` valida "malformado é rejeitado" em apenas **3 dos 7 schemas**

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (Zod na fronteira é o gate; sem teste negativo, o gate está mudo)
- **Localização**: `src/backend/domain/interface/recebimentos/schemas.test.ts:74-95`
- **Evidência (objetiva)**:
  ```typescript
  describe('Frente IV Zod schemas — malformed inputs are rejected', () => {
      it('rejects filCod: null …')                          // TransacaoBancaria
      it('rejects a bad status enum …')                     // Recebimento
      it('rejects a non-positive filCod …')                 // DocumentoAReceber
  });
  // Não há teste de malformado para: CreditoCliente, RegraRecebimento,
  // NotaDebitoEletronica, RateioRecebimento.
  ```
- **Impacto técnico**: se alguém afrouxar um `.min(1)` ou trocar `z.enum([...])` por `z.string()` num dos 4 schemas sem cobertura negativa, o teste positivo continua verde e o Zod perde a função de gate.
- **Impacto de negócio**: fronteira mal validada → dados sujos entram no `Recebimento` → invariantes de rateio (I-Receb-1) ficam com base em input inconsistente.
- **Métrica de baseline**: 3/7 schemas com teste negativo = **43%**.

### F-testability-7: Transição `IMPORTADA → ERRO` do state-machine `TransacaoBancaria` não testada explicitamente

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/interface/recebimentos/recebimentoTransitions.test.ts:66-126`
- **Evidência (objetiva)**:
  ```
  TRANSACAO_ALLOWED[IMPORTADA] inclui: CONCILIADA, PARCIAL, MANUAL, ERRO
  Testes cobrem explicitamente: IMPORTADA→{CONCILIADA, PARCIAL, MANUAL} (linhas 67-86)
  Faltando: IMPORTADA→ERRO (embora {PARCIAL,MANUAL}→ERRO seja testado nas linhas 88-101).
  ```
- **Impacto técnico**: cobertura 100% de branch atual esconde uma transição implicitamente coberta pela estrutura de dados mas não asserida.
- **Impacto de negócio**: baixo — cobertura da branch é 100% pelo array; risco é só de regressão silenciosa se alguém remover `ERRO` do allowlist de `IMPORTADA`.
- **Métrica de baseline**: 6/7 transições legais explícitas + 2/vários ilegais.

### F-testability-8: `recebimentosGate` / `routes/recebimentos` sem teste — feature-flag 403 não protegida

- **Severidade**: P2
- **Tactic violada**: Sandbox (o gate é um seam de segurança/deploy — precisa ser testado como tal)
- **Localização**: `src/backend/http/recebimentosGate.ts:14-22`; `src/backend/routes/recebimentos.ts`
- **Evidência (objetiva)**:
  ```
  find src/backend/http src/backend/routes -name '*recebimentos*test*' → 0 files
  A Frente II tem sispagGate mas também não tem teste (padrão herdado);
  a promessa do _shared-metrics.md ("recebimentosGate mirrors sispagGate: 403 when disabled")
  não é validada por nenhum teste no scaffold.
  ```
- **Impacto técnico**: se alguém trocar `!env.recebimentosEnabled` por `env.recebimentosEnabled` (regressão de gate em produção), tests continuam verdes e o endpoint fica aberto.
- **Impacto de negócio**: Frente IV é feature-flag off em produção **por design** (spec §7 do inbox). Perder o gate = expor pipeline stub ou meio-real em produção antes da hora.
- **Métrica de baseline**: 0 testes de gate; 1 arquivo de gate no scaffold.

## 5. Cards Kanban

### [testability-1] Cobrir os 6 repositórios de `recebimentos/` com testes unitários + 1 teste de integração para o ledger

- **Problema**
  > Os 6 novos repositórios do scaffold têm 0 arquivos `.test.ts` (cobertura 54% lines / 12.9% branches / 18.5% functions). O mais crítico — `RecebimentoExecucaoRepository`, ledger da idempotência I-Receb-2 — tem funções (`markSettled`, `markError`) sem qualquer chamada em teste, e o SQL do `beginExecution` (`CASE WHEN status='settled' THEN … END`) que garante que retry nunca regride, nunca roda contra Postgres.

- **Melhoria Proposta**
  > Adicionar `TransacaoRepository.test.ts`, `RecebimentoRepository.test.ts`, `RecebimentoExecucaoRepository.test.ts`, `CreditoClienteRepository.test.ts`, `RegraRecebimentoRepository.test.ts`, `NdeRepository.test.ts` com o padrão CLAUDE.md ("mock direto do `PostgreeDatabaseClient` via `new SomeRepository(mockDb as any)`") cobrindo `save`/`findById` e `mapRow`. Adicionalmente, criar `RecebimentoExecucaoRepository.integration.test.ts` (marcado com `describe('integration: …')`, excluído do run padrão via `testPathIgnorePatterns` do `jest.config.cjs`) que suba um Postgres via `docker-compose.test.yml` (já solicitado por Modifiability em runs anteriores) e teste as 3 branches do `CASE WHEN`: `pending→settled`, `reconciling→settled`, `settled→settled` (não regride). Tactic Bass: Abstract Data Sources + Specialized Interfaces.

- **Resultado Esperado**
  > Cobertura de `repository/recebimentos/` sobe de 54.17% lines / 12.90% branches / 18.52% functions para ≥ 80% / ≥ 60% / ≥ 80%. Ledger idempotency SQL passa a ter proteção antes de Módulo 5 sequer começar a escrever `ErpReceivablesGatewayReal`.

- **Tactic alvo**: Abstract Data Sources; Specialized Interfaces
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — 6 arquivos unit + 1 integração)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Arquivos `.test.ts` em `repository/recebimentos/`: 0 → 6 unit + 1 integração
  - Cobertura `repository/recebimentos/` (lines): 54.17% → ≥ 80%
  - Cobertura `repository/recebimentos/` (branches): 12.90% → ≥ 60%
  - Cobertura `RecebimentoExecucaoRepository.ts` (functions): 50% → 100%
- **Risco de não fazer**: primeira retentativa de execução em produção duplica NDe/baixa; a bug-class exata que o ledger existe para prevenir chega ao livro-caixa.
- **Dependências**: cross-QA com `fault-tolerance` (ledger é write-ahead) e `modifiability` (docker-compose.test.yml para o integration).

### [testability-2] Espionar `metrics.emit` e `erp.criarBordero/gravarBaixa` no coordinator test — proteger as invariantes de observabilidade + PARAMS

- **Problema**
  > O `RecebimentoPipelineService.test.ts` resolve o coordinator do container (bom!) mas usa os stubs como caixas-pretas: (1) o teste "propagates the correlation id through every metrics stage" **não olha para o `metrics`** — só verifica que o input voltou intacto; (2) `criarBordero`/`gravarBaixa` não são espionados, então "borVldTipo é PARAM (nunca hardcoded 2)" e "contaDestino é PARAM" — invariantes anti-regressão do Módulo 5 — não têm gate. Um refactor que troque `input.borVldTipo` por `2` literal passa 675/675 tests hoje.

- **Melhoria Proposta**
  > Estender o coordinator test para: (a) espionar `MetricsPortStub.emit` via `jest.spyOn` e assertar que cada stage emite `{stage: 'importarTransacoes'|…, outcome: 'started'|'ok', correlationId: 'corr-0001'}` — 10 asserts (5 stages × 2 outcomes); (b) espionar `ErpReceivablesGatewayStub.criarBordero` e `.gravarBaixa` com `expect(spy).toHaveBeenCalledWith(expect.objectContaining({ borVldTipo: 2, contaDestino: '55795-4' }))`; (c) trocar `withCorrelationId` do stub por uma implementação que capture o `correlationId` num closure e verificar que `emit` foi chamado *dentro* do escopo. Tactic Bass: Executable Assertions.

- **Resultado Esperado**
  > `metrics.emit` passa a ter ≥ 10 assertions (0 hoje). `criarBordero`/`gravarBaixa` recebem 2 assertions de PARAMS (0 hoje). Impossível refatorar o coordinator para dropar métrica ou hardcodar `borVldTipo` sem que o CI reprove.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — mesmo arquivo de teste)
- **Findings relacionados**: F-testability-2, F-testability-3
- **Métricas de sucesso**:
  - Assertions em `metrics.emit`: 0 → ≥ 10 (uma por stage×outcome)
  - Assertions de PARAM (`borVldTipo`, `contaDestino`) no ERP port: 0 → ≥ 2
  - Cobertura de branches do coordinator: 66.67% → ≥ 85% (as 2 branches `?? ''` viram cobertas por um teste de "rateios vazio")
- **Risco de não fazer**: regressão de `borVldTipo` hardcoded (a bug-class já vivida em Frente II) reaparece na Frente IV sem sinal.
- **Dependências**: cross-QA com `integrability` (contrato do ERP port) e `security` (métricas sem PII).

### [testability-3] Adicionar cenários de FALHA ao coordinator test — `markError`, throw pós-`markSettled`, IllegalTransition

- **Problema**
  > O coordinator test tem 5 casos, todos happy-path (dryRun t/f, alreadySettled). Zero teste de: `erp.criarBordero` rejeita, `ndeEmitter.emitir` rejeita depois da baixa, `assertTransitionRecebimento` lança quando o input chega em status errado. Consequência: `execucaoRepository.markError` — cujo objetivo é registrar por que a execução parou no meio — nunca é chamado em nenhum caminho de teste (função pertence à interface, mas o coordinator não a invoca; nem há teste que force um throw dentro de `executarRecebimento`). O caminho mais importante do ledger é código morto em teste.

- **Melhoria Proposta**
  > (a) Adicionar 3 casos ao coordinator test: (1) `container.registerInstance(ERP_RECEIVABLES_GATEWAY_TOKEN, { criarBordero: jest.fn().mockRejectedValue(new Error('ERP 500')), gravarBaixa: jest.fn() })` → verificar que o coordinator propaga o erro e que **`execucaoRepository.markError` foi chamado com `erroMensagem` derivada**; (2) `ndeEmitter` rejeita depois de `gravarBaixa` ter succedido → verificar que `markError` recebe `borCod` correspondente; (3) coordinator chamado com `recebimento.status === EXECUTADO` → verificar que `IllegalTransitionError` (code `RECEBIMENTO_TRANSICAO_INVALIDA`, statusCode 409) é lançado antes de qualquer chamada ao ERP. (b) Implementar `markError` no coordinator no bloco `catch` de `executarRecebimento`. Tactic Bass: Sandbox (cenários controlados de falha).

- **Resultado Esperado**
  > Chamadas de teste a `execucaoRepository.markError`: 0 → ≥ 2. Cenários de falha exercitados no coordinator: 0 → ≥ 3. IllegalTransitionError guard cobrada tanto na unit test do guard quanto no coordinator (rejeição precoce).

- **Tactic alvo**: Sandbox; Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d test + pequena edição em `executarRecebimento`)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Testes de caminho de erro no coordinator: 0 → ≥ 3
  - Chamadas a `markError` cobertas: 0 → ≥ 2
  - Coordinator branches cobertas (incluindo try/catch): 66.67% → ≥ 90%
- **Risco de não fazer**: execução parcial em produção deixa ledger em `reconciling` para sempre, exige limpeza manual, quebra a promessa de reversibilidade (I-Receb-2).
- **Dependências**: cross-QA com `fault-tolerance` (esse é literalmente o teste de reversibilidade que aquela seção pede).

### [testability-4] Completar o kit de fixtures — 3 → 6 factories `buildX`

- **Problema**
  > O scaffold entrega fixtures de `Recebimento`, `TransacaoBancaria`, `DocumentoAReceber`, mas os teammates de Módulo 4 (CréditoCliente + RegraRecebimento) e Módulo 5 (NotaDebitoEletronica) precisam de fixtures compartilhadas para escrever TDD contra os seus schemas Zod. O próprio `schemas.test.ts` já define objetos inline (linhas 34-71) para as 3 entidades faltantes — sinal de que a lacuna já dói.

- **Melhoria Proposta**
  > Criar em `interface/recebimentos/__fixtures__/`: `creditoCliente.fixture.ts` com `creditoClienteFixture` + `buildCreditoCliente(overrides)`; `regraRecebimento.fixture.ts` (com `REGRA_TIPO.ENCOMENDA` e `parametros: { percentual: 0.001 }`); `notaDebitoEletronica.fixture.ts` (com `statusEmissao: PENDENTE`, `idempotencyKey: nde:{id}`); e opcionalmente `rawMovimento.fixture.ts` para Módulo 1. Refatorar `schemas.test.ts` para consumir esses factories. Tactic Bass: Recordable Test Cases.

- **Resultado Esperado**
  > Cobertura de fixtures: 3/7 = 43% → 6/7 = 86%. Zero definições inline de objeto-teste em `schemas.test.ts`. Cada uma das 6 equipes tem factory pronta antes de começar.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Fixtures disponíveis: 3 → 6
  - Objetos inline em `schemas.test.ts`: 3 → 0
- **Risco de não fazer**: cada equipe reinventa a factory na sua primeira PR, dispersando `vigenteDe`/`idempotencyKey` arbitrários pelo repo.
- **Dependências**: nenhuma.

### [testability-5] Adicionar testes negativos de Zod para os 4 schemas restantes

- **Problema**
  > `schemas.test.ts` valida "malformed inputs are rejected" para 3 dos 7 schemas (43%). Sem teste negativo, o Zod deixa de ser um gate: se alguém trocar `z.enum([...])` por `z.string()` num dos 4 schemas restantes, o teste positivo continua verde e a fronteira fica silenciosamente aberta.

- **Melhoria Proposta**
  > Adicionar em `schemas.test.ts` casos `safeParse` com input malformado para: `CreditoCliente` (status inválido, valorDisponivel > valorOriginal), `RegraRecebimento` (`versao: 0`, `tipo` inválido), `NotaDebitoEletronica` (`statusEmissao` inválido, `valor: 0`), `RateioRecebimento` (`valorAlocado: -1`, `componente` inválido). Tactic Bass: Executable Assertions.

- **Resultado Esperado**
  > Schemas com teste negativo: 3/7 → 7/7. Refactor de Zod que afrouxe validação passa a quebrar o CI.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Casos negativos: 3 → ≥ 8 (2 por schema)
  - Cobertura de branches em `interface/recebimentos/*.ts`: mantém 100% mas com defesa negativa real
- **Risco de não fazer**: fronteira mal validada acumula débito à medida que os 6 módulos escrevem dados.
- **Dependências**: pode compartilhar factories com testability-4.

### [testability-6] Teste do `recebimentosGate` — feature-flag 403 tem que ter gate no CI

- **Problema**
  > `recebimentosGate.ts` decide se toda a Frente IV atende `403` (produção, `recebimentosEnabled=false`) ou passa para o próximo handler (dev/staging). Não há nenhum teste que verifique o comportamento — se alguém inverter a lógica (`if (env.recebimentosEnabled)` em vez de `if (!env.recebimentosEnabled)`), o endpoint stub abre em produção e ninguém percebe.

- **Melhoria Proposta**
  > Criar `src/backend/http/recebimentosGate.test.ts` que: (1) mocke `EnvironmentProvider.getEnvironmentVars` para devolver `recebimentosEnabled:false` e assere `res.status(403)` + `res.json({error:'Recebimentos indisponível.'})`; (2) mesmo com `recebimentosEnabled:true` assere `next()` foi chamado; (3) verifique que `bootstrapAppContainer()` é awaited. Espelhar padrão de `sispagGate` (mesmo que também esteja sem teste — abrir card gêmeo em Frente II é o passo defensivo). Tactic Bass: Sandbox.

- **Resultado Esperado**
  > Testes de gate: 0 → 3. Inverter a lógica do gate passa a quebrar CI antes do deploy.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-8
- **Métricas de sucesso**:
  - Arquivos de teste para gates: 0 → 1
  - Cenários de gate cobertos: 0 → 3 (disabled/enabled/bootstrap-awaited)
- **Risco de não fazer**: deploy silencioso da Frente IV em produção antes da hora, com stubs devolvendo dados fake para a UI.
- **Dependências**: cross-QA com `deployability` (gate = kill-switch para deploy incremental) e `security` (403 é defesa em camadas).

## 6. Notas do agente

- Coverage foi lida do `coverage/coverage-final.json` já materializado (modo `--quick`; não re-rodei `--coverage`). Agregados por diretório calculados via script Python ad-hoc.
- F-testability-7 (transição `IMPORTADA→ERRO` implícita) NÃO virou card — cobertura de branch pelo array é 100% e o custo/benefício de adicionar 1 assert é marginal; deixei como finding para o consolidator eventualmente agrupar.
- Cross-QA detectados (alertar consolidator): (1) testability-1 depende de `docker-compose.test.yml` que Modifiability já pediu para SISPAG; (2) testability-2 dobra como defesa de Security (métricas sem PII); (3) testability-3 é praticamente o teste de reversibilidade que Fault-Tolerance pede para o ledger; (4) testability-6 é kill-switch = tema de Deployability.
- O scaffold é genuinamente bom em Specialized Interfaces / Sandbox / Abstract Data Sources / Limit Non-Determinism — o débito está concentrado em **Executable Assertions no coordinator** (asserts fracos) e em **falta de test file para 6 repositórios**. Score 7.5 reflete "boa arquitetura, testes rasos".
