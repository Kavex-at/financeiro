-- 0080_sispag_favorecido_autorizado.sql
-- ADR-0065 — o favorecido autorizado substitui a conferência por lote (ADR-0063, L12/L13) e a
-- exceção de destino (ADR-0061). O destino de TED/PIX é SEMPRE o do cadastro do Conexos (cmn025);
-- o que uma segunda pessoa aprova é o par (favorecido, modalidade) amarrado à impressão digital do
-- destino que o resolvedor escolheu na aprovação.
--
-- ── 0. Guarda (ADR-0065 §4) ──────────────────────────────────────────────────────────────────
--
-- Esta migração APAGA cinco tabelas e três colunas de dado. Ela só pode rodar onde elas estão
-- vazias: com qualquer linha, aborta INTEIRA (o arquivo roda numa transação só) e nada muda. Em
-- produção, em 2026-10-08, as cinco tabelas tinham 0 linhas (medido antes do merge). As tabelas de
-- pendência de cadastro entram na guarda por decisão do Yuri (risco 2 do tasks.md resolvido).
-- `to_regclass` e `information_schema` toleram a reaplicação: a tabela já dropada conta como zero.
--
-- ── 1. `sispag_favorecido_autorizado` + trilha só-inclusão ───────────────────────────────────
--
-- No máximo UMA vigente (PENDENTE | AUTORIZADO | REAPROVACAO_PENDENTE) por (pes_cod, modalidade).
-- O valor completo do destino NUNCA é gravado: só a impressão (HMAC, segredo do tenant, versão em
-- `fingerprint_chave_id`) e a máscara. `fil_cod_leitura` é só a filial usada para LER o cadastro
-- (que é global): não faz parte da chave. A trilha recusa UPDATE, DELETE e TRUNCATE (padrão 0078).
--
-- ── 2. Item e lote ───────────────────────────────────────────────────────────────────────────
--
-- O item ganha `favorecido_autorizado_id` (gravado no congelamento I10f, só rastreio) e
-- `autorizacao_aviso` (o último resultado da verificação I14d, o selo da tela). Saem a exceção
-- usada, o destino digitado (0067) e a origem do destino (sempre cadastro). O lote perde a
-- conferência e a devolução (L12/L13 removidas).
--
-- ── 3. Permissões e alertas ──────────────────────────────────────────────────────────────────
--
-- `sispag:excecao` é CONVERTIDA em `sispag:autorizar_favorecido` (papel e usuário); o
-- Administrador a recebe. `sispag:conferir` e `sispag:cadastro` somem. O alerta
-- `sispag-excecao-divergencia` dá lugar a `sispag-destino-alterado`. `CANAL_HABITUAL` sai do
-- AlertaItemLote (era informativa; ADR-0065 I13i).
--
-- `sispag_verificacao_evento` NÃO muda: o CHECK dela guarda os eventos históricos.
-- Reverse (só estrutura) em `rollbacks/0080_sispag_favorecido_autorizado.rollback.sql`.

DO $$
DECLARE
    tabela TEXT;
    n BIGINT;
    contagens TEXT := '';
    total BIGINT := 0;
BEGIN
    FOREACH tabela IN ARRAY ARRAY[
        'excecao_destino',
        'excecao_destino_audit',
        'lote_pagamento_item_destino_audit',
        'pendencia_cadastro_origem',
        'pendencia_cadastro'
    ] LOOP
        IF to_regclass(tabela) IS NOT NULL THEN
            EXECUTE format('SELECT count(*) FROM %I', tabela) INTO n;
            contagens := contagens || format('%s=%s ', tabela, n);
            total := total + n;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'lote_pagamento_item' AND column_name = 'destino_manual'
    ) THEN
        EXECUTE 'SELECT count(*) FROM lote_pagamento_item WHERE destino_manual IS NOT NULL' INTO n;
        contagens := contagens || format('lote_pagamento_item.destino_manual=%s ', n);
        total := total + n;
    END IF;

    IF total > 0 THEN
        RAISE EXCEPTION
            '0080: abortada, ha dado nas estruturas que a ADR-0065 apaga (%). Decidir com o Yuri antes de migrar.',
            btrim(contagens)
            USING ERRCODE = 'raise_exception';
    END IF;
END $$;

-- ── 1. Autorização do favorecido ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_favorecido_autorizado (
    id                              UUID PRIMARY KEY,
    pes_cod                         TEXT NOT NULL,
    credor                          TEXT NULL,
    modalidade                      TEXT NOT NULL,
    estado                          TEXT NOT NULL DEFAULT 'PENDENTE',
    fingerprint                     TEXT NULL,
    fingerprint_chave_id            TEXT NULL,
    destino_mascarado               TEXT NULL,
    avisos                          JSONB NOT NULL DEFAULT '[]'::jsonb,
    fingerprint_observado           TEXT NULL,
    destino_observado_mascarado     TEXT NULL,
    origem_solicitacao              TEXT NOT NULL,
    fil_cod_leitura                 INTEGER NOT NULL,
    solicitado_por                  TEXT NULL,
    solicitado_em                   TIMESTAMPTZ NULL DEFAULT now(),
    decidido_por                    TEXT NULL,
    decidido_em                     TIMESTAMPTZ NULL,
    motivo_decisao                  TEXT NULL,
    ultima_conferencia_em           TIMESTAMPTZ NULL,
    ultima_conferencia_resultado    TEXT NULL,
    criado_em                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    versao                          INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT sispag_favorecido_autorizado_modalidade_check CHECK (modalidade IN ('TED', 'PIX')),
    CONSTRAINT sispag_favorecido_autorizado_estado_check CHECK (
        estado IN ('PENDENTE', 'AUTORIZADO', 'REJEITADO', 'REAPROVACAO_PENDENTE', 'REVOGADO')
    ),
    CONSTRAINT sispag_favorecido_autorizado_origem_check CHECK (
        origem_solicitacao IN ('ITEM', 'RELATORIO', 'MANUAL')
    ),
    CONSTRAINT sispag_favorecido_autorizado_conferencia_check CHECK (
        ultima_conferencia_resultado IS NULL
        OR ultima_conferencia_resultado IN ('IGUAL', 'DIFERENTE', 'SEM_DADO', 'FALHA_LEITURA')
    ),
    CONSTRAINT sispag_favorecido_autorizado_fingerprint_check CHECK (
        estado <> 'AUTORIZADO' OR fingerprint IS NOT NULL
    ),
    CONSTRAINT sispag_favorecido_autorizado_motivo_check CHECK (
        estado NOT IN ('REJEITADO', 'REVOGADO')
        OR (motivo_decisao IS NOT NULL AND length(btrim(motivo_decisao)) > 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_favorecido_autorizado_vigente
    ON sispag_favorecido_autorizado (pes_cod, modalidade)
    WHERE estado IN ('PENDENTE', 'AUTORIZADO', 'REAPROVACAO_PENDENTE');

CREATE INDEX IF NOT EXISTS idx_sispag_favorecido_autorizado_estado
    ON sispag_favorecido_autorizado (estado, solicitado_em);

CREATE TABLE IF NOT EXISTS sispag_favorecido_autorizado_evento (
    id              UUID PRIMARY KEY,
    autorizacao_id  UUID NOT NULL REFERENCES sispag_favorecido_autorizado(id),
    evento          TEXT NOT NULL,
    ator            TEXT NOT NULL,
    ocorrido_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    dados           JSONB NULL,
    CONSTRAINT sispag_favorecido_autorizado_evento_evento_check CHECK (evento IN (
        'SOLICITADO', 'CONFIRMADO', 'APROVADO', 'REJEITADO', 'REAPROVACAO_ABERTA', 'REVOGADO',
        'DESTINO_REVELADO', 'CONFERIDO'
    ))
);

CREATE INDEX IF NOT EXISTS idx_sispag_favorecido_autorizado_evento_autorizacao
    ON sispag_favorecido_autorizado_evento (autorizacao_id, ocorrido_em);

CREATE OR REPLACE FUNCTION sispag_favorecido_autorizado_evento_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha do favorecido autorizado e so de inclusao: % recusado (ADR-0065 I14j)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sispag_favorecido_autorizado_evento_so_inclusao
    ON sispag_favorecido_autorizado_evento;

CREATE TRIGGER trg_sispag_favorecido_autorizado_evento_so_inclusao
    BEFORE UPDATE OR DELETE ON sispag_favorecido_autorizado_evento
    FOR EACH ROW
    EXECUTE FUNCTION sispag_favorecido_autorizado_evento_so_inclusao();

DROP TRIGGER IF EXISTS trg_sispag_favorecido_autorizado_evento_so_inclusao_truncate
    ON sispag_favorecido_autorizado_evento;

CREATE TRIGGER trg_sispag_favorecido_autorizado_evento_so_inclusao_truncate
    BEFORE TRUNCATE ON sispag_favorecido_autorizado_evento
    FOR EACH STATEMENT
    EXECUTE FUNCTION sispag_favorecido_autorizado_evento_so_inclusao();

-- ── 2. Item e lote ───────────────────────────────────────────────────────────────────────────

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS favorecido_autorizado_id UUID NULL,
    ADD COLUMN IF NOT EXISTS autorizacao_aviso TEXT NULL;

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_autorizacao_aviso_check;
ALTER TABLE lote_pagamento_item
    ADD CONSTRAINT lote_pagamento_item_autorizacao_aviso_check
    CHECK (autorizacao_aviso IS NULL OR autorizacao_aviso IN (
        'OK', 'SEM_DADO_PAGAMENTO', 'FAVORECIDO_NAO_AUTORIZADO', 'DESTINO_ALTERADO'
    ));

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_destino_origem_check;
ALTER TABLE lote_pagamento_item
    DROP COLUMN IF EXISTS excecao_destino_id,
    DROP COLUMN IF EXISTS destino_manual,
    DROP COLUMN IF EXISTS destino_origem;

ALTER TABLE lote_pagamento
    DROP COLUMN IF EXISTS conferido_por,
    DROP COLUMN IF EXISTS conferido_em,
    DROP COLUMN IF EXISTS devolvido_por,
    DROP COLUMN IF EXISTS devolvido_em,
    DROP COLUMN IF EXISTS motivo_devolucao;

-- ── Tabelas que a ADR-0065 apaga (a guarda acima provou que estão vazias) ─────────────────────

DROP TABLE IF EXISTS pendencia_cadastro_origem;
DROP TABLE IF EXISTS pendencia_cadastro;
DROP TABLE IF EXISTS excecao_destino_audit;
DROP TABLE IF EXISTS excecao_destino;
DROP TABLE IF EXISTS lote_pagamento_item_destino_audit;
DROP FUNCTION IF EXISTS excecao_destino_audit_so_inclusao();
DROP FUNCTION IF EXISTS lote_pagamento_item_destino_audit_so_inclusao();

-- ── AlertaItemLote sem CANAL_HABITUAL ────────────────────────────────────────────────────────

DELETE FROM lote_pagamento_item_alerta WHERE tipo = 'CANAL_HABITUAL';

ALTER TABLE lote_pagamento_item_alerta
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_alerta_tipo_check;
ALTER TABLE lote_pagamento_item_alerta
    ADD CONSTRAINT lote_pagamento_item_alerta_tipo_check
    CHECK (tipo IN ('DUPLICIDADE_FORTE', 'DUPLICIDADE_FRACA'));

ALTER TABLE lote_pagamento_item_alerta
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_alerta_contraparte_check;
ALTER TABLE lote_pagamento_item_alerta
    ADD CONSTRAINT lote_pagamento_item_alerta_contraparte_check
    CHECK (contraparte_fil_cod IS NOT NULL AND contraparte_doc_cod IS NOT NULL);

-- ── 3. Permissões ────────────────────────────────────────────────────────────────────────────

ALTER TABLE app_role_permission
    DROP CONSTRAINT IF EXISTS app_role_permission_permission_check;
ALTER TABLE user_permission
    DROP CONSTRAINT IF EXISTS user_permission_permission_check;

INSERT INTO app_role_permission (role_id, permission)
SELECT role_id, 'sispag:autorizar_favorecido'
  FROM app_role_permission
 WHERE permission = 'sispag:excecao'
ON CONFLICT DO NOTHING;

INSERT INTO user_permission (user_id, permission, efeito, concedido_por, concedido_em)
SELECT user_id, 'sispag:autorizar_favorecido', efeito, concedido_por, concedido_em
  FROM user_permission
 WHERE permission = 'sispag:excecao'
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permission WHERE permission IN ('sispag:excecao', 'sispag:conferir', 'sispag:cadastro');
DELETE FROM user_permission WHERE permission IN ('sispag:excecao', 'sispag:conferir', 'sispag:cadastro');

ALTER TABLE app_role_permission
    ADD CONSTRAINT app_role_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:autorizar_favorecido',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

ALTER TABLE user_permission
    ADD CONSTRAINT user_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:autorizar_favorecido',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

INSERT INTO app_role_permission (role_id, permission)
SELECT r.id, 'sispag:autorizar_favorecido'
  FROM app_role r
 WHERE lower(r.nome) = 'administrador'
ON CONFLICT DO NOTHING;

-- ── Alerta operacional: destino do favorecido autorizado mudou no cadastro ───────────────────

DELETE FROM alerta WHERE tipo = 'sispag-excecao-divergencia';

ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-destino-alterado'
    ));

COMMENT ON TABLE sispag_favorecido_autorizado IS
    'ADR-0065 — favorecido autorizado a receber TED/PIX no destino do cmn025 aprovado por 2a pessoa. Guarda so a impressao (HMAC) e a mascara; nunca o destino completo.';
COMMENT ON TABLE sispag_favorecido_autorizado_evento IS
    'ADR-0065 I14j — trilha so-inclusao da autorizacao do favorecido. UPDATE/DELETE/TRUNCATE recusados por trigger. Nunca valor completo.';
COMMENT ON COLUMN sispag_favorecido_autorizado.fil_cod_leitura IS
    'Filial usada so para LER o cadastro do favorecido no Conexos (o cmn025 e global). Nao faz parte da chave.';
COMMENT ON COLUMN lote_pagamento_item.favorecido_autorizado_id IS
    'ADR-0065 I10f — autorizacao vigente quando o destino congelou no import do fin015. So rastreio, nunca o valor.';
COMMENT ON COLUMN lote_pagamento_item.autorizacao_aviso IS
    'ADR-0065 I14e — ultimo resultado da verificacao do favorecido autorizado (selo do item). FALHA_LEITURA nao entra: o item fica com verificacao_estado PENDENTE.';
