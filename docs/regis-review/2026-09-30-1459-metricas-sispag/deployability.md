---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-deployability
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev / Render (deploy hook após merge em main) | Deploy da migration 0070 (ALTER TABLE + backfill de 10 linhas + `CREATE OR REPLACE FUNCTION`) junto com código que grava `encerrado_em` e frontend que lê 2 chaves novas | `BootMigrator` no boot do servidor a partir de `dist/migrations`, `remessa_execucao`, `metricas.metricas_ciclo`, `/metricas` | Produção única (Render + Supabase), sem tenants, sem canary | Migration aplicada uma vez sob advisory lock, idempotente; falha de build/migração mantém a versão anterior no ar; frontend e backend tolerantes à ordem de deploy | 0 downtime; migration < 1s (10 linhas); reversão por script documentado; 0 métricas quebradas se FE subir antes do BE |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automáticos commit→prd | 7 (audit, typecheck, lint, test+coverage, build, test:sql em Postgres 17, deploy hook Render) | ≥5 | ✅ | `.github/workflows/ci.yml` |
| Gate plan-before-apply | N/A (sem Terraform); equivalente: `test:sql` roda a migration contra Postgres 17 real antes do merge | presente | ✅ | `ci.yml` job `backend-sql` |
| `.sql` copiado para `dist/` | `build` = `tsc && tsc-esm-fix dist && tsx migrations/copy-to-dist.ts`; falha do copy falha o build | presente | ✅ | `src/backend/package.json:11`, `migrations/copy-to-dist.ts` |
| Idempotência da 0070 | `ADD COLUMN IF NOT EXISTS`, `UPDATE ... WHERE encerrado_em IS NULL`, `CREATE OR REPLACE` | idempotente | ✅ | `0070_metricas_ciclo_sispag.sql:39-50` |
| Backfill | 10 linhas (6 settled + 4 error), conferido em produção | < 10k linhas sem lock longo | ✅ | cabeçalho da 0070 |
| Script de rollback dedicado para a 0070 | ausente (`rollbacks/` tem 0054, 0055, 0063, 0066, 0069) | presente para migration com backfill | ⚠️ | `src/backend/migrations/rollbacks/` |
| Rollback documentado | Cabeçalho da 0070: `UPDATE ... SET encerrado_em = NULL` + reaplicar função da 0065 | documentado | ⚠️ (prosa, não executável) | 0070 linhas 27-30 |
| Ordem de deploy FE/BE | Frontend lê 2 chaves novas em `lib/metricas.ts` (+3 linhas); ver F-deployability-2 | tolerante | ⚠️ | `src/frontend/lib/metricas.ts` |
| Deploy por tenant / blast radius | 1 ambiente, todos os usuários | — | ⚠️ pré-existente | CLAUDE.md §Tenants |
| Drift detection, bundle Lambda, build de 30 Lambdas, módulos Terraform | ⚠️ Não medível: não há `infra/` nem Lambda (Express em Render) | — | N/A | CLAUDE.md §Layout |
| Runbooks de incidente | ⚠️ Não medido (fora do delta) | — | — | `DEPLOY.md` existe |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green; Render substitui a instância inteira. Pré-existente e fora do delta | ⚠️ parcial (pré-existente) | `render.yaml` |
| Rollback | Render mantém a versão anterior se o build falha; schema tem reverse manual (0069 tem arquivo, 0070 só prosa) | ⚠️ parcial | `rollbacks/`, header 0070 |
| Script Deployment Commands | CI (`ci.yml`) + `npm run build` + BootMigrator sob advisory lock; migrations versionadas e idempotentes | ✅ | `ci.yml`, `BootMigrator.ts:8` |
| Logical Grouping | Migração aditiva + função na mesma unidade; CTEs de Permutas/Recebimentos byte a byte iguais à 0065 (mudança isolada em SISPAG) | ✅ | 0070 header |
| Physical Grouping | N/A: 1 serviço Render, sem múltiplos artefatos por tenant | N/A | — |
| Package Dependencies | Sem nova dependência; lockfile + `npm ci` no CI | ✅ | `ci.yml` |
| Surge Protection | N/A: migration roda uma vez sob lock; sem fan-out de deploy | N/A | — |
| Idempotent deploys | ver métricas | ✅ | 0070 |
| Drift detection | N/A: sem IaC; schema versionado só por migrations | N/A | — |
| Reproducible builds | `npm ci` + lockfile; sem mudança no delta | ✅ | `ci.yml` |
| Per-tenant blast radius | N/A: sem tenants provisionados | N/A | CLAUDE.md |
| Deployment observability | BootMigrator loga `[boot-migrate]`; copy loga `[build] N migração(ões)` | ✅ | `copy-to-dist.ts` |

## 4. Findings

### F-deployability-1: 0070 tem backfill, mas rollback só em prosa (sem `rollbacks/0070_*.rollback.sql`)

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0070_metricas_ciclo_sispag.sql:27-30`; `src/backend/migrations/rollbacks/`
- **Evidência (objetiva)**:
  ```
  rollbacks/: 0054, 0055, 0063, 0066, 0069 (+ README)  -> sem 0070
  0070: "Dez linhas: reverter é UPDATE ... SET encerrado_em = NULL e reaplicar a função da 0065."
  ```
- **Impacto técnico**: reverter exige recompor à mão o corpo da função da 0065 (reenviando ~260 linhas) sob pressão. O risco real é baixo: a migração é aditiva (coluna nullable, sem NOT NULL) e o código antigo ignora a coluna.
- **Impacto de negócio**: se a série de métricas ficar errada, o tempo de volta atrás sobe de segundos para dezenas de minutos. Métricas não são caminho crítico de pagamento.
- **Métrica de baseline**: 0 de 1 migrations recentes com backfill (0070) tem reverse executável; 5 reverses existem para migrations anteriores. Sem número de incidente, por isso P2.

### F-deployability-2: Ordem de deploy FE/BE da rota `/metricas` não é garantida nem testada

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (coordenação de artefatos acoplados)
- **Localização**: `src/frontend/lib/metricas.ts`, `src/frontend/app/metricas/page.tsx`
- **Evidência (objetiva)**:
  ```
  Frontend (Vercel) e backend (Render) deployam por pipelines independentes;
  delta: +3 linhas em lib/metricas.ts, +38/-? em page.tsx, 2 chaves novas (sispag_*).
  ```
- **Impacto técnico**: se o frontend subir antes da migration (ou o BootMigrator falhar), a página recebe linhas sem as chaves SISPAG; sem tratamento explícito de ausência, pode renderizar `NaN`/`undefined`. Não verificado neste review se `page.tsx` trata a ausência. Recomenda-se conferir.
- **Impacto de negócio**: janela de minutos com KPI vazio na tela de métricas interna.
- **Métrica de baseline**: 2 pipelines independentes, 2 chaves novas; janela de descompasso não medida. P2 por falta de número.

## 5. Cards Kanban

### [deployability-1] Criar reverse executável da 0070

- **Problema**
  > A 0070 faz backfill e recria a função de métricas, mas o caminho de volta está só em comentário. As migrations 0054/0055/0063/0066/0069 têm `rollbacks/*.rollback.sql`.

- **Melhoria Proposta**
  > Adicionar `rollbacks/0070_metricas_ciclo_sispag.rollback.sql` com o corpo da função da 0065 e `UPDATE ... SET encerrado_em = NULL` (coluna pode ficar, é inerte). Registrar no `rollbacks.test.ts` (lista de reverses esperada). Tactic: Rollback.

- **Resultado Esperado**
  > Reverse aplicável com um `psql -f`; teste garante correspondência migration/reverse. Reverses para migrations com backfill: 0 de 1 → 1 de 1.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Reverse executável da 0070: ausente → presente
  - Teste `rollbacks.test.ts` verde com o novo par
- **Risco de não fazer**: reversão manual e sujeita a erro na próxima regressão da série de métricas.
- **Dependências**: nenhuma

### [deployability-2] Tornar a página de métricas tolerante à ausência das chaves SISPAG

- **Problema**
  > FE e BE deployam separadamente; a tela nova depende de 2 chaves que só existem após a migration 0070.

- **Melhoria Proposta**
  > Confirmar/cobrir em `page.test.tsx` o caso "linhas sem `sispag_*`": exibir "—" em vez de valor quebrado. Alternativa: documentar no `DEPLOY.md` a ordem BE antes de FE. Tactic: Script Deployment Commands.

- **Resultado Esperado**
  > Descompasso de deploy não gera `NaN`/vazio visível; 1 teste novo cobre o caso.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Testes do caso "chave ausente": 0 → 1
- **Risco de não fazer**: KPI quebrado durante cada deploy que adicione chave nova (padrão que se repete a cada frente).
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; sem `infra/`, tactics de Terraform/tenant marcadas N/A. Nenhum P0/P1: sem baseline numérico de incidente.
- Ponto forte: `test:sql` roda a migration em Postgres 17 no CI (equivale a um plan), e o gotcha do `.sql` fora do `dist/` está coberto pelo `copy-to-dist` no build.
- Cross-QA: rollback/reverse ↔ Fault Tolerance/Modifiability; tolerância a chave ausente ↔ Testability. Não verifiquei se `page.tsx` já trata chave ausente (F-2 é hipótese a confirmar).
- Pré-existente (não do delta): ausência de canary/blue-green e de blast-radius por tenant.
