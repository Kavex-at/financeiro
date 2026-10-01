---
qa: Availability
qa_slug: availability
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-availability
generated_at: 2026-10-01T19:30:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado (UI /perfil e UserMenu) | Consulta de atividade/histórico com janela de até 366 dias enquanto o Postgres está lento ou saturado | `GET /me`, `/me/atividade`, `/me/historico` (`routes/me.ts`, `PerfilService`, `AtividadeUsuarioRepository`) | Operação normal, Express/Render, pool Postgres compartilhado com as frentes de escrita | Leitura falha de forma delimitada (erro/timeout) sem consumir o pool que serve Permutas/SISPAG | Consulta do perfil nunca retém conexão além de um teto; 0 impacto nos fluxos de escrita |

Escopo: somente o delta de `feat/perfil-usuario` (leitura apenas, sem efeito colateral em sistema externo; nenhum write em Conexos/Nexxera/GED).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas HTTP externas no delta (axios/fetch/Executor) | 0 (somente Postgres) | n/a | ✅ | grep em `routes/me.ts`, `domain/service/perfil`, `domain/repository/perfil` |
| Timeout de conexão ao pool | `connectionTimeoutMillis` configurável | explícito | ✅ | `domain/client/database/PostgreeDatabaseClient.ts:105` |
| `statement_timeout` em queries do delta | ausente (só existe em `migrations/runMigrations.ts:50`) | explícito | ⚠️ | grep `statement_timeout` em `src/backend` |
| Janela máxima da consulta | 366 dias | limitada | ✅ | `PeriodoPerfil.ts:47` (`MAXIMO_DIAS`) |
| Ocorrências de UNION no repositório de atividade | 11 | n/a | ⚠️ | `AtividadeUsuarioRepository.ts` |
| Conexões simultâneas por request de atividade | 2 (Promise.all atual vs anterior) | ≤2 | ⚠️ | `PerfilService.ts:124` |
| Índice de suporte | migration 0072 + rollback; EXPLAIN em `docs/perfil-usuario/explain.md` | presente | ✅ | `migrations/0072_idx_atividade_usuario.sql` |
| Idempotência | N/A: rotas só de leitura, `Cache-Control: no-store` | n/a | ✅ | `routes/me.ts:95-97` |
| Catch silencioso no delta | 0 (`responderLeitura` repropaga se não for erro de handler) | 0 | ✅ | `routes/me.ts:99-101` |
| Referências a shared_account_id | 0 (não há infra/ neste repo) | 0 | ✅ | CLAUDE.md, `_shared-metrics.md` |
| Alarmes/dashboards CloudWatch | ⚠️ **Não medível localmente**: não existe `infra/`. Recomendação: ao criar o Terraform, alarmar latência p95 e 5xx de `/me*`. | ≥5 | ⚠️ | n/a |
| MTTR/uptime real | ⚠️ **Não medível localmente**: requer logs/métricas de produção (Render). Recomendação: instrumentar duração das rotas /me*. | n/a | ⚠️ | n/a |
| Gates | typecheck OK; 193 suítes/3531 testes verdes; SQL integração 36/36 | verde | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Sem health check dedicado ao delta | ❌ ausente | n/a |
| Heartbeat | N/A: sem scheduler no delta; leitura sob demanda | N/A | n/a |
| Monitor | Sem métrica/alarme específico de `/me*` | ⚠️ parcial | F-availability-2 |
| Timestamp | N/A: sem fluxo distribuído a ordenar; histórico usa cursor por tempo | N/A | `HistoricoCursor.ts` |
| Sanity Checking | Zod nos query params, 400 para `PerfilQueryInvalidError`, teto de 366 dias | ✅ presente | `PerfilQuerySchemas.ts`, `PeriodoPerfil.ts:47` |
| Condition Monitoring | Sem monitoramento de pool/latência para o delta | ❌ ausente | F-availability-2 |
| Voting | N/A: sem redundância computacional | N/A | n/a |
| Exception Detection | `respondHandlerError` + repropagação | ✅ presente | `routes/me.ts:99-101` |
| Self-Test | Job `validate-perfil-usuario-v1` (350 comparações vs prod, 0 divergências) | ✅ presente | `jobs/validate-perfil-usuario-v1.ts` |
| Active Redundancy | N/A: plataforma (Render/Supabase) fora do delta | N/A | n/a |
| Passive Redundancy | N/A: plataforma fora do delta | N/A | n/a |
| Spare | N/A: plataforma fora do delta | N/A | n/a |
| Exception Handling | Erros de domínio mapeados a 400; demais ao handler global | ✅ presente | `routes/me.ts:93-102` |
| Rollback | Rollback SQL da 0072 testado | ✅ presente | `migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql`, `rollbacks.test.ts` |
| Software Upgrade | Migration aditiva (índice) | ✅ presente | `0072_idx_atividade_usuario.sql` |
| Retry | N/A: leitura idempotente, usuário reenvia; sem Executor | N/A | n/a |
| Ignore Faulty Behavior | N/A: sem entradas externas não confiáveis | N/A | n/a |
| Degradation | Promise.all é tudo-ou-nada | ⚠️ parcial | `PerfilService.ts:92,124` |
| Reconfiguration | N/A no delta | N/A | n/a |
| Shadow | N/A | N/A | n/a |
| State Resynchronization | N/A: sem estado mutável próprio | N/A | n/a |
| Escalating Restart | N/A: plataforma Render | N/A | n/a |
| Non-Stop Forwarding | N/A | N/A | n/a |
| Removal from Service | Sem feature flag/kill switch para `/me/atividade` | ❌ ausente | n/a |
| Transactions | N/A: somente leitura | N/A | n/a |
| Predictive Model | Ausente | ❌ ausente | n/a |
| Exception Prevention | Limite de janela, cursor paginado, Zod, índice 0072 | ✅ presente | `PeriodoPerfil.ts:47`, `0072` |
| Increase Competence Set | Sem `statement_timeout`; query pesada não é abortada | ⚠️ parcial | F-availability-1 |

## 4. Findings (achados)

### F-availability-1: Consulta de atividade sem statement_timeout

- **Severidade**: P2
- **Tactic violada**: Exception Prevention / Increase Competence Set
- **Localização**: `src/backend/domain/service/perfil/PeriodoPerfil.ts:47`; `src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts`; `src/backend/domain/client/database/PostgreeDatabaseClient.ts:105`
- **Evidência (objetiva)**:
  ```
  MAXIMO_DIAS = 366  | 11 ocorrências de UNION no repositório
  Promise.all com 2 chamadas agregados() => 2 conexões por request
  grep statement_timeout: só em migrations/runMigrations.ts:50
  ```
- **Impacto técnico**: sob lentidão do banco, requests de 366 dias seguram conexões do pool compartilhado sem teto.
- **Impacto de negócio**: possível degradação de Permutas/SISPAG (mesmo pool) por uma tela de leitura. Mitigado por índice 0072 e EXPLAIN registrado.
- **Métrica de baseline**: 2 conexões por request; teto de statement = nenhum. Mantido em P2 porque não há medição de tempo em produção.

### F-availability-2: Sem métrica/alarme para /me*

- **Severidade**: P2
- **Tactic violada**: Monitor / Condition Monitoring
- **Localização**: `src/backend/routes/me.ts`
- **Evidência (objetiva)**:
  ```
  Nenhuma emissão de métrica de latência/erro específica no delta; infra/ inexistente
  ```
- **Impacto técnico**: regressão de latência detectada só por reclamação.
- **Impacto de negócio**: baixo (tela de consulta), porém sem sinal precoce.
- **Métrica de baseline**: 0 alarmes para o delta.

### F-availability-3: Promise.all tudo-ou-nada

- **Severidade**: P3
- **Tactic violada**: Degradation
- **Localização**: `src/backend/domain/service/perfil/PerfilService.ts:92,124`
- **Evidência (objetiva)**:
  ```
  const [agAtual, agAnterior] = await Promise.all([...])
  ```
- **Impacto técnico**: falha no período anterior (comparativo) derruba também o atual.
- **Impacto de negócio**: marginal; o comparativo é secundário.
- **Métrica de baseline**: 1 falha parcial => 100% da resposta de atividade perdida.

Sem findings P0/P1: nenhuma escrita externa, sem cross-tenant, sem HTTP externo no delta.

## 5. Cards Kanban

### [availability-1] Impor statement_timeout nas leituras do perfil

- **Problema**
  > `/me/atividade` e `/me/historico` consultam até 366 dias (11 UNIONs, 2 conexões paralelas) sem `statement_timeout`; só o `connectionTimeoutMillis` (`PostgreeDatabaseClient.ts:105`) existe.
- **Melhoria Proposta**
  > Executar as queries do perfil com `SET LOCAL statement_timeout` (ex.: 5s) em transação curta no `AtividadeUsuarioRepository`, mapeando o cancelamento para 503 amigável.
- **Resultado Esperado**
  > Teto de retenção de conexão por request: ilimitado → ≤5s.
- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Queries do delta com timeout explícito: 0 → todas
- **Risco de não fazer**: lentidão do banco faz a tela de perfil competir com os fluxos de escrita pelo pool.
- **Dependências**: nenhuma

### [availability-2] Instrumentar latência e erros de /me*

- **Problema**
  > Nenhuma métrica/alarme cobre as três rotas novas; infra ainda não existe.
- **Melhoria Proposta**
  > Registrar duração e status por rota via LogService e, quando houver Terraform, criar alarme de p95 e 5xx.
- **Resultado Esperado**
  > Alarmes para /me*: 0 → 2 (p95, 5xx).
- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Rotas com métrica: 0/3 → 3/3
- **Risco de não fazer**: regressões de latência só surgem por reclamação de usuário.
- **Dependências**: scaffold de infra para o alarme

### [availability-3] Degradar o comparativo de atividade sem derrubar o período atual

- **Problema**
  > `Promise.all` em `PerfilService.ts:124` falha por inteiro se o período anterior falhar.
- **Melhoria Proposta**
  > Usar `Promise.allSettled` para o período anterior e devolver `anterior: null` com aviso na UI.
- **Resultado Esperado**
  > Falha parcial: resposta 100% perdida → só o comparativo ausente.
- **Tactic alvo**: Degradation
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Respostas sem dados mesmo com período atual ok: 1 → 0
- **Risco de não fazer**: marginal.
- **Dependências**: ajuste de contrato na UI

## 6. Notas do agente

- Escopo restrito ao delta (leitura apenas); modo --quick, sem rodar testes (usadas as métricas de `_shared-metrics.md`).
- Infra/CloudWatch/DLQ/SQS não medíveis: não existe `infra/` neste repo.
- Conclusões da rodada anterior reconfirmadas; caminho real do client é `domain/client/database/PostgreeDatabaseClient.ts:105` (não `:39`).
- Cross-QA: performance (11 UNIONs, 366 dias) e fault-tolerance (timeout).
