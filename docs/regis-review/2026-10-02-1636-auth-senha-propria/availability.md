---
qa: Availability
qa_slug: availability
run_id: 2026-10-02-1636
agent: qa-availability
generated_at: 2026-10-02T16:40:00Z
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

> Escopo: delta da feature `auth-senha-propria` (`POST /me/senha`, `GET /me/senha/politica`, ADR-0059), `--quick`. Não há `infra/` neste repo, então as métricas de Terraform (DLQ, alarmes) não se aplicam.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado da Columbia | `POST /me/senha` enquanto o Supabase Auth (GoTrue) está lento, fora do ar ou devolve 429/5xx | `OwnPasswordService` → `SupabaseAuthClient` → `UserRepository.updatePassword` (transação) | Produção (Render), operação normal | Falha detectada por timeout, transação desfeita, resposta 503/429 em pt-BR, `password_hash` e trilha inalterados, login continua pelo caminho existente | 0 divergências silenciosas de senha; resposta ≤ ~10 s por chamada ao GoTrue; demais rotas do app não afetadas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients externos do delta com timeout explícito | 1 de 1 (`SupabaseAuthClient`, `AbortSignal.timeout`, 10 000 ms) | 100% | ✅ | `src/backend/domain/client/SupabaseAuthClient.ts:74,339` |
| Escrita de credencial atômica (hash + evento + passo do GoTrue na mesma transação) | Sim (`withTransaction`, linha travada) | Sim | ✅ | `src/backend/domain/repository/auth/UserRepository.ts:509-524` |
| Retry em escrita não idempotente (PUT /user, create) | 0 (escrita nunca repete; só leitura admin usa `RetryExecutor`) | 0 | ✅ | `SupabaseAuthClient.ts:63-64,83-87` |
| Falha do GoTrue mapeada a erro de domínio (sem 500) | 503 `AUTH_INDISPONIVEL`, 429 `MUITAS_TENTATIVAS` | 100% das falhas de dependência | ✅ | `src/backend/routes/me.ts:75-87` |
| Janela de divergência GoTrue×banco (GoTrue alterado, COMMIT falhou) | Coberta por log `AUTH_DIVERGENCIA` + `sync-supabase-auth`; sem alarme | Alarme automático | ⚠️ | `CredentialMirror.ts:89-101` |
| Limitador por usuário (5 falhas 422 / 15 min) | Presente; store em memória do processo | Store compartilhado se houver >1 instância | ⚠️ | `src/backend/http/rateLimit.ts:91-106` |
| Idempotência da troca | Natural (reaplicar a mesma senha é inócuo); sem chave de idempotência | N/A (não é escrita financeira) | ✅ | `OwnPasswordService.ts:alterar` |
| Migration 0073 reversível | Não (sem reverse); amplia CHECK, aditiva | Reverse documentado | ⚠️ | `_shared-metrics.md` (0073) |
| Testes backend | 189 suítes, 3498 testes, 0 falhas; `test:sql` 53/0 | 0 falhas | ✅ | `_shared-metrics.md` |
| Catch silencioso no delta | 1 intencional (`encerrarSonda`, best-effort com `logService.warn`) | 0 sem log | ✅ | `OwnPasswordService.ts:encerrarSonda` |
| Referências a `shared_account_id` no backend | Não aplicável (sem `infra/`, sem tenants provisionados) | 0 | N/A | CLAUDE.md, seção Tenants |

> ⚠️ **Não medível localmente**: taxa real de 503/429 em `/me/senha`, MTTR e frequência de `AUTH_DIVERGENCIA`. Requer logs de produção (Render). Recomendação: contar `type=AUTH_DIVERGENCIA` e `AUTH_INDISPONIVEL` por dia e alarmar acima de 0 para divergência.
>
> ⚠️ **Não medível localmente**: DLQ por fila, alarmes CloudWatch por tenant. Não existe `infra/` neste repo; o deploy é por Render.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum ping ativo ao GoTrue; só a sonda local `probe-gotrue-local.ts` | ❌ ausente | `src/backend/jobs/probe-gotrue-local.ts` |
| Heartbeat | Ausente | ❌ ausente | n/d |
| Monitor | Logs `AUTH_INDISPONIVEL` e `AUTH_DIVERGENCIA`; sem alarme/dashboard | ⚠️ parcial | `OwnPasswordService.ts`, `CredentialMirror.ts:95` |
| Timestamp | Evento da trilha `app_user_access_event` com data; sem ordenação distribuída necessária | N/A | Um único banco serializa a escrita |
| Sanity Checking | Política de senha validada antes de bcrypt/GoTrue; Zod `.strict()` no corpo; usuário inexistente falha | ✅ presente | `routes/me.ts:28-33`, `OwnPasswordService.ts:alterar` |
| Condition Monitoring | Rate limiter por usuário observa falhas repetidas | ⚠️ parcial | `rateLimit.ts:91-106` |
| Voting | Não há réplicas computando o mesmo resultado | N/A | Escrita única |
| Exception Detection | Timeout (`TimeoutError`→`unavailable`), rejeição (`SupabaseAuthRejectedError`), 429 (`rateLimited`) distinguidos | ✅ presente | `SupabaseAuthClient.ts:335-350`, `me.ts:57-90` |
| Self-Test | Sonda local e roteiro de QA manual; sem self-test em runtime | ⚠️ parcial | `jobs/probe-gotrue-local.ts` |
| Active Redundancy | Instância única Render; GoTrue gerido | N/A | Fora do escopo do delta |
| Passive Redundancy | Fallback `local` (bcrypt no banco) quando o modo é `local`, ou sem vínculo | ⚠️ parcial | `OwnPasswordService.ts:verificarSenhaAtual` |
| Spare | Ausente | N/A | Sem ambiente de standby no escopo |
| Exception Handling | Mapeamento a 400/422/429/503; recusa do GoTrue vira 503, não 500 | ✅ presente | `me.ts:57-90`, `OwnPasswordService.ts:gravar` |
| Rollback | Falha no passo do GoTrue desfaz a transação (nada gravado) | ✅ presente | `UserRepository.ts:514-523` |
| Software Upgrade | Migration 0073 aditiva e copiada ao `dist`; sem reverse | ⚠️ parcial | `migrations/0073_*.sql` |
| Retry | Leitura admin repete; escrita nunca repete (correto, não idempotente) | ✅ presente | `SupabaseAuthClient.ts:83-87` |
| Ignore Faulty Behavior | Falha em encerrar a sessão-sonda é ignorada com `warn` | ✅ presente | `OwnPasswordService.ts:encerrarSonda` |
| Degradation | GoTrue fora: 503 com mensagem clara; login e demais rotas seguem. A troca em si não tem modo degradado | ⚠️ parcial | `me.ts:83-86` |
| Reconfiguration | `AUTH_PROVIDER` `local`/`supabase` permite voltar ao bcrypt local (R7) | ✅ presente | `OwnPasswordService.ts:alterar`, `CredentialMirror.ts:58-60` |
| Shadow | Ausente | N/A | Sem componente reintroduzido neste delta |
| State Resynchronization | `sync-supabase-auth` repara divergência; execução manual | ⚠️ parcial | `CredentialMirror.ts:52` |
| Escalating Restart | Ausente (plataforma Render reinicia o processo) | N/A | Fora do delta |
| Non-Stop Forwarding | N/A | N/A | Sem roteamento de dados neste delta |
| Removal from Service | Ausente; limitador faz bloqueio temporário por usuário | N/A | Sem instância a retirar |
| Transactions | Hash + evento + espelho na mesma transação com `SELECT ... FOR UPDATE` | ✅ presente | `UserRepository.ts:514-524` |
| Predictive Model | Ausente | ❌ ausente | n/d |
| Exception Prevention | Política antes de bcrypt/GoTrue; `PUT /user` com token do chamador evita revogar a sessão atual; limitador contra força bruta | ✅ presente | `OwnPasswordService.ts`, `rateLimit.ts` |
| Increase Competence Set | Log de sucesso informa o ramo de revogação (`gotrue-put-user`, `pulada-hs256`, `sem-vinculo`) | ⚠️ parcial | `OwnPasswordService.ts:revogacao` |

## 4. Findings

### F-availability-1: Divergência GoTrue×banco sem alarme; reparo só manual

- **Severidade**: P2
- **Tactic violada**: Monitor / State Resynchronization
- **Localização**: `src/backend/domain/service/auth/CredentialMirror.ts:89-101`
- **Evidência (objetiva)**:
  ```
  if (!passo.estado.supabaseAlterado) return;
  await this.logService.error({ type: LOG_TYPE.AUTH_DIVERGENCIA, ... 'o sync-supabase-auth repara' })
  ```
- **Impacto técnico**: se o GoTrue mudar a senha e o COMMIT falhar, os dois lados divergem até alguém rodar o sync. O usuário vê a senha nova funcionar no GoTrue e a antiga no fallback `local`.
- **Impacto de negócio**: chamado de suporte "minha senha não entra", sem detecção proativa. A janela é estreita (falha de COMMIT depois de um PUT bem-sucedido).
- **Métrica de baseline**: 0 alarmes sobre `AUTH_DIVERGENCIA`; frequência real não medível localmente.

### F-availability-2: Limitador de tentativas com store em memória do processo

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/http/rateLimit.ts:46-56,91-106`
- **Evidência (objetiva)**:
  ```
  ...(options.store ? { store: options.store } : {}),   // sem store explícito em produção = memória
  ```
- **Impacto técnico**: o contador zera a cada restart/deploy e não é compartilhado entre instâncias. A proteção contra força bruta vale por processo.
- **Impacto de negócio**: baixo hoje (instância única no Render). Passa a importar se escalar horizontalmente.
- **Métrica de baseline**: 1 instância; limite 5 falhas / 15 min por usuário.

### F-availability-3: Chamada ao GoTrue dentro da transação com linha travada

- **Severidade**: P3
- **Tactic violada**: Exception Prevention
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:514-523`
- **Evidência (objetiva)**:
  ```
  const atual = await this.lerCredencial(tx, id, true);   // FOR UPDATE
  ...
  if (opcoes.antesDoCommit) await opcoes.antesDoCommit(tx, ...);  // HTTP ao GoTrue, timeout 10 s
  ```
- **Impacto técnico**: a conexão do pool e a linha do usuário ficam presas por até ~10 s se o GoTrue travar. Escopo é uma linha do próprio usuário, então o raio de impacto é pequeno. O pool é compartilhado com o resto do app.
- **Impacto de negócio**: muitos usuários trocando senha durante uma lentidão do GoTrue poderiam ocupar o pool. O limitador (só conta 422) não limita esse caso.
- **Métrica de baseline**: timeout 10 000 ms por chamada; até 2 chamadas ao GoTrue por requisição em modo supabase (sonda + PUT), sem teto de requisições simultâneas.

### F-availability-4: Migration 0073 sem reverse

- **Severidade**: P3
- **Tactic violada**: Software Upgrade
- **Localização**: `src/backend/migrations/0073_app_user_access_event_tipo_senha.sql`
- **Evidência (objetiva)**: migration amplia o CHECK de `tipo`; sem script de reverso. Depois de gravar eventos `SENHA`, reduzir o CHECK falharia nas linhas existentes.
- **Impacto técnico**: o rollback do código para a versão anterior é seguro (CHECK mais largo aceita tudo que a versão anterior grava). O rollback do schema não é.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 0 reverses para a 0073.

## 5. Cards Kanban

### [availability-1] Alarmar `AUTH_DIVERGENCIA` e agendar o `sync-supabase-auth`

- **Problema**
  > Quando o GoTrue muda e o COMMIT local falha, o único rastro é um log `AUTH_DIVERGENCIA`; o reparo depende de alguém rodar o sync (`CredentialMirror.ts:95`).

- **Melhoria Proposta**
  > Monitor: alerta em qualquer ocorrência de `AUTH_DIVERGENCIA` (log drain/Render) e execução periódica do `sync-supabase-auth` (State Resynchronization). Sem mudança de código no delta.

- **Resultado Esperado**
  > Divergência detectada e reparada sem chamado de suporte; tempo de detecção de "indefinido" para menos de 1 dia.

- **Tactic alvo**: Monitor / State Resynchronization
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Alarme sobre `AUTH_DIVERGENCIA`: 0 → 1
  - Execução agendada do sync: manual → diária
- **Risco de não fazer**: divergências de senha acumulam em silêncio e viram chamados de suporte difíceis de diagnosticar.
- **Dependências**: nenhuma

### [availability-2] Teto de concorrência e store compartilhado para o fluxo de troca de senha

- **Problema**
  > A troca segura uma conexão do pool e uma linha travada durante a chamada ao GoTrue (até 10 s); o limitador só conta respostas 422 e guarda o estado em memória.

- **Melhoria Proposta**
  > Exception Prevention: limite de requisições simultâneas em `/me/senha` (ou limitador por IP complementar) e, se houver escala horizontal, store compartilhado (Postgres/Redis) para o limitador. Avaliar mover a chamada de `PUT /user` para depois do COMMIT com compensação, só se a medição mostrar pressão no pool.

- **Resultado Esperado**
  > Lentidão do GoTrue não consome o pool além de um teto definido.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2, F-availability-3
- **Métricas de sucesso**:
  - Requisições simultâneas a `/me/senha`: sem teto → teto definido
  - Store do limitador: memória → compartilhado (só se escalar)
- **Risco de não fazer**: baixo hoje; cresce com o número de instâncias e usuários.
- **Dependências**: decisão sobre escala horizontal

### [availability-3] Documentar o reverso da migration 0073

- **Problema**
  > A 0073 não tem reverse; o schema não volta atrás depois que existirem eventos `SENHA`.

- **Melhoria Proposta**
  > Software Upgrade: registrar em `DEPLOY.md` que o rollback do código é seguro sem reverter a migration e qual script de reverso usar (convertendo ou removendo eventos `SENHA` antes de reduzir o CHECK).

- **Resultado Esperado**
  > Procedimento de rollback escrito antes do próximo incidente.

- **Tactic alvo**: Software Upgrade
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Rollback documentado da 0073: não → sim
- **Risco de não fazer**: baixo; improvisação sob pressão em um rollback de schema.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo só do delta; `--quick`, sem coverage nem audit. Não existe `infra/`, então DLQ, alarmes por tenant e `shared_account_id` não foram medidos (declarado acima).
- P0 não encontrado: timeout explícito (10 s), transação com rollback, escrita sem retry e mapeamento de falha a 503/429 estão presentes; o fluxo não é escrita financeira nem cruza tenants.
- Cross-QA: F-availability-3 interessa a performance (pool de conexões); F-availability-2 interessa a security (força bruta).
