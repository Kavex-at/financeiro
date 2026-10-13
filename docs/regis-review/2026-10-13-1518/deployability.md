---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-13-1518
agent: qa-deployability
generated_at: 2026-10-13T15:40:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

Escopo: apenas o delta de `fix/sispag-sync-ao-abrir` vs `origin/main` (modo `--quick`; sem build de bundle).

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Merge do PR que troca o endpoint por lote (`/lotes/:id/sincronizar`) por dois endpoints de passada completa e move o corpo do job para `SincronizacaoPassadaService` | Backend Express (Render), frontend Next.js (Vercel) e workflow `sincronizar-lotes-sispag.yml` | Produção, com FE e BE publicados em momentos distintos e analista com a tela aberta | Deploy sem quebrar a tela em cache, o cron segue válido, e dá para desligar o comportamento novo sem redeploy | 0 erros 5xx por skew FE/BE; desligar a sincronização ao abrir em ≤ 5 min via env; rollback = revert do commit |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates antes do deploy (typecheck, lint, test, build) | 4 gates verdes; backend 4058/4058, frontend 893/893 | ≥ 4 | ✅ | `_shared-metrics.md` |
| Skew FE/BE tratado | Rota antiga devolve 410 com `code` estável (`LOTE_SINCRONIZACAO_POR_LOTE_APOSENTADA`) | resposta explícita | ✅ | `src/backend/routes/sispag.ts` (diff) |
| Variáveis novas documentadas | 2 vars em `DEPLOY.md`, com default, marcadas opcionais | 100% | ✅ | `DEPLOY.md` linha adicionada |
| Variáveis novas em `render.yaml` | 0 de 2 (dependem do default) | opcional | ⚠️ | `grep SISPAG_LOTES_SYNC render.yaml` vazio |
| Kill switch operacional da sincronização ao abrir | Não há flag `enabled`; valor ≤ 0 volta ao default de 30 min (não dá para desligar) | existir | ⚠️ | `DEPLOY.md` ("Valor inválido ou ≤ 0 volta ao default") |
| Conexões do pool presas por passada | 1 de 5 durante ~25 s, mais as consultas da própria passada | ≤ 1 de 5 | ⚠️ | `PostgreeDatabaseClient.ts:210-231` e `:37` |
| Rollback | `git revert` simples: sem migration nova, sem mudança de schema | 1 comando | ✅ | `git diff --stat` (nenhum arquivo em `migrations/`) |
| Infra / bundle Lambda / drift | ⚠️ **Não medível localmente**: não existe `infra/` nem Terraform; deploy é Render/Vercel. Requer o alvo Lambda. | n/a | n/a | `CLAUDE.md` §Estado Atual |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary. O TTL de 30 min limita a carga: no máximo uma passada a cada 30 min, por qualquer gatilho | ⚠️ parcial | `SincronizacaoPassadaService.ts` `sincronizarSeDefasada` |
| Rollback | Revert de código basta; a passada é read-only no ERP e só grava no nosso Postgres | ✅ presente | I11a no cabeçalho do serviço |
| Script Deployment Commands | Workflow versionado: `npm ci`, `migrate` idempotente, job, passo de alerta ADR-0042 | ✅ presente | `.github/workflows/sincronizar-lotes-sispag.yml` |
| Logical Grouping | Os 3 gatilhos (abertura, botão, cron) passam por um único serviço e uma única chave de lock | ✅ presente | `SISPAG_SINCRONIZACAO_LOCK_KEY` |
| Physical Grouping | N/A: processo Express único mais runner do GitHub, sem Lambdas por função | N/A | `CLAUDE.md` |
| Package Dependencies | Sem dependência nova; `package.json` intocado | ✅ presente | `git diff --stat` |
| Surge Protection | TTL de 30 min, cooldown de 5 min após falha, lock com `em_andamento`, `heavyRouteLimiter` nas duas rotas | ✅ presente | `routes/sispag.ts`, serviço |
| Idempotent deploys | `migrate` idempotente; estado do TTL vive em `job_execucao`, então reinício do servidor não zera o relógio | ✅ presente | workflow e serviço |
| Drift detection / per-tenant blast radius | N/A: não há Terraform nem tenants provisionados | N/A | `CLAUDE.md` §Tenants |
| Deployment observability | Run em `job_execucao` por passada (`triggeredBy` = `abertura:`, `manual:` ou cron) e logs de início/fim | ✅ presente | `rodar()` e `fechar()` |

## 4. Findings

### F-deployability-1: Sem kill switch para a sincronização ao abrir a tela

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts (Bass: ativar e desativar por flag)
- **Localização**: `DEPLOY.md` (linha de `SISPAG_LOTES_SYNC_TTL_MIN`); `SincronizacaoPassadaService.ts` `sincronizarSeDefasada`
- **Evidência (objetiva)**:
  ```
  "Valor inválido ou ≤ 0 volta ao default."  → TTL=0 não desliga, volta a 30 min
  ```
  A única forma de neutralizar o gatilho de abertura é um TTL enorme (ex.: 99999), o que é um truque e não está documentado.
- **Impacto técnico**: se a passada sob carga real se mostrar problemática (sessões Conexos, pool), o recurso só sai com revert e redeploy.
- **Impacto de negócio**: o Conexos limita sessões por usuário e todos os crons usam o mesmo usuário (`LOGIN_ERROR_MAX_SESSIONS`); uma tela que dispara L11 pode derrubar ingestões. A mitigação é um redeploy, não uma troca de env.
- **Métrica de baseline**: 0 flags de desligamento; tempo de mitigação = ciclo de deploy (> 5 min) contra o alvo de ≤ 5 min por env.

### F-deployability-2: Passada longa segura 1 de 5 conexões do pool durante todo o L11

- **Severidade**: P2
- **Tactic violada**: Surge Protection
- **Localização**: `PostgreeDatabaseClient.ts:210-231` (`withAdvisoryLock`), usado em `SincronizacaoPassadaService.executarPassada`
- **Evidência (objetiva)**:
  ```
  const client = await this.connectionPool.connect();   // preso até o fim de onAcquired()
  pool = 5 por processo; passada ~25 s (log do run 37860107255)
  ```
- **Impacto técnico**: durante a passada, o servidor Render fica com 4 conexões para as demais requisições. Várias requisições `em_andamento` não seguram conexão, mas a que ganhou o lock segura. O limite de 10 min (`RUN_PRESA_MS`) cobre run morta, não a conexão presa.
- **Impacto de negócio**: pior caso, as outras telas do SISPAG ficam lentas por cerca de 25 s a cada 30 min, no horário em que a analista está logada.
- **Métrica de baseline**: 1/5 conexões (20%) por ~25 s por passada; no máximo 2 passadas por hora por TTL.

### F-deployability-3: Variáveis novas fora do `render.yaml`

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands
- **Localização**: `render.yaml`; `DEPLOY.md`
- **Evidência (objetiva)**:
  ```
  grep -n "SISPAG_LOTES_SYNC" render.yaml  → 0 resultados
  ```
- **Impacto técnico**: a configuração só existe como texto em `DEPLOY.md`, e o default fica no código. Uma conferência de configuração não vê a variável.
- **Impacto de negócio**: baixo; as vars são opcionais, com default seguro.
- **Métrica de baseline**: 0 de 2 variáveis declaradas em `render.yaml`.

## 5. Cards Kanban

### [deployability-1] Adicionar flag de desligamento da sincronização ao abrir a tela

- **Problema**
  > A sincronização de lotes ao abrir a tela (ADR-0066) só pode ser neutralizada por revert, porque TTL ≤ 0 volta ao default de 30 min. Se a passada atrapalhar as sessões do Conexos, a mitigação demora um deploy.

- **Melhoria Proposta**
  > Adicionar `SISPAG_LOTES_SYNC_ON_OPEN_ENABLED` (default `true`) em `EnvironmentVars`/`EnvironmentProvider`. Com `false`, `sincronizarSeDefasada` devolve `fresca` ou um novo estado `desativada`, sem tocar o Conexos. O botão forçado e o cron continuam. Documentar em `DEPLOY.md`. Tactic: Scale Rollouts.

- **Resultado Esperado**
  > Desligar o gatilho de abertura por env var em ≤ 5 min, sem redeploy de código.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Tempo para desligar o gatilho: ciclo de deploy → ≤ 5 min
  - Flags de desligamento: 0 → 1
- **Risco de não fazer**: um incidente de sessão Conexos causado pela tela só se contém com revert e redeploy em horário comercial.
- **Dependências**: nenhuma

### [deployability-2] Reduzir o tempo de conexão presa durante a passada de L11

- **Problema**
  > `withAdvisoryLock` segura uma conexão do pool de 5 durante toda a passada (~25 s) só para manter o lock. As demais rotas disputam as 4 restantes.

- **Melhoria Proposta**
  > Opção 1: medir o p95 de espera por conexão durante a passada e, se relevante, usar um pool pequeno dedicado ao lock. Opção 2: subir o `max` do pool para 8 apenas no servidor. Tactic: Surge Protection.

- **Resultado Esperado**
  > Rotas do SISPAG sem degradação perceptível durante a passada: p95 de espera por conexão < 100 ms.

- **Tactic alvo**: Surge Protection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Conexões livres durante a passada: 4 de 5 → ≥ 4 de 5 sem disputa medida (ou 7 de 8)
- **Risco de não fazer**: lentidão pontual nas telas quando cron, botão e abertura se encontram.
- **Dependências**: nenhuma. Cruza com o QA de Performance.

### [deployability-3] Declarar as variáveis de sync no render.yaml

- **Problema**
  > `SISPAG_LOTES_SYNC_TTL_MIN` e `SISPAG_LOTES_SYNC_COOLDOWN_MIN` (e as da carteira) existem só em `DEPLOY.md`.

- **Melhoria Proposta**
  > Declarar as quatro em `render.yaml` com `sync: false` e os defaults documentados em comentário.

- **Resultado Esperado**
  > Configuração visível no blueprint: 0 de 4 → 4 de 4.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Variáveis declaradas no blueprint: 0/4 → 4/4
- **Risco de não fazer**: baixo; confusão sobre qual valor está ativo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta; modo `--quick`, sem build de bundle nem Terraform (inexistente neste repo).
- Pontos positivos: 410 com código estável para tela em cache, sem migration (rollback por revert) e estado do TTL persistido em `job_execucao`.
- Cross-QA: F-deployability-2 vai para Performance/Availability. As rotas novas passaram de `sispag:executar` para `sispag:ver` e disparam leitura no ERP; vale o consolidator confirmar com Security.
