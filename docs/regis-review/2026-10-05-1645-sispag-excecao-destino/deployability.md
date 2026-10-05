---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-05-1645-sispag-excecao-destino
agent: qa-deployability
generated_at: 2026-10-05T17:30:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/Kavex | Merge do ADR-0060 na main: migration 0075 + troca de flag + nova permissão | Render (hook), `BootMigrator`, `dist/migrations`, env vars | Produção, banco Supabase compartilhado, sem Terraform | Migrar no boot de forma idempotente, subir com flag desligada, voltar a versão anterior sem perda de dado | 0 dados apagados; rollback do código sem restore; flag ligada só após 2 titulares de `sispag:excecao` |

Escopo: só os arquivos da feature. `infra/`/Terraform não existe (CLAUDE.md), então tactics de Terraform/tenant/Lambda são N/A.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automáticos commit→build (CI) | 6 (audit prod, typecheck, lint, test+coverage, build, test:sql em job próprio) | ≥5 | ✅ | `.github/workflows/ci.yml` |
| Passo de deploy automatizado no CI | 0 (deploy é hook Render, fora do ci.yml) | ≥1 gated | ⚠️ | `ci.yml`; `ls .github/workflows` (sem deploy.yml) |
| Migration 0075 testada em Postgres real | sim (job `backend-sql`, 86 testes locais verdes) | sim | ✅ | `_shared-metrics.md`; `0075_*.integration.test.ts` |
| Migration idempotente / create-only | `IF NOT EXISTS`, `DROP ... IF EXISTS`, `ON CONFLICT DO NOTHING`; 0 DELETE/DROP TABLE | 100% | ✅ | `migrations/0075_sispag_excecao_destino.sql` |
| `.sql` copiado para `dist` no build | sim (`tsx migrations/copy-to-dist.ts` no `build`; falha derruba o build) | sim | ✅ | `src/backend/package.json:11` |
| Flags de go-live (gates) | 3 (`TED`, `EXCECAO_DESTINO`, `PIX`), default `false`, sem redeploy | ≥1 por frente | ✅ | `DEPLOY.md` linha 110 |
| Alias da flag renomeada | 1 ciclo; nome novo prevalece mesmo `false` | documentado | ✅ | `EnvironmentProvider.ts:36`, `DEPLOY.md` |
| Rollback documentado | sim, texto em DEPLOY.md; 0 scripts | 1 comando | ⚠️ | `DEPLOY.md` seção "Exceção de destino" |
| Drift detection / plan-before-apply | N/A (sem Terraform) | — | N/A | CLAUDE.md |
| Tamanho de bundle Lambda / duração de build | Não medível: não é Lambda; build não cronometrado nesta run | — | ⚠️ | — |
| Execução do job de aposentadoria | manual (0 workflows) | agendado | ⚠️ | `DEPLOY.md`; `ls .github/workflows` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green; substituto: flags `false` por default, ligadas uma a uma (TED → exceção → PIX) | ⚠️ parcial | `DEPLOY.md` linha 110 |
| Rollback | Backend anterior sobe sem perda (0075 não apaga nada); `destino_manual` inerte. Reconversão de concessões é manual | ⚠️ parcial | `DEPLOY.md` "Rollback"; F-deployability-1 |
| Script Deployment Commands | `npm run build` encadeia tsc, esm-fix e cópia de .sql; migração no boot; job rodado à mão | ⚠️ parcial | `package.json:11` |
| Logical Grouping | Permissão única `sispag:excecao`, trilha e tabelas por feature | ✅ | 0075 seções 1-3 |
| Physical Grouping | N/A (Render single service; sem múltiplas instâncias/tenant) | N/A | CLAUDE.md |
| Package Dependencies | `npm ci` + lockfile, `npm audit --omit=dev` | ✅ | `ci.yml` |
| Surge Protection | N/A (sem fila de deploy; Render serializa) | N/A | — |
| Idempotent deploys | Migração reexecutável; sem reconversão em rerun | ✅ | 0075 cabeçalho |
| Reproducible builds | `npm ci`, node 24 fixo no CI; lockfile versionado | ✅ | `ci.yml` |
| Deployment observability | `RAISE WARNING` quando há `destino_manual`; log do BootMigrator | ⚠️ parcial | 0075 seção 5 |
| Per-tenant blast-radius | N/A (sem tenants) | N/A | CLAUDE.md |

## 4. Findings

### F-deployability-1: Troca do CHECK de permissão torna o rollback do código parcialmente quebrado

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0075_sispag_excecao_destino.sql` (DROP/ADD de `app_role_permission_permission_check` e `user_permission_permission_check`); `DEPLOY.md` "Rollback"
- **Evidência (objetiva)**:
  ```
  DROP CONSTRAINT IF EXISTS app_role_permission_permission_check; (e user_permission_...)
  -- conversão sispag:aprovar_destino -> sispag:excecao, depois ADD CONSTRAINT sem o valor antigo
  ```
- **Impacto técnico**: voltar o backend ao build anterior deixa linhas `sispag:excecao` desconhecidas pelo código antigo e impede conceder `sispag:aprovar_destino` (CHECK novo não aceita). Reconversão é à mão.
- **Impacto de negócio**: janela de rollback com permissões de aprovação inoperantes; SISPAG fica sem aprovador até correção manual.
- **Métrica de baseline**: 0 scripts de reversão; 2 tabelas de permissão afetadas; flag default `false` limita a exposição a 0 usuários em produção até ligar.

### F-deployability-2: Deploy sem gate automático e job de aposentadoria sem agendamento

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `.github/workflows/` (sem workflow de deploy ou do job `aposentar-excecoes-substituidas`); `DEPLOY.md`
- **Evidência (objetiva)**:
  ```
  ls .github/workflows -> ci, detect-staleness, ingest-*, reaper-sispag, reconciliar-nde, sincronizar-lotes-sispag
  "Sem scheduler: roda à mão (ou por um workflow, que ainda não existe)"
  ```
- **Impacto técnico**: o job é esquecível; exceções substituídas pelo cadastro continuam APROVADAS até o resolver tocá-las. O deploy Render não espera o CI.
- **Impacto de negócio**: divergência cadastro vs. exceção pode ficar sem alerta por dias.
- **Métrica de baseline**: 0 execuções agendadas do job; 8 workflows existentes, nenhum o cobre.

### F-deployability-3: Pré-requisito de 2 titulares antes de ligar a flag é só texto

- **Severidade**: P2
- **Tactic violada**: Deployment observability
- **Localização**: `DEPLOY.md` (passo operacional obrigatório); `EnvironmentProvider.ts`
- **Evidência (objetiva)**:
  ```
  "Com um único titular nada se aprova" — nenhum check no boot nem alerta
  ```
- **Impacto técnico**: flag ligada com 1 titular produz exceções PENDENTE eternas, silenciosamente.
- **Impacto de negócio**: pagamentos TED/PIX sem destino cadastrado travados no lote.
- **Métrica de baseline**: 0 verificações automáticas; titulares com `sispag:excecao` em prod: não medido.

## 5. Cards Kanban

### [deployability-1] Documentar e script de reversão das permissões do 0075

- **Problema**
  > O CHECK de permissão é trocado e as concessões são convertidas; voltar o código deixa `sispag:excecao` sem leitor e `aprovar_destino` rejeitado pelo banco (F-deployability-1).
- **Melhoria Proposta**
  > Criar `migrations/rollbacks/` SQL reverso opcional (reconverte e restaura o CHECK) e testá-lo em `rollbacks.test.ts`; linkar no DEPLOY.md. Tactic Rollback.
- **Resultado Esperado**
  > Rollback do 0075 em 1 comando testado; passos manuais 2 → 0.
- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - scripts de reversão testados: 0 → 1
- **Risco de não fazer**: um rollback de emergência deixa a aprovação de destino inoperante até alguém editar SQL em produção.
- **Dependências**: nenhuma

### [deployability-2] Agendar o job aposentar-excecoes-substituidas em workflow

- **Problema**
  > O job roda só à mão; sem agendamento a divergência cadastro vs. exceção não vira alerta (F-deployability-2).
- **Melhoria Proposta**
  > Workflow cron diário seguindo o padrão de `reaper-sispag.yml`, com segredos Conexos atuais (ver memória sobre secrets desatualizados) e falha visível quando 0 itens lidos.
- **Resultado Esperado**
  > Execuções agendadas por dia: 0 → 1.
- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - runs/dia do job: 0 → 1
- **Risco de não fazer**: exceções obsoletas permanecem aprovadas e divergências passam despercebidas.
- **Dependências**: flag `SISPAG_EXCECAO_DESTINO_ENABLED` ligada

### [deployability-3] Alertar quando a exceção está ligada com menos de 2 titulares

- **Problema**
  > O pré-requisito de dois titulares vive só no DEPLOY.md (F-deployability-3).
- **Melhoria Proposta**
  > Probe/alerta (padrão `Alerta`) que conta usuários efetivos com `sispag:excecao` quando a flag está ligada; avisar se < 2. Opcional: checklist no PR de go-live.
- **Resultado Esperado**
  > Falha silenciosa → alerta imediato; verificações automáticas 0 → 1.
- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - verificações automáticas do pré-requisito: 0 → 1
- **Risco de não fazer**: go-live com lotes travados em PENDENTE.
- **Dependências**: nenhuma

## 6. Notas do agente

- Pontos fortes: 0075 create-only e idempotente, `.sql` copiado no build (lição do incidente de 2026-09-23), flag default `false` com alias de um ciclo, rollback e passo operacional documentados.
- Não medido: duração/tamanho do build, contagem de `destino_manual` e titulares em prod, execução real da 0075 em prod.
- Cross-QA: Security (separação de funções, conversão de permissões), Testability (rollback não testado), Availability (lote travado sem 2 titulares). Avaliar remover o alias da flag no próximo ciclo.
