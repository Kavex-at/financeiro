---
qa: Deployability
qa_slug: deployability
run_id: 2026-07-24-2153
agent: qa-deployability
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 8.2
findings_count: 5
cards_count: 5
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge em `main` (PR do scaffold Frente IV) | Push dispara CI (`ci.yml`) → auto-deploy Render → `preDeployCommand: npm run migrate && npm run seed:admin` → boot | 7 migrations 0032–0038 + gate `recebimentosGate` + rotas `/recebimentos/*` + DI bindings (`registerRecebimentosPorts`) | Produção multi-usuário (Columbia Trading), sem `RECEBIMENTOS_ENABLED` setado no dashboard Render | Migrations aplicam-se aditivamente (idempotentes), rotas ficam **dark-launched** (403), tráfego SISPAG/Permutas segue intacto, rollback = deixar as tabelas vazias (ninguém escreve) | 0% de regressão em rotas existentes; TTF (Time-To-Flip) do gate ≤ 5 min via env var; rollback sem migration reversa em ≤ 15 min |

> Este scaffold é **contracts-first + fully-stubbed**. A superfície observável do módulo em prod é: 7 tabelas vazias + `/recebimentos/painel` (echo `[]`) + `/recebimentos/pipeline/run` (protegido por `requireRole('admin')` + `heavyRouteLimiter`). Toda a lógica real virá atrás dos ports/tokens. O cenário Bass acima cobre a promessa central: **ship-disabled é seguro**.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| # migrations novas (Frente IV) | 7 (0032–0038) | Numeração sequencial sem colisão | ✅ | `ls src/backend/migrations/003[2-8]_*.sql` |
| % migrations com `CREATE TABLE IF NOT EXISTS` | 100% (7/7) | 100% (idempotent DDL) | ✅ | `grep -c "IF NOT EXISTS" migrations/003[2-8]_*.sql` (7 tabelas + 17 índices IF NOT EXISTS) |
| # `ALTER`/`DROP` destrutivos nas 7 migrations | 0 | 0 (forward-only aditivo) | ✅ | `grep -rn "ALTER TABLE\|DROP" migrations/003[2-8]_*.sql` |
| Colisão de numeração com main | 0 (último em main = 0031) | 0 | ✅ | `ls migrations/003*.sql` — 0031 sispag_modalidade → 0032+ Frente IV, contíguo |
| Feature-gate default em produção sem env | `false` (bloqueado) | `false` (fail-safe) | ✅ | `EnvironmentProvider.ts:47-52` — `resolveRecebimentosEnabled` retorna `environment !== 'production'` |
| Feature-gate exposta no blueprint (`render.yaml`) | ❌ ausente | Presente (mesmo com `sync:false`) para descobrabilidade | ❌ | `grep RECEBIMENTOS render.yaml` → 0 hits |
| Feature-gate documentada em `DEPLOY.md` | ❌ ausente | Presente | ❌ | `grep -i recebimentos DEPLOY.md` → 0 hits |
| Testes do fail-safe do gate (paridade com SISPAG) | ❌ ausente | 1 teste espelhando `SISPAG_ENABLED` | ❌ | `grep RECEBIMENTOS EnvironmentProvider.test.ts` → 0 hits (SISPAG tem em `test:89-109`) |
| Idempotência do bind DI (`registerRecebimentosPorts`) | ✅ guard `container.isRegistered(NEXXERA_GATEWAY_TOKEN)` | Register-once, no-op no rebind | ✅ | `recebimentosContainer.ts:41` |
| Idempotência do bootstrap Postgres+Migrations | ✅ `bootstrapped` flag + `schema_migrations` | Múltiplas chamadas = 1 side-effect | ✅ | `appContainer.ts:11,55,72` + `runMigrations.ts:26-50` |
| Isolamento do failure blast-radius no boot | ✅ prod = fail-loud, dev = warn-skip | Prod trava, dev não bloqueia esqueleto | ✅ | `appContainer.ts:25-45` + `appContainer.test.ts:62-66` |
| Ledger write-ahead com `UNIQUE(idempotency_key)` | ✅ presente em `recebimento_execucao` e `nota_debito_eletronica` | Retry no deploy nunca duplica | ✅ | `0035_recebimento_execucao.sql:27` + `0038_nota_debito_eletronica.sql:22` |
| Rollback sem migration reversa | Viável (tabelas ficam vazias com gate off) | Documentado como estratégia oficial | ⚠️ parcial | Nenhum `.md` de runbook para Frente IV; runbook único é `docs/runbooks/fin010-write-cutover.md` |
| Suite verde após scaffold | 675/675 (~22s) | 100% | ✅ | `_shared-metrics.md` |
| typecheck / lint | 0 err / 28 warns pré-existentes | Sem regressão | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: tempo real do `preDeployCommand: npm run migrate` no Render, e o *deploy success rate* de rollout multi-cliente (só existe 1 tenant — `local`). Requer log do dashboard Render + observação em stg antes de main. Recomendação: emitir um `Metric.count('migrate.applied_count', N)` no fim de `MigrationRunner.run()` já na Fase 1.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary / dark-launch) | Feature-gate `RECEBIMENTOS_ENABLED` — merge com gate `false` em prod entrega o binário sem expor a superfície. É um dark-launch canônico. | ✅ presente | `EnvironmentProvider.ts:47-52`, `http/recebimentosGate.ts:14-22`, `index.ts:114` |
| **Rollback** | Rollback = flip do env var (gate = `false`) + redeploy do binário anterior. Migrations forward-only + tabelas vazias na Fase 0 tornam a "reversão de esquema" desnecessária. Estratégia funciona **mas não está escrita**. | ⚠️ parcial | Nenhum runbook `docs/runbooks/recebimentos-*.md`; padrão herdado de `fin010-write-cutover.md` só cobre a Frente III |
| **Script Deployment Commands** | `render.yaml` + `preDeployCommand: npm run migrate && npm run seed:admin` + `CI ci.yml` (audit → typecheck → lint → test --coverage → build → tag idempotente). | ✅ presente | `render.yaml:14-22`, `.github/workflows/ci.yml:17-73` |
| **In-Vivo Testing** (staging antes de prod) | Único branch cadastrado no blueprint é `main` (auto-deploy). Não há stg/uat isolado no `render.yaml`; ci roda em `dev` também mas sem serviço Render pareado. | ⚠️ parcial | `render.yaml:11` `branch: main`; `.github/workflows/ci.yml:5` triggers em `main` e `dev` |
| **Logical Grouping** | Módulo Frente IV isolado por prefixo (`domain/interface/recebimentos/`, `domain/repository/recebimentos/`, `domain/service/recebimentos/`, `http/recebimentosGate.ts`, `routes/recebimentos.ts`, `recebimentosContainer.ts`). Cada peça tem escopo próprio → blast-radius contido. | ✅ presente | `_shared-metrics.md` scaffold inventory + `recebimentosContainer.ts` |
| **Physical Grouping** | Monolito Express único no Render (`financeiro-backend`). Não há separação física por frente — Frente IV compartilha runtime com SISPAG/Permutas. | N/A (por design — Render single-service; sem AWS Lambda ainda) | `render.yaml:6-8` |
| **Package Dependencies** | Nenhuma dep npm nova adicionada pelo scaffold (só `zod`/`tsyringe` já presentes). `package-lock.json` commitado. `npm audit --audit-level=high` gate em CI. | ✅ presente | `.github/workflows/ci.yml:24`; scaffold sem `package.json` diff |
| **Surge Protection** | `heavyRouteLimiter` aplicado em `POST /recebimentos/pipeline/run`; `requireRole('admin')` bloqueia usuário comum. Mas: o gate é chamado a **cada request** (`bootstrapAppContainer()` guardado, mas ainda é uma resolve de `EnvironmentProvider`), sem cache adicional além do `bootstrapped` flag global. | ✅ presente | `routes/recebimentos.ts:45`, `http/recebimentosGate.ts:15` |
| **Manage Configuration** | Feature-gate segue o padrão da casa: `readEnv('RECEBIMENTOS_ENABLED')` com fail-safe. **Porém a variável não aparece em `render.yaml` nem em `DEPLOY.md`** — o operador que quiser ligar o módulo em prod precisa saber do nome só por leitura de código. | ⚠️ parcial | `EnvironmentProvider.ts:47-52` (bom); `render.yaml` + `DEPLOY.md` (ausência) |
| **Idempotent Deploys** | Todas as 7 migrations usam `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`; `schema_migrations` filtra re-execução; DI bind com guard `isRegistered(...)`; `bootstrapAppContainer` com `bootstrapped` flag. Redeploy = no-op. | ✅ presente | `runMigrations.ts:26-50`, `recebimentosContainer.ts:41`, `appContainer.ts:11,72` |
| **Reproducible Builds** | `package-lock.json` versionado, `npm ci` no CI e no build do Render, Node 24 pin (`ci.yml:20`). Nenhuma dep dinâmica no build. | ✅ presente | `.github/workflows/ci.yml:19-23`; `render.yaml:18` |
| **Drift Detection** | Não há workflow que rode `npm run migrate --dry-run` contra prod, nem diff `schema_migrations` vs. `ls migrations/`. | ❌ ausente | `.github/workflows/*.yml` sem step de drift; sem `docs/runbooks/schema-drift.md` |
| **Per-Tenant Blast-Radius Limit** | Apenas 1 tenant (`client_name=local` → Supabase pooler único). Não há tenants provisionados (CLAUDE.md §Tenants). Feature-gate é global. | N/A (roadmap SaaSo ainda não iniciado — CLAUDE.md marca como "alvo") | `CLAUDE.md` §Tenants |
| **Deployment Observability** | `console.log(`[migrate] applied N migration(s)`)` no runner; nenhum métrico estruturado. Health-check em `/health` (blueprint). | ⚠️ parcial | `runMigrations.ts:23`, `render.yaml:22` |

Não há tactic de Bass ignorada — todas foram avaliadas e as duas N/A têm justificativa de uma linha.

## 4. Findings (achados)

### F-deployability-1: `RECEBIMENTOS_ENABLED` ausente do `render.yaml` e do `DEPLOY.md`

- **Severidade**: P1
- **Tactic violada**: Manage Configuration / Script Deployment Commands
- **Localização**: `render.yaml:23-62`, `DEPLOY.md:22-56`
- **Evidência (objetiva)**:
  ```
  $ grep -in recebimentos render.yaml DEPLOY.md
  (0 hits)
  $ grep -in SISPAG render.yaml
  32:      # Frente II (SISPAG) liberada em produção (v0.17.4). ...
  33:      - key: SISPAG_ENABLED
  34:        value: 'true'
  ```
  O gate `SISPAG_ENABLED` foi declarado no blueprint quando a Frente II veio; o simétrico `RECEBIMENTOS_ENABLED` não foi. Ele existe só em código (`EnvironmentProvider.ts:47-52`).
- **Impacto técnico**: fail-safe do gate funciona (o módulo entra em prod bloqueado), mas o operador que precisar ligar em stg/uat/prod não tem como descobrir o nome da variável sem grep no código. Aumenta MTTR de qualquer cutover.
- **Impacto de negócio**: cutover manual descoberto por leitura de código = risco de digitar `RECEBIMENTO_ENABLED` (sem "S") ou setar em ambiente errado; lead-time da Fase 1 de Recebimentos empurrado por 1 ida-e-volta com o dev.
- **Métrica de baseline**: **0 menções** a `RECEBIMENTOS_ENABLED` em `render.yaml` (0 linhas) e `DEPLOY.md` (0 linhas). SISPAG tem 3 linhas de contexto + var declarada.

### F-deployability-2: Sem teste de paridade `RECEBIMENTOS_ENABLED` (fail-safe do gate não regride)

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts / Manage Configuration
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.test.ts:89-109` (SISPAG tem; Recebimentos falta)
- **Evidência (objetiva)**:
  ```
  $ grep -c RECEBIMENTOS src/backend/domain/libs/environment/EnvironmentProvider.test.ts
  0
  $ grep -c SISPAG src/backend/domain/libs/environment/EnvironmentProvider.test.ts
  4
  ```
  `resolveRecebimentosEnabled` foi criado no scaffold (EnvironmentProvider.ts:47-52) mas o teste correspondente ao de SISPAG (que valida fail-safe em prod, override por env, comportamento fora de prod) não foi replicado.
- **Impacto técnico**: um refactor futuro em `resolveRecebimentosEnabled` pode inverter o fail-safe (`environment === 'production'` em vez de `!==`) e passar em CI. Toda a promessa de "ship-disabled é seguro" depende dessa linha.
- **Impacto de negócio**: um deploy que acidentalmente ligue o módulo em prod expõe `POST /recebimentos/pipeline/run` (admin-gated, mas ainda write-ish) antes de a lógica estar pronta.
- **Métrica de baseline**: **0 casos de teste** cobrindo `recebimentosEnabled` (SISPAG tem 4 asserts no mesmo `it`).

### F-deployability-3: Falta runbook de cutover e rollback da Frente IV

- **Severidade**: P2
- **Tactic violada**: Rollback / Script Deployment Commands
- **Localização**: `docs/runbooks/` (só existe `fin010-write-cutover.md`)
- **Evidência (objetiva)**:
  ```
  $ ls docs/runbooks/
  fin010-write-cutover.md
  ```
  A estratégia de rollback do scaffold é única no repo (flip do gate + redeploy do binário anterior — migrations forward-only não regridem porque tabelas ficam vazias). Isso não está escrito em lugar nenhum.
- **Impacto técnico**: sob incidente, o operador de plantão vai tentar reverter migration (não é possível — 0035 tem `BIGSERIAL PRIMARY KEY` sem downgrade) ou vai deixar o gate ligado por falta de procedimento.
- **Impacto de negócio**: MTTR de incidente na Frente IV é indefinido; risco de rollback errado ao chegar tráfego real na Fase 1.
- **Métrica de baseline**: **0 runbooks** para Frente IV; **1 runbook** para Frente III (`fin010-write-cutover.md`).

### F-deployability-4: Ausência de drift detection do `schema_migrations`

- **Severidade**: P2
- **Tactic violada**: Drift Detection
- **Localização**: `.github/workflows/ci.yml` (sem step de drift), `runMigrations.ts` (sem verificação de "arquivos aplicados mas ausentes do disco")
- **Evidência (objetiva)**:
  ```
  $ grep -n "drift\|schema_migrations" .github/workflows/*.yml
  (0 hits)
  ```
  O runner filtra `applied.has(file)` mas não detecta o caso oposto (migration em `schema_migrations` que sumiu do disco — sinal de rebase mal resolvido). Com 7 migrations novas no mesmo PR e outras 3 frentes ativas, o risco de colisão de numeração num rebase mal-feito é real.
- **Impacto técnico**: um squash-merge acidental pode remover uma migration já aplicada em stg; o runner segue sem barulho e um índice/tabela some silenciosamente.
- **Impacto de negócio**: incidente de esquema descoberto só no primeiro `INSERT` da feature real (Fase 1) — hora, não minuto.
- **Métrica de baseline**: **0 verificações** de drift no CI; **0 alertas** configurados sobre `schema_migrations` divergindo de `ls migrations/`.

### F-deployability-5: Único ambiente Render — não há gate de rollout stg → prd

- **Severidade**: P3
- **Tactic violada**: In-Vivo Testing / Scale Rollouts
- **Localização**: `render.yaml:11` (`branch: main`), `.github/workflows/ci.yml:5`
- **Evidência (objetiva)**:
  ```
  render.yaml:11:    branch: main
  ci.yml:5-7:  push branches [main, dev]  (mas nenhum service Render para `dev`)
  ```
  CI roda no branch `dev`, mas o blueprint Render tem 1 único serviço apontando para `main`. Não há service de staging que espelhe o pipeline antes do prd.
- **Impacto técnico**: qualquer merge em `main` vai direto ao ambiente único com tráfego real. O fail-safe do gate mitiga (o módulo Frente IV entra dormido), mas outras frentes não têm o mesmo escudo — o scaffold **não introduz** o problema, apenas herda-o.
- **Impacto de negócio**: ainda tolerável na fase atual (1 cliente, poucos usuários); vira P1 quando entrar o 2º tenant ou quando `RECEBIMENTOS_ENABLED=true` chegar em prd.
- **Métrica de baseline**: **1 environment** ativo no `render.yaml` (target: ≥ 2 — stg + prd).

## 5. Cards Kanban

### [deployability-1] Declarar `RECEBIMENTOS_ENABLED` no `render.yaml` e documentar em `DEPLOY.md`

- **Problema**
  > O feature-gate `RECEBIMENTOS_ENABLED` existe só em código (`EnvironmentProvider.ts:47-52`). Nem `render.yaml` nem `DEPLOY.md` mencionam a variável. Um operador que precise ligar/desligar a Frente IV em prod tem que descobrir o nome via grep. SISPAG teve o mesmo cuidado quando entrou (linhas 32-34 do blueprint) — só a Frente IV ficou de fora.

- **Melhoria Proposta**
  > Adicionar entrada em `render.yaml` (mesmo com `sync: false`, para o operador ver que a chave existe) e uma linha em `DEPLOY.md` explicando o default (fail-safe: bloqueado em prod). Espelhar o padrão SISPAG. Tactic Bass alvo: **Manage Configuration**.

- **Resultado Esperado**
  > Operador consegue descobrir e ligar/desligar Frente IV sem ler código.
  > Menções a `RECEBIMENTOS_ENABLED`: 0 → ≥ 2 (`render.yaml` + `DEPLOY.md`).

- **Tactic alvo**: Manage Configuration
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Ocorrências de `RECEBIMENTOS_ENABLED` em `render.yaml`: 0 → 1
  - Ocorrências em `DEPLOY.md`: 0 → ≥ 1 (com nota de fail-safe)
  - TTF (Time-To-Flip) do gate por novo operador: hoje = "achar no código" → alvo = "≤ 5 min lendo DEPLOY.md"
- **Risco de não fazer**: Fase 1 de Recebimentos atrasa 1 ciclo por cutover mal-orquestrado; risco de digitar nome de var errado no dashboard e "não entender por que não ligou".
- **Dependências**: nenhuma.

### [deployability-2] Adicionar teste do fail-safe de `RECEBIMENTOS_ENABLED` (paridade com SISPAG)

- **Problema**
  > `resolveRecebimentosEnabled` foi criado no scaffold, mas o teste espelho ao de SISPAG (`EnvironmentProvider.test.ts:89-109`) não foi replicado. Um refactor futuro pode inverter o `!==` e ninguém percebe.

- **Melhoria Proposta**
  > Copiar o `it('sispagEnabled: …', …)` das linhas 89-109 renomeando pra `recebimentosEnabled`, cobrindo: força `true`, força `false`, sem env + prod → `false`, sem env + local → `true`. Tactic Bass alvo: **Scale Rollouts** (proteger o mecanismo de dark-launch).

- **Resultado Esperado**
  > Fail-safe do gate coberto por teste unitário.
  > Casos de teste sobre `recebimentosEnabled`: 0 → 4.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Asserts em `EnvironmentProvider.test.ts` cobrindo `recebimentosEnabled`: 0 → ≥ 4
  - Coverage de `resolveRecebimentosEnabled`: incerto (não medido pós-scaffold) → 100% branch
- **Risco de não fazer**: dark-launch quebra silenciosamente num refactor futuro; a Frente IV vira a Frente III (que ficou 6 meses com escrita ligada em dry-run mudo).
- **Dependências**: nenhuma.

### [deployability-3] Escrever runbook de cutover e rollback da Frente IV

- **Problema**
  > A estratégia de rollback da Frente IV é única no repo (flip do gate + redeploy do binário anterior; sem migration reversa, pois as 7 tabelas 0032–0038 ficam vazias enquanto o gate estiver `false`). Essa estratégia **funciona** mas **não está escrita** em nenhum lugar — o operador de plantão vai tentar `DROP TABLE` ou reverter migration (impossível: 0035 tem `BIGSERIAL PRIMARY KEY`).

- **Melhoria Proposta**
  > Criar `docs/runbooks/recebimentos-cutover.md` cobrindo: (1) como ligar o gate (env var + redeploy), (2) o que observar nas primeiras horas, (3) rollback padrão = flip gate + previous release, (4) rollback "duro" = manter tabelas vazias (nunca `DROP`), (5) critérios de re-enable. Espelhar o formato de `fin010-write-cutover.md`. Tactic Bass alvo: **Rollback + Script Deployment Commands**.

- **Resultado Esperado**
  > Rollback de incidente da Frente IV parametrizado; MTTR previsível.
  > Runbooks: 1 (Frente III) → 2 (+ Frente IV).

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - `docs/runbooks/recebimentos-*.md`: 0 → 1
  - MTTR estimado em tabletop: indefinido → ≤ 15 min
- **Risco de não fazer**: primeiro incidente em prod da Frente IV terá tratamento improvisado; risco de `DROP TABLE` errado (as 7 tabelas têm FKs entre si — 0033→0032, 0034→0033, 0035→0033).
- **Dependências**: [deployability-1] (para o runbook citar o nome oficial da env var).

### [deployability-4] Instrumentar drift detection do `schema_migrations`

- **Problema**
  > O `MigrationRunner` filtra "migrations do disco não aplicadas" mas ignora o cenário oposto: "migrations registradas em `schema_migrations` que sumiram do disco" (sinal clássico de rebase mal resolvido). Com 7 migrations novas no mesmo PR e 3 frentes ativas paralelas, colisão de numeração num squash-merge é risco real e silencioso.

- **Melhoria Proposta**
  > Passo #1 no `MigrationRunner.run()`: `SELECT name FROM schema_migrations` → comparar com `readdirSync(...)` e logar `WARN` (fail-loud em prod se >0 registros órfãos). Alternativa mais leve: adicionar step no `ci.yml` que compara `git diff --name-only main -- migrations/` contra numeração esperada. Tactic Bass alvo: **Drift Detection**.

- **Resultado Esperado**
  > CI detecta rebase de migration que apagou histórico.
  > Órfãos toleráveis silenciosamente: 100% (hoje) → 0.

- **Tactic alvo**: Drift Detection
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Casos de "migration em `schema_migrations` sem arquivo no disco" detectados: 0 → 100%
  - Novo teste em `runMigrations.test.ts`: +1
- **Risco de não fazer**: perda silenciosa de tabela após rebase mal resolvido; descoberto só no primeiro `INSERT` da Fase 1.
- **Dependências**: nenhuma.

### [deployability-5] Provisionar staging Render separado do prod (roadmap)

- **Problema**
  > O `render.yaml` tem 1 único serviço apontando pra `main`; CI roda em `dev` mas nada consome esse pipeline. Todo merge em `main` vai direto ao ambiente único com tráfego real. Não é culpa do scaffold (herdado do setup atual), mas a Frente IV entra numa arquitetura onde o dark-launch é a única linha de defesa.

- **Melhoria Proposta**
  > Adicionar um segundo `service` no `render.yaml` (`financeiro-backend-stg`) apontado pro branch `dev`, com `RECEBIMENTOS_ENABLED=true` e banco Supabase separado. Fase seguinte, gate de PR: "merge em main só depois de smoke em stg". Tactic Bass alvo: **In-Vivo Testing + Scale Rollouts**.

- **Resultado Esperado**
  > Staging real onde a Frente IV pode ser ligada antes de prd.
  > Ambientes ativos: 1 → 2.

- **Tactic alvo**: In-Vivo Testing
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Services no `render.yaml`: 1 → 2
  - Deploys em prd sem passar por stg: 100% → ≤ 10%
- **Risco de não fazer**: primeiro cutover real da Frente IV (`RECEBIMENTOS_ENABLED=true`) acontece direto em prod; o gate cai só em uma linha de defesa (o próprio código do módulo).
- **Dependências**: decisão de custo (nova instância Render + novo Supabase); fora do escopo do scaffold, mas o scaffold intensifica a necessidade.

## 6. Notas do agente

- Escopo respeitado: julguei **exclusivamente** o scaffold Frente IV listado em `_shared-metrics.md` — não filei findings por "lógica de negócio ausente" nos stubs (é por design).
- Não executei `npm run build`/`npm test` nem `terraform plan` (modo `--quick`); confiei nas métricas verificadas do `_shared-metrics.md` (675/675 testes, typecheck limpo, lint sem regressão).
- **Cross-QA para o consolidator**: (a) F-deployability-2 (falta de teste do gate) tem sobreposição com Testability e Security — o consolidator pode escolher onde alocar; deixei aqui porque o dano se manifesta como incidente de deploy. (b) F-deployability-4 (drift) toca Modifiability (mecânica de rebase) e Fault-Tolerance (dado silencioso). (c) A ausência de staging (F-deployability-5) é P3 aqui mas pode ser P1 na visão de Availability quando o 2º tenant chegar.
- Score 8.2 reflete: **base sólida** (7 migrations 100% aditivas/idempotentes, DI register-once, bootstrap `bootstrapped`-guarded, gate com fail-safe correto, blast-radius contido por prefixo `recebimentos*`), penalizada por 2 lacunas de documentação/paridade (F-1, F-2), 1 gap de runbook (F-3), 1 ausência de drift (F-4) e a herança do single-environment (F-5).
