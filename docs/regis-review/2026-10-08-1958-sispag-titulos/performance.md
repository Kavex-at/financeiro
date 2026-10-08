---
qa: Performance
qa_slug: performance
run_id: 2026-10-08-1958-sispag-titulos
agent: qa-performance
generated_at: 2026-10-08T20:30:00Z
scope: backend
score: 8.5
findings_count: 2
cards_count: 1
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Clica em exportar com até 5000 títulos filtrados | `POST /sispag/titulos/exportar` (`TitulosAPagarExportService`) | Express/Render, carteira ~1,5 mil linhas, operação normal | Lê a carteira local, projeta na ordem da tela, serializa o .xlsx sem chamar o Conexos | p95 < 2s para 1,5 mil títulos; < 5s no teto de 5000; 0 chamadas externas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas externas (Conexos) no export | 0 | 0 | ✅ | `TitulosAPagarExportService.ts:70-75` |
| Queries por export | 3 em paralelo (`Promise.all`) | ≤ 3 | ✅ | idem |
| N+1 no delta | 0 (lookup por `Map`, O(n)) | 0 | ✅ | `TitulosAPagarExportService.ts:76-100` |
| Teto de linhas | 5000 (zod `.max`), igual ao `TITULOS_CAP` | limitado | ✅ | `routes/sispag.ts` (schema) |
| Corpo da requisição | chaves compactas, cabem nos 100 KB do `express.json()` | < 100 KB | ✅ | teste em `routes/sispag.test.ts` |
| Rate limit | `heavyRouteLimiter` | presente | ✅ | `routes/sispag.ts` |
| Releitura da carteira inteira por export | ~1,5 mil linhas | — | ⚠️ | `listAtivos()` sem filtro por chave |
| Dependências novas | 0 (writer extraído) | 0 | ✅ | `PlanilhaXlsxWriter.ts` |
| Latência/cold start/bundle | Não medível localmente | — | ⚠️ | Requer APM/produção. `--quick` não rodou build; sem `infra/`. |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: ação sob demanda, sem polling | N/A | — |
| Limit Event Response | Rate limiter pesado na rota | ✅ presente | `heavyRouteLimiter` |
| Prioritize Events | N/A: sem fila | N/A | — |
| Reduce Overhead | Sem Conexos; queries em paralelo; filtro em memória | ✅ presente | `TitulosAPagarExportService.ts:70` |
| Bound Execution Times | Teto de 5000 chaves; sem timeout explícito de query | ⚠️ parcial | zod `.max(MAX_TITULOS_EXPORT)` |
| Increase Resource Efficiency | `Map` O(1), `Set` para dedup | ✅ presente | `:76-100` |
| Increase Resources / Concurrency | N/A: delta não altera pool nem concorrência | N/A | — |
| Maintain Multiple Copies of Computations/Data | N/A: leitura da carteira persistida | N/A | — |
| Bound Queue Sizes | N/A: sem fila | N/A | — |
| Schedule Resources | Rate limit cobre a contenção | ✅ presente | — |
| Cache strategy | Ausente; sem necessidade com 1,5 mil linhas | ⚠️ parcial | — |
| Index discipline | `listAtivos` e listas de lotes sem filtro por chave; escaneiam a carteira ativa | ⚠️ parcial | repositórios fora do delta |

## 4. Findings

### F-performance-1: Export relê a carteira ativa inteira para atender até 5000 chaves

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/TitulosAPagarExportService.ts:70-75`
- **Evidência (objetiva)**:
  ```
  this.tituloRepo.listAtivos(), this.loteRepo.listTitulosEmRascunho(), this.loteRepo.listTitulosEmLotesComprometidos()
  ```
- **Impacto técnico**: custo linear no tamanho da carteira (~1,5 mil linhas), não no pedido. Se a carteira crescer 10x ou o export for chamado em rajada, vira scan repetido. O rate limiter contém a rajada.
- **Impacto de negócio**: nenhum hoje; export é ação manual do analista.
- **Métrica de baseline**: ~1,5 mil linhas por export; 3 queries.

### F-performance-2: Serialização .xlsx em memória no event loop do Express

- **Severidade**: P3
- **Tactic violada**: Bound Execution Times
- **Localização**: `PlanilhaXlsxWriter.ts`, `routes/sispag.ts` (`res.send(buffer)`)
- **Evidência (objetiva)**: buffer completo de até 5000 linhas × 12 colunas, gerado em processo único.
- **Impacto técnico**: ordem de dezenas de ms a poucos s de CPU no teto. Pode bloquear brevemente outras requisições do mesmo processo Render. Sem medição de produção.
- **Impacto de negócio**: desprezível no volume atual.
- **Métrica de baseline**: teto 5000 linhas; tempo real não medido.

## 5. Cards Kanban

### [performance-1] Medir latência do export e filtrar a carteira por chave só se passar do alvo

- **Problema**
  > O export relê toda a carteira ativa e serializa o .xlsx de forma síncrona. Hoje (~1,5 mil linhas) é barato, mas não há métrica de duração que avise quando deixar de ser.

- **Melhoria Proposta**
  > Logar `durationMs` no `BUSINESS_INFO` de `exportar` (Reduce Overhead). Se p95 passar do alvo, adicionar `listAtivosPorChaves(chaves)` com `WHERE (fil_cod, doc_cod, tit_cod) IN (...)`.

- **Resultado Esperado**
  > Duração do export observável no log. Alerta quando p95 > 2s.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - duração do export logada: não → sim
  - p95 do export com 1,5 mil títulos: não medido → < 2s
- **Risco de não fazer**: crescimento da carteira degrada o export sem aviso.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de e832057. Nenhum P0/P1: sem N+1, sem chamada externa, com teto e rate limit.
- Queries `listTitulosEm*` e `listAtivos` pré-existentes, reutilizadas do painel, fora do escopo de severidade.
- Cross-QA: o índice de `titulo_a_pagar` e as migrations tocam Modifiability. A ausência de timeout de query toca Availability.
