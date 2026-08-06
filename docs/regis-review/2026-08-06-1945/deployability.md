---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-06-1945
agent: qa-deployability
generated_at: 2026-08-06T19:45:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de desenvolvimento (Kavex) | Merge do tweak `bordero-vazio-orfao` em `main` — 2 serviços backend (`ReconciliacaoPermutaService.removerBorderoOrfao` + `BorderoGestaoService.assertBorderoTemItens`) e 1 componente frontend (`BorderosPanel.tsx` — `vazio`) que dependem uns dos outros para o efeito completo | Frontend na Vercel (deploy hook) + Backend Express no Render (deploy hook) + ERP Conexos externo (efeito colateral irreversível de `excluirBordero`) | Produção com escrita habilitada (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`); analistas usando o painel de Permutas simultaneamente | Deploy dos dois lados leva o comportamento novo à produção sem que a janela intermediária (FE-novo/BE-velho ou BE-novo/FE-velho) crie regressão; qualquer rollback preserva integridade do borderô no ERP | Janela de inconsistência FE↔BE ≤ tempo entre os dois deploy hooks; 0 borderôs corrompidos por deploy parcial; rollback de código em < 5 min (revert + push); efeito ERP (`excluirBordero`) recuperável em ≤ 1 reconciliação subsequente (borderô órfão é vazio por definição) |

Nota: o delta **não adiciona** rota, migration, env var, dependência nem infra — os vetores clássicos de risco de deploy (schema drift, config drift, quebra de contrato de API) estão fora do escopo. O risco residual está na coordenação de dois deploys e no efeito externo de `excluirBordero` no ERP.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations adicionadas pelo delta | 0 | 0 (delta puramente comportamental) | ✅ | `ls src/backend/migrations` + `git status src/backend/migrations` (working tree limpo) |
| Env vars novas exigidas | 0 | 0 | ✅ | `git diff` — nenhum `process.env` ou `EnvironmentProvider.getEnvironmentVars` novo |
| Rotas HTTP novas | 0 | 0 | ✅ | `git diff src/backend/routes` (não tocado) |
| Dependências npm adicionadas | 0 | 0 | ✅ | `src/backend/package.json` e `src/frontend/package.json` — só versão bumpada em commits anteriores |
| Versão FE == BE (lockstep) | 0.20.1 == 0.20.1 | Igualdade obrigatória (CLAUDE.md, `scripts/bump-version.ps1`) | ✅ | `grep '"version"' src/{backend,frontend}/package.json` |
| CHANGELOG.md presente | Sim, atualizado até v0.20.1 | Presença + entrada por release | ✅ | `head -20 CHANGELOG.md` |
| Bump de versão para o tweak | Ainda não aplicado (worktree pré-bump) | Deve rodar `scripts/bump-version.ps1 -Execute` antes do PR (Green criterion #10) | ⚠️ Pendente | Fluxo do pipeline; delta contém `fix` (correção de bug produção 18538) → semver PATCH obrigatório |
| Pipeline CI presente | Sim (`.github/workflows/ci.yml`) — typecheck, lint, audit, test+coverage, build, tag-release automático | Pipeline obrigatório | ✅ | `.github/workflows/ci.yml` |
| Gate de escrita cobrindo `removerBorderoOrfao` | Transitivo — `borderoCriadoAqui` só vira `true` dentro do `try` que fica **depois** de `if (dryRun) continue` (linhas 148-164 de `ReconciliacaoPermutaService.ts`), então a limpeza NUNCA roda em dry-run/write-disabled | Cobertura explícita ou transitivamente garantida | ✅ (transitivo) | `ReconciliacaoPermutaService.ts:140,148-164,244-255,291-293` |
| Reversibilidade de código do delta | Alta (7 arquivos, +229/-3, sem migration, sem contrato) | `git revert` limpo | ✅ | `git diff --stat` |
| Reversibilidade do efeito externo (`excluirBordero`) | Baixa — chamada ao ERP é irreversível; `git revert` não ressuscita o borderô apagado | Recuperabilidade via re-execução do fluxo | ⚠️ Parcial | Um borderô órfão é, por definição, vazio; próxima reconciliação recria — impacto real baixo, mas não-zero |
| Deploy atomicidade FE↔BE | Não-atômico (Render e Vercel são hooks independentes) | Idealmente atômico ou explicitamente compatível nos dois sentidos | ⚠️ Aceitável | Análise de ordens de deploy — ver seção 4, F-deployability-1 |
| Métricas de produção pós-deploy (observabilidade do `BUSINESS_INFO`/`BUSINESS_WARN` de `removerBorderoOrfao`) | ⚠️ Não medível localmente | Alerta operacional se `falha ao remover o borderô órfão` > 0/dia | ⚠️ Requer CloudWatch/Sentry | `LogService` grava, mas não há canário configurado |

## 3. Tactics — Cobertura no nf-projects

Escopo: **manage deployment pipeline** e **manage deployed system** avaliados exclusivamente sob a lente do delta.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Script Deployment Commands | `.github/workflows/ci.yml` faz typecheck/lint/audit/test/build; `scripts/bump-version.ps1` faz bump FE+BE em lockstep; deploy = Render/Vercel hook | ✅ presente | `.github/workflows/ci.yml`, CLAUDE.md §Development Pipeline |
| Rollback | `git revert` do commit + push aciona novo deploy hook. Frontend e backend rollback independentes | ✅ presente (código) / ⚠️ parcial (efeito ERP `excluirBordero` não é revertido por rollback de código) | `ReconciliacaoPermutaService.ts:326` (`excluirBordero`) — chamada externa irreversível |
| Scale Rollouts (canary/blue-green/rolling) | Não há canary configurado; Render/Vercel fazem rolling swap simples. Sem tráfego dividido | ⚠️ parcial | Stack não suporta canary nativo; delta não introduz mecanismo de gradual enablement |
| Package Dependencies | Sem dependência nova; `package-lock.json` intacto | ✅ presente | `git diff src/{backend,frontend}/package.json` (sem alteração no delta) |
| Logical Grouping (feature flag / kill-switch) | O gate `CONEXOS_WRITE_ENABLED` cobre **transitivamente** `removerBorderoOrfao` (via `borderoCriadoAqui` set após `criarBordero`, que só roda no ramo não-dry-run). Não há flag específica para desligar SÓ a auto-limpeza | ⚠️ parcial | `ReconciliacaoPermutaService.ts:140,148-164,254,291-293` |
| Physical Grouping | N/A ao delta — FE e BE já estão em runtimes fisicamente separados (Vercel/Render); delta não muda topologia | N/A | — |
| Surge Protection | N/A ao delta — não altera concorrência, filas ou vazão | N/A | — |
| Idempotent deploys | Deploy hooks Vercel/Render são naturalmente idempotentes (deploy do mesmo commit = mesmo artefato) | ✅ presente | `.github/workflows/ci.yml` (job `tag-release` é idempotente com `git rev-parse "$TAG"`) |
| Drift detection (config vs. runtime) | Nenhuma detecção agendada; `CONEXOS_WRITE_ENABLED` na plataforma pode divergir do esperado sem alarme | ❌ ausente (pré-existente) | Não introduzido nem agravado pelo delta |
| Reproducible builds | `package-lock.json` versionado; Node 24 pinado no CI (`actions/setup-node@v4` com `node-version: '24'`); `npm ci` | ✅ presente | `.github/workflows/ci.yml:20-24,40-44` |
| Per-tenant blast-radius limit | N/A hoje — não há multi-tenant provisionado (CLAUDE.md §Tenants); um único cliente (Columbia Trading). Alvo Terraform ainda inexistente | N/A no delta | CLAUDE.md §Estado Atual vs. Alvo |
| Deployment observability | `LogService.info`/`warn` com `LOG_TYPE.BUSINESS_INFO`/`BUSINESS_WARN` marca cada limpeza órfã e cada falha da limpeza. Bom para forense post-deploy | ✅ presente (código) / ⚠️ parcial (alerta em produção depende de dashboard não verificado) | `ReconciliacaoPermutaService.ts:314-343` |
| Active Redundancy / Passive Redundancy | N/A — não aplicável a delta puramente de lógica de aplicação | N/A | — |

## 4. Findings (achados)

### F-deployability-1: Deploy não-atômico FE↔BE numa mudança que **exige** as duas guardas, mitigado por lockstep de versão mas não eliminado

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts / Logical Grouping (deploys coordenados)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:205` (`assertBorderoTemItens` no fluxo `finalizarBordero`); `src/frontend/app/permutas/BorderosPanel.tsx:468-484` (`vazio` desabilita "Aprovar")
- **Evidência (objetiva)**:
  ```
  Vercel (FE) e Render (BE) são deploy hooks independentes disparados pelo mesmo push
  em main. Não há barramento que garanta atomicidade. O ADR-0030 define DUAS guardas
  (produtor + consumidor), então em uma janela de segundos-a-minutos os deploys ficam
  desincronizados.

  Análise por ordem de subida:
  A) FE novo + BE velho:
     - UI desabilita "Aprovar" para borderô sem `settled`. Analista pelo painel = seguro.
     - Bypass via curl/API atinge o BE velho (sem assertBorderoTemItens). ERP recusa com
       "ESTE BORDERÔ NÃO POSSUI ITENS" (mensagem crua) — regressão para o estado antes
       do tweak, sem corrupção nova.
     - `removerBorderoOrfao` ausente: casco continua a nascer em reconciliações que
       falham totalmente — comportamento pré-existente, não novo.
  B) BE novo + FE velho:
     - UI ainda mostra "Aprovar" habilitado. Clique dispara BE novo → 400 com mensagem
       amigável do `assertBorderoTemItens` ("use Excluir para removê-lo").
     - `removerBorderoOrfao` já ativo — melhora imediata.
  ```
- **Impacto técnico**: Nas duas ordens a degradação é **segura** (nunca corrompe dado, no pior caso volta à mensagem crua do ERP). Não há caminho que produza estado inconsistente entre FE e BE.
- **Impacto de negócio**: Analista percebe brevemente mensagem crua do ERP se clicar "Aprovar" na janela FE-velho/BE-velho (Ordem A com bypass) — reforço da situação pré-tweak. Sem perda financeira. Lockstep de versão via `bump-version.ps1` sincroniza o release, mas não elimina o gap de deploy físico.
- **Métrica de baseline**: janela de risco = intervalo entre conclusão do deploy Vercel e Render após o mesmo commit (não medida; empiricamente <5 min por hook). Volume de deploys por dia <5 (fluxo `/feature-tweak` gate lockstep).

### F-deployability-2: `excluirBordero` no ERP é irreversível — rollback de código não desfaz efeito externo

- **Severidade**: P2
- **Tactic violada**: Rollback (o rollback do artefato de software não implica rollback do estado externo)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:325-326` (`await this.conexosBaixaClient.excluirBordero({ filCod, borCod })`)
- **Evidência (objetiva)**:
  ```
  A limpeza best-effort chama excluirBordero no Conexos. Se após o deploy for
  descoberto que `removerBorderoOrfao` está apagando borderôs além do esperado
  (ex.: bug que confunde borderôs COM item por race no listBaixas, ou por evolução
  futura no que conta como "confirmada"), o `git revert` do commit não recupera
  os borderôs já apagados.

  Guard-rails atuais que reduzem o dano:
  - `borderoCriadoAqui` só vira true dentro do try onde criarBordero acabou de rodar
    (linha 254) → nunca apaga borderô pré-existente que a chamada não criou.
  - Fail-safe: releitura de listBaixas antes de excluir; se ERP disser >0 itens,
    NÃO apaga e loga BUSINESS_WARN.
  - Só roda quando NENHUMA alocação da chamada terminou `settled`.
  ```
- **Impacto técnico**: Um borderô órfão é, **por definição**, vazio no ERP — ou seja, o "dado perdido" é apenas o `bor_cod` numérico. O próximo `reconciliar` re-cria automaticamente um novo borderô no próximo `criarBordero`. Impacto real de recuperação é baixo, mas não-zero em termos de rastreabilidade fiscal (o número apagado some do histórico do ERP).
- **Impacto de negócio**: Auditoria/contabilidade pode questionar buracos na sequência de `bor_cod` no ERP (números pulados). Sem impacto financeiro direto — a baixa efetiva depende de `settled`, não da existência do casco.
- **Métrica de baseline**: 1 caso conhecido pré-delta (borderô 18538, 2026-08-06) que motivou o tweak. Sem histograma; instrumentar a partir dos logs `BUSINESS_INFO`/`BUSINESS_WARN` para acompanhar frequência pós-deploy.

### F-deployability-3: Ausência de kill-switch dedicado para a auto-limpeza — só o gate nuclear `CONEXOS_WRITE_ENABLED` desliga

- **Severidade**: P2
- **Tactic violada**: Logical Grouping (feature flag granular)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:291-343` (`removerBorderoOrfao` e seu gate implícito via `borderoCriadoAqui`)
- **Evidência (objetiva)**:
  ```
  A cobertura pelo CONEXOS_WRITE_ENABLED é transitiva e correta:
    - linha 140: dryRun = !writeEnabled || conexosDryRun || dryRunOverride
    - linha 150: if (dryRun) push('dry-run') + continue → não seta borderoCriadoAqui
    - linha 254: borderoCriadoAqui = true (só depois de criarBordero, no ramo não-dry-run)
    - linha 291: if (borderoCriadoAqui && ...) removerBorderoOrfao(...)

  Logo: em dry-run/write-disabled a limpeza NUNCA roda. ✅

  Mas se em produção `removerBorderoOrfao` começar a se comportar mal, o único
  interruptor é CONEXOS_WRITE_ENABLED=false — o que também desliga toda a escrita
  de baixas (impacto nuclear no fluxo de Permutas). Não há flag granular tipo
  CONEXOS_AUTO_CLEANUP_ORFAO_ENABLED.
  ```
- **Impacto técnico**: Time-to-mitigate para bug isolado na auto-limpeza é hoje "revert do código + deploy" (ordem de minutos) em vez de "toggle no dashboard" (segundos). Aceitável para um caminho novo com 6 testes cobrindo os casos críticos, mas cria assimetria com `CONEXOS_WRITE_ENABLED`.
- **Impacto de negócio**: Se algo na limpeza mostrar-se defeituoso em produção, o único mitigante granular é reverter o release; nenhuma toggle intermediária. Baixo, dado o baixo volume esperado (só dispara em falha total das baixas).
- **Métrica de baseline**: 0 flags granulares para esse caminho. Custo de introdução: 1 env var + 1 if. Custo de omissão: 1 ciclo de release para desligar em incidente.

### F-deployability-4: Versão do app ainda não bumpada no worktree — Green Criterion #10 pendente

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands (bump + CHANGELOG são parte do pipeline canônico)
- **Localização**: `src/backend/package.json`, `src/frontend/package.json`, `CHANGELOG.md`
- **Evidência (objetiva)**:
  ```
  $ grep '"version"' src/backend/package.json src/frontend/package.json
  src/backend/package.json:    "version": "0.20.1"
  src/frontend/package.json:  "version": "0.20.1"

  Head do CHANGELOG.md: última entrada é v0.20.1 (2026-08-05).

  Delta contém correção de bug produção (borderô 18538) → semver PATCH exigido
  (v0.20.2) por CLAUDE.md §Green Criterion #10 antes do PR.
  ```
- **Impacto técnico**: Sem bump, o job `tag-release` do CI (`.github/workflows/ci.yml:47-70`) percebe o tag `v0.20.1` já existente e sai como no-op. O deploy do delta iria para produção **sem versão nova rastreável no GitHub Release**.
- **Impacto de negócio**: Rastreabilidade / rollback por tag prejudicada — o incidente Simone 2026-08-06 → correção 2026-08-06 ficaria colado sob a versão do release anterior. Diagnóstico futuro perde a assinatura da versão. Correção óbvia e barata via `scripts/bump-version.ps1 -Execute`.
- **Métrica de baseline**: versão FE=BE=0.20.1 (pré-tweak); alvo v0.20.2 (patch — correção de bug).

## 5. Cards Kanban

### [deployability-1] Documentar ordem de deploy segura FE↔BE para o par de guardas de Permutas

- **Problema**
  > O ADR-0030 cria duas guardas complementares (backend `assertBorderoTemItens` + frontend `vazio`), mas Render (BE) e Vercel (FE) são deploys independentes. A janela intermediária é **segura nos dois sentidos** (F-deployability-1), mas isso não está escrito em lugar nenhum — o próximo tweak em Permutas que criar uma guarda cruzada FE/BE pode não ter a mesma sorte.

- **Melhoria Proposta**
  > Adicionar seção "Ordem de deploy" no ADR-0030 (ou em `docs-contexto/`) documentando: (a) lockstep de versão via `scripts/bump-version.ps1` como mecanismo de correlação; (b) checklist de "degradação segura FE-primeiro / BE-primeiro" que agentes futuros devem preencher em ADRs que introduzem guardas duplicadas. Tactic Bass: **Scale Rollouts** (documentar o rollout mesmo quando é simples).

- **Resultado Esperado**
  > Toda mudança FE↔BE com guarda dupla tem análise "ordem A vs. ordem B" registrada no ADR. Estado do sistema: 0 tweaks recentes com guarda dupla sem essa análise → 100%.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - ADRs com guarda dupla FE↔BE contendo seção "ordem de deploy": 0 → 100% (deste tweak em diante)
- **Risco de não fazer**: Próxima guarda dupla FE↔BE pode escolher uma direção onde a ordem intermediária é regressiva (não meramente estagnada), sem que o revisor perceba.
- **Dependências**: Nenhuma.

### [deployability-2] Instrumentar alerta de produção sobre `BUSINESS_WARN` "falha ao remover o borderô órfão"

- **Problema**
  > `removerBorderoOrfao` é best-effort com fallback silencioso (`BUSINESS_WARN` em `ReconciliacaoPermutaService.ts:335-342`). Se ele começar a falhar repetidamente em produção, o casco continua acumulando no painel e ninguém sabe até um analista reclamar — o incidente Simone 2026-08-06 leva 3 meses a acontecer, exatamente o padrão que motivou este tweak. Além disso, o log `BUSINESS_INFO` positivo ("borderô órfão removido") é a única forma de medir a frequência do problema em produção.

- **Melhoria Proposta**
  > Configurar alerta (CloudWatch / Sentry / equivalente da plataforma atual) em duas séries: (a) `count(BUSINESS_WARN, message contains "falha ao remover o borderô órfão") > 0 in 24h` → alerta; (b) dashboard com `count(BUSINESS_INFO, message contains "borderô órfão (vazio) removido")` como métrica de saúde do fluxo de reconciliação. Tactic Bass: **Deployment Observability**.

- **Resultado Esperado**
  > MTTA (mean time to acknowledge) de casos de borderô órfão que passam pelo fallback silencioso cai de "dias/semanas" para "<1 dia útil". Frequência da limpeza vira KPI observável.

- **Tactic alvo**: Deployment Observability
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Alertas configurados para o par `BUSINESS_INFO`/`BUSINESS_WARN` do órfão: 0 → 2
  - Ocorrências mensais medidas de "borderô órfão removido": não instrumentado → instrumentado
- **Risco de não fazer**: Regressão silenciosa da limpeza best-effort — o problema volta ao estado pré-tweak sem sinal de alarme.
- **Dependências**: Verificar stack de observabilidade atual (não coberto neste worktree — a plataforma runtime é Render/Vercel; provider de logs não foi inventariado).

### [deployability-3] Avaliar kill-switch granular para auto-limpeza de borderô órfão

- **Problema**
  > A auto-limpeza está transitivamente coberta pelo gate `CONEXOS_WRITE_ENABLED` (verificado: `borderoCriadoAqui` só vira true dentro do ramo não-dry-run), mas não tem interruptor próprio. Se o comportamento se mostrar defeituoso em produção, a única forma de desligar é `CONEXOS_WRITE_ENABLED=false`, que também para as baixas legítimas. Assimetria com o pattern existente de flag de escrita.

- **Melhoria Proposta**
  > Adicionar env var opcional `CONEXOS_AUTO_CLEANUP_ORFAO_ENABLED` (default `true` para preservar comportamento atual) via `EnvironmentProvider`, checada no início de `removerBorderoOrfao`. Documentar em `business-rules/fin010-write-contract.md` como override de emergência. Tactic Bass: **Logical Grouping** (flag granular).

- **Resultado Esperado**
  > Incidente hipotético na auto-limpeza mitigado por toggle em segundos, sem revert de código. Time-to-mitigate: minutos → segundos.

- **Tactic alvo**: Logical Grouping
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Kill-switches granulares para caminhos irreversíveis no ERP: 0 → 1
  - Time-to-mitigate estimado de bug isolado em `removerBorderoOrfao`: ~15 min (revert+redeploy) → <1 min (toggle)
- **Risco de não fazer**: Um bug futuro em `removerBorderoOrfao` (mesmo raro) exigirá revert de release para conter — impacto amplificado em janela de incidente.
- **Dependências**: Nenhuma.

### [deployability-4] Executar bump de versão v0.20.2 + entrada no CHANGELOG antes do merge

- **Problema**
  > `src/backend/package.json` e `src/frontend/package.json` seguem em `0.20.1` — versão da release anterior. Green Criterion #10 (CLAUDE.md) exige bump para deltas com `fix`, e o job `tag-release` do CI é idempotente por tag, então sem bump o deploy do delta vai a produção sem GitHub Release nova. Delta é `fix(permutas)` motivado por borderô 18538.

- **Melhoria Proposta**
  > Rodar `scripts/bump-version.ps1 -Execute` para bump semver PATCH (0.20.1 → 0.20.2). Atualizar `CHANGELOG.md` com entrada citando ADR-0030 e o borderô 18538 (mesmo padrão da v0.20.1). Commit `chore(release): v0.20.2`. Tactic Bass: **Script Deployment Commands**.

- **Resultado Esperado**
  > Tag `v0.20.2` publicada pelo job `tag-release` no push para main; GitHub Release criada com CHANGELOG.md como referência. Rastreabilidade de rollback preservada.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - `src/{backend,frontend}/package.json.version`: 0.20.1 → 0.20.2 (lockstep)
  - Entrada v0.20.2 em `CHANGELOG.md`: ausente → presente
- **Risco de não fazer**: Bloqueia Green Criterion #10 (o próprio pipeline recusa o PR); em produção o incidente 2026-08-06 fica sem tag rastreável.
- **Dependências**: Precede o PR (obrigatório).

## 6. Notas do agente

- Escopo restrito ao delta como pedido; todo o eixo Terraform/IaC/multi-tenant foi marcado N/A por decisão consciente — o repo não tem `infra/` e o delta não muda isso (CLAUDE.md §Estado Atual vs. Alvo).
- Confirmei por leitura de `ReconciliacaoPermutaService.ts:140,148-164,254,291-293` que `removerBorderoOrfao` é transitivamente coberta pelo gate `CONEXOS_WRITE_ENABLED`: em dry-run/write-disabled o `continue` na linha 163 impede `borderoCriadoAqui` de virar `true`, e a linha 291 curto-circuita. Nenhum P0 emerge desse eixo — o pedido inicial de verificar o gate levantou a bandeira, mas o código o passa.
- Métricas de produção (frequência real de órfãos, latência do `excluirBordero`, taxa de sucesso da limpeza) não são medíveis localmente. Recomendação para a próxima Regis-Review em produção: coletar contagem de `BUSINESS_INFO` "borderô órfão (vazio) removido" nos últimos 30 dias como baseline.
- **Cross-QA links para o consolidador**:
  - Performance: `assertBorderoTemItens` adiciona uma chamada extra ao `listBaixas` do ERP no caminho de `finalizarBordero` — impacto de latência mínimo, mas vale registrar (não medido).
  - Fault-tolerance: o padrão best-effort com `BUSINESS_WARN` de `removerBorderoOrfao` é boa cidadania; ligar com F-deployability-2 no relatório final (observabilidade é o par natural do best-effort).
  - Modifiability: F-deployability-3 (kill-switch granular) é também uma questão de **flexibility** — se o consolidador consolidar ambas, favor mesclar a proposta.
