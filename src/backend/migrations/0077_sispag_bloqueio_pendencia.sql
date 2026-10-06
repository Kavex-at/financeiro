-- 0077_sispag_bloqueio_pendencia.sql
-- ADR-0063 — bloqueio por duplicidade (I13g) e pendência de cadastro (I13j, I13k).
--
-- ── 1. `titulo_bloqueio_duplicidade` (BloqueioDuplicidade) ────────────────────────────────────
--
-- Marca LOCAL num título a pagar que a analista retirou do lote por duplicidade ("cancelamento
-- pendente no Conexos"). Tabela própria, não coluna de `titulo_a_pagar`: a ingestão faz UPSERT do
-- título a cada rodada e apagaria a marca. Enquanto ATIVO, o título não entra na formação
-- automática nem na inclusão manual. `ATIVO → ENCERRADO` quando a ingestão vê o título inativo;
-- `ATIVO → DESFEITO` pela analista, com motivo. No máximo UM ATIVO por título.
--
-- ── 2. `pendencia_cadastro` + `pendencia_cadastro_origem` (PendenciaCadastro) ─────────────────
--
-- O favorecido precisa de conta (TED) ou chave PIX (PIX) no cadastro do Conexos. No máximo UMA
-- ABERTA por (favorecido, tipo); ocorrência nova acrescenta uma ORIGEM (título + lote + desfecho),
-- não abre outra pendência. `ABERTA → RESOLVIDA` só pelo sistema, quando o cadastro passa a ter o
-- dado. Conta/chave nunca são gravadas aqui: a pendência é a AUSÊNCIA do dado (I10h).
-- `fil_cod` é a filial usada para LER o cadastro do favorecido (a leitura do cmn025 é por filial).
--
-- Idempotente (`IF NOT EXISTS`). Só cria.

CREATE TABLE IF NOT EXISTS titulo_bloqueio_duplicidade (
    id                UUID PRIMARY KEY,
    fil_cod           INTEGER NOT NULL,
    doc_cod           TEXT NOT NULL,
    tit_cod           TEXT NOT NULL,
    pes_cod           TEXT NULL,
    alerta_id         UUID NULL,
    lote_id_origem    UUID NULL,
    motivo            TEXT NOT NULL,
    estado            TEXT NOT NULL DEFAULT 'ATIVO',
    marcado_por       TEXT NOT NULL,
    marcado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    encerrado_em      TIMESTAMPTZ NULL,
    desfeito_por      TEXT NULL,
    desfeito_em       TIMESTAMPTZ NULL,
    motivo_desfazer   TEXT NULL,
    CONSTRAINT titulo_bloqueio_duplicidade_estado_check CHECK (
        estado IN ('ATIVO', 'ENCERRADO', 'DESFEITO')
    ),
    CONSTRAINT titulo_bloqueio_duplicidade_motivo_check CHECK (length(btrim(motivo)) > 0),
    CONSTRAINT titulo_bloqueio_duplicidade_desfeito_check CHECK (
        estado <> 'DESFEITO'
        OR (desfeito_por IS NOT NULL AND desfeito_em IS NOT NULL
            AND motivo_desfazer IS NOT NULL AND length(btrim(motivo_desfazer)) > 0)
    ),
    CONSTRAINT titulo_bloqueio_duplicidade_encerrado_check CHECK (
        estado <> 'ENCERRADO' OR encerrado_em IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_titulo_bloqueio_duplicidade_ativo
    ON titulo_bloqueio_duplicidade (fil_cod, doc_cod, tit_cod)
    WHERE estado = 'ATIVO';

CREATE TABLE IF NOT EXISTS pendencia_cadastro (
    id                       UUID PRIMARY KEY,
    pes_cod                  TEXT NOT NULL,
    fil_cod                  INTEGER NOT NULL,
    credor                   TEXT NULL,
    tipo                     TEXT NOT NULL,
    estado                   TEXT NOT NULL DEFAULT 'ABERTA',
    aberta_por               TEXT NOT NULL,
    aberta_em                TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolvida_por            TEXT NULL,
    resolvida_em             TIMESTAMPTZ NULL,
    ultima_conferencia_em    TIMESTAMPTZ NULL,
    CONSTRAINT pendencia_cadastro_tipo_check CHECK (tipo IN ('CONTA', 'CHAVE_PIX')),
    CONSTRAINT pendencia_cadastro_estado_check CHECK (estado IN ('ABERTA', 'RESOLVIDA')),
    CONSTRAINT pendencia_cadastro_resolvida_check CHECK (
        estado <> 'RESOLVIDA' OR (resolvida_por IS NOT NULL AND resolvida_em IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pendencia_cadastro_aberta
    ON pendencia_cadastro (pes_cod, tipo)
    WHERE estado = 'ABERTA';

CREATE INDEX IF NOT EXISTS idx_pendencia_cadastro_estado
    ON pendencia_cadastro (estado, aberta_em);

CREATE TABLE IF NOT EXISTS pendencia_cadastro_origem (
    id               UUID PRIMARY KEY,
    pendencia_id     UUID NOT NULL REFERENCES pendencia_cadastro(id),
    lote_id          UUID NOT NULL,
    fil_cod          INTEGER NOT NULL,
    doc_cod          TEXT NOT NULL,
    tit_cod          TEXT NOT NULL,
    desfecho         TEXT NOT NULL,
    registrada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pendencia_cadastro_origem_desfecho_check CHECK (
        desfecho IN ('RETIRADO', 'MANTIDO_POR_EXCECAO')
    ),
    CONSTRAINT pendencia_cadastro_origem_unica UNIQUE (
        pendencia_id, lote_id, fil_cod, doc_cod, tit_cod, desfecho
    )
);

COMMENT ON TABLE titulo_bloqueio_duplicidade IS
    'ADR-0063 I13g — titulo retirado do lote por duplicidade: fora da formacao automatica e da inclusao enquanto ATIVO. Nenhuma escrita no Conexos.';
COMMENT ON TABLE pendencia_cadastro IS
    'ADR-0063 I13k — favorecido sem conta/chave PIX no cadastro do Conexos. Uma ABERTA por (pes_cod, tipo); resolvida so pelo sistema.';
