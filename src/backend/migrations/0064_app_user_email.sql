-- 0064 — `app_user.email`: passo 1 de 3 do plano de auth (ADR-0051).
--
-- O Supabase Auth (passo 3) exige e-mail real em todo usuário. Hoje o identificador é
-- `username`, que é e-mail para quase todos e não é para o `admin` do seed. Esta migration só
-- ABRE o espaço para o e-mail; quem o preenche é um admin, pela tela `/usuarios`.
--
-- Sem backfill, de propósito: todos migram para o e-mail da Columbia, então copiar `username`
-- para `email` preencheria valores que seriam trocados e esconderia o progresso da transição
-- (a coluna vazia é o placar). `username` continua sendo a identidade de auditoria (`sub`).
--
-- Só aditiva: nenhum dado existente é reescrito, então não há script de reverse.

-- Guarda: o login passa a casar o identificador SEM distinção de caixa. Dois `username` que só
-- diferem na caixa tornariam o login ambíguo. Medido em produção em 2026-09-28: zero casos. Se
-- aparecer um, a migration para aqui, com o nome do conflito, em vez de seguir em silêncio.
DO $$
DECLARE
    duplicados TEXT;
BEGIN
    SELECT string_agg(chave, ', ')
      INTO duplicados
      FROM (
          SELECT lower(username) AS chave
            FROM app_user
           GROUP BY lower(username)
          HAVING count(*) > 1
      ) d;

    IF duplicados IS NOT NULL THEN
        RAISE EXCEPTION 'Há usuários com o mesmo username sem distinção de maiúsculas: %. Resolva à mão antes de aplicar a 0064.', duplicados;
    END IF;
END $$;

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email TEXT NULL;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email_updated_by TEXT NULL;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email_updated_at TIMESTAMPTZ NULL;

-- Unicidade do e-mail sem distinção de caixa. Parcial: NULL é o estado "pendente" e pode repetir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_email_lower
    ON app_user (lower(email))
    WHERE email IS NOT NULL;

-- Torna a guarda acima permanente e serve ao `WHERE lower(username) = ...` do login.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_username_lower
    ON app_user (lower(username));
