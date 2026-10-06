---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-06-1506-sispag-lotes-vencimento-mover
agent: qa-deployability
generated_at: 2026-10-06T15:30:00-03:00
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev Kavex | Merge do delta (cf48c3a, d98316d) em main | Backend Render + frontend Vercel (deploys independentes) | Produção, SISPAG com lotes RASCUNHO/FINALIZADO em uso | Deploy sem migration; FE e BE tolerantes a skew; rollback = redeploy do commit anterior | 0 passos manuais; rollback sem reversão de dados; janela de skew FE/BE sem erro 5xx |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations no delta | 0 | 0 para rollback trivial | ✅ | `git diff --stat 1e68bd7..HEAD` |
| Passos automatizados no CI (audit, typecheck, lint, test+coverage, build, SQL PG17, tag release) | 7 | ≥5 | ✅ | `.github/workflows/ci.yml` |
| Contrato HTTP alterado | 1 campo opcional aditivo (`mover?`) e 1 campo de resposta (`loteComprometido`) | aditivo | ✅ | `routes/sispag.ts`, `lib/sispag.ts` |
| Env vars / secrets novos | 0 | 0 | ✅ | diff |
| Feature flag para o novo comportamento (agrupamento por vencimento) | ausente | presente em mudança de regra financeira | ⚠️ | `FormacaoLotesService.ts` |
| Rollout canário / blue-green | ⚠️ **Não medível localmente**: Render/Vercel, sem infra/Terraform. Recomendação: n/a para tenant único | n/a | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Render/Vercel substituem a instância inteira; sem canário (tenant único) | ⚠️ parcial | CLAUDE.md |
| Rollback | Redeploy do commit anterior; sem migration, logo sem reversão de dado. Lotes já reformados por vencimento permanecem | ✅ presente | diff sem migrations |
| Script Deployment Commands | CI + deploy hook + `bump-version` (lockstep FE/BE) | ✅ presente | `ci.yml` |
| Logical Grouping | Mudança aditiva e de comportamento no mesmo deploy FE+BE | ⚠️ parcial | F-deployability-1 |
| Physical Grouping | N/A: processo único no Render, sem Lambdas/Terraform | N/A | CLAUDE.md |
| Package Dependencies | Sem dependência nova; `npm ci` com lockfile | ✅ presente | diff |
| Surge Protection | N/A: sem rollout gradual de instâncias | N/A | - |
| Idempotent deploys | Sem migration; `BootMigrator` não tem o que aplicar | ✅ presente | diff |
| Drift detection / Reproducible builds | N/A para Terraform; build via `npm ci` + CI | ✅ presente | `ci.yml` |
| Deployment observability | Tag release idempotente; log do mover não verificado neste escopo | ⚠️ parcial | `ci.yml` |

## 4. Findings

### F-deployability-1: Skew FE/BE no `mover` degrada silenciosamente

- **Severidade**: P2
- **Tactic violada**: Logical Grouping
- **Localização**: `src/backend/routes/sispag.ts:154-158`, `src/frontend/lib/sispag.ts`
- **Evidência (objetiva)**:
  ```
  mover: z.boolean().optional()   // zod object não-strict
  ```
  FE novo + BE antigo: o `mover` é descartado pelo zod, e a UI recebe 409 (rascunho em outro lote) sem entender o motivo. BE novo + FE antigo: seguro, porque o campo é aditivo.
- **Impacto técnico**: janela de minutos (Vercel x Render) com o mover falhando por 409.
- **Impacto de negócio**: o analista vê um erro confuso numa operação financeira; sem perda de dado.
- **Métrica de baseline**: 1 janela de skew por deploy; 0 incidentes de dado.

### F-deployability-2: Agrupamento por vencimento muda regra sem flag

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts (dark launch)
- **Localização**: `src/backend/domain/service/sispag/FormacaoLotesService.ts`
- **Evidência (objetiva)**: o diff troca o agrupamento de filial para filial x vencimento, sem flag; rollback só por redeploy.
- **Impacto técnico**: o próximo ciclo da formação automática produz lotes de composição diferente dos RASCUNHO existentes.
- **Impacto de negócio**: o analista pode ver o rearranjo de lotes sem aviso; sem risco de remessa, porque FINALIZADO e REMESSA_GERADA ficam bloqueados.
- **Métrica de baseline**: 0 flags para 1 mudança de regra.

## 5. Cards Kanban

### [deployability-1] Documentar a ordem de deploy BE antes de FE para o `mover`

- **Problema**
  > FE novo contra BE antigo faz o `mover` falhar com 409 (F-deployability-1).
- **Melhoria Proposta**
  > Registrar no `DEPLOY.md` e no CHANGELOG a ordem BE antes de FE. Opcionalmente, o BE responde 400 em chave desconhecida só nesse endpoint. Tactic: Logical Grouping.
- **Resultado Esperado**
  > Janela de skew sem erro visível (1 janela com 409 → 0).
- **Tactic alvo**: Logical Grouping
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Erros 409 por skew por deploy: 1 janela → 0
- **Risco de não fazer**: suporte recorrente a cada deploy que mude o contrato.
- **Dependências**: nenhuma

### [deployability-2] Nota de release sobre o rearranjo dos lotes RASCUNHO

- **Problema**
  > A regra de formação mudou sem flag; os lotes automáticos existentes serão reformados por vencimento (F-deployability-2).
- **Melhoria Proposta**
  > Avisar o analista no CHANGELOG. Para as próximas mudanças de regra financeira, considerar uma flag em `EnvironmentProvider` para dark launch. Tactic: Scale Rollouts.
- **Resultado Esperado**
  > Mudança comunicada; rollback por flag, sem redeploy.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Flags para mudanças de regra: 0 → 1 por mudança
- **Risco de não fazer**: surpresa operacional, com rollback só por redeploy.
- **Dependências**: nenhuma

## 6. Notas do agente

- O escopo foi só o delta; não há infra/Terraform, então as métricas de Terraform são N/A.
- Não verifiquei a idempotência da reformação em execuções repetidas do cron; vale um olhar do qa-fault-tolerance e do qa-testability.
- Cross-QA: F-deployability-2 se liga a Modifiability (regra de agrupamento hard-coded).
