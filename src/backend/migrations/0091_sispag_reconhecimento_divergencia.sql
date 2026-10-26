-- 0091_sispag_reconhecimento_divergencia.sql
-- ADR-0078 (I15q, I17o, I8c) — reconhecimento TIPADO da divergência de data e o caminho do vínculo
-- do código de barras. Dois blocos, ADITIVOS e idempotentes (colunas nuláveis, CHECKs novos):
--
--   1. `sispag_decisao_sugestao_boleto` ganha o RECONHECIMENTO como propriedade da decisão
--      (não é entidade nem estado): tipo, motivo (10–500), Δdias e valor do boleto vistos,
--      quem reconheceu e quando. Tudo-ou-nada. `reconhecido_por` nunca é `sistema` (o ato é da
--      analista que confirma, I15g). A validade (Δ e valor ainda batem) é DERIVADA, nunca coluna;
--   2. `lote_pagamento_item` ganha o caminho do vínculo (`vinculo_caminho`), o Δdias da barra
--      contra o título e a decisão cujo reconhecimento autorizou o caminho `DATA_DIVERGENTE`.
--
-- Linhas existentes não são reescritas e nada é preenchido: decisão antiga lê
-- `reconhecimento = undefined`; vínculo antigo (`vinculo_caminho` nulo) equivale a
-- `JANELA_PADRAO`. A trilha só-inclusão (trigger da 0084) NÃO é tocada: o reconhecimento viaja no
-- `detalhe` de `DECISAO_CONFIRMADA`, e a invalidação como detalhe de `VINCULO_FALHOU`
-- (`RECONHECIMENTO_INVALIDADO`) — sem tipo novo de evento (ADR-0078).
--
-- Reverse (só estrutura) em `rollbacks/0091_sispag_reconhecimento_divergencia.rollback.sql`.

-- ── 1. Reconhecimento na decisão ──────────────────────────────────────────────────────────────

ALTER TABLE sispag_decisao_sugestao_boleto
    ADD COLUMN IF NOT EXISTS reconhecimento_tipo TEXT NULL,
    ADD COLUMN IF NOT EXISTS reconhecimento_motivo TEXT NULL,
    ADD COLUMN IF NOT EXISTS reconhecimento_delta_dias_visto INTEGER NULL,
    ADD COLUMN IF NOT EXISTS reconhecimento_valor_boleto_visto_centavos BIGINT NULL,
    ADD COLUMN IF NOT EXISTS reconhecido_por TEXT NULL,
    ADD COLUMN IF NOT EXISTS reconhecido_em TIMESTAMPTZ NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_reconhecimento_tipo_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_reconhecimento_tipo_check CHECK (
                reconhecimento_tipo IS NULL OR reconhecimento_tipo IN ('DATA_DIVERGENTE')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_reconhecimento_tudo_ou_nada_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_reconhecimento_tudo_ou_nada_check CHECK (
                (reconhecimento_tipo IS NULL
                    AND reconhecimento_motivo IS NULL
                    AND reconhecimento_delta_dias_visto IS NULL
                    AND reconhecimento_valor_boleto_visto_centavos IS NULL
                    AND reconhecido_por IS NULL
                    AND reconhecido_em IS NULL)
                OR (reconhecimento_tipo IS NOT NULL
                    AND reconhecimento_motivo IS NOT NULL
                    AND reconhecimento_delta_dias_visto IS NOT NULL
                    AND reconhecimento_valor_boleto_visto_centavos IS NOT NULL
                    AND reconhecido_por IS NOT NULL
                    AND reconhecido_em IS NOT NULL)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_reconhecimento_motivo_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_reconhecimento_motivo_check CHECK (
                reconhecimento_tipo IS NULL
                OR length(btrim(reconhecimento_motivo)) BETWEEN 10 AND 500
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_reconhecedor_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_reconhecedor_check CHECK (
                reconhecido_por IS NULL
                OR lower(btrim(reconhecido_por)) NOT IN ('sistema', 'unknown', '')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_reconhecimento_valor_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_reconhecimento_valor_check CHECK (
                reconhecimento_valor_boleto_visto_centavos IS NULL
                OR reconhecimento_valor_boleto_visto_centavos >= 0
            );
    END IF;
END
$$;

-- ── 2. Caminho do vínculo no item do lote ─────────────────────────────────────────────────────

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS vinculo_caminho TEXT NULL,
    ADD COLUMN IF NOT EXISTS vinculo_delta_dias INTEGER NULL,
    ADD COLUMN IF NOT EXISTS vinculo_reconhecimento_id UUID NULL
        REFERENCES sispag_decisao_sugestao_boleto (id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lote_pagamento_item_vinculo_caminho_check'
          AND conrelid = 'lote_pagamento_item'::regclass
    ) THEN
        ALTER TABLE lote_pagamento_item
            ADD CONSTRAINT lote_pagamento_item_vinculo_caminho_check CHECK (
                vinculo_caminho IS NULL OR vinculo_caminho IN ('JANELA_PADRAO', 'DATA_DIVERGENTE')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lote_pagamento_item_vinculo_caminho_coerente_check'
          AND conrelid = 'lote_pagamento_item'::regclass
    ) THEN
        ALTER TABLE lote_pagamento_item
            ADD CONSTRAINT lote_pagamento_item_vinculo_caminho_coerente_check CHECK (
                (vinculo_caminho IS NULL
                    AND vinculo_delta_dias IS NULL
                    AND vinculo_reconhecimento_id IS NULL)
                OR (vinculo_caminho = 'JANELA_PADRAO'
                    AND vinculo_origem = 'DECISAO_HUMANA'
                    AND vinculo_delta_dias IS NOT NULL
                    AND vinculo_reconhecimento_id IS NULL)
                OR (vinculo_caminho = 'DATA_DIVERGENTE'
                    AND vinculo_origem = 'DECISAO_HUMANA'
                    AND vinculo_delta_dias IS NOT NULL
                    AND vinculo_reconhecimento_id IS NOT NULL)
            );
    END IF;
END
$$;

COMMENT ON COLUMN sispag_decisao_sugestao_boleto.reconhecimento_tipo IS
    'ADR-0078 I15q — reconhecimento tipado da divergencia de data (propriedade da decisao, nao estado). Validade e derivada (delta e valor ainda batem), nunca coluna.';
COMMENT ON COLUMN lote_pagamento_item.vinculo_caminho IS
    'ADR-0078 I17o — JANELA_PADRAO | DATA_DIVERGENTE. Nulo = vinculo anterior a 0091 (equivale a JANELA_PADRAO).';
