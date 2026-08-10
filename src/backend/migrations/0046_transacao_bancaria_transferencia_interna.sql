-- 0045_transacao_bancaria_transferencia_interna.sql
-- Frente IV / Módulo 1 — separa TRANSFERÊNCIA ENTRE CONTAS DA PRÓPRIA CASA do
-- recebimento de cliente, e guarda a descrição da conta financeira para a tela.
--
-- Motivação (report do analista, 2026-08-10): créditos de categoria 209
-- (TRANSFERÊNCIA INTERBANCÁRIA — DOC/TED/PIX) cujo REMETENTE é a própria Columbia
-- apareciam na carteira como "recebido". A perna de DÉBITO não existe na base — a
-- ingestão só puxa `exiVldTipo = 2` — então o analista via metade da operação e lia
-- como recebimento algo que ele mesmo pagou de outra conta.
--
-- ⚠️ A categoria 209 NÃO é ruído por si só: PIX/TED de cliente cai nela (medidos na
-- conta 212 em ago/2026). O discriminador é o remetente, não a categoria — por isso
-- uma coluna própria, e não uma entrada em CATEGORIAS_TESOURARIA.
--
-- SQL idempotente.

ALTER TABLE transacao_bancaria
    ADD COLUMN IF NOT EXISTS transferencia_interna BOOLEAN NOT NULL DEFAULT FALSE;

-- `gerDes` do `fin133` ("BANCO BRASIL - AG. 1913 CONTA 105773-1"). Desde o ADR-0032
-- a transação é corporativa e o painel funde ~20 contas numa lista só; sem isto o
-- analista não tem como bater uma linha contra o extrato de onde ela veio.
ALTER TABLE transacao_bancaria
    ADD COLUMN IF NOT EXISTS conta_descricao TEXT;

-- ⚠️ SEM BACKFILL SQL — deliberado.
--
-- A primeira versão desta migration trazia um `UPDATE ... WHERE raw_payload ->>
-- 'exiEspNrdocto' ~* 'REM\s*:.*COLUMBIA\s+TRADING'`. Foi removido: era uma SEGUNDA
-- implementação da regra, em outra linguagem, e já divergia da primeira —
-- `ehTransferenciaInterna` normaliza acento (NFD) e é dirigida por
-- `RECEBIMENTO_TITULARES_INTERNOS`, enquanto o SQL só fazia `~*` sobre um literal do
-- tenant. Duas fontes da mesma verdade classificando subconjuntos diferentes, com a
-- do SQL rodando UMA vez e nunca mais.
--
-- As linhas já ingeridas se reclassificam sozinhas: o `upsertMany` da ingestão faz
-- `transferencia_interna = EXCLUDED.transferencia_interna`, e o cron horário relê a
-- janela inteira. Linhas ainda `importada` convergem na próxima run; linhas que o
-- analista já trabalhou NÃO são remexidas — e é isso que se quer, porque o que ele
-- decidiu sobre elas é fato histórico, não algo a recalcular com a regra de hoje.

-- O painel filtra por status + tipo + categoria e agora também por esta coluna; o
-- índice parcial mantém a varredura no subconjunto que a tela realmente lê.
CREATE INDEX IF NOT EXISTS idx_transacao_bancaria_carteira
    ON transacao_bancaria (status, tipo)
    WHERE transferencia_interna = FALSE;
