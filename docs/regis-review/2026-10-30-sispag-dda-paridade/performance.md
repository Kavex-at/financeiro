---
qa: Performance
qa_slug: performance
run_id: 2026-10-30-sispag-dda-paridade
agent: qa-performance
generated_at: 2026-10-30T00:00:00Z
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Performance — Regis-Review (reduzido, delta sispag-dda-paridade)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia na aba "Boletos DDA" | Troca de escopo/filtro/ordem/página sobre o pool DDA (~24 mil boletos) | `GET /sispag/boletos-dda` → `BoletoDdaService.listar` → `ConsolidacaoBoletoDda` + `PaginacaoBoletoDda` | Processo Express único (Render), ingestão de pagamentos a cada 15 min | A primeira chamada "fria" consolida o pool; as subsequentes servem da cache em memória por 30 s ou até a próxima sincronização | Cold: observado 6,0 s / meta p95 ≤ 7 s. Warm: 60–100 ms / meta p95 ≤ 150 ms. 0 recomputação não necessária após uma mutação de lote (observado: até 30 s de staleness) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Latência cold (`escopo=todos`, cache vazia) | 6,0 s (relato do caller) | ≤ 7 s | ✅ | caller + `BoletoDdaService.consolidarEscopo` src/backend/domain/service/sispag/BoletoDdaService.ts:116-130 |
| Latência warm (cache hit, paginação/ordem/busca) | 60–100 ms (relato do caller) | ≤ 150 ms | ✅ | caller |
| TTL da cache consolidada | 30 s | — | ✅ | src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:5 |
| MAX_ENTRADAS da cache consolidada | 4 | — (ver F-performance-2) | ⚠️ | src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:7 |
| Fatores da chave de cache | escopo · hoje · `sincronizadoEm` · `carteiraEm` · `sugestoesCache.versao()` | + versão dos lotes abertos | ❌ (ver F-performance-1) | src/backend/domain/service/sispag/BoletoDdaService.ts:91-97 |
| Fan-out da UI por refresh (facetas, totais, "vencem hoje") | 1 request (facetas, totais e amostraHoje viajam no mesmo payload) | 1 request | ✅ | src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:244-254 e src/frontend/app/sispag/components/BoletosDdaTab.tsx:93-105 |
| Fan-out da gaveta por título | 2 requests concorrentes (`busca=doc/tit` + `busca=valor`) | 1 request idealmente | ⚠️ | src/frontend/lib/sispag.ts:1982-1987 |
| Queries SQL por `listar` (hit ou miss) | 2 `SELECT max(...)` (ultimaSincronizacao + findLatestSuccessFinishedAt) + 3 queries em miss | 0 em hit | ⚠️ | src/backend/domain/service/sispag/BoletoDdaService.ts:86-100 |
| Prazo da sincronização manual | 60.000 ms | ≤ 60 s para a HTTP não estourar o `heavyRouteLimiter` | ✅ | src/backend/domain/service/sispag/BoletoDdaService.ts:46 + routes/sispag.ts:1611-1626 |
| Memória residente da cache (4 entradas × ~24k consolidados) | não medido | ≤ 50 MB por processo | ⚠️ Não medível localmente — exige heap snapshot do processo Express rodando contra o pool PRD | — |

> ⚠️ **Não medível localmente**: footprint de memória por entrada. Estimativa de ~15–25 MB por entrada (24k objetos × codbar/linhaDigitavel/candidatos/numero) → 60–100 MB com `MAX_ENTRADAS=4`. Recomendação: `process.memoryUsage().heapUsed` antes/depois de `obter` em um smoke e expor como gauge.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — aba interativa, sem amostragem | N/A | — |
| Limit Event Response | AbortController cancela requisição superada no cliente; backend ainda executa até o fim (Express não vê o abort) | ⚠️ parcial | src/frontend/app/sispag/components/BoletosDdaTab.tsx:93-105 |
| Prioritize Events | N/A | N/A | — |
| Reduce Overhead | `valorBr` manual em vez de `Intl.NumberFormat` sobre 24k linhas; single-flight; cache de 30 s | ✅ | src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:116-124; ConsolidacaoBoletoDdaCache.ts:52-66 |
| Bound Execution Times | `prazoMs = 60_000` na sincronização; arquivos adiam para a próxima passada | ✅ | src/backend/domain/service/sispag/BoletoDdaService.ts:197,216-226 |
| Increase Resource Efficiency | Consolidação única por combinação de chave (single-flight) | ✅ | ConsolidacaoBoletoDdaCache.ts:52-66 |
| Increase Resources | N/A — processo Express único (Render) | N/A | — |
| Increase Concurrency | `BoundedConcurrency` (FANOUT_LIMIT=3) na sincronização Conexos | ✅ | src/backend/domain/service/sispag/BoletoDdaService.ts:36,216-226 |
| Maintain Multiple Copies of Computations | Cache consolidada por chave, até 4 cópias | ✅ (mas chave incompleta — ver F-performance-1) | ConsolidacaoBoletoDdaCache.ts:7,74-84 |
| Maintain Multiple Copies of Data | `boleto_dda` em Postgres é o espelho local do `fin124` | ✅ | migration 0062 + BoletoDdaRepository.ts:127-140 |
| Bound Queue Sizes | `heavyRouteLimiter` protege as rotas pesadas; advisory lock dedicado (`BOLETO_DDA_SYNC_LOCK_KEY`) | ✅ | src/backend/routes/sispag.ts:1611-1626; BoletoDdaService.ts:34,172-190 |
| Schedule Resources | Ingestão a cada 15 min invalida ambas as caches ao fim da sync-DDA | ✅ | IngestaoPagamentosService.ts:351 + BoletoDdaService.ts:178-183 |

## 4. Findings

### F-performance-1: cache consolidada não invalida após mutações de lote

- **Severidade**: P1 (alto — degrada o QA de forma mensurável)
- **Tactic violada**: Maintain Multiple Copies of Computations (chave de consistência incompleta)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:91-100,121-125`
- **Evidência**:
  ```
  const chave = [input.escopo, hoje, sincronizadoEm ?? '-', carteiraEm?.getTime() ?? '-', this.sugestoesCache.versao()].join('|');
  const consolidados = await this.consolidadoCache.obter(chave, () => this.consolidarEscopo(input.escopo, hoje));
  // consolidarEscopo lê titulosEmLote = loteRepo.listTitulosEmLotesAbertos()
  ```
  As rotas `POST /sispag/lotes`, `/lotes/:id/itens` (incluir/remover), `/lotes/:id/{finalizar|reabrir|cancelar}` e `/titulos/.../retirar-do-lote` mudam `titulosEmLote` mas **não** chamam `consolidadoCache.invalidar()` nem bumpam `sugestoesCache.versao()` (verificado por grep: só `BoletoDdaService.sincronizar` chama `consolidadoCache.invalidar`).
- **Impacto técnico**: boleto cuja situação depende de `titulosEmLote` (e.g., marcação de "título já em lote", filtros derivados dessa condição) continua servido pela cache por até 30 s após a mutação. Métricas da aba (`contagem`, `totais.emGrupo`, etc.) ficam dessincronizadas da aba de lotes.
- **Impacto de negócio**: analista vê a aba Boletos DDA "contradizendo" a aba de lotes por meia dezena de segundos — ruído e reabertura de ticket. Não compromete escrita (toda mutação revalida ao vivo), mas quebra o contrato de "a aba acompanha o lote".
- **Métrica de baseline**: janela de staleness observável = TTL = **30 s** entre mutação e refresh da aba.

### F-performance-2: footprint de memória da cache não é limitado por bytes

- **Severidade**: P2
- **Tactic violada**: Maintain Multiple Copies of Computations (sem bound em bytes)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:7,74-84`
- **Evidência**:
  ```
  const MAX_ENTRADAS = 4;
  // Cada entrada carrega ~24 mil BoletoDdaConsolidado (codbar + linhaDigitavel + candidatos + numero + arquivo…)
  ```
  Com dois escopos (`a-vencer`, `todos`) × bump de `versao` a cada decisão/sync, 4 entradas podem coexistir facilmente. Estimativa 15–25 MB por entrada → 60–100 MB residente só nesta cache.
- **Impacto técnico**: num Render dyno de ~512 MB, 100 MB fixos para esta cache é significativo, com risco de OOM se cruzar com outras caches/singletons.
- **Impacto de negócio**: reinício do processo durante janela de pico (operação da manhã).
- **Métrica de baseline**: não medível localmente (ver seção 2); teórico ≈ 24k × ~800 B × 4 ≈ 75 MB.

### F-performance-3: facetas, contagens e totais recalculados a cada request

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:220-255,305-357,365-382`
- **Evidência**:
  ```
  paginar(linhas, filtro) {
      const facetas = this.facetas(linhas);          // O(N) sobre 24k
      const semSituacao = linhas.filter(...);        // O(N)
      const { contagem, totais, amostraHoje } = this.totalizar(semSituacao, ...); // O(N)
      ...
  }
  ```
  Facetas (listas de filiais/bancos com contagem) são INVARIANTES do escopo cacheado — não dependem do filtro — mas são recomputadas em todo hit (troca de página, de ordem, de busca).
- **Impacto técnico**: cada request paga 2–3 passagens O(24k). É o que mantém o warm em ~60–100 ms em vez de ≤ 20 ms.
- **Métrica de baseline**: p50 warm 60 ms → alvo p50 warm 25 ms com facetas memoizadas por entrada.

### F-performance-4: duas queries `SELECT max(...)` por listar, mesmo em cache hit

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:86-90`
- **Evidência**:
  ```
  const [sincronizadoEm, carteiraEm] = await Promise.all([
      this.repo.ultimaSincronizacao(),            // SELECT max(sincronizado_em) FROM boleto_dda_arquivo
      this.runRepo.findLatestSuccessFinishedAt(), // SELECT max(finished_at) ...
  ]);
  ```
  Ambas rodam ANTES de olhar a cache. Toda abertura de aba e toda troca de página paga 2 RTTs ao Postgres.
- **Impacto técnico**: ~10–20 ms adicionais por request (RTT × 2) desperdiçados; ruído no pool de conexões.
- **Métrica de baseline**: 2 queries/request → 0 queries/request em hit.

### F-performance-5: gaveta por título dispara 2 GETs concorrentes à listagem completa

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (fan-out desnecessário)
- **Localização**: `src/frontend/lib/sispag.ts:1973-1989`
- **Evidência**:
  ```
  const [porTitulo, porValor] = await Promise.all([
      fetchBoletosDda({ ..., busca: `${titulo.docCod}/${titulo.titCod}` }),
      titulo.valor !== undefined ? fetchBoletosDda({ ..., busca: titulo.valor.toFixed(2) }) : ...,
  ])
  ```
  Cada chamada passa pela listagem consolidada completa; a união é feita no cliente.
- **Impacto técnico**: 2× payload de página (até 50 linhas cada) e 2× passada O(N) de busca no backend. Em hit custa pouco; se a cache acabou de ser invalidada, custa 2× cold (~12 s somados, embora em paralelo).
- **Métrica de baseline**: 2 requests por abertura de gaveta → 1 request (endpoint dedicado por título).

### F-performance-6: consolidação em voo descartada por `invalidar` continua queimando CPU

- **Severidade**: P3
- **Tactic violada**: Limit Event Response (não aborta trabalho invalidado)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:55-66`
- **Evidência**: `invalidar()` incrementa `geracao`, limpa `entradas` e `emVoo`, mas a promessa em voo continua até terminar (o `.then` apenas decide não guardar).
- **Impacto técnico**: se a ingestão/sincronização invalida no meio de um cold de 6 s, esses 6 s continuam ocupando o event loop sem servir ninguém; o próximo chamador começa outro cold em paralelo.
- **Métrica de baseline**: até 6 s de CPU em cold órfão por invalidação com request concorrente.

## 5. Cards Kanban

### [performance-1] incluir versão dos lotes abertos na chave da cache consolidada DDA

- **Problema**
  > `BoletoDdaService.listar` compõe a chave da cache com escopo/hoje/`sincronizadoEm`/`carteiraEm`/`sugestoesCache.versao()`, mas o resultado consolidado depende de `loteRepo.listTitulosEmLotesAbertos()` — e nenhuma rota de lote (incluir, remover, retirar, finalizar, cancelar, criarLote) toca a cache. Resultado: a aba Boletos DDA mostra estado pré-mutação por até 30 s após qualquer ação no lote.

- **Melhoria Proposta**
  > Adicionar um `LotesAbertosVersao` (singleton, contador monotônico) bumpado pelo `LotePagamentoService` nas transições que mudam o conjunto de títulos em lote aberto, e incluí-lo na chave; alternativa mais barata: chamar `consolidadoCache.invalidar()` nos mesmos pontos onde `sugestoesCache.invalidar()` já é chamado hoje nas mutações de lote (se aplicável). Tactic Bass: *Maintain Multiple Copies of Computations* (chave completa de consistência).

- **Resultado Esperado**
  > Staleness da aba Boletos DDA após mutação de lote: 30 s → ≤ 500 ms (tempo da próxima consolidação).

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Janela de staleness pós-mutação: 30 s → ≤ 500 ms
  - Chave da cache cobre todos os insumos de `consolidarEscopo`: 4/5 → 5/5
- **Risco de não fazer**: analista reporta "a aba DDA e a aba de lotes se contradizem" — ticket recorrente de inconsistência percebida.
- **Dependências**: nenhuma

### [performance-2] limitar a cache consolidada por bytes, não por entradas

- **Problema**
  > `MAX_ENTRADAS = 4` sem bound de bytes; cada entrada carrega ~24k consolidados (~15–25 MB). Com dois escopos e bumps de versão por decisão, o residente da cache pode encostar em 100 MB num dyno de 512 MB.

- **Melhoria Proposta**
  > Trocar o cap por `MAX_BYTES` (estimar via `JSON.stringify(valor).length` ou contador acumulado), evictar quando acumular > teto (p.ex. 40 MB). Alternativa: reduzir `MAX_ENTRADAS` para 2 (um por escopo) e aceitar que bumps de versão evictam. Tactic Bass: *Maintain Multiple Copies of Computations* com bound explícito.

- **Resultado Esperado**
  > Pior caso residente da cache: ~75–100 MB → ≤ 40 MB.

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Residente da cache (medido em smoke): ≤ 40 MB
  - OOMs do processo nos últimos 30 dias atribuíveis a esta cache: 0
- **Risco de não fazer**: OOM silencioso em pico quando outras caches (sugestões, carteira) também crescem.
- **Dependências**: nenhuma

### [performance-3] memoizar facetas e contagens por entrada da cache consolidada

- **Problema**
  > `paginar()` recomputa `facetas()` + `totalizar()` em O(N) sobre 24k linhas a cada hit, mesmo que facetas sejam invariantes do escopo cacheado.

- **Melhoria Proposta**
  > Guardar `{ linhas, facetas, contagemBase, totaisBase }` como valor da cache (não só `linhas`); `paginar()` recebe esses pré-computados e só aplica o filtro variável. Tactic Bass: *Reduce Overhead*.

- **Resultado Esperado**
  > p50 warm 60 ms → p50 warm ≤ 25 ms; p95 warm 100 ms → ≤ 50 ms.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - p50 warm `/sispag/boletos-dda`: 60 ms → 25 ms
  - Passagens O(24k) por request em hit: 3 → 1
- **Risco de não fazer**: aba continua sentida como "pesada" na troca de página mesmo com cache quente.
- **Dependências**: performance-2 (bytes contados devem incluir os novos campos)

### [performance-4] evitar as duas `SELECT max(...)` em cache hit

- **Problema**
  > `listar()` dispara `ultimaSincronizacao()` e `findLatestSuccessFinishedAt()` em paralelo antes de olhar a cache. Em hit, são 2 RTTs ao Postgres desperdiçados.

- **Melhoria Proposta**
  > Expor um `CarteiraVersao` e um `DdaSyncVersao` (singletons monotônicos) bumpados pelos próprios serviços de ingestão/sincronização ao fim; `listar()` lê os contadores em memória e cai no SQL só quando precisa recomputar. Tactic Bass: *Reduce Overhead*.

- **Resultado Esperado**
  > Queries SQL por hit: 2 → 0. Latência de hit cai mais ~10–20 ms.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Queries SQL por `/sispag/boletos-dda` em hit: 2 → 0
  - p50 warm: queda adicional ≥ 10 ms
- **Risco de não fazer**: pool de conexões recebe ruído previsível em cada troca de página; nada quebra.
- **Dependências**: nenhuma

### [performance-5] endpoint dedicado "boletos do título" em vez de 2 GETs à listagem

- **Problema**
  > `fetchBoletosDdaDoTitulo` dispara duas `GET /sispag/boletos-dda` concorrentes com `busca=doc/tit` e `busca=valor`, cada uma passando pela listagem consolidada completa.

- **Melhoria Proposta**
  > Criar `GET /sispag/boletos-dda/titulo?filCod&docCod&titCod` que consulta a cache uma única vez e aplica, no servidor, o filtro combinado (`vinculo/candidato por doc+tit OU mesmo valor`). Deprecar o fan-out no cliente. Tactic Bass: *Reduce Overhead*.

- **Resultado Esperado**
  > Requests por abertura de gaveta: 2 → 1. Em cache fria pior-caso: ~12 s somados → ~6 s.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Requests por abertura de gaveta do título: 2 → 1
  - Payload total da gaveta (p50): queda ≥ 40%
- **Risco de não fazer**: cache fria + muitas gavetas abertas em sequência amplifica picos.
- **Dependências**: nenhuma

### [performance-6] abortar a consolidação em voo quando `invalidar()` é chamado

- **Problema**
  > `ConsolidacaoBoletoDdaCache.invalidar()` só limpa o `Map` de `emVoo`; a promessa que estava em voo continua executando ~6 s de CPU sem beneficiar nenhum chamador.

- **Melhoria Proposta**
  > Propagar um `AbortSignal` por entrada em voo; `invalidar()` chama `controller.abort()`; `consolidarEscopo` passa o sinal para o repositório (ou pelo menos checa `signal.aborted` entre passagens O(N) de `consolidar`). Tactic Bass: *Limit Event Response*.

- **Resultado Esperado**
  > CPU gasto em consolidações órfãs durante uma invalidação concorrente: ~6 s → ≤ 500 ms.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-6
- **Métricas de sucesso**:
  - Tempo máximo de CPU em promessa órfã após `invalidar`: ≤ 500 ms
- **Risco de não fazer**: picos duplos de CPU no fim da ingestão quando um usuário já está folheando a aba.
- **Dependências**: performance-3 (as passagens O(N) são o lugar natural de checar o sinal)

## 6. Notas do agente

- Escopo: só `git -C <worktree> diff HEAD` + untracked. Nenhum arquivo do checkout principal foi lido. Métricas de latência cold/warm vieram do caller (6,0 s / 60–100 ms); não rodei carga local.
- Não achei P0 concreto no delta: a cache tem single-flight correto, invalidação com `geracao` monotônica, cap de entradas, TTL, e o fan-out da UI vive em 1 request (facetas, totais, amostraHoje viajam juntos). O defeito mais sério é a chave de cache incompleta (F-performance-1), que degrada consistência percebida, não corrompe estado — toda mutação revalida ao vivo. Classifiquei P1.
- Memória da cache (F-performance-2) é teórica — ambiente local não reproduz os 24k boletos; recomendo smoke com `process.memoryUsage()` ao instrumentar.
- Cross-QA: F-performance-1 e F-performance-6 têm sobreposição com qa-modifiability (contrato de chave de cache deve ficar documentado) e qa-fault-tolerance (invalidar deve propagar cancelamento). F-performance-2 cruza com qa-availability (risco de OOM). Alertar o consolidator.
