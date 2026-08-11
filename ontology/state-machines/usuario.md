---
name: usuario
type: state-machine
entity: Usuario
ontology_version: "0.16"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/routes/usuarios.ts
last_review: 2026-08-06
states: [convidado, ativo, inativo]
out_of_scope_states: [excluido]
---

# Ciclo de vida — `Usuario`

> Estado **LOCAL** (`app_user.ativo` + presença de convite pendente), não do GoTrue. O GoTrue custodia
> a credencial; o ciclo de vida do **acesso à plataforma** é nosso. Ver `entities/usuario.md` e ADR-0030.

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `convidado` | `convidado` | Convite enviado, senha ainda não definida pelo titular. Linha `app_user` existe, `ativo = false`. **Não opera nada.** Caminho padrão de entrada. |
| `ativo` | `ativo` | Opera conforme seu `role`. Único estado em que o vínculo Conexos é utilizável (I-Usuario-5). |
| `inativo` | `inativo` | Acesso revogado (soft-disable). **403 em toda rota autenticada, incluindo leitura** (I-Usuario-4). Vínculo Conexos **preservado e inerte**, não apagado. |

Tipo: `UsuarioStatus = 'convidado' | 'ativo' | 'inativo'`
(constantes tipadas — nunca strings cruas; princípio P3 da ontologia).

**`excluido` é `out_of_scope` por decisão, não por fatiamento:** hard delete é proibido (I-Usuario-3).

## Diagrama

```
   convidarUsuario (U1)              aceite do convite (U2)
        │                                   │
        ▼                                   ▼
  ┌────────────┐ ────────────────────▶ ┌─────────┐  desativarUsuario (U4)  ┌──────────┐
  │ convidado  │                       │  ATIVO  │ ──────────────────────▶ │ INATIVO  │
  │ ativo=false│                       │         │ ◀────────────────────── │          │
  └────────────┘                       └─────────┘   ativarUsuario (U5)    └──────────┘
   (exige SMTP)                             ▲
                                            │  cadastrarUsuarioComSenha (U3)
                                            │  FALLBACK — nasce ativo, NÃO exige SMTP

   NÃO existe transição para EXCLUIDO — hard delete é proibido (I-Usuario-3)
```

## Transições

Cada transição é uma **ação nomeada com regra explícita** (princípio P3) e registra ator + timestamp
(I-Usuario-7).

| # | De → Para | Ação (gatilho) | Regra | Vigência |
|---|-----------|----------------|-------|----------|
| U1 | `(novo) → convidado` | `convidarUsuario` | **Caminho padrão.** Ator `admin`; `username` é e-mail válido e não existe nem em `app_user` nem em `auth.users`. Linha nasce `ativo = false`, `role` default `'operador'`, `created_by` = ator. **Atomicidade entre sistemas:** as duas pontas nascem juntas ou nenhuma nasce — falhar o passo local **obriga** a compensação no GoTrue, senão o e-mail fica **queimado** para um cadastro futuro. **Depende de SMTP.** | 2026-08-06 |
| U2 | `convidado → ativo` | aceite do convite (titular define a senha no GoTrue) | Transição disparada **fora da nossa fronteira** e refletida localmente. Nenhum efeito no ERP. | 2026-08-06 |
| U3 | `(novo) → ativo` | `cadastrarUsuarioComSenha` | **Fallback** para quando o convite não chega. O admin define a senha inicial; o usuário **nasce `ativo`**. **Não exige SMTP** — é isto que garante que nada fica duramente bloqueado enquanto o SMTP não existir. Mesma atomicidade de U1. Re-executar com o mesmo e-mail ⇒ **409**, nunca duplicata. | 2026-08-06 |
| U4 | `ativo → inativo` | `desativarUsuario` | **Defesa em profundidade, e a ordem importa:** (1) flag local `ativo = false` — barreira **imediata** via I-Usuario-4, com latência ≤ TTL; (2) ban no GoTrue — impede **renovar** o refresh token. **Falha no passo 2 ⇒ sucesso PARCIAL auditado**, não erro duro: o `ativo=false` local já revoga, e retornar erro levaria o admin a crer que não desativou ninguém quando na prática desativou (a resposta sinaliza a degradação para a UI). **Falha no passo 1 aborta tudo.** Bloqueada por **I-Usuario-6** se o alvo == o ator. Idempotente. | 2026-08-06 |
| U5 | `inativo → ativo` | `ativarUsuario` | `ativo = true` + unban no GoTrue. **Vínculo Conexos preservado** — reativar não exige redigitar a senha do ERP. Idempotente. | 2026-08-06 |

## Eixo ortogonal — `pendenteMigracao` (NÃO é estado deste autômato)

`authUserId IS NULL` é **condição derivada**, ortogonal a estes três estados: em 2026-08-06 **todo**
`app_user` de produção é `ativo` **E** pendente ao mesmo tempo. Ver `entities/usuario.md` §"Condição
ortogonal" e ADR-0030 §6 (gate de cutover). Vigência da condição: **2026-08-06 → Fase 4**.

## Nota de implementação para o TaskScoper

`convidado` e `inativo` são **ambos `ativo = false`** no banco hoje; o discriminador natural é
"`authUserId IS NULL` **e** convite pendente". Se a distinção precisar ser **persistida** (p.ex. para a
UI diferenciar "nunca entrou" de "acesso revogado"), é **coluna nova na migration `0044`** — decisão de
implementação, não de ontologia.
