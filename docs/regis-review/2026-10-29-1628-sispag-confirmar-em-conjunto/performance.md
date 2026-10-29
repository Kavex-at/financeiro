---
qa: Performance
qa_slug: performance
run_id: 2026-10-29-1628
agent: qa-performance
generated_at: 2026-10-29T16:28:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista no drawer SISPAG do título | POST `/sugestoes-boleto/confirmar-em-conjunto` com até 30 títulos irmãos do mesmo credor/filial | `ConfirmacaoEmConjuntoService.confirmarEmConjunto` → N × `BoletoSuggestionService.confirmar` (releitura ao vivo + grava decisão + agenda ajuste de centavos) | Operação normal, HML/PRD, carteira ~2.062 títulos × ~27k boletos DDA, cenário quente em cache | Responder com resultado por linha (CONFIRMADA/JA_CONFIRMADA/RECUSADA) sem bloquear a UI; ajuste de centavos sai da hot path e vai para fila sequencial | POST 30 linhas p95 ≤ 2 s (1.3 s medido com um cenário por batch); GET irmaos p95 ≤ 100 ms (30 ms quente); batch nunca excede o teto de 30 (I15t(3)) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| POST confirmar-em-conjunto 30 linhas (quente, cenário 1×/batch) | 1.3 s | ≤ 2 s | ✅ | _shared-metrics.md (medição no clone PRD + Conexos stub) |
| POST confirmar-em-conjunto 30 linhas (cenário por linha — descartado antes do PR) | 36.5 s | ≤ 2 s | ✅ (corrigido no diff) | _shared-metrics.md |
| GET `/titulo/irmaos` (quente, 86 elegíveis) | ~30 ms | ≤ 100 ms | ✅ | _shared-metrics.md |
| Cenário completo (motor de sugestão) | ~1.4 s em 2.062 títulos / 27k boletos | ≤ 2 s | ✅ | _shared-metrics.md |
| Teto de linhas por pedido (`CONFIRMACAO_CONJUNTO_MAXIMO`) | 30 | ≤ 50 | ✅ | `src/backend/domain/interface/sispag/ConfirmacaoEmConjunto.ts:14` |
| `listTitulosEmLotesAbertos()` por linha dentro do loop | 1 round-trip por linha (até 30/batch) | 1 round-trip por batch com reconferência barata por chave | ⚠️ | `ConfirmacaoEmConjuntoService.ts:143-152` |
| Fila de ajuste de centavos (`agendarEmSequencia`) — bound de tamanho/concorrência | sem limite explícito; promessa fire-and-forget sem registro de pending | queue bounded + métrica de depth | ⚠️ | `AjusteCentavosTituloService.ts:316-343` |
| GET irmaos cold (sem cache do cenário) | não medido localmente | p95 ≤ 2.5 s | ⚠️ | — |
| Novas dependências adicionadas no diff | 0 | 0 | ✅ | `git diff origin/main -- src/backend/package.json` (sem alterações) |
| Novo SQL `selectMany` sem LIMIT introduzido no diff | 0 (reusa repos existentes) | 0 | ✅ | `git diff origin/main -- src/backend/domain/repository/` (não tocado) |

> ⚠️ **Não medível localmente**: p99 em produção multi-usuário, latência cold-start do bundle Express/Render após deploy e profundidade real da fila de `agendarEmSequencia` sob picos simultâneos. Requer APM / CloudWatch no ambiente alvo. Recomendação: adicionar métrica `sispag_confirmacao_conjunto_duracao_ms{p50,p95,p99,linhas_bucket}` e `sispag_ajuste_centavos_fila_depth` no `LogService.business`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — sem telemetria amostrada neste caminho; o custo é por request humano. | N/A | — |
| Limit Event Response | Teto rígido de 30 linhas por POST → 422 `BatchConfirmationTooLargeError`. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:95-100`, `interface/sispag/ConfirmacaoEmConjunto.ts:14` |
| Prioritize Events | Ajuste de centavos sai da hot path para fila sequencial de 2º plano. | ✅ presente | `AjusteCentavosTituloService.ts:316-343` |
| Reduce Overhead | Cenário recalculado **uma vez por batch** (`cenarioParaConjunto()`), não por linha — ganho real medido de 36.5 s → 1.3 s. GET usa `desfechosEmCache()`. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:109-110`, `71` |
| Bound Execution Times | Cada linha em try/catch com fallback para `RECUSADA`; falha de linha não derruba batch. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:155-192` |
| Increase Resource Efficiency | `Promise.all` do GET lê lotes + pool em paralelo; dedupe de itens com `Map` antes do loop. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:74-77`, `93` |
| Increase Resources | N/A — Express mono-processo em Render; aumento de recursos é decisão de deploy. | N/A | — |
| Increase Concurrency | **Loop sequencial deliberado** no POST (anti-TOCTOU + lock de grupo). Concorrência intra-batch rejeitada no ADR-0080. | ⚠️ parcial (por desenho) | `ConfirmacaoEmConjuntoService.ts:112-120` |
| Maintain Multiple Copies of Computations | Cenário é reaproveitado dentro do batch (cópia única passada ao `confirmar`). | ✅ presente | `ConfirmacaoEmConjuntoService.ts:109`, `confirmarLinha` arg `cenario` |
| Maintain Multiple Copies of Data | N/A — cache do cenário mora no `BoletoSuggestionService`; não há nova cópia neste diff. | N/A | — |
| Bound Queue Sizes | Fila `agendarEmSequencia` não tem limite explícito nem backpressure; se N batches ocorrem em paralelo, cria N filas sequenciais em promessas fire-and-forget. | ⚠️ parcial | `AjusteCentavosTituloService.ts:316-343` |
| Schedule Resources | FIFO sequencial no `fin070` (nunca N renegociações simultâneas). | ✅ presente | `AjusteCentavosTituloService.ts:313-343` |

## 4. Findings (achados)

### F-performance-1: `listTitulosEmLotesAbertos()` chamado dentro do loop (N round-trips por batch)

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead (parcial)
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:143-152`
- **Evidência (objetiva)**:
  ```ts
  for (const item of itens) {
      // Lido ao vivo por linha: um lote pode ter sido finalizado no meio do conjunto.
      const emLotes = await this.loteRepo.listTitulosEmLotesAbertos();
      const finalizado = emLotes.some(
          (l) => LOTES_FINALIZADOS.has(l.status) && chaveDoTitulo(l) === chaveDoTitulo(item),
      );
  ```
- **Impacto técnico**: até 30 round-trips idênticos no Postgres por POST (um por linha). O comentário documenta a intenção anti-TOCTOU, mas a mesma garantia pode ser mantida com um snapshot por batch + reread único só quando uma linha confirma. Com `cenarioParaConjunto` o custo caiu de 36.5 s → 1.3 s; esta é a próxima camada.
- **Impacto de negócio**: picos de confirmação simultâneos (fechamento de SISPAG) multiplicam o custo DB — 10 analistas × 30 linhas = 300 reads do mesmo recordset. Não compromete SLO atual (1.3 s), mas erode a margem.
- **Métrica de baseline**: 30 chamadas de `listTitulosEmLotesAbertos()` por POST de 30 linhas (medido pela leitura do código; latência agregada ~1.3 s dominada por `confirmar`).

### F-performance-2: Fila de `agendarEmSequencia` sem bound de tamanho nem telemetria

- **Severidade**: P2
- **Tactic violada**: Bound Queue Sizes
- **Localização**: `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:316-343`; chamada em `ConfirmacaoEmConjuntoService.ts:122`
- **Evidência (objetiva)**:
  ```ts
  public agendarEmSequencia = (pedidos: Array<Omit<PedidoAjuste, 'gatilho'>>): void => {
      if (pedidos.length === 0) return;
      void this.executarEmSequencia(pedidos);
  };
  ```
- **Impacto técnico**: fire-and-forget — cada batch confirmado dispara uma `Promise` sem retentor global. Se dois batches de 30 linhas chegam no mesmo minuto, duas filas sequenciais rodam em paralelo (o invariante "nunca N renegociações simultâneas no `fin070`" só vale **dentro** de uma fila, não entre batches). Falhas são logadas mas não contadas.
- **Impacto de negócio**: potencial de dois ajustes do mesmo `pesCod` em flight (improvável, pois são títulos distintos, mas não garantido pela estrutura); sem métrica de depth, incidente de lentidão no `fin070` só vira visível pelo retorno do banco.
- **Métrica de baseline**: 0 counters/gauges para a fila (busca por `fila_depth|queue` em `AjusteCentavosTituloService.ts` = 0 ocorrências).

### F-performance-3: GET `/titulo/irmaos` cold-path depende de `desfechosEmCache()` sem fallback mensurado

- **Severidade**: P3
- **Tactic violada**: Maintain Multiple Copies of Computations (observabilidade)
- **Localização**: `ConfirmacaoEmConjuntoService.ts:71`
- **Evidência (objetiva)**:
  ```ts
  const desfechos = await this.sugestoes.desfechosEmCache();
  ```
- **Impacto técnico**: GET quente = 30 ms; GET frio (cache evicted / primeira abertura após deploy ou TTL) depende do custo de recomputar o cenário (medido ~1.4 s em 2.062 títulos). Não há métrica distinguindo os dois casos — a UI do drawer parecerá "travar" aleatoriamente.
- **Impacto de negócio**: percepção de inconsistência de UX; analista reabre o drawer achando que travou e dispara dois POST (gastos duplicados de releitura).
- **Métrica de baseline**: hit rate do cache do cenário não é exposto (não há `cache_hit_rate` em `BoletoSuggestionService`).

### F-performance-4: `listBoletos({ vencimentoDesde })` no GET pode varrer o pool DDA inteiro

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `ConfirmacaoEmConjuntoService.ts:77-83`
- **Evidência (objetiva)**:
  ```ts
  const desde = doCredor.flatMap((d) => d.candidatos.map((c) => c.vencimentoBoleto)).sort()[0];
  const [emLotes, pool] = await Promise.all([
      this.loteRepo.listTitulosEmLotesAbertos(),
      desde ? this.boletoRepo.listBoletos({ vencimentoDesde: desde }) : Promise.resolve([]),
  ]);
  ```
- **Impacto técnico**: `vencimentoDesde` é "boleto mais cedo entre os irmãos do credor"; quando a origem tem muitos candidatos antigos, o pool buscado se aproxima dos 27k boletos. Hoje p95 quente = 30 ms (índice OK em `vencimentoDesde`), mas sem filtro por `pesCod` o custo cresce com o pool, não com os irmãos — não escala quando a carteira dobrar.
- **Impacto de negócio**: p95 do GET pode subir de 30 ms para 100–300 ms quando a Columbia dobrar o volume de DDA. Ainda dentro do alvo, mas sem headroom.
- **Métrica de baseline**: 1 chamada de `listBoletos` por GET, filtro só por data; a estimativa `pool.length` ≈ `boletos_com_vencimento>=desde` (não medido em números absolutos localmente — não medível sem SELECT em PRD).

## 5. Cards Kanban

### [performance-1] Snapshot único de `listTitulosEmLotesAbertos` por batch com reconferência barata

- **Problema**
  > `ConfirmacaoEmConjuntoService.confirmarLinha` relê `listTitulosEmLotesAbertos()` dentro do loop (até 30× por POST) para rejeitar títulos cujo lote tenha sido finalizado no meio do conjunto. O cenário já foi corretamente reaproveitado (36.5 s → 1.3 s); este é o próximo overhead no mesmo loop.
- **Melhoria Proposta**
  > Reduce Overhead: carregar o snapshot `emLotesInicial` **uma vez** antes do loop (como o cenário) e, imediatamente antes de chamar `sugestoes.confirmar`, releitura só do título específico (consulta pontual por `filCod+docCod+titCod` já existente no repo) — mantém o anti-TOCTOU trocando um `SELECT` de recordset por um `SELECT` por chave primária. Tocar `ConfirmacaoEmConjuntoService.ts` + possivelmente adicionar `loteRepo.statusDoTitulo(chave)`.
- **Resultado Esperado**
  > Round-trips DB por POST de 30 linhas: 30 → 1 (snapshot) + N reconferências por chave; latência p95 do POST 30 linhas: 1.3 s → 0.8 s; carga DB em pico de SISPAG (10 analistas simultâneos) reduzida proporcionalmente.
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - POST 30 linhas p95: 1.3 s → ≤ 0.8 s
  - Reads de `lote_pagamento_item` por POST: 30 → 1 + 30 (por chave)
- **Risco de não fazer**: carga DB cresce linear com concorrência de analistas no fechamento mensal; margem de SLO consumida silenciosamente.
- **Dependências**: nenhuma.

### [performance-2] Bound e telemetria para a fila `agendarEmSequencia` do ajuste de centavos

- **Problema**
  > O ajuste de centavos pós-conjunto é um `void this.executarEmSequencia(...)` sem retentor global, sem gauge e sem limite agregado. O invariante "nunca N renegociações simultâneas no `fin070`" é respeitado **dentro** de uma fila, mas se dois batches confirmam no mesmo instante há duas filas em paralelo. Sem contador, só o retorno do banco revelaria lentidão.
- **Melhoria Proposta**
  > Bound Queue Sizes + Prioritize Events: centralizar os pedidos num singleton (`AjusteCentavosQueue`) com `maxConcurrency=1`, `maxDepth` configurável e logs em cada enqueue/complete/drop. Expor gauge `sispag_ajuste_centavos_fila_depth` e counter `..._falhas_total` via `LogService.business`. Tocar `AjusteCentavosTituloService.ts` e inserir métrica no `ObservabilityAdvisor` para o painel de operação.
- **Resultado Esperado**
  > No máximo 1 ajuste em flight por processo; depth e falhas visíveis no painel; drops explícitos quando `maxDepth` for excedido (hoje: silencioso).
- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Ajustes concorrentes no `fin070` por processo: potencialmente N → 1
  - Observabilidade da fila: 0 counters → 2 (depth, falhas_total)
- **Risco de não fazer**: incidente de lentidão no Conexos durante pico fica invisível até o retorno do banco; cross-batch concorrência pode disparar lock no `fin070`.
- **Dependências**: convergir com cards de qa-availability (observability) e qa-fault-tolerance (bounded queues).

### [performance-3] Métrica de cache-hit do cenário no GET `/titulo/irmaos`

- **Problema**
  > GET quente = 30 ms, mas cold path (cache do cenário vazio) é dominado por recomputar ~1.4 s do motor de sugestão. Sem métrica distinguindo os dois, a UX do drawer "trava" aleatoriamente após deploys ou TTL.
- **Melhoria Proposta**
  > Reduce Overhead + Maintain Multiple Copies of Computations: expor `cache_hit=true|false` no retorno do `desfechosEmCache()` (ou no log de business) e um counter `sispag_cenario_cache_hit_total{result}`. Tocar `BoletoSuggestionService` e o route handler para registrar no `LogService.business`.
- **Resultado Esperado**
  > Hit-rate observável; alvo p95 GET cold ≤ 2.5 s (do contrário, pré-aquecer no bootstrap).
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Visibilidade de cache-hit: 0 → counter + gauge
  - GET cold p95: desconhecido → ≤ 2.5 s mensurado
- **Risco de não fazer**: percepção de UX inconsistente; mascara regressão de performance futura do motor.
- **Dependências**: nenhuma.

### [performance-4] Filtrar `listBoletos` do GET irmaos por credor, não só por data

- **Problema**
  > O pool DDA buscado no GET para o aviso "idênticos" é filtrado só por `vencimentoDesde`; cresce com o volume total do pool, não com os irmãos do credor. Hoje 30 ms, mas sem headroom para quando a Columbia dobrar o DDA.
- **Melhoria Proposta**
  > Increase Resource Efficiency: adicionar filtro `pesCod` em `BoletoDdaRepository.listBoletos` (parâmetro opcional, novo índice se preciso) e usar no `listarIrmaos`. Mantém a semântica do aviso de idênticos (que já é por emissor), mas corta o pool para boletos do credor da origem.
- **Resultado Esperado**
  > Tamanho do pool lido no GET: ≈ O(27k) → O(centenas) por credor; p95 do GET resiliente ao dobro do volume (30 ms → se mantém ≤ 100 ms).
- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Linhas lidas no `listBoletos` do GET: full-pool-desde → só do credor
  - GET irmaos p95 projetado a 2× volume: ≤ 100 ms
- **Risco de não fazer**: regressão silenciosa quando o DDA crescer; eventual pressão em `vencimentoDesde` index-only scan.
- **Dependências**: validar com qa-modifiability se o filtro `pesCod` justifica novo índice (schema-as-code).

## 6. Notas do agente

- Escopo restrito ao diff do `sispag-confirmar-em-conjunto`; nada medido fora de `ConfirmacaoEmConjuntoService`, `RegraIrmaosConjunto`, `AjusteCentavosTituloService.agendarEmSequencia` e o par de rotas novas.
- O ganho crítico (36.5 s → 1.3 s via cenário 1×/batch) já está no diff — este review não re-abre finding P0/P1 porque o baseline atual já atende o SLO de UX.
- Cross-QA: F-performance-2 (bounded queue + telemetria da fila de ajuste) sobrepõe com qa-availability (observability) e qa-fault-tolerance (bulkhead/queue). F-performance-4 (índice por `pesCod`) sobrepõe com qa-modifiability (schema como código). F-performance-1 (anti-TOCTOU via per-key read) sobrepõe com qa-fault-tolerance (consistência mid-batch).
- Métrica de p99 em produção e profundidade real da fila não medíveis localmente — recomendação de instrumentação registrada em §2.
