---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-29-2020
agent: qa-deployability
generated_at: 2026-09-29T20:30:00-03:00
scope: backend
score: 6.5
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Merge em `main` de feature com migration 0069 + novo cron horário + rota nova | Render (backend, migra no boot), Vercel (front), GH Actions (`sincronizar-lotes-sispag.yml`) | Produção, dias úteis, analista operando | Deploy aplica a migration sem janela de inconsistência, novo cron entra sem saturar o pooler/sessões Conexos, rollback documentado | 0 minutos de tela vazia; pico teórico de sessões ≤ teto do Supavisor; rollback em ≤ 15 min via `docs/runbooks/rollback.md` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados commit→prd (backend) | 6 no CI (audit, typecheck, lint, test+coverage, build, SQL Postgres 17) + deploy hook Render + migrate no boot | ≥5 | ✅ | `.github/workflows/ci.yml` |
| `terraform plan` antes de apply | N/A (sem `infra/`) | — | N/A | CLAUDE.md §Layout |
| Rollback documentado | `docs/runbooks/rollback.md` + reverse SQL por migration (0069 tem) | presente | ✅ | `src/backend/migrations/rollbacks/0069_sispag_item_situacao_sincronizacao.rollback.sql` |
| Rollback de 0069 com teste | `rollbacks.test.ts` (+3 linhas) cobre o par | presente | ✅ | `git diff origin/main...HEAD --stat` |
| Migration idempotente | `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD` | sim | ✅ | `0069_sispag_item_situacao_sincronizacao.sql:33-66` |
| Lockfile / build reproduzível | `package-lock.json` presente; CI e crons usam `npm ci` | sim | ✅ | `src/backend/package-lock.json` |
| Versão de Node consistente | CI = 24, os 7 crons = 22 | igual | ⚠️ (pré-existente) | `grep node-version .github/workflows/*.yml` |
| Crons GH Actions | 7 (era 6) | tabela do DEPLOY.md em dia | ❌ tabela diz 6 | `DEPLOY.md:34`, `.github/workflows/` |
| Pico teórico de sessões no pooler | 49 documentado; com o 7º cron (2 pools, 5+2) = 56 | ≤ teto (desconhecido) | ⚠️ teto nunca lido | `DEPLOY.md:34-45` |
| Colisão de minuto de cron | `:35` compartilhado por `reconciliar-nde` (`35 * * * *`) e o novo (`35 11-22 * * 1-5`): 12 coincidências/dia útil | 0 | ⚠️ | `grep cron: .github/workflows/*.yml` |
| Alerta de falha de workflow | presente (`job:alerta-workflow-falhou`, ADR-0042) + exit≠0 se 0 títulos lidos | presente | ✅ | `sincronizar-lotes-sispag.yml:65-73` |
| Kill-switch do novo job | nenhum (só `workflow_dispatch`/desabilitar workflow na UI) | flag | ⚠️ | `SincronizarLotesSispagJob.ts` |
| Tamanho/tempo de build de bundle | ⚠️ **Não medível**: backend usa `tsc` + `tsx`, não esbuild/zip por Lambda; --quick não executou build | — | — | `package.json:11` |
| Drift detection / tenants isolados / feature flags de módulo Terraform | Não medível: sem `infra/` | — | N/A | CLAUDE.md |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary/blue-green/rolling) | Render troca a versão inteira; sem canary. O job novo nasce ligado no primeiro merge | ❌ ausente | `sincronizar-lotes-sispag.yml` |
| Rollback | Runbook + reverse SQL por migration (0069 inclusa); Render mantém versão anterior | ✅ presente | `docs/runbooks/rollback.md`, `migrations/rollbacks/` |
| Script Deployment Commands | CI + `npm run migrate` + deploy hook + `bump-version.ps1` | ✅ presente | `ci.yml`, `DEPLOY.md` |
| Logical Grouping | Cada cron é workflow próprio com `concurrency` group; backend/frontend separados | ✅ presente | `sincronizar-lotes-sispag.yml:27-29` |
| Physical Grouping | N/A: sem infra própria; Render/Vercel/GH Actions são managed | N/A | — |
| Package Dependencies | `npm ci` + lockfile; deps de jobs instaladas com `--include=dev` (tsx) | ⚠️ parcial | workflow linha 55 (jobs rodam a fonte via `tsx`, não o `dist/`) |
| Surge Protection | `concurrency` sem cancelamento; `timeout-minutes: 15`; orçamento do pooler documentado mas desatualizado | ⚠️ parcial | `DEPLOY.md:34` |
| Idempotent deploys | Migration com IF NOT EXISTS; cron roda `npm run migrate` idempotente | ✅ presente | `0069_...sql` |
| Drift detection | N/A (sem Terraform); o `BootMigrator` reporta "esquema em dia" | N/A | `DEPLOY.md:83` |
| Reproducible builds | lockfile + `npm ci`; Node divergente entre CI e crons | ⚠️ parcial | `ci.yml` vs crons |
| Per-tenant blast-radius | N/A: single-tenant (Columbia) hoje | N/A | CLAUDE.md §Tenants |
| Deployment observability | `job_execucao` (pipeline `sispag-sincronizacao`), alerta ADR-0042, staleness limit novo | ✅ presente | `stalenessLimits.ts` (+11), `JobRunReadModel.ts` |

## 4. Findings (achados)

### F-deployability-1: DEPLOY.md não registra o 7º cron nem o orçamento de sessões (in-delta)

- **Severidade**: P2
- **Tactic violada**: Surge Protection
- **Localização**: `DEPLOY.md:34-47`; `.github/workflows/sincronizar-lotes-sispag.yml`
- **Evidência (objetiva)**:
  ```
  | 6 crons do GitHub Actions (...) | 2 cada | 5 + 2 | 42 |   Total teórico: 49
  ls .github/workflows: 7 crons agora (+ sincronizar-lotes-sispag)
  DEPLOY.md: "Ao acrescentar um cron, atualize esta tabela." -> DEPLOY.md ausente do diff (55 arquivos)
  ```
- **Impacto técnico**: pior caso passa a 56 sessões (42 + 14) sem ninguém saber; o teto do Supavisor segue sem leitura. Saturação aparece como 5xx mascarado por retry (histórico v0.34.1).
- **Impacto de negócio**: risco de indisponibilidade intermitente da API que a analista usa em horário comercial, justamente na janela 08–19 BRT do novo cron.
- **Métrica de baseline**: 49 → 56 sessões teóricas; 6 → 7 crons; tabela diz 6.

### F-deployability-2: Novo cron colide no minuto :35 com `reconciliar-nde` (in-delta, reconhecido no comentário do workflow)

- **Severidade**: P2
- **Tactic violada**: Surge Protection
- **Localização**: `.github/workflows/sincronizar-lotes-sispag.yml:25`; `.github/workflows/reconciliar-nde.yml:18`
- **Evidência (objetiva)**:
  ```
  sincronizar: '35 11-22 * * 1-5'   reconciliar-nde: '35 * * * *'
  comentário: "Conexos limita sessões simultâneas (LOGIN_ERROR_MAX_SESSIONS) ... desloque um dos dois"
  ```
- **Impacto técnico**: 12 execuções/dia útil simultâneas no mesmo usuário CONEXOS_*; disputa de sessão derruba uma das duas (o sync sai vermelho, `reconciliar-nde` pode perder a sessão). O `DEPLOY.md` diz que os crons são espaçados de propósito (`:00`, `:20`, `:40`); outros minutos seguem livres.
- **Impacto de negócio**: alertas falsos de job falhou e status de lote defasado em até 1h.
- **Métrica de baseline**: 12 coincidências/dia útil; 0 esperado.

### F-deployability-3: Deploy da migration 0069 sem seção no DEPLOY.md (ordem, janela, rollback) (in-delta)

- **Severidade**: P2
- **Tactic violada**: Rollback (Script Deployment Commands)
- **Localização**: `DEPLOY.md` (sem referência a `0069`); `migrations/rollbacks/0069_sispag_item_situacao_sincronizacao.rollback.sql`
- **Evidência (objetiva)**:
  ```
  grep -n "0069\|sincronizar" DEPLOY.md  -> só a rota /boletos-dda/sincronizar (não relacionada)
  DEPLOY.md:214 (0066) traz "Rollback: voltar backend + aplicar reverse" e "Janela de minutos" - padrão da casa
  ```
  A 0069 troca `alerta_tipo_check`: o cron do GH roda `npm run migrate` da árvore-fonte e pode migrar antes do Render subir (janela documentada em `DEPLOY.md:209`). Adicionar colunas/valores é compatível com o backend antigo; o reverse, porém, pode falhar se já houver `alerta` com os tipos novos (não conferi o corpo do script em --quick).
- **Impacto técnico**: rollback sob pressão sem passo-a-passo; ordem "backend primeiro, front depois" não escrita (o front novo chama `POST /lotes/:id/sincronizar`, inexistente no backend antigo).
- **Impacto de negócio**: botão "Sincronizar agora" com erro 404 se o front subir antes do backend.
- **Métrica de baseline**: 0 linhas de DEPLOY.md sobre a feature; padrão da 0066 tem ~6.

### F-deployability-4: Sem kill-switch para o job novo (in-delta) e Node 22 (crons) vs 24 (CI) (pré-existente)

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `src/backend/jobs/SincronizarLotesSispagJob.ts`; `.github/workflows/ci.yml:17` vs workflows de cron
- **Evidência (objetiva)**:
  ```
  workflow: sem gate por env/var; desligar exige editar/desabilitar o workflow.
  ci.yml node-version '24'; 7 crons node-version 22
  ```
- **Impacto técnico**: um bug no sync grava status errado de lote de hora em hora até intervenção manual; testes passam em 24 e o cron roda em 22.
- **Impacto de negócio**: status de lote incorreto a cada hora na tela do SISPAG (proteção parcial: I11f marca divergência para decisão humana).
- **Métrica de baseline**: 0 flags de rollout; 2 versões de Node.

## 5. Cards Kanban

### [deployability-1] Atualizar o orçamento de sessões do DEPLOY.md e ler o teto do Supavisor

- **Problema**
  > O sétimo cron entrou sem atualizar a tabela "Budget de sessões do pooler", que hoje afirma 6 crons/49 sessões. O teto real do pooler nunca foi lido.
- **Melhoria Proposta**
  > Atualizar a linha dos crons (7 crons, 56 sessões) em `DEPLOY.md`; ler `max_client_conn` no dashboard do Supabase e registrá-lo. Considerar checagem simples que compare o número de workflows com `schedule` à tabela.
- **Resultado Esperado**
  > Tabela = realidade; teto conhecido e comparado ao pior caso de 56.
- **Tactic alvo**: Surge Protection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Crons documentados: 6 → 7
  - Teto do pooler: desconhecido → registrado
- **Risco de não fazer**: o próximo cron empurra o pior caso acima do teto e o sintoma vira 5xx mascarado por retry.
- **Dependências**: acesso ao dashboard Supabase

### [deployability-2] Mover o cron de sincronização para minuto livre

- **Problema**
  > `sincronizar-lotes-sispag` e `reconciliar-nde` disparam no `:35` (12x/dia útil) usando o mesmo usuário Conexos, sujeito a `LOGIN_ERROR_MAX_SESSIONS`.
- **Melhoria Proposta**
  > Trocar o cron para minuto livre (ex.: `5 11-22 * * 1-5`), respeitando a regra de espaçamento registrada em `reaper-sispag.yml`; atualizar o comentário do workflow.
- **Resultado Esperado**
  > Coincidências 12/dia → 0; sem falhas de sessão cruzadas.
- **Tactic alvo**: Surge Protection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Execuções simultâneas no mesmo minuto: 12/dia → 0
- **Risco de não fazer**: alertas `job-falhou` intermitentes que ensinam o time a ignorar alertas.
- **Dependências**: nenhuma

### [deployability-3] Documentar deploy e rollback da 0069 no DEPLOY.md

- **Problema**
  > A feature traz migration + rota + front acoplados, mas o DEPLOY.md não diz a ordem, a janela do cron que migra antes do Render, nem como reverter.
- **Melhoria Proposta**
  > Seção no padrão da 0066: ordem "backend primeiro", janela `npm run migrate` dos crons, comando do reverse `0069...rollback.sql`, pré-condição sobre `alerta` com tipos novos (confirmar que o script trata). Pós-deploy: conferir `[boot-migrate] aplicada(s) 1: 0069`.
- **Resultado Esperado**
  > Rollback executável por qualquer pessoa em ≤15 min sem ler código.
- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Passos de deploy/rollback documentados da feature: 0 → 1 seção completa
- **Risco de não fazer**: front antes do backend gera 404 no botão; rollback improvisado com constraint de alerta.
- **Dependências**: nenhuma

### [deployability-4] Adicionar kill-switch ao sync e alinhar Node entre CI e crons

- **Problema**
  > O sync grava status de lote de hora em hora sem interruptor operacional; CI testa em Node 24 e os crons executam em 22.
- **Melhoria Proposta**
  > Env `SISPAG_SINCRONIZACAO_ENABLED` (padrão do repo: só `false` desliga, sem redeploy) checada pelo job com exit 0 e log; alinhar `node-version` dos 7 crons ao CI (ou vice-versa).
- **Resultado Esperado**
  > Desligar o sync em <1 min sem editar código; 1 versão de Node em todo o pipeline.
- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Tempo para desligar o job: edição de workflow → 1 variável
  - Versões de Node: 2 → 1
- **Risco de não fazer**: bug no sync corrompe leitura de status por horas antes de alguém conseguir parar.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick`: não rodei build/testes; não li o corpo completo do reverse 0069 nem do Job. Nenhum P0 encontrado (rollback, idempotência, alerta de falha e concorrência presentes).
- Terraform, tenants, bundle Lambda e drift: não medíveis (sem `infra/`); tactics marcadas N/A.
- Cross-QA: F-1/F-2 tocam Availability e Performance (pool e sessões Conexos compartilhados); F-4 toca Fault-Tolerance (kill-switch) e Testability (Node 22 vs 24). CHANGELOG/versão (0.45.0) ainda não bumpados: passo do pipeline, não finding.
