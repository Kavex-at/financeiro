---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-deployability
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor (merge em main) | Release de filtros de data/boleto nas abas SISPAG, com query params novos em `GET /sispag/boletos-dda` | Backend Express (Render) + frontend Next.js (Vercel), deployados de forma independente | Produção, sem Terraform, sem tenants | Deploy sem migration, sem env var e sem dependência nova; frontend novo funciona com backend antigo e vice-versa | Gates CI verdes, 0 passos manuais extras, rollback por redeploy do commit anterior em minutos |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Etapas automáticas de CI (backend) | 6 (audit, typecheck, lint, test+coverage, build, test:sql) | ≥5 | ✅ | `.github/workflows/ci.yml:26-62` |
| Etapas automáticas de CI (frontend) | 4 (typecheck, lint, test, build) | ≥4 | ✅ | `ci.yml:80-85` |
| Gates no commit do delta | typecheck/lint/tests verdes (BE 4010, FE 859 testes) | verde | ✅ | `_shared-metrics.md` |
| Migration / env var / dependência nova no delta | 0 / 0 / 0 | 0 | ✅ | `git show --stat 65d1fdf da095fa` |
| Compatibilidade de versão FE↔BE no deploy | FE novo + BE antigo: params `vencimentoDe/Ate` ignorados, filtro DDA não restringe; BE novo + FE antigo: sem efeito | degradação graciosa | ⚠️ | `src/frontend/lib/sispag.ts:1138`, `routes/sispag.ts` |
| Plan antes de apply / rollback Lambda / drift / feature flag | N/A | — | ⚠️ | Não existe `infra/`; Terraform não medível |
| Rollback documentado (one-command) | redeploy via Render/Vercel; sem feature flag para os filtros | presente | ⚠️ | `DEPLOY.md` (sem passo específico para o delta) |
| Bundle sizes / build duration | ⚠️ **Não medível localmente**: build não executado (escopo delta). Delta de ~+190 linhas em `tabela-filtro.tsx`, 0 dependências novas | p50 ≤5MB | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary/blue-green/rolling) | Deploy único Render/Vercel; sem canary. Risco do delta é baixo (UI + filtro in-memory) | ❌ ausente | `DEPLOY.md` |
| Rollback | Redeploy do commit anterior; delta é aditivo e reversível por `git revert` sem migration | ⚠️ parcial | `git show --stat` (sem SQL) |
| Script Deployment Commands | GitHub Actions CI + deploy hook Render; tag de release idempotente | ✅ presente | `ci.yml:88-112` |
| Logical Grouping | Opt-in `extras`/`rotuloData`/`filtroBoleto` no kit compartilhado: Permutas inalterada | ✅ presente | `tabela-filtro.tsx` |
| Physical Grouping | N/A: Lambda/Terraform ainda não existem (alvo) | N/A | CLAUDE.md §Estado Atual |
| Package Dependencies | Sem dependência nova; lockfiles + `npm ci` | ✅ presente | `ci.yml:23,61,79` |
| Surge Protection | N/A: sem rollout gradual neste stack | N/A | — |
| Idempotent deploys | Sem migration no delta; tag de release idempotente | ✅ presente | `ci.yml:106` |
| Drift detection | N/A: sem IaC | N/A | — |
| Reproducible builds | `npm ci` + Node 24 pinado no CI | ✅ presente | `ci.yml:20` |
| Per-tenant blast-radius limit | N/A: sem tenants; blast radius = 1 instância Render | N/A | CLAUDE.md §Tenants |
| Deployment observability | Sem smoke test pós-deploy dos novos params | ⚠️ parcial | — |

## 4. Findings

### F-deployability-1: Filtro DDA server-side sem contrato de compatibilidade FE/BE no deploy

- **Severidade**: P3
- **Tactic violada**: Package Dependencies (acoplamento de versão entre artefatos)
- **Localização**: `src/frontend/lib/sispag.ts:1138`, `src/backend/routes/sispag.ts`
- **Evidência (objetiva)**:
  ```
  if (filtro.vencimentoDe) qs.set('vencimentoDe', filtro.vencimentoDe)
  ```
  Backend antigo ignora o param desconhecido sem erro (Zod não estrito); FE e BE são deployados separadamente (Vercel/Render).
- **Impacto técnico**: Na janela entre os dois deploys (FE primeiro), a aba DDA mostra a lista sem filtro enquanto o usuário vê datas preenchidas.
- **Impacto de negócio**: Analista pode ler lista não filtrada como filtrada por alguns minutos; sem perda de dados (somente leitura).
- **Métrica de baseline**: janela de inconsistência de ~1 ciclo de deploy (minutos); 0 escritas afetadas.

### F-deployability-2: Sem feature flag nem smoke pós-deploy para os filtros

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts / Deployment observability
- **Localização**: `src/frontend/app/sispag/page.tsx`, `.github/workflows/ci.yml`
- **Evidência (objetiva)**: CI termina em build; nenhum passo pós-deploy chama `/sispag/boletos-dda?vencimentoDe=...`. Rollback depende de `git revert` + redeploy.
- **Impacto técnico**: Regressão do filtro só é detectada por usuário.
- **Impacto de negócio**: Baixo; feature de leitura e client-side na maior parte.
- **Métrica de baseline**: 0 smoke tests pós-deploy; 0 flags para o delta.

## 5. Cards Kanban

### [deployability-1] Documentar ordem de deploy BE→FE para mudanças com query params novos

- **Problema**
  > O filtro DDA depende de backend novo para funcionar; FE deployado antes mostra datas sem efeito (F-deployability-1).

- **Melhoria Proposta**
  > Acrescentar ao `DEPLOY.md` a regra "backend primeiro quando o FE passa a enviar params novos" (Package Dependencies). Opcional: checklist de PR.

- **Resultado Esperado**
  > Janela de inconsistência FE/BE: ~minutos → 0 para mudanças aditivas.

- **Tactic alvo**: Package Dependencies
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Regra de ordem de deploy documentada: não → sim
- **Risco de não fazer**: Confusão pontual em deploys futuros com contratos novos; baixo.
- **Dependências**: nenhuma

### [deployability-2] Adicionar smoke test pós-deploy para endpoints SISPAG de leitura

- **Problema**
  > O CI não valida o backend implantado; regressões em filtros só aparecem para o usuário (F-deployability-2).

- **Melhoria Proposta**
  > Passo pós-deploy no workflow (ou job manual) que chama `/health` e `/sispag/boletos-dda?vencimentoDe=...&vencimentoAte=...` com token de serviço e verifica 200 (Deployment observability).

- **Resultado Esperado**
  > Smoke tests pós-deploy: 0 → 1 cobrindo SISPAG; detecção de regressão antes do analista.

- **Tactic alvo**: Deployment observability
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Smoke tests pós-deploy: 0 → 1
- **Risco de não fazer**: Regressões de leitura seguem detectadas por usuário.
- **Dependências**: credencial de serviço para o smoke

## 6. Notas do agente

- Escopo: delta 65d1fdf + da095fa. Sem P0/P1: sem SQL, migration, env var, dependência ou rota nova; mudança aditiva e reversível.
- Terraform/tenants/Lambda versioning/drift: N/A, `infra/` inexistente (CLAUDE.md). Build e tamanho de bundle não executados.
- Cross-QA: Modifiability (kit de filtro compartilhado `tabela-filtro.tsx` cresceu ~190 linhas, com extras opt-in); Testability (+327 linhas de teste cobrem o delta).
