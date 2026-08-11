---
name: vincularConexos
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/http/conexosIdentity.ts
  - src/backend/routes/usuarios.ts
  - src/backend/routes/me.ts
last_review: 2026-08-06
preconditions:
  - "ator com role = 'admin'"
  - "SecretCipher habilitado (senão 503 — já implementado)"
  - "conexosUsername + conexosPassword juntos, ou nenhum dos dois"
postconditions:
  - "senha do ERP cifrada em repouso (AES-256-GCM)"
  - "as chamadas ao Conexos do usuário logado passam a sair NO NOME DELE"
side_effects: []
---

# Ações — `vincularConexos` / `desvincularConexos`

Chaves de ação: **`vincularConexos`** (o desvincular é a mesma ação com ambos os campos nulos).

## O que a ação de fato faz

Move o usuário do **usuário-robô** para a **identidade própria** no ERP. É o elo final da cadeia que
faz a baixa `fin010` sair no nome do humano:

```
app_user.username → ALS (platformUsername) → getVinculoConexos(username) → sessão do ERP → baixa fin010
```

## Regra — vincular **não** valida a credencial no momento da gravação

A verificação é posterior e explícita: **`GET /me/conexos-status`** (`ok` / `falha` / `ausente`).

**Por quê importa:** um vínculo com credencial inválida **degrada para o usuário-robô, silenciosamente**
— as baixas continuam saindo, atribuídas à máquina, sem erro e sem log. É exatamente por isso que o
status é exibido **logo após o login**, e não escondido numa tela de configurações.

## Regra — segredo reversível, nunca hash

`conexos_password_enc` é cifrado com **AES-256-GCM** (precisa ser **reversível**: o backend reautentica
no ERP em nome do usuário). Nunca sai em resposta de API — `AppUserPublic` o omite, e a interface existe
justamente para isso.

## Regra — vínculo só de usuário ativo (I-Usuario-5)

`getVinculoConexos` filtra `AND ativo = true` (`UserRepository.ts:163`). É o ponto exato onde
**"acesso revogado" vira "não movimenta dinheiro no ERP"**. Desativar **não apaga** o vínculo — ele fica
**inerte** (ver `ativar-desativar-usuario.md`).

## ⚠️ Estado real em produção (2026-08-06): esta ação está INERTE

**`CONEXOS_CRED_ENC_KEY` está ausente do `render.yaml`.** Sem ela, `SecretCipher` fica desabilitado, o
vínculo por usuário **não funciona em produção** e **tudo já cai no usuário-robô hoje**.

Ou seja: a ontologia assevera I-Usuario-5, mas o ambiente **não a exerce**. Registrado aqui e em
`entities/usuario.md` porque **uma invariante inerte parece cumprida** — e a diferença só aparece
quando alguém audita quem assinou uma baixa.

Gap **pré-existente**, não causado por esta feature. Provisionar junto das variáveis novas (ADR-0030 §10).

## Atribuição — gap declarado

Vincular e desvincular **não registram hoje quem fez** (I-Usuario-7). Follow-up nomeado.
