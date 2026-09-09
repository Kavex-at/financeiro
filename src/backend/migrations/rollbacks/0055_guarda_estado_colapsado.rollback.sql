-- Reverse de `0055_guarda_estado_colapsado.sql`.
--
-- NÃO É UMA MIGRATION (ver `rollbacks/README.md`). Rode à mão:
--
--   psql "$databaseConnectionString" -v ON_ERROR_STOP=1 \
--     -f src/backend/migrations/rollbacks/0055_guarda_estado_colapsado.rollback.sql
--
-- Derruba as travas que impedem o código antigo de regravar estado colapsado.
-- É o PRIMEIRO passo de um rollback real para antes da ADR-0043 — sem ele, tanto
-- o reverse da 0054 quanto o backend antigo esbarram nas CHECKs.
--
-- Rodar SÓ isto (sem o reverse da 0054) é uma escolha legítima e mais branda:
-- destrava a escrita antiga sem desfazer a reclassificação do histórico. Serve
-- para um rollback de emergência em que se quer o backend velho no ar rápido e
-- decidir depois o que fazer com o dado. O custo é que a partir daí a tabela passa
-- a misturar semânticas, então é solução de janela curta, não de regime.

BEGIN;

SET LOCAL lock_timeout = '30s';

ALTER TABLE permuta_adiantamento
    DROP CONSTRAINT IF EXISTS permuta_adiantamento_sem_estado_colapsado;

ALTER TABLE permuta_candidata_snapshot
    DROP CONSTRAINT IF EXISTS permuta_candidata_snapshot_sem_status_colapsado;

COMMIT;
