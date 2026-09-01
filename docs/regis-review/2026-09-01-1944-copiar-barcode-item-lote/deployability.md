---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-01-1944
agent: qa-deployability
generated_at: 2026-09-01T19:44:00-03:00
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

Escopo: **delta** da feature `copiar-barcode-item-lote` (`--quick`). Nova rota
`GET /sispag/lotes/:id/linhas-digitaveis` (admin-only, read-only), novo método de client
(`ConexosSispagWriteClient.listarLinhasDigitaveisDoLote`), novo método de serviço
(`SispagPainelService.linhasDigitaveisDoLote`), consumo no `LoteCard` via `fetchLinhasDigitaveis`.
Sem migration, sem env nova, sem flag nova.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Pipeline CI (merge da PR em `main`) | Push aciona `autoDeploy: true` no Render (BE) e deploy da Vercel (FE) em paralelo | Rota `GET /sispag/lotes/:id/linhas-digitaveis` (BE Express) + botão de copiar no `LoteCard` (FE Next.js) | Produção, tráfego contínuo de analistas Columbia no painel SISPAG | Deploy atômico do delta sem downtime, sem coordenação manual, com rollback trivial (feature aditiva e read-only); janela em que FE já chama a rota mas BE ainda serve versão anterior degrada silenciosamente (botão ausente, sem crash) | Zero incidentes de UI durante a janela de deploy; rollback de qualquer lado (FE ou BE, isoladamente) em ≤ 1 clique via dashboard Vercel/Render; MTTR de "botão apareceu bugado" ≤ 5 min via revert do frontend |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations no delta | 0 | 0 (feature aditiva sem persistência) | ✅ | `git diff main --stat` (`_shared-metrics.md`) — nenhum arquivo em `src/backend/migrations/` |
| Envs novas no delta | 0 | 0 (nenhuma flag/segredo novo) | ✅ | `git diff main -- src/backend/.env.example render.yaml` — sem alteração |
| Arquivos tocados no delta | 9 (6 BE + 3 FE) | — | ℹ️ | `_shared-metrics.md` |
| Kill-switch por env para desligar em incidente sem redeploy | ausente | presente (padrão do repo: `SISPAG_DDA_ASSOC_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`) | ⚠️ | `grep -n "sync: false" render.yaml` — 7 kill-switches vivos; nenhum cobre esta rota |
| Coordenação de ordem de deploy FE↔BE | implícita, paralela (Render + Vercel disparam em `push main`) | ordem determinística OU tolerância explícita no chamador | ⚠️ mitigado | `render.yaml` (`autoDeploy: true`, `branch: main`) + `.github/workflows/ci.yml` (só gates, sem deploy job) |
| Tolerância do FE à ausência da rota nova | catch silencioso (`setLinhas(new Map())` → botão não aparece) | falha soft, sem crash | ✅ | `src/frontend/app/sispag/components/LoteCard.tsx:170-174` |
| Rollback do BE independente do FE | seguro (rota some → FE cai no catch, botão desaparece) | seguro sem coordenação | ✅ | Design + `LoteCard.tsx:170-174` |
| Rollback do FE independente do BE | seguro (botão some, rota do BE fica órfã inofensiva) | seguro sem coordenação | ✅ | Rota nova é read-only sem side-effect |
| Bump de versão FE+BE em lockstep | infra existe (`scripts/bump-version.ps1` + `tag-release` job) | lockstep 100% | ✅ | `scripts/bump-version.ps1:1-60`, `.github/workflows/ci.yml:53-71` |
| Health check pós-deploy | `/health` configurado no Render; sem smoke da nova rota | health check ativo | ✅ | `render.yaml` (`healthCheckPath: /health`) |
| Pre-deploy hook (migrações) rodando neste delta | executa (idempotente: sem nova migration para aplicar) | rodando, sem risco por delta | ✅ | `render.yaml` (`preDeployCommand: npm run migrate && npm run seed:admin`) |
| Feature flag por role (guard efetivo em incidente) | `requireRole('admin')` — bloqueia tudo que não é analista | admin-only para dados sensíveis (LGPD Art. 6º/LC 105) | ✅ | `src/backend/routes/sispag.ts:67` |
| Terraform plan/apply | ⚠️ **Não medível**: não existe `infra/` neste repo (deploy é Render + Vercel + Supabase; ver `DEPLOY.md`). Categoria "IaC hygiene" da taxonomia Bass é integralmente N/A para este stack | — | ℹ️ | `_shared-metrics.md` |
| Tenants provisionados | ⚠️ **Não medível**: multi-tenant AWS é estado-alvo, não atual (`CLAUDE.md` §Tenants) | — | ℹ️ | `_shared-metrics.md` |
| Bundle size / build duration Lambda | ⚠️ **Não medível**: sem Lambda; backend é Express monolítico em Render | — | ℹ️ | `render.yaml` (`runtime: node`, `startCommand: npm start`) |

## 3. Tactics — Cobertura no nf-projects (aplicadas ao delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Nem canary nem blue-green. Render publica o novo container substituindo o anterior; Vercel promove a nova build para o domínio. Não há canário por tráfego. Para este delta (read-only, admin-only, aditivo), o risco é aceitável, mas o gap é estrutural do stack — não da feature | ⚠️ parcial | `render.yaml` (`autoDeploy: true`); ausência de config de canário |
| Rollback | Render mantém deploys anteriores clicáveis; Vercel idem. Feature aditiva sem migration → rollback é seguro em ambos os lados isoladamente. Nenhum passo manual documentado no delta (nem precisa: o design do FE tolera o BE anterior) | ✅ presente | `render.yaml`; `LoteCard.tsx:163-174` (catch silencioso) |
| Script Deployment Commands | 100% via CI + Render blueprint + Vercel. Zero passo manual neste delta (sem migration, sem env). O `preDeployCommand` do Render roda `migrate`+`seed:admin` idempotentes a cada push | ✅ presente | `.github/workflows/ci.yml`; `render.yaml:16` |
| Logical Grouping (deployable unit) | BE Express monolítico (1 processo, 1 deploy no Render) + FE Next.js (1 projeto Vercel). A rota nova entra no mesmo bundle Express — não há sub-grupo a orquestrar | ✅ presente | `render.yaml`; `src/backend/routes/sispag.ts` |
| Physical Grouping | 1 instância Render (starter plan) + edge Vercel. Sem cluster para orquestrar; grupo físico = grupo lógico | N/A | Stack single-node por design (Render starter) |
| Package Dependencies | Novo import de `sonner` no FE — já existente em `package.json` (não é dep nova). Nenhuma dep nova no BE. Lockfiles `src/backend/package-lock.json` e `src/frontend/package-lock.json` respeitados pelo `npm ci` do CI | ✅ presente | `git diff main -- src/*/package.json` (sem alteração) |
| Surge Protection | Sem rate limit dedicado na rota. O consumo é acoplado à expansão do card no `LoteCard` (`useEffect` no `aberto`); cada expansão dispara 1 chamada. Um analista abrindo 10 lotes = 10 chamadas ao `fin015` upstream. Sem circuit-breaker por rota, mas o serviço já engole erro em warn (`SispagPainelService.linhasDigitaveisDoLote` catch) | ⚠️ parcial (cross-ref Performance/Availability) | `SispagPainelService.ts:238-262`; `LoteCard.tsx:154-174` |
| Idempotent deploys | `preDeployCommand` idempotente (migrations já aplicadas → no-op; `seed:admin` idempotente). Blueprint `render.yaml` idempotente. Delta não introduz side-effect de deploy | ✅ presente | `render.yaml`; convenção `migrations/` |
| Drift detection | Nenhuma automação compara `render.yaml` com o dashboard Render. As envs `sync: false` (kill-switches) são deliberadamente **não** rastreadas — dashboard é fonte-da-verdade para elas (ADR-0013, comentário no `render.yaml`). Não é gap deste delta | ⚠️ parcial (estrutural, não do delta) | `render.yaml` — comentários sobre `CONEXOS_*` sync:false |
| Reproducible builds | Lockfiles commitados; Node 24 fixado no CI; `npm ci` (não `install`); Render usa `npm ci` também no `buildCommand`; sem `Date.now()` no bundle Express | ✅ presente | `.github/workflows/ci.yml:15-21`; `render.yaml:15` (`buildCommand: npm ci && npm run build`) |
| Per-tenant blast-radius limit | Single-tenant hoje (Columbia). Multi-tenant é estado-alvo. Blast radius do delta = 100% dos usuários Columbia, mas escopado por `requireRole('admin')` (blast interno) | N/A (multi-tenant não existe) | `CLAUDE.md` §Tenants |
| Deployment observability | `/health` do Render sinaliza processo up. Não há smoke test da nova rota pós-deploy; logs via Render dashboard. Warn do `SispagPainelService.linhasDigitaveisDoLote` cai como `BUSINESS_WARN` — enxergável no LogService | ⚠️ parcial (estrutural) | `render.yaml` (healthCheck); `SispagPainelService.ts:255-262` |

## 4. Findings (achados)

### F-deployability-1: FE e BE fazem autodeploy em paralelo sem contrato de ordem — janela existe, mas o `LoteCard` a absorve

- **Severidade**: P3 (baixo — melhoria opcional; o design do FE já mitiga)
- **Tactic violada**: Scale Rollouts (ausência de ordem determinística ou de smoke pós-deploy)
- **Localização**: `render.yaml:11-13` (`autoDeploy: true`, `branch: main`) + `src/frontend/app/sispag/components/LoteCard.tsx:154-174` (mitigação)
- **Evidência (objetiva)**:
  ```
  # render.yaml
  autoDeploy: true
  buildCommand: npm ci && npm run build
  preDeployCommand: npm run migrate && npm run seed:admin
  # → BE demora build + preDeploy (segundos a minutos) antes de trocar tráfego
  ```
  ```typescript
  // LoteCard.tsx:163-173 — mitigação: qualquer falha → sem botão, sem crash
  fetchLinhasDigitaveis(l.id)
      .then((itens) => { if (!vivo) return; setLinhas(new Map(...)) })
      .catch(() => { if (vivo) setLinhas(new Map()) })  // sem linha → sem botão; nada quebra
  ```
- **Impacto técnico**: quando merge em `main` dispara ambos os deploys, o FE pode terminar antes do BE. Nesse intervalo, o browser chama `GET /sispag/lotes/:id/linhas-digitaveis` na versão antiga do BE (404). Sem a rota, `fetchLinhasDigitaveis` lança, o `catch` limpa o mapa e o botão não aparece. Recuperação automática quando o BE termina o deploy (nova expansão do card faz nova chamada).
- **Impacto de negócio**: nenhum visível ao analista — no pior caso, o botão de "copiar linha digitável" aparece 30–90s depois do resto da tela. Sem perda de dado, sem cancelamento de lote, sem cobrança errada.
- **Métrica de baseline**: janela de inconsistência FE→BE ≈ tempo de `buildCommand` + `preDeployCommand` do Render (típico ~60–180s no plano starter, não medido para esta rota). Zero degradações visíveis na taxa de erro do painel durante a janela (por desenho: catch silencioso).

### F-deployability-2: rota nova sem kill-switch por env — para desligar em incidente é preciso redeploy (o repo tem o padrão, esta rota não adotou)

- **Severidade**: P2 (médio — débito técnico defensável; a rota é read-only e admin-only, mas expõe destino de pagamento)
- **Tactic violada**: Rollback (granularidade: kill-switch por feature evita reverter deploy inteiro)
- **Localização**: `src/backend/routes/sispag.ts:60-73` (rota sem gate por env); ausência em `src/backend/domain/libs/environment/model/EnvironmentVars.ts` e em `render.yaml`
- **Evidência (objetiva)**:
  ```typescript
  // routes/sispag.ts:60-73 — só há requireRole('admin'), sem env kill-switch
  router.get(
      '/lotes/:id/linhas-digitaveis',
      requireRole('admin'),
      asyncHandler(async (req, res) => {
          const service = container.resolve(SispagPainelService);
          const itens = await service.linhasDigitaveisDoLote(String(req.params.id));
          res.json({ itens });
      }),
  );
  ```
  ```yaml
  # render.yaml — padrão do repo para desligar sem redeploy (sync: false → dashboard toggle)
  - key: SISPAG_LIVE_WRITE_ENABLED   # sync: false
  - key: SISPAG_DDA_ASSOC_ENABLED    # env com default explícito
  - key: RECEBIMENTOS_ENABLED        # sync: false, kill-switch de emergência
  ```
  O próprio comentário da rota reconhece a sensibilidade do dado: *"a linha digitável é destino de pagamento — carrega banco, agência e conta do cedente no campo livre, além do valor. Sem o guard, um loop de `curl` extrai a carteira de boletos da Columbia. LGPD Art. 6º e LC 105."*
- **Impacto técnico**: se um incidente for detectado (ex.: log/telemetria acidentalmente registrando a linha digitável; abuso por conta admin comprometida; DoS via 500 lotes por chamada estourando cota do Conexos), a única forma de derrubar a rota sem esperar CI+deploy é editar código, dar push, esperar CI verde, esperar Render build+preDeploy — janela típica ≥ 5min. Um `sync: false` no dashboard cortaria em < 30s (padrão vivo dos outros 7 kill-switches).
- **Impacto de negócio**: vazamento potencial (LGPD/LC 105) durante os ≥ 5min de reação; MTTR do isolamento maior do que precisa ser para uma rota que expõe *instrumento de pagamento*.
- **Métrica de baseline**: `# kill-switches por env cobrindo rotas SISPAG sensíveis` = 2 (`SISPAG_LIVE_WRITE_ENABLED`, `SISPAG_DDA_ASSOC_ENABLED`), nenhum cobre `GET linhas-digitaveis`. MTTR de kill via redeploy = ~5min (build + preDeploy no plano starter); MTTR via dashboard toggle (padrão do repo) ≤ 30s.

## 5. Cards Kanban

### [deployability-1] Documentar (ou automatizar) a ordem FE→BE no deploy, ou aceitar formalmente a mitigação por catch silencioso

- **Problema**
  > `push main` dispara `autoDeploy` do Render e da Vercel em paralelo, sem contrato de ordem. Para este delta, se o FE terminar antes do BE, o botão "copiar linha digitável" aparece atrasado (fetch cai em `catch → setLinhas(new Map())`, sem crash). É invisível ao usuário — mas o padrão de sofrimento se replica em toda feature aditiva do repo, e não está documentado como decisão consciente.

- **Melhoria Proposta**
  > Adicionar uma nota curta em `DEPLOY.md` seção "Ordem de deploy" descrevendo: (a) Render e Vercel deployam em paralelo do mesmo commit; (b) FE consumindo rota nova do BE deve tolerar 404/500 com fallback silencioso (padrão já usado em `LoteCard.tsx:163-174`); (c) rotas do BE que passam a exigir header/campo novo antes do FE enviarem precisam de dupla vida (aceitar ambos os formatos por 1 release). Alternativa mais forte (não obrigatória neste delta): adicionar um `smoke-test` step no CI pós-deploy que faz `curl` na rota nova antes de promover o FE.

- **Resultado Esperado**
  > Cada dev sabe, antes de abrir PR, que precisa desenhar o consumo FE tolerante ao BE anterior. Zero janelas visíveis de inconsistência FE→BE. Métrica: `#/PRs com rota nova` × `#/PRs com fallback FE documentado`.

- **Tactic alvo**: Scale Rollouts (contrato explícito) / Deployment observability (smoke pós-deploy)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — 1 seção em `DEPLOY.md` + eventualmente 1 step no CI)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Janela FE→BE documentada em `DEPLOY.md`: ausente → presente
  - PRs futuros com rota nova mencionam fallback do consumidor no corpo: 0% → 100%
- **Risco de não fazer**: a mitigação continuará implícita; próxima feature esquecerá do `.catch()` e a janela de deploy vira um bug intermitente ("tela em branco após deploy"). Sem documentação, é debug de horas.
- **Dependências**: nenhuma

### [deployability-2] Kill-switch por env para `GET /sispag/lotes/:id/linhas-digitaveis` — alinhar ao padrão do SISPAG

- **Problema**
  > A rota expõe linhas digitáveis de boletos (instrumento de pagamento, LGPD Art. 6º / LC 105 — conforme comentário do próprio código). O único gate hoje é `requireRole('admin')`. Se surgir incidente (log acidental do valor, credencial admin comprometida, DoS via 500 itens por chamada) o único recurso é revert + redeploy (~5min no plano starter). Todo o resto do SISPAG sensível já tem kill-switch via `sync: false` no `render.yaml` (`SISPAG_LIVE_WRITE_ENABLED`, `SISPAG_DDA_ASSOC_ENABLED`, `RECEBIMENTOS_ENABLED`) — pattern estabelecido, esta rota não adotou.

- **Melhoria Proposta**
  > 1) Adicionar `SISPAG_COPIAR_LINHA_DIGITAVEL_ENABLED` (default `true`, `sync: false` no `render.yaml`) validado por Zod em `EnvironmentVars.ts` (mesmo shape de `sispagDdaAssocEnabled`). 2) `routes/sispag.ts` middleware antes do handler: `if (!env.sispagCopiarLinhaDigitavelEnabled) return res.status(403).json({ error: 'temporarily disabled' })`. 3) FE já cai no `catch` — botão desaparece automaticamente sem release. 4) Registrar em `DEPLOY.md` na tabela de kill-switches do SISPAG.

- **Resultado Esperado**
  > MTTR de isolamento de incidente na rota: ~5min (redeploy) → ≤ 30s (dashboard toggle). Sem afetar `SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED` ou o painel como um todo — corta cirurgicamente esta rota.

- **Tactic alvo**: Rollback (granular — feature toggle sem redeploy)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 1 env + 1 middleware + 1 teste + 1 linha no `render.yaml` + 1 linha em `DEPLOY.md`)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Kill-switches SISPAG cobrindo rotas sensíveis: 2 → 3
  - MTTR de "desligar `GET linhas-digitaveis` em produção": ~5min → ≤ 30s
  - Cobertura do padrão `sync: false` em rotas admin-only que expõem dado de pagamento: parcial → completa
- **Risco de não fazer**: em 6 meses, um incidente qualquer (analista compartilha cURL no Slack; log estrutural começa a serializar `res.json` sem redação; Conexos passa a devolver dados extras no `itsNumCodbar`) obriga hotfix + release + deploy. Todo o SISPAG restante já tem essa alavanca; a única rota sem ela é justamente a que o próprio comentário classifica como sensível.
- **Dependências**: nenhuma (padrão já implementado em outras vars)

## 6. Notas do agente

- Escopo é o **delta** (`--quick`) — pipeline CI, `render.yaml` e Vercel/Render existiam antes; avaliei-os só onde o delta interage. Não abri findings sobre gaps estruturais (drift detection ausente, sem canary, single-node Render) porque são débito pré-existente do stack, não introduzidos aqui.
- Categoria "IaC hygiene" da taxonomia Bass é integralmente N/A neste repo — não há `infra/`, Terraform, SSM ou tenants provisionados. Registrado como "não medível" no `_shared-metrics.md`.
- Cross-QA: F-deployability-2 (kill-switch) tem par natural em **Security** (LGPD/LC 105 — o próprio comentário do handler cita) e o comportamento de fanout no `LoteCard` (`useEffect` disparando `fin015` a cada expansão) é insumo para **Performance** (upstream ao ERP) e **Availability** (o `SispagPainelService.linhasDigitaveisDoLote` já engole erro em `BUSINESS_WARN` — decisão explícita comentada). Nada de novo para **Modifiability** — o delta não mexe em estrutura Terraform (não existe).
- O bump lockstep FE+BE (`scripts/bump-version.ps1`) e o job `tag-release` do CI garantem que as versões nunca divergem — ótima base para futuros incident postmortems, mas não elimina a janela paralela de deploy (Render ≠ Vercel).
