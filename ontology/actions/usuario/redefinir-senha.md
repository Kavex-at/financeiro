---
name: solicitarRedefinicaoSenha
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/routes/usuarios.ts
  - src/frontend/app/auth/forgot-password/page.tsx
  - src/frontend/app/auth/reset-password/page.tsx
last_review: 2026-08-06
preconditions:
  - "solicitar: um e-mail é informado — NÃO exige autenticação"
  - "redefinirSenhaDeTerceiro: ator com role = 'admin'"
  - "SMTP configurado (dependência dura das duas)"
postconditions:
  - "se — e somente se — houver app_user ATIVO com aquele username, o GoTrue dispara o link"
  - "a senha muda no GoTrue; app_user.password_hash NÃO é escrito"
side_effects:
  - "e-mail de recuperação enviado pelo GoTrue"
---

# Ações — `solicitarRedefinicaoSenha` (self-service) e `redefinirSenhaDeTerceiro` (admin)

Chaves de ação: **`solicitarRedefinicaoSenha`**, **`redefinirSenhaDeTerceiro`**.
A conclusão do fluxo (`redefinirSenha`, com o token de recuperação) acontece **inteiramente no GoTrue**.

## Regra — anti-enumeração de usuários

**A resposta HTTP é idêntica existindo ou não o usuário.**

Um endpoint **público** que diferencia *"e-mail não cadastrado"* de *"enviamos o link"* entrega a
**lista de funcionários da Columbia** a qualquer pessoa na internet, um e-mail por vez. Isso não é
teórico: é a primeira coisa que um scanner automatizado tenta contra um formulário de recuperação.

## Regra — usuário inativo **não** recebe link

Reset de senha **não pode ser porta dos fundos para reativação**. Um usuário desligado que ainda tem o
e-mail corporativo ativo não pode recuperar acesso por um fluxo que não passa por um admin.

(A resposta ao solicitante continua idêntica — a diferença é invisível de fora, por causa da regra
anterior.)

## Regra — a custódia da credencial saiu do nosso banco

A senha muda **no GoTrue**. **`app_user.password_hash` não é escrito** — ele está `deprecated` e
sobrevive apenas como fonte do import bcrypt até a Fase 4.

## `redefinirSenhaDeTerceiro` — muda de natureza, não só de implementação

| Hoje | Depois |
|---|---|
| O admin **grava um hash** (`POST /usuarios/:id/reset-senha`) e passa a senha para a pessoa **por fora** (WhatsApp, presencialmente, e-mail) | O admin **dispara um link de recuperação**; a senha nova nasce e morre entre o titular e o GoTrue |

**Isto não é cosmético.** É o que permite atribuir uma baixa `fin010` a uma pessoa **e sustentar a
atribuição**: depois desta feature, **nenhum humano além do titular conhece a senha de outro**. Sem
isso, "foi a Marilyn que baixou" é uma afirmação que qualquer admin pode contestar — e com razão.

## Dependência dura de SMTP

**Esta é a segunda razão (além do self-service) pela qual SMTP é bloqueante para produção.** Sem SMTP,
`redefinirSenhaDeTerceiro` **deixa de funcionar** — e, diferente do cadastro, aqui **não há fallback**:
gravar hash de novo reintroduziria exatamente o problema que a mudança resolve.

## Idempotência

- `solicitarRedefinicaoSenha`: **seguro repetir** (o rate-limit do GoTrue governa).
- `redefinirSenha`: consome o token de recuperação — **uso único**.
