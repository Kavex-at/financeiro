---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-28-1550
agent: qa-integrability
generated_at: 2026-09-28T15:50:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex, passo 3 do plano de auth (ADR-0051) | Trocar o provedor de identidade (login simples → Supabase Auth), adicionando a claim `email` ao token | `req.user` (payload do JWT) e todo ponto que lê `req.user.sub`/`req.user.email` como "ator" | Produção, multi-rota (`routes/recebimentos.ts` e futuros) | A troca deveria exigir mudança em **um único ponto de resolução do ator**, não em cada call-site | Nº de arquivos fora da camada de auth tocados na troca; hoje 5 sítios ad-hoc em 1 arquivo, sem função de resolução compartilhada |

Este ciclo (`auth-email-transicao`) é o **passo 1 de 3** de um plano de troca de provedor de
identidade (ADR-0051: login simples → Supabase Auth no passo 3). Não é uma integração externa nova
(nenhum client em `domain/client/` foi tocado) — é a integração **interna** front↔back (JWT próprio)
sendo preparada para uma substituição futura. A pergunta de integrabilidade relevante para este delta
não é "custo de adicionar Nexxera/GED/SharePoint" (nenhum tocado aqui), mas sim: **o quanto este passo
1 aumenta ou reduz o custo do passo 3 (troca de provedor de auth)?**

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients externos tocados pelo delta (`domain/client/**`) | 0 | — | N/A | `git diff origin/main...HEAD --stat` (sem arquivos em `domain/client/`) |
| Métodos genéricos (`get/post/request/call`) expostos por `UserRepository`/`AuthService`/`UserAdminService` | 0 | 0 | ✅ | `Grep -n "^\s*public " src/backend/domain/repository/auth/UserRepository.ts src/backend/domain/service/auth/*.ts` — todos nomes de domínio (`findByLoginIdentifier`, `setEmail`, `deactivateGuarded`, `upsertAdmin`, …) |
| Rotas novas/alteradas com Zod no boundary | 8/8 (100%) | ≥80% | ✅ | `src/backend/routes/auth.ts:19` (`loginBodySchema`), `src/backend/routes/usuarios.ts` (`idParamSchema`, `setAtivoSchema`, `createUserSchema`, `setEmailSchema`, `resetPasswordSchema`, `vinculoConexosSchema`) |
| `process.env` raw fora de `EnvironmentProvider` introduzido pelo delta | 1 sítio (`src/backend/jobs/seed-admin.ts:24`, `new SeedAdminConfig().parse(process.env)`) | 0 em `domain/service/` | ✅ (não é `domain/service/`) | Consistente com o padrão pré-existente de outros jobs (`probe-*.ts`, `cleanup-*.ts`, `validate-*.ts` também leem `process.env` direto — Rule #8 do CLAUDE.md é "never raw `process.env` in **services**", jobs são o padrão estabelecido) |
| Var nova registrada em `CONFIG_MANIFESTO` (registro central de config) | `AUTH_TRANSICAO_EMAIL_BANNER`: sim; `ADMIN_EMAIL`/`ADMIN_PASSWORD`: não | — | ⚠️ parcial, mas consistente com o padrão pré-existente | `src/backend/domain/interface/operacao/configManifest.ts:120-129`; `ADMIN_USERNAME`/`ADMIN_PASSWORD` também nunca estiveram no manifesto na `main` (`git show origin/main:…/configManifest.ts \| grep ADMIN_` vazio) — não é regressão do delta |
| Call-sites ad-hoc de resolução de "ator" fora da camada de auth, sem função compartilhada | 5 (`src/backend/routes/recebimentos.ts:262,573,729,927,967`) | 1 (função única) | ⚠️ | `Grep -n "req.user?.sub ?? req.user?.email\|req.user?.email ?? req.user?.sub" src/backend/routes/recebimentos.ts` — pré-existente, mas documentado como dívida pelo próprio ADR-0051 (D2) |
| Wrapper único de chamada HTTP no frontend para as rotas tocadas | 1 (`apiFetch` + `withAuthHeaders`, `src/frontend/lib/http.ts` / `lib/auth/token.ts`), + 1 exceção justificada (`fetchTransicaoEmail`, `fetch` puro pois a rota é pública) | 1 wrapper | ✅ | `src/frontend/lib/usuarios.ts:1-2` (usa `apiFetch`/`withAuthHeaders` em todas as 8 chamadas); `src/frontend/lib/auth/transicao.ts:14-24` (exceção documentada em comentário) |
| Testes que validam o contrato do boundary novo com HTTP real (supertest via `listen()`) | 2 suítes novas (`routes/auth.test.ts` 143 linhas, `routes/usuarios.test.ts` 299 linhas) + 1 caso em `buildApp.test.ts` | — | ✅ | `src/backend/routes/auth.test.ts`, `src/backend/routes/usuarios.test.ts`, `src/backend/http/buildApp.test.ts:102-111` |
| Backward-compatibility shims introduzidos, e custo (LOC) | 2: alias `username`→`email` em `createUserSchema` (~15 LOC, `superRefine`+`transform`) e fail-closed de `fetchTransicaoEmail` para backend antigo sem a rota (~10 LOC) | — | ✅ baixo custo | `src/backend/domain/service/auth/UserAdminService.ts:38-64`; `src/frontend/lib/auth/transicao.ts:9-13` |

> ⚠️ **Não medível localmente**: taxa de erro por dependência em produção (observability de falha de
> integração) para `GET /auth/transicao` ou `PATCH /usuarios/:id/email` — requer o dashboard/log
> agregado do Render, fora do alcance desta revisão `--quick`.

## 3. Tactics — Cobertura no nf-projects (delta desta feature)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `UserRepository` é o único ponto que fala SQL de `app_user`; `AuthService`/`UserAdminService`/rotas nunca montam SQL. Nenhum método genérico exposto. | ✅ presente | `src/backend/domain/repository/auth/UserRepository.ts:1-302` |
| Use an Intermediary | Frontend: todas as chamadas às rotas novas passam por `apiFetch`/`withAuthHeaders`, exceto a rota pública (exceção documentada). | ✅ presente | `src/frontend/lib/usuarios.ts`, `src/frontend/lib/auth/transicao.ts:9-13` |
| Restrict Communication Paths | `GET /auth/transicao` é a única rota nova pública; todas as demais (`/usuarios/*`) exigem token + `requireRole('admin')` no router inteiro. | ✅ presente | `src/backend/routes/usuarios.ts:33` (`router.use(requireRole('admin'))`), `src/backend/routes/auth.ts:53-63` |
| Adhere to Standards | REST convencional (verbos/status HTTP, 409 para colisão, 401/403 para auth), SQL parametrizado (`$nome` via `SqlBuilder`), Zod nos boundaries — seguem convenção do CLAUDE.md. | ✅ presente | `src/backend/routes/usuarios.ts:44-70` (`respondError`) |
| Abstract Common Services | `CONFIG_MANIFESTO`/`ConfigDoctor` funciona como um "registro de config" central (análogo a um service discovery para variáveis de ambiente, já que não há SSM neste repo); a var nova foi registrada nele. | ✅ presente (parcial p/ `ADMIN_*`, ver métricas) | `src/backend/domain/interface/operacao/configManifest.ts:120-129` |
| Discover Service | Não há SSM/registry de serviço (`infra/` não existe neste repo). O único "discovery" é o `CONFIG_MANIFESTO` acima. | N/A — sem `infra/`, não medível como client discovery | `_shared-metrics.md` |
| Tailor Interface | Mapeamento de erros de domínio → HTTP (`respondError`), alias `username`↔`email` na criação de usuário, resposta mínima `{ ativo }` no banner (não vaza contagem/nomes). | ✅ presente | `src/backend/routes/usuarios.ts:44-70`; `src/backend/routes/auth.ts:57-63` |
| Configure Behavior | `AUTH_TRANSICAO_EMAIL_BANNER` (chave manual, só `'true'` liga, sem redeploy do front), `ADMIN_EMAIL`/`ADMIN_PASSWORD` sem default (falha explícita). | ✅ presente | `src/backend/domain/libs/environment/EnvironmentProvider.ts:211-212`; `src/backend/jobs/SeedAdminConfig.ts:20-29` |
| Manage Resources | `deactivateGuarded` usa transação + `FOR UPDATE` para serializar dois admins se desativando ao mesmo tempo (evita zerar os admins). | ✅ presente | `src/backend/domain/repository/auth/UserRepository.ts:242-269` |
| Orchestrate | Nenhum orquestrador novo com >3 colaboradores (`AuthService`: 3 deps; `UserAdminService`: 3 deps, nenhum é "Client"). | N/A — nenhum orquestrador introduzido pelo delta | `src/backend/domain/service/auth/AuthService.ts:47-53`, `UserAdminService.ts:84-91` |
| Manage Resource Coupling | O `sub` do token continua sendo `username` (não muda com este passo) justamente para não acoplar `Permutas`/`SISPAG`/`Recebimentos`/vínculo Conexos/allow-list a uma identidade nova antes da hora — decisão explícita de desacoplamento temporal (ADR-0051 D2). Mas a leitura do "ator" nesses consumidores (`recebimentos.ts`) é ad-hoc, não encapsulada (ver Finding 1). | ⚠️ parcial | `ontology/decisions/0051-auth-email-real-sub-continua-username.md` (seção D2) |
| Contract testing | Testes HTTP reais via `listen()` cobrindo request/response shape das rotas novas (`auth.test.ts`, `usuarios.test.ts`); não há fixture de payload de terceiro (não há terceiro nesta feature). | ✅ presente para o contrato interno FE↔BE | `src/backend/routes/auth.test.ts`, `src/backend/routes/usuarios.test.ts` |
| Versioning strategy | Não aplicável — nenhuma API externa foi versionada ou tocada neste delta. O contrato interno (`POST /auth/login` body `{username,password}`) é deliberadamente mantido estável entre deploys assíncronos (ver Backward-compatibility shims). | N/A — sem API externa no delta |  |
| Backward-compatibility shims | Alias `username`↔`email`, banner fail-closed em 404. Custo baixo (~25 LOC no total), ambos documentados no código e no ADR. | ✅ presente, custo medido | ver métricas acima |
| Observability of integration failures | Erros de login ambíguo (>1 candidato) e falhas de config (`AUTH_JWT_SECRET` ausente) logam via `LogService`; não há métrica agregada de taxa de erro por endpoint. | ⚠️ parcial | `src/backend/domain/service/auth/AuthService.ts:67-75,96-100` |

## 4. Findings (achados)

### F-integrability-1: Resolução do "ator" (`req.user.sub`/`req.user.email`) segue ad-hoc em `recebimentos.ts`, sem ponto único de encapsulamento — custo textual do passo 3 do ADR-0051

- **Severidade**: P2 (débito técnico defensável — documentado e deliberadamente adiado, não bloqueia esta feature, mas é o próprio ADR desta feature que o formaliza como pendência)
- **Tactic violada**: Encapsulate / Manage Resource Coupling
- **Localização**: `src/backend/routes/recebimentos.ts:262,573,729,927,967` (PRÉ-EXISTENTE — nenhum destes arquivos está no diff desta feature; o que é **do delta** é o ADR-0051 que documenta e nomeia essa dívida)
- **Evidência (objetiva)**:
  ```
  262:        const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
  573:        const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
  729:                triggeredBy: req.user?.email ?? req.user?.sub ?? 'manual',
  927:                triggeredBy: req.user?.email ?? req.user?.sub ?? 'manual',
  967:        const ator = req.user?.email ?? req.user?.sub ?? 'unknown';
  ```
  E o próprio ADR-0051 (novo neste delta), seção D2:
  > "Dependência que o passo 3 precisa saber. Três sítios de `routes/recebimentos.ts` (...) leem
  > `req.user.email ?? req.user.sub`. (...) Quem adicionar o claim `email` no passo 3 precisa
  > inverter esses três para `sub ?? email` no mesmo PR, ou eles passam a gravar o e-mail na trilha
  > em silêncio."
- **Impacto técnico**: os 5 sítios já não concordam entre si sobre a ordem de precedência
  (`sub ?? email` em 3, `email ?? sub` em 2) mesmo hoje, quando `email` nunca está no token — um
  acidente latente que só se manifesta quando o passo 3 adicionar a claim. Sem uma função única de
  resolução do ator, a troca do provedor de auth (passo 3) exige grep manual e edição coordenada de
  N call-sites espalhados por rotas de negócio (`recebimentos.ts`), fora da camada de auth — exatamente
  o padrão de "replace an integration cascade" que a mission pede para avaliar, aplicado à identidade
  em vez de a um client externo.
- **Impacto de negócio**: se um só dos 5 sítios for esquecido na migração do passo 3, o `triggeredBy`/
  `ator` gravado nos ledgers de Permutas/SISPAG/Recebimentos passa a registrar o e-mail em vez do
  `username` histórico **em silêncio** — quebrando auditoria, o vínculo Conexos por usuário e o
  allow-list `OPERACAO_USUARIOS`, sem erro visível até uma auditoria ou incidente.
- **Métrica de baseline**: 5 call-sites, 1 arquivo, 0 função de resolução compartilhada, 2 ordens de
  precedência divergentes já hoje.

### F-integrability-2: `ADMIN_EMAIL`/`ADMIN_PASSWORD` (vars centrais deste delta) não entraram no `CONFIG_MANIFESTO`, enquanto `AUTH_TRANSICAO_EMAIL_BANNER` entrou

- **Severidade**: P3 (melhoria opcional — inconsistência interna ao próprio delta, não é regressão: `ADMIN_USERNAME`/`ADMIN_PASSWORD` também nunca estiveram no manifesto na `main`)
- **Tactic violada**: Abstract Common Services (aplicação parcial dentro do mesmo delta)
- **Localização**: `src/backend/domain/interface/operacao/configManifest.ts:120-129` (var nova registrada) vs. `src/backend/jobs/SeedAdminConfig.ts:20-29` (vars igualmente novas/renomeadas, não registradas)
- **Evidência (objetiva)**: `Grep -n "ADMIN_EMAIL\|ADMIN_PASSWORD" src/backend/domain/interface/operacao/configManifest.ts` não retorna nada; `Grep -n "AUTH_TRANSICAO_EMAIL_BANNER" configManifest.ts` retorna a entrada completa.
- **Impacto técnico**: baixo — `ADMIN_EMAIL`/`ADMIN_PASSWORD` só importam no momento do `seed:admin`
  manual (não em runtime contínuo do servidor), então o `ConfigDoctor` (pensado para o processo
  vivo) não é o lugar natural para elas de qualquer forma. Risco real é só a inconsistência de
  critério dentro do mesmo PR.
- **Impacto de negócio**: nenhum imediato; ausência de `ADMIN_EMAIL`/`ADMIN_PASSWORD` já falha alto e
  cedo via `SeedAdminConfig` (zod, `MissingSeedAdminEnvError`), então o operador não fica no escuro.
- **Métrica de baseline**: 1 de 2 pares de vars novas/renomeadas neste delta registrados no manifesto central.

## 5. Cards Kanban

### [integrability-1] Extrair `resolveAtor(req)` único antes do passo 3 do ADR-0051

- **Problema**
  > `routes/recebimentos.ts` resolve o "ator"/`triggeredBy` em 5 lugares com `req.user?.sub ?? req.user?.email` (3 sítios) ou a ordem inversa (2 sítios) — hoje inofensivo porque o token nunca tem
  > `email`, mas o próprio ADR-0051 (`ontology/decisions/0051-*.md`, seção D2) documenta que o passo 3
  > (Supabase Auth, que adiciona a claim `email`) precisa inverter exatamente esses 3 sítios "no mesmo
  > PR", sob pena de gravar e-mail na trilha de auditoria em silêncio.

- **Melhoria Proposta**
  > Criar uma função única (`resolveAtor(req): string`, tactic **Encapsulate**) em `src/backend/http/`
  > ou `domain/libs/`, usada pelos 5 sítios de `routes/recebimentos.ts` e por qualquer rota futura que
  > precise do ator. Isso não precisa entrar neste ciclo (a mudança de comportamento é zero hoje), mas
  > deveria ser o primeiro passo do `/feature-new` ou `/feature-tweak` que implementar o passo 3 do
  > ADR-0051 — antes de adicionar a claim `email`, não depois.

- **Resultado Esperado**
  > Trocar o provedor de identidade no passo 3 passa a exigir editar 1 função, não fazer grep por
  > `req.user?.sub` em rotas de negócio. Nº de call-sites ad-hoc: 5 → 0 (substituídos por 1 chamada de
  > função cada).

- **Tactic alvo**: Encapsulate / Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Call-sites de resolução ad-hoc do ator em `routes/`: 5 → 0
  - Ordens de precedência divergentes (`sub??email` vs `email??sub`) coexistindo: 2 → 1
- **Risco de não fazer**: no passo 3, um dos 5 sítios é esquecido na inversão manual, e o
  `triggeredBy`/`ator` de Permutas/SISPAG/Recebimentos passa a gravar e-mail em vez do `username`
  histórico sem nenhum erro — quebra silenciosa de auditoria e do vínculo Conexos por usuário.
- **Dependências**: nenhuma para o card em si; é pré-requisito recomendado do passo 3 do ADR-0051 (Supabase Auth), não deste ciclo.

### [integrability-2] Registrar `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `CONFIG_MANIFESTO` (ou documentar por que ficam de fora)

- **Problema**
  > Este delta adicionou `AUTH_TRANSICAO_EMAIL_BANNER` ao `CONFIG_MANIFESTO`/`ConfigDoctor` (o
  > registro central de config do repo), mas renomeou `ADMIN_USERNAME`→`ADMIN_EMAIL` e tornou
  > `ADMIN_EMAIL`/`ADMIN_PASSWORD` obrigatórias sem as registrar no mesmo manifesto — aplicando o
  > padrão de forma parcial dentro do mesmo PR.

- **Melhoria Proposta**
  > Ou registrar as duas vars no `CONFIG_MANIFESTO` com `criticidade: OPCIONAL` (já que só importam
  > no `seed:admin` pontual, não no processo vivo — o `ConfigDoctor` roda no runtime do servidor), ou
  > adicionar um comentário no manifesto explicando por que vars de job one-shot ficam fora dele. A
  > segunda opção é provavelmente a correta dado o padrão existente (`ADMIN_USERNAME` nunca esteve
  > lá) — mas hoje não há nem uma coisa nem outra.

- **Resultado Esperado**
  > Critério de "o que entra no `CONFIG_MANIFESTO`" documentado uma vez (comentário no arquivo),
  > aplicável de forma consistente a toda var nova daqui pra frente.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Critério de inclusão no manifesto documentado: ausente → 1 comentário explícito no topo de `configManifest.ts`
- **Risco de não fazer**: nenhum risco operacional; próximo PR volta a ter a mesma dúvida (o que entra no manifesto?) sem resposta escrita.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo real do delta: nenhum client externo (`domain/client/`) foi tocado — a feature é
  autenticação/gestão de usuários interna. A maior parte do checklist de integrabilidade da missão
  (encapsulamento de clients, versionamento de API externa, contract tests com fixture de terceiro,
  convenção de path SSM) é **N/A para este delta especificamente**; me concentrei no que o delta de
  fato muda: o contrato interno FE↔BE e a dívida documentada para a troca futura de provedor de auth.
- **Cross-QA**: F-integrability-1 (resolução ad-hoc de `req.user.sub`/`req.user.email`) é
  primariamente um achado de **Modifiability** (mesmo código, mesmo risco: baixa localidade de
  mudança) — sinalizar para o consolidador não duplicar o card, ou linkar os dois.
  ADR-0051 D2 também tem uma leitura de **Security/auditoria** (o `sub` como identidade de trilha),
  vale checar se `qa-security` já cobriu.
- Não rodei nada contra banco/serviço real; toda evidência veio de leitura de código e do
  `_shared-metrics.md` fornecido (gates já medidos pelo orquestrador).
