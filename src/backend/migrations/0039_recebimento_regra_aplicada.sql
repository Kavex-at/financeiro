-- 0039_recebimento_regra_aplicada.sql
-- Frente IV (Recebimentos) — associação (membro do agregado) entre um Recebimento e as versões de
-- `regra_recebimento` efetivamente aplicadas nele (Regis modifiability-1). Sem esta tabela, um reload
-- do agregado perde `regrasAplicadas` e força recomputo — risco de inconsistência silenciosa (Fase 3).
-- A raiz + rateios + esta associação são persistidos NA MESMA TRANSAÇÃO por RecebimentoRepository.save.
-- SQL idempotente. Ver ontology/entities/recebimento.md.
CREATE TABLE IF NOT EXISTS recebimento_regra_aplicada (
    recebimento_id          TEXT NOT NULL REFERENCES recebimento (id),
    regra_id                TEXT NOT NULL,
    tipo                    TEXT NOT NULL,
    versao                  INTEGER NOT NULL,
    vigente_de              TIMESTAMPTZ NOT NULL,
    vigente_ate             TIMESTAMPTZ,
    parametros              JSONB NOT NULL DEFAULT '{}'::jsonb,
    explicacao              TEXT NOT NULL,
    ativo                   BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (recebimento_id, regra_id)
);

CREATE INDEX IF NOT EXISTS idx_recebimento_regra_aplicada_receb
    ON recebimento_regra_aplicada (recebimento_id);
