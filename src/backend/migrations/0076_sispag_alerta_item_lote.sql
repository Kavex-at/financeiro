-- 0076_sispag_alerta_item_lote.sql
-- ADR-0063 — verificação dos itens TED/PIX do lote SISPAG (I13a–i).
--
-- ── 1. Estado da verificação no item ──────────────────────────────────────────────────────────
--
-- `verificacao_estado`: NULL = nunca verificado (boleto, "a definir"); `PENDENTE` = a última leitura
-- do Conexos falhou (I13b, falha fechada: o finalizar barra); `OK` = verificado. `verificado_em` é a
-- última verificação bem-sucedida. `destino_origem`/`destino_mascarado` são o que a verificação
-- VIU (I13j) para a visão do conferente (I13l): só a origem e a MÁSCARA (I10h) — nunca o valor. O
-- envio continua resolvendo o destino ao vivo (I10a); estas colunas não decidem nada.
--
-- ── 2. `lote_pagamento_item_alerta` (AlertaItemLote) ──────────────────────────────────────────
--
-- Uma linha por sinal da verificação sobre um item NUM lote: duplicidade FORTE/FRACA (contraparte =
-- outro documento da mesma filial) ou canal habitual. A alerta pertence ao item no lote: lote
-- apagado leva as alertas junto (CASCADE); a trilha (0078) não tem FK e sobrevive.
--
-- Garantias no banco (a regra de verdade é do backend):
--   * no máximo UMA alerta viva (ABERTA | RESOLVIDA) por (lote, item, tipo, contraparte) — é a chave
--     da estabilidade da justificativa na re-verificação (I13h);
--   * JUSTIFICADA exige justificativa não vazia; RESOLVIDA exige resolução e quem resolveu.
--
-- Idempotente: `IF NOT EXISTS` e troca de CHECK por `DROP ... IF EXISTS`. Só cria; nada é apagado.

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS verificacao_estado TEXT NULL,
    ADD COLUMN IF NOT EXISTS verificado_em TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS destino_origem TEXT NULL,
    ADD COLUMN IF NOT EXISTS destino_mascarado TEXT NULL;

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_verificacao_estado_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_verificacao_estado_check
    CHECK (verificacao_estado IS NULL OR verificacao_estado IN ('PENDENTE', 'OK'));

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_destino_origem_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_destino_origem_check
    CHECK (destino_origem IS NULL OR destino_origem IN ('CADASTRO', 'EXCECAO', 'NENHUM'));

CREATE TABLE IF NOT EXISTS lote_pagamento_item_alerta (
    id                    UUID PRIMARY KEY,
    lote_id               UUID NOT NULL REFERENCES lote_pagamento(id) ON DELETE CASCADE,
    fil_cod               INTEGER NOT NULL,
    doc_cod               TEXT NOT NULL,
    tit_cod               TEXT NOT NULL,
    tipo                  TEXT NOT NULL,
    contraparte_fil_cod   INTEGER NULL,
    contraparte_doc_cod   TEXT NULL,
    contraparte_titulos   JSONB NULL,
    evidencia             JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado                TEXT NOT NULL DEFAULT 'ABERTA',
    resolucao             TEXT NULL,
    justificativa         TEXT NULL,
    resolvido_por         TEXT NULL,
    resolvido_em          TIMESTAMPTZ NULL,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    verificado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lote_pagamento_item_alerta_tipo_check CHECK (
        tipo IN ('DUPLICIDADE_FORTE', 'DUPLICIDADE_FRACA', 'CANAL_HABITUAL')
    ),
    CONSTRAINT lote_pagamento_item_alerta_estado_check CHECK (
        estado IN ('ABERTA', 'RESOLVIDA', 'OBSOLETA', 'DESCARTADA')
    ),
    CONSTRAINT lote_pagamento_item_alerta_resolucao_check CHECK (
        resolucao IS NULL OR resolucao IN ('JUSTIFICADA', 'RETIRADA')
    ),
    CONSTRAINT lote_pagamento_item_alerta_justificativa_check CHECK (
        resolucao IS DISTINCT FROM 'JUSTIFICADA'
        OR (justificativa IS NOT NULL AND length(btrim(justificativa)) > 0)
    ),
    CONSTRAINT lote_pagamento_item_alerta_resolvida_check CHECK (
        estado <> 'RESOLVIDA' OR (resolucao IS NOT NULL AND resolvido_por IS NOT NULL)
    ),
    CONSTRAINT lote_pagamento_item_alerta_contraparte_check CHECK (
        tipo = 'CANAL_HABITUAL'
        OR (contraparte_fil_cod IS NOT NULL AND contraparte_doc_cod IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lote_pagamento_item_alerta_viva
    ON lote_pagamento_item_alerta (
        lote_id, fil_cod, doc_cod, tit_cod, tipo,
        COALESCE(contraparte_fil_cod, 0), COALESCE(contraparte_doc_cod, '')
    )
    WHERE estado IN ('ABERTA', 'RESOLVIDA');

CREATE INDEX IF NOT EXISTS idx_lote_pagamento_item_alerta_lote
    ON lote_pagamento_item_alerta (lote_id, estado);

COMMENT ON TABLE lote_pagamento_item_alerta IS
    'ADR-0063 — AlertaItemLote: duplicidade (FORTE/FRACA) ou canal habitual de um item TED/PIX num lote. So duplicidade ABERTA barra o finalizar (I13f).';
COMMENT ON COLUMN lote_pagamento_item.verificacao_estado IS
    'ADR-0063 I13b — NULL nunca verificado; PENDENTE leitura do Conexos falhou (barra o finalizar); OK verificado.';
COMMENT ON COLUMN lote_pagamento_item.destino_mascarado IS
    'ADR-0063 I13l — destino que a verificacao viu, SO a mascara (I10h). Nunca o valor completo.';
