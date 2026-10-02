---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-02-1636
agent: qa-fault-tolerance
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (ou duplo clique) | `POST /me/senha` com o GoTrue lento/fora, ou COMMIT do Postgres falhando depois de o GoTrue já ter trocado a senha | `OwnPasswordService.alterar` → `UserRepository.updatePassword` (transação) → `CredentialMirror.espelhar` → `SupabaseAuthClient.updateOwnPassword` | Produção, `AUTH_PROVIDER` local ou supabase, API admin configurada | GoTrue falha antes do COMMIT: ROLLBACK, 503, nada alterado. COMMIT falha depois do GoTrue: `AUTH_DIVERGENCIA` com ids. Hash local e evento de trilha na mesma transação | 0 trocas parciais silenciosas; 100% das divergências com log `AUTH_DIVERGENCIA`; timeout de 10 s |

Observação de escopo: o delta não executa escrita financeira (permuta, remessa, baixa); o análogo aplicável é "estado local x GoTrue" (R6/R7), a única dual-write do delta.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas multi-tabela do delta dentro de transação (hash + evento + passo GoTrue) | 1 de 1 | 100% | ✅ | `UserRepository.ts:509-524` (`withTransaction`, `lerCredencial(..., true)` trava a linha) |
| Escrita de estado com evento de trilha pareado na mesma transação | 1 de 1 (`ACCESS_EVENT_TYPE.SENHA`) | 100% | ✅ | `UserRepository.ts:521`, `OwnPasswordService.ts:172-178` |
| Chamadas externas novas com timeout | 3 de 3 (`signInWithPassword`, `logout`, `updateOwnPassword` via `request()`) | 100% | ✅ | `SupabaseAuthClient.ts:74` (`REQUEST_TIMEOUT_MS = 10_000`), `:339` (`AbortSignal.timeout`) |
| Ordem GoTrue → COMMIT (falha do GoTrue desfaz o local) | sim | sim | ✅ | `CredentialMirror.ts:84`, `:149-158` |
| Falha pós-GoTrue com sinal durável (log `AUTH_DIVERGENCIA`) | sim, log (`logService.error`) | durável + reparável | ⚠️ | `CredentialMirror.ts:89-107`; reparo ausente para senha (F-fault-tolerance-1) |
| Idempotency-Key em `POST /me/senha` | 0 de 1 | n/a (re-envio é naturalmente seguro) | ⚠️ | `routes/me.ts`; pós-troca a senha atual deixa de valer, o 2º envio recebe 422 |
| Rate limit de tentativas de senha atual | 5 falhas / 15 min por usuário | presente | ✅ | `http/rateLimit.ts:91-106` |
| Reprocess / stuck-state reaper / reconciliação para o delta | ⚠️ Não medível: nenhum job de reconciliação de senha GoTrue x local | presente | ❌ | `SupabaseAuthSyncService.ts:65,181` (sync não toca senha) |
| Testes de falha do GoTrue (503, rollback, trilha inalterada) | roteiro de QA local registrado + testes de service/repository | cobrir | ✅ | `_shared-metrics.md`; `OwnPasswordService.test.ts`, `UserRepository.test.ts` |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution / Replacement | N/A: sem componente redundante a substituir no delta | N/A | n/a |
| Sanity Checking | Política de senha antes de bcrypt/GoTrue; usuário vindo de `req.user.sub`; `updateOwnPassword` valida resposta (recusa vira `SupabaseAuthRejectedError`) | ✅ presente | `OwnPasswordService.ts:80-81`, `SupabaseAuthClient.ts:154` |
| Timeout | 10 s por chamada ao GoTrue, `TimeoutError` mapeado a `SupabaseAuthUnavailableError('timeout')` | ✅ presente | `SupabaseAuthClient.ts:339-348` |
| Condition Monitoring | `AUTH_INDISPONIVEL` (warn) e `AUTH_DIVERGENCIA` (error) em log estruturado | ⚠️ parcial (só log; sem alarme/contador) | `OwnPasswordService.ts:146,183`; `CredentialMirror.ts:95` |
| Timestamp | Evento de trilha com ator/alvo/tipo e data na transação | ✅ presente | `UserRepository.ts:521` |
| Recovery (backward) / Rollback | `antesDoCommit` dentro da transação: erro do GoTrue desfaz o hash e o evento; rota responde 503 | ✅ presente | `UserRepository.ts:522`, `OwnPasswordService.ts:180-195` |
| Recovery (forward) / Repair State | `AUTH_DIVERGENCIA` promete reparo pelo `sync-supabase-auth`, que não repara senha | ❌ ausente para senha | `SupabaseAuthSyncService.ts:181` (`SENHA_MANTIDA`), `CredentialMirror.ts:98-100` |
| Idempotent Replay | Re-envio de `POST /me/senha` é seguro por construção (senha atual muda, 422) e há lock de linha (`FOR UPDATE`) contra trocas concorrentes | ✅ presente | `UserRepository.ts:515` |
| Compensating Transaction | N/A: o `PUT /user` do GoTrue não tem undo limpo; a escolha explícita é ordem GoTrue → COMMIT + log de divergência (forward recovery) | N/A (decisão documentada na ADR-0059) | `CredentialMirror.ts:49-52` |
| Reconcile | Sem comparação periódica senha GoTrue x hash local (o hash em claro não é legível) | ❌ ausente | F-fault-tolerance-1 |
| Quarantine | N/A: sem fila de exceção para o delta; a divergência vai ao log | N/A | n/a |
| Redundancy | N/A para o delta | N/A | n/a |
| Increase Competence Set | `PasswordPolicyError`, `CurrentPasswordInvalidError` e GoTrue recusado como 503 em vez de 500 | ✅ presente | `OwnPasswordService.ts:181-193` |

## 4. Findings (achados)

### F-fault-tolerance-1: `AUTH_DIVERGENCIA` de senha promete reparo que o sync não faz

- **Severidade**: P2
- **Tactic violada**: Repair State / Reconcile
- **Localização**: `src/backend/domain/service/auth/CredentialMirror.ts:95-107`, `src/backend/domain/service/auth/SupabaseAuthSyncService.ts:65,181`
- **Evidência (objetiva)**:
  ```
  message: '... o Supabase Auth foi alterado, mas a gravação local falhou; o sync-supabase-auth repara'
  // sync: SENHA_MANTIDA = 'senha do Supabase Auth mantida; se não entrar, redefina a senha'
  ```
- **Impacto técnico**: se o `PUT /user` do GoTrue passa e o COMMIT falha (queda do Postgres, conexão cortada), o GoTrue fica com a senha nova e o `password_hash` local com a antiga. O sync só vincula/cria e mantém a senha do GoTrue (o update ignora `password_hash`, T-1), então nada converge. Em `supabase` o login vale com a nova; em `local` (rollback de configuração, R7) vale a antiga. A mensagem induz o operador a esperar reparo automático.
- **Impacto de negócio**: janela estreita (falha de COMMIT depois de uma chamada HTTP bem-sucedida). Efeito: um usuário com senha que difere entre os dois sistemas e sem sinal para suporte além do log. Não envolve dinheiro.
- **Métrica de baseline**: 0 de 1 caminhos de divergência de senha com reparo automático; 1 de 1 com log. Probabilidade: não medível localmente (sem taxa de falha de COMMIT em produção).

### F-fault-tolerance-2: Divergência só em log, sem contador ou alarme

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring
- **Localização**: `CredentialMirror.ts:95`, `OwnPasswordService.ts:146,183`
- **Evidência (objetiva)**:
  ```
  await this.logService.error({ type: LOG_TYPE.AUTH_DIVERGENCIA, ... })
  ```
- **Impacto técnico**: `AUTH_DIVERGENCIA` é erro de log, não métrica nem alerta; depende de alguém varrer o log. O padrão é pré-existente (4 pontos: `CredentialMirror`, `SupabaseAuthSyncService`, `SupabaseSessionService`); o delta o reaproveita.
- **Impacto de negócio**: divergência de credencial pode ficar sem tratamento até o usuário reclamar.
- **Métrica de baseline**: 0 alertas configurados sobre `AUTH_DIVERGENCIA` (não há `infra/`; não medível localmente).

### F-fault-tolerance-3: Chamada HTTP ao GoTrue dentro da transação segura a linha travada

- **Severidade**: P3
- **Tactic violada**: Timeout / Contain Faults (isolamento do componente lento)
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:514-523`
- **Evidência (objetiva)**:
  ```
  withTransaction(... lerCredencial(tx, id, true) ... await opcoes.antesDoCommit(tx, ...))
  ```
- **Impacto técnico**: o `FOR UPDATE` da linha do usuário e uma conexão do pool ficam presos até 10 s (timeout do GoTrue) por troca. É a escolha deliberada da R6 (ordem GoTrue antes do COMMIT, sem outbox), com efeito limitado: só a própria linha e o rate limit de 5 falhas protegem o pool.
- **Impacto de negócio**: negligenciável com o volume do app (poucos usuários internos). Vira problema só se o GoTrue ficar lento e muitos usuários trocarem a senha ao mesmo tempo.
- **Métrica de baseline**: 10 000 ms de pior caso por transação com a conexão presa; pool: não medido (`--quick`).

Nenhum P0: o delta não tem dual-write sem transação, não tem catch silencioso (`aposFalha` loga e relança; a recusa do GoTrue vira 503 com log), e a trilha é gravada na mesma transação do hash.

## 5. Cards Kanban

### [fault-tolerance-1] Corrigir a promessa de reparo da divergência de senha e oferecer um reparo real

- **Problema**
  > O log `AUTH_DIVERGENCIA` diz que o `sync-supabase-auth` repara, mas o sync mantém a senha do GoTrue e não reconcilia senha. Após falha de COMMIT depois do `PUT /user`, os dois sistemas ficam com senhas distintas sem convergência.

- **Melhoria Proposta**
  > Curto prazo: trocar a mensagem em `CredentialMirror.aposFalha` (operação `senha`) para "redefina a senha do usuário" com a ação operacional no `DEPLOY.md`. Opcional: no 503/500 pós-GoTrue, o service tenta um `PUT /user` de volta para a senha antiga (compensação best-effort, só possível com a senha atual em memória) ou a rota orienta o usuário a repetir a troca com a senha nova. Documentar a escolha (forward recovery) na ADR-0059.

- **Resultado Esperado**
  > Mensagem verdadeira e runbook escrito: divergências de senha com instrução de reparo 0 → 100%.

- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Divergências de senha com reparo documentado: 0 → 1 de 1
- **Risco de não fazer**: o suporte espera um reparo que não acontece e o usuário fica com senha inconsistente entre os modos.
- **Dependências**: nenhuma

### [fault-tolerance-2] Alarme sobre `AUTH_DIVERGENCIA` e `AUTH_INDISPONIVEL`

- **Problema**
  > As divergências de credencial só existem como linha de log; sem contador ou alerta ninguém é avisado.

- **Melhoria Proposta**
  > Quando houver observabilidade (Render log drain ou métrica), alertar em qualquer ocorrência de `AUTH_DIVERGENCIA` e em taxa alta de `AUTH_INDISPONIVEL`. Cobrir os 4 pontos de emissão, não só o delta.

- **Resultado Esperado**
  > Tempo para notar uma divergência: indefinido → menos de 1 dia útil.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Alertas sobre `AUTH_DIVERGENCIA`: 0 → 1
- **Risco de não fazer**: divergências acumulam sem dono.
- **Dependências**: decisão de plataforma de logs/alertas

### [fault-tolerance-3] Registrar o custo da chamada ao GoTrue dentro da transação

- **Problema**
  > A troca de senha segura uma conexão do pool e o lock da linha por até 10 s enquanto espera o GoTrue (R6, escolha deliberada).

- **Melhoria Proposta**
  > Registrar na ADR-0059 o limite aceito (volume interno, rate limit) e reavaliar se houver uso em massa. Nenhuma mudança de código agora.

- **Resultado Esperado**
  > Decisão e gatilho de reavaliação documentados: 0 → 1.

- **Tactic alvo**: Timeout
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Limite aceito documentado: não → sim
- **Risco de não fazer**: baixo; o impacto só aparece com GoTrue lento e carga concorrente.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de `auth-senha-propria`. Não há financial write no delta; os critérios de dupla execução, DLQ e reaper não se aplicam e ficaram fora da tabela.
- Pontos fortes: GoTrue dentro da transação (erro vira ROLLBACK e 503), hash e evento de trilha atômicos, lock de linha, timeout de 10 s, rate limit por usuário, e `aposFalha` que loga e relança.
- Cross-QA: Security (trilha `SENHA`, rate limit, redact), Testability (cenário de COMMIT falhando depois do GoTrue sem teste dedicado, não confirmado), Availability (timeout/503 do GoTrue).
- Não medido por `--quick`: coverage e `npm audit`.
