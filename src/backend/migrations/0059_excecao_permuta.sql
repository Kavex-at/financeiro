-- Migration 0059 — exceção manual "permutado fora do painel" (ADR-0047).
--
-- ─── O caso ──────────────────────────────────────────────────────────────────
-- O adiantamento 8721 (proc 124, R$ 20,4 mi) foi permutado em 30/04 por baixas
-- cruzadas manuais (contas 21 ↔ 198), fora do fluxo de permuta do Conexos. O ERP
-- não preencheu "Valor permutado", então a eleição o classifica como
-- `bloqueada / sem-saldo-permutar`. Nenhum dado lido distingue, com segurança,
-- "permutado por fora" de "nunca teve saldo": a correção é uma decisão humana,
-- auditada, restrita a esse estado calculado.
--
-- ─── Por que uma TABELA e não um UPDATE em permuta_adiantamento ─────────────
-- A ingestão (3×/dia + botão) recalcula todos os adtos e faz UPSERT da linha
-- inteira: um UPDATE à mão seria sobrescrito na run seguinte e não deixaria
-- trilha de autor e justificativa. A exceção vive aqui e o compute único da
-- eleição a aplica depois dos gates (pós-passe em `computeCandidatas`).
--
-- ─── Soft delete como trilha (I5 / I-Exc-4) ──────────────────────────────────
-- Desfazer NÃO apaga: grava `removido_por`/`removido_em`. Uma exceção é ativa
-- enquanto `removido_em IS NULL`; o índice parcial garante no máximo UMA ativa
-- por adiantamento (I-Exc-3) e permite remarcar depois de desfazer. A CHECK de
-- pareamento impede remoção sem autor (ou autor sem data).
--
-- ─── Por que não há FK nem reverse ───────────────────────────────────────────
-- Sem FK para `permuta_adiantamento`: nenhuma tabela de configuração do analista
-- (`cliente_filtro` 0013, `permuta_alocacao` 0014) referencia as tabelas da
-- ingestão, e a exceção precisa sobreviver a qualquer recarga delas. Sem script
-- de reverse: a política de `rollbacks/README.md` o exige para UPDATE > 1.000
-- linhas, e esta migration só cria tabela/índice e redefine CHECKs sem tocar dado.
--
-- ─── Defesa em profundidade: a guarda da 0055 ganha o motivo novo ────────────
-- `permutado-fora-do-painel` só existe com o estado `ja-permutado` (T7). Uma linha
-- `bloqueada` com esse motivo é, por definição, estado colapsado: o mesmo tipo de
-- combinação que a 0055 proíbe. As duas CHECKs são redefinidas pelo MESMO nome, então
-- os reverses da 0054/0055 (que as derrubam por nome) seguem corretos. O código antigo
-- nunca produz o motivo novo, logo a trava não afeta um rollback de deploy.
--
-- Idempotente de ponta a ponta (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD`).
-- SQL estático: nenhum valor interpolado.

-- ─── 1. Tabela de exceções ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permuta_excecao_manual (
    id                    BIGSERIAL PRIMARY KEY,
    adiantamento_doc_cod  TEXT        NOT NULL,
    justificativa         TEXT        NOT NULL,
    criado_por            TEXT        NOT NULL,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    removido_por          TEXT,
    removido_em           TIMESTAMPTZ
);

ALTER TABLE permuta_excecao_manual
    DROP CONSTRAINT IF EXISTS permuta_excecao_manual_justificativa_tamanho;

ALTER TABLE permuta_excecao_manual
    ADD CONSTRAINT permuta_excecao_manual_justificativa_tamanho
        CHECK (char_length(justificativa) BETWEEN 10 AND 500);

ALTER TABLE permuta_excecao_manual
    DROP CONSTRAINT IF EXISTS permuta_excecao_manual_remocao_pareada;

ALTER TABLE permuta_excecao_manual
    ADD CONSTRAINT permuta_excecao_manual_remocao_pareada
        CHECK ((removido_em IS NULL) = (removido_por IS NULL));

-- No máximo UMA exceção ativa por adiantamento; o histórico são as removidas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_permuta_excecao_manual_ativa
    ON permuta_excecao_manual (adiantamento_doc_cod)
    WHERE removido_em IS NULL;

-- ─── 2. Guarda contra estado colapsado (estende a 0055) ──────────────────────
ALTER TABLE permuta_adiantamento
    DROP CONSTRAINT IF EXISTS permuta_adiantamento_sem_estado_colapsado;

ALTER TABLE permuta_adiantamento
    ADD CONSTRAINT permuta_adiantamento_sem_estado_colapsado
        CHECK (NOT (estado_elegibilidade = 'bloqueada'
                    AND motivo_bloqueio IN ('ja-permutado',
                                            'permutado-fora-do-painel')))
        NOT VALID;

ALTER TABLE permuta_candidata_snapshot
    DROP CONSTRAINT IF EXISTS permuta_candidata_snapshot_sem_status_colapsado;

ALTER TABLE permuta_candidata_snapshot
    ADD CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado
        CHECK (NOT (status = 'bloqueada'
                    AND motivo_bloqueio IN ('cliente-filtro',
                                            'composto-nm',
                                            'multiplas-invoices',
                                            'ja-permutado',
                                            'permutado-fora-do-painel')))
        NOT VALID;

-- Nenhuma linha carrega o motivo novo antes desta migration, então a validação
-- passa. Falhar aqui significaria que a guarda da 0055 já estava violada.
ALTER TABLE permuta_adiantamento
    VALIDATE CONSTRAINT permuta_adiantamento_sem_estado_colapsado;

ALTER TABLE permuta_candidata_snapshot
    VALIDATE CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado;
