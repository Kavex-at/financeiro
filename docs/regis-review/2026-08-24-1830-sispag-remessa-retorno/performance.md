---
qa: Performance
qa_slug: performance
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-performance
generated_at: 2026-08-24T18:30:00-03:00
scope: backend
score: 5
findings_count: 6
cards_count: 6
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao SISPAG)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro | Clica "Conciliar retorno" em arquivo Bradesco (153 códigos configurados no fin050) | `ConciliacaoRetornoService.conciliar` → `ConexosSispagRetornoClient.listDetalhe` (loop serial) | Operação normal, Express single-node no Render, sessão ERP única | Devolve pagos/rejeitados/não-reconhecidos e transiciona lotes | p95 da rota ≤ 20 s; sem exaustão do pool de sessões Conexos (`LOGIN_ERROR_MAX_SESSIONS`) |
| Frontend (aba "Lotes candidatos") | Analista abre a aba, 8 `LoteCard` de RASCUNHO se montam em paralelo | `useEffect` de `fetchContasPagadoras(filCod)` — 1 request por card | Rede intra-VPC, mesma filial em todos os cards | Uma única leitura de `fin005/list` alimenta todos os cards | 1 request /sispag/contas-pagadoras por (aba, filCod) — não 8 |
| Cron/analista | Clica "Gerar remessa (.REM)" de lote com 25 títulos | `RemessaService.montarItensImport` → `listContasFavorecido` por item + `listarTitulosPendentes` single-page | Escrita gated; ERP em produção, ~500 ms/POST | Monta payload de import sem chamadas redundantes e sem perder títulos por paginação | Chamadas a `cmn025/ctcorr` ≤ #favorecidos DISTINTOS; 0 falsos "não está mais elegível" |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas serial a `fin052/arquivosRetornoDetalhe/list` por arquivo Itaú | 52 | ≤ 15 (via paralelismo bounded) | ❌ | `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:112-124` (`for (const ev of eventos)`) |
| Chamadas serial a `fin052/arquivosRetornoDetalhe/list` por arquivo Bradesco | 153 | ≤ 40 | ❌ | idem + carteira PRD |
| Tempo estimado da conciliação Bradesco (153 códigos × ~600 ms típicos ERP, serial, sem contar retries) | ~92 s p50; até ~180 s se metade cai em retry (`RetryExecutor` 2×500 ms+jitter) | ≤ 25 s | ❌ | derivado de `ConexosBaseClient.ts:156` (retries=2, delayMs=500, jitterMs=200) + tamanho do eventos |
| N+1 em `RemessaService.montarItensImport` — chamadas `cmn025/ctcorr` por lote | 1 por item (25 no máx.) — sem dedupe por `(filCod, pesCod)` | ≤ #favorecidos DISTINTOS (tipicamente 3-8 num lote) | ❌ | `src/backend/domain/service/sispag/RemessaService.ts:344-360` (`for (const item of lote.itens)` + `listContasFavorecido`) |
| Cobertura de `listarTitulosPendentes` sob a carteira da filial 2 (pageSize=500 fixo, pageNumber=1) | 500 / 2020 = 24,7% | 100% dos títulos do lote encontrados | ❌ | `src/backend/domain/client/ConexosSispagWriteClient.ts:143-165` + `preflight-fin015-prd.ts:97-108` (paginação até 40 páginas) |
| Fetch `/sispag/contas-pagadoras` disparados por render da aba "Lotes candidatos" (8 cards RASCUNHO/página, todos da mesma filial) | 8 requests idênticos em paralelo | 1 (cache/dedup por filCod) | ❌ | `src/frontend/app/sispag/components/LoteCard.tsx:112-124` (useEffect por card) |
| `SELECT ... FROM titulo_a_pagar WHERE ativo` — LIMIT | ausente; retorna 1511 rows; front é servido só com CAP=400 | LIMIT no SQL (ou cursor) | ⚠️ | `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:133-143` + `SispagPainelService.ts:24` (TITULOS_CAP=400) |
| Timeout axios do cliente Conexos | 40 000 ms | ≤ 15 000 ms (com retry externo) | ⚠️ | `src/backend/services/conexos.ts:116-121` |
| Retry executor Conexos — retries/delay/jitter | 2 / 500 ms / 200 ms | mantido (razoável) | ✅ | `src/backend/domain/client/ConexosBaseClient.ts:154-162` |
| Fanout bounded no `SispagPainelService` | 4 (`CONEXOS_FANOUT_LIMIT`) | 4 | ✅ | `SispagPainelService.ts:29` |
| Índice `idx_lote_pagamento_nativo (native_fil_cod, native_bnc_cod, native_flp_cod)` para `findByChaveNativa` | presente | presente | ✅ | `migrations/0049_sispag_remessa_retorno.sql:99-100` |
| Bundle size backend Lambda / cold start | N/A — Express no Render, container long-lived | — | N/A | `_shared-metrics.md` linha 4 |

> ⚠️ **Não medível localmente**: latência p50/p95 real do fin052/fin015 em produção. Sem métrica de APM (Datadog/New Relic) no Render. Recomendação: instrumentar `ConexosBaseClient` com histograma por endpoint (labels: `serviceName`, `filCod`), exportar para o `/metrics` do backend, e alertar quando p95 do `arquivosRetornoDetalhe/list` × #eventos > 30 s.
> ⚠️ **Não medível localmente**: profundidade real da fila de sessões (`LOGIN_ERROR_MAX_SESSIONS`). A tela ainda opera com usuário real (não robô), sujeita a colisão com o Conexos Web.

## 3. Tactics — Cobertura no SISPAG

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — não há amostragem de eventos; carteira ingerida integralmente | N/A | — |
| Limit Event Response | `TITULOS_CAP = 400` cortando o payload; `Idempotency-Key` curto-circuita re-execução da remessa; `MAX_TITULOS_POR_LOTE = 25` na formação automática | ⚠️ parcial | `SispagPainelService.ts:24`, `RemessaService.ts:127-146`, `FormacaoLotesService.ts:19` |
| Prioritize Events | Ordenação por vencimento no painel; `heavyRouteLimiter` no rate-limit de rotas caras | ⚠️ parcial | `SispagPainelService.ts:260-268`, `routes/sispag.ts:288-301` |
| Reduce Overhead | Retry pula `4xx` determinístico; `ensureSid` reaproveita sessão; JSON envelope minimalista em `mapArquivo`/`mapItem` | ✅ presente | `ConexosBaseClient.ts:160-162`, `ConexosSispagRetornoClient.ts:250-268` |
| Bound Execution Times | axios timeout 40 s no cliente legado; retry cap = 2 | ⚠️ parcial (40 s por chamada × 153 chamadas seriais na conciliação = 6120 s no pior caso) | `services/conexos.ts:121` |
| Increase Resource Efficiency | Dedup de favorecidos no `SispagPainelService.modalidadesDisponiveisDoLote` (commit 7be243f); bulk INSERT em `adicionarItens` | ⚠️ parcial — dedup NÃO replicado em `RemessaService.montarItensImport` | `SispagPainelService.ts:212-243` vs `RemessaService.ts:344-360` |
| Increase Resources | N/A — Render single-node, sem sharding do ERP | N/A | — |
| Increase Concurrency | `BoundedConcurrency(4)` no painel e retornos; `Promise.all` na ingestão | ⚠️ parcial — `ConciliacaoRetornoService` e `RemessaService.montarItensImport` NÃO usam BoundedConcurrency | `SispagPainelService.ts:77,147,163,214,235` vs `ConciliacaoRetornoService.ts:112` |
| Maintain Multiple Copies of Computations | Chaves nativas duplicadas em `lote_pagamento.native_*` para o painel não precisar re-consultar o ERP | ✅ presente | `migrations/0049_sispag_remessa_retorno.sql:19-23` |
| Maintain Multiple Copies of Data | Ingestão persistente da carteira (`titulo_a_pagar`) → painel não busca AO VIVO em cada montagem | ✅ presente | `SispagPainelService.ts:63-67`, `TituloAPagarRepository.ts:133-143` |
| Bound Queue Sizes | `heavyRouteLimiter` + advisory lock na ingestão/formação (409 quando ocupado) | ✅ presente | `routes/sispag.ts:288-301`, `IngestaoPagamentosService.ts` (lock 726354819), `FormacaoLotesService.ts:22` |
| Schedule Resources | Cron da ingestão + formação; advisory locks impedem sobreposição | ✅ presente | `FormacaoLotesService.ts:47-53` |
| Cache Strategy (moderno) | Nenhum cache de leituras do ERP (eventos bancários, contas pagadoras da filial). Cada request bate no `fin005/list` / `fin050/list` do zero | ❌ ausente | ausência procurada em `ConexosSispagClient.ts:264`, `ConexosSispagRetornoClient.ts:184` |
| Index Discipline (moderno) | Índice novo para `findByChaveNativa`; migração idempotente | ✅ presente | `migrations/0049_sispag_remessa_retorno.sql:99-100` |
| Bundle leanness (moderno) | N/A backend (Express no Render); frontend com Next 15 (não medido nesta review) | N/A | — |

## 4. Findings (achados)

### F-performance-1: Conciliação varre o retorno código-a-código EM SÉRIE, sem BoundedConcurrency

- **Severidade**: P0
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:112-124`
- **Evidência (objetiva)**:
  ```typescript
  for (const ev of eventos) {
      try {
          const det = await this.retorno.listDetalhe({
              ...this.chave(input),
              eventoCod: ev.cod,
              eventoTipo: ev.tipo,
              pageSize: 200,
          });
          for (const d of det) { linhas.push({ ...d, eventoDescricao: d.eventoDescricao ?? ev.descricao }); }
      } catch { /* código não presente neste arquivo — segue. */ }
  }
  ```
- **Impacto técnico**: Bradesco tem 153 códigos configurados no fin050; cada um vira um POST serial ao `fin052/arquivosRetornoDetalhe/list` com `runWithRetry` (2 retries × 500 ms + jitter). Assumindo 600 ms típicos por chamada, a conciliação Bradesco leva ~92 s p50 e chega perto do timeout do proxy do Render (60-120 s conforme plano) — a rota `/sispag/retornos/conciliar` pode devolver 504 antes de concluir. Itaú (52 códigos) fica em ~31 s.
- **Impacto de negócio**: analista clica "Conciliar retorno", aguarda quase 2 min sem feedback; se o proxy corta, o lote fica em estado inconsistente (algumas linhas gravadas, transição de status truncada). Todo dia útil, um arquivo por banco por filial.
- **Métrica de baseline**: 52 chamadas serial (Itaú) / 153 (Bradesco) por conciliação; 92 s p50 estimado para Bradesco.

### F-performance-2: `RemessaService.montarItensImport` reintroduz o N+1 corrigido em 7be243f

- **Severidade**: P1
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:344-360`
- **Evidência (objetiva)**:
  ```typescript
  for (const item of lote.itens) {
      const pendente = pendentes.find(...);
      // ...
      const pesCod = pendente.raw.pesCod;
      const contas = pesCod != null
          ? await this.sispag.listContasFavorecido(String(pesCod), lote.filCod)
          : [];
      // ...
  }
  ```
  `7be243f perf(sispag): uma consulta de contas por favorecido, não por título` fez exatamente esse fix no `SispagPainelService.modalidadesDisponiveisDoLote` (agora em duas fases: `getTituloAPagar` por item, `listContasFavorecido` por par distinto `(filCod, pesCod)`). O RemessaService não recebeu o mesmo tratamento — e é aqui que acontece a chamada mais custosa: `POST cmn025/ctcorr/list` com sessão + auth + retry por item.
- **Impacto técnico**: um lote de 25 itens (limite da formação automática) com 5 favorecidos distintos hoje custa 25 chamadas ao ERP em vez de 5. Serial, dentro do handler síncrono que já roda com Idempotency-Key comprometida (não pode re-iniciar).
- **Impacto de negócio**: geração de remessa levando ~15 s a mais do necessário; janela maior de erro entre o `criarLote` (POST 1/4) e o `finalizarLote` (POST 3/4) — se um dos 25 lookups falhar, o lote nativo já foi criado e vira órfão.
- **Métrica de baseline**: 25 chamadas `cmn025/ctcorr/list` por lote com 25 itens (worst case). Alvo: ≤ #favorecidos distintos (típico 3-8).

### F-performance-3: `listarTitulosPendentes` pede pageSize=500 mas não pagina — falso "título não está mais elegível"

- **Severidade**: P0
- **Tactic violada**: Bound Execution Times (falha silenciosa em vez de erro de latência)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:143-165` (fixa `pageNumber: 1`, `pageSize: 500`); consumido por `RemessaService.montarItensImport` em `RemessaService.ts:341`
- **Evidência (objetiva)**: a produção da filial 2 tem ~2020 títulos pendentes (medido em `preflight-fin015-prd.ts`, que itera até 40 páginas). O RemessaService pede uma única página de 500 e faz `pendentes.find((p) => p.docCod === item.docCod && p.titCod === item.titCod)`. Se o título estiver a partir da posição 501 na ordem do ERP, o `.find` devolve `undefined` e o serviço lança "título X não está mais elegível" — quando na verdade está, só está fora da janela paginada. O `preflight-fin015-prd.ts:97-108` já sabe disso ("uma página de 500 dá a ilusão de 'só existem 500' e esconde justamente os títulos de valor baixo") e pagina.
- **Impacto técnico**: `RemessaService` recusa lotes válidos por causa de paginação, e o lote nativo vazio já foi criado no ERP → sobra órfão consumindo `flpCod`. Também impede formação automática de lotes de títulos mais antigos.
- **Impacto de negócio**: até 74,7% dos títulos elegíveis da filial 2 (1520/2020) estão fora da janela default e podem falhar a remessa. Rebound: cria lote no ERP, falha o import, o `RemessaExecucaoRepository` marca `error`, mas o `flpCod` fica alocado; próxima tentativa reaproveita (bom), mas o UX é ruim.
- **Métrica de baseline**: 500/2020 = 24,7% de cobertura; 26 lotes com 543 títulos automáticos previstos → subconjunto arbitrário dos 500 primeiros.

### F-performance-4: `LoteCard.useEffect` dispara `fetchContasPagadoras` por card — 8 requests idênticos em paralelo

- **Severidade**: P1
- **Tactic violada**: Reduce Overhead / Maintain Multiple Copies of Computations
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:112-124`
- **Evidência (objetiva)**:
  ```tsx
  const [contas, setContas] = React.useState<ContaPagadora[]>([])
  React.useEffect(() => {
      if (!isRascunho) return
      let vivo = true
      fetchContasPagadoras(l.filCod)
          .then((cs) => { if (vivo) setContas(cs) })
          .catch(() => { if (vivo) setContas([]) })
      return () => { vivo = false }
  }, [isRascunho, l.filCod])
  ```
  A aba "Lotes candidatos" (`page.tsx:655`) renderiza `abaCandidatos.slice.map((l) => <LoteCard ...>)` com pageSize=8. Ambiente PRD: formação automática cria 26 lotes de RASCUNHO, todos da filial 2 (contexto do delta). Cada abertura de aba = 8 chamadas idênticas paralelas a `GET /sispag/contas-pagadoras?filCod=2`, cada uma disparando um `fin005/list` no Conexos (session + auth + retry). Sem cache no cliente Express, cada request executa a integração completa.
- **Impacto técnico**: 8× carga no pool de sessões ERP e no throttle documentado (`LOGIN_ERROR_MAX_SESSIONS`). Reabertura da aba refaz tudo — não há `Cache-Control`, não há SWR.
- **Impacto de negócio**: latência perceptível na aba (8 requests sequenciais dependendo do keep-alive do proxy); risco de colidir com a sessão real do analista no Conexos Web (é a mesma credencial de pessoa) → login expulso, formulário perdido.
- **Métrica de baseline**: 8 requests /`sispag/contas-pagadoras?filCod=2` por render da aba; 0 dedup.

### F-performance-5: `listAtivos` sem `LIMIT` — puxa a carteira inteira quando o front consome só CAP=400

- **Severidade**: P2
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:133-143` (SQL sem LIMIT) + `src/backend/domain/service/sispag/SispagPainelService.ts:24,101` (`TITULOS_CAP = 400`)
- **Evidência (objetiva)**: SQL: `SELECT ... FROM titulo_a_pagar WHERE ativo = TRUE ORDER BY vencimento ASC NULLS LAST`. Sem `LIMIT`. Contexto atual: 1511 títulos na carteira. O serviço faz `titulosPreparados.slice(0, TITULOS_CAP)` (CAP=400) DEPOIS de calcular KPIs — os KPIs precisam da carteira toda, então o LIMIT no SQL não pode ser 400 puro; mas paginação por filial ou cursor evita transportar 1111 linhas descartadas.
- **Impacto técnico**: cada carga do painel serializa 1511 linhas do PG → Express → JSON, sendo que só 400 chegam ao browser. Overhead crescente linear com a carteira (Columbia vai importar mais processos).
- **Impacto de negócio**: painel demora mais em filial grande; sob concorrência (vários usuários), pressiona o pool do PG desnecessariamente.
- **Métrica de baseline**: 1511 rows transportadas, 400 renderizadas (73,5% desperdício); alvo: ≤ 500 rows transportadas OU cálculo de KPIs delegado ao SQL (agregado).

### F-performance-6: Sem cache local para leituras estáticas do ERP (eventos bancários, contas pagadoras da filial)

- **Severidade**: P2
- **Tactic violada**: Cache strategy (moderno) / Maintain Multiple Copies of Data
- **Localização**: `src/backend/domain/client/ConexosSispagRetornoClient.ts:184-210` (`listEventosBancarios` — 52 códigos Itaú, 153 Bradesco), `src/backend/domain/client/ConexosSispagClient.ts:264-286` (`listContasCorrentes` da filial — 17 contas na filial 2)
- **Evidência (objetiva)**: nenhuma instância privada de cache nem TTL. Cada `conciliar` re-consulta a lista de eventos (que não muda a cada retorno) e cada abertura de aba re-consulta contas pagadoras. Contraste com o próprio CLAUDE.md (produtizacao): "cache config retrieved values in instance variables".
- **Impacto técnico**: chamadas redundantes ao ERP; junto com F-performance-1 e F-performance-4, é o gatilho principal do risco `LOGIN_ERROR_MAX_SESSIONS`.
- **Impacto de negócio**: sob carga de fechamento (múltiplos analistas + cron de formação + reprocessamento manual), a sessão pode ser derrubada — remessa em voo vira `reconciling` órfão (fail-closed correto, mas exige olho humano por lote).
- **Métrica de baseline**: 0% de hit rate (não há cache). Alvo: TTL 5 min em `listEventosBancarios(bncCod)` e `listContasCorrentes(filCod)` → ≥ 90% hit rate durante um turno de conciliação/montagem.

## 5. Cards Kanban

### [performance-1] Paralelizar a varredura de códigos na conciliação do retorno

- **Problema**
  > `ConciliacaoRetornoService.conciliar` percorre os códigos de evento bancário (52 no Itaú, 153 no Bradesco) EM SÉRIE com `runWithRetry` (2×500 ms+jitter). Cada conciliação Bradesco leva ~92 s p50; conciliação Itaú ~31 s. O ERP não aceita `#IN` para `fbeEspCod`, então dedup por filtro é impossível — mas paralelismo é. Hoje a rota /sispag/retornos/conciliar pode estourar o timeout do proxy do Render antes de terminar.

- **Melhoria Proposta**
  > Substituir o `for (const ev of eventos)` por `BoundedConcurrency.run(eventos, ev => listDetalhe(...), CONEXOS_FANOUT_LIMIT)` — o mesmo padrão já em uso em `SispagPainelService.montarPainel` e `modalidadesDisponiveisDoLote`. Manter o `try/catch` per-código; converter `settled` em `linhas`. Considerar aumentar o limite pontualmente (ex.: 6) se as métricas indicarem folga no pool de sessão.
  > Complementarmente, adicionar cache TTL curto (60 s) em `listEventosBancarios` — a lista de códigos não muda dentro de um lote de conciliação.

- **Resultado Esperado**
  > Conciliação Bradesco cai de ~92 s p50 para ~23 s p50 (153 ÷ 4 × 600 ms) e Itaú de ~31 s para ~8 s. Nenhum 504 de proxy. Zero chamadas redundantes de `listEventosBancarios` numa mesma conciliação.

- **Tactic alvo**: Increase Concurrency + Reduce Overhead
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-6
- **Métricas de sucesso**:
  - p50 duração `/sispag/retornos/conciliar` para Bradesco: ~92 s → ≤ 25 s
  - p50 para Itaú: ~31 s → ≤ 10 s
  - # chamadas `listEventosBancarios` por conciliação: 1 (com TTL 60 s: 0 nas subsequentes do turno)
- **Risco de não fazer**: quando a carteira crescer ou o Nexxera introduzir novos códigos, a rota timeouta silenciosamente. Lotes ficam metade-conciliados; analista não sabe se pode reprocessar (não é idempotente na tabela `lote_pagamento_item` em relação ao `bxa_cod_seq`).
- **Dependências**: nenhuma — `BoundedConcurrency` já está injetável.

### [performance-2] Deduplicar contas de favorecido em `RemessaService.montarItensImport` (paridade com commit 7be243f)

- **Problema**
  > `RemessaService.montarItensImport` chama `listContasFavorecido(pesCod, filCod)` DENTRO do `for (const item of lote.itens)`. Um lote de 25 itens (limite da formação automática) com 5 favorecidos distintos hoje custa 25 chamadas ao `cmn025/ctcorr/list` em vez de 5. O commit 7be243f já corrigiu esse padrão no `SispagPainelService.modalidadesDisponiveisDoLote` (duas fases: títulos por item, contas por par `(filCod, pesCod)` DISTINTO); a correção não foi propagada aqui.

- **Melhoria Proposta**
  > Refatorar `montarItensImport` em duas fases, igual ao que `SispagPainelService.modalidadesDisponiveisDoLote` faz:
  > 1. `BoundedConcurrency.run(lote.itens, ...)` para casar `pendente` por `(docCod, titCod)` — hoje já é `pendentes.find(...)`, não requer chamada.
  > 2. Extrair `favorecidos = new Map<'{filCod}:{pesCod}'>` e chamar `listContasFavorecido` uma vez por par distinto, também via `BoundedConcurrency`.
  > 3. Loop final apenas monta o payload com o resultado em memória.

- **Resultado Esperado**
  > Chamadas `cmn025/ctcorr/list` por remessa: 25 → tipicamente 3-8 (número de favorecidos distintos no lote). Latência da rota `POST /sispag/lotes/:id/remessa` cai ~10-15 s em lotes típicos, reduzindo a janela em que um lote nativo criado no ERP pode virar órfão.

- **Tactic alvo**: Increase Resource Efficiency + Increase Concurrency
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — código-modelo já existe em `SispagPainelService.ts:212-243`.
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Chamadas `cmn025/ctcorr/list` por remessa de 25 itens: 25 → ≤ #favorecidos_distintos
  - p50 duração `POST /sispag/lotes/:id/remessa` em lote de 25 itens: baseline atual → -10 s
  - # lotes órfãos no `fin015` por 100 remessas em produção: baseline → 0 causado por lookup lento
- **Risco de não fazer**: regressão da eficiência que o próprio time já pagou o custo de entender e resolver uma vez (commit 7be243f). Débito conceitual: o Regis-Review anterior vai reencontrar isto em cada nova rota que precisar montar itens.
- **Dependências**: nenhuma.

### [performance-3] Paginar `listarTitulosPendentes` no `RemessaService.montarItensImport` (ou filtrar server-side pelos títulos do lote)

- **Problema**
  > `RemessaService.montarItensImport` chama `listarTitulosPendentes({ pageSize: 500 })`, e o cliente fixa `pageNumber: 1`. A filial 2 tem ~2020 títulos pendentes hoje — o método só enxerga 500 (24,7%) e usa `.find()` para casar contra os itens do lote. Se o título não estiver na primeira página, o serviço lança "título X não está mais elegível — pode já ter sido pago ou entrado em outro lote", **mesmo quando está**. O lote nativo `flpCod` já foi criado (fica órfão, reaproveitado só se a próxima tentativa reuser a mesma `idempotency_key`).

- **Melhoria Proposta**
  > Duas alternativas, em ordem de preferência:
  > 1. **Filtro server-side** — passar `filtro: { 'docCod#IN': lote.itens.map((i) => i.docCod) }` (ou combinação `docCod`+`titCod` se o ERP suportar) para reduzir a resposta ao conjunto exato do lote. O ERP recusa `#IN` em `fbeEspCod`, mas o preflight já usa `#EQ` por `docCod` — validar em HML.
  > 2. **Paginação real** — se o `#IN` não passar, paginar até encontrar todos os `(docCod, titCod)` do lote OU alcançar `count`, igual ao `preflight-fin015-prd.ts:97-108`. Guardrail de 40 páginas × 500 = 20 000 rows (já provado em HML).
  > Independente da via, converter os pendentes em `Map<'{docCod}:{titCod}'>` para lookup O(1) no loop.

- **Resultado Esperado**
  > 0 falsos negativos "não está mais elegível" por causa de paginação. Payload transferido do ERP → Express reduz de 500 linhas para ≤ 25 (o tamanho do lote) via `#IN`, ou até 40 páginas apenas quando estritamente necessário.

- **Tactic alvo**: Bound Execution Times + Limit Event Response
- **Severidade**: P0
- **Esforço estimado**: M (2-5d) — inclui validar `#IN` em HML e escrever teste com paginação simulada.
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Cobertura da filial 2 (títulos elegíveis vs. visíveis ao serviço): 24,7% → 100%
  - Rows transportadas do ERP por remessa: 500 → ≤ #itens_do_lote (se `#IN` validar) ou ≤ 500 × min(páginas, encontrados)
  - # falhas "não está mais elegível" atribuíveis à paginação em produção: baseline → 0
- **Risco de não fazer**: qualquer remessa de título "antigo" da filial 2 pode virar lote órfão no ERP. Como a cadeia de escritas é não-idempotente, cada órfão precisa de intervenção manual (cancelar `flpCod` no fin015).
- **Dependências**: teste em HML para confirmar aceitação de `docCod#IN`.

### [performance-4] Elevar a busca de contas pagadoras do card para o container da aba (dedup por filCod)

- **Problema**
  > Cada `LoteCard` roda um `useEffect` que chama `fetchContasPagadoras(l.filCod)` na montagem. A aba "Lotes candidatos" renderiza até 8 cards de RASCUNHO por página, quase sempre da mesma filial (formação automática de PRD prevê 26 lotes de 543 títulos da filial 2). Resultado: 8 requests idênticos disparados em paralelo por render de aba, sem cache. Cada request bate no `fin005/list` da filial via ConexosClient, com session + auth + retry.

- **Melhoria Proposta**
  > 1. Mover o fetch para o container da aba (`src/frontend/app/sispag/page.tsx:655`), agrupando por `filCod` presente na página atual — `const contasPorFilial = useContasPagadoras(filCodsVisiveis)`.
  > 2. Cachear com SWR (`useSWR('/sispag/contas-pagadoras?filCod=' + filCod)`) ou React Query — dedup automática por chave dentro do render.
  > 3. Passar `contas={contasPorFilial.get(l.filCod)}` como prop do `LoteCard`, removendo o `useEffect` interno.
  > 4. Backend: adicionar cache TTL 5 min em `ConexosSispagClient.listContasCorrentes(filCod)` como segunda linha de defesa (fin005 muda com baixíssima frequência).

- **Resultado Esperado**
  > Requests `GET /sispag/contas-pagadoras` por render da aba (26 lotes filial 2, pageSize 8): 8 → 1. Chamadas `fin005/list` por turno de trabalho: N × #renders → 1 (com TTL 5 min).

- **Tactic alvo**: Reduce Overhead + Cache Strategy
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-4, F-performance-6
- **Métricas de sucesso**:
  - Requests `/sispag/contas-pagadoras` por render da aba filial 2: 8 → 1
  - # chamadas `fin005/list` por analista/hora: baseline → 1-2 (com TTL)
  - # ocorrências de `LOGIN_ERROR_MAX_SESSIONS` durante a montagem: baseline → 0 atribuíveis a este endpoint
- **Risco de não fazer**: com 26 lotes automáticos previstos, a aba "Lotes candidatos" vira o principal disparador de burst de sessão ERP — colide com a sessão real do analista no Conexos Web (mesma credencial) e derruba login.
- **Dependências**: instalar/adotar SWR ou React Query se não já em uso (verificar frontend/package.json).

### [performance-5] Servir a carteira paginada / com KPIs agregados no SQL

- **Problema**
  > `TituloAPagarRepository.listAtivos` faz `SELECT ... WHERE ativo = TRUE` sem `LIMIT`. Hoje transporta 1511 rows para o Express, que calcula KPIs em memória e devolve só 400 ao browser (via `TITULOS_CAP = 400`). O overhead cresce linearmente com a ingestão e não é observável até virar problema.

- **Melhoria Proposta**
  > Duas opções combináveis:
  > 1. **Split**: query 1 devolve KPIs agregados (COUNT/SUM por bucket de aging) via SQL; query 2 devolve TOP 400 títulos por vencimento com LIMIT. Elimina o transporte de 1111 linhas descartadas.
  > 2. **Paginação server-side** para o grid de títulos — o front já pagina in-memory; expor query params `?limit=&offset=&filCod=&status=` seguindo o "Dynamic WHERE Pattern" do CLAUDE.md.

- **Resultado Esperado**
  > Rows transportadas do PG por request de painel: 1511 → ≤ 500 (com espaço para crescimento até 10× sem revisitar a arquitetura). Latência da rota `/sispag/painel` p95 cai proporcionalmente à parcela de PG+JSON no orçamento total.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — inclui teste de que KPIs continuam corretos quando calculados em SQL.
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Rows lidos por `listAtivos`: 1511 → ≤ 500
  - Payload JSON do endpoint `/sispag/painel`: baseline → -30-40%
  - Tempo p95 da rota `/sispag/painel` com carteira dobrada: baseline projetado → mantido
- **Risco de não fazer**: escala linear com a carteira; quando a Columbia liberar mais filiais/processos, o painel será o primeiro a demorar.
- **Dependências**: nenhuma.

### [performance-6] Cache de instância com TTL para leituras estáticas do ERP (`listEventosBancarios`, `listContasCorrentes`)

- **Problema**
  > Duas leituras "quase-estáticas" batem no Conexos em toda operação: `listEventosBancarios(bncCod)` (52-153 códigos, muda em cadastro) e `listContasCorrentes(filCod)` (17 contas na filial 2, muda raramente). Nenhuma cache. Junto com F-performance-1 e F-performance-4, é o gatilho principal do risco de exaustão do pool de sessão (`LOGIN_ERROR_MAX_SESSIONS`).

- **Melhoria Proposta**
  > Em cada `@singleton` cliente Conexos, cache em `Map<string, { ts: number; value: T }>` com TTL configurável por chave:
  > - `ConexosSispagRetornoClient.listEventosBancarios(bncCod)` — TTL 5 min.
  > - `ConexosSispagClient.listContasCorrentes(filCod)` — TTL 5 min.
  > Chave inclui `filCod`+`bncCod` conforme aplicável. Nenhum cache negativo (erro não é cacheado — segue o padrão do `SispagPainelService`).

- **Resultado Esperado**
  > Chamadas ao ERP para essas duas leituras caem para ≤ 1 por (chave, 5 min). Em um turno normal (várias conciliações + renders da aba), reduz de dezenas para 2-3.

- **Tactic alvo**: Maintain Multiple Copies of Data / Cache Strategy
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-6, F-performance-1, F-performance-4
- **Métricas de sucesso**:
  - Hit rate do cache `listEventosBancarios` num turno de conciliação: 0% → ≥ 90%
  - Hit rate `listContasCorrentes`: 0% → ≥ 95%
  - # chamadas ao Conexos por turno atribuíveis a essas duas leituras: baseline → -90%
- **Risco de não fazer**: cache não é ganho enorme sozinho, mas somado aos outros cards multiplica o efeito de cada um; sem ele, a economia de F-performance-1 e F-performance-4 fica pela metade.
- **Dependências**: pode entrar depois dos cards 1 e 4 sem regressão.

## 6. Notas do agente

- Escopo restrito ao delta do PR #60. Não avaliei bundle FE nem cold start (ambos N/A neste stack: Express no Render, sem Lambda/Terraform).
- Cross-QA: F-performance-1 e F-performance-3 têm sobreposição forte com **fault-tolerance** (timeout do proxy → estados semi-conciliados; lotes órfãos no ERP). F-performance-4 sobrepõe com **availability** (colisão de sessão ERP com o Conexos Web do analista real). F-performance-6 sobrepõe com **modifiability** (onde mora o cache — cliente vs. decorator).
- Métricas de latência real do ERP não são medíveis localmente (Render sem APM). Todos os números de tempo (~92 s Bradesco, ~31 s Itaú) são estimativas derivadas de `#códigos × 600 ms`+`RetryExecutor`. Recomendação para o consolidator: pedir uma medição pontual em HML antes de fechar o card 1 (rodar `probe-fin052-retorno.ts` com timing).
- Não avaliei o `IngestaoPagamentosService` em profundidade — está fora do delta declarado do PR, apesar de tocar padrões similares. Se o consolidator quiser cobertura, pedir escopo estendido explicitamente.
