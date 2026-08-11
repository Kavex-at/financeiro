---
type: regis-review-kanban
run_id: 2026-08-06-1520-supabase-auth
total: 42
counts: { p0: 1, p1: 12, p2: 21, p3: 8 }
---

# Kanban — financeiro — 2026-08-06-1520-supabase-auth

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.

---

## P0 — Crítico

### [cutover-rollback-broken] Consertar o rollback documentado da Fase 2 (frontend + backend)

**QA**: Deployability + Modifiability + Security (cross-QA)
**Tactic alvo**: Rollback (Manage Deployment Pipeline) · Defer Binding — configuration files
**Esforço**: S (rota b: honestidade) ou M (rota a: implementar o switch)
**Findings**: F-deployability-1, F-modifiability-6; corroborado pela cadeia HS256/UUID/500 verificada pelo orquestrador

**Problema**
> O ADR-0030 §6 e o `DEPLOY.md` linha 140 declaram que o rollback da Fase 2 é *"uma variável de ambiente na Vercel, sem redeploy do backend"* (mudar `NEXT_PUBLIC_AUTH_PROVIDER` de `supabase` para `legacy`). Três verificações independentes confirmam que a flag é ornamental: `grep -rn NEXT_PUBLIC_AUTH_PROVIDER src/frontend --include='*.ts*'` → **0 hits**; `AuthProvider.tsx:169` chama `supabase.auth.signInWithPassword(...)` **incondicionalmente**. Mesmo se a UI ramificasse, a cadeia de autorização do backend não sobrevive ao rollback: o `sub` de token HS256 legado é o e-mail (`AuthService.signToken`), `appUserContext:169` chama `repository.findByAuthUserId(sub)`, `UserRepository:145` executa `WHERE auth_user_id = $1`, e `migrations/0044:33` cria `auth_user_id UUID` — Postgres rejeita `"marilyn@kavex.com"` como sintaxe UUID inválida e **cada request autenticada vira 500**, não 403 gracioso. A escape-hatch falha exatamente quando é necessária.

**Melhoria Proposta**
> **Rota A (defender a promessa):** (a) `AuthProvider.signIn` inspeciona `process.env.NEXT_PUBLIC_AUTH_PROVIDER` — `supabase` (default) chama GoTrue; `legacy` posta em `POST /auth/login`. `middleware.ts` e `RouteGate` seguem o mesmo switch. (b) `appUserContext` resolve o usuário legado por `username` quando o alg do token verificado é HS256 (não por `auth_user_id`) — evita o cast falhar. Teste E2E cobrindo ambos os ramos + teste unitário garantindo que `sub` do HS256 alimenta a lookup por username. Tactic Bass: **Rollback + Defer Binding — configuration files**.
>
> **Rota B (honestidade):** remover `NEXT_PUBLIC_AUTH_PROVIDER` do `.env.example`; reescrever ADR-0030 §6 e `DEPLOY.md:140` dizendo que *rollback da Fase 2 é revert de PR + Vercel redeploy* (~15 min). Marcar um deployment Vercel pré-`feat/supabase-auth` como *pinned* para promoção rápida. Adicionar teste de deploy documentado no runbook.
>
> Preferência técnica: **A** — sustenta a promessa da ADR e mantém o binding time como "config, não redeploy". Se A não couber na janela, B é aceitável desde que a ADR e o DEPLOY.md sejam corrigidos **antes** da tentativa de Fase 2.

**Resultado Esperado**
> Rollback da Fase 2 funciona no primeiro toggle (rota A) **ou** documentação passa a listar o passo real e um deploy congelado é marcado (rota B). Cada request autenticada com token HS256 legado obtém 200 com `req.user` populado, não 500 por cast UUID inválido.

**Métricas de sucesso**
- Grep por `NEXT_PUBLIC_AUTH_PROVIDER` no código do FE: **0 → ≥ 1** (rota A) OU 0 → 0 com documentação atualizada (rota B)
- Requests autenticadas com token HS256 legado retornam 200/403 (nunca 500 por cast): hoje **~100% viram 500** → alvo **0%**
- Exercício de rollback em staging: falha silenciosa **100% → 0%**
- Tempo de rollback declarado vs. medido: hoje declarado ≤5 min / medido impossível → alvo declarado = medido

**Risco de não fazer**
> Cutover em produção com botão de emergência que não funciona. Modo de falha explícito da feature é "lockout geral" (ontologia). Sob incidente vivo às 3h da manhã, o time gasta minutos-horas descobrindo que o playbook mente sobre onde está o botão de rollback — enquanto ninguém consegue logar.

**Dependências**: nenhuma técnica; decisão de produto (A vs B).

**Status: RESOLVIDO em 2026-08-10 pela ROTA A** (defender a promessa da ADR, em vez de rebaixá-la).

O que foi feito, nas duas pontas da cadeia que o card descreve:

| Elo quebrado | Correção |
|---|---|
| `NEXT_PUBLIC_AUTH_PROVIDER` com 0 leitores | `lib/auth/provider.ts` — leitor único, default `supabase` (um typo NÃO devolve ninguém ao legado). Consumido por `AuthProvider` (`signIn`/`signOut`/bootstrap de sessão), `lib/auth/token.ts` e `middleware.ts` |
| `signInWithPassword` incondicional | `signIn` ramifica: `legacy` → `POST /auth/login` + sessão em `localStorage` (`lib/auth/legacySession.ts`) |
| middleware redirecionaria todo mundo para `/login` sob rollback | `middleware.ts` sai do caminho quando a flag é `legacy` — a sessão legada é invisível ao servidor **por construção**, e `updateSession` estouraria em `MissingSupabaseEnvError` justo quando o Supabase é o problema |
| `sub` legado (e-mail) → `WHERE auth_user_id = $1` (`UUID`) ⇒ **500 por request** | `AuthUser.authScheme` (`'provider' \| 'legacy'`), classificado pelo `iss` — **não pelo `alg`**, senão um projeto Supabase com chaves simétricas cairia no lookup errado. `appUserContext` roteia para `findByAuthUserId` ou `findContextByUsername` |
| nenhuma guarda estrutural | `findByAuthUserId` recusa subject não-UUID e devolve `null` + warn: uma classificação errada custa **403 diagnosticável**, nunca 500 |
| revogação alcançava só uma identidade | `setAtivo` invalida as **duas** chaves de cache (provedor e `legacy:<username>`) — durante as fases 2–3 a mesma pessoa tem duas sessões possíveis |

Guardas de regressão: `http/auth.test.ts` (3 casos de classificação), `http/appUserContext.test.ts`
(bloco `token LEGADO`, incluindo *"NUNCA chama o lookup por auth_user_id"*), `UserRepository.test.ts`
(guarda de UUID sem tocar o banco), `UserAdminService.test.ts` (dupla invalidação),
`__tests__/auth/legacy-provider.test.ts` e `__tests__/middleware.test.ts` (a flag decide o caminho).

**Métricas do card:** leitores da `NEXT_PUBLIC_AUTH_PROVIDER` no FE **0 → 1** (`lib/auth/provider.ts`,
deliberadamente o único — a flag tem um dono), consumido via `isLegacyAuth()` por **3** arquivos de
origem (`AuthProvider.tsx`, `token.ts`, `middleware.ts`); request autenticada com token HS256 legado
**500 → 200/403**.

---

## P1 — Alto

### [security-1] Subir `next` para ≥16.3.0 e `postcss` para ≥8.5.23 (fecha bypass de middleware + SSRF + leitura de source-map)

**QA**: Security
**Tactic alvo**: Verify Message Integrity · Authenticate Actors · Limit Exposure
**Esforço**: S (≤1d — inclui verificação de build e regressão do `middleware.test`)
**Findings**: F-security-1, F-security-2

**Problema**
> `next@16.2.7` e `postcss@8.5.8` estão como dependências diretas no frontend com **6 CVEs HIGH em Next.js** — incluindo um **bypass de middleware** do App Router (`GHSA-6gpp-xcg3-4w24`), que é exatamente o mecanismo que esta feature usa para proteger rotas antes da hidratação. `postcss` tem CVSS 7.5 de leitura arbitrária de arquivos via `sourceMappingURL`. Ambos têm `fixAvailable: true`. As 2 SSRF do Next (`GHSA-p9j2-gv94-2wf4`, `GHSA-89xv-2m56-2m9x`) transformam o Vercel em pivô server-to-server contra Admin API do GoTrue e Conexos.

**Melhoria Proposta**
> `npm audit fix` no `src/frontend/`. Se o major bump quebrar algo, subir com `--force` só depois de rodar `npm run typecheck && npm run lint && npm test && npm run build`. Reajustar `middleware.test` se a API do matcher mudar.

**Resultado Esperado**
> `middleware bypass` fecha o vetor que anulava o `updateSession` server-side; `postcss` deixa de ler `.map` arbitrários no runner Vercel.

**Métricas de sucesso**
- Frontend `npm audit high`: 6 → 0
- Frontend `npm audit` total: 7 → ≤ 1
- `next` versão: 16.2.7 → ≥ 16.3.0

**Risco de não fazer**
> Cada semana de exposição do bypass anula o `updateSession` server-side; SSRF do Next.js vira pivot para o Admin API do GoTrue com o `SUPABASE_SERVICE_ROLE_KEY`.

**Dependências**: Nenhuma.

---

### [security-2] Subir `axios` para ≥1.18.0 no backend (fecha DoS/prototype pollution na comunicação com Conexos/BCB)

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: derivado do metric §2 (mesma família de F-security-1/2, backend)

**Problema**
> `axios@1.16.1` é dependência direta do backend (usada por `ConexosClient` e `BcbClient`). Três CVEs abertos: `GHSA-42h9-826w-cgv3` (DoS por recursão), `GHSA-xj6q-8x83-jv6g` (prototype pollution injetando Basic Auth), `GHSA-pmv8-rq9r-6j72` (DoS por deep formToJSON). Todos em `<1.18.0`, `fixAvailable: true`.

**Melhoria Proposta**
> `npm audit fix` no `src/backend/`. Rodar `npm test` — a suíte cobre 1.212 casos.

**Resultado Esperado**
> `axios` HIGH direta sai. Versão ≥ 1.18.0.

**Métricas de sucesso**
- `axios` versão: 1.16.1 → ≥ 1.18.0
- Backend `npm audit high` direta: 1 → 0

**Risco de não fazer**
> `POST /permutas` faz milhares de calls ao Conexos por request; DoS por recursão no `axios` é trivialmente atingível por resposta hostil.

**Dependências**: Nenhuma.

---

### [phase3-gate-enforced] Fechar o gate da Fase 3 no código, não na disciplina humana

**QA**: Fault Tolerance + Deployability (cross-QA)
**Tactic alvo**: Condition Monitoring · Verifiable preconditions
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-deployability-2 (mesma raiz)

**Problema**
> O flip de `AUTH_LEGACY_LOGIN_ENABLED=false` no Render enquanto `listPendingMigration()` não estiver vazia deixa esses usuários sem NENHUM caminho de login: rota `/auth/login` responde 410, Supabase não conhece o usuário. Hoje o gate é (i) um `console.warn` no CLI do job `migrate-users-to-supabase.ts:121` e (ii) um comentário em `authEnv.ts:44`. Nada impede uma edição do dashboard sem passar pelo CLI. Modo de falha nomeado na ontologia como *"lockout geral"*.

**Melhoria Proposta**
> Fail-fast no `bootstrapAppContainer`: quando `legacyLoginEnabled === false`, executar `SELECT COUNT(*) FROM app_user WHERE auth_user_id IS NULL AND ativo = true`; se > 0, `process.exit(1)` com mensagem `PHASE3_GATE_OPEN=false: N users still pending migration`. A health-check do Render impede a promoção. Alternativa complementar: `POST /auth/login` degrada para "aceita legado com alarme" enquanto houver pendentes. Cobrir com teste de integração no `authEnv.test.ts`.

**Resultado Esperado**
> Impossível colocar o sistema em estado de lockout via toggle de dashboard: boot recusa config incoerente.

**Métricas de sucesso**
- Guards de código impedindo Fase 3 prematura: **0 → 1**
- Teste que reproduz o cenário: **ausente → presente**
- Cenário "flag=false com pendentes" → hoje promove e derruba login; alvo boot falha

**Risco de não fazer**
> No dia do cutover alguém flipa a flag antes do gate; N usuários ficam sem login até religarem o legado.

**Dependências**: `initDatabaseAndMigrate` já ter rodado no `bootstrapAppContainer` (garantido).

---

### [availability-1] Blindar o fetch do JWKS com cache persistido + retry + observabilidade

**QA**: Availability + Performance (cross-QA)
**Tactic alvo**: Retry · Passive Redundancy · Monitor
**Esforço**: M (2–5d)
**Findings**: F-availability-1

**Problema**
> `createRemoteJWKSet(new URL(...))` em `http/auth.ts:176` usa todos os defaults da `jose` (`timeoutDuration=5s`, `cooldownDuration=30s`, `cacheMaxAge=10min`) e não é envolvido em `RetryExecutor`. Quando o cache expira coincidindo com indisponibilidade do endpoint JWKS, TODO tráfego ES256 volta 401. Blast radius = 100% do tráfego autenticado do sistema.

**Melhoria Proposta**
> (1) Passar `options` explícitas: `cacheMaxAge: 3_600_000` (1h) e `cooldownDuration: 10_000` (10s). (2) Envolver `jwtVerify(token, jwks, jwksOptions)` do path assimétrico em `RetryExecutor` (`retries: 2, delayMs: 300, jitterMs: 300, shouldRetry` restrito a `errors.JWKSNoMatchingKey` e erros de rede — nunca `errors.JWSInvalid`). (3) Persistir `jose.jwksCache` num valor no filesystem/Redis para sobreviver a restart. (4) Instrumentar `jose.jwks()` num log periódico expondo "idade do cache".

**Resultado Esperado**
> Janela de indisponibilidade do JWKS ≤ 10s absorvida sem 401. Sistema tolera até `cacheMaxAge = 1h` de indisponibilidade contínua para tokens com `kid` já visto.

**Métricas de sucesso**
- `cacheMaxAge` do JWKS: 600.000 ms → 3.600.000 ms
- Retries envelope no path ES256: 0 → 2
- Cache persistido: ausente → presente
- Log estruturado "JWKS idade": ausente → 1 linha por hora

**Risco de não fazer**
> Um deploy Supabase rotacionando chaves + falha do JWKS por 90 s = outage de 100% da autenticação; operador descobre pelo suporte.

**Dependências**: Nenhuma.

---

### [availability-3] Absorver soluços curtos do Postgres no `appUserContext` (Retry + Degradation controlada)

**QA**: Availability
**Tactic alvo**: Retry · Exception Handling · Degradation
**Esforço**: S (≤1d)
**Findings**: F-availability-3

**Problema**
> `appUserContext.ts:169` chama `repository.findByAuthUserId(sub)` sem envelope de retry local; throw sobe para `errorMiddleware` como 500 opaco. Cache absorve apenas `sub`s já vistos. Usuário logando durante um soluço do Postgres recebe 500 no exato momento em que o resto do time (com cache quente) continua trabalhando.

**Melhoria Proposta**
> (1) Envolver `findByAuthUserId` num `RetryExecutor(retries: 2, delayMs: 200, jitterMs: 200)`. (2) Em falha final, responder **503** com `Retry-After: 5` em vez de 500. (3) Instrumentar contador de cache-hit ratio (log periódico ou `/health/cache`).

**Resultado Esperado**
> Soluços de ≤400 ms do Postgres passam invisíveis. Indisponibilidade real vira 503+retryable, não 500 fatal.

**Métricas de sucesso**
- Retries no middleware `appUserContext`: 0 → 2
- Código HTTP de indisponibilidade: 500 → 503 + `Retry-After`
- Cache-hit ratio: não medido → 1 log por 60s

**Risco de não fazer**
> Janela em que "logo o time inteiro cai" no login concentra 500 nos usuários mais visíveis do dia (abrir do dia financeiro).

**Dependências**: Nenhuma.

---

### [deployability-3] Completar o `DEPLOY.md §3` (Vercel) com as 3 vars Supabase reais

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (≤1h)
**Findings**: F-deployability-3

**Problema**
> A tabela §3 do `DEPLOY.md` lista apenas `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_ENV`. Faltam `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (obrigatórias — `MissingSupabaseEnvError`) e `NEXT_PUBLIC_AUTH_PROVIDER` (rollback Fase 2 — ver `cutover-rollback-broken`). Deploy seguindo a tabela crasha na 1ª request de middleware.

**Melhoria Proposta**
> Reescrever a tabela §3 incluindo as vars faltantes marcadas como **obrigatórias**. Sincronizar com o checklist §1 e com `.env.example` do frontend. Adicionar teste de contrato em `readSupabasePublicEnv` que lista as vars num único ponto.

**Resultado Esperado**
> Zero divergência entre tabela `DEPLOY.md §3`, `.env.example` e `src/frontend/lib/supabase/env.ts`.

**Métricas de sucesso**
- Vars listadas em `DEPLOY.md §3`: 3 → 6
- Divergência tabela vs código: 100% → 0%

**Risco de não fazer**
> Deploy Fase 2 num sábado à noite gasta 15 min descobrindo `MissingSupabaseEnvError` no log da Vercel.

**Dependências**: se `cutover-rollback-broken` escolher rota B, remove `NEXT_PUBLIC_AUTH_PROVIDER` da tabela.

---

### [ci-signal-audit-and-fix] Restabelecer o sinal do gate CI (auditar histórico + arrumar as 17 falhas persistentes)

**QA**: Testability + Deployability (cross-QA)
**Tactic alvo**: Limit Non-Determinism · Executable Assertions no gate
**Esforço**: S (auditar) + M (arrumar fixtures)
**Findings**: F-testability-1, F-testability-7, F-deployability-5 (mesma origem)

**Problema**
> 17 testes falham em `origin/main` e em `feat/supabase-auth` com o mesmo conjunto (`routes/recebimentos.e2e{,.falhas,.gates,.retomada}.test.ts`). Fixtures dependentes de data (`docEspNumero: "06082026"`). Um dev não consegue distinguir "quebrei algo" de "é o de sempre" sem worktree em `main`. Adicionalmente, `.github/workflows/ci.yml:27` roda `npm test -- --coverage` sem `continue-on-error`; ou CI passa (env vars do runner diferem do laptop, e a suíte local mente) ou CI falha (o job `tag-release` está bloqueado e as tags `v0.20.x` foram criadas mesmo assim). `render.yaml:12-16` declara branch protection como o gate.

**Melhoria Proposta**
> **Passo 1 (auditoria — S):** rodar `gh run list --workflow=ci.yml --branch=main --limit=20 --json conclusion,createdAt,headSha,event` e, para o run correspondente a `6e03775`, `gh run view --log-failed` no job `Backend`. Documentar em `ontology/_inbox/testability-ci-audit.md` qual das hipóteses vale (A: env var do runner mascara / B: CI vermelha há semanas).
>
> **Passo 2 (correção — M):** duas rotas mutuamente exclusivas — (a) estabilizar as 4 suítes por congelamento de relógio (`jest.useFakeTimers({ now: '2026-08-06T00:00:00Z' })`) + configurar env `COM297_GCD_NOTA_DEBITO=6` no `beforeAll`; ou (b) renomear para `.e2e.integration.test.ts` (padrão já ignorado pelo `jest.config.cjs:7`) e criar `npm run test:e2e` separado que exige as env vars.

**Resultado Esperado**
> `npm test` sai com `Tests: 0 failed`. Estado do CI em `main` documentado — ou continua verde e sabemos por quê, ou fica vermelho até (a) landing.

**Métricas de sucesso**
- Testes vermelhos em `npm test` (backend): 17 → 0
- Custo humano p/ separar sinal por review: ~10 min → 0
- Estado do CI em `main`: desconhecido → documentado
- Se A: variação laptop vs CI reconciliada
- Se B: rota de release documentada até (a) landing

**Risco de não fazer**
> Continua mergeando features numa base cujo gate não se sabe se protege. Próxima regressão real de auth chega em `main` sem alarme.

**Dependências**: Nenhuma técnica.

---

### [testability-2] Adotar `collectCoverageFrom` no backend e recalibrar o gate

**QA**: Testability + Deployability (cross-QA — o gate é o mesmo do `tag-release`)
**Tactic alvo**: Abstract Data Sources
**Esforço**: S (≈2h — 1 arquivo de config + medir + escrever comentário)
**Findings**: F-testability-2

**Problema**
> `src/backend/jest.config.cjs` **não define `collectCoverageFrom`**, então Jest só instrumenta arquivos importados por um teste. Dos 19 arquivos em `jobs/`, apenas 1 aparece; dos 7 em `routes/`, apenas 4. O "90.67% global" é medido sobre denominador reduzido pelos arquivos que a suíte ignora. Gate CI `lines=72` está calibrado contra número irreal. Frontend faz certo (`collectCoverageFrom` explícito) e reporta 34.85% honesto.

**Melhoria Proposta**
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
>     '!index.ts',
> ],
> ```
> Rodar `npm test -- --coverage`, medir novo baseline, recalibrar `coverageThreshold.global` para 3–5 pontos abaixo do medido.

**Resultado Esperado**
> Cobertura reportada = cobertura real. Gate CI passa a impedir novos arquivos descobertos.

**Métricas de sucesso**
- Presença de `collectCoverageFrom` no backend: ausente → presente
- Fração de arquivos-fonte instrumentados: ~74% → 100%
- Global lines (backend, medido): 90.67% (Potemkin) → ~78–82% (real)
- Gate CI recalibrado: `lines: 72 → lines: 75-79`

**Risco de não fazer**
> Time toma decisão de "estamos cobertos" contra número inflado. Próxima feature que enfia código em `jobs/` sem teste passa despercebida.

**Dependências**: Nenhuma.

---

### [testability-3] Escrever `AuthService.test.ts` — testar o token real, não a réplica hand-rolled

**QA**: Testability + Security (cross-QA)
**Tactic alvo**: Executable Assertions
**Esforço**: S (≈4h)
**Findings**: F-testability-3

**Problema**
> `AuthService.signToken` é o único ponto no repo onde o token HS256 legado é assinado em produção. A propriedade "não emite claim `iss`" — cuja violação derruba todas as sessões vivas quando `SUPABASE_URL` é configurado — é hoje protegida por `http/auth.test.ts:320-337`, mas o teste **assina um token novo** via `SignJWT` hand-rolled ("réplica byte-a-byte de AuthService.signToken"). Se `AuthService.signToken` adicionar `.setIssuer(...)` amanhã, o teste continua verde. **Nenhum `AuthService.test.ts` existe**. É o mesmo vício que originou o bug que a feature veio corrigir.

**Melhoria Proposta**
> Criar `domain/service/auth/AuthService.test.ts`. Construir `AuthService` com `UserRepository` mockado devolvendo user com `passwordHash` bcrypt válido; injetar `EnvironmentProvider` resolvendo `authJwtSecret`. Chamar `.login()` real e decodificar o token com `jwtVerify(token, secret, { audience: 'authenticated' })` — sem `issuer`. Asserção invariante: `expect(payload.iss).toBeUndefined()`. Em `http/auth.test.ts:320-337`, refatorar o teste para chamar `AuthService.signToken` real (via injeção) em vez de reproduzir `SignJWT.….sign(…)`.

**Resultado Esperado**
> A invariante "AuthService não emite iss" passa a ser exercida sobre o artefato real.

**Métricas de sucesso**
- Existência de `AuthService.test.ts`: não → sim
- # asserções sobre o token PRODUZIDO por `signToken` (não hand-rolled): 0 → ≥ 3
- Cobertura de `AuthService.ts`: ~0% (só via routes/auth.test.ts que mocka) → ~95%

**Risco de não fazer**
> A regressão que motivou toda esta feature volta em silêncio no primeiro refactor que quiser "consertar" o `SignJWT`.

**Dependências**: Nenhuma.

---

### [conexos-fallback-observable] Instrumentar degradação silenciosa da cadeia Conexos (contador + log estruturado)

**QA**: Integrability + Availability (cross-QA)
**Tactic alvo**: Observability of integration failures · Condition Monitoring · Monitor
**Esforço**: S (≤1d)
**Findings**: F-integrability-3, F-availability-4 (mesma raiz)

**Problema**
> A cadeia identidade→autorização→ERP tem um modo de falha **conhecido, documentado e não observável**: se `req.user.username` deixar de casar com `app_user.username`, as baixas `fin010` continuam saindo — atribuídas ao usuário-robô, sem exceção, sem log de erro, sem alarme (`http/conexosIdentity.ts:18-25`). Único sinal: `/me/conexos-status` (polling humano). Isso quebra silenciosamente I-Usuario-1 ("a baixa `fin010` sai no nome do humano"), que é a razão de existir da feature.

**Melhoria Proposta**
> Em `ConexosSessionResolver.resolve`, quando `platformUsername` estiver **presente** mas `getVinculoConexos` devolver `null` (ou a autenticação Conexos falhar), emitir `console.warn` **estruturado** (JSON: `event: 'conexos_fallback_robot'`, `platformUsername`, `reason: 'vinculo_null' | 'auth_failed'`) e incrementar contador in-memory acessível via `/health/integrations`. Adicionar teste unitário mockando `getVinculoConexos → null`. Manter fail-closed em relação à cadeia (não bloquear a baixa — queda no robô é comportamento aceito).

**Resultado Esperado**
> Divergência entre `req.user.username` e `app_user.username` (ou vínculo Conexos falho) gera **sinal executável**: warning estruturado no drain do Render + contador consultável. QA descobre em minutos, não em semanas.

**Métricas de sucesso**
- Sinais estruturados de degradação da cadeia: 0 → ≥1 (`event: 'conexos_fallback_robot'`)
- Contadores públicos de fallback: 0 → 1 (`conexos_fallback_robot_total{reason}`)
- Log estruturado verificável em teste: 0 → 1

**Risco de não fazer**
> I-Usuario-1 pode ser violada em produção por dias sem detecção; retrabalho manual de re-atribuição de baixas é o mitigador tardio.

**Dependências**: Nenhuma. Cross-QA: pode ser combinado com `fault-tolerance-3` (mesma origem de dor: eventos de degradação não persistidos).

---

### [modifiability-1] Split RecebimentoNumerarioService em pipeline nomeado

**QA**: Modifiability
**Tactic alvo**: Split Module · Increase Semantic Coherence
**Esforço**: L (1–2 semanas — extração incremental com testes E2E cobrindo)
**Findings**: F-modifiability-1

**Problema**
> `RecebimentoNumerarioService.ts` tem 1.536 LOC, 32 métodos (2 públicos, 30 helpers privados). Cada regra nova de SN/NDe passa por leitura completa. Padrão God Service: os 30 helpers são etapas de um pipeline (parse do processo, validação de ACL, montagem SN, chamada `com297`, tratamento de erro, montagem NDe, escrita no ledger).

**Melhoria Proposta**
> **Split Module** dirigido pelo pipeline implícito: extrair `SnPayloadAssembler`, `AclPreflightService` (já parcial em `NumerarioAclChecker`), `NdePayloadAssembler`, `RecebimentoLedgerRecorder` como serviços `@injectable` dedicados. `RecebimentoNumerarioService` fica sendo o **orquestrador** (`processarAlocacao` + `classificarAlocacao`) e chama os 4 novos. Cada extração é PR incremental com o mesmo teste E2E existente por rede de segurança.

**Resultado Esperado**
> `RecebimentoNumerarioService` cai para ≤ 400 LOC. Cada helper ≤ 250 LOC. p95 de LOC em `domain/service/` cai de 776 para ≤ 400.

**Métricas de sucesso**
- LOC de `RecebimentoNumerarioService.ts`: 1.536 → ≤ 400
- # métodos privados: 30 → ≤ 12
- p95 de LOC em `domain/service/`: 776 → ≤ 400

**Risco de não fazer**
> Em 6 meses, cada novo requisito de NDe (regra fiscal, novo tipo de doc) acrescenta 30-80 LOC no mesmo arquivo. Chegando a ~2.000 LOC, review de PR vira leitura por amostragem.

**Dependências**: manter as 4 suítes E2E verdes (hoje falham por fixture datada — ver `ci-signal-audit-and-fix`). Fazer em paralelo é aceitável.

---

### [modifiability-2] Refatorar as 3 funções com complexidade cognitiva ≥ 35 em Permutas

**QA**: Modifiability
**Tactic alvo**: Refactor
**Esforço**: M (2–5d)
**Findings**: F-modifiability-2

**Problema**
> `EleicaoPermutasService.buildCandidata` (65), `GestaoPermutasService` linha 262 (59) e `IngestaoPermutasService` linha 408 (43) concentram 4-5 decisões cada num único lambda. `buildCandidata` orquestra hidratação de detalhe, `ConexosError` handling, avaliação de elegibilidade E roteamento cliente-filtro — cada uma é candidata a extração.

**Melhoria Proposta**
> Extrair helpers privados nomeados por decisão (`hydrateDetalhe`, `avaliarERotear`, `mapearParaCandidata`). Preservar semântica com testes de caracterização existentes.

**Resultado Esperado**
> Nenhuma função `> 25` de complexidade cognitiva em `domain/service/permutas/`.

**Métricas de sucesso**
- Complexidade cognitiva máxima em `domain/service/permutas/`: 65 → ≤ 25
- # warnings `noExcessiveCognitiveComplexity` na frente: 12 → ≤ 5

**Risco de não fazer**
> A próxima regra de elegibilidade cai numa função de complexidade 65 que já passa dos limites do que review de PR captura. Regressão silenciosa mensurável.

**Dependências**: Nenhuma.

---

## P2 — Médio

### [security-3] Parear `AUTH_LEGACY_LOGIN_ENABLED=false` com remoção de `AUTH_JWT_SECRET` (assertion no boot)

**QA**: Security
**Tactic alvo**: Restore · Revoke Access
**Esforço**: S
**Findings**: F-security-3

**Problema**
> Desligar o login legado (Fase 3) não remove a chave que verifica os tokens HS256 já emitidos. Enquanto `AUTH_JWT_SECRET` estiver no ambiente, o `buildAuthMiddleware` aceita qualquer HS256 assinado com ela — janela residual de 12h (TTL do token) e potencialmente indefinida se a chave vazar. Fail-closed do `appUserContext` mitiga hoje (`sub=email` não casa `UUID`), mas a promessa "Fase 3 desliga o legado" é só parcial.

**Melhoria Proposta**
> Assertion no boot: quando `AUTH_LEGACY_LOGIN_ENABLED=false`, `loadAuthEnv()` **exige** `AUTH_JWT_SECRET` ausente E `SUPABASE_URL` presente — crashar se `AUTH_JWT_SECRET` sobreviver ao flip. Documentar no `DEPLOY.md` a sequência (flip flag → aguardar 12h → remover env → redeploy). 4 estados cobertos por `authEnv.test.ts`.

**Resultado Esperado**
> Janela de aceite HS256 pós-cutover ≤ TTL do token (12h), com remoção obrigatória.

**Métricas de sucesso**
- Testes de `authEnv.test.ts` cobrindo os 4 estados: 4/4 passando
- `render.yaml` documenta a ordem

**Risco de não fazer**
> Vazamento de `AUTH_JWT_SECRET` após Fase 3 (snapshot de env compartilhado) reintroduz emissão de tokens fora do provedor sem que ninguém tenha ligado o legado.

**Dependências**: `listPendingMigration()` retornando vazio.

---

### [security-5] Estruturar sinal de rejeições de auth para agregação (Detect Intrusion)

**QA**: Security
**Tactic alvo**: Detect Intrusion
**Esforço**: M
**Findings**: F-security-5

**Problema**
> 401/403 aterrissam em `console.warn` no stdout do Render (`http/auth.ts:222`, `http/appUserContext.ts:94`, `http/auth.ts:283`). Não há métrica emitida, contador, alarme por burst, nem detecção adaptativa por IP/sub. Scanner tentando credenciais roubadas produz linhas de log e nada mais.

**Melhoria Proposta**
> Emitir métrica estruturada (contador rotulado por `outcome` ∈ {`invalid_token`, `expired`, `no_row`, `inactive`, `role_forbidden`} e `route`) e configurar alarme para bursts (> 20 rejeições em 60s por IP/sub).

**Resultado Esperado**
> Scanner varrendo `/forgot-password` acende alarme na 21ª tentativa. Burst de 403 em `requireRole('admin')` vira sinal endereçável.

**Métricas de sucesso**
- 3 pontos de log migrados para métrica com labels
- 1 alarme por burst configurado

**Risco de não fazer**
> No dia do incidente, o único artefato de detecção é `grep` no stdout.

**Dependências**: decisão de observability tool.

---

### [supabase-admin-timeout] Envelopar `SupabaseAdminClient` com timeout + retry curto

**QA**: Fault Tolerance + Availability + Performance (cross-QA)
**Tactic alvo**: Timeout · Bound Execution Times · Recovery (Forward)
**Esforço**: S
**Findings**: F-fault-tolerance-4, F-availability-5, F-performance-3 (mesma raiz)

**Problema**
> Nenhum dos 7 métodos do `SupabaseAdminClient` tem timeout, retry ou fallback explícito (`SupabaseAdminClient.ts:141-144` — `createClient(url, key)` sem `global.fetch` custom). Uma chamada travada segura o request até o default do fetch estourar. Único caminho quente é `resolveInactive` (`appUserContext.ts:122` — aceite de convite, chamada `getUserById(sub)` por request enquanto convite pendente).

**Melhoria Proposta**
> Injetar `fetch` custom com `AbortController` no `createClient({ global: { fetch: fetchWithTimeout(5000) } })`. Envolver especificamente `getUserById` em `RetryExecutor(retries: 2, delayMs: 200, jitterMs: 200, shouldRetry: notFatal)` — jamais retentar `SupabaseUserNotFoundError` nem `SupabaseEmailAlreadyExistsError`. `invite`/`createUser`/`setBanned`/`deleteUser`/`sendRecoveryLink` NÃO ganham retry (não idempotentes) — só timeout.

**Resultado Esperado**
> Latência do caminho `convite_pendente` limitada a 5s por tentativa. Chamadas administrativas auditáveis pelo timeout consistente.

**Métricas de sucesso**
- Timeout no `SupabaseAdminClient`: nenhum → 5s por chamada
- Retries em `getUserById`: 0 → 2
- Retries em `invite/create/setBanned/delete/sendRecovery`: 0 → 0 (preservar)
- Worst-case latência por request de aceite de convite durante incidência GoTrue: ~100s → ~5s

**Risco de não fazer**
> Incidente Supabase de 5 min degrada backend por dezenas de minutos após, com sintoma inespecífico.

**Dependências**: Nenhuma.

---

### [cache-multi-instance-assert] Boot recusa `numInstances > 1` até revisitar `revogacao-de-acesso.md`

**QA**: Security + Fault Tolerance (cross-QA)
**Tactic alvo**: Revoke Access · Condition Monitoring
**Esforço**: S (assert) + observabilidade da métrica é M
**Findings**: F-security-4, F-fault-tolerance-5 (mesma raiz)

**Problema**
> Cache de contexto de autorização é `Map` local ao processo (`AppUserContextCache.ts:28-45`). O próprio arquivo documenta: *"invalidação é local ao processo, e isso só é suficiente porque o backend roda em Render `plan: starter` — instância única. No dia em que houver mais de uma instância, a latência real de revogação vira o TTL cheio — sem erro, sem log, sem alarme."* Business-rule `revogacao-de-acesso.md` deixa de valer em silêncio no dia do primeiro `numInstances: 2`.

**Melhoria Proposta**
> **Assert no boot** — se `RENDER_NUM_INSTANCES` (ou equivalente) > 1, `loadAuthEnv` crasha com mensagem apontando para `business-rules/revogacao-de-acesso.md`. Complementar (opcional): métrica emitida por `AppUserContextCache` (`invalidate` calls, `set(null)` calls).

**Resultado Esperado**
> Escalar horizontalmente para de ser passo silencioso: crash com apontamento para a regra a revisitar. Continuar single-instance é OK e explícito.

**Métricas de sucesso**
- 1 assert no boot cobrindo o cenário multi-instância
- Cobertura de teste do assert: 100%

**Risco de não fazer**
> A regra de revogação vira letra morta no dia do primeiro `numInstances: 2` sem qualquer sinal.

**Dependências**: Nenhuma.

---

### [availability-2] Aprofundar `/health` para incluir `authEnv` + Postgres + JWKS

**QA**: Availability
**Tactic alvo**: Ping/Echo · Removal from Service · Self-Test
**Esforço**: S (≤1d)
**Findings**: F-availability-2

**Problema**
> `/health` em `src/backend/index.ts:73` retorna `{status:'ok'}` sem verificar dependência. Instância cujo `authEnv` boot passou mas cujo Postgres está inalcançável (pool esgotado) ou cujo JWKS foi mal configurado responde 200 no health enquanto responde 500/401 nas rotas reais. Balanceador do Render não consegue tirar essa instância do pool.

**Melhoria Proposta**
> Criar `/health/ready` (readiness) além do `/health` (liveness). Readiness: (a) `SELECT 1` no `PostgreeDatabaseClient` com timeout 2s; (b) `HEAD ${SUPABASE_URL}/auth/v1/.well-known/jwks.json` com timeout 2s se `authEnv.supabaseUrl` setado; (c) `loadAuthEnv()` já executado. Envolver em `RetryExecutor(retries: 1, delayMs: 100)`. Retornar 503 quando qualquer sinal crítico falhar. Manter `/health` bare para liveness.

**Resultado Esperado**
> Operador detecta "up mas quebrado" e age (restart/rollback/alarme).

**Métricas de sucesso**
- Sinais checados no readiness: 0 → 3 (`authEnv`, DB, JWKS)
- Detecção de "up mas quebrado": ausente → presente

**Risco de não fazer**
> Incidente de dependência dura horas sem passar despercebido do dashboard porque `/health` está verde.

**Dependências**: Nenhuma.

---

### [availability-5] Timeout explícito + fallback gracioso no `middleware.ts` do frontend

**QA**: Availability + Performance
**Tactic alvo**: Ignore Faulty Behavior · Degradation
**Esforço**: S (≤1d)
**Findings**: F-availability-6

**Problema**
> `updateSession` (`src/frontend/lib/supabase/middleware.ts:48-50`) chama `supabase.auth.getUser()` sem timeout e sem try/catch. Soluço no GoTrue faz o middleware do Next lançar, e a navegação inteira quebra — todas as rotas não-estáticas. O `RouteGate`/`AuthGuard` client-side (defesa em profundidade documentada) nunca chega a ser exercitado.

**Melhoria Proposta**
> Envolver `getUser()` num `Promise.race` com `AbortController` + timeout 3s. Em timeout OU throw, tratar como "usuário não confirmado neste request" — não redirecionar para `/login` em rota autenticada, mas **deixar a page renderizar** e delegar ao `AuthGuard` client-side. Log estruturado `[middleware] supabase-getuser-timeout`.

**Resultado Esperado**
> Frontend continua navegável durante indisponibilidade curta do GoTrue.

**Métricas de sucesso**
- Timeout em `getUser()`: nenhum → 3s
- Comportamento em falha: 500 do Next → renderização degradada + log

**Risco de não fazer**
> Soluços curtos do GoTrue viram outage de navegação para todo usuário.

**Dependências**: Nenhuma.

---

### [fault-tolerance-2] Reaper de órfãos GoTrue (`auth.users` sem `app_user`)

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile
**Esforço**: M
**Findings**: F-fault-tolerance-2

**Problema**
> A compensação síncrona (`createLocalRowOrCompensate`) cobre o caso "INSERT local falhou". Ela não cobre o crash-window entre `inviteByEmail`/`createUser` e o INSERT local (Render reciclando container, OOM, deploy). Órfão fica em `auth.users`, e-mail é queimado, e não há job periódico que compare os dois lados.

**Melhoria Proposta**
> Job periódico (semanal no rollout, mensal em regime): `SupabaseAdminClient.listUsers()` paginado × `SELECT auth_user_id FROM app_user`. Diff = órfãos. Ação: **não** apagar automaticamente (I-Usuario-3); listar nos logs com `auth_user_id` + `email` + `created_at`. Operador decide entre `deleteUser` e "criar `app_user` manualmente".

**Resultado Esperado**
> Órfãos detectáveis em ≤ 1 semana em vez de "quando alguém tentar cadastrar aquele e-mail".

**Métricas de sucesso**
- Jobs de reconciliação `auth.users` × `app_user`: 0 → 1
- Método `listUsers()` em `SupabaseAdminClient`: ausente → presente

**Risco de não fazer**
> Em incidentes futuros, e-mails queimados sem rastro. Sintoma aparece semanas depois.

**Dependências**: Nenhuma.

---

### [fault-tolerance-3] Persistir `ban_gotrue_ultimo_status` + `desativado_por` em `app_user_evento`

**QA**: Fault Tolerance + Security + Testability (cross-QA)
**Tactic alvo**: Repair State
**Esforço**: M
**Findings**: F-fault-tolerance-3

**Problema**
> `desativarUsuario` reporta `banGoTrue: 'falhou'` no response body, e o `console.warn` some após o restart. UI conhece a degradação por um instante — depois disso, a informação evapora. Follow-up P1 **I-Usuario-7** já aberto (mudanças de estado de `Usuario` não atribuídas) é o container natural; `banGoTrue` é coluna extra que aproveita a mesma migração.

**Melhoria Proposta**
> Tabela `app_user_evento(id, app_user_id, tipo, ator, ban_gotrue_status, criado_em)`. `setAtivo`, `redefinirSenhaDeTerceiro`, `setVinculo` inserem linha (em transação com o UPDATE principal via `withTransaction`). Route `GET /usuarios/:id/eventos` para admins.

**Resultado Esperado**
> `banGoTrue: 'falhou'` deixa de ser sinal efêmero. Consulta pós-incidente retorna lista completa.

**Métricas de sucesso**
- Mutações de `Usuario` com trilha persistida: 1/4 → 4/4
- Coluna `ban_gotrue_status` persistido: ausente → presente

**Risco de não fazer**
> Repete a superfície do follow-up P1 I-Usuario-7 e adiciona superfície nova para degradação.

**Dependências**: converge com follow-up P1 I-Usuario-7 de `_inbox/supabase-auth-regis-followups.md` — implementar juntos.

---

### [fault-tolerance-6] Persistir o relatório de `migrate-users-to-supabase` em tabela dedicada

**QA**: Fault Tolerance
**Tactic alvo**: Repair State
**Esforço**: S
**Findings**: F-fault-tolerance-6

**Problema**
> Se o container Render for reciclado no meio de um `--execute` (deploy no meio do cutover, OOM), o relatório em memória se perde. Idempotência do filtro `auth_user_id IS NULL` garante que a próxima execução pega quem sobrou, mas **não distingue "falhou por hash inválido" de "ainda não tentado"** — a informação diagnóstica é a que se perde.

**Melhoria Proposta**
> Tabela `app_user_migracao_evento(app_user_id, tentado_em, resultado, erro_mensagem)`. O loop insere uma linha por tentativa antes de emitir o log. Novo route/CLI `list-migration-failures` lê a tabela.

**Resultado Esperado**
> Falhas de migração sobrevivem a restart do container.

**Métricas de sucesso**
- Persistência do resultado por usuário: ausente → presente
- Cross-check "usuários bloqueados no primeiro login" ↔ "hash inválido no import": manual → SQL

**Risco de não fazer**
> Rede de segurança da ADR-0030 (reset por e-mail) exige o usuário perceber que não consegue entrar; sem cross-check, correlação é adivinhação.

**Dependências**: Nenhuma.

---

### [deployability-4] Alinhar `.env.example` (backend) com a arquitetura pós-ADR-0030

**QA**: Deployability
**Tactic alvo**: Reproducible builds · Script Deployment Commands
**Esforço**: S (≤1h)
**Findings**: F-deployability-4

**Problema**
> O `.env.example` do backend descreve a arquitetura pré-cutover (`AUTH_JWT_SECRET` como caminho principal; Supabase como *"Legacy … NOT used"*). Não menciona `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `AUTH_LEGACY_LOGIN_ENABLED`. Dev novo termina rodando backend em modo apenas-HS256.

**Melhoria Proposta**
> Reescrever a seção auth. Nova ordem: (1) `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (obrigatórios em prod); (2) `AUTH_LEGACY_LOGIN_ENABLED` (nota "some na Fase 4"); (3) `AUTH_JWT_SECRET` marcado como legacy do rollout.

**Resultado Esperado**
> Onboarding não produz configs incoerentes.

**Métricas de sucesso**
- Vars auth documentadas em `.env.example` alinhadas com `authEnv.ts`: 4 divergências → 0

**Risco de não fazer**
> Regressão de tempo de setup por dev.

**Dependências**: Nenhuma.

---

### [deployability-6] Deep health-check + smoke test pós-deploy

**QA**: Deployability + Availability
**Tactic alvo**: Deployment observability
**Esforço**: M (2-3d — endpoint + workflow + conta de teste)
**Findings**: F-deployability-6, F-deployability-7 (parcial)

**Problema**
> `/health` responde `{status:'ok'}` sem tocar em Postgres/JWKS/GoTrue. Render usa isso para trocar tráfego. Deploy com `SUPABASE_URL` errada, `databaseConnectionString` inválida ou signup ligado passa como "healthy" — primeiro erro só aparece na 1ª request autenticada.

**Melhoria Proposta**
> Adicionar `GET /health/deep` que retorna 200 se e somente se: (1) `SELECT 1` no Postgres; (2) fetch de `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` retorna 200; (3) `supabaseAdmin.listUsers({perPage:1})` retorna 200 (valida `SERVICE_ROLE_KEY`). Workflow `.github/workflows/post-deploy-smoke.yml` disparado por `deployment_status` = success, faz `curl -f https://<backend>.onrender.com/health/deep` + `signInWithPassword` sintético (credencial em GitHub Secrets).

**Resultado Esperado**
> Sinal de deploy passa de "processo Node subiu" para "cadeia identidade + banco + provedor coerentes".

**Métricas de sucesso**
- Dependências verificadas no deploy: 0 → 3
- Presença de smoke test pós-deploy: ausente → presente

**Risco de não fazer**
> Cutover Fase 2 passa com semáforo verde e usuários não conseguem logar.

**Dependências**: conta de teste dedicada no GoTrue de produção (item extra ADR-0030 §10).

---

### [deployability-7] Automatizar verificação dos pré-requisitos Supabase (ADR-0030 §10)

**QA**: Deployability + Security
**Tactic alvo**: Verifiable preconditions
**Esforço**: M (2-4d)
**Findings**: F-deployability-7

**Problema**
> 9 pré-requisitos manuais no painel Supabase, cada um marcado como *"não opcional para produção"*. Nenhum é verificado por código. Item 1 (signup público off) é o mais crítico: se esquecido, qualquer pessoa obtém JWT válido e fail-closed 403 vira única defesa.

**Melhoria Proposta**
> Estender `/health/deep` OU comando one-shot (`npm run verify:supabase`) que verifique: (a) signup público desligado (`POST ${SUPABASE_URL}/auth/v1/signup` sem `service_role` retorna 422/403 em vez de 200); (b) redirect URLs contêm o domínio Vercel de produção; (c) `SUPABASE_URL` corresponde ao `iss` de um token de teste. Itens não-verificáveis via API (templates PT-BR, SMTP custom) ganham checkbox no PR template + assinatura do operador.

**Resultado Esperado**
> Pré-requisitos verificáveis por API deixam de ser disciplina humana.

**Métricas de sucesso**
- Pré-requisitos automatizados: 0/9 → ≥ 3/9

**Risco de não fazer**
> Descoberta de item 1 (signup on) é externa (auditoria/incidente).

**Dependências**: parcialmente sobreposto com `deployability-6` (mesmo endpoint).

---

### [deployability-8] Boot recusa `CONEXOS_CRED_ENC_KEY` ausente/vazia (Carry-over)

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (≤1d)
**Findings**: F-deployability-9

**Problema**
> `render.yaml:74` declara `CONEXOS_CRED_ENC_KEY` como `sync: false`; preencher é ato manual. Se o operador esquecer, o backend sobe, `SecretCipher` fica silenciosamente desabilitado e toda baixa `fin010` sai como robô — sem erro, sem log, sem alarme. Config presente-mas-vazia dá impressão de configurada. **Carry-over pré-existente**, mas ADR-0030 aponta o gap em §10.7 e §11 sem fechá-lo; introdução de `SupabaseAdminClient` + vínculo por usuário torna a inércia da I-Usuario-5 mais visível.

**Melhoria Proposta**
> No `bootstrapAppContainer` (ou no `SecretCipher.init`), se `environment=production` e `CONEXOS_CRED_ENC_KEY` estiver ausente ou não decodificar como 32 bytes base64, boot FALHA com mensagem clara. Alternativa mais suave: `console.warn` **muito ruidoso** a cada baixa `fin010` que caia no robô.

**Resultado Esperado**
> `CONEXOS_CRED_ENC_KEY` inválida em prod deixa de subir.

**Métricas de sucesso**
- Boot em produção com chave ausente/vazia: sobe silenciosamente → falha loud

**Risco de não fazer**
> Trilha de auditoria da baixa continua atribuindo tudo ao robô em produção; auditoria interna perde granularidade.

**Dependências**: Carry-over. O consolidator preserva o histórico.

---

### [integrability-4] Estabelecer política de upgrade das libs `@supabase/*` e caps de versão

**QA**: Integrability + Deployability
**Tactic alvo**: Versioning strategy
**Esforço**: M (2–5d)
**Findings**: F-integrability-4

**Problema**
> 7 arquivos acoplam direto à API de `@supabase/ssr` ou `@supabase/supabase-js` (5 frontend + 1 backend + 1 jest.setup). Versões em caret (`^2.112.2` supabase-js, `^0.12.4` ssr) — minors passam por `npm i` sem revisão. Major (v3) obriga patch coordenado em 6 sites.

**Melhoria Proposta**
> (a) Documentar em `docs/integrations/supabase-upgrade-checklist.md` a lista dos 7 sites + roteiro de smoke-test (login, refresh, forgot-password, reset, signOut). (b) Trocar caret por tilde (`~2.112.2`, `~0.12.4`) e agendar upgrade trimestral. (c) Teste de integração leve (jest-mock com fixtures da forma retornada pelas versões atuais) que quebre se a forma mudar.

**Resultado Esperado**
> Upgrade de major da lib é rotina previsível de meio-dia, não descoberta em produção.

**Métricas de sucesso**
- Sites cobertos por smoke-test documentado: 0 → 7
- Versões pinadas por tilde (`~`) para `@supabase/*`: 0 → 3

**Risco de não fazer**
> Dependência transitiva puxa minor incompatível durante `npm i` de rotina e tela de login quebra.

**Dependências**: Nenhuma.

---

### [performance-1] Trocar `getUser()` por `getClaims()` no `middleware.ts` do Next em ES256

**QA**: Performance + Security (cross-QA — coordenar)
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-1

**Problema**
> O middleware do Next chama `supabase.auth.getUser()` a cada navegação autenticada, e essa função **sempre** faz `GET ${SUPABASE_URL}/auth/v1/user` (verificado em `node_modules/@supabase/auth-js/.../GoTrueClient.js:2698`). Uma navegação = um round-trip HTTP. A mesma lib expõe `getClaims()` que para tokens ES256/RS256 com `kid` valida localmente contra o JWKS cacheado.

**Melhoria Proposta**
> Substituir `supabase.auth.getUser()` por `supabase.auth.getClaims()` no `updateSession`, com fallback para `getUser()` quando `getClaims()` devolve `null` (HS256 legado, ou sem `kid`). Reajustar `__tests__/middleware.test.ts` para cobrir ambos ramos.

**Resultado Esperado**
> Latência p50 do middleware cai de "1 round-trip HTTP à Supabase" (~50-200 ms) para "1 verify de assinatura local" (< 5 ms) enquanto Supabase estiver em ES256.

**Métricas de sucesso**
- Round-trips HTTP à Supabase por navegação Next protegida: 1 → 0 (ES256) / 1 (HS256 fallback)
- Latência p50 do middleware.ts: ~100 ms → < 20 ms (estimativa; medir com Vercel Speed Insights)

**Risco de não fazer**
> Em rollout ES256, analistas percebem cada clique como lento sem que apareça em log.

**Dependências**: Nenhuma. Coordenar com `qa-security` — o mesmo esquema que o backend já faz com JWKS.

---

### [performance-2] Bound do `AppUserContextCache` — cap por contagem + eviction

**QA**: Performance
**Tactic alvo**: Bound Queue Sizes
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> `AppUserContextCache` guarda entradas num `Map` sem limite. A limpeza acontece apenas quando `get()` encontra entrada expirada — entradas de `sub`s que nunca voltam ficam vivas até restart do processo. Caching de `null` (linha 172 de `appUserContext.ts`) é de propósito (evita SELECT por request para `sub` órfão em loop), mas amplifica esse cenário.

**Melhoria Proposta**
> Cap explícito de 10.000 entradas + LRU trivial (insertion order do `Map` JS: `entries.keys().next().value` quando `entries.size >= MAX`). Alternativa: sweep proativo quando cruzar o cap.

**Resultado Esperado**
> Tamanho do Map bounded a ≤10.000 entradas. Uso de memória: ilimitado → ~2 MB.

**Métricas de sucesso**
- Cap superior do cache: ∞ → 10.000 entradas
- Memória do cache (estimada): sem limite → ≤ 2 MB
- Hit rate esperado para time real (~30 analistas): não muda (~96%)

**Risco de não fazer**
> Cliente com bug em produção que faça sign-out/sign-in em loop aumenta o RSS em silêncio. No Render `starter` (~512 MB RAM), pode contribuir para OOM.

**Dependências**: Nenhuma.

---

### [modifiability-3] Extrair orquestração de rotas para serviços de aplicação — Restrict Dependencies real

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies · Encapsulate · Increase Semantic Coherence
**Esforço**: L (1–2 semanas por frente — 3 frentes)
**Findings**: F-modifiability-3

**Problema**
> `routes/permutas.ts`, `routes/recebimentos.ts` e `routes/sispag.ts` importam repositórios e clients diretamente e fazem `container.resolve` de repositórios dentro do handler (58 vezes em 3 arquivos). Handler de `routes/recebimentos.ts:448` tem 90 linhas com pilha inteira do domínio orquestrada na rota. Regra CLAUDE.md "Lambda → Service → Repository → Client" declarada mas não policiada.

**Melhoria Proposta**
> Introduzir **Application Services** (um por rota gorda): `IniciarSolicitacaoNumerarioAppService`, `PermutarAppService`, `CriarLoteSispagAppService`. Rota fica com parse Zod + `service.execute(input)` + tradução de erro. Remover `import Repository from '../domain/repository/*'` de `routes/`.

**Resultado Esperado**
> Rota média em `routes/`: 347 LOC → ≤ 200. `container.resolve` em `routes/`: 108 → ≤ 15.

**Métricas de sucesso**
- # imports layer-skipping em `routes/`: 10 → 0
- # `container.resolve` em `routes/permutas.ts`: 25 → ≤ 5
- Média LOC em `routes/`: 347 → ≤ 200

**Risco de não fazer**
> Qualquer regra transversal (nova ACL, nova auditoria, dry-run global) exige tocar as 3 rotas + os N services.

**Dependências**: PatternGuardian precisa de regra que impeça `routes/` de importar `repository/` ou `client/`. Follow-up já aberto em `ontology/_inbox/`.

---

### [modifiability-5] Split de `buildAppUserContextMiddleware` em decisões nomeadas

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: S (≤1d)
**Findings**: F-modifiability-5, F-modifiability-9

**Problema**
> O middleware retornado por `buildAppUserContextMiddleware` (`http/appUserContext.ts:135`) tem complexidade cognitiva 27. É o middleware que **toda request autenticada** executa — raio máximo. Um dos 3 warnings novos que a feature adicionou.

**Melhoria Proposta**
> Extrair 3 helpers privados: `respondFromCache(cached, req, res)` (retorna `'served' | 'forbid' | 'miss'`), `loadAndDecide(sub, repository, cache)`, `handleInactive`. Handler top-level fica com fluxo: bypass → sub? → cache → load → apply.

**Resultado Esperado**
> Complexidade cognitiva do middleware ≤ 15. 3 warnings novos passam a 2.

**Métricas de sucesso**
- Complexidade cognitiva de `http/appUserContext.ts:135`: 27 → ≤ 15
- # warnings backend: 38 → 37

**Risco de não fazer**
> Próximo requisito (rate-limit por usuário, ban por IP) cai neste mesmo lambda. Complexidade 27 vira 40+.

**Dependências**: Nenhuma. Testes em `appUserContext.test.ts` (415 LOC) protegem semântica.

---

### [testability-4] Cobrir os jobs de produção com `.test.ts`

**QA**: Testability + Fault Tolerance (cross-QA)
**Tactic alvo**: Sandbox · Executable Assertions
**Esforço**: M (5 jobs × ~4-6h cada = ~1 semana)
**Findings**: F-testability-4

**Problema**
> 5 jobs de produção rodam em cron (`.github/workflows/ingest-*.yml` + Render): `formar-lotes.ts`, `ingest-extratos.ts`, `ingest-pagamentos.ts`, `ingest-permutas.ts`, `seed-admin.ts`. **Nenhum tem `.test.ts`**. Única defesa é lint + typecheck + review humano. Falha silenciosa em `ingest-extratos.ts` = Frente IV sem entrada de extratos até o analista notar o painel vazio.

**Melhoria Proposta**
> Um `.test.ts` por job, no padrão do `migrate-users-to-supabase.test.ts`: mockar container via `jest.mock('../domain/appContainer.js', ...)`, registrar dependências como mocks, chamar a função exportada, asseverar (a) caminho feliz, (b) idempotência, (c) fail-closed.

**Resultado Esperado**
> `jobs/` tem safety-net.

**Métricas de sucesso**
- `.test.ts` em `jobs/` para jobs de produção: 1/5 → 5/5
- Cobertura de `jobs/` (com `collectCoverageFrom`): esperado ≥ 60% lines por job

**Risco de não fazer**
> Job silencioso quebrado = dia sem ingestão.

**Dependências**: `testability-2` (`collectCoverageFrom`) para que a cobertura dos jobs entre no gate.

---

### [testability-6] Introduzir `ClockProvider` injetável (progressivo)

**QA**: Testability + Modifiability (cross-QA)
**Tactic alvo**: Abstract Data Sources · Limit Non-Determinism
**Esforço**: M (design + primeiros 3 services; migração total é XL feita por `/feature-tweak`)
**Findings**: F-testability-6

**Problema**
> 279 leituras de tempo (`new Date()`, `Date.now()`) em 47 arquivos de service/repository, com apenas 1 arquivo (`AgingService.ts`) usando o padrão `now: Date = new Date()` como parâmetro injetável. Apenas 3 dos 108 arquivos de teste usam `jest.useFakeTimers()`. Testar comportamento dependente de tempo (`docEspNumero = DDMMYYYY(hoje)`, `TTL de 30 s`) é caro ou impossível na maioria dos services.

**Melhoria Proposta**
> Criar `domain/libs/clock/ClockProvider.ts` com `@singleton() @injectable()`, expondo `now(): Date` e `nowMs(): number`. Em produção resolve com `new Date()`/`Date.now()`; em testes, `container.registerInstance(ClockProvider, { now: () => FIXED, nowMs: () => 0 })`. Refatorar **serviços novos primeiro** (`AppUserContextCache`, `AuthService`, `RecebimentoNumerarioService.buildSnHeaderPayload`). Política de "código que se toca sob `/feature-tweak` adota o provider".

**Resultado Esperado**
> Tempo passa a ser controle explícito por injeção.

**Métricas de sucesso**
- Existência de `ClockProvider`: não → sim
- # services novos que usam o provider: 0 → ≥ 2 (`AppUserContextCache`, `AuthService`)

**Risco de não fazer**
> Débito cresce. Testes futuros ou saltam a lógica dependente de tempo, ou dependem de fake timers que degradam entre runners.

**Dependências**: Nenhuma.

---

### [testability-7] Cobrir a admin de usuários no frontend

**QA**: Testability
**Tactic alvo**: Sandbox · Executable Assertions
**Esforço**: M (~1 semana)
**Findings**: F-testability-8

**Problema**
> `/app/usuarios/` (4 arquivos) e `/app/login/` (1 arquivo) — a superfície nova mais crítica da feature — está em **0% de cobertura**. O backend equivalente (`routes/usuarios.test.ts`) tem 304 LOC de testes. UI onde admin revoga usuário só é validada por clique manual.

**Melhoria Proposta**
> Um `__tests__/usuarios/` com: (1) `convite.test.tsx` — form emite `POST /usuarios/convite` com payload certo; (2) `cadastro-com-senha.test.tsx` — `POST /usuarios` com `password`, erro claro se < 8 chars; (3) `ativar-desativar.test.tsx` — confirmação + `PATCH /usuarios/:id/ativo`; (4) `login.test.tsx` — credenciais para `/auth/login`, redirect após sucesso, mensagem após 401. Mockar `fetch` / helper de API. Rodar sob `jsdom`.

**Resultado Esperado**
> `/app/usuarios/` e `/app/login/` ganham safety-net antes que admin real comece a mexer.

**Métricas de sucesso**
- Cobertura `/app/usuarios/`: 0.00% → ≥ 55% lines
- Cobertura `/app/login/`: 0.00% → ≥ 55% lines
- # testes de componente novos: 0 → 4

**Risco de não fazer**
> Bug em UI de admin de usuários = admin desativa a pessoa errada em produção.

**Dependências**: Nenhuma.

---

## P3 — Baixo

### [security-6] Adicionar health-check ao boot que confirma signup público do Supabase desligado

**QA**: Security
**Tactic alvo**: Limit Exposure · Change Default Settings
**Esforço**: S
**Findings**: F-security-6

**Problema**
> ADR-0030 §10.1 lista "desligar signup público" como o primeiro passo humano bloqueante. Docstring do `appUserContext` reconhece que 403 fail-closed é a **segunda** camada. Ninguém no repositório confirma o estado da primeira. Se signup for religado em produção, qualquer pessoa obtém `aud: 'authenticated'`.

**Melhoria Proposta**
> No `bootstrapAppContainer` (ou passo dedicado), chamar Admin API `GET /auth/v1/settings` e falhar alto se `disable_signup !== true`.

**Resultado Esperado**
> Deploy que herda signup público ligado do Supabase não sobe.

**Métricas de sucesso**
- 1 assert no boot cobrindo `disable_signup=true`
- 1 teste de integração cobrindo a falha

**Risco de não fazer**
> Primeira camada da defesa dupla é 100% operacional; scanner que descobrir signup ligado explora modo degradado do cache.

**Dependências**: `SUPABASE_SERVICE_ROLE_KEY` já configurada.

---

### [integrability-2] Encerrar a forma genérica de `updateUserById` na superfície pública

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforço**: S (≤1d)
**Findings**: F-integrability-5

**Problema**
> `SupabaseAdminClient.updateUserById(id, attributes: Record<string, unknown>)` é `public` mas hoje só existe para servir `setBanned`. Manter a forma genérica pública convida caso de uso futuro a passar bag genérico.

**Melhoria Proposta**
> Tornar `updateUserById` `private` e criar método por caso de uso conforme surgir (ex.: futuro `updateUserEmail(id, email)`).

**Resultado Esperado**
> Superfície pública da Admin API é 100% domain-specific.

**Métricas de sucesso**
- Public methods com forma genérica: 1 → 0

**Risco de não fazer**
> Débito acumula. Em 12 meses, superfície tem 3-4 chamadas passando bags genéricas.

**Dependências**: Nenhuma.

---

### [integrability-3] Consolidar o contrato "iss por caminho" num único ponto canônico

**QA**: Integrability + Modifiability
**Tactic alvo**: Adhere to Standards
**Esforço**: S (≤1d)
**Findings**: F-integrability-6

**Problema**
> A regra "`issuer` é exigido só no verificador JWKS/ES256; `audience: 'authenticated'` em ambos" está documentada em quatro lugares (`http/auth.ts:122-131`, `http/auth.ts:161-163`, `middlewareWiring.test.ts`, `ontology/integrations/supabase-auth.md`) mas nenhum é fonte canônica. Refactor "vou juntar `hsOptions` e `jwksOptions`" derruba todas as sessões legadas.

**Melhoria Proposta**
> Extrair `hsOptions` e `jwksOptions` para função nomeada (`buildVerifyOptionsPerPath`) num arquivo próprio (`http/tokenContract.ts`) com JSDoc canônico. Manter teste de regressão nomeado.

**Resultado Esperado**
> Um único local descreve o contrato.

**Métricas de sucesso**
- `grep -rn "audience: AUTHENTICATED_AUDIENCE" src/backend/http` retorna 1 arquivo
- Teste de regressão nomeado continua verde

**Risco de não fazer**
> Refactor "de limpeza" derruba sessões vivas do login legado durante rollout Fase 3.

**Dependências**: Nenhuma.

---

### [integrability-5] Extrair `DataErrorUnwrapper` para clients Supabase-shape

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-integrability-1 (positiva; este card é o passo natural)

**Problema**
> O padrão `try { return unwrap(op, await client.xxx(...)) } catch → error tipado` é usado 8 vezes em `SupabaseAdminClient`. Uma 7ª integração via `@supabase/*` reintroduziria ~35 LOC de `unwrap`/`hasMarker`/`toGoTrueUser`.

**Melhoria Proposta**
> Criar `domain/libs/http/DataErrorUnwrapper.ts` com `unwrap<T>(op: string, result: {data, error}, markers: {notFound, alreadyExists}): T`. `SupabaseAdminClient` passa a compor.

**Resultado Esperado**
> LOC-infra por novo Supabase-shape client cai de ~35 para ~15.

**Métricas de sucesso**
- `domain/libs/http/DataErrorUnwrapper.ts` existe, testado, exportado
- `SupabaseAdminClient.ts` LOC total: 285 → ≤ 250

**Risco de não fazer**
> Nenhum imediato — puro custo linear se aparecerem mais 2-3 clients no futuro.

**Dependências**: Nenhuma.

---

### [modifiability-4] Mover `auditActor` para o domínio da auditoria; deixar `http/auth.ts` com o que é HTTP

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence · Split Module
**Esforço**: S (≤1d — refactor puro, 28 imports para atualizar via IDE)
**Findings**: F-modifiability-4

**Problema**
> `http/auth.ts` (291 LOC) tem três responsabilidades semanticamente distintas: middleware factory de JWT, `requireRole` (RBAC), `auditActor` (invariante de persistência, I-Usuario-1). O último não é HTTP: é regra de domínio.

**Melhoria Proposta**
> Mover `auditActor` para `domain/libs/audit/auditActor.ts` com o mesmo teste-guarda `auditActor.guard.test.ts` (a assertion varre `routes/` — é sobre a superfície, não a localização do helper). Alinhar o `impl_files` de `business-rules/ator-da-trilha-de-auditoria.md`.

**Resultado Esperado**
> `http/auth.ts` sob 250 LOC, com apenas as duas responsabilidades HTTP.

**Métricas de sucesso**
- `http/auth.ts` LOC: 291 → ≤ 250
- # arquivos com "regra de auditoria" ambígua: 1 → 0

**Risco de não fazer**
> Cumulativo — o dia em que I-Usuario-1 for estendido para SSO Azure AD, o próximo autor cola a extensão no mesmo lugar.

**Dependências**: Nenhuma.

---

### [modifiability-7] Externalizar as 3 constantes de negócio mais susceptíveis a mudança

**QA**: Modifiability + Deployability
**Tactic alvo**: Defer Binding — configuration files
**Esforço**: S (≤1d)
**Findings**: F-modifiability-7

**Problema**
> 12 valores de negócio hardcoded em `domain/service/`. Três particularmente susceptíveis: `MAX_TITULOS_POR_LOTE=25` (regra Bradesco/Nexxera), `CONTA_GER_JUROS=131` / `CONTA_GER_DESCONTO=130` (contas gerenciais do plano do cliente, mudam em virada de ano contábil). Cada mudança hoje = PR + review + deploy.

**Melhoria Proposta**
> Movê-las para `EnvironmentProvider` como campos tipados (`sispagMaxTitulosLote`, `contaGerJuros`, `contaGerDesconto`), lidos via SSM em produção. Não mexer nas outras 9 nesta rodada.

**Resultado Esperado**
> Mudar conta gerencial de juros: env var + restart (segundos) em vez de PR + deploy.

**Métricas de sucesso**
- # constantes numéricas de negócio hardcoded: 12 → ≤ 9
- Tempo real para trocar `MAX_TITULOS_POR_LOTE`: ~30 min → ≤ 5 min

**Risco de não fazer**
> Quando cliente mudar plano de contas em 01/2027, cada mudança vira 1 janela de deploy.

**Dependências**: Nenhuma. `EnvironmentProvider` já é veículo canônico (Inviolable Rule #8).

---

### [performance-4] Estabelecer baseline de bundle browser antes do próximo delta de deps

**QA**: Performance
**Tactic alvo**: Reduce Overhead (via observabilidade prévia)
**Esforço**: S (≤1d)
**Findings**: F-performance-4

**Problema**
> Esta feature adicionou `@supabase/supabase-js` + `@supabase/ssr` ao frontend, mas o repositório **não tem baseline commitado** de bundle browser pré-feature. Sem baseline, cada próxima feature continua sendo "não medível o delta". Build atual: 1.864 KB total em `.next/static/chunks/` (raw), maior chunk 251 KB.

**Melhoria Proposta**
> Ingerir números de `npm run build` (First Load JS por rota + bundle total) num arquivo versionado em `docs/perf/frontend-bundle-baseline.md`, atualizado a cada release.

**Resultado Esperado**
> A partir do próximo run, cada feature que toque deps do frontend produz "bundle antes / depois" mensurável.

**Métricas de sucesso**
- Baseline commitado: ausente → presente e datado
- Delta de bundle atribuível ao `supabase-auth`: hoje "não medível" → registrado retroativamente na próxima release

**Risco de não fazer**
> Cada Regis-Review continua reportando "delta não medível" em perf.

**Dependências**: Nenhuma.

---

### [testability-5] Substituir guardas por string matching por guardas fake-mount

**QA**: Testability
**Tactic alvo**: Executable Assertions · Sandbox
**Esforço**: M (~1 semana)
**Findings**: F-testability-5

**Problema**
> `http/middlewareWiring.test.ts` asseverar ordem de middlewares por `source.indexOf('app.use(buildAuthMiddleware(')` — substring literal em `index.ts`. Refactor equivalente que mude a forma do source quebra o teste sem quebrar o comportamento. `http/auditActor.guard.test.ts` e `SupabaseAdminClient.test.ts:181-256` têm o mesmo formato.

**Melhoria Proposta**
> Para `middlewareWiring`: montar `express()` de teste com as três middlewares reais + handler final que captura a ORDEM em que `req.user`, o cache do contexto e o ALS foram populados. Fake mount. Para `auditActor.guard`: manter o teste de source (anti-regressão semântica) mas **complementar** com teste comportamental: rodar cada rota de mutação com `req.user = { sub: 'UUID', username: 'x@y.com' }` e verificar que a coluna gravada é `x@y.com`.

**Resultado Esperado**
> Guardas invariantes sobrevivem a refactors cosméticos e continuam pegando regressões semânticas.

**Métricas de sucesso**
- Testes fake-mount para ordem de middleware: 0 → 1
- Testes comportamentais para "auditActor grava username": 0 → ≥ 4

**Risco de não fazer**
> Falso positivo na guarda leva a desativação da guarda leva à volta silenciosa da regressão.

**Dependências**: Nenhuma.

---

> Notas finais
>
> - **Achado do `filialAuthz` fail-OPEN** (P1 histórico, carry-over de 6 runs consecutivos) **não gera card** — segue como follow-up em `ontology/_inbox/supabase-auth-regis-followups.md`. Registrado no REPORT.md §7 como sinal de processo.
> - **`CONEXOS_CRED_ENC_KEY` presente-vazia**: absorvido pelo card `deployability-8`.
> - **Dívida Express-vs-Lambda**: aceita (`ontology/_inbox/migration-debt.md`); sem card.
> - **38 warnings `noExcessiveCognitiveComplexity`**: pré-existente; endereçado parcialmente por `modifiability-2` e `modifiability-5`.
> - **F-integrability-1 e F-integrability-2** são observações positivas (evidência de que a feature acertou padrão de encapsulamento e contenção de raio); registrados nas §4/§6 do arquivo do QA e no REPORT §6, sem gerar card corretivo.
> - **F-modifiability-8** (SSO Azure AD — claim da ADR-0030 §5) é uma nota de precisão para futura releitura da ADR, não bug; sem card.
> - **F-modifiability-9** (3 warnings novos de complexidade): 2 aceitáveis (teste-guarda e job com data de morte); o 3º é absorvido por `modifiability-5`.
> - **F-testability-9** (`fast-check` não é dependência): observação; sem card — PBT é upside, não gap.
> - **F-performance-5** (cold-start Render `starter` agravado pela feature) e **F-performance-6** (`middleware.ts` → `proxy.ts` no Next 16): sem card — dívida documentada; reaparece em próximo run se relevante.
