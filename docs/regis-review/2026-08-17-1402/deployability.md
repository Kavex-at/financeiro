---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-17-1402
agent: qa-deployability
generated_at: 2026-08-17T14:20:00-03:00
scope: backend+frontend
score: 8
findings_count: 5
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev merga PR desta feature em `main` | Push dispara **duas** pipelines independentes: GitHub Actions → Render (backend, `src/backend`, ~50–90s de build) e Vercel autodeploy (frontend, ~40–70s) | Backend Express (Render) + Frontend Next.js (Vercel) — **plataformas separadas, sem coordenação** | Produção com carteira de recebimentos em uso pelo analista | Nova versão do painel deve entrar sem derrubar a aba nem obrigar reload; contrato de `GET /recebimentos/painel` mudou (`ndes: []` fixo → lista com campos novos + `ndePendentes` real), e a janela de skew FE↔BE **não pode quebrar nenhuma das duas combinações** | 0 erros HTTP 5xx atribuíveis ao deploy; 0 exceções no console do FE por campo novo ausente; MTTR de rollback ≤ 1 revert-commit + 1 push (sem migration para desfazer) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations SQL adicionadas neste delta | 0 | 0 (feature declarada migration-free) | ✅ | `git diff main --stat -- src/backend/migrations/` (vazio) |
| Bump de versão FE+BE lockstep | `0.23.0` / `0.23.0` | igual em ambos os `package.json` | ✅ | `grep '"version"' src/{backend,frontend}/package.json` |
| Entrada `CHANGELOG.md` para `v0.23.0` | Presente, 6 bullets, GAP explicitado | Presente + descreve o "por quê" | ✅ | `CHANGELOG.md:3-27` |
| Novas envs / feature flags introduzidas | 0 | 0 (nada de novo a configurar no Render/Vercel) | ✅ | `git diff main -- DEPLOY.md src/backend/domain/libs/environment/EnvironmentProvider.ts` (sem diff) |
| Novos passos no workflow de CI | 0 | 0 (`ci.yml` inalterado) | ✅ | `git diff main -- .github/workflows/` (sem diff) |
| Contrato de `GET /recebimentos/painel` — **breaking**? | Aditivo (campos opcionais em `NdePainelRow`, `ndes: []` → lista, `ndePendentes: 0` → COUNT) | Não-breaking (FE antigo tolera; BE antigo devolve vazio que FE novo tolera) | ✅ | análise manual do `git diff main -- src/backend/domain/interface/recebimentos/ports.ts src/frontend/lib/recebimentos.ts` |
| Rollback do código requer rollback de dados? | Não — escritas novas (`nota_debito_eletronica.numero_nde`, `solicitacao_numerario_execucao.nde_autorizado`) são em colunas pré-existentes (0038/0042); código antigo não as lê nem falha por elas estarem preenchidas | Rollback = revert + push, zero-touch no banco | ✅ | `git diff main -- src/backend/domain/repository/recebimentos/NdeRepository.ts` + esquema em `migrations/0038,0041,0042` |
| Deploy atômico FE+BE | Não (Vercel + Render disparam independentes no push) | Aditividade de contrato compensa; janela ≤ ~90s | ⚠️ | `DEPLOY.md:1-5`, `.github/workflows/ci.yml` (não orquestra deploy) |
| Job de deploy no CI (rollback controlado a partir do repo) | Ausente — CI só faz build/test/lint e cria tag; Render/Vercel deployam por webhook | Job explícito com aprovação manual (P3 pré-existente, herdado do run 2026-06-22) | ⚠️ | `.github/workflows/ci.yml:9-74` |
| Cobertura do delta pelos testes de unidade | Todas as novas funções (`hidratarNdes`, `hidratarUma`, `listParaPainel`, `contarPendentes`, `updateNumeroNde`) exercitadas | ≥1 caso feliz + degradação (ERP down) por função pública | ✅ | `NdeRepository.test.ts` (novos 116 LOC), `RecebimentosPainelService.test.ts` (novos 118 LOC), `NdeTable.test.tsx` (6 novos) |
| Bundle FE afetado (Next.js chunks) | Não medido — `--quick` proíbe build de produção | delta ≤ 5KB gzip por chunk de `app/recebimentos/*` | ⚠️ Não medível localmente | `--quick` (ver `_shared-metrics.md:76`) |
| Runtime perf do deploy (cold start Express) | Não medido — Render dashboard | ≤ 90s do push ao endpoint responder 200 no `/healthcheck` | ⚠️ Não medível localmente | Render logs (fora do repo) |

> ⚠️ **Não medível localmente**: bundle FE (bloqueado por `--quick`), tempo de deploy Render e latência do webhook Vercel — requerem dashboard Render/Vercel. Recomendação: usar `render-diagnose --deploy-id` e o painel de builds Vercel para amostrar 5 deploys pós-merge desta feature.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary / blue-green / rolling) | Ausente. Render faz swap in-place; Vercel promove atomicamente por deployment mas sem canary staging entre FE↔BE. Esta feature compensa com **contrato aditivo** — a técnica implícita é *backward-compatible contract evolution*, não canary de infra | ⚠️ parcial (compensado no design) | `DEPLOY.md:22-30`; `ports.ts:525-579` (todos os campos novos são `?:`) |
| **Rollback** | Feature é `migration-free` → revert do commit + push = rollback completo. Escritas de reconciliação (`updateNumeroNde`, `setNdeAutorizado(true)`) são em colunas 0038/0042 pré-existentes e são semanticamente idempotentes com o schema antigo (o código antigo simplesmente não lê `nde_autorizado`) | ✅ presente | `git diff main --stat -- src/backend/migrations/` (0 arquivos); `NdeRepository.ts:88-134` (SELECT/UPDATE só em colunas antigas) |
| **Script Deployment Commands** | Render Build/Pre-Deploy/Start em `DEPLOY.md:22-30`; `BootMigrator` executa migrações **no boot** (posterior à 228bfa fix), tornando o Pre-Deploy do Render redundante mas seguro | ✅ presente | `DEPLOY.md:22-30`; `src/backend/migrations/BootMigrator.ts:46-79` |
| **Idempotent Deploys** | Deploy sem migração é trivialmente idempotente. Cliente Conexos usa `Idempotency-Key` por chamada; `updateNumeroNde` é `UPDATE ... WHERE idempotency_key = $1` (safe em replay). `Tag Release` job só cria a tag se ela não existe (`git rev-parse "$TAG" >/dev/null 2>&1`) | ✅ presente | `ci.yml:60-72`; `NdeRepository.ts:119-127` |
| **Logical Grouping** | Backend agrupa domínio em `domain/service|repository|interface/recebimentos/`; FE em `app/recebimentos/components/*`. Delta respeita a fronteira (nada tocado fora de `recebimentos/`) | ✅ presente | `_shared-metrics.md:6-34` (26 arquivos, todos sob `recebimentos/` ou `_meta`) |
| **Physical Grouping** | Backend = 1 process no Render; FE = 1 project na Vercel; DB = 1 Supabase project. Sem multi-tenant/multi-região; sem `infra/` | N/A | escopo: single-tenant Columbia, ver CLAUDE.md §Estado Atual vs. Alvo |
| **Package Dependencies** | Nenhuma dependência nova neste delta — `git diff main -- src/{backend,frontend}/package.json` só mostra bump de `version` | ✅ presente | `git diff main --stat` (só linha `"version"` alterada em ambos `package.json`) |
| **Surge Protection** | Hidratação `com297` limitada a **20 linhas por carga**, em **lotes de 5** paralelos, e só nas NDes ainda-não-autorizadas — é a defesa contra rajada no ERP no primeiro deploy pós-feature (quando muitas NDes antigas vão querer hidratar de uma vez) | ✅ presente | `constants.ts:270-283`; `RecebimentosPainelService.ts:245-264` |
| **Drift Detection** | Ausente (não há `infra/`/Terraform para plan-diff). Render dashboard é fonte da verdade fora do repo — herdado do run 2026-06-22 (KANBAN.md:604) | ❌ ausente | `find infra -maxdepth 1 2>/dev/null` (vazio); CLAUDE.md §Infra "não existe" |
| **Reproducible Builds** | `package-lock.json` presente em ambos; CI usa `npm ci` com cache por lockfile; TS bundler config estável. Sem timestamps embed no build | ✅ presente | `ci.yml:17-23,37-43` |
| **Per-Tenant Blast-Radius Limit** | Single-tenant Columbia — N/A com justificativa: nenhum tenant provisionado (ver `_shared-metrics.md:52`) | N/A | CLAUDE.md §Tenants "vazio" |
| **Deployment Observability** | Tag `v0.23.0` cria GitHub Release automaticamente com `CHANGELOG.md` como referência. Sem healthcheck-gated cutover; sem `/deployinfo` endpoint que exponha `git SHA` corrente para diagnosticar skew | ⚠️ parcial | `ci.yml:48-73` (tag OK); grep `git rev-parse HEAD` no runtime → ausente |

## 4. Findings (achados)

### F-deployability-1: Delta é comprovadamente migration-free e rollback-safe

- **Severidade**: P3 (baixo — é um **positivo** verificável; registrar como baseline para o consolidator)
- **Tactic violada**: nenhuma — evidência de aderência a *Rollback* + *Idempotent Deploys*
- **Localização**: escopo global do delta
- **Evidência (objetiva)**:
  ```
  $ git diff main --stat -- src/backend/migrations/
  (vazio)
  ```
  A feature usa somente colunas já existentes: `nota_debito_eletronica.numero_nde` (0038), `nota_debito_eletronica.idempotency_key` (0038), `solicitacao_numerario_execucao.nde_autorizado` (0042), `solicitacao_numerario_execucao.nd_doc_cod`/`etapa`/`revisao_humana`/`erro_mensagem` (0041/0042). Escritas do delta: `UPDATE nota_debito_eletronica SET numero_nde` (NdeRepository.ts:119-126) e `setNdeAutorizado(idempotencyKey, true)` (chamado em RecebimentosPainelService.ts:296) — código antigo (`main`) simplesmente **não lê** essas colunas, então rollback do código não deixa dado órfão nem incompatibilidade de schema.
- **Impacto técnico**: nenhum negativo. Rollback = `git revert 0c179ea..HEAD` (na verdade um único commit ainda por vir) + push; Render/Vercel autodeployam a versão anterior em ≤ 90s. Zero-touch no banco.
- **Impacto de negócio**: MTTR de reversão da feature na casa de minutos, não de horas — a aba pode ser desativada em incidente sem envolver DBA nem janela de manutenção.
- **Métrica de baseline**: **0 migrations**, **1 revert commit** para rollback, **0 scripts SQL de rollback** necessários.

### F-deployability-2: Skew FE↔BE tolerado por design (contrato aditivo verificado)

- **Severidade**: P3 (positivo — não gera card corretivo)
- **Tactic violada**: nenhuma — evidência de aderência a *Scale Rollouts* via *backward-compatible contract*
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:525-579`, `src/frontend/lib/recebimentos.ts:100-143`
- **Evidência (objetiva)**:
  - **BE novo × FE antigo**: FE antigo consome `ndes: NotaDebitoEletronica[]` **sem** os campos `ndDocCod`/`etapa`/`revisaoHumana`/`ndeAutorizado`/`erroMensagem`. Todos são opcionais no schema TS; JS runtime ignora keys que a UI não referencia. O único cálculo FE-side afetado, `computeKpis(...).ndePendentes` (recebimentos.ts:179-183), continua funcional porque o novo código sobrescreve com `json.kpis.ndePendentes` (recebimentos.ts:717) — o FE antigo, sem essa reescrita, ainda contava via `statusEmissao === 'pendente'`, que continua sendo devolvido pelo BE novo. Nenhum crash.
  - **BE antigo × FE novo**: BE antigo (`main`) devolve `ndes: []` fixo e `ndePendentes: 0` fixo. FE novo renderiza aba vazia via `EmptyState` (NdeTable.tsx:52-58) — o mesmo caminho que já rodava antes da feature. Nenhum acesso a campo ausente porque a lista está vazia. Nenhum crash.
- **Impacto técnico**: janela de skew do deploy não-atômico (Vercel primeiro ou Render primeiro, ~30–90s) é **segura em ambas as ordens**.
- **Impacto de negócio**: usuário no meio do deploy pode ver a aba vazia por até 90s (ordem "Vercel primeiro") ou sem as colunas de diagnóstico por até 90s (ordem "Render primeiro"). Nenhum erro visível.
- **Métrica de baseline**: **0 campos obrigatórios adicionados**; **0 endpoints removidos**; **0 mudanças de tipo em campo existente**.

### F-deployability-3: Deploy FE+BE não-atômico sem orquestração no CI (pré-existente, não introduzido)

- **Severidade**: P2 (médio — débito herdado; agravante quando alguma feature futura for **breaking**)
- **Tactic violada**: *Scale Rollouts*, *Deployment Observability*
- **Localização**: `.github/workflows/ci.yml:9-74` (não tem job `deploy`), `DEPLOY.md:1-5`
- **Evidência (objetiva)**:
  ```
  $ grep -E "deploy|render|vercel" .github/workflows/ci.yml
  (nada — só backend / frontend / tag-release)
  ```
  Deploy é 100% webhook: Render tem `autoDeploy: true` no serviço e Vercel deploya por integração GitHub. Não há sequencing "BE primeiro, aguarda healthcheck, aí libera FE". O run 2026-06-22-1658 (KANBAN.md:604) já registrou esse gap.
- **Impacto técnico**: para **este delta** o risco é nulo (aditivo). Para uma feature futura que remova/renomeie campo, a janela de skew se transforma em janela de erro 500 no FE ou de "campo undefined" na UI.
- **Impacto de negócio**: cada mudança breaking futura precisa de plano manual de ordenação (deploy BE, aguarda, promove FE) — depende de disciplina humana, não de mecanismo.
- **Métrica de baseline**: **0 jobs de deploy no CI**; **0 healthchecks gated**; **0 aprovações manuais** entre build-ok e produção.

### F-deployability-4: Sem endpoint `/deployinfo` para diagnosticar em qual SHA está cada plataforma

- **Severidade**: P2 (médio — impede diagnóstico rápido de skew, tanto o desta feature quanto o de futuras)
- **Tactic violada**: *Deployment Observability*
- **Localização**: `src/backend/index.ts` (sem endpoint), `src/frontend/app/*` (sem exposição de build ID)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "git rev-parse\|BUILD_SHA\|RENDER_GIT_COMMIT" src/backend/ src/frontend/
  (0 matches)
  ```
  Render injeta `RENDER_GIT_COMMIT` automaticamente; Vercel injeta `VERCEL_GIT_COMMIT_SHA`. Nenhum dos dois é lido/exposto.
- **Impacto técnico**: quando um analista reportar "a aba NDe está estranha", não há como o dev saber, em ≤ 30s, se o FE que ele está olhando fala com o BE da mesma release. Precisa ir no dashboard Render **e** no dashboard Vercel e comparar `git commit` por olho.
- **Impacto de negócio**: cada incidente pós-deploy carrega uma taxa fixa de "descobrir o SHA" que atrasa MTTR em 5–15 min.
- **Métrica de baseline**: **0 endpoints com `sha`/`version`**; tempo estimado para descobrir SHA hoje: **≥ 5 min** (comparação de dashboards).

### F-deployability-5: Reconciliação FE↔BE do KPI `ndePendentes` depende de **exatamente** a mesma definição em dois lugares

- **Severidade**: P3 (baixo — cerca de contrato interno, não risco de deploy imediato)
- **Tactic violada**: *Logical Grouping* (definição duplicada é atrito de manutenção, não de deploy propriamente)
- **Localização**: `src/backend/domain/repository/recebimentos/NdeRepository.ts:105-116` e `src/frontend/lib/recebimentos.ts:179-183`
- **Evidência (objetiva)**:
  ```
  # Backend (SQL):
  NOT (COALESCE(n.status_emissao, '') = 'emitida'
       AND COALESCE(e.nde_autorizado, false) = true)
  # Frontend (TS):
  !(n.statusEmissao === 'emitida' && n.ndeAutorizado === true)
  ```
  As duas expressões precisam concordar; comentário no FE reconhece explicitamente a duplicação ("Mesma definição do COUNT do backend"). No delta é intencional (o KPI cai no `computeKpis` de fallback quando `json.kpis.ndePendentes` está ausente — que é o cenário BE-antigo × FE-novo do F-2), mas cria uma trilha de divergência silenciosa se alguém mudar só um lado.
- **Impacto técnico**: KPI do card e contagem da tabela podem discordar após alguma refatoração futura sem que qualquer teste-e2e pegue.
- **Impacto de negócio**: analista vê "3 pendentes" no card e 4 linhas amarelas na tabela — perde confiança na ferramenta.
- **Métrica de baseline**: **2 expressões idênticas em linguagens diferentes**, **0 teste cross-boundary** que force as duas a concordar sobre um fixture.

## 5. Cards Kanban

### [deployability-1] Adicionar job `deploy` orquestrado no CI (BE primeiro, healthcheck, depois FE)

- **Problema**
  > Render (BE) e Vercel (FE) deployam por webhook independente, sem ordem. Para o delta **v0.23.0** o risco é nulo porque o contrato é aditivo, mas a próxima feature breaking (por exemplo, remoção de `correlationId` da resposta) vai depender de operador humano lembrando de "deploya BE, espera 90s, promove FE". Débito herdado do run 2026-06-22.

- **Melhoria Proposta**
  > No `.github/workflows/ci.yml`, adicionar job `deploy` (needs: `backend`, `frontend`) que: (1) dispara Render deploy via API e faz polling do `deploy.status` até `live`; (2) só então promove o deployment Vercel via `vercel promote`. Manter o `tag-release` como está, apenas mover para depois de `deploy`. Aprovação manual via `environment: production` em GitHub Actions.

- **Resultado Esperado**
  > Deploy sequenciado: BE em produção e servindo antes de FE apontar para ele. Aplicável tanto a deltas aditivos (silencioso) quanto a breaking (crítico).
  - Tempo de deploy end-to-end: hoje ~90s paralelos → 120–180s sequenciais (aceitável)
  - Jobs `deploy` no CI: **0 → 1**
  - Breaking changes seguras sem plano manual: **0/N → N/N**

- **Tactic alvo**: Scale Rollouts + Deployment Observability
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — inclui token Render/Vercel + healthcheck endpoint)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Ordem de deploy determinística: **0% garantida hoje → 100% garantida**
  - Rollback de FE por incompatibilidade com BE novo: mede-se por incidentes; alvo **0 nos próximos 3 meses**
- **Risco de não fazer**: primeira feature breaking pós-desta vai vazar erro para o usuário na janela de skew.
- **Dependências**: nenhuma para este delta; bloqueia entregas breaking futuras.

### [deployability-2] Expor `GET /deployinfo` (backend) e `<meta name="build-sha">` (frontend)

- **Problema**
  > Diagnóstico de skew hoje exige comparar dashboards Render e Vercel manualmente. Numa incidência pós-deploy da aba NDe, o dev perde 5–15 min só para descobrir se FE e BE são da mesma release.

- **Melhoria Proposta**
  > Backend: rota `GET /deployinfo` (fora do gate `RECEBIMENTOS_ENABLED`) devolvendo `{sha, buildTime, version}` a partir de `RENDER_GIT_COMMIT`/`package.json`. Frontend: injetar `VERCEL_GIT_COMMIT_SHA` no `<meta name="build-sha">` do `layout.tsx` e num rodapé discreto (`text-xs text-muted-foreground`). Documentar no `DEPLOY.md` como "checklist pós-deploy".

- **Resultado Esperado**
  > Dev abre DevTools > Elements, lê o meta, faz `curl /deployinfo`, compara em ≤ 30s.
  - Tempo para descobrir SHA: **≥ 5 min → ≤ 30s**
  - Endpoints `/deployinfo`: **0 → 1**

- **Tactic alvo**: Deployment Observability
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - MTTR de "qual SHA está no ar": ≥ 5 min → ≤ 30s
  - Confidence em rollback: aumenta ao permitir verificar que rollback realmente virou live
- **Risco de não fazer**: cada incidente futuro carrega taxa fixa de diagnóstico manual de skew.
- **Dependências**: nenhuma.

### [deployability-3] Teste de contrato cross-boundary para a definição de `ndePendentes`

- **Problema**
  > A definição de "NDe pendente" (`NOT (statusEmissao === 'emitida' AND ndeAutorizado === true)`) vive **em duas linguagens diferentes** (SQL no `NdeRepository.contarPendentes`, TS no `computeKpis` do FE) e o próprio comentário reconhece: "Mesma definição do COUNT do backend". A duplicação é intencional para o cenário de skew (F-2), mas nada garante que continue idêntica após refatoração.

- **Melhoria Proposta**
  > Adicionar `src/frontend/lib/recebimentos.contract.test.ts` que consome um fixture JSON gerado por um teste de backend (`RecebimentosPainelService.contract.test.ts`) e verifica: dado o mesmo array de `NdePainelRow`, `computeKpis(...).ndePendentes` == `kpis.ndePendentes` calculado no backend. Rodar em CI (job `frontend`).

- **Resultado Esperado**
  > Divergência FE/BE na definição de pendente vira erro de teste, não bug em produção.
  - Testes cross-boundary da definição de KPI: **0 → 1**
  - Cobertura da regra "NOT (emitida AND autorizada)": presente **apenas em produção** → **presente em CI**

- **Tactic alvo**: (não é Bass estrito — é *contract testing* / *modifiability*; cross-QA)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Testes que morrem se alguém tocar só um dos dois lados: 0 → 1
- **Risco de não fazer**: dívida técnica silenciosa que só aparece quando um analista reclamar de "card diz 3, tabela mostra 4".
- **Dependências**: nenhuma.

### [deployability-4] Documentar no `DEPLOY.md` a política "delta migration-free = rollback-safe"

- **Problema**
  > O delta v0.23.0 é rollback-safe **por design** (0 migrations, contrato aditivo, escritas em colunas pré-existentes), mas o `DEPLOY.md` não fala nada sobre quando um rollback é seguro sem coordenação com DBA/dados. Falta a doutrina explícita — a próxima pessoa que precisar reverter em fim de tarde vai hesitar.

- **Melhoria Proposta**
  > Adicionar seção `## 5. Rollback` ao `DEPLOY.md` com árvore de decisão: (a) delta contém `src/backend/migrations/*.sql` novo? → rollback exige coordenação (script down ou aceitar coluna órfã); (b) delta muda contrato de endpoint público? → verificar aditividade; (c) delta introduz nova env? → confirmar que ausência não trava boot. Referenciar `BootMigrator` e `RECEBIMENTOS_ENABLED` como kill-switches.

- **Resultado Esperado**
  > Operador consegue decidir sozinho, em ≤ 2 min, se pode reverter sem envolver time.
  - Seções sobre rollback no `DEPLOY.md`: **0 → 1**
  - Tempo de decisão "posso reverter agora?": estimado ≥ 15 min (ir buscar dev) → ≤ 2 min (ler doc)

- **Tactic alvo**: Rollback + Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Doc de rollback presente e datada
  - Kill-switch `RECEBIMENTOS_ENABLED` referenciado como saída de emergência
- **Risco de não fazer**: doutrina de rollback vive só na cabeça de dois devs; primeiro incidente fora do horário comercial paga o custo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo `--quick` respeitado**: não rodei `npm run build` de produção; bundle FE e tempo real de deploy Render ficaram como "não medível localmente".
- **Achado central**: o delta é **exemplar do ponto de vista de deployability** — migration-free, aditivo, mesma versão FE/BE, sem env nova, sem passo de CI novo. Score 8 (não 10) porque os débitos herdados (não-atomicidade FE/BE, ausência de `/deployinfo`) são reais e nesta feature ficam neutralizados só por sorte de design, não por mecanismo.
- **Cross-QA para o consolidator**:
  - **Availability**: a hidratação `com297` com `.catch(() => undefined)` (RecebimentosPainelService.ts:290-303) é *Fault Tolerance*, mas também *Deployment Observability* — falha silenciosa aqui adia reconciliação e o KPI degrada.
  - **Performance**: cold start Render + primeiro `hidratarNdes` de 20 GETs sequencialmente-em-lotes pode dar a impressão de "deploy lento" no primeiro carregamento pós-boot.
  - **Modifiability**: F-5 (duplicação da definição de "pendente" em SQL+TS) é primariamente modifiability; entrou aqui porque a duplicação **existe por causa** da tolerância a skew de deploy — é o tipo de finding que precisa aparecer nas duas seções para o consolidator ver o trade-off.
- **Não gerei card para F-2** porque é um positivo (documentação de que o design cobriu o risco); vale como baseline explicitada para futuras reviews.
