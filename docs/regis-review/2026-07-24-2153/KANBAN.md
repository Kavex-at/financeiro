---
type: regis-review-kanban
run_id: 2026-07-24-2153
scope: Frente IV base scaffold (contracts-first, fully-stubbed)
total: 42
counts: { p0: 1, p1: 13, p2: 21, p3: 7 }
merge_note: "F-availability-1 (P0) + F-integrability-1 (P1) + F-fault-tolerance-1 (P1) foram consolidados no card unico p0-executar-recebimento-safety. Os cards originais availability-1 / integrability-1 / fault-tolerance-1 nao aparecem separadamente abaixo — foram absorvidos."
---

# Kanban — financeiro / Frente IV base scaffold — 2026-07-24-2153

> Importavel para o Kanban do time. Cada card abaixo ja tem Problema / Melhoria Proposta / Resultado Esperado, alem de metricas de sucesso e risco de nao fazer, copiados verbatim das secoes qa-*.md deste run_id.
> Ordem: P0 (S -> XL), depois P1 (S -> XL), P2 (S -> XL), P3 (S -> XL).
> Pipeline rule: apenas o P0 re-entra o AutoLoopRunner antes do commit. P1/P2/P3 vao para `ontology/_inbox/frente-iv-base-scaffold-regis-followups.md`.

---

## P0 — Critico (bloqueia commit)

### [p0-executar-recebimento-safety] Envolver executarRecebimento em try/catch + markError + metrics.emit(error) — evitar dupla-baixa/dupla-NDe

**QA**: Fault Tolerance / Availability / Integrability (consolidado)
**Tactic alvo**: Recovery — Repair State + Exception Handling + Condition Monitoring + Observability of integration failures
**Esforco**: S
**Findings**: F-availability-1 (P0), F-integrability-1 (P1), F-fault-tolerance-1 (P1) — todos apontando para `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:183-264`

**Problema**
> O coordinator chama `beginExecution -> criarBordero -> gravarBaixa -> emitir -> markSettled` sem `try/catch`. Qualquer 5xx/timeout de Conexos/Nexxera/NDe deixa `recebimento_execucao` preso em `status='reconciling'` para sempre; retentativa acha `alreadySettled=false` e re-executa os POSTs irreversiveis, potencialmente duplicando baixa no fin010 e NDe (evento fiscal, nao apenas operacional). `grep -n 'try\|catch\|markError' RecebimentoPipelineService.ts` -> 0 hits. O irmao `ReconciliacaoPermutaService.ts:220-256` (mesmo repo, fluxo analogo) SIM tem o padrao — e a mesma classe de bug ja remediada no `ConexosBaixaClient.gravarBaixaPermuta`.

**Melhoria Proposta**
> Envolver o bloco 219-242 em `try { criarBordero; gravarBaixa; emitir; markSettled } catch (err) { await this.execucaoRepository.markError(idempotencyKey, { erroMensagem: String(err), erpResponse: err?.response ?? null }); this.metrics.emit({ stage: 'executarRecebimento', correlationId, outcome: 'error', attributes: { errorCode: err?.code ?? 'unknown' } }); throw err; }`. Preservar `borCod` no `markError` quando `criarBordero` ja respondeu antes da falha do `gravarBaixa`. Espelhar 1:1 o padrao de `permutas/ReconciliacaoPermutaService.ts:234-256`. Adicionar 3 testes (uma falha por POST externo) ao `RecebimentoPipelineService.test.ts`.

**Resultado Esperado**
> Nenhuma execucao fica presa em `reconciling`; toda falha vira `error` no ledger com payload cru; retentativa encontra estado terminal e decide de forma informada. Zero baixas duplicadas, zero NDe duplicadas — a promessa "no double-execution" fica testada, nao folclore.

**Metricas de sucesso**
- Chamadas externas envelopadas em try/catch: 0/3 -> 3/3
- Invocacoes de `markError` a partir do coordinator: 0 -> 1
- Emissoes de `MetricsEvent{ outcome: 'error' }` no estagio `executarRecebimento`: 0 -> 1
- Testes de caminho de erro no coordinator: 0 -> >=3 (uma falha por POST)
- Cobertura de branches do coordinator: 66.67% -> >=90%

**Risco de nao fazer**
> Primeira falha do Conexos em producao (historico Frente II: ~1 janela de manutencao/trimestre) resulta em baixa duplicada + NDe emitida em duplicidade quando o operador reexecutar o pipeline. Retrabalho manual de estorno no ERP + risco fiscal (NDe em duplicidade). E a unica classe de bug real que o scaffold introduziria em producao.

**Dependencias**: Nenhuma (a `markError` ja esta pronta no repositorio; o padrao ja esta provado em `ReconciliacaoPermutaService`).

---

## P1 — Alto

### [fault-tolerance-2] Adicionar setBorCod (e opcionalmente setRequestPayload) ao RecebimentoExecucaoRepositoryInterface

**QA**: Fault Tolerance
**Tactic alvo**: Repair State; Idempotent Replay
**Esforco**: S
**Findings**: F-fault-tolerance-2

**Problema**
> Se `criarBordero` retorna `borCod` mas o processo cai antes de `gravarBaixa`, o bordero fica orfao no Conexos e o ledger nao tem como associa-lo a linha em `reconciling`. O `RecebimentoExecucaoRepositoryInterface` so expoe `beginExecution + markSettled/markError`, faltando a persistencia incremental que Permutas usa (`setBorCod`, `setRequestPayload`) — as colunas ja existem na migracao 0035.

**Melhoria Proposta**
> Estender `RecebimentoExecucaoRepositoryInterface` (`ports.ts:199-206`) e a impl (`RecebimentoExecucaoRepository.ts`) com: `setBorCod(key, borCod)`, `setRequestPayload(key, payload)`. Coordenador chama `setBorCod` LOGO apos `criarBordero` retornar, ANTES de `gravarBaixa`.

**Resultado Esperado**
> Todo `borCod` criado e persistido antes do proximo POST — reaper consegue reconstruir a intencao mesmo em falha entre POSTs. Metodos incrementais no interface: 2 -> 4 (paridade com Permutas).

**Metricas de sucesso**
- Cobertura de recuperacao de orfao: 0% -> 100% (`bor_cod IS NOT NULL AND status='reconciling'` inspecionavel)
- Testes: +1 caso que quebra entre `criarBordero` e `gravarBaixa` e confirma `bor_cod` gravado

**Risco de nao fazer**
> Analista ganha borderos fantasma no Conexos sem rastro no dashboard da Frente IV — retrabalho manual crescente.

**Dependencias**: [p0-executar-recebimento-safety] (o try/catch fica em volta destes writes).

---

### [fault-tolerance-3] Aplicar WHERE versao = $expectedVersao no RecebimentoRepository.save (optimistic concurrency real)

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking; Comparison
**Esforco**: S
**Findings**: F-fault-tolerance-3

**Problema**
> A migracao 0033 declara `versao INTEGER NOT NULL DEFAULT 0` com o comentario "Concorrencia otimista (espelha o I6 do lote)", mas o `save` faz `versao = EXCLUDED.versao` sem `WHERE versao = $expected`. Dois writers concorrentes (analista + coordinator) se sobrescrevem sem deteccao — a invariante I-Receb-1 (Σ rateio <= valorRecebido) pode ser violada silenciosamente.

**Melhoria Proposta**
> Reescrever `RecebimentoRepository.save` para: `INSERT … ON CONFLICT (id) DO UPDATE SET … versao = recebimento.versao + 1 WHERE recebimento.versao = $expectedVersao RETURNING versao`. Se 0 linhas afetadas -> lancar `RecebimentoVersionConflictError` (novo, analogo a `IllegalTransitionError`, 409 retryable=false).

**Resultado Esperado**
> Escrita concorrente vencida detecta conflito e falha com 409 explicito em vez de sobrescrever silenciosamente. 100% dos updates via versao esperada.

**Metricas de sucesso**
- Testes de conflito de versao: 0 -> >=2 (write concorrente rejeitado; write com versao correta incrementa)
- Repositorios respeitando `versao` no WHERE: 0/1 -> 1/1

**Risco de nao fazer**
> Divergencia silenciosa entre rateio manualmente editado pelo analista e rateio recomputado pelo coordinator — auditoria vira "quem gravou por ultimo ganhou".

**Dependencias**: Nenhuma.

---

### [availability-2] Adicionar timeoutMs opcional aos ports externos (Nexxera, ErpReceivables, NdeEmitter)

**QA**: Availability
**Tactic alvo**: Monitor / Exception Prevention / Bound Execution Times
**Esforco**: S
**Findings**: F-availability-2 (cross: F-performance-2)

**Problema**
> Nenhum dos ports externos expoe timeout ou `AbortSignal`. Quando os 6 teammates aterrissarem as implementacoes reais, e altamente provavel que reproduzam o contrato sem timeout — e uma unica chamada travada pode pinar um worker por 15 min (Lambda alvo) ou indefinidamente (Express atual).

**Melhoria Proposta**
> Adicionar `timeoutMs?: number` (com default definido no adapter) aos parametros de `NexxeraGatewayInterface.fetch`, `ErpReceivablesGatewayInterface.criarBordero`/`gravarBaixa` e `NdeEmitterInterface.emitir` em `ports.ts:132-171`. Documentar no docstring que o adapter real deve honrar o teto. Alternativamente (mais forte): tipo utilitario `type WithTimeout<T> = T & { timeoutMs?: number }`.

**Resultado Esperado**
> Contratos que os modulos 1 e 5 aterrissarem ja obrigam o desenvolvedor a decidir o teto; nenhum port externo sem timeout.

**Metricas de sucesso**
- Ports externos com `timeoutMs` no contrato: 0/3 -> 3/3
- Novo teste que reprova adapter sem timeout

**Risco de nao fazer**
> Em 6 meses, com 3 adapters reais aterrissados, adicionar timeout vira refactor cross-modulos com risco de regressao.

**Dependencias**: Nenhuma; recontratar antes do Modulo 1 aterrissar.

---

### [availability-3] Instanciar politica central de retry via RetryExecutor no executarRecebimento

**QA**: Availability
**Tactic alvo**: Retry
**Esforco**: S
**Findings**: F-availability-3

**Problema**
> `RetryExecutor` esta disponivel em `libs/executor/` e e o padrao canonico do repo, mas o scaffold nao o incorpora. Sem uma politica central, cada um dos 6 modulos vai improvisar (ou nao) retry — resultando em 6 comportamentos diferentes na chamada ao Conexos.

**Melhoria Proposta**
> Aplicar Retry: injetar `RetryExecutor` (ou factory) no `RecebimentoPipelineService` e envolver `criarBordero`/`gravarBaixa`/`emitir` em `retry.execute(() => …, { attempts: 3, delayMs: 1000, isRetryable: (e) => e.retryable !== false })`. Coordenar com [p0-executar-recebimento-safety]: `markError` so depois de esgotadas as tentativas. So retryable transitorio (5xx/timeout); 4xx do ERP (regra fiscal) nao retryable.

**Resultado Esperado**
> Falhas transitorias (janela de manutencao Conexos, blip Nexxera) absorvidas sem alarme; politica de retry uniforme para todos os writes da frente.

**Metricas de sucesso**
- Usos de `RetryExecutor` no scaffold: 0 -> 3 (uma por chamada externa)
- Testes: caso que confirma 3 tentativas antes do `markError`

**Risco de nao fazer**
> Pico de manutencao do ERP (~1h/mes) vira 100% de falhas P2 evitaveis.

**Dependencias**: [p0-executar-recebimento-safety] (o catch existir para o retry desistir dentro dele).

---

### [performance-1] Adicionar seam runMany + injetar BoundedConcurrency no port de ingestao

**QA**: Performance
**Tactic alvo**: Increase Concurrency / Schedule Resources
**Esforco**: S
**Findings**: F-performance-1

**Problema**
> `IngestaoTransacoesInterface.run` recebe 1 filCod por chamada; o coordinator nao injeta `BoundedConcurrency` nem menciona pool. O unico caminho para fan-out multi-filial (Fase 1) e `Promise.all(filCods.map(...))` — exatamente o burst que estourou `LOGIN_ERROR_MAX_SESSIONS` no SISPAG (mitigado com `FANOUT_LIMIT=4`). O scaffold nao previne a repeticao.

**Melhoria Proposta**
> Espelhar o padrao `IngestaoPagamentosService`: adicionar a assinatura `runMany(filCods: number[], periodo: NexxeraFetchPeriod, correlationId, triggeredBy): Promise<IngestaoTransacoesResult>` em `IngestaoTransacoesInterface`; injetar `BoundedConcurrency` no scaffold do stub (documentando `FANOUT_LIMIT_RECEBIMENTOS`, alinhado ao 4 do SISPAG); no port, expor tambem `advisoryLockKey: number` (constante namespaced diferente do `PAGAMENTO_INGEST_LOCK_KEY`) para o Modulo 1 chegar ja com contrato de exclusao.

**Resultado Esperado**
> Fan-out diario de 10 filiais executa com no maximo 4 sessoes Conexos simultaneas; 0 `LOGIN_ERROR_MAX_SESSIONS`; teammates da Fase 1 nao tem como "esquecer" o bounded pool (assinatura forca-lhes o padrao). Metrica: `p95 fan-out(10 filiais x 200 movimentos)` de baseline potencial 60 s -> <= 30 s (pool 4).

**Metricas de sucesso**
- Metodos concurrency-aware no port: 0 -> 1 (`runMany`)
- `BoundedConcurrency` injetado no stub: nao -> sim
- Constante `FANOUT_LIMIT_RECEBIMENTOS` documentada: ausente -> presente

**Risco de nao fazer**
> Primeira execucao real da Fase 1 reproduz o incidente Conexos -> dia perdido em firefighting; retrabalho de contrato depois que 6 teammates ja escreveram o consumidor.

**Dependencias**: —

---

### [performance-2] Padronizar timeoutMs + envelope RetryExecutor nos ports externos (Nexxera / ERP / NDe)

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforco**: S
**Findings**: F-performance-2 (cross: fault-tolerance, availability)

**Problema**
> Nenhum port externo (`NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`, `NdeEmitterInterface`) declara `timeoutMs`/`AbortSignal`. O coordinator faz `await` puro. Sob incidente Conexos (p99 ja observado 10 s+; 504 ja foi incidente real no SISPAG), 1 chamada pendurada trava o worker ate o timeout global da funcao.

**Melhoria Proposta**
> 1) Adicionar `readonly timeoutMs: number` (ou 2o param `opts: { timeoutMs, signal }`) em cada metodo dos 3 ports externos; 2) No coordinator, envelopar cada chamada externa com `RetryExecutor` ja existente — `attempts=3, delayMs=500, timeoutMs=port.timeoutMs`; 3) constantes de timeout em `constants.ts`: `NEXXERA_FETCH_TIMEOUT_MS=15000`, `ERP_WRITE_TIMEOUT_MS=8000`, `NDE_EMIT_TIMEOUT_MS=8000`.

**Resultado Esperado**
> 100% das chamadas externas com teto de latencia conhecido; sob incidente Conexos, worker libera em <= timeout x attempts em vez de segurar 60 s+; ledger `recebimento_execucao` marca `error` com mensagem clara em vez de "unknown". Metrica: p95 de duracao de estagio `executarRecebimento` sob falha 60 s -> <= 25 s (8 s x 3 attempts).

**Metricas de sucesso**
- Ports com `timeoutMs` explicito: 0/3 -> 3/3
- Chamadas do coordinator envelopadas em `RetryExecutor`: 0/5 -> 3/5 (so as externas)

**Risco de nao fazer**
> 1 incidente Conexos = MTTR alto e recebimentos travados em `reconciling`; time culpa Nexxera antes de olhar o proprio codigo.

**Dependencias**: coordenar com availability-2 e availability-3 (mesma edit em ports.ts).

---

### [modifiability-1] Persistir agregado completo em RecebimentoRepository.save (rateios + regras)

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforco**: M
**Findings**: F-modifiability-1

**Problema**
> `RecebimentoRepository.save` grava apenas a raiz do agregado; `mapRow` devolve `rateios: []` e `regrasAplicadas: []`. Quando o Modulo 3 for real, um reload perde o rateio ja calculado, forcando recomputo com risco de inconsistencia silenciosa.

**Melhoria Proposta**
> Estender `save` para escrever tambem `rateio_recebimento` (0034) e a associacao de regras aplicadas na mesma transacao. `findById` deve reidratar tudo. Se a decisao for manter o repo "raiz-only", renomear para `saveRoot`/`findByIdRoot` e criar um `RecebimentoAggregateRepository` que compoe os 3 repos — mas explicitar no contrato.

**Resultado Esperado**
> `save(r); const r2 = await findById(r.id); expect(r2.rateios).toEqual(r.rateios)` verde. Metrica: relacionamentos-filho persistidos por `save` — 0/2 -> 2/2. Test-coverage do repo sobre `rateios/regrasAplicadas` — 0% -> 100%.

**Metricas de sucesso**
- Relacionamentos-filho persistidos: 0/2 -> 2/2
- `RecebimentoRepository` test coverage sobre membros do agregado: 0% -> >=90%

**Risco de nao fazer**
> Dupla execucao parcial de rateio no primeiro incidente de retry apos a Fase 3; investigacao lenta porque a spine "some" e reaparece diferente.

**Dependencias**: Nenhuma (pode entrar na Fase 3 junto com o `RateioService` real).

---

### [security-2] Blindar correlationId/idempotencyKey contra colisao maliciosa entre atores

**QA**: Security
**Tactic alvo**: Validate Input / Limit Exposure
**Esforco**: S
**Findings**: F-security-2

**Problema**
> O cliente crava `correlationId` livre (`z.string().min(1)`), o servidor concatena `receb:` e usa como `id`/`naturalKey`/`idempotencyKey`. O Ator A pode envenenar a chave `receb:X` para que o Ator B receba `alreadySettled: true` ao rodar com o mesmo `correlationId` — denial-of-execution OU carona no ledger do outro. O ledger e o coracao da idempotencia money-moving.

**Melhoria Proposta**
> No `runPipelineSchema`: `correlationId: z.string().uuid()`. Na composicao da idempotency-key, incluir o `sub` do `req.user` (ou o `filCod` autorizado) no prefixo — `receb:${req.user.sub}:${uuid}` — para que a colisao exija tambem colisao de sub.

**Resultado Esperado**
> Colisao de idempotency-key entre atores diferentes e impossivel por construcao. Metrica: 1 idempotency-key sem tenant/user-scope -> 0.

**Metricas de sucesso**
- Idempotency-keys sem UUID guard: 1 -> 0
- Idempotency-keys sem user/tenant-scope: 1 -> 0

**Risco de nao fazer**
> Um insider (ou script que scan-brute-forceie `correlationId` sequenciais) transforma o ledger em bloqueio-de-execucao do time inteiro. Sintoma visto: recebimentos legitimos retornam `alreadySettled: true` sem NDe emitida.

**Dependencias**: Nenhuma (mudanca local a rota).

---

### [security-1] Introduzir authz por-filial (assertUserCanActOnFilial) em POST /recebimentos/pipeline/run

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforco**: M
**Findings**: F-security-1

**Problema**
> A rota `POST /recebimentos/pipeline/run` aceita `filCod` no body e delega direto ao coordinator, com apenas `requireRole('admin')` — sem checar que o `req.user` tem permissao sobre aquela filial. Em dominio money-moving multi-filial, um analista de SP pode disparar bordero/baixa/NDe em MG so mudando um numero no body.

**Melhoria Proposta**
> Criar `assertUserCanActOnFilial(req.user, filCod)` como middleware ou helper server-side. Popular a lista de filiais permitidas pela identidade do usuario (via `app_user`, `conexosIdentityMiddleware` ou JWT claim `permissions`). Rejeitar com 403 quando `filCod` nao estiver na lista. Aplicar no `POST /pipeline/run` (e replicar a mesma tactic no SISPAG para paridade).

**Resultado Esperado**
> 100% das rotas money-moving validam `filCod` do body contra a filial-permitida do usuario. Analista de SP disparando na filial MG -> 403 (log + audit trail). Metrica: rotas de write com authz por-filial: 0 -> 2 (Frente II + Frente IV).

**Metricas de sucesso**
- Rotas money-moving com authz por-filial: 0 -> 2 (`POST /recebimentos/pipeline/run`, `POST /sispag/lotes/:id/finalizar`)
- Test de integracao cobrindo `filCod` cross-tenant: 0 -> 1 por rota

**Risco de nao fazer**
> Quando o Modulo 5 virar real, um admin com acesso legitimo pode mover dinheiro de outra filial e a auditoria so registra o "quem", nao impede o "onde". Segregation-of-duties quebrada.

**Dependencias**: modelagem da relacao `app_user x filial` (pode viver em `app_user_filial` ou em claim JWT `permissions.filiais: number[]`).

---

### [testability-1] Cobrir os 6 repositorios de recebimentos/ com testes unitarios + 1 teste de integracao para o ledger

**QA**: Testability
**Tactic alvo**: Abstract Data Sources; Specialized Interfaces
**Esforco**: M
**Findings**: F-testability-1

**Problema**
> Os 6 novos repositorios do scaffold tem 0 arquivos `.test.ts` (cobertura 54% lines / 12.9% branches / 18.5% functions). O mais critico — `RecebimentoExecucaoRepository`, ledger da idempotencia I-Receb-2 — tem funcoes (`markSettled`, `markError`) sem qualquer chamada em teste, e o SQL do `beginExecution` (`CASE WHEN status='settled' THEN … END`) que garante que retry nunca regride, nunca roda contra Postgres.

**Melhoria Proposta**
> Adicionar `TransacaoRepository.test.ts`, `RecebimentoRepository.test.ts`, `RecebimentoExecucaoRepository.test.ts`, `CreditoClienteRepository.test.ts`, `RegraRecebimentoRepository.test.ts`, `NdeRepository.test.ts` com o padrao CLAUDE.md ("mock direto do `PostgreeDatabaseClient`") cobrindo `save`/`findById` e `mapRow`. Adicionalmente, criar `RecebimentoExecucaoRepository.integration.test.ts` que suba um Postgres via `docker-compose.test.yml` e teste as 3 branches do `CASE WHEN`: `pending->settled`, `reconciling->settled`, `settled->settled` (nao regride).

**Resultado Esperado**
> Cobertura de `repository/recebimentos/` sobe de 54.17% lines / 12.90% branches / 18.52% functions para >= 80% / >= 60% / >= 80%. Ledger idempotency SQL passa a ter protecao antes de Modulo 5 sequer comecar a escrever `ErpReceivablesGatewayReal`.

**Metricas de sucesso**
- Arquivos `.test.ts` em `repository/recebimentos/`: 0 -> 6 unit + 1 integracao
- Cobertura `repository/recebimentos/` (lines): 54.17% -> >= 80%
- Cobertura `repository/recebimentos/` (branches): 12.90% -> >= 60%
- Cobertura `RecebimentoExecucaoRepository.ts` (functions): 50% -> 100%

**Risco de nao fazer**
> Primeira retentativa de execucao em producao duplica NDe/baixa; a bug-class exata que o ledger existe para prevenir chega ao livro-caixa.

**Dependencias**: cross-QA com fault-tolerance (ledger e write-ahead) e modifiability (docker-compose.test.yml para o integration).

---

### [testability-2] Espionar metrics.emit e erp.criarBordero/gravarBaixa no coordinator test — proteger invariantes de observabilidade + PARAMS

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforco**: S
**Findings**: F-testability-2, F-testability-3

**Problema**
> O `RecebimentoPipelineService.test.ts` resolve o coordinator do container (bom!) mas usa os stubs como caixas-pretas: (1) o teste "propagates the correlation id through every metrics stage" nao olha para o `metrics` — so verifica que o input voltou intacto; (2) `criarBordero`/`gravarBaixa` nao sao espionados, entao "borVldTipo e PARAM (nunca hardcoded 2)" e "contaDestino e PARAM" nao tem gate. Um refactor que troque `input.borVldTipo` por `2` literal passa 675/675 tests hoje.

**Melhoria Proposta**
> Estender o coordinator test para: (a) espionar `MetricsPortStub.emit` via `jest.spyOn` e assertar que cada stage emite `{stage: 'importarTransacoes'|…, outcome: 'started'|'ok', correlationId: 'corr-0001'}` — 10 asserts (5 stages x 2 outcomes); (b) espionar `ErpReceivablesGatewayStub.criarBordero` e `.gravarBaixa` com `expect(spy).toHaveBeenCalledWith(expect.objectContaining({ borVldTipo: 2, contaDestino: '55795-4' }))`; (c) trocar `withCorrelationId` do stub por implementacao que capture o `correlationId` num closure e verificar que `emit` foi chamado dentro do escopo.

**Resultado Esperado**
> `metrics.emit` passa a ter >= 10 assertions (0 hoje). `criarBordero`/`gravarBaixa` recebem 2 assertions de PARAMS (0 hoje). Impossivel refatorar o coordinator para dropar metrica ou hardcodar `borVldTipo` sem que o CI reprove.

**Metricas de sucesso**
- Assertions em `metrics.emit`: 0 -> >= 10 (uma por stage x outcome)
- Assertions de PARAM (`borVldTipo`, `contaDestino`) no ERP port: 0 -> >= 2
- Cobertura de branches do coordinator: 66.67% -> >= 85%

**Risco de nao fazer**
> Regressao de `borVldTipo` hardcoded (a bug-class ja vivida em Frente II) reaparece na Frente IV sem sinal.

**Dependencias**: cross-QA com integrability (contrato do ERP port) e security (metricas sem PII).

---

### [testability-3] Adicionar cenarios de FALHA ao coordinator test — markError, throw pos-markSettled, IllegalTransition

**QA**: Testability
**Tactic alvo**: Sandbox; Executable Assertions
**Esforco**: S
**Findings**: F-testability-4

**Problema**
> O coordinator test tem 5 casos, todos happy-path (dryRun t/f, alreadySettled). Zero teste de: `erp.criarBordero` rejeita, `ndeEmitter.emitir` rejeita depois da baixa, `assertTransitionRecebimento` lanca quando o input chega em status errado. Consequencia: `execucaoRepository.markError` — cujo objetivo e registrar por que a execucao parou no meio — nunca e chamado em nenhum caminho de teste.

**Melhoria Proposta**
> (a) Adicionar 3 casos ao coordinator test: (1) `container.registerInstance(ERP_RECEIVABLES_GATEWAY_TOKEN, { criarBordero: jest.fn().mockRejectedValue(new Error('ERP 500')) })` -> verificar que o coordinator propaga o erro e que **`execucaoRepository.markError` foi chamado com `erroMensagem` derivada**; (2) `ndeEmitter` rejeita depois de `gravarBaixa` ter succedido -> verificar que `markError` recebe `borCod` correspondente; (3) coordinator chamado com `recebimento.status === EXECUTADO` -> verificar que `IllegalTransitionError` (code `RECEBIMENTO_TRANSICAO_INVALIDA`, statusCode 409) e lancado antes de qualquer chamada ao ERP. (b) Implementar `markError` no coordinator no bloco `catch` de `executarRecebimento` (feito no p0).

**Resultado Esperado**
> Chamadas de teste a `execucaoRepository.markError`: 0 -> >= 2. Cenarios de falha exercitados no coordinator: 0 -> >= 3. IllegalTransitionError guard cobrada tanto na unit test do guard quanto no coordinator (rejeicao precoce).

**Metricas de sucesso**
- Testes de caminho de erro no coordinator: 0 -> >= 3
- Chamadas a `markError` cobertas: 0 -> >= 2
- Coordinator branches cobertas (incluindo try/catch): 66.67% -> >= 90%

**Risco de nao fazer**
> Execucao parcial em producao deixa ledger em `reconciling` para sempre, exige limpeza manual, quebra a promessa de reversibilidade (I-Receb-2).

**Dependencias**: [p0-executar-recebimento-safety] fornece o try/catch. Cross-QA com fault-tolerance (esse e literalmente o teste de reversibilidade que aquela secao pede).

---

### [deployability-1] Declarar RECEBIMENTOS_ENABLED no render.yaml e documentar em DEPLOY.md

**QA**: Deployability
**Tactic alvo**: Manage Configuration
**Esforco**: S
**Findings**: F-deployability-1

**Problema**
> O feature-gate `RECEBIMENTOS_ENABLED` existe so em codigo (`EnvironmentProvider.ts:47-52`). Nem `render.yaml` nem `DEPLOY.md` mencionam a variavel. Um operador que precise ligar/desligar a Frente IV em prod tem que descobrir o nome via grep. SISPAG teve o mesmo cuidado quando entrou (linhas 32-34 do blueprint) — so a Frente IV ficou de fora.

**Melhoria Proposta**
> Adicionar entrada em `render.yaml` (mesmo com `sync: false`, para o operador ver que a chave existe) e uma linha em `DEPLOY.md` explicando o default (fail-safe: bloqueado em prod). Espelhar o padrao SISPAG.

**Resultado Esperado**
> Operador consegue descobrir e ligar/desligar Frente IV sem ler codigo. Mencoes a `RECEBIMENTOS_ENABLED`: 0 -> >= 2 (`render.yaml` + `DEPLOY.md`).

**Metricas de sucesso**
- Ocorrencias de `RECEBIMENTOS_ENABLED` em `render.yaml`: 0 -> 1
- Ocorrencias em `DEPLOY.md`: 0 -> >= 1 (com nota de fail-safe)
- TTF (Time-To-Flip) do gate por novo operador: hoje = "achar no codigo" -> alvo = "<= 5 min lendo DEPLOY.md"

**Risco de nao fazer**
> Fase 1 de Recebimentos atrasa 1 ciclo por cutover mal-orquestrado; risco de digitar nome de var errado no dashboard.

**Dependencias**: Nenhuma.

---

## P2 — Medio

### [availability-4] Emitir outcome: 'error' no MetricsPort em todos os estagios (5 estagios x 1 catch)

**QA**: Availability
**Tactic alvo**: Monitor / Exception Detection
**Esforco**: S
**Findings**: F-availability-4

**Problema**
> O tipo `MetricsEvent.outcome` preve `'error'`, mas o coordinator so emite `started`/`ok`. Sem esse sinal, o dashboard do Modulo 6 nao tera dado para alarme "taxa de erro por estagio".

**Melhoria Proposta**
> Aplicar Monitor: em cada um dos 5 estagios (`importarTransacoes`, `atribuirBaixa`, `ratearRecebimento`, `aplicarRegras`, `executarRecebimento`), envelopar a chamada da port em `try { … emit ok } catch (err) { emit error com attributes.stage/errorCode; throw }`. Padrao unico para os 6 teammates copiarem.

**Resultado Esperado**
> Todo estagio emite os 3 outcomes possiveis; dashboard/alarme (Modulo 6) tem sinal para "taxa de erro > 5% em 5 min" -> alerta.

**Metricas de sucesso**
- Emissoes `outcome: 'error'` no coordinator: 0 -> 5 (1 por estagio)
- Cobertura de teste: caso por estagio garantindo o emit em falha

**Risco de nao fazer**
> Instrumentacao do Modulo 6 aterrissa sem dado de erro -> operador so descobre incidente via reclamacao do analista Columbia.

**Dependencias**: [p0-executar-recebimento-safety] fornece o try/catch do estagio 5; os demais precisam de try/catch novos.

---

### [availability-5] Definir politica de retomada quando ledger esta em error ou reconciling orfao

**QA**: Availability
**Tactic alvo**: State Resynchronization
**Esforco**: M
**Findings**: F-availability-5, F-availability-1

**Problema**
> `alreadySettled` cobre apenas `status === 'settled'`. Se a linha estiver em `error` (apos [p0]) ou em `reconciling` sem `atualizado_em` recente, o coordinator prossegue como se fosse execucao nova e reissue o POST — potencialmente duplicando.

**Melhoria Proposta**
> Aplicar State Resynchronization: estender `BeginRecebimentoExecucaoResult` com `previousStatus` e `staleSince?: Date`; no coordinator, se `previousStatus === 'error'` exigir flag explicita `retryFromError: true` no `RunPipelineInput`; se `previousStatus === 'reconciling'` e `staleSince > 15min`, delegar a job de reconciliacao (nao reexecutar inline). Documentar em `ontology/business-rules/idempotencia-quitacao-nde.md`.

**Resultado Esperado**
> Retentativa consciente exige input explicito; execucao nunca reexecuta POST irreversivel cegamente sobre estado incerto.

**Metricas de sucesso**
- Branches de idempotencia cobertos: 1 (`settled`) -> 4 (`settled`/`error`/`reconciling`-orfao/`pending`)
- Testes: caso `error -> retry sem flag` deve lancar; `reconciling stale > 15min` deve rotear a job

**Risco de nao fazer**
> Mesmo cenario de dupla-quitacao do P0, mas em fluxo de recuperacao — pior porque o operador confia que esta recuperando com seguranca.

**Dependencias**: [p0-executar-recebimento-safety] (o `error` precisa ser alcancavel primeiro).

---

### [deployability-2] Adicionar teste do fail-safe de RECEBIMENTOS_ENABLED (paridade com SISPAG)

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforco**: S
**Findings**: F-deployability-2

**Problema**
> `resolveRecebimentosEnabled` foi criado no scaffold, mas o teste espelho ao de SISPAG (`EnvironmentProvider.test.ts:89-109`) nao foi replicado. Um refactor futuro pode inverter o `!==` e ninguem percebe.

**Melhoria Proposta**
> Copiar o `it('sispagEnabled: …', …)` das linhas 89-109 renomeando pra `recebimentosEnabled`, cobrindo: forca `true`, forca `false`, sem env + prod -> `false`, sem env + local -> `true`.

**Resultado Esperado**
> Fail-safe do gate coberto por teste unitario. Casos de teste sobre `recebimentosEnabled`: 0 -> 4.

**Metricas de sucesso**
- Asserts em `EnvironmentProvider.test.ts` cobrindo `recebimentosEnabled`: 0 -> >= 4
- Coverage de `resolveRecebimentosEnabled`: 100% branch

**Risco de nao fazer**
> Dark-launch quebra silenciosamente num refactor futuro; a Frente IV vira a Frente III (que ficou 6 meses com escrita ligada em dry-run mudo).

**Dependencias**: Nenhuma.

---

### [deployability-3] Escrever runbook de cutover e rollback da Frente IV

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforco**: S
**Findings**: F-deployability-3

**Problema**
> A estrategia de rollback da Frente IV e unica no repo (flip do gate + redeploy do binario anterior; sem migration reversa, pois as 7 tabelas 0032-0038 ficam vazias enquanto o gate estiver `false`). Essa estrategia funciona mas nao esta escrita em nenhum lugar — o operador de plantao vai tentar `DROP TABLE` ou reverter migration (impossivel: 0035 tem `BIGSERIAL PRIMARY KEY`).

**Melhoria Proposta**
> Criar `docs/runbooks/recebimentos-cutover.md` cobrindo: (1) como ligar o gate (env var + redeploy), (2) o que observar nas primeiras horas, (3) rollback padrao = flip gate + previous release, (4) rollback "duro" = manter tabelas vazias (nunca `DROP`), (5) criterios de re-enable. Espelhar o formato de `fin010-write-cutover.md`.

**Resultado Esperado**
> Rollback de incidente da Frente IV parametrizado; MTTR previsivel. Runbooks: 1 (Frente III) -> 2 (+ Frente IV).

**Metricas de sucesso**
- `docs/runbooks/recebimentos-*.md`: 0 -> 1
- MTTR estimado em tabletop: indefinido -> <= 15 min

**Risco de nao fazer**
> Primeiro incidente em prod da Frente IV tera tratamento improvisado; risco de `DROP TABLE` errado (as 7 tabelas tem FKs entre si — 0033->0032, 0034->0033, 0035->0033).

**Dependencias**: [deployability-1] (para o runbook citar o nome oficial da env var).

---

### [deployability-4] Instrumentar drift detection do schema_migrations

**QA**: Deployability
**Tactic alvo**: Drift Detection
**Esforco**: S
**Findings**: F-deployability-4

**Problema**
> O `MigrationRunner` filtra "migrations do disco nao aplicadas" mas ignora o cenario oposto: "migrations registradas em `schema_migrations` que sumiram do disco" (sinal classico de rebase mal resolvido). Com 7 migrations novas no mesmo PR e 3 frentes ativas paralelas, colisao de numeracao num squash-merge e risco real e silencioso.

**Melhoria Proposta**
> Passo #1 no `MigrationRunner.run()`: `SELECT name FROM schema_migrations` -> comparar com `readdirSync(...)` e logar `WARN` (fail-loud em prod se >0 registros orfaos). Alternativa mais leve: adicionar step no `ci.yml` que compara `git diff --name-only main -- migrations/` contra numeracao esperada.

**Resultado Esperado**
> CI detecta rebase de migration que apagou historico. Orfaos toleraveis silenciosamente: 100% (hoje) -> 0.

**Metricas de sucesso**
- Casos de "migration em `schema_migrations` sem arquivo no disco" detectados: 0 -> 100%
- Novo teste em `runMigrations.test.ts`: +1

**Risco de nao fazer**
> Perda silenciosa de tabela apos rebase mal resolvido; descoberto so no primeiro `INSERT` da Fase 1.

**Dependencias**: Nenhuma.

---

### [integrability-2] Adicionar rawMovimentoSchema (Zod) e obrigar parse no impl de NexxeraGatewayInterface

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforco**: S
**Findings**: F-integrability-2

**Problema**
> A porta que fala com o canal externo (Nexxera) usa `payload: unknown` sem schema Zod, quebrando o padrao consolidado em `ConexosBaixaClient` (Regis P0 antigo). Payload malformado so vai estourar no meio de `IngestaoTransacoes.run`.

**Melhoria Proposta**
> Exportar `rawMovimentoSchema: z.ZodSchema<RawMovimento>` em `ports.ts` (ou em `NexxeraGateway.ts` novo). Comentar na interface: "impls MUST parse antes de retornar". Adicionar contract test em [integrability-4] verificando que um impl nao pode retornar `rawMovimentoSchema.parse(raw)` que quebre.

**Resultado Esperado**
> 4/4 portas externas com Zod no boundary (Nexxera, ErpReceivables, NdeEmitter, IngestaoTransacoes). Impls nao conseguem retornar payload sem parse.

**Metricas de sucesso**
- Portas externas com Zod schema: 0/4 -> 4/4
- Impls que passam contract test: 0 -> 8/8 stubs + reais

**Risco de nao fazer**
> Em 3 meses, 6 impls reais nascem sem parse boundary; cada uma introduz uma variante silenciosa de tolerancia.

**Dependencias**: recomendavel antes de M1 comecar a implementar o adapter real (Fase 1, pos-O7).

---

### [integrability-3] Publicar BorderoCriadoSchema / BaixaGravadaSchema no ports.ts

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforco**: S
**Findings**: F-integrability-3

**Problema**
> `ErpReceivablesGatewayInterface` promete `borCod: number` / `bxaCodSeq: number` mas nao declara Zod schema. O impl real pode retornar payload frouxo e o ledger grava `NaN`/`null`, quebrando a reversao pelo `borCod`. `ConexosBaixaClient.ts:20-35` ja resolveu isso via Regis P0 — a licao nao foi transferida para a nova porta.

**Melhoria Proposta**
> Reexportar (ou re-declarar) `BorderoCriadoSchema` e `BaixaGravadaSchema` em `ports.ts` (ou num arquivo separado `ports/schemas.ts`) e documentar: "toda impl de `ErpReceivablesGatewayInterface` DEVE `parse(...)` a resposta".

**Resultado Esperado**
> Schemas de resposta de escrita ERP publicados junto com a porta; qualquer impl que retornar `borCod` invalido falha o parse no boundary.

**Metricas de sucesso**
- Metodos com schema declarado: 0/2 -> 2/2
- Divergencia entre `ConexosBaixaClient` (padrao consolidado) e `ErpReceivablesGateway` (novo): 100% -> 0%

**Risco de nao fazer**
> Reintroduzir a mesma falha ja corrigida na Frente I (Regis P0 do `ConexosBaixaClient`).

**Dependencias**: recomendado junto com [integrability-2].

---

### [integrability-4] Criar contract-test suite compartilhada por porta (Nexxera, ErpReceivables, NdeEmitter)

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforco**: M
**Findings**: F-integrability-4, F-integrability-2, F-integrability-3

**Problema**
> O unico teste do scaffold e end-to-end do coordinator com stubs. Nenhuma suite de conformance existe para os 6 times rodarem contra seus impls reais. Semanticas criticas (idempotencia do `NdeEmitter`, `dryRun` preservado no `ErpReceivablesGateway`, dedup por `naturalKey` na `NexxeraGateway`) so vao ser validadas end-to-end — tarde demais.

**Melhoria Proposta**
> Criar `src/backend/domain/service/recebimentos/__contracts__/` com um arquivo por porta stateful:
> - `NexxeraGatewayContract.test.ts` — factory `(impl: NexxeraGatewayInterface) => void`, casos: fetch com periodo vazio -> array vazio; dedup entre dois fetches sobrepostos; payload -> passa Zod.
> - `ErpReceivablesGatewayContract.test.ts` — `dryRun` preservado no retorno; `borVldTipo` passado no request; `borCod` numerico obrigatorio.
> - `NdeEmitterContract.test.ts` — mesmo `Recebimento` -> mesmo `idempotencyKey`.
> O stub roda o contract test hoje; o impl real roda o MESMO teste quando pronto.

**Resultado Esperado**
> Contract tests: 0/8 -> 3/8 portas stateful cobertas; qualquer swap stub->real dispara o mesmo gate. CI verde = semantica preservada.

**Metricas de sucesso**
- Portas com contract test: 0 -> 3 (Nexxera, ErpReceivables, NdeEmitter)
- Cobertura de semanticas criticas (dryRun, idempotency, dedup): 0% -> 100%

**Risco de nao fazer**
> 6 impls paralelos divergem silenciosamente; incidentes de conciliacao pos-Fase 5.

**Dependencias**: [integrability-2] e [integrability-3] publicam os schemas; contract test os usa.

---

### [modifiability-2] Fatiar ports.ts por modulo (ports/matching.ts, ports/rateio.ts, ...)

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforco**: S
**Findings**: F-modifiability-2

**Problema**
> `ports.ts` acumula 12 interfaces + 14 tokens + 10 tipos-suporte em 284 LOC. Cada dev que refina o proprio contrato edita o mesmo arquivo — merge conflicts triviais mas continuos, contradizendo o principio "6 devs em paralelo sem bloqueio" da spec.

**Melhoria Proposta**
> Aplicar Split Module: um arquivo por modulo em `interface/recebimentos/ports/` (`ingestao.ts`, `matching.ts`, `rateio.ts`, `regras.ts`, `execucao.ts`, `observabilidade.ts`, `repository.ts`) + um `ports/index.ts` que re-exporta tudo (compat com imports atuais). Manter tokens ao lado da interface que servem.

**Resultado Esperado**
> Nenhum import mudou; conflitos de merge no seam caem para zero em edits de contrato modulo-only. Metrica: LOC do maior arquivo de contrato — 284 -> <= 60 por modulo.

**Metricas de sucesso**
- Maior LOC em arquivo de contrato: 284 -> <= 60
- Merge conflicts em `ports/*.ts` em PRs de modulo distinto: cross-file ratio down 80%

**Risco de nao fazer**
> Friccao crescente conforme a Fase 4/5 refina contratos; devs comecam a "engolir" mudancas de contrato dos outros por conta.

**Dependencias**: antes de qualquer dev comecar a implementar (freeze so quando fatiado).

---

### [modifiability-3] Tornar o pipeline de stages plugavel (PipelineStage[] em vez de 5 metodos hardcoded)

**QA**: Modifiability
**Tactic alvo**: Defer Binding (runtime registration) + Split Module
**Esforco**: M
**Findings**: F-modifiability-3

**Problema**
> O coordinator injeta 10 dependencias e encadeia 5 stages hardcoded em `run`. Adicionar uma sexta stage (auditoria, notificacao, cambio) exige tocar construtor + `run` + rota + container — o spine vira ponto unico de mudanca para acrescimos, contra OCP.

**Melhoria Proposta**
> Definir `interface PipelineStage { name: string; execute: (ctx) => Promise<ctx> }`. Registrar stages via multi-injection tsyringe (`@injectAll(PIPELINE_STAGE_TOKEN)`). `run` reduz para um `for` que aplica stages na ordem de registro (ou por `priority`). Cada stage vira 1 classe `@injectable()` isolada (fica pronto para virar 1 Lambda / 1 Step Functions state).

**Resultado Esperado**
> Adicionar novo stage = 1 arquivo novo + 1 `container.register`. Coordinator nao muda. Metrica: `@inject` no construtor 10 -> <= 4 (so o que e transversal); stages injetados 6 -> N via `@injectAll`.

**Metricas de sucesso**
- `@inject` no coordinator: 10 -> <= 4
- Arquivos tocados para adicionar 1 nova stage: 4 -> 1

**Risco de nao fazer**
> Quando migrar ao alvo Lambda/Step Functions, a decomposicao vira big-bang em vez de mecanica.

**Dependencias**: card [modifiability-2] (contratos fatiados facilitam mover stages).

---

### [modifiability-4] Formalizar registro plugavel de regras (RegrasEngine.register(rule)) antes da Fase 4

**QA**: Modifiability
**Tactic alvo**: Defer Binding (polymorphism + runtime registration)
**Esforco**: S
**Findings**: F-modifiability-4

**Problema**
> `RegrasEngineInterface` so expoe `aplicar`. Nao ha convencao de como as 3 regras da Fase 4 se registram. O dev D vai decidir isso sozinho no meio da implementacao — congela contrato tarde e mata o "regra = plugin" que a proposta ao cliente promete.

**Melhoria Proposta**
> Congelar ja o contrato de plugin: `RegrasEngineInterface.register(rule: RegraRecebimentoInterface)` + `listAtivas(): RegraRecebimentoInterface[]`. Alternativa: adotar `@injectAll(REGRA_PLUGIN_TOKEN)` e documentar que cada regra `@injectable()` marcada com `container.register(REGRA_PLUGIN_TOKEN, {useClass: MinhaRegra})` entra automaticamente.

**Resultado Esperado**
> Nova regra = 1 arquivo `regras/<nome>.ts` + 1 linha no container; engine nao muda; teste do registry cobre "N regras registradas -> N aplicadas em ordem de prioridade". Metrica: arquivos tocados para adicionar 1 regra: N -> 2.

**Metricas de sucesso**
- Metodos de registro no contrato: 0 -> 2 (`register`, `listAtivas`)
- Arquivos tocados para nova regra: engine + registry + regra -> so a regra

**Risco de nao fazer**
> Cada regra do cliente vira `feat` interno; upsell vira release em vez de config.

**Dependencias**: pode entrar junto com card [modifiability-2] (mesmo arquivo `ports/regras.ts`).

---

### [performance-3] Adicionar variante batch em ErpReceivablesGatewayInterface.gravarBaixaBatch

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforco**: S
**Findings**: F-performance-3

**Problema**
> O port ERP grava bordero + baixa um Recebimento por vez. Runner externo em lote diario fara 3 POSTs Conexos por Recebimento aprovado — 200 recebimentos = 600 roundtrips serial. O `fin010` normalmente aceita bordero com multiplas baixas (e o padrao do SISPAG), entao o port esta artificialmente estreito.

**Melhoria Proposta**
> Aditivar (nao substituir) `criarBorderoComBaixas(params: { filCod, borVldTipo, contaDestino, baixas: BaixaItem[], correlationId, dryRun }): Promise<{ borCod, bxaCodSeqs: number[] }>` no `ErpReceivablesGatewayInterface`. Manter as variantes `criarBordero`/`gravarBaixa` para o caso 1-a-1. Documentar batch size maximo (`ERP_BATCH_MAX=50`, alinhado a experiencia SISPAG).

**Resultado Esperado**
> Lote diario de 200 recebimentos: 600 roundtrips -> 4 roundtrips batch (200/50 = 4); janela vespertina de conciliacao reduz de estimado 20 min para <= 2 min.

**Metricas de sucesso**
- Metodo batch no port ERP: 0 -> 1 (`criarBorderoComBaixas`)
- Constante documentada `ERP_BATCH_MAX`: ausente -> presente

**Risco de nao fazer**
> Apos Fase 5, o teammate implementa a versao 1-a-1 e ninguem volta atras -> runtime da janela batch cresce linearmente com carteira.

**Dependencias**: —

---

### [performance-4] Cachear regra_recebimento ativas (TTL) + indice composto (ativo, tipo, versao DESC)

**QA**: Performance
**Tactic alvo**: Cache strategy / Index discipline
**Esforco**: S
**Findings**: F-performance-4

**Problema**
> `RegraRecebimentoRepository.listAtivas()` recarrega todas as regras a cada chamada do estagio `aplicarRegras` — 1x por Recebimento. Sem `LIMIT`, sem cache, e o indice existente (`idx_regra_recebimento_ativo`) tem baixa seletividade (quase tudo e `ativo=true`), forcando sort no cliente.

**Melhoria Proposta**
> 1) Migration `0039_regra_recebimento_composite_index.sql`: `CREATE INDEX IF NOT EXISTS idx_regra_recebimento_ativo_tipo_versao ON regra_recebimento (ativo, tipo, versao DESC) WHERE ativo = true;` (partial index — ainda mais leve); 2) No `RegraRecebimentoRepository`, adicionar cache instance-variable com TTL (5 min e seguro — regras mudam raro): `private cache?: { at: number; rows: RegraRecebimento[] }`. Invalidar cache em `save()`.

**Resultado Esperado**
> `listAtivas` cache-hit ratio esperado >= 99% (regras mudam raro); custo desce de ~2 ms/call x N recebimentos para ~0 ms; query fria (cache miss) usa partial index (plano `Index Only Scan`). Metrica: 200 recebimentos/dia x 2 ms = 400 ms/dia desperdicados -> <= 4 ms/dia.

**Metricas de sucesso**
- Indice composto `(ativo, tipo, versao DESC) WHERE ativo=true`: ausente -> presente
- Cache TTL em `RegraRecebimentoRepository`: 0 -> 5 min
- `selectMany` sem `LIMIT` em codigo novo: 1 -> 0 (fica dentro do cache; miss raro)

**Risco de nao fazer**
> Divida cresce com volume de regras e recebimentos; overhead invisivel espalha na p50 do pipeline.

**Dependencias**: —

---

### [performance-5] Adicionar loadAggregate / list(filter, pagination) + findByIds em RecebimentoRepositoryInterface

**QA**: Performance
**Tactic alvo**: Reduce Overhead / Increase Resource Efficiency
**Esforco**: S
**Findings**: F-performance-5

**Problema**
> O contrato so oferece `save` + `findById(id)`. O painel (`GET /recebimentos/painel`) e a fila de execucao vao consumir N recebimentos com seus rateios/regras. Sem `findByIds`/`list`/`loadAggregate`, o consumidor natural cai em N+1. O proprio `mapRow` do repo admite isso: "Derivados recompostos ao carregar o agregado completo (Fase 3)".

**Melhoria Proposta**
> Aditivar no `RecebimentoRepositoryInterface`: `list(filter, pagination): Promise<{ rows: Recebimento[]; total: number }>`; `findByIds(ids: string[]): Promise<Recebimento[]>`; `loadAggregate(id: string): Promise<Recebimento | null>` (que fara 1+2 queries — root + rateios + regras — em vez de N+1 no chamador). Documentar `LIMIT` default 50 e teto 500. Nao implementar hoje; deixar `throw new Error('not implemented in scaffold')` — o objetivo e fixar o contrato.

**Resultado Esperado**
> Contrato do repo cobre painel + fila sem obrigar N+1; Modulo 2/3 nasce com API rica; painel de 50 recebimentos: 150+ queries potencial -> 3 queries. Metrica: p95 painel esperado 2 s+ -> <= 400 ms.

**Metricas de sucesso**
- Metodos no port `RecebimentoRepositoryInterface`: 2 -> 5 (`+list`, `+findByIds`, `+loadAggregate`)
- Paginacao obrigatoria documentada: nao -> sim (`limit`/`offset` no tipo)

**Risco de nao fazer**
> Fase 3 escreve o painel com `findById` em loop; debito so aparece com carteira real (semanas apos deploy); refatorar contrato depois quebra 6 consumidores.

**Dependencias**: —

---

### [fault-tolerance-4] Seedar seam de estorno (estornarRecebimento) no coordinator/service

**QA**: Fault Tolerance
**Tactic alvo**: Compensating Transaction; Rollback
**Esforco**: M
**Findings**: F-fault-tolerance-4

**Problema**
> A transicao `EXECUTADO -> ESTORNADO` existe no guard puro e o DTO expoe `estornadoPor`, mas nenhum arquivo de servico/repositorio da Frente IV tem verbo `estornar`. Teammates da Fase 5 vao implementar o "desfazer" do zero, provavelmente sem o padrao write-ahead (risco de introduzir divergencia ledger×ERP na reversao).

**Melhoria Proposta**
> Adicionar `estornar(recebimentoId, motivo, ator): Promise<Recebimento>` ao `RecebimentoPipelineService` (ou servico dedicado `EstornoRecebimentoService`). No scaffold, stubado com `assertTransitionRecebimento(EXECUTADO, ESTORNADO)` + call a um novo port `ErpReversalGatewayInterface.reverter({ borCod, bxaCodSeq })` (stubbed) + `execucaoRepository.markError(idempotencyKey, { erroMensagem: 'estornado por analista' })` ou nova linha de ledger. Documentar a decisao "forward recovery via analista" quando o ERP nao expoe undo.

**Resultado Esperado**
> A transicao `EXECUTADO -> ESTORNADO` fica exercitada por 1 metodo stubbed + 1 teste — teammates de Fase 5 preenchem a impl sem inventar padrao. 4/4 transicoes do state-machine com seam de codigo.

**Metricas de sucesso**
- Cobertura de transicoes do state-machine com seam de codigo: 1/4 -> 4/4
- Testes: 0 -> >= 1 (fluxo executado -> estornado stubbed)

**Risco de nao fazer**
> Quando ocorrer a primeira NDe emitida errado em producao, o analista descobre que a Frente IV nao tem botao de estornar — vira ticket no ERP direto, bypassando o ledger.

**Dependencias**: [p0-executar-recebimento-safety] (o padrao de try/catch/markError deve estar consolidado antes).

---

### [fault-tolerance-5] Declarar seams de reconciliacao: listStuckExecucoes + ReceivablesReconcilerInterface

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile
**Esforco**: S
**Findings**: F-fault-tolerance-5

**Problema**
> Nenhum job/service preve comparar `recebimento_execucao.status='settled'` x baixas realmente presentes no `fin010`, nem detectar linhas `reconciling` orfas (F-fault-tolerance-1 sem deteccao). Sem seam declarada agora, teammate de Modulo 5/6 nao sabe onde plugar.

**Melhoria Proposta**
> Adicionar ao `RecebimentoExecucaoRepositoryInterface`: `listByStatus(status, olderThan?: Date): Promise<RecebimentoExecucaoRow[]>`. Declarar novo port `ReceivablesReconcilerInterface { reconcile(period: NexxeraFetchPeriod): Promise<ReconcileReport> }` + stub. Nao implementar o job — so seed do contrato + 1 teste smoke.

**Resultado Esperado**
> Modulo 6 sabe exatamente onde plugar o reaper diario (EventBridge alvo). 1 metodo de query por status + 1 port de reconciliacao declarados.

**Metricas de sucesso**
- Seams declaradas: 0 -> 2 (`listByStatus` + `ReceivablesReconcilerInterface`)
- Tokens DI: 14 -> 15

**Risco de nao fazer**
> Reaper vira feature-request tardio; enquanto isso, orfaos acumulam sem deteccao.

**Dependencias**: Nenhuma.

---

### [security-3] Enforcement runtime de PII-safety no MetricsPortInterface

**QA**: Security
**Tactic alvo**: Limit Access
**Esforco**: S
**Findings**: F-security-3 (cross: F-integrability-6)

**Problema**
> O comentario em `MetricsEvent.attributes` proibe PII ("NEVER PII"), mas o tipo `Record<string, number | string | boolean>` aceita qualquer string — incluindo `contraparte` (nome/CNPJ do pagador), `referenciaBancaria` ou `rawPayload` do extrato Nexxera. Quando o Modulo 6 virar real (CloudWatch/OTel), 1 esquecimento de code-review vaza CNPJ para dashboards retidos por meses.

**Melhoria Proposta**
> Introduzir type-branding: `type MetricAttr = number | boolean | (string & { readonly __pii_free: unique symbol })` OU um helper `piiSafe(s: string): PiiFreeString` que valide contra regex CNPJ/CPF/IBAN. Adicionar um scrubber runtime no `MetricsPort` real (Modulo 6) que rejeite/redija atributos que casem `\d{11,14}` (CPF/CNPJ) ou palavras-chave (`contraparte`, `iban`, `rawPayload`).

**Resultado Esperado**
> `metrics.emit({ attributes: { contraparte: '12.345.678/0001-90' } })` e rejeitado em compile-time OU redigido em runtime. Metrica: pontos-de-emissao com enforcement PII: 0/5 -> 5/5.

**Metricas de sucesso**
- Pontos de emissao com scrubber ou branded type: 0/5 -> 5/5
- Testes cobrindo emissao de CNPJ (deveria falhar): 0 -> 1

**Risco de nao fazer**
> LGPD — vazamento de dados PJ da carteira Columbia em metricas retidas.

**Dependencias**: alinhamento com Modulo 6 (Observabilidade) sobre a shape final de `MetricsEvent`.

---

### [security-4] Adicionar RBAC leve na leitura de /recebimentos/painel (viewer/analyst/admin)

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforco**: S
**Findings**: F-security-4

**Problema**
> `GET /recebimentos/painel` fica aberto a qualquer usuario autenticado — mesmo padrao herdado do SISPAG. No scaffold retorna `{ recebimentos: [], kpis: {} }`. Quando popular, expoe todo o pipeline financeiro (quem paga quanto, quando) a qualquer usuario JR com token valido.

**Melhoria Proposta**
> Aplicar `requireRole('admin', 'analyst', 'viewer')` (ou similar) explicitamente para deixar a intencao clara e permitir revogacao futura. Escopar o payload por-filial (mesmo helper do card [security-1]).

**Resultado Esperado**
> Cada rota de leitura declara explicitamente qual role ve o que; usuarios sem role autorizada recebem 403 (com log). Metrica: rotas de leitura Frente IV sem RBAC explicito: 1 -> 0.

**Metricas de sucesso**
- Rotas Frente IV com RBAC explicito: 1/2 -> 2/2
- Test cobrindo user sem role -> 403: 0 -> 1

**Risco de nao fazer**
> Quando o painel encher (Fase 3), qualquer conta comprometida (phishing) enxerga a carteira financeira da Columbia sem passar por role-check.

**Dependencias**: taxonomia de roles definida (hoje so `admin` e usado; introduzir `analyst`/`viewer` requer alinhamento com auth).

---

### [testability-4] Completar o kit de fixtures — 3 -> 6 factories buildX

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforco**: S
**Findings**: F-testability-5

**Problema**
> O scaffold entrega fixtures de `Recebimento`, `TransacaoBancaria`, `DocumentoAReceber`, mas os teammates de Modulo 4 (CreditoCliente + RegraRecebimento) e Modulo 5 (NotaDebitoEletronica) precisam de fixtures compartilhadas para escrever TDD contra os seus schemas Zod. O proprio `schemas.test.ts` ja define objetos inline (linhas 34-71) para as 3 entidades faltantes — sinal de que a lacuna ja doi.

**Melhoria Proposta**
> Criar em `interface/recebimentos/__fixtures__/`: `creditoCliente.fixture.ts` com `creditoClienteFixture` + `buildCreditoCliente(overrides)`; `regraRecebimento.fixture.ts` (com `REGRA_TIPO.ENCOMENDA` e `parametros: { percentual: 0.001 }`); `notaDebitoEletronica.fixture.ts` (com `statusEmissao: PENDENTE`, `idempotencyKey: nde:{id}`); e opcionalmente `rawMovimento.fixture.ts` para Modulo 1. Refatorar `schemas.test.ts` para consumir esses factories.

**Resultado Esperado**
> Cobertura de fixtures: 3/7 = 43% -> 6/7 = 86%. Zero definicoes inline de objeto-teste em `schemas.test.ts`. Cada uma das 6 equipes tem factory pronta antes de comecar.

**Metricas de sucesso**
- Fixtures disponiveis: 3 -> 6
- Objetos inline em `schemas.test.ts`: 3 -> 0

**Risco de nao fazer**
> Cada equipe reinventa a factory na sua primeira PR, dispersando `vigenteDe`/`idempotencyKey` arbitrarios pelo repo.

**Dependencias**: Nenhuma.

---

### [testability-5] Adicionar testes negativos de Zod para os 4 schemas restantes

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforco**: S
**Findings**: F-testability-6

**Problema**
> `schemas.test.ts` valida "malformed inputs are rejected" para 3 dos 7 schemas (43%). Sem teste negativo, o Zod deixa de ser um gate: se alguem trocar `z.enum([...])` por `z.string()` num dos 4 schemas restantes, o teste positivo continua verde e a fronteira fica silenciosamente aberta.

**Melhoria Proposta**
> Adicionar em `schemas.test.ts` casos `safeParse` com input malformado para: `CreditoCliente` (status invalido, valorDisponivel > valorOriginal), `RegraRecebimento` (`versao: 0`, `tipo` invalido), `NotaDebitoEletronica` (`statusEmissao` invalido, `valor: 0`), `RateioRecebimento` (`valorAlocado: -1`, `componente` invalido).

**Resultado Esperado**
> Schemas com teste negativo: 3/7 -> 7/7. Refactor de Zod que afrouxe validacao passa a quebrar o CI.

**Metricas de sucesso**
- Casos negativos: 3 -> >= 8 (2 por schema)
- Cobertura de branches em `interface/recebimentos/*.ts`: mantem 100% mas com defesa negativa real

**Risco de nao fazer**
> Fronteira mal validada acumula debito a medida que os 6 modulos escrevem dados.

**Dependencias**: pode compartilhar factories com [testability-4].

---

### [testability-6] Teste do recebimentosGate — feature-flag 403 tem que ter gate no CI

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforco**: S
**Findings**: F-testability-8

**Problema**
> `recebimentosGate.ts` decide se toda a Frente IV atende `403` (producao, `recebimentosEnabled=false`) ou passa para o proximo handler (dev/staging). Nao ha nenhum teste que verifique o comportamento — se alguem inverter a logica (`if (env.recebimentosEnabled)` em vez de `if (!env.recebimentosEnabled)`), o endpoint stub abre em producao e ninguem percebe.

**Melhoria Proposta**
> Criar `src/backend/http/recebimentosGate.test.ts` que: (1) mocke `EnvironmentProvider.getEnvironmentVars` para devolver `recebimentosEnabled:false` e assere `res.status(403)` + `res.json({error:'Recebimentos indisponivel.'})`; (2) mesmo com `recebimentosEnabled:true` assere `next()` foi chamado; (3) verifique que `bootstrapAppContainer()` e awaited. Espelhar padrao de `sispagGate` (mesmo que tambem esteja sem teste — abrir card gemeo em Frente II e o passo defensivo).

**Resultado Esperado**
> Testes de gate: 0 -> 3. Inverter a logica do gate passa a quebrar CI antes do deploy.

**Metricas de sucesso**
- Arquivos de teste para gates: 0 -> 1
- Cenarios de gate cobertos: 0 -> 3 (disabled/enabled/bootstrap-awaited)

**Risco de nao fazer**
> Deploy silencioso da Frente IV em producao antes da hora, com stubs devolvendo dados fake para a UI.

**Dependencias**: cross-QA com deployability (gate = kill-switch para deploy incremental) e security (403 e defesa em camadas).

---

## P3 — Baixo

### [integrability-5] Adicionar channel/apiVersion em RawMovimento / NexxeraFetchPeriod

**QA**: Integrability
**Tactic alvo**: Versioning strategy
**Esforco**: S
**Findings**: F-integrability-5

**Problema**
> O canal Nexxera e decidido pos-spike O7 (API vs SFTP/CNAB). O tipo hoje e agnostico ao ponto de nao conseguir dizer "esse movimento veio por qual canal" nem "qual versao da API foi usada". Se dois canais coexistirem (fallback), a rastreabilidade se perde.

**Melhoria Proposta**
> Adicionar `channel: 'api' | 'sftp'` e `apiVersion?: string` em `RawMovimento` (ou em um envelope `NexxeraFetchResult`). Persistir junto ao `TransacaoBancaria.importRunId`.

**Resultado Esperado**
> Todo movimento carrega origem/versao do canal; fallback e forensics ficam triviais.

**Metricas de sucesso**
- Campos de versionamento no seam externo: 0 -> 2 (channel + apiVersion)

**Risco de nao fazer**
> Refactor caro quando Nexxera versionar API ou quando fallback SFTP virar necessario.

**Dependencias**: idealmente resolvido antes do spike O7 fechar; caso contrario, refactor pos-Fase 1.

---

### [integrability-6] Fechar o tipo MetricsEvent.attributes para impedir PII (branded/whitelist)

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforco**: S
**Findings**: F-integrability-6 (cross: F-security-3)

**Problema**
> `attributes?: Record<string, number | string | boolean>` aceita qualquer chave. Modulo 6 vai emitir para CloudWatch. O proprio comentario admite ser "discipline constraint" — sem barreira de compilador, um `attributes: { contraparte: ... }` passa.

**Melhoria Proposta**
> Substituir por union fechado ou branded type:
> ```typescript
> type MetricAttributes = {
>     stage?: string; outcome?: 'started' | 'ok' | 'error';
>     count?: number; total?: number; deduplicadas?: number;
>     classificacao?: MatchClassificacao; score?: number;
>     dryRun?: boolean; alreadySettled?: boolean;
>     ajustes?: number; parcelas?: number; valorAlocado?: number;
>     borCod?: number;
> };
> ```
> Ou branded type `type MetricAttrKey = Brand<string, 'MetricAttrKey'>`.

**Resultado Esperado**
> O compilador rejeita qualquer chave PII no metrics port. Cross-QA (Security): risco de PII em log agregado = 0.

**Metricas de sucesso**
- Chaves PII permitidas pelo tipo: infinitas -> 0

**Risco de nao fazer**
> Exposicao de CNPJ/nome do pagador em CloudWatch em 3-6 meses.

**Dependencias**: Nenhuma; pode ser feito antes do Modulo 6 escrever o emitter real.

---

### [modifiability-5] Introduzir evolveRecebimento(prev, patch) que incrementa versao a cada mutacao da spine

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforco**: S
**Findings**: F-modifiability-5

**Problema**
> As 4 mutacoes do `Recebimento` no coordinator usam `{ ...recebimento, campo }` — o campo `versao` nunca incrementa. O `RecebimentoRepository.save` faz `UPDATE` cego sobre a raiz, permitindo sobrescrita silenciosa em cenarios de operador manual em paralelo com retry.

**Melhoria Proposta**
> Criar helper puro `evolveRecebimento(prev, patch): Recebimento` que devolve `{ ...prev, ...patch, versao: prev.versao + 1 }` e e o unico caminho de mutacao. `RecebimentoRepository.save` adiciona guard `WHERE versao = $versaoAtual - 1` (optimistic concurrency), retornando erro tipado em conflito.

**Resultado Esperado**
> `versao` cresce monotonicamente por rodada; conflict de concorrencia vira erro explicito em vez de perda silenciosa. Metrica: mutacoes spread diretas no coordinator: 4 -> 0.

**Metricas de sucesso**
- Mutacoes spread diretas: 4 -> 0
- `save` com `WHERE versao =` guard: 0 -> 1

**Risco de nao fazer**
> Race condition invisivel no primeiro cenario multi-operador (baixa frequencia hoje, mas o campo `versao` ja existe e nao faz nada).

**Dependencias**: card [modifiability-1] e [fault-tolerance-3] (ambos tocam o `save`).

---

### [modifiability-6] Plugar entidades da Frente IV em ontology/_index.json + _coverage.json

**QA**: Modifiability
**Tactic alvo**: Defer Binding (Configuration files)
**Esforco**: S
**Findings**: F-modifiability-6

**Problema**
> Os 7 DTOs do scaffold existem em codigo mas nao tem entrada no `_index.json`. `/retro-ontology` nao ve a Frente IV; drift arquitetural comeca invisivel.

**Melhoria Proposta**
> Adicionar entrada por entidade em `_index.json` mapeando para os arquivos em `interface/recebimentos/`, `repository/recebimentos/`, migrations `0032-0038`. Atualizar `_coverage.json` com status inicial (`scaffold` / `stubbed`).

**Resultado Esperado**
> `_coverage.json` reporta 7/7 entidades da Frente IV com status conhecido. `CodebaseNavigator` resolve `entities/recebimento.md` -> arquivos. `/retro-ontology` mede drift semanalmente.

**Metricas de sucesso**
- Entidades mapeadas em `_index.json`: 0/7 -> 7/7
- Cobertura em `_coverage.json`: ausente -> linha-de-base declarada

**Risco de nao fazer**
> 6 devs trabalhando em paralelo sem o "GPS" ontologico — proximas revisoes Regis partem sem baseline.

**Dependencias**: `OntologyCurator` promove o `_inbox/frente-iv-arquitetura-modular.md` para arquivos formais em `entities/`, `actions/`, `state-machines/`.

---

### [fault-tolerance-6] Fortalecer contrato de MetricsPort.withCorrelationId (teste de propagacao obrigatorio)

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforco**: S
**Findings**: F-fault-tolerance-6

**Problema**
> `MetricsPortStub.withCorrelationId` e pass-through, e o contrato do interface so menciona a obrigacao de vincular o correlationId no `logService` como "discipline note" — nada trava. Se Modulo 6 esquecer, os logs downstream perdem rastreabilidade sem quebrar nenhum teste.

**Melhoria Proposta**
> Adicionar 1 teste de contrato no `RecebimentoPipelineService.test.ts` que grava chamadas ao `logService` e verifica que **todo** log emitido durante `run()` carrega `qive_id === correlationId`. Documentar no JSDoc do port que impls que nao bindarem falham este teste.

**Resultado Esperado**
> Impl real de Modulo 6 sem `logService.setMetadata` dentro do escopo quebra a suite. Rastreabilidade cross-stage garantida por teste, nao por convencao.

**Metricas de sucesso**
- Testes de propagacao de correlationId: 0 -> >= 1

**Risco de nao fazer**
> Primeiro incidente em producao deixa o postmortem sem correlationId em metade dos logs.

**Dependencias**: Nenhuma.

---

### [security-5] Apertar runPipelineSchema — valorRecebido.positive().finite() e regex em contaDestino

**QA**: Security
**Tactic alvo**: Validate Input
**Esforco**: S
**Findings**: F-security-5

**Problema**
> `runPipelineSchema.valorRecebido` = `z.number()` aceita `NaN`, `-Infinity`, negativos, 0 e valores > `1e308`. `contaDestino` = `z.string().min(1)` aceita `"x"`. Quando o Modulo 5 chamar o ERP, esses degenerados atravessam o boundary.

**Melhoria Proposta**
> `valorRecebido: z.number().finite().positive().multipleOf(0.01)` (limita a duas casas decimais — moeda). `contaDestino: z.string().regex(/^\d{4,20}(-\d)?$/)` (ou o formato exato do Conexos, alinhar com Modulo 5).

**Resultado Esperado**
> Input degenerado e 400 no boundary, nao erro no ERP. Metrica: campos money/estruturais sem faixa: 2 -> 0.

**Metricas de sucesso**
- Campos monetarios com `.positive().finite()`: 0/1 -> 1/1
- Campos de conta com regex: 0/1 -> 1/1

**Risco de nao fazer**
> Quando a integracao ERP virar real, um NaN/Infinity produz erro obscuro do lado do Conexos + log ruim + retry mal-comportado no ledger.

**Dependencias**: alinhamento com Modulo 5 sobre o formato exato de `contaDestino` (regex Conexos).

---

### [deployability-5] Provisionar staging Render separado do prod (roadmap)

**QA**: Deployability
**Tactic alvo**: In-Vivo Testing
**Esforco**: M
**Findings**: F-deployability-5

**Problema**
> O `render.yaml` tem 1 unico servico apontando pra `main`; CI roda em `dev` mas nada consome esse pipeline. Todo merge em `main` vai direto ao ambiente unico com trafego real. Nao e culpa do scaffold (herdado do setup atual), mas a Frente IV entra numa arquitetura onde o dark-launch e a unica linha de defesa.

**Melhoria Proposta**
> Adicionar um segundo `service` no `render.yaml` (`financeiro-backend-stg`) apontado pro branch `dev`, com `RECEBIMENTOS_ENABLED=true` e banco Supabase separado. Fase seguinte, gate de PR: "merge em main so depois de smoke em stg".

**Resultado Esperado**
> Staging real onde a Frente IV pode ser ligada antes de prd. Ambientes ativos: 1 -> 2.

**Metricas de sucesso**
- Services no `render.yaml`: 1 -> 2
- Deploys em prd sem passar por stg: 100% -> <= 10%

**Risco de nao fazer**
> Primeiro cutover real da Frente IV (`RECEBIMENTOS_ENABLED=true`) acontece direto em prod; o gate cai so em uma linha de defesa (o proprio codigo do modulo).

**Dependencias**: decisao de custo (nova instancia Render + novo Supabase); fora do escopo do scaffold, mas o scaffold intensifica a necessidade.

---
