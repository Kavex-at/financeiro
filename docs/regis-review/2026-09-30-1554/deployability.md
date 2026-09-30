---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-30-1554
agent: qa-deployability
generated_at: 2026-09-30T16:30:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dono do ciclo (Kavex) | Merge da feature `auth-supabase` em `main` e corte do login para Supabase Auth em 9 passos manuais | Render (`render.yaml`, `BootMigrator`, migration 0070), env vars, DEPLOY.md §6 | Produção, 12 usuários ativos, cutover em horário comercial | Merge não liga nada (`AUTH_PROVIDER` ausente = `local`); corte e rollback por variável de ambiente, sem redeploy de código | Rollback em ≤ 1 deploy do Render por fase; no máximo 1 login novo por pessoa; 0 deslogados em massa |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Workflows de CI/CD | 7 (`ci.yml` + 6 crons) | CI presente | ✅ | `ls .github/workflows` |
| Passos automatizados commit→prd | 6 (audit, typecheck, lint, test+coverage, build, SQL Postgres 17) + auto-deploy Render no merge | ≥ 5 | ✅ | `.github/workflows/ci.yml`, `render.yaml` |
| Gate de plan antes de apply | N/A: sem Terraform; gate equivalente = CI obrigatório na proteção de branch + migração no boot que falha o processo (mantém versão anterior) | presente | ✅ | `render.yaml` (comentários) |
| Rollout sequencial dev→stg→prd | 0 ambientes intermediários; 1 serviço de prd, deploy direto de `main` (pré-existente) | ≥ 1 estágio | ⚠️ | `render.yaml` |
| Feature flags de ativação (delta) | 1 novo: `AUTH_PROVIDER` (`local`/`supabase`), default seguro `local` | ≥ 1 por mudança arriscada | ✅ | `render.yaml`, `http/authEnv.ts:25` |
| Rollback documentado | Tabela de 6 fases em DEPLOY.md §6 + Render "Rollback" nativo | presente | ✅ | `DEPLOY.md:329-340` |
| Rollback de 1 variável (modo auth) | 1 variável (`AUTH_PROVIDER=local`) + deploy | 1 | ✅ | `DEPLOY.md` §6 |
| Passos manuais do corte | 9 (0 a 8), ~20 verificações manuais, 0 automatizadas | verificações scriptadas | ⚠️ | `DEPLOY.md:277-327` |
| Migration 0070 idempotente e aditiva | Sim (`IF NOT EXISTS`, guarda por existência de roles); sem reverse (D9, declarado) | idempotente | ✅ | `migrations/0070_app_user_auth_user_id.sql` |
| Migration copiada para `dist` | 68 migrations, inclui 0070 | 100% | ✅ | `_shared-metrics.md` (build) |
| Validação de env no boot | `AUTH_PROVIDER=supabase` sem as 3 vars Supabase = falha no boot listando o que falta | fail-fast | ✅ | `http/authEnv.ts:79-125` |
| Guarda contra armadilha D14 (`SUPABASE_URL` com backend ≤ v0.44) | 0 guardas técnicas; só aviso em texto (runbook + comentário no `render.yaml`) | guarda ou 0 dependência de ordem | ⚠️ | `DEPLOY.md:243-246` |
| Jobs de operação scriptados | 2 (`sync-supabase-auth` com dry-run default e `--execute`; `seed-admin`), idempotentes; script npm `job:sync-supabase-auth` | scriptado | ✅ | `src/backend/package.json:31` |
| Lockfile / build fixado | Lockfile commitado, `npm ci` no CI e no Render, Node 24 no CI | presente | ✅ | `ci.yml`, `render.yaml` |
| Drift detection (config Render) | ausente; envs `sync: false` só no dashboard (pré-existente) | presente | ⚠️ | `render.yaml` |
| Terraform módulos/tenants, bundle Lambda, `local.api_lambdas` | ⚠️ **Não medível localmente**: não existe `infra/` nem Lambda (Render + Vercel). Recomendação: reavaliar quando o scaffold Terraform existir | n/a | n/a | CLAUDE.md §Layout |
| Runbook de incidente (auth) | Presente para corte, rollback e divergência (`AUTH_DIVERGENCIA`); ausente para "Supabase Auth fora do ar" | 1 por modo de falha | ⚠️ | `DEPLOY.md` §6 |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green. Substituto: feature flag (`AUTH_PROVIDER`), corte em fases com verificação, tokens HS256 antigos convivem até expirar | ⚠️ parcial | `DEPLOY.md` passos 1-8 |
| Rollback | Render Rollback + rollback por flag; tokens dos dois emissores verificados em paralelo; senhas espelhadas nos dois lados (R7) | ✅ presente | `DEPLOY.md:329-340` |
| Script Deployment Commands | CI + auto-deploy; jobs de sync com dry-run/`--execute`; passos do corte e verificações SQL/curl são copiar-e-colar, não script | ⚠️ parcial | `ci.yml`, `jobs/sync-supabase-auth.ts` |
| Logical Grouping | Feature isolada em `domain/service/auth/`, `SupabaseAuthClient`, `authEnv.ts` | ✅ presente | `_shared-metrics.md` escopo |
| Physical Grouping | N/A: 1 serviço backend no Render e 1 front na Vercel, sem multi-tenant provisionado | N/A | CLAUDE.md §Tenants |
| Package Dependencies | Migration 0070 anulável e aditiva permite front novo com backend antigo e cron aplicar antes do backend; front tolera resposta sem `refreshToken` | ✅ presente | `DEPLOY.md` passo 1 |
| Surge Protection | Rate limit próprio (`http/rateLimit.ts`) e pré-requisito de subir limites do Supabase no Passo 0 (todo tráfego vem de 1 IP) | ✅ presente | `DEPLOY.md` Passo 0.3 |
| Idempotent deploys | 0070 e sync idempotentes (2ª execução = 0 ações) | ✅ presente | migration, `DEPLOY.md` Passo 4 |
| Reproducible builds | `npm ci` + lockfile; build copia migrations | ✅ presente | `render.yaml` |
| Drift detection | ausente (pré-existente) | ❌ ausente | `render.yaml` |
| Per-tenant blast-radius limit | N/A: sem tenants; blast radius do corte limitado por flag reversível | N/A | CLAUDE.md §Tenants |
| Deployment observability | `AUTH_PROVIDER` visível na tela Operação; `AUTH_DIVERGENCIA` no log; sem alerta automático pós-deploy | ⚠️ parcial | `app/operacao/page.tsx` |

## 4. Findings (achados)

### F-deployability-1: Armadilha D14 depende só de disciplina de ordem

- **Severidade**: P2
- **Tactic violada**: Package Dependencies
- **Localização**: `DEPLOY.md:243-246`, `render.yaml:83-89`
- **Evidência (objetiva)**:
  ```
  "SUPABASE_URL nunca pode estar definida com um backend <= v0.44 no ar ... todo mundo é deslogado"
  ```
- **Impacto técnico**: um rollback de código (botão "Rollback" do Render) com `SUPABASE_URL` ainda definida aplica o `issuer` aos tokens HS256 e invalida todas as sessões. O Render não reverte envs junto com o deploy.
- **Impacto de negócio**: logout global de ~12 analistas durante operação financeira; sem perda de dados.
- **Métrica de baseline**: 0 guardas técnicas, 1 sequência obrigatória de 2 passos; 12 usuários afetados no pior caso.

### F-deployability-2: Verificações do corte são todas manuais

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `DEPLOY.md:277-327`
- **Evidência (objetiva)**: 9 passos, cada um terminando em "Verificar: ..." com SQL/curl copiado à mão; nenhum script de verificação.
- **Impacto técnico**: erro de digitação ou passo pulado só aparece em produção. O corte roda uma vez, mas as verificações servem também ao rollback.
- **Impacto de negócio**: horas do dono do ciclo e risco de erro humano.
- **Métrica de baseline**: ~20 verificações manuais, 0 automatizadas.

### F-deployability-3: Sem ambiente intermediário nem drift detection (pré-existente)

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `render.yaml` (`autoDeploy: true`, `branch: main`)
- **Evidência (objetiva)**: 1 serviço, 0 staging; envs `sync: false` só no dashboard.
- **Impacto técnico**: o corte do Supabase Auth só é ensaiado em produção; mitigado por flag e dry-run.
- **Impacto de negócio**: risco assumido pelo tamanho do time.
- **Métrica de baseline**: 0 ambientes pré-prd, 0 jobs de drift.

### F-deployability-4: ADR citado com números diferentes e sem runbook de indisponibilidade do Supabase Auth

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands (documentação operacional)
- **Localização**: `DEPLOY.md:230` e comentários do `render.yaml` (ADR-0054) vs. commit `b94d9e0` e `ontology/decisions/0056-...`
- **Evidência (objetiva)**: mesma feature citada como ADR-0054 e ADR-0056; o runbook cobre divergência e rollback, mas não "GoTrue fora do ar".
- **Impacto técnico**: operador procura o ADR errado; em queda do provedor a saída (`AUTH_PROVIDER=local`) existe, mas está implícita.
- **Impacto de negócio**: MTTR maior em incidente de login.
- **Métrica de baseline**: 2 números de ADR para 1 decisão; 0 linhas de runbook para indisponibilidade do provedor.

## 5. Cards Kanban

### [deployability-1] Tornar o rollback de código à prova da armadilha D14

- **Problema**
  > O rollback de deploy no Render com `SUPABASE_URL` definida desloga todos os usuários (12 hoje), e a única proteção é um aviso em texto no DEPLOY.md.

- **Melhoria Proposta**
  > Tactic Package Dependencies: colocar um checklist "antes de qualquer Rollback do Render" no topo da seção 6 (não só na tabela) e um teste de contrato que fixe a aceitação de tokens HS256 sem `iss` na versão de transição. Avaliar tornar o verificador tolerante para eliminar a dependência de ordem.

- **Resultado Esperado**
  > Rollback seguro sem conhecimento tácito: guardas contra D14 de 0 para 1.

- **Tactic alvo**: Package Dependencies
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Guardas contra D14: 0 → 1
- **Risco de não fazer**: um rollback apressado durante incidente desloga toda a operação financeira.
- **Dependências**: nenhuma

### [deployability-2] Scriptar as verificações do corte

- **Problema**
  > O corte tem ~20 verificações SQL/curl copiadas à mão em 9 passos.

- **Melhoria Proposta**
  > Tactic Script Deployment Commands: um job somente leitura (`job:verify-auth`) que checa contagens de `auth_user_id`, grants de `anon`/`authenticated`, `AUTH_PROVIDER` efetivo e login de teste, com saída pass/fail. Reutilizável no rollback.

- **Resultado Esperado**
  > Verificações automatizadas de 0 para ≥ 12; sobram as de painel do Supabase.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Verificações automatizadas: 0 → ≥ 12
- **Risco de não fazer**: erro humano em passo de produção.
- **Dependências**: nenhuma

### [deployability-3] Corrigir ADR citado e cobrir indisponibilidade do Supabase Auth no runbook

- **Problema**
  > DEPLOY.md e `render.yaml` citam ADR-0054 enquanto o registro é 0056, e não há linha de runbook para "GoTrue fora do ar".

- **Melhoria Proposta**
  > Alinhar o número do ADR e acrescentar à tabela de rollback a linha "Supabase Auth indisponível: `AUTH_PROVIDER=local` + deploy (enquanto `AUTH_JWT_SECRET` existir)".

- **Resultado Esperado**
  > 1 número de ADR por decisão; 1 linha de runbook para indisponibilidade.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Números de ADR divergentes: 2 → 1
  - Linhas de runbook de indisponibilidade: 0 → 1
- **Risco de não fazer**: MTTR maior em incidente de login.
- **Dependências**: nenhuma

## 6. Notas do agente

- Modo `--quick`: sem build de bundle nem timing; build já provado em `_shared-metrics.md`. Métricas Terraform/Lambda não medíveis (sem `infra/`).
- F-deployability-3 (sem staging/drift) é pré-existente e sem card: risco assumido, fora do delta.
- Ponto forte: desenho aditivo (0070 anulável, default `local`, front tolerante) permite deploy sem ativação.
- Cross-QA: F-deployability-1 liga com Availability e Security (logout global; chave secreta com poder de admin só no Render e jobs).
