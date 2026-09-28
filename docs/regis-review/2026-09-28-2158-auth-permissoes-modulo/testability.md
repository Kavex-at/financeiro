---
qa: Testability
qa_slug: testability
run_id: 2026-09-28-2158
agent: qa-testability
generated_at: 2026-09-28T21:58:00-03:00
scope: backend, frontend (diretórios tocados por auth-permissoes-modulo, ver _shared-metrics.md)
score: 7.5
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do time Kavex, no próximo `/feature-tweak` sobre acesso (ex.: papéis reais da Columbia, passo 3 da ADR-0051) | Precisa mudar a guarda R9 (`lockAndCheck`) ou a migration de permissões sem quebrar a serialização de escritas concorrentes nem a idempotência do DDL | `AccessRepository.lockAndCheck`, migration `0066_auth_permissoes_modulo.sql` | CI (sem Postgres real fora do job `backend-sql`, que não cobre este diretório) | A suíte automatizada pega a regressão antes do merge, sem depender de alguém lembrar de repetir a validação manual num Postgres descartável | 0 testes `*.integration.test.ts` hoje sob `domain/repository/auth/` ou `migrations/0066*`; alvo ≥ 1 arquivo cobrindo a guarda de concorrência e o DDL idempotente, rodando no `backend-sql` |

## 2. Métricas observadas

### Tabela canônica — cobertura por camada (escopo do delta)

| Camada | Stmts | Branch | Funcs | Lines | Piso do `jest.config` | Status | Fonte |
|---|---|---|---|---|---|---|---|
| `domain/service/auth/` (AccessService, AuthService, EffectivePermissionCalculator, UserAdminService) | 98,34% | 91,58% | 96,96% | 99,53% | `./domain/service/` agregado: 88% linhas / 60% branch | ✅ | `npx jest --coverage --testPathPatterns "domain/(service\|repository)/auth/.*\.test\.ts$" …` |
| `domain/repository/auth/` (AccessRepository, UserRepository) | 98,12% | 90,17% | 98% | 98,4% | nenhum piso específico — cai no bucket `global` (72/54/78) | ✅ (sem rede própria) | idem |
| `http/` (`acesso.ts`, `auth.ts`) | 92,91% | 78,94% | 80,95% | 94,82% | bucket `global` | ✅ | idem |
| `routes/usuarios.ts` (handler HTTP, camada fina) | 72,82% | 61,53% | 75% | 75% | bucket `global` | ⚠️ ramos de erro (`RoleNotFoundError`, `MissingEncryptionKeyError` → 503) sem teste (linhas 73-95) | idem |
| Frontend `lib/auth/PermissoesProvider.tsx`, `components/auth/ExigePermissao.tsx`, `lib/permissoes.ts` | 100% / 100% / 100% (stmts) | 93,1% / 100% / 100% | 100% / 100% / 100% | 100% / 100% / 100% | global do frontend: 33% linhas / 23% branch / 28% funções | ✅ (bem acima do piso, que continua baixo) | `npx jest --coverage --testPathPatterns "(auth\|usuarios\|permutas-executar\|permissoes-api)" …` |
| Frontend `app/usuarios/EditarAcessoDialog.tsx` (novo, 318 linhas) | 95,53% | 91,17% | 93,33% | 98,96% | idem | ✅ | idem |

### Outras métricas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes verdes no backend (branch vs. `main`) | 166 suites / 2928 testes (main: 160 / 2442) | crescer com a feature | ✅ | `_shared-metrics.md` |
| Testes verdes no frontend (branch vs. `main`) | 63 suites / 614 testes (main: 57 / 485) | crescer com a feature | ✅ | `_shared-metrics.md` |
| Cobertura de guard por rota (introspecção `router.stack`) | 85/85 rotas autenticadas, exatamente 1 guard cada | 100% | ✅ | `src/backend/http/routePermissions.test.ts` |
| Casos comportamentais (linha por linha, 403/404/sentinela) | 346 casos (`it.each` sobre a `TABELA`) | cobrir toda rota nova | ✅ | idem |
| Arquivos `domain/repository/auth/*.test.ts` que fazem *dispatch* por regex sobre o texto do SQL | 2 (`AccessRepository.test.ts`, `UserRepository.test.ts`) | 0 — contrato deveria ser por forma/schema, não por string | ⚠️ | `AccessRepository.test.ts:61-99`, `UserRepository.test.ts:75-97` |
| Testes `*.integration.test.ts` cobrindo `domain/repository/auth/` ou `migrations/0066*` | 0 | ≥ 1 (padrão já existe: `vwMetricasCiclo.integration.test.ts` + job `backend-sql`) | ❌ | `find src/backend -iname '*.integration.test.ts'`; `.github/workflows/ci.yml:34-62` |
| Validação ao vivo (Postgres 16 descartável) da migration 0066 e da guarda R9/`lockAndCheck` | Feita manualmente: DDL 2x + reverse, 27/27 checagens de repositório, 10/10 corridas concorrentes — **nenhuma automatizada** | Convertida em `*.integration.test.ts`, rodando em CI | ❌ | `_shared-metrics.md` ("Validação ao vivo"); `0066_auth_permissoes_modulo.test.ts:6-10` ("aqui ficam travadas as decisões do scoping"); ADR-0053 D6 |
| Recorrência do mesmo gap entre ciclos | 2ª ocorrência: `testability-1` (P1) já pedia isso para a migration 0064 / guarda R11 no ciclo anterior (`auth-email-transicao`, 20/20 manual) e não foi implementado | 0 recorrências | ❌ | `ontology/_inbox/auth-email-transicao-regis-followups.md:15-19` |
| `coverageThreshold` do frontend (piso global) | linhas 33% / branch 23% / funções 28% (`./lib/auth/`: só linhas 24%) | ≥ 70% em diretórios críticos de auth, dado que o código novo já entrega ~90-100% | ⚠️ não medível como regressão desta feature (piso pré-existente), mas a feature não o eleva apesar da cobertura real ser muito maior | `src/frontend/jest.config.js:41-50` |
| `Clock` injetável para o TTL de 30 s do cache (`AccessService`) | Novo nesta branch (`domain/libs/clock/Clock.ts`, não existe em `4c6b34f`); usado em 8 dos 9 testes de `AccessService.test.ts`, avançando o relógio sem `setTimeout` real | Todo `Date.now()`/`new Date()` em código novo passa por um clock injetável | ✅ (para este módulo) | `src/backend/domain/service/auth/AccessService.ts:53-64`; `AccessService.test.ts:22-31` |
| `fast-check` como dependência do repositório | Só transitiva (via `package-lock.json`, referência de *funding*), **não é `devDependency` direta** em `src/backend/package.json` nem `src/frontend/package.json` | Se for adotado para `EffectivePermissionCalculator`, precisa entrar como dependência direta | ⚠️ | `grep fast-check src/backend/package.json src/frontend/package.json` → vazio |

> ⚠️ **Não medível localmente**: throughput/latência do `backend-sql` job ampliado (quantos segundos um job de integração de auth somaria ao CI). Requer rodar o job real no GitHub Actions.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `AcessoFixture` (`administrador()`, `somenteLeitura()`, `porPapelLegado()`) para montar `req.acesso` sem a cadeia real de auth; construção de serviços por injeção direta de mocks no construtor (`new AccessService(repo as any, calculator, log as any, clock)`) | ✅ presente | `src/backend/http/__fixtures__/acesso.fixture.ts`; `AccessService.test.ts:33-44` |
| Recordable Test Cases | Fixture de acesso reutilizável entre suítes de rota; tabela única (`TABELA`) que documenta e testa as 85 rotas em paralelo à ADR | ✅ presente | `acesso.fixture.ts`; `routePermissions.test.ts:51-143` |
| Sandbox | Postgres 16 descartável usado para validar migration 0066, guarda R9 e as 10 corridas concorrentes — mas só manualmente, fora do CI | ⚠️ parcial (sandbox existe, não está automatizado) | `_shared-metrics.md`; `0066_auth_permissoes_modulo.test.ts:6-10`; ver F-testability-1 |
| Executable Assertions | Log assertions no caminho de erro (`log.warn` para permissão fora do catálogo); teste estático que a trilha `app_user_access_event` só recebe `INSERT` (nunca `UPDATE`/`DELETE`); ordem de chamadas (`chamadas` array) provando trava-antes-de-ler | ✅ presente | `AccessService.test.ts:147-158`; `AccessRepository.test.ts:406-414`, `278-292` |
| Abstract Data Sources | `Clock` injetável (novo nesta branch) isola o TTL de 30 s; `PostgreeDatabaseClient`/`TransactionClient` injetados por interface, nunca instanciados no repositório | ✅ presente | `Clock.ts`; `AccessRepository.ts:1-16,152-159` |
| Limit Structural Complexity | `routePermissions.test.ts` (434 linhas) e `usuarios.test.ts` (692 linhas) ficam abaixo do limiar de 500 linhas de alerta, mas ambos concentram muita responsabilidade (introspecção + comportamento + JC); `EffectivePermissionCalculator` continua pequeno (85 linhas fonte / 124 teste) | ⚠️ parcial | `wc -l src/backend/http/routePermissions.test.ts src/backend/routes/usuarios.test.ts` |
| Limit Non-Determinism | Tempo: coberto pelo `Clock` no cache do `AccessService`. Concorrência: a serialização de `lockAndCheck` (`FOR UPDATE`, ordem de id) só foi exercitada sob carga real num Postgres descartável, 10/10 vezes, **manualmente** — não há teste automatizado de corrida (nem com duas transações reais, nem com um fake que force interleaving) | ⚠️ parcial (tempo resolvido; concorrência não) | `AccessRepository.ts:317-372`; `_shared-metrics.md` |

## 4. Findings (achados)

### F-testability-1: Guarda R9 e migration 0066 só validadas ao vivo, fora do CI — 2ª recorrência do mesmo gap

- **Severidade**: P1
- **Tactic violada**: Sandbox / Recordable Test Cases
- **Localização**: `src/backend/migrations/0066_auth_permissoes_modulo.sql`, `src/backend/migrations/0066_auth_permissoes_modulo.test.ts:6-10`, `src/backend/domain/repository/auth/AccessRepository.ts:317-372` (`lockAndCheck`)
- **Evidência (objetiva)**:
  ```
  // 0066_auth_permissoes_modulo.test.ts, linhas 6-10
  * Asserções sobre o FONTE, no padrão de `0064_app_user_email.test.ts`: o `MigrationRunner` usa
  * `import.meta` e não roda sob Jest. A execução real (do zero, duas vezes, guarda e reverse) foi
  * feita num Postgres 16 descartável; aqui ficam travadas as decisões do scoping.

  // _shared-metrics.md, "Validação ao vivo"
  AccessRepository/UserRepository reais: 27/27 checagens; corrida "último gestor" 10/10
  (exceções concorrentes e desativação concorrente: sempre 1 sucesso + 1 LastUserManagerError).

  // .github/workflows/ci.yml:60 — glob do job que roda contra Postgres real
  npm run test:sql   →   jest migrations/.*\.integration\.test\.ts

  $ find src/backend -iname '*.integration.test.ts' | grep -Ei 'auth|0066'
  (nenhum resultado)
  ```
  O `test:sql` do `package.json` (`"jest migrations/.*\\.integration\\.test\\.ts"`) só varre `migrations/`, e o único arquivo que casa é `vwMetricasCiclo.integration.test.ts`. Nem a migration 0066 nem `AccessRepository`/`UserRepository` têm um `*.integration.test.ts` correspondente.
- **Impacto técnico**: um refactor futuro em `lockAndCheck` (ordem do `FOR UPDATE`, ou remover a trava dos ativos antes de ler o alvo) passa pelos 582 testes automatizados que rodam nesta área (todos com fake de transação) e só quebraria de verdade sob concorrência real — exatamente o cenário que foi provado 10/10 manualmente e não fica travado em lugar nenhum executável. O mesmo vale para a migration: rodar a 0066 duas vezes, ou reverter e reaplicar, foi provado uma vez, à mão, no dia do PR.
- **Impacto de negócio**: a guarda R9 é o que impede a Columbia de ficar sem ninguém que possa gerenciar usuários (zero gestores) — uma regressão silenciosa aqui é destravada só quando alguém tenta editar acesso em produção e falha (ou pior, não falha e deixa zero gestores). É a mesma classe de incidente que gerou o card `testability-1` de 2026-09-14 (que criou o job `backend-sql` para a `vw_metricas_ciclo` depois de rodar sem rede por meses).
- **Métrica de baseline**: 0 arquivos `*.integration.test.ts` cobrindo `domain/repository/auth/` ou `migrations/0066*`; 27 checagens e 10 corridas concorrentes validadas manualmente, 0 automatizadas; esta é a **segunda vez** que o mesmo tipo de achado é registrado (`auth-email-transicao-regis-followups.md:15-19`, P1 `testability-1`, não implementado).

### F-testability-2: Fakes de transação despacham por regex sobre o texto do SQL

- **Severidade**: P2
- **Tactic violada**: Abstract Data Sources
- **Localização**: `src/backend/domain/repository/auth/AccessRepository.test.ts:59-99`, `src/backend/domain/repository/auth/UserRepository.test.ts:75-97,142-144`
- **Evidência (objetiva)**:
  ```ts
  selectMany: jest.fn(async (sql: string, params?: Record<string, unknown>) => {
      if (/FOR UPDATE/.test(sql) && /WHERE ativo = true/.test(sql)) { ... }
      if (/FROM app_user u/.test(sql)) { ... }
      throw new Error(`SQL inesperado no tx: ${sql}`);
  }),
  ```
- **Impacto técnico**: o fake não modela um banco — ele reimplementa, em regex, o formato exato de cada string SQL do repositório. Qualquer mudança de forma (renomear o alias `u`, adicionar uma coluna, quebrar a query em outra linha, adicionar um `--` comentário que contenha `FOR UPDATE`) tanto pode derrubar o teste por "SQL inesperado no tx" quanto — pior — casar com o branch errado silenciosamente, se dois SQLs passarem a compartilhar o mesmo trecho. O teste está acoplado à redação do SQL, não ao contrato (parâmetros de entrada/saída e ordem de chamadas).
- **Impacto de negócio**: a guarda de concorrência (R9) e a trilha de auditoria são justamente o que este padrão de fake tenta provar (`chamadas` array). Se o fake casar a query errada, o teste continua verde enquanto a ordem real de trava/leitura/escrita mudou — dando falsa confiança exatamente na parte mais sensível da feature (guarda do último gestor).
- **Métrica de baseline**: 2 arquivos de teste no delta usam esse padrão (`AccessRepository.test.ts`, `UserRepository.test.ts`), juntos com > 20 `it()` que dependem da correspondência regex-SQL para escolher o retorno certo.

### F-testability-3: `routePermissions.test.ts` depende de estrutura interna não documentada do Express 5

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity / Specialized Interfaces
- **Localização**: `src/backend/http/routePermissions.test.ts:159-195` (`introspectar`, tipos `Layer`/`RouteLayer`)
- **Evidência (objetiva)**:
  ```ts
  interface Layer {
      handle: unknown;
      route?: { path: string; methods: Record<string, boolean>; stack: RouteLayer[] };
  }
  for (const layer of (router as unknown as { stack: Layer[] }).stack) { ... }
  ```
  A própria ADR-0053 reconhece o risco: "O teste de cobertura depende da forma interna do Express 5 (`router.stack`). Se ela mudar, o teste quebra alto; o teste comportamental por linha é a segunda rede."
- **Impacto técnico**: um upgrade do Express (ou de qualquer middleware que reestruture o router) quebra as 85 asserções de introspecção de uma vez, mesmo que o comportamento de autorização continue correto — ruído de manutenção, não sinal de bug. O risco é mitigado (não é P1) porque a segunda rede (346 casos comportamentais via HTTP real) continua provando o comportamento mesmo se a introspecção quebrar.
- **Impacto de negócio**: custo de manutenção concentrado num único upgrade de dependência, não risco de produção silencioso — a suíte falha alto, como o próprio ADR projeta.
- **Métrica de baseline**: 1 teste de introspecção cobrindo as 85 rotas via `(router as unknown as { stack: Layer[] })`, sem nenhum tipo público do Express que garanta essa forma.

### F-testability-4: Núcleo do cálculo de permissões (`fecho`/precedência) sem teste por propriedade, e `fast-check` não é dependência direta

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (cobertura de espaço de entrada) / Recordable Test Cases
- **Localização**: `src/backend/domain/service/auth/EffectivePermissionCalculator.ts` (85 linhas), `EffectivePermissionCalculator.test.ts` (124 linhas, só exemplos)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "fast-check\|fc\." src/backend/domain/service/auth/EffectivePermissionCalculator.test.ts
  (nenhum resultado)
  $ grep -n "fast-check" src/backend/package.json src/frontend/package.json
  (nenhum resultado — só aparece como dependência transitiva no package-lock.json)
  ```
- **Impacto técnico**: a fórmula `efetivas = fecho(pacote ∪ concedidas) − revogadas` com precedência ("revogar vence conceder") e fecho (`X:executar → X:ver`) é uma álgebra pequena, pura e com invariantes claros (idempotência do fecho, revogar sempre reduz o conjunto, papel + exceção vazia = pacote) — candidata natural a testes por propriedade. Hoje só exemplos fixos cobrem o código (100% de linhas), mas não o espaço combinatório de pacotes × exceções × ordens de aplicação.
- **Impacto de negócio**: um caso de borda não previsto na combinação papel+exceções (ex.: conceder e revogar a mesma permissão via papéis diferentes de origem) só aparece se alguém escrever o exemplo certo à mão.
- **Métrica de baseline**: 0 propriedades testadas; `fast-check` ausente como dependência direta nos dois `package.json` do repositório.

### F-testability-5: Piso de cobertura do frontend não acompanha a qualidade do código novo de auth

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (gate de CI)
- **Localização**: `src/frontend/jest.config.js:41-50`
- **Evidência (objetiva)**:
  ```js
  coverageThreshold: {
      global: { lines: 33, branches: 23, functions: 28 },
      './lib/auth/': { lines: 24 },
  },
  ```
  Medido nesta feature: `lib/auth/PermissoesProvider.tsx` 100% linhas, `components/auth/ExigePermissao.tsx` 100%, `lib/permissoes.ts` 100%, `app/usuarios/EditarAcessoDialog.tsx` 98,96% linhas.
- **Impacto técnico**: o piso `./lib/auth/` de 24% de linhas é 4x menor que o que o código novo já entrega. Uma regressão de cobertura em `PermissoesProvider.tsx` (por exemplo, remover testes ao simplificar o fallback legado do D4) só quebraria o CI se a cobertura caísse abaixo de 24% — um teto de tolerância tão largo que não pega regressão real.
- **Impacto de negócio**: o gate de CI dá falsa sensação de proteção no diretório mais sensível do frontend (permissões que escondem/mostram ação). Já era P2 `testability-3` no follow-up do ciclo anterior (não implementado).
- **Métrica de baseline**: piso `./lib/auth/` = 24% linhas; cobertura real medida no delta ≈ 76% (média ponderada de `AuthProvider.tsx` não incluído nesta amostra + `PermissoesProvider.tsx` 100% + `env.ts`/`safe-return-to.ts`/`transicao.ts` 100%).

## 5. Cards Kanban

### [testability-1] Harness de integração automatizado para a migration 0066 e a guarda R9

- **Problema**
  > A migration 0066 (papéis, pacotes, exceções, trilha) e a guarda de concorrência `AccessRepository.lockAndCheck` (R9 — nunca zero gestores) só foram validadas ao vivo, à mão, num Postgres 16 descartável (idempotência do DDL, guarda do Q3, reverse, 27/27 checagens de repositório, 10/10 corridas concorrentes). Nada disso roda em CI. O mesmo tipo de achado já foi registrado como P1 `testability-1` no ciclo anterior (`auth-email-transicao`, migration 0064 + guarda R11, 20/20 manual) e não foi implementado — esta é a recorrência.

- **Melhoria Proposta**
  > Reaproveitar o padrão que o próprio repositório já usa para `vw_metricas_ciclo` (tactic Sandbox + Recordable Test Cases): criar `src/backend/migrations/0066_auth_permissoes_modulo.integration.test.ts` (DDL do zero, reaplicação idempotente, guarda do Q3, reverse) e `src/backend/domain/repository/auth/AccessRepository.integration.test.ts` (duas transações reais concorrentes chamando `lockAndCheck` para provar a serialização e o 409 do `LastUserManagerError`), ambos usando `METRICAS_CICLO_TEST_DSN`/Postgres do job `backend-sql`. Ampliar o glob do script `test:sql` (`package.json`) e, se necessário, o `testMatch`/`testPathIgnorePatterns` do `jest.sql.config` para incluir `domain/repository/**/*.integration.test.ts`.

- **Resultado Esperado**
  > Testes `*.integration.test.ts` cobrindo `migrations/0066*` e a guarda R9: 0 → pelo menos 2 arquivos, rodando no job `backend-sql` do CI. Corridas concorrentes automatizadas provando "1 sucesso + 1 `LastUserManagerError`": 0 → pelo menos 1 caso determinístico (duas conexões reais, coordenadas por um `pg` client de teste).

- **Tactic alvo**: Sandbox
- **Severidade**: P1
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes de integração sob `domain/repository/auth/` e `migrations/0066*`: 0 → ≥ 2
  - Job `backend-sql` do CI cobrindo auth: ausente → presente
- **Risco de não fazer**: terceira recorrência do mesmo gap no próximo `/feature-tweak` de auth (passo 3, Supabase Auth) — a guarda R9 e a migration ficam sem rede automatizada até um incidente real de "zero gestores" ou DDL não-idempotente em produção.
- **Dependências**: nenhuma; reaproveita infraestrutura já existente (`backend-sql`, `METRICAS_CICLO_TEST_DSN`).

### [testability-2] Trocar os fakes de transação por regex-sobre-SQL por um dublê que valida contrato, não texto

- **Problema**
  > `AccessRepository.test.ts` e `UserRepository.test.ts` implementam a transação falsa despachando por `RegExp.test(sql)` sobre o texto cru da query (`/FOR UPDATE/`, `/FROM app_user u/`, `/app_user_access_event/`...). O teste está acoplado à redação exata do SQL, não ao contrato de entrada/saída; um refactor inócuo do SQL pode casar a branch errada da regex sem que nenhum teste avise.

- **Melhoria Proposta**
  > Trocar o *dispatch* por regex por um identificador estável por consulta — por exemplo, nomear cada `SELECT`/`UPDATE`/`INSERT` com uma tag de comentário fixa (`-- access:lock-ativos`, `-- access:lock-alvo`, `-- access:le-estado`) que o fake casa por igualdade de string, não por regex frouxa sobre a forma do SQL; ou extrair as constantes de SQL (`ACCESS_STATE_SELECT`, etc.) e fazer o fake comparar por referência/import da própria constante em vez de re-derivar um padrão. Mantém o objetivo do teste (provar a ordem trava→leitura→escrita→evento) sem reimplementar um parser de SQL em regex.

- **Resultado Esperado**
  > 0 fakes de transação que despacham por regex sobre o texto do SQL nos testes de `domain/repository/auth/`; contrato de ordem de chamadas (`chamadas` array) continua coberto, agora por comparação estável.

- **Tactic alvo**: Abstract Data Sources
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Arquivos de teste com *dispatch* por regex sobre SQL cru: 2 → 0
- **Risco de não fazer**: o próximo `/feature-tweak` que tocar `ACCESS_STATE_SELECT` (por exemplo, para adicionar filial ao lookup) herda um fake frágil que pode mascarar regressão na guarda R9.
- **Dependências**: nenhuma; pode ser feito junto do card `testability-1`, já que ambos tocam os mesmos arquivos.

### [testability-3] Confirmar rede de proteção da introspecção de rotas contra upgrade do Express

- **Problema**
  > `routePermissions.test.ts` lê `router.stack`/`layer.route.stack`/`layer.route.methods` — estrutura interna não documentada do Express 5. A própria ADR-0053 já registra o risco ("se ela mudar, o teste quebra alto"), mitigado pelo teste comportamental por linha (346 casos via HTTP real), mas não há nada fixando a versão do Express nem um teste de fumaça que avise antes de um upgrade maior.

- **Melhoria Proposta**
  > Adicionar um comentário/():`engines` ou pin explícito da major do Express no `package.json` do backend referenciando este teste, e considerar extrair a introspecção (`introspectar`) para um helper único e testado isoladamente (hoje é lógica de teste, não de produção) para reduzir a chance de um upgrade silencioso via `npm update` sem revisão.

- **Resultado Esperado**
  > Upgrade de major do Express passa a exigir revisão explícita (CI ou changelog) antes de rodar; se `router.stack` mudar de forma, a falha continua alta (já é hoje), mas o time descobre o risco na atualização da dependência, não na primeira execução do CI.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Pin/nota de risco no `package.json`/CI para majors do Express: ausente → presente
- **Risco de não fazer**: baixo — o teste já falha alto e há rede comportamental secundária; o custo é só o tempo de diagnóstico na próxima falha em massa.
- **Dependências**: nenhuma.

### [testability-4] Teste por propriedade para `EffectivePermissionCalculator` (e adicionar `fast-check` como dependência direta)

- **Problema**
  > A álgebra `efetivas = fecho(pacote ∪ concedidas) − revogadas` (fecho `executar → ver`, revogar vence conceder) só tem cobertura por exemplo (100% de linhas, 0 propriedades). `fast-check` não é dependência direta do backend nem do frontend — só aparece transitivamente no lockfile.

- **Melhoria Proposta**
  > Adicionar `fast-check` como `devDependency` de `src/backend/package.json`, e escrever propriedades para `EffectivePermissionCalculator.calcular`: (1) revogar uma permissão nunca aumenta o conjunto efetivo; (2) o fecho é idempotente (`fecho(fecho(S)) === fecho(S)`); (3) toda permissão `X:executar` no resultado implica `X:ver` no resultado; (4) pacote vazio + exceções vazias → conjunto vazio.

- **Resultado Esperado**
  > `fast-check`: dependência transitiva → devDependency direta; propriedades testadas em `EffectivePermissionCalculator`: 0 → ≥ 4.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Propriedades (`fc.assert`) em `EffectivePermissionCalculator.test.ts`: 0 → ≥ 4
- **Risco de não fazer**: baixo no curto prazo (cobertura por exemplo já é 100%); risco cresce quando papéis reais da Columbia (múltiplos pacotes) entrarem em produção e o espaço combinatório deixar de ser trivial de enumerar à mão.
- **Dependências**: nenhuma.

### [testability-5] Subir o piso de cobertura de `./lib/auth/` no frontend para acompanhar o código novo

- **Problema**
  > O `coverageThreshold` do frontend fixa `./lib/auth/` em 24% de linhas, mas o código novo desta feature (`PermissoesProvider.tsx`, `permissoes.ts`) já entrega 100%. O piso não pega regressão real nesse diretório — já era o follow-up P2 `testability-3` do ciclo anterior, ainda não implementado.

- **Melhoria Proposta**
  > Recalibrar `coverageThreshold['./lib/auth/']` no `jest.config.js` do frontend para perto do valor medido hoje (ratchet, não meta aspiracional), seguindo o mesmo padrão já usado no backend (`./http/gracefulShutdown.ts`, etc.: piso = medido, arredondado para baixo).

- **Resultado Esperado**
  > Piso de `./lib/auth/`: 24% linhas → ≥ 70% linhas (valor medido nesta feature, arredondado para baixo).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - `coverageThreshold['./lib/auth/'].lines`: 24 → ≥ 70
- **Risco de não fazer**: uma regressão de cobertura em `AuthProvider.tsx`/`PermissoesProvider.tsx` passa despercebida pelo CI até virar bug em produção.
- **Dependências**: nenhuma; card equivalente já registrado como `testability-3` no follow-up de `auth-email-transicao` — considerar fundir os dois ao invés de duplicar.

## 6. Notas do agente

- Escopo medido por comandos `jest --coverage --testPathPatterns` restritos aos diretórios da feature (não o `npm test -- --coverage` completo, para caber no `--quick`); números batem com a ordem de grandeza do `_shared-metrics.md`.
- Correção ao playbook: `fast-check` **não** é dependência direta deste repositório (nem backend nem frontend) — só aparece transitivamente no lockfile. Ajustar a expectativa em runs futuros.
- Cross-QA: F-testability-1 (Sandbox/live-DB) é o mesmo tipo de gap que **Fault Tolerance** deveria citar para a guarda R9 (última linha de defesa contra zero-gestores) e que **Deployability** deveria citar para o gate de CI antes do deploy da migration 0066. F-testability-4 (Clock injetável) é o mesmo ponto que **Modifiability** deveria citar como acerto (tempo abstraído, não hardcoded).
- F-testability-1 é uma recorrência textual do card `testability-1` do Regis-Review de `auth-email-transicao` (`2026-09-28-1550`) — o consolidator pode querer marcar isso como "follow-up não implementado" em vez de finding novo, dependendo da convenção do `qa-consolidator` para achados recorrentes entre ciclos.
