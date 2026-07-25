-- 0038_nota_debito_eletronica.sql
-- Frente IV (Recebimentos) — Módulo 5. NDe: artefato terminal da conciliação, EMITIDA pelo Conexos.
-- Registro LOCAL só para idempotência + auditoria (a fonte da verdade é o ERP). `idempotency_key`
-- UNIQUE garante uma NDe por Recebimento (retry nunca emite duas). SKELETON (Fase 0); contrato de
-- emissão na Fase 5. SQL idempotente. Ver ontology/entities/nota-debito-eletronica.md.
CREATE TABLE IF NOT EXISTS nota_debito_eletronica (
    id                      TEXT PRIMARY KEY,
    recebimento_id          TEXT NOT NULL,
    fil_cod                 INTEGER NOT NULL,
    correlation_id          TEXT NOT NULL,
    numero_nde              TEXT,
    valor                   NUMERIC NOT NULL,
    moeda                   TEXT NOT NULL,
    status_emissao          TEXT NOT NULL DEFAULT 'pendente'
                            CHECK (status_emissao IN ('pendente', 'emitida', 'erro')),
    -- UNIQUE — garante uma NDe por Recebimento.
    idempotency_key         TEXT NOT NULL,
    erp_response            JSONB,
    emitida_em              TIMESTAMPTZ,
    emitida_por             TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_nde_recebimento ON nota_debito_eletronica (recebimento_id);
CREATE INDEX IF NOT EXISTS idx_nde_fil_cod ON nota_debito_eletronica (fil_cod);
CREATE INDEX IF NOT EXISTS idx_nde_status ON nota_debito_eletronica (status_emissao);
