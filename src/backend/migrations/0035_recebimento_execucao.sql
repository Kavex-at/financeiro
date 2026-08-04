-- 0035_recebimento_execucao.sql
-- Frente IV (Recebimentos) — Módulo 5. Write-ahead ledger da EXECUÇÃO da baixa/quitação + NDe no ERP.
-- Espelha permuta_alocacao_execucao (0015): a intenção é gravada (status='reconciling') ANTES do POST;
-- vira 'settled' só após a confirmação do ERP; em falha vira 'error' com a resposta crua.
-- Idempotência: `idempotency_key` é UNIQUE — re-execução com a mesma chave NÃO cria nova quitação
-- nem nova NDe (curto-circuita para a linha existente). SQL idempotente.
-- Ver ontology/business-rules/idempotencia-quitacao-nde.md.
CREATE TABLE IF NOT EXISTS recebimento_execucao (
    id                      BIGSERIAL PRIMARY KEY,
    idempotency_key         TEXT NOT NULL,
    recebimento_id          TEXT NOT NULL,
    fil_cod                 INTEGER NOT NULL,
    -- pending: criada mas ainda não iniciada | reconciling: write-ahead, POST em voo
    -- settled: confirmada pelo ERP | error: falhou (ver erp_response)
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'reconciling', 'settled', 'error')),
    -- TRUE quando a execução rodou em dry-run (montou/logou o payload, sem POST real).
    dry_run                 BOOLEAN NOT NULL DEFAULT TRUE,
    bor_cod                 BIGINT,
    nde_id                  TEXT,
    request_payload         JSONB,
    erp_response            JSONB,
    erro_mensagem           TEXT,
    executado_por           TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_recebimento_execucao_recebimento ON recebimento_execucao (recebimento_id);
CREATE INDEX IF NOT EXISTS idx_recebimento_execucao_status ON recebimento_execucao (status);
