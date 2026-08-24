---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-deployability
generated_at: 2026-08-24T18:30Z
scope: SISPAG (Frente II) — backend + frontend (Render + Vercel + Supabase compartilhada). Sem Terraform, sem tenants — layout do repo é `src/backend`/`src/frontend`; IaC/multi-tenant N/A.
score: 4
findings_count: 6
cards_count: 6
---

# Deployability — Regis-Review (SISPAG · remessa .REM + retorno .RET)

## 1. Cenário Geral (Bass General Scenario aplicado ao SISPAG desta branch)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do time (`git push` em `fix/sispag-fin015-import-shape` ou salvamento local em `tsx watch`) | Deploy do delta SISPAG (novo `RemessaService` com ledger `remessa_execucao`, novos jobs de probe/execute, migração `0049`) num backend que aplica **migração no boot** e num `.env` que aponta para a **Supabase compartilhada** | `render.yaml` (auto-deploy em `main`, `preDeployCommand=npm run migrate && npm run seed:admin`, `healthCheckPath=/health`) + `src/backend/index.ts` (`BootMigrator.run()` antes do `listen`) + `migrations/0049_sispag_remessa_retorno.sql` + rotas `POST /sispag/lotes/:id/gerar-remessa` gated por `SISPAG_ENABLED`+`CONEXOS_WRITE_ENABLED`+`CONEXOS_DRY_RUN` (global) | Produção viva (v0.27.0): analistas montando/finalizando lotes; cron `ingest-sispag` 10:00 UTC; `CONEXOS_WRITE_ENABLED=true` + `CONEXOS_DRY_RUN=false` já em prd (permutas em `fin010` escrevendo) | CI verde (npm audit high + typecheck + lint + test + build) → auto-deploy Render → `preDeployCommand` migra → boot re-checa e migra pendentes → `/health` OK → traffic switch. Rollback: botão manual no Render (binário); schema é forward-only (sem par down) | Lead time commit→prd ≤ 15 min (não medível localmente); deploy success rate ≥ 95% (idem); MTTR rollback binário ≤ 5 min (manual); MTTR rollback de `0049` = **fora do repo** (só via restore de backup do Supabase); blast radius de um `tsx watch` local mal apontado = **DDL em produção em segundos** (comprovado com `0049` nesta branch) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Steps automatizados commit→prd (backend) | 6 (npm ci, npm audit high, typecheck, lint, test --coverage, build) + preDeploy (migrate + seed:admin) + BootMigrator no `listen` | ≥ 5 | ✅ | `.github/workflows/ci.yml:16-27`, `render.yaml:19-21`, `src/backend/index.ts:130-155` |
| Isolamento dev↔prd no banco | ❌ nenhum — `.env` do dev aponta para Supabase compartilhada; `tsx watch index.ts` (script `dev`) roda `BootMigrator.run()` a cada save de arquivo `.sql`; migração `0049` foi APLICADA em prd por essa via ANTES do PR ser mergeado | 100% dos ambientes de dev com DB próprio, guard-rail que impeça `dev` de subir contra host de prd | ❌ P0 | `src/backend/package.json:7` (`dev: tsx watch index.ts`) + `src/backend/index.ts:143-146` (`await container.resolve(BootMigrator).run()`) + fato verificado (0049 aplicada em prd sem deploy) |
| Escape hatch para dev local isolado | 3 scripts NOVOS nesta branch (`db:local`, `dev:local`, `migrate:local`) que sobrescrevem `databaseConnectionString` para Postgres em container | Default do `dev` isolado + falha explícita se `databaseConnectionString` = host de prd em ambiente `local` | ⚠️ opt-in (default segue perigoso) | `src/backend/package.json:8-10` |
| Estado schema × código depois do incidente | Migração `0049` já em prd; código que a usa (RemessaService com colunas `native_*`, tabela `remessa_execucao`) NÃO deployado ainda | Schema aditivo pode ficar à frente do código; schema destrutivo nunca. `0049` é 100% `ADD COLUMN IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS` — segurança acidental, não desenho | ⚠️ (fica ok por sorte, não por processo) | `src/backend/migrations/0049_sispag_remessa_retorno.sql` (leitura completa) |
| Rollback de schema (`0049`) | ❌ ausente — sem `down.sql`, sem par de migração reversa, sem procedimento documentado. `remessa_execucao` referencia `lote_pagamento(id) ON DELETE CASCADE` — dropar depois exige care | ≤ 30 min com procedimento testado ou forward-only + PITR verificado | ❌ | `find src/backend/migrations -name '*down*' -o -name '*rollback*'` (vazio); `docs/runbooks/` só tem `fin010-write-cutover.md` |
| Idempotência das escritas SISPAG no ERP (contramedida ao retry de deploy) | Ledger `remessa_execucao` com `UNIQUE (idempotency_key)`, estado `reconciling` fail-closed (`RemessaEmDuvidaError`), persistência do `native_flp_cod` assim que o ERP devolve | Idempotência ponta-a-ponta em toda escrita ao ERP | ✅ presente (na aplicação); ❌ nas APIs `fin015` upstream (as 3 escritas do Conexos não são idempotentes — contexto de risco do `_shared-metrics.md`) | `src/backend/domain/service/sispag/RemessaService.ts:112-216`, `migrations/0049_sispag_remessa_retorno.sql:60-85` |
| Kill-switch operável sem redeploy (SISPAG) | Cadeia existe (`SISPAG_ENABLED` → 403 no gate; `CONEXOS_WRITE_ENABLED=false` → dry-run forçado; `CONEXOS_DRY_RUN=true` → idem), MAS `SISPAG_ENABLED` está `value: 'true'` HARDCODED no `render.yaml`; virar no dashboard perde no próximo deploy | Kill-switch com `sync:false` (dashboard é fonte de verdade) e efeito imediato sem redeploy | ⚠️ parcial | `render.yaml:26-27` (`SISPAG_ENABLED value: 'true'`) vs. `render.yaml:35-38` (padrão correto usado para `RECEBIMENTOS_ENABLED`, `CONEXOS_*`) |
| Granularidade do kill-switch de escrita | `CONEXOS_DRY_RUN` é GLOBAL — desligar a escrita do SISPAG derruba TAMBÉM Permutas (`fin010`) e Recebimentos. Não há `SISPAG_WRITE_ENABLED`/`SISPAG_DRY_RUN` | 1 flag por frente (blast-radius contido) | ❌ | `_shared-metrics.md` linha "Contexto de risco"; `EnvironmentProvider.ts:167-168` (única flag) |
| Ambientes intermediários (dev → stg → prd) | ❌ deploy direto em `main`; sem staging Render nem Vercel Preview promovido | dev → stg → prd | ⚠️ | `render.yaml:11` (`branch: main`) |
| Runbook específico SISPAG (remessa/retorno) | ❌ ausente — `docs/runbooks/` tem só `fin010-write-cutover.md` (Permutas). Falta procedimento para: lote órfão `reconciling`, `.RET` sintético vs real, retry de `gerarRemessa`, restore de `0049` | Runbook cobrindo os 4 modos de falha acima | ❌ | `ls docs/runbooks/` (1 arquivo, não SISPAG) |
| Smoke test pós-deploy do fluxo remessa | ❌ ausente — `/health` só devolve `{status,version}`; não há check que valide `POST /sispag/lotes/:id/gerar-remessa` em dry-run | Smoke em dry-run bloqueando promoção do deploy em caso de 5xx | ❌ | `src/backend/index.ts:96` (`GET /health` mínimo) |
| Node pinado por ambiente | CI: `24` · crons GHA: `22` · Render: `runtime: node` (sem pin) | Uma versão em todos os pontos | ⚠️ divergente (herdado, não introduzido pelo delta) | `.github/workflows/ci.yml:20,40` (24) vs `.github/workflows/ingest-sispag.yml:46` (22) vs `render.yaml:6` (sem pin) |
| Advisory lock no BootMigrator | `pg_try_advisory_lock` chave `314159265`, 30 tentativas × 2s = 60s de espera antes de falhar | Serializar migração entre instâncias | ✅ | `src/backend/migrations/BootMigrator.ts:11-14,72-108` |
| Fail-fast no boot (esquema em dúvida) | `void start().catch(...) process.exit(1)` — falha no migrate mata o processo antes do `listen`; Render mantém versão anterior | Boot NÃO pode servir contra esquema desconhecido | ✅ | `src/backend/index.ts:155-160`, `BootMigrator.ts` docblock |
| Lockfile + `npm ci` | `src/backend/package-lock.json` 402 KB commitado; `npm ci` no CI e no Render | presente | ✅ | `render.yaml:20`, `.github/workflows/ci.yml:22` |
| Supply-chain gate | `npm audit --audit-level=high` no CI backend | presente | ✅ | `.github/workflows/ci.yml:24` |
| Tempo de build backend (local) | `tsc && tsc-esm-fix dist` em 13s, dist = 11 MB, 358 `.js` | ≤ 90s no Render | ✅ | `time npm run build` (medido); `du -sh src/backend/dist` |
| Versão do app no `/health` | `APP_VERSION = process.env.npm_package_version ?? 'unknown'`; `0.27.0` neste release (FE+BE lockstep, CHANGELOG.md) | version bump obrigatório em cada release | ✅ | `src/backend/index.ts:94-96`, `src/backend/package.json:3`, `src/frontend/package.json:3` |
| Deploy success rate (últimos 30d) | não medível localmente | ≥ 95% | ⚠️ | Dashboard Render (fora do repo) |
| Lead time commit→prd (mediano) | não medível localmente | ≤ 15 min | ⚠️ | Dashboard Render + GHA |
| MTTR rollback binário (Render) | não medível localmente | ≤ 5 min (1 clique manual) | ⚠️ | Dashboard Render |

> ⚠️ **Não medíveis localmente**: taxa de sucesso de deploys, lead time real, MTTR de rollback e tempo real de build no Render/Vercel. Requerem os dashboards. Recomendação: fixar um Deploy Notifications no Slack (Render + Vercel) e uma planilha mensal para o operador — o custo é 30 min e destrava o cálculo destas métricas nas próximas revisões.

## 3. Tactics — Cobertura no SISPAG (delta desta branch)

| Tactic (Bass — Manage Deployment Pipeline / Manage Deployed System) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts — Canary | Ausente. Deploy vai 100% ou 0% (starter, 1 instância) | ❌ ausente | `render.yaml:9` (`plan: starter`) |
| Scale Rollouts — Blue/Green | Render faz build-then-switch com `healthCheckPath=/health` e `preDeployCommand` (atômico, all-or-nothing); NÃO gradual | ⚠️ parcial | `render.yaml:21-22` |
| Scale Rollouts — Rolling | N/A (1 instância no starter) | N/A | `render.yaml:9` |
| Rollback — binário | Manual, 1 clique no dashboard Render. Não gatilhado por erro-rate; não versionado no repo | ⚠️ parcial | Fora do repo |
| Rollback — schema | ❌ Ausente para `0049`. Sem `down.sql`, sem procedimento, sem verificação de backup PITR. `remessa_execucao` referencia `lote_pagamento` com `ON DELETE CASCADE` — restore parcial exige ordem | ❌ ausente | `migrations/0049_sispag_remessa_retorno.sql`; `docs/runbooks/` |
| Script Deployment Commands | `preDeployCommand=npm run migrate && npm run seed:admin` (Render) + `BootMigrator.run()` (no `listen`) + runner idempotente via `schema_migrations` + `pg_try_advisory_lock` | ✅ presente (com nota: migração acontece **duas vezes** — preDeploy no plano pago **e** no boot; hoje o serviço é starter e o preDeploy nunca rodou, então o boot é o único caminho real) | `render.yaml:21`, `src/backend/index.ts:135-155`, `BootMigrator.ts` |
| Logical Grouping | `/sispag/*` isolado sob `sispagGate` (403 quando desabilitado); `RemessaService` isolado dos serviços de Permutas/Recebimentos | ✅ presente | `src/backend/index.ts:113`, `http/sispagGate.ts` |
| Physical Grouping | Todo o SISPAG divide processo Express com Permutas e Recebimentos; um deploy quebrado derruba as 4 frentes | ⚠️ parcial | `src/backend/index.ts` (monolito) |
| Package Dependencies | `package-lock.json` commitado; `npm ci` no CI e Render; `npm audit --audit-level=high` no CI | ✅ presente | `.github/workflows/ci.yml:22-24` |
| Surge Protection | `heavyRouteLimiter` NÃO cobre `/sispag/*` (só `/conexos`); crons têm `concurrency.group=ingest-sispag; cancel-in-progress=false`; `POST /gerar-remessa` sem limiter dedicado | ⚠️ parcial | `src/backend/index.ts:100,113`; `.github/workflows/ingest-sispag.yml:22-24` |
| Idempotent Deploys | Migrations idempotentes (`IF NOT EXISTS` em `0049`); `seed:admin` UPSERT; `RemessaService` idempotente por `Idempotency-Key` + estado `reconciling` fail-closed | ✅ presente (na app) | `migrations/0049_sispag_remessa_retorno.sql`; `RemessaService.ts:112-216` |
| Configuration Management — Feature Flag | `SISPAG_ENABLED` (rota) + `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` (escrita). Fail-safe: sem env em prd, SISPAG bloqueia; dry-run default `true` | ✅ presente, ⚠️ mas `SISPAG_ENABLED` no `render.yaml` está `value:'true'` (hardcode) — flip no dashboard some no próximo deploy | `render.yaml:26-27` vs. `render.yaml:35-38` (padrão correto do `RECEBIMENTOS_ENABLED`) |
| Configuration Management — Isolamento de ambiente | ❌ dev, hml e prd compartilham Supabase; `dev:local` foi introduzido mas é OPT-IN; `BootMigrator` no `tsx watch` transforma edição local em DDL prd | ❌ ausente (esta é a raiz do incidente 0049 desta branch) | `src/backend/package.json:7-10`; `src/backend/index.ts:143-146` |
| Drift Detection | ❌ nenhum job compara `render.yaml` × dashboard nem `schema_migrations` × repo. Comentários no yaml admitem o conflito ("yaml brigando com dashboard") | ❌ ausente | `render.yaml:35-38` |
| Reproducible Builds | Lockfile + `npm ci` + `npm audit`. Node **divergente**: CI 24 · cron 22 · Render sem pin | ⚠️ parcial | `.github/workflows/*.yml`, `render.yaml:6` |
| Per-tenant Blast-radius Limit | N/A — deploy é multi-cliente por instância única (`client_name=local`); Terraform/tenants não se aplicam a este repo | N/A (não é o mesmo desenho do template) | `render.yaml:29-30` |
| Deployment Observability | `[boot-migrate]` loga tudo (esquema em dia / N aplicadas / lock ocupado); `/health` devolve version; sem métrica agregada de deploys | ⚠️ parcial | `BootMigrator.ts:60-70`, `index.ts:96` |
| Active Redundancy | N/A no starter (1 instância; sem hot standby) | N/A | `render.yaml:9` |
| Smoke Test pós-deploy | ❌ apenas `/health` (status + version). Fluxo remessa em dry-run não é probeado | ❌ ausente | `index.ts:96` |

## 4. Findings

### F-deployability-1: `tsx watch` + Supabase compartilhada + migração no boot = DDL em prd a cada Ctrl-S

- **Severidade**: P0 (crítico — comprovado nesta branch: `0049_sispag_remessa_retorno.sql` foi aplicada em produção **antes do PR ser mergeado**, por um `dev` local com `.env` apontando para a Supabase compartilhada)
- **Tactic violada**: Configuration Management — Isolamento de ambiente; Package Dependencies; Idempotent Deploys
- **Localização**:
  - `src/backend/package.json:7` (`"dev": "tsx watch index.ts"`)
  - `src/backend/index.ts:143-146` (`await container.resolve(BootMigrator).run()` no start)
  - `src/backend/migrations/BootMigrator.ts:56-70` (roda em qualquer boot com `databaseConnectionString` presente, incluindo `local`)
  - Ausência de guard-rail: `EnvironmentProvider` NÃO valida "environment=local aponta para host de prd"
- **Evidência (objetiva)**:
  ```
  # src/backend/package.json
  "dev": "tsx watch index.ts"
  # ...+ script novo, mas OPT-IN:
  "dev:local": "databaseConnectionString=postgresql://financeiro:devlocal@localhost:5433/financeiro tsx watch index.ts"

  # src/backend/index.ts
  await container.resolve(BootMigrator).run();
  app.listen(PORT, ...)

  # BootMigrator.ts
  if (!env.databaseConnectionString) { /* pula */ }
  // else — aplica TUDO que estiver pendente, incluindo migrations nunca commitadas
  ```
  Fato: migração `0049` foi persistida em prd por essa cadeia; `_shared-metrics.md` confirma "Migration 0049 JÁ aplicada na Supabase compartilhada".
- **Impacto técnico**: qualquer `.sql` colocado no diretório `migrations/` durante desenvolvimento é DDL imediato em produção. O próximo pode não ser `IF NOT EXISTS` — pode ser um `DROP TABLE` de teste. E o `schema_migrations` fica registrando o nome, então mesmo depois de reverter o commit, o efeito colateral em prd permanece invisível ao próximo dev.
- **Impacto de negócio**: risco de corrupção de dado financeiro sem trilha de origem (não é deploy nem migração agendada — é save de editor). Requer restore de PITR do Supabase, que interrompe as 4 frentes simultaneamente. Auditoria não consegue atribuir a mudança a um deploy.
- **Métrica de baseline**: 1 incidente comprovado nesta branch (`0049` aplicada em prd antes do merge); 100% dos devs do time hoje operam com `.env` apontando para Supabase compartilhada (default do onboarding no README `dev:` sem menção ao `dev:local`).

### F-deployability-2: Nenhum rollback para a migração `0049` (schema forward-only, sem par down, sem PITR verificado)

- **Severidade**: P1 (alto — MTTR de rollback de schema vira "restore de backup Supabase + re-ingestão", em horas)
- **Tactic violada**: Rollback (Manage Deployment Pipeline)
- **Localização**: `src/backend/migrations/0049_sispag_remessa_retorno.sql` (105 linhas, sem par `down`); `docs/runbooks/` (só `fin010-write-cutover.md`)
- **Evidência (objetiva)**:
  ```
  # find src/backend/migrations -name "*down*" -o -name "*rollback*"
  (vazio)

  # A `0049` adiciona 8 colunas em `lote_pagamento`, 6 colunas em `lote_pagamento_item`,
  # cria tabela `remessa_execucao` com FK ON DELETE CASCADE em `lote_pagamento`, e amplia
  # o CHECK constraint de status (mais 3 valores). Nenhum passo é reversível por SQL
  # trivial se dados já foram gravados.
  ```
- **Impacto técnico**: se o RemessaService gravar em prd e algo errado for detectado (ex.: `native_flp_cod` reciclado batendo com lote antigo), voltar o schema para o estado pré-0049 exige (a) DROP das colunas e da tabela — que apaga dado real da conciliação já feita — ou (b) restore point-in-time — que reverte TODAS as 4 frentes junto.
- **Impacto de negócio**: incidente com dado financeiro (mesmo pequeno) força a operação a escolher entre "não reverte" (continua com bug) e "reverte tudo" (perde 100% das outras frentes desde o snapshot). Não existe caminho cirúrgico.
- **Métrica de baseline**: 0 procedimentos de rollback documentados; 0 verificações de backup PITR do Supabase no repo; 1 migração já aplicada (`0049`) sem esse par.

### F-deployability-3: `SISPAG_ENABLED` hardcoded no `render.yaml` derrota o kill-switch operacional

- **Severidade**: P1 (alto — kill-switch existe mas não sobrevive ao próximo deploy)
- **Tactic violada**: Configuration Management — Feature Flag; Rollback (soft)
- **Localização**: `render.yaml:26-27`
- **Evidência (objetiva)**:
  ```yaml
  # render.yaml — SISPAG
  - key: SISPAG_ENABLED
    value: 'true'          # ← hardcoded, sem sync:false

  # contraste, mesmo arquivo, feito CERTO:
  - key: RECEBIMENTOS_ENABLED
    sync: false            # ← dashboard é fonte da verdade
  - key: CONEXOS_WRITE_ENABLED
    sync: false
  - key: CONEXOS_DRY_RUN
    sync: false
  ```
  O comentário do próprio yaml (`render.yaml:35-38`) admite o padrão: "yaml brigando com dashboard".
- **Impacto técnico**: operador vira `SISPAG_ENABLED=false` no dashboard Render para conter incidente; qualquer push em `main` re-aplica `value:'true'` e reabre o gate sem intervenção humana.
- **Impacto de negócio**: janela de exposição imprevisível — operador acredita que a frente está fechada, mas ela reabre no próximo hotfix do time (pode ser em minutos).
- **Métrica de baseline**: tempo entre um "kill" via dashboard e o próximo deploy que reabre = imprevisível (mediano da branch mostra deploys diários); 1 flag SISPAG hoje contra 3 do padrão correto (RECEBIMENTOS/WRITE/DRY_RUN).

### F-deployability-4: `CONEXOS_DRY_RUN` é global — kill-switch de escrita SISPAG derruba Permutas e Recebimentos junto

- **Severidade**: P1 (alto — blast radius do desligamento vira as 4 frentes)
- **Tactic violada**: Logical Grouping (não há flag por frente); Configuration Management — Feature Flag
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.ts:167-168,246-247` (única flag); `_shared-metrics.md` (contexto de risco)
- **Evidência (objetiva)**:
  ```
  # EnvironmentProvider.ts — não existe SISPAG_WRITE_ENABLED nem SISPAG_DRY_RUN.
  conexosWriteEnabled: this.readEnv('CONEXOS_WRITE_ENABLED') === 'true',
  conexosDryRun: this.readEnv('CONEXOS_DRY_RUN') !== 'false',

  # RemessaService.ts:112-113 (SISPAG) usa exatamente essas duas envs.
  # BorderoGestaoService.ts:98, ReconciliacaoPermutaService.ts:75 (PERMUTAS) idem.
  # Todos os serviços que escrevem no ERP leem da mesma fonte.
  ```
- **Impacto técnico**: para desligar a escrita da remessa SISPAG (motivo comum: `fin015` devolvendo erro numa filial nova), o operador precisa desligar TODAS as escritas do ERP — a única alternativa é o `SISPAG_ENABLED=false` no gate, que também bloqueia LEITURA (painel).
- **Impacto de negócio**: incidente localizado ao SISPAG vira janela de indisponibilidade das 4 frentes de escrita. Se Permutas estivesse no meio de um cutover de borderô, o operador teria que escolher: bloqueia SISPAG a bala de canhão ou aceita o risco de continuar escrevendo.
- **Métrica de baseline**: 0 flags escopadas por frente; 1 flag global governando 4 caminhos de escrita distintos.

### F-deployability-5: Nenhum runbook para o SISPAG (remessa/retorno/lote órfão `reconciling`)

- **Severidade**: P2 (médio — quando o incidente acontecer, tempo de resposta vira função da memória de quem estiver de plantão)
- **Tactic violada**: Deployment Observability (informação existe nos logs `[boot-migrate]`/`RemessaEmDuvidaError` mas não há guia de resposta)
- **Localização**: `docs/runbooks/` (só `fin010-write-cutover.md`); nada para SISPAG
- **Evidência (objetiva)**:
  ```
  # ls docs/runbooks/
  fin010-write-cutover.md          # Permutas
  # SISPAG remessa/retorno — vazio
  ```
  Modos de falha conhecidos e sem runbook:
  1. `remessa_execucao.status='reconciling'` (fail-closed) — o que o operador faz?
  2. `.RET` sintético diverge do arquivo real do banco — como validar sem escrever?
  3. `native_flp_cod` reciclado bate com lote diferente — como isolar?
  4. `preDeployCommand` falha por lock ocupado após 60s — como diagnosticar?
- **Impacto técnico**: cada incidente vira análise fresca. Sem passos escritos, a chance de aplicar a mesma correção que já funcionou antes cai (e a chance de tentar algo destrutivo sobe).
- **Impacto de negócio**: MTTR alto e inconstante em produção com dinheiro saindo (`CONEXOS_WRITE_ENABLED=true` já em prd).
- **Métrica de baseline**: 0 runbooks para SISPAG contra 4 modos de falha nomeados; 1 runbook para Permutas (referencial de qualidade a copiar).

### F-deployability-6: Sem smoke test pós-deploy do fluxo de remessa (health check é minimalista)

- **Severidade**: P2 (médio — deploy verde não prova que `gerarRemessa` monta payload; primeiro sinal de regressão vem do analista)
- **Tactic violada**: Deployment Observability; Scale Rollouts (Blue/Green sem verificação semântica)
- **Localização**: `src/backend/index.ts:94-96` (health check só devolve `{status,version}`); nenhum step de smoke no `render.yaml`/CI
- **Evidência (objetiva)**:
  ```
  # index.ts:94-96
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: APP_VERSION }));

  # render.yaml — healthCheckPath: /health   (só o probe HTTP 200 do endpoint acima)
  ```
- **Impacto técnico**: qualquer regressão em `RemessaService.gerarRemessa` (ex.: forma nova do payload `fin015`, como aconteceu nesta branch) passa o `/health`. Só quebra quando o analista clica "Gerar remessa" com `dryRun=false`.
- **Impacto de negócio**: janela entre deploy e primeira tentativa real = tempo para vazar bug em prd; primeira execução é pagamento verdadeiro (`CONEXOS_WRITE_ENABLED=true`).
- **Métrica de baseline**: 0 smoke tests pós-deploy; 1 endpoint de health que não exercita nenhuma rota SISPAG.

## 5. Cards Kanban

### [deployability-1] Isolar o `.env` de dev do Postgres de produção (guard-rail + default de dev local)

- **Problema**
  > `tsx watch index.ts` (script `dev`) roda `BootMigrator.run()` a cada save. Com `.env` apontando para a Supabase compartilhada, qualquer `.sql` novo no diretório `migrations/` vira DDL em prd. Aconteceu de fato nesta branch com `0049_sispag_remessa_retorno.sql`, aplicada em prd antes do PR ser mergeado.
- **Melhoria Proposta**
  > (a) Fazer `dev:local` (que já existe) virar o alias oficial do `dev` no README/onboarding e um pre-commit hook que rejeite `.env` cuja `databaseConnectionString` contenha `pooler.supabase.com` com `environment=local`. (b) Adicionar em `EnvironmentProvider` (ou logo antes do `BootMigrator.run()`) uma checagem: **se `environment=local` E `databaseConnectionString` bate em regex de host Supabase pooler**, aborta o boot com mensagem explicativa. (c) Adicionar teste unitário em `BootMigrator.test.ts` cobrindo o guard-rail. Tactic Bass: Configuration Management + Rollback preventivo.
- **Resultado Esperado**
  > `tsx watch` local nunca mais consegue tocar prd por acidente. Métrica: 0 migrações aplicadas em prd fora de um deploy autorizado (atual: 1 nesta branch).
- **Tactic alvo**: Configuration Management — Isolamento de ambiente
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Migrações aplicadas em prd fora de deploy: 1 (últimos 30 dias) → 0
  - % dos devs usando DB isolado localmente: ~0% (default `dev`) → 100% (default `dev` = container local)
- **Risco de não fazer**: próximo `.sql` de teste pode não ser `IF NOT EXISTS` — pode ser um `DROP TABLE`. Restore de PITR é a única saída, e derruba as 4 frentes simultaneamente.
- **Dependências**: nenhuma (scripts `db:local`/`dev:local`/`migrate:local` já existem no `package.json`)

### [deployability-2] Plano de rollback para a migração 0049 (down.sql + PITR verificado + runbook)

- **Problema**
  > `0049` já está em prd, é 100% aditiva por sorte (`IF NOT EXISTS`), mas não tem par de rollback nem procedimento. Se o novo `RemessaService` gravar em `remessa_execucao` e algo errado for detectado, o operador não tem caminho cirúrgico — só restore de backup ou "continua com o bug".
- **Melhoria Proposta**
  > (a) Escrever `migrations/0049_sispag_remessa_retorno.down.sql` (DROP INDEX, DROP TABLE `remessa_execucao`, DROP COLUMNs, `DROP CONSTRAINT lote_pagamento_status_check` + recria com valores antigos) marcado como "só aplicar sob incidente" e com script `npm run migrate:rollback -- 0049`. (b) Registrar em `docs/runbooks/sispag-remessa-rollback.md` a decisão: até `RemessaService` gravar em prd, rollback é `.down.sql`; depois, rollback é PITR + re-conciliação. (c) Semanalmente rodar um `pg_dump` do schema `remessa_execucao` + `lote_pagamento`/`lote_pagamento_item` colunas novas para snapshot fora do Supabase. Tactic Bass: Rollback.
- **Resultado Esperado**
  > MTTR de rollback de schema cai de "horas + downtime das 4 frentes" para "≤ 30 min só do SISPAG". Métrica: procedimento executado com sucesso em um exercício de disaster recovery antes do primeiro `CONEXOS_WRITE_ENABLED=true` real da remessa.
- **Tactic alvo**: Rollback (Manage Deployment Pipeline)
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Procedimentos de rollback documentados para SISPAG: 0 → 1
  - Ensaios de restore validados nos últimos 90 dias: 0 → 1
  - Tempo estimado de rollback SISPAG-only: ∞ → ≤ 30 min
- **Risco de não fazer**: quando o incidente chegar, o operador escolhe entre "conviver com o bug" e "restore que derruba as 4 frentes". Dinheiro saindo pelo `fin015` durante essa escolha.
- **Dependências**: F-deployability-3 (kill-switch operável ajuda a comprar tempo)

### [deployability-3] `SISPAG_ENABLED` para `sync:false` (dashboard vira fonte da verdade)

- **Problema**
  > `render.yaml:26-27` fixa `SISPAG_ENABLED: 'true'` como valor literal. Se o operador desligar via dashboard para conter um incidente, o próximo `git push main` reabre o gate sozinho. O padrão correto já existe no mesmo arquivo (`RECEBIMENTOS_ENABLED`, `CONEXOS_*` usam `sync: false`).
- **Melhoria Proposta**
  > Trocar `value: 'true'` por `sync: false` em `render.yaml:26-27` e setar o valor `true` no dashboard uma vez. Adicionar seção em `DEPLOY.md` explicando que o dashboard é fonte da verdade dos kill-switches. Tactic Bass: Configuration Management — Feature Flag.
- **Resultado Esperado**
  > Um `SISPAG_ENABLED=false` no dashboard sobrevive a deploys — kill-switch tem efeito imediato e persistente sem intervenção de commit. Métrica: tempo entre "kill" no dashboard e reabertura por deploy: imprevisível → nunca.
- **Tactic alvo**: Configuration Management — Feature Flag
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Kill-switches SISPAG servidos pelo dashboard: 0 → 1 (`SISPAG_ENABLED`)
  - Deploys que reabrem gate desligado: >0/mês → 0
- **Risco de não fazer**: kill-switch é ilusório em produção — só funciona até o próximo deploy, sem aviso.
- **Dependências**: nenhuma

### [deployability-4] Flags de escrita escopadas por frente (`SISPAG_WRITE_ENABLED`/`SISPAG_DRY_RUN`)

- **Problema**
  > `CONEXOS_DRY_RUN`/`CONEXOS_WRITE_ENABLED` são globais. Desligar a escrita da remessa SISPAG hoje força escolha entre bloquear as 4 frentes ou desligar o SISPAG inteiro (leitura junto). Blast radius incompatível com escrita já ligada em produção.
- **Melhoria Proposta**
  > Adicionar `sispagWriteEnabled` e `sispagDryRun` no `EnvironmentProvider` com **fallback para as globais** (backward-compat). `RemessaService.gerarRemessa` e `ConciliacaoRetornoService.conciliar` passam a ler o par escopado. Espelhar para `permutasWriteEnabled` e `recebimentosWriteEnabled` no mesmo movimento (finding cross-QA com Fault Tolerance). Tactic Bass: Logical Grouping + Configuration Management.
- **Resultado Esperado**
  > Kill-switch de escrita por frente. Métrica: 1 flag global → 4 flags escopadas com fallback; blast radius de "desligar escrita SISPAG" cai de 4 frentes → 1.
- **Tactic alvo**: Logical Grouping (Manage Deployed System)
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Flags de escrita globais que afetam múltiplas frentes: 2 (`WRITE_ENABLED`, `DRY_RUN`) → 0 (viram fallback)
  - Frentes com kill-switch de escrita próprio: 0 → 4
- **Risco de não fazer**: primeiro incidente da remessa SISPAG derruba Permutas e Recebimentos junto — dano operacional multiplicado por 4.
- **Dependências**: nenhuma

### [deployability-5] Runbook SISPAG cobrindo remessa/retorno/lote órfão

- **Problema**
  > Existem 4 modos de falha nomeados (reconciling órfão, `.RET` sintético vs real, `flpCod` reciclado, boot lock ocupado) e 0 runbook. `fin010-write-cutover.md` (Permutas) é o único precedente.
- **Melhoria Proposta**
  > Escrever `docs/runbooks/sispag-remessa-retorno.md` com: (1) sinais no log/`remessa_execucao.status` que indicam cada modo, (2) query de diagnóstico (ex.: `SELECT * FROM remessa_execucao WHERE status='reconciling' AND updated_at < now() - interval '10 min'`), (3) próximo passo (cancelar lote órfão, re-conciliar, escalar), (4) contato do responsável. Espelhar o formato de `fin010-write-cutover.md`. Tactic Bass: Deployment Observability.
- **Resultado Esperado**
  > Plantonista tem passo-a-passo escrito para os 4 modos de falha SISPAG. Métrica: 4 modos de falha nomeados → 4 seções de runbook cobrindo cada um.
- **Tactic alvo**: Deployment Observability
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Runbooks SISPAG: 0 → 1
  - Modos de falha SISPAG documentados: 0/4 → 4/4
- **Risco de não fazer**: MTTR alto e inconstante quando o incidente chegar (e ele chega, com escrita já ligada).
- **Dependências**: F-deployability-2 (o rollback vira uma seção deste runbook)

### [deployability-6] Smoke test pós-deploy do `gerarRemessa` em dry-run

- **Problema**
  > `/health` só devolve `{status,version}` — não exercita nenhuma rota SISPAG. Regressão em `RemessaService.gerarRemessa` (payload novo, forma nova do `fin015`) passa pelo probe do Render sem sinal; primeira detecção é a analista clicando "Gerar remessa" em prd.
- **Melhoria Proposta**
  > Adicionar step pós-deploy (GitHub Actions rodando após o Render notificar sucesso, ou dentro do `preDeployCommand` na próxima subida para plano pago): `curl -X POST $BACKEND_URL/sispag/lotes/$SMOKE_LOTE_ID/gerar-remessa -H 'Content-Type: application/json' -d '{"dryRun":true}'` e falhar o pipeline em 5xx. Manter um `lote_pagamento` de "canário smoke" no ambiente, em RASCUNHO permanente, para servir de fixture. Tactic Bass: Scale Rollouts (Blue/Green com verificação semântica).
- **Resultado Esperado**
  > Regressão de payload/shape é detectada em ≤ 1 min pós-deploy, antes de qualquer clique humano. Métrica: 0 smoke tests → 1 endpoint SISPAG exercitado por deploy.
- **Tactic alvo**: Scale Rollouts (Blue/Green); Deployment Observability
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — inclui gerenciar fixture "canário" no banco
- **Findings relacionados**: F-deployability-6
- **Métricas de sucesso**:
  - Endpoints SISPAG cobertos pelo probe de deploy: 0 → 1 (`gerar-remessa` em dry-run)
  - Tempo médio até detectar regressão em `gerarRemessa`: "próximo clique da analista" → ≤ 1 min
- **Risco de não fazer**: primeira execução real de remessa em prd depois de um deploy quebrado escreve/tenta escrever no `fin015` com payload errado — no melhor caso 4xx, no pior duplica lote (as escritas não são idempotentes upstream).
- **Dependências**: F-deployability-4 ajuda (dry-run precisa de flag escopada para não depender do `CONEXOS_DRY_RUN` global)

## 6. Notas do agente

- Score 4 (regressão vs. 6 na review anterior de SISPAG Frente II, 2026-07-18): a review passada não tinha ainda o incidente `0049` provando que `tsx watch` + `.env` compartilhado = DDL em prd. Esse fato reclassifica o problema de "risco teórico" para P0 acionado. Os scripts `dev:local`/`db:local`/`migrate:local` reduzem, mas continuam OPT-IN — enquanto o default do `dev` for `tsx watch index.ts` com `.env` compartilhado, o defeito persiste.
- Cross-QA para o consolidator: F-deployability-1 vale também para **Security** (mudança em prd sem trilha de deploy) e **Testability** (dev pode não conseguir reproduzir prd depois de aplicar migration só localmente sem committar). F-deployability-4 vale para **Fault Tolerance** (blast radius do kill-switch global). F-deployability-2 vale para **Availability** (rollback de schema hoje = downtime das 4 frentes).
- Não medi lead time real nem deploy success rate — pedem os dashboards Render/Vercel; sinalizado explicitamente em §2. `time npm run build` local foi medido (13s), suficiente para descartar build como gargalo.
- `preDeployCommand` do `render.yaml` continua no plano starter (`preDeployCommand` é recurso pago) — na prática só o `BootMigrator` do `index.ts` migra. O `render.yaml` está honesto quanto a isso (comentário no arquivo cita), mas mantém a linha do `preDeployCommand` — vale renomeá-lo para deixar claro para o próximo dev.
