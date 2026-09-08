---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-08-1834
agent: qa-deployability
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 7.5
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Engenheiro promovendo commit `27023a9` para `main` | Push aciona GitHub Actions (`ci.yml`) e, em seguida, o build automático da Vercel para o frontend | `src/frontend/lib/api.ts` + `lib/features.ts` (novo `assertDemoEnv()` crash-on-import) e variável `NEXT_PUBLIC_DEMO_MODE` embutida no bundle Next | Deploy contínuo para o preview/prd na Vercel (SaaSo, um cliente-piloto Columbia; sem tenants provisionados) | Build da Vercel deve falhar ruidosamente se `NEXT_PUBLIC_DEMO_MODE=true` e `NEXT_PUBLIC_ENV != local`; rollout com flag `false` deve subir em ≤2 preview + 1 prd | Lead time commit→prd ≤10 min · deploy success rate ≥95% · rollback ≤5 min (via redeploy do commit anterior na Vercel) |

Contexto de negócio do delta: a tela de Gestão de Permutas — onde a analista da Columbia decide baixa de adiantamento — não pode servir fixture como se fosse banco. O delta troca o fallback silencioso por um guard fail-fast e um banner explícito. O risco de deployability novo é justamente o *fail-fast*: se o flag vazar num ambiente não-local, o import de `lib/api.ts` lança, e cada página que importa `api.ts` para de renderizar (SSG do Next quebra durante `next build`).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Steps automatizados no CI frontend (commit→PR) | 4 (`npm ci`, typecheck, lint, test) | ≥5 (incluir `build`) | ⚠️ | `.github/workflows/ci.yml` job `frontend` |
| Frontend CI executa `next build` | ❌ ausente | ✅ presente | ❌ | `.github/workflows/ci.yml:32-46` (no step de `build` no job frontend) |
| Backend CI executa `npm run build` | ✅ presente | ✅ presente | ✅ | `.github/workflows/ci.yml:14-30` |
| `.env.example` documenta novo flag `NEXT_PUBLIC_DEMO_MODE` | ✅ (9 linhas, explica escopo/risco/interação com `NEXT_PUBLIC_ENV`) | Presente | ✅ | `src/frontend/.env.example:12-20` |
| Fail-fast guard cobre o flag risco-para-negócio | ✅ `assertDemoEnv()` em `lib/api.ts:23` — throw no import | Presente | ✅ | `src/frontend/lib/api.ts:23`, `lib/features.ts:34-51` |
| Testes automatizados do guard | 6 casos (`features-demo-mode.test.ts`) + 7 (`permutas-fonte-dado.test.ts`) | ≥3 casos por asserção crítica | ✅ | `src/frontend/__tests__/features-demo-mode.test.ts`, `__tests__/permutas-fonte-dado.test.ts` |
| Delta introduz nova dependência de infra | 0 (só variável de build já suportada pela Vercel) | 0 | ✅ | `git diff origin/main...HEAD -- package.json src/frontend/package.json` (sem mudança) |
| Runbook documentado para "flag vazou para prd" | ❌ ausente | Presente | ❌ | `docs/**/runbook*.md` — `find docs -iname "*runbook*"` retorna vazio |
| Toggle runtime do flag (sem rebuild) | ❌ inviável — `NEXT_PUBLIC_*` é baked no bundle pelo Next | N/A (limite do stack) | ⚠️ | Documentação Next.js — variáveis `NEXT_PUBLIC_*` são inlined no build |
| Módulos Terraform / drift detection / per-tenant blast radius | ⚠️ **não medível** | — | — | `infra/` não existe; deploy é Render+Vercel (ver `_shared-metrics.md`) |
| Tenants provisionados | ⚠️ **não medível** | — | — | idem |
| Rollback automatizado a partir de commit anterior | Manual (Vercel/Render dashboard) — não instrumentado no `ci.yml` | 1-comando ou "click único" | ⚠️ | `.github/workflows/ci.yml` (sem step de rollback) |

> ⚠️ **Não medível localmente**: `deploy success rate` histórico da Vercel/Render, `lead time` real, tempo médio de rollback. Requer acesso ao painel da Vercel/Render e/ou DORA metrics.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts — Canary | ❌ ausente no delta e no repo. Vercel oferece Preview Deployments (uma preview por PR) que funciona como canary de facto para o frontend, mas não há promoção controlada com métricas | ⚠️ parcial | Vercel default; `ci.yml` sem promoção condicional |
| Scale Rollouts — Blue/Green | ❌ ausente. Vercel troca aliases atomicamente ao publicar em prd, o que aproxima de "instant blue/green" — mas não há alias intermediário mantido pelo repo | ⚠️ parcial | Vercel default |
| Scale Rollouts — Rolling | N/A — frontend é estático (Next static export/SSG); Render é 1 instância | N/A | Stack |
| Rollback | Manual via dashboard da Vercel (redeploy do commit anterior). O guard `assertDemoEnv()` GARANTE que uma variável errada quebre o build antes do deploy alias — logo, prd nunca chega a servir o fixture; o "rollback" na prática é reverter a variável no painel da Vercel | ⚠️ parcial | `src/frontend/lib/api.ts:23`; nenhum script no repo |
| Script Deployment Commands | Deploy: `git push` → CI + Vercel/Render hooks. Não há shell script versionado no repo para "deploy manual reproduzível" | ⚠️ parcial | `.github/workflows/ci.yml`; sem `scripts/deploy.*` |
| Logical Grouping | Backend, frontend e ontology em diretórios distintos; o job `frontend` do CI só depende de `src/frontend/package-lock.json` (cache-dep-path). O guard de `NEXT_PUBLIC_DEMO_MODE` só afeta o frontend | ✅ presente | `.github/workflows/ci.yml:38-40`; `src/frontend/lib/features.ts` |
| Physical Grouping | Frontend deploya na Vercel (edge/CDN), backend no Render (container). Delta não muda nada disso | ✅ presente (inalterado) | Documentado em `CLAUDE.md` |
| Package Dependencies | Delta atualiza `.env.example` — o "manifesto" das variáveis de deploy da Vercel. Não introduz npm dep nova. `package-lock.json` intocado | ✅ presente | `src/frontend/.env.example:12-20`; `git diff --stat` mostra `package*.json` sem mudança |
| Surge Protection | N/A no escopo deste delta (frontend estático servido pela CDN da Vercel; sem rate limit próprio) | N/A | Stack |
| Idempotent deploys | O flag é build-time e o guard é puro (throw determinístico em função de `process.env`). Um rebuild com as mesmas variáveis produz o mesmo bundle. `tag-release` do `ci.yml` é idempotente (verifica se tag existe antes de criar) | ✅ presente | `.github/workflows/ci.yml:62-70` |
| Drift detection | ⚠️ **não medível** — infra é gerenciada por Vercel/Render sem Terraform. Não há job de "detect drift" no repo | N/A | `infra/` não existe |
| Reproducible builds | `package-lock.json` versionado (`src/frontend/package-lock.json`), Node 24 pinado no CI, cache habilitado. Variáveis `NEXT_PUBLIC_*` embutidas tornam o bundle função do env de build (documentado) | ✅ presente | `.github/workflows/ci.yml:35-41` |
| Per-tenant blast-radius limit | ⚠️ **não medível** — sem tenants provisionados; SaaSo com um único cliente-piloto (Columbia) | N/A | `_shared-metrics.md` |
| Deployment observability | Nenhuma integração com Sentry / status page do lado do repo; log de build só na Vercel/Render. Delta não piora nem melhora | ⚠️ parcial | `find src/frontend -name "sentry*"` vazio |

## 4. Findings (achados)

### F-deployability-1: CI frontend não executa `next build`, deixando o `assertDemoEnv()` sem gate pré-merge

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands / Scale Rollouts (Canary — o CI é o primeiro checkpoint antes do preview)
- **Localização**: `.github/workflows/ci.yml:32-46` (job `frontend`)
- **Evidência (objetiva)**:
  ```yaml
  frontend:
    steps:
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --coverage
      # não há step "npm run build"
  ```
  Backend equivalente (`ci.yml:14-30`) tem `npm run build`; frontend não.
- **Impacto técnico**: `assertDemoEnv()` é chamado no import de `src/frontend/lib/api.ts:23` — logo, ele SÓ dispara quando o módulo é carregado. Em `jest` os testes existem, mas o carregamento durante o build real de produção (SSG do Next prerenderizando as 12 rotas) é onde o guard verdadeiramente fecha o cerco. Como o CI não roda `next build`, uma regressão no guard (ex.: mudança em `isDemoMode()` que sempre retorne `false`) passa verde no CI e só é detectada pela Vercel — depois do merge. Baseline: 0 de 1 workflow frontend valida o build; 0 de 12 rotas prerenderizadas são exercidas no CI.
- **Impacto de negócio**: Aumenta MTTR de deploys quebrados (descoberto na Vercel = envolve pipeline externa, não visível no PR). Confiança do fail-fast como "shift-left" cai porque o *shift* é para a Vercel, não para o CI.
- **Métrica de baseline**: Steps automatizados no CI frontend = 4; alvo = 5 (incluir `build`). Backend tem 6 (audit + typecheck + lint + test + build + install).

### F-deployability-2: `NEXT_PUBLIC_DEMO_MODE` é baked no build — não há toggle runtime, e o processo de rollback do flag não está documentado

- **Severidade**: P2
- **Tactic violada**: Rollback (procedimento não roteirizado)
- **Localização**: `src/frontend/lib/features.ts:34` (leitura via `process.env.NEXT_PUBLIC_DEMO_MODE`); `docs/` — nenhum arquivo `runbook*.md`
- **Evidência (objetiva)**:
  ```bash
  $ find docs -iname "*runbook*" -o -iname "*rollback*"
  # (vazio)
  ```
  E o Next.js inlinia `NEXT_PUBLIC_*` em build time: mudar o flag exige **novo build + redeploy**, não é toggle de painel.
- **Impacto técnico**: Cenário: um stakeholder viu o modo demo em `local`, o engenheiro cometeu por engano `NEXT_PUBLIC_DEMO_MODE=true` no painel da Vercel para preview. Preview quebra (o guard captura), engenheiro precisa (a) reverter a variável no painel da Vercel, (b) redisparar o build. Não há passo-a-passo documentado — para quem entra no time, isso é conhecimento tribal.
- **Impacto de negócio**: Tempo de recuperação depende da familiaridade individual com Vercel. Para um SaaSo em piloto onde a demo é o produto que fecha contrato, um erro de flag pode custar minutos-hora até o próximo build subir.
- **Métrica de baseline**: Runbooks presentes = 0; alvo = 1 mínimo (para os dois fail-fasts existentes: `assertAuthEnv` + `assertDemoEnv`).

### F-deployability-3: Rollout do flag depende de convenção humana (`NEXT_PUBLIC_ENV=local`) sem verificação no CI

- **Severidade**: P2
- **Tactic violada**: Manage Deployed System — Package Dependencies (o "contrato" entre `.env.example` e o painel da Vercel/Render não é validado programaticamente)
- **Localização**: `src/frontend/.env.example:12-30`; `src/frontend/lib/features.ts:33-51`
- **Evidência (objetiva)**:
  ```
  # NEXT_PUBLIC_DEMO_MODE=true ... Only permitted when NEXT_PUBLIC_ENV=local; any other
  # value crashes at startup via assertDemoEnv(), same policy as dev-bypass.
  ```
  A validação existe em runtime (throw), mas o repo não tem um script/CI que garanta que os *painéis* da Vercel/Render para `preview` e `prd` NÃO tenham `NEXT_PUBLIC_DEMO_MODE=true`. Fica dependente de disciplina humana de configuração.
- **Impacto técnico**: O guard corretamente barra o build, mas o barramento é "descobrir depois de tentar deployar", não "prevenir a configuração errada". Não há finding P1 aqui porque o guard *funciona* — só é reativo em vez de proativo. Baseline: 0 scripts de config check; 1 guard runtime.
- **Impacto de negócio**: Erros de configuração humana em painéis SaaS são comuns; o guard converte-os em `build failed` em vez de dados falsos servidos — a *severidade máxima* já está tratada. O que falta é reduzir a fricção de descoberta ("build vermelho na Vercel 3 min depois do merge").
- **Métrica de baseline**: Configuração de env validada por CI = 0; alvo = 1 script `scripts/verify-deploy-env.ts` chamado antes do `terraform apply`/deploy — mas como não há Terraform, seria um step invocando a API da Vercel para ler `env vars` do projeto (o `gh`/Vercel CLI permite). Realista como P2.

## 5. Cards Kanban

### [deployability-1] Adicionar `npm run build` ao job frontend do CI

- **Problema**
  > O guard `assertDemoEnv()` só dispara quando algum entry importa `lib/api.ts`. Em jest testes esse import é induzido; em CI, o job frontend nunca roda `next build`, então a garantia de "o guard tranca o deploy" recai inteiramente na Vercel. Uma regressão que quebrasse silenciosamente o guard passaria verde no CI e só quebraria depois do merge.

- **Melhoria Proposta**
  > Acrescentar step `- run: npm run build` no job `frontend` do `.github/workflows/ci.yml`, imediatamente após `npm test`. Isso ativa o SSG do Next.js sobre as 12 rotas atuais e força o `import 'reflect-metadata'`-like efeito do `assertDemoEnv()`. Tactic Bass: **Script Deployment Commands** (aproximar CI da produção).

- **Resultado Esperado**
  > CI frontend com 5 steps executados por PR (typecheck, lint, test, build, cache). Regressão no guard falha em PR review, não em produção. Steps automatizados no CI frontend: 4 → 5. `next build` executado em cada PR: 0 → 1.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — patch de 1 linha no yaml + validar tempo do CI)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Steps automatizados no CI frontend: 4 → 5
  - Rotas prerenderizadas exercidas por PR: 0 → 12
  - `assertDemoEnv()` exercitado por PR via `next build`: não → sim
- **Risco de não fazer**: Deploys quebrados serão detectados pela Vercel, não pelo review. Para um piloto em que a Vercel é o "prd", isso significa que o time descobre o erro depois do merge, refazendo o ciclo `revert → PR → merge → build` (perde ~15 min por incidente).
- **Dependências**: Nenhuma — mudança isolada no `ci.yml`.

### [deployability-2] Escrever runbook curto para os dois fail-fasts (`assertAuthEnv` + `assertDemoEnv`)

- **Problema**
  > Ambos os guards estouram no build quando uma variável de deploy está errada — mas o repo não tem documentação de como recuperar. Alguém novo no time enfrenta um build vermelho na Vercel com uma mensagem em inglês pedindo `NEXT_PUBLIC_ENV=local` e precisa raciocinar sozinho sobre "revert commit" vs "muda variável no painel".

- **Melhoria Proposta**
  > Criar `docs/runbooks/frontend-env-guards.md` (ou anexar em `docs/deploy/`). Conteúdo: (a) sintoma na Vercel — mensagem exata do throw; (b) causa provável — flag ligado fora de `local`; (c) recuperação em 3 passos (Vercel dashboard → project → env vars → remover `NEXT_PUBLIC_DEMO_MODE` OU setar `NEXT_PUBLIC_ENV=local`; disparar rebuild); (d) prevenção — checklist antes de tocar env do painel. Tactic Bass: **Rollback** (procedimento explícito).

- **Resultado Esperado**
  > Runbook consultável no repo. Recuperação de "flag errado no painel" cai de "descobrir sozinho" para 3 passos com timing conhecido. Runbooks presentes: 0 → 1.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 1 doc curto)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Runbooks de fail-fast documentados: 0 → 1
  - Tempo mediano de recuperação estimado: desconhecido → alvo declarado ≤5 min (a validar em incidente real)
- **Risco de não fazer**: Recuperação vira conhecimento tribal — quando o engenheiro que criou o guard sai de férias, a próxima demo com o flag mal configurado vira uma hora perdida.
- **Dependências**: Nenhuma.

### [deployability-3] Verificação programática das variáveis de deploy da Vercel antes de promover para prd

- **Problema**
  > O guard `assertDemoEnv()` é reativo: quebra o build quando a variável está errada. Isso protege prd de servir dados falsos, mas o operador só descobre o erro *depois* de tentar deployar. Para uma equipe pequena em piloto, cada erro de configuração custa 3-5 min de rebuild inútil.

- **Melhoria Proposta**
  > Acrescentar step opcional no `ci.yml` (ou script em `scripts/check-vercel-env.mjs`) que, usando o Vercel CLI/API (`vercel env ls`), leia as env vars do projeto e reprove o CI se `NEXT_PUBLIC_DEMO_MODE=true` estiver setado para `preview` ou `production`. Tactic Bass: **Package Dependencies** (o `.env.example` é o contrato — validá-lo contra o painel fecha o loop).

- **Resultado Esperado**
  > Erros de configuração de painel viram falha de CI antes do build. Cheque pró-ativo em vez de reativo. Config-checks no CI: 0 → 1.

- **Tactic alvo**: Package Dependencies
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — precisa token da Vercel na org do GitHub Actions + script + testes)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Env vars validadas por CI: 0 → 2 (`NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_DEV_AUTH_BYPASS`)
  - Reprovação de config errada shift-left: build (na Vercel) → PR (no GitHub)
- **Risco de não fazer**: Baixo — o fail-fast já protege prd. O ganho é DX, não segurança de dados.
- **Dependências**: Token Vercel disponível como secret do GitHub Actions da org.

## 6. Notas do agente

- Delta é frontend-puro; todas as métricas de Terraform/tenant/IAM foram declaradas `não medível` conforme `_shared-metrics.md` — não como findings.
- O delta **melhora** a deployability ao adicionar `assertDemoEnv()` (fail-fast) + `.env.example` documentado. Findings deste doc atacam o entorno do delta (CI frontend sem `build`, ausência de runbook, verificação de config), não o código do delta em si.
- Cross-QA: (1) `qa-security` deve corroborar o achado security-1 análogo (`assertAuthEnv`) — a política de fail-fast é a mesma. (2) `qa-modifiability` provavelmente vai notar que o padrão `assertXxxEnv() + isXxxMode()` está sendo replicado em `lib/features.ts` e `lib/auth/env.ts` — vale considerar extrair um helper `defineEnvGuard(name, allowedEnvs)` (deployability-neutral, mas reduz risco de o próximo guard esquecer o throw). (3) `qa-testability` deve elogiar as 13 asserções novas — elas cobrem exatamente os dois riscos que este QA levantou.
- Não coletei tempos de build reais (frontend/backend) por não fazerem parte do delta — mas seriam alvos naturais de instrumentação futura para calibrar `lead time commit→prd`.
