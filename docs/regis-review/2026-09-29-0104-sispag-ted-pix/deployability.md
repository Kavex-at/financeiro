---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-29-0104
agent: qa-deployability
generated_at: 2026-09-28T00:00:00Z
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev da Kavex | Merge da feature `sispag-ted-pix` (migration 0066 + 3 flags default OFF) em `main` | Render web service (auto-deploy), Vercel (frontend), Supabase (schema) | Produção com analistas usando o SISPAG; sem HML | Build gera `dist/` com a migration, `BootMigrator` aplica antes do `listen`, flags OFF mantêm envio byte-idêntico, ligar TED/PIX é decisão operacional sem redeploy | 0 mudança de comportamento com flags OFF; rollback por redeploy da versão anterior sem tocar no schema (migration aditiva); tempo de ligar/desligar flag = reinício do serviço |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Etapas automatizadas commit → prd | 7 (audit, typecheck, lint, test+coverage, build, test:sql, CI frontend; deploy nativo Render por push em main) | ≥5 | ✅ | `.github/workflows/ci.yml`, `render.yaml` |
| Gate de plano antes do apply (Terraform) | N/A: não existe `infra/` | present | N/A | CLAUDE.md §Layout |
| Migration 0066 copiada para `dist/` no build | Sim (`tsc && tsc-esm-fix dist && tsx migrations/copy-to-dist.ts`; falha da cópia falha o build) | sim | ✅ | `src/backend/package.json:11`, `migrations/copy-to-dist.ts` |
| Idempotência da migration 0066 | `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` | idempotente | ✅ | `migrations/0066_sispag_destino_manual.sql:28-72` |
| Aditividade (rollback de código seguro) | Coluna JSONB nula + tabela nova; sem drop/rename | aditiva | ✅ | idem; `docs/runbooks/rollback.md:20` |
| Flags de go-live da feature | 3 (`SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`), default OFF, lidas via `EnvironmentProvider` | ≥1 por risco | ✅ | `EnvironmentProvider.ts:228,335` |
| Flags declaradas em `render.yaml` | 0 de 3 | 3 de 3 | ⚠️ | `grep SISPAG_TED_ENABLED render.yaml` vazio |
| Rollback documentado | Sim (`docs/runbooks/rollback.md`, referenciado em DEPLOY.md:87) | sim | ✅ | DEPLOY.md, runbook |
| Lockfile / `npm ci` no CI e no Render | Sim | sim | ✅ | `ci.yml`, `render.yaml buildCommand` |
| Drift detection / Terraform / bundle Lambda / build time | ⚠️ **Não medível localmente**: sem `infra/`, sem Lambda, `--quick` não roda build. Recomendação: registrar tempo de build a partir do log do Render | n/a | N/A | CLAUDE.md |
| Frontend e backend deployados juntos | Não: Vercel e Render independentes, sem gate de compatibilidade | atômico ou tolerante | ⚠️ | `render.yaml`, CLAUDE.md |
| Gates do ciclo | 2.570 testes BE, 30 SQL, 505 FE, typecheck 0 erros | verde | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary/blue-green/rolling) | Sem canary de infra; as 3 flags default OFF funcionam como dark launch e rollout por capacidade (TED antes de PIX) | ⚠️ parcial | `EnvironmentProvider.ts:228` |
| Rollback | Redeploy da versão anterior no Render + runbook; migration aditiva não exige reverter schema; flag OFF desliga o comportamento sem redeploy | ✅ presente | `docs/runbooks/rollback.md` |
| Script Deployment Commands | Render Blueprint + `npm ci && npm run build`; auto-deploy em push a main condicionado a branch protection | ✅ presente | `render.yaml` |
| Logical Grouping | Frentes isoladas por flags (`SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, novas 3) | ✅ presente | `render.yaml`, `EnvironmentVars.ts:159` |
| Physical Grouping | N/A: um único web service + crons GitHub Actions; sem topologia multi-instância por tenant | N/A | `render.yaml` |
| Package Dependencies | `package-lock.json` + `npm ci` + `npm audit --audit-level=high` no CI; artefato é `dist/` | ✅ presente | `ci.yml` |
| Surge Protection | N/A para deploy; budget de sessões do pooler documentado | N/A | `DEPLOY.md` §1 |
| Idempotent deploys | Migrations com `IF NOT EXISTS`; boot falho mata o processo e mantém a versão anterior | ✅ presente | `0066...sql:28`, `render.yaml` |
| Drift detection | N/A: sem Terraform; env do dashboard é a fonte da verdade (`sync:false`) | N/A | `render.yaml` |
| Reproducible builds | Lockfile + `npm ci` | ✅ presente | `ci.yml` |
| Per-tenant blast radius | N/A: single-tenant hoje (`client_name=local`) | N/A | `render.yaml` |
| Deployment observability | `/health` como health check; sem verificação pós-deploy da versão nem alerta de falha de deploy | ⚠️ parcial | `render.yaml healthCheckPath` |

## 4. Findings

### F-deployability-1: Flags novas não declaradas no Render Blueprint
- **Severidade**: P2
- **Classificação**: IN_DELTA
- **Tactic violada**: Script Deployment Commands
- **Localização**: `render.yaml` (bloco `envVars`; ausência de `SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`)
- **Evidência (objetiva)**:
  ```
  grep SISPAG_TED_ENABLED em render.yaml e DEPLOY.md -> nenhum resultado
  render.yaml declara SISPAG_ENABLED e SISPAG_LIVE_WRITE_ENABLED (sync:false) como convenção
  ```
- **Impacto técnico**: o operador não enxerga no Blueprint nem no DEPLOY.md que existem interruptores de go-live; o padrão do repo (kill-switches documentados com `sync:false`) foi quebrado. Default OFF no código torna a omissão segura, mas não visível.
- **Impacto de negócio**: no dia do teste supervisionado em PRD, ligar/desligar depende de alguém lembrar o nome exato da variável. Um erro de digitação mantém OFF em silêncio.
- **Métrica de baseline**: 0 de 3 flags declaradas em `render.yaml`.

### F-deployability-2: Frontend (Vercel) e backend (Render) sem gate de compatibilidade
- **Severidade**: P2
- **Classificação**: IN_DELTA (a feature amplia o contrato da API consumida por `LoteCard`/`InformarDestinoDialog`); a ausência de gate é PRE_EXISTING
- **Tactic violada**: Scale Rollouts
- **Localização**: `src/frontend/lib/sispag.ts`, `src/backend/routes/sispag.ts`, `render.yaml`
- **Evidência (objetiva)**:
  ```
  57 arquivos alterados, front e back no mesmo PR; deploys independentes (Vercel + Render), sem versão de contrato
  ```
- **Impacto técnico**: janela em que o front novo chama rotas de destino que o backend ainda não serve (ou o inverso após rollback só de um lado) resulta em 404/campo ausente na tela SISPAG.
- **Impacto de negócio**: o analista vê erro no card do lote durante a janela; sem dano financeiro porque as flags OFF escondem o fluxo, mas rollback parcial pode confundir.
- **Métrica de baseline**: 2 alvos de deploy independentes, 0 verificações de compatibilidade (duração da janela não medida).

### F-deployability-3: Sem verificação pós-deploy nem sinal de falha de deploy
- **Severidade**: P3
- **Classificação**: PRE_EXISTING
- **Tactic violada**: Rollback (detecção que aciona o rollback)
- **Localização**: `.github/workflows/ci.yml` (sem job de deploy), `render.yaml`
- **Evidência (objetiva)**:
  ```
  ci.yml: apenas gates; deploy é nativo do Render; healthCheckPath /health é o único sinal
  ```
- **Impacto técnico**: `/health` não prova que a migration 0066 foi aplicada nem que a versão esperada está no ar (o incidente de 2026-09-23 mostrou migração silenciosamente não aplicada).
- **Impacto de negócio**: uma regressão pode passar horas sem ser notada até um analista reclamar.
- **Métrica de baseline**: 0 checks pós-deploy automatizados; 1 incidente registrado (2026-09-23).

## 5. Cards Kanban

### [deployability-1] Declarar as 3 flags SISPAG TED/PIX no render.yaml e no DEPLOY.md

- **Problema**
  > `SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED` e `SISPAG_PIX_ENABLED` só existem no código. O Blueprint e o DEPLOY.md documentam os outros kill-switches, mas não estes.

- **Melhoria Proposta**
  > Adicionar as 3 chaves em `render.yaml` com `sync: false` e comentário (ordem de ligação: DESTINO_MANUAL, TED, PIX; como desligar). Incluir a ordem no DEPLOY.md e linkar o checklist supervisionado do tasks.md.

- **Resultado Esperado**
  > Operador liga e desliga cada flag sem consultar o código. Flags declaradas: 0 de 3 para 3 de 3.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Flags declaradas no Blueprint: 0/3 → 3/3
- **Risco de não fazer**: no go-live, uma variável digitada errada mantém a feature OFF sem aviso, ou a flag certa não é achada num incidente.
- **Dependências**: nenhuma

### [deployability-2] Tornar o frontend tolerante a backend sem as rotas de destino

- **Problema**
  > Vercel e Render fazem deploy independente. Se o front novo chegar antes do backend, ou o backend sofrer rollback sozinho, o card do lote chama rotas ausentes.

- **Melhoria Proposta**
  > Front trata 404/ausência dos campos de destino como "recurso indisponível" (esconde o botão), e o backend expõe as flags ativas em rota já existente para o front decidir o que renderizar. Documentar a ordem (backend primeiro, front depois) no runbook de rollback.

- **Resultado Esperado**
  > Janela de incompatibilidade deixa de gerar erro visível ao analista (erros visíveis na janela: não medido → 0).

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Teste de front com backend sem rotas de destino: ausente → presente
- **Risco de não fazer**: rollback parcial vira incidente confuso na tela do SISPAG.
- **Dependências**: nenhuma

### [deployability-3] Smoke check pós-deploy que confirma versão e última migration

- **Problema**
  > `/health` é o único sinal pós-deploy e não confirma migration aplicada nem versão. O incidente de 2026-09-23 (migração não aplicada por semanas) mostra o custo.

- **Melhoria Proposta**
  > Expor `version` e `lastMigration` em `/health` (sem dado sensível) e adicionar workflow pós-merge ou `workflow_dispatch` que compara com o esperado (`0066`) e falha se divergir.

- **Resultado Esperado**
  > Deploy sem a migration esperada detectado em minutos. Checks pós-deploy: 0 → 1.

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Tempo para detectar migration não aplicada: indeterminado → menos de 10 min
- **Risco de não fazer**: repetição silenciosa do incidente de 2026-09-23.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick` e feature-scoped: sem build, sem rede. A cópia da 0066 para `dist/` foi verificada pelo script (`copy-to-dist.ts`) e pelo shared-metrics, não reexecutada.
- Nenhum P0: migration aditiva e idempotente, flags default OFF, rollback documentado.
- Métricas de Terraform/Lambda/tenant são N/A (não existe `infra/`).
- Cross-QA: flags como dark launch (Availability/Fault-Tolerance); trilha só-inclusão por trigger impede limpeza da auditoria (Security/Modifiability); complexidade cognitiva de `RemessaService` sobe (Modifiability).
