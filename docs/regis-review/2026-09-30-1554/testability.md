---
qa: Testability
qa_slug: testability
run_id: 2026-09-30-1554
agent: qa-testability
generated_at: 2026-09-30T16:30:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança no caminho de login e sessão (AUTH_PROVIDER supabase, refresh, espelho de credencial, sync) | `http/auth.ts`, `routes/auth.ts`, `domain/service/auth/*`, `SupabaseAuthClient`, `frontend/lib/auth/*` | CI (Jest, sem GoTrue nem Postgres reais) | Testes exercitam cada ramo (sucesso, banido, divergência, expiração) sem rede e sem relógio real | Todo arquivo de lógica do delta com teste colocado; 0 chamadas de rede reais; piso de cobertura enforced no CI |

## 2. Métricas observadas

Escopo: delta `76b5182..HEAD` (--quick: cobertura não rodada; o piso do `coverageThreshold` é o proxy).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Cobertura por camada (backend)** | ⚠️ **Não medida (--quick)**. Pisos enforced: global 72% lines / 54% branches / 78% functions; `./domain/service/` 88% lines / 60% branches. Repository, lambda/routes: sem piso próprio | 80% lines, 70% branches em service/repository | ⚠️ | `src/backend/jest.config.cjs:39`; `npm test -- --coverage` roda no CI |
| #1b Cobertura por camada (frontend) | ⚠️ Não medida. Pisos: global 33/23/28; `./lib/auth/` 24% lines | `lib/auth/` >= 60% | ⚠️ | `src/frontend/jest.config.js:41` |
| Arquivos de teste, total | Backend 189, frontend 65; 174 + 65 suítes, 3111 + 625 testes verdes | razão >= 0,5 | ✅ (razão exata não recontada) | `_shared-metrics.md` |
| Arquivos de lógica do delta com teste colocado (backend) | 100% de `domain/service/auth/` (7 serviços), `SupabaseAuthClient`, `UserRepository`, `AccessRepository`, `http/{auth,authEnv,acesso,rateLimit}` | 100% | ✅ | `ls src/backend/domain/service/auth` |
| Arquivos do delta sem teste | 3 entrypoints/scripts: `jobs/sync-supabase-auth.ts`, `jobs/seed-admin.ts` (só `SeedAdminConfig` testada), `jobs/probe-gotrue-local.ts` (337 LOC, sonda manual) | 0 de lógica | ⚠️ | `ls src/backend/jobs` |
| Frontend `lib/auth/` com teste | 7 de 7 arquivos com teste (`session-refresh`, `token`, `AuthProvider`, `PermissoesProvider`, `env`, `safe-return-to`, `session-events`) mais `api-fetch-refresh.test.ts` para `lib/http.ts` | 100% | ✅ | `ls src/frontend/__tests__/auth` |
| Testes novos no delta (casos `it`) | `auth.test.ts` 24, `routes/auth.test.ts` 22, `SupabaseAuthClient.test.ts` 28, `CredentialMirror` 16, `SupabaseSessionService` 13, `SupabaseAuthSyncService` 12, `identidade.supabase` 7, `rateLimit` 7 | n/a | ✅ | grep `it(` |
| Seam de DI | Serviços testados com mocks injetados; `container.resolve` só em `routes/auth.ts` (produção, 3 sítios) | construtor direto | ✅ | `routes/auth.ts:59,101,102` |
| Fixtures gravadas de API externa (GoTrue) | 0; `global.fetch = fetchMock` com respostas montadas à mão | fixtures gravadas | ⚠️ | `SupabaseAuthClient.test.ts:70` |
| Testes de integração com Postgres/GoTrue reais no delta | 0. Migration 0070 testada por regex sobre o fonte SQL | >= 1 | ❌ (padrão pré-existente, ver 0064) | `0070_app_user_auth_user_id.test.ts:1-16` |
| Leituras de tempo não injetáveis (fonte, delta) | Backend 4 (`SupabaseAuthClient.ts:284,371,393,404`); frontend 2 (`AuthProvider.tsx:112,174`) | 0 | ⚠️ | grep `Date.now` |
| Aleatoriedade em fonte no delta | 0 | 0 | ✅ | grep |
| Chamadas de rede reais em testes | 0 | 0 | ✅ | `SupabaseAuthClient.test.ts:70` |
| Fake timers onde há tempo | `auth-provider-sessao.test.tsx` usa; `SupabaseAuthClient.test.ts:119` usa `Date.now()` real com margem | fake em ambos | ⚠️ | grep `useFakeTimers` |
| Property-based (fast-check) no delta | 0 | opcional | ⚠️ P3 | grep |
| Maior teste do delta | `SupabaseAuthClient.test.ts` 402 LOC; `auth.test.ts` 313 | <= 500 | ✅ | `wc -l` |
| CI roda testes com coverage | Sim, backend e frontend | sim | ✅ | `.github/workflows/ci.yml:25-27,78-80` |
| Piso por arquivo em código de auth | 0 entradas no backend; frontend só `lib/auth/` 24% | por arquivo em código crítico | ⚠️ | `jest.config.cjs:39`, `jest.config.js:41` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `SupabaseAuthClient` isola o GoTrue; `AUTH_PROVIDER` alterna o caminho; `ConfigDoctor` expõe divergência | ✅ presente | `routes/auth.ts:59-102`, `ConfigDoctor.test.ts` |
| Recordable Test Cases | Respostas do GoTrue montadas à mão, sem gravação real | ⚠️ parcial | `SupabaseAuthClient.test.ts:70` |
| Sandbox | `probe-gotrue-local.ts` roda contra `supabase start` local; não roda no CI | ⚠️ parcial | `jobs/probe-gotrue-local.ts` |
| Executable Assertions | Divergência banido vs ativo vira `LogService.error` assertado | ✅ presente | `SupabaseSessionService.test.ts:117` |
| Abstract Data Sources | Repositórios injetados e mockados; sem PG real | ⚠️ parcial | `UserRepository.test.ts` |
| Limit Structural Complexity | Serviços pequenos e separados (sessão, espelho, sync, seed); maior teste 402 LOC | ✅ presente | `ls domain/service/auth` |
| Limit Non-Determinism | `Date.now()` direto em 6 sítios; sem `ClockProvider` | ⚠️ parcial | F-testability-1 |

## 4. Findings

### F-testability-1: Relógio não injetável em SupabaseAuthClient e AuthProvider

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/client/SupabaseAuthClient.ts:284,371,393,404`; `src/frontend/lib/auth/AuthProvider.tsx:112,174`
- **Evidência (objetiva)**:
  ```
  expiresAt: r.expires_at ?? Math.floor(Date.now() / 1000) + r.expires_in,
  typeof r.banned_until === 'string' && new Date(r.banned_until).getTime() > Date.now(),
  ```
  O teste usa `const antes = Math.floor(Date.now() / 1000)` (SupabaseAuthClient.test.ts:119): asserção por janela, não por valor exato.
- **Impacto técnico**: a decisão "banido agora?" e o cálculo de expiração dependem do relógio real; os testes só têm tolerância, não a fronteira exata (`banned_until == agora`).
- **Impacto de negócio**: bug de fronteira em bloqueio de usuário ou refresh de sessão passa pelos testes; risco baixo hoje.
- **Métrica de baseline**: 6 leituras de tempo não abstraídas no delta (4 backend, 2 frontend).

### F-testability-2: Migration 0070 e cliente GoTrue sem teste de integração real

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/migrations/0070_app_user_auth_user_id.test.ts:1-16`; `SupabaseAuthClient.test.ts:70`
- **Evidência (objetiva)**: o teste da migration faz `readFileSync` do `.sql` e casa regex; o comentário admite que "a execução real ... é o passo 1 do roteiro de QA". O GoTrue é `fetchMock`.
- **Impacto técnico**: sintaxe, ordem de grants/roles e contrato JSON real do GoTrue só são exercitados manualmente. O incidente de 2026-09-23 (migration que não rodou em `dist/`) mostra o custo desse tipo de lacuna.
- **Impacto de negócio**: regressão de login em produção é detectada por usuário, não pelo CI.
- **Métrica de baseline**: 0 testes de integração (PG ou GoTrue reais) no delta; 1 migration verificada só por regex. O padrão é pré-existente (`0064`).

### F-testability-3: Entrypoints de job do delta sem teste

- **Severidade**: P3
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/backend/jobs/sync-supabase-auth.ts`, `jobs/seed-admin.ts`, `jobs/probe-gotrue-local.ts` (337 LOC)
- **Evidência (objetiva)**: existe `SeedAdminConfig.test.ts`, mas nenhum teste cobre os `main()`; a lógica está em serviços testados (`SupabaseAuthSyncService.test.ts`, 12 casos).
- **Impacto técnico**: o default dry-run e o mapeamento `--execute` para `codigoSaida` não são asseridos no entrypoint.
- **Impacto de negócio**: dry-run que escreve seria visto só em produção; mitigado pela URL alvo impressa no topo do relatório.
- **Métrica de baseline**: 3 de 3 entrypoints de job do delta sem teste do `main`.

### F-testability-4: Pisos de cobertura não protegem o código de sessão

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/jest.config.js:41`; `src/backend/jest.config.cjs:39`
- **Evidência (objetiva)**: `'./lib/auth/': { lines: 24 }`; no backend só `gracefulShutdown`, `bootstrap` e `lifecycle` têm piso por arquivo.
- **Impacto técnico**: o delta trouxe testes densos de auth, mas o gate aceitaria a queda de cobertura em `session-refresh.ts`, `AuthProvider.tsx`, `SupabaseSessionService` sem falhar.
- **Impacto de negócio**: regressão silenciosa em login/refresh, caminho que bloqueia toda a operação do analista.
- **Métrica de baseline**: piso `lib/auth/` 24% lines; pisos por arquivo em auth no backend: 0.

## 5. Cards Kanban

### [testability-1] Fixar pisos de cobertura por arquivo no código de auth

- **Problema**
  > O delta de auth trouxe testes densos, mas o gate de CI não os protege: `lib/auth/` tem piso de 24% e o backend não tem piso por arquivo em `domain/service/auth/` nem em `http/auth*.ts`.

- **Melhoria Proposta**
  > Medir a cobertura atual desses arquivos e assentar pisos logo abaixo do medido, no padrão já usado para `gracefulShutdown`/`bootstrap`. Tocar `src/backend/jest.config.cjs` e `src/frontend/jest.config.js`.

- **Resultado Esperado**
  > Regressão de cobertura em auth reprova o CI. Pisos por arquivo em auth no backend: 0 → 5 entradas; frontend `lib/auth/` lines 24% → (medido menos 2 pontos).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Pisos por arquivo em auth (backend): 0 → 5
  - Piso `lib/auth/` lines: 24% → medido - 2
- **Risco de não fazer**: a cobertura de auth erode nas próximas features sem sinal no CI.
- **Dependências**: rodar `npm test -- --coverage` uma vez (não feito em --quick).

### [testability-2] Injetar relógio nas decisões de expiração e banimento

- **Problema**
  > `SupabaseAuthClient` e `AuthProvider` leem `Date.now()` direto (6 sítios); o teste de `expiresAt` usa janela em vez de valor exato.

- **Melhoria Proposta**
  > Aceitar um `now: () => number` (backend: provider injetável ou parâmetro de construtor; frontend: parâmetro em `session-refresh.ts`) e usar relógio fixo/`jest.useFakeTimers` nos testes, incluindo a fronteira `banned_until == agora`.

- **Resultado Esperado**
  > Leituras de tempo não abstraídas no delta 6 → 0; casos exatos de fronteira de banimento e expiração 0 → 3.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Leituras de tempo não abstraídas: 6 → 0
  - Casos de fronteira exatos: 0 → 3
- **Risco de não fazer**: bug de fronteira em bloqueio/refresh só aparece em produção.
- **Dependências**: nenhuma.

### [testability-3] Testes de integração contra `supabase start` e Postgres real para a 0070

- **Problema**
  > A migration 0070 é validada por regex sobre o fonte e o GoTrue é `fetchMock`; a execução real é roteiro manual de QA.

- **Melhoria Proposta**
  > Criar suíte `describe('integration: ...')` executada sob flag (fora do `npm test` padrão) que aplica a 0070 num Postgres com os roles e faz um ciclo login/refresh contra o GoTrue local, reaproveitando `probe-gotrue-local.ts`. Gravar respostas reais como fixtures do teste unitário do client. Opcional: teste do `main` dos jobs (dry-run não escreve).

- **Resultado Esperado**
  > Testes de integração de auth no delta 0 → 3 (migration, login/refresh, dry-run do sync); fixtures gravadas do GoTrue 0 → 4 respostas.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-2, F-testability-3
- **Métricas de sucesso**:
  - Testes de integração de auth: 0 → 3
  - Fixtures GoTrue: 0 → 4
- **Risco de não fazer**: divergência entre o mock e o GoTrue real derruba o login sem o CI perceber.
- **Dependências**: Supabase CLI disponível no runner.

## 6. Notas do agente

- Escopo: delta de auth-supabase; --quick, cobertura não rodada (pisos do jest config como proxy). Sem P0/P1: todo arquivo de lógica do delta tem teste e não há baseline numérico que sustente severidade maior.
- Pré-existente (não do delta): teste de migration por regex (`0064`), ausência de fast-check no backend. Não coletado: razão exata teste/fonte do backend. O `git diff` foi bloqueado no shell; a lista de arquivos veio do `--stat` e de `ls`.
- Cross-QA: Modifiability (relógio injetável), Integrability (fixtures GoTrue = contract tests), Deployability (pisos de cobertura e gate no CI), Fault Tolerance (divergência banido/ativo tem teste).
