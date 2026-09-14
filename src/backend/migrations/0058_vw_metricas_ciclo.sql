-- 0058_vw_metricas_ciclo.sql
-- ADR-0045 — o sistema expõe, por semana, quanto trabalho fez pela operação.
--
-- A tela Métricas e o report semanal da Columbia (`kavex-report-ciclo/scripts/metrics.py`, via
-- `GET /metricas/ciclo`) leem `vw_metricas_ciclo`. O report não sabe o que os números significam — só
-- lê a forma. A forma é o contrato e NÃO muda:
--   frente, metrica, rotulo, valor, unidade, janela_inicio, janela_fim, baseline, baseline_desc
-- `metrica` é chave de série: nunca renomear. Mudou a definição → chave nova, quebra anotada no report.
--
-- ── DE ONDE VEM CADA NÚMERO ──────────────────────────────────────────────────────────────────────
--
-- Frente I — `permuta_alocacao_execucao` (ledger write-ahead da baixa no fin010).
--   Tentativa  = linha real (`dry_run = false`), atribuída à semana do `criado_em`.
--   Concluída  = `settled` com borderô FINALIZADO.
--   R$         = `valor_baixado` (BRL gravado no momento da baixa) de `settled` e `parcial` com borderô
--                FINALIZADO. `parcial` é dinheiro baixado de verdade, mas não é baixa concluída.
--   Borderô FINALIZADO = `bor_vld_finalizado = 1` e sem estorno (`bor_cod_estornado IS NULL`) no cache
--   `permuta_bordero` — a mesma derivação da tela (`BorderoGestaoService.situacaoDoItem`). Decisão do
--   Yuri (gap G2, 2026-09-14): CANCELADO, ESTORNADO e EM CADASTRO **não** são concluídos; em cadastro
--   ainda não fechou no ERP. Borderô ausente do cache também não conta — situação desconhecida não é
--   finalizada. Em 2026-09-14 (177 settled): 150 finalizados, 20 cancelados, 3 em cadastro, 4 sem
--   cache. Todos ficam no denominador. Se "em cadastro" virar métrica, é chave nova.
--
-- Frente IV — `solicitacao_numerario_execucao` (trilha SN → fin014 → NDe).
--   NÃO `recebimento`/`recebimento_execucao`/`rateio_recebimento`: a spine tem 0 linhas em produção.
--   Medir por ela diria "0 créditos alocados" na semana em que a trilha da SN alocou R$ 789 mil.
--   Tentativa = linha real; concluída = `settled`; R$ = `valor` das concluídas.
--   "% sem toque humano" NÃO existe e não será emitido (gap G1, 2026-09-14): toda SN é disparada por
--   analista, então a métrica seria zero por construção.
--
-- ── INVARIANTES ──────────────────────────────────────────────────────────────────────────────────
--
--   * Somente leitura. Nenhum DML, nenhuma chamada ao Conexos.
--   * Série começa em 2026-09-11 20:00 (ciclo 6). Janelas anteriores não são emitidas, mesmo com dado
--     no ledger: o ledger de permutas APAGA linhas quando um borderô é excluído, e estas definições
--     não existiam antes. Número reconstruído parece medido e não é.
--   * Só janela FECHADA (`janela_fim <= agora`). Semana em curso seria número incompleto com cara
--     de fechado.
--   * Janela sexta 20:00 → sexta 20:00 em horário de São Paulo, como `timestamp` SEM fuso. A sessão do
--     Supabase é UTC; com `timestamptz`, um filtro por texto `'2026-09-11T20:00:00'` viraria 17:00
--     em São Paulo e erraria a semana.
--   * `%` só sai com tentativa na janela (nunca 0/0) e leva o absoluto no `rotulo`. `R$` sai sempre.
--   * `baseline` NULL: não há medição do processo manual. Só preencher com fonte.
--   * O estado é o ATUAL do ledger: um borderô cancelado depois muda a semana em que a baixa nasceu.
--     O report congela o número no ciclo em que o leu.
--
-- ── POR QUE FUNÇÃO + VIEW ────────────────────────────────────────────────────────────────────────
--
-- A lógica vive em `metricas.metricas_ciclo(serie_inicio, agora)`. Assim o teste de integração prova o
-- comportamento com um "agora" fixo, sem esperar sexta. A view é essa função com a série vigente
-- (`metricas.serie_inicio()`, fonte ÚNICA da data — a API a devolve para a tela escrever "série
-- iniciada em") e o `now()` de São Paulo.
--
-- ── ACESSO ───────────────────────────────────────────────────────────────────────────────────────
--
-- Quem lê é a APLICAÇÃO, com a conexão que ela já usa: `GET /metricas/ciclo` (tela Métricas e o
-- `kavex-report-ciclo`, que faz login na API). Não há role de banco dedicado nem DSN a distribuir —
-- decisão do Yuri em 2026-09-14 (ADR-0045, D5). Uma versão anterior deste delta criava um role
-- só-leitura para o report conectar direto no Postgres; foi removida antes de ir para produção.
--
-- Schema próprio (`metricas`), fora do PostgREST: não é exposto a `anon`/`authenticated`. `EXECUTE`
-- revogado de PUBLIC nas funções: só o dono (o usuário da aplicação) as usa.
--
-- SQL idempotente: `IF NOT EXISTS`, `CREATE OR REPLACE` e REVOKE re-rodáveis.

CREATE SCHEMA IF NOT EXISTS metricas;
REVOKE ALL ON SCHEMA metricas FROM PUBLIC;

-- Início da série (ciclo 6). Mudar é decisão de negócio, em migration nova, com a quebra anotada no report.
CREATE OR REPLACE FUNCTION metricas.serie_inicio()
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
    SELECT TIMESTAMP '2026-09-11 20:00:00'
$fn$;

REVOKE ALL ON FUNCTION metricas.serie_inicio() FROM PUBLIC;

CREATE OR REPLACE FUNCTION metricas.metricas_ciclo(p_serie_inicio timestamp, p_agora timestamp)
RETURNS TABLE (
    frente          text,
    metrica         text,
    rotulo          text,
    valor           numeric,
    unidade         text,
    janela_inicio   timestamp,
    janela_fim      timestamp,
    baseline        numeric,
    baseline_desc   text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
    WITH janelas AS (
        SELECT g.inicio AS janela_inicio, g.inicio + INTERVAL '7 days' AS janela_fim
        FROM pg_catalog.generate_series(
            p_serie_inicio,
            p_agora - INTERVAL '7 days',
            INTERVAL '7 days'
        ) AS g(inicio)
    ),
    permutas AS (
        SELECT
            j.janela_inicio,
            j.janela_fim,
            COUNT(e.id) AS tentativas,
            COUNT(e.id) FILTER (WHERE e.status = 'settled' AND e.finalizada) AS concluidas,
            COALESCE(
                SUM(e.valor_baixado) FILTER (WHERE e.status IN ('settled', 'parcial') AND e.finalizada),
                0
            ) AS valor_baixado
        FROM janelas j
        LEFT JOIN (
            SELECT
                x.id,
                x.status,
                x.valor_baixado,
                x.criado_em AT TIME ZONE 'America/Sao_Paulo' AS criado_local,
                EXISTS (
                    SELECT 1
                    FROM public.permuta_bordero b
                    WHERE b.fil_cod = x.fil_cod
                      AND b.bor_cod = x.bor_cod
                      AND b.bor_vld_finalizado = 1
                      AND b.bor_cod_estornado IS NULL
                ) AS finalizada
            FROM public.permuta_alocacao_execucao x
            WHERE x.dry_run = false
        ) e
            ON e.criado_local >= j.janela_inicio
           AND e.criado_local < j.janela_fim
        GROUP BY j.janela_inicio, j.janela_fim
    ),
    recebimentos AS (
        SELECT
            j.janela_inicio,
            j.janela_fim,
            COUNT(s.id) AS tentativas,
            COUNT(s.id) FILTER (WHERE s.status = 'settled') AS concluidas,
            COALESCE(SUM(s.valor) FILTER (WHERE s.status = 'settled'), 0) AS valor_alocado
        FROM janelas j
        LEFT JOIN public.solicitacao_numerario_execucao s
            ON s.dry_run = false
           AND (s.criado_em AT TIME ZONE 'America/Sao_Paulo') >= j.janela_inicio
           AND (s.criado_em AT TIME ZONE 'America/Sao_Paulo') < j.janela_fim
        GROUP BY j.janela_inicio, j.janela_fim
    ),
    linhas AS (
        SELECT
            'Permutas (Frente I)' AS frente,
            'permutas_baixas_concluidas_pct' AS metrica,
            pg_catalog.format(
                'baixas de adiantamento concluídas, com borderô finalizado — %s de %s tentativas',
                p.concluidas,
                p.tentativas
            ) AS rotulo,
            pg_catalog.round(100.0 * p.concluidas / p.tentativas, 1) AS valor,
            '%' AS unidade,
            p.janela_inicio,
            p.janela_fim
        FROM permutas p
        WHERE p.tentativas > 0

        UNION ALL

        SELECT
            'Permutas (Frente I)',
            'permutas_valor_baixado',
            'valor baixado em permutas de adiantamento',
            pg_catalog.round(p.valor_baixado, 2),
            'R$',
            p.janela_inicio,
            p.janela_fim
        FROM permutas p

        UNION ALL

        SELECT
            'Conciliação de Recebimentos (Frente IV)',
            'recebimentos_alocacoes_concluidas_pct',
            pg_catalog.format(
                'créditos de cliente alocados até a NDe sem erro — %s de %s tentativas',
                r.concluidas,
                r.tentativas
            ),
            pg_catalog.round(100.0 * r.concluidas / r.tentativas, 1),
            '%',
            r.janela_inicio,
            r.janela_fim
        FROM recebimentos r
        WHERE r.tentativas > 0

        UNION ALL

        SELECT
            'Conciliação de Recebimentos (Frente IV)',
            'recebimentos_valor_alocado',
            'valor de créditos de cliente alocados',
            pg_catalog.round(r.valor_alocado, 2),
            'R$',
            r.janela_inicio,
            r.janela_fim
        FROM recebimentos r
    )
    SELECT
        l.frente,
        l.metrica,
        l.rotulo,
        l.valor,
        l.unidade,
        l.janela_inicio,
        l.janela_fim,
        NULL::numeric AS baseline,
        'sem medição do processo manual'::text AS baseline_desc
    FROM linhas l
$fn$;

REVOKE ALL ON FUNCTION metricas.metricas_ciclo(timestamp, timestamp) FROM PUBLIC;

CREATE OR REPLACE VIEW metricas.vw_metricas_ciclo AS
SELECT
    m.frente,
    m.metrica,
    m.rotulo,
    m.valor,
    m.unidade,
    m.janela_inicio,
    m.janela_fim,
    m.baseline,
    m.baseline_desc
FROM metricas.metricas_ciclo(
    metricas.serie_inicio(),
    (now() AT TIME ZONE 'America/Sao_Paulo')
) AS m;
