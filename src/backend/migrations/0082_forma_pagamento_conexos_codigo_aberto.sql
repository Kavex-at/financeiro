-- 0082_forma_pagamento_conexos_codigo_aberto.sql
-- A 0081 limitou `titulo_a_pagar.forma_pagamento_conexos` a 1..10 — os códigos que o Conexos
-- documenta para `titVldPagopor` (070-com3 FinTituloFin). Com o limite, um código novo do ERP era
-- descartado em silêncio: gravava NULL e a tela dizia "sem forma no Conexos" para um título que
-- tem forma. Agora qualquer inteiro positivo é guardado; a ingestão avisa (WARN com código e um
-- título de exemplo) para alguém abrir o título no psq014 e ler o rótulo, e a tela mostra
-- "código N" até o código entrar na tabela de rótulos.
--
-- Só troca a CHECK; nenhuma linha muda. O nome é o que o Postgres gerou para a CHECK inline da
-- 0081 (conferido em produção em 2026-10-13). Sem reverse em `rollbacks/`: não há UPDATE, e voltar
-- a 1..10 falharia de qualquer jeito se um código novo já estivesse gravado.

ALTER TABLE titulo_a_pagar
    DROP CONSTRAINT IF EXISTS titulo_a_pagar_forma_pagamento_conexos_check;

ALTER TABLE titulo_a_pagar
    ADD CONSTRAINT titulo_a_pagar_forma_pagamento_conexos_check
        CHECK (forma_pagamento_conexos > 0);
