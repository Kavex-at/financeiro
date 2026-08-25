---
qa: Performance
qa_slug: performance
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-performance
generated_at: 2026-08-25T17:42:00-03:00
scope: backend
score: 5
findings_count: 7
cards_count: 6
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador de tesouraria clica "Gerar remessa" num lote FINALIZADO com 25 títulos (tamanho típico visto em HML). | `POST /sispag/lotes/:id/remessa` dispara a sequência sequencial de escrita/leitura contra o Conexos (fin015 + cmn025 + fin005). | `RemessaService.gerarRemessa` → `ConexosSispagWriteClient` (`listarLotesNativos`, `criarLote`, `listarTitulosPendentes`, `importarTitulos` × N, `finalizarLote`, `sugerirRemessa`, `gerarRemessa`, `listarArquivosRemessa`) + `ConexosSispagClient.listContasFavorecido` × N. | Normal (HML), Conexos respondendo dentro do budget de 40 s por chamada; proxy do Render com timeout típico de 100 s. | HTTP 200 com o `.REM` no corpo, sem duplicar lote nativo, sem estourar o proxy. | p95 do POST end-to-end ≤ 30 s para lote ≤ 25 itens; nº de round-trips ao ERP ≤ 40 no caminho normal; 0 timeouts de proxy em lote de 25 itens. |

Segundo cenário (painel):
> Analista abre `/sispag/painel` numa base com 1511 títulos ativos, 116 lotes nativos e ~7 filiais. Resposta em JSON com títulos + KPIs + execuções paradas em ≤ 3 s p95. Payload ≤ 500 KB.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Round-trips ao Conexos em `gerarRemessa` (lote 25 itens, caminho normal) | 1 (`listarLotesNativos`) + 1 (`criarLote`) + 1 (`listContasCorrentes`) + 1–5 (`listarTitulosPendentes` paginado, pageSize=500) + **25** (`listContasFavorecido` — 1 por item) + **25** (`importarTitulos` — 1 POST por item) + 1 (`finalizarLote`) + 1 (`sugerirRemessa`) + 1 (`gerarRemessa`) + 1 (`listarArquivosRemessa`) = **58–62 chamadas sequenciais** | ≤ 40 chamadas, paralelismo bounded onde não-atômico | ❌ | Contagem estática em `RemessaService.ts:102-503` + `ConexosSispagWriteClient.ts:426-457`. |
| Round-trips adicionais na RETOMADA (`sincronizarComErp`) | +1 `getLoteNativo` + até +1 `listarLotesNativos` (adoção por marca d'água) + até +1 `listarChavesDoLote` + até +1 `listarArquivosRemessa` = **até 4 leituras extras** | ≤ 4, mantida | ⚠️ aceitável mas contabilizar | `RemessaService.ts:519-661`. |
| `importarTitulos` — POSTs por lote | **N POSTs** (1 por item, sequencial via auto-recursão `if (itens.length > 1) for … await importarTitulos([item])`) | Paralelismo bounded ≤ 4 (não é atômico, retomada já cobre parcial) | ❌ | `ConexosSispagWriteClient.ts:436-457`. Comentário in-code: "NÃO é atômico: uma falha no meio deixa parte importada". |
| Latência estimada de `importarTitulos` no lote de 25 | 25 × ~1 s (write POST HML) ≈ **25 s só nesta etapa** (não medida ao vivo com cronômetro; ordem de grandeza inferida do timeout HTTP 40 s configurado em `services/conexos.ts:121`) | ≤ 10 s | ❌ | Não medível localmente sem instrumentação — recomendação: `logService.info` com `Date.now()` delta por passo em produção. |
| `listContasFavorecido` dentro de `montarItensImport` | N chamadas SEQUENCIAIS (uma por item do lote, sem dedupe por `pesCod`); mesmo favorecido em 2 parcelas = 2 chamadas idênticas ao ERP | 1 chamada por `pesCod` distinto, paralelizada `bounded=4` (padrão já provado em `SispagPainelService.modalidadesDisponiveisDoLote`) | ❌ | `RemessaService.ts:779-802`; contraste com `SispagPainelService.ts:246-282`. |
| Cap de títulos no `/sispag/painel` | 5000 (subiu de 400) | 5000 mantido, com `titulosTotal` na resposta para a UI avisar corte | ✅ | `SispagPainelService.ts:37` — `TITULOS_CAP = 5000`. |
| Payload do `/sispag/painel` medido | 386 KB para 1511 títulos (≈ 256 B por título; carteira inteira ≈ 410 KB) | ≤ 500 KB antes de considerar paginação server-side | ✅ (limite folgado) | `_shared-metrics.md` (bloco de comentário in-code em `SispagPainelService.ts:29-36`). |
| Consultas locais adicionais em `montarPainel` | +2 `SELECT` em `remessa_execucao` e `conciliacao_execucao` filtrando por `status='reconciling' AND atualizado_em < now() - interval` (Promise.all) | ≤ 2 queries, indexadas | ⚠️ | `SispagPainelService.ts:139-168` + `RemessaExecucaoRepository.ts:105-127`. Índice existe em `(status)` (migration 0049:100 e 0050:38) — não composto `(status, atualizado_em)`, aceitável enquanto tabela tem poucas centenas de linhas. |
| `fin015/list` sem `filCod#EQ` (antes do delta) → com filtro (depois) | Antes: 74 linhas trafegadas para 3 filiais numa consulta; painel com N filiais fazia N leituras cada uma vendo todas as filiais. Depois: server-side reduz para O(lotes_da_filial) | Filtro server-side mantido | ✅ | `ConexosSispagClient.ts:349-372` diff da2714e..HEAD. |
| `heavyRouteLimiter` em `POST /sispag/lotes/:id/remessa` | Presente (10 req/min/IP) | Presente | ✅ | `routes/sispag.ts:406-411` + `http/rateLimit.ts:28-36`. |
| `heavyRouteLimiter` em `GET /sispag/painel` e `GET /sispag/lotes/:id/modalidades-disponiveis` | Ausente (`globalLimiter` 100 req/min) — o `modalidadesDisponiveis` faz até 2 fan-outs por item, é a rota mais cara depois de `remessa` | Aplicar `heavyRouteLimiter` na rota de modalidades | ⚠️ | `routes/sispag.ts:33-65` — só `/painel`, `/retornos` e `/modalidades-disponiveis` sem limiter. |
| Índice composto em `remessa_execucao (status, atualizado_em)` | Ausente — só `(status)` isolado | Composto quando a tabela crescer (> 10k linhas) ou se `listReconcilingParadas` virar hot path | ⚠️ (P3 hoje) | Migration `0049_sispag_remessa_retorno.sql:99-100`. |
| `axios.create({ timeout: 40000 })` no `ConexosService` (compartilhado por todo cliente do Conexos) | 40 s | 40 s (adequado ao ERP), mas quando 3 chamadas do fluxo estouram, cliente perde a request inteira → parcial | ⚠️ | `services/conexos.ts:116-122`. |
| `keepAlive` no axios do Conexos (reuso de socket entre POSTs sequenciais do `importarTitulos`) | Não configurado (`http.Agent` default do Node: sem keep-alive persistente cross-request) | `httpsAgent: new https.Agent({ keepAlive: true })` — no cenário de 25 POSTs sequenciais, cada handshake TLS custa ~100–300 ms | ❌ | `services/conexos.ts:116-122` — sem `httpsAgent`. |

> ⚠️ **Não medível localmente**: latência real p95 do `POST /sispag/lotes/:id/remessa` em HML/PRD para lotes de 25 itens. O gate ao vivo do delta só rodou com lote de 2 títulos (`_shared-metrics.md:80`), o que não estressa o N do `importarTitulos`/`listContasFavorecido`. Requer: (a) instrumentação com `Date.now()` delta por etapa em `RemessaService.gerarRemessa`, (b) uma corrida em HML com lote de 20+ itens.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A no caminho da remessa — o gatilho é humano, não fluxo. | N/A | — |
| Limit Event Response | `heavyRouteLimiter` (10 req/min/IP) em `remessa`, `finalizar`, `reabrir`, `cancelar`. Ausente em `painel`, `retornos` e `modalidades-disponiveis`. | ⚠️ parcial | `routes/sispag.ts:323,342,408,465`. |
| Prioritize Events | N/A — API síncrona sem fila entre rotas. | N/A | — |
| Reduce Overhead | `fin015/list` ganhou `filCod#EQ` server-side (menos linhas trafegadas). Sem keep-alive, sem HTTP/2 no cliente axios; TLS handshake pago a cada POST. | ⚠️ parcial | `ConexosSispagClient.ts:349-372`; `services/conexos.ts:116-122`. |
| Bound Execution Times | Timeout de 40 s por chamada no axios. `PollExecutor`/`RetryExecutor` presentes na base. Sequência inteira de 25 items sem budget agregado — pode consumir 60 s+ e estourar proxy sem sinal. | ⚠️ parcial | `services/conexos.ts:121`. |
| Increase Resource Efficiency | `SispagPainelService.modalidadesDisponiveisDoLote` já dedupe por `(filCod, pesCod)`. `RemessaService.montarItensImport` NÃO dedupe — mesma tactic esquecida no caminho quente. | ⚠️ parcial | `SispagPainelService.ts:246-282` (bom) × `RemessaService.ts:779-802` (esquecido). |
| Increase Resources | Deploy Render single-instance (não medido no delta). | N/A neste delta | — |
| Increase Concurrency | `BoundedConcurrency` existe e é usado no painel (`limit=4`). `RemessaService` NÃO usa — o `for (const item of alvo)` para `listContasFavorecido` e o auto-recursivo `importarTitulos` são estritamente seriais. | ⚠️ parcial | `BoundedConcurrency.ts`; `SispagPainelService.ts:107` × `RemessaService.ts:779`, `ConexosSispagWriteClient.ts:445-448`. |
| Maintain Multiple Copies of Computations | Ledger `remessa_execucao` já materializa marca d'água e etapa — retomada não repete o que ERP já fez. | ✅ presente | `RemessaService.ts:143-247`. |
| Maintain Multiple Copies of Data | Ingestão em `titulo_a_pagar` (persistida) elimina round-trip ao ERP no `montarPainel` (só faz fan-out de LOTES). | ✅ presente | `SispagPainelService.ts:85-90`. |
| Bound Queue Sizes | N/A — sem fila entre rotas SISPAG. | N/A | — |
| Schedule Resources | N/A — sem scheduler no caminho da remessa. | N/A | — |
| Cache | SSM/env cacheado via `EnvironmentProvider` (padrão da casa). Sem cache de `listContasCorrentes` / `listContasFavorecido` — recomputados a cada geração para a mesma filial. | ⚠️ parcial | `EnvironmentProvider` (padrão); ausência: `RemessaService.ts:250, 800`. |

## 4. Findings (achados)

### F-performance-1: `importarTitulos` faz N POSTs sequenciais ao ERP — lote de 25 itens custa ≈ 25 s só nessa etapa

- **Severidade**: P1 (alto — pode estourar timeout de proxy e o operador nem sabe o que caiu)
- **Tactic violada**: Increase Concurrency; Bound Execution Times.
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:436-457`.
- **Evidência (objetiva)**:
  ```typescript
  if (itens.length > 1) {
      for (const item of itens) {
          await this.importarTitulos({ filCod, bncCod, flpCod, itens: [item], op });
      }
      return;
  }
  ```
  Comentário in-code confirma: "NÃO é atômico: uma falha no meio deixa parte importada. É exatamente o cenário de import parcial que a retomada trata".
- **Impacto técnico**: com 25 itens × ~1 s por POST HML (ordem de grandeza — sem keep-alive cada POST paga TLS handshake), o `importarTitulos` sozinho consome ~25 s. Somado às outras chamadas do `gerarRemessa` (marca d'água, criarLote, listarTitulosPendentes paginado, listContasFavorecido × N, finalizarLote, sugerirRemessa, gerarRemessa, listarArquivosRemessa) o POST end-to-end passa perto de 60 s — dentro do budget de proxy do Render (default 100 s) mas sem folga para picos.
- **Impacto de negócio**: sob pico (fechamento de mês, lotes ≥ 40 itens), a rota fica sujeita a timeout de proxy no meio do import. A parcial fica no ERP; a retomada resolve, mas o operador vê "erro genérico", perde confiança e liga para o técnico. Repetido em produção = tempo de tesouraria queimado + hora do dev.
- **Métrica de baseline**: 25 POSTs sequenciais → ~25 s (estimado, não medido ao vivo — o gate rodou com 2 títulos).

### F-performance-2: N+1 em `listContasFavorecido` dentro de `montarItensImport` — sem dedupe por `pesCod`

- **Severidade**: P1 (alto — duplica trabalho no ERP e amplifica latência)
- **Tactic violada**: Increase Resource Efficiency; Increase Concurrency.
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:779-802`.
- **Evidência (objetiva)**:
  ```typescript
  for (const item of alvo) {
      const pendente = porChave.get(chaveDe(item));
      // ...
      const pesCod = pendente.raw.pesCod;
      const contas = pesCod != null
          ? await this.sispag.listContasFavorecido(String(pesCod), lote.filCod)
          : [];
  ```
  Comparar com `SispagPainelService.modalidadesDisponiveisDoLote:246-282` que faz exatamente a mesma consulta com dedupe por `(filCod, pesCod)` + fan-out bounded — a boa prática já existe no repositório e foi ignorada aqui.
- **Impacto técnico**: um lote com 25 títulos de 10 favorecidos distintos (2ª/3ª parcelas do mesmo fornecedor são o caso normal em tesouraria) faz 25 chamadas ao `cmn025/ctcorr/list` quando 10 bastariam. Estritamente sequencial (dentro do `for..await`) — sem paralelismo bounded.
- **Impacto de negócio**: 15 round-trips ERP desnecessários por lote, ~15 × 300–800 ms = 4,5–12 s de latência adicional no botão "Gerar remessa" que não deveria existir. Multiplica sob picos de sessão Conexos (`LOGIN_ERROR_MAX_SESSIONS`).
- **Métrica de baseline**: 25 chamadas para 25 itens; alvo com dedupe: 1 chamada por `pesCod` distinto (média empírica ~10 num lote típico).

### F-performance-3: sem keep-alive no `axios.create` do Conexos — cada POST sequencial paga TLS handshake

- **Severidade**: P1 (alto — amplifica linearmente os POSTs seriais de F-performance-1)
- **Tactic violada**: Reduce Overhead.
- **Localização**: `src/backend/services/conexos.ts:116-122`.
- **Evidência (objetiva)**:
  ```typescript
  this.client = axios.create({
      baseURL: opts.baseUrl || process.env.CONEXOS_BASE_URL || '...',
      timeout: 40000,
  });
  ```
  Sem `httpsAgent: new https.Agent({ keepAlive: true, maxSockets: N })`. O agent default do Node não persiste conexão entre requests.
- **Impacto técnico**: 25 POSTs sequenciais em `importarTitulos` = 25 handshakes TLS. Estimativa conservadora 100–300 ms por handshake = 2,5–7,5 s extras por lote de 25.
- **Impacto de negócio**: latência agregada da geração da remessa cresce ~10–30 % sem contrapartida. Custo de correção: 1 linha de config.
- **Métrica de baseline**: 25 handshakes/lote (1 por POST). Alvo: 1 handshake reusado (idealmente 1–2 sockets pool).

### F-performance-4: geração da remessa NÃO tem budget agregado — soma silenciosa das etapas pode estourar proxy

- **Severidade**: P2 (médio — cenário provável mas não medido)
- **Tactic violada**: Bound Execution Times.
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:102-503`.
- **Evidência (objetiva)**: nenhum wrap de `Promise.race` com `AbortController` no fluxo. Cada chamada do `axios` tem seu próprio 40 s; a soma de 5–10 chamadas + N POSTs de import pode ultrapassar 100 s (default do proxy Render).
- **Impacto técnico**: quando a soma estoura o proxy, o cliente vê 504/timeout de infra, o ledger fica em `reconciling` e a retomada precisa entrar. Retomada funciona, mas o operador dispara "gerar remessa" de novo em pânico — segundo clique já é `sincronizarComErp` (não duplica), mas o UX ruim aumenta risco de erro humano.
- **Impacto de negócio**: incidentes silenciosos onde a remessa "não gerou" mas o ERP tem lote parcial — carga cognitiva para o time.
- **Métrica de baseline**: soma estimada de latências no cenário de 25 itens ≈ 45–65 s; proxy Render default ≈ 100 s (margem estreita).

### F-performance-5: rotas `/painel`, `/retornos` e `/modalidades-disponiveis` sem `heavyRouteLimiter`

- **Severidade**: P2 (médio — o painel disparou 5000 títulos por resposta agora; refresh acidental em loop derruba pool Conexos)
- **Tactic violada**: Limit Event Response.
- **Localização**: `src/backend/routes/sispag.ts:33-65`.
- **Evidência (objetiva)**:
  ```typescript
  router.get('/painel', asyncHandler(async (_req, res) => { ... }));           // sem heavyRouteLimiter
  router.get('/retornos', asyncHandler(async (_req, res) => { ... }));         // sem heavyRouteLimiter
  router.get('/lotes/:id/modalidades-disponiveis', asyncHandler(...));         // sem heavyRouteLimiter (rota mais cara: 2 fan-outs)
  ```
- **Impacto técnico**: `montarPainel` faz fan-out por filial (`listLotes` × N filiais) + 2 queries locais + serializa até 5000 títulos (~410 KB). Um F5 num loop de refresh acidental (extensão de browser, health-check indevido) consome sessões do Conexos e degrada o SISPAG inteiro.
- **Impacto de negócio**: fair-use hoje, mas o cap de 5000 títulos (vs. 400 anterior) elevou o custo por request 12,5×. Sem limiter, um cliente mal-comportado tem alavancagem.
- **Métrica de baseline**: payload atual 386 KB × globalLimiter 100 req/min = pico de 38 MB/min por IP tolerado pela rota.

### F-performance-6: `montarItensImport` não paraleliza o `for..await` — mesmo depois de dedupe seria trivial

- **Severidade**: P2 (médio — depende do dedupe de F-performance-2, mas o ganho é composto)
- **Tactic violada**: Increase Concurrency.
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:779`.
- **Evidência (objetiva)**: laço `for (const item of alvo)` estritamente serial; `BoundedConcurrency` já injetado em `SispagPainelService`, ausente aqui.
- **Impacto técnico**: mesmo após dedupe (10 chamadas em vez de 25), continuar serial deixa 3–5 s na mesa (`bounded=4` cortaria isso para ~1 s no cenário de 10 favorecidos distintos).
- **Impacto de negócio**: composto com F-2 e F-3, os três juntos reduzem a etapa `montarItensImport + importarTitulos` de ~35 s para ~10 s.
- **Métrica de baseline**: 10 sequenciais × ~500 ms = ~5 s; bounded=4 → ~1,5 s.

### F-performance-7: cap de 5000 títulos + payload monolítico — teto de escala futuro sem paginação server-side

- **Severidade**: P3 (baixo — folgado hoje, ancorado ao crescimento da carteira)
- **Tactic violada**: Reduce Overhead; Increase Resource Efficiency.
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:37`.
- **Evidência (objetiva)**: `TITULOS_CAP = 5000`; carteira atual = 1511 títulos = 386 KB. Extrapolando linearmente para o cap: ~1,3 MB (JSON não-comprimido). A UI recebe tudo de uma vez.
- **Impacto técnico**: quando a carteira crescer de 1511 → 4000+, o payload passa 1 MB e o TTFB do painel piora sensivelmente em conexões móveis/proxy corporativo.
- **Impacto de negócio**: não é problema hoje. Vai virar em ~6–12 meses ao ritmo de crescimento típico.
- **Métrica de baseline**: hoje 386 KB / 1511 títulos; no cap teórico ~1,3 MB / 5000. Alvo futuro: paginação server-side ≤ 200 KB por página.

## 5. Cards Kanban

### [performance-1] Paralelizar `importarTitulos` com `BoundedConcurrency` (limit=4)

- **Problema**
  > O import é auto-recursivo e estritamente serial — 25 títulos = 25 POSTs em fila. Estimativa 25 s só nessa etapa; a rota inteira se aproxima do timeout de proxy do Render.

- **Melhoria Proposta**
  > Em `ConexosSispagWriteClient.importarTitulos`, quando `itens.length > 1`, disparar via `BoundedConcurrency.run` com `limit=4` (mesmo valor de `CONEXOS_FANOUT_LIMIT` do painel — evita `LOGIN_ERROR_MAX_SESSIONS`). Já é seguro: o próprio comentário in-code afirma "não é atômico; a retomada trata parcial". Erros settled devem ser convertidos em `Error` agregado, com a retomada de `sincronizarComErp` reimportando exatamente os itens que faltaram.

- **Resultado Esperado**
  > Latência de `importarTitulos` para lote de 25: de ~25 s → ~6–7 s. Latência end-to-end de `POST /sispag/lotes/:id/remessa` (25 itens): de ~50–60 s → ~20–25 s.

- **Tactic alvo**: Increase Concurrency.
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-6.
- **Métricas de sucesso**:
  - Nº de importarTitulos concorrentes: 1 → 4 (bounded)
  - Latência `importarTitulos` p95 (25 itens): ~25 s → ~7 s
  - Latência POST remessa p95 (25 itens): ~55 s → ~22 s
- **Risco de não fazer**: em picos de fechamento de mês (lotes 40+ itens), estouros de proxy silenciosos → parcial no ERP → retomada precisa fechar → confusão operacional e ticket ao time.
- **Dependências**: nenhuma técnica; validar em HML com lote 25+ antes de subir.

### [performance-2] Dedupe `listContasFavorecido` por `pesCod` distinto em `montarItensImport`

- **Problema**
  > Loop `for..await` chama `cmn025/ctcorr/list` uma vez por ITEM, sem dedupe. Lote típico de 25 itens com 10 favorecidos distintos = 15 chamadas desperdiçadas. A mesma tactic está aplicada corretamente em `SispagPainelService.modalidadesDisponiveisDoLote` — é regressão de padrão dentro do mesmo módulo.

- **Melhoria Proposta**
  > Em `RemessaService.montarItensImport`: pré-computar `Set` de `(filCod, pesCod)` distintos, resolver via `BoundedConcurrency.run(distintos, sispag.listContasFavorecido, 4)`, montar `Map<chaveFavorecido, ContaFavorecido[]>`, depois o `for..of` só faz lookup.

- **Resultado Esperado**
  > Chamadas ao `cmn025/ctcorr/list` por geração de remessa (lote 25 itens, 10 favorecidos): 25 → 10. Latência dessa etapa: ~12 s → ~1,5 s (com `bounded=4`).

- **Tactic alvo**: Increase Resource Efficiency + Increase Concurrency.
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2, F-performance-6.
- **Métricas de sucesso**:
  - Chamadas `cmn025/ctcorr/list` por remessa: 1/item → 1/pesCod distinto
  - Latência `montarItensImport` para lote 25: ~12 s → ~2 s
- **Risco de não fazer**: pressão desnecessária no pool de sessões do Conexos + latência escondida no botão "gerar remessa".
- **Dependências**: nenhuma.

### [performance-3] Ativar keep-alive no axios do `ConexosService`

- **Problema**
  > `axios.create({ baseURL, timeout: 40000 })` sem `httpsAgent` — cada POST sequencial paga TLS handshake. Amplifica os 25 POSTs de `importarTitulos` em ~2,5–7,5 s adicionais.

- **Melhoria Proposta**
  > Em `services/conexos.ts:116-122`, adicionar:
  > ```typescript
  > httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 8 }),
  > httpAgent:  new http.Agent({ keepAlive: true, maxSockets: 8 }),
  > ```
  > Correção afeta TODOS os clientes Conexos, não só o SISPAG — ganho colateral em Permutas/Recebimentos.

- **Resultado Esperado**
  > Handshakes TLS por lote 25 itens: 25 → 1–2 (socket reusado). Latência agregada da remessa: -10 a -30 %.

- **Tactic alvo**: Reduce Overhead.
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — 1 arquivo, teste manual em HML)
- **Findings relacionados**: F-performance-3.
- **Métricas de sucesso**:
  - Handshakes TLS/lote 25 itens: 25 → ≤ 2
  - Latência agregada `POST /sispag/lotes/:id/remessa`: -3 s a -7 s (dependendo do RTT)
- **Risco de não fazer**: custo linear em todo POST sequencial do ERP — não só SISPAG.
- **Dependências**: nenhuma. Combina com performance-1 para ganho composto.

### [performance-4] Aplicar `heavyRouteLimiter` em `/painel`, `/retornos` e `/modalidades-disponiveis`

- **Problema**
  > `/painel` serializa até 5000 títulos (~1,3 MB no teto) + fan-out por filial + 2 queries locais. Sem limiter, um refresh em loop (F5 preso, extensão de browser, monitor externo mal configurado) consome sessões do Conexos e degrada o SISPAG inteiro. `/modalidades-disponiveis` é a rota mais cara depois da remessa (2 fan-outs O(N)).

- **Melhoria Proposta**
  > Adicionar `heavyRouteLimiter` (10 req/min/IP, já definido em `http/rateLimit.ts:28-36`) nas três rotas GET. Sem mudança de contrato.

- **Resultado Esperado**
  > Fair-use enforced. Um único IP não consegue mais que 10 refresh/min do painel — cobre uso humano com folga (~1 refresh a cada 6 s) e barra automação acidental.

- **Tactic alvo**: Limit Event Response.
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 3 linhas de código)
- **Findings relacionados**: F-performance-5.
- **Métricas de sucesso**:
  - Requests/min/IP tolerados em `/painel`: 100 → 10
  - Payload/min/IP tolerado: ~38 MB → ~3,8 MB
- **Risco de não fazer**: um bug de refresh em UI ou monitor externo derruba sessões Conexos = SISPAG inteiro indisponível.
- **Dependências**: nenhuma.

### [performance-5] Instrumentar `RemessaService.gerarRemessa` com deltas por etapa

- **Problema**
  > A latência real de cada etapa não é observável em produção — o único fato conhecido é o `logService.info` final. Não é possível dimensionar quando `importarTitulos` vira gargalo (F-1) sem medir. O gate ao vivo do delta rodou com lote de 2 títulos, o que não estressa o N.

- **Melhoria Proposta**
  > Em cada etapa (`listarLotesNativos`, `criarLote`, `montarItensImport`, `importarTitulos`, `finalizarLote`, `sugerirRemessa`, `gerarRemessa`, `listarArquivosRemessa`), envelopar em `const t0 = Date.now()` / `logService.info({ etapa, ms: Date.now() - t0, itens })`. Idealmente o LogService ganha um método `timing()` reutilizável para não poluir os `data` de cada log.

- **Resultado Esperado**
  > Instrumentação disponível para dimensionar F-1/F-2/F-3 em produção. Meta: cada etapa aparece nos logs com ms exatos; painel Grafana/Metabase consegue plotar p50/p95 por etapa.

- **Tactic alvo**: Monitor (fora do mapa Bass canônico deste QA; enable factor para as tactics de otimização).
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-4.
- **Métricas de sucesso**:
  - Logs de timing por etapa: 0 → 8
  - Métrica derivável em produção: p50/p95 de cada etapa
- **Risco de não fazer**: qualquer regressão de latência será notada só pelo operador via ticket, não pelo time via observabilidade.
- **Dependências**: nenhuma; roda antes ou depois de performance-1.

### [performance-6] Introduzir budget agregado com `AbortController` no `gerarRemessa`

- **Problema**
  > A rota não tem teto agregado — soma silenciosa de 25 POSTs de `importarTitulos` + 5+ outras chamadas pode estourar 100 s (default de proxy do Render). Timeout de proxy vira 504 sem contexto; o cliente re-clica; o ledger vira `reconciling`; a retomada precisa entrar.

- **Melhoria Proposta**
  > Criar `AbortController` com timeout agregado (ex.: 90 s — 10 s abaixo do proxy). Propagar `signal` no axios (`AbortSignal`). Ao expirar: `fail(key, { mensagem: 'budget agregado excedido' })` e resposta HTTP explícita `503 Service Timeout` — a retomada assume no próximo clique. Não substitui performance-1 (que ataca a causa); é rede de segurança.

- **Resultado Esperado**
  > 0 timeouts opacos de proxy no `POST /sispag/lotes/:id/remessa`. Cliente sempre recebe uma resposta identificável do backend com contexto.

- **Tactic alvo**: Bound Execution Times.
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — propagar `signal` até o axios do `ConexosBaseClient`)
- **Findings relacionados**: F-performance-4.
- **Métricas de sucesso**:
  - Timeouts de proxy em produção: > 0 → 0
  - `503 SERVICE_TIMEOUT` retornados pelo backend: 0 → N (visibilidade)
- **Risco de não fazer**: retomada continua funcionando, mas cada estouro consome 15+ min de humano para diagnosticar "por que não gerou".
- **Dependências**: idealmente vem depois de performance-1 (que reduz a probabilidade de acionar o budget).

## 6. Notas do agente

- Escopo respeitado: só delta `da2714e..HEAD` em `src/backend/domain/{service,client}/sispag/*` + `src/backend/routes/sispag.ts` + `src/frontend/app/sispag/`. Frontend praticamente inalterado (só adicionou `LoteAnteriorCanceladoError` no toast) — nada de performance a apontar lá.
- **Não medível localmente**: latência real p95 do `POST /sispag/lotes/:id/remessa` com lote grande. O gate ao vivo rodou com 2 títulos (`_shared-metrics.md:80`), o que passa longe do gargalo do N. Números do card `performance-1` são estimativas com base no timeout HTTP configurado (40 s/chamada), no cenário observado no ERP (POST write ~1 s) e na contagem estática. Instrumentar antes de otimizar é o card `performance-5`.
- **Cross-QA — Availability/Fault-Tolerance**: cards `performance-1` (paralelizar import) e `performance-6` (budget agregado) tocam Fault-Tolerance — a retomada é a "salvaguarda de fault-tolerance"; F-1 aumenta a probabilidade de acioná-la sob carga; F-6 evita que ela seja acionada por timeout de infra opaco. Consolidator: costurar com qa-availability e qa-fault-tolerance se houver findings sobrepostos sobre a retomada / `RemessaEmDuvidaError`.
- **Cross-QA — Modifiability**: F-2 (dedupe esquecido em `RemessaService` × presente em `SispagPainelService`) é sinal de "padrão bom não é reutilizado" — pode virar finding de Modifiability se o consolidator quiser reforçar.
- Cache de `listContasCorrentes` (fin005) foi rebaixado a P3 e omitido dos cards: a filial × banco não muda com frequência, mas o ledger write-ahead precisa da consulta fresca — trade-off resolvido pelo dedupe do card 2.
