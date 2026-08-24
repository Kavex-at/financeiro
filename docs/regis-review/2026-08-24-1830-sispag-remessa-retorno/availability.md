---
qa: Availability
qa_slug: availability
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-availability
generated_at: 2026-08-24T18:30:00-03:00
scope: backend
score: 6
findings_count: 8
cards_count: 8
---

# Availability — Regis-Review

Escopo: **DELTA** da branch `fix/sispag-fin015-import-shape` (PR #60), frente SISPAG —
Fatia 3 (REMESSA `.REM` + CONCILIAÇÃO do RETORNO `.RET`). A frente introduz o PRIMEIRO
caminho de escrita não-idempotente do SISPAG (fin015 + fin052) diretamente sobre o ERP
Conexos, e o `ConciliacaoRetornoService` invoca `PUT arquivosRetorno/processar` que
GERA AS BAIXAS no fin010. A partir daqui, cada gap de disponibilidade tem risco
monetário direto (pagar duas vezes / baixar duas vezes).

O repositório não tem infra própria (deploy é Render; sem Terraform/tenants); tactics
tipicamente infra-as-code (spare region, active redundancy) são marcadas N/A abaixo.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário admin (dois cliques) ou Render restart durante escrita | `POST /sispag/lotes/:id/remessa` ou `POST /sispag/retornos/conciliar` disparado 2× para o mesmo lote/arquivo | Sequência fin015 (`criarLote` → `importarTitulos` → `finalizarLote` → `gerarRemessa`) + fin052 `processar` | Produção, `CONEXOS_WRITE_ENABLED=true` + `CONEXOS_DRY_RUN=false` | Sistema deve DETECTAR a duplicata, curto-circuitar em `settled`, FAIL-CLOSED em `reconciling` órfão, e propagar erro claro ao operador | 0% de lote de pagamento duplicado no fin015; 0% de baixa duplicada no fin010; execuções órfãs (`reconciling`) visíveis em <5min para triagem humana |
| Conexos ERP | Latência >40s, HTTP 5xx transitório, ou `LOGIN_ERROR_MAX_SESSIONS` no meio da sequência de 4 POSTs da remessa | `RemessaService.gerarRemessa` / `ConciliacaoRetornoService.conciliar` | Produção, sessão do usuário real (não robô) | Rollback lógico via ledger `remessa_execucao` + reaproveitamento do `flpCod` no próximo retry; conciliação não deve deixar linhas silenciosamente ignoradas | MTTR <15min para operador identificar o lote nativo órfão via ledger; 100% das linhas do `.RET` visíveis (pagos + rejeitados + não-reconhecidos) mesmo com falha parcial no `listDetalhe` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas não-idempotentes com ledger write-ahead (remessa) | 1/1 (`RemessaService` usa `remessa_execucao`) | 100% | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:120-165` + `src/backend/migrations/0049_sispag_remessa_retorno.sql:60-96` |
| Escritas não-idempotentes com ledger write-ahead (retorno / `processar`) | 0/1 (`ConciliacaoRetornoService` **não tem** ledger) | 100% | ❌ | `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:80-100` |
| Chamadas de escrita usando `postGenericOnce`/`postMultipartOnce` (bloqueia 401-retry silencioso) | 5/5 (`criarLote`, `importarTitulos`, `gerarRemessa`, `processarArquivoRetorno`, `carregarArquivoRetorno`) | 100% | ✅ | `grep -n "postGenericOnce\|postMultipartOnce\|putGenericOnce" src/backend/domain/client/ConexosSispag{Write,Retorno}Client.ts` |
| Leituras SISPAG passando por `runWithRetry` (retry 2×, 500ms + jitter 200ms) | 100% (32 ocorrências nos 3 clients) | 100% | ✅ | `grep -c runWithRetry src/backend/domain/client/ConexosSispag*.ts` → 8/14/10 |
| Timeout HTTP explícito no cliente Conexos | 40s (`axios.create({ timeout: 40000 })`) | 30–60s | ✅ | `src/backend/services/conexos.ts:116-122` |
| Rota de observabilidade para execuções `reconciling` órfãs (SISPAG) | Ausente (existe em `recebimentos.ts:662` para Numerário — nunca portada) | Presente + alarme | ❌ | `grep -n listByStatus src/backend/routes/sispag.ts` → 0 hits; `RemessaExecucaoRepository.listByStatus` existe em `repository/sispag/RemessaExecucaoRepository.ts:47-59` mas não é chamado |
| Health check valida dependência crítica (Conexos) | Não — `/health` devolve `{status:'ok'}` incondicional | Health inclui `ensureSid` probe (ou `/ready` separado) | ⚠️ | `src/backend/index.ts:76` |
| Circuit breaker para o ERP (fecha após N falhas consecutivas) | Ausente — só `RetryExecutor` (2×) e `heavyRouteLimiter` (10 req/min/IP) | Circuit breaker por dependência (Conexos) | ❌ | `grep -rn "circuit" src/backend/domain` → 0 hits |
| Silent catch em caminho de escrita/leitura consequente | 1 (`ConciliacaoRetornoService.ts:119` — `catch {}` engole TODO erro do `listDetalhe` por código de evento) | 0 (distinguir "código ausente" de "5xx/timeout") | ❌ | `sed -n '110,122p' src/backend/domain/service/sispag/ConciliacaoRetornoService.ts` |
| Fallback local do `.REM` (persistência do conteúdo) | Ausente — `baixarArquivo` sempre re-lê do ERP | Salvar `gabLngDados` na DB (ou S3) no `settle` | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:391-407` + coluna faltante em `migrations/0049_sispag_remessa_retorno.sql:20-25` |
| Kill switch granular por frente | Global (`CONEXOS_DRY_RUN` afeta Permutas, Recebimentos, SISPAG juntos) | Flag por frente (`SISPAG_DRY_RUN`) | ⚠️ | `render.yaml:52-56` + `_shared-metrics.md` (Contexto de risco) |
| Cobertura de teste concorrente (dois retornos simultâneos, mesmo `garCodSeq`) | 0 testes | ≥1 teste garantindo idempotência ou lock | ❌ | `grep -n "concorr\|paraleli\|Promise.all" src/backend/domain/service/sispag/ConciliacaoRetornoService.test.ts` → 0 hits |
| MTTR real de execução `reconciling` órfã em produção | Não medível localmente | <15min | ⚠️ | Requer log Render + query Supabase. Instrumentar: contador `sispag_remessa_execucao_reconciling{lote_id}` + alerta se `atualizado_em < now() - 10min` |
| Taxa de conclusão da remessa (settled / (settled+error)) últimos 30d | Não medível localmente | ≥95% | ⚠️ | Requer `SELECT status, count(*) FROM remessa_execucao GROUP BY status` em produção |

## 3. Tactics — Cobertura no delta SISPAG

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping / Echo | Nenhuma sonda `ping` para o Conexos. Health check é raso (retorna `ok` sempre) | ❌ ausente | `src/backend/index.ts:76` |
| Heartbeat | N/A — não há workers de longa duração no delta (jobs são one-shot) | N/A | — |
| Monitor | `LogService.info/warn/error` em todos os pontos de decisão do `RemessaService` e `ConciliacaoRetornoService`; `PagamentoIngestaoRunRepository` registra runs. Falta agregação/alerta e endpoint para `reconciling` | ⚠️ parcial | `RemessaService.ts:132,142,209,215,285,304`; `ConciliacaoRetornoService.ts:87,94,197` |
| Timestamp | Ledger `remessa_execucao` grava `criado_em`/`atualizado_em`; `native_flp_cod` persistido ANTES do próximo POST; `remessa_gerada_em` no `lote_pagamento` | ✅ presente | `migrations/0049_sispag_remessa_retorno.sql:20-24,70-96` |
| Sanity Checking | Guardas de estado (`LOTE_STATUS.FINALIZADO`, `itens.length===0`, filial do título = filial do lote), FEBRABAN por bncCod, arquivo por NOME (não índice), validação Zod no boundary do `criarLote` | ✅ presente | `RemessaService.ts:100-118,289-296,336-341`; `ConexosSispagWriteClient.ts:16-33` |
| Condition Monitoring | Nenhum dashboard/alerta para `remessa_execucao.status='reconciling' AND atualizado_em < now()-10min` | ❌ ausente | `RemessaExecucaoRepository.listByStatus` existe mas não é exposto — `routes/sispag.ts` não tem `/execucoes` |
| Voting | N/A — não há redundância comparável | N/A | — |
| Exception Detection | `ConexosError` embrulha `axios` com `describeConexosValidation` (extrai `VALIDATION_LIST`/`VALIDATION`); `ErpPerguntaError` reconhece `QUESTION`; `RemessaEmDuvidaError` para `reconciling` órfão. **Falho** no `ConciliacaoRetornoService.ts:119` (silent `catch {}`) | ⚠️ parcial | `ConexosSispagWriteClient.ts:70-97`; `ConciliacaoRetornoService.ts:117-121` |
| Self-Test | Preflight jobs (`preflight-fin015-prd.ts`, `probe-fin015-import.ts`) — só rodam sob demanda pelo dev, não integrados ao boot/CI | ⚠️ parcial | `src/backend/jobs/preflight-fin015-prd.ts`, `probe-fin015-import.ts` (do _shared-metrics.md) |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — Render Starter single-instance; ERP é único | N/A | `render.yaml:14` (plan: starter) |
| Passive Redundancy | N/A — sem stand-by | N/A | — |
| Spare | N/A — deploy Render sem multi-region | N/A | — |
| Exception Handling | `try/catch` em todo POST do `RemessaService`; `ledger.fail(key, mensagem)` grava a falha; `LoteEstadoInvalidoError`, `RemessaEmDuvidaError`, `ErpPerguntaError` mapeados para HTTP no `respondLoteError` | ✅ presente | `RemessaService.ts:310-321`; `routes/sispag.ts:77-88` |
| Rollback | **Sem rollback automático** de lote nativo órfão criado no fin015 quando `importarTitulos`/`finalizarLote` falha — só reuso opcional na próxima tentativa (comentário do `RemessaService.ts:222-232`); operador precisa cancelar manualmente | ⚠️ parcial | `RemessaService.ts:222-260` (reaproveitamento sim; DELETE do órfão não) |
| Software Upgrade | Render `autoDeploy: true` a partir de `main`, `preDeployCommand` roda migrações antes de trocar tráfego. Sem staged rollout | ⚠️ parcial | `render.yaml:14-25` |
| Retry | `RetryExecutor` 2× / 500ms + jitter em leituras (`runWithRetry`); escritas usam `postGenericOnce` (tentativa única) intencionalmente para não duplicar | ✅ presente | `ConexosBaseClient.ts:146-155`; `ConexosSispagWriteClient.ts:41-49` |
| Ignore Faulty Behavior | Silent `catch {}` no `listDetalhe` do `ConciliacaoRetornoService.ts:119` é `Ignore` **indiscriminado**: engole "código ausente neste arquivo" junto com 5xx/timeout | ❌ ausente (mal-implementado) | `ConciliacaoRetornoService.ts:110-121` |
| Degradation | `dryRun`/`writeEnabled` gate no `RemessaService.ts:181-206` e `ConciliacaoRetornoService.ts:81-97` permite modo preview sem tocar o ERP; kill switch `SISPAG_ENABLED`, `CONEXOS_WRITE_ENABLED` no Render | ✅ presente | `render.yaml:28-56` |
| Reconfiguration | Kill switches manuais no dashboard Render (sem redeploy). Sem reconfiguração automática | ⚠️ parcial | `render.yaml:37-56` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A — sem shadowing de tráfego (fora do padrão Render single-instance) | N/A | — |
| State Resynchronization | Ledger `remessa_execucao` grava `native_flp_cod`/`native_gab_cod` assim que o ERP devolve; `beginExecution` UPSERT preserva `settled`; **reaproveitamento** do lote nativo vazio no retry evita duplicata | ✅ presente | `RemessaExecucaoRepository.ts:60-104`; `RemessaService.ts:222-260` |
| Escalating Restart | Render reinicia container em falha do processo — sem escalation graduada | ⚠️ parcial | Comportamento default do Render |
| Non-Stop Forwarding | N/A — não há plano de controle separado | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | `heavyRouteLimiter` (10 req/min/IP) em `/lotes/:id/remessa` e `/retornos/conciliar`. **Não** protege contra o mesmo usuário disparar múltiplos itens em paralelo, nem contra fan-out interno do `conciliar` (N eventos × M páginas de `listDetalhe`) esgotar o pool de sessões do Conexos | ⚠️ parcial | `routes/sispag.ts:346,414`; `http/rateLimit.ts:28-36` |
| Transactions | `RemessaService` transiciona lote com `versaoEsperada` (optimistic lock) e checa `afetadas===0`. `remessa_execucao` UPSERT é atômico. **Falta**: `ConciliacaoRetornoService` faz `registrarConciliacaoItem` linha-a-linha SEM transação envolvendo o conjunto — falha no meio deixa lote parcialmente conciliado | ⚠️ parcial | `RemessaService.ts:288-296`; `ConciliacaoRetornoService.ts:155-166` |
| Predictive Model | Ausente — nenhum modelo prevê saturação do ERP ou probabilidade de falha | ❌ ausente | — |
| Exception Prevention | Zod na resposta do `criarLote`; sanity checks pré-POST (filial do título, conta pagadora, modalidade); mutex de login (`loginPromise`) e `conexosSessionStore` compartilhado evitam `LOGIN_ERROR_MAX_SESSIONS` | ✅ presente | `ConexosSispagWriteClient.ts:16-33`; `services/conexos.ts:100-108, 169-173` |
| Increase Competence Set | Client `describeConexosValidation` traduz 2 shapes de erro do Conexos em `userMessage` acionável; `RemessaEmDuvidaError.userMessage` orienta ("Confira no fin015 e cancele-o antes de tentar de novo") | ✅ presente | `RemessaEmDuvidaError.ts:23-27`; `ConexosSispagWriteClient.ts:52-77` |

## 4. Findings (achados)

### F-availability-1: `ConciliacaoRetornoService` **não tem** ledger write-ahead — `processar` pode ser executado 2× e duplicar baixas no fin010

- **Severidade**: P0
- **Tactic violada**: State Resynchronization + Transactions (Prevent Faults)
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:76-100`, `src/backend/routes/sispag.ts:410-437`
- **Evidência (objetiva)**:
  ```typescript
  // routes/sispag.ts:410-437 — POST /sispag/retornos/conciliar
  router.post('/retornos/conciliar', requireRole('admin'), heavyRouteLimiter,
      asyncHandler(async (req, res) => {
          // ... nenhum Idempotency-Key é lido nem repassado
          const result = await service.conciliar({...});
      }));

  // ConciliacaoRetornoService.ts:88-95
  if (input.processar) {
      if (dryRun) { ... }
      else {
          await this.retorno.processarArquivoRetorno(this.chave(input));  // <-- PUT irreversível
          processado = true;
          await this.logService.info({ message: 'retorno processado no ERP (baixas geradas no fin010)' });
      }
  }
  ```
  Comparar com `RemessaService.ts:120-165` que faz `ledger.beginExecution` → `findByIdempotencyKey` → curto-circuita em `settled` / FAIL-CLOSED em `reconciling`. O `ConciliacaoRetornoService` NÃO tem esse cinto.
- **Impacto técnico**: dois cliques no botão "Conciliar (processar)" ou um Render restart entre o `processarArquivoRetorno` e o `res.json()` chama `PUT arquivosRetorno/processar` DUAS VEZES. O client comment reconhece: "reprocessar gera novas baixas" (`ConexosSispagRetornoClient.ts:151-153`) e delega à atomicidade da transação do ERP — mas não previne duas invocações independentes.
- **Impacto de negócio**: DUPLICAÇÃO DE BAIXA no fin010. O fluxo contábil aceita a segunda como "outra" baixa (o ERP não deduplica por arquivo já processado no lado nosso), gerando estorno manual e potencial dupla comunicação ao fornecedor.
- **Métrica de baseline**: 0 registros em ledger dedicado (não existe tabela); 0 mecanismos de dedup por `garCodSeq` no HTTP layer; 0 testes de concorrência em `ConciliacaoRetornoService.test.ts`.

### F-availability-2: Silent `catch {}` no `listDetalhe` mascara timeouts do ERP durante conciliação

- **Severidade**: P0
- **Tactic violada**: Exception Detection + Ignore Faulty Behavior (aplicação indiscriminada)
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:109-121`
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
          for (const d of det) {
              linhas.push({ ...d, eventoDescricao: d.eventoDescricao ?? ev.descricao });
          }
      } catch {
          // código não presente neste arquivo — segue.
      }
  }
  ```
  O comentário assume que TODO erro = "código não existe neste arquivo". Mas `listDetalhe` chama `runWithRetry` → após 2 falhas 5xx / timeout / `LOGIN_ERROR_MAX_SESSIONS`, o erro **crítico** também é engolido — a conciliação prossegue com linhas FALTANDO e reporta `totalLinhas` menor do que a realidade.
- **Impacto técnico**: falha parcial do ERP em N códigos de evento (ex.: rejeições) simplesmente desaparece; `pagos` e `rejeitados` reportados ao operador são incompletos; `transicionarLote` marca lotes como `BAIXADO` sem ter visto todas as linhas.
- **Impacto de negócio**: pagamentos rejeitados pelo banco (evento código de erro) podem sumir do painel — o fornecedor liga cobrando enquanto o operador jura que "conciliou tudo".
- **Métrica de baseline**: 1 silent-catch em caminho de leitura consequente (0 aceitável em fluxo com efeito colateral em `transicionarLote`).

### F-availability-3: Sem endpoint/dashboard para detectar execuções `reconciling` órfãs — MTTR indeterminado

- **Severidade**: P1
- **Tactic violada**: Monitor + Condition Monitoring
- **Localização**: `src/backend/routes/sispag.ts` (toda a rota SISPAG); `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:47-59`
- **Evidência (objetiva)**:
  ```
  $ grep -n listByStatus src/backend/routes/sispag.ts
  # (nenhuma ocorrência)

  $ grep -n listByStatus src/backend/routes/recebimentos.ts
  662:    execucoes: await repo.listByStatus(parsed.data.status, parsed.data.limit ?? 50),
  ```
  O método existe (`RemessaExecucaoRepository.listByStatus`), Recebimentos já expõe a mesma coisa para `SolicitacaoNumerarioExecucao`, mas SISPAG não. Operador que caiu na FAIL-CLOSED `RemessaEmDuvidaError` só descobre o `native_flp_cod` órfão via SQL direto no Supabase.
- **Impacto técnico**: MTTR de execução `reconciling` órfã depende de o operador (a) receber o erro no browser, (b) copiar o `nativeFlpCod` da mensagem, (c) achar quem tem acesso ao Supabase, (d) fazer `SELECT * FROM remessa_execucao WHERE status='reconciling'`.
- **Impacto de negócio**: cada minuto de MTTR num `reconciling` órfão é um minuto em que o lote FICA TRAVADO (bloqueado pela trava anti-duplicação), atrasando pagamento a fornecedor.
- **Métrica de baseline**: 0 rotas de observabilidade SISPAG; MTTR real não medível localmente.

### F-availability-4: Health check `/health` não valida conectividade com Conexos — Render pode direcionar tráfego a instância cega

- **Severidade**: P1
- **Tactic violada**: Sanity Checking (probing de dependência)
- **Localização**: `src/backend/index.ts:76`, `render.yaml:22`
- **Evidência (objetiva)**:
  ```typescript
  // src/backend/index.ts:76
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: APP_VERSION }));
  ```
  ```yaml
  # render.yaml:22
  healthCheckPath: /health
  ```
  Nenhum probe a `ensureSid`, `getFilCodDefault`, ou ao pool do Supabase. Render considera saudável um container que perdeu credencial do Conexos.
- **Impacto técnico**: um container que caiu de `LOGIN_ERROR_MAX_SESSIONS` (session store envenenado) permanece "green" no Render; todas as requisições SISPAG dele falham até o TTL da sessão expirar.
- **Impacto de negócio**: durante um pico de erro do Conexos, o painel SISPAG fica intermitente sem que a plataforma tire o pod do rotation.
- **Métrica de baseline**: `/health` retorna 200 mesmo com Conexos 100% down (verificável rodando o backend sem `CONEXOS_USERNAME`).

### F-availability-5: Sem circuit breaker para o Conexos — retry cego durante degradação do ERP amplifica saturação

- **Severidade**: P1
- **Tactic violada**: Removal from Service (Prevent Faults)
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts:135-155`; `src/backend/services/conexos.ts:100-108`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "circuit" src/backend/domain src/backend/services
  # (nenhuma ocorrência)
  ```
  Fluxo do `conciliar` faz 1 leitura de configs + 1 leitura de eventos + **N** leituras de detalhe (uma por código de evento configurado no banco — Itaú tem ~30, Santander mais). Cada `listDetalhe` faz até 3 tentativas via `runWithRetry`. Em degradação parcial do Conexos, um único click no botão dispara até 90 chamadas — cada uma retentando por 40s → 60min de amplificação.
- **Impacto técnico**: pico de latência do Conexos vira uma cascata de retries que satura o pool de sessões (`LOGIN_ERROR_MAX_SESSIONS`) para todas as frentes (Permutas, Recebimentos, SISPAG) — falha correlacionada.
- **Impacto de negócio**: incidente no Conexos que duraria 2min vira paralisia do sistema inteiro por 15–30min enquanto as sessões cicladas expiram.
- **Métrica de baseline**: 0 circuit breakers; RetryExecutor com `retries: 2` (não modula por taxa de falha recente); `heavyRouteLimiter` só limita por IP, não por dependência externa.

### F-availability-6: Sem rollback automático do lote nativo órfão no fin015

- **Severidade**: P2
- **Tactic violada**: Rollback + Reintroduction (State Resynchronization deixa lixo)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:222-260, 310-321`
- **Evidência (objetiva)**: quando `importarTitulos` ou `finalizarLote` lança, o `catch` grava `ledger.fail(key, mensagem)` mas NÃO tenta cancelar o `flpCod` já criado no ERP. O comentário na linha 222-232 admite: "Sem isto, cada retry criava OUTRO lote no ERP" — resolvido para o caso do RETRY (reaproveita `flpCod`), mas se o operador desistir e não retentar, o lote nativo vazio fica indefinidamente no fin015. `ConexosSispagWriteClient` não expõe `deletarLote` / `cancelarLote`.
- **Impacto técnico**: acumulação de lotes nativos órfãos no fin015; comentário do próprio job `execute-fin015-prd.ts:337` já reconhece que órfãos de meses atrás confundem o operador ("me fez imprimir e CANCELAR o [lote errado]").
- **Impacto de negócio**: risco de gerar remessa do lote nativo errado (operador do ERP escolhe o "primeiro flpCod da lista"), levando a pagamento fora de escopo.
- **Métrica de baseline**: 0 chamadas de `cancelar/deletar` no fin015 no código; 1 lote órfão documentado em HML (flp 1 e flp 2, `RemessaService.ts:222-224`).

### F-availability-7: `dryRun` e `writeEnabled` são globais — impossível degradar só o SISPAG mantendo Recebimentos/Permutas escrevendo

- **Severidade**: P2
- **Tactic violada**: Degradation (Reconfiguration granular)
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.ts:167-168, 246-247`; `render.yaml:52-56`
- **Evidência (objetiva)**:
  ```typescript
  conexosWriteEnabled: this.readEnv('CONEXOS_WRITE_ENABLED') === 'true',
  conexosDryRun: this.readEnv('CONEXOS_DRY_RUN') !== 'false',
  ```
  Contexto do `_shared-metrics.md`: "`CONEXOS_DRY_RUN` é flag GLOBAL (Permutas e Recebimentos também) — não dá para isolar o SISPAG."
- **Impacto técnico**: se um bug for descoberto **apenas** no fluxo SISPAG após go-live, a mitigação (setar `CONEXOS_DRY_RUN=true`) suspende também escrita de Recebimentos e Permutas — que hoje já estão em produção.
- **Impacto de negócio**: incidente localizado em SISPAG vira um "kill switch nuclear" que trava fluxos financeiros não-afetados.
- **Métrica de baseline**: 1 flag global controlando 3 frentes; alvo: 1 flag por frente (`SISPAG_DRY_RUN`, `RECEBIMENTOS_DRY_RUN`, `PERMUTAS_DRY_RUN`).

### F-availability-8: `.REM` gerado não é persistido localmente — indisponível se o ERP cai depois da geração

- **Severidade**: P2
- **Tactic violada**: Ignore Faulty Behavior via cache local (dependência desnecessária no caminho de leitura)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:388-407`; `migrations/0049_sispag_remessa_retorno.sql:20-25` (colunas `remessa_arquivo`, `remessa_num` mas SEM `remessa_conteudo`)
- **Evidência (objetiva)**:
  ```typescript
  public baixarArquivo = async (loteId: string): Promise<...> => {
      const lote = await this.loteRepo.getLoteComItens(loteId);
      if (!lote?.nativeFlpCod || !lote.nativeBncCod || !lote.remessaArquivo) return null;
      const arquivos = await this.write.listarArquivosRemessa({...});  // <-- SEMPRE bate no ERP
      const arquivo = arquivos.find((a) => a.nomeArquivo === lote.remessaArquivo);
      if (!arquivo?.conteudo) return null;
      return { nomeArquivo: lote.remessaArquivo, conteudo: arquivo.conteudo };
  };
  ```
  A resposta do `gerarRemessa` no `RemessaService.ts:280-291` já traz `conteudo` — poderia ser persistido em coluna nova + retornado do banco na próxima leitura.
- **Impacto técnico**: se o Conexos cair depois de `settled`, o operador NÃO consegue baixar de novo o `.REM` para enviar ao banco (o arquivo existe no ERP mas está inacessível), atrasando a transmissão bancária.
- **Impacto de negócio**: janela de corte bancária perdida (SISPAG Itaú fecha ~16h) por causa de indisponibilidade do ERP num momento em que TODO O TRABALHO já foi feito.
- **Métrica de baseline**: 0% do `.REM` persistido localmente; 100% de re-download depende do ERP.

## 5. Cards Kanban

### [availability-1] Introduzir ledger write-ahead + Idempotency-Key na conciliação do retorno

- **Problema**
  > `POST /sispag/retornos/conciliar` com `processar: true` chama `PUT arquivosRetorno/processar` (irreversível — gera baixas no fin010) sem ledger e sem Idempotency-Key. Dois cliques ou um restart do Render entre o PUT e o `res.json()` disparam a chamada duas vezes; o ERP grava novas baixas em cima das antigas (duplicação monetária).

- **Melhoria Proposta**
  > Criar tabela `conciliacao_execucao` espelhando `remessa_execucao` (chave: `filCod+bncCod+gtbCodSeq+garCodSeq`, status `pending|reconciling|settled|error`). `ConciliacaoRetornoService.conciliar` faz `ledger.beginExecution` ANTES do `processarArquivoRetorno`; curto-circuita em `settled`; FAIL-CLOSED em `reconciling` órfão via `ConciliacaoEmDuvidaError` (HTTP 409). Rota lê `Idempotency-Key` do header (derivada de `garCodSeq` se ausente) igual ao `/lotes/:id/remessa`. Tactics: **Transactions + State Resynchronization + Exception Detection**.

- **Resultado Esperado**
  > 0% de baixa duplicada por reprocessamento acidental. Curto-circuito idempotente medível em logs (`type: BUSINESS_INFO, message: 'conciliação já processada — curto-circuito idempotente'`). Métrica: `duplicated_conciliacao_count`: N/A (não medido) → 0/mês instrumentado.

- **Tactic alvo**: Transactions (Prevent) + State Resynchronization (Reintroduction)
- **Severidade**: P0
- **Esforço estimado**: M (2–3d — migration nova + repositório + serviço + rota + teste)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Ledger `conciliacao_execucao`: inexistente → existe e é gravado antes de todo `processarArquivoRetorno`
  - Testes de concorrência (dois `conciliar` paralelos, mesmo `garCodSeq`): 0 → ≥1 verde
- **Risco de não fazer**: primeira vez que dois analistas clicarem "Conciliar" simultaneamente no mesmo `.RET`, o fin010 recebe baixas duplicadas — estorno manual + retrabalho fiscal.
- **Dependências**: nenhuma (padrão já estabelecido por `remessa_execucao`)

### [availability-2] Substituir `catch {}` cego por tratamento por tipo de erro no `listDetalhe`

- **Problema**
  > `ConciliacaoRetornoService.ts:119` engole TODO erro do `listDetalhe` com `catch { /* código não presente neste arquivo — segue */ }`. Timeout, 5xx transitório e `LOGIN_ERROR_MAX_SESSIONS` também são engolidos — a conciliação reporta "conciliado" com linhas faltantes; o `transicionarLote` marca lote como `BAIXADO` sem ter visto rejeições.

- **Melhoria Proposta**
  > Distinguir "código de evento ausente" (comportamento esperado — HTTP 200 com `rows: []` ou 404) de "falha do ERP" (5xx, timeout, `LOGIN_ERROR_*`). Só ignorar a primeira; propagar a segunda como `ConexosError` para o operador. `ConexosSispagRetornoClient.listDetalhe` já produz `ConexosError` no catch — o serviço só precisa filtrar `err.cause?.response?.status` ou re-lançar se não for 4xx esperado. Tactic: **Exception Detection**.

- **Resultado Esperado**
  > Conciliação nunca reporta sucesso silencioso quando o ERP degradou. Alertar operador com "Conciliação incompleta — retente em alguns minutos". Métrica: silent-catch em caminho de escrita/leitura consequente: 1 → 0.

- **Tactic alvo**: Exception Detection (Detect Faults)
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Silent-catch em `service/sispag`: 1 → 0
  - Cobertura de teste "falha 5xx do ERP no meio do loop": 0 → 1 caso verde
- **Risco de não fazer**: rejeição bancária não aparece no painel; fornecedor liga cobrando e a analista jura que o pagamento saiu.
- **Dependências**: nenhuma

### [availability-3] Expor `GET /sispag/execucoes?status=` para triagem de órfãos + alarme

- **Problema**
  > `RemessaExecucaoRepository.listByStatus` existe mas nenhuma rota o expõe. Quando o `RemessaEmDuvidaError` (HTTP 409, FAIL-CLOSED) dispara, o operador sabe o `nativeFlpCod`, mas ninguém tem visão agregada de "quantos órfãos existem hoje" — precisa SQL direto no Supabase.

- **Melhoria Proposta**
  > Adicionar `GET /sispag/execucoes?status=reconciling|error&limit=` (admin) espelhando `routes/recebimentos.ts:662`. Log de business-warn se `atualizado_em < now() - 10min` para uma execução `reconciling`. Idealmente: alerta no canal de operações (Sentry / Slack) quando a query retornar >0 por >15min. Tactics: **Monitor + Condition Monitoring**.

- **Resultado Esperado**
  > MTTR de execução `reconciling` órfã cai de "depende de o operador falar com quem tem acesso ao Supabase" para "operador abre o painel e vê a lista". Métrica: rotas de observabilidade SISPAG: 0 → 1.

- **Tactic alvo**: Monitor (Detect Faults)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Rota `GET /sispag/execucoes`: 404 → 200 com JSON
  - MTTR `reconciling` órfão: não medido → <15min (instrumentar com alerta)
- **Risco de não fazer**: primeiro incidente `reconciling` órfão em produção vira "quem tem senha do Supabase?" e o lote fica travado por horas.
- **Dependências**: [availability-1] pode reaproveitar o mesmo endpoint para `conciliacao_execucao`

### [availability-4] Health check profundo — probar Conexos e Postgres antes de servir tráfego

- **Problema**
  > `/health` retorna `{status:'ok'}` sem validar nada. Container com credencial do Conexos inválida continua "green" no Render — 100% das requisições SISPAG falham enquanto o pod permanece no rotation.

- **Melhoria Proposta**
  > Criar `GET /ready` que executa (a) `ping` no pool Postgres (`SELECT 1`) e (b) `ensureSid()` no `ConexosService` com timeout curto (2s). Manter `/health` raso (liveness). Configurar `render.yaml` para usar `/ready` como `healthCheckPath`. Tactic: **Sanity Checking**.

- **Resultado Esperado**
  > Instância cega para o Conexos é tirada do rotation em <1min. Métrica: tempo médio até rotation-out após perda de credencial: infinito → <60s.

- **Tactic alvo**: Sanity Checking (Detect Faults)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - `/ready` valida Postgres + Conexos: 0 → 2 dependências probadas
  - Container com Conexos down: permanece green → é despromovido pelo Render
- **Risco de não fazer**: incidente do Conexos vira degradação silenciosa; painel SISPAG intermitente.
- **Dependências**: nenhuma

### [availability-5] Circuit breaker por dependência (Conexos) para conter cascata durante degradação

- **Problema**
  > `conciliar` faz até N × 3 chamadas ao ERP (N códigos de evento × RetryExecutor). Durante um pico do Conexos, isso amplifica saturação e induz `LOGIN_ERROR_MAX_SESSIONS` em todas as frentes (Permutas, Recebimentos, SISPAG). Não há circuit breaker.

- **Melhoria Proposta**
  > Envolver o `ConexosBaseClient.runWithRetry` (ou o axios do `ConexosService`) num circuit breaker por dependência (ex.: `opossum`): abre após K falhas em janela de T segundos; enquanto aberto, curto-circuita com `ConexosCircuitOpenError` em vez de bater no ERP. Meia-abertura probando 1 chamada. Cobrir com métrica de estado (`circuit_state{dep="conexos"}`). Tactic: **Removal from Service (Prevent Faults)**.

- **Resultado Esperado**
  > Falha correlacionada não amplifica saturação. Métrica: número de sessões abertas no Conexos durante pico de erro do ERP: cresce até bater `MAX_SESSIONS` → estabiliza em <3.

- **Tactic alvo**: Removal from Service (Prevent Faults)
- **Severidade**: P1
- **Esforço estimado**: M (3–4d — biblioteca + instrumentação + teste)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Circuit breakers ativos: 0 → 1 (dep `conexos`)
  - Chamadas ao Conexos durante pico observado: N × M → limitado por breaker
- **Risco de não fazer**: incidente de 2min no Conexos degrada o sistema todo por 15–30min; operador experimenta 429/504 espúrios.
- **Dependências**: nenhuma

### [availability-6] Rollback automático do lote nativo órfão no fin015 quando `importarTitulos`/`finalizarLote` falha

- **Problema**
  > `RemessaService` cria `flpCod` no ERP, e se o próximo POST falha, o lote nativo vazio fica indefinidamente no fin015. Retry reaproveita — mas se o operador desistir, o órfão acumula. Já causou incidente em HML documentado no comentário do `RemessaService.ts:222-224`.

- **Melhoria Proposta**
  > Expor `cancelarLote(filCod, bncCod, flpCod)` no `ConexosSispagWriteClient` (endpoint do fin015 a mapear com o analista). No `catch` do `RemessaService.ts:310-321`, quando `flpCod !== undefined` E a falha for antes de `gerarRemessa`, tentar `cancelarLote` best-effort. Em caso de falha do cancel, gravar `etapa: 'cancelar_falhou'` no ledger para triagem manual. Tactic: **Rollback**.

- **Resultado Esperado**
  > Lotes nativos órfãos no fin015 tendem a zero. Métrica: quantidade de `flpCod` no fin015 sem contrapartida em `remessa_execucao` settled: não medido → 0.

- **Tactic alvo**: Rollback (Recover — Preparation & Repair)
- **Severidade**: P2
- **Esforço estimado**: M (2–4d — precisa validar endpoint de cancelamento com analista + HML)
- **Findings relacionados**: F-availability-6
- **Métricas de sucesso**:
  - Chamada `cancelarLote` no catch: 0 → 1 (best-effort)
  - Órfãos no fin015 antes/depois: não medido → medido e =0
- **Risco de não fazer**: acúmulo de lotes nativos vazios confunde operação do ERP; risco de cancelar/imprimir o errado (já aconteceu).
- **Dependências**: [availability-3] (visibilidade de órfãos ajuda a validar o rollback)

### [availability-7] Kill switch granular por frente (`SISPAG_DRY_RUN` independente)

- **Problema**
  > `CONEXOS_DRY_RUN` é global. Bug localizado no SISPAG obriga a suspender também Recebimentos e Permutas, que já estão em produção estável.

- **Melhoria Proposta**
  > No `EnvironmentProvider`, ler `SISPAG_DRY_RUN`, `RECEBIMENTOS_DRY_RUN`, `PERMUTAS_DRY_RUN` com fallback para o `CONEXOS_DRY_RUN` global. `RemessaService` e `ConciliacaoRetornoService` consultam `env.sispagDryRun`. Documentar no `render.yaml` como `sync: false`. Tactic: **Reconfiguration (granular)**.

- **Resultado Esperado**
  > Kill switch de emergência afeta apenas a frente com incidente. Métrica: número de frentes afetadas por 1 flip do kill switch: 3 → 1.

- **Tactic alvo**: Reconfiguration (Recover)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-7
- **Métricas de sucesso**:
  - Flags no `EnvironmentProvider`: 1 → 3 (uma por frente, com fallback global)
- **Risco de não fazer**: primeiro incidente que aparecer só no SISPAG causa parada colateral em Recebimentos/Permutas.
- **Dependências**: nenhuma

### [availability-8] Persistir conteúdo do `.REM` local — não depender do ERP no re-download

- **Problema**
  > `RemessaService.baixarArquivo` sempre lê do ERP. Conexos offline após `settled` = analista não consegue baixar o `.REM` para enviar ao banco, apesar de todo o trabalho já feito. Janela de corte bancária perdida.

- **Melhoria Proposta**
  > Adicionar coluna `remessa_conteudo TEXT` (ou `remessa_conteudo_bytea`) em `lote_pagamento` na próxima migration. `RemessaService.gerarRemessa` grava `arquivo.conteudo` no `setRemessaGerada`. `baixarArquivo` lê do banco; só bate no ERP se ausente (retro-compat com lotes anteriores). Tactic: **Cache local (Ignore Faulty Behavior aplicado a leitura)**.

- **Resultado Esperado**
  > `.REM` re-baixável 100% do tempo após `settled`, independente da disponibilidade do Conexos. Métrica: dependência do ERP no re-download: 100% → 0%.

- **Tactic alvo**: Degradation (leitura degrada elegantemente para cache local)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — migration + 2 linhas no serviço)
- **Findings relacionados**: F-availability-8
- **Métricas de sucesso**:
  - Origem do conteúdo no `baixarArquivo`: ERP → banco local (com fallback ERP)
  - Latência do endpoint `/lotes/:id/remessa/arquivo`: ~500ms (rede ERP) → <50ms (DB)
- **Risco de não fazer**: primeiro dia de indisponibilidade do Conexos entre 14h e 16h com remessa pronta = pagamento adiado um dia útil.
- **Dependências**: nova migration (~0050 ou próxima disponível)

## 6. Notas do agente

- Escopo restrito ao delta do PR #60; não avaliei disponibilidade de rotas antigas (Permutas/Recebimentos) exceto para comparação (`recebimentos.ts:662` é o padrão que o SISPAG deveria copiar em availability-3).
- Métricas de MTTR real e taxa de conclusão da remessa exigem produção; instrumentei recomendações no `## 2` mas não fabriquei números.
- Ponto forte objetivo do delta: o ledger `remessa_execucao` com reaproveitamento de `flpCod` é uma implementação exemplar de State Resynchronization para escrita não-idempotente — a lacuna real é o `ConciliacaoRetornoService` não ter o mesmo cinto.
- Cross-QA: [availability-1] e [availability-2] têm forte overlap com **fault-tolerance** (idempotência em caminhos de dinheiro) e **security** (audit trail); consolidator, considerar deduplicar cards ou marcar como conjuntos.
- Score 6/10: idempotência da REMESSA está madura, mas a perna de RETORNO herdou o padrão apenas parcialmente e há gaps de observabilidade que empurram MTTR para "depende de quem tem acesso ao SQL".
