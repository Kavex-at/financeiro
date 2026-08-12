---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-12-1315
agent: qa-deployability
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev merge do PR `fix/nde-descricao-item` em `main` | `git push origin main` dispara CI + Render autoDeploy | `src/backend` (Express monolito) rodando no Render, integrando com Conexos ERP (com297) | Produção Columbia — Frente IV LIVE (`RECEBIMENTOS_ENABLED` implícito ON), com escrita REAL (`CONEXOS_WRITE_ENABLED=true`, `DRY_RUN=false`) | Deploy sobe **sem passo manual prévio**: sem migration, sem env nova obrigatória, sem toggle no dashboard. A nova `etapaDescricaoItem` é no-op para clientes com cadastro compatível e conserta os demais no primeiro `Recebimento` a passar. Falha de ACL vira 403 fail-closed **antes** da homologação (irreversível). Rollback é o botão "Redeploy previous" do Render — não desfaz o `PUT com297/comDocProdutos` já executado, mas o texto gravado é byte-a-byte o mesmo do workaround manual, então o passivo é cosmeticamente inerte. | Lead time commit→prd < 10 min · 0 passos manuais de infra · 0 novos secrets · rollback safe (nenhuma perda de dado, nenhuma NDe homologada em risco) · blast radius = 1 etapa dentro do fluxo `executarRecebimento` |

Interpretação: o delta é *deploy-neutral* — a arquitetura da pilha (Render autoDeploy + `preDeployCommand` de migração + kill switch por env) absorve a mudança sem exigir coreografia. O único débito real é operacional: a ACL nova ("alteração de item em com297") não está no runbook.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos manuais entre `git push` e prod | 0 (autoDeploy + preDeploy migração) | 0 | ✅ | `render.yaml:17,21` |
| Migrations no delta | 0 (deliberado — idempotência é pelo estado do documento) | 0 ou N safely-forward | ✅ | `git diff main --stat` — nenhum arquivo em `src/backend/db/migrations/` |
| Envs novas OBRIGATÓRIAS em prod pré-deploy | 0 (`NDE_DESCRICAO_ITEM_FALLBACK` é opcional; ausente = comportamento default correto) | 0 | ✅ | `EnvironmentProvider.ts:178,237` (`|| undefined`) + ADR-0036 §"Decisão" |
| Envs novas OPCIONAIS | 1 (`NDE_DESCRICAO_ITEM_FALLBACK`) | ≤ deploy pode ir sem ela | ✅ | `EnvironmentVars.ts:133-143` |
| Novos pré-requisitos operacionais no ERP | 1 — ACL "alteração de item em com297" (`PUT comDocProdutos`) | Documentado no runbook antes do merge | ⚠️ | ADR-0036 §Consequências §4; ausente em `docs/runbooks/*.md` e `docs/e2e/producao-runbook-primeira-execucao.md` |
| Feature flag / kill-switch por etapa | 0 dedicado (ride em `RECEBIMENTOS_ENABLED` + `CONEXOS_WRITE_ENABLED`/`DRY_RUN`) | 1 por etapa recém-introduzida | ⚠️ | `RecebimentoNumerarioService.ts:453-455` (chamada incondicional) |
| Rollback path documentado no delta | 0 (ADR fala de idempotência, não de reversão) | Parágrafo curto no ADR-0036 | ⚠️ | `0036-descricao-item-nde-no-documento.md` (nenhuma menção a rollback) |
| Blast radius do rollback | Nenhuma NDe homologada em risco; `PUT com297.dprLngDescrNf` permanece após revert, mas o texto ≡ workaround manual | Não introduzir passivo fiscal | ✅ | ADR-0036 §Consequências §5 + inbox §"Texto de fallback" |
| CI gates rodando no delta | typecheck ✅ · lint ✅ (0 novos warnings) · testes 1132/1132 no delta ✅ · build ✅ · `npm audit --audit-level=high` ✅ | Todos verdes | ✅ | `_shared-metrics.md` + `.github/workflows/ci.yml:23-28` |
| Coupling deploy ↔ dashboard Render | `NDE_DESCRICAO_ITEM_FALLBACK` **não** adicionada ao `render.yaml` (fica sob demanda no dashboard, se um dia o fiscal quiser) | Não deixar o yaml brigar com o dashboard | ✅ | `render.yaml` (delta = 0) |
| Idempotência pós-rollback de execuções já corrigidas | 100% — retomada em `obs-done` pula a etapa se `dprLngDescrNf` já não-vazia | 100% | ✅ | `RecebimentoNumerarioService.ts:1483` (`if (item.dprLngDescrNf !== undefined) continue`) |

> ⚠️ **Não medível localmente**: tempo real de build+deploy no Render, taxa histórica de sucesso de deploy, MTTR de rollback. Requer acesso ao dashboard Render e à API de deployments. Recomendação: exportar a métrica de duração média de deploy via Render API para o próximo `regis-review`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Render `web` sem canary; deploy é "all-in-one". O delta é auto-canary de fato: a etapa é no-op para a maioria dos clientes; apenas os clientes com `cmn025.dpeVld1DescrNfe=4` exercitam a lógica nova, um `Recebimento` por vez. | ⚠️ parcial (herdado do stack) | `render.yaml:6-9`; ADR-0036 §Consequências §1 |
| Rollback | Render nativo ("Rollback deploy" via dashboard). O delta não adiciona migração nem quebra o contrato de dados → rollback é seguro. **Não** existe rollback dos `PUT com297` já executados (por design: gravar `prdDesNome` no `dprLngDescrNf` é o workaround manual codificado, então não há o que estornar). | ✅ presente para código; ✅ N/A para dado (por design) | `render.yaml:17`; ADR-0036 §Consequências §5; inbox §Texto de fallback |
| Script Deployment Commands | `render.yaml` versionado + `preDeployCommand: npm run migrate && npm run seed:admin` roda migrações antes de aceitar tráfego (commit 228609a estabelece este contrato). | ✅ presente | `render.yaml:21` |
| Logical Grouping | Backend Express monolito; a nova etapa vive em `RecebimentoNumerarioService.etapaDescricaoItem` — mesma unidade de deploy do resto do fluxo. | ✅ presente | `RecebimentoNumerarioService.ts:1428-1488` |
| Physical Grouping | 1 processo Render (`financeiro-backend`); crons no GitHub Actions. Delta não altera topologia. | ✅ presente | `render.yaml:6`; `.github/workflows/ingest-*.yml` |
| Package Dependencies | Nenhuma dep nova (`git diff main -- src/backend/package.json` = 0). Lockfile `package-lock.json` presente; `npm ci` obrigatório no CI. | ✅ presente | `.github/workflows/ci.yml:23`; delta sem `package.json` |
| Surge Protection | Ingestão externa (Nexxera + Conexos `fin095`) já protegida por advisory-lock (`RECEBIMENTO_INGEST_LOCK_KEY`) e concurrency-group do workflow. A `etapaDescricaoItem` só roda dentro de uma execução manual de recebimento (não é uma nova superfície de tráfego). | ✅ presente | `.github/workflows/ingest-extratos.yml:29-32` |
| Idempotent deploys | `preDeployCommand` roda migração idempotente; sem migration no delta, sem risco. Auto-idempotência da nova etapa é pelo estado do documento (`if dprLngDescrNf !== undefined continue`). | ✅ presente | `RecebimentoNumerarioService.ts:1481` |
| Drift detection | Ausente. Não há job comparando `render.yaml` × dashboard, nem detector de drift no estado do ERP para NDes já corrigidas. | ❌ ausente | `git ls-files .github/workflows/ | xargs grep -l drift` (vazio) |
| Reproducible builds | `npm ci` no CI, `package-lock.json` versionado, sem timestamps em build. Delta não regride. | ✅ presente | `.github/workflows/ci.yml:23` |
| Per-tenant blast-radius limit | Single-tenant Columbia hoje; N/A. A etapa nova respeita a granularidade por-documento (que é o limite fino disponível dentro do tenant). | N/A | CLAUDE.md §Tenants ("vazio") |
| Deployment observability | Logs `BUSINESS_WARN` na gravação (`descricaoGravada`, `descricaoEco`) e na ausência de linha; sem `deploy_id` correlacionando eventos pós-release. | ⚠️ parcial | `RecebimentoNumerarioService.ts:1466-1497` |
| Feature flags para módulos arriscados | `RECEBIMENTOS_ENABLED` (kill switch da frente inteira) + `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN` (gate global de escrita). **Nenhum toggle específico** da nova etapa. | ⚠️ parcial | `render.yaml:39-55`; `RecebimentoNumerarioService.ts:453` (chamada incondicional dentro do write path) |

## 4. Findings (achados)

### F-deployability-1: ACL nova ("alteração de item em com297") é pré-requisito operacional silencioso — ausente em runbook e não coberta pelo `NumerarioAclChecker`

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (o "script" inclui pré-requisitos do ambiente-alvo, não só o código)
- **Localização**: `ontology/decisions/0036-descricao-item-nde-no-documento.md:72-74` (declara a exigência), `src/backend/domain/service/recebimentos/NumerarioAclChecker.ts:19-24` (não valida), `docs/runbooks/fin010-write-cutover.md` (não menciona), `docs/e2e/producao-runbook-primeira-execucao.md` (não menciona)
- **Evidência (objetiva)**:
  ```
  ADR-0036 §Consequências: "Novo ponto de escrita no ERP (`PUT com297/comDocProdutos`) —
  a conta de serviço precisa da ação de alteração de item em com297."

  NumerarioAclChecker.ts:19-24
  const ACL_REQUERIDAS: readonly string[] = [
      'com300', // UPDATE fiscal
      'com131', // GERAR OBS
      'com297', // HOMOLOGAR / HOMOLOGAR CONTINGENCIA
      'com194', // SELECT validações
  ];
  ```
  A substring "com297" já casa qualquer permissão contendo o tela — não distingue "HOMOLOGAR" de "ALTERAR ITEM". O preflight passa; o `PUT comDocProdutos` de verdade recebe 403 do ERP.
- **Impacto técnico**: Se a conta de serviço não tiver o grant de alteração de item no `com297`, o primeiro `Recebimento` de cliente com `dpeVld1DescrNfe=4` falha na etapa `descricao-item` com o 403 cru do ERP. Fail-closed **antes** da homologação (portanto sem passivo fiscal), mas o operador diagnostica no escuro — o log é o 403 genérico, o mapeamento "403 aqui = ACL faltando" está só no ADR.
- **Impacto de negócio**: Suporte reativo em vez de proativo; janela de horas até o time reconhecer o motivo. Uma NDe travada em `nota-debito` é uma cobrança que não sai — pressiona o SLA da Frente IV recém-lançada.
- **Métrica de baseline**: 1 pré-requisito operacional documentado apenas no ADR (0 no runbook, 0 no preflight granular).

### F-deployability-2: Nenhum kill-switch específico da etapa `descricao-item` — se ela regredir em prod, a única contenção é derrubar a frente inteira

- **Severidade**: P3
- **Tactic violada**: Feature flags para módulos arriscados
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:453-455`
- **Evidência (objetiva)**:
  ```typescript
  ndDocCod = await this.etapaNotaDebito(ctx, existente, ndDocCod);
  etapa = 'nota-debito';
  // 3.5 — garante a descrição de impressão do item ANTES da leg fiscal.
  await this.etapaDescricaoItem(ctx, existente, ndDocCod);
  await this.etapaFiscal(ctx, existente, ndDocCod);
  ```
  A chamada é incondicional; não há `if (env.ndeDescricaoItemEnabled)`. Para desabilitar apenas essa etapa em produção sem rollback de código, o operador teria que derrubar `RECEBIMENTOS_ENABLED` (afeta a frente inteira) ou virar `CONEXOS_DRY_RUN=true` (interrompe TODA escrita).
- **Impacto técnico**: MTTR maior num cenário "etapa mata a nota, resto está sadio" — o remédio disponível hoje é redeploy do commit anterior. Não é catastrófico (rollback é minutos), mas é um degrau a mais que P1 costuma resolver com um toggle no dashboard.
- **Impacto de negócio**: Downtime da Frente IV inteira por 5–15 min se o único remédio for kill switch global. Aceitável hoje (baixo volume), doloroso quando a Frente escalar.
- **Métrica de baseline**: 0 flags específicas da etapa nova; 1 flag global de kill-switch (que afeta 100% da frente).

### F-deployability-3: Rollback semântico não documentado — ninguém escreveu o que acontece com os `PUT com297.dprLngDescrNf` já executados quando a versão é revertida

- **Severidade**: P3
- **Tactic violada**: Rollback
- **Localização**: `ontology/decisions/0036-descricao-item-nde-no-documento.md` (ausência de seção)
- **Evidência (objetiva)**:
  ```
  ADR-0036: 83 linhas, 0 menções à palavra "rollback" ou "reverter".
  ```
  A propriedade "o texto gravado é byte-a-byte o workaround manual" está no `_inbox/nde-descricao-produto-nfe-diagnostico.md` §"Texto de fallback", não no ADR. Ninguém em plantão fim-de-semana, olhando só o ADR, sabe que rollback é seguro.
- **Impacto técnico**: Hesitação para acionar rollback em plantão → decisões piores. O rollback em si é seguro; falta a linha "o que acontece com NDe já emitida se voltarmos ao commit anterior" para o time confiar sem consultar quem escreveu.
- **Impacto de negócio**: MTTR alongado por incerteza — o dev de plantão liga para o autor da mudança em vez de agir.
- **Métrica de baseline**: 0 linhas sobre rollback no ADR do delta.

### F-deployability-4: Sem drift-detection entre `render.yaml` e envs setadas no dashboard — envs "sync:false" ficam sem trilha de auditoria

- **Severidade**: P3
- **Tactic violada**: Drift detection
- **Localização**: `render.yaml:39-72` (10 envs em `sync:false`); ausência de job comparador
- **Evidência (objetiva)**:
  ```
  render.yaml — envs sync:false: RECEBIMENTOS_ENABLED, CONEXOS_BASE_URL,
  CONEXOS_WRITE_ENABLED, CONEXOS_DRY_RUN, databaseConnectionString,
  AUTH_JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, ALLOWED_ORIGINS,
  CONEXOS_USERNAME, CONEXOS_PASSWORD, CONEXOS_FIL_COD.
  ```
  Nada no repo consegue detectar se alguém trocou `CONEXOS_DRY_RUN` para `true` no dashboard sem avisar — a única detecção é uma NDe que não emite e um dev que percebe.
- **Impacto técnico**: Deriva silenciosa entre "o que o time acha que está em produção" e "o que está em produção". Relevante especialmente porque o delta NÃO altera esse pool, mas convive com ele.
- **Impacto de negócio**: Incidentes por configuração — a mais lenta de todas as classes de bug de encontrar. Baixa frequência, alta variância.
- **Métrica de baseline**: 12 envs em `sync:false`, 0 checagens automatizadas.

## 5. Cards Kanban

### [deployability-1] Documentar a ACL nova ("alteração de item em com297") no runbook e granular no `NumerarioAclChecker`

- **Problema**
  > O `PUT com297/comDocProdutos` exige uma ACL específica ("alteração de item em com297") que a conta de serviço pode ou não ter. O `NumerarioAclChecker` casa apenas a substring "com297" (que já bate em HOMOLOGAR), então o preflight passa; a falha só aparece no primeiro `Recebimento` real do cliente afetado, como um 403 cru vindo do ERP. O único lugar onde essa exigência está escrita é o ADR-0036 — nem `docs/runbooks/fin010-write-cutover.md` nem `docs/e2e/producao-runbook-primeira-execucao.md` mencionam.

- **Melhoria Proposta**
  > (a) Adicionar seção "Pré-requisitos no ERP" no runbook de deploy da Frente IV listando as ACLs por-tela requeridas, marcando explicitamente "com297 — alteração de item" como novo desde ADR-0036. (b) Refinar `NumerarioAclChecker.ACL_REQUERIDAS` para casar rótulos mais específicos (`'com297 alterar item'` ou `'comDocProdutos'`) quando o HAR do endpoint `permissoes/new/com297` for capturado. Se o shape ainda não permitir, deixar um TODO com o `_inbox` de diagnóstico.

- **Resultado Esperado**
  > Deploy da mudança em novo tenant tem uma checklist de ACL clara; se a permissão faltar, o preflight (não o `PUT` fiscal) é quem denuncia — reduz MTTR de "descoberta em runtime" para "denúncia pré-execução".

- **Tactic alvo**: Script Deployment Commands + Rollback (pré-requisitos que sobrevivem a redeploy)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Pré-requisitos documentados no runbook: 0 → N (todas as ACLs por-tela)
  - Grants distintos validados pelo checker: 4 (por tela) → 4 (por tela) + granularidade por-ação onde o HAR permitir
- **Risco de não fazer**: Próximo tenant Columbia ou novo cliente sofre um "PUT fez 403" em produção, com diagnóstico via engenharia — não via runbook.
- **Dependências**: Capturar HAR do `GET /api/permissoes/new/com297` para modelar o shape (backlog de integrations).

### [deployability-2] Adicionar seção "Rollback" ao ADR-0036 (o que acontece com os `PUT dprLngDescrNf` já executados quando revertemos)

- **Problema**
  > ADR-0036 tem 83 linhas e zero mencionam rollback. A propriedade que torna o rollback seguro (o texto gravado é byte-a-byte o workaround manual, portanto continua fiscalmente correto se a versão for revertida) está no `_inbox/nde-descricao-produto-nfe-diagnostico.md`, não no ADR. Dev de plantão precisa consultar duas fontes para agir com confiança.

- **Melhoria Proposta**
  > Acrescentar §"Rollback" no ADR-0036: (a) rollback do binário é seguro — sem migration, sem breakage de contrato; (b) `PUT com297.dprLngDescrNf` já executados PERMANECEM (não há UNDO possível), mas o texto ≡ workaround manual, portanto sem passivo fiscal; (c) após rollback, novos `Recebimentos` de clientes com `dpeVld1DescrNfe=4` voltam a falhar como antes do fix. Duas frases, um bullet.

- **Resultado Esperado**
  > Rollback decidido em <2 min por qualquer plantonista, sem consulta ao autor. Reduz MTTR percebido durante madrugada/fim-de-semana.

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S (≤1d, minutos de fato)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Linhas sobre rollback no ADR: 0 → ≥5
  - Fontes consultadas para decisão de rollback: 2 → 1
- **Risco de não fazer**: Hesitação em rollback durante incidente noturno; decisões piores que a técnica permite.

### [deployability-3] Kill-switch específico da etapa `descricao-item` (env booleana, default ON)

- **Problema**
  > A `etapaDescricaoItem` é chamada incondicionalmente no meio do write path. Se ela regredir em produção (ex.: `preDescrProdutoNf` começa a devolver algo inválido e enfia no `dprLngDescrNf`), o remédio disponível hoje é (a) rollback de código ou (b) `RECEBIMENTOS_ENABLED=false` (derruba a frente inteira). Faltam 5 minutos entre "temos um kill-switch" e "temos uma frente parada".

- **Melhoria Proposta**
  > Adicionar env `NDE_DESCRICAO_ITEM_ENABLED` (default `true`, ausente = ligada). Em `EnvironmentProvider` + `EnvironmentVars`; leitura no `RecebimentoNumerarioService.etapa*` para tornar a etapa opt-out. Marcar como `sync:false` no `render.yaml` (dashboard = fonte da verdade). Setar `false` faz a etapa pular — o comportamento volta a ser o pré-fix (NDe segue falhando na homologação para clientes afetados, mas sem lixo novo em `dprLngDescrNf`).

- **Resultado Esperado**
  > MTTR para "etapa nova regride" cai de "rollback de código + Render redeploy" para "toggle no dashboard + restart" — mesma latência, sem git.

- **Tactic alvo**: Feature flags (Manage Deployed System)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Flags específicas do delta: 0 → 1
  - Blast radius de kill-switch: frente inteira → só a etapa
- **Risco de não fazer**: Se a etapa apresentar defeito sutil, único remédio é derrubar Frente IV inteira até rollback subir.

### [deployability-4] Job semanal de drift-detection contra o dashboard Render

- **Problema**
  > 12 envs em `sync:false` no `render.yaml` (incluindo `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`, `RECEBIMENTOS_ENABLED`) — não há detecção se alguém trocar essas envs no dashboard sem avisar. O delta atual não introduz o problema, mas convive com ele e adiciona ainda outra env (`NDE_DESCRICAO_ITEM_FALLBACK`, se um dia for setada).

- **Melhoria Proposta**
  > Workflow do GitHub Actions (`drift-envs.yml`, `cron: 0 12 * * 1`) que usa a Render API para listar envs do serviço e comparar com um snapshot versionado (`docs/deploy/envs-snapshot.md`, atualizado à mão em cada mudança sancionada). Diff → PR-comment/issue automático. Não bloqueia; apenas alerta.

- **Resultado Esperado**
  > Deriva de configuração denunciada em ≤7 dias em vez de "descoberta no próximo incidente". Alinha a prática já usada em Terraform (plan-drift) ao stack Render.

- **Tactic alvo**: Drift detection
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — API Render + workflow + snapshot inicial)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Envs `sync:false` monitoradas: 0 → 12
  - Lag entre drift real e detecção: indefinido → ≤7d
- **Risco de não fazer**: Incidente de configuração dentro de 6 meses ("por que a NDe parou de emitir? — alguém colocou DRY_RUN=true e ninguém viu").
- **Dependências**: Render API token com escopo de leitura do serviço.

## 6. Notas do agente

- Escopo restrito ao delta: não avaliei o pipeline Render/CI como um todo, só o efeito da mudança sobre ele. As tactics globais (Reproducible builds, Script Deployment Commands, Package Dependencies) apareceram como ✅ porque a mudança **não regride** o que já existia — não porque as auditei nesta run.
- A etapa nova é *auto-canary* pela distribuição do cadastro dos clientes (`dpeVld1DescrNfe`): a maioria não exercita a lógica nova. Isso é uma propriedade emergente, não uma tactic desenhada — considerar reconhecê-la explicitamente no ADR seria valioso para futuras mudanças fiscais.
- **Cross-QA para o consolidator**:
  - **Fault-tolerance**: o `NumerarioAclChecker` casar por substring larga é um débito compartilhado — a granularidade insuficiente aparece aqui como "runbook pobre", lá deve aparecer como "detector fraco".
  - **Modifiability**: a chamada incondicional em `RecebimentoNumerarioService:454` é um ponto de acoplamento a mais no orquestrador — se Modifiability quiser propor extração/decorator de etapas, deployability-3 (kill-switch) se resolve de graça.
  - **Testability**: nenhum teste de integração exercita o caminho de rollback (retomada em `obs-done` após revert); se Testability quiser propor um cenário, tem ponto de partida aqui.
