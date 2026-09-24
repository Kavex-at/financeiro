-- 0062_boleto_dda.sql
-- Snapshot local do pool de boletos DDA do Conexos (`fin124`, Importação de Arquivo DDA).
--
-- O pool é GLOBAL (da conta pagadora, não da filial), tem ~24 mil boletos em ~160 arquivos e
-- cresce um arquivo por dia útil. Ler ao vivo custaria 160+ chamadas ao Conexos por abertura da
-- aba, então a aba "Boletos DDA" do SISPAG lê daqui. Quem escreve é só a sincronização
-- (`BoletoDdaService.sincronizar`, job `ingest-boletos-dda` ou botão manual) — READ-ONLY no ERP.
--
-- `vencimento` é DATE (data civil, sem hora e sem fuso) e é lido sempre com
-- `to_char(vencimento, 'YYYY-MM-DD')`, pela mesma razão da 0061.
--
-- Aditiva, tabelas novas, sem backfill. Por isso não há reverse em `rollbacks/`.

CREATE TABLE IF NOT EXISTS boleto_dda_arquivo (
    ddc_cod          INTEGER PRIMARY KEY,
    nome             TEXT,
    importado_em     TIMESTAMPTZ,
    cancelado_em     TIMESTAMPTZ,
    status           SMALLINT,
    total_itens      INTEGER NOT NULL DEFAULT 0,
    sincronizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boleto_dda (
    ddc_cod          INTEGER NOT NULL REFERENCES boleto_dda_arquivo (ddc_cod) ON DELETE CASCADE,
    dit_cod          INTEGER NOT NULL,
    numero           TEXT,
    valor            NUMERIC(15, 2) NOT NULL,
    vencimento       DATE,
    codbar           TEXT,
    -- Vínculo que o PRÓPRIO Conexos grava quando o fin015 associa o boleto a um título
    -- (`titVldReflexoDdaAssoc`). Vazio = boleto livre. Nunca escrito por nós.
    fil_cod          INTEGER,
    doc_cod          TEXT,
    tit_cod          TEXT,
    flp_cod          INTEGER,
    bnc_cod          INTEGER,
    sincronizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ddc_cod, dit_cod)
);

CREATE INDEX IF NOT EXISTS idx_boleto_dda_vencimento ON boleto_dda (vencimento);
CREATE INDEX IF NOT EXISTS idx_boleto_dda_valor ON boleto_dda (valor);
