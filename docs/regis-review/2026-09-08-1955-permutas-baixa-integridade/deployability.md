---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-08-1955-permutas-baixa-integridade
agent: qa-deployability
generated_at: 2026-09-08T19:55:00-03:00
scope: backend
score: 7.0
findings_count: 5
cards_count: 5
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge em `main` (autoDeploy do Render) do commit `8b18686` — que traz `migrations/0056_permuta_execucao_parcial.sql` (novo CHECK + coluna `valor_residual_usd`) e código que escreve `parcial` | Deploy dispara: instância nova sobe em paralelo à antiga; `preDeployCommand` roda `npm run migrate`; `BootMigrator.run()` também tenta migrar sob `pg_advisory_lock(314159265)` antes do `listen()`; healthCheck `/health` valida readiness; Render então flipa o tráfego | Backend Express em `src/backend/`, banco Supabase, `permuta_alocacao_execucao` (CHECK ampliado), runbook `docs/runbooks/fin010-write-cutover.md` | Produção com **`CONEXOS_WRITE_ENABLED=true` / `CONEXOS_DRY_RUN=false` desde 2026-06-24** — 137 execuções, R$ 38,46M baixados já contam com esse caminho quente | (a) Migration idempotente aplicada antes do tráfego, sob lock; (b) instância antiga (ainda no ar durante a janela) continua servindo — schema novo é SUPERSET do union antigo, então nada quebra; (c) rollback do código, se necessário, tem plano documentado; (d) `/health` permite ao pinger externo confirmar a versão vigente | 0 escritas duplicadas na janela de flip; 0 baixas produzidas contra schema antigo; MTTR de rollback ≤ 10min (revert + push + Render redeploy) com procedimento explícito para linhas `parcial` já persistidas |

**Contexto que dita a severidade:** a escrita `fin010` está LIGADA em produção. Este delta é o
primeiro em que o Render sobe código que grava um estado novo (`parcial`) num CHECK que precisa
existir ANTES do primeiro INSERT. A ordem de migração está correta (pre-deploy antes do listen),
mas a mão inversa — **rollback do código com linhas `parcial` já gravadas** — é um caminho novo que
o delta introduz e nenhuma documentação prévia cobria.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migration 0056 idempotente (`IF EXISTS` / `IF NOT EXISTS`) | Sim — `DROP CONSTRAINT IF EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT` sem `IF NOT EXISTS` (Postgres não suporta) mas precedido do drop | Sim | ✅ | `src/backend/migrations/0056_permuta_execucao_parcial.sql:20-27` |
| Migração ordenada antes do tráfego (forward-safe) | Sim — `preDeployCommand: npm run migrate` no `render.yaml:24` + `BootMigrator.run()` antes do `app.listen(PORT)` | Sim | ✅ | `render.yaml:24`, `src/backend/index.ts:164-173` |
| Corrida entre instâncias durante rolling deploy | Serializada por `pg_advisory_lock(314159265)`, chave dedicada, distinta das de ingestão/permutas/lotes/poller | Serializada | ✅ | `src/backend/migrations/BootMigrator.ts:12,125-145` |
| Forward-compatibility do schema (schema novo + código antigo em paralelo na janela de flip) | Segura — CHECK novo é SUPERSET do antigo; `valor_residual_usd` é `NUMERIC` nullable; código antigo só grava valores ainda válidos | Segura | ✅ | Migration + `PermutaExecucaoRepository.ts:16` (union `pending/reconciling/settled/error/parcial`) |
| **Backward-compatibility** do schema (rollback do código, linhas `parcial` presentes) | **Frágil** — código anterior tem `ExecucaoStatus = 'pending' \| 'reconciling' \| 'settled' \| 'error'` e `beginExecution` só preserva `= 'settled'` (não `IN ('settled','parcial')`) → linha `parcial` seria reaberta e re-POSTada | Documentar caminho manual (marcar como `settled` no ERP + reconciliar coluna, ou congelar par) | ⚠️ | `PermutaExecucaoRepository.ts:257-284` (versão nova já cobre; a antiga em `main`@`47c48f8` não) |
| Runbook cobre `parcial` como sinal operacional | Sim — 4 blocos explícitos (Rollback, Sinais de problema, Invariantes, com procedimento "re-aloque o par") | Sim | ✅ | `docs/runbooks/fin010-write-cutover.md:29-33,44-58` |
| "Vigência" do runbook auditável em runtime | Parcial — `/health` devolve `{status,version}` só, sem estado das flags de escrita nem indicação da migração mais alta aplicada | `/health` responde `writeEnabled`, `dryRun`, `lastMigration` (agrega `permutasGate` do card `deployability-2` do run anterior) | ⚠️ | `src/backend/index.ts:79`, `docs/runbooks/fin010-write-cutover.md:80-83` |
| Kill-switch dedicado para Permutas (blast radius) | Ausente — só `CONEXOS_WRITE_ENABLED` (global) desliga a escrita, o que derruba **Recebimentos junto** | Flag `PERMUTAS_WRITE_ENABLED` gating específico | ❌ | `render.yaml:50-53`, ausência de `PERMUTAS_*` no manifest (`configManifest.ts`) — `deployability-1` do run anterior segue aberto |
| CI gates antes do autoDeploy (branch protection) | 5 steps backend (audit high, typecheck, lint, test+coverage, build) + 4 frontend (`ci.yml`) | ≥5 automatizados | ✅ | `.github/workflows/ci.yml:18-27` |
| Rollback documentado / one-command | Parcial — texto sob "Rollback / desligar a escrita" cobre kill-switch de flags; **não** cobre "reverter este commit com linhas `parcial` já persistidas" | Runbook com "receita" para revert + estado do schema/dado | ⚠️ | `docs/runbooks/fin010-write-cutover.md:29-33` |
| Feature-flag ordering (0054 ANTES do código que grava `parcial`) | Correto — cabeçalho da migration explicita a ordem e o custo do erro ("baixas já POSTadas no ERP") | Correto | ✅ | `src/backend/migrations/0056_permuta_execucao_parcial.sql:9-13` |
| Build reprodutível (lockfile, versão pinada) | `package-lock.json` presente; Node 24 pinado no CI (`ci.yml`); esbuild não é usado (Express `tsc` build) | Presente | ✅ | `.github/workflows/ci.yml:23-24` |
| Terraform / IaC / drift detection | **Não medível** — não existe `infra/` no repositório; deploy por Render Blueprint (`render.yaml`) versionado; um dashboard do Render é a fonte da verdade dos secrets. Não é lacuna deste QA neste stack | — | N/A | `render.yaml`, `CLAUDE.md` §"Estado Atual vs. Alvo" |
| Blue/green ou canário multi-tenant | **Não medível** — não há tenants provisionados (um serviço `financeiro-backend` único); Render faz rolling replacement (nova instância sobe, healthcheck, flip) | — | N/A | `CLAUDE.md` §Tenants |

## 3. Tactics — Cobertura no delta

Escopo: só as tactics que este delta toca ou deveria ter tocado. As demais foram avaliadas no run
`2026-09-08-1414-permutas` (REPORT.md, seção Deployability) e não são reavaliadas em `--quick`.

| Tactic (Bass, ch. 5) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Script Deployment Commands | Migrations SQL versionadas + `BootMigrator` que aplica sob lock antes do listen; `render.yaml` declara `preDeployCommand` e `healthCheckPath` | ✅ presente | `src/backend/migrations/BootMigrator.ts:60-81`, `render.yaml:20-24` |
| Manage Configuration Overrides (feature flags como Configure Behavior) | Global (`CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`), granular por frente (`SISPAG_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`), **mas sem `PERMUTAS_*` dedicado** | ⚠️ parcial | `render.yaml:29-58` (nada de `PERMUTAS_`); `configManifest.ts` (Permutas ausente do manifest) |
| Rollback (código) | Revert + push em `main` → Render autoDeploy refaz o release; sem receita documentada para o caso "código antigo + linhas `parcial`" | ⚠️ parcial | `docs/runbooks/fin010-write-cutover.md:29-33` cobre flag rollback, não code rollback com estado novo |
| Rollback (schema) | Migração 0054 é forward-only; não há `0054_down.sql` nem plano documentado — o CHECK ampliado pode conviver com código antigo por design (superset), então "rollback de schema" é geralmente desnecessário. **Não faz o inverso: apagar `parcial` do CHECK enquanto houver linhas `parcial` violaria o CHECK.** | ⚠️ parcial (aceito por design; risco residual documentável) | `migrations/0056_permuta_execucao_parcial.sql` |
| Scale Rollouts (canário / progressive delivery) | Não aplica — 1 serviço, 1 instância nominal, 1 ambiente de produção; Render faz rolling replacement (não canário). Homologação existe como stage manual (fase 1 do runbook), não como pipeline automatizado | N/A no stack atual | `docs/runbooks/fin010-write-cutover.md:14-20` |
| Logical Grouping (feature flag por front) | Frentes II e IV têm gate próprio; **Frente I (Permutas) usa o gate global do Conexos** — ampliando o blast radius desnecessariamente | ⚠️ parcial | `deployability-1` do run anterior segue aberto |
| Physical Grouping | N/A — deploy monolítico via Render, único web service | N/A | `render.yaml:4-6` |
| Package Dependencies | `package-lock.json` versionado + `npm ci` no CI + `npm audit --audit-level=high` no gate | ✅ presente | `.github/workflows/ci.yml:22-23` |
| Surge Protection | N/A neste delta — o delta é migração + serialização de escrita (advisory lock por adto), não fluxo de tráfego. O advisory lock em si funciona como surge protection do CAMINHO CRÍTICO da escrita, não do HTTP | N/A no delta | — |
| Reproducible Builds | Node pinado (`node-version: '24'` no CI); `npm ci` no build do Render (`buildCommand`); sem timestamp/UUID em artefato | ✅ presente | `.github/workflows/ci.yml:23`, `render.yaml:22` |
| Drift Detection (schema/config) | Migrations idempotentes + `BootMigrator` re-executa por design (no-op se em dia); **não há job periódico** que compare CHECK do banco com o esperado nem alerta sobre linhas `parcial` órfãs | ⚠️ parcial | `BootMigrator.ts:73-79` (só compara na hora do boot) |
| Deployment Observability | `/health` retorna `{status, version}`; `/health/pipelines` responde 503 quando há pipeline PARADO/abandonado (dead-man's switch, ADR-0042); **nenhum endpoint expõe as flags de escrita** | ⚠️ parcial | `src/backend/index.ts:79`; `src/backend/routes/health.ts:29-58` — `deployability-2` do run anterior segue aberto |
| Idempotent Deploys | Migração 0054 é idempotente por construção (`IF EXISTS`/`IF NOT EXISTS`); `BootMigrator` idempotente (fila de aplicadas no banco); `preDeployCommand` refaz sem efeito colateral | ✅ presente | `migrations/0056_permuta_execucao_parcial.sql:20-27`, `BootMigrator.ts:60-81` |

## 4. Findings

### F-deployability-1: Rollback de código com linhas `parcial` persistidas re-abre execução terminal e pode re-POSTar baixa

- **Severidade**: P1
- **Tactic violada**: Rollback (backward-compatibility do schema com o código imediatamente anterior)
- **Localização**: `src/backend/migrations/0056_permuta_execucao_parcial.sql`, `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:16,257-284`, `docs/runbooks/fin010-write-cutover.md:29-33`
- **Evidência (objetiva)**:
  ```
  # Código NOVO (este commit) — beginExecution preserva ambos os terminais
  status = CASE WHEN permuta_alocacao_execucao.status IN ('settled', 'parcial')
                THEN permuta_alocacao_execucao.status ELSE EXCLUDED.status END
  # Código ANTIGO (base `main` @ 47c48f8) — só conhecia 'settled':
  # o CASE WHEN não incluía 'parcial'; ExecucaoStatus não era o union de 5 valores.
  # Efeito: linha 'parcial' pré-existente é REABERTA para 'reconciling',
  # `alreadySettled=false`, e a rota tenta re-POSTar a baixa no ERP.
  ```
- **Impacto técnico**: se após este delta houver **rollback do commit** (revert + push, ou redeploy de release anterior no dashboard do Render) enquanto linhas `parcial` já foram gravadas, o código antigo (a) trata `parcial` como não-terminal em `beginExecution`, (b) o TS lê como string desconhecida no `ExecucaoStatus as`, (c) o handler segue para reconciliar de novo → **re-POST da baixa no `fin010`, que é irreversível por nós** (estorno manual). O advisory lock por adto não protege esse caminho: o advisory bloqueia execuções concorrentes, não uma re-execução deliberada após aparente terminação.
- **Impacto de negócio**: a escrita `fin010` está LIGADA há ~2,5 meses, ~137 baixas / R$ 38,46M; uma janela de rollback traz risco de duplicar baixa exatamente no momento em que o operador tenta se proteger do commit. A janela é curta (só o intervalo em que existirem linhas `parcial` reais no banco), mas o alcance é irreversível.
- **Métrica de baseline**: 0 linhas `parcial` no banco hoje (delta ainda não em produção). Assim que o código subir e a primeira baixa parcial for gravada, esta janela abre. Aritmética simples: N linhas `parcial` × probabilidade de rollback nas primeiras 72h × 1 POST duplicado por linha = custo esperado do incidente.

### F-deployability-2: `/health` não expõe estado da escrita (nem `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN` nem última migração aplicada); a "nota de vigência" do runbook depende de correlação manual

- **Severidade**: P2
- **Tactic violada**: Deployment Observability
- **Localização**: `src/backend/index.ts:79`, `docs/runbooks/fin010-write-cutover.md:80-83`
- **Evidência (objetiva)**:
  ```typescript
  // src/backend/index.ts:79
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: APP_VERSION }));
  ```
  ```markdown
  # docs/runbooks/fin010-write-cutover.md:80-83 (novo neste delta)
  > Vigência. As duas linhas acima entraram com a ADR-0044. Se estiver diagnosticando um
  > incidente, confirme que a versão em produção já as traz — GET /health devolve a
  > `version`, e a ADR aparece no CHANGELOG.md da release que a introduziu.
  ```
- **Impacto técnico**: o operador precisa (a) chamar `/health`, (b) mapear a versão para uma entrada do `CHANGELOG.md`, (c) confirmar que a versão inclui a ADR-0044. Se estiver às 2h da manhã diagnosticando um `parcial` inesperado ou um `settled` mudo em versão anterior, esse loop de correlação é lento e sujeito a erro. Além disso, `/health` não diz se `CONEXOS_WRITE_ENABLED=true`/`CONEXOS_DRY_RUN=false` — o operador precisa abrir o dashboard do Render para saber se estava em dry-run ou não, o que colide com o próprio runbook que diz "mudar flag exige restart".
- **Impacto de negócio**: MTTR de incidentes que envolvem "qual versão de código, com qual configuração, escreveu esta linha?" é multiplicado por o tempo do operador correlacionar CHANGELOG + dashboard. Card já existia (`deployability-2` do run anterior); este delta apoiou-se em `/health` como âncora de vigência, o que reforça a necessidade sem resolvê-la.
- **Métrica de baseline**: 2 campos expostos hoje (`status`, `version`). Alvo mínimo para atender à vigência: 4 campos — `version`, `writeEnabled`, `dryRun`, `lastMigration`.

### F-deployability-3: Sem kill-switch dedicado para a Frente I; desligar a escrita de Permutas exige derrubar Recebimentos junto (`CONEXOS_WRITE_ENABLED` é global)

- **Severidade**: P2
- **Tactic violada**: Logical Grouping (feature flag por front) e Rollback (limitar blast radius)
- **Localização**: `render.yaml:29-58`, `src/backend/domain/service/permutas/*`, ausência de `PERMUTAS_*` em `src/backend/domain/interface/operacao/configManifest.ts`
- **Evidência (objetiva)**:
  ```yaml
  # render.yaml — as flags que existem
  - key: SISPAG_ENABLED              # Frente II — UI
  - key: SISPAG_LIVE_WRITE_ENABLED   # Frente II — escrita
  - key: RECEBIMENTOS_ENABLED        # Frente IV — kill-switch
  - key: CONEXOS_WRITE_ENABLED       # GLOBAL — Permutas + Recebimentos
  - key: CONEXOS_DRY_RUN             # GLOBAL — todos que escrevem
  # Não existe PERMUTAS_ENABLED nem PERMUTAS_WRITE_ENABLED.
  ```
- **Impacto técnico**: um incidente na escrita da Frente I hoje deixa o operador com duas alavancas: (a) reverter o deploy (10-15min + risco descrito em F-deployability-1) ou (b) `CONEXOS_WRITE_ENABLED=false`, que também desliga a baixa de Recebimentos (uma frente independente, com seu próprio livro-razão vivo, R$/dia distinto). A segunda opção amplia o blast radius do incidente para uma frente que não está com problema.
- **Impacto de negócio**: qualquer regressão de Permutas força escolha entre lentidão (revert + Render redeploy) e derrubar a Frente IV que estava saudável. Card já existia (`deployability-1` do run anterior); este delta não fecha, mas também não agrava.
- **Métrica de baseline**: 2 alavancas dedicadas hoje para desligar Frente I (nenhuma granular; ambas globais). Alvo: 1 alavanca dedicada (`PERMUTAS_WRITE_ENABLED`).

### F-deployability-4: Runbook não explicita procedimento para "revert do código quando já houver linhas `parcial` no banco"

- **Severidade**: P2
- **Tactic violada**: Rollback (documentação operacional)
- **Localização**: `docs/runbooks/fin010-write-cutover.md:29-33`
- **Evidência (objetiva)**:
  ```markdown
  ## Rollback / desligar a escrita
  - Imediato: CONEXOS_DRY_RUN=true (ou CONEXOS_WRITE_ENABLED=false) + restart → nenhuma escrita nova.
  - Baixa já gravada: não há rollback automático — estornar manualmente no fin010 (UI). A linha em
    permuta_alocacao_execucao fica settled; um job de conciliação (follow-up) detectará a divergência.
    Cobertura insuficiente (ADR-0044): [...] a linha fica parcial [...] re-aloque o par [...]
  ```
  O texto cobre o kill-switch de flag e o `parcial` **em operação normal**, mas não descreve o
  cenário: "commit `8b18686` foi revertido e existem linhas `status='parcial'` no banco — o que o
  operador faz?" A resposta técnica está em F-deployability-1; ela precisa virar receita.
- **Impacto técnico**: em uma janela de rollback pouco frequente mas cara, o operador não tem um
  procedimento pronto — ele descobre o problema pelo sintoma (baixa duplicada no ERP).
- **Impacto de negócio**: alonga MTTR quando o cenário aparecer. Não impede o cenário; só o descobre depois.
- **Métrica de baseline**: 0 parágrafos do runbook dedicados a code-rollback com estado novo persistido; alvo: 1 parágrafo com passos numerados (marcar `parcial` como `settled` manualmente OU congelar o par antes do revert).

### F-deployability-5: Sem migration down / sem plano documentado para "encolher o CHECK" caso `parcial` precise ser removido

- **Severidade**: P3
- **Tactic violada**: Rollback (schema)
- **Localização**: `src/backend/migrations/0056_permuta_execucao_parcial.sql`
- **Evidência (objetiva)**:
  ```sql
  -- SQL idempotente: rodar duas vezes é no-op na segunda.
  ALTER TABLE permuta_alocacao_execucao
      DROP CONSTRAINT IF EXISTS permuta_alocacao_execucao_status_check;
  ALTER TABLE permuta_alocacao_execucao
      ADD CONSTRAINT permuta_alocacao_execucao_status_check
          CHECK (status IN ('pending', 'reconciling', 'settled', 'error', 'parcial'));
  ```
  Não há `0054_down.sql`. A convenção do repo é forward-only (comum e defensável). O ponto é: se um
  dia `parcial` for revisitado como conceito, encolher o CHECK exige uma migration de reconciliação
  de dados (`UPDATE permuta_alocacao_execucao SET status='error' WHERE status='parcial'` etc.) que
  não existe como template.
- **Impacto técnico**: baixo hoje. Torna-se um débito de horas quando (se) `parcial` for removido do union.
- **Impacto de negócio**: negligível a curto prazo.
- **Métrica de baseline**: 0 templates de "encolher union" na pasta `migrations/` — alvo: 1 exemplo referenciável no `README` de migrations.

## 5. Cards Kanban

### [deployability-1] Documentar (e implementar guard) para rollback de código sobre linhas `parcial` persistidas

- **Problema**
  > O código antigo em `main`@`47c48f8` não conhece o valor `parcial` do union e seu `beginExecution` só preserva `= 'settled'`. Se este commit for revertido enquanto houver linhas `parcial` já gravadas, a próxima execução da rota reabre a linha para `reconciling`, `alreadySettled=false`, e o serviço tenta re-POSTar a baixa no `fin010` — que é irreversível por nós. Risco concentrado na janela imediatamente após a primeira baixa parcial em produção.

- **Melhoria Proposta**
  > Adicionar seção "Rollback do código quando já houver linhas `parcial`" no `docs/runbooks/fin010-write-cutover.md`, com passos numerados: (a) `CONEXOS_WRITE_ENABLED=false` PRIMEIRO; (b) SQL para marcar `parcial` como `settled` no banco após auditar cada linha contra o ERP (o `bxa_cod_seq` já está preenchido — a baixa existe); (c) só então reverter o commit. Complementar: no código, considerar guard defensivo — antes de re-abrir uma execução, comparar `bxa_cod_seq` do banco com o ERP e abortar se houver baixa registrada mesmo em status não-terminal (barra o cenário via dado, não via documento). Tactic Bass: **Rollback** com foco em backward-compatibility ativa.

- **Resultado Esperado**
  > Runbook cobre code rollback com estado novo persistido; opcionalmente, `PermutaExecucaoRepository.beginExecution` recusa reabrir linha com `bxa_cod_seq IS NOT NULL` (0 linhas parcial → estado atual do banco / delta ainda não deployado; assim que a primeira parcial existir, o cenário estará coberto por procedimento).

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S (runbook) + S (guard) = ≤ 1d combinado
- **Findings relacionados**: F-deployability-1, F-deployability-4
- **Métricas de sucesso**:
  - Parágrafos do runbook cobrindo code-rollback: 0 → 1 (passos numerados)
  - Guard no repository: ausente → presente (teste `Promise.all([reconciliar(A), revert+reconciliar(A)])` — via mock — recebe 409/abort)
- **Risco de não fazer**: primeira janela de rollback pós-`parcial` pode duplicar uma baixa no ERP (irreversível por nós; estorno manual pela Columbia). R$ médio por baixa em Permutas hoje: R$ 280.775 (137 baixas / R$ 38,46M).
- **Dependências**: nenhuma — depende só do delta atual.

### [deployability-2] Expor `writeEnabled`, `dryRun` e `lastMigration` no `/health`

- **Problema**
  > `/health` devolve `{ status, version }`. A "nota de vigência" que este delta adicionou ao runbook aponta para `/health` como âncora de "esta versão já traz a ADR-0044", mas o operador precisa correlacionar version → CHANGELOG.md → ADR à mão. Adicionalmente, saber se o serviço está escrevendo agora (não em dry-run) exige abrir o dashboard do Render. Card já existia no run anterior (`deployability-2`) — este delta o reforça em vez de fechar.

- **Melhoria Proposta**
  > Ampliar o handler de `src/backend/index.ts:79` para expor `{ status, version, writeEnabled, dryRun, lastMigration }`. `lastMigration` vem do próprio `BootMigrator` (nome do último arquivo aplicado / `MAX(name) FROM migrations_applied`). Manter o campo `status` como estava — decisão binária que a sonda externa consome. Não expor secrets nem info que descreva a operação para não-`admin` (segue a doutrina do `routes/health.ts:14-22`). Tactic Bass: **Deployment Observability**.

- **Resultado Esperado**
  > `curl /health` responde os 5 campos; runbook pode citar `lastMigration >= 0056_permuta_execucao_parcial` como critério de vigência sem correlacionar CHANGELOG à mão. MTTR de "qual código estava rodando com qual flag" cai do minuto (correlacionar 2 sistemas) para segundos.

- **Tactic alvo**: Deployment Observability
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Campos expostos em `/health`: 2 → 5 (`status`, `version`, `writeEnabled`, `dryRun`, `lastMigration`)
  - Fontes que o operador consulta durante incidente: 2 (dashboard + repo) → 1 (só `/health`)
- **Risco de não fazer**: cada incidente de escrita na Frente I gasta 3-5min de correlação manual antes do primeiro passo real de diagnóstico.
- **Dependências**: nenhuma.

### [deployability-3] Criar `PERMUTAS_WRITE_ENABLED` como kill-switch dedicado (reduzir blast radius do `CONEXOS_WRITE_ENABLED`)

- **Problema**
  > Hoje o único gate específico da escrita da Frente I é o global `CONEXOS_WRITE_ENABLED`, que também governa Recebimentos. Uma regressão em Permutas força ou revert lento (com risco de F-deployability-1) ou desligar Recebimentos junto — uma frente independente, saudável, com seu próprio livro-razão. Card já aberto no run anterior (`deployability-1`); este delta não fecha, mas também não agrava.

- **Melhoria Proposta**
  > Introduzir `PERMUTAS_WRITE_ENABLED` no `EnvironmentProvider`/`configManifest.ts`; `ReconciliacaoPermutaService` verifica ANTES da lógica global (`CONEXOS_WRITE_ENABLED=true && PERMUTAS_WRITE_ENABLED !== 'false'`). Default seguro `true` para não regressar produção (a escrita já está ligada); explicitar no `render.yaml` como `sync: false` (fonte no dashboard). Tactic Bass: **Logical Grouping** (feature flag por front) e **Rollback** (limitar blast radius).

- **Resultado Esperado**
  > 1 alavanca dedicada para desligar SÓ Permutas em incidente, sem impactar Recebimentos. Alinha Frente I com o padrão que Frente II e Frente IV já seguem (`SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`).

- **Tactic alvo**: Logical Grouping / Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — flag + manifest + teste + entrada no runbook
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Kill-switch dedicado para Frente I: ausente → presente
  - Frentes afetadas ao desligar escrita de Permutas: 2 (Permutas + Recebimentos) → 1 (só Permutas)
- **Risco de não fazer**: próximo incidente de escrita na Frente I força o operador a escolher entre revert arriscado (F-deployability-1) e derrubar a Frente IV (saudável).
- **Dependências**: nenhuma.

### [deployability-4] Consolidar runbook — bloco único "revert com estado novo persistido"

- **Problema**
  > O runbook agora tem informação sobre `parcial` em três lugares (Rollback, Sinais de problema, Invariantes) mas não tem o caminho **inverso**: "eu quero reverter este commit — o que faço com as linhas `parcial` que ele criou?". F-deployability-1 descreve o risco; F-deployability-4 é a receita.

- **Melhoria Proposta**
  > Adicionar bloco numerado no `docs/runbooks/fin010-write-cutover.md` chamado "Revert do commit `8b18686` (ou versões subsequentes que escrevam `parcial`)": (1) desligar escrita; (2) contar linhas `parcial`; (3) para cada uma, auditar o ERP pelo `bxa_cod_seq` gravado; (4) marcar `parcial` como `settled` no banco (SQL de exemplo); (5) só então executar revert. Referenciar `deployability-1` como origem. Tactic Bass: **Script Deployment Commands** (revert como script, não como memória).

- **Resultado Esperado**
  > Bloco de 6-10 linhas com SQL explícito e ordem clara; runbook autocontido.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4, F-deployability-1
- **Métricas de sucesso**:
  - Parágrafos do runbook dedicados a code-rollback: 0 → 1
  - Passos numerados para revert seguro: 0 → 5
- **Risco de não fazer**: sobrepõe ao `deployability-1`.
- **Dependências**: `deployability-1` (a receita depende do procedimento definido lá; podem ser mergeados num só card se preferir).

### [deployability-5] Documentar como referência: template de "encolher union CHECK" para futuras remoções de estado

- **Problema**
  > O repo tem 54 migrations forward-only. Nenhum template explica como remover um valor de union do CHECK sem violar constraint se ainda existirem linhas com aquele valor. É débito latente — não custa nada hoje, mas custa horas na primeira vez que aparecer.

- **Melhoria Proposta**
  > Escrever `docs/migrations-playbook.md` (ou seção em `CLAUDE.md`) com 3 casos padronizados: (a) expandir union (o que a 0054 faz); (b) encolher union com dados presentes (`UPDATE ... SET status='error' WHERE status='<removido>'` ANTES de `DROP/ADD` do CHECK); (c) renomear valor (idem, com preservação do histórico via coluna auxiliar). Tactic Bass: **Script Deployment Commands** (playbook, não memória).

- **Resultado Esperado**
  > 1 doc referenciável quando (se) alguém precisar remover `parcial` ou qualquer outro valor de union no futuro.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Templates de "encolher union" documentados: 0 → 1
- **Risco de não fazer**: quando aparecer, custa 2-4h de descoberta ad-hoc em incidente.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo estrito ao DELTA**: não reavaliei o pipeline CI, `render.yaml`, ou pacote de migrations fora do que este commit toca. As métricas de CI, autoDeploy, `preDeployCommand`, `BootMigrator` e `/health` legado são do run anterior e ficaram apenas como **contexto** — não gerei card sobre elas (exceto `deployability-2`, que este delta apoiou-se sem fechar, e por isso foi carregado adiante).
- **Cross-QA link**: F-deployability-1 é primariamente **Availability** também — a mesma janela de rollback é o momento em que a disponibilidade da operação depende de o operador não fazer um passo errado. O consolidator provavelmente vai querer marcar como shared finding com Availability. F-deployability-2 se cruza com **Observability**/painel de operação (ADR-0042); F-deployability-3 se cruza com **Modifiability** (a estrutura das flags — hoje inconsistente entre frentes — é problema de granularidade).
- **Não medível confirmado**: Terraform, tenants, IAM, blue/green e canário são **N/A no stack atual** (Render + Vercel + Supabase). Nenhum finding foi gerado exigindo infra que o roadmap não alcançou.
- **Score 7,0**: a higiene do delta é boa (migration idempotente, ordem correta, `BootMigrator` sob lock, superset forward-compatible, runbook atualizado), mas o gap real é o caminho de rollback com estado novo persistido — que este delta abre e não fecha. Dois cards herdados do run anterior seguem abertos e são reforçados pelo delta.
