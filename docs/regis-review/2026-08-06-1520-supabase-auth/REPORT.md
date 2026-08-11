---
type: regis-review-report
run_id: 2026-08-06-1520-supabase-auth
generated_at: 2026-08-06T20:15:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 42
total_p0: 1
total_p1: 12
total_p2: 21
total_p3: 8
overall_score: 6.3
---

# Regis-Review — financeiro — 2026-08-06-1520-supabase-auth

Feature sob revisão: `supabase-auth` — migração de provedor de identidade cujo **modo de falha declarado é lockout geral** (`ontology/entities/usuario.md`). Se o cutover falhar e o rollback não funcionar, ninguém entra no sistema — inclusive quem consertaria. Isso calibra toda a priorização abaixo: achados que **quebram o caminho de recuperação** valem mais que achados que **degradam o caminho feliz**.

## 1. Executive scorecard

Pesos aplicados (perfil financeiro multi-tenant SaaSo com escritas que movem dinheiro): Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9, Deployability 0.9. Total = 9.0.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---:|---:|---:|---:|---:|---|
| Security | 7.5 | 0 | 2 | 3 | 1 | F-security-1: `next@16.2.7` traz CVE HIGH de **bypass de middleware** — exatamente onde a feature aterrissa a proteção server-side |
| Fault Tolerance | 7.0 | 0 | 1 | 4 | 1 | F-fault-tolerance-1: gate da Fase 3 é `console.warn` — `AUTH_LEGACY_LOGIN_ENABLED=false` com pendentes = lockout geral |
| Integrability | 7.0 | 0 | 1 | 1 | 3 | F-integrability-3: degradação Conexos silenciosa; único sinal é `GET /me/conexos-status` sob demanda |
| Performance | 7.0 | 0 | 0 | 3 | 1 | F-performance-1: `middleware.ts` do Next faz round-trip HTTP à Supabase por navegação; `getClaims()` valida local |
| Modifiability | 6.0 | 0 | 2 | 2 | 3 | F-modifiability-6: `NEXT_PUBLIC_AUTH_PROVIDER` é flag ornamental — **0 leitores no código** |
| Testability | 6.0 | 0 | 3 | 3 | 2 | F-testability-3: `AuthService.signToken` sem `.test.ts`; guarda anti-regressão assina token hand-rolled (não chama o método real) |
| Availability | 5.0 | 0 | 2 | 3 | 0 | F-availability-1: JWKS sem retry + cache 10 min default — blast radius = 100% do tráfego autenticado ES256 |
| Deployability | 4.0 | 1 | 3 | 4 | 0 | F-deployability-1: rollback documentado da Fase 2 (`NEXT_PUBLIC_AUTH_PROVIDER=legacy`) é **no-op silencioso** — nenhum arquivo lê a flag |
| **Overall** | **6.3** | **1** | **12** | **21** | **8** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura consolidada.** A feature entrega tactics estruturais fortes: RBAC do banco a cada request, verify JWT alg-aware com regressão nomeada, service-role backend-only com teste-guarda, revogação sincronia com barreira dupla, compensação transacional na dual-write, `keyResolver` injetável nos testes. O que puxa a nota é **a lacuna entre o que o cutover promete e o que o código executa quando algo dá errado**: o rollback anunciado da Fase 2 não existe, o gate da Fase 3 é disciplina humana, a superfície nova não tem timeout/retry, a cobertura reportada é Potemkin e a proteção que a feature acabou de instalar depende de um Next.js com CVE HIGH que pinta a defesa como falsa. Deployability em 4 e Availability em 5 são as duas notas mais baixas — as duas que decidem "o dia em que der errado".

## 2. Top 10 risks (cross-QA)

Ranqueado por severidade × business impact × leverage. Os primeiros dois riscos são **do caminho de recuperação** e por isso levam priority sobre riscos maiores em severidade nominal.

### R-1: O rollback documentado da Fase 2 é ficção — e a escape-hatch quebra no primeiro request autenticado
- **QA(s) afetados**: Deployability (P0), Modifiability (P2), Security (nota cross-QA)
- **Findings de origem**: F-deployability-1, F-modifiability-6; corroborado pela cadeia HS256/UUID verificada abaixo
- **Evidência sintetizada**: (1) `grep -rn NEXT_PUBLIC_AUTH_PROVIDER src/frontend --include='*.ts*'` → **0 hits**; `AuthProvider.tsx:169` chama `supabase.auth.signInWithPassword(...)` incondicionalmente. Virar a flag na Vercel é no-op. (2) O backend "aceita os dois tokens" é verdade só na verificação; a cadeia de autorização falha:
  ```
  token HS256 legado  →  sub = "marilyn@kavex.com"        (e-mail, por desenho — AuthService.signToken)
  appUserContext:169  →  repository.findByAuthUserId(sub)
  UserRepository:145  →  WHERE auth_user_id = $authUserId
  migration 0044      →  auth_user_id UUID               (sem cast em lugar nenhum)
  ```
  Postgres rejeita `"marilyn@kavex.com"` como sintaxe inválida de UUID ⇒ **500 em toda request autenticada**, não um 403 gracioso. A escape-hatch falha exatamente quando é necessária. Três agentes independentes chegaram à mesma raiz (Deployability, Modifiability, Security), o que aumenta a confiança do diagnóstico.
- **Impacto técnico**: Cutover em que o operador ativa o rollback "sem redeploy" descobre no console da Vercel que a var não faz nada, e cada request de admin (a única pessoa remotamente capaz de intervir) vira 500. Sob incidente vivo, o time gasta minutos-horas descobrindo a fraude do próprio playbook.
- **Impacto de negócio**: Uma janela de indisponibilidade de login durante a Fase 2 é o pior modo de falha possível. Se o cutover falhar num sábado com Yuri fora, o time perde a janela de manutenção e a operação da Columbia perde a segunda-feira financeira (permutas + SISPAG + baixas `fin010`).
- **Card(s) Kanban relacionados**: `cutover-rollback-broken` (consolida deployability-1 + modifiability-6 + tratamento da cadeia HS256)
- **Custo de inação em 6 meses**: certo. É o card que **destrava a Fase 2 do cutover**. Não fazer = não passar de Fase 1.

### R-2: O gate da Fase 3 é `console.warn` — um flip de env var no dashboard = lockout geral instantâneo
- **QA(s) afetados**: Fault Tolerance (P1), Deployability (P1)
- **Findings de origem**: F-fault-tolerance-1, F-deployability-2
- **Evidência sintetizada**: `authEnv.ts:45-48` valida `AUTH_LEGACY_LOGIN_ENABLED` como enum sintático; `routes/auth.ts:53` só 410-a a rota; `jobs/migrate-users-to-supabase.ts:121` emite um `console.warn`. Nada no código consulta `listPendingMigration()` no boot ou no route. Um operador que edita o dashboard Render sem passar pelo CLI derruba imediatamente todos os `app_user` com `auth_user_id IS NULL` — hoje **100% da base**.
- **Impacto técnico**: `POST /auth/login` responde 410; Supabase não conhece o usuário. Zero caminhos de login. Único remédio: religar a flag no Render e esperar o restart.
- **Impacto de negócio**: Modo de falha nomeado como *"lockout geral"* na ontologia. Rollback existe mas custa uma janela real de indisponibilidade em cima do usuário — durante o próprio cutover.
- **Card(s) Kanban relacionados**: `phase3-gate-enforced` (consolida deployability-2 + fault-tolerance-1)
- **Custo de inação em 6 meses**: 1 flip malfeito no dashboard = ~15 min de indisponibilidade de login. Probabilidade em janela de cutover pressionada: mensurável.

### R-3: JWKS remoto sem cache persistido nem retry — blast radius = 100% do tráfego autenticado ES256
- **QA(s) afetados**: Availability (P1)
- **Findings de origem**: F-availability-1
- **Evidência sintetizada**: `http/auth.ts:176` chama `createRemoteJWKSet(new URL(...))` **sem `options`**; defaults da `jose`: `timeoutDuration=5s`, `cooldownDuration=30s`, `cacheMaxAge=10min`. Zero envolvimento em `RetryExecutor`, zero cache persistido em disco/Redis.
- **Impacto técnico**: Quando o cache de 10 min expira e coincide com uma janela de indisponibilidade do endpoint JWKS, `jwtVerify` lança e o middleware retorna 401 para **todo** token ES256. HS256 legado sobrevive enquanto houver tokens vivos, mas Fase 2 já emite ES256.
- **Impacto de negócio**: Um único deploy do Supabase que rotacione chaves e falhe o hosting do JWKS por 90 s vira outage de 100% da autenticação. Operador descobre pelo suporte.
- **Card(s) Kanban relacionados**: `availability-1`
- **Custo de inação em 6 meses**: incidentes de plataforma como esse tipicamente acontecem 1-2×/ano em provedores de identidade. Sem retry + cache persistido, cada um é outage completa.

### R-4: Sinal de qualidade e progresso é ruído — 17 testes vermelhos persistentes + cobertura Potemkin de 90,67%
- **QA(s) afetados**: Testability (P1), Deployability (P1)
- **Findings de origem**: F-testability-1, F-testability-2, F-testability-7, F-deployability-5
- **Evidência sintetizada**: (1) `_shared-metrics.md` confirma **17 falhas em `origin/main` e em `feat/supabase-auth`**, mesmas suítes (`routes/recebimentos.e2e.*.test.ts`). (2) `.github/workflows/ci.yml:27` roda `npm test -- --coverage` sem `continue-on-error` — ou CI está vermelha em `main` desde antes desta feature, ou o gate está bypassado. (3) `jest.config.cjs` do backend **não define `collectCoverageFrom`** ⇒ 90,67% calibrado contra ~160 de 216 arquivos: 18 dos 19 `jobs/` invisíveis, 3 dos 7 `routes/` invisíveis.
- **Impacto técnico**: Dev que roda `npm test` local não consegue distinguir regressão de ruído sem worktree descartável em `main` (foi o que o orquestrador teve de fazer neste run). `render.yaml:12-16` declara branch protection como "the gate" — aspiracional.
- **Impacto de negócio**: A próxima regressão real chega em `main` sem alarme; decisões de "estamos cobertos" são contra número irreal.
- **Card(s) Kanban relacionados**: `ci-signal-audit-and-fix` (consolida testability-1 + testability-8 + deployability-5), `testability-2`
- **Custo de inação em 6 meses**: os P0/P1 abaixo não têm tripwire. Regressão em auth vira suporte, não gate.

### R-5: Cadeia Conexos degrada silenciosamente para robô — quebra I-Usuario-1 sem alarme, no coração do produto
- **QA(s) afetados**: Integrability (P1), Availability (P2), Fault Tolerance (P2), Security (auditability)
- **Findings de origem**: F-integrability-3, F-availability-4, F-fault-tolerance-3
- **Evidência sintetizada**: `http/conexosIdentity.ts:19-31` documenta o próprio modo de falha: *"as baixas `fin010` continuam saindo — atribuídas à máquina. Sem exceção, sem log de erro, sem alarme."* Único sinal: `GET /me/conexos-status` sob polling humano. Zero contador, zero log estruturado.
- **Impacto técnico**: Um bug de dados (normalização de e-mail, alias, case) faz toda a operação de baixa cair no robô por dias. Detecção = "a Marilyn sumiu da coluna executado_por" — auditoria manual.
- **Impacto de negócio**: I-Usuario-1 ("a baixa `fin010` sai no nome do humano") é a razão de existir da feature inteira. Quebrar essa invariante em silêncio = re-atribuição manual de baixas ou perda de rastro auditável.
- **Card(s) Kanban relacionados**: `conexos-fallback-observable` (consolida integrability-1 + availability-4)
- **Custo de inação em 6 meses**: `banGoTrue: 'falhou'` não persiste, `platformUsername` mismatch não gera sinal — dois modos degradados sem cobertura. Um mês de silêncio já quebra o audit trail para quase toda baixa nesse período.

### R-6: `next@16.2.7` tem CVE HIGH de **bypass de middleware** — anula a proteção que a feature acabou de instalar
- **QA(s) afetados**: Security (P1)
- **Findings de origem**: F-security-1
- **Evidência sintetizada**: `npm audit --json` (frontend) mostra 6 CVEs HIGH em `next` direta, incluindo **GHSA-6gpp-xcg3-4w24 — bypass de middleware do App Router**. `fixAvailable: true`. A feature instala `middleware.ts` como a única proteção de rota antes da hidratação. Também 2 SSRF (Next vira pivot contra Admin API do GoTrue).
- **Impacto técnico**: `updateSession` server-side vira falso positivo. Telas de admin de usuários, permutas e SISPAG expostas pré-hidratação.
- **Impacto de negócio**: Baixo custo de mitigação (`npm audit fix`), alto custo se não fizer. `postcss@8.5.8` (mesmo card) fecha 2 CVEs HIGH CVSS 7.5.
- **Card(s) Kanban relacionados**: `security-1`
- **Custo de inação em 6 meses**: cada semana de exposição é janela em que um scanner acha; SSRF do Next contra a service-role key do Supabase = comprometimento total do IdP.

### R-7: `SupabaseAdminClient` sem timeout — chamada travada segura o worker até o LB do Render matar (~100 s)
- **QA(s) afetados**: Fault Tolerance (P2), Availability (P2), Performance (P2)
- **Findings de origem**: F-fault-tolerance-4, F-availability-5, F-performance-3
- **Evidência sintetizada**: `SupabaseAdminClient.ts:141-144` chama `createClient(url, key)` sem `AbortController`. **Nenhum** dos 7 métodos tem `RetryExecutor` ou timeout. Único caminho quente é `resolveInactive` (`appUserContext.ts:122`).
- **Impacto técnico**: `heavyRouteLimiter` em `/usuarios/*` limita mas não elimina; rota pública `/auth/forgot-password` trava em `sendRecoveryLink`.
- **Impacto de negócio**: Incidente Supabase de 5 min degrada o backend por dezenas de minutos após, com sintoma inespecífico ("está lento").
- **Card(s) Kanban relacionados**: `supabase-admin-timeout` (consolida fault-tolerance-4 + availability-6 + performance-3)
- **Custo de inação em 6 meses**: garantido que aparece — a lib delega ao fetch default do Node (sem timeout).

### R-8: Cache process-local no dia do scale-out horizontal = revogação vira letra morta em silêncio
- **QA(s) afetados**: Security (P2), Availability (P3), Fault Tolerance (P3), Performance (P2 — bounded)
- **Findings de origem**: F-security-4, F-availability-7, F-fault-tolerance-5, F-performance-2
- **Evidência sintetizada**: `AppUserContextCache.ts:28-45` documenta a restrição datada. Nenhum assert de boot lê `RENDER_NUM_INSTANCES`. `Map` interno não é bounded — cresce com órfãos.
- **Impacto técnico**: `numInstances=2` amanhã = `business-rules/revogacao-de-acesso.md` (≤ 30 s) deixa de valer sem sinal técnico. Cache pode acumular indefinidamente.
- **Impacto de negócio**: Baixa `fin010` de usuário desligado durante uma janela de 30 s = audit trail contestável.
- **Card(s) Kanban relacionados**: `cache-multi-instance-assert` (security-4 + fault-tolerance-5), `performance-2` (cap bounded)
- **Custo de inação em 6 meses**: enquanto ficarmos em `starter`, custo zero. No primeiro dia de escalar, garantido.

### R-9: `AuthService.signToken` sem teste direto — a regressão que motivou a feature pode voltar sem sinal
- **QA(s) afetados**: Testability (P1), Security (cross-QA)
- **Findings de origem**: F-testability-3
- **Evidência sintetizada**: `domain/service/auth/AuthService.ts` **não tem `.test.ts`**. A guarda anti-regressão da armadilha do `issuer` (`http/auth.test.ts:305-473`) assina um token *"réplica byte-a-byte de AuthService.signToken"* via `SignJWT` hand-rolled. Se `AuthService.signToken` ganhar `.setIssuer()` amanhã, o teste continua verde. **É o mesmo vício** que originou o bug que a feature veio corrigir.
- **Impacto técnico**: Reintroduzir `.setIssuer()` = logout global. Sem teste vermelho no PR que causa.
- **Impacto de negócio**: Se acontece durante o cutover, o alarme são 100% dos usuários vivos, em produção, ao mesmo tempo.
- **Card(s) Kanban relacionados**: `testability-3`
- **Custo de inação em 6 meses**: o próximo `/feature-tweak` que tocar `AuthService` (para retirar HS256 na Fase 4) tem chance real de trocar o comportamento.

### R-10: Cobertura de backend é Potemkin — 90,67% calibrado contra ~74% dos arquivos reais
- **QA(s) afetados**: Testability (P1), Deployability (P1 — gate do `tag-release`)
- **Findings de origem**: F-testability-2
- **Evidência sintetizada**: `src/backend/jest.config.cjs` **não define `collectCoverageFrom`**. Jest só instrumenta arquivos importados por um teste. Dos 19 `jobs/`, apenas `migrate-users-to-supabase.ts` aparece. Dos 7 `routes/`, apenas 4. Frontend faz certo (`collectCoverageFrom` explícito) e reporta 34,85% honesto.
- **Impacto técnico**: Adicionar arquivo novo sem teste não faz a % cair. Gate `lines=72` calibrado contra denominador reduzido.
- **Impacto de negócio**: Decisões de "estamos cobertos" contra número irreal.
- **Card(s) Kanban relacionados**: `testability-2`
- **Custo de inação em 6 meses**: cada feature adiciona superfície descoberta sem apitar o dashboard.

## 3. Cross-cutting findings

### CC-1: Rollback do cutover é a ficção mais cara
- **Aparece em**: Deployability, Modifiability, Security
- **Findings**: F-deployability-1 (P0), F-modifiability-6 (P2), corroborado pela cadeia HS256/UUID/500
- **Diagnóstico unificado**: A ADR-0030 §6 promete "rollback da Fase 2 é uma variável de ambiente na Vercel, sem redeploy do backend" — é a **única** promessa do cutover que exercitaria a escape-hatch com pressa. Nenhum arquivo `.ts`/`.tsx` do frontend lê `NEXT_PUBLIC_AUTH_PROVIDER`; nem a rota `/login` ramifica. E, mesmo se ramificasse, o backend não sabe resolver um `app_user` a partir do `sub=email` do token legado. Três diagnósticos independentes convergem para a mesma raiz.
- **Recomendação consolidada**: **1 card único** (`cutover-rollback-broken`, P0) cobrindo as duas pontas: (a) `AuthProvider.signIn` lê `NEXT_PUBLIC_AUTH_PROVIDER` e ramifica; (b) `appUserContext` resolve o legado por `username` quando o alg é HS256. Alternativa honesta: reescrever ADR + DEPLOY.md dizendo que rollback da Fase 2 é revert + redeploy.

### CC-2: Superfícies externas novas nascem sem timeout/retry
- **Aparece em**: Availability, Fault Tolerance, Performance
- **Findings**: F-availability-1 (JWKS), F-availability-5 (SupabaseAdminClient), F-availability-6 (frontend middleware), F-fault-tolerance-4 (SupabaseAdminClient), F-performance-3 (SupabaseAdminClient), F-performance-1 (frontend middleware round-trip)
- **Diagnóstico unificado**: 4 superfícies externas síncronas novas no caminho de request. **Nenhuma** com `RetryExecutor`/`AbortController` explícito. CLAUDE.md declara "NEVER use manual `setTimeout` loops — always use Executors" — a doutrina protege quando aplicada. Aqui, não foi.
- **Recomendação consolidada**: **2 cards**: (a) `supabase-admin-timeout` — envelopar cada método em `RetryExecutor` + `AbortController(5s)`, exceto os não-idempotentes (só timeout); (b) `availability-1` — JWKS com cache persistido + retry + observabilidade. Frontend em cards próprios (`availability-5` timeout, `performance-1` `getClaims()`).

### CC-3: Modos de falha degradada são conhecidos, documentados e não observáveis
- **Aparece em**: Integrability, Availability, Fault Tolerance, Security
- **Findings**: F-integrability-3 (fallback Conexos), F-availability-4 (mesmo), F-fault-tolerance-3 (`banGoTrue: 'falhou'` não persistido), F-fault-tolerance-6 (relatório de migração não persistido), F-security-5 (rejeições auth em `console.warn`)
- **Diagnóstico unificado**: A feature **documenta** os modos de falha degradada em doc-comments — e escolheu não instrumentar. Padrão se repete: `conexosIdentity.ts:19-25` fala de queda no robô; `UserAdminService.ts:222` warna e devolve `banGoTrue: 'falhou'` no body. Nenhum tem persistência, contador ou alerta. Sinal termina no stdout do Render.
- **Recomendação consolidada**: **2 cards de instrumentação**: (a) `conexos-fallback-observable` — contador + log estruturado no `ConexosSessionResolver`; (b) `fault-tolerance-3` — tabela `app_user_evento` cobrindo `setAtivo`, `redefinirSenha`, `setVinculo` (converge com follow-up P1 **I-Usuario-7** já aberto). `fault-tolerance-6` (persistir relatório de migração) fica no mesmo cluster.

### CC-4: Premissa datada do cache process-local sem tripwire
- **Aparece em**: Security, Availability, Fault Tolerance, Performance
- **Findings**: F-security-4, F-availability-7, F-fault-tolerance-5, F-performance-2
- **Diagnóstico unificado**: `AppUserContextCache.ts:28-42` documenta literalmente a restrição datada (2026-08-06) e o modo de falha silencioso ao escalar. É o comentário mais honesto do PR — mas nada no código impede o dia em que alguém aperta "scale".
- **Recomendação consolidada**: **2 cards**: (a) `cache-multi-instance-assert` — fail-fast no boot quando `RENDER_NUM_INSTANCES > 1` até `revogacao-de-acesso.md` ser revisitado; (b) `performance-2` — cap bounded no `Map` com LRU trivial.

### CC-5: Sinal de qualidade e progresso é irreal
- **Aparece em**: Testability, Deployability
- **Findings**: F-testability-1 (17 vermelhos), F-testability-2 (cobertura Potemkin), F-testability-3 (AuthService sem teste), F-testability-7 (CI status desconhecido), F-deployability-5 (mesma origem)
- **Diagnóstico unificado**: Três facetas do mesmo problema — o pipeline confia num sinal que não sabemos se protege. As 17 falhas são fixtures data-dependentes (`docEspNumero: "06082026"`) e são carry-over de Frente IV, não regressão desta feature. Mas o efeito **deployment** é o mesmo: `render.yaml:12-16` declara branch protection como o gate — e o gate está ruidoso.
- **Recomendação consolidada**: **2 cards**: (a) `ci-signal-audit-and-fix` (testability-1 + testability-8 + deployability-5) — congelar relógio nas fixtures ou mover para `.integration.test.ts` + auditar histórico de CI em `main`; (b) `testability-2` — `collectCoverageFrom` + recalibrar `lines=72`.

### CC-6: Gates operacionais viraram disciplina humana
- **Aparece em**: Deployability, Fault Tolerance, Security
- **Findings**: F-deployability-2 (Fase 3), F-fault-tolerance-1 (mesma), F-deployability-7 (9 pré-requisitos Supabase), F-deployability-9 (`CONEXOS_CRED_ENC_KEY` presente-vazia), F-security-6 (signup Supabase)
- **Diagnóstico unificado**: Uma sequência de checkpoints declarados como "não opcionais para produção" (ADR-0030 §10) foi tratada como confiança operacional. Nenhum tem assert no boot.
- **Recomendação consolidada**: **3 cards**: (a) `phase3-gate-enforced` — fail-fast no boot; (b) `deployability-6` + `deployability-7` — deep health + smoke test + verificação automática dos 3 pré-requisitos Supabase verificáveis por API; (c) `deployability-8` — assert de boot para `CONEXOS_CRED_ENC_KEY` presente-e-válida.

## 4. Quick wins (≤ 5 dias úteis; esforço S; severidade ≥ P2)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `cutover-rollback-broken` | Deployability + Modifiability | S (rota b) / M (rota a) | **P0** | Rollback da Fase 2 funciona no primeiro toggle **ou** ADR + DEPLOY.md dizem o custo real |
| `phase3-gate-enforced` | Fault Tolerance + Deployability | S | P1 | Boot recusa `AUTH_LEGACY_LOGIN_ENABLED=false` com pendentes ativos |
| `security-1` | Security | S (≤1d) | P1 | `next` 16.2.7 → ≥16.3.0; `postcss` 8.5.8 → ≥8.5.23; `npm audit high` frontend 6 → 0 |
| `security-2` | Security | S | P1 | `axios` 1.16.1 → ≥1.18.0; `npm audit high` direta backend 1 → 0 |
| `deployability-3` | Deployability | S (≤1h) | P1 | Tabela §3 de `DEPLOY.md` inclui as 3 vars Supabase reais |
| `availability-3` | Availability | S | P1 | `appUserContext` ganha retry local; DB soluço vira 503+`Retry-After`, não 500 |
| `testability-2` | Testability | S (≈2h) | P1 | `collectCoverageFrom` no backend + recalibrar `lines=72` |
| `testability-3` | Testability | S (≈4h) | P1 | `AuthService.test.ts` exercita `signToken` real |
| `conexos-fallback-observable` | Integrability + Availability | S | P1 | `ConexosSessionResolver` emite `event:'conexos_fallback_robot'` estruturado + contador |
| `supabase-admin-timeout` | Fault Tolerance + Availability + Performance | S | P2 | 7/7 métodos com timeout ≤5s + retry curto onde é idempotente |
| `cache-multi-instance-assert` | Security + Fault Tolerance | S | P2 | Boot crasha em `numInstances>1` |
| `security-3` | Security | S | P2 | `AUTH_JWT_SECRET` sem `AUTH_LEGACY_LOGIN_ENABLED=false` crasha no boot |
| `performance-1` | Performance | S | P2 | Frontend middleware `getUser()` → `getClaims()` no ES256; round-trip por navegação 1 → 0 |
| `performance-2` | Performance | S | P2 | `AppUserContextCache` cap 10.000 entradas + LRU |
| `availability-2` | Availability | S (≤1d) | P2 | `/health/ready` testa `SELECT 1` + JWKS reachable + `authEnv` |
| `availability-5` | Availability | S | P2 | Frontend `middleware.ts` ganha timeout 3s + fallback gracioso |
| `fault-tolerance-6` | Fault Tolerance | S | P2 | Relatório do `migrate-users-to-supabase` persiste em tabela |
| `deployability-4` | Deployability | S (≤1h) | P2 | `.env.example` backend alinhado com `authEnv.ts` pós-ADR-0030 |
| `deployability-8` | Deployability | S | P2 | Boot crasha se `CONEXOS_CRED_ENC_KEY` estiver ausente/vazia (carry-over fechado) |
| `modifiability-5` | Modifiability | S (≤1d) | P2 | `buildAppUserContextMiddleware` complexidade 27 → ≤15 |

**20 quick wins.** Fecham o P0, todos os P1 do cutover, os três modos de falha silenciosos do CC-3 (parcial) e a superfície ausente de timeout/retry.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `ci-signal-audit-and-fix` | Testability + Deployability | S (auditar) → M (arrumar fixtures) | Limit Non-Determinism | 17/1.212 = 1,4% da suíte permanentemente vermelha; custo humano ~10 min/review para diferenciar "meu vs. herdado". Alvo: 0 vermelho, custo 0 |
| `availability-1` | Availability + Performance | M (2-5d) | Retry + Passive Redundancy + Monitor | JWKS `cacheMaxAge=10min` → `1h`; retry no path ES256 0 → 2; cache persistido: não → sim |
| `modifiability-1` | Modifiability | L (1-2 semanas) | Split Module + Increase Semantic Coherence | `RecebimentoNumerarioService.ts` 1.536 LOC / 32 métodos (30 privados). p95 de LOC em `domain/service/` 776 → ≤400 |
| `modifiability-2` | Modifiability | M (2-5d) | Refactor | Complexidade cognitiva máxima em `domain/service/permutas/`: 65 → ≤25 |
| `modifiability-3` | Modifiability | L (1-2 semanas por frente) | Restrict Dependencies | 10 imports layer-skipping em `routes/` → 0; `container.resolve` em `routes/` 108 → ≤15; média LOC em `routes/` 347 → ≤200 |
| `testability-6` | Testability + Modifiability | M | Abstract Data Sources | 279 leituras de tempo em 47 arquivos, 1 injetável; `ClockProvider` habilita testes determinísticos |
| `testability-4` | Testability + Fault Tolerance | M (≈1 semana) | Sandbox + Executable Assertions | 5 jobs de produção com 0 testes; falha silenciosa = dia sem ingestão |
| `testability-7` | Testability | M (≈1 semana) | Sandbox + Executable Assertions | `/app/usuarios/` (4 arquivos, 0%) é onde admin revoga usuário. Backend tem 304 LOC de teste; UI zero |
| `deployability-6` | Deployability + Availability | M (2-3d) | Deployment observability | Deep health touches 3 dependências; smoke test pós-deploy com login sintético |
| `deployability-7` | Deployability + Security | M (2-4d) | Verifiable preconditions | 3 dos 9 pré-requisitos manuais passam a ser check no boot |
| `integrability-4` | Integrability + Deployability | M (2-5d) | Versioning strategy | 7 arquivos acoplam direto à API de `@supabase/*`; pin `~` + roteiro de smoke-test |
| `fault-tolerance-2` | Fault Tolerance | M | Reconcile | Reaper `auth.users` × `app_user` — hoje 0 jobs; alvo 1 semanal no rollout |
| `fault-tolerance-3` | Fault Tolerance + Security + Testability | M | Repair State | Mutações de `Usuario` com trilha persistida: 1/4 → 4/4; `banGoTrue: 'falhou'` sobrevive a restart. Converge com follow-up I-Usuario-7 |

## 6. O que está bem (e por quê)

1. **Verify Message Integrity — alg-aware por token** (`http/auth.ts:161-208`). ES256 via JWKS (issuer obrigatório) **ou** HS256 (issuer relaxado, legacy-only). Audience `'authenticated'` fecha os dois. `middlewareWiring.test.ts:12-30` nomeia a regressão.
2. **Authorize Actors — RBAC resolvido do banco a cada request** (`http/appUserContext.ts:82-203`). Claim `role` do GoTrue descartada. 35 rotas de mutação fechadas; 403 fail-closed.
3. **Revoke Access — barreira dupla ordenada** (`UserAdminService.ts:192-235`). (1) `app_user.ativo=false` + `contextCache.invalidate` sincronamente. (2) `setBanned` no GoTrue. Falha em (2) é sucesso PARCIAL auditado.
4. **Compensating Transaction — `createLocalRowOrCompensate`** (`UserAdminService.ts:327-357`). Única exceção permitida a `deleteUser` (I-Usuario-3); teste-guarda em `SupabaseAdminClient.test.ts:181-198`.
5. **Encapsulate — `SupabaseAdminClient` como modelo do padrão** (`domain/client/SupabaseAdminClient.ts:118-284`). Zod no boundary, erros do provedor traduzidos em 3 classes tipadas, teste-guarda para `SUPABASE_SERVICE_ROLE_KEY` ausente do bundle frontend.
6. **Manage Resource Coupling — cadeia identidade→ERP em 1 símbolo** (`conexosIdentity.ts` diff `+21 -5`). `ConexosSessionResolver` = 0 linhas alteradas; `getVinculoConexos` = 0 linhas alteradas.
7. **Validate Input — Zod nos boundaries** (`routes/auth.ts:12-20,62-99`). `passthrough()` na resposta do GoTrue absorve campos futuros sem quebrar.
8. **Change Default Settings** — `DEV_AUTH_BYPASS` deny-by-default; `role` default `'operador'`; anti-enumeração no `POST /auth/forgot-password` com resposta congelada (`Object.freeze`) testada com input malformado e com provedor fora.

## 7. Limitações da análise

- **Métricas declaradas como "não medíveis localmente":** MTTR real de rollback, latência p50/p99 JWKS/`getUser`, taxa de cache-hit, rate de logins falhos, postura RLS no schema `auth` do Supabase, estado atual do signup público, histórico de CI em `main` (F-testability-7), delta de bundle browser (F-performance-4), taxa real de fallback para robô.
- **O que este pipe NÃO cobre:** chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade, revisão de contratos com provedores, postura de perímetro AWS (não há `infra/`).
- **`filialAuthz` fail-OPEN — carry-over de 6 runs consecutivos** (desde 2026-06-22): não gera card novo (segue em `_inbox/supabase-auth-regis-followups.md`). O histórico é sinal de **processo**, não de código — é a única falha estrutural que sobreviveu ao 6º Regis-Review sem virar prioridade. Recomendação para o tech lead: no próximo `/feature-tweak` de `usuarios`/`filial`, sai do inbox e vira P0 do run; do contrário vira norma cultural.
- **17 falhas de teste da Frente IV:** confirmadas como **pré-existentes** pelo orquestrador (diff dos nomes em worktree descartável de `origin/main` × `feat/supabase-auth` — conjuntos idênticos). Sintoma de `docEspNumero: "06082026"` em fixture data-dependente. Registrado como Testability, não como debit desta feature.
- **Express-vs-Lambda:** dívida de template aceita (`migration-debt.md`). Não gerou card.
- **Numeração de cards:** IDs originais preservados sempre que possível. Cards mergeados receberam nome descritivo (`cutover-rollback-broken`, `phase3-gate-enforced`, `supabase-admin-timeout`, `conexos-fallback-observable`, `cache-multi-instance-assert`, `ci-signal-audit-and-fix`); a evidência do merge está no KANBAN.md.
- **Janela temporal:** snapshot do dia `2026-08-06`. Refazer trimestralmente ou após o cutover, o que vier primeiro.

## 8. Ações recomendadas

1. **Antes de qualquer feature nova, endereçar 100% do P0 e todos os P1 do cutover.** `cutover-rollback-broken` (P0), `phase3-gate-enforced`, `security-1`, `security-2`, `deployability-3`. Todos S; o P0 vira `--urgent` do próximo `/feature-tweak`. Sem eles, a Fase 2 do cutover não deve ser tentada.
2. **Fechar sinal de qualidade em uma sprint dedicada.** `ci-signal-audit-and-fix` + `testability-2` + `testability-3`. Sem isso, os P1 seguintes não têm tripwire.
3. **Instrumentar o modo de falha crítico da feature.** `conexos-fallback-observable` + `supabase-admin-timeout`. Depois disso, o dashboard distingue "GoTrue lento", "GoTrue fora" e "Conexos degradado".
4. **Realinhar cobertura e trilha de eventos.** `testability-2` (`collectCoverageFrom`) + `testability-4` (jobs) + `fault-tolerance-3`/`fault-tolerance-6` (persistência de eventos).
5. **Endurecer os gates operacionais herdados.** `deployability-6`, `deployability-7`, `deployability-8`. Move a defesa mais externa do playbook humano para dentro do repositório.

Depois de (1)-(3), o run está pronto para o cutover Fase 2. Depois de (4)-(5), pronto para Fases 3-4.
