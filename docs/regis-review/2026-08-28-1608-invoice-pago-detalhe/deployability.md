---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-deployability
generated_at: 2026-08-28T16:08:00-03:00
scope: infra
score: 4
findings_count: 7
cards_count: 7
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev merga PR em `main` com mudança em `render.yaml` que adiciona um novo `type: cron` para `ingest-permutas` | Push em `main` dispara auto-deploy do Render blueprint (web + cron em paralelo) e o próximo tick 09:00 UTC (06:00 BRT) do cron do GitHub Actions `ingest-permutas.yml` já existente | `financeiro-backend` (web) + `financeiro-ingest-permutas` (cron Render) + `.github/workflows/ingest-permutas.yml` (cron GH) — todos apontando para a mesma tabela `permuta_invoice` do Supabase | Produção; Frente I liberada; único tenant `local`; sem HML | Sistema promove somente código que passou CI; job de ingestão roda **uma** vez por janela; drift de env entre serviços é impossível; rollback do cron sem redeploy é 1-comando | 0 execuções duplicadas do `ingest-permutas` na mesma janela; 100% das chaves compartilhadas entre `web` e `cron` provêm de fonte única; MTTR de kill-switch do cron ≤ 60s sem redeploy |

O delta atual **falha** em três dos quatro measures: o job passa a rodar duas vezes às 06:00 BRT (GH Actions + Render cron), 10 chaves de env são declaradas em dois lugares distintos e não há kill-switch runtime — pausar o cron exige clique no dashboard do Render (single-source: dashboard, não versionado) ou remoção do YAML seguida de redeploy.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Crons distintos para `ingest-permutas` na mesma janela 06:00 BRT | 2 (GH Actions `0 9,15,21 * * *` + Render `0 9 * * *`) | 1 | ❌ | `.github/workflows/ingest-permutas.yml:12` + `render.yaml:106` |
| Chaves de env duplicadas entre `web` e `cron` (drift-risk) | 10 (3 literais + 7 `sync:false`) | 0 (via `envVarGroups`) | ❌ | `render.yaml:23-79` vs `render.yaml:110-133` |
| Chaves do `web` **não** replicadas no `cron` (verificar necessidade) | 8 (`DEV_AUTH_BYPASS`, `SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`, `AUTH_JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ALLOWED_ORIGINS`) — todas HTTP/auth-scoped, **corretamente omitidas** do job | — | ✅ | Diff manual dos dois blocos `envVars` |
| `preDeployCommand` no `cron` (garante schema atualizado antes do próximo tick) | ausente | `npm run migrate` (idempotente) | ❌ | `render.yaml:104-134` — só o `web` tem `preDeployCommand` |
| Migrations aplicadas antes do `ingest-permutas` na cadeia GH Actions | sim (`npm run migrate` na linha 46 do workflow) | sim | ✅ | `.github/workflows/ingest-permutas.yml:46` |
| Kill-switch runtime do cron (equivalente a `SISPAG_LIVE_WRITE_ENABLED`) | ausente — não há `PERMUTAS_INGEST_ENABLED` ou similar no código | presente + no dashboard | ❌ | `grep -rn "PERMUTAS_INGEST\|INGEST_ENABLED" src/backend/` → 0 hits |
| Aritmética `0 9 * * *` UTC → BRT | 06:00 America/Sao_Paulo (Brasil sem DST desde 2019 — Decreto 9.772/2019) | 06:00 BRT ano inteiro | ✅ | Cálculo manual + `render.yaml:87` |
| Custo de build por deploy (blueprint agora tem 2 serviços com `buildCommand: npm ci && npm run build`) | 2 builds paralelos por push em `main` (antes: 1) | 1 build por push (compartilhar artefato ou pular quando `src/backend/**` inalterado) | ⚠️ | `render.yaml:18` e `render.yaml:102` |
| Probes de produção em `dist/` (`probe-invoice-pago.ts`, `validate-invoice-pago-detalhe-v1.ts`) | 2 novos ficheiros × 365 linhas = 100% incluídos em `dist/` (tsconfig `include: ["**/*.ts"]`, sem `exclude` de `jobs/probe-*`) | excluídos do bundle de runtime OU gate no `startCommand` | ⚠️ | `src/backend/tsconfig.json:24-25` |
| Probes já no repo antes deste delta (`jobs/probe-*.ts` + `jobs/validate-*.ts`) | 32 arquivos | pasta separada + `tsconfig.exclude` | ⚠️ | `find src/backend/jobs -name "probe-*.ts" -o -name "validate-*.ts" \| wc -l` |
| Gate de acesso das probes em PRD | `if (!IS_HML && process.env.PROBE_ALLOW_PRD !== '1')` — recusa e `exit 1` | idem, aceitável | ✅ | `src/backend/jobs/probe-invoice-pago.ts:60-65` e `validate-invoice-pago-detalhe-v1.ts:29-32` |
| Terraform / módulos / tenants provisionados | ⚠️ Não medível — `infra/` não existe neste repo | — | — | `_shared-metrics.md` |
| Bundle Lambda (p50/p95) | ⚠️ Não medível — não há Lambdas; runtime é Express em container Render | — | — | Contexto (CLAUDE.md — "estado atual" é Express) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Render faz rolling do `web` com `healthCheckPath: /health`; **cron não tem healthcheck** (Render não oferece para `type: cron`) — a primeira execução após deploy é o próprio "canary" e falha em produção sem gate | ⚠️ parcial | `render.yaml:22` (web) vs. ausência em `render.yaml:100-134` (cron) |
| Rollback | Redeploy manual da SHA anterior via dashboard do Render (não há automação). Nenhum kill-switch runtime para o `ingest-permutas` — para pará-lo, ou se remove do YAML (redeploy) ou se clica em "Pause" no dashboard (não versionado) | ⚠️ parcial | `render.yaml` + ausência de `PERMUTAS_INGEST_ENABLED` |
| Script Deployment Commands | `render.yaml` + `.github/workflows/ci.yml` (gates); `preDeployCommand: npm run migrate && npm run seed:admin` no web | ✅ presente (web); ❌ ausente (cron) | `render.yaml:21` vs. `render.yaml:100-134` |
| Logical Grouping | `services:` blueprint agrupa web+cron por nome; **envVars agrupados por serviço apenas — não há `envVarGroups`** que compartilhe `CONEXOS_*` entre os dois | ❌ ausente | `render.yaml` inteiro — sem `envVarGroups:` |
| Physical Grouping | Web e cron rodam em containers Render distintos, mesma região implícita; DB Supabase separado; frontend Vercel separado | ✅ presente (natural do provedor) | `DEPLOY.md` |
| Package Dependencies | `package-lock.json` versionado; CI roda `npm ci`; `npm audit --audit-level=high` no CI (linha 21 de `ci.yml`) | ✅ presente | `src/backend/package.json` + `.github/workflows/ci.yml:21` |
| Surge Protection | `express-rate-limit` no web (não afeta cron); cron protegido por `IngestLockBusyError` advisory-lock — mas isto **mascara** o problema de duas cadências rodando em paralelo em vez de resolvê-lo | ⚠️ parcial | `src/backend/index.ts:12` (rateLimit) + comentário `render.yaml:97-98` |
| Feature toggles / kill-switch | Ótimo padrão precedente para SISPAG (`SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`) e Recebimentos (`RECEBIMENTOS_ENABLED`) — **não replicado para o novo cron** | ❌ ausente para permutas | `render.yaml:33-47` (SISPAG/REC) vs. cron |
| Idempotent deploys | `npm run migrate` é idempotente (tracking próprio) e roda no `preDeployCommand` do web; o job `ingest-permutas` é idempotente por design (advisory lock + UPSERT) | ✅ presente | `src/backend/jobs/ingest-permutas.ts:15-18` + `migrations/migrate.ts` |
| Drift detection | Não há job periódico que verifique se o `render.yaml` bate com o dashboard (as chaves `sync:false` são justamente as que podem divergir sem alerta) | ❌ ausente | Inspeção — nenhum workflow em `.github/workflows/` faz isso |
| Reproducible builds | Lockfile presente, CI usa `npm ci`, Node 24 em CI e Node no `render.yaml` sem pinning (usa default do Render, arriscado) — o `.tool-versions` do repo raiz existe (14 bytes, provavelmente node) | ⚠️ parcial | `render.yaml` não declara `nodeVersion:`; `ci.yml:14` pinia `24` |
| Per-tenant blast-radius limit | ⚠️ Não medível — arquitetura atual é single-tenant Render (um único deploy compartilhado). Alvo Terraform/AWS não existe. | N/A (contexto) | CLAUDE.md §Tenants |
| Deployment observability | Logs do Render por serviço no dashboard; sem alerta ativo em falha de deploy do cron (o `IngestLockBusyError` **quando o Render cron perder para o GH Actions cron** vai virar noise sem métrica) | ⚠️ parcial | Ausência de configuração de notificação em `render.yaml` |

## 4. Findings (achados)

### F-deployability-1: Dois crons rodam `ingest-permutas` simultaneamente às 06:00 BRT (GH Actions + Render blueprint)

- **Severidade**: P0
- **Tactic violada**: Logical Grouping / Surge Protection
- **Localização**: `render.yaml:100-134` (novo cron) e `.github/workflows/ingest-permutas.yml:10-14` (cron pré-existente, criado em `11b7494`/`2e5aa04`/`9bf4842`)
- **Evidência (objetiva)**:
  ```
  # .github/workflows/ingest-permutas.yml:12-14
  schedule:
    # 3x/dia: 06:00, 12:00 e 18:00 BRT (= 09:00, 15:00, 21:00 UTC).
    - cron: '0 9,15,21 * * *'

  # render.yaml:106
  schedule: '0 9 * * *'

  # Cabeçalho do workflow GH (linha 3):
  # Cron GRATUITO via GitHub Actions (Render Cron Job é pago).
  ```
  O comentário do workflow GH Actions foi introduzido **explicitamente** porque "Render Cron Job é pago". O novo bloco em `render.yaml` reintroduz o custo evitado e cria uma segunda cadência que colide com o tick das 09:00 UTC (06:00 BRT) do GH.
- **Impacto técnico**: A cada 06:00 BRT, dois processos disputam o mesmo advisory lock; o perdedor lança `IngestLockBusyError` e polui os logs com falha diária previsível. Se, além disso, os dois lerem `CONEXOS_BASE_URL` de fontes diferentes (dashboard Render vs. `secrets` do GitHub), a "ingestão vencedora" muda a cada execução conforme quem chegar primeiro no lock — comportamento não-determinístico.
- **Impacto de negócio**: Custo mensal do plano `starter` do Render cron pago sem benefício (a cadência já era coberta pelo GH); risco reputacional de a Simone abrir chamado dizendo "a ingestão falhou" quando na verdade é o cron perdedor logando erro esperado; se a env divergir, a tela mostra dados diferentes conforme quem venceu a corrida.
- **Métrica de baseline**: 2 execuções concorrentes por dia em 100% dos dias após esta deploy; 1 delas termina em `exit 1` com log de erro.

### F-deployability-2: `cron` do Render não roda `preDeployCommand: npm run migrate`

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands / Idempotent deploys
- **Localização**: `render.yaml:100-134` (ausência)
- **Evidência (objetiva)**:
  ```
  # render.yaml:20-21 (web tem)
  preDeployCommand: npm run migrate && npm run seed:admin
  # render.yaml:100-134 (cron NÃO tem)
  ```
  Serviços do Render blueprint deployam em paralelo — o cron não espera o `preDeployCommand` do web. Se um push em `main` traz migration + código de job novo, o cron pode ser promovido para uma SHA que espera colunas ainda inexistentes no schema, caso o tick da 09:00 UTC chegue antes do web terminar de aplicar as migrations.
- **Impacto técnico**: Janela de risco de o job rodar contra schema velho. Mitigado hoje porque (a) o GH Actions cron **roda `npm run migrate` como step próprio** (`.github/workflows/ingest-permutas.yml:46`) e (b) `permuta_invoice` já existe. Vira P0 no dia que uma migration alterar essa tabela e o cron do Render ganhar a corrida.
- **Impacto de negócio**: Falha silenciosa da ingestão pós-deploy que só é vista quando a Simone abre a aba "em aberto"; potencial `permuta_invoice` corrompida se a migration for `ALTER COLUMN` incompatível.
- **Métrica de baseline**: 100% dos deploys atuais deixam o cron sem qualquer garantia de schema (0 de N migrations aplicadas por gatilho do próprio cron do Render).

### F-deployability-3: 10 chaves de env duplicadas entre `web` e `cron` sem `envVarGroups` — split-brain garantido no médio prazo

- **Severidade**: P1
- **Tactic violada**: Logical Grouping
- **Localização**: `render.yaml:23-79` (web) e `render.yaml:110-133` (cron)
- **Evidência (objetiva)**:
  ```
  Duplicadas (3 literais + 7 sync:false):
    environment, client_name, CONEXOS_EXTRATO_SYNC_START_DATE,
    CONEXOS_BASE_URL, CONEXOS_WRITE_ENABLED, CONEXOS_DRY_RUN,
    databaseConnectionString, CONEXOS_USERNAME, CONEXOS_PASSWORD, CONEXOS_FIL_COD

  Verificadas como **corretamente omitidas** do cron (HTTP/auth-only):
    DEV_AUTH_BYPASS, SISPAG_ENABLED, SISPAG_LIVE_WRITE_ENABLED,
    RECEBIMENTOS_ENABLED, AUTH_JWT_SECRET, ADMIN_USERNAME,
    ADMIN_PASSWORD, ALLOWED_ORIGINS  (8 keys — job não serve HTTP)
  ```
  O próprio autor do YAML documentou o risco no comentário `render.yaml:109-110`: "divergência de env entre a API e o job produz ingestão com regra diferente da tela, que é pior que não ter cron". O comentário admite o problema; a implementação não o resolve — as 7 chaves `sync:false` continuam sendo dois pointers independentes para o dashboard.
- **Impacto técnico**: Operador rota `CONEXOS_PASSWORD` no serviço `financeiro-backend` mas esquece do `financeiro-ingest-permutas`; o web fica ok, o cron começa a falhar auth no ERP no próximo tick. Ou vice-versa. Impossível detectar em code review.
- **Impacto de negócio**: Ingestão silenciosamente parada durante rotação de credencial; a tela mostra dados antigos por dias até alguém notar. Runbook de rotação de senha do Conexos precisa lembrar de "2 lugares no dashboard do Render" — informação frágil.
- **Métrica de baseline**: 10 chaves em risco de drift × N rotações/ano; 0 detecção automatizada de drift.

### F-deployability-4: Sem kill-switch runtime para o cron `ingest-permutas` — pausar exige clique no dashboard ou redeploy

- **Severidade**: P1
- **Tactic violada**: Rollback
- **Localização**: código do job em `src/backend/jobs/ingest-permutas.ts:24-27` (não consulta env de habilitação)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "PERMUTAS_INGEST\|INGEST_ENABLED" src/backend/
  (0 hits)

  Precedente que funciona (SISPAG):
    render.yaml:40  - key: SISPAG_LIVE_WRITE_ENABLED   sync: false
    render.yaml:46  - key: RECEBIMENTOS_ENABLED         sync: false
  ```
  O comentário do `render.yaml:35-39` (SISPAG) explica a arquitetura ideal: "`sync: false` deixa o dashboard como fonte da verdade — ligar e desligar sem redeploy". O novo cron **não** herda esse padrão.
- **Impacto técnico**: Se o `ingest-permutas` começar a corromper `permuta_invoice` em produção (ex.: regressão no `derivarPagoDosTitulos`), as opções são: (a) pausar o cron no dashboard do Render — mas o próximo `terraform`-like sync do blueprint pode ressuscitar; (b) removê-lo do YAML e esperar CI + redeploy (~5min); (c) desabilitar temporariamente rotacionando `CONEXOS_PASSWORD` para valor inválido — colateral: derruba a Frente I inteira.
- **Impacto de negócio**: MTTR de emergência do cron: ~5min (redeploy) vs. <60s (kill-switch runtime). Em uma corrupção de dados que ingesta 300+ invoices/hora nas horas pico, cada minuto vira retrabalho manual para a Simone.
- **Métrica de baseline**: 0 vias runtime de pausar o cron sem tocar em código/YAML.

### F-deployability-5: `buildCommand` duplicado (`npm ci && npm run build`) no cron — 2 builds paralelos por deploy sem cache compartilhado

- **Severidade**: P2
- **Tactic violada**: Package Dependencies (eficiência)
- **Localização**: `render.yaml:18` (web) e `render.yaml:102` (cron)
- **Evidência (objetiva)**:
  ```
  render.yaml:18  buildCommand: npm ci && npm run build   # web
  render.yaml:102 buildCommand: npm ci && npm run build   # cron (idêntico)
  ```
  O `build` é `tsc && npx tsc-esm-fix dist` (package.json:11) sobre 46.833 LOC do backend. Estimativa (sem executar em `--quick`): `npm ci` ~30-60s + `tsc` ~20-40s + `tsc-esm-fix` ~10s → **~60-110s por build × 2** = 2-3.5 minutos de CPU-tempo Render por push. E deploys por push em `main` são incondicionais (`autoDeploy: true`), inclusive quando o diff é 100% em `docs/`, `ontology/` ou `src/frontend/`.
- **Impacto técnico**: Deploys mais lentos, custo Render maior, janela de risco de o web e o cron divergirem em build (raro mas possível se um `npm ci` puxar patch diferente entre os dois builds paralelos por race no registro npm — mitigado pelo lockfile).
- **Impacto de negócio**: Custo de infra evitável; deploy queue mais longa; feedback loop mais lento para o dev que subiu o PR. Não bloqueia entrega.
- **Métrica de baseline**: 2× tempo de build por push (vs. 1×); ~100% dos pushes triggam ambos, inclusive quando o backend não mudou.

### F-deployability-6: Probes novas (`probe-invoice-pago.ts`, `validate-invoice-pago-detalhe-v1.ts`) compiladas para `dist/` — bloat no bundle de produção

- **Severidade**: P3
- **Tactic violada**: Package Dependencies (higiene do artefato)
- **Localização**: `src/backend/tsconfig.json:24` (`include: ["**/*.ts"]` sem `exclude` de `jobs/probe-*` ou `jobs/validate-*`)
- **Evidência (objetiva)**:
  ```
  $ find src/backend/jobs -name "probe-*.ts" -o -name "validate-*.ts" | wc -l
  32

  tsconfig include: ["**/*.ts"]  → todas as 32 vão para dist/
  Este delta acrescenta 2 arquivos (365 LOC) ao artefato.
  ```
  O gate `PROBE_ALLOW_PRD=1` (`src/backend/jobs/probe-invoice-pago.ts:60`) impede execução acidental (P0 evitado). Mas o código está em `dist/` — se alguém adicionar um `startCommand` errado em qualquer serviço futuro do blueprint, ele **está lá para ser chamado**. E ocupa espaço/tempo de build para código que só roda ad-hoc.
- **Impacto técnico**: Bundle inflado em ~2% (2 files novos sobre 32 já existentes de mesma classe); `tsc` typechecka arquivos que não vão para runtime; superfície de "código morto exposto" cresce a cada probe/validate criado (padrão viral no repo — 32 arquivos e contando).
- **Impacto de negócio**: Baixo direto. Indireto: onboarding fica ruidoso ("o que faz cada um desses 32?"), e a distinção "código de produção vs. sonda one-shot" some.
- **Métrica de baseline**: 32 arquivos de sonda no bundle de runtime; 0 exclusões no `tsconfig`.

### F-deployability-7: `render.yaml` não pina `nodeVersion` no cron nem no web — build depende do default do Render

- **Severidade**: P3
- **Tactic violada**: Reproducible builds
- **Localização**: `render.yaml:8-9` (web) e `render.yaml:101-102` (cron) — nenhum `nodeVersion:`
- **Evidência (objetiva)**:
  ```
  runtime: node   # sem "nodeVersion: <major>"
  ```
  CI pinia Node 24 (`.github/workflows/ci.yml:14`), mas o Render usa o default do provider (hoje Node 22-ish, sujeito a mudança sem aviso). Se o Render passar o default para Node 26 amanhã, um build passa no CI (24) e falha (ou passa com semântica diferente) em produção.
- **Impacto técnico**: Divergência silenciosa entre CI e prod; risco baixo hoje, cresce a cada release major do Node.
- **Impacto de negócio**: "Passou no CI, quebrou no deploy" — perda de confiança no pipeline; retrabalho.
- **Métrica de baseline**: 0 dos 2 serviços do blueprint pinam `nodeVersion`.

## 5. Cards Kanban

### [deployability-1] Consolidar cadência do `ingest-permutas` em UMA fonte (remover o cron do Render OU o workflow do GH Actions)

- **Problema**
  > Após este delta, o job `ingest-permutas` está agendado em dois lugares (`.github/workflows/ingest-permutas.yml:12` — `0 9,15,21 * * *` UTC — e `render.yaml:106` — `0 9 * * *` UTC), rodando simultaneamente às 06:00 BRT todos os dias. O perdedor da corrida pelo advisory lock termina com `IngestLockBusyError` (`exit 1`) e polui logs. O comentário do próprio workflow GH admite: "Render Cron Job é pago" — o cron do Render foi introduzido apesar dessa constatação explícita.

- **Melhoria Proposta**
  > Decidir a fonte única e remover a outra. Recomendação: **manter o Render cron** (roda no mesmo container do backend, mesma stack de config, mesmo `EnvironmentProvider`) e **remover** `.github/workflows/ingest-permutas.yml`; ou **manter GH Actions** (grátis, já testado, já roda migrate antes) e **remover** o bloco `cron` novo de `render.yaml`. Tactic Bass: **Logical Grouping** — uma responsabilidade, um agendador. Documentar a decisão em ADR.

- **Resultado Esperado**
  > Zero execuções concorrentes do `ingest-permutas` na janela 06:00 BRT.
  > Logs limpos de `IngestLockBusyError`.

- **Tactic alvo**: Logical Grouping
- **Severidade**: P0
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Execuções concorrentes/dia: 2 → 0
  - Ocorrências diárias de `IngestLockBusyError` esperadas: 1 → 0
- **Risco de não fazer**: Custo Render pago sem benefício + falso-positivo diário em log noise que camufla erros reais + drift potencial entre `secrets` do GitHub e dashboard do Render alterando a semântica da ingestão sem code change.
- **Dependências**: Nenhuma.

### [deployability-2] Adicionar `preDeployCommand: npm run migrate` ao cron do Render (ou consolidar via card #1)

- **Problema**
  > O bloco `type: cron` novo (`render.yaml:100-134`) não tem `preDeployCommand`. Serviços do Render blueprint deployam em paralelo — o cron pode subir para uma SHA cujo `ingest-permutas` espera colunas que o web ainda não migrou (o `preDeployCommand: npm run migrate && npm run seed:admin` do web não gira antes do cron subir). Hoje é mitigado só porque o GH Actions cron faz `npm run migrate` explicitamente antes do job (`.github/workflows/ingest-permutas.yml:46`) — se o card #1 remover o GH cron, some a rede de segurança.

- **Melhoria Proposta**
  > Se a decisão em [deployability-1] for manter o cron do Render, adicionar `preDeployCommand: npm run migrate` ao bloco (idempotente por tracking próprio das migrations). Tactic Bass: **Script Deployment Commands** — o pipeline promove uma unidade coerente (schema + código), não fragmentos.

- **Resultado Esperado**
  > 100% dos deploys do cron passam por `migrate` antes do próximo tick agendado; risco de schema stale eliminado.

- **Tactic alvo**: Script Deployment Commands / Idempotent deploys
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Migrations aplicadas antes do tick pós-deploy: 0/N → N/N
- **Risco de não fazer**: Um dia uma migration destrutiva de coluna encontra o cron do Render vencendo a corrida contra o web e o job explode em produção com `column does not exist`, deixando `permuta_invoice` fria.
- **Dependências**: Decisão do card [deployability-1].

### [deployability-3] Extrair chaves compartilhadas para `envVarGroups` do Render (fonte única para `CONEXOS_*` e `databaseConnectionString`)

- **Problema**
  > 10 chaves de env estão declaradas em dois blocos `envVars` distintos (`render.yaml:23-79` web vs. `render.yaml:110-133` cron): 3 literais (`environment`, `client_name`, `CONEXOS_EXTRATO_SYNC_START_DATE`) e 7 com `sync:false` (`CONEXOS_BASE_URL`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`, `databaseConnectionString`, `CONEXOS_USERNAME`, `CONEXOS_PASSWORD`, `CONEXOS_FIL_COD`). O próprio autor documentou o risco em `render.yaml:109-110`, mas a solução não foi aplicada. Rotação de senha do Conexos exige atualizar 2 lugares no dashboard.

- **Melhoria Proposta**
  > Criar um `envVarGroup` (`financeiro-shared`) no dashboard do Render contendo as 7 chaves `sync:false` compartilhadas + as 3 literais compartilhadas. Referenciar em ambos os serviços via `fromGroup: financeiro-shared` no bloco `envVars`. Tactic Bass: **Logical Grouping** — uma unidade lógica de configuração para o mesmo domínio. Manter apenas as chaves HTTP/auth-only (`DEV_AUTH_BYPASS`, `AUTH_JWT_SECRET`, `ADMIN_*`, `ALLOWED_ORIGINS`, `SISPAG_*`, `RECEBIMENTOS_*`) no bloco específico do web.

- **Resultado Esperado**
  > Chaves duplicadas em risco de drift: 10 → 0. Runbook de rotação de credencial do Conexos passa a ter 1 passo em vez de 2.

- **Tactic alvo**: Logical Grouping
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Chaves duplicadas no `render.yaml`: 10 → 0
  - Passos no runbook de rotação de `CONEXOS_PASSWORD`: 2 → 1
- **Risco de não fazer**: Em 6 meses, alguém rota credencial Conexos no serviço `financeiro-backend` e esquece do `financeiro-ingest-permutas`. A tela funciona, a ingestão para; a Simone só percebe quando abre a aba e vê dados de dias atrás.
- **Dependências**: Nenhuma.

### [deployability-4] Adicionar kill-switch runtime `PERMUTAS_INGEST_ENABLED` para o cron (seguir padrão SISPAG/Recebimentos)

- **Problema**
  > Não há env para desligar o `ingest-permutas` sem redeploy — o job em `src/backend/jobs/ingest-permutas.ts:24-27` chama direto o service sem consultar flag. O precedente que funciona é `SISPAG_LIVE_WRITE_ENABLED` (`render.yaml:40`) e `RECEBIMENTOS_ENABLED` (`render.yaml:46`), com `sync:false` para permitir toggle no dashboard sem tocar em código. Se o cron começar a corromper `permuta_invoice`, as únicas saídas são pausar via dashboard do Render (não versionado, pode ressuscitar em próximo sync) ou remover do YAML e esperar redeploy.

- **Melhoria Proposta**
  > (1) Adicionar `PERMUTAS_INGEST_ENABLED` ao `EnvironmentProvider` (fail-safe: ausente = habilitado, seguindo `RECEBIMENTOS_ENABLED`); (2) o job `ingest-permutas.ts` checa a flag no início e sai com log claro se `false`; (3) declarar a chave em ambos os serviços (ou via `envVarGroups` do card #3) com `sync:false`. Tactic Bass: **Rollback** — permitir reverter comportamento sem redeploy.

- **Resultado Esperado**
  > MTTR de pausa emergencial do cron: ~5min (redeploy) → <60s (toggle no dashboard).

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Vias runtime de pausar o cron: 0 → 1
  - MTTR emergencial esperado: 5min → 1min
- **Risco de não fazer**: Numa próxima regressão em `derivarPagoDosTitulos` (ver Cross-QA — este delta mexeu justamente aí), qualquer pausa emergencial exige redeploy. Se o CI estiver vermelho no momento, a pausa vira "editar YAML, forçar merge, esperar deploy".
- **Dependências**: Combina bem com [deployability-3] (declarar a chave no `envVarGroup`).

### [deployability-5] Skip build no push que não toca `src/backend/**` (evitar 2 builds paralelos gratuitos por deploy)

- **Problema**
  > `render.yaml:18` (web) e `render.yaml:102` (cron) rodam ambos `npm ci && npm run build` a cada push em `main`, mesmo quando o diff é 100% em `docs/`, `ontology/` ou `src/frontend/`. Sobre 46.833 LOC de backend, cada build dura ~60-110s; o delta transforma 1 build por deploy em 2 paralelos.

- **Melhoria Proposta**
  > Opção A (barata): configurar `Ignored Paths` no dashboard do Render para os dois serviços (pular deploy quando o diff é só em `docs/`, `ontology/`, `src/frontend/`). Opção B (melhor): mover as duas ingestões de deploy para um único serviço e fazer o cron reusar o container do web via `preDeployCommand` compartilhado. Tactic Bass: **Package Dependencies** — evitar retrabalho de artefato quando nada relevante mudou.

- **Resultado Esperado**
  > Push que não toca `src/backend/**` promove 0 builds Render. Push que toca backend: 2 builds → 1 build (opção B).

- **Tactic alvo**: Package Dependencies
- **Severidade**: P2
- **Esforço estimado**: S (opção A) / M (opção B)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Builds Render/push (docs-only): 2 → 0
  - Tempo de deploy do backend por push: 60-110s → 30-55s (opção B)
- **Risco de não fazer**: Custo de infra dobra sem contrapartida; feedback loop mais lento reduz vontade de fazer commits pequenos.
- **Dependências**: Após [deployability-1] estar decidido (se a decisão for remover o cron do Render, este card colapsa em "restaurar estado anterior").

### [deployability-6] Excluir `jobs/probe-*.ts` e `jobs/validate-*.ts` do bundle de produção via `tsconfig.exclude`

- **Problema**
  > `src/backend/tsconfig.json:24` tem `include: ["**/*.ts"]` sem excluir a pasta de sondas — hoje 32 arquivos `jobs/probe-*.ts` + `jobs/validate-*.ts` (este delta adiciona 2, 365 LOC) vão para `dist/` mesmo sendo scripts one-shot rodados via `npx tsx`. Gate `PROBE_ALLOW_PRD` protege contra execução acidental (bom), mas o código ocupa artefato e cresce viralmente.

- **Melhoria Proposta**
  > (1) Adicionar `"exclude": ["node_modules", "dist", "jobs/probe-*.ts", "jobs/validate-*.ts", "**/*.test.ts"]` ao `src/backend/tsconfig.json`; (2) confirmar que os probes rodam via `tsx` diretamente do source (não dependem de `dist/`) — é o padrão já usado (`PROBE_ALLOW_PRD=1 npx tsx jobs/probe-invoice-pago.ts`, comentário linha 54). Tactic Bass: **Package Dependencies** — artefato de produção só carrega o que produção executa.

- **Resultado Esperado**
  > `dist/jobs/probe-*.js` e `dist/jobs/validate-*.js`: 32+ arquivos → 0. Tempo de `tsc` reduz proporcionalmente.

- **Tactic alvo**: Package Dependencies
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-6
- **Métricas de sucesso**:
  - Arquivos probe/validate em `dist/`: 32 → 0
  - LOC do bundle: -~3000 LOC de sonda
- **Risco de não fazer**: Padrão viral — chega a 50, 80 arquivos de sonda em um ano; nova pessoa não sabe distinguir o que é produção do que é histórico de investigação.
- **Dependências**: Nenhuma.

### [deployability-7] Pinar `nodeVersion` no `render.yaml` (ambos serviços) para bater com CI

- **Problema**
  > `render.yaml` declara `runtime: node` sem `nodeVersion:`. CI pinia Node 24 (`.github/workflows/ci.yml:14`). Render usa default do provider, hoje inferior; ao trocar o default (sem aviso), o CI pode passar e o build de produção pode falhar por incompatibilidade de sintaxe/API.

- **Melhoria Proposta**
  > Adicionar `nodeVersion: '24'` em ambos os serviços do `render.yaml`. Alinhar com `.tool-versions` na raiz (14 bytes — verificar conteúdo). Tactic Bass: **Reproducible builds** — mesmo bytecode em CI e prod.

- **Resultado Esperado**
  > CI e produção usam a mesma major do Node em 100% dos deploys.

- **Tactic alvo**: Reproducible builds
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-7
- **Métricas de sucesso**:
  - Divergência de major Node entre CI e Render: potencial → 0
- **Risco de não fazer**: "Passou no CI, quebrou no deploy" em uma janela desconfortável (ex.: sexta 17h).
- **Dependências**: Nenhuma.

## 6. Notas do agente

- Delta minúsculo mas denso em deployability: adicionar 54 linhas ao `render.yaml` gerou 1 P0 (crons duplicados) + 3 P1 (migrate ordering, drift de env, sem kill-switch runtime). O cabeçalho do workflow GH Actions **explicitamente** disse "Render Cron Job é pago" e o novo bloco YAML introduziu esse custo mesmo assim — vale registrar como sinal de que a decisão passou sem alinhamento entre autor do PR e autor do workflow.
- Não executei `npm run build` (escopo `--quick`); as métricas de tempo de build são estimativas por LOC + dependências.
- Cross-QA: F-deployability-1 (crons duplicados) e F-deployability-4 (sem kill-switch) têm rebatimento direto em **fault-tolerance** (surge protection do lock mascarando o problema em vez de resolvê-lo) e **availability** (MTTR de pausa emergencial). F-deployability-2 (migrate ordering) rebate em **integrability** (o cron pode chamar Conexos com schema local inconsistente). Alertar o consolidator.
- Terraform / tenants / Lambda bundles marcados N/A porque o repo atual roda Express em Render (contexto CLAUDE.md); o template do QA prevê métricas AWS que não existem aqui — não são omissões, são não-medíveis.
