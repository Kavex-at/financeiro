---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-deployability
generated_at: 2026-09-03T19:15:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

> **Escopo restrito ao delta** do tweak `fix/tapar-furos-backend`. O delta toca deployability por
> dois flancos: BE-06 (shutdown gracioso — a peça da Rolling Upgrade que faltava) e BE-09 (gate de
> lint que passava verde sem `node_modules`). BE-05 aparece de raspão (encerra o pool no shutdown),
> mas tem lar principal em availability. Contexto de repo entra só para julgar se o delta cobre a
> superfície necessária; achados sobre `render.yaml` fora do delta ficam em Notas.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Render (orquestrador de deploy) | `git push origin main` bem-sucedido → build ok → SIGTERM no processo antigo, novo assume | `financeiro-backend` (Express single-instance, plan starter) + gate CI | Produção com tráfego de analistas + jobs cron rodando (reaper a cada 15min, ingestão horária) | Novo container sobe migrado, o antigo drena requisições em voo dentro da janela do SIGKILL do Render (~30s), pool devolve conexões ao pooler do Supabase, `/health` continua respondendo até o `server.close` completar | 0 execuções órfãs em `reconciling` decorrentes do deploy; 0 sessões penduradas no Supabase até timeout; gate CI (`npm run lint`) reprova commit que introduza erro de estilo, mesmo em worktree recém-criado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Teto de drenagem SIGTERM→exit voluntário | 10.000 ms | ≤ 25.000 ms (deixa ≥ 5s de folga sob os 30s do SIGKILL default do Render) | ✅ | `src/backend/http/gracefulShutdown.ts:26` (`DEFAULT_DRAIN_TIMEOUT_MS`) |
| Sinais tratados | `SIGTERM`, `SIGINT` | `SIGTERM` obrigatório (Render); `SIGINT` bônus (Ctrl-C local) | ✅ | `src/backend/http/gracefulShutdown.ts:22` |
| Idempotência do handler de shutdown | garantida por flag `shuttingDown` | required (orquestrador repete sinal; operador manda 2× Ctrl-C) | ✅ | `src/backend/http/gracefulShutdown.ts:60-64` |
| Cobertura de teste de `gracefulShutdown.ts` | 93,61% stmts / 100% lines / 58,82% branches | ≥ 85% stmts (regra do delta) | ✅ | `_shared-metrics.md` §Gates |
| Encerramento do pool no shutdown | `container.resolve(PostgreeDatabaseClient).close()` chamado dentro do `drain()` | required (senão sessões vazam até timeout do pooler) | ✅ | `src/backend/index.ts:168-172`, `src/backend/domain/client/database/PostgreeDatabaseClient.ts:99-114` |
| Alinhamento `healthCheckPath` com rota real | `render.yaml` aponta para `/health`; `index.ts:78` monta `app.get('/health', …)` público | required (rota deve ser pública e barata) | ✅ | `render.yaml:23`, `src/backend/index.ts:78-83` |
| Silenciamento do `/health` durante drain | não implementado — `/health` segue 200 mesmo após `server.close` disparado | opcional em single-instance (Render não faz canary; não há outra réplica p/ desviar tráfego) | ⚠️ | `src/backend/http/gracefulShutdown.ts:96-108` |
| Presença de `npm ci` antes de `npm run lint` no CI | presente (`ci.yml:16-20`) | required (BE-09 pressupõe binário instalado) | ✅ | `.github/workflows/ci.yml` |
| Scripts `src/backend/package.json` que ainda usam `npx` | 0 | 0 (a correção do BE-09 é global) | ✅ | `grep '"npx ' src/backend/package.json` → 0 matches |
| Scripts `src/frontend/package.json` que usam `npx` | 0 | 0 | ✅ | `grep '"npx ' src/frontend/package.json` → 0 matches |
| Gates automatizados commit-to-prod (Backend) | 5: `npm ci`, `npm audit`, `typecheck`, `lint`, `test --coverage`, `build` (6, na verdade) | ≥ 5 | ✅ | `.github/workflows/ci.yml:14-22` |
| Bloqueio de merge por CI vermelho | branch protection no GitHub gatekeeping `Backend`/`Frontend` (declarado no `render.yaml:14-16`) | required | ✅ | `render.yaml` comentário + prática documentada |
| Reprodutibilidade do build backend | `package-lock.json` versionado; `npm ci` no CI; `tsc && tsc-esm-fix dist` (sem timestamps) | required | ✅ | `src/backend/package.json:11`, `.github/workflows/ci.yml:19` |
| `preDeployCommand` executado pelo Render | ⚠️ **Não medível localmente**: por comentário em `src/backend/index.ts:129` ("`preDeployCommand` do `render.yaml` nunca rodou; serviço configurado pelo dashboard; pre-deploy é de plano pago") a coluna do YAML e a coluna do dashboard divergem. Mitigado por `BootMigrator` no `start()`. | plano pago do Render ou `BootMigrator` obrigatório | ⚠️ (fora do delta) | `src/backend/index.ts:120-133` |
| Rollback automatizado | não medível localmente — Render oferece rollback manual pelo dashboard; nenhum script no repo, nenhum runbook em `docs/runbooks/` documenta o passo-a-passo. | 1 comando + runbook | ⚠️ (fora do delta) | `ls docs/runbooks/` |
| Módulos Terraform / drift detection | ⚠️ **Não medível**: não existe `infra/` neste repo (deploy via Render hook, ver CLAUDE.md §"Estado Atual vs. Alvo"). | N/A | — | `_shared-metrics.md` |
| Tenants provisionados | ⚠️ **Não medível**: mesma razão. | N/A | — | `_shared-metrics.md` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts / Rolling Upgrade** | Render (starter) roda uma única réplica; substituição é blue-green implícito (novo container sobe, `/health` verde, tráfego cutover, antigo drena via SIGTERM). O delta fecha o lado do drain com `registerGracefulShutdown` + teto de 10s. | ✅ presente (para o modelo single-instance do Render) | `src/backend/http/gracefulShutdown.ts`, `src/backend/index.ts:161-173` |
| **Manage Service Interactions (drain in-flight)** | Handler dedicado: `server.close` → aguarda `drain()` → `closePool()` → `onExit(0)`. Idempotente. Force-exit armado em paralelo para não virar zumbi. | ✅ presente | `src/backend/http/gracefulShutdown.ts:66-108` |
| **Rollback** | Render suporta rollback manual pelo dashboard; não há script no repo nem runbook. Não é degradação do delta — é gap pré-existente. | ⚠️ parcial (fora do delta) | ausência em `docs/runbooks/` |
| **Script Deployment Commands** | `render.yaml` na raiz declara `buildCommand`, `preDeployCommand`, `startCommand`, `healthCheckPath`, envVars. Blueprint versionado. | ✅ presente | `render.yaml` |
| **Manage Deployment Pipeline (CI gate)** | `.github/workflows/ci.yml` roda `npm ci` → `npm audit --audit-level=high` → `typecheck` → `lint` → `test --coverage` → `build`. Branch protection exige checks para merge. Delta consertou o gate de lint (BE-09), que passava silenciosamente verde em worktree sem `node_modules`. | ✅ presente e reforçado pelo delta | `.github/workflows/ci.yml:14-22` |
| **Package Dependencies (reproducible build)** | `package-lock.json` versionado em `src/backend/` e `src/frontend/`; CI usa `npm ci`; `type: module` + `tsc-esm-fix` fixa emit. | ✅ presente | `src/backend/package.json:11`, `.github/workflows/ci.yml:19` |
| **Logical Grouping** | `render.yaml` isola backend em serviço próprio; frontend em Vercel; DB em Supabase. Cada camada roda em seu próprio ciclo. | ✅ presente | `render.yaml`, `DEPLOY.md` |
| **Physical Grouping** | Single-instance Render Starter — sem replicação horizontal deliberada. Consequência do plano e do tráfego atual. | ⚠️ parcial | `render.yaml:8` (`plan: starter`) |
| **Surge Protection** | `globalLimiter` + `heavyRouteLimiter` no Express (`src/backend/http/rateLimit.ts` montado em `index.ts:44,101`) — não é tactic de deploy, mas participa da sobrevivência ao cutover. | ✅ presente | `src/backend/index.ts:44,101` |
| **Health Check** | Rota pública `/health` mínima em `index.ts:78` + `/health/pipelines` (503 quando há pipeline parado). `render.yaml:healthCheckPath: /health`. | ✅ presente | `render.yaml:23`, `src/backend/routes/health.ts` |
| **Idempotent deploys** | Deploy declarativo (`render.yaml`) + `BootMigrator` idempotente + tag release condicional (`if git rev-parse "$TAG" >/dev/null 2>&1; then exit 0`). Handler de shutdown também idempotente. | ✅ presente | `.github/workflows/ci.yml:63-72`, `src/backend/http/gracefulShutdown.ts:60-64` |
| **Feature toggle para canary** | Kill-switches por frente (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`) permitem ativar/desativar sem redeploy — usar o próprio Render dashboard como fonte da verdade. Substituto pragmático do canary quando não há segundo pod. | ✅ presente | `render.yaml:29-64`, `DEPLOY.md` |
| **Drift Detection (IaC)** | N/A — não há Terraform/CloudFormation neste repo. O `render.yaml` tem sobreposição documentada com o dashboard (`sync: false` em vários secrets), então não há como o repo declarar "está tudo como deveria estar". | N/A | ver CLAUDE.md §"Estado Atual vs. Alvo" |
| **Active Redundancy** | N/A — plano starter é single-instance por definição; não há warm standby a redundar. | N/A | `render.yaml:8` |
| **Deployment Observability** | Log `[shutdown] SIGTERM recebido …` / `[shutdown] pool de conexões encerrado` / `[shutdown] drenagem excedeu …ms` em stderr do container; `/health/pipelines` externo detecta pipeline órfã. Não há métrica agregada de "tempo médio de drain" — só linha por deploy no log do Render. | ⚠️ parcial | `src/backend/http/gracefulShutdown.ts:56,72,86,89` |

## 4. Findings (achados)

### F-deployability-1: `/health` continua respondendo 200 durante a janela de drain

- **Severidade**: P3
- **Tactic violada**: Manage Service Interactions (Health Check em cutover)
- **Localização**: `src/backend/http/gracefulShutdown.ts:66-108`, `src/backend/index.ts:78-83`
- **Evidência (objetiva)**:
  ```
  Após o SIGTERM: server.close pára de aceitar CONEXÕES novas, mas a rota /health
  já está registrada e responde 200 até o event loop terminar. Nada no handler
  sinaliza "estou drenando" para o probe.
  ```
- **Impacto técnico**: em ambiente single-instance no Render (plano atual), o próprio orquestrador cuida do cutover assim que o novo container fica verde — a rota respondendo 200 durante o drain é inofensiva. **Se um dia** houver segunda réplica (upgrade de plano) ou LB externo consultando `/health`, o load balancer não saberia parar de mandar tráfego para o pod que está morrendo. Cenário hipotético hoje; deixa de ser hipotético no dia do upgrade.
- **Impacto de negócio**: nenhum na topologia atual; latente para escala futura.
- **Métrica de baseline**: 0 mudanças de status no handler de `/health` durante shutdown (linha 78 responde `{status:'ok'}` incondicionalmente).

### F-deployability-2: rollback é manual no dashboard sem runbook versionado

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `docs/runbooks/` — nenhum arquivo `rollback*.md` ou equivalente
- **Evidência (objetiva)**:
  ```
  $ ls docs/runbooks/ | grep -i rollback
  (vazio)
  ```
  `render.yaml` declara `autoDeploy: true` e `DEPLOY.md` não descreve o passo de rollback.
- **Impacto técnico**: quando um deploy passa o CI mas gera regressão em produção (o cenário típico — CI verde, sintoma só aparece contra Conexos/Supabase reais), o operador precisa lembrar de cabeça: dashboard Render → serviço → deploys → "rollback to this deploy". Sob pressão às 2h da manhã, é onde se cometem erros.
- **Impacto de negócio**: MTTR maior no incidente pós-deploy; nada acionável em auditoria sobre "como reverter".
- **Métrica de baseline**: 0 runbooks de rollback; 0 comandos de rollback em scripts do repo; 1 canal informal (memória do operador).

> **Fora do escopo estrito do delta.** Registrado porque o delta é sobre "tapar furos" e este é um furo adjacente que o próprio cenário (deploy no Render) exige. Card fica em severidade P2 por ser pré-existente e por Render fornecer o mecanismo — falta a memória escrita.

### F-deployability-3: divergência declarada entre `render.yaml` e dashboard (pre-deploy órfão)

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (consistência declarativa)
- **Localização**: `render.yaml:24` vs. `src/backend/index.ts:120-133`
- **Evidência (objetiva)**:
  ```
  render.yaml:
      preDeployCommand: npm run migrate && npm run seed:admin

  src/backend/index.ts (docstring de `start`):
      "o `preDeployCommand` do `render.yaml` nunca rodou (serviço configurado
       pelo dashboard; pre-deploy é de plano pago), e em 2026-08-10 o código
       da ADR-0032 chegou a produção antes da `0044` — chave natural nova
       contra banco velho. Aqui o `listen` é inalcançável enquanto houver
       migração pendente."
  ```
- **Impacto técnico**: quem lê só o blueprint acredita que existe um degrau `migrate + seed` antes do listen, gerido pelo Render. Na prática, o degrau é feito pelo `BootMigrator` no `start()`. Isso funciona (a mitigação está lá), mas duas fontes discordando é dívida de deployability — o próximo dev que "otimizar" o boot pode remover o `BootMigrator` acreditando que o Render cobre.
- **Impacto de negócio**: risco de regressão futura no que a ADR-0044 já corrigiu (código novo contra banco antigo).
- **Métrica de baseline**: 2 fontes divergentes para "quando as migrations rodam" (blueprint diz "pre-deploy"; código diz "boot do start"). O `preDeployCommand` está no YAML há ≥ 1 commit sem executar.

> **Fora do escopo estrito do delta.** Não é regressão do tweak — o próprio `index.ts` já documenta o gap. Fica registrado para o consolidator porque o card do BE-06 (shutdown) é vizinho de porta.

## 5. Cards Kanban

### [deployability-1] Marcar `/health` como `503` durante a janela de drain

- **Problema**
  > Após o SIGTERM, `server.close` pára de aceitar conexões novas, mas `/health` (rota mais alta no `index.ts`) continua respondendo 200 até o event loop terminar. Na topologia atual do Render (single-instance, plano starter), isso é inofensivo porque o orquestrador só faz cutover quando o novo container está verde; a rota respondendo 200 no antigo é ignorada. Vira problema **no dia** em que houver segunda réplica ou LB externo probando `/health` — o probe não saberia que este pod está morrendo.
- **Melhoria Proposta**
  > Expor uma flag `isShuttingDown()` do módulo `gracefulShutdown.ts` e consultá-la no handler de `/health` (`index.ts:82`); devolver `503 {status:'draining'}` quando ligada. Custo: 1 export, 1 `if` no handler, 2 testes (um pré-drain, um pós-drain). Mantém a rota barata (sem I/O) e alinhada à tactic Health Check da Bass.
- **Resultado Esperado**
  > Probe de LB consegue tirar o pod do pool em drain ANTES do `SIGKILL`, sem tráfego novo bater em um servidor que já não aceita conexões. Métrica: 0 → 100% dos deploys onde `/health` sinaliza `503` durante os 10s de drain.
- **Tactic alvo**: Health Check + Manage Service Interactions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - status HTTP de `/health` durante drain: `200` → `503`
  - cobertura do novo caminho: 0 → ≥ 1 teste unitário
- **Risco de não fazer**: nulo na topologia atual; latente para o dia do upgrade de plano. Se ninguém lembrar, o primeiro deploy multi-réplica manda tráfego para o pod moribundo.
- **Dependências**: nenhuma.

### [deployability-2] Escrever runbook de rollback em `docs/runbooks/rollback.md`

- **Problema**
  > `render.yaml` declara `autoDeploy: true` — cada push em `main` sobe. Quando um deploy passa CI mas quebra em produção (cenário típico — Conexos/Supabase só aparecem em prod), o operador precisa reverter pelo dashboard do Render sem passo-a-passo escrito. Sob pressão, é onde se erra.
- **Melhoria Proposta**
  > Criar `docs/runbooks/rollback.md` documentando: (1) como localizar o deploy anterior no dashboard, (2) o botão exato de "Rollback to this deploy", (3) o que fazer com migrations irreversíveis (a Frente IV vem escrevendo em tabelas novas — reverter código sem reverter schema é seguro; o contrário não é), (4) como validar o rollback via `/health` e `/health/pipelines`, (5) quando escalar. Referência cruzada em `DEPLOY.md`.
- **Resultado Esperado**
  > Operador consegue reverter deploy quebrado em ≤ 5 min sem consultar terceiros. MTTR de incidente pós-deploy cai.
- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - runbooks de rollback: 0 → 1
  - referências cruzadas em `DEPLOY.md`: 0 → 1
- **Risco de não fazer**: no próximo deploy que quebrar em prod (só é questão de tempo), o operador improvisa. Improvisação em migração de schema é como se descobre corrupção de dados.
- **Dependências**: nenhuma.

### [deployability-3] Resolver a divergência `render.yaml` × dashboard (pre-deploy órfão)

- **Problema**
  > `render.yaml:24` declara `preDeployCommand: npm run migrate && npm run seed:admin`, mas conforme docstring em `src/backend/index.ts:120-133`, o pre-deploy nunca roda (serviço criado pelo dashboard; pre-deploy é feature de plano pago). A mitigação é o `BootMigrator` no `start()`. Duas fontes discordantes = próximo dev que "limpar" o boot pode remover o `BootMigrator` acreditando que o Render cobre.
- **Melhoria Proposta**
  > Duas opções: (a) upgrade do plano do Render para habilitar `preDeployCommand` e remover `BootMigrator` do `start()`, virando arquitetura declarativa; (b) remover a linha do `render.yaml` e adicionar comentário explícito de que migrations rodam no boot via `BootMigrator`, apontando para a docstring. A opção (b) é sem custo e alinha as duas fontes; a (a) é a solução "certa" quando o volume justificar.
- **Resultado Esperado**
  > Uma única fonte da verdade sobre "quando as migrations rodam". Blueprint e código concordam.
- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para (b); M (2–5d) para (a) — inclui teste de que o `preDeployCommand` executa e fecha o deploy quando falha.
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - fontes divergentes sobre migração: 2 → 1
  - comentário em `render.yaml` apontando para `BootMigrator`: ausente → presente (se opção b)
- **Risco de não fazer**: dívida documental. Fica em P2 porque não é regressão ativa — a mitigação (BootMigrator) já está no lugar e coberta por `_shared-metrics.md` (typecheck/lint/test verdes). É o tipo de dívida que morde 6 meses depois quando alguém "otimiza".
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo:** delta cumpre o que se propôs. O BE-06 fecha o buraco de Rolling Upgrade que era a fonte documentada das execuções órfãs em `reconciling` (linha direta com Fault-tolerance e Availability — o `reaper-sispag` deixa de ser o único remendo). O BE-09 fecha o buraco do gate de lint (não é achado de deployability isolado — é meta-achado: o gate de qualidade de código estava desabilitado silenciosamente em todo worktree, e worktree é inviolável no pipe). Verifiquei os dois `package.json` e o `render.yaml`: **nenhum outro script resolve binário por `npx`**, e o CI faz `npm ci` antes do `lint`, então a correção é definitiva.
- **10s de drain vs. 30s do SIGKILL do Render:** folga de 20s. Coerente com a janela e com o volume de requests típico do painel (~unidades/min, não milhares). Não é tight; não é frouxo.
- **Cross-QA:** F-availability e F-fault-tolerance devem receber o BE-05 (encerramento do pool no `error handler`); esta seção só o menciona porque ele é chamado pelo shutdown (`closePool` → `PostgreeDatabaseClient.close`). O consolidator deve evitar duplicar cards entre availability, fault-tolerance e este QA.
- **N/A explícitos:** Terraform, drift detection, Active Redundancy — todos N/A por ausência de `infra/` e plano single-instance. Sinalizado como "não medível", não como finding.
