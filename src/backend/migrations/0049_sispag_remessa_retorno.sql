-- 0049_sispag_remessa_retorno.sql
-- Escopo II (SISPAG) — Fatia 3: REMESSA (.REM) e CONCILIAÇÃO do RETORNO (.RET).
--
-- Até aqui o `lote_pagamento` era 100% LOCAL (ADR-0015, I1: não tocava o ERP). Esta migration
-- abre a ponte com o lote NATIVO do Conexos (fin015) e guarda o resultado da conciliação.
--
-- Por que guardar as chaves nativas do nosso lado: o ERP NÃO expõe a rastreabilidade
-- lote → borderô. Medido em produção (2026-08-20): nos 3 lotes da filial 2 com retorno
-- processado, TODOS os 60 itens têm `borCod` nulo no `finItemSispag`, e o `vldHasRemessaPgto`
-- do borderô vem 0 mesmo para baixa originada de remessa. O vínculo só existe na linha de
-- detalhe do retorno — e some se ninguém copiar. Ver ontology/_inbox/sispag-fin052-retorno-provado-hml.md.
--
-- SQL idempotente. NÃO aplicar à Supabase compartilhada sem OK.

-- ─────────────────────────────────────────── lote: ponte com o lote nativo fin015
ALTER TABLE lote_pagamento
    -- Chaves do lote NATIVO. `native_flp_cod` é atribuído pelo ERP no POST /fin015.
    -- ⚠️ O ERP RECICLA flpCod de lotes que deixaram de existir — o número sozinho não
    -- identifica nada de forma estável. Sempre usar a chave composta (fil, bnc, flp).
    ADD COLUMN IF NOT EXISTS native_fil_cod   INTEGER,
    ADD COLUMN IF NOT EXISTS native_bnc_cod   INTEGER,
    ADD COLUMN IF NOT EXISTS native_flp_cod   INTEGER,
    -- Arquivo de remessa gerado (gerArquivosBancos).
    ADD COLUMN IF NOT EXISTS native_gab_cod   INTEGER,
    ADD COLUMN IF NOT EXISTS remessa_arquivo  TEXT,
    ADD COLUMN IF NOT EXISTS remessa_num      INTEGER,
    ADD COLUMN IF NOT EXISTS remessa_gerada_em TIMESTAMPTZ,
    -- Conta corrente pagadora (fin005). NUNCA fixa: o mesmo ccoCod aponta para contas
    -- DIFERENTES em cada filial — fixar `1` levou um lote da filial 2 a uma conta Banestes.
    ADD COLUMN IF NOT EXISTS cco_cod          INTEGER,
    -- Conta financeira (plano gerencial, fin004) da conta pagadora — para conciliação contábil.
    ADD COLUMN IF NOT EXISTS ger_num          INTEGER;

-- Novos estados. Fluxo completo:
--   RASCUNHO → FINALIZADO → REMESSA_GERADA → RETORNADO → BAIXADO
--   (CANCELADO a partir de RASCUNHO/FINALIZADO)
-- REMESSA_GERADA (e não "ENVIADO") de propósito: o Conexos NÃO transmite remessa de
-- pagamento. Gerar o arquivo não é enviá-lo; o transporte ao banco é externo e manual.
ALTER TABLE lote_pagamento DROP CONSTRAINT IF EXISTS lote_pagamento_status_check;
ALTER TABLE lote_pagamento
    ADD CONSTRAINT lote_pagamento_status_check
    CHECK (status IN ('RASCUNHO', 'FINALIZADO', 'REMESSA_GERADA', 'RETORNADO', 'BAIXADO', 'CANCELADO'));

-- ─────────────────────────────────────────── item: chave nativa + resultado do retorno
ALTER TABLE lote_pagamento_item
    -- Sequencial do item no lote nativo. É a 4ª parte da chave que o ERP grava no campo
    -- "uso da empresa" do segmento A (pos. 74-93) e lê de volta no .RET.
    ADD COLUMN IF NOT EXISTS native_its_cod_seq INTEGER,
    -- ── resultado da conciliação (vem de fin052/arquivosRetornoDetalhe) ──
    -- Código do evento bancário (`fbeEspCod`). Itaú: '00' = PAGAMENTO EFETUADO.
    ADD COLUMN IF NOT EXISTS retorno_evento     TEXT,
    ADD COLUMN IF NOT EXISTS retorno_descricao  TEXT,
    -- TRUE quando o evento é de rejeição (`fbeVldTpret = 2` em FIN_BANCOS_ERROS).
    ADD COLUMN IF NOT EXISTS rejeitado          BOOLEAN NOT NULL DEFAULT FALSE,
    -- Borderô e baixa gravados no fin010 — o elo que o ERP não guarda em lugar nenhum
    -- consultável depois. Sem copiar aqui, a rastreabilidade se perde.
    ADD COLUMN IF NOT EXISTS bor_cod            INTEGER,
    ADD COLUMN IF NOT EXISTS bxa_cod_seq        INTEGER,
    ADD COLUMN IF NOT EXISTS conciliado_em      TIMESTAMPTZ;

-- ─────────────────────────────────────────── ledger write-ahead da REMESSA
-- Espelha `solicitacao_numerario_execucao` (0041). A intenção é gravada como 'reconciling'
-- ANTES do primeiro POST ao fin015; vira 'settled' quando a remessa é confirmada; em falha
-- vira 'error' com a resposta crua.
--
-- Por que isto é obrigatório: `criarLote`, `importarTitulos` e `gerarRemessa` NÃO são
-- idempotentes. Um retry após timeout duplica LOTE DE PAGAMENTO — dinheiro saindo duas vezes.
-- `reconciling` órfão é FAIL-CLOSED: nunca re-POSTar; exige conciliação humana.
--
-- As chaves nativas são persistidas ASSIM QUE o ERP as devolve (`native_flp_cod` logo após o
-- criarLote), para que uma queda no meio da sequência aponte o lote órfão a cancelar.
CREATE TABLE IF NOT EXISTS remessa_execucao (
    id                  BIGSERIAL PRIMARY KEY,
    idempotency_key     TEXT NOT NULL,
    correlation_id      TEXT,
    lote_id             UUID NOT NULL REFERENCES lote_pagamento(id) ON DELETE CASCADE,
    fil_cod             INTEGER NOT NULL,
    bnc_cod             INTEGER NOT NULL,
    -- pending: criada, não iniciada | reconciling: write-ahead, sequência fin015 em voo
    -- settled: remessa gerada e confirmada | error: falhou (ver erp_response)
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'reconciling', 'settled', 'error')),
    -- TRUE quando rodou em dry-run (montou/logou o payload, sem POST real).
    dry_run             BOOLEAN NOT NULL DEFAULT TRUE,
    -- Handles de reconciliação, gravados assim que o ERP os devolve.
    native_flp_cod      INTEGER,
    native_gab_cod      INTEGER,
    -- Passo alcançado antes da falha — diz o que existe no ERP para desfazer.
    etapa               TEXT CHECK (etapa IN ('criar_lote', 'importar', 'finalizar', 'gerar_remessa', 'concluido')),
    request_payload     JSONB,
    erp_response        JSONB,
    erro_mensagem       TEXT,
    executado_por       TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_remessa_execucao_lote   ON remessa_execucao (lote_id);
CREATE INDEX IF NOT EXISTS idx_remessa_execucao_status ON remessa_execucao (status);

-- Busca do lote pela chave nativa, usada pela conciliação do retorno (o .RET traz
-- fil+bnc+flp+its no "uso da empresa" e precisamos achar o lote LOCAL correspondente).
CREATE INDEX IF NOT EXISTS idx_lote_pagamento_nativo
    ON lote_pagamento (native_fil_cod, native_bnc_cod, native_flp_cod);
