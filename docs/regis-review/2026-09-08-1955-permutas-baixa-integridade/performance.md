---
qa: Performance
qa_slug: performance
run_id: 2026-09-08-1955
agent: qa-performance
generated_at: 2026-09-08T19:55:00-03:00
scope: backend
score: 7.5
findings_count: 2
cards_count: 2
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista(s) da Columbia disparando `POST /permutas/adiantamentos/:docCod/reconciliar` ou `POST /permutas/reconciliar-lote` em paralelo (dois cliques, dois operadores, `/reconciliar-lote` rodando enquanto o painel atualiza) | 2–5 baixas simultâneas de adtos **distintos** no mesmo servidor Render, cada uma tomando um client dedicado do pool Postgres via `withAdvisoryLock` e disparando 5+ chamadas Conexos com timeout de 40 s | `ReconciliacaoPermutaService.reconciliar` + `PostgreeDatabaseClient.withAdvisoryLock` + pool `pg` compartilhado (max=5) | operação normal, baixo throughput (~35 execuções/mês) mas alta duração unitária (baixa multi-título pode chegar a ~4 min worst-case) | latência p95 do próprio `/reconciliar` estável; outras queries do servidor (painel, health-check, jobs) não esperam pelo pool nem estouram `connectionTimeoutMillis=5000` | ≥ 2 reconciliações concorrentes de adtos distintos convivem com painel atualizando **sem** timeout de aquisição de conexão; p95 do painel < 800 ms mesmo durante `/reconciliar-lote` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `pg.Pool.max` | **5** | ≥ (concorrência esperada de escritas + folga p/ leituras) — aqui ≥ 6 | ⚠️ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26` |
| `pg.Pool.connectionTimeoutMillis` | **5000 ms** | 5000 ms (razoável p/ tempo humano de request) | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:28` |
| Timeout HTTP Conexos (por chamada) | **40 000 ms** | 30–60 s (compat. com ERP lento) | ✅ | `src/backend/services/conexos.ts:121` |
| Chamadas Conexos por par adto→invoice (1 título) | **1** (`listTitulosAPagar`) + **1** (`criarBordero`, 1× por lote de invoices do adto) + **4** por título (`validarTituloBaixa`, `validarTituloPermuta`, `atualizarValorLiquido`, `gravarBaixaPermuta`) = **~6** | não é meta reduzir (handshake do ERP) | ✅ | `ReconciliacaoPermutaService.ts:343,478,743,778,809,841` |
| Duração pior-caso de UM `reconciliar` (1 adto, 1 invoice, 1 título, tudo no timeout) | **~240 s** (`6 × 40 s`) — sem contar retry do `RetryExecutor` de conexão de DB | não excede o timeout de proxy Render (documentado como 100 s p/ HTTP síncrono) | ❌ | derivada dos itens acima |
| Duração de UM par no ambiente feliz (produção 2026-06-24→2026-09-08, 137 execuções) | não medido — sem instrumentação de duração (aberto em `availability-5` do run anterior) | p95 < 30 s por adto (target defensável para operação humana de fechamento) | ⚠️ Não medível localmente | `docs/impacto/h1-permutas-achados.md` |
| Tempo de retenção do client dedicado do pool por `withAdvisoryLock` | igual à duração de `reconciliarSerializado` (worst-case ~240 s) | tempo do lock ≤ tempo da menor operação-crítica-lá-fora que também precisa do pool | ❌ | `PostgreeDatabaseClient.ts:137-158` |
| Chamadas Conexos NOVAS introduzidas pelo delta | **0** — `assertCobertura` reusa a lista já buscada por `listTitulosAPagar` | 0 | ✅ | `ReconciliacaoPermutaService.ts:509-517,679-703` |
| `PermutaAlocacaoRepository.listAtivas()` — `LIMIT`/`WHERE` | ausente (full scan + filtro em memória, ordenado por `adiantamento_doc_cod, criado_em`) | filtrar por `adiantamento_doc_cod` no SQL | ❌ | `PermutaAlocacaoRepository.ts:97-108` (não modificado neste delta) |
| Índices em `permuta_alocacao_execucao` (chave-quente) | `UNIQUE (idempotency_key)` + `idx…_adto` + `idx…_status` | presente | ✅ | `migrations/0015_permuta_alocacao_execucao.sql:35-40` |
| Migration 0054 — colunas/CHECK do delta | `ALTER TABLE … ADD COLUMN valor_residual_usd NUMERIC` + CHECK atualizado; sem novo índice | apenas colunas + CHECK; sem impacto de I/O em SELECT | ✅ | `migrations/0054_permuta_execucao_parcial.sql` |
| `heavyRouteLimiter` no `/reconciliar` e `/reconciliar-lote` | 10 req/min por IP | 10 req/min por IP (por-IP não protege dois operadores em máquinas distintas) | ⚠️ (parcial) | `src/backend/http/rateLimit.ts:28-35`, `routes/permutas.ts:493,570` |
| `LOTE_MAX` em `/reconciliar-lote` | **6 adtos** por request, sequenciais | limite existe (cap de blast-radius e duração) | ✅ | `ReconciliacaoLotePermutaService.ts:14` |
| `server.timeout` do Express | **não configurado** (herdado do run anterior — `performance-1`) | timeout duro na request | ⚠️ Não introduzido pelo delta; permanece aberto | `src/backend/index.ts:172-175` |

> ⚠️ **Não medível localmente**: latência p95 real (produção). Requer painel de duração no request middleware (card `availability-5` do run anterior). Sem ele, o gate se apoia em derivadas do `timeout × nº de chamadas`.
> ⚠️ **Não medível neste repo**: infra AWS / Lambda / SQS — o runtime **é Express no Render**, sem `infra/`, sem Lambda, sem SQS. Não são finding.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A | N/A | operação humana de fechamento — não há amostragem a controlar |
| Limit Event Response | `heavyRouteLimiter` 10 req/min/IP nas rotas de escrita; `LOTE_MAX=6` cap no `/reconciliar-lote` | ✅ presente | `rateLimit.ts:28`, `ReconciliacaoLotePermutaService.ts:14` |
| Prioritize Events | inexistente — sem fila de prioridade entre `/reconciliar` (interativo) e `/reconciliar-lote` (batch); mesmo pool, mesma rota Express | ❌ ausente | herdado; fora do escopo do delta |
| Reduce Overhead | pré-checagem `assertCobertura` **reusa** a lista `listTitulosAPagar` já buscada; **zero** chamadas Conexos novas introduzidas pelo delta | ✅ presente | `ReconciliacaoPermutaService.ts:509-517` |
| Bound Execution Times | timeout Conexos 40 s por chamada; `LOTE_MAX=6`; **advisory lock por adto** (delta) evita duas reconciliações concorrentes DO MESMO adto; `server.timeout` do Express — ausente | ⚠️ parcial | `services/conexos.ts:121`, `ReconciliacaoPermutaService.ts:152` |
| Increase Resource Efficiency | `assertCobertura` reusa dados; `beginExecution` idempotente; ledger write-ahead evita re-POST em retry | ✅ presente | `ReconciliacaoPermutaService.ts:509,271-288` |
| Increase Resources | `poolMaxConnections = 5` fixo em código, sem sizing por concorrência de escrita | ⚠️ parcial | `PostgreeDatabaseClient.ts:26` — comentário justifica ≥3 p/ eleição SISPAG, mas não considerou permutas com `withAdvisoryLock` de longa duração |
| Increase Concurrency | reconciliação por adto é **serializada por design** (advisory lock, `for` sequencial no `/reconciliar-lote`); adtos distintos podem ir em paralelo até `Pool.max` | ✅ presente (design deliberado, I-Recon-5) | `ReconciliacaoPermutaService.ts:143-153` |
| Maintain Multiple Copies of Computations | N/A | N/A | não há hot path idempotente de leitura para cachear no delta |
| Maintain Multiple Copies of Data | N/A | N/A | sem cache de leitura Conexos na hot path do delta |
| Bound Queue Sizes | não há fila (síncrono HTTP) | N/A | Express request/response |
| Schedule Resources | `heavyRouteLimiter` + `LOTE_MAX` fazem scheduling grosseiro; sem fila FIFO/prioridade | ⚠️ parcial | `rateLimit.ts:28`, `ReconciliacaoLotePermutaService.ts:129` |

Facetas modernas aplicáveis:
- **Cold start budget**: N/A — Express long-running no Render, não é Lambda.
- **Cache strategy**: N/A no delta.
- **Index discipline**: OK — as chaves quentes (`idempotency_key`, `adiantamento_doc_cod`, `status`) já são indexadas em `0015`. `0054` só adiciona coluna + CHECK.
- **Bundle leanness**: N/A — servidor.

## 4. Findings (achados)

### F-performance-1: `withAdvisoryLock` retém 1 client do pool (max=5) durante toda a reconciliação — pool starvation possível sob concorrência de adtos distintos

- **Severidade**: P2 (médio — probabilidade baixa no volume observado, mas impacto claro quando ocorre e agrava `performance-2` pré-existente)
- **Tactic violada**: Increase Resources (pool sub-dimensionado para o novo padrão de retenção); Bound Execution Times (o tempo dentro do lock não é limitado por nenhum timeout no servidor)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:143-153` (entrada do lock) + `src/backend/domain/client/database/PostgreeDatabaseClient.ts:137-158` (semântica do lock) + `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26` (`poolMaxConnections = 5`)
- **Evidência (objetiva)**:
  ```
  PostgreeDatabaseClient.ts:26
      private readonly poolMaxConnections = 5;

  PostgreeDatabaseClient.ts:137-158 (withAdvisoryLock — SESSION-level)
      const client = await this.connectionPool.connect();
      try {
          const res = await client.query('SELECT pg_try_advisory_lock($1) …');
          …
          try {
              return await onAcquired();          // <— cliente PRESO durante TODA a reconciliação
          } finally {
              await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
          }
      } finally {
          client.release();
      }

  ReconciliacaoPermutaService.ts:143-153
      public reconciliar = async (input) =>
          this.db.withAdvisoryLock(
              this.chaveDeLock(input.adiantamentoDocCod),
              () => this.reconciliarSerializado(input),   // duração medida em minutos
              …
          );

  services/conexos.ts:121
      this.client = axios.create({ …, timeout: 40000 });
  ```
- **Impacto técnico**: `reconciliarSerializado` roda 1 `listTitulosAPagar` + (na 1ª iteração) 1 `criarBordero` + 4 chamadas por título (`validarTituloBaixa`, `validarTituloPermuta`, `atualizarValorLiquido`, `gravarBaixaPermuta`) — pior caso ~6 × 40 s = **~240 s** para uma invoice de título único, mais quando há N invoices/M títulos. Durante todo esse tempo, **um client dedicado do pool está preso** (o `withAdvisoryLock` usa o mesmo `PoolClient` do `pg_try_advisory_lock` ao `pg_advisory_unlock`, propositalmente por causa do pooler transaction-mode). Com `Pool.max=5`, **5 reconciliações simultâneas de adtos distintos consomem todo o pool**. Qualquer outra query nesse intervalo (`GET /painel`, health-check, jobs cron que caiam na mesma janela, `logService` no próprio código) aguarda; se a espera passar de `connectionTimeoutMillis = 5000 ms`, erro. E o `listAtivas()` do `performance-2` do run anterior (full scan sem filtro) agora acontece **dentro** dessa janela de retenção — o problema pré-existente ganhou uma nova amplificação.
- **Impacto de negócio**: Volume atual é baixo (~35 execuções/mês → ~1–2/dia), então a colisão real é rara — dois operadores + o `/reconciliar-lote` sequencial de 6 adtos + painel atualizando basta para provocar. Efeito perceptível: painel travando com "Connection terminated" no meio de um fechamento, e possivelmente uma reconciliação abortando na leitura auxiliar (não no POST irreversível, porque o POST já está no ar). Não perde dinheiro — mas quebra a UX exatamente na hora em que a analista tem 5 baixas de R$ 280 k na tela.
- **Métrica de baseline**: `Pool.max = 5`; `connectionTimeoutMillis = 5000 ms`; timeout Conexos = 40 000 ms; ≥ 6 chamadas Conexos por par adto→invoice de 1 título ⇒ duração-pior-caso por adto ≈ **240 s**; 5 reconciliações concorrentes de adtos **distintos** ⇒ pool 100 % ocupado por até 240 s ⇒ demais queries batem em `connection timeout` após 5 s. Delta introduz `withAdvisoryLock` no caminho quente (`ReconciliacaoPermutaService.ts:143-153`) — o lock é a mudança que passa a segurar o client por essa duração.

### F-performance-2: Retentativa de `parcial` no ledger dispara uma chamada Conexos extra (`getBordero`) que antes só existia para `settled`

- **Severidade**: P3 (baixo — caminho raro, uma chamada extra apenas quando um `parcial` prévio é re-encontrado com borderô válido no ERP; sem impacto no caminho majoritário)
- **Tactic violada**: Reduce Overhead (a corretude aqui vale o custo — flag como P3 apenas para registro)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:269-286`
- **Evidência (objetiva)**:
  ```
  git diff HEAD~1 — trecho relevante
  -    if (existente?.status === 'settled') {
  +    if (existente?.status === 'settled' || existente?.status === 'parcial') {
           const baixaAindaValida = await this.borderoAindaValido(filCod, existente.borCod);
           …
  ```
  `borderoAindaValido` chama `conexosBaixaClient.getBordero` (`ReconciliacaoPermutaService.ts:1064`).
- **Impacto técnico**: quando o analista re-processa uma alocação que já tem execução `parcial` **preservada** no ledger, o serviço faz **1 GET Conexos a mais** por par antes de decidir se pula (skipped) ou libera (renameKey). Volume esperado: pares que caem em `parcial` são um subset pequeno das ~137 execuções produtivas; o subset que **também** é re-processado é menor ainda. Custo: uma chamada de leitura, tolerável.
- **Impacto de negócio**: nulo até que a taxa de `parcial` cresça a ponto de virar dígito em painel. A tática aqui é corretude sobre performance (I-Recon-1 exige que o ledger e o ERP concordem antes de re-liberar).
- **Métrica de baseline**: +1 chamada `getBordero` (~40 s timeout, tipicamente centenas de ms) por par com `status='parcial'` re-processado. Zero impacto no caminho `settled`/`pending`/`reconciling` (99 %+ do tráfego).

## 5. Cards Kanban

### [performance-3] Elevar `poolMaxConnections` e/ou reduzir a janela do advisory lock — dissolver a colisão entre `withAdvisoryLock` e leituras do painel

- **Problema**
  > `PostgreeDatabaseClient.withAdvisoryLock` (`PostgreeDatabaseClient.ts:137-158`) retém 1 `PoolClient` dedicado por **toda a duração** de `reconciliarSerializado`, que faz ~6 chamadas Conexos (timeout 40 s cada) — worst-case ~240 s por adto de título único, mais quando há multi-título. Com `Pool.max=5` (`PostgreeDatabaseClient.ts:26`), 5 reconciliações concorrentes de adtos **distintos** esgotam o pool e qualquer outra query (painel, health-check, o próprio `listAtivas` de `performance-2`) começa a estourar `connectionTimeoutMillis=5000`. Este é o modo mais provável de degradação sob concorrência real (dois operadores + `/reconciliar-lote` + painel atualizando).

- **Melhoria Proposta**
  > Duas alternativas complementares, ambas alinhadas com Bass. Escolher **A + B**, não uma só, porque atacam eixos diferentes:
  > - **A. Increase Resources** — Elevar `poolMaxConnections` de **5 → 12** (`PostgreeDatabaseClient.ts:26`) e revisar o comentário-diretriz que hoje justifica só o cenário SISPAG. Documentar a fórmula: `pool_max ≥ max(reconciliacoes_concorrentes_esperadas + leituras_de_painel_ativas + margem_de_2)`. Custo baixo: pool `pg` no Render é elástico dentro do plano.
  > - **B. Bound Execution Times** — Reduzir a **janela** do advisory lock: o lock por adto só precisa proteger o trecho **write-ahead → POST → mark(settled|parcial|error)**. As leituras de decisão (`findAdiantamento`, `listAtivas`, `autoAlocarSe…`, `assertCobertura`) podem rodar **antes** do lock, o que corta o tempo de retenção do client dedicado em ~30–50 %. Alternativa incremental: manter o lock e liberar/re-adquirir o client dedicado nas leituras que não precisam do mesmo backend (o unlock é da sessão, então essa opção exige refactor não trivial e não deve entrar sem teste dedicado).
  > Tática Bass: **Increase Resources** (A) + **Reduce Overhead / Bound Execution Times** (B).

- **Resultado Esperado**
  > Duas reconciliações de adtos distintos + 1 painel atualizando em paralelo terminam **sem** `connection acquisition timeout` no pool. Tempo de retenção do client dedicado por lock cai de ~240 s (worst-case) para ≤ ~90 s (só o handshake write). Espaço mínimo garantido no pool para leituras não-permuta (painel, health-check) mesmo com o `/reconciliar-lote` sequencial de 6 adtos em andamento.

- **Tactic alvo**: Increase Resources · Bound Execution Times · Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: **S** para (A) isoladamente (uma constante + comentário + smoke test); **M** para (A)+(B) juntas (extração de fases pré-lock e teste que garante que a idempotência não é violada por decisões tomadas fora do lock).
- **Findings relacionados**: F-performance-1 (deste run); referência cruzada: F-performance-2 do run `2026-09-08-1414-permutas` (o `listAtivas` full-scan agora acontece **dentro** da janela de retenção do lock).
- **Métricas de sucesso**:
  - `Pool.max`: 5 → 12 (item A) — mensurável em `PostgreeDatabaseClient.ts:26`.
  - Duração de retenção do client dedicado por lock (worst-case): ~240 s → ≤ 90 s (item B) — mensurável assim que o card `availability-5` (instrumentação de duração) do run anterior for entregue.
  - `p95` de `connection acquisition wait` no `pg` durante `/reconciliar-lote` de 6 adtos: hoje inobservado → alvo `< 100 ms` (requer métrica; segue dependente de `availability-5`).
- **Risco de não fazer**: nos próximos meses, à medida que a Frente IV (Conciliação de Recebimentos) e novos jobs cron ganham espaço, cada novo consumidor do pool encurta a folga. O sistema segue funcionando na maior parte do tempo, mas a analista vê queda intermitente do painel exatamente quando roda o fechamento do lote — o pior lugar possível para uma UX inconsistente, dado o valor médio (~R$ 280 k) por adto.
- **Dependências**: `availability-5` do run anterior (instrumentação de duração) para tornar as métricas de sucesso observáveis. Nada bloqueia (A) — dá para ir com (A) primeiro e agendar (B) só se (A) não zerar as reclamações.

### [performance-4] Instrumentar duração do `withAdvisoryLock` e do `reconciliar` — visibilidade antes de qualquer otimização adicional

- **Problema**
  > Não há sinal do tempo real de retenção do client no pool nem do p95 de `reconciliarSerializado` em produção. O card `availability-5` do run anterior pediu instrumentação de duração; enquanto ele não sai, o único baseline defensável de `performance-3` é derivado (timeout × nº de calls), não medido.

- **Melhoria Proposta**
  > Emitir 2 `logService.info({ type: 'PERF' })` no fluxo de `withAdvisoryLock`: (i) tempo de espera até adquirir o lock, (ii) tempo entre acquire→release do client dedicado. Emitir 1 `PERF` no wrapper `reconciliar` com a duração total. Tag `adiantamentoDocCod`, `borCod`, `titulos.length`. Custo baixo, sem dependência de infra AWS. Tática Bass: **Increase Resource Efficiency** via observabilidade — pré-requisito para qualquer ajuste de pool sizing.

- **Resultado Esperado**
  > Painel operacional consegue plotar histograma de duração de `reconciliar` por dia. p95, p99 e worst-case observáveis. `performance-3(A)` e `(B)` passam a ter métrica de sucesso REAL, não derivada.

- **Tactic alvo**: Increase Resource Efficiency (via observabilidade)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1 (o baseline hoje é derivado).
- **Métricas de sucesso**:
  - Duração p50/p95/p99 de `reconciliar`: hoje inobservável → observável em painel diário.
  - Tempo de retenção do client dedicado por lock: hoje inobservável → observável.
- **Risco de não fazer**: `performance-3` fica sem métrica de sucesso e vira "vamos elevar pool porque a gente acha", em vez de "elevamos pool porque X% das requisições ficavam esperando > Y ms".
- **Dependências**: substancialmente sobreposto com `availability-5` do run anterior — coordenar para não duplicar trabalho (marca cross-QA na seção 6).

## 6. Notas do agente

- Delta é curto e o desenho da mudança é acertado nos eixos que o `--quick` cobre: `assertCobertura` **reusa** a lista `listTitulosAPagar` já buscada (zero chamadas Conexos novas — o achado que o prompt sugeria investigar não existe), `LOTE_MAX=6` limita blast-radius, migration `0054` só adiciona coluna+CHECK sem regressão de índice.
- O único finding P2 é a interação `withAdvisoryLock` × `Pool.max=5` — foi exatamente o modo-de-erro que o prompt previu como mais provável. Baseline: `poolMax=5`, timeout HTTP `40 s`, ≥6 chamadas Conexos por par, `connectionTimeoutMillis=5 s`.
- Cross-QA para o consolidator:
  - **Availability** (F-availability-*): pool starvation também é modo de falha de disponibilidade. `performance-3` compartilha causa-raiz com `availability-5` (instrumentação de duração) — deduplicar no KANBAN.
  - **Fault Tolerance**: o próprio `withAdvisoryLock` é uma tática de FT (Actively Prevent Errors: serializa duplicidades) — o custo em performance é o preço da corretude. Não retirar.
  - **Modifiability**: `poolMaxConnections = 5` está hard-coded em `PostgreeDatabaseClient.ts:26` com comentário justificando P0-6 (SISPAG). Elevar para 12 exige atualizar a docstring e o argumento (sem virar variável de ambiente ainda — não vale a pena para 1 número que muda uma vez por trimestre).
  - **Não medível neste repo**: infra AWS/Lambda/SQS — o runtime é Express no Render. Zero findings de cold-start, batching SQS, EventBridge etc. Ver `_shared-metrics.md`.
