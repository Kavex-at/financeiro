# Regis-Review follow-ups — `gerarSolicitacaoNumerario` (SN)

> **Run:** `2026-07-29-0243-recebimentos-sn` · **Weighted score:** 7.8/10 · **Feature:** `gerarSolicitacaoNumerario` (SN dry-run)
> **Source:** `docs/regis-review/2026-07-29-0243-recebimentos-sn/REPORT.md` + `KANBAN.md`
> (full card detail: Problema / Melhoria Proposta / Resultado Esperado / file locations / métricas per card).
> **Gate verdict:** **PASS-WITH-FOLLOWUPS** — 8/8 QAs green, **zero P0**. Per the pipeline gate, only P0
> re-enters the loop; the 47 cards below (14 P1 · 24 P2 · 9 P3) are the **deferred backlog**, NOT
> implemented in this slice.

## ⚠️ Must-fix-before-wire-real (blocks any PR that removes `throw new NotImplementedError` from `enviarAoErp`)

The DRY-RUN invariant is what makes this slice safe. These cards are inert today but become load-bearing
the moment the ERP-write seam is wired. A future PR touching `SolicitacaoNumerarioService.enviarAoErp`
MUST reference closure of these:

| Card | P | Why it blocks wire-real |
|---|---|---|
| fault-tolerance-4 | P1 | `encomenda-percentuais` unresolved — SN uses raw txn value; wrong monetary amount if wired |
| fault-tolerance-3 | P1 | No wire-level idempotency/reconciliation handle modelled (`docVldFinalizado` not in ontology) |
| integrability-5 | P1 | `gcdCod=0` placeholder — one trivial patch → invalid ERP POST; needs `SN_LIVE_WRITE_ENABLED` gate |
| integrability-1 | P1 | `enviarAoErp` lacks `ExternalCallOptions` — diverges from other Frente IV write ports |
| integrability-2 | P1 | Route re-types the DTO inline; payload never `.parse()`d before POST |
| modifiability-1 | P1 | `gcdCod=0` duplicated BE↔FE — silent divergence at go-live |
| fault-tolerance-2 | P2 | No `Idempotency-Key` on SN route (sibling `pipeline/run` already has it) |
| security-4 | P1 | `permissions.filiais` claim not provisioned — cross-filial guard passes empty |

## P1 — Alto (14)

| Card | Title | QA |
|---|---|---|
| availability-2 | Marcar fallback do `fetchProcessosParaTransacao`/`processarSolicitacaoNumerario` como `fonte:'fixture'` + logar | Availability |
| deployability-1 | Escrever runbook de rollback da Frente IV / SN | Deployability |
| deployability-2 | Provisionar ambiente de staging (Render + Vercel) para smoke test pré-prod | Deployability |
| integrability-1 | Aceitar `ExternalCallOptions` no seam `enviarAoErp` + no `ProcessoProviderInterface` | Integrability |
| integrability-2 | Reusar Zod DTO canônico na rota e validar o payload antes do POST | Integrability |
| integrability-5 | Adicionar gate `SN_LIVE_WRITE_ENABLED` + `dryRun` gate no seam `enviarAoErp` | Integrability |
| modifiability-1 | Extrair `gcdCod` para env/SSM e remover placeholder duplicado | Modifiability |
| modifiability-2 | Remover `buildDryRunFallback` do frontend (ou reduzir a "erro amigável") | Modifiability |
| modifiability-3 | Isolar a regra "encomenda-percentuais" em pure function testável antes de resolver | Modifiability |
| fault-tolerance-3 | Modelar handle de idempotência/reconciliação wire-level (`docVldFinalizado` ou equivalente com299) | Fault Tolerance |
| fault-tolerance-4 | Bloquear o wire-up do `enviarAoErp` até `encomenda-percentuais` resolvida (guard-rail no código) | Fault Tolerance |
| security-4 | Provisionar claim `permissions.filiais` no JWT Supabase e travar guard | Security |
| security-5 | Atualizar `axios` para ≥1.18.0 (backend) — fecha 3 CVE high | Security |
| security-6 | Triagem e patching de 6 CVE high no frontend | Security |

## P2 — Médio (24)

| Card | Title | QA |
|---|---|---|
| availability-1 | Traduzir `HandlerError.statusCode`/`code`/`userMessage` no `errorMiddleware` | Availability |
| availability-3 | Idempotency namespacing na rota `POST .../solicitacao-numerario` (pré-req wire-real) | Availability |
| availability-4 | Wrap do `enviarAoErp` com `RetryExecutor` + `ExternalCallOptions.timeoutMs` | Availability |
| fault-tolerance-2 | `Idempotency-Key` namespaced-por-ator na rota SN antes de qualquer wire-up | Fault Tolerance |
| fault-tolerance-5 | Persistir rastro do "Processar" em ledger (mesmo em dry-run) | Fault Tolerance |
| fault-tolerance-6 | Tornar o fallback `buildDryRunFallback` do frontend explícito (nunca silencioso) | Fault Tolerance |
| performance-1 | Adicionar `ExternalCallOptions.timeoutMs` ao `ProcessoProviderInterface` | Performance |
| performance-2 | Adicionar `AbortController` + timeout no `fetchProcessosParaTransacao` | Performance |
| performance-4 | Instrumentar rotas de Recebimentos com Otel/APM | Performance |
| modifiability-4 | Fatiar `src/frontend/lib/recebimentos.ts` (524 LOC → 4 arquivos) | Modifiability |
| modifiability-5 | Corrigir `set-state-in-effect` em `AlocarProcessosDialog` antes de expandir o dialog | Modifiability |
| security-1 | Adicionar teste de regressão `role != admin` para POST SN | Security |
| security-2 | Redigir campo `ator` no log de negócio da SN (nunca vazar email) | Security |
| security-3 | Provisionar tabela `audit_log` (append-only) e persistir a SN dry-run nela | Security |
| integrability-3 | Compartilhar tipos SN entre backend e frontend (evitar redigitar DTO) | Integrability |
| integrability-4 | Capturar HAR HML do `gerDocProcesso` e adicionar contract test de parsing | Integrability |
| integrability-6 | Emitir `MetricsEvent` por-dependência no `gerar` e `enviarAoErp` (`METRICS_PORT_TOKEN`) | Integrability |
| deployability-3 | Segmentar a flag `RECEBIMENTOS_ENABLED` por `filCod` (canário por filial) | Deployability |
| deployability-4 | Drift detector semanal para env vars `sync: false` no Render | Deployability |
| deployability-5 | Coordenar deploy BE→FE (ordem determinística com smoke) | Deployability |
| testability-1 | Cobrir o ramo `throw err` (não-`FilialForbiddenError`) nas 3 rotas de recebimentos | Testability |
| testability-2 | Afirmar o BUSINESS_INFO emitido pelo `SolicitacaoNumerarioService` (LGPD + auditoria) | Testability |
| testability-3 | Injetar clock na rota SN + afirmar `docDtaEmissao`/`dtaVencimento` no teste | Testability |
| testability-4 | Cobrir os 2 estados restantes do `AlocarProcessosDialog` (erro + processando) | Testability |

## P3 — Baixo (9)

| Card | Title | QA |
|---|---|---|
| availability-5 | Instrumentar `MetricsPortInterface.emit` no `SolicitacaoNumerarioService.gerar` | Availability |
| availability-6 | Healthcheck/readiness da rota SN | Availability |
| performance-3 | Aplicar `heavyRouteLimiter` no `GET /…/processos` quando o provider virar real | Performance |
| performance-5 | Migrar filtro do provider para SQL indexado quando escalar | Performance |
| performance-6 | Instrumentar `bootstrapAppContainer` idempotency como métrica | Performance |
| modifiability-6 | Preparar split de `routes/recebimentos.ts` quando cruzar 300 LOC | Modifiability |
| fault-tolerance-1 | Documentar formalmente o invariante DRY-RUN e ancorar como decisão de arquitetura (ADR) | Fault Tolerance |
| testability-5 | Marcar `fonte:'fixture'|'backend'` nos fallbacks | Testability |
| testability-6 | 1 property-based test para as invariantes do builder de payload SN | Testability |
