-- 0054_estado_ja_permutado.sql — `ja-permutado` vira estado; o snapshot da
-- eleição para de mentir. ADR-0043.
--
-- ## O que esta migration faz
--
--   1. estende a CHECK de `permuta_adiantamento.estado_elegibilidade` com
--      'ja-permutado' (mesma técnica idempotente da 0005 e da 0012);
--   2. RECRIA a CHECK de `permuta_candidata_snapshot.status`, que era binária
--      desde a 0001 (`elegivel|bloqueada`), para os 5 estados da máquina;
--   3. dá ao header `permuta_eleicao_run` os 3 buckets que faltavam;
--   4. backfilla o histórico — 152.516 linhas de snapshot e 250 runs de eleição —
--      por RECONCILIAÇÃO, não por heurística (ver abaixo);
--   5. ABORTA a transação inteira se a reconciliação não fechar.
--
-- ## REVOGAÇÃO EXPLÍCITA da decisão de back-compat das migrations 0005 e 0012
--
-- Ambas registraram, por escrito, a decisão de NÃO tocar a CHECK do snapshot:
--
--     "NÃO toca o `permuta_candidata_snapshot` (0001), cuja CHECK segue
--      `elegivel|bloqueada` — o `casamento-manual` é mapeado para `bloqueada`
--      no snapshot (back-compat `/painel` do PR#2)."   — 0005, repetido na 0012
--
-- Essa justificativa CADUCOU: `GET /permutas/painel` não tinha nenhum consumidor
-- no frontend (zero call sites) e foi removida junto com esta mudança (ADR-0043
-- §5). Uma decisão de compatibilidade cuja contraparte não existe não é
-- conservadorismo — é uma mentira mantida por inércia, e custou 348 itens da
-- NOSSA fila de trabalho classificados como passivo de terceiro por ~3 meses
-- (677 reportadas contra 249 reais na run viva; 2,72× de inflação).
-- Fica revogada aqui, por escrito, para que ninguém a re-derive lendo os
-- arquivos antigos.
--
-- ## Por que o backfill é seguro
--
-- Condição de determinismo medida em 2026-09-08 (read-only, PRD): ZERO linhas
-- com `status='bloqueada' AND motivo_bloqueio IS NULL`, e `multiplas-invoices`
-- com 0 ocorrências históricas. Todo registro carrega o motivo que o classifica.
--
-- Validação cruzada, também medida antes deste commit: somando as 250 runs
-- `kind='eleicao'`, o snapshot reclassificado pela regra abaixo reproduz
-- EXATAMENTE o que o header já gravava de forma independente (64.893 bloqueadas
-- e 7.883 elegíveis dos dois lados). Ou seja: não estamos reconstruindo o estado
-- a partir do motivo e torcendo — estamos reconciliando com um valor íntegro já
-- gravado, que AUDITA a taxonomia de motivos em vez de assumi-la. O bloco `DO`
-- ao final verifica isso run a run e ABORTA se alguma divergir.
--
-- ## Ordem, e por que ela importa
--
-- As CHECKs estendidas vêm ANTES de qualquer UPDATE: o próprio backfill violaria
-- a constraint antiga. A asserção de reconciliação vem antes do backfill, sobre
-- o estado ainda não modificado.
--
-- ## Idempotência
--
-- DDL com IF EXISTS / IF NOT EXISTS; os UPDATEs têm WHERE que não reclassifica o
-- que já foi reclassificado; e o header é RECOMPUTADO a partir do snapshot da
-- própria run — nunca por subtração (`total_bloqueadas - total_ja_permutado`
-- passaria na 1ª execução e CORROMPERIA na 2ª). Rodar duas vezes seguidas é
-- no-op na segunda, `total_bloqueadas` incluído.
--
-- Transação: o runner (`MigrationRunner.run`) envia o arquivo inteiro como UM
-- comando simples ao Postgres, que o executa numa transação implícita — uma
-- falha no meio (inclusive o RAISE abaixo) reverte tudo, e o registro em
-- `schema_migrations` só acontece depois, num comando separado. Não há estado
-- misto possível.
--
-- Todo o SQL aqui é DDL/DML estático — nenhum valor interpolado (Rule #5).

-- ─── 1. Schema: CHECK do modelo relacional ───────────────────────────────────
ALTER TABLE permuta_adiantamento
    DROP CONSTRAINT IF EXISTS permuta_adiantamento_estado_elegibilidade_check;

-- `NOT VALID` (Regis-Review 2026-09-08, card `lock-timeout-not-valid`): adicionar
-- a constraint fica INSTANTÂNEO e sem varrer a tabela. Ela já vale para toda
-- escrita nova a partir daqui — que é o que o backfill abaixo precisa. A
-- varredura das linhas preexistentes é adiada para o `VALIDATE CONSTRAINT` da
-- §8, que toma SHARE UPDATE EXCLUSIVE (não bloqueia leitura nem escrita) em vez
-- do ACCESS EXCLUSIVE que o `ADD CONSTRAINT` validante tomaria.
ALTER TABLE permuta_adiantamento
    ADD CONSTRAINT permuta_adiantamento_estado_elegibilidade_check
        CHECK (estado_elegibilidade IN
            ('descoberta', 'elegivel', 'bloqueada', 'casamento-manual', 'permuta-manual',
             'ja-permutado'))
        NOT VALID;

-- ─── 2. Schema: CHECK do snapshot deixa de ser binária ───────────────────────
ALTER TABLE permuta_candidata_snapshot
    DROP CONSTRAINT IF EXISTS permuta_candidata_snapshot_status_check;

-- `descoberta` fica DE FORA de propósito, e a diferença em relação à CHECK do
-- `permuta_adiantamento` acima é deliberada: `descoberta` é o estado transitório
-- de uma candidata ainda não avaliada, e uma candidata só é snapshotada DEPOIS
-- da avaliação. Excluí-la aqui não é inconsistência entre os dois CHECKs — é uma
-- invariante mais forte, que faz o banco recusar um registro de auditoria de
-- algo que ninguém avaliou.
ALTER TABLE permuta_candidata_snapshot
    ADD CONSTRAINT permuta_candidata_snapshot_status_check
        CHECK (status IN
            ('elegivel', 'bloqueada', 'casamento-manual', 'permuta-manual', 'ja-permutado'))
        NOT VALID;

-- ─── 3. Schema: os 3 buckets que faltavam no header ──────────────────────────
ALTER TABLE permuta_eleicao_run
    ADD COLUMN IF NOT EXISTS total_casamento_manual INTEGER NOT NULL DEFAULT 0;

ALTER TABLE permuta_eleicao_run
    ADD COLUMN IF NOT EXISTS total_permuta_manual   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE permuta_eleicao_run
    ADD COLUMN IF NOT EXISTS total_ja_permutado     INTEGER NOT NULL DEFAULT 0;

-- ─── 4. Asserção de reconciliação — ABORTA se a premissa mudou ───────────────
-- Escopo: runs `kind='eleicao'` cujo snapshot AINDA é binário, isto é, que ainda
-- não passaram por este backfill. Antes desta migration a CHECK da 0001 tornava
-- fisicamente impossível gravar outro valor, então "tem alguma linha fora de
-- ('elegivel','bloqueada')" é um detector exato de "já migrada" — e é o que
-- torna a asserção segura numa segunda execução, em vez de comparar o header
-- já reescrito com o legado e falhar por engano.
DO $$
DECLARE
    d           RECORD;
    divergentes INTEGER := 0;
    detalhe     TEXT    := '';
    mensagem    TEXT;
BEGIN
    FOR d IN
        WITH mapeado AS (
            SELECT s.run_id,
                   CASE
                       WHEN s.status = 'elegivel'                             THEN 'elegivel'
                       WHEN s.motivo_bloqueio = 'cliente-filtro'              THEN 'permuta-manual'
                       WHEN s.motivo_bloqueio IN ('composto-nm',
                                                  'multiplas-invoices')       THEN 'casamento-manual'
                       WHEN s.motivo_bloqueio = 'ja-permutado'                THEN 'ja-permutado'
                       ELSE 'bloqueada'
                   END AS status_novo
              FROM permuta_candidata_snapshot s
        ),
        por_run AS (
            SELECT run_id,
                   COUNT(*) FILTER (WHERE status_novo = 'elegivel')                   AS elegiveis,
                   COUNT(*) FILTER (WHERE status_novo IN ('bloqueada', 'ja-permutado')) AS bloqueadas_legado,
                   COUNT(*)                                                           AS candidatas
              FROM mapeado
             GROUP BY run_id
        )
        SELECT r.id                  AS run_id,
               r.total_elegiveis     AS header_elegiveis,
               p.elegiveis           AS snapshot_elegiveis,
               r.total_bloqueadas    AS header_bloqueadas,
               p.bloqueadas_legado   AS snapshot_bloqueadas,
               r.total_candidatas    AS header_candidatas,
               p.candidatas          AS snapshot_candidatas
          FROM permuta_eleicao_run r
          JOIN por_run p ON p.run_id = r.id
         WHERE r.kind = 'eleicao'
           AND NOT EXISTS (
               SELECT 1
                 FROM permuta_candidata_snapshot j
                WHERE j.run_id = r.id
                  AND j.status NOT IN ('elegivel', 'bloqueada')
           )
           AND (r.total_elegiveis  <> p.elegiveis
             OR r.total_bloqueadas <> p.bloqueadas_legado
             OR r.total_candidatas <> p.candidatas)
         ORDER BY r.id
    LOOP
        divergentes := divergentes + 1;
        IF divergentes <= 3 THEN
            detalhe := detalhe || format(
                'run %s (elegiveis header=%s snapshot=%s; bloqueadas header=%s snapshot=%s; '
                'candidatas header=%s snapshot=%s); ',
                d.run_id,
                d.header_elegiveis,  d.snapshot_elegiveis,
                d.header_bloqueadas, d.snapshot_bloqueadas,
                d.header_candidatas, d.snapshot_candidatas
            );
        END IF;
    END LOOP;

    IF divergentes > 0 THEN
        -- A mensagem é montada numa variável porque `RAISE` exige um literal como
        -- formato — e o operador que ler isto num incidente precisa dos números
        -- dos DOIS lados, não de um "constraint violated".
        mensagem := format(
            'Migration 0054 ABORTADA: %s run(s) de eleicao divergem entre o header gravado e o '
            'snapshot reclassificado por motivo. Em 2026-09-08 mediu-se 0 divergencia em 250 runs, '
            'entao um disparo aqui significa que a premissa do backfill mudou — NAO aplique sem '
            'nova analise (ADR-0043, secao Backfill). Divergencias: %s',
            divergentes, detalhe
        );
        RAISE EXCEPTION '%', mensagem;
    END IF;
END $$;

-- ─── 5. Backfill do modelo relacional (~80 linhas vivas em 2026-09-08) ───────
-- O estado que a apresentação já promovia item a item passa a existir no banco.
UPDATE permuta_adiantamento
   SET estado_elegibilidade = 'ja-permutado'
 WHERE estado_elegibilidade = 'bloqueada'
   AND motivo_bloqueio      = 'ja-permutado';

-- ─── 6. Backfill do snapshot (152.516 linhas) ────────────────────────────────
-- Só as linhas `bloqueada` são tocadas: `elegivel` já era fiel e fica INTACTA.
-- Distribuição esperada após esta execução: permuta-manual 69.886 ·
-- bloqueada 51.459 · ja-permutado 13.434 · casamento-manual 9.854 ·
-- elegivel 7.883 (medida 2026-09-08).
UPDATE permuta_candidata_snapshot
   SET status = CASE
                    WHEN motivo_bloqueio = 'cliente-filtro'                       THEN 'permuta-manual'
                    WHEN motivo_bloqueio IN ('composto-nm', 'multiplas-invoices') THEN 'casamento-manual'
                    WHEN motivo_bloqueio = 'ja-permutado'                         THEN 'ja-permutado'
                    ELSE 'bloqueada'
                END
 WHERE status = 'bloqueada';

-- ─── 7. Backfill do header, RECOMPUTADO a partir do snapshot da própria run ──
-- `total_bloqueadas` É REESCRITO (64.893 → 51.459 no agregado). Sem a reescrita,
-- a invariante de convergência (I5 cláusula 2) nasceria VIOLADA no histórico: o
-- header diria 64.893 enquanto o snapshot reclassificado diz 51.459.
--
-- `total_elegiveis` NÃO é reescrito — já é íntegro, e acabou de ser conferido
-- pela asserção acima. `total_candidatas` idem.
--
-- Recomputação, jamais subtração: rodar isto N vezes dá sempre o mesmo número.
-- As 264 runs `kind='ingest'` não têm linhas de snapshot, então simplesmente não
-- entram no JOIN e mantêm os totais zerados — sem nenhum ramo condicional.
UPDATE permuta_eleicao_run r
   SET total_bloqueadas       = c.bloqueadas,
       total_casamento_manual = c.casamento_manual,
       total_permuta_manual   = c.permuta_manual,
       total_ja_permutado     = c.ja_permutado
  FROM (
        SELECT run_id,
               COUNT(*) FILTER (WHERE status = 'bloqueada')        AS bloqueadas,
               COUNT(*) FILTER (WHERE status = 'casamento-manual') AS casamento_manual,
               COUNT(*) FILTER (WHERE status = 'permuta-manual')   AS permuta_manual,
               COUNT(*) FILTER (WHERE status = 'ja-permutado')     AS ja_permutado
          FROM permuta_candidata_snapshot
         GROUP BY run_id
  ) c
 WHERE c.run_id = r.id;

-- ─── 8. Validação adiada das constraints (lock fraco, pós-backfill) ──────────
-- Agora que toda linha preexistente foi reclassificada para dentro do domínio
-- novo, valida-se o que ficou `NOT VALID` na §1 e §2. `VALIDATE CONSTRAINT` toma
-- SHARE UPDATE EXCLUSIVE: varre a tabela sem bloquear leitura nem escrita, ao
-- contrário do ACCESS EXCLUSIVE que um `ADD CONSTRAINT` validante tomaria — e é
-- o `BootMigrator` que segura o `app.listen()` enquanto isto roda, então o lock
-- mais fraco é a diferença entre uma janela curta e um boot preso.
--
-- Idempotente: `VALIDATE CONSTRAINT` sobre constraint já validada é no-op.
ALTER TABLE permuta_adiantamento
    VALIDATE CONSTRAINT permuta_adiantamento_estado_elegibilidade_check;

ALTER TABLE permuta_candidata_snapshot
    VALIDATE CONSTRAINT permuta_candidata_snapshot_status_check;
