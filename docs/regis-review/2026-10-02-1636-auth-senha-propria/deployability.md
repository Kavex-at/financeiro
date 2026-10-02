---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-02-1636-auth-senha-propria
agent: qa-deployability
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 6.5
findings_count: 4
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/dono do ciclo | Merge de `feat/auth-senha-propria` (backend + migration 0073) na `main` | CI (`ci.yml`), BootMigrator, Render, projeto Supabase Auth | Produção, `AUTH_PROVIDER=supabase`, front com flag desligada | Código novo sobe, migration aditiva aplica sem quebrar o backend antigo, pré-condição externa (Secure password change OFF) é verificada, e o rollback é possível sem perda | Deploy sem intervenção manual além da verificação documentada; rollback de código em <10 min sem reverse de schema; 0 troca de senha respondendo 503 por configuração errada |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados commit→main (CI) | 7 (audit, typecheck, lint, test+coverage, build, test:sql, tag release) | ≥5 | ✅ | `.github/workflows/ci.yml` |
| Gate plan→apply (Terraform) | Não aplicável: não existe `infra/` | presente | ⚠️ Não medível: sem Terraform; deploy é Render | CLAUDE.md §Layout |
| Passo de CD no workflow (deploy hook) | 0 em `ci.yml` (tag release apenas) | ≥1 | ⚠️ | `grep deploy .github/workflows` |
| Lockfile commitado | sim (`src/backend/package-lock.json`) | sim | ✅ | `ls` |
| Build do backend (delta) | ok; 73 `.sql` copiados para `dist/migrations`, inclui 0073 | ok | ✅ | `_shared-metrics.md` |
| Migration 0073 idempotente e aditiva | `DROP CONSTRAINT IF EXISTS` + `ADD`; backend antigo só insere tipos aceitos | sim | ✅ | `migrations/0073_*.sql` |
| Migration 0073 com reverse | não (decisão S1, justificada: append-only) | reverse ou justificativa | ✅ justificada | cabeçalho da 0073; `DEPLOY.md:348` |
| Teste da 0073 contra Postgres real | sim (`test:sql`, job de CI dedicado) | sim | ✅ | `ci.yml:35-60` |
| Runbook de rollback | `docs/runbooks/rollback.md` + seção "Troca da própria senha" no DEPLOY.md | presente | ✅ | `DEPLOY.md:88,343-349` |
| Env vars novas | 0 | mínimo | ✅ | `DEPLOY.md:345` |
| Feature flag para deploy sem ativar | `SENHA_PROPRIA_HABILITADA=false` no front (flag de build, não runtime) | presente | ⚠️ parcial | `DEPLOY.md:349` |
| Verificação automática da pré-condição "Secure password change OFF" | nenhuma (conferência manual) | automática/boot | ❌ | `DEPLOY.md:351-360` |
| Drift detection / bundles Lambda / tenants | Não medível: sem `infra/` nem Lambda | n/a | ⚠️ Não medível | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary/blue-green/rolling) | Render single service; sem canary. A flag do front dá rollout dark parcial | ⚠️ parcial | `DEPLOY.md:349` |
| Rollback | Render "Rollback" + runbook; migration aditiva torna o rollback de código seguro; `rollbacks/` existe para as migrations destrutivas (0063, 0066, 0069) | ✅ presente | `docs/runbooks/rollback.md`, `migrations/rollbacks/` |
| Script Deployment Commands | CI scriptado, build copia `.sql`, BootMigrator; deploy em si é hook do Render fora do repo | ⚠️ parcial | `package.json:11`, `ci.yml` |
| Logical Grouping | Migrations versionadas em ordem numérica; passos do rollout de auth agrupados em fases no DEPLOY.md | ✅ | `DEPLOY.md:280-339` |
| Physical Grouping | N/A: serviço único no Render, sem Lambda/tenants por conta | N/A | CLAUDE.md |
| Package Dependencies | Lockfile + `npm ci`; nenhuma dependência nova no delta | ✅ | `ci.yml:23` |
| Surge Protection | Rate limit de troca de senha (5 falhas/15 min/usuário) protege o GoTrue; não é surge de deploy | ✅ (escopo do delta) | `http/rateLimit.ts` |
| Idempotent deploys | 0073 idempotente; tag release idempotente | ✅ | 0073; `ci.yml:96` |
| Reproducible builds | `tsc` + lockfile; Node 24 pinado no CI | ✅ | `ci.yml:20` |
| Deployment observability | Sem verificação pós-deploy automatizada (smoke de `/me/senha/politica`) | ❌ | ausente |
| Per-tenant blast-radius / Drift detection | N/A: sem tenants nem Terraform | N/A | CLAUDE.md |

## 4. Findings

### F-deployability-1: Pré-condição externa do Supabase (Secure password change OFF) só é verificável à mão

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `DEPLOY.md:351-360`; `src/backend/domain/service/auth/OwnPasswordService.ts`
- **Evidência (objetiva)**:
  ```
  "Com a opção ligada ... toda troca responderia 503."  (DEPLOY.md)
  Conferência = Dashboard ou GET management API manual; nenhum passo automático.
  ```
- **Impacto técnico**: se alguém ligar a opção no dashboard, 100% das trocas falham com 503 e o deploy parece saudável (typecheck, testes e CI verdes).
- **Impacto de negócio**: a feature entra no ar quebrada e só é descoberta por um usuário; hoje o risco é baixo porque a flag do front está desligada.
- **Métrica de baseline**: 0 verificações automáticas da pré-condição; 1 passo manual (esperado: 1 comando).

### F-deployability-2: Flag de ativação é de build do front, não runtime

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `DEPLOY.md:349` (`SENHA_PROPRIA_HABILITADA = false`)
- **Evidência (objetiva)**:
  ```
  "O front continua com SENHA_PROPRIA_HABILITADA = false até o tweak que liga a flag"
  ```
- **Impacto técnico**: ligar e desligar exige novo deploy do front (Vercel); não há kill switch de runtime para o endpoint no backend (a rota `/me/senha` está sempre ativa).
- **Impacto de negócio**: em incidente com o GoTrue, a mitigação é rollback de deploy, não um toggle de segundos.
- **Métrica de baseline**: tempo para desligar a feature = 1 deploy do front (~minutos); alvo = toggle de env.

### F-deployability-3: Sem passo de CD nem smoke pós-deploy versionado no repo (pré-existente)

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands / Deployment observability
- **Localização**: `.github/workflows/ci.yml` (ausência de job de deploy/health)
- **Evidência (objetiva)**:
  ```
  jobs: Backend, Backend SQL, Frontend, Tag Release  -> 0 jobs de deploy ou smoke
  ```
- **Impacto técnico**: o resultado do deploy no Render não retroalimenta o CI; falha de boot (como a do BootMigrator em 2026-09-23, citada no CLAUDE.md) só aparece pela observação humana.
- **Impacto de negócio**: lead time de detecção de deploy ruim depende de alguém notar. Pré-existente; este delta não piora.
- **Métrica de baseline**: 0 verificações pós-deploy automatizadas; 4 jobs de CI, 0 de CD.

### F-deployability-4: Migration 0073 sem reverse (aceita, registrada)

- **Severidade**: P3
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0073_app_user_access_event_tipo_senha.sql`
- **Evidência (objetiva)**:
  ```
  "Sem reverse (decisão S1): voltar à lista estreita falharia assim que existisse uma linha `senha`"
  ```
- **Impacto técnico**: nenhum para o rollback de código (backend antigo só insere tipos aceitos pela lista nova). Divergência do padrão `rollbacks/` das migrations destrutivas é coerente, porque esta é aditiva.
- **Impacto de negócio**: nenhum; achado informativo, sem card.
- **Métrica de baseline**: 1 migration sem reverse, 0 impedimentos de rollback de código.

## 5. Cards Kanban

### [deployability-1] Verificar "Secure password change" do Supabase de forma automatizada

- **Problema**
  > A troca de senha no modo `supabase` depende de `security_update_password_require_reauthentication=false`, conferido só manualmente. Se alguém religar a opção, toda troca responde 503 sem que nenhum gate perceba.

- **Melhoria Proposta**
  > Criar um job/script de sonda (nos moldes de `jobs/probe-*`) que lê a Management API em modo somente leitura e falha se a opção estiver `true`. Rodar manualmente antes de ligar a flag do front e, se viável, agendar. Tactic: Script Deployment Commands.

- **Resultado Esperado**
  > Pré-condição verificada por 1 comando. Conferências manuais: 1 → 0.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Verificações automáticas da pré-condição: 0 → 1
- **Risco de não fazer**: a feature liga com a configuração errada e só é detectada por reclamação de usuário.
- **Dependências**: token pessoal da Management API disponível ao dono do ciclo.

### [deployability-2] Adicionar smoke pós-deploy ao pipeline

- **Problema**
  > O CI não tem passo de CD nem smoke. O sucesso do deploy no Render e do BootMigrator não é checado automaticamente.

- **Melhoria Proposta**
  > Job pós-merge que consulta `/health` (e uma rota autenticada de leitura barata) na URL de produção e falha o workflow se a versão publicada não bater com `package.json`. Tactic: Deployment observability / Script Deployment Commands.

- **Resultado Esperado**
  > Deploy ruim detectado em minutos. Verificações pós-deploy automáticas: 0 → 1.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Jobs de CD/smoke: 0 → 1
- **Risco de não fazer**: repetir o incidente de 2026-09-23 (migrations não aplicadas por semanas).
- **Dependências**: endpoint de versão/health exposto.

### [deployability-3] Kill switch de runtime para `/me/senha`

- **Problema**
  > Desligar a troca de senha em incidente exige rollback ou deploy do front, porque a rota do backend está sempre ativa.

- **Melhoria Proposta**
  > Env `OWN_PASSWORD_CHANGE_ENABLED` lida via `EnvironmentProvider`; quando `false`, `POST /me/senha` responde 503 explícito, e `GET /politica` devolve `habilitada:false`. Tactic: Scale Rollouts (dark launch).

- **Resultado Esperado**
  > Tempo para desligar: 1 deploy → 1 mudança de env. Sem novo deploy de código.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Tempo para desativar a feature: ~minutos de deploy → <1 min (restart do Render)
- **Risco de não fazer**: baixo; mitigação por rollback segue funcionando.
- **Dependências**: nenhuma.

## 6. Notas do agente

- `--quick`: nenhum build ou medição foi re-executado; usei `_shared-metrics.md` (build ok, 73 `.sql` copiados, 0073 testada no `test:sql`).
- Escopo no delta: a 0073 é aditiva e idempotente, e o DEPLOY.md cobre ordem de aplicação e rollback. Nenhum achado P0.
- Terraform, tenants, bundles Lambda, drift e blast-radius por tenant: não medíveis (sem `infra/`).
- Cross-QA: F-deployability-1 liga-se a Security/Availability (503 por configuração do GoTrue); F-deployability-3 liga-se a Availability (MTTD).
