---
name: supabase-auth
type: integration
direction: read-write (verificação de token por JWKS + Admin API para gestão de credencial)
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/http/auth.ts
  - src/backend/http/authEnv.ts
  - src/backend/http/appUserContext.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/jobs/migrate-users-to-supabase.ts
  - src/frontend/lib/supabase/client.ts
  - src/frontend/lib/supabase/server.ts
  - src/frontend/lib/supabase/middleware.ts
  - src/frontend/middleware.ts
last_review: 2026-08-06
---

# Integração — Supabase Auth (GoTrue) como provedor de identidade

> **Novo integrante** (ADR-0030). Custodia a credencial, emite e rotaciona tokens, e envia os e-mails de
> convite e recuperação. **Não** decide autorização — isso é `app_user` (ver
> `business-rules/autorizacao-resolvida-do-banco.md`).

## Papel de cada lado

| Sistema | Papel | Muda contrato? |
|---|---|---|
| **Supabase GoTrue** | Custódia de credencial, emissão/rotação de token, e-mail de convite e recuperação | **Sim — integração nova** |
| **Supabase Postgres** | Já é o nosso banco (`app_user`) | Não. **Nota:** é o **mesmo projeto** que emite os tokens — é o que torna o fail-closed necessário |
| **Conexos** | Consumidor **a jusante** da identidade (a baixa `fin010` sai no nome do humano) | **Não** — e preservar isso é o objetivo de I-Usuario-1 |
| **Nexxera / GED / SharePoint** | Não tocados | Não |

## A cadeia que não pode quebrar

```
GoTrue ──JWT ES256 (sub=uuid, aud=authenticated, iss)──▶ buildAuthMiddleware      [IDENTIDADE]
                                                                │
                          app_user WHERE auth_user_id = sub AND ativo             [AUTORIZAÇÃO]
                                                                │ → username, role, appUserId
                                                                ▼
                          conexosIdentityMiddleware → ALS { platformUsername: username }
                                                                ▼
                          ConexosSessionResolver → getVinculoConexos(username) → sessão do ERP
                                                                ▼
                                          baixa fin010 assinada com o login do humano
```

### ⚠️ Modo de falha desta cadeia: ela **não lança erro**

Se `platformUsername` deixar de casar com `app_user.username`, `getVinculoConexos` retorna `null` e o
sistema **degrada para o usuário-robô**. As baixas **continuam saindo** — atribuídas à máquina. Sem
exceção, sem log de erro, sem alarme.

É por isso que:
- **`GET /me/conexos-status`** respondendo `ok` / `ausente` **como antes da migração** é o sinal de QA
  que importa (mais do que qualquer teste unitário);
- chavear o ALS por **`username`** (e não por `sub`) é a decisão de **menor raio**: `ConexosSessionResolver`
  e `UserRepository.getVinculoConexos` ficam **literalmente intocados**.

## Contrato de token — o que exigir **por caminho**

O verificador alg-aware já existe (`http/auth.ts:140-175`) e é código pronto, apenas nunca exercitado
em produção. A regra da migração:

| Caminho | `algorithms` | `issuer` | `audience` |
|---|---|---|---|
| **Supabase (novo)** | ES256, chave via `createRemoteJWKSet` | **EXIGIDO** (`${SUPABASE_URL}/auth/v1`) | `authenticated` |
| **Legado (rollout)** | HS256, segredo compartilhado | **NÃO exigido** | `authenticated` |

### ⚠️ A armadilha do `issuer` — regressão nomeada

Hoje `baseOptions` (`http/auth.ts:133-136`) **inclui `issuer`** e é espalhado nos **dois** verificadores.
No instante em que `SUPABASE_URL` for definido, o `issuer` passa a ser exigido **também do token
legado** — que **nunca teve claim `iss`** (`AuthService.ts:71-77` nunca chama `.setIssuer()`).

**Ligar o Supabase derrubaria todas as sessões vivas de uma só vez.** As opções de verificação devem ser
**separadas por caminho**. Isto merece um **teste de regressão nomeado**, não um cuidado no código.

`audience: 'authenticated'` continua exigido nos **dois** caminhos: as chaves `anon` e `service_role`
usam outras audiences e não podem passar por rota de usuário.

## Superfície da Admin API

`SupabaseAdminClient` (`@singleton() @injectable()`, service-role key via `EnvironmentProvider`):
`inviteByEmail`, `createUser`, `updateUserById`, `setBanned`, `deleteUser`.

`deleteUser` é usado **exclusivamente** como compensação transacional do cadastro (I-Usuario-3) e
**não é exposto em rota**.

## Segredos

`SUPABASE_SERVICE_ROLE_KEY` vive **só no backend**, **nunca** como `NEXT_PUBLIC_*` — ela **ignora RLS**
e pode criar usuários. `redactBody` (`http/redact.ts`) deve cobrir `service_role`. Ver ADR-0011 §2
(estendida pela ADR-0030 §4).

## Pré-requisitos humanos (fora do código)

Registrados na **ADR-0030 §"Passos humanos"**. Os dois que mudam o comportamento do domínio:

1. **Signup público desligado** — sem isso, qualquer pessoa obtém um JWT válido do projeto. O 403
   fail-closed é a segunda camada, não a primeira.
2. **SMTP customizado** — pré-requisito **apenas do caminho de convite** (`convidarUsuario`) e do reset
   de senha. O fallback `cadastrarUsuarioComSenha` funciona sem ele, e é isso que impede a ausência de
   SMTP de bloquear duramente a operação.

## Achado pré-existente registrado aqui (não causado por esta feature)

**`CONEXOS_CRED_ENC_KEY` está ausente do `render.yaml`.** Sem ela, `SecretCipher` fica desabilitado, o
vínculo Conexos por usuário **não funciona em produção** e **tudo já cai no usuário-robô hoje** — ou
seja, **I-Usuario-5 e boa parte da cadeia acima estão inertes em produção neste momento**. Provisionar
junto das variáveis novas. Ver `_inbox/supabase-auth-regis-followups.md`.

## Variação por tenant

Nenhuma. Tenant único (Columbia), sem `infra/`. Parâmetros por ambiente (Render/Vercel), não SSM.
A costura multi-tenant do estado-alvo não é exercitada nesta feature.

## Costura para o SSO corporativo (fora de escopo, deliberadamente pronta)

Identidade por JWKS **+** autorização por `app_user` significa que ligar um provider Azure AD no
Supabase **não muda uma linha do backend**: o `sub` muda de origem, e a trilha de auditoria continua
ancorada no `username` (I-Usuario-1). É o retorno concreto de ter separado as duas camadas.
