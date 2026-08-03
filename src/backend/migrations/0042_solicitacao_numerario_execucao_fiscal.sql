-- 0042_solicitacao_numerario_execucao_fiscal.sql
-- Frente IV (Recebimentos) — Numerário REAL payment-driven. Estende a trilha write-ahead da SN (0041)
-- para o fluxo COMPLETO por alocação (pagamento × processo): SN (com299) → recebimento fin014 →
-- nota de débito (com297) → leg FISCAL (com300 tipo=6 → com131 observações → homologar → poll SEFAZ).
-- Cada etapa grava o handle correspondente ASSIM QUE confirmada, ANTES do próximo POST — se a
-- sequência morrer no meio, a trilha aponta o documento órfão e a re-execução RETOMA (não recria).
-- Espelha `solicitacao_numerario` (permutas, 0032/0032b): mesmos handles (fin014_bor_cod/nd_doc_cod/
-- etapa) + `txn_id`/`valor` (a alocação carrega a transação bancária e o valor alocado) e os flags
-- fiscais `revisao_humana` (homologou com validações pendentes — com194) / `nde_autorizado` (SEFAZ
-- autorizou no poll). SQL 100% idempotente. NÃO aplicar à Supabase compartilhada sem OK do Yuri.
-- Ver ontology/integrations/conexos-com299-gerdoc.md + _inbox/recebimentos-numerario-real-fiscal-spec.md.
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS txn_id TEXT;
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS valor NUMERIC(18,2);
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS fin014_bor_cod BIGINT;
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS nd_doc_cod BIGINT;
-- Última etapa alcançada: sn | sn-finalizar | fin014 | fin014-done | nota-debito | fiscal-done |
-- obs-done | homologado | concluido | error.
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS etapa TEXT;
-- TRUE quando a homologação voltou com validações pendentes (docVldComvalidacoes=2 → com194): a NDe
-- foi emitida COM aviso — precisa de revisão humana (não é falha, não é sucesso limpo).
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS revisao_humana BOOLEAN NOT NULL DEFAULT FALSE;
-- TRUE quando o poll pós-homologação leu `vldAutorizado != 0` (SEFAZ autorizou). Timeout ≠ erro:
-- deixa a etapa em 'homologado' e este flag FALSE até a autorização chegar.
ALTER TABLE solicitacao_numerario_execucao ADD COLUMN IF NOT EXISTS nde_autorizado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_solicitacao_numerario_execucao_txn ON solicitacao_numerario_execucao (txn_id);
