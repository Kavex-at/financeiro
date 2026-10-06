---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-06-1356
agent: qa-deployability
generated_at: 2026-10-06T14:30:00-03:00
scope: all
score: 6.5
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Merge da feature sispag-verificacoes-ted-pix na main (137 arquivos, 4 migrations 0076-0079, 1 workflow novo, 1 job novo) | Pipeline GH Actions, Render (backend, `dist/`), Vercel (frontend), BootMigrator, cron semanal | Produção única (Columbia), analista usando o SISPAG em horário comercial | Build copia os `.sql`, migrations aplicam idempotentes no boot, o backend sobe com o gate de duplicidade ativo, e há caminho documentado para voltar atrás | Deploy sem intervenção manual além do "Run workflow" inicial; rollback de código+schema documentado em ≤ 15 min; 0 lotes bloqueados indevidamente por perfil vazio |

Terraform e multi-tenant: **não aplicáveis** (sem `infra/`, ver CLAUDE.md "Estado Atual vs. Alvo"). A análise usa Render + Vercel + GH Actions.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados commit→CI | 7 jobs/steps: audit, typecheck, lint, test+coverage, build, test:sql (Postgres 17), tag release | ≥ 5 | ✅ | `.github/workflows/ci.yml:26-30,62,80-85` |
| Gate `plan` antes de `apply` | N/A (sem Terraform) | N/A | N/A | CLAUDE.md |
| Build copia `.sql` para `dist` | `tsc && tsc-esm-fix dist && tsx migrations/copy-to-dist.ts` | presente | ✅ | `src/backend/package.json:11` |
| Lockfile / build determinístico | `npm ci` no CI e nos crons | presente | ✅ | ci.yml, calcular-perfil-canal.yml |
| Idempotência das migrations novas | 0076: 8, 0077: 7, 0078: 8 `IF NOT EXISTS`; 0079 usa `DROP CONSTRAINT IF EXISTS` + `ADD` | 100% | ✅ | `grep -c "IF NOT EXISTS" migrations/007[6-9]*.sql` |
| Reverse de migration para as novas | 0 de 4 (0076-0079); rollbacks existentes só até 0072 | 4/4 | ❌ | `ls src/backend/migrations/rollbacks` |
| Seção de rollout/rollback da feature no DEPLOY.md | 0 menções a 0076-0079 / ADR-0063 / perfil | presente | ❌ | `grep ADR-0063 DEPLOY.md` |
| Rollout runbook do workflow novo | Documentado no cabeçalho do YAML (disparo manual antes de ligar a verificação) | presente | ⚠️ (só no comentário do YAML) | `.github/workflows/calcular-perfil-canal.yml:25-26` |
| Alerta de falha do cron novo (ADR-0042) | presente (`if: failure()`) | presente | ✅ | `calcular-perfil-canal.yml:77-90` |
| Concorrência / sessões Conexos | `concurrency` group + minuto :17 de domingo, longe dos demais | sem colisão | ✅ | `calcular-perfil-canal.yml:29-32` |
| Parâmetros da verificação sem redeploy de código | 6 parâmetros com default (`SISPAG_VERIFICACAO_DEFAULT`) via env | presente | ⚠️ (não há flag liga/desliga do gate de duplicidade verificada) | `EnvironmentVars.ts:18-25` |
| Feature flags de módulo (`has_*`) | N/A (sem Terraform) | N/A | N/A | — |
| Bundle sizes / build time | ⚠️ **Não medível localmente** nesta rodada (`--quick`, não rodou `npm run build`). Recomendação: registrar `time npm run build` no CI. | — | — | — |
| Drift detection | N/A (sem IaC) | N/A | N/A | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green; produção única. A feature se rola em passos: migrations → disparo manual do job de perfil → ligar a verificação (ADR-0063) | ⚠️ parcial | `calcular-perfil-canal.yml:25-26` |
| Rollback | Runbook geral (`docs/runbooks/rollback.md`) e reverses por migration até 0072; nenhum para 0076-0079 | ⚠️ parcial | `migrations/rollbacks/` |
| Script Deployment Commands | CI scriptado, deploy hook Render, `npm run migrate` idempotente no cron, BootMigrator no boot | ✅ presente | `ci.yml`, `package.json:13` |
| Logical Grouping | Migrations numeradas e atômicas por tema; permissões isoladas na 0079 | ✅ presente | `migrations/0079*.sql` |
| Physical Grouping | Backend em Render, frontend em Vercel, cron em GH Actions: a feature toca os três e exige ordem (backend antes do frontend) | ⚠️ parcial | scope do delta |
| Package Dependencies | `package-lock.json` + `npm ci`; `npm audit --audit-level=high` no CI | ✅ presente | `ci.yml:26` |
| Surge Protection | N/A para deploy (carga do deploy não varia); `concurrency` evita cron em paralelo | N/A | `calcular-perfil-canal.yml:29` |
| Idempotent deploys | migrations com `IF NOT EXISTS`; cron roda `migrate` antes do job | ✅ presente | migrations 0076-0079 |
| Reproducible builds | `npm ci`, Node 22 no cron vs. 24 no CI (divergência) | ⚠️ parcial | `calcular-perfil-canal.yml:56` vs `ci.yml:20` |
| Per-tenant blast-radius | N/A (sem tenants); blast radius = a única Columbia | N/A | — |
| Deployment observability | Alerta ADR-0042 no cron; trilha só-inclusão `sispag_verificacao_evento` | ✅ presente | `0078*.sql` |
| Drift detection | N/A (sem IaC) | N/A | — |

## 4. Findings

### F-deployability-1: Migrations 0076-0079 sem reverse nem seção de rollback no DEPLOY.md
- **Severidade**: P1
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/rollbacks/` (ausentes), `DEPLOY.md`
- **Evidência (objetiva)**:
  ```
  ls migrations/rollbacks | grep -E "007[6-9]"  -> vazio
  grep -c "ADR-0063" DEPLOY.md -> 0
  DEPLOY.md:276 (precedente: "todo rollback de código ... exige" ordem explícita)
  ```
- **Impacto técnico**: voltar o backend para antes desta feature deixa `sispag_verificacao_evento` com trigger que recusa UPDATE/DELETE/TRUNCATE, colunas de conferência em lotes e o CHECK de permissões ampliado (0079). O backend antigo pode ler permissões `sispag:conferir`/`sispag:cadastro` que não conhece. Sem passo escrito, o operador improvisa às 2h.
- **Impacto de negócio**: o SISPAG move pagamentos reais; rollback lento ou errado prolonga o bloqueio do analista na baixa/remessa.
- **Métrica de baseline**: 0 de 4 migrations com reverse (padrão do repo: 5 reverses já existentes até 0072); 0 linhas de DEPLOY.md para a feature.

### F-deployability-2: Rollout em 3 passos só descrito no comentário do workflow, sem checklist verificável
- **Severidade**: P2
- **Tactic violada**: Scale Rollouts
- **Localização**: `.github/workflows/calcular-perfil-canal.yml:25-26`
- **Evidência (objetiva)**:
  ```
  # ⚠️ Schedules do GitHub Actions só disparam a partir do BRANCH PADRÃO (main). Antes de ligar a
  # verificação, rode uma vez pelo "Run workflow" manual (passo de rollout da ADR-0063).
  ```
- **Impacto técnico**: o cron só existe após o merge; entre o deploy do backend e a primeira rodada manual, `perfil_canal_fornecedor` está vazia e o alerta "canal habitual" opera sem base. Sem verificação de "tabela populada" o operador não sabe se pode liberar.
- **Impacto de negócio**: alertas silenciosos (falso senso de cobertura) ou ruído na primeira semana; o job só lê o ERP, então o dano é de confiança, não financeiro.
- **Métrica de baseline**: 1 passo manual obrigatório (disparo) com 0 verificação automatizada; cadência semanal = até 7 dias de perfil vazio se esquecido.

### F-deployability-3: Divergência de versão do Node entre CI (24) e cron novo (22)
- **Severidade**: P3
- **Tactic violada**: Package Dependencies (Reproducible builds)
- **Localização**: `.github/workflows/calcular-perfil-canal.yml:56`, `.github/workflows/ci.yml:20`
- **Evidência (objetiva)**:
  ```
  calcular-perfil-canal.yml: node-version: 22
  ci.yml: node-version: '24'
  ```
- **Impacto técnico**: o job roda em runtime diferente do testado no CI (tsx + deps nativas), podendo divergir em comportamento.
- **Impacto de negócio**: baixo; falha detectada pelo alerta ADR-0042.
- **Métrica de baseline**: 1 workflow de cron fora da versão do CI (a verificar nos outros 7 crons; não medido).

### F-deployability-4: Sem chave de desligamento do gate de duplicidade em `finalizarLote`
- **Severidade**: P2
- **Tactic violada**: Scale Rollouts
- **Localização**: `src/backend/domain/libs/environment/model/EnvironmentVars.ts:18-25`
- **Evidência (objetiva)**:
  ```
  SISPAG_VERIFICACAO_DEFAULT = { duplicidadeJanelaDias, duplicidadeDesde, perfilMin*, perfilJanelaMeses }  // 6 campos, nenhum booleano de liga/desliga
  ```
- **Impacto técnico**: se a leitura live do fin064 degradar (sessão Conexos ocupada), a única mitigação é rollback de código/redeploy, não uma env no Render. `duplicidadeDesde` ajustável é um desligamento parcial indireto, mas não declarado.
- **Impacto de negócio**: uma falha de leitura bloqueia finalização de lotes até o redeploy.
- **Métrica de baseline**: 0 flags de ativação para 3 comportamentos novos que bloqueiam o fluxo (gate de duplicidade, conferência obrigatória L12, fila de pendência de cadastro). Não verifiquei se o código já tem fail-open; o ponto é a ausência de interruptor operacional.

## 5. Cards Kanban

### [deployability-1] Escrever reverses 0076-0079 e a seção de rollout/rollback da ADR-0063 no DEPLOY.md
- **Problema**
  > As migrations 0076-0079 não têm reverse e o DEPLOY.md não menciona a feature. Voltar o backend deixa trigger de só-inclusão, colunas de conferência e CHECK de permissões ampliado sem passo documentado.
- **Melhoria Proposta**
  > Criar `rollbacks/0076..0079*.rollback.sql` (0079 restaurando o CHECK anterior após remover linhas das permissões novas; 0078 documentando que a trilha não se apaga) e uma seção em `DEPLOY.md` com ordem (backend, migrations, frontend), verificações por passo e rollback. Tactic: Rollback.
- **Resultado Esperado**
  > Rollback de código+schema da feature em ≤ 15 min seguindo um runbook. Reverses: 0/4 → 4/4.
- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Reverses para migrations da feature: 0/4 → 4/4
  - Menções ao ADR-0063 no DEPLOY.md: 0 → seção completa
- **Risco de não fazer**: o primeiro incidente pós-merge vira improviso em produção financeira.
- **Dependências**: nenhuma

### [deployability-2] Verificação de pré-requisito do rollout (perfil populado) antes de liberar a verificação
- **Problema**
  > O disparo manual do job de perfil é o passo que habilita o alerta de canal; nada confirma que rodou.
- **Melhoria Proposta**
  > Adicionar ao DEPLOY.md um passo com `SELECT count(*) FROM perfil_canal_fornecedor` (> 0) e, idealmente, um sinal no painel de operação (staleness já tem `stalenessLimits.ts` alterado no delta) para "perfil nunca calculado". Tactic: Scale Rollouts.
- **Resultado Esperado**
  > Liberação só com perfil populado; dias com perfil vazio sem aviso: até 7 → 0.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Passos manuais sem verificação: 1 → 0
- **Risco de não fazer**: alerta silencioso por semanas sem ninguém notar.
- **Dependências**: deployability-1

### [deployability-3] Alinhar Node do cron `calcular-perfil-canal` ao CI
- **Problema**
  > O cron usa Node 22 e o CI testa em 24.
- **Melhoria Proposta**
  > Padronizar `node-version` (idealmente via `.nvmrc`/`node-version-file`) em todos os workflows de cron. Tactic: Package Dependencies.
- **Resultado Esperado**
  > Workflows fora da versão do CI: ≥ 1 → 0.
- **Tactic alvo**: Package Dependencies
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Versões de Node distintas entre workflows: 2 → 1
- **Risco de não fazer**: falha só em runtime do cron semanal.
- **Dependências**: nenhuma

### [deployability-4] Criar interruptores de env para o gate de duplicidade e a conferência obrigatória
- **Problema**
  > Os três comportamentos novos que bloqueiam o fluxo não têm flag operacional; mitigação exige redeploy.
- **Melhoria Proposta**
  > Adicionar booleanos em `SispagVerificacaoConfig` (ex.: `SISPAG_DUPLICIDADE_GATE=on|off`, `SISPAG_CONFERENCIA_OBRIGATORIA`) lidos via `EnvironmentProvider`, com default ligado e o desligamento auditado na trilha. Tactic: Scale Rollouts.
- **Resultado Esperado**
  > Mitigar uma degradação do fin064 em minutos via env no Render. Flags: 0 → 2 a 3.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Flags de ativação das verificações: 0 → ≥ 2
- **Risco de não fazer**: uma instabilidade do ERP trava finalização de lotes até o redeploy.
- **Dependências**: decisão de produto (o desligamento é aceitável? fica auditado?)

## 6. Notas do agente

- `--quick`: não rodei `npm run build` nem medi bundle/tempo. Escopo = delta; sem infra/Terraform (métricas de tenant, drift, módulos = N/A).
- Nada contra o Conexos foi executado. Pontos fortes do delta: build copia `.sql`, migrations idempotentes, alerta ADR-0042, `concurrency` e minuto do cron evitando colisão de sessão.
- Cross-QA: F-deployability-4 toca Availability/Fault Tolerance (degradação do fin064 bloqueia o fluxo); F-deployability-1 toca Modifiability (reversibilidade do schema) e Security (trilha só-inclusão).
