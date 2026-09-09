-- 0055_permuta_execucao_guard_reabertura.sql
-- ADR-0043 — guard de ROLLBACK: uma execução com baixa confirmada no ERP nunca volta a ser reaberta.
--
-- ── POR QUE ISTO É UM TRIGGER E NÃO CÓDIGO ──────────────────────────────────────────────────────
--
-- O Regis-Review `2026-09-08-1955-permutas-baixa-integridade` achou, por DOIS agentes independentes
-- (Deployability F-1 e Fault-Tolerance F-5), um caminho de DUPLA BAIXA pela porta traseira:
--
--   1. este delta entra em produção e grava a primeira linha `status='parcial'` (com `bxa_cod_seq`
--      preenchido — a baixa PARCIAL existe no fin010, é irreversível por nós);
--   2. o commit é revertido por qualquer motivo, mas a migration NÃO volta (migrations são
--      forward-only neste repo);
--   3. o `beginExecution` da versão ANTIGA não conhece o valor `parcial`: seu `ON CONFLICT DO
--      UPDATE` só preserva `= 'settled'`, então a linha `parcial` cai no ramo ELSE e volta para
--      `reconciling`, com `alreadySettled = false`;
--   4. o serviço então cria outro borderô e re-POSTa `gravarBaixaPermuta` sobre um par que JÁ foi
--      baixado. É exatamente a dupla-baixa que o advisory lock (I-Recon-5) fechou pela porta da
--      frente, acontecendo pela porta dos fundos.
--
-- O card sugeria um guard em `PermutaExecucaoRepository.beginExecution`. **Isso não funcionaria:**
-- esse guard viveria no código que está sendo revertido — ele some junto com o resto do delta.
-- O único ponto que SOBREVIVE a um rollback de código é o banco, porque a migration fica aplicada.
-- Daí o trigger. É o primeiro trigger deste repositório, e a justificativa é essa: nenhuma outra
-- camada tem a vigência necessária.
--
-- ── A REGRA ────────────────────────────────────────────────────────────────────────────────────
--
-- `bxa_cod_seq IS NOT NULL` significa "o ERP confirmou uma escrita sob esta chave". A partir daí a
-- linha só pode transitar ENTRE estados terminais (`settled` ⇄ `parcial`); qualquer volta para
-- `reconciling`, `pending` ou `error` é recusada com exceção.
--
-- Fail-closed deliberado: a rota devolve 500 em vez de duplicar um pagamento. Um 500 é um chamado;
-- uma baixa duplicada é um estorno manual na Columbia sobre R$ 280.775 médios por baixa.
--
-- NÃO afeta nenhum caminho legítimo do código atual (conferido um a um):
--   `beginExecution`  — a CASE preserva `settled`/`parcial`, então NEW.status = OLD.status;
--   `markSettled`/`markParcial` — destino é terminal;
--   `setBorCod`/`setRequestPayload` — não tocam `status`, e linha `reconciling` tem `bxa_cod_seq` NULL;
--   `markError`      — só ocorre ANTES da confirmação, quando `bxa_cod_seq` ainda é NULL;
--   `renameKey`      — troca a chave, preserva o status (o relançamento nasce como INSERT, e este
--                      trigger é BEFORE UPDATE).
--
-- SQL idempotente: `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`.

CREATE OR REPLACE FUNCTION permuta_execucao_bloqueia_reabertura() RETURNS trigger AS $$
BEGIN
    IF OLD.bxa_cod_seq IS NOT NULL
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('settled', 'parcial')
    THEN
        RAISE EXCEPTION
            'execucao % ja tem baixa confirmada no fin010 (bxa_cod_seq=%): reabrir de % para % re-POSTaria uma escrita irreversivel',
            OLD.idempotency_key, OLD.bxa_cod_seq, OLD.status, NEW.status
            USING ERRCODE = 'raise_exception',
                  HINT = 'Rollback de codigo sobre linhas parcial? Ver docs/runbooks/fin010-write-cutover.md, secao "Rollback do codigo com linhas parcial ja gravadas".';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_permuta_execucao_bloqueia_reabertura ON permuta_alocacao_execucao;

CREATE TRIGGER trg_permuta_execucao_bloqueia_reabertura
    BEFORE UPDATE ON permuta_alocacao_execucao
    FOR EACH ROW
    EXECUTE FUNCTION permuta_execucao_bloqueia_reabertura();

COMMENT ON FUNCTION permuta_execucao_bloqueia_reabertura() IS
    'ADR-0043 — recusa reabrir execucao com baixa confirmada no fin010. Vive no banco (e nao no codigo) para sobreviver a um rollback do codigo.';
