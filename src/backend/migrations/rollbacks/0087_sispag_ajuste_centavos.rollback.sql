-- Reverse da 0087 (ajuste de centavos do titulo por renegociacao no fin070, ADR-0073 / I18).
--
-- QUANDO: depois de voltar o backend para uma versao anterior ao ajuste. Com o backend novo no
-- ar, remover estas colunas/tabela quebra a sugestao de boleto e a remessa.
--
-- O QUE SE PERDE: o ledger `sispag_ajuste_centavos_execucao` (frnCod, titulo novo, etapa,
-- identidade Conexos), os alertas `sispag-ajuste-centavos-parado` e as colunas
-- `tipo_anulacao`/`origem_decisao_id`/`transferida_por` da decisao. Os eventos AJUSTE_*/TITULO_RENEGOCIADO/DECISAO_TRANSFERIDA e ITEM_TITULO_RENEGOCIADO
-- (trilhas so-inclusao) PERMANECEM: por isso os CHECKs antigos voltam como NOT VALID. Decisoes
-- anuladas pelo sistema (TITULO_RENEGOCIADO) tambem permanecem: o anulador_check antigo volta
-- NOT VALID. Exporte antes:
--   \copy (SELECT * FROM sispag_ajuste_centavos_execucao) TO 'ajuste_centavos.csv' CSV HEADER
--   \copy (SELECT id, tipo_anulacao, origem_decisao_id, transferida_por
--            FROM sispag_decisao_sugestao_boleto
--           WHERE tipo_anulacao IS NOT NULL OR origem_decisao_id IS NOT NULL)
--          TO 'decisoes_transferidas.csv' CSV HEADER
--
-- Depois de reverter, remova a linha de `schema_migrations` se for reaplicar:
--   DELETE FROM schema_migrations WHERE name = '0087_sispag_ajuste_centavos.sql';

DROP INDEX IF EXISTS ux_sispag_sugestao_boleto_evento_ajuste_simulado;

-- Alertas do tipo novo saem (o alerta nao e trilha so-inclusao); o CHECK volta ao da 0080.
DELETE FROM alerta WHERE tipo = 'sispag-ajuste-centavos-parado';
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta
    ADD CONSTRAINT alerta_tipo_check
    CHECK (tipo IN (
        'job-falhou', 'job-parcial', 'job-parado', 'config-ausente',
        'sispag-lote-retornado', 'sispag-baixa-divergente', 'sispag-destino-alterado'
    ));

ALTER TABLE sispag_verificacao_evento
    DROP CONSTRAINT IF EXISTS sispag_verificacao_evento_evento_check;
ALTER TABLE sispag_verificacao_evento
    ADD CONSTRAINT sispag_verificacao_evento_evento_check CHECK (evento IN (
        'ALERTA_CRIADA', 'ALERTA_JUSTIFICADA', 'ALERTA_RETIRADA', 'ALERTA_OBSOLETA',
        'ALERTA_DESCARTADA', 'BLOQUEIO_CRIADO', 'BLOQUEIO_ENCERRADO', 'BLOQUEIO_DESFEITO',
        'PENDENCIA_ABERTA', 'PENDENCIA_ORIGEM_ACRESCENTADA', 'PENDENCIA_RESOLVIDA',
        'ITEM_REMOVIDO_SISTEMA', 'LOTE_CONFERIDO', 'LOTE_DEVOLVIDO', 'CONFERENCIA_LIMPA'
    )) NOT VALID;

ALTER TABLE sispag_sugestao_boleto_evento
    DROP CONSTRAINT IF EXISTS sispag_sugestao_boleto_evento_tipo_check;
ALTER TABLE sispag_sugestao_boleto_evento
    ADD CONSTRAINT sispag_sugestao_boleto_evento_tipo_check CHECK (tipo IN (
        'PAR_CONFIRMADO', 'DECISAO_CONFIRMADA', 'DECISAO_REJEITADA', 'DECISAO_ANULADA',
        'PAR_REVOGADO', 'LINHA_COPIADA',
        'VINCULO_APLICADO', 'VINCULO_SIMULADO', 'VINCULO_FALHOU'
    )) NOT VALID;

DROP TABLE IF EXISTS sispag_ajuste_centavos_execucao;

ALTER TABLE sispag_decisao_sugestao_boleto
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_anulador_check;
ALTER TABLE sispag_decisao_sugestao_boleto
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_transferencia_check;
ALTER TABLE sispag_decisao_sugestao_boleto
    DROP CONSTRAINT IF EXISTS sispag_decisao_sugestao_boleto_tipo_anulacao_check;
ALTER TABLE sispag_decisao_sugestao_boleto
    DROP COLUMN IF EXISTS transferida_por,
    DROP COLUMN IF EXISTS origem_decisao_id,
    DROP COLUMN IF EXISTS tipo_anulacao;
ALTER TABLE sispag_decisao_sugestao_boleto
    ADD CONSTRAINT sispag_decisao_sugestao_boleto_anulador_check CHECK (
        anulada_por IS NULL OR lower(btrim(anulada_por)) NOT IN ('sistema', 'unknown')
    ) NOT VALID;
