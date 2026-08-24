---
qa: Testability
qa_slug: testability
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-testability
generated_at: 2026-08-24T18:55:00-03:00
scope: backend + frontend (frente SISPAG desta branch)
score: 6
findings_count: 8
cards_count: 7
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta SISPAG)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/CI executando `npm test` no delta SISPAG | Mudança em `RemessaService` / `ConciliacaoRetornoService` / `routes/sispag.ts` / `RemessaExecucaoRepository` / `sispagGate` | Suite backend (105 suítes / 1330 testes) + frontend (25 / 189) | Ambiente local com `.env` presente, ou CI sem `.env`; execução paralela (Jest `maxWorkers=2` backend, default frontend) | Sinal verde/vermelho fiel: (a) mesma resposta em qualquer máquina; (b) todo caminho de escrita gated coberto; (c) rota→serviço exercitada antes da HML | 0 flakes cross-run; 100% dos handlers de `routes/sispag.ts` com pelo menos 1 asserção; 0 divergência entre "verde local" e "verde CI"; `--runInBand` == `--maxWorkers=N` |

Falha real do cenário observada hoje: com `src/backend/.env` presente (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`), 5 dos 8 testes de `routes/recebimentos.e2e.gates.test.ts` falham — a suíte não é hermética. O delta SISPAG herda o mesmo `EnvironmentProvider` e a mesma flag global; qualquer route-test que a suite crie hoje herda a mesma armadilha.

## 2. Métricas observadas

**Métrica observável #1 — cobertura por camada no delta SISPAG (a única citação relevante da review).**

| Camada (arquivos do delta) | Stmts | Branches | Funcs | Lines | Alvo | Status | Fonte |
|---|---|---|---|---|---|---|---|
| `domain/service/sispag` (agregado, 6 arquivos) | 96.39% | 74.21% | 97.97% | 96.97% | ≥88% lines / ≥60% branches (piso do jest.config) | ✅ | `npx jest --coverage --testPathPatterns='domain/service/sispag'` |
| `domain/service/sispag/RemessaService.ts` (NEW) | 91.12% | 62.74% | 83.33% | 93.04% | ≥88% lines / ≥60% branches | ✅ (lines) / ⚠️ (funcs 83%) | mesmo comando; uncovered: 88, 160, 455-464 |
| `domain/service/sispag/ConciliacaoRetornoService.ts` (NEW) | 94.80% | 73.84% | 100% | 95.52% | ≥88% lines / ≥60% branches | ✅ | mesmo comando; uncovered: 149-150, 241 |
| `domain/client/ConexosSispag*.ts` (3 arquivos) | 77.84% | 51.31% | 77.38% | 79.01% | ≥54% branches (piso global) | ❌ trepou piso | `npx jest --coverage --testPathPatterns='domain/client/ConexosSispag'` — jest reportou "Coverage for branches (51.31%) does not meet global threshold (54%)" |
| `domain/repository/sispag/RemessaExecucaoRepository.ts` (NEW, 187 LOC) | — | — | — | — | ≥1 teste unitário; SQL parametrizado com fake do pool | ❌ ausente | `find src/backend/domain/repository/sispag -name '*.test.ts'` — só existem `LotePagamentoRepository.test.ts`, `PagamentoIngestaoRunRepository.test.ts`, `TituloAPagarRepository.test.ts` |
| `routes/sispag.ts` (472 LOC, 18 handlers) | 0% | 0% | 0% | 0% | ≥1 teste por handler crítico (padrão de `routes/permutas.test.ts` = 38 testes / `routes/recebimentos.test.ts` = 23) | ❌ ausente | `find src/backend/routes -name 'sispag.test.ts'` retorna vazio |
| `http/sispagGate.ts` (feature-flag) | 0% | 0% | 0% | 0% | ≥2 testes (403 quando `sispagEnabled=false`, next quando `true`) | ❌ ausente | `find src/backend/http -name 'sispagGate.test.ts'` retorna vazio |
| `frontend/lib/sispag.ts` (550 LOC, 41 exports incluindo `gerarRemessa`, `baixarRemessa`, `conciliarRetorno`) | — | — | — | — | ≥1 teste (padrão `lib/recebimentos.test.ts` existe) | ❌ ausente | `find src/frontend/lib -name 'sispag.test.ts'` retorna vazio |
| `frontend/app/sispag/**/*.tsx` (page 930 LOC, LoteCard 497 LOC, 2 dialogs) | — | — | — | — | ≥1 teste por componente com regra (padrão `AlocarProcessosDialog.test.tsx` de Recebimentos) | ❌ ausente | `find src/frontend/app/sispag -name '*.test.tsx'` retorna vazio |

**Outras métricas de testabilidade.**

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes novos no delta SISPAG (`RemessaService.test` + `ConciliacaoRetornoService.test` + `SispagPainelService.test` + 2 client tests) | 64 casos | — | ℹ️ informativo | `grep -c "^\s*it("` nos 5 arquivos: 21+11+12+6+14 |
| Suítes backend verdes (sem `.env`) | 1330 testes / 105 suítes | — | ✅ (baseline confirmado) | `_shared-metrics.md` |
| Suítes backend com `.env` presente | 5 de 8 testes de `recebimentos.e2e.gates.test.ts` falham | 0 falhas por presença de arquivo local | ❌ | Reproduzido agora: `npx jest --testPathPatterns='recebimentos.e2e.gates'` com `.env` presente → "5 failed, 3 passed, 8 total" |
| Route→service integração para SISPAG (padrão `permutas.test.ts` monta Express + mock de service) | 0 casos | ≥1 por rota de escrita (`POST /sispag/lotes/:id/remessa`, `POST /sispag/retornos/conciliar`, `POST /sispag/lotes/:id/finalizar`, `POST /sispag/ingestao`, `POST /sispag/lotes/formar`) = 5 rotas críticas | ❌ | `grep -rn "'/sispag/" src/backend/routes/*.test.ts` retorna 0 |
| Constructor-injection nos testes de serviço SISPAG (tactic Specialized Interfaces) | 100% (5/5 arquivos usam `new XService(mock)`) | ≥90% | ✅ | `grep -n "new .*Service(" src/backend/domain/service/sispag/*.test.ts` |
| `beforeAll`/`afterAll` compartilhando estado em teste SISPAG | 0 | 0 (per-test setup) | ✅ | `grep -c "beforeAll\|afterAll" src/backend/domain/service/sispag/*.test.ts` |
| Fontes de não-determinismo NÃO injetáveis no delta SISPAG (`Date.now`, `new Date()`, `randomUUID`) | 4 sítios (`RemessaService.hojeUtc:443`, `SispagPainelService:61+120`, `IngestaoPagamentosService:74`, `import randomUUID` em `RemessaService:1` — declarado mas o crypto direto flerta com o mesmo pattern) | 0 (injetar `ClockProvider` / `IdProvider`) | ⚠️ pré-existente reforçado pelo delta | `grep -rn "new Date\|Date.now\|randomUUID" src/backend/domain/service/sispag/*.ts` |
| Log-assertions em testes SISPAG (tactic Executable Assertions sobre observabilidade) | 0 chamadas a `.info` / `.error` no expect | ≥1 por caminho de erro fatal (fail-closed do `RemessaEmDuvidaError`, sanitização de payload) | ⚠️ | `grep -rn "logService\." src/backend/domain/service/sispag/*.test.ts` |
| Jobs em `src/backend/jobs/` (14 novos no delta, 37 no total) com teste unitário | 0 | Jobs de validação AO VIVO não requerem teste unitário (por design), mas requerem gate anti-produção; ver Finding F-testability-6 | ✅ (por design) | `find src/backend/jobs -name '*.test.ts'` → 0 |
| Frontend flake reproduzido (`AlocarProcessosDialog.test.tsx`, 40 testes, área de Recebimentos — não é do delta SISPAG mas roda no mesmo pipeline do PR) | Passou 40/40 em 2 runs desta sessão (`--runInBand` e `--maxWorkers=4`); prompt reporta 2 falhas em run anterior sob carga | 0 flakes; mesmo verdict cross-run | ⚠️ intermitente — não reprodutível on-demand hoje | `npx jest --runInBand app/recebimentos/components/AlocarProcessosDialog.test.tsx` e `npx jest --maxWorkers=4` |
| CI gate de coverage backend | Piso `global: {lines:72, branches:54, functions:78}` + `./domain/service/: {lines:88, branches:60}` | Adicionar piso por subdiretório `domain/client/` (hoje só o global cobre — trepou hoje quando medido isolado nos ConexosSispag*) | ⚠️ | `src/backend/jest.config.js:33-40` |

> ⚠️ **Não medível localmente**: taxa de flake real do frontend em cargas altas (o CI do GitHub tem CPU throttling diferente do laptop). Requer rodar a suite N=20 vezes com `maxWorkers=4` em runners reais e contar falhas. Recomendação: instrumentar `jest --json` no CI e agregar 30 dias.

## 3. Tactics — Cobertura no delta SISPAG

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `RemessaService`/`ConciliacaoRetornoService` recebem TODOS os colaboradores por `@inject` (5-6 deps cada); tests fazem `new XService(mock, mock, ..., noopLogService())`. tsyringe é o seam. | ✅ | `src/backend/domain/service/sispag/RemessaService.test.ts:117` (`new RemessaService(...)`) |
| Recordable Test Cases | Nenhum fixture de payload real do fin015/fin052 salvo em disco. Os payloads de retorno `.RET` são montados como literais dentro de cada `it()`. O `probe-fin052-retorno.ts` gera `.RET` sintético em `/tmp` mas nunca é ingerido pelo teste unitário. | ❌ ausente | `find src/backend -path "*/sispag/*fixture*" -o -path "*/sispag/*__fixtures__*"` retorna vazio |
| Sandbox | Falha: `EnvironmentProvider.GetLocalEnvironmentVars()` chama `dotenv.config({ path: process.cwd() + '/.env' })` toda vez que o singleton perde cache. Tests limpam `process.env`, mas o próximo `getEnvironmentVars()` REESCREVE do `.env` do dev. O teste "dry-run é o default" mede o `.env` do dev, não o comportamento do produto. | ❌ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:143-144`; reproduzido: 5 fails em `recebimentos.e2e.gates` com `.env` presente |
| Executable Assertions | Os 14 jobs novos em `src/backend/jobs/` (validate-fin015-import, validate-fin015-remessa, execute-fin015-prd, probe-fin052-retorno, sintetizar-ret-fin052 etc.) são assertions executáveis contra o ERP AO VIVO, com guardas anti-produção (`PERMITIR_PRD=1`, `EXECUTAR=1`, `FIN015_IMPORT_WRITE=1`, `CLEANUP=1`, `KILL_SWITCH`). São o ÚNICO gate que compara nossa lógica contra o comportamento real do Conexos — não substituíveis por mock. | ✅ (ativo, não dívida) | `src/backend/jobs/validate-fin015-import.ts:28-40` (RECUSA fora de HML sem override); `src/backend/jobs/execute-fin015-prd.ts:16-24` (dois opt-ins independentes) |
| Abstract Data Sources | `LotePagamentoRepository` e `RemessaExecucaoRepository` isolam SQL atrás de método tipado. Testes de serviço injetam fake do repo (bom). MAS: o `RemessaExecucaoRepository.ts` (187 LOC de SQL, o ledger write-ahead que impede pagar duas vezes) não tem teste próprio contra fake `Pool` — a semântica do UPSERT preservando `settled` está apenas assumida. | ⚠️ parcial | `wc -l src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts` = 187; `find ... -name RemessaExecucaoRepository.test.ts` = vazio |
| Limit Structural Complexity | Serviços novos ficam ≤467 LOC. Testes ficam ≤393 LOC. Nada patológico. `routes/sispag.ts` (472 LOC) é grande — 18 handlers em um arquivo — mas ainda dentro do tolerável se houvesse testes por handler. | ✅ | `wc -l src/backend/domain/service/sispag/*.ts src/backend/routes/sispag.ts` |
| Limit Non-Determinism | `RemessaService.hojeUtc()` usa `new Date()` direto (linha 443). `SispagPainelService` usa `Date.now()` para carimbar `geradoEm`. `RemessaService` importa `randomUUID` (linha 1). Nenhum passa por `ClockProvider`/`IdProvider` injetável. Não morde no unit test hoje (as datas não são asseradas por igualdade estrita), mas re-fere quando surgir teste de conteúdo de ledger/`.REM`. | ⚠️ pré-existente reforçado pelo delta | `grep -rn "new Date\|Date.now\|randomUUID" src/backend/domain/service/sispag/*.ts` |

Nada `N/A` — todos os tactics se aplicam.

## 4. Findings

### F-testability-1: caminho rota→serviço→ERP nunca é exercitado para SISPAG (0 de 18 handlers testados)

- **Severidade**: P0 (crítico — o fluxo de escrita entra em produção sem teste do próprio HTTP)
- **Tactic violada**: Specialized Interfaces (falta o teste de contrato no seam HTTP)
- **Localização**: `src/backend/routes/sispag.ts` (472 LOC, 18 handlers, contando 5 escritas críticas: `POST /lotes/:id/remessa`, `POST /retornos/conciliar`, `POST /lotes/:id/finalizar`, `POST /ingestao`, `POST /lotes/formar`)
- **Evidência (objetiva)**:
  ```
  $ find src/backend/routes -name 'sispag.test.ts'
  (vazio)
  $ grep -rn "'/sispag/" src/backend/routes/*.test.ts
  (vazio)
  ```
  Comparativo: `routes/permutas.test.ts` = 38 casos; `routes/recebimentos.test.ts` = 23 casos.
- **Impacto técnico**: mudança em `respondLoteError`, no Zod schema, no `Idempotency-Key` header, ou no `dryRun` do body passa pelos gates verdes. A perna de conciliação foi validada só por script manual em HML — a rota nunca foi disparada por teste.
- **Impacto de negócio**: escrita não-idempotente do fin015 (documentada: retry duplica lote). Sem teste da rota, uma mudança em `req.header('Idempotency-Key')` que passe `undefined` para o service quebra a chave estável e pagamentos podem sair duas vezes.
- **Métrica de baseline**: 0/18 handlers testados (0%). Permutas comparativa: 38 testes de rota. Recebimentos: 23 testes de rota + 12 arquivos e2e/integration.

### F-testability-2: `RemessaExecucaoRepository` (o ledger anti-double-pay) sem teste

- **Severidade**: P0 (o UPSERT que preserva `settled` é a defesa contra pagar duas vezes; sua semântica não está pinada em teste)
- **Tactic violada**: Abstract Data Sources + Executable Assertions
- **Localização**: `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:1-187`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/domain/repository/sispag/
  LotePagamentoRepository.test.ts       ← existe
  LotePagamentoRepository.ts
  PagamentoIngestaoRunRepository.test.ts ← existe
  PagamentoIngestaoRunRepository.ts
  RemessaExecucaoRepository.ts           ← 187 LOC, SEM .test.ts
  TituloAPagarRepository.test.ts        ← existe
  TituloAPagarRepository.ts
  ```
- **Impacto técnico**: o comentário do arquivo garante "`beginExecution` upserta a intenção e PRESERVA `settled`: um retry nunca regride nem gera segundo lote". Essa invariante depende do `ON CONFLICT DO UPDATE ... WHERE`. Nenhum teste prova. Uma alteração no `SELECT_COLS`, no filtro do UPDATE, ou no case-when do `status` passa despercebida.
- **Impacto de negócio**: quebra silenciosa do ledger = 2° POST no fin015 = pagamento duplicado real. O `RemessaService.test.ts` só verifica o comportamento do service com um fake do repo — a semântica SQL do repo real está no vácuo.
- **Métrica de baseline**: 3 de 4 repositórios sispag têm teste; `RemessaExecucaoRepository` = 0. 187 LOC de SQL crítico não testado.

### F-testability-3: `.env` local quebra a suite — `EnvironmentProvider` não é sandbox-safe

- **Severidade**: P1 (bloqueia gate local; falso-verde em máquina sem `.env`; falso-vermelho em máquina com `.env`)
- **Tactic violada**: Sandbox + Limit Non-Determinism
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.ts:143-144` (`dotenv.config({ path: envPath })`)
- **Evidência (objetiva)**:
  ```
  $ cat src/backend/.env | grep -E "CONEXOS_DRY_RUN|CONEXOS_WRITE_ENABLED"
  CONEXOS_WRITE_ENABLED=true
  CONEXOS_DRY_RUN=false

  $ npx jest --testPathPatterns='routes/recebimentos.e2e.gates'
  Tests: 5 failed, 3 passed, 8 total
  ```
  O teste faz `setEnv('CONEXOS_DRY_RUN', undefined)` → `delete process.env.CONEXOS_DRY_RUN`. Depois `resetEnvironmentCache()` força a próxima leitura. Essa leitura chama `dotenv.config({ path: cwd + '/.env' })`, que reescreve `CONEXOS_DRY_RUN=false` a partir do arquivo. Resultado: gate "dry-run é o default" mede o `.env` do dev, não o produto.
- **Impacto técnico**: qualquer route-test que a suite crie para SISPAG (F-testability-1) herda a mesma armadilha. O verde do CI (sem `.env`) diverge do verde local.
- **Impacto de negócio**: o developer não roda mais `npm test` local antes do PR (é a memória do repositório: `env-file-breaks-test-suite.md`). Perde-se o gate mais rápido; regressão vira problema de CI, com loop 10× mais lento.
- **Métrica de baseline**: 5 falhas em 8 testes com `.env` presente. Suite deveria ser hermética: 0 falhas independente de arquivos locais.

### F-testability-4: `sispagGate` middleware (feature-flag que responde 403) sem teste

- **Severidade**: P1 (feature-flag esconde toda a superfície SISPAG em produção; se quebrar, ou o produto vaza sem gate, ou fica 100% inacessível)
- **Tactic violada**: Specialized Interfaces (o gate É um seam)
- **Localização**: `src/backend/http/sispagGate.ts:1-22`
- **Evidência (objetiva)**:
  ```
  $ find src/backend/http -name 'sispagGate.test.ts'
  (vazio)
  ```
  O middleware faz `if (!env.sispagEnabled) res.status(403)`. Sem teste, uma inversão do `!` ou uma troca do nome da flag no `EnvironmentProvider` passa despercebida.
- **Impacto técnico**: gate silencioso (403) — o cliente vê tela quebrada sem log. Sem teste que force ambos os ramos (allow/deny), o comportamento do gate é assumido.
- **Impacto de negócio**: se `sispagEnabled` virar `true` inadvertidamente em produção, TODAS as rotas de escrita ficam expostas — inclusive `POST /lotes/:id/remessa` que dispara `.REM` real ao vivo.
- **Métrica de baseline**: 0/2 ramos testados (allow / deny). Alvo: 2/2.

### F-testability-5: frontend do delta (`app/sispag/*.tsx` e `lib/sispag.ts`, 2854 LOC) sem nenhum teste

- **Severidade**: P1 (o `LoteCard` de 497 LOC agora renderiza o botão "Gerar remessa" que dispara ESCRITA real; o `page.tsx` de 930 LOC gere estado da fila)
- **Tactic violada**: Specialized Interfaces (Testing Library é o seam padrão do repo — existe em Recebimentos e Permutas)
- **Localização**: `src/frontend/lib/sispag.ts` (550 LOC, 41 exports), `src/frontend/app/sispag/page.tsx` (930 LOC), `src/frontend/app/sispag/components/LoteCard.tsx` (497 LOC), `AdicionarTituloDialog.tsx` (171 LOC), `IngestaoDialog.tsx` (156 LOC)
- **Evidência (objetiva)**:
  ```
  $ find src/frontend/app/sispag -name '*.test.tsx'
  (vazio)
  $ find src/frontend/lib -name 'sispag.test.ts'
  (vazio; existem features.test.ts, utils.test.ts, recebimentos.test.ts — sispag ausente)
  ```
- **Impacto técnico**: a chamada `gerarRemessa(loteId, { dryRun: true/false })` do FE (linha 368 de `lib/sispag.ts`) — o único ponto onde o override de dry-run é aplicado pela UI — não tem teste. O botão pode enviar `dryRun: undefined` numa refatoração e nenhum verde detecta.
- **Impacto de negócio**: regressão que envia POST de remessa sem confirmação (sem modal), ou que ignora o toggle de dry-run, chega ao usuário. Considerando que `CONEXOS_DRY_RUN` é uma flag GLOBAL (a UI é o único ponto onde SISPAG pode diferenciar), a UI sem teste é o único gate quebrável entre "preview" e "banco".
- **Métrica de baseline**: 0/5 arquivos de FE do delta com teste. Padrão do repo: `AlocarProcessosDialog.test.tsx` = 40 testes; `recebimentos/page.test.tsx` (equivalente) existe.

### F-testability-6: 14 jobs de validação ao vivo — ativo, com guarda inconsistente em `validate-fin015-remessa.ts`

- **Severidade**: P2 (o padrão é bom; apenas 1 gap na uniformidade dos guards)
- **Tactic violada**: nenhuma diretamente — os jobs SÃO Executable Assertions bem construídos. A observação é sobre uniformidade dos gates anti-produção.
- **Localização**: `src/backend/jobs/validate-fin015-remessa.ts:29-32` versus `src/backend/jobs/validate-fin015-import.ts:38-40`
- **Evidência (objetiva)**:
  ```
  validate-fin015-import.ts:  if (!BASE.includes('-hml')) { RECUSADO; process.exit(1); }  // sem override
  validate-fin015-remessa.ts: if (!BASE.includes('-hml') && PERMITIR_PRD !== '1') { RECUSADO; }  // com override PRD
  execute-fin015-prd.ts:      if (!IS_HML && PERMITIR_PRD !== '1') { RECUSADO; } // com override + EXECUTAR=1
  ```
- **Impacto técnico**: os 3 usam critérios diferentes ("apenas HML" vs "HML ou PERMITIR_PRD" vs "HML ou PERMITIR_PRD, e escrita exige EXECUTAR"). Não há uma lib compartilhada `assertHmlOrExplicitPrd({ permitirPrd, requireExecutar })`.
- **Impacto de negócio**: risco baixo (todos têm guarda; o risco é operador rodar o job errado achando que outro protocolo se aplica). Positivo: são o ÚNICO gate contra a semântica real do fin015/fin052 — sem eles, a próxima escrita duplicada só é vista pelo cliente no extrato.
- **Métrica de baseline**: 14/14 jobs com guarda; 3 critérios distintos. Alvo: 1 função compartilhada com contrato explícito, ≥1 teste unitário dela.

### F-testability-7: fontes de não-determinismo (time/UUID) no serviço novo, não injetadas

- **Severidade**: P2 (não morde nos testes atuais; morde no próximo teste que verifique o CONTEÚDO do `.REM` ou do payload do ledger)
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1` (`import { randomUUID } from 'node:crypto'` — usado?), `:443` (`private hojeUtc = () => { const d = new Date(); ... }`); `src/backend/domain/service/sispag/SispagPainelService.ts:61,120` (`Date.now()` + `new Date(now).toISOString()`)
- **Evidência (objetiva)**:
  ```
  $ grep -n "randomUUID\b" src/backend/domain/service/sispag/RemessaService.ts
  1:import { randomUUID } from 'node:crypto';
  ```
  Import declarado, sem uso no corpo — cheiro de refactor incompleto (ou usado indiretamente via re-export? Não achei uso).
- **Impacto técnico**: teste que asserte "o `.REM` gerado hoje bate com fixture do bytes X" ou "o `correlationId` do ledger é Y" precisa mockar `Date` global. Sem `ClockProvider`/`IdProvider` injetável, o teste tem que usar `jest.useFakeTimers()`, que colide com `await` chains do ts-jest.
- **Impacto de negócio**: bloqueia recording-based tests (fixture do `.REM` real vs bytes gerados). Hoje contornado, mas sinaliza que o próximo passo (recorded assertions do CNAB 240 gerado) esbarra aqui.
- **Métrica de baseline**: 4 sítios NÃO injetáveis; alvo 0 nos arquivos novos.

### F-testability-8: flake intermitente em `AlocarProcessosDialog.test.tsx` (fora do delta, mesmo pipeline)

- **Severidade**: P2 (fora do escopo SISPAG, mas contamina o gate do PR)
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.test.tsx` (684 LOC, 40 testes, 8 usos de `waitFor` sem `{ timeout: N }` explícito)
- **Evidência (objetiva)**:
  ```
  Prompt reporta: "falhou 2 testes em execução paralela e passou 40/40 isolado e em --runInBand".
  Verificação nesta sessão: 2 runs consecutivos verdes (--runInBand e --maxWorkers=4).
  Não reprodutível on-demand hoje — não é falso: o prompt registra a falha observada.
  $ grep -n "waitFor(" src/frontend/app/recebimentos/components/AlocarProcessosDialog.test.tsx
  118, 157, 324, 408, 461, 471, 476, 487  # 8 waitFors, todos sem timeout customizado
  ```
- **Impacto técnico**: `waitFor` default timeout do Testing Library é 1000ms. Sob carga (worker paralelo, GC hit), estoura. Não é bug do produto — é bug do teste que confia no timeout default.
- **Impacto de negócio**: PR do delta SISPAG pode ficar vermelho por uma razão fora do delta. Perde-se confiança no verde.
- **Métrica de baseline**: 2 flakes observados em 1 run; 0 flakes nas re-execuções controladas. Alvo: 0/N em amostra N≥20.

## 5. Cards Kanban

### [testability-1] Cobrir `routes/sispag.ts` com testes de rota mockando os services

- **Problema**
  > `routes/sispag.ts` tem 18 handlers e 472 LOC — 5 deles são escritas críticas (`POST /lotes/:id/remessa`, `POST /retornos/conciliar`, `POST /lotes/:id/finalizar`, `POST /ingestao`, `POST /lotes/formar`) — e nenhum tem asserção HTTP. O caminho rota→service→ERP nunca foi exercitado no unit-test; a validação foi só por script manual em HML. Comparativo: `routes/permutas.test.ts` tem 38 casos, `routes/recebimentos.test.ts` tem 23.

- **Melhoria Proposta**
  > Criar `src/backend/routes/sispag.test.ts` no padrão do `permutas.test.ts` (mock de `bootstrapAppContainer`, `container.registerInstance` dos services SISPAG, Express real com `requireRole` e `heavyRouteLimiter`, `errorMiddleware`). Tactic Bass: **Specialized Interfaces**. Cobrir: (a) idempotency-key repassado ao service; (b) `dryRun` do body vs `dryRunOverride`; (c) 401 sem auth; (d) 403 sem role admin; (e) Zod 400 nos schemas `conciliarSchema` / `modalidadeSchema`; (f) 404 em `baixarArquivo` sem remessa; (g) 409 em `IngestLockBusyError` via `respondLoteError`.

- **Resultado Esperado**
  > Contrato HTTP do SISPAG pinado. Refactor no header ou no schema quebra teste em vez de chegar em HML.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P0
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes de rota em `routes/sispag.test.ts`: 0 → ≥25 (padrão comparativo: permutas=38, recebimentos=23)
  - Cobertura de `routes/sispag.ts`: 0% → ≥85% lines
  - Handlers com pelo menos 1 asserção: 0/18 → 18/18
- **Risco de não fazer**: mudança no `Idempotency-Key` header quebra a trava contra pagar duas vezes sem verde ficar vermelho; regressão descoberta pelo cliente.
- **Dependências**: nenhuma; padrão já existe (`permutas.test.ts`).

### [testability-2] Testar `RemessaExecucaoRepository` (ledger write-ahead) — a semântica UPSERT que impede pagamento duplicado

- **Problema**
  > `RemessaExecucaoRepository.ts` (187 LOC) é o ledger que garante "`beginExecution` preserva `settled`, um retry nunca regride nem gera 2° lote no fin015". O `RemessaService.test.ts` usa fake do repo — a semântica SQL real está no vácuo. Uma alteração no `ON CONFLICT DO UPDATE ... WHERE` passa despercebida. Todos os outros 3 repositórios sispag têm teste; só este não.

- **Melhoria Proposta**
  > Criar `RemessaExecucaoRepository.test.ts` no padrão de `LotePagamentoRepository.test.ts`, usando fake do `Pool` do `pg` (padrão já em uso no repo). Tactic Bass: **Abstract Data Sources**. Cobrir explicitamente: (a) `beginExecution` novo → row `reconciling`; (b) `beginExecution` com key já `settled` → NÃO regride (invariante crítica); (c) `beginExecution` com key `error` → substitui por `reconciling` (retry permitido); (d) `setNativeFlpCod` persiste antes de `settle` (é a pista do lote órfão); (e) `settle` idempotente.

- **Resultado Esperado**
  > A invariante "nunca regride `settled`" fica pinada em asserção. Refactor do UPSERT tem que passar por revisão do teste.

- **Tactic alvo**: Abstract Data Sources + Executable Assertions
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Arquivos de teste em `domain/repository/sispag/`: 3/4 → 4/4
  - Cobertura de `RemessaExecucaoRepository.ts`: 0% → ≥90% lines
  - Casos que fixam a invariante "settled não regride": 0 → ≥1
- **Risco de não fazer**: regressão silenciosa no UPSERT → segundo POST no fin015 → pagamento duplicado ao vivo.
- **Dependências**: nenhuma; padrão já existe.

### [testability-3] Tornar a suíte de testes hermética ao `.env` — carregar dotenv só quando NÃO estiver sob Jest

- **Problema**
  > `EnvironmentProvider.GetLocalEnvironmentVars()` chama `dotenv.config({ path: cwd + '/.env' })` na primeira leitura. Testes limpam `process.env`, mas dotenv reescreve do arquivo. Resultado hoje: 5 dos 8 testes de `recebimentos.e2e.gates.test.ts` falham quando `src/backend/.env` existe (com `CONEXOS_DRY_RUN=false`). Verde local ≠ verde CI. Memória do repo já registra: dev tem que APAGAR o `.env` antes de rodar `npm test` — testabilidade real está negativa nesse ponto.

- **Melhoria Proposta**
  > Duas alternativas convergentes: (a) `EnvironmentProvider` NÃO chama `dotenv.config` se `process.env.JEST_WORKER_ID` estiver setada (variável que o Jest injeta em cada worker); (b) mover o `dotenv/config` para `src/backend/index.ts` (que já importa em outra ordem) e remover do `EnvironmentProvider`. Ambas fecham o gap. Tactic Bass: **Sandbox + Limit Non-Determinism**. Adicionar `.env.test.example` que documenta o cenário-base do teste (todas as flags vazias).

- **Resultado Esperado**
  > Suíte hermética: `npm test` no laptop com `.env` presente = `npm test` no CI. Dev deixa de fazer git-stash do `.env` antes do gate.

- **Tactic alvo**: Sandbox + Limit Non-Determinism
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Falhas de `recebimentos.e2e.gates.test.ts` com `.env` presente: 5/8 → 0/8
  - Divergência CI×local: existe → não existe
  - Nota da memory `env-file-breaks-test-suite.md`: crítica → arquivada
- **Risco de não fazer**: F-testability-1 (route-tests do SISPAG) herda a mesma armadilha; ninguém confia no verde local; gate se degenera.
- **Dependências**: nenhuma. Cross-QA: liga com Modifiability (env-handling como seam) e Deployability (gate de CI que deve ser reprodutível localmente).

### [testability-4] Testar `sispagGate` middleware — ambos os ramos (allow/deny)

- **Problema**
  > `sispagGate` responde 403 se `sispagEnabled=false`, `next()` se `true`. Sem teste. Uma inversão do `!` ou renomeação da flag no `EnvironmentProvider` passa despercebida. Feature-flag silenciosa em produção — se ligar, expõe TODAS as rotas de escrita SISPAG; se desligar mal, cliente vê tela em branco sem log.

- **Melhoria Proposta**
  > Criar `src/backend/http/sispagGate.test.ts` com dois casos: (1) `env.sispagEnabled=false` → 403 body `{ error: 'SISPAG indisponível.' }` e `next` NÃO chamado; (2) `sispagEnabled=true` → `next` chamado, `res.status` não tocado. Tactic Bass: **Specialized Interfaces**. Padrão: montar Express mini + `container.registerInstance(EnvironmentProvider, fake)`.

- **Resultado Esperado**
  > Feature-flag protegida por teste; qualquer refactor da gate quebra teste antes de HML.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Ramos do gate testados: 0/2 → 2/2
  - Cobertura de `sispagGate.ts`: 0% → 100% lines
- **Risco de não fazer**: gate silencioso que se inverte por refactor; ou 403 permanente em produção sem sinal.
- **Dependências**: nenhuma.

### [testability-5] Testar `lib/sispag.ts` (FE) e `LoteCard.tsx` — o único ponto onde `dryRun` da UI é aplicado

- **Problema**
  > 2854 LOC de frontend novo (page 930, LoteCard 497, lib 550, 2 dialogs) sem nenhum teste. `gerarRemessa(loteId, { dryRun })` é o ÚNICO seam onde a UI diferencia preview de escrita real — `CONEXOS_DRY_RUN` é uma flag GLOBAL do backend, então o toggle do LoteCard é a última guarda contra o operador clicar errado. Sem teste, um refactor que passe `dryRun: undefined` remove essa guarda em silêncio.

- **Melhoria Proposta**
  > Criar (a) `src/frontend/lib/sispag.test.ts` no padrão de `lib/recebimentos.test.ts` (mock de `apiFetch`, asserções sobre payload/url), cobrindo `gerarRemessa`, `baixarRemessa`, `conciliarRetorno`, `formarLotes`, `ingestarPagamentos`; (b) `src/frontend/app/sispag/components/LoteCard.test.tsx` no padrão do `AlocarProcessosDialog.test.tsx`, cobrindo: click no botão "Gerar remessa" com dryRun ON/OFF, disabled quando lote não é FINALIZADO, download do arquivo, "Conciliar retorno" com/sem `processar`. Tactic Bass: **Specialized Interfaces**.

- **Resultado Esperado**
  > A última linha entre preview e escrita real fica sob teste. Refactor que remova o dryRun quebra vermelho antes de HML.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Arquivos de teste em `app/sispag/`: 0 → ≥3 (page + LoteCard + 1 dialog)
  - Arquivos de teste em `lib/sispag.ts`: 0 → 1 com ≥8 casos
  - Cobertura de `lib/sispag.ts`: 0% → ≥80% lines
- **Risco de não fazer**: mudança no toggle de dryRun ou no submit do LoteCard chega no operador sem verde ficar vermelho.
- **Dependências**: nenhuma; padrão já existe em Recebimentos.

### [testability-6] Extrair `assertHmlOrExplicitPrd()` para uniformizar os guards dos jobs de validação

- **Problema**
  > Os 14 jobs de validação AO VIVO são ativos genuínos (Executable Assertions contra o ERP — a única defesa contra o fin015 não-idempotente ir para produção quebrado). Todos têm guarda, mas usam 3 critérios distintos: `validate-fin015-import.ts` (só HML, sem override), `validate-fin015-remessa.ts` (HML ou PERMITIR_PRD), `execute-fin015-prd.ts` (HML ou PERMITIR_PRD, + EXECUTAR=1 para escrever). Uniformidade menor = operador confia no protocolo errado.

- **Melhoria Proposta**
  > Extrair `src/backend/jobs/_lib/liveGuards.ts` com `assertHmlOrExplicitPrd({ requireExecutar?: boolean })`, com teste unitário próprio (`liveGuards.test.ts`) cobrindo os 4 casos (HML+sem override / HML+override / PRD+sem override / PRD+override) × requireExecutar on/off. Migrar os 14 jobs. Tactic Bass: **Executable Assertions** (uniformidade permite raciocinar sobre o gate).

- **Resultado Esperado**
  > Contrato único de "quando o job pode escrever". Adicionar um 15° job passa pelo mesmo gate testado.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Critérios distintos de guarda anti-produção nos jobs: 3 → 1
  - Testes unitários dos guards: 0 → ≥8
  - Jobs migrados: 0/14 → 14/14
- **Risco de não fazer**: operador roda `validate-fin015-import` achando que precisa de `PERMITIR_PRD` (não precisa, ele já bloqueia) e é surpreendido; ou roda `validate-fin015-remessa` sem esperar override.
- **Dependências**: nenhuma.

### [testability-7] Injetar `ClockProvider` / `IdProvider` nos serviços SISPAG novos

- **Problema**
  > `RemessaService.hojeUtc()` (`new Date()`), `SispagPainelService.geradoEm` (`Date.now()` → `new Date(now).toISOString()`), e `RemessaService` importa `randomUUID` (linha 1, uso não encontrado no corpo — cheiro de refactor incompleto). Nenhum injetável. Não morde no unit-test hoje porque nenhum teste asserta conteúdo do `.REM` ou do payload do ledger — mas o próximo teste que compare bytes com fixture (recorded-based) esbarra aqui.

- **Melhoria Proposta**
  > Criar `src/backend/domain/libs/clock/ClockProvider.ts` (`@singleton @injectable`, método `now(): Date` e `utcMidnight(): number`) e `IdProvider.ts` (`newUuid(): string`). Injetar em `RemessaService` e `SispagPainelService` e nos serviços legado que usam `Date.now()` (`IngestaoPagamentosService`). Remover o `import { randomUUID }` não usado de `RemessaService.ts`. Tactic Bass: **Limit Non-Determinism**.

- **Resultado Esperado**
  > Testes de conteúdo (fixture-based do `.REM`, do payload do ledger) tornam-se escrevíveis sem `jest.useFakeTimers()`. Recorded Test Cases (tactic) fica destravado.

- **Tactic alvo**: Limit Non-Determinism (permite Recordable Test Cases)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — precisa migrar callers)
- **Findings relacionados**: F-testability-7
- **Métricas de sucesso**:
  - Sítios de `new Date()` / `Date.now()` / `randomUUID` NÃO injetáveis nos serviços novos SISPAG: 4 → 0
  - Imports não usados em `RemessaService.ts`: 1 → 0
- **Risco de não fazer**: bloqueia recorded assertions do CNAB 240 (o próximo passo natural do gate ao vivo). Cross-QA: liga com Modifiability.
- **Dependências**: nenhuma.

### [testability-8] Estabilizar `AlocarProcessosDialog.test.tsx` e adicionar `waitFor({ timeout })` explícito

- **Problema**
  > 40 testes no arquivo, 8 chamadas `waitFor()` sem `{ timeout }` explícito (default 1000ms do Testing Library). Sob carga (worker paralelo, GC hit), estoura. Prompt observou 2 falhas em execução paralela; verdes em `--runInBand`. Fora do delta SISPAG, mas contamina o gate do PR do delta.

- **Melhoria Proposta**
  > (a) Passar `waitFor(..., { timeout: 5000 })` explícito nos 8 sítios (o teste já não é hot-path, 5s ≠ estouro real); (b) segmentar o arquivo (40 testes / 684 LOC) em 3 arquivos por eixo (título, cancelar, alocar) — Limit Structural Complexity aplicado; (c) medir taxa de flake no CI durante 30 dias com `jest --json` agregado. Tactic Bass: **Limit Non-Determinism**.

- **Resultado Esperado**
  > Flake intermitente desaparece. Verde local == verde CI == verde em `--maxWorkers=N`.

- **Tactic alvo**: Limit Non-Determinism + Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para o timeout; M para o split
- **Findings relacionados**: F-testability-8
- **Métricas de sucesso**:
  - `waitFor` sem timeout no arquivo: 8 → 0
  - Falhas em amostra N=20 runs paralelos: >0 (prompt) → 0
  - LOC por arquivo de teste: 684 → ≤300 (3 arquivos)
- **Risco de não fazer**: gate do PR do delta SISPAG vira vermelho por razão alheia; dev perde tempo diagnosticando; confiança no verde erode.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Correção do baseline do prompt**: o prompt cita "29 testes novos (RemessaService 21, ConciliacaoRetornoService 11)". Contagem real com `grep -c "^\s*it("`: RemessaService=21 ✓, ConciliacaoRetornoService=11 ✓, mas ainda há SispagPainelService=12 e clients ConexosSispagRetornoClient=6 + ConexosSispagWriteClient=14 no delta — total real 64 casos, não 29.
- **Correção do prompt sobre AlocarProcessosDialog**: 40 testes (não 29). Ele não é do delta SISPAG (fica em Recebimentos), mas roda no mesmo pipeline de PR; incluído como P2 por contaminação de gate.
- **Coverage MEDIDO**: `npx jest --coverage --testPathPatterns='domain/service/sispag'` roda em 7.3s, retornou os números da seção 2. O `testPathPatterns` (plural) só existe no Jest 30; o CI já usa. Coverage do `routes/sispag.ts` é 0% (não medível — não há testes que o importem).
- **Cross-QA sinalizado ao consolidator**: (a) `testability-3` toca Modifiability (env-handling como seam) e Deployability (verde CI≠local corrompe gate); (b) `testability-2` toca Fault Tolerance (o ledger write-ahead É a defesa fail-closed contra double-pay); (c) `testability-4` toca Security (feature-flag exposta sem gate testado); (d) `testability-1` toca Integrability (contract-test do HTTP boundary do SISPAG).
- **O que NÃO consegui medir**: taxa real de flake do FE em runners de CI (só laptop hoje — 2 runs verdes, insuficiente para amostra). Recomendo instrumentar `jest --json` no CI e persistir 30 dias antes de fechar o P2 do flake.
