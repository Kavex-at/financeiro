-- 0050 — ledger write-ahead da CONCILIAÇÃO do retorno (availability-1 / fault-tolerance-1).
--
-- `PUT fin052/arquivosRetorno/processar` é IRREVERSÍVEL: gera baixas no fin010. Hoje a rota
-- chama esse PUT sem nenhuma trilha — dois cliques na tela, ou um restart do Render entre o
-- PUT e a resposta HTTP, disparam a chamada duas vezes e o ERP grava baixas em cima das
-- antigas. Duplicação monetária silenciosa.
--
-- Espelha `remessa_execucao` (0049), que por sua vez espelha `solicitacao_numerario_execucao`.
-- A chave de identidade é o ARQUIVO de retorno: (fil, bnc, gtbCodSeq, garCodSeq).
CREATE TABLE IF NOT EXISTS conciliacao_execucao (
    id                  BIGSERIAL PRIMARY KEY,
    idempotency_key     TEXT NOT NULL,
    correlation_id      TEXT,
    fil_cod             INTEGER NOT NULL,
    bnc_cod             INTEGER NOT NULL,
    gtb_cod_seq         INTEGER NOT NULL,
    gar_cod_seq         INTEGER NOT NULL,
    -- pending: criada, não iniciada | reconciling: write-ahead, PUT do processar em voo
    -- settled: conciliação concluída | error: falhou (ver erro_mensagem)
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'reconciling', 'settled', 'error')),
    -- TRUE quando rodou em dry-run (leu e classificou, sem PUT nem gravação local).
    dry_run             BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE quando o `processar` (que gera as baixas no fin010) chegou a ser chamado.
    processou           BOOLEAN NOT NULL DEFAULT FALSE,
    total_linhas        INTEGER,
    pagos               INTEGER,
    rejeitados          INTEGER,
    -- TRUE quando algum código de evento não pôde ser lido: conciliação PARCIAL.
    varredura_incompleta BOOLEAN NOT NULL DEFAULT FALSE,
    erro_mensagem       TEXT,
    executado_por       TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_conciliacao_execucao_status ON conciliacao_execucao (status);
CREATE INDEX IF NOT EXISTS idx_conciliacao_execucao_arquivo
    ON conciliacao_execucao (fil_cod, bnc_cod, gtb_cod_seq, gar_cod_seq);
