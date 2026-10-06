-- 0078_sispag_perfil_canal_conferencia.sql
-- ADR-0063 — perfil de canal do favorecido (I13i), conferência por 2ª pessoa (I13l; L12/L13) e a
-- trilha só-inclusão da verificação TED/PIX (I13m).
--
-- ── 1. `perfil_canal_fornecedor` (PerfilCanalFornecedor) ──────────────────────────────────────
--
-- Read model persistido pelo job `calcular-perfil-canal` (read-only no ERP). Um perfil por
-- favorecido (`pes_cod`, gap Q4). Rodada que falha não apaga perfil: o job grava em transação e só
-- substitui o que recalculou.
--
-- ── 2. Conferência no lote ───────────────────────────────────────────────────────────────────
--
-- Atributo do FINALIZADO, não status novo: `conferido_por/em` (L12), `devolvido_por/em` e
-- `motivo_devolucao` (L13). Reabrir (L4) e devolver (L13) limpam a conferência.
--
-- ── 3. `sispag_verificacao_evento` (I13m) ────────────────────────────────────────────────────
--
-- Trilha SÓ-INCLUSÃO de todo evento de verificação, bloqueio, pendência, remoção pelo sistema e
-- conferência/devolução, com ator e instante. Sem FK (lote apagado não apaga a trilha). Mesmo padrão
-- da 0075: trigger recusa UPDATE, DELETE e TRUNCATE. Conta/chave nunca entram em `dados` (I10h).
--
-- Idempotente. Só cria.

CREATE TABLE IF NOT EXISTS perfil_canal_fornecedor (
    pes_cod              TEXT PRIMARY KEY,
    credor               TEXT NULL,
    contagens            JSONB NOT NULL,
    pagamentos_unicos    INTEGER NOT NULL,
    meses_distintos      INTEGER NOT NULL,
    grupo_dominante      TEXT NOT NULL,
    participacao         NUMERIC(5, 4) NOT NULL,
    confianca            TEXT NOT NULL,
    janela_inicio        TIMESTAMPTZ NOT NULL,
    janela_fim           TIMESTAMPTZ NOT NULL,
    calculado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    job_run_id           TEXT NOT NULL,
    CONSTRAINT perfil_canal_fornecedor_grupo_check CHECK (
        grupo_dominante IN ('BOLETO', 'TED_PIX', 'OUTROS')
    ),
    CONSTRAINT perfil_canal_fornecedor_confianca_check CHECK (
        confianca IN ('ALTA', 'MEDIA', 'BAIXA')
    ),
    CONSTRAINT perfil_canal_fornecedor_participacao_check CHECK (
        participacao >= 0 AND participacao <= 1
    )
);

ALTER TABLE lote_pagamento
    ADD COLUMN IF NOT EXISTS conferido_por TEXT NULL,
    ADD COLUMN IF NOT EXISTS conferido_em TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS devolvido_por TEXT NULL,
    ADD COLUMN IF NOT EXISTS devolvido_em TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS motivo_devolucao TEXT NULL;

CREATE TABLE IF NOT EXISTS sispag_verificacao_evento (
    id              UUID PRIMARY KEY,
    evento          TEXT NOT NULL,
    ator            TEXT NOT NULL,
    ocorrido_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    lote_id         UUID NULL,
    fil_cod         INTEGER NULL,
    doc_cod         TEXT NULL,
    tit_cod         TEXT NULL,
    alerta_id       UUID NULL,
    bloqueio_id     UUID NULL,
    pendencia_id    UUID NULL,
    dados           JSONB NULL,
    CONSTRAINT sispag_verificacao_evento_evento_check CHECK (evento IN (
        'ALERTA_CRIADA', 'ALERTA_JUSTIFICADA', 'ALERTA_RETIRADA', 'ALERTA_OBSOLETA',
        'ALERTA_DESCARTADA', 'BLOQUEIO_CRIADO', 'BLOQUEIO_ENCERRADO', 'BLOQUEIO_DESFEITO',
        'PENDENCIA_ABERTA', 'PENDENCIA_ORIGEM_ACRESCENTADA', 'PENDENCIA_RESOLVIDA',
        'ITEM_REMOVIDO_SISTEMA', 'LOTE_CONFERIDO', 'LOTE_DEVOLVIDO', 'CONFERENCIA_LIMPA'
    ))
);

CREATE INDEX IF NOT EXISTS idx_sispag_verificacao_evento_lote
    ON sispag_verificacao_evento (lote_id, ocorrido_em);

CREATE OR REPLACE FUNCTION sispag_verificacao_evento_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha da verificacao TED/PIX e so de inclusao: % recusado (ADR-0063 I13m)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sispag_verificacao_evento_so_inclusao ON sispag_verificacao_evento;

CREATE TRIGGER trg_sispag_verificacao_evento_so_inclusao
    BEFORE UPDATE OR DELETE ON sispag_verificacao_evento
    FOR EACH ROW
    EXECUTE FUNCTION sispag_verificacao_evento_so_inclusao();

DROP TRIGGER IF EXISTS trg_sispag_verificacao_evento_so_inclusao_truncate
    ON sispag_verificacao_evento;

CREATE TRIGGER trg_sispag_verificacao_evento_so_inclusao_truncate
    BEFORE TRUNCATE ON sispag_verificacao_evento
    FOR EACH STATEMENT
    EXECUTE FUNCTION sispag_verificacao_evento_so_inclusao();

COMMENT ON TABLE perfil_canal_fornecedor IS
    'ADR-0063 I13i — canal pelo qual o favorecido costuma ser pago (fin010 x fin095, casamento unico). So ALTA gera alerta.';
COMMENT ON TABLE sispag_verificacao_evento IS
    'ADR-0063 I13m — trilha so-inclusao da verificacao TED/PIX. UPDATE/DELETE/TRUNCATE recusados por trigger.';
COMMENT ON COLUMN lote_pagamento.conferido_por IS
    'ADR-0063 I13l — conferente (2a pessoa) do lote com TED/PIX. Limpo por reabrir (L4) e devolver (L13).';
