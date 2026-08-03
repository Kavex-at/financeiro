---
qa: Performance
qa_slug: performance
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-performance
generated_at: 2026-08-03T18:47:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 4
---

# Performance — Regis-Review (ADR-0027, feature-scoped)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre modal "Alocar", seleciona um processo com SNs históricas | 1 clique → cascata: `GET /recebimentos/clientes` → `GET /transacoes/:txnId/processos` → `GET /processos/:priCod/sns` (NOVO — `POST com299/list` no Conexos, pageSize=50, 1 página) → seleciona SN existente → `POST /transacoes/:txnId/solicitacao-numerario?snDocCod=…` | Rota nova `/processos/:priCod/sns` (`routes/recebimentos.ts:366`), método `ConexosGerDocProcessoClient.listSNsByProcesso` (`ConexosGerDocProcessoClient.ts:1049`), effect de carregamento no dialog (`AlocarProcessosDialog.tsx:305-327`), branch de skip da geração no `RecebimentoNumerarioService.etapaSn` (`RecebimentoNumerarioService.ts:418-462` e `355-357`) | Analista em produção multi-filial (janela ativa 08-18h), Conexos com p95 2-4s por chamada, um processo com histórico de SNs (≤ 50 por processo é o mundo real da Columbia — encomenda gera 1-3 SNs por mês) | Painel de SN aparece em ≤ 1s no caso quente (segunda visita ao mesmo processo, cacheada por `priCod`); ao processar SN existente, o backend executa somente `fin014 + com297 + fiscal + homologar + poll`, pulando o bloco `validarGeracao → gerarDocProcesso → completarSnAdiantamento → finalizarDocumento` (≥ 10 POSTs poupados) | 1ª carga do painel de SN: p95 ≤ 3s (uma round-trip Conexos). Cache-hit: p95 ≤ 50ms (só render, sem fetch). Latência do "Processar" no ramo SN existente: p95 ≤ 40% da latência do ramo "Criar novo SN" (redução mensurada por número de POSTs write no Conexos: ~5-7 vs. ~15-17). |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| pageSize da lista de SN por processo | 50 (default), teto informal via `params.pageSize` | ≥ 50 e ≤ 200 (SN por processo é low-cardinality — 50 cobre >99% da carteira) | ✅ | `ConexosGerDocProcessoClient.ts:1053-1055` |
| Nº de páginas buscadas | 1 (sem loop de paginação) | 1 (aceitável se pageSize ≥ p99 real) | ⚠️ | `ConexosGerDocProcessoClient.ts:1058-1098` — não itera `pageNumber`, ignora `count` do envelope |
| Cache client-side por `priCod` | Presente (`sns[priCod] !== undefined ? return`) | Presente com invalidação em novo processo | ✅ | `AlocarProcessosDialog.tsx:309` |
| Refetch ao re-selecionar processo | 0 chamadas (cache hit) | 0 | ✅ | `AlocarProcessosDialog.tsx:305-327` (effect key: `processoSelecionado?.priCod/filCod`) |
| POSTs write no Conexos — ramo "Criar novo SN" | ~15-17 (validaProcessoPessoa + validaConfigDocPessoa + listConfigDocProcesso + validaConfigDoc + validarGeracao + gerDocProcesso + comDocProdutos initialValues/adicionar + finalizaDocumento (2 posts + 1 GET releitura) + fin014 cadeia + com297 cadeia + fiscal + obs + homologar) | baseline | — | `RecebimentoNumerarioService.ts:418-462` + cadeia downstream |
| POSTs write no Conexos — ramo "SN existente" (ADR-0027) | ~5-7 (pula `validarGeracao/gerarDocProcesso/completarSnAdiantamento/finalizarDocumento`) | ≤ 60% do baseline | ✅ | `RecebimentoNumerarioService.ts:425-461` — `snSelecionada` guard, `existente ?? snSelecionadaDocCod` |
| Chamadas duplicadas de `fetchSNsDoProcesso` numa sessão | 1 por `(priCod)` distinto | ≤ 1 por sessão-modal | ✅ | `AlocarProcessosDialog.tsx:305-327` |
| TTL do cache de SN | ∞ (vida da sessão modal); reset em `open`/troca de cliente | ≤ 5min OU invalidação em `processar` bem-sucedido | ⚠️ | `AlocarProcessosDialog.tsx:255-256, 286-287` — cache é limpo ao trocar cliente e ao abrir; NÃO é invalidado após "Processar" com sucesso (SN nova gerada não aparece se o analista processar outra alocação no mesmo processo) |
| Bundle FE impacto (novo componente/lib) | +51 LOC em `lib/recebimentos.ts`, +276 LOC líquidas em `AlocarProcessosDialog.tsx` | não regride First Load JS | ⚠️ Não medível localmente (Next build não rodado neste review; nenhum import pesado novo em top-level) | `_shared-metrics.md:15-16` |
| Cold-start impact (backend) | 0 novos deps, +106 LOC no client, +53 LOC na rota | 0 regressão | ✅ | `_shared-metrics.md:9-16` — nenhuma nova dep no `package.json` neste delta |

> ⚠️ **Não medível localmente**: latência real end-to-end contra Conexos (produção). Requer instrumentação com métrica custom no `ConexosBaseClient.postGeneric` (`duration_ms{endpoint="com299/list"}`) e comparação p50/p95 entre ramos "SN existente" vs "Criar novo SN" em CloudWatch/Grafana ao longo de uma semana.

## 3. Tactics — Cobertura no delta ADR-0027

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Reduce Overhead | Ramo "SN existente" PULA ~10 POSTs write (validarGeracao + gerDocProcesso + completarSnAdiantamento + finalizarDocumento). Guard `const snSelecionada = ctx.snSelecionadaDocCod !== undefined` gatilha o skip. | ✅ presente (WIN estrutural do ADR) | `RecebimentoNumerarioService.ts:425, 449, 452-460` |
| Maintain Multiple Copies of Computations (cache) | Cache client-side por `priCod`: `if (sns[processoSelecionado.priCod] !== undefined) return`. Segunda visita ao mesmo processo: 0 rede. | ✅ presente | `AlocarProcessosDialog.tsx:309` |
| Bound Execution Times | `com299/list` limitado a 1 página (`pageSize=50`, `pageNumber=1` fixo — sem loop). Piora sub-linear com o tamanho do processo. | ✅ presente | `ConexosGerDocProcessoClient.ts:1058-1097` |
| Manage Sampling Rate (pagination cap) | `pageSize` default 50, sobrescrevível via `params.pageSize`. SN por processo é low-cardinality real (Encomenda: 1-3/mês). | ✅ presente | `ConexosGerDocProcessoClient.ts:1055` |
| Limit Event Response | `fetchSNsDoProcesso` só é disparado ao SELECIONAR o processo (`useEffect` gated por `processoSelecionado`), não ao abrir o modal. Fan-out amortizado por seleção do analista. | ✅ presente | `AlocarProcessosDialog.tsx:305-306` |
| Increase Resource Efficiency | Zod `passthrough()` no envelope evita re-serialização; projeção `toSolicitacaoNumerarioListItem` reduz payload FE (13 campos → 8). | ✅ presente | `ConexosGerDocProcessoClient.ts:1119-1131` |
| Prioritize Events | `heavyRouteLimiter` está no POST de escrita; o `GET /processos/:priCod/sns` NÃO tem rate limit próprio — mas é read-only e barato. Aceitável no perfil atual. | ⚠️ parcial | `routes/recebimentos.ts:366` (sem `heavyRouteLimiter`) vs `routes/recebimentos.ts:441-444` |
| Bound Queue Sizes | N/A no delta — fluxo síncrono API Gateway-like (Express legado, sem SQS envolvido). | N/A | fluxo request/response |
| Increase Concurrency | Não aplicável ao GET singleton por processo — o gargalo é a rede Conexos, não CPU/IO local. | N/A | — |
| Increase Resources | N/A no delta — não mexe em pool/config. | N/A | — |
| Maintain Multiple Copies of Data | Cache in-memory por `priCod` na sessão do modal (cópia leve, TTL = vida do modal). Aceitável para dado de leitura de auditoria; ver F-performance-3 sobre stale-read pós "Processar". | ⚠️ parcial | `AlocarProcessosDialog.tsx:206, 309` |
| Schedule Resources | N/A no delta. | N/A | — |
| Manage Sampling Rate — descarte inteligente | N/A no delta. | N/A | — |

## 4. Findings

### F-performance-1: `pageSize=50` sem loop de paginação — processos com histórico longo truncam a lista

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times / Manage Sampling Rate
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1055-1097`
- **Evidência (objetiva)**:
  ```typescript
  const pageSize = params.pageSize ?? 50;
  // ...
  const page = await this.base.listGenericPaginated<Record<string, unknown>>(
      'com299',
      { /* ... */ pageNumber: 1, pageSize, /* ... */ },
      { filCod },
  );
  // NÃO há loop de paginação: só a página 1 é lida.
  const envelope = SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA.parse({ ...page, rows: page.rows ?? [] });
  ```
- **Impacto técnico**: Um processo com > 50 SNs elegíveis (`vldStatus∈{1,3}`) NUNCA tem as mais antigas exibidas. Como a ordem é `docCod desc`, corta as antigas — que é o comportamento razoável, mas silencioso: o envelope traz `count` e ele é ignorado. Também: `listCondPgtoPessoa` (contexto vizinho, `ConexosGerDocProcessoClient.ts:843-879`) já teve BUG idêntico corrigido este mesmo dia (2026-08-03: "o critério antigo parava na 1ª página e nunca buscava a 2ª") — o mesmo *foot-gun* está aberto aqui, só que ainda dentro do envelope da SLA de negócio.
- **Impacto de negócio**: Encomenda na Columbia gera 1-3 SNs/mês por processo (dado do próprio ADR). 50 SNs = ~1.5 ano de histórico. Aceitável hoje; risco de silent-truncation daqui a 18 meses ou em processo de comex-continuous. Analista NÃO recebe sinal ("não há mais" vs. "há e não te mostrei").
- **Métrica de baseline**: p50 esperado de SNs por processo: 2-3 (encomenda mensal); p99 esperado: ≤ 30. Corte em 50 é ~1.7× o p99 — folga estreita.

### F-performance-2: Cache de SN não é invalidado após "Processar novo SN" — próximas alocações no mesmo processo veem lista stale

- **Severidade**: P2
- **Tactic violada**: Maintain Multiple Copies of Data (staleness bound)
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:305-327` (leitura), `AlocarProcessosDialog.tsx:329-374` (processar sem invalidação)
- **Evidência (objetiva)**:
  ```typescript
  // Ao selecionar processo:
  if (sns[processoSelecionado.priCod] !== undefined) return
  // ...
  // Em `processar()` NÃO há setSns((prev) => ({ ...prev, [processo.priCod]: undefined }))
  // após um sucesso de "Criar novo SN" (que cria uma SN nova no ERP).
  ```
- **Impacto técnico**: Split-payment: analista aloca uma parte do saldo em `priCod=X` via "Criar novo SN", processa com sucesso → SN nova existe no ERP. Se ele voltar a `priCod=X` para alocar o restante, o cache in-memory ainda mostra a lista antiga (sem a SN que ELE ACABOU DE CRIAR). Ele pode acabar criando OUTRA SN em vez de baixar contra a primeira — a duplicata que o ADR-0027 D3 quer evitar (invariante I-Receb-3.b). NÃO é uma corrupção de dado, mas contradiz o próprio objetivo do ADR.
- **Impacto de negócio**: Duplicação silenciosa de SN em split-payments no mesmo processo. Só se manifesta em split multi-alocação intra-modal — janela real mas pequena. O ADR D3 fala explicitamente em "não cria segundo documento (sem duplicata)"; este cache stale é a fresta.
- **Métrica de baseline**: 0% de refetch pós-processamento hoje. Alvo: 100% de invalidação (ou re-fetch) do bucket `sns[priCod]` após `resultado.status === 'settled'` em ramo "Criar novo SN".

### F-performance-3: `GET /recebimentos/processos/:priCod/sns` sem rate limit dedicado — chamada barata mas ilimitada

- **Severidade**: P3
- **Tactic violada**: Prioritize Events / Limit Event Response
- **Localização**: `src/backend/routes/recebimentos.ts:366-394`
- **Evidência (objetiva)**:
  ```typescript
  router.get(
      '/processos/:priCod/sns',
      asyncHandler(async (req, res) => {   // <-- sem heavyRouteLimiter, sem rateLimit próprio
  ```
- **Impacto técnico**: Um cliente HTTP mal-comportado (ou uma UI com bug em `useEffect`) pode disparar N chamadas → N × `POST com299/list` no Conexos. O `ConexosBaseClient` tem `runWithRetry`, mas nada limita o *originador* (rota). Comparar com o POST de escrita (linha 441-444) que tem `heavyRouteLimiter + requireRole('admin')`.
- **Impacto de negócio**: Baixo hoje (READ barato, cache no FE evita loop natural). Vira P1 se o dialog for portado para SWR/React Query com refetch-on-focus ativado por default.
- **Métrica de baseline**: 0 req/s cap. Alvo: cap = 60 req/min por-usuário (mesmo default de rotas READ do repo, se existir; senão, `heavyRouteLimiter`).

### F-performance-4: Cache client-side é per-modal-session — reabrir modal descarta tudo

- **Severidade**: P3
- **Tactic violada**: Maintain Multiple Copies of Computations
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:255-256, 286-287, 206`
- **Evidência (objetiva)**:
  ```typescript
  // Ao ABRIR o modal ou trocar de cliente, o cache é ZERADO:
  setSns({})
  ```
- **Impacto técnico**: Analista abre modal para txn A, seleciona `priCod=3254` (busca `com299/list` de 3254 = ~500ms-2s), fecha, abre modal para txn B (mesmo cliente/mesmos processos), seleciona `priCod=3254` novamente → REBUSCA. O ganho de cache existe intra-modal, não inter-modal. Em analista que processa 5-10 transações do mesmo cliente numa manhã: cada seleção do mesmo processo recarrega.
- **Impacto de negócio**: Latência amortizada pelo analista, não pelo sistema. UX percebida como "lento e repetitivo" no fluxo real. O trade-off da simplicidade (não introduzir SWR/React Query) é defensável; melhoria opcional.
- **Métrica de baseline**: Cache-hit-ratio inter-modal: 0%. Alvo com um store leve (Zustand ou Context): ≥ 70% para o mesmo cliente na mesma sessão.

## 5. Cards Kanban

### [performance-1] Paginar `listSNsByProcesso` até esgotar o `count` (mesmo padrão de `listCondPgtoPessoa`)

- **Problema**
  > `listSNsByProcesso` lê APENAS a 1ª página do `com299/list` (pageSize=50) e ignora o `count` do envelope. Um processo com >50 SNs históricas silenciosamente perde as mais antigas na UI. Vizinho no mesmo arquivo (`listCondPgtoPessoa`) teve o MESMO bug corrigido hoje (comentário live 2026-08-03 sobre pesCod 232).

- **Melhoria Proposta**
  > Adotar o mesmo padrão de `listCondPgtoPessoa` (`ConexosGerDocProcessoClient.ts:854-873`): loop `for (pageNumber = 1; pageNumber <= TETO; ...)`, para em página vazia ou `acumulado.length >= count`. Manter `pageSize` alto (200) para minimizar round-trips no caso quente e ainda paginar quando o processo tiver > 200. Ordem `docCod desc` já garante que a 1ª página traz as mais úteis; a paginação só custa quando realmente precisa. Tactic: `Bound Execution Times` + `Manage Sampling Rate`.

- **Resultado Esperado**
  > 100% da lista de SN elegíveis exibida independente do histórico. Custo esperado: 1 round-trip Conexos para p99 dos processos (≤ 200 SNs), 2 para p99.9. Silent-truncation eliminada.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 dia — replicar loop existente, adicionar teste que verifica 2 páginas)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Cobertura de SN listadas: ~85-100% (assumindo p99=30) → 100%
  - Round-trips Conexos por chamada: 1 (p50) → 1 (p50) / 2 (p99.9)
- **Risco de não fazer**: Em 18 meses, com uso intenso, um processo comex-continuous pode passar de 50 SNs; o analista escolherá "Criar novo SN" sem saber que existe uma antiga válida — reintroduzindo a duplicata que o ADR-0027 D3 (I-Receb-3.b) proíbe.
- **Dependências**: nenhuma

### [performance-2] Invalidar cache `sns[priCod]` após "Processar" bem-sucedido em ramo "Criar novo SN"

- **Problema**
  > Após criar SN nova no ERP via "Processar", o cache in-memory `sns[priCod]` no dialog continua com a lista antiga. Se o analista alocar outra fatia do saldo no mesmo processo, ele não vê a SN que acabou de gerar — pode duplicar. Contradiz o objetivo do ADR-0027 D3 (I-Receb-3.b, "sem duplicata").

- **Melhoria Proposta**
  > Em `AlocarProcessosDialog.tsx:329-374` (função `processar`), após `resultado.status === 'settled'` E `snDocCod === undefined` (ramo "Criar novo SN"), invalidar o bucket: `setSns((prev) => { const c = { ...prev }; delete c[processo.priCod]; return c })`. O useEffect subsequente (linha 305-327) refetch quando o processo for re-selecionado. Alternativa: fazer optimistic append usando o `resultado.snDocCod`. Tactic: `Maintain Multiple Copies of Data (bounded staleness)`.

- **Resultado Esperado**
  > 100% de refresh do painel de SN no processo alterado após "Criar novo SN" quitar. Elimina a janela de duplicata em split-payment intra-modal.

- **Tactic alvo**: Maintain Multiple Copies of Data
- **Severidade**: P2
- **Esforço estimado**: S (≤ 0.5 dia — 3 linhas + teste)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - % de decisões de "Criar novo SN" em split-payment com lista atualizada: 0% → 100%
  - Duplicatas silenciosas em split-payment intra-modal: risco atual "possível" → 0
- **Risco de não fazer**: SN duplicadas em fluxo split — infringe invariante I-Receb-3.b registrado no ADR-0027.
- **Dependências**: nenhuma

### [performance-3] Aplicar rate limit dedicado ao `GET /processos/:priCod/sns`

- **Problema**
  > Rota nova sem rate limit próprio. Cada chamada é 1× `POST com299/list` no Conexos (p95 2-4s). Um bug de `useEffect` no FE ou um cliente HTTP mal-comportado pode saturar a sessão Conexos do tenant.

- **Melhoria Proposta**
  > Adicionar `readRouteLimiter` (ou criar um limiter de leitura leve — 60 req/min por usuário) na rota `GET /processos/:priCod/sns` em `routes/recebimentos.ts:366`. Reusar o middleware que já existe no repo. Tactic: `Limit Event Response`.

- **Resultado Esperado**
  > Rota READ com teto explícito: 60 req/min/usuário → 429 acima disso. Sessão Conexos protegida contra loop acidental. Um `useEffect` bugado vira `429` em vez de N × 2s de Conexos.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S (≤ 0.5 dia — decorator middleware)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Rate limit rota READ: ausente → 60 req/min/usuário
  - Chamadas em burst absurdo (>100 req/min): permitidas → bloqueadas
- **Risco de não fazer**: Baixo até um bug de FE (ou porte para SWR/React Query com refetch-on-focus) transformar o `useEffect` num loop.
- **Dependências**: nenhuma — verificar se `heavyRouteLimiter` é apropriado ou precisa de `readRouteLimiter` novo (Regis-Availability revisa também).

### [performance-4] Elevar cache de SN de per-modal-session para per-tab-session (leve)

- **Problema**
  > Cache atual é local ao `AlocarProcessosDialog`. Analista que processa 5-10 transações do mesmo cliente numa manhã revisita os mesmos processos → refetch em cada abertura de modal. Cache-hit inter-modal: 0%.

- **Melhoria Proposta**
  > Extrair o cache para um store de módulo (React Context ou Zustand em `src/frontend/lib/recebimentos-cache.ts`) com TTL curto (5min) e key `${priCod}:${filCod}`. Invalidar no logout/troca de tenant e no evento "processar novo SN" (ver card `performance-2`). Tactic: `Maintain Multiple Copies of Computations`.

- **Resultado Esperado**
  > Cache-hit inter-modal para o mesmo `(priCod, filCod)` em ≤ 5min: 0% → ≥ 70% em analista real. p95 de latência de abertura do painel de SN em sessão longa: ~2s → ~50ms.

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P3
- **Esforço estimado**: M (2-3 dias — store + testes + coordenação com card `performance-2`)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Cache-hit-ratio inter-modal: 0% → ≥ 70%
  - Chamadas `com299/list` por analista/dia: baseline → -50%
- **Risco de não fazer**: UX percebida como "lenta e repetitiva" — cosmético. Não bloqueia.
- **Dependências**: `performance-2` (a invalidação pós-processamento tem que coexistir com o store maior).

## 6. Notas do agente

- **Escopo cirúrgico**: revisei APENAS os arquivos do delta ADR-0027 (`_shared-metrics.md:9-16`). Não auditei o restante da Frente IV.
- **WIN estrutural do ADR reconhecido**: o skip do bloco `validarGeracao → gerarDocProcesso → completarSnAdiantamento → finalizarDocumento` (evidenciado em `RecebimentoNumerarioService.ts:425, 449, 452`) é a maior tactic de `Reduce Overhead` do delta — economiza ~10 POSTs write no Conexos e evita 2 GET-releitura. Não gera card porque já é o comportamento entregue; contabilizado nas métricas da seção 2.
- **Métricas não coletadas localmente**: latência real Conexos, First Load JS (Next build), CloudWatch. Recomendação: instrumentar `duration_ms{endpoint,ramo}` no `ConexosBaseClient.postGeneric` para comparar `ramo=sn-existente` vs `ramo=sn-nova` em produção após pousar.
- **Cross-QA detectado**:
  - `performance-2` (invalidação de cache) → **Fault-Tolerance** (invariante I-Receb-3.b duplicata) e **Modifiability** (contrato do estado do modal).
  - `performance-1` (paginação) → **Availability** (mesmo padrão que `listCondPgtoPessoa` teve bug de omissão — o consolidator pode agrupar).
  - `performance-3` (rate limit) → **Availability** (proteção da sessão Conexos) e **Security** (DoS-resistance).
