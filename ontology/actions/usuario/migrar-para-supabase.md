---
name: migrarUsuarioParaSupabase
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/jobs/migrate-users-to-supabase.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/migrations/0044_app_user_auth_link.sql
last_review: 2026-08-06
preconditions:
  - "app_user com auth_user_id IS NULL"
  - "password_hash presente"
postconditions:
  - "usuário existe no GoTrue COM O MESMO hash bcrypt"
  - "auth_user_id gravado na linha local"
side_effects:
  - "escrita na Admin API do GoTrue (ou INSERT direto em auth.users, se a versão instalada não aceitar password_hash)"
---

# Ação — `migrarUsuarioParaSupabase` (job one-shot, Fase 1)

> **Ação transitória.** Nasce com data de morte: some na **Fase 4** do cutover, junto de
> `password_hash` e do HS256. Vigência **2026-08-06 → Fase 4**. Ver ADR-0030 §6.

## Regra — a senha atual continua valendo

O usuário é criado no GoTrue **reaproveitando o hash bcrypt existente** (o GoTrue também usa bcrypt).
**É isto que evita o lockout geral no cutover** — ninguém precisa trocar de senha para continuar
trabalhando.

Se o Admin API da versão instalada não aceitar `password_hash`, o fallback é **INSERT direto em
`auth.users`** — somos donos do Postgres.

**Rede de segurança:** o reset por e-mail, caso o import do hash falhe **silenciosamente** (o modo de
falha mais provável: o hash é aceito mas não confere, e ninguém descobre até o primeiro login). Daí a
regra operacional: **validar numa conta de teste antes de rodar em todo mundo**.

## Regra — idempotente por construção

O filtro **é** a condição de idempotência: `auth_user_id IS NULL`. Uma linha já migrada não é
selecionada. Re-rodar o job é seguro por desenho, não por verificação adicional.

**Dry-run por padrão.**

## Regra — o job só preenche o ponteiro

**Nunca** desativa, **nunca** muda `role`, **nunca** toca `username`. Só grava `auth_user_id`.

Isso importa por dois motivos:
- `username` é imutável (I-Usuario-2) e é o ator da trilha (I-Usuario-1) — um job que o "normalizasse"
  partiria a auditoria de três frentes;
- o job faz **UPDATE**, não INSERT, portanto **não é afetado** pelo default `'admin'` da migration
  `0007` (ver ADR-0030 §9).

## Relação com o gate de cutover

Enquanto existir `app_user` com `auth_user_id IS NULL`, a Fase 3 (`AUTH_LEGACY_LOGIN_ENABLED=false`)
**não pode acontecer**: esse usuário ficaria **sem nenhum caminho de login**. `listPendingMigration()`
retornando vazio é o **gate operacional** da transição de fase — não um relatório. ADR-0030 §6.

## Estado `pendenteMigracao`

A condição `authUserId IS NULL` é **ortogonal** ao ciclo de vida (`convidado`/`ativo`/`inativo`): em
2026-08-06 **todo** `app_user` de produção é `ativo` **e** pendente ao mesmo tempo. Ver
`entities/usuario.md` §"Condição ortogonal".
