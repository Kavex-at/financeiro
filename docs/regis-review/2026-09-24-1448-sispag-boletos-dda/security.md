---
qa: Security
qa_slug: security
run_id: 2026-09-24-1448-sispag-boletos-dda
agent: qa-security
generated_at: 2026-09-24T14:48:00-03:00
scope: backend+frontend (delta PR #85 — aba Boletos DDA)
score: 8
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

Escopo: apenas o delta da branch `worktree-sispag-boletos-dda-tab` (PR #85, aba
"Boletos DDA (fin124)"). Nenhuma análise do repositório inteiro; nenhum `npm audit`
profundo (`--quick`).

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Ator interno mal-intencionado, ou externo que capturou um JWT `admin` | Chama `GET /sispag/boletos-dda?escopo=todos` em loop para exfiltrar o pool DDA (barras + linhas digitáveis com banco/agência/conta do cedente — LGPD/LC 105) | `src/backend/routes/sispag.ts:415-446` + `ConsolidacaoBoletoDda` (24.137 boletos por resposta em prod local) | Produção Render, JWT válido, dentro do rate-limit global (100/min/IP) | (1) auth `requireRole('admin')` bloqueia não-admin (401/403); (2) admin autenticado consegue baixar tudo — o guard confia em quem porta o token; (3) POST de sync tem `heavyRouteLimiter` (10/min) e advisory lock (429/409) | 0 rotas novas sem authz; sync não-idempotente barrada por lock; audit trail do "quem sincronizou" existe só em stdout (não em tabela) |

Traço do delta em uma frase: **rotas cadastradas com defesa em profundidade convencional (JWT → RBAC admin → Zod → SQL parametrizado); a superfície nova aumenta o valor do JWT `admin`, porque um token comprometido devolve, em uma requisição de 393 ms, 24 mil linhas digitáveis com dados bancários dos cedentes.**

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `grep -rEn "(password\|secret\|token\|credential)\s*[:=]\s*['\"][^'\"]{8,}"` sobre os 14 arquivos alterados |
| `.env`/state adicionados | 0 | 0 | ✅ | `git diff --stat origin/main...HEAD` |
| Rotas novas com `requireRole('admin')` | 2/2 (GET e POST) | 100% | ✅ | `src/backend/routes/sispag.ts:419,435` |
| Rotas novas com Zod no boundary HTTP | 1/1 (GET; POST não tem body) | 100% da parte relevante | ✅ | `src/backend/routes/sispag.ts:410-412,422-426` |
| Boundary Zod no cliente ERP (`fin124/list`, `fin124/itens/list`) | Sim (`ARQUIVO_SCHEMA`, `ITEM_SCHEMA`) | Sim | ✅ | `src/backend/domain/client/ConexosDdaClient.ts:20-43,66,84` |
| SQL parametrizado nos arquivos novos (`$name`) | 100% | 100% | ✅ | `BoletoDdaRepository.ts:38,52-57,67-70,97-107,116-125,132-133`; `LotePagamentoRepository.ts:207-211` |
| SQL com interpolação de string em coluna variável | 1 (identificadores `$a${i}`…`$b${i}` gerados por template — mas os VALUES bindings são todos `$…` parametrizados; nada de valor de usuário concatenado em string) | 0 sítios com input do usuário concatenado | ✅ | `BoletoDdaRepository.ts:77-108` |
| `dangerouslySetInnerHTML` / `innerHTML` no frontend do delta | 0 | 0 | ✅ | grep sobre `BoletosDdaTab.tsx`, `CandidatosBoletoDialog.tsx`, `lib/sispag.ts` |
| Nova escrita no ERP (fin124/importar, fin124/cancelar) | 0 | 0 (feature declarada read-only) | ✅ | `ConexosDdaClient.ts:50-55` — só `list` e `itens/list` |
| CSRF | N/A (Bearer no header, sem cookie de sessão) | N/A | ✅ | `src/frontend/lib/auth/token.ts:27-32`; `sispag.ts:833-841` |
| Rate-limit no POST `/boletos-dda/sincronizar` | 10/min/IP (`heavyRouteLimiter`) | Presente | ✅ | `routes/sispag.ts:436`; `http/rateLimit.ts:28-35` |
| Rate-limit no GET `/boletos-dda` | 100/min/IP (`globalLimiter` global) | Presente | ⚠️ ver F-security-2 | `http/buildApp.ts:54` |
| Payload máximo de uma resposta (`escopo=todos`) | 24.137 linhas com `codbar` + `linhaDigitavel` por linha; ~393 ms para gerar | Idealmente paginado ou barrado por default | ⚠️ ver F-security-2 | `_shared-metrics.md`; `routes/sispag.ts:411,415-430` |
| Audit trail persistido do sync (tabela consultável) | Ausente — só stdout via `LogService.info` | Presente (paralelo ao `pagamento_ingestao_run`) | ⚠️ ver F-security-3 | `BoletoDdaService.ts:133-137`; comparar `IngestaoPagamentosService.ts:34-35` |
| Log de valores sensíveis (`codbar`, `linhaDigitavel`) | 0 sítios (WARN de falha loga só `ddcCod` + `erro`) | 0 | ✅ | `BoletoDdaService.ts:117-124` |
| Rotas novas sem autenticação | 0 | 0 | ✅ | JWT global em `buildApp.ts:116` + `requireRole('admin')` em cada rota |

> ⚠️ **Não medível localmente**: taxa de falha de autenticação por IP/usuário (`# 401 nas rotas /boletos-dda`). Sem métrica agregada persistida — hoje só `console.warn` no processo. Recomendação: alarme sobre `[auth] rejected` no log Render.
> ⚠️ **Não medível localmente**: uso real da rota em produção (não deployada). Baseline vem do backend local com Postgres em container (ver `_shared-metrics.md`).
> ⚠️ **Não medível localmente**: `npm audit` (execução com `--quick`, saltada por instrução do usuário).

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Nenhuma detecção específica do delta; herda o `console.warn('[auth] rejected …')` do middleware global | ⚠️ parcial | `src/backend/http/auth.ts:189-193` |
| Detect Service Denial | `heavyRouteLimiter` no POST e advisory lock (`BOLETO_DDA_SYNC_LOCK_KEY`) barram flood; nada específico para GET | ⚠️ parcial | `routes/sispag.ts:436`; `BoletoDdaService.ts:72-80` |
| Verify Message Integrity | Zod estrito no boundary do ERP: linhas do `fin124` sem `ddcCod`/`ditMnyValor` são descartadas, não convertidas em `0` | ✅ presente | `ConexosDdaClient.ts:20-43,66,84` |
| Detect Message Delay | Timeout/retry no `ConexosBaseClient` (herdado); `runWithRetry` envolve cada página do `fin124` | ✅ presente | `ConexosDdaClient.ts:119-132` |
| Identify Actors | `ator(req)` deriva `sub`/`email` do JWT; propagado como `triggeredBy` no sync | ✅ presente | `routes/sispag.ts:92,441`; `BoletoDdaService.ts:69-71,133-137` |
| Authenticate Actors | JWT Supabase/HS256 verificado antes de qualquer rota (menos `/health`, `/auth`); `401` sem token medido | ✅ presente | `http/buildApp.ts:116`; `http/auth.ts:118-196`; métrica `_shared-metrics.md` (401 sem token) |
| Authorize Actors | `requireRole('admin')` em GET e POST do DDA — o guard é o mesmo do `.REM` e das linhas digitáveis do lote (LGPD/LC 105) | ✅ presente | `routes/sispag.ts:419,435`; comentários citam `LGPD Art. 6º e LC 105` |
| Limit Access | RBAC admin + rate-limit por camada; nenhuma escrita no ERP; `fin124/importar`/`cancelar` deliberadamente não expostos | ✅ presente | `ConexosDdaClient.ts:50-55` |
| Limit Exposure | Endpoint devolve o **pool inteiro** (24k linhas com `codbar` + `linhaDigitavel`) quando `escopo=todos`; nenhuma paginação server-side, sem opt-in explícito por campo sensível | ⚠️ parcial — ver F-security-2 | `routes/sispag.ts:411,415-430`; `ConsolidacaoBoletoDda.ts:107-121` |
| Encrypt Data | TLS herdado (Render/Vercel). Postgres em repouso: fora do delta (não configurado neste repo). Barras/linhas digitáveis em `boleto_dda.codbar TEXT` sem hash — mas o dado precisa ser reversível (a analista cola no banco) | ✅ presente para trânsito; N/A para repouso | `migrations/0062_boleto_dda.sql:30` |
| Separate Entities | Nenhuma separação nova: o serviço, o repositório e o cliente estão no mesmo processo Express e no mesmo Postgres da carteira. Consistente com o resto do backend | ⚠️ N/A no nível de delta; tratativa é do estado-alvo (Lambda + conta por tenant) | `CLAUDE.md` — "Estado Atual vs Alvo" |
| Change Default Settings | Advisory lock com chave própria (`726354820`), distinta das ingestões existentes; SQL não usa `SELECT *`; escopo default do endpoint é o mais restrito (`a-vencer`) | ✅ presente | `BoletoDdaService.ts:23`; `routes/sispag.ts:411` |
| Validate Input | Zod no boundary HTTP (`boletosDdaSchema`) e no boundary ERP (`ARQUIVO_SCHEMA`, `ITEM_SCHEMA`) | ✅ presente | `routes/sispag.ts:410-412,422-426`; `ConexosDdaClient.ts:20-43` |
| Revoke Access | N/A no delta — depende do sistema de auth (JWT expira em 12h; sem revogação server-side) | N/A | Herdado — não é do escopo deste PR |
| Lock Computer | N/A — não é o modelo do produto | N/A | — |
| Inform Actors | Toast na UI em sucesso/falha/`SincronizacaoDdaEmAndamentoError`; nenhum aviso para o operador quando um usuário `admin` chama `escopo=todos` (alto valor exfiltrável) | ⚠️ parcial | `BoletosDdaTab.tsx:171-190` |
| Restore | Sync é idempotente (upsert por `(ddc_cod, dit_cod)`, transação por arquivo); um segundo run corrige um snapshot corrompido. Nenhum estado do ERP é tocado — recovery não passa por rollback bancário | ✅ presente | `BoletoDdaRepository.ts:48-75` |
| Audit Trail | `LogService.info` com `triggeredBy` + contagens em stdout. **Sem tabela consultável** (contraste com `pagamento_ingestao_run`). Um `SELECT` para "quem sincronizou o DDA nas últimas 24h" não existe | ⚠️ parcial — ver F-security-3 | `BoletoDdaService.ts:133-137`; comparar `IngestaoPagamentosService.ts:34-35` |

## 4. Findings

### F-security-1: `POST /sispag/boletos-dda/sincronizar` cobre-se de RBAC + advisory lock; `GET /sispag/boletos-dda` tem o mesmo guard e Zod — 0 gaps críticos no boundary HTTP

- **Severidade**: P3 (positivo — é o baseline de confiança para não escalar os outros achados)
- **Tactic**: Authenticate Actors, Authorize Actors, Validate Input
- **Localização**: `src/backend/routes/sispag.ts:407-446`
- **Evidência**:
  ```
  requireRole('admin'), asyncHandler(...)       # ambos os endpoints
  boletosDdaSchema.safeParse(req.query)         # Zod no query
  BOLETO_DDA_SYNC_LOCK_KEY = 726354820          # lock exclusivo ≠ ingestões
  heavyRouteLimiter                             # 10 req/min no POST
  ```
- **Impacto técnico**: nenhum — é o comportamento esperado.
- **Impacto de negócio**: dá tração ao restante do delta; sem esse baseline, as descobertas seguintes virariam bloqueadores.
- **Métrica de baseline**: `# rotas novas com authorizer explícito = 2/2 (100%)`; 401 medido em resposta a request sem token (`_shared-metrics.md`).

### F-security-2: `GET /sispag/boletos-dda?escopo=todos` devolve 24.137 linhas com `codbar` + `linhaDigitavel` em uma única resposta

- **Severidade**: P2 (débito técnico defensável — o dado é necessário para a analista, mas o volume por chamada aumenta o valor de um token `admin` capturado)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/routes/sispag.ts:411,415-430`; `src/backend/domain/service/sispag/BoletoDdaService.ts:53-67`; `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:107-121` (adiciona `linhaDigitavel` + `bancoEmissor` a cada linha)
- **Evidência**:
  ```
  Sync completo (prod local): 24.137 boletos
  GET /sispag/boletos-dda?escopo=todos → 200, 24.137 boletos, 393 ms
  Cada linha inclui: codbar (44 dígitos), linhaDigitavel (47), bancoEmissor
  Situações: SEM_TITULO 23.325 · CANDIDATO 481 · AMBIGUO 300 · VINCULADO 31
  ```
- **Impacto técnico**: um único GET vaza a carteira DDA inteira do CNPJ pagador. `codbar` carrega banco, agência, conta e valor do cedente (campo livre do CNAB) — LGPD Art. 6º e sigilo bancário (LC 105) mencionados nos próprios comentários da rota.
- **Impacto de negócio**: se um JWT `admin` for capturado (roubo de máquina, extensão de browser maliciosa, phishing em um dos poucos admins), o atacante extrai a carteira DDA inteira em <1s. Isso é mais grave que o `.REM` do lote (que só carrega os favorecidos do lote), porque o pool DDA cobre a EMPRESA INTEIRA.
- **Métrica de baseline**: 24.137 linhas × ~120 bytes/linha ≈ 2,9 MB por resposta; `SEM_TITULO 23.325` = 96,6% dos boletos são de cedentes sem título aberto (dado de terceiros, não da Columbia). `globalLimiter` = 100/min: teto teórico ≈ 240 MB/min por IP.

### F-security-3: sincronização DDA não persiste run em tabela consultável — audit trail só em stdout via `LogService.info`

- **Severidade**: P2 (débito técnico — a ação não move dinheiro, mas descumpre o padrão dos irmãos de ingestão)
- **Tactic violada**: Audit Trail (Bass Recover from Attacks); overlap com Fault Tolerance
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:69-139`; comparar com `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:34-35` (usa `PagamentoIngestaoRunRepository`) e a rota `GET /sispag/ingestao/runs` em `routes/sispag.ts:449-457`
- **Evidência**:
  ```
  // BoletoDdaService.sincronizar → só grava LogService.info { triggeredBy, arquivosNovos, ... }
  // Nenhuma tabela boleto_dda_sync_run
  // Nenhuma rota GET /sispag/boletos-dda/runs
  // Migração 0062 cria boleto_dda + boleto_dda_arquivo — sem tabela de runs
  ```
- **Impacto técnico**: para responder "quem chamou o sincronizar? em que hora? com que resultado?" fora da janela de retenção de log do Render, é necessário garimpar stdout. Um insider com JWT `admin` pode acionar o sync repetidamente para forçar chamadas ao Conexos (aumentando a probabilidade de o `MPS_FRANCINEI` chegar em `LOGIN_ERROR_MAX_SESSIONS`) e não deixa rastro consultável.
- **Impacto de negócio**: forense mais lenta em qualquer incidente que envolva "quem trouxe o snapshot que apareceu na tela"; e uma prática assimétrica entre as duas ingestões do SISPAG (permutas e pagamentos têm run persistido; DDA não).
- **Métrica de baseline**: `# runs persistidos após sync = 0`; `# runs de ingestão de pagamentos persistidos (schema irmão) = todas`. Retenção de stdout Render depende de plano — não é `SELECT`ável a partir do produto.

### F-security-4: JWT stored in `localStorage` (pré-existente, ampliado em valor pela feature)

- **Severidade**: P3 (não é regressão do delta; é pré-existente, mas o delta aumenta o valor do token roubado)
- **Tactic violada**: Limit Exposure (armazenamento de credenciais)
- **Localização**: `src/frontend/lib/auth/token.ts:6-20`
- **Evidência**:
  ```
  export const TOKEN_STORAGE_KEY = 'auth_token'
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined
  ```
- **Impacto técnico**: qualquer XSS em qualquer página do frontend, ou extensão de browser com permissão a `localStorage`, exfiltra o token. O delta não introduz XSS (grep 0 para `dangerouslySetInnerHTML`), mas amplia o payload alcançável com esse token (F-security-2).
- **Impacto de negócio**: mesma superfície do resto do SISPAG; a decisão de mover o token para cookie HttpOnly/SameSite é do backlog do produto, não do delta. Fica registrado como link para o consolidator.
- **Métrica de baseline**: 1 token em `localStorage` por sessão autenticada; 0 tokens em cookie HttpOnly.

## 5. Cards Kanban

### [security-1] Persistir cada sincronização de DDA em `boleto_dda_sync_run`

- **Problema**
  > `BoletoDdaService.sincronizar` só emite `LogService.info` com `triggeredBy` + contagens. Uma pergunta trivial ("quem sincronizou o DDA hoje?") exige garimpo do stdout do Render — enquanto `IngestaoPagamentosService` já persiste em `pagamento_ingestao_run` e expõe em `GET /sispag/ingestao/runs`. Além da assimetria, um insider `admin` pode acionar o sync repetidamente sem deixar rastro consultável, o que consome sessões do `MPS_FRANCINEI` no Conexos (que hoje já satura em `LOGIN_ERROR_MAX_SESSIONS`).

- **Melhoria Proposta**
  > Espelhar o padrão do irmão: adicionar tabela `boleto_dda_sync_run (id UUID, triggered_by TEXT, status TEXT, arquivos_novos INT, arquivos_relidos INT, boletos INT, falhas INT, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, error_message TEXT)` em uma migração aditiva; instanciar `BoletoDdaSyncRunRepository`; envolver `executarSincronizacao` com createRun/finishRun (idem `IngestaoPagamentosService`); expor `GET /sispag/boletos-dda/runs`. Tactic Bass alvo: **Audit Trail**.

- **Resultado Esperado**
  > `# runs de sync persistidos = 100% dos triggers` (hoje 0). Consulta forense por SQL: "quem sincronizou o DDA e com quantas falhas na última hora" responde em um `SELECT` só, sem depender de retenção de stdout.

- **Tactic alvo**: Audit Trail (Bass Recover from Attacks)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — a migração é aditiva, o repositório copia o `PagamentoIngestaoRunRepository`, o serviço já tem os campos prontos no retorno.
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - `# runs persistidos após sync`: 0 → 100%
  - Tempo para responder "quem sincronizou o DDA e quando" via SQL: N/A (só stdout) → <1s

- **Risco de não fazer**: em 6 meses, quando um analista pergunta por que o DDA ficou desatualizado às 14h e o log do Render já expirou, ninguém consegue reconstituir se foi lock, falha do Conexos ou falta de trigger.
- **Dependências**: nenhuma; a migração 0062 já é aditiva.

### [security-2] Limitar o payload do `GET /sispag/boletos-dda` — server-side pagination ou opt-in para "todos"

- **Problema**
  > `GET /sispag/boletos-dda?escopo=todos` devolve 24.137 linhas com `codbar` + `linhaDigitavel` em uma única resposta (~2,9 MB, 393 ms medido). Cada `codbar` carrega banco, agência, conta e valor do cedente — dados de TERCEIROS (96,6% dos boletos são `SEM_TITULO`, ou seja, cedentes sem título aberto na Columbia). Um único JWT `admin` capturado extrai a carteira DDA inteira do CNPJ pagador em uma requisição. A rota já tem `requireRole('admin')` (bem), mas o escopo `todos` não é opt-in nem paginado — a UI clica no botão e recebe tudo, o que apaga a fricção que o admin encontraria antes de exfiltrar.

- **Melhoria Proposta**
  > Adotar pelo menos uma destas defesas, em ordem de esforço: (a) paginação server-side em `escopo=todos` (`?after=<ddc_cod>&limit=1000`), com `Link: rel="next"`; (b) alarme em `console.warn` + métrica dedicada quando `escopo=todos` for chamado (Bass **Detect Intrusion**) — hoje o log só imprime a URL; (c) para o consumidor real (a aba que filtra client-side), sublime o filtro para o backend (`?situacao=CANDIDATO`) e mande `SEM_TITULO` só quando pedido. Tactic Bass alvo: **Limit Exposure**.

- **Resultado Esperado**
  > Payload máximo por request: 24.137 → ≤1.000 linhas (paginado) OU alarme registrado ao consumir `?escopo=todos`. Volume máximo exfiltrável com 1 token em 1 min: 240 MB → ≤10 MB (paginação) ou ≤2,9 MB com evento de auditoria por consumo.

- **Tactic alvo**: Limit Exposure (Bass Resist Attacks)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — a UI hoje espera todo o array e faz `useTabelaFiltro` no cliente; mover filtro/paginação para o backend afeta `BoletosDdaTab.tsx` (loading, contagem por situação) e o endpoint. Alternativa (b) é S (algumas horas).
- **Findings relacionados**: F-security-2 (também toca Performance-3 na aba correspondente).
- **Métricas de sucesso**:
  - Linhas por request p95: 24.137 → ≤1.000
  - `# eventos de auditoria quando escopo=todos` (se ficar com opção b): N/A → 100%
- **Risco de não fazer**: em um incidente de vazamento de token (roubo de laptop de operador, extensão maliciosa), o atacante baixa a carteira DDA inteira antes de qualquer detecção — hoje o rate-limit global (100/min) autoriza 100 dumps completos por minuto.
- **Dependências**: cross-QA — Performance-3 (payload de 24k linhas) e Integrability-2 (contrato do endpoint).

### [security-3] Alarme para `admin` chamando `escopo=todos` repetidamente

- **Problema**
  > O rate-limit atual (`globalLimiter` 100/min/IP) foi calibrado para floods anônimos, não para exfiltração autenticada. Um `admin` autenticado com o token válido pode chamar `GET /sispag/boletos-dda?escopo=todos` até 100× por minuto sem que nada acione — o `LogService.info` do fetch corre no fluxo normal e não distingue "1 chamada legítima quando abre a aba" de "50 chamadas em 60s". Não há alarme sobre volume por usuário.

- **Melhoria Proposta**
  > Middleware simples que conta chamadas por `sub` do JWT nas últimas N horas para este endpoint (SLA-style, tipo `express-rate-limit` com `keyGenerator: req.user.sub`) e emite um WARN quando passa de um teto (ex.: 20 GET `?escopo=todos` em 1h por usuário). Reaproveita o `console.warn('[auth] ...')` que hoje só cobre 401/403. Tactic Bass alvo: **Detect Intrusion**.

- **Resultado Esperado**
  > `# alarmes emitidos em polling anômalo por usuário`: 0 → 100% de detecção após o teto. Um operator lendo o log Render vê `[dda] admin sub=… chamou escopo=todos 25x em 1h` e pode invalidar o token.

- **Tactic alvo**: Detect Intrusion (Bass Detect Attacks)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2, F-security-4
- **Métricas de sucesso**:
  - Detecção de dump em série: 0/6 (por hora) → 6/6 quando > teto
- **Risco de não fazer**: um insider malicioso não é distinguido de um usuário normal pela telemetria atual; o vazamento só é notado ex-post via `git log` de um artefato externo.
- **Dependências**: idealmente vem depois de [security-1] (para reaproveitar a mesma tabela de eventos).

### [security-4] Mover o JWT do `localStorage` para cookie HttpOnly/SameSite (link para o backlog)

- **Problema**
  > Pré-existente: o token do Supabase mora em `window.localStorage` (`src/frontend/lib/auth/token.ts:6-20`), acessível a qualquer JS na origem. Este PR não introduz XSS, mas amplia o valor do token roubado (F-security-2 explica). Fica aqui só como link para o consolidator; NÃO é achado do delta.

- **Melhoria Proposta**
  > (Backlog geral, não escopo deste PR.) Emitir o token como cookie HttpOnly + SameSite=Strict pelo `POST /auth/login`, refatorar `withAuthHeaders` para não precisar mais anexar `Authorization` explicitamente. Tactic Bass alvo: **Limit Exposure**.

- **Resultado Esperado**
  > `# tokens em localStorage`: 1 → 0. Superfície de XSS-to-token-theft cai a zero (pré-condição para escalar o valor do token roubado no ecossistema pós-remessa).

- **Tactic alvo**: Limit Exposure (Bass Resist Attacks)
- **Severidade**: P3 (não é regressão do delta)
- **Esforço estimado**: L (1–2sem) — toca todo o fluxo de auth (login, refresh, expiração, CORS credentials).
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Tokens em `localStorage`: 1 → 0
  - CSRF token/SameSite cookie coverage nos POST mutantes: n/a (Bearer) → 100%
- **Risco de não fazer**: fica no risco corrente do produto — não muda por causa deste PR.
- **Dependências**: refactor de `authRouter`, `apiFetch`, `SessionExpiredModal`; fora do escopo desta feature.

## 6. Notas do agente

- Feature é read-only no ERP e o delta não introduz nenhuma escrita/segredo/SQL não-parametrizado — o baseline de segurança é bom (score 8/10). Os dois findings acionáveis (F-security-2 e F-security-3) são sobre **superfície e forense**, não sobre defeito.
- Cross-QA: F-security-2 é o mesmo problema que Performance-3 vai chamar (24k linhas em uma resposta) — o consolidator pode fundir os cards ou deixar como duas óticas do mesmo trade-off; a diferença é que Performance foca em custo/latência e Security em exfiltração.
- Cross-QA: F-security-3 (Audit Trail) tem espelho em Fault Tolerance — persistência de runs também protege recovery.
- Não medido: `npm audit` (`--quick`), penetração real, MFA/SSO corporativo do JWT — nada disso está no escopo do delta, ficam como assumidos herdados.
- Duas rotas novas, ambas com `requireRole('admin')`. A rota GET compartilha o guard das linhas digitáveis do lote — a justificativa (código de barras = destino de pagamento, LGPD/LC 105) está inline nos comentários do próprio código, o que é notável.
