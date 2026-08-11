---
name: convidarUsuario
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/routes/usuarios.ts
last_review: 2026-08-06
preconditions:
  - "ator com role = 'admin'"
  - "username é e-mail válido"
  - "não existe em app_user NEM em auth.users"
  - "SMTP configurado no projeto Supabase"
postconditions:
  - "usuário existe no GoTrue com convite pendente"
  - "linha app_user com auth_user_id preenchido, ativo = false, role default 'operador', created_by = username do ator"
  - "estado = convidado"
side_effects:
  - "e-mail de convite enviado pelo GoTrue"
---

# Ação — `convidarUsuario` (transição U1)

**Caminho padrão de entrada de um novo usuário.** O titular define a própria senha; nenhum humano além
dele a conhece — o que é o que sustenta atribuir uma baixa `fin010` a uma pessoa (ver
`redefinir-senha.md`).

## Regra — atomicidade entre sistemas

**As duas pontas nascem juntas ou nenhuma nasce.** O passo 2 (linha local) falhando **obriga** a
compensação do passo 1 (remover do GoTrue).

Sem a compensação fica um **órfão no GoTrue**: ele consegue um JWT válido, é barrado pelo 403
fail-closed (I-Usuario-9) — mas o **e-mail fica queimado** para um cadastro futuro, porque
`auth.users.email` é único. O sintoma aparece semanas depois, como "não consigo cadastrar essa pessoa",
sem nenhum rastro da causa.

**Esta é a única situação em que `deleteUser` no GoTrue é permitido** (I-Usuario-3). Ele não é exposto
em rota.

## Regra — least privilege

O usuário nasce com `role = 'operador'`. Promover a `admin` é ato explícito e separado.

## Dependência dura de SMTP

Esta ação **não funciona sem SMTP**. É por isso que existe o fallback `cadastrarUsuarioComSenha` — o
convite é o caminho **preferencial**, não o único, e a operação nunca fica duramente bloqueada.

## Idempotência

**Não.** Re-executar com o mesmo e-mail deve responder **409**, nunca criar duplicata.

## Atribuição

`created_by` = `username` do ator (I-Usuario-7). É hoje a **única** mudança de estado de `Usuario` que
já registra o autor.
