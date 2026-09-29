---
qa: Performance
qa_slug: performance
run_id: 2026-09-29-2020
agent: qa-performance
generated_at: 2026-09-29T20:40:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron GH Actions (a cada hora útil, 12 execuções/dia) e analista clicando "Sincronizar agora" | Passada sobre todos os lotes REMESSA_GERADA/RETORNADO e BAIXADO dos últimos 30 dias, com 1 leitura fin064 por item + fin052 por arquivo × evento + PSQ_018 por item pago; Conexos com p99 de 2–10 s | `SincronizacaoLoteService.sincronizarTodos` / `sincronizarLote`, `ConexosSispagClient.lerSituacaoTitulo`, `LotePagamentoRepository.listLotesSincronizaveis` | Produção Render + Supabase; carteira crescendo (mais filiais/lotes) | Concluir a passada dentro do intervalo horário, sem estourar sessões Conexos; rota manual responde antes do timeout do proxy | Passada < 5 min p95 (timeout do workflow 15 min); "Sincronizar agora" p95 < 15 s para lote de até 50 itens |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Concorrência Conexos (fan-out por lote) | 4 (`CONEXOS_FANOUT_LIMIT`) | ≤ 4 | ✅ | `SincronizacaoLoteService.ts:39` |
| Lotes processados em paralelo na passada | 1 (sequencial) | 1–2 | ✅ | `SincronizacaoLoteService.ts:144-146` |
| Chamadas Conexos por item (fin064) | 1 por item por passada, sem short-circuit para lote BAIXADO já sincronizado | reduzir para itens não terminais | ⚠️ | `SincronizacaoLoteService.ts:297-303` |
| Queries de carga de lote no início da passada (N+1) | 1 + N (N = lotes sincronizáveis) | 2 | ⚠️ | `SincronizacaoLoteService.ts:136-141` |
| `selectMany` sem LIMIT no delta | 1 (`listLotesSincronizaveis`, limitado por status + janela de 30 d) | 0 em caminho de API | ⚠️ | `LotePagamentoRepository.ts:929-945` |
| Índices de suporte à query do job | `idx_lote_pagamento_status`, `idx_lote_pagamento_nativo` existem; 0069 não adiciona índice | cobrir `status` + `remessa_gerada_em` | ✅ (volume pequeno) | migrations 0023/0049/0069 |
| Timeout do cliente Conexos | 40 s (`services/conexos.ts:121`); retry via `RetryExecutor` | explícito | ✅ | `services/conexos.ts:121` |
| Timeout / sobreposição do workflow | 15 min, `concurrency` group evita sobreposição | > 3× duração p95 | ✅ | `.github/workflows/sincronizar-lotes-sispag.yml:28,35` |
| Timers manuais (`setTimeout`) no delta | 0 (usa `BoundedConcurrency`) | 0 | ✅ | grep no delta |
| Dependências novas no `package.json` | 0 (só script npm) | 0 | ✅ | `git diff package.json` |
| Duração real da passada / p95 da rota / nº de lotes-itens em produção | ⚠️ **Não medível localmente**: requer logs do job / Render. Recomendação: registrar `duracaoMs`, `lotes`, `itensLidos`, `chamadasConexos` no resumo do job (`JobRun`). | — | — | — |
| Bundle Lambda / cold start / `infra/` | Não medível — Express no Render, sem Lambda nem `infra/` | — | — | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Cron horário em dias úteis 11–22 UTC; janela de estorno de 30 d | ✅ presente | workflow `cron: '35 11-22 * * 1-5'`; `JANELA_ESTORNO_DIAS` |
| Limit Event Response | `heavyRouteLimiter` na rota manual; `concurrency` group no workflow | ✅ presente | `routes/sispag.ts:343` |
| Prioritize Events | Ordena por `remessa_gerada_em ASC`; sem priorização por defasagem da sincronização | ⚠️ parcial | `LotePagamentoRepository.ts:937` |
| Reduce Overhead | fin052 agregado por arquivo × evento (não por item); `aplicarEventosRetorno` reaproveita eventos já lidos | ✅ presente | `SincronizacaoLoteService.ts:170-196,422-440` |
| Bound Execution Times | Timeout 40 s por chamada e 15 min no job; sem deadline de passada nem da rota | ⚠️ parcial | `services/conexos.ts:121`; workflow:35 |
| Increase Resource Efficiency | Itens de lote BAIXADO relidos por 30 dias; sem short-circuit | ⚠️ parcial | `SincronizacaoLoteService.ts:297` |
| Increase Resources | N/A — job one-shot no GH Actions, sem escala horizontal | N/A | workflow |
| Increase Concurrency | `BoundedConcurrency` limite 4 por lote; lotes sequenciais | ✅ presente | `SincronizacaoLoteService.ts:297-320` |
| Maintain Multiple Copies of Computations | N/A — job único por design (`concurrency` group) | N/A | workflow |
| Maintain Multiple Copies of Data | Situação por item persistida (0069) evita reler baixas PSQ_018 via `precisaDeTrilha` | ✅ presente | `SincronizacaoLoteService.ts:305-312` |
| Bound Queue Sizes | N/A — sem fila; universo limitado por status + janela | N/A | — |
| Schedule Resources | Lotes sequenciais respeitam o limite de sessões Conexos | ✅ presente | doc de `BoundedConcurrency` |
| Cold start / bundle | N/A — sem Lambda; sem dependência nova | N/A | package.json |
| Cache strategy | Sem cache de fin064 entre passadas; rota manual repete leitura completa | ⚠️ parcial | — |
| Index discipline | Índices existentes cobrem a query; 0069 só adiciona colunas/constraints | ✅ presente | migrations |
| Frontend leanness | Delta em `LoteCard.tsx` (+115 linhas), sem lib nova | ✅ presente | git diff |

## 4. Findings

### F-performance-1: N+1 no carregamento dos lotes (in-delta)

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoLoteService.ts:136-141`
- **Evidência (objetiva)**:
  ```
  const ids = await this.loteRepo.listLotesSincronizaveis(...);
  for (const id of ids) { const lote = await this.loteRepo.getLoteComItens(id); ... }
  ```
- **Impacto técnico**: 1 + N idas sequenciais ao Postgres (Supabase sa-east-1), crescendo com a janela de 30 d.
- **Impacto de negócio**: pequeno hoje (DB é barato frente ao Conexos); soma segundos à passada horária.
- **Métrica de baseline**: N queries por passada (N = lotes ativos + BAIXADO ≤ 30 d); latência não medida.

### F-performance-2: Leituras fin064 de itens terminais a cada hora (in-delta)

- **Severidade**: P2
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `SincronizacaoLoteService.ts:297-303`; `LotePagamentoRepository.ts:929-945`
- **Evidência (objetiva)**: todo item de lote BAIXADO (janela 30 d) executa `lerSituacaoTitulo` a cada passada; 12 passadas/dia.
- **Impacto técnico**: chamadas Conexos/dia = 12 × itens elegíveis; a janela serve só para detectar estorno, mas cobra o custo integral por hora e compete pelo limite de sessões com os outros crons.
- **Impacto de negócio**: risco de 504/LOGIN_ERROR_MAX_SESSIONS afetando permutas/baixa no horário comercial.
- **Métrica de baseline**: 12 × itens elegíveis por dia (contagem real de itens não medida).

### F-performance-3: Passada sem deadline nem orçamento por execução (in-delta)

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `SincronizacaoLoteService.ts:144-146`; workflow `timeout-minutes: 15`
- **Evidência (objetiva)**: lotes em `for` sequencial; o único limite é o timeout de 15 min do workflow, que mata o processo no meio (resumo/JobRun não gravado; lotes do fim da fila ficam sem sincronizar).
- **Impacto técnico**: estimativa analítica, com p99 de 10 s e concorrência 4, 360 itens × 10 s / 4 = 15 min.
- **Impacto de negócio**: alerta de staleness falso e status de lote defasado justamente quando o Conexos está lento.
- **Métrica de baseline**: capacidade teórica ≈ 360 itens por passada com p99 10 s (analítico, não medido).

### F-performance-4: Rota "Sincronizar agora" síncrona com fan-out Conexos (in-delta)

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/routes/sispag.ts:340-366`
- **Evidência (objetiva)**: a requisição aguarda fin052 (arquivos × eventos) + 1 fin064 por item + PSQ_018, sem deadline próprio; cliente Conexos tem timeout de 40 s por chamada.
- **Impacto técnico**: lote de 50 itens a 2 s/chamada e concorrência 4 ≈ 25 s + fin052; pode exceder o timeout do proxy; o trabalho continua após o cliente desistir.
- **Impacto de negócio**: analista clica de novo, gerando 409 de versão e carga duplicada no Conexos.
- **Métrica de baseline**: ~25 s estimado (analítico) para 50 itens; p95 real não medido.

### F-performance-5: Sem instrumentação de duração/chamadas da passada (in-delta)

- **Severidade**: P3
- **Tactic violada**: Manage Sampling Rate
- **Localização**: `src/backend/jobs/SincronizarLotesSispagJob.ts`, `ResumoSincronizacao`
- **Evidência (objetiva)**: o resumo conta resultados e eventos não lidos, mas não duração nem nº de chamadas Conexos.
- **Impacto técnico**: os alvos deste relatório não são verificáveis sem isso.
- **Impacto de negócio**: decisões de capacidade por palpite.
- **Métrica de baseline**: 0 métricas de duração.

Pré-existente (sem card): `ConciliacaoRetornoService` usa o mesmo padrão de fan-out limite 4. Nenhum P0/P1 encontrado.

## 5. Cards Kanban

### [performance-1] Carregar lotes da sincronização em query única

- **Problema**
  > `sincronizarTodos` chama `getLoteComItens` por id (1+N queries sequenciais).

- **Melhoria Proposta**
  > Adicionar `getLotesComItens(ids)` com `WHERE id = ANY($ids)` + itens em segunda query e usar em `sincronizarTodos`. Tactic: Reduce Overhead.

- **Resultado Esperado**
  > Queries de carga por passada: 1+N → 2.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - queries de carga por passada: 1+N → 2
- **Risco de não fazer**: passada cresce linear com lotes; ganho pequeno, custo trivial.
- **Dependências**: nenhuma

### [performance-2] Reduzir leituras fin064 de itens terminais na janela de estorno

- **Problema**
  > Todo item de lote BAIXADO (30 d) é relido no Conexos 12×/dia só para detectar estorno.

- **Melhoria Proposta**
  > Para lotes BAIXADO, checar estorno em cadência menor (1×/dia), pulando lotes com sincronização recente (`tocarSincronizacao` já registra). Tactic: Increase Resource Efficiency.

- **Resultado Esperado**
  > Chamadas fin064/dia dos lotes BAIXADO: 12×itens → 1×itens (−92%).

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - chamadas Conexos/dia (lotes BAIXADO): 12×N → 1×N
  - novos 504/MAX_SESSIONS nos crons concorrentes: 0
- **Risco de não fazer**: pressão crescente nas sessões Conexos compartilhadas com o robô.
- **Dependências**: decisão de negócio sobre latência aceitável de detecção de estorno

### [performance-3] Impor deadline de passada e gravar resumo parcial

- **Problema**
  > Sem orçamento de tempo, o kill de 15 min do workflow perde o resumo e deixa lotes sem sincronizar.

- **Melhoria Proposta**
  > Deadline interno (ex.: 10 min) checado entre lotes; ordenar por sincronização mais antiga para rodízio justo; gravar JobRun parcial. Tactics: Bound Execution Times / Prioritize Events.

- **Resultado Esperado**
  > Passadas mortas por timeout do workflow: n/d → 0; lote mais defasado ≤ 2 h mesmo com Conexos lento.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - passadas com timeout do workflow: n/d → 0
  - defasagem máxima de lote: n/d → ≤ 2 h
- **Risco de não fazer**: com Conexos degradado, os lotes do fim da fila deixam de sincronizar silenciosamente.
- **Dependências**: performance-4 (métricas)

### [performance-4] Instrumentar duração e chamadas Conexos; deadline na rota manual

- **Problema**
  > Sem duração/contadores não há como validar os alvos; a rota manual não tem deadline próprio.

- **Melhoria Proposta**
  > Incluir `duracaoMs`, `lotes`, `itensLidos`, `chamadasConexos` no `ResumoSincronizacao`/JobRun; na rota, deadline de ~20 s (resposta parcial) e botão desabilitado durante a chamada no `LoteCard`. Tactic: Bound Execution Times.

- **Resultado Esperado**
  > Métricas visíveis no painel de operação; rota p95: ~25 s estimado para 50 itens → < 15 s.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4, F-performance-5
- **Métricas de sucesso**:
  - p95 "Sincronizar agora": n/d → < 15 s
  - passada horária p95: n/d → < 5 min
- **Risco de não fazer**: degradação percebida só por reclamação do analista.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick`: sem build nem medição em produção; durações são estimativas analíticas, marcadas como tal. Nenhum P0/P1.
- Cross-QA: timeout Conexos (40 s) e risco de MAX_SESSIONS tocam Availability/Fault Tolerance; F-performance-3 toca Fault Tolerance (resumo parcial).
- Sem Lambda/infra: cold start, bundle e RDS max_connections não se aplicam.
