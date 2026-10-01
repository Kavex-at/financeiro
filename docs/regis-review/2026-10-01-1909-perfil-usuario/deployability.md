---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-deployability
generated_at: 2026-10-01T19:30:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Merge do PR `feat/perfil-usuario` (59 arquivos, +9257/-66) em main | Pipeline Render (backend, `BootMigrator` aplica 0072) + Vercel (frontend, nova dep Radix) | Produção single-tenant, ~200 linhas nas tabelas de ledger | Deploy aplica 11 índices idempotentes sem downtime; /perfil sobe junto; rollback possível por Render/Vercel e SQL de reverse | 0 falhas de boot; lock de build desprezível; rollback sem perda de dado em <10 min |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Etapas automáticas commit→main (CI) | typecheck, lint, test+coverage, build, job SQL com PG real (5) | ≥5 | ✅ | `.github/workflows/ci.yml:25-28` e job SQL |
| Migration 0072 idempotente | 11/11 `CREATE INDEX IF NOT EXISTS` | 100% | ✅ | `src/backend/migrations/0072_idx_atividade_usuario.sql` |
| Migration só aditiva (sem DDL de tabela/dado) | sim (apenas índices) | sim | ✅ | idem |
| Rollback escrito para 0072 | 11 `DROP INDEX IF EXISTS`, fora do diretório do runner | presente | ✅ | `migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql` |
| Rollback coberto por teste | sim | sim | ✅ | `migrations/rollbacks.test.ts:57-59` |
| `.sql` copiado para `dist/` no build | `tsx migrations/copy-to-dist.ts` no `build` | presente | ✅ | `src/backend/package.json:11` |
| DEPLOY.md menciona 0072 | 0 ocorrências (última migration citada: 0071) | 1 | ⚠️ | `grep 0072 DEPLOY.md` |
| rollbacks/README.md menciona 0072 | 0 ocorrências | 1 | ⚠️ | `grep 0072 migrations/rollbacks/README.md` |
| Nova dependência de runtime | 1 (`@radix-ui/react-dropdown-menu ^2.1.24`), lockfile atualizado | lockfile commitado | ✅ | `src/frontend/package.json:18`, `package-lock.json` no delta |
| Versão FE==BE | 0.48.0 / 0.48.0 | lockstep | ✅ | `package.json:3` (ambos) |
| Feature flag para /perfil | 0 | ≥1 para rota nova de UI | ⚠️ | `src/frontend/app/perfil/page.tsx`, sem gate |
| Gates medidos na sessão | typecheck OK, lint 0 erros, 3531+738 testes, SQL integration 36/36 | verde | ✅ | `_shared-metrics.md` |
| Terraform / tenants / drift / bundle Lambda | ⚠️ **Não medível localmente**: não existe `infra/` nem build Lambda. Recomendação: reavaliar quando o scaffold Terraform existir. | n/a | n/a | CLAUDE.md §Estado Atual |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Deploy único para 100% (Render/Vercel); sem canary/flag para /perfil. Risco baixo: rota aditiva somente leitura | ⚠️ parcial | `routes/me.ts` (3 GET) |
| Rollback | Render/Vercel "Rollback"; 0072 aditiva, código antigo a ignora; reverse SQL manual testado | ✅ presente | `rollbacks/0072_*.rollback.sql` |
| Script Deployment Commands | `npm run build` com cópia de `.sql`; `BootMigrator` automático; CI em 5 etapas | ✅ presente | `package.json:11`, `ci.yml` |
| Logical Grouping | N/A: sem Terraform/tenants; um serviço Render + um app Vercel | N/A | CLAUDE.md |
| Physical Grouping | N/A: sem Lambdas a agrupar | N/A | idem |
| Package Dependencies | Lockfile commitado; dep Radix com caret e lock fixando versão | ✅ presente | `package-lock.json` no delta |
| Surge Protection | Índices sem CONCURRENTLY; seguro a ~200 linhas por tabela | ⚠️ parcial | cabeçalho da 0072 |
| Idempotent deploys | `IF NOT EXISTS` / `IF EXISTS` em todos os statements | ✅ presente | 0072 e rollback |
| Drift detection | N/A: sem IaC | N/A | — |
| Reproducible builds | Lockfiles presentes; `tsc` determinístico | ✅ presente | `package-lock.json` |
| Per-tenant blast radius | N/A: single-tenant hoje | N/A | CLAUDE.md §Tenants |
| Deployment observability | Job `validate-perfil-usuario-v1` (equivalência vs prod, 350 comparações, 0 divergências); EXPLAIN documentado | ✅ presente | `jobs/validate-perfil-usuario-v1.ts` |

## 4. Findings

### F-deployability-1: DEPLOY.md e rollbacks/README.md não registram a 0072

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (runbook de deploy)
- **Localização**: `DEPLOY.md:291,334` (última migration citada é a 0071); `src/backend/migrations/rollbacks/README.md`
- **Evidência (objetiva)**:
  ```
  grep -n 0072 DEPLOY.md src/backend/migrations/rollbacks/README.md  -> 0 resultados
  ```
- **Impacto técnico**: operador em incidente não encontra o reverse nem a ordem de deploy da 0072 sem ler o código.
- **Impacto de negócio**: MTTR maior em rollback de índice (baixo risco, mas custa tempo às 2h).
- **Métrica de baseline**: 0 de 2 documentos citam a 0072.

### F-deployability-2: Índices sem CONCURRENTLY

- **Severidade**: P3
- **Tactic violada**: Surge Protection (lock durante deploy)
- **Localização**: `src/backend/migrations/0072_idx_atividade_usuario.sql:17-18,22-58`
- **Evidência (objetiva)**:
  ```
  "Sem CONCURRENTLY: o BootMigrator roda cada migration em transação"; volumes: 190 execuções de permuta, 10 remessas
  ```
- **Impacto técnico**: CREATE INDEX toma lock de escrita; irrelevante a ~200 linhas, relevante se uma migration futura repetir o padrão em tabela grande.
- **Impacto de negócio**: nenhum hoje; decisão documentada e defensável.
- **Métrica de baseline**: ~200 linhas por tabela; 11 índices.

### F-deployability-3: /perfil vai a 100% dos usuários sem flag

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `src/frontend/app/perfil/page.tsx`, `src/backend/routes/me.ts`
- **Evidência (objetiva)**:
  ```
  0 flags no delta; 3 rotas GET aditivas, somente leitura
  ```
- **Impacto técnico**: defeito de UI chega a todos; mitigado por rollback Vercel e por a feature ser aditiva.
- **Impacto de negócio**: baixo; página nova, sem fluxo financeiro dependente.
- **Métrica de baseline**: 0 flags; 59 arquivos no delta.

## 5. Cards Kanban

### [deployability-1] Registrar a migration 0072 no DEPLOY.md e no rollbacks/README.md

- **Problema**
  > A 0072 (11 índices) tem reverse escrito e testado, mas DEPLOY.md e rollbacks/README.md não a citam (0 menções).
- **Melhoria Proposta**
  > Adicionar a 0072 à seção de migrations do DEPLOY.md (aditiva, idempotente, rollback manual via psql) e ao README de rollbacks.
- **Resultado Esperado**
  > Documentos que citam a 0072: 0 → 2.
- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Documentos que citam a 0072: 0 → 2
- **Risco de não fazer**: rollback lento e dependente de quem escreveu a migration.
- **Dependências**: nenhuma

### [deployability-2] Documentar regra para CREATE INDEX CONCURRENTLY em tabelas grandes

- **Problema**
  > A 0072 omite CONCURRENTLY por causa do runner transacional; correto a ~200 linhas, mas o padrão pode ser copiado para tabelas maiores.
- **Melhoria Proposta**
  > Registrar em DEPLOY.md um limiar (ex.: >100k linhas exige migration fora de transação) e o procedimento.
- **Resultado Esperado**
  > Limiar documentado: 0 → 1 regra.
- **Tactic alvo**: Surge Protection
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Regra documentada: 0 → 1
- **Risco de não fazer**: lock de escrita numa migration futura em tabela grande.
- **Dependências**: deployability-1

### [deployability-3] Avaliar flag de rollout para novas páginas de UI

- **Problema**
  > /perfil é publicada a 100% dos usuários no merge, sem flag.
- **Melhoria Proposta**
  > Opcional: flag simples (env `NEXT_PUBLIC_*`) para ocultar o item do UserMenu; só vale se o time quiser rollout gradual de UI.
- **Resultado Esperado**
  > Flags de rollout de UI: 0 → 1 (opcional).
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Páginas novas com flag: 0 → 1
- **Risco de não fazer**: baixo; rollback Vercel cobre.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de feat/perfil-usuario; modo --quick, sem build executado (gates vêm de `_shared-metrics.md`). Terraform, drift e bundle Lambda não medíveis (sem `infra/`).
- Reverificado: score 8, sem P0/P1; os três achados do run anterior se confirmam.
- Cross-QA: F-deployability-2 liga a Performance (índices para crescimento futuro); a ausência de flag liga a Modifiability/Testability.
