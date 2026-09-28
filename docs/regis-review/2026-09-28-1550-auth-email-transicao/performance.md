---
qa: Performance
qa_slug: performance
run_id: 2026-09-28-1550-auth-email-transicao
agent: qa-performance
generated_at: 2026-09-28T18:40:00Z
scope: backend
score: 9
findings_count: 3
cards_count: 2
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/admin da Columbia | Login por e-mail OU usuário (`POST /auth/login`) em horário de pico de acesso (início do expediente) | `AuthService.login` → `UserRepository.findByLoginIdentifier` → `app_user` | Instância Render quente, Postgres com 15 linhas em `app_user`, pool já aberto | Autentica com 1 round-trip SQL (índice funcional `lower()`) + 1 `bcrypt.compare` (bcryptjs, 12 rounds) | p95 login ≤ 300ms (proxy: 1 SELECT indexado + 1 hash bcrypt síncrono) |
| Admin da Columbia | Abre `/usuarios` para editar e-mail de um colega | `UserRepository.listAll` → `GET /usuarios` → tabela React | Tabela cresce lentamente (usuário interno, não transacional) | Lista completa sem paginação, 1 round-trip SQL + 1 round-trip para `/usuarios/meta` (paralelizados no front) | payload ≤ 15 linhas hoje; sem LIMIT, cresce linear com o tempo — defensável apenas porque `app_user` não é uma tabela transacional |

Esta feature é **API Gateway → Lambda-equivalente (Express hoje)**, sem componente SQS/EventBridge — não há fila, fan-out por front nem cron novo neste delta. O cenário de throughput (lotes, permutas, GED) não se aplica aqui.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `# novas dependências de runtime (backend+frontend)` | 0 | 0 | ✅ | `git diff origin/main...HEAD -- src/backend/package.json src/frontend/package.json` (sem saída) |
| `# selectMany sem LIMIT tocados pelo delta` | 1 (`UserRepository.listAll`) | 0 em rota API sem paginação | ⚠️ | `src/backend/domain/repository/auth/UserRepository.ts:145-166`; **PRÉ-EXISTENTE** — o delta só adicionou 3 colunas ao `SELECT`, não a ausência de `LIMIT` (confirmado via `git diff` linha a linha) |
| `# suspected N+1 sites no delta` | 0 | 0 | ✅ | Inspeção manual de `AuthService.ts`, `UserAdminService.ts`, `UserRepository.ts`, `routes/auth.ts`, `routes/usuarios.ts` — nenhum `await repo.X()` dentro de `for`/`map`/`forEach` |
| Índices para os novos predicados (`lower(username)`, `lower(email)`) | 2 índices únicos funcionais criados na própria migration | 100% dos predicados de `WHERE`/`ORDER` cobertos | ✅ | `src/backend/migrations/0064_app_user_email.sql:34-40` (`uq_app_user_email_lower`, `uq_app_user_username_lower`) |
| `# manual timers (setTimeout/setInterval) introduzidos pelo delta` | 0 | 0 | ✅ | `grep -rn "setTimeout\|setInterval" src/backend/domain/service/auth src/backend/domain/repository/auth src/backend/routes/auth.ts src/backend/routes/usuarios.ts` → vazio |
| Cache de config (`EnvironmentProvider`) reaproveitado pelo delta | Sim — `authJwtSecret`, `authTransicaoEmailBanner` lidos via `getEnvironmentVars()` já cacheado em `this.environmentVars` | 0 re-fetch por chamada | ✅ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:14-22` (singleton, cache em instância) |
| Round-trips paralelizados no carregamento de `/usuarios` | `Promise.all([fetchUsuarios(), fetchUsuariosMeta()])` | Evitar waterfall em telas com ≥2 chamadas independentes | ✅ | `src/frontend/app/usuarios/page.tsx:51-54` |
| Custo do bcrypt (`bcryptjs`, 12 rounds) no caminho de login | Não medido (proibido rodar contra ambiente real) | bcryptjs puro-JS a 12 rounds tipicamente 150–300ms/hash em CPU de instância pequena | ⚠️ **Não medível localmente** — requer benchmark isolado; **PRÉ-EXISTENTE**: o delta troca `findByUsername` por `findByLoginIdentifier`, mas `bcrypt.compare`/`BCRYPT_ROUNDS=12` já existiam antes (`git diff` mostra só a query mudando, não o bcrypt) |
| Bundle/deploy size impactado pelo delta | Sem dependências novas; 35 arquivos, +2688/-156 linhas, nenhum import pesado no topo dos arquivos tocados | N/A (sem Lambda real neste repo — deploy é Render/Vercel) | ✅ | `git diff --stat`; `grep -rn "^import" src/backend/routes/auth.ts src/backend/routes/usuarios.ts src/backend/domain/service/auth/*.ts` — todos os imports são módulos já usados alhures (`zod`, `bcryptjs`, `jose`, `tsyringe`) |

> ⚠️ **Não medível localmente**: latência real (p50/p95) de `POST /auth/login` e `GET /usuarios` em produção. Requer APM (New Relic/Datadog) ou logs de latência do Render — nenhum dos dois está instrumentado neste delta. Recomendação: adicionar duração ao `LogService` de `AuthService.login` (start/end) para que o primeiro incidente de lentidão já tenha dado.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — sem stream de eventos nesta feature (login é request/response 1:1) | N/A | — |
| Limit Event Response | `GET /auth/transicao` devolve só `{ ativo }` — payload mínimo, sem N+1 fields | ✅ presente | `src/backend/routes/auth.ts:57-64` |
| Prioritize Events | N/A — sem fila/priorização; Express serve todas as rotas com a mesma prioridade | N/A | — |
| Reduce Overhead | `SELECT` com colunas explícitas (nunca `SELECT *`); JWT assinado 1x por login, sem round-trip extra | ✅ presente | `UserRepository.ts:118-123, 134-142, 146-151` |
| Bound Execution Times | Sem timeout explícito nas chamadas `fetch` do frontend (`apiFetch`, `fetchTransicaoEmail`) — mas é padrão **pré-existente** (`lib/http.ts` não está no delta) | ⚠️ parcial (pré-existente) | `src/frontend/lib/http.ts` (fora do delta); `src/frontend/lib/auth/transicao.ts:16` (`fetch` sem `AbortController`) |
| Increase Resource Efficiency | Índices funcionais criados junto com o predicado que os usa (`lower(username)`/`lower(email)`); `EnvironmentProvider` cacheado em instância | ✅ presente | `migrations/0064_app_user_email.sql:34-40`; `EnvironmentProvider.ts:14-22` |
| Increase Resources | N/A — sem ajuste de infra/pool neste delta (pool do Postgres não foi tocado) | N/A — justificativa: `PostgreeDatabaseClient.ts` não está no diff | — |
| Increase Concurrency | `Promise.all` no carregamento de `/usuarios` (lista + meta em paralelo) | ✅ presente | `src/frontend/app/usuarios/page.tsx:51-54` |
| Maintain Multiple Copies of Computations | N/A — não aplicável a CRUD de usuários | N/A | — |
| Maintain Multiple Copies of Data | N/A — sem cache de leitura para `app_user` (tabela pequena, mudança rara — dispensável) | N/A — justificativa: tabela de gestão interna, não hot-path de negócio | — |
| Bound Queue Sizes | N/A — sem fila nesta feature | N/A | — |
| Schedule Resources | N/A — sem job/cron neste delta | N/A | — |

## 4. Findings (achados)

### F-performance-1: `UserRepository.listAll` sem `LIMIT`/`OFFSET` (PRÉ-EXISTENTE, delta amplia o payload)

- **Severidade**: P3 (baixo — débito pré-existente tocado, sem regressão de comportamento)
- **Tactic violada**: Bound Execution Times / Increase Resource Efficiency (Dynamic WHERE Pattern do CLAUDE.md prevê `LIMIT $X OFFSET $Y`)
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:145-166`
- **Evidência (objetiva)**:
  ```sql
  SELECT id, username, role, ativo, created_by, created_at, conexos_username,
         email, email_updated_by, email_updated_at
  FROM app_user
  ORDER BY created_at DESC, id DESC
  -- sem LIMIT/OFFSET
  ```
  `git diff` confirma que o delta só ACRESCENTOU 3 colunas (`email`, `email_updated_by`, `email_updated_at`) ao `SELECT` já sem `LIMIT` — a ausência de paginação é anterior a este PR.
- **Impacto técnico**: Nenhum hoje (15 linhas, tabela de gestão interna de acessos — não recebe inserts em lote). Se a Columbia um dia federar `app_user` com um diretório maior (ex.: SSO corporativo do passo 3 do ADR-0051), o payload cresce sem controle.
- **Impacto de negócio**: Nenhum no curto prazo; risco fica latente até o passo 3 do plano de auth.
- **Métrica de baseline**: 15 usuários em produção, 14 ativos (fonte: `_shared-metrics.md`, "Baseline de contagem").

### F-performance-2: Chamadas `fetch` do frontend sem timeout explícito (PRÉ-EXISTENTE, tocado pelo delta em `lib/auth/transicao.ts`)

- **Severidade**: P3 (baixo — mitigado pelo fail-closed já implementado)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/frontend/lib/auth/transicao.ts:16` (novo, sem timeout); `src/frontend/lib/http.ts` (pré-existente, `apiFetch` também sem timeout — usado por `lib/usuarios.ts`)
- **Evidência (objetiva)**:
  ```ts
  const res = await fetch(`${API}/auth/transicao`, { cache: 'no-store' })
  ```
  Sem `AbortController`/`signal`. Se o backend travar (não retornar erro, só não responder), a chamada fica pendente pelo timeout padrão do navegador (minutos), não pelos ~300ms esperados de uma leitura de env cacheada.
- **Impacto técnico**: Mitigado pelo desenho já documentado no próprio arquivo: falha (incluindo timeout implícito) cai em `false` e o banner simplesmente não aparece — o formulário de login nunca fica bloqueado esperando essa chamada (`TransicaoEmailBanner.tsx:20-27`, estado inicial `ativo=false`, sem loading que bloqueie o form).
- **Impacto de negócio**: Nenhum mensurável — é um banner informativo, não uma dependência do fluxo de login. O padrão sem timeout é sistêmico (pré-existente em `lib/http.ts`, fora do escopo do delta) e vale para TODOS os `fetch` do frontend, não só os desta feature.
- **Métrica de baseline**: N/A — não medível sem instrumentar `lib/http.ts` (fora do delta).

### F-performance-3: Custo do `bcryptjs` (puro-JS, 12 rounds) no caminho de login não instrumentado (PRÉ-EXISTENTE)

- **Severidade**: P3 (baixo — informativo; sem regressão introduzida pelo delta)
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/auth/AuthService.ts:83` (`bcrypt.compare`), `src/backend/domain/service/auth/UserAdminService.ts:13,109,190` (`bcrypt.hash`, `BCRYPT_ROUNDS=12`)
- **Evidência (objetiva)**: `bcryptjs` é uma implementação 100% JavaScript (sem binding nativo `bcrypt`/`libsodium`), single-threaded — 12 rounds tipicamente custam 150–300ms de CPU síncrona por chamada, bloqueando o event loop do processo Express durante esse intervalo. O delta não introduz isso (já era `BCRYPT_ROUNDS=12` antes, só a query de busca do usuário mudou de `findByUsername` para `findByLoginIdentifier`).
- **Impacto técnico**: Sob concorrência alta (vários logins simultâneos), cada `bcrypt.compare` compete pelo mesmo event loop — throughput de login degrada linearmente com a concorrência, não é paralelizável dentro da mesma instância. Baixo risco aqui: login não é hot-path de alta frequência (é um formulário humano, não um SQS fan-out).
- **Impacto de negócio**: Nenhum hoje — 15 usuários, sem pico de login simultâneo esperado.
- **Métrica de baseline**: **Não medível localmente** (proibido rodar contra banco/ambiente real nesta revisão). Recomendação: se o passo 3 do ADR-0051 (SSO) não eliminar esse caminho, medir com `node --prof` antes de escalar o número de usuários.

## 5. Cards Kanban

### [performance-1] Adicionar paginação defensiva a `GET /usuarios`

- **Problema**
  > `UserRepository.listAll` roda `SELECT ... FROM app_user ORDER BY created_at DESC, id DESC` sem `LIMIT`/`OFFSET` (pré-existente; o delta ampliou o `SELECT` em 3 colunas sem tocar a paginação). Hoje inofensivo (15 linhas), mas contraria o `Dynamic WHERE Pattern` do CLAUDE.md e vira dívida silenciosa se `app_user` crescer com a federação do passo 3 do ADR-0051 (SSO corporativo).

- **Melhoria Proposta**
  > Aplicar a tactic **Bound Execution Times**: adicionar `LIMIT $limit OFFSET $offset` (padrão já usado em outros repositórios do domínio) a `UserRepository.listAll`, com um teto default (ex.: 200) mesmo sem paginação de UI — protege contra crescimento inesperado sem exigir redesenho da tela agora. Arquivo: `src/backend/domain/repository/auth/UserRepository.ts`.

- **Resultado Esperado**
  > `GET /usuarios` nunca devolve mais que o teto configurado, mesmo que `app_user` cresça 100x. Payload hoje: ~15 linhas / sem teto → payload após: mesmo comportamento até 200 linhas, com teto explícito documentado (não é mudança de comportamento visível, é um cinto de segurança).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Presença de `LIMIT` no `SELECT` de `listAll`: ausente → presente
  - Teto de linhas por chamada: ilimitado → 200 (configurável)
- **Risco de não fazer**: Baixo em 6 meses (a tabela cresce por cadastro manual de admin, não por evento de negócio) — mas se o passo 3 do ADR-0051 popular `app_user` a partir de um diretório SSO, o risco sobe de P3 para P1 sem aviso.
- **Dependências**: Nenhuma; pode ser feito isoladamente.

### [performance-2] Instrumentar duração de `AuthService.login` no `LogService`

- **Problema**
  > Não há nenhuma métrica de latência para `POST /auth/login` — nem localmente (proibido medir contra ambiente real nesta revisão) nem em produção (sem APM). Se o `bcryptjs` (F-performance-3) ou a nova query `findByLoginIdentifier` degradarem sob carga, o primeiro sinal será uma reclamação de usuário, não um alarme.

- **Melhoria Proposta**
  > Aplicar a tactic **Reduce Overhead / observabilidade de latência**: envolver `AuthService.login` com uma medição simples (`Date.now()` no início/fim, campo `durationMs` no `LogService.info`/`error` já emitido para o caso de múltiplos candidatos). Não é uma tactic nova de código — é o gancho que faltava para a próxima revisão de performance ter um número real em vez de "não medível localmente".

- **Resultado Esperado**
  > `LogService` passa a registrar `durationMs` em todo login (sucesso ou falha). Métrica hoje: inexistente → métrica após: p50/p95 de login disponível nos logs do Render em 1 semana de operação.

- **Tactic alvo**: Reduce Overhead (via observabilidade — insumo para futuras decisões de Bound Execution Times)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Cobertura de `durationMs` em logs de login: 0% → 100%
- **Risco de não fazer**: Baixo agora; sobe quando o volume de usuários crescer o suficiente para o custo do `bcryptjs` (150–300ms/chamada) começar a competir por CPU do processo Express.
- **Dependências**: Nenhuma.

## 6. Notas do agente

- Escopo: apenas os arquivos do delta (`git diff origin/main...HEAD`), com `--quick` — nenhuma medição contra banco/ambiente real foi executada (proibido pelo enunciado); todas as métricas de latência real ficam marcadas "Não medível localmente".
- `F-performance-1` e `F-performance-3` são PRÉ-EXISTENTES tocados pelo delta (confirmado linha a linha via `git diff`) — mantidos em P3, nunca promovidos a P0/P1 por esta feature, conforme instrução do escopo.
- Cross-QA: F-performance-2 (falta de timeout em `fetch`) é o MESMO achado que Availability/Fault Tolerance provavelmente reportam para `lib/http.ts` — não duplicar card, só o finding aqui como referência de latência. F-performance-1 (paginação) se cruza com Modifiability (schema/paginação como padrão do domínio) — mencionar no consolidator.
- Pool de conexões do Postgres (`PostgreeDatabaseClient.ts`) e bundle/Lambda real não avaliados numericamente: o arquivo não está no diff e este repositório ainda não tem `infra/`/Lambda real (deploy é Render/Vercel) — nada a medir de cold start aqui.
