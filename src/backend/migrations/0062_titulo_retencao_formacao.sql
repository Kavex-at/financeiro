-- Migration 0062 — retenção de um título da formação automática de lotes (ADR-0050, I9).
--
-- ─── O caso ──────────────────────────────────────────────────────────────────
-- A analista tira um título de um lote automático porque ele não deve sair no
-- pagamento do dia. A formação automática roda depois de toda ingestão e elege
-- todo título ativo, aprovado, não pago, a vencer em até 7 dias e fora de lote
-- RASCUNHO. O título retirado satisfaz tudo isso e volta na rodada seguinte. A
-- decisão dela precisa de um lugar onde fique registrada: é esta tabela.
--
-- ─── Por que uma TABELA e não uma coluna em titulo_a_pagar ───────────────────
-- `titulo_a_pagar` é espelho do ERP: reescrita por UPSERT a cada ingestão e já
-- purgada uma vez (0030). Estado que só a analista produz não pode depender de a
-- allowlist do UPSERT continuar omitindo a coluna. Mesmo padrão de
-- `cliente_filtro` (0013) e `permuta_excecao_manual` (0059).
--
-- ─── Soft delete como trilha ─────────────────────────────────────────────────
-- Liberar NÃO apaga: grava `removido_por`/`removido_em` e o motivo do
-- encerramento (`liberado` pela ação explícita, `incluido-no-lote` quando alguém
-- inclui o título num lote à mão). Uma retenção é ativa enquanto
-- `removido_em IS NULL`; o índice parcial garante no máximo UMA ativa por título
-- e permite reter de novo depois de liberar.
--
-- ─── Por que não há FK nem reverse ───────────────────────────────────────────
-- Sem FK para `titulo_a_pagar`: um rebuild da carteira não pode levar as
-- decisões junto. Sem script de reverse: a política de `rollbacks/README.md` o
-- exige para UPDATE > 1.000 linhas; esta migration só cria tabela e índice.
--
-- Idempotente de ponta a ponta. SQL estático: nenhum valor interpolado.

CREATE TABLE IF NOT EXISTS titulo_retencao_formacao (
    id              BIGSERIAL PRIMARY KEY,
    fil_cod         INTEGER     NOT NULL,
    doc_cod         TEXT        NOT NULL,
    tit_cod         TEXT        NOT NULL,
    motivo          TEXT,
    marcado_por     TEXT        NOT NULL,
    marcado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    removido_por    TEXT,
    removido_em     TIMESTAMPTZ,
    motivo_remocao  TEXT
);

ALTER TABLE titulo_retencao_formacao
    DROP CONSTRAINT IF EXISTS titulo_retencao_formacao_motivo_tamanho;

ALTER TABLE titulo_retencao_formacao
    ADD CONSTRAINT titulo_retencao_formacao_motivo_tamanho
        CHECK (motivo IS NULL OR char_length(motivo) <= 500);

ALTER TABLE titulo_retencao_formacao
    DROP CONSTRAINT IF EXISTS titulo_retencao_formacao_remocao_pareada;

ALTER TABLE titulo_retencao_formacao
    ADD CONSTRAINT titulo_retencao_formacao_remocao_pareada
        CHECK ((removido_em IS NULL) = (removido_por IS NULL)
               AND (removido_em IS NULL) = (motivo_remocao IS NULL));

ALTER TABLE titulo_retencao_formacao
    DROP CONSTRAINT IF EXISTS titulo_retencao_formacao_motivo_remocao;

ALTER TABLE titulo_retencao_formacao
    ADD CONSTRAINT titulo_retencao_formacao_motivo_remocao
        CHECK (motivo_remocao IS NULL
               OR motivo_remocao IN ('liberado', 'incluido-no-lote'));

-- No máximo UMA retenção ativa por título; o histórico são as removidas. Serve
-- também ao NOT EXISTS da formação automática e ao LEFT JOIN do painel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_titulo_retencao_formacao_ativa
    ON titulo_retencao_formacao (fil_cod, doc_cod, tit_cod)
    WHERE removido_em IS NULL;
