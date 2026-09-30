-- 0070_metricas_ciclo_sispag.sql
-- SISPAG (Frente II) entra nas métricas do ciclo. Continuação das ADR-0045/0048/0052; ver ADR-0056.
--
-- ── O QUE SE MEDE (decisões do Yuri, 2026-09-29/30) ──────────────────────────────────────────────
--
-- Evento: remessa gerada por nós E aceita pelo banco. Unidade: o TÍTULO (o CNAB aceita e rejeita
-- título a título, não arquivo). Aceito = `lote_pagamento_item.situacao` ∈ {AGENDADO, PAGO}: PAGO
-- implica aceito. A situação é gravada pela sincronização de lotes (ADR-0055, I11), não por nós:
-- antes da 1ª sincronização ela é NULL e o título conta como "aguardando retorno", nunca como
-- rejeitado. R$ = `lote_pagamento_item.valor` (snapshot da inclusão), disponível para todo aceito;
-- `valor_pago` só existe depois da baixa e zeraria os AGENDADO.
--
-- Semana: a da GERAÇÃO da remessa — `COALESCE(encerrado_em, criado_em)` da 1ª execução `settled`
-- do lote, mesma regra da ADR-0052. O aceite que chega depois RECALCULA aquela semana (série
-- recalculada, não remendada). Lote CANCELADO fica fora. Execução `error` não entra: o denominador
-- são títulos que de fato foram ao banco.
--
-- ── `remessa_execucao.encerrado_em` ──────────────────────────────────────────────────────────────
--
-- Mesmo defeito que a 0065 corrigiu nas outras frentes: a linha é upsert por `idempotency_key`, então
-- `criado_em` é o da 1ª tentativa, e `atualizado_em` anda com o re-clique (o ON CONFLICT do
-- `beginExecution` o carimba mesmo numa linha `settled`). O repositório passa a carimbar no
-- `settle` (1º encerramento, imóvel) e no `fail` (a falha; um retry que liquide sobrescreve).
--
-- Backfill: terminais recebem `encerrado_em = atualizado_em`. Conferido em produção em 2026-09-30:
-- as 6 `settled` reais têm `atualizado_em` a segundos do `criado_em` (nenhuma re-clicada), então o
-- backfill é exato para elas; as 4 `error` ficam com a última falha, e não entram na métrica. Dez
-- linhas: reverter é `UPDATE ... SET encerrado_em = NULL` e reaplicar a função da 0065.
--
-- ── O QUE MUDA NOS NÚMEROS ───────────────────────────────────────────────────────────────────────
--
-- Nada de Permutas nem de Recebimentos: as CTEs delas são as da 0065, byte a byte. A grade de sextas
-- 18:00 e os pisos `serie_inicio`/`historico_inicio` ficam intocados. Duas chaves novas:
-- `sispag_titulos_aceitos_pct` (só em semana com título enviado) e `sispag_valor_aceito` (toda
-- semana, R$ 0 quando não há). Contrato (as 9 colunas + `parcial` e `apurado_ate`) idêntico.
-- Sem GRANT, sem role, sem SECURITY DEFINER (ADR-0045, D5). Idempotente.

ALTER TABLE public.remessa_execucao
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ;

COMMENT ON COLUMN public.remessa_execucao.encerrado_em IS
    'ADR-0052/0056 — quando a execução terminou (settled: 1º encerramento, imóvel; error: a falha). NULL = em voo. Data das métricas do ciclo.';

UPDATE public.remessa_execucao
   SET encerrado_em = atualizado_em
 WHERE encerrado_em IS NULL
   AND status IN ('settled', 'error');

-- Mesma função da 0065, com a CTE `sispag` e as duas linhas da Frente II.
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
    -- SISPAG (Frente II): cada TÍTULO de uma remessa gerada de verdade, datado pela 1ª remessa
    -- `settled` do lote. Lote CANCELADO fica fora (a PG160901.REM de 16/09 foi cancelada).
    sispag_itens AS (
        SELECT
            i.valor,
            i.situacao,
            COALESCE(r.encerrado_em, r.criado_em) AT TIME ZONE 'America/Sao_Paulo' AS data_local
        FROM public.lote_pagamento_item i
        JOIN public.lote_pagamento l
            ON l.id = i.lote_id
           AND l.status <> 'CANCELADO'
        JOIN LATERAL (
            SELECT x.encerrado_em, x.criado_em
            FROM public.remessa_execucao x
            WHERE x.lote_id = i.lote_id
              AND x.dry_run = false
              AND x.status = 'settled'
            ORDER BY COALESCE(x.encerrado_em, x.criado_em)
            LIMIT 1
        ) r ON true
    ),
    sispag AS (
        SELECT
            j.janela_inicio,
            j.janela_fim,
            COUNT(s.data_local) AS enviados,
            COUNT(s.data_local) FILTER (WHERE s.situacao IN ('AGENDADO', 'PAGO')) AS aceitos,
            -- NULL = a sincronização ainda não leu o item; SEM_RETORNO = leu e o banco não respondeu.
            COUNT(s.data_local) FILTER (
                WHERE s.situacao IS NULL OR s.situacao = 'SEM_RETORNO'
            ) AS aguardando,
            COALESCE(SUM(s.valor) FILTER (WHERE s.situacao IN ('AGENDADO', 'PAGO')), 0)
                AS valor_aceito
        FROM janelas j
        LEFT JOIN sispag_itens s
            ON s.data_local >= j.janela_inicio
           AND s.data_local < j.janela_fim
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

        UNION ALL

        SELECT
            'SISPAG (Frente II)',
            'sispag_titulos_aceitos_pct',
            pg_catalog.format(
                'títulos aceitos pelo banco em remessa gerada — %s de %s títulos, %s aguardando retorno',
                s.aceitos,
                s.enviados,
                s.aguardando
            ),
            pg_catalog.round(100.0 * s.aceitos / s.enviados, 1),
            '%',
            s.janela_inicio,
            s.janela_fim
        FROM sispag s
        WHERE s.enviados > 0

        UNION ALL

        SELECT
            'SISPAG (Frente II)',
            'sispag_valor_aceito',
            'valor de títulos aceitos pelo banco',
            pg_catalog.round(s.valor_aceito, 2),
            'R$',
            s.janela_inicio,
            s.janela_fim
        FROM sispag s
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
