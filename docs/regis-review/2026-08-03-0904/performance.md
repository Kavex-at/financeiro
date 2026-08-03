---
qa: Performance
qa_slug: performance
run_id: 2026-08-03-0904
agent: qa-performance
generated_at: 2026-08-03T09:20:00Z
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

> Escopo: delta `fix/sn-cond-pgto-finalizacao..fix/sn-titulo-condicao-fail-closed`, centrado em
> `RecebimentoNumerarioService.completarSnAdiantamento`. O recurso escasso REAL é a chamada HTTP ao
> ERP Conexos — lenta, com sessão limitada (`LOGIN_ERROR_MAX_SESSIONS ~= 3` por usuário) — que roda
> DENTRO do request síncrono de `POST /recebimentos/transacoes/:txnId/solicitacao-numerario`
> ("Processar" clicado pelo analista). Não existe Lambda / cold start / SQS aqui (Express+Render).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Processar" no dashboard de Recebimentos | 1 request HTTP sync que dispara o fluxo REAL (etapaSn → etapaFin014 → etapaNotaDebito → …) | `RecebimentoNumerarioService.processarAlocacao` + toda a cadeia de clients Conexos | Prod, sessão do usuário compartilhando ≤3 slots com outros requests concorrentes | Devolver 200 (settled ou error tipado) o mais rápido possível, sem bater no ERP mais do que o necessário | # chamadas Conexos por "Processar" (métrica primária — latência absoluta não é medível localmente); happy path etapaSn: ~14 → ~12 (redução após delta); PUT destrutivo eliminado em 100% do happy path |

## 2. Métricas observadas

Métrica primária: **contagem de chamadas ao ERP Conexos**, contada por leitura estática do código
(o único proxy defensável sem instrumentação em produção). Contagens abaixo referem-se APENAS à
`etapaSn` do `RecebimentoNumerarioService` — o resto do pipeline (fin014, NDe, fiscal, obs,
homologar, poll) NÃO é tocado pelo delta.

| Métrica | Valor atual (AFTER delta) | Valor anterior (BEFORE delta) | Alvo | Status | Fonte |
|---|---|---|---|---|---|
| Chamadas ERP em `completarSnAdiantamento` — happy path (sem bloqueante) | **5** (`listContasProjetoCtb`, `getDocumento`, `comDocProdutosInitialValues`, `adicionarComDocProduto`, `listValidacoes`) | 7 (+ paginação de `listCondPgtoPessoa`) — 8+ efetivos | ≤ 5 | ✅ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:452-621` (contagem manual dos 4 métodos `await this.*Client.*`) |
| Chamadas ERP em `completarSnAdiantamento` — path bloqueante (com194 exige) | **9** (+ paginação de `listCondPgtoPessoa`) | 7 (+ paginação) | ≤ 9 | ✅ (justificado por correção) | idem, linhas 451-519 |
| Chamadas ERP totais em `etapaSn` — happy path (pré-flight + payload + geração + completar + finalizar) | **~12** | ~14 (contando 1 página de `listCondPgtoPessoa`) | monotônico decrescente | ✅ | mesmo arquivo, linhas 392-432 + 452-621 |
| PUT `atualizarDocumento` executado no happy path | **0** (removido) | 1 (SEMPRE, e destrutivo — zerava `mnyTitValor`) | 0 | ✅ | linha 489 (executa APENAS após `requiresRegisteredPaymentCondition===true`) |
| Chamadas EXTRAS por SN destruída → retrabalho manual em `com032` + reprocessamento | **0** (fail-closed antes de finalizar) | N (por SN quebrada: 1 reabertura no ERP + 1 novo "Processar" = ~14 chamadas a mais) | 0 | ✅ | linhas 500-518 (throw explícito se `mnyTitValor !== docMnyValor`) |
| Chamadas paginadas de `listCondPgtoPessoa` no happy path (evitadas) | **0** (não é chamado) | ≥ 1 página (medido: 2 páginas para `pesCod 232` em HML — 86 linhas c/ pageSize=500 ignorado) | evitar | ✅ | `ConexosGerDocProcessoClient.ts:833-869` (loop `for pageNumber` até `count`) |
| Novas leituras adicionadas pelo delta | **2** no path bloqueante (`listValidacoes` + `getDocumento` de verificação) | — | justificadas por correção | ✅ com ressalva | linhas 503-507 e 531-535 |
| Reuso possível do `getDocumento` entre `addLineItem` e `applyPaymentConditionIfRequired` | **0** (impossível — estados legitimamente diferentes: antes vs depois do item) | — | N/A | ✅ | `addLineItem` lê ANTES de `adicionarComDocProduto` (linha 596); `applyPaymentConditionIfRequired` lê DEPOIS (linha 484) |
| Tempo de resposta wall-clock de "Processar" (p50/p95) | — | — | — | ⚠️ | Não medível localmente |
| Latência p95 do Conexos ERP por endpoint | — | — | — | ⚠️ | Não medível localmente |
| Session-slot contention na sessão do analista durante um único "Processar" | 1 sessão fixa (mesmo `sid` reusado por `ensureSid`) | idem | 1 | ✅ | `ConexosSessionRegistry.ts` + `runWithRetry` em cada client |

> ⚠️ **Não medível localmente** — sem `CloudWatch`/`X-Ray`/Sentry-perf ligado nesta faixa, não há como
> converter contagem de chamadas em milissegundos. Recomendação: **instrumentar `LogService` com um
> contador por-etapa** (`this.logService.info({ type: 'PERF_METRIC', etapa: 'sn.completar', erpCalls, ms })`)
> — hoje o LogService só faz `info/warn/error` textual (`src/backend/domain/service/LogService.ts`).
> Uma vez instrumentado, este relatório pode virar dado real na próxima passagem.

> ⚠️ **Não medível sem produção**: contagem de "SNs cujo título ficou zerado" por dia (a métrica de
> negócio que motivou o delta). O `docs/e2e/gap-titulos-diagnostico.md` documenta o comportamento no
> HML; a incidência em produção só sai de uma consulta a `Solicitacao_Numerario_Execucao` + join com
> a leitura do ERP, que o repo não expõe como comando.

## 3. Tactics — Cobertura no nf-projects

### Control Resource Demand

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A para este delta — a "amostragem" é 1 evento = 1 "Processar" do analista, não streaming | N/A | fluxo request/response único |
| Limit Event Response | `heavyRouteLimiter` na rota + idempotência por alocação (`sn-real:{txnId}:{priCod}:{valor}`) — um re-POST não redispara toda a cadeia, RETOMA da etapa que faltou | ✅ presente | `src/backend/routes/recebimentos.ts:391-393` (limiter); `RecebimentoNumerarioService.ts:241` (key idempotente) + linhas 337-346 (retomada via `existente?.etapa`) |
| Prioritize Events | N/A — sem fila entre "Processar" e ERP | N/A | request síncrono direto |
| **Reduce Overhead** | **Delta remove o PUT+GET pré-item do happy path** (2 chamadas ERP evitadas, mais 1+ página de `listCondPgtoPessoa`). Ganho medido por contagem estática. | ✅ **melhorado por este delta** | `RecebimentoNumerarioService.ts:451-454` (só chama `applyPaymentConditionIfRequired` sob demanda); comparar com base branch (rodava incondicional) |
| Bound Execution Times | Timeout por chamada é do axios do `ConexosBaseClient` (ver qa-availability); no serviço, sem timeout no wrapper `processarAlocacao` inteiro. Se o ERP ficar lento em 3 endpoints, "Processar" pode ficar minutos no ar. | ⚠️ parcial (não é regressão do delta) | ausência de `AbortController`/`Promise.race` no orquestrador |
| Increase Resource Efficiency | `listValidacoes` é uma leitura NOVA que hoje é INCONDICIONAL no happy path (`applyPaymentConditionIfRequired` sempre a executa antes do early-return). Poderia ser deferida ao caminho de falha da finalização — trade-off: fail-closed x -1 chamada. | ⚠️ parcial | linhas 469, 526-557 |

### Manage Resources

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | N/A — o gargalo é o ERP externo, não CPU/RAM/DB local | N/A | — |
| Increase Concurrency | Não aplicável ao request único; a nível pipeline, `BoundedConcurrency` (`FANOUT_LIMIT_RECEBIMENTOS`) protege o pool de sessões — não tocado pelo delta | ✅ presente (fora do escopo do delta) | `src/backend/domain/libs/concurrency/BoundedConcurrency.ts:70`; `src/backend/domain/interface/recebimentos/constants.ts:109` |
| Maintain Multiple Copies of Computations | `stripAccents` reimplementado local (linhas 559-564) enquanto `normalizarNomePessoa` (linhas 691-697) faz o mesmo core. Duplicação micro; sem impacto de perf. | ⚠️ parcial | linhas 559-564 vs 691-697 |
| Maintain Multiple Copies of Data | GET-antes-do-PUT + GET-depois-do-PUT é uma "cópia de dados" (snapshot antes/depois) — essencial para o fail-closed do delta. Não é redundância evitável. | ✅ (justificado) | linhas 484-488 e 503-507 |
| Bound Queue Sizes | N/A no escopo (sem fila entre analista e ERP) | N/A | — |
| Schedule Resources | Delta impõe ORDEM crítica: item ANTES da condição (medido no HML — a ordem invertida destruía o título). O commit trocou a ordem para preservar `mnyTitValor`. Ganho de correção, não de perf pura, mas evita retrabalho (que é o pior gasto de recurso ERP). | ✅ presente (por este delta) | linhas 451-454 (`addLineItem` antes de `applyPaymentConditionIfRequired`) + `docs/e2e/gap-titulos-diagnostico.md` |

### Facets modernos

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Cold start budget | N/A — Express long-running, sem Lambda | N/A | CLAUDE.md "Estado Atual vs. Alvo" |
| Cache strategy | Sem cache do `getDocumento` intra-request (poderia haver, mas os 3 GETs do delta leem estados legitimamente diferentes — nenhum é cacheável). Cache de sessão Conexos (`ConexosSessionRegistry`) já existe. | ✅ presente onde faz sentido | `src/backend/domain/client/ConexosSessionRegistry.ts` |
| Index discipline (SQL) | N/A — o delta não toca em SQL. `Solicitacao_Numerario_Execucao` (repo do ledger) tem PK por `idempotency_key`, o lookup dominante | ✅ (fora do escopo do delta) | ver qa-modifiability |
| Bundle leanness | N/A backend Express (sem cold start) | N/A | — |

## 4. Findings (achados)

### F-performance-1: Nova leitura `listValidacoes` é incondicional (não deferida ao caminho de falha)

- **Severidade**: P3 (baixo — trade-off defensível, opção de otimização)
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:469, 526-557`
- **Evidência (objetiva)**:
  ```
  linha 469:  if (!(await this.requiresRegisteredPaymentCondition(ctx, snDocCod))) return;
  linha 531:  const validacoes = await this.fiscalClient.listValidacoes(...)  // com194/documento/list
  ```
  `applyPaymentConditionIfRequired` chama `listValidacoes` SEMPRE, mesmo quando o path é o comum
  (analista com pessoa cujo cadastro não exige condição sugestiva → nenhuma validação bloqueante).
  Esta é 1 chamada ERP adicionada pelo delta ao happy path.
- **Impacto técnico**: +1 chamada Conexos por "Processar" no happy path. Alternativa "try-then-remediate"
  (tentar `finalizarDocumento` e, no erro específico "CONDIÇÃO DE PAGAMENTO SUGERIDA", ler `listValidacoes`
  e aplicar) economizaria essa chamada no path comum, ao custo de ficar mais frágil na recuperação
  parcial. O ganho é 1 chamada; a rota já faz ~14 no total. Custo/benefício marginal.
- **Impacto de negócio**: negligível — mesmo ordem de grandeza da perf que o delta já economizou
  removendo o `listCondPgtoPessoa` do happy path (2 páginas medidas no HML).
- **Métrica de baseline**: 1 chamada adicional por happy-path "Processar" (100% dos casos).

### F-performance-2: Delta reduz chamadas ao ERP e elimina o PUT destrutivo no happy path (finding positivo)

- **Severidade**: P3 (positivo — registrado para o consolidator não interpretar as +2 do path bloqueante isoladamente)
- **Tactic violada**: nenhuma — Reduce Overhead + Schedule Resources APLICADAS
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:451-621`
- **Evidência (objetiva)**:
  ```
  BEFORE (base fix/sn-cond-pgto-finalizacao): completarSnAdiantamento fazia 7 chamadas SEMPRE
    (listCondPgtoPessoa paginada + getDocumento + PUT + listContasProjetoCtb + getDocumento +
     comDocProdutosInitialValues + adicionarComDocProduto)
  AFTER (fix/sn-titulo-condicao-fail-closed) happy path:  5 chamadas (sem PUT, sem listCondPgtoPessoa)
  AFTER path bloqueante:                                  9 chamadas (+listValidacoes + verify GET)
  ```
  Contagem por leitura manual — os 4 `await this.*Client.*` em `addLineItem` (linhas 578, 596,
  601, 606) + 1 em `applyPaymentConditionIfRequired` (linha 531) no happy path.
- **Impacto técnico**: reduz load no ERP em cada "Processar" comum e elimina a causa raiz de SNs sem
  título (que forçavam intervenção manual em `com032` — trabalho externo ao sistema).
- **Impacto de negócio**: SN pronta para `etapaFin014` na primeira execução; o custo real evitado é
  o retrabalho manual do analista + o segundo "Processar", que somam facilmente >20 chamadas ERP
  por SN quebrada.
- **Métrica de baseline**: happy path 7→5 chamadas (-29%); PUT destrutivo 100%→0%.

### F-performance-3: `listCondPgtoPessoa` fetcha a lista GLOBAL do ERP e filtra client-side

- **Severidade**: P3 (mitigado por este delta — antes era ~P2 no happy path; agora só ocorre no path bloqueante)
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:820-869`
- **Evidência (objetiva)**:
  ```
  linha 822-823: "o `pesCod` vai no `filterList` mas o ERP o IGNORA e devolve a lista GLOBAL
  ordenada por nome — quem filtra pelo cliente é o caller, e para isso precisa da lista INTEIRA"
  HML medido: pesCod 232 → count:86 com pageSize=500 ignorado (2 páginas)
  ```
- **Impacto técnico**: cada invocação = 1..N POSTs sequenciais em `lov/CondPgtoPessoa` (até esgotar
  `count`). Não é novo — pré-existente. O delta o torna CONDICIONAL (só chamado quando com194 acusa
  bloqueante), então o impacto quotidiano cai muito.
- **Impacto de negócio**: para a pessoa 194 (produção) e similares, cada "Processar" continua
  pagando 2+ round-trips só pra achar a condição do próprio cliente. Sem contrato ERP para
  filtragem server-side, cache LRU por `pesCod` (TTL curto) seria uma alternativa — mas com < 1
  chamada/analista/dia no path bloqueante, não vale ainda.
- **Métrica de baseline**: 2 páginas × latência p50 Conexos por invocação bloqueante. Frequência
  drasticamente reduzida pelo delta (era 100% → agora só quando `fdvVldErr=2` casa a regex).

### F-performance-4: `stripAccents` reimplementado local, duplicando `normalizarNomePessoa`

- **Severidade**: P3 (micro; sem impacto de perf real)
- **Tactic violada**: Maintain Multiple Copies of Computations (não é sobre perf; é sobre
  DRY — legítimo mais em Modifiability)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:559-564` vs `691-697`
- **Evidência (objetiva)**:
  ```
  linha 560-564:  stripAccents = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  linha 691-697:  normalizarNomePessoa = (nome) => nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(...).trim();
  ```
- **Impacto técnico**: CPU negligível (µs por invocação) — não é gargalo. Registrado porque uma refac
  poderia deduplicar, mas a Perf não pede ação.
- **Impacto de negócio**: nulo.
- **Métrica de baseline**: N/A.

## 5. Cards Kanban

### [performance-1] Instrumentar contador de chamadas ERP por etapa em `RecebimentoNumerarioService`

- **Problema**
  > Não existe métrica em runtime para chamadas ao Conexos por "Processar". Este relatório precisou
  > contá-las estaticamente lendo o código, o que não sobrevive à próxima refatoração. Sem
  > instrumentação, uma regressão de +3 chamadas ERP passa despercebida até o Conexos começar a
  > rejeitar por `LOGIN_ERROR_MAX_SESSIONS`.

- **Melhoria Proposta**
  > Adicionar um contador simples ao `LogService` (ou wrapper `ErpCallCounter` singleton por request)
  > que soma 1 a cada chamada de client Conexos dentro do span de `processarAlocacao`. Emitir um log
  > estruturado no final de `rodarEtapas`: `{ type: 'PERF_METRIC', txnId, priCod, erpCallsByEtapa,
  > wallClockMs }`. Tactic Bass: Bound Execution Times + Reduce Overhead (para poder atacar quando
  > medido). Tocar `src/backend/domain/service/LogService.ts` e o construtor do
  > `RecebimentoNumerarioService`.

- **Resultado Esperado**
  > Após o card: cada "Processar" grava no log a decomposição de chamadas por etapa. Baseline
  > passa a ser um dado (não um cálculo manual) e alertas podem ser configurados. Meta:
  > `erpCallsByEtapa.sn` na moda ≤ 12; alarme se p95 > 18.

- **Tactic alvo**: Bound Execution Times (só se mede o que se instrumenta)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-2, F-performance-3
- **Métricas de sucesso**:
  - contagem de chamadas ERP visível em prod por `etapa`: hoje N/A → após: campo `erpCallsByEtapa` presente em 100% dos logs de conclusão
  - regressões de +N chamadas detectáveis via consulta de log: hoje impossível → após: 1 grep resolve
- **Risco de não fazer**: próxima refatoração adiciona +2 chamadas ERP a cada "Processar", o
  time descobre quando os analistas relatam "Processar" travando (o poll de 5min já foi removido
  por esse mesmo motivo em sessão anterior — histórico repetível).
- **Dependências**: nenhuma.

### [performance-2] Considerar `try-then-remediate` para a condição de pagamento (deferir `listValidacoes` ao caminho de falha)

- **Problema**
  > `applyPaymentConditionIfRequired` chama `listValidacoes` INCONDICIONALMENTE no happy path
  > (`RecebimentoNumerarioService.ts:469`), custando 1 chamada ERP em 100% dos "Processar" — mesmo
  > quando a pessoa não exige condição sugestiva (o caso comum, incluindo todo o HML). O ganho é
  > modesto (1 chamada), mas o design "check-first" é uma escolha reversível.

- **Melhoria Proposta**
  > Estudar (não implementar cegamente) o padrão alternativo: chamar `finalizarDocumento` direto e,
  > SE devolver o erro específico "CONDIÇÃO DE PAGAMENTO ... SUGERIDA", só então rodar
  > `applyPaymentConditionIfRequired` + retry. Requer: (a) `ErpErrorInterpreter` reconhecer esse
  > erro específico de forma robusta; (b) garantir que `finalizarDocumento` é idempotente sob
  > retry (ou usar uma etapa própria no ledger `sn-recovery`). Tactic Bass: Increase Resource
  > Efficiency. Tocar `RecebimentoNumerarioService.ts:404-431, 451-519`,
  > `src/backend/domain/service/permutas/ErpErrorInterpreter.ts`.

- **Resultado Esperado**
  > Happy-path `completarSnAdiantamento`: 5 chamadas ERP → 4 chamadas (-20% nesse método). Path
  > bloqueante (raro): 9 → 10 (uma tentativa extra de finalização), aceito porque é raro.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — inclui análise de idempotência e testes com o Conexos HML)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - chamadas ERP no happy path de `completarSnAdiantamento`: 5 → 4
  - chamadas ERP no path bloqueante: 9 → 10 (aceitável — bloqueante é raro; ver `docs/e2e/gap-titulos-diagnostico.md`)
- **Risco de não fazer**: +1 chamada Conexos por "Processar" para sempre; incremento marginal na
  pressão de sessão (`MAX_SESSIONS=3`) sob picos concorrentes.
- **Dependências**: [performance-1] (sem contagem instrumentada, não dá para provar o ganho).

### [performance-3] Adicionar cronômetro wall-clock no orquestrador para expor perf real ao analista

- **Problema**
  > "Processar" é um request HTTP síncrono que hoje dispara ~30 chamadas ERP num happy-path full
  > (SN + fin014 + NDe + fiscal + obs + homologar + poll leve). O analista fica esperando. Sem
  > medição wall-clock, não temos base para debate "vale a pena tornar isso async?" — e a sessão
  > anterior já teve que remover um poll bloqueante de 5min justamente por essa dor.

- **Melhoria Proposta**
  > No mesmo hook do card [performance-1], acrescentar `wallClockMs` por etapa (`sn`, `fin014`,
  > `nde`, `fiscal`, `obs`, `homolog`, `poll`) usando `performance.now()`. Emitir no log final da
  > `rodarEtapas`. Tactic Bass: Bound Execution Times.

- **Resultado Esperado**
  > Após 1 semana em prod: sabemos p50/p95/p99 de "Processar" por etapa. Meta a definir DEPOIS
  > dos dados (não chutar agora). Se p95 > 30s, discutir mover `etapaPoll` para background job
  > (arquitetura, não perf tática).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤1d, junto do [performance-1])
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - `wallClockMs` por etapa visível em prod: hoje N/A → após: campo presente em 100% dos logs
  - p95 de "Processar": hoje desconhecido → após: quantificado, permitindo definir alvo real
- **Risco de não fazer**: repetir o padrão do poll de 5min — descobrir a dor de perf via reclamação
  do usuário, não via métrica.
- **Dependências**: alinha com [performance-1] (mesmo PR).

## 6. Notas do agente

- Escopo estrito: só o delta `fix/sn-titulo-condicao-fail-closed..fix/sn-cond-pgto-finalizacao`.
  Não avaliei cold start / bundle size / Terraform (não existem aqui; ver CLAUDE.md "Estado Atual").
- Métrica primária = **contagem estática de chamadas ao ERP**. Latência em ms é NÃO-MEDÍVEL sem
  produção instrumentada — recomendação séria no card [performance-1].
- **Cross-QA**:
  - **Availability / Fault-Tolerance**: o `try/catch` de `listValidacoes` (linhas 543-556) faz
    fallback silencioso para "não aplicar condição" — decisão de segurança que descarrega o gate
    para a finalização; qa-availability deve avaliar se o warning é observável o suficiente.
  - **Modifiability**: `stripAccents` (linhas 559-564) duplica `normalizarNomePessoa` (linhas
    691-697); F-performance-4 é sinal, não ação — qa-modifiability decide.
  - **Testability**: os 6 novos testes em `RecebimentoNumerarioService.test.ts` cobrem exatamente
    os paths de decisão do `applyPaymentConditionIfRequired`; qa-testability deve validar.
- Cognitive-complexity flag no `classificarAlocacao` é PRÉ-EXISTENTE (documentado em `_shared-metrics.md`),
  não regressão deste delta — não pontuado aqui.
