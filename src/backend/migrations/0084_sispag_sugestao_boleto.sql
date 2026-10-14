-- 0084_sispag_sugestao_boleto.sql
-- ADR-0068 (I15) — sugestão de boleto DDA com confirmação de emissor por credor. Passo 1 de 3:
-- o analista vê o boleto livre do `fin124` que provavelmente é o do título "boleto sem DDA" e
-- registra a decisão dele. ZERO escrita no Conexos: estas tabelas são só evidência (I15a/I15b).
--
-- ── 1. `sispag_confirmacao_emissor_boleto` — o PAR (credor, emissor) ──────────────────────────
--
-- "Os boletos emitidos por esta conta bancária pertencem a este credor", afirmado por uma pessoa.
-- No máximo UMA `VIGENTE` por (pes_cod, emissor_chave) — índice único parcial; `REVOGADA` é
-- terminal e reconfirmar cria linha nova. `emissor_chave` (ex.: `237:2656:0092740`) é derivada do
-- código de barras e exibida mascarada. NENHUMA coluna guarda a linha digitável nem as barras de
-- 44 dígitos (I15k): o snapshot da evidência traz só o `codbar` mascarado.
--
-- ── 2. `sispag_decisao_sugestao_boleto` — a decisão POR TÍTULO ────────────────────────────────
--
-- Quem olhou a sugestão (título × boleto) e a confirmou ou rejeitou, com a evidência (deltas com
-- sinal, boleto − título). Unicidade por índices únicos parciais: 1 CONFIRMADA por título, 1
-- CONFIRMADA por boleto, 1 REJEITADA por (título, boleto) — o perdedor da corrida relê (I15j).
--
-- ── 3. `sispag_sugestao_boleto_evento` — trilha só-inclusão ───────────────────────────────────
--
-- Inclui `LINHA_COPIADA` (toda cópia de linha digitável é auditada, I15k). Trigger recusa UPDATE,
-- DELETE e TRUNCATE (padrão 0078/0080).
--
-- Aditiva e idempotente: só tabelas, índices e trigger novos; nenhuma escrita em dado existente e
-- nenhuma permissão nova (usa `sispag:ver` / `sispag:executar`, ADR-0053). O reverse (só
-- estrutura) está em `rollbacks/0084_sispag_sugestao_boleto.rollback.sql`.

-- ── 1. Par (credor, emissor) ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_confirmacao_emissor_boleto (
    id                  UUID PRIMARY KEY,
    pes_cod             TEXT NOT NULL,
    credor              TEXT NULL,
    emissor_chave       TEXT NOT NULL,
    layout_emissor      TEXT NOT NULL,
    banco_emissor       TEXT NOT NULL,
    emissor_mascarado   TEXT NOT NULL,
    estado              TEXT NOT NULL DEFAULT 'VIGENTE',
    evidencia           JSONB NOT NULL DEFAULT '{}'::jsonb,
    confirmado_por      TEXT NOT NULL,
    confirmado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revogado_por        TEXT NULL,
    revogado_em         TIMESTAMPTZ NULL,
    motivo_revogacao    TEXT NULL,
    versao              INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT sispag_confirmacao_emissor_boleto_layout_check CHECK (
        layout_emissor IN ('ITAU_341', 'BRADESCO_237', 'GENERICO')
    ),
    CONSTRAINT sispag_confirmacao_emissor_boleto_estado_check CHECK (
        estado IN ('VIGENTE', 'REVOGADA')
    ),
    CONSTRAINT sispag_confirmacao_emissor_boleto_revogacao_check CHECK (
        estado <> 'REVOGADA'
        OR (
            motivo_revogacao IS NOT NULL AND length(btrim(motivo_revogacao)) > 0
            AND revogado_por IS NOT NULL
            AND revogado_em IS NOT NULL
        )
    ),
    CONSTRAINT sispag_confirmacao_emissor_boleto_pes_cod_check CHECK (
        length(btrim(pes_cod)) > 0
    ),
    CONSTRAINT sispag_confirmacao_emissor_boleto_ator_check CHECK (
        lower(btrim(confirmado_por)) <> 'sistema'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_confirmacao_emissor_boleto_vigente
    ON sispag_confirmacao_emissor_boleto (pes_cod, emissor_chave)
    WHERE estado = 'VIGENTE';

CREATE INDEX IF NOT EXISTS idx_sispag_confirmacao_emissor_boleto_estado
    ON sispag_confirmacao_emissor_boleto (estado, confirmado_em);

-- ── 2. Decisão por título ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_decisao_sugestao_boleto (
    id                          UUID PRIMARY KEY,
    fil_cod                     INTEGER NOT NULL,
    doc_cod                     TEXT NOT NULL,
    tit_cod                     TEXT NOT NULL,
    pes_cod                     TEXT NOT NULL,
    credor                      TEXT NULL,
    ddc_cod                     INTEGER NOT NULL,
    dit_cod                     INTEGER NOT NULL,
    numero_boleto               TEXT NULL,
    codbar_mascarado            TEXT NOT NULL,
    valor_titulo                NUMERIC(15, 2) NOT NULL,
    vencimento_titulo           DATE NOT NULL,
    valor_boleto                NUMERIC(15, 2) NOT NULL,
    vencimento_boleto           DATE NOT NULL,
    delta_valor                 NUMERIC(15, 2) NOT NULL,
    delta_percentual            NUMERIC(10, 4) NOT NULL,
    delta_dias                  INTEGER NOT NULL,
    sinais                      JSONB NOT NULL DEFAULT '[]'::jsonb,
    tier                        TEXT NULL,
    emissor_chave               TEXT NOT NULL,
    decisao                     TEXT NOT NULL,
    decidido_por                TEXT NOT NULL,
    decidido_em                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    motivo                      TEXT NULL,
    confirmacao_emissor_id      UUID NULL REFERENCES sispag_confirmacao_emissor_boleto (id),
    CONSTRAINT sispag_decisao_sugestao_boleto_tier_check CHECK (
        tier IS NULL OR tier IN ('CONHECIDO', 'FORTE', 'ATENCAO')
    ),
    CONSTRAINT sispag_decisao_sugestao_boleto_decisao_check CHECK (
        decisao IN ('CONFIRMADA', 'REJEITADA')
    ),
    CONSTRAINT sispag_decisao_sugestao_boleto_rejeicao_check CHECK (
        decisao <> 'REJEITADA' OR (motivo IS NOT NULL AND length(btrim(motivo)) > 0)
    ),
    CONSTRAINT sispag_decisao_sugestao_boleto_confirmacao_check CHECK (
        decisao <> 'CONFIRMADA' OR (confirmacao_emissor_id IS NOT NULL AND tier IS NOT NULL)
    ),
    CONSTRAINT sispag_decisao_sugestao_boleto_pes_cod_check CHECK (
        length(btrim(pes_cod)) > 0
    ),
    CONSTRAINT sispag_decisao_sugestao_boleto_ator_check CHECK (
        lower(btrim(decidido_por)) <> 'sistema'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_decisao_sugestao_boleto_confirmada_titulo
    ON sispag_decisao_sugestao_boleto (fil_cod, doc_cod, tit_cod)
    WHERE decisao = 'CONFIRMADA';

CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_decisao_sugestao_boleto_confirmada_boleto
    ON sispag_decisao_sugestao_boleto (ddc_cod, dit_cod)
    WHERE decisao = 'CONFIRMADA';

CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_decisao_sugestao_boleto_rejeitada
    ON sispag_decisao_sugestao_boleto (fil_cod, doc_cod, tit_cod, ddc_cod, dit_cod)
    WHERE decisao = 'REJEITADA';

CREATE INDEX IF NOT EXISTS idx_sispag_decisao_sugestao_boleto_confirmacao
    ON sispag_decisao_sugestao_boleto (confirmacao_emissor_id);

-- ── 3. Trilha só-inclusão ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_sugestao_boleto_evento (
    id              UUID PRIMARY KEY,
    tipo            TEXT NOT NULL,
    ator            TEXT NOT NULL,
    ocorrido_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    pes_cod         TEXT NULL,
    emissor_chave   TEXT NULL,
    fil_cod         INTEGER NULL,
    doc_cod         TEXT NULL,
    tit_cod         TEXT NULL,
    ddc_cod         INTEGER NULL,
    dit_cod         INTEGER NULL,
    motivo          TEXT NULL,
    detalhe         JSONB NULL,
    CONSTRAINT sispag_sugestao_boleto_evento_tipo_check CHECK (tipo IN (
        'PAR_CONFIRMADO', 'DECISAO_CONFIRMADA', 'DECISAO_REJEITADA', 'PAR_REVOGADO', 'LINHA_COPIADA'
    ))
);

CREATE INDEX IF NOT EXISTS idx_sispag_sugestao_boleto_evento_ator
    ON sispag_sugestao_boleto_evento (ator, tipo, ocorrido_em);

CREATE INDEX IF NOT EXISTS idx_sispag_sugestao_boleto_evento_titulo
    ON sispag_sugestao_boleto_evento (fil_cod, doc_cod, tit_cod, ocorrido_em);

CREATE OR REPLACE FUNCTION sispag_sugestao_boleto_evento_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha da sugestao de boleto e so de inclusao: % recusado (ADR-0068 I15)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sispag_sugestao_boleto_evento_so_inclusao
    ON sispag_sugestao_boleto_evento;

CREATE TRIGGER trg_sispag_sugestao_boleto_evento_so_inclusao
    BEFORE UPDATE OR DELETE ON sispag_sugestao_boleto_evento
    FOR EACH ROW
    EXECUTE FUNCTION sispag_sugestao_boleto_evento_so_inclusao();

DROP TRIGGER IF EXISTS trg_sispag_sugestao_boleto_evento_so_inclusao_truncate
    ON sispag_sugestao_boleto_evento;

CREATE TRIGGER trg_sispag_sugestao_boleto_evento_so_inclusao_truncate
    BEFORE TRUNCATE ON sispag_sugestao_boleto_evento
    FOR EACH STATEMENT
    EXECUTE FUNCTION sispag_sugestao_boleto_evento_so_inclusao();

COMMENT ON TABLE sispag_confirmacao_emissor_boleto IS
    'ADR-0068 I15 — par (credor, emissor) confirmado por uma pessoa com sispag:executar. Evidencia, nao autoridade: nao altera tem_boleto, lote nem Conexos. Nunca guarda barras/linha digitavel.';
COMMENT ON TABLE sispag_decisao_sugestao_boleto IS
    'ADR-0068 I15 — decisao por titulo (CONFIRMADA/REJEITADA) com snapshot da evidencia (deltas com sinal, boleto - titulo). So codbar mascarado.';
COMMENT ON TABLE sispag_sugestao_boleto_evento IS
    'ADR-0068 I15k — trilha so-inclusao (inclui LINHA_COPIADA). UPDATE/DELETE/TRUNCATE recusados por trigger. Nunca valor completo.';
