---
qa: Deployability
qa_slug: deployability
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-deployability
generated_at: 2026-07-29T02:43:00Z
scope: backend+frontend
score: 8
findings_count: 5
cards_count: 5
---

# Deployability — Regis-Review

> **Contexto de escopo (fixo).** O CLAUDE.md descreve um alvo AWS Lambda + Terraform, mas o
> repositório **hoje** roda Express no Render + Next.js na Vercel + Postgres no Supabase (ver
> `DEPLOY.md`, `render.yaml`). Não há `infra/` nem tfvars — todas as tactics de IaC/Terraform
> são marcadas **N/A (sem infra/ — Render hoje)**. A avaliação é do pipeline REAL usado para
> promover o delta do SN à produção.

## 1. Cenário Geral (Bass General Scenario aplicado ao SN)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev merge em `main` (PR fechado) | Push contendo o delta do `gerarSolicitacaoNumerario` (novo service + rota + FE dialog) | Serviço Render `financeiro-backend` (Express) + projeto Vercel (Next.js) — ambos com auto-deploy | Produção multi-tenant Columbia; SN é **DRY-RUN + kill-switch por `RECEBIMENTOS_ENABLED`** | (1) CI (`.github/workflows/ci.yml`) bloqueia merge se lint/typecheck/test/audit/build falharem; (2) Render dispara auto-deploy, roda `preDeployCommand` (`migrate + seed:admin`), health-check `/health`; (3) rota `/recebimentos/*` responde **403** enquanto `RECEBIMENTOS_ENABLED` fica em `false` (fail-safe); (4) `SolicitacaoNumerarioService.enviarAoErp` lança `NotImplementedError (501)` — **zero caminho de escrita alcançável** ao ERP | Lead time commit→prd ≤ 15 min; zero side-effect no Conexos (dry-run + NotImplementedError); rollback = flip da env var no dashboard Render (segundos) OU redeploy do commit anterior (minutos); tag `v0.17.6` idempotente criada pela job `tag-release` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates automatizados pré-merge (commit→prd) | 6 (audit high, typecheck, lint, test+coverage, build BE, typecheck+lint+test FE) | ≥ 5 | ✅ | `.github/workflows/ci.yml:23-46` |
| Presença de teste do gate `enviarAoErp` (garantia de kill-switch) | 1 test | ≥ 1 | ✅ | `SolicitacaoNumerarioService.test.ts:78-86` (`enviarAoErp throws NotImplementedError (dry-run only)`) |
| Feature flag BE (fail-safe) | `recebimentosGate` bloqueia com 403 quando `RECEBIMENTOS_ENABLED` != `true` em prod | presente | ✅ | `src/backend/http/recebimentosGate.ts:14-22`, `EnvironmentProvider.ts:43-53` |
| Feature flag FE (paridade + fail-safe) | `isRecebimentosEnabled()` esconde a rota `/recebimentos` (redirect) quando flag != `true` fora de local | presente | ✅ | `src/frontend/lib/features.ts:24-29`, `app/recebimentos/page.tsx:59` |
| Reprodutibilidade — lockfiles commitados (BE + FE) | 2/2 | 2/2 | ✅ | `src/backend/package-lock.json`, `src/frontend/package-lock.json` |
| Instalação determinística no CI | `npm ci` (BE e FE) | `npm ci` | ✅ | `ci.yml:23,43` |
| Pinning de Node.js na CI | Node 24 (BE + FE) | pinned | ✅ | `ci.yml:20,41` |
| Suítes de teste BE (SN cobre 100% dos ramos) | 740/740 tests em 75 suites (SN test file com 8 casos) | verde | ✅ | `_shared-metrics.md:57`, `SolicitacaoNumerarioService.test.ts` |
| Suítes de teste FE | 104/104 tests em 20 suites | verde | ✅ | `_shared-metrics.md:59` |
| Version bump lockstep FE==BE | ambos em `0.17.6` | lockstep | ✅ | `src/backend/package.json`, `src/frontend/package.json` |
| Idempotência do `tag-release` (evita retag) | `git rev-parse "$TAG"` short-circuit | idempotente | ✅ | `ci.yml:66-69` |
| Idempotência do `preDeployCommand` (migrate+seed) | `seed:admin` = UPSERT por username; migrations versionadas | idempotente | ✅ | `DEPLOY.md:31-33,95-96` |
| Health-check endpoint | `GET /health → {status:'ok', version}` + `healthCheckPath: /health` no Render | presente | ✅ | `src/backend/index.ts:72`, `render.yaml:22` |
| Docs de rollback do SN (runbook) | 1 runbook geral (`fin010-write-cutover.md`) — nada específico para reverter SN | ≥ 1 runbook SN + procedimento kill-switch escrito | ❌ (não medível: doc ausente) | `docs/runbooks/` (só `fin010-write-cutover.md`) |
| Blast radius do rollback FE↔BE | FE (Vercel) e BE (Render) têm auto-deploy independentes; risco de dessincronia se um lado desdobrar antes do outro após bump lockstep | atomicidade cross-hop | ⚠️ | `render.yaml:11-17` + Vercel isolado |
| Presença de canary/blue-green nativo | `render.yaml plan: starter` — sem preview/blue-green; um único slot | canário ou preview env | ❌ | `render.yaml:10` |
| Drift detection env vars (`sync: false`) | 12 chaves com `sync: false` no `render.yaml` (inclui `RECEBIMENTOS_ENABLED`) — blueprint declara "existência", valor real vive só no dashboard | tolerado por design; sem alerta se operator zerar chave | ⚠️ | `render.yaml:39-67` |

> ⚠️ **Não medíveis localmente** (Render/Vercel produção):
> - Lead-time real commit→prd (métrica na dashboard Render/Vercel).
> - Taxa de sucesso de deploy (histórico da esteira).
> - MTTR de rollback (histórico + histograma de reverts).
>
> Recomendação: instrumentar `ci.yml` para postar em `#deploys` (Slack) com timestamp do `merge`,
> `deploy.started`, `deploy.live` e `deploy.rollback` — usar webhook Render + Vercel.

## 3. Tactics — Cobertura no delta do SN

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Manage Deployment Pipeline — Script Deployment Commands** | `buildCommand` + `startCommand` + `preDeployCommand` versionados em `render.yaml`; job `tag-release` em `ci.yml` | ✅ presente | `render.yaml:18-21`, `ci.yml:48-73` |
| **Manage Deployment Pipeline — Scale Rollouts (canary / blue-green / rolling)** | Nenhum canário. Render `plan: starter` faz rolling deploy nativo sem porcentagem/canário. Vercel não pré-visualiza produção. | ❌ ausente | `render.yaml:10` |
| **Manage Deployment Pipeline — Rollback** | Kill-switch via `RECEBIMENTOS_ENABLED=false` (segundos, sem redeploy) + Render "Manual Deploy → previous commit". Não automatizado, não documentado. | ⚠️ parcial | `recebimentosGate.ts:14-22`, `DEPLOY.md` (sem seção "rollback") |
| **Manage Deployment Pipeline — Package Dependencies (reproducible builds)** | `npm ci` + lockfiles commitados (BE+FE), Node 24 pinned, `audit --audit-level=high` bloqueia merge | ✅ presente | `ci.yml:20-27,41-46`, lockfiles no repo |
| **Manage Deployment Pipeline — Test Deployment** | Job `Backend`/`Frontend` obrigatórios; sem ambiente pré-prod (não há staging Render/Vercel dedicado). Todo teste é local ao repo. | ⚠️ parcial | `ci.yml`, ausência de env de staging |
| **Manage Deployed System — Logical Grouping (feature toggles)** | `recebimentosGate` (BE 403) + `isRecebimentosEnabled` (FE redirect) — dupla barreira, fail-safe (prod bloqueia por default). SN nasce escondido atrás dessa flag. | ✅ presente | `recebimentosGate.ts`, `features.ts:24-29`, `page.tsx:59` |
| **Manage Deployed System — Physical Grouping** | BE isolado no Render (`financeiro-backend`), FE na Vercel, DB no Supabase — 3 hops independentes. | ✅ presente | `render.yaml:5-9`, `DEPLOY.md §1-3` |
| **Manage Deployed System — Surge Protection** | Rota `POST /solicitacao-numerario` usa `heavyRouteLimiter` + `requireRole('admin')` (não é gate de deploy, mas contém explosão pós-deploy). | ✅ presente | `src/backend/routes/recebimentos.ts:199-203` |
| **Manage Deployed System — Configure Behavior (env-var driven seam)** | ERP write path é `NotImplementedError` (501). Kill-switch de dado é a env var; nenhum código de produção pode chegar ao POST no Conexos. Reduz o blast-radius do deploy a zero até HAR/HML confirmarem `gcdCod`. | ✅ presente | `SolicitacaoNumerarioService.ts:117-121`, `NotImplementedError.ts:11-26`, `constants.ts:125-132` (`gcdCod: 0` placeholder) |
| **Manage Deployment Pipeline — Version Consistency (lockstep)** | Script `scripts/bump-version.ps1` mantém FE==BE em semver + `chore(release)`; `tag-release` cria `v0.17.6` idempotentemente. | ✅ presente | `bump-version.ps1:1-50`, `ci.yml:59-73`, `CHANGELOG.md` |
| **Manage Deployment Pipeline — Drift Detection (config)** | Blueprint declara chaves `sync: false` (12 no `render.yaml`), mas não há job periódico que compare o `render.yaml` vs. o dashboard. Operator pode zerar `RECEBIMENTOS_ENABLED` sem alerta. | ⚠️ parcial | `render.yaml:39-67`, sem cron/scheduled workflow |
| **Manage Deployment Pipeline — Terraform plan/apply gate** | N/A — não há `infra/` no repo. Deploy é Render blueprint + Vercel push. | N/A | CLAUDE.md §"Estado Atual vs. Alvo" |
| **Manage Deployment Pipeline — Per-tenant isolated state** | N/A — 0 tenants provisionados; ambiente single-tenant Columbia hoje. | N/A | `_shared-metrics.md:46` |
| **Manage Deployment Pipeline — Lambda versioning / alias** | N/A — runtime é Express (Render), não Lambda. Rollback via git commit anterior no Render. | N/A | `render.yaml:8-9`, CLAUDE.md |

## 4. Findings

### F-deployability-1: Rollback do SN não documentado (kill-switch existe, procedimento não)

- **Severidade**: P1 — o kill-switch está implementado (`RECEBIMENTOS_ENABLED=false` + `NotImplementedError` no seam de escrita), mas nenhum runbook mostra o passo-a-passo. Em incidente, o operador vai ler código.
- **Tactic violada**: Manage Deployment Pipeline — Rollback (procedural gap)
- **Localização**: `docs/runbooks/` (apenas `fin010-write-cutover.md`; nenhum runbook para SN/recebimentos)
- **Evidência (objetiva)**:
  ```
  $ ls docs/runbooks/
  fin010-write-cutover.md
  # Nenhum recebimentos-*.md nem sn-*.md
  ```
  O `DEPLOY.md` também não tem seção "Como reverter uma feature Frente IV" — só o setup inicial.
- **Impacto técnico**: Se o SN começar a corromper dados no ERP (quando o seam for cabeado no futuro) ou o dialog do FE quebrar UX, o operador precisa reconstruir por leitura de código o path: (1) dashboard Render → env → `RECEBIMENTOS_ENABLED=false`; (2) redeploy manual do commit anterior; (3) validar 403 em `/recebimentos/*`. Isso aumenta MTTR.
- **Impacto de negócio**: Cada minuto extra de MTTR em uma feature financeira = risco de reconciliação errada. Analista financeiro sem visibilidade sobre "como reverto se der errado".
- **Métrica de baseline**: 0 runbooks para Frente IV / SN vs. 1 alvo (comparável ao `fin010-write-cutover.md` da Frente I).

### F-deployability-2: Sem ambiente de pré-produção — teste do gate SN só em prod ou local

- **Severidade**: P1 — o `ci.yml` roda `test` mas não faz smoke test contra um Render/Vercel de staging. A primeira execução do `gerarSolicitacaoNumerarioSchema` end-to-end contra `heavyRouteLimiter + requireRole('admin')` acontece em prod.
- **Tactic violada**: Manage Deployment Pipeline — Test Deployment
- **Localização**: `.github/workflows/ci.yml`, `render.yaml` (branch única `main`)
- **Evidência (objetiva)**:
  ```
  render.yaml:11: branch: main
  ci.yml:6-7: on: push branches: [main, dev]  # dev não tem serviço Render próprio
  ```
  Não há `render-staging.yaml` nem serviço `financeiro-backend-staging`. `DEPLOY.md` só descreve a stack única.
- **Impacto técnico**: Bug no schema Zod / no middleware `heavyRouteLimiter` / na autz por-filial descoberto em prod. O fail-safe do gate (403 default em prod) mitiga o blast do SN especificamente — mas outras rotas do delta (ex.: `GET /transacoes/:txnId/processos`) rodam via `dev` para prod sem pré-verificação em ambiente semelhante ao real.
- **Impacto de negócio**: Aumenta o número de deploys "roll-forward" (fix→bump→redeploy) vs. "primeira tentativa verde". Baseline: sem métrica de sucesso de deploy (não medível localmente).
- **Métrica de baseline**: 0 ambientes pré-produção provisionados; 1 branch (`main`) alimenta o único slot Render.

### F-deployability-3: Sem canário/rollout gradual — 100% do tráfego expõe SN de uma vez quando a flag virar

- **Severidade**: P2 — quando o operador flippar `RECEBIMENTOS_ENABLED=true` (evento futuro), 100% dos usuários vêem o modal "Alocar" + botão "Processar" imediatamente. Não há como habilitar SN para 5% dos usuários ou uma filial-piloto.
- **Tactic violada**: Manage Deployment Pipeline — Scale Rollouts (Canary)
- **Localização**: `src/frontend/lib/features.ts:24-29`, `src/backend/domain/libs/environment/EnvironmentProvider.ts:47-53`
- **Evidência (objetiva)**:
  ```typescript
  // features.ts:24
  export const isRecebimentosEnabled = (): boolean => {
    const flag = process.env.NEXT_PUBLIC_RECEBIMENTOS_ENABLED
    if (flag === 'true') return true
    if (flag === 'false') return false
    return process.env.NEXT_PUBLIC_ENV === 'local'
  }
  ```
  Boolean global. Nenhuma dimensão de tenant/user/filial/percent. `Render plan: starter` não expõe traffic-splitting.
- **Impacto técnico**: Se o dialog `AlocarProcessosDialog.tsx` (240 LOC, novo) tiver regressão de UX, todos os analistas veem o problema simultaneamente. A mitigação atual é reverter a flag para todo mundo — não há rollback parcial.
- **Impacto de negócio**: Rollout "big-bang" de features financeiras não é aceitável a médio prazo. Para a Fase real (quando `gcdCod` for descoberto), a Columbia vai querer ligar a SN para 1 filial-piloto antes do rollout completo.
- **Métrica de baseline**: 0 dimensões de segmentação na flag; 1 boolean global. Alvo: pelo menos flag por `filCod`.

### F-deployability-4: Env vars `sync: false` — risco de drift silencioso entre blueprint e dashboard

- **Severidade**: P2 — 12 chaves em `render.yaml` estão com `sync: false` (incluindo `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`). O blueprint declara existência mas não valor. Se alguém apagar `RECEBIMENTOS_ENABLED` do dashboard, o `EnvironmentProvider` cai no default fail-safe (`environment !== 'production'` → `false` em prod, ok) — mas o drift em `CONEXOS_WRITE_ENABLED` já foi apontado como P0 no run passado.
- **Tactic violada**: Manage Deployment Pipeline — Drift Detection
- **Localização**: `render.yaml:39-67`
- **Evidência (objetiva)**:
  ```yaml
  - key: RECEBIMENTOS_ENABLED
    sync: false
  - key: CONEXOS_WRITE_ENABLED
    sync: false
  - key: CONEXOS_DRY_RUN
    sync: false
  # ... 9 outras
  ```
  Nenhum workflow em `.github/workflows/` compara `render.yaml` vs. o dashboard (`gh api ...` para Render não é usado).
- **Impacto técnico**: Um operador pode desligar acidentalmente `CONEXOS_DRY_RUN` (deixando writes reais em produção). Comentário no `render.yaml:41-43` já reconhece o problema ("Regis P0 deployability — yaml brigando com dashboard") mas a mitigação é convenção, não automação.
- **Impacto de negócio**: Compliance/auditoria — sem diff automático, uma mudança de env var em prod não deixa rastro no repo. Para uma feature financeira dry-run, isso é a diferença entre "simulou" e "gastou dinheiro real".
- **Métrica de baseline**: 12/12 chaves de negócio em `sync: false` sem drift detector; alvo: 1 workflow cron que faça `render env pull | diff` semanalmente e alerte.

### F-deployability-5: Bump de versão FE↔BE lockstep sem atomicidade cross-hop no deploy

- **Severidade**: P2 — `bump-version.ps1` garante que `src/backend/package.json` e `src/frontend/package.json` fecham no mesmo semver (ex.: `0.17.6`), e a `tag-release` só marca 1 tag por push. Mas Render (BE) e Vercel (FE) são **serviços independentes**; após o commit `chore(release): v0.17.6`, os dois auto-deployam em paralelo sem coordenação. Se o BE terminar em 3 min e o FE em 7 min, existe uma janela de 4 min onde o FE chama uma API que ainda não existe (ou vice-versa).
- **Tactic violada**: Manage Deployment Pipeline — Version Consistency (deploy-time)
- **Localização**: `render.yaml:5-17` + Vercel (external), `scripts/bump-version.ps1`
- **Evidência (objetiva)**:
  ```
  Render: autoDeploy: true, branch: main
  Vercel: auto-deploy on push to main (config no dashboard, fora do repo)
  Nenhum job coordena a ordem BE→FE ou FE→BE.
  ```
  O SN adiciona `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` (nova rota) usada pelo `AlocarProcessosDialog.tsx` (novo). Se o FE deployar primeiro (rota chamada não existe) → toast de erro. Se o BE deployar primeiro (rota nova sem consumidor) → benigno.
- **Impacto técnico**: Feature nova mais frágil no primeiro momento após bump. Mitigado neste delta pelo `recebimentosGate` (403 para todo mundo até o flip explícito da flag) — mas a atomicidade cross-hop segue sendo estrutural.
- **Impacto de negócio**: Percepção do analista financeiro de "sistema instável nos deploys". Baseline não medível localmente.
- **Métrica de baseline**: 2 serviços auto-deploy independentes, 0 coordenação. Alvo: BE deploy → smoke `/health` (com version) → só então trigger do Vercel.

## 5. Cards Kanban

### [deployability-1] Escrever runbook de rollback da Frente IV / SN

- **Problema**
  > Existe o kill-switch (`RECEBIMENTOS_ENABLED=false` + `NotImplementedError` em `enviarAoErp`), mas nenhum runbook em `docs/runbooks/` descreve o procedimento passo-a-passo. Em um incidente, o operador precisa ler código para saber como reverter. O `fin010-write-cutover.md` já existe para a Frente I e é o modelo canônico.

- **Melhoria Proposta**
  > Criar `docs/runbooks/recebimentos-sn-kill-switch.md` seguindo o template do `fin010-write-cutover.md`. Documentar: (a) como flipar `RECEBIMENTOS_ENABLED=false` no Render dashboard; (b) como validar que `/recebimentos/*` responde 403 (curl + status code esperado); (c) quando redeployar commit anterior no Render vs. só desligar a flag; (d) como validar que `enviarAoErp` continua isolado (busca por `NotImplementedError` nos logs). Alvo Bass: Rollback + Configure Behavior.

- **Resultado Esperado**
  > Operador executa rollback em ≤ 3 min sem precisar ler código-fonte. Baseline: 0 runbooks Frente IV → 1 runbook `recebimentos-sn-kill-switch.md` referenciado no `DEPLOY.md §Rollback`.

- **Tactic alvo**: Manage Deployment Pipeline — Rollback
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Runbooks Frente IV: 0 → 1
  - Passos manuais fora-do-runbook para reverter SN: ~5 (leitura de código + inferência) → 0 (todos no runbook)
- **Risco de não fazer**: Em 6 meses (quando o `gcdCod` for descoberto e o seam for cabeado), um incidente de escrita indevida no Conexos vai ter MTTR alto — operador reconstruindo o path enquanto o ERP acumula lançamentos ruins.
- **Dependências**: nenhuma (independente).

### [deployability-2] Provisionar ambiente de staging (Render + Vercel) para smoke test pré-prod

- **Problema**
  > O `ci.yml` só roda `typecheck/lint/test/build` em CI; a primeira execução real de `POST /solicitacao-numerario` (com Zod + `heavyRouteLimiter` + `requireRole('admin')` + `assertUserCanActOnFilial`) contra HTTP verdadeiro acontece em produção. Sem ambiente pré-prod, cada deploy é a "primeira execução real" da rota.

- **Melhoria Proposta**
  > Criar `render-staging.yaml` (serviço `financeiro-backend-staging`, branch `dev`, `plan: starter`, DB Supabase separado) + projeto Vercel staging apontando para `dev`. Adicionar job `smoke-staging` no `ci.yml` (após `backend`/`frontend`, antes do merge em `main`) que faz `curl` em `GET /health` do staging e valida version + status. Alvo Bass: Test Deployment.

- **Resultado Esperado**
  > 100% dos deploys em `main` passaram por staging equivalente. Baseline: 0 ambientes → 1 ambiente staging + 1 smoke job na CI. Reduz roll-forward fixes em prod.

- **Tactic alvo**: Manage Deployment Pipeline — Test Deployment
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — provisionar Render + Vercel + Supabase e cabear as vars
- **Findings relacionados**: F-deployability-2, F-deployability-5
- **Métricas de sucesso**:
  - Ambientes pré-prod: 0 → 1
  - % deploys com smoke test verde antes de prod: 0% → 100%
- **Risco de não fazer**: Cada deploy da Frente IV (e das outras frentes) continua sendo experimento em produção. Regressões de UX/API descobertas por analista financeiro real, não por CI.
- **Dependências**: definir dono do custo do serviço extra Render + DB Supabase de staging.

### [deployability-3] Segmentar a flag `RECEBIMENTOS_ENABLED` por `filCod` (canário por filial)

- **Problema**
  > Hoje `isRecebimentosEnabled()` (FE) e `recebimentosGate` (BE) são booleans globais. Quando a SN for liberada, 100% dos analistas de todas as filiais veem o modal "Alocar" + "Processar" simultaneamente. Não há rollout parcial nem filial-piloto.

- **Melhoria Proposta**
  > Evoluir o gate para aceitar uma lista de filiais habilitadas: `RECEBIMENTOS_ENABLED_FILCOD=2,7,15` (ou tri-state `all|list|none`). Atualizar `EnvironmentProvider.resolveRecebimentosEnabled` para retornar `{ enabled: true, allowedFilCods: Set<number> }`, `recebimentosGate` para cruzar com o `filCod` do request (query/body/user), e `isRecebimentosEnabled(filCod?)` no FE para esconder o botão nas filiais não incluídas. Alvo Bass: Scale Rollouts (Canary).

- **Resultado Esperado**
  > Rollout controlado da SN por filial. Baseline: 1 dimensão de segmentação (env global) → 2 dimensões (env + `filCod`). Enables "liga em Santos primeiro por 1 semana, depois liga o resto".

- **Tactic alvo**: Manage Deployment Pipeline — Scale Rollouts (Canary)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — código + testes de gate + docs no `DEPLOY.md`
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Dimensões de segmentação da flag: 1 (global) → 2 (global + `filCod`)
  - Filial-piloto para primeiro rollout da SN: 0 → 1 (definida no runbook)
- **Risco de não fazer**: Big-bang rollout da SN quando o `gcdCod` for descoberto. Se o payload tiver bug em uma filial específica, o incidente afeta todas ao mesmo tempo.
- **Dependências**: [deployability-1] (runbook) deve documentar a semântica da nova flag.

### [deployability-4] Drift detector semanal para env vars `sync: false` no Render

- **Problema**
  > 12 chaves em `render.yaml` estão em `sync: false` (incluindo `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN` — todas críticas). O blueprint declara existência mas não valor. Uma mudança acidental no dashboard não deixa rastro no repo, e o `render.yaml` já comenta "Regis P0 deployability — yaml brigando com dashboard".

- **Melhoria Proposta**
  > Criar `.github/workflows/env-drift.yml` (cron semanal) que usa a Render API (`GET /services/{id}/env-vars`) para exportar as vars atuais e comparar com uma snapshot em `infra/render-env-baseline.json` (commitado). Alerta Slack `#deploys` quando houver diff, especialmente em `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`. Alvo Bass: Drift Detection.

- **Resultado Esperado**
  > Mudanças de env em prod deixam rastro auditável em ≤ 7 dias. Baseline: 0 alertas de drift → cron semanal + baseline versionado. Compliance-friendly.

- **Tactic alvo**: Manage Deployment Pipeline — Drift Detection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Vars monitoradas contra drift: 0 → 12
  - Tempo até detecção de drift: ∞ → ≤ 7 dias
- **Risco de não fazer**: Um operador desliga `CONEXOS_DRY_RUN` sem PR e sem log. Semanas depois, alguém audita e não sabe quando/por que. Para o SN, quando o seam for cabeado, esse tipo de flip cego é o vetor de incidente mais provável.
- **Dependências**: [deployability-1] (runbook precisa referenciar a baseline).

### [deployability-5] Coordenar deploy BE→FE (ordem determinística com smoke)

- **Problema**
  > BE (Render) e FE (Vercel) auto-deployam em paralelo após o commit `chore(release)`. Em uma janela de ~4 min pode existir dessincronia: FE já servindo o novo dialog `AlocarProcessosDialog` que chama `POST /solicitacao-numerario` enquanto o BE ainda serve o binário antigo (rota 404). Mitigado hoje pelo `recebimentosGate` (403 default), mas estrutural.

- **Melhoria Proposta**
  > Adicionar job `wait-backend-then-trigger-frontend` no `ci.yml` (após `tag-release`): (a) polling `GET /health` do Render até `version == package.json.version` (timeout 10 min); (b) só então dispara o deploy Vercel via API (`vercel deploy --prod` ou webhook). Desligar auto-deploy do Vercel no push, mover o trigger para o CI. Alvo Bass: Version Consistency at deploy time.

- **Resultado Esperado**
  > FE nunca vai ao ar antes do BE compatível. Baseline: janela BE↔FE de até ~5 min → 0s (FE só sobe após BE `/health` bater a versão). Reduz "flash de 404" pós-deploy.

- **Tactic alvo**: Manage Deployment Pipeline — Version Consistency
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — CI wiring + Vercel API token + trocar o modo de deploy Vercel
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Janela de dessincronia FE/BE: até ~5 min → 0s (deterministicamente ordenado)
  - Deploys com FE ahead of BE: eventual → 0
- **Risco de não fazer**: Cada nova rota introduzida no BE que o FE consome (o SN é exemplo) tem uma janela de "toast vermelho para o analista" no primeiro momento pós-deploy.
- **Dependências**: [deployability-2] (staging permite testar o wiring da coordenação antes de prod).

## 6. Notas do agente

- Escopo interpretado: avaliei o pipeline REAL (Render + Vercel + Supabase + `ci.yml`), não o alvo Lambda + Terraform. Todas as tactics de IaC/Terraform (per-tenant state, `terraform plan` gate, Lambda alias) → `N/A (sem infra/ — Render hoje)`.
- O delta do SN é **excepcionalmente seguro por design**: `NotImplementedError` no `enviarAoErp` + `gcdCod: 0` placeholder + `dryRun: true` sempre + `recebimentosGate` fail-safe em prod = 4 camadas de proteção. Isso puxou o score para 8 (o "big red button" existe e é irreversível por design).
- **Cross-QA alerts para o consolidator:**
  - **Modifiability / Security:** F-deployability-4 (drift de `CONEXOS_DRY_RUN`, `CONEXOS_WRITE_ENABLED`) sobrepõe Security (write-enable acidental) e Modifiability (mudança de comportamento sem PR).
  - **Testability:** F-deployability-2 (ausência de staging) reflete falta de ambiente para testes end-to-end HTTP — provavelmente também é achado do qa-testability.
  - **Availability:** F-deployability-5 (dessincronia BE/FE) impacta MTTR percebido pelo analista — cross-check com qa-availability.
