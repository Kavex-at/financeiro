-- Reverse da 0084 (sugestao de boleto DDA, ADR-0068). SO ESTRUTURA.
--
-- QUANDO: depois de voltar o backend para uma versao anterior a v0.66.x. Com o backend novo no ar,
-- apagar estas tabelas derruba a sugestao e a trilha de copias.
--
-- O QUE SE PERDE: os pares confirmados, as decisoes por titulo e a trilha (incluindo LINHA_COPIADA).
-- Exporte antes:
--   \copy (SELECT * FROM sispag_confirmacao_emissor_boleto) TO 'pares.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_decisao_sugestao_boleto) TO 'decisoes.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_sugestao_boleto_evento) TO 'eventos.csv' CSV HEADER
--
-- Nenhum dado pre-existente e alterado pela 0084, entao nao ha nada a restaurar. Depois de reverter,
-- remova a linha de `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0084_sispag_sugestao_boleto.sql';

DROP TABLE IF EXISTS sispag_sugestao_boleto_evento;
DROP FUNCTION IF EXISTS sispag_sugestao_boleto_evento_so_inclusao();
DROP TABLE IF EXISTS sispag_decisao_sugestao_boleto;
DROP TABLE IF EXISTS sispag_confirmacao_emissor_boleto;
