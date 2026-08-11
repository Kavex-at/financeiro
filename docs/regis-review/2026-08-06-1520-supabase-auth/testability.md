---
qa: Testability
qa_slug: testability
run_id: 2026-08-06-1520-supabase-auth
agent: qa-testability
generated_at: 2026-08-06T15:20:00-03:00
scope: all
score: 6
findings_count: 9
cards_count: 8
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor tocando `feat/supabase-auth` | Roda `npm test` local para saber se sua mudança quebrou algo | Suíte backend (108 arquivos), suíte frontend (26), coverage report, CI GH Actions | Working tree pré-merge; nada commitado; base `origin/main @ 6e03775` | Suíte devolve **sinal claro** (verde = seguro; vermelho = "isto foi minha mudança"); coverage cai o suficiente para reprovar o gate CI quando uma superfície nova nasce descoberta | (a) # testes vermelhos por causa nova = falhas totais - falhas do baseline; (b) tempo para diagnosticar "meu vs. herdado" ≤ 2 min; (c) cobertura por camada não regride vs. `origin/main`; (d) invariantes I-Usuario-1/8/9 caem no `expect(...).toBe(...)` de pelo menos um teste executável |

O cenário concreto do dia: o orquestrador teve de criar um **worktree descartável** em `origin/main`, rodar a suíte inteira e **diffar os nomes** dos testes vermelhos para separar "17 falhas herdadas" de "regressão desta feature". Esse trabalho — que Bass classifica como custo direto de **Limit Non-Determinism** — deveria custar zero segundos para o desenvolvedor. Custou minutos e uma decisão de escopo. Essa é a métrica que este QA persegue.

## 2. Métricas observadas

### Cobertura por camada (backend) — a métrica-mestra deste eixo

Coletada por `npm test -- --coverage --coverageReporters=json-summary` na working tree; agregada por `coverage-summary.json` por diretório-raiz.

| Camada | Arquivos | Lines | Branches | Functions | Status | Alvo |
|---|---:|---:|---:|---:|---|---|
| `domain/service` | 48 | **95.86%** | 76.07% | 95.83% | ✅ | ≥ 88% / 60% (gate atual) |
| `domain/repository` | 19 | 91.01% | 63.85% | 84.19% | ✅ | ≥ 85% / 60% |
| `domain/client` | 21 | 92.28% | 69.80% | 92.41% | ✅ | ≥ 85% / 60% |
| `domain/interface` | 24 | 100.00% | 91.43% | 100.00% | ✅ | ≥ 90% |
| `domain/errors` | 19 | 99.48% | 97.14% | 100.00% | ✅ | ≥ 90% |
| `domain/libs` | 12 | 99.29% | 86.79% | 96.23% | ✅ | ≥ 85% |
| `http` | 13 | 96.12% | 84.62% | 93.33% | ✅ | ≥ 85% |
| `routes` | 4 | **65.99%** | **44.88%** | 62.12% | ⚠️ | ≥ 75% / 55% |
| `services` (legado) | 2 | 65.49% | 51.87% | 73.68% | ⚠️ | ≥ 75% / 55% |
| `jobs` | 1 medido | 78.57% | 65.00% | 25.00% | ❌ | — |
| **Total global** | — | **90.67%** | **70.89%** | **90.51%** | ⚠️ Potemkin | — |

**Fonte:** `src/backend/coverage/coverage-summary.json` (regerado 2026-08-06 nesta working tree).

**⚠️ Leitura crítica do 90.67% — a métrica é Potemkin.** O `jest.config.cjs` do backend **não define `collectCoverageFrom`**, então Jest só instrumenta arquivos **importados por um teste**. Dos 19 arquivos em `jobs/`, **apenas 1 aparece no relatório** (`migrate-users-to-supabase.ts`); os outros 18 (`formar-lotes.ts`, `ingest-extratos.ts`, `ingest-pagamentos.ts`, `ingest-permutas.ts`, `seed-admin.ts`, 14 `probe-*.ts` / `validate-*.ts`) são invisíveis. Dos 7 arquivos em `routes/`, **apenas 4** aparecem. O denominador é o que os testes já tocam, não o código-fonte; a fração é interna, não real. Frontend faz certo com `collectCoverageFrom` explícito (ver linhas 24–31 do `jest.config.cjs`), e por isso a % dele é honesta (34.85%).

### Cobertura por camada (frontend) — honesta

`src/frontend/coverage/coverage-summary.json` (2026-08-06):

| Camada | Arquivos | Lines | Branches | Functions | Status |
|---|---:|---:|---:|---:|---|
| `components/ui` | 23 | 92.00% | 71.43% | 83.53% | ✅ |
| `lib/auth` | 4 | 72.59% | 52.38% | 76.00% | ✅ |
| `app/recebimentos` | 6 | 72.68% | 54.40% | 49.55% | ⚠️ |
| `components/auth` | 5 | 67.21% | 62.50% | 50.00% | ⚠️ |
| `lib/supabase` | 5 | 63.79% | 82.35% | 53.85% | ⚠️ |
| `app/auth` | 3 | 34.07% | 16.67% | 33.33% | ⚠️ |
| `app/permutas` | 22 | **10.45%** | 4.38% | 8.76% | ❌ |
| `app/login` | 1 | **0.00%** | 0.00% | 0.00% | ❌ |
| `app/usuarios` | 4 | **0.00%** | 0.00% | 0.00% | ❌ |
| `app/sispag` | 4 | 0.00% | 0.00% | 0.00% | ❌ |
| `app/docs` | 5 | 0.00% | 0.00% | 0.00% | ❌ |
| **Total** | — | **34.85%** | **21.29%** | **28.31%** | — |

Superfície nova da feature (`/app/usuarios`, `/app/login`): **0% de cobertura** — nenhum teste de componente foi adicionado nem para a tela de admin de usuários (invitar, desativar, reset de senha) nem para o `/login` refeito, ambos criados/tocados nesta PR.

### Sinal do gate: 17 falhas pré-existentes

| Métrica | Valor | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes vermelhos totais backend | **17** | 0 | ❌ | `npm test` |
| Testes vermelhos regressão desta PR | 0 | 0 | ✅ | diff dos nomes vs. `origin/main` (orquestrador) |
| Custo para distinguir (a) de (b) | ~10 min + worktree descartável | 0 s | ❌ | metadados do run |
| Testes vermelhos em CI (`ci.yml` linha 27, `main`) | não medido | 0 | ⚠️ | GH Actions histórico (não consultado) |

### Controlabilidade — seams DI

| Métrica | Valor | Fonte |
|---|---:|---|
| Arquivos de teste com `container.registerInstance` (injetam mocks) | 90 | grep |
| Ocorrências de `container.resolve` em testes (unit) | 59 | grep |
| Arquivos com instantiation direta (`new XService(mock)`) | 220 ocorrências em N arquivos | grep |
| Arquivos de teste que usam `jest.useFakeTimers` | 3 | grep |

Padrão dominante do repo: mock + `container.registerInstance` **antes** do `container.resolve` ou instanciação direta com mocks no construtor — as duas variantes recomendadas pelo CLAUDE.md. Isso é **controle real**; os testes da feature (`http/appUserContext.test.ts`, `domain/service/auth/UserAdminService.test.ts`, `domain/client/SupabaseAdminClient.test.ts`) seguem a doutrina.

### Sandbox — como cada boundary externo é dublado

| Boundary | Como o teste isola? | Evidência |
|---|---|---|
| Supabase Admin API (backend) | `jest.mock('@supabase/supabase-js', () => ({ createClient: ... }))` no topo do teste; resposta canned via `admin.inviteUserByEmail.mockResolvedValue(ok(RAW_USER))` | `domain/client/SupabaseAdminClient.test.ts:20-22` |
| Supabase SSR (frontend) | `jest.mock('@supabase/ssr', () => ({ createServerClient: ... }))` + `getUser` mockado | `__tests__/middleware.test.ts:17-22` |
| JWKS remoto (backend) | `keyResolver` **injetável** no `buildAuthMiddleware(env, keyResolver)`; o teste passa a chave pública gerada localmente e `createRemoteJWKSet` nunca é chamado | `http/auth.ts:172-177` + `http/auth.test.ts:79-85` |
| Conexos ERP (Frente IV e2e) | Servidor Express fake local + `Date.now()`/`new Date()` para timestamps | `routes/recebimentos.e2e*.test.ts` |
| Postgres | Repositórios mockados com `jest.Mocked<T>` no seam DI (services); `PostgreeDatabaseClient` mockado nos tests de repository | grep |

`keyResolver` **injetável** é a única tactic bem executada de Sandbox nova nesta feature (ADR-0030 §6). Sem ela, todo teste de `buildAuthMiddleware` teria que subir um servidor JWKS local ou aceitar chamadas de rede — o que ninguém aguentaria.

### Não-determinismo — inventário

| Fonte de não-determinismo | Contagem em fonte (não-teste) | Comentário |
|---|---:|---|
| `new Date()` / `Date.now()` em `.ts` (excluindo testes) | **279 ocorrências, 47 arquivos** | Alguns services aceitam `now: Date = new Date()` como parâmetro (ex.: `domain/service/permutas/AgingService.ts:17`) — controle parcial. A maioria lê tempo direto no corpo do método (ex.: `RecebimentoNumerarioService.ts:250 dataReferencia: new Date()`), o que **força** o teste a rodar sob `jest.useFakeTimers()` (só 3 arquivos fazem isso) ou aceitar acoplamento ao relógio |
| `crypto.randomUUID` / `randomBytes` / `Math.random` em fonte | **4 arquivos** | Contido; não há `ClockProvider` / `RandomProvider` injetável |
| Chamadas de rede reais em testes unit | **0** | ✅ Boas notícias — `axios.post` / `fetch(url)` só aparecem nos e2e integration com ERP fake local |
| Testes com `beforeAll` acumulando estado (potencial de flake por ordem) | 4 arquivos `*.e2e*.test.ts` | Cada um esnapshotea `process.env` e restaura; o padrão é defensivo mas frágil por design |

### CI

| Métrica | Valor | Alvo | Status |
|---|---|---|---|
| CI roda `npm test -- --coverage` (backend) | Sim, `.github/workflows/ci.yml:27` | Sim | ✅ |
| CI roda `npm test -- --coverage` (frontend) | Sim, linha 46 | Sim | ✅ |
| Gate de cobertura fixado (backend) | global `lines=72, branches=54, functions=78`; `domain/service` `lines=88, branches=60` | Sim | ✅ |
| Gate de cobertura fixado (frontend) | global `lines=20, branches=9, functions=14` | Sim (piso muito baixo, mas explícito) | ⚠️ |
| CI **verde** com 17 falhas locais? | ⚠️ Não medido nesta análise — se está verde, `ci.yml` está silenciosamente ignorando falhas ou o ambiente CI difere do local; se está vermelho, o gate `[backend, frontend] → tag-release` está bloqueado há semanas | Verde | ⚠️ |

⚠️ **Não medível localmente**: histórico de CI em `main`. Requer acesso ao GitHub Actions (log de runs desde `bf0abbc` / `6e03775`). Recomendação: cotejar em `gh run list --workflow=ci.yml --branch=main --limit=20 --json conclusion,createdAt` para decidir se as 17 falhas são "verdes em CI, vermelhas local" (sinal quebrado) ou "vermelhas em CI, tag bloqueada" (release quebrado).

## 3. Tactics — Cobertura no nf-projects

Mapa completo das tactics de Testability em Bass & Clements (3ª ed., cap. 12).

### Control and Observe System State

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | `buildAuthMiddleware(env, keyResolver)` — resolver injetável introduzido para evitar `createRemoteJWKSet` nos testes. `AppUserContextCache.clear()` documentado "Existe para testes e para um eventual reset operacional". `AuthService.signToken` é `private` sem seam de teste. | ⚠️ Parcial | `http/auth.ts:141,172-177`; `AppUserContextCache.ts:81`; `AuthService.ts:66` |
| **Recordable Test Cases** | Nenhum. Não há fixtures gravadas para respostas do GoTrue nem do Conexos; cada arquivo de teste inventa sua própria forma canônica. Os e2e da Frente IV rodam um ERP fake em Express — que é o inverso: gera as respostas de novo a cada rodada. | ❌ Ausente | grep `__fixtures__` — 4 arquivos, todos em `domain/interface/recebimentos/__fixtures__/`; nenhum em `client/` |
| **Sandbox** | Boundary externo dublado via `jest.mock` (`@supabase/supabase-js`, `@supabase/ssr`) + ERP HTTP fake local para Frente IV; DB dublado por mocks de repository em unit tests. | ✅ Presente | ver tabela §2 "Sandbox" |
| **Executable Assertions** | Guardas invariantes executáveis introduzidas nesta feature: `http/auditActor.guard.test.ts` (nenhum arquivo de `routes/` combina `req.user?.sub ?? …`), `http/middlewareWiring.test.ts` (ordem de `app.use()` em `index.ts`), `SupabaseAdminClient.test.ts:181-256` (nenhum `routes/*.ts` referencia `deleteUser`; nenhum arquivo de `frontend/` referencia `SUPABASE_SERVICE_ROLE_KEY`). São o padrão mais valioso desta PR — mas todas usam **string matching em source files**, não teste de comportamento. | ⚠️ Parcial | listados acima |
| **Abstract Data Sources** | `EnvironmentProvider` abstrai `process.env` (regra inviolável #8). Repositórios abstraem SQL. Não há `ClockProvider` / `RandomProvider` — 279 leituras de `new Date()`/`Date.now()` em código de produção. | ⚠️ Parcial | `EnvironmentProvider.ts`; grep de `Date.now` |

### Limit Complexity

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Limit Structural Complexity** | Maior teste da PR: `UserAdminService.test.ts` (501 LOC). Maior teste do repo: `ConexosSubClients.test.ts` (1.651 LOC), seguido de `RecebimentoNumerarioService.test.ts` (1.278). Média de teste OK; a cauda longa (`RecebimentoNumerarioService.ts`, ~1.400 LOC) tem teste ~igual em tamanho, sinal de que o serviço concentra responsabilidades demais. Camadas: `domain/service/` bem coberto (95.86%), `routes/` mal coberto (65.99%). | ⚠️ Parcial | `find … -name '*.test.ts' -exec wc -l` |
| **Limit Non-Determinism** | **Reprovada**. 17 testes falham no cabeçalho e ninguém sabe por quê sem investigar — porque o custo de fazê-lo saltou para o orquestrador humano. `Date.now()`/`new Date()` em 47 arquivos de service sem clock injetável. `jest.useFakeTimers()` em 3 arquivos apenas — dos quais 1 é da feature (`http/appUserContext.test.ts`, que faz certo). Zero rede real em unit tests é o único ponto forte. | ❌ Ausente | ver tabela §2 "Não-determinismo" e F-testability-1, F-testability-6 |

## 4. Findings

### F-testability-1: 17 testes vermelhos permanentes destroem o sinal do gate local

- **Severidade**: **P1**
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `routes/recebimentos.e2e.test.ts`, `routes/recebimentos.e2e.falhas.test.ts`, `routes/recebimentos.e2e.gates.test.ts`, `routes/recebimentos.e2e.retomada.test.ts`
- **Evidência (objetiva)**:
  ```
  origin/main:        17 failed, 1.072 passed, 1.089 total
  feat/supabase-auth: 17 failed, 1.195 passed, 1.212 total
  diff dos nomes:     VAZIO (conjuntos idênticos)

  Uma das mensagens (routes/recebimentos.e2e.retomada.test.ts:820):
    Expected: "settled"
    Received: "error"
    ledger.markErrorCalls[0].data.erroMensagem:
      'com297 Configuracao "NOTA DE DEBITO PAGAMENTO ANTECIPADO" not found —
       set COM297_GCD_NOTA_DEBITO'
  ```
- **Impacto técnico**: Vermelho permanente vira ruído. Um desenvolvedor que roda `npm test` local não consegue distinguir "quebrei algo" de "é o de sempre" sem cotejar contra `main` — foi exatamente o que o orquestrador deste review teve de fazer, num worktree descartável. Se um teste **novo** vermelho aparecer nas próximas semanas, ele será atribuído ao ruído de fundo até que alguém, por acaso, olhe.
- **Impacto de negócio**: O gate de qualidade da Frente IV — a mais crítica em produção (bordero, emissão de NDe, homologação SEFAZ) — está fora do ar como sinal. O ciclo de feature fica dependente de leitura humana de log e de conhecimento tácito.
- **Métrica de baseline**: 17 falhas / 1.212 = **1.4% da suíte permanentemente vermelha**. Custo estimado para novo colaborador diagnosticar "meu vs. herdado" na primeira `npm test`: **≥ 30 min** (subir worktree em `main`, `npm install`, rodar suíte inteira ~60s, diff). Custo atual do time (medido este run): 1 desenvolvedor sênior + 1 orquestrador × N minutos por feature.

### F-testability-2: Cobertura de backend é Potemkin — `collectCoverageFrom` ausente

- **Severidade**: **P1**
- **Tactic violada**: Abstract Data Sources (métrica de progresso não pode depender do que os testes já resolveram tocar)
- **Localização**: `src/backend/jest.config.cjs`
- **Evidência (objetiva)**:
  ```javascript
  // src/backend/jest.config.cjs — SEM collectCoverageFrom
  coverageThreshold: {
      global: { lines: 72, branches: 54, functions: 78 },
      './domain/service/': { lines: 88, branches: 60 },
  },
  ```
  ```
  Direta comparação:
    jobs/ contém 19 arquivos .ts; coverage-summary.json inclui apenas 1
    routes/ contém 7 arquivos .ts; coverage-summary.json inclui apenas 4
    → 90.67% "global" é medido sobre 216 - 24 = ~192 arquivos, não sobre 216
  ```
  O frontend faz certo (`collectCoverageFrom: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', ...]`, `jest.config.cjs:22-30`) — e por isso o número dele é **34.85%**, honesto. Se o backend fosse medido do mesmo jeito, o global cairia meaningfully (todos os `probe-*.ts`, `validate-*.ts` e vários arquivos legado de `services/` entrariam com 0%).
- **Impacto técnico**: O gate `lines=72` do CI está calibrado contra o denominador errado. Adicionar um arquivo novo **sem teste** não faz a % cair porque ele nem é medido; adicionar um arquivo novo **com teste bom** faz a % subir muito mais do que devia. O gate é reformulável para funcionar como pretendido.
- **Impacto de negócio**: Falso senso de segurança arquitetural: "backend está em 90%" — o número que sai do dashboard é irreal, e o time toma decisões com ele.
- **Métrica de baseline**: 216 arquivos-fonte medidos hoje pelo cálculo do orquestrador (`_shared-metrics.md`); coverage-summary inclui **~160** (arquivos `errors/`, `interface/`, `libs/` inflam a lista, mas jobs e routes legado saem). Delta esperado após adicionar `collectCoverageFrom`: **global lines 90.67% → ~78-82%** (estimativa; recalibrar gate).

### F-testability-3: `AuthService.signToken` sem teste direto — a invariante "não emite `iss`" é protegida por uma réplica hand-rolled que pode divergir em silêncio

- **Severidade**: **P1**
- **Tactic violada**: Executable Assertions (a asserção existe, mas não é executada sobre o artefato real)
- **Localização**: `domain/service/auth/AuthService.ts:66-82` (source) vs. `http/auth.test.ts:320-337` (guarda hand-rolled)
- **Evidência (objetiva)**:
  ```typescript
  // AuthService.ts:75 — produção
  return new SignJWT({ role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(username)
      .setAudience(AUTHENTICATED_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(TOKEN_EXPIRATION)
      .sign(secret);

  // http/auth.test.ts:322 — teste (RÉPLICA hand-rolled)
  const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('marilyn.mutafci@kavex.com')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode(HS_SECRET));
  ```
  O comentário do próprio teste declara a preocupação: *"Réplica byte-a-byte de AuthService.signToken — repare na AUSÊNCIA de .setIssuer()"*. Mas se `AuthService.signToken` **adicionar** `.setIssuer(ISSUER)` amanhã (para agradar um analista estático, ou para "consertar um warning"), este teste continua verde porque assina o próprio token. `domain/service/auth/AuthService.ts` **não tem arquivo `.test.ts`** (contraste com `UserAdminService.ts` → `UserAdminService.test.ts`, 501 LOC).

  ```bash
  $ ls domain/service/auth/
  AppUserContextCache.ts
  AuthService.ts               ← SEM teste
  UserAdminService.test.ts
  UserAdminService.ts
  ```
- **Impacto técnico**: A regressão que a PR se anuncia como tendo corrigido — **derrubar todas as sessões vivas ao ligar SUPABASE_URL** — pode voltar em silêncio. O teste guarda a *especificação* do token esperado, não a *implementação real* que produz o token. A anti-regressão está exatamente meio-caminho.
- **Impacto de negócio**: Reintroduzir o `.setIssuer()` = logout global. Se acontece durante o cutover do Supabase, o alarme é 100% dos usuários, ao vivo, em produção — sem teste vermelho no PR que causa o problema.
- **Métrica de baseline**: `domain/service/auth/AuthService.ts` — **0 testes diretos**, 0 arquivos `AuthService.test.ts`. Cobertura do arquivo: medida em `coverage-summary.json` apenas via `routes/auth.test.ts` (que **mocka o AuthService inteiro**), ou seja: cobertura efetiva do `signToken` real ≈ 0%.

### F-testability-4: `jobs/` — 5 jobs de produção, 1 teste

- **Severidade**: **P2**
- **Tactic violada**: Limit Structural Complexity (a existência de código sem espinha-dorsal de teste é a definição de complexidade que cresce sem trava)
- **Localização**: `src/backend/jobs/`
- **Evidência (objetiva)**:
  ```
  Jobs de produção (executados por cron externo ou `.github/workflows/ingest-*.yml`):
    formar-lotes.ts             ← SEM teste
    ingest-extratos.ts          ← SEM teste
    ingest-pagamentos.ts        ← SEM teste
    ingest-permutas.ts          ← SEM teste
    seed-admin.ts               ← SEM teste
    migrate-users-to-supabase.ts + .test.ts   ✅ (adicionado nesta PR)

  Scripts one-shot (probe/validate — aceitáveis sem teste):
    probe-*.ts (10), validate-*.ts (3)
  ```
  Os workflows `.github/workflows/ingest-extratos.yml`, `ingest-permutas.yml`, `ingest-sispag.yml` disparam esses jobs em cron. Uma falha silenciosa em `ingest-extratos.ts` significa "a Frente IV não ingeriu nada hoje" — o painel fica igual e ninguém percebe até o analista abrir para trabalhar.
- **Impacto técnico**: Alteração em ingest job é feita sem safety-net. A única defesa é lint + typecheck + review humano.
- **Impacto de negócio**: Job de ingestão silencioso quebrado = dia inteiro sem entrada de extratos / pagamentos / permutas = trabalho manual no dia seguinte e possível violação de SLA da Frente IV.
- **Métrica de baseline**: 5 jobs de produção × 0 arquivos `.test.ts` = **0 testes**. Contraste: `migrate-users-to-supabase.ts` (novo, desta PR) já nasceu com `.test.ts` que exercita o loop principal e as guardas anti-regressão.

### F-testability-5: Guardas invariantes por string matching são frágeis — refactor em `index.ts` quebra teste sem quebrar comportamento

- **Severidade**: **P3**
- **Tactic violada**: Executable Assertions (a asserção deveria ser sobre comportamento, não sobre bytes de source)
- **Localização**: `http/middlewareWiring.test.ts`, `http/auditActor.guard.test.ts`, `domain/client/SupabaseAdminClient.test.ts:181-256`
- **Evidência (objetiva)**:
  ```typescript
  // middlewareWiring.test.ts:17 — asserção sobre BYTES, não sobre montagem
  const auth = at(source, 'app.use(buildAuthMiddleware(');
  const appUser = at(source, 'app.use(buildAppUserContextMiddleware(');
  const conexos = at(source, 'app.use(conexosIdentityMiddleware)');
  expect(auth).toBeLessThan(appUser);
  expect(appUser).toBeLessThan(conexos);

  // Refatore para:
  //   const authMw = buildAuthMiddleware(authEnv);
  //   const contextMw = buildAppUserContextMiddleware(authEnv);
  //   [authMw, contextMw, conexosIdentityMiddleware].forEach(m => app.use(m));
  // Comportamento IDÊNTICO; teste RED — false positive.
  ```
  A alternativa executável é montar um `express()` de teste com as três middlewares reais e um handler final que espia a ordem em que `req.user`, `req.appUser` e o ALS foram populados. Isso é uma **fake mount**: caro em setup, mas garante que a ordem observada é a ordem que importa (Bass: Sandbox + Executable Assertions).
- **Impacto técnico**: Renomear um símbolo ou fatorar uma constante em `index.ts` faz o teste ficar vermelho falsamente. Ao longo do tempo o time aprende a "corrigir" o teste (dessincronizando a asserção do source), esvaziando a guarda.
- **Impacto de negócio**: Baixo agora — mas a guarda existe para uma invariante alta (ordem de auth). Quando o falso positivo abrir, alguém vai desativar o teste e a guarda vira letra morta.
- **Métrica de baseline**: 3 arquivos de teste dependem 100% de substring matching; 0 alternativa fake-mount para essas invariantes.

### F-testability-6: Não há `ClockProvider`/`RandomProvider` — 279 leituras de tempo em 47 arquivos de source

- **Severidade**: **P2**
- **Tactic violada**: Abstract Data Sources; Limit Non-Determinism
- **Localização**: 47 arquivos em `domain/service/` e `domain/repository/`
- **Evidência (objetiva)**:
  ```
  Total ocorrências:  279 (Date.now / new Date())
  Amostragem:
    domain/service/permutas/AgingService.ts:17    (compute = (dataBase?: Date, now: Date = new Date()) → INJETÁVEL — OK)
    domain/service/recebimentos/RecebimentoNumerarioService.ts:250  (dataReferencia: new Date() — inline, NÃO INJETÁVEL)
    domain/service/recebimentos/RecebimentoNumerarioService.ts:1066 (hoje = new Date() — inline)
    domain/service/auth/AppUserContextCache.ts:56,67                (Date.now() — tolerado por jest.useFakeTimers)
    domain/service/recebimentos/ConexosNdeEmitter.ts:99             (emitidaEm: new Date())
  ```
  O padrão do `AgingService` (parâmetro opcional `now: Date = new Date()`) é o que Bass chama de Abstract Data Sources aplicado a tempo. Mas ele **não está adotado** na maioria dos services. O `AppUserContextCache` funciona porque Jest 30+ intercepta `Date.now()` sob `useFakeTimers()` — mas essa é uma coincidência do runner, não uma tactic arquitetural. Se algum dia a suíte migrar para Vitest ou o TTL virar critical path, a fragilidade aparece.

  ```
  # Test files usando fake timers HOJE:
  domain/service/recebimentos/ProcessoProviderConexos.test.ts
  domain/service/recebimentos/IngestaoTransacoesService.test.ts
  http/appUserContext.test.ts
  ```
  3 de 108 arquivos. Muito mais services **poderiam** estar testando comportamento dependente de tempo se tivessem controle.
- **Impacto técnico**: Testar "o docEspNumero da SN é DDMMYYYY do dia da execução" ou "expira em ≤ 30 s" é ou impossível ou incômodo em muitos services.
- **Impacto de negócio**: A raiz das 17 falhas da Frente IV é parcialmente esta: fixtures de data (`priDtaAbertura: Date.now() - 30 * 24 * 60 * 60 * 1000`) rodam contra código de produção que também lê `new Date()` — janelas de tempo se cruzam de forma diferente conforme o dia.
- **Métrica de baseline**: 279 leituras de tempo em 47 arquivos de fonte; 1 arquivo (`AgingService`) usa parâmetro injetável; 3 arquivos de teste usam fake timers.

### F-testability-7: CI gate `npm test -- --coverage` cru — comportamento com as 17 falhas é indefinido

- **Severidade**: **P1**
- **Tactic violada**: Executable Assertions no gate (o gate precisa produzir um sinal booleano confiável)
- **Localização**: `.github/workflows/ci.yml:27, 46`; `jest.config.cjs` (backend e frontend)
- **Evidência (objetiva)**:
  ```yaml
  # .github/workflows/ci.yml:27
  - run: npm test -- --coverage
  ```
  `jest.config.cjs` do backend só ignora `.integration.test.ts`. Os arquivos vermelhos são `.e2e.test.ts` — **não** ignorados. Duas leituras possíveis:

  (A) CI passa em `main` = as 17 falhas dependem de env vars que existem no runner GH Actions mas não no laptop → **suíte local mente**, diferença silenciosa entre "verde para o time" e "verde para o CI".

  (B) CI falha em `main` = o job `tag-release` (linha 48, `needs: [backend, frontend]`) está bloqueado; a última tag oficial (v0.20.1, `6e03775`) foi criada há semanas e o `chore(release)` desta feature vai bater no gate.

  Sem consultar `gh run list --workflow=ci.yml --branch=main`, **não é possível distinguir**. As duas leituras são achados. Nenhuma é "está tudo bem".
- **Impacto técnico**: O gate CI é o único momento onde "as regras" viram booleano de merge. Se ele mente (A) ou está bloqueado (B), o pipeline `/feature-new` → `/feature-tweak` → PR → merge é ficção.
- **Impacto de negócio**: Ou releases estão bloqueadas há semanas, ou releases têm ido para produção com testes que localmente sempre foram vermelhos.
- **Métrica de baseline**: 17 falhas locais; histórico de CI em `main` não consultado nesta análise (Requer `gh run list`). Recomendação: rodar `gh run list --workflow=ci.yml --branch=main --limit=20 --json conclusion,createdAt` **antes** de fechar este review.

### F-testability-8: Superfície nova de frontend descoberta — `/app/usuarios` e `/app/login` a 0% de linhas

- **Severidade**: **P2**
- **Tactic violada**: (nenhum tactic específica — é coverage bruto na superfície nova da feature)
- **Localização**: `src/frontend/app/usuarios/`, `src/frontend/app/login/`
- **Evidência (objetiva)**:
  ```
  app/usuarios     4 files    lines=0.00%   branches=0.00%   functions=0.00%
  app/login        1 file     lines=0.00%   branches=0.00%   functions=0.00%
  app/auth         3 files    lines=34.07%  branches=16.67%  functions=33.33%
  ```
  `/app/usuarios/` **é o painel novo da admin de usuários** (convidar, cadastrar-com-senha, resetar, ativar/desativar). Cada ação dispara chamadas ao backend novo desta PR (`POST /usuarios/convite`, `POST /usuarios`, `PATCH /usuarios/:id/ativo`). O backend delas tem teste (`routes/usuarios.test.ts`, 304 LOC), a UI zero.

  Contraste com `/app/auth/forgot-password/page.tsx`: existe teste (`__tests__/auth/forgot-password.test.tsx`) que testa a mensagem anti-enumeração — este é o padrão certo, aplicado a **1 tela** e não a **4**.
- **Impacto técnico**: A UI onde o admin **efetivamente revoga** um usuário só é testada por clique manual (QaCoach). Se a tela renderizar o botão errado, ou pedir confirmação da forma errada, o desenvolvedor descobre em produção.
- **Impacto de negócio**: Recorrente: um bug em UI de admin de usuários = admin desativa o usuário errado ou re-ativa um demitido. Consequências vão de "vergonha" a "acesso indevido ao ERP".
- **Métrica de baseline**: 4 arquivos em `/app/usuarios/`, 0% de linhas cobertas. Meta razoável: pelo menos 1 teste-comportamento por página + 1 pelo componente do formulário de convite. Estimativa: 4 arquivos de teste → coverage `/app/usuarios/` de 0% para ~55–65%.

### F-testability-9: `fast-check` não é dependência — Property-Based Testing ausente

- **Severidade**: **P3**
- **Tactic violada**: N/A (tactic estende Executable Assertions; ausência é "não adotada", não "quebrada")
- **Localização**: `src/backend/package.json`, `src/frontend/package.json`
- **Evidência (objetiva)**:
  ```
  Backend devDependencies: @biomejs/biome, @types/aws-lambda, @types/bcryptjs, @types/cors, @types/express,
      @types/jest, @types/multer, @types/node, @types/pg, jest, jest-environment-node, ts-jest,
      tsc-esm-fix, tsx
  # sem fast-check

  Frontend devDependencies: @tailwindcss/postcss, @testing-library/jest-dom, @testing-library/react,
      @testing-library/user-event, @types/jest, @types/node, @types/react, @types/react-dom, eslint,
      eslint-config-next, jest, jest-environment-jsdom, postcss, tailwindcss, ts-jest, tw-animate-css,
      typescript
  # sem fast-check
  ```
  Alvos naturais nesta feature onde propriedade seria mais forte que cases: `extractBearerToken` (todo header malformado devolve `undefined`; todo header bem-formado devolve exatamente o token); `AppUserContextCache.set + get` (para todo `authUserId, ctx`, `get(authUserId)` no mesmo instante retorna `ctx`, e a partir de `expiresAt` retorna `undefined`); `SnPayloadBuilder.ddmmyyyy` (todo `Date` produz string de exatamente 8 dígitos).
- **Impacto técnico**: Baixo agora. É upside — cases descobertos por gerador que ninguém escreveria à mão.
- **Impacto de negócio**: Nenhum imediato.
- **Métrica de baseline**: 0 arquivos usam `fast-check`; 0 propriedades declaradas. Alvo modesto: 3 propriedades em pontos de alto valor (`extractBearerToken`, cache TTL, `ddmmyyyy`) — regressões descobertas por PBT em code-bases desse tamanho: **1–3/ano típico**.

## 5. Cards Kanban

### [testability-1] Reparar as 17 falhas pré-existentes da Frente IV ou remover as suítes vermelhas do gate

- **Problema**
  > 17 testes falham em `origin/main` e em `feat/supabase-auth` com o mesmo conjunto de nomes (`routes/recebimentos.e2e{,.falhas,.gates,.retomada}.test.ts`). Uma das mensagens de erro concretas: `com297 Configuracao "NOTA DE DEBITO PAGAMENTO ANTECIPADO" not found — set COM297_GCD_NOTA_DEBITO`. Um desenvolvedor que roda `npm test` local não consegue distinguir "quebrei algo" de "é o ruído de fundo" sem rodar um baseline em worktree separado — foi o que este próprio review teve de fazer.

- **Melhoria Proposta**
  > Duas rotas mutuamente exclusivas: (a) fixar o env do runner de teste — configurar `COM297_GCD_NOTA_DEBITO=6` e `COM297_GCD_NOTA_DEBITO_NOME` no `beforeAll` das 4 suítes (Sandbox); ou (b) mover as suítes para o padrão `*.e2e.integration.test.ts` (que o `jest.config.cjs` já ignora, linha 8) e criar um script `npm run test:e2e` separado que exige as env vars presentes. Não deixar 17 vermelhos permanentes no path padrão de `npm test`.

- **Resultado Esperado**
  > `npm test` sai com `Tests: 0 failed`. Sinal do gate volta: se uma feature futura quebra algo, o vermelho é atribuível.
  > - Testes vermelhos em `npm test`: **17 → 0**
  > - Tempo p/ diagnosticar regressão desta feature: **≥30 min → ≤2 min**

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P1
- **Esforço estimado**: S (rota b — mover para `.integration.test.ts` é 4 renomeios + 1 npm script) ou M (rota a — configurar env de teste)
- **Findings relacionados**: F-testability-1, F-testability-7
- **Métricas de sucesso**:
  - Testes vermelhos em `npm test` (backend): **17 → 0**
  - Custo humano por review para separar sinal: **~10 min → 0 min**
  - Delta de tempo de suíte: **59 s → ≤ 60 s** (mover suítes cortando ~2s cada é aceitável)
- **Risco de não fazer**: O gate local vira teatro. A próxima regressão real chega a `main` sem alarme.
- **Dependências**: Nenhuma. Cross-QA: Fault Tolerance (as suítes vermelhas são justamente a Frente IV, o modo de falha mais crítico do sistema — cross-check com `qa-fault-tolerance` para não perder cobertura de comportamento quando as suítes forem movidas ou fixadas).

### [testability-2] Adotar `collectCoverageFrom` no backend e recalibrar o gate

- **Problema**
  > O `jest.config.cjs` do backend não define `collectCoverageFrom`, então Jest só instrumenta arquivos importados por um teste. Dos 19 arquivos em `jobs/`, apenas 1 aparece no relatório; dos 7 arquivos em `routes/`, apenas 4. O "90.67% global" é medido sobre um denominador reduzido pelos arquivos que a suíte simplesmente ignora. O gate CI `lines=72` está calibrado contra esse denominador falso: adicionar arquivo sem teste não faz a % cair. O frontend já faz certo (linhas 22–31 do `jest.config.cjs`) — replicar.

- **Melhoria Proposta**
  > Adicionar em `src/backend/jest.config.cjs`:
  > ```javascript
  > collectCoverageFrom: [
  >     '**/*.ts',
  >     '!**/*.test.ts',
  >     '!**/*.integration.test.ts',
  >     '!**/node_modules/**',
  >     '!**/dist/**',
  >     '!jobs/probe-*.ts',
  >     '!jobs/validate-*.ts',
  >     '!index.ts',   // bootstrap; se quiser incluir, aceitar % menor
  > ],
  > ```
  > Rodar `npm test -- --coverage`, medir o novo baseline, e **recalibrar `coverageThreshold.global`** para 3–5 pontos abaixo do medido (padrão do repo, ver linha 42 do config). Documentar o novo baseline no config com o mesmo estilo do comentário atual.

- **Resultado Esperado**
  > Cobertura reportada = cobertura real. Gate CI passa a impedir novos arquivos descobertos.
  > - Global lines (backend, medido): **90.67% (Potemkin) → ~78–82% (real)** — número aproximado; medir na primeira execução com config novo
  > - Arquivos-fonte no denominador: **~160 → ~200** (a diferença é `jobs/` + `services/` legado + arquivos de topo)
  > - Gate CI recalibrado: `lines: 72 → lines: 75-79` (subir para 3 pts abaixo do novo real)

- **Tactic alvo**: Abstract Data Sources (a métrica de progresso não pode depender do que os testes já resolveram tocar)
- **Severidade**: P1
- **Esforço estimado**: S (1 arquivo de config + medir + escrever comentário; ~2h)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Presença de `collectCoverageFrom` no backend: **ausente → presente**
  - Fração de arquivos-fonte instrumentados: `# instrumentados / # arquivos-fonte`: **~74% → 100%**
  - Delta de % lines global após config: reportar
- **Risco de não fazer**: O time toma decisão de "estamos cobertos" contra um número inflado. Próxima feature que enfia código novo em `jobs/` sem teste passa despercebido.
- **Dependências**: Nenhuma. Cross-QA: Deployability (o gate de coverage é o mesmo que trava o `tag-release`; garantir alinhamento com `qa-deployability`).

### [testability-3] Escrever `AuthService.test.ts` — testar o token real, não a réplica

- **Problema**
  > `AuthService.signToken` é o único ponto no repo onde o token HS256 legado é assinado em produção. A propriedade "não emite claim `iss`" — cuja violação derruba todas as sessões vivas quando `SUPABASE_URL` é configurado — é hoje protegida por `http/auth.test.ts:320-337`, mas o teste **assina um token novo** via `SignJWT` hand-rolled (comentário do próprio arquivo: *"réplica byte-a-byte de AuthService.signToken"*). Se `AuthService.signToken` amanhã adicionar `.setIssuer(...)`, o teste continua verde porque não usa o método real. Nenhum arquivo `AuthService.test.ts` existe.

- **Melhoria Proposta**
  > Criar `domain/service/auth/AuthService.test.ts`. Construir `AuthService` com `UserRepository` mockado devolvendo um user com `passwordHash` bcrypt válido; injetar `EnvironmentProvider` que resolve `authJwtSecret`. Chamar `.login()` real e decodificar o token retornado com `jwtVerify(token, secret, { audience: 'authenticated' })` — sem `issuer`. Asserção invariante: `expect(payload.iss).toBeUndefined()`. Em `http/auth.test.ts:320-337`, refatorar o teste para chamar `AuthService.signToken` real (via injeção) em vez de reproduzir manualmente o `SignJWT.…sign(…)`.

- **Resultado Esperado**
  > A invariante "AuthService não emite iss" passa a ser exercida sobre o artefato real.
  > - Cobertura de `AuthService.ts`: **~0% (só via routes/auth.test.ts que mocka o service) → ~95% (unit direto)**
  > - Testes que exercem `signToken` real: **0 → ≥ 3** (feliz, sem hash, sem env)
  > - Testes hand-rolled que replicam o formato do token: **1 → 0** (o de `http/auth.test.ts` passa a chamar o service real)

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (~4h)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Existência de `AuthService.test.ts`: **não → sim**
  - # asserções sobre o token PRODUZIDO por `signToken` (não hand-rolled): **0 → ≥ 3**
  - Teste `accepts a legacy HS256 token with NO iss claim…` passa a usar o service real: **não → sim**
- **Risco de não fazer**: A regressão que motivou toda esta feature volta em silêncio no primeiro refactor que quiser "consertar" o `SignJWT`.
- **Dependências**: Nenhuma. Cross-QA: Security (Bass classifica reintrodução de logout global como confidencialidade+disponibilidade — coordenar com `qa-security`).

### [testability-4] Cobrir os jobs de produção

- **Problema**
  > 5 jobs de produção rodam em cron (`.github/workflows/ingest-*.yml` + Render): `formar-lotes.ts`, `ingest-extratos.ts`, `ingest-pagamentos.ts`, `ingest-permutas.ts`, `seed-admin.ts`. **Nenhum tem `.test.ts`**. A única defesa é lint + typecheck + review humano. Uma falha silenciosa em `ingest-extratos.ts` = a Frente IV sem entrada de extratos até que o analista abra e note o painel vazio.

- **Melhoria Proposta**
  > Um `.test.ts` por job, no padrão do `migrate-users-to-supabase.test.ts` que já existe: mockar o container via `jest.mock('../domain/appContainer.js', () => ({ bootstrapAppContainer: jest.fn().mockResolvedValue(undefined) }))`, registrar as dependências como mocks, chamar a função exportada, asseverar (a) o caminho feliz, (b) idempotência (chamar duas vezes = 1 SELECT + 1 INSERT), (c) fail-closed (dependência lança → job retorna erro identificável, não fica em silêncio).

- **Resultado Esperado**
  > `jobs/` tem safety-net.
  > - `.test.ts` em `jobs/` para jobs de produção: **1/5 → 5/5**
  > - Cobertura de `jobs/` (com `collectCoverageFrom` — depende do card testability-2): reportar (esperado ≥ 60% lines por job)

- **Tactic alvo**: Sandbox + Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: M (5 jobs × ~4-6h cada = ~1 semana)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - # jobs de produção com teste: **1/5 → 5/5**
  - Cobertura média por job: **≥ 60% lines**
- **Risco de não fazer**: Job silencioso quebrado → dia sem ingestão. Cross-QA: Fault Tolerance (jobs falhando silenciosamente é o exato modo de falha de retry, ver `qa-fault-tolerance`).
- **Dependências**: testability-2 (`collectCoverageFrom`) para que a cobertura dos jobs entre no gate.

### [testability-5] Substituir guardas por string matching por guardas fake-mount

- **Problema**
  > `http/middlewareWiring.test.ts` asseverea ordem de middlewares por `source.indexOf('app.use(buildAuthMiddleware(')` — substring literal em `index.ts`. Um refactor equivalente que mude a forma do source (renomear símbolo, extrair `const authMw = buildAuthMiddleware(...)`) quebra o teste sem quebrar o comportamento. Ao longo do tempo o time aprende a "relaxar" essas guardas, esvaziando-as. `http/auditActor.guard.test.ts` e `SupabaseAdminClient.test.ts:181-256` têm o mesmo formato.

- **Melhoria Proposta**
  > Para `middlewareWiring`: montar um `express()` de teste com as três middlewares reais + handler final que captura a ORDEM em que `req.user`, o cache do contexto e o ALS foram populados. Comparar contra a ordem esperada (identidade → autorização → identidade-no-ERP). Isto é uma fake mount e testa comportamento observável, não bytes. Para `auditActor.guard`: manter o teste de source (é anti-regressão semântica), mas **complementar** com um teste comportamental: rodar cada rota de mutação em `routes/*.ts` com um `req.user = { sub: 'UUID', username: 'x@y.com' }` e verificar que a coluna gravada em auditoria é `x@y.com`, nunca o UUID (usando mocks de repository).

- **Resultado Esperado**
  > As guardas invariantes sobrevivem a refactors cosméticos e continuam pegando regressões semânticas.
  > - Testes fake-mount para ordem de middleware: **0 → 1**
  > - Testes comportamentais para "auditActor grava username": **0 → ≥ 4** (permutas, recebimentos, sispag, usuarios)

- **Tactic alvo**: Executable Assertions (sobre comportamento) + Sandbox (fake mount)
- **Severidade**: P3
- **Esforço estimado**: M (~1 semana; a versão fake-mount de middleware wiring exige compreender a wiring do container em ambiente de teste)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - # asserções invariantes que sobrevivem a rename cosmético: relevar antes/depois
  - # bugs detectados por regressão semântica sem edição de teste: reportar após 3 meses
- **Risco de não fazer**: Falso positivo na guarda leva a desativação da guarda leva à volta silenciosa da regressão.
- **Dependências**: Nenhuma.

### [testability-6] Introduzir `ClockProvider` (e opcionalmente `RandomProvider`) injetável

- **Problema**
  > 279 leituras de tempo (`new Date()`, `Date.now()`) em 47 arquivos de service/repository de produção, com apenas 1 arquivo (`AgingService.ts`) usando o padrão `now: Date = new Date()` como parâmetro injetável. Apenas 3 dos 108 arquivos de teste usam `jest.useFakeTimers()`. Testar comportamento dependente de tempo (`docEspNumero = DDMMYYYY(hoje)`, `TTL de 30 s`) é caro ou impossível na maioria dos services.

- **Melhoria Proposta**
  > Criar `domain/libs/clock/ClockProvider.ts` com `@singleton() @injectable()`, expondo `now(): Date` e `nowMs(): number`. Em produção resolve com `new Date()`/`Date.now()`; em testes, `container.registerInstance(ClockProvider, { now: () => FIXED, nowMs: () => 0 })`. Refatorar **os serviços novos primeiro** (`AppUserContextCache`, `RecebimentoNumerarioService.buildSnHeaderPayload`, `IngestaoPermutasService`). Não migrar de uma vez — política de "código que se toca sob `/feature-tweak` adota o provider" (mesmo padrão da dívida de template).

- **Resultado Esperado**
  > Tempo passa a ser controle explícito por injeção.
  > - Services usando `ClockProvider`: **0 → ≥ 5 (progressivo, começando pelos novos)**
  > - Testes de service que exercem lógica dependente de tempo sem `jest.useFakeTimers()`: **0 → ≥ 5**

- **Tactic alvo**: Abstract Data Sources; Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: M (design + primeiros 3 services). Total de migração é XL, mas é feito por `/feature-tweak` no tempo.
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Existência de `ClockProvider`: **não → sim**
  - # services novos que usam o provider (feature `supabase-auth` retroativa): **0 → ≥ 2** (`AppUserContextCache`, `AuthService`)
- **Risco de não fazer**: Débito cresce. Testes futuros ou saltam a lógica dependente de tempo, ou dependem de fake timers que degradam entre runners.
- **Dependências**: Nenhuma. Cross-QA: Modifiability (injetar clock é o padrão canônico dos dois QAs — coordenar com `qa-modifiability`).

### [testability-7] Cobrir a admin de usuários no frontend

- **Problema**
  > `/app/usuarios/` (4 arquivos) e `/app/login/` (1 arquivo) — a superfície nova mais crítica desta feature — está em **0% de cobertura** de frontend. O backend equivalente (`routes/usuarios.test.ts`) tem 304 LOC de testes. A UI onde o admin efetivamente revoga um usuário só é validada por clique manual (QaCoach).

- **Melhoria Proposta**
  > Um `__tests__/usuarios/` com: (1) `convite.test.tsx` — form de convite emite `POST /usuarios/convite` com o payload certo e mostra toast de sucesso/erro; (2) `cadastro-com-senha.test.tsx` — form de cadastro admin manda `POST /usuarios` com `password`, e mostra erro claro se senha < 8 chars; (3) `ativar-desativar.test.tsx` — pedido de confirmação + `PATCH /usuarios/:id/ativo`; (4) `login.test.tsx` — form manda credenciais para `/auth/login`, redirect após sucesso, mensagem after 401. Mockar `fetch` / o helper de API. Rodar sob `jsdom` (default do frontend).

- **Resultado Esperado**
  > `/app/usuarios/` e `/app/login/` ganham safety-net antes que a admin de verdade comece a mexer.
  > - Cobertura `/app/usuarios/`: **0.00% lines → ≥ 55% lines**
  > - Cobertura `/app/login/`: **0.00% lines → ≥ 55% lines**
  > - # testes de componente novos: **0 → 4**

- **Tactic alvo**: Sandbox (mockar fetch) + Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: M (~1 semana)
- **Findings relacionados**: F-testability-8
- **Métricas de sucesso**:
  - Cobertura de linhas em `/app/usuarios/` + `/app/login/`: **0% → ≥ 55%**
  - # testes de comportamento admin: **0 → ≥ 4**
- **Risco de não fazer**: Bug em UI de admin de usuários = admin desativa a pessoa errada em produção.
- **Dependências**: Nenhuma.

### [testability-8] Auditar o histórico de CI em `main` (o que aconteceu com as 17 falhas?)

- **Problema**
  > `.github/workflows/ci.yml:27` roda `npm test -- --coverage`. Localmente 17 testes falham em `main` (`6e03775`). Ou o CI passa (env vars do runner diferem do laptop, e a suíte local está mentindo há semanas), ou o CI falha (o job `tag-release` está bloqueado e o `chore(release): v0.20.1` não deveria existir). Nenhuma das duas hipóteses foi confirmada nesta análise.

- **Melhoria Proposta**
  > Rodar `gh run list --workflow=ci.yml --branch=main --limit=20 --json conclusion,createdAt,headSha,event` e, para o run correspondente a `6e03775`, `gh run view --log-failed` no job `Backend`. Documentar em `ontology/_inbox/testability-ci-audit.md`: (i) se CI passou, listar as env vars do runner que fazem os `e2e` passarem lá (e não local) — este é o desvio a fechar; (ii) se CI falhou, o job `tag-release` está bloqueado — verificar como as tags v0.20.0, v0.20.1 foram criadas.

- **Resultado Esperado**
  > O gate CI volta a ser um sinal booleano confiável — ou fica documentado que ele está ferido e por quanto tempo.
  > - Hipótese A vs B: **indeterminada → determinada**
  > - Se A: variação de env laptop vs CI reconciliada. **1 divergência ambiental → 0**
  > - Se B: bloqueio do `tag-release` reconhecido e caminho de release documentado

- **Tactic alvo**: Executable Assertions (o gate CI tem que produzir sinal booleano)
- **Severidade**: P1
- **Esforço estimado**: S (~2h de auditoria + doc)
- **Findings relacionados**: F-testability-1, F-testability-7
- **Métricas de sucesso**:
  - Estado do CI em `main`: **desconhecido → documentado**
  - Se A: divergência ambiental fechada
  - Se B: rota de release documentada até que testability-1 lande
- **Risco de não fazer**: Continuar mergeando features numa base cujo gate não se sabe se protege.
- **Dependências**: Nenhuma. Cross-QA: Deployability (a corrente `tag-release` bloqueada é achado direto de `qa-deployability` — se ele não pegar, esse card gera o insight).

## 6. Notas do agente

- **Escopo**: medido backend e frontend. `infra/` inexistente (Render + Vercel), então "Environment: Production infrastructure" caiu como não medível — o CI compensa em parte.
- **Não medível**: histórico de CI em `main` (F-testability-7 / [testability-8]). Deixei o card apontando a auditoria concreta com `gh` em vez de chutar.
- **Achados carry-over que NÃO reportei como novos**: os 5 achados listados no `_shared-metrics.md §"Achados JÁ CONHECIDOS"`.
- **Cross-QA detectado**: (a) F-testability-7 sobrepõe com Deployability (gate CI / tag-release); (b) F-testability-6 sobrepõe com Modifiability (`ClockProvider` como injetável); (c) F-testability-3 sobrepõe com Security (logout global é confidencialidade+disponibilidade); (d) F-testability-1 sobrepõe com Fault Tolerance (as suítes vermelhas são justamente Frente IV); (e) F-testability-9 (fast-check) — o dep NÃO está no `package.json`; a menção no prompt do `/regis-review` está desatualizada e vale registrar de volta.
- **Baseline mais importante**: a tabela §2 de cobertura por camada (backend) — é a única métrica que atravessa todos os cards. Reportar antes/depois de cada card contra ela.
