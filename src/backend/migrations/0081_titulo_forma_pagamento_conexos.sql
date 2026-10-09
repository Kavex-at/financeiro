-- 0081_titulo_forma_pagamento_conexos.sql
-- Forma de pagamento do título NO CONEXOS (`titVldPagopor`, "Pago Por" / coluna "Situação" do
-- psq014). Independente de `tem_boleto`: este diz como o ERP pretende pagar o título (6 = BOLETO,
-- 2 = TEF, …); `tem_boleto` diz se o ERP casou um boleto DDA com ele. Um título BOLETO sem DDA
-- associado (vencimento do boleto ≠ do título) e um título TED marcado BOLETO no Conexos (a
-- pergunta FIN_041 de título próprio no import) eram ambos invisíveis no painel.
--
-- Quem grava é só a ingestão, a partir do grid de pendentes do fin015 que ela já lê para o DDA.
-- NULL = nunca lido. O UPSERT preserva o último valor quando a rodada não vê o título.
-- Domínio documentado em docs/conexos-api/070-com3.json (FinTituloFin): 1..10.
--
-- Aditiva, coluna nova nullable, sem backfill. Por isso não há reverse em `rollbacks/`.

ALTER TABLE titulo_a_pagar
    ADD COLUMN IF NOT EXISTS forma_pagamento_conexos SMALLINT
        CHECK (forma_pagamento_conexos BETWEEN 1 AND 10);
