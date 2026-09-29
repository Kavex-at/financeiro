-- 0068_sispag_aprovar_destino.sql
-- ADR-0054, Adendo (2026-09-29, tarde), D10 — a conta (TED) digitada no item do lote nasce
-- PENDENTE DE APROVAÇÃO; só quem tem `sispag:aprovar_destino` aprova.
--
-- ── 1. A PERMISSÃO NOVA NO CATÁLOGO (ADR-0053 R4) ─────────────────────────────────────────────
--
-- O catálogo é fixo no código (`domain/interface/auth/Permission.ts`) e o `CHECK` das duas colunas
-- `permission` repete a lista. A 0066 criou os dois `CHECK` inline; o Postgres os nomeia
-- `<tabela>_<coluna>_check`. Trocamos cada um pela lista nova (DROP IF EXISTS + ADD: idempotente).
-- O teste da 0068 confere que a lista mais recente do diretório é o catálogo do código.
--
-- O papel semeado `Administrador` ganha a permissão; nenhum outro papel (D10).
--
-- ── 2. A APROVAÇÃO NA TRILHA SÓ-INCLUSÃO (I10g) ───────────────────────────────────────────────
--
-- A aprovação é uma LINHA da trilha `lote_pagamento_item_destino_audit`, não uma coluna mutável
-- do item: `evento = 'APROVACAO'`, quem (`alterado_por`), quando (`alterado_em`) e QUAL gravação
-- foi aprovada (`aprova_audit_id` → id da linha `GRAVACAO` vigente). O item está aprovado quando
-- existe aprovação para a gravação vigente; editar ou limpar o destino cria outra gravação, e a
-- aprovação anterior deixa de valer sem que nada precise ser apagado ou zerado.
--
-- As linhas que já existem são gravações: o DEFAULT da coluna nova as classifica. ADD COLUMN com
-- DEFAULT constante não reescreve linhas nem dispara o trigger só-inclusão da 0067.
--
-- Sem reverse em `rollbacks/`: nada aqui é destrutivo. A coluna nova e o `CHECK` ampliado não
-- quebram o backend anterior (ele não lê `evento` e só grava permissões da lista antiga).
--
-- SQL idempotente: `IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, `ON CONFLICT DO NOTHING`.

ALTER TABLE app_role_permission
    DROP CONSTRAINT IF EXISTS app_role_permission_permission_check;
ALTER TABLE app_role_permission
    ADD CONSTRAINT app_role_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:aprovar_destino',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

ALTER TABLE user_permission
    DROP CONSTRAINT IF EXISTS user_permission_permission_check;
ALTER TABLE user_permission
    ADD CONSTRAINT user_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:aprovar_destino',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

INSERT INTO app_role_permission (role_id, permission)
SELECT r.id, 'sispag:aprovar_destino'
  FROM app_role r
 WHERE lower(r.nome) = 'administrador'
ON CONFLICT DO NOTHING;

ALTER TABLE lote_pagamento_item_destino_audit
    ADD COLUMN IF NOT EXISTS evento TEXT NOT NULL DEFAULT 'GRAVACAO';

ALTER TABLE lote_pagamento_item_destino_audit
    ADD COLUMN IF NOT EXISTS aprova_audit_id UUID NULL;

ALTER TABLE lote_pagamento_item_destino_audit
    DROP CONSTRAINT IF EXISTS destino_audit_evento_check;
ALTER TABLE lote_pagamento_item_destino_audit
    ADD CONSTRAINT destino_audit_evento_check CHECK (
        evento IN ('GRAVACAO', 'APROVACAO')
        AND (evento <> 'APROVACAO' OR aprova_audit_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_destino_audit_aprovacao
    ON lote_pagamento_item_destino_audit (aprova_audit_id)
    WHERE evento = 'APROVACAO';

COMMENT ON COLUMN lote_pagamento_item_destino_audit.evento IS
    'ADR-0054 D10 — GRAVACAO (destino gravado/limpo) ou APROVACAO (conta digitada aprovada por quem tem sispag:aprovar_destino).';
COMMENT ON COLUMN lote_pagamento_item_destino_audit.aprova_audit_id IS
    'ADR-0054 D10 — na APROVACAO, o id da linha GRAVACAO aprovada. Outra gravacao = aprovacao anterior nao vale.';
