---
name: autorizacao-resolvida-do-banco
type: business-rule
invariant: I-Usuario-9
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
amends: ADR-0011
---

# Business Rule — O token prova identidade; a autorização vem do banco (I-Usuario-9)

> **Amenda a ADR-0011 §1**, cujo texto diz literalmente *"Fonte do role: o `role` já vem no JWT"*.
> O gate `requireRole('admin')` **não muda**; muda a **origem** de `req.user.role`. Ver ADR-0030.

## A regra

**O JWT prova *identidade*. A *autorização* é resolvida do banco a cada request.**

| Pergunta | Quem responde | Como |
|---|---|---|
| *Quem é?* | GoTrue | JWT ES256 verificado por JWKS; `sub` = UUID |
| *O que pode?* | `app_user` | `SELECT role, ativo, username FROM app_user WHERE auth_user_id = $sub` |

A claim `role` do JWT do GoTrue é **sempre `'authenticated'`** (é o role do Postgres, não um papel de
negócio) e é **descartada**. `req.user.role` passa a ser **sobrescrito** por `app_user.role`.

## Fail-closed — as duas negativas

| Situação | Resposta | Por quê |
|---|---|---|
| JWT válido, **sem** linha em `app_user` | **403** | Identidade legítima, **sem** autorização. Existir no GoTrue não é existir na plataforma. |
| JWT válido, linha com `ativo = false` | **403** | I-Usuario-4 — inativo não opera em lugar nenhum, nem leitura. |
| Sem JWT / JWT inválido | 401 | Aí sim falta **identidade**. |

**Nunca 401 nos dois primeiros casos.** A distinção não é cosmética: **401 manda o frontend tentar o
refresh**; 403 não. Trocar um pelo outro produz um loop de refresh contra um provedor que está
respondendo corretamente — e esconde do diagnóstico que o problema é de autorização, não de sessão.

## Por que fail-closed é necessário aqui, e não paranoia

**O mesmo projeto Supabase hospeda o nosso Postgres e emite os tokens.** Se o signup público estiver
ligado, **qualquer pessoa na internet** obtém um token válido com `aud: 'authenticated'` assinado pelo
projeto — e esse token passa na verificação de identidade.

Desligar o signup público é a **primeira** camada (passo humano, fora do repositório). Este 403 é a
**segunda** — e é a **única que vive no código**, portanto a única que sobrevive a alguém religar o
signup por engano num painel.

## Por que não um Custom Access Token Hook

As quatro razões estão registradas na **ADR-0030 §3**. Em resumo: (1) fecha o achado da claim `filiais`
sem depender de hook configurado fora do repo; (2) `ativo = false` revoga **na hora**; (3) fail-closed
por construção; (4) o `role` do JWT Supabase **quebraria** `requireRole('admin')`.

Colocar a decisão de autorização numa claim customizada a moveria para um **artefato configurado fora
deste repositório** — invisível ao code review, ao teste e ao Regis-Review.

## Blast radius

**Total.** 30+ rotas de mutação em permutas, SISPAG, recebimentos e usuários passam por
`requireRole('admin')` (`http/auth.ts:205-222`). Sem esta regra, a claim `'authenticated'` do GoTrue
**barraria todo mundo** no dia do cutover.

## Custo aceito

Um `SELECT` por request, mitigado por cache TTL curto — cujo preço em latência de revogação está
declarado em `business-rules/revogacao-de-acesso.md` (I-Usuario-8), **incluindo** a restrição de
instância única do Render.

## Consequência para features futuras

Toda rota nova de mutação continua declarando `requireRole('admin')` explicitamente (não há gate global
por verbo — ADR-0011 §"Consequências"). O que muda é que o `role` agora é **confiável e revogável**, o
que torna barato introduzir um terceiro papel sem tocar em nada do provedor de identidade.
