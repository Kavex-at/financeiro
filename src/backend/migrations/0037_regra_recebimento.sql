-- 0037_regra_recebimento.sql
-- Frente IV (Recebimentos) — Módulo 4. Regra de conciliação configurável, versionada e explicável
-- (encomenda / adiantamento-cliente / multa-juros). Estrutura no domínio; valores (percentuais,
-- contas, critérios) são config do cliente (`parametros`). SKELETON (Fase 0); semântica na Fase 4.
-- SQL idempotente. Ver ontology/entities/regra-recebimento.md.
CREATE TABLE IF NOT EXISTS regra_recebimento (
    id                      TEXT PRIMARY KEY,
    tipo                    TEXT NOT NULL,
    versao                  INTEGER NOT NULL DEFAULT 0,
    vigente_de              TIMESTAMPTZ NOT NULL,
    vigente_ate             TIMESTAMPTZ,
    -- Valores configuráveis (percentuais, contas, critérios) — config do cliente.
    parametros              JSONB NOT NULL DEFAULT '{}'::jsonb,
    explicacao              TEXT NOT NULL,
    ativo                   BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tipo, versao)
);

CREATE INDEX IF NOT EXISTS idx_regra_recebimento_tipo ON regra_recebimento (tipo);
CREATE INDEX IF NOT EXISTS idx_regra_recebimento_ativo ON regra_recebimento (ativo);
