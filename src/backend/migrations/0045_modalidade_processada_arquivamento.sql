-- 0045_modalidade_processada_arquivamento.sql
-- Frente IV, Módulo 1 — ADR-0033. Três mudanças que andam juntas porque alimentam a MESMA tela
-- (a carteira de créditos): a modalidade do processo vira campo, a transação ganha o status
-- terminal `processada`, e o analista ganha como tirar da frente o que nunca será conciliado.
--
-- SQL idempotente.

-- ── 1. MODALIDADE do processo (imp021.priVldTipo) vira CAMPO ─────────────────
-- Até aqui a modalidade era resolvida no gate 0.5, usada para decidir a NDe e DESCARTADA: nenhuma
-- tabela a guardava. Sem ela persistida não há como responder "por que este recebimento fechou sem
-- nota?" seis meses depois — a resposta dependia de reconsultar o imp021, que pode ter mudado.
--
-- `nde_dispensada` é gravada JUNTO e não derivada de `pri_vld_tipo` na leitura: a regra de quem
-- emite mudou uma vez (ADR-0033 tirou PRÓPRIA de emissora) e vai poder mudar de novo. O que
-- aconteceu naquela execução é fato histórico; recalcular com a regra de hoje reescreveria o
-- passado.
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS pri_vld_tipo INTEGER;
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS nde_dispensada BOOLEAN;

COMMENT ON COLUMN solicitacao_numerario_execucao.pri_vld_tipo IS
    'imp021.priVldTipo do processo: 1 PRÓPRIA, 2 CONTA E ORDEM, 3 POR ENCOMENDA (ADR-0033). NULL em linhas anteriores à coluna.';
COMMENT ON COLUMN solicitacao_numerario_execucao.nde_dispensada IS
    'TRUE quando a NDe não era devida NAQUELA execução. Fato histórico — nunca recalcular pela regra atual.';

-- ── 2. Status `processada` em transacao_bancaria ─────────────────────────────
-- O CHECK da 0032 não conhecia `processada`. Precisa ser recriado: um CHECK não é alterável.
--
-- Contexto: até aqui NADA transicionava uma transação para fora de `importada` — a máquina de
-- estados existia em `recebimentoTransitions.ts` e nunca era acionada. Por isso a carteira mostrava
-- centenas de `importada` e zero conciliações mesmo com alocações executadas. `processada` é o
-- terminal que o ledger passa a escrever ao settlar (etapa `concluido` OU `quitado-sem-nde` — as
-- duas são trabalho concluído; a diferença entre elas é fiscal, não operacional).
ALTER TABLE transacao_bancaria DROP CONSTRAINT IF EXISTS transacao_bancaria_status_check;
ALTER TABLE transacao_bancaria ADD CONSTRAINT transacao_bancaria_status_check
    CHECK (status IN ('importada', 'conciliada', 'parcial', 'manual', 'erro', 'processada'));

-- ── 3. ARQUIVAMENTO ──────────────────────────────────────────────────────────
-- Timestamp + autor, não um boolean: "quem tirou isto da carteira e quando" é a pergunta que se faz
-- quando um crédito arquivado se revela devido. Desarquivar volta as duas para NULL.
--
-- Arquivar tira o crédito da listagem E dos KPIs (decisão do Yuri, 2026-08-10): serve para o ruído
-- de tesouraria — resgate de aplicação, transferência entre contas — que hoje infla o "a distribuir"
-- com dinheiro que nunca será conciliado contra processo.
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMPTZ;
ALTER TABLE transacao_bancaria ADD COLUMN IF NOT EXISTS arquivada_por TEXT;

COMMENT ON COLUMN transacao_bancaria.arquivada_em IS
    'Quando o analista arquivou o crédito. NULL = ativa. Arquivada sai da listagem E dos KPIs.';

-- Índice PARCIAL: a carteira de trabalho é sempre "não arquivadas", e o parcial deixa o índice do
-- tamanho da carteira ativa em vez do tamanho da tabela.
CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_ativas
    ON transacao_bancaria (data_movimento DESC)
    WHERE arquivada_em IS NULL;
