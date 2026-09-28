-- 0066 — permissões por módulo lidas do banco: passo 2 de 3 do plano de auth (ADR-0053).
--
-- Troca o `requireRole('admin')` binário (todo usuário é admin, então ele não recorta nada) por
-- permissões grossas por módulo, guardadas aqui e consultadas pelo backend a cada requisição. O
-- token só identifica (`sub = username`); quem autoriza é o banco (I1).
--
--   app_role               papel = pacote nomeado de permissões
--   app_role_permission    o pacote de cada papel
--   app_user.role_id       um papel por usuário (Q5)
--   user_permission        exceções por usuário: conceder ou revogar (Q2); revogar vence
--   app_user_access_event  trilha append-only de toda mudança de acesso (Q7, R12)
--
-- O catálogo de permissões é FIXO no código (`domain/interface/auth/Permission.ts`). O `CHECK`
-- das duas colunas `permission` repete a lista (R4); o teste da 0066 compara os dois lados.
--
-- Dia do deploy sem mudança de comportamento (I6): papel `Administrador` com as NOVE permissões,
-- inclusive `operacao:ver` (o allow-list por env do Painel de Operação, ADR-0042, estava vazio em
-- produção em 2026-09-28, então todo admin já via o painel), e todo
-- usuário existente recebe esse papel. A coluna `role` fica como está (R8), sem uso para
-- autorização, até o passo 3.
--
-- Idempotente: rodar duas vezes não falha nem duplica. Reverse em
-- `rollbacks/0066_auth_permissoes_modulo.rollback.sql` (D7).

-- Guarda (Q3): hoje todo usuário é `admin` (produção, 2026-09-28: 15 usuários, todos `admin`).
-- Qualquer outro valor não tem papel correspondente, e semear um segundo papel por especulação
-- seria pior do que parar. A migration para aqui, antes de qualquer DDL, com o nome de quem
-- precisa de ajuste à mão.
DO $$
DECLARE
    fora TEXT;
BEGIN
    SELECT string_agg(username || ' (' || role || ')', ', ' ORDER BY username)
      INTO fora
      FROM app_user
     WHERE role <> 'admin';

    IF fora IS NOT NULL THEN
        RAISE EXCEPTION 'Há usuários com papel diferente de admin: %. A 0066 só sabe mapear admin para o papel Administrador; ajuste esses usuários à mão (role = ''admin'') e suba de novo.', fora;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_role (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    descricao TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_role_nome_lower
    ON app_role (lower(nome));

CREATE TABLE IF NOT EXISTS app_role_permission (
    role_id INT NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    )),
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS user_permission (
    user_id INT NOT NULL REFERENCES app_user(id),
    permission TEXT NOT NULL CHECK (permission IN (
        'permutas:ver', 'permutas:executar',
        'sispag:ver', 'sispag:executar',
        'recebimentos:ver', 'recebimentos:executar',
        'operacao:ver', 'metricas:ver', 'usuarios:gerenciar'
    )),
    efeito TEXT NOT NULL CHECK (efeito IN ('conceder', 'revogar')),
    concedido_por TEXT NOT NULL,
    concedido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission)
);

-- Trilha append-only: o código só faz INSERT aqui (teste sobre o fonte dos repositórios).
-- `antes`/`depois`: papel = { id, nome }; exceção = lista ordenada; ativo = booleano.
CREATE TABLE IF NOT EXISTS app_user_access_event (
    id BIGSERIAL PRIMARY KEY,
    ator TEXT NOT NULL,
    alvo_user_id INT NOT NULL REFERENCES app_user(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('papel', 'excecao', 'ativo')),
    antes JSONB,
    depois JSONB,
    em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_user_access_event_alvo_em
    ON app_user_access_event (alvo_user_id, em);

-- Seed: o papel do dia do deploy. Pacotes mudam só por migration de dados (Q4).
INSERT INTO app_role (nome, descricao)
VALUES ('Administrador', 'Acesso completo: as três frentes, Operação, Métricas e gestão de usuários.')
ON CONFLICT (lower(nome)) DO NOTHING;

INSERT INTO app_role_permission (role_id, permission)
SELECT r.id, p.permission
  FROM app_role r
 CROSS JOIN (VALUES
        ('permutas:ver'), ('permutas:executar'),
        ('sispag:ver'), ('sispag:executar'),
        ('recebimentos:ver'), ('recebimentos:executar'),
        ('operacao:ver'), ('metricas:ver'), ('usuarios:gerenciar')
     ) AS p(permission)
 WHERE lower(r.nome) = 'administrador'
ON CONFLICT DO NOTHING;

-- Um papel por usuário. Nulo só entre o ADD e o backfill abaixo.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role_id INT REFERENCES app_role(id);

UPDATE app_user
   SET role_id = (SELECT id FROM app_role WHERE lower(nome) = 'administrador')
 WHERE role_id IS NULL;

ALTER TABLE app_user ALTER COLUMN role_id SET NOT NULL;
