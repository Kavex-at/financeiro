---
name: cadastrarUsuarioComSenha
type: action
entity: Usuario
ontology_version: "0.16"
implementation_status: partial
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
  - "senha informada (min 8)"
postconditions:
  - "usuário existe no GoTrue com senha definida"
  - "linha app_user com auth_user_id preenchido, ativo = true, role default 'operador', created_by = username do ator"
  - "estado = ativo"
side_effects: []
---

# Ação — `cadastrarUsuarioComSenha` (transição U3)

**Fallback do convite.** Existe para o caso concreto de o convite não chegar — SMTP não configurado,
e-mail em quarentena, domínio corporativo bloqueando o remetente.

**É o caminho que funciona sem SMTP**, e é isso que impede o pré-requisito humano de SMTP de virar um
bloqueio duro da operação. `convidarUsuario` continua sendo o caminho **padrão**.

## Regra — mesma atomicidade entre sistemas

Idêntica a `convidarUsuario`: as duas pontas nascem juntas ou nenhuma nasce; falhar o passo local
**obriga** a compensação no GoTrue, senão o e-mail fica **queimado**.

## Regra — o usuário nasce `ativo`

Diferente do convite: não há aceite a esperar, a credencial já existe. Vai direto para `ativo`.

## Regra — least privilege

`role = 'operador'` por default (ADR-0030 §9). Vale mesmo quando quem cadastra é `admin`.

## Custo aceito e reconhecido

Neste caminho **um humano além do titular conhece a senha inicial**. É o preço do fallback, e é por isso
que ele é o **caminho secundário**: `redefinirSenhaDeTerceiro` deixa de gravar hash justamente para
eliminar essa condição no regime normal.

## Idempotência

**Não.** Mesmo e-mail ⇒ **409**.
