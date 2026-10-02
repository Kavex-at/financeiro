---
qa: Security
qa_slug: security
run_id: 2026-10-02-1636-auth-senha-propria
agent: qa-security
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Atacante com um Bearer roubado (XSS, log, máquina compartilhada) de um analista que opera SISPAG/Permutas | Chama `POST /me/senha` para sequestrar a conta trocando a senha, ou adivinha a senha atual por força bruta | `routes/me.ts`, `OwnPasswordService`, `rateLimit.ts`, `CredentialMirror`, `app_user_access_event` | Produção (Render, Express), `AUTH_PROVIDER` local ou supabase | Exige a senha atual, limita as tentativas por usuário, não vaza segredo em log, revoga as outras sessões, grava na trilha | 0 trocas sem senha atual; no máximo 5 falhas 422 / 15 min / usuário; 0 ocorrências de senha em log; 100% das trocas na trilha; sessões roubadas inválidas em minutos |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 (senhas só em testes, com fixtures) | 0 | ✅ | leitura dos arquivos do delta |
| `.env`/tfstate no delta | 0 | 0 | ✅ | `git diff --stat` do `_shared-metrics.md` |
| Rotas novas com guard explícito | 2/2 (`somenteAutenticado()`) | 100% | ✅ | `routes/me.ts` |
| Rotas novas com Zod no boundary | 1/1 mutante (`.strict()`) | 100% | ✅ | `ownPasswordBodySchema` |
| SQL não parametrizado no delta | 0 | 0 | ✅ | `UserRepository.updatePassword` |
| Chaves de senha na redação de log | 4 (`senha`, `senhaatual`, `novasenha`, `password`) | todas | ✅ | `http/redact.ts` |
| Tentativas de adivinhar a senha atual | 5 falhas 422 / 15 min / usuário | ≤ 10 | ✅ | `rateLimit.ts:88-106` |
| Armazenamento do limitador | memória do processo (sem `store` externo) | compartilhado se houver N instâncias | ⚠️ | `rateLimit.ts` (sem Store em produção) |
| Validade do token do app (HS256) após a troca | 12h, sem revogação | ≤ 15 min ou revogável | ⚠️ | `AuthService.ts:39` + `REVOCATION.PULADA_HS256` |
| Trilha para a troca de senha | 1 linha/troca, mesma transação | 100% | ✅ | `OwnPasswordService.gravar` |
| IAM, API Gateway, CloudTrail, GuardDuty | ⚠️ **Não medível**: não existe `infra/` (Render). | — | ⚠️ | CLAUDE.md |
| `npm audit` | ⚠️ **Não medível** (`--quick`); nenhuma dependência nova no delta. | crit=0, high=0 | ⚠️ | `_shared-metrics.md` |

## 3. Tactics — Cobertura (escopo do delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Falha de senha atual vira 422 contado; sem alarme de falhas repetidas | ⚠️ parcial | `rateLimit.ts`; sem alarme |
| Detect Service Denial | `globalLimiter` pré-existente; 429 do GoTrue mapeado | ⚠️ parcial | `me.ts` `responderErroDeSenha` |
| Verify Message Integrity | JWT verificado antes (`auth`); `alg` lido só do cabeçalho de token já verificado | ✅ | `me.ts` `algDoBearer` |
| Detect Message Delay | N/A: sem mensageria nesta feature | N/A | — |
| Identify Actors | `username = req.user.sub`, nunca do corpo | ✅ | `me.ts` |
| Authenticate Actors | Re-prova da senha atual (bcrypt ou password grant), 422 e não 401 | ✅ | `OwnPasswordService.verificarSenhaAtual` |
| Authorize Actors | `somenteAutenticado()`; ação só sobre si mesmo (sem IDOR possível) | ✅ | `me.ts` |
| Limit Access | Limitador por usuário, redação de log, erros sem segredo | ✅ | `rateLimit.ts`, `redact.ts` |
| Limit Exposure | N/A: sem `infra/` | N/A | — |
| Encrypt Data | bcrypt custo 12; política máx. 72 bytes (sem truncamento silencioso) | ✅ | `PasswordPolicy.ts` |
| Separate Entities | N/A no delta (isolamento por tenant é do alvo AWS) | N/A | — |
| Change Default Settings | N/A | N/A | — |
| Validate Input | Zod `.strict()` antes do limitador; política antes de qualquer bcrypt/GoTrue | ✅ | `me.ts`, `PasswordPolicy.ts` |
| Revoke Access | Token GoTrue: `PUT /user` revoga as outras sessões; token HS256: não revoga | ⚠️ parcial | `OwnPasswordService.ts` `REVOCATION` |
| Lock Computer | Bloqueio por falhas é só de rate limit (15 min), sem lock da conta | ⚠️ parcial | `rateLimit.ts` |
| Inform Actors | Log de sucesso e aviso de falha; sem notificação ao usuário/admin | ⚠️ parcial | `OwnPasswordService.alterar` |
| Restore | Transação R6 desfaz o hash se o GoTrue recusa; `AUTH_DIVERGENCIA` se falha após o GoTrue; migration 0073 sem reverse (justificada) | ✅ | `OwnPasswordService.gravar`, `0073_*.sql` |
| Audit Trail | Evento `senha` (ator, alvo, antes/depois NULL) na mesma transação; append-only | ✅ | `ACCESS_EVENT_TYPE.SENHA` |

## 4. Findings

### F-security-1: Em modo `local` (token HS256), trocar a senha não revoga sessões roubadas por até 12h

- **Severidade**: P1
- **Tactic violada**: Revoke Access
- **Localização**: `src/backend/domain/service/auth/OwnPasswordService.ts` (`REVOCATION.PULADA_HS256`), `src/backend/domain/service/auth/AuthService.ts:39`
- **Evidência (objetiva)**:
  ```
  PULADA_HS256: 'Token HS256: nada a revogar no GoTrue; outros tokens HS256 vivem até o `exp`.'
  const TOKEN_EXPIRATION = '12h';
  ```
- **Impacto técnico**: A vítima percebe o roubo e troca a senha, mas o atacante com o Bearer HS256 segue operando por até 12h. Não há `jti`, `tokens_valid_after` nem lista de revogação.
- **Impacto de negócio**: O motivo mais comum para trocar a senha é suspeita de comprometimento. O atacante mantém acesso a ações que movem dinheiro (finalizar lote SISPAG, baixa de permuta).
- **Métrica de baseline**: janela de sessão pós-troca = 12h (alvo ≤ 15 min). O ADR-0059 registra essa janela como aceita; o risco é aceito, não ignorado.

### F-security-2: Limitador de tentativas da senha atual usa memória do processo

- **Severidade**: P2
- **Tactic violada**: Limit Access / Detect Intrusion
- **Localização**: `src/backend/http/rateLimit.ts:34-106` (sem `store` fora de teste)
- **Evidência (objetiva)**:
  ```
  ...(options.store ? { store: options.store } : {}),   // produção: MemoryStore
  limit: OWN_PASSWORD_FAILURES (5), windowMs: 15 min
  ```
- **Impacto técnico**: Com N instâncias no Render, ou após reinício, o balde zera ou multiplica por N (5N tentativas / 15 min). Em modo supabase, o GoTrue tem limite próprio, o que mitiga.
- **Impacto de negócio**: O teto efetivo de adivinhação da senha de contas privilegiadas fica menos previsível do que o desenhado. Hoje é single-instance, então o risco é baixo.
- **Métrica de baseline**: teto efetivo = 5 por instância por janela (instâncias hoje: 1, conforme DEPLOY.md; não verificado em produção).

### F-security-3: Sem alarme nem notificação para falhas de senha atual e troca de senha

- **Severidade**: P2
- **Tactic violada**: Inform Actors / Detect Intrusion
- **Localização**: `src/backend/routes/me.ts` (422), `OwnPasswordService.alterar`
- **Evidência (objetiva)**:
  ```
  422 SENHA_ATUAL_INVALIDA  -> só resposta HTTP; sem LogService de falha
  sucesso                   -> logService.info; sem aviso ao e-mail do usuário
  ```
- **Impacto técnico**: Uma rajada de 422 (indício de Bearer roubado testando a senha) não aparece como evento e não dispara alerta. A troca bem-sucedida também não avisa o dono da conta por outro canal.
- **Impacto de negócio**: O sequestro de conta por troca de senha só é percebido quando a vítima não consegue mais entrar.
- **Métrica de baseline**: alarmes de falha de autenticação = 0.

### F-security-4: Estado do limitador é por usuário e não por IP; o IP do atacante não é contido

- **Severidade**: P3
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/http/rateLimit.ts:97`
- **Evidência (objetiva)**:
  ```
  keyGenerator: (req) => `senha:${req.user?.sub ?? ''}`
  ```
- **Impacto técnico**: Um atacante com o Bearer da vítima pode esgotar o balde dela, e a vítima legítima leva 429 por 15 min (negação de serviço de uma única função). A chave por usuário é correta contra força bruta distribuída, e isso é o trade-off.
- **Impacto de negócio**: Irritação pontual; sem perda financeira.
- **Métrica de baseline**: 5 falhas bloqueiam o próprio dono por 15 min.

## 5. Cards Kanban

### [security-1] Revogar sessões HS256 ao trocar a senha

- **Problema**
  > Em modo `local`, o token do app dura 12h e a troca de senha não invalida os outros. Quem tem um Bearer roubado continua operando depois que a vítima troca a senha.

- **Melhoria Proposta**
  > Adicionar `token_valid_after` (ou `password_changed_at`) em `app_user`, gravado na mesma transação do `updatePassword`. O middleware `auth` rejeita HS256 com `iat` anterior. Reduzir `TOKEN_EXPIRATION` com refresh, se o custo for aceitável. Tactic: Revoke Access. Tocar `UserRepository`, `OwnPasswordService`, `http/auth.ts`. Excluir o token do chamador (reemitir um novo no 204, ou aceitar `iat >= troca`).

- **Resultado Esperado**
  > Após a troca, qualquer outro token HS256 é recusado na próxima request. Janela de 12h para 0.

- **Tactic alvo**: Revoke Access
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Janela de sessão pós-troca: 12h → ≤ 1 request
- **Risco de não fazer**: A troca de senha continua sem efeito contra sessão roubada, justamente no cenário de comprometimento.
- **Dependências**: nova migration (aditiva); cache de acesso do `resolverAcesso`.

### [security-2] Dar ao limitador de senha um store compartilhado

- **Problema**
  > O limitador usa o MemoryStore. Com mais de uma instância ou reinício, o teto de 5 falhas / 15 min deixa de valer.

- **Melhoria Proposta**
  > Opção A: contar falhas numa tabela Postgres (`app_user_senha_falha`) ou reaproveitar a trilha de acesso, que já existe. Opção B: documentar no DEPLOY.md que o serviço é single-instance e travar isso. Tactic: Limit Access.

- **Resultado Esperado**
  > Teto de 5 falhas por usuário independente do número de instâncias.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2, F-security-4
- **Métricas de sucesso**:
  - Teto efetivo: 5 × N instâncias → 5
- **Risco de não fazer**: Ao escalar a 2+ instâncias, o limite se afrouxa sem ninguém notar.
- **Dependências**: nenhuma

### [security-3] Registrar e alertar falhas de senha atual, e avisar o dono da conta

- **Problema**
  > O 422 de senha atual inválida e a troca bem-sucedida não geram alerta. Não há como detectar um Bearer roubado em uso nem avisar a vítima.

- **Melhoria Proposta**
  > Gravar `LogService.warn` com `usuario` (sem segredo) no 422 e no 429, com tipo próprio para alarme por contagem. Avisar o e-mail da conta numa troca (hoje não há SES, então começar pelo log e pelo painel do admin). Tactic: Detect Intrusion + Inform Actors.

- **Resultado Esperado**
  > Rajada de 422 por usuário visível em log/alerta; troca de senha visível ao admin.

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Alarmes de falha de autenticação: 0 → ≥ 1
- **Risco de não fazer**: Um sequestro por troca de senha segue invisível até a vítima reclamar.
- **Dependências**: canal de alerta (Render log drain ou similar)

## 6. Notas do agente

- Nenhum P0 introduzido pelo delta: senha atual verificada antes de qualquer escrita, política antes do bcrypt, Zod `.strict()`, limitador por usuário, redação de log cobrindo `senhaAtual`/`novaSenha`, trilha na mesma transação.
- Escopo: só o delta; `infra/`, IAM, CloudTrail e `npm audit` não medidos (inexistentes ou `--quick`).
- Cross-QA: Audit Trail (Fault Tolerance), Restore (Availability/Deployability, migration 0073 sem reverse), F-security-2 (Availability, multi-instância).
