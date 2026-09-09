---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-08-2011
agent: qa-deployability
generated_at: 2026-09-08T20:35:00Z
scope: backend
score: 7.0
findings_count: 7
cards_count: 7
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta permuta-snapshot-estados)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge em `main` da branch `fix/permuta-snapshot-estados` | Push dispara CI (`ci.yml`) → autoDeploy do Render → instância nova sobe rodando `BootMigrator` que aplica a migration `0054_estado_ja_permutado.sql` (backfill de 152.516 linhas + reescrita de 250 headers, com asserção que aborta a transação toda) | Backend Express em `src/backend/` + schema Postgres (Supabase) — snapshot e header de eleição de permutas | Produção Render/Supabase, autoDeploy on-push, sem canary; frontend Vercel deploya em paralelo pelo mesmo push | Novo processo migra sob `pg_advisory_lock` ANTES do `app.listen`; se migração falhar, `process.exit(1)` mantém a versão anterior servindo; kill-switches por env-var (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`) permitem desligar frentes sem redeploy | Deploy verde = 0 janela de "código novo × schema velho" (garantido por `BootMigrator`); migração 0054 é idempotente por `WHERE status='bloqueada'` + recomputação. **Rollback do app após migração aplicada = corrupção silenciosa dos snapshots reclassificados** (não há script de reverse; código antigo escreve `bloqueada` de volta) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados de commit-a-prd (backend) | 7 (checkout, setup-node, `npm ci`, `npm audit --audit-level=high`, `typecheck`, `lint`, `test --coverage`, `build`) + Render autoDeploy | ≥5 | ✅ | `.github/workflows/ci.yml` linhas 12-28 |
| Gate de merge em `main` | branch protection (CI Backend + Frontend required) — declarado em `render.yaml` linhas 8-12 | presente | ✅ (declarado; não medível via CLI local) | `render.yaml:9-12` |
| Ordem migração vs. tráfego | Migração roda no boot do processo (advisory-lock 314159265, 30 tentativas × 2s) antes de `app.listen`; `preDeployCommand` no `render.yaml` é belt-and-suspenders (BootMigrator docstring afirma que nunca rodou porque serviço foi configurado no dashboard) | schema aplicado antes do tráfego | ✅ | `src/backend/migrations/BootMigrator.ts:57-90`, `src/backend/index.ts:159-165` |
| Rollback automático de deploy Render | Render mantém instância anterior no ar se boot falhar (`process.exit(1)` em falha de migração) | presente | ✅ | `src/backend/index.ts:177-181` |
| Script de rollback SQL para a migration 0054 | **ausente** — `ls src/backend/migrations/*rollback*` → vazio | 1 script por migration destrutiva | ❌ | `ls src/backend/migrations/` (nenhum `_rollback.sql`) |
| Rollback do app após migração 0054 aplicada | Corrompe dados: código antigo em `mapSnapshotRow` faz catch-all → `'bloqueada'`, e `insertCandidataChunk` só grava `bloqueada`/`elegivel` — sobrescreve reclassificação de 152.516 linhas com o binário. `EleicaoPermutasService` antigo também recontaria `total_bloqueadas` sem incluir os novos buckets | reverse determinístico ou script assistido | ❌ | Ausência de script + análise do delta em `IngestaoPermutasService.toEstadoRow` (novo) vs. `mapSnapshotRow` no `origin/main` |
| Idempotência da migration 0054 | Backfill filtra `WHERE status='bloqueada'`; header recalculado por SELECT do snapshot (não subtração); asserção usa condição `NOT EXISTS (...NOT IN ('elegivel','bloqueada'))` como detector "já migrada" | idempotente | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:117-131,160-165,185-200` |
| Kill-switches sem redeploy | `SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED` marcados `sync:false` (dashboard é fonte da verdade); `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN` idem | presente | ✅ | `render.yaml:27-58` |
| Alerta em falha de cron (ADR-0042) | Todos os 6 workflows scheduled têm passo `Alertar falha (ADR-0042)` com `if: failure()` gravando em `alerta` | 100% dos crons | ✅ | `.github/workflows/*.yml` (todos) |
| Lockstep de versão FE+BE | `scripts/bump-version.ps1` normaliza para a maior; hoje FE=BE=0.34.0 | mesma versão | ✅ | `jq -r .version src/{frontend,backend}/package.json` |
| `pwsh` disponível no ambiente de dev (Linux) | **ausente** (`which pwsh` → vazio) | presente ou script portátil | ⚠️ | `which pwsh` no worktree |
| Fricção do CHANGELOG na release | Autor escreveu bloco `## Não lançado` (linhas 1-42); `bump-version.ps1` insere `## vX.Y.Z (data)` DEPOIS do header, mantendo `## Não lançado` abaixo — exige merge manual para promover o texto autoral para a versão nova | script promove o texto autoral | ⚠️ | `scripts/bump-version.ps1:194-207` + `CHANGELOG.md:1-42` |
| Quebra de série histórica documentada | Sim, com tabela antes×depois no topo do CHANGELOG (64.893 → 51.459 `total_bloqueadas`; nova coluna `total_ja_permutado`) | documentado | ✅ | `CHANGELOG.md:3-19` |
| Escopo Terraform / IaC | ⚠️ **Não medível**: não existe `infra/` neste repo. Deploy é Render (backend) via `render.yaml` + Vercel (frontend) autoDeploy. Toda tactic de multi-tenant Terraform / SSM / per-account state é N/A para este projeto | — | ⚠️ | `ls infra/` → `No such file or directory` |
| Tenants provisionados | ⚠️ Não medível: sem `infra/tenants-vars/` | — | ⚠️ | `_shared-metrics.md` |
| `terraform plan` gate | ⚠️ Não medível: não há `infra/` | — | ⚠️ | ausência de `.tf` no repo |
| Migrations aplicadas | 55 arquivos em `src/backend/migrations/*.sql`, aplicados sequencialmente por `MigrationRunner` sobre `schema_migrations` | ordem lexicográfica | ✅ | `ls src/backend/migrations/*.sql \| wc -l` |
| Reprodutibilidade de build | `package-lock.json` versionado, `npm ci` no CI, Node fixado em `24` no CI e `22` nos crons | lockfile + Node pinado | ⚠️ (divergência 22↔24 entre CI e crons) | `.github/workflows/ci.yml:16` vs. `ingest-permutas.yml:38` |
| Rota HTTP removida no delta | `GET /permutas/painel` deletado (junto com `PainelService.ts` e teste) | descontinuação anunciada + zero call sites | ✅ | `git diff --stat` mostra `src/backend/domain/service/permutas/PainelService.ts` deletado; ADR-0043 §5 |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Render autoDeploy sem canary/blue-green explícito. Kill-switches por env-var permitem "canary por feature-flag" (SISPAG_LIVE_WRITE_ENABLED, RECEBIMENTOS_ENABLED, CONEXOS_WRITE_ENABLED, CONEXOS_DRY_RUN) | ⚠️ parcial | `render.yaml:29-58` |
| Rollback | Deploy: Render mantém instância anterior se boot falhar (bom). App-code rollback pós-migração: **quebrado para este delta** — não há script de reverse do backfill e o código antigo corrompe silenciosamente | ⚠️ parcial | `src/backend/index.ts:177-181`; ausência de `0054_rollback.sql` |
| Script Deployment Commands | `render.yaml` declara build/start/preDeploy; migração scriptada em `migrate.ts` + BootMigrator; kill-switches via dashboard; `bump-version.ps1` em PowerShell | ⚠️ parcial | `render.yaml`, `src/backend/migrations/migrate.ts`, `scripts/bump-version.ps1` |
| Logical Grouping | Migrations em `src/backend/migrations/` numeradas; workflows por pipeline em `.github/workflows/` nomeados por frente | ✅ presente | `ls .github/workflows/` |
| Physical Grouping | Backend em serviço único no Render; crons em runners do GitHub Actions (uma workflow por pipeline). Sem contêineres — Render Node runtime | ✅ presente | `render.yaml:2-8`, `.github/workflows/*.yml` |
| Package Dependencies | `package-lock.json` versionado; `npm ci` no CI e nos crons; `npm audit --audit-level=high` no CI (gate) | ✅ presente | `.github/workflows/ci.yml:18` |
| Surge Protection | Não aplicável no path de deploy per se; no runtime, `RECEBIMENTOS_ENABLED`/`SISPAG_LIVE_WRITE_ENABLED` funcionam como circuit-breakers manuais para desligar tráfego sob incidente sem redeploy | ✅ presente (para write-paths) | `render.yaml:29-58` |
| Idempotent Deploys | Migração 0054 desenhada para no-op na 2ª execução (WHERE + recomputação); `seed:admin` UPSERT idempotente | ✅ presente | `src/backend/migrations/0054_estado_ja_permutado.sql:47-56,117-131,185-200` |
| Drift Detection | Não há `terraform plan`; não há job de sanity-check de schema. Detector de staleness cobre execução de pipelines (`detect-staleness.yml`), não drift de infra ou schema | ⚠️ parcial (staleness ≠ drift) | `.github/workflows/detect-staleness.yml` |
| Reproducible Builds | Lockfile presente; Node fixado — mas **divergente** entre CI (`node-version: 24`) e crons (`node-version: 22`). O runtime real (Render) usa `runtime: node` sem pin explícito no `render.yaml` | ⚠️ parcial | `.github/workflows/ci.yml:16` vs. `.github/workflows/ingest-permutas.yml:38` vs. `render.yaml:5` |
| Per-tenant blast-radius limit | N/A — o repo tem **um** tenant (`client_name=local`), sem multi-tenancy Terraform. Um deploy afeta 100% dos usuários | N/A | CLAUDE.md §Tenants declara vazio |
| Deployment observability | `/health` devolve `{status,version}` (Render usa `healthCheckPath`); passos `Alertar falha` gravam em `alerta` para todo cron; ausente: métrica de duração de migração e sinal de "migração X foi aplicada agora" | ⚠️ parcial | `src/backend/index.ts:79`, `.github/workflows/*.yml` (todos com passo de alerta) |

## 4. Findings

### F-deployability-1: Migration 0054 destrutiva sem script de rollback

- **Severidade**: P1
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql` (arquivo inteiro); ausência de `src/backend/migrations/0054_rollback.sql`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/migrations/ | grep -i rollback
  (nenhum resultado)

  # A migration reescreve 152.516 linhas de snapshot e 250 headers:
  UPDATE permuta_candidata_snapshot SET status = CASE ... END WHERE status = 'bloqueada';
  UPDATE permuta_eleicao_run r SET total_bloqueadas = c.bloqueadas, total_casamento_manual = ..., total_permuta_manual = ..., total_ja_permutado = ...
  ```
- **Impacto técnico**: um rollback do processo Render para a versão anterior (main pré-delta) **não** reverte a migração — o schema fica com CHECK expandida e dados reclassificados; o código antigo, ao ler um snapshot com `status='ja-permutado'`, cai no ramo `!== 'elegivel' ? 'bloqueada'` do `mapSnapshotRow` antigo, e ao escrever numa nova eleição, `EleicaoPermutasService` antigo grava só `bloqueada`/`elegivel` (perdendo os buckets novos). Isso **sobrescreve** a reclassificação da 0054 nas runs que voltarem a ser executadas.
- **Impacto de negócio**: se o delta precisar ser revertido depois de uma eleição rodar em prd, a série histórica volta a mentir e os 348 itens da fila da Kavex desaparecem de novo do painel — o mesmo problema que a ADR-0043 acabou de corrigir, agora sem trilha (o dado original de `status` já se perdeu no primeiro backfill).
- **Métrica de baseline**: 152.516 linhas de snapshot + 250 headers modificados sem caminho de reverse; 0 scripts `*_rollback.sql` no diretório de migrations.

### F-deployability-2: Rollback simétrico de app+schema não é oferecido pelo pipeline

- **Severidade**: P1
- **Tactic violada**: Rollback, Script Deployment Commands
- **Localização**: `render.yaml`, `src/backend/index.ts:155-181`, `src/backend/migrations/BootMigrator.ts`
- **Evidência (objetiva)**:
  ```
  render.yaml: preDeployCommand: npm run migrate && npm run seed:admin
  BootMigrator.ts:35-45 docstring: "O `preDeployCommand` do `render.yaml` **nunca rodou**"
  ```
  Render "rollback deploy" leva o código para o commit anterior mas NÃO desaplica migrações (não há hook `preDeployRollbackCommand` no `render.yaml`; `schema_migrations` continua com a linha `0054_...`).
- **Impacto técnico**: o pipeline entrega deploy-forward atômico (BootMigrator garante schema>=código), mas o path de deploy-backward é **assimétrico**: código volta 1 versão, schema fica na versão N+1. Combinado com F-deployability-1, isto materializa a janela onde código antigo escreve estado colapsado sobre dado corrigido.
- **Impacto de negócio**: incidentes em produção onde a única saída rápida é "voltar o commit anterior" contaminam o dado agora migrado. Time perde a opção "reverter e pensar depois" — só sobra "avançar corrigindo".
- **Métrica de baseline**: 0 scripts de reverse (ver F-1); 55 migrations aplicadas, 0 documentadas com reverse; 1 caso histórico documentado onde a inversão migração×deploy causou incidente (BootMigrator.ts docstring: "em 2026-08-10 o código da ADR-0032 chegou a produção antes da `0044`").

### F-deployability-3: `bump-version.ps1` requer PowerShell, ausente no ambiente Linux atual

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands, Reproducible Builds
- **Localização**: `scripts/bump-version.ps1:1` (`#!/usr/bin/env pwsh`)
- **Evidência (objetiva)**:
  ```
  $ which pwsh
  (vazio)
  $ uname -sr
  Linux 7.0.0-30-generic
  ```
  O script é chamado pelo passo Ship do AutoLoopRunner (green criterion #10 do CLAUDE.md). Sem `pwsh` na PATH, o passo aborta.
- **Impacto técnico**: qualquer worktree/dev machine sem PowerShell (Linux/CI runner Ubuntu genérico) não executa o Ship — abre a porta para PRs sem commit `chore(release)` e versão do app não bumpa. Alternativa manual (`Level` forçado, edição manual do CHANGELOG) contorna, mas anula o determinismo do lockstep.
- **Impacto de negócio**: dev novo no time em Linux gasta um dia entendendo por que o `bump-version` falha silenciosamente; ou pior, o passo é pulado e a versão exibida em `/health` fica em desacordo com o que está em produção.
- **Métrica de baseline**: 1 script obrigatório de release em `.ps1` num monorepo TypeScript com deploy Linux (Render Node) — 100% de acoplamento a um runtime não-instalado no target real.

### F-deployability-4: CHANGELOG exige merge manual entre `## Não lançado` e a entrada nova gerada

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `CHANGELOG.md:3-42` (bloco `## Não lançado`) + `scripts/bump-version.ps1:194-207` (insert-after-header)
- **Evidência (objetiva)**:
  ```
  # bump-version.ps1:196-199
  $idx = $cur.IndexOf($header) + $header.Length
  $rest = $cur.Substring($idx).TrimStart("`r", "`n")
  $new = "$header`n`n$entry`n$rest"

  # CHANGELOG.md hoje:
  # Columbia Financeiro — Changelog

  ## Não lançado — o snapshot da eleição para de mentir (ADR-0043)
  ...
  ```
  O script insere `## v0.35.0 (2026-09-08)` entre o header e o `## Não lançado`, gerando dois blocos consecutivos e obrigando o autor a mover conteúdo manualmente antes do PR.
- **Impacto técnico**: fricção reprodutível em toda release. Autor perde 2-5 min por release editando CHANGELOG; risco de mesclar mal (perder trecho do autor ou duplicar linhas de commit).
- **Impacto de negócio**: notas de release perdem o texto contextual (a tabela antes×depois de "bloqueadas") se o operador só mergear as bullet-lists automáticas. É o texto crítico para consumidores da série histórica.
- **Métrica de baseline**: 42 linhas de conteúdo em `## Não lançado`; 0 delas serão promovidas automaticamente para `## v0.35.0`.

### F-deployability-5: Divergência de versão de Node entre CI (24) e crons (22)

- **Severidade**: P2
- **Tactic violada**: Reproducible Builds
- **Localização**: `.github/workflows/ci.yml:16` (`node-version: '24'`) vs. `.github/workflows/ingest-permutas.yml:38` (`node-version: 22`) — mesmo padrão em `ingest-sispag.yml`, `ingest-extratos.yml`, `reaper-sispag.yml`, `reconciliar-nde.yml`, `detect-staleness.yml`
- **Evidência (objetiva)**:
  ```
  ci.yml: node-version: '24'
  ingest-permutas.yml: node-version: 22
  ingest-sispag.yml: node-version: 22
  ingest-extratos.yml: node-version: 22
  reaper-sispag.yml: node-version: 22
  reconciliar-nde.yml: node-version: 22
  detect-staleness.yml: node-version: 22
  render.yaml: runtime: node        # sem pin de versão
  ```
- **Impacto técnico**: o binário testado no CI (Node 24) não é o que roda os jobs de ingestão (Node 22). API-diff entre majors (crypto, streams, buffers) pode passar batido no CI e explodir no cron. Migração 0054 aplicada pelos crons na primeira execução após deploy — divergência de comportamento aqui é diretamente relevante ao delta.
- **Impacto de negócio**: falha de cron por incompatibilidade Node cai em `alerta` (ADR-0042 cobre), mas o custo é descobrir o problema numa 3h da manhã em prd em vez de no CI.
- **Métrica de baseline**: 1 versão no CI (24) × 6 workflows de cron em 22 × Render sem pin — 3 mundos possíveis de Node em execução no mesmo repo.

### F-deployability-6: Rota `GET /permutas/painel` removida sem `410 Gone` ou nota de descontinuação HTTP

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts (para clientes externos)
- **Localização**: `src/backend/routes/permutas.ts` (delta remove o handler); `src/backend/domain/service/permutas/PainelService.ts` (deletado)
- **Evidência (objetiva)**:
  ```
  git diff --stat mostra:
    D src/backend/domain/service/permutas/PainelService.ts
    D src/backend/domain/service/permutas/PainelService.test.ts
    M src/backend/routes/permutas.ts (17 linhas removidas)
  ```
  O CHANGELOG e a ADR-0043 §5 afirmam "zero call sites no frontend". Não há observabilidade histórica de que nenhum cliente externo (script, dashboard, Postman collection) chamou `/permutas/painel`.
- **Impacto técnico**: se algum consumidor não-versionado bater na rota, recebe 404 sem explicação. Baixo risco (autenticação exigia admin), mas silencioso.
- **Impacto de negócio**: mínimo dado que o painel era interno + sem consumidor documentado. Registrado por completude.
- **Métrica de baseline**: 1 endpoint HTTP público removido no delta; 0 telemetria de call-sites externos disponível para confirmar 0 consumidores.

### F-deployability-7: `render.yaml.preDeployCommand` declara `npm run migrate` mas em produção nunca rodou

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands (o script existe mas não é executado — falso senso de segurança)
- **Localização**: `render.yaml:20` (`preDeployCommand: npm run migrate && npm run seed:admin`), `DEPLOY.md:23`, e a contra-declaração em `src/backend/migrations/BootMigrator.ts:33-38`
- **Evidência (objetiva)**:
  ```
  render.yaml:19-20
    # Runs migrations + admin seed before serving traffic on each deploy.
    preDeployCommand: npm run migrate && npm run seed:admin

  BootMigrator.ts:33-38 (docstring)
  "O `preDeployCommand` do `render.yaml` **nunca rodou**: o serviço do Render foi configurado pelo
   dashboard, não pelo Blueprint, e pre-deploy é recurso de plano pago. O resultado apareceu em
   produção em 2026-08-10 — o código da ADR-0032 subiu calculando a chave natural nova enquanto o
   banco ainda tinha as chaves antigas, e a `0044` só foi aplicada à mão"
  ```
- **Impacto técnico**: leitor casual do `render.yaml` acredita que há dois gates (preDeploy + BootMigrator). Só o BootMigrator está de fato ativo. Se o `BootMigrator` for desligado por engano no futuro, o `preDeployCommand` também não estará lá.
- **Impacto de negócio**: baixo (a proteção real existe), mas a documentação em duas fontes (`render.yaml` + `DEPLOY.md`) desalinha com a realidade — dívida de doc que confunde onboarding.
- **Métrica de baseline**: 1 declaração falsa no `render.yaml`, 1 declaração falsa no `DEPLOY.md`, 1 fonte de verdade real no código (`BootMigrator.ts`).

## 5. Cards Kanban

### [deployability-1] Criar `0054_rollback.sql` (reverse determinístico) e adotar convenção de rollback obrigatório para migrations destrutivas

- **Problema**
  > A migration 0054 reescreve 152.516 linhas de snapshot e 250 headers sem script de reverse. Rollback de deploy da branch `fix/permuta-snapshot-estados` deixa código antigo servindo contra schema já migrado, e a próxima eleição contamina o dado reclassificado. `motivo_bloqueio` sobrevive intacto, então o reverse é determinístico — só falta escrevê-lo.

- **Melhoria Proposta**
  > Criar `src/backend/migrations/0054_rollback.sql` como script manual (não auto-aplicado): `UPDATE permuta_candidata_snapshot SET status='bloqueada' WHERE status IN ('casamento-manual','permuta-manual','ja-permutado')` + `UPDATE permuta_eleicao_run SET total_bloqueadas = total_bloqueadas + total_casamento_manual + total_permuta_manual + total_ja_permutado`, seguido de `DROP COLUMN` opcional para as 3 colunas novas. Documentar em `docs/runbooks/rollback-0054.md` com o procedimento completo (parar traffic, aplicar rollback SQL, deploy do código antigo). Instaurar convenção: toda migration com `UPDATE` sobre >1000 linhas exige script de reverse ao lado. Tactic: **Rollback**.

- **Resultado Esperado**
  > Se o delta precisar ser revertido, o operador tem um caminho scriptado (RPO = 0, RTO ≈ 5 min) em vez de "avançar corrigindo".

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1, F-deployability-2
- **Métricas de sucesso**:
  - scripts `*_rollback.sql` em `src/backend/migrations/`: 0 → ≥1 (para 0054) e política escrita para futuras
  - Runbook `docs/runbooks/rollback-0054.md`: ausente → presente
- **Risco de não fazer**: no primeiro incidente em prd após a v0.35.0, a única saída rápida ("volta o commit") corrompe silenciosamente a reclassificação — o problema que a ADR-0043 acabou de fechar reabre com o sinal invertido.
- **Dependências**: nenhuma.

### [deployability-2] Automatizar rollback simétrico (código + schema) e documentar o hook do Render

- **Problema**
  > `render.yaml` promete `preDeployCommand: npm run migrate` mas na prática nunca rodou (serviço configurado pelo dashboard; pre-deploy é plano pago). O BootMigrator cobre o forward, mas o botão "rollback deploy" do Render só reverte código — deixa `schema_migrations` intocada. Combinado com F-1, isso materializa a janela de corrupção.

- **Melhoria Proposta**
  > Duas ações: (a) **remover ou corrigir** `preDeployCommand` no `render.yaml` (upgrade de plano ou removê-lo do YAML e deixar só o BootMigrator, atualizando `DEPLOY.md` para refletir a realidade); (b) escrever `docs/runbooks/rollback-deploy.md` com o procedimento manual: revert commit → aplicar `NNNN_rollback.sql` correspondente → push → Render re-deploya. Ideal: uma GitHub Action `workflow_dispatch` chamada `rollback-to-tag` que faz o revert + roda um SQL script parametrizado. Tactic: **Rollback + Script Deployment Commands**.

- **Resultado Esperado**
  > O caminho de rollback é 1 comando (`gh workflow run rollback-to-tag -f tag=v0.34.0`) em vez de 4 passos manuais, e a docstring do BootMigrator, o `render.yaml` e o `DEPLOY.md` param de mentir uns para os outros.

- **Tactic alvo**: Rollback, Script Deployment Commands
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-deployability-2, F-deployability-7
- **Métricas de sucesso**:
  - fontes discordantes sobre `preDeployCommand`: 3 (`render.yaml`, `DEPLOY.md`, `BootMigrator.ts`) → 1
  - passos manuais em rollback: 4+ → 1 (`gh workflow run rollback-to-tag`)
- **Risco de não fazer**: qualquer deploy futuro com migração DDL herda a mesma assimetria — F-1 tende a se repetir a cada release destrutiva.
- **Dependências**: deployability-1 (o script de reverse SQL é insumo do workflow).

### [deployability-3] Portar `bump-version.ps1` para Node ou tornar o passo Ship independente de PowerShell

- **Problema**
  > `bump-version.ps1` tem shebang `#!/usr/bin/env pwsh` e o ambiente atual (Linux, `which pwsh` vazio) não tem PowerShell instalado. O passo Ship (green criterion #10 do CLAUDE.md) obriga o script — Linux devs não conseguem completar `/feature-tweak` sem instalar dependência extra.

- **Melhoria Proposta**
  > Reescrever `scripts/bump-version.ps1` em Node (`scripts/bump-version.mjs`), usando `fs`/`path` nativos + `child_process.execSync('git ...')`. TypeScript não é necessário — é ~100 linhas de lógica semver. Alternativamente: instalar `pwsh` no CI + documentar `apt-get install powershell` no README. Preferência: portar (menor superfície). Tactic: **Script Deployment Commands + Reproducible Builds**.

- **Resultado Esperado**
  > `node scripts/bump-version.mjs` roda em qualquer OS onde já roda o backend. Zero dependência extra.

- **Tactic alvo**: Script Deployment Commands, Reproducible Builds
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - dependência de runtime não-Node no path de release: 1 (pwsh) → 0
  - devs bloqueados no Ship por OS/runtime: 100% dos Linux sem pwsh → 0%
- **Risco de não fazer**: novo dev Linux gasta um dia debugando o Ship, ou pula o passo e commita sem `chore(release)` — versão em `/health` diverge do estado do repo.
- **Dependências**: nenhuma.

### [deployability-4] Fazer `bump-version` promover `## Não lançado` em vez de inserir bloco acima dele

- **Problema**
  > O bloco `## Não lançado` é onde o autor escreve o texto rico da release (tabela antes×depois, motivo do bump). O script atual insere `## vX.Y.Z (data)` acima, com bullets automáticas de commits — deixando dois blocos que precisam de merge manual. Perde-se o texto autoral se o operador só empurrar o PR sem editar.

- **Melhoria Proposta**
  > No `bump-version` (portado ou não), detectar o bloco `## Não lançado` e **substituir** o cabeçalho por `## vX.Y.Z (data)`, mantendo o conteúdo abaixo. Se o autor não escreveu `## Não lançado`, cair no comportamento atual (gerar bullets de commit). Tactic: **Script Deployment Commands**.

- **Resultado Esperado**
  > `## Não lançado — o snapshot da eleição para de mentir (ADR-0043)` vira `## v0.35.0 (2026-09-08) — o snapshot da eleição para de mentir (ADR-0043)` num único passo, sem merge manual.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - passos manuais no CHANGELOG por release: 1+ → 0
  - releases com texto autoral perdido nas notas: risco atual >0% → 0%
- **Risco de não fazer**: releases futuros com texto rico repetem a fricção; alguém eventualmente publica notas incompletas.
- **Dependências**: deployability-3 (se portado para Node, aproveitar o mesmo trabalho).

### [deployability-5] Unificar versão de Node entre CI, crons e Render

- **Problema**
  > CI roda Node 24, os 6 crons rodam Node 22, e o Render não pina versão (`runtime: node`). API-diff entre majors pode passar no CI e falhar em cron/prd. A migration 0054 é aplicada por qualquer um dos crons na 1ª execução após deploy — divergência é diretamente relevante ao delta.

- **Melhoria Proposta**
  > (a) Adicionar `"engines": { "node": ">=22 <23" }` em `src/backend/package.json` + `src/frontend/package.json`; (b) pinar `node-version` em CI para o mesmo major (22); (c) documentar no `render.yaml` como comentário qual versão o Render está servindo (o dashboard tem um campo `NODE_VERSION` env-var). Tactic: **Reproducible Builds**.

- **Resultado Esperado**
  > 1 versão de Node em todo o pipeline. Um upgrade futuro é uma mudança única.

- **Tactic alvo**: Reproducible Builds
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - versões distintas de Node no repo: 3 → 1
- **Risco de não fazer**: um crypto/streams-diff quebra um cron em prd; ADR-0042 cobre o alerta, mas o custo é diagnóstico noturno em vez de red no CI.
- **Dependências**: nenhuma.

### [deployability-6] Substituir `GET /permutas/painel` deletado por handler 410 Gone temporário (2 releases)

- **Problema**
  > Rota removida sem `410 Gone` + nota. Consumidores externos hipotéticos recebem 404 silencioso.

- **Melhoria Proposta**
  > Manter um handler 410 em `src/backend/routes/permutas.ts` por 2 releases, com body `{ "gone": true, "reason": "endpoint descontinuado — ver ADR-0043" }`. Depois de 30 dias sem hit no log de acesso, remover de vez. Tactic: **Scale Rollouts** (deprecation graceful).

- **Resultado Esperado**
  > Consumidor externo (se existir) recebe erro semântico com pointer para ADR; sinal claro em vez de 404 mudo.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-6
- **Métricas de sucesso**:
  - endpoints removidos com deprecation semântica: 0 → 1
- **Risco de não fazer**: baixo (o endpoint exigia admin e não tinha call site conhecido); registrado para consistência.
- **Dependências**: nenhuma.

### [deployability-7] Reconciliar `render.yaml.preDeployCommand` e `DEPLOY.md` com a realidade do BootMigrator

- **Problema**
  > `render.yaml:19-20` e `DEPLOY.md:24-26` afirmam que o Pre-Deploy roda `npm run migrate && npm run seed:admin`. A docstring do `BootMigrator.ts:33-38` diz literalmente que "o preDeployCommand nunca rodou". Três fontes desalinhadas para o mesmo comportamento.

- **Melhoria Proposta**
  > Duas opções mutuamente exclusivas: (a) **desligar** o `preDeployCommand` no `render.yaml` (comentado como "não usado — vide BootMigrator"), remover a linha do `DEPLOY.md`; ou (b) **habilitar** o plano do Render que suporta pre-deploy e usar o pre-deploy como belt-and-suspenders (BootMigrator continua ativo). Preferência: (a), reduzir superfície. Tactic: **Script Deployment Commands**.

- **Resultado Esperado**
  > Doc e config batem com o comportamento real. Onboarding para de perder tempo procurando por que o pre-deploy não aparece nos logs.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-7
- **Métricas de sucesso**:
  - declarações discordantes sobre a origem da migração no deploy: 3 → 1
- **Risco de não fazer**: baixo; débito de documentação, não de comportamento.
- **Dependências**: idealmente, deployability-2 (revisar rollback ao mesmo tempo).

## 6. Notas do agente

- **Cross-QA (para o consolidator)**: F-deployability-1/2 têm forte overlap com **fault-tolerance** (o cenário "deploy antigo × schema novo" é modo de falha do sistema após rollback) e com **modifiability** (o custo de reverter é função direta de como as migrations foram escritas). Sugiro que o card `deployability-1` seja também referenciado pelo qa-fault-tolerance.
- **Cross-QA (performance)**: BootMigrator segura o `app.listen` até a migração acabar. Numa migration como a 0054 (152k UPDATEs), o pod fica indisponível pelo tempo do backfill — cold-start efetivo do deploy. Não medi a duração (modo --quick), mas é uma métrica que qa-performance deveria observar num próximo ciclo.
- **Métrica não coletada**: duração real da migration 0054 em prd (proxy do downtime de deploy). Requer acesso ao log do Render após o próximo deploy. Recomendação: instrumentar `BootMigrator.run` com `console.time('boot-migrate')`/`console.timeEnd` e monitorar.
- **Escopo excluído**: toda tactic de multi-tenant IaC (Terraform, per-tenant state, drift detection via `terraform plan`) foi marcada N/A — não há `infra/` neste repo, o deploy é mono-tenant via Render + Vercel. As tactics correspondentes do modelo Bass foram traduzidas para o equivalente Render/GH-Actions onde aplicável.
