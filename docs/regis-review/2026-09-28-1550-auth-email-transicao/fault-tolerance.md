---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-28-1550-auth-email-transicao
agent: qa-fault-tolerance
generated_at: 2026-09-28T19:10:00Z
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

> Escopo desta revisão: o delta `auth-email-transicao` (passo 1/3 do plano de auth, ADR-0051) —
> `app_user.email`, login por e-mail/usuário, guarda de desativação (R11), `seed-admin` sem default.
> **Nenhuma chamada a Conexos/Nexxera/GED neste delta** — os pontos do roteiro sobre SQS/DLQ/
> reconciliação com Conexos/`fin010` não se aplicam a este PR (marcados N/A com justificativa, não
> "ausentes"). O QA "Safety" de Bass & Clements foi substituído por Fault Tolerance neste domínio
> (financeiro, escritas que movem dinheiro) — aqui o objeto de exame é a integridade do estado de
> `app_user`, base de identidade para todo write-path financeiro futuro.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dois admins da Columbia, simultaneamente (ou um retry de rede duplicando o mesmo POST) | `PATCH /usuarios/:id/ativo` concorrente desativando o último admin ativo; ou `POST /usuarios` reenviado com o mesmo e-mail | `UserRepository.deactivateGuarded` / `UserRepository.create` sobre `app_user` | Pool Postgres (Supabase, `poolMaxConnections=5`) ativo, produção Render, sem infra transacional externa | A transação serializa via `SELECT ... FOR UPDATE` (um admin passa, o outro recusa com `LastActiveAdminError`); a segunda escrita duplicada converte em `409 EmailAlreadyInUseError` via índice único `lower()`, nunca duas linhas | 0 admins zerados / 0 usuários com e-mail duplicado — medido 20/20 em teste live-DB descartável (ver `_shared-metrics.md`, "corrida de dois admins: 1 passa, 1 recusa, resta 1 ativo") |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `# repositórios com >1 write que tocam ≥2 statements sequenciais e estão em transação` | 1/1 (`deactivateGuarded`) | 100% | ✅ | `src/backend/domain/repository/auth/UserRepository.ts:280-312` (`withTransaction` + `FOR UPDATE`) |
| `# mutações desta feature naturalmente idempotentes (chave natural / no-op)` | 4/5 (`create` via 409 de e-mail único; `setEmail` via no-op de mesmo valor; `setAtivo`/`deactivateGuarded` via update idempotente; `upsertAdmin` via `ON CONFLICT`) | — (não há Idempotency-Key formal; ver F-fault-tolerance-2) | ⚠️ | `UserRepository.ts:174-216, 227-260, 263-312, 370-381` |
| `# endpoints de mutação com header `Idempotency-Key` honrado explicitamente` | 0/5 | 100% nos futuros write-paths financeiros (não neste delta) | ⚠️ | `grep -rn "Idempotency-Key\|idempotencyKey" src/backend/routes/usuarios.ts src/backend/routes/auth.ts` → vazio |
| `# callsites de mutação com trilha de auditoria persistida (coluna `*_updated_by`/`*_updated_at` ou `created_by`/`created_at`)` | 2/3 novas ações do delta (`create` herda `created_by`/`created_at` pré-existentes; `setEmail` ganha `email_updated_by`/`email_updated_at` na própria migration 0064); `setAtivo`/`deactivateGuarded` = 0/1 | 3/3 | ❌ | `src/backend/migrations/0064_app_user_email.sql:34-36`; `UserRepository.ts:280-312` (sem coluna equivalente) |
| Testes de corrida cobrindo a guarda R11 | 1 cenário unitário (mock, `withTransaction` simulado) + 1 cenário live-DB (Postgres descartável, 2 admins concorrentes) | ≥1 por invariante nova | ✅ | `UserRepository.test.ts:355-441`; `_shared-metrics.md` ("Repositório ao vivo") |
| `# de statements não-idempotentes que o `PostgreeDatabaseClient` retenta às cegas após conexão cair` | 0 (herdado, não tocado pelo delta) | 0 | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:60-83` (`nonRepeatableQueryRetryExecutor` só retenta recusa de conexão, nunca conexão caída em voo) — **PRÉ-EXISTENTE**, arquivo fora do diff |
| Janela de exposição de sessão após desativação (`ativo=false`) | até 12h (`TOKEN_EXPIRATION`), sem checagem de `ativo` por request | 0 (revogação ativa) ou TTL curto | ❌ | `AuthService.ts:32`; `http/auth.ts:177-195` (middleware só verifica assinatura/expiração) — **PRÉ-EXISTENTE ao delta**, já documentado na própria ADR-0051 (ver F-fault-tolerance-3) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Avoid — Substitution** | N/A — sem provedor redundante nesta feature (um único Postgres, um único IdP) | N/A | — |
| **Avoid — Replacement** | N/A — sem componente substituível em runtime | N/A | — |
| **Avoid — Predictive Model** | N/A — não aplicável a CRUD de identidade | N/A | — |
| **Avoid — Increase Competence Set** | Zod no boundary de toda rota de mutação (`createUserSchema`, `setEmailSchema`, `idParamSchema`, `setAtivoSchema`, `resetPasswordSchema`) — rejeita o input inválido ANTES de tocar o banco | ✅ presente | `UserAdminService.ts:20,38-67,73,76-78`; `routes/usuarios.ts:36-37` |
| **Detect — Sanity Checking** | Mesmo Zod acima + `emailField` normaliza/valida forma de e-mail | ✅ presente | `UserAdminService.ts:20` |
| **Detect — Comparison** | Checagem cruzada no mesmo `INSERT`/`UPDATE`: o valor não pode já ser `email` OU `username` de OUTRO usuário, comparado antes de commitar | ✅ presente | `UserRepository.ts:190-195` (`create`), `UserRepository.ts:238-242` (`setEmail`) |
| **Detect — Timestamp** | `email_updated_at` grava QUANDO a trilha mudou; ausente para `ativo` (ver F-fault-tolerance-1) | ⚠️ parcial | `migrations/0064_app_user_email.sql:35-36` |
| **Detect — Timeout** | Pool Postgres com `poolConnectionTimeoutMillis=5000`/`poolIdleTimeoutMillis=10000` — herdado, não tocado pelo delta | ✅ presente (pré-existente) | `PostgreeDatabaseClient.ts:37-39` (fora do diff) |
| **Detect — Condition Monitoring** | `AuthService.login` detecta e recusa (401 + log) quando o identificador casa com >1 linha — invariante I3 monitorada em runtime, não só na escrita | ✅ presente | `AuthService.ts:62-76` |
| **Detect — Self-Test** | N/A — sem health-check próprio desta feature | N/A | — |
| **Detect — Voting** | N/A — fonte única de verdade (uma tabela, um Postgres) | N/A | — |
| **Contain — Redundancy** | N/A — sem réplica/redundância de componente nesta feature | N/A | — |
| **Contain — Recovery (backward)** | `withTransaction` faz `ROLLBACK` e relança o erro original em qualquer falha dentro de `deactivateGuarded` | ✅ presente | `PostgreeDatabaseClient.ts:178-196` (pré-existente, corretamente reusado) |
| **Contain — Recovery (forward)** | Colisão de e-mail (409), guardas R11 (409) e `NOT_FOUND` (404) são devolvidos como erro tipado e ACIONÁVEL ao admin — nunca mascarados como sucesso parcial | ✅ presente | `routes/usuarios.ts:44-69` (`respondError`) |
| **Contain — Reintroduction** | N/A — não há instância/processo a reintroduzir nesta feature (sem fila, sem worker) | N/A | — |
| **Recover — Rollback** | Ver "Recovery (backward)" acima — mesma evidência | ✅ presente | `PostgreeDatabaseClient.ts:178-196` |
| **Recover — Repair State** | Ausente para `ativo` (sem coluna equivalente a `email_updated_by/at`); presente para `email` | ⚠️ parcial | Ver F-fault-tolerance-1 |
| **Recover — Idempotent Replay** | `create` (409 em e-mail repetido), `setEmail` (no-op em mesmo valor), `upsertAdmin` (`ON CONFLICT DO UPDATE`), `deactivateGuarded`/`setAtivo` (idempotente por natureza — reaplicar `ativo=false` é no-op) — todos seguros a reenvio, mas por CHAVE NATURAL, não por `Idempotency-Key` formal | ✅ presente (informal) | `UserRepository.ts:174-216,227-260,370-381` |
| **Recover — Compensating Transaction** | N/A — este delta não escreve em sistema externo (Conexos/Nexxera/GED); nenhuma compensação é necessária | N/A — justificativa: `_shared-metrics.md` confirma "Nenhuma chamada a Conexos/Nexxera/GED neste delta" | — |
| **Recover — Reconcile** | N/A — sem par externo a reconciliar nesta feature | N/A | — |
| **Recover — Quarantine** | Identificador ambíguo (>1 linha casando) é "quarentenado": a escrita nunca escolhe, recusa e loga para o operador investigar `/usuarios` | ✅ presente | `AuthService.ts:64-76` |

## 4. Findings (achados)

### F-fault-tolerance-1: Ativar/desativar usuário não deixa trilha de auditoria persistida (assimetria introduzida no próprio delta)

- **Severidade**: P1 (alto — degrada a invariante de auditoria; a mesma migration/commit que resolveu isso para `email` não resolveu para `ativo`)
- **Tactic violada**: Repair State (trilha de auditoria — invariante cross-cutting da proposta, análoga à vigência de status)
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:280-312` (`deactivateGuarded`, `setAtivo`); `src/backend/domain/service/auth/UserAdminService.ts:176-186` (`setAtivo`, nenhuma chamada a `LogService`)
- **Evidência (objetiva)**:
  ```ts
  // UserAdminService.setAtivo — NENHUMA chamada a this.logService, nos dois ramos:
  public setAtivo = async (id: number, ativo: boolean, actorUsername: string): Promise<void> => {
      if (!ativo) {
          const result = await this.userRepository.deactivateGuarded(id, actorUsername);
          if (result === DEACTIVATE_RESULT.NOT_FOUND) throw new Error(`NOT_FOUND: user ${id} not found`);
          return;
      }
      const ok = await this.userRepository.setAtivo(id, true);
      if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
  };
  ```
  Compare com `setEmail`, no MESMO arquivo/commit, que loga em sucesso e persiste `email_updated_by`/`email_updated_at` (`UserRepository.ts:227-260`, `UserAdminService.ts:131-143`). A migration `0064_app_user_email.sql` cria colunas de trilha só para `email`; `ativo` (coluna pré-existente, migration `0028`) nunca ganhou `ativo_updated_by`/`ativo_updated_at`, e a nova guarda R11 — que É nova neste delta — não fecha essa lacuna.
- **Impacto técnico**: se o acesso de um usuário for alterado por engano, por um admin mal-intencionado, ou por um bug futuro na guarda, não há registro no banco de QUEM e QUANDO — só o log efêmero de stdout do Render (sem persistência, sem retenção garantida), e mesmo esse log nem é emitido no sucesso desta ação.
- **Impacto de negócio**: `ativo` é o interruptor de acesso à plataforma financeira (quem pode executar Permutas/SISPAG). A própria feature trata a desativação como sensível o bastante para ganhar duas guardas novas (R11: autodesativação, último admin) — mas não fecha o lado forense: numa revisão de acesso/compliance, "quem desativou o usuário X e quando" não tem resposta no banco.
- **Métrica de baseline**: 1/2 ações de gestão introduzidas/alteradas por este delta com trilha persistida (`setEmail` sim, `setAtivo` não) = 50% de cobertura.

### F-fault-tolerance-2: Nenhum endpoint de mutação honra `Idempotency-Key` formal (mitigado, mas o padrão não existe ainda)

- **Severidade**: P2 (médio — mitigado por chave natural + botão desabilitado no front; nenhuma escrita financeira neste delta)
- **Tactic violada**: Idempotent Replay
- **Localização**: `src/backend/routes/usuarios.ts` (`POST /`, `PATCH /:id/email`, `PATCH /:id/ativo`, `POST /:id/reset-senha`, `PATCH /:id/vinculo`); `src/backend/routes/auth.ts` (`POST /login`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "Idempotency-Key\|idempotencyKey" src/backend/routes/usuarios.ts src/backend/routes/auth.ts
  (sem saída)
  ```
  Cada mutação é segura a reenvio por acidente HOJE só porque o e-mail é chave natural única (`create`, `setEmail`) ou a operação já é idempotente por construção (`setAtivo`, `vinculo`) — não porque existe um mecanismo formal de deduplicação de requisição.
- **Impacto técnico**: nenhum nesta feature especificamente (todas as 5 rotas são seguras por acidente, confirmado na leitura linha a linha). O risco é sistêmico: este é o primeiro conjunto de rotas de mutação que nasce sob a política DDD/Lambda-ready do CLAUDE.md, e ele não estabelece o padrão de idempotência que as frentes financeiras (Permutas, SISPAG) vão precisar quando `execução de permuta`/`finalização de lote`/`baixa` não tiverem uma chave natural tão conveniente quanto "e-mail único".
- **Impacto de negócio**: baixo agora (gestão de usuários, não movimentação de dinheiro). Alto se o padrão não for definido antes das frentes financeiras chegarem — double-click ou retry de proxy num "executar permuta" sem chave natural É o cenário P0 que a missão desta revisão existe para prevenir.
- **Métrica de baseline**: 0/5 endpoints de mutação deste delta aceitam `Idempotency-Key`; 5/5 são idempotentes "por sorte de domínio" (chave natural ou operação already-idempotent).

### F-fault-tolerance-3: Sessão JWT de usuário desativado continua válida por até 12h (PRÉ-EXISTENTE, amplificado pelo delta)

- **Severidade**: P3 (baixo — já documentado como lacuna consciente na própria ADR-0051; comportamento herdado de `origin/main`, não introduzido por este PR)
- **Tactic violada**: Rollback / Recovery (revogação de credencial após mudança de estado de autorização)
- **Localização**: `src/backend/domain/service/auth/AuthService.ts:32` (`TOKEN_EXPIRATION = '12h'`); `src/backend/http/auth.ts:177-195` (`buildAuthMiddleware` só verifica assinatura/expiração do JWT, nunca `ativo` no banco); `ontology/decisions/0051-auth-email-real-sub-continua-username.md` (seção "Consequências")
- **Evidência (objetiva)**:
  ```
  Desativar um usuário continua não derrubando o token que ele já tem (JWT stateless, 12h).
  Lacuna anterior a esta ADR; candidata natural ao passo 2, que lê permissões do banco por
  requisição.
  ```
  (texto literal da ADR-0051, `Consequências`). Confirmado em `git show origin/main:...AuthService.ts` — `TOKEN_EXPIRATION='12h'` e a ausência de revogação já existiam antes deste delta.
- **Impacto técnico**: as duas guardas NOVAS de R11 (autodesativação, último admin) protegem a GOVERNANÇA de quem pode desativar, mas não encurtam a sessão já emitida do alvo — um admin desativado por suspeita de comprometimento mantém acesso funcional por até 12h.
- **Impacto de negócio**: numa automação financeira, a janela de 12h pós-desativação é o tempo em que uma credencial supostamente revogada ainda pode gerar tráfego autenticado — relevante para resposta a incidente, mesmo que esta feature isolada não toque Permutas/SISPAG diretamente.
- **Métrica de baseline**: `TOKEN_EXPIRATION='12h'`; 0 de N rotas re-checam `ativo` por request.
- **Nota de escopo**: mantido P3 e **não promovido a P0/P1** por instrução do escopo desta revisão (comportamento pré-existente, já em `origin/main` antes do delta) — registrado porque o delta aumenta o peso operacional colocado sobre "desativação" como controle de segurança sem fechar essa janela.

## 5. Cards Kanban

### [fault-tolerance-1] Persistir quem/quando ativou ou desativou cada usuário

- **Problema**
  > `setAtivo`/`deactivateGuarded` mudam o controle de acesso da plataforma financeira sem deixar
  > rastro no banco (`UserRepository.ts:280-312`, `UserAdminService.ts:176-186`) — nem coluna
  > `ativo_updated_by`/`ativo_updated_at`, nem chamada a `LogService`. O mesmo delta resolveu isso
  > para `email` (`email_updated_by`/`email_updated_at`, migration `0064`) mas não para `ativo`.

- **Melhoria Proposta**
  > Aplicar a tactic **Repair State**: nova migration aditiva (`ativo_updated_by TEXT`,
  > `ativo_updated_at TIMESTAMPTZ`), gravadas no MESMO `UPDATE` de `deactivateGuarded`/`setAtivo`
  > (mesmo padrão do `setEmail`, um único statement). Espelhar o `LogService.info` que `setEmail` já
  > emite em sucesso. Arquivos: `UserRepository.ts`, `UserAdminService.ts`, nova
  > `migrations/00XX_app_user_ativo_trail.sql`.

- **Resultado Esperado**
  > Cobertura de trilha persistida por ação de gestão: 50% (1/2) → 100% (2/2). Toda mudança de
  > `ativo` responde "quem" e "quando" com uma query, sem depender de log efêmero do Render.

- **Tactic alvo**: Repair State
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Colunas de trilha em `ativo`: ausentes → presentes (`ativo_updated_by`, `ativo_updated_at`)
  - `LogService.info` em `setAtivo` (sucesso): ausente → presente
- **Risco de não fazer**: numa revisão de acesso/compliance daqui a 6 meses, "quem desativou o
  usuário X e quando" não tem resposta no banco — só logs efêmeros sem retenção garantida.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Definir o padrão de `Idempotency-Key` antes que ele chegue às frentes financeiras

- **Problema**
  > Nenhuma das 5 rotas de mutação deste delta honra `Idempotency-Key` — hoje são seguras por
  > acidente (chave natural de e-mail, operações já idempotentes), mas este é o primeiro conjunto de
  > rotas nascido sob a política DDD/Lambda-ready do CLAUDE.md, e ele não estabelece o padrão que
  > "executar permuta"/"finalizar lote"/"baixar conciliação" vão precisar — ações sem chave natural
  > tão conveniente quanto e-mail único.

- **Melhoria Proposta**
  > Aplicar a tactic **Idempotent Replay** de forma explícita: desenhar (não necessariamente
  > implementar aqui) um middleware/`asyncHandler` reutilizável que aceite `Idempotency-Key`,
  > persista `(key, resultado)` por uma janela curta, e devolva o resultado gravado em reenvio —
  > documentado como o padrão a seguir no primeiro `/feature-new` de Permutas/SISPAG que executar
  > uma escrita financeira sem chave natural.

- **Resultado Esperado**
  > Padrão de idempotência documentado (ex.: ADR ou nota em `CLAUDE.md`/`ontology/`) antes do
  > primeiro endpoint de execução financeira ser modelado. Métrica: 0/5 endpoints hoje com
  > `Idempotency-Key` → padrão definido e citável por `/feature-new` futuro.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Padrão de `Idempotency-Key` documentado: ausente → presente
  - Endpoints financeiros futuros (Permutas/SISPAG write-path) que o citam desde a primeira
    interview: 0 → 100% (medido nos próximos ciclos)
- **Risco de não fazer**: quando a execução de permuta/remessa SISPAG (sem chave natural
  conveniente) chegar sem esse padrão definido, um double-click ou retry de proxy vira execução
  dupla de um write financeiro — exatamente o cenário P0 que esta QA existe para prevenir.
- **Dependências**: nenhuma agora; idealmente resolvido antes do `/feature-new` que modelar
  execução de permuta ou remessa SISPAG.

### [fault-tolerance-3] Encurtar a janela de sessão de usuário desativado nas rotas administrativas

- **Problema**
  > Um usuário desativado (via as novas guardas R11) mantém o JWT válido por até 12h — o middleware
  > (`http/auth.ts`) verifica só assinatura/expiração, nunca `ativo` no banco. Lacuna pré-existente,
  > já documentada na própria ADR-0051 como candidata ao passo 2 do plano de auth.

- **Melhoria Proposta**
  > Como mitigação tática ANTES do passo 2 completo (permissões por request): adicionar uma
  > checagem leve de `ativo`, cacheada com TTL curto (ex.: 60s), nas rotas `requireRole('admin')` —
  > sem pagar o custo de uma query por request em toda rota autenticada. O passo 2 do ADR-0051
  > continua sendo a solução definitiva.

- **Resultado Esperado**
  > Janela de exposição pós-desativação nas rotas administrativas: até 12h → ≤60s, sem esperar o
  > SSO completo (passo 3).

- **Tactic alvo**: Rollback / Recovery (revogação de credencial)
- **Severidade**: P3
- **Esforço estimado**: M (2-5d) — escopo restrito às rotas admin; XL se generalizado (equivale ao
  passo 2 do ADR-0051)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Janela de exposição pós-desativação (rotas admin): 12h → ≤60s
- **Risco de não fazer**: baixo e conscientemente aceito até o passo 2 do ADR-0051; sobe se a
  rotatividade de equipe ou o número de admins crescer antes desse passo ser entregue.
- **Dependências**: passo 2 do ADR-0051 (permissões lidas do banco por requisição) é a solução
  definitiva; este card é mitigação tática isolada.

## 6. Notas do agente

- Escopo: `git diff origin/main...HEAD`, `--quick`; nenhum comando rodou contra banco/ambiente real.
  Itens do roteiro sobre SQS/DLQ/EventBridge/reconciliação com Conexos foram marcados N/A com
  justificativa — este delta não tem fila nem chamada a sistema externo (`_shared-metrics.md`
  confirma). `PostgreeDatabaseClient.ts` (transação, retry, timeouts) não está no diff — tratado como
  infraestrutura pré-existente corretamente reutilizada por `deactivateGuarded`.
- F-fault-tolerance-3 é PRÉ-EXISTENTE (confirmado via `git show origin/main:...AuthService.ts`) e
  **não promovido a P0/P1** por instrução do escopo; citado porque o próprio delta amplia o peso
  operacional sobre a ação de desativação sem fechar essa janela, e porque a ADR-0051 já a nomeia
  como dívida consciente (heurística de "forward-recovery documentado, não omisso" satisfeita).
- Cross-QA: F-fault-tolerance-1 (trilha de auditoria) se cruza diretamente com Security
  (auditabilidade — "quem fez o quê e quando" é tipicamente cobrado nessa QA também; não duplicar
  card, citar este finding). F-fault-tolerance-2 (Idempotency-Key) se cruza com Availability e
  Performance (mesmo padrão de retry/timeout de rede) — `qa-performance.md` já registra a ausência de
  timeout em `fetch` do frontend (`F-performance-2`, mesmo `lib/http.ts` fora do diff) como achado
  correlato, não duplicado aqui. F-fault-tolerance-2 também é insumo direto para o `TaskScoper` do
  próximo `/feature-new` de Permutas/SISPAG write-path (ver card fault-tolerance-2).
