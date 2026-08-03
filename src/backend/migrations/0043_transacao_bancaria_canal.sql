-- 0043_transacao_bancaria_canal.sql
-- Frente IV, Módulo 1 — canal de origem do movimento bancário.
-- Adiciona `canal` a transacao_bancaria para distinguir a fonte da transação:
--   'xlsx_bradesco' = upload manual de extrato (.xlsx);  NULL = fin095 automático (legado).
-- O dedup por natural_key JÁ é namespaced por canal (`fin095:` vs `xlsx-bradesco:`), então esta
-- coluna é rótulo de exibição/auditoria, não chave. SQL idempotente.

ALTER TABLE transacao_bancaria
    ADD COLUMN IF NOT EXISTS canal TEXT;

CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_canal
    ON transacao_bancaria (canal);
