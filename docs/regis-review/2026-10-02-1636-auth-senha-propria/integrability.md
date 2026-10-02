---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-02-1636-auth-senha-propria
agent: qa-integrability
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex / operador do projeto Supabase | O GoTrue muda de versão, ou alguém liga "Secure password change" no painel | `SupabaseAuthClient.updateOwnPassword` (`PUT /auth/v1/user`) e `logout?scope=others` | Produção (Render + Supabase hospedado) | A mudança fica contida no client; a rota responde 503 operável e a troca não é aplicada pela metade | 1 arquivo de client tocado, 0 serviços; desvio detectado antes do usuário (teste de contrato / health) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos genéricos (`get/post/request`) públicos no `SupabaseAuthClient` | 0 (só métodos de domínio: `signInWithPassword`, `refresh`, `logout`, `updateOwnPassword`, `admin*`) | 0 | ✅ | `SupabaseAuthClient.ts:98-265` |
| Arquivos de service/route importando `fetch`/`axios` direto no delta | 0 (único `fetch` do delta está no client) | 0 | ✅ | `SupabaseAuthClient.ts:335` |
| Zod na resposta do novo `PUT /user` | Sim (`supabaseAdminUserResponseSchema`; falha vira `bad_response`) | resposta validada | ✅ | `SupabaseAuthClient.ts:164, 316-323` |
| Versão da API no URL | `/auth/v1` fixo; versão do servidor GoTrue (v2.197) só medida à mão | pinada + verificada | ⚠️ | `SupabaseAuthClient.ts:271`; `jobs/probe-gotrue-local.ts` |
| Teste do client com forma da resposta | Mocks de `fetch` (`SupabaseAuthClient.test.ts:151-193`), sem fixture gravada do GoTrue real | fixture gravada | ⚠️ | `SupabaseAuthClient.test.ts` |
| Config via `EnvironmentProvider` (sem `process.env` cru) | 100% no delta (lido na 1ª chamada, `lerConfig`) | 100% | ✅ | `SupabaseAuthClient.ts:267-275` |
| Timeout / retry de escrita | Timeout 10 s; escrita nunca repetida | idem | ✅ | `SupabaseAuthClient.ts:74, 339` |
| Observabilidade por dependência | `AUTH_INDISPONIVEL` com operação, status, duração; sem corpo nem segredo | por operação | ✅ | `SupabaseAuthClient.ts:385-400` |
| Contratos de dependências externas novas (Nexxera/GED/SharePoint) | Fora do delta | n/a | ⚠️ Não medível neste delta | — |
| `infra/` / SSM path convention | Não existe `infra/` neste repo | — | ⚠️ Não medível | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | A troca da própria senha passa por `CredentialMirror.trocarPropriaSenha` e `updateOwnPassword`. O serviço não conhece URL nem cabeçalho. | ✅ | `CredentialMirror.ts:119-157` |
| Use an Intermediary | `CredentialMirror` faz a anti-corruption entre o domínio e o GoTrue (espelho transacional, `aposFalha`, `AUTH_DIVERGENCIA`). | ✅ | `OwnPasswordService.ts:160-195` |
| Restrict Communication Paths | Só o client fala com o GoTrue; o delta não adiciona caminho novo. | ✅ | `SupabaseAuthClient.ts` |
| Adhere to Standards | HTTP/JSON, Bearer do usuário, `apikey` publicável. Segue a API pública do GoTrue. | ✅ | `SupabaseAuthClient.ts:277-298` |
| Abstract Common Services | `enviar` / `buscar` / `erroDaResposta` / `logarFalha` são o núcleo HTTP único. O `PUT /user` entrou como mais uma `Requisicao`, sem copiar auth ou retry. | ✅ | `SupabaseAuthClient.ts:300-383` |
| Discover Service | URL e chaves vêm do `EnvironmentProvider`. Sem `infra/`/SSM, a convenção de path não é verificável. | ⚠️ parcial | `lerConfig` |
| Tailor Interface | `LogoutScope` tipado, `Requisicao.tokenDoUsuario` opcional. | ✅ | `SupabaseAuthClient.ts:34-42` |
| Configure Behavior | Depende do ajuste manual "Secure password change = OFF" no painel, sem checagem em runtime. | ⚠️ parcial | `SupabaseAuthClient.ts:151`; F-integrability-1 |
| Manage Resources | Timeout por chamada, escrita sem retry, rate limit por usuário (5 falhas 422 / 15 min). | ✅ | `rateLimit.ts` (`buildOwnPasswordLimiter`) |
| Orchestrate | `OwnPasswordService` orquestra de forma linear: sonda de senha → hash → PUT dentro da transação → revoga. São 3 chamadas ao GoTrue por troca (sign-in, PUT, logout da sonda), com compensação por `aposFalha`. | ✅ | `OwnPasswordService.ts:120-195` |
| Manage Resource Coupling | Troca acoplada à sessão do chamador: o PUT usa o token dele, e se outra troca o revogou vira 503. | ⚠️ parcial | `OwnPasswordService.ts:182-192` |
| Contract testing | Só mocks de `fetch`; a sonda real é manual (`probe-gotrue-local.ts`, roteiro de QA local). | ⚠️ parcial | F-integrability-2 |
| Versioning strategy | `/auth/v1` pinado; comportamento do `LogoutAllExceptMe` medido só na v2.197, sem asserção automática. | ⚠️ parcial | `SupabaseAuthClient.ts:149-152` |
| Backward-compat shims | Flag `AUTH_PROVIDER` local/supabase mantém os dois caminhos de verificação (`OwnPasswordService.ts:123-128`). Custo: dois ramos a testar. | ✅ | idem |
| Observability of integration failures | `LOG_TYPE.AUTH_INDISPONIVEL` por operação, com status e duração; sem métrica agregada de taxa de erro por dependência. | ⚠️ parcial | `SupabaseAuthClient.ts:385` |

## 4. Findings

### F-integrability-1: Pré-requisito de configuração do GoTrue ("Secure password change" OFF) sem verificação em runtime

- **Severidade**: P2
- **Tactic violada**: Configure Behavior
- **Localização**: `src/backend/domain/client/SupabaseAuthClient.ts:149-166`
- **Evidência (objetiva)**:
  ```
  Exige "Secure password change" OFF no projeto: ligado, pede `nonce` por e-mail.
  ```
  O ajuste vive no painel do Supabase e a única proteção é a nota no `DEPLOY.md`. Se alguém o ligar, o `PUT /user` passa a ser recusado e `gravar` converte a recusa em 503.
- **Impacto técnico**: A troca de senha falha para todos, com o log `AUTH_INDISPONIVEL` e o código do GoTrue. Nada indica "configuração do projeto mudou".
- **Impacto de negócio**: Funcionalidade de autoatendimento sai do ar sem alarme. O suporte recebe chamados e a causa é um clique no painel.
- **Métrica de baseline**: 0 verificações automáticas do pré-requisito, 1 nota manual (`DEPLOY.md`).

### F-integrability-2: Sem teste de contrato com forma gravada do GoTrue; versão do servidor não pinada nem verificada

- **Severidade**: P2
- **Tactic violada**: Contract testing / Versioning strategy
- **Localização**: `SupabaseAuthClient.test.ts:151-193`; `SupabaseAuthClient.ts:149-152`; `jobs/probe-gotrue-local.ts`
- **Evidência (objetiva)**: Os testes mockam `fetch`. O comportamento crítico (sessão atual mantida e as outras revogadas pelo `PUT /user`, `?scope=others`) foi medido à mão na v2.197 e registrado em `ontology/_inbox/auth-senha-propria-interview.md`. O Supabase hospedado atualiza o GoTrue sem aviso.
- **Impacto técnico**: Uma mudança de semântica do `PUT /user` (por exemplo, passar a revogar a sessão atual) passa em 3498 testes e só aparece em produção.
- **Impacto de negócio**: O usuário trocaria a senha e seria deslogado, ou as outras sessões continuariam vivas. Isso é uma regressão de segurança silenciosa.
- **Métrica de baseline**: 0 fixtures gravadas do GoTrue para `PUT /user` e `/logout`; 1 sonda manual.

### F-integrability-3: Recusa 4xx do GoTrue no `PUT /user` colapsa em 503 genérico (perde a distinção weak_password / same_password / sessão revogada)

- **Severidade**: P3
- **Tactic violada**: Tailor Interface
- **Localização**: `src/backend/domain/service/auth/OwnPasswordService.ts:182-192`
- **Evidência (objetiva)**: Todo `SupabaseAuthRejectedError` vira `SupabaseAuthUnavailableError(..., 'bad_response')`. O código e o status ficam só no log.
- **Impacto técnico**: A política local (`PasswordPolicy`) pode divergir da política do GoTrue (tamanho mínimo, senha igual à atual, lista de vazadas). A rejeição legítima do GoTrue aparece como "indisponível" e não pode ser corrigida pelo usuário.
- **Impacto de negócio**: Chamados de "serviço fora do ar" para o que é uma senha fraca segundo o provedor.
- **Métrica de baseline**: 1 ramo de mapeamento para todos os 4xx; 0 códigos do GoTrue expostos ao usuário.

## 5. Cards Kanban

### [integrability-1] Verificar a configuração "Secure password change" do GoTrue na subida e na sonda

- **Problema**
  > A troca da própria senha depende de "Secure password change" OFF no painel do Supabase. Nada no código detecta o ajuste ligado; o efeito é um 503 genérico para todos os usuários.
- **Melhoria Proposta**
  > Adicionar a `probe-gotrue` (ou a um check opcional de `/auth/v1/settings`) a leitura do ajuste, com alerta `AUTH_INDISPONIVEL` de motivo distinto. Documentar no runbook. Tocar `SupabaseAuthClient.ts` e o job de sonda, sem passar pelo `bootstrapAppContainer`.
- **Resultado Esperado**
  > Config errada detectada antes do primeiro usuário; verificações automáticas do pré-requisito 0 → 1.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Verificações automáticas do pré-requisito: 0 → 1
  - Tempo para diagnosticar a causa: de investigação manual a um alerta com causa nomeada
- **Risco de não fazer**: Um clique no painel derruba a troca de senha sem alarme.
- **Dependências**: Nenhuma.

### [integrability-2] Gravar fixtures do GoTrue para `PUT /user`, `/logout?scope=others` e rodar a sonda na CI

- **Problema**
  > O comportamento de sessão do GoTrue foi validado só manualmente na v2.197. Os testes usam mocks, então uma mudança do provedor não é detectada.
- **Melhoria Proposta**
  > Gravar respostas reais (sucesso, 422 weak/same_password, 401 token revogado) como fixtures e fazer o `SupabaseAuthClient.test.ts` parseá-las. Opcionalmente, rodar `probe-gotrue-local` num job com o container pinado e registrar a versão esperada em `DEPLOY.md`.
- **Resultado Esperado**
  > Regressão de semântica do `PUT /user` quebra um teste. Fixtures gravadas: 0 → 4.
- **Tactic alvo**: Contract testing / Versioning strategy
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Fixtures gravadas do GoTrue: 0 → 4
  - Versão do GoTrue verificada automaticamente: não → sim
- **Risco de não fazer**: Regressão de segurança no pós-troca (sessões não revogadas) sem aviso.
- **Dependências**: Nenhuma.

### [integrability-3] Distinguir senha rejeitada pelo GoTrue de indisponibilidade na rota `POST /me/senha`

- **Problema**
  > Todo 4xx do GoTrue no `PUT /user` vira 503. Uma política do provedor mais restrita que a local aparece como "fora do ar".
- **Melhoria Proposta**
  > Mapear `weak_password` / `same_password` para `PasswordPolicyError` (400) e manter 503 só para sessão revogada e 5xx. Tocar `OwnPasswordService.gravar` e o teste de rota.
- **Resultado Esperado**
  > O usuário recebe causa acionável; 4xx de política tratados como 503: 100% → 0%.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Códigos de política do GoTrue mapeados a 400: 0 → 2
- **Risco de não fazer**: Chamados de suporte por "serviço indisponível" quando a senha era fraca.
- **Dependências**: integrability-2 (fixtures dos códigos reais).

## 6. Notas do agente

- Escopo: só o delta (client Supabase, mirror, serviço, rota). Sem P0: o `PUT /user` entrou pelo núcleo HTTP do client existente (Zod, timeout, sem retry de escrita, log sem corpo), sem método genérico novo.
- `--quick`: sem coverage nem `npm audit`; `infra/` não existe, então a convenção SSM não é medível.
- Cross-QA: F-integrability-2 toca Security (revogação de sessões) e Testability. F-integrability-1 toca Deployability. O grep de `fetch` em services e routes de todo o repositório não foi feito; vale só para o delta.
