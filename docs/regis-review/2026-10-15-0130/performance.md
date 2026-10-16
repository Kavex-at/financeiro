---
qa: Performance
qa_slug: performance
run_id: 2026-10-15-0130
agent: qa-performance
generated_at: 2026-10-15T01:30:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG abrindo a aba de títulos (várias listagens por tela) | `GET /sugestoes-boleto` com ~1,1k títulos × ~8,8k boletos livres, cache expirado (TTL 30 s) | `MotorSugestaoBoleto.analisar` + `BoletoSuggestionService.listarSugestoes` + `SugestaoBoletoCache` | Operação normal, 1 processo Render | Motor roda uma vez (single-flight), as demais listagens leem o cache | Cache frio: motor ≤ 1 s e resposta p95 ≤ 3 s; cache quente: p95 ≤ 300 ms; payload ≤ 1 MB |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Custo do motor (1,1k títulos × 8,8k boletos) | ~0,6 s fora do jest (1 amostra relatada) | ≤ 1 s | ✅ | `_shared-metrics.md` |
| Complexidade por título | busca binária no índice por valor (`primeiro`) + varredura só na faixa do envelope; top-3 por título | sub-quadrática | ✅ | `MotorSugestaoBoleto.ts:426-435, 600-628` |
| N+1 no serviço/rota novos | 0 (6 leituras em `Promise.all` em `sugerirAgora`; nenhuma consulta dentro de loop de título) | 0 | ✅ | `BoletoSuggestionService.ts:862-869` |
| Listagem lê do cache (TTL 30 s, mesma chave) | sim; `listarSugestoes` e `detalharTitulo` usam o mesmo cenário | sim | ✅ | `BoletoSuggestionService.ts:152, 207` |
| Confirmar/rejeitar usa cache | não: `sugerirAgora()` ao vivo (anti-TOCTOU, intencional) | ao vivo | ⚠️ | `BoletoSuggestionService.ts:270` |
| Tamanho máximo de página | padrão 50, teto 2000; tela pede 2000 (894 elegíveis hoje) | ≤ 2000 | ⚠️ | `SugestaoBoleto.ts:347-352`, `lib/sispag.ts:2317` |
| Payload da listagem | `sugestoes` (legado) + `titulos` (com até 3 candidatos cada) na mesma resposta | sem duplicação | ⚠️ | `BoletoSuggestionService.ts:188-189` |
| Memória do cache | só `sugestoes`, `desfechos`, `pares`, `datasDebito` (os 8,8k boletos não são retidos); ~1,1k desfechos × ≤3 candidatos = ordem de poucos MB | ≤ 20 MB | ✅ | `BoletoSuggestionService.ts:854-887` |
| Memo de `Date.parse` | Map global limitado a 20k entradas, limpa ao estourar | limitado | ✅ | `RegraSugestaoBoleto.ts:43-57` |
| Duração do cenário em produção (p95) | Não medível localmente; o log `sugestao_boleto.cenario_calculado.duracaoMs` existe | p95 ≤ 1,5 s | ⚠️ | ver nota abaixo |
| Renderização de ~900 linhas | filtros em `useMemo` O(n); tabela paginada por `useTabelaFiltro` | — | ✅ | `page.tsx` (diff) |

> ⚠️ **Não medível localmente**: duração do motor em produção (p95) e tamanho em bytes da resposta com 894 títulos. Requer log do Render / `curl` autenticado. Recomendação: agregar `duracaoMs` do log existente e registrar `content-length` da listagem.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | TTL 30 s no cenário; N listagens da tela compartilham uma execução | ✅ presente | `SugestaoBoletoCache.ts` |
| Limit Event Response | single-flight; invalidação em decisão e fim de sync | ✅ presente | `SugestaoBoletoCache.ts:53-79` |
| Prioritize Events | N/A: sem classes de requisição concorrentes neste fluxo | N/A | — |
| Reduce Overhead | índice ordenado por valor + busca binária; pool livre pré-computado uma vez; memo de `Date.parse` | ✅ presente | `MotorSugestaoBoleto.ts:333, 426` |
| Bound Execution Times | sem orçamento de tempo no motor; é CPU síncrona | ⚠️ parcial | `MotorSugestaoBoleto.ts:462-500` |
| Increase Resource Efficiency | top-3 por título; boletos descartados do cache | ✅ presente | `SUGESTAO_TOP_CANDIDATOS = 3` |
| Increase Resources | N/A: instância única Render | N/A | — |
| Increase Concurrency | N/A: motor síncrono; DB reads já em `Promise.all` | N/A | — |
| Maintain Multiple Copies of Computations | cache por processo, TTL 30 s | ✅ presente | `SugestaoBoletoCache.ts` |
| Maintain Multiple Copies of Data | cenário em memória | ✅ presente | idem |
| Bound Queue Sizes | teto de página 2000; sem fila | ⚠️ parcial | `SugestaoBoleto.ts:352` |
| Schedule Resources | N/A | N/A | — |
| Index discipline | `listAtivos`/`listBoletos({})` sem LIMIT, lidos inteiros por desenho | ⚠️ parcial | `BoletoSuggestionService.ts:863-864` |
| Cold start / bundle | sem dependência nova no delta | ✅ | `git diff --stat` |

## 4. Findings

### F-performance-1: resposta da listagem carrega os candidatos duas vezes

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:188-189`; `src/frontend/lib/sispag.ts:2324-2326`
- **Evidência (objetiva)**:
  ```
  sugestoes: recorte.map(paraView)            // legado: 1 item por par título×boleto, com avaliacao
  titulos:   recorteTitulos.map(paraViewDesfecho) // 1 por título, com até 3 candidatos (avaliacao de novo)
  ```
  A tela pede `tamanho=2000` e a mesma página recorta as duas listas.
- **Impacto técnico**: serialização e parse de JSON duplicados em cada listagem; cresce linearmente com a carteira (894 títulos hoje).
- **Impacto de negócio**: tela do SISPAG mais lenta a cada crescimento da carteira; sem incidente.
- **Métrica de baseline**: tamanho em bytes não medido; candidatos aparecem 2× por título com candidato.

### F-performance-2: o motor é CPU síncrona no event loop do processo único

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `MotorSugestaoBoleto.ts:600-628`; `BoletoSuggestionService.ts:270, 893-913`
- **Evidência (objetiva)**:
  ```
  ~0,6 s por execução (1,1k × 8,8k); roda a cada expiração de TTL (30 s) com a tela aberta,
  a cada confirmar (sugerirAgora ao vivo) e depois de cada invalidação.
  ```
- **Impacto técnico**: durante ~0,6 s o processo não atende nenhuma outra rota (inclusive as de outros analistas e o health check). Se a carteira ou o pool crescer 5×, ou muitos boletos de mesmo valor ampliarem a faixa do envelope, o custo cresce acima do linear. Sem teto de tempo.
- **Impacto de negócio**: travadas curtas de todo o app durante o uso do SISPAG; hoje abaixo do limiar de percepção.
- **Métrica de baseline**: 0,6 s por execução; duty cycle estimado ≤ 2% (0,6 s / 30 s) por tela aberta.

### F-performance-3: confirmar recalcula o motor inteiro e a invalidação força novo cálculo na listagem seguinte

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `BoletoSuggestionService.ts:270, 398`
- **Evidência (objetiva)**: `const cenario = await this.sugerirAgora();` seguido de `this.cache.invalidar();`. Uma sequência de N confirmações custa N motores + N recálculos de listagem. O comportamento já existia em `origin/main` (linha 224); o motor ficou mais pesado com `todosCandidatos`.
- **Impacto técnico**: confirmação em série de dezenas de títulos = dezenas de × 0,6 s de bloqueio.
- **Impacto de negócio**: fluxo de confirmação em lote do analista fica mais lento; correção (anti-TOCTOU) preservada.
- **Métrica de baseline**: ~0,6 s CPU + 6 leituras por confirmação.

### F-performance-4: ausência de medição de produção do motor e do payload

- **Severidade**: P3
- **Tactic violada**: Manage Sampling Rate (observabilidade do dial)
- **Localização**: `BoletoSuggestionService.ts:899-911`
- **Evidência (objetiva)**: log de `duracaoMs` existe, mas não há alerta nem registro do tamanho da resposta; o único número de 0,6 s é uma amostra.
- **Impacto técnico**: regressão de desempenho só aparece por reclamação do analista.
- **Impacto de negócio**: diagnóstico tardio.
- **Métrica de baseline**: 1 amostra, sem p95.

Sem P0: nenhum caminho do delta pode estourar tempo ou memória na requisição (cache single-flight, memória do cache e memo limitados, página com teto de 2000, sem N+1).

## 5. Cards Kanban

### [performance-1] Deduplicar candidatos na resposta da listagem

- **Problema**
  > A listagem devolve `sugestoes` (legado) e `titulos` (com candidatos) na mesma página de até 2000 itens, repetindo a avaliação de cada candidato.
- **Melhoria Proposta**
  > Reduce Overhead: com `titulos` presente, o frontend deriva o que precisa de `titulos` (já faz via `desfechoPorTitulo`); omitir `sugestoes` quando a rota é chamada com `situacao` ou um parâmetro `formato=titulos`, mantendo o legado para clientes antigos. Tocar `BoletoSuggestionService.listarSugestoes`, `routes/sispag.ts`, `lib/sispag.ts`.
- **Resultado Esperado**
  > Payload da listagem com 894 títulos reduzido em ~40-50% (a medir: bytes antes/depois).
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - bytes da resposta com tamanho=2000: a medir → -40%
  - p95 da listagem com cache quente: a medir → ≤ 300 ms
- **Risco de não fazer**: carteira cresce e a tela passa a pagar JSON duplicado a cada abertura.
- **Dependências**: card performance-3 (medir antes).

### [performance-2] Orçamento de tempo e cedência do event loop no motor

- **Problema**
  > O motor roda síncrono (~0,6 s) e bloqueia o processo inteiro a cada expiração de cache; sem teto, uma carteira 5× maior leva a 3 s ou mais de bloqueio.
- **Melhoria Proposta**
  > Bound Execution Times: processar títulos em lotes de ~200 com `await setImmediate` entre eles (via utilitário, não `setTimeout` manual) e logar `duracaoMs` acima de 1,5 s como `warn`. Aplicar também à rota de confirmação.
- **Resultado Esperado**
  > Bloqueio máximo contínuo do event loop: 600 ms → ≤ 50 ms; duração total do cenário inalterada (±10%).
- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-2, F-performance-3
- **Métricas de sucesso**:
  - maior bloqueio contínuo do event loop (monitor de lag): ~600 ms → ≤ 50 ms
  - latência p95 de uma rota trivial durante o recálculo: a medir → ≤ 150 ms
- **Risco de não fazer**: com crescimento de carteira, travadas visíveis e timeout do health check no Render.
- **Dependências**: nenhuma.

### [performance-3] Medir o motor e o payload em produção

- **Problema**
  > Só existe uma amostra de 0,6 s fora do jest; não há p95 nem tamanho de resposta registrados.
- **Melhoria Proposta**
  > Registrar `content-length` da listagem no log de rota e agregar `sugestao_boleto.cenario_calculado.duracaoMs` num relatório semanal (job de leitura existente `medir-desfecho-sugestao-boleto` é o lugar natural). Definir limiar de alerta em 1,5 s.
- **Resultado Esperado**
  > p95 de `duracaoMs` e p95 do payload conhecidos (de "sem dado" para número com alvo ≤ 1,5 s e ≤ 1 MB).
- **Tactic alvo**: Manage Sampling Rate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - p95 de `duracaoMs`: desconhecido → medido, ≤ 1,5 s
  - p95 do payload: desconhecido → medido, ≤ 1 MB
- **Risco de não fazer**: regressão silenciosa; decisões sobre os cards 1 e 2 por palpite.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: delta contra `origin/main`; não executei o motor nem medi bytes (sem acesso a produção); os números de custo vêm do `_shared-metrics.md`.
- Confirmar usar `sugerirAgora()` ao vivo é decisão de segurança (anti-TOCTOU, I15a), não regressão; só o custo por chamada subiu.
- Cross-QA: o cache guarda `emissor.chave` e barras em memória do processo (Security, mascaramento só na saída); event loop bloqueado toca Availability (health check do Render).
