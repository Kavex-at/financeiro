---
name: desativarUsuario
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/http/appUserContext.ts
  - src/backend/routes/usuarios.ts
last_review: 2026-08-06
preconditions:
  - "ator com role = 'admin'"
  - "usuário alvo existe"
  - "alvo != ator (I-Usuario-6 — autodesativação proibida)"
postconditions:
  - "app_user.ativo = false"
  - "usuário banido no GoTrue (ou sucesso parcial auditado, se o ban falhar)"
  - "cache de contexto invalidado"
  - "estado = inativo"
side_effects:
  - "chamada à Admin API do GoTrue (setBanned)"
---

# Ações — `desativarUsuario` (U4) e `ativarUsuario` (U5)

Cobre as duas transições porque são inversas exatas e compartilham as mesmas regras.
Chaves de ação: **`desativarUsuario`**, **`ativarUsuario`**.

## `desativarUsuario` — regra: defesa em profundidade, e a **ordem importa**

| # | Passo | O que impede | Latência |
|---|---|---|---|
| 1 | `app_user.ativo = false` + invalidação do cache | qualquer request autenticada, **inclusive leitura** (I-Usuario-4) | ≤ 30 s |
| 2 | ban no GoTrue (`setBanned`) | **renovar** o refresh token / abrir sessão nova | imediata |

- **Falha no passo 1 ⇒ aborta tudo.** Não existe desativação que só bane no GoTrue: é o passo 1 que o
  fail-closed enforça a cada request.
- **Falha no passo 2 ⇒ sucesso PARCIAL auditado**, não erro duro. O `ativo = false` local **já revoga**;
  retornar erro levaria o admin a acreditar que **não desativou ninguém**, quando na prática desativou —
  e ele tentaria de novo, ou pior, assumiria que a pessoa ainda tem acesso e agiria por fora. A resposta
  deve **sinalizar a degradação** para a UI (o que se perdeu é a barreira contra a renovação da sessão,
  não a revogação).

## `desativarUsuario` — regra: autodesativação proibida (I-Usuario-6)

Alvo == ator ⇒ **403 com mensagem explícita**. Desativar **outro** admin **é permitido**.

Guarda mínima e barata contra a perda de acesso à gestão de usuários. A guarda completa ("não pode
restar zero admin ativo") exige `COUNT` transacional e está na watchlist — e note que a ADR-0030
**encarece o escape hatch** ao remover o default hardcoded `'columbia2026'` do `seed-admin`.

## `ativarUsuario` — regra: o vínculo Conexos é preservado, não recriado

Durante a desativação as colunas `conexos_username` / `conexos_password_enc` **não são limpas**, porque
`getVinculoConexos` já filtra `AND ativo = true` (`UserRepository.ts:163`): o vínculo fica **inerte, não
perdido** (I-Usuario-5).

Consequência prática: **reativar não exige redigitar a senha do ERP**. Limpar as colunas transformaria
uma desativação temporária (férias, afastamento) num retrabalho de ops — e, pior, num incentivo a não
desativar.

## Idempotência

**Sim, nas duas.** Desativar duas vezes = desativado.

## Atribuição — gap declarado

**`PATCH /:id/ativo` não registra hoje quem fez.** `routes/usuarios.ts:29` computa `ator(req)` e o usa
**exclusivamente** no `create`. Numa plataforma cujo princípio declarado é *"toda ação de sistema e de
usuário é auditada"*, a desativação de um usuário é hoje uma das ações **menos** auditadas do sistema.
I-Usuario-7 assevera a regra; o fechamento é follow-up **nomeado**
(`_inbox/supabase-auth-regis-followups.md`).
