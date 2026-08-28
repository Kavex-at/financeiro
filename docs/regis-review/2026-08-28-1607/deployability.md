---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-28-1607
agent: qa-deployability
generated_at: 2026-08-28T16:07:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

> Escopo real: **DELTA de 2 commits sobre `617ca3b`** — a migration `0051`
> (ADD COLUMN IF NOT EXISTS de duas colunas nullable TEXT em cinco ledgers), o
> código que passa a escrevê-las e o `chore(release): v0.31.1` (FE+BE lockstep).
> O repo não tem `infra/`/Terraform — deploy é hook nativo do Render sobre a
> `main`. Tactics de IaC/Lambda/multi-tenant são declaradas **não medíveis**.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge do PR desta branch na `main` (Github Actions dispara → Render `autoDeploy`) | Nova migration `0051` altera 5 tabelas de ledger *enquanto* a versão anterior (v0.31.0) ainda serve tráfego durante a janela de swap do Render | `src/backend/migrations/0051_execucao_identidade_conexos.sql` + os 5 repositórios que passam a escrever `conexos_username`/`conexos_usn_cod` + `BootMigrator` que aplica antes do `listen()` | Produção: Render web service single-instance (starter), Supabase Postgres compartilhado, `preDeployCommand` do `render.yaml` **inerte** (o serviço foi configurado pelo dashboard, pre-deploy é plano pago) — a migração é aplicada dentro do próprio processo web pelo `BootMigrator` | (1) `BootMigrator` adquire advisory lock `314159265`, aplica `0051` (idempotente), registra em `schema_migrations`, então `app.listen(3001)`; (2) `/health` passa a devolver `version=0.31.1`; (3) instância antiga (v0.31.0) segue escrevendo sem tocar nas colunas novas — o `ADD COLUMN` nullable é backward-compatible; (4) rollback opcional para v0.31.0 mantém colunas no schema mas o código antigo as ignora | Zero downtime observável no `/health`; zero linha corrompida (colunas novas = NULL para escritas da versão antiga, o que **por design** significa "identidade não capturada", nunca "robô"); tempo total de janela de migração < 2s (5× `ALTER TABLE ADD COLUMN` nullable); segunda execução da migração = no-op medido |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotência da migration `0051` | ✅ 2ª execução é no-op | 100% idempotente | ✅ | `_shared-metrics.md` (aplicada em Postgres local docker, 2ª execução = 0 alterações) + inspeção do SQL: 10× `ADD COLUMN IF NOT EXISTS` |
| Backward-compatibility do schema (roll forward com código antigo servindo) | ✅ Todas as 10 colunas adicionadas são `TEXT NULL` sem `DEFAULT`/`NOT NULL`/`CHECK` | Nenhuma coluna com `NOT NULL` sem default | ✅ | `src/backend/migrations/0051_execucao_identidade_conexos.sql:20-38` |
| Backward-compatibility do rollback (v0.31.1 → v0.31.0) | ✅ Código antigo não referencia `conexos_username`/`conexos_usn_cod`; `runMigrations.ts` itera apenas arquivos ausentes de `schema_migrations`, então "migration aplicada sem arquivo no disco" não erra | Rollback sem intervenção manual em DDL | ✅ | `git grep conexos_username 617ca3b -- src/backend` = vazio; `src/backend/migrations/runMigrations.ts:39-52` (loop `files.filter(!applied)`) |
| Ordering schema→código dentro do boot | ✅ `container.resolve(BootMigrator).run()` na `linha 150` **antes** de `app.listen()` na `151`; `BootMigrator.ts` **lança** se falhar → processo morre, Render não promove | Zero janela de "código novo × schema velho" | ✅ | `src/backend/index.ts:150-151` + `src/backend/migrations/BootMigrator.ts:29-42` (docstring cita o incidente de 2026-08-10) |
| Lock de coordenação entre instâncias do boot | ✅ `pg_advisory_lock(314159265)`, 30 tentativas × 2s = 60s de espera antes de lançar | Existe + lança em vez de pular | ✅ | `src/backend/migrations/BootMigrator.ts:9-15,113-141` |
| Bump de versão — nível semver correto | ✅ `patch` (0.31.0 → 0.31.1) — delta tem 1 commit `fix(conexos):…` e 1 `chore(release):…`, coerente com a regra do `bump-version.ps1` (`hasFix → patch`) | Nível derivado dos conventional-commits do delta | ✅ | `git log --format=%s main..HEAD` + `scripts/bump-version.ps1:145-152` |
| Bump lockstep FE+BE | ✅ Ambos em `0.31.1` | FE == BE em toda tag | ✅ | `src/backend/package.json:3` + `src/frontend/package.json:3` |
| CHANGELOG.md atualizado | ✅ Entrada `## v0.31.1 (2026-08-28)` inserida logo após o header, formato do script preservado (3 bullets, prefixo `fix(conexos):`) | Entrada presente antes do commit `chore(release):` | ✅ | `CHANGELOG.md:3-24` |
| Lockfile intocado no `chore(release)` | ✅ `git diff main..HEAD --stat` só toca `package.json` × 2 + `CHANGELOG.md` no commit `f7ca494` | Zero mudança em `package-lock.json` no bump | ✅ | `git show f7ca494 --stat` |
| Presença de gate CI antes do deploy | ✅ `.github/workflows/ci.yml` roda `npm ci`/`audit`/`typecheck`/`lint`/`test --coverage`/`build` no BE + `typecheck`/`lint`/`test` no FE; job `tag-release` cria tag idempotente da versão do `package.json` | Gate obrigatório antes da promoção a `main` | ✅ | `.github/workflows/ci.yml:1-84` + branch protection (não visível no repo, declarado no `render.yaml:14-17`) |
| Verificação pós-deploy (deploy observability) | ⚠️ `/health` devolve `{ status, version }` — dá para `curl` a URL do Render e checar `version=0.31.1`, mas não há step automatizado que faça essa asserção pós-deploy | Verificação automática de versão pós-swap | ⚠️ | `src/backend/index.ts:74-76` |
| Runbook para esta release | ❌ Não existe `docs/runbooks/release-0.31.1.md` ou equivalente enumerando (a) como validar `/health`, (b) como rodar rollback pelo Render, (c) o que fazer se `BootMigrator` travar no advisory lock | Runbook por release quando há DDL | ❌ | `find docs -name "*release*"` + `find docs -name "*runbook*" \| xargs grep -l 0.31.1` = vazio |
| Reprodutibilidade do bump manual (pwsh ausente) | ⚠️ `scripts/bump-version.ps1` exige `pwsh`, que **não** está instalado nesta máquina (nota do orquestrador); o bump foi replicado à mão. Diff do `f7ca494` bate exatamente com o que o script escreveria (versão em 2 `package.json`, entrada em `CHANGELOG.md` no formato canônico) | Script único, executável, verificável | ⚠️ | `find scripts -name "bump-version*"` = só `.ps1`; sem `.sh`/`.mjs` equivalente |
| Blast radius por tenant | N/A | — | N/A | Sem multi-tenant provisionado (Columbia = tenant único no Render); ver CLAUDE.md §Tenants |
| Deployment pipeline em Terraform | N/A | — | N/A | Sem `infra/`/Terraform (deploy via Render hook); ver `_shared-metrics.md` |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary/blue-green/rolling) | Render web service faz **health-check gated swap**: sobe a nova instância, espera `/health` responder 200, então direciona tráfego. Sem canary por % de tráfego, sem blue/green explícito. Para o delta, é suficiente porque a migração é backward-compatible. | ⚠️ parcial | `render.yaml:22` (`healthCheckPath: /health`) + `src/backend/index.ts:75-76` |
| **Rollback** | Render dashboard tem "Rollback to previous deploy" (redeploy da imagem anterior). Migração `0051` **não** exige rollback de DDL porque as colunas são nullable e o código v0.31.0 as ignora — verificado em `git grep conexos_username 617ca3b`. `runMigrations.ts` não erra ao ver `schema_migrations` com nome de arquivo ausente. **Nenhum passo documentado** para o operador — o CHANGELOG desta release não menciona rollback. | ⚠️ parcial | `src/backend/migrations/runMigrations.ts:39-52` + `CHANGELOG.md:3-24` |
| **Script Deployment Commands** | `scripts/bump-version.ps1` é o único script "de deploy" — executa dry-run/execute do bump semver + CHANGELOG. **Requer pwsh**, ausente nesta máquina Linux; sem sibling `.sh`/`.mjs`. Neste delta o bump foi replicado à mão e o diff bate byte a byte com o que o script escreveria. Não há script equivalente para invocar rollback, verificar `/health` pós-deploy, ou aplicar migração fora do boot. | ⚠️ parcial | `scripts/bump-version.ps1` (único) + ausência de sibling |
| **Logical Grouping** | Um único serviço `financeiro-backend` no Render, com 4 frentes (Permutas/SISPAG/Popula GED/Recebimentos) agrupadas por router HTTP. Feature flags separam ligado/desligado (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`, `SISPAG_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`). Para este delta, a captura de identidade **não** ganhou flag — não precisa: a única falha possível (coluna ausente) é bloqueada pelo `BootMigrator`. | ✅ presente | `render.yaml:26-56` (envs `sync:false` = kill-switch por dashboard sem redeploy) |
| **Physical Grouping** | Render single-instance na starter plan; sem tenants; sem multi-região. Delta é neutro. | N/A | Sem multi-tenant / sem cluster |
| **Package Dependencies** | Delta **não** altera `package.json` (deps) nem `package-lock.json` — só a chave `version`. Sem risco de deriva de dependência transitiva neste release. | ✅ presente | `git show f7ca494 --stat` (só `version`) |
| **Surge Protection** | `express-rate-limit` (`globalLimiter` 100/min + `heavyRouteLimiter` 10/min); Render behind `trust proxy: 1`. Não é tactic de deploy per se; sem impacto do delta. | N/A | `src/backend/index.ts:32-46` (herdado, não do delta) |
| **Idempotent deploys** (extra) | `BootMigrator` + `MIGRATION_RUNNER_TOKEN` + `pg_advisory_lock`: aplicar 2 deploys seguidos com o mesmo código = `[boot-migrate] esquema em dia`. Migração `0051` usa `IF NOT EXISTS` × 10 — segunda execução é no-op medido. | ✅ presente | `src/backend/migrations/BootMigrator.ts:67-89` + `_shared-metrics.md` |
| **Drift detection** (extra) | Sem cron/job que compare schema em produção contra `migrations/` para detectar DDL feito à mão. **Foi exatamente esse buraco que fez a `0049` chegar à produção sem PR** (documentado em `BootMigrator.ts:82-89`); o guard-rail `recusarBancoRemotoEmAmbienteLocal` mitiga o vetor futuro, mas não detecta drift já existente. | ⚠️ parcial | `src/backend/migrations/BootMigrator.ts:82-105` (guard-rail, não detector) |
| **Reproducible builds** (extra) | Sim para o backend em si: `package-lock.json` presente, `npm ci` no CI, `tsc && tsc-esm-fix dist` determinístico. Sim para o release deste delta: o diff do bump bate byte a byte com o que o script produziria. Para o **script de release**, ver Script Deployment Commands acima (pwsh-only). | ✅ presente | `.github/workflows/ci.yml:14-20` |
| **Per-tenant blast-radius limit** (extra) | N/A — Columbia é tenant único, sem `infra/`/Terraform. | N/A | `_shared-metrics.md` |
| **Deployment observability** (extra) | `/health` devolve `{status, version}` para verificar swap pós-deploy. Logs `[boot-migrate]` sinalizam esquema-em-dia vs. aplicações novas. Sem `POST-deploy` step no `ci.yml` que asserte `version === 0.31.1` na URL do Render. | ⚠️ parcial | `src/backend/index.ts:74-76` + `BootMigrator.ts:74-79` |

## 4. Findings

### F-deployability-1: Bump de versão foi replicado à mão porque `bump-version.ps1` só roda em pwsh

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Script Deployment Commands
- **Localização**: `scripts/bump-version.ps1` (único script; sem `bump-version.sh`/`bump-version.mjs`)
- **Evidência (objetiva)**:
  ```
  $ find scripts -type f
  scripts/bump-version.ps1

  $ command -v pwsh
  (vazio — pwsh não instalado na máquina de desenvolvimento)

  $ git show f7ca494 --stat
   CHANGELOG.md              | 21 +++++++++++++++++++++
   src/backend/package.json  |  2 +-
   src/frontend/package.json |  2 +-
  ```
  O commit `chore(release): v0.31.1` foi feito à mão e bate byte a byte com o que o script produziria (versão em 2 `package.json`, entrada `## v0.31.1 (2026-08-28)` inserida logo após o header do CHANGELOG, seguida dos bullets no formato `<subject>`).
- **Impacto técnico**: enquanto o único script canônico for pwsh-only, cada release feita nesta máquina Linux depende de replicação manual fiel. Fiel neste delta (verificado). O risco é a próxima release *não* ser — esquecer o lockstep FE+BE, ou inserir a entrada do CHANGELOG na posição errada.
- **Impacto de negócio**: um bump manual com FE/BE divergentes quebra o `/health` como fonte de verdade da versão promovida, e força depuração manual sobre "que versão do FE tem esse bug" — friction, não downtime.
- **Métrica de baseline**: `# scripts de release executáveis nesta máquina` = 0 (o único depende de pwsh ausente).

### F-deployability-2: `preDeployCommand` do `render.yaml` é inerte — a doutrina de deploy vive só na docstring do `BootMigrator`

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Script Deployment Commands + Deployment observability
- **Localização**: `render.yaml:22` (`preDeployCommand: npm run migrate && npm run seed:admin`) + `src/backend/migrations/BootMigrator.ts:29-42` (docstring explica por que aquele campo nunca rodou)
- **Evidência (objetiva)**:
  ```yaml
  # render.yaml:22
  preDeployCommand: npm run migrate && npm run seed:admin
  ```
  ```typescript
  // BootMigrator.ts:29-38
  // O `preDeployCommand` do `render.yaml` **nunca rodou**: o serviço do Render foi configurado pelo
  // dashboard, não pelo Blueprint, e pre-deploy é recurso de plano pago. […]
  // Migrar no boot elimina a corrida **por construção** […]
  ```
- **Impacto técnico**: o `render.yaml` publica uma expectativa falsa. Se um operador futuro achar que a migração acontece antes do boot (pelo yaml) e tentar reordenar/remover o `BootMigrator`, ressuscita o bug de 2026-08-10 (código novo servindo contra schema velho). Este delta agrava marginalmente porque adiciona *mais* uma migration cuja segurança depende do `BootMigrator` — se o operador confiar no yaml, a `0051` cai na trilha errada.
- **Impacto de negócio**: risco baixo enquanto o `BootMigrator` existir; alto se alguém "limpar" o yaml sem ler a docstring. É documentação divergente do runtime, não regressão ativa.
- **Métrica de baseline**: `1` linha inerte no `render.yaml` versus `1` fonte de verdade em código (`BootMigrator.ts`).

### F-deployability-3: Release com DDL vai a produção sem runbook de verificação pós-deploy e sem passo de rollback documentado

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Rollback + Deployment observability
- **Localização**: ausência — `find docs -type f \( -name "*runbook*" -o -name "*release*" \) | xargs grep -l 0.31.1` retorna vazio; `CHANGELOG.md:3-24` (entrada da v0.31.1) não cita procedimento de verificação nem de rollback
- **Evidência (objetiva)**:
  ```
  $ find docs -type f \( -name "*runbook*" -o -name "*release*" \)
  docs/runbooks/fin010-write-cutover.md
  (nenhum específico para release/rollback do app)

  $ grep -c "rollback\|/health\|version" CHANGELOG.md
  0 (para a seção da v0.31.1)
  ```
- **Impacto técnico**: o operador que promover o merge para `main` não tem um passo canônico para (1) `curl https://<render-url>/health` e verificar `version=0.31.1` depois do swap, (2) validar que a `0051` foi aplicada (`SELECT name FROM schema_migrations WHERE name='0051_execucao_identidade_conexos.sql'`), (3) executar rollback se algo quebrar (Render dashboard → previous deploy; DDL fica no schema por ser backward-compatible, mas ninguém disse isso em lugar recuperável).
- **Impacto de negócio**: durante o próximo incidente em janela de release, tempo até o rollback é gasto lendo docstring de código em vez de checklist. MTTR sobe pelo custo de contexto, não pelo custo do problema.
- **Métrica de baseline**: `# releases 0.31.x com runbook explícito de verificação/rollback` = 0.

## 5. Cards Kanban

### [deployability-1] Portar `bump-version.ps1` para um sibling shell/node executável na máquina Linux

- **Problema**
  > O único script canônico de release é pwsh, ausente na máquina de desenvolvimento atual. O bump da v0.31.1 foi feito à mão — bateu byte a byte com o script (verificado), mas nada garante que a próxima replicação seja fiel. Um bump com FE/BE fora de lockstep, ou entrada de CHANGELOG na posição errada, é o modo de falha esperado.

- **Melhoria Proposta**
  > Criar `scripts/bump-version.mjs` (Node puro, sem dependências externas) espelhando a lógica documentada no cabeçalho do `.ps1`: leitura semver + detecção de nível pelos conventional-commits de `origin/main..HEAD` + escrita FE+BE em lockstep + inserção da entrada no CHANGELOG após o header. Manter o `.ps1` como referência para Windows. Adicionar `bump:dry`/`bump:execute` no `package.json` da raiz (novo) ou de `src/backend/`.

- **Resultado Esperado**
  > `node scripts/bump-version.mjs` (dry-run) e `node scripts/bump-version.mjs --execute` funcionam nesta máquina. Toda release futura passa por script, não por replicação manual. Zero divergência entre `package.json` de FE e BE em qualquer commit `chore(release):`.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — a lógica cabe em ~120 LOC de Node puro
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - `# scripts de release executáveis nesta máquina`: 0 → 1
  - `# releases feitas por replicação manual` (medido em `git log --oneline --grep "chore(release)" main..HEAD` ao longo dos próximos 3 meses): trending → 0
- **Risco de não fazer**: divergência FE≠BE numa release futura, tempo de depuração de "que versão do FE tem esse bug" quando o `/health` do BE mentir sobre o app.
- **Dependências**: nenhuma

### [deployability-2] Alinhar `render.yaml` com a realidade (`BootMigrator` é a autoridade de ordering) ou reativar o pre-deploy

- **Problema**
  > O `render.yaml` declara `preDeployCommand: npm run migrate && npm run seed:admin`, que **nunca roda** (o serviço foi configurado pelo dashboard e pre-deploy é plano pago). A doutrina real — migrar dentro do boot antes de `listen()` — só está escrita na docstring do `BootMigrator`. Este delta adiciona a migração `0051`; sua segurança depende de ninguém "arrumar" o yaml achando que resolve o problema.

- **Melhoria Proposta**
  > Duas alternativas, escolher uma no PR:
  > **(a) Documentar a inércia no próprio yaml**: substituir a linha `preDeployCommand:` por um comentário `# preDeployCommand INERTE — serviço configurado pelo dashboard, ver src/backend/migrations/BootMigrator.ts` e apagar o comando; a fonte de verdade fica única.
  > **(b) Reativar o pre-deploy**: upgrade do plano do Render + reconfigurar via Blueprint; então o `preDeployCommand` volta a rodar e o `BootMigrator` vira defense-in-depth (mantém o advisory lock e o guard-rail local, mas o caminho normal é pre-deploy). Custo mensal + trabalho de reconfiguração.

- **Resultado Esperado**
  > O operador que ler o `render.yaml` entende quem aplica migrações, sem precisar abrir docstring de código.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (opção a: minutos) / M (opção b: reconfiguração + validação)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - `# fontes de verdade divergentes para "quem aplica migrações"`: 2 → 1
- **Risco de não fazer**: alguém "consertar" o yaml num futuro `chore(deploy):` e reativar o bug de 2026-08-10 na próxima migração destrutiva.
- **Dependências**: se escolher (b), precisa de aprovação de custo mensal no plano do Render.

### [deployability-3] Runbook de release + verificação pós-deploy do `/health`

- **Problema**
  > Este delta ship DDL em produção (5× `ALTER TABLE`), e a versão do app sobe para 0.31.1 — mas não existe checklist de release enumerando o passo trivial de `curl https://<render-url>/health` para confirmar o swap, nem de `SELECT name FROM schema_migrations WHERE name='0051_execucao_identidade_conexos.sql'` para confirmar a aplicação. Rollback (Render dashboard → previous deploy) também não está documentado. Durante um incidente na janela do próximo release, MTTR sobe pelo custo de contexto.

- **Melhoria Proposta**
  > Criar `docs/runbooks/release.md` (genérico, não por versão) com:
  > 1. Como verificar que o Render promoveu: `curl -s $URL/health | jq .version` == versão do `package.json`.
  > 2. Como verificar que a migração aplicou: `SELECT name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 3`.
  > 3. Como fazer rollback: dashboard Render → Deploys → "Rollback to this deploy". O que acontece com o schema (backward-compat = colunas ficam, código antigo ignora).
  > 4. Sinais de que o `BootMigrator` travou (log `outra instância está migrando`) e como intervir.
  > Opcional: novo job pós-deploy no `ci.yml` que faça `curl $URL/health` e asserte `version === $EXPECTED`.

- **Resultado Esperado**
  > Operador que promove a `main` executa o runbook em < 2 min e sabe se a release deu certo, sem abrir código-fonte.

- **Tactic alvo**: Rollback + Deployment observability
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — documento de ~1 página + job opcional no CI
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - `# releases com verificação automatizada de `/health``: 0 → 1 (com o job no CI)
  - MTTR estimado do próximo incidente de release: baseline não medido → alvo < 15 min
- **Risco de não fazer**: próxima release com DDL não-idempotente ou não-backward-compat (ex.: `DROP COLUMN`, `ADD COLUMN NOT NULL`) chega em produção sem checklist e o MTTR fica preso ao tempo de leitura de docstring.
- **Dependências**: nenhuma (documento) / lockstep com deployability-1 se quiser padronizar scripts de release num só lugar.

## 6. Notas do agente

- Escopo aplicado com rigor: este delta é **paradigmático de uma migração backward-compatible bem feita** — `IF NOT EXISTS`, nullable, sem `NOT NULL`/`DEFAULT`, cinco tabelas, tudo assinado por `BootMigrator` com advisory lock e ordering garantido por construção (`await BootMigrator.run(); app.listen()`). Rollback é seguro por observação empírica: `git grep conexos_username 617ca3b -- src/backend` = vazio; a versão anterior não referencia as colunas novas. Score 8/10 reflete isso — os 3 findings são todos P3 sobre documentação/tooling ao redor da release, não sobre o mecanismo em si.
- Métricas de produção (tempo real de boot em Render, tempo de aplicação da 0051 no Supabase compartilhado, latência do `/health` durante o swap) **não medíveis daqui**: `.env` aponta para Supabase de produção e a instrução explícita é read-only. Recomendação para o consolidator: se houver telemetria do Render agregada em algum lugar, cruzar com estes findings.
- Cross-QA: F-deployability-2 (yaml inerte × docstring) ecoa em **Modifiability** — divergência documentação/runtime é dívida clássica. F-deployability-3 (verificação pós-deploy do `/health`) toca **Availability** (probe existe mas não é asserida). Alertar o consolidator.
