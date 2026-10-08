---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-08-1958
agent: qa-deployability
generated_at: 2026-10-08T20:00:00Z
scope: all
score: 8
findings_count: 1
cards_count: 1
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor | Merge do commit e832057 (rota nova + UI) | Pipeline CI + deploy Render/Vercel | Operação normal, sem Terraform | Gates verdes antes do merge; rota nova entra sem migration, sem env nova, sem dependência nova | 0 migrations, 0 env vars, 0 deps novas; rollback = redeploy do commit anterior |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Etapas automáticas no CI (backend) | 6 (audit, typecheck, lint, test+coverage, build, SQL tests) | ≥5 | ✅ | `.github/workflows/ci.yml:26-30,62` |
| Etapas automáticas no CI (frontend) | 4 (typecheck, lint, test, build) | ≥4 | ✅ | `ci.yml:80-85` |
| Migrations no delta | 0 | 0 (deploy sem ordem) | ✅ | `git show --stat e832057` |
| Env vars/secrets novos | 0 | 0 | ✅ | `git show --stat e832057` |
| Dependências novas (package.json) | 0 | 0 | ✅ | diff sem package*.json |
| Acoplamento FE/BE de deploy | Frontend chama rota nova; deploys independentes (Vercel vs Render) | Ordem BE→FE | ⚠️ | `routes/sispag.ts`, `ExportarTitulosAPagarBotao.tsx` |
| Gates locais | typecheck/lint/testes verdes (225 + 90 suites) | verde | ✅ | `_shared-metrics.md` |
| Terraform / tenants / bundles Lambda | — | — | ⚠️ **Não medível localmente**: `infra/` não existe (CLAUDE.md). |
| Drift detection / build duration | — | — | ⚠️ **Não medível localmente** (`--quick`, sem Terraform). |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green; Render/Vercel substituem tudo de uma vez. Mitigação: a rota é aditiva e read-only | ⚠️ parcial | `DEPLOY.md` |
| Rollback | Redeploy do commit/tag anterior (Render/Vercel); delta não altera schema, então rollback é seguro | ✅ presente | Delta sem migration |
| Script Deployment Commands | CI + deploy hook GitHub Actions + tag release idempotente | ✅ presente | `ci.yml:88-101` |
| Logical Grouping | Serviço novo isolado (`TitulosAPagarExportService`), helper extraído (`PlanilhaXlsxWriter`) | ✅ presente | Delta |
| Physical Grouping | N/A: não há Lambda/tenants hoje; Render único | N/A | CLAUDE.md |
| Package Dependencies | Lockfile + `npm ci`; delta sem dep nova | ✅ presente | `ci.yml:23` |
| Surge Protection | `heavyRouteLimiter` na rota nova; teto 5000 chaves | ✅ presente | `_shared-metrics.md` |
| Idempotent deploys | Rota read-only, sem efeito colateral de boot | ✅ presente | Delta |
| Drift detection | N/A: sem IaC | N/A | — |
| Per-tenant blast radius | N/A: sem tenants provisionados | N/A | CLAUDE.md |
| Deployment observability | Sem métrica/log específico da rota de export além do log padrão | ⚠️ parcial | `routes/sispag.ts` |

## 4. Findings

### F-deployability-1: Frontend pode ir ao ar antes do backend e chamar rota inexistente

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `src/frontend/app/sispag/components/ExportarTitulosAPagarBotao.tsx`, `src/backend/routes/sispag.ts` (`POST /sispag/titulos/exportar`)
- **Evidência (objetiva)**:
  ```
  Frontend (Vercel) e backend (Render) fazem deploy independentes; o botão chama a rota nova.
  ```
- **Impacto técnico**: Se o Vercel publicar antes do Render, o botão devolve 404 por alguns minutos.
- **Impacto de negócio**: Analista vê erro no export durante a janela de deploy. Funcionalidade auxiliar, sem perda de dados.
- **Métrica de baseline**: janela estimada de minutos; 1 rota afetada; 0 fluxos críticos.

## 5. Cards Kanban

### [deployability-1] Documentar ordem de deploy backend antes do frontend para rotas novas

- **Problema**
  > O botão de export no frontend depende da rota nova no backend, e os dois deploys são independentes. Há uma janela curta com 404 se a ordem se inverter.

- **Melhoria Proposta**
  > Registrar em `DEPLOY.md` a regra "rota aditiva: backend primeiro". Opcionalmente, o botão trata 404 com mensagem clara ("atualize a página"). Tactic: Scale Rollouts.

- **Resultado Esperado**
  > Janela de inconsistência conhecida e tratada: erro genérico → mensagem orientativa; ordem documentada.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Regra de ordem de deploy documentada: não → sim
- **Risco de não fazer**: Erros transitórios e chamados pontuais a cada rota nova.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta; `--quick`, sem build nem Terraform (inexistente).
- Delta é deployável de forma segura: sem migration, env, dependência nova, e rollback trivial.
- Cross-QA: o export relê a carteira inteira e filtra em memória (Performance); `PlanilhaXlsxWriter` extraído melhora Modifiability.
