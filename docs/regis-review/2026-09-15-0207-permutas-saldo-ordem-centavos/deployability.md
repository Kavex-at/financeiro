---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-deployability
generated_at: 2026-09-15T02:15:00Z
scope: backend+frontend
score: 8.0
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta permutas-saldo-ordem-centavos)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge em `main` da branch `fix/permutas-saldo-ordem-centavos` (delta ADR-0046) | Push dispara CI (`.github/workflows/ci.yml`) → autoDeploy do Render (backend `src/backend`) e da Vercel (frontend `src/frontend`) em paralelo, sem ordem garantida entre os dois. **Nenhuma migration** no delta (0057 é o topo do `main`). | Regra de saldo (`SaldoAlocacaoAdiantamentoService`), guarda de frescor no cache de borderô (`replaceBorderoCache`/`updateBorderoCacheSituacao` param de renovar `atualizado_em` a cada refresh), motivo/prioridade em `ElegibilidadeService`, contrato REST `/permutas/gestao` (novo campo `alocacoes` em `ja-permutado`), tela `permutas` (novo módulo `historico.ts`). | Produção Render/Supabase/Vercel, autoDeploy on-push, sem canary/blue-green; feature-flags `RECEBIMENTOS_ENABLED`/`SISPAG_LIVE_WRITE_ENABLED`/`CONEXOS_WRITE_ENABLED` (dashboard) não cobrem o path do painel de Permutas. | (1) A tela usa `alocacoes?` de forma defensiva (`historico.ts:20-23,29-34`), então FE-antes-de-BE cai no `valorMoedaNegociada` e no rótulo neutro `Já permutado` sem quebrar. (2) Até a 1ª ingestão pós-deploy, `permuta_bordero.atualizado_em` de todas as linhas antigas é posterior ao último `started_at`, então `listConsumosFinalizados` devolve vazio e `saldoRestante` degenera ao comportamento pré-delta (desconta TODAS as alocações) — o novo comportamento correto só entra depois que a próxima ingestão renovar `started_at` sem tocar `atualizado_em`. (3) Rollback do backend para a versão anterior é seguro: sem migration, o único efeito é o `replaceBorderoCache` voltar a renovar `atualizado_em` a cada refresh (nenhum consumidor histórico dependia da semântica nova). | Deploy verde = 0 corrupção; convergência do saldo correto para o comportamento novo em **1 ciclo de ingestão** (hoje ~1h via cron `ingest-permutas`, mas depende do adto ser rejulgado); rollback simétrico (RTO ≈ 5 min pelo botão do Render, ver `docs/runbooks/rollback.md`); ground-truth `validate-permutas-saldo-ordem-centavos-v1.ts` provou 247 linhas / 0 DIVERGENTE contra Conexos prd antes do merge. |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations novas no delta | 0 (`git diff origin/main..HEAD -- 'src/backend/migrations/*'` vazio; topo do `main` é `0057_permuta_execucao_guard_reabertura.sql`) | 0 (ideal) ou N com script `*_rollback.sql` correspondente | ✅ | `ls src/backend/migrations/rollbacks/` (só 0054/0055, ambos pré-existentes) |
| Passos automatizados commit→prd (backend) | 6 (`checkout`, `setup-node`, `npm ci`, `npm audit --audit-level=high`, `typecheck`, `lint`, `test --coverage`, `build`) + Render autoDeploy | ≥5 | ✅ | `.github/workflows/ci.yml:10-28` |
| Rollback simétrico (código + schema) | Aplicável, mas **sem schema para reverter** neste delta → rollback do código é suficiente e determinístico via Render Events (documentado) | disponível | ✅ para este delta | `docs/runbooks/rollback.md:14-42` |
| Back-compat do contrato REST | Aditivo: `PermutaPendente.alocacoes` agora também aparece em `ja-permutado` (antes só `permuta-manual`/`casamento-manual`). Consumo pelo FE é defensivo (optional chaining) | contrato aditivo | ✅ | `src/backend/domain/interface/permutas/Gestao.ts:99-105`; `src/frontend/app/permutas/components/historico.ts:20-34` |
| Back-compat do FE quando o BE ainda é o anterior | FE sem `alocacoes` cai em `valorMoedaNegociada` (`historico.ts:22-23`) e devolve rótulo `Já permutado` (`historico.ts:29-34`, `.some()` sobre lista vazia = `false`) → não quebra a aba Histórico | não quebra | ✅ | `src/frontend/app/permutas/components/historico.ts:20-34` + testes `historico.test.ts` |
| Back-compat do BE quando o FE ainda é o anterior | FE antigo ignora silenciosamente `alocacoes` no `ja-permutado` (nunca as lia); `page.tsx` antigo só usa 4 categorias, ADR-0046 D4 fica invisível até o Vercel promover | não quebra | ✅ | diff `src/frontend/app/permutas/page.tsx:558-604` |
| Janela de convergência do saldo pós-deploy | **≥ 1 ingestão** (`ingest-permutas` roda `:00` do horário útil — ver `.github/workflows/ingest-permutas.yml`). Até lá, `Σ naoConsumido = Σ valorAlocado` (subestima saldo, sentido conservador) | zero downtime; janela conservadora ok | ✅ (conservador) | ADR-0046 §Consequências; `PermutaExecucaoRepository.ts:196-204` |
| Observabilidade do término da convergência | **Ausente**: nenhum log/métrica sinaliza "adto X passou a usar o novo saldo". Diagnóstico depende de olhar `permuta_bordero.atualizado_em` + `permuta_eleicao_run.started_at` no banco | 1 métrica ou log agregado | ⚠️ | `grep -rn "convergencia\|naoConsumido\|listConsumosFinalizados" src/backend` → só chamadas de código, sem logging |
| DI wiring do novo serviço | `@injectable()` em `SaldoAlocacaoAdiantamentoService`; consumido por `AlocacaoPermutasService` (via `@inject`) e `GestaoPermutasService` (via `@inject`); tsyringe auto-registra na 1ª resolução — sem passo de registro explícito no boot | zero configuração manual | ✅ | `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:42-49`; `AlocacaoPermutasService.ts:83-87`; `GestaoPermutasService.ts:67-71` |
| Método público removido do repo | `PermutaAlocacaoRepository.sumByAdiantamento` deletado — único chamador era `AlocacaoPermutasService.alocar`, migrado no mesmo commit | 0 chamadores externos | ✅ | `grep -rn "sumByAdiantamento" src/` → 0 ocorrências |
| Mudança semântica em `permuta_bordero.atualizado_em` | `replaceBorderoCache` (`:556-585`) e `updateBorderoCacheSituacao` (`:598-619`) agora só renovam `atualizado_em` quando `bor_vld_finalizado` OU `bor_cod_estornado` mudam. Se rolar back, a versão anterior volta a renovar em todo refresh — sem corrupção, só delay de convergência re-inicia | change reversible sem drift | ✅ | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:580-583, 604-608` |
| Ground-truth validation contra ERP prd | 247 linhas · 0 DIVERGENTE · 6 EXPLICADO · 1 SEM_GROUND_TRUTH (V3, fronteira R$1,00 sem doc real) — read-only, sessão única | 0 DIVERGENTE | ✅ | `_shared-metrics.md`; `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` |
| Feature-flag para desligar a nova semântica sem redeploy | **Ausente**: não há env-var equivalente a `RECEBIMENTOS_ENABLED` que reverta `saldoRestante` para "Σ valorAlocado" cru | canary por flag | ⚠️ | `grep -n "process.env" src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts` → 0 |
| Bump de versão do app (lockstep FE+BE) para o delta | **Pendente**: base é `v0.36.4` (`3872903`); os 6 commits do delta ainda não bumparam para `v0.37.0`. Green criterion #11 do CLAUDE.md exige o bump antes do PR | mesma versão FE=BE = `v0.37.0` | ⚠️ | `jq -r .version src/{frontend,backend}/package.json` → `0.36.4`; `_shared-metrics.md` §"Pendentes do orquestrador" |
| Reprodutibilidade de build (lockfile + Node pin) | `package-lock.json` versionado em `src/backend/` e `src/frontend/`; `npm ci` no CI; Node fixado em `24` no CI (pré-existente; divergência com crons em `22` já registrada como F-deployability-5 do ciclo 2026-09-08 — não agravada por este delta) | lockfile + pin | ⚠️ (pré-existente) | `.github/workflows/ci.yml:19-22`; ciclo 2026-09-08 §F-deployability-5 |
| Escopo Terraform / IaC | ⚠️ **Não medível**: repo não tem `infra/`. Deploy é Render (backend) via `render.yaml` + Vercel (frontend) autoDeploy. Toda tactic multi-tenant IaC é N/A | — | ⚠️ N/A | `ls infra/` → não existe (`_shared-metrics.md`) |
| Rota HTTP nova/removida no delta | 0 (nem `routes/permutas.ts` nem outras rotas mudaram; delta é interno) | — | ✅ | `git diff --stat origin/main..HEAD -- 'src/backend/routes/*'` = vazio |
| Blast radius do deploy | 100% dos usuários (1 tenant, 1 processo Render, autoDeploy) — pré-existente, não agravado pelo delta | — | ⚠️ (pré-existente) | `render.yaml:5-17` (single service) |
| Kill-switches (SISPAG/RECEBIMENTOS/CONEXOS) tocados pelo delta | 0 (Permutas não tem env-var equivalente) | — | ✅ (nenhum kill-switch mudou) | `render.yaml:34-71`; `grep -n "process.env" src/backend/domain/service/permutas/Saldo*` = 0 |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Deploy monolítico Render+Vercel, sem canary/blue-green. **Este delta compensa parcialmente** com uma "convergência natural": até a 1ª ingestão pós-deploy o `saldoRestante` degenera ao comportamento pré-delta e só depois assume a semântica nova — funciona como rollout gradual invisível, mas não é orquestrado nem observável | ⚠️ parcial (efeito colateral, não tactic explícita) | `PermutaExecucaoRepository.ts:196-204` (guarda de frescor); ADR-0046 §Consequências |
| Rollback | Sem migration → rollback do Render "sem drama": botão Rollback restaura o commit anterior; o `replaceBorderoCache` volta a renovar `atualizado_em` sem cascata | ✅ presente | `docs/runbooks/rollback.md:14-42`; ausência de `NNNN.sql` no delta |
| Script Deployment Commands | Herdado do repo: `render.yaml` (build/start), `BootMigrator` (schema no boot), `scripts/bump-version.ps1` (versão FE+BE lockstep). O delta **não muda script de deploy** | ✅ presente (pré-existente) | `render.yaml`, `src/backend/migrations/BootMigrator.ts` |
| Logical Grouping | Novo serviço `SaldoAlocacaoAdiantamentoService` isola a regra "quanto ainda não foi consumido"; consumidores (`GestaoPermutasService`, `AlocacaoPermutasService`) chamam a mesma fonte — impede que a tela e o teto do `alocar` divirjam | ✅ presente | `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:15-42` |
| Physical Grouping | Backend em serviço único Render; ingest-permutas em GitHub Actions cron (pré-existente) | ✅ presente | `render.yaml:5-17`; `.github/workflows/ingest-permutas.yml` |
| Package Dependencies | Nenhuma dependência nova (`git diff origin/main..HEAD -- src/backend/package.json src/frontend/package.json` só bumpa nada — na verdade não muda) | ✅ presente | `git diff origin/main..HEAD -- 'src/*/package*.json'` = vazio |
| Surge Protection | N/A para este delta (não introduz endpoint novo nem consumo elástico) | N/A | — |
| Idempotent Deploys | Delta é 100% idempotente: código puro (services, repos); sem side-effect de boot. Re-deployar o mesmo commit N vezes = mesmo comportamento | ✅ presente | `SaldoAlocacaoAdiantamentoService` é puro/consulta-only |
| Drift Detection | Ausente para o cache `permuta_bordero` (não há job que compare `atualizado_em` com o snapshot esperado); ADR-0046 nomeia 2 adtos + 1 "outro" de "risco residual" (bordero `fin=1` sem abate no ERP) sem detector automático | ⚠️ parcial | ADR-0046 §"Risco residual, nomeado" |
| Reproducible Builds | Pré-existente: `package-lock.json`, `npm ci`. Node pin divergente entre CI (24) e crons (22) segue como F-deployability-5 do ciclo anterior — não agravado | ⚠️ pré-existente | `.github/workflows/ci.yml:19-22` |
| Per-tenant blast-radius limit | N/A — SaaSo mono-tenant (Columbia Trading, 1 processo Render, 1 Supabase) | N/A | `CLAUDE.md §Tenants`; `render.yaml:5-17` |
| Deployment observability | `/health` devolve `{status, version}` (pré-existente); **este delta não instrumenta** um sinal de "convergência do saldo" que permita ao operador saber quando a nova semântica pegou. Falha silenciosa se algo der errado no `listConsumosFinalizados` (sem log, sem contador) | ⚠️ parcial (piorada em relação à necessidade) | `src/backend/index.ts:79-85` (`/health`); `SaldoAlocacaoAdiantamentoService.ts` (sem `LogService`) |
| Health Checks | `/health` + `/health/pipelines` (pré-existentes) rodam contra o processo; **nenhum health check confirma** que o cache de borderô está fresco o suficiente para a semântica nova estar ativa | ⚠️ parcial | `docs/runbooks/rollback.md:54-70` |
| Feature Flags | Kill-switches existem (`RECEBIMENTOS_ENABLED`, etc) mas o delta **não introduz um** para a nova semântica de saldo. Se `listConsumosFinalizados` retornar consumo errado em prd, a única saída é `git revert` + deploy | ❌ ausente (para este delta) | `grep -n "process.env" SaldoAlocacaoAdiantamentoService.ts` → 0 |

## 4. Findings

### F-deployability-1: Convergência da nova semântica de saldo é invisível pós-deploy

- **Severidade**: P2
- **Tactic violada**: Deployment observability, Scale Rollouts
- **Localização**: `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts` (arquivo inteiro — sem uso de `LogService`); `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211` (`listConsumosFinalizados`)
- **Evidência (objetiva)**:
  ```
  $ grep -n "LogService\|logger\|log\." src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts
  (vazio)

  ADR-0046 §Consequências:
   "Até a 1ª ingestão pós-deploy, as linhas antigas do cache têm `atualizado_em` posterior ao
    último `started_at` e seguem descontando, como hoje."

  Query filtra sem instrumentar:
    b.atualizado_em < r.started_at
  (PermutaExecucaoRepository.ts:202)
  ```
- **Impacto técnico**: entre o merge/deploy e a 1ª ingestão que faz `started_at` avançar sem tocar o `atualizado_em` do cache, `Σ naoConsumido = Σ valorAlocado` para todos os adtos — o `saldoRestante` mantém o comportamento pré-delta (subestima o saldo, sentido seguro), mas o operador **não tem sinal** de que o caso do adto 12860 passou de −19.257,73 para 30.364,73. Se a próxima ingestão falhar (a cron `ingest-permutas` alerta pelo ADR-0042 apenas quando o run inteiro morre, não quando ele passa sem popular `last_ingest_run_id` para um adto específico), a divergência com o ERP pode ficar em pé indefinidamente sem alerta.
- **Impacto de negócio**: Kavex/Columbia não sabem quando a correção da ADR-0046 "entrou em vigor" para cada adto. Se um analista abrir o painel logo após o deploy e ver o mesmo saldo negativo de antes, ele reabrirá o incidente como regressão — apesar de o comportamento estar correto (janela conservadora).
- **Métrica de baseline**: 0 logs/métricas emitidos pelo `SaldoAlocacaoAdiantamentoService` ou pela query `listConsumosFinalizados`. Nenhum contador de "consumos aplicados no snapshot atual". ADR-0046 nomeia 2 adtos + 1 "outro" de risco residual, sem detector automático.

### F-deployability-2: Nova semântica de `saldoRestante` não tem kill-switch para reverter sem redeploy

- **Severidade**: P2
- **Tactic violada**: Feature Flags, Scale Rollouts
- **Localização**: `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:52-71` (`naoConsumido`); `src/backend/domain/service/permutas/GestaoPermutasService.ts:349-370`; `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:246-252`
- **Evidência (objetiva)**:
  ```
  $ grep -n "process.env\|EnvironmentProvider" src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts
  (vazio)

  $ grep -n "process.env\|EnvironmentProvider" src/backend/domain/service/permutas/GestaoPermutasService.ts | head -3
  (vazio para o path novo)
  ```
  Compare com o padrão vigente do repo (`render.yaml:41-71`), onde `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED` são kill-switches manuais que desligam frentes inteiras sem redeploy.
- **Impacto técnico**: se a nova regra "subtrair só o não-consumido" produzir um valor errado em prd (o ADR nomeia 3 adtos de risco residual — bordero `fin=1` sem abate no ERP), a única mitigação é `git revert` + esperar o autoDeploy do Render. Como Render leva ~3-5 min para reconstruir e reimplantar (ver `docs/runbooks/rollback.md:38`), o MTTR fica limitado ao pipeline, não ao dashboard.
- **Impacto de negócio**: um super-cálculo de saldo permitiria super-alocação (aloca mais do que o ERP tem). O ADR compensa dizendo "na dúvida, não conta", mas o risco residual documentado é justamente o **oposto**: consumir o que o ERP não abateu. Sem flag, a defesa depende só da qualidade do próprio código.
- **Métrica de baseline**: 3 kill-switches no `render.yaml` para outras frentes (`RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`); 0 para Permutas / regra de saldo.

### F-deployability-3: Contrato `alocacoes` em `ja-permutado` só toma efeito quando FE e BE do delta estão ambos no ar

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts (ordem indeterminada de deploy FE↔BE)
- **Localização**: `src/backend/domain/service/permutas/GestaoPermutasService.ts:353-360` (envia `alocacoes` para `ja-permutado`); `src/frontend/app/permutas/components/historico.ts:20-34, 87-113` (consumidor); `src/frontend/app/permutas/page.tsx:594-604`
- **Evidência (objetiva)**:
  ```
  # backend
  const exibeAlocacoes = podeAlocar || status === 'ja-permutado';
  # (GestaoPermutasService.ts:355)

  # frontend
  const valorLancado = (p) =>
    p.alocacoes && p.alocacoes.length > 0
      ? p.alocacoes.reduce((s, al) => s + al.valorAlocado, 0)
      : p.valorMoedaNegociada
  # (historico.ts:20-23)
  ```
  Render e Vercel disparam autoDeploy em paralelo no mesmo push a `main`. Não há sequenciamento nem gate cruzado.
- **Impacto técnico**: os dois lados são defensivos (backend sempre ok; frontend usa optional chaining + fallback neutro), então **não há quebra funcional em nenhuma ordem**. O único efeito observável é: se o Vercel promover primeiro, o Histórico não mostra as linhas `ja-permutado` novas até o Render terminar; se o Render promover primeiro, o Histórico não muda até o Vercel terminar. Janela típica: minutos.
- **Impacto de negócio**: mínimo — a janela é curta e a piora é "menos linhas de histórico do que o esperado", nunca dado errado. Registrado por completude do modelo Bass (a plataforma não tem gate de ordem entre FE e BE, e este delta é o típico caso onde isso importaria).
- **Métrica de baseline**: 2 pipelines autoDeploy paralelos (Render + Vercel) sem gate cruzado; 1 contrato aditivo (`alocacoes` em `ja-permutado`); 0 quebras funcionais medidas em nenhuma ordem.

### F-deployability-4: Bump de versão do app (v0.37.0) ainda não aplicado — green criterion #11 pendente

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `src/backend/package.json:3` + `src/frontend/package.json:3` (ambos em `0.36.4`); `CHANGELOG.md:3` (topo é `v0.36.4`, sem bloco `## Não lançado` para o delta); `scripts/bump-version.ps1`
- **Evidência (objetiva)**:
  ```
  $ jq -r .version src/backend/package.json src/frontend/package.json
  0.36.4
  0.36.4

  $ head -3 CHANGELOG.md
  # Columbia Financeiro — Changelog

  ## v0.36.4 (2026-09-14) — o pré-voo enxerga alocação nunca executada

  # _shared-metrics.md §"Pendentes do orquestrador":
  #   "Regis-Review, rebase, bump de versão, PR."
  ```
  O delta traz 3 `fix(permutas)` (ce571d9, 6639663, 9b6097e) que qualificam para bump `minor` por semver (mudança de regra da elegibilidade + saldo, ADR-0046). O CLAUDE.md §Green criteria #11 exige bump antes do PR quando o delta tem `feat`/`fix`/`perf`.
- **Impacto técnico**: se o PR for aberto/mergeado antes do bump, o `/health` de prd continuará devolvendo `version: "0.36.4"` mesmo rodando o código do delta. A tag automática (`.github/workflows/ci.yml:48-73`) não dispara sem bump — o release é silencioso.
- **Impacto de negócio**: a Kavex perde a rastreabilidade "quando a regra da ADR-0046 entrou em prd?" (sem tag `v0.37.0`, o commit precisa ser correlacionado à mão pela mensagem). Combinado com F-deployability-1 (convergência invisível), o incidente pós-deploy fica sem âncora temporal.
- **Métrica de baseline**: 1 bump pendente (`0.36.4 → 0.37.0`); 6 commits do delta sem `chore(release)`; 0 tags Git para o delta.

## 5. Cards Kanban

### [deployability-1] Instrumentar `SaldoAlocacaoAdiantamentoService` com log/métrica de convergência

- **Problema**
  > A ADR-0046 documenta que a nova semântica do `saldoRestante` só toma efeito depois da 1ª ingestão pós-deploy que renove `permuta_eleicao_run.started_at` sem tocar `permuta_bordero.atualizado_em`. Hoje, nenhum log/contador conta "quantos consumos foram aplicados" nem "quantos adtos ainda estão na janela conservadora". Operador vê o painel após deploy e não sabe se o comportamento antigo persistente é bug ou convergência natural.

- **Melhoria Proposta**
  > Adicionar `@inject(LogService)` em `SaldoAlocacaoAdiantamentoService` e emitir uma linha `info` por chamada de `carregarConsumosPorAdiantamento`: `{ adtos_com_consumo, total_consumos, adtos_sem_consumo, run_started_at_min, cache_atualizado_em_max }`. Ideal: expor essas contagens no `/health/pipelines` (o middleware já existe). Tactic Bass: **Deployment observability**.

- **Resultado Esperado**
  > Após 1 ingestão pós-deploy, o operador consulta o `/health/pipelines` e vê "adtos com consumo aplicado: 128/1247, cache_atualizado_em_max: 2026-09-14T15:36Z, started_at_min: 2026-09-14T16:00Z". Fica óbvio quando a semântica nova pegou.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Logs emitidos por `SaldoAlocacaoAdiantamentoService`: 0 → ≥1 por chamada
  - Métrica exposta em `/health/pipelines` para convergência: ausente → presente
- **Risco de não fazer**: primeiro incidente pós-deploy é reaberto como regressão da ADR-0046, e o autor gasta tempo provando que "não é bug, é convergência". Perde-se o âncora temporal do fix.
- **Dependências**: nenhuma.

### [deployability-2] Introduzir kill-switch de regra do `saldoRestante` (env-var `PERMUTAS_SALDO_NAO_CONSUMIDO_ENABLED`)

- **Problema**
  > A ADR-0046 nomeia 3 adtos de "risco residual" (bordero `fin=1` sem abate no ERP) que poderiam produzir super-cálculo do saldo se o cache não pegar o motivo real. Sem kill-switch, a única mitigação em prd é `git revert` + esperar o autoDeploy — MTTR limitado pela reconstrução do Render (~3-5 min), não pelo dashboard.

- **Melhoria Proposta**
  > Adicionar `PERMUTAS_SALDO_NAO_CONSUMIDO_ENABLED` em `render.yaml` (`sync: false`, default `true`). Em `SaldoAlocacaoAdiantamentoService.somaNaoConsumida`, checar a flag via `EnvironmentProvider`: se `false`, cair no comportamento pré-delta (`Σ valorAlocado`). Mesmo pattern do `RECEBIMENTOS_ENABLED`. Tactic Bass: **Feature Flags + Scale Rollouts**.

- **Resultado Esperado**
  > Se um adto começar a apresentar super-cálculo, o operador seta `false` no dashboard do Render e o painel volta ao comportamento antigo em segundos, sem redeploy. `git revert` fica como fix definitivo, sem pressão.

- **Tactic alvo**: Feature Flags
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Kill-switches para regras críticas de Permutas: 0 → 1
  - MTTR para reverter comportamento do saldo: ~5min (revert+deploy) → ~30s (dashboard flip)
- **Risco de não fazer**: um erro de regra em 1 dos 3 adtos residuais escala para incidente sem mitigação rápida.
- **Dependências**: deployability-1 (a flag e a métrica são naturalmente correlacionadas).

### [deployability-3] Bumpar app para `v0.37.0` (lockstep FE+BE) e escrever entrada de CHANGELOG antes do PR

- **Problema**
  > Delta traz 3 `fix(permutas)` sobre regra de elegibilidade e saldo (ADR-0046), o que qualifica para bump `minor` por semver. `_shared-metrics.md` lista o bump como pendente. Sem ele, `/health` continuará devolvendo `0.36.4` rodando código novo, e a `tag-release` do CI (`ci.yml:48-73`) não dispara — a release fica sem tag, sem GitHub Release e sem entrada de changelog.

- **Melhoria Proposta**
  > Rodar `scripts/bump-version.ps1 -Execute -Level minor` (ou o equivalente Node se o card `deployability-3` de 2026-09-08 já foi implementado). Editar `CHANGELOG.md` com bloco `## v0.37.0 (2026-09-14) — resíduo de R$1,00, prioridade completa e saldo sem dupla contagem (ADR-0046)`, incluindo os casos canônicos (12860, 9328) como narrativa de negócio. Commit `chore(release): v0.37.0`. Tactic Bass: **Script Deployment Commands**.

- **Resultado Esperado**
  > `jq -r .version src/*/package.json` = `0.37.0` para os dois; `git tag -l v0.37.0` presente após o merge; `/health` devolve `version: "0.37.0"` — permitindo âncora temporal do fix.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - versão de app: `0.36.4` → `0.37.0` (FE=BE)
  - tag Git para o delta: ausente → `v0.37.0`
  - bloco no CHANGELOG.md: ausente → presente com narrativa dos casos 12860/9328
- **Risco de não fazer**: release silencioso; correlacionar "quando a ADR-0046 entrou" ao commit vira arqueologia manual.
- **Dependências**: nenhuma (pré-requisito do PR pelo green criterion #11).

### [deployability-4] Documentar sequência e efeito do primeiro ingest pós-deploy no CHANGELOG e no runbook

- **Problema**
  > A "convergência natural" descrita na ADR-0046 §Consequências (até a 1ª ingestão pós-deploy, `saldoRestante` mantém o comportamento pré-delta) é sutil: FE se comporta como antes por um tempo, aí muda. Sem nota explícita no CHANGELOG e no runbook, o suporte ficará confuso e vai abrir tickets falso-positivo.

- **Melhoria Proposta**
  > No bloco de v0.37.0 do CHANGELOG (card `deployability-3`), incluir uma linha "por que o adto 12860 pode ainda aparecer com saldo negativo por até 1h após o deploy — a nova semântica só ativa depois da próxima ingestão de permutas". Adicionar seção "Convergência pós-deploy (ADR-0046)" em `docs/runbooks/rollback.md` (ou runbook novo) explicando o que verificar em `permuta_bordero.atualizado_em` vs `permuta_eleicao_run.started_at` para confirmar convergência. Tactic Bass: **Deployment observability + Script Deployment Commands**.

- **Resultado Esperado**
  > Suporte tem checklist: "1) `/health` = 0.37.0; 2) `SELECT max(atualizado_em) FROM permuta_bordero` vs `SELECT max(started_at) FROM permuta_eleicao_run` — segundo deve ser maior; 3) painel do adto 12860 mostra `saldoRestante` = R$ 30.364,73". Ticket "não convergiu" deixa de ser mistério.

- **Tactic alvo**: Deployment observability
- **Severidade**: P3
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-deployability-1, F-deployability-3
- **Métricas de sucesso**:
  - Nota de convergência no CHANGELOG v0.37.0: ausente → presente
  - Runbook "convergência pós-deploy": ausente → presente
- **Risco de não fazer**: baixo, mas re-abre incidentes pela primeira semana pós-deploy.
- **Dependências**: deployability-3.

## 6. Notas do agente

- **Cross-QA para o consolidator**: F-deployability-1 (convergência invisível) tem sobreposição com **testability** (não há teste E2E que confirme a semântica nova ativa em prd) e com **fault-tolerance** (a janela conservadora é uma tactic implícita de fault-tolerance que ninguém nomeou). F-deployability-2 (kill-switch) casa com **modifiability** (o serviço puro `SaldoAlocacaoAdiantamentoService` é ideal para receber a flag em 3 linhas).
- **Não medível localmente**: duração do cron `ingest-permutas` (proxy para o tempo até a convergência) — exige acesso ao log do GitHub Actions em prd.
- **Escopo excluído**: findings pré-existentes do ciclo 2026-09-08 (Node version divergence, bump-version.ps1 PowerShell, preDeployCommand mismatch) — este último parece resolvido no `render.yaml` atual (`# SEM preDeployCommand — deliberado, não esquecimento` em `render.yaml:20-30`). Nenhum foi agravado por este delta.
- **Ground-truth passou** (247 linhas, 0 DIVERGENTE) — degrade real do risco residual do ADR-0046 para nível monitorado; ainda assim o kill-switch (deployability-2) é apólice cheap.
