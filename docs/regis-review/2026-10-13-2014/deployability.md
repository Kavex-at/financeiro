---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-13-2014
agent: qa-deployability
generated_at: 2026-10-13T20:30:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 2
---

# Deployability — Regis-Review

> Escopo: delta `git diff 5a17d3e HEAD` (v0.64.0 -> v0.65.0). Infra/Terraform não existe neste repo; deploy real = Render (hook) + crons GitHub Actions rodando `tsx` sobre a árvore-fonte.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex (merge em main) | Deploy da v0.65.0: migration 0083 + ingestão passa a sincronizar DDA antes dos títulos, sem feature flag | `migrations/0083`, `IngestaoPagamentosService.runIngestion`, `ingest-sispag.yml`, Render | Produção, crons 07h/12h/16h BRT + abertura de tela (TTL 30 min) ativos durante o deploy | Esquema migrado antes de qualquer código novo gravar `doc_esp_numero`; falha do DDA nunca derruba a carteira; reversão por redeploy sem tocar no banco | 0 execuções de ingestão com erro de coluna ausente; ingestão <= ~70 s (10 s + 60 s de prazo) dentro do `timeout-minutes: 20`; rollback = redeploy da versão anterior (sem passo de banco) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migration 0083 aditiva (nullable, `IF NOT EXISTS`, sem DEFAULT/backfill) | sim, 1 `ALTER TABLE ADD COLUMN IF NOT EXISTS` | aditiva + idempotente | ✅ | `src/backend/migrations/0083_titulo_doc_esp_numero.sql` |
| Migration aplicada antes do código nos crons | `npm run migrate` precede `job:ingest-pagamentos` (3 workflows de ingestão SISPAG/permutas/extratos + 5 outros) | migrate antes do job | ✅ | `.github/workflows/ingest-sispag.yml:58-61` |
| Migrations copiadas ao `dist/` no build | `build` = `tsc && tsc-esm-fix dist && tsx migrations/copy-to-dist.ts`; 84 `.sql` no diretório (0083 entra por `MigrationFiles.list`, mesma definição do runner) | cópia no build | ✅ | `src/backend/package.json:11`, `migrations/MigrationFiles.ts` |
| Boot do servidor migra antes de `listen` | `runMigrations` -> `BootMigrator.run()` passado a `startServer` | migrate no boot | ✅ | `src/backend/index.ts:68-75` |
| Janela código-novo x esquema-velho (Render sobe antes do cron migrar) | coberta pelo `BootMigrator` (corrigido após incidente 2026-09-23); o `UPSERT` novo referencia `doc_esp_numero` | 0 s sem migrar | ✅ | `TituloAPagarRepository.ts:91-139` |
| Janela código-velho x esquema-novo (cron em andamento durante migrate) | coluna nullable nova; SELECT/INSERT antigos não a citam | compatível | ✅ | diff do repositório |
| Reversão de comportamento | redeploy 0.64.0; coluna permanece (inócua). Sem `rollbacks/0083*.rollback.sql` (justificado no cabeçalho: aditiva) | rollback documentado | ✅ (sem kill-switch, ver F-deployability-1) | `0083_*.sql:12-13` |
| Feature flag / kill-switch para a sincronização DDA | ausente (`DDA_PRAZO_NA_INGESTAO_MS = 60_000` constante) | flag ou env | ⚠️ | `IngestaoPagamentosService.ts:23-29` |
| Teto de custo adicional por execução | +60 s sobre ~10 s de ingestão (6x no pior caso) vs `timeout-minutes: 20` (margem 17x) | < timeout do workflow | ✅ | ADR-0067, `ingest-sispag.yml:38` |
| Versão FE == BE | 0.65.0 == 0.65.0 | lockstep | ✅ | `src/backend/package.json:3`, `src/frontend/package.json:3` |
| CHANGELOG raiz + CHANGELOG da ontologia + ADR | v0.65.0 / ontologia v0.39.2 (era 0.39.1) / ADR-0067 sequencial após 0066; menciona migration 0083 | consistentes | ✅ | `CHANGELOG.md:3-15`, `ontology/CHANGELOG.md:6`, `ontology/decisions/0067-*` |
| Teste da migration | 2 asserções sobre o texto do SQL (não executa contra Postgres) | execução real | ⚠️ | `0083_titulo_doc_esp_numero.test.ts` |
| Falha de DDA visível a quem opera | `::warning::` no job + `error_message` da run + `dda.estado` no resultado | observável | ✅ | `jobs/ingest-pagamentos.ts:30-45` |
| Baseline testes backend | 230 suites / 4081 passando | verde | ✅ | `_shared-metrics.md` |
| Terraform / drift / state | N/A: `infra/` ausente | n/a | ⚠️ Não medível | CLAUDE.md §Layout |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary/blue-green/rolling) | Render troca instância inteira; sem canário. Comportamento novo entra em 100% das superfícies (cron, tela, botão) no primeiro run pós-deploy | ⚠️ parcial | ADR-0067; sem flag |
| Rollback | Redeploy da versão anterior; migration aditiva dispensa reverse. Não há comando único documentado para este ciclo, mas o caminho é trivial | ⚠️ parcial | `0083_*.sql:12`, `rollbacks/README.md` |
| Script Deployment Commands | `npm run migrate` / `npm run build` (copy-to-dist) scriptados; bump de versão manual por falta de pwsh (memória do projeto) | ✅ | `package.json`, workflows |
| Logical Grouping | N/A: sem Terraform/tenants neste repo | N/A | CLAUDE.md |
| Physical Grouping | N/A: runtime único Render + crons | N/A | idem |
| Package Dependencies | Migration + código no mesmo commit/versão; ordem garantida por migrate-antes-do-job e BootMigrator | ✅ | workflows, `index.ts` |
| Surge Protection | Prazo de 60 s por rodada; `IngestLockBusyError` -> `ocupada`; advisory lock evita sincronização dupla; `concurrency: ingest-sispag` | ✅ | `IngestaoPagamentosService.ts:196-222` |
| Idempotent deploys | `ADD COLUMN IF NOT EXISTS`; UPSERT com COALESCE preserva valor anterior | ✅ | migration + repositório |
| Drift detection | N/A: sem IaC | N/A | — |
| Reproducible builds | `npm ci`; build copia `.sql` por definição única | ✅ | workflows |
| Deployment observability | `dda.estado` + warning no log do job + `error_message` na run | ✅ | `ingest-pagamentos.ts` |
| Per-tenant blast-radius | N/A: tenant único (Columbia) | N/A | — |

## 4. Findings

### F-deployability-1: Comportamento novo da ingestão sem kill-switch operacional

- **Severidade**: P2 (sem baseline de incidente; custo máximo conhecido e limitado)
- **Tactic violada**: Scale Rollouts / Rollback (granularidade)
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:23-29,359`
- **Evidência (objetiva)**:
  ```
  export const DDA_PRAZO_NA_INGESTAO_MS = 60_000;   // constante, sem leitura de env
  const dda = await this.sincronizarDda(input.triggeredBy); // incondicional em runIngestion
  ```
- **Impacto técnico**: se o fin124 degradar (lento, sessão do robô no cap), cada ingestão paga até 60 s extras e consome sessão do robô antes da leitura de títulos. Desligar exige novo commit + deploy Render (e merge em main para os crons, que rodam a árvore-fonte).
- **Impacto de negócio**: carteira SISPAG fica até ~1 min mais lenta na abertura de tela; não corrompe dado (falha vira aviso).
- **Métrica de baseline**: pior caso +60 s sobre ~10 s de ingestão (6x); `timeout-minutes: 20` do workflow. Sem incidente observado -> P2.

### F-deployability-2: Teste da migration só inspeciona texto, não executa o DDL

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands (verificação pré-deploy)
- **Localização**: `src/backend/migrations/0083_titulo_doc_esp_numero.test.ts:1-22`
- **Evidência (objetiva)**: asserções por regex sobre o `.sql`; comentário admite "o `MigrationRunner` não roda sob Jest". Padrão do repo, não regressão.
- **Impacto técnico**: erro de sintaxe/nome de tabela só apareceria no `npm run migrate` do cron (que falha o workflow antes da ingestão e aciona o alerta ADR-0042).
- **Impacto de negócio**: no pior caso, uma execução de cron perdida e alerta; baixo.
- **Métrica de baseline**: 2 asserções textuais, 0 execuções em Postgres no CI para a 0083.

### F-deployability-3: Primeira execução pós-deploy exercita o caminho novo em produção sem ensaio

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `.github/workflows/ingest-sispag.yml` (sem passo de dry-run); `jobs/ingest-boletos-dda.ts`
- **Evidência (objetiva)**: a primeira leitura do pool (parado desde 08/10, ~5 dias de arquivos) acontece dentro do prazo de 60 s; o excedente fica "adiado" para rodadas seguintes (novos primeiro). Convergência leva N rodadas (3 por dia útil).
- **Impacto técnico**: `dda.estado = parcial` e aviso na run nas primeiras execuções são esperados, não falha; o time pode confundir com regressão.
- **Impacto de negócio**: ruído de alerta no primeiro dia; nenhuma perda de dado.
- **Métrica de baseline**: 5 dias de defasagem / 3 ingestões por dia útil; sem número de arquivos pendentes medido localmente (não medível sem acesso a PRD).

## 5. Cards Kanban

### [deployability-1] Tornar o prazo/ativação da sincronização DDA configurável por env

- **Problema**
  > A sincronização DDA dentro da ingestão é incondicional e o prazo (60 s) é constante no código. Desligá-la ou encurtá-la em incidente do fin124 exige commit, merge e deploy.

- **Melhoria Proposta**
  > Ler `DDA_NA_INGESTAO_ENABLED` e `DDA_PRAZO_NA_INGESTAO_MS` via `EnvironmentProvider` (default = comportamento atual). Quando desligado, `dda` fica `undefined` e o resultado continua válido. Tactic: Scale Rollouts (feature toggle). Tocar `IngestaoPagamentosService.ts` e `EnvironmentProvider`.

- **Resultado Esperado**
  > Desativação em minutos via env do Render/secret do Actions. Tempo de desligamento: ~1 ciclo de deploy -> alteração de variável.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Passos para desligar o DDA na ingestão: commit+merge+deploy -> 1 variável de ambiente
  - Pior caso de latência adicional controlável: 60 s fixo -> configurável
- **Risco de não fazer**: em uma degradação prolongada do fin124, cada ingestão (3/dia útil + aberturas de tela) paga o prazo cheio até o hotfix.
- **Dependências**: nenhuma

### [deployability-2] Registrar no runbook do SISPAG o comportamento esperado do primeiro dia pós-deploy

- **Problema**
  > O pool DDA estava parado desde 08/10; nas primeiras rodadas o estado `parcial` e o aviso em `error_message` são esperados até o pool convergir. Sem nota, parece regressão.

- **Melhoria Proposta**
  > Acrescentar ao ADR-0067 (ou `DEPLOY.md`) o roteiro: quais estados são normais no 1º dia, como conferir convergência (`arquivosAdiados` -> 0) e como reverter (redeploy 0.64.0; coluna `doc_esp_numero` fica). Tactic: Rollback (documentado).

- **Resultado Esperado**
  > Operador distingue "convergindo" de "quebrado" sem consultar o autor.

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3, F-deployability-2
- **Métricas de sucesso**:
  - Passos de rollback documentados para este ciclo: 0 -> 1 parágrafo
- **Risco de não fazer**: falso alarme no primeiro dia útil após o deploy.
- **Dependências**: nenhuma

## 6. Notas do agente

- Ordenação migração x código verificada: `npm run migrate` precede o job nos 8 workflows que usam o banco; o servidor migra no boot (`BootMigrator`) e `copy-to-dist.ts` leva os `.sql` ao `dist/`, então o gotcha do CLAUDE.md não se aplica à 0083.
- Versão lockstep, CHANGELOG, ontologia (0.39.1 -> 0.39.2) e ADR-0067 consistentes; nenhum P0/P1 encontrado.
- Cross-QA: Performance (+60 s no pior caso na abertura de tela via `CarteiraAtualizacaoService`, se síncrono), Fault-Tolerance (degradação do DDA como `estado`), Testability (migration testada só por texto).
- Não medível: tempo real do primeiro run pós-deploy e quantidade de arquivos DDA pendentes (requer PRD).
