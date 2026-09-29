-- 0067_sispag_destino_manual.sql
-- ADR-0054 — destino de TED/PIX digitado pela analista NO ITEM do lote (D1), com precedência sobre
-- o cadastro do Conexos (D2), e a trilha só-inclusão que a acompanha (I10g).
--
-- ── O QUE ENTRA ────────────────────────────────────────────────────────────────────────────────
--
-- `lote_pagamento_item.destino_manual` — JSON discriminado por `tipo`:
--   CONTA     {bancoCod, agencia, agenciaDv?, conta, contaDv, titularDocumento}
--   CHAVE_PIX {chavePixTipo, chavePix, titularDocumento}
-- Gravado COMPLETO porque vai no payload do item do fin015 (sem `pctCodSeq`). NULL = sem destino
-- digitado (vale o cadastro). Nada disto é escrito no cmn025 (D1). O formato é validado por Zod na
-- borda de leitura e de escrita — o banco guarda, não interpreta.
--
-- `lote_pagamento_item_destino_audit` — uma linha por gravação/limpeza: quem, quando, antes e
-- depois (valor completo: é a trilha que o ERP não terá, porque nada vai para `ctcorr/log`).
--
-- ── POR QUE A TRILHA É PROTEGIDA NO BANCO ─────────────────────────────────────────────────────
--
-- Trocar o destino de um pagamento é o vetor clássico de fraude (ADR-0054 D2, "risco
-- reconhecido"). Uma trilha que o próprio código pode reescrever não prova nada. O trigger recusa
-- UPDATE, DELETE e TRUNCATE; só INSERT passa. Mesma razão do trigger da 0057: é a única camada que
-- sobrevive a um bug ou a um rollback do código.
--
-- Sem FK para `lote_pagamento`, de propósito: `desfazerAutomaticosVencidos` apaga lotes RASCUNHO, e
-- uma FK em cascata tentaria apagar a trilha (o trigger barraria e o DELETE do lote quebraria).
-- A trilha sobrevive ao lote — que é o que se quer de uma trilha.
--
-- SQL idempotente: `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`.

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS destino_manual JSONB NULL;

CREATE TABLE IF NOT EXISTS lote_pagamento_item_destino_audit (
    id              UUID PRIMARY KEY,
    lote_id         UUID NOT NULL,
    fil_cod         INTEGER NOT NULL,
    doc_cod         TEXT NOT NULL,
    tit_cod         TEXT NOT NULL,
    alterado_por    TEXT NOT NULL,
    alterado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    antes           JSONB,
    depois          JSONB
);

CREATE INDEX IF NOT EXISTS idx_destino_audit_item
    ON lote_pagamento_item_destino_audit (lote_id, fil_cod, doc_cod, tit_cod, alterado_em DESC);

CREATE OR REPLACE FUNCTION lote_pagamento_item_destino_audit_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha de destino de pagamento e so de inclusao: % recusado (ADR-0054 I10g)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_destino_audit_so_inclusao ON lote_pagamento_item_destino_audit;

CREATE TRIGGER trg_destino_audit_so_inclusao
    BEFORE UPDATE OR DELETE ON lote_pagamento_item_destino_audit
    FOR EACH ROW
    EXECUTE FUNCTION lote_pagamento_item_destino_audit_so_inclusao();

DROP TRIGGER IF EXISTS trg_destino_audit_so_inclusao_truncate ON lote_pagamento_item_destino_audit;

CREATE TRIGGER trg_destino_audit_so_inclusao_truncate
    BEFORE TRUNCATE ON lote_pagamento_item_destino_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION lote_pagamento_item_destino_audit_so_inclusao();

COMMENT ON TABLE lote_pagamento_item_destino_audit IS
    'ADR-0054 I10g — trilha so-inclusao do destino de pagamento digitado no item do lote SISPAG. UPDATE/DELETE/TRUNCATE recusados por trigger.';
COMMENT ON COLUMN lote_pagamento_item.destino_manual IS
    'ADR-0054 D1 — destino TED/PIX digitado pela analista para este item (vence o cadastro). Dado sensivel: nunca em log nem em remessa_execucao.request_payload.';
