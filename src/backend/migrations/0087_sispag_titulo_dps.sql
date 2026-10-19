-- 0087_sispag_titulo_dps.sql
-- ADR-0073 (I15p) — número da DPS por título, lido do PDF da NFS-e no GED do Conexos.
--
-- O emissor de NFS-e (medido: MULTILOG) numera o boleto DDA como `<DPS>000`, e o Conexos NÃO guarda
-- o DPS (`doc_esp_numero` é o nº da NFS-e; o `com243` não tem a NFS-e importada). A única fonte é o
-- PDF da NFS-e no GED. Esta tabela guarda o que foi lido, UMA linha por título:
--   - `LIDO`: o PDF trouxe o DPS; é insumo da sugestão (âncora direta e prova do escopo da ordem);
--   - `SEM_PDF` / `SEM_DPS_NO_PDF` / `ERRO`: tentativa registrada com motivo, para não reler
--     indefinidamente (`tentativas` limita a nova tentativa).
--
-- `pes_cod` e `nfse` ficam aqui de propósito: o DPS lido continua provando o escopo (credor,
-- emissor) depois que o título sai da carteira (`titulo_a_pagar` só guarda os ativos).
--
-- Não é evidência de confirmação (a confirmação segue sendo da analista, I15g). Só leitura no
-- Conexos (I15b). Aditiva, tabela nova, sem backfill: por isso não há reverse em `rollbacks/`.

CREATE TABLE IF NOT EXISTS titulo_dps (
    fil_cod        INTEGER NOT NULL,
    doc_cod        TEXT NOT NULL,
    tit_cod        TEXT NOT NULL,
    pes_cod        TEXT,
    nfse           TEXT,
    dps            TEXT,
    status         TEXT NOT NULL,
    fonte          TEXT NOT NULL DEFAULT 'PDF_GED',
    -- Nome do arquivo lido no GED (ex.: `NF_86666.PDF`), para auditoria. Nunca o conteúdo.
    arquivo        TEXT,
    motivo         TEXT,
    tentativas     INTEGER NOT NULL DEFAULT 1,
    lido_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (fil_cod, doc_cod, tit_cod),
    CONSTRAINT titulo_dps_status_check
        CHECK (status IN ('LIDO', 'SEM_PDF', 'SEM_DPS_NO_PDF', 'ERRO')),
    CONSTRAINT titulo_dps_fonte_check CHECK (fonte IN ('PDF_GED')),
    -- Só `LIDO` tem DPS, e o DPS é número puro (é comparado como `<DPS>000` com o boleto).
    CONSTRAINT titulo_dps_lido_check CHECK (
        (status = 'LIDO' AND dps ~ '^[0-9]{1,15}$') OR (status <> 'LIDO' AND dps IS NULL)
    ),
    CONSTRAINT titulo_dps_tentativas_check CHECK (tentativas >= 1)
);

-- A sugestão lê só os `LIDO` (a cada cálculo do cenário).
CREATE INDEX IF NOT EXISTS idx_titulo_dps_lido ON titulo_dps (pes_cod) WHERE status = 'LIDO';
