---
qa: Security
qa_slug: security
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-security
generated_at: 2026-09-14T16:24:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 5
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Runner externo `kavex-report-ciclo` (fora deste repo) conectado com `DSN_FINANCEIRO` como `metricas_ciclo_leitor`, ou um atacante que vaze essa DSN | Consulta `SELECT * FROM vw_metricas_ciclo` (uso normal) ou tenta escalada: `SELECT ... FROM public.permuta_alocacao_execucao` / `metricas.metricas_ciclo('2026-01-01', now())` / DML no schema `metricas` | Migration `0058_vw_metricas_ciclo.sql` — schema `metricas`, funções `metricas_ciclo` (INVOKER) + `metricas_ciclo_vigente` (DEFINER, `search_path = ''`), view `vw_metricas_ciclo`, role `metricas_ciclo_leitor` | Supabase Postgres 17 em produção, sessão UTC, PostgREST expondo `public` a `anon`/`authenticated` | Só o SELECT à view (agregados) responde; qualquer tentativa fora disso falha com `permission denied` ou `read-only transaction`; a série do ciclo 6 é imutável pelo leitor; nenhum campo PII (`erp_response`, `request_payload`, e-mail) alcança o consumidor | 0 tabelas de origem legíveis pelo leitor (provado no `describe('como o role leitor')`); 0 janelas fora de `[2026-09-11 20:00, agora)` retornáveis pelo leitor; `statement_timeout = 30s`; 0 rotas PostgREST expondo `metricas` |

## 2. Métricas observadas

Escopo: delta `14ca71a..HEAD` — 1 migration SQL, 2 arquivos de teste, sem código TypeScript novo, 0 dependências novas.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git diff 14ca71a..HEAD -- src/backend` — `PASSWORD` só como string `'leitor-teste'` de teste, gate `expect(SQL).not.toMatch(/PASSWORD/i)` em `vwMetricasCiclo.test.ts:98` |
| `.env` / dumps de estado no delta | 0 | 0 | ✅ | `git diff --name-only 14ca71a..HEAD` |
| GRANTs no delta | 3 (`USAGE`, `EXECUTE`, `SELECT`) | mínimo | ✅ | `0058_vw_metricas_ciclo.sql:269-271` |
| REVOKEs no delta (schema + 2 funções) | 3 | ≥1 REVOKE PUBLIC por função DEFINER | ✅ | `0058_vw_metricas_ciclo.sql:74, 215, 242` |
| Funções `SECURITY DEFINER` | 1 (`metricas_ciclo_vigente`) | Somente as que precisam | ✅ | `0058_vw_metricas_ciclo.sql:231` |
| Funções DEFINER com `SET search_path = ''` e chamadas qualificadas | 1/1 (100%) | 100% | ✅ | `0058_vw_metricas_ciclo.sql:232-240` — todas as refs usam `pg_catalog.*` / `metricas.*` / `public.*` |
| Dynamic SQL (`EXECUTE`) na função DEFINER | 0 | 0 | ✅ | `grep -n EXECUTE src/backend/migrations/0058_vw_metricas_ciclo.sql` — só `GRANT EXECUTE`, nunca `EXECUTE format(...)` |
| Colunas PII expostas na view (`erp_response`, `request_payload`, `email`, `cnpj`) | 0 | 0 | ✅ | `0058_vw_metricas_ciclo.sql:76-88, 245-255` — só `frente`, `metrica`, `rotulo`, `valor`, `unidade`, `janela_*`, `baseline*` |
| Role bootstrap sem senha em migration | sim (`NOLOGIN`, sem `PASSWORD`) | sim | ✅ | `0058_vw_metricas_ciclo.sql:259-263`; gate `expect(SQL).not.toMatch(/PASSWORD/i)` |
| `default_transaction_read_only` no role | on | on | ✅ | `0058_vw_metricas_ciclo.sql:265` |
| `statement_timeout` no role | 30s | ≤60s (defesa DoS) | ✅ | `0058_vw_metricas_ciclo.sql:267` |
| `search_path` fixado no role | `metricas` | schema próprio | ✅ | `0058_vw_metricas_ciclo.sql:266` |
| Prova de negação (tabelas de origem) para o leitor | 2 (permuta_alocacao_execucao, solicitacao_numerario_execucao) | ≥1 por ledger de origem | ✅ | `vwMetricasCiclo.integration.test.ts:256-263` |
| Prova de negação (recuar série) para o leitor | 1 | ≥1 | ✅ | `vwMetricasCiclo.integration.test.ts:265-269` |
| Prova de negação de escrita para o leitor | 1 | ≥1 | ✅ | `vwMetricasCiclo.integration.test.ts:271-275` |
| Guarda "DSN local" no teste de integração | host-string check (`localhost`/`127.0.0.1`/`::1`) | host + fingerprint | ⚠️ | `vwMetricasCiclo.integration.test.ts:71-73` — não impede tunel SSH (`ssh -L 55432:prod`) |
| Runbook documentado de rotação da senha do leitor | 0 | ≥1 (procedimento + cadência) | ⚠️ | busca por "rotação"/"rotate"/"rotacao" em `ontology/decisions/0045-*.md` e cabeçalho da migration — só o passo humano de criação, sem procedimento de troca |
| `ALTER FUNCTION ... OWNER TO` explícito (fixa owner do DEFINER) | 0 | 1 (dono nomeado) | ⚠️ | `grep -n "OWNER TO" src/backend/migrations/0058_vw_metricas_ciclo.sql` — não existe; owner = executor da migration |
| Alarme de falha de login do leitor / detecção de intrusão | ⚠️ Não medível localmente | presente | ⚠️ | Log de auth do Supabase é externo (dashboard/Log Explorer); nenhuma tactic de `Inform Actors` no delta |
| `npm audit --production` (backend, quick) | ⚠️ Não medível neste ciclo (`--quick`) | critical=0, high=0 | ⚠️ | Fora do escopo `--quick`; delta acrescenta 0 dependências (`_shared-metrics.md`) |

Notas explícitas de não-medição:
> ⚠️ **Não medível localmente**: alarme por falha de login do role `metricas_ciclo_leitor`. Requer `Supabase Log Explorer` (`postgres_logs` filtrado por `authentication failure` + `role = metricas_ciclo_leitor.<project_ref>`) — não há instrumentação no delta. Recomendação: registrar uma query salva no Log Explorer e um alerta por e-mail quando ≥5 falhas/5min.
> ⚠️ **Não medível localmente**: `npm audit` — flag `--quick` restringiu a coleta; o delta não trouxe dependências novas.
> ⚠️ **Não medível localmente**: onde o `DSN_FINANCEIRO` do runner do report vive (cofre, permissão de leitura, cadência de rotação) — está em `kavex-report-ciclo`, fora deste repo. É a nota cross-QA para o consolidator.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Ausente no delta; logs de autenticação do Postgres ficam do lado do Supabase; nenhum alarme configurado por este código | ❌ ausente | Migração `0058_vw_metricas_ciclo.sql` não emite eventos; ausência confirmada por busca por `LOG`, `RAISE NOTICE`, `pgaudit` no delta |
| Detect Service Denial | `statement_timeout = 30s` no role limita queries longas; `default_transaction_read_only = on` bloqueia locks de escrita; sem rate-limit por sessão | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:265, 267` |
| Verify Message Integrity | N/A — não há troca de mensagens fora do canal Postgres TLS (delegado ao Supabase). |  | — |
| Detect Message Delay | N/A — não há timing crítico entre componentes no delta. |  | — |
| Identify Actors | Role dedicado `metricas_ciclo_leitor` (não reusa `authenticated`/`anon`) | ✅ presente | `0058_vw_metricas_ciclo.sql:257-263` |
| Authenticate Actors | `LOGIN PASSWORD` aplicado manualmente no Supabase SQL editor (fora da migration, o que é correto); sem MFA (Postgres native não tem) | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:62-64` (cabeçalho) + gate `expect(SQL).not.toMatch(/PASSWORD/i)` em `vwMetricasCiclo.test.ts:98` |
| Authorize Actors | GRANTs mínimos (`USAGE` no schema, `EXECUTE` só na vigente, `SELECT` só na view). Prova negativa contra as tabelas de origem, contra a função parametrizada e contra escrita | ✅ presente | `0058_vw_metricas_ciclo.sql:269-271`; `vwMetricasCiclo.integration.test.ts:256-275` |
| Limit Access | Schema `metricas` `REVOKE ALL ... FROM PUBLIC`; fora do PostgREST (não em `public`), inacessível a `anon`/`authenticated` | ✅ presente | `0058_vw_metricas_ciclo.sql:73-74`; nota em `_shared-metrics.md` — anon/authenticated recebem só `Dxtm` no `public` |
| Limit Exposure | A view só projeta agregados/rótulos; nenhum campo com PII (`erp_response`, `request_payload`, e-mail, CNPJ) atravessa a fronteira. Chave `metrica` estável (contrato). Baseline `NULL` até haver medição real | ✅ presente | `0058_vw_metricas_ciclo.sql:76-88, 145-201, 244-255` |
| Encrypt Data | Delegado ao Supabase (TLS in-transit, at-rest do disco). Nada no delta reduz cifra | ✅ presente (delegado) | `_shared-metrics.md` — Postgres 17.6 do Supabase |
| Separate Entities | Schema, funções e role dedicados; separação executor↔leitor via par INVOKER + DEFINER (`vigente` fixa parâmetros; o leitor não consegue chamar a paramétrica) | ✅ presente | `0058_vw_metricas_ciclo.sql:73, 217-242`; teste `linha 265-269` |
| Change Default Settings | Role nasce `NOLOGIN`; `default_transaction_read_only = on`; `search_path = metricas`; `statement_timeout = 30s` | ✅ presente | `0058_vw_metricas_ciclo.sql:260, 265-267` |
| Validate Input | Parâmetros da função tipados como `timestamp` (não `text`); nenhum `EXECUTE`/`format()` que interpole dado externo em DDL/DML; a paramétrica só é chamável pelo owner via chain DEFINER | ✅ presente | `0058_vw_metricas_ciclo.sql:76, 217`; guardas em `vwMetricasCiclo.test.ts:36-48` |
| Revoke Access | `REVOKE ALL ON SCHEMA ... FROM PUBLIC`, `REVOKE ALL ON FUNCTION ... FROM PUBLIC` idempotentes; sem runbook para revogar/rotacionar a senha do leitor se `DSN_FINANCEIRO` vazar | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:74, 215, 242`; ausência de procedimento em `0045-metricas-*.md` e no cabeçalho da migration |
| Lock Computer | N/A — backend Postgres, sem endpoint interativo. |  | — |
| Inform Actors | Nenhum alerta configurado neste delta; ninguém é notificado quando o leitor apanha `permission denied` ou quando login falha | ❌ ausente | Não há hook, `RAISE NOTICE`, gatilho ou alarma no delta |
| Restore | DDL 100% idempotente (`CREATE SCHEMA IF NOT EXISTS`, `CREATE OR REPLACE`, bloco `DO $$ ... IF NOT EXISTS ...`), re-rodável sem side-effect. Provado por `it('reaplicar a migration é no-op')` | ✅ presente | `0058_vw_metricas_ciclo.sql:73, 76, 217, 257-263`; `vwMetricasCiclo.integration.test.ts:218-222` |
| Audit Trail | O DDL vive versionado no git (rastreável). As queries do leitor não são auditadas dentro deste delta (dependeria de `pgaudit` no Supabase). Cross-QA: overlap com Fault Tolerance | ⚠️ parcial | Delta versionado; sem `pgaudit`/`log_statement` explícito no delta |

## 4. Findings (achados)

### F-security-1: guarda "DSN local" no teste de integração é só host-string — bypassável por tunel SSH

- **Severidade**: P2 (débito defensável — mitigação existe, mas falha silenciosa se um dev tunelar produção)
- **Tactic violada**: Limit Access / Validate Input
- **Localização**: `src/backend/migrations/vwMetricasCiclo.integration.test.ts:68-73`
- **Evidência (objetiva)**:
  ```
  const host = new URL(dsn).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
      throw new Error(`METRICAS_CICLO_TEST_DSN precisa ser local; recebido host "${host}"`);
  }
  // ...
  await raiz.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await raiz.query(`CREATE DATABASE ${BANCO}`);
  ```
- **Impacto técnico**: se um dev tem um tunel SSH ativo (`ssh -L 55432:localhost:5432 supabase-prod`) e por hábito exporta `METRICAS_CICLO_TEST_DSN=postgres://postgres:...@localhost:55432/postgres`, o teste passa a guarda, executa `DROP DATABASE IF EXISTS metricas_ciclo_it WITH (FORCE)` e recria o banco. Não há banco `metricas_ciclo_it` em produção hoje — o dano prático é criar 60+ objetos e um role fantasma `metricas_ciclo_leitor` (que já existe pela migration produtiva). Mas o `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD 'leitor-teste'` do `beforeAll` do `describe('como o role leitor')` (linha 229-231) sobrescreve a senha do role em produção, e o `afterAll` (linha 245) volta para `NOLOGIN PASSWORD NULL`, quebrando o runner do report até rotação manual.
- **Impacto de negócio**: uma quebra de credencial do runner do report (indisponibilidade da Seção 3 do report semanal, sem perda de dado). Recuperável em minutos; o pior aspecto é ser silencioso — o teste passa verde local, e o report do próximo ciclo entra sem métrica.
- **Métrica de baseline**: 1 caminho de ataque conhecido (tunel SSH); 0 verificações de fingerprint além do hostname; o role `metricas_ciclo_leitor` **existe em produção** (a mesma migration cria) e o teste faz `ALTER ROLE` **por nome**, sem qualificar por banco de destino.

### F-security-2: sem runbook de rotação/revogação da senha do leitor

- **Severidade**: P2 (débito operacional; a senha do leitor é o único segredo do sistema criado por esta feature)
- **Tactic violada**: Revoke Access
- **Localização**: cabeçalho de `src/backend/migrations/0058_vw_metricas_ciclo.sql:62-64`; ADR `ontology/decisions/0045-metricas-do-ciclo-leem-o-ledger-e-nao-a-spine.md:73-84`
- **Evidência (objetiva)**:
  ```
  --     ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD '<gerada, guardada no cofre>';
  ```
  Nenhuma referência a qual cofre, a cadência de rotação, ao procedimento em caso de vazamento, ou a quem tem permissão de fazer a operação.
- **Impacto técnico**: se `DSN_FINANCEIRO` vazar (log do runner, screenshot em PR, `env` dumpado em issue), a revogação é operacionalmente descoberta e artesanal. A senha vive indefinidamente porque não há gatilho de rotação.
- **Impacto de negócio**: um leak da DSN dá ao portador leitura dos agregados semanais — não expõe PII, mas antecipa a Seção 3 do report antes do ciclo fechar. Baixo por natureza (agregados), mas o processo de resposta ao incidente é indefinido, o que é o problema real.
- **Métrica de baseline**: 0 procedimentos documentados de rotação; 0 procedimentos documentados de revogação; 1 credencial nova sem cadência.

### F-security-3: `SECURITY DEFINER` sem `OWNER TO` explícito — privilégio herda de quem rodou a migration

- **Severidade**: P3 (defesa em profundidade; a corrente atual é segura, mas não é pinada)
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:217-242`
- **Evidência (objetiva)**:
  ```
  CREATE OR REPLACE FUNCTION metricas.metricas_ciclo_vigente()
  RETURNS TABLE (...)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
  AS $fn$ ... $fn$;
  -- sem `ALTER FUNCTION metricas.metricas_ciclo_vigente() OWNER TO <role>;`
  ```
- **Impacto técnico**: o owner do `SECURITY DEFINER` é o role que executou o `CREATE OR REPLACE FUNCTION`. Hoje é o `BootMigrator` rodando com credenciais de superuser do Supabase. Se, por manutenção futura, um role menos privilegiado reaplicar (por exemplo, via ferramenta de migration com credencial dedicada), o owner muda no `CREATE OR REPLACE` e o DEFINER passa a rodar com privilégio menor — a corrente `vigente(DEFINER) → metricas_ciclo(INVOKER)` deixa de conseguir ler `public.permuta_alocacao_execucao`, e o leitor começa a ver linhas vazias (falha silenciosa, não erro de permissão).
- **Impacto de negócio**: report semanal sem número, sem alarme. Débito de manutenibilidade cruzando com fault-tolerance.
- **Métrica de baseline**: 0 `OWNER TO` explícitos; 1 função DEFINER cujo owner é implícito na credencial do runner de migration.

### F-security-4: nenhum alerta de falha de autenticação do role `metricas_ciclo_leitor`

- **Severidade**: P2 (a tactic `Inform Actors` está ausente para este role específico)
- **Tactic violada**: Detect Intrusion / Inform Actors
- **Localização**: repo inteiro — não há instrumentação no delta
- **Evidência (objetiva)**:
  ```
  $ grep -rn "metricas_ciclo_leitor" src/backend
  src/backend/migrations/0058_vw_metricas_ciclo.sql:259-271
  src/backend/migrations/vwMetricasCiclo.test.ts:87-97
  src/backend/migrations/vwMetricasCiclo.integration.test.ts:230-263
  # nenhum consumidor / dashboard / alerta neste repo
  ```
- **Impacto técnico**: tentativas de brute-force ou de escalada (`SELECT ... FROM public.*`, `metricas.metricas_ciclo('2026-01-01', ...)`) geram `permission denied` no Postgres, mas ninguém é notificado. Um atacante silencioso pode iterar em ritmo baixo abaixo do radar.
- **Impacto de negócio**: baixa gravidade porque o dano possível é ler agregados. Mas a ausência é característica: o time do Yuri só descobre o incidente lendo o Log Explorer post-hoc.
- **Métrica de baseline**: 0 alarmes configurados no Supabase (ou fora dele) que filtrem `role = metricas_ciclo_leitor.<project_ref>` com `authentication failure` ou `permission denied`. O Log Explorer capta o evento; ninguém é alertado.

### F-security-5: senha de teste `'leitor-teste'` reaproveitada como convenção — hábito perigoso quando o teste chegar ao CI

- **Severidade**: P3 (higiene de teste)
- **Tactic violada**: Change Default Settings
- **Localização**: `src/backend/migrations/vwMetricasCiclo.integration.test.ts:230-231`
- **Evidência (objetiva)**:
  ```
  await admin.query(
      `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD 'leitor-teste'`,
  );
  ```
- **Impacto técnico**: hoje o teste é `.integration.test.ts` e não roda no `npm test` (padrão do `jest.config` os exclui — confirmado em `_shared-metrics.md`). Só roda quando o dev exporta `METRICAS_CICLO_TEST_DSN` local. Se amanhã for movido para CI sem revisão da guarda de host (F-security-1), a senha `'leitor-teste'` sai do teste e vira senha real do role em qualquer ambiente atingível como `localhost` do runner do CI (contêiner Postgres da própria pipeline).
- **Impacto de negócio**: pequeno hoje (fluxo protegido pela guarda de host); torna-se P2 no dia em que a guarda de host for enfraquecida.
- **Métrica de baseline**: 1 senha literal em teste; 0 mecanismo alternativo (gerar `md5(random())` no `beforeAll`) implementado.

## 5. Cards Kanban

### [security-1] Reforçar a guarda de host do teste de integração com fingerprint de banco descartável

- **Problema**
  > A guarda no `beforeAll` do teste de integração aceita qualquer DSN com hostname `localhost`/`127.0.0.1`/`::1` e em seguida executa `DROP DATABASE IF EXISTS metricas_ciclo_it WITH (FORCE)` e `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD 'leitor-teste'`. Um tunel SSH para produção (`ssh -L 55432:localhost:5432 supabase-prod`) atende à guarda. O dano específico é reescrever a senha do role em produção, quebrando o runner do report até rotação manual — silencioso e recuperável, mas evitável.

- **Melhoria Proposta**
  > Antes do `DROP DATABASE`, exigir que o banco raiz tenha um marcador que só existe no contêiner descartável (por exemplo, criar `postgres:17-alpine` com `POSTGRES_DB=metricas_ciclo_root` e checar `current_database() = 'metricas_ciclo_root'` no início do `beforeAll`). Alternativa complementar: só rodar se `process.env.METRICAS_CICLO_TEST_ALLOW_DROP === 'yes-i-know'`. Tactic Bass alvo: **Limit Access**. Arquivo: `src/backend/migrations/vwMetricasCiclo.integration.test.ts:68-90`.

- **Resultado Esperado**
  > 2 verificações independentes antes do primeiro DDL destrutivo (hostname + fingerprint do banco), e a tentativa de rodar contra uma DSN que não seja um contêiner descartável falha antes de emitir qualquer comando.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1, F-security-5
- **Métricas de sucesso**:
  - Caminhos de ataque conhecidos (tunel SSH, DSN colada errada): 1 → 0
  - Verificações de segurança no `beforeAll`: 1 (host) → ≥2 (host + fingerprint)
- **Risco de não fazer**: em 6 meses, alguém quebra o runner do report em produção rodando o teste de integração com um tunel ativo. A recuperação é manual (`ALTER ROLE ... WITH LOGIN PASSWORD '<nova>'`), o incidente é silencioso, e ninguém liga a causa ao teste.
- **Dependências**: nenhuma

### [security-2] Documentar o procedimento de rotação e revogação da senha do `metricas_ciclo_leitor`

- **Problema**
  > A migration `0058_vw_metricas_ciclo.sql` acerta ao deixar o `LOGIN PASSWORD` como passo humano no cofre — o segredo não entra em git. Falta o outro lado: nenhum documento diz onde a senha vive, quem pode rotacioná-la, com que cadência, e o que fazer se `DSN_FINANCEIRO` vazar no runner do `kavex-report-ciclo`. Sem procedimento, a resposta ao incidente é improvisada e a credencial vive indefinidamente.

- **Melhoria Proposta**
  > Anexar ao ADR-0045 (ou criar `docs/runbooks/rotacao-metricas-ciclo-leitor.md`) o procedimento em três blocos: (a) criação inicial — quem gera, onde guarda; (b) rotação regular — cadência trimestral com o comando `ALTER ROLE metricas_ciclo_leitor WITH PASSWORD '...'` + atualização no cofre + atualização de `DSN_FINANCEIRO` no runner; (c) revogação de emergência — `ALTER ROLE ... WITH NOLOGIN` + trilha no Log Explorer. Tactic Bass alvo: **Revoke Access**.

- **Resultado Esperado**
  > 1 runbook versionado; cadência de rotação declarada; comandos de revogação executáveis literalmente do runbook.

- **Tactic alvo**: Revoke Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Runbooks de rotação: 0 → 1
  - Cadência de rotação: indefinida → trimestral
  - Tempo estimado para revogar em incidente: hoje "depende de quem está online" → ≤15min (comando literal do runbook)
- **Risco de não fazer**: DSN vazar em 6 meses e a resposta ser improvisada; o portador da DSN antecipa a Seção 3 do report do ciclo por dias/semanas.
- **Dependências**: nenhuma

### [security-3] Fixar `OWNER TO` explícito da função `SECURITY DEFINER`

- **Problema**
  > `metricas.metricas_ciclo_vigente()` é `SECURITY DEFINER` mas o owner é implícito — quem rodou o `CREATE OR REPLACE FUNCTION` primeiro. Se uma futura ferramenta de migration reaplicar com credencial menos privilegiada, o owner muda no `CREATE OR REPLACE` e a corrente `vigente(DEFINER) → metricas_ciclo(INVOKER)` deixa de ler as tabelas de origem. Falha silenciosa: view retorna vazia, report sai sem número.

- **Melhoria Proposta**
  > Adicionar `ALTER FUNCTION metricas.metricas_ciclo_vigente() OWNER TO postgres;` (ou outro role explicitamente escolhido) logo após o `CREATE OR REPLACE FUNCTION`, e o mesmo para `metricas.metricas_ciclo(timestamp, timestamp)` para consistência. Documentar no cabeçalho da migration por que o owner é esse e não outro. Tactic Bass alvo: **Authorize Actors**. Arquivo: `src/backend/migrations/0058_vw_metricas_ciclo.sql:217, 242`.

- **Resultado Esperado**
  > O owner do `SECURITY DEFINER` é pinado; reaplicar a migration com uma credencial diferente não silencia a view.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Funções DEFINER com owner explícito: 0/1 → 1/1
- **Risco de não fazer**: um refactor futuro da pipeline de migration muda o owner sem ninguém perceber; a Seção 3 do report do próximo ciclo sai vazia; o time gasta um ciclo tentando entender por que a view mudou de comportamento sem mudança de código.
- **Dependências**: nenhuma

### [security-4] Alertar em falhas de autenticação e `permission denied` do `metricas_ciclo_leitor`

- **Problema**
  > Não há alarme quando o role `metricas_ciclo_leitor` toma `authentication failure` ou `permission denied` — nem no delta, nem em outro lugar do repo. Tentativas de brute-force ou de escalada existem no log do Supabase mas não geram notificação. A ausência é característica: o time descobre o incidente lendo o Log Explorer post-hoc, se descobrir.

- **Melhoria Proposta**
  > No Supabase Log Explorer, criar duas queries salvas com alerta por e-mail: (a) `authentication failure` filtrado por `user_name ~ '^metricas_ciclo_leitor'`, disparar em ≥5 eventos/5min; (b) `permission denied` no mesmo user, disparar em ≥3 eventos/5min. Documentar no runbook do card `security-2`. Tactic Bass alvo: **Detect Intrusion** + **Inform Actors**.

- **Resultado Esperado**
  > Falhas de auth/authz do leitor geram notificação em minutos, não em post-mortem.

- **Tactic alvo**: Detect Intrusion / Inform Actors
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Alertas configurados para o leitor: 0 → 2
  - Time-to-detect de escalada silenciosa: indefinido → ≤5min
- **Risco de não fazer**: iteração lenta de escalada por um atacante que capturou a DSN passa despercebida por semanas; o dano é limitado (agregados), mas o sinal é perdido.
- **Dependências**: nenhuma

### [security-5] Gerar a senha do teste de integração no `beforeAll`, em vez de literal `'leitor-teste'`

- **Problema**
  > O teste de integração faz `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD 'leitor-teste'` com literal. Hoje o teste está fora do `npm test` e protegido pela guarda de host; se algum dia o teste for movido para CI sem revisão da guarda (card `security-1`), a senha literal vira senha real do role no ambiente de CI.

- **Melhoria Proposta**
  > No `beforeAll` do `describe('como o role leitor')`, gerar a senha com `crypto.randomBytes(24).toString('hex')` e passar a variável nas duas queries (`ALTER ROLE` e no DSN do leitor). Mantém a mesma cobertura de teste, sem senha literal no diff. Tactic Bass alvo: **Change Default Settings**. Arquivo: `src/backend/migrations/vwMetricasCiclo.integration.test.ts:227-241`.

- **Resultado Esperado**
  > Nenhuma senha literal no repo; a senha do teste vive só na memória da execução.

- **Tactic alvo**: Change Default Settings
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - Senhas literais em `src/backend/migrations/*.test.ts`: 1 → 0
- **Risco de não fazer**: baixo enquanto o teste for local-only; sobe para P2 no dia em que o teste for para CI sem revisão.
- **Dependências**: `security-1` (a guarda de host reforçada é a garantia complementar de que o teste continua local-only)

## 6. Notas do agente

- Escopo restrito ao delta `14ca71a..HEAD` — não avaliei o restante do backend Express (Supabase JWT, PostgREST, rotas HTTP). O `_shared-metrics.md` já mapeia que `anon`/`authenticated` recebem só `Dxtm` no schema `public` e RLS está ligado nas tabelas de origem; o delta usa isso como premissa.
- Nenhum P0/P1 identificado neste delta. A migration é conservadora (schema isolado, GRANTs mínimos, DEFINER com `search_path = ''` e chamadas qualificadas, sem `EXECUTE`, sem PII na view) e os testes provam as tactics `Authorize Actors`, `Limit Access` e `Separate Entities` com asserções positivas e negativas. Score 8/10 reflete arquitetura sólida com gaps de operacionalização (rotação, alerta, ownership pinado).
- Cross-QA para o consolidator: (i) `Audit Trail` sobrepõe com **Fault Tolerance** (queries do leitor não vão para `pgaudit` neste delta); (ii) `Limit Exposure` toca **Availability** (view emite só janelas fechadas — assunto de correctness, não blast-radius); (iii) `Restore` idempotente toca **Deployability** (reaplicar a migration é no-op provado em teste); (iv) o segredo `DSN_FINANCEIRO` vive fora deste repo (em `kavex-report-ciclo`) — a higiene de secret hygiene do runner é responsabilidade do outro repo e não pode ser medida daqui.
