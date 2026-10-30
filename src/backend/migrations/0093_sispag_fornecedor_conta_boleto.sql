-- 0093_sispag_fornecedor_conta_boleto.sql
-- ADR-0081 — fornecedor do boleto DDA aprendido da conta do beneficiário nas barras.
--
-- O `fin124` não traz o beneficiário; a conta de destino (agência/conta, código do beneficiário
-- ou convênio, conforme o banco) vem nas barras e identifica o fornecedor. Esta tabela guarda o
-- mapeamento `chave da conta → pes_cod + credor`, reconstruído ao fim de cada sincronização do
-- pool DDA (`AprendizadoFornecedorBoletoService`) a partir de três fontes, da mais para a menos
-- confiável: `VINCULADO` (o Conexos ligou o boleto a um título), `CONFIRMADO` (a analista
-- confirmou o par) e `INFERIDO` (boleto com um único título ativo de mesmo valor e mesmo dia).
--
-- Chave com 2+ fornecedores distintos na origem mais confiável é `ambiguo`: fica sem `pes_cod` e
-- a aba não a nomeia. Ler a aba NÃO escreve aqui.
--
-- `chave` identifica uma conta bancária: nunca sai por API (a aba só recebe o nome). Sem barras,
-- sem linha digitável. Aditiva e idempotente. Reverse (só estrutura) em
-- `rollbacks/0093_sispag_fornecedor_conta_boleto.rollback.sql`.

CREATE TABLE IF NOT EXISTS sispag_fornecedor_conta_boleto (
    chave                 TEXT PRIMARY KEY,
    pes_cod               TEXT NULL,
    credor                TEXT NULL,
    origem                TEXT NOT NULL,
    ambiguo               BOOLEAN NOT NULL DEFAULT FALSE,
    evidencias            INTEGER NOT NULL,
    ultima_evidencia_em   TIMESTAMPTZ NOT NULL,
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sispag_fornecedor_conta_boleto_origem_check CHECK (
        origem IN ('VINCULADO', 'CONFIRMADO', 'INFERIDO')
    ),
    CONSTRAINT sispag_fornecedor_conta_boleto_ambiguo_check CHECK (
        (ambiguo AND pes_cod IS NULL AND credor IS NULL)
        OR (NOT ambiguo AND pes_cod IS NOT NULL AND length(btrim(pes_cod)) > 0)
    ),
    CONSTRAINT sispag_fornecedor_conta_boleto_evidencias_check CHECK (evidencias > 0)
);
