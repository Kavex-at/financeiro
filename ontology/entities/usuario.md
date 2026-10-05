---
name: Usuario
type: entity
ontology_version: "0.32.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0007_app_user.sql
  - src/backend/migrations/0028_app_user_gestao.sql
  - src/backend/migrations/0029_app_user_conexos_vinculo.sql
  - src/backend/migrations/0064_app_user_email.sql
  - src/backend/migrations/0066_auth_permissoes_modulo.sql
  - src/backend/migrations/0068_sispag_aprovar_destino.sql
  - src/backend/migrations/0071_app_user_auth_user_id.sql
  - src/backend/http/auth.ts
  - src/backend/http/acesso.ts
  - src/backend/domain/interface/auth/Permission.ts
  - src/backend/domain/service/auth/EffectivePermissionCalculator.ts
  - src/backend/domain/service/auth/AccessService.ts
  - src/backend/domain/repository/auth/AccessRepository.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/routes/me.ts
  - src/backend/routes/usuarios.ts
properties:
  - id
  - username
  - email
  - ativo
  - papel
  - excecoes
  - permissoesEfetivas
  - vinculoConexos
  - criadoEm
  - criadoPor
relationships:
  - "Usuario tem exatamente 1 Papel (app_role)"
  - "Usuario tem 0..N ExcecaoPermissao (user_permission; revogar vence)"
  - "Usuario é ator de toda execução registrada nos ledgers (executado_por / criado_por / finalizado_por / ...)"
  - "Usuario é ator ou alvo de EventoAcesso (app_user_access_event)"
  - "Usuario tem 0..1 VinculoConexos; sem vínculo, o ERP registra a ação como robô CLONEX (ADR-0041)"
last_review: 2026-10-05
universality_evidence:
  - "ADR-0051 (identidade = username, e-mail real como atributo)"
  - "ADR-0053 (permissões por módulo no banco; token só identifica)"
  - "ADR-0057 (Supabase Auth; req.user.sub = username para sempre)"
  - "ADR-0041 (execução registra a identidade Conexos que a realizou)"
  - "Toda frente (I, II, IV) grava o username do ator nos seus ledgers"
---

# Usuario

> **Entidade de plataforma, não de domínio fiscal.** Vive na ontologia pelo mesmo motivo que
> `JobRun` e `Alerta`: é o **ator** de toda ação de domínio, e as regras de autoria, de permissão e
> de identidade Conexos atravessam as três frentes. Até a v0.31 o conceito existia só nas ADRs
> 0051/0053/0057. Este arquivo as consolida e **não decide nada novo** sobre acesso. As decisões
> novas (perfil e atividade) estão na ADR-0058 e em [`atividade-usuario.md`](atividade-usuario.md).

## Identidade

- **Identidade = `app_user.username`, imutável e para sempre** (ADR-0051 D2, ADR-0057). O login
  assina `sub = username`, e o `resolverAcesso` reescreve `req.user = { sub: username, ... }`.
  `email` e `role` do token nunca chegam a `req.user`.
- O ator gravado em qualquer ledger é esse username canônico. Casar ator por igualdade exata
  (`= $username`) é seguro. Sentinelas `'unknown'` e `'dev-bypass'` nunca casam com usuário real.
- `email` é atributo editável por admin, pode ser NULL durante a transição (ADR-0051).
- `auth_user_id`, `password_hash` e `conexos_password_enc` são infraestrutura de credencial:
  **não são propriedades expostas da entidade** e nunca saem em leitura de perfil.

## Papel, exceções e permissões efetivas (ADR-0053)

| Conceito | Armazenamento | Regra |
|---|---|---|
| Papel | `app_role` + `app_role_permission` | exatamente 1 por usuário (`app_user.role_id`) |
| Exceção | `user_permission(efeito ∈ conceder/revogar, concedido_por, concedido_em)` | **revogar vence** |
| Implicação | `EffectivePermissionCalculator` | `<módulo>:executar ⇒ <módulo>:ver` |
| Efetiva | calculada a cada requisição | o token não carrega permissão |

> **Permissão de exceção de destino (ADR-0061, 2026-10-05):** `sispag:excecao` (única; cadastrar,
> aprovar, rejeitar e revogar `ExcecaoDestino`) **substitui** `sispag:aprovar_destino` (ADR-0054/0068).
> A migration troca o `CHECK` das tabelas de permissão e **converte as concessões existentes**
> (papel e exceções por usuário, inclusive "revogar vence"). É avulsa como a anterior (não implica
> `sispag:ver`/`sispag:executar`). Hoje só `Administrador`; o `Analista` (0074) não a tem. A
> separação de funções entre cadastrante e aprovador é regra de backend (I12b), não de papel.

> **Permissões de verificação SISPAG (ADR-0063, 2026-10-05):** `sispag:conferir` (conferência por
> 2ª pessoa e devolução do lote, L12/L13) e `sispag:cadastro` (fila "Pendências de cadastro" do
> responsável pelo cadastro). Avulsas como `sispag:excecao`: não implicam nem são implicadas por
> `sispag:ver`/`sispag:executar`. Migration no padrão da 0068/0075 (troca do `CHECK` das tabelas de
> permissão). A separação entre quem finaliza/monta e quem confere é regra de backend (I13l), não de
> papel. Concessão default: gap Q8 de `_inbox/sispag-verificacoes-ted-pix-gap.md`.

A **origem** de uma permissão efetiva tem 4 valores: `papel`, `concedida` (por X em data),
`revogada` (por X; aparece como ausente, com motivo) e `implicada` (por `<módulo>:executar`).

`app_user.role` é coluna legada e **não** participa da autorização.

## Trilha de acesso

`app_user_access_event(ator TEXT, alvo_user_id INT, tipo ∈ {papel, excecao, ativo}, antes, depois, em)`,
append-only. O ator é um username e o alvo é um id.

## Vínculo Conexos (ADR-0041)

`conexos_username` preenchido = as ações do usuário são assinadas no ERP com o login dele. Sem
vínculo, o ERP registra o **robô CLONEX**, mas a plataforma continua gravando o username do usuário
como ator (`executado_por`). Ator na plataforma e assinante no ERP são campos distintos.

## Invariantes

- **U1 Token só identifica.** Papel e permissões vêm do banco a cada requisição (ADR-0053).
- **U2 Sem autoescalada.** A única via de mudança de papel, exceção, ativo, e-mail ou vínculo é a
  gestão de usuários (`usuarios:gerenciar`). Nenhuma leitura de perfil oferece escrita, para nenhum
  papel (ADR-0058).
- **U3 Falha de verificação ≠ sem acesso.** Falha ao resolver acesso responde **503** (fail-closed)
  e **nunca encerra a sessão**. Só 401 (sessão inválida ou usuário inativo) encerra.

## Ações

Nenhuma ação de domínio nova. Leituras de perfil e atividade estão em
[`atividade-usuario.md`](atividade-usuario.md). A gestão (criar, desativar, mudar papel e exceções)
já existe em `routes/usuarios.ts` e não é remodelada aqui.
