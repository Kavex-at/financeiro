-- 0049_aprovacao_trilha.sql
-- Frente V (Workflow de Aprovação) — F1: snapshot da trilha de aprovação dos títulos a pagar.
-- ADR-0038. Read-only no ERP: estas tabelas são um ESPELHO observado do Conexos, nunca a origem.
-- SQL idempotente (re-runnable). Ver ontology/entities/{titulo-aprovacao,etapa-aprovacao}.md.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Cabeçalho do título sob a ótica do workflow. Chave natural = (fil_cod, doc_cod, tit_cod).
--
-- `fil_cod` faz parte da PK e NUNCA tem default: consultar a trilha no ERP com a filial errada
-- devolve `count: 0` SEM erro (invariante I5) — um falso negativo mudo que já custou uma rodada
-- inteira de sondagem. A filial vem sempre do próprio registro do título.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aprovacao_titulo (
    fil_cod             INTEGER NOT NULL,
    doc_cod             INTEGER NOT NULL,
    tit_cod             INTEGER NOT NULL,

    documento_numero    TEXT,
    titulo_numero       TEXT,
    -- Dimensões do analítico da Fase 2, materializadas na ingestão (ADR-0038): sem elas, a Fase 2
    -- precisaria de um join retroativo contra o ERP para histórico que talvez já não exista lá.
    fornecedor_cod      INTEGER,
    fornecedor_nome     TEXT,
    valor               NUMERIC,
    moeda               TEXT,

    -- `docDtaEmissao` é campo `Dta*`: data pura (meia-noite), sem hora.
    data_emissao        TIMESTAMPTZ,
    data_vencimento     TIMESTAMPTZ,
    -- `docDtaFinalizacao` — o marco zero descrito pelo cliente. Hoje SEMPRE nulo: não vem na
    -- projeção acessível. Ver PV-04 / PV-07 em ontology/_inbox/frente-v-pendencias-validacao.md.
    data_finalizacao    TIMESTAMPTZ,

    -- Derivado das etapas por StatusWorkflowResolver. Guardado para o painel filtrar em SQL.
    status_workflow     TEXT NOT NULL
                        CHECK (status_workflow IN ('SEM_WORKFLOW', 'AGUARDANDO', 'APROVADO',
                                                   'REJEITADO', 'INDETERMINADO')),
    etapas_concluidas   INTEGER NOT NULL DEFAULT 0,
    -- Etapas CONHECIDAS, não "quantas o fluxo exige": o ERP não expõe o total planejado.
    etapas_totais       INTEGER NOT NULL DEFAULT 0,

    primeira_etapa_em   TIMESTAMPTZ,
    ultima_acao_em      TIMESTAMPTZ,
    tempo_total_segundos BIGINT,

    -- O que NÃO conseguimos afirmar sobre este título (invariantes I3/I4). A UI exibe.
    lacunas             JSONB NOT NULL DEFAULT '[]'::jsonb,

    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    ingestao_run_id     TEXT,
    -- Idade do snapshot. Exposta obrigatoriamente na UI (invariante I7).
    observado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (fil_cod, doc_cod, tit_cod)
);

CREATE INDEX IF NOT EXISTS idx_aprovacao_titulo_status
    ON aprovacao_titulo (status_workflow);
CREATE INDEX IF NOT EXISTS idx_aprovacao_titulo_fil_emissao
    ON aprovacao_titulo (fil_cod, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_aprovacao_titulo_fornecedor
    ON aprovacao_titulo (fornecedor_cod);
CREATE INDEX IF NOT EXISTS idx_aprovacao_titulo_observado
    ON aprovacao_titulo (observado_em DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Uma etapa da trilha (um bloqueio no Conexos). Chave natural inclui fbl_cod + ftb_cod.
--
-- `status_erp` guarda o inteiro BRUTO do ERP mesmo quando não sabemos lê-lo (os 13 casos de
-- ftbVldStatus = 7 — PV-01). Preservar o número permite reclassificar por migration quando a
-- pendência fechar, sem reingerir ~23 mil títulos.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aprovacao_etapa (
    fil_cod             INTEGER NOT NULL,
    doc_cod             INTEGER NOT NULL,
    tit_cod             INTEGER NOT NULL,
    fbl_cod             INTEGER NOT NULL,
    ftb_cod             INTEGER NOT NULL,

    -- `fblDesNome` — CONTROLLER, TI, FISCAL, DIRETORIA II, ...
    nome                TEXT,
    -- `aprovador` — rótulo de ALÇADA, não identidade: mistura setor (COMPRAS) e pessoa (PV-10).
    alcada              TEXT,
    -- `fbaDesNome` — LIBERAR | APROVAR. Diferença de negócio em aberto (PV-02).
    acao                TEXT,

    -- `usnDesNomeCmd` — a pessoa que agiu. Chave (frágil) do analítico da Fase 2.
    responsavel_nome    TEXT,
    -- `usnCodCmd` — identidade estável. Hoje sempre nulo; a coluna existe para receber o dado
    -- quando PV-07 (acesso à tela fin103) for resolvida, sem nova migration de schema.
    responsavel_cod     INTEGER,

    status_erp          INTEGER,
    status              TEXT NOT NULL
                        CHECK (status IN ('PENDENTE', 'CONCLUIDA', 'REJEITADA', 'INDETERMINADO')),

    -- Campos `Tim*` do Conexos preservam hora/minuto/segundo (confirmado em produção).
    recebido_em         TIMESTAMPTZ,
    agido_em            TIMESTAMPTZ,
    -- NULL quando pendente ou inconsistente — nunca estimado (invariante I3).
    duracao_segundos    BIGINT,

    observacao          TEXT,

    -- Anti-fantasma POR TÍTULO: etapa que sumiu do ERP vira inativa, nunca é apagada (I6/PV-06).
    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    ingestao_run_id     TEXT,
    observado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod)
);

CREATE INDEX IF NOT EXISTS idx_aprovacao_etapa_titulo
    ON aprovacao_etapa (fil_cod, doc_cod, tit_cod);
CREATE INDEX IF NOT EXISTS idx_aprovacao_etapa_responsavel
    ON aprovacao_etapa (responsavel_nome);
CREATE INDEX IF NOT EXISTS idx_aprovacao_etapa_status
    ON aprovacao_etapa (status);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Auditoria e CURSOR da ingestão. O cursor é o que torna o backfill retomável: sem acesso ao
-- fin103 (PV-07) a trilha custa 1 chamada por título — 23.632 títulos só na filial 2 em 12 meses.
-- Um job que não retoma jamais termina essa carga.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aprovacao_ingestao_run (
    id                  TEXT PRIMARY KEY,
    triggered_by        TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
    fil_cods            JSONB NOT NULL DEFAULT '[]'::jsonb,
    emissao_desde       TIMESTAMPTZ,
    total_titulos       INTEGER NOT NULL DEFAULT 0,
    total_etapas        INTEGER NOT NULL DEFAULT 0,
    -- Cursor gravado DEPOIS de o título ser persistido: retomar repete no máximo um título.
    cursor_fil_cod      INTEGER,
    cursor_pagina       INTEGER,
    cursor_doc_cod      INTEGER,
    error_message       TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_aprovacao_ingestao_run_status
    ON aprovacao_ingestao_run (status, started_at DESC);
