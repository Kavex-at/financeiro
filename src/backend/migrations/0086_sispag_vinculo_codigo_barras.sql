-- 0086_sispag_vinculo_codigo_barras.sql
-- ADR-0071 (I17) — vínculo do código de barras CONFIRMADO ao item do lote (passo 2 da ADR-0068,
-- escopo "valor igual"). Três blocos, todos ADITIVOS e idempotentes:
--
--   1. `lote_pagamento_item` ganha o vínculo em CINCO colunas nullable (entidade `ItemLote`);
--   2. a trilha `sispag_sugestao_boleto_evento` (0084) aceita 3 tipos novos e ganha `lote_id` e
--      `decisao_id` — é o que dá idempotência ao evento por (lote, título, decisão) sob
--      concorrência (índice único parcial);
--   3. a marca de retenção `titulo_bloqueio_duplicidade` (0085) aceita a origem
--      `VINCULO_CODIGO_BARRAS_FALHOU` — o título que sai do lote porque o vínculo falhou de forma
--      determinística (I17g(3)).
--
-- ── PRIVACIDADE (I17j) ────────────────────────────────────────────────────────────────────────
-- Só o código MASCARADO persiste (5 primeiros + 4 últimos dígitos, separados por "…"). O CHECK
-- `vinculo_codigo_mascarado_check` faz o ESQUEMA recusar um código longo: nenhum bug de aplicação
-- grava as 44 barras nem a linha digitável aqui.
--
-- Linhas existentes não são reescritas e nada é preenchido: item sem vínculo = `vinculo_origem`
-- nulo (o legado, associado pelo próprio ERP, é `ERP_DDA` implícito). Trilha continua só-inclusão
-- (o trigger da 0084 não é tocado). O CHECK do ledger de remessa (0049) NÃO muda: a etapa
-- `vincular_codbar` é etapa de memória, como `limpar_retirados`.
--
-- Reverse (só estrutura) em `rollbacks/0086_sispag_vinculo_codigo_barras.rollback.sql`.

-- ── 1. Vínculo no item do lote ────────────────────────────────────────────────────────────────

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS vinculo_origem TEXT NULL,
    ADD COLUMN IF NOT EXISTS vinculo_decisao_id UUID NULL,
    ADD COLUMN IF NOT EXISTS vinculo_codigo_mascarado TEXT NULL,
    ADD COLUMN IF NOT EXISTS vinculo_aplicado_em TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS vinculo_flp_cod INTEGER NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lote_pagamento_item_vinculo_origem_check'
          AND conrelid = 'lote_pagamento_item'::regclass
    ) THEN
        ALTER TABLE lote_pagamento_item
            ADD CONSTRAINT lote_pagamento_item_vinculo_origem_check CHECK (
                vinculo_origem IS NULL OR vinculo_origem IN ('ERP_DDA', 'DECISAO_HUMANA')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lote_pagamento_item_vinculo_tudo_ou_nada_check'
          AND conrelid = 'lote_pagamento_item'::regclass
    ) THEN
        ALTER TABLE lote_pagamento_item
            ADD CONSTRAINT lote_pagamento_item_vinculo_tudo_ou_nada_check CHECK (
                (vinculo_origem IS NULL
                    AND vinculo_decisao_id IS NULL
                    AND vinculo_codigo_mascarado IS NULL
                    AND vinculo_aplicado_em IS NULL
                    AND vinculo_flp_cod IS NULL)
                OR (vinculo_origem IS NOT NULL
                    AND vinculo_codigo_mascarado IS NOT NULL
                    AND vinculo_aplicado_em IS NOT NULL
                    AND vinculo_flp_cod IS NOT NULL
                    AND (vinculo_origem <> 'DECISAO_HUMANA' OR vinculo_decisao_id IS NOT NULL))
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lote_pagamento_item_vinculo_codigo_mascarado_check'
          AND conrelid = 'lote_pagamento_item'::regclass
    ) THEN
        ALTER TABLE lote_pagamento_item
            ADD CONSTRAINT lote_pagamento_item_vinculo_codigo_mascarado_check CHECK (
                vinculo_codigo_mascarado IS NULL
                OR vinculo_codigo_mascarado ~ '^[0-9]{5}…[0-9]{4}$'
            );
    END IF;
END
$$;

-- ── 2. Trilha da sugestão: três tipos novos e a chave de idempotência ─────────────────────────

ALTER TABLE sispag_sugestao_boleto_evento
    ADD COLUMN IF NOT EXISTS lote_id UUID NULL,
    ADD COLUMN IF NOT EXISTS decisao_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_sugestao_boleto_evento_tipo_check'
          AND conrelid = 'sispag_sugestao_boleto_evento'::regclass
          AND pg_get_constraintdef(oid) LIKE '%VINCULO_APLICADO%'
    ) THEN
        ALTER TABLE sispag_sugestao_boleto_evento
            DROP CONSTRAINT IF EXISTS sispag_sugestao_boleto_evento_tipo_check;
        ALTER TABLE sispag_sugestao_boleto_evento
            ADD CONSTRAINT sispag_sugestao_boleto_evento_tipo_check CHECK (tipo IN (
                'PAR_CONFIRMADO', 'DECISAO_CONFIRMADA', 'DECISAO_REJEITADA', 'DECISAO_ANULADA',
                'PAR_REVOGADO', 'LINHA_COPIADA',
                'VINCULO_APLICADO', 'VINCULO_SIMULADO', 'VINCULO_FALHOU'
            ));
    END IF;
END
$$;

-- Um `VINCULO_APLICADO` por (lote, título, decisão); um `VINCULO_SIMULADO` por (lote, título,
-- decisão, resultado). A decisão ausente (item sem decisão) entra como UUID zero para o NULL não
-- furar a unicidade. `VINCULO_FALHOU` não é único: cada tentativa que falha é um fato.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_sugestao_boleto_evento_vinculo
    ON sispag_sugestao_boleto_evento (
        tipo, lote_id, fil_cod, doc_cod, tit_cod,
        COALESCE(decisao_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(motivo, '')
    )
    WHERE tipo IN ('VINCULO_APLICADO', 'VINCULO_SIMULADO');

-- ── 3. Marca de retenção: origem nova ─────────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'titulo_bloqueio_duplicidade_origem_check'
          AND conrelid = 'titulo_bloqueio_duplicidade'::regclass
          AND pg_get_constraintdef(oid) LIKE '%VINCULO_CODIGO_BARRAS_FALHOU%'
    ) THEN
        ALTER TABLE titulo_bloqueio_duplicidade
            DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_origem_check;
        ALTER TABLE titulo_bloqueio_duplicidade
            ADD CONSTRAINT titulo_bloqueio_duplicidade_origem_check CHECK (
                origem IN (
                    'DUPLICIDADE_TITULO', 'CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL',
                    'VINCULO_CODIGO_BARRAS_FALHOU'
                )
            );
    END IF;
END
$$;

COMMENT ON COLUMN lote_pagamento_item.vinculo_origem IS
    'ADR-0071 I17 — ERP_DDA (associado pelo ERP) | DECISAO_HUMANA (codigo gravado por nos a partir de decisao confirmada). Nulo = sem vinculo.';
COMMENT ON COLUMN lote_pagamento_item.vinculo_codigo_mascarado IS
    'ADR-0071 I17j — so a mascara 5+4. O esquema recusa codigo longo.';
