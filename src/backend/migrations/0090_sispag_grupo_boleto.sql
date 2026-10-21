-- 0090_sispag_grupo_boleto.sql
-- ADR-0076 (I19) — boleto agrupado: 1 boleto DDA paga N ≥ 2 títulos do mesmo credor por um borderô
-- `fin010` importado como UM item nativo do lote SISPAG. Blocos, todos ADITIVOS e idempotentes:
--
--   1. `sispag_grupo_boleto` (a confirmação humana 1 boleto ↔ N títulos) e
--      `sispag_grupo_boleto_titulo` (os N títulos, com o `estado` do grupo DENORMALIZADO para o
--      índice único parcial por título da I19i; coerência garantida por constraint trigger
--      DEFERRABLE: estado, filial, N ≥ 2 e Σ dos títulos == soma do grupo, conferidos no COMMIT);
--   2. `sispag_grupo_boleto_execucao` — ledger write-ahead do borderô por grupo e remessa (padrão
--      I-2, I19l/I19s). Identidade do borderô = `fil_cod + bor_cod + bor_tim_cad` (emenda
--      2026-10-21): o ERP REUSA `borCod` depois de `excluirBordero`, e `borTimCad` é o carimbo de
--      criação que ele grava. SEM marcador: nada é escrito em `borEspNrbanco`.
--        * `bor_tim_cad BIGINT` (epoch ms, como o ERP devolve e como o `fin010/list` filtra —
--          `borTimCad#GE/#LE` só aceita epoch ms; ISO dá 500). É um valor OPACO do ERP comparado
--          por igualdade: guardá-lo como número evita qualquer conversão de fuso/precisão entre
--          a leitura e a comparação. TIMESTAMPTZ arriscaria um arredondamento silencioso que
--          transformaria o NOSSO borderô em "alheio".
--        * `escrita_iniciada_em` (t0) / `escrita_concluida_em` (t1) são o NOSSO relógio, só para
--          montar a janela de busca da resposta perdida: TIMESTAMPTZ (legível na auditoria;
--          convertidos a epoch ms na consulta). `t1` é NULO quando o processo morre entre o
--          `POST` e a gravação: a retomada usa `agora` + margem como limite superior.
--        * `usn_cod_cad` = usuário do robô que o ERP grava no borderô (filtro da janela);
--          `conexos_username`/`conexos_usn_cod` = identidade da sessão (I-2, TEXT como na 0051).
--      No máximo UMA execução não terminal por grupo (índice único parcial);
--   3. `sispag_grupo_boleto_evento` — trilha só-inclusão (trigger, padrão 0084);
--   4. `lote_pagamento_item.grupo_boleto_id` (N itens locais por grupo, P1-1) e a etapa
--      persistida `preparar_bordero` no CHECK de `remessa_execucao.etapa` (L8);
--   5. `titulo_bloqueio_duplicidade.origem` aceita `GRUPO_BOLETO` (I19p(3)) e `alerta.tipo` aceita
--      `sispag-bordero-grupo-pendente` (I19q/I19r).
--
-- ── PRIVACIDADE (I17j) ────────────────────────────────────────────────────────────────────────
-- Só o código MASCARADO persiste (5+4, "…"); o CHECK faz o esquema recusar código longo.
--
-- Sem backfill: nenhuma linha existente muda. Reverse em
-- `rollbacks/0090_sispag_grupo_boleto.rollback.sql`.

-- ── 1. Grupo e títulos ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_grupo_boleto (
    id                      UUID PRIMARY KEY,
    fil_cod                 INTEGER NOT NULL,
    pes_cod                 TEXT NOT NULL,
    credor                  TEXT NULL,
    emissor_chave           TEXT NOT NULL,
    ddc_cod                 INTEGER NOT NULL,
    dit_cod                 INTEGER NOT NULL,
    numero_boleto           TEXT NULL,
    codbar_mascarado        TEXT NOT NULL,
    valor_boleto_centavos   BIGINT NOT NULL,
    vencimento_boleto       DATE NOT NULL,
    soma_titulos_centavos   BIGINT NOT NULL,
    origem                  TEXT NOT NULL,
    intercambiavel          BOOLEAN NOT NULL DEFAULT FALSE,
    avisos_reconhecidos     JSONB NOT NULL DEFAULT '[]'::jsonb,
    confirmacao_emissor_id  UUID NOT NULL REFERENCES sispag_confirmacao_emissor_boleto (id),
    estado                  TEXT NOT NULL DEFAULT 'CONFIRMADO',
    confirmado_por          TEXT NOT NULL,
    confirmado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    anulado_por             TEXT NULL,
    anulado_em              TIMESTAMPTZ NULL,
    motivo_anulacao         TEXT NULL,
    tipo_anulacao           TEXT NULL,
    pago_observado_em       TIMESTAMPTZ NULL,
    versao                  INTEGER NOT NULL DEFAULT 1,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sispag_grupo_boleto_estado_check CHECK (
        estado IN ('CONFIRMADO', 'ANULADO', 'PAGO')
    ),
    CONSTRAINT sispag_grupo_boleto_origem_check CHECK (
        origem IN ('SUGERIDO', 'MANUAL')
    ),
    CONSTRAINT sispag_grupo_boleto_codbar_mascarado_check CHECK (
        codbar_mascarado ~ '^[0-9]{5}…[0-9]{4}$'
    ),
    CONSTRAINT sispag_grupo_boleto_valor_check CHECK (valor_boleto_centavos > 0),
    -- I19b: soma exata ao centavo, sem tolerância.
    CONSTRAINT sispag_grupo_boleto_soma_check CHECK (
        soma_titulos_centavos = valor_boleto_centavos
    ),
    CONSTRAINT sispag_grupo_boleto_pes_cod_check CHECK (length(btrim(pes_cod)) > 0),
    CONSTRAINT sispag_grupo_boleto_avisos_check CHECK (
        jsonb_typeof(avisos_reconhecidos) = 'array'
    ),
    -- I19i: o sistema nunca confirma.
    CONSTRAINT sispag_grupo_boleto_ator_check CHECK (
        length(btrim(confirmado_por)) > 0
        AND lower(btrim(confirmado_por)) NOT IN ('sistema', 'unknown')
    ),
    -- I19t: campos da anulação preenchidos SÓ em ANULADO; motivo 10–500.
    CONSTRAINT sispag_grupo_boleto_anulacao_check CHECK (
        (
            estado = 'ANULADO'
            AND anulado_por IS NOT NULL AND length(btrim(anulado_por)) > 0
            AND anulado_em IS NOT NULL
            AND motivo_anulacao IS NOT NULL
            AND length(btrim(motivo_anulacao)) BETWEEN 10 AND 500
            AND tipo_anulacao IN ('MANUAL', 'PAR_REVOGADO')
        )
        OR (
            estado <> 'ANULADO'
            AND anulado_por IS NULL AND anulado_em IS NULL
            AND motivo_anulacao IS NULL AND tipo_anulacao IS NULL
        )
    ),
    -- `sistema` só anula na cascata da revogação do par (I15l(2)); `unknown` nunca.
    CONSTRAINT sispag_grupo_boleto_anulador_check CHECK (
        anulado_por IS NULL
        OR (
            lower(btrim(anulado_por)) <> 'unknown'
            AND (
                lower(btrim(anulado_por)) <> 'sistema'
                OR tipo_anulacao IS NOT DISTINCT FROM 'PAR_REVOGADO'
            )
        )
    ),
    CONSTRAINT sispag_grupo_boleto_pago_check CHECK (
        estado <> 'PAGO' OR pago_observado_em IS NOT NULL
    ),
    CONSTRAINT sispag_grupo_boleto_versao_check CHECK (versao >= 1)
);

-- I19i: um boleto em no máximo um grupo CONFIRMADO.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_grupo_boleto_confirmado_boleto
    ON sispag_grupo_boleto (ddc_cod, dit_cod)
    WHERE estado = 'CONFIRMADO';

CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_filial_estado
    ON sispag_grupo_boleto (fil_cod, estado);

CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_confirmacao
    ON sispag_grupo_boleto (confirmacao_emissor_id);

CREATE TABLE IF NOT EXISTS sispag_grupo_boleto_titulo (
    id                      BIGSERIAL PRIMARY KEY,
    grupo_id                UUID NOT NULL REFERENCES sispag_grupo_boleto (id),
    fil_cod                 INTEGER NOT NULL,
    doc_cod                 TEXT NOT NULL,
    tit_cod                 TEXT NOT NULL,
    valor_liquido_centavos  BIGINT NOT NULL,
    vencimento              DATE NOT NULL,
    -- Denormalizado do grupo (I19i): o índice parcial por título não pode olhar a tabela-mãe.
    estado                  TEXT NOT NULL,
    CONSTRAINT sispag_grupo_boleto_titulo_estado_check CHECK (
        estado IN ('CONFIRMADO', 'ANULADO', 'PAGO')
    ),
    CONSTRAINT sispag_grupo_boleto_titulo_valor_check CHECK (valor_liquido_centavos > 0),
    CONSTRAINT ux_sispag_grupo_boleto_titulo_chave UNIQUE (grupo_id, fil_cod, doc_cod, tit_cod)
);

-- I19i: um título em no máximo um grupo CONFIRMADO.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_grupo_boleto_titulo_confirmado
    ON sispag_grupo_boleto_titulo (fil_cod, doc_cod, tit_cod)
    WHERE estado = 'CONFIRMADO';

-- Coerência grupo × títulos, conferida no COMMIT (o repositório grava o grupo e os N títulos, ou
-- anula os dois, na mesma transação): mesmo estado, mesma filial (I19d), N ≥ 2 (I19a) e
-- Σ valor_liquido_centavos == soma_titulos_centavos (I19b).
CREATE OR REPLACE FUNCTION sispag_grupo_boleto_coerencia() RETURNS trigger AS $$
DECLARE
    v_grupo UUID;
    g sispag_grupo_boleto%ROWTYPE;
    n INTEGER;
    soma BIGINT;
    divergentes INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'sispag_grupo_boleto' THEN
        v_grupo := NEW.id;
    ELSE
        v_grupo := NEW.grupo_id;
    END IF;

    SELECT * INTO g FROM sispag_grupo_boleto WHERE id = v_grupo;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT count(*), COALESCE(sum(valor_liquido_centavos), 0),
           count(*) FILTER (WHERE estado <> g.estado OR fil_cod <> g.fil_cod)
      INTO n, soma, divergentes
      FROM sispag_grupo_boleto_titulo
     WHERE grupo_id = v_grupo;

    IF n < 2 THEN
        RAISE EXCEPTION 'grupo de boleto % com % título(s): exige N >= 2 (ADR-0076 I19a)', v_grupo, n
            USING ERRCODE = 'check_violation';
    END IF;
    IF soma <> g.soma_titulos_centavos THEN
        RAISE EXCEPTION 'grupo de boleto %: soma dos títulos % <> soma do grupo % (I19b)',
            v_grupo, soma, g.soma_titulos_centavos
            USING ERRCODE = 'check_violation';
    END IF;
    IF divergentes > 0 THEN
        RAISE EXCEPTION 'grupo de boleto %: % título(s) com estado ou filial diferente do grupo (I19d/I19i)',
            v_grupo, divergentes
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sispag_grupo_boleto_coerencia ON sispag_grupo_boleto;
CREATE CONSTRAINT TRIGGER trg_sispag_grupo_boleto_coerencia
    AFTER INSERT OR UPDATE ON sispag_grupo_boleto
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION sispag_grupo_boleto_coerencia();

DROP TRIGGER IF EXISTS trg_sispag_grupo_boleto_titulo_coerencia ON sispag_grupo_boleto_titulo;
CREATE CONSTRAINT TRIGGER trg_sispag_grupo_boleto_titulo_coerencia
    AFTER INSERT OR UPDATE ON sispag_grupo_boleto_titulo
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION sispag_grupo_boleto_coerencia();

-- ── 2. Execução do borderô (write-ahead, I19l/I19s) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_grupo_boleto_execucao (
    id                          UUID PRIMARY KEY,
    grupo_id                    UUID NOT NULL REFERENCES sispag_grupo_boleto (id),
    -- O ledger sobrevive ao lote local: L6 apaga lote automático em RASCUNHO, e a trilha de uma
    -- escrita irreversível no ERP não pode sumir nem bloquear esse DELETE.
    remessa_execucao_id         BIGINT NULL REFERENCES remessa_execucao (id) ON DELETE SET NULL,
    lote_id                     UUID NOT NULL,
    fil_cod                     INTEGER NOT NULL,
    bnc_cod                     INTEGER NULL,
    flp_cod                     INTEGER NULL,
    ger_num                     INTEGER NULL,
    bor_dta_mvto                DATE NULL,
    -- Write-ahead: t0 ANTES do POST fin010; t1 depois (nulo se o processo morreu no meio).
    escrita_iniciada_em         TIMESTAMPTZ NULL,
    escrita_concluida_em        TIMESTAMPTZ NULL,
    -- Identidade do borderô (emenda 2026-10-21): fil_cod + bor_cod + bor_tim_cad (epoch ms do ERP).
    bor_cod                     INTEGER NULL,
    bor_tim_cad                 BIGINT NULL,
    usn_cod_cad                 INTEGER NULL,
    bor_cod_reaproveitado_de    UUID NULL REFERENCES sispag_grupo_boleto_execucao (id),
    baixas                      JSONB NOT NULL DEFAULT '[]'::jsonb,
    its_cod_seq                 INTEGER NULL,
    etapa                       TEXT NOT NULL DEFAULT 'intencao_gravada',
    motivo                      TEXT NULL,
    j_rejeitado_em              TIMESTAMPTZ NULL,
    conexos_username            TEXT NULL,
    conexos_usn_cod             TEXT NULL,
    tentativas                  INTEGER NOT NULL DEFAULT 0,
    criado_em                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sispag_grupo_boleto_execucao_etapa_check CHECK (
        etapa IN (
            'intencao_gravada', 'bordero_criado', 'baixas_gravadas', 'bordero_conferido',
            'importado', 'codbar_vinculado', 'concluido', 'reaproveitado', 'retirado', 'limpo',
            'limpeza_pendente', 'indeterminado', 'failed', 'simulado'
        )
    ),
    -- Identidade é o par: borCod sem borTimCad poderia adotar o borderô de outra pessoa.
    CONSTRAINT sispag_grupo_boleto_execucao_identidade_check CHECK (
        (bor_cod IS NULL) = (bor_tim_cad IS NULL)
    ),
    CONSTRAINT sispag_grupo_boleto_execucao_bor_tim_cad_check CHECK (
        bor_tim_cad IS NULL OR bor_tim_cad > 0
    ),
    CONSTRAINT sispag_grupo_boleto_execucao_janela_check CHECK (
        escrita_concluida_em IS NULL
        OR (escrita_iniciada_em IS NOT NULL AND escrita_concluida_em >= escrita_iniciada_em)
    ),
    CONSTRAINT sispag_grupo_boleto_execucao_baixas_check CHECK (
        jsonb_typeof(baixas) = 'array'
    ),
    CONSTRAINT sispag_grupo_boleto_execucao_motivo_check CHECK (
        motivo IS NULL OR motivo !~ '[0-9]{20,}'
    ),
    CONSTRAINT sispag_grupo_boleto_execucao_tentativas_check CHECK (tentativas >= 0)
);

-- No máximo UMA execução não terminal por grupo (os terminais são os de EtapaBorderoGrupo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_grupo_boleto_execucao_nao_terminal
    ON sispag_grupo_boleto_execucao (grupo_id)
    WHERE etapa NOT IN (
        'concluido', 'retirado', 'limpo', 'limpeza_pendente', 'indeterminado', 'simulado'
    );

CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_execucao_grupo
    ON sispag_grupo_boleto_execucao (grupo_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_execucao_remessa
    ON sispag_grupo_boleto_execucao (remessa_execucao_id);

CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_execucao_lote
    ON sispag_grupo_boleto_execucao (lote_id);

-- Sem UNIQUE: o reaproveitamento (I19s) adota o MESMO borderô numa execução nova.
CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_execucao_bordero
    ON sispag_grupo_boleto_execucao (fil_cod, bor_cod)
    WHERE bor_cod IS NOT NULL;

-- ── 3. Trilha só-inclusão ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_grupo_boleto_evento (
    id                  UUID PRIMARY KEY,
    grupo_id            UUID NOT NULL REFERENCES sispag_grupo_boleto (id),
    tipo                TEXT NOT NULL,
    ator                TEXT NOT NULL,
    ocorrido_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    fil_cod             INTEGER NULL,
    lote_id             UUID NULL,
    execucao_id         UUID NULL,
    bor_cod             INTEGER NULL,
    ddc_cod             INTEGER NULL,
    dit_cod             INTEGER NULL,
    codigo_mascarado    TEXT NULL,
    dados               JSONB NULL,
    CONSTRAINT sispag_grupo_boleto_evento_tipo_check CHECK (
        tipo IN (
            'GRUPO_CONFIRMADO', 'GRUPO_ANULADO', 'GRUPO_RETIRADO', 'BORDERO_PREPARADO',
            'BORDERO_REAPROVEITADO', 'BORDERO_LIMPO', 'GRUPO_PAGO', 'GRUPO_DIVERGENTE'
        )
    ),
    CONSTRAINT sispag_grupo_boleto_evento_ator_check CHECK (length(btrim(ator)) > 0),
    CONSTRAINT sispag_grupo_boleto_evento_codigo_mascarado_check CHECK (
        codigo_mascarado IS NULL OR codigo_mascarado ~ '^[0-9]{5}…[0-9]{4}$'
    ),
    CONSTRAINT sispag_grupo_boleto_evento_dados_check CHECK (
        dados IS NULL OR dados::text !~ '[0-9]{44}'
    )
);

CREATE INDEX IF NOT EXISTS idx_sispag_grupo_boleto_evento_grupo
    ON sispag_grupo_boleto_evento (grupo_id, ocorrido_em);

CREATE OR REPLACE FUNCTION sispag_grupo_boleto_evento_so_inclusao() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trilha do grupo de boleto e so de inclusao: % recusado (ADR-0076 I19i)', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sispag_grupo_boleto_evento_so_inclusao
    ON sispag_grupo_boleto_evento;

CREATE TRIGGER trg_sispag_grupo_boleto_evento_so_inclusao
    BEFORE UPDATE OR DELETE ON sispag_grupo_boleto_evento
    FOR EACH ROW
    EXECUTE FUNCTION sispag_grupo_boleto_evento_so_inclusao();

DROP TRIGGER IF EXISTS trg_sispag_grupo_boleto_evento_so_inclusao_truncate
    ON sispag_grupo_boleto_evento;

CREATE TRIGGER trg_sispag_grupo_boleto_evento_so_inclusao_truncate
    BEFORE TRUNCATE ON sispag_grupo_boleto_evento
    FOR EACH STATEMENT
    EXECUTE FUNCTION sispag_grupo_boleto_evento_so_inclusao();

-- ── 4. Item do lote e etapa persistida da remessa ────────────────────────────────────────────

ALTER TABLE lote_pagamento_item
    ADD COLUMN IF NOT EXISTS grupo_boleto_id UUID NULL REFERENCES sispag_grupo_boleto (id);

CREATE INDEX IF NOT EXISTS idx_lote_pagamento_item_grupo_boleto
    ON lote_pagamento_item (grupo_boleto_id)
    WHERE grupo_boleto_id IS NOT NULL;

-- O CHECK da 0049 é inline (nome gerado `remessa_execucao_etapa_check`). DROP IF EXISTS + ADD:
-- reaplicar é no-op.
ALTER TABLE remessa_execucao DROP CONSTRAINT IF EXISTS remessa_execucao_etapa_check;
ALTER TABLE remessa_execucao
    ADD CONSTRAINT remessa_execucao_etapa_check CHECK (
        etapa IN (
            'criar_lote', 'preparar_bordero', 'importar', 'finalizar', 'gerar_remessa',
            'concluido'
        )
    );

-- ── 5. Origem da marca de retenção e tipo de alerta ──────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'titulo_bloqueio_duplicidade_origem_check'
          AND conrelid = 'titulo_bloqueio_duplicidade'::regclass
          AND pg_get_constraintdef(oid) LIKE '%GRUPO_BOLETO%'
    ) THEN
        ALTER TABLE titulo_bloqueio_duplicidade
            DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_origem_check;
        ALTER TABLE titulo_bloqueio_duplicidade
            ADD CONSTRAINT titulo_bloqueio_duplicidade_origem_check CHECK (
                origem IN (
                    'DUPLICIDADE_TITULO', 'CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL',
                    'VINCULO_CODIGO_BARRAS_FALHOU', 'GRUPO_BOLETO'
                )
            );
    END IF;
END
$$;

-- Lista completa (a da 0088 + o tipo novo). DROP IF EXISTS + ADD: reaplicar é no-op.
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-destino-alterado',
        'sispag-ajuste-centavos-parado', 'sispag-bordero-grupo-pendente'
    ));

COMMENT ON TABLE sispag_grupo_boleto IS
    'ADR-0076 I19 — confirmacao humana de 1 boleto DDA <-> N titulos do mesmo credor. So codbar mascarado 5+4.';
COMMENT ON TABLE sispag_grupo_boleto_titulo IS
    'ADR-0076 I19 — titulos do grupo; estado denormalizado do grupo (indice parcial I19i), coerencia por constraint trigger no COMMIT.';
COMMENT ON TABLE sispag_grupo_boleto_execucao IS
    'ADR-0076 I19l/I19s — ledger write-ahead do bordero fin010 do grupo. Identidade fil_cod + bor_cod + bor_tim_cad (epoch ms do ERP); sem marcador.';
COMMENT ON TABLE sispag_grupo_boleto_evento IS
    'ADR-0076 I19i — trilha so-inclusao do grupo. UPDATE/DELETE/TRUNCATE recusados por trigger. Nunca codigo completo.';
