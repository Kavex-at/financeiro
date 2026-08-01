-- 0041_solicitacao_numerario_execucao.sql
-- Frente IV (Recebimentos) — Solicitação de Numerário (com299). Write-ahead ledger da EXECUÇÃO da SN.
-- Espelha recebimento_execucao (0035): a intenção é gravada (status='reconciling') ANTES do primeiro
-- POST ao com299; vira 'settled' só após `finalizaDocumento` confirmar; em falha vira 'error' com a
-- resposta crua. Como o com299 é multi-call (POST cabeçalho → comDocProdutos → calculaValorLiquido →
-- finalizaDocumento), `doc_cod` é persistido ASSIM QUE o cabeçalho é criado (`setDocCod`) — se o
-- processo morrer no meio da sequência, a trilha aponta o documento órfão a conciliar/estornar.
-- Idempotência: `idempotency_key` é UNIQUE — re-execução com a mesma chave NÃO cria nova SN
-- (curto-circuita para a linha existente). SQL idempotente. NÃO aplicar à Supabase compartilhada sem OK.
-- Ver ontology/integrations/conexos-com299-gerdoc.md.
CREATE TABLE IF NOT EXISTS solicitacao_numerario_execucao (
    id                      BIGSERIAL PRIMARY KEY,
    idempotency_key         TEXT NOT NULL,
    -- correlationId enviado pelo cliente (estável por tentativa de "Processar") — trilha de auditoria.
    correlation_id          TEXT,
    fil_cod                 INTEGER NOT NULL,
    -- nº do processo de importação (priCod) que originou a SN.
    pri_cod                 INTEGER NOT NULL,
    -- pending: criada mas ainda não iniciada | reconciling: write-ahead, sequência com299 em voo
    -- settled: finalizada pelo ERP | error: falhou (ver erp_response)
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'reconciling', 'settled', 'error')),
    -- TRUE quando a execução rodou em dry-run (montou/logou o payload, sem POST real).
    dry_run                 BOOLEAN NOT NULL DEFAULT TRUE,
    -- handle de reconciliação do com299 (docCod do cabeçalho criado).
    doc_cod                 BIGINT,
    request_payload         JSONB,
    erp_response            JSONB,
    erro_mensagem           TEXT,
    executado_por           TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_execucao_pri ON solicitacao_numerario_execucao (pri_cod);
CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_execucao_status ON solicitacao_numerario_execucao (status);
