-- Reverse da 0092 (fornecedor do boleto DDA aprendido da conta das barras, ADR-0081).
--
-- QUANDO: depois de voltar o backend para uma versao anterior ao ADR-0081. Com o backend novo no
-- ar, remover a tabela faz o aprendizado (fim da sincronizacao DDA) falhar com WARN e a aba seguir
-- sem a coluna "Fornecedor".
--
-- O QUE SE PERDE: so o mapeamento derivado. Ele e reconstruido do zero a cada sincronizacao a
-- partir de boleto_dda, titulo_a_pagar e sispag_decisao_sugestao_boleto; nada aqui e fonte.
--
-- Depois de reverter, remova a linha de `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0092_sispag_fornecedor_conta_boleto.sql';

DROP TABLE IF EXISTS sispag_fornecedor_conta_boleto;
