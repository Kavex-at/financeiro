---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-deployability
generated_at: 2026-09-14T16:24:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Push em `main` (delta `metricas-ciclo`) | Render dispara `autoDeploy`; boot da nova réplica roda o `BootMigrator` sob advisory lock e aplica `0058_vw_metricas_ciclo.sql` | `migrations/0058_vw_metricas_ciclo.sql` (schema `metricas`, 2 funções, 1 view, ROLE cluster-level + `ALTER ROLE ... SET`) + Render web service | Produção Supabase (Postgres 17.6, sessão UTC) já com 0001..0057 aplicadas; `metrics.py` (repo `kavex-report-ciclo`) leitor externo | Migration idempotente aplica sem DML; `/health` volta antes de aceitar tráfego; se falhar, versão anterior fica no ar; passo humano (`ALTER ROLE ... LOGIN PASSWORD`) documentado no cabeçalho da migration para habilitar o leitor | Deploy verde em ≤ ~60s (build Render), migração no-op na 2ª aplicação (provado em teste de integração), 0 escrita no ledger, 0 divergência entre `view` e função (verificado em 48 comparações contra o ledger vivo) |

O delta é read-model somente: nenhuma dependência nova (0 dependências em `package.json`), nenhum handler novo em `routes/`, nenhuma alteração de bundle. Toda a superfície de deploy é a própria migration + o passo humano de LOGIN.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados commit→prd (CI + boot-migrate) | 6 (checkout, `npm ci`, `npm audit`, `typecheck`, `lint`, `test --coverage`, `build`; deploy: `BootMigrator` + `app.listen`) | ≥5 | ✅ | `.github/workflows/ci.yml:1-32` + `render.yaml:17,31` + `src/backend/migrations/BootMigrator.ts:60-81` |
| Dependências novas introduzidas pelo delta | 0 | 0 | ✅ | `_shared-metrics.md` (Dependências) |
| Idempotência da migration (reaplicar = no-op) | provado | provado | ✅ | `src/backend/migrations/vwMetricasCiclo.integration.test.ts:218-222` |
| Rollback script para 0058 em `migrations/rollbacks/` | ausente | presente somente se `UPDATE > 1.000 linhas` (política vigente) | ✅ (política) / ⚠️ (na prática) | `src/backend/migrations/rollbacks/README.md:26-31` — 0058 é DDL sem UPDATE, não obriga rollback |
| Passos humanos para o deploy ficar 100% funcional | 1 (`ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD '<gerada>'`) + set do `DSN_FINANCEIRO` no repo `kavex-report-ciclo` | 0 (Script Deployment Commands) | ⚠️ | `src/backend/migrations/0058_vw_metricas_ciclo.sql:60-69` |
| Coordenação entre repos exigida no deploy | 2 repos (`financeiro` aplica a view; `kavex-report-ciclo/scripts/metrics.py` consome — gaps K1/K2/K3/K4 documentados) | 1 | ⚠️ | `ontology/_inbox/metricas-ciclo-gap.md:49-61` |
| Artefatos cluster-level criados pela migration | 1 ROLE (`metricas_ciclo_leitor`) + 3 `ALTER ROLE ... SET` — persistem no cluster mesmo após `DROP DATABASE` e independem do db "financeiro" | 0 preferencialmente; se houver, precisa de reverse consciente | ⚠️ | `src/backend/migrations/0058_vw_metricas_ciclo.sql:257-267` |
| Advisory lock por migration + `lock_timeout=30s` + `statement_timeout=10min` prefixado | presente | presente | ✅ | `src/backend/migrations/runMigrations.ts:26-29,74` + `BootMigrator.ts:12,125-145` |
| Guard-rail contra aplicar migration remota em `environment=local` | presente | presente | ✅ | `src/backend/migrations/BootMigrator.ts:97-112` |
| Rebuild de bundle backend por conta do delta | 0 arquivos TS mudados (só SQL + testes) | 0 | ✅ | `_shared-metrics.md` (Delta) |
| Testes CI que gatilham antes do deploy | 134 suites / 1898 tests exit 0; 9 estáticos guardam contrato/somente-leitura/GRANTs de `0058` | ≥1 dedicado ao 0058 | ✅ | `_shared-metrics.md` (Testes) + `vwMetricasCiclo.test.ts` |
| Detecção de drift do artefato cluster-level (`metricas_ciclo_leitor` já existente com senha divergente) | ausente | um `SELECT` conferindo `rolcanlogin`/`rolvaliduntil` após o boot, ou runbook | ⚠️ | ausente no delta |
| Bundle size / build duration | ⚠️ Não medível para este delta: `--quick` e delta é SQL puro; nenhum rebuild TS | — | — | `_shared-metrics.md` (LOC) |
| Deploy multi-tenant / Terraform / canário | ⚠️ Não medível: `infra/` não existe; deploy é Render hook único (uma conta Supabase compartilhada) | — | — | `CLAUDE.md` (Estado Atual vs. Alvo) |
| Rollout sequenciado dev→stg→prd | ⚠️ Não medível: só existe `main` → `production`; não há `stg` | — | — | `render.yaml:11` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts (canary / blue-green / rolling) | Render single-service auto-deploy; sem canary. Para este delta o risco é mínimo (SQL read-model), mas o mecanismo geral não muda. | ⚠️ parcial (herdado do repo, não regressão do delta) | `render.yaml:17,31` |
| Rollback | Rollback do CÓDIGO via redeploy do commit anterior no Render; rollback do ESQUEMA via script manual em `migrations/rollbacks/` — 0058 não tem `.rollback.sql` (não obrigatório pela política porque é DDL idempotente sem `UPDATE`). O `CREATE OR REPLACE`/`IF NOT EXISTS` cobrem o roll-forward; um roll-back exigiria `DROP` manual do schema + `DROP ROLE` (cluster-level). | ⚠️ parcial | `src/backend/migrations/rollbacks/README.md:26-31` + `src/backend/migrations/0058_vw_metricas_ciclo.sql:73-271` |
| Script Deployment Commands | Migração é 100% SQL declarativo aplicado pelo `BootMigrator`; o passo `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD` é **manual** e documentado no cabeçalho — não há wrapper que peça a senha e o aplique, e não há healthcheck que detecte o role ainda `NOLOGIN`. | ⚠️ parcial | `src/backend/migrations/0058_vw_metricas_ciclo.sql:60-69` |
| Logical Grouping | Schema `metricas` isolado do `public`, fora do PostgREST, com role dedicado só para leitura. Agrupamento lógico exemplar para este delta. | ✅ presente | `src/backend/migrations/0058_vw_metricas_ciclo.sql:73-74,269-271` |
| Physical Grouping | N/A: Render 1 réplica, Supabase compartilhado; não há segregação física por tenant/frente. Não é regressão do delta. | N/A | `CLAUDE.md` (Estado Atual) |
| Package Dependencies | Delta introduz 0 novas dependências npm; o consumidor (`kavex-report-ciclo/scripts/metrics.py`) é outro repo — a dependência cross-repo é `psycopg + DSN` (contrato SQL de 9 colunas), sem versionamento explícito da view. | ⚠️ parcial | `_shared-metrics.md` + `ontology/_inbox/metricas-ciclo-gap.md:49-61` |
| Surge Protection | `statement_timeout = 10min` em toda migration; `statement_timeout = 30s` no role leitor; `default_transaction_read_only = on` no role leitor. Consulta pesada do leitor não trava o cluster nem escreve. | ✅ presente | `src/backend/migrations/runMigrations.ts:26-29` + `src/backend/migrations/0058_vw_metricas_ciclo.sql:265-267` |
| Idempotent deploys | `CREATE SCHEMA IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION/VIEW`, `DO $$ IF NOT EXISTS ... CREATE ROLE ... END $$`, `GRANT`/`REVOKE` re-idempotentes. Reaplicar é no-op (test `reaplicar a migration é no-op`). | ✅ presente | `src/backend/migrations/0058_vw_metricas_ciclo.sql:73,76,217,244,257-263` + `vwMetricasCiclo.integration.test.ts:218-222` |
| Drift detection | Nenhum job varre o cluster procurando role/schema divergente entre o SQL e o que existe no Postgres. Como `metricas_ciclo_leitor` é objeto **cluster-level** no Supabase, um projeto irmão poderia criar um homônimo e a migration se limitaria a `ALTER ROLE ... SET` no que estiver lá. Não é problema imediato (o cluster do Financeiro é dedicado ao projeto), mas o delta não instrumenta nada. | ❌ ausente | ausente no delta |
| Reproducible builds | Delta não altera build backend; `package-lock.json` intacto; `npm ci` no CI. Aplicação da migration é determinística porque o corpo é SQL fixo — nada de `now()` embutido em DDL (apenas dentro da função vigente, o que é intencional). | ✅ presente | `.github/workflows/ci.yml:20` |
| Per-tenant blast-radius limit | N/A neste momento — não há multi-tenant (single tenant `local`, Supabase compartilhado). Não é regressão do delta. | N/A | `CLAUDE.md` (Tenants) |
| Deployment observability | `BootMigrator` loga `aplicada(s) N: ...` ou `esquema em dia`; falha de migration derruba o boot com stack e o Render mantém a versão anterior. Não há observabilidade específica para o passo humano do LOGIN (a única sinalização é `metrics.py` receber `role ... is not permitted to log in`). | ⚠️ parcial | `src/backend/migrations/BootMigrator.ts:73-79` |

## 4. Findings (achados)

### F-deployability-1: passo humano obrigatório (`ALTER ROLE ... LOGIN PASSWORD`) para o deploy ficar funcional

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:60-69`
- **Evidência (objetiva)**:
  ```
  -- Nasce NOLOGIN (senha não entra em migration). PASSO HUMANO, uma vez, no SQL editor do Supabase:
  --     ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD '<gerada, guardada no cofre>';
  -- e `DSN_FINANCEIRO` apontando para ELE — não para um membro dele: `ALTER ROLE … SET` (read-only,
  -- search_path, timeout) não é herdado por quem recebe o role.
  ...
  DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metricas_ciclo_leitor') THEN
          CREATE ROLE metricas_ciclo_leitor NOLOGIN;
      END IF;
  END $$;
  ```
- **Impacto técnico**: aplicar a migration deixa o role em estado `NOLOGIN`. Sem o passo humano, `metrics.py` recebe `role "metricas_ciclo_leitor" is not permitted to log in` no primeiro `SELECT` da view. A migration passa verde, o boot passa verde, mas a Seção 3 do report semanal fica sem dado até alguém executar o `ALTER ROLE`. Motivada (deliberadamente) por não commitar senha, mas hoje o único gatilho que denuncia o esquecimento é o próprio `metrics.py` falhando.
- **Impacto de negócio**: report semanal da Columbia sai sem a métrica de operação no primeiro ciclo após o merge. Detectado pelo Yuri quando abrir o ciclo; janela típica: até 7 dias.
- **Métrica de baseline**: **1 passo humano fora do CI/CD** para deploy ser 100% funcional (0 → 1). Sem instrumentação que sinalize proativamente que o role está `NOLOGIN`.

### F-deployability-2: rollback do artefato cluster-level (`ROLE metricas_ciclo_leitor` + `ALTER ROLE ... SET`) não é coberto por script reverso

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:257-267` + `src/backend/migrations/rollbacks/` (não existe `.rollback.sql` para 0058)
- **Evidência (objetiva)**:
  ```
  DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metricas_ciclo_leitor') THEN
          CREATE ROLE metricas_ciclo_leitor NOLOGIN;
      END IF;
  END $$;

  ALTER ROLE metricas_ciclo_leitor SET default_transaction_read_only = on;
  ALTER ROLE metricas_ciclo_leitor SET search_path = metricas;
  ALTER ROLE metricas_ciclo_leitor SET statement_timeout = '30s';
  ```
  E `src/backend/migrations/rollbacks/README.md:26-31` só obriga rollback para migration com `UPDATE > 1.000 linhas`.
- **Impacto técnico**: rollback do commit no Render **não** apaga o schema `metricas`, as funções, a view nem o role `metricas_ciclo_leitor`. A migration é forward-only e o `MigrationRunner` não desfaz. `ROLE` e `ALTER ROLE ... SET` vivem no cluster, não no database — sobrevivem a um eventual `DROP DATABASE`. Se um dia o schema `metricas` mudar de formato ou for descontinuado, quem for reverter precisa escrever `DROP SCHEMA metricas CASCADE; DROP ROLE metricas_ciclo_leitor;` no editor SQL — não é impossível, mas não está scripted nem revisado.
- **Impacto de negócio**: baixo enquanto a view for aditiva. Sobe se um dia a `metricas` for redesenhada e alguém rebaixar por engano um artefato ainda em uso pelo `metrics.py` — mensagem de erro `role does not exist` só aparece na próxima execução do report.
- **Métrica de baseline**: **0 scripts em `rollbacks/` cobrindo a 0058**; **4 artefatos cluster-level ou de schema criados sem inverso registrado** (schema + 2 funções + view + role). Política vigente não exige, mas a auditoria do cluster passa a ter 1 role dormente permanente.

### F-deployability-3: acoplamento cross-repo com `kavex-report-ciclo/scripts/metrics.py` sem versionamento do contrato

- **Severidade**: P3
- **Tactic violada**: Package Dependencies
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:1-8` (documenta o contrato) + `ontology/_inbox/metricas-ciclo-gap.md:49-61` (gaps K1..K4 no outro repo)
- **Evidência (objetiva)**:
  ```
  -- O report semanal da Columbia (`kavex-report-ciclo/scripts/metrics.py`) lê `vw_metricas_ciclo`
  -- e não sabe o que os números significam — só lê a forma. A forma é o contrato e NÃO muda:
  --   frente, metrica, rotulo, valor, unidade, janela_inicio, janela_fim, baseline, baseline_desc
  ```
  Gaps K1..K4 (filtro `--fim` sem hora, `config/columbia.json` ausente, `render.py` imprime `{valor}{unidade}` cru, "série iniciada neste ciclo" fixo) vivem em **outro repositório** e são pré-condição para o report ser útil.
- **Impacto técnico**: um deploy da view sem coordenar com o `metrics.py` deixa 4 defeitos conhecidos em produção. Não há tag versionando o contrato das 9 colunas, nem CI cross-repo que quebre se `metrics.py` renomear uma coluna. A promessa "chave nunca muda" está no comentário, não num teste.
- **Impacto de negócio**: report do ciclo pode sair com valores mal formatados (`1283986.92R$`, `92.3%` sem separador) ou com data-sem-hora zerando resultado. Já mapeado em gap; a decisão sobre `--fim` é 1-liner no `metrics.py`.
- **Métrica de baseline**: **4 gaps abertos** em outro repo (K1, K2, K3, K4) que dependem do consumidor, e **0 verificações automatizadas** de compatibilidade do contrato view↔leitor.

## 5. Cards Kanban

### [deployability-1] Automatizar a habilitação do role `metricas_ciclo_leitor` após a migration

- **Problema**
  > A 0058 cria o role `NOLOGIN` deliberadamente (senha não vai em migration). Habilitar exige `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD '<gerada>'` no SQL editor do Supabase, uma vez, feito à mão. Se esquecido, o `metrics.py` do primeiro ciclo pós-merge falha com `role ... is not permitted to log in` e a Seção 3 sai sem dado — detectado só quando o Yuri abrir o report.

- **Melhoria Proposta**
  > Script `src/backend/scripts/enable-metricas-ciclo-leitor.ts` (executável só localmente, contra DSN admin passado por env) que gera a senha, aplica o `ALTER ROLE ... LOGIN PASSWORD`, imprime a senha uma vez e sugere onde colar (`DSN_FINANCEIRO` no cofre do `kavex-report-ciclo`). Alternativa mais leve: adicionar ao `runbooks/` uma checklist com o comando exato + verificação `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'metricas_ciclo_leitor'`. Tactic Bass: **Script Deployment Commands**.

- **Resultado Esperado**
  > Passo humano continua existindo (senha fora de git), mas cai para 1 comando com verificação embutida e não depende de o operador lembrar do cabeçalho da migration.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Passos humanos manuais sem script: 1 → 0 (comando é o script)
  - MTTR entre merge e leitor ativo: hoje ≤ próximo ciclo semanal (7 dias) → ≤ 1 hora
- **Risco de não fazer**: primeiro ciclo pós-merge sai sem métrica de operação; recorre em cada novo ambiente (dev com Postgres próprio, staging futuro).
- **Dependências**: nenhuma

### [deployability-2] Registrar reverse consciente para os artefatos cluster-level da 0058

- **Problema**
  > A migration cria schema `metricas`, 2 funções, 1 view e — o ponto delicado — o role cluster-level `metricas_ciclo_leitor` com 3 `ALTER ROLE ... SET`. Um redeploy do commit anterior no Render **não desfaz nada disso**. A política em `rollbacks/README.md` só exige `.rollback.sql` para `UPDATE > 1.000 linhas`, então 0058 está tecnicamente compliant — mas o role fica dormente no cluster, e o próximo dev que precisar reverter escreve o `DROP` na hora, sem revisão.

- **Melhoria Proposta**
  > Criar `src/backend/migrations/rollbacks/0058_vw_metricas_ciclo.rollback.sql` com:
  > ```sql
  > DROP VIEW IF EXISTS metricas.vw_metricas_ciclo;
  > DROP FUNCTION IF EXISTS metricas.metricas_ciclo_vigente();
  > DROP FUNCTION IF EXISTS metricas.metricas_ciclo(timestamp, timestamp);
  > DROP SCHEMA IF EXISTS metricas;
  > REVOKE ALL ON DATABASE current FROM metricas_ciclo_leitor;
  > DROP ROLE IF EXISTS metricas_ciclo_leitor;
  > ```
  > Complementar `rollbacks/README.md` para incluir "cria artefato cluster-level (ROLE)" como gatilho de reverse além do "UPDATE > 1.000 linhas". Tactic Bass: **Rollback**.

- **Resultado Esperado**
  > Reverso auditado e revisado no PR, ao invés de improviso quando alguém precisar sair fora. O deploy segue forward-only; só o script fica na gaveta.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Artefatos cluster-level sem reverse: 1 (role) + 3 (`ALTER ROLE ... SET`) → 0
  - Scripts em `rollbacks/` cobrindo 0058: 0 → 1
- **Risco de não fazer**: se a `metricas` for redesenhada em 6 meses e alguém precisar desmontar, o `DROP` cai em produção sem revisão e sem PR — cenário que a própria política do repo (ADR 2026-09-08) foi criada para prevenir.
- **Dependências**: nenhuma

### [deployability-3] Verificar automaticamente o contrato view↔`metrics.py`

- **Problema**
  > O comentário-cabeçalho da 0058 promete "a forma é o contrato e NÃO muda", mas o consumidor `kavex-report-ciclo/scripts/metrics.py` vive noutro repo e não há CI cross-repo. Se alguém renomear `janela_inicio` na migration, o `metrics.py` só quebra em produção no ciclo seguinte. Já existem 4 defeitos conhecidos no consumidor (K1..K4) apurados no gap desta feature.

- **Melhoria Proposta**
  > (a) Adicionar um teste estático em `vwMetricasCiclo.test.ts` que congela **os nomes e a ordem das 9 colunas** (já existe — reforçar como snapshot versionado com nota explícita "quebrar aqui = quebra contrato com `kavex-report-ciclo`"). (b) Abrir issue no `kavex-report-ciclo` cobrindo K1..K4 e linkar no PR desta feature. (c) Considerar `SELECT column_name, ordinal_position FROM information_schema.columns WHERE table_schema = 'metricas' AND table_name = 'vw_metricas_ciclo'` num smoke test pós-deploy que trave o report se a assinatura mudar. Tactic Bass: **Package Dependencies**.

- **Resultado Esperado**
  > Mudança no contrato falha primeiro no CI do `financeiro`, não no ciclo semanal. Gaps K1..K4 ficam rastreados no repo certo.

- **Tactic alvo**: Package Dependencies
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Gaps K1..K4 registrados como issues no `kavex-report-ciclo`: 0 → 4
  - Testes que fixam o contrato de 9 colunas: 1 (parcial) → 1 explicitamente rotulado como "contract test"
- **Risco de não fazer**: renomear "silenciosa" de coluna passa CI verde e derruba o report no próximo ciclo; recorrência esperada baixa (~1×/ano), impacto por incidente = 1 ciclo perdido.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo respeitado: só a delta `14ca71a..HEAD` (migration 0058 + testes). Débito herdado do repositório (Render sem canary, sem staging, sem drift-detection cluster-wide) foi mencionado apenas como contexto e não vira card — não é regressão desta feature.
- Métricas de bundle/build não medidas: `--quick` e delta é SQL puro, `_shared-metrics.md` já confirma `npm test` verde (134 suites) e 0 dependências novas.
- Cross-QA para o consolidator: (a) F-deployability-1 e F-deployability-3 têm sobreposição com **Integrability** (o consumidor é outro repo) e com **Security** (senha do role fora de git, ok; mas o passo humano é o ponto de gestão de segredo); (b) F-deployability-2 conversa com **Modifiability** (política de rollback do repo evolui aqui); (c) o `statement_timeout = 30s` do leitor é também uma métrica de **Performance** para o `metrics.py`.
- P0/P1 não emitidos deliberadamente: nenhum baseline numérico defensível apontou risco de incidente em produção — o pior caso é 1 ciclo semanal sem métrica, e a migration em si é read-only + idempotente + testada em Postgres 17 descartável.
