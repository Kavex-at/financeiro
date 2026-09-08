---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-deployability
generated_at: 2026-09-03T19:17:00Z
scope: frontend
score: 6.0
findings_count: 5
cards_count: 5
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev abre PR com mudança de frontend (ex.: nova página, novo hook do Next 16) | Merge em `main` dispara auto-deploy Vercel | `src/frontend/` (Next.js estático) + workflow `.github/workflows/ci.yml` (job `frontend`) | PR em revisão → main após merge → produção Vercel | Gate no PR deve rodar todo comando cujo sucesso é pré-requisito de produção (`typecheck`, `lint`, `test`, **`build`**); rollback disponível em ≤ 1 clique se produção quebrar | Nenhuma janela em que `main` tem build quebrado; MTTR de deploy quebrado ≤ 5min via rollback Vercel |

Contexto do delta: `moldura-navegacao` é frontend puro (5 componentes + 4 suítes de teste + 2 fixes de null-safety em `login/page.tsx:23` e `RouteGate.tsx:21`). Os fixes de null-safety eram **pré-existentes na `main`** — o `next build` estava quebrado antes deste delta e nenhum gate acusou; a autora só descobriu ao rodar `npm run build` local. Este QA avalia o *pipeline* que deixou isso acontecer.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados no PR gate (frontend) | 4 (`npm ci` + `typecheck` + `lint` + `test`) | ≥ 5 (incluir `build`) | ❌ | `.github/workflows/ci.yml:30-46` |
| `next build` executado no PR do GitHub | ❌ ausente | presente | ❌ | `grep -n "build" .github/workflows/ci.yml` → única ocorrência é `line 28` (job **backend**) |
| Hazards de tipagem Next 16 (`usePathname()` / `useSearchParams()` sem null-safety) restantes em `src/frontend/` | 4 usos (raw pathname passado a helper: `sidebar.tsx:343`, `bottom-nav.tsx:73`; comparação/fallback seguro: `AppShell.tsx:251`, `SessionExpiredModal.tsx:34`) | 0 usos raw | ⚠️ | `grep -rn "usePathname\\|useSearchParams" src/frontend/ --include="*.tsx"` |
| LOC de fonte introduzido pelo delta (5 componentes) sem feature flag / kill-switch | 1266 LOC | ≥ 1 kill-switch ou rota canary | ❌ | `grep -n "FEATURE_\\|NEXT_PUBLIC_FEATURE\\|has_" src/frontend/components/AppShell.tsx src/frontend/components/nav/app-nav.tsx` → 0 |
| Tempo de build frontend (local, `next build` full) | ≤ 30s (compila + prerenderiza 12 rotas HTML) | ≤ 60s | ✅ | `_shared-metrics.md` §Gates |
| Tamanho do output `.next/` | 16 MB (`.next/static` 1,9 MB) | ≤ 30 MB para static export tamanho compatível com CDN Vercel | ✅ | `du -sh src/frontend/.next` |
| Cobertura de testes (linhas) — todo frontend, após delta | 38,19% | ≥ 20% (threshold `jest.config.js`) | ✅ | `_shared-metrics.md` §Cobertura |
| Cobertura dos 5 arquivos do delta (linhas médias) | ~93% | ≥ 80% | ✅ | `_shared-metrics.md` §Cobertura |
| Idempotência de deploy (tag GitHub reutilizada) | ✅ presente | presente | ✅ | `.github/workflows/ci.yml:66-72` (tag skip if exists) |
| Rollback documentado para frontend | ❌ ausente (`DEPLOY.md` §3 não menciona rollback Vercel) | rollback ≤ 1 click documentado | ❌ | `grep -in "rollback" DEPLOY.md` → 0 hits |
| Preview build Vercel afixado como required check no PR | ⚠️ **Não medível localmente** — configuração vive em branch protection do GitHub + integração Vercel-GitHub | required check presente | ⚠️ | requer `gh api repos/:owner/:repo/branches/main/protection` |
| Drift detection do frontend (config Vercel vs `render.yaml`/repo) | N/A frontend não tem blueprint versionado | — | N/A | Vercel: config manual no dashboard |
| IaC / Terraform (`infra/`, tfvars, tenants) | ⚠️ **Não medível — N/A** | — | N/A | `ls infra/` → não existe; CLAUDE.md §Estado Atual vs. Alvo declara deploy via Render+Vercel, sem Terraform |
| Métricas de Lambda (bundle size, cold start, versionamento) | ⚠️ **Não medível — N/A** | — | N/A | Não há Lambda no estado atual (Express em Render); e delta é frontend puro |

> ⚠️ **Não medível localmente**: se o webhook Vercel-GitHub está publicando a check `Vercel/Deployment` como *required* na proteção do `main`. Sem esse dado, é impossível saber se a fila de PRs efetivamente barra um `next build` quebrado. Recomendação: `gh api repos/kavex-clonex/financeiro/branches/main/protection --jq '.required_status_checks.contexts'` e anexar à `DEPLOY.md`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary / blue-green / rolling) | Vercel faz **atomic deploy** (blue-green implícito por promoção de build); nenhum rollout progressivo em rota nova. A moldura de navegação sai 100% para todos os usuários no primeiro deploy — não há rota `beta` nem `NEXT_PUBLIC_NEW_NAV_ENABLED`. | ⚠️ parcial | Vercel default; `src/frontend/components/AppShell.tsx` sem flag |
| **Rollback** | Vercel "Instant Rollback" existe nativamente (promover deploy anterior no dashboard). **Não documentado** em `DEPLOY.md`; runbook ausente. | ⚠️ parcial | `grep -in rollback DEPLOY.md` → 0 |
| **Script Deployment Commands** | `render.yaml` (backend) parametriza build/pre-deploy. Frontend: Vercel usa auto-detect Next.js (sem `vercel.json` versionado). Bump de versão via `scripts/bump-version.ps1` (PowerShell only — não roda nesta máquina Linux; ver MEMORY §bump-version-sem-pwsh). | ⚠️ parcial | `render.yaml`; `ls src/frontend/vercel.json` → não existe |
| **Logical Grouping** | Frontend agrupado por rota Next (App Router) + componentes por camada (`components/ui`, `components/nav`, `components/auth`). Delta segue a convenção. | ✅ presente | `src/frontend/components/{ui,nav,auth}/` |
| **Physical Grouping** | Um único artefato Vercel (bundle Next); nenhum split por tenant (mono-tenant por natureza — a Columbia é o único cliente do frontend). | N/A | delta não introduz múltiplos artefatos |
| **Package Dependencies** | `package-lock.json` versionado (`src/frontend/package-lock.json`). Next fixado `^16.2.7`, React `19.2.0` (exato). `npm ci` no CI garante reprodutibilidade. | ✅ presente | `src/frontend/package.json`; `.github/workflows/ci.yml:43` |
| **Surge Protection** | Frontend estático em CDN Vercel absorve surge naturalmente; N/A no nível de aplicação. | N/A | static export + CDN |
| **Idempotent Deploys** | Tag-release job só cria tag/release se ainda não existe (`.github/workflows/ci.yml:66-72`). Vercel deploy é idempotente por commit SHA. | ✅ presente | ci.yml |
| **Drift Detection** | Sem job periódico que rode `next build` fora do PR. Nenhum monitor de que a config Vercel (env vars como `NEXT_PUBLIC_API_URL`) esteja de acordo com o esperado. | ❌ ausente | nenhum workflow scheduled |
| **Reproducible Builds** | Lockfile ✅; Node 24 fixado no CI ✅; `next.config.mjs` vazio (nenhuma diretiva não determinística) ✅. Falta: pinar `NEXT_TELEMETRY_DISABLED=1` no CI (evita rede opcional). | ⚠️ parcial | `.github/workflows/ci.yml:19` |
| **Per-tenant Blast-radius Limit** | N/A — frontend é mono-tenant (Columbia). Nenhum tenant no estado atual. | N/A | CLAUDE.md §Tenants |
| **Deployment Observability** | Nenhum job de smoke-test pós-deploy contra Vercel URL. Erro só aparece quando um usuário abre a rota. Nenhum ping automatizado a `/login`, `/`, `/sispag`. | ❌ ausente | `.github/workflows/*.yml` sem step de curl pós-deploy |

## 4. Findings (achados)

### F-deployability-1: Job `frontend` do CI **não roda `next build`** — janela de main quebrada passou despercebida

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands + Deployment Observability
- **Localização**: `.github/workflows/ci.yml:30-46` (job `frontend`)
- **Evidência (objetiva)**:
  ```yaml
  # linhas 30-46 (job frontend):
  - run: npm ci
  - run: npm run typecheck
  - run: npm run lint
  - run: npm test -- --coverage
  # ← ausente: `- run: npm run build`
  # o job backend (linha 28) roda `npm run build`; o frontend não.
  ```
  Consequência medida: o `main` tinha `next build` quebrado antes deste delta com dois erros de tipo (`app/login/page.tsx:23` e `components/auth/RouteGate.tsx:21`, ambos `usePathname()`/`useSearchParams()` retornando `null` sob Next 16). O `tsc --noEmit` do `npm run typecheck` **não pega** esses erros porque não carrega os tipos gerados de rota do Next (`.next/types/**`). Os fixes vieram no próprio commit `05606a6` desta feature, mas o **buraco de gate permanece**.
- **Impacto técnico**: qualquer PR que introduza a mesma classe de erro (Next 16 tipos nullable, uso raw de hook do App Router, erro em `generateStaticParams`, RSC violation) passa nos 4 checks do PR e vira commit em `main`. O `next build` só executa (a) manualmente em worktree local ou (b) na Vercel após merge — quando já é tarde: `main` está quebrada, deploy Vercel falha, produção fica na versão anterior (silenciosamente, se ninguém olhar o dashboard Vercel).
- **Impacto de negócio**: janela entre merge e "alguém percebe que Vercel está preso" é de horas a dias. Todo PR seguinte fica bloqueado (rebase sobre `main` quebrada). O compromisso "só código testado vai a produção" declarado em `render.yaml:16-17` fica falso para o caminho frontend.
- **Métrica de baseline**: **0 execuções** de `next build` no pipeline PR (`grep -n "build" .github/workflows/ci.yml` → única ocorrência é linha 28, job backend); janela de main quebrada demonstrada empiricamente neste ciclo (2 erros pré-existentes só saltaram no `npm run build` local do worktree, ver `_shared-metrics.md`).

### F-deployability-2: 4 usos raw de `usePathname()` sobreviveram ao delta — mesma classe de bug pode reincidir

- **Severidade**: P2
- **Tactic violada**: Reproducible Builds (o typecheck local diverge do build de produção)
- **Localização**: `src/frontend/components/AppShell.tsx:251`, `src/frontend/components/ui/sidebar.tsx:343`, `src/frontend/components/ui/bottom-nav.tsx:73`, `src/frontend/components/auth/SessionExpiredModal.tsx:34`
- **Evidência (objetiva)**:
  ```tsx
  // sidebar.tsx:343 — pathname (nullable) passado direto a helper
  const pathname = usePathname()
  const derivedActiveId = React.useMemo(
      () => resolveActiveItemId(resolvedGroups, pathname),
      [resolvedGroups, pathname],
  )
  // idem bottom-nav.tsx:73
  ```
  Dois dos quatro (AppShell, SessionExpiredModal) fazem comparação/`|| '/'` e são seguros; os outros dois passam `pathname` (tipo `string | null`) a `resolveActiveItemId(...)` — se o helper aceita `string | null`, ok; se aceita só `string`, quebra o build. **Não conferido** no escopo `--quick`.
- **Impacto técnico**: cada novo componente que chame `usePathname()` sem `?? ''` (padrão adotado só em `RouteGate.tsx:21`) é um roleta russa contra o `next build`. Sem gate no PR (F-deployability-1) o autor só descobre em produção.
- **Impacto de negócio**: dev-experience piora — a autora do próximo delta paga o mesmo custo de investigação que a autora deste pagou.
- **Métrica de baseline**: **4** usos raw (0 seria o alvo); dos 4, **2** passam nullable direto para outra função (`sidebar.tsx:343`, `bottom-nav.tsx:73`).

### F-deployability-3: Rollback do frontend não documentado — MTTR de deploy quebrado é imprevisível

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `DEPLOY.md` §3 (Vercel)
- **Evidência (objetiva)**:
  ```
  $ grep -in "rollback" DEPLOY.md
  # (vazio)
  $ grep -in "rollback" src/frontend/README.md 2>/dev/null
  # (vazio)
  ```
  Vercel oferece "Instant Rollback" nativamente (promover deploy anterior em ≤ 3 cliques), mas nenhum runbook aponta isso. Quem estiver de plantão às 2h da manhã e vir a moldura de navegação quebrada não sabe onde clicar.
- **Impacto técnico**: MTTR de bug frontend em produção depende de conhecimento tácito de quem sabe usar o dashboard Vercel; não há garantia de que o operador (`ontology/state-machines/*` referenciam "analista da Columbia") consiga rollback sem escalonar para engenharia.
- **Impacto de negócio**: em incidente, minutos extras de indisponibilidade da UI. Este delta introduz **1266 LOC** de nova UI sem flag — se algo nela derrubar a home, o custo é 100% dos usuários.
- **Métrica de baseline**: **0 runbooks** de rollback frontend (`ls docs/runbooks/*rollback* 2>/dev/null` → vazio; `grep -in rollback DEPLOY.md` → 0).

### F-deployability-4: Moldura de navegação sai para 100% no primeiro deploy — sem kill-switch nem canary

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts (canary / feature flag)
- **Localização**: `src/frontend/components/AppShell.tsx`, `src/frontend/components/nav/app-nav.tsx`
- **Evidência (objetiva)**:
  ```
  $ grep -nE "FEATURE_|NEXT_PUBLIC_FEATURE|has_" \
      src/frontend/components/AppShell.tsx \
      src/frontend/components/nav/app-nav.tsx
  # (vazio)
  ```
  A nova sidebar/bottom-nav substitui o header antigo (47 LOC → 297 LOC no `AppShell`) para **todo usuário no primeiro carregamento pós-deploy**. Contrastar com backend: `SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED` (all em `render.yaml`) já demonstram que o time domina o padrão de kill-switch por env — mas o padrão parou no backend.
- **Impacto técnico**: um regresso visual/funcional na navegação (ex.: badge quebrado, colapso persistindo em estado inválido em `localStorage:ds:sidebar:collapsed:v1`) exige rollback do deploy inteiro; não dá para desligar só a moldura.
- **Impacto de negócio**: baixo hoje (usuário único: Columbia, uso interno), mas é uma das primeiras superfícies que todo analista vê ao logar. Regresso aqui bloqueia todo o trabalho.
- **Métrica de baseline**: **0** flags gate a moldura (backend tem **≥ 3** kill-switches equivalentes em `render.yaml`).

### F-deployability-5: Sem smoke-test pós-deploy — sucesso de deploy é medido por "não deu erro no dashboard"

- **Severidade**: P3
- **Tactic violada**: Deployment Observability
- **Localização**: todos os workflows (`.github/workflows/*.yml`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "curl\|smoke\|healthcheck" .github/workflows/
  # (vazio)
  ```
  Nenhum job faz GET em `https://<app>.vercel.app/login` (ou `/`) após o deploy para confirmar que a página responde 200 e contém marcadores da nova moldura (`role="navigation"`, `aria-current`). O único health check é o do backend (`healthCheckPath: /health` em `render.yaml:22`).
- **Impacto técnico**: build Vercel pode passar (compila) e a página em runtime pode explodir por RSC/hydration issue — ninguém sabe até um usuário reclamar.
- **Impacto de negócio**: janela entre deploy e primeiro usuário afetado é a "detecção reativa"; poderia ser detecção automática em ≤ 60s com um curl.
- **Métrica de baseline**: **0** smoke-tests pós-deploy no repo.

## 5. Cards Kanban

### [deployability-1] Adicionar `next build` ao job `frontend` do CI

- **Problema**
  > O job `frontend` do `.github/workflows/ci.yml` (linhas 30-46) roda `typecheck`, `lint`, `test`, mas **não** roda `next build`. Consequência medida neste ciclo: `main` tinha `next build` quebrado por 2 erros de tipagem Next 16 (`app/login/page.tsx:23`, `components/auth/RouteGate.tsx:21`) que o `tsc --noEmit` não pega — só o `next build` pega. Zero gate acusou; a autora do delta descobriu ao rodar `npm run build` local.

- **Melhoria Proposta**
  > Adicionar `- run: npm run build` ao final do job `frontend` (após `npm test`). Considerar também `NEXT_TELEMETRY_DISABLED: '1'` como env no step para evitar dependência de rede opcional. Se o tempo do CI virar problema (build local = ≤30s; CI provavelmente ≤2min), cachear `.next/cache`. Tactic Bass: **Script Deployment Commands** (paridade com o job backend, que já roda `npm run build`).

- **Resultado Esperado**
  > Todo PR que quebrar `next build` falha no check `Frontend` antes de merge. Zero janela de `main` broken build. Backend e frontend com gates simétricos.

- **Tactic alvo**: Script Deployment Commands / Deployment Observability
- **Severidade**: P1
- **Esforço estimado**: S (≤1h — 3 linhas de YAML)
- **Findings relacionados**: F-deployability-1, F-deployability-2
- **Métricas de sucesso**:
  - Passos automatizados no PR gate (frontend): 4 → 5
  - `next build` executado no PR: ❌ → ✅
  - Nº de deploys Vercel que falham após merge por causa de erro de build: baseline ~1 neste ciclo → 0
- **Risco de não fazer**: em 6 meses, esta mesma classe de bug (hook nullable Next 16, RSC violation, `generateStaticParams` quebrado) reincide — provavelmente durante uma feature de outra frente (SISPAG ou Recebimentos), afetando release lockstep FE+BE.
- **Dependências**: nenhuma

### [deployability-2] Estreitar `usePathname()` na fonte — helper `useSafePathname()` ou lint rule

- **Problema**
  > 4 usos raw de `usePathname()` no frontend após o delta; 2 deles passam `string | null` direto para funções (`sidebar.tsx:343`, `bottom-nav.tsx:73`) — mesma pegadinha que quebrou `RouteGate.tsx:21` na `main`. Sem gate de build (ver deployability-1) e sem padrão único, cada novo componente é uma chance de recriar o bug.

- **Melhoria Proposta**
  > Criar `src/frontend/lib/nav/useSafePathname.ts` que encapsula `usePathname() ?? ''` e substituir os 4 usos raw; adicionar regra ESLint `no-restricted-imports` que barra `import { usePathname } from 'next/navigation'` fora deste helper. Tactic Bass: **Reproducible Builds** (elimina divergência entre `tsc --noEmit` e `next build`).

- **Resultado Esperado**
  > 0 usos raw de `usePathname()` fora do helper; o bug de null-pathname é impossível por construção.

- **Tactic alvo**: Reproducible Builds
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Usos raw de `usePathname()` em `src/frontend/`: 4 → 0
  - Regra ESLint `no-restricted-imports` para `usePathname` fora do helper: ausente → presente
- **Risco de não fazer**: cada novo componente de navegação/roteamento (o roadmap de 4 frentes garante que virão) reintroduz o risco.
- **Dependências**: preferível fazer depois de [deployability-1] para que o `next build` no CI valide a substituição.

### [deployability-3] Runbook curto de rollback do frontend em `DEPLOY.md`

- **Problema**
  > Nenhum runbook documenta como reverter um deploy do frontend na Vercel. A funcionalidade existe (Vercel "Instant Rollback"), mas quem está de plantão às 2h da manhã não sabe onde clicar. Este delta introduz 1266 LOC de nova UI em superfície crítica (moldura navegacional) — se ela quebrar, o custo do atraso é a UI toda indisponível.

- **Melhoria Proposta**
  > Adicionar seção "Rollback" em `DEPLOY.md` §3 (Vercel) com: (a) URL do dashboard Vercel do projeto; (b) print/screenshot da tela de deployments; (c) 3-passos "Promote to Production" do deploy anterior; (d) tempo típico (< 2min); (e) quando escalar vs. rollback (regra simples: bug visual bloqueando fluxo = rollback imediato). Tactic Bass: **Rollback**.

- **Resultado Esperado**
  > MTTR de bug frontend em produção mensurável e determinístico (≤ 5 min de decisão + 2 min de rollback), sem dependência de conhecimento tácito.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤2h)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Runbooks de rollback frontend: 0 → 1
  - `grep -in rollback DEPLOY.md`: 0 → ≥ 1
- **Risco de não fazer**: primeiro incidente na moldura de navegação vira ping para engenharia — perde-se a autonomia operacional que o design system tenta habilitar.
- **Dependências**: nenhuma

### [deployability-4] Smoke-test pós-deploy contra a URL da Vercel

- **Problema**
  > Nenhum workflow roda `curl` contra `https://<app>.vercel.app/login` (ou `/`) após o deploy para confirmar que a página responde 200 e contém marcadores mínimos (`role="navigation"`, `aria-current`). Deploy verde no Vercel ≠ página funcional. Detecção hoje é 100% reativa (usuário reclama).

- **Melhoria Proposta**
  > Novo workflow `.github/workflows/frontend-smoke.yml` disparado por `workflow_run` do CI ou por `deployment_status: success`. Steps: `curl -sf https://<vercel-url>/login | grep -q 'role="navigation"'` e um segundo curl em `/`. Tactic Bass: **Deployment Observability**.

- **Resultado Esperado**
  > Detecção automática ≤ 60s pós-deploy se a rota `/login` retornar 500 ou HTML sem a moldura. Alarme (issue automática ou notificação) sem depender do olho humano no dashboard Vercel.

- **Tactic alvo**: Deployment Observability
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Smoke-tests pós-deploy: 0 → ≥ 2 (rota pública `/login` + rota autenticada com bypass)
  - Tempo médio de detecção de deploy quebrado: reativo (horas) → ≤ 60s
- **Risco de não fazer**: baixo hoje (usuário interno único), mas cresce à medida que outros clientes chegam (roadmap SaaSo em CLAUDE.md).
- **Dependências**: idealmente após [deployability-1] para reduzir ruído (se o build fica verde, o smoke deve ficar verde).

### [deployability-5] Kill-switch env `NEXT_PUBLIC_NEW_NAV_ENABLED` como padrão de rollback lógico

- **Problema**
  > Moldura de navegação (5 componentes, 1266 LOC) sai para 100% dos usuários no primeiro deploy. Regresso exige rollback do deploy inteiro. O time já domina o padrão de kill-switch por env no backend (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED` em `render.yaml`) — a prática não atravessou para o frontend.

- **Melhoria Proposta**
  > Envolver `<AppNav />` em `AppShell.tsx` num guarda `process.env.NEXT_PUBLIC_NEW_NAV_ENABLED !== 'false'` (fail-open: default habilitado; setar `false` na Vercel derruba a nova nav sem redeploy). Manter fallback ao header antigo (o commit tem os 47 LOC originais no diff) por 2 sprints; remover depois. Tactic Bass: **Scale Rollouts** (kill-switch como forma degenerada de canary).

- **Resultado Esperado**
  > Regresso na nova moldura pode ser desligado em ≤ 30s via dashboard Vercel, sem redeploy, sem depender de rollback de artefato.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Flags gate a moldura de navegação: 0 → 1
  - Tempo para desligar a moldura em emergência: rollback de deploy (~5min) → toggle env (~30s)
- **Risco de não fazer**: baixo. É melhoria de padrão; a moldura em si é bem testada (93% cobertura média).
- **Dependências**: nenhuma. Alinhado com o padrão que o backend já usa.

## 6. Notas do agente

- **Escopo `frontend` respeitado**: não avaliei `render.yaml` além de citá-lo como padrão de referência (kill-switches). Métricas de Terraform/Lambda declaradas **N/A com justificativa** (não existe `infra/`; CLAUDE.md §Estado Atual vs. Alvo).
- **Baseline empírico do F-deployability-1**: a evidência mais forte é o próprio delta — 2 erros de build pré-existentes na `main` só apareceram quando alguém rodou `next build` local. O gate deixou passar; o custo virou parte do trabalho desta feature. É o achado mais defensável do QA e por isso o único P1.
- **Não medi** se a Vercel-GitHub App está com `Vercel/Deployment` como required check no `main` (requer `gh api` com token de admin). Se estiver, mitiga parcialmente F-deployability-1, mas não resolve — porque o feedback ainda chega **depois** dos 4 checks nativos, e um autor apressado pode achar que "verde é verde".
- **Cross-QA para o consolidator**:
  - F-deployability-2 (usos raw de `usePathname()`) conversa com **Modifiability** (padrão inconsistente entre componentes) e **Testability** (cada uso é uma chance de teste omisso).
  - F-deployability-4 (sem kill-switch) conversa com **Availability** (blast-radius de UI regression = 100%) e com **Security** (o padrão de kill-switch backend já foi motivado por Regis anterior — ver `render.yaml:44` sobre o kill-switch da Frente IV).
  - F-deployability-1 é raiz; findings de **Performance** sobre `next build` demorado ou **Testability** sobre falta de teste de integração vão referenciar este mesmo buraco.
