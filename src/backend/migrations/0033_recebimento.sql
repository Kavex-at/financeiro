-- 0033_recebimento.sql
-- Frente IV (Recebimentos) — a SPINE. Agregado de conciliação (crédito ↔ recebíveis ↔ rateio ↔
-- execução). Estado LOCAL persistido (não do ERP), espelha o LotePagamento. Ciclo:
-- rascunho → aprovado → executado → estornado. SKELETON (Fase 0). SQL idempotente.
-- Ver ontology/entities/recebimento.md e state-machines/recebimento.md.
CREATE TABLE IF NOT EXISTS recebimento (
    id                      TEXT PRIMARY KEY,
    correlation_id          TEXT NOT NULL,
    transacao_id            TEXT NOT NULL REFERENCES transacao_bancaria (id),
    fil_cod                 INTEGER NOT NULL,
    classificacao_match     TEXT NOT NULL
                            CHECK (classificacao_match IN ('unica', 'multiplas', 'parcial', 'nenhuma')),
    status                  TEXT NOT NULL DEFAULT 'rascunho'
                            CHECK (status IN ('rascunho', 'aprovado', 'executado', 'estornado')),
    valor_recebido          NUMERIC NOT NULL,
    resultado_execucao      JSONB,
    nde_id                  TEXT,
    -- Concorrência otimista (espelha o I6 do lote).
    versao                  INTEGER NOT NULL DEFAULT 0,
    criado_por              TEXT NOT NULL,
    aprovado_por            TEXT,
    executado_por           TEXT,
    estornado_por           TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recebimento_fil_cod ON recebimento (fil_cod);
CREATE INDEX IF NOT EXISTS idx_recebimento_status ON recebimento (status);
CREATE INDEX IF NOT EXISTS idx_recebimento_transacao ON recebimento (transacao_id);
CREATE INDEX IF NOT EXISTS idx_recebimento_correlation ON recebimento (correlation_id);
