---
qa: Performance
qa_slug: performance
run_id: 2026-10-06-1506-sispag-lotes-vencimento-mover
agent: qa-performance
generated_at: 2026-10-06T15:30:00-03:00
scope: backend + frontend (delta 1e68bd7..HEAD)
score: 8
findings_count: 3
cards_count: 2
---

# Performance — Regis-Review (delta sispag-lotes-vencimento-mover)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Abre o painel e monta lote manual de ~25 títulos (alguns movidos) | `SispagPainelService.montarPainel`, `LotePagamentoService.incluirTitulo`, `useCriarLoteManual` | Carga normal, carteira com meses de lotes FINALIZADO/REMESSA_GERADA | Painel carrega e lote é montado sem degradar com o histórico | Painel p95 sem crescimento por histórico; lote de 25 títulos < 3s |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Queries extras por `incluirTitulo` (sem mover) | +1 (`loteComprometidoComTitulo`, LIMIT 1, índice `idx_lote_pagamento_item_titulo`) | ≤ +1 | ✅ | LotePagamentoRepository.ts |
| Queries extras por `incluirTitulo` (mover) | +1 + 5 (delete, descartar alertas, marcarManual, tocar, cancelarSeVazio) | — | ⚠️ aceitável (dentro da mesma tx) | LotePagamentoService.ts `retirarDaOrigem` |
| Queries extras no painel | +1, em paralelo (`Promise.all`) | +1 paralela | ✅ | SispagPainelService.ts:132 |
| `listTitulosEmLotesComprometidos` com LIMIT / filtro de data | não | limitado à carteira ativa | ⚠️ | LotePagamentoRepository.ts |
| Chamadas HTTP sequenciais para lote de N títulos | N+1 (criarLote + N incluirTitulo) | — | ⚠️ (pré-existente, agravado pela query extra por chamada) | useCriarLoteManual.ts |
| `fatiar` complexidade | O(n) filtros, n ≤ carteira da filial/dia | O(n) | ✅ | FormacaoLotesService.ts |
| Índices | `idx_lote_pagamento_item_titulo (fil_cod,doc_cod,tit_cod)`, `idx_lote_pagamento_status` existem | presentes | ✅ | migrations/0023 |
| Bundle / cold start | Não medível: sem Lambda/infra no repo; delta não adiciona dependências | — | ⚠️ Não medível localmente | — |

## 3. Tactics

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Reduce Overhead | Verificação de comprometido por LIMIT 1 indexado; painel usa Map O(n) | ✅ presente | Repository/PainelService |
| Bound Execution Times | Mover atômico numa tx única, sem I/O externo dentro do lock | ✅ presente | LotePagamentoService.ts:280-335 |
| Limit Event Response | Frontend dispara includes sequenciais (sem rajada paralela) | ✅ presente | useCriarLoteManual.ts |
| Increase Concurrency | Includes sequenciais por design; sem endpoint em lote | ⚠️ parcial | useCriarLoteManual.ts |
| Maintain Multiple Copies of Data | Sem cache da lista de comprometidos | ❌ ausente (N/A hoje; volume baixo) | PainelService |
| Bound Queue Sizes | Query do painel sem limite sobre histórico | ⚠️ parcial | `listTitulosEmLotesComprometidos` |
| Manage Sampling Rate / Prioritize Events / Increase Resources / Schedule Resources / Increase Resource Efficiency / Maintain Multiple Copies of Computations | N/A para o delta (sem fila/Lambda/scheduler novos) | N/A | — |

## 4. Findings

### F-performance-1: Query do painel varre todo o histórico de lotes comprometidos

- **Severidade**: P2
- **Tactic violada**: Bound Queue Sizes / Reduce Overhead
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (`listTitulosEmLotesComprometidos`); consumo em `SispagPainelService.ts:132-155`
- **Evidência**: `WHERE l.status = ANY($status) ... ORDER BY l.criado_em ASC`, sem LIMIT nem restrição de data/carteira. FINALIZADO é estado que acumula para sempre.
- **Impacto técnico**: cada carga do painel lê todos os itens de todos os lotes finalizados/com remessa já feitos (cresce linear com o histórico), e o Map só é usado para títulos ativos. Índice por `status` é pouco seletivo à medida que FINALIZADO domina.
- **Impacto de negócio**: painel desacelera gradualmente com o tempo, sem falha visível.
- **Métrica de baseline**: não medível localmente (sem dados de produção); linhas = soma de itens de lotes FINALIZADO+REMESSA_GERADA, crescimento monotônico.

### F-performance-2: `incluirTitulo` em loop sequencial no frontend

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/frontend/app/sispag/components/useCriarLoteManual.ts` (loop `for ... await incluirTitulo`)
- **Evidência**: 1 + N requisições HTTP, cada uma com advisory lock + tx + agora 1 SELECT adicional (mais 5 operações quando move). Lote de 25 títulos ≈ 26 round trips.
- **Impacto técnico**: latência de criação ≈ N × (RTT + tx), p.ex. 25 × ~150ms ≈ 4s (estimativa, não medido). Falha parcial deixa lote criado com subconjunto (tratado com toast de aviso).
- **Impacto de negócio**: espera visível na tela ao criar lotes grandes; sem perda de correção.
- **Métrica de baseline**: N+1 chamadas por lote (N ≤ 25).

### F-performance-3: Query extra por include sem custo de índice dedicado ao filtro de status

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `loteComprometidoComTitulo` (join item→lote filtrando `l.status`)
- **Evidência**: usa `idx_lote_pagamento_item_titulo` e PK do lote; LIMIT 1; custo desprezível por título.
- **Impacto técnico**: nenhum mensurável; registrado apenas como observação (índice cobre o caso).
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: +1 query indexada por include (~1 ms esperado).

Nenhum P0/P1: sem N+1 em chamada externa, sem query ilimitada em hot path de fila, sem dependência nova, sem timer manual.

## 5. Cards Kanban

### [performance-1] Restringir a query de lotes comprometidos aos títulos da carteira ativa

- **Problema**
  > `listTitulosEmLotesComprometidos` lê todos os itens de lotes FINALIZADO/REMESSA_GERADA a cada carga do painel, crescendo com o histórico, embora só importem os títulos ativos.
- **Melhoria Proposta**
  > Restringir por JOIN com a carteira ativa (`titulo_a_pagar` ativo) ou por `l.criado_em >= now() - interval`, e usar `DISTINCT ON (fil_cod, doc_cod, tit_cod)` ordenado por `criado_em DESC` em vez de ordenar tudo e deixar o Map sobrescrever.
- **Resultado Esperado**
  > Linhas retornadas proporcionais à carteira ativa (não ao histórico): linhas lidas por carga do painel de O(histórico) para ≤ nº de títulos ativos.
- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Linhas retornadas pela query: crescimento linear com histórico → ≤ tamanho da carteira ativa
  - Tempo da query no painel (p95): medir em produção → estável com 12 meses de histórico
- **Risco de não fazer**: painel mais lento mês a mês.
- **Dependências**: nenhuma.

### [performance-2] Aceitar lista de títulos num único endpoint de inclusão

- **Problema**
  > Criar lote com N títulos dispara 1+N requisições sequenciais, cada uma com tx, advisory lock e queries de validação.
- **Melhoria Proposta**
  > Endpoint `POST /lotes/:id/titulos:batch` com `mover` por item, executando as inclusões numa tx por título (lock por título preservado) e retornando sucesso/falha por item.
- **Resultado Esperado**
  > Criação de lote de 25 títulos: 26 requisições → 2; latência de ~4s para < 1.5s (estimativa; confirmar com medição).
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Requisições por lote de 25 títulos: 26 → 2
  - Latência p95 de criação: ~4s (estimada) → < 1.5s
- **Risco de não fazer**: espera crescente para lotes grandes; baixo risco funcional.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: apenas o delta; Lambda/bundle/pool não aplicáveis (Express, sem infra/).
- Cross-QA: F-performance-2 toca Fault Tolerance (falha parcial no meio do loop deixa lote com subconjunto de títulos); lock por título em `incluirTitulo` toca Availability sob contenção.
- Sem dados de produção, baselines são estruturais; latências são estimativas rotuladas.
