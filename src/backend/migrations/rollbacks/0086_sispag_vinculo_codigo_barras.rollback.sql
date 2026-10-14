-- Reverse da 0086 (vinculo do codigo de barras ao item do lote, ADR-0071 / I17).
--
-- QUANDO: depois de voltar o backend para uma versao anterior ao vinculo. Com o backend novo no
-- ar, remover estas colunas quebra a leitura do item do lote.
--
-- O QUE SE PERDE: o vinculo registrado em `lote_pagamento_item` (origem, decisao, mascara, quando,
-- lote nativo) e as colunas `lote_id`/`decisao_id` da trilha. Os eventos VINCULO_* da trilha
-- (so-inclusao, o trigger da 0084 recusa DELETE) PERMANECEM: por isso os CHECKs antigos voltam
-- como NOT VALID — a restricao vale para linhas novas e nao reprova as que ja existem. Exporte
-- antes:
--   \copy (SELECT lote_id, fil_cod, doc_cod, tit_cod, vinculo_origem, vinculo_decisao_id,
--                 vinculo_codigo_mascarado, vinculo_aplicado_em, vinculo_flp_cod
--            FROM lote_pagamento_item WHERE vinculo_origem IS NOT NULL)
--          TO 'vinculos_codbar.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_sugestao_boleto_evento WHERE tipo LIKE 'VINCULO_%')
--          TO 'eventos_vinculo.csv' CSV HEADER
--
-- Marcas de retencao com origem VINCULO_CODIGO_BARRAS_FALHOU continuam bloqueando o titulo (a
-- linha e o estado ATIVO ficam); o CHECK antigo volta NOT VALID para nao as reprovar.
--
-- Depois de reverter, remova a linha de `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0086_sispag_vinculo_codigo_barras.sql';

DROP INDEX IF EXISTS ux_sispag_sugestao_boleto_evento_vinculo;

ALTER TABLE sispag_sugestao_boleto_evento
    DROP CONSTRAINT IF EXISTS sispag_sugestao_boleto_evento_tipo_check;
ALTER TABLE sispag_sugestao_boleto_evento
    ADD CONSTRAINT sispag_sugestao_boleto_evento_tipo_check CHECK (tipo IN (
        'PAR_CONFIRMADO', 'DECISAO_CONFIRMADA', 'DECISAO_REJEITADA', 'DECISAO_ANULADA',
        'PAR_REVOGADO', 'LINHA_COPIADA'
    )) NOT VALID;

ALTER TABLE sispag_sugestao_boleto_evento
    DROP COLUMN IF EXISTS decisao_id,
    DROP COLUMN IF EXISTS lote_id;

ALTER TABLE titulo_bloqueio_duplicidade
    DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_origem_check;
ALTER TABLE titulo_bloqueio_duplicidade
    ADD CONSTRAINT titulo_bloqueio_duplicidade_origem_check CHECK (
        origem IN ('DUPLICIDADE_TITULO', 'CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL')
    ) NOT VALID;

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_vinculo_codigo_mascarado_check,
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_vinculo_tudo_ou_nada_check,
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_vinculo_origem_check;

ALTER TABLE lote_pagamento_item
    DROP COLUMN IF EXISTS vinculo_flp_cod,
    DROP COLUMN IF EXISTS vinculo_aplicado_em,
    DROP COLUMN IF EXISTS vinculo_codigo_mascarado,
    DROP COLUMN IF EXISTS vinculo_decisao_id,
    DROP COLUMN IF EXISTS vinculo_origem;
