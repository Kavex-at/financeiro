---
name: ator-da-trilha-de-auditoria
type: business-rule
invariant: I-Usuario-1
entity: Usuario
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/http/appUserContext.ts
  - src/backend/http/conexosIdentity.ts
  - src/backend/routes/permutas.ts
  - src/backend/routes/recebimentos.ts
  - src/backend/routes/sispag.ts
  - src/backend/routes/usuarios.ts
  - src/backend/routes/me.ts
  - src/frontend/app/permutas/BorderosPanel.tsx
last_review: 2026-08-06
---

# Business Rule — O ator da trilha de auditoria é o e-mail, nunca o `sub` (I-Usuario-1)

> **A invariante de maior raio desta feature.** Ver `entities/usuario.md` e ADR-0030 §5.

## A regra

O ator persistido em qualquer coluna de auditoria é **`app_user.username`** (o e-mail), resolvido do
banco por `resolverContextoUsuario`. O **`sub` do provedor de identidade nunca é persistido como ator,
nem exibido**. O `authUserId` (UUID) é **chave interna de junção** e nada mais.

## Por que a regra é sobre o e-mail e não sobre "o identificador estável"

Porque o identificador estável **muda de provedor**. O `sub` de hoje é do GoTrue; o `sub` de amanhã é do
SSO corporativo (Azure AD), quando ele entrar. Ancorar a trilha no `sub` significa **parti-la de novo a
cada troca de IdP** — e cada partição é irreversível, porque não há coluna que diga qual formato é qual.

O e-mail é o único identificador que **atravessa** provedores de identidade. É por isso que a regra está
na ontologia, e não apenas no código: ela é a razão pela qual a trilha continua legível daqui a três
sistemas de login.

## O `??` não protege — é o ponto que engana

Todos os call sites hoje seguem o padrão:

```ts
const executadoPor = req.user?.sub ?? req.user?.email ?? 'unknown';
```

Lido rápido, parece defensivo. **Não é.** Quando `sub` deixar de ser o e-mail e passar a ser um UUID,
ele continua **presente** — só que como UUID — e **vence o `??`**. O fallback nunca é alcançado. A
mudança é **100% silenciosa**: nenhum erro, nenhum log, nenhum teste vermelho.

## Superfície exata — 21 call sites (verificado 2026-08-06)

| Arquivo | Sites | Variáveis alimentadas | Colunas persistidas |
|---|---|---|---|
| `routes/permutas.ts` | **13** | `triggeredBy`, `criadoPor`, `processadoPor`, `executadoPor` | `executado_por`, `criado_por` |
| `routes/recebimentos.ts` | **4** | `ator`, `triggeredBy` | `executado_por` |
| `routes/sispag.ts:65` | 1 | `ator(req)` | `criado_por` |
| `routes/usuarios.ts:29` | 1 | `ator(req)` | `created_by` |
| `routes/me.ts:24` | 1 | `username` | — (leitura) |
| `http/conexosIdentity.ts:14` | 1 | `platformUsername` (ALS) | — (identidade no ERP) |

**Nuance verificada:** 19 dos 21 são `sub ?? email` (o UUID venceria); **2** — `recebimentos.ts:644` e
`:842`, ambos `triggeredBy` — são `email ?? sub` e sobreviveriam **por acidente da ordem**. Os 21 vão
para `username` mesmo assim: deixar duas doutrinas no mesmo arquivo garante que a próxima pessoa copie
a errada.

## Consequências verificadas se a regra for violada — todas silenciosas

- **`BorderoGestaoService.ts:340`** grava `criadoPor` do borderô; **`frontend/app/permutas/BorderosPanel.tsx:460`**
  o renderiza **cru** na tabela — o analista passaria a ver um UUID no lugar do nome do colega.
- **`BorderosPanel.tsx:166`** monta o **dropdown "filtrar por usuário"** a partir desses mesmos valores.
  A mesma pessoa apareceria como **duas entradas** (o e-mail antigo e o UUID novo), e o filtro histórico
  **deixaria de encontrar o trabalho dela**.
- Toda consulta de auditoria passaria a exigir um `JOIN` que hoje ninguém faz, contra linhas pré e
  pós-cutover em **formatos diferentes** e **sem coluna que diga qual é qual**.

## Por que a troca é barata agora e cara depois

Trocar os 21 sites para `username` mantém os valores gravados **idênticos aos que já estão no banco** —
o `sub` do token legado **já é** o e-mail. Logo: **sem migração de dados, sem histórico misto, sem
janela de manutenção.**

Depois do cutover, a mesma correção exigiria mapear UUIDs de volta para pessoas — e isso é
**irrecuperável** se um usuário for renomeado ou recriado no provedor no meio do caminho.

## Corolário — `DEV_AUTH_BYPASS`

O usuário sintético injetado sob `DEV_AUTH_BYPASS` **vai vazar para `executado_por`** por esta mesma
regra. Portanto seu `username` precisa ser **inconfundível e impossível de colidir com um real** — por
exemplo `dev-bypass@local`.

**Um bypass que grava um e-mail plausível é pior do que um que grava lixo óbvio:** o lixo óbvio é
detectado na primeira leitura da trilha; o plausível é atribuído a uma pessoa de verdade.

(O fail-fast que impede `DEV_AUTH_BYPASS` fora de local/dev já existe em `http/authEnv.ts:93-101`, é
deny-by-default, e deve ser **preservado**.)

## Onde a regra é enforçada

`resolverContextoUsuario` (`http/appUserContext.ts`) popula `req.user.username` **a partir do banco**.
Todos os 21 sites leem daí. A cadeia a jusante — `conexosIdentityMiddleware` → ALS →
`ConexosSessionResolver` → `getVinculoConexos(username)` — fica **literalmente intocada**, e é por isso
que chavear o ALS por `username` (e não por `sub`) é a decisão de **menor raio** possível.
