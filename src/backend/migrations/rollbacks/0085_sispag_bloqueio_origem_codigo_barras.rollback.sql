-- Reverse da 0085 (origem + campos de retencao do BloqueioDuplicidade, ADR-0069 emenda 1).
--
-- QUANDO: depois de voltar o backend para uma versao anterior a retirada automatica por codigo de
-- barras repetido. Com o backend novo no ar, remover estas colunas quebra a leitura das marcas.
--
-- O QUE SE PERDE: a origem e o codigo mascarado/titulo mantido das marcas CODIGO_BARRAS_*. Os
-- titulos retidos CONTINUAM bloqueados (a linha e o estado ATIVO ficam), mas passam a parecer
-- bloqueio por duplicidade de titulo. Exporte antes:
--   \copy (SELECT id, fil_cod, doc_cod, tit_cod, origem, titulo_mantido_fil_cod,
--                 titulo_mantido_doc_cod, titulo_mantido_tit_cod, codigo_mascarado
--            FROM titulo_bloqueio_duplicidade WHERE origem <> 'DUPLICIDADE_TITULO')
--          TO 'bloqueios_codbar.csv' CSV HEADER
--
-- Nenhum dado pre-existente e alterado pela 0085. Depois de reverter, remova a linha de
-- `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0085_sispag_bloqueio_origem_codigo_barras.sql';

ALTER TABLE titulo_bloqueio_duplicidade
    DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_titulo_mantido_check,
    DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_origem_campos_check,
    DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_codigo_mascarado_check,
    DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_origem_check;

ALTER TABLE titulo_bloqueio_duplicidade
    DROP COLUMN IF EXISTS codigo_mascarado,
    DROP COLUMN IF EXISTS titulo_mantido_tit_cod,
    DROP COLUMN IF EXISTS titulo_mantido_doc_cod,
    DROP COLUMN IF EXISTS titulo_mantido_fil_cod,
    DROP COLUMN IF EXISTS origem;
