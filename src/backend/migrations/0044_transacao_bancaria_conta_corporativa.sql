-- 0044_transacao_bancaria_conta_corporativa.sql
-- Frente IV, Módulo 1 — ADR-0032: o extrato do `fin095` é escopado por CONTA, não por filial.
--
-- O `fin095/list` filtra por `gerNum` + janela e IGNORA a filial (que viaja só como header de
-- sessão). Como a chave natural era `fin095:{filCod}:{gerNum}:{extCod}:{exiCodSeq}` e a ingestão
-- fazia fan-out (filial × conta), CADA lançamento foi gravado uma vez por filial configurada.
-- Medido em produção antes desta migração: 728 linhas do canal `fin095` para 104 lançamentos reais
-- (624 excedentes, 86%), todos os grupos duplicados em `fil_cod = {1,2,3,4,5,6,7}`, e o KPI
-- "a distribuir" 7× inflado.
--
-- Colapsa cada grupo (`extCod`, `exiCodSeq`, `ger_num`) para a linha MAIS ANTIGA — preservando
-- `importado_em`/`import_run_id` originais — reescrevendo a chave natural para a fórmula nova e
-- zerando `fil_cod` (NULL = conta CORPORATIVA).
--
-- ESCOPO: só o canal automático (`canal IS NULL` + `normalized` do fin095). O canal
-- `xlsx_bradesco` mantém `fil_cod` — lá a filial é escolha explícita do analista no upload — e sua
-- chave já é namespaced por conteúdo. As transações-stub do `POST /pipeline/run` (sem `normalized`)
-- ficam de fora pelo `IS NOT NULL`.
--
-- IDEMPOTENTE: na segunda execução o DELETE não acha excedente e o UPDATE reescreve os mesmos
-- valores (a derivação é determinística).

-- ── `fil_cod` passa a aceitar NULL ───────────────────────────────────────────
ALTER TABLE transacao_bancaria ALTER COLUMN fil_cod DROP NOT NULL;

-- ── Excedentes SAEM primeiro ─────────────────────────────────────────────────
-- Precisa vir antes do UPDATE: as duplicatas ainda ocupam chaves e o `UNIQUE (natural_key)`
-- rejeitaria o sobrevivente ao migrar para a chave nova.
--
-- Nenhuma é referenciada por `recebimento.transacao_id` na janela em que isto roda; se alguma fosse,
-- a FK aborta a migração inteira em vez de corromper o ledger em silêncio.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY ger_num, normalized ->> 'extCod', normalized ->> 'exiCodSeq'
               -- A mais antiga vence; `id` desempata para a escolha ser determinística
               -- (a migração precisa dar o mesmo resultado se for reexecutada).
               ORDER BY importado_em ASC, id ASC
           ) AS rn
    FROM transacao_bancaria
    WHERE canal IS NULL
      AND ger_num IS NOT NULL
      AND normalized ->> 'extCod' IS NOT NULL
      AND normalized ->> 'exiCodSeq' IS NOT NULL
)
DELETE FROM transacao_bancaria t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

-- ── Sobreviventes migram para a chave nova e viram corporativos ──────────────
-- `id` e `correlation_id` são determinísticos a partir da chave natural (sha256 → 32 hex →
-- formato UUID), reproduzindo `buildTransacaoId`/`buildCorrelationId` de `normalizarLancamento.ts`.
-- Reproduzir a MESMA derivação aqui é o que faz o próximo `ON CONFLICT (natural_key)` do cron
-- reencontrar estas linhas em vez de inserir cópias novas.
WITH novo AS (
    SELECT id AS id_antigo,
           'fin095:' || ger_num
                     || ':' || (normalized ->> 'extCod')
                     || ':' || (normalized ->> 'exiCodSeq') AS nk
    FROM transacao_bancaria
    WHERE canal IS NULL
      AND ger_num IS NOT NULL
      AND normalized ->> 'extCod' IS NOT NULL
      AND normalized ->> 'exiCodSeq' IS NOT NULL
), derivado AS (
    SELECT id_antigo,
           nk,
           regexp_replace(
               substring(encode(digest(nk, 'sha256'), 'hex') from 1 for 32),
               '^(.{8})(.{4})(.{4})(.{4})(.{12})$', '\1-\2-\3-\4-\5'
           ) AS id_novo,
           -- `buildCorrelationId(nk)` = `buildTransacaoId('correlation:' || nk)`.
           regexp_replace(
               substring(encode(digest('correlation:' || nk, 'sha256'), 'hex') from 1 for 32),
               '^(.{8})(.{4})(.{4})(.{4})(.{12})$', '\1-\2-\3-\4-\5'
           ) AS correlation_novo
    FROM novo
)
UPDATE transacao_bancaria t
SET natural_key    = d.nk,
    id             = d.id_novo,
    correlation_id = d.correlation_novo,
    fil_cod        = NULL,
    atualizado_em  = now()
FROM derivado d
WHERE t.id = d.id_antigo
  -- No-op quando já está migrada: evita reescrever `atualizado_em` a cada deploy.
  AND (t.natural_key IS DISTINCT FROM d.nk OR t.fil_cod IS NOT NULL);
