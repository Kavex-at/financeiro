---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-modifiability
generated_at: 2026-07-29T02:43:00Z
scope: all
score: 8.2
findings_count: 6
cards_count: 6
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Product/HAR de HML confirmando `gcdCod` real do com299 + regra de percentual de encomenda (0,1% / 0,9%) resolvida | Trocar `gcdCod=0` (placeholder), destravar o seam `enviarAoErp`, aplicar a fórmula de percentual sobre o `valorTransacao` e trocar o `ProcessoProviderStub` pelo provider real (Conexos / matching-engine) | SN feature slice: `SolicitacaoNumerarioService`, `constants.ts` (SOLICITACAO_NUMERARIO_DOC_CONFIG), `NotImplementedError`/seam, `recebimentosContainer.ts` (bind do `PROCESSO_PROVIDER_TOKEN`), rota `routes/recebimentos.ts`, `AlocarProcessosDialog.tsx`, `lib/recebimentos.ts` | Frente IV em Fase 1 (dry-run), sem HML acessível, sob feature flag `recebimentosEnabled` (`recebimentosGate`), TDD verde (740/740 backend, 104/104 frontend) | Ligar SN "real" toca 3 pontos localizados: (a) trocar `SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod` em `constants.ts:132`, (b) trocar `useClass: ProcessoProviderStub` por implementação real em `recebimentosContainer.ts:55`, (c) implementar `enviarAoErp` no seam existente. Zero mudança em rota, DTO, frontend ou testes de contrato | ≤ 3 arquivos alterados para ativar SN real; 0 alteração em `GerDocProcesso.ts` / `ports.ts` / `AlocarProcessosDialog.tsx`; 0 novo teste de contrato quebrado (só testes de comportamento do seam real) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `SolicitacaoNumerarioService.ts` | 122 | ≤ 200 (service DDD) | ✅ | `wc -l src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts` |
| LOC `ProcessoProviderStub.ts` | 31 | ≤ 100 (stub) | ✅ | `wc -l` |
| LOC `GerDocProcesso.ts` (interface + Zod) | 135 | ≤ 200 (interface + schemas) | ✅ | `wc -l` |
| LOC `NotImplementedError.ts` | 26 | ≤ 50 (error class) | ✅ | `wc -l` |
| LOC `routes/recebimentos.ts` (com SN) | 239 | ≤ 300 (route file) | ✅ | `wc -l` |
| LOC `AlocarProcessosDialog.tsx` | 240 | ≤ 300 (dialog component) | ✅ | `wc -l` |
| LOC `lib/recebimentos.ts` (com SN + fixture) | 524 | ≤ 400 (lib file) | ⚠️ | `wc -l` |
| Biome cognitive-complexity warnings — SN files | **0** | 0 | ✅ | `npm run lint` (backend) — 28 pré-existentes em permutas/sispag/conexos, nenhum em SN |
| Biome/ESLint warnings — SN frontend | 1 (`react-hooks/set-state-in-effect` em `AlocarProcessosDialog.tsx:90`) | 0 | ⚠️ | `cd src/frontend && npm run lint` |
| Fan-out (imports) — `SolicitacaoNumerarioService.ts` | 6 | ≤ 10 | ✅ | `grep -c '^import '` |
| Fan-out — `routes/recebimentos.ts` | 17 | ≤ 15 | ⚠️ | `grep -c '^import '` |
| Fan-out — `AlocarProcessosDialog.tsx` | 13 | ≤ 15 (UI + hooks + DS + lib) | ✅ | `grep -c '^import '` |
| Fan-in do `PROCESSO_PROVIDER_TOKEN` (defer-binding) | 3 sites (declaração + bind + resolve) | 3 (o mínimo topológico) | ✅ | `grep -rn PROCESSO_PROVIDER_TOKEN src/backend` |
| Fan-in do `SolicitacaoNumerarioService` | 2 (rota + teste) | ≤ 3 | ✅ | `grep -rn SolicitacaoNumerarioService src/backend` |
| Cross-layer violations no delta (rota→client, service→lambda) | 0 | 0 | ✅ | inspeção de imports em `SolicitacaoNumerarioService.ts`, `routes/recebimentos.ts`, `ProcessoProviderStub.ts` |
| Cycles no subgraph SN (ports ↔ service ↔ container ↔ route) | 0 | 0 | ✅ | inspeção manual (grafo é linear: `ports` ← `service`/`stub`/`route`; `container` ← todos) |
| Magic numbers em regra de negócio SN | 1 crítico (`SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod = 0` em `constants.ts:132`, replicado em `lib/recebimentos.ts:397`) + `valorSn = valorTransacao` sem % (raw) | 0 (todo binding via constant/env/config) | ⚠️ | `grep -rn "gcdCod.*0\|PLACEHOLDER" src/backend src/frontend` |
| `TODO(encomenda-percentuais)` outstanding | 2 marcadores localizados no MESMO service (`SolicitacaoNumerarioService.ts:21,60`) — nada em rota/frontend/DTO | Isolamento localizado (P-Encapsulate) | ✅ | `grep -rn "TODO(encomenda-percentuais)"` |
| Duplicação lógica FE↔BE (payload builder) | `buildDryRunFallback` (`lib/recebimentos.ts:392-428`) reimplementa o payload do `SolicitacaoNumerarioService.gerar` (fallback de rede) — 2 sítios de mudança para qualquer nova regra de payload | 1 sítio (backend canônico) | ⚠️ | Diff visual entre `SolicitacaoNumerarioService.ts:58-110` e `lib/recebimentos.ts:392-428` |
| DDD layering do delta (Service `@injectable`, Repository ausente, Client ausente — apenas port) | Correto para escopo dry-run: service coordena; port `ProcessoProviderInterface` abstrai o "provider" (stub hoje, Conexos amanhã); nenhum `PostgreeDatabaseClient`/HTTP client acoplado | Conforme CLAUDE.md | ✅ | inspeção de `SolicitacaoNumerarioService.ts`, `ProcessoProviderStub.ts`, `recebimentosContainer.ts` |
| Métodos como arrow-fn com modificador explícito | 100% (2/2 em SN service, 1/1 no stub, 2/2 no fallback FE) | 100% | ✅ | `grep -n "public \|private " src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts` |
| Export classes only (não plain functions) | ✅ backend (`export default class`) | ✅ | ✅ | inspeção dos 3 arquivos backend do delta |

> ⚠️ **Não medível localmente**: número médio de arquivos alterados por feature de expansão do payload SN (base histórica). Só ficará medível após 2-3 iterações reais tocando o payload. Recomendação: rotular commits com `feat(recebimentos-sn):` e medir `git log --stat` daqui a 60d.

## 3. Tactics — Cobertura no nf-projects (delta SN)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Delta já nasce fatiado: service (122) + stub (31) + interface+Zod (135) + error (26) + rota (239) + dialog FE (240) + lib FE (524). Nenhum arquivo perto do teto (600) | ✅ presente | `wc -l` acima |
| **Increase Semantic Coherence** | `SolicitacaoNumerarioService` tem UMA responsabilidade coesa (montar payload SN encomenda) — 2 métodos públicos (`gerar` puro + `enviarAoErp` seam-only). Não mistura matching, ingest, rateio ou NDe | ✅ presente | `SolicitacaoNumerarioService.ts:58,117` |
| **Encapsulate** | (a) Constants isolados em `constants.ts` (`SOLICITACAO_NUMERARIO_*`); (b) `NotImplementedError` encapsula o não-implementado com `retryable: false`, `statusCode: 501`, `userMessage`; (c) o TODO `encomenda-percentuais` está confinado ao `valorSn` local de `gerar()` — resolver a regra é editar 1 linha (`SolicitacaoNumerarioService.ts:62`) | ✅ presente | `constants.ts:130-141`, `NotImplementedError.ts:11-26`, `SolicitacaoNumerarioService.ts:60-62` |
| **Use an Intermediary** | (a) `ProcessoProviderInterface` intermedia rota↔fonte de processos — swap Conexos/matching = trocar 1 `useClass` no container; (b) `enviarAoErp` intermedia o service↔ERP real (seam separado do puro) | ✅ presente | `ports.ts:228-236`, `recebimentosContainer.ts:55`, `SolicitacaoNumerarioService.ts:117-121` |
| **Restrict Dependencies** | Rota importa `ProcessoProviderInterface` **do arquivo de ports** (não da impl); stub importa fixtures + interface, não o service; interface importa só Zod. Grafo do delta é DAG | ✅ presente | Imports em `routes/recebimentos.ts:13-17`, `ProcessoProviderStub.ts:2-7`, `GerDocProcesso.ts:1` |
| **Refactor** | Delta é greenfield SN — nada legado no slice. Frontend `lib/recebimentos.ts` (524 LOC) mistura fixtures + tipos + fetchers (herança pré-SN, não novo débito), mas está no limite alto de LOC | ⚠️ parcial | `wc -l src/frontend/lib/recebimentos.ts` = 524 |
| **Abstract Common Services** | `LogService` reutilizado (`@singleton`, injeção via ctor); `NotImplementedError` implementa `HandlerError` (padrão comum de erros HTTP). Nada duplicado com Frente II | ✅ presente | `SolicitacaoNumerarioService.ts:46-48,97-107`, `NotImplementedError.ts:1,11` |
| **Defer Binding — configuration files / env** | Feature toggle `recebimentosEnabled` gate a **família inteira** de rotas SN via `recebimentosGate` (env-driven, sem redeploy de código) | ✅ presente | `src/backend/http/recebimentosGate.ts`, `routes/recebimentos.ts:28-29` |
| **Defer Binding — polymorphism (DI)** | `PROCESSO_PROVIDER_TOKEN` (Symbol) + `ProcessoProviderInterface` + `container.register(...useClass)` — trocar stub por real = **1 linha** em `recebimentosContainer.ts:55` sem tocar rota nem service | ✅ presente | `ports.ts:351`, `recebimentosContainer.ts:11,31,55`, `routes/recebimentos.ts:171` |
| **Defer Binding — runtime seam** | `enviarAoErp` é seam separado do `gerar` puro. Enquanto lança `NotImplementedError`, o service ainda é útil (dry-run). Cabear = implementar 1 método, sem refactor da assinatura | ✅ presente | `SolicitacaoNumerarioService.ts:117-121`, `NotImplementedError.ts` |
| **Defer Binding — plugin patterns / runtime registration** | Container idempotente (`container.isRegistered(...) return`) permite re-registro em tests (`container.reset()`) — swap por-teste sem tocar produção | ✅ presente | `recebimentosContainer.ts:42-43` |

## 4. Findings (achados)

### F-modifiability-1: `gcdCod=0` é placeholder mas está duplicado em backend e frontend

- **Severidade**: P1
- **Tactic violada**: Defer Binding — configuration files (o placeholder deveria vir de env/SSM, não hardcode replicado)
- **Localização**: `src/backend/domain/interface/recebimentos/constants.ts:132` e `src/frontend/lib/recebimentos.ts:397`
- **Evidência (objetiva)**:
  ```
  # backend
  constants.ts:131:    /** PLACEHOLDER — confirmar o `gcdCod` real via HML/HAR antes de qualquer envio ao ERP. */
  constants.ts:132:    gcdCod: 0,

  # frontend fallback
  lib/recebimentos.ts:397:  const docConfig: DocConfig = { gcdCod: 0, gcdDesNome: SOLICITACAO_NUMERARIO_GCD_DES_NOME }
  ```
- **Impacto técnico**: quando o HAR de HML confirmar o `gcdCod` real, será preciso editar 2 arquivos em repos separados. Se um dos dois for esquecido, o preview do FE (fallback) diverge do payload real do BE — o operador vê um payload que não é o que será enviado.
- **Impacto de negócio**: risco baixo hoje (dry-run), risco alto quando `enviarAoErp` for cabeado — payload divergente = SN emitida no ERP com config errada = retrabalho contábil.
- **Métrica de baseline**: 2 sítios de mudança para 1 constante de binding. Alvo: 1 sítio (backend), ou 0 (env-driven).

### F-modifiability-2: `buildDryRunFallback` no frontend re-implementa o payload builder do backend

- **Severidade**: P1
- **Tactic violada**: Abstract Common Services (payload builder deveria existir só no BE) / Restrict Dependencies
- **Localização**: `src/frontend/lib/recebimentos.ts:392-428` vs `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:58-110`
- **Evidência (objetiva)**:
  ```
  # FE monta EXATAMENTE o mesmo shape do BE:
  lib/recebimentos.ts:400-427 → { dryRun:true, docConfig, payload: { filCod, docTip:'SN', docVldTipo:'SN', ..., items:[{prjCod:0, ctpCod:0, tmpMnyValor, ctpDesNome, tpcCod:0, cfoEspCod:0, total}]}}
  SolicitacaoNumerarioService.ts:70-95 → mesmo shape
  ```
- **Impacto técnico**: qualquer mudança de shape (novo campo `gcd`, novo item de rateio, mudança de `docTip`) exige edição sincronizada em 2 repos. Fan-out de mudança = 2 quando deveria ser 1.
- **Impacto de negócio**: duplicação é rede de segurança do demo (comentário na linha 458 explica); aceitável em Fase 1, mas vira débito real na Fase 2 quando o payload evoluir com o HAR.
- **Métrica de baseline**: 1 função de fallback (37 linhas) espelhando 40 linhas do service. Alvo: fallback removido ou reduzido a "mostrar erro amigável" quando BE falhar, sem reconstruir payload.

### F-modifiability-3: `valorSn = valorTransacao` sem fórmula da encomenda — regra crítica não-resolvida encapsulada, mas com risco de espalhamento

- **Severidade**: P1
- **Tactic violada**: Encapsulate (bem hoje) + risco futuro de Increase Semantic Coherence (se a fórmula depender de estado do processo, escopo do service muda)
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:60-62`
- **Evidência (objetiva)**:
  ```
  // TODO(encomenda-percentuais): regra não-resolvida — usa o valor cru da transação como o
  // montante da SN. Ver ontology/_inbox/frente-iv-recebimentos-nde-plan.md §7 Q4.
  const valorSn = valorTransacao;
  ```
- **Impacto técnico**: hoje o TODO está isolado em 1 linha. Quando a regra chegar (0,1% / 0,9% sobre base X arredondado modo Y), pode virar um `EncomendaPercentualCalculator` (novo service/pure function) OU pode acabar como cascata de `if` dentro do próprio `gerar()`. Sem a decisão, o service pode crescer para além do ceiling.
- **Impacto de negócio**: SN sendo emitida com valor cru = ERP recebe montante errado. Enquanto for dry-run é discovery; no primeiro dia real de HML, valor errado = solicitação de numerário incorreta.
- **Métrica de baseline**: 1 marcador `TODO(encomenda-percentuais)` no service, 1 no JSDoc do input (mesmo arquivo). Alvo: 0 TODOs, regra em pure function testável isoladamente.

### F-modifiability-4: `lib/recebimentos.ts` acima do ceiling do repo (524 LOC) — mistura fixtures + tipos + fetchers

- **Severidade**: P2
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/frontend/lib/recebimentos.ts` (524 LOC)
- **Evidência (objetiva)**:
  ```
  Bloco 1 (linhas 20-107):  type mirrors dos DTOs backend + computeKpis
  Bloco 2 (linhas 129-283): fixtures (transacoes / recebimentos / ndes)
  Bloco 3 (linhas 310-390): tipos SN + fixture processos
  Bloco 4 (linhas 391-524): fetchers + fallback builders
  ```
- **Impacto técnico**: mudar um fixture força re-parse do arquivo inteiro pela IDE/rebundler; encontrar o fetcher SN entre 524 linhas custa tempo. Fan-in é alto (importado por AlocarProcessosDialog + página + testes).
- **Impacto de negócio**: baixo hoje; é DX / velocidade de review, não risco de execução.
- **Métrica de baseline**: 524 LOC em 1 arquivo, 4 responsabilidades. Alvo: 4 arquivos (`recebimentos.types.ts`, `recebimentos.fixtures.ts`, `recebimentos.api.ts`, `solicitacao-numerario.api.ts`), cada < 200 LOC.

### F-modifiability-5: `AlocarProcessosDialog.tsx:90` — `setState` síncrono em effect (lint warning FE)

- **Severidade**: P2
- **Tactic violada**: Refactor (código com warning conhecido é débito imediato)
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:87-106`
- **Evidência (objetiva)**:
  ```
  AlocarProcessosDialog.tsx:90:5  react-hooks/set-state-in-effect
    88 |     if (!open || !transacao) return
    89 |     let cancelado = false
  > 90 |     setLoading(true)
       |     ^^^^^^^^^^ Avoid calling setState() directly within an effect
    91 |     setErro(null)
    92 |     setResultados({})
  ```
- **Impacto técnico**: cascading renders em React 19; o efeito dispara render extra a cada mudança de `open`/`transacao`. Modifiability: quem for tocar esse effect precisa entender o hack antes de mexer, retardando qualquer evolução do "Alocar" (paginação, filtros, cache).
- **Impacto de negócio**: baixo (não quebra), mas é um trigger de refactor obrigatório antes de qualquer feature que expanda o dialog (busca, ordenação, seleção múltipla).
- **Métrica de baseline**: 1 warning ativo em SN files. Alvo: 0.

### F-modifiability-6: `routes/recebimentos.ts` fan-out = 17 imports (acima do teto de 15)

- **Severidade**: P3
- **Tactic violada**: Reduce Coupling (imports diretos ao container/tokens vs. um "recebimentos wiring" helper)
- **Localização**: `src/backend/routes/recebimentos.ts:1-23`
- **Evidência (objetiva)**:
  ```
  17 imports: reflect-metadata, express Router, tsyringe container, zod, bootstrapAppContainer,
              constants (MATCH_CLASSIFICACAO/RECEBIMENTO_STATUS/TRANSACAO_TIPO), types (Recebimento, TransacaoBancaria),
              ports (ListCandidatosInput, ProcessoProviderInterface, PROCESSO_PROVIDER_TOKEN),
              services (RecebimentoPipelineService, SolicitacaoNumerarioService),
              http helpers (asyncHandler, requireRole, FilialForbiddenError, assertUserCanActOnFilial, heavyRouteLimiter)
  ```
- **Impacto técnico**: cada nova rota (`aprovar`, `estornar`, etc.) tende a adicionar mais 2-3 imports. Em 3-4 iterações o arquivo fica com 25+ imports e vira "route hub", concentrando fan-in também.
- **Impacto de negócio**: baixo hoje. Vira P2 quando a rota passar 350 LOC (~fim da Fase 2).
- **Métrica de baseline**: 17 imports, 239 LOC. Alvo: split por sub-rota (`routes/recebimentos/painel.ts`, `routes/recebimentos/pipeline.ts`, `routes/recebimentos/alocar.ts`) quando LOC > 300 OU imports > 20.

## 5. Cards Kanban

### [modifiability-1] Extrair `gcdCod` para env/SSM e remover placeholder duplicado

- **Problema**
  > O `SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod = 0` está hardcoded no backend (`constants.ts:132`) e replicado no fallback do frontend (`lib/recebimentos.ts:397`). Quando o HAR de HML confirmar o valor real, o time terá que editar 2 arquivos em 2 stacks; esquecer um deles causa divergência entre preview e payload efetivo.

- **Melhoria Proposta**
  > Mover `gcdCod` para env (`EnvironmentProvider.solicitacaoNumerarioGcdCod`, com default `0` só em `NODE_ENV=development`). Backend passa a ler via provider; o fallback do frontend passa a receber a config via prop ou API `GET /recebimentos/config-sn` (single source). Tactic: **Defer Binding — configuration files**.

- **Resultado Esperado**
  > Trocar o `gcdCod` real em HML = editar 1 valor SSM/env, 0 arquivos de código. Preview FE e payload BE nunca divergem.

- **Tactic alvo**: Defer Binding — configuration files
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Sítios de mudança para trocar `gcdCod`: 2 → 1 (ou 0 se ficar em SSM)
  - Duplicação de constante entre BE/FE: 1 → 0
- **Risco de não fazer**: no dia do go-live HML, o valor real é editado no BE; o FE segue mostrando `gcdCod=0` no preview de fallback → operador aprova simulação diferente do que sobe ao ERP.
- **Dependências**: HML/HAR confirmando o `gcdCod` real (Fase 2)

### [modifiability-2] Remover `buildDryRunFallback` do frontend (ou reduzir a "erro amigável")

- **Problema**
  > `lib/recebimentos.ts:392-428` reconstrói localmente o payload `GerDocProcessoSelectionDTOCab` como fallback quando o BE falha. É 37 linhas espelhando o `SolicitacaoNumerarioService.gerar` (40 linhas). Qualquer mudança de shape (novo campo do com299, novo item de rateio) exige edição sincronizada em 2 repos.

- **Melhoria Proposta**
  > Trocar o fallback por: (a) toast de erro com `retry`, mantendo a rede de segurança de UX sem duplicar payload; ou (b) mock que devolve `{ dryRun:true, payload:null, mensagem:'BE indisponível' }` e o dialog mostra um estado de "sem preview". Tactic: **Abstract Common Services** — o builder canônico vive no service backend. Remover `buildDryRunFallback` inteiro.

- **Resultado Esperado**
  > 1 lugar canônico para o payload SN. Novo campo do com299 = editar apenas `SolicitacaoNumerarioService.ts`.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC de `lib/recebimentos.ts`: 524 → ≤ 487
  - Funções duplicando o shape do payload: 2 → 1
- **Risco de não fazer**: bug silencioso em produção quando FE e BE divergirem — o operador vê um payload no dialog que não é o que sobe ao ERP.
- **Dependências**: nenhuma

### [modifiability-3] Isolar a regra "encomenda-percentuais" em pure function testável antes de resolver

- **Problema**
  > `SolicitacaoNumerarioService.ts:60-62` usa `valorSn = valorTransacao` com dois `TODO(encomenda-percentuais)`. Quando a regra chegar, existe risco real de virar cascata de `if` dentro de `gerar()` — inflando o service para além do ceiling e misturando responsabilidades (payload builder + calculadora de percentual).

- **Melhoria Proposta**
  > Extrair, mesmo agora (antes da regra chegar), um `calcularValorSolicitacaoNumerario(valorTransacao, processo, config): number` como pure function em `domain/service/recebimentos/EncomendaValorCalculator.ts`. Hoje retorna `valorTransacao` (mesmo comportamento). Testar isoladamente. Quando a regra chegar, mudar 1 arquivo. Tactic: **Encapsulate** + **Increase Semantic Coherence**.

- **Resultado Esperado**
  > A resolução da regra de percentual mexe em 1 arquivo (`EncomendaValorCalculator.ts`) e não altera `SolicitacaoNumerarioService.gerar`.

- **Tactic alvo**: Encapsulate
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Arquivos alterados para implementar a fórmula de percentual: previsão de 3+ → 1
  - Cobertura de teste da fórmula (isolada): 0% → 100%
- **Risco de não fazer**: quando a regra chegar (com dependência de `processo.moeCod` para conversão, ou de tabela de percentuais por cliente), o service explode para 200+ LOC misturando I/O de payload com aritmética de negócio.
- **Dependências**: nenhuma (pode ser feito ANTES da regra chegar — é o ponto)

### [modifiability-4] Fatiar `src/frontend/lib/recebimentos.ts` (524 LOC → 4 arquivos)

- **Problema**
  > `lib/recebimentos.ts` acumula 4 responsabilidades: mirrors de DTOs, fixtures (rede de segurança do demo), tipos SN + fixture de processos, fetchers + fallback builder. 524 LOC em 1 arquivo dificulta review e vira gargalo de merge quando >1 pessoa toca Frente IV.

- **Melhoria Proposta**
  > Split em: `lib/recebimentos/types.ts` (tipos/mirrors + computeKpis), `lib/recebimentos/fixtures.ts` (fixtures painel + fixtureProcessos), `lib/recebimentos/api.ts` (fetchPainelRecebimentos), `lib/recebimentos/solicitacao-numerario.api.ts` (fetchProcessosParaTransacao + processarSolicitacaoNumerario). Re-export via `lib/recebimentos/index.ts` para não quebrar consumidores. Tactic: **Split Module** + **Increase Semantic Coherence**.

- **Resultado Esperado**
  > Nenhum arquivo do slice FE-recebimentos acima de 200 LOC. Fixture nunca é lido quando a página só precisa de tipos.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Max LOC em `lib/recebimentos/**`: 524 → ≤ 200
  - Imports transitivos ao editar um fetcher: 1 (só o api.ts) vs. hoje ler 524 linhas
- **Risco de não fazer**: cada nova rota FE (aprovar, estornar, etc.) engorda o arquivo; em 3 iterações passa de 700 LOC.
- **Dependências**: [modifiability-2] (fazer depois para não retrabalhar o `buildDryRunFallback`)

### [modifiability-5] Corrigir `set-state-in-effect` em `AlocarProcessosDialog` antes de expandir o dialog

- **Problema**
  > `AlocarProcessosDialog.tsx:90` dispara `setLoading(true)` / `setErro(null)` / `setResultados({})` direto no corpo do `useEffect`, disparando o warning `react-hooks/set-state-in-effect`. Modifiability: qualquer feature que expanda o dialog (paginação, busca, seleção múltipla) precisa primeiro entender esse hack — retrabalho garantido.

- **Melhoria Proposta**
  > Refatorar para: (a) migrar o fetch para `useQuery` (React Query já usado no projeto? confirmar) ou (b) usar `useReducer` com uma única ação `RESET_AND_LOAD` disparada no ciclo síncrono do effect. Tactic: **Refactor**.

- **Resultado Esperado**
  > 0 warnings de lint em SN files. Dialog pronto para receber features de expansão sem "cuidado com o efeito" tribal knowledge.

- **Tactic alvo**: Refactor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Warnings de lint em `AlocarProcessosDialog.tsx`: 1 → 0
  - Cascading renders visíveis no React DevTools: presente → ausente
- **Risco de não fazer**: warning acumula com os 28 pré-existentes de permutas/sispag/conexos, aumentando o ruído do gate; próxima feature "Alocar avançado" (Fase 2) esbarra na dívida.
- **Dependências**: confirmar se React Query já está no bundle da Frente IV

### [modifiability-6] Preparar split de `routes/recebimentos.ts` quando cruzar 300 LOC

- **Problema**
  > `routes/recebimentos.ts` está em 239 LOC com 17 imports (acima do teto de 15). Adicionar as próximas rotas de Frente IV (aprovar, estornar, listar processos por período, etc.) faz o arquivo crescer rápido — vai virar "route hub".

- **Melhoria Proposta**
  > Não fazer split agora (prematuro). Adicionar TODO comentado no topo do arquivo com o gatilho: "quando LOC > 300 OU imports > 20, fatiar em `routes/recebimentos/{painel,pipeline,alocar}.ts` e montá-los via `routes/recebimentos/index.ts`". Fica documentado como Cards de Kanban não-imediatos. Tactic: **Split Module** (deferido).

- **Resultado Esperado**
  > Ninguém do time é surpreendido quando o arquivo cruzar o teto; o refactor tem escopo definido antes de doer.

- **Tactic alvo**: Split Module (planejado)
- **Severidade**: P3
- **Esforço estimado**: S (comentário agora); M (o split quando disparar)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Comentário-gatilho presente: ausente → presente
  - LOC de qualquer arquivo em `routes/recebimentos/**`: ≤ 300 na Fase 2
- **Risco de não fazer**: o split é feito "de emergência" no PR errado, misturando refactor com feature — Regis-Review pega.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo:** análise restrita ao delta SN listado em `_shared-metrics.md`; NÃO reavaliei os 28 warnings pré-existentes em permutas/sispag/conexos (documentados como contexto, não atribuídos ao delta).
- **Cross-QA:** F-modifiability-1 e F-modifiability-2 (dupla-fonte de payload/config) tocam **Integrability** (contrato BE↔FE). F-modifiability-3 (isolar cálculo de percentual) toca **Testability** (função pura = teste local barato). F-modifiability-5 (setState-in-effect) toca **Testability** também — cascading renders quebram testes React Testing Library flaky.
- **Defer-binding leitura:** o slice SN é um caso-livro do Bass: (a) config isolada em `constants.ts`, (b) DI via Symbol token, (c) seam `enviarAoErp` separado do puro `gerar`, (d) feature flag `recebimentosEnabled` gate a família. O "cost of change" para ligar SN real é ~3 arquivos — abaixo da média do repo. Score alto reflete isso; os P1 são melhorias marginais sobre uma base já saudável.
- **Não medível:** lint biome não roda em subset de arquivos (config global) — verifiquei por `grep` no output global (`npm run lint`), confirmando 0 warnings em SN files.
- **Ontology:** `ontology/actions/recebimentos/gerar-solicitacao-numerario.md` e `ontology/integrations/conexos-com299-gerdoc.md` foram criados junto com o delta (per shared-metrics); coverage-drift do delta é 0 (não auditei o resto).
