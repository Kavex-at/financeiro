-- 0036_credito_cliente.sql
-- Frente IV (Recebimentos) — adiantamento DE cliente (entidade nova). Cliente paga antes de o
-- recebível maturar → crédito a aplicar em recebíveis futuros. Oposto direcional do Adiantamento
-- (Frente I). SKELETON (Fase 0); ciclo/consumo detalhados na Fase 4. SQL idempotente.
-- Ver ontology/entities/credito-cliente.md e business-rules/adiantamento-cliente.md.
CREATE TABLE IF NOT EXISTS credito_cliente (
    id                      TEXT PRIMARY KEY,
    fil_cod                 INTEGER NOT NULL,
    cliente                 TEXT,
    pes_cod                 TEXT,
    valor_original          NUMERIC NOT NULL,
    -- Saldo ainda não aplicado (decresce ao consumir em rateios).
    valor_disponivel        NUMERIC NOT NULL,
    moeda                   TEXT NOT NULL,
    origem_recebimento_id   TEXT,
    status                  TEXT NOT NULL DEFAULT 'disponivel'
                            CHECK (status IN ('disponivel', 'parcial', 'consumido')),
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credito_cliente_fil_cod ON credito_cliente (fil_cod);
CREATE INDEX IF NOT EXISTS idx_credito_cliente_pes_cod ON credito_cliente (pes_cod);
CREATE INDEX IF NOT EXISTS idx_credito_cliente_status ON credito_cliente (status);
