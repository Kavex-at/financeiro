-- Reverse de `0054_estado_ja_permutado.sql` — Regis-Review 2026-09-08, card `rollback-0054`.
--
-- NÃO É UMA MIGRATION. Não é aplicado pelo `MigrationRunner` (vive num
-- subdiretório, e `readdirSync` não é recursivo). Rode à mão, com supervisão:
--
--   psql "$databaseConnectionString" -v ON_ERROR_STOP=1 \
--     -f src/backend/migrations/rollbacks/0054_estado_ja_permutado.rollback.sql
--
-- ─── Por que este reverse é possível ─────────────────────────────────────────
-- O backfill da 0054 é destrutivo quanto ao `status`, mas NÃO quanto ao
-- `motivo_bloqueio`: nenhuma linha teve o motivo alterado. E o mapeamento
-- original é uma função do motivo. Logo o inverso é determinístico — recolapsar
-- é aplicar a projeção binária da 0001 sobre o mesmo motivo que sempre esteve
-- lá. Medido em PRD 2026-09-08: 152.516 linhas, 250 runs, ZERO linhas com
-- `status='bloqueada' AND motivo_bloqueio IS NULL`.
--
-- ─── O que este script NÃO faz ───────────────────────────────────────────────
-- Não reverte o CÓDIGO. Rodar isto com o backend novo no ar quebra a próxima
-- eleição na CHECK binária restaurada — que é o desfecho correto (falha alta em
-- vez de corrupção silenciosa), mas significa que a ordem importa:
--   1) reverter o deploy do backend para a versão anterior à ADR-0043;
--   2) só então rodar este script.
-- A ordem inversa deixa a janela em que código novo escreve contra schema velho.
--
-- Idempotente: rodar duas vezes dá o mesmo resultado (os UPDATEs têm WHERE que
-- não reclassifica o que já está colapsado; os DDL usam IF EXISTS).

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '10min';

-- ─── 1. Afrouxar as CHECKs ANTES de recolapsar ───────────────────────────────
-- Mesma razão de ordem da 0054, invertida: a CHECK restaurada é mais estreita
-- que o dado atual, então recolapsar primeiro e restringir depois falharia no
-- meio. Aqui derruba-se a constraint, recolapsa-se, e só então restringe.
ALTER TABLE permuta_adiantamento
    DROP CONSTRAINT IF EXISTS permuta_adiantamento_estado_elegibilidade_check;

ALTER TABLE permuta_candidata_snapshot
    DROP CONSTRAINT IF EXISTS permuta_candidata_snapshot_status_check;

-- ─── 2. Recolapsar o modelo relacional ───────────────────────────────────────
-- `ja-permutado` volta a ser `bloqueada` + motivo (o motivo já está gravado).
UPDATE permuta_adiantamento
   SET estado_elegibilidade = 'bloqueada'
 WHERE estado_elegibilidade = 'ja-permutado';

-- ─── 3. Recolapsar o snapshot para a projeção binária da 0001 ────────────────
-- Tudo que não é `elegivel` vira `bloqueada` — exatamente o catch-all que a
-- 0054 removeu. O motivo permanece intacto, então a 0054 pode ser reaplicada
-- depois sem perda: este reverse é reversível.
UPDATE permuta_candidata_snapshot
   SET status = 'bloqueada'
 WHERE status IN ('casamento-manual', 'permuta-manual', 'ja-permutado');

-- ─── 4. Restaurar as CHECKs originais (0001 / 0012) ──────────────────────────
ALTER TABLE permuta_adiantamento
    ADD CONSTRAINT permuta_adiantamento_estado_elegibilidade_check
        CHECK (estado_elegibilidade IN
            ('descoberta', 'elegivel', 'bloqueada', 'casamento-manual', 'permuta-manual'))
        NOT VALID;

ALTER TABLE permuta_candidata_snapshot
    ADD CONSTRAINT permuta_candidata_snapshot_status_check
        CHECK (status IN ('elegivel', 'bloqueada'))
        NOT VALID;

-- ─── 5. Recompor o header no vocabulário legado ──────────────────────────────
-- `total_bloqueadas` volta a ser o predicado ESTRITO do header antigo, que
-- incluía `ja-permutado` mas não incluía casamento-manual nem permuta-manual —
-- é assim que ele estava antes da 0054 (agregado das 250 runs: 64.893).
-- Recomputação a partir do snapshot, jamais soma sobre o valor atual: rodar
-- duas vezes dá o mesmo número.
UPDATE permuta_eleicao_run r
   SET total_bloqueadas = c.bloqueadas_legado
  FROM (
        SELECT s.run_id,
               COUNT(*) FILTER (
                   WHERE s.status = 'bloqueada'
                     AND (s.motivo_bloqueio IS NULL
                          OR s.motivo_bloqueio NOT IN ('cliente-filtro',
                                                       'composto-nm',
                                                       'multiplas-invoices'))
               ) AS bloqueadas_legado
          FROM permuta_candidata_snapshot s
         GROUP BY s.run_id
  ) c
 WHERE c.run_id = r.id;

-- ─── 6. Devolver as colunas de bucket ao estado pré-0054 ─────────────────────
-- Zeradas, não dropadas: manter as colunas permite reaplicar a 0054 sem novo
-- DDL, e uma coluna zerada é inofensiva para o código antigo, que não a lê.
-- Para descartá-las de vez, use os DROPs comentados abaixo — irreversível
-- quanto aos valores, mas a 0054 os recomputa do snapshot de qualquer forma.
UPDATE permuta_eleicao_run
   SET total_casamento_manual = 0,
       total_permuta_manual   = 0,
       total_ja_permutado     = 0
 WHERE total_casamento_manual <> 0
    OR total_permuta_manual   <> 0
    OR total_ja_permutado     <> 0;

-- ALTER TABLE permuta_eleicao_run DROP COLUMN IF EXISTS total_casamento_manual;
-- ALTER TABLE permuta_eleicao_run DROP COLUMN IF EXISTS total_permuta_manual;
-- ALTER TABLE permuta_eleicao_run DROP COLUMN IF EXISTS total_ja_permutado;

-- ─── 7. Validar e conferir ───────────────────────────────────────────────────
ALTER TABLE permuta_adiantamento
    VALIDATE CONSTRAINT permuta_adiantamento_estado_elegibilidade_check;

ALTER TABLE permuta_candidata_snapshot
    VALIDATE CONSTRAINT permuta_candidata_snapshot_status_check;

-- Self-test: depois do reverse, o snapshot tem de ser binário de novo e o header
-- tem de bater com ele. Se não bater, ABORTA e nada é commitado.
DO $$
DECLARE
    fora_do_binario INTEGER;
    divergentes     INTEGER;
BEGIN
    SELECT COUNT(*) INTO fora_do_binario
      FROM permuta_candidata_snapshot
     WHERE status NOT IN ('elegivel', 'bloqueada');

    IF fora_do_binario > 0 THEN
        RAISE EXCEPTION
            'rollback 0054: % linhas de snapshot seguem fora de (elegivel, bloqueada) — reverse incompleto',
            fora_do_binario;
    END IF;

    SELECT COUNT(*) INTO divergentes
      FROM permuta_eleicao_run r
      JOIN (
            SELECT run_id,
                   COUNT(*) FILTER (WHERE status = 'elegivel') AS elegiveis,
                   COUNT(*)                                    AS candidatas
              FROM permuta_candidata_snapshot
             GROUP BY run_id
      ) c ON c.run_id = r.id
     WHERE r.total_elegiveis <> c.elegiveis
        OR r.total_candidatas <> c.candidatas;

    IF divergentes > 0 THEN
        RAISE EXCEPTION
            'rollback 0054: % runs com header divergente do snapshot após o reverse',
            divergentes;
    END IF;

    RAISE NOTICE 'rollback 0054: reverse concluído e conferido';
END $$;

COMMIT;
