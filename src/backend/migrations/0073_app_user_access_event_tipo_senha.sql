-- 0073 — a trilha de acesso ganha o tipo `senha` (feature `auth-senha-propria`, ADR-0059).
--
-- A troca da própria senha (`POST /me/senha`) grava uma linha em `app_user_access_event` com
-- `tipo = 'senha'`, `ator` = o próprio username e `antes`/`depois` NULL, na mesma transação da
-- escrita do hash. A CHECK inline da 0066 recebeu do Postgres o nome automático
-- `app_user_access_event_tipo_check`; trocamos pela lista ampliada, no padrão da 0069.
--
-- Aditiva e segura para o backend antigo: ele continua inserindo só `papel`, `excecao` e `ativo`,
-- todos aceitos pela lista nova, então um cron pode aplicar esta migration antes de o backend novo
-- subir. Idempotente: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`.
--
-- Sem reverse (decisão S1 do scoping): voltar à lista estreita falharia assim que existisse uma
-- linha `senha`, e apagar linhas da trilha append-only não se faz. Um rollback de código deixa a
-- CHECK ampliada no lugar, sem efeito para o código antigo.

ALTER TABLE app_user_access_event
    DROP CONSTRAINT IF EXISTS app_user_access_event_tipo_check;

ALTER TABLE app_user_access_event
    ADD CONSTRAINT app_user_access_event_tipo_check
    CHECK (tipo IN ('papel', 'excecao', 'ativo', 'senha'));
