-- 0092_boleto_dda_conferencia.sql
-- Quando conversamos com o `fin124` com sucesso pela última vez (I-DDA6/I-DDA7, v0.53.0).
--
-- `boleto_dda_arquivo.sincronizado_em` só anda quando um arquivo é GRAVADO. Uma conferência que listou
-- os arquivos e não achou nada novo (o caso comum) não deixava rastro, e o aviso "DDA parado" contava
-- do último arquivo gravado: aparecia na primeira abertura do dia com o pipeline saudável. Esta linha
-- é gravada a cada listagem bem-sucedida (conferência rápida ao abrir a tela e passada completa).
--
-- Aditiva, tabela nova de UMA linha (id = 1), sem backfill: ausente, a tela cai no `sincronizado_em`.
-- Por isso não há reverse em `rollbacks/`.

CREATE TABLE IF NOT EXISTS boleto_dda_conferencia (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    conferido_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Quem conferiu: `abertura:<usuário>`, `ingestao:cron`, `manual:<usuário>`…
    origem              TEXT,
    -- Arquivos lidos com itens / só cabeçalho atualizado nesta conferência.
    arquivos_lidos      INTEGER NOT NULL DEFAULT 0,
    arquivos_cabecalho  INTEGER NOT NULL DEFAULT 0
);
