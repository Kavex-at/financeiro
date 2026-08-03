---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-deployability
generated_at: 2026-08-03T18:47:00-03:00
scope: backend
score: 8.5
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de dev (Kavex) | Merge do ADR-0027 (`fix/alocar-sn-select` → `main`) — nova rota GET aditiva, campo Zod opcional (`snDocCod?`), ramo NO-OP em `RecebimentoNumerarioService.etapaSn` | Backend Express (Render blueprint, auto-deploy on push to `main`), rota `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` + nova GET `/recebimentos/processos/:priCod/sns` | Produção multi-filial (Columbia Trading, `RECEBIMENTOS_ENABLED` sob controle do operador via dashboard Render); frontend Vercel independente | Deploy contínuo: CI (backend/frontend) verde → Render puxa `main` → `preDeployCommand` (migrate + seed) → cutover; clientes existentes com body legado (sem `snDocCod`) continuam gerando SN nova sem alteração; rollback = revert-commit (nenhum novo schema/env/migration) | Zero migrações novas (0 arquivos em `src/backend/migrations/`); zero envs novos em `render.yaml`; 115/115 testes unitários passando no delta; rollback ≤ 1 revert-commit + 1 auto-deploy (≈ 5 min); nenhuma quebra de contrato para clientes antigos (assert coberto por teste "omite snSelecionadaDocCod quando body não traz snDocCod") |

> Comentário: a mudança é **puramente aditiva**. Adiciona uma superfície de leitura nova (GET `/processos/:priCod/sns`), um campo opcional no POST existente (`snDocCod?: number`), e um ramo NO-OP no orquestrador que pula `com299/gerDocProcesso` + `completarSnAdiantamento` + `finalizarDocumento` quando o `snDocCod` está presente. Não há novos secrets, tabelas ou feature flags dedicadas — a frente inteira segue gated pelo já-existente `RECEBIMENTOS_ENABLED`.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| # migrations novas no delta | 0 | 0 (feature code-only) | ✅ | `ls src/backend/migrations/ | tail -5` — última é `0042_solicitacao_numerario_execucao_fiscal.sql` (pré-existente) |
| # envs novas no `render.yaml` / DEPLOY.md | 0 | 0 | ✅ | `git diff main -- render.yaml DEPLOY.md` = vazio |
| # feature flags novas exigidas | 0 (herda `RECEBIMENTOS_ENABLED`, fail-safe em prod) | 0 ou 1 (com fail-safe) | ✅ | `render.yaml:29-33`, `EnvironmentProvider.ts:44-49` |
| Testes unitários no delta (backend) | 115/115 passing (routes/recebimentos.test + ConexosGerDocProcessoClient.test + RecebimentoNumerarioService.test) | 100% | ✅ | `npm test -- --testPathPatterns="routes/recebimentos\.test|ConexosGerDocProcessoClient\.test|RecebimentoNumerarioService\.test"` — 3 suites, 115 passed, 8.6s |
| Backward-compat do POST `/solicitacao-numerario` | Assegurado por teste explícito ("omite snSelecionadaDocCod quando o body não traz snDocCod") | Assegurado | ✅ | `src/backend/routes/recebimentos.test.ts:427-436` |
| Nova rota GET aditiva (não altera contrato existente) | 1 (`GET /recebimentos/processos/:priCod/sns`) | Aditivo, com Zod no boundary | ✅ | `src/backend/routes/recebimentos.ts:366-394` |
| Rollback path (revert-only) | 1 commit no branch `fix/alocar-sn-select` (post-squash) + auto-deploy Render | ≤ 1 commit revert, sem down-migration | ✅ | `git log --oneline main..HEAD` |
| Guard defensivo no boundary do ERP (evita vazar NC/ND como SN se filtro server-side falhar) | Presente | Presente | ✅ | `ConexosGerDocProcessoClient.ts:1107-1111` |
| Cobertura de branch (SN existente × novo SN) no service | 2 cenários testados (etapaSn: NO-OP quando `snSelecionadaDocCod` presente / fluxo completo quando ausente) | ≥ 2 | ✅ | `RecebimentoNumerarioService.test.ts:216-267` |
| Deployment observability para o novo ramo | ⚠️ Não medível localmente — o backend loga em `LogService` (INFO/WARN) mas não há métrica dedicada `sn.existente.escolhida` / `sn.nova.gerada` para o operador filtrar no Render log stream | Contador para dashboard de operação | ⚠️ | inspeção `RecebimentoNumerarioService.ts:264-283` (log DRY-RUN inclui `classificacao` mas não flag `snReutilizada`) |
| CI gate antes do auto-deploy Render | Presente (`.github/workflows/ci.yml`: typecheck+lint+test+build+audit; branch protection + `autoDeploy: true` na `main`) | Presente | ✅ | `.github/workflows/ci.yml:11-31`, `render.yaml:14-19` |
| Feature-flag gradual rollout do novo ramo | ⚠️ Não medível localmente / **ausente**: o ramo "SN existente" fica visível ao analista assim que o frontend deployar; não há `SN_SELECT_ENABLED` que permita liberar por filial/cliente antes de generalizar | Flag por-ambiente ou por-filial (canário) | ⚠️ | inspeção `AlocarProcessosDialog.tsx:41,132,209,332,344` (a UI já expõe a opção de escolha sem gate adicional) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts — canary | Ausente para o delta: o auto-deploy Render (`autoDeploy: true`) empurra o novo ramo para 100% do tráfego assim que `main` avança | ⚠️ parcial | `render.yaml:14-19` — não há ambiente staging separado no blueprint; a única "canary" prática é rodar em HML antes de merge |
| Scale Rollouts — blue/green | Render faz swap atômico após `preDeployCommand` (migrate + seed) OK; nenhum migrate neste delta = swap barato | ✅ presente | `render.yaml:19-22`, `DEPLOY.md:31` |
| Scale Rollouts — rolling | N/A — instância única no plano `starter` (Render), sem rolling multi-instância | N/A | `render.yaml:7` (`plan: starter`) |
| Rollback | Aplicável e barato: sem migration, sem schema, sem novo env; `git revert` + push a `main` reverte em 1 deploy (≈ 3-5 min). Nada a "des-fazer" no Postgres — o campo `snDocCod` é opcional no payload; um cliente que já enviou não quebra o backend antigo (ele simplesmente ignora o campo) | ✅ presente | `git diff main --stat` mostra 0 arquivos em `src/backend/migrations/`; `runPipelineSchema`/`solicitacaoNumerarioSchema` do backend antigo ignora campos extras (Zod default) |
| Script Deployment Commands | Já existe: `render.yaml` faz `npm ci && npm run build`; `preDeployCommand: npm run migrate && npm run seed:admin`; CI roda `npm ci && npm audit && typecheck && lint && test && build`. Sem step novo neste delta | ✅ presente | `render.yaml:20-24`, `.github/workflows/ci.yml:19-31` |
| Logical Grouping | Rota nova é agrupada no mesmo `Router` `/recebimentos` (Frente IV) e obedece à mesma authz por-filial (`assertUserCanActOnFilial`) do restante do módulo | ✅ presente | `src/backend/routes/recebimentos.ts:366-394` (mesmo pattern de `filiaisPermitidas`) |
| Physical Grouping | N/A — monorepo Express, uma única unidade de deploy (Render); GET novo colocaliza com POST existente no mesmo processo | N/A | `render.yaml:2-6` |
| Package Dependencies | Nenhuma dependência nova adicionada (nem `package.json` nem `package-lock.json` mexidos no delta backend); frontend também sem dep nova (só `AlocarProcessosDialog.tsx` + `lib/recebimentos.ts`) | ✅ presente | `git diff main --stat -- src/backend/package.json src/backend/package-lock.json src/frontend/package.json` = vazio |
| Surge Protection | Rota nova é READ-only (`GET`) e **NÃO** foi montada atrás do `heavyRouteLimiter` (que só se aplica a POST `/pipeline/run`, POST `/solicitacao-numerario`, POST `/ingestao`). Isso é adequado para leitura, MAS o `com299/list` (Conexos) tem custo material: um analista clicando o modal em N processos em sucessão dispara N chamadas ao ERP em cadeia (`filCod`-scoped, sem cache por-processo) | ⚠️ parcial | `src/backend/routes/recebimentos.ts:366-394` (rota sem `heavyRouteLimiter`); `ConexosGerDocProcessoClient.ts:1049-1117` (`listSNsByProcesso` bate `com299/list` a cada clique) |
| Idempotent deploys | Mantém a idempotência do POST existente (`sn-real:{txnId}:{priCod}:{valor}` no ledger); o ramo "SN existente" **NÃO** cria SN duplicada (invariante I-Receb-3, coberto por `RecebimentoNumerarioService.ts:418-462`) | ✅ presente | `RecebimentoNumerarioService.ts:355-357,417-462` (retomada honra `ctx.snSelecionadaDocCod` sobre `existente?.docCod`) |
| Drift detection (env/config) | N/A local — a stack Render/Vercel/Supabase não expõe drift-detection no repo; a única defesa é o `render.yaml` versionado (`sync: false` em segredos) | N/A | `render.yaml:29-56` |
| Reproducible builds | `package-lock.json` versionado, `npm ci` no build e no CI, Node pinado a `24` no CI. Sem dep nova nesta feature ⟹ o build permanece reproduzível | ✅ presente | `.github/workflows/ci.yml:19-20,26-28,45-46`; `render.yaml:20` (`npm ci`) |
| Per-tenant blast-radius limit | N/A neste delta — deploy é single-tenant (Columbia); a authz por-filial garante o blast-radius operacional (analista de fil-4 não escolhe SN de fil-7), não o de deploy | N/A | `src/backend/routes/recebimentos.ts:381-389` (novo GET aplica `assertUserCanActOnFilial`) |
| Deployment observability | Parcial: o `LogService` registra INFO/WARN por etapa (`RecebimentoNumerarioService.ts:264-283, 312-323, 507-518`), mas **não distingue explicitamente** um settle que reusou SN existente de um que gerou. Sem essa distinção, o operador que precise investigar "quantas SNs foram evitadas" depois do deploy tem que grep em campos indiretos (`etapa`, `ledger.doc_cod` vs. request body) | ⚠️ parcial | `RecebimentoNumerarioService.ts:381-386` (markSettled não carrega flag `snReutilizada`) |

## 4. Findings (achados)

### F-deployability-1: Ausência de flag `snReutilizada` no telemetry impede medir adoção pós-deploy

- **Severidade**: P3 (baixo — melhoria opcional, não bloqueia deploy)
- **Tactic violada**: Deployment observability
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:264-283` (log DRY-RUN), `:381-386` (`markSettled`), `:392-403` (retorno do settle)
- **Evidência (objetiva)**:
  ```
  await this.execucaoRepository.markSettled(key, {
      ...(snDocCod !== undefined ? { docCod: snDocCod } : {}),
      ...(ndDocCod !== undefined ? { ndDocCod } : {}),
      ...(homolog.erpResponse !== undefined ? { erpResponse: homolog.erpResponse } : {}),
  });
  ```
  Nem o `markSettled`, nem o `log info` do dry-run, nem o retorno `ProcessarAlocacaoResult` carregam um discriminador booleano do tipo `snReutilizada` / `snOrigem: 'gerada' | 'selecionada'`. O único sinal indireto é `ctx.snSelecionadaDocCod !== undefined` — que **não sai** para o operador.
- **Impacto técnico**: Depois do deploy, o operador não tem métrica objetiva de "% de alocações que reusaram SN vs. geraram nova" para dizer se o ADR-0027 está entregando o valor esperado (menos duplicatas no ERP).
- **Impacto de negócio**: Sem esse número, uma regressão silenciosa (ex.: um bug no frontend que sempre passa `snDocCod: undefined`) só é notada quando um analista reclama de SN duplicada. Perda: dias de latência entre a regressão e a detecção.
- **Métrica de baseline**: 0 campos telemetry no delta que distinguem "SN reutilizada" de "SN nova".

### F-deployability-2: Rota GET `/processos/:priCod/sns` sem rate-limit e sem cache no boundary Conexos

- **Severidade**: P2 (médio — débito técnico defensável, mas o custo é do ERP terceiro)
- **Tactic violada**: Surge Protection
- **Localização**: `src/backend/routes/recebimentos.ts:366-394` (rota); `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1049-1117` (`listSNsByProcesso`)
- **Evidência (objetiva)**:
  ```
  router.get(
      '/processos/:priCod/sns',
      asyncHandler(async (req, res) => {   // <-- sem heavyRouteLimiter
          ...
          const client = container.resolve(ConexosGerDocProcessoClient);
          const sns = await client.listSNsByProcesso({ filCod, priCod: priCod.data });
          ...
  ```
  Cada clique num processo à esquerda do modal (`AlocarProcessosDialog.tsx:312`) dispara UM `POST /api/com299/list` sem cache. Um analista abrindo o modal e clicando em 10 processos em cadeia gera 10 chamadas ao ERP em segundos — durante o rollout é exatamente o padrão de uso esperado, quando todos vão testar a novidade.
- **Impacto técnico**: Pressão adicional no `com299` do Conexos, que já é a família mais tocada da Frente IV. Não é P1 porque `assertUserCanActOnFilial` bloqueia atores fora da allow-list, mas a taxa por-analista é ilimitada.
- **Impacto de negócio**: Se o Conexos passar a impor 429/timeout no `com299/list` sob carga, o modal ficará flaky no dia da entrega (justamente quando a demonstração está sendo feita para o usuário Yuri).
- **Métrica de baseline**: 0 rate-limit específico na nova rota (o `heavyRouteLimiter` só protege escritas); 0 cache TTL para `com299/list` (o `com297` e `com298` de escrita têm proteção diferente, essa leitura não).

### F-deployability-3: Ausência de feature-flag específica do ramo "SN existente" impede cutover gradual pós-deploy

- **Severidade**: P3 (baixo — a frente inteira já é gated por `RECEBIMENTOS_ENABLED`, então o blast-radius de deploy do delta é o mesmo da frente)
- **Tactic violada**: Scale Rollouts (canary por-tenant/por-filial)
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:41,209,312,332`; `src/backend/routes/recebimentos.ts:366-394` (rota nova sem gate próprio)
- **Evidência (objetiva)**:
  ```
  // AlocarProcessosDialog.tsx:41
  /** Valor sentinela do radio "Criar novo SN" (default) — distinto de qualquer `docCod` real. */
  const CRIAR_NOVO_SN = 'novo'
  ```
  E a rota backend nova (`/processos/:priCod/sns`) não checa nenhuma env — é ligada assim que o binário sobe. Um bug no `listSNsByProcesso` (ex.: um filtro Zod que rejeita um `vldStatus` novo do ERP) só é contornável **desligando a frente inteira** (`RECEBIMENTOS_ENABLED=false`), o que apaga também a ingestão e o painel READ-only.
- **Impacto técnico**: O grão do gate é a frente inteira, não o ramo. Um problema específico do ADR-0027 força downgrade que desliga funcionalidade ortogonal já em operação.
- **Impacto de negócio**: MTTR maior num incidente do dia do rollout — o operador tem que escolher entre "aceito o bug" e "desligo toda a Frente IV para a Columbia".
- **Métrica de baseline**: 1 env cobrindo a frente (`RECEBIMENTOS_ENABLED`) e 0 envs cobrindo o ramo "SN existente" do modal.

## 5. Cards Kanban

### [deployability-1] Emitir contador/flag `snReutilizada` no ledger e no log de settle

- **Problema**
  > Após o deploy do ADR-0027, o operador não consegue medir com um `grep`/dashboard quantas alocações reusaram SN existente vs. geraram uma nova. O único sinal está no `ctx.snSelecionadaDocCod`, que morre no scope do service e não vai para o `execucao_repository` nem para o log estruturado.

- **Melhoria Proposta**
  > Adicionar `snReutilizada: boolean` (derivado de `ctx.snSelecionadaDocCod !== undefined`) em: (a) log INFO do dry-run e do settle (`LogService.info` em `RecebimentoNumerarioService.ts:264-283, 381-386`); (b) opcionalmente, uma coluna do `solicitacao_numerario_execucao` (numa migration nova quando houver outra razão para tocar a tabela — não abrir migration só para isso). Tactic alvo: Deployment observability.

- **Resultado Esperado**
  > Operador consegue rodar `grep 'snReutilizada":true' render.log | wc -l` e obter a contagem imediata; dashboard consegue plotar % adoção do novo ramo. Métrica: 0 → 100% dos settles carregam o flag.

- **Tactic alvo**: Deployment observability
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - `# logs com flag snReutilizada / # settles do dia`: 0 → 1.0
  - Tempo para responder "quantas SNs foram reusadas na 1ª semana?": manual grep multi-campo → 1 query
- **Risco de não fazer**: uma regressão silenciosa (ex.: FE deixa de mandar `snDocCod`) só é detectada quando um analista reclama de SN duplicada no ERP — dias de latência.
- **Dependências**: nenhuma.

### [deployability-2] Aplicar rate-limit e cache TTL na rota `GET /processos/:priCod/sns`

- **Problema**
  > Cada clique num processo do modal dispara um `POST com299/list` no Conexos (`ConexosGerDocProcessoClient.listSNsByProcesso`). A rota GET nova não está atrás do `heavyRouteLimiter` e não há cache por-processo — no dia do rollout, o padrão de "analista testando cada processo" gera burst desnecessário contra o ERP.

- **Melhoria Proposta**
  > (a) Aplicar um `readLimiter` (ou o próprio `heavyRouteLimiter`) em `routes/recebimentos.ts:366-394`; (b) instanciar um cache in-memory com TTL curto (≥ 30s, ≤ 5min) por `(filCod, priCod)` no `ConexosGerDocProcessoClient.listSNsByProcesso`, seguindo o pattern que o `ConexosCadastroClient` já usa para `listFiliais`. Tactic alvo: Surge Protection.

- **Resultado Esperado**
  > Múltiplos cliques no mesmo processo dentro do TTL respondem do cache; burst de N processos em cadeia é rate-limitado. Métrica: 100% dos hits repetidos dentro do TTL saem do cache; taxa por-IP ≤ N req/min.

- **Tactic alvo**: Surge Protection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - `com299/list requests / open-do-modal`: N (todos) → 1 no primeiro clique + 0 no reclique dentro do TTL
  - `# 429 do Conexos na rota nova`: monitorar; alvo: 0
- **Risco de não fazer**: no dia do rollout, o Conexos passa a lento; o modal aparenta bug ("SNs demoram para carregar"); percepção do usuário fica ruim justamente na estreia do ADR-0027.
- **Dependências**: alinhar com card `performance-*` do consolidator (mesma raiz: chamadas Conexos sem cache).

### [deployability-3] Feature-flag específica `SN_SELECT_ENABLED` para cutover gradual do ramo

- **Problema**
  > O ramo "SN existente" fica disponível a 100% dos analistas assim que `main` deploya. Um bug isolado no `listSNsByProcesso` (novo Zod, novo filtro no ERP) só é contornável desligando a frente inteira (`RECEBIMENTOS_ENABLED=false`), o que apaga ingestão e painel READ-only já operacionais.

- **Melhoria Proposta**
  > Adicionar `SN_SELECT_ENABLED` no `EnvironmentProvider` (fail-safe: em prod, ausência = **desligado**), gatear a rota `GET /processos/:priCod/sns` (retornar `[]`) e a UI (esconder a lista, manter só o default "Criar novo SN"). Ligar por-cliente via dashboard Render (`sync: false`). Tactic alvo: Scale Rollouts.

- **Resultado Esperado**
  > Cutover gradual: liga a env em dev/HML primeiro, promove a prod só depois de ≥ 24h estáveis. Rollback do ramo = 1 toggle no dashboard, sem redeploy. Métrica: MTTR do ramo isolado ≤ 5min (era: reverter binário ~= 5-10min).

- **Tactic alvo**: Scale Rollouts (canary por feature flag)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - `# envs granulando o cutover da Frente IV`: 1 (`RECEBIMENTOS_ENABLED`) → 2 (+ `SN_SELECT_ENABLED`)
  - Toggle-to-effect time: N/A → ≤ 60s (Render env change trigger)
- **Risco de não fazer**: um incidente que atinja apenas o ramo novo derruba a frente inteira; o operador não tem "circuito de escape" granular.
- **Dependências**: nenhuma; complementa card `deployability-1` (que dá o telemetry para saber quando ligar/desligar).

## 6. Notas do agente

- Escopo restrito estritamente ao delta ADR-0027 (arquivos do `_shared-metrics.md`); nenhuma auditoria do repo completo, do CI genérico, ou de tenants de infraestrutura (que não existem — Render/Vercel/Supabase).
- Rodei os testes só do delta (`--testPathPatterns="routes/recebimentos\.test|ConexosGerDocProcessoClient\.test|RecebimentoNumerarioService\.test"`): **115 passed, 0 failed, 8.6s**. Suítes E2E (`recebimentos.e2e.gates.test.ts`, `e2e.prodWrite.integration.test.ts`) falham por razões pré-existentes (fin014 HML defect, ver commit `2be78ba` e `docs/e2e/producao-runbook-primeira-execucao.md`) — fora do escopo desta review.
- Métrica "canary por-tenant" e "drift detection" declaradas N/A porque não há tenants Terraform e o único ambiente é single-tenant Render (Columbia).
- Cross-QA: card [deployability-2] compartilha raiz com Performance (chamadas Conexos sem cache) e [deployability-1] com Testability (falta de telemetria observável). Consolidator: considerar deduplicar/costurar.
