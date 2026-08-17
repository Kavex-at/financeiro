-- 0048_idx_solicitacao_numerario_execucao_filial.sql
-- Frente IV (Recebimentos) — índice para a aba NDe do painel (ADR-0037, Regis performance-2).
--
-- A projeção da aba dirige por `solicitacao_numerario_execucao` filtrando `fil_cod = ANY($1)`, e a
-- tabela só tinha índice em pri_cod (0041), status (0041) e txn_id (0042). Duas queries por carga de
-- painel (lista + COUNT de pendentes) faziam seq scan.
--
-- PARCIAL de propósito: o mesmo recorte do `PAINEL_FROM_WHERE` (dry-run e NDe dispensada nunca
-- aparecem na aba), então o índice fica pequeno e serve exatamente às duas queries. `nd_doc_cod` vai
-- junto porque o outro termo do WHERE é `nd_doc_cod IS NOT NULL OR n.id IS NOT NULL`.
--
-- SQL idempotente. Sem CONCURRENTLY: o BootMigrator roda em transação, antes de aceitar tráfego.
CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_execucao_painel_nde
    ON solicitacao_numerario_execucao (fil_cod, nd_doc_cod)
    WHERE dry_run = false AND COALESCE(nde_dispensada, false) = false;
