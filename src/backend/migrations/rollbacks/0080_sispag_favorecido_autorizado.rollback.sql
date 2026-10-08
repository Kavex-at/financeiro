-- Reverse da 0080 (favorecido autorizado, ADR-0065). SÓ ESTRUTURA.
--
-- QUANDO: só depois de voltar o backend para uma versão anterior à 0080 (v0.58.x). Com o backend
-- novo no ar, recriar as colunas antigas é inofensivo, mas apagar `sispag_favorecido_autorizado`
-- derruba toda TED/PIX (a guarda L8 passa a falhar fechado).
--
-- O QUE SE PERDE: todas as autorizações de favorecido e a trilha delas (exporte antes):
--   \copy (SELECT * FROM sispag_favorecido_autorizado) TO 'favorecidos.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_favorecido_autorizado_evento) TO 'favorecidos-eventos.csv' CSV HEADER
--
-- O QUE NÃO VOLTA: o CONTEÚDO das tabelas e colunas que a 0080 apagou. Os dados não são
-- reconstruíveis por construção — e não precisam ser: a guarda da 0080 só a deixou rodar com as
-- cinco tabelas vazias e nenhum `destino_manual` preenchido. Aqui elas renascem vazias.
-- A conferência de lote (`conferido_por` etc.) renasce NULA: lote FINALIZADO com TED/PIX volta a
-- exigir conferência na versão antiga.
--
-- As concessões de `sispag:autorizar_favorecido` voltam a ser `sispag:excecao` (a 0080 converteu no
-- sentido contrário). `sispag:conferir`/`sispag:cadastro` voltam ao catálogo SEM concessão (como a
-- 0079 as criou). Alertas `sispag-destino-alterado` são APAGADOS: o CHECK antigo não os aceita.
--
-- Depois do reverse, para reaplicar a 0080 mais tarde:
--   DELETE FROM schema_migrations WHERE name = '0080_sispag_favorecido_autorizado.sql';

BEGIN;

-- Permissões: devolve o catálogo da 0079.
ALTER TABLE app_role_permission DROP CONSTRAINT IF EXISTS app_role_permission_permission_check;
ALTER TABLE user_permission DROP CONSTRAINT IF EXISTS user_permission_permission_check;

INSERT INTO app_role_permission (role_id, permission)
SELECT role_id, 'sispag:excecao' FROM app_role_permission
 WHERE permission = 'sispag:autorizar_favorecido'
ON CONFLICT DO NOTHING;
INSERT INTO user_permission (user_id, permission, efeito, concedido_por, concedido_em)
SELECT user_id, 'sispag:excecao', efeito, concedido_por, concedido_em FROM user_permission
 WHERE permission = 'sispag:autorizar_favorecido'
ON CONFLICT DO NOTHING;
DELETE FROM app_role_permission WHERE permission = 'sispag:autorizar_favorecido';
DELETE FROM user_permission WHERE permission = 'sispag:autorizar_favorecido';

ALTER TABLE app_role_permission
    ADD CONSTRAINT app_role_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:excecao', 'sispag:conferir', 'sispag:cadastro',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));
ALTER TABLE user_permission
    ADD CONSTRAINT user_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:excecao', 'sispag:conferir', 'sispag:cadastro',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

-- Alertas.
DELETE FROM alerta WHERE tipo = 'sispag-destino-alterado';
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-excecao-divergencia'
    ));

ALTER TABLE lote_pagamento_item_alerta DROP CONSTRAINT IF EXISTS lote_pagamento_item_alerta_tipo_check;
ALTER TABLE lote_pagamento_item_alerta
    ADD CONSTRAINT lote_pagamento_item_alerta_tipo_check
    CHECK (tipo IN ('DUPLICIDADE_FORTE', 'DUPLICIDADE_FRACA', 'CANAL_HABITUAL'));
ALTER TABLE lote_pagamento_item_alerta DROP CONSTRAINT IF EXISTS lote_pagamento_item_alerta_contraparte_check;
ALTER TABLE lote_pagamento_item_alerta
    ADD CONSTRAINT lote_pagamento_item_alerta_contraparte_check
    CHECK (tipo = 'CANAL_HABITUAL' OR (contraparte_fil_cod IS NOT NULL AND contraparte_doc_cod IS NOT NULL));

-- Item e lote.
ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_autorizacao_aviso_check,
    DROP COLUMN IF EXISTS favorecido_autorizado_id,
    DROP COLUMN IF EXISTS autorizacao_aviso,
    ADD COLUMN IF NOT EXISTS excecao_destino_id UUID NULL,
    ADD COLUMN IF NOT EXISTS destino_manual JSONB NULL,
    ADD COLUMN IF NOT EXISTS destino_origem TEXT NULL;
ALTER TABLE lote_pagamento_item DROP CONSTRAINT IF EXISTS lote_pagamento_item_destino_origem_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_destino_origem_check
    CHECK (destino_origem IS NULL OR destino_origem IN ('CADASTRO', 'EXCECAO', 'NENHUM'));

ALTER TABLE lote_pagamento
    ADD COLUMN IF NOT EXISTS conferido_por TEXT NULL,
    ADD COLUMN IF NOT EXISTS conferido_em TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS devolvido_por TEXT NULL,
    ADD COLUMN IF NOT EXISTS devolvido_em TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS motivo_devolucao TEXT NULL;

-- Autorização do favorecido.
DROP TABLE IF EXISTS sispag_favorecido_autorizado_evento;
DROP TABLE IF EXISTS sispag_favorecido_autorizado;
DROP FUNCTION IF EXISTS sispag_favorecido_autorizado_evento_so_inclusao();

-- Tabelas apagadas pela 0080, VAZIAS (DDL copiado da 0067, 0075 e 0077).

CREATE TABLE IF NOT EXISTS lote_pagamento_item_destino_audit (
    id              UUID PRIMARY KEY,
    lote_id         UUID NOT NULL,
    fil_cod         INTEGER NOT NULL,
    doc_cod         TEXT NOT NULL,
    tit_cod         TEXT NOT NULL,
    alterado_por    TEXT NOT NULL,
    alterado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    antes           JSONB,
    depois          JSONB
);

CREATE INDEX IF NOT EXISTS idx_destino_audit_item
    ON lote_pagamento_item_destino_audit (lote_id, fil_cod, doc_cod, tit_cod, alterado_em DESC);

CREATE OR REPLACE FUNCTION lote_pagamento_item_destino_audit_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha de destino de pagamento e so de inclusao: % recusado (ADR-0054 I10g)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_destino_audit_so_inclusao ON lote_pagamento_item_destino_audit;

CREATE TRIGGER trg_destino_audit_so_inclusao
    BEFORE UPDATE OR DELETE ON lote_pagamento_item_destino_audit
    FOR EACH ROW
    EXECUTE FUNCTION lote_pagamento_item_destino_audit_so_inclusao();

DROP TRIGGER IF EXISTS trg_destino_audit_so_inclusao_truncate ON lote_pagamento_item_destino_audit;

CREATE TRIGGER trg_destino_audit_so_inclusao_truncate
    BEFORE TRUNCATE ON lote_pagamento_item_destino_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION lote_pagamento_item_destino_audit_so_inclusao();

CREATE TABLE IF NOT EXISTS excecao_destino (
    id                UUID PRIMARY KEY,
    pes_cod           TEXT NOT NULL,
    fil_cod           INTEGER NOT NULL,
    tipo              TEXT NOT NULL,
    banco_cod         TEXT NULL,
    agencia           TEXT NULL,
    agencia_dv        TEXT NULL,
    conta             TEXT NULL,
    conta_dv          TEXT NULL,
    chave_pix_tipo    TEXT NULL,
    chave_pix         TEXT NULL,
    titular_documento TEXT NOT NULL,
    estado            TEXT NOT NULL DEFAULT 'PENDENTE',
    origem            TEXT NOT NULL DEFAULT 'MANUAL',
    carga_id          TEXT NULL,
    justificativa     TEXT NOT NULL,
    cadastrado_por    TEXT NOT NULL,
    cadastrado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    aprovado_por      TEXT NULL,
    aprovado_em       TIMESTAMPTZ NULL,
    decidido_por      TEXT NULL,
    decidido_em       TIMESTAMPTZ NULL,
    motivo_decisao    TEXT NULL,
    substituida_em    TIMESTAMPTZ NULL,
    versao            INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT excecao_destino_tipo_check CHECK (tipo IN ('CONTA', 'CHAVE_PIX')),
    CONSTRAINT excecao_destino_estado_check CHECK (
        estado IN ('PENDENTE', 'APROVADA', 'REJEITADA', 'SUBSTITUIDA', 'REVOGADA')
    ),
    CONSTRAINT excecao_destino_origem_check CHECK (origem IN ('MANUAL', 'PLANILHA')),
    CONSTRAINT excecao_destino_campos_check CHECK (
        (tipo = 'CONTA'
            AND banco_cod IS NOT NULL AND agencia IS NOT NULL
            AND conta IS NOT NULL AND conta_dv IS NOT NULL
            AND chave_pix_tipo IS NULL AND chave_pix IS NULL)
        OR
        (tipo = 'CHAVE_PIX'
            AND chave_pix_tipo = 'CPF_CNPJ' AND chave_pix IS NOT NULL
            AND banco_cod IS NULL AND agencia IS NULL AND conta IS NULL AND conta_dv IS NULL)
    ),
    CONSTRAINT excecao_destino_aprovador_check CHECK (
        aprovado_por IS NULL OR aprovado_por <> cadastrado_por
    ),
    CONSTRAINT excecao_destino_aprovada_check CHECK (
        estado <> 'APROVADA' OR (aprovado_por IS NOT NULL AND aprovado_em IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_excecao_destino_aprovada
    ON excecao_destino (pes_cod, tipo)
    WHERE estado = 'APROVADA';

CREATE INDEX IF NOT EXISTS idx_excecao_destino_favorecido
    ON excecao_destino (pes_cod, tipo, estado);

CREATE INDEX IF NOT EXISTS idx_excecao_destino_estado
    ON excecao_destino (estado, cadastrado_em);

CREATE TABLE IF NOT EXISTS excecao_destino_audit (
    id          UUID PRIMARY KEY,
    excecao_id  UUID NOT NULL REFERENCES excecao_destino(id),
    evento      TEXT NOT NULL,
    ator        TEXT NOT NULL,
    ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    antes       JSONB NULL,
    depois      JSONB NULL,
    CONSTRAINT excecao_destino_audit_evento_check CHECK (evento IN (
        'CADASTRO', 'APROVACAO', 'REJEICAO', 'REVOGACAO', 'SUBSTITUICAO',
        'DIVERGENCIA_CADASTRO', 'USO'
    ))
);

CREATE INDEX IF NOT EXISTS idx_excecao_destino_audit_excecao
    ON excecao_destino_audit (excecao_id, ocorrido_em);

CREATE OR REPLACE FUNCTION excecao_destino_audit_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha da excecao de destino e so de inclusao: % recusado (ADR-0061 I12e)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_excecao_destino_audit_so_inclusao ON excecao_destino_audit;

CREATE TRIGGER trg_excecao_destino_audit_so_inclusao
    BEFORE UPDATE OR DELETE ON excecao_destino_audit
    FOR EACH ROW
    EXECUTE FUNCTION excecao_destino_audit_so_inclusao();

DROP TRIGGER IF EXISTS trg_excecao_destino_audit_so_inclusao_truncate ON excecao_destino_audit;

CREATE TRIGGER trg_excecao_destino_audit_so_inclusao_truncate
    BEFORE TRUNCATE ON excecao_destino_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION excecao_destino_audit_so_inclusao();

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

COMMIT;
