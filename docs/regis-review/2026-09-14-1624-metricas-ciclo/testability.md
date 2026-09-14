---
qa: Testability
qa_slug: testability
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-testability
generated_at: 2026-09-14T17:15:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor da Kavex | PR que altera `0058_vw_metricas_ciclo.sql` (ex.: mexe em janela, borderô desfeito, filtro `dry_run` ou GRANT do leitor) | Migration SQL + função `metricas.metricas_ciclo` + view `vw_metricas_ciclo` + role `metricas_ciclo_leitor` | CI (GitHub Actions `ci.yml`, jobs `backend`/`frontend`) rodando `npm test -- --coverage` na PR contra `main` | CI executa **todas** as garantias comportamentais da migration (janela fechada, exclusão de borderô desfeito, R$ com `parcial`, fronteira 19:59/20:00, `dry_run` ignorado, alcance do role, DEFINER trick) e falha o merge se qualquer uma quebrar | 13 asserts de comportamento executados automaticamente por PR (hoje: 0/13); tempo até detectar regressão semântica < 5 min após push (hoje: só na sexta 20:00, no ciclo seguinte, com metrics.py em produção). |

Cenário concreto que a suíte precisa defender: o autor da PR troca `AND NOT e.desfeita` por `AND e.desfeita = false` (correto em SQL padrão, quebrado em Postgres quando o LEFT JOIN produz NULL). O `npm test` do CI passa — os 9 estáticos só checam a *forma* — e a Seção 3 do report da Columbia começa a mostrar `permutas_baixas_concluidas_pct = 100.0%` (0 concluídas / 0 tentativas visíveis) no ciclo seguinte.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura comportamental do delta rodada em CI (asserts executados / asserts existentes) | **0 / 13 (0%)** — `vwMetricasCiclo.integration.test.ts` casa `\\.integration\\.test\\.ts$` no `testPathIgnorePatterns` do `jest.config.cjs`, e `.github/workflows/ci.yml` só roda `npm test -- --coverage` (sem serviço Postgres) | 13 / 13 (100%) | ❌ | `src/backend/jest.config.cjs:7`; `.github/workflows/ci.yml:27` |
| Asserts estáticos (contrato, GRANTs, DEFINER) rodados em CI | 9 / 9 (100%) | 9 / 9 | ✅ | `src/backend/migrations/vwMetricasCiclo.test.ts` (rodou verde no `npm test` do ciclo, per `_shared-metrics.md` linha 38) |
| LOC de SQL de negócio no delta cobertos por asserção comportamental executada no CI | **0 / 271** (a lógica de agregação vive na função `metricas_ciclo`, e o teste que a exercita não roda) | ≥ 240 / 271 (≥ 88%, mesmo piso de `domain/service/` no `coverageThreshold`) | ❌ | `src/backend/migrations/0058_vw_metricas_ciclo.sql` (271 linhas); `jest.config.cjs:39-48` |
| Determinismo — "agora" injetável no cálculo | ✅ presente: `metricas.metricas_ciclo(p_serie_inicio, p_agora)` recebe `p_agora` explícito; testes usam `AGORA = '2026-09-26 10:00:00'` | mantido | ✅ | `0058_vw_metricas_ciclo.sql:76`; `vwMetricasCiclo.integration.test.ts:28,128` |
| Determinismo — caminho da view (`metricas_ciclo_vigente()` → `now()`) exercitado com "agora" controlado | 0 testes — a única asserção sobre a vigente é a tautologia `vw = metricas_ciclo(SERIE, now() AT TIME ZONE …)`, que replica a definição da própria função | ≥ 1 teste com `now()` fixado (ex.: `SET LOCAL TimeZone` + `pg_catalog.now()` mockado por wrapper, ou rebind da função para testes) | ⚠️ | `vwMetricasCiclo.integration.test.ts:208-216` |
| Guardas do role `metricas_ciclo_leitor` exercitadas em runtime | 3 de 5 (SELECT na view ✅; SELECT nas tabelas de origem ❌; CREATE TABLE ❌). **Não exercitadas**: `default_transaction_read_only` isolado (o CREATE TABLE prova mais permission do que read-only), `statement_timeout = 30s`, `search_path = metricas` isolado do GRANT | 5 / 5 (com um caso por `ALTER ROLE ... SET`) | ⚠️ | `vwMetricasCiclo.integration.test.ts:248-275` |
| Sandbox reprodutível (docker-compose de teste, script `test:integration`) | Ausente — instruções vivem no comment do `beforeAll` (`docker run -d --rm ... postgres:17-alpine`); nenhum `package.json` script; 15 arquivos `*.integration.test.ts` no backend sem orquestrador único | 1 comando por dev machine (`npm run test:integration` sobe Postgres, roda, derruba) | ❌ | `vwMetricasCiclo.integration.test.ts:14-17`; `find ../.. -name docker-compose* = ∅` |
| Coverage gate CI — piso para migrations SQL | ⚠️ Não aplicável: `coverageThreshold` do jest mede linhas TS transformadas pelo ts-jest; SQL fica fora. Não há gate equivalente para migrations | Gate por presença de teste de integração para toda migration nova que crie função/view (script no `postmigrate`) | ⚠️ | `jest.config.cjs:39-69` |
| Guarda estática — DML fora de comentário | ✅ regex casa `INSERT INTO`, `UPDATE ... SET`, `DELETE FROM`, `TRUNCATE` após stripar `--...$` por linha | manter, mas é frágil: `SQL.replace(/--.*$/gm, '')` não trata `/* ... */`, e a asserção depende de o autor não usar bloco `/* */` — hoje a migration não usa | ⚠️ | `vwMetricasCiclo.test.ts:15,31-34` |
| Não-determinismo residual (source-side `Date.now()` / `Math.random()` no delta) | 0 no delta — a não-determinismo do `now()` fica no SQL, atrás da barreira `p_agora` | 0 | ✅ | delta = 2 arquivos SQL/TS mais 1 arquivo de teste estático — nenhum consome `Date`/`Math.random` |

> ⚠️ **Não medível localmente**: cobertura por linhas SQL executadas (Postgres não emite coverage tipo TypeScript). Proxy usado: contagem de asserts comportamentais executados sobre a função `metricas_ciclo` vs. asserts existentes.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `metricas.metricas_ciclo(p_serie_inicio, p_agora)` é uma interface especializada de teste — a mesma função que o produto usa (via `metricas_ciclo_vigente()`) recebe parâmetros que a produção não passa. Injectable clock por assinatura. | ✅ presente | `0058_vw_metricas_ciclo.sql:76` |
| Recordable Test Cases | Fixture inline no `beforeAll` do integration: 11 linhas de `permuta_alocacao_execucao` + 3 de `solicitacao_numerario_execucao`, cada uma com nome semântico (`p-cancelado`, `p-parcial`, `p-utc-na-A`, `p-fim-A`). É uma "sessão gravada" reproduzível. | ✅ presente (mas não rodada em CI) | `vwMetricasCiclo.integration.test.ts:93-127` |
| Sandbox | Postgres 17-alpine descartável, banco `metricas_ciclo_it` criado/derrubado com `WITH (FORCE)`; guarda que recusa host não-local. | ⚠️ parcial — existe, mas exige `docker run` manual do dev; sem `docker-compose.test.yml`, sem script npm, sem serviço no `ci.yml` | `vwMetricasCiclo.integration.test.ts:68-90` |
| Executable Assertions | 13 asserts sobre janela, exclusão, R$, fronteira de fuso, GRANTs, DEFINER trick, idempotência da migration. A qualidade das asserções é alta (nível de fixture nomeada) — mas o `npm test` do CI não as executa. | ⚠️ parcial — presentes, dormentes | `vwMetricasCiclo.integration.test.ts:135-275`; `jest.config.cjs:7`; `.github/workflows/ci.yml:27` |
| Abstract Data Sources | A view abstrai `permuta_alocacao_execucao`, `permuta_bordero`, `solicitacao_numerario_execucao` atrás de 9 colunas de contrato (`frente`, `metrica`, ...). O consumidor (`metrics.py`) lê pela forma, não pela origem. | ✅ presente | `0058_vw_metricas_ciclo.sql:244-255`; `vwMetricasCiclo.test.ts:17-27` |
| Limit Structural Complexity | Função pura (SQL `STABLE`, `SET search_path = ''`), sem dependência de sessão. A view é uma linha (`SELECT ... FROM metricas_ciclo_vigente()`). Fácil de testar unidade a unidade. | ✅ presente | `0058_vw_metricas_ciclo.sql:88-90,244-255` |
| Limit Non-Determinism | O único `now()` fica dentro de `metricas_ciclo_vigente()`, isolado por uma interface parametrizada. Mas o caminho da vigente só é testado por tautologia (`vw = função(SERIE, now())`), não com `now()` controlado. | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:237-238`; `vwMetricasCiclo.integration.test.ts:208-216` |

## 4. Findings (achados)

### F-testability-1: A suíte que prova o comportamento da migration não roda em CI

- **Severidade**: P0
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jest.config.cjs:7`; `.github/workflows/ci.yml:10-28`; `src/backend/migrations/vwMetricasCiclo.integration.test.ts`
- **Evidência (objetiva)**:
  ```
  # jest.config.cjs
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
  # ci.yml (job "backend")
  - run: npm test -- --coverage
  # Não há service `postgres`, não há `METRICAS_CICLO_TEST_DSN`, não há job de integração.
  # grep -rn "integration.test\|METRICAS_CICLO_TEST_DSN" .github/workflows/ → ∅
  ```
- **Impacto técnico**: as 13 asserções comportamentais (janela fechada, borderô desfeito, `parcial` no R$, fronteira 19:59/20:00 em SP, `dry_run` ignorado, alcance do role, DEFINER que ignora RLS do consumidor) ficam dormentes. Qualquer refactor do SQL — trocar `AND NOT e.desfeita` por `AND e.desfeita = false` (semântica diferente com LEFT JOIN nulável), inverter a fronteira `< janela_fim` para `<=` (a mutação testada no `_shared-metrics.md` derrubou 2 asserções, mas só se você lembrar de rodar `docker run` na mão) — passa no `npm test` do CI porque só sobram os 9 asserts estáticos de forma.
- **Impacto de negócio**: a Seção 3 do report semanal da Columbia lê `vw_metricas_ciclo`. Uma regressão vai aparecer no `metrics.py` na sexta 20:00 seguinte à PR — número enviado ao cliente antes de qualquer humano notar. E como a chave da métrica é estável por decisão de contrato (I-M6, ADR-0045), a anotação de quebra vira dívida no report.
- **Métrica de baseline**: 13 asserts de integração / 0 executados por PR = **0% de cobertura comportamental automática**. Custo de escapar da regressão: 0 min de CI local (impossível hoje) vs. até 7 dias humanos (próximo ciclo).

### F-testability-2: O caminho `metricas_ciclo_vigente()` só é testado por tautologia

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/migrations/vwMetricasCiclo.integration.test.ts:208-216`
- **Evidência (objetiva)**:
  ```typescript
  const view = await admin.query('SELECT * FROM metricas.vw_metricas_ciclo ORDER BY 1, 2, 6');
  const funcao = await admin.query(
      `SELECT * FROM metricas.metricas_ciclo(TIMESTAMP '${SERIE}', (now() AT TIME ZONE 'America/Sao_Paulo'))
       ORDER BY 1, 2, 6`,
  );
  expect(view.rows).toEqual(funcao.rows);
  ```
- **Impacto técnico**: o teste prova apenas que `vw` chama `metricas_ciclo_vigente()` que chama `metricas_ciclo(SERIE, now() AT TIME ZONE 'America/Sao_Paulo')` — ou seja, replica a definição literal da função `vigente`. Se alguém trocar o `TIMESTAMP '2026-09-11 20:00:00'` da vigente (D4 do ADR: sem backfill) por outra data, ou trocar `America/Sao_Paulo` por `UTC` (I-M4), a tautologia continua verde. Não há teste que fixe `now()` para provar que a vigente retorna o subconjunto correto de janelas fechadas em um instante conhecido diferente do `now()` real do teste.
- **Impacto de negócio**: I-M2 (sem backfill) e I-M4 (`timestamp` sem fuso) são invariantes explícitos do ADR-0045. Ficariam sem defesa executável.
- **Métrica de baseline**: 1 teste toca a `vigente`; 0 testes fixam `now()` para exercitar a vigente com "agora" controlado.

### F-testability-3: `statement_timeout = 30s` do role leitor é asserido só por regex sobre o texto da migration

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/migrations/vwMetricasCiclo.test.ts` (ausência); `src/backend/migrations/vwMetricasCiclo.integration.test.ts:248-275` (não cobre o timeout)
- **Evidência (objetiva)**:
  ```
  # grep -n "statement_timeout" migrations/vwMetricasCiclo*.test.ts → ∅
  # A migration declara:
  ALTER ROLE metricas_ciclo_leitor SET statement_timeout = '30s';
  # Nenhum teste comporta-mental: nenhum `SELECT pg_sleep(31)` como leitor.
  ```
- **Impacto técnico**: se um refactor derrubar o `ALTER ROLE ... SET statement_timeout`, o role perde o teto de execução. Uma query cara emitida por engano do lado do `metrics.py` (ou uma junção mal-pensada num futuro rótulo) segura conexão do pool por minutos, sem sinal de erro no CI. A validação hoje é regex `\bALTER ROLE .* SET statement_timeout = '30s'` — cobre renomeação, não cobre remoção acidental do `ALTER ROLE` (a regex teria de estar em positive-match, e está: uma remoção falharia — verificado no `vwMetricasCiclo.test.ts:83-99`). **Ajustado**: a regex existe e falha se removida. Mas: se o valor mudar para `300s` ou o `SET` for aplicado no schema errado, a asserção estática também falha. Ainda assim, a asserção **comportamental** (o timeout realmente aplica na sessão do leitor) não existe.
- **Impacto de negócio**: baixo isoladamente; multiplicador de risco alto se combinado com F-1 (nenhuma asserção de comportamento roda em CI de qualquer forma).
- **Métrica de baseline**: 1 assert estático sobre a string do `ALTER ROLE`; 0 asserts que provam o timeout na sessão do leitor.

### F-testability-4: Guarda estática confia em stripping ingênuo de comentários

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/migrations/vwMetricasCiclo.test.ts:14-15`
- **Evidência (objetiva)**:
  ```typescript
  const MIGRATION = readFileSync(path.join(__dirname, '0058_vw_metricas_ciclo.sql'), 'utf8');
  const SQL = MIGRATION.replace(/--.*$/gm, '');
  ```
- **Impacto técnico**: `replace(/--.*$/gm, '')` não trata bloco `/* ... */`, e trata `--` dentro de string SQL (`E'-- fake'`) como início de comentário. Hoje a migration não usa nem `/* */` nem strings com `--`, então o teste passa por convenção. Um futuro `EXECUTE format('CREATE ROLE %I -- comentário inline', 'x')` (hipotético) confundiria a análise. Consequência real hoje: nenhuma; consequência futura: falso-positivo silencioso.
- **Impacto de negócio**: nenhum na baseline. Risco de regressão silenciosa em migrations futuras que sigam este mesmo padrão.
- **Métrica de baseline**: 1 regex de stripping cobre 100% dos comentários da migration atual (que só usa `-- linha`); cobre 0% de `/* ... */`.

### F-testability-5: Sandbox descartável existe mas não é orquestrado

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/migrations/vwMetricasCiclo.integration.test.ts:14-17`; `src/backend/package.json` (ausência de script); `.github/workflows/ci.yml` (ausência de service)
- **Evidência (objetiva)**:
  ```
  # Instruções vivem no comment do arquivo de teste:
  #   docker run -d --rm --name metricas-ciclo-pg-test -e POSTGRES_PASSWORD=test \
  #     -p 55432:5432 postgres:17-alpine
  #   METRICAS_CICLO_TEST_DSN=... npx jest vwMetricasCiclo.integration --testPathIgnorePatterns "/node_modules/"
  # grep -l "docker-compose" ../.. → ∅
  # grep "test:integration\|test:it" src/backend/package.json → ∅
  ```
- **Impacto técnico**: cada dev precisa lembrar do comando, da porta 55432, do `--testPathIgnorePatterns` para desligar o próprio `testPathIgnorePatterns` do config. Custo por rodada humano-em-loop, e com 15 arquivos `*.integration.test.ts` no backend, a fricção multiplica.
- **Impacto de negócio**: fricção operacional; risco indireto de que a suíte deixe de ser rodada antes de PR.
- **Métrica de baseline**: 15 arquivos `*.integration.test.ts` no backend; 0 orquestrados por `docker-compose` ou script npm; 0 jobs de CI executando qualquer um.

## 5. Cards Kanban

### [testability-1] Ativar `vwMetricasCiclo.integration.test.ts` no CI (Postgres service no `ci.yml`)

- **Problema**
  > 13 asserções comportamentais da migration `0058_vw_metricas_ciclo.sql` (janela fechada, borderô desfeito, R$ com `parcial`, fronteira 19:59/20:00 em SP, `dry_run`, alcance do role, DEFINER trick) existem em `vwMetricasCiclo.integration.test.ts` mas o `jest.config.cjs:7` casa `\\.integration\\.test\\.ts$` no `testPathIgnorePatterns`, e o `ci.yml` só roda `npm test -- --coverage`. Uma regressão semântica (`AND NOT e.desfeita` → `AND e.desfeita = false`, ou `< janela_fim` → `<=`) passa no CI e chega ao report da Columbia na sexta seguinte.

- **Melhoria Proposta**
  > Adicionar um serviço `postgres:17-alpine` ao job `backend` do `.github/workflows/ci.yml`, exportar `METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:5432/postgres` e um step `npm run test:integration` que chame `jest --testPathIgnorePatterns "/node_modules/" --testMatch "**/*.integration.test.ts"`. Tactic Bass alvo: **Executable Assertions** (rodar as asserções que já existem). O gate compõe com `testability-5` (script único).

- **Resultado Esperado**
  > Toda PR que toca `src/backend/migrations/*.sql` ou `src/backend/migrations/*.integration.test.ts` roda os 13 asserts em CI (< 3 min extra por job). A mutação `< janela_fim` → `<=` documentada no `_shared-metrics.md` derruba o CI em vez de precisar de docker manual.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P0
- **Esforço estimado**: S (≤ 1 dia — service de banco + step, alinhar com os outros 14 arquivos `*.integration.test.ts`)
- **Findings relacionados**: F-testability-1, F-testability-5
- **Métricas de sucesso**:
  - Asserts comportamentais executados por PR (delta): 0/13 → 13/13
  - Cobertura comportamental do SQL (proxy): 0/271 linhas → 271/271 linhas de negócio da função `metricas_ciclo` exercitadas ≥ 1 vez por PR
  - Tempo até detectar regressão semântica: 7 dias (ciclo + report em produção) → < 5 min (CI)
- **Risco de não fazer**: em 6 meses de PRs que mexam em janela/fuso/borderô (o cabeçalho da migration prevê isso: "chave nova quando definição muda"), pelo menos uma passa pelo CI e chega ao report. Anotação de quebra no report vira dívida sistêmica.
- **Dependências**: nenhuma técnica; se combinado com **testability-5**, sobe também o restante dos 15 `*.integration.test.ts` do backend.

### [testability-2] Testar `metricas_ciclo_vigente()` com "agora" controlado (não tautologia)

- **Problema**
  > O único teste que exercita `metricas.metricas_ciclo_vigente()` é `expect(view.rows).toEqual(funcao.rows)` com a função chamada exatamente como a `vigente` a chama internamente (`TIMESTAMP '2026-09-11 20:00:00'`, `now() AT TIME ZONE 'America/Sao_Paulo'`). É a definição literal — troca do timestamp da série (D4 do ADR-0045) ou do fuso (I-M4) passa verde.

- **Melhoria Proposta**
  > Adicionar caso que, dentro do `beforeAll`, semeie uma linha em janela "hoje" (via `now()` mockado por wrapper ou por fixação de `pg_catalog.now` com `CREATE OR REPLACE FUNCTION` na sessão de teste — a segunda é a via mais barata em Postgres) e prove que `vw_metricas_ciclo` NÃO emite essa janela por I-M3 ("só janela fechada"). Tactic Bass alvo: **Limit Non-Determinism**.

- **Resultado Esperado**
  > 1 teste adicional em `vwMetricasCiclo.integration.test.ts` cobrindo o caminho `vigente` com "agora" fixo e distinto do `now()` do runner. Regressão de fuso ou de série é derrubada em CI sem depender de janela real.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes que exercitam `metricas_ciclo_vigente()` com "agora" controlado: 0 → ≥ 1
  - Invariantes ADR-0045 cobertos por asserção comportamental: I-M2 (via F-1 se ativado) ✓ · I-M3 no caminho `vigente` 0 → 1 · I-M4 no caminho `vigente` 0 → 1
- **Risco de não fazer**: um refactor bem-intencionado da vigente (ex.: normalizar para `AT TIME ZONE 'UTC'` seguindo o resto do repo) desloca janelas por 3h sem CI reclamar.
- **Dependências**: `testability-1` (senão o teste segue dormente).

### [testability-3] Provar `statement_timeout = 30s` do role leitor comportamentalmente

- **Problema**
  > O teto de 30s do `metricas_ciclo_leitor` é um guard-rail de disponibilidade do banco: se cair, uma junção mal-formada no futuro segura conexão do pool sem sinal. A defesa hoje é uma regex que pega renomeação, mas não prova que o `ALTER ROLE ... SET statement_timeout` está de fato aplicando na sessão de login do leitor (o role recebe `ALTER ROLE ... SET`, que só vale em sessões que fazem `LOGIN` **como** o role, não como membro).

- **Melhoria Proposta**
  > Adicionar 1 caso no bloco `describe('como o role leitor')`: `await expect(leitor.query("SELECT pg_sleep(31)")).rejects.toThrow(/canceling statement due to statement timeout/)`. Tactic Bass alvo: **Executable Assertions**.

- **Resultado Esperado**
  > 1 asserção comportamental sobre `statement_timeout` do leitor. Cross-QA: também é asserção de **Fault Tolerance** (Limit Consequences of Failure via timeout) e de **Security** (não deixa role público segurar conexão).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 dia — ~5 linhas)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Asserts comportamentais sobre `ALTER ROLE ... SET` do leitor: 3/5 → 5/5 (statement_timeout + verificação de que `default_transaction_read_only` bloqueia `INSERT`/`UPDATE`, não só `CREATE TABLE`)
- **Risco de não fazer**: um `ALTER ROLE` derivado (ex.: alguém troca por `ALTER USER metricas_ciclo_leitor ...` que não aceita `SET`) passa em regex e o teto vaza. Baixa probabilidade, dano concreto.
- **Dependências**: `testability-1`.

### [testability-5] Orquestrar a sandbox de integração: `npm run test:integration` + `docker-compose.test.yml`

- **Problema**
  > Cada dev que quer rodar `vwMetricasCiclo.integration.test.ts` copia o `docker run` do comment, lembra da porta 55432 e reescreve o `--testPathIgnorePatterns` para inverter o padrão do `jest.config.cjs`. 15 arquivos `*.integration.test.ts` no backend, 0 orquestradores. Fricção que empurra o dev a não rodar antes de PR — e sem `testability-1`, nada roda depois.

- **Melhoria Proposta**
  > Criar `src/backend/docker-compose.test.yml` com um serviço `postgres:17-alpine` e um script `"test:integration": "docker compose -f docker-compose.test.yml up -d && METRICAS_CICLO_TEST_DSN=... jest --testPathIgnorePatterns '/node_modules/' --testMatch '**/*.integration.test.ts'; docker compose -f docker-compose.test.yml down -v"`. Reaproveitar no `ci.yml` (dep de **testability-1**). Tactic Bass alvo: **Sandbox**.

- **Resultado Esperado**
  > `npm run test:integration` roda os 15 arquivos de integração do backend numa Postgres descartável em < 5 min, sem passos humanos. Serve como base do job de CI de **testability-1**.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2–3 dias — compor com os outros 14 arquivos, alguns podem exigir Redis/S3 mock)
- **Findings relacionados**: F-testability-5, F-testability-1
- **Métricas de sucesso**:
  - Passos humanos para rodar a suíte de integração: 3 (docker run + export DSN + `--testPathIgnorePatterns`) → 1 (`npm run test:integration`)
  - Arquivos `*.integration.test.ts` orquestrados: 0/15 → 15/15
- **Risco de não fazer**: dívida de sandbox escala com número de features (cada nova migration com view/função vem com seu próprio integration test, sem lar).
- **Dependências**: nenhuma; habilitador de `testability-1`.

## 6. Notas do agente

- Escopo restrito ao delta `14ca71a..HEAD`. F-testability-4 (regex ingênuo de stripping) é sobre o arquivo do delta mas fica em P3 porque a migration atual não usa `/* */` nem strings com `--`; virou observação, não card — se todo teste estático de migration futura seguir esse padrão, revisitar.
- Cross-QA:
  - **Deployability**: `testability-1` é também um gate de deploy — a migration é aplicada no boot pelo BootMigrator; regressão comportamental sem CI vira `0057` funcional em produção quando `0058` já derruba a Seção 3 do report.
  - **Fault Tolerance / Security**: `testability-3` (statement_timeout comportamental) é asserção compartilhada com FT e Security. Consolidar sob um mesmo caso é OK.
  - **Modifiability**: `metricas_ciclo(p_serie_inicio, p_agora)` como injectable clock é o exemplo de Limit Non-Determinism no delta — reforçar como padrão a repetir em novas views.
- Métrica que tentei coletar e não consegui: cobertura por linhas SQL executadas (Postgres não emite coverage no formato do jest). Usei o proxy "asserts comportamentais executados vs. existentes".
- O `_shared-metrics.md` já registra que a mutação `< janela_fim` → `<=` derrubou 2 asserções — evidência viva do valor da suíte de integração; F-1 é sobre torná-la executável no CI, não sobre escrevê-la (já está).
