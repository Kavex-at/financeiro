---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-28-1534
agent: qa-deployability
generated_at: 2026-09-28T18:40:00Z
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (Regis-Review, `/feature-tweak`) via `git push` → `main` | Deploy que adiciona coluna (`encerrado_em`), faz backfill aproximado em ~190 linhas de ledger e substitui `metricas.metricas_ciclo()`, mudando um número **já publicado** à Columbia (semana 11–18/09: R$ 0,00 → R$ 150.061,81) | `BootMigrator` (migração 0065), `PermutaExecucaoRepository`/`SolicitacaoNumerarioExecucaoRepository` (novos carimbos de `encerrado_em`), função SQL `metricas.metricas_ciclo` | Produção: Render single-instance, `autoDeploy: true`, sem passo humano entre merge e deploy (`DEPLOY.md`) | Migração aditiva aplicada no boot antes do `app.listen()` (nenhuma janela código-novo/banco-velho); código antigo revertível sem tocar o schema; mudança de número comunicada via ADR-0052 (Seção 3 do report do ciclo) | 0 falhas de boot; 24/24 testes SQL de integração passam (5 novos para a 0065); delta conhecido de R$ 503.066,69 / 2 linhas reproduzido e conferido em produção após o deploy |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates de CI no delta (typecheck/lint/test/build) | ✅ todos verdes | 100% verde antes de merge | ✅ | `_shared-metrics.md`; `.github/workflows/ci.yml` |
| Testes SQL de integração (`backend-sql`, Postgres 17 real) cobrindo a 0065 | 24/24 (5 novos: retentativa permuta, retentativa SN, re-clique, backfill, contrato) | 100% | ✅ | `_shared-metrics.md`; `vwMetricasCiclo.integration.test.ts` |
| Guards estáticos (`vwMetricasCiclo.test.ts`) | 21/21 (5 novos) | 100% | ✅ | `_shared-metrics.md` |
| Linhas afetadas pelo backfill da 0065 | ~190 (permuta + SN) | < 1.000 (limiar que exige script de reverse, `rollbacks/README.md`) | ✅ | `0065_metricas_ciclo_data_pelo_encerramento.sql`; `_shared-metrics.md` |
| Tipo de mudança de schema | Aditiva (`ADD COLUMN IF NOT EXISTS`, nullable, sem default) | Aditiva > destrutiva | ✅ | `0065_...sql:48-52` |
| Script de reverse dedicado (`migrations/rollbacks/0065_*.rollback.sql`) | Ausente | Exigido só se > 1.000 linhas (não é o caso) | ✅ (conforme política) | `ls src/backend/migrations/rollbacks/` |
| Verificação automatizada pós-deploy do valor recalculado em produção | Ausente — depende de consulta manual colada em `ontology/_inbox/` | 1 verificação automatizada (smoke/relatório) por deploy que recalcula série publicada | ⚠️ | `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` |
| Leitura do banco de produção para fechar o loop desta revisão | Negada ao agente nesta sessão | — | ⚠️ **Não medível localmente**: acesso de leitura à produção. Recomendação: rodar a consulta do inbox e colar o resultado antes do merge (já é o passo documentado). | `_shared-metrics.md` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Render substitui a instância inteira quando o health check da nova versão fica verde (all-or-nothing); sem canary/blue-green. Inalterado por este delta. | ⚠️ parcial (pré-existente, fora do escopo do delta) | `DEPLOY.md` §2 |
| Rollback | One-click no Render + runbook dedicado com tabela de decisão "aditiva é segura / destrutiva escala". A 0065 é aditiva: revertível sem tocar schema. | ✅ presente | `docs/runbooks/rollback.md`; `0065_...sql` (`ADD COLUMN IF NOT EXISTS`) |
| Script Deployment Commands | `npm run build` (tsc + cópia de `.sql` para `dist/`), `BootMigrator` no boot, `MigrationRunner` idempotente com advisory lock + timeouts; deploy é `git push` → Render `autoDeploy`. | ✅ presente | `src/backend/migrations/BootMigrator.ts`; `runMigrations.ts`; `package.json:"build"` |
| Logical Grouping | Monolito único (`financeiro-backend`); não há decomposição em componentes deployáveis independentes a agrupar. | N/A — arquitetura atual é um serviço único (Express/Render), não um conjunto de serviços a agrupar | `DEPLOY.md` |
| Physical Grouping | Serviço único, uma região; sem múltiplas instâncias físicas a distribuir. | N/A — mesma razão acima | `DEPLOY.md` |
| Package Dependencies | `package-lock.json` versionado, `npm ci` no CI e no build do Render, Node pinado (`node-version: '24'`). | ✅ presente | `ci.yml:18-23`; `src/backend/package-lock.json` |
| Surge Protection | Sem alteração neste delta; pools de conexão Postgres têm teto documentado (`DEPLOY.md` "Budget de sessões"), mas não é tocado pela 0065. | ⚠️ parcial (pré-existente, fora do escopo do delta) | `DEPLOY.md` §1 |
| Idempotent deploys | `MigrationRunner` registra em `schema_migrations` sob advisory lock (transação por arquivo); a própria 0065 é idempotente (`IF NOT EXISTS`, backfill só onde `NULL`, `CREATE OR REPLACE`), confirmado por teste dedicado ("reaplicar a migration é no-op"). | ✅ presente, e testado neste delta | `0065_...sql:44-46`; `vwMetricasCiclo.integration.test.ts` (teste "reaplicar…") |
| Drift detection | Não há Terraform/IaC (não existe `infra/` — confirmado, CLAUDE.md §Estado Atual). Config do Render é manual via dashboard; o próprio `DEPLOY.md` registra um incidente histórico de drift entre `render.yaml` e a config real (`preDeployCommand` nunca rodou). Nada disso é tocado por este delta. | ❌ ausente (pré-existente, fora do escopo do delta) | `DEPLOY.md` §2 (nota sobre `preDeployCommand`) |
| Reproducible builds | Lockfile commitado, Node pinado, `tsc` determinístico (sem timestamps embutidos observados na 0065/repositórios). | ✅ presente | `ci.yml`; `src/backend/package-lock.json` |
| Per-tenant blast-radius limit | Sistema atual é single-tenant (Columbia Trading); SaaS multi-tenant é arquitetura-alvo ainda não implementada (CLAUDE.md §Tenants: "sem tenants provisionados"). Todo deploy afeta 100% do único cliente por construção. | N/A — não há multi-tenant hoje; blast radius é binário (1 cliente) | `CLAUDE.md` §Tenants |
| Deployment observability | Boot loga `[boot-migrate] aplicada(s) N: <arquivo>`; `/health` e `/health/pipelines` existem. Para este delta especificamente, falta um passo automatizado que confirme, após o deploy, que a série recalculada bateu com o esperado (ver Finding 1) — hoje é uma consulta manual num arquivo de inbox. | ⚠️ parcial | `BootMigrator.ts:79-83`; `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` |

## 4. Findings (achados)

### F-deployability-1: Recálculo de número já publicado ao cliente sem verificação automatizada pós-deploy

- **Severidade**: P2
- **Tactic violada**: Deployment observability
- **Localização**: `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`; `src/backend/migrations/0065_metricas_ciclo_data_pelo_encerramento.sql`
- **Evidência (objetiva)**:
  ```
  Status: aberto — a consulta não foi rodada contra produção nesta sessão (acesso de leitura ao
  banco de produção negado ao agente em 2026-09-28). Rodar antes do merge, ou logo depois do
  deploy, e colar o resultado aqui e no report do ciclo em que o delta entra.
  ```
  A migração recalcula, sem remendo, toda a série de `metricas.metricas_ciclo()` — inclusive um
  número já publicado à Columbia (semana 11–18/09: R$ 0,00 → R$ 150.061,81; delta conhecido em
  18/09: 2 linhas em 190, R$ 503.066,69). A única verificação prevista é uma query `psql` manual
  copiada num arquivo de inbox, sem gate de CI, sem cron e sem asserção automatizada contra o banco
  real — apesar de a lógica em si estar muito bem coberta por 5 testes de integração novos rodando
  em Postgres real no CI (fixtures sintéticas, não o dado de produção).
- **Impacto técnico**: se o backfill se comportar diferente em produção do que nos fixtures (p.ex.
  linhas com `atualizado_em` NULL, fusos diferentes, volume real maior que o estimado), ninguém
  descobre automaticamente — só quando o report do ciclo for montado à mão.
- **Impacto de negócio**: o dado que vai para a Columbia é literalmente o mesmo dado usado para
  aprovar o rollout da 0065 declarado no ADR. Sem checagem automatizada, o intervalo entre "deploy"
  e "alguém rodou a query manual" é uma janela onde um número financeiro errado pode ser lido
  (inclusive pelo próprio operador) sem sinalização.
- **Métrica de baseline**: 0 de 1 verificações de produção esperadas foi executada nesta sessão
  (baseline conhecido, 18/09: 2 linhas / R$ 503.066,69 — não reconfirmado após a 0065).

### F-deployability-2: Tabela de decisão do runbook de rollback não cobre "coluna aditiva + backfill" — exatamente o caso da 0065

- **Severidade**: P3
- **Tactic violada**: Rollback (Script Deployment Commands / clareza operacional)
- **Localização**: `docs/runbooks/rollback.md:18-23`
- **Evidência (objetiva)**:
  ```
  | Deploy com migration aditiva (coluna/tabela nova, índice) | seguro | ... |
  | Deploy com migration destrutiva (drop/rename de coluna, mudança de tipo,
    backfill que sobrescreve) | NÃO reverta sozinho | ... |
  ```
  A 0065 é as duas coisas ao mesmo tempo: `ADD COLUMN IF NOT EXISTS` (aditiva) **e** um
  `UPDATE ... SET encerrado_em = atualizado_em` que sobrescreve ~190 linhas (o texto da segunda
  linha da tabela usa literalmente "backfill que sobrescreve" como exemplo de destrutiva). A tabela
  não diz explicitamente que "backfill num campo recém-criado" cai na primeira linha, não na
  segunda — a meta do runbook é decidir em ≤5min sem consultar ninguém.
- **Impacto técnico**: nenhum nesta migração específica (o backfill é sobre a coluna nova, nula por
  padrão; código antigo ignora a coluna e um rollback de código é seguro mesmo deixando o schema
  aplicado) — mas o texto do runbook, lido sob pressão, pode levar a escalar sem necessidade ou,
  pior, a hesitar no meio de um incidente.
- **Impacto de negócio**: aumento do MTTR num incidente futuro que reaproveite este mesmo padrão
  (coluna nova + backfill), que já é o segundo caso no histórico do projeto (a doc-string da própria
  migração cita a 0058/0060 como precedente).
- **Métrica de baseline**: 1 migração no delta (`0065`) que é simultaneamente exemplo da linha
  "aditiva" e da linha "backfill que sobrescreve" da tabela de decisão — a tabela não desambigua
  nenhum dos dois casos.

## 5. Cards Kanban

### [deployability-1] Automatizar a verificação pós-deploy de métricas recalculadas

- **Problema**
  > A 0065 recalcula um número já publicado à Columbia (R$ 503.066,69 conhecidos em 2 linhas), mas
  > a única conferência prevista é uma query manual colada em `ontology/_inbox/`. Não há gate de CI
  > nem cron que confirme, contra o banco real, que o recálculo saiu como o ADR-0052 previu.

- **Melhoria Proposta**
  > Tactic alvo: Deployment observability. Adicionar um passo (script `npm run verify:metricas-ciclo`
  > ou job leve no `reaper-sispag`/novo workflow) que roda a consulta de
  > `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` contra produção logo após o
  > boot aplicar uma migração em `metricas.*`, e publica o resultado (log estruturado ou anexo ao
  > report do ciclo) em vez de depender de alguém copiar/colar à mão.

- **Resultado Esperado**
  > Toda migração que mexe em `metricas.metricas_ciclo()` sai do boot com uma confirmação
  > automatizada anexada ao log/relatório, não só um arquivo de inbox esperando ação humana.
  > Métrica: 0 → 1 verificação automatizada por deploy de migração em `metricas.*`.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Verificações automatizadas pós-deploy de migrações em `metricas.*`: 0 → 1 por deploy
  - Tempo entre deploy e confirmação do número recalculado: hoje indeterminado (manual) → < 1 execução de boot
- **Risco de não fazer**: um próximo recálculo de série publicada (o padrão já se repetiu entre
  0058/0060 e 0065) some novamente na dependência de alguém lembrar de rodar a query manual antes
  do report do ciclo, com um número financeiro errado potencialmente visível entretanto.
- **Dependências**: nenhuma.

### [deployability-2] Desambiguar "coluna aditiva + backfill" na tabela de decisão do runbook de rollback

- **Problema**
  > `docs/runbooks/rollback.md` classifica migrações em "aditiva" (segura) ou "destrutiva, inclui
  > backfill que sobrescreve" (não reverta sozinho), mas a 0065 — como a 0058/0060 antes dela — é as
  > duas coisas: coluna nova + `UPDATE` que preenche linhas existentes. Sob a meta de "reverter em
  > ≤5min sem consultar ninguém", a tabela não deixa claro que "backfill numa coluna recém-criada"
  > pertence à linha segura.

- **Melhoria Proposta**
  > Tactic alvo: Rollback. Acrescentar uma linha (ou uma nota) explícita: "coluna nova + backfill que
  > só preenche a própria coluna nova, nunca sobrescreve dado existente em outra coluna → segura,
  > mesma linha de 'aditiva'". Referenciar a 0065 como exemplo real.

- **Resultado Esperado**
  > Um operador sob pressão decide em ≤5min sem precisar interpretar qual das duas linhas da tabela
  > se aplica a uma migração no padrão coluna-nova-mais-backfill.

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Ambiguidade da tabela de decisão para o padrão "coluna nova + backfill": presente → resolvida
- **Risco de não fazer**: MTTR maior num incidente futuro que reaproveite o mesmo padrão de
  migração (já seria o terceiro caso: 0058/0060, 0065, e o próximo).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estritamente o delta (`git diff origin/main..HEAD`): migração 0065, os dois repositórios de
  ledger e seus testes, ADR-0052. Não citei como finding a ausência de canary/blue-green, drift
  detection ou surge protection — são lacunas reais mas pré-existentes e fora do delta (mencionadas
  na Seção 3 como contexto).
- Ordenação migração-vs-código (o gotcha central pedido pela orquestração) está coberta pelo
  `BootMigrator` + `MigrationFiles.listOrFail` + cópia de `.sql` para `dist/` — infraestrutura já
  endurecida por incidentes anteriores (2026-08-10, 2026-09-23) e reaproveitada corretamente por
  este delta, sem regressão.
- **Cross-QA**: F-deployability-1 tem uma perna direta em Testability (a lógica está muito bem
  testada; o que falta é o elo produção↔teste) e em Fault-Tolerance/Observability (nenhum alerta
  automatizado se o recálculo divergir do esperado). F-deployability-2 é também Modifiability
  (documentação operacional que não acompanhou um padrão de migração que já se repetiu 2x).
- Não medi Lambda bundle size, Terraform, nem `local.api_lambdas` — não existem neste repositório
  hoje (arquitetura-alvo, ainda não implementada; ver `CLAUDE.md` §Estado Atual vs. Alvo).
