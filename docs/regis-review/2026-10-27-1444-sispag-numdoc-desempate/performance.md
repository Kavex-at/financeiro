---
qa: Performance
qa_slug: performance
run_id: 2026-10-27-1444-sispag-numdoc-desempate
agent: qa-performance
generated_at: 2026-10-27T14:44:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (ou formação automática) | Request de listagem/confirmação de sugestão de boleto dispara `sugerirAgora()` | `BoletoSuggestionService.calcularCenario` + `TituloAPagarRepository.listNumerosDocumento` + `MotorSugestaoBoleto.ancorarPorNumero` | Operação normal; `titulo_a_pagar` ~13k linhas (crescente, sem retenção), pool de boletos ~23k, carteira ativa alguns milhares | O cenário é recalculado em ≤ janela aceitável sem bloquear outras rotas; cache amortece listagens | p95 cenário ≤ 2s em ambiente HML; memória de pico ≤ 200MB; sem O(n·m) ao crescer a carteira |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas chamadas SQL por `sugerirAgora()` | +1 (`SELECT fil_cod, doc_cod, tit_cod, pes_cod, doc_esp_numero FROM titulo_a_pagar WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''`) | ≤ carteira ativa (`listAtivos`) | ⚠️ | `TituloAPagarRepository.ts:236-258` |
| LIMIT/paginação em `listNumerosDocumento` | ausente | explícito em paths de API/batch | ⚠️ | mesmo diff |
| Linhas retornadas (hoje) | ~13k × 5 colunas (strings curtas) ≈ 1–3 MB payload | — | ✅ hoje, ⚠️ 24m | ADR-0079 D6 + CLAUDE.md volume |
| Complexidade `ancorarPorNumero` | O(T + B + T') build do índice (uma vez por execução) + O(T·k) para k≤FAIXA; sem O(n·m) oculto | — | ✅ | `MotorSugestaoBoleto.ts:808-883` |
| Memória de pico extra (índice de números) | 1 `Map<string,number>` (~pool) + 1 `Map<string,Set<string>>` sobre titulos+titulosDoCredor | — | ✅ | mesmo arquivo |
| Cache amortecedor | `SugestaoBoletoCache` single-flight + TTL cobre `calcularCenario` (listagem) | — | ✅ | `BoletoSuggestionService.ts:159,214,874` |
| Chamadas que BYPASS cache | `confirmar` (l.277) e `desfechosAgora` (l.883) chamam `sugerirAgora()` direto → nova SELECT unbounded a cada ação | 0 bypass em ações frequentes | ⚠️ | `BoletoSuggestionService.ts:277,883` |
| Fail-closed | Falha de leitura só desliga a âncora, não aborta a sugestão | fail-closed por tactic Limit Event Response | ✅ | `BoletoSuggestionService.ts:907-920` |
| Pool PG `max` × concorrência | Não medível localmente (Supabase pooler) | — | ⚠️ | `PostgreeDatabaseClient` + Supabase |

> ⚠️ **Não medível localmente**: tempo real do SELECT em HML/PRD, índices disponíveis em `titulo_a_pagar` (schema fora do repo, gerido via Supabase). Recomendação: medir `EXPLAIN ANALYZE` em HML e colocar índice parcial `(pes_cod, doc_esp_numero) WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''` se o plano usar seq-scan > 300ms.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — demanda guiada por ação do usuário | N/A | — |
| Limit Event Response | Fail-closed desliga âncora na falha; cache serializa listagens | ✅ | `numerosOuDesligado` l.907 |
| Prioritize Events | N/A | N/A | — |
| Reduce Overhead | Índice de números construído **lazy** (só se houver pendente com número ≥ `MIN_DIGITOS`) e **uma vez** por execução | ✅ | `MotorSugestaoBoleto.ts:816-820` |
| Bound Execution Times | Nenhum `statement_timeout` configurado na query nova | ⚠️ | — |
| Increase Resource Efficiency | SQL seletivo em 5 colunas (não `SELECT *`); mapping direto | ✅ | diff repo |
| Increase Resources | — | N/A | — |
| Increase Concurrency | `Promise.all` já amplia o fan-out em `sugerirAgora` para incluir a 9ª leitura paralela | ✅ | l.930-939 |
| Maintain Multiple Copies of Computations | `SugestaoBoletoCache` TTL | ✅ parcial (só na listagem) | l.159 |
| Maintain Multiple Copies of Data | N/A | N/A | — |
| Bound Queue Sizes | N/A (Express síncrono) | N/A | — |
| Schedule Resources | N/A | N/A | — |

## 4. Findings (achados)

### F-performance-1: `listNumerosDocumento` é unbounded e cresce sem retenção

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times / Reduce Overhead
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:236-258`
- **Evidência**:
  ```sql
  SELECT fil_cod, doc_cod, tit_cod, pes_cod, doc_esp_numero
  FROM titulo_a_pagar
  WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''
  -- sem LIMIT, sem recorte temporal
  ```
- **Impacto técnico**: hoje ~13k linhas ≈ ms-range; sem retenção definida (ADR-0079 D6 diz "ativos ou não, pagos ou não — qualquer corte temporal reabre a janela que a guarda fecha"). Em 24m a tabela pode crescer 3–5× e o SELECT vira p95 > 500ms, acumulando com as outras 8 leituras paralelas de `sugerirAgora`.
- **Impacto de negócio**: degradação lenta e silenciosa da listagem SISPAG e, pior, da ação `confirmar` que faz esse SELECT a cada clique (ver F-performance-2).
- **Métrica de baseline**: query sem índice declarado para o filtro; payload atual ~1–3MB → tende a 5–15MB.

### F-performance-2: ação `confirmar` executa a SELECT unbounded a cada clique (bypass de cache)

- **Severidade**: P2 (sobe a P1 se `confirmar` virar hot-path de formação automática em lote)
- **Tactic violada**: Maintain Multiple Copies of Computations (cache)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:277` (dentro de `confirmar`) e `l.883` (`desfechosAgora` do leitor DPS)
- **Evidência**:
  ```ts
  // l.277
  const cenario = await this.sugerirAgora();   // ← dispara listNumerosDocumento + listAtivos + listBoletos + ...
  ```
  O cache (`SugestaoBoletoCache`) é usado só por `listagem()` e `situacoesPorTitulo()`. Toda confirmação/rejeição recalcula cenário completo.
- **Impacto técnico**: cada ação do analista = 9 queries paralelas (hoje 8 + 1 nova). Latência da nova query é marginal hoje, mas o custo total do cenário cresce linear com a carteira a cada ação.
- **Impacto de negócio**: UX do SISPAG em lote (formação automática confirma N boletos) degrada N× — risco antes de a frente ir a PRD.
- **Métrica de baseline**: 1 SELECT extra × N confirmações; sem telemetria de duração do `sugerirAgora` fora do caminho `calcularCenario` (`l.967` só loga quando o cenário é "calculado", não quando `confirmar` o roda).

### F-performance-3: índice de números materializa `titulos + titulosDoCredor` sem dedup antecipado

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts:862-882`
- **Evidência**:
  ```ts
  for (const t of [...entrada.titulos, ...(entrada.titulosDoCredor ?? [])]) { ... }
  ```
  `titulosDoCredor` já inclui a carteira ativa (sem filtro `ativo`), então os títulos ativos são iterados **duas vezes**. Benigno — o `Set` deduplica — mas desperdiça ~X ms e aloca entradas descartáveis. Também cria uma cópia via spread.
- **Impacto técnico**: O(T + T') onde T ⊂ T'. Memória extra transiente proporcional a `titulos.length` sem necessidade.
- **Impacto de negócio**: nenhum perceptível hoje.
- **Métrica de baseline**: 1× extra iteração sobre carteira ativa (~alguns milhares de linhas).

## 5. Cards Kanban

### [performance-1] Introduzir LIMIT defensivo + telemetria em `listNumerosDocumento`

- **Problema**
  > `listNumerosDocumento` faz full-scan de `titulo_a_pagar` sem LIMIT, sem recorte temporal (por desenho da ADR-0079 D6) e sem telemetria. Em 12–24 meses o custo deixa de ser desprezível, e hoje não há sinal para detectar isso.
- **Melhoria Proposta**
  > Adicionar `logService.info` com `duracaoMs` e `rows` em volta da chamada (reutilizar padrão do `calcularCenario`). Avaliar com DBA a criação de índice parcial `(pes_cod, doc_esp_numero) WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''`. Opcional: `LIMIT 100000` com `warn` se atingido (circuit-break antes de OOM).
- **Resultado Esperado**
  > p95 da query observável; alerta antes de passar de 1s. Baseline (hoje) → alvo: p95 ≤ 300ms em 24m, mesmo com crescimento 5× da tabela.
- **Tactic alvo**: Bound Execution Times / Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Duração observável no log estruturado: ausente → p95 em dashboard
  - Linhas retornadas: ~13k → telemetrizado, teto definido
- **Risco de não fazer**: degradação invisível por 1–2 anos; incidente de latência quando passar o joelho da curva.
- **Dependências**: nenhuma

### [performance-2] Reaproveitar cenário em cache em `confirmar` / `desfechosAgora` ou reduzir a leitura

- **Problema**
  > `confirmar` e `desfechosAgora` chamam `sugerirAgora()` direto, bypass do `SugestaoBoletoCache`. Cada ação do analista dispara 9 queries paralelas, incluindo o novo scan de números. Em formação automática em lote, isso vira N × 9.
- **Melhoria Proposta**
  > Avaliar se `confirmar` pode consumir o cenário em cache (há TOCTOU explicado por `reler()` na l.260 — a releitura do próprio título já cuida da parte crítica). Alternativa: variante `sugerirAgoraSemAncoraNumero` para o caminho `confirmar`, já que a confirmação só precisa de `pares`/`datasDebito` + avaliação direta.
- **Resultado Esperado**
  > Latência da ação `confirmar` deixa de crescer com |titulo_a_pagar|. Alvo: p95 `confirmar` sem relação com tamanho da tabela de títulos (hoje: cresce linearmente).
- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P2
- **Esforço estimado**: S–M
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Queries por confirmação: 9 → ≤ 4
  - p95 `confirmar` sob lote de 50 confirmações: baseline a medir → sem crescimento linear
- **Risco de não fazer**: formação automática do SISPAG sofre degradação proporcional ao crescimento da carteira; vira P1 em HML quando lotes de 100+ forem exercitados.
- **Dependências**: performance-1 (telemetria para medir)

### [performance-3] Deduplicar fonte do `indiceNumeros.documentos`

- **Problema**
  > O índice de documentos itera `[...entrada.titulos, ...entrada.titulosDoCredor]`, mas `titulosDoCredor` já é superconjunto. Trabalho duplicado barato, porém elimina-se com uma linha.
- **Melhoria Proposta**
  > Quando `titulosDoCredor` presente, iterar só sobre ele; cair para `titulos` apenas no caminho legado (`numeroAncoraDesligada`/entrada antiga).
- **Resultado Esperado**
  > Iterações do loop em `indiceNumeros`: (T + T') → T'. Memória de pico transiente reduzida ~proporcional a |carteira ativa|.
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Nº de pushes no `Set` por execução: T + T' → T'
- **Risco de não fazer**: nenhum operacional; só higiene.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo estrito à delta: `listNumerosDocumento`, `ancorarPorNumero`, `indiceNumeros`, novo campo em `EntradaMotorSugestao`.
- **Nenhum P0.** O defeito mais sério é o SELECT unbounded que crescerá sem retenção (ADR-0079 D6 justifica a ausência de corte), amortecido hoje pelo cache em `calcularCenario`. Baseline (~13k linhas) está dentro de qualquer envelope Supabase; o risco é temporal, não imediato.
- Complexidade do `ancorarPorNumero` é O(T + B + T') + O(T·k) com k ≤ `FAIXA` — nenhum O(n·m).
- Cross-QA: **Modifiability** — `TituloNumeroDocumento` + ADR-0079 D6 implicam política de retenção que o schema não documenta (schema fora do repo). **Testability** — não há teste medindo custo com carteira grande; sugiro perf-smoke opcional.
- Métricas de pool, EXPLAIN e índices do schema não são medíveis neste repo (Supabase gerido fora).
