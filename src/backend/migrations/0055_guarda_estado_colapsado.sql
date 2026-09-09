-- Migration 0055 — a trava contra o rollback assimétrico.
-- Regis-Review 2026-09-08, card `rollback-assimetrico` (P1, convergente de
-- Fault Tolerance + Deployability).
--
-- ─── O problema que esta migration fecha ─────────────────────────────────────
-- A 0054 alargou as CHECKs para aceitar os 5 estados. Alargar aceita o novo, mas
-- **continua aceitando o velho** — `bloqueada` segue sendo um valor legítimo. Essa
-- é a assimetria: reverter o deploy do backend NÃO reverte a migration, e o código
-- antigo (que colapsa tudo que não é `elegivel` em `bloqueada`) volta a escrever
-- por cima de dado já corrigido. Sem erro. Sem log. Sem violação de constraint.
--
-- Medido: ~80 linhas de `permuta_adiantamento` voltariam a `bloqueada` na primeira
-- ingestão pós-rollback. Pior, a tabela passaria a conter DUAS semânticas
-- misturadas — histórico corrigido e linhas novas colapsadas — sem marcador que as
-- distinga além da data da run.
--
-- ─── A defesa ────────────────────────────────────────────────────────────────
-- CHECK que proíbe as COMBINAÇÕES que só o código antigo produz: um estado
-- colapsado carregando um motivo que, na taxonomia nova, pertence a outro estado.
-- Não proíbe `bloqueada` (que segue legítimo) — proíbe `bloqueada` + um motivo que
-- prova que a linha deveria estar em outro balde.
--
-- CHECK e não TRIGGER, deliberadamente: é declarativo, não precisa de função nem
-- de manutenção de PL/pgSQL, aparece no `\d` da tabela para quem for investigar, e
-- não paga custo por linha além do que a constraint já paga. A recomendação
-- original da review era TRIGGER; o efeito é o mesmo e o custo é menor.
--
-- ─── Consequência deliberada ─────────────────────────────────────────────────
-- Depois desta migration, rodar o backend ANTIGO contra este banco faz a ingestão
-- FALHAR ALTO na primeira escrita. É o desfecho certo: falhar é recuperável,
-- corromper em silêncio não é. Quem precisar reverter de verdade roda o reverse
-- (`rollbacks/0055_...`) antes — a ordem está no runbook.
--
-- Idempotente (`DROP CONSTRAINT IF EXISTS` + `ADD`), e `NOT VALID` + `VALIDATE`
-- pelo mesmo motivo da 0054: lock fraco na varredura.

-- ─── 1. permuta_adiantamento ─────────────────────────────────────────────────
-- `ja-permutado` é o único motivo que, sozinho, prova o estado: se o adto foi pago
-- e teve o saldo 100% consumido, ele está CONCLUÍDO, não bloqueado (ADR-0043).
ALTER TABLE permuta_adiantamento
    DROP CONSTRAINT IF EXISTS permuta_adiantamento_sem_estado_colapsado;

ALTER TABLE permuta_adiantamento
    ADD CONSTRAINT permuta_adiantamento_sem_estado_colapsado
        CHECK (NOT (estado_elegibilidade = 'bloqueada'
                    AND motivo_bloqueio = 'ja-permutado'))
        NOT VALID;

-- ─── 2. permuta_candidata_snapshot ───────────────────────────────────────────
-- Aqui a superfície é maior: o catch-all antigo colapsava TRÊS estados. Cada um
-- dos motivos abaixo pertence, na taxonomia pós-ADR-0043, a um estado que não é
-- `bloqueada` — `cliente-filtro` → permuta-manual (ADR-0007), `composto-nm` e
-- `multiplas-invoices` → casamento-manual (ADR-0005), `ja-permutado` → concluído.
ALTER TABLE permuta_candidata_snapshot
    DROP CONSTRAINT IF EXISTS permuta_candidata_snapshot_sem_status_colapsado;

ALTER TABLE permuta_candidata_snapshot
    ADD CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado
        CHECK (NOT (status = 'bloqueada'
                    AND motivo_bloqueio IN ('cliente-filtro',
                                            'composto-nm',
                                            'multiplas-invoices',
                                            'ja-permutado')))
        NOT VALID;

-- ─── 3. Validação ────────────────────────────────────────────────────────────
-- O backfill da 0054 já eliminou toda combinação proibida, então isto passa. Se
-- NÃO passar, é sinal de que a 0054 não rodou ou rodou parcialmente — e falhar
-- aqui, no boot, é melhor do que descobrir depois.
ALTER TABLE permuta_adiantamento
    VALIDATE CONSTRAINT permuta_adiantamento_sem_estado_colapsado;

ALTER TABLE permuta_candidata_snapshot
    VALIDATE CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado;
