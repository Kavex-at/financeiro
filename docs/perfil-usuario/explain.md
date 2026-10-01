# EXPLAIN — consultas do perfil (`/me/historico`, `/me/atividade`)

ADR-0058, migration `0072_idx_atividade_usuario.sql`. Gerado em 2026-10-01 por
`src/backend/jobs/validate-perfil-usuario-v1.ts --historico --explain`, dentro de
`BEGIN TRANSACTION READ ONLY` e terminado em `ROLLBACK`. Os usernames foram trocados por `'<ator>'`.

## Resumo

| Consulta | Banco | Índices da 0072 | Plano | Execution Time |
|---|---|---|---|---|
| histórico (30 dias, 11 ramos) | produção | ainda **não** aplicados | Seq Scan em 9 ramos; o `destino_audit` e o `access_event` já usam índice existente | ~0,55 ms |
| agregados (1 semana) | produção | ainda **não** aplicados | Seq Scan; LATERAL da 1ª remessa = Seq Scan em `remessa_execucao` (10 linhas) × 50 lotes | ~0,5 ms |
| histórico (30 dias) | local, 0072 aplicada, `enable_seqscan = off` | aplicados | os 11 ramos usam o índice (ator, tempo) da 0072; access_event = BitmapOr de `ator_em` + `alvo_em` | ~0,5 ms |

**Seq Scan em produção é o esperado e não é defeito.** As tabelas têm centenas de linhas
(`permuta_alocacao_execucao` 190, `lote_pagamento` 55, `remessa_execucao` 10, `alerta` 666): ler
a tabela inteira custa menos que ir ao índice, e o planner acerta ao escolher Seq Scan. Os índices
existem para quando os ledgers crescerem. O plano local com `enable_seqscan = off` serve só para
provar que cada ramo **consegue** usar o índice (o filtro de ator e de tempo está dentro de cada
ramo, e a expressão `COALESCE(encerrado_em, criado_em)` casa com o índice de expressão).

## Produção (sem a 0072)

```text
=== EXPLAIN historico (30 dias, 1º ator) ===

Limit  (cost=229.00..229.03 rows=11 width=379) (actual time=0.398..0.402 rows=0 loops=1)
  Buffers: shared hit=123
  ->  Sort  (cost=229.00..229.03 rows=11 width=379) (actual time=0.393..0.397 rows=0 loops=1)
        Sort Key: (COALESCE(x.encerrado_em, x.criado_em)) DESC, ('permuta_execucao'::text) COLLATE "C", ((x.id)::text) COLLATE "C" DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=123
        ->  Result  (cost=0.00..228.81 rows=11 width=379) (actual time=0.388..0.391 rows=0 loops=1)
              Buffers: shared hit=123
              ->  Append  (cost=0.00..228.59 rows=11 width=280) (actual time=0.387..0.391 rows=0 loops=1)
                    Buffers: shared hit=123
                    ->  Seq Scan on permuta_alocacao_execucao x  (cost=0.00..77.34 rows=1 width=220) (actual time=0.137..0.138 rows=0 loops=1)
                          Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
                          Rows Removed by Filter: 190
                          Buffers: shared hit=74
                    ->  Seq Scan on permuta_excecao_manual m  (cost=0.00..17.88 rows=1 width=296) (actual time=0.004..0.004 rows=0 loops=1)
                          Filter: ((criado_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (criado_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (criado_por = '<ator>'::text))
                    ->  Seq Scan on permuta_excecao_manual m_1  (cost=0.00..17.88 rows=1 width=296) (actual time=0.002..0.002 rows=0 loops=1)
                          Filter: ((removido_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (removido_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (removido_por = '<ator>'::text))
                    ->  Seq Scan on lote_pagamento l  (cost=0.00..2.01 rows=1 width=273) (actual time=0.018..0.018 rows=0 loops=1)
                          Filter: ((criado_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (criado_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (criado_por = '<ator>'::text))
                          Rows Removed by Filter: 55
                          Buffers: shared hit=1
                    ->  Seq Scan on lote_pagamento l_1  (cost=0.00..14.96 rows=1 width=273) (actual time=0.009..0.009 rows=0 loops=1)
                          Filter: ((finalizado_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (finalizado_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (finalizado_por = '<ator>'::text))
                          Rows Removed by Filter: 55
                          Buffers: shared hit=1
                          SubPlan 1
                            ->  Aggregate  (cost=12.94..12.95 rows=1 width=32) (never executed)
                                  ->  Bitmap Heap Scan on lote_pagamento_item i  (cost=1.48..12.90 rows=14 width=6) (never executed)
                                        Recheck Cond: (lote_id = l_1.id)
                                        ->  Bitmap Index Scan on lote_pagamento_item_lote_id_fil_cod_doc_cod_tit_cod_key  (cost=0.00..1.48 rows=14 width=0) (never executed)
                                              Index Cond: (lote_id = l_1.id)
                    ->  Index Scan using idx_destino_audit_item on lote_pagamento_item_destino_audit d  (cost=0.15..5.29 rows=1 width=296) (actual time=0.003..0.004 rows=0 loops=1)
                          Index Cond: ((alterado_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (alterado_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone))
                          Filter: (alterado_por = '<ator>'::text)
                          Buffers: shared hit=1
                    ->  Seq Scan on remessa_execucao r  (cost=0.00..15.17 rows=1 width=271) (actual time=0.009..0.010 rows=0 loops=1)
                          Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
                          Rows Removed by Filter: 10
                          Buffers: shared hit=2
                          SubPlan 2
                            ->  Aggregate  (cost=12.94..12.95 rows=1 width=32) (never executed)
                                  ->  Bitmap Heap Scan on lote_pagamento_item i_1  (cost=1.48..12.90 rows=14 width=6) (never executed)
                                        Recheck Cond: (lote_id = r.lote_id)
                                        ->  Bitmap Index Scan on lote_pagamento_item_lote_id_fil_cod_doc_cod_tit_cod_key  (cost=0.00..1.48 rows=14 width=0) (never executed)
                                              Index Cond: (lote_id = r.lote_id)
                    ->  Seq Scan on conciliacao_execucao c  (cost=0.00..14.60 rows=1 width=296) (actual time=0.002..0.002 rows=0 loops=1)
                          Filter: ((NOT dry_run) AND (atualizado_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (atualizado_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
                    ->  Seq Scan on solicitacao_numerario_execucao s  (cost=0.00..3.42 rows=1 width=271) (actual time=0.021..0.021 rows=0 loops=1)
                          Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
                          Rows Removed by Filter: 23
                          Buffers: shared hit=3
                    ->  Seq Scan on alerta al  (cost=0.00..50.67 rows=1 width=296) (actual time=0.166..0.166 rows=0 loops=1)
                          Filter: ((reconhecido_em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (reconhecido_em < '2026-10-01 18:36:24.578+00'::timestamp with time zone) AND (reconhecido_por = '<ator>'::text))
                          Rows Removed by Filter: 666
                          Buffers: shared hit=39
                    ->  Hash Join  (cost=8.09..9.32 rows=1 width=296) (actual time=0.013..0.014 rows=0 loops=1)
                          Hash Cond: (t.id = e.alvo_user_id)
                          Buffers: shared hit=2
                          ->  Seq Scan on app_user t  (cost=0.00..1.15 rows=15 width=25) (actual time=0.007..0.007 rows=1 loops=1)
                                Buffers: shared hit=1
                          ->  Hash  (cost=8.08..8.08 rows=1 width=84) (actual time=0.002..0.003 rows=0 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 8kB
                                Buffers: shared hit=1
                                ->  Index Scan using idx_app_user_access_event_alvo_em on app_user_access_event e  (cost=0.15..8.08 rows=1 width=84) (actual time=0.002..0.002 rows=0 loops=1)
                                      Index Cond: ((em >= '2026-09-01 18:36:24.578+00'::timestamp with time zone) AND (em < '2026-10-01 18:36:24.578+00'::timestamp with time zone))
                                      Filter: ((ator = '<ator>'::text) OR (alvo_user_id = 0))
                                      Buffers: shared hit=1
Planning:
  Buffers: shared hit=13
Planning Time: 1.039 ms
Execution Time: 0.553 ms

=== EXPLAIN agregados (última semana fechada, 1º ator) ===

Result  (cost=308.06..308.09 rows=1 width=240) (actual time=0.484..0.492 rows=1 loops=1)
  Buffers: shared hit=193
  CTE permutas
    ->  Seq Scan on permuta_alocacao_execucao x  (cost=0.00..79.83 rows=1 width=16) (actual time=0.124..0.124 rows=0 loops=1)
          Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
          Rows Removed by Filter: 190
          Buffers: shared hit=74
          SubPlan 1
            ->  Index Scan using permuta_bordero_pkey on permuta_bordero b  (cost=0.28..2.50 rows=1 width=0) (never executed)
                  Index Cond: ((fil_cod = x.fil_cod) AND (bor_cod = x.bor_cod))
                  Filter: ((bor_cod_estornado IS NULL) AND (bor_vld_finalizado = 1))
  CTE lotes_remessados
    ->  Nested Loop  (cost=2.19..117.28 rows=52 width=16) (actual time=0.257..0.258 rows=0 loops=1)
          Buffers: shared hit=101
          ->  Seq Scan on lote_pagamento l  (cost=0.00..1.71 rows=52 width=16) (actual time=0.004..0.015 rows=50 loops=1)
                Filter: (status <> 'CANCELADO'::text)
                Rows Removed by Filter: 5
                Buffers: shared hit=1
          ->  Subquery Scan on r1  (cost=2.19..2.21 rows=1 width=0) (actual time=0.005..0.005 rows=0 loops=50)
                Filter: ((COALESCE(r1.encerrado_em, r1.criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(r1.encerrado_em, r1.criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (r1.executado_por = '<ator>'::text))
                Rows Removed by Filter: 0
                Buffers: shared hit=100
                ->  Limit  (cost=2.19..2.19 rows=1 width=38) (actual time=0.004..0.004 rows=0 loops=50)
                      Buffers: shared hit=100
                      ->  Sort  (cost=2.19..2.19 rows=1 width=38) (actual time=0.004..0.004 rows=0 loops=50)
                            Sort Key: (COALESCE(x_1.encerrado_em, x_1.criado_em)), x_1.id
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=100
                            ->  Seq Scan on remessa_execucao x_1  (cost=0.00..2.18 rows=1 width=38) (actual time=0.003..0.003 rows=0 loops=50)
                                  Filter: ((NOT dry_run) AND (lote_id = l.id) AND (status = 'settled'::text))
                                  Rows Removed by Filter: 10
                                  Buffers: shared hit=100
  CTE itens_remessados
    ->  Hash Join  (cost=1.69..37.17 rows=728 width=13) (actual time=0.010..0.011 rows=0 loops=1)
          Hash Cond: (i.lote_id = lr.id)
          Buffers: shared hit=2
          ->  Seq Scan on lote_pagamento_item i  (cost=0.00..25.42 rows=742 width=29) (actual time=0.005..0.005 rows=1 loops=1)
                Buffers: shared hit=2
          ->  Hash  (cost=1.04..1.04 rows=52 width=16) (actual time=0.001..0.001 rows=0 loops=1)
                Buckets: 1024  Batches: 1  Memory Usage: 8kB
                ->  CTE Scan on lotes_remessados lr  (cost=0.00..1.04 rows=52 width=16) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 6
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.128..0.128 rows=1 loops=1)
          Buffers: shared hit=74
          ->  CTE Scan on permutas  (cost=0.00..0.02 rows=1 width=33) (actual time=0.125..0.125 rows=0 loops=1)
                Buffers: shared hit=74
  InitPlan 7
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.001..0.001 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_1  (cost=0.00..0.02 rows=1 width=33) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 8
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_2  (cost=0.00..0.02 rows=1 width=65) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 9
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.001..0.001 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_3  (cost=0.00..0.02 rows=1 width=33) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 10
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.000..0.001 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_4  (cost=0.00..0.02 rows=1 width=32) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 11
    ->  Aggregate  (cost=2.14..2.15 rows=1 width=8) (actual time=0.015..0.015 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Seq Scan on lote_pagamento l_1  (cost=0.00..2.14 rows=1 width=0) (actual time=0.015..0.015 rows=0 loops=1)
                Filter: ((finalizado_em >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (finalizado_em < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (status <> 'CANCELADO'::text) AND (finalizado_por = '<ator>'::text))
                Rows Removed by Filter: 55
                Buffers: shared hit=1
  InitPlan 12
    ->  Aggregate  (cost=1.17..1.18 rows=1 width=8) (actual time=0.258..0.258 rows=1 loops=1)
          Buffers: shared hit=101
          ->  CTE Scan on lotes_remessados  (cost=0.00..1.04 rows=52 width=0) (actual time=0.257..0.257 rows=0 loops=1)
                Buffers: shared hit=101
  InitPlan 13
    ->  Aggregate  (cost=16.38..16.39 rows=1 width=32) (actual time=0.011..0.011 rows=1 loops=1)
          Buffers: shared hit=2
          ->  CTE Scan on itens_remessados  (cost=0.00..14.56 rows=728 width=32) (actual time=0.010..0.010 rows=0 loops=1)
                Buffers: shared hit=2
  InitPlan 14
    ->  Aggregate  (cost=18.20..18.21 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=1)
          ->  CTE Scan on itens_remessados itens_remessados_1  (cost=0.00..14.56 rows=728 width=64) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 15
    ->  Aggregate  (cost=18.20..18.21 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=1)
          ->  CTE Scan on itens_remessados itens_remessados_2  (cost=0.00..14.56 rows=728 width=64) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 16
    ->  Aggregate  (cost=2.38..2.39 rows=1 width=8) (actual time=0.004..0.004 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Index Scan using idx_conciliacao_execucao_status on conciliacao_execucao c  (cost=0.15..2.37 rows=1 width=0) (actual time=0.004..0.004 rows=0 loops=1)
                Index Cond: (status = 'settled'::text)
                Filter: ((NOT dry_run) AND (atualizado_em >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (atualizado_em < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
                Buffers: shared hit=2
  InitPlan 17
    ->  Aggregate  (cost=2.24..2.25 rows=1 width=8) (actual time=0.008..0.008 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Seq Scan on remessa_execucao r  (cost=0.00..2.24 rows=1 width=0) (actual time=0.007..0.007 rows=0 loops=1)
                Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text) AND (status = 'error'::text))
                Rows Removed by Filter: 10
                Buffers: shared hit=2
  InitPlan 18
    ->  Aggregate  (cost=2.38..2.39 rows=1 width=8) (actual time=0.002..0.003 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Index Scan using idx_conciliacao_execucao_status on conciliacao_execucao c_1  (cost=0.15..2.37 rows=1 width=0) (actual time=0.002..0.002 rows=0 loops=1)
                Index Cond: (status = 'error'::text)
                Filter: ((NOT dry_run) AND (atualizado_em >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (atualizado_em < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text))
                Buffers: shared hit=2
  InitPlan 19
    ->  Aggregate  (cost=3.46..3.47 rows=1 width=8) (actual time=0.021..0.021 rows=1 loops=1)
          Buffers: shared hit=3
          ->  Seq Scan on solicitacao_numerario_execucao s  (cost=0.00..3.46 rows=1 width=0) (actual time=0.021..0.021 rows=0 loops=1)
                Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text) AND (status = 'settled'::text))
                Rows Removed by Filter: 23
                Buffers: shared hit=3
  InitPlan 20
    ->  Aggregate  (cost=3.46..3.47 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=1)
          Buffers: shared hit=3
          ->  Seq Scan on solicitacao_numerario_execucao s_1  (cost=0.00..3.46 rows=1 width=6) (actual time=0.009..0.009 rows=0 loops=1)
                Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text) AND (status = 'settled'::text))
                Rows Removed by Filter: 23
                Buffers: shared hit=3
  InitPlan 21
    ->  Aggregate  (cost=3.46..3.47 rows=1 width=8) (actual time=0.009..0.010 rows=1 loops=1)
          Buffers: shared hit=3
          ->  Seq Scan on solicitacao_numerario_execucao s_2  (cost=0.00..3.46 rows=1 width=0) (actual time=0.009..0.009 rows=0 loops=1)
                Filter: ((NOT dry_run) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (executado_por = '<ator>'::text) AND (status = 'error'::text))
                Rows Removed by Filter: 23
                Buffers: shared hit=3
Planning:
  Buffers: shared hit=15
Planning Time: 0.853 ms
Execution Time: 0.644 ms

```

## Local (0072 aplicada, enable_seqscan = off)

```text
=== EXPLAIN historico (30 dias, 1º ator) ===

Limit  (cost=119.25..119.28 rows=11 width=392) (actual time=0.262..0.266 rows=24 loops=1)
  Buffers: shared hit=37
  ->  Sort  (cost=119.25..119.28 rows=11 width=392) (actual time=0.261..0.263 rows=24 loops=1)
        Sort Key: (COALESCE(x.encerrado_em, x.criado_em)) DESC, ('permuta_execucao'::text) COLLATE "C", ((x.id)::text) COLLATE "C" DESC
        Sort Method: quicksort  Memory: 32kB
        Buffers: shared hit=37
        ->  Result  (cost=0.14..119.06 rows=11 width=392) (actual time=0.038..0.235 rows=24 loops=1)
              Buffers: shared hit=37
              ->  Append  (cost=0.14..118.84 rows=11 width=296) (actual time=0.028..0.204 rows=24 loops=1)
                    Buffers: shared hit=37
                    ->  Index Scan using idx_permuta_alocacao_execucao_ator_em on permuta_alocacao_execucao x  (cost=0.14..8.18 rows=1 width=296) (actual time=0.028..0.043 rows=7 loops=1)
                          Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Filter: (NOT dry_run)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=2
                    ->  Index Scan using idx_permuta_excecao_manual_criado_por_em on permuta_excecao_manual m  (cost=0.15..8.18 rows=1 width=296) (actual time=0.010..0.010 rows=1 loops=1)
                          Index Cond: ((criado_por = 'ana'::text) AND (criado_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (criado_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Buffers: shared hit=2
                    ->  Index Scan using idx_permuta_excecao_manual_removido_por_em on permuta_excecao_manual m_1  (cost=0.14..8.17 rows=1 width=296) (actual time=0.008..0.008 rows=1 loops=1)
                          Index Cond: ((removido_por = 'ana'::text) AND (removido_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (removido_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Buffers: shared hit=2
                    ->  Index Scan using idx_lote_pagamento_criado_por_em on lote_pagamento l  (cost=0.15..8.18 rows=1 width=296) (actual time=0.010..0.011 rows=2 loops=1)
                          Index Cond: ((criado_por = 'ana'::text) AND (criado_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (criado_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Buffers: shared hit=2
                    ->  Index Scan using idx_lote_pagamento_finalizado_por_em on lote_pagamento l_1  (cost=0.14..16.35 rows=1 width=296) (actual time=0.024..0.028 rows=2 loops=1)
                          Index Cond: ((finalizado_por = 'ana'::text) AND (finalizado_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (finalizado_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Buffers: shared hit=6
                          SubPlan 1
                            ->  Aggregate  (cost=8.17..8.18 rows=1 width=32) (actual time=0.007..0.008 rows=1 loops=2)
                                  Buffers: shared hit=4
                                  ->  Index Scan using lote_pagamento_item_lote_id_fil_cod_doc_cod_tit_cod_key on lote_pagamento_item i  (cost=0.14..8.16 rows=1 width=32) (actual time=0.004..0.004 rows=2 loops=2)
                                        Index Cond: (lote_id = l_1.id)
                                        Buffers: shared hit=4
                    ->  Index Scan using idx_destino_audit_alterado_por_em on lote_pagamento_item_destino_audit d  (cost=0.15..8.20 rows=1 width=296) (actual time=0.012..0.012 rows=1 loops=1)
                          Index Cond: ((alterado_por = 'ana'::text) AND (alterado_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (alterado_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Buffers: shared hit=2
                    ->  Index Scan using idx_remessa_execucao_ator_em on remessa_execucao r  (cost=0.14..16.36 rows=1 width=296) (actual time=0.022..0.029 rows=3 loops=1)
                          Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Filter: (NOT dry_run)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=8
                          SubPlan 2
                            ->  Aggregate  (cost=8.17..8.18 rows=1 width=32) (actual time=0.003..0.004 rows=1 loops=3)
                                  Buffers: shared hit=6
                                  ->  Index Scan using lote_pagamento_item_lote_id_fil_cod_doc_cod_tit_cod_key on lote_pagamento_item i_1  (cost=0.14..8.16 rows=1 width=32) (actual time=0.002..0.003 rows=2 loops=3)
                                        Index Cond: (lote_id = r.lote_id)
                                        Buffers: shared hit=6
                    ->  Index Scan using idx_conciliacao_execucao_ator_em on conciliacao_execucao c  (cost=0.15..8.21 rows=1 width=296) (actual time=0.011..0.014 rows=2 loops=1)
                          Index Cond: ((executado_por = 'ana'::text) AND (atualizado_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (atualizado_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Filter: (NOT dry_run)
                          Buffers: shared hit=2
                    ->  Index Scan using idx_solicitacao_numerario_execucao_ator_em on solicitacao_numerario_execucao s  (cost=0.14..8.19 rows=1 width=296) (actual time=0.010..0.013 rows=2 loops=1)
                          Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Filter: (NOT dry_run)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=2
                    ->  Index Scan using idx_alerta_reconhecido_por_em on alerta al  (cost=0.14..8.18 rows=1 width=296) (actual time=0.010..0.010 rows=1 loops=1)
                          Index Cond: ((reconhecido_por = 'ana'::text) AND (reconhecido_em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (reconhecido_em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                          Buffers: shared hit=2
                    ->  Nested Loop  (cost=8.47..20.58 rows=1 width=296) (actual time=0.018..0.021 rows=2 loops=1)
                          Buffers: shared hit=7
                          ->  Bitmap Heap Scan on app_user_access_event e  (cost=8.32..12.34 rows=1 width=84) (actual time=0.006..0.007 rows=2 loops=1)
                                Recheck Cond: (((ator = 'ana'::text) AND (em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (em < '2026-10-01 18:36:54.167+00'::timestamp with time zone)) OR ((alvo_user_id = 0) AND (em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (em < '2026-10-01 18:36:54.167+00'::timestamp with time zone)))
                                Heap Blocks: exact=1
                                Buffers: shared hit=3
                                ->  BitmapOr  (cost=8.32..8.32 rows=1 width=0) (actual time=0.003..0.003 rows=0 loops=1)
                                      Buffers: shared hit=2
                                      ->  Bitmap Index Scan on idx_app_user_access_event_ator_em  (cost=0.00..4.16 rows=1 width=0) (actual time=0.002..0.002 rows=2 loops=1)
                                            Index Cond: ((ator = 'ana'::text) AND (em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                                            Buffers: shared hit=1
                                      ->  Bitmap Index Scan on idx_app_user_access_event_alvo_em  (cost=0.00..4.16 rows=1 width=0) (actual time=0.001..0.001 rows=0 loops=1)
                                            Index Cond: ((alvo_user_id = 0) AND (em >= '2026-09-01 18:36:54.167+00'::timestamp with time zone) AND (em < '2026-10-01 18:36:54.167+00'::timestamp with time zone))
                                            Buffers: shared hit=1
                          ->  Index Scan using app_user_pkey on app_user t  (cost=0.14..8.16 rows=1 width=36) (actual time=0.004..0.004 rows=1 loops=2)
                                Index Cond: (id = e.alvo_user_id)
                                Buffers: shared hit=4
Planning:
  Buffers: shared hit=449
Planning Time: 3.069 ms
Execution Time: 0.535 ms

=== EXPLAIN agregados (última semana fechada, 1º ator) ===

Result  (cost=10000002291.75..10000002291.78 rows=1 width=240) (actual time=1230.856..1230.864 rows=1 loops=1)
  Buffers: shared hit=13
  CTE permutas
    ->  Index Scan using idx_permuta_alocacao_execucao_ator_em on permuta_alocacao_execucao x  (cost=0.14..16.34 rows=1 width=65) (actual time=0.025..0.026 rows=0 loops=1)
          Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone))
          Filter: (NOT dry_run)
          Buffers: shared hit=1
          SubPlan 1
            ->  Index Scan using permuta_bordero_pkey on permuta_bordero b  (cost=0.15..8.17 rows=1 width=0) (never executed)
                  Index Cond: ((fil_cod = x.fil_cod) AND (bor_cod = x.bor_cod))
                  Filter: ((bor_cod_estornado IS NULL) AND (bor_vld_finalizado = 1))
  CTE lotes_remessados
    ->  Nested Loop  (cost=10000000008.17..10000002138.99 rows=259 width=16) (actual time=0.043..0.044 rows=0 loops=1)
          Buffers: shared hit=5
          ->  Seq Scan on lote_pagamento l  (cost=10000000000.00..10000000013.25 rows=259 width=16) (actual time=0.009..0.010 rows=2 loops=1)
                Filter: (status <> 'CANCELADO'::text)
                Rows Removed by Filter: 1
                Buffers: shared hit=1
          ->  Subquery Scan on r1  (cost=8.17..8.20 rows=1 width=0) (actual time=0.015..0.015 rows=0 loops=2)
                Filter: ((COALESCE(r1.encerrado_em, r1.criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(r1.encerrado_em, r1.criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone) AND (r1.executado_por = 'ana'::text))
                Rows Removed by Filter: 1
                Buffers: shared hit=4
                ->  Limit  (cost=8.17..8.18 rows=1 width=64) (actual time=0.012..0.013 rows=1 loops=2)
                      Buffers: shared hit=4
                      ->  Sort  (cost=8.17..8.18 rows=1 width=64) (actual time=0.012..0.012 rows=1 loops=2)
                            Sort Key: (COALESCE(x_1.encerrado_em, x_1.criado_em)), x_1.id
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=4
                            ->  Index Scan using idx_remessa_execucao_status on remessa_execucao x_1  (cost=0.14..8.16 rows=1 width=64) (actual time=0.007..0.008 rows=2 loops=2)
                                  Index Cond: (status = 'settled'::text)
                                  Filter: ((NOT dry_run) AND (lote_id = l.id))
                                  Rows Removed by Filter: 4
                                  Buffers: shared hit=4
  CTE itens_remessados
    ->  Hash Join  (cost=52.00..59.96 rows=181 width=64) (actual time=0.001..0.002 rows=0 loops=1)
          Hash Cond: (lr.id = i.lote_id)
          ->  CTE Scan on lotes_remessados lr  (cost=0.00..5.18 rows=259 width=16) (actual time=0.000..0.000 rows=0 loops=1)
          ->  Hash  (cost=50.25..50.25 rows=140 width=80) (never executed)
                ->  Index Scan using lote_pagamento_item_lote_id_fil_cod_doc_cod_tit_cod_key on lote_pagamento_item i  (cost=0.14..50.25 rows=140 width=80) (never executed)
  InitPlan 6 (returns $8)
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.039..0.039 rows=1 loops=1)
          Buffers: shared hit=1
          ->  CTE Scan on permutas  (cost=0.00..0.02 rows=1 width=33) (actual time=0.027..0.027 rows=0 loops=1)
                Buffers: shared hit=1
  InitPlan 7 (returns $9)
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.003..0.004 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_1  (cost=0.00..0.02 rows=1 width=33) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 8 (returns $10)
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=32) (actual time=0.003..0.004 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_2  (cost=0.00..0.02 rows=1 width=65) (actual time=0.000..0.001 rows=0 loops=1)
  InitPlan 9 (returns $11)
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.004..0.004 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_3  (cost=0.00..0.02 rows=1 width=33) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 10 (returns $12)
    ->  Aggregate  (cost=0.03..0.04 rows=1 width=8) (actual time=0.002..0.002 rows=1 loops=1)
          ->  CTE Scan on permutas permutas_4  (cost=0.00..0.02 rows=1 width=32) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 11 (returns $13)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=8) (actual time=0.016..0.017 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_lote_pagamento_finalizado_por_em on lote_pagamento l_1  (cost=0.14..8.17 rows=1 width=0) (actual time=0.014..0.014 rows=0 loops=1)
                Index Cond: ((finalizado_por = 'ana'::text) AND (finalizado_em >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (finalizado_em < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: (status <> 'CANCELADO'::text)
                Buffers: shared hit=1
  InitPlan 12 (returns $14)
    ->  Aggregate  (cost=5.83..5.84 rows=1 width=8) (actual time=0.046..0.046 rows=1 loops=1)
          Buffers: shared hit=5
          ->  CTE Scan on lotes_remessados  (cost=0.00..5.18 rows=259 width=0) (actual time=0.043..0.043 rows=0 loops=1)
                Buffers: shared hit=5
  InitPlan 13 (returns $15)
    ->  Aggregate  (cost=4.08..4.08 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=1)
          ->  CTE Scan on itens_remessados  (cost=0.00..3.62 rows=181 width=32) (actual time=0.001..0.001 rows=0 loops=1)
  InitPlan 14 (returns $16)
    ->  Aggregate  (cost=4.53..4.54 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=1)
          ->  CTE Scan on itens_remessados itens_remessados_1  (cost=0.00..3.62 rows=181 width=64) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 15 (returns $17)
    ->  Aggregate  (cost=4.53..4.54 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=1)
          ->  CTE Scan on itens_remessados itens_remessados_2  (cost=0.00..3.62 rows=181 width=64) (actual time=0.000..0.000 rows=0 loops=1)
  InitPlan 16 (returns $18)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=8) (actual time=0.011..0.011 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_conciliacao_execucao_ator_em on conciliacao_execucao c  (cost=0.15..8.17 rows=1 width=0) (actual time=0.008..0.008 rows=0 loops=1)
                Index Cond: ((executado_por = 'ana'::text) AND (atualizado_em >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (atualizado_em < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: ((NOT dry_run) AND (status = 'settled'::text))
                Buffers: shared hit=1
  InitPlan 17 (returns $19)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=8) (actual time=0.008..0.009 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_remessa_execucao_ator_em on remessa_execucao r  (cost=0.14..8.17 rows=1 width=0) (actual time=0.006..0.006 rows=0 loops=1)
                Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: ((NOT dry_run) AND (status = 'error'::text))
                Buffers: shared hit=1
  InitPlan 18 (returns $20)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=8) (actual time=0.009..0.009 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_conciliacao_execucao_ator_em on conciliacao_execucao c_1  (cost=0.15..8.17 rows=1 width=0) (actual time=0.006..0.006 rows=0 loops=1)
                Index Cond: ((executado_por = 'ana'::text) AND (atualizado_em >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (atualizado_em < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: ((NOT dry_run) AND (status = 'error'::text))
                Buffers: shared hit=1
  InitPlan 19 (returns $21)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=8) (actual time=0.009..0.009 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_solicitacao_numerario_execucao_ator_em on solicitacao_numerario_execucao s  (cost=0.14..8.17 rows=1 width=0) (actual time=0.007..0.007 rows=0 loops=1)
                Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: ((NOT dry_run) AND (status = 'settled'::text))
                Buffers: shared hit=1
  InitPlan 20 (returns $22)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=32) (actual time=0.012..0.012 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_solicitacao_numerario_execucao_ator_em on solicitacao_numerario_execucao s_1  (cost=0.14..8.17 rows=1 width=20) (actual time=0.009..0.009 rows=0 loops=1)
                Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: ((NOT dry_run) AND (status = 'settled'::text))
                Buffers: shared hit=1
  InitPlan 21 (returns $23)
    ->  Aggregate  (cost=8.17..8.18 rows=1 width=8) (actual time=0.010..0.010 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Index Scan using idx_solicitacao_numerario_execucao_ator_em on solicitacao_numerario_execucao s_2  (cost=0.14..8.17 rows=1 width=0) (actual time=0.008..0.008 rows=0 loops=1)
                Index Cond: ((executado_por = 'ana'::text) AND (COALESCE(encerrado_em, criado_em) >= '2026-09-18 21:00:00+00'::timestamp with time zone) AND (COALESCE(encerrado_em, criado_em) < '2026-09-25 21:00:00+00'::timestamp with time zone))
                Filter: ((NOT dry_run) AND (status = 'error'::text))
                Buffers: shared hit=1
Planning Time: 0.513 ms
JIT:
  Functions: 115
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 9.559 ms, Inlining 56.672 ms, Optimization 634.381 ms, Emission 539.642 ms, Total 1240.254 ms
Execution Time: 1341.207 ms

```
