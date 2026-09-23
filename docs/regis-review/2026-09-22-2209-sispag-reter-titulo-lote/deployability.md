---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-22-2209
agent: qa-deployability
generated_at: 2026-09-22T22:09:00-03:00
scope: backend+frontend (delta de sispag-reter-titulo-lote)
score: 8.2
findings_count: 3
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (Columbia/Kavex) merge em `main` | Push com a migration `0062_titulo_retencao_formacao.sql` (tabela nova, índice único parcial, 3 CHECKs) e duas rotas admin novas (`POST .../retirar-do-lote`, `DELETE .../retencao`) | `BootMigrator` (roda antes de `app.listen`), `LotePagamentoService`, painel SISPAG | Produção — Render `autoDeploy: true`, sem passo humano entre merge e deploy; Supabase e Conexos só existem de verdade em produção | Deploy aplica a migration aditiva atomicamente no boot; se falhar, processo sai com código 1 e o Render **não promove**, mantendo a versão anterior no ar; se subir, as duas rotas ficam navegáveis só para `admin` | 0 downtime perceptível em deploy aditivo; MTTR de rollback documentado em ≤5min (`docs/runbooks/rollback.md`); 0 escrita no ERP nesta feature (risco confinado ao Postgres próprio) |

Este QA avalia o **delta**: a arquitetura de deploy em si (Render + Supabase + Vercel, sem `infra/`/Terraform) é pré-existente e já passou por ciclos anteriores de Regis-Review (cards `deployability-3`, `rollback-0054`, `lock-timeout-not-valid`, citados no próprio código). O que muda aqui é uma migration nova e duas rotas novas dentro de um painel (SISPAG) já habilitado em produção.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migration do delta é aditiva (sem DROP/RENAME/UPDATE em massa) | Sim — só `CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` + `ADD CONSTRAINT` (idempotentes, `DROP CONSTRAINT IF EXISTS` antes de cada `ADD`) | Migrations do delta devem cair na linha "aditiva = seguro reverter só o código" da matriz de `rollback.md` | ✅ | `src/backend/migrations/0062_titulo_retencao_formacao.sql:26-56` |
| Migration testada contra Postgres real no delta | 0 de 1 (só teste de forma via regex sobre o texto SQL) | Migrations com DDL não-trivial (índice parcial + 3 CHECKs) deveriam ter ao menos 1 caso em `*.integration.test.ts` (padrão já existe no repo) | ⚠️ | `src/backend/migrations/retencaoFormacao.test.ts` (regex sobre `SQL`) vs. único integration real do repo: `src/backend/migrations/vwMetricasCiclo.integration.test.ts` |
| Rotas novas atrás de gate de autorização | 2 de 2 (`requireRole('admin')`) | 100% das rotas de escrita admin-only | ✅ | `src/backend/routes/sispag.ts:275,311` |
| Rotas novas atrás de um feature flag dedicado / kill-switch específico | 0 de 2 — herdam só o `SISPAG_ENABLED` do painel (já `true` em prod) | N/A para escrita que não toca o ERP (padrão do repo: `SISPAG_LIVE_WRITE_ENABLED`/`CONEXOS_WRITE_ENABLED` só existem para caminhos que escrevem no ERP) | ✅ (consistente com o padrão existente) | `render.yaml:42-56`, `src/backend/routes/sispag.ts:275,311` (nenhum `process.env`/flag novo no delta) |
| Escrita da feature atinge o ERP (Conexos) | Não — só `titulo_retencao_formacao` (Postgres próprio) | Blast radius do delta confinado ao próprio banco, não ao ERP do cliente | ✅ | `docs/regis-review/.../_shared-metrics.md:8` ("Nenhuma escrita no ERP, nenhum cálculo monetário") |
| Gates automatizados no caminho commit→prod que cobrem o delta | 6: `npm audit`, `typecheck`, `lint`, `test --coverage`, `build` (backend) + `typecheck`/`lint`/`test --coverage` (frontend); nenhum gate manual de aprovação entre merge e deploy (Render promove sozinho) | ≥5 passos automatizados; gate humano opcional antes do apply — aqui não há "apply" separado, é o próprio build/health-check do Render que decide promover | ✅ (automação) / ⚠️ (sem `plan`-equivalente nem aprovação humana — mitigado por branch protection + rollback ≤5min) | `.github/workflows/ci.yml:1-108` |
| Lockstep de versão FE/BE no momento da revisão | `0.39.1` == `0.39.1` (bump desta feature ainda não rodado — correto, acontece depois do gate Regis-Review no pipeline) | Igual em ambos `package.json` | ✅ | `src/backend/package.json`, `src/frontend/package.json` |
| Rollback documentado e com meta de tempo | Runbook dedicado, meta explícita ≤5min, matriz aditiva×destrutiva, passo de validação (`/health`, `/health/pipelines`) | Presente e específico ao stack (Render/Vercel) | ✅ | `docs/runbooks/rollback.md:1-11,17-27` |
| Script de reverse exigido para 0062? | Não exigido pela política (só DDL de criação, 0 linhas de `UPDATE`) — e o repo respeitou: não há `rollbacks/0062_*.rollback.sql` | Conformidade com `rollbacks/README.md` ("UPDATE > 1.000 linhas exige reverse") | ✅ | `src/backend/migrations/rollbacks/README.md`, ausência confirmada de `0062*.rollback.sql` |

> ⚠️ **Não medível localmente**: taxa real de sucesso de deploy no Render (deploy success rate) e tempo real de rollback executado (só a meta documentada de ≤5min). Requer acesso ao dashboard/Events do Render em produção. Recomendação: instrumentar `docs/runbooks/rollback.md` com um log pós-incidente (linha do tempo real) para os próximos 3 rollbacks executados, convertendo a meta em métrica observada.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary/blue-green/rolling) | Render substitui a instância após build + `healthCheckPath: /health` passar, antes de rotear tráfego — é um blue-green binário de 1 instância (starter plan), não canary/rolling gradual. Esta feature (2 rotas admin, sem flag própria) vai a 100% dos admins no instante em que o deploy é promovido, sem fatiar por tenant/usuário. | ⚠️ parcial (pré-existente, fora do delta — a limitação é da plataforma Render/plano `starter`, não desta feature) | `render.yaml:8-31` (`healthCheckPath: /health`) |
| **Rollback** | Runbook dedicado com meta ≤5min, decisão aditiva×destrutiva, passos de UI Render/Vercel e validação por `/health`+`/health/pipelines`. Migration do delta é aditiva → cai no caso "seguro reverter só o código" sem tocar schema. | ✅ presente | `docs/runbooks/rollback.md` |
| **Script Deployment Commands** | `render.yaml` declara build/start; `package.json` scripts (`migrate`, `build`, `start`); nenhum passo manual documentado além de setar env vars uma vez (`DEPLOY.md` checklist). Nenhum comando novo introduzido pelo delta. | ✅ presente | `render.yaml:18-19`, `src/backend/package.json:8-16` |
| **Logical Grouping** | Rotas novas vivem dentro de `routes/sispag.ts` (mesmo agrupamento lógico do painel SISPAG), serviço na já existente `LotePagamentoService`; nova tabela em repositório dedicado (`RetencaoFormacaoRepository`) em vez de sobrecarregar `TituloAPagarRepository`. | ✅ presente | `_shared-metrics.md:15-30` |
| **Physical Grouping** | N/A — deploy único (1 serviço Render + 1 site Vercel + 1 banco Supabase), sem grupos físicos por região/AZ para esta feature decidir. | N/A — arquitetura de instância única, não multi-região | `DEPLOY.md:51-124` |
| **Package Dependencies** | `package-lock.json` presente e usado (`npm ci` no CI); nenhuma dependência nova adicionada pelo delta (`_shared-metrics.md`: "sem dependência nova no delta"); `npm audit --audit-level=high` roda no CI a cada push. | ✅ presente | `.github/workflows/ci.yml:24` |
| **Surge Protection** | `express-rate-limit` já aplicado globalmente (`globalLimiter`/`heavyRouteLimiter`) antes das rotas do router; as 2 rotas novas herdam o limiter global do `buildApp.ts` sem limiter dedicado — coerente com as demais rotas admin de SISPAG (nenhuma tem limiter próprio). | ✅ presente (pré-existente, herdado) | `src/backend/http/buildApp.ts:25`, `src/backend/http/rateLimit.ts:18-28` |

**Idempotent deploys**: migration 0062 é idempotente ponta a ponta (`CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` antes de cada `ADD CONSTRAINT`) — confirmado por teste dedicado (`retencaoFormacao.test.ts`, caso "é idempotente e não mexe em dado"). `MigrationRunner` registra em `schema_migrations` e pula arquivo já aplicado. ✅ presente.

**Drift detection**: N/A — não há Terraform/`infra/` neste repo (deploy via Render blueprint + dashboard); o único "drift" possível é `render.yaml` vs. dashboard, e o próprio `render.yaml` documenta esse risco (`sync: false` deliberado nas envs sensíveis, ver comentário do card `deployability-3` já remediado em ciclo anterior). Nada no delta interage com isso.

**Reproducible builds**: `.tool-versions` fixa `nodejs 24.0.1` (asdf); `package-lock.json` do backend e do frontend commitados; CI usa `cache-dependency-path` no lockfile e `npm ci` (não `npm install`). Build é `tsc` puro (sem bundler/esbuild neste repo — o `build.js`/esbuild da missão genérica não existe aqui), determinístico. ✅ presente, nada alterado pelo delta.

**Per-tenant blast-radius limit**: N/A neste estágio — o app roda para um único cliente (Columbia Trading) numa única conta Render/Supabase/Vercel; a arquitetura multi-tenant com conta AWS isolada por cliente é o **estado-alvo** do CLAUDE.md, ainda não implementado. O blast radius real hoje é "toda a Columbia de uma vez", mitigado pelos kill-switches por frente (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`) e pelo fato desta feature não escrever no ERP.

**Deployment observability**: `/health` e `/health/pipelines` expõem estado pós-deploy; `GET /operacao` (admin) mostra execuções órfãs/pendentes; a feature loga cada ação (`retirarDoLote`, `liberarRetencao`) via `LogService`/`BUSINESS_INFO` com ator e chave do título, dando rastro para auditoria pós-deploy. ✅ presente, delta contribuiu logging consistente com o padrão.

## 4. Findings (achados)

### F-deployability-1: Migration 0062 nunca roda contra um Postgres real antes do boot de produção

- **Severidade**: P2
- **Tactic violada**: Idempotent deploys / verificação pré-deploy (supporting concern)
- **Localização**: `src/backend/migrations/0062_titulo_retencao_formacao.sql`, `src/backend/migrations/retencaoFormacao.test.ts`
- **Evidência (objetiva)**:
  ```
  # teste do delta valida apenas o TEXTO da migration via regex:
  const SQL = MIGRATION.replace(/--.*$/gm, '');
  expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_titulo_retencao_formacao_ativa.../);

  # único *.integration.test.ts (roda contra Postgres real no job `backend-sql` do CI) em todo o
  # diretório migrations/:
  $ find src/backend/migrations -iname "*.integration.test.ts"
  src/backend/migrations/vwMetricasCiclo.integration.test.ts
  ```
- **Impacto técnico**: um erro de sintaxe/semântica real do Postgres (por exemplo, na sintaxe do índice único parcial ou numa das 3 `CHECK CONSTRAINT`s) só seria descoberto no boot da instância nova em produção — o `BootMigrator` roda antes do `app.listen`, então o pior caso é o deploy falhar de forma segura (processo sai com código 1, Render não promove, versão anterior segue no ar), mas ainda assim consome um ciclo de deploy e atrasa a entrega.
- **Impacto de negócio**: nenhuma perda de dados ou downtime (a rede de segurança do `BootMigrator`+Render cobre isso), mas cada falha desse tipo é um ciclo de "push → CI verde → boot falha → diagnosticar → corrigir → re-deploy" que não precisaria existir se o `backend-sql` job (já existente para `vwMetricasCiclo`) cobrisse também DDL não-trivial como esta.
- **Métrica de baseline**: 0 de 1 migration do delta validada contra Postgres real em CI, versus 1 de ~62 migrations do repositório inteiro (`vwMetricasCiclo`) que usam esse padrão — **a prática já existe no repo, só não foi estendida a este delta**. Rotulado P2 (não P1) porque a rede de segurança do `BootMigrator` (falha = não promove) já limita o impacto a atraso de deploy, não a corrupção ou downtime.

### F-deployability-2: A feature entra em produção sem canário — vai a 100% dos admins no instante do deploy

- **Severidade**: P2 (pré-existente, fora do delta — limitação da plataforma Render `starter`, não desta feature)
- **Tactic violada**: Scale Rollouts (canary/rolling)
- **Localização**: `render.yaml:8-31` (arquitetura de deploy, não tocada pelo delta)
- **Evidência (objetiva)**:
  ```
  # nenhuma env/flag nova no delta que permita ligar a feature para um subconjunto de usuários:
  $ git diff origin/main...HEAD -- render.yaml DEPLOY.md
  (sem alterações)
  ```
- **Impacto técnico**: se `retirarDoLote`/`liberarRetencao` tiver um bug de concorrência não coberto pelos testes (ex.: race no índice único parcial sob carga real), todos os admins da Columbia o veem simultaneamente — não há forma de expor a 1 usuário primeiro.
- **Impacto de negócio**: dado que a feature não escreve no ERP (só Postgres próprio) e é `admin`-only, o raio de impacto de um bug é limitado a decisões de retenção incorretas, corrigíveis via `liberarRetencao` — não há risco de pagamento incorreto.
- **Métrica de baseline**: 0 mecanismo de canary/feature-flag por usuário disponível na plataforma hoje (Render `starter` = 1 instância, sem % de tráfego). Rebaixado a P2 e marcado pré-existente porque nenhum deploy deste repo — nem antes nem depois deste delta — tem essa capacidade; não é uma regressão introduzida aqui.

### F-deployability-3: Meta de rollback (≤5min) é documentada mas nunca medida com um caso real

- **Severidade**: P3
- **Tactic violada**: Rollback (deployment observability, supporting concern)
- **Localização**: `docs/runbooks/rollback.md:5` (pré-existente, fora do delta)
- **Evidência (objetiva)**:
  ```
  > Meta: reverter em ≤ 5 minutos sem consultar ninguém.
  ```
- **Impacto técnico**: sem histórico de tempos reais, não dá para saber se a meta é realista sob pressão (ex.: tempo de rebuild do Render, que o próprio runbook admite "não é instantâneo").
- **Impacto de negócio**: baixo — o runbook em si já é uma prática acima da média para o estágio do produto; a lacuna é só de instrumentação.
- **Métrica de baseline**: 0 rollbacks com tempo real registrado encontrados no repo (`CHANGELOG.md`, `docs/runbooks/`) até esta revisão.

## 5. Cards Kanban

### [deployability-1] Estender o job `backend-sql` do CI para migrations com DDL não-trivial

- **Problema**
  > A migration `0062_titulo_retencao_formacao.sql` (índice único parcial + 3 `CHECK CONSTRAINT`s) só é validada por um teste de regex sobre o texto SQL (`retencaoFormacao.test.ts`), nunca executada contra um Postgres real em CI. O repositório já tem o padrão certo (`vwMetricasCiclo.integration.test.ts`, rodado pelo job `backend-sql`), mas não foi reaplicado aqui.

- **Melhoria Proposta**
  > Tactic alvo: *Idempotent deploys* / verificação pré-deploy. Adicionar `src/backend/migrations/tituloRetencaoFormacao.integration.test.ts` no padrão do `backend-sql` job: aplicar `0062_titulo_retencao_formacao.sql` contra o Postgres efêmero do CI (`postgres:17-alpine`, já provisionado em `.github/workflows/ci.yml`), inserir uma retenção, provar o índice único parcial rejeitando duplicata ativa e os 3 CHECKs rejeitando estado inválido. Critério geral (fora do escopo imediato deste card, mas a se propor em `ontology/_inbox/`): toda migration com `CREATE UNIQUE INDEX`/`CHECK CONSTRAINT` novo ganha um integration test, não só as com `UPDATE` em massa.

- **Resultado Esperado**
  > 1 de 1 migration do delta validada contra Postgres real em CI (hoje: 0 de 1). Falhas de sintaxe/semântica de DDL não-trivial passam a aparecer no PR, antes do boot de produção.

- **Tactic alvo**: Idempotent deploys (Manage Deployed System)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Migrations do delta com integration test contra Postgres real: 0/1 → 1/1
  - Falhas de DDL descobertas em produção (boot) vs. em CI: sem baseline hoje → alvo 0 em produção
- **Risco de não fazer**: cada nova migration com DDL não-trivial continua com a mesma janela cega; em 6 meses, se o volume de migrations do domínio crescer no mesmo ritmo (62 até aqui), a probabilidade acumulada de um boot falho em produção por erro de sintaxe sobe, mesmo com a rede de segurança do `BootMigrator` limitando o dano a "deploy não promovido".
- **Dependências**: nenhuma — usa infraestrutura de CI já existente (`postgres:17-alpine` no job `backend-sql`).

### [deployability-2] Registrar o tempo real do próximo rollback executado

- **Problema**
  > `docs/runbooks/rollback.md` define a meta "reverter em ≤5min sem consultar ninguém", mas nenhum rollback real tem o tempo registrado — a meta nunca foi confrontada com a prática.

- **Melhoria Proposta**
  > Tactic alvo: Rollback / deployment observability. Adicionar ao runbook uma seção "Histórico" com 1 linha por rollback real (data, hora do deploy quebrado, hora da confirmação via `/health`, se a meta de 5min foi cumprida). Baixo custo: é só disciplina de preenchimento pós-incidente, já que o passo "Depois" do runbook já pede para abrir o incidente com linha do tempo.

- **Resultado Esperado**
  > Após os próximos 3 rollbacks, a meta de ≤5min vira métrica observada (ex.: "3/3 rollbacks em ≤5min" ou "2/3, o outro levou 8min por causa do rebuild do Render") em vez de aspiração.

- **Tactic alvo**: Rollback (Manage Deployment Pipeline)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Rollbacks com tempo real registrado: 0 → ≥3 (janela dos próximos 6 meses)
- **Risco de não fazer**: nenhum risco técnico direto; o custo é só perder a chance de validar (ou corrigir) a meta documentada antes que ela seja citada como garantia num incidente real.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: avaliei o delta de `sispag-reter-titulo-lote` (migration 0062 + `LotePagamentoService.retirarDoLote`/`liberarRetencao` + 2 rotas admin) contra a arquitetura de deploy real do repo (Render/Vercel/Supabase, **sem** `infra/`/Terraform — confirmado por `find`/`ls` vazios e pelo próprio `DEPLOY.md`). Ignorei a seção Lambda/Terraform da missão genérica onde não se aplica, mantendo o vocabulário de tactics Bass intacto.
- Findings F-deployability-2 e F-deployability-3 são explicitamente pré-existentes (limitação de plataforma / lacuna de instrumentação do runbook), não regressão desta feature — mantidos ≤P2 por instrução.
- **Cross-QA**: F-deployability-1 (migration sem integration test) converge com **Testability** (cobertura de teste do delta) e com **Fault-Tolerance** (o que acontece se `BootMigrator` falhar em produção por um erro que só apareceria contra Postgres real — a rede de segurança existe, mas não foi exercitada para este arquivo). Recomendo o consolidator citar `F-deployability-1` junto de qualquer finding de `qa-testability` sobre `RetencaoFormacaoRepository.test.ts` ser 100% mockado.
