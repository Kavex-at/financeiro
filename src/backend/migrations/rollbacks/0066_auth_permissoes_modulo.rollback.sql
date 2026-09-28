-- Reverse da 0066 (permissões por módulo, ADR-0053, D7).
--
-- QUANDO: só depois de voltar o backend para a v0.43.1. Com `app_user.role_id NOT NULL`, o
-- `POST /usuarios` e o `seed:admin` antigos falham (o INSERT deles não passa `role_id`); com o
-- backend novo no ar, derrubar estas tabelas quebra toda requisição autenticada (503).
--
-- O QUE SE PERDE: a trilha de acesso (`app_user_access_event`) gravada desde o deploy é perdida,
-- junto com as exceções por usuário e os papéis. Se a trilha importar, exporte-a antes:
--   \copy app_user_access_event TO 'trilha-acesso.csv' CSV HEADER
--
-- A coluna `role` não é tocada: a 0066 nunca a alterou, e é ela que o backend antigo lê.
--
-- Depois do reverse, para reaplicar a 0066 mais tarde:
--   DELETE FROM schema_migrations WHERE name = '0066_auth_permissoes_modulo.sql';

BEGIN;

ALTER TABLE app_user DROP COLUMN IF EXISTS role_id;
DROP TABLE IF EXISTS app_user_access_event;
DROP TABLE IF EXISTS user_permission;
DROP TABLE IF EXISTS app_role_permission;
DROP TABLE IF EXISTS app_role;

COMMIT;
