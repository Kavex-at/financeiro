# Tasks — metricas-ciclo

> Slug: `metricas-ciclo` · Branch: `feat/metricas-ciclo` · Base: `main` (@ `14ca71a`)
> Worktree: `.claude/worktrees/feat+metricas-ciclo` · ADR: **0045 (proposta)** · Migration: **0058**
> Ontologia: v0.24.0 · `entity_changed = false` · Interview: `metricas-ciclo-interview.md` ·
> Decisões abertas: `metricas-ciclo-gap.md` (G1 é P0 **de merge**, não de implementação)

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH` contra o ERP, por construção.** A regra 3 do brief proíbe reconsultar o
Conexos: o número é o que o nosso ledger gravou no momento do fato. Não há cálculo monetário novo, só
`SUM` de valores já persistidos.

**Gate substituto: equivalência contra o ledger vivo (read-only).** Rodar o corpo da função contra a
produção dentro de `BEGIN TRANSACTION READ ONLY`, com `serie_inicio` recuado para 2026-06-19 (só
na validação; a view mantém 2026-09-11), e comparar semana a semana com uma consulta independente
escrita à parte: contagem por status e `SUM(valor_baixado)`/`SUM(valor)`. Amostra: todas as
semanas fechadas desde 2026-06-19, incluindo as que têm baixa em borderô desfeito (caso não usado
no desenvolvimento). Tolerância: **zero** (é soma de valores gravados).

**Resultado (2026-09-14 13:22 BRT): `EQUIVALENTE`.** 12 janelas, 48 comparações, 0 divergência.
Cobriu as semanas com borderô desfeito (06-19: 17 de 41; 06-26, 07-10 e 07-31: 1 cada) e as duas
semanas reais da SN (07-31: 3/14; 08-07: 9/9, R$ 789.490,08). Nenhuma linha em nenhum dos ledgers
desde 2026-09-11 20:00: a janela do ciclo 6 está vazia até aqui.

---

### Task 1: Migration `0058_vw_metricas_ciclo.sql`

**Files to change:**
- `src/backend/migrations/0058_vw_metricas_ciclo.sql` (novo)

**Acceptance criteria:**
- Cria o schema `metricas`, a função `metricas.metricas_ciclo(p_serie_inicio timestamp, p_agora timestamp)`
  e a view `metricas.vw_metricas_ciclo`, com as colunas **nesta ordem e com estes nomes**: `frente`,
  `metrica`, `rotulo`, `valor`, `unidade`, `janela_inicio`, `janela_fim`, `baseline`, `baseline_desc`.
- `janela_inicio`/`janela_fim` são `timestamp` (sem fuso), em horário de São Paulo, sexta 20:00 → sexta 20:00.
- Só janelas fechadas (`janela_fim <= agora`), a partir de `2026-09-11 20:00` (I-M2, I-M3).
- Emite as 4 chaves de `metricas-ciclo-interview.md` com os rótulos de cliente. O `%` só sai quando
  há tentativa (nunca com denominador zero) e leva o absoluto no `rotulo`. O `R$` sai em toda janela
  fechada, `0` quando não houve baixa.
- Baixa em borderô desfeito (`permuta_bordero`: CANCELADO `bor_vld_finalizado = 2` ou ESTORNADO
  `bor_cod_estornado IS NOT NULL`) fica fora do numerador e do R$, e dentro do denominador.
  `dry_run = true` fica fora de tudo.
- `baseline` = `NULL`, e `baseline_desc` diz que não há medição do processo manual (I-M5).
- Somente leitura: nenhum DML, nenhuma chamada externa (I-M1).
- `metricas.metricas_ciclo(serie, agora)` com `EXECUTE` revogado de `PUBLIC`; a view lê
  `metricas.metricas_ciclo_vigente()` (sem parâmetro, `SECURITY DEFINER`, `search_path` vazio, tabelas
  qualificadas). *(Ajustado no loop: função dentro de view checa `EXECUTE` como quem consulta, e o
  teste de integração pegou isso.)*
- Role `metricas_ciclo_leitor`: criado `NOLOGIN` se não existir; `default_transaction_read_only = on`,
  `search_path = metricas`, `statement_timeout = 30s`; `USAGE` no schema, `EXECUTE` só na vigente e
  `SELECT` na view.
- Idempotente: aplicar duas vezes é no-op na segunda.

**Dependencies:** none

### Task 2: Testes da migration

**Files to change:**
- `src/backend/migrations/vwMetricasCiclo.test.ts` (novo)

**Acceptance criteria:**
- **Estático (roda sempre, sem banco):** a migration não contém `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`
  fora de comentário; declara as 9 colunas na ordem do contrato; revoga `EXECUTE` de `PUBLIC`; não
  referencia `recebimento_execucao`/`rateio_recebimento` (a spine vazia, D1).
- **Integração (roda com `METRICAS_CICLO_TEST_DSN`, pulado sem ele):** aplica 0001..0058 num banco
  novo, semeia os dois ledgers e prova, com `agora` fixo:
  - janela aberta não é emitida; janela anterior a `serie_inicio` não é emitida;
  - `%` = concluídas ÷ tentativas, com o absoluto no rótulo; semana sem tentativa não tem linha de `%` e tem R$ `0`;
  - borderô cancelado sai do numerador e do R$ e fica no denominador; `parcial` entra no R$ e não no numerador;
  - `dry_run = true` é ignorado;
  - fronteira de janela: `criado_em` às 19:59 e às 20:00 de sexta (hora de São Paulo) caem em semanas diferentes;
  - o role leitor lê a view, **não** lê `permuta_alocacao_execucao`, **não** executa a função e **não** escreve;
  - reaplicar a migration não falha;
  - o `SELECT` exato do `metrics.py` (filtro por texto `YYYY-MM-DDTHH:MM:SS`) devolve a janela.

**Dependencies:** Task 1

### Task 3: Validação contra o ledger vivo + ADR + passo humano documentado

**Files to change:**
- `ontology/decisions/0045-metricas-do-ciclo-leem-o-ledger-e-nao-a-spine.md` (novo, status Proposta)
- `src/backend/migrations/0058_vw_metricas_ciclo.sql` (cabeçalho: passo humano do LOGIN/DSN)

**Acceptance criteria:**
- Plano de validação acima executado. Resultado (`EQUIVALENTE`/`DIVERGENTE`) registrado no PR.
- ADR registra D1–D4, com as alternativas descartadas.
- O cabeçalho da migration diz exatamente o comando humano (`ALTER ROLE … LOGIN PASSWORD`), por que
  tem que ser o próprio role e o formato do usuário no pooler do Supabase.

**Dependencies:** Task 1, Task 2

### Task 4 (sub-loop P0 do Regis-Review, card `CI-1`): as garantias comportamentais rodam no CI

> Origem: `docs/regis-review/2026-09-14-1624-metricas-ciclo/KANBAN.md`, `CI-1` (testability-1 +
> availability-2). Interview surgical: sem mudança de regra ou entidade (`entity_changed = false`).

**Files to change:**
- `.github/workflows/ci.yml` (job `backend-sql`; `tag-release` passa a depender dele)
- `src/backend/package.json` (script `test:sql`)
- `src/backend/migrations/vwMetricasCiclo.integration.test.ts` (falha no CI sem DSN; nota do PatternGuardian)

**Acceptance criteria:**
- Job com `postgres:17-alpine` como service roda `npm run test:sql` com `METRICAS_CICLO_TEST_DSN`.
- `test:sql` seleciona **só** `migrations/*.integration.test.ts`. Os de `routes/` escrevem no HML do
  Conexos e não podem rodar em CI.
- Com `CI=true` e sem DSN, a suíte **falha**. Um `describe.skip` sairia verde com zero asserts.
- `tag-release` não publica versão com o job vermelho.
- A consulta do teste "a view é a função" passa `SERIE` como parâmetro, não interpolado (nota do PatternGuardian).

**Resultado:** verificado localmente em 2026-09-14. `--listTests` lista só o arquivo de migrations; com
DSN, 13/13 verdes; `CI=true` sem DSN, falha com mensagem explícita (exit 1).

**Dependencies:** Task 2

## Definition of Done

- `npm run typecheck`, `npm run lint`, `npm test` verdes em `src/backend`.
- Teste de integração verde contra Postgres 17 descartável (versão da produção).
- PatternGuardian e SpecVerifier aprovados; Regis-Review rodado, P0 remediados.
- `metricas-ciclo-gap.md` G1 respondido **antes do merge** (a chave vira permanente).
- Bump de versão: delta tem `feat` em `src/` ⇒ minor (0.36.2 → 0.37.0), FE==BE.
