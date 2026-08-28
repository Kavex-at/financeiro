-- 0051 — a execução registra QUAL identidade do Conexos a realizou (I-2, ADR-0041).
--
-- Os ledgers já gravam `executado_por`: o usuário DA PLATAFORMA que clicou. O que faltava é
-- quem, DENTRO DO ERP, assinou a escrita — a sessão do usuário vinculado ou a do robô.
--
-- Sem isso, as duas verdades não se cruzam. Em 2026-08-25 um usuário com vínculo cadastrado
-- cujo login nunca completava acumulou 35 execuções (13 num dia só, baixas reais no fin010)
-- registradas como dele e assinadas pelo robô. Descobrir isso exigiu inferir pela AUSÊNCIA de
-- uma linha em `conexos_sessions` — não havia nada no ledger para consultar.
--
-- NULL significa "identidade não capturada" (linha anterior a esta migration, ou execução
-- que não chegou a resolver sessão). NUNCA significa "robô": o robô é gravado pelo nome.
-- Sem backfill — a identidade usada no passado não é recuperável de lugar nenhum.
--
-- `conexos_usn_cod` é TEXT para espelhar `conexos_sessions.usn_cod` (0022).
-- Idempotente (`IF NOT EXISTS`), re-rodável.

ALTER TABLE permuta_alocacao_execucao
    ADD COLUMN IF NOT EXISTS conexos_username TEXT,
    ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;

ALTER TABLE solicitacao_numerario_execucao
    ADD COLUMN IF NOT EXISTS conexos_username TEXT,
    ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;

ALTER TABLE recebimento_execucao
    ADD COLUMN IF NOT EXISTS conexos_username TEXT,
    ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;

ALTER TABLE remessa_execucao
    ADD COLUMN IF NOT EXISTS conexos_username TEXT,
    ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;

ALTER TABLE conciliacao_execucao
    ADD COLUMN IF NOT EXISTS conexos_username TEXT,
    ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;

-- A SEXTA ledger. `solicitacao_numerario` (0032, NumerarioExecucaoRepository) não carrega o
-- sufixo `_execucao` no nome, mas é write-ahead igual às outras: idempotency_key, status,
-- dry_run, erp_response, executado_por, e guarda a cadeia com299 → fin014 → com297 da trilha
-- de PERMUTA (routes/permutas.ts). Ficou de fora da primeira versão desta migration porque a
-- lista foi montada pelo padrão de nome; o Regis-Review pegou (modifiability-2 / fault-tolerance-1).
ALTER TABLE solicitacao_numerario
    ADD COLUMN IF NOT EXISTS conexos_username TEXT,
    ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;
