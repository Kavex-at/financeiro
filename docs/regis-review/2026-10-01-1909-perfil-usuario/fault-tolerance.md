---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-fault-tolerance
generated_at: 2026-10-01T19:30:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/perfil` | Uma das leituras (`/me`, `/me/atividade`, `/me/historico`) ou `/me/permissoes` falha (5xx/timeout) | `routes/me.ts`, `PerfilService`, seções `app/perfil/*` | Produção Render, Postgres Supabase, sem ERP no caminho | Falha isolada por seção, com "tentar de novo"; permissão não verificada vira "não foi possível verificar", nunca "sem acesso"; nenhuma escrita, logo nenhum estado parcial | 0 escritas no delta; 4 de 4 seções de dados com erro isolado; 0 logouts por 5xx |

Escopo: o delta é 100% leitura (3 GETs + migration só de índices + job validador). Não há escrita financeira, SQS nem chamada externa. Idempotência, outbox, DLQ e reconciliação contra o ERP são N/A.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas de estado/financeiras no delta | 0 (3 GETs; migration só `CREATE INDEX`) | 0 não protegidas | ✅ | `routes/me.ts:81-178`, `0072_*.sql` |
| Seções do `/perfil` com falha isolada | 4 de 4 com `ErroSecao`/`VerificacaoIndisponivel` + retry; Segurança sem rede | 100% | ✅ | `page.tsx:38-56`, `AtividadeSection.tsx:139-145,240`, `HistoricoSection.tsx:153-158,275`, `SecaoPerfil.tsx:44-80` |
| Falha de permissão distinta de "sem acesso" | `falhou` tratado em 2 seções (Permissões, Atividade) | 100% das seções que dependem de permissão | ✅ | `PermissoesSection.tsx:41,54`, `AtividadeSection.tsx:98,129,198` |
| Migration 0072 idempotente | 11 de 11 `CREATE INDEX IF NOT EXISTS` | 100% | ✅ | `0072_idx_atividade_usuario.sql:26-58` |
| Rollback 0072 idempotente e fora do runner | 11 de 11 `DROP INDEX IF EXISTS`, só índices | 100% | ✅ | `rollbacks/0072_idx_atividade_usuario.rollback.sql:7-17` |
| Job validador sem efeito colateral | `BEGIN TRANSACTION READ ONLY` + `ROLLBACK` em `finally`, com `release`/`pool.end` | read-only imposto pelo banco | ✅ | `validate-perfil-usuario-v1.ts:287,436-440` |
| 5xx na troca de senha tratado como logout | 0 (5xx/exceção → `indisponivel`; 401 evitado via 422); flag `SENHA_PROPRIA_HABILITADA=false`, 0 chamadas de rede | 0 | ✅ | `lib/perfil/senha.ts:11,50-63,66-80`, `SegurancaSection.tsx:30-33` |
| Erro de cliente (400) não vira 500 | 3 rotas com Zod `.strict()` + `respondHandlerError` | 100% | ✅ | `me.ts:78-81,101-109,119-125` |
| Falha parcial entre queries do mesmo endpoint | `Promise.all` em 2 pontos: all-or-nothing, sem dado parcial enganoso | explícito | ⚠️ | `PerfilService.ts:92,124` |
| Timeout por query/statement | Não encontrado no delta (o job usa `new Pool` sem `statement_timeout`) | definido | ⚠️ | `validate-perfil-usuario-v1.ts:283` |
| Idempotência SQS, DLQ, stuck-state, reconciliação ERP | N/A (sem escrita/fila no delta) | N/A | N/A | — |

> ⚠️ **Não medível localmente**: infra (Terraform, DLQ, alarmes) — `infra/` não existe. Latência/timeout reais em produção exigem logs do Render.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution / Replacement | N/A — sem componente redundante necessário em leitura | N/A | — |
| Predictive Model | N/A — sem previsão de falha no escopo | N/A | — |
| Increase Competence Set | Falha de verificação tratada como estado próprio (`falhou`) em vez de "sem acesso" | ✅ presente | `SecaoPerfil.tsx:62-80` |
| Sanity Checking | Zod `.strict()` nas queries; cursor adulterado → `PerfilQueryInvalidError` 400 | ✅ presente | `me.ts:78-125`, `HistoricoCursor.ts` |
| Comparison | Job compara read model × SQL independente (350 comparações, 0 divergências) | ✅ presente | `validate-perfil-usuario-v1.ts`, `_shared-metrics.md` |
| Timestamp | Carimbos dos ledgers usados como datação (ADR-0052/0058) | ✅ presente | `0072_idx_atividade_usuario.sql:9-12` |
| Timeout | Sem timeout de statement nas leituras do delta | ⚠️ parcial | `PerfilService.ts:92,124` |
| Condition Monitoring | 5xx caem no `errorMiddleware` central (log); `/me/conexos-status` indica falha de vínculo | ✅ presente | `me.ts:34-45,86-92` |
| Self-Test | Job validador de equivalência; testes de rollback/migration | ✅ presente | `rollbacks.test.ts`, `0072_idx_atividade_usuario.test.ts` |
| Voting | N/A — sem redundância de cálculo | N/A | — |
| Redundancy | N/A — leitura simples, sem requisito de HA no delta | N/A | — |
| Recovery (forward/backward) | Retry por seção (forward); sem estado a reverter | ✅ presente | `SecaoPerfil.tsx:44-60` |
| Reintroduction (Shadow, State Resync, Escalating Restart) | `Cache-Control: no-store` e refetch por tentativa evitam estado velho | ✅ presente | `me.ts:92,105`, `page.tsx:20-46` |
| Rollback | Script de reverse dos 11 índices, manual e fora do runner | ✅ presente | `rollbacks/0072_idx_atividade_usuario.rollback.sql` |
| Repair State | N/A — sem estado mutável | N/A | — |
| Idempotent Replay | GETs naturalmente idempotentes; migration `IF NOT EXISTS` | ✅ presente | `0072_idx_atividade_usuario.sql` |
| Compensating Transaction | N/A — sem escrita externa | N/A | — |
| Reconcile | Validador contra produção (read-only) | ✅ presente | `validate-perfil-usuario-v1.ts:287` |
| Quarantine | N/A — sem item em fluxo | N/A | — |

## 4. Findings

### F-fault-tolerance-1: Leituras do perfil sem timeout de statement explícito

- **Severidade**: P2
- **Tactic violada**: Timeout
- **Localização**: `src/backend/domain/service/perfil/PerfilService.ts:92,124`; `src/backend/jobs/validate-perfil-usuario-v1.ts:283`
- **Evidência (objetiva)**:
  ```
  PerfilService.ts:92   const [identidade, fontes] = await Promise.all([
  PerfilService.ts:124  const [agAtual, agAnterior] = await Promise.all([
  validate-perfil-usuario-v1.ts:283  const pool = new Pool({ connectionString: lerConexao(), max: 1 });
  ```
  Nenhum `statement_timeout` no delta. O histórico faz `UNION ALL` de 11 fontes; hoje o volume é de centenas de linhas (a 0072 admite Seq Scan).
- **Impacto técnico**: com o crescimento das tabelas, uma query lenta segura conexão do pool compartilhado com o resto do app. O isolamento por seção no front não protege o pool.
- **Impacto de negócio**: a página de perfil (não crítica) pode degradar operações financeiras que usam o mesmo pool.
- **Métrica de baseline**: 0 timeouts de statement em 2 `Promise.all` e 1 pool de job; 11 ramos no UNION. Sem medição de latência, logo P2 e não P1.

### F-fault-tolerance-2: `Promise.all` em `perfil()` e `atividade()` é tudo-ou-nada

- **Severidade**: P3
- **Tactic violada**: Increase Competence Set
- **Localização**: `src/backend/domain/service/perfil/PerfilService.ts:92-130`
- **Evidência (objetiva)**: `await Promise.all([...])` em `:92` e `:124`; falha do período anterior derruba também os KPIs atuais.
- **Impacto técnico**: o comparativo (secundário) falhando esconde o KPI principal; o retry da seção cobre.
- **Impacto de negócio**: incômodo de UX, sem risco de dado errado.
- **Métrica de baseline**: 2 de 2 agregações em `Promise.all` sem degradação parcial (escolha defensável: nunca mostra dado parcial enganoso).

### F-fault-tolerance-3: Reverse da 0072 é manual e fora do runner, sem runbook

- **Severidade**: P3
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql:4-6`
- **Evidência (objetiva)**: "NUNCA aplicado pelo runner... Rodar à mão". O build sem CONCURRENTLY toma lock de escrita, desprezível hoje e documentado em `0072_idx_atividade_usuario.sql:17-18`.
- **Impacto técnico**: o rollback depende de operador com acesso ao banco; risco baixo por serem só índices (sem perda de dado).
- **Impacto de negócio**: mínimo; só lentidão de leitura se os índices forem dropados.
- **Métrica de baseline**: 11 índices; 0 passos de runbook além do comentário no arquivo.

## 5. Cards Kanban

### [fault-tolerance-1] Definir statement_timeout nas leituras de /me/*

- **Problema**
  > As leituras de `/me/atividade` e `/me/historico` (UNION de 11 fontes) não têm timeout de statement. Hoje o volume é pequeno, mas ao crescer uma query lenta ocupa o pool compartilhado com os fluxos financeiros.
- **Melhoria Proposta**
  > Tactic Timeout: aplicar `SET LOCAL statement_timeout` (ex.: 5s) nas consultas de `AtividadeUsuarioRepository`/`PerfilRepository`, mapeando o estouro para 503 amigável (o front já isola por seção). No job validador, `statement_timeout` na conexão.
- **Resultado Esperado**
  > Leituras do perfil limitadas a um teto: 0 timeouts definidos → 3 pontos com teto (2 repositórios + job).
- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Queries de perfil com timeout: 0 → 100%
  - Teste que simula estouro e verifica seção com erro/503: 0 → 1
- **Risco de não fazer**: em 6 meses, com tabelas maiores, o perfil pode segurar conexões e degradar operações.
- **Dependências**: nenhuma

### [fault-tolerance-2] Degradar o comparativo sem derrubar o KPI atual

- **Problema**
  > `atividade()` usa `Promise.all` para período atual e anterior; a falha do anterior esconde o atual.
- **Melhoria Proposta**
  > Tactic Increase Competence Set: `Promise.allSettled` no período anterior, devolvendo `anterior: null` com indicação. Avaliar o custo de contrato no frontend.
- **Resultado Esperado**
  > Falha parcial: derruba 100% da seção → mostra o KPI atual sem comparação.
- **Tactic alvo**: Increase Competence Set
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Cenários de falha parcial com resposta degradada testados: 0 → 1
- **Risco de não fazer**: baixo; o retry cobre.
- **Dependências**: contrato de `/me/atividade`

### [fault-tolerance-3] Registrar runbook de reverse da migration 0072

- **Problema**
  > O rollback da 0072 existe, mas é manual e só documentado no cabeçalho do arquivo.
- **Melhoria Proposta**
  > Tactic Rollback: adicionar passo ao `DEPLOY.md` (quando dropar, comando psql, confirmação de que só há perda de desempenho).
- **Resultado Esperado**
  > Rollback executável por qualquer operador: 0 → 1 seção de runbook.
- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Runbook de reverse da 0072: 0 → 1
- **Risco de não fazer**: baixo; tempo extra em incidente.
- **Dependências**: nenhuma

## 6. Notas do agente

- O delta é read-only: sem escrita financeira, SQS ou ERP. Os critérios P0 (dual-write, idempotência SQS, DLQ) não se aplicam, então não há P0 nem P1.
- Pontos pedidos verificados e OK: falha por seção independente, `falhou` ≠ "sem acesso", 5xx da senha nunca desloga (e a flag desliga o form), 0072 idempotente com rollback, validador em transação READ ONLY com ROLLBACK em `finally`.
- Cross-QA: timeout (Performance/Availability), rollback/migration (Deployability), reprocess N/A (Testability).
