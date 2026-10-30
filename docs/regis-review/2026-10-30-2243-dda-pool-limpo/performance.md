---
qa: Performance
qa_slug: performance
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-performance
generated_at: 2026-10-30T22:43:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo a aba "Boletos DDA" após sincronização | `GET /sispag/boletos-dda?escopo=todos` com pool de ~24 mil boletos vigentes + carteira recente (hoje−15..+45) + inativos recentes (hoje−25..+55) | `BoletoDdaService.listar` → `ConsolidacaoBoletoDda.consolidar` (dedupe `codbar`, janela da carteira, `TITULO_SAIU_CARTEIRA`, `comGrupo`) + `ConsolidacaoBoletoDdaCache` + `PaginacaoBoletoDda` | Produção (Render, Node single process; PRD-copy local em docker `financeiro-prd-copy/dda_prd_3010` para medição) | Cache hit → p95 ≤ 300 ms (filtra/ordena/pagina sobre o consolidado). Cache miss → p95 ≤ 1,5 s para 24 k linhas sem perder cópias nem casar além da janela. | Tempo de consolidação (ms), heap pico (MB), ops por boleto livre no `saiuDaCarteira`, p95 de resposta do endpoint. |

## 2. Métricas observadas

Harness: `/tmp/claude-1000/.../scratchpad/run.ts` adaptado dentro de `src/backend/` e rodado com `npx tsx` (deletado ao fim). Dados reais: PRD-copy local, snapshot `bol.json` (1 941 boletos), `tit.json` (1 446 ativos + 2 832 inativos). Pool de 23 292 simulado replicando o fixture 12× com `codbar`/`ddcCod`/`ditCod` perturbados (preserva distribuição).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `consolidar` wall-time @ pool real (1 941 boletos, 2 832 inativos) com `titulosSaidos` | 252 ms (média 5 runs) / 266 ms (medido limpo) | ≤ 400 ms | ✅ | harness `_tmp_run2.ts`/`_tmp_run3.ts` em `src/backend/` (apagado) |
| `consolidar` wall-time sem `titulosSaidos` (mesmo pool) | 212 ms / 205 ms | — | ℹ️ baseline | idem |
| Overhead do `saiuDaCarteira` @ 1 941 boletos | +40 a +60 ms (5,4 M comparações) | ≤ 100 ms | ✅ | diff com/sem `titulosSaidos` |
| `consolidar` wall-time @ pool escalado 23 292 boletos (prod-like) | 2 859 ms | ≤ 1 500 ms | ❌ | harness factor=12 |
| Overhead do `saiuDaCarteira` @ 23 292 boletos | +436 ms (65 M comparações) | ≤ 150 ms | ❌ | harness factor=12 |
| Escala do `consolidar` em função do pool | 266 → 864 → 2 859 ms para 1,9 k / 7,8 k / 23,3 k linhas (quase-linear) | linear ≤ 50 µs/linha | ⚠️ ~120 µs/linha | harness factor=1,4,12 |
| Heap residente após `consolidar` 23 k (tsx) | 127 MB (RSS) | ≤ 200 MB | ⚠️ | `/usr/bin/time -f %M` factor=12 |
| Boletos livres (sem vínculo Conexos) no fixture | 1 941 / 1 941 (100%) | — | ℹ️ | contagem em `bol.json` |
| `codbar` únicos antes do `colapsarCopias` | 1 792 / 1 941 (7,7% são cópias do mesmo DDA) | — | ℹ️ | contagem em `bol.json` |
| Inativos retornados pelo `listInativosRecentes` (janela ±25/+55) | 2 832 (fixture); vencimentos entre 2026-10-05 e 2026-12-12 (69 dias) | monitorar | ⚠️ | query `SELECT COUNT(*) FROM t_tit WHERE ativo=FALSE AND vencimento IS NOT NULL` + filtro de data no fixture |
| `t_tit` total (PRD-copy) | 13 726 linhas; 12 280 inativos; 1 446 ativos | — | ℹ️ | `docker exec … psql -c "SELECT COUNT(*) FROM t_tit WHERE ativo=…"` |
| Índice SQL coerente com `listInativosRecentes` | `idx_titulo_a_pagar_ativo_venc (ativo, vencimento)` existe | existir e ser usado | ⚠️ sargabilidade | `src/backend/migrations/0024_pagamento_ingestao.sql:60` + `TituloAPagarRepository.ts:258–268` |
| Sargabilidade do predicado de data | `(vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` — função sobre coluna, não usa a parte `vencimento` do índice; usa só `ativo` | predicado sargável | ⚠️ P3 | `TituloAPagarRepository.ts:261` |
| Chamadas de I/O paralelizadas em `listar` | 4 queries em `Promise.all` (`listBoletos`, `listAtivos`, `listInativosRecentes`, `listTitulosEmLotesAbertos`) | ≥ paralelizadas | ✅ | `BoletoDdaService.ts:136–143` |
| Chave do `ConsolidacaoBoletoDdaCache` reflete `titulosSaidos` | **Não** — chave é `[escopo, hoje, sincronizadoEm, carteiraEm, lotesVersao, sugestoesVersao]`; não há componente derivado do pool de inativos | chave deve mudar quando `TITULO_SAIU_CARTEIRA` muda | ⚠️ | `BoletoDdaService.ts:101–109` + `ConsolidacaoBoletoDdaCache.ts:22` |
| Cold-start / bundle Lambda | não medível neste repo | — | N/A | infra é Render/Express, não Lambda (CLAUDE.md §Estado Atual) |

> ⚠️ **Não medível localmente**: p95 real do endpoint em PRD (sem acesso a logs do Render). Recomendação: logar `duracaoMs` dentro do `BoletoDdaService.listar` separando `consolidarEscopo` vs. `cache hit` e expor histogram (hoje já há `LogService`; falta a métrica estruturada).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — endpoint pull-based; não há stream a amostrar. | N/A | — |
| Limit Event Response | `colapsarCopias` reduz a lista por `codbar` antes de qualquer custo quadrático — remove 7,7% de linhas no fixture, mais em prod. | ✅ | `ConsolidacaoBoletoDda.ts:156–194` |
| Prioritize Events | Precedência explícita de situação (`CANDIDATO/AMBIGUO > FORA_JANELA > TITULO_SAIU_CARTEIRA > SEM_TITULO`): o caso informativo só é computado quando os prioritários não casaram. | ✅ | `ConsolidacaoBoletoDda.ts:361–371` + `situacaoDoLivre:144–160` |
| Reduce Overhead | `indexarAbertos` ordena por centavos para busca por faixa (evita O(N×M)). `indexarSaidos` **não** faz isso — mantém array e aplica `filter` linear por boleto livre. | ⚠️ parcial | `ConsolidacaoBoletoDda.ts:202–209` vs. `240–258` |
| Bound Execution Times | Query `listInativosRecentes` é bounded em data (`BETWEEN $de::date AND $ate::date`, janela ±25/+55 ≈ 80 dias). `MAX_INFORMATIVOS=5` limita a lista por linha. | ✅ | `TituloAPagarRepository.ts:258–268`; `ConsolidacaoBoletoDda.ts:27, 236` |
| Increase Resource Efficiency | O `comGrupo` percorre cópias por linha (`[b, ...copias]`) com `grupos.get` O(1) — bom. A detecção de "candidatos.length===0 && !foraJanela" curto-circuita o scan de saidos — bom. | ✅ | `BoletoDdaService.ts:178–207` + `ConsolidacaoBoletoDda.ts:150–153` |
| Increase Resources | Node single-process (Render legado); sem vertical scale discutido no diff. | N/A no escopo | — |
| Increase Concurrency | 4 queries em `Promise.all` dentro de `consolidarEscopo`. | ✅ | `BoletoDdaService.ts:136–143` |
| Maintain Multiple Copies of Computations | `ConsolidacaoBoletoDdaCache` (TTL + single-flight + geração) guarda o consolidado inteiro por chave. Hit evita o custo de 2,9 s. | ✅ | `ConsolidacaoBoletoDdaCache.ts` |
| Maintain Multiple Copies of Data | Snapshot `bol` + `titulo_a_pagar` já são réplica local do fin124/fin064; o diff reusa. | ✅ | `IngestaoPagamentosService` + `listInativosRecentes` |
| Bound Queue Sizes | N/A — não há fila SQS neste diff. | N/A | — |
| Schedule Resources | N/A — endpoint síncrono sob API, não job. | N/A | — |

Facetas modernas:
- **Cold start budget** — N/A (Render Express, não Lambda).
- **Cache strategy** — presente (`ConsolidacaoBoletoDdaCache`), mas chave **não** inclui `titulosSaidos` (ver F-performance-3).
- **Index discipline** — `(ativo, vencimento)` existe; predicado da nova query não é sargável na parte da data (ver F-performance-2).
- **Bundle leanness** — N/A no escopo do diff.

## 4. Findings

### F-performance-1: `saiuDaCarteira` é O(free × inativos) com `filter`+`sort` linear por boleto

- **Severidade**: P1
- **Tactic violada**: Reduce Overhead (deveria usar busca por faixa em array ordenado, como `indexarAbertos` já faz)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:211–236` (`saiuDaCarteira`) e `202–209` (`indexarSaidos`)
- **Evidência (objetiva)**:
  ```
  harness factor=1  (1 941 bol, 2 832 inat): 266 ms com saidos / 206 ms sem = +60 ms  (5,4M comps)
  harness factor=4  (7 764 bol, 2 832 inat): 864 ms com saidos / 873 ms sem = ~0  (ruído, mas base linear)
  harness factor=12 (23 292 bol, 2 832 inat): 2 859 ms com saidos / 2 422 ms sem = +436 ms  (65M comps)
  ```
  No código:
  ```ts
  return saidos.filter((s) =>
      Math.abs(s.centavos - valor) <= 5 &&
      Math.abs(this.diasEntre(s.vencimento, vencimento)) <= 10,
  ).map(...).sort(...).slice(0, 5)
  ```
  Nenhum `indexarAbertos`-like por centavos; `TituloAberto` já tem `.centavos` ordenável.
- **Impacto técnico**: a 24 k boletos vs. 2,8 k inativos, cada abertura "fria" paga +~440 ms só pelo `TITULO_SAIU_CARTEIRA`. Se o volume de inativos crescer (ex.: incluir pagos antigos) para ~10 k, o overhead vai a ~1,5 s (linear em `inativos`). Fica abaixo do ganho total da consolidação (2,9 s), mas é a parte mais fácil de reduzir.
- **Impacto de negócio**: a aba "Boletos DDA" é a tela que o analista abre dezenas de vezes por dia; cada invalidação do cache (fim de sincronização) força um recômputo de 2,9 s em prod — percepção de travamento, risco de double-click/reload, pressão em CPU no Render.
- **Métrica de baseline**: 2 859 ms a 23 292 boletos; `saiuDaCarteira` contribui +436 ms (15% do total; 100% do custo em cenários onde a maioria dos livres é SEM_TITULO).

### F-performance-2: Predicado de data em `listInativosRecentes` não é sargável na coluna indexada

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead / Bound Execution Times (índice existe mas o planner não pode usá-lo pelo lado `vencimento`)
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:258–268`
- **Evidência**:
  ```sql
  WHERE ativo = FALSE
    AND vencimento IS NOT NULL
    AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date
  ```
  `(vencimento AT TIME ZONE 'UTC')::date` é função sobre coluna → o planner usa só o lado `ativo` do índice composto `idx_titulo_a_pagar_ativo_venc (ativo, vencimento)` e refiltra todos os inativos. Em PRD-copy local há 12 280 inativos; `EXPLAIN` não medido em prod.
- **Impacto técnico**: hoje é barato (12 k inativos ⇒ ~2–5 ms); se o `ativo = FALSE` acumular histórico (p. ex. após 1 ano de retenção, 50–100 k linhas), o scan vira full-partition da parte `ativo=FALSE` do índice.
- **Impacto de negócio**: baixo hoje; cresce silenciosamente conforme o `titulo_a_pagar` acumular inativos.
- **Métrica de baseline**: 12 280 inativos totais na PRD-copy; retorno útil ≈ 2 832 (janela de ~80 dias) — 23% do universo é filtrado em memória do DB, não pelo índice.

### F-performance-3: Chave do `ConsolidacaoBoletoDdaCache` ignora o pool de `titulosSaidos` (perf e correção coabitam)

- **Severidade**: P2
- **Tactic violada**: Maintain Multiple Copies of Computations (cache precisa invalidar quando a entrada muda) — colocado aqui porque o workaround comum é desligar/encurtar cache, o que **anula** o ganho de performance.
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:101–109`
- **Evidência**:
  ```ts
  const chave = [
      escopo, hoje, sincronizadoEm?.getTime() ?? '-', carteiraEm?.getTime() ?? '-',
      lotesVersao, sugestoesVersao
  ].join('|');
  ```
  Não há componente derivado do pool de inativos (quando um título passa a `ativo = FALSE`, `carteiraEm` captura ou não dependendo da ingestão; a nova feature introduz uma dimensão que a chave atual não representa explicitamente).
- **Impacto técnico**: se `carteiraEm` for atualizado em toda transição de `ativo`, OK; caso contrário, linhas `TITULO_SAIU_CARTEIRA` podem ficar presas no cache ou aparecer tardiamente. Mitigar baixando TTL destrói a economia de 2,9 s.
- **Impacto de negócio**: analista pode ver "SEM_TITULO" numa linha cujo título **acabou** de sair da carteira (vida real: o Conexos deu baixa há segundos).
- **Métrica de baseline**: TTL atual do cache não localizado neste diff; nenhuma métrica direta — flag para o `qa-modifiability`/`qa-testability` casarem com invariantes de freshness.

### F-performance-4: Primeira resposta pós-invalidação sem instrumentação de tempo

- **Severidade**: P2
- **Tactic violada**: nenhuma (gap de observabilidade de performance)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:91–127`
- **Evidência**: não há `console.time`/log estruturado com `duracaoMs` separando `cache hit` vs. `consolidarEscopo` vs. `comGrupo` vs. `aplicar`. Sem isso, não há como validar em produção se o alvo (p95 ≤ 1,5 s cold) é atingido.
- **Impacto técnico**: regressões em pool/inativos passam despercebidas até o analista reclamar.
- **Impacto de negócio**: time Kavex não detecta slow-creep antes do cliente abrir chamado.
- **Métrica de baseline**: 0 métricas estruturadas no path atual.

### F-performance-5: Heap residente de ~127 MB para 23 k boletos durante `consolidar`

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency (margem apertada)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:84–130`
- **Evidência**: `/usr/bin/time -v` do harness factor=12 reporta RSS 125–127 MB. O processo guarda `boletos`, `titulos`, `titulosSaidos`, `abertos`, `saidos`, `porChave`, `loteDe`, `debitoDe`, `vinculados`, `copiasDe` todos em memória; o cache guarda consolidados inteiros (ver `ConsolidacaoBoletoDdaCache.ts:8` "~24 mil linhas em 'todos'").
- **Impacto técnico**: em Render com worker de 512 MB, 2–3 chaves em cache + concorrência razoável pode encostar no limite; GC pause aumenta p99.
- **Impacto de negócio**: baixo hoje.
- **Métrica de baseline**: 127 MB RSS para 1 ciclo isolado; multiplicar por `#chaves no cache × #escopos`.

## 5. Cards Kanban

### [performance-1] Trocar o scan linear do `saiuDaCarteira` por busca por faixa de centavos

- **Problema**
  > `saiuDaCarteira` percorre todos os `titulosSaidos` para cada boleto livre (`filter` linear em `TituloAberto[]`). No pool de prod simulado (23 292 boletos, 2 832 inativos) isso custa +436 ms (65 M comparações) por consolidação fria. O `indexarAbertos` já resolve o mesmo problema com array ordenado por centavos — o `indexarSaidos` só espelha o padrão pela metade.
- **Melhoria Proposta**
  > No `indexarSaidos`, ordenar `saidos` por `centavos`. No `saiuDaCarteira`, usar busca binária por `[valor−5, valor+5]` (`lowerBound`/`upperBound`) e iterar só a fatia; validar o `Math.abs(diasEntre) <= 10` na fatia (expectativa: ≤ dezenas de linhas por boleto). Tactic Bass: **Reduce Overhead**. Arquivo: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts`.
- **Resultado Esperado**
  > `consolidar` wall-time para 23 k boletos: 2 859 ms → ≤ 2 500 ms (overhead do `TITULO_SAIU_CARTEIRA` cai de +436 ms para ≤ 50 ms). Mantém semântica: mesma lista `titulosSaidos` por boleto.
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Overhead do `saiuDaCarteira` @ 23 k: 436 ms → ≤ 50 ms (harness `factor=12` reutilizável)
  - `consolidar` wall-time @ 23 k: 2 859 ms → ≤ 2 500 ms
  - Testes `ConsolidacaoBoletoDda.test.ts` continuam verdes sem alteração de expectativas
- **Risco de não fazer**: regressão latente — se o número de inativos retornados crescer (ex.: janela ampliada, ou retenção maior de pagos), o custo cresce linearmente. Em 6 meses, com 10 k inativos no recorte, o overhead vai a ~1,5 s/consolidação fria.
- **Dependências**: nenhuma

### [performance-2] Tornar o filtro de `vencimento` em `listInativosRecentes` sargável

- **Problema**
  > `WHERE … AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` aplica função sobre a coluna, invalidando o lado `vencimento` do índice composto `idx_titulo_a_pagar_ativo_venc`. Em PRD-copy há 12 280 inativos; o retorno útil é 2 832 — 77% é refiltrado em memória do DB.
- **Melhoria Proposta**
  > Reescrever o predicado para comparar `vencimento` diretamente contra timestamps absolutos (`vencimento >= $de::date AT TIME ZONE 'UTC' AND vencimento < ($ate::date + 1) AT TIME ZONE 'UTC'`) ou mover o cast para o parâmetro, não para a coluna. Validar com `EXPLAIN (ANALYZE, BUFFERS)` que o plano usa `Index Scan using idx_titulo_a_pagar_ativo_venc`. Tactic: **Reduce Overhead**. Arquivo: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:258–268`.
- **Resultado Esperado**
  > A query usa a parte `vencimento` do índice. Tempo de SQL < 10 ms mesmo com 100 k linhas inativas no `titulo_a_pagar`.
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - `EXPLAIN (ANALYZE)` em PRD-copy: nó `Index Scan using idx_titulo_a_pagar_ativo_venc` presente
  - Linhas descartadas em memória (`Rows Removed by Filter`): hoje ~77%; alvo ≤ 10%
- **Risco de não fazer**: crescimento silencioso do custo da query conforme o `titulo_a_pagar` acumula inativos (hoje 12 k; 1 ano a 1 000/mês → 36 k; 3 anos → 100 k). Em 3 anos, a query pode dobrar o tempo de resposta frio do endpoint.
- **Dependências**: nenhuma

### [performance-3] Instrumentar `duracaoMs` nas fases de `BoletoDdaService.listar`

- **Problema**
  > Sem log estruturado de tempo por fase (`cache hit`, `consolidarEscopo`, `comGrupo`, `aplicar filtros/paginar`), não dá para verificar em produção se a feature cumpre o alvo p95 ≤ 1,5 s nem detectar regressão depois.
- **Melhoria Proposta**
  > Adicionar `logService.message` com `duracaoMs` por fase (ou um `Timer` compartilhado em `domain/libs/`), chaveado por `escopo`. Tactic: observabilidade de performance (habilitador de todas as outras). Arquivo: `src/backend/domain/service/sispag/BoletoDdaService.ts:91–127`.
- **Resultado Esperado**
  > Em cada chamada ao endpoint, o log traz `{ fase: 'consolidarEscopo', duracaoMs, pool, ativos, inativos }`. Dashboard do Render passa a ter p50/p95 por fase sem código novo.
- **Tactic alvo**: Reduce Overhead (via feedback loop)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - 100% das chamadas ao `listar` com log estruturado de `duracaoMs` por fase
  - 0 fases >1 s sem log de pool/ativos/inativos acompanhando
- **Risco de não fazer**: regressões descobertas por reclamação do analista, não por métrica.
- **Dependências**: nenhuma

### [performance-4] Garantir que a chave do `ConsolidacaoBoletoDdaCache` reflita `titulosSaidos`

- **Problema**
  > A nova entrada `titulosSaidos` entra no `consolidar` mas não aparece na chave do cache. Se `carteiraEm` não é atualizado em toda transição de `ativo=TRUE→FALSE`, cópias cacheadas podem ter `TITULO_SAIU_CARTEIRA` desatualizado. Baixar TTL para mitigar quebra a economia de 2,9 s.
- **Melhoria Proposta**
  > Garantir que `carteiraEm` (ou um novo `pagamentosAtivoEm`) seja bumpado em QUALQUER alteração do campo `ativo`. Opcional: incluir componente derivado do count/hash dos inativos recentes na chave. Tactic: Maintain Multiple Copies of Computations (invariante de freshness). Arquivos: `BoletoDdaService.ts:101–109`, repository/ingestão de `titulo_a_pagar`.
- **Resultado Esperado**
  > Dado um título que passa a `ativo=FALSE`, a próxima chamada ao `listar` com a mesma chave retorna consolidado novo (não cacheado) em ≤ 1 ciclo. Nenhum impacto no hit-rate em regime estável.
- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — cruza com Modifiability/Testability)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Teste adicional em `ConsolidacaoBoletoDdaCache.test.ts` cobrindo `carteiraEm` bumpado em transição `ativo`
  - 0 ocorrências em prod de linha `SEM_TITULO` com `titulosSaidos` populável (observável via log estruturado do card [performance-3])
- **Risco de não fazer**: analista toma decisão com dado estale; cross-impact com Fault-Tolerance (percepção de inconsistência).
- **Dependências**: [performance-3] (observabilidade) — recomendado como pré-requisito

## 6. Notas do agente

- Escopo estrito do diff: medi `ConsolidacaoBoletoDda.consolidar` ponta a ponta com fixture PRD-copy (`bol.json` 1 941 / `tit.json` 4 278). Para projetar a prod (~24 k pool mencionado), repliquei o fixture 12× perturbando `codbar`/`ddcCod`/`ditCod` — o resultado é piso otimista (distribuição real pode ter mais colisões/menos cópias). Harness criado em `src/backend/_tmp_run*.ts`, executado com `npx tsx` e removido ao final (sem writes ao DB).
- Métricas não medíveis localmente: p95 real do endpoint em PRD, hit-rate do `ConsolidacaoBoletoDdaCache`, plano real de `EXPLAIN` em produção (índice só confirmado via migração `0024_pagamento_ingestao.sql`).
- Cross-QA detectado para o consolidator:
  - F-performance-3 ↔ **Modifiability**/**Testability** (invariante de freshness do cache).
  - F-performance-2 ↔ **Modifiability** (schema-as-code: sargabilidade é propriedade do código SQL, não só do índice).
  - F-performance-4 ↔ **Availability**/**Fault-Tolerance** (sem observabilidade, não detectamos degradação).
