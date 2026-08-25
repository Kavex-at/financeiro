---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-deployability
generated_at: 2026-08-25T17:42:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 5
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev merga PR em `main` | GitHub push dispara CI + Render auto-deploy | `financeiro-backend` (Render Web Service) + banco Supabase | Produção, cliente Columbia usando painel SISPAG em outra aba | Render roda `npm ci && build`, aplica migrations no boot (BootMigrator com advisory lock), começa a servir tráfego. `SISPAG_LIVE_WRITE_ENABLED=false` (default) mantém a escrita SISPAG em dry-run até que alguém habilite no dashboard. | Zero baixa duplicada no fin010; zero lote SISPAG órfão no ERP; 0 downtime perceptível pelo operador; kill-switch por frente ajustável **sem redeploy**. |

Segundo cenário (retomada de execução órfã pós-deploy):
> Restart do Render durante `POST fin015/importar` deixa `remessa_execucao.status=reconciling`; próximo clique no lote descobre o órfão via `RemessaService.sincronizarComErp` e retoma do ponto exato — sem redeploy, sem intervenção manual, sem duplicar lote no ERP. Métrica: 3/3 cenários de retomada verdes no `validate-retomada-remessa-v1.ts` em HML.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates de CI antes do deploy | 6 (`npm ci`, `audit --level=high`, `typecheck`, `lint`, `test --coverage`, `build`) | ≥5 | ✅ | `.github/workflows/ci.yml:16-25` |
| CI bloqueia merge (branch protection) | Sim — CI `Backend`/`Frontend` obrigatórios | Sim | ✅ | `render.yaml:11-14` (comentário) |
| Migração aplicada antes de servir tráfego | Sim (`preDeployCommand` + BootMigrator no boot) | Sim | ✅ | `render.yaml:22`, `BootMigrator.ts:24-38` |
| Serialização de migrations entre instâncias | Sim (`pg_try_advisory_lock` chave 314159265, 30 tentativas × 2s) | Sim | ✅ | `BootMigrator.ts:127-146` |
| Rollback de migration 0050 | ❌ Não há par `down.sql` nem tabela histórica de reversão | Par de rollback ou nota "additive-only" documentada | ⚠️ | `ls src/backend/migrations/ \| grep 0050` → só `0050_conciliacao_execucao.sql` |
| Kill-switch por frente sem redeploy (`SISPAG_LIVE_WRITE_ENABLED`) | Sim — `sync:false` no render.yaml, lida a cada request via `EnvironmentProvider` | Sim | ✅ | `render.yaml:30-36`, `EnvironmentProvider.ts:221` |
| Sinalização visível ao operador de que o kill-switch está OFF | ❌ Copy do frontend diz "A escrita está desligada (`CONEXOS_DRY_RUN`)" mesmo quando o motivo real é `SISPAG_LIVE_WRITE_ENABLED=false` | Mensagem identifica a var responsável | ❌ | `src/frontend/app/sispag/components/LoteCard.tsx:225-230` |
| Health-check pós-deploy verifica kill-switch | ❌ `/health` não expõe `sispagLiveWriteEnabled` (nem qualquer flag) | Endpoint `/health` ou `/config` expondo flags observáveis | ❌ | `render.yaml:23` (`healthCheckPath: /health`) — inspeção do handler não revela flags no payload |
| Reaper (`job:reaper-sispag`) agendado | ❌ Documentado no header do job como cron 15 min, mas NÃO existe workflow no `.github/workflows/` | Workflow `schedule: */15 * * * *` ou equivalente | ❌ | `reaper-sispag-reconciling.ts:22-24` (comentário) vs `ls .github/workflows/` (não há) |
| Cobertura da observação de órfãos no caminho quente | ✅ Painel expõe `execucoesParadas` (mesma consulta SQL do reaper) | Presente | ✅ | `SispagPainelService.ts:296-322`, `page.tsx:483-510` |
| Guard-rail de DDL local × banco remoto bloqueia deploy em produção | Não — só dispara quando `environment=local`; render.yaml fixa `environment=production` | Não bloquear deploy legítimo | ✅ | `BootMigrator.ts:98-100`, `render.yaml:16-17` |
| Jobs de HML/dry-run isolados dos operacionais | Parcial — `job:reaper-sispag` e `job:capture-fixtures` moram no mesmo `scripts:` de `job:ingest-*`, mas `execute-fin015-prd`, `preflight-fin015-prd`, `cleanup-fin015-testes`, `seed-hml-vencimento`, `validate-retomada-remessa-v1` NÃO estão em `scripts:` — só via `npx tsx`. Cada job perigoso tem guarda por URL/flag. | Zero job HML acionável por `npm run` sem guarda | ⚠️ | `src/backend/package.json:14-26`, `seed-hml-vencimento.ts:39-42`, `validate-retomada-remessa-v1.ts:48-51` |
| Reproducible builds — lockfile commitado | Sim (`src/backend/package-lock.json`, `src/frontend/package-lock.json`); CI usa `npm ci` | Sim | ✅ | `ci.yml:19-21` (`cache-dependency-path`) |
| Tag/release automatizada | Sim — `tag-release` job cria tag `vX.Y.Z` e Release a partir de `frontend/package.json` | Sim | ✅ | `ci.yml:52-77` |
| Delta desta feature toca `render.yaml`/`migrations/`/`package.json` | ❌ **Não** — o diff `da2714e..HEAD` é 100% em `src/backend/domain/**` + `src/frontend/**` + `src/backend/jobs/*` + `reports/` (0 linha em `render.yaml`, `migrations/`, `.env.example`, `package.json`) | — | ℹ️ | `git log da2714e..HEAD --stat -- render.yaml src/backend/migrations src/backend/.env.example src/backend/package.json` → vazio |

> ⚠️ **Não medível localmente**: (a) sucesso real do `preDeployCommand` no Render (só CloudWatch do Render + logs `[boot-migrate]` mostram); (b) latência do primeiro request pós-deploy (cold-start de container Render); (c) MTTR de rollback real (Render permite promote de deploy anterior, mas nada testa esse caminho hoje). Recomendação: instrumentar log estruturado com `sispagLiveWriteEnabled` no primeiro request após boot e monitorar via Render "logs" tab.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Render faz replace instantâneo do container (single-instance no plano `starter`). Não há canary; a mitigação é o kill-switch por frente. | ⚠️ parcial | `render.yaml:10` (`plan: starter`) |
| Rollback | Manual via dashboard Render (promote de deploy anterior). Sem par de rollback SQL para `0050_conciliacao_execucao.sql`. DDL da 0050 é aditiva (CREATE TABLE + índices) — código antigo ignora a tabela nova sem erro. | ⚠️ parcial | `migrations/0050_conciliacao_execucao.sql` (só CREATE), Render dashboard (fora do repo) |
| Script Deployment Commands | Sim — `render.yaml` (Blueprint) + `preDeployCommand: npm run migrate && npm run seed:admin` + `BootMigrator` no boot com advisory lock. | ✅ presente | `render.yaml:19-22`, `BootMigrator.ts` |
| Logical Grouping (por frente) | Sim — três kill-switches independentes: `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`. Cada um pode desligar sua frente sem afetar as demais. | ✅ presente | `EnvironmentVars.ts:105-115`, `RemessaService.ts:130-136` |
| Physical Grouping | N/A — infraestrutura é single-tenant single-service (Render Web Service único + Supabase compartilhada). Não há particionamento físico por cliente. | N/A | `render.yaml` (um único `type: web`) |
| Package Dependencies | Lockfiles commitados; CI usa `npm ci`; `npm audit --level=high` gate na build. `runtime: node` (versão do container Render, não pinada em `.nvmrc`). | ⚠️ parcial | `ci.yml:22`, ausência de `.nvmrc`/`engines` em `package.json` |
| Surge Protection | `express-rate-limit` presente nas deps mas fora de escopo deste review. Boot faz até 30 tentativas × 2s de advisory lock — protege contra thundering-herd de duas instâncias migrando junto. | ✅ presente (no boot) | `BootMigrator.ts:15-16`, `package.json:38` |
| Idempotent deploys | Migrations idempotentes (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`); `seed:admin` é UPSERT; kill-switch é read-per-request; `SispagLiveWrite`/`RemessaExecucao` são idempotency-key based. | ✅ presente | `0050_conciliacao_execucao.sql:11`, `RemessaService.ts:139-141` |
| Drift detection (config vs realidade) | Ausente — nenhum job compara `render.yaml` com o estado real do dashboard Render (`sync:false` intencional deixa dashboard como fonte da verdade, mas ninguém audita divergência). | ❌ ausente | Grep em `.github/workflows/` por "drift" → 0 hits |
| Reproducible builds | `package-lock.json` commitado; CI usa `npm ci` (não `npm install`); Biome + tsc determinísticos. Sem `.nvmrc` (versão Node depende do runtime Render). | ⚠️ parcial | `ci.yml:19-21`, ausência de `.nvmrc` |
| Per-tenant blast-radius limit | N/A — cliente único (Columbia) por deploy. O que existe é kill-switch **por frente**, análogo ao blast-radius por módulo. | N/A (SaaSo mono-tenant no momento) | — |
| Deployment observability | Log estruturado do boot (`[boot-migrate] aplicada(s) X`); painel expõe `execucoesParadas` (obs de dado); mas `/health` não devolve versão/flags e não há endpoint tipo `/config` para o operador conferir kill-switch. | ⚠️ parcial | `BootMigrator.ts:79-82`, ausência de `/config`/`/version` |

## 4. Findings (achados)

### F-deployability-1: `SISPAG_LIVE_WRITE_ENABLED` OFF por default + `sync:false` = gate silencioso pós-deploy

- **Severidade**: P1
- **Tactic violada**: Deployment observability + Logical Grouping (kill-switch existe mas o estado dele é invisível pro operador)
- **Localização**: `render.yaml:30-36`, `src/backend/domain/libs/environment/EnvironmentProvider.ts:221,304`
- **Evidência (objetiva)**:
  ```yaml
  # render.yaml:30-36
  - key: SISPAG_LIVE_WRITE_ENABLED
    sync: false
  ```
  ```ts
  // EnvironmentProvider.ts:221
  sispagLiveWriteEnabled: this.readEnv('SISPAG_LIVE_WRITE_ENABLED') === 'true',
  // Ausente → false (default fail-safe intencional)
  ```
  Depois do deploy do PR de retomada, `sispagLiveWriteEnabled` fica `false` até que alguém acesse o dashboard do Render, crie a variável, defina `true` e redeploye (ou toque um dyno). Não há endpoint `/health`/`/config` que revele o valor efetivo, e o `preDeployCommand` não valida a presença. **O único momento em que o operador descobre que está OFF é ao clicar em "Gerar remessa" e ver a mensagem de dry-run** — ver F-deployability-2.
- **Impacto técnico**: kill-switch cumpre o gate de go-live (default safe), mas a ausência de observação torna o estado da flag "invisível por default". Operador só descobre OFF/ON via teste destrutivo (clicar) — não há read-only para checar.
- **Impacto de negócio**: Columbia clica em "Gerar remessa" achando que fez, olha o CNAB baixado, e assume que o lote está no ERP. Se o dry-run for interpretado como sucesso (o toast diz "NADA foi criado", mas humano cansado lê "gerada"), o pagamento não sai e ninguém percebe até o vencimento passar. Isto foi levantado explicitamente no prompt como cenário.
- **Métrica de baseline**: 1 flag crítica + 0 endpoint de leitura + 0 alerta de "flag ausente no boot" = 3 vias silenciosas de erro pós-deploy.

### F-deployability-2: Copy do dry-run cita a variável errada (`CONEXOS_DRY_RUN` em vez de `SISPAG_LIVE_WRITE_ENABLED`)

- **Severidade**: P1
- **Tactic violada**: Deployment observability (mensagem operacional aponta para var que não é a causa raiz)
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:225-230`, `src/frontend/app/sispag/page.tsx:410`
- **Evidência (objetiva)**:
  ```tsx
  // LoteCard.tsx:225-230
  if (res.status === 'dry-run') {
    return {
      titulo: 'Simulação (dry-run) — NADA foi criado no Conexos',
      descricao:
        'A escrita está desligada (CONEXOS_DRY_RUN). Nenhum lote nem arquivo existe no ERP.',
    }
  }
  ```
  ```ts
  // RemessaService.ts:130-136 — a expressão que produz dryRun:
  const dryRun =
      !writeEnabled ||
      !env.sispagLiveWriteEnabled ||   // <-- causa mais provável logo pós-deploy
      env.conexosDryRun ||
      input.dryRunOverride === true;
  ```
  O motivo dominante logo depois de um deploy é `!sispagLiveWriteEnabled` (default OFF), não `conexosDryRun` (que é `true` só se explicitamente setado). A UI aponta o operador para a variável errada.
- **Impacto técnico**: operador vai ao dashboard, confirma que `CONEXOS_DRY_RUN=false` (ou nem existe), fica sem saber o que fazer. Chama o dev.
- **Impacto de negócio**: MTTR para "por que a remessa não sai?" cresce de "5 min ler doc" para "1 dia até engajar o dev". Se acontece na sexta à tarde, arrasta pro fim de semana.
- **Métrica de baseline**: 3 flags no cálculo do `dryRun`, 1 delas citada no copy — cobertura de causa raiz na mensagem = 33%.

### F-deployability-3: Migration `0050_conciliacao_execucao.sql` sem par de rollback (nem nota `additive-only`)

- **Severidade**: P3
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0050_conciliacao_execucao.sql`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/migrations/ | grep 0050
  0050_conciliacao_execucao.sql
  ```
  Só o forward. Nenhum arquivo `0050_conciliacao_execucao.down.sql` nem convenção documentada em `migrations/`. `BootMigrator` roda pra frente, ponto.
- **Impacto técnico**: se `0050` precisar reverter (improvável — é aditiva, `CREATE TABLE conciliacao_execucao` + índices, código antigo ignora), a operação vira DROP manual no psql. A tabela guarda ledger idempotency para `fin052/processar` — **derrubar em produção implicaria reprocessar retornos duplicando baixas no fin010**. A reversão real é "voltar o deploy e deixar a tabela lá".
- **Impacto de negócio**: baixo hoje (DDL aditiva) — mas o dia que precisar de uma migration destrutiva (DROP COLUMN, ALTER TYPE) sem convenção estabelecida vira improviso.
- **Métrica de baseline**: 50/50 migrations sem par de rollback; 0 convenção `.down.sql` documentada.

### F-deployability-4: Reaper (`job:reaper-sispag`) documentado como cron 15min mas não agendado

- **Severidade**: P2
- **Tactic violada**: Deployment observability + Package Dependencies (script existe, cron não)
- **Localização**: `src/backend/jobs/reaper-sispag-reconciling.ts:22-24` vs `.github/workflows/`
- **Evidência (objetiva)**:
  ```ts
  // reaper-sispag-reconciling.ts:22-24 (JSDoc)
  // CRON (não configurado — entrada documentada):
  //   */15 * * * *  cd /caminho/do/repo/src/backend && npm run job:reaper-sispag
  ```
  ```
  $ ls .github/workflows/
  ci.yml  ingest-extratos.yml  ingest-permutas.yml  ingest-sispag.yml
  # → nenhum workflow "reaper-sispag.yml"
  ```
  Já existem 3 workflows de cron para ingestões (Actions gratuito, decisão explícita — Render Cron Job é pago). Padrão consolidado; o reaper simplesmente não foi criado.
- **Impacto técnico**: quando existir órfão, o painel do SISPAG já expõe (`SispagPainelService.contarExecucoesParadas`, chave `execucoesParadas`) — logo, um operador que abre a tela vê. O reaper adiciona a superfície offline (log estruturado + `BUSINESS_WARN` no `LogService`) que dispararia alerta mesmo se ninguém abrisse a tela por dias. Sem ele, órfão em fim de semana só é visto na segunda.
- **Impacto de negócio**: enquanto Columbia usa o SISPAG todo dia, cobertura via painel é suficiente. Se ficarem 3 dias sem abrir (feriado emendado) e existir órfão, próximo clique gera 409 e ninguém sabe explicar — investigação vira dev novamente.
- **Métrica de baseline**: 3/3 crons operacionais têm workflow; 1/1 reaper documentado tem 0 workflow. Latência entre falha e visibilidade sem operador ativo = ∞ (só quando alguém abrir a tela).

### F-deployability-5: Ausência de `.nvmrc` — versão Node no runtime depende do Render

- **Severidade**: P3
- **Tactic violada**: Reproducible builds
- **Localização**: raiz do repo + `src/backend/package.json`
- **Evidência (objetiva)**:
  ```
  $ ls -la .nvmrc src/backend/.nvmrc src/backend/package.json | grep -v total
  ls: cannot access '.nvmrc': No such file or directory
  ls: cannot access 'src/backend/.nvmrc': No such file or directory
  ```
  `render.yaml` diz apenas `runtime: node` (versão default do Render). CI usa `node-version: '24'` explícito, mas nada garante que o container Render use 24. Ingestões cron usam `node-version: 22`. Divergência já existe.
- **Impacto técnico**: build passa no CI (Node 24), roda no Render (Node ?). Bug de runtime específico de versão vira "só reproduz em produção".
- **Impacto de negócio**: baixo hoje (Node 20+ estável nesta stack), moderado quando aparecer regressão de versão.
- **Métrica de baseline**: 3 versões diferentes de Node em jogo (CI backend=24, CI cron=22, Render=default) e nenhuma pinada por `.nvmrc`/`engines`.

### F-deployability-6: `job:reaper-sispag` no mesmo `scripts:` de `job:ingest-*` — nome sugere operacional mas semântica muda por hora

- **Severidade**: P3
- **Tactic violada**: Logical Grouping (agrupamento por natureza do risco)
- **Localização**: `src/backend/package.json:14-26`
- **Evidência (objetiva)**:
  ```json
  // package.json (recortado)
  "job:ingest-permutas": "tsx jobs/ingest-permutas.ts",
  "job:ingest-pagamentos": "tsx jobs/ingest-pagamentos.ts",
  "job:formar-lotes": "tsx jobs/formar-lotes.ts",
  "job:ingest-extratos": "tsx jobs/ingest-extratos.ts",
  "job:reaper-sispag": "tsx jobs/reaper-sispag-reconciling.ts",
  "job:capture-fixtures": "tsx jobs/capture-fixtures-sispag.ts"
  ```
  Todos com prefixo `job:` — o reaper é observação (`warn`, exit 0 sempre) e o `capture-fixtures` é ferramenta de dev. Sem separação por prefixo (`job:` vs `ops:` vs `dev:`), operador em correria pode rodar o errado. Mitigante forte: **os jobs realmente perigosos** (`execute-fin015-prd`, `preflight-fin015-prd`, `cleanup-fin015-testes`, `seed-hml-vencimento`, `validate-retomada-remessa-v1`) **NÃO estão em `scripts:`** e cada um tem guarda dura por URL (`if (!BASE.includes('-hml')) process.exit(1)`).
- **Impacto técnico**: mínimo — o único cenário de dano é rodar `job:capture-fixtures` contra PRD por engano, e a operação é read-only.
- **Impacto de negócio**: nenhum imediato. Sujeira que cresce à medida que o `jobs/` engorda (já são 40 arquivos).
- **Métrica de baseline**: 6 entradas em `scripts:` com prefixo `job:`, sem taxonomia interna; 34 outros scripts em `jobs/*.ts` invocáveis via `npx tsx` (sem `npm run`).

## 5. Cards Kanban

### [deployability-1] Publicar `sispagLiveWriteEnabled` (e as demais flags de kill-switch) via `/health` — e alertar quando ausente

- **Problema**
  > `SISPAG_LIVE_WRITE_ENABLED` fica `false` por default depois do deploy e o operador só descobre ao clicar em "Gerar remessa" e ver dry-run. Não há endpoint que responda "essa flag está OFF" em leitura, e a Columbia pode interpretar o dry-run como sucesso — o pagamento não sai, ninguém percebe.

- **Melhoria Proposta**
  > Expandir o handler de `/health` para devolver JSON com `{ version, flags: { sispagLiveWriteEnabled, conexosWriteEnabled, conexosDryRun, recebimentosEnabled, sispagEnabled } }`. No boot do `BootMigrator` (ou logo depois, em `bootstrapAppContainer`), logar um `INFO` estruturado com as mesmas flags — o log do Render vira o registro de "o que subiu com o quê". Opcional: se `sispagEnabled=true` e `sispagLiveWriteEnabled` estiver `undefined` no `process.env` (não apenas `false`), logar `WARN` "flag SISPAG não declarada — usando default fail-safe".

- **Resultado Esperado**
  > Post-deploy, `curl https://financeiro-backend/health` mostra o estado real dos kill-switches. Operador confere sem clicar. Log do boot registra as flags — auditoria de "quando ligamos escrita" fica em CloudWatch/Render em vez de "quem se lembra".

- **Tactic alvo**: Deployment observability
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1, F-deployability-2
- **Métricas de sucesso**:
  - Endpoints de observabilidade: 1 (`/health`) → 1 (`/health` com flags) ou 2 (`/health` + `/config`)
  - Tempo até descobrir "flag OFF" sem clicar: só via ação destrutiva → `< 30s` via curl
  - Cobertura de causa raiz na msg do dry-run (flags citadas / flags responsáveis): 1/3 → 3/3
- **Risco de não fazer**: primeiro incidente de "por que a remessa não gerou?" na Columbia vai tomar >1 dia de engenharia e queimar confiança no rollout.
- **Dependências**: nenhuma.

### [deployability-2] Corrigir copy do dry-run para citar a var responsável

- **Problema**
  > `LoteCard.tsx` diz "A escrita está desligada (CONEXOS_DRY_RUN)" em todo caso de dry-run, mas 3 flags produzem esse estado — `!conexosWriteEnabled`, `!sispagLiveWriteEnabled`, `conexosDryRun`. Depois do deploy da retomada, a causa mais provável é `!sispagLiveWriteEnabled`, e a mensagem manda o operador olhar a var errada.

- **Melhoria Proposta**
  > Backend retorna, junto com `status: 'dry-run'`, o motivo estruturado: `{ dryRunReason: 'sispag-kill-switch' | 'conexos-write-disabled' | 'global-dry-run' | 'override' }` (calculado em `RemessaService.gerarRemessa` a partir das mesmas checagens do `dryRun`). Frontend mostra o motivo específico: "A escrita SISPAG está desligada (`SISPAG_LIVE_WRITE_ENABLED=false` no dashboard do Render)". Mesmo tratamento em `ConciliacaoRetornoService`.

- **Resultado Esperado**
  > Copy diz **qual** variável mudar. Alinhado com o padrão do ADR-0058 ("a tela passa a dizer QUAL parâmetro do ERP quebrou").

- **Tactic alvo**: Deployment observability
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Vars citadas corretamente no copy: 1 (só CONEXOS_DRY_RUN) → 3 (cada motivo com sua var)
  - MTTR estimado "por que dry-run?": >30 min → <5 min (leitura direta do toast)
- **Risco de não fazer**: repete o padrão que o ADR-0058 acabou de consertar em outra frente (fluxo financeiro). Dívida de consistência de mensageria.
- **Dependências**: nenhuma.

### [deployability-3] Agendar `job:reaper-sispag` como GitHub Actions cron */15

- **Problema**
  > O reaper existe (`jobs/reaper-sispag-reconciling.ts`), está registrado em `scripts:`, tem semântica bem definida (só log, não age), e o comentário do arquivo diz "cron 15 min" — mas nunca foi criado o workflow. Enquanto a Columbia usa o painel todo dia isso é OK, mas em feriado emendado um órfão fica invisível até segunda.

- **Melhoria Proposta**
  > Criar `.github/workflows/reaper-sispag.yml` seguindo o padrão de `ingest-sispag.yml`: `schedule: '*/15 * * * *'`, `concurrency: reaper-sispag`, `timeout-minutes: 5`, secrets iguais aos outros crons, step único `npm run job:reaper-sispag`. Configurar alerta no Render/GitHub para exit != 0.

- **Resultado Esperado**
  > Órfão em `reconciling` >15min gera `BUSINESS_WARN` em log estruturado sem depender de ninguém abrir a tela.

- **Tactic alvo**: Deployment observability + Manage Deployed System
- **Severidade**: P2
- **Esforço estimado**: S (≤2h — cópia direta do template `ingest-sispag.yml`)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Workflows de cron: 3 → 4
  - Latência entre criação de órfão e primeira observação (sem operador ativo): ∞ → ≤15 min
- **Risco de não fazer**: fim de semana longo + interrupção real = lote órfão no fin015 visto só no próximo dia útil. Padrão já é reproduzido por incidente passado (histórico da 0049).
- **Dependências**: nenhuma.

### [deployability-4] Documentar convenção de rollback para migrations (mesmo que "additive-only")

- **Problema**
  > 50 migrations sem par de rollback. `0050_conciliacao_execucao.sql` é aditiva e segura, mas não há convenção escrita de "toda migration destrutiva precisa de `.down.sql` + procedimento". Primeira migration com `DROP` vai improvisar sob pressão.

- **Melhoria Proposta**
  > Adicionar seção em `docs/runbooks/` (ou no header de `migrations/README.md`) declarando: (a) migrations aditivas são a regra (todo `CREATE ... IF NOT EXISTS`); (b) migrations destrutivas exigem revisão explícita e um `.down.sql` no mesmo commit + entrada de ADR; (c) rollback real de deploy no Render **não desfaz DDL** — a estratégia é sempre "roll forward". O `BootMigrator` já é fail-fast; documentar isso como decisão consciente.

- **Resultado Esperado**
  > Nenhum código muda; a próxima migration destrutiva encontra template e regra em vez de improviso. Alinhado com o padrão de `docs/runbooks/fin010-write-cutover.md` (runbook por decisão de risco).

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Runbooks de deploy: 2 (`fin010-write-cutover`, `rotacao-segredos`) → 3
  - Convenção `.down.sql` documentada: não → sim
- **Risco de não fazer**: a próxima migration com `ALTER TYPE` / `DROP COLUMN` vira decisão ad hoc às 22h.
- **Dependências**: nenhuma.

### [deployability-5] Pinar versão do Node em `.nvmrc` + `engines` do `package.json`

- **Problema**
  > 3 versões de Node convivem: CI backend usa 24 (`.github/workflows/ci.yml`), CI cron usa 22 (`ingest-*.yml`), Render usa a default do runtime (não declarada). O build passa no CI e o runtime é o que o Render escolher.

- **Melhoria Proposta**
  > Adicionar `.nvmrc` na raiz do repo com a versão-alvo (ex. `22`), replicar em `src/backend/.nvmrc` e `src/frontend/.nvmrc`, e declarar `"engines": { "node": ">=22 <25" }` em ambos os `package.json`. Alinhar `node-version` em todos os workflows do `.github/`. `render.yaml` respeita `.nvmrc` (feature Render Node runtime).

- **Resultado Esperado**
  > Uma única versão de Node em CI + cron + Render.

- **Tactic alvo**: Reproducible builds
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Versões de Node em jogo: 3 → 1
  - Arquivos declarando a versão: 0 (`.nvmrc`) → 3 (raiz + backend + frontend)
- **Risco de não fazer**: baixa probabilidade × alta dor (regressão só reproduz em prd).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estreito respeitado: o delta desta feature (retomada) NÃO tocou `render.yaml`, `migrations/`, `.env.example` ou `package.json` — reaproveitei a infra do PR anterior (2026-08-24 SISPAG remessa/retorno) e avaliei o pós-deploy à luz dela. Os cards `deployability-1` e `deployability-2` são cross-cutting: aplicam-se a `SN_LIVE_WRITE_ENABLED` e outros kill-switches do mesmo padrão.
- Cross-QA: `deployability-1` e `deployability-2` conversam com **fault-tolerance** (a mensagem do kill-switch é a superfície de contenção do operador) e com **usability**/frontend (copy). O `deployability-3` (reaper) conversa com **availability** (visibilidade de órfãos). O `deployability-5` (Node pin) conversa com **modifiability**. Sinalizar ao consolidator.
- Não medi build duration (`npm run build`) porque o escopo é o pós-deploy, não o custo de CI; o CI já roda `--coverage` e passa em <5min segundo o padrão observado dos workflows atuais.
- Guard-rail do `BootMigrator` NÃO bloqueia deploy legítimo — em produção `environment=production`, o guarda sai no primeiro `if`. Perguntado no prompt, respondido em §2 (linha "Guard-rail...").
