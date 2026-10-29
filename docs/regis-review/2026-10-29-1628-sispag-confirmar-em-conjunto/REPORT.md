---
type: regis-review-report
run_id: 2026-10-29-1628-sispag-confirmar-em-conjunto
generated_at: 2026-10-29T17:10:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
feature: sispag-confirmar-em-conjunto (ADR-0080, I15t — confirmação em lote de boletos irmãos na gaveta SISPAG)
scope: feature diff vs origin/main 14765216
total_cards: 32
total_p0: 0
total_p1: 4
total_p2: 18
total_p3: 10
overall_score: 7.5
---

# Regis-Review — financeiro — 2026-10-29-1628-sispag-confirmar-em-conjunto

## 1. Executive scorecard

Pesos aplicados (SaaSo financeiro multi-tenant que executa escritas que movem dinheiro):
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 · Performance 1.0 · Integrability 0.9 · Deployability 0.9 (soma 9.0).

Média ponderada = (8×1.5 + 7.5×1.3 + 7×1.2 + 7×1.2 + 8×1.0 + 8×1.0 + 7×0.9 + 7×0.9) / 9.0 = 67.15 / 9.0 ≈ **7.5**.

Severidades reavaliadas pelo consolidador (ver §7): F-availability-1 rebaixada para P3 (o laço por linha chama `BoletoSuggestionService.confirmar`, read-only no DB local — zero chamada Conexos no caminho síncrono; a renegociação acontece após a resposta via `agendarEmSequencia`); F-testability-3 rebaixada para P3 (`executarEmSequencia` envolve cada `await` em try/catch — só um `logService` que lance poderia escapar). F-fault-tolerance-1 e F-security-1 **confirmados** pelo consolidador contra o código.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7 | 0 | 0 | 2 | 1 | F-availability-2: `agendarEmSequencia` é fire-and-forget; ajustes somem se o processo reiniciar antes da drenagem |
| Deployability | 7 | 0 | 1 | 3 | 0 | F-deployability-1: rota nova de escrita Conexos sem feature flag próprio; único kill-switch é o global do SISPAG |
| Integrability | 7 | 0 | 0 | 2 | 2 | F-integrability-1: fila de ajuste in-process não durável (duplica causa-raiz de availability-2 / fault-tolerance-1) |
| Modifiability | 7 | 0 | 0 | 4 | 1 | F-modifiability-1: `BoletoSuggestionService.ts` em 1402 LOC continua como god-service tocado por todo write SISPAG |
| Performance | 8 | 0 | 0 | 2 | 2 | F-performance-1: `listTitulosEmLotesAbertos()` é relido N vezes dentro do loop (até 30 round-trips idênticos) |
| Fault Tolerance | 7.5 | 0 | 1 | 3 | 0 | F-fault-tolerance-1: decisões `CONFIRMADA` do batch podem ficar órfãs do ledger de ajuste se o processo cair entre linhas |
| Security | 8 | 0 | 1 | 2 | 1 | F-security-1: batch amplifica 30× o balde de rate-limit; sessão sequestrada confirma ~900 títulos/min antes de 429 |
| Testability | 8 | 0 | 1 | 1 | 3 | F-testability-1: caminho `/confirmar-em-conjunto` sem integration test contra Postgres + Conexos stub |
| **Overall** | **7.5** | **0** | **4** | **18** | **10** | — |

**Contagem final de P0: 0.** A feature é cirúrgica (18 arquivos, +623/−21 LOC), aditiva (sem schema SQL novo, sem env var nova, sem dependência externa nova), e preserva as invariantes de segurança do fluxo singular. Os riscos de P1 descritos abaixo são correções pontuais, não arquiteturais.

Interpretação da escala:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

## 2. Top 10 risks (cross-QA)

### R-1: Decisões `CONFIRMADA` do batch podem ficar órfãs do ajuste de centavos se o processo cair durante a drenagem assíncrona
- **QA(s) afetados**: Fault Tolerance, Availability, Integrability
- **Findings de origem**: F-fault-tolerance-1, F-availability-2, F-integrability-1
- **Evidência sintetizada**: `ConfirmacaoEmConjuntoService.ts:122` faz `agendarEmSequencia(pedidosAjuste)` (fire-and-forget com `void`); `AjusteCentavosTituloService.ts:313-316` dispara `void this.executarEmSequencia(...)`. O ledger só é escrito dentro de `ajustar()` (write-ahead I18h). Entre o commit da decisão N e a abertura do ledger N+1 há janela em que o Node pode cair (deploy, SIGTERM, OOM) e deixar decisões `CONFIRMADA` sem rastro para `retomarPendentes` (que itera apenas `ledger.listarNaoTerminais`, não decisões). Janela típica 30–90 s por POST de 30 linhas.
- **Impacto técnico**: títulos ficam `CONFIRMADA` localmente sem o ajuste propagado ao `fin070`; a recuperação exige o endpoint manual `POST /sispag/ajustes-centavos/tentar-novamente` por título.
- **Impacto de negócio**: a remessa pode sair ao banco com valor divergente do boleto para múltiplos títulos simultaneamente. Divergência só aparece na conciliação do retorno (D+1 a D+3). Em batches de 30, tipicamente ~metade precisa de ajuste → exposição de 10–20 títulos silenciosamente desajustados por restart.
- **Cards**: fault-tolerance-1, cents-queue-durability (merge de availability-2 + integrability-1), performance-2
- **Custo em 6 meses**: 2 deploys/sem × 2 batches/deploy × 50% × ~15 títulos = ~30 títulos/mês com valor divergente no banco; retrabalho + risco regulatório.

### R-2: Batch amplifica em 30× o balde de rate-limit do `confirmar`
- **QA(s) afetados**: Security, Availability
- **Findings de origem**: F-security-1, F-security-5
- **Evidência sintetizada**: `rateLimit.ts:145-156` define 30/min com key `sugestao-boleto-confirmar:<sub>`; `sispag.ts:1024` reusa o balde para a rota em conjunto que executa até 30 confirmações. Pico efetivo: **900 confirmações/min** (vs. 30/min do singular). Teto HTTP Zod aceita 200 linhas; 170 descartadas apenas pelo serviço com 422.
- **Impacto técnico**: a defesa da ADR-0068 ("30/min = teto humano") deixa de valer no ponto em que o sistema **move dinheiro**.
- **Impacto de negócio**: JWT comprometido confirma quase um lote SISPAG inteiro em 1 minuto antes de 429.
- **Cards**: security-1, security-4
- **Custo em 6 meses**: baixa probabilidade × alto impacto. Um incidente de session hijack vira exposição de lote inteiro — forense regulatória muito mais cara que o fix.

### R-3: Rota nova de escrita Conexos sem feature flag próprio
- **QA(s) afetados**: Deployability, Security
- **Findings de origem**: F-deployability-1
- **Evidência sintetizada**: diff não adiciona chave em `EnvironmentProvider`; único dial é `SISPAG_LIVE_WRITE_ENABLED` global. Desligar só a rota exige rollback via Render (~5 min); desligar o kill-switch global derruba singular + ajuste de centavos.
- **Impacto técnico**: MTTR de incidente da rota ≈ 5 min vs. ≈ 10 s (env flip).
- **Impacto de negócio**: primeira anomalia em PRD derruba o SISPAG inteiro por falta de granularidade.
- **Cards**: deployability-1
- **Custo em 6 meses**: 1 incidente de 5 min = janela de corte do dia potencialmente perdida.

### R-4: Caminho `/confirmar-em-conjunto` sem integration test contra Postgres + Conexos stub
- **QA(s) afetados**: Testability, Performance, Deployability
- **Findings de origem**: F-testability-1
- **Evidência sintetizada**: só `GrupoBoletoService.integration.test.ts` existe (não relacionado). Baseline numérica 36.5 s → 1.3 s por "um cenário por batch" é manual. A invariante I15t(6) sem assertion automatizada.
- **Impacto técnico**: regressão (ex.: alguém reintroduzir `sugerirAgora()` no laço, pré-D9) só aparece em PRD.
- **Impacto de negócio**: gaveta travando 36 s no fechamento; Columbia percebe na ponta.
- **Cards**: testability-1
- **Custo em 6 meses**: cada ciclo SISPAG seguinte empilha risco de regressão silenciosa em hot path financeiro.

### R-5: `BoletoSuggestionService.ts` segue como god-service e `confirmar` acima do teto de complexity
- **QA(s) afetados**: Modifiability, Testability
- **Findings de origem**: F-modifiability-1, F-modifiability-2
- **Evidência sintetizada**: 1402 LOC (alvo ≤600), fan-in 11, 3 funções com cognitive ≥16. O ciclo D9 gastou um round só porque `confirmar` chamava `sugerirAgora()` 30× no laço.
- **Cards**: modifiability-1, modifiability-4
- **Custo em 6 meses**: 2–3 features adicionam ~250 LOC; complexity em `confirmar` atinge 22+.

### R-6: Response do POST não validado server-side; schema Zod duplicado FE/BE
- **QA(s) afetados**: Integrability, Modifiability
- **Findings de origem**: F-integrability-2, F-modifiability-4
- **Evidência sintetizada**: `routes/sispag.ts:1033-1041` faz `res.json(...)` sem `.parse()`; `resultadoConjuntoSchema` só no FE.
- **Cards**: integrability-2, modifiability-3
- **Custo em 6 meses**: drifts de contrato — já ocorreram em features anteriores.

### R-7: Linhas `RECUSADA` do conjunto não entram em trilha de auditoria durável
- **QA(s) afetados**: Security, Fault Tolerance
- **Findings de origem**: F-security-2
- **Evidência sintetizada**: recusas só no response e `logService.info` agregado. Confirmações `CONFIRMADA` persistidas; recusas não.
- **Cards**: security-2
- **Custo em 6 meses**: 1 disputa com Columbia sobre lote fechado = horas-analista + exposição regulatória.

### R-8: Fila de ajuste de centavos sem bound de tamanho nem telemetria
- **QA(s) afetados**: Performance, Fault Tolerance
- **Findings de origem**: F-performance-2
- **Evidência sintetizada**: fire-and-forget sem retentor global. Dois batches simultâneos → duas filas em paralelo; invariante "um por vez no `fin070`" quebra entre batches. Zero counters.
- **Cards**: performance-2
- **Custo em 6 meses**: precondição do roadmap Lambda — lá a promise é descartada no retorno.

### R-9: Reads redundantes no laço — `listTitulosEmLotesAbertos` por linha
- **QA(s) afetados**: Performance
- **Findings de origem**: F-performance-1
- **Evidência sintetizada**: 30 round-trips idênticos ao Postgres por POST de 30 linhas. Margem para pico (10 analistas × 30 = 300 reads do mesmo recordset) fina.
- **Cards**: performance-1

### R-10: `routes/sispag.ts` 1927 LOC e `frontend/lib/sispag.ts` 3169 LOC — contenção crônica
- **QA(s) afetados**: Modifiability, Deployability
- **Findings de origem**: F-modifiability-3, F-modifiability-4
- **Cards**: modifiability-2, modifiability-3

## 3. Cross-cutting findings

### CC-1: Fire-and-forget da fila de ajuste de centavos
- **Aparece em**: Availability, Fault Tolerance, Integrability, Performance
- **Findings**: F-availability-2, F-fault-tolerance-1, F-integrability-1, F-performance-2
- **Diagnóstico unificado**: a feature herda `agendarEmSequencia` pré-existente e amplifica — até 30 pedidos por batch na fila in-memory. Quatro faces: (a) durabilidade (processo cai, pedidos somem), (b) recuperação (`retomarPendentes` só varre ledgers já abertos), (c) telemetria (zero gauges), (d) concorrência cross-batch. Mitigação parcial via write-ahead no ledger — só vale se o ledger abre antes do processo cair.
- **Recomendação consolidada**: dois cards resolvem o quarteto — (i) **fault-tolerance-1**: abrir o ledger sincronamente dentro de `confirmarLinha` antes de responder; (ii) **performance-2**: `AjusteCentavosQueue` singleton com `maxConcurrency=1`, `maxDepth` e métricas. O card `cents-queue-durability` materializa o passo (i) persistindo a intenção.

### CC-2: Simetria de contrato BE↔FE
- **Aparece em**: Integrability, Modifiability, Testability
- **Findings**: F-integrability-2, F-modifiability-4, F-testability-5
- **Diagnóstico unificado**: três manifestações — schema duplicado no FE, response não validado no BE, envelope de erro sem teste. Toda feature SISPAG passa por isso.
- **Recomendação consolidada**: **modifiability-3** (schemas em `src/shared/sispag/`) resolve a origem; **integrability-2** e **testability-5** são paliativos imediatos.

### CC-3: Observabilidade — métricas estruturadas ausentes para o novo endpoint
- **Aparece em**: Availability, Deployability, Performance
- **Findings**: F-availability-3, F-deployability-3, F-performance-3
- **Diagnóstico unificado**: log final emite contadores e nada mais — zero duração, zero motivo, zero cache-hit. Regressão D9 (36.5 s → 1.3 s) foi detectada manualmente.
- **Recomendação consolidada**: card unificado de instrumentação acrescentando `duracao_total_ms`, `duracao_max_linha_ms`, `motivos`, `scenarioMode`, `cache_hit`, promovendo 5xx para `BUSINESS_ERROR` com `conjuntoId`.

### CC-4: Monólitos legados que a feature atravessa sem corrigir
- **Aparece em**: Modifiability, Testability, Deployability
- **Findings**: F-modifiability-1,2,3,4, F-testability-4
- **Diagnóstico unificado**: `BoletoSuggestionService.ts` (1402), `routes/sispag.ts` (1927), `frontend/lib/sispag.ts` (3169), `BoletoSuggestionService.test.ts` (1974). Feature não piorou significativamente; não corrigiu.
- **Recomendação consolidada**: cards modifiability-1, modifiability-2, modifiability-3, testability-4 — janela de modernização separada.

## 4. Quick wins (≤5 dias úteis — esforço S, severidade ≥ P2)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| [security-1] Rebaixar teto do batch no rate-limiter (slots proporcionais) | Security | S | P1 | Pico de confirmações/min por usuário: 900 → ≤30 |
| [deployability-1] Introduzir `SISPAG_CONFIRMACAO_EM_CONJUNTO_ENABLED` | Deployability | S | P1 | MTTR de incidente específico: ~5 min → ~10 s |
| [availability-3] Instrumentar duração e taxa de recusa por `conjuntoId` | Availability | S | P2 | 0 → 2 campos de duração; 5xx vira `BUSINESS_ERROR` |
| [deployability-2] Runbook da rota em `DEPLOY.md` | Deployability | S | P2 | Operador de plantão resolve sem acionar dev |
| [deployability-3] Métrica estruturada de duração e rows | Deployability | S | P2 | Regressão de 28× detectada em ≤ 1 deploy |
| [deployability-4] Required status checks no `main` | Deployability | S | P2 | 0 build vermelho chegando a PRD |
| [fault-tolerance-3] `AbortController` 60s no `fetch` do FE | Fault Tolerance | S | P2 | 100% dos POSTs > 60s recebem mensagem acionável |
| [integrability-2] Validar response do POST com Zod server-side | Integrability | S | P2 | Response pinado 0/2 → 2/2; schemas duplicados 2 → 0 |
| [modifiability-4] Cognitive complexity de `confirmar` ≤15 | Modifiability | S | P2 | 3 warnings Biome → 0 |
| [performance-1] Snapshot único de `listTitulosEmLotesAbertos` por batch | Performance | S | P2 | p95 do POST 30 linhas: 1.3 s → ≤ 0.8 s |
| [security-4] Baldes separados `confirmar` vs. `conjunto` | Security | S | P2 | Observabilidade por rota + alarme específico |

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| [fault-tolerance-1] Abrir ledger sincronamente antes de responder | Fault Tolerance, Availability | M | Condition Monitoring + Reconcile | Fecha janela de 30–90 s em que até ~15 títulos/batch podem ficar com valor divergente. Hoje recovery é manual por título. |
| [cents-queue-durability] Persistir intenção antes do `void` (merge availability-2 + integrability-1) | Availability, Integrability, Fault Tolerance | M | State Resync + Outbox | Precondição do roadmap Lambda. Janela de exposição: 36.5 s → 0 s. |
| [performance-2] `AjusteCentavosQueue` singleton com bound + telemetria | Performance, Fault Tolerance | M | Bound Queue Sizes | Invariante "um ajuste por vez no fin070" entre batches; alarme antes do retorno do banco. |
| [security-2] Persistir trilha durável por linha RECUSADA | Security, Fault Tolerance | M | Audit Trail | 100% das recusas persistidas (vs. 0% hoje). |
| [testability-1] Integration test do `/confirmar-em-conjunto` | Testability, Performance | M | Sandbox | Defende o ganho 36.5 s → 1.3 s automaticamente. |
| [modifiability-1] Split `BoletoSuggestionService` | Modifiability, Testability | L | Split Module | 1402 → ≤600 LOC; cognitive de `confirmar` 19 → ≤15. |
| [modifiability-2] Partição de `routes/sispag.ts` por sub-escopo | Modifiability, Deployability | M | Split Module | 1927 → ≤500 por arquivo. |
| [modifiability-3] Schemas Zod compartilhados em `src/shared/sispag/` | Modifiability, Integrability | L | Abstract Common Services | `frontend/lib/sispag.ts` 3169 → ≤800; schemas duplicados → 0. |
| [testability-4] Partir test files SISPAG > 1000 LOC | Testability | M | Limit Structural Complexity | Maior test file 1974 → ≤700. |
| [fault-tolerance-4] Job diário de reconciliação SISPAG × `fin070` | Fault Tolerance | L | Reconcile | MTTR de divergência: dias → horas. Depende de fault-tolerance-1. |

## 6. O que está bem (e por quê)

1. **`RegraIrmaosConjunto` puro, 195 LOC, 0 I/O, reusado entre listagem e `confirmar`** — tactic *Abstract Common Services + Increase Semantic Coherence*. Alterar regra = 1 arquivo + 1 teste.
2. **`ConfirmacaoEmConjuntoService` como intermediário (208 LOC)** — tactic *Use an Intermediary*. Escrita no ERP continua atrás de `BoletoSuggestionService.confirmar`; nenhum cliente externo novo.
3. **Idempotência por linha medida 30/30 `JA_CONFIRMADA` em replay** — tactic *Idempotent Replay*. Dedup prévio + unique index + branch `JA_CONFIRMADA`.
4. **Teto de domínio em 30 linhas com erro nomeado (`BatchConfirmationTooLargeError`, 422)** — tactic *Limit Event Response*. Medido: 31 linhas → 422 antes de qualquer escrita.
5. **Cenário recalculado 1×/batch (D9) — ganho medido 36.5 s → 1.3 s** — tactic *Reduce Overhead*.
6. **Zod `.strict()` nos dois níveis + `ator` sempre do JWT + `pesCod` da origem relido do banco** — tactic *Validate Input + Separate Entities*.
7. **`RegraIrmaosConjunto.test.ts` roda motor real (18 cases, não mock) + `BankingCalendar.withClock` em todos os pontos sensíveis a tempo** — tactic *Limit Non-Determinism* exemplar.
8. **Zero dependência externa nova, zero schema SQL novo, zero env var nova** — blast radius de deploy mínimo.

## 7. Limitações da análise

**Severidades reclassificadas pelo consolidador** (contra verificação direta do código):
- **F-availability-1 (loop sem timeout, hung Conexos)**: rebaixada de P1 para P3. `BoletoSuggestionService.confirmar` é read-only no DB local no `for` de linhas; zero chamada ao Conexos no caminho síncrono. A renegociação acontece após o response via `agendarEmSequencia`. O cenário "linha pendurada no Conexos trava o batch" não se materializa.
- **F-testability-3 (fire-and-forget sem teste do descarte)**: rebaixada de P2 para P3. `executarEmSequencia` envolve cada `await` em try/catch; só um `logService` lançando antes do primeiro await escaparia.
- **F-fault-tolerance-1 e F-security-1**: **confirmadas** contra o código.

**Métricas não medíveis localmente** declaradas pelos agents:
- P99 em PRD, cold-start Render, profundidade real da fila sob picos (sem APM / CloudWatch).
- Taxa de restart Node em PRD, drenagem média de `agendarEmSequencia`, hit-rate do cache do cenário.
- MTTR real por Conexos pendurado; convergência de `retomarPendentes` pós-queda (requer injeção de falha em HML).
- Pipeline CI/CD real (`.github/workflows/*.yml` fora do diff).

**O que o pipe não cobre**: chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade, `npm audit`, varredura de segredos em todo o repo.

**Infra marcada N/A**: não há `infra/`, Terraform, tenants provisionados, Lambda. Métricas de Terraform/CloudWatch/CloudTrail/GuardDuty não medíveis.

**Janela temporal**: snapshot de 2026-10-29 contra `origin/main 14765216`. Refazer trimestralmente.

**Dedup e merges aplicados**: `availability-2` + `integrability-1` unificados em `cents-queue-durability` no KANBAN.md (mesma causa-raiz, mesma solução). Nenhum outro card mesclado.

## 8. Ações recomendadas (30 dias)

1. **Sprint 1 (quick wins — ≤5 dias)**: executar os 11 cards de esforço S de §4. Começar pelos P1 sem dependência: [security-1] (rate-limit) + [deployability-1] (feature flag).
2. **Sprint 2 (P1 estrutural)**: [fault-tolerance-1] (abrir ledger sincronamente no `confirmarLinha` do batch) + [testability-1] (integration test).
3. **Sprint 3 (observabilidade — CC-3)**: card unificado de duração + motivo + cache-hit + severidade; expor no painel-operacao.
4. **Sprint 4 (simetria BE↔FE — CC-2)**: [modifiability-3] + [integrability-2]. Barateia todas as próximas features SISPAG.
5. **Janela separada de modernização** (fora do ciclo de features): [modifiability-1,2] + [testability-4].

---

> Nota ao time: a feature atravessou os gates obrigatórios (typecheck, lint, 6243 testes, PatternGuardian, DesignReviewer) e preservou as invariantes de segurança do fluxo singular. Score 7.5 significa "saudável com oportunidades pontuais". **Não há P0.** O foco das próximas sprints é fechar os 4 P1s (ledger sincronizado no batch, rate-limit por slot, feature flag, integration test) — todos acionáveis e sem dependências entre si.
