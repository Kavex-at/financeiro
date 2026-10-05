---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-deployability
generated_at: 2026-10-05T21:40:00-03:00
scope: backend
score: 7
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

> Escopo: delta do commit `c099a55` (--quick, sem rodar build). Sem `infra/` nem Terraform: as tactics de Terraform e tenants são N/A ou não medíveis. O deploy do backend é o hook do Render, e o CI roda em GitHub Actions.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor | Publica o fix I-Write-10 (teto do líquido no disponível do adto) em produção | `ReconciliacaoPermutaService.baixarTitulo` (caminho de escrita no Conexos fin010) + job `validate-permuta-centavos-adto-v1` | Produção única, com baixas reais no ERP | O CI valida, o deploy ocorre via Render, e o efeito é verificável. Se a regra errar, volta-se à versão anterior sem ter gravado baixas erradas | CI verde antes do merge. Rollback ≤ 15 min (git revert + redeploy). 0 baixas divergentes pós-deploy |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Etapas automáticas de CI no delta (audit, typecheck, lint, test+coverage, build) | 5 | ≥ 5 | ✅ | `.github/workflows/ci.yml` job `backend` |
| Typecheck / lint / testes | 0 erros / 0 erros (78 warnings pré-existentes) / 3773 testes passando | verde | ✅ | `_shared-metrics.md` |
| Lockfile commitado, `npm ci` no CI | sim | sim | ✅ | `ci.yml` (`cache-dependency-path: src/backend/package-lock.json`) |
| Validação pré-deploy contra ledger real | 196 execuções: 192 IDENTICO, 3 FECHADO, 1 FORA_TETO, 0 DIVERGENTE | 0 divergentes | ✅ | `jobs/validate-permuta-centavos-adto-v1.ts` (somente leitura, sem chamadas ao ERP) |
| Feature flag / kill-switch para a nova regra | 0 | ≥ 1 para mudança em caminho de escrita financeira | ⚠️ | `ReconciliacaoPermutaService.ts` (chamada incondicional após `ancorarVariacaoNoAdto`) |
| Mudanças de schema/migration no delta | 0 | 0 (rollback trivial) | ✅ | `git show --stat c099a55` |
| Script do validador registrado em `package.json` | não (roda via `tsx` direto) | sim | ⚠️ | `grep validate-permuta src/backend/package.json` (vazio) |
| Rollout gradual / canary | N/A (sem tenants nem infra) | — | ⚠️ | Não medível: sem `infra/` |
| Drift detection Terraform, bundle por Lambda, tempo de build | ⚠️ **Não medível localmente**: não há Terraform nem Lambda neste repo. O build rodou no CI (typecheck e `tsc` verdes) | — | N/A | CLAUDE.md "Estado Atual vs. Alvo" |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary, blue/green ou rolling. Render faz deploy único. Sem flag para ativar a regra por filial | ❌ ausente | `ci.yml` (não há etapa de deploy gradual) |
| Rollback | A mudança é puramente de código, sem migration, e o revert é limpo. Sem rollback automatizado, e o procedimento não está documentado no ADR. A regra só reduz o líquido, então as baixas já feitas não precisam de desfazer | ⚠️ parcial | `git show --stat c099a55`; ADR-0062 |
| Script Deployment Commands | CI com scripts (`npm run typecheck/lint/test/build`). O deploy é um hook do Render, e o validador do delta é um script `tsx` fora de `package.json` | ⚠️ parcial | `ci.yml`; `jobs/validate-permuta-centavos-adto-v1.ts` |
| Logical Grouping | A regra fica isolada em um método privado (`limitarAoDisponivelDoAdto`) com 4 testes dedicados, e a mudança é cirúrgica (+71 linhas em um arquivo de 1231 LOC) | ✅ presente | `ReconciliacaoPermutaService.ts` |
| Physical Grouping | N/A: uma única unidade de deploy (serviço web no Render), sem Lambdas por função | N/A | CLAUDE.md |
| Package Dependencies | Sem dependência nova. Lockfile + `npm ci` + `npm audit --omit=dev` no CI | ✅ presente | `ci.yml` |
| Surge Protection | N/A: sem fila de deploys, e o validador é somente leitura sobre o DB | N/A | — |
| Idempotent deploys | Sem migration nem estado novo, então reaplicar o deploy é seguro | ✅ presente | delta |
| Drift detection | N/A: sem IaC | N/A | — |
| Reproducible builds | `package-lock.json` + Node 24 fixado no CI | ✅ presente | `ci.yml` |
| Per-tenant blast-radius limit | N/A: sem tenants. O raio da mudança é o de todas as baixas de permuta, limitado pelo teto de R$ 1,00 e por só reduzir o líquido | ⚠️ parcial | ADR-0062 |
| Deployment observability | `BUSINESS_WARN` quando o excesso é > R$ 1,00 ou o juros ficaria negativo, e o job validador consulta o ledger depois do fato | ✅ presente | `ReconciliacaoPermutaService.ts`; validador |

## 4. Findings

### F-deployability-1: Caminho de escrita financeira muda sem kill-switch nem rollback documentado

- **Severidade**: P2
- **Tactic violada**: Rollback / Scale Rollouts
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` (chamada de `limitarAoDisponivelDoAdto` em `baixarTitulo`); `ontology/decisions/0062-teto-do-liquido-no-disponivel-do-adto.md`
- **Evidência (objetiva)**:
  ```
  git show --stat c099a55: 9 arquivos, +509/-2, 0 migrations, 0 flags de ambiente
  ground truth: 196 execuções, 0 DIVERGENTE (192 IDENTICO, 3 FECHADO, 1 FORA_TETO)
  ```
- **Impacto técnico**: Se a regra errar em um caso não coberto pelo ledger, o único remédio é o revert + redeploy do Render. A regra só atua sobre excesso ≤ R$ 1,00, e a 1 das 196 execuções reais já ficou fora do teto e foi deixada intacta. O risco residual é baixo e foi comprovado contra produção.
- **Impacto de negócio**: Uma baixa gravada errada no Conexos exigiria estorno manual pela analista. O baseline de 3 de 196 execuções com R$ 0,01 de excesso mostra que o problema de origem é real e que o risco do fix é pequeno.
- **Métrica de baseline**: flags de desativação da regra: 0. Divergências no ground truth: 0 de 196. Nenhuma evidência de defeito, por isso não é P0/P1.

### F-deployability-2: Validador pós-deploy não é um script nomeado nem tem checagem automatizada

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands
- **Localização**: `src/backend/jobs/validate-permuta-centavos-adto-v1.ts`; `src/backend/package.json`
- **Evidência (objetiva)**:
  ```
  grep -n "validate-permuta" src/backend/package.json  -> (sem resultado)
  ```
- **Impacto técnico**: A verificação "0 DIVERGENTE" depende de alguém lembrar o comando exato e de ter acesso ao banco de produção. Sem um passo repetível, o resultado não é comparável entre deploys.
- **Impacto de negócio**: Pequeno. Ao longo do tempo, a verificação pós-deploy fica menos confiável.
- **Métrica de baseline**: scripts `job:*`/`validate:*` registrados para este validador: 0.

## 5. Cards Kanban

### [deployability-1] Documentar o rollback do I-Write-10 e avaliar um kill-switch

- **Problema**
  > A regra I-Write-10 entra no caminho de escrita das baixas sem flag e sem passo de rollback escrito no ADR-0062. O remédio é revert + redeploy do Render, o que funciona, mas não está documentado.

- **Melhoria Proposta**
  > Acrescentar ao ADR-0062 (ou ao `DEPLOY.md`) uma seção "Rollback": revert do commit `c099a55`, o redeploy do hook do Render e como confirmar via o validador. Avaliar uma variável lida via `EnvironmentProvider` para desligar a regra sem novo deploy. Só vale a pena se o custo for baixo. Tactic: Rollback.

- **Resultado Esperado**
  > Um operador consegue reverter em minutos sem investigação. Procedimento documentado: 0 → 1.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Passos de rollback documentados: 0 → 1 seção
  - Tempo estimado de rollback: não documentado → ≤ 15 min
- **Risco de não fazer**: Em um incidente de baixa errada, o rollback depende da memória de quem estiver de plantão.
- **Dependências**: nenhuma

### [deployability-2] Registrar o validador como script npm

- **Problema**
  > O validador `validate-permuta-centavos-adto-v1.ts` só roda se alguém souber o caminho e as variáveis de ambiente. Não há entrada em `package.json`.

- **Melhoria Proposta**
  > Adicionar `"job:validate-permuta-centavos-adto": "tsx jobs/validate-permuta-centavos-adto-v1.ts"` em `src/backend/package.json` e mencionar o comando no ADR-0062. Tactic: Script Deployment Commands.

- **Resultado Esperado**
  > A verificação pós-deploy vira um comando único e repetível. Scripts registrados: 0 → 1.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Comando registrado para o validador: 0 → 1
- **Risco de não fazer**: A checagem pós-deploy cai em desuso e a regressão passa sem ser vista.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta de `c099a55`. Não rodei o build (--quick), e o CI cobre typecheck, lint, testes e `npm run build`.
- Sem `infra/`: Terraform, tenants, bundles por Lambda, drift e flags `has_*` são N/A ou não medíveis neste repo.
- Nenhum P0: o delta não tem migration, só reduz o líquido em até R$ 1,00, e o ground truth mostra 0 divergentes em 196 execuções.
- Cross-QA para o consolidator: Testability (4 testes novos + validador contra o ledger) e Fault Tolerance (BUSINESS_WARN em vez de falha quando o excesso é > R$ 1,00).
