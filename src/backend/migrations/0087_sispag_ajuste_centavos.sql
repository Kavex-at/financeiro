-- 0087_sispag_ajuste_centavos.sql
-- ADR-0073 (I18) — ajuste de centavos do título por renegociação no `fin070`. Cinco blocos,
-- todos ADITIVOS e idempotentes:
--
--   1. ledger `sispag_ajuste_centavos_execucao` (padrão I-2: escrita irreversível no ERP com
--      identidade Conexos), write-ahead por etapa (I18h), chave de idempotência por
--      (filial, documento, título de origem, decisão) e NO MÁXIMO UM ledger não terminal por título
--      de origem (índice único parcial);
--   2. `sispag_decisao_sugestao_boleto` ganha `tipo_anulacao`, `origem_decisao_id` e
--      `transferida_por` (M1). O CHECK `anulador_check` da 0084 é relaxado SÓ para a anulação
--      pelo sistema com `tipo_anulacao = 'TITULO_RENEGOCIADO'`; `unknown` continua proibido e a
--      decisão humana (`transferida_por` nulo) segue sem `sistema` em `decidido_por`. Os CHECKs
--      usam `IS NOT DISTINCT FROM`: com `=`, um `tipo_anulacao` nulo daria NULL e o CHECK passaria;
--   3. a trilha `sispag_sugestao_boleto_evento` aceita os 6 tipos novos (só-inclusão intacta) e
--      ganha a idempotência do `AJUSTE_SIMULADO` (a varredura `shadow` roda a cada tela aberta);
--   4. a trilha do lote `sispag_verificacao_evento` (0078) aceita `ITEM_TITULO_RENEGOCIADO`;
--   5. `alerta.tipo` aceita `sispag-ajuste-centavos-parado` (ajuste parado em `indeterminado` ou
--      `aguardando_aprovacao_manual` vira Alerta no Painel de Operação; decisão 2026-10-20).
--
-- ── PRIVACIDADE (I17j/I15k) ───────────────────────────────────────────────────────────────────
-- Só o código MASCARADO persiste (5+4, "…"); o CHECK faz o esquema recusar código longo.
--
-- Sem backfill: decisão legada fica com `tipo_anulacao` nulo (derivado do motivo na leitura).
-- Reverse (só estrutura) em `rollbacks/0087_sispag_ajuste_centavos.rollback.sql`.

-- ── 1. Ledger do ajuste ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sispag_ajuste_centavos_execucao (
    id                      UUID PRIMARY KEY,
    fil_cod                 INTEGER NOT NULL,
    doc_cod                 TEXT NOT NULL,
    tit_cod_origem          TEXT NOT NULL,
    decisao_id              UUID NOT NULL REFERENCES sispag_decisao_sugestao_boleto (id),
    tit_cod_novo            TEXT NULL,
    frn_cod                 INTEGER NULL,
    marcador                TEXT NOT NULL,
    etapa                   TEXT NOT NULL DEFAULT 'pendente',
    -- Write-ahead (I18h): a chamada ao ERP que está em curso, gravada ANTES dela.
    intencao                TEXT NULL,
    intencao_em             TIMESTAMPTZ NULL,
    motivo                  TEXT NULL,
    delta_centavos          INTEGER NULL,
    frn_vld_tpop            SMALLINT NULL,
    valor_boleto_centavos   BIGINT NULL,
    codigo_mascarado        TEXT NULL,
    fbl_cod                 INTEGER NULL,
    conexos_username        TEXT NULL,
    conexos_usn_cod         TEXT NULL,
    tentativas              INTEGER NOT NULL DEFAULT 0,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em            TIMESTAMPTZ NULL,
    CONSTRAINT sispag_ajuste_centavos_execucao_etapa_check CHECK (etapa IN (
        'pendente', 'renegociacao_criada', 'titulo_incluido', 'composicao_gravada',
        'ajuste_aplicado', 'finalizada', 'liberada', 'sem_bloqueio', 'rechaveada',
        'concluido', 'concluido_sem_decisao', 'aguardando_aprovacao_manual', 'cancelado',
        'recusado', 'indeterminado', 'simulado'
    )),
    CONSTRAINT sispag_ajuste_centavos_execucao_tpop_check CHECK (
        frn_vld_tpop IS NULL OR frn_vld_tpop IN (1, 2)
    ),
    CONSTRAINT sispag_ajuste_centavos_execucao_delta_check CHECK (
        delta_centavos IS NULL OR delta_centavos <> 0
    ),
    CONSTRAINT sispag_ajuste_centavos_execucao_codigo_mascarado_check CHECK (
        codigo_mascarado IS NULL OR codigo_mascarado ~ '^[0-9]{5}…[0-9]{4}$'
    ),
    CONSTRAINT sispag_ajuste_centavos_execucao_marcador_check CHECK (
        length(btrim(marcador)) > 0 AND marcador !~ '[0-9]{20,}'
    ),
    CONSTRAINT sispag_ajuste_centavos_execucao_tentativas_check CHECK (tentativas >= 0),
    CONSTRAINT ux_sispag_ajuste_centavos_execucao_idempotencia UNIQUE (
        fil_cod, doc_cod, tit_cod_origem, decisao_id
    ),
    CONSTRAINT ux_sispag_ajuste_centavos_execucao_marcador UNIQUE (marcador)
);

-- No máximo UM ajuste não terminal por título de origem (I18h): a varredura e o "tentar de novo"
-- concorrentes nunca abrem duas renegociações para o mesmo título.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_ajuste_centavos_execucao_nao_terminal
    ON sispag_ajuste_centavos_execucao (fil_cod, doc_cod, tit_cod_origem)
    WHERE etapa NOT IN (
        'concluido', 'concluido_sem_decisao', 'aguardando_aprovacao_manual', 'cancelado',
        'recusado', 'indeterminado', 'simulado'
    );

-- Linhagem (I18a(7)): o título já é fruto de um ajuste nosso?
CREATE INDEX IF NOT EXISTS idx_sispag_ajuste_centavos_execucao_titulo_novo
    ON sispag_ajuste_centavos_execucao (fil_cod, doc_cod, tit_cod_novo)
    WHERE tit_cod_novo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sispag_ajuste_centavos_execucao_titulo
    ON sispag_ajuste_centavos_execucao (fil_cod, doc_cod, tit_cod_origem, criado_em);

-- ── 2. Decisão: tipo da anulação e transferência auditada (M1) ────────────────────────────────

ALTER TABLE sispag_decisao_sugestao_boleto
    ADD COLUMN IF NOT EXISTS tipo_anulacao TEXT NULL,
    ADD COLUMN IF NOT EXISTS origem_decisao_id UUID NULL
        REFERENCES sispag_decisao_sugestao_boleto (id),
    ADD COLUMN IF NOT EXISTS transferida_por TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_tipo_anulacao_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_tipo_anulacao_check CHECK (
                tipo_anulacao IS NULL
                OR (
                    decisao = 'ANULADA'
                    AND tipo_anulacao IN ('MANUAL', 'PAR_REVOGADO', 'TITULO_RENEGOCIADO')
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_transferencia_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_transferencia_check CHECK (
                (origem_decisao_id IS NULL AND transferida_por IS NULL)
                OR (
                    origem_decisao_id IS NOT NULL
                    AND transferida_por IS NOT DISTINCT FROM 'sistema'
                )
            );
    END IF;

    -- Relaxa a 0084 SÓ para a anulação pelo sistema que acompanha a renegociação do título.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_decisao_sugestao_boleto_anulador_check'
          AND conrelid = 'sispag_decisao_sugestao_boleto'::regclass
          AND pg_get_constraintdef(oid) LIKE '%TITULO_RENEGOCIADO%'
    ) THEN
        ALTER TABLE sispag_decisao_sugestao_boleto
            DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_anulador_check;
        ALTER TABLE sispag_decisao_sugestao_boleto
            ADD CONSTRAINT sispag_decisao_sugestao_boleto_anulador_check CHECK (
                anulada_por IS NULL
                OR (
                    lower(btrim(anulada_por)) <> 'unknown'
                    AND (
                        lower(btrim(anulada_por)) <> 'sistema'
                        OR tipo_anulacao IS NOT DISTINCT FROM 'TITULO_RENEGOCIADO'
                    )
                )
            );
    END IF;
END
$$;

-- ── 3. Trilha da sugestão: seis tipos novos ───────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_sugestao_boleto_evento_tipo_check'
          AND conrelid = 'sispag_sugestao_boleto_evento'::regclass
          AND pg_get_constraintdef(oid) LIKE '%AJUSTE_SIMULADO%'
    ) THEN
        ALTER TABLE sispag_sugestao_boleto_evento
            DROP CONSTRAINT IF EXISTS sispag_sugestao_boleto_evento_tipo_check;
        ALTER TABLE sispag_sugestao_boleto_evento
            ADD CONSTRAINT sispag_sugestao_boleto_evento_tipo_check CHECK (tipo IN (
                'PAR_CONFIRMADO', 'DECISAO_CONFIRMADA', 'DECISAO_REJEITADA', 'DECISAO_ANULADA',
                'PAR_REVOGADO', 'LINHA_COPIADA',
                'VINCULO_APLICADO', 'VINCULO_SIMULADO', 'VINCULO_FALHOU',
                'AJUSTE_SIMULADO', 'TITULO_RENEGOCIADO', 'DECISAO_TRANSFERIDA',
                'AJUSTE_RECUSADO', 'AJUSTE_CANCELADO', 'AJUSTE_FALHOU'
            ));
    END IF;
END
$$;

-- Um `AJUSTE_SIMULADO` por (título, decisão, resultado): a varredura `shadow` não inunda a trilha.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_sugestao_boleto_evento_ajuste_simulado
    ON sispag_sugestao_boleto_evento (
        fil_cod, doc_cod, tit_cod,
        COALESCE(decisao_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(motivo, '')
    )
    WHERE tipo = 'AJUSTE_SIMULADO';

-- ── 4. Trilha do lote: item que passou ao título renegociado ──────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sispag_verificacao_evento_evento_check'
          AND conrelid = 'sispag_verificacao_evento'::regclass
          AND pg_get_constraintdef(oid) LIKE '%ITEM_TITULO_RENEGOCIADO%'
    ) THEN
        ALTER TABLE sispag_verificacao_evento
            DROP CONSTRAINT IF EXISTS sispag_verificacao_evento_evento_check;
        ALTER TABLE sispag_verificacao_evento
            ADD CONSTRAINT sispag_verificacao_evento_evento_check CHECK (evento IN (
                'ALERTA_CRIADA', 'ALERTA_JUSTIFICADA', 'ALERTA_RETIRADA', 'ALERTA_OBSOLETA',
                'ALERTA_DESCARTADA', 'BLOQUEIO_CRIADO', 'BLOQUEIO_ENCERRADO', 'BLOQUEIO_DESFEITO',
                'PENDENCIA_ABERTA', 'PENDENCIA_ORIGEM_ACRESCENTADA', 'PENDENCIA_RESOLVIDA',
                'ITEM_REMOVIDO_SISTEMA', 'LOTE_CONFERIDO', 'LOTE_DEVOLVIDO', 'CONFERENCIA_LIMPA',
                'ITEM_TITULO_RENEGOCIADO'
            ));
    END IF;
END
$$;

-- ── 5. Alerta operacional: ajuste de centavos parado ─────────────────────────────────────────
-- Lista completa (a da 0080 + o tipo novo). DROP IF EXISTS + ADD: reaplicar é no-op.

ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-destino-alterado',
        'sispag-ajuste-centavos-parado'
    ));

COMMENT ON TABLE sispag_ajuste_centavos_execucao IS
    'ADR-0073 I18 — ledger write-ahead do ajuste de centavos do titulo (fin070/fin103). Um nao terminal por titulo de origem. Codigo so mascarado 5+4.';
COMMENT ON COLUMN sispag_decisao_sugestao_boleto.transferida_por IS
    'ADR-0073 M1 — sistema quando a decisao foi transferida ao titulo renegociado (decidido_por/decidido_em herdados da decisao humana original).';
