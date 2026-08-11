---
name: resolverContextoUsuario
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/http/appUserContext.ts
  - src/backend/http/auth.ts
  - src/backend/domain/repository/auth/UserRepository.ts
last_review: 2026-08-06
preconditions:
  - "JWT verificado — buildAuthMiddleware já populou req.user.sub"
postconditions:
  - "req.user carrega appUserId, username e role VINDOS DO BANCO"
  - "OU a request morreu em 403"
side_effects:
  - "leitura do cache de contexto (TTL 30 s) ou SELECT em app_user"
---

# Ação — `resolverContextoUsuario`

> **A ação silenciosa mais importante desta feature.** Não tem rota, não tem botão, não aparece na UI —
> e toda request autenticada da plataforma passa por ela.

## Regra

```sql
SELECT id, username, role, ativo FROM app_user WHERE auth_user_id = $sub
```

| Resultado | Resposta |
|---|---|
| linha encontrada, `ativo = true` | segue — `req.user.role` **sobrescrito** por `app_user.role` |
| **sem linha** | **403** |
| linha com `ativo = false` | **403** |

**Nunca 401 nesses dois casos.** A identidade é legítima; o que falta é autorização. A distinção é
operacional: **401 manda o frontend tentar o refresh**, 403 não. Trocar um pelo outro produz um loop de
refresh contra um provedor que está respondendo corretamente.

Ver `business-rules/autorizacao-resolvida-do-banco.md` (I-Usuario-9).

## Por que roda a cada request, e não só no login

Porque é isso que faz a **revogação valer**. Autenticar no GoTrue não é autenticar na plataforma: as
duas condições (credencial válida **e** `app_user` ativo) são **conjuntivas**, e a segunda é reavaliada
continuamente. Ver `business-rules/revogacao-de-acesso.md` (I-Usuario-8).

## Cache

Chaveado por `auth_user_id`, **TTL 30 s como constante tipada**, invalidado **sincronicamente** por
`setAtivo`. A latência de revogação resultante (≤ TTL) e a **restrição datada de instância única do
Render** estão em `business-rules/revogacao-de-acesso.md`.

## Idempotente

**Sim** — é leitura pura.

## Efeito colateral desejado: `username` na trilha

Esta ação é a **fonte única** de `req.user.username`, do qual dependem os 21 call sites de auditoria
(I-Usuario-1) e o `platformUsername` do ALS que alimenta a identidade Conexos. Ver
`business-rules/ator-da-trilha-de-auditoria.md`.

## `DEV_AUTH_BYPASS`

Sob bypass, injeta um **usuário sintético de dev** com `username` inconfundível (ex.:
`dev-bypass@local`) — porque ele **vai vazar para `executado_por`**.

Correção de passagem prevista: hoje o bypass deixa `req.user` **indefinido**, e portanto **toda mutação
responde 401 em dev** (`auth.ts:127-129` + `auth.ts:209-212`). O fail-fast que impede o bypass fora de
local/dev (`authEnv.ts:93-101`) é deny-by-default e deve ser **preservado**.
