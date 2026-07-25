-- 0034_rateio_recebimento.sql
-- Frente IV (Recebimentos) — Módulo 3. Parcela de alocação: distribui parte do valor recebido sobre
-- um documento/processo/componente. Rascunho revisável (espelha permuta_alocacao); membro do
-- agregado Recebimento. `finalidade` NOT NULL (invariante do rateio). SKELETON (Fase 0). Idempotente.
-- Ver ontology/entities/rateio-recebimento.md e business-rules/invariante-rateio.md.
CREATE TABLE IF NOT EXISTS rateio_recebimento (
    id                      TEXT PRIMARY KEY,
    recebimento_id          TEXT NOT NULL REFERENCES recebimento (id),
    doc_cod                 TEXT NOT NULL,
    tit_cod                 TEXT NOT NULL,
    fil_cod                 INTEGER NOT NULL,
    pri_cod                 TEXT,
    componente              TEXT,
    -- Toda parcela tem finalidade (invariante do rateio).
    finalidade              TEXT NOT NULL,
    valor_alocado           NUMERIC NOT NULL,
    moeda                   TEXT NOT NULL,
    incluido_por            TEXT NOT NULL,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rateio_recebimento_recebimento ON rateio_recebimento (recebimento_id);
CREATE INDEX IF NOT EXISTS idx_rateio_recebimento_doc ON rateio_recebimento (fil_cod, doc_cod, tit_cod);
