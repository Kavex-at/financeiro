---
qa: Availability
qa_slug: availability
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-availability
generated_at: 2026-09-14T16:24:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 4
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Runner externo `kavex-report-ciclo/scripts/metrics.py` conectando com o DSN `metricas_ciclo_leitor` durante o fechamento semanal | Leitura do `SELECT ... FROM vw_metricas_ciclo` retorna erro (permissão, view inexistente, timeout de 30s, tabela subjacente removida por migration posterior, senha não rotacionada) | `metricas.vw_metricas_ciclo` + `metricas.metricas_ciclo_vigente()` (SECURITY DEFINER) + role `metricas_ciclo_leitor` (`0058_vw_metricas_ciclo.sql`) | Produção Supabase Postgres 17.6, sessão UTC, migração aplicada pelo `BootMigrator` antes do `app.listen()` | O app Express NÃO é afetado (o backend não consulta a view — verificado por `grep` em `domain/http/jobs/routes/services`); a Seção 3 do report da semana sai vazia ou o cliente-leitor recebe erro; o incidente é descoberto na próxima leitura semanal | Zero impacto no MTTR do runtime; Seção 3 do report da semana ausente até intervenção manual (janela de detecção ≈ 7 dias, sem alarme) |

Cenário adicional (boot): se a `0058_vw_metricas_ciclo.sql` falhar no boot (`BootMigrator.run` lança), o servidor Express NÃO sobe e o Render mantém a versão anterior. É o desfecho projetado (`BootMigrator.ts:36-39`), mas amplifica o custo de qualquer DDL não-idempotente que 0058 introduza.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migration idempotente (2ª aplicação = no-op) | Verificado por teste de integração `it('reaplicar a migration é no-op')` (`vwMetricasCiclo.integration.test.ts:218-222`) | Sim | ✅ | `vwMetricasCiclo.integration.test.ts:218` |
| DDL sem DML no arquivo | 0 `INSERT/UPDATE/DELETE/TRUNCATE` fora de comentário | 0 | ✅ | `vwMetricasCiclo.test.ts:30` (guarda estática) |
| Statement timeout aplicado na migração (proteção contra boot pendurado) | `SET LOCAL statement_timeout = '10min'` prefixado (`runMigrations.ts:26-29`) | Presente | ✅ | `runMigrations.ts:26` (herdado do runner, cobre 0058) |
| Statement timeout do role leitor | `ALTER ROLE metricas_ciclo_leitor SET statement_timeout = '30s'` | ≤ 60s | ✅ | `0058_vw_metricas_ciclo.sql:267` |
| Transação read-only default do leitor | `default_transaction_read_only = on` | on | ✅ | `0058_vw_metricas_ciclo.sql:265` |
| Advisory-lock no boot para serializar 0058 entre instâncias | `BOOT_MIGRATION_LOCK_KEY = 314159265`; 30 tentativas × 2s = 60s teto | Presente e determinístico | ✅ | `BootMigrator.ts:12-16, 125-145` |
| SECURITY DEFINER usa `SET search_path = ''` e nomes qualificados (`pg_catalog.*`, `public.*`) | Todos os nomes qualificados; empty search_path aplicado à função vigente e à parametrizada | Sim | ✅ | `0058_vw_metricas_ciclo.sql:90, 232` |
| `%` protegido contra divisão por zero (`WHERE tentativas > 0`) — evita a linha aparecer com valor `NaN`/erro no report | Emitido só quando `tentativas > 0` | Sim | ✅ | `0058_vw_metricas_ciclo.sql:159, 188` |
| Integração da view exercitada em CI (Self-Test) | `vwMetricasCiclo.integration.test.ts` (13 casos) é excluído por `\\.integration\\.test\\.ts$` do `npm test` | Roda em CI ou em pré-merge | ❌ | `jest.config.cjs:7`; `_shared-metrics.md` linha 35 |
| Monitor/alarma sobre erro do leitor da view (`permission denied`, `undefined table`, timeout de 30s) | 0 alarmes; a produção não emite métrica sobre a saúde do leitor externo — a app não consulta a view | Ao menos um sinal automatizado | ❌ | `grep -rn 'vw_metricas_ciclo\|metricas_ciclo_leitor' domain http jobs routes services` → 0 resultados |
| Passo humano `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD ...` automatizado ou verificado | 0 automatização; instrução vive só em comentário SQL (`0058_vw_metricas_ciclo.sql:61-69`) | Runbook ou probe automatizado | ⚠️ | `0058_vw_metricas_ciclo.sql:61-69`; a integração simula o passo em teste (`vwMetricasCiclo.integration.test.ts:229-231`), produção depende de execução manual |
| Sem backfill (série começa em 2026-09-11 20:00) | `TIMESTAMP '2026-09-11 20:00:00'` fixo em `metricas_ciclo_vigente()` | Consciente | ✅ | `0058_vw_metricas_ciclo.sql:237`; ADR-0045 D4 |
| Contrato de 9 colunas em ordem fixa (contrato com `metrics.py`) | Guarda estática do `RETURNS TABLE` e da view garante ordem/nomes | Estável | ✅ | `vwMetricasCiclo.test.ts:36-61` |

> ⚠️ **Não medível localmente**: MTTR real do leitor externo em caso de falha da view. Requer instrumentação do runner `metrics.py` reportando erro/sucesso a um canal observável (Prometheus, log estruturado no repo `kavex-report-ciclo`, ou probe periódico rodado por um EventBridge/cron externo). Recomendação: adicionar heartbeat semanal que faça `SELECT count(*) FROM vw_metricas_ciclo` e emita alerta se retornar erro ou zero linhas quando `janela_fim < now() - INTERVAL '7 days'`.

> ⚠️ **Não medível localmente**: MTBF do view/função vs. eventos de schema-drift em `public.permuta_alocacao_execucao` / `public.permuta_bordero` / `public.solicitacao_numerario_execucao`. Requer histórico de migrations pós-0058 confrontado com o teste de integração — hoje ele existe (`vwMetricasCiclo.integration.test.ts` reaplica 0001..0058 e semeia os ledgers), mas não roda em CI.

## 3. Tactics — Cobertura no nf-projects

Escopo do delta: uma migration read-only (view + função DEFINER + role NOLOGIN) que serve leitor externo. Muitas tactics de recuperação/reintrodução são estruturalmente inaplicáveis (não há SPO, réplica, tráfego a redirecionar). Marcadas com N/A quando isso ocorre.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum probe agendado para `vw_metricas_ciclo`; o app não a consulta | ❌ | `grep` no backend por `vw_metricas_ciclo` retorna 0 |
| Heartbeat | Ausente para o leitor externo; migração roda no boot mas não emite sinal contínuo depois disso | ❌ | Sem probe cíclico configurado |
| Monitor | Sem alarme sobre `permission denied`/timeout do role leitor; sem métrica de duração da função vigente | ❌ | Nenhum alarme CloudWatch/Supabase referenciado no delta |
| Timestamp | Janelas `janela_inicio`/`janela_fim` timestampadas explicitamente; `criado_em AT TIME ZONE 'America/Sao_Paulo'` na atribuição de janela | ✅ | `0058_vw_metricas_ciclo.sql:93-99, 116, 141` |
| Sanity Checking | Guardas estáticas verificam contrato de 9 colunas, empty search_path, revogação de EXECUTE, ausência de referência à spine vazia | ✅ | `vwMetricasCiclo.test.ts:29-108` |
| Condition Monitoring | Ausente: nenhuma métrica lê o próprio ledger para detectar deriva (ex.: `permuta_bordero.bor_vld_finalizado = 2` explodindo) | ❌ | Não presente no delta |
| Voting | N/A — não há redundância a votar; fonte única de verdade é o ledger | N/A | Read-model determinístico sobre um único ledger |
| Exception Detection | Divisão por zero prevenida com `WHERE tentativas > 0`; sem denominador zero, sem erro no cliente | ✅ | `0058_vw_metricas_ciclo.sql:159, 188` |
| Self-Test | Integração cobre janelas, borderô desfeito, fronteira 19:59/20:00, dry-run, role leitor, idempotência da migration — mas **fora do `npm test`** (`\.integration\.test\.ts$` no `testPathIgnorePatterns`) | ⚠️ parcial | `vwMetricasCiclo.integration.test.ts`; `jest.config.cjs:7` |
| Active Redundancy | N/A — leitor externo é único; não faz sentido replicar view read-only | N/A | Read-model determinístico |
| Passive Redundancy | N/A — Postgres do Supabase já cuida de replicação de dados | N/A | Fora do escopo desta migration |
| Spare | N/A — sem processo standby para servir o report | N/A | Report é semanal, offline |
| Exception Handling | O leitor tem `default_transaction_read_only = on` + `statement_timeout = 30s`, então qualquer patologia (query pendurada, DML acidental) vira erro explícito no `metrics.py` em vez de travar o pool | ✅ | `0058_vw_metricas_ciclo.sql:265-267` |
| Rollback | Migração é idempotente (2ª aplicação é no-op, provado em integração); **não existe** `rollbacks/0058_*.rollback.sql` para desfazer a criação do schema/role — se o role for adotado por outros consumidores, remover 0058 sem rollback fica manual | ⚠️ parcial | `vwMetricasCiclo.integration.test.ts:218-222`; sem arquivo em `migrations/rollbacks/` cobrindo 0058 |
| Software Upgrade | N/A — migração DDL simples, sem versionamento in-place da view | N/A | `CREATE OR REPLACE` cobre upgrade in-place |
| Retry | `BootMigrator` já retenta advisory lock 30× (2s) para acomodar outra instância migrando | ✅ | `BootMigrator.ts:15-16, 125-145` (herdado, cobre 0058) |
| Ignore Faulty Behavior | N/A — read-model não descarta linhas por comportamento faltoso; borderô desfeito é regra de negócio, não fault-ignoring | N/A | ADR-0045 D3 |
| Degradation | O `%` some quando não há tentativa (evita "0/0" no report), o `R$` sai como `0`. É degradação intencional do payload em vez de erro | ✅ | `0058_vw_metricas_ciclo.sql:159, 188` |
| Reconfiguration | Role nasce `NOLOGIN`; passo humano `ALTER ROLE ... LOGIN PASSWORD` habilita o leitor (Reconfiguration manual, não automatizada) | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:61-69, 259-267` |
| Shadow | N/A — não há tráfego em sombra a manter atualizado | N/A | Read-model periódico |
| State Resynchronization | N/A — sem estado local do leitor; cada leitura consulta o ledger diretamente | N/A | View é derivada em tempo de leitura |
| Escalating Restart | N/A — sem processo próprio a reiniciar | N/A | Consultado por processo externo (`metrics.py`) |
| Non-Stop Forwarding | N/A — sem plano de controle/dados a separar | N/A | Uma única consulta SQL |
| Removal from Service | `NOLOGIN` no role é literalmente "fora de serviço até o operador ligar"; empty `search_path` na DEFINER remove risco de rota via schema hostil | ✅ | `0058_vw_metricas_ciclo.sql:260, 232` |
| Transactions | `BootMigrator` roda cada migration como multi-statement no simple-query protocol, envolvido em uma transação implícita (essa é a razão dos `SET LOCAL` prefixados, `runMigrations.ts:11-29`) | ✅ | `runMigrations.ts:11-29` (herdado, cobre 0058) |
| Predictive Model | N/A — não há modelo preditivo de falha aqui | N/A | Fora do escopo |
| Exception Prevention | `search_path = ''` na função DEFINER, todas as tabelas qualificadas com `public.`, todos os utilitários qualificados com `pg_catalog.` — previne injeção via search_path que rebaixaria a garantia de "sem escrita" | ✅ | `0058_vw_metricas_ciclo.sql:90, 149, 154, 178, 183, 232` |
| Increase Competence Set | Cabeçalho da migration documenta a razão do DEFINER e o passo humano de LOGIN; ADR-0045 amarra decisões D1–D4 | ✅ | `0058_vw_metricas_ciclo.sql:1-71`; `ontology/decisions/0045-*.md` |

## 4. Findings (achados)

### F-availability-1: Monitor ausente sobre a saúde da leitura de `vw_metricas_ciclo`

- **Severidade**: P2 (débito técnico defensável — o backend não depende da view, mas o report do ciclo depende, e a janela de detecção é uma semana)
- **Tactic violada**: Monitor / Heartbeat
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:60-71` (contrato de leitura documentado, sem probe); `grep -rn "vw_metricas_ciclo\|metricas_ciclo_leitor" domain http jobs routes services` = 0
- **Evidência (objetiva)**:
  ```
  $ grep -rn "vw_metricas_ciclo\|metricas_ciclo_leitor" src/backend/domain src/backend/http src/backend/jobs src/backend/routes src/backend/services
  (sem resultado)
  ```
  A app não consulta a view. O único consumidor é `kavex-report-ciclo/scripts/metrics.py`, invocado semanalmente. Se a leitura falhar (senha rotacionada, migration futura dropa coluna referenciada, DBA revoga EXECUTE), ninguém sabe até o próximo fechamento tentar renderizar a Seção 3.
- **Impacto técnico**: até 7 dias de MTTR "silencioso" para uma falha do leitor. Sintomas possíveis: `permission denied`, `relation does not exist`, `statement timeout` (30s), coluna renomeada.
- **Impacto de negócio**: a Seção 3 é a defesa da entrega Kavex→Columbia para o ciclo. Sair vazia numa reunião de fechamento sem alarme prévio queima confiança e retrabalho de última hora.
- **Métrica de baseline**: 0 probes automatizados; janela de detecção potencial = 7 dias (cadência do report).

### F-availability-2: Integração 0058 exclusa do `npm test` (Self-Test dependente de DSN manual)

- **Severidade**: P2 (o teste existe e é sólido; o problema é que não roda em pipeline automático)
- **Tactic violada**: Self-Test
- **Localização**: `src/backend/jest.config.cjs:7`; `src/backend/migrations/vwMetricasCiclo.integration.test.ts:1-22`
- **Evidência (objetiva)**:
  ```
  jest.config.cjs:7: testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$']
  vwMetricasCiclo.integration.test.ts:59: const describeComBanco = ADMIN_DSN ? describe : describe.skip;
  ```
  13 casos de integração (janelas, borderô desfeito, fronteira 19:59/20:00, role leitor, idempotência) só rodam quando alguém exporta `METRICAS_CICLO_TEST_DSN` manualmente. Uma migration futura que dropar `permuta_bordero.bor_cod_estornado` (por exemplo) passará no `npm test` e só será pega quando alguém rodar o teste de integração à mão — ou quando o report da próxima sexta quebrar.
- **Impacto técnico**: schema-drift entre 0058 e migrations posteriores pode ficar latente até o próximo fechamento (mesma janela de 7 dias do F-availability-1).
- **Impacto de negócio**: o ativo que dá Confiança no número (o teste que semeia ledger e prova soma) só é executado por quem se lembrar dele.
- **Métrica de baseline**: 0 execuções do `vwMetricasCiclo.integration` em CI; execução local depende de subir `postgres:17-alpine` manualmente conforme cabeçalho do arquivo.

### F-availability-3: Habilitação do leitor exige passo humano fora do controle do repositório

- **Severidade**: P3 (é a escolha correta em relação a segredos em migration; mas a reconfiguração é frágil e não instrumentada)
- **Tactic violada**: Reconfiguration (manual, não automatizada nem verificada)
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:60-69`
- **Evidência (objetiva)**:
  ```
  -- PASSO HUMANO, uma vez, no SQL editor do Supabase:
  --     ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD '<gerada, guardada no cofre>';
  ```
  Não há automação, checklist versionado no repositório, nem probe que valide "o role está com LOGIN e uma senha válida". Uma nova conta AWS/Supabase (novo tenant no futuro alvo) subirá com a migration aplicada e o role `NOLOGIN` — o report vai falhar até alguém lembrar do passo.
- **Impacto técnico**: pos-deploy inicial em um ambiente novo tem 100% de chance de reportar "vazio" na primeira semana até o operador humano rodar o `ALTER ROLE`.
- **Impacto de negócio**: primeira Seção 3 de um cliente novo/ambiente novo sai em branco. Recuperável em minutos, mas dependente de memória humana.
- **Métrica de baseline**: 1 passo humano exclusivo; 0 verificações automatizadas de que ele foi executado.

### F-availability-4: Ausência de arquivo de rollback para 0058 (schema, role, funções, view)

- **Severidade**: P3 (nice-to-have — não há dado a rollback, só objetos DDL a limpar; ainda assim, a convenção do repositório é ter rollback junto)
- **Tactic violada**: Rollback (preparação)
- **Localização**: `src/backend/migrations/rollbacks/` (ausente para 0058); convenção citada em `runMigrations.ts:33-45`
- **Evidência (objetiva)**:
  ```
  # o comentário do runner diz que rollbacks vivem em migrations/rollbacks/*.rollback.sql
  # 0058 não trouxe 0058_*.rollback.sql
  ```
  Reverter 0058 exige um humano digitando `DROP SCHEMA metricas CASCADE; DROP ROLE metricas_ciclo_leitor;` no SQL editor da Supabase, sob pressão, sem checklist versionado.
- **Impacto técnico**: reverter a migration num incidente exige recomposição manual do rollback; risco de deixar objetos órfãos (role sem função, função sem view etc.).
- **Impacto de negócio**: MTTR de "voltar antes de 0058" cresce em minutos se for necessário durante um incidente (cenário improvável, mas o custo de preparar o script agora é ~15 min).
- **Métrica de baseline**: 0 scripts em `migrations/rollbacks/` cobrindo 0058; convenção documentada em `runMigrations.ts:33-45`.

## 5. Cards Kanban

### [availability-1] Adicionar heartbeat semanal automatizado sobre `vw_metricas_ciclo`

- **Problema**
  > O único consumidor da view é o `metrics.py` rodado semanalmente pela Kavex. Se a leitura falhar (senha rotacionada, revogação de EXECUTE, migration futura dropa coluna, timeout de 30s do role), a Seção 3 sai vazia sem alarme e a janela de detecção é a cadência do próprio report (~7 dias). O backend não consulta a view (`grep` retorna 0 hits em `domain/http/jobs/routes/services`), então nenhuma métrica do runtime detecta a falha.

- **Melhoria Proposta**
  > Adicionar um job periódico (candidatos: um `EventBridge`+Lambda leve **(alvo)** ou, hoje, um cron no runner que já roda `metrics.py`) que faça `SELECT count(*) FROM vw_metricas_ciclo` como o role `metricas_ciclo_leitor` e emita alerta (canal do time) quando (a) a query lança erro, (b) devolve 0 linhas apesar de já haver janela fechada disponível, ou (c) demora > 30s. Tactic: **Monitor / Heartbeat**. Documentar o probe no cabeçalho da 0058.

- **Resultado Esperado**
  > Janela de detecção da falha do leitor cai de ~7 dias para ≤ 24h; próximo fechamento nunca é surpreendido por Seção 3 vazia sem aviso prévio.

- **Tactic alvo**: Monitor / Heartbeat
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1, F-availability-3
- **Métricas de sucesso**:
  - Probes automatizados executados por semana: 0 → ≥ 7
  - MTTR observado da falha do leitor: ~7 dias → ≤ 24h
- **Risco de não fazer**: uma migration futura que altere `permuta_alocacao_execucao` ou `permuta_bordero` derruba silenciosamente a Seção 3 na próxima sexta-feira, em reunião de fechamento com o cliente.
- **Dependências**: nenhuma

### [availability-2] Rodar `vwMetricasCiclo.integration.test.ts` em CI

- **Problema**
  > `jest.config.cjs:7` exclui `\.integration\.test\.ts$` do `npm test`, e o `vwMetricasCiclo.integration.test.ts` (13 casos, prova comportamento contra Postgres 17-alpine descartável) só roda se alguém exportar `METRICAS_CICLO_TEST_DSN` à mão. O contrato de 9 colunas com o `metrics.py`, a fronteira de janela sexta 19:59/20:00, o filtro de borderô desfeito e o alcance do role leitor não são reexecutados em nenhum PR posterior a 0058 — schema-drift fica latente até a próxima sexta-feira.

- **Melhoria Proposta**
  > Adicionar um step no CI (GitHub Actions) que sobe `postgres:17-alpine` como service container e roda `npx jest --testPathPattern integration --testPathIgnorePatterns '/node_modules/'`. Tactic: **Self-Test**. Alternativa mais conservadora: um script npm `test:integration` disparado por dispatch, mas ainda automatizado, com resultado postado no PR.

- **Resultado Esperado**
  > Toda mudança em `migrations/`, `permuta_alocacao_execucao`, `permuta_bordero` ou `solicitacao_numerario_execucao` passa por reexecução da 0058 contra os dois ledgers com sementes conhecidas.

- **Tactic alvo**: Self-Test
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para o setup inicial no CI
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Execuções por PR do `vwMetricasCiclo.integration`: 0 → 1 (em toda PR que toca `migrations/` ou os três ledgers)
  - Tempo entre schema-drift e detecção: ~7 dias → minutos
- **Risco de não fazer**: uma coluna renomeada em `permuta_bordero` passa no `npm test` (134 suites, 1898 testes verdes segundo `_shared-metrics.md`) e derruba a Seção 3 sem que ninguém veja o gate falhar.
- **Dependências**: infra de service-container no CI (baixo, o job já pode reaproveitar `docker` do runner GitHub-hosted)

### [availability-3] Automatizar (ou pelo menos verificar) o passo humano `ALTER ROLE ... LOGIN PASSWORD`

- **Problema**
  > O cabeçalho da 0058 diz que a migration cria `metricas_ciclo_leitor` como `NOLOGIN` porque senha não entra em migration, e delega a habilitação para um passo humano no SQL editor da Supabase (`0058_vw_metricas_ciclo.sql:60-69`). É a escolha correta em relação a segredos, mas hoje não existe checklist versionado, probe de verificação, nem provisionamento por Terraform/SSM — em qualquer novo tenant/ambiente futuro (o alvo multi-tenant do CLAUDE.md), o role vai nascer `NOLOGIN` e o report vai falhar até alguém lembrar.

- **Melhoria Proposta**
  > Duas opções, escolher uma:
  > 1. **Runbook versionado**: adicionar um arquivo `docs/runbooks/metricas-ciclo-leitor.md` com o passo humano, e adicionar ao probe do card availability-1 uma verificação inicial "o role tem LOGIN?" que falha ruidosamente na primeira execução após deploy.
  > 2. **Provisionamento pelo cofre**: quando o alvo Terraform + SSM existir, gerar senha via `random_password` e aplicar `ALTER ROLE ... LOGIN PASSWORD` via `null_resource` com `local-exec psql`. Tactic: **Reconfiguration** (automatizada).

- **Resultado Esperado**
  > Habilitar o leitor num ambiente novo deixa de depender de memória humana — ou o probe pega e alarma, ou o Terraform aplica.

- **Tactic alvo**: Reconfiguration
- **Severidade**: P3
- **Esforço estimado**: S (opção 1, ≤1d) / M (opção 2, 2–5d, e depende do alvo Terraform)
- **Findings relacionados**: F-availability-3, F-availability-1
- **Métricas de sucesso**:
  - Passos humanos não versionados na provisão do leitor: 1 → 0 (opção 2) ou 1 documentado + probado (opção 1)
  - Tempo médio para detectar `NOLOGIN` num tenant novo: ~7 dias → minutos
- **Risco de não fazer**: o primeiro fechamento de um cliente novo (ou de um clone de ambiente) sai com Seção 3 vazia; recuperável em minutos, mas repetível a cada novo ambiente.
- **Dependências**: para a opção 2, depende do alvo Terraform/SSM (não existe hoje segundo `_shared-metrics.md`).

### [availability-4] Criar `0058_*.rollback.sql` conforme convenção do runner

- **Problema**
  > A 0058 introduz schema `metricas`, duas funções, uma view e um role, todos idempotentes na aplicação (`vwMetricasCiclo.integration.test.ts:218-222`), mas não vem acompanhada de arquivo em `migrations/rollbacks/` — convenção citada em `runMigrations.ts:33-45`. Reverter 0058 num incidente exige compor o SQL de reversão à mão, sob pressão.

- **Melhoria Proposta**
  > Adicionar `src/backend/migrations/rollbacks/0058_vw_metricas_ciclo.rollback.sql` com `DROP VIEW metricas.vw_metricas_ciclo`, `DROP FUNCTION metricas.metricas_ciclo_vigente()`, `DROP FUNCTION metricas.metricas_ciclo(timestamp,timestamp)`, `DROP ROLE metricas_ciclo_leitor` e `DROP SCHEMA metricas`, com comentário de cabeçalho explicando por que ele não é aplicado automaticamente. Tactic: **Rollback** (preparação).

- **Resultado Esperado**
  > Reverter 0058 em incidente vira `psql -f rollbacks/0058_*.rollback.sql` versionado — sem risco de esquecer o role.

- **Tactic alvo**: Rollback
- **Severidade**: P3
- **Esforço estimado**: S (≤1d, arquivo curto)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Migrations com rollback correspondente: N-1/N → N/N para 0058
  - Tempo para reverter 0058 em incidente: minutos (compor SQL) → segundos (executar arquivo versionado)
- **Risco de não fazer**: se por qualquer razão for necessário reverter 0058 (bug no contrato, mudança na proposta comercial da Seção 3), o operador improvisa DDL de reversão sem revisão.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo real deste QA: o delta é uma migration read-only cujo único consumidor é externo ao backend. Isso deslocou a análise do runtime do app para a cadeia de detecção do report; nenhum finding aqui degrada disponibilidade do usuário final da aplicação.
- Tactics de Reintroduction e boa parte de Prevention são estruturalmente N/A neste delta — declarei explicitamente em vez de omitir, para que o `qa-consolidator` não conte gap onde não há.
- Cross-QA (alertar consolidator):
  - **Testability** herda availability-2 (o mesmo integration test excluído do `npm test` é também um gap de coverage automatizado).
  - **Security** herda availability-3 (o passo humano do LOGIN é justamente a fronteira do modelo de segredos — score positivo do meu lado, mas cross-cutting).
  - **Observability/Monitoring** (se o agente pré-configurado do pipeline for consultado) herda availability-1 inteiramente.
- Métrica que tentei coletar e falhei: MTTR real do leitor externo — depende de histórico de execuções do `metrics.py` (repositório `kavex-report-ciclo`), fora deste worktree. Declarado como não-medível.
