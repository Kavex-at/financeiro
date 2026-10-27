---
type: regis-review-report
run_id: 2026-10-27-1444-sispag-numdoc-desempate
generated_at: 2026-10-27T14:44:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (reduced scope: Modifiability, Performance, Testability)
scope_mode: reduced (approved by Yuri on 2026-10-27)
total_cards: 10
total_p0: 0
total_p1: 0
total_p2: 5
total_p3: 5
overall_score: 7.6
---

# Regis-Review — financeiro — 2026-10-27-1444-sispag-numdoc-desempate

> **Escopo reduzido aprovado por Yuri em 2026-10-27.** Apenas 3 das 8 QAs foram executadas, por desenho:
> Modifiability, Performance e Testability — as três cujo risco a feature I15s / ADR-0079 move materialmente.
> Availability, Deployability, Integrability, Fault Tolerance e Security não foram executadas
> (`não executado (escopo reduzido aprovado)`). Ver seção 7 para implicações.

## 1. Executive scorecard

Pesos usados para a média ponderada (ajustados ao escopo reduzido feature-scoped):
Modifiability 1.2 · Performance 1.0 · Testability 1.0 → total 3.2.
Overall score = (7·1.2 + 7·1.0 + 9·1.0) / 3.2 = **7.6**.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | — | — | — | — | — | não executado (escopo reduzido aprovado) |
| Deployability | — | — | — | — | — | não executado (escopo reduzido aprovado) |
| Integrability | — | — | — | — | — | não executado (escopo reduzido aprovado) |
| Modifiability | 7.0 | 0 | 0 | 2 | 2 | F-modifiability-2: `listNumerosDocumento` full-scan sem janela/`ativo`/paginação |
| Performance | 7.0 | 0 | 0 | 2 | 1 | F-performance-2: `confirmar` chama `sugerirAgora()` direto, bypass do cache + 9 queries/clique |
| Fault Tolerance | — | — | — | — | — | não executado (escopo reduzido aprovado) |
| Security | — | — | — | — | — | não executado (escopo reduzido aprovado) |
| Testability | 9.0 | 0 | 0 | 1 | 2 | F-testability-2: `MotorSugestaoBoleto.ts` em 1148 LOC |
| **Overall** | **7.6** | **0** | **0** | **5** | **5** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura rápida:** feature está pronta para merge. Nenhum P0, nenhum P1. Toda a dívida detectada é
pré-existente ao delta (concentração no Motor, SELECT unbounded herdado de ADR-0079 D6) ou é higiene
(property tests, dedup de loop, teste do cluster TIME LOG). O delta em si — âncora I15s + fail-closed —
está arquiteturalmente limpo: Encapsulate + Semantic Coherence bem aplicados, DSL de sinais estendido
coerentemente FE+BE, cobertura 10/10 das cláusulas D1–D10 do ADR-0079.

## 2. Top 10 risks (cross-QA)

Ranked por composite (severidade × leverage × exposição temporal). Como não há P0/P1, todos os
riscos abaixo são P2/P3 e discutidos em termos de **tendência**, não de incidente iminente.

### R-1: `listNumerosDocumento` full-scan sem janela temporal
- **QA(s) afetados**: Modifiability + Performance
- **Findings de origem**: F-modifiability-2, F-performance-1, F-performance-2
- **Evidência sintetizada**: `TituloAPagarRepository.ts:235-258` — `SELECT ... FROM titulo_a_pagar WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''`. Sem `ativo`, sem `LIMIT`, sem recorte temporal (ADR-0079 D6 justifica a ausência de corte). Hoje ~13k linhas; sem retenção definida para `titulo_a_pagar`.
- **Impacto técnico**: query cresce linearmente com a tabela histórica. Em 12–24m com crescimento 3–5× passa de ms-range para p95 > 500ms. Pior: `confirmar()` e `desfechosAgora()` fazem bypass do `SugestaoBoletoCache` (`BoletoSuggestionService.ts:277,883`), então cada ação do analista = 9 queries paralelas incluindo esta.
- **Impacto de negócio**: formação automática do SISPAG (lotes de 50–100 confirmações) degrada N× o custo marginal da nova query. Risco antes da frente ir a PRD volume real.
- **Card(s) Kanban relacionados**: modifiability-2, performance-1, performance-2
- **Custo de inação em 6 meses**: assumindo crescimento 1.5× da tabela e 10 confirmações/dia em lote, cresce de ~ms imperceptíveis para dezenas de ms × 10 = perceptível pelo analista. Em 18–24m vira P1.

### R-2: `MotorSugestaoBoleto.ts` concentra políticas de identidade (1148 LOC)
- **QA(s) afetados**: Modifiability + Testability
- **Findings de origem**: F-modifiability-1, F-modifiability-4, F-testability-2
- **Evidência sintetizada**: Motor passou de 1023 → 1148 LOC (+125) absorvendo `ancorarPorNumero`, `indiceNumeros`, `escolhasPorAncora` com detector de conflito, `reservarPorAncora`. `BoletoSuggestionService.ts` em 1161 LOC. Teste do motor dividido em 3 arquivos (`.test`, `.dps.test`, `.numero.test` = 878+183+380 LOC) — o split do teste é um indicador direto do tamanho do SUT.
- **Impacto técnico**: cada nova âncora (watchlist já cita "aprender por credor" e código de barras parcial) empurra o mesmo arquivo para fora de qualquer envelope de leitura. Custo de PatternGuardian/revisão cresce linearmente.
- **Impacto de negócio**: velocidade de evolução da heurística de desempate (feature de maior valor da frente SISPAG) desacelera.
- **Card(s) Kanban relacionados**: modifiability-1, modifiability-4, testability-1
- **Custo de inação em 6 meses**: 1 nova âncora adiciona ~100 LOC. Em 2 âncoras passamos de 1200 LOC → zona desconfortável. O refactor fica mais caro a cada âncora empilhada.

### R-3: `confirmar()` e `desfechosAgora()` bypass do `SugestaoBoletoCache`
- **QA(s) afetados**: Performance
- **Findings de origem**: F-performance-2
- **Evidência sintetizada**: `BoletoSuggestionService.ts:277` e `l.883` chamam `sugerirAgora()` direto — o cache cobre só `listagem()` e `situacoesPorTitulo()`. Cada confirmação do analista = 9 queries paralelas.
- **Impacto técnico**: TOCTOU é tratado por `reler()` no caminho crítico (l.260), então o cache seria tecnicamente aproveitável para o resto.
- **Impacto de negócio**: formação automática em lote (N confirmações) multiplica o custo por N. P1 iminente quando a feature de "confirmar todos" entrar em PRD.
- **Card(s) Kanban relacionados**: performance-2
- **Custo de inação em 6 meses**: proporcional ao uso da formação automática — se o volume de lote dobrar, latência percebida dobra.

### R-4: `NUMERO_CONFIAVEL_MIN_DIGITOS = 4` hardcoded, retuning exige deploy
- **QA(s) afetados**: Modifiability (overlap com Deployability — não executado)
- **Findings de origem**: F-modifiability-3
- **Evidência sintetizada**: `RegraSugestaoBoleto.ts:42-48`. Documentado via comentário citando medição PRD (15/15), mas não parametrizável por `EnvironmentProvider`/SSM.
- **Impacto técnico**: ajuste operacional vira ciclo `/feature-tweak`.
- **Impacto de negócio**: baixo hoje (Columbia single-tenant), vira P2 no SaaSo multi-tenant.
- **Card(s) Kanban relacionados**: modifiability-3

### R-5: `normalizarNumero` sem property-based test
- **QA(s) afetados**: Testability
- **Findings de origem**: F-testability-3
- **Evidência sintetizada**: 4 asserções pontuais em `RegraSugestaoBoleto.test.ts:379-390`. `fast-check` já é dependência instalada no repo, mas 0 uso no SISPAG.
- **Impacto técnico**: strings exóticas de credor novo (letras + separadores + zeros intercalados) só são exercidas em PRD.
- **Impacto de negócio**: risco de falso `NUMERO_CONFIAVEL` em credor novo.
- **Card(s) Kanban relacionados**: testability-2

### R-6: cluster TIME LOG do ADR-0079 só existe em prosa
- **QA(s) afetados**: Testability
- **Findings de origem**: F-testability-4
- **Evidência sintetizada**: ADR-0079 §Consequências aceita 4 falsos sobre 79 vínculos (efeito financeiro nulo), mas o teste não nomeia o cluster.
- **Impacto técnico**: regressão silenciosa em refactor futuro.
- **Card(s) Kanban relacionados**: testability-3

### R-7: `indiceNumeros` itera `titulos` + `titulosDoCredor` com superconjunto redundante
- **QA(s) afetados**: Performance
- **Findings de origem**: F-performance-3
- **Evidência sintetizada**: `MotorSugestaoBoleto.ts:862-882` — `[...entrada.titulos, ...(entrada.titulosDoCredor ?? [])]` desperdiça 1× iteração sobre a carteira ativa.
- **Impacto técnico**: higiene; benigno (Set deduplica).
- **Card(s) Kanban relacionados**: performance-3

### R-8: `BoletoSuggestionService` em 1161 LOC absorve o passo `numerosOuDesligado`
- **QA(s) afetados**: Modifiability
- **Findings de origem**: F-modifiability-4
- **Evidência sintetizada**: `sugerirAgora` orquestra 8 fontes de dados em `Promise.all` + o novo fail-closed.
- **Impacto técnico**: cada nova fonte do motor toca o mesmo método.
- **Card(s) Kanban relacionados**: modifiability-4

### R-9: QAs não executadas podem esconder risco não medido
- **QA(s) afetados**: Availability / Deployability / Integrability / Fault Tolerance / Security
- **Findings de origem**: nenhuma (não executadas)
- **Evidência sintetizada**: escopo reduzido aprovado por Yuri em 2026-10-27. A feature é feature-scoped (desempate interno de uma heurística); Fault Tolerance tem cobertura marginal via `numeroAncoraDesligada` + fail-closed (apontado como boa prática em Modifiability §6). Security do delta é baixa por natureza (sem novo endpoint, sem novo input de usuário, SQL parametrizado).
- **Impacto técnico**: não medido para esta feature; o próximo run completo (padrão /regis-review full) deve cobrir.
- **Card(s) Kanban relacionados**: nenhum
- **Custo de inação em 6 meses**: baixo para esta feature específica; alto se o padrão "escopo reduzido" virar hábito sem justificativa.

### R-10: política de retenção de `titulo_a_pagar` não documentada no repo
- **QA(s) afetados**: Modifiability + Performance
- **Findings de origem**: F-performance-1 (ADR-0079 D6)
- **Evidência sintetizada**: ADR-0079 D6 diz "ativos ou não, pagos ou não — qualquer corte temporal reabre a janela que a guarda fecha". Schema está no Supabase, fora do repo.
- **Impacto técnico**: refactor futuro (view materializada, particionamento) precisa reler a intenção.
- **Card(s) Kanban relacionados**: modifiability-2 (resolve indiretamente)

## 3. Cross-cutting findings

### CC-1: `listNumerosDocumento` unbounded aparece em Modifiability e Performance
- **Aparece em**: Modifiability (F-modifiability-2), Performance (F-performance-1, F-performance-2)
- **Diagnóstico unificado**: a query nova introduzida pelo ADR-0079 é correta funcionalmente (fail-closed em `BoletoSuggestionService.numerosOuDesligado`), mas opera sem janela temporal nem telemetria. A ADR explicitamente recusa corte temporal (D6 justifica), então o colapso vai ser por volume, não por semântica. Soma-se o fato de que `confirmar()`/`desfechosAgora()` fazem bypass do cache e disparam a query por clique.
- **Recomendação consolidada**: um único card (**modifiability-2** + **performance-1**) resolve ambos — telemetria (`duracaoMs`, `rows`) + índice parcial Postgres + opcionalmente `LIMIT` defensivo com `warn` (circuit-break). Em paralelo, **performance-2** resolve o bypass do cache em `confirmar`.

### CC-2: `MotorSugestaoBoleto` concentrador aparece em Modifiability e Testability
- **Aparece em**: Modifiability (F-modifiability-1), Testability (F-testability-2)
- **Diagnóstico unificado**: o Motor é o concentrador de políticas de identidade (camada 0). Cada nova âncora empilha responsabilidades. O split em 3 arquivos de teste (reflexo direto do tamanho do SUT) é um sinal explícito de que o produção precisa seguir o mesmo caminho.
- **Recomendação consolidada**: **modifiability-1** (= **testability-1** = mesmo refactor) — extrair camada 0 para colaborador `AncoragemCamadaZero` injetado via tsyringe, com `AncoraOrdemDps` e `AncoraNumeroConfiavel` como implementações registradas. Resolve ambos simultaneamente.

### CC-3: configuração não externalizada (`NUMERO_CONFIAVEL_MIN_DIGITOS`)
- **Aparece em**: Modifiability (F-modifiability-3) + overlap com Deployability (não executado neste run)
- **Diagnóstico unificado**: constante hardcoded aceitável para single-tenant Columbia; vira fricção no SaaSo multi-tenant alvo.
- **Recomendação consolidada**: **modifiability-3** só justifica execução quando entrar o segundo cliente/filial com padrão de numeração diferente.

## 4. Quick wins (≤ 5 dias úteis)

Cards com esforço S e severidade ≥ P2:

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| performance-1 | Performance | S | P2 | Telemetria `duracaoMs`/`rows` em `listNumerosDocumento`; p95 observável antes de passar de 1s |
| modifiability-2 | Modifiability | S | P2 | Janela temporal/projeção declarada em `listNumerosDocumento`; latência estável conforme a tabela cresce |
| performance-2 | Performance | S–M | P2 | `confirmar` deixa de disparar a 9ª query a cada clique; queries por confirmação 9 → ≤ 4 |

Esses três cards são a defesa de "primeira sprint pós-aprovação": custo baixo, impacto temporal direto na mesma causa-raiz (CC-1).

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-1 / testability-1 | Modifiability + Testability | M | Split Module + Abstract Common Services | Motor de 1148 LOC vira ≤ 800; próxima âncora (watchlist cita "aprender por credor", código de barras parcial) nasce em arquivo próprio ≤ 250 LOC em vez de somar ao concentrador. Métrica dura: cada âncora adicionada ao Motor nos últimos 2 ciclos custou +100 LOC. |
| modifiability-4 | Modifiability | M | Increase Semantic Coherence | `BoletoSuggestionService` de 1161 LOC → ≤ 900; 9ª fonte de dados do motor passa a ser 1 arquivo novo em vez de 10 LOC no service. Faz sentido como follow-up do modifiability-1 (mesmo mindset). |

## 6. O que está bem (e por quê)

Pontos onde a feature acerta — ancora a credibilidade do resto do relatório:

1. **Abstração `ancoraForte` unifica DPS e número em camada 0** (`MotorSugestaoBoleto.ts:154-168`). Tactic: **Increase Semantic Coherence**. Rename coerente (`porDps` → `ancoraForte`, `escolhasPorDps` → `escolhasPorAncora`). Não é renomear-por-renomear — a abstração absorve a próxima âncora sem redesign.
2. **Fail-closed por kill-switch** (`BoletoSuggestionService.numerosOuDesligado` l.907-920). Tactic: **Limit Event Response**. Falha de leitura desliga só a âncora, nunca aborta a sugestão. Padrão a replicar.
3. **Encapsulate preservado**: Motor segue sem conhecer SQL; o novo sinal `NUMERO_CONFIAVEL` chega via interface `EntradaMotorSugestao`. 0 violação de camada no diff.
4. **Cobertura 10/10 das cláusulas ADR-0079 (D1–D10)** em `MotorSugestaoBoleto.numero.test.ts` (18 testes). Determinismo total (`BankingCalendar.withClock`); 0 rede/HTTP/clock real.
5. **Caso real NELSON 25037/25041 do ADR codificado como fixture** (`MotorSugestaoBoleto.numero.test.ts:100-128`). Tactic: **Recordable Test Cases**.
6. **SQL parametrizado + fail-closed na nova leitura** — SQL seletivo em 5 colunas, não `SELECT *`.
7. **Nenhum defeito introduzido pelo delta justifica P0 em qualquer QA executada.**

## 7. Limitações da análise

- **Escopo reduzido (aprovado por Yuri em 2026-10-27)**: 5 das 8 QAs não executadas (Availability, Deployability, Integrability, Fault Tolerance, Security). Decisão defensável para esta feature por ser feature-scoped (desempate interno de heurística, sem novo endpoint, sem novo input de usuário, sem mudança de deploy/infra). **Risco documentado em R-9.** Próximo run `/regis-review full` deve cobrir.
- **Métricas declaradas como "não medíveis localmente"**:
  - Fan-in de `MotorSugestaoBoleto`/`BoletoSuggestionService` fora deste delta (Modifiability).
  - `EXPLAIN ANALYZE` real de `listNumerosDocumento` em HML/PRD; índices de `titulo_a_pagar` (schema fora do repo); pool PG `max` × concorrência (Supabase pooler).
  - Precisão real do critério I15s (82 % prometidos em ADR-0079) — depende de pool PRD, não automatizável aqui.
- **O que o pipe não cobre**: chaos engineering, threat modeling formal, custo cloud, UX além do schema do sinal, acessibilidade.
- **Janela temporal**: snapshot de 2026-10-27. Refazer trimestralmente ou quando a feature evoluir.

## 8. Ações recomendadas

Em ordem de execução para os próximos 30 dias:

1. **Mergear este PR.** Nenhum P0, nenhum P1. Delta arquiteturalmente limpo; follow-ups P2/P3 vão para `ontology/_inbox/sispag-numdoc-desempate-regis-followups.md`.
2. **Antes da próxima âncora entrar na backlog**, abrir **modifiability-1 / testability-1** (extrair camada 0 para `AncoragemCamadaZero`). O custo cresce a cada âncora empilhada; esperar é pagar juros.
3. **Em paralelo à próxima feature SISPAG que tocar `TituloAPagarRepository`**, aplicar **performance-1** + **modifiability-2** (telemetria + janela temporal em `listNumerosDocumento`).
4. **Antes da formação automática em lote (confirmar-todos) ir a PRD**, abrir **performance-2** (bypass do cache em `confirmar`).
5. **No próximo `/regis-review` desta frente**, executar escopo completo (8 QAs).
