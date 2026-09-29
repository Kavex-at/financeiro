-- Reverse da 0069 (situação do item do lote SISPAG + tipos de alerta, ADR-0055).
--
-- QUANDO: só depois de voltar o backend para uma versão anterior à sincronização de lotes. Com o
-- backend novo no ar, derrubar estas colunas quebra a leitura de todo lote (500).
--
-- O QUE SE PERDE: a situação derivada de cada item, a trilha do pagamento observado (data, valor,
-- origem, fonte) e as divergências marcadas. A situação é re-derivável por uma nova sincronização
-- (ela lê o ERP); as divergências NÃO são — exporte antes se houver alguma aberta:
--   \copy (SELECT * FROM lote_pagamento_item WHERE divergencia) TO 'divergencias.csv' CSV HEADER
--
-- Os alertas dos dois tipos novos são APAGADOS: o CHECK antigo não os aceita. Exporte antes se
-- importarem:
--   \copy (SELECT * FROM alerta WHERE tipo LIKE 'sispag-%') TO 'alertas-sispag.csv' CSV HEADER
--
-- Depois do reverse, para reaplicar a 0069 mais tarde:
--   DELETE FROM schema_migrations WHERE name = '0069_sispag_item_situacao_sincronizacao.sql';

BEGIN;

DELETE FROM alerta WHERE tipo IN ('sispag-lote-retornado', 'sispag-baixa-divergente');
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN ('job-falhou', 'job-parcial', 'job-parado', 'config-ausente'));

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_situacao_check,
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_origem_baixa_check,
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_baixa_fonte_check,
    DROP COLUMN IF EXISTS situacao,
    DROP COLUMN IF EXISTS pago_em,
    DROP COLUMN IF EXISTS pago_observado_em,
    DROP COLUMN IF EXISTS valor_pago,
    DROP COLUMN IF EXISTS origem_baixa,
    DROP COLUMN IF EXISTS baixa_fonte,
    DROP COLUMN IF EXISTS divergencia,
    DROP COLUMN IF EXISTS divergencia_detalhe,
    DROP COLUMN IF EXISTS sincronizado_em;

COMMIT;
