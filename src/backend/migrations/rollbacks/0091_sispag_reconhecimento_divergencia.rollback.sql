-- Reverse da 0091 (reconhecimento tipado da divergência de data e caminho do vínculo, ADR-0078).
--
-- QUANDO: depois de voltar o backend para uma versão anterior à ADR-0078. Com o backend novo no
-- ar, remover estas colunas quebra a leitura da decisão e do item do lote.
--
-- O QUE SE PERDE: o reconhecimento gravado na decisão (tipo, motivo, Δ e valor vistos, quem e
-- quando) e o caminho/Δdias/decisão do vínculo no item. O reconhecimento também viaja no `detalhe`
-- do evento `DECISAO_CONFIRMADA` da trilha só-inclusão, que PERMANECE. Exporte antes:
--   \copy (SELECT id, fil_cod, doc_cod, tit_cod, reconhecimento_tipo, reconhecimento_motivo,
--                 reconhecimento_delta_dias_visto, reconhecimento_valor_boleto_visto_centavos,
--                 reconhecido_por, reconhecido_em
--            FROM sispag_decisao_sugestao_boleto WHERE reconhecimento_tipo IS NOT NULL)
--          TO 'reconhecimentos.csv' CSV HEADER
--   \copy (SELECT lote_id, fil_cod, doc_cod, tit_cod, vinculo_caminho, vinculo_delta_dias,
--                 vinculo_reconhecimento_id
--            FROM lote_pagamento_item WHERE vinculo_caminho IS NOT NULL)
--          TO 'vinculos_caminho.csv' CSV HEADER
--
-- Atenção: item vinculado por `DATA_DIVERGENTE` mantém o código de barras já gravado no ERP; o
-- reverse só remove o registro local do caminho. Depois de reverter, remova a linha de
-- `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0091_sispag_reconhecimento_divergencia.sql';

ALTER TABLE lote_pagamento_item
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_vinculo_caminho_coerente_check,
    DROP CONSTRAINT IF EXISTS lote_pagamento_item_vinculo_caminho_check;

ALTER TABLE lote_pagamento_item
    DROP COLUMN IF EXISTS vinculo_reconhecimento_id,
    DROP COLUMN IF EXISTS vinculo_delta_dias,
    DROP COLUMN IF EXISTS vinculo_caminho;

ALTER TABLE sispag_decisao_sugestao_boleto
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_reconhecimento_valor_check,
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_reconhecedor_check,
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_reconhecimento_motivo_check,
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_reconhecimento_tudo_ou_nada_check,
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_reconhecimento_tipo_check;

ALTER TABLE sispag_decisao_sugestao_boleto
    DROP COLUMN IF EXISTS reconhecido_em,
    DROP COLUMN IF EXISTS reconhecido_por,
    DROP COLUMN IF EXISTS reconhecimento_valor_boleto_visto_centavos,
    DROP COLUMN IF EXISTS reconhecimento_delta_dias_visto,
    DROP COLUMN IF EXISTS reconhecimento_motivo,
    DROP COLUMN IF EXISTS reconhecimento_tipo;
