-- 0089_sispag_titulo_tipo.sql
-- Nome do TIPO do documento do título (`tpdDesNome` do com298/list), guardado ao lado do
-- `tpd_cod`. É o que diz "(PERMUTA)" — o `fin064` não devolve tipo nenhum, e medido em PRD em
-- 20/10/2026 o `tpd_cod` estava vazio em 1.277 de 1.277 títulos ativos e não pagos. A ingestão
-- passa a juntar o `com298/list` por (filial, documento) e gravar os dois campos; a situação de
-- pagamento (ADR-0075, motivo TIPO_PERMUTA) lê daqui.
--
-- NULL = tipo nunca lido (documento fora do com298/list, ou leitura que falhou); o UPSERT preserva
-- o último valor conhecido quando a rodada não o traz.
--
-- Aditiva, coluna nova nullable, sem backfill (a próxima ingestão preenche). Por isso não há
-- reverse em `rollbacks/`.

ALTER TABLE titulo_a_pagar
    ADD COLUMN IF NOT EXISTS tpd_des_nome TEXT;
