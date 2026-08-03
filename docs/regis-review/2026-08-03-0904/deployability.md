---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-03-0904
agent: qa-deployability
generated_at: 2026-08-03T09:40:00-03:00
scope: backend
score: 4
findings_count: 6
cards_count: 5
---

# Deployability — Regis-Review

> Escopo: delta de `fix/sn-titulo-condicao-fail-closed` contra `fix/sn-cond-pgto-finalizacao`
> (`git diff fix/sn-cond-pgto-finalizacao..HEAD` — 2 commits, 3 arquivos de código, 8 de ontologia/docs).
> Flag `--quick`: sem build pesado; sem Terraform (não existe no repo).
> Stack real de deploy medida aqui: **Render** (backend Express, `autoDeploy: true` em `main`) +
> **Vercel** (frontend) + **Supabase** (Postgres). Não há Lambda/API Gateway/Terraform — o CLAUDE.md
> os declara "alvo" ainda não materializado. Portanto tactics de "Scale Rollouts" (canary/blue-green
> por Lambda alias/weighted routing) e "Physical/Logical Grouping por tenant" são avaliadas contra o
> que **existe hoje** (`render.yaml`, `.github/workflows/`), não contra o alvo AWS.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev merge em `main` da correção fail-closed | push aciona `autoDeploy: true` no Render + preDeploy `npm run migrate && npm run seed:admin` | `RecebimentoNumerarioService.completarSnAdiantamento` (Frente IV escrita real no Conexos prod) | Produção Columbia Trading rodando `RECEBIMENTOS_ENABLED=true` (Fase 1 em cutover); ERP Conexos prod com cadastros por-pessoa divergentes de HML | Nova ordem/condicionalidade do PUT `com299.pgtCod` entra na próxima alocação processada; se o PUT destruir parcelas em prod, a etapa **falha fechada** com mensagem nomeada em vez de finalizar SN sem título | (a) rollback em ≤ 10 min sem escrita nova no ERP; (b) 0 SNs "órfãs" (doc criado, item gravado, sem título e sem etapa finalizada) na primeira semana; (c) versão do app bumpada e taggeada no release (`v0.19.x`), com CHANGELOG lig­ando o deploy ao commit |

O cenário é apertado por três decisões da stack atual: **autoDeploy em `main` sem stage intermediário
prd**, ausência de flag por-comportamento (só o gate coarse `RECEBIMENTOS_ENABLED`), e master-data
por-tenant que o próprio delta documenta como divergente entre HML e produção
(`docs/e2e/gap-titulos-diagnostico.md:63-69`). O caminho novo (`applyPaymentConditionIfRequired`) é
**exercitado apenas em produção**, porque no HML medido (SKYJACK/232) a com194 devolve `count:0` e o
`if` cai fora antes do PUT.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Bump de versão FE+BE (lockstep) no delta | 0.19.0 → 0.19.0 (sem bump) | patch (0.19.0 → 0.19.1) para `fix:` | ❌ | `git show fix/sn-cond-pgto-finalizacao:src/backend/package.json` vs `HEAD` |
| Entrada nova no `CHANGELOG.md` do delta | ausente | uma entrada por bump | ❌ | `docs/CHANGELOG.md` (última entrada é `v0.19.0 (2026-07-30)`) |
| Feature flag por comportamento (novo passo `applyPaymentConditionIfRequired`) | ausente — sem leitura de env no arquivo | 1 flag boolean gateando a lógica nova | ❌ | `grep -c "SISPAG_ENABLED\|RECEBIMENTOS_ENABLED\|CONEXOS_WRITE_ENABLED" src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` → `0` |
| Feature flag de módulo (rota `/recebimentos/*`) | presente (`RECEBIMENTOS_ENABLED`, fail-safe em prd) | presente | ✅ | `render.yaml:39-40`, `src/backend/domain/libs/environment/model/EnvironmentVars.ts:46-50` |
| Gates de CI que rodariam nesta PR | typecheck + `npm audit --audit-level=high` + `npm run lint` + `npm test --coverage` + build (backend); typecheck + lint + test (frontend) | ≥ typecheck+test | ✅ | `.github/workflows/ci.yml:23-27` (backend), `:43-46` (frontend) |
| Gate de deploy (branch protection ⇒ Render `autoDeploy`) | required checks: `Backend`+`Frontend`; sem etapa deploy explícita no workflow | plan/promote separados | ⚠️ | `render.yaml:15-17` ("gate is GitHub branch protection … no deploy job") |
| Rollback documentado para a Frente IV | ausente (só existe `docs/runbooks/fin010-write-cutover.md` para Permutas) | runbook por frente com efeitos irreversíveis | ❌ | `ls docs/runbooks/` → 1 arquivo apenas |
| Idempotência do preDeploy (migrations + seed) | idempotente (`--include=dev` + `tsx migrations/migrate.ts` + `seed:admin` UPSERT) | idempotente | ✅ | `render.yaml:21`, `DEPLOY.md:31-33` |
| Reprodutibilidade — lockfile commitado | `src/backend/package-lock.json` presente | presente | ✅ | `git ls-files src/backend/package-lock.json` |
| Reprodutibilidade — Node version pin | ausente (`engines` não declarado em package.json; sem `.nvmrc`; sem `.node-version`) | `engines.node` fixo ou `.nvmrc` | ❌ | `grep -A2 '"engines"' src/backend/package.json src/frontend/package.json` → vazio |
| Node version usada nos workflows | `ci.yml` = `24`; `ingest-permutas.yml` = `22`; `ingest-sispag.yml` = `22` (divergência) | uma única versão em todo o CI | ❌ | `.github/workflows/ci.yml:20`, `ingest-permutas.yml:41`, `ingest-sispag.yml:46` |
| Line-ending policy | ausente (`.gitattributes` não existe no repo) | `.gitattributes` normalizando LF | ❌ | `ls .gitattributes` → not found |
| Lint gate no CI — efetivo para este delta? | inconclusivo — CI roda em `ubuntu-latest` com `actions/checkout@v4` (autocrlf `input` no Linux ⇒ arquivos ficam LF), então `biome check` provavelmente passa em CI mesmo com o repo local em CRLF | catch consistente entre local e CI | ⚠️ | `.github/workflows/ci.yml:11-27`; `_shared-metrics.md:53-62` (falha só em Windows local) |
| Delta — testes verdes na suíte padrão | 97 suites / 1017 testes ✅; typecheck limpo | verde | ✅ | `_shared-metrics.md:41-45` |
| Tag/Release gerada automaticamente no push a `main` | só se `package.json` tiver versão nova; sem bump ⇒ nenhum `v0.19.x` novo (script é idempotente) | uma tag por deploy | ⚠️ | `.github/workflows/ci.yml:48-72` (`if git rev-parse "$TAG" >/dev/null 2>&1: exit 0`) |
| Tempo entre merge em `main` e write novo em prod | ≤ tempo do build Render + preDeploy (autoDeploy imediato); **sem stage/canary** | janela de observação antes do 1º write real | ❌ | `render.yaml:17` (`autoDeploy: true`) |
| Blast radius por deploy | 1 web service Render, 1 tenant Columbia, 1 filial `CONEXOS_FIL_COD` — tudo ligado por um único push | isolado por tenant/filial | ⚠️ (por design monotenant hoje) | `render.yaml:5-9` (único serviço); CLAUDE.md §Tenants "vazio" |
| Divergência HML×prod documentada no próprio delta | sim — o caminho `applyPaymentConditionIfRequired` NÃO é executado em HML (SKYJACK/232 sem cadastro) | ausência de divergência documentada = ok; **presença exige mitigação de canary** | ❌ (documentado mas não mitigado) | `docs/e2e/gap-titulos-diagnostico.md:63-69`; `_inbox/_watchlist.md` (item "divergencia-hml-producao-pgtCod") |

> ⚠️ **Não medível localmente** (fora do escopo `--quick`): tempo real de build/deploy no Render (histórico do dashboard), taxa de rollback por revert nos últimos 90 dias, MTTR de incidentes envolvendo escrita ERP. Requerem acesso ao painel Render + Vercel + trilha de operação.

## 3. Tactics — Cobertura no nf-projects

### Manage Deployment Pipeline

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts — Canary | ausente. Não há sub-conjunto de tráfego que recebe o binário novo antes do resto. O único "canary" hoje seria manual em cliente controlado, mas não está codificado nem documentado para a Frente IV. | ❌ | — (busca por "canary" nos workflows e docs: nenhum resultado relevante) |
| Scale Rollouts — Blue/Green | ausente. Render `type: web + autoDeploy: true` promove em corte, sem versão B rodando em paralelo. | ❌ | `render.yaml:17` |
| Scale Rollouts — Rolling / All-at-once | all-at-once por design do Render (single web service). Um único container troca; healthcheck em `/health` gateia o corte de tráfego. | ⚠️ | `render.yaml:22` |
| Rollback | manual pelo dashboard do Render (redeploy de um deploy anterior) OU `git revert` + push. Sem runbook para a Frente IV nem para efeitos irreversíveis em ERP. Para a Frente III de Permutas existe `docs/runbooks/fin010-write-cutover.md`; para SN/recebimentos não existe equivalente. | ⚠️ | `docs/runbooks/` (1 arquivo, escopo Permutas) |
| Script Deployment Commands | scriptado no `render.yaml` (buildCommand, startCommand, preDeployCommand). Migrations e seed rodam ANTES do corte de tráfego, idempotentes. | ✅ | `render.yaml:18-22` |

### Manage Deployed System

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Logical Grouping | Frente IV é agrupada por rota (`/recebimentos/*`) e gateada por `RECEBIMENTOS_ENABLED` (fail-safe: sem env ⇒ bloqueada em prd). Mas a NOVA lógica deste delta não tem sub-flag — vira comportamento default do módulo. | ⚠️ | `EnvironmentVars.ts:46-50`; `RecebimentoNumerarioService.ts` (0 leituras de env) |
| Physical Grouping | 1 web service Render por instância do produto; 1 tenant Columbia; 1 filial padrão via `CONEXOS_FIL_COD`. Multi-tenant é alvo, não estado. | ⚠️ (por design monotenant) | `render.yaml:5-9`; CLAUDE.md §Tenants |
| Package Dependencies | `npm ci` com `package-lock.json` commitado. Sem `engines.node` nem `.nvmrc` — a versão do Node é fixada apenas no workflow, com discrepância `24` no CI e `22` nos crons. | ⚠️ | `.github/workflows/ci.yml:20` vs `ingest-permutas.yml:41` |
| Surge Protection | N/A no caminho de deploy propriamente dito. A Frente IV tem advisory lock + concorrência limitada na ingestão (`_shared-metrics.md`), mas isso é run-time, não deploy-time. | N/A | Justificativa: deploy é evento raro, não uma superfície de surto. |
| Idempotent Deploys | preDeploy `migrate + seed:admin` é idempotente (UPSERT); build é `npm ci && npm run build` (reprodutível dado o lockfile). | ✅ | `DEPLOY.md:31-33`, `render.yaml:21` |
| Drift Detection | N/A — não há IaC (Terraform ausente) contra o qual detectar drift. O que existe é `render.yaml` como Blueprint, mas envs sensíveis são `sync:false` (fonte da verdade = dashboard). O comentário em `render.yaml:41-44` chama isso de decisão consciente ("não ter o blueprint sobrescrevendo o dashboard a cada deploy") — cita inclusive um "Regis P0 deployability" anterior sobre yaml×dashboard. | N/A (com justificativa) | `render.yaml:41-44` |
| Reproducible Builds | `package-lock.json` commitado, mas sem pin de Node runtime (nem `engines` nem `.nvmrc`); Biome não fixado pin exato; sem `.gitattributes` ⇒ line-ending drift entre Windows dev e Linux CI. | ⚠️ | vide métricas acima |
| Per-Tenant Blast-Radius Limit | N/A hoje (monotenant). Já foi listado como "alvo" no CLAUDE.md; sem tenants provisionados, não medível. | N/A | CLAUDE.md §Tenants "vazio" |
| Deployment Observability | `/health` como healthcheck, logs do preDeploy visíveis no Render (documentado em `DEPLOY.md:92`). Sem métrica correlacionando deploy → primeira falha em endpoint (SLO regression check ausente). O `LOG_TYPE.BUSINESS_WARN` que a `requiresRegisteredPaymentCondition` emite quando a com194 cai é boa telemetria, mas depende do operador saber olhar. | ⚠️ | `render.yaml:22`; `RecebimentoNumerarioService.ts:544-556` |

## 4. Findings

### F-deployability-1: Bump de versão FE+BE ausente no delta (pipeline rule violado)

- **Severidade**: P1
- **Tactic violada**: Reproducible Builds / Deployment Observability (release traceability)
- **Localização**: `src/backend/package.json` (versão), `src/frontend/package.json` (versão), `CHANGELOG.md` (raiz)
- **Evidência (objetiva)**:
  ```
  $ git show fix/sn-cond-pgto-finalizacao:src/backend/package.json  | grep '"version"' → 0.19.0
  $ git show HEAD:src/backend/package.json                          | grep '"version"' → 0.19.0
  $ git show fix/sn-cond-pgto-finalizacao:src/frontend/package.json | grep '"version"' → 0.19.0
  $ git show HEAD:src/frontend/package.json                         | grep '"version"' → 0.19.0

  # commit no delta:
  6d9c8c2 fix(recebimentos): stop destroying the SN title — item first, payment condition only when demanded
  # regra: bump-version.ps1 §DESCRIPTION → commit `fix...:` ⇒ PATCH (0.19.0 → 0.19.1). Não aplicado.
  ```
- **Impacto técnico**: (a) o job `tag-release` (`.github/workflows/ci.yml:48-72`) lê a versão do `package.json` e é idempotente — sem bump, **nenhuma tag nova é criada no push a `main`**. O binário que roda em Render fica sem versão distinguível da anterior. (b) O `/health` do backend (documentado em `bump-version.ps1` como exibindo a versão) reportará `0.19.0` tanto para a build velha quanto para a nova — perde-se a capacidade de "qual deploy está rodando agora?" via linha de comando. (c) CHANGELOG desatualizado ⇒ o operador não tem changelog em prosa da mudança de escrita em ERP.
- **Impacto de negócio**: reversão de incidente perde âncora temporal (tag/release). Se um SN em produção sair errado a partir da segunda-feira, não há como distinguir "foi este deploy" vs "foi o anterior" a partir do artefato — só do commit no `main`, que exige repo local. Auditoria financeira fica mais difícil.
- **Métrica de baseline**: 0 tags novas / 0 entradas de CHANGELOG para uma mudança que altera comportamento de escrita em ERP financeiro de produção.

### F-deployability-2: Ausência de feature flag por-comportamento — nova lógica é ativada por deploy sem gate

- **Severidade**: P1
- **Tactic violada**: Logical Grouping / Scale Rollouts (Canary)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:451-557`
- **Evidência (objetiva)**:
  ```
  $ grep -c "SISPAG_ENABLED\|RECEBIMENTOS_ENABLED\|CONEXOS_WRITE_ENABLED\|EnvironmentProvider" \
      src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  0

  # completarSnAdiantamento agora chama:
  #   (1) addLineItem                        (novo)
  #   (2) applyPaymentConditionIfRequired    (novo — antes era incondicional e vinha ANTES do item)
  # Nenhuma dessas rotas é gateada; toda alocação processada após o deploy usa a NOVA sequência.
  ```
- **Impacto técnico**: no instante em que o deploy corta tráfego, a próxima alocação de recebimento executada por qualquer analista usa (i) nova ordem (item antes da condição) e (ii) novo `if` da com194. Não há como habilitar apenas para um cliente/filial/analista para observar N execuções antes de generalizar. Se a lógica quebrar em prod (a divergência HML×prod está documentada no próprio delta), o único "off" é `RECEBIMENTOS_ENABLED=false` — que desliga a **frente inteira**, inclusive as funcionalidades OK (painel, ingestão, alocação sem execução).
- **Impacto de negócio**: rollback é all-or-nothing: ou se aceita o comportamento novo para todos os clientes, ou se desliga a frente inteira. Não há canary por-cliente para os casos onde a com194 devolve validação bloqueante (que só ocorre em produção, per `gap-titulos-diagnostico.md:63-69`). O comportamento defensivo fail-closed protege o ERP (não finaliza documento incoerente), mas leva ao cenário F-deployability-4 (SN órfã que precisa de limpeza manual).
- **Métrica de baseline**: 0 flags gateando o novo comportamento; 100% do tráfego de recebimentos usa a nova sequência a partir do 1º request pós-deploy.

### F-deployability-3: Sem runbook de rollback/cleanup para a Frente IV (só Permutas tem)

- **Severidade**: P1
- **Tactic violada**: Rollback / Deployment Observability
- **Localização**: `docs/runbooks/` (única entrada = `fin010-write-cutover.md`, escopo Frente I/III)
- **Evidência (objetiva)**:
  ```
  $ ls docs/runbooks/
  fin010-write-cutover.md
  ```
  O runbook existente cobre o cutover da escrita `fin010` (permutas) — inclui flags, procedimento HML-first, rollback (`CONEXOS_DRY_RUN=true`) e "sinais de problema". Não existe equivalente para a Frente IV (Recebimentos → SN + NDe), que já é irreversível (a SN nasce como documento real no com299, e o PUT da condição pode destruir parcelas).
- **Impacto técnico**: se o deploy quebrar em prod (SN órfã, título destruído sem regeneração, com194 indisponível prolongadamente), o operador on-call não tem procedimento definido. O código já embute mensagens de erro nomeando "gere as parcelas na tela Financeiro (com032) do documento e reprocesse" (`RecebimentoNumerarioService.ts:515-517`), mas essa instrução vive só no `throw` — não há runbook consultável antes.
- **Impacto de negócio**: MTTR alto no primeiro incidente da Frente IV. Aumenta risco de decisões improvisadas (mexer manualmente no com299 sem trilha de auditoria) sob pressão.
- **Métrica de baseline**: 1 runbook / 4 frentes financeiras = 25% de cobertura. Frente com risco irreversível mais recente (IV) sem runbook.

### F-deployability-4: HML não exercita o caminho de escrita novo — divergência de master-data por-cliente

- **Severidade**: P0
- **Tactic violada**: Scale Rollouts (Canary / progressive delivery) + Deployment Observability
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:462-519` (o bloco condicional inteiro), documentado em `docs/e2e/gap-titulos-diagnostico.md:63-69`
- **Evidência (objetiva)**:
  ```
  Do próprio delta (gap-titulos-diagnostico.md:63-69):
    "em produção o PUT não destruiu as parcelas, no HML destrói. A diferença mais provável
     está na condição de pagamento envolvida (a de produção tem regra de parcelamento; a
     101 do HML, aparentemente não). Consequência de projeto: a correção não pode assumir
     nenhum dos dois comportamentos — tem que verificar o resultado e falhar fechado."

  No HML medido (SKYJACK/232):
    lov/CondPgtoPessoa → 0 condições cadastradas
    com194 → count: 0 validações
    ⇒ requiresRegisteredPaymentCondition() retorna false
    ⇒ applyPaymentConditionIfRequired() cai no early-return
    ⇒ o caminho de escrita NOVO (linhas 471-518) NUNCA foi exercitado end-to-end contra ERP real.

  Em produção (pessoa 194 / L-FOUNDERS, per gap-titulos-diagnostico.md:59-60):
    com194 devolve validação bloqueante "CONDIÇÃO DE PAGAMENTO ... DIFERENTE DA SUGERIDA"
    ⇒ entra no PUT, e o comportamento do PUT (destrói? preserva?) NÃO é o mesmo do HML.
  ```
- **Impacto técnico**: o "canary de fato" desta mudança acontece em **produção**, no primeiro cliente que dispare a com194 bloqueante. O código foi projetado com fail-closed (`titulo === valorDoc` verificado após o PUT), então o pior caso conhecido é a etapa lançar `Error` com mensagem nomeada. Porém: (a) a SN já foi CRIADA antes desse ponto (documento real no com299), o item já foi gravado, e o PUT já foi executado — se o erro é levantado, resta um documento em estado intermediário no ERP; (b) o teste dessa hipótese "PUT preserva em prod" não foi feito em nenhum cliente controlado antes do deploy; (c) o comportamento é assimétrico entre "clientes tipo SKYJACK" (não exercitam o caminho novo) e "clientes tipo L-FOUNDERS" (só descobrem no primeiro request pós-deploy).
- **Impacto de negócio**: risco de N SNs órfãs em produção antes de o operador perceber. Cada uma exige limpeza manual no com032. Se acontecer em fechamento (cenário típico de recebimentos), amplia o backlog operacional exatamente na janela de menor tolerância.
- **Métrica de baseline**: 0 execuções end-to-end contra ERP real do path condicional; 100% das validações do path novo vêm de testes unitários mockando o `GerDocClient`/`FiscalClient`. Watchlist já registra: `_inbox/_watchlist.md` item "divergencia-hml-producao-pgtCod".

### F-deployability-5: Reprodutibilidade — Node runtime não pinado e discrepante entre workflows

- **Severidade**: P2
- **Tactic violada**: Reproducible Builds / Package Dependencies
- **Localização**: `.github/workflows/ci.yml:20`, `.github/workflows/ingest-permutas.yml:41`, `.github/workflows/ingest-sispag.yml:46`, `src/backend/package.json` (falta `engines`)
- **Evidência (objetiva)**:
  ```
  ci.yml:               node-version: '24'
  ingest-permutas.yml:  node-version: 22
  ingest-sispag.yml:    node-version: 22
  src/backend/package.json  → nenhum campo "engines"
  src/frontend/package.json → nenhum campo "engines"
  ls .nvmrc .node-version → não existem
  ls .gitattributes → não existe
  ```
- **Impacto técnico**: a build/test dessa correção roda em Node 24; o job de ingestão diária que reusa código do backend roda em Node 22. Alguém pode subir uma dependência que compila em 24 mas quebra em 22 (ou vice-versa) sem que o CI acuse. Sem `.gitattributes`, o lint local (Biome exige LF) fica quebrado em qualquer clone Windows — como o `_shared-metrics.md:53-62` já anotou. O gate de lint funciona no CI (Linux normaliza LF via `actions/checkout@v4`), mas cria a percepção de "lint quebrado" no dev local que corrói disciplina.
- **Impacto de negócio**: bugs de compatibilidade Node que escapam do CI vão parar no cron (job de ingestão diária = 3x/dia Permutas + 1x/dia SISPAG). Failure noturno silencioso.
- **Métrica de baseline**: 2 versões diferentes de Node no CI; 0 pins no package.json; 0 policy de line-endings; lint local quebra 100% dos clones Windows sem `git config core.autocrlf`.

### F-deployability-6: `autoDeploy: true` sem stage/canary — janela zero entre merge e write real

- **Severidade**: P2 (a arquitetura assume isso; nível de risco é aceitável hoje mas piora com o crescimento da Frente IV)
- **Tactic violada**: Scale Rollouts
- **Localização**: `render.yaml:17`
- **Evidência (objetiva)**:
  ```
  autoDeploy: true
  # comentário do próprio yaml: "Native auto-deploy on push to `main`. The gate is
  # GitHub branch protection (CI Backend/Frontend checks required to merge), so
  # only tested code reaches main and gets deployed."
  ```
  Não há ambiente `stg`/`prd` separado no `render.yaml`; não há step `terraform plan`+`apply` (não existe Terraform); não há aprovação humana entre "PR mergeado" e "código escreve no Conexos prod".
- **Impacto técnico**: a janela de observação entre "o time aceita o merge" e "o próximo `POST /recebimentos/executar-alocacao` grava com a nova lógica" é o tempo de build+preDeploy do Render (minutos, não horas). O único gate humano possível é NÃO mergear — depois do merge, autoDeploy dispara.
- **Impacto de negócio**: aceitável em regime "1 desenvolvedor, 1 analista, 1 tenant" (estado atual). Torna-se P1 quando (a) mais de um analista opera em paralelo, (b) mais tenants forem provisionados ou (c) SLA/janela de fechamento vira sensível a incidentes causados por deploy.
- **Métrica de baseline**: tempo entre merge em `main` e primeira escrita real com o binário novo = O(minutos) sem gate humano.

## 5. Cards Kanban

### [deployability-1] Bumpar versão FE+BE via `scripts/bump-version.ps1` antes de abrir o PR deste delta

- **Problema**
  > O commit `6d9c8c2 fix(recebimentos): stop destroying the SN title` altera comportamento de ESCRITA em ERP financeiro, mas nem `src/backend/package.json` nem `src/frontend/package.json` bumparam (ambos ficam em `0.19.0`). O pipeline do CLAUDE.md (§Green Criteria #10) exige bump em delta com `fix:`, e o job `tag-release` do CI é idempotente por tag — sem bump, nenhum `v0.19.x` novo é criado no push a `main`. `/health` reportará versão indistinguível da anterior.

- **Melhoria Proposta**
  > Rodar `pwsh scripts/bump-version.ps1 -Execute` na branch antes do PR: deve derivar `patch` (commit `fix:`) → 0.19.0 → 0.19.1, escrever ambos `package.json` em lockstep, adicionar entrada em `CHANGELOG.md` (raiz) descrevendo a correção (item-first + condicional + fail-closed) e commitar `chore(release): v0.19.1`. Tactic: Reproducible Builds / Deployment Observability.

- **Resultado Esperado**
  > Após push a `main`, o job `tag-release` (`.github/workflows/ci.yml:48-72`) cria a tag `v0.19.1` e o release. `/health` do backend passa a reportar `0.19.1`. CHANGELOG referenciando `docs/e2e/gap-titulos-diagnostico.md` como fonte da correção.

- **Tactic alvo**: Reproducible Builds / Release Traceability
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Versão FE/BE: 0.19.0 → 0.19.1 (lockstep)
  - Tag criada no `main`: 0 → 1 (`v0.19.1`)
  - Entrada nova no CHANGELOG: 0 → 1
- **Risco de não fazer**: incidentes futuros em produção não terão âncora de release; auditoria financeira precisará reconstruir "qual código estava rodando" a partir de git log em vez de tag imutável.
- **Dependências**: nenhuma (é passo-final do pipeline antes do PR).

### [deployability-2] Introduzir feature flag `RECEBIMENTOS_SN_CONDICAO_FAIL_CLOSED` gateando a nova sequência

- **Problema**
  > A nova ordem (item antes da condição) + o novo `applyPaymentConditionIfRequired` são ativados por deploy, sem gate por-comportamento (`grep` no arquivo mostra 0 leituras de env). O único off é `RECEBIMENTOS_ENABLED=false`, que desliga a frente inteira. Não há como fazer "canary manual" em um cliente/filial controlado antes de generalizar — cenário crítico porque a divergência HML×prod está documentada no próprio delta.

- **Melhoria Proposta**
  > Adicionar `RECEBIMENTOS_SN_CONDICAO_FAIL_CLOSED` (default `false` em prd, `true` em dev/hml) no `EnvironmentProvider` + `EnvironmentVars.ts` + `render.yaml` (`sync:false`). Gatear em `completarSnAdiantamento` de modo que `false` = comportamento antigo (PUT antes do item, sem verificação) e `true` = novo comportamento. Documentar em `DEPLOY.md` como flag de cutover — mesmo padrão de `CONEXOS_WRITE_ENABLED`+`CONEXOS_DRY_RUN`. Tactic: Logical Grouping / Scale Rollouts.

- **Resultado Esperado**
  > Operador pode habilitar o novo comportamento no dashboard do Render sem redeploy de código, observar N execuções, e desligar em segundos se algo quebrar. `/recebimentos/painel` continua funcionando com o flag `off`.

- **Tactic alvo**: Logical Grouping + Rollback (fast toggle)
- **Severidade**: P1
- **Esforço estimado**: M (2–5d, inclui manter os dois caminhos com testes de ambos e prazo de sunset)
- **Findings relacionados**: F-deployability-2, F-deployability-4
- **Métricas de sucesso**:
  - Tempo para reverter comportamento em produção: `git revert + push + Render redeploy` (~10min) → `flag off no dashboard + restart` (~30s)
  - Caminhos testados: 1 (novo) → 2 (novo + antigo com sunset date documentada)
- **Risco de não fazer**: o primeiro cliente prod com com194 bloqueante vira o "canary de fato"; se falhar, todo o time perde tempo até fim do incidente porque o off desliga a frente inteira.
- **Dependências**: sunset plan — decidir quando remover o caminho antigo (sugestão: após 30 dias com flag `true` em prd sem incidentes).

### [deployability-3] Criar runbook `docs/runbooks/recebimentos-sn-cutover.md` para a Frente IV

- **Problema**
  > A escrita da Frente IV (SN + NDe) é irreversível no ERP e o único runbook existente (`fin010-write-cutover.md`) cobre Permutas. Se o próximo deploy quebrar em prod e deixar SNs órfãs (documento criado, item gravado, título destruído), o operador não tem procedimento — a instrução vive só no `throw` do código (`RecebimentoNumerarioService.ts:515-517`).

- **Melhoria Proposta**
  > Criar `docs/runbooks/recebimentos-sn-cutover.md` no mesmo formato do `fin010`: flags relevantes (`RECEBIMENTOS_ENABLED`, futura `RECEBIMENTOS_SN_CONDICAO_FAIL_CLOSED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`), procedimento HML-first para próximas alterações do fluxo, procedimento de rollback (revert + Render redeploy), procedimento de limpeza de SN órfã via com032 (nomeando telas/campos), sinais de problema (log `com194 unavailable`, mensagens de fail-closed, `mnyTitValor !== docMnyValor`). Referenciar `docs/e2e/gap-titulos-diagnostico.md` e ADR-0025.

- **Resultado Esperado**
  > On-call tem procedimento consultável em ≤ 5min. MTTR do primeiro incidente da Frente IV cai por não depender de descoberta ad-hoc.

- **Tactic alvo**: Rollback / Deployment Observability
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3, F-deployability-4
- **Métricas de sucesso**:
  - Runbooks por frente com escrita real em ERP: 1/2 (Permutas ✅, Recebimentos ❌) → 2/2
  - Tempo mediano até identificar SN órfã e ação corretiva: indocumentado → ≤ 15min via runbook
- **Risco de não fazer**: primeiro incidente da Frente IV vira improvisação — risco de mexer manualmente no com299 sem trilha de auditoria.
- **Dependências**: idealmente depois de [deployability-2] para nomear o flag correto.

### [deployability-4] Estabelecer procedimento de canary manual por-cliente antes de generalizar mudanças de write da Frente IV

- **Problema**
  > A mudança introduzida por este delta só é exercitada em produção (HML não tem condição de pagamento cadastrada para os clientes testados, então o caminho novo cai no early-return). A watchlist de ontologia já registra "divergencia-hml-producao-pgtCod" como aberta. Sem canary explícito, o comportamento do PUT em produção é medido a posteriori.

- **Melhoria Proposta**
  > No mesmo runbook do card 3, definir uma seção "Cutover em produção — 1º caso real controlado" (análoga à Fase 2 do `fin010-write-cutover.md:23-28`): (a) escolher **um** cliente conhecido que dispara a com194 bloqueante (ex.: pessoa 194 / L-FOUNDERS); (b) rodar UMA alocação ao vivo com analista, verificar `mnyTitValor === docMnyValor` no com299 imediatamente após o PUT; (c) só depois permitir alocação em massa. Combinado com o flag do card 2 (`RECEBIMENTOS_SN_CONDICAO_FAIL_CLOSED=true` apenas para o cliente controlado — via toggle temporário no dashboard). Tactic: Scale Rollouts (canary manual).

- **Resultado Esperado**
  > A hipótese "PUT preserva em prod" vira medida antes de rodar em N clientes. Se falsa, apenas 1 SN precisa de limpeza (em vez de N).

- **Tactic alvo**: Scale Rollouts (canary)
- **Severidade**: P0
- **Esforço estimado**: S (≤1d — é procedimento operacional documentado, não código)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Nº de SNs afetadas pelo pior caso do 1º cutover: teórico ilimitado → 1 (por design do canary)
  - Item da watchlist "divergencia-hml-producao-pgtCod": aberto → resolvido com medição real
- **Risco de não fazer**: um dia normal de fechamento, com 20+ alocações processadas em paralelo, vira o "canary" — cada erro fail-closed é uma SN órfã.
- **Dependências**: [deployability-2] (flag por-comportamento habilita o canary); [deployability-3] (runbook documenta o procedimento).

### [deployability-5] Pinar Node runtime e normalizar line-endings (Package Dependencies / Reproducible Builds)

- **Problema**
  > `ci.yml` usa Node 24 e os workflows de cron usam Node 22 — nenhum dos dois `package.json` declara `engines.node`, e não há `.nvmrc`/`.node-version`/`.gitattributes`. Consequências medidas: (a) lint local (Biome exige LF) quebra em qualquer clone Windows por CRLF, degradando percepção de disciplina; (b) uma dependência que compile em 24 mas quebre em 22 escaparia do CI e falharia no cron noturno.

- **Melhoria Proposta**
  > (a) Adicionar `engines.node` (ex.: `"^22"` ou `"^24"` — decidir baseado no mais recente estável usado em prd Render/Vercel) em ambos `package.json`, com `.nvmrc` na raiz para desenvolvedores; (b) unificar os 3 workflows para a mesma versão de Node; (c) criar `.gitattributes` com `* text=auto eol=lf` (e overrides para arquivos binários). Tactic: Package Dependencies + Reproducible Builds.

- **Resultado Esperado**
  > Lint local funciona em Windows sem `git config core.autocrlf`. CI e cron rodam a mesma versão de Node. Um clone fresco em qualquer OS gera bytes idênticos.

- **Tactic alvo**: Package Dependencies + Reproducible Builds
- **Severidade**: P2
- **Esforço estimado**: S (≤1d, mas requer verificação de que Render/Vercel também usam a versão pinada)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Versões de Node no CI: 2 → 1
  - Pin de Node em package.json: ausente → presente em FE e BE
  - Lint local em Windows fresco: falha repo-wide → verde
- **Risco de não fazer**: sabor de "bug fantasma" quando dep atualiza; frustração de dev com lint quebrado; regressão de release quando Render sobe a versão do Node default e o app não previu.
- **Dependências**: nenhuma; independente dos demais cards.

## 6. Notas do agente

- Escopo `--quick` respeitado: não rodei `npm run build` (o `_shared-metrics.md` já registra typecheck limpo, 1017 testes verdes) e Terraform não existe no repo — findings são sobre o que EXISTE (Render/Vercel/Supabase).
- F-deployability-4 é a única P0 desta lente: numérica em cima do "0 execuções e2e reais do path condicional" + auto-documentação do delta como divergente entre HML e prod. Reforçada pelo card 4 (canary manual), que depende do card 2 (flag).
- Cross-QA para o consolidator: (a) F-deployability-4 conversa com **Fault-Tolerance** — o fail-closed é a mitigação atual, mas deixa efeito colateral no ERP; (b) F-deployability-3 conversa com **Availability** (MTTR sem runbook); (c) F-deployability-1 conversa com **Testability/Observability** — `/health` mentindo sobre versão é um problema de rastreabilidade que afeta qualquer investigação futura.
- Métrica que tentei coletar e falhou: histórico real de rollbacks no Render (requer painel). Substituí por análise do mecanismo (autoDeploy + branch protection) e da ausência de scaffolding de rollback documentado.
- **Não** repeti findings de "falta Terraform/Lambda/canary via alias" — o próprio `render.yaml:41-44` cita um Regis P0 anterior já resolvido sobre yaml×dashboard, evidência de que o time trata a stack atual como legítima e não como transitória do alvo.
