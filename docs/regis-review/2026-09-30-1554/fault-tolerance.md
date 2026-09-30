---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-30-1554
agent: qa-fault-tolerance
generated_at: 2026-09-30T16:30:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

Escopo `--quick`: delta da feature `auth-supabase` (`git diff 76b5182..HEAD`). "Escrita financeira" aqui é a escrita de credencial (`app_user` + projeção no GoTrue), não permuta/remessa/baixa. Nenhum fluxo financeiro foi tocado.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Admin (UI de usuários) e job de sync | GoTrue fora, lento (>10 s) ou COMMIT falhando depois de o GoTrue já ter mudado | `CredentialMirror` + `UserRepository` (tx com `FOR UPDATE`) + `SupabaseAuthSyncService` | Produção Render, `AUTH_PROVIDER=supabase`, GoTrue como projeção de `app_user` | Escrita reverte e a rota responde 503; desativar comita mesmo assim; divergência fica em `AUTH_DIVERGENCIA`; o sync repara | 0 escritas de credencial parciais silenciosas; corte de acesso ≤ 30 s mesmo com GoTrue fora; toda divergência buscável por usuário |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas de credencial espelhadas dentro da tx local (lock → GoTrue → COMMIT) | 5/5 operações (criar, senha, e-mail, desativar, reativar) | 100% | ✅ | `CredentialMirror.ts` `espelhar`; `UserRepository.ts:265,364,522,629` |
| Escritas admin com retry automático (não idempotentes) | 0 de 2 (create/update); só leituras admin usam `RetryExecutor` (retries=2) | 0 | ✅ | `SupabaseAuthClient.ts:62-68` |
| Chamadas ao GoTrue com timeout | 100% (`AbortSignal.timeout(10_000)`, ponto único `enviar`) | 100% | ✅ | `SupabaseAuthClient.ts:311` |
| Respostas do GoTrue validadas por Zod | 100% (sessão, user, lista, erro) | 100% | ✅ | `SupabaseAuthClient.ts` imports `*Schema` |
| Caminhos de divergência com log `AUTH_DIVERGENCIA` buscável | 6 sítios (aposFalha, banir, vincularExistente, órfão/conflito, falha do sync, acesso.ts) | 100% dos caminhos | ✅ | `grep AUTH_DIVERGENCIA` |
| Idempotência do sync (2ª execução = 0 mudanças) | Sim, dry-run default, por usuário isolado | sim | ✅ | `SupabaseAuthSyncService.ts` docstring e `planejar` |
| Jobs de reparo agendados (workflows) para o sync | 0 de 1 (6 workflows de job existem, nenhum para `sync-supabase-auth`) | 1 | ⚠️ | `.github/workflows/*` |
| Alerta ativo sobre `AUTH_DIVERGENCIA` | 0 (só linha de log) | 1 | ⚠️ | `grep -rn AUTH_DIVERGENCIA src/backend` |
| Tempo máx. de linha travada + conexão do pool durante chamada GoTrue | ≤ 10 s por chamada (`REQUEST_TIMEOUT_MS`); 2 chamadas no vínculo por e-mail existente | limitado | ⚠️ | `SupabaseAuthClient.ts:311`, `UserRepository.ts:608` |
| Cenários de recuperação de auth com teste | `CredentialMirror.test`, `SupabaseAuthSyncService.test`, `identidade.supabase.test` (245 linhas), `usuarios.test` (+88) | todos | ✅ | `git diff --stat` |
| Reconciliação de senha (bcrypt local × GoTrue) | ausente (sync compara e-mail e ban, não senha) | n/a (inviável comparar) | ⚠️ | `SupabaseAuthSyncService.reconciliacao` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod em toda resposta do GoTrue; sessão do GoTrue conferida contra o `app_user` vinculado no login/refresh | ✅ presente | `SupabaseAuthClient.ts`; `SupabaseSessionService.ts:61,90` |
| Timeout | 10 s por chamada via `AbortSignal` | ✅ presente | `SupabaseAuthClient.ts:311` |
| Condition Monitoring | `AUTH_DIVERGENCIA` no log; `AUTH_PROVIDER` exibido em Operação | ⚠️ parcial (sem alarme) | commit `9b5c412`; `LogInterface.ts` |
| Timestamp | eventos de acesso gravados na mesma tx da escrita | ✅ presente | `UserRepository.create` `recordEvent` |
| Comparison | Sync compara `app_user` × GoTrue (e-mail, ban, vínculo órfão, conflito) | ✅ presente | `SupabaseAuthSyncService.planejar` |
| Recovery (backward / Rollback) | Erro no passo → ROLLBACK local + 503 "nada foi alterado" | ✅ presente | `CredentialMirror.preparar`; `UserRepository.rodarPasso` |
| Recovery (forward) | Desativar comita sem ban e registra divergência; sync bane depois (decisão do dono) | ✅ presente (escolha explícita) | `CredentialMirror.banir`; ADR-0056 |
| Reintroduction (State Resync) | `sync-supabase-auth` (vincular/criar/reconciliar), idempotente, manual | ⚠️ parcial (sem scheduler) | `jobs/sync-supabase-auth.ts` |
| Rollback de configuração | `AUTH_PROVIDER` + bcrypt local mantido (R7) | ✅ presente | `CredentialMirror` docstring |
| Idempotent Replay | Criar no GoTrue com e-mail já existente vincula (`vincularExistente`); no sync, falha do link após create vira `vincular` na próxima | ✅ presente | `CredentialMirror.criarEVincular` |
| Compensating Transaction | N/A: GoTrue admin não tem undo transacional; adotada forward recovery via sync (escolha explícita) | N/A | ADR-0056 |
| Quarantine | Vínculo órfão e conflito de e-mail não são corrigidos sozinhos, só reportados | ✅ presente | `SupabaseAuthSyncService.processar` |
| Redundancy | O corte de acesso por `ativo` lido por requisição (cache ≤ 30 s) independe do GoTrue | ✅ presente | `http/acesso.ts` |
| Predictive Model / Voting / Self-Test | N/A: sem justificativa de domínio nesta feature | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: Timeout de escrita no GoTrue reverte o local sem registrar divergência

- **Severidade**: P2
- **Tactic violada**: Comparison / Condition Monitoring
- **Localização**: `src/backend/domain/service/auth/CredentialMirror.ts:105-113` (`atualizar` só marca `supabaseAlterado` depois que a chamada retorna)
- **Evidência (objetiva)**:
  ```
  await this.supabaseAuthClient.adminUpdateUser(linha.authUserId, mudanca);
  estado.supabaseAlterado = true;   // não alcançado se a chamada expirou mas o GoTrue aplicou
  ```
- **Impacto técnico**: em timeout (10 s) com o PUT efetivamente aplicado, ocorre o ROLLBACK local e `aposFalha` não loga nada. Para senha, o GoTrue fica com a senha nova e o bcrypt local com a antiga; o sync não compara senha. Em `AUTH_PROVIDER=supabase` o usuário entra com a senha que a UI disse "não alterada". E-mail e ban são reparados pelo sync.
- **Impacto de negócio**: chamado de suporte "a senha nova funciona, a antiga não", sem pista no log. Janela pequena, mas silenciosa.
- **Métrica de baseline**: 1 de 5 operações espelhadas (senha) sem reparo automático possível e 5 de 5 sem log no caso de timeout.

### F-fault-tolerance-2: Reparo de divergência depende de execução manual e não há alerta

- **Severidade**: P2
- **Tactic violada**: Reintroduction (State Resync) / Condition Monitoring
- **Localização**: `src/backend/jobs/sync-supabase-auth.ts` (docstring: "Manual, sem scheduler"); `.github/workflows/`
- **Evidência (objetiva)**:
  ```
  .github/workflows: ci, detect-staleness, ingest-extratos, ingest-permutas, ingest-sispag, reaper-sispag, reconciliar-nde
  (0 para sync-supabase-auth)
  ```
- **Impacto técnico**: um desativado cujo ban no GoTrue falhou continua sem ban até alguém rodar o job. O corte de acesso é mantido pelo `ativo` lido por requisição (≤ 30 s), então o risco é de consistência (reversão de `AUTH_PROVIDER`, outros consumidores do projeto Supabase), não de acesso indevido imediato pelo app. O padrão de cron GH Actions já existe no repo.
- **Impacto de negócio**: deriva acumulada entre `app_user` e Supabase Auth, descoberta só no próximo incidente.
- **Métrica de baseline**: 0 execuções agendadas do sync; 0 alertas sobre `AUTH_DIVERGENCIA` (só log).

### F-fault-tolerance-3: Linha travada e conexão do pool ficam presas durante a chamada HTTP ao GoTrue

- **Severidade**: P3
- **Tactic violada**: Timeout (contenção) — trade-off consciente do desenho R6
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:599-633` (`FOR UPDATE` + `antesDoCommit`), `SupabaseAuthClient.ts:311`
- **Evidência (objetiva)**:
  ```
  REQUEST_TIMEOUT_MS = 10_000 → tx aberta até 10 s (20 s no vínculo por e-mail existente: adminFindUserByEmail + adminUpdateUser)
  ```
- **Impacto técnico**: GoTrue lento segura conexões do pool do Postgres; várias escritas admin simultâneas poderiam consumir o pool. Uso administrativo raro (~15 usuários) torna isso improvável.
- **Impacto de negócio**: mínimo hoje; degrada outras rotas só sob GoTrue lento com vários admins.
- **Métrica de baseline**: pior caso 10–20 s de tx aberta por escrita; sem métrica de duração de tx.

### F-fault-tolerance-4: Renovação de sessão no front sem timeout e sem distinguir falha transitória

- **Severidade**: P3
- **Tactic violada**: Timeout / Sanity Checking (frontend)
- **Localização**: `src/frontend/lib/auth/session-refresh.ts:82-97`
- **Evidência (objetiva)**:
  ```
  const res = await fetch(`${API}/auth/refresh`, {...})   // sem AbortSignal
  if (!res.ok) return null   /   catch { return null }     // 503 e rede == recusa
  ```
- **Impacto técnico**: `null` significa "não há como renovar"; um 503 transitório (que o backend devolve por design) pode levar ao modal de sessão expirada com o refresh token ainda válido. Um fetch pendurado segura o single-flight e o lock entre abas.
- **Impacto de negócio**: analista perde o contexto de trabalho por indisponibilidade breve do provedor.
- **Métrica de baseline**: 0 de 1 chamadas de refresh com timeout; 1 de 1 tratamento sem distinção 503 × 401.

## 5. Cards Kanban

### [fault-tolerance-1] Agendar o `sync-supabase-auth` e alertar em `AUTH_DIVERGENCIA`

- **Problema**
  > O sync que repara ban, e-mail e vínculo é manual e sem scheduler; a divergência só existe como linha de log. Há 6 workflows de job no repo e nenhum cobre isto.

- **Melhoria Proposta**
  > Criar workflow GH Actions diário rodando `job:sync-supabase-auth -- --execute` (padrão de `reaper-sispag.yml`; atenção ao gotcha de secrets e env estreito dos crons), com saída ≠ 0 falhando o run. Alerta por contagem de `AUTH_DIVERGENCIA` nas últimas 24 h (ex.: Painel Operação). Tactic: State Resync + Condition Monitoring.

- **Resultado Esperado**
  > Divergência reparada em ≤ 24 h sem intervenção humana; execuções agendadas 0 → 1/dia; alertas 0 → 1.

- **Tactic alvo**: Reintroduction (State Resync) + Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Jobs de reparo agendados: 0 → 1
  - Idade máxima de um ban pendente: indefinida → ≤ 24 h
- **Risco de não fazer**: em 6 meses, desativados acumulam sem ban no GoTrue e uma reversão de `AUTH_PROVIDER` ou outro consumidor do projeto expõe contas que deveriam estar cortadas.
- **Dependências**: nenhuma

### [fault-tolerance-2] Registrar divergência quando a escrita no GoTrue expira com resultado incerto

- **Problema**
  > Em timeout, a escrita pode ter sido aplicada no GoTrue; o rollback local ocorre sem `AUTH_DIVERGENCIA`, e a senha não é reconciliada pelo sync.

- **Melhoria Proposta**
  > Em `CredentialMirror.atualizar/criarEVincular`, capturar `SupabaseAuthUnavailableError` com reason `timeout` e marcar o estado como "incerto" para `aposFalha` logar operação e ids. Orientar no runbook (DEPLOY.md §6) redefinir a senha quando o log aparecer; documentar que senha não é reconciliável. Tactic: Comparison.

- **Resultado Esperado**
  > 100% dos timeouts de escrita rastreáveis (hoje 0 de 5 operações registram) e ação de suporte definida.

- **Tactic alvo**: Comparison / Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Timeouts de escrita com log de divergência: 0% → 100%
- **Risco de não fazer**: divergência de senha sem rastro, investigada às cegas.
- **Dependências**: nenhuma

### [fault-tolerance-3] Limitar a exposição do pool durante a espera do GoTrue

- **Problema**
  > A tx com `FOR UPDATE` segura uma conexão por até 10–20 s enquanto espera o GoTrue.

- **Melhoria Proposta**
  > Reduzir o timeout das escritas admin (ex.: 5 s) e/ou medir a duração da tx e logar acima de um limiar; avaliar `lock_timeout` na tx. Sem mudar o desenho R6. Tactic: Timeout.

- **Resultado Esperado**
  > Pior caso de tx aberta 20 s → ≤ 10 s, com métrica observável.

- **Tactic alvo**: Timeout
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Pior caso de tx aberta: 20 s → ≤ 10 s
- **Risco de não fazer**: sob GoTrue lento, admins em paralelo esgotam o pool.
- **Dependências**: nenhuma

### [fault-tolerance-4] Distinguir falha transitória de recusa na renovação de sessão do front

- **Problema**
  > `refreshSession` trata 503, erro de rede e 401 do mesmo modo (`null`) e não tem timeout.

- **Melhoria Proposta**
  > Adicionar `AbortSignal.timeout` ao fetch; em 503/rede, tentar de novo com backoff curto e manter a sessão em vez de expirar; expirar só em 401/recusa. Teste em `session-refresh.test.ts`. Tactic: Timeout / Recovery (forward).

- **Resultado Esperado**
  > 0 expirações de sessão por 503 transitório (hoje 1 de 1 caminhos tratam 503 como recusa).

- **Tactic alvo**: Timeout / Recovery (forward)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Refresh com timeout: 0/1 → 1/1
  - Caminhos que expiram sessão por 503: 1 → 0
- **Risco de não fazer**: analistas deslogados durante blips do provedor.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick`: só o delta de auth; nenhum fluxo de permuta/SISPAG/baixa foi revisado (não tocados). Sem `infra/`: DLQ/SQS não aplicáveis.
- O desenho central (lock local → GoTrue → COMMIT com rollback+503, desativar nunca bloqueado, sync idempotente) atende ao bar de consistência sob falha parcial; os findings são de arestas, nenhum P0/P1.
- Cross-QA: timeouts e ausência de scheduler → Availability/Deployability; log `AUTH_DIVERGENCIA` como trilha → Security (auditabilidade); teste do caminho de timeout incerto e do refresh 503 → Testability.
