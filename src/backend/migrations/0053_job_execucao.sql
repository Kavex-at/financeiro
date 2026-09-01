-- 0053 — trilha de execução para jobs NOVOS (ADR-0042).
--
-- A ADR-0042 decidiu NÃO migrar os três writers de run existentes: são caminhos que movem dinheiro,
-- e migrá-los enquanto ainda não havia alerta nenhum seria a mudança mais arriscada do repositório
-- feita no pior momento possível. Essa decisão vale para o que JÁ EXISTE.
--
-- Para um job NOVO a conta é outra. O `reaper-sispag` mostrou o custo de nascer sem trilha: ele é
-- justamente o job cuja cegueira estava documentada por escrito, e o painel não consegue vigiá-lo.
-- Repetir isso com o reconciliador da NDe entregaria um segundo ponto cego no mesmo slice que
-- existe para eliminá-los.
--
-- Esta tabela é ADITIVA — nenhum writer existente é tocado, o que respeita a restrição da ADR-0042.
-- É também o destino pronto do follow-up "dar trilha ao reaper": basta ele passar a escrever aqui.
CREATE TABLE IF NOT EXISTS job_execucao (
    id              UUID PRIMARY KEY,
    -- Identificador do pipeline, igual ao usado no read-model `JobRun`.
    pipeline        TEXT NOT NULL,
    -- 'cron' | 'manual' | <usuário> — origem do disparo.
    triggered_by    TEXT NOT NULL,
    -- Mesmo vocabulário das outras fontes, `partial` INCLUÍDO desde o nascimento: um job novo não
    -- tem por que herdar a cegueira do `pagamento_ingestao_run`, que fecha `success` mesmo com
    -- filial falhada.
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'partial', 'error')),
    -- Métricas próprias do job, sem denominador comum forçado (ver entities/job-run.md).
    metricas        JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);

-- Leitura quente do painel: a última run de cada pipeline.
CREATE INDEX IF NOT EXISTS idx_job_execucao_pipeline_finished
    ON job_execucao (pipeline, finished_at DESC);
