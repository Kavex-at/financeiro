---
type: regis-review-report
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
generated_at: 2026-09-15T02:55:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 23
total_p0: 0
total_p1: 0
total_p2: 14
total_p3: 9
overall_score: 7.9
---

# Regis-Review — financeiro — 2026-09-15-0207-permutas-saldo-ordem-centavos

Delta em revisão: `/feature-tweak permutas-saldo-ordem-centavos` (branch `fix/permutas-saldo-ordem-centavos`, base `origin/main` = `3872903` = v0.36.4). Corrige ADR-0046 em três frentes: (D1) tolerância de resíduo de R$1,00 comparada em centavos, com blindagem contra sobrepagamento negativo; (D2) prioridade única e completa dos motivos na eleição; (D3) `saldoRestante` sem dupla-contagem do que o ERP já abateu (extrai `SaldoAlocacaoAdiantamentoService` como fonte única, com guarda de frescor sobre `permuta_bordero.atualizado_em`). Escopo: 44 arquivos alterados (+3.328 / −221), **0 migrations** — delta é 100% código. Gates verdes: backend 135 suítes / 1953 testes, frontend 40 suítes / 328 testes, PatternGuardian PASS, DesignSystemReviewer PASS, SpecVerifier 64 APROVADO / 0 REPROVADO, Ground-Truth LIVE (Conexos PRD, read-only) 247 linhas / 0 DIVERGENTE.

## 1. Executive scorecard

Pesos (financeiro multi-tenant SaaSo que executa escritas movimentando dinheiro — Conexos/Nexxera/GED):
Security 1,5 · Fault Tolerance 1,3 · Availability 1,2 · Modifiability 1,2 · Testability 1,0 · Performance 1,0 · Integrability 0,9 · Deployability 0,9. Total = 9,0.

Overall = (8,5·1,2 + 8,0·0,9 + 8,0·0,9 + 7,5·1,2 + 7,5·1,0 + 8,5·1,3 + 7,5·1,5 + 8,0·1,0) / 9,0 = 71,40 / 9,0 = **7,9**.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8,5 | 0 | 0 | 3 | 1 | F-availability-1: janela de rollout ≤ 6h (documentada no ADR §Consequências) invisível ao operador |
| Deployability | 8,0 | 0 | 0 | 3 | 1 | F-deployability-1: convergência da nova semântica pós-deploy sem log/métrica |
| Integrability | 8,0 | 0 | 0 | 2 | 1 | F-integrability-1: `permuta_bordero.atualizado_em` mudou de "carimbo de refresh" para "carimbo de mudança de situação" sem `COMMENT ON COLUMN` nem view de compat |
| Modifiability | 7,5 | 0 | 0 | 1 | 2 | F-modifiability-1: fórmula `saldoNeg = valorPermutar / taxa` duplicada em 5 sítios de `service/` (só metade "não consumido" foi extraída) |
| Performance | 7,5 | 0 | 0 | 1 | 4 | F-performance-1: `listConsumosFinalizados` (JOIN 4-way) sem índice de suporte para filtros do `permuta_bordero`; sem EXPLAIN ANALYZE capturado |
| Fault Tolerance | 8,5 | 0 | 0 | 2 | 1 | F-fault-tolerance-2: reuso de `bor_cod` para execuções terminais pode fazer o JOIN casar com borderô errado (overstate silencioso do saldo) |
| Security | 7,5 | 0 | 0 | 2 | 1 | F-security-1: validador AO VIVO documenta `CONEXOS_WRITE_ENABLED=false` no docblock mas não enforça no `main()` (2/3 guards executados) |
| Testability | 8,0 | 0 | 0 | 2 | 2 | F-testability-1: SQL do `listConsumosFinalizados` (5 joins) validado só por casamento de string — 0 teste de integração contra Postgres real |
| **Overall** | **7,9** | **0** | **0** | **14** | **9** | — |

Interpretação:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais ← **este delta**
- 9–10: estado-da-arte para o estágio atual

**Ausência de P0/P1 é deliberada.** O delta é code-only (sem migration, sem lock, sem CHECK novo), rollback é `git revert` puro, ground-truth LIVE bateu 247/247 contra Conexos PRD, os 12 casos canônicos da ADR-0046 estão pinados por asserção numérica ±0,01. A guarda de frescor foi provada fail-safe em **toda** direção de skew app↔DB analisada (sempre subestima consumo, nunca super-aloca). Nenhum finding cumpre os dois testes de P0/P1: (a) bloqueia o merge, (b) dano concreto se merge for feito. Os 14 P2 aqui são robustez operacional em cima de um patch que já é uma melhoria estrutural líquida (score subiu +0,7 sobre o run 2026-09-08).

## 2. Top 5 risks (cross-QA)

### R-1: Reuso silencioso de `bor_cod` para execuções terminais → overstate do saldo → super-alocação
- **QA(s) afetados**: Fault Tolerance, Availability, Performance
- **Findings de origem**: F-fault-tolerance-2 (P2)
- **Evidência sintetizada**: `listConsumosFinalizados` casa execução↔borderô por `(fil_cod, bor_cod)` — a PK do cache. `bor_cod` é sequencial POR FILIAL. O docblock de `clearBorCod` (`PermutaExecucaoRepository.ts:288-296`) documenta reuso REAL em prod para execuções `error` (bor 2436, 2771). Se um borderô finalizado for estornado no ERP e o mesmo `(fil_cod, bor_cod)` for reusado para OUTRO adto, a execução TERMINAL antiga (que preserva o `bor_cod` original) casa com o novo cache ⇒ conta como consumida ⇒ `saldoRestante` **overstated** em `valorAlocado` ⇒ teto do `alocar` aceita re-alocar sobre o mesmo saldo já baixado. Guarda de frescor é temporal, não cobre reuso de identidade.
- **Impacto técnico**: super-alocação silenciosa; segunda baixa vira `parcial` inesperado com resíduo perverso. Recuperação existe (próxima ingestão relê `mnyTitPermutar`), mas janela ≤ 6h de exposição.
- **Impacto de negócio**: risco monetário limitado ao valor da alocação antiga do par estornado. A única defesa a jusante é a pré-checagem I-Write-8a (por título da INVOICE), que **não** confere `mnyTitPermutar` do ADTO. Cenário requer 3 condições simultâneas — probabilidade baixa, custo por evento moderado.
- **Card(s) Kanban relacionados**: `detectar-reuso-borcod` (P2, S)
- **Custo de inação em 6 meses**: baixa probabilidade × alto custo por evento. Sem detector, o primeiro caso vira incidente descoberto pelo cliente. Query de detecção diária é ~1d — apólice barata.

### R-2: Convergência da nova semântica invisível pós-deploy — janela conservadora reaberta como "regressão" pelo suporte
- **QA(s) afetados**: Deployability, Availability, Integrability, Fault Tolerance
- **Findings de origem**: F-deployability-1 (P2), F-availability-1 (P2), F-integrability-1 (P2), F-fault-tolerance-2 (P3 — skew)
- **Evidência sintetizada**: até a 1ª ingestão pós-deploy renovar `permuta_eleicao_run.started_at` sem tocar `permuta_bordero.atualizado_em` do cache antigo (janela ≤ 6h, documentada no ADR-0046 §Consequências), `Σ naoConsumido = Σ valorAlocado` para todos os adtos. O `saldoRestante` mantém o comportamento pré-delta (subestima o saldo — sentido seguro), mas: (i) nenhum log/métrica sinaliza "adto X passou a usar o novo saldo"; (ii) o operador vê o painel após deploy e não sabe se o comportamento antigo persistente é bug ou convergência natural; (iii) skew de relógio app↔DB pode prolongar a janela sem alerta; (iv) `permuta_bordero.atualizado_em` mudou de semântica in-place sem `COMMENT ON COLUMN`, então dashboards externos consultando `MAX(atualizado_em)` como "healthcheck do cache" passam a soar alarme falso.
- **Impacto técnico**: primeiro incidente pós-deploy é reaberto como regressão da ADR-0046, e o autor gasta tempo provando que "não é bug, é convergência". Se algum consumidor externo (dashboard BI, planilha do analista) usa `atualizado_em` como frescor, passa a ver borderôs "envelhecidos" que foram relidos hoje.
- **Impacto de negócio**: perde-se o âncora temporal do fix; suporte abre ticket falso-positivo na primeira semana. Repete-se o padrão do run 2026-09-08 (F-integrability-1 da 0054) — informação mudando sem sinal.
- **Card(s) Kanban relacionados**: `observabilidade-frescor-convergencia` (P2, M), `comment-atualizado-em` (P2, S), `runbook-convergencia-pos-deploy` (P3, S), `skew-clock-app-db` (P3, S)
- **Custo de inação em 6 meses**: alta probabilidade de re-incidente na primeira semana pós-deploy; médio em 6 meses (a janela fecha em ≤ 6h). Cards são baratos (S+S+M) e fecham a mesma causa.

### R-3: `listConsumosFinalizados` sem cobertura de integração + sem EXPLAIN ANALYZE + sem índice dedicado
- **QA(s) afetados**: Testability, Performance, Availability, Integrability
- **Findings de origem**: F-testability-1 (P2), F-performance-1 (P2), F-availability-3 (P2), F-integrability-3 (P3), F-performance-2 (P3)
- **Evidência sintetizada**: a query nova do hot path (`GET /permutas/gestao` — 8ª do `Promise.all`) une 4 tabelas com 5 cláusulas críticas (`dry_run=false`, `status IN (...)`, `bor_vld_finalizado=1`, `bor_cod_estornado IS NULL`, `b.atualizado_em < r.started_at`) e depende de semânticas do Postgres (`IS DISTINCT FROM` sobre NULL, join composto `(fil_cod, bor_cod)`, comparação `timestamptz`). Cobertura atual: 4 asserções de shape via `sql.includes(...)`, **0 testes de integração contra pg real** no domínio permutas (14 existem em `routes/recebimentos.*` — o padrão está no repo). Nenhum `EXPLAIN ANALYZE` capturado; `permuta_adiantamento.last_ingest_run_id` (FK usada no JOIN) sem índice; filtros do `permuta_bordero` sem índice de suporte.
- **Impacto técnico**: refactor futuro que troque `USING(bor_cod)` sem `fil_cod` produz colisão silenciosa entre filiais; refactor que troque `IS DISTINCT FROM` por `!=` refaz o bug canônico "Finalizar → refresh → saldo cheio". Ground-truth AO VIVO (247/0 DIVERGENTE) mitiga hoje, mas roda **manualmente antes do PR**, não em CI — hotfixes com `--urgent` pulam.
- **Impacto de negócio**: hoje mitigado por número (250 execuções × 800 adtos × 250 runs). Cresce linearmente com trilha de execuções; ninguém sabe o gatilho porque o dado não existe.
- **Card(s) Kanban relacionados**: `integracao-postgres-permutas` (P2, M), `perf-indices-listconsumos` (P2, S)
- **Custo de inação em 6 meses**: baixo hoje, cresce com a próxima duplicação do volume de trilha (rotina de 6–12 meses). Sem EXPLAIN e sem log de duração, uma regressão só é descoberta pela queixa do analista.

### R-4: Validador AO VIVO com 2/3 guards enforçados (defesa em profundidade quebrada por design)
- **QA(s) afetados**: Security, Testability
- **Findings de origem**: F-security-1 (P2), F-testability-3 (P2)
- **Evidência sintetizada**: o docblock de `validate-permutas-saldo-ordem-centavos-v1.ts:54-57` documenta que o validador deve rodar com `CONEXOS_WRITE_ENABLED=false CONEXOS_DRY_RUN=true PROBE_ALLOW_PRD=1`. Apenas 2 dos 3 guards são enforçados no código (URL PRD + `SET TRANSACTION READ ONLY`); `CONEXOS_WRITE_ENABLED` e `CONEXOS_DRY_RUN` só aparecem no docblock. Hoje inofensivo — a superfície importada é 100% READ (`getDetalheTitulos`, `listBorderos`, `listBaixas`). Amanhã, se um dev copiar este arquivo como template para outra sonda e acrescentar uma chamada `postSomething(...)` "só pra debugar", a escrita sobe em PRD sob a identidade do operador que rodou o script, sem alarme. Adicionalmente, a lógica de classificação (EXATO / OK_CENTAVO / DIVERGENTE / EXPLICADO / SEM_GROUND_TRUTH) — que é o gate ground-truth — **não tem teste**: uma inversão de sinal em manutenção futura vira 0 DIVERGENTE em produção com falso-verde.
- **Impacto técnico**: escrita acidental em PRD sob identidade do operador é P0 em qualquer cliente com controle contábil (Columbia audita `usn_cod` do borderô). Um falso-verde na classificação apaga a defesa contra R-3 (ground-truth é hoje o único guardião das duas semânticas do banco).
- **Impacto de negócio**: reputacional alto (a Kavex vende automação com controle) + rastreabilidade quebrada. Sem carimbo distintivo, execuções do validador em PRD são invisíveis ao operador central.
- **Card(s) Kanban relacionados**: `validador-write-guards` (P2, S), `validador-classificacao-test` (P2, S), `alarme-validador-prd` (P3, S)
- **Custo de inação em 6 meses**: baixo enquanto o script for one-shot pré-PR; sobe se virar sonda rotineira ou se o padrão for copiado. Cards são S — apólice cheap.

### R-5: RBAC de `/permutas/gestao` continua aberto — payload cresceu com `alocacoes` em `ja-permutado`
- **QA(s) afetados**: Security
- **Findings de origem**: F-security-2 (P2)
- **Evidência sintetizada**: `GET /permutas/gestao` responde 200 para qualquer autenticado (débito pré-existente ADR-0043, card `security-1` daquele run ainda aberto). Este delta amplia marginalmente a projeção: `alocacoes[]` (invoiceDocCod, invoicePriCod, valorAlocado, taxa, criadoPor) agora aparece também em `ja-permutado` — antes só em `permuta-manual`/`casamento-manual`. Ampliação de ~+41% em contagem de linhas (63 novos `ja-permutado` INOX + 43 executados reclassificados sem D.I). Nenhum campo é PII novo, mas o universo do vazamento cresceu.
- **Impacto técnico**: nenhum vetor de mutação; a leitura já vazava os mesmos campos para dois outros status. Sem revisão, cada nova feature amplia o payload marginalmente e o RBAC nunca é revisitado.
- **Impacto de negócio**: baixo hoje (1 tenant, analistas todos com acesso); alto se a política mudar (novo cliente com segregação de leitura por role).
- **Card(s) Kanban relacionados**: `rbac-gestao-alocacoes` (P2, S)
- **Custo de inação em 6 meses**: 1 sprint de ADR curta ou `requireRole('analyst')` na rota. Discussão volta a cada Regis-Review.

## 3. Cross-cutting findings

### CC-1: Observabilidade da janela de convergência/frescor pós-deploy
- **Aparece em**: Deployability, Availability, Integrability, Fault Tolerance
- **Findings**: F-deployability-1 (P2), F-availability-1 (P2), F-integrability-1 (P2), F-fault-tolerance-2 (P3 — skew), F-deployability-3 (P3 — runbook)
- **Diagnóstico unificado**: 4 agentes distintos identificaram o mesmo gap. A guarda de frescor é fail-safe por desenho — mas invisível. A janela de ≤ 6h documentada no ADR-0046 §Consequências não tem: (i) log/métrica de "adto X saiu da janela conservadora", (ii) sonda de "quantos borderôs vivos entraram na janela + duração média", (iii) `COMMENT ON COLUMN` documentando a mudança semântica de `atualizado_em`, (iv) healthcheck de skew de relógio app↔DB, (v) runbook de convergência pós-deploy. Todas apontam para a mesma causa-raiz: o time e o suporte descobrem a janela pelo cliente.
- **Recomendação consolidada**: 3 cards em cascata.
  - `observabilidade-frescor-convergencia` (P2, M) — logs no `SaldoAlocacaoAdiantamentoService` + sonda `probe-guarda-frescor-permutas.ts` + expor no `/health/pipelines`.
  - `comment-atualizado-em` (P2, S) — `COMMENT ON COLUMN permuta_bordero.atualizado_em` numa migration nova, com nota da ADR-0046.
  - `runbook-convergencia-pos-deploy` (P3, S) — nota no CHANGELOG + seção "Convergência pós-deploy" no `docs/runbooks/rollback.md` com checklist "1) /health = 0.36.5; 2) MAX(atualizado_em) vs MAX(started_at); 3) painel do adto 12860 mostra 30.364,73".

### CC-2: `listConsumosFinalizados` sem cobertura de integração + sem plano de query + sem índice dedicado
- **Aparece em**: Testability, Performance, Availability, Integrability
- **Findings**: F-testability-1 (P2), F-performance-1 (P2), F-availability-3 (P2), F-integrability-3 (P3), F-performance-2 (P3)
- **Diagnóstico unificado**: 4 agentes concordam que a query nova é o hotspot arquitetural do delta. Sem EXPLAIN ANALYZE, sem log de duração e sem teste contra pg real, qualquer decisão de indexação vira palpite e qualquer refactor futuro tem espaço para colisão silenciosa. O padrão de teste de integração existe no repo (14 arquivos em `routes/recebimentos.*`) mas não foi propagado para permutas.
- **Recomendação consolidada**: 2 cards.
  - `integracao-postgres-permutas` (P2, M) — teste de integração cobrindo (a) join `(fil_cod, bor_cod)` cross-filial, (b) guarda de frescor `b.atualizado_em < r.started_at`, (c) `ON CONFLICT ... IS DISTINCT FROM` sob NULL.
  - `perf-indices-listconsumos` (P2, S) — EXPLAIN ANALYZE + log de `durationMs` + criar índices só se justificados por número (`permuta_adiantamento (last_ingest_run_id)`, `permuta_alocacao_execucao (dry_run, status, adiantamento_doc_cod)` parcial, `permuta_bordero (bor_vld_finalizado, bor_cod_estornado)`).

### CC-3: Validador AO VIVO como superfície nova de risco (write guards + classificação sem teste)
- **Aparece em**: Security, Testability
- **Findings**: F-security-1 (P2), F-testability-3 (P2), F-security-5 (P3), F-security-3 (P3 — alarme)
- **Diagnóstico unificado**: o script `validate-permutas-saldo-ordem-centavos-v1.ts` é a peça mais nova do delta em termos de risco de escrita e vazamento (736 LOC contra Conexos PRD). Grande vitória sobre PR #111: importa a lógica de produção (`ToleranciaResiduo`, `ElegibilidadeService`, `SaldoAlocacaoAdiantamentoService`). Falhas restantes são simétricas: (i) 1/3 guards documentado mas não enforçado, (ii) 0 teste sobre a classificação canary, (iii) execuções em PRD invisíveis fora do terminal do operador.
- **Recomendação consolidada**: 3 cards.
  - `validador-write-guards` (P2, S) — enforçar `CONEXOS_WRITE_ENABLED=false` + `CONEXOS_DRY_RUN=true` no `main()`; extrair `_shared/readOnlyEnv.ts` para reuso.
  - `validador-classificacao-test` (P2, S) — extrair função de classificação; 4 casos canary `(nosso, esperado) → veredito`.
  - `alarme-validador-prd` (P3, S) — evento estruturado no logger central + doc em CLAUDE.md.

### CC-4: Duplicação da fórmula `saldoNeg = valorPermutar / taxa` em 5 sítios (só metade "não consumido" foi extraída)
- **Aparece em**: Modifiability, Integrability
- **Findings**: F-modifiability-1 (P2)
- **Diagnóstico unificado**: a ADR-0046 explicita "uma única fonte da regra". A metade do MINUENDO (as alocações não consumidas) virou `SaldoAlocacaoAdiantamentoService`. A metade oposta (o saldo do ERP em moeda negociada, `valorPermutar / taxa`) segue duplicada em 5 sítios de `service/`, cada um reescrevendo a mesma pré-condição `valorPermutar !== undefined && taxa !== undefined && taxa > 0`. Assimetria fere a modifiability e amplia o custo da próxima mudança de regra de saldo.
- **Recomendação consolidada**: 1 card (`saldoneg-helper` P2, S). Adicionar `SaldoAlocacaoAdiantamentoService.saldoNegDoAdto` estático puro; migrar os 5 sítios (`GestaoPermutasService.ts:262,365,586`; `AlocacaoPermutasService.ts:250,376`; `IngestaoPermutasService.ts:425`; `ReconciliacaoPermutaService.ts:899`).

### CC-5: Consolidação de tolerâncias (BRL amarrada, USD/frontend dispersa)
- **Aparece em**: Modifiability, Testability, Integrability
- **Findings**: F-modifiability-4 (P3), F-testability-2 (P3 — SALDO_TOL), F-modifiability-2 (P3 — `libs/`)
- **Diagnóstico unificado**: `ToleranciaResiduo.LIMITE_BRL = 1` colapsou 3 sítios do BRL. Resta: (i) 5 literais `1`/`0.005` como magic numbers em "moeda negociada" (USD) — mesma semântica, unidade diferente; (ii) `SALDO_TOL` no frontend sem amarração à constante de domínio (divergência silenciosa entre back e front se o teto subir para R$2); (iii) `ToleranciaResiduo` mora em `domain/interface/permutas/` (pasta reservada a tipos) por convenção divergente. Nada urgente, mas propaga o padrão para o próximo refactor.
- **Recomendação consolidada**: 2 cards.
  - `tolerancia-usd-consolidada` (P3, S) — `LIMITE_MOEDA_NEGOCIADA` + amarrar `SALDO_TOL` do frontend por teste back↔front.
  - `mover-tolerancia-libs` (P3, S) — mover classe para `domain/libs/permutas/` + registrar convenção.

## 4. Quick wins (≤5 dias úteis, esforço S, severidade ≥ P2)

| Card | QA(s) | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `comment-atualizado-em` | Integrability (CC-1) | S | P2 | Leitor externo com `MAX(atualizado_em)` tem pista em SQL (`\d+` do psql), não só no docblock TS |
| `perf-indices-listconsumos` | Availability + Performance (CC-2) | S | P2 | EXPLAIN ANALYZE + `durationMs` no log; índices criados apenas se justificados por número (ou decisão de não criar registrada) |
| `detectar-reuso-borcod` | Fault Tolerance (R-1) | S | P2 | Query de detecção diária; `permuta_bordero_reuso_terminal_count = 0` esperado |
| `validador-write-guards` | Security (CC-3) | S | P2 | Guards do validador enforçados: 2/3 → 3/3 |
| `validador-classificacao-test` | Testability (CC-3) | S | P2 | 4 casos canary sobre veredito; inversão de sinal cai vermelho em CI |
| `rbac-gestao-alocacoes` | Security (R-5) | S | P2 | Política de leitura `/permutas/gestao` documentada por ADR ou gatiada por role — fecha card ADR-0043 |
| `kill-switch-saldo` | Deployability | S | P2 | MTTR para reverter comportamento do saldo: ~5min → ~30s (flip no dashboard) |
| `saldoneg-helper` | Modifiability (CC-4) | S | P2 | Duplicação de `valorPermutar / taxa` em services: 5 → 0 |
| `rollout-observabilidade` | Availability (CC-1) | S | P2 | Runbook + campo `saldosNegativosNoPainel` no log; janela de ≤ 6h passa a ser observável |

**9 quick wins** ≈ 9 dias úteis distribuíveis entre 2 devs = **~1 sprint**. Fecham 4 dos 5 top risks (R-1, R-2 parcial, R-3 parcial, R-4, R-5).

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `observabilidade-frescor-convergencia` | Deployability + Integrability + Fault Tolerance (CC-1) | M | Deployment observability + Condition Monitoring | Fecha a janela mais barulhenta pós-deploy (R-2). Sem isso, o primeiro incidente é reaberto como regressão da ADR-0046. Custo: 1 dev × 3d. Benefício: âncora temporal do fix + destrava rolling deploy futuro |
| `integracao-postgres-permutas` | Testability + Integrability (CC-2) | M | Sandbox + Executable Assertions | Ground-truth LIVE (247/0 DIVERGENTE) hoje é o único guardião das duas semânticas do banco — mas roda pré-PR, não em CI. Este card leva o teste para CI, cobrindo hotfixes `--urgent`. Reuso do harness de `routes/recebimentos.*.integration.test.ts` reduz para ~2d |
| `unificar-reconciliacao-saldo` | Availability | M | State Resynchronization | 1 fonte de saldo consumida por 3 callers (tela, `alocar`, `reconciliar`) — hoje é 1 fonte para 2 e outra para 1. Débito pré-existente F1 do interview; ficar com duas fontes é dívida ativa que o próprio ADR-0046 aponta como quebra da premissa "fonte única" |
| `reconciliacao-periodica-erp` | Fault Tolerance | M | Reconcile (Gray & Reuter §11) | Reaproveita `validate-permutas-saldo-ordem-centavos-v1.ts` como job semanal. Detecta divergências saldo(nosso) vs saldo(ERP) em ≤ 7d em vez de esperar cliente. Script pronto; custo = envelopar em job + notificação |

## 6. O que está bem (e por quê)

1. **Delta é 100% código, sem migration** — deploy zero-downtime, rollback via `git revert` puro, MTTR de reversão ≈ 1 ciclo Render (~3-5 min). Contrasta favoravelmente com o run 2026-09-08 (0054 sobre 152 k linhas). Tactic: **Rollback**. Evidência: `git diff --stat --diff-filter=A -- 'src/backend/migrations/**'` = 0 arquivos.
2. **`SaldoAlocacaoAdiantamentoService` como fonte única** da regra "quanto ainda não foi abatido pelo ERP" — consumido por 2 sítios (`GestaoPermutasService.ts:92`, `AlocacaoPermutasService.ts:252`). Divergência anterior (tela mostrava −19.257,73 no doc 12860; teto travava em 4.304,94 no doc 9328) fica impossível **por construção**. Tactic: **Use an Intermediary + Orchestrate**.
3. **Guarda de frescor fail-safe em TODA direção de skew analisada** — `b.atualizado_em < r.started_at` com carimbo em `atualizado_em` só avançando quando situação muda (`CASE WHEN ... IS DISTINCT FROM ...`). Todas combinações de skew app↔DB resultam em SUBESTIMAR consumo (nunca super-alocação). Tactic: **State Resynchronization por desenho**. Verificado adversarialmente pelo qa-fault-tolerance (F-fault-tolerance-1).
4. **Comparação em CENTAVOS + `Math.abs(valorAberto)`** — `Math.round(v*100) <= LIMITE_BRL*100` elimina float noise; `Math.abs` blinda sobrepagamento negativo (doc 4058 com `mnyTitAberto = −R$ 34.088,65` segue `nao-pago` no ground truth). Tactic: **Sanity Checking + Exception Prevention**. Cobertura de fronteira: `0.1+0.2`, `1.0000000001`, `0.7+0.1+0.2` em teste.
5. **Ground-Truth Validator importa código de PRODUÇÃO** (não reimplementa a regra) — 247 linhas / 0 DIVERGENTE contra Conexos PRD read-only. Aprendeu com PR #111 (ADR-0044): "um validador que reescreve a fórmula valida a si mesmo". Tactic: **Contract testing (ERP↔produção)**.
6. **`sumByAdiantamento` deletado sem callers órfãos** (`grep sumByAdiantamento src/` = 0) — o método fonte do bug foi removido de forma limpa, não mantido como wrapper deprecated (que mentiria por dupla contagem). Tactic: **Restrict Dependencies**.
7. **12/12 casos canônicos da ADR-0046 pinados em unit test com asserção numérica ±0,01** — 12860, 9328, 4 sem consumo, 43 INOX → JA_PERMUTADO, 28 residuais, 8721, 5 residuais ≥R$21 seguem `nao-pago`, doc 4058 negativo, fronteiras R$1,00/R$1,01. 62 testes novos, 8 arquivos ampliados. Tactic: **Executable Assertions**.
8. **Frontend `montarHistorico` extraído de `page.tsx` (1096 → 1048 LOC, −48) com 273 LOC de teste dedicado** — Split Module aplicado; dedupe por `${docCod}:${borCod}` cobre a interseção `permuta-manual` × `ja-permutado`. Tactic: **Split Module + Increase Semantic Coherence**.

## 7. Limitações da análise

**Métricas não medíveis localmente:**
- Duração real da 1ª ingestão pós-deploy (fecha a janela de ≤ 6h) — depende de Render start + cron GitHub Actions.
- `EXPLAIN (ANALYZE, BUFFERS)` do `listConsumosFinalizados` em Supabase (pooler) — sem credenciais.
- p95/p99 real de `GET /permutas/gestao` e `POST /permutas/alocar` pós-delta — não instrumentado.
- Skew de relógio app↔Postgres real — sem healthcheck.
- Frequência real de reuso de `bor_cod` para execuções terminais em prod — evidência EXISTE para `error` (bor 2436, 2771), para terminais é probabilística.
- Cobertura (`--coverage` Jest) — desativada por `--quick`; CI enforça `coverageThreshold` do `jest.config.cjs:39-48`.
- `npm audit` — desativado por `--quick`.
- Consumidores externos de `permuta_bordero.atualizado_em` (dashboards BI, planilhas ad-hoc) — sem `docs/api/CONTRACTS.md`; herança do run 2026-09-08.

**O que o pipe NÃO cobre**: chaos engineering, threat modeling formal, custo cloud, UX/acessibilidade, IaC (não há `infra/`; deploy é Render + Vercel).

**Contextos deliberados (não são omissões):**
- **Janela conservadora de ≤ 6h pós-deploy**: documentada no ADR-0046 §Consequências. A guarda de frescor **é** a estratégia de State Resynchronization; a próxima ingestão zera a janela sem intervenção. O que falta é observabilidade (CC-1), não redesign.
- **`ToleranciaResiduo.LIMITE_BRL = 1` hard-coded no código**: decisão da ADR-0046 D1 (rejeitados: 0,10 e proporcional). Redeploy é o binding time correto — externalizar para SSM sem circuit-breaker seria perigoso. Card `tolerancia-usd-consolidada` só pede nomear a constante USD, não externalizar.
- **CHECK de status ampliada não é este delta**: este delta é code-only; o débito pré-existente sobre exhaustividade `assertNever` (F-modifiability-2 do run 2026-09-08) não é re-raised aqui.
- **`ReconciliacaoPermutaService` lê saldo do banco (F1 do interview)**: pré-existente; delta NÃO piora nem melhora. Fica no follow-up F1 do próprio tasks.md como card `unificar-reconciliacao-saldo` (P2, M).
- **Nenhum P0/P1**: por decisão explícita. Todos os P2 são robustez operacional sobre um patch que já é estruturalmente positivo. Se algum revisor discordar, o ônus é apresentar baseline numérico + cenário concreto de dano que o merge cause.

**Item resolvido pelo pipeline (não segue como follow-up):**
- **`bump-versao-v0.36.5` (era `deployability-3`)** — F-deployability-4 apontava versão `0.36.4` sem bump para `0.37.0`. O delta é **fix-only** (3× `fix(permutas)` em `src/`, sem `feat` nem `perf`); pelo semver do repo isso qualifica **patch** (v0.36.5), não minor (v0.37.0). O passo de ship (`scripts/bump-version.ps1 -Execute -Level patch`) resolve o item antes do PR. Registrado no KANBAN como `bump-versao-v0.36.5` com status **`resolvido-pelo-pipeline`** — não vai para o inbox de follow-ups.

**Janela temporal**: snapshot de 2026-09-15. Código é vivo — refazer trimestralmente. Este delta em particular pauta 3 seguidas no `_watchlist.md` (recebimentos, pagamentos, permutas).

## 8. Ações recomendadas (próximos 30 dias, em ordem)

1. **Antes do merge (passo de ship, não follow-up)**: rodar `scripts/bump-version.ps1 -Execute -Level patch` (v0.36.5) e escrever o bloco de CHANGELOG com narrativa dos casos 12860/9328. Item `bump-versao-v0.36.5` marcado resolvido-pelo-pipeline no KANBAN.
2. **Sprint 1 pós-merge (S)**: fechar 6 quick wins P2 — `comment-atualizado-em`, `perf-indices-listconsumos`, `detectar-reuso-borcod`, `validador-write-guards`, `validador-classificacao-test`, `rollout-observabilidade`. Custo ≈ 6 dias × 1 dev. Fecha CC-1 (parcial), CC-2 (parcial), CC-3 completo e R-1.
3. **Sprint 2 (S+M)**: `rbac-gestao-alocacoes`, `kill-switch-saldo`, `saldoneg-helper` (quick wins restantes) + os 4 cards M — `observabilidade-frescor-convergencia` (fecha CC-1), `integracao-postgres-permutas` (fecha CC-2), `unificar-reconciliacao-saldo` (fecha F1 herdado), `reconciliacao-periodica-erp` (fecha dívida Reconcile do run 2026-09-08).
4. **Sprint 3 (limpeza P3)**: 9 cards P3 barato (todos S) — modifiability, performance, testability property-tests. Consolidar `tolerancia-usd-consolidada` e `mover-tolerancia-libs` na mesma passada.
5. **Governança contínua**: rodar Regis-Review no próximo delta que tocar `ToleranciaResiduo`, `SaldoAlocacaoAdiantamentoService`, `listConsumosFinalizados` ou qualquer migration >50 LOC sobre `permuta_bordero` para verificar se os P2 foram absorvidos.
