---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-29-1628
agent: qa-deployability
generated_at: 2026-10-29T16:28:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

> Escopo real do repositório: **Express + Next.js, deploy via Render hook + Vercel**. O estado-alvo
> (Lambda + Terraform multi-tenant) é documentado no CLAUDE.md como roadmap, mas **não existe hoje**
> (`infra/` ausente, nenhum tenant provisionado). Toda métrica de Terraform/Lambda/CloudFront é
> declarada **não medível** aqui. O foco desta revisão é o que a feature `sispag-confirmar-em-conjunto`
> adiciona ao pipeline de deploy atual.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (merge na `main`) | Novo endpoint `POST /sispag/sugestao-boleto/confirmar-em-conjunto` + novo painel UI entra em produção | Backend Express (Render) + frontend Next.js (Vercel) | PRD com `SISPAG_LIVE_WRITE_ENABLED=on` em filial piloto | Deploy conclui, rota responde 200/400 esperado, kill-switch existente ainda governa escrita Conexos; se der ruim, rollback = redeploy do commit anterior pelo Render | Lead time commit→prd ≤ 15 min; rollback ≤ 5 min; 0 escritas Conexos indesejadas quando `SISPAG_LIVE_WRITE_ENABLED=off`; 0 migração/env var nova pendente |

A feature é **aditiva**: nenhum schema SQL novo, nenhuma env var nova, nenhum feature flag próprio
(reusa o kill-switch global `SISPAG_LIVE_WRITE_ENABLED` do ajuste de centavos — ADR-0074/0080). Isso
mantém o blast radius baixo, mas transfere para o kill-switch global a responsabilidade de canary da
nova rota, o que é frágil.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migração SQL nova no diff | 0 | 0 (feature aditiva) | ✅ | `git status --short` (sem `migrations/*.sql`) |
| Env vars novas no diff | 0 | 0 ou documentadas | ✅ | `grep -rn "EnvironmentProvider" src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts` → não lê env novo |
| Feature flag próprio da rota em conjunto | 0 (herda `SISPAG_LIVE_WRITE_ENABLED`) | ≥1 (canary granular por rota) | ⚠️ | ADR-0080 + código do serviço |
| Rota nova gated por permissão existente | sim (reusa `sispag:sugestao-boleto:confirmar`) | sim | ✅ | `src/backend/http/routePermissions.test.ts` (+534 asserts green) |
| LOC adicionadas no diff | 623 ins / 21 del em 18 arquivos | ≤ ~1k (feature coesa) | ✅ | `_shared-metrics.md` |
| Testes verdes antes do deploy | backend 6243/316, frontend 1424/127 | 100% | ✅ | shared metrics |
| Documentação de rollback do endpoint em conjunto | ausente (nenhum runbook/README do SISPAG tocado) | 1 parágrafo em `DEPLOY.md`/runbook | ⚠️ | `git diff --stat origin/main -- DEPLOY.md README.md` → 0 |
| Pipeline CI/CD rodando os gates no PR | não medível aqui (depende de `.github/workflows/*.yml`) | lint+typecheck+test+build obrigatórios | ⚠️ | fora do diff |
| Build artefato backend reproduzível (lockfile + build.js copia .sql) | lockfile presente; `migrations/*.sql` são tocados? **não** nesta feature | lockfile presente + assets não-TS copiados | ✅ | `src/backend/package-lock.json` + CLAUDE.md gotcha "produção roda `dist/`" |
| Lambda bundle size p50/p95 | **não medível** (sem Lambda) | — | — | `src/backend/lambda/` não existe |
| Terraform plan antes de apply | **não medível** (sem `infra/`) | — | — | repo não tem Terraform |
| Drift detection multi-tenant | **não medível** (sem tenants) | — | — | tabela "Tenants" vazia no CLAUDE.md |

> ⚠️ **Não medível localmente**: pipeline CI/CD real. Não há `.github/workflows/` modificado no diff; a
> verificação de que `npm run typecheck && npm run lint && npm test && npm run build` roda no PR
> antes do deploy hook do Render depende do estado dos workflows no `main`. Recomenda-se abrir
> `.github/workflows/*.yml` separadamente e, se o `build` do backend não roda no CI, adicionar.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green) | Render = redeploy do commit; não há canary por rota nem por filial. A feature herda `SISPAG_LIVE_WRITE_ENABLED` (kill-switch global ligado numa filial piloto), que serve de proxy grosseiro de canary | ⚠️ parcial | ADR-0074 §kill-switch; `SISPAG_BIND_CODBAR_FILIAIS` padrão por filial não foi replicado aqui |
| Rollback | Reverter commit → Render redeploy. **Sem Lambda alias, sem versão explícita**. Rollback = ~5 min. Dados: a rota em conjunto só grava via caminho já existente (`confirmar` por título); rollback não deixa registros órfãos | ✅ presente | caminho atual de deploy; `ConfirmacaoEmConjuntoService` delega ao serviço singular |
| Script Deployment Commands | `scripts/bump-version.ps1` + `npm run build` + Render hook. Diff não altera scripts | ✅ presente | `scripts/bump-version.ps1` referenciado em CLAUDE.md |
| Logical Grouping | Serviço novo isolado em `domain/service/sispag/ConfirmacaoEmConjuntoService.ts` + regra em `RegraIrmaosConjunto.ts`; interface em `domain/interface/sispag/ConfirmacaoEmConjunto.ts`; erro próprio `BatchConfirmationTooLargeError`. Agrupamento DDD limpo | ✅ presente | arquivos novos |
| Physical Grouping | Monólito Express → tudo deploya junto. Sem split físico por frente | N/A | Lambda-por-frente é alvo, não existe |
| Package Dependencies | Zero dependências novas no `package.json` (backend e frontend). Diff não toca `package*.json` | ✅ presente | `git diff --stat origin/main -- '**/package*.json'` → 0 |
| Surge Protection | Guarda `BatchConfirmationTooLargeError` quando `rows > 30` (medido: 31 rows → 422). Protege o Conexos de um clique de 500 itens | ✅ presente | `BatchConfirmationTooLargeError.ts`; shared metrics (31 rows → 422) |
| Idempotent deploys | Redeploy do mesmo commit = mesmo artefato (lockfile commitado; `tsc` determinístico). Nada no diff quebra isso | ✅ presente | `src/backend/package-lock.json` |
| Reproducible builds | Lockfile presente, `tsc` emite `dist/`. Gotcha conhecido do `.sql` não se aplica (sem SQL novo) | ✅ presente | CLAUDE.md §Gotchas; diff sem `migrations/*.sql` |
| Drift detection (Terraform) | — | N/A | sem `infra/` |
| Per-tenant blast-radius limit | Columbia é tenant único hoje; a rota herda isolamento do processo Express. Dentro do tenant, o cap de 30 limita blast radius por request | ✅ presente (no nível possível) | `RegraIrmaosConjunto` + cap 30 |
| Deployment observability | `LogService` já é `@singleton` e carrega metadata do handler Express. A feature loga confirmação em conjunto, mas não há métrica agregada (histograma de latência da nova rota) no diff | ⚠️ parcial | `ConfirmacaoEmConjuntoService.ts`; não há métrica estruturada nova |
| Configure Behavior (feature flag) | **Não há flag próprio** para a rota em conjunto; ligar/desligar só desligando todo o SISPAG write via `SISPAG_LIVE_WRITE_ENABLED=off` | ⚠️ parcial | ADR-0080; `EnvironmentProvider` não ganha chave nova |

## 4. Findings

### F-deployability-1: Rota nova em caminho de escrita Conexos sem feature flag próprio

- **Severidade**: P1
- **Tactic violada**: Configure Behavior / Scale Rollouts (canary granular)
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts`, `src/backend/routes/sispag.ts` (handler novo)
- **Evidência (objetiva)**:
  ```
  diff não introduz chave em EnvironmentProvider; só kill-switch existente SISPAG_LIVE_WRITE_ENABLED
  governa escrita. Para desligar APENAS a confirmação em conjunto (ex.: incidente só nela, sem
  afetar confirmação singular que já roda em PRD), é preciso rollback de código.
  ```
- **Impacto técnico**: Se a rota em conjunto gerar um bug que só se manifesta em produção (ex.: ordem
  de commit por filho num grupo de 29 títulos), não há dial para desligar só ela; o único caminho é
  (a) reverter commit via Render (≥5 min + nova compilação) ou (b) desligar o kill-switch global, que
  também desarma o ajuste de centavos e a confirmação singular já em uso.
- **Impacto de negócio**: janela de incidente mais longa; operação do SISPAG singular (que já funciona)
  é interrompida junto por falta de granularidade.
- **Métrica de baseline**: 0 feature flags próprios no diff; MTTR estimado de rollback por commit no
  Render ≈ 5 min vs. ≈ 10 s para flip de env var. Cap de blast radius por request = 30 linhas
  (`BatchConfirmationTooLargeError` em 31; medido).

### F-deployability-2: Sem runbook / nota em DEPLOY.md para a rota em conjunto

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands / Deployment observability
- **Localização**: `DEPLOY.md`, `README.md`, `docs/` (nenhum tocado pelo diff)
- **Evidência (objetiva)**:
  ```
  git diff --stat origin/main -- DEPLOY.md README.md docs/ → 0 arquivos
  ```
- **Impacto técnico**: operador de plantão às 2h da manhã (vide gotcha "mensagem de log em português")
  não tem how-to escrito para: cap de 30, como simular o 422, como diferenciar `JA_CONFIRMADA` de
  `RECUSADA` por outro credor, qual env var desliga.
- **Impacto de negócio**: aumenta lead time de incidente; depende de memória do dev da feature.
- **Métrica de baseline**: 0 linhas de runbook adicionadas; ADR-0080 existe mas é documento de decisão,
  não runbook.

### F-deployability-3: Latência da rota em conjunto (36.5 s pior caso) sem monitor dedicado

- **Severidade**: P2
- **Tactic violada**: Deployment observability
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts`, logging
- **Evidência (objetiva)**:
  ```
  live measurement: POST 30 rows 36.5s (per-row scenario) → 1.3s (one scenario per batch, D9).
  LogService é usado, mas não há métrica estruturada (duração/rows) no diff para alertar regressão
  pós-deploy.
  ```
- **Impacto técnico**: se um deploy futuro reintroduzir o "per-row scenario" (regressão da otimização
  D9), não existe sinal automático; só o analista reclamando.
- **Impacto de negócio**: janela de fechamento SISPAG mais longa; cliente final percebe lentidão.
- **Métrica de baseline**: 36.5 s pior caso medido vs. 1.3 s alvo (fator 28×). Sem alarme/dashboard
  para 1.3 s → degradação.

### F-deployability-4: CI gates do backend/front sobre a rota nova não observáveis a partir do diff

- **Severidade**: P2
- **Tactic violada**: Manage Deployment Pipeline (CI gating)
- **Localização**: `.github/workflows/` (não tocado pelo diff)
- **Evidência (objetiva)**:
  ```
  diff não altera workflows; gates (typecheck/lint/test) foram rodados localmente nesta sessão e
  passaram, mas o report não pode afirmar que o PR em si os rodará obrigatoriamente antes do Render
  hook — depende do estado do workflow em main.
  ```
- **Impacto técnico**: risco de merge sem gates se o workflow do PR estiver desligado/quebrado.
- **Impacto de negócio**: build quebrado chegando a PRD pelo deploy hook do Render.
- **Métrica de baseline**: shared metrics mostra 6243 testes verdes **localmente**, não no CI.
  Não medível aqui.

## 5. Cards Kanban

### [deployability-1] Introduzir flag SISPAG_CONFIRMACAO_EM_CONJUNTO_ENABLED

- **Problema**
  > A rota `POST /sispag/sugestao-boleto/confirmar-em-conjunto` só pode ser desligada em PRD revertendo
  > commit via Render (≈5 min) ou derrubando o kill-switch global `SISPAG_LIVE_WRITE_ENABLED`, que
  > também mata o ajuste de centavos e a confirmação singular. Qualquer incidente específico da rota
  > em conjunto hoje tem blast radius de "todo o SISPAG write".

- **Melhoria Proposta**
  > Adicionar `sispagConfirmacaoEmConjuntoEnabled` ao `EnvironmentProvider` com default `true` em
  > HML e `false` em PRD até V-PRD2 (padrão parecido com `SISPAG_BIND_CODBAR_FILIAIS`). Checar no
  > `ConfirmacaoEmConjuntoService` e devolver 503 com mensagem "confirmação em conjunto desligada".
  > Tactic Bass: *Configure Behavior* + *Scale Rollouts* (canary por rota).

- **Resultado Esperado**
  > Possibilidade de desligar a rota nova em ≤ 10 s via env var no Render sem derrubar SISPAG
  > singular/ajuste de centavos. MTTR de incidente específico da feature cai de ~5 min para ~10 s.

- **Tactic alvo**: Configure Behavior
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - MTTR p/ incidente específico da rota em conjunto: ~5 min (rollback) → ~10 s (env flip)
  - Nº de flags por rota de escrita SISPAG: 1 (global) → 2 (global + conjunto)
- **Risco de não fazer**: na primeira anomalia em PRD, operação do SISPAG inteiro é derrubada; o
  ajuste de centavos e o SISPAG singular pagam pelo bug da rota em conjunto.
- **Dependências**: nenhuma.

### [deployability-2] Adicionar runbook da rota em conjunto em DEPLOY.md

- **Problema**
  > A feature introduz um cap de 30 linhas (`BatchConfirmationTooLargeError` → 422), estados
  > `JA_CONFIRMADA` / `RECUSADA` por credor divergente e dependência de `SISPAG_LIVE_WRITE_ENABLED`.
  > Nada disso está em runbook; o conhecimento vive em ADR-0080 e na cabeça do dev que escreveu.

- **Melhoria Proposta**
  > Adicionar seção "SISPAG — confirmação em conjunto" em `DEPLOY.md` com: env vars relevantes
  > (atual: só `SISPAG_LIVE_WRITE_ENABLED`), cap de 30 e como ajustar, interpretação dos códigos
  > de retorno por linha, procedimento de rollback. Tactic Bass: *Script Deployment Commands*.

- **Resultado Esperado**
  > Operador de plantão resolve incidente da rota sem acionar o dev. Lead time de triagem cai.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Linhas de runbook da feature em `DEPLOY.md`: 0 → ≥ 30
  - Nº de perguntas no chat sobre "422 em conjunto": N → 0
- **Risco de não fazer**: cada incidente custa 1 acordar-o-dev.
- **Dependências**: [deployability-1] (para documentar a nova flag).

### [deployability-3] Expor métrica estruturada de duração e rows do endpoint em conjunto

- **Problema**
  > O pior caso medido (per-row scenario) foi 36.5 s para 30 linhas; a otimização D9 (one scenario
  > per batch) leva a 1.3 s. Não há métrica estruturada nos logs/dashboard que alerte quando um
  > deploy futuro reintroduzir a regressão.

- **Melhoria Proposta**
  > No `ConfirmacaoEmConjuntoService`, emitir `LogService.message` estruturado com
  > `{ route: 'sispag.confirmarEmConjunto', rows, durationMs, scenarioMode }` ao final de cada
  > requisição. Criar alarme/log-based metric no painel observabilidade com threshold
  > `durationMs/rows > 200ms`. Tactic Bass: *Deployment observability* / *Monitor*.

- **Resultado Esperado**
  > Qualquer deploy que degrade a latência média por linha acima de 200 ms dispara alerta antes
  > do usuário reportar.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Latência média por linha monitorada: não observada → ≤ 200 ms (alerta acima disso)
  - Tempo até detectar regressão de 28× (D9 revertido): ∞ → ≤ 1 deploy
- **Risco de não fazer**: regressão de performance só é detectada por reclamação de analista
  (gotcha histórico "2h da manhã").
- **Dependências**: nenhuma. Cross-link com `performance.md`.

### [deployability-4] Confirmar que o CI do PR roda typecheck/lint/test/build antes do deploy hook

- **Problema**
  > O diff não toca workflows; a sessão rodou os gates localmente, mas não há evidência no PR
  > de que `.github/workflows/*.yml` força os mesmos gates antes do Render hook. Se o workflow
  > estiver quebrado/desligado, um build vermelho pode chegar a PRD.

- **Melhoria Proposta**
  > Checklist no PR template (`.github/pull_request_template.md`): backend typecheck + lint + test +
  > build; frontend typecheck + lint + test + build. Garantir workflow `ci.yml` com `required
  > status checks` na branch `main`. Tactic Bass: *Manage Deployment Pipeline*.

- **Resultado Esperado**
  > Impossível merge em `main` sem gates verdes; Render hook só dispara após merge.

- **Tactic alvo**: Manage Deployment Pipeline (CI gating)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Required status checks em `main`: desconhecido → ≥ 4 (typecheck/lint/test/build)
- **Risco de não fazer**: build quebrado chega a PRD; precedente histórico do `.sql` não copiado
  mostra que gates falhos custam dias.
- **Dependências**: nenhuma (fora do diff, mas acionável a partir dele).

## 6. Notas do agente

- Escopo é feature-only. Não avaliei pipeline global (`.github/workflows/`) nem a dívida crônica
  de "sem Terraform / sem CI/CD de infra" — isso é do estado-alvo e não é tocado pelo diff.
- Cross-QA: F-deployability-3 depende de `performance.md` (D9 — one scenario per batch); vale
  linkar no consolidator. F-deployability-1 toca `security.md` (menos granularidade de kill-switch
  = mais escrita indesejada em janela de incidente).
- Métricas não medíveis declaradas na seção 2 (Terraform/Lambda/CI gates): o repo não tem o
  substrato; não dá para forçar baseline.
- Score 7: feature é cirúrgica, aditiva, sem schema/env nova, protegida por cap de 30; mas carece
  de flag próprio, runbook e métrica estruturada — todos acionáveis em cards S.
