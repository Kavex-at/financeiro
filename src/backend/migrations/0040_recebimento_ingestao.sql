-- 0040_recebimento_ingestao.sql
-- Frente IV / Módulo 1 — Ingestão de EXTRATOS BANCÁRIOS (Conexos fin095).
--
-- Espelha 0024_pagamento_ingestao (SISPAG): run de auditoria + idempotência da
-- ingestão manual. A tabela `transacao_bancaria` já existe (0032) e aqui só CRESCE
-- de forma aditiva — a 0032 previa isso ("o wire real vem na Fase 1").
--
-- Fonte confirmada em produção: `fin095/list` filtrado por `gerNum` (conta
-- financeira do `fin133`) + janela `exiDtaLcto#GE/#LE`. A tela `fin134` lista os
-- ARQUIVOS .RET importados, não os lançamentos — por isso não há tabela de lote.
-- SQL idempotente.

-- Run de auditoria da ingestão (quem/quando/status/contagens).
CREATE TABLE IF NOT EXISTS recebimento_ingestao_run (
    id                      UUID PRIMARY KEY,
    correlation_id          TEXT NOT NULL,
    -- 'cron' | <usuário> — origem do disparo.
    triggered_by            TEXT NOT NULL,
    -- 'partial' = a run terminou mas ao menos uma CONTA falhou. Distinção
    -- deliberada vs. SISPAG (que fecha 'success' com filial falhada): o painel usa
    -- a última run 'success' para dizer "carteira de HH:mm" com honestidade.
    status                  TEXT NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'success', 'partial', 'error')),
    fil_cods                INTEGER[] NOT NULL DEFAULT '{}',
    periodo_de              TIMESTAMPTZ,
    periodo_ate             TIMESTAMPTZ,
    total_lidas             INTEGER NOT NULL DEFAULT 0,
    total_inseridas         INTEGER NOT NULL DEFAULT 0,
    total_deduplicadas      INTEGER NOT NULL DEFAULT 0,
    total_contas            INTEGER NOT NULL DEFAULT 0,
    total_contas_falhas     INTEGER NOT NULL DEFAULT 0,
    error_message           TEXT,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recebimento_ingestao_run_finished
    ON recebimento_ingestao_run (finished_at DESC);

-- Idempotência da ingestão manual por Idempotency-Key.
CREATE TABLE IF NOT EXISTS recebimento_ingestao_idempotency (
    idempotency_key         TEXT PRIMARY KEY,
    run_id                  UUID NOT NULL,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Crescimento aditivo de transacao_bancaria (0032) ────────────────────────

-- `ger_num` é COLUNA, não JSONB: é a "Conta Financeira de Baixa" que o `fin014`
-- vai exigir na Fase 5 (o print do runbook mostra o campo 38 = Itaú AG 0641).
-- Enterrar num `normalized->>'gerNum'` significaria um cast num caminho que
-- move dinheiro.
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS ger_num INTEGER;

-- Run que viu a transação pela ÚLTIMA vez (≠ `import_run_id`, que é a run que a
-- criou). Permite auditar frescor sem sobrescrever a origem.
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS visto_em_run_id UUID;
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;

-- Categoria do lançamento no extrato (`exiEspCategoria`/`Desc` do fin095).
-- Persistida como coluna porque é o discriminador de RUÍDO DE TESOURARIA: em
-- produção, 90 dias da filial 1 trazem 1.759 créditos, dos quais ~270 são
-- RESGATE DE APLICAÇÃO / AÇÕES / TRANSFERÊNCIA ENTRE CONTAS — que não são
-- recebimento de cliente. O painel filtra por aqui; a ingestão NÃO descarta
-- (o extrato é fonte da verdade e o filtro precisa ser reversível).
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS categoria_desc TEXT;

-- NÃO há coluna `ativo`/anti-fantasma aqui, ao contrário de `titulo_a_pagar`:
-- extrato bancário é imutável — um lançamento não "some" da fonte. Se sumisse,
-- seria sinal de problema, não de conciliação.

CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_painel
    ON transacao_bancaria (fil_cod, tipo, data_movimento DESC);
CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_ger_num
    ON transacao_bancaria (ger_num);
