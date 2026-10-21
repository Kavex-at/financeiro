-- Reverse da 0090 (boleto agrupado pago por bordero fin010, ADR-0077 / I21).
--
-- QUANDO: depois de voltar o backend para uma versao anterior ao boleto agrupado. Com o backend
-- novo no ar, remover estas tabelas/colunas quebra o lote, a remessa e a sugestao de boleto.
--
-- ANTES: confira no Conexos que nenhum bordero de grupo ficou em cadastro (o ledger e a unica
-- ligacao local entre o grupo e o borCod/borTimCad). Exporte:
--   \copy (SELECT * FROM sispag_grupo_boleto) TO 'grupo_boleto.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_grupo_boleto_titulo) TO 'grupo_boleto_titulo.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_grupo_boleto_execucao) TO 'grupo_boleto_execucao.csv' CSV HEADER
--   \copy (SELECT * FROM sispag_grupo_boleto_evento) TO 'grupo_boleto_evento.csv' CSV HEADER
--   \copy (SELECT lote_id, fil_cod, doc_cod, tit_cod, grupo_boleto_id FROM lote_pagamento_item
--           WHERE grupo_boleto_id IS NOT NULL) TO 'itens_grupo.csv' CSV HEADER
--
-- O QUE SE PERDE: os grupos, os titulos, o ledger do bordero, a trilha do grupo, o vinculo do item
-- ao grupo e os alertas `sispag-bordero-grupo-pendente`. Marcas de retencao com origem GRUPO_BOLETO
-- e execucoes de remessa na etapa `preparar_bordero` PERMANECEM: os CHECKs antigos voltam NOT VALID.
--
-- Depois de reverter, remova a linha de `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0090_sispag_grupo_boleto.sql';

DELETE FROM alerta WHERE tipo = 'sispag-bordero-grupo-pendente';
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-destino-alterado',
        'sispag-ajuste-centavos-parado'
    ));

ALTER TABLE titulo_bloqueio_duplicidade
    DROP CONSTRAINT IF EXISTS titulo_bloqueio_duplicidade_origem_check;
ALTER TABLE titulo_bloqueio_duplicidade
    ADD CONSTRAINT titulo_bloqueio_duplicidade_origem_check CHECK (
        origem IN (
            'DUPLICIDADE_TITULO', 'CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL',
            'VINCULO_CODIGO_BARRAS_FALHOU'
        )
    ) NOT VALID;

ALTER TABLE remessa_execucao DROP CONSTRAINT IF EXISTS remessa_execucao_etapa_check;
ALTER TABLE remessa_execucao
    ADD CONSTRAINT remessa_execucao_etapa_check CHECK (
        etapa IN ('criar_lote', 'importar', 'finalizar', 'gerar_remessa', 'concluido')
    ) NOT VALID;

DROP INDEX IF EXISTS idx_lote_pagamento_item_grupo_boleto;
ALTER TABLE lote_pagamento_item DROP COLUMN IF EXISTS grupo_boleto_id;

DROP TABLE IF EXISTS sispag_grupo_boleto_evento;
DROP FUNCTION IF EXISTS sispag_grupo_boleto_evento_so_inclusao();
DROP TABLE IF EXISTS sispag_grupo_boleto_execucao;
DROP TABLE IF EXISTS sispag_grupo_boleto_titulo;
DROP TABLE IF EXISTS sispag_grupo_boleto;
DROP FUNCTION IF EXISTS sispag_grupo_boleto_coerencia();
