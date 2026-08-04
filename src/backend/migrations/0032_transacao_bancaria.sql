-- 0032_transacao_bancaria.sql
-- Frente IV (Recebimentos) — Módulo 1. Movimento bancário importado do Nexxera (raw + normalizado,
-- correlation id, deduplicado por chave natural). Espelho inbound do TituloAPagar do SISPAG.
-- SKELETON (Fase 0): colunas mínimas da entidade; o wire cresce aditivamente na Fase 1 (spike O7).
-- SQL idempotente (re-runnable). Ver ontology/entities/transacao-bancaria.md.
CREATE TABLE IF NOT EXISTS transacao_bancaria (
    id                      TEXT PRIMARY KEY,
    correlation_id          TEXT NOT NULL,
    fil_cod                 INTEGER NOT NULL,
    data_movimento          TIMESTAMPTZ NOT NULL,
    tipo                    TEXT NOT NULL,
    valor                   NUMERIC NOT NULL,
    moeda                   TEXT NOT NULL,
    contraparte             TEXT,
    referencia_bancaria     TEXT,
    -- Chave natural de deduplicação (UNIQUE) — impede reimportar o mesmo movimento.
    natural_key             TEXT NOT NULL,
    raw_payload             JSONB,
    normalized              JSONB,
    status                  TEXT NOT NULL DEFAULT 'importada'
                            CHECK (status IN ('importada', 'conciliada', 'parcial', 'manual', 'erro')),
    import_run_id           TEXT,
    importado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (natural_key)
);

CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_fil_cod ON transacao_bancaria (fil_cod);
CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_status ON transacao_bancaria (status);
CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_correlation ON transacao_bancaria (correlation_id);
