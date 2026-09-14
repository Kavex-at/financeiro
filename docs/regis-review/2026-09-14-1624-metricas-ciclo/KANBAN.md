---
type: regis-review-kanban
run_id: 2026-09-14-1624-metricas-ciclo
total: 26
counts: { p0: 1, p1: 1, p2: 16, p3: 8 }
consolidated_from: 32
---

# Kanban — financeiro — 2026-09-14-1624-metricas-ciclo

> Ordem: P0, P1, P2, P3; dentro de cada faixa, S antes de M. Cards convergentes foram consolidados;
> a linha **Cards de origem** preserva a proveniência. Detalhe de evidência em cada seção `<qa>.md`.

---

## P0 — Crítico

### [CI-1] Rodar a suíte comportamental da 0058 no CI (Postgres como service)

**QA**: Testability + Availability · **Tactic**: Executable Assertions / Self-Test · **Esforço**: S
**Cards de origem**: testability-1, availability-2 · **Status**: remediado no loop (ver nota)

**Problema**
> As 13 asserções de `vwMetricasCiclo.integration.test.ts` (janela fechada, borderô desfeito, `parcial`
> no R$, fronteira 19:59/20:00 em SP, `dry_run`, alcance do role) não rodam em lugar nenhum
> automaticamente: `jest.config.cjs:7` ignora `*.integration.test.ts` e o `ci.yml` só roda
> `npm test -- --coverage`. `AND NOT e.desfeita` → `AND e.desfeita = false` passaria no CI.

**Melhoria Proposta**
> Job de CI com `postgres:17-alpine` como service, `METRICAS_CICLO_TEST_DSN` e um script npm que rode os
> testes de integração de SQL.

**Resultado Esperado**
> Asserts comportamentais por PR: 0/13 → 13/13. Detecção de regressão: ~7 dias → < 5 min.

**Nota de remediação (orquestrador)**: implementado como job `backend-sql` + `npm run test:sql`
restrito a `migrations/*.integration.test.ts`. **Não** roda todos os `*.integration.test.ts`, como a
proposta original sugeria: os de `routes/` escrevem no HML do Conexos e não podem rodar em CI. O
teste falha (em vez de pular) se `CI=true` e o DSN faltar; `tag-release` passa a depender do job.

---

## P1 — Alto

### [MOD-1] Cinta de sincronia da regra "borderô desfeito" (SQL ↔ `BorderoGestaoService`)

**QA**: Modifiability · **Tactic**: Abstract Common Services · **Esforço**: S
**Cards de origem**: modifiability-1

**Problema**
> "Desfeito = CANCELADO (`bor_vld_finalizado = 2`) ou ESTORNADO (`bor_cod_estornado IS NOT NULL`)" vive em
> `0058_vw_metricas_ciclo.sql:117-123` e em `BorderoGestaoService.situacaoDoItem:596-604`, sem nada que
> garanta a sincronia. Baseline: 2 sítios, 0 cinta; 20 baixas / R$ 3,03 mi dependem da regra hoje.

**Melhoria Proposta**
> Extrair `metricas.bordero_desfeito(fil_cod, bor_cod)` em SQL e adicionar um teste espelho que confronte
> a função com os casos de `situacaoDoItem` sobre o mesmo seed; âncora de comentário nos dois sítios.

**Resultado Esperado**
> Mudança de semântica num lado sem o outro derruba um teste. Tela e report não divergem em silêncio.

---

## P2 — Médio

### [SEC-1] Guarda do teste de integração: hostname + fingerprint do banco descartável
**QA**: Security · **Tactic**: Limit Access · **Esforço**: S · **Cards de origem**: security-1
**Problema**: a guarda aceita qualquer DSN `localhost`; um túnel SSH para produção passaria e o `beforeAll` executaria `DROP DATABASE metricas_ciclo_it` e `ALTER ROLE metricas_ciclo_leitor ... PASSWORD 'leitor-teste'` em produção. Baseline: 1 caminho, 1 verificação.
**Melhoria Proposta**: exigir marcador que só o contêiner descartável tem (ex.: `current_database()` de bootstrap dedicado ou `METRICAS_CICLO_TEST_ALLOW_DROP=yes`) antes de qualquer DDL.
**Resultado Esperado**: ≥ 2 verificações independentes antes do primeiro comando destrutivo; túnel para produção falha cedo.

### [SEC-2] Runbook de rotação e revogação da senha do `metricas_ciclo_leitor`
**QA**: Security · **Tactic**: Revoke Access · **Esforço**: S · **Cards de origem**: security-2
**Problema**: nenhum documento diz onde a senha vive, quem rotaciona, com que cadência, nem o que fazer se `DSN_FINANCEIRO` vazar. Baseline: 0 runbooks.
**Melhoria Proposta**: runbook com criação (cofre), rotação trimestral (`ALTER ROLE ... PASSWORD` + update do DSN) e revogação de emergência (`ALTER ROLE ... NOLOGIN`).
**Resultado Esperado**: revogação em incidente ≤ 15 min, comandos executáveis literalmente.

### [SEC-4] Alertas de `authentication failure` / `permission denied` do leitor
**QA**: Security · **Tactic**: Detect Intrusion · **Esforço**: S · **Cards de origem**: security-4
**Problema**: tentativas de força bruta ou escalada com o role geram log no Supabase, mas nenhuma notificação. Baseline: 0 alertas.
**Melhoria Proposta**: duas queries salvas com alerta no Log Explorer (≥ 5 auth failures/5 min; ≥ 3 permission denied/5 min) filtradas pelo usuário do leitor.
**Resultado Esperado**: detecção ≤ 5 min.

### [AVAIL-1] Heartbeat sobre `vw_metricas_ciclo`
**QA**: Availability · **Tactic**: Monitor / Heartbeat · **Esforço**: S · **Cards de origem**: availability-1
**Problema**: o único consumidor é semanal; senha rotacionada, EXECUTE revogado ou coluna removida só aparecem no report seguinte. Baseline: janela de detecção ≈ 7 dias, 0 probes.
**Melhoria Proposta**: probe periódico que faz `SELECT count(*) FROM vw_metricas_ciclo` como o leitor e alerta em erro, 0 linhas com janela fechada existente, ou > 30 s.
**Resultado Esperado**: MTTR do leitor ≤ 24 h.

### [HAB-LEITOR] Script + verificação do passo `ALTER ROLE ... LOGIN PASSWORD`
**QA**: Deployability + Availability · **Tactic**: Script Deployment Commands / Reconfiguration · **Esforço**: S
**Cards de origem**: deployability-1, availability-3
**Problema**: habilitar o leitor é passo manual documentado só em comentário SQL; esquecê-lo faz o primeiro ciclo falhar com `role is not permitted to log in`, visto só na sexta. Baseline: 1 passo manual sem script; 100% de chance de repetir em ambiente novo.
**Melhoria Proposta**: script local que gera a senha, aplica o `ALTER ROLE`, imprime uma vez e diz onde guardar; o probe do `AVAIL-1` alerta se `rolcanlogin = false` num ambiente que já aplicou a 0058.
**Resultado Esperado**: merge → leitor ativo em ≤ 1 h.

### [INTEG-2] `--fim` sem hora não pode devolver zero linhas em silêncio
**QA**: Integrability · **Tactic**: Observability of integration failures · **Esforço**: S · **Cards de origem**: integrability-2
**Problema**: `metrics.py --fim 2026-09-18` compara `janela_fim <= '2026-09-18 00:00'` e devolve 0 linhas sem aviso (gap K1, provado no teste de integração).
**Melhoria Proposta**: na skill, detectar `--fim` só com data e avisar/normalizar para 20:00; ou filtrar por `janela_fim::date`.
**Resultado Esperado**: aviso explícito em vez de `0 métrica(s)`.

### [INTEG-3] Sinal semântico view → consumidor (`metricas.diagnostico()`)
**QA**: Integrability · **Tactic**: Observability of integration failures · **Esforço**: S · **Cards de origem**: integrability-3
**Problema**: "janela vazia por design" e "quebrou" chegam ao consumidor da mesma forma (`metricas: []`).
**Melhoria Proposta**: função `metricas.diagnostico()` (EXECUTE para o leitor) com `serie_inicio`, `agora`, `ultima_janela_fechada`, contagem por frente e versão do contrato; `metrics.py` a consulta antes do `SELECT`.
**Resultado Esperado**: `metrics.json` distingue `sem_dados_na_janela` de `quebrou: <erro>`.

### [MOD-3] Constantes de fuso, janela e série nomeadas
**QA**: Modifiability · **Tactic**: Defer Binding · **Esforço**: S · **Cards de origem**: modifiability-3
**Problema**: 4× `'America/Sao_Paulo'`, 3× `INTERVAL '7 days'`, 1× série literal espalhados na 0058.
**Melhoria Proposta**: funções `IMMUTABLE` `metricas.const_fuso()`, `const_janela()`, `const_serie_inicio()` na próxima migration da superfície.
**Resultado Esperado**: mudar fuso/janela/série = 1 sítio.

### [ROLLBACK-0058] `rollbacks/0058_vw_metricas_ciclo.rollback.sql`
**QA**: Availability + Deployability + Fault Tolerance · **Tactic**: Rollback · **Esforço**: S
**Cards de origem**: availability-4, deployability-2, fault-tolerance-4
**Problema**: a 0058 cria artefato cluster-level (role + 3 `ALTER ROLE ... SET`) que sobrevive a `DROP DATABASE`; não há reverse versionado (a política atual não exige).
**Melhoria Proposta**: reverse com `REVOKE`s, `DROP VIEW`, `DROP FUNCTION` ×2, `DROP OWNED BY`/`DROP ROLE`, `DROP SCHEMA` e remoção de `schema_migrations`; atualizar a lista fixa em `rollbacks.test.ts` e o README (artefato cluster-level como gatilho).
**Resultado Esperado**: reverter = executar arquivo revisado.

### [TEST-2] `metricas_ciclo_vigente()` com "agora" controlado
**QA**: Testability · **Tactic**: Limit Non-Determinism · **Esforço**: S · **Cards de origem**: testability-2
**Problema**: o único teste da vigente repete a própria definição (`view = função(SERIE, now())`); trocar série ou fuso na vigente passa verde.
**Melhoria Proposta**: seed relativo a `now()` provando que a view não emite a semana em curso nem janela anterior à série.
**Resultado Esperado**: I-M2/I-M3/I-M4 cobertos no caminho real da view.

### [TEST-3] `statement_timeout = 30s` do leitor provado por comportamento
**QA**: Testability · **Tactic**: Executable Assertions · **Esforço**: S · **Cards de origem**: testability-3
**Problema**: o teto só é verificado por regex.
**Melhoria Proposta**: como o leitor, `SELECT pg_sleep(31)` deve falhar com `statement timeout`; `INSERT` numa tabela também deve falhar por read-only.
**Resultado Esperado**: os 3 `ALTER ROLE ... SET` provados comportamentalmente.

### [FT-2] Idade do cache `permuta_bordero` visível antes de publicar a taxa
**QA**: Fault Tolerance · **Tactic**: Condition Monitoring · **Esforço**: S (métrica) / M (refresh proativo) · **Cards de origem**: fault-tolerance-2
**Problema**: cancelamento feito direto no ERP só entra em `desfeita` quando o cache é atualizado; até lá a baixa conta como concluída. Baseline: 0 monitoramentos de frescor.
**Melhoria Proposta**: expor `MAX(now() - atualizado_em)` do cache (via `metricas.diagnostico()`, sem mexer nas 9 colunas); opcionalmente refresh antes do report.
**Resultado Esperado**: o report sabe se o cache está defasado. Depende de G2 no gap.

### [CROSS-CONTRACT] Pact test cross-repo + versão do contrato
**QA**: Integrability + Modifiability + Deployability · **Tactic**: Contract testing / Versioning strategy · **Esforço**: M
**Cards de origem**: integrability-1, modifiability-4, deployability-3
**Problema**: `metrics.py` mantém cópia literal das 9 colunas; SWAP passa pelos dois lados. K1..K4 já vivos.
**Melhoria Proposta**: fixture canônico de linha no `contrato-metricas.md`; teste de shape contra Postgres real aqui e teste do `dict(zip(...))` na skill; `metricas.contrato_versao()`; issues K1..K4 na skill.
**Resultado Esperado**: renomear/reordenar coluna quebra CI dos dois lados. Depende do dono da skill.

### [MOD-2] `metricas_ciclo` em sub-funções por frente
**QA**: Modifiability · **Tactic**: Split Module · **Esforço**: M · **Cards de origem**: modifiability-2
**Problema**: corpo monolítico de 138 LOC; adicionar SISPAG reescreve tudo via `CREATE OR REPLACE`.
**Melhoria Proposta**: `metricas.linhas_permutas(...)`, `linhas_recebimentos(...)` unidas por `UNION ALL` na função-topo.
**Resultado Esperado**: nova frente = 1 sub-função + 1 `UNION ALL`, sem tocar as outras. Fazer antes da 3ª frente.

### [TEST-5] Sandbox orquestrado (`docker-compose.test.yml`)
**QA**: Testability · **Tactic**: Sandbox · **Esforço**: M · **Cards de origem**: testability-5
**Problema**: rodar o teste de SQL localmente exige `docker run` copiado de comentário; 15 `*.integration.test.ts` sem orquestração.
**Melhoria Proposta**: compose com Postgres 17 + script que sobe, roda `test:sql` e derruba. Os de `routes/` (HML) ficam fora.
**Resultado Esperado**: 1 comando local, igual ao CI.

### [FT-1] Snapshot append-only do que o report leu
**QA**: Fault Tolerance · **Tactic**: Rollback + Timestamp · **Esforço**: M · **Cards de origem**: fault-tolerance-1
**Problema**: `deleteByBorCod`/`deleteByKey`/`deleteByBorCodInvoice` apagam linhas do ledger; reler um ciclo passado devolve outro número, sem trilha. Baseline: 190 linhas elegíveis a `DELETE`.
**Melhoria Proposta**: tabela `metricas.metricas_ciclo_leituras` (append-only) gravada a cada coleta. Exige escrita — decisão de contrato com a skill, porque hoje a view é somente leitura por regra.
**Resultado Esperado**: o número de cada ciclo fica reproduzível.

---

## P3 — Baixo

### [INTEG-4] Versão explícita do contrato
**QA**: Integrability · **Esforço**: S · **Cards de origem**: integrability-4
**Problema**: contrato é convenção, sem versão no schema. **Melhoria**: coluna ou função de versão com regra de bump (v2 = view nova). **Resultado**: dispatch por versão quando surgir o 2º consumidor. Depende de `CROSS-CONTRACT`.

### [SEC-3] `OWNER TO` explícito nas funções
**QA**: Security · **Esforço**: S · **Cards de origem**: security-3
**Problema**: owner implícito de `metricas_ciclo_vigente()` (DEFINER); reaplicar com outra credencial muda o owner e a view pode perder acesso às tabelas. **Melhoria**: `ALTER FUNCTION ... OWNER TO postgres` documentado. **Resultado**: 1/1 DEFINER com owner pinado.

### [SEC-5] Senha do teste gerada em runtime
**QA**: Security · **Esforço**: S · **Cards de origem**: security-5
**Problema**: `'leitor-teste'` literal no teste. **Melhoria**: `crypto.randomBytes` no `beforeAll`. **Resultado**: 0 senhas literais. Complementa `SEC-1`.

### [MOD-5] Guardas estáticas menos dependentes de layout
**QA**: Modifiability · **Esforço**: S · **Cards de origem**: modifiability-5
**Problema**: 4 regex acopladas à formatação do SQL. **Melhoria**: mover a verificação de shape para o teste de integração (`information_schema`/`pg_get_functiondef`), manter só "não escreve" no estático. **Resultado**: 4 → 1 regex sensível a layout.

### [MOD-6] Provisionamento de role separado da lógica nas próximas migrations
**QA**: Modifiability · **Esforço**: S · **Cards de origem**: modifiability-6
**Problema**: a 0058 mistura DDL de lógica e provisionamento de identidade. **Melhoria**: a partir da próxima migration da superfície, arquivos separados; não retroagir. **Resultado**: 1 eixo de mudança por migration.

### [FT-3] Pré-checagem de `CREATEROLE` no boot
**QA**: Fault Tolerance · **Esforço**: S · **Cards de origem**: fault-tolerance-3 (rebaixado P2 → P3: verificado em produção `rolcreaterole = true`)
**Problema**: sem `CREATEROLE`, a 0058 aborta o boot com stack trace do driver. **Melhoria**: pré-check com mensagem acionável, ou role em migration separada atrás de flag. **Resultado**: falha de privilégio vira mensagem de operador.

### [PERF-1] Gatilho de índice anotado
**QA**: Performance · **Esforço**: S · **Cards de origem**: performance-1 (+ F-performance-2)
**Problema**: `AT TIME ZONE` no predicado impede índice em `criado_em`; irrelevante a 190 linhas, relevante a ~200 k. **Melhoria**: anotar gatilho (≥ 50 k linhas ou > 3 s) e rascunhar índice funcional parcial `WHERE dry_run = false`; registrar que a view é deliberadamente não-materializada. **Resultado**: decisão onde o próximo mantenedor olha.

### [INTEG-5] Guarda de shape contra Postgres real
**QA**: Integrability · **Esforço**: M · **Cards de origem**: integrability-5
**Problema**: extração por regex quebra com `numeric(12,2)` ou reformatação. **Melhoria**: verificar colunas via `information_schema` no teste de SQL (agora no CI por `CI-1`). **Resultado**: 0 regex de shape. Reavaliar após `CI-1` (parcialmente redundante).
