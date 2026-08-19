---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-19-1603
agent: qa-deployability
generated_at: 2026-08-19T16:03:00-03:00
scope: backend
score: 6
findings_count: 6
cards_count: 6
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de desenvolvimento (merge do delta da Frente V em `main`) | Push do PR `feat/frente-v-aprovacoes` incorpora nova migration `0049`, nova rota `/aprovacoes`, novo job `ingest-aprovacoes` e nova env `APROVACOES_ENABLED` | Backend Express no Render (auto-deploy on push) + Postgres (Supabase) via `preDeployCommand: npm run migrate` + Frontend Next.js na Vercel | Produção viva, com Frente II (SISPAG) e Frente IV (Recebimentos) já servindo — **primeira aplicação da migration `0049` contra um Postgres real** e primeira estreia do gate `APROVACOES_ENABLED` | Deploy deve (a) aplicar 0049 antes do tráfego virar, (b) preservar `/aprovacoes/*` bloqueado (403) até decisão explícita de estreia, (c) permitir kill-switch reversível em <1min sem redeploy, (d) rollback bem definido caso a migration corrompa o schema em homologação | Lead time commit→prd ≤ 20min · Migration success rate 100% · Kill-switch latência ≤ 60s · Rollback documentado ≥ 1 caminho testável · 0 vazamento visual do painel Frente V em prod antes do go-live |

> Cenário destaca o ponto de estresse específico do delta: a migration `0049_aprovacao_trilha.sql` **nunca foi aplicada a um Postgres real** (o próprio runbook admite isso na Fase 1.1) e o job de ingestão **nunca rodou** contra dados reais. O deploy que promover este PR é simultaneamente a estreia de três artefatos.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados commit→prd (backend) | 6 (checkout, setup-node, `npm ci`, `npm audit`, typecheck, lint, test+coverage, build) + deploy on push via Render + `preDeployCommand: npm run migrate && npm run seed:admin` | ≥ 5 gates + migration gate | ✅ | `.github/workflows/ci.yml` + `render.yaml` |
| `terraform plan` gating `apply` | ⚠️ Não medível: não existe `infra/` neste repo (CLAUDE.md §Estado Atual vs. Alvo) | — | N/A | — |
| Migration executada como pré-deploy (ANTES de servir tráfego) | Sim — `preDeployCommand: npm run migrate && npm run seed:admin` | Sim | ✅ | `render.yaml:23` |
| Migration `0049` com rollback (`down`) | **0** de 50 migrations tem `down` — política do repo é forward-only (idempotência via `IF NOT EXISTS`) | Rollback documentado ou idempotência total | ⚠️ | `ls src/backend/migrations/` (50 arquivos, nenhum `_down.sql`) |
| Migration `0049` idempotente | 11 `CREATE ... IF NOT EXISTS` cobrindo 3 tabelas + 8 índices; nenhum `ALTER TABLE ... ADD COLUMN` (que não é IF NOT EXISTS friendly) | 100% idempotente | ✅ | `grep -c "IF NOT EXISTS" migrations/0049_aprovacao_trilha.sql` = 11 |
| Cobertura de teste da migration contra Postgres real | 0 — `AprovacoesSql.test.ts` valida SQL string, não executa em DB | Ao menos 1 rodada em homologação antes do prd | ❌ | Runbook §Fase 1.1 admite "SQL nunca tocou um Postgres real" |
| Feature flag `APROVACOES_ENABLED` fail-safe em produção | Sim (default = `false` quando `environment === 'production'` e env ausente) | Fail-safe | ✅ | `EnvironmentProvider.ts:70-83` + teste `EnvironmentProvider.test.ts:133-158` |
| `APROVACOES_ENABLED` declarada em `render.yaml` (`sync: false`) | **Ausente** — a Frente IV tem `RECEBIMENTOS_ENABLED: sync:false`; a Frente V não tem entrada nenhuma | Declarada com `sync:false` (mesmo padrão do RECEBIMENTOS) | ❌ | `grep -n "APROVACOES" render.yaml` = 0 matches |
| `APROVACOES_ENABLED` documentada em `DEPLOY.md` | **Ausente** — tabela de envs cita `SISPAG_ENABLED` e `RECEBIMENTOS_ENABLED`, não cita `APROVACOES_ENABLED` | Documentada | ❌ | `grep -n "APROVACOES" DEPLOY.md` = 0 matches |
| Job `ingest-aprovacoes` agendado (cron) | **Ausente** — os pares Frente I/II/IV têm `.github/workflows/ingest-*.yml`; a Frente V não | Workflow com `schedule:` + `workflow_dispatch:` como os demais | ❌ | `ls .github/workflows/` = 4 arquivos, nenhum `ingest-aprovacoes.yml` |
| Runbook cobre kill-switch | Sim — §Fase 2 "Kill-switch: `APROVACOES_ENABLED=false` + restart. Reversível em menos de um minuto, sem redeploy." | Presente | ✅ | `docs/runbooks/frente-v-primeira-ingestao.md:127` |
| Runbook cobre rollback de schema (down migration ou `DROP TABLE`) | **Ausente** — runbook lista "sinais de que algo está errado" mas não instrui como reverter as 3 tabelas + 8 índices se a Fase 1.1 corromper o schema em homologação | Instrução explícita | ❌ | `grep -in "rollback\|drop table\|desligar\|reverter" docs/runbooks/frente-v-primeira-ingestao.md` = só match de "Reversível" no kill-switch |
| Runbook cobre critérios de aborto do go-live | Parcial — §Fase 2 lista pré-requisitos ("Fase 1 concluída sem sintoma da tabela acima", "backfill com painel desligado", "passada de olho da analista"), mas **não define métricas mensuráveis de aborto** (ex.: taxa de `INDETERMINADO` > X%, `duracao_segundos` nulo em >Y% das etapas concluídas) | Critérios com corte numérico | ⚠️ | `docs/runbooks/frente-v-primeira-ingestao.md` §Fase 2 |
| Build backend (tempo real) | 59.3s (`tsc && npx tsc-esm-fix dist`) | ≤ 60s | ✅ (borderline) | `time npm run build` |
| Tamanho do artefato backend (`dist/`) | 9.0 MB · 360 arquivos `.js` | ≤ 50 MB (limite Lambda unzipped, aqui não aplicável — Render) | ✅ | `du -sh src/backend/dist` |
| Lockfiles versionados (backend + frontend) | Sim — `src/backend/package-lock.json` + `src/frontend/package-lock.json` | Presentes | ✅ | `ls src/{backend,frontend}/package-lock.json` |
| `terraform apply` isolado por tenant | ⚠️ Não medível: não existe `infra/` neste repo | — | N/A | CLAUDE.md §Estado Atual vs. Alvo |
| Detecção de drift entre `render.yaml` e dashboard | ⚠️ Não medível: Render Blueprint não emite `plan` — `sync:false` designa autoridade ao dashboard, mas não há reconciliação | Sinalizador de drift | ⚠️ | conceito de Blueprint (envs `sync:false`) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Render fornece **rolling deploy** built-in (nova instância verde, healthcheck em `/health`, virar tráfego). Não há canary/blue-green explícito. Para a Frente V, o `APROVACOES_ENABLED` **funciona como canary lógico**: código deployado + gate fechado = zero exposição a usuário. | ⚠️ parcial | `render.yaml:19-20` (`healthCheckPath: /health`) + `EnvironmentProvider.ts:70-83` |
| Rollback | **Feature-flag rollback**: presente e testado (`APROVACOES_ENABLED=false` + restart, <1min, sem redeploy). **Code rollback**: Render redeploys o commit anterior via dashboard (padrão da plataforma). **Schema rollback**: **AUSENTE** — nenhuma migration tem `down`; a Frente V não tem `DROP TABLE aprovacao_titulo/aprovacao_etapa/aprovacao_ingestao_run` documentado. | ⚠️ parcial | `render.yaml` + `docs/runbooks/frente-v-primeira-ingestao.md:127` + `ls migrations/*_down.sql` = 0 |
| Script Deployment Commands | `render.yaml` + `preDeployCommand: npm run migrate && npm run seed:admin` + `.github/workflows/ci.yml` cobrem lint/test/typecheck/build/audit. Scripts npm nomeados por job (`job:ingest-permutas`, `job:ingest-aprovacoes`, ...). | ✅ presente | `render.yaml:23` + `src/backend/package.json:scripts` |
| Logical Grouping | Frentes agrupadas por container (`aprovacoesContainer.ts`, `recebimentosContainer.ts`) e por rota (`/aprovacoes`, `/recebimentos`, `/sispag`). Feature flags separadas por frente. | ✅ presente | `src/backend/domain/appContainer.ts:66-72` + `EnvironmentProvider.ts` (3 resolvers `resolve*Enabled`) |
| Physical Grouping | Um único Web Service Render serve todas as frentes — não há separação física por frente. Isolamento é apenas lógico (rota + flag). | ⚠️ parcial | `render.yaml` (1 service) |
| Package Dependencies | Lockfile commitado (`package-lock.json`), `npm ci` no CI e no Render build, `npm audit --audit-level=high` no CI. TypeScript pinado a `^5.3.3`, biome pinado. | ✅ presente | `.github/workflows/ci.yml:19,21` + `src/backend/package.json` |
| Surge Protection | `express-rate-limit` presente nas dependências; não há evidência de que `/aprovacoes/*` esteja envelopado. O job `ingest-aprovacoes` tem `advisory lock` (impede execuções concorrentes) — proteção de surge sobre o ERP downstream, não sobre o próprio painel. | ⚠️ parcial | `src/backend/jobs/ingest-aprovacoes.ts:65-80` + `package.json` (`express-rate-limit`) |
| Idempotent deploys | `preDeployCommand: npm run migrate` roda o `MigrationRunner` que consulta `schema_migrations` e pula migrations já aplicadas. `CREATE TABLE IF NOT EXISTS` na 0049 blinda re-execução parcial. | ✅ presente | `src/backend/migrations/runMigrations.ts:22-52` |
| Drift detection | **Ausente**. `render.yaml` marca `sync:false` para vários secrets/toggles — o dashboard é fonte da verdade, mas não há reconciliação. Nenhum job periódico compara `render.yaml` × envs live nem confere `schema_migrations` × filesystem. | ❌ ausente | `grep -rn "drift\|terraform plan" .github/workflows` = 0 |
| Reproducible builds | Lockfiles commitados + `npm ci`. TypeScript build (`tsc`) determinístico; nenhuma injeção de timestamp em `tsc-esm-fix`. Sem etapa de bundle (esbuild/webpack) — o Render roda o `dist/` diretamente com `node`. | ✅ presente | `src/backend/package.json:scripts.build` |
| Per-tenant blast-radius limit | ⚠️ Não medível: não há multi-tenant neste repo (Columbia = single-tenant Render + Supabase, ver `render.yaml:env=production`, `client_name=local`). | N/A | CLAUDE.md §Tenants (vazio) |
| Deployment observability | Log do boot mostra `[appContainer] applied N migration(s): ...`. Render mostra logs de `preDeployCommand`. **Não há** métrica de sucesso do deploy nem alarme sobre falha do `preDeployCommand` (falha para o deploy, mas ninguém é notificado ativamente). | ⚠️ parcial | `src/backend/domain/appContainer.ts:39-41` |

## 4. Findings (achados)

### F-deployability-1: `APROVACOES_ENABLED` está ausente do `render.yaml` e do `DEPLOY.md`

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands · Logical Grouping
- **Localização**: `render.yaml` (não contém a chave), `DEPLOY.md` (tabela de envs), `docs/runbooks/frente-v-primeira-ingestao.md:16-22`
- **Evidência (objetiva)**:
  ```
  $ grep -n "APROVACOES" render.yaml
  (0 matches)
  $ grep -n "APROVACOES" DEPLOY.md
  (0 matches)
  # comparar com RECEBIMENTOS_ENABLED em render.yaml:36-38:
  #   - key: RECEBIMENTOS_ENABLED
  #     sync: false
  ```
- **Impacto técnico**: O runbook instrui `APROVACOES_ENABLED=true` no dashboard para estrear em produção, mas o Blueprint não declara a chave. O padrão do repo (Frente IV) é declarar `sync: false` para (a) tornar a autoridade explícita — dashboard é fonte da verdade — e (b) evitar que uma refatoração do YAML mais tarde inclua acidentalmente um `value:` que sobrescreva a decisão do operador. Sem entrada, um dev que reler `render.yaml` amanhã não descobre que essa flag existe, e um operador que quiser fazer o go-live precisa consultar o runbook para saber o nome da chave.
- **Impacto de negócio**: Aumenta o risco de o go-live ser abortado por "onde eu configuro isso?"; risco pequeno de a chave ser esquecida no dashboard e a estreia ser silenciosamente adiada. Cria assimetria de documentação entre as 4 frentes.
- **Métrica de baseline**: 0 menções a `APROVACOES_ENABLED` em `render.yaml`, 0 menções em `DEPLOY.md`, contra 3 menções a `RECEBIMENTOS_ENABLED` em `render.yaml` + 1 linha completa em `DEPLOY.md`.

### F-deployability-2: Job `ingest-aprovacoes` não tem workflow de agendamento

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands · Scale Rollouts
- **Localização**: `.github/workflows/` (falta `ingest-aprovacoes.yml`), `src/backend/package.json` (script existe), `docs/runbooks/frente-v-primeira-ingestao.md:129-131`
- **Evidência (objetiva)**:
  ```
  $ ls .github/workflows/
  ci.yml  ingest-extratos.yml  ingest-permutas.yml  ingest-sispag.yml
  # nenhum ingest-aprovacoes.yml
  $ grep "job:ingest-aprovacoes" src/backend/package.json
  "job:ingest-aprovacoes": "tsx jobs/ingest-aprovacoes.ts"
  ```
  Runbook diz: "O job não está agendado. Depois da estreia, defina a cadência com base no volume observado."
- **Impacto técnico**: A ingestão só roda quando alguém abrir terminal e executar `FILS=... npm run job:ingest-aprovacoes`. Duas execuções manuais são protegidas por advisory lock (bom), mas a atualização do snapshot vira responsabilidade humana. O runbook (invariante I7) exige que a UI mostre a idade do snapshot — sem cron, o valor pode envelhecer indefinidamente sem alarme.
- **Impacto de negócio**: Painel mostrando snapshot de 3 semanas atrás mina a confiança do cliente e transforma a "espera atual" (métrica-chave do PRD) em número histórico. Analista não pode confiar no painel para decisão diária.
- **Métrica de baseline**: 0 workflows agendados para Frente V vs. 3 workflows agendados (Permutas 3×/dia, SISPAG 1×/dia, Extratos hourly) para as outras frentes. Cadência atual = 0/dia; cadência-alvo mínima = 1/dia (mesmo que PV-07 esteja aberto e cada rodada custe caro).

### F-deployability-3: Migration `0049` não tem rollback documentado nem `down`

- **Severidade**: P1
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0049_aprovacao_trilha.sql`, `src/backend/migrations/runMigrations.ts:22-52`, `docs/runbooks/frente-v-primeira-ingestao.md:35-42`
- **Evidência (objetiva)**:
  ```
  # Runner não suporta down migrations:
  $ grep -n "down\|rollback" src/backend/migrations/runMigrations.ts
  (nada além de comentário)
  # Nenhuma das 50 migrations tem pareamento _down.sql:
  $ ls src/backend/migrations/*_down.sql
  (0 arquivos)
  # Runbook Fase 1.1 sobre a estreia contra Postgres real:
  "Se falhar aqui, é erro de sintaxe SQL — [...] a Fase 1.1 é o primeiro teste real."
  # Runbook §Lacunas conhecidas:
  "Sintaxe SQL e semântica de tipos não foram validadas contra Postgres"
  ```
- **Impacto técnico**: A convenção do repo é forward-only, com idempotência via `IF NOT EXISTS` (o que a 0049 respeita: 11 usos). Isso protege re-runs, mas **não protege contra schema corrompido** — se a Fase 1.1 em homologação criar as tabelas com colunas ou constraints erradas, não há caminho documentado para revertê-las sem `psql` manual (`DROP TABLE aprovacao_titulo, aprovacao_etapa, aprovacao_ingestao_run CASCADE; DELETE FROM schema_migrations WHERE name='0049_aprovacao_trilha.sql';`). A ausência dessa instrução no runbook é a lacuna real — o teste de estreia menciona possibilidade de falha mas não diz o que fazer depois.
- **Impacto de negócio**: Se a estreia em homologação falhar por diferença Postgres × dublês (tipo `TIMESTAMPTZ`, constraint `CHECK`, colisão de nome), o time gasta tempo redescobrindo o comando de rollback ao invés de aplicar receita pronta. Prd está protegido (o Pre-Deploy do Render falha e não vira tráfego), mas homologação pode ficar em estado zumbi.
- **Métrica de baseline**: 0 receitas de rollback documentadas no runbook (grep por "rollback|drop table|reverter" → 0 matches na seção de aborto). 0 pares `NNNN_up.sql` / `NNNN_down.sql` no repo.

### F-deployability-4: Runbook não define critérios numéricos de aborto do go-live

- **Severidade**: P2
- **Tactic violada**: Deployment observability
- **Localização**: `docs/runbooks/frente-v-primeira-ingestao.md:113-124`
- **Evidência (objetiva)**:
  ```
  # Pré-requisitos textuais, sem corte numérico:
  1. Fase 1 concluída sem sintoma da tabela acima.
  2. Backfill de produção rodado com o painel ainda desligado — comece pela filial de menor volume e avance.
  3. Uma passada de olho da analista sobre os números, antes de anunciar.
  ```
  A tabela de "sinais de que algo está errado" (§1.3) é qualitativa ("Tudo `SEM_WORKFLOW`", "Muitos `INDETERMINADO`") — sem % de corte.
- **Impacto técnico**: Sem % de corte para `INDETERMINADO`, `duracao_segundos NULL`, `SEM_WORKFLOW`, a decisão de estrear vira julgamento subjetivo. Se aparecer 55% de `SEM_WORKFLOW` (plausível — o próprio runbook antecipa "~metade da base"), o operador não sabe se isso é normal ou sintoma de PV-01 mal categorizada.
- **Impacto de negócio**: Aumenta o tempo entre "backfill rodou" e "go-live aprovado". Cria espaço para decisão apressada ("parece OK") ou paralisia ("melhor esperar mais um mês").
- **Métrica de baseline**: 0 métricas de corte numérico no runbook. Comparar com o runbook `fin010-write-cutover.md` (que existe no mesmo diretório) para verificar se a Frente III tem melhor rigor de aborto.

### F-deployability-5: Sem drift detection entre `render.yaml` e dashboard, nem entre `schema_migrations` e filesystem

- **Severidade**: P2
- **Tactic violada**: Drift detection
- **Localização**: `render.yaml` (5 chaves `sync: false`), `src/backend/migrations/runMigrations.ts:29-33`
- **Evidência (objetiva)**:
  ```
  $ grep -c "sync: false" render.yaml
  10   # secrets + toggles cujo valor real vive no dashboard
  $ grep -rn "drift\|terraform plan" .github/workflows/
  (0 matches)
  ```
  Nenhum job compara periodicamente o estado real do Render com o Blueprint, nem verifica que todos os arquivos em `migrations/` estão registrados em `schema_migrations`.
- **Impacto técnico**: Uma flag apagada por acidente no dashboard vira comportamento inesperado no próximo restart do Render (o `EnvironmentProvider` cacheia envs no boot; um `RECEBIMENTOS_ENABLED` deletado no dashboard fica com o comportamento default = habilitado). Uma migration adicionada em worktree paralelo sem push pode passar despercebida.
- **Impacto de negócio**: MTTR maior em incidentes causados por configuração fora do YAML. Debug começa na aplicação e desce à infra por eliminação.
- **Métrica de baseline**: 10 chaves com `sync: false` sem reconciliação automática · 0 alarmes configurados sobre drift.

### F-deployability-6: Zero cobertura de teste da migration contra Postgres real

- **Severidade**: P2
- **Tactic violada**: Reproducible builds · Idempotent deploys
- **Localização**: `src/backend/domain/repository/aprovacoes/AprovacoesSql.test.ts`, `docs/runbooks/frente-v-primeira-ingestao.md:149-152`
- **Evidência (objetiva)**:
  ```
  # Runbook §Lacunas conhecidas:
  "Sintaxe SQL e semântica de tipos não foram validadas contra Postgres
   (não há banco na máquina de desenvolvimento). A Fase 1.1 é o primeiro teste real."
  ```
  Testes de SQL validam string do query (parâmetros nomeados, ordem de argumentos), não execução.
- **Impacto técnico**: A primeira aplicação real da 0049 é em homologação. Diferenças reais Postgres × mock que podem estourar: `TIMESTAMPTZ` vs `TIMESTAMP` em queries downstream, `CHECK (status_workflow IN (...))` rejeitando um valor legítimo, `JSONB DEFAULT '[]'::jsonb` em versões antigas do Postgres, colisão de nome de índice global (`idx_aprovacao_titulo_status` pode conflitar com nome pré-existente em outro schema).
- **Impacto de negócio**: Deploy pode ser abortado no `preDeployCommand`, atrasando outras entregas que compartilham o mesmo pipeline (Frente II, IV). Sem receita de rollback (ver F-3), rescue é reativo.
- **Métrica de baseline**: 0 execuções da 0049 contra Postgres real (assumido pelo próprio runbook). 1 suíte de teste de string SQL (não substitui). Alvo mínimo: 1 run em homologação com `SELECT` de sanity contra as 3 tabelas + reset limpo antes de prd.

## 5. Cards Kanban

### [deployability-1] Declarar `APROVACOES_ENABLED` em `render.yaml` e documentar em `DEPLOY.md`

- **Problema**
  > A flag `APROVACOES_ENABLED` é o gate de estreia da Frente V (fail-safe em produção) e é referenciada pelo runbook, mas **não aparece em `render.yaml` nem em `DEPLOY.md`**. A Frente IV declarou `RECEBIMENTOS_ENABLED: sync: false` exatamente para dar autoridade ao dashboard e tornar a chave visível. A Frente V ficou por fora do mesmo padrão.

- **Melhoria Proposta**
  > Adicionar bloco em `render.yaml` (Script Deployment Commands):
  > ```yaml
  > # Frente V (Workflow de Aprovação) — fail-safe. Sem env em produção = DESLIGADA
  > # (ADR-0038). Estreia é decisão explícita: `APROVACOES_ENABLED=true` no dashboard.
  > - key: APROVACOES_ENABLED
  >   sync: false
  > ```
  > Adicionar linha equivalente em `DEPLOY.md` (tabela de envs Render) espelhando o texto de `RECEBIMENTOS_ENABLED`. Sem valor no YAML — o dashboard permanece como fonte da verdade.

- **Resultado Esperado**
  > `grep "APROVACOES" render.yaml` = 1+ match · `grep "APROVACOES" DEPLOY.md` = 1+ match · dev que ler o Blueprint amanhã descobre a flag sem precisar do runbook.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Menções a `APROVACOES_ENABLED` em `render.yaml`: 0 → ≥ 1
  - Menções a `APROVACOES_ENABLED` em `DEPLOY.md` (tabela de envs): 0 → 1
- **Risco de não fazer**: Estreia em produção adiada por "onde configuro isso?"; risco de a chave ficar em estado ambíguo entre YAML e dashboard.
- **Dependências**: —

### [deployability-2] Criar workflow `.github/workflows/ingest-aprovacoes.yml`

- **Problema**
  > O job `job:ingest-aprovacoes` existe como script npm mas **não tem workflow de agendamento**. As Frentes I/II/IV têm workflows dedicados (cron + `workflow_dispatch`). A invariante I7 exige que a UI mostre idade do snapshot — sem cron, o painel mostra números que envelhecem sem alarme, minando o valor do "parada há X" (métrica-chave do PRD).

- **Melhoria Proposta**
  > Espelhar `ingest-extratos.yml` (mesma estrutura, `concurrency` group, `workflow_dispatch`, timeout adequado). Cadência inicial conservadora: 1×/dia no minuto :40 (evitando colisão com Permutas :00, SISPAG :00, Extratos :20 — respeitando `LOGIN_ERROR_MAX_SESSIONS` do Conexos). Envs: `APROVACOES_INGEST_FIL_CODS`, `APROVACOES_BACKFILL_DESDE`, `RETOMAR`. Só habilitar `schedule:` depois do go-live (Fase 2 do runbook); antes disso, deixar só `workflow_dispatch`.

- **Resultado Esperado**
  > Snapshot atualiza automaticamente pelo menos 1×/dia sem intervenção humana. Cadência ajustável via edição do arquivo, versionada no repo.

- **Tactic alvo**: Script Deployment Commands · Scale Rollouts
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Workflows de ingestão da Frente V: 0 → 1
  - Cadência automática: 0/dia → ≥ 1/dia (após go-live)
  - Idade máxima observada do snapshot em UI: sem limite → ≤ 25h
- **Risco de não fazer**: Painel envelhece silenciosamente; analista perde confiança; ingestão manual vira SPOF humano.
- **Dependências**: Go-live em produção (Fase 2 do runbook). Antes disso, entregar só o esqueleto com `workflow_dispatch`.

### [deployability-3] Documentar rollback de schema para a migration `0049` no runbook

- **Problema**
  > O repo é forward-only (nenhuma migration tem `down`), com idempotência via `IF NOT EXISTS`. A migration `0049_aprovacao_trilha.sql` **nunca foi aplicada a um Postgres real** e a Fase 1.1 do runbook é o primeiro teste. Se a estreia em homologação corromper o schema (tipo errado, `CHECK` restritivo demais, colisão de nome), não há receita documentada — nem no runbook, nem no CLAUDE.md — de como reverter as 3 tabelas + 8 índices sem chamar `psql` de memória.

- **Melhoria Proposta**
  > Adicionar seção "§Rollback de schema (homologação)" ao runbook, com o SQL explícito:
  > ```sql
  > BEGIN;
  > DROP TABLE IF EXISTS aprovacao_etapa;
  > DROP TABLE IF EXISTS aprovacao_titulo;
  > DROP TABLE IF EXISTS aprovacao_ingestao_run;
  > DELETE FROM schema_migrations WHERE name = '0049_aprovacao_trilha.sql';
  > COMMIT;
  > ```
  > Restringir uso a **homologação** e a **prod antes do go-live** (a partir de dados reais, DROP vira destrutivo). Registrar checklist: (1) parar backend, (2) rodar SQL, (3) revisar 0049, (4) redeploy.

- **Resultado Esperado**
  > Estreia em homologação com plano de rescue pronto. Tempo de recuperação após schema quebrado: indefinido → ≤ 15min.

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3, F-deployability-6
- **Métricas de sucesso**:
  - Receitas de rollback documentadas para 0049: 0 → 1
  - Tempo esperado de rescue em homologação: indefinido → ≤ 15min
- **Risco de não fazer**: Homologação zumbi após primeira falha; time redescobre comando na hora do incidente; risco de aplicar DROP errado.
- **Dependências**: —

### [deployability-4] Definir critérios numéricos de aborto do go-live no runbook

- **Problema**
  > A §Fase 2 do runbook lista pré-requisitos qualitativos ("Fase 1 concluída sem sintoma", "passada de olho da analista"). Sem % de corte para `INDETERMINADO`, `SEM_WORKFLOW` e `duracao_segundos NULL`, a decisão de estrear é subjetiva. O próprio runbook antecipa que `SEM_WORKFLOW` pode chegar a "~metade da base" — o operador não sabe se 55% é normal ou sintoma.

- **Melhoria Proposta**
  > Adicionar tabela "Critérios de aborto (não estrear se…)" à §Fase 2:
  > | Métrica | Corte de aborto |
  > |---|---|
  > | `% INDETERMINADO` sobre títulos com workflow | > 5% |
  > | `% duracao_segundos NULL` em etapas `CONCLUIDA` | > 2% |
  > | `% SEM_WORKFLOW` inesperado (fora da faixa de ~50%) | > 70% ou < 30% |
  > | `total_titulos` na filial 3 (canário) | 0 |
  > | `cursor_doc_cod` sem avanço entre duas rodadas | recorrência |
  >
  > (Os cortes são estimativas iniciais — a analista da Columbia deve calibrar após a Fase 1.)

- **Resultado Esperado**
  > Decisão de go-live com critério objetivo. Tempo de decisão pós-backfill: subjetivo → mensurável em minutos.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Critérios numéricos de aborto documentados: 0 → 5
  - Queries SQL prontas para calcular os cortes: 0 → 5
- **Risco de não fazer**: Go-live apressado ou paralisado por indecisão; discussão em reunião ao invés de checklist.
- **Dependências**: —

### [deployability-5] Adicionar drift check: `render.yaml` × dashboard e `schema_migrations` × filesystem

- **Problema**
  > 10 chaves com `sync: false` em `render.yaml` designam o dashboard como fonte da verdade sem reconciliação. Um `RECEBIMENTOS_ENABLED` deletado por acidente no dashboard vira comportamento default no próximo restart. Migrations em worktree paralelo podem faltar em `schema_migrations` sem alarme.

- **Melhoria Proposta**
  > (a) Job GitHub Actions semanal que usa a API do Render para listar envs live e cruza com `render.yaml`, alertando via issue automática se uma chave `sync: false` estiver ausente em prod. (b) Endpoint de health estendido (`/health/migrations`) que compara `readdirSync(migrations/)` com `SELECT name FROM schema_migrations` e devolve 500 se divergir.

- **Resultado Esperado**
  > Divergência entre YAML e dashboard detectada em ≤ 7 dias · migration ausente em prod detectada em ≤ 1min pela healthcheck do Render.

- **Tactic alvo**: Drift detection
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Alarmes de drift configurados: 0 → 2 (env + schema)
  - Tempo médio até detecção de env fora-do-YAML: ∞ → ≤ 7d
- **Risco de não fazer**: MTTR maior em incidentes de configuração; debug parte da aplicação por eliminação; risco silencioso maior à medida que mais frentes usam `sync: false`.
- **Dependências**: Token de leitura Render CLI/API.

### [deployability-6] Rodar a migration `0049` contra Postgres real (Supabase homolog) antes do PR merge

- **Problema**
  > Runbook admite explicitamente: "Sintaxe SQL e semântica de tipos não foram validadas contra Postgres". A primeira aplicação real da 0049 é em homologação — se falhar aqui, o `preDeployCommand` do Render aborta o deploy da prod, atrasando qualquer entrega concorrente. A suíte `AprovacoesSql.test.ts` valida string SQL, não execução.

- **Melhoria Proposta**
  > (a) Provisionar um branch database temporário no Supabase (feature `supabase branching`) ou usar Postgres local em Docker no CI, e adicionar step ao `ci.yml`:
  > ```yaml
  > - name: Testar migration em Postgres real
  >   run: |
  >     export databaseConnectionString=$TEST_DB_URL
  >     npm run migrate
  >     psql $TEST_DB_URL -c "\d aprovacao_titulo" -c "\d aprovacao_etapa" -c "\d aprovacao_ingestao_run"
  > ```
  > (b) Cobrir sanity `SELECT` das 3 tabelas + `INSERT` de amostra + verificação de que `CHECK` rejeita valores inválidos.

- **Resultado Esperado**
  > Regressão de migration pega no CI, não no `preDeployCommand` do Render. Primeira aplicação real da 0049 antes de ela virar dependência de outros deploys.

- **Tactic alvo**: Reproducible builds · Idempotent deploys
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-deployability-6, F-deployability-3
- **Métricas de sucesso**:
  - Execuções reais da 0049 antes do prd: 0 → ≥ 1 por PR
  - Cobertura de migrations testadas em CI: 0/50 → 50/50
- **Risco de não fazer**: Estreia da Frente V pode empurrar erro para prod-time; risco escala com cada nova migration.
- **Dependências**: Decisão de infra de teste (branch Supabase vs. Postgres Docker no CI).

## 6. Notas do agente

- Escopo restrito ao delta da Frente V (feature flag, migration, job, runbook) conforme instrução. Métricas de Render (deploy success rate, lead time, MTTR) são não-medíveis localmente — requerem acesso ao dashboard/API do Render (recomendação: instrumentar via GitHub → Render deploy hook logs).
- Terraform e per-tenant tactics marcados N/A com justificativa (CLAUDE.md §Estado Atual vs. Alvo — não existe `infra/`).
- **Cross-QA links para o consolidator**:
  - **Fault-tolerance**: o kill-switch documentado (`APROVACOES_ENABLED=false` + restart) depende de `EnvironmentProvider` ser `@singleton` com cache — restart é obrigatório, e isso interage com estratégia de recuperação. F-3 (rollback de schema) também é tema de fault-tolerance.
  - **Testability**: F-deployability-6 (migration nunca rodou em Postgres real) é primariamente uma dívida de testability.
  - **Modifiability**: convenção forward-only de migrations sem `down` (F-deployability-3) é decisão arquitetural que afeta modifiability e deployability juntas.
  - **Performance**: cadência do cron ausente (F-2) interage com custo da varredura ERP (uma chamada por título enquanto PV-07 aberto) — performance vai reprocessar.
