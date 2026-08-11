-- 0044_app_user_auth_link — liga a linha `app_user` ao registro do GoTrue (Supabase Auth)
-- e persiste a distinção "convidado" × "acesso revogado" (ADR-0030).
--
--   - `auth_user_id`: ponteiro para `auth.users.id` — é o `sub` do JWT. Chave INTERNA de
--     junção: NUNCA é exibida nem persistida como ator da trilha de auditoria (I-Usuario-1,
--     o ator é sempre `username`). `NULL` = pendente de migração (condição ORTOGONAL ao
--     ciclo de vida; vigência 2026-08-06 → Fase 4 do cutover — ADR-0030 §6/§8).
--     O índice é UNIQUE (1:1 com `auth.users`) e, no Postgres, um índice único TOLERA
--     múltiplos NULL — o que importa porque HOJE todas as linhas de produção são NULL.
--
--   - `convite_pendente`: discriminador PERSISTIDO de `convidado`. `convidarUsuario` já
--     grava `auth_user_id` na criação (postcondição de actions/usuario/convidar-usuario.md),
--     logo um convidado é byte-idêntico a um usuário DESATIVADO (`auth_user_id NOT NULL` +
--     `ativo = false`). Sem esta coluna, aceitar um convite reativaria silenciosamente um
--     usuário desligado que ainda tem o e-mail corporativo — a mesma porta dos fundos que
--     `actions/usuario/redefinir-senha.md` fecha explicitamente. É SEGURANÇA, não UI.
--     `DEFAULT false` já classifica corretamente todas as linhas de produção (nenhuma foi
--     convidada) — zero migração de dados.
--
-- Derivação do estado (`UsuarioStatus`): `ativo` é lido PRIMEIRO — ele continua sendo a
-- única fonte de autorização, e `convite_pendente` só refina o ramo `false`:
--   ativo = true                             → 'ativo'
--   ativo = false AND convite_pendente       → 'convidado'
--   ativo = false AND NOT convite_pendente   → 'inativo'
--
-- `password_hash` PERMANECE na tabela: é a fonte do import bcrypt até a Fase 4 (ADR-0030 §6).
-- O que muda é só a obrigatoriedade: a custódia da credencial passa a ser do GoTrue, então
-- `convidarUsuario` e `cadastrarUsuarioComSenha` inserem SEM hash local — escrever um hash
-- (mesmo placeholder) reintroduziria a custódia que a ADR-0030 §7 move para fora. A coluna
-- e os hashes existentes ficam intactos; só o NOT NULL sai.
--
-- Idempotente (IF NOT EXISTS / DROP NOT NULL é no-op na segunda aplicação). Nenhum UPDATE de dados.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE app_user ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_auth_user_id_key ON app_user (auth_user_id);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS convite_pendente BOOLEAN NOT NULL DEFAULT false;
