---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-06-1520-supabase-auth
agent: qa-fault-tolerance
generated_at: 2026-08-06T15:20:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Uma escrita de gestão de usuário (`convidarUsuario` / `cadastrarUsuarioComSenha` / `desativarUsuario`) | Um dos dois sistemas (GoTrue Admin API ou Postgres `app_user`) falha, ou o processo Express cai entre as duas escritas | `UserAdminService` + `SupabaseAdminClient` + `UserRepository` + rota `/auth/login` gateada por `AUTH_LEGACY_LOGIN_ENABLED` | Produção (Render `starter`, instância única) durante o cutover 4-fases (ADR-0030 §6) | Ou as duas pontas ficam consistentes (compensação executada; ordem preservada; `banGoTrue: 'falhou'` reportado à UI), ou a inconsistência é **detectável** — e.g., `listPendingMigration()` bloqueia a Fase 3, o erro carrega o `auth_user_id` órfão, o `Idempotency-Key` do ledger recusa a segunda execução | 0 execuções duplas de rota que move dinheiro; 0 lockouts silenciosos no cutover; 100% dos e-mails que passam pelo GoTrue com contrapartida em `app_user` (ou detectáveis como órfãos com a pista textual) |

Feature-específico: a única escrita distribuída introduzida por `supabase-auth` é **GoTrue ↔ `app_user`** — não há SQS/DLQ, não há Nexxera/Conexos novos no caminho. O eixo é dual-write consistency; o mesmo modelo (compensating transaction + partial-success auditado + idempotency por construção) foi aplicado, com as lacunas registradas em §4.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos do `SupabaseAdminClient` com `withTransaction` local pareado (dual-write) | 2 / 2 (`convidarUsuario`, `cadastrarUsuarioComSenha` — via `createLocalRowOrCompensate`) | 2 / 2 | ✅ | `src/backend/domain/service/auth/UserAdminService.ts:327-357` |
| Testes cobrindo compensação (feliz + também-falha) | 3 / 3 casos previstos (compensa; compensa-que-também-falha; e-mail já existe no GoTrue não compensa) | 100% | ✅ | `UserAdminService.test.ts:107-183` |
| `desativarUsuario` — ordem (local → invalidate → ban) verificada em teste | ✅ verificada + falha no passo 1 aborta + falha no passo 2 vira `banGoTrue: 'falhou'` | ordem preservada + 3 caminhos | ✅ | `UserAdminService.test.ts:262-379` |
| Métodos do `SupabaseAdminClient` com timeout/retry explícito | 0 / 7 (`inviteByEmail`, `createUser`, `createUserWithPasswordHash`, `getUserById`, `updateUserById`, `setBanned`, `sendRecoveryLink`) | ≥ 1 timeout por método + retry curto para 5xx | ❌ | `src/backend/domain/client/SupabaseAdminClient.ts` — nenhum `RetryExecutor`, nenhum `AbortSignal` |
| Guard de código que impede `AUTH_LEGACY_LOGIN_ENABLED=false` com `listPendingMigration()` não-vazia | 0 (a proteção é um `console.warn` no job + parágrafo na ADR + comentário no `authEnv.ts:44`) | 1 (fail-fast no boot **ou** 503 do route quando pendentes > 0) | ❌ | `src/backend/http/authEnv.ts:45-48`, `src/backend/routes/auth.ts:53-60`, `src/backend/jobs/migrate-users-to-supabase.ts:118-132` |
| Reaper/reconciliation para órfãos em `auth.users` sem `app_user` correspondente | 0 (compensação síncrona cobre o caminho normal; o crash-window entre `inviteByEmail` e o `INSERT`/`deleteUser` deixa órfão) | 1 job periódico (`SELECT auth.users LEFT JOIN app_user`) + alerta | ❌ | `src/backend/jobs/` — apenas o one-shot `migrate-users-to-supabase.ts` |
| Cobertura da idempotency-key `receb:${ator}:...` no cutover (guarda anti-regressão que preserva o namespace da execução de dinheiro) | 4 grep-tests + 1 teste-comportamento em `auditActor` + 1 assertion contra `conexosIdentity.ts` | 100% | ✅ | `src/backend/http/auditActor.guard.test.ts:44-129` — plus `routes/recebimentos.ts:190` |
| `migrate-users-to-supabase` — idempotência por construção (`auth_user_id IS NULL` filtra) | ✅ testado (2ª execução migra 0) | ✅ | ✅ | `jobs/migrate-users-to-supabase.test.ts:118-134` |
| Sites de auditoria que persistem o ator em coluna dedicada para transições de `Usuario` (I-Usuario-7) | 1 / 4 (`created_by` em `create`; **não** persistido: `setAtivo`, `redefinirSenhaDeTerceiro`, `setVinculo`) | 4 / 4 | ⚠️ | `UserRepository.ts:290-313` (persiste) vs. `UserAdminService.ts:192-235,249-253,289-304` (ator recebido, não persistido) |
| Persistência do relatório do job `migrate-users-to-supabase` | 0 (stdout apenas — se o container reinicia no meio do lote, a lista de falhados fica só nos logs do Render) | tabela `app_user_migracao_evento` **ou** relatório idempotente reconstruível a partir de `listPendingMigration()` | ⚠️ | `jobs/migrate-users-to-supabase.ts:95-116` |
| Multi-instância — health check que impede boot com `plan != starter` (invariante datada do `AppUserContextCache`) | 0 (`plan: starter` no `render.yaml` mantém a premissa; nenhuma barreira de código) | 1 assertion (env var `RENDER_INSTANCE_COUNT` ou similar) | ⚠️ | `AppUserContextCache.ts:26-42` + `render.yaml:10` |
| Frontend — tela de `reset-password` trata link expirado sem falhar no submit | ✅ (`linkState: 'invalido'` explícito com CTA "solicitar novo link") | ✅ | ✅ | `frontend/app/auth/reset-password/page.tsx:15-127` |
| Frontend — `useEffect` cleanup ao verificar link (evita setState em componente desmontado) | ✅ (`active = false` no return) | ✅ | ✅ | `frontend/app/auth/reset-password/page.tsx:35-69` |

> ⚠️ **Não medível localmente**: taxa real de falha da Admin API do GoTrue (5xx / timeout) e latência p99. Requer telemetria em produção (Supabase dashboard + Render logs). Recomendação: emitir métrica `supabase_admin_call_{op,status,ms}` no service para observar antes do cutover.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** (Avoid) | Fallback U3 (`cadastrarUsuarioComSenha`) substitui U1 (`convidarUsuario`) quando SMTP não está configurado — o convite é o caminho preferencial; o cadastro-com-senha impede a ausência de SMTP de virar um bloqueio duro | ✅ presente | `UserAdminService.ts:117-172`; `ADR-0030 §7` |
| **Replacement** (Avoid) | N/A — não há redundância ativo/passivo neste eixo (não é o QA correto pra isso) | N/A | — |
| **Predictive Model** (Avoid) | Pré-check local do e-mail (`assertUsernameIsFree`) evita criar no GoTrue algo que sabemos que teríamos de compensar | ✅ presente | `UserAdminService.ts:314-317` |
| **Increase Competence Set** (Avoid) | `SupabaseAdminError` × `SupabaseUserNotFoundError` × `SupabaseEmailAlreadyExistsError` — o cliente distingue "não existe" de "não consegui falar", o que permite ao service escolher entre compensar e abortar. **Tratar indisponibilidade como inexistência apagaria a linha errada** | ✅ presente | `SupabaseAdminClient.ts:24-91`; `unwrap()` |
| **Sanity Checking** (Detect) | Zod no boundary da Admin API (`goTrueUserSchema` com `passthrough`) — resposta `{}` sem `id` é rejeitada em vez de virar `undefined.id` | ✅ presente | `SupabaseAdminClient.ts:55-74` |
| **Comparison** (Detect) | I-Usuario-6 compara `alvo.username` com `ator` antes de escrever — barra autodesativação | ✅ presente | `UserAdminService.ts:200-204`; teste `UserAdminService.test.ts:309-325` |
| **Timestamp** (Detect) | `AppUserContextCache.expiresAt` valida TTL a cada `get()` — entradas expiradas somem sem intervenção externa | ✅ presente | `AppUserContextCache.ts:53-61` |
| **Timeout** (Detect) | **Nenhum timeout explícito em `SupabaseAdminClient`.** Depende dos defaults do `@supabase/supabase-js` / `fetch` — invisíveis, não configurados, não testados | ❌ ausente | Ver métrica "Métodos do `SupabaseAdminClient` com timeout" |
| **Condition Monitoring** (Detect) | Gate `listPendingMigration()` do rollout é um **console.warn** no job, não um monitor persistente que bloqueia o boot | ⚠️ parcial | `migrate-users-to-supabase.ts:118-132` — sem barreira de código |
| **Self-Test** (Detect) | `auditActor.guard.test.ts` — teste de código que falha se algum route voltar a compor `req.user?.sub ?? ...` no ator de auditoria. Detecta a regressão de maior consequência financeira | ✅ presente | `src/backend/http/auditActor.guard.test.ts` (5 blocos, 129 linhas) |
| **Voting** (Detect) | N/A — não há redundância N-modular; identidade tem um único IdP (GoTrue) e um único banco (`app_user`) | N/A | — |
| **Redundancy** (Contain) | Cadastro tem dois caminhos (U1 convite + U3 fallback). `AUTH_LEGACY_LOGIN_ENABLED` mantém o login legado em paralelo durante o rollout | ✅ presente | `routes/auth.ts:50-77`; `authEnv.ts:45-48` |
| **Recovery (Rollback)** (Contain) | `createLocalRowOrCompensate` — falha no INSERT local ⇒ `deleteUser(authUserId)` no GoTrue. É a **única** situação em que `deleteUser` é permitido (I-Usuario-3). Erro final carrega e-mail e `auth_user_id` órfão | ✅ presente | `UserAdminService.ts:327-357`; `SupabaseAdminClient.ts:281-284` |
| **Recovery (Forward)** (Contain) | `desativarUsuario` — se o ban no GoTrue falha, o `ativo = false` local **já revoga** o acesso a cada request (com latência ≤ TTL); resposta 200 com `banGoTrue: 'falhou'` informa a UI. Não há undo | ✅ presente | `UserAdminService.ts:219-234`; teste `UserAdminService.test.ts:293-307` |
| **Reintroduction (Shadow)** (Contain) | N/A — sem shadow/canary neste caminho (não é o modelo do Render) | N/A | — |
| **Reintroduction (State Resync)** (Contain) | Feito na inicialização do request via `appUserContext` (SELECT em `app_user`) — é o mecanismo que garante que uma sessão viva perde autorização em ≤ 30 s | ✅ presente | `http/appUserContext.ts:82-203`; `AppUserContextCache.ts:16` |
| **Escalating Restart** (Contain) | N/A — instância única no Render, sem hierarquia de restart | N/A | — |
| **Rollback** (Recover) | `withTransaction` disponível e usado em SISPAG / permutas / recebimentos. Em `supabase-auth` a escrita local é single-row (`INSERT`), então `withTransaction` é dispensável — a compensação de sistema é o rollback distribuído | ✅ presente onde aplica | `PostgreeDatabaseClient.ts:96-119` (transversal); `UserAdminService.ts` não usa `withTransaction` (single-row) |
| **Repair State** (Recover) | Erro de compensação-que-também-falha **carrega o e-mail e o `auth_user_id` órfão** na mensagem — é a única pista para o operador reparar manualmente. Não há reparo automático | ⚠️ parcial | `UserAdminService.ts:343-354`; teste `UserAdminService.test.ts:139-154` |
| **Idempotent Replay** (Recover) | (i) `migrate-users-to-supabase` — idempotência **por construção** (filtro `auth_user_id IS NULL`); (ii) `receb:${ator}:...` no ledger de recebimentos — chave namespaced pelo `username`, PRESERVADA na troca `sub`→`username` | ✅ presente | `jobs/migrate-users-to-supabase.ts:60`; `routes/recebimentos.ts:185-208`; `auditActor.guard.test.ts:141-146` |
| **Compensating Transaction** (Recover) | Sim para `convidarUsuario`/`cadastrarUsuarioComSenha` (síncrono, no mesmo request). **Não** para o crash-window entre `inviteByEmail` e o INSERT local | ⚠️ parcial | Ver F-fault-tolerance-2 |
| **Reconcile** (Recover) | **Ausente** — nenhum job periódico compara `auth.users` × `app_user`. O único mecanismo é `listPendingMigration()` (só descobre `app_user` sem `auth_user_id`, não o inverso) | ❌ ausente | Ver F-fault-tolerance-2 |
| **Quarantine** (Recover) | `convite_pendente = true` é um "quarentine flag" persistido — impede o `resolveInactive` de reativar silenciosamente um usuário desligado que ainda tem o e-mail corporativo. Fecha a porta dos fundos do reset como caminho de reativação | ✅ presente | `appUserContext.ts:116-133`; `migrations/0044_app_user_auth_link.sql:11-16` |

## 4. Findings (achados)

### F-fault-tolerance-1: `AUTH_LEGACY_LOGIN_ENABLED=false` não tem guard de código — o gate da Fase 3 depende só de disciplina humana

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring (a condição é monitorada, mas não **enforçada**)
- **Localização**: `src/backend/http/authEnv.ts:45-48`, `src/backend/routes/auth.ts:53-60`, `src/backend/jobs/migrate-users-to-supabase.ts:118-132`
- **Evidência (objetiva)**:
  ```ts
  // authEnv.ts:45 — apenas um comentário sobre o gate:
  //   "desligar o login legado enquanto houver `app_user` com `auth_user_id IS NULL` deixa
  //    esse usuário SEM NENHUM caminho de login. O gate é `listPendingMigration()` vazio."
  AUTH_LEGACY_LOGIN_ENABLED: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),

  // routes/auth.ts:53 — o route apenas 410-a a rota, sem verificar pendentes:
  if (!legacyLoginEnabled) { res.status(410).json({...}); return; }

  // migrate-users-to-supabase.ts:121 — o "gate" é um console.warn:
  if (restantes > 0) {
    console.warn(`[migrate-users] GATE: ... MUST NOT be applied until this count reaches zero`);
  }
  ```
- **Impacto técnico**: um `AUTH_LEGACY_LOGIN_ENABLED=false` aplicado no Render **antes** de `listPendingMigration()` chegar a zero cria N usuários com **zero caminho de login**: o legado responde 410 e eles não existem no GoTrue. A recuperação exige religar a flag no Render (rollback declarado da ADR-0030 §6) — o que **funciona**, mas o dano é uma janela de indisponibilidade de login sem sinal proativo.
- **Impacto de negócio**: cutover-day risk. A ADR-0030 §6 lista o rollback como "uma variável de ambiente no Render, sem redeploy", mas o modo de falha aqui é *lockout enquanto ninguém percebe* — não um crash. O tempo até detectar depende de o primeiro operador tentar entrar.
- **Métrica de baseline**: **0 guards de código / 1 requerido**. `authEnv.ts` não lê `listPendingMigration()` no boot; `routes/auth.ts` não consulta pendentes ao 410-ar; nenhum health check falha.

### F-fault-tolerance-2: crash window entre `inviteByEmail` e o INSERT local não tem reaper — órfão silencioso em `auth.users`

- **Severidade**: P2
- **Tactic violada**: Reconcile (Bass), Repair State
- **Localização**: `src/backend/domain/service/auth/UserAdminService.ts:123-172`, `327-357`
- **Evidência (objetiva)**:
  ```ts
  // A compensação síncrona cobre o caso "INSERT local falhou":
  try { return await this.userRepository.create({ ...row, authUserId }); }
  catch (localError) { try { await this.supabaseAdmin.deleteUser(authUserId); } ... }

  // Mas ela NÃO cobre o cenário: processo Express morre (Render restart, OOM, deploy)
  // entre `inviteByEmail(email)` e `create(...)`. O usuário existe no GoTrue, o
  // `app_user` não existe, ninguém sabe.
  ```
  E `SupabaseAdminClient` **não expõe** um método para listar todos os usuários do GoTrue (`listUsers`) — o único caminho de recuperação hoje é operador olhar o dashboard do Supabase e apagar manualmente. Confirmação: `grep -rn "orphan\|reaper" src/backend` só encontra os equivalentes em recebimentos/permutas.
- **Impacto técnico**: no dia em que a janela ocorrer, o e-mail fica **queimado** para um cadastro futuro (`auth.users.email` é único). O sintoma aparece semanas depois como "não consigo cadastrar essa pessoa", exatamente o failure mode que a ADR-0030 §7 descreve. A ADR reconhece o risco de compensação-que-também-falha (com mensagem que carrega o `auth_user_id`), mas o crash-window puro **não deixa mensagem nenhuma**.
- **Impacto de negócio**: baixo em regime, alto por incidente — um único crash no meio de um cadastro em massa (primeiros dias do rollout) pode queimar vários e-mails sem rastro.
- **Métrica de baseline**: **0 jobs de reconciliação / 1 requerido**. O `migrate-users-to-supabase` cobre a direção *inversa* (`app_user` sem `auth_user_id`), não órfãos em `auth.users`.

### F-fault-tolerance-3: `desativarUsuario` — "sucesso parcial" (banGoTrue=falhou) só existe como `console.warn` + response body; não fica persistido

- **Severidade**: P2
- **Tactic violada**: Repair State (o operador precisa saber depois quais desativações ficaram com o ban do GoTrue não confirmado — é ele que sabe replicar via dashboard)
- **Localização**: `src/backend/domain/service/auth/UserAdminService.ts:219-234`
- **Evidência (objetiva)**:
  ```ts
  } catch (error) {
      console.warn(
          `[UserAdminService] partial success on setAtivo(${id}, ${ativo}): local flag ` +
              'applied and context cache invalidated, but the GoTrue ban/unban failed — ...',
      );
      return { id, ativo, banGoTrue: 'falhou' };
  }
  ```
  A UI recebe `banGoTrue: 'falhou'` no `PATCH /usuarios/:id/ativo` (verificado em `routes/usuarios.ts:184`), mas essa informação **não fica persistida**. Reiniciar o Express perde o `console.warn`. Não há tabela `app_user_evento`, `desativado_por`, nem coluna `ban_gotrue_ultimo_status`.
- **Impacto técnico**: reprocessar a fila de "desativações com ban pendente" exige que o operador tenha visto a UI **no mesmo dia**. Depois, o sinal só sobrevive nos logs do Render (retenção limitada).
- **Impacto de negócio**: em regime, baixo — a probabilidade de o ban falhar é pequena. No cutover / após incidente do provedor, pode acumular. Cross-QA com **Security (auditability)** e com o follow-up P1 já aberto **I-Usuario-7** (`_inbox/supabase-auth-regis-followups.md` §"I-Usuario-7: mudanças de estado de Usuario não são atribuídas") — este achado é uma **faceta específica** do gap I-Usuario-7, mas exposta em fault-tolerance porque a informação perdida é *status de degradação*, não só *quem fez*.
- **Métrica de baseline**: **1 de 4 mutações de `Usuario` persistem trilha** (só `create` → `created_by`); **0 de 1 estado de degradação** persistidos.

### F-fault-tolerance-4: `SupabaseAdminClient` sem timeout explícito e sem `RetryExecutor` — uma chamada travada segura a request inteira

- **Severidade**: P2
- **Tactic violada**: Timeout (Detect)
- **Localização**: `src/backend/domain/client/SupabaseAdminClient.ts` (arquivo inteiro)
- **Evidência (objetiva)**:
  ```
  grep -n "timeout\|AbortSignal\|RetryExecutor\|FallbackExecutor" \
       src/backend/domain/client/SupabaseAdminClient.ts
  → (nenhum resultado)
  ```
  Nenhum dos 7 métodos (`inviteByEmail`, `createUser`, `createUserWithPasswordHash`, `getUserById`, `updateUserById`, `setBanned`, `sendRecoveryLink`) tem controle explícito de tempo. Comparativo: `ConexosBaseClient` e demais clients externos do repositório têm superfície de retry/timeout via os executores. O CLAUDE.md declara *"NEVER use manual `setTimeout` loops — always use Executors"* — o inverso disso é "não use nada", que é o estado atual.
- **Impacto técnico**: um GoTrue lento (5xx em pico, SMTP a fila cheia, rede degradada) prende a Express na `await` até o default do `fetch` estourar (varia por runtime). Durante o cutover, um pico do provedor pode travar múltiplas requests simultâneas.
- **Impacto de negócio**: reduzido pela `heavyRouteLimiter` em `/usuarios/*` e pela instância única do Render (o thread-pool não desmorona instância nenhuma além dela). Vira problema em rota pública `/auth/forgot-password` — a resposta é constante por anti-enumeração, mas travar em `sendRecoveryLink` bloqueia workers.
- **Métrica de baseline**: **0 / 7 métodos** com timeout explícito.

### F-fault-tolerance-5: `AppUserContextCache` process-local — health check que impede multi-instância silenciosa é ausente

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/service/auth/AppUserContextCache.ts:26-42`, `render.yaml:10`
- **Evidência (objetiva)**: o próprio arquivo declara a restrição:
  ```ts
  // AppUserContextCache.ts:29
  // A invalidação é local ao processo, e isso só é SUFICIENTE porque o backend roda
  // em Render `plan: starter` — instância única (`render.yaml`).
  // No dia em que houver mais de uma instância, a invalidação deixa de cruzar processos
  // e a latência real de revogação vira o TTL cheio — sem erro, sem log, sem alarme.
  ```
  A premissa é mantida por `plan: starter` no `render.yaml`. Não há assertion de startup lendo `RENDER_INSTANCE_COUNT` (ou equivalente) que impeça o boot com >1 instância. O modo de falha é 100% silencioso — a business-rule `revogacao-de-acesso.md` é asseverada e o ambiente deixaria de exercê-la sem sinal.
- **Impacto técnico**: escalar horizontalmente (mudar `plan` para `standard`/`pro`) degrada a garantia de "≤ 30 s" para "≤ 30 s **por instância**", com a instância que atende o `PATCH /:id/ativo` invalidando só seu próprio cache. Um usuário desativado continuaria autorizado em outras instâncias até TTL cheio.
- **Impacto de negócio**: hoje inexistente (starter = 1 instância). Vira P0 no dia em que se escalar sem revisitar a business-rule.
- **Métrica de baseline**: **0 health checks / 1 requerido**.

### F-fault-tolerance-6: `migrate-users-to-supabase` — relatório não persistido; se o container reinicia no meio do lote, a lista de falhados fica só nos logs do Render

- **Severidade**: P2
- **Tactic violada**: Repair State
- **Localização**: `src/backend/jobs/migrate-users-to-supabase.ts:95-116`
- **Evidência (objetiva)**:
  ```ts
  } catch (error) {
      report.falhos += 1;
      report.usernamesComFalha.push(user.username);
      console.error(`[migrate-users] FAILED: ${user.username} — ${...}`,
          error instanceof SupabaseEmailAlreadyExistsError
              ? '(already exists in the provider: link auth_user_id manually)'
              : '');
  }
  ```
  O relatório vive em memória (`MigrationReport`) e só é observável (a) pelo stdout do container, (b) pelo `throw` em `main()` no fim (que só carrega os nomes se o processo terminar normalmente). Se o Render reciclar o container no meio, o relatório se perde. A idempotência do job garante que a **próxima** execução pega quem sobrou (`auth_user_id IS NULL`), mas não distingue "falhou por hash inválido" de "ainda não tentado" — a informação diagnóstica é a que se perde.
- **Impacto técnico**: para a falha operacional mais provável descrita na ADR-0030 §6 ("o hash é *aceito mas não confere*, e ninguém descobre até o primeiro login"), o operador precisa correlacionar logins-que-falharam com o run do job — sem persistência dos falhados, a correlação é manual e depende de reter os logs do Render.
- **Impacto de negócio**: um-shot, mas alto no dia do cutover — é o único momento em que este job roda em produção. A rede de segurança declarada (`reset por e-mail`) requer o usuário perceber que não consegue entrar; um relatório persistido antecipa isso.
- **Métrica de baseline**: **0 persistências** — o único artefato é stdout do container. Tabela `app_user_migracao_evento` ou similar: ausente.

## 5. Cards Kanban

### [fault-tolerance-1] Fechar o gate da Fase 3 no código, não na disciplina humana

- **Problema**
  > O flip de `AUTH_LEGACY_LOGIN_ENABLED=false` no Render enquanto `listPendingMigration()` não estiver vazia deixa esses usuários sem nenhum caminho de login. Hoje o gate é (i) um `console.warn` do job `migrate-users-to-supabase` e (ii) um comentário na `authEnv.ts:44`. Nenhuma barreira de código impede o cutover-day-mistake mais previsível da feature.

- **Melhoria Proposta**
  > Fail-fast no boot **ou** guard na rota `POST /auth/login`: quando `legacyLoginEnabled === false`, ler `UserRepository.listPendingMigration()` uma vez na inicialização; se a lista for não-vazia, ou (a) crashar o startup com mensagem que aponta o job de migração como pré-requisito, ou (b) responder `503` no `/auth/login` com a lista de pendentes na mensagem (sem vazar e-mails — só `count`). Tactic Bass: **Condition Monitoring** transforma-se em barreira ativa. Arquivos: `src/backend/http/authEnv.ts` (adicionar `resolvePendingCountAtBoot`), `src/backend/routes/auth.ts` (guard adicional).

- **Resultado Esperado**
  > Impossível ativar a Fase 3 com pendentes. Métrica: guards ativos **0 → 1**; lockout-window em cutover-day **possível → impossível-por-construção**.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Guards de código impedindo Fase 3 prematura: **0 → 1**
  - Teste que reproduz o cenário (`AUTH_LEGACY_LOGIN_ENABLED=false` + 1 pendente): **ausente → presente**
- **Risco de não fazer**: no dia do cutover alguém flipa a flag antes do gate; N usuários ficam sem login até religarem o legado. Rollback existe e é rápido, mas a janela de indisponibilidade é o custo.
- **Dependências**: nenhuma — self-contained.

### [fault-tolerance-2] Reaper de órfãos GoTrue (`auth.users` sem `app_user`)

- **Problema**
  > A compensação síncrona (`createLocalRowOrCompensate`) cobre o caso "INSERT local falhou". Ela não cobre o crash-window entre `inviteByEmail`/`createUser` e o `INSERT` local (Render reciclando o container, OOM, deploy em janela ruim). O órfão fica em `auth.users`, o e-mail é queimado, e não há job periódico que compare os dois lados.

- **Melhoria Proposta**
  > Job periódico (semanal no rollout, mensal em regime): `SupabaseAdminClient.listUsers()` paginado × `SELECT auth_user_id FROM app_user`. Diff = órfãos. Ação: **não** apagar automaticamente (I-Usuario-3); listar no Render logs com `auth_user_id` + `email` + `created_at`, e enviar para o mesmo canal do relatório de `migrate-users-to-supabase`. O operador decide entre `deleteUser` (janela pequena confirmada) e "criar `app_user` manualmente". Tactic Bass: **Reconcile**.

- **Resultado Esperado**
  > Órfãos detectáveis em ≤ 1 semana em vez de "quando alguém tentar cadastrar aquele e-mail".
- **Tactic alvo**: Reconcile
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Jobs de reconciliação `auth.users` × `app_user`: **0 → 1**
  - Método `listUsers()` em `SupabaseAdminClient`: **ausente → presente**
- **Risco de não fazer**: em incidentes futuros, e-mails queimados sem rastro. O sintoma aparece semanas depois como "não consigo cadastrar essa pessoa".
- **Dependências**: nenhuma.

### [fault-tolerance-3] Persistir `ban_gotrue_ultimo_status` (e o `desativado_por`) em `app_user_evento`

- **Problema**
  > `desativarUsuario` reporta `banGoTrue: 'falhou'` no response body, e o `console.warn` some após o restart. A UI conhece a degradação por um instante — depois disso, a informação evapora. O follow-up já aberto **I-Usuario-7** (mudanças de estado de `Usuario` não atribuídas) é o container natural; o `banGoTrue` é uma coluna extra que aproveita a mesma migração.

- **Melhoria Proposta**
  > Tabela `app_user_evento(id, app_user_id, tipo, ator, ban_gotrue_status, criado_em)`. `setAtivo`, `redefinirSenhaDeTerceiro`, `setVinculo` inserem uma linha (em transação com o UPDATE principal via `withTransaction`). Route `GET /usuarios/:id/eventos` para admins. Tactic Bass: **Repair State**.

- **Resultado Esperado**
  > `banGoTrue: 'falhou'` deixa de ser um sinal efêmero. Uma consulta pós-incidente retorna a lista completa de desativações com ban pendente. Métrica: mutações auditadas **1/4 → 4/4**; degradações auditadas **0/1 → 1/1**.
- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Mutações de `Usuario` com trilha persistida: **1 → 4**
  - Coluna/campo `ban_gotrue_status` persistido: **ausente → presente**
- **Risco de não fazer**: repete a superfície do follow-up P1 I-Usuario-7 e adiciona uma superfície nova para *degradação*. Cross-QA: **Security (auditability)**, **Testability** (permite testar reprocesso de bans falhados).
- **Dependências**: converge com o follow-up P1 I-Usuario-7 de `_inbox/supabase-auth-regis-followups.md` — implementar juntos.

### [fault-tolerance-4] Envelopar `SupabaseAdminClient` com timeout + retry curto

- **Problema**
  > Nenhum dos 7 métodos do `SupabaseAdminClient` tem timeout, retry ou fallback explícito. Uma chamada travada segura a request inteira até o default do `fetch` estourar. O CLAUDE.md declara que Executors (`RetryExecutor`, `FallbackExecutor`, `PollExecutor`) são o padrão — este client está fora dele.

- **Melhoria Proposta**
  > Envelopar cada chamada em `RetryExecutor` (2 tentativas, backoff exponencial curto, só em 5xx/timeout) + `AbortSignal.timeout(N ms)` — 5 s para `inviteByEmail`/`sendRecoveryLink` (SMTP pode variar), 3 s para as demais. **Não** retryar `SupabaseEmailAlreadyExistsError` nem `SupabaseUserNotFoundError` (semânticos, não transitórios). Tactic Bass: **Timeout** + **Recovery (Forward)**.

- **Resultado Esperado**
  > Chamada travada é abortada em ≤ 5 s em vez de segurar o worker. Métrica: métodos com timeout explícito **0/7 → 7/7**.
- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Métodos com timeout: **0/7 → 7/7**
  - Métodos com retry para 5xx: **0/7 → ≥ 5/7** (excluir `deleteUser` — compensação, single-shot)
- **Risco de não fazer**: durante o rollout, um pico de latência do GoTrue congela a fila da Express. Cross-QA: **Performance**, **Availability**.
- **Dependências**: nenhuma.

### [fault-tolerance-5] Health check que impede boot em multi-instância enquanto `AppUserContextCache` for process-local

- **Problema**
  > A business-rule `revogacao-de-acesso.md` (≤ 30 s) é asseverada com base em `plan: starter` (instância única). Escalar horizontalmente degrada a garantia para "≤ 30 s **por instância**" sem qualquer sinal — a diferença só aparece se alguém compara logs de instâncias distintas.

- **Melhoria Proposta**
  > Assertion de startup: ler `EnvironmentProvider.getRenderInstanceCount()` (ou `process.env.RENDER_INSTANCE_COUNT`, se disponível), crashar o boot com mensagem que aponta a business-rule e o card `security-1` do `_inbox/` se `> 1`. Alternativa mínima: teste de integração que valida que `AppUserContextCache` **é** o único mecanismo de invalidação (grep por Redis/pub-sub para provar que ninguém introduziu invalidação distribuída sem revisar a rule). Tactic Bass: **Condition Monitoring**.

- **Resultado Esperado**
  > Escalar horizontalmente crasha o boot em vez de degradar em silêncio. Métrica: health check **ausente → presente**.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Assertion de startup para instance-count: **0 → 1**
- **Risco de não fazer**: baixo hoje (starter). Vira P0 no dia em que se escalar sem revisitar a rule.
- **Dependências**: revisitar `business-rules/revogacao-de-acesso.md` antes de mudar o `plan` no `render.yaml`.

### [fault-tolerance-6] Persistir o relatório de `migrate-users-to-supabase` em tabela dedicada

- **Problema**
  > Se o container Render for reciclado no meio de um `--execute` (deploy no meio do cutover, OOM), o relatório em memória se perde. A idempotência do filtro `auth_user_id IS NULL` garante que a próxima execução pega quem sobrou, mas **não distingue "falhou por hash inválido" de "ainda não tentado"** — a informação diagnóstica é a que se perde.

- **Melhoria Proposta**
  > Tabela `app_user_migracao_evento(app_user_id, tentado_em, resultado, erro_mensagem)`. O loop insere uma linha por tentativa antes de emitir o log. Novo route/CLI `list-migration-failures` lê a tabela — o operador não depende dos logs do Render (retenção limitada). Tactic Bass: **Repair State**.

- **Resultado Esperado**
  > Falhas de migração sobrevivem a restart do container. Métrica: persistência do relatório **stdout-only → tabela + stdout**.
- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Persistência do resultado por usuário: **ausente → presente**
  - Cross-check "usuários bloqueados no primeiro login" ↔ "hash inválido no import": **manual → SQL**
- **Risco de não fazer**: rede de segurança declarada na ADR-0030 (reset por e-mail) exige o usuário perceber que não consegue entrar. Sem cross-check, a correlação com "hash importado errado" é adivinhação.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo assumido**: `backend` (não há `infra/`; frontend só relevante nas telas de `auth/*`, cobertas). Backend é Express (dívida de template) — os Handlers Lambda existem no código mas não estão no caminho hot; auditar sob a ótica Lambda seria inventar cenário.
- **Achados já conhecidos não reportados**: `filialAuthz` fail-OPEN (carry-over), `CONEXOS_CRED_ENC_KEY` ausente (pré-existente), Express-vs-Lambda (dívida aceita), 38 warnings `noExcessiveCognitiveComplexity` (pré-existente). O follow-up P1 **I-Usuario-7** é referenciado no card `fault-tolerance-3` como container natural — não conta como card novo.
- **Métrica não coletada — telemetria em produção**: taxa 5xx / p99 do GoTrue Admin API. Não é medível localmente; recomendo instrumentar no envelope proposto no card 4 (`RetryExecutor` + timeout emitem `emit()` fácil).
- **Cross-QA a sinalizar ao consolidator**:
  - `fault-tolerance-1` toca **Availability** (Fase-3 lockout é indisponibilidade de login).
  - `fault-tolerance-3` toca **Security (auditability)** e **Testability** (converge com I-Usuario-7).
  - `fault-tolerance-4` toca **Performance** e **Availability** (timeouts).
  - A preservação da chave `receb:${ator}:...` — validada em `auditActor.guard.test.ts` — é o cruzamento mais consequente com **Integrability**: o namespace da idempotência de dinheiro sobrevive ao cutover porque o helper e o guard-test estão no lugar.
- **Score 7/10**: as decisões estruturais estão certas (compensação síncrona, ordem de destrutivos, idempotência por construção, guard de auditoria). O que faltam são as redes de segurança de segunda ordem — reaper, timeout, persistência dos sinais de degradação — que só importam nas horas ruins.
