---
qa: Performance
qa_slug: performance
run_id: 2026-09-24-1448-sispag-boletos-dda
agent: qa-performance
generated_at: 2026-09-24T14:48:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Escopo desta revisão: só o delta da aba "Boletos DDA (fin124)" do SISPAG (PR #85). O uso quente é
analista abrindo a aba (ou trocando escopo A vencer ↔ Todos) e o cadenced é o job diário
`ingest-boletos-dda` (mais o botão manual "Atualizar DDA"). Único endpoint público novo:
`GET /sispag/boletos-dda`.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia | Abre aba "Boletos DDA" em escopo `todos` (pool completo) | `GET /sispag/boletos-dda?escopo=todos` → `BoletoDdaService.listar` → 4 queries + `ConsolidacaoBoletoDda.consolidar` → resposta JSON | Produção, snapshot do dia (~24 mil boletos, +250/dia), Postgres remoto | Devolver a consolidação a tempo do analista não perceber travamento | p95 tempo-para-primeira-linha ≤ 1500 ms; p95 tempo-para-terminar-download ≤ 3000 ms; payload gzipped ≤ 1500 KB |
| Job noturno (`ingest-boletos-dda`) | Sincronização diária do pool `fin124` (~162 arquivos, 60 dias de releitura) | `BoletoDdaService.sincronizar` → 1 + N chamadas Conexos, transação por arquivo | Cron/manual, 1 execução por dia + botão | Terminar antes do próximo turno, sem estourar sessões do Conexos | duração ≤ 5 min; falhas por arquivo ≤ 1% |

## 2. Métricas observadas

Baseline coletado em `_shared-metrics.md` (backend local `npm run dev:local`, Postgres em container —
lê como piso otimista; a WAN de produção só piora).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `GET /sispag/boletos-dda?escopo=a-vencer` (1.665 rows) | 97 ms | ≤ 300 ms | ✅ | `_shared-metrics.md` |
| `GET /sispag/boletos-dda?escopo=todos` (24.137 rows) | 393 ms | ≤ 800 ms (backend) | ⚠️ | `_shared-metrics.md` |
| Payload JSON estimado, escopo `todos` (não medido) | ~8,5 MB uncompressed / ~2,0 MB gzip (estimativa: 24.137 × ~350 B/linha + ~250 KB de candidatos em 781 rows não-VINCULADO) | ≤ 1.500 KB gzipped | ❌ | Estimativa a partir de `BoletoDdaConsolidado` + `_shared-metrics.md` |
| Cache hit ratio de `listar` (dados só mudam em `sincronizar`) | 0 % (consolidação recomputa em toda request) | ≥ 90 % entre sincronizações | ❌ | `src/backend/domain/service/sispag/BoletoDdaService.ts:53-67` |
| Consolidação em memória: complexidade | O(N + M + N·k) com k = tamanho médio do bucket `abertosPorValor[centavos]`; pior visto k = 19 | manter O(N + M) no caminho comum | ✅ | `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:53-105` |
| Sincronização completa medida | 162 arquivos, 24.137 boletos, 0 falhas | ≤ 5 min, ≤ 1 % falhas | ✅ | `_shared-metrics.md` |
| Concorrência de leitura Conexos no sync | 3 (`FANOUT_LIMIT`) | 3–5 (usuário `MPS_FRANCINEI` já saturando `MAX_SESSIONS`) | ✅ | `BoletoDdaService.ts:25`; nota de `LOGIN_ERROR_MAX_SESSIONS` no `_shared-metrics.md` |
| Índices explícitos em `boleto_dda` | `idx_boleto_dda_vencimento`, `idx_boleto_dda_valor` | + parcial para `WHERE a.cancelado_em IS NULL` sob JOIN | ⚠️ | `src/backend/migrations/0062_boleto_dda.sql:42-43` |
| Filtro/paginação no cliente sobre 24k linhas | `useTabelaFiltro` re-filtra tudo por tecla; `buscaDe` chamado dentro do `.filter()` gera ~24k strings/tecla | pré-computar `buscaDe` uma vez por item | ⚠️ | `src/frontend/app/permutas/components/tabela-filtro.tsx:50-63` + `BoletosDdaTab.tsx:75-88, 169` |
| Cold start / bundle size | ⚠️ **Não medível localmente**: não há Lambda/Terraform neste repo (deploy Render, ver `CLAUDE.md`). Métricas de cold start e bundle Lambda **não se aplicam** ao delta. | | N/A | `CLAUDE.md` (seção "Estado Atual vs. Alvo") |
| Compressão HTTP (gzip/br) na resposta | ⚠️ **Não medível localmente**: depende do Express `compression` middleware / proxy Render — não vi o middleware sendo instalado nas rotas SISPAG. Recomendação: confirmar `compression()` no `app.use` do backend e o `Content-Encoding` no response. | ativado | ⚠️ | `src/backend/http/**` (não inspecionado — fora do delta) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — API request/response, não há stream de eventos amostráveis no delta. | N/A | — |
| Limit Event Response | Sem paginação server-side em `GET /boletos-dda?escopo=todos`: devolve 24k linhas de uma vez; o front pagina 20/vez em memória. | ❌ ausente | `BoletoDdaRepository.ts:115-128` (sem `LIMIT/OFFSET`), `BoletosDdaTab.tsx:169` (`useTabelaFiltro` recebe o array inteiro). |
| Prioritize Events | Rate limiter `heavyRouteLimiter` na `POST /sincronizar` (protege do reprocess concurrent), leitura ordinária não é limitada. Coerente com o padrão do resto do SISPAG. | ✅ presente | `routes/sispag.ts:434-446` |
| Reduce Overhead | Consolidação é pura, sem I/O no loop; `ConsolidacaoBoletoDda` monta `Map` por chave e por valor uma única vez. `buscaDe` no frontend, ao contrário, é chamado dentro do `.filter()` a cada tecla. | ⚠️ parcial | `ConsolidacaoBoletoDda.ts:79-85` (backend OK); `BoletosDdaTab.tsx:75-88` + `tabela-filtro.tsx:50-63` (frontend re-alocando strings). |
| Bound Execution Times | Sync tem timeout implícito só no client Conexos (via `runWithRetry` no `ConexosBaseClient`); `listar` não tem timeout explícito. Consolidação é O(N·k) com k ≤ 19 observado. | ⚠️ parcial | `ConexosDdaClient.ts:112-143` (loop com `MAX_PAGINAS = 60` bounded); `BoletoDdaService.ts:53-67`. |
| Increase Resource Efficiency | Upsert em chunks de 200; releitura só dos 60 dias mais recentes; queries usam índices. | ✅ presente | `BoletoDdaRepository.ts:8, 71-73`; `BoletoDdaService.ts:30, 91-98`. |
| Increase Resources | N/A (não há dial de infra no delta; RDS/pool fica fora deste PR). | N/A | — |
| Increase Concurrency | Sync usa `BoundedConcurrency` limite 3. Coerente com `LOGIN_ERROR_MAX_SESSIONS` observado (usuário compartilhado já está no teto). | ✅ presente | `BoletoDdaService.ts:25, 100-108` |
| Maintain Multiple Copies of Computations | **Ausente**: o payload consolidado depende só de `boleto_dda*` + `titulo_a_pagar` ativos + `lote_pagamento_item` de lotes não-cancelados. Entre duas execuções de `sincronizar` o resultado é praticamente estável (mudanças só via `POST /lotes/**`), mas cada `GET` recomputa. | ❌ ausente | `BoletoDdaService.ts:53-67` |
| Maintain Multiple Copies of Data | O próprio snapshot `boleto_dda*` **é** cópia local do `fin124` — a tática já está aplicada no design (motivação da migration 0062). | ✅ presente | `migrations/0062_boleto_dda.sql:1-13` |
| Bound Queue Sizes | Sync respeita `FANOUT_LIMIT=3` e advisory lock `726354820` (uma sync por vez). | ✅ presente | `BoletoDdaService.ts:23-25, 72-80` |
| Schedule Resources | Advisory lock exclusivo por operação de ingest (não colide com permutas/pagamentos). | ✅ presente | `BoletoDdaService.ts:23` (comentário e valor da chave). |

## 4. Findings (achados)

### F-performance-1: `escopo=todos` devolve o pool inteiro (~8,5 MB estimado) sem paginação server-side

- **Severidade**: P1 (payload cresce ~1 arquivo/dia; sem paginação server-side, cada abertura da aba paga esse custo inteiro na WAN e o frontend materializa em memória).
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/domain/repository/sispag/BoletoDdaRepository.ts:115-128`, `src/backend/domain/service/sispag/BoletoDdaService.ts:53-67`, `src/backend/routes/sispag.ts:414-430`, `src/frontend/app/sispag/components/BoletosDdaTab.tsx:124-141, 169`.
- **Evidência (objetiva)**:
  ```sql
  SELECT b.ddc_cod, b.dit_cod, b.numero, b.valor, ..., a.nome AS arquivo, a.importado_em
  FROM boleto_dda b JOIN boleto_dda_arquivo a ON a.ddc_cod = b.ddc_cod
  WHERE a.cancelado_em IS NULL
    AND ($desde::date IS NULL OR b.vencimento >= $desde::date)
  ORDER BY b.vencimento ASC NULLS LAST, b.ddc_cod DESC, b.dit_cod ASC;
  -- Sem LIMIT/OFFSET.
  ```
  ```
  # _shared-metrics.md
  GET /sispag/boletos-dda?escopo=todos → 200, 24.137 boletos, 393 ms (backend local)
  ```
- **Impacto técnico**: em backend local + Postgres em container o número é 393 ms; em produção o Postgres é remoto (Supabase) e o payload trafega pela internet. Estimativa de tamanho: ~350 B/linha (JSON de `BoletoDdaConsolidado` incluindo `codbar`, `linhaDigitavel`, `arquivo`) × 24.137 = **~8,5 MB uncompressed**, ~2,0 MB gzipped. Em uplink de 5 Mbit/s isso é ~16 s de transferência. Se o backend Express não tiver `compression()` ligado, sobe para ~14 s em uplink de 5 Mbit/s (raw) e ~1,4 s em 50 Mbit/s.
- **Impacto de negócio**: aba "Boletos DDA (Todos)" é usada esporadicamente (pool inteiro, inclui vencidos), mas quem abre é analista que já está segurando um pagamento — 3–15 s de tela branca a cada troca de escopo mina a confiança e leva a analista a evitar a aba. Cresce ~250 boletos/dia (v0.42.0 mediu 24k; em 1 ano será ~40k, +67 % no payload).
- **Métrica de baseline**: 24.137 linhas, 393 ms backend local, ~8,5 MB payload estimado (não comprimido). Alvo: primeira página server-side ≤ 200 KB e < 300 ms p95 em produção.

### F-performance-2: `listar` recomputa consolidação a cada request; snapshot só muda em `sincronizar`

- **Severidade**: P2 (a-vencer é rápido; todos ainda é rápido em local, mas cache elimina 4 queries + toda a montagem por request e escala grátis com o crescimento).
- **Tactic violada**: Maintain Multiple Copies of Computations
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:53-67`.
- **Evidência (objetiva)**:
  ```ts
  public listar = async (input: { escopo: BoletoDdaEscopo }): Promise<BoletosDdaResposta> => {
      const [boletos, titulos, titulosEmLote, sincronizadoEm] = await Promise.all([
          this.repo.listBoletos(vencimentoDesde ? { vencimentoDesde } : {}),
          this.tituloRepo.listAtivos(),
          this.loteRepo.listTitulosEmLotesAbertos(),
          this.repo.ultimaSincronizacao(),
      ]);
      return { boletos: this.consolidacao.consolidar({ boletos, titulos, titulosEmLote }), ... };
  };
  ```
- **Impacto técnico**: cada `GET` roda 4 queries + O(N + M + N·k) de consolidação. `boleto_dda` só muda em `sincronizar` (1 vez/dia em regime), `titulo_a_pagar` só muda no `IngestaoPagamentosService` (também cadência de horas). Cache em memória do serviço (`@singleton()`) invalidado por `max(sincronizado_em)` de `boleto_dda_arquivo` + `max(atualizado_em)` de `titulo_a_pagar` reduz a request a **uma** query barata de comparação de timestamp e um retorno da resposta já montada.
- **Impacto de negócio**: analista pode abrir a aba 10× no dia (troca de escopo, F5, sincronizar); hoje cada abertura paga 100–400 ms + WAN. Cache elimina isso e blinda contra picos concomitantes (2+ analistas).
- **Métrica de baseline**: hoje 100 % das requests recomputam. Alvo: ≥ 90 % de cache hit entre execuções de `sincronizar`; p95 de request cacheada ≤ 30 ms (só o compare-and-serve).

### F-performance-3: `useTabelaFiltro` filtra 24k rows a cada tecla e `buscaDe` é reconstruído no `.filter()`

- **Severidade**: P2 (perceptível em máquinas fracas; degrada ainda mais quando `Todos` cresce).
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/frontend/app/sispag/components/BoletosDdaTab.tsx:75-88, 169`, `src/frontend/app/permutas/components/tabela-filtro.tsx:50-63`.
- **Evidência (objetiva)**:
  ```ts
  // BoletosDdaTab.tsx
  const buscaDe = (b: BoletoDda): string =>
      [b.numero, b.codbar, b.linhaDigitavel, b.arquivo, ...].filter(Boolean).join(' ');
  // ...
  const aba = useTabelaFiltro(filtradosSituacao, filialDe, buscaDe);

  // tabela-filtro.tsx
  const filtrados = React.useMemo(
      () => items.filter((x) =>
          (filial === 'todas' || ...) &&
          (b === '' || getBuscaTexto(x).toLowerCase().includes(b))),
      [items, filial, b],
  );
  ```
- **Impacto técnico**: `getBuscaTexto` é chamado dentro do `.filter()` uma vez por item, a cada re-execução do memo. Com `items.length = 24.137`, digitar `p-e-d-r-o-n-i` são 7 memos × 24k × (concat + toLowerCase + includes) ≈ 168k builds de string. Em V8 moderno é sub-100 ms/tecla, mas em máquinas do escritório (baseline "Chromebook analista") vira input lag. A tática certa é pré-computar `buscaSearchIndex` no `useMemo(() => items.map(x => ({item: x, texto: getBuscaTexto(x).toLowerCase()})), [items])`.
- **Impacto de negócio**: percepção de aba "travando ao buscar" — o analista digita, o campo demora a responder e o instinto é atribuir isso à tela toda, não ao filtro. Piora com o crescimento do pool.
- **Métrica de baseline**: 24.137 chamadas de `buscaDe` por tecla (estimativa), pior caso ~5 ms/tecla em máquina de dev; alvo: 24k chamadas UMA vez por change de `items`, e ~24k `String.includes` por tecla (≤ 1 ms).

### F-performance-4: releitura de 60 dias sempre inclui arquivos já `canceladoEm`

- **Severidade**: P3 (economia sob 5–10 chamadas Conexos/dia, com custo de contenção do usuário compartilhado `MPS_FRANCINEI`).
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:87-108`.
- **Evidência (objetiva)**:
  ```ts
  const novos = arquivos.filter((a) => !conhecidos.has(a.ddcCod));
  const relidos = arquivos.filter(
      (a) => conhecidos.has(a.ddcCod) && (a.importadoEm ?? 0) >= corte,
  );
  const alvo: ArquivoDda[] = [...novos, ...relidos];
  ```
- **Impacto técnico**: `relidos` filtra por `importadoEm`, não por `canceladoEm`. Arquivo cancelado no `fin124` é terminal: o Conexos não vai mais grudar vínculo nele. Rele-lo consome uma chamada Conexos e uma transação Postgres à toa. Com `RELEITURA_DIAS=60` e a taxa observada, isso é 5–10 arquivos/dia.
- **Impacto de negócio**: reduz pressão sobre `MAX_SESSIONS` do usuário compartilhado (o `_shared-metrics.md` já registra `LOGIN_ERROR_MAX_SESSIONS` toda sessão nova), encurta a janela do botão manual "Atualizar DDA" (analista aguardando o toast).
- **Métrica de baseline**: no snapshot medido (162 arquivos, `_shared-metrics.md`) provavelmente ≤ 10 cancelados; alvo: 0 chamadas Conexos para arquivo `canceladoEm != null` já conhecido.

### F-performance-5: filtro `WHERE a.cancelado_em IS NULL` sem índice em `boleto_dda_arquivo.cancelado_em`

- **Severidade**: P3 (irrelevante em 162 arquivos; vira relevante em 5+ anos ou se o filtro migrar para o `boleto_dda`).
- **Tactic violada**: Increase Resource Efficiency (índice)
- **Localização**: `src/backend/migrations/0062_boleto_dda.sql:14-43`, `src/backend/domain/repository/sispag/BoletoDdaRepository.ts:120-124`.
- **Evidência (objetiva)**:
  ```sql
  -- 0062_boleto_dda.sql (só estes dois índices):
  CREATE INDEX IF NOT EXISTS idx_boleto_dda_vencimento ON boleto_dda (vencimento);
  CREATE INDEX IF NOT EXISTS idx_boleto_dda_valor ON boleto_dda (valor);
  ```
  A query em `listBoletos` faz JOIN e filtra `a.cancelado_em IS NULL`. Índice `idx_boleto_dda_valor` **nunca** é usado no caminho de leitura (nenhuma query filtra por valor no repo — o casamento por valor é em memória no `ConsolidacaoBoletoDda`).
- **Impacto técnico**: (a) `idx_boleto_dda_valor` é peso morto em disco / dias de VACUUM; (b) se um dia surgir muito arquivo cancelado, o `EXISTS` seq scan em `boleto_dda_arquivo` vira gargalo.
- **Impacto de negócio**: mínimo hoje.
- **Métrica de baseline**: 24.137 rows, 393 ms backend local — a maior parte do tempo é serialize + transferência, não plano. Alvo: manter EXPLAIN sub-100 ms em backend com 100k rows.

### F-performance-6: compressão HTTP não verificada no caminho do delta

- **Severidade**: P2 (com gzip habilitado, o payload de 8,5 MB cai para ~2 MB e o F-performance-1 se torna tolerável; sem gzip, F-1 é P1 real).
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/http/**` (fora do delta — dependência transversal); `routes/sispag.ts:414-430`.
- **Evidência (objetiva)**: o delta adiciona a rota sem se pronunciar sobre `Content-Encoding`. Não vi o middleware `compression` sendo `app.use()`-ado nem `Accept-Encoding` sendo tratado nas rotas — só uma inspeção do bootstrap Express (fora deste PR) resolve. Declaração de não-medível conforme regra do template.
- **Impacto técnico**: uma rota nova que devolve 8,5 MB sem gzip é o cenário do incidente clássico "página abre em 15 s em cliente WAN, funciona em 400 ms no dev".
- **Impacto de negócio**: idem F-1.
- **Métrica de baseline**: ⚠️ **Não medível** neste ciclo (fora do delta). Verificação recomendada: `curl -sI -H 'Accept-Encoding: gzip' http(s)://.../sispag/boletos-dda?escopo=todos | grep -i content-encoding`.

## 5. Cards Kanban

### [performance-1] Paginar `GET /sispag/boletos-dda?escopo=todos` no servidor

- **Problema**
  > O endpoint devolve o pool inteiro (24.137 linhas hoje, ~+250/dia) em uma resposta única. O front usa `useTabelaFiltro` para paginar/filtrar em memória, mas paga integralmente o custo de rede e desserialização a cada abertura da aba. Payload estimado ~8,5 MB uncompressed / ~2 MB gzipped. Em WAN típica de escritório (5–50 Mbit/s), o TTLB varia entre 1,4 s e 14 s dependendo da compressão.

- **Melhoria Proposta**
  > Adicionar parâmetros `page`/`pageSize` e `situacao?` em `boletosDdaSchema`, propagar até `BoletoDdaRepository.listBoletos` como `LIMIT/OFFSET` seguindo o Dynamic WHERE Pattern do CLAUDE.md. Manter a agregação de contagens por situação em uma segunda query barata (COUNT por `situacao` derivada). Front alinhado: paginação passa a ser controlada (fetch por página) em vez de client-side. Alternativa mais barata (se paginação server-side custar demais): manter cliente único mas devolver apenas as colunas necessárias e mover `codbar`/`linhaDigitavel` para endpoint separado `GET /sispag/boletos-dda/:ddcCod/:ditCod/detalhe` (LGPD friendly, reduz payload em ~30 %).

- **Resultado Esperado**
  > Payload da primeira página cai de ~8,5 MB para ≤ 200 KB uncompressed; p95 tempo-para-primeira-linha em produção cai de estimado 1,5–15 s para ≤ 300 ms. Aba permanece funcional com o pool crescendo para 100k+ boletos.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — mexer em service, repo, rota, contrato do `lib/sispag.ts` e frontend
- **Findings relacionados**: F-performance-1, F-performance-6
- **Métricas de sucesso**:
  - Payload por request (uncompressed): ~8,5 MB → ≤ 200 KB
  - p95 TTLB `todos` em produção: estimado 1,5–15 s → ≤ 300 ms
  - Memória JS heap da aba: ~10 MB de array → ≤ 500 KB
- **Risco de não fazer**: em 12 meses o payload passa dos 14 MB e a aba fica inutilizável em 3G/WAN pobre; a analista deixa de usar e volta ao Excel.
- **Dependências**: nenhuma (independente de F-2).

### [performance-2] Cachear a consolidação de `BoletoDdaService.listar` por `sincronizadoEm`

- **Problema**
  > `listar` roda 4 queries + O(N + M + N·k) de consolidação em toda request, mas os dados só mudam em `sincronizar` (uma vez ao dia em regime) e em transições de lote (raras entre requests). 100 % das aberturas de aba são cache miss.

- **Melhoria Proposta**
  > No `@singleton()` `BoletoDdaService`, guardar `Map<escopo, { payload, versao }>` onde `versao = max(sincronizado_em de boleto_dda_arquivo) + max(atualizado_em de titulo_a_pagar) + max(atualizado_em de lote_pagamento)`. Cada request faz **uma** query barata (`SELECT max(...)`) e retorna o payload cacheado se `versao` bateu. Invalidação natural via `sincronizar` sem sinal explícito. Bass tactic: **Maintain Multiple Copies of Computations**. Alternativa: materializar em coluna gerada (JSONB) na tabela `boleto_dda_arquivo` — mais complexo, ganhar só se a app ficar multi-instância antes do Redis.

- **Resultado Esperado**
  > p95 de request cacheada cai de ~100–400 ms para ≤ 30 ms; carga de queries do endpoint diminui em ≥ 90 %.

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Cache hit ratio entre execuções de `sincronizar`: 0 % → ≥ 90 %
  - p95 do endpoint em produção: estimado 200–800 ms → ≤ 100 ms
  - Queries por request: 4 → 1 (a de comparação de `versao`)
- **Risco de não fazer**: crescimento linear do custo do endpoint com o pool; 2 analistas em pico já colocam pressão no Postgres remoto.
- **Dependências**: melhor implementar **antes** de performance-1 se este for adiado — mitiga o problema principal sem quebrar o contrato.

### [performance-3] Pré-computar o índice de busca do `BoletosDdaTab`

- **Problema**
  > A cada tecla o `useTabelaFiltro` re-executa `getBuscaTexto(x)` para cada item na lista — cerca de 24.137 chamadas × N teclas, cada chamada alocando um array e uma string nova. Perceptível como input lag no campo de busca em máquinas do escritório.

- **Melhoria Proposta**
  > Em `BoletosDdaTab.tsx`, envolver os itens em um `useMemo` que pré-calcula `{ boleto, textoBusca: buscaDe(boleto).toLowerCase() }` a partir de `dados?.boletos`. Passar essa lista pronta ao `useTabelaFiltro` (aceitar um `getBuscaTexto` que só faça `x => x.textoBusca`). Bass tactic: **Reduce Overhead** (eliminar trabalho repetido — a string de busca só depende do boleto). Zero impacto de contrato.

- **Resultado Esperado**
  > Custo por tecla cai de O(N × concat) para O(N × includes); tempo de resposta do campo de busca em máquinas de referência ≤ 16 ms/tecla (uma frame).

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Chamadas de `buscaDe`/tecla: 24.137 → 0 (só uma vez por mudança de `dados`)
  - Long tasks (>50 ms) no Chrome Performance ao digitar "pedroni": esperado hoje 1–3 → 0
- **Risco de não fazer**: analista experimenta a tela como "lenta" e evita a busca — fica clicando nos filtros de situação, o que retira o valor central da aba.
- **Dependências**: none.

### [performance-4] Pular re-leitura de arquivos DDA já `canceladoEm` no sync

- **Problema**
  > A releitura de 60 dias inclui arquivos com `canceladoEm != null`. Esses arquivos são terminais no `fin124` — o Conexos não vai mais gravar vínculo neles. Cada re-leitura é uma chamada Conexos + uma transação Postgres desnecessária, e o usuário `MPS_FRANCINEI` já satura `MAX_SESSIONS`.

- **Melhoria Proposta**
  > No `listArquivosSincronizados` do repo, devolver também `canceladoEm`. Em `executarSincronizacao`, incluir em `relidos` só arquivos cujo `canceladoEm` local ainda seja `null` (o `canceladoEm` do payload atual do `fin124/list` continua sendo respeitado — arquivos novos, ou que ficaram cancelados na última janela, entram normalmente). Bass tactic: **Increase Resource Efficiency**.

- **Resultado Esperado**
  > Chamadas Conexos/sync caem em 5–10 unidades (medido no snapshot atual); duração do "Atualizar DDA" cai proporcionalmente e a pressão sobre `MAX_SESSIONS` diminui.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Chamadas Conexos por execução completa de `sincronizar`: 162 → ~152–157
  - Toasts `LOGIN_ERROR_MAX_SESSIONS` observados: reduzir em ao menos 5 %
- **Risco de não fazer**: baixo — só desperdício.
- **Dependências**: none.

### [performance-5] Trocar `idx_boleto_dda_valor` por índice parcial em `arquivo.cancelado_em`

- **Problema**
  > `idx_boleto_dda_valor` não é usado pelo código (todo casamento por valor é em memória no `ConsolidacaoBoletoDda`); é peso morto de disco/VACUUM. Já o filtro `a.cancelado_em IS NULL` não tem índice — hoje 24k rows são triviais, mas em 3 anos (~200k rows) o plano do JOIN degrada.

- **Melhoria Proposta**
  > Numa migration nova (não editar 0062): `DROP INDEX idx_boleto_dda_valor;` + `CREATE INDEX idx_boleto_dda_arquivo_ativo ON boleto_dda_arquivo (ddc_cod) WHERE cancelado_em IS NULL;`. Bass tactic: **Increase Resource Efficiency**. Reavaliar `EXPLAIN ANALYZE` do `listBoletos` antes/depois.

- **Resultado Esperado**
  > Menos um índice desnecessário; plano do `listBoletos` com filtro `cancelado_em IS NULL` usa o index para o hash join.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - `pg_stat_user_indexes.idx_scan` do `idx_boleto_dda_valor` (hoje 0): índice removido
  - EXPLAIN da `listBoletos` com 200k rows sintéticos: < 100 ms
- **Risco de não fazer**: nenhum imediato; débito.
- **Dependências**: valida em staging antes.

### [performance-6] Confirmar (e, se preciso, ativar) compressão HTTP no caminho SISPAG

- **Problema**
  > A rota nova devolve payload potencialmente ~8,5 MB. Se o Express não estiver com `compression()` no `app.use`, cada abertura da aba baixa isso raw. É a diferença entre "aba usável em 1,5 s em 50 Mbit/s" e "aba trava por 15 s em 5 Mbit/s".

- **Melhoria Proposta**
  > Rodar `curl -sI -H 'Accept-Encoding: gzip'` contra a rota em produção e conferir `Content-Encoding`. Se ausente, adicionar `compression()` no bootstrap Express (fora do delta desta feature, mas o gate exige verificação já que a rota nasce cliente-do-problema). Bass tactic: **Reduce Overhead**.

- **Resultado Esperado**
  > `Content-Encoding: gzip` (ou `br`) confirmado; TTLB de `todos` em WAN 5 Mbit/s cai de estimado ~14 s para ~3,5 s.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 dia) — se o middleware já existir, é só verificar em produção; se não, é uma linha + reinício.
- **Findings relacionados**: F-performance-6, F-performance-1
- **Métricas de sucesso**:
  - `Content-Encoding` no response de `/sispag/boletos-dda?escopo=todos`: ausente → `gzip`/`br`
  - Payload transferido: ~8,5 MB → ~2 MB
- **Risco de não fazer**: se performance-1 for adiado, esta é a mitigação barata que impede a aba de ser tela branca no primeiro cliente WAN ruim.
- **Dependências**: precisa de acesso ao ambiente Render para conferir o middleware.

## 6. Notas do agente

- Escopo respeitado: só o delta de PR #85. Não medi cold start/bundle Lambda porque este repo não tem Lambda/Terraform (ver `CLAUDE.md` "Estado Atual vs. Alvo") — declarei explicitamente na tabela 2.
- Payload em bytes é **estimativa** derivada da interface `BoletoDdaConsolidado` + contagens do `_shared-metrics.md`; a medição real (`curl -w '%{size_download}'`) contra o backend local resolve em 1 minuto, mas está fora do que dispus neste ciclo com `--quick`.
- Cross-QA para o `qa-consolidator`:
  - `[performance-1]` (paginação server-side) tangencia **Security**: reduz a superfície de exfiltração de `codbar`/`linhaDigitavel` num loop de curl (o guard `requireRole('admin')` já existe, mas menos dados por request = menos dados por sessão comprometida).
  - `[performance-6]` (compressão HTTP) tangencia **Availability / Deployability**: um middleware ausente no bootstrap do Express afeta TODAS as rotas do backend, não só esta.
  - `[performance-5]` (índices) tangencia **Modifiability**: é dívida de "schema as code" — o índice inútil foi criado sem uso planejado; hábito de revisar EXPLAIN antes de commitar índice novo.
