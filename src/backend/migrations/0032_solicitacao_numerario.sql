-- 0032_solicitacao_numerario.sql
-- Frente I (v0.11) — auditoria/idempotência da GERAÇÃO de SOLICITAÇÃO DE NUMERÁRIO (SN) no ERP
-- (`com299/gerDocProcesso`, tela com068). O botão "Processar" passa a GERAR uma SN (em vez da baixa
-- fin010). Write-ahead: a intenção é gravada (status='reconciling') ANTES do POST; vira 'settled' só
-- após a confirmação (doc_cod = messages[].vars.docCod) do ERP; em falha vira 'error' com a resposta
-- crua, para conferência manual. SQL idempotente.
--
-- Idempotência POR ADIANTAMENTO: `idempotency_key` (= 'numerario:{adto}:{valor}') é UNIQUE — uma
-- re-execução com a mesma chave NÃO gera novo documento (curto-circuita para a linha existente).
-- Crítico: gerDocProcesso é ESCRITA IRREVERSÍVEL (cria documento real, não idempotente no ERP).
CREATE TABLE IF NOT EXISTS solicitacao_numerario (
    id                      BIGSERIAL PRIMARY KEY,
    idempotency_key         TEXT NOT NULL,
    adiantamento_doc_cod    TEXT NOT NULL,
    fil_cod                 INTEGER NOT NULL,
    pri_cod                 TEXT,
    pes_cod                 TEXT,
    gcd_cod                 INTEGER,
    valor                   NUMERIC,
    -- pending: criada mas não iniciada | reconciling: write-ahead, POST em voo
    -- settled: confirmada pelo ERP (doc_cod) | error: falhou (ver erp_response)
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'reconciling', 'settled', 'error')),
    -- TRUE quando a geração rodou em dry-run (montou/logou o payload, sem POST real).
    dry_run                 BOOLEAN NOT NULL DEFAULT TRUE,
    -- Handle da SN gerada na Tela 1 / com299 (messages[].vars.docCod) — reconciliação + retomada.
    doc_cod                 BIGINT,
    -- Borderô do recebimento fin014 (Tela 2) — retomada anti-duplicação.
    fin014_bor_cod          BIGINT,
    -- Handle da nota de débito gerada na Tela 3 / com297 (fluxo de 3 telas do guia).
    nd_doc_cod              BIGINT,
    -- Última etapa: sn | sn-finalizar | fin014 | fin014-done | nota-debito | nota-debito-fiscal | concluido.
    etapa                   TEXT,
    -- payload enviado + resposta do ERP (ou erro) — trilha de auditoria.
    request_payload         JSONB,
    erp_response            JSONB,
    erro_mensagem           TEXT,
    executado_por           TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_adto
    ON solicitacao_numerario (adiantamento_doc_cod);
CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_status
    ON solicitacao_numerario (status);
