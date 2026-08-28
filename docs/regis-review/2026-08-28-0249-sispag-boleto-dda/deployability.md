---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-deployability
generated_at: 2026-08-28T02:49:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

Este delta muda dois comportamentos do caminho de dinheiro do SISPAG: (a) `importarTitulos`
passa a mandar `titVldReflexoDdaAssoc: 1` para pedir associação DDA ao ERP, (b) o cliente
auto-responde `YES` para uma pergunta do ERP (`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`)
via protocolo de re-POST descoberto em HML. Ambos entram em produção **junto** com o `git push`
para `main` (Render auto-deploy + preDeploy migrations), sem toggle próprio; o único freio é o
kill-switch da frente (`SISPAG_LIVE_WRITE_ENABLED`, dashboard, `sync:false`).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge de PR em `main` com o commit `5978ac5` | Auto-deploy do Render é acionado; preDeploy roda `npm run migrate` (idempotente); tráfego só comuta se build+migrate sobrevivem; próxima janela do cron `ingest-sispag` (10 UTC) roda a nova versão | `src/backend/domain/client/ConexosSispagWriteClient.ts`, `RemessaService.ts`, `IngestaoPagamentosService.ts`, `SispagPainelService.ts`; nenhuma migration nova (`tem_boleto` já existia desde `0031`) | Produção Columbia, single-tenant, Postgres Supabase compartilhado | O novo caminho DDA fica atrás de `sispagLiveWriteEnabled && conexosWriteEnabled && !conexosDryRun` (`RemessaService.ts:186`); sem toggle por-comportamento; rollback = flip do kill-switch da frente inteira ou redeploy da versão anterior | Lead time commit→prd ≤ 10 min (Render); rollback do kill-switch < 1 min; rollback de código = redeploy manual da versão anterior; blast-radius do kill-switch = 100% das escritas SISPAG (não só DDA) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates de CI que cobrem o delta (BE) | 5 (typecheck, lint, `npm audit --audit-level=high`, `jest --coverage`, `npm run build`) | ≥5 | ✅ | `.github/workflows/ci.yml:20-27` |
| Gates de CI que cobrem o delta (FE) | 3 (typecheck, lint, `jest --coverage`) | ≥3 | ✅ | `.github/workflows/ci.yml:40-45` |
| Reprodutibilidade do build | `package-lock.json` commitado; CI usa `npm ci` | lockfile + `npm ci` | ✅ | `.github/workflows/ci.yml:21`; `render.yaml:18` |
| Migration adicionada neste delta | 0 (coluna `tem_boleto` já existia em `0031`) | evitar migração se possível | ✅ | `git diff 5978ac5^ 5978ac5 -- src/backend/migrations/` (vazio) |
| Kill-switch dedicado à frente SISPAG | `SISPAG_LIVE_WRITE_ENABLED` (`sync:false`, dashboard) | presente e flippable sem redeploy | ✅ | `render.yaml:32-38`; `RemessaService.ts:181-190` |
| Toggle por-comportamento para o novo caminho `associarDda` | ausente — associação DDA e auto-resposta entram com o mesmo binário | separar da flag da frente inteira | ⚠️ | `RemessaService.ts:466-478`; `ConexosSispagWriteClient.ts:551-568` |
| Backfill semântico do `titulo_a_pagar.tem_boleto` no deploy | ausente; correção acontece na próxima rodada do cron (07:00 BRT) | migração ou script explícito no runbook do go-live | ⚠️ | `RemessaService.ts` lê grid fresh, não a coluna → não é blocker; sondagem `sispag-boleto-dda-sondagem.md:145` |
| Artefatos de teste órfãos em HML após o delta | 1 (doc 452/1 no lote flp 24, fil 2, bnc 4) | 0 | ⚠️ | `ontology/_inbox/sispag-boleto-dda-sondagem.md:145`; probe `probe-dda-assoc-write-hml.ts:190-198` só cancela o lote do próprio run |
| Probes/sondas versionadas no `jobs/` | 7 arquivos novos, 1148 LOC (3 escrevem em HML) | mover para `scripts/investigation/` ou remover após uso | ⚠️ | `src/backend/jobs/probe-*.ts`; `tsconfig.json:23` (`include: ["**/*.ts"]` compila tudo) |
| CHANGELOG/DEPLOY.md atualizados com a mudança de semântica de `tem_boleto` | ausente | presente antes do go-live | ⚠️ | `head CHANGELOG.md` (topo é v0.31.0; este delta é v0.32.0-in-progress); `grep -n tem_boleto DEPLOY.md` (vazio) |
| Runbook de rollback do caminho DDA | ausente | presente (o que fazer se ERP mudar shape da pergunta) | ⚠️ | `ls docs/runbooks/` = `fin010-write-cutover.md`, `rotacao-segredos.md` |
| Presença de smoke/gate ao vivo contra ERP em CI | ausente por design (`SISPAG_LIVE_WRITE_ENABLED=false` no CI; probes rodadas à mão) | não medível localmente sem credenciais Conexos | ⚠️ **Não medível localmente** — depende de configurar CONEXOS_* + base HML e é decisão explícita não versionada | `.github/workflows/ci.yml` (sem step de smoke) |
| Custo extra de leitura por rodada de ingestão (deployability adjacent) | +1 leitura paginada por filial (fil 2 ≈ 5 páginas de 500) | ⚠️ **cross-QA Performance** — ver `performance.md` | ⚠️ | `IngestaoPagamentosService.ts:87` (`listarTitulosComBoletoDda`) |
| Lead time commit→prd (Render auto-deploy) | ⚠️ **não medível** neste repo — precisa do painel Render | ≤ 15 min | ⚠️ | `render.yaml:14 (autoDeploy: true)` |
| Deploy success rate (histórico Render) | ⚠️ **não medível localmente** — Render dashboard | ≥ 95% | ⚠️ | dashboard.render.com |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Manage Deployment Pipeline — Scale Rollouts** | Render `autoDeploy: true` da branch `main` para a única instância; sem canary, sem staged rollout (single-tenant Columbia, sem `dev`/`stg` separado); `preDeployCommand` roda migrations antes de comutar tráfego, mas comutação é all-or-nothing | ⚠️ parcial | `render.yaml:14, 21`; N/A canary — infra Render single-instance não expõe traffic-splitting |
| **Manage Deployment Pipeline — Roll Back** | (a) Flip de `SISPAG_LIVE_WRITE_ENABLED=false` no dashboard (sem redeploy, < 1 min) — mas **derruba TODO o SISPAG**, não só DDA; (b) rollback de código = "Redeploy previous" no Render + `git revert`; sem toggle por-comportamento p/ desligar só o novo caminho DDA | ⚠️ parcial | `render.yaml:32-38`; ausência de flag `associarDda` gated por env |
| **Manage Deployment Pipeline — Script Deployment Commands** | `preDeployCommand: npm run migrate && npm run seed:admin` idempotente; migrations passam por `schema_migrations` + advisory lock; healthcheck `/health` | ✅ presente | `render.yaml:21-23`; migrations com `IF NOT EXISTS` |
| **Manage Deployed System — Manage Service Interactions** | O caller do ERP é write-once (`postGenericOnce`, sem 401-retry); a resposta `QUESTION` é reconhecida em TODAS as chamadas dos dois clients; re-POST **só** quando a pergunta é a allowlistada e o envelope tem 1 pergunta só; e falha da segunda vira `ErpPerguntaError` (não vira laço) | ✅ presente | `ConexosSispagWriteClient.ts:551-568, 573-583`; ADR-0040 §"Por que auto-responder" |
| **Manage Deployed System — Package Dependencies** | `package.json` sem alteração neste delta; `package-lock.json` idem; deploy usa `npm ci` (determinístico); `npm audit --audit-level=high` no CI | ✅ presente | `git diff 5978ac5^ 5978ac5 -- src/backend/package.json` (vazio); `.github/workflows/ci.yml:22` |
| **Manage Deployed System — Feature Toggle** | Toggles pré-existentes (`SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_DRY_RUN`, `CONEXOS_WRITE_ENABLED`) protegem o novo caminho; **não há toggle por-comportamento** (`associarDda` ativa-se junto com a escrita geral do SISPAG) | ⚠️ parcial | `RemessaService.ts:181-190`; `render.yaml:32-38`; `EnvironmentProvider.ts:222` |
| **Idempotent Deploys** | Migrations idempotentes (`ADD COLUMN IF NOT EXISTS`); seed `seed:admin` idempotente; `preDeploy` só comuta se sucesso | ✅ presente | `migrations/0031_sispag_modalidade.sql:11`; `render.yaml:21` |
| **Reproducible Build** | Lockfile commitado; `npm ci` em CI/CD; TypeScript `^` mas fixado pelo lockfile; sem timestamps injetados em código | ✅ presente | `src/backend/package-lock.json`; `render.yaml:18` |
| **Drift Detection (config vs. dashboard)** | Segredos e switches operacionais estão como `sync:false` no `render.yaml` — dashboard é fonte da verdade e o blueprint não sobrescreve; sem scan automatizado, mas o padrão evita o modelo "yaml vs dashboard brigando" (P0 antigo do próprio time — ver comentário `render.yaml:56-58`) | ✅ presente | `render.yaml:33, 45, 56-58` (histórico do próprio Regis) |
| **Deployment Observability** | Healthcheck `/health` retorna `version` (verificável pós-deploy); logs de deploy no Render dashboard; sem alerta automático para regressão pós-deploy | ⚠️ parcial | `render.yaml:24 (healthCheckPath: /health)`; docs anteriores citam `/health` com `version` de `package.json` |
| **Blast Radius Limit / Physical & Logical Grouping** | Cron do SISPAG usa `concurrency.group: ingest-sispag` (impede duas rodadas simultâneas); reaper em `reaper-sispag.yml` isolado; deploy é único (single-tenant), então grouping físico é N/A — mas o kill-switch por frente evita afetar Permutas/Recebimentos ao conter um bug do SISPAG | ✅ presente | `.github/workflows/ingest-sispag.yml:24-26`; `EnvironmentVars.ts:100-116` |
| **Package Deployment Automation (frontend)** | Frontend na Vercel (auto-deploy de `main`); `feature.SispagPainelDdaFeature` (flag do FE?) — **não encontrado**: `isSispagEnabled()` é a única gate no `page.tsx` | ⚠️ parcial | `src/frontend/app/sispag/page.tsx:31 (isSispagEnabled)`; sem flag por-frente para a coluna "Boleto" nova |
| **Tag Release / Version Traceability** | Job `tag-release` no CI cria tag `v${package.json.version}` de forma idempotente (`v0.31.0` já criada em `main`) | ✅ presente | `.github/workflows/ci.yml:53-79` |

## 4. Findings

### F-deployability-1: Novo caminho DDA (associação + auto-resposta) sem toggle por-comportamento — rollback só existe no nível da frente inteira

- **Severidade**: P1
- **Tactic violada**: Feature Toggle; Roll Back
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:466-478` (loop `for associarDda of [false, true]`), `src/backend/domain/client/ConexosSispagWriteClient.ts:513-521, 551-568` (envio de `titVldReflexoDdaAssoc:1` e re-POST com `answers`)
- **Evidência (objetiva)**:
  ```
  // RemessaService.ts:181-190 — o único gate deste delta em prd:
  const writeEnabled = env.conexosWriteEnabled;
  const dryRun = !writeEnabled || !env.sispagLiveWriteEnabled || env.conexosDryRun || ...;

  // RemessaService.ts:875-878 — comportamento novo, sem gate próprio:
  const associarDda = item.modalidade === MODALIDADE.BOLETO && pendente.temBoletoDda;
  if (item.modalidade === MODALIDADE.BOLETO && !pendente.temBoletoDda) {
      throw new BoletoSemCodigoBarrasError({ ... });
  }

  // ConexosSispagWriteClient.ts:551-568 — auto-resposta sem gate próprio:
  const idPergunta = this.perguntaAutoRespondivel(cause);
  if (idPergunta === undefined) throw this.toConexosError(path, cause);
  await this.base.postGenericOnce(path, { ...body, answers: { [idPergunta]: 'YES' } }, ...);
  ```
- **Impacto técnico**: se o ERP mudar o shape da pergunta `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`, o `id`/`key`, ou o `answerList` (ex.: nova opção obrigatória), o único jeito de conter o dano em produção é (a) `SISPAG_LIVE_WRITE_ENABLED=false` — que derruba **100%** das escritas SISPAG (remessa E conciliação), afetando pagamentos que não têm nada com boleto DDA, ou (b) redeploy da versão anterior (Render "Redeploy previous"), que sobe todas as outras correções junto. Não há middle-ground que desligue só o caminho DDA e continue processando PIX/TED.
- **Impacto de negócio**: um bug do novo caminho DDA para os primeiros lotes reais interrompe o SISPAG inteiro por decisão de contenção, e não só a fatia BOLETO. Empurra o operador a decidir "quebro o SLA da remessa não-boleto para conter DDA?" — decisão que uma flag resolveria em 30 segundos no dashboard.
- **Métrica de baseline**: blast-radius do kill-switch atual = 100% das escritas SISPAG (remessa + conciliação); % dos itens de lote que seguem o novo caminho DDA = frações medidas em `sispag-boleto-dda-sondagem.md` (54/173 fil 1, 136/500 fil 2, 24/500 fil 4, 152/500 fil 6 = **31%–35% dos itens** têm `titVldReflexoDdaAssoc:1`).

### F-deployability-2: Semântica de `titulo_a_pagar.tem_boleto` mudou sem migration de backfill nem step explícito no procedimento de deploy

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:148` (nova fonte da coluna); `src/backend/migrations/0031_sispag_modalidade.sql:11` (coluna que muda de fonte); `ontology/decisions/0040-boleto-sispag-vem-da-associacao-dda-do-erp.md:79-82` (a mudança está declarada mas sem plano de deploy)
- **Evidência (objetiva)**:
  ```
  # git diff 5978ac5^ 5978ac5 -- src/backend/migrations/  → vazio (nenhuma migration)

  # antes (removido): temBoleto = Boolean(fin064.titEspCodbar)  → sempre false (0% na PRD)
  # agora: temBoleto = s.value.comBoleto.has(`${filCod}:${docCod}:${titCod}`)
  # onde comBoleto vem de listarTitulosComBoletoDda (grid fin015, flag titVldReflexoDdaAssoc)
  ```
- **Impacto técnico**: entre o `deploy` e a próxima rodada do cron (07:00 BRT), `titulo_a_pagar.tem_boleto` mantém os valores da semântica antiga (todos `false`, porque `titEspCodbar` era 100% null). O caminho crítico não regride — `RemessaService` lê o grid fresco (`titulosPendentes`) para `pendente.temBoletoDda`, não a coluna persistida, e o `SispagPainelService` novo também lê fresh (`listarTitulosComBoletoDda`) — mas se algum consumer novo/legado passar a ler `titulo_a_pagar.tem_boleto` como fonte de verdade, verá 100% `false` até a primeira rodada. Se o deploy cair fora do horário do cron (ex.: sexta 18h), a coluna carrega o valor errado por ~13 horas.
- **Impacto de negócio**: consulta ad-hoc / painel administrativo / relatório sobre `titulo_a_pagar` mostra 0% de boletos até o cron rodar — pode induzir a operador a achar que a feature "não subiu". Não é bloqueio operacional; é hygiene de release.
- **Métrica de baseline**: janela de inconsistência = tempo entre deploy e primeira rodada do cron `ingest-sispag` = até 24h no pior caso (cron 1×/dia às 10 UTC). Consumers atuais da coluna `tem_boleto`: 3 (`upsertMany`, `select` do próprio repo, `SispagPainelService`); nenhum é caminho crítico após esta refatoração — mas ninguém documentou isso.

### F-deployability-3: Artefato de teste (`lote flp 24`, `doc 452/1`) deixado no ERP-HML sem procedimento documentado de limpeza

- **Severidade**: P3
- **Tactic violada**: Manage Service Interactions (higiene de ambientes)
- **Localização**: `ontology/_inbox/sispag-boleto-dda-sondagem.md:145` (declaração explícita); `src/backend/jobs/probe-dda-assoc-write-hml.ts:190-198` (o próprio probe cancela o lote do run, mas o item importado antes do lote ser marcado como `loteCriado` fica órfão se cair no meio)
- **Evidência (objetiva)**:
  ```
  # sondagem.md:145
  - ⚠️ Deixado em HML: item doc 452/1 importado no lote de teste `flp 24` (fil 2, bnc 4).

  # probe-dda-assoc-write-hml.ts:190-198 — só limpa se o próprio probe do run criou
  if (loteCriado && process.env.MANTER_LOTE !== '1') {
      await base.putGenericOnce(`fin015/cancelar/${FIL}/4/${flpCod}`, {}, { filCod: FIL });
  }
  ```
- **Impacto técnico**: dado inconsistente em HML polui probes futuras (o item aparece na próxima leitura do grid), aumenta o risco de que a próxima sondagem confunda "estado do sistema" com "resíduo de teste anterior". Não afeta produção; afeta a confiabilidade dos dados de validação usados como base para próximas features.
- **Impacto de negócio**: nenhum imediato (HML). Longo prazo: cada probe deixa resíduo → HML deriva de PRD → decisões baseadas em HML ficam menos confiáveis (o próprio ADR-0040 se apoia em 2 testes de escrita em HML).
- **Métrica de baseline**: 1 item órfão medido; sem procedimento documentado para higienizar; sem cron/script de "reaper de HML".

### F-deployability-4: 7 sondas versionadas em `src/backend/jobs/` (1148 LOC) são compiladas no artefato de deploy e não têm política de retirada

- **Severidade**: P3
- **Tactic violada**: Package Dependencies (bloat do artefato); Manage Service Interactions (superfície de invocação acidental)
- **Localização**: `src/backend/jobs/probe-boleto-fonte.ts`, `probe-com308-codbar.ts`, `probe-dda-answer-shape-hml.ts`, `probe-dda-assoc-write-hml.ts`, `probe-dda-associado-hml.ts`, `probe-fin015-boleto-vinculo.ts`, `probe-fin124-dda.ts`; `src/backend/tsconfig.json:23` (`include: ["**/*.ts"]` sem exclusão de `jobs/probe-*.ts`)
- **Evidência (objetiva)**:
  ```
  # git diff --stat: 7 arquivos, 1148 LOC de sondas (das quais 3 escrevem em HML)
  # tsconfig.json inclui **/*.ts sem exclude — probes vão para dist/
  # o guard das que escrevem é substring do env: if (!BASE.includes('-hml')) exit(1)
  ```
- **Impacto técnico**: o bundle carregado no Render inclui esses arquivos (build por `tsc`, sem tree-shake); qualquer variável de ambiente com "-hml" no meio do host (ex.: um cliente futuro `xyz-hml.conexos.cloud`) satisfaz o guard das probes de escrita. O guard é acidentalmente permissivo. Também, essas probes já provaram o que precisavam provar (ADR-0040) — mantê-las commitadas incentiva reuso não-cerimonial em vez de re-derivação com base atual.
- **Impacto de negócio**: nenhum imediato; risco latente de execução acidental de escrita em ambiente errado (HML de outro cliente) por operador que confunde "probe é seguro porque tem guard".
- **Métrica de baseline**: 7 arquivos, 1148 LOC no artefato de deploy sem função em runtime; guard baseado em `String.prototype.includes('-hml')` (falso-positivo para qualquer URL contendo "-hml").

### F-deployability-5: Sem entrada no CHANGELOG e sem runbook de rollback para o novo caminho DDA / auto-resposta ao ERP

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (documentação operacional do deploy)
- **Localização**: `CHANGELOG.md` (topo é `v0.31.0`, sem entrada para o commit `5978ac5`); `docs/runbooks/` (só existem `fin010-write-cutover.md` e `rotacao-segredos.md`)
- **Evidência (objetiva)**:
  ```
  # head -3 CHANGELOG.md
  # Columbia Financeiro — Changelog
  ## v0.31.0 (2026-08-25) — retomar de onde parou, sem correção manual no Conexos
  # (nenhuma entrada v0.32 para este delta)

  # ls docs/runbooks/
  fin010-write-cutover.md   # runbook do go-live da escrita fin010 (Frente IV)
  rotacao-segredos.md
  # sem "sispag-boleto-dda-cutover.md" nem equivalente
  ```
- **Impacto técnico**: em incidente, o operador na madrugada não tem playbook para "o ERP começou a devolver a pergunta com `key` diferente" ou "o `.REM` está saindo com segmento J vazio de novo". A doutrina existe no ADR-0040 (`## Pendências` §Go-live: "a primeira remessa real com boleto deve ser acompanhada") mas não está no formato de runbook (o que fazer, em que ordem, quem chamar).
- **Impacto de negócio**: MTTR estendido em incidente durante o go-live; risco de decisão errada sob pressão (ex.: `git revert` de commit com 29 arquivos vs. flip de `SISPAG_LIVE_WRITE_ENABLED=false`).
- **Métrica de baseline**: 0 runbooks para o cutover deste delta; ADR-0040 explicitamente declara pendência "acompanhar a primeira remessa real com boleto" sem procedimento associado.

## 5. Cards Kanban

### [deployability-1] Adicionar toggle por-comportamento para o caminho de associação DDA

- **Problema**
  > O novo caminho DDA (associação + auto-resposta à pergunta do ERP) entra em produção junto com o binário e não tem gate próprio. Um bug específico do DDA — ex.: ERP muda o shape da pergunta ou o encoding do `answers` — só pode ser contido matando 100% das escritas SISPAG (`SISPAG_LIVE_WRITE_ENABLED=false`), que derruba também remessa PIX/TED e conciliação de retorno. Blast-radius desproporcional ao escopo real do defeito.

- **Melhoria Proposta**
  > Introduzir `SISPAG_DDA_ASSOC_ENABLED` (default `true` para preservar o comportamento novo depois de validado) em `EnvironmentProvider`. Em `RemessaService.montarItensImport` (linha 875), curto-circuitar para `associarDda = false` quando desligado — o `BoletoSemCodigoBarrasError` continua barrando envio, o operador entende que precisa preencher o boleto à mão como antes. Render `sync:false` para flippar no dashboard sem redeploy. Runbook em `docs/runbooks/` com o gatilho: "se `ErpPerguntaError` com `key=FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` aparecer em >1 lote, desligar por 24h".

- **Resultado Esperado**
  > Rollback do caminho DDA sem afetar PIX/TED/conciliação. Blast-radius de contenção: 100% SISPAG → apenas a fatia BOLETO com DDA (~31–35% dos itens em produção).

- **Tactic alvo**: Feature Toggle (Bass)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1, F-deployability-5
- **Métricas de sucesso**:
  - Blast-radius de rollback do DDA: 100% SISPAG → ~35% dos itens (só BOLETO com `titVldReflexoDdaAssoc:1`)
  - Tempo para conter incidente DDA: `flip dashboard` (<1 min) em vez de `redeploy versão anterior` (5–10 min)
- **Risco de não fazer**: no primeiro incidente ligado à pergunta do ERP, o operador escolhe entre parar a folha de pagamentos inteira ou reverter binário (o commit é grande, `git revert` traz reversão indesejada de fixes concorrentes).
- **Dependências**: nenhuma

### [deployability-2] Documentar mudança de semântica de `tem_boleto` no CHANGELOG e no procedimento de deploy

- **Problema**
  > `titulo_a_pagar.tem_boleto` mudou de fonte (`titEspCodbar` sempre-false → flag DDA do grid), sem migration de backfill nem menção em `DEPLOY.md`/`CHANGELOG.md`. Entre o deploy e a próxima rodada do cron (`ingest-sispag`, 1×/dia às 10 UTC), a coluna carrega valores da semântica antiga (todos `false`). Nenhum caminho crítico depende dela após o refactor — mas ninguém documentou isso, e uma consulta ad-hoc/painel mostrando "0% de boletos" pós-deploy é confundível com "feature não subiu".

- **Melhoria Proposta**
  > (a) Adicionar entrada no `CHANGELOG.md` para v0.32.0 explicitando "sem migration; `tem_boleto` corrige-se sozinho na primeira rodada de `ingest-sispag` pós-deploy". (b) Adicionar step opcional no procedimento de deploy: `npm run job:ingest-pagamentos` disparado à mão logo após o deploy para eliminar a janela de inconsistência. (c) Comentário no `TituloAPagarRepository` avisando que `tem_boleto` é enriquecimento eventualmente-consistente, não fonte de verdade para o envio.

- **Resultado Esperado**
  > Janela de inconsistência entre deploy e primeira rodada: 24h → 0 (com step manual) ou continua 24h mas explícito no CHANGELOG (documentação suficiente).

- **Tactic alvo**: Script Deployment Commands (Bass)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Entrada no CHANGELOG v0.32 mencionando "sem migration + janela de reconvergência": presente ✅
  - Step "após deploy, rodar `npm run job:ingest-pagamentos` uma vez" documentado em `DEPLOY.md`: presente ✅
- **Risco de não fazer**: dúvida operacional recorrente ("por que o painel mostra 0 boletos depois do deploy?") — desperdício pequeno mas repetido.
- **Dependências**: nenhuma

### [deployability-3] Runbook de cutover para o caminho DDA (primeiro go-live real)

- **Problema**
  > O ADR-0040 declara na seção "Pendências / Go-live" que "a primeira remessa real com boleto deve ser acompanhada", mas não há runbook em `docs/runbooks/` com o procedimento: o que verificar no `.REM` gerado, o que fazer se aparecer `ErpPerguntaError`, quando escalar. Já existe runbook para `fin010-write-cutover.md` (Frente IV) — o padrão de escrita irreversível é o mesmo e o formato é replicável.

- **Melhoria Proposta**
  > Criar `docs/runbooks/sispag-boleto-dda-cutover.md` seguindo o formato do `fin010-write-cutover.md`: pré-condições (`SISPAG_LIVE_WRITE_ENABLED=true` no dashboard, primeira remessa monitorada), verificação (baixar o `.REM` gerado e checar segmento J com barras), kill-switch (`SISPAG_LIVE_WRITE_ENABLED=false` e/ou o toggle proposto no card 1), quem chamar (Yuri + Flávia).

- **Resultado Esperado**
  > Operador em incidente durante o go-live tem playbook escrito. MTTR de decisão < 5 min (achou a página do runbook e sabe o que fazer).

- **Tactic alvo**: Script Deployment Commands (Bass)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-5, F-deployability-1
- **Métricas de sucesso**:
  - Runbook presente e linkado do ADR-0040 (`## Pendências → Go-live`): ✅
  - Kill-switch da frente e o toggle novo (do card 1) documentados com comando exato: ✅
- **Risco de não fazer**: primeiro incidente do DDA em produção vira decisão improvisada; risco de escolher rollback errado (ex.: `git revert` do commit inteiro em vez de flip do env).
- **Dependências**: `deployability-1` (toggle por-comportamento) para o runbook citar o comando certo — mas o runbook pode subir referenciando só o kill-switch da frente enquanto o toggle não existe.

### [deployability-4] Extrair sondas do `jobs/` e endurecer o guard de HML

- **Problema**
  > 7 probes (1148 LOC) versionadas em `src/backend/jobs/probe-*.ts` são compiladas para `dist/` no deploy (o `tsconfig.json` inclui `**/*.ts` sem exclusão). 3 delas escrevem em HML com guard `if (!BASE.includes('-hml'))` — substring que aceita qualquer URL contendo `-hml` (ex.: `client-hml-prd.example.com` passaria). As probes já cumpriram seu papel (fundamentaram o ADR-0040); mantê-las incentiva reuso não-cerimonial.

- **Melhoria Proposta**
  > (a) Mover `probe-*.ts` para `scripts/investigation/` (fora do `src/`) ou adicionar `exclude: ["jobs/probe-*.ts"]` no `tsconfig.json` para o build; (b) endurecer o guard para hostname exato: `new URL(BASE).hostname === 'columbiatrading-hml.conexos.cloud'` em vez de `includes('-hml')`; (c) política escrita: "probe read-only pode ficar; probe de escrita é apagada depois do ADR que a citou".

- **Resultado Esperado**
  > Artefato de deploy sem sondas (1148 LOC removidas do `dist/`); guard de escrita HML não-permissivo (falha para hostname que só *contenha* "-hml").

- **Tactic alvo**: Package Dependencies + Manage Service Interactions (Bass)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - LOC de sondas no artefato de deploy: 1148 → 0
  - Guard HML: substring includes → hostname exato
- **Risco de não fazer**: baixo — mas cresce à medida que a Kavex atende mais clientes (`-hml` só é seguro num mundo single-tenant).
- **Dependências**: cross-QA com Security (`security.md`) — o mesmo guard reaparece lá.

### [deployability-5] Limpar artefato de teste `flp 24 / doc 452/1` no HML e adotar reaper HML

- **Problema**
  > A sondagem 2026-08-27 (`sispag-boleto-dda-sondagem.md:145`) declara: "⚠️ Deixado em HML: item doc 452/1 importado no lote de teste flp 24 (fil 2, bnc 4)". O probe cancela o lote do próprio run, mas se o run cair antes de setar `loteCriado = true`, o item fica órfão. Sem procedimento documentado para higienizar HML entre iterações de sondagem.

- **Melhoria Proposta**
  > (a) Cancelar `flp 24` da fil 2 em HML à mão agora (custo: 1 chamada); (b) adicionar ao `probe-dda-assoc-write-hml.ts` cleanup em `finally`, não em fluxo linear; (c) documentar em `docs/runbooks/` (ou seção do próprio probe) "como limpar resíduo de probe em HML".

- **Resultado Esperado**
  > Itens órfãos em HML após probes: 1 → 0. Próxima sondagem parte de estado limpo.

- **Tactic alvo**: Manage Service Interactions (Bass)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Órfãos em HML mapeados: 1 → 0
  - Cleanup dos probes de escrita em `try/finally`: presente ✅
- **Risco de não fazer**: HML deriva de PRD; probes futuras confundem "estado do sistema" com "resíduo".
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo respeitado**: nenhum finding contra ausência de `infra/`/Terraform (é roadmap conhecido, não achado deste delta); nenhum contra ausência de canary (single-tenant Render — tactic marcada `parcial` com justificativa, não `ausente`); nenhum contra a auto-resposta em si (a doutrina do time — ADR-0040 §"Por que auto-responder" — cobre a decisão de forma defensável, allowlist de 1 chave).
- **Métricas não-medíveis**: lead time real, deploy success rate e MTTR histórico não são medíveis sem acesso ao painel Render; declarei explicitamente na tabela §2.
- **Cross-QA para o consolidator**:
  - **Performance**: `IngestaoPagamentosService` ganhou +1 leitura paginada por filial (`listarTitulosComBoletoDda` → `listarLotesNativos` + `listarTitulosPendentes` até 5 páginas de 500 na fil 2). O flag de deployability aqui é o custo do cron; o dono do impacto é Performance.
  - **Fault-tolerance**: o `titulosComBoletoDda` degrada para `Set` vazio + `BUSINESS_WARN` em falha — política acertada, mas ninguém alerta sobre "N filiais degradadas por M dias" (silent degradation). Belongs to `fault-tolerance.md`.
  - **Security**: guard HML por `includes('-hml')` reaparece como potencial escrita em ambiente errado; card `deployability-4` alinha com finding de Security.
- **O que não foi feito** (por `--quick`): não rodei `npm run build` para medir bundle size real; não rodei `npm audit` profundo; não consultei o painel Render nem CloudWatch.
