-- 0079_permissoes_sispag_conferir_cadastro.sql
-- ADR-0063 — duas permissões AVULSAS novas no catálogo da ADR-0053 (R4):
--
--   * `sispag:conferir` — conferência por 2ª pessoa do lote com TED/PIX (L12) e devolução (L13);
--   * `sispag:cadastro` — fila "Pendências de cadastro" (I13k).
--
-- Mesmo padrão da 0068/0075: troca o `CHECK (permission IN (...))` das duas tabelas pelo catálogo
-- atual do código (`domain/interface/auth/Permission.ts`). NENHUMA concessão aqui (gap Q8): quem
-- recebe cada permissão é decisão operacional da Columbia, feita pela tela de usuários depois do
-- deploy (passo de rollout no PR). Com um único titular de `sispag:conferir` que também finaliza,
-- nenhum lote TED/PIX chega à remessa — é o efeito desejado da regra.
--
-- Idempotente: `DROP CONSTRAINT IF EXISTS` antes de cada `ADD`. Nada é apagado.

ALTER TABLE app_role_permission
    DROP CONSTRAINT IF EXISTS app_role_permission_permission_check;
ALTER TABLE user_permission
    DROP CONSTRAINT IF EXISTS user_permission_permission_check;

ALTER TABLE app_role_permission
    ADD CONSTRAINT app_role_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:excecao', 'sispag:conferir', 'sispag:cadastro',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));

ALTER TABLE user_permission
    ADD CONSTRAINT user_permission_permission_check CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar', 'sispag:excecao', 'sispag:conferir', 'sispag:cadastro',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    ));
