---
name: revogacao-de-acesso
type: business-rule
invariant: I-Usuario-8
entity: Usuario
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/http/appUserContext.ts
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
last_review: 2026-08-06
---

# Business Rule — Revogação de acesso tem latência **declarada** (I-Usuario-8)

> **Esta regra existe no lugar de uma entidade `Sessao`.** Depois da migração para o GoTrue, a sessão
> (access token de vida curta, refresh rotativo, revogação) é **inteiramente propriedade do provedor de
> identidade**: zero linhas no nosso banco, zero invariantes que possamos enforcar, nenhuma ação de
> domínio que a manipule. Modelá-la criaria uma entidade vazia. O que **é** de domínio na sessão é um
> **comportamento do `Usuario`** — e é este documento. Ver ADR-0030 e `entities/usuario.md`.

## A regra

`desativarUsuario` produz efeito em **≤ 30 segundos**, **não instantaneamente**.

A latência é **declarada**, não escondida atrás da palavra "imediata". O número é uma **constante
tipada** (`APP_USER_CONTEXT_TTL_MS = 30_000`) — **não uma variável de ambiente**: um número de segurança
que se muda por deploy é um número que se muda **sem revisão**.

O custo que o TTL paga: a autorização é resolvida do banco a **cada request** (I-Usuario-9), o que
significa um `SELECT` por request. O cache de 30 s por `auth_user_id` é o que torna esse desenho
sustentável — e a latência de revogação é o preço explícito dele.

## Duas condições para o número valer

1. **O cache é invalidado sincronicamente** por `setAtivo`, no processo que atende a request de
   desativação.
2. **A invalidação é local ao processo.**

## ⚠️ Restrição datada (2026-08-06) — a premissa que envelhece em silêncio

A condição 2 só é **suficiente** porque o backend roda em **Render `plan: starter` — instância única**
(`render.yaml:10`).

**No dia em que houver mais de uma instância, a invalidação deixa de cruzar processos e a latência real
de revogação vira o TTL cheio — sem erro, sem log, sem alarme.** Um admin desativaria um usuário, veria
sucesso na UI, e o usuário continuaria operando em outra instância até o TTL expirar. Nada no sistema
sinalizaria a diferença.

Escalar horizontalmente **exige** revisitar esta regra: invalidação distribuída (pub/sub, Redis) ou TTL
menor com custo de leitura maior. Registrado aqui, e não no código, porque é o tipo de premissa que
sobrevive a quem a escreveu.

## Por que ≤30 s é aceitável para "acesso revogado"

Porque a **segunda barreira** existe: o **ban no GoTrue** impede **renovar** a sessão. A janela de TTL
permite **terminar requests em voo**, não **iniciar uma sessão nova**.

A defesa em profundidade, na ordem em que importa:

| # | Barreira | O que impede | Latência |
|---|----------|--------------|----------|
| 1 | `ativo = false` local | qualquer request autenticada — **inclusive leitura** (I-Usuario-4) | ≤ TTL (30 s) |
| 2 | ban no GoTrue | renovar o refresh token / abrir sessão nova | imediata |

**Se a barreira 2 falhar** (indisponibilidade do GoTrue), a desativação local **permanece válida** e a
operação retorna **sucesso parcial auditado** — a barreira 1 continua valendo com a mesma janela ≤ TTL;
o que se perde é a garantia contra a renovação da sessão. Degradar para "não desativou nada" seria
**pior**: levaria o admin a crer que o acesso segue aberto quando na prática já foi revogado localmente.

**Se a barreira 1 falhar**, a operação **aborta inteira** — não existe desativação que só banca no
GoTrue, porque é a barreira 1 que o fail-closed enforça a cada request.

## O que esta regra NÃO cobre

- **Expiração natural do token** — é política do GoTrue (TTL do access token, rotação do refresh com
  reuse detection), configurada fora do repositório. Não é invariante que possamos enforcar.
- **Logout** — `supabase.auth.signOut()` revoga do lado do provedor. É ação do titular, não revogação
  administrativa.
