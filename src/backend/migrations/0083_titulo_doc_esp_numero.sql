-- 0083_titulo_doc_esp_numero.sql
-- Número do documento do FORNECEDOR (`docEspNumero` do fin064: o nº da NF/fatura que o credor
-- emitiu), guardado ao lado do título. `titEspNumero` é o mesmo valor com a sequência do título
-- colada ("3501" + "1" = "35011"), por isso não é o que se guarda.
--
-- Para quê: confirmar o casamento boleto DDA × título. Em 13/10/2026, 34 de 128 pares já
-- resolvidos pelo ERP tinham `ditEspNumero` (fin124) igual ao `docEspNumero`, e é propriedade do
-- CREDOR (16 de 35 casam sempre, 18 nunca — quem põe o nosso-número do banco no campo não casa).
-- Sem a coluna, testar isso exigia uma leitura ao vivo do fin064 (e um login do robô).
--
-- Quem grava é só a ingestão. NULL = nunca lido; o UPSERT preserva o último valor quando a
-- rodada não traz o campo.
--
-- Aditiva, coluna nova nullable, sem backfill. Por isso não há reverse em `rollbacks/`.

ALTER TABLE titulo_a_pagar
    ADD COLUMN IF NOT EXISTS doc_esp_numero TEXT;
