---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-07-24-2153
agent: qa-modifiability
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 8.5
findings_count: 6
cards_count: 6
---

# Modifiability — Regis-Review

> Escopo travado: apenas o **base scaffold Frente IV** (contracts-first, fully-stubbed). Não são
> filed findings para "lógica ausente" — a ausência é intencional (spec `frente-iv-arquitetura-modular.md`).
> A pergunta central é: **um teammate consegue trocar um stub por implementação real sem tocar em
> nenhum outro módulo?**

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Um dos 6 devs da Frente IV | Sobe implementação real de um módulo (ex.: `MatchingEngine`) atrás do port existente | Um serviço `@injectable()` + `container.register(TOKEN,…)` | Desenvolvimento paralelo, base scaffold em `main`, demais módulos ainda stubbed | O sistema compila, `npm test` verde, coordinator e os outros 5 módulos funcionam sem edits | 0 arquivos fora de `service/recebimentos/<modulo>/` + 1 linha em `recebimentosContainer.ts`; tempo de merge < 1h; 0 regressões em `RecebimentoPipelineService.test.ts` |

Cenário secundário (evolução do agregado): analista aprova mais um campo no `Recebimento` (ex.: novo `motivoEstornoDetalhado`) → shape muda em 1 arquivo (`Recebimento.ts` + Zod) + 1 migration aditiva; nenhum stub/service quebra porque leem apenas os slots que possuem.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Maior arquivo do scaffold (LOC) | 284 (`ports.ts`) | ≤ 400 | ✅ | `wc -l …/interface/recebimentos/*.ts` |
| Coordinator `RecebimentoPipelineService.ts` (LOC) | 265 | ≤ 400 | ✅ | `wc -l` |
| Ledger `RecebimentoExecucaoRepository.ts` (LOC) | 125 | ≤ 300 | ✅ | `wc -l` |
| Métodos no coordinator | 6 (`run` + 5 stages privados, arrow) | 1 responsabilidade por método | ✅ | grep `private/public ` |
| Densidade de controle-fluxo no coordinator | 3 branch-keywords | Bass low-complexity (≤ 10 por método) | ✅ | `grep -cE "if\|switch\|&&\|\|\|\|\?\?"` |
| Ports declarados em `ports.ts` | 12 interfaces + 14 DI tokens (`Symbol`) | 1 token por seam | ✅ | leitura direta |
| Imports fan-in cross-module (implementação → implementação) | 0 | 0 (todos falam por interface) | ✅ | `grep -rn "from.*recebimentos/(service\|repository)" src/backend \| grep -v recebimentos/` |
| Cross-layer violations (lambda→client, service→lambda) | 0 no scaffold | 0 | ✅ | inspection |
| Migrations aditivas | 7 (0032–0038), 1 tabela cada | 1 tabela/migration | ✅ | `ls migrations/003[2-8]_*.sql` |
| Warnings Biome novos no scaffold | 0 | 0 | ✅ | `npm run lint` (28 warnings totais, todos legados) |
| Testes green | 63 suites / 675 tests | verde | ✅ | `npm test` (orquestrador) |
| Cobertura ontológica dos 7 DTOs no `_index.json` | ⚠️ **não medível localmente** — nova frente ainda não plugada em `ontology/_index.json`/`_coverage.json` | 100% mapeada | ⚠️ | `ontology/_index.json` (frente ainda em `_inbox/`) |
| # magic numbers em business-rule do coordinator | 0 (`borVldTipo`/`contaDestino`/`dryRun` são params) | 0 | ✅ | leitura direta |
| Chamada a `container.resolve` dentro de service | 0 (só no coordinator via `@inject`) | 0 | ✅ | grep |

> ⚠️ **Não medível localmente**: métrica de "tempo real para trocar stub→real". Requer o primeiro
> merge de módulo (Matching/Rateio) para virar baseline. Instrumentar via label `frente-iv-module`
> nas PRs e medir *files-changed* por PR.

### Apêndice A — Top-10 largest files (scaffold-only)

| # | LOC | File |
|---|---|---|
| 1 | 284 | `src/backend/domain/interface/recebimentos/ports.ts` |
| 2 | 265 | `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts` |
| 3 | 144 | `src/backend/domain/interface/recebimentos/recebimentoTransitions.test.ts` |
| 4 | 125 | `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts` |
| 5 | 103 | `src/backend/domain/service/recebimentos/RecebimentoPipelineService.test.ts` |
| 6 | 100 | `src/backend/domain/repository/recebimentos/RecebimentoRepository.ts` |
| 7 | 97 | `src/backend/domain/interface/recebimentos/recebimentoTransitions.ts` |
| 8 | 95 | `src/backend/domain/interface/recebimentos/schemas.test.ts` |
| 9 | 91 | `src/backend/domain/repository/recebimentos/TransacaoRepository.ts` |
| 10 | 90 | `src/backend/domain/interface/recebimentos/constants.ts` |

Todos ≤ 300 LOC. Nenhum candidato imediato a **Split Module**. `ports.ts` é o único que pode
tender a inchar (comentário abaixo — Card `modifiability-2`).

### Apêndice B — Top fan-in "hubs" do scaffold

| # | Módulo | Fan-in (arquivos importadores) | Comentário |
|---|---|---|---|
| 1 | `interface/recebimentos/ports.ts` | ≥ 15 (todos os stubs + repos + coordinator + container + rota) | por design — é o *contract seam* |
| 2 | `interface/recebimentos/constants.ts` | 8 (todos que usam status/enums) | por design — evita raw strings (P3 ontologia) |
| 3 | `interface/recebimentos/Recebimento.ts` | 6 (coordinator, repo, rota, transitions, ports, fixture) | **spine** — atenção à evolução (F-modifiability-1) |
| 4 | `interface/recebimentos/recebimentoTransitions.ts` | 2 (coordinator + test) | isolado, puro — ótimo |
| 5 | `service/recebimentos/RecebimentoPipelineService.ts` | 2 (rota + test) | coordinator só resolvido pela rota — ótimo |

Nenhum service concreto importado por outro service (fan-in de implementação = 0). O único fan-in
alto é o **contrato**, exatamente como manda o design "contracts-first, aggregate-as-spine".

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Ports por módulo em `ports.ts`; repos por tabela; stubs isolados 1 arquivo cada; migrations 1-tabela-por-arquivo | ✅ presente | `interface/recebimentos/ports.ts:129–182`; `stubs/*.ts` |
| **Increase Semantic Coherence** | Cada `*Stub` implementa exatamente uma interface; cada repo mapeia 1 tabela; `recebimentoTransitions.ts` só state-machine pura | ✅ presente | `recebimentoTransitions.ts:36–97`; `RegrasEngineStub.ts` |
| **Encapsulate** | Toda comunicação inter-módulos passa por `*Interface` + Symbol token; SQL vive só em `repository/`; ledger encapsula idempotência | ✅ presente | `RecebimentoExecucaoRepository.ts:39–69`; `ports.ts:269–284` |
| **Use an Intermediary** | `RecebimentoPipelineService` é o intermediary explícito das 5 stages; `MetricsPortInterface.withCorrelationId` intermedia log context; DI container intermedia binding stub↔real | ✅ presente | `RecebimentoPipelineService.ts:85–95`; `ports.ts:174–182` |
| **Restrict Dependencies** | Nenhum service concreto importa outro service concreto (fan-in de implementação = 0); services só dependem de `*Interface` + tokens; rota resolve apenas o coordinator | ✅ presente | `RecebimentoPipelineService.ts:23–34` (tudo `type` import) |
| **Refactor** | N/A na Fase 0 (código novo) — mas a estrutura já materializa a saída de uma refactor: cada módulo pluga por porta | N/A | scaffold é greenfield |
| **Abstract Common Services** | `LogService`, `EnvironmentProvider`, `PostgreeDatabaseClient` reaproveitados; ledger espelha `PermutaExecucaoRepository`; gate espelha `sispagGate` | ✅ presente | `RecebimentoExecucaoRepository.ts` (padrão do Permutas); `http/recebimentosGate.ts` |
| **Defer Binding — DI (configuration)** | 14 `Symbol()` tokens; `registerRecebimentosPorts()` idempotente; swap stub→real = 1 linha | ✅ presente | `recebimentosContainer.ts:40–64` |
| **Defer Binding — Polymorphism** | `RegraRecebimentoInterface` já é *plugin contract* (regra individual) + `RegrasEngineInterface` como registry | ✅ presente | `ports.ts:152–160` |
| **Defer Binding — Runtime registration** | Container permite registrar múltiplas regras plugáveis; test suite comprova reset+re-register | ✅ presente | `RecebimentoPipelineService.test.ts:43–47, 83–87` |
| **Defer Binding — Configuration files** | `borVldTipo` e `contaDestino` viajam como **params** do payload (nunca hardcoded); `recebimentosEnabled` via `EnvironmentProvider` | ⚠️ parcial | `ports.ts:79–107` (params ok); mas *registry* de regras ainda não lê catálogo de config (F-modifiability-4) |

## 4. Findings (achados)

### F-modifiability-1: `RecebimentoRepository.save/mapRow` descarta `rateios` e `regrasAplicadas` — spine perde membros do agregado

- **Severidade**: P1
- **Tactic violada**: Encapsulate + Increase Semantic Coherence
- **Localização**: `src/backend/domain/repository/recebimentos/RecebimentoRepository.ts:24-99`
- **Evidência (objetiva)**:
  ```
  // save: INSERT/UPDATE não persiste rateios nem regrasAplicadas — só a raiz.
  // mapRow (linhas 89-90): regrasAplicadas: [], rateios: []
  // Comentário admite "agregados membros vivem em suas próprias tabelas" mas o método é `save(recebimento)`
  // e o contrato `RecebimentoRepositoryInterface.save` promete persistir o agregado.
  ```
- **Impacto técnico**: quando Módulo 3 (Rateio) trocar seu stub por implementação real, um `pipeline.run()` seguido de `pipeline.reload(id)` **retorna um `Recebimento` sem os rateios** — a spine é lossy. Silenciosamente quebra as invariantes I-Receb-1 (Σ rateio ≤ valorRecebido) em cenários de retry/reload.
- **Impacto de negócio**: risco de dupla execução parcial: o coordinator reidrata um `Recebimento` "vazio de rateios" e re-rateia. A idempotency é do lado da execução ERP (ledger), mas o rateio pode redistribuir de forma diferente na segunda passada. Reconciliação inconsistente na conta-cliente.
- **Métrica de baseline**: 0 de 2 relacionamentos-filho persistidos por `save` (rateios, regrasAplicadas); coverage do test do repo sobre esses relacionamentos = 0%.

### F-modifiability-2: `ports.ts` concentra 12 interfaces + 14 tokens + 10 tipos-suporte em 1 arquivo (284 LOC) — futuro hotspot de merge

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts` (arquivo inteiro)
- **Evidência (objetiva)**:
  ```
  284 LOC, 12 export interface (portas), 14 export const (tokens), 10 supporting types.
  Todos os 6 módulos + coordinator + container + rota + testes editam este arquivo para qualquer evolução.
  ```
- **Impacto técnico**: com 6 devs em paralelo, qualquer refino de contrato (adicionar campo em `MatchResult`, novo tipo `ParcelaAjustada`, etc.) gera merge conflicts triviais mas repetidos no mesmo arquivo. É contra o próprio princípio "cada dev não bloqueia outro" da spec §1.
- **Impacto de negócio**: fricção de merge desacelera as 6 esteiras em paralelo — o único gargalo cross-team no scaffold hoje.
- **Métrica de baseline**: 284 LOC / 12 interfaces / 14 tokens em 1 arquivo; fan-in ≥ 15 arquivos. Alvo: 6 arquivos `ports/<modulo>.ts` re-exportados por um `index.ts` (≤ 60 LOC cada).

### F-modifiability-3: `RecebimentoPipelineService` acumula 10 `@inject` no construtor — construtor bloating limita composição alternativa

- **Severidade**: P2
- **Tactic violada**: Reduce Coupling (Encapsulate)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:61-82`
- **Evidência (objetiva)**:
  ```
  10 dependências injetadas (ingestao, matching, rateio, regras, erp, ndeEmitter, metrics,
  recebimentoRepository, execucaoRepository, logService). Adicionar um passo ("aplicarCambio",
  "notificarAnalista", "gravarAuditoria") = editar o construtor + o método run + a rota + o container.
  ```
- **Impacto técnico**: para migrar futuramente ao alvo Lambda (Step Functions ou EventBridge por stage), a decomposição forçará quebrar esta classe em 5 handlers. O construtor gordo é o "pré-cheiro" desse split — pior, tornaria a evolução em Step Functions um big-bang.
- **Impacto de negócio**: cada nova stage no pipeline (auditoria/notificação/câmbio) toca o coordinator — o "spine" já vira ponto único de mudança para *acréscimo* de estágios, o oposto do OCP.
- **Métrica de baseline**: 10 injections; 5 stage-methods hardcoded na sequência `run`. Alvo: registrar stages numa lista `PipelineStage[]` (plugável) e iterar — mesma API pública, adicionar stage = 1 arquivo novo + 1 registro.

### F-modifiability-4: registry de regras (`RegrasEngineInterface` + `RegraRecebimentoInterface`) não expõe API de registro plugável

- **Severidade**: P2
- **Tactic violada**: Defer Binding (runtime registration / configuration files)
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:151-160`; `stubs/RegrasEngineStub.ts`
- **Evidência (objetiva)**:
  ```
  RegrasEngineInterface expõe apenas `aplicar(parcelas, ctx)`. Não há `register(regra: RegraRecebimentoInterface)`
  nem convenção "escaneia container por token REGRA_TOKEN". A Fase 4 vai ter que decidir esse mecanismo
  no meio do desenvolvimento — quebrando a ideia de "contrato congelado agora".
  ```
- **Impacto técnico**: quando as 3 regras da Fase 4 chegarem, o dev D vai precisar decidir simultaneamente: (a) hardcode das regras no engine, ou (b) adicionar registro plugável. Se escolher (a), congela extensibilidade; se (b), edita o contrato depois do "freeze".
- **Impacto de negócio**: cada nova regra do cliente (novo tipo de encomenda, novo cálculo de multa) vira `feat` no engine em vez de plugin adicional — quebra o "cliente = configuração" e torna a curva de custo linear em vez de constante.
- **Métrica de baseline**: 0 métodos de registro no contract; 1 stub monolítico. Alvo: `RegrasEngineInterface.register(rule: RegraRecebimentoInterface): void` + `list(): RegraRecebimentoInterface[]` — e/ou multi-injection tsyringe (`@injectAll`).

### F-modifiability-5: `Recebimento` como spine muta via spread — 4 spreads shallow no coordinator (`{ ...recebimento, campo }`) sem versionamento explícito

- **Severidade**: P3
- **Tactic violada**: Encapsulate (invariantes do agregado)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:125-256` (linhas 125, 146, 195, 245)
- **Evidência (objetiva)**:
  ```
  const recebimento: Recebimento = { ...input.recebimento, classificacaoMatch: match.classificacao };
  const enriched: Recebimento = { ...recebimento, rateios };
  const aprovado: Recebimento = { ...recebimento, status: RECEBIMENTO_STATUS.APROVADO, aprovadoPor };
  const executado: Recebimento = { ...aprovado, status: RECEBIMENTO_STATUS.EXECUTADO, ... };
  ```
- **Impacto técnico**: `versao` (concorrência otimista, campo já existente no shape) **nunca é incrementado**. O contrato promete "espelha I6 do lote" mas o coordinator persiste 4× o mesmo `versao=0`. Quando 2 pipelines rodarem em paralelo pelo mesmo `id` (retry + operador manual), o `UPDATE` do `RecebimentoRepository` sobrescreve sem cheiro.
- **Impacto de negócio**: race condition silenciosa em cenário multi-operador. Baixo risco na Fase 0 (fluxo é linear por correlationId), mas o gap ficará se ninguém formalizar antes das Fases 3/5.
- **Métrica de baseline**: 4 mutações spread, 0 `versao++`. Alvo: um único helper `evolveRecebimento(prev, patch)` que garante `versao = prev.versao + 1` e loga `qive_id`.

### F-modifiability-6: ontologia da Frente IV vive em `_inbox/frente-iv-arquitetura-modular.md` — não plugada em `_index.json`/`_coverage.json`

- **Severidade**: P3
- **Tactic violada**: Defer Binding (Configuration files — ontologia é a "config" arquitetural)
- **Localização**: `ontology/_inbox/frente-iv-arquitetura-modular.md`; `ontology/_index.json`; `ontology/_coverage.json`
- **Evidência (objetiva)**:
  ```
  Os 7 DTOs novos (TransacaoBancaria, DocumentoAReceber, Recebimento, RateioRecebimento,
  CreditoCliente, RegraRecebimento, NotaDebitoEletronica) já existem em código mas não têm
  entrada em ontology/_index.json (arquivo → entidade → implementação).
  ```
- **Impacto técnico**: `/retro-ontology` não vê a Frente IV → drift silencioso. `CodebaseNavigator` não localiza os arquivos pelo nome de entidade. Próximas reviews Regis não conseguem partir de baseline de coverage.
- **Impacto de negócio**: perde-se a rastreabilidade que o pipe garante para as outras frentes. 6 devs seguem, mas sem "GPS" ontológico.
- **Métrica de baseline**: 7 entidades scaffolded / 0 mapeadas em `_index.json`. Alvo: 7/7 antes de fechar Fase 0.

## 5. Cards Kanban

### [modifiability-1] Persistir agregado completo em `RecebimentoRepository.save` (rateios + regras)

- **Problema**
  > `RecebimentoRepository.save` grava apenas a raiz do agregado; `mapRow` devolve `rateios: []` e
  > `regrasAplicadas: []`. Quando o Módulo 3 for real, um reload perde o rateio já calculado,
  > forçando recomputo com risco de inconsistência silenciosa.
- **Melhoria Proposta**
  > Estender `save` para escrever também `rateio_recebimento` (0034) e a associação de regras
  > aplicadas na mesma transação (tactic **Encapsulate**). `findById` deve reidratar tudo. Se a
  > decisão for manter o repo "raiz-only", renomear para `saveRoot`/`findByIdRoot` e criar um
  > `RecebimentoAggregateRepository` que compõe os 3 repos — mas explicitar no contrato.
- **Resultado Esperado**
  > `save(r); const r2 = await findById(r.id); expect(r2.rateios).toEqual(r.rateios)` verde.
  > Métrica: relacionamentos-filho persistidos por `save` — 0/2 → 2/2. Test-coverage do repo sobre
  > `rateios/regrasAplicadas` — 0% → 100%.
- **Tactic alvo**: Encapsulate
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Relacionamentos-filho persistidos: 0/2 → 2/2
  - `RecebimentoRepository` test coverage sobre membros do agregado: 0% → ≥ 90%
- **Risco de não fazer**: dupla execução parcial de rateio no primeiro incidente de retry após a
  Fase 3; investigação lenta porque a spine "some" e reaparece diferente.
- **Dependências**: nenhuma (pode entrar na Fase 3 junto com o `RateioService` real).

### [modifiability-2] Fatiar `ports.ts` por módulo (`ports/matching.ts`, `ports/rateio.ts`, …)

- **Problema**
  > `ports.ts` acumula 12 interfaces + 14 tokens + 10 tipos-suporte em 284 LOC. Cada dev que refina
  > o próprio contrato edita o mesmo arquivo — merge conflicts triviais mas contínuos, contradizendo
  > o princípio "6 devs em paralelo sem bloqueio" da spec.
- **Melhoria Proposta**
  > Aplicar **Split Module**: um arquivo por módulo em `interface/recebimentos/ports/`
  > (`ingestao.ts`, `matching.ts`, `rateio.ts`, `regras.ts`, `execucao.ts`, `observabilidade.ts`,
  > `repository.ts`) + um `ports/index.ts` que re-exporta tudo (compat com imports atuais). Manter
  > tokens ao lado da interface que servem.
- **Resultado Esperado**
  > Nenhum import mudou; conflitos de merge no seam caem para zero em edits de contrato módulo-only.
  > Métrica: LOC do maior arquivo de contrato — 284 → ≤ 60 por módulo.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Maior LOC em arquivo de contrato: 284 → ≤ 60
  - Merge conflicts em `ports/*.ts` em PRs de módulo distinto: cross-file ratio ↓ 80%
- **Risco de não fazer**: fricção crescente conforme a Fase 4/5 refina contratos; devs começam a
  "engolir" mudanças de contrato dos outros por conta.
- **Dependências**: antes de qualquer dev começar a implementar (freeze só quando fatiado).

### [modifiability-3] Tornar o pipeline de stages plugável (`PipelineStage[]` em vez de 5 métodos hardcoded)

- **Problema**
  > O coordinator injeta 10 dependências e encadeia 5 stages hardcoded em `run`. Adicionar uma
  > sexta stage (auditoria, notificação, câmbio) exige tocar construtor + `run` + rota + container
  > — o spine vira ponto único de mudança para *acréscimos*, contra OCP.
- **Melhoria Proposta**
  > Definir `interface PipelineStage { name: string; execute: (ctx) => Promise<ctx> }`. Registrar
  > stages via multi-injection tsyringe (`@injectAll(PIPELINE_STAGE_TOKEN)`). `run` reduz para um
  > `for` que aplica stages na ordem de registro (ou por `priority`). Cada stage vira 1 classe
  > `@injectable()` isolada (fica pronto para virar 1 Lambda / 1 Step Functions state).
- **Resultado Esperado**
  > Adicionar novo stage = 1 arquivo novo + 1 `container.register`. Coordinator não muda.
  > Métrica: `@inject` no construtor 10 → ≤ 4 (só o que é transversal: metrics, log, repo raiz,
  > execucao); stages injetados 6 → N via `@injectAll`.
- **Tactic alvo**: Defer Binding (runtime registration) + Split Module
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - `@inject` no coordinator: 10 → ≤ 4
  - Arquivos tocados para adicionar 1 nova stage: 4 → 1
- **Risco de não fazer**: quando migrar ao alvo Lambda/Step Functions, a decomposição vira
  big-bang em vez de mecânica.
- **Dependências**: card `modifiability-2` (contratos fatiados facilitam mover stages).

### [modifiability-4] Formalizar registro plugável de regras (`RegrasEngine.register(rule)`) antes da Fase 4

- **Problema**
  > `RegrasEngineInterface` só expõe `aplicar`. Não há convenção de como as 3 regras da Fase 4
  > se registram. O dev D vai decidir isso sozinho no meio da implementação — congela contrato
  > tarde e mata o "regra = plugin" que a proposta ao cliente promete.
- **Melhoria Proposta**
  > Congelar já o contrato de plugin: `RegrasEngineInterface.register(rule: RegraRecebimentoInterface)`
  > + `listAtivas(): RegraRecebimentoInterface[]`. Alternativa: adotar `@injectAll(REGRA_PLUGIN_TOKEN)`
  > e documentar que cada regra `@injectable()` marcada com `container.register(REGRA_PLUGIN_TOKEN, {useClass: MinhaRegra})`
  > entra automaticamente. Tactic **Defer Binding — Runtime Registration**.
- **Resultado Esperado**
  > Nova regra = 1 arquivo `regras/<nome>.ts` + 1 linha no container; engine não muda; teste do
  > registry cobre "N regras registradas → N aplicadas em ordem de prioridade".
  > Métrica: arquivos tocados para adicionar 1 regra: N → 2.
- **Tactic alvo**: Defer Binding (polymorphism + runtime registration)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Métodos de registro no contrato: 0 → 2 (`register`, `listAtivas`)
  - Arquivos tocados para nova regra: engine + registry + regra → só a regra
- **Risco de não fazer**: cada regra do cliente vira `feat` interno; upsell vira release em vez de config.
- **Dependências**: pode entrar junto com card `modifiability-2` (mesmo arquivo `ports/regras.ts`).

### [modifiability-5] Introduzir `evolveRecebimento(prev, patch)` que incrementa `versao` a cada mutação da spine

- **Problema**
  > As 4 mutações do `Recebimento` no coordinator usam `{ ...recebimento, campo }` — o campo `versao`
  > nunca incrementa. O `RecebimentoRepository.save` faz `UPDATE` cego sobre a raiz, permitindo
  > sobrescrita silenciosa em cenários de operador manual em paralelo com retry.
- **Melhoria Proposta**
  > Criar helper puro `evolveRecebimento(prev, patch): Recebimento` que devolve `{ ...prev, ...patch, versao: prev.versao + 1 }`
  > e é o único caminho de mutação. `RecebimentoRepository.save` adiciona guard `WHERE versao = $versaoAtual - 1`
  > (optimistic concurrency), retornando erro tipado em conflito. Tactic **Encapsulate**.
- **Resultado Esperado**
  > `versao` cresce monotonicamente por rodada; conflict de concorrência vira erro explícito em vez
  > de perda silenciosa. Métrica: mutações spread diretas no coordinator: 4 → 0.
- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Mutações spread diretas: 4 → 0
  - `save` com `WHERE versao =` guard: 0 → 1
- **Risco de não fazer**: race condition invisível no primeiro cenário multi-operador (baixa
  frequência hoje, mas o campo `versao` já existe e não faz nada).
- **Dependências**: card `modifiability-1` (ambos tocam o `save`).

### [modifiability-6] Plugar entidades da Frente IV em `ontology/_index.json` + `_coverage.json`

- **Problema**
  > Os 7 DTOs do scaffold existem em código mas não têm entrada no `_index.json`. `/retro-ontology`
  > não vê a Frente IV; drift arquitetural começa invisível.
- **Melhoria Proposta**
  > Adicionar entrada por entidade em `_index.json` mapeando para os arquivos em
  > `interface/recebimentos/`, `repository/recebimentos/`, migrations `0032–0038`. Atualizar
  > `_coverage.json` com status inicial (`scaffold` / `stubbed`). Tactic **Defer Binding —
  > Configuration files**: ontologia é a config arquitetural do repo.
- **Resultado Esperado**
  > `_coverage.json` reporta 7/7 entidades da Frente IV com status conhecido. `CodebaseNavigator`
  > resolve `entities/recebimento.md` → arquivos. `/retro-ontology` mede drift semanalmente.
- **Tactic alvo**: Defer Binding (Configuration files)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Entidades mapeadas em `_index.json`: 0/7 → 7/7
  - Cobertura em `_coverage.json`: ausente → linha-de-base declarada
- **Risco de não fazer**: 6 devs trabalhando em paralelo sem o "GPS" ontológico — próximas revisões
  Regis partem sem baseline.
- **Dependências**: `OntologyCurator` promove o `_inbox/frente-iv-arquitetura-modular.md` para
  arquivos formais em `entities/`, `actions/`, `state-machines/`.

## 6. Notas do agente

- **Design goal atingido**: fan-in cross-module de *implementação* = 0. O único hub é o **contrato**
  (`ports.ts` + `constants.ts` + `Recebimento.ts`), exatamente como manda a spec §1. Nota base 8.5.
- **Cross-QA — Integrability**: cards `modifiability-2` (fatiar `ports.ts`) e `modifiability-4`
  (registro plugável de regras) tocam a mesma superfície que Integrability audita — coordenar.
- **Cross-QA — Testability**: card `modifiability-1` (persistir agregado) destrava teste de
  reidratação; card `modifiability-3` (stages plugáveis) simplifica mocks de stage isolada.
- **Cross-QA — Deployability**: card `modifiability-4` mantém "regra = config" (upsell sem
  redeploy). `borVldTipo`/`contaDestino` como params já satisfazem o "sem magic number em regra".
- **Não medível localmente**: tempo real do swap stub→real e conflitos de merge cross-módulo —
  virarão baseline após o primeiro merge (Matching ou Rateio).
