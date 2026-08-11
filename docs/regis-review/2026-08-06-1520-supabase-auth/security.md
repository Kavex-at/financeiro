---
qa: Security
qa_slug: security
run_id: 2026-08-06-1520
agent: qa-security
generated_at: 2026-08-06T18:20:00-03:00
scope: backend + frontend (não há `infra/` neste repositório)
score: 7.5
findings_count: 6
cards_count: 6
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Ator externo (internet) ou insider com conta desativada; JWT roubado; scanner varrendo `/auth/forgot-password` | Requisição autenticada com token do GoTrue cuja linha em `app_user` foi removida/desativada, OU tentativa de enumeração de e-mails corporativos, OU aceite de convite tentando reativar usuário desligado | `http/appUserContext.ts` (gate fail-closed), `routes/auth.ts` (`POST /auth/forgot-password`), `SupabaseAdminClient` (Admin API), `AuthService` (HS256 legado) | Produção (Render single-instance) durante rollout Fase 2 (HS256 legado + ES256 GoTrue coexistindo); Supabase signup público em estado indefinido (passo humano fora do repo) | Rejeitar com **403** (nunca 401) antes de qualquer efeito colateral; responder `/forgot-password` com corpo/status idêntico para existente e inexistente; nunca ativar `convite_pendente=false` sem `emailConfirmedAt` no provedor; nunca aceitar sub sem linha em `app_user` mesmo com JWT válido | 0 usuários desativados operando após ≤30 s da revogação; 0 diferenças observáveis (status/body/latência) entre e-mail existente e inexistente na rota pública; 0 casos de `sub` do token virar ator da trilha; ≤ 2 chamadas/min à Admin API por convidado insistente (cache 30 s) |

> A promessa que sustenta o resto: o JWT prova **identidade**, o banco decide **autorização**, revogável em ≤ 30 s.

## 2. Métricas observadas

Coletadas na working tree do worktree `feat/supabase-auth` (nada commitado).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded em código de produção | 0 | 0 | ✅ | `grep -rEn "(password\|secret\|token\|api[_-]?key\|credential)\s*[:=]\s*['\"][^'\"]{8,}"` em `src/backend src/frontend` (todos os hits estão em `*.test.ts` — fixtures) |
| AWS access keys em código | 0 | 0 | ✅ | `grep -rEn "AKIA[0-9A-Z]{16}" src/backend src/frontend` |
| `.env` rastreados no git | 0 (apenas `.env.example`) | 0 | ✅ | `git ls-files \| grep -E "\.env(\..+)?$"` → só `*.example` |
| Vulnerabilidades **backend** (`npm audit`) | 0 crítica / 4 alta / 2 moderada / 2 baixa (total 8; direta HIGH: `axios@1.16.1`) | 0 crítica / 0 alta / ≤5 moderadas | ❌ | `cd src/backend && npm audit --json` |
| Vulnerabilidades **frontend** (`npm audit`) | 0 crítica / 6 alta / 0 moderada / 1 baixa (total 7; direta HIGH: `next@16.2.7`, `postcss@8.5.8`) | 0 crítica / 0 alta / ≤5 moderadas | ❌ | `cd src/frontend && npm audit --json` |
| Advisories em dependência direta com fix disponível | 3 (`axios`, `next`, `postcss` — todas `fixAvailable: true`) | 0 | ❌ | `npm audit --json \| jq '.vulnerabilities \| to_entries[] \| select(.value.isDirect)'` |
| Rotas HTTP em `src/backend/routes/` | 64 totais (35 mutação + 29 leitura) | — | ℹ️ | `grep -rEn "router\.(get\|post\|put\|patch\|delete)"` |
| Ocorrências de `requireRole(...)` em routes | 42 (cobre 35 mutações + agrupamentos `router.use(requireRole('admin'))`) | 100 % das mutações | ✅ | `grep -rn requireRole src/backend/routes` — mutações não-permutas cobertas por `router.use()` (`usuarios.ts:35`, `permutas.ts` gate por rota, `recebimentos.ts` por rota) |
| Zod `safeParse`/`.parse(` nos routes | 37 usos em rotas | ≥ 1 por endpoint de mutação | ✅ (revisado por amostragem — auth/usuarios/permutas/recebimentos/sispag) | `grep -rn "safeParse\|\.parse(" src/backend/routes` |
| SQL com interpolação de variável no repositório | 0 em variáveis controladas pelo usuário (2 hits em `permutas`/`numerario` são de placeholders posicionais `$fil_${i}` — não dados) | 0 | ✅ | `grep -rEn "\\\`.*\\\$\{.*\}.*(SELECT\|INSERT\|UPDATE\|DELETE)"` em `repository/` |
| `dangerouslySetInnerHTML` no frontend | 0 | 0 | ✅ | `grep -rn dangerouslySetInnerHTML src/frontend` |
| Token JWT em `localStorage`/`sessionStorage` no código de produção | 0 (removido; sessão via cookies `@supabase/ssr` — `lib/auth/token.ts:9-14` documenta o cutover) | 0 | ✅ | `grep -rn "localStorage\|sessionStorage" src/frontend --include=*.tsx` (só linhas de doc/histórico) |
| Referências a `SUPABASE_SERVICE_ROLE_KEY` em CÓDIGO do frontend (comentários removidos) | 0 | 0 | ✅ | Teste-guarda `SupabaseAdminClient.test.ts:200-238` varre `src/frontend/` a cada suíte |
| Chaves cobertas por `redactBody` para GoTrue | `service_role`, `servicerole`, `servicerolekey`, `service_role_key`, `supabase_service_role_key`, `apikey` | Cobrir snake_case do provedor + camelCase interna + header `apikey` | ✅ | `http/redact.ts:22-31` + `http/redact.test.ts:50-70` |
| TTL de revogação de acesso (invalidação de cache) | 30 000 ms (constante tipada, `AppUserContextCache.ts:16`; teste-guarda contra `process.env` — `appUserContext.test.ts:220-241`) | ≤ 60 s declarado | ✅ | `AppUserContextCache.ts:16` |
| Anti-enumeração em `POST /auth/forgot-password` | Resposta congelada com `Object.freeze(...)` — mesmo status/body existindo ou não o usuário; mesmo com input malformado; mesmo com provedor fora | Zero diferença observável | ✅ | `UserAdminService.ts:79-83, 268-282`; `routes/auth.ts:91-102` |
| Fail-fast de `DEV_AUTH_BYPASS` fora de local/dev | Backend: crash em `loadAuthEnv` (allow-list `['local','dev','development','test']` — deny-by-default, cobre `'production'`); Frontend: `assertAuthEnv()` no import do provider | Crash na carga, não erro em request | ✅ | `authEnv.ts:117-129`; `lib/auth/env.ts:30-40` |
| Cobertura da regressão nomeada do `issuer` | 1 teste anti-regressão que replica byte-a-byte `AuthService.signToken` (sem `.setIssuer()`) + 4 testes irmãos que fecham audience e ES256 issuer | Cobrir a armadilha ADR-0030 §6 | ✅ | `http/auth.test.ts:305-473` |

**Métricas não medíveis neste repositório:**

- ⚠️ **Não medível: não há `infra/`.** Terraform/IAM/SSM/CloudTrail/GuardDuty/VPC — nenhuma tactic de perímetro AWS pode ser observada aqui. Deploy é Render (backend) + Vercel (frontend) + Supabase (Postgres + GoTrue). Recomendação: **não** inferir presença/ausência dessas tactics.
- ⚠️ **Não medível localmente:** rate de tentativas de login falhas em produção, latência de aceite de convite ponta-a-ponta, e se o **signup público do Supabase** está atualmente ligado ou desligado — todos exigem console do provedor. A ADR-0030 §10.1 lista "desligar signup público" como passo humano bloqueante fora do repo.
- ⚠️ **Não medível: postura RLS no schema `auth`.** ADR-0030 §10.9 exige confirmar que `auth` não está exposto via PostgREST. Requer inspeção do painel Supabase.

## 3. Tactics — Cobertura no financeiro

### Detect Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | 401/403 aterrissam em `console.warn` (stdout do Render); *nenhuma* agregação em métrica, alarme por burst, ou rate-limit adaptativo. Rate-limit global (100/min) e pesado (10/min) existe, mas por IP, e é desligado em `NODE_ENV=test`. | ⚠️ parcial | `http/auth.ts:222`, `http/appUserContext.ts:94`, `http/rateLimit.ts:15-35` |
| Detect Service Denial | `express-rate-limit` (`globalLimiter`, `heavyRouteLimiter`) por IP em janelas de 60 s. **Sem WAF, sem detecção baseada em anomalias.** | ⚠️ parcial | `http/rateLimit.ts:17-35`; montagem em `index.ts:38,111` |
| Verify Message Integrity | JWT verificado com **algoritmo escolhido por token** (`alg` do header): ES256 via JWKS (issuer obrigatório) OU HS256 com segredo compartilhado (issuer relaxado, **legacy-only**). Audience `authenticated` obrigatória nos DOIS caminhos. Regressão do `issuer` coberta por teste nomeado. | ✅ | `http/auth.ts:145-208`; `http/auth.test.ts:305-398` |
| Detect Message Delay | N/A neste QA — cobertura fica em Availability/Fault Tolerance. | N/A | — |

### Resist Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | `sub` do JWT (UUID GoTrue) prova identidade; `username` (e-mail de `app_user`) é o **único** ator persistido em audit — helper `auditActor(req)` centralizado (`http/auth.ts:264-266`) com teste-guarda que falha se `req.user?.sub` reaparecer. | ✅ | `http/auth.ts:230-266`; `http/auditActor.guard.test.ts` |
| Authenticate Actors | JWT alg-aware (JWKS ES256 + HS256 legado). `DEV_AUTH_BYPASS` proibido fora de local/dev (deny-by-default, crasha no boot). Login legado atrás de `AUTH_LEGACY_LOGIN_ENABLED`; sem hash local → recusa como credencial inválida. | ✅ | `http/auth.ts:145-208`; `authEnv.ts:117-129`; `AuthService.ts:48-64`; `routes/auth.ts:50-77` |
| Authorize Actors | **RBAC resolvido do banco a cada request** — `appUserContext` sobrescreve `req.user.role` com `app_user.role`; a claim `role` do GoTrue (`'authenticated'`) é descartada. `requireRole('admin')` fecha 35 rotas de mutação; fail-closed **403** (não 401) quando sem linha ou `ativo=false`. | ✅ | `http/appUserContext.ts:82-203`; `http/auth.ts:274-291`; `routes/usuarios.ts:35` |
| Limit Access | Papel default `'operador'` no boundary; promover a admin é ato explícito (`USER_ROLES` + `DEFAULT_ROLE`, `UserAdminService.ts:14-18`). Migração `0045` alinha default do banco. `deleteUser` do GoTrue **não é exposto em rota** (só compensação transacional; teste-guarda). Autodesativação bloqueada (I-Usuario-6). | ✅ | `UserAdminService.ts:56-61,192-235`; `SupabaseAdminClient.ts:96-117,277-284` |
| Limit Exposure | `SUPABASE_SERVICE_ROLE_KEY` vive **só no backend**, lida via `EnvironmentProvider` (nunca `process.env` cru); teste-guarda (`SupabaseAdminClient.test.ts:200-238`) varre `src/frontend/` para não-comentários. `AppUserPublic` omite `password_hash` e `conexos_password_enc` por design de interface. `NEXT_PUBLIC_SUPABASE_ANON_KEY` é publicável por desenho (documentado em `lib/supabase/env.ts:1-10`). Vínculo Conexos por-filial (`filialAuthz`) segue **fail-OPEN por omissão da claim** — carry-over, ver §6. | ⚠️ parcial | `SupabaseAdminClient.ts:97-146`; `EnvironmentProvider.ts:142`; `lib/supabase/env.ts`; `filialAuthz.ts:48` |
| Encrypt Data | `SecretCipher` (AES-GCM) para senha Conexos por-usuário (`vinculoConexos`). Traffic HTTPS (Render + Vercel + Supabase). Sessão em cookies do `@supabase/ssr` (não `localStorage`) com rotação/refresh geridos pelo provedor. | ✅ | `UserAdminService.ts:289-304`; `lib/supabase/middleware.ts:6-59`; `lib/auth/token.ts:6-14` |
| Separate Entities | Multi-tenant blast-radius é **promessa arquitetural fora deste repositório** — não há `infra/`, tenant por conta AWS não existe hoje (Render mono-cliente). A ADR-0030 hospeda GoTrue e Postgres **no mesmo projeto Supabase** — reafirma a defesa dupla (signup off + 403 fail-closed) porque signup ligado dá JWT válido do projeto. | ⚠️ parcial (por escopo) | ADR-0030 §3.3, §10.1; `_shared-metrics.md` — "não há `infra/`" |
| Change Default Settings | `DEV_AUTH_BYPASS` deny-by-default; `AUTH_LEGACY_LOGIN_ENABLED` default `true` durante rollout (`authEnv.ts:45-48`); `role` default `'operador'` no boundary + migração 0045; seed-admin removeu a senha hardcoded `'columbia2026'` (ADR-0030 §9). Cookies do Supabase seguem defaults do `@supabase/ssr` (não redefinidos manualmente — flags ficam a cargo do provider). | ✅ | `authEnv.ts:45-48,68`; `migrations/0045_app_user_role_default.sql`; ADR-0030 §9 |
| Validate Input | Zod nos routes (login/forgot-password/convite/create/reset/vinculo — todos com `safeParse` antes de tocar o service). Schemas em `UserAdminService.ts:24-49`. Resposta do GoTrue (external input) validada com `.passthrough()` (`SupabaseAdminClient.ts:55-63`). | ✅ | `routes/auth.ts:12-20,62-99`; `routes/usuarios.ts:37-49,132-236`; `SupabaseAdminClient.ts:55-74` |

### React to Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Revoke Access | **Duas barreiras** ordenadas (I-Usuario-8): (1) `app_user.ativo = false` + `contextCache.invalidate(authUserId)` **sincronicamente** no mesmo processo — fecha cada request em ≤ 30 s; (2) `setBanned` no GoTrue — impede **renovar** o refresh. Falha em (2) é sucesso PARCIAL auditado, não erro duro (a barreira 1 já revogou). `signOut()` no front revoga do lado do provedor. | ✅ | `UserAdminService.ts:192-235`; `AppUserContextCache.ts:71-78`; `AuthProvider.tsx:184-201` |
| Lock Computer | N/A — endpoint web/API; conceito de bloqueio de estação não aplicável ao stack. | N/A | — |
| Inform Actors | 403 com **mensagem PT-BR distinta** por motivo (sem linha / inativo / convite não aceito) — `appUserContext.ts:41-46`; `AuthProvider.tsx` limpa role local mantendo sessão viva no caso 403 do `GET /me` (para não derrubar em cima de falta de autorização). Modal `SessionExpiredModal` reage a `SIGNED_OUT/TOKEN_REFRESHED`. Mensagens ao admin distinguem "não conseguiu banir no GoTrue" de "não desativou" (`banGoTrue: 'falhou'`). | ✅ | `appUserContext.ts:41-46`; `AuthProvider.tsx:87-101,120-139`; `UserAdminService.ts:63-73,223-234` |

### Recover from Attacks

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Restore | Rollback do cutover: `AUTH_LEGACY_LOGIN_ENABLED=true` re-habilita `POST /auth/login`; gate operacional `listPendingMigration()` vazio antes da Fase 3 impede lockout. `createLocalRowOrCompensate` reverte cadastro parcial no GoTrue (única exceção permitida a `deleteUser`). O **AUTH_JWT_SECRET permanece no ambiente** até a Fase 4 — janela em que tokens HS256 pré-desligamento seguem verificáveis (ver F-security-3). | ⚠️ parcial | `routes/auth.ts:50-77`; `jobs/migrate-users-to-supabase.ts:117-134`; `UserAdminService.ts:327-357`; `render.yaml:78-81` |
| Audit Trail | `auditActor(req)` retorna **`username`** (nunca `sub`), com teste-guarda contra regressão. **Cobre 21 call sites verificados** (ADR-0030 §5). **Ausente** em `PATCH /:id/ativo`, `POST /:id/reset-senha`, `PATCH /:id/vinculo`: I-Usuario-7 declarada mas **não enforçada** — carry-over, ver §6. | ⚠️ parcial | `http/auth.ts:230-266`; `http/auditActor.guard.test.ts`; follow-up `supabase-auth-regis-followups.md` §"P1 — I-Usuario-7" |

## 4. Findings (achados)

Achados **carry-over** já listados no `_shared-metrics.md` (§"Achados JÁ CONHECIDOS") **não** aparecem aqui — em particular o `filialAuthz` fail-OPEN (6º Regis-Review consecutivo) e o `CONEXOS_CRED_ENC_KEY` ausente do dashboard.

### F-security-1: Dependência direta `next@16.2.7` tem advisory de **bypass do middleware** — o exato ponto onde esta feature aterrissa a autenticação

- **Severidade**: **P1**
- **Tactic violada**: Authenticate Actors (defense-in-depth) · Verify Message Integrity
- **Localização**: `src/frontend/package.json` (`"next": "^16.2.7"`); implicado em `src/frontend/middleware.ts` + `src/frontend/lib/supabase/middleware.ts`
- **Evidência (objetiva)**:
  ```
  npm audit --json (src/frontend):
    next: severity=high, isDirect=true, range=9.3.4-canary.0 – 16.3.0-preview.10, fixAvailable=true
      • GHSA-6gpp-xcg3-4w24 — Middleware / Proxy bypass in App Router applications using Turbopack and single locale (HIGH)
      • GHSA-p9j2-gv94-2wf4 — Server-Side Request Forgery in rewrites via attacker-controlled destination hostname (HIGH)
      • GHSA-89xv-2m56-2m9x — SSRF in Server Actions on custom servers (HIGH)
      • GHSA-m99w-x7hq-7vfj — DoS in App Router using Server Actions (HIGH)
      • GHSA-955p-x3mx-jcvp — Unauthenticated disclosure of internal Server Function endpoints (moderate)
      • ... (+4 outros)
  npm ls next → next@16.2.7
  ```
- **Impacto técnico**: A feature `supabase-auth` **introduz `middleware.ts` como a única proteção de rota antes da hidratação** (docstring em `src/frontend/middleware.ts:1-24`). Se a rota de bypass do advisory GHSA-6gpp-xcg3-4w24 for explorável no build atual, um visitante sem sessão contorna o redirect para `/login` e chega HTML de rota protegida antes de o `RouteGate` client-side rodar. As duas SSRF (`GHSA-p9j2-gv94-2wf4`, `GHSA-89xv-2m56-2m9x`) tornam o Next.js um pivot para requests server-to-server saindo do Vercel — potencialmente contra o backend Render, o Supabase Admin API ou o Conexos.
- **Impacto de negócio**: O gate server-side foi vendido como a peça que **fecha a janela entre HTML pintar e o React hidratar** (`middleware.ts:6-11`); um bypass no Next.js reabre exatamente essa janela para telas de gestão de usuários, permutas e SISPAG. `fixAvailable: true` — não há dilema de versão.
- **Métrica de baseline**: 6 CVEs HIGH em Next.js direta (1 middleware bypass, 2 SSRF, 1 DoS, 1 divulgação de Server Function endpoints, 1 rewrites SSRF); versão instalada `16.2.7`; fix ≥ `16.3.0`.

### F-security-2: `postcss@8.5.8` (direta) — leitura arbitrária de arquivos via `sourceMappingURL` durante build

- **Severidade**: **P1**
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/package.json`; toolchain de build (não runtime)
- **Evidência (objetiva)**:
  ```
  postcss: severity=high, isDirect=true, range=<=8.5.22, fixAvailable=true
    • GHSA-6g55-p6wh-862q — Arbitrary file read/info disclosure via attacker-controlled sourceMappingURL (HIGH, CVSS 7.5)
    • GHSA-r28c-9q8g-f849 — Path Traversal via previous source map auto-loading → Arbitrary .map disclosure (HIGH, CVSS 7.5)
    • GHSA-fxqj-rqcc-2cmp — Incomplete fix of GHSA-6g55-p6wh-862q (moderate)
    • GHSA-qx2v-qp2m-jg93 — XSS via Unescaped </style> in CSS Stringify Output (moderate)
  npm ls postcss → postcss@8.5.8
  ```
- **Impacto técnico**: A cadeia de build do Vercel (que roda em cima do Next.js) processa CSS com PostCSS. Se um pipeline aceitar CSS de terceiros ou uma dependência trouxer `sourceMappingURL` maliciosa, o build lê `.map` arbitrários do runner. No modelo desta feature, é vetor **contra o processo de build**, não runtime.
- **Impacto de negócio**: Menor risco de exploração do que F-security-1 (build-time, não pega usuário), mas P1 pelo CVSS 7.5 e por ser direta e trivialmente atualizável.
- **Métrica de baseline**: 4 CVEs em `postcss` direta (2 HIGH CVSS 7.5); versão instalada `8.5.8`; fix disponível.

### F-security-3: `AUTH_JWT_SECRET` continua verificando tokens após `AUTH_LEGACY_LOGIN_ENABLED=false` — janela latente durante Fase 3

- **Severidade**: **P2**
- **Tactic violada**: Restore · Revoke Access (superfície residual)
- **Localização**: `src/backend/http/auth.ts:191-208` (verify path HS256); `src/backend/http/authEnv.ts:131-136` (secret condicional); `render.yaml:79-81` (`AUTH_JWT_SECRET` marcada `sync: false` sem sequência automatizada de remoção); `AuthService.ts:66-82` (TTL do token = 12 h)
- **Evidência (objetiva)**:
  ```ts
  // routes/auth.ts:53-60 — Fase 3 desativa a EMISSÃO
  if (!legacyLoginEnabled) { res.status(410).json(...); return; }

  // http/auth.ts:191-201 — a VERIFICAÇÃO continua enquanto hsKey existir
  if (isSymmetricAlg(alg)) {
      if (!hsKey) throw new Error('HS256 token received but SUPABASE_JWT_SECRET is not configured');
      const { payload } = await jwtVerify(token, hsKey, { ...hsOptions, algorithms: ['HS256'] });
      return payload;
  }
  ```
- **Impacto técnico**: A Fase 3 do rollout desliga apenas `POST /auth/login`. O middleware segue aceitando **qualquer HS256 assinado com `AUTH_JWT_SECRET`** enquanto a variável estiver no ambiente. Tokens já emitidos vivem 12 h (`AuthService.ts:24`); um segredo comprometido produz tokens indefinidamente. Consolando: o `appUserContext` faz `findByAuthUserId(sub)`, e a coluna é `UUID` (`migrations/0044:33`) — o `sub` legado é o **e-mail** (`AuthService.ts:77`). Um token forjado atinge no máximo o **403 fail-closed** (que hoje é a defesa efetiva, não uma redundância).
- **Impacto de negócio**: Baixo dado o fail-closed, mas o `render.yaml` documenta remoção de `AUTH_JWT_SECRET` como "removível na Fase 4" (comentário `LEGADO DO ROLLOUT`, linhas 79-81) sem gate operacional. Se alguém puxar a flag de emissão e esquecer o secret, cria-se uma superfície residual atrás de uma promessa de "desligado" que só quem lê `http/auth.ts` reconhece.
- **Métrica de baseline**: janela residual = TTL do token HS256 = **12 h** após o cutover, extensível indefinidamente enquanto a env estiver setada; 1 variável (`AUTH_JWT_SECRET`) sem automação de remoção pareada com `AUTH_LEGACY_LOGIN_ENABLED=false`.

### F-security-4: Invalidação de cache **process-local** vira TTL cheio em silêncio ao escalar o Render

- **Severidade**: **P2**
- **Tactic violada**: Revoke Access · Detect Intrusion (a degradação seria silenciosa)
- **Localização**: `src/backend/domain/service/auth/AppUserContextCache.ts:28-45`
- **Evidência (objetiva)**: A própria docstring é o relatório:
  ```
  ## ⚠️ Restrição datada (2026-08-06) — a premissa que envelhece em silêncio
  A invalidação é local ao processo, e isso só é suficiente porque o backend roda em
  Render plan: starter — instância única (render.yaml).
  No dia em que houver mais de uma instância, a invalidação deixa de cruzar processos e a
  latência real de revogação vira o TTL cheio — sem erro, sem log, sem alarme.
  ```
- **Impacto técnico**: Cache Map por processo, chaveado por `auth_user_id`. Ao subir para 2+ instâncias, `UserAdminService.setAtivo` invalida no processo que atende a request de gestão mas **não no processo par**. O usuário desativado continua operando na segunda instância por até 30 s — sem sinal em log/métrica.
- **Impacto de negócio**: Regra de negócio "revogação em ≤ 30 s" (`business-rules/revogacao-de-acesso.md`) deixa de valer em silêncio no dia do primeiro `numInstances: 2`. Em domínio financeiro, um usuário desligado que finaliza um lote SISPAG ou baixa um `fin010` durante essa janela custa audit trail contestável.
- **Métrica de baseline**: `plan: starter` (single instance) na configuração atual — `render.yaml:10`. Nenhum health-check da premissa ("assert single instance") existe no código.

### F-security-5: `Detect Intrusion` termina em `console.warn` — sem métrica, sem alarme, sem detecção de burst

- **Severidade**: **P2**
- **Tactic violada**: Detect Intrusion
- **Localização**: `http/auth.ts:222-226`, `http/appUserContext.ts:94-99`, `http/auth.ts:283-286`
- **Evidência (objetiva)**:
  ```ts
  // http/auth.ts:222
  console.warn(`[auth] rejected request to ${req.method} ${req.originalUrl}:`, expired ? 'token expired' : 'invalid token');
  // http/appUserContext.ts:94
  console.warn(`[appUserContext] forbidden ${req.method} ${req.originalUrl}: ${reason} (sub='${req.user?.sub ?? 'none'}')`);
  // http/auth.ts:283
  console.warn(`[auth] forbidden ${req.method} ${req.originalUrl}: role='${role ?? 'none'}' not in [${allowed.join(', ')}]`);
  ```
  Não há aggregador (nem `logService` estruturado, nem CloudWatch/Datadog). `rateLimit.ts:15` **desliga o limiter em `NODE_ENV=test`** — é a única linha em toda a chain que fala em "burst", e é operacional (evitar 429 em testes), não de detecção.
- **Impacto técnico**: Um scanner tentando credenciais roubadas, sub inexistente, ou varredura de `/forgot-password` produz linhas no stdout do Render e mais nada. Passa despercebido até alguém abrir o drain de log.
- **Impacto de negócio**: A promessa "toda ação é auditada" cobre atos legítimos; não cobre **tentativas rejeitadas**. Em domínio de dinheiro, cada 401/403 é sinal barato de intenção — desperdiçá-lo é caro no dia do incidente.
- **Métrica de baseline**: 3 pontos de log de rejeição no código (auth, appUserContext, requireRole); 0 métrica emitida; 0 alarme configurado; janela do `heavyRouteLimiter` = 10 req/60s por IP (defesa passiva, não detecção).

### F-security-6: Pré-requisito humano `signup público OFF` não é observável no repositório e degrada em silêncio se religado

- **Severidade**: **P3**
- **Tactic violada**: Limit Exposure · Change Default Settings (pré-requisito de operação, fora do repo)
- **Localização**: ADR-0030 §10.1 (passo humano #1); `http/appUserContext.ts:69-73` (docstring cita explicitamente o cenário)
- **Evidência (objetiva)**:
  ```
  ADR-0030 §10.1: "Auth → Providers: desligar signup público. Sem isso, qualquer pessoa
  obtém um JWT válido do projeto. O 403 fail-closed é a segunda camada, não a primeira."
  ```
  Nenhum health-check, teste E2E, ou métrica confirma que a primeira camada está de fato ligada — o repositório trabalha assumindo o pior e depende só do 403.
- **Impacto técnico**: Se signup for religado em produção (ex.: alguém teste um provider e esqueça de desligar), qualquer pessoa na internet obtém `aud: 'authenticated'`. O fail-closed do `appUserContext` para o abuso de negócio, mas cada request faz um `SELECT` em `app_user` (mesmo com cache do `null`, o primeiro request para cada `sub` novo faz 1 query). Um botnet com 10 k subs distintos vira 10 k SELECTs em `app_user`.
- **Impacto de negócio**: DoS por leitura de banco possível sem defesa antes de o 403 dizer não. Como o cache do `null` dura 30 s por `sub`, um botnet que rotaciona subs escapa dele.
- **Métrica de baseline**: 1 passo humano bloqueante fora do repo (ADR-0030 §10.1); 0 health-check no código; TTL do cache de `null` = 30 s (`AppUserContextCache.ts:16`).

## 5. Cards Kanban

### [security-1] Subir `next` para ≥ 16.3.0 e `postcss` para ≥ 8.5.23 (fecha bypass de middleware + SSRF + leitura de source-map)

- **Problema**
  > `next@16.2.7` e `postcss@8.5.8` estão instalados como dependências diretas no frontend com **6 CVEs HIGH em Next.js** — incluindo um **bypass de middleware** do App Router (`GHSA-6gpp-xcg3-4w24`), que é exatamente o mecanismo que esta feature usa para proteger rotas antes da hidratação. `postcss` tem CVSS 7.5 de leitura arbitrária de arquivos via `sourceMappingURL`. Ambos têm `fixAvailable: true`.

- **Melhoria Proposta**
  > `npm audit fix` no `src/frontend/` (Next.js aceita `^16.2.7` → traz ≥ 16.3.0). Se o major bump quebrar algo, subir com `--force` só depois de rodar `npm run typecheck && npm run lint && npm test && npm run build`. Tactic Bass: **Verify Message Integrity / Authenticate Actors** (fecha a defesa que a feature acabou de instalar como server-side). Regravar o teste de `middleware.test.ts` se a API do matcher mudar.

- **Resultado Esperado**
  > `npm audit --json | jq '.metadata.vulnerabilities.high'`: **6 → 0** no frontend; `middleware bypass` fecha o vetor que anulava o `updateSession` server-side; o `postcss` deixa de ler `.map` arbitrários no runner do Vercel.

- **Tactic alvo**: Verify Message Integrity / Authenticate Actors
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1 d — inclui verificação da build e regressão do `middleware.test`)
- **Findings relacionados**: F-security-1, F-security-2
- **Métricas de sucesso**:
  - Frontend `npm audit` high: 6 → 0
  - Frontend `npm audit` total: 7 → ≤ 1 (a `low` de `@babel/core` transitiva permanece aceitável)
  - `next` versão instalada: 16.2.7 → ≥ 16.3.0
- **Risco de não fazer**: um dia sob exposição do bypass de middleware anula o `updateSession` server-side; SSRF do Next.js vira pivot para o Admin API do GoTrue com o `SUPABASE_SERVICE_ROLE_KEY` que vive no Vercel Env do backend serverless (se algum dia migrar) ou no Render.
- **Dependências**: nenhuma

### [security-2] Subir `axios` para ≥ 1.18.0 no backend (fecha DoS/prototype pollution na comunicação com Conexos/BCB)

- **Problema**
  > `axios@1.16.1` é dependência **direta** do backend, usada pelo `ConexosClient` e `BcbClient`. Três CVEs abertos (`GHSA-42h9-826w-cgv3` DoS por recursão, `GHSA-xj6q-8x83-jv6g` prototype pollution injetando Basic Auth, `GHSA-pmv8-rq9r-6j72` DoS por deep formToJSON) — todos em `<1.18.0`, `fixAvailable: true`.

- **Melhoria Proposta**
  > `npm audit fix` no `src/backend/`. Tactic Bass: **Validate Input** (o cliente HTTP é a fronteira com o Conexos; entrada do ERP também é external input). Rodar `npm test` — a suíte cobre 1.212 casos, prende regressão de request/response.

- **Resultado Esperado**
  > Backend `npm audit` high: 4 → **2 ou 3** (permanecem `brace-expansion`, `ip-address`, `js-yaml` transitivas); `axios` HIGH direta some. `axios` na versão ≥ 1.18.0.

- **Tactic alvo**: Validate Input
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: (deriva do metric de baseline em §2 — mesma família de F-security-1/2, mas backend)
- **Métricas de sucesso**:
  - `axios` versão: 1.16.1 → ≥ 1.18.0
  - Backend `npm audit` high direta: 1 → 0
- **Risco de não fazer**: a rota `POST /permutas` faz milhares de calls ao Conexos por request; DoS por recursão no `axios` é trivialmente atingível por resposta hostil do ERP.
- **Dependências**: nenhuma

### [security-3] Parear `AUTH_LEGACY_LOGIN_ENABLED=false` com remoção de `AUTH_JWT_SECRET` (runbook + assertion no boot)

- **Problema**
  > Desligar o login legado (Fase 3 do cutover) **não remove** a chave que verifica os tokens HS256 já emitidos. Enquanto `AUTH_JWT_SECRET` estiver no ambiente do Render, o `buildAuthMiddleware` aceita qualquer HS256 assinado com ela — janela residual de **12 h** (TTL do token, `AuthService.ts:24`) e potencialmente indefinida se a chave vazar. O fail-closed do `appUserContext` mitiga o risco de negócio hoje (`sub`=email não casa `UUID` do `app_user.auth_user_id`), mas a promessa "Fase 3 desliga o legado" só é verdadeira parcialmente.

- **Melhoria Proposta**
  > Assertion no boot: quando `AUTH_LEGACY_LOGIN_ENABLED=false`, o `loadAuthEnv()` deve **exigir** `AUTH_JWT_SECRET` ausente E `SUPABASE_URL` presente — crashar se `AUTH_JWT_SECRET` sobreviver ao flip. Documentar no `DEPLOY.md` a sequência (flip flag → derrubar tokens vivos aguardando 12 h → remover a env → redeploy). Tactic Bass: **Restore** (integridade do rollback path) + **Revoke Access** (fechar a superfície residual).

- **Resultado Esperado**
  > Janela de aceite HS256 pós-cutover ≤ TTL do token (12 h), com **remoção obrigatória**, não opcional; qualquer configuração inconsistente crasha no boot em vez de virar superfície latente.

- **Tactic alvo**: Restore / Revoke Access
- **Severidade**: P2
- **Esforço estimado**: S (uma condição em `loadAuthEnv` + 1 seção de `DEPLOY.md` + 1 teste de authEnv)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Testes de `authEnv.test.ts` cobrindo os 4 estados de (`legacyLoginEnabled`, `AUTH_JWT_SECRET`): 4/4 passando
  - `render.yaml` documenta a ordem — pareamento visível
- **Risco de não fazer**: um vazamento do `AUTH_JWT_SECRET` após a Fase 3 (por ex., snapshot de env compartilhado) reintroduz emissão de tokens fora do provedor sem que ninguém tenha ligado o legado — visível **só** no fail-closed. A defesa restante fica a 1 mudança de código de sumir (bastar `AuthService` passar a assinar com `sub=auth_user_id`).
- **Dependências**: `listPendingMigration()` retornando vazio (gate operacional da Fase 3)

### [security-4] Emitir métrica e alarme para invalidação de cache pré-scale-out do Render

- **Problema**
  > O cache de contexto de autorização é `Map` local ao processo (`AppUserContextCache.ts:28-45`). No dia em que o Render subir para `numInstances >= 2`, a invalidação sincronia deixa de cruzar processos e a latência real de revogação passa a ser **o TTL cheio (30 s)** — sem erro, sem log, sem alarme. A regra de negócio "revogação em ≤ 30 s" (`business-rules/revogacao-de-acesso.md`) passa a valer só localmente. Em domínio financeiro, um usuário desligado que finaliza um lote SISPAG ou baixa um `fin010` durante essa janela custa audit trail contestável.

- **Melhoria Proposta**
  > Duas defesas complementares: (a) **assert no boot** — se `RENDER_NUM_INSTANCES` (ou equivalente) > 1, `loadAuthEnv` crasha com mensagem apontando para `business-rules/revogacao-de-acesso.md`; (b) **métrica emitida** por `AppUserContextCache` (`invalidate` calls, `set(null)` calls) para o observability do backend. Tactic Bass: **Revoke Access** + **Detect Intrusion** (a degradação silenciosa é o modo de falha).

- **Resultado Esperado**
  > Escalar horizontalmente **para de ser um passo silencioso**: ou vira crash com apontamento para a regra a revisitar, ou vira alerta contra o TTL efetivo cheio. Continuar single-instance é OK e explícito.

- **Tactic alvo**: Revoke Access
- **Severidade**: P2
- **Esforço estimado**: M (assert é S; a instrumentação de métrica depende de padronizar o observability do backend, que hoje é `console.log`)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - 1 assert no boot cobrindo o cenário multi-instância
  - Cobertura de teste do assert: 100 %
- **Risco de não fazer**: a regra de negócio de revogação vira letra morta no dia do primeiro `numInstances: 2` sem qualquer sinal.
- **Dependências**: nenhuma

### [security-5] Estruturar sinal de rejeições de auth para agregação (Detect Intrusion)

- **Problema**
  > 401/403 aterrissam em `console.warn` no stdout do Render (`http/auth.ts:222`, `http/appUserContext.ts:94`, `http/auth.ts:283`). Não há métrica emitida, contador, alarme por burst, nem detecção adaptativa por IP/sub. Um scanner tentando credenciais roubadas produz linhas de log e nada mais — o sinal mais barato para detectar tentativa hostil é desperdiçado.

- **Melhoria Proposta**
  > Emitir métrica estruturada (contador rotulado por `outcome` ∈ {`invalid_token`, `expired`, `no_row`, `inactive`, `role_forbidden`} e `route`) e configurar alarme em produção para bursts (ex.: > 20 rejeições em 60 s por IP/sub). Tactic Bass: **Detect Intrusion**. Rota de sinal já existe (`console.warn` centralizado); o passo é substituir por `logService.warn` estruturado e conectar ao drain de métrica do Render.

- **Resultado Esperado**
  > Um scanner varrendo `/forgot-password` ou `POST /auth/login` acende alarme na 21ª tentativa. Bursts de 403 em `requireRole('admin')` viram sinal endereçável (indicam token/refresh comprometido do admin).

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: M (a padronização do logger estruturado atravessa vários arquivos)
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - 3 pontos de log migrados para métrica com labels
  - 1 alarme por burst configurado (ferramenta a definir)
- **Risco de não fazer**: no dia do incidente, o único artefato de detecção é `grep` no stdout — não escala e não avisa.
- **Dependências**: decisão de observability tool (Render Native Metrics ou externo)

### [security-6] Adicionar health-check ao boot que confirma que o signup público do Supabase está desligado

- **Problema**
  > A ADR-0030 §10.1 lista "desligar signup público" como o primeiro passo humano bloqueante, e a docstring do `appUserContext` reconhece explicitamente que o 403 fail-closed é a **segunda** camada. Ninguém no repositório confirma o estado da primeira. Se signup for religado por engano em produção, qualquer pessoa na internet obtém um JWT com `aud: 'authenticated'`; o fail-closed impede abuso de negócio, mas cada `sub` novo dispara um `SELECT` em `app_user` que o cache do `null` só absorve por 30 s.

- **Melhoria Proposta**
  > No `bootstrapAppContainer` (ou passo dedicado no boot), chamar o Admin API `GET /auth/v1/settings` (ou equivalente) e falhar alto se `disable_signup !== true`. Tactic Bass: **Limit Exposure / Change Default Settings** — mover a defesa mais externa para dentro do repositório, onde há teste e revisão.

- **Resultado Esperado**
  > Um deploy que herda signup público ligado do Supabase **não sobe**. A primeira camada da defesa dupla vira observável no código, não só na ADR.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (uma chamada HTTP no boot; requer a service-role key, já disponível)
- **Findings relacionados**: F-security-6
- **Métricas de sucesso**:
  - 1 assert no boot cobrindo `disable_signup=true`
  - 1 teste de integração cobrindo a falha
- **Risco de não fazer**: a "primeira camada" é 100 % operacional — passo humano num painel externo, sem CI, sem observabilidade. Um scanner que descobrir signup ligado explora o modo degradado do `appUserContext` (cache miss por sub distinto = 1 SELECT) para DoS por leitura.
- **Dependências**: `SUPABASE_SERVICE_ROLE_KEY` configurada (já é pré-requisito da feature).

## 6. Notas do agente

- **Não medi vulnerabilidades por tenant nem posturas de IAM.** Não há `infra/` — declarei explicitamente as tactics dependentes de perímetro AWS como não medíveis, sem inferir ausência (por instrução do orquestrador em `_shared-metrics.md`).
- **Achados carry-over do `_shared-metrics.md` (filialAuthz fail-OPEN, `CONEXOS_CRED_ENC_KEY` ausente) NÃO foram duplicados** — permanecem em `ontology/_inbox/supabase-auth-regis-followups.md` e no histórico de 6 runs consecutivos. Referenciados na tabela §3 apenas para não pintar como ✅ o que continua ⚠️.
- **Cross-QA para o consolidator:**
  - **Fault Tolerance ↔ F-security-3 e F-security-4** — a integridade do rollback e a invalidação de cache pisam nas duas QAs.
  - **Availability ↔ F-security-1, F-security-4, F-security-6** — Next.js middleware bypass abre porta pré-hidratação; cache local degrada em escala; signup ligado sem defesa vira vetor de DoS por leitura.
  - **Testability ↔ F-security-3, F-security-4, F-security-6** — as três valem-se de asserts no boot cobrando teste; a suíte hoje não expõe o cenário.
  - **Integrability** — a chamada `GET /auth/v1/settings` proposta em security-6 é integração nova com o Supabase Admin API.
- **Score 7.5/10** justificado: a feature entrega tactics fortes e testadas (fail-closed 403, alg-aware JWT com regressão nomeada, anti-enumeração, service-role backend-only com teste-guarda, `redactBody` cobrindo todas as grafias, DEV_AUTH_BYPASS deny-by-default, revogação sincronia com barreira dupla), mas herda 15 vulnerabilidades de dependência (2 diretas HIGH que aterrissam **exatamente** no gate que a feature instala) e leva adiante o carry-over do `filialAuthz` que agora "torna barato de fechar" mas segue aberto no 6º run.
