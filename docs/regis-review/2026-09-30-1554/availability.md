---
qa: Availability
qa_slug: availability
run_id: 2026-09-30-1554
agent: qa-availability
generated_at: 2026-09-30T16:30:00-03:00
scope: all
score: 7
findings_count: 5
cards_count: 4
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro / auth-supabase)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dependência externa (Supabase Auth / GoTrue) | Indisponibilidade, 5xx, 429 ou lentidão do GoTrue durante login, refresh ou escrita de credencial | `SupabaseAuthClient`, `SupabaseSessionService`, `CredentialMirror`, `routes/auth.ts`, `lib/auth/session-refresh.ts` | Operação normal, `AUTH_PROVIDER=supabase`, analistas com sessão aberta | Sessões já emitidas seguem valendo (verificação local por JWKS em cache); login e refresh falham de forma explícita (503/429) sem travar o processo; escritas de credencial fazem rollback ou registram divergência reparável; o front não derruba sessão válida por falha transitória | 0 sessões ativas derrubadas por blip do GoTrue < 1 min; chamada ao GoTrue limitada a 10 s; 100% das falhas com log `AUTH_INDISPONIVEL`; divergência reparada pelo `sync-supabase-auth` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Timeout explícito no client novo (`SupabaseAuthClient`) | 1/1 (10 s, `AbortSignal.timeout`) | 100% | ✅ | `domain/client/SupabaseAuthClient.ts` (`REQUEST_TIMEOUT_MS`, `buscar`) |
| Timeout no `fetch` do front (`/auth/refresh`) | 0/1 | 100% | ⚠️ | `src/frontend/lib/auth/session-refresh.ts` (`renovar`) |
| Operações do client com Retry | 2/9 (só leituras admin: `adminGetUser`, `adminListUsers`; login e escritas deliberadamente sem retry) | escritas não repetidas: correto | ✅ | `SupabaseAuthClient.ts` (`adminReadRetry`) |
| Erros do GoTrue mapeados para 503/429 | 5xx, timeout, rede, resposta ruim → 503; 429 → 429 | 100% | ✅ | `routes/auth.ts` (`responderIndisponivel`) |
| Distinção de 503/429 vs 401 no refresh do front | 0 de 2 distinguidos (qualquer `!res.ok` → sessão expirada) | 2 de 2 | ❌ | `session-refresh.ts` (`if (!res.ok) return null`) |
| Fail-closed quando o banco de permissões falha | 503 (nunca libera) | fail-closed | ✅ | `http/acesso.ts` |
| Rate limit protegendo o balde do GoTrue | 20/min/IP + 10 falhas/15 min/identificador (login), 30/min/IP (refresh) | presente | ✅ | `http/rateLimit.ts` |
| Chamadas ao GoTrue dentro de transação com linha travada | até 3 sequenciais (create, list, update) = pior caso 30 s de lock | ≤ 1 | ⚠️ | `CredentialMirror.ts` (`criarEVincular`, `vincularExistente`) |
| Alarmes / dashboards de `AUTH_INDISPONIVEL` | 0 (só log) | ≥ 1 alerta | ❌ | `grep AUTH_INDISPONIVEL src/backend` |
| Acoplamento cross-tenant (`shared_account_id`) | N/A (sem `infra/`, 1 tenant) | 0 | N/A | CLAUDE.md |
| DLQ / CloudWatch / Terraform | não medível (sem `infra/`, sem SQS) | — | N/A | CLAUDE.md |
| Baseline testes/lint/typecheck | ✅ 3111 + 625 testes, 0 erros | verde | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: MTTR e taxa real de falha do GoTrue em produção. Requer Render Logs / consulta aos logs `AUTH_INDISPONIVEL`. Recomendação: contar `AUTH_INDISPONIVEL` por `motivo` e medir `duracaoMs` (já emitidos) num painel do `painel-operacao`.

## 3. Tactics — Cobertura no financeiro (feature auth-supabase)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum probe ativo do GoTrue | ❌ ausente | — |
| Heartbeat | N/A — sem scheduler nem processo monitorado ativo | N/A | CLAUDE.md |
| Monitor | Log estruturado de toda falha com operação/status/duração/motivo; sem alarme | ⚠️ parcial | `SupabaseAuthClient.ts` (`logarFalha`) |
| Timestamp | N/A — não há ordenação distribuída de eventos | N/A | — |
| Sanity Checking | `sub` da sessão conferido contra `auth_user_id`; Zod em toda resposta do GoTrue; `role`/`aud`/`iss`/`is_anonymous` no token | ✅ presente | `SupabaseSessionService.ts`, `SupabaseAuthClient.ts`, `http/auth.ts` |
| Condition Monitoring | `isAdminConfigured()` decide espelhar ou não; divergências viram `AUTH_DIVERGENCIA` | ⚠️ parcial | `CredentialMirror.ts` (`preparar`) |
| Voting | N/A — sem réplicas computando o mesmo resultado | N/A | — |
| Exception Detection | Erros tipados (`Unavailable` com `reason`/`retryable`, `Rejected`, `EmailConflict`) | ✅ presente | `SupabaseAuthClient.ts` (`erroDaResposta`) |
| Self-Test | Sem smoke de login pós-deploy automatizado (só runbook manual) | ⚠️ parcial | `DEPLOY.md` §6 |
| Active Redundancy | N/A — GoTrue é SaaS gerenciado, sem segundo emissor ativo | N/A | — |
| Passive Redundancy | Emissor local (HS256/bcrypt) mantido como caminho de rollback; troca manual por env | ⚠️ parcial | `routes/auth.ts` (`modoAtual`), `DEPLOY.md` |
| Spare | `AUTH_PROVIDER=local` como spare frio | ⚠️ parcial | `DEPLOY.md` |
| Exception Handling | `responderIndisponivel` → 503/429 com mensagem ao usuário; logout best-effort | ✅ presente | `routes/auth.ts`, `SupabaseSessionService.ts` (`logout`) |
| Rollback | Escrita local + espelho GoTrue na mesma transação: falha do GoTrue = ROLLBACK; runbook de rollback por fase | ✅ presente | `CredentialMirror.ts`, `DEPLOY.md` |
| Software Upgrade | Migração 0070 aditiva/anulável; código antigo a ignora | ✅ presente | `DEPLOY.md` (runbook de rollback) |
| Retry | `RetryExecutor` só em leituras admin, com `shouldRetry` por `retryable`; escrita nunca repete | ✅ presente | `SupabaseAuthClient.ts` |
| Ignore Faulty Behavior | Rate limit por IP e por identificador antes do GoTrue | ✅ presente | `http/rateLimit.ts` |
| Degradation | Desativar usuário nunca bloqueia pelo GoTrue (comita `ativo=false`; corte por `ativo` a cada requisição ≤ 30 s); sessões vigentes seguem sem GoTrue | ✅ presente | `CredentialMirror.ts` (`banir`) |
| Reconfiguration | Troca de emissor por `AUTH_PROVIDER` exige env + redeploy; sem chaveamento automático | ⚠️ parcial | `routes/auth.ts` |
| Shadow | N/A — cutover por fases manuais, sem operação em sombra | N/A | `DEPLOY.md` §6 |
| State Resynchronization | `sync-supabase-auth` (dry-run + `--execute`) repara divergências app_user ↔ GoTrue | ✅ presente | `jobs/sync-supabase-auth.ts` |
| Escalating Restart | N/A — sem supervisor próprio (Render reinicia) | N/A | — |
| Non-Stop Forwarding | Verificação de token segue via JWKS remoto em cache (defaults do `jose`, não verificados no código) | ⚠️ parcial | `http/auth.ts` (`createRemoteJWKSet`) |
| Removal from Service | N/A — sem componente para retirar de serviço | N/A | — |
| Transactions | Escrita de credencial atômica com linha travada e passo antes do COMMIT | ✅ presente | `CredentialMirror.ts`, `UserAdminService.ts` |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | Zod nos boundaries, timeout 10 s, limite de 50 páginas na listagem admin | ✅ presente | `SupabaseAuthClient.ts` |
| Increase Competence Set | Login degrada para 401 genérico em divergência em vez de erro 500 | ⚠️ parcial | `SupabaseSessionService.ts` (`login`) |

## 4. Findings (achados)

### F-availability-1: Refresh do front trata 503/429/rede como sessão expirada

- **Severidade**: P1
- **Tactic violada**: Degradation / Exception Handling
- **Localização**: `src/frontend/lib/auth/session-refresh.ts` (`renovar`), `src/frontend/lib/http.ts` (delta)
- **Evidência (objetiva)**:
  ```
  if (!res.ok) return null          // 401, 429 e 503 tratados igual
  ...
  } catch { return null }           // erro de rede idem
  // http.ts: novo === null -> emitSessionExpired(); throw SessionExpiredError
  ```
  O backend distingue (GoTrue fora → 503, limite → 429, `routes/auth.ts`); o front descarta a distinção.
- **Impacto técnico**: um blip do GoTrue ou do Render no momento da renovação abre o modal de sessão expirada, embora o refresh token siga válido. A renovação é proativa (5 min antes do `expiresAt`) e no 401, então toda sessão ativa se expõe.
- **Impacto de negócio**: o analista perde o contexto de trabalho (alocação N:M, lote SISPAG em montagem) por falha transitória de terceiro, e refaz o login talvez com o GoTrue ainda fora.
- **Métrica de baseline**: 0 de 2 códigos de indisponibilidade (503, 429) distinguidos de 401; 0 tentativas de nova renovação; 1 caminho de código.

### F-availability-2: Login sem caminho automático quando o GoTrue cai

- **Severidade**: P2
- **Tactic violada**: Passive Redundancy / Reconfiguration
- **Localização**: `src/backend/routes/auth.ts` (`modoAtual` no `/login`), `DEPLOY.md` (tabela de env e runbook de rollback)
- **Evidência (objetiva)**:
  ```
  (await modoAtual()) === 'supabase' ? SupabaseSessionService.login : AuthService.login
  // escolha por env, não por saúde; login/refresh sem retry (deliberado)
  ```
- **Impacto técnico**: durante a queda do GoTrue, 100% dos novos logins retornam 503; só as sessões já emitidas sobrevivem (token verificado localmente).
- **Impacto de negócio**: analistas ainda não logados ficam sem acesso às frentes até o retorno do Supabase, ou até um operador reverter o env. Com ~15 usuários o alcance é limitado.
- **Métrica de baseline**: 1 dependência externa no caminho de login, 0 fallbacks automáticos, rollback = 1 mudança de env + 1 redeploy (tempo não medido). P2 por ser decisão registrada (ADR-0056) e o hash local manter o rollback viável.

### F-availability-3: Escrita de credencial segura a linha travada durante até 3 chamadas ao GoTrue

- **Severidade**: P2
- **Tactic violada**: Exception Prevention / Transactions
- **Localização**: `src/backend/domain/service/auth/CredentialMirror.ts` (`criarEVincular`, `vincularExistente`), `SupabaseAuthClient.ts` (`REQUEST_TIMEOUT_MS`)
- **Evidência (objetiva)**:
  ```
  criarEVincular: adminCreateUser -> (409) vincularExistente: adminFindUserByEmail (até 50 páginas) + adminUpdateUser
  cada chamada com timeout 10 s, dentro da transação com a linha do app_user travada
  ```
- **Impacto técnico**: no pior caso, dezenas de segundos com uma conexão do pool e o lock retidos. Com ~15 usuários a listagem é 1 página, então o risco real é baixo.
- **Impacto de negócio**: cadastro/reativação de usuário lento sob GoTrue degradado; não afeta o fluxo financeiro.
- **Métrica de baseline**: até 3 chamadas sequenciais × 10 s = 30 s de lock no pior caso típico (alvo ≤ 1 chamada).

### F-availability-4: Falha do GoTrue só gera log, sem alerta

- **Severidade**: P2
- **Tactic violada**: Monitor
- **Localização**: `SupabaseAuthClient.ts` (`logarFalha`), `LOG_TYPE.AUTH_INDISPONIVEL`
- **Evidência (objetiva)**: `grep AUTH_INDISPONIVEL src/backend` mostra emissor único e nenhum consumidor (painel, alerta, job). Sem `infra/` não há alarme de nuvem.
- **Impacto técnico**: o operador só descobre o GoTrue fora quando o usuário reclama.
- **Impacto de negócio**: o tempo de detecção depende de chamado de usuário em horário comercial da Columbia.
- **Métrica de baseline**: 0 alertas / 0 painéis sobre `AUTH_INDISPONIVEL` (alvo ≥ 1).

### F-availability-5: Sem timeout no `fetch` de refresh, sob `navigator.locks`

- **Severidade**: P3
- **Tactic violada**: Exception Prevention
- **Localização**: `src/frontend/lib/auth/session-refresh.ts` (`refreshSession`, `renovar`)
- **Evidência (objetiva)**: `fetch(`${API}/auth/refresh`, {...})` sem `signal`, dentro de `lock.request(LOCK_RENOVACAO, ...)` e da promessa `emVoo` compartilhada.
- **Impacto técnico**: se o backend travar (ex.: cold start do Render), todas as abas esperam a mesma renovação; o backend limita o GoTrue a 10 s, então o teto é esse valor mais o cold start.
- **Impacto de negócio**: requisições 401 ficam penduradas em vez de falhar rápido; incômodo, sem perda de dados.
- **Métrica de baseline**: 0/1 `fetch` de auth do front com timeout.

## 5. Cards Kanban

### [availability-1] Distinguir indisponibilidade de expiração na renovação de sessão do front

- **Problema**
  > `refreshSession` devolve `null` para qualquer `!res.ok` ou exceção, então 503 (GoTrue fora) e 429 viram "Sessão expirada" e abrem o modal de relogin, embora o refresh token siga válido.

- **Melhoria Proposta**
  > Tactic Degradation: só 401 do `/auth/refresh` encerra a sessão. Em 503/429/erro de rede, manter a sessão, repetir a renovação com backoff curto (ex.: 2 tentativas, 1 s e 3 s) e, esgotadas, propagar o erro original da requisição em vez de `SessionExpiredError`. Adicionar `AbortSignal.timeout` ao `fetch`. Tocar `lib/auth/session-refresh.ts` e `lib/http.ts`; cobrir em `__tests__/auth/api-fetch-refresh.test.ts`.

- **Resultado Esperado**
  > Um blip do GoTrue ou do Render não derruba sessão válida. Modais de sessão expirada por falha transitória: hoje 100% dos casos → 0.

- **Tactic alvo**: Degradation
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-5
- **Métricas de sucesso**:
  - Códigos de indisponibilidade distinguidos de 401: 0 de 2 → 2 de 2
  - Timeout no `fetch` de refresh: 0/1 → 1/1
- **Risco de não fazer**: cada instabilidade do Supabase vira relogin em massa dos analistas no meio do trabalho de alocação/lote.
- **Dependências**: nenhuma

### [availability-2] Alertar sobre `AUTH_INDISPONIVEL` e `AUTH_DIVERGENCIA`

- **Problema**
  > Falhas do GoTrue e divergências app_user ↔ GoTrue são só linhas de log; não há painel nem alerta (0 consumidores do tipo `AUTH_INDISPONIVEL`).

- **Melhoria Proposta**
  > Tactic Monitor: expor no `painel-operacao` a contagem por `motivo` nas últimas 24 h de `AUTH_INDISPONIVEL` e `AUTH_DIVERGENCIA` (`duracaoMs`/`motivo` já são emitidos) e notificar o canal da Kavex quando `AUTH_INDISPONIVEL` passar de N ocorrências em 5 min. Como Self-Test, acrescentar um smoke de login pós-deploy ao runbook.

- **Resultado Esperado**
  > Falha do GoTrue detectada pelo operador antes do chamado do usuário. Alertas sobre auth: 0 → ≥ 1.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Alertas/painéis de auth: 0 → ≥ 1
  - Tempo até detecção de indisponibilidade: não medido → < 5 min
- **Risco de não fazer**: a indisponibilidade do login só é notada por reclamação; divergências acumulam até alguém rodar o sync.
- **Dependências**: `painel-operacao` existente

### [availability-3] Formalizar e ensaiar o fallback de login para `AUTH_PROVIDER=local`

- **Problema**
  > O GoTrue é ponto único de falha para novos logins; o único contorno é editar env e redeployar, sem tempo medido nem ensaio.

- **Melhoria Proposta**
  > Tactics Spare / Reconfiguration: documentar o critério de acionamento (ex.: 503 de login por mais de 10 min), ensaiar o rollback em dev medindo o tempo e avaliar como trocar o valor sem redeploy completo (`modoAtual()` já lê o env a cada requisição; falta o mecanismo operacional). Manter o hash local.

- **Resultado Esperado**
  > Tempo de restauração do login com o GoTrue fora conhecido e ≤ 15 min. Hoje: não medido.

- **Tactic alvo**: Reconfiguration
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Tempo de rollback de login: não medido → registrado, ≤ 15 min
- **Risco de não fazer**: numa queda longa do Supabase, o time improvisa o rollback sob pressão.
- **Dependências**: nenhuma

### [availability-4] Tirar chamadas ao GoTrue de dentro do lock da linha quando possível

- **Problema**
  > `criarEVincular` pode encadear create, listagem paginada e update, cada um até 10 s, com a linha do `app_user` travada e uma conexão do pool retida (até 30 s no pior caso).

- **Melhoria Proposta**
  > Tactic Exception Prevention: resolver o vínculo por e-mail (`adminFindUserByEmail`) antes de abrir a transação, ou reduzir o timeout das escritas admin dentro de transação (ex.: 5 s), mantendo a regra "erro = ROLLBACK". Tocar `CredentialMirror.ts`.

- **Resultado Esperado**
  > Lock máximo de escrita de credencial: 30 s → ≤ 10 s.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Chamadas ao GoTrue dentro da transação: até 3 → ≤ 1
- **Risco de não fazer**: com o GoTrue lento, um cadastro travado segura o pool e bloqueia outras escritas de usuário.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta `76b5182..HEAD`; nenhum achado fora dele. `--quick`: sem testes, coverage ou audit rodados (baseline em `_shared-metrics.md`).
- Sem `infra/`: DLQ, alarmes CloudWatch, SQS e shared_account_id marcados N/A/não medíveis.
- Comportamento do JWKS do `jose` (cache/cooldown/timeout default) é conhecimento da biblioteca, não verificado no código; por isso Non-Stop Forwarding está parcial.
- Cross-QA: F-availability-1 toca Usabilidade/Fault-tolerance; F-availability-3 toca Performance (pool de conexões); rate limit já visto por Security.
