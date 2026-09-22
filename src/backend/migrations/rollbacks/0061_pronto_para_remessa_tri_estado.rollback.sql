-- Volta `pronto_para_remessa` a NOT NULL DEFAULT FALSE.
-- Os NULL viram FALSE — o estado que a coluna tinha antes do tri-estado.
UPDATE titulo_a_pagar SET pronto_para_remessa = FALSE WHERE pronto_para_remessa IS NULL;
ALTER TABLE titulo_a_pagar ALTER COLUMN pronto_para_remessa SET DEFAULT FALSE;
ALTER TABLE titulo_a_pagar ALTER COLUMN pronto_para_remessa SET NOT NULL;
