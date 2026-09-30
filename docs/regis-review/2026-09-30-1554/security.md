---
qa: Security
qa_slug: security
run_id: 2026-09-30-1554
agent: qa-security
generated_at: 2026-09-30T16:30:00-03:00
scope: all
score: 8
findings_count: 5
cards_count: 5
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Atacante externo (anônimo ou com token de outro emissor/projeto) e insider com token legado | Força bruta em `/auth/login`; token forjado (HS256 com `alg` trocado, `anon`/`service_role`, sessão anônima); roubo de refresh token via XSS | `http/auth.ts`, `http/authEnv.ts`, `routes/auth.ts`, `SupabaseSessionService`, `lib/auth/token.ts` | Produção Render, dois emissores convivendo (HS256 app + ES256 Supabase) | Recusar 401 sem tocar o GoTrue; limitar tentativas; revogar sessão no logout; registrar divergências | 0 tokens de emissor/audiência/role errados aceitos; login limitado a 20/min/IP e 10 falhas/15 min/identificador; 100% das recusas com trilha |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 (chaves lidas via `EnvironmentProvider`/Zod em `authEnv.ts`) | 0 | ✅ | leitura de `authEnv.ts`, `SupabaseAuthClient.ts` |
| Bypass de auth fora de ambiente local | Boot falha (deny-by-default, `LOCAL_ENVIRONMENTS` de 4 nomes) | falha | ✅ | `http/authEnv.ts` |
| Opções de verificação por emissor | 2 caminhos separados: HS256 (`aud`) e ES256 (`iss`+`aud`+`role`+`is_anonymous`) | separados | ✅ | `http/auth.ts` `buildVerifyAccessToken` |
| Confusão de algoritmo | `algorithms` fixo por caminho (`['HS256']` / `['ES256']`) | fixo | ✅ | `http/auth.ts` |
| Chave secreta no bundle do front | 0 ocorrências (build reporta bundle sem URL/chave) | 0 | ✅ | `_shared-metrics.md` |
| Rate limit de sessão | login 20/min/IP; 10 falhas/15 min/identificador; refresh 30/min/IP; store em memória | presente | ✅ | `http/rateLimit.ts` |
| Rotas de auth com Zod no corpo | 2/2 com corpo (`login`, `refresh`); `logout` sem corpo | 100% | ✅ | `routes/auth.ts` |
| `dangerouslySetInnerHTML` no front | 0 | 0 | ✅ | grep em `app/`, `components/`, `lib/` |
| Tokens em `localStorage` | 4 chaves (access, refresh, username, expiresAt) | cookie httpOnly | ⚠️ | `lib/auth/token.ts` |
| CSP configurada no front | 0 ocorrências de `Content-Security-Policy`/`headers()` em `next.config.*` | presente | ⚠️ | grep em `src/frontend/next.config.*` |
| Falha de login no modo supabase com log | 0 de 2 caminhos de recusa por senha (`SupabaseAuthRejectedError` retorna `null` sem log) | 100% | ⚠️ | `SupabaseSessionService.ts:login` |
| IAM, CloudTrail, GuardDuty, CORS de infra, `npm audit` | ⚠️ **Não medível localmente**: sem `infra/`; `--quick` pula audit. Recomendação: medir no painel Render/Supabase e rodar `npm audit` no próximo ciclo completo | n/a | ⚠️ | n/a |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Divergências de auth logadas (`AUTH_DIVERGENCIA`); recusas de token com `console.warn`; sem alarme agregado | ⚠️ parcial | `http/auth.ts`, `SupabaseSessionService.ts` |
| Detect Service Denial | Rate limiters global (100/min) e de sessão; sem alarme | ⚠️ parcial | `http/rateLimit.ts` |
| Verify Message Integrity | JWT assinado, verificado por JWKS ES256 / HS256 com alg fixo | ✅ presente | `http/auth.ts` |
| Detect Message Delay | N/A: sem mensageria assinada com timestamp; `exp` do JWT cobre o caso | N/A | `jwtVerify` (exp) |
| Identify Actors | `req.user` reescrito para `app_user.username` pelo `resolverAcesso` | ✅ presente | `http/acesso.ts`, `auth.ts` docstring |
| Authenticate Actors | GoTrue (senha) ou bcrypt próprio; `role=authenticated`, recusa `is_anonymous` | ✅ presente | `SupabaseSessionService.ts`, `auth.ts` |
| Authorize Actors | RBAC no banco, nunca lê `role`/`email` do token; `user_metadata` ignorado | ✅ presente | `auth.ts` (`AuthUser`), `acesso.ts` |
| Limit Access | Chave secreta só no backend; login resolve no banco antes de chamar o GoTrue; migration 0070 revoga TRUNCATE/REFERENCES/TRIGGER de `anon`/`authenticated` | ✅ presente | `SupabaseAuthClient.ts`, `0070_*.sql` |
| Limit Exposure | Sem multi-conta nem `infra/`; front só fala com `/auth/*` (proxy) | ⚠️ parcial | `routes/auth.ts` |
| Encrypt Data | TLS pelo provedor; refresh token em claro no `localStorage` | ⚠️ parcial | `token.ts` |
| Separate Entities | Verificação por emissor; janela HS256 fecha ao apagar `AUTH_JWT_SECRET` | ✅ presente | `authEnv.ts` |
| Change Default Settings | `AUTH_PROVIDER` default `local`; fail-fast por variável ausente; segredo HS256 legado do Supabase deixou de ser lido | ✅ presente | `authEnv.ts` |
| Validate Input | Zod em login/refresh; env validado por Zod | ✅ presente | `routes/auth.ts`, `authEnv.ts` |
| Revoke Access | Logout revoga no GoTrue (melhor esforço); `ativo` checado a cada requisição (≤30 s); refresh não checa `ativo` | ⚠️ parcial | `SupabaseSessionService.ts`, `routes/auth.ts` |
| Lock Computer | Bloqueio por identificador (10 falhas/15 min) | ✅ presente | `rateLimit.ts` |
| Inform Actors | Modal de sessão expirada; alerta de divergência só em log | ⚠️ parcial | `SessionExpiredModal.tsx` |
| Restore | Rollback por `AUTH_PROVIDER=local` + restart; runbook em `DEPLOY.md` §6; migration aditiva | ✅ presente | `authEnv.ts`, ADR-0056 |
| Audit Trail | `AUTH_SESSAO` (login, refresh, logout) em `LogService`; falha de senha no modo supabase sem registro | ⚠️ parcial | `SupabaseSessionService.ts` |

## 4. Findings (achados)

### F-security-1: Recusa de senha no modo supabase não deixa trilha

- **Severidade**: P2
- **Tactic violada**: Audit Trail / Detect Intrusion
- **Localização**: `src/backend/domain/service/auth/SupabaseSessionService.ts` (`login`, ramo `SupabaseAuthRejectedError`)
- **Evidência (objetiva)**:
  ```
  if (!(error instanceof SupabaseAuthRejectedError)) throw error;
  if (error.code === GOTRUE_USER_BANNED) { await this.divergencia(...) }
  return null;   // senha errada: nenhum log
  ```
- **Impacto técnico**: senha errada, usuário inexistente, inativo ou sem vínculo retornam 401 sem registro no `LogService`; só o `console.warn` do middleware cobre tokens inválidos, não logins falhos. Sem base para alarme de força bruta.
- **Impacto de negócio**: um ataque de credential stuffing contra contas que autorizam remessa ou permuta só seria percebido pelo bloqueio do limitador.
- **Métrica de baseline**: 0 de 4 caminhos de recusa de login (senha, inexistente, inativo, sem vínculo) com log de evento.

### F-security-2: Access e refresh token no `localStorage` sem CSP

- **Severidade**: P2
- **Tactic violada**: Limit Exposure / Encrypt Data
- **Localização**: `src/frontend/lib/auth/token.ts`; `src/frontend/next.config.*`
- **Evidência (objetiva)**:
  ```
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, sessao.refreshToken)
  grep CSP em next.config.*: 0 ocorrências
  ```
- **Impacto técnico**: qualquer XSS (dependência comprometida, extensão) lê o refresh token, que renova a sessão além do `exp` do access token. Antes da feature só existia o access token (curto); agora o alvo dura mais. Mitigado por `dangerouslySetInnerHTML` = 0 e Biome/ESLint.
- **Impacto de negócio**: sessão roubada de analista com poder de finalizar lote SISPAG.
- **Métrica de baseline**: 4 chaves de sessão em `localStorage`; 0 cabeçalhos CSP. Risco aceito na ADR-0056, o que justifica P2 e não P1.

### F-security-3: Limitador por identificador permite bloquear a conta alheia e cresce sem teto

- **Severidade**: P2
- **Tactic violada**: Lock Computer / Detect Service Denial
- **Localização**: `src/backend/http/rateLimit.ts` (`porIdentificador`, `keyGenerator`)
- **Evidência (objetiva)**:
  ```
  limit: 10, windowMs: 15 * 60_000, keyGenerator: `login:${identificadorDoLogin(req)}`
  store: MemoryStore padrão (uma instância Render)
  ```
- **Impacto técnico**: qualquer um faz 10 logins errados de um identificador válido e tranca o dono por até 15 min, a partir de IPs diferentes (o limite por IP é 20/min). Chaves de identificadores arbitrários ocupam memória até a janela expirar. Reinício do processo zera todos os baldes.
- **Impacto de negócio**: analista impedido de operar na janela de fechamento, sem nenhum custo para o atacante.
- **Métrica de baseline**: 10 falhas bastam para 15 min de bloqueio; 0 alarmes sobre isso.

### F-security-4: Logout com access token expirado não revoga a sessão

- **Severidade**: P3
- **Tactic violada**: Revoke Access
- **Localização**: `src/backend/routes/auth.ts` (`/logout`)
- **Evidência (objetiva)**:
  ```
  const verificado = await verifyAccessToken(token).catch(() => undefined);
  if (verificado?.emissor === 'supabase') { ... logout(token, sub) }   // sempre 204
  ```
- **Impacto técnico**: token vencido cai no `catch` e responde 204 sem revogar o refresh token, que segue válido no GoTrue. O front limpa o `localStorage`, então só importa se o refresh já tiver sido copiado.
- **Impacto de negócio**: janela de reuso de sessão após o "sair" do usuário.
- **Métrica de baseline**: 1 caminho de logout (token expirado) sem revogação server-side.

### F-security-5: Janela de convivência HS256 sem prazo de fim

- **Severidade**: P3
- **Tactic violada**: Separate Entities / Change Default Settings
- **Localização**: `src/backend/http/authEnv.ts`, `http/auth.ts`
- **Evidência (objetiva)**:
  ```
  app: aceito enquanto AUTH_JWT_SECRET existir (AuthService não emite iss)
  ```
- **Impacto técnico**: enquanto o segredo existir, quem o obtiver forja token com qualquer `sub` (o `resolverAcesso` ainda checa o banco). O fechamento depende de ação manual sem data.
- **Impacto de negócio**: dois segredos de longa vida (`AUTH_JWT_SECRET` e chave secreta do Supabase) em Render.
- **Métrica de baseline**: 1 caminho HS256 aberto, 0 data de encerramento registrada.

## 5. Cards Kanban

### [security-1] Registrar recusas de login e alarmar sobre elas

- **Problema**
  > Em `AUTH_PROVIDER=supabase`, senha errada, usuário inexistente, inativo ou sem vínculo retornam 401 sem evento no `LogService` (0 de 4 caminhos). Sem trilha não há alarme de força bruta.

- **Melhoria Proposta**
  > Emitir `LogService.warn` `AUTH_SESSAO` com `username` normalizado, motivo genérico e IP em cada `return null` de `SupabaseSessionService.login` (e no `AuthService`); contar por janela e alarmar quando passar de um limiar. Nunca logar senha.

- **Resultado Esperado**
  > 100% das recusas de login com evento; alerta a partir de N falhas/15 min.

- **Tactic alvo**: Detect Intrusion / Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1, F-security-3
- **Métricas de sucesso**:
  - Caminhos de recusa com log: 0/4 → 4/4
  - Alarme de falha de login: ausente → presente
- **Risco de não fazer**: credential stuffing só é notado quando alguém entra.
- **Dependências**: nenhuma.

### [security-2] Endurecer a sessão do navegador (CSP e escopo do refresh token)

- **Problema**
  > Refresh token no `localStorage` (4 chaves) e nenhum CSP: um XSS rouba uma sessão renovável.

- **Melhoria Proposta**
  > Adicionar `Content-Security-Policy` (script-src 'self' + nonce) e demais cabeçalhos em `next.config`; avaliar levar o refresh token para cookie httpOnly SameSite=Strict via o proxy `/auth/*` (com proteção CSRF); revisitar a ADR-0056.

- **Resultado Esperado**
  > CSP presente; refresh token inacessível a JavaScript.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Cabeçalhos CSP: 0 → 1
  - Tokens legíveis por JS: 2 → 1 (access apenas)
- **Risco de não fazer**: uma dependência comprometida no front vira acesso a operações financeiras.
- **Dependências**: nenhuma.

### [security-3] Tornar o bloqueio por identificador menos abusável

- **Problema**
  > 10 falhas bloqueiam a conta por 15 min de qualquer IP; o balde vive em memória, sem teto de chaves, e some no restart.

- **Melhoria Proposta**
  > Chavear também por IP+identificador (o bloqueio total só após mais falhas), limitar o número de chaves do store, e emitir alerta ao Inform Actors quando um identificador é bloqueado. Persistir o store só se houver mais de uma instância.

- **Resultado Esperado**
  > Bloqueio de terceiros deixa de ser trivial e fica visível.

- **Tactic alvo**: Lock Computer
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Falhas de um único IP necessárias para trancar um usuário: 10 → limite por par IP+identificador
  - Alerta de bloqueio: ausente → presente
- **Risco de não fazer**: negação de serviço dirigida a um analista na janela de fechamento.
- **Dependências**: security-1.

### [security-4] Revogar o refresh token também com access token expirado

- **Problema**
  > `/auth/logout` só revoga quando o access token ainda verifica; vencido, responde 204 sem revogar.

- **Melhoria Proposta**
  > Aceitar token vencido no logout (verificar assinatura com `clockTolerance` ou ignorar `exp`) só para extrair `sub` e chamar o `logout` do GoTrue; ou aceitar o refresh token no corpo.

- **Resultado Esperado**
  > Todo logout de sessão Supabase revoga no servidor.

- **Tactic alvo**: Revoke Access
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Caminhos de logout sem revogação: 1 → 0
- **Risco de não fazer**: refresh tokens copiados sobrevivem ao "sair".
- **Dependências**: nenhuma.

### [security-5] Fixar data para fechar o caminho HS256 e girar os segredos

- **Problema**
  > O caminho HS256 fica aberto enquanto `AUTH_JWT_SECRET` existir, sem data para acabar.

- **Melhoria Proposta**
  > Registrar no runbook (`DEPLOY.md` §6) a data-alvo para apagar `AUTH_JWT_SECRET`, girar a chave secreta do Supabase após o corte, e alarmar (via `ConfigDoctor`) se `AUTH_PROVIDER=supabase` e o segredo HS256 ainda existirem após a data.

- **Resultado Esperado**
  > 1 caminho HS256 aberto → 0 após o corte.

- **Tactic alvo**: Separate Entities
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - Caminhos de verificação abertos: 2 → 1
  - Segredos de longa vida em Render: 2 → 1
- **Risco de não fazer**: o segredo legado permanece indefinidamente, com o mesmo alcance de um token válido.
- **Dependências**: corte completo para o modo supabase.

## 6. Notas do agente

- Escopo: delta `76b5182..HEAD` em auth (backend e front). Sem `infra/`: IAM, CloudTrail, GuardDuty e CORS de infra não medíveis. `npm audit` pulado (--quick).
- A verificação de token (alg fixo, `iss`/`aud`/`role`/`is_anonymous`, `user_metadata` ignorado, RBAC no banco) está sólida; nenhum P0/P1 encontrado no delta.
- Cross-QA: Audit Trail com Fault Tolerance (security-1); Lock Computer/Detect Service Denial com Availability (security-3); Restore com Deployability (rollback por `AUTH_PROVIDER`); Validate Input com Integrability (respostas do GoTrue validadas por Zod).
