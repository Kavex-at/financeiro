-- 0069_sispag_item_situacao_sincronizacao.sql
-- ADR-0055 (2026-09-29) — o status do lote SISPAG segue a baixa do TÍTULO, de qualquer origem.
-- Regra I11 (`ontology/business-rules/sincronizacao-status-lote-sispag.md`).
--
-- ── 1. O QUE A SINCRONIZAÇÃO GUARDA POR ITEM ──────────────────────────────────────────────────
--
-- A prova de pagamento deixou de ser o `bxa_cod_seq` copiado do detalhe do fin052: em produção a
-- baixa do 38682/1 (PG230901.REM) foi feita à mão no fin010 (borderô 22320), e o retorno de 24/09
-- foi processado nativamente só com o evento BD. O item passa a carregar a SITUAÇÃO derivada
-- (AGENDADO / PAGO / REJEITADO / SEM_RETORNO) e a trilha do que foi observado:
--
--   situacao           — derivada pela sincronização (I11d). NULL = nunca sincronizado.
--   pago_em, valor_pago — data e valor da baixa, do PSQ_018 (com308 baixas) quando legível.
--   pago_observado_em  — primeira sincronização que viu o título pago no fin064.
--   origem_baixa       — REMESSA | FORA_DO_RETORNO | NAO_IDENTIFICADA.
--   baixa_fonte        — de onde vieram bor_cod/bxa_cod_seq: RETORNO (fin052) | TITULO (PSQ_018).
--   divergencia        — contradição que a máquina não resolve (estorno, rejeitado com título
--                        pago). Humano resolve (I11f).
--   sincronizado_em    — última leitura BEM-SUCEDIDA do título. Não mexe em `versao` (I11h).
--
-- Nomes idênticos a `ontology/entities/lote-pagamento.md`.
--
-- ── 2. DOIS TIPOS NOVOS DE ALERTA ─────────────────────────────────────────────────────────────
--
-- `sispag-lote-retornado` (transição para RETORNADO) e `sispag-baixa-divergente` (I11f). O CHECK
-- inline da 0052 recebeu do Postgres o nome `alerta_tipo_check`; trocamos pela lista nova.
--
-- SQL idempotente: `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`.
-- Reverse em `rollbacks/0069_sispag_item_situacao_sincronizacao.rollback.sql`.

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS situacao            TEXT,
    ADD COLUMN IF NOT EXISTS pago_em             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pago_observado_em   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valor_pago          NUMERIC,
    ADD COLUMN IF NOT EXISTS origem_baixa        TEXT,
    ADD COLUMN IF NOT EXISTS baixa_fonte         TEXT,
    ADD COLUMN IF NOT EXISTS divergencia         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS divergencia_detalhe TEXT,
    ADD COLUMN IF NOT EXISTS sincronizado_em     TIMESTAMPTZ;

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_situacao_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_situacao_check
    CHECK (situacao IN ('AGENDADO', 'PAGO', 'REJEITADO', 'SEM_RETORNO'));

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_origem_baixa_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_origem_baixa_check
    CHECK (origem_baixa IN ('REMESSA', 'FORA_DO_RETORNO', 'NAO_IDENTIFICADA'));

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_baixa_fonte_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_baixa_fonte_check
    CHECK (baixa_fonte IN ('RETORNO', 'TITULO'));

ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente'
    ));
