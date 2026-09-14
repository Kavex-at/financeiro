---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-fault-tolerance
generated_at: 2026-09-14T16:24:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Ledger mutations do runtime (`deleteByBorCod`, `deleteByKey`, `deleteByBorCodInvoice`, cancelamento/estorno de borderô assíncrono) + boot do serviço aplicando `0058_vw_metricas_ciclo.sql` | (a) linha da tentativa é APAGADA depois de já ter sido reportada; (b) `permuta_bordero` (cache) atrasa em relação ao ERP; (c) migration falha em `CREATE ROLE`/`ALTER ROLE`/`GRANT` em produção | `metricas.metricas_ciclo(serie, agora)` + `metricas.vw_metricas_ciclo` + role `metricas_ciclo_leitor` + `BootMigrator` (via `runMigrations.ts`) | Boot em produção (Render → Supabase) e leitura periódica pelo `metrics.py` fora do produto | O boot deve morrer OU aplicar tudo; a view NUNCA deve emitir % com denominador zero; janelas em curso NÃO devem sair; o leitor deve falhar `permission denied` em qualquer coisa fora da vigente/view; janela passada pode divergir entre ciclos, mas o report congela o número lido | 0 divergências no cross-check contra ledger vivo (12 janelas × 4 métricas = 48 comparações — fonte `_shared-metrics.md`); 13 testes de integração verdes; 9 guardas estáticas verdes; nenhum backfill anterior à série 2026-09-11 20:00 |

> Leitura de negócio: o report semanal congela o número no ciclo em que leu (`ADR-0045` §Consequências). Divergência retroativa é **política aceita**, não bug; o que importa é (i) não inflar `concluidas` por cache estagnado, (ii) não deixar o boot preso, e (iii) não emitir número com cara de fechado sobre semana em curso.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| DML na migration `0058` (fora de comentário) | 0 | 0 | ✅ | `vwMetricasCiclo.test.ts` guarda estática (regex `\b(INSERT\|UPDATE\|DELETE\|TRUNCATE)\b`) |
| Idempotência da migration (reaplicar é no-op) | comprovada | comprovada | ✅ | `vwMetricasCiclo.integration.test.ts:218` (`reaplicar a migration é no-op`) |
| Janelas em curso emitidas pela view | 0 | 0 | ✅ | `0058_vw_metricas_ciclo.sql:96` (`p_agora - INTERVAL '7 days'`) + integração `emite só janelas fechadas` |
| Divergência entre view e consulta independente | 0 em 48 comparações | 0 | ✅ | `_shared-metrics.md` (validação read-only contra ledger vivo) |
| `%` emitido com denominador zero | 0 | 0 | ✅ | `sql:159,188` (`WHERE p.tentativas > 0` / `WHERE r.tentativas > 0`) + integração `semana sem tentativa: nenhum %` |
| Backfill anterior à série (2026-09-11 20:00) | 0 janelas | 0 | ✅ | `sql:95,237` (`p_serie_inicio` = TIMESTAMP fixo); guarda estática `a série começa no ciclo 6 — sem backfill` |
| Testes de integração cobrindo o comportamento do runtime | 13/13 verdes | ≥ 10 | ✅ | `_shared-metrics.md` (Postgres 17-alpine descartável) |
| Mutação de fronteira `< janela_fim`→`<=` derruba integração | 2 testes | ≥ 1 | ✅ | `_shared-metrics.md` (prova que o teste de fronteira é discriminante) |
| Statement timeout no role leitor | 30s | ≤ 60s | ✅ | `sql:267` (`ALTER ROLE metricas_ciclo_leitor SET statement_timeout = '30s'`) |
| `search_path` explícito nas funções (evita hijack de resolução) | `''` (ambas) | `''` | ✅ | `sql:90,232` |
| Rows `settled` cuja tentativa pode desaparecer se o borderô for excluído (`deleteByBorCod`) | 190 rows em `permuta_alocacao_execucao` (177 settled + 13 error) — todas passíveis de `DELETE FROM ... WHERE bor_cod = $borCod` no fluxo `BorderoGestaoService.excluirBordero:201` | 0 mutação silenciosa de janela passada | ⚠️ | `_shared-metrics.md` (contagem de linhas em produção) + `PermutaExecucaoRepository.ts:210-215` (`deleteByBorCod`) + `BorderoGestaoService.ts:201` |
| Rows `settled` já em borderô CANCELADO no snapshot 2026-09-14 | 20 rows / R$ 3,03 mi | 0 baixas em cancelado contadas no numerador | ✅ (fórmula `desfeita` desconta) | `_shared-metrics.md` + `sql:117-123` (`bor_vld_finalizado = 2 OR bor_cod_estornado IS NOT NULL`) |
| Detecção de staleness do cache `permuta_bordero` | ausente | job/heurística que alerte se cache defasado > N h | ❌ | grep negativo por freshness check em `sql` da view e em `BorderoGestaoService.ts` |
| Comparação append-only entre leituras sucessivas do mesmo ciclo | ausente | ≥ 1 (evento persistido por leitura) | ❌ | grep `metricas`, `report_ciclo` em `src/backend/migrations/*.sql` — não há tabela de eventos |
| Boot morre se `runner.run()` falhar | sim (política) | sim | ✅ | `BootMigrator.ts:60-81` |
| `CREATE ROLE`/`ALTER ROLE ... SET`/`GRANT` no mesmo arquivo da migration de aplicação | sim (4 statements de role) | idealmente separados do DDL de aplicação | ⚠️ | `sql:258-271` |

> ⚠️ **Não medível localmente**: probabilidade real de o `postgres` do Supabase falhar em `CREATE ROLE`. Requer produção. Recomendação: rodar `SELECT has_database_privilege(current_user, current_database(), 'CREATE')` + `SHOW is_superuser` e `SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user` no boot antes de aplicar `0058` e falhar com mensagem explícita se faltar `CREATEROLE`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** | Migration mistura DDL de aplicação (schema/função/view) com bootstrap de role global (`CREATE ROLE`). Não há substituto para o caso de falta de `CREATEROLE`. | ⚠️ parcial | `0058_vw_metricas_ciclo.sql:258-271` |
| **Replacement** | N/A — read-model sem redundância física; irrelevante para uma view derivada. | N/A | — |
| **Predictive Model** | Sem previsão de defasagem de `permuta_bordero`; não há heurística que estime quantas baixas do cache podem estar realmente canceladas no ERP. | ❌ ausente | grep negativo em `sql`/serviço |
| **Increase Competence Set** | O cross-check contra o ledger vivo (12×4=48) ampliou o envelope antes do merge. Reduziu a região de operação incerta. | ✅ presente | `_shared-metrics.md` (validação read-only) |
| **Sanity Checking** | Estática (9 guardas) + integração (13 casos) + guarda contra denominador zero. Falta guarda de **frescor** do cache `permuta_bordero`. | ⚠️ parcial | `vwMetricasCiclo.test.ts`; `sql:159,188`; ausente para freshness |
| **Comparison** | Cross-check `view == função com now() convertido` (integração `linha 208`). Não há comparação **entre execuções sucessivas** do mesmo ciclo — a política é "o report congela". | ⚠️ parcial | `vwMetricasCiclo.integration.test.ts:208-216` |
| **Timestamp** | `janela_inicio`/`janela_fim` são `timestamp` sem fuso (sessão UTC); atribuição pelo `criado_em` (imutável — `DEFAULT now()` na migration `0015`, nunca reescrito nos upserts `beginExecution`/`markSettled`/`markError`). | ✅ presente | `sql:83-84`; `0015_permuta_alocacao_execucao.sql:33`; `PermutaExecucaoRepository.ts:272-292` (`ON CONFLICT DO UPDATE` sem tocar `criado_em`) |
| **Timeout** | Role `metricas_ciclo_leitor` com `statement_timeout = '30s'`. | ✅ presente | `sql:267` |
| **Condition Monitoring** | Não há job que verifique se `permuta_bordero` (cache) está sincronizado com o ERP; se o cache atrasar, `desfeita` fica `false` e a janela infla `concluidas`. | ❌ ausente | grep negativo por monitoramento de cache em `src/backend/jobs/` |
| **Self-Test** | 9 guardas estáticas + 13 casos de integração; guardas de escopo (leitor recusado em tabela de origem, na função parametrizada, e em DDL). | ✅ presente | `vwMetricasCiclo.test.ts`; `vwMetricasCiclo.integration.test.ts:257-275` |
| **Voting** | N/A — read-model determinístico sobre única fonte. | N/A | — |
| **Redundancy** | N/A — nenhum replay/replica esperado. | N/A | — |
| **Recovery (forward)** | `IF NOT EXISTS` no CREATE SCHEMA/CREATE ROLE + `CREATE OR REPLACE` em função/view + `ALTER ROLE ... SET` idempotente. Re-boot re-tenta migration inteira; se o problema for permissão, o loop de falha é o próprio "forward recovery" (com custo: instância parada). | ✅ presente (parcial no custo) | `sql:73,257-263`; `BootMigrator.ts:60-81`; `MigrationRunner.run` só INSERT em `schema_migrations` após sucesso da transação (`runMigrations.ts:73-79`) |
| **Recovery (backward)** | Não há rollback específico. Convenção do projeto: rollbacks vivem em `migrations/rollbacks/*.rollback.sql`; para `0058` não foi escrito rollback. | ⚠️ parcial | `runMigrations.ts:41-45`; `migrations/rollbacks/` (ausência do `0058.rollback.sql`) |
| **Reintroduction (Shadow / State Resync / Escalating Restart)** | Boot repete a migration; sem shadow. Reaplicar é no-op comprovado. | ✅ presente | `vwMetricasCiclo.integration.test.ts:218-222` |
| **Rollback** | Um DELETE do ledger APAGA a tentativa de uma semana passada. NÃO há evento append-only preservando o snapshot. A mitigação é procedural ("o report congela o número no ciclo em que o leu" — ADR-0045). | ⚠️ parcial | `PermutaExecucaoRepository.ts:180-215` (`deleteByBorCod*`, `deleteByKey`); ADR-0045 §Consequências |
| **Repair State** | N/A — read-model. O reparo pertence ao ledger de origem. | N/A | — |
| **Idempotent Replay** | Migration inteira é idempotente por construção (`IF NOT EXISTS`, `CREATE OR REPLACE`, `REVOKE/GRANT` re-executáveis, `ALTER ROLE ... SET` idempotente). | ✅ presente | `sql:71` (cabeçalho declara); `vwMetricasCiclo.integration.test.ts:218` |
| **Compensating Transaction** | N/A — leitura pura. | N/A | — |
| **Reconcile** | N/A — a view É a reconciliação sobre o ledger; a spine (`recebimento*`) foi rejeitada em D1 justamente porque não bate com o operado. | N/A | ADR-0045 D1 |
| **Quarantine** | O role nasce `NOLOGIN` na migration (senha é passo humano). Enquanto ninguém rodar o `ALTER ROLE ... WITH LOGIN PASSWORD`, o alcance é zero — quarentena por construção. | ✅ presente | `sql:260,265-271`; guarda `senha não entra em migration` (`vwMetricasCiclo.test.ts:93-99`) |

## 4. Findings (achados)

### F-fault-tolerance-1: Rollback silencioso — `DELETE` no ledger apaga a tentativa de uma semana já reportada

- **Severidade**: P2 (débito técnico defensável — política aceita em ADR-0045, mitigação é procedural)
- **Tactic violada**: Rollback (sem append-only event log) + Timestamp (evento não-preservado)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:176-215` (`deleteByBorCodInvoice`, `deleteByBorCod`, `deleteByKey`); consumido em `src/backend/domain/service/permutas/BorderoGestaoService.ts:134,201`; a view lê o ledger vivo em `src/backend/migrations/0058_vw_metricas_ciclo.sql:100-129`
- **Evidência (objetiva)**:
  ```
  # PermutaExecucaoRepository.ts:210-215
  public deleteByBorCod = async (borCod: number): Promise<number> => {
      return this.databaseClient.update(
          `DELETE FROM permuta_alocacao_execucao WHERE bor_cod = $borCod`,
          { borCod },
      );
  };
  # BorderoGestaoService.ts:201
  await this.execucaoRepository.deleteByBorCod(borCod); // limpa a trilha (no-op se não houver)
  ```
- **Impacto técnico**: Ao excluir um borderô no ERP via plataforma, as linhas da trilha desaparecem. A view, que lê o estado ATUAL do ledger, passa a devolver, para a mesma janela, valores menores de `tentativas` e `concluidas`. Diferente do fluxo CANCELADO/ESTORNADO (que a fórmula `desfeita` preserva no denominador), o `DELETE` remove a evidência sem deixar rastro.
- **Impacto de negócio**: Se dois ciclos de report lerem o mesmo `--inicio`/`--fim` de uma semana passada em datas diferentes, os números podem divergir. ADR-0045 aceita isso e delega ao processo humano ("o report congela o número no ciclo em que o leu"). O risco residual é reprocessar o report do ciclo passado (auditoria, retrospectiva) e obter número diferente sem alerta.
- **Métrica de baseline**: 190 linhas em `permuta_alocacao_execucao` (177 `settled` + 13 `error`), TODAS elegíveis a `DELETE` caso o borderô associado seja excluído no fluxo `excluirBordero`. Nenhuma tabela de eventos append-only registra o snapshot dos ciclos anteriores.

### F-fault-tolerance-2: Cache `permuta_bordero` estagnado pode inflar `concluidas` sem detecção

- **Severidade**: P2 (débito técnico — a plataforma refresca em ações próprias, mas cancelamento nativo do Conexos só chega ao cache no próximo "Atualizar")
- **Tactic violada**: Condition Monitoring (frescor do cache) + Sanity Checking (validação da fonte da fórmula `desfeita`)
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:117-123`; `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:446-482` (leitura do cache); `src/backend/domain/service/permutas/BorderoGestaoService.ts:224,244` (`updateBorderoCacheSituacao` — o cache é atualizado por ação, não por poller de frescor)
- **Evidência (objetiva)**:
  ```
  # sql:117-123 — a fórmula `desfeita` LÊ o cache
  EXISTS (
      SELECT 1 FROM public.permuta_bordero b
      WHERE b.fil_cod = x.fil_cod AND b.bor_cod = x.bor_cod
        AND (b.bor_vld_finalizado = 2 OR b.bor_cod_estornado IS NOT NULL)
  ) AS desfeita
  # gap G2 (ontology/_inbox/metricas-ciclo-gap.md:36):
  "O `permuta_bordero` é cache: se a sincronização atrasar, o cancelamento demora a aparecer."
  ```
- **Impacto técnico**: Um borderô cancelado no Conexos (fora da plataforma) só entra em `permuta_bordero` com `bor_vld_finalizado = 2` no próximo refresh. Enquanto o cache mostra `1` (finalizado vivo), a fórmula considera a baixa como "não desfeita" — o numerador da janela é inflado silenciosamente, sem qualquer alerta.
- **Impacto de negócio**: Uma taxa `permutas_baixas_concluidas_pct` de uma semana passada pode subir por atraso de sincronização (não por trabalho real). O report do ciclo posterior corrige silenciosamente, sem que fique claro o que mudou.
- **Métrica de baseline**: Hoje em produção (snapshot 2026-09-14), 20 baixas / R$ 3,03 mi já vivem em borderôs CANCELADOS **conforme o cache**. Não há medição de quantos borderôs cancelados no ERP ainda não desceram ao cache — a lacuna de instrumentação é o achado. Zero jobs em `src/backend/jobs/` monitoram idade máxima de `permuta_bordero.bor_dta_mvto` em relação a `now()`.

### F-fault-tolerance-3: Boot acoplado a `CREATE ROLE`/`ALTER ROLE`/`GRANT` — falha de `CREATEROLE` no boot user derruba o serviço

- **Severidade**: P2 (impacto de boot; mitigável mas não coberto)
- **Tactic violada**: Substitution (isolar bootstrap de role global do DDL de aplicação) + Recovery Forward (política de "boot morre" acoplada a operação que exige privilégio distinto)
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:257-271`; consumido em `src/backend/migrations/runMigrations.ts:70-79` (a migration inteira roda numa transação implícita do simple-query) e `src/backend/migrations/BootMigrator.ts:60-81` (falha → boot morre)
- **Evidência (objetiva)**:
  ```
  # sql:257-271
  DO $$
  BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metricas_ciclo_leitor') THEN
          CREATE ROLE metricas_ciclo_leitor NOLOGIN;
      END IF;
  END $$;
  ALTER ROLE metricas_ciclo_leitor SET default_transaction_read_only = on;
  ALTER ROLE metricas_ciclo_leitor SET search_path = metricas;
  ALTER ROLE metricas_ciclo_leitor SET statement_timeout = '30s';
  GRANT USAGE ON SCHEMA metricas TO metricas_ciclo_leitor;
  GRANT EXECUTE ON FUNCTION metricas.metricas_ciclo_vigente() TO metricas_ciclo_leitor;
  GRANT SELECT ON metricas.vw_metricas_ciclo TO metricas_ciclo_leitor;
  ```
- **Impacto técnico**: Se o `postgres` do Supabase (ou qualquer role que o `PostgreeDatabaseClient` use como boot user) perder `CREATEROLE`, a migration aborta a transação, `schema_migrations` não recebe `0058` e o próximo boot re-executa o mesmo arquivo → mesma falha. Não é loop de retry silencioso: é loop de boot fatal. `BootMigrator.ts:60-81` propaga o erro; `index.ts` não faz `listen()`. `MigrationRunner.run` (linha 74) só grava `schema_migrations` depois do `SET LOCAL ... + DDL` como statement único, então ou tudo aplica ou nada aplica — sem estado inconsistente, mas com serviço parado.
- **Impacto de negócio**: Blackout na aplicação nova enquanto o problema não for diagnosticado. Como o report semanal é lido offline por um script fora do produto, um blackout no serviço financeiro afetaria os quatro fluxos operacionais (Permutas, SISPAG, GED, Recebimentos) — não só a leitura do report.
- **Métrica de baseline**: 4 statements de role global na migration; 3 grants; 0 pré-checagem de privilégio antes do DDL; 0 mensagem de erro específica no `BootMigrator.ts` para o caso "faltou `CREATEROLE`".

### F-fault-tolerance-4: Ausência de rollback script para `0058` (convenção do projeto)

- **Severidade**: P3 (melhoria — a migration é aditiva e o esquema `metricas` é isolado, então o rollback manual é trivial; ainda assim a convenção existe)
- **Tactic violada**: Recovery (backward)
- **Localização**: `src/backend/migrations/rollbacks/` (ausência do arquivo `0058_vw_metricas_ciclo.rollback.sql`); convenção descrita em `src/backend/migrations/runMigrations.ts:41-45`
- **Evidência (objetiva)**:
  ```
  # runMigrations.ts:41-45
  # "Scripts de reverse vivem em `migrations/rollbacks/*.rollback.sql`
  # justamente porque um arquivo `.sql` solto neste diretório seria aplicado no boot seguinte."
  ```
- **Impacto técnico**: Sem o script de rollback junto ao merge, um estorno emergencial vira SQL improvisado — `DROP SCHEMA metricas CASCADE` + `DROP OWNED BY metricas_ciclo_leitor` + `DROP ROLE metricas_ciclo_leitor` + `DELETE FROM schema_migrations WHERE name = '0058_vw_metricas_ciclo.sql'`. Não é difícil, mas hoje é conhecimento tácito.
- **Impacto de negócio**: Baixo. Tempo extra em incidente hipotético (medir em minutos, não em horas).
- **Métrica de baseline**: 0 arquivos `0058_*.rollback.sql` em `src/backend/migrations/rollbacks/`. A migration `0054` tem rollback correspondente — o padrão foi seguido antes.

## 5. Cards Kanban

### [fault-tolerance-1] Registrar snapshot append-only por leitura do report

- **Problema**
  > Um `DELETE` no ledger de permutas (`deleteByBorCod`, `deleteByKey`, `deleteByBorCodInvoice`) apaga a tentativa de uma semana passada. Se o mesmo ciclo for lido de novo (auditoria, retrospectiva), o número muda em silêncio. ADR-0045 aceita a divergência e delega ao humano ("o report congela"), mas hoje não há evidência persistida do que foi lido em cada ciclo.

- **Melhoria Proposta**
  > Criar tabela append-only `metricas.metricas_ciclo_leituras (id, gerado_em, agora_usado, serie_inicio, payload jsonb)` e uma função `metricas.registrar_leitura(agora timestamp)` que INSERT-a o resultado corrente. `kavex-report-ciclo/metrics.py` chama a função em vez de `SELECT * FROM vw_metricas_ciclo` (ou chama as duas: uma para o texto do ciclo, outra para o histórico). Tactic Bass: **Rollback** (snapshot append-only) + **Timestamp** (evento preservado). Arquivos: nova migration `0059_metricas_leituras.sql` e ajuste no script externo (`kavex-report-ciclo/scripts/metrics.py`).

- **Resultado Esperado**
  > Reprocessar o report de um ciclo passado devolve o número gravado naquele ciclo, não o estado atual do ledger. Cross-QA: overlap direto com Testability (fixture de regressão) e Security (auditabilidade).

- **Tactic alvo**: Rollback + Timestamp
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Leituras registradas por ciclo: 0 → ≥ 1 por execução do `metrics.py`
  - Divergência entre leituras sucessivas do mesmo ciclo: hoje detectável só ao acaso → detectável por diff em `metricas_ciclo_leituras`
- **Risco de não fazer**: Auditoria de retrospectiva encontra número diferente do reportado no ciclo original e ninguém consegue explicar. Perda de credibilidade da Seção 3 do report.
- **Dependências**: Nenhuma dentro do repo (o append-only não interfere no ledger).

### [fault-tolerance-2] Detectar defasagem do cache `permuta_bordero` antes de emitir o report

- **Problema**
  > A fórmula `desfeita` da view lê `permuta_bordero` (cache). Se um borderô for cancelado no ERP fora da plataforma, o cache atrasa; enquanto isso, a baixa cai no numerador como "concluída". Sem detecção, uma taxa sobe silenciosamente por defasagem de sincronização (não por trabalho real).

- **Melhoria Proposta**
  > Emitir uma métrica adicional (canal separado ou coluna extra, sem quebrar as 9 colunas do contrato) que exponha a **idade máxima** do refresh do cache dentro da janela: `MAX(now() - permuta_bordero.atualizado_em)` (ou a coluna equivalente do cache). O `metrics.py` decide se a idade está aceitável antes de imprimir a taxa. Alternativa complementar: job que, ao detectar `atualizado_em` > N h em qualquer linha de `permuta_bordero` referenciada por `permuta_alocacao_execucao` `settled` das últimas 4 semanas, dispara refresh. Tactic Bass: **Condition Monitoring** + **Sanity Checking**. Arquivos: migration nova (`metricas.frescor_cache_permuta_bordero(...)`) e/ou job em `src/backend/jobs/`.

- **Resultado Esperado**
  > Antes de emitir a taxa, o script tem sinal explícito de "cache OK / cache defasado H horas". Hoje: sinal 0.

- **Tactic alvo**: Condition Monitoring + Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para a métrica de idade; M para o job de refresh proativo
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Idade máx. do cache exposta ao `metrics.py`: hoje ausente → visível por janela
  - Falsos positivos "concluída" causados por cache estagnado: hoje sem medição → mensurável
- **Risco de não fazer**: Taxa de concluídas oscilando por atraso de refresh, sem rastreabilidade.
- **Dependências**: Discussão em `_inbox/metricas-ciclo-gap.md` (G2, ainda em aberto).

### [fault-tolerance-3] Pré-checar `CREATEROLE` no boot; se faltar, falhar com mensagem clara e opção de skip

- **Problema**
  > A migration `0058` emite `CREATE ROLE` e `ALTER ROLE ... SET` dentro do fluxo de boot. Se o boot user perder `CREATEROLE` no Supabase (ou em qualquer futuro tenant), a migration inteira aborta, `schema_migrations` não recebe o registro, e o serviço não sobe. O erro apareceria como stack trace do driver, não como diagnóstico acionável.

- **Melhoria Proposta**
  > No `BootMigrator.run` (ou num pré-check dedicado que rode antes do `runner.run()`), fazer `SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user`. Se `false`, emitir mensagem explícita ("`0058` precisa de `CREATEROLE` no usuário `<...>`; ou conceda, ou aplique manualmente e insira `0058_vw_metricas_ciclo.sql` em `schema_migrations`"). Alternativa arquitetural: separar `0058_vw_metricas_ciclo.sql` (DDL de aplicação) de `0058b_metricas_role_bootstrap.sql` (role global), com o segundo protegido por um env `APPLY_METRICAS_ROLE=1` — para o caso em que o boot user não pode criar role e o operador precisa aplicar à mão. Tactic Bass: **Substitution** + **Sanity Checking**.

- **Resultado Esperado**
  > Falha por privilégio insuficiente vira mensagem de operador em vez de crash do driver. Blackout evitável.

- **Tactic alvo**: Substitution + Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Pré-checks de privilégio de role no boot: 0 → 1
  - Mensagens de operador com remediação explícita em falhas conhecidas de boot: hoje 1 (env local com banco remoto) → 2
- **Risco de não fazer**: Numa migração de tenant, o serviço fica parado até alguém correlacionar o stack trace com privilégio faltando.
- **Dependências**: Nenhuma.

### [fault-tolerance-4] Adicionar `rollbacks/0058_vw_metricas_ciclo.rollback.sql`

- **Problema**
  > A convenção do projeto (`runMigrations.ts:41-45`) coloca reverses em `migrations/rollbacks/*.rollback.sql`, e migrations anteriores seguem o padrão (ex.: `0054`). A `0058` não tem rollback correspondente.

- **Melhoria Proposta**
  > Escrever `src/backend/migrations/rollbacks/0058_vw_metricas_ciclo.rollback.sql` com: `REVOKE`s explícitos, `DROP VIEW`/`DROP FUNCTION` na ordem inversa, `DROP OWNED BY metricas_ciclo_leitor`, `DROP ROLE metricas_ciclo_leitor`, `DROP SCHEMA metricas` e `DELETE FROM schema_migrations WHERE name = '0058_vw_metricas_ciclo.sql'`. Nenhum impacto no runtime; é conhecimento tácito virando texto executável. Tactic Bass: **Recovery (backward)**.

- **Resultado Esperado**
  > Rollback emergencial vira aplicar um arquivo, não improviso.

- **Tactic alvo**: Recovery (backward)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Cobertura de rollback nas migrations 0054+: hoje `0054` sim, `0055–0058` variando → 100% de rollback disponível
- **Risco de não fazer**: Em incidente, minutos a mais para escrever o SQL na hora. Baixo, mas evitável.
- **Dependências**: Nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta `14ca71a..HEAD` (`0058_vw_metricas_ciclo.sql` + testes + ADR-0045). O ledger de origem (`permuta_alocacao_execucao`, `solicitacao_numerario_execucao`) foi lido apenas para explicar o comportamento da view em face de mutação — não emiti findings sobre o ledger em si, pois é dívida pré-existente.
- Nenhum finding atinge P0/P1: o delta é read-model idempotente, com integração contra Postgres real, cross-check contra o ledger vivo (48 comparações, 0 divergência) e política declarada de "número congela no ciclo". Os quatro riscos residuais têm baseline numérica e ficam em P2/P3.
- Cross-QA: **Testability** (o append-only F-1 e o pré-check F-3 pedem testes novos); **Security** (F-1 fortalece auditabilidade — quem leu, quando, o quê); **Availability** (F-3 é literalmente boot uptime); **Integrability** (F-2 toca o contrato com `kavex-report-ciclo/metrics.py`, ainda que sem quebrar as 9 colunas).
- Métrica que **tentei** e não pude coletar: probabilidade real de falha em `CREATE ROLE` no Supabase produção — declarada como "não medível localmente" no §2.
