---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-deployability
generated_at: 2026-10-08T20:30:00-03:00
scope: all
score: 6
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dono do ciclo (merge em main) | Deploy automático (`autoDeploy: true`) de uma migration 0080 destrutiva (DROP de 5 tabelas e 8 colunas) + 3 env vars novas | Render web service, BootMigrator, schema Postgres (Supabase) | Produção com instância antiga servindo até a nova passar em `/health` | Migration aplica atomicamente, ou aborta pela guarda sem derrubar a instância antiga; guarda nova fica desligada até ser ligada à mão | 0 minutos de indisponibilidade; rollback executável em < 15 min com runbook; 0 linhas perdidas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migration 0080 transacional com guarda de linhas | 1 bloco `DO $$` aborta se houver dado (5 tabelas + `destino_manual`) | presente | ✅ | `migrations/0080_sispag_favorecido_autorizado.sql:42-72` |
| Reverse da 0080 versionado | 280 linhas, só estrutura (conteúdo não volta) | presente + documentado | ⚠️ | `migrations/rollbacks/0080_*.rollback.sql`, `DEPLOY.md:268` |
| Rollback de código documentado | `DEPLOY.md:268-270` cobre a 0080; runbook genérico em `docs/runbooks/rollback.md`, sem entrada específica da 0080 | runbook dedicado | ⚠️ | `docs/runbooks/` (4 arquivos, nenhum da 0080) |
| Flags de ativação (go-live sem redeploy) | 4 (`FAVORECIDO_AUTORIZADO`, `TED`, `PIX` + chave), todas `sync: false`, default false | ≥1 por frente | ✅ | `render.yaml:51-70` |
| Fail-closed sem segredo HMAC | guarda resolve false e o boot avisa | presente | ✅ | `DEPLOY.md` (tabela de env), `render.yaml` |
| Alias antigo `SISPAG_DESTINO_MANUAL_ENABLED` / `SISPAG_EXCECAO_DESTINO_ENABLED` removido de render.yaml e DEPLOY.md | removido sem ciclo de transição | ciclo de transição | ⚠️ | `git diff main -- render.yaml DEPLOY.md` |
| Janela de esquema incompatível (instância antiga x schema novo) | existe: colunas `conferido_*`, `excecao_destino_id`, `destino_*` somem antes de a antiga parar | 0 | ⚠️ | `0080_*.sql:176-195` |
| Workflows CI | 9 (`ci.yml` + 8 crons); sem drift/plan (N/A, sem Terraform) | ci presente | ✅ | `.github/workflows/` |
| Pre-deploy command | ausente deliberadamente; migra no boot | n/a | ⚠️ | `render.yaml:23-25` |
| Build reprodutível / bundle por Lambda | ⚠️ **Não medível**: sem Lambda/esbuild; build = `tsc` + `copy-to-dist`. Fora do delta |  | n/a | `package.json:11` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green; a rampa é por feature flag (guarda → TED → PIX, uma por vez, ordem documentada) | ⚠️ parcial | `render.yaml:51-70`, `DEPLOY.md` seção Favorecido autorizado |
| Rollback | Reverse SQL manual + voltar o código; perde as autorizações; sem automação | ⚠️ parcial | `rollbacks/0080_*.rollback.sql`, `DEPLOY.md:268` |
| Script Deployment Commands | `autoDeploy` + BootMigrator com advisory lock e `copy-to-dist` | ✅ presente | `BootMigrator.ts:130-155`, `package.json:11` |
| Logical Grouping | Migration única e atômica agrupa schema, permissões e alertas | ✅ presente | `0080_*.sql` |
| Physical Grouping | N/A: serviço Render único, sem topologia multi-recurso no delta | N/A | `render.yaml` |
| Package Dependencies | Migration + código + env vars no mesmo release; ordem de ligação das flags documentada | ✅ presente | `DEPLOY.md` |
| Surge Protection | Flags default false; guarda falha fechada | ✅ presente | `render.yaml` |
| Idempotent deploys | `IF NOT EXISTS`, `to_regclass`, `DROP ... IF EXISTS`; reaplicável | ✅ presente | `0080_*.sql:45-60, 153-205` |
| Drift detection | N/A: sem IaC; schema versionado por `schema_migrations` | N/A | - |
| Per-tenant blast-radius | N/A: tenant único (Columbia) | N/A | - |
| Deployment observability | Aviso de boot na flag sem segredo; guarda da migration informa contagens | ⚠️ parcial | `0080_*.sql:62-70` |

## 4. Findings

### F-deployability-1: Migration destrutiva roda no boot enquanto a instância antiga ainda serve

- **Severidade**: P1
- **Tactic violada**: Package Dependencies / Rollback
- **Localização**: `src/backend/migrations/0080_sispag_favorecido_autorizado.sql:176-205`; `render.yaml:17-25`
- **Evidência (objetiva)**:
  ```
  DROP COLUMN conferido_por, conferido_em, devolvido_*, motivo_devolucao   (lote_pagamento)
  DROP COLUMN excecao_destino_id, destino_manual, destino_origem           (lote_pagamento_item)
  DROP TABLE pendencia_cadastro, excecao_destino, ...
  # autoDeploy: true; sem preDeployCommand (migra no boot da nova instância)
  ```
- **Impacto técnico**: Render mantém a instância antiga até a nova passar em `/health`, mas a migration roda no boot da nova. Entre o COMMIT do DROP e o corte de tráfego, queries do código antigo sobre as colunas removidas falham (erro 500 nas rotas de lote/pendência). A janela é de segundos a poucos minutos. Não é P0: as tabelas estavam vazias (0 linhas medidas em 2026-10-08) e o SISPAG está bloqueado por flag.
- **Impacto de negócio**: Erros transitórios para o analista durante o deploy. Baixo hoje, porque TED/PIX ainda não foi ligado em produção.
- **Métrica de baseline**: 8 colunas e 5 tabelas removidas numa janela de overlap de 1 deploy.

### F-deployability-2: Guarda de linhas pode abortar o deploy por corrida após a medição

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `0080_*.sql:6-9, 42-72`
- **Evidência (objetiva)**:
  ```
  "em 2026-10-08 as cinco tabelas tinham 0 linhas (medido antes do merge)"
  IF total > 0 THEN RAISE EXCEPTION '0080: abortada ...'
  ```
- **Impacto técnico**: A medição é anterior ao merge. Se a app criar uma linha em `pendencia_cadastro` (página `/sispag/pendencias-cadastro` ainda existe no código antigo) entre a medição e o boot, a migration aborta e o boot lança. A instância antiga segue servindo, então não há queda, mas o deploy fica preso e se repete a cada redeploy. A guarda é correta e fecha em segurança.
- **Impacto de negócio**: Deploy bloqueado até decisão manual com o Yuri; sem perda de dado.
- **Métrica de baseline**: 0 linhas hoje; 1 passo manual de re-medição não documentado como pré-requisito do merge.

### F-deployability-3: Rollback perde conteúdo e não tem runbook dedicado

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `rollbacks/0080_*.rollback.sql:1-25`; `DEPLOY.md:268-270`; `docs/runbooks/`
- **Evidência (objetiva)**:
  ```
  "O QUE NÃO VOLTA: o CONTEÚDO das tabelas e colunas que a 0080 apagou"
  "apagar sispag_favorecido_autorizado derruba toda TED/PIX"
  ```
- **Impacto técnico**: O reverse só recria estrutura, o que é coerente com a guarda (tabelas vazias). Porém, depois que o novo fluxo ganhar uso, o rollback destrói autorizações e a trilha de dupla aprovação. O exemplo de `\copy` está em comentário SQL, não em script. Não há entrada na pasta de runbooks e nenhum teste executa o ciclo apply, reverse e reapply contra um Postgres real no CI (apenas `rollbacks.test.ts` de estrutura).
- **Impacto de negócio**: Rollback tardio custa re-aprovação de todos os favorecidos por duas pessoas.
- **Métrica de baseline**: 0 runbooks dedicados; MTTR de rollback não medido.

### F-deployability-4: Alias das flags antigas removido sem ciclo de transição

- **Severidade**: P3
- **Tactic violada**: Package Dependencies
- **Localização**: `render.yaml:51-70`; `DEPLOY.md:110`
- **Evidência (objetiva)**: `SISPAG_DESTINO_MANUAL_ENABLED` e `SISPAG_EXCECAO_DESTINO_ENABLED` saíram do blueprint. Versão anterior do DEPLOY.md prometia "alias por um ciclo".
- **Impacto técnico**: Variáveis órfãs no dashboard do Render ficam inertes e sem aviso. Como o estado anterior era `false`, o efeito é nulo.
- **Impacto de negócio**: Confusão operacional menor.
- **Métrica de baseline**: 2 vars órfãs potenciais no dashboard.

## 5. Cards Kanban

### [deployability-1] Documentar e ensaiar a janela de migration destrutiva

- **Problema**
  > A 0080 derruba 8 colunas e 5 tabelas no boot da nova instância enquanto a antiga ainda atende. Erros transitórios são possíveis no overlap.
- **Melhoria Proposta**
  > Acrescentar ao DEPLOY.md um pré-requisito de merge: re-contar as 5 tabelas e `destino_manual` imediatamente antes do merge e fazer o merge fora do horário de uso. Avaliar expand/contract (um release remove o uso, o seguinte faz o DROP) para migrations destrutivas futuras.
- **Resultado Esperado**
  > Overlap sem erro 500 observado; contagem pré-merge registrada no PR.
- **Tactic alvo**: Package Dependencies
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1, F-deployability-2
- **Métricas de sucesso**:
  - Passo de re-medição documentado: 0 → 1
  - Erros 5xx no deploy da 0080: não medido → 0
- **Risco de não fazer**: Cada migration destrutiva repete a janela e a corrida.
- **Dependências**: nenhuma

### [deployability-2] Criar runbook de rollback da 0080 com export automatizado

- **Problema**
  > O reverse perde as autorizações e não há runbook nem script de export.
- **Melhoria Proposta**
  > Criar `docs/runbooks/rollback-adr-0065.md` (modelo `rollback-adr-0043.md`) com export `\copy` em passos, ordem (código primeiro, SQL depois) e verificação. Adicionar teste de integração apply, reverse e reapply.
- **Resultado Esperado**
  > Rollback executável por qualquer operador em < 15 min, sem perda silenciosa.
- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Runbooks dedicados: 0 → 1
  - Ciclo apply/reverse/reapply testado: não → sim
- **Risco de não fazer**: Rollback com uso real perde a trilha de dupla aprovação.
- **Dependências**: nenhuma

### [deployability-3] Avisar sobre env vars órfãs após o corte

- **Problema**
  > Flags antigas saíram do blueprint sem aviso no boot.
- **Melhoria Proposta**
  > Nota no DEPLOY.md para apagar `SISPAG_DESTINO_MANUAL_ENABLED` e `SISPAG_EXCECAO_DESTINO_ENABLED` do dashboard, ou log de aviso no boot se definidas.
- **Resultado Esperado**
  > 0 vars órfãs no Render.
- **Tactic alvo**: Package Dependencies
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Vars órfãs: 2 → 0
- **Risco de não fazer**: Ambiguidade futura sobre qual flag vale.
- **Dependências**: nenhuma

### [deployability-4] Registrar o resultado da guarda no log do deploy

- **Problema**
  > Aborto da guarda só aparece como exceção de boot, sem sinalização de que é uma recusa deliberada.
- **Melhoria Proposta**
  > Citar a mensagem `0080: abortada` e a conduta (decidir com o Yuri) no runbook de deploy, para o plantonista distinguir de falha de infra.
- **Resultado Esperado**
  > Triagem de deploy preso em minutos.
- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Tempo de triagem do aborto: não medido → < 5 min
- **Risco de não fazer**: Deploy preso confundido com incidente de infra.
- **Dependências**: deployability-1

## 6. Notas do agente

- Escopo: render.yaml, DEPLOY.md, migration 0080 e reverse. Sem Terraform/Lambda; métricas de bundle e drift são N/A.
- Nenhum P0: a guarda aborta sem perda, a instância antiga segue servindo, e as flags nascem desligadas (falha fechada).
- Cross-QA: Fault-Tolerance (rollback destrói a trilha), Security (segredo HMAC com rotação não suportada), Testability (sem teste do ciclo reverse/reapply em Postgres real).
