---
qa: Performance
qa_slug: performance
run_id: 2026-09-14-1624-metricas-ciclo
agent: qa-performance
generated_at: 2026-09-14T16:24:00-03:00
scope: backend
score: 9
findings_count: 2
cards_count: 1
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| `kavex-report-ciclo/scripts/metrics.py` (consumidor externo, cron semanal) | `SELECT ... FROM vw_metricas_ciclo` (1 leitura por ciclo) | função SQL `metricas.metricas_ciclo(serie, agora)` + view `metricas.vw_metricas_ciclo` sobre `permuta_alocacao_execucao`, `solicitacao_numerario_execucao` e `permuta_bordero` no Postgres 17 (Supabase) | operação normal; ledger cresce ~200 linhas/mês em `permuta_alocacao_execucao` (190 linhas em ~3 meses desde 0015) e cadência de leitura fixa | enumerar janelas semanais fechadas desde 2026-09-11 20:00 (ciclo 6), agregar duas frentes, devolver ≤ (2 métricas × 2 frentes × N semanas) linhas | p95 da leitura < 5 s no horizonte de 3 anos (janelas × linhas do ledger); teto duro de 30 s garantido pelo `statement_timeout` do role leitor |

Contexto essencial que baliza toda a análise: **este caminho é 1× por semana, executado por um consumidor fora do web hot path**. Não bloqueia analista, não segura fila SQS, não dispara em API Gateway. Toda severidade P0/P1 exigiria degradação mensurável em cima disso, o que não aparece.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Volume `permuta_alocacao_execucao` | 190 linhas (177 settled, 13 error) | — (baseline; teto operacional ~50 k linhas antes de forçar índice) | ✅ | `_shared-metrics.md` §Contexto de produção |
| Volume `solicitacao_numerario_execucao` | 23 linhas reais | idem | ✅ | `_shared-metrics.md` §Contexto de produção |
| Cadência de leitura da view | 1× por semana | — | ✅ | cabeçalho `0058_vw_metricas_ciclo.sql:2-8` + ADR-0045 |
| Bound de execução (statement_timeout do leitor) | 30 s | ≤ 30 s (Bass: Bound Execution Times) | ✅ | `src/backend/migrations/0058_vw_metricas_ciclo.sql:267` |
| Janelas em generate_series (hoje, 2026-09-14) | 0 janelas fechadas (série começa 2026-09-11 20:00; primeira janela fecha 2026-09-18 20:00) | — | ✅ | leitura de `0058_vw_metricas_ciclo.sql:92-99` + data corrente |
| Janelas em generate_series (horizonte 3 anos) | ~156 janelas | limitado por design a 52/ano | ✅ | aritmética sobre `INTERVAL '7 days'` (`0058_vw_metricas_ciclo.sql:97`) |
| Índices sobre `permuta_alocacao_execucao.criado_em` | 0 | não requerido a 190 linhas | ✅ | `0015_permuta_alocacao_execucao.sql:38-41`, `0019_permuta_perf_indexes.sql:6-11` |
| Índices sobre `permuta_alocacao_execucao.dry_run` | 0 (filtro `dry_run = false` recai em seq scan) | não requerido a 190 linhas | ⚠️ P3 no horizonte 50 k+ | mesma fonte |
| Índices sobre `solicitacao_numerario_execucao.criado_em` / `dry_run` | 0 / 0 | idem | ⚠️ P3 no horizonte 50 k+ | `0041_solicitacao_numerario_execucao.sql:36-37`, `0042/0048_*_idx_*` |
| PK/índice usado pelo EXISTS de `permuta_bordero` | PK composta `(fil_cod, bor_cod)` | seek index (esperado) | ✅ | `0020_permuta_bordero_filial_pk.sql:11-12` |
| Materialização da view | nenhuma (view lê função STABLE a cada SELECT) | não requerida a 1 leitura/semana | ✅ | `0058_vw_metricas_ciclo.sql:244-255` |
| `search_path`, qualificação `pg_catalog.` / `public.` | vazio + tudo qualificado | zero overhead de resolução | ✅ | `0058_vw_metricas_ciclo.sql:90, 111-142, 232` |
| Novas dependências (bundle) | 0 | 0 | ✅ | `_shared-metrics.md` §Dependências |
| Latência estimada em 3 anos (156 janelas × ~20 ms/scan a 19 k linhas) | ~50–200 ms | < 5 s p95 | ✅ (via extrapolação linear do seq scan) | análise sobre volume observado |

> ⚠️ **Não medível localmente**: latência real p50/p95 do `SELECT` em produção. Requer `pg_stat_statements` ou instrumentação do `metrics.py`. Recomendação: como o consumidor é externo, o próprio `metrics.py` já pode registrar `SELECT clock_timestamp()` antes/depois; se algum dia o número extrapolar 5 s, cria-se o card `performance-1` proposto abaixo.

## 3. Tactics — Cobertura no nf-projects

Bass & Clements — Control Resource Demand + Manage Resources.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: a agregação é exata sobre um universo pequeno; não há stream a amostrar. | N/A | — |
| Limit Event Response | Cardinalidade de saída limitada por `generate_series` + `WHERE tentativas > 0` para as métricas de %. Também: a série é fixada por `metricas_ciclo_vigente()` — o leitor não pode recuar o início e explodir o volume de janelas. | ✅ | `0058_vw_metricas_ciclo.sql:92-99, 232-240` |
| Prioritize Events | N/A: única classe de evento (leitura semanal). | N/A | — |
| Reduce Overhead | Duas CTEs (`permutas`, `recebimentos`) fazem UM único scan filtrado por tabela, agregado por janela via `LEFT JOIN`. UNION ALL projeta 4 séries sem re-scan. `search_path` vazio + qualificação removem lookups. Filtros `dry_run = false` e `WHERE tentativas > 0` cortam trabalho a jusante. | ✅ | `0058_vw_metricas_ciclo.sql:100-201` |
| Bound Execution Times | `statement_timeout = 30 s` no role `metricas_ciclo_leitor` (`ALTER ROLE ... SET`, aplicado por-sessão porque o `SET` não é herdado — comentário do cabeçalho da migration está correto). | ✅ | `0058_vw_metricas_ciclo.sql:267` |
| Increase Resource Efficiency | (a) EXISTS correlacionado casa com PK composta `(fil_cod, bor_cod)` — index seek O(1) por linha. (b) função marcada `STABLE`: permite ao planejador cache/otimização entre chamadas dentro da mesma statement. (c) `FILTER (WHERE ...)` de agregado evita subquery ou JOIN adicional. | ✅ | `0058_vw_metricas_ciclo.sql:88-90, 104-109, 117-123` |
| Increase Resources | N/A: caminho não-crítico; não faz sentido escalar Postgres para uma leitura semanal. | N/A | — |
| Increase Concurrency | N/A: um consumidor único. | N/A | — |
| Maintain Multiple Copies of Computations | View **não é materializada**. Decisão deliberada (leitura semanal + janela em curso deve refletir estado atual do ledger). Cache de nível superior fica com o `metrics.py` (que congela o número por ciclo). | ✅ | `0058_vw_metricas_ciclo.sql:244-255` + cabeçalho `0058_vw_metricas_ciclo.sql:40-42` |
| Maintain Multiple Copies of Data | N/A: sem denormalização; agregação é sobre o próprio ledger. `permuta_bordero` já é um cache do ERP e é reutilizado — reduz custo do EXISTS por não bater no Conexos. | ✅ | `0018_permuta_bordero_cache.sql:1-15` |
| Bound Queue Sizes | N/A: sem fila. | N/A | — |
| Schedule Resources | Consumidor externo agenda-se; o Postgres serve on-demand. | ✅ | ADR-0045 |
| **Cold-start budget** (modernidade) | N/A: sem Lambda no delta (repo ainda é Express); função SQL não paga custo de frio. | N/A | — |
| **Cache strategy** | Sem cache no BD; o `metrics.py` "congela o número no ciclo em que o leu" (cabeçalho da migration). Adequado à cadência. | ✅ | `0058_vw_metricas_ciclo.sql:40-42` |
| **Index discipline** | Boa para o EXISTS (PK composta). Ausente para os predicados `dry_run = false` + range `criado_em AT TIME ZONE 'America/Sao_Paulo'` — irrelevante a 190/23 linhas; ver F-performance-1. | ⚠️ parcial | `0015_permuta_alocacao_execucao.sql:38-41`, `0041_solicitacao_numerario_execucao.sql:36-37`, `0058_vw_metricas_ciclo.sql:124-128, 139-142` |
| **Bundle leanness** | Delta introduz 0 dependências novas (`_shared-metrics.md`). | ✅ | `_shared-metrics.md` §Dependências |

## 4. Findings (achados)

### F-performance-1: `AT TIME ZONE` no predicado de junção fecha a porta para índice em `criado_em` — irrelevante hoje, custa uma cirurgia se o ledger crescer 100×

- **Severidade**: P3 (baixo — projeção quantificada mostra folga confortável dentro do `statement_timeout` mesmo no horizonte de 3 anos)
- **Tactic violada**: Increase Resource Efficiency (parcial); Index Discipline
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:115-116, 124-128, 141-142`
- **Evidência (objetiva)**:
  ```sql
  x.criado_em AT TIME ZONE 'America/Sao_Paulo' AS criado_local,
  ...
  ON e.criado_local >= j.janela_inicio
 AND e.criado_local <  j.janela_fim
  ```
  E, no lado recebimentos, o mesmo padrão inline. Nenhum índice em `permuta_alocacao_execucao.criado_em` nem em `solicitacao_numerario_execucao.criado_em` (verificado em `0015`, `0019`, `0041`, `0042`, `0048`). O `AT TIME ZONE` fabrica uma expressão nova a cada linha — mesmo que existisse um índice sobre `criado_em` cru, o planejador não o usaria para este range.
- **Impacto técnico**: hoje, seq scan sobre 190 linhas (permutas) + 23 (recebimentos) é ~sub-ms. Extrapolação linear: a 19 000 linhas (100×, ~5 anos ao ritmo observado de ~200/mês), o scan sobe para ~20 ms; com 156 janelas em 3 anos, o join custo total ~3 s (bem dentro dos 30 s do `statement_timeout`). Só a partir de ~200 000 linhas na `permuta_alocacao_execucao` (~50×–100× do ritmo atual) o SELECT começa a raspar o teto.
- **Impacto de negócio**: nenhum no horizonte de 12–36 meses. O risco é silencioso: um dia o `metrics.py` retorna nada porque bateu no timeout, e ninguém liga a causa a esta migration. O `default_transaction_read_only` + `statement_timeout` protegem contra corrupção/deadlock, mas o report "cai" sem alarme.
- **Métrica de baseline**: 190 linhas em `permuta_alocacao_execucao` × ~200 linhas/mês (crescimento observado desde 0015) → projeção 3 anos ≈ 7 400 linhas; 5 anos ≈ 12 200 linhas. Ambos confortáveis. Gatilho para agir: `permuta_alocacao_execucao` cruzar 50 000 linhas **ou** latência p95 do SELECT ultrapassar 3 s.

### F-performance-2: view não materializada — decisão correta, mas não documentada como decisão de performance

- **Severidade**: P3 (baixo — é a decisão certa; falta a marca de "decisão consciente" para o próximo mantenedor)
- **Tactic violada**: Maintain Multiple Copies of Computations (não-uso deliberado)
- **Localização**: `src/backend/migrations/0058_vw_metricas_ciclo.sql:244-255`
- **Evidência (objetiva)**:
  ```sql
  CREATE OR REPLACE VIEW metricas.vw_metricas_ciclo AS
  SELECT ... FROM metricas.metricas_ciclo_vigente() AS m;
  ```
  A view chama a função a cada SELECT. Nada no cabeçalho da migration explica "por que não `MATERIALIZED VIEW`" — o texto é rico sobre segurança (`SECURITY DEFINER`, `search_path`, GRANTs) e correção (janela em curso, TZ, borderô cancelado), mas silencioso sobre o custo/benefício da materialização.
- **Impacto técnico**: nenhum hoje. `MATERIALIZED VIEW` traria um `REFRESH` obrigatório e re-abriria a pergunta "qual estado do ledger?" (a atual invariante "estado ATUAL do ledger" seria quebrada por qualquer defasagem de refresh). A não-materialização é performance-neutra à cadência observada.
- **Impacto de negócio**: baixo — se um novo mantenedor "otimizar" para materialized view sem entender a invariante, perde-se a propriedade "borderô cancelado depois muda a semana em que a baixa nasceu" (cabeçalho, linhas 40–42).
- **Métrica de baseline**: 1 leitura/semana × custo estimado sub-100ms hoje = orçamento gasto ~5 s/ano. Materializar economiza ~5 s/ano ao preço de um job de refresh — trade-off ruim.

## 5. Cards Kanban

### [performance-1] Indexar por crescimento, não por ansiedade — gatilho documentado no cabeçalho da migration 0058

- **Problema**
  > A função `metricas.metricas_ciclo` faz seq scan sobre `permuta_alocacao_execucao` (190 linhas hoje) e `solicitacao_numerario_execucao` (23 linhas) filtrando `dry_run = false` e range em `criado_em AT TIME ZONE 'America/Sao_Paulo'`. A conversão inline impede que qualquer índice em `criado_em` seja usado para o range. No volume observado é irrelevante; se o ritmo de escrita mudar (ex.: onboarding de uma segunda unidade da Columbia), o report pode bater silenciosamente no `statement_timeout = 30 s` sem alerta, porque o consumidor é externo.

- **Melhoria Proposta**
  > Não criar índice agora — o custo/benefício não fecha a 190 linhas. Em vez disso, **anotar o gatilho no cabeçalho de `0058_vw_metricas_ciclo.sql`** (seção "INVARIANTES") e criar migration futura `00XX_idx_execucao_criado_local.sql` com dois índices funcionais quando disparado:
  > ```sql
  > CREATE INDEX idx_pae_criado_local_nao_dry
  >     ON permuta_alocacao_execucao ((criado_em AT TIME ZONE 'America/Sao_Paulo'))
  >     WHERE dry_run = false;
  > CREATE INDEX idx_sne_criado_local_nao_dry
  >     ON solicitacao_numerario_execucao ((criado_em AT TIME ZONE 'America/Sao_Paulo'))
  >     WHERE dry_run = false;
  > ```
  > Gatilho (o que quer que dispare primeiro): `SELECT count(*) FROM permuta_alocacao_execucao ≥ 50 000` **ou** latência do SELECT em `metrics.py` > 3 s (o script já pode logar `clock_timestamp()` antes/depois). Bass tactic: *Increase Resource Efficiency* + *Reduce Overhead*.

- **Resultado Esperado**
  > Registro explícito da decisão no lugar onde o próximo mantenedor vai olhar (o cabeçalho da migration, não uma ADR perdida). Métrica observável: p95 do SELECT em `metrics.py` permanece < 5 s ao cruzar o gatilho de 50 000 linhas em `permuta_alocacao_execucao` (via aplicação da migration futura).
  > - latência estimada do SELECT a 50 k linhas × 156 janelas (3 anos): projetada em ~2–3 s **hoje** (sem índice) → ~50–200 ms **após** os índices funcionais.
  > - risco de bater em `statement_timeout` (30 s) a 200 k linhas: presente **hoje** → eliminado após os índices.

- **Tactic alvo**: Increase Resource Efficiency (Bass Manage Resources) / Index Discipline
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — 5 linhas de comentário agora, uma migration de 10 linhas depois
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - anotação de gatilho presente no cabeçalho de `0058_vw_metricas_ciclo.sql`: ausente → presente
  - migration de índice funcional pronta para aplicar quando o gatilho disparar (rascunho em `ontology/_inbox/metricas-ciclo-followups.md` ou similar): ausente → presente
  - latência p95 do `metrics.py` no ciclo em que o gatilho disparar: mantida < 5 s
- **Risco de não fazer**: em 3–5 anos, alguém migra Columbia para volume 100× maior (segunda unidade, backfill histórico), o SELECT começa a estourar `statement_timeout` de 30 s e o report semanal some sem alarme. O consumidor é externo — não há painel interno que grite. Investigação leva mais tempo que a correção.
- **Dependências**: nenhuma dentro deste delta. Cross-QA: **Modifiability** (schema como código: colocar o gatilho no cabeçalho da migration é a mesma disciplina); **Availability/Fault Tolerance** (o `statement_timeout` já é a rede de proteção que evita que um SELECT lento derrube a sessão do leitor — este card garante que a rede *não seja tocada*).

## 6. Notas do agente

- **Escopo**: só o delta `14ca71a..HEAD` (SQL migration + 2 arquivos de teste). Nada de dívida pré-existente em outros repositórios ou camadas.
- **Nota de severidade**: comecei buscando P0/P1 (missing timeouts, N+1, unbounded SELECT, cold-start bloat) e não achei nenhum aqui — o delta é single-shot semanal, tem `statement_timeout` de 30 s como piso duro, e o único caminho de crescimento (índice funcional em `criado_em AT TIME ZONE`) só bite a partir de ~50 k linhas por tabela (25–100× o ritmo observado). Sem baseline numérico que justifique P0/P1, mantive tudo em P3, como manda o item 7 do template.
- **Métricas que não pude coletar localmente**: latência real p50/p95 do `SELECT` em produção — o consumidor é externo (`kavex-report-ciclo/scripts/metrics.py`). Anotei a instrumentação sugerida no card.
- **Cross-QA para o consolidator**:
  - **Modifiability**: F-performance-2 (não-materialização como decisão consciente) é essencialmente um pedido de documentação — sobrepõe-se com Modifiability se o revisor daquela vertente também flagar "decisão de performance não documentada no cabeçalho".
  - **Security**: o `statement_timeout = 30 s` no role leitor é simultaneamente uma tactic de performance (Bound Execution Times) e uma tactic de segurança (limitar impacto de query maliciosa/acidental). Se qa-security fizer nota disso, é a mesma linha (`0058_vw_metricas_ciclo.sql:267`).
  - **Availability**: `default_transaction_read_only = on` + `statement_timeout = 30 s` no role leitor são o mesmo controle citado no lado availability — não é problema, é sinal de que a defesa está no lugar certo.
