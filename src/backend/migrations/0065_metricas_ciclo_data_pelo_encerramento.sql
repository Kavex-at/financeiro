-- 0065_metricas_ciclo_data_pelo_encerramento.sql
-- ADR-0052 — cada execução conta na semana em que TERMINOU, não na semana em que nasceu.
--
-- ── O PROBLEMA ───────────────────────────────────────────────────────────────────────────────────
--
-- A 0058 atribui cada linha dos ledgers à semana do `criado_em`. Mas a linha é UPSERT por
-- `idempotency_key`: uma permuta que falha e é reexecutada semanas depois mantém o `criado_em` da
-- primeira tentativa. A baixa de R$ 150.061,81 liquidada em 14/09 (id 341) nasceu em 10/08 e era
-- atribuída a agosto. Medido em 18/09: 2 linhas em 190, R$ 503.066,69 na série inteira (a outra: id
-- 270, R$ 353.004,88, criada 03/07, liquidada 14/08). A semana 11–18/09 saiu R$ 0,00 no report do
-- ciclo 6 e CONTINUA R$ 0,00 depois desta migration: o borderô do id 341 não está finalizado (G2).
--
-- ── POR QUE UMA COLUNA NOVA, E NÃO `atualizado_em` ───────────────────────────────────────────────
--
-- `atualizado_em` anda DEPOIS do encerramento: o `beginExecution` de um re-clique sobre linha
-- `settled` grava `atualizado_em = now()` (preserva o status, mas carimba), o `clearBorCod` idem, e na
-- SN `setRevisaoHumana`/`setNdeAutorizado`/`setEtapa` rodam depois do settle (a autorização SEFAZ é
-- assíncrona). Datar por ela faria uma baixa de agosto migrar para a semana de um clique qualquer.
--
-- `encerrado_em` é carimbado pelo repositório no `markSettled`/`markParcial`/`markError`:
--   * estado terminal de sucesso (`settled`/`parcial`) → carimbo do PRIMEIRO encerramento, que nunca
--     mais anda (`COALESCE` quando a linha já era terminal);
--   * `error` → o instante da falha; um retry que depois liquida sobrescreve com a liquidação.
-- Linha em voo que nunca encerrou não tem `encerrado_em` e conta na semana do `criado_em`. Uma linha
-- `error` reaberta por retry (`beginExecution`) mantém a data da última falha até o próximo terminal —
-- de propósito: uma retentativa presa conta onde falhou por último, não semanas atrás.
--
-- ── BACKFILL ─────────────────────────────────────────────────────────────────────────────────────
--
-- Só Permutas. Linhas terminais já gravadas recebem `encerrado_em = atualizado_em` — APROXIMAÇÃO:
-- para uma linha `settled` re-clicada depois de liquidar, `atualizado_em` é o clique. Conferido em
-- produção em 2026-09-28: as únicas `settled` que mudam de semana são as duas retentativas reais
-- (ids 270 e 341). A SN fica sem backfill (ver abaixo, antes do UPDATE). O
-- backfill não toca `atualizado_em` nem `criado_em`, então é reconstruível: reverter é
-- `UPDATE ... SET encerrado_em = NULL` (ou `DROP COLUMN`) e reaplicar a função da 0058. Centenas de
-- linhas, abaixo do limiar de 1.000 que exige script de reverse (`rollbacks/README.md`).
--
-- ── O QUE MUDA NOS NÚMEROS ───────────────────────────────────────────────────────────────────────
--
-- A série é RECALCULADA, não remendada: a função lê o estado atual e toda janela reflete a nova regra
-- de uma vez, na MESMA grade de sextas 18:00 (a 0058/0060 geram as janelas; nada aqui mexe nos pisos).
-- Medido em produção em 2026-09-28 (`ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`):
-- a semana 07/08–14/08 ganha R$ 353.004,88 (id 270, liquidado 14/08 15:42); a 11–18/09 ganha a
-- tentativa do id 341 (`0 de 1`) mas continua R$ 0,00 — o borderô 2466 da filial 1 NÃO está finalizado
-- no cache, e R$ só conta com borderô finalizado (gap G2). O antes/depois vai no report do ciclo em que
-- este delta entra. As chaves de `metrica` NÃO mudam: a definição
-- ("baixas concluídas na semana") é a mesma — o que muda é a data que a responde corretamente.
--
-- Contrato (as 9 colunas + `parcial` e `apurado_ate`) idêntico ao da 0058. Sem GRANT, sem role, sem
-- SECURITY DEFINER (ADR-0045, D5). Idempotente: `IF NOT EXISTS`, backfill só onde é NULL,
-- `CREATE OR REPLACE`.

ALTER TABLE public.permuta_alocacao_execucao
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ;

ALTER TABLE public.solicitacao_numerario_execucao
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ;

COMMENT ON COLUMN public.permuta_alocacao_execucao.encerrado_em IS
    'ADR-0052 — quando a execução terminou (settled/parcial: 1º encerramento, imóvel; error: a falha). NULL = em voo. Data das métricas do ciclo.';
COMMENT ON COLUMN public.solicitacao_numerario_execucao.encerrado_em IS
    'ADR-0052 — quando a execução terminou (settled: 1º encerramento, imóvel; error: a falha). NULL = em voo. Data das métricas do ciclo.';

UPDATE public.permuta_alocacao_execucao
   SET encerrado_em = atualizado_em
 WHERE encerrado_em IS NULL
   AND status IN ('settled', 'parcial', 'error');

-- A SN NÃO tem backfill. Medido em produção em 2026-09-28: as 11 linhas `settled` cuja semana de
-- `atualizado_em` difere da de `criado_em` (ids 28–45) foram todas tocadas entre 18:15:08 e 18:15:14
-- de 17/08, numa escrita em lote (`nde_autorizado`/`revisao_humana`), não na liquidação. Nenhuma SN do
-- histórico foi de fato reexecutada. Backfill por `atualizado_em` moveria R$ 789.490,08 de semana
-- sem motivo; sem backfill, a SN antiga continua datada pelo `criado_em` e só a nova ganha carimbo.

-- Mesma função da 0058, com UMA diferença: a data que escolhe a janela é
-- `COALESCE(encerrado_em, criado_em)`, nas duas frentes.
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
    baseline_desc   text,
    parcial         boolean,
    apurado_ate     timestamp
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
    WITH janelas AS (
        SELECT g.inicio AS janela_inicio, g.inicio + INTERVAL '7 days' AS janela_fim
        FROM pg_catalog.generate_series(
            p_serie_inicio,
            p_agora,
            INTERVAL '7 days'
        ) AS g(inicio)
        WHERE g.inicio < p_agora
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
                COALESCE(x.encerrado_em, x.criado_em) AT TIME ZONE 'America/Sao_Paulo' AS data_local,
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
            ON e.data_local >= j.janela_inicio
           AND e.data_local < j.janela_fim
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
           AND (COALESCE(s.encerrado_em, s.criado_em) AT TIME ZONE 'America/Sao_Paulo') >= j.janela_inicio
           AND (COALESCE(s.encerrado_em, s.criado_em) AT TIME ZONE 'America/Sao_Paulo') < j.janela_fim
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
        'sem medição do processo manual'::text AS baseline_desc,
        l.janela_fim > p_agora AS parcial,
        LEAST(l.janela_fim, p_agora) AS apurado_ate
    FROM linhas l
$fn$;

REVOKE ALL ON FUNCTION metricas.metricas_ciclo(timestamp, timestamp) FROM PUBLIC;
