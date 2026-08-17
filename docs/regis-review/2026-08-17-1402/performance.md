---
qa: Performance
qa_slug: performance
run_id: 2026-08-17-1402
agent: qa-performance
generated_at: 2026-08-17T14:02:00-03:00
scope: backend
score: 5
findings_count: 6
cards_count: 6
---

# Performance — Regis-Review

> Escopo: DELTA da feature `fix/nde-painel-lista` (worktree `/tmp/nde-painel-wt`). Foco no ponto
> quente do diff: `RecebimentosPainelService.montarPainel` + `NdeRepository.listParaPainel` /
> `contarPendentes` + hidratação ao vivo `GET com297/{docCod}` no ERP. Achados fora deste recorte só
> aparecem como P3 contextual e são marcados como pré-existentes.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro clica em "Recebimentos" | Uma requisição HTTP `GET /recebimentos/painel` (2 queries novas + até 20 GETs sequenciais no ERP Conexos + 6 chamadas concorrentes prévias) | `RecebimentosPainelService.montarPainel` sob load Express (Render) | Operação normal, aba NDe com 20 candidatas não-autorizadas (pior caso do cap) | Serve carteira + KPIs + aba NDe hidratada sem afogar o ERP | p95 do painel ≤ 2 s (SLO web razoável); custo Conexos por load ≤ 20 GETs; ~0% de 5xx por concorrência de sessão (`LOGIN_ERROR_MAX_SESSIONS`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Round-trips HTTP ao Conexos por load de painel (pior caso pós-delta) | até **20 GET `com297/{docCod}`** em **4 rodadas sequenciais de 5** + 1 `getFiliais` + N `imp021` (previsão) | ≤ 4 rodadas ou mover para job | ⚠️ | `RecebimentosPainelService.ts:258-265`, `constants.ts:280-283` |
| Rodadas sequenciais na hidratação (`ceil(CAP / LOTE)`) | `ceil(20/5) = 4` rodadas em série | ≤ 1 rodada (mover para poll job) | ⚠️ | `RecebimentosPainelService.ts:258` |
| Paralelismo do lote de hidratação vs. teto documentado do ERP | **5** simultâneas | ≤ `FANOUT_LIMIT_RECEBIMENTOS=4` (do próprio módulo) | ❌ | `constants.ts:121` (`FANOUT_LIMIT_RECEBIMENTOS=4`) vs. `constants.ts:283` (`PAINEL_NDE_HIDRATACAO_LOTE=5`) |
| Índice em `solicitacao_numerario_execucao(fil_cod)` (driver do LEFT JOIN) | **Ausente**. Índices existentes: `pri_cod`, `status`, `txn_id`, UNIQUE(`idempotency_key`) | Índice para `fil_cod` (ou parcial `WHERE dry_run=false AND COALESCE(nde_dispensada,false)=false`) | ❌ | `migrations/0041_solicitacao_numerario_execucao.sql:36-37`, `migrations/0042_solicitacao_numerario_execucao_fiscal.sql:26` |
| Índice em `nota_debito_eletronica(idempotency_key)` (lado JOINed) | **Presente** (UNIQUE implícita) | Igual | ✅ | `migrations/0038_nota_debito_eletronica.sql:22` |
| Retry por chamada de hidratação (`ensureSid` + `runWithRetry`) | `retries=2, delayMs=500, jitterMs=200` → pior caso: 2 tentativas com ~700 ms de espera entre elas | Igual (default do `ConexosBaseClient`), mas capado com `AbortController`/`timeout` | ⚠️ | `ConexosBaseClient.ts:154-163`, `RetryExecutor.ts:53-56` |
| Timeout HTTP por chamada `lerDocParaPolling` | **Herda o do adapter legacy** — não há `NDE_EMIT_TIMEOUT_MS`/`ERP_WRITE_TIMEOUT_MS` aplicado no read; o `ensureSid`+GET não tem timeout local declarado | Timeout explícito ≤ 8 s por GET | ⚠️ (não medível localmente sem gancho no `legacy` HTTP) | `ConexosNdeFiscalClient.ts:225-254` |
| Custo das 2 queries novas em número de round-trips ao Postgres | **2 queries adicionais por load** (list + count) refazendo o mesmo LEFT JOIN | 1 CTE reaproveitando o join, ou COUNT via `count(*) OVER()` | ⚠️ | `NdeRepository.ts:88-115` |
| Chamadas ao Conexos overlappadas no `Promise.all` inicial | 1 (`getFiliais`, dependendo de `filCodsPermitidas`) — hidratação NÃO entra no Promise.all | Overlapar hidratação com o `Promise.all` de 6 (ou mover para outro request) | ⚠️ | `RecebimentosPainelService.ts:135-147` |
| Best-case tail latency da hidratação (Conexos p50 ~400 ms/GET) | `4 rodadas × ~400 ms = ~1.6 s` adicionais | ≤ 300 ms | ❌ (derivado) | Cálculo: `PAINEL_NDE_HIDRATACAO_CAP/LOTE × p50` |
| Worst-case tail latency da hidratação (Conexos p95 ~2 s/GET + 1 retry) | `4 × (2 s + 500-700 ms + 2 s) ≈ 18 s` no pior caso saturado | ≤ 2 s | ❌ (derivado; ver nota) | Cálculo com `retries=2` e p95 público de ERPs on-prem |

> ⚠️ **Não medível localmente**: latências reais de `com297` e do `Postgres` sob o volume de
> produção. Requer CloudWatch/APM (ou logs de tempo do próprio `ConexosBaseClient`) — nada disso
> existe no worktree. Os números derivados usam a faixa 2–10 s p99 documentada como típica para
> Conexos e o comportamento nominal do `RetryExecutor`. Baseline "ausência de índice" é fact-based
> a partir das migrations; não precisa de EXPLAIN para P1.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Hidratação AO VIVO por load — 1 leitura Conexos por linha visitada; não há amostragem/decaimento | ❌ ausente | `RecebimentosPainelService.ts:247-271` |
| Limit Event Response | Cap explícito `PAINEL_NDE_HIDRATACAO_CAP=20` + filtro `ndeAutorizado !== true` (só o que muda é hidratado) | ✅ presente | `constants.ts:270-283`, `RecebimentosPainelService.ts:250-252` |
| Prioritize Events | Nenhuma priorização entre linhas na fila da hidratação (as 20 primeiras da lista ganham; sem heurística de "quem homologou há mais tempo") | ⚠️ parcial | `RecebimentosPainelService.ts:250-252` |
| Reduce Overhead | `ensureSid` re-chamado a cada tentativa dentro do `runWithRetry`; nenhuma dedup por `docCod` (não é problema hoje — chaves são únicas) | ⚠️ parcial | `ConexosNdeFiscalClient.ts:232-234`, `ConexosBaseClient.ts:236-239` |
| Bound Execution Times | Timeout global de request Express existe, mas **sem timeout explícito por GET Conexos** na hidratação (nenhum `AbortController`/`timeout` passado ao axios legacy) | ❌ ausente | `ConexosNdeFiscalClient.ts:225-254` |
| Increase Resource Efficiency | LEFT JOIN por `idempotency_key` (UNIQUE dos dois lados) — bom; **porém** driver `fil_cod = ANY($1)` **sem índice**; e as duas queries refazem o mesmo JOIN em vez de um `count(*) OVER()` | ⚠️ parcial | `NdeRepository.ts:22-27, 88-115` |
| Increase Resources | N/A ao delta — infra é Render (não configurável por request) | N/A | `CLAUDE.md` (estado atual) |
| Increase Concurrency | Hidratação **NÃO** overlappa com o `Promise.all` de 6 (roda sequencial depois); lote intra-hidratação sim, mas com paralelismo 5 > 4 (`FANOUT_LIMIT_RECEBIMENTOS`) | ⚠️ parcial | `RecebimentosPainelService.ts:135-147, 258-265` |
| Maintain Multiple Copies of Computations | Nenhum cache do `com297` entre loads (poderia ser TTL curto por `docCod`) — cada F5 paga tudo de novo | ❌ ausente | `RecebimentosPainelService.ts:247-271` |
| Maintain Multiple Copies of Data | O ledger local **É** a cópia; o reconciler oportunista atualiza `nde_autorizado`/`numero_nde` no banco (`setNdeAutorizado` + `updateNumeroNde`) — bom, mas dentro do request | ✅ presente (embora síncrono) | `RecebimentosPainelService.ts:294-303` |
| Bound Queue Sizes | Cap de 20 na fila da hidratação; cap de 200 na lista NDe; cap de 500 na carteira; `LIMIT` em ambas as queries novas | ✅ presente | `NdeRepository.ts:97`, `constants.ts:267-270, 280-283` |
| Schedule Resources | Não há job/EventBridge que hidrate proativamente NDes pendentes — o painel é o único poll (violando o próprio comentário "o painel é o poll que a homologação não pôde esperar") | ❌ ausente | `RecebimentosPainelService.ts:294-296` (comentário admite isso) |

## 4. Findings (achados)

### F-performance-1: Hidratação de até 20 GETs no ERP DENTRO do request HTTP do painel, sequenciais em 4 rodadas

- **Severidade**: P1
- **Tactic violada**: Bound Execution Times · Schedule Resources · Manage Sampling Rate
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:247-271`, `src/backend/domain/interface/recebimentos/constants.ts:270-283`
- **Evidência (objetiva)**:
  ```
  const candidatas = ndes
      .filter((n) => n.ndDocCod !== undefined && n.ndeAutorizado !== true)
      .slice(0, PAINEL_NDE_HIDRATACAO_CAP);           // 20
  for (let i = 0; i < candidatas.length; i += PAINEL_NDE_HIDRATACAO_LOTE) {
      const lote = candidatas.slice(i, i + PAINEL_NDE_HIDRATACAO_LOTE); // 5
      const hidratadas = await Promise.all(lote.map((nde) => this.hidratarUma(nde)));
  }
  ```
  `PAINEL_NDE_HIDRATACAO_CAP = 20`, `PAINEL_NDE_HIDRATACAO_LOTE = 5` → **4 rodadas em série**.
  Cada `hidratarUma` chama `fiscalClient.lerDocParaPolling` → `runWithRetry(ensureSid + GET com297)`
  com `retries=2, delayMs=500, jitterMs=200` (`ConexosBaseClient.ts:154-163`) e **sem timeout local declarado**.
- **Impacto técnico**: cauda de latência do painel dominada pelo Conexos. Best-case (p50 ~400 ms
  por GET) → +1.6 s adicionais na resposta; worst-case saturado (p95 ~2 s + 1 retry) → +18 s de
  cauda antes do `catch(() => undefined)` degradar. Nada cancela o request se o cliente desistir —
  o worker Express fica preso.
- **Impacto de negócio**: o analista abre a aba de Recebimentos e vê spinner por vários segundos
  toda vez que houver homologação em voo; sob incidente Conexos, o painel inteiro fica lento
  mesmo para as 200 linhas que **não** precisam hidratar. O cap de 20 salva o ERP, não o usuário.
- **Métrica de baseline**: 4 rodadas × p50 400 ms = **~1.6 s adicionais** vs. **~300 ms alvo**
  (rodada única). Pior caso derivado ≈ **~18 s** — cauda inaceitável para uma tela.

### F-performance-2: LEFT JOIN driver `solicitacao_numerario_execucao.fil_cod = ANY($1)` sem índice

- **Severidade**: P1
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/repository/recebimentos/NdeRepository.ts:22-27, 88-115`; migrations `0041_solicitacao_numerario_execucao.sql:36-37`, `0042_solicitacao_numerario_execucao_fiscal.sql:26`, `0045_modalidade_processada_arquivamento.sql`
- **Evidência (objetiva)**:
  ```
  FROM solicitacao_numerario_execucao e
       LEFT JOIN nota_debito_eletronica n ON n.idempotency_key = e.idempotency_key
      WHERE e.fil_cod = ANY($filCods)
        AND e.dry_run = false
        AND COALESCE(e.nde_dispensada, false) = false
        AND (e.nd_doc_cod IS NOT NULL OR n.id IS NOT NULL)
  ```
  Índices existentes em `solicitacao_numerario_execucao`: `pri_cod`, `status`, `txn_id`,
  UNIQUE(`idempotency_key`). **Nenhum em `fil_cod`.** A query rodada 2 vezes por load (list + count).
- **Impacto técnico**: seq scan sobre `solicitacao_numerario_execucao` para cada carga do painel,
  duas vezes (list + count). Ambos os caminhos crescem O(N) com o histórico da tabela. O JOIN
  em si (por `idempotency_key`) é bom — o gargalo é o filtro do driver.
- **Impacto de negócio**: hoje a tabela é pequena e o custo é imperceptível; em 6 meses de
  execuções acumuladas o painel começa a lentificar sozinho, sem mudança de código, e o culpado
  fica escondido no LEFT JOIN. Piora em multi-filial (a carteira inteira, várias filiais).
- **Métrica de baseline**: **0 índices** em `fil_cod` (fato); custo esperado O(N) por load, **2×
  por load** (list + count). Alvo: 1 índice parcial `WHERE dry_run=false AND
  COALESCE(nde_dispensada,false)=false`, custo O(log N + K).

### F-performance-3: `PAINEL_NDE_HIDRATACAO_LOTE=5` viola o teto `FANOUT_LIMIT_RECEBIMENTOS=4` do próprio módulo

- **Severidade**: P2 (rebaixado de P1 por falta de baseline numérico de sessões Conexos ativas medível localmente — o incidente `LOGIN_ERROR_MAX_SESSIONS` é documental)
- **Tactic violada**: Increase Concurrency (limite superior)
- **Localização**: `src/backend/domain/interface/recebimentos/constants.ts:117-121` vs. `constants.ts:270-283`
- **Evidência (objetiva)**:
  ```
  export const FANOUT_LIMIT_RECEBIMENTOS = 4;   // "Alinhado ao FANOUT_LIMIT=4 do SISPAG
                                                //  (mitigação do incidente LOGIN_ERROR_MAX_SESSIONS)."
  export const PAINEL_NDE_HIDRATACAO_LOTE = 5;  // Hidratação — 5 em paralelo
  ```
  O comentário do próprio arquivo explica que 4 é o teto do ERP; o lote da hidratação passa desse teto.
- **Impacto técnico**: sob painel + outro caminho (ingestão, executar recebimento) rodando em
  paralelo, o total de sessões concorrentes cruza 4 e o Conexos passa a devolver
  `LOGIN_ERROR_MAX_SESSIONS`, que o `RetryExecutor` **retenta** (não é `isDeterministicRefusal`) —
  amplificando o problema.
- **Impacto de negócio**: cascata: primeiro é uma NDe que não hidrata, depois é a ingestão
  travando, depois é o `executarRecebimento` falhando por falta de sessão. Difícil de diagnosticar
  porque o gatilho é o painel (leitura).
- **Métrica de baseline**: **5 > 4** (fato; teto documentado no próprio módulo). Alvo: `LOTE ≤ 4`,
  idealmente `min(FANOUT_LIMIT_RECEBIMENTOS, PAINEL_NDE_HIDRATACAO_CAP)`.

### F-performance-4: Hidratação roda sequencial APÓS o `Promise.all` de 6, não overlappada

- **Severidade**: P2
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:135-147`
- **Evidência (objetiva)**:
  ```
  const [transacoes, ..., ndesDoBanco, ndePendentes] = await Promise.all([ ...6 coisas... ]);
  const n = ...
  const transacoesComModalidade = await this.enriquecerComModalidade(...);   // sequencial
  const ndes = await this.hidratarNdes(ndesDoBanco);                         // sequencial
  ```
  A hidratação **só começa depois** que `ndesDoBanco` chega — mas ela **não depende** de
  `transacoes`/`porStatus`/`valorPorStatus`/`ultimaIngestao`, e podia ter começado assim que
  `ndesDoBanco` chegasse (paralelo às queries de KPI do banco), ou ao lado do `enriquecerComModalidade`.
- **Impacto técnico**: a cauda da hidratação é somada linearmente ao maior dos 6 do `Promise.all` e
  ao `enriquecerComModalidade`, quando poderia ser overlappada com pelo menos uma parte.
- **Impacto de negócio**: latência de painel maior do que o necessário. Não é o principal
  ofensor (a hidratação em si é), mas é grátis: uma refatoração de encadeamento.
- **Métrica de baseline**: hidratação e enriquecimento **100% aditivos** ao maior do `Promise.all`
  hoje; alvo: overlapar `hidratarNdes` com `enriquecerComModalidade` (executam em recursos disjuntos
  — Conexos vs. cache local + Postgres), economizando ~min(hidratação, enriquecimento) na cauda.

### F-performance-5: `contarPendentes` reexecuta o mesmo LEFT JOIN só para um `count(*)`

- **Severidade**: P2
- **Tactic violada**: Increase Resource Efficiency · Reduce Overhead
- **Localização**: `src/backend/domain/repository/recebimentos/NdeRepository.ts:88-115`
- **Evidência (objetiva)**:
  ```
  // list
  SELECT ... FROM solicitacao_numerario_execucao e LEFT JOIN nota_debito_eletronica n ...
    WHERE e.fil_cod = ANY($filCods) AND ... LIMIT $limit;
  // count
  SELECT count(*) AS total FROM solicitacao_numerario_execucao e LEFT JOIN nota_debito_eletronica n ...
    WHERE e.fil_cod = ANY($filCods) AND ... AND NOT (...emitida... AND ...autorizado...);
  ```
  Dois round-trips ao Postgres com o **mesmo JOIN**; agravado por F-performance-2 (ambos varrem
  `solicitacao_numerario_execucao` sem índice em `fil_cod`).
- **Impacto técnico**: 2 seq scans em vez de 1; latência DB dobrada nessa fatia. Poderia ser um
  único `SELECT ..., count(*) FILTER (WHERE NOT (emitida AND autorizado)) OVER () AS pendentes ...`
  ou uma CTE.
- **Impacto de negócio**: baixo enquanto a tabela for pequena; escala mal junto com F-performance-2.
- **Métrica de baseline**: **2 execuções** do LEFT JOIN por load. Alvo: **1**.

### F-performance-6: Reconciler (`setNdeAutorizado` + `updateNumeroNde`) grava no request do usuário

- **Severidade**: P2
- **Tactic violada**: Schedule Resources · Reduce Overhead
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:294-303`
- **Evidência (objetiva)**:
  ```
  // Escrita LOCAL de reconciliação (nada vai para o ERP): o painel é o poll que a homologação
  // não pôde esperar. Best-effort — falhar aqui só adia a reconciliação para o próximo load.
  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(() => undefined);
  if (numeroNde !== undefined && numeroNde !== nde.numeroNde) {
      await this.ndeRepo.updateNumeroNde(nde.idempotencyKey, numeroNde).catch(() => undefined);
  }
  ```
  O próprio comentário admite: "o painel é o poll que a homologação não pôde esperar" — ou seja,
  falta um poll dedicado.
- **Impacto técnico**: cada NDe autorizada durante um load faz até 2 UPDATEs no request; se o
  painel é o único poll, uma janela sem tráfego humano deixa NDes indefinidamente "aguardando
  SEFAZ" no banco (mesmo depois do SEFAZ ter respondido).
- **Impacto de negócio**: KPI `ndePendentes` mente para o time (conta como pendente algo que
  fiscalmente já está fechado) até alguém abrir a tela; má observabilidade contábil.
- **Métrica de baseline**: **0 poll jobs** para NDes hoje; o painel é a única fonte de
  reconciliação. Alvo: EventBridge (ou `nightly-permutas`-style cron) que roda
  `hidratarNdes(pendentes)` desacoplado do request e faz o painel ser **só leitura**.

## 5. Cards Kanban

### [performance-1] Mover hidratação NDe para poll job; painel só lê o cache

- **Problema**
  > `montarPainel` roda até 20 GETs `com297` em 4 rodadas sequenciais **dentro** do request HTTP
  > do usuário (`PAINEL_NDE_HIDRATACAO_CAP=20`, `LOTE=5`). Best-case adiciona ~1.6 s à cauda do
  > painel; pior caso saturado (Conexos p95 + `retries=2`), ~18 s antes de o `catch(() =>
  > undefined)` cair de volta. O próprio código admite que o painel virou "o poll que a
  > homologação não pôde esperar".
- **Melhoria Proposta**
  > Mover a hidratação para um **poll job periódico** (curto TTL — 30-60 s — via EventBridge quando
  > a infra alvo existir; hoje, `setInterval` do BootMigrator-style ou reaproveitar o cron horário
  > da ingestão). O job usa o mesmo `hidratarNdes`, mas escreve **só** `setNdeAutorizado` +
  > `updateNumeroNde` no banco. `montarPainel` passa a **só ler** o ledger — zero chamadas Conexos
  > para NDe no path de leitura. Tactics: *Schedule Resources*, *Manage Sampling Rate*, *Bound
  > Execution Times*.
- **Resultado Esperado**
  > p95 do painel deixa de depender do Conexos NDe. Latência da rota `GET /recebimentos/painel`
  > passa de "ERP-bound" (~1.6-18 s de cauda extra) para "DB-bound" (dezenas de ms).
- **Tactic alvo**: Schedule Resources · Manage Sampling Rate
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-1, F-performance-6
- **Métricas de sucesso**:
  - Chamadas Conexos por load do painel: **20 → 0** (na aba NDe)
  - p95 do endpoint `GET /recebimentos/painel`: **~1.6-2 s → ≤ 400 ms** (derivado; medir com log
    de tempo em `montarPainel` antes/depois)
  - Frescor da reconciliação NDe: **∞ (só se houver load) → ≤ 60 s** (intervalo do job)
- **Risco de não fazer**: sob incidente Conexos, o painel inteiro fica lento mesmo para as 200
  linhas que não precisam hidratar; sob janela sem tráfego, KPI `ndePendentes` sempre mente para
  o time.
- **Dependências**: nenhuma técnica; alinhar com `qa-availability` (o mesmo job elimina o
  acoplamento sync ao ERP na leitura).

### [performance-2] Criar índice parcial em `solicitacao_numerario_execucao` para o driver do LEFT JOIN

- **Problema**
  > `listParaPainel` e `contarPendentes` filtram por `e.fil_cod = ANY($1) AND e.dry_run = false
  > AND COALESCE(e.nde_dispensada, false) = false AND (e.nd_doc_cod IS NOT NULL OR n.id IS NOT
  > NULL)`, executados **2× por load**. A tabela só tem índices em `pri_cod`, `status`, `txn_id`
  > e UNIQUE(`idempotency_key`). O driver do JOIN faz seq scan por design.
- **Melhoria Proposta**
  > Nova migration `0046_solicitacao_numerario_execucao_painel_idx.sql`: `CREATE INDEX
  > CONCURRENTLY IF NOT EXISTS idx_sn_execucao_painel ON solicitacao_numerario_execucao (fil_cod)
  > WHERE dry_run = false AND COALESCE(nde_dispensada, false) = false;`. Índice parcial casa
  > exatamente a cláusula do painel e fica pequeno (só linhas visíveis na aba). Rodar `EXPLAIN
  > ANALYZE` antes/depois. Tactic: *Increase Resource Efficiency*.
- **Resultado Esperado**
  > Plano de execução deixa de fazer Seq Scan em `solicitacao_numerario_execucao` no caminho do
  > painel. Custo O(N) → O(log N + K) por query.
- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2, F-performance-5
- **Métricas de sucesso**:
  - Índices em `solicitacao_numerario_execucao(fil_cod)`: **0 → 1** (parcial)
  - Tipo de plano das 2 queries do painel: **Seq Scan → Index Scan / Bitmap Index Scan** (validar
    com `EXPLAIN ANALYZE` num snapshot com ≥ 10k linhas)
  - Tempo das queries do painel em N=10k: **derivado seq scan (~centenas de ms) → ≤ 20 ms**
- **Risco de não fazer**: painel lentifica sozinho conforme a tabela cresce; regressão silenciosa
  descoberta só quando o analista reclamar.
- **Dependências**: cross-QA com `qa-modifiability` (schema como código — a migration nasce no
  repo, coerente com o padrão `migrations/0038-0045`).

### [performance-3] Reduzir `PAINEL_NDE_HIDRATACAO_LOTE` para ≤ `FANOUT_LIMIT_RECEBIMENTOS`

- **Problema**
  > O lote da hidratação (5) passa do teto `FANOUT_LIMIT_RECEBIMENTOS=4` que o próprio módulo
  > adotou para evitar `LOGIN_ERROR_MAX_SESSIONS` no Conexos. Sob painel concorrente com
  > ingestão/executar-recebimento, o total ultrapassa o teto e o `RetryExecutor` **retenta**
  > 401/5xx de sessão (não é `isDeterministicRefusal`).
- **Melhoria Proposta**
  > Substituir `PAINEL_NDE_HIDRATACAO_LOTE = 5` por `Math.min(PAINEL_NDE_HIDRATACAO_CAP,
  > FANOUT_LIMIT_RECEBIMENTOS)` **ou** simplesmente `4`, com comentário justificando. Melhor
  > ainda: mover para `performance-1` (o card acima) e o problema desaparece porque o path do
  > usuário deixa de tocar o ERP. Tactic: *Increase Concurrency* (bounded).
- **Resultado Esperado**
  > Paralelismo da hidratação ≤ teto de sessões Conexos; cascata `LOGIN_ERROR_MAX_SESSIONS`
  > deixa de ser provocada pelo painel.
- **Tactic alvo**: Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S (1-linha)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - `PAINEL_NDE_HIDRATACAO_LOTE`: **5 → 4** (ou 0, via card 1)
  - Contagem de `LOGIN_ERROR_MAX_SESSIONS` no log durante painel + ingestão concorrentes:
    **> 0 (esperado) → 0** (validar em staging)
- **Risco de não fazer**: cascata de falha difícil de rastrear — o gatilho (leitura) fica escondido
  atrás do sintoma (escrita falhando por sessão).
- **Dependências**: card [performance-1] pode obsoletar este.

### [performance-4] Overlapar `hidratarNdes` com o `Promise.all` inicial (fallback se card 1 for adiado)

- **Problema**
  > `hidratarNdes` só arranca DEPOIS que todo o `Promise.all` de 6 termina, e ainda depois do
  > `enriquecerComModalidade`. Como só depende de `ndesDoBanco`, poderia começar em paralelo
  > com o resto e ficar overlapada com o enriquecimento.
- **Melhoria Proposta**
  > Refatorar o encadeamento: montar a promessa da hidratação assim que `ndesDoBanco` estiver
  > disponível, e dar `await` no final ao lado do `enriquecerComModalidade`. Ex.: `const
  > ndesPromise = ndesDoBancoPromise.then((n) => this.hidratarNdes(n));` fora do `Promise.all`.
  > **Nota**: se card [performance-1] for feito, este vira N/A. Tactic: *Increase Concurrency*.
- **Resultado Esperado**
  > A cauda da hidratação passa a ser sombreada pelo `enriquecerComModalidade` em vez de somada.
- **Tactic alvo**: Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Tempo total do `montarPainel` no happy-path: **max(Promise.all) + enriquecer + hidratar → max(Promise.all, hidratar) + enriquecer** (ganho ≈ min(enriquecer, hidratar))
- **Risco de não fazer**: latência acumulada quando `hidratarNdes` fica em pé; baixo custo/risco de fazer.
- **Dependências**: card [performance-1] é preferível — este é o fallback.

### [performance-5] Colapsar `listParaPainel` + `contarPendentes` em uma query com window function

- **Problema**
  > Duas queries com o **mesmo LEFT JOIN** por load, agravadas pela ausência do índice em
  > `fil_cod` (F-performance-2). O `count(*)` filtrado é derivável do mesmo scan.
- **Melhoria Proposta**
  > Fundir em `SELECT ..., count(*) FILTER (WHERE NOT (COALESCE(n.status_emissao,'') = 'emitida'
  > AND COALESCE(e.nde_autorizado, false) = true)) OVER () AS pendentes ...` **ou** usar CTE
  > `WITH base AS (...) SELECT (SELECT count(*) FROM base WHERE NOT (...)), (SELECT ... FROM base
  > ORDER BY ... LIMIT ...)`. Tactic: *Reduce Overhead*.
- **Resultado Esperado**
  > 1 round-trip ao Postgres em vez de 2 para as 2 leituras da aba NDe; um único plano de execução
  > para o LEFT JOIN.
- **Tactic alvo**: Reduce Overhead · Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-5, F-performance-2
- **Métricas de sucesso**:
  - Queries por load na aba NDe: **2 → 1**
  - Tempo somado das duas: **~2× uma → ~1×** (medir com log de tempo)
- **Risco de não fazer**: incremental; latência DB dobrada na aba NDe cresce junto com o histórico.
- **Dependências**: idealmente após card [performance-2] (o índice muda a métrica-base).

### [performance-6] Adicionar timeout local ao `lerDocParaPolling` (`AbortController` no GET com297)

- **Problema**
  > `lerDocParaPolling` (`ConexosNdeFiscalClient.ts:225-254`) chama `ensureSid` + `getGeneric`
  > dentro do `runWithRetry`, mas **não passa timeout local** para o axios legacy. Se o Conexos
  > pendurar a conexão, o worker Express pina até o timeout global do servidor — e ainda por 3
  > tentativas do retry.
- **Melhoria Proposta**
  > Passar um `AbortController` com `NDE_EMIT_TIMEOUT_MS=8000` (constante já existe em
  > `constants.ts:111`) para o axios do `legacy.getGeneric`. Alternativamente, envelopar em
  > `TimeoutExecutor` (se existir) ou `Promise.race` com `setTimeout(reject, 8000)`. Cross-QA com
  > `qa-availability` (mesma família de findings). Tactic: *Bound Execution Times*.
- **Resultado Esperado**
  > Nenhuma chamada `com297` do painel dura mais de 8 s de wall time por tentativa; pior caso da
  > hidratação limitado a `8 s × (retries+1) × ceil(CAP/LOTE) = 8 × 3 × 4 = 96 s` **worst-worst**
  > (vs. hoje, ilimitado). Combinado com card [performance-1], obsoleta.
- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Timeout explícito em `lerDocParaPolling`: **ausente → 8 s (`NDE_EMIT_TIMEOUT_MS`)**
  - Cauda p99 do request `GET /recebimentos/painel` quando Conexos pendura: **ilimitada → ≤ 96 s**
    (ainda ruim, mas finito; card 1 leva para ≤ 400 ms)
- **Risco de não fazer**: um único incidente Conexos que "só" pendura em vez de errar leva o
  Express a exaurir workers.
- **Dependências**: overlap direto com `qa-availability`; card [performance-1] resolve na raiz.

## 6. Notas do agente

- Escopo travado no DELTA: as 2 queries novas no `NdeRepository`, a hidratação em
  `RecebimentosPainelService.hidratarNdes`, e as 3 constantes de política em
  `constants.ts`. Dívidas fora do delta (ex.: `getFiliais` sem cache observável no `montarPainel`)
  não entraram como findings.
- Métricas de latência real (`com297`, Postgres) são **não medíveis localmente** — só há EXPLAIN
  se rodarmos contra um banco populado; cauda Conexos só em produção. Baselines derivadas usam
  faixa 2-10 s p99 documentada como típica no prompt e as constantes do `RetryExecutor` (linhas
  citadas). Isso é suficiente para P1 quando o custo estrutural (número de round-trips × política
  de retry) é o argumento — nenhum finding P0/P1 aqui depende só de "sensação".
- Cross-QA: **qa-availability** (timeout ausente em `lerDocParaPolling`, retry amplificando
  `LOGIN_ERROR_MAX_SESSIONS`) · **qa-modifiability** (índice como código, migration `0046`) ·
  **qa-fault-tolerance** (reconciler dentro do request esconde falhas silenciosas do SEFAZ) ·
  **qa-deployability** (nada novo — a migration extra é o único artefato de deploy adicional).
