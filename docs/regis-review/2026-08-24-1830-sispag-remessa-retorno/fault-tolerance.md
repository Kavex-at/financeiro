---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-fault-tolerance
generated_at: 2026-08-24T18:30:00-03:00
scope: backend
score: 6
findings_count: 9
cards_count: 9
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao SISPAG)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro (duplo-clique / retry após timeout de rede / re-load da aba) | Nova requisição para `POST /sispag/lotes/:id/remessa` enquanto a anterior está em voo ou pós-crash do processo | Sequência não-idempotente `criarLote → importarTitulos → finalizarLote → gerarRemessa` no fin015 + ledger `remessa_execucao` + `lote_pagamento` | Produção com `CONEXOS_WRITE_ENABLED=true` e `CONEXOS_DRY_RUN=false`; ledger em Postgres compartilhado; sessão do ERP atribuída a pessoa real | Curto-circuito idempotente quando `settled`; fail-closed (`RemessaEmDuvidaError` HTTP 409) quando `reconciling` órfão; reaproveitamento do `native_flp_cod` quando `error/pending` com flpCod persistido; nenhum caminho pode gerar um segundo lote nativo | 0 lotes duplicados no fin015 · 0 pagamentos em duplicidade no banco · 100% das execuções `reconciling` visíveis via `listByStatus('reconciling')` · MTTR humano < 30 min |

Cenário derivado do incidente real reproduzido em HML: uma falha comum em `importarTitulos` marcou o ledger como `error`; como `error` não bloqueia, o retry recomeçou de `criarLote` e criou um segundo lote no ERP (flp 1 e flp 2 órfãos). A correção foi reaproveitar `nativeFlpCod` da tentativa anterior — este QA existe para atestar se a correção realmente fecha a janela.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas SISPAG no ERP não-idempotentes cobertas por ledger write-ahead com fail-closed | 4/6 (`criarLote`, `importarTitulos`, `finalizarLote`, `gerarRemessa`) | 6/6 (falta `processarArquivoRetorno` + `carregarArquivoRetorno`) | ❌ | `src/backend/domain/service/sispag/RemessaService.ts:110-350` vs `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:83-92` |
| Rotas mutatórias com aceitação de `Idempotency-Key` (header) e chave estável derivada | 1/2 (`POST /sispag/lotes/:id/remessa` — chave `remessa:{loteId}`); `POST /sispag/retornos/conciliar` ignora | 2/2 | ⚠️ | `src/backend/routes/sispag.ts:412-421, 442-473` |
| `updateNfStatus` equivalente para SISPAG (`transicionarStatus` do lote) sempre com optimistic lock por versão | Sim — `versao = versaoEsperada AND status = ANY($de)` | Sim | ✅ | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts:428-458` |
| Multi-write local (registrar N itens + transicionar lote) envolto em `withTransaction` | Não — `ConciliacaoRetornoService.conciliar` faz N `registrarConciliacaoItem` + `transicionarLote` em sequência solta | Sim | ❌ | `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:163-186` |
| Reaper/cron de execuções em `reconciling` (surface para operador) | Ausente — `RemessaExecucaoRepository.listByStatus` existe mas nenhum job/rota o chama | Presente (alerta em N min) | ❌ | `grep -rn "listByStatus" src/backend` |
| Reconciliação periódica `.RET → lote` disparada pela aplicação | Ausente — só manual pela UI ou por script `jobs/processar-ret-fin052.ts` | Cron ao menos diário por filial | ❌ | `src/backend/routes/sispag.ts:442`; `src/backend/jobs/processar-ret-fin052.ts` |
| Timeout em cliente Conexos | 40 000 ms (`axios.create({ timeout: 40000 })`) | ≤ 60 s, presente | ✅ | `src/backend/services/conexos.ts:116-121` |
| Rate limit em rotas pesadas (proteção contra flood de retry humano) | 10 req/min/IP em `/sispag/lotes/:id/remessa` e `/sispag/retornos/conciliar` | Presente | ✅ | `src/backend/http/rateLimit.ts:28-35`; `src/backend/routes/sispag.ts:411, 445` |
| Compensação para rascunho órfão no fin015 (falha após `criarLote`, antes ou durante `importarTitulos`) | Ausente — API do ERP não deleta rascunho, só CANCELA finalizado; código apenas REAPROVEITA o rascunho na próxima tentativa do MESMO `lote_id` | Documentada como forward-recovery com runbook | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:227-243`; `src/backend/jobs/cleanup-fin015-testes.ts` (só HML) |
| Ledger persiste `nativeFlpCod` ANTES do próximo POST ao ERP | Sim (`setNativeFlpCod` imediatamente após `criarLote` retornar) | Sim | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:236-239` |
| Chave de idempotência do ledger é UNIQUE em Postgres e `beginExecution` preserva `settled` em ON CONFLICT | Sim (`UNIQUE (idempotency_key)` + `CASE WHEN status='settled' THEN preserve ELSE update END`) | Sim | ✅ | `src/backend/migrations/0049_sispag_remessa_retorno.sql:86-95`; `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:63-101` |
| `CONEXOS_DRY_RUN` isolado por frente (SISPAG / Permutas / Recebimentos) | Não — flag global; precedente `snLiveWriteEnabled` só cobre outra frente | Um kill-switch por frente escrita | ❌ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:167-168, 246-247`; `src/backend/domain/libs/environment/model/EnvironmentVars.ts:86-101` |
| Cobertura de teste de retry / crash-recovery em `RemessaService` | 21 casos, incluindo `settled` curto-circuita, `reconciling` fail-closed, reaproveita `flpCod`, `error` sem flpCod cria novo | Cobertura dos 4 pontos de morte na sequência (após `criarLote`, após `importarTitulos`, após `finalizarLote`, após `gerarRemessa`) | ⚠️ | `src/backend/domain/service/sispag/RemessaService.test.ts` — a morte ENTRE `criarLote` e `setNativeFlpCod` (janela P0) não é exercitada |

⚠️ **Não medíveis localmente**:
- Número real de execuções `reconciling` órfãs em produção — requer query Supabase (`SELECT count(*) FROM remessa_execucao WHERE status='reconciling' AND atualizado_em < now() - interval '30 min'`) ou dashboard.
- Latência do primeiro POST ao ERP em janelas de instabilidade — requer Prometheus/CloudWatch. Recomendação: instrumentar histograma por etapa (`criar_lote`, `importar`, `finalizar`, `gerar_remessa`) e alertar em `reconciling` older-than-N.

## 3. Tactics — Cobertura no SISPAG

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — não há redundância ativa/passiva de ERP; Conexos é fonte única | N/A | — |
| Replacement | N/A | N/A | — |
| Predictive Model | Preflight `preflight-fin015-prd.ts` roda checagens antes da ação real (conta pagadora existe no fin005, título ainda elegível, favorecido tem conta no banco alvo) | ✅ presente | `src/backend/jobs/preflight-fin015-prd.ts`; guardas replicadas em `RemessaService.montarItensImport` |
| Increase Competence Set | `ErpPerguntaError` reconhece `{type:'QUESTION'}` do ERP como sinal a tratar explicitamente em vez de virar 500 opaco; Zod desembrulha `.data` no boundary do `criarLote` | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:200-217`; `LOTE_CRIADO_SCHEMA` |
| Sanity Checking | Zod no boundary do `criarLote` (`LOTE_CRIADO_SCHEMA` exige `flpCod` > 0); guarda "arquivo pelo NOME, nunca o primeiro com conteúdo" em `RemessaService` (contra reciclagem de `flpCod` pelo ERP); recusa cross-filial no import | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:14-27`; `src/backend/domain/service/sispag/RemessaService.ts:274-287, 397-410` |
| Comparison | Ausente para retorno: nenhum job compara `remessa_execucao.settled` contra o que o ERP diz existir; ausente para conciliação: nenhum job compara `finItemSispag` do ERP com `lote_pagamento_item` local | ❌ ausente | `grep -rn "compareErpVsLocal\|reconcile" src/backend/domain/service/sispag/` retorna vazio |
| Timestamp | `criado_em`/`atualizado_em`/`remessa_gerada_em`/`conciliado_em` presentes; `etapa` marca o passo alcançado | ✅ presente | `src/backend/migrations/0049_sispag_remessa_retorno.sql:79-83` |
| Timeout | 40 s no `axios.create` do Conexos (herdado pelo `ConexosSispagWriteClient` via `ConexosBaseClient` → `conexosService`) | ✅ presente | `src/backend/services/conexos.ts:116-121` |
| Condition Monitoring | Parcial — `LogService.info/warn/error` grava telemetria de cada etapa; nenhum contador/gauge exposto | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.ts:293-303, 336-354` |
| Self-Test | Jobs `probe-*` e `validate-*` são self-tests do ERP em HML — não rodam em prd | ⚠️ parcial | `src/backend/jobs/probe-fin052-hml.ts`, `validate-fin015-remessa.ts` |
| Voting | N/A | N/A | — |
| Redundancy | N/A — sem réplica de escrita | N/A | — |
| Recovery — Forward (Rollback) | Não aplicável ao ERP (não há rollback de `criarLote`/`importarTitulos`); no lado local há `transicionarStatus` reversível | ⚠️ parcial | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts:428` |
| Recovery — Backward (Retry) | Retries LEITURA via `runWithRetry`; escritas SISPAG NUNCA reintentadas cegamente (`postGenericOnce`/`postMultipartOnce`) — política correta para não-idempotência | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:44-46, 116-140`; `ConexosSispagRetornoClient.ts:32-36` |
| Reintroduction — Shadow / State Resync / Escalating Restart | N/A — sem shadow env; state resync se limita ao reaproveitamento de `flpCod` numa mesma chave idempotente | N/A | — |
| Rollback | Local: `transicionarStatus` de/para. ERP: inexistente para as escritas do fin015 sem cancelamento manual | ⚠️ parcial | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts:428-458` |
| Repair State | `setChavesNativas`, `setRemessaGerada`, `registrarConciliacaoItem` reparam o lote local após confirmação do ERP | ✅ presente | `LotePagamentoRepository.ts:463-560` |
| Idempotent Replay | `gerarRemessa` só — via ledger `remessa_execucao` com `UNIQUE(idempotency_key)` + `ON CONFLICT` que preserva `settled` | ⚠️ parcial | `remessa_execucao` cobre remessa; `processarArquivoRetorno` e `conciliar` não têm ledger equivalente |
| Compensating Transaction | Ausente para rascunho órfão no fin015 (API do ERP não expõe DELETE de rascunho); ausente para dedupe de `processarArquivoRetorno` duplicado | ❌ ausente | `src/backend/jobs/cleanup-fin015-testes.ts` só roda em HML e é manual |
| Reconcile | Ausente da aplicação — `jobs/processar-ret-fin052.ts` existe mas é execução manual/ad hoc; sem cron | ❌ ausente | `src/backend/jobs/processar-ret-fin052.ts`; nenhum caller agendado |
| Quarantine | Fail-closed via `RemessaEmDuvidaError` (HTTP 409) é a forma de quarentena — nunca re-POSTa uma execução `reconciling`; `RETORNADO` (vs `BAIXADO`) quando há rejeição, exigindo tratamento humano | ✅ presente | `src/backend/domain/errors/RemessaEmDuvidaError.ts`; `ConciliacaoRetornoService.ts:213-224` |

## 4. Findings (achados)

### F-fault-tolerance-1: `processarArquivoRetorno` chama escrita não-idempotente do ERP SEM ledger

- **Severidade**: P0
- **Tactic violada**: Idempotent Replay + Quarantine
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:83-93` chamando `src/backend/domain/client/ConexosSispagRetornoClient.ts:150-170`
- **Evidência (objetiva)**:
  ```typescript
  // ConciliacaoRetornoService.conciliar
  if (input.processar) {
      if (dryRun) { /* log */ }
      else {
          await this.retorno.processarArquivoRetorno(this.chave(input));
          processado = true;
          // ← nenhuma consulta a ledger antes; nenhum registro depois
      }
  }
  ```
  Comentário do próprio client (`ConexosSispagRetornoClient.ts:145-149`):
  > "NÃO é idempotente do ponto de vista de negócio (reprocessar gera novas baixas), mas o ERP se defende: a transação é ATÔMICA — provado em HML, uma falha na etapa do borderô não deixou nada gravado. Ainda assim: `postGenericOnce`, tentativa única."
- **Impacto técnico**: dois cliques em "Processar e conciliar" no mesmo `garCodSeq` disparam DOIS parses do `.RET` no ERP, cada um gerando um conjunto de baixas em fin010. A atomicidade PER-CHAMADA garante que cada chamada é all-or-nothing; ela NÃO impede que duas chamadas sucessivas dobrem as baixas. O dinheiro já saiu (a remessa foi enviada ao banco), então não é pagamento duplicado — é duplicação de LANÇAMENTO CONTÁBIL. Efeito colateral em qualquer relatório fin010 e no conciliador do banco.
- **Impacto de negócio**: divergência contábil silenciosa entre fin010 e extrato bancário; retrabalho manual do financeiro para estornar baixas duplicadas; auditoria acha lançamentos sem origem clara.
- **Métrica de baseline**: 0/1 rotas de conciliação com Idempotency-Key aceito; 0/1 chamadas `processarArquivoRetorno` cobertas por ledger; alvo 1/1.

### F-fault-tolerance-2: janela de duplicação entre `criarLote` (ERP) e `setNativeFlpCod` (ledger)

- **Severidade**: P0
- **Tactic violada**: Idempotent Replay (write-ahead ordering)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:227-243`
- **Evidência (objetiva)**:
  ```typescript
  const criado = await this.write.criarLote({ /* … */ });   // ← ERP write A
  flpCod = criado.flpCod;                                    //   flpCod só em memória
  }
  await this.ledger.setNativeFlpCod(key, flpCod);            // ← ledger persist B
  ```
  Entre A e B a instância pode morrer (SIGKILL, OOM, deploy rolling da Render, reboot). O ledger fica em `reconciling` com `native_flp_cod=NULL`; o ERP tem um rascunho fin015 recém-criado. Na próxima tentativa `findByIdempotencyKey` devolve `{status: 'reconciling', nativeFlpCod: undefined}` → `RemessaEmDuvidaError` (fail-closed, correto). Mas o operador que vai atender o 409 NÃO tem o `flpCod` para achar o rascunho: o `userMessage` do `RemessaEmDuvidaError` só cita o flp quando `params.nativeFlpCod` é truthy (`src/backend/domain/errors/RemessaEmDuvidaError.ts:26-28`). O órfão fica invisível.
- **Impacto técnico**: rascunho fin015 sem trilha do lado da aplicação. Fail-closed protege contra segundo pagamento, mas cria débito operacional invisível. Repetido em incidente comum, acumula rascunhos que precisariam de varredura manual do fin015 por filial/banco/período.
- **Impacto de negócio**: retrabalho de conciliação operacional; possibilidade de que um operador, sem ver a trilha, force-libere o `reconciling` (via SQL ad hoc) e crie o segundo lote assim mesmo.
- **Métrica de baseline**: janela P50 estimada = latência do POST `criarLote` (≈ centenas de ms com timeout 40 s), suficientemente longa para SIGKILL cair dentro dela em qualquer rolling deploy. Alvo: 0 rascunhos órfãos "sem trilha" por deploy.

### F-fault-tolerance-3: reaproveitamento de `nativeFlpCod` com ledger `error` pode re-importar sobre lote nativo que já tem itens

- **Severidade**: P1
- **Tactic violada**: Idempotent Replay (assunção de rollback do lado do ERP)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:227-263`
- **Evidência (objetiva)**:
  ```typescript
  let flpCod: number | undefined = anterior?.nativeFlpCod;
  if (flpCod !== undefined) { /* reaproveita */ }
  else { /* criarLote */ }
  /* … */
  await this.write.importarTitulos({ filCod: lote.filCod, bncCod, flpCod, itens });
  ```
  O reaproveitamento assume que "o lote nativo vazio é reaproveitável com segurança: ele só ganha itens no passo seguinte, e a falha anterior aconteceu ANTES de qualquer import" (comentário L227-232). Contra-exemplo: `importarTitulos` sucede mas o processo morre entre a resposta e `setEtapa('finalizar')` (L256). Ledger fica `reconciling` com `etapa='importar'` → fail-closed (bloqueia retry pela UI, ok). MAS: se um operador flipar manualmente o ledger para `error` sem cancelar o lote nativo no ERP, a próxima tentativa reusa o `flpCod` e chama `importarTitulos` de novo — com os mesmos itens. O ERP responde com `SELECTION_ERROR` ou duplica os itens (comportamento não documentado; NÃO testado ao vivo neste cenário).
- **Impacto técnico**: assunção implícita de que o único caminho para chegar aqui com `flpCod` preenchido é "criei o lote e falhei antes do import". A trava real que sustenta isso é o fail-closed do `reconciling` — se ele for contornado (SQL ad hoc, script de reparo), a garantia cai.
- **Impacto de negócio**: baixo risco em regime normal (fail-closed pega tudo); alto risco em regime de emergência ("preciso destravar esse lote") onde o SQL ad hoc é a rotina.
- **Métrica de baseline**: 0 testes cobrem "reaproveitar flpCod com etapa='importar' já concluída". Alvo: teste específico + runbook proibindo flip manual para `error`.

### F-fault-tolerance-4: `ConciliacaoRetornoService` não envolve `registrarConciliacaoItem` + `transicionarLote` em transação

- **Severidade**: P1
- **Tactic violada**: Rollback (atomicidade de multi-write local)
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:163-186`
- **Evidência (objetiva)**:
  ```typescript
  for (const l of linhas) {
      /* … */
      if (!dryRun) {
          await this.loteRepo.registrarConciliacaoItem({ /* … */ });
      }
      lotesAfetados.add(loteId);
  }
  if (!dryRun) {
      for (const loteId of lotesAfetados) { await this.transicionarLote(loteId); }
  }
  ```
  Nenhum `withTransaction`. `LotePagamentoRepository` foi construído para aceitar `TransactionClient` opcional (Rule #5), mas o serviço não usa. Se o processo morrer no meio, temos itens conciliados com o lote ainda em `REMESSA_GERADA`. Um retry via UI vai reprocessar o mesmo `.RET` (não bloqueado por idempotência — ver F-fault-tolerance-1), sobrescrever os itens (`registrarConciliacaoItem` é UPDATE) e tentar transicionar de novo — em geral funciona, mas: o `processarArquivoRetorno` já foi chamado; se o operador incluir `processar=true` no retry, dobra as baixas (F-1).
- **Impacto técnico**: estado local pode ficar em pé com N/M itens conciliados e lote não transicionado. Sem alerta que sinalize "há lote em `REMESSA_GERADA` com itens `conciliado_em` recentes mas sem transição".
- **Impacto de negócio**: painel SISPAG mostra lote como "aguardando retorno" quando na verdade o retorno já veio parcialmente conciliado; risco de ação humana redundante.
- **Métrica de baseline**: 0/N mutações atômicas em `ConciliacaoRetornoService`. Alvo: 1 transação por `garCodSeq` conciliado.

### F-fault-tolerance-5: ausência de reaper para execuções `reconciling` (SLO invisível)

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring + Quarantine (surfacing)
- **Localização**: `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:46-56` (`listByStatus` existe mas ninguém consome); nenhuma entrada em `src/backend/jobs/`
- **Evidência (objetiva)**: `grep -rn "listByStatus\('reconciling'\|listByStatus\(\"reconciling" src/backend` → só o próprio método. Nenhum cron, nenhum endpoint de painel, nenhum alerta.
- **Impacto técnico**: uma execução `reconciling` presa por dias fica invisível até o próximo operador tentar gerar remessa do mesmo lote e receber 409 — que ele pode até tratar como "esse lote já foi feito" e ignorar.
- **Impacto de negócio**: rascunho órfão no ERP acumula silenciosamente; conciliação bancária diverge sem trigger claro; ninguém sabe que existe débito operacional para tratar até auditoria.
- **Métrica de baseline**: 0 alertas configurados. Alvo: cron 15-min consultando `listByStatus('reconciling', 100)` com `atualizado_em < now() - interval '15 min'`, publicando em log estruturado / dashboard.

### F-fault-tolerance-6: sem cron de conciliação `.RET`, apenas caminho manual pela UI

- **Severidade**: P1
- **Tactic violada**: Reconcile
- **Localização**: `src/backend/routes/sispag.ts:442-473`; nenhum agendador
- **Evidência (objetiva)**: `POST /sispag/retornos/conciliar` só é acionado pelo botão "Processar e conciliar" da UI (`src/frontend/app/sispag/page.tsx:355-395`). O job `processar-ret-fin052.ts` existe como executável avulso, sem scheduler. Contexto explícito do escopo: "A conciliação NUNCA rodou pelo caminho da aplicação; só por script."
- **Impacto técnico**: se ninguém abrir a tela e clicar, um `.RET` fica indefinidamente sem virar baixa no fin010 nem transição para `BAIXADO/RETORNADO` local. O único monitoramento é o operador conferir manualmente.
- **Impacto de negócio**: SLO de "todo pagamento retornado é conciliado em D+1" não é assegurável hoje; conciliação atrasa se o financeiro estiver fora.
- **Métrica de baseline**: 0 execuções automáticas por dia. Alvo: cron por filial/banco/`gtbCodSeq` ao menos 2×/dia com dry-run + alerta em rejeição.

### F-fault-tolerance-7: `CONEXOS_DRY_RUN` global impede kill-switch por frente

- **Severidade**: P1
- **Tactic violada**: Fault Containment (blast radius)
- **Localização**: `src/backend/domain/libs/environment/EnvironmentProvider.ts:167-168, 246-247`; `src/backend/domain/libs/environment/model/EnvironmentVars.ts:86-101`
- **Evidência (objetiva)**: `conexosDryRun` é lida por SISPAG, Permutas e Recebimentos indistintamente. Precedente `snLiveWriteEnabled` (`SN_LIVE_WRITE_ENABLED`) mostra que o padrão já foi aplicado a uma frente específica.
- **Impacto técnico**: se aparecer um bug de duplicação exclusivamente no SISPAG, a única forma de desligar a escrita é setar `CONEXOS_DRY_RUN=true` — o que congela também Permutas e Recebimentos. Não existe forma cirúrgica de conter o incidente.
- **Impacto de negócio**: incidente pequeno vira parada operacional grande porque o botão de emergência é global. Tempo de decisão para desligar é maior porque o custo colateral é maior.
- **Métrica de baseline**: 1 flag global × 3 frentes de escrita. Alvo: 1 flag por frente (`SISPAG_LIVE_WRITE_ENABLED`, `PERMUTAS_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_LIVE_WRITE_ENABLED`) com o global mantido como override defensivo.

### F-fault-tolerance-8: rascunho fin015 não tem compensação — resíduo permanente

- **Severidade**: P2
- **Tactic violada**: Compensating Transaction
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:227-243`; `src/backend/jobs/cleanup-fin015-testes.ts:23-26` (recusa rodar fora de HML)
- **Evidência (objetiva)**: API do ERP só expõe `cancelarLote` para lote FINALIZADO; rascunho não pode ser removido nem via API nem via UI padrão. Quando `importarTitulos` falha por título inelegível, o rascunho vazio fica atribuído à pessoa real do operador (não a um robô). Reaproveitamento pela mesma `idempotency_key` mitiga se o operador retomar o MESMO lote local; se ele cancelar o lote local e criar outro, o rascunho fica órfão. O `cleanup-fin015-testes.ts` é o único caminho — e recusa rodar fora de HML de propósito.
- **Impacto técnico**: acúmulo lento e determinístico de rascunhos por operador no fin015. A base natural cresce até virar problema operacional.
- **Impacto de negócio**: fin015 poluído com lotes fantasmas atribuídos à pessoa real; auditoria interpreta como tentativa "escondida" de pagamento.
- **Métrica de baseline**: N rascunhos por operador por semana (não medido). Alvo: relatório semanal do painel listando rascunhos fin015 sem `remessa_execucao.settled` correspondente.

### F-fault-tolerance-9: `POST /sispag/retornos/conciliar` não honra `Idempotency-Key`

- **Severidade**: P2
- **Tactic violada**: Idempotent Replay
- **Localização**: `src/backend/routes/sispag.ts:442-473`
- **Evidência (objetiva)**: a rota `/lotes/:id/remessa` lê `req.header('Idempotency-Key')` e cai no ledger; `/retornos/conciliar` não lê o header e não tem ledger equivalente. Combinado com F-1, um duplo-clique de "Processar e conciliar" resulta em duas execuções completas.
- **Impacto técnico**: perde a barreira de idempotência HTTP-level que já existe do lado do frontend (o frontend não envia o header hoje, mas mesmo se enviasse a rota ignoraria).
- **Impacto de negócio**: acopla à F-1 — a mitigação passa por adicionar ledger + honrar header ao mesmo tempo.
- **Métrica de baseline**: 1/2 rotas mutatórias com Idempotency-Key ativo. Alvo: 2/2.

## 5. Cards Kanban

### [fault-tolerance-1] Blindar `processarArquivoRetorno` com ledger write-ahead e Idempotency-Key

- **Problema**
  > `POST /sispag/retornos/conciliar` com `processar=true` chama `processarArquivoRetorno` no ERP sem nenhum ledger e sem honrar `Idempotency-Key`. Dois cliques (ou um retry após timeout) disparam DOIS parses do `.RET`, gerando baixas duplicadas em fin010. A atomicidade per-call do ERP não impede duplicação entre calls. Já registrado como não-idempotente no comentário do próprio client.

- **Melhoria Proposta**
  > Criar `conciliacao_execucao` (espelho de `remessa_execucao`) chaveado por `(filCod, bncCod, gtbCodSeq, garCodSeq)` + `idempotency_key`. `beginExecution` write-ahead antes de `processarArquivoRetorno`; `settled` curto-circuita; `reconciling` órfão vira `ConciliacaoEmDuvidaError` (HTTP 409). Rota passa a ler `Idempotency-Key` com default derivado (`conciliar:{fil}:{bnc}:{gtb}:{gar}:{processar}`). Frontend passa a enviar o header explicitamente no botão "Processar e conciliar".

- **Resultado Esperado**
  > Duplo-clique de "Processar e conciliar" nunca dobra baixas no fin010. Retry após timeout de rede é seguro. Métrica: `# baixas fin010 duplicadas por garCodSeq processado`: >0 possível hoje → 0.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P0
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-9
- **Métricas de sucesso**:
  - Rotas mutatórias com Idempotency-Key aceito: 1/2 → 2/2
  - Escritas SISPAG não-idempotentes cobertas por ledger: 4/6 → 6/6
- **Risco de não fazer**: divergência contábil silenciosa entre fin010 e extrato bancário; retrabalho crescente do financeiro; auditoria começa a achar lançamentos dobrados sem trilha
- **Dependências**: nenhuma

### [fault-tolerance-2] Persistir `nativeFlpCod` no ledger ANTES do `criarLote` retornar (ou pelo menos incluir contexto no fail-closed)

- **Problema**
  > Existe uma janela entre `criarLote` (ERP) sucedendo e `setNativeFlpCod` (ledger) persistindo. Se o processo morre nessa janela (SIGKILL, deploy rolling da Render, OOM), o rascunho fin015 fica ORFÃO SEM TRILHA. Fail-closed protege contra segundo lote (bom), mas o operador que atende o 409 não tem o `flpCod` para achar e cancelar o órfão — o `RemessaEmDuvidaError.userMessage` só cita o flp quando o ledger tem `nativeFlpCod` preenchido, o que por definição não é o caso aqui.

- **Melhoria Proposta**
  > (a) Enriquecer `RemessaEmDuvidaError` com o `filCod`+`bncCod`+`idempotency_key` sempre que `nativeFlpCod` for null, e escrever runbook curto no `userMessage` ("Varra `fin015/rascunhos/list` filtrando `filCod=X bncCod=Y flpVldStatus=0` desde `criado_em` do ledger"). (b) Reordenar: gravar um marcador `ledger.setEtapa('criar_lote_em_voo', now())` imediatamente antes do POST, e cronjob de reaper procurar por `reconciling + etapa='criar_lote_em_voo'` mais velho que N min — publica lista de flpCods candidatos comparando a Postgres. (c) Adicionar teste `it('morte entre criarLote e setNativeFlpCod é fail-closed E deixa pistas para achar o órfão')`.

- **Resultado Esperado**
  > Toda janela de morte na sequência de remessa deixa trilha ACIONÁVEL. Operador que recebe 409 sabe exatamente qual query rodar no ERP.

- **Tactic alvo**: Idempotent Replay (write-ahead)
- **Severidade**: P0
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-5
- **Métricas de sucesso**:
  - Rascunhos órfãos "sem trilha" por incidente: hoje potencial → 0
  - Cobertura de teste dos 4 pontos de morte: 3/4 → 4/4
- **Risco de não fazer**: um operador desesperado, sem pista, faz UPDATE ad hoc no ledger para "destravar", e cria o segundo lote
- **Dependências**: nenhuma

### [fault-tolerance-3] Endurecer o reaproveitamento de `flpCod`: só quando `etapa in ('criar_lote', 'importar')` e sem items importados

- **Problema**
  > `RemessaService.gerarRemessa` reaproveita `anterior.nativeFlpCod` para qualquer `anterior?.status !== 'settled' && !== 'reconciling'` (na prática: `error` ou `pending`). A assunção de que "o lote nativo vazio é reaproveitável" só vale quando a falha aconteceu ANTES do import. Se o processo morrer entre `importarTitulos` sucedendo e `setEtapa('finalizar')` e alguém flipar o ledger de `reconciling` para `error` manualmente, a próxima tentativa reusa o `flpCod` e re-importa em cima dos mesmos itens — comportamento não testado ao vivo.

- **Melhoria Proposta**
  > Adicionar guarda: só reaproveita `flpCod` se `anterior.etapa === 'criar_lote'` OU (`anterior.etapa === 'importar'` E consulta `listarTitulosPendentes(fil,bnc,flp)` devolve todos os itens do lote — sinal de que não houve import). Fora disso, o serviço deve subir `RemessaEmDuvidaError` mesmo sem `reconciling`. Escrever runbook proibindo flip manual `reconciling → error` e um teste para a nova guarda.

- **Resultado Esperado**
  > Reaproveitamento de `flpCod` é seguro mesmo se um humano forçar `error`. Zero re-import em cima de itens já importados.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Casos de teste para "reaproveita flpCod com etapa alcançada": 1 (criar_lote) → 3 (criar_lote, importar-sem-itens, importar-com-itens-bloqueia)
- **Risco de não fazer**: em regime de emergência, o SQL ad hoc que "resolve" cria o segundo pagamento
- **Dependências**: F-fault-tolerance-2 (contexto compartilhado sobre o ledger)

### [fault-tolerance-4] Envolver a conciliação (`registrarConciliacaoItem` + `transicionarLote`) em `withTransaction`

- **Problema**
  > `ConciliacaoRetornoService.conciliar` faz N updates locais em um loop e depois N transições, tudo em sequência solta sem `withTransaction`. Uma morte no meio deixa itens parcialmente conciliados com lote ainda em `REMESSA_GERADA`. O repo já aceita `TransactionClient` opcional; o serviço simplesmente não usa.

- **Melhoria Proposta**
  > Envolver o passo 3 e 4 (registrar itens + transicionar lotes) em `PostgreeDatabaseClient.withTransaction(tx => ...)` passando `tx` para `registrarConciliacaoItem` e `transicionarStatus`. Um `garCodSeq` conciliado = uma transação. Escrever teste que mate no meio do loop e verifique rollback.

- **Resultado Esperado**
  > Conciliação é all-or-nothing por arquivo de retorno. Nenhum lote fica com estado intermediário "parcialmente conciliado".

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Mutações locais em `ConciliacaoRetornoService` cobertas por transação: 0 → 100%
- **Risco de não fazer**: painel SISPAG e ledger contábil divergem silenciosamente; operador toma decisão redundante achando que retorno não veio
- **Dependências**: nenhuma

### [fault-tolerance-5] Reaper cron de execuções `reconciling` órfãs (SISPAG)

- **Problema**
  > `RemessaExecucaoRepository.listByStatus` existe mas ninguém consome. Uma execução em `reconciling` presa fica invisível até um operador esbarrar num 409 na UI. Sem instrumentação, o SLO "toda execução `reconciling` mais velha que 15 min é atendida" não existe.

- **Melhoria Proposta**
  > Job `src/backend/jobs/reaper-remessa-reconciling.ts` (executado por cron externo — a stack é Render, não Lambda) que a cada 15 min faz `SELECT ... FROM remessa_execucao WHERE status='reconciling' AND atualizado_em < now() - interval '15 min'` e publica log estruturado (nível WARN) por linha, incluindo `native_flp_cod`, `filCod`, `bncCod`, `etapa`. Adicionar rota `GET /sispag/execucoes-em-duvida` (admin) que devolve a mesma lista para consumo por painel operacional. Nenhuma ação automática — só surface.

- **Resultado Esperado**
  > Toda execução `reconciling` órfã aparece em log e no painel < 15 min após acontecer. Tempo de descoberta cai de "quando alguém tentar de novo" para 15 min.

- **Tactic alvo**: Condition Monitoring + Quarantine (surfacing)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Tempo mediano de descoberta de `reconciling` órfão: hoje "não medido / dias" → ≤ 15 min
  - Rota/dashboard listando execuções em dúvida: 0 → 1
- **Risco de não fazer**: acúmulo silencioso de rascunhos no ERP; incidente só é descoberto em auditoria
- **Dependências**: nenhuma

### [fault-tolerance-6] Agendar conciliação `.RET` (dry-run) por filial × banco × config de layout

- **Problema**
  > `POST /sispag/retornos/conciliar` só é chamado pela UI. Um `.RET` que chega no fim do dia fica indefinidamente sem virar baixa/transição local se ninguém abrir a tela. O SLO "retorno vira BAIXADO em D+1" não é assegurável hoje.

- **Melhoria Proposta**
  > Cron 2×/dia iterando `listConfigsRetorno` × filiais e chamando `ConciliacaoRetornoService.conciliar({ processar: false, dryRun: true })` para descobrir `.RET`s ainda não conciliados. Alertar quando `naoReconhecidos > 0` ou `rejeitados > 0`. O `processar=true` continua sendo humano (é a etapa que move dinheiro contábil no fin010) — só a descoberta e a conciliação em memória são automáticas até que F-1 esteja fechado.

- **Resultado Esperado**
  > Ninguém "esquece" um `.RET` no fin052. Tempo de detecção de retorno não conciliado cai de "quando alguém abrir a tela" para ≤ 12 h.

- **Tactic alvo**: Reconcile
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Execuções automáticas de conciliação por dia: 0 → ≥ 2 por (filial × banco × layout)
- **Risco de não fazer**: pagamento retorna, ninguém trata, painel SISPAG mente sobre estado real
- **Dependências**: F-fault-tolerance-1 (para o dia em que o cron for para `processar=true`)

### [fault-tolerance-7] Kill-switch por frente: `SISPAG_LIVE_WRITE_ENABLED`

- **Problema**
  > `CONEXOS_DRY_RUN` é global. Um bug de duplicação exclusivamente no SISPAG obriga a desligar TAMBÉM Permutas e Recebimentos para conter, ou aceitar continuar escrevendo. Precedente `snLiveWriteEnabled` (`SN_LIVE_WRITE_ENABLED`) prova que o padrão é aceito e barato.

- **Melhoria Proposta**
  > Adicionar `sispagLiveWriteEnabled` a `EnvironmentVars` lida de `SISPAG_LIVE_WRITE_ENABLED` (default `false`). `RemessaService.gerarRemessa` e `ConciliacaoRetornoService.conciliar` calculam `dryRun = !writeEnabled || !sispagLiveWriteEnabled || env.conexosDryRun || dryRunOverride`. Global permanece como override defensivo.

- **Resultado Esperado**
  > Incidente localizado no SISPAG é contido com uma env var, sem colateral em Permutas/Recebimentos.

- **Tactic alvo**: Fault Containment (blast radius)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-7
- **Métricas de sucesso**:
  - Frentes com kill-switch dedicado: 1/3 (`snLiveWriteEnabled`) → 3/3
  - Blast radius de "desligar escrita" (frentes afetadas): 3 → 1
- **Risco de não fazer**: primeiro incidente sério vira parada operacional larga porque o botão único é caro demais para apertar
- **Dependências**: nenhuma

### [fault-tolerance-8] Relatório semanal de rascunhos fin015 órfãos (forward-recovery institucionalizada)

- **Problema**
  > O ERP não expõe DELETE de rascunho fin015. Quando `importarTitulos` falha por título inelegível ou o operador abandona o lote local, o rascunho fica atribuído à pessoa real e nunca é limpo (o único job de cleanup recusa rodar fora de HML). O impacto é lento mas determinístico.

- **Melhoria Proposta**
  > Documentar formalmente que a política é forward-recovery (não há como compensar; só cancelar depois de finalizado ou aceitar o resíduo). Job semanal `src/backend/jobs/relatorio-rascunhos-fin015.ts` que compara `fin015/list?flpVldStatus=0` do ERP com `remessa_execucao` local e publica lista de candidatos a "finalizar+cancelar" para o operador decidir. Runbook curto explicando o passo humano.

- **Resultado Esperado**
  > Rascunhos órfãos deixam de ser inventário invisível. Financeiro tem ritual semanal de limpeza (5-10 min).

- **Tactic alvo**: Compensating Transaction (forward)
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-8
- **Métricas de sucesso**:
  - Rascunhos fin015 órfãos: hoje "não medido" → medido semanal, tendência caindo
- **Risco de não fazer**: auditoria interna acha rascunhos atribuídos a pessoa real e questiona intenção
- **Dependências**: F-fault-tolerance-5 (mesmo pattern de "surface, não atue")

### [fault-tolerance-9] Aceitar `Idempotency-Key` em `POST /sispag/retornos/conciliar` e passar ao serviço

- **Problema**
  > A rota de conciliação simplesmente não lê o header `Idempotency-Key`. Combinada com F-1, isso significa que nem a barreira HTTP-level nem a barreira de ledger existem — só o `busy` do frontend, que se perde em recarga de aba.

- **Melhoria Proposta**
  > Passar `req.header('Idempotency-Key')` para `ConciliacaoRetornoService.conciliar`. O serviço usa como chave de idempotência do ledger criado em F-1 (ou como default derivado). Frontend passa a enviar o header no botão de conciliar.

- **Resultado Esperado**
  > Retry seguro na conciliação, alinhado ao pattern já usado no `gerarRemessa`.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S (feito junto com F-1)
- **Findings relacionados**: F-fault-tolerance-9, F-fault-tolerance-1
- **Métricas de sucesso**:
  - Rotas mutatórias que honram Idempotency-Key: 1/2 → 2/2
- **Risco de não fazer**: qualquer proteção de idempotência criada em F-1 continua exposta a recarga de aba
- **Dependências**: F-fault-tolerance-1

## 6. Notas do agente

- Decisão de escopo: tratei apenas o delta SISPAG desta branch (`RemessaService`, `ConciliacaoRetornoService`, `ConexosSispagWriteClient`, `ConexosSispagRetornoClient`, `RemessaExecucaoRepository`, migration 0049, rotas relacionadas). `IngestaoPagamentosService`/`FormacaoLotesService` só foram tocados para checar o pattern de `withTransaction`.
- Métricas não medíveis localmente estão marcadas explicitamente — todas requerem query em Supabase ou instrumentação (CloudWatch/Prometheus não existe hoje).
- Conexões cross-QA para o consolidator: (a) `Idempotency-Key` overlap com **Availability** (retry safety) e **Performance** (evita amplificação); (b) ausência de reaper e de cron de conciliação overlap com **Testability** (nada testa "cron rodou e alertou") e com **Modifiability** (adicionar hoje força tocar múltiplos serviços); (c) `CONEXOS_DRY_RUN` global overlap com **Security** (blast radius de kill-switch) e **Deployability** (rollback granular). Idempotência do `processarArquivoRetorno` é o P0 mais imediato — falar antes de qualquer coisa de "escritas seguras".
- Bug real relatado no briefing (dois lotes órfãos em HML por `error` não bloquear) foi verificado no código: a correção via reaproveitamento de `nativeFlpCod` fecha o caso normal, mas F-fault-tolerance-2 e F-fault-tolerance-3 mostram duas janelas residuais que a correção não cobre.
