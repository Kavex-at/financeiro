---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-06-1500
agent: qa-deployability
generated_at: 2026-10-06T15:00:00-03:00
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev Kavex | Merge do delta (download de remessa + export XLSX) em main | Backend Render (hook) + frontend Vercel | Produção, sem migrations, sem nova dependência | CI valida, deploy por hook, rollback por redeploy do commit anterior | 0 passos manuais; delta reversível sem tocar dados (0 migrations) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations no delta | 0 | 0 (rollback trivial) | ✅ | `git diff --stat origin/main HEAD` |
| Novas dependências | 0 (`exceljs ^4.4.0` já no lockfile) | 0 | ✅ | `src/backend/package.json:45`, lockfile |
| Gates de CI (audit, typecheck, lint, test, build) | 5 no job backend | ≥5 | ✅ | `.github/workflows/ci.yml` |
| Env vars / secrets novos | 0 | 0 | ✅ | diff do delta |
| Rota nova atrás de feature flag | 0 (rota exposta no deploy; protegida por `SISPAG_VER` + rate limiter) | flag ou permissão | ⚠️ | `routes/sispag.ts` |
| Compatibilidade FE/BE no deploy (ordem) | FE chama rota nova; Vercel e Render deployam independentes | FE tolera BE antigo | ⚠️ | `src/frontend/lib/sispag.ts` |
| Teto de lotes por export | `MAX_LOTES_EXPORT` (zod `.max`) | definido | ✅ | `RemessaTitulosExport.ts` |
| Build/bundle Lambda, Terraform, drift | ⚠️ Não medível: não existe `infra/` | n/a | n/a | CLAUDE.md |

## 3. Tactics

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Deploy total via hook Render/Vercel; sem canary | ❌ ausente | CLAUDE.md |
| Rollback | Redeploy do commit anterior no Render/Vercel; delta sem migrations, logo reversível | ⚠️ parcial (manual) | diff sem migrations |
| Script Deployment Commands | CI + deploy hook por GitHub Actions | ✅ presente | `ci.yml` |
| Logical Grouping | Delta coeso (repo, service, route, UI) | ✅ | diff |
| Physical Grouping | N/A: Render/Vercel, sem controle de placement | N/A | - |
| Package Dependencies | Lockfile + `npm ci`; sem dependência nova | ✅ | `package-lock.json` |
| Surge Protection | `heavyRouteLimiter` + teto de ids na rota de export | ✅ | `routes/sispag.ts` |
| Idempotent deploys / Reproducible builds | `npm ci` + lockfile; sem migração | ✅ | CI |
| Drift detection / per-tenant blast radius | N/A: sem Terraform/tenants | N/A | - |
| Deployment observability | `requestId` propagado ao export; erros tipados | ⚠️ parcial | `exportar(..., req.requestId)` |

## 4. Findings

### F-deployability-1: Frontend pode ser publicado antes do backend (rota nova)

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts
- **Localização**: `src/frontend/lib/sispag.ts`, `src/backend/routes/sispag.ts`
- **Evidência (objetiva)**: o FE chama `POST /sispag/remessas/titulos/exportar`; Vercel e Render deployam por pipelines separados.
- **Impacto técnico**: janela em que o botão de exportar recebe 404 do BE antigo.
- **Impacto de negócio**: erro visível ao analista por alguns minutos; sem perda de dados.
- **Métrica de baseline**: janela de deploy ~ minutos; 0 registros afetados (rota somente leitura).

### F-deployability-2: Sem rollout gradual / flag para recursos novos de SISPAG

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: deploy global via hook
- **Evidência (objetiva)**: nenhum mecanismo de flag no delta.
- **Impacto técnico**: toda a base de usuários recebe a feature no mesmo instante.
- **Impacto de negócio**: baixo; leitura apenas.
- **Métrica de baseline**: 0 flags.

Sem findings P0/P1: delta sem migrations, sem dependência, sem env nova, rollback por redeploy.

## 5. Cards Kanban

### [deployability-1] Garantir que o frontend tolere backend antigo na exportação

- **Problema**
  > O FE novo chama rota inexistente no BE antigo durante a janela de deploy, resultando em 404 genérico.
- **Melhoria Proposta**
  > Mapear 404/405 em `lib/sispag.ts` para mensagem "Exportação indisponível, tente em instantes"; documentar ordem BE antes de FE no DEPLOY.md.
- **Resultado Esperado**
  > Erro amigável durante a janela; 0 telas quebradas.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Mensagem tratada em 404: não → sim
- **Risco de não fazer**: confusão pontual a cada rota nova.
- **Dependências**: nenhuma

### [deployability-2] Avaliar flag simples para recursos novos de SISPAG

- **Problema**
  > Sem flags, qualquer feature entra em produção para todos de uma vez.
- **Melhoria Proposta**
  > Flag por env/permissão para features de leitura de baixo risco; opcional.
- **Resultado Esperado**
  > Habilitar por grupo antes de abrir geral.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Features com flag: 0 → 1
- **Risco de não fazer**: baixo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; leitura de código, sem rede. Não existe `infra/`; métricas Terraform/Lambda não medíveis.
- Não executei build/testes (instrução de somente leitura).
- Cross-QA: teto de ids e rate limit tocam Performance/Availability (memória do processo Render ao gerar XLSX em buffer).
