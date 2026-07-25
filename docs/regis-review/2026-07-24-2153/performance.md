---
qa: Performance
qa_slug: performance
run_id: 2026-07-24-2153
agent: qa-performance
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 7.5
findings_count: 5
cards_count: 5
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Scheduler / operador aciona `POST /recebimentos/pipeline/run` (ou o job de ingestão Nexxera na Fase 1) | Um extrato bancário do dia com N movimentos (esperado 100–2000/dia por filial × ~10 filiais) percorre as 5 etapas do coordinator | `RecebimentoPipelineService` + `TransacaoRepository` / `RecebimentoRepository` / `RecebimentoExecucaoRepository` + portas Nexxera/ERP | Runtime Express (hoje) — 1 processo Render; produção-alvo Lambda | Todos os 5 estágios completam sem serializar chamadas ERP filial-a-filial nem varrer tabela sem índice; write-ahead do ledger curto-circuita idempotência sem POST duplicado no ERP | p95 pipeline (1 movimento) ≤ 800 ms; p95 do fan-out multi-filial (ingestão diária) ≤ 30 s para 10 filiais × 200 títulos; 0 varreduras sequenciais em `transacao_bancaria` / `recebimento_execucao` (ver `EXPLAIN`) |

> Cenário-espelho: SISPAG hoje já sofreu com o burst `Promise.all` em N filiais Conexos (`LOGIN_ERROR_MAX_SESSIONS`), remediado por `BoundedConcurrency` (limit=4). Frente IV precisa herdar a mesma disciplina no dia 1 — o scaffold ainda não amarra esse seam.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC novo scaffold (interface + repo + service) | 2256 | ≤ 3000 (scaffold enxuto) | ✅ | `_shared-metrics.md` |
| Migrations com PK / UNIQUE em chave natural / idempotência | 4/7 (`transacao_bancaria.natural_key`, `recebimento_execucao.idempotency_key`, `nota_debito_eletronica.idempotency_key`, `regra_recebimento(tipo,versao)`) | 4/7 (só onde cabe) | ✅ | `0032,0035,0037,0038` |
| Índices por tabela nova (fora da PK) | média 2.4 (7 tabelas × 17 índices) | ≥ 2 nas tabelas de escrita quente | ✅ | `grep 'CREATE INDEX' 003[2-8]*.sql \| wc -l` = 17 |
| Colunas frequentes em `WHERE` sem índice | 1 — `recebimento_execucao.idempotency_key` tem apenas o índice implícito do UNIQUE (ok); `regra_recebimento.ativo` tem índice porém consulta é `WHERE ativo=true ORDER BY tipo, versao DESC` (índice composto seria melhor) | 0 varreduras em campos de lookup | ⚠️ | `RegraRecebimentoRepository.ts:47-51` |
| `selectMany` sem `LIMIT` em código novo | 1 — `RegraRecebimentoRepository.listAtivas()` (`SELECT … FROM regra_recebimento WHERE ativo = true ORDER BY tipo, versao DESC`) | 0 em caminho quente | ⚠️ | `RegraRecebimentoRepository.ts:46-51` |
| Repositórios com paginação (`LIMIT`/`OFFSET`) para listagens | 0/6 — nenhum repositório novo expõe `list*(pagination)`; `RecebimentoRepository` e `TransacaoRepository` só têm `save`/`findById` | ≥ 1 (painel + fila) até Fase 2/3 | ⚠️ (aceitável no scaffold, mas cadastrar debt) | `ports.ts:187-196`, `RecebimentoRepository.ts` |
| N+1 latentes nos ports (contratos que forcem loop N chamadas) | 0 no scaffold; `MatchingEngineInterface.match(t, abertos[])` já recebe a lista pré-carregada; `RateioEngineInterface.ratear(recebimento)` recebe o agregado; `ErpReceivablesGatewayInterface` opera 1-por-recebimento (não em lote) | 0 pré-cabeados | ✅ (com ressalva no ERP — ver F-performance-3) | `ports.ts:141-166` |
| Seam de ingestão com `BoundedConcurrency` embutido | ❌ Ausente — `IngestaoTransacoesInterface.run(input)` recebe **1 período de 1 filCod**; não há assinatura `runMany(filCods[])` nem injeção de `BoundedConcurrency` no coordinator (contraste: `IngestaoPagamentosService` usa `bounded.run(filCods, worker, FANOUT_LIMIT=4)`) | Assinatura ou seam explícito para fan-out multi-filial já forecast | ❌ | `ports.ts:136-139`, `RecebimentoPipelineService.ts:97-116` |
| Coordinator com estágios sequenciais desnecessários | Baixo — `importarTransacoes → atribuirBaixa → ratearRecebimento → aplicarRegras → executarRecebimento` é dependência de dados legítima (cada estágio consome saída do anterior) | Manter sequencial dentro de 1 recebimento; paralelizar ENTRE recebimentos no runner externo | ✅ | `RecebimentoPipelineService.ts:85-95` |
| `withCorrelationId` no MetricsPort — overhead | Pass-through no stub (0 alocação extra além do closure) | Zero-cost quando não injetado (real Módulo 6 deve usar AsyncLocalStorage) | ✅ | `MetricsPortStub.ts:28-30` |
| Test suite runtime | ~22 s (63 suites / 675 tests) | ≤ 60 s | ✅ | `_shared-metrics.md` |
| Cold-start budget (Lambda-alvo) | ⚠️ Não medível localmente — hoje roda em Express/Render | ≤ 600 ms p95 quando migrar para Lambda | ⚠️ | Requer bundle + esbuild + AWS X-Ray; recomendar `esbuild --analyze` na migração |
| Latência real do fan-out Nexxera + ERP (P95 e2e) | ⚠️ Não medível — stubs retornam vazio; sem CloudWatch RUM | Baseline capturado na Fase 1 (spike O7) | ⚠️ | Instrumentar `MetricsPort` real com histogramas por estágio (p50/p95/p99) |

> ⚠️ **Não medível localmente**: latências reais Conexos/Nexxera/ERP; cold-start Lambda; profundidade de fila do runner futuro. Requer produção + CloudWatch/X-Ray. Recomendação: o Módulo 6 (metrics port real) DEVE emitir histogramas por estágio (`recebimentos.stage.duration.ms{stage=...}`) para materializar essas métricas.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Manage Sampling Rate** | N/A — pipeline é event-driven (1 execução por movimento), não amostragem contínua | N/A | — |
| **Limit Event Response** | `heavyRouteLimiter` já aplicado em `POST /recebimentos/pipeline/run`; `requireRole('admin')` limita origem | ✅ presente | `routes/recebimentos.ts:48-50` |
| **Prioritize Events** | Não há priority queue no scaffold; runner externo (SQS/EventBridge) definirá prioridade | ⚠️ parcial (delegado ao runner) | ausente no scaffold — ok, ver `_inbox/frente-iv-arquitetura-modular.md` |
| **Reduce Overhead** | Coordinator delega tudo via ports (sem lógica); `MetricsPortStub` reusa `LogService` (não instancia outro logger); repos são CRUD fino sem JOIN pesado | ✅ presente | `RecebimentoPipelineService.ts:85-95`, `MetricsPortStub.ts:20-25` |
| **Bound Execution Times** | ❌ Nenhum timeout global no coordinator (`await this.matching.match(...)`, `await this.erp.criarBordero(...)` podem pendurar); ports não impõem `timeoutMs` | ❌ ausente | `RecebimentoPipelineService.ts:88-93`, `ports.ts:132-166` |
| **Increase Resource Efficiency** | SQL parametrizado + `ON CONFLICT` upsert (single roundtrip); ledger write-ahead evita POST duplicado; sem N+1 latente nas assinaturas | ✅ presente | `TransacaoRepository.ts:26-38`, `RecebimentoExecucaoRepository.ts:39-69` |
| **Increase Resources** | ❌ Nenhum hook no coordinator para escalar concorrência (pool DB `PostgreeDatabaseClient` é global; nenhum sinal de reserva) | ⚠️ parcial (delegado à infra) | — |
| **Increase Concurrency** | ❌ **Falta seam** para fan-out multi-filial (`IngestaoTransacoesInterface.run` é single-filCod; nenhum `BoundedConcurrency` no coordinator nem no port de ingestão) — o padrão comprovado (`IngestaoPagamentosService`) NÃO foi espelhado | ❌ ausente | `ports.ts:136-139` vs. `IngestaoPagamentosService.ts:81-91` |
| **Maintain Multiple Copies of Computations** | N/A — sem replicação de compute nesta fase | N/A | — |
| **Maintain Multiple Copies of Data** | Read-through do ERP (`DocumentoAReceber`) evita cópia; `TransacaoBancaria` armazena `raw_payload` + `normalized` (2 cópias por design — auditoria) | ✅ presente | `0032_transacao_bancaria.sql:18-19` |
| **Bound Queue Sizes** | ⚠️ Nada no scaffold — depende do runner (SQS `MaxReceiveCount`, `MessageRetentionPeriod`) definido na Fase 1 | ⚠️ parcial | — |
| **Schedule Resources** | Advisory lock (`db.withAdvisoryLock`) padrão do SISPAG NÃO foi replicado no `IngestaoTransacoesInterface` — port não força exclusão cross-processo | ❌ ausente | `ports.ts:136-139` vs. `IngestaoPagamentosService.ts:52-61` |
| **Cache strategy** (facet) | Sem cache no scaffold; `RegraRecebimentoRepository.listAtivas()` recarrega toda vez (regras mudam raro → candidato natural a TTL cache) | ⚠️ parcial | `RegraRecebimentoRepository.ts:45-53` |
| **Index discipline** (facet) | 17 índices em 7 tabelas; lookup keys (`natural_key`, `idempotency_key`, `recebimento_id`, `correlation_id`) cobertos | ✅ presente | `0032–0038` |
| **Bundle leanness** (facet) | N/A hoje (Express monolito). No alvo Lambda, o coordinator + 6 stubs + 6 repos empacotam limpo (sem `aws-sdk` v2, sem libs pesadas ainda) | ✅ presente | `ls src/backend/domain/service/recebimentos/` |
| **Cold-start budget** (facet) | ⚠️ Não aplicável ao runtime atual (Express). Alvo Lambda: cada `@injectable()` novo é ~1ms de reflect-metadata; 6 stubs + 6 repos + 1 service ≈ 13 ms extra — orçamento saudável | ⚠️ N/A hoje | — |

## 4. Findings (achados)

### F-performance-1: Ingestão port não expõe seam de fan-out multi-filial (BoundedConcurrency ausente)

- **Severidade**: P1
- **Tactic violada**: Increase Concurrency / Schedule Resources
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:40-53,136-139`; `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:97-116`
- **Evidência (objetiva)**:
  ```ts
  // ports.ts:40-45
  export interface IngestaoTransacoesInput {
      filCod: number;                 // ← singular. Nenhuma variante runMany(filCods[]).
      periodo: NexxeraFetchPeriod;
      correlationId: string;
      triggeredBy: string;
  }
  export interface IngestaoTransacoesInterface {
      run: (input: IngestaoTransacoesInput) => Promise<IngestaoTransacoesResult>;
  }
  ```
  Compare com o padrão comprovado no SISPAG (`IngestaoPagamentosService.ts:81-91`):
  ```ts
  const settled = await this.bounded.run(
      filCods,
      async (filCod) => { … },
      FANOUT_LIMIT,               // FANOUT_LIMIT = 4
  );
  ```
- **Impacto técnico**: quando o Módulo 1 (Fase 1) implementar a ingestão real Nexxera → Conexos read-back para deduplicar/enriquecer, o único caminho ergonômico é chamar `ingestao.run()` **em loop por filCod no runner externo**. Se um teammate usar `Promise.all(filCods.map(f => run({filCod:f})))` reproduz o burst que já derrubou o SISPAG com `LOGIN_ERROR_MAX_SESSIONS`. O port não previne isso — nem contém a rate-limit, nem convida ao pool bounded. Advisory-lock também não é expressado no contrato (a exclusão cross-processo teria que ser reinventada por baixo).
- **Impacto de negócio**: risco de recriar o incidente “fan-out mata sessão Conexos” no dia da migração da Fase 1; MTTR alto (culpa parece do Nexxera, é do próprio código); risco de re-executar imports concorrentes (duplicidade em `transacao_bancaria` — o UNIQUE(natural_key) salva o dado, mas o custo de I/O e o log ficam sujos).
- **Métrica de baseline**: 0 hooks de concurrency no port (`grep -c 'BoundedConcurrency\|Bounded\|Concurrent' src/backend/domain/interface/recebimentos/ports.ts` = 0); SISPAG usa `FANOUT_LIMIT=4` como precedente numérico. Se um único fan-out irrestrito de 10 filiais bater 3× no Conexos por filial → 30 sessões simultâneas > limite prático (~10).

### F-performance-2: Nenhum `timeoutMs` nos ports das dependências externas (Nexxera / ERP / NDe)

- **Severidade**: P1
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:132-171`; `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:88-244`
- **Evidência (objetiva)**:
  ```ts
  // ports.ts:132-170
  export interface NexxeraGatewayInterface {
      fetch: (period: NexxeraFetchPeriod) => Promise<RawMovimento[]>;    // sem timeout
  }
  export interface ErpReceivablesGatewayInterface {
      criarBordero: (params: CriarBorderoParams) => Promise<BorderoCriado>;  // sem timeout
      gravarBaixa: (params: GravarBaixaParams) => Promise<BaixaGravada>;     // sem timeout
  }
  export interface NdeEmitterInterface {
      emitir: (recebimento: Recebimento) => Promise<NotaDebitoEletronica>;   // sem timeout
  }
  ```
  Coordinator faz `await` puro em todos os estágios sem envelope (`RetryExecutor`/timeout):
  ```ts
  // RecebimentoPipelineService.ts:219-237
  const bordero = await this.erp.criarBordero({ … });
  const baixa   = await this.erp.gravarBaixa({ … });
  const nde     = await this.ndeEmitter.emitir(aprovado);
  ```
- **Impacto técnico**: uma chamada Conexos/Nexxera pendurada (2-10 s p99 é a linha de base; sob incidente, 60+s) pin-a o worker inteiro do pipeline. No alvo Lambda, isso consome o timeout da função (default 3 s ou 900 s) e produz double-processing quando a visibility SQS estoura. Não há sinal no contrato que force o implementador real a passar `timeout`/`RetryExecutor`.
- **Impacto de negócio**: sob incidente do Conexos, 1 movimento demorado bloqueia N seguintes; painel de recebimentos “trava”; SLA da conciliação diária estoura. Cross-QA com Availability (idem finding lá).
- **Métrica de baseline**: 0 assinaturas de port com `timeoutMs`/`AbortSignal` (`grep -c 'timeout\|AbortSignal' src/backend/domain/interface/recebimentos/ports.ts` = 0). Precedente: `IngestaoPermutasService` sofreu incidente Conexos 504 antes do bounded pool.

### F-performance-3: `ErpReceivablesGatewayInterface` opera 1-por-recebimento (ausência de `gravarBaixaBatch`)

- **Severidade**: P2
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:162-166`; `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:219-236`
- **Evidência (objetiva)**:
  ```ts
  // ports.ts:162-166
  export interface ErpReceivablesGatewayInterface {
      criarBordero: (params: CriarBorderoParams) => Promise<BorderoCriado>;
      gravarBaixa:  (params: GravarBaixaParams)  => Promise<BaixaGravada>;
  }
  // coordinator dá 1 borderô + 1 baixa por Recebimento — se um lote diário tem 200 recebimentos
  // aprovados, são 400 POSTs sequenciais ao Conexos.
  ```
- **Impacto técnico**: quando o runner externo processar um lote diário de conciliações aprovadas, cada Recebimento gera 3 chamadas ERP (`criarBordero`+`gravarBaixa`+`emitir`). Sem versão batch, 200 recebimentos = 600 roundtrips serial; e o próprio ERP `fin010` normalmente aceita borderô com múltiplas baixas (padrão do SISPAG). O port trava a granularidade em 1.
- **Impacto de negócio**: janela de conciliação vespertina pode virar 2–3× mais longa; consome mais sessões Conexos; risco de janela batelar com o horário do fechamento diário do banco.
- **Métrica de baseline**: 1 borderô por Recebimento (`grep -c 'criarBordero' src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts` = 1, chamado dentro de `executarRecebimento` por instância). Ponto de comparação: `IngestaoPagamentosService.upsertMany(titulos, runId)` usa 1 write para N registros.

### F-performance-4: `RegraRecebimentoRepository.listAtivas()` sem cache, sem `LIMIT`, sem índice composto

- **Severidade**: P2
- **Tactic violada**: Cache strategy / Index discipline
- **Localização**: `src/backend/domain/repository/recebimentos/RegraRecebimentoRepository.ts:45-53`; `src/backend/migrations/0037_regra_recebimento.sql:20-21`
- **Evidência (objetiva)**:
  ```ts
  public listAtivas = async (): Promise<RegraRecebimento[]> => {
      const rows = await this.databaseClient.selectMany(
          `SELECT id, tipo, versao, vigente_de, vigente_ate, parametros, explicacao, ativo
           FROM regra_recebimento
           WHERE ativo = true
           ORDER BY tipo, versao DESC`,
      );
      return rows.map((r) => this.mapRow(r));
  };
  ```
  ```sql
  -- 0037_regra_recebimento.sql:20-21
  CREATE INDEX IF NOT EXISTS idx_regra_recebimento_tipo  ON regra_recebimento (tipo);
  CREATE INDEX IF NOT EXISTS idx_regra_recebimento_ativo ON regra_recebimento (ativo);
  ```
- **Impacto técnico**: `RegrasEngine.aplicar()` será chamada 1× por Recebimento no coordinator. Cada chamada, se re-consultar `listAtivas()`, faz um scan filtrando por `ativo=true` + sort no cliente (índice em `ativo` sozinho tem seletividade baixa — quase tudo é `true`). Tabela de regras é pequena (<100 linhas esperado), mas o custo é multiplicado por N recebimentos por dia. Precedente CLAUDE.md: "cache config retrieved values in instance variables". Índice composto `(ativo, tipo, versao DESC)` cobriria `WHERE + ORDER BY`.
- **Impacto de negócio**: overhead sistemático de ~1-5 ms × N recebimentos/dia (200 recebimentos → 200–1000 ms desperdiçados/dia); regras mudam raro (versão nova ~ 1×/mês). Baixo custo hoje, mas é dívida barata de resolver no scaffold.
- **Métrica de baseline**: 1 `selectMany` sem `LIMIT` no código novo; ausência do índice composto (`ativo`, `tipo`, `versao DESC`); 0 TTL cache.

### F-performance-5: Ausência de método `loadAggregate` no `RecebimentoRepository` — futuros N+1 no read-model

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead / Increase Resource Efficiency
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:192-196`; `src/backend/domain/repository/recebimentos/RecebimentoRepository.ts:87-90`
- **Evidência (objetiva)**:
  ```ts
  // ports.ts:192-196
  export interface RecebimentoRepositoryInterface {
      save:    (recebimento: Recebimento) => Promise<Recebimento>;
      findById:(id: string) => Promise<Recebimento | null>;
  }
  ```
  ```ts
  // RecebimentoRepository.ts:87-90 — o mapRow ADMITE explicitamente o buraco:
  // "Derivados recompostos ao carregar o agregado completo (Fase 3). Aqui persiste-se só a raiz."
  valorAlocado: 0,
  diferencaNaoAlocada: Number(r.valor_recebido),
  regrasAplicadas: [],
  rateios: [],
  ```
  O painel (`GET /recebimentos/painel`) e a fila de execução precisarão de N recebimentos + seus rateios + suas regras aplicadas — se cada tela chama `findById(id)` em loop e depois `rateioRepo.listByRecebimento(id)` em loop, N+1 clássico.
- **Impacto técnico**: o contrato atual (`findById(id)` singular) empurra o consumidor para `for (id of ids) await repo.findById(id)` → N+1. Rateios/regras nem sequer estão no port de rateio (não há `rateioRepo` em `ports.ts` — provavelmente virá com Módulo 3). Sem `findByIds([...])` / `loadAggregate(id)` / `list(filter, pagination)`, o path natural é ruim.
- **Impacto de negócio**: painel de 50 recebimentos → 150+ queries (1 root + 1 rateios + 1 regras por linha) → p95 do painel > 2 s facilmente. Contradiz "p95 ≤ 800 ms" do cenário.
- **Métrica de baseline**: 0 métodos `findByIds`/`list`/`loadAggregate` no scaffold repo (`grep -c 'findByIds\|listBy\|loadAggregate' src/backend/domain/repository/recebimentos/*.ts` = 0); 2 métodos por repo — só `save` + `findById`.

## 5. Cards Kanban

### [performance-1] Adicionar seam `runMany` + injetar `BoundedConcurrency` no port de ingestão

- **Problema**
  > `IngestaoTransacoesInterface.run` recebe **1 filCod por chamada**; o coordinator não injeta `BoundedConcurrency` nem menciona pool. O único caminho para fan-out multi-filial (Fase 1) é `Promise.all(filCods.map(...))` — exatamente o burst que estourou `LOGIN_ERROR_MAX_SESSIONS` no SISPAG (mitigado com `FANOUT_LIMIT=4`). O scaffold não previne a repetição.

- **Melhoria Proposta**
  > Espelhar o padrão `IngestaoPagamentosService`: adicionar a assinatura `runMany(filCods: number[], periodo: NexxeraFetchPeriod, correlationId, triggeredBy): Promise<IngestaoTransacoesResult>` em `IngestaoTransacoesInterface`; injetar `BoundedConcurrency` no scaffold do stub (documentando `FANOUT_LIMIT_RECEBIMENTOS`, alinhado ao 4 do SISPAG); no port, expor também `advisoryLockKey: number` (constante namespaced ≠ `PAGAMENTO_INGEST_LOCK_KEY`) para o Módulo 1 chegar já com contrato de exclusão. Tocar: `ports.ts`, `stubs/IngestaoTransacoesStub.ts`.

- **Resultado Esperado**
  > Fan-out diário de 10 filiais executa com no máximo 4 sessões Conexos simultâneas; 0 `LOGIN_ERROR_MAX_SESSIONS`; teammates da Fase 1 não têm como "esquecer" o bounded pool (assinatura força-lhes o padrão). Métrica: `p95 fan-out(10 filiais × 200 movimentos)` de baseline potencial 60 s (burst 30 paralelo com throttling) → ≤ 30 s (pool 4).

- **Tactic alvo**: Increase Concurrency / Schedule Resources
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — só assinatura + stub + teste)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Métodos concurrency-aware no port: 0 → 1 (`runMany`)
  - `BoundedConcurrency` injetado no stub: não → sim
  - Constante `FANOUT_LIMIT_RECEBIMENTOS` documentada: ausente → presente
- **Risco de não fazer**: primeira execução real da Fase 1 reproduz o incidente Conexos → dia perdido em firefighting; retrabalho de contrato depois que 6 teammates já escreveram o consumidor.
- **Dependências**: —

### [performance-2] Padronizar `timeoutMs` + envelope `RetryExecutor` nos ports externos (Nexxera / ERP / NDe)

- **Problema**
  > Nenhum port externo (`NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`, `NdeEmitterInterface`) declara `timeoutMs`/`AbortSignal`. O coordinator faz `await` puro. Sob incidente Conexos (p99 já observado 10 s+; 504 já foi incidente real no SISPAG), 1 chamada pendurada trava o worker até o timeout global da função — pin do worker + double-processing quando SQS visibility estoura.

- **Melhoria Proposta**
  > 1) Adicionar `readonly timeoutMs: number` (ou 2º param `opts: { timeoutMs, signal }`) em cada método dos 3 ports externos; 2) No coordinator, envelopar cada chamada externa com `RetryExecutor` já existente (`domain/libs/executor/RetryExecutor.ts`) — `attempts=3, delayMs=500, timeoutMs=port.timeoutMs`; 3) constantes de timeout em `constants.ts`: `NEXXERA_FETCH_TIMEOUT_MS=15000`, `ERP_WRITE_TIMEOUT_MS=8000`, `NDE_EMIT_TIMEOUT_MS=8000`. Tocar: `ports.ts`, `RecebimentoPipelineService.ts`, `constants.ts`.

- **Resultado Esperado**
  > 100% das chamadas externas com teto de latência conhecido; sob incidente Conexos, worker libera em ≤ timeout × attempts em vez de segurar 60 s+; ledger `recebimento_execucao` marca `error` com mensagem clara em vez de "unknown". Métrica: p95 de duração de estágio `executarRecebimento` sob falha 60 s → ≤ 25 s (8 s × 3 attempts).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2 (cross: `fault-tolerance`, `availability`)
- **Métricas de sucesso**:
  - Ports com `timeoutMs` explícito: 0/3 → 3/3
  - Chamadas do coordinator envelopadas em `RetryExecutor`: 0/5 → 3/5 (só as externas)
- **Risco de não fazer**: 1 incidente Conexos = MTTR alto e recebimentos travados em `reconciling`; time culpa Nexxera antes de olhar o próprio código.
- **Dependências**: —

### [performance-3] Adicionar variante batch em `ErpReceivablesGatewayInterface.gravarBaixaBatch`

- **Problema**
  > O port ERP grava borderô + baixa **um Recebimento por vez**. Runner externo em lote diário fará 3 POSTs Conexos por Recebimento aprovado — 200 recebimentos = 600 roundtrips serial. O `fin010` normalmente aceita borderô com múltiplas baixas (é o padrão do SISPAG), então o port está artificialmente estreito.

- **Melhoria Proposta**
  > Aditivar (não substituir) `criarBorderoComBaixas(params: { filCod, borVldTipo, contaDestino, baixas: BaixaItem[], correlationId, dryRun }): Promise<{ borCod, bxaCodSeqs: number[] }>` no `ErpReceivablesGatewayInterface`. Manter as variantes `criarBordero`/`gravarBaixa` para o caso 1-a-1. Documentar batch size máximo (`ERP_BATCH_MAX=50`, alinhado à experiência SISPAG). Módulo 5 implementa e o coordinator/runner escolhe a variante conforme cardinalidade.

- **Resultado Esperado**
  > Lote diário de 200 recebimentos: 600 roundtrips → 4 roundtrips batch (200/50 = 4); janela vespertina de conciliação reduz de estimado 20 min para ≤ 2 min. Cross-benefit: menos sessões Conexos, menor pressão sobre `LOGIN_ERROR_MAX_SESSIONS`.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — só assinatura no scaffold)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Método batch no port ERP: 0 → 1 (`criarBorderoComBaixas`)
  - Constante documentada `ERP_BATCH_MAX`: ausente → presente
- **Risco de não fazer**: após Fase 5, o teammate implementa a versão 1-a-1 e ninguém volta atrás → runtime da janela batch cresce linearmente com carteira.
- **Dependências**: —

### [performance-4] Cachear `regra_recebimento` ativas (TTL) + índice composto `(ativo, tipo, versao DESC)`

- **Problema**
  > `RegraRecebimentoRepository.listAtivas()` recarrega todas as regras a cada chamada do estágio `aplicarRegras` — 1× por Recebimento. Sem `LIMIT`, sem cache, e o índice existente (`idx_regra_recebimento_ativo`) tem baixa seletividade (quase tudo é `ativo=true`), forçando sort no cliente.

- **Melhoria Proposta**
  > 1) Migration `0039_regra_recebimento_composite_index.sql`: `CREATE INDEX IF NOT EXISTS idx_regra_recebimento_ativo_tipo_versao ON regra_recebimento (ativo, tipo, versao DESC) WHERE ativo = true;` (partial index — ainda mais leve); 2) No `RegraRecebimentoRepository`, adicionar cache instance-variable com TTL (5 min é seguro — regras mudam raro): `private cache?: { at: number; rows: RegraRecebimento[] }`. Alinha-se ao padrão CLAUDE.md ("cache config retrieved values in instance variables"). Invalidar cache em `save()`.

- **Resultado Esperado**
  > `listAtivas` cache-hit ratio esperado ≥ 99% (regras mudam raro); custo desce de ~2 ms/call × N recebimentos para ~0 ms; query fria (cache miss) usa partial index (plano `Index Only Scan`). Métrica: 200 recebimentos/dia × 2 ms = 400 ms/dia desperdiçados → ≤ 4 ms/dia (1 miss + 199 hits).

- **Tactic alvo**: Cache strategy / Index discipline
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-4 (cross: `modifiability` — schema-as-code)
- **Métricas de sucesso**:
  - Índice composto `(ativo, tipo, versao DESC) WHERE ativo=true`: ausente → presente
  - Cache TTL em `RegraRecebimentoRepository`: 0 → 5 min
  - `selectMany` sem `LIMIT` em código novo: 1 → 0 (fica dentro do cache; miss raro)
- **Risco de não fazer**: dívida cresce com volume de regras e recebimentos; overhead invisível espalha na p50 do pipeline.
- **Dependências**: —

### [performance-5] Adicionar `loadAggregate` / `list(filter, pagination)` + `findByIds` em `RecebimentoRepositoryInterface`

- **Problema**
  > O contrato só oferece `save` + `findById(id)`. O painel (`GET /recebimentos/painel`) e a fila de execução vão consumir N recebimentos com seus rateios/regras. Sem `findByIds`/`list`/`loadAggregate`, o consumidor natural cai em N+1. O próprio `mapRow` do repo admite isso: "Derivados recompostos ao carregar o agregado completo (Fase 3)" — a Fase 3 não vem grátis, precisa do contrato agora.

- **Melhoria Proposta**
  > Aditivar no `RecebimentoRepositoryInterface`: `list(filter: { filCod?: number; status?: RecebimentoStatus; classificacao?: MatchClassificacao }, pagination: { limit: number; offset: number }): Promise<{ rows: Recebimento[]; total: number }>`; `findByIds(ids: string[]): Promise<Recebimento[]>`; `loadAggregate(id: string): Promise<Recebimento | null>` (que fará 1+2 queries — root + rateios + regras — em vez de N+1 no chamador). Documentar `LIMIT` default 50 e teto 500 (padrão `Dynamic WHERE Pattern` de CLAUDE.md). Não implementar hoje; deixar `throw new Error('not implemented in scaffold')` — o objetivo é fixar o contrato.

- **Resultado Esperado**
  > Contrato do repo cobre painel + fila sem obrigar N+1; Módulo 2/3 nasce com API rica; painel de 50 recebimentos: 150+ queries potencial → 3 queries (list + rateios batch + regras batch). Métrica: p95 painel esperado 2 s+ → ≤ 400 ms.

- **Tactic alvo**: Reduce Overhead / Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — só assinatura + doc + `throw` stub)
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Métodos no port `RecebimentoRepositoryInterface`: 2 → 5 (`+list`, `+findByIds`, `+loadAggregate`)
  - Paginação obrigatória documentada: não → sim (`limit`/`offset` no tipo)
- **Risco de não fazer**: Fase 3 escreve o painel com `findById` em loop; débito só aparece com carteira real (semanas após deploy); refatorar contrato depois quebra 6 consumidores.
- **Dependências**: —

## 6. Notas do agente

- Escopo respeitado: só o base scaffold (interfaces, repositórios, migrations 0032–0038, coordinator + stubs, rotas + gate). Nenhum finding sobre lógica de negócio ausente — é design intencional (Fase 0). O conhecido N+1 em `IngestaoPermutasService` (linhas 323/336/366/411 — loops sobre candidatas) NÃO foi filed como scaffold finding; entra apenas como precedente comparativo.
- Não medível localmente: cold-start Lambda, latência real Conexos/Nexxera/ERP, profundidade de fila. Recomendação embutida em §2 e no card `performance-2` (o Módulo 6 metrics port real DEVE emitir histogramas por estágio).
- Cross-QA para o consolidator: **F-performance-2 sobrepõe-se a `fault-tolerance` + `availability`** (timeout ausente = 3 QAs). **F-performance-4 sobrepõe-se a `modifiability`** (schema-as-code / migrations). **F-performance-5 sobrepõe-se a `modifiability`** (contrato de repo). **F-performance-1** dialoga com `deployability` (definir `FANOUT_LIMIT` como config, não constante hardcoded).
