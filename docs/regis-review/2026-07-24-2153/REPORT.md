---
type: regis-review-report
run_id: 2026-07-24-2153
generated_at: 2026-07-24T22:10:00Z
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: Frente IV base scaffold (contracts-first, fully-stubbed) — worktree /tmp/frente-iv-base-scaffold-wt
total_cards: 42
total_p0: 1
total_p1: 13
total_p2: 21
total_p3: 7
overall_score: 7.77
---

# Regis-Review — financeiro / Frente IV base scaffold — 2026-07-24-2153

> **Contexto obrigatorio**: o objeto de revisao e um **scaffold contratos-first, totalmente stubbed**
> sobre o qual 6 teammates vao construir a logica real dos modulos (Ingestao Nexxera, Matching,
> Rateio, Regras, Execucao ERP+NDe, Observabilidade). Nenhum finding foi filed contra "logica de
> negocio ausente" — o julgamento e exclusivamente sobre a **qualidade dos seams**. A pergunta
> operacional que guiou tudo: *"quando os 6 times encostarem esse scaffold, os defeitos herdados
> serao erros obvios ou dividas que so aparecem em producao?"*
>
> **P0 no pipeline**: apenas o P0 re-entra o AutoLoopRunner antes do commit. P1/P2/P3 viram
> follow-ups em `ontology/_inbox/frente-iv-base-scaffold-regis-followups.md`. A secao 8 abaixo e
> explicita sobre o que bloqueia commit e o que e fixado depois.

## 1. Executive scorecard

Pesos aplicados (financeiro / money-moving multi-tenant): Security 1.5, Fault Tolerance 1.3,
Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9,
Deployability 0.9 — total 9.0.

| QA | Score (0-10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 6.0 | 1* | 2 | 2 | 0 | F-availability-1: coordinator sem try/catch -> ledger preso em `reconciling` -> risco dupla-baixa/dupla-NDe |
| Deployability | 8.2 | 0 | 1 | 3 | 1 | F-deployability-1: `RECEBIMENTOS_ENABLED` ausente de `render.yaml` e `DEPLOY.md` |
| Integrability | 8.5 | 1* | 0 | 3 | 2 | F-integrability-1: mesma raiz — 3 hops (ERP->NDe->ledger) sem tratamento entre chamadas |
| Modifiability | 8.5 | 0 | 1 | 3 | 2 | F-modifiability-1: `RecebimentoRepository.save` descarta `rateios`/`regrasAplicadas` — spine lossy |
| Performance | 7.5 | 0 | 2 | 3 | 0 | F-performance-1: ingestao sem seam `BoundedConcurrency` — repete burst que derrubou SISPAG |
| Fault Tolerance | 7.5 | 1* | 2 | 2 | 1 | F-fault-tolerance-1: mesma raiz (P0 consolidado); F-fault-tolerance-3: `versao` nao usada no UPDATE |
| Security | 8.5 | 0 | 2 | 2 | 1 | F-security-1: `POST /pipeline/run` aceita `filCod` do body sem authz por-filial (money-moving multi-filial) |
| Testability | 7.5 | 0 | 3 | 3 | 0 | F-testability-2: teste "propaga correlation id" nao olha para `metrics.emit` — invariante mudo |
| **Overall** | **7.77** | **1** | **13** | **21** | **7** | — |

\* O P0 e **unico** e **consolidado**: a mesma seam foi rated P0 por Availability e P1 por
Integrability + Fault Tolerance. Aplicamos a regra "highest severity wins + money-movement double
execution" e mesclamos os 3 findings numa carta unica (ver secao 2 R-1 e secao 8).

Score interpretation:
- 0-3: risco estrutural — bloqueia escalonamento
- 4-6: divida defensavel — enderecar nesta janela de planejamento
- 7-8: saudavel com oportunidades pontuais
- 9-10: estado-da-arte para o estagio atual

**Leitura sintetica**: o scaffold e solido nas joias da coroa (SQL 100% parametrizado, DI por
Symbol tokens, ledger write-ahead correto no repositorio, guards puros do state-machine, gate
fail-safe em prod). Cai em **Availability** porque a unica classe de bug real (nao hipotetica)
que o scaffold introduziria em producao e dupla-baixa/dupla-NDe se o coordinator for pluggado como
esta. Testability marca 7.5 porque a arquitetura e otima para teste (Sandbox, Abstract Data
Sources, Limit Non-Determinism OK) mas as asserts do unico teste do coordinator sao fracas — 11
`metrics.emit` por run com 0 asserts.

## 2. Top 10 risks (cross-QA)

Ranqueados por composite score = severity x business impact x leverage (efeito multiplicador
sobre os 6 teammates que vao construir em cima).

### R-1: Coordinator executa 3 escritas irreversiveis (ERP->NDe->ledger) sem try/catch — dupla-baixa e dupla-NDe na primeira retentativa
- **QA(s) afetados**: Availability (P0), Fault Tolerance (P1), Integrability (P1) — **rated P0 consolidado**
- **Findings de origem**: F-availability-1 (`RecebimentoPipelineService.ts:183-264`), F-integrability-1 (idem), F-fault-tolerance-1 (idem)
- **Evidencia sintetizada**: `grep -n 'try\|catch\|markError' RecebimentoPipelineService.ts` -> 0 hits. O bloco `beginExecution -> criarBordero -> gravarBaixa -> emitir -> markSettled` (linhas 202-242) roda sem envelope. O irmao `ReconciliacaoPermutaService.ts:220-256` ja implementa exatamente o padrao que falta aqui.
- **Impacto tecnico**: qualquer 5xx/timeout do Conexos ou Nexxera apos `beginExecution` deixa a linha `recebimento_execucao` presa em `status='reconciling'` para sempre. Retentativa manual acha `alreadySettled=false`, reissue de `criarBordero`+`gravarBaixa` -> potencial baixa duplicada no ERP + NDe emitida em duplicidade (impacto fiscal, nao apenas operacional).
- **Impacto de negocio**: dupla-quitacao de recebivel em prod = valor contabil duplicado; NDe em duplicidade = evento fiscal; retrabalho manual de estorno; quebra explicita da promessa "0 baixas duplicadas" do cenario Bass. Este e o unico risco em toda a review que atende os 3 criterios money-movement.
- **Card(s) Kanban relacionados**: `p0-executar-recebimento-safety` (consolidado); dependencias: `fault-tolerance-2` (setBorCod), `availability-3` (RetryExecutor), `availability-2`/`performance-2` (timeoutMs), `testability-3` (teste de falha).
- **Custo de inacao em 6 meses**: ~1 incidente de duplicidade por janela de manutencao Conexos (historico Frente II sugere ~1/trimestre); cada evento = 2-4h de estorno manual no ERP + tempo de compliance auditando NDe fantasma. Premissa: `RECEBIMENTOS_ENABLED=true` em prod dentro da janela.

### R-2: `RecebimentoPipelineService.executarRecebimento` sem `setBorCod` incremental — bordero orfao sem rastreio
- **QA(s) afetados**: Fault Tolerance (P1)
- **Findings de origem**: F-fault-tolerance-2 (`ports.ts:199-206`)
- **Evidencia sintetizada**: `RecebimentoExecucaoRepositoryInterface` expoe so `beginExecution`+`markSettled/markError`; o irmao `PermutaExecucaoRepository` expoe tambem `setBorCod`+`setRequestPayload`. Colunas `bor_cod BIGINT` e `request_payload JSONB` ja existem na migracao 0035, sem metodo para preenche-las incrementalmente.
- **Impacto tecnico**: se `criarBordero` retorna `borCod=999000` e o processo cai antes de `gravarBaixa`, o ledger nao tem esse `borCod` — reaper e analise manual ficam impossibilitados de reconciliar.
- **Impacto de negocio**: borderos fantasma acumulam no Conexos sem rastro no dashboard da Frente IV; analista precisa vasculhar o ERP manualmente.
- **Card(s) Kanban relacionados**: `fault-tolerance-2` (S).
- **Custo de inacao em 6 meses**: 3-5 borderos orfaos/quinzena assumindo taxa de falha realistica; cada um = 15-30min de reconciliacao manual.

### R-3: Ingestao port sem `BoundedConcurrency` — repete o burst `LOGIN_ERROR_MAX_SESSIONS` que derrubou SISPAG
- **QA(s) afetados**: Performance (P1), Availability (indireto via workers pinnados)
- **Findings de origem**: F-performance-1 (`ports.ts:40-53,136-139`)
- **Evidencia sintetizada**: `IngestaoTransacoesInterface.run(input: { filCod: number })` e singular. O padrao comprovado (`IngestaoPagamentosService.ts:81-91`) usa `this.bounded.run(filCods, worker, FANOUT_LIMIT=4)` para nao estourar o pool de sessoes Conexos. O port nao convida ao pool bounded nem menciona advisory lock.
- **Impacto tecnico**: quando Modulo 1 aterrissar, o caminho ergonomico sera `Promise.all(filCods.map(...))` — 10 filiais x 3 conexoes = 30 sessoes simultaneas > limite pratico (~10 no Conexos).
- **Impacto de negocio**: dia perdido em firefighting no primeiro rollout Fase 1; MTTR alto porque a culpa "parece do Nexxera" e e do proprio codigo; retrabalho de contrato depois que 6 teammates ja escreveram o consumidor.
- **Card(s) Kanban relacionados**: `performance-1` (S — so assinatura + stub + teste).
- **Custo de inacao em 6 meses**: 1 incidente P1 de sessao Conexos na Fase 1; refactor cross-modular em 3-6 pessoas depois.

### R-4: `POST /recebimentos/pipeline/run` aceita `filCod` sem authz por-filial — segregation-of-duties quebrada em money-moving
- **QA(s) afetados**: Security (P1)
- **Findings de origem**: F-security-1 (`routes/recebimentos.ts:35-108`)
- **Evidencia sintetizada**: `requireRole('admin')` valida role, nao escopo. Um analista admin de SP pode disparar `criarBordero`+`gravarBaixa`+`emitirNde` na filial MG so mudando o `filCod` no body. Mesmo vale para `contaDestino` (routing bancario) e `borVldTipo`.
- **Impacto tecnico**: quando Modulo 5 for real, cross-filial abuse e possivel por qualquer admin comprometido ou mal-intencionado. Trilha de auditoria registra "quem" mas nao impede "onde".
- **Impacto de negocio**: violacao de segregation-of-duties em money-moving multi-filial. LGPD + compliance financeira.
- **Card(s) Kanban relacionados**: `security-1` (M — depende de modelagem `app_user x filial`).
- **Custo de inacao em 6 meses**: baixa probabilidade x altissimo impacto (evento unico de fraude interna pode virar auditoria externa).

### R-5: `versao` (optimistic concurrency) declarado na tabela mas nunca aplicado no UPDATE — lost update silencioso
- **QA(s) afetados**: Fault Tolerance (P1), Modifiability (P3 via card 5)
- **Findings de origem**: F-fault-tolerance-3 (`RecebimentoRepository.ts:35-43`), F-modifiability-5
- **Evidencia sintetizada**: migracao 0033:19 declara `versao INTEGER NOT NULL DEFAULT 0` + comentario "Concorrencia otimista (espelha o I6 do lote)". `save` faz `versao = EXCLUDED.versao` sem `WHERE versao = $expected`. Coordinator faz 4 mutacoes spread sem incrementar `versao`.
- **Impacto tecnico**: analista atualiza rateio no painel enquanto coordinator recomputa em retry -> 2o save vence silenciosamente. Invariante I-Receb-1 (Σ rateio <= valorRecebido) pode ser violada sem deteccao.
- **Impacto de negocio**: divergencia silenciosa entre `resultado_execucao` gravado e rateio efetivamente vigente; auditoria vira "quem gravou por ultimo ganhou".
- **Card(s) Kanban relacionados**: `fault-tolerance-3` (S) + `modifiability-5` (S) — coordenar como um so.
- **Custo de inacao em 6 meses**: baixa frequencia hoje (fluxo linear por correlationId), mas quando painel Fase 3 permitir edicao manual em paralelo com retry, torna-se recorrente.

### R-6: Coordinator test nao olha `metrics.emit` nem PARAMS do ERP — invariantes mudo, refactor pode dropar tudo silenciosamente
- **QA(s) afetados**: Testability (P1)
- **Findings de origem**: F-testability-2, F-testability-3, F-testability-4
- **Evidencia sintetizada**: teste "propagates the correlation id through every metrics stage" verifica `result.correlationId === 'corr-0001'` — que e o **input voltando intacto**, nao a propagacao. `MetricsPortStub` nunca e espionado. `criarBordero`/`gravarBaixa` nunca tem `expect(spy).toHaveBeenCalledWith(expect.objectContaining({ borVldTipo, contaDestino }))`. Um refactor que troque `input.borVldTipo` por `2` literal passa 675/675 tests.
- **Impacto tecnico**: as invariantes anti-regressao que motivaram os PARAMS nao tem gate. A promessa "correlation id em todo evento" para o Modulo 6 e folclore.
- **Impacto de negocio**: Frente II ja teve o incidente `borVldTipo` hardcoded — pode reaparecer. Postmortem sem correlationId em metade dos logs sobe MTTR.
- **Card(s) Kanban relacionados**: `testability-2` (S) + `testability-3` (S). Estes 2 cards juntos sao os quick wins de maior alavancagem em Testability.
- **Custo de inacao em 6 meses**: regressao silenciosa que so aparece na primeira triagem de incidente real.

### R-7: 6 repositorios sem `.test.ts` — ledger de idempotencia (`RecebimentoExecucaoRepository`) com 12.9% branch coverage
- **QA(s) afetados**: Testability (P1)
- **Findings de origem**: F-testability-1
- **Evidencia sintetizada**: `find repository/recebimentos -name '*.test.ts'` -> 0 arquivos. Coverage agregada: 54.17% lines / 12.90% branches / 18.52% functions. O SQL `CASE WHEN status='settled' THEN … END` que garante que retry nunca regride nunca roda em teste real.
- **Impacto tecnico**: se dev Modulo 5 refatorar o ledger e quebrar o `CASE WHEN`, retentativa nao detecta `alreadySettled` -> 2a NDe emitida. O bug-class exato que o ledger existe para prevenir.
- **Impacto de negocio**: mesma classe de risco do R-1 mas em cenario de refactor futuro em vez de falha operacional; producao descobre.
- **Card(s) Kanban relacionados**: `testability-1` (M — 6 unit tests + 1 integration).
- **Custo de inacao em 6 meses**: cresce a medida que os 6 modulos alteram esses repos.

### R-8: `ErpReceivablesGateway` sem Zod nas respostas — regressao da licao ja aprendida no `ConexosBaixaClient`
- **QA(s) afetados**: Integrability (P2), Fault Tolerance (indireto)
- **Findings de origem**: F-integrability-2, F-integrability-3
- **Evidencia sintetizada**: `ConexosBaixaClient.ts:20-35` ja usa `BORDERO_CRIADO_SCHEMA.parse(raw)` / `BAIXA_GRAVADA_SCHEMA.parse(raw)` (Regis P0 antigo). A nova porta nasce sem exigir isso — 4/4 portas externas sem Zod no boundary.
- **Impacto tecnico**: um impl frouxo pode gravar `borCod=NaN`/`null` no ledger; ledger aceita (`COALESCE`), mas rastreio para reversao fica quebrado.
- **Impacto de negocio**: impossivel reverter baixa registrada sem `borCod` recuperavel -> retrabalho manual no ERP.
- **Card(s) Kanban relacionados**: `integrability-2` + `integrability-3` (S+S).
- **Custo de inacao em 6 meses**: 6 impls reais nascem sem parse boundary; cada uma introduz variante silenciosa de tolerancia.

### R-9: Nenhum timeout nos ports externos — 1 hang do Conexos pina o worker por 15 min (Lambda alvo) ou indefinidamente (Express atual)
- **QA(s) afetados**: Availability (P1), Performance (P1), Fault Tolerance (indireto)
- **Findings de origem**: F-availability-2, F-performance-2
- **Evidencia sintetizada**: `grep -c 'timeout\|AbortSignal' ports.ts` = 0. Precedente: `IngestaoPermutasService` sofreu incidente Conexos 504 antes do bounded pool. Coordinator faz `await` puro em todos os estagios.
- **Impacto tecnico**: chamada travada pin-a worker inteiro; no Lambda alvo consome o timeout da funcao e produz double-processing quando visibility SQS estoura.
- **Impacto de negocio**: sob incidente, painel de recebimentos "trava"; SLA da conciliacao diaria estoura.
- **Card(s) Kanban relacionados**: `availability-2` + `performance-2` (S+S — mesma edit em `ports.ts`).
- **Custo de inacao em 6 meses**: 1 janela de manutencao Conexos -> 1 hora de fila travada em vez de N x timeout curto.

### R-10: `RECEBIMENTOS_ENABLED` ausente de `render.yaml` e `DEPLOY.md` — operador precisa grepar codigo para ligar/desligar
- **QA(s) afetados**: Deployability (P1)
- **Findings de origem**: F-deployability-1
- **Evidencia sintetizada**: SISPAG teve o cuidado (linhas 32-34 do blueprint); a Frente IV ficou de fora. `grep -in recebimentos render.yaml DEPLOY.md` -> 0 hits.
- **Impacto tecnico**: fail-safe funciona (o modulo entra dormido), mas cutover manual descoberto por leitura de codigo = risco de digitar `RECEBIMENTO_ENABLED` (sem S) ou setar em ambiente errado.
- **Impacto de negocio**: Fase 1 de Recebimentos atrasa 1 ciclo por cutover mal-orquestrado.
- **Card(s) Kanban relacionados**: `deployability-1` (S).
- **Custo de inacao em 6 meses**: pequeno em absoluto, mas erosivo — o padrao de "documentar toggle no blueprint" foi honrado em SISPAG e quebrado agora.

## 3. Cross-cutting findings

Causas-raiz que aparecem em multiplos QAs. As `Notas do agente` (secao 6 de cada QA) sinalizaram
esses cross-links; aqui eles sao consolidados.

### CC-1: Ausencia de exception handling no coordinator — a origem unica do P0
- **Aparece em**: Availability (F-availability-1, F-availability-4), Fault Tolerance (F-fault-tolerance-1, F-fault-tolerance-2), Integrability (F-integrability-1), Testability (F-testability-4)
- **Findings**: F-availability-1 (P0), F-integrability-1 (P1), F-fault-tolerance-1 (P1), F-availability-4 (P2 — MetricsPort nunca emite `error`), F-testability-4 (P1 — 0 testes de caminho de erro)
- **Diagnostico unificado**: o coordinator `RecebimentoPipelineService` nao tem `try/catch` em nenhum estagio. Isso e a causa mecanica de: (a) ledger preso em `reconciling`, (b) `markError` codigo morto no repositorio, (c) `MetricsPort.emit({outcome:'error'})` nunca ocorrer (o tipo preve `error`, o codigo nao), (d) testes de caminho de erro nao existirem. Um unico fix arquitetural remove 4 sintomas.
- **Recomendacao consolidada**: cartao P0 `p0-executar-recebimento-safety` — envolve os 3 hops (`criarBordero`/`gravarBaixa`/`emitir`) em `try { … } catch (err) { markError; metrics.emit({outcome:'error'}); throw }`, seguindo 1:1 o padrao `ReconciliacaoPermutaService.ts:220-256`. Cards satelite (`availability-4`, `testability-3`) fecham as pontas de observabilidade e teste que o P0 destrava.

### CC-2: Portas externas nasceram frouxas — timeout, retry, Zod, batch, versionamento todos ausentes no boundary
- **Aparece em**: Availability (F-availability-2, F-availability-3), Performance (F-performance-2, F-performance-3), Integrability (F-integrability-2, F-integrability-3, F-integrability-5), Fault Tolerance (parcial)
- **Findings**: 7 findings distintos, mesma raiz — `ports.ts:132-171` declara `NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`, `NdeEmitterInterface` com assinatura minima (sem `timeoutMs`, sem Zod schema, sem `channel`/`apiVersion`, sem `gravarBaixaBatch`).
- **Diagnostico unificado**: contratos sao pegajosos — os 6 teammates vao reproduzir literalmente o que o port dita. Se o port nao forca timeout hoje, ninguem adiciona depois. Se nao forca parse Zod, os 6 impls reais divergem silenciosamente. A licao do `ConexosBaixaClient` (Regis P0 antigo) nao foi transferida.
- **Recomendacao consolidada**: 1 edit em `ports.ts` cobrindo (a) `timeoutMs?: number` nos 3 ports externos, (b) publicar `*Schema` Zod para respostas escritas, (c) `channel: 'api'|'sftp'`+`apiVersion` em `RawMovimento`, (d) `criarBorderoComBaixas` batch — todos combinados. Isso resolve `availability-2`, `performance-2`, `performance-3`, `integrability-2`, `integrability-3`, `integrability-5` em uma sprint. **Deve ser feita antes de M1 (Fase 1) comecar.**

### CC-3: Observabilidade prometida no contrato mas nunca exercitada no coordinator/test
- **Aparece em**: Testability (F-testability-2), Availability (F-availability-4), Fault Tolerance (F-fault-tolerance-6), Integrability (F-integrability-6), Security (F-security-3)
- **Findings**: F-testability-2 (P1 — asserts vazios), F-availability-4 (P2 — `outcome: 'error'` nunca emitido), F-fault-tolerance-6 (P3 — `withCorrelationId` e pass-through), F-integrability-6 (P3 — `attributes` sem tipo fechado), F-security-3 (P2 — PII em attributes sem enforcement runtime).
- **Diagnostico unificado**: o `MetricsPortInterface` e o contrato mais fragil do scaffold. Emite `started`/`ok` mas nunca `error` (CC-1); `attributes` e `Record<string, ...>` que aceita CNPJ; `withCorrelationId` e pass-through sem contrato executavel; teste do coordinator nao olha `emit` em nenhum caso.
- **Recomendacao consolidada**: `testability-2` (S — espionar `emit` e ERP params) desbloqueia asserts; `integrability-6` (S — fechar tipo `attributes`) e `security-3` (S — scrubber runtime) fecham PII; `fault-tolerance-6` (S — teste de propagacao obrigatorio) formaliza o contrato de `withCorrelationId`. 4 cards S que compoem 1 sprint de "endurecer o MetricsPort" antes de Modulo 6 aterrissar.

### CC-4: Repository layer sem cobertura de teste + spine lossy — o `Recebimento` aggregate esta falso
- **Aparece em**: Testability (F-testability-1), Modifiability (F-modifiability-1), Fault Tolerance (F-fault-tolerance-3), Performance (F-performance-5)
- **Findings**: F-testability-1 (P1 — 0 test files, 12.9% branch), F-modifiability-1 (P1 — `save` descarta `rateios`/`regrasAplicadas`), F-fault-tolerance-3 (P1 — `versao` nao usada), F-performance-5 (P2 — sem `loadAggregate`/`findByIds` -> N+1 no painel)
- **Diagnostico unificado**: `RecebimentoRepository` foi entregue como "raiz-only" — nao persiste filhos, nao incrementa `versao`, nao expoe listagens paginadas ou batch. O port do repo e anemico. Sem testes dedicados, cada uma dessas ausencias vira debito silencioso.
- **Recomendacao consolidada**: `modifiability-1` (M) + `fault-tolerance-3` (S) + `performance-5` (S) + `testability-1` (M) — coordenar como sprint conjunta antes da Fase 3 (`RateioService` real). Repita o padrao `RecebimentoAggregateRepository` que compoe 3 repos, se preferir manter `save` raiz-only.

### CC-5: Portas de listagem/reconciliacao ausentes — reaper e painel viram feature-request tardia
- **Aparece em**: Fault Tolerance (F-fault-tolerance-5), Performance (F-performance-5), Modifiability (F-modifiability-3)
- **Findings**: F-fault-tolerance-5 (P2 — sem `ReceivablesReconcilerInterface`), F-performance-5 (P2 — sem `list(filter, pagination)`), F-modifiability-3 (P2 — coordinator 10 injects, nao plugavel).
- **Diagnostico unificado**: o scaffold cobre write-path bem, mas read-path (painel, fila de execucao) e reap-path (linhas `reconciling` orfas) nao tem seams declaradas — Modulo 6 vai inventar quando precisar.
- **Recomendacao consolidada**: `fault-tolerance-5` + `performance-5` juntos (mesmo `ports.ts`); `modifiability-3` fica para depois (M, refactor maior).

## 4. Quick wins (<=5 dias uteis — cards S com severidade >= P2)

Estes sao os cards para defender em reuniao como "primeira sprint pos-aprovacao". Alta razao
impacto/esforco; todos <= 1 dia util individualmente.

| Card | QA | Esforco | Severidade | Resultado esperado |
|---|---|---|---|---|
| **p0-executar-recebimento-safety** | Availability/Fault Tolerance/Integrability | S | **P0** | 0 execucoes presas em `reconciling`; todo erro vira `error` no ledger; retry seguro. **Bloqueia commit.** |
| **fault-tolerance-2** | Fault Tolerance | S | P1 | `borCod` persistido incrementalmente entre POSTs -> reaper possivel |
| **fault-tolerance-3** | Fault Tolerance | S | P1 | `WHERE versao = $expected` no UPDATE -> lost update detectado (409) |
| **availability-2** | Availability | S | P1 | `timeoutMs` obrigatorio nos 3 ports externos — forca os 6 impls a decidirem teto |
| **availability-3** | Availability | S | P1 | `RetryExecutor` no coordinator -> falhas transitorias absorvidas em vez de virarem incidente |
| **performance-1** | Performance | S | P1 | `runMany` + `BoundedConcurrency` no port de ingestao — previne o burst `LOGIN_ERROR_MAX_SESSIONS` |
| **performance-2** | Performance | S | P1 | `timeoutMs` + `RetryExecutor` nos ports externos (junta com availability-2/3) |
| **security-2** | Security | S | P1 | `correlationId` como UUID + prefixo tenant/user -> colisao maliciosa impossivel |
| **deployability-1** | Deployability | S | P1 | `RECEBIMENTOS_ENABLED` no `render.yaml` + `DEPLOY.md` -> operador nao precisa grepar codigo |
| **testability-2** | Testability | S | P1 | Espionar `metrics.emit` + PARAMS do ERP -> 10 asserts hoje 0; regressao silenciosa impossivel |
| **testability-3** | Testability | S | P1 | 3 cenarios de falha no coordinator test -> `markError` cobrado por CI |
| **integrability-2** | Integrability | S | P2 | `rawMovimentoSchema` Zod publicado -> 4/4 portas externas com boundary parse |
| **integrability-3** | Integrability | S | P2 | `BorderoCriadoSchema`/`BaixaGravadaSchema` publicados -> herdar disciplina do `ConexosBaixaClient` |
| **modifiability-2** | Modifiability | S | P2 | Fatiar `ports.ts` (284 LOC) por modulo -> merge conflicts entre 6 devs caem para zero |
| **modifiability-4** | Modifiability | S | P2 | Registry plugavel de regras (`register(rule)`) antes da Fase 4 -> congela contrato agora |
| **performance-3** | Performance | S | P2 | `gravarBaixaBatch` no port ERP -> 200 recebimentos: 600 POSTs -> 4 |
| **performance-4** | Performance | S | P2 | Cache TTL + indice composto em `regra_recebimento` -> 400ms/dia poupados |
| **performance-5** | Performance | S | P2 | `loadAggregate` + `list` + `findByIds` no port -> painel Fase 3 sem N+1 |
| **security-3** | Security | S | P2 | `MetricsPort.attributes` com type-brand ou scrubber -> PII bloqueada em compile-time/runtime |
| **security-4** | Security | S | P2 | RBAC leve em `GET /painel` -> viewer vs analyst vs admin explicito |
| **deployability-2** | Deployability | S | P2 | Teste de paridade `RECEBIMENTOS_ENABLED` (fail-safe do gate) — SISPAG tem, Recebimentos nao tinha |
| **deployability-3** | Deployability | S | P2 | Runbook `recebimentos-cutover.md` — MTTR de incidente sai de "indefinido" para <= 15 min |
| **deployability-4** | Deployability | S | P2 | Drift detection do `schema_migrations` no CI |
| **fault-tolerance-5** | Fault Tolerance | S | P2 | `listByStatus` + `ReceivablesReconcilerInterface` declarados -> Modulo 6 sabe onde plugar reaper |
| **testability-4** | Testability | S | P2 | 3 fixtures adicionais (`CreditoCliente`, `RegraRecebimento`, `NotaDebitoEletronica`) |
| **testability-5** | Testability | S | P2 | 4 testes negativos de Zod — refactor que afrouxe validacao quebra CI |
| **testability-6** | Testability | S | P2 | Teste do `recebimentosGate` — inverter a logica passa a quebrar CI |

**Contagem**: 27 quick wins. Aproximadamente 20-25 dias-desenvolvedor no total; 4-5 devs em
paralelo fecham em uma sprint.

## 5. Strategic moves (M / L / XL)

Cards de maior folego. Cada linha "Por que vale" amarra a um numero medido.

| Card | QA(s) | Esforco | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `modifiability-1` | Modifiability | M | Encapsulate | `save` grava so a raiz -> reload perde rateios (relacionamentos persistidos: 0/2). Fase 3 depende disso para nao recomputar rateio silenciosamente. |
| `modifiability-3` | Modifiability | M | Defer Binding (runtime registration) + Split Module | Coordinator com 10 injects vira 5 handlers na migracao para Step Functions — sem essa refatoracao, a migracao e big-bang. Alvo: `@inject` 10 -> <= 4. |
| `fault-tolerance-4` | Fault Tolerance | M | Compensating Transaction | 1/4 transicoes do state-machine com seam de codigo (so `EXECUTADO->ESTORNADO` faltando). Sem seed, teammates da Fase 5 vao inventar o estorno do zero — risco de divergencia ledger×ERP. |
| `security-1` | Security | M | Authorize Actors | 1/1 rota de escrita money-moving sem authz por-filial. Impacto negocial (segregation-of-duties + LGPD) justifica o esforco de modelar `app_user x filial`. |
| `testability-1` | Testability | M | Abstract Data Sources + Specialized Interfaces | Coverage `repository/recebimentos` 54.17% -> >= 80%; ledger `RecebimentoExecucaoRepository` de 12.9% branch para >= 60%. Sem isso, um refactor do `CASE WHEN` do `beginExecution` quebra idempotencia sem sinal. |
| `integrability-4` | Integrability | M | Contract testing | 0 -> 3 contract tests (Nexxera, ErpReceivables, NdeEmitter). 6 impls paralelos precisam de gate compartilhado — sem isso, cada team divergira; incidentes de conciliacao pos-Fase 5. |
| `availability-5` | Availability | M | State Resynchronization | Branches de idempotencia cobertos 1/4 -> 4/4. Sem isso, retry sobre `error` reexecuta POST irreversivel cegamente. |
| `deployability-5` | Deployability | M | In-Vivo Testing | Staging Render separado. Nao e do escopo scaffold, mas a Frente IV **intensifica** a necessidade (1 environment ativo hoje). |

## 6. O que esta bem (e por que)

Para ancorar credibilidade — a reuniao defensiva nao e sobre "tudo esta ruim":

1. **SQL 100% parametrizado nos 6 novos repositorios** (Tactic: Encapsulate + Validate Input). `grep -rEn '\$\{' src/backend/domain/repository/recebimentos/` -> 0 hits. A joia da coroa (Inviolable Rule #5) foi honrada.
2. **DI por `Symbol()` tokens em todos os seams** (Tactic: Specialized Interfaces / Manage Resource Coupling). 14 tokens, 0 cross-imports de implementacao modulo->modulo — o design "6 devs em paralelo" esta materializado. Score Modifiability 8.5 e Integrability 8.5 refletem isso.
3. **Write-ahead ledger com `UNIQUE (idempotency_key)` + preservacao de `settled` no upsert** (Tactic: Idempotent Replay). `RecebimentoExecucaoRepository.ts:49-57` copia fielmente o padrao do `PermutaExecucaoRepository`. E o coracao da promessa "nao duplicar" — a metade do problema ja esta resolvida na camada de dados.
4. **`recebimentosGate` fail-safe em producao** (Tactic: Change Default Settings / Removal from Service). `EnvironmentProvider.resolveRecebimentosEnabled` retorna `false` quando env e ausente em prod — dark-launch canonico.
5. **State-machine com guards puros e 100% de cobertura** (Tactic: Sanity Checking). `recebimentoTransitions.ts` + `recebimentoTransitions.test.ts` — 4/4 transicoes legais + 4/4 ilegais cobertas. Constantes tipadas, sem strings cruas (P3 da ontologia respeitado).
6. **Migracoes 100% aditivas e idempotentes** (Tactic: Idempotent Deploys). 7/7 migrations com `CREATE TABLE IF NOT EXISTS`, 0 ALTER/DROP destrutivos, numeracao sequencial sem colisao. Redeploy = no-op.
7. **7 tabelas com 17 indices bem escolhidos** (Tactic: Index Discipline). Lookup keys (`natural_key`, `idempotency_key`, `recebimento_id`, `correlation_id`) todas cobertas; 4/7 tabelas com PK/UNIQUE em chave natural — protecao contra duplicacao em retry desde o DB.
8. **Zod nos 7 DTOs de entidade** (Tactic: Validate Input / Increase Competence Set). Boundaries protegidos por schema; falta apenas estender aos ports externos (CC-2) e endurecer os schemas atuais (`security-5`).

## 7. Limitacoes da analise

- **Metricas nao-mediveis localmente** (declaradas por cada agent):
  - MTTR real quando ledger fica preso em `reconciling` (Availability) — requer instrumentacao em prod.
  - Taxa real de erro por dependencia (Integrability, Performance) — requer CloudWatch em prod.
  - Latencia real Conexos/Nexxera/ERP p95/p99 (Performance) — so e medida na Fase 1 pos-spike O7.
  - Cold-start Lambda (Performance) — nao aplicavel ao runtime atual Express/Render.
  - Deploy success rate multi-cliente (Deployability) — so existe 1 tenant (`local`) hoje.
  - Tempo real de swap stub->real (Modifiability) — vira baseline apos o primeiro merge de modulo.
  - Cobertura SQL real dos 6 repos em Postgres (Testability) — requer integration tests via docker-compose (enderecado em `testability-1`).
  - Distribuicao de roles em prod (Security) — requer inspecao do `app_user` no Supabase de prod.
- **Fora do escopo desta review**: chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade, revocation de JWT (herdado da plataforma).
- **Janela temporal**: snapshot do dia 2026-07-24. Refazer trimestralmente (`/regis-review`) e apos cada aterrissagem de modulo real (Fases 1-5).
- **Consolidacao explicita**: os 3 findings F-availability-1, F-integrability-1 e F-fault-tolerance-1 apontam para o mesmo bloco de codigo (`RecebimentoPipelineService.ts:183-264`). Foram mesclados no card unico `p0-executar-recebimento-safety` (severidade P0 vence). Os cards originais `availability-1`, `integrability-1`, `fault-tolerance-1` foram **absorvidos** — nao aparecem no `KANBAN.md` como cards separados, mas suas evidencias, metricas de sucesso e testes propostos foram consolidados no cartao P0.

## 8. Acoes recomendadas

**Regra do pipeline**: apenas P0 re-entra o AutoLoopRunner. P1/P2/P3 sao registrados como
follow-ups em `ontology/_inbox/frente-iv-base-scaffold-regis-followups.md` e enderecados por
sprint dedicada pos-commit.

### Bloqueia commit deste worktree (P0 — obrigatorio antes do green)
1. **Executar o card `p0-executar-recebimento-safety`** — 1 card, esforco S:
   - Envolver `beginExecution -> criarBordero -> gravarBaixa -> emitir -> markSettled` em `try/catch`.
   - Chamar `execucaoRepository.markError(idempotencyKey, { erroMensagem, erpResponse })` no catch, preservando `borCod` quando `criarBordero` ja respondeu.
   - Emitir `metrics.emit({ stage: 'executarRecebimento', outcome: 'error', … })` no catch.
   - Adicionar 3 testes ao `RecebimentoPipelineService.test.ts` cobrindo (a) `criarBordero` rejeita, (b) `gravarBaixa` rejeita apos `criarBordero`, (c) `emitir` rejeita apos `gravarBaixa`.
   - Espelhar 1:1 o padrao `ReconciliacaoPermutaService.ts:220-256`.

### 30 dias seguintes (P1/P2 — follow-up sprint pos-commit)
2. **Sprint "endurecer os seams externos" (CC-2)** — antes de M1/Fase 1 aterrissar:
   - Cards: `availability-2`, `availability-3`, `performance-1`, `performance-2`, `performance-3`, `integrability-2`, `integrability-3`, `integrability-5`. Todos S, mesmo arquivo (`ports.ts`) + coordinator.
3. **Sprint "endurecer o MetricsPort" (CC-3)** — antes de Modulo 6 aterrissar:
   - Cards: `testability-2`, `integrability-6`, `security-3`, `fault-tolerance-6`. Todos S.
4. **Sprint "endurecer o aggregate" (CC-4)** — antes da Fase 3 (`RateioService`):
   - Cards: `modifiability-1` (M), `fault-tolerance-3` (S), `performance-5` (S), `testability-1` (M).
5. **Sprint "hygiene de deploy"** — pode entrar como side-quest:
   - Cards: `deployability-1`, `deployability-2`, `deployability-3`, `deployability-4`. Todos S.
6. **Sprint "authz money-moving"** — dependencia: modelagem `app_user x filial`:
   - Cards: `security-1` (M), `security-2` (S), `security-4` (S).

### Cards deferidos legitimamente as fases de implementacao dos modulos
- `modifiability-3` (pipeline plugavel) — natural em uma futura migracao Lambda/Step Functions, nao urgente hoje.
- `fault-tolerance-4` (seam de estorno) — natural quando Modulo 5 aterrissar; hoje e P2 seed.
- `deployability-5` (staging separado) — decisao de custo; fora do escopo scaffold.
- `modifiability-6` (plugar em `_index.json`) — `OntologyCurator` faz na promocao do inbox.
- `integrability-4` (contract-test suite) — pode entrar junto com `integrability-2`/`3` ou como sprint dedicada em `__contracts__/`.

---

**Sumario defensavel em 1 frase**: o scaffold entrega arquitetura solida (SQL parametrizado, DI
por tokens, ledger write-ahead, gate fail-safe), mas ha **1 P0 mecanico** (falta try/catch no
coordinator) que precisa entrar antes do commit + **2 sprints de "endurecer contratos externos"**
que precisam entrar antes de qualquer teammate aterrissar o proprio modulo real.
