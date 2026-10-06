---
qa: Performance
qa_slug: performance
run_id: 2026-10-06-1500
agent: qa-performance
generated_at: 2026-10-06T15:00:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

Escopo: delta `origin/main..HEAD` (commit 341f756), feature-tweak `sispag-remessa-download-export`. Leitura de código apenas; nada executado contra Conexos ou rede.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro | Abre a aba Finalizados, baixa uma remessa e exporta títulos de até 50 lotes | `GET /sispag/lotes`, `GET /sispag/lotes/:id/remessa/arquivo`, `POST /sispag/remessas/titulos/exportar` | Render (Express), Postgres, Conexos fin015 lento (2-10s p99) | Lista com projeção completa; download com no máximo 2 chamadas Conexos; export em memória sem tocar o Conexos | p95 export de 50 lotes < 3s; download < 12s p95; heap de pico do export < 100MB |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Queries no export (N lotes) | 2 (headers + itens `ANY($ids)`) | O(1) | ✅ | `LotePagamentoRepository.comItens` |
| N+1 no delta | 0 | 0 | ✅ | leitura do diff |
| Teto de lotes por export | 50 (Zod `.max`) | limitado | ✅ | `routes/sispag.ts` `exportarTitulosSchema` |
| Chamadas Conexos por download | 1 (grade) + 1 (fallback gabCod) = máx. 2, sequenciais | ≤ 2 | ✅ | `RemessaService.baixarArquivo` |
| Colunas extras em `listLotes` | +6 colunas escalares (`remessa_*`, `native_*`) | pequeno | ✅ | `LOTE_HEADER_COLUMNS` |
| `listLotes` sem LIMIT/paginação | 1 (preexistente, agora com payload maior) | 0 | ⚠️ | `LotePagamentoRepository.listLotes` |
| Novas dependências runtime | 0 (`exceljs` já em `package.json`) | 0 | ✅ | `src/backend/package.json:45` |
| Tamanho de `exceljs` | 23MB em node_modules; import estático no service | lazy | ⚠️ | `du -sh node_modules/exceljs` |
| Latência/heap reais do export | Não medível localmente | ver card | ⚠️ | ver abaixo |

> ⚠️ **Não medível localmente**: p95 do export com 50 lotes reais e consumo de heap no Render. Recomendação: registrar `ms` e `bytes` no `logService.info` do export e acompanhar em produção.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: sem telemetria periódica no delta | N/A | - |
| Limit Event Response | `heavyRouteLimiter` no export; teto de 50 lotes | ✅ presente | `routes/sispag.ts` |
| Prioritize Events | N/A: sem fila no delta | N/A | - |
| Reduce Overhead | Projeção única `LOTE_HEADER_COLUMNS`; itens em 1 query; export sem Conexos | ✅ presente | `LotePagamentoRepository.ts` |
| Bound Execution Times | Fallback limitado a 1 chamada extra; timeout do axios fora do delta (herdado) | ⚠️ parcial | `RemessaService.baixarArquivo` |
| Increase Resource Efficiency | exceljs `writeBuffer` em memória, sem streaming nem lazy import | ⚠️ parcial | `RemessaTitulosExportService.serializar` |
| Increase Resources | N/A: Render fixo | N/A | - |
| Increase Concurrency | N/A | N/A | - |
| Maintain Multiple Copies of Computations | N/A | N/A | - |
| Maintain Multiple Copies of Data | Sem cache do .REM baixado; cada download vai ao Conexos | ⚠️ parcial | `baixarArquivo` |
| Bound Queue Sizes | Teto 50 ids por export; `listLotes` sem teto | ⚠️ parcial | `routes/sispag.ts` / repository |
| Schedule Resources | N/A | N/A | - |
| Cold start / bundle | Sem dependência nova; import estático de exceljs (Express, sem cold start Lambda) | ✅ | package.json |
| Index discipline | `id = ANY($ids)` usa a PK; `lote_pagamento_item.lote_id` já usado em `ANY` | ✅ | repository |

## 4. Findings

### F-performance-1: `listLotes` continua sem paginação e agora devolve cabeçalhos mais largos

- **Severidade**: P2
- **Tactic violada**: Bound Queue Sizes
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (`listLotes`)
- **Evidência (objetiva)**:
  ```
  WHERE ($status::text IS NULL OR status = $status) AND ($filCod::int IS NULL OR fil_cod = $filCod)
  ORDER BY criado_em DESC     -- sem LIMIT; itens de TODOS os lotes via ANY($ids)
  ```
- **Impacto técnico**: o crescimento de lotes (jobs automáticos diários) aumenta payload e tempo linearmente; o fix só acrescentou ~6 colunas escalares por lote (custo marginal desprezível), mas o padrão sem LIMIT permanece.
- **Impacto de negócio**: aba Finalizados lenta com o passar dos meses.
- **Métrica de baseline**: 1 query sem LIMIT; nº de lotes em produção não medível localmente.

### F-performance-2: Download de remessa faz 2 chamadas Conexos sequenciais no caminho de fallback

- **Severidade**: P3
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (`baixarArquivo`)
- **Evidência (objetiva)**: `listarArquivosRemessa` (grade de 20) e depois `write.baixarRemessa({filCod, gabCod})`, em série.
- **Impacto técnico**: pior caso ~2 x (2-10s p99) = até 20s em um request HTTP no Render. Como o `gabCod` já está registrado no lote, a grade só serve para validar o nome.
- **Impacto de negócio**: espera longa justamente nos lotes com `flpCod` reciclado.
- **Métrica de baseline**: 2 chamadas Conexos, p95 estimado 4-20s (não medido).

### F-performance-3: Export gera o XLSX inteiro em memória, com `exceljs` importado estaticamente

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/sispag/RemessaTitulosExportService.ts` (`serializar`: `writeBuffer`, `addRow` em loop)
- **Evidência (objetiva)**: o teto de 50 lotes limita o pior caso; ordem de grandeza de 50 lotes x ~100 itens = 5k linhas x 18 colunas, poucos MB. `exceljs` ocupa 23MB em node_modules.
- **Impacto técnico**: pico de heap de dezenas de MB por request; `heavyRouteLimiter` é por IP, não global, mas poucos exports simultâneos são toleráveis. O custo real é o import no boot do servidor e dos jobs que usam o container.
- **Métrica de baseline**: heap de pico não medível localmente.

### F-performance-4: Sem métrica de duração/tamanho no export

- **Severidade**: P3
- **Tactic violada**: Manage Sampling Rate (observabilidade do orçamento de latência)
- **Localização**: `RemessaTitulosExportService.exportar` (log com `lotes`, `titulos`)
- **Evidência (objetiva)**: o log não registra `ms` nem `bytes`; teto de 50 e meta de latência não podem ser validados em produção.
- **Impacto técnico**: sem dado para calibrar o teto.
- **Métrica de baseline**: 0 campos de duração/tamanho.

Nenhum P0/P1: sem N+1, sem consulta sem teto introduzida pelo delta, sem dependência nova, sem timer manual.

## 5. Cards Kanban

### [performance-1] Paginar `listLotes` da aba Finalizados

- **Problema**
  > `listLotes` carrega todos os lotes e todos os itens sem LIMIT; o delta aumentou o cabeçalho devolvido.
- **Melhoria Proposta**
  > Adicionar `limit/offset` (padrão do CLAUDE.md) ou janela por `criado_em` na aba Finalizados. Tocar `LotePagamentoRepository.listLotes`, a rota `GET /sispag/lotes` e `page.tsx`.
- **Resultado Esperado**
  > Payload da aba limitado a uma página; tempo de resposta constante com o crescimento da base.
- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - lotes por resposta: ilimitado → ≤ 50
  - p95 de `GET /sispag/lotes`: baseline a medir → < 500ms
- **Risco de não fazer**: a aba degrada gradualmente com o acúmulo de lotes automáticos.
- **Dependências**: ajuste no frontend (`useTabelaFiltro` pagina no cliente hoje).

### [performance-2] Pular a grade fin015 quando o lote já tem `gabCod` registrado

- **Problema**
  > O download sempre consulta a grade (página única de 20) antes de cair no `gabCod`; no caso reciclado são 2 chamadas Conexos seriais.
- **Melhoria Proposta**
  > Baixar direto por `gabCod` registrado e validar o nome devolvido; usar a grade só sem `gabCod`. Tocar `RemessaService.baixarArquivo`. Preservar a regra de nunca usar `gabCod` da grade.
- **Resultado Esperado**
  > Chamadas Conexos por download de 2 → 1 no caso com `gabCod`.
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - chamadas Conexos por download: 2 → 1
  - p95 do download no caso reciclado: até 20s → < 10s
- **Risco de não fazer**: espera longa e risco de timeout no Render nos lotes com `flpCod` reciclado.
- **Dependências**: confirmar que `baixarRemessa` devolve o nome do arquivo para validar identidade.

### [performance-3] Medir duração e bytes do export e carregar `exceljs` sob demanda

- **Problema**
  > O export não registra duração/tamanho, e `exceljs` é importado estaticamente no código compartilhado com ~58 jobs.
- **Melhoria Proposta**
  > Adicionar `ms` e `bytes` ao log de `exportar`; usar `await import('exceljs')` dentro de `serializar` (ou `WorkbookWriter` em stream se o teto subir).
- **Resultado Esperado**
  > Dados reais para calibrar o teto de 50 lotes; menos módulos carregados no boot dos jobs.
- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3, F-performance-4
- **Métricas de sucesso**:
  - campos de duração/tamanho no log: 0 → 2
  - tempo de import no boot de job: baseline a medir → redução mensurável
- **Risco de não fazer**: o teto de 50 fica no escuro; o custo de boot permanece.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta; nenhum comando de rede/Conexos executado.
- Cross-QA: timeout do axios do cliente Conexos (Availability/Fault Tolerance) não revisado aqui; `heavyRouteLimiter` por IP (Security/Availability); `exceljs` no container compartilhado (Deployability).
- Pontos positivos: projeção única de colunas evita nova divergência de SQL (Modifiability); `ANY($ids)` parametrizado.
