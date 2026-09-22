-- `pronto_para_remessa` passa a admitir NULL = "não sei".
--
-- A coluna nasceu NOT NULL DEFAULT FALSE, o que força a ingestão a escolher entre duas
-- afirmações quando o `fin064` não permite nenhuma: o read da carteira não enxerga boleto
-- (ADR-0040), não enxerga conta do favorecido (mora em `cmn025/ctcorr`) e mede 0% de
-- preenchimento nos campos `its*`. Com o NOT NULL, "não sei" virava FALSE, e FALSE acende o
-- aviso "falta cadastro?" na tela — em 100% da carteira, que é ruído, não informação.
--
-- NULL deixa a tela calada (o badge dispara em `= false`) e preserva a possibilidade de um
-- dia alguém escrever TRUE/FALSE de uma fonte que realmente saiba.
ALTER TABLE titulo_a_pagar ALTER COLUMN pronto_para_remessa DROP NOT NULL;
ALTER TABLE titulo_a_pagar ALTER COLUMN pronto_para_remessa DROP DEFAULT;

-- Os FALSE já gravados são todos "não sei" disfarçado: nenhuma linha jamais recebeu um FALSE
-- que significasse "conferi e falta cadastro" — até agora a expressão de origem era
-- constantemente TRUE (bug do `z.coerce.number()` sobre `null`), então um FALSE em disco só
-- pode ter vindo do DEFAULT. Normaliza para NULL.
UPDATE titulo_a_pagar SET pronto_para_remessa = NULL WHERE pronto_para_remessa = FALSE;
