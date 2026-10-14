-- 0085_sispag_bloqueio_origem_codigo_barras.sql
-- ADR-0069 emenda 1 (I16d–I16h) — retirada automática de item de código de barras repetido ou
-- ilegível. O título retirado ganha uma `BloqueioDuplicidade` ATIVA (retenção, I16g), com a ORIGEM
-- da marca e os campos que a analista precisa para reconhecer o boleto depois de recarregar a tela.
--
-- Só ADICIONA colunas e CHECKs à `titulo_bloqueio_duplicidade` (0077). Linhas existentes ficam
-- `DUPLICIDADE_TITULO`, sem reescrita. O índice único parcial ATIVO por título é inalterado: um
-- ATIVO por título, qualquer origem — é ele que dá a idempotência de I16d.5.
--
-- ── PRIVACIDADE (I16e) ────────────────────────────────────────────────────────────────────────
-- Só o código MASCARADO persiste (5 primeiros + 4 últimos dígitos, separados por "…"). O CHECK
-- `codigo_mascarado_check` faz o ESQUEMA recusar um código longo: nenhum bug de aplicação grava
-- as 44 barras aqui.
--
-- NÃO altera o CHECK de nomes de evento da trilha (`sispag_verificacao_evento`, 0078): a retirada
-- reaproveita `ITEM_REMOVIDO_SISTEMA` com `dados.motivo` (como `SEM_DADO_PAGAMENTO` já faz) e
-- `BLOQUEIO_CRIADO` para a marca.
--
-- Idempotente (`IF NOT EXISTS` e guarda por `pg_constraint`). Só adiciona.

ALTER TABLE titulo_bloqueio_duplicidade
    ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'DUPLICIDADE_TITULO',
    ADD COLUMN IF NOT EXISTS titulo_mantido_fil_cod INTEGER NULL,
    ADD COLUMN IF NOT EXISTS titulo_mantido_doc_cod TEXT NULL,
    ADD COLUMN IF NOT EXISTS titulo_mantido_tit_cod TEXT NULL,
    ADD COLUMN IF NOT EXISTS codigo_mascarado TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'titulo_bloqueio_duplicidade_origem_check'
          AND conrelid = 'titulo_bloqueio_duplicidade'::regclass
    ) THEN
        ALTER TABLE titulo_bloqueio_duplicidade
            ADD CONSTRAINT titulo_bloqueio_duplicidade_origem_check CHECK (
                origem IN ('DUPLICIDADE_TITULO', 'CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'titulo_bloqueio_duplicidade_codigo_mascarado_check'
          AND conrelid = 'titulo_bloqueio_duplicidade'::regclass
    ) THEN
        ALTER TABLE titulo_bloqueio_duplicidade
            ADD CONSTRAINT titulo_bloqueio_duplicidade_codigo_mascarado_check CHECK (
                codigo_mascarado IS NULL OR codigo_mascarado ~ '^[0-9]{5}…[0-9]{4}$'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'titulo_bloqueio_duplicidade_origem_campos_check'
          AND conrelid = 'titulo_bloqueio_duplicidade'::regclass
    ) THEN
        ALTER TABLE titulo_bloqueio_duplicidade
            ADD CONSTRAINT titulo_bloqueio_duplicidade_origem_campos_check CHECK (
                origem <> 'DUPLICIDADE_TITULO'
                OR (codigo_mascarado IS NULL
                    AND titulo_mantido_fil_cod IS NULL
                    AND titulo_mantido_doc_cod IS NULL
                    AND titulo_mantido_tit_cod IS NULL)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'titulo_bloqueio_duplicidade_titulo_mantido_check'
          AND conrelid = 'titulo_bloqueio_duplicidade'::regclass
    ) THEN
        ALTER TABLE titulo_bloqueio_duplicidade
            ADD CONSTRAINT titulo_bloqueio_duplicidade_titulo_mantido_check CHECK (
                (titulo_mantido_fil_cod IS NULL) = (titulo_mantido_doc_cod IS NULL)
                AND (titulo_mantido_doc_cod IS NULL) = (titulo_mantido_tit_cod IS NULL)
            );
    END IF;
END
$$;
