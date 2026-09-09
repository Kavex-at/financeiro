-- 0056_permuta_execucao_parcial.sql
-- ADR-0044 — a baixa parcial vira ESTADO TERMINAL em vez de erro (I-Recon-6/7, I-Write-8b).
--
-- Até aqui `executarBaixa` marcava `settled` incondicionalmente ao fim do laço de títulos: se o
-- alocado não coubesse nos títulos disponíveis, o resíduo sumia e a trilha afirmava "o alocado foi
-- integralmente baixado" — uma afirmação falsa no livro-razão. `parcial` é o registro fiel de uma
-- escrita que aconteceu pela metade: não é `settled` degradado nem `error` suavizado.
--
-- ORDEM DE DEPLOY: esta migration precisa estar aplicada ANTES de qualquer código gravar 'parcial'.
-- O CHECK antigo rejeita o INSERT em RUNTIME (não no deploy), e a falha apareceria DEPOIS de baixas
-- já POSTadas no ERP — o pior lugar possível para um erro.
--
-- O CHECK de 0015 é INLINE (sem nome explícito) ⇒ o nome gerado pelo Postgres é
-- `<tabela>_<coluna>_check` = `permuta_alocacao_execucao_status_check`. Mesmo idioma de
-- 0005/0012/0027/0049. Errar o nome deixaria o CHECK antigo de pé e o INSERT de 'parcial' falharia.
-- SQL idempotente: rodar duas vezes é no-op na segunda.

ALTER TABLE permuta_alocacao_execucao
    DROP CONSTRAINT IF EXISTS permuta_alocacao_execucao_status_check;

ALTER TABLE permuta_alocacao_execucao
    ADD CONSTRAINT permuta_alocacao_execucao_status_check
        CHECK (status IN ('pending', 'reconciling', 'settled', 'error', 'parcial'));

-- Resíduo NÃO baixado, em MOEDA NEGOCIADA (a mesma grandeza de `permuta_alocacao.valor_alocado`),
-- não em BRL: é o que falta re-alocar. Só é preenchido em linhas `parcial`. NULL em todo o resto.
ALTER TABLE permuta_alocacao_execucao
    ADD COLUMN IF NOT EXISTS valor_residual_usd NUMERIC;

COMMENT ON COLUMN permuta_alocacao_execucao.valor_residual_usd IS
    'ADR-0044 — resíduo não baixado do valor alocado, em moeda negociada. Só em status=parcial.';
