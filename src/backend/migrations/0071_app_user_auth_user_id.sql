-- 0071 — `app_user.auth_user_id` + limpeza de grants do `public`: passo 3 de 3 do plano de auth
-- (ADR-0057, Supabase Auth no mesmo projeto do banco).
--
-- 1) `auth_user_id`: o `id` do usuário correspondente no Supabase Auth (GoTrue). Preenchido pelo
--    job `sync-supabase-auth` e por toda criação posterior; nenhuma tela o edita. Aditiva e
--    anulável, sem backfill: o backend antigo (≤ v0.44) a ignora, e um cron pode aplicar esta
--    migration antes de o backend novo subir. `username` continua sendo a identidade de auditoria.
--
-- 2) Higiene de grants (verificação do Q1, 2026-09-29): `anon`/`authenticated` não têm SELECT nas
--    tabelas do `public` (RLS ligada, 0 políticas), mas têm TRUNCATE, REFERENCES e TRIGGER, herdados
--    do default privilege do role `postgres`. O PostgREST não emite TRUNCATE, então não é alcançável
--    pela Data API — mas não deveria existir. Revoga das tabelas atuais e do default das futuras.
--    Só roda onde os roles existem (D8): no Postgres puro do QA e do `test:sql` eles não existem, e a
--    migration não pode falhar lá.
--
-- Sem reverse (D9): a coluna é aditiva e os grants revogados não devem voltar. Idempotente.

ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL;

-- Uma pessoa, uma linha (I3): dois `app_user` nunca apontam para o mesmo usuário do GoTrue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_auth_user_id
    ON app_user (auth_user_id)
    WHERE auth_user_id IS NOT NULL;

DO $$
DECLARE
    tabela TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN

        -- Nomes vindos do catálogo, citados com %I: nenhum valor externo entra no texto.
        FOR tabela IN
            SELECT tablename
              FROM pg_tables
             WHERE schemaname = 'public'
        LOOP
            EXECUTE format(
                'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, authenticated',
                tabela
            );
        END LOOP;

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
                REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
        END IF;
    END IF;
END
$$;
