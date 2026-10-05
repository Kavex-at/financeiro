-- 0075_sispag_excecao_destino.sql
-- ADR-0060 — o cadastro do Conexos (cmn025) é a fonte principal do destino de TED/PIX; o destino
-- fora do cadastro só existe como EXCEÇÃO por favorecido, aprovada por uma SEGUNDA pessoa.
-- Substitui o destino digitado por item (0067) e a aprovação por item (0068).
--
-- ── 1. `excecao_destino` ──────────────────────────────────────────────────────────────────────
--
-- Uma linha por exceção, por favorecido (`pes_cod`) e tipo (`CONTA` serve a TED, `CHAVE_PIX` a
-- PIX), reutilizável em qualquer lote. `fil_cod` é só a filial usada para LER o cadastro do
-- favorecido no Conexos (reconferir a titularidade ao aprovar e na varredura); NÃO faz parte da
-- chave de unicidade (gap Q9: a exceção é por favorecido, não por filial). O valor do destino é gravado COMPLETO (vai ao ERP no item
-- do fin015), mas só sai mascarado pela API (I10h). Nada disto é escrito no cmn025.
--
-- Garantias no banco (defesa em profundidade; a regra de verdade é do backend, I12b):
--   * no máximo UMA `APROVADA` por (favorecido, tipo) — índice único parcial (I12a);
--   * `aprovado_por <> cadastrado_por` — quem cadastra nunca aprova a própria exceção (I12b);
--   * `APROVADA` exige `aprovado_por`; PIX só chave CPF/CNPJ (I12i).
--
-- ── 2. `excecao_destino_audit` ────────────────────────────────────────────────────────────────
--
-- Trilha SÓ-INCLUSÃO de todos os eventos (I12e): cadastro, aprovação, rejeição, revogação,
-- substituição, divergência com o cadastro e uso. Mesmo padrão e mesma razão do trigger da 0067:
-- trocar o destino de um pagamento é o vetor clássico de fraude, e uma trilha que o próprio
-- código reescreve não prova nada. UPDATE, DELETE e TRUNCATE são recusados.
--
-- ── 3. Permissão `sispag:excecao` (ADR-0053 R4) ───────────────────────────────────────────────
--
-- Permissão ÚNICA (cadastrar, aprovar, rejeitar, revogar). Substitui `sispag:aprovar_destino`:
-- concessões existentes (papel e exceção por usuário) são CONVERTIDAS, não perdidas. A separação
-- de funções não está na permissão, está na regra aprovador ≠ cadastrante. O Administrador a
-- recebe pela conversão e por um INSERT explícito; o Analista (0074) continua sem ela.
-- Com um único titular, NADA se aprova: a Columbia precisa de pelo menos duas pessoas com ela.
--
-- ── 4. Alerta de divergência ─────────────────────────────────────────────────────────────────
--
-- Tipo novo `sispag-excecao-divergencia` no CHECK de `alerta.tipo` (paridade com ALERTA_TIPO).
--
-- ── 5. Q4 — o destino digitado por item (0067) ───────────────────────────────────────────────
--
-- A contagem de `lote_pagamento_item.destino_manual` em produção NÃO foi medida (o probe
-- `jobs/probe-destino-manual-uso.ts` é somente leitura e não alcança o banco a partir desta
-- máquina). Por isso esta migration é CRIA-APENAS: não converte, não apaga e não toca em
-- `destino_manual`, que fica INERTE (o código não lê nem grava mais). O bloco abaixo só AVISA
-- quando existir destino digitado, para a conversão em exceção PENDENTE (nunca APROVADA,
-- deduplicada por favorecido + tipo) ser decidida com o Yuri antes de ligar a flag.
--
-- Sem reverse destrutivo: nada aqui apaga dado. Idempotente: `IF NOT EXISTS`, `DROP ... IF
-- EXISTS`, `ON CONFLICT DO NOTHING`; rodar de novo não duplica nem reconverte.

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
        'trilha da excecao de destino e so de inclusao: % recusado (ADR-0060 I12e)', TG_OP
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

-- O item aponta para a exceção usada quando o destino congela no import (I10f), sem copiar o valor.
ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS excecao_destino_id UUID NULL;

-- ── Permissão ────────────────────────────────────────────────────────────────────────────────

ALTER TABLE app_role_permission
    DROP CONSTRAINT IF EXISTS app_role_permission_permission_check;
ALTER TABLE user_permission
    DROP CONSTRAINT IF EXISTS user_permission_permission_check;

INSERT INTO app_role_permission (role_id, permission)
SELECT role_id, 'sispag:excecao'
  FROM app_role_permission
 WHERE permission = 'sispag:aprovar_destino'
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permission WHERE permission = 'sispag:aprovar_destino';

INSERT INTO user_permission (user_id, permission, efeito, concedido_por, concedido_em)
SELECT user_id, 'sispag:excecao', efeito, concedido_por, concedido_em
  FROM user_permission
 WHERE permission = 'sispag:aprovar_destino'
ON CONFLICT DO NOTHING;

DELETE FROM user_permission WHERE permission = 'sispag:aprovar_destino';

ALTER TABLE app_role_permission
    ADD CONSTRAINT app_role_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:excecao',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

ALTER TABLE user_permission
    ADD CONSTRAINT user_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:excecao',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

INSERT INTO app_role_permission (role_id, permission)
SELECT r.id, 'sispag:excecao'
  FROM app_role r
 WHERE lower(r.nome) = 'administrador'
ON CONFLICT DO NOTHING;

-- ── Alerta de divergência com o cadastro (I12c) ──────────────────────────────────────────────

ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-excecao-divergencia'
    ));

-- ── Q4: avisa (não bloqueia) quando ainda há destino digitado por item ───────────────────────

DO $$
DECLARE
    pendentes BIGINT;
BEGIN
    SELECT count(*) INTO pendentes FROM lote_pagamento_item WHERE destino_manual IS NOT NULL;
    IF pendentes > 0 THEN
        RAISE WARNING
            '0075: % item(ns) com destino_manual (ADR-0054) ficam INERTES; converter em excecao_destino PENDENTE (nunca APROVADA) e decidir com o Yuri antes de ligar SISPAG_EXCECAO_DESTINO_ENABLED.',
            pendentes;
    END IF;
END $$;

COMMENT ON TABLE excecao_destino IS
    'ADR-0060 — destino de pagamento SISPAG fora do cadastro cmn025, por favorecido, aprovado por 2a pessoa. Valor completo: nunca em log nem em resposta de API (I10h).';
COMMENT ON TABLE excecao_destino_audit IS
    'ADR-0060 I12e — trilha so-inclusao dos eventos da excecao de destino. UPDATE/DELETE/TRUNCATE recusados por trigger.';
COMMENT ON COLUMN lote_pagamento_item.destino_manual IS
    'INERTE desde a 0075 (ADR-0060): o destino digitado por item foi substituido por excecao_destino. O codigo nao le nem grava esta coluna.';
COMMENT ON COLUMN lote_pagamento_item.excecao_destino_id IS
    'ADR-0060 I10f — exceção usada como destino, gravada quando o destino congela no import do fin015. Liga o item à exceção sem copiar o valor.';
