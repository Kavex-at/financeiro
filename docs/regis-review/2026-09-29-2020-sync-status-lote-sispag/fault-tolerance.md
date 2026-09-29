---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-29-2020
agent: qa-fault-tolerance
generated_at: 2026-09-29T20:40:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron horário (GitHub Actions), analista ("Sincronizar agora") e conciliação L9/L10 | Falha parcial no Conexos (401/403/5xx/timeout em fin064, fin052 ou PSQ_018) ou queda do processo no meio da gravação local | `SincronizacaoLoteService`, `DecisaoStatusLote`, `LotePagamentoRepository.aplicarSincronizacao`, `ConciliacaoRetornoService`, job `sincronizar-lotes-sispag` | Produção (Render + Postgres Supabase + Conexos), 1 lote = N itens, arquivo `.RET` que mistura filiais | Leitura falha nunca decide (I11c); item+transição gravam em 1 transação sob optimistic lock; passada repetida é idempotente (I11h); falha total de leitura vira exit 1 e alerta | 0 lotes em BAIXADO/RETORNADO por leitura ilegível; 0 transições parciais; 100% das passadas "todas falharam" com status ERROR; lote atrasado converge em <= 1 passada horária |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escrita local de sincronização em transação única (itens + lote) | 1/1 (`aplicarSincronizacao` via `withTransaction`; a trava `versao`/`status` é a 1a escrita) | 100% | ✅ | `LotePagamentoRepository.ts` `aplicarSincronizacao` |
| Leituras Conexos da sincronização que não lançam e são tri-estado (`legivel:false`) | 2/2 (`lerSituacaoTitulo`, `lerBaixasTitulo`) | 100% | ✅ | `ConexosSispagClient.ts`, `ConexosTitulosClient.ts` |
| Leitura de detalhe fin052 falha isolada e contada | sim (`allSettled` + `eventosNaoLidos`) | sim | ✅ | `SincronizacaoLoteService.ts` `lerEventosRetorno` |
| Isolamento de falha por lote em `sincronizarTodos` (try/catch por lote) | 0/1 (exceção de DB num lote aborta a passada) | 1/1 | ⚠️ | `SincronizacaoLoteService.ts` `sincronizarTodos` |
| Escritas no ERP feitas pela sincronização | 0 (read-only, I11a) | 0 | ✅ | `SincronizacaoLoteService.ts` (só `sispag.lerSituacaoTitulo`, `titulos.lerBaixasTitulo`, `retorno.list*`) |
| Idempotência da passada (sem mudança não mexe em `versao`) | sim (`tocarSincronizacao`) | sim | ✅ | `LotePagamentoRepository.ts` `tocarSincronizacao` |
| Resultado `PULADO` da conciliação L9/L10 propagado ao operador | 0/1 (retorno de `aplicarEventosRetorno` descartado) | 1/1 | ⚠️ | `ConciliacaoRetornoService.ts` (loop `aplicarEventosRetorno`) |
| Linha de audit-trail para transição de status do lote e mudança de situação de item | 0 linhas dedicadas (só `LogService` + `alerta` + `job_run`) | 1 por transição | ⚠️ | `aplicarSincronizacao`: nenhum INSERT de trilha |
| Stuck-state / reaper | presente: o próprio job horário reprocessa REMESSA_GERADA/RETORNADO e BAIXADO na janela de 30 dias | presente | ✅ | `listLotesSincronizaveis`, workflow `sincronizar-lotes-sispag.yml` |
| Detecção de "credencial morta" (0 títulos lidos) | exit 1 + `job_run` ERROR + alerta ADR-0042 | sim | ✅ | `SincronizarLotesSispagJob.fechar` |
| Reconciliação contra Conexos | é o próprio L11 (fin064 é a verdade) | presente | ✅ | regra I11 |
| Timeout explícito nos clients novos | ⚠️ **Não medível localmente**: delegado ao `ConexosBaseClient`/`runWithRetry`; o timeout efetivo por chamada exige leitura do base client (fora do delta). Recomendação: confirmar `timeout` no axios do base client | 100% | ⚠️ | `ConexosSispagClient.ts`, `ConexosTitulosClient.ts` |
| Idempotency-Key em `POST /lotes/:id/sincronizar` | ausente, mas operação naturalmente idempotente (I11h) e sem escrita no ERP | n/a | ✅ | `routes/sispag.ts` |
| DLQ / SQS | ⚠️ **Não medível**: não existe SQS/`infra/` neste repo | — | ⚠️ | CLAUDE.md (Estado Atual vs. Alvo) |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod estrito para `vldPago` (só 0/1/true/false); campo ausente => ilegível; linha casada por `docCod`+`titCod` | ✅ presente | `ConexosSispagClient.ts` `vldPagoEstrito`, `situacaoDaLinha` |
| Comparison | Precedência REJEITADO > 00 > BD entre fin052 e fin064; contradição vira `divergencia` (humano resolve, I11f) | ✅ presente | `DecisaoStatusLote.ts`, migration 0069 |
| Timestamp | `sincronizado_em`, `pago_observado_em`, filtro de `flpCod` reciclado por `cadastradoEm` vs `remessaGeradaEm` | ✅ presente | `arquivoPosteriorARemessa` |
| Timeout | Herdado do base client | ⚠️ parcial | não verificado no delta |
| Condition Monitoring | `job_run` (SUCCESS/PARTIAL/ERROR) + `stalenessLimits` + alertas | ✅ presente | `SincronizarLotesSispagJob.ts`, `stalenessLimits.ts` |
| Redundancy | fin064 (prova) + fin052 (veto/agenda) + PSQ_018 (trilha) | ✅ presente | regra I11 |
| Recovery (forward) | Conflito de versão => `PULADO`, lote volta na próxima passada; divergência => alerta para humano | ✅ presente | `processarLote` |
| Rollback | Transação única item+lote; conflito não grava nada | ✅ presente | `aplicarSincronizacao` |
| Idempotent Replay | Passada sem mudança só carimba `sincronizado_em`; conciliação com ledger write-ahead + `getArquivoRetorno` antes de `processar` | ✅ presente | `tocarSincronizacao`; `ConciliacaoRetornoService.conciliar` |
| Compensating Transaction | N/A: a sincronização não escreve no ERP; a conciliação usa recuperação forward explícita (ledger `reconciling` => pergunta ao ERP => `ConciliacaoEmDuvidaError`) | N/A | escolha documentada no código |
| Reconcile | L11 horário é a reconciliação lote-vs-título | ✅ presente | `sincronizarTodos` |
| Quarantine | `divergencia=true` + alerta `sispag-baixa-divergente` | ✅ presente | migration 0069 |
| Escalating Restart / Shadow / Voting | N/A: job de execução curta, sem processo residente | N/A | — |
| Predictive Model / Substitution | N/A | N/A | — |
| Audit trail (invariante da proposta) | logs estruturados + alerta; sem linha de trilha por transição | ⚠️ parcial | `aplicarSincronizacao` |

## 4. Findings

### F-fault-tolerance-1: exceção de DB em um lote aborta a passada dos demais (in-delta)

- **Severidade**: P2
- **Tactic violada**: Recovery (isolamento de falha por unidade de trabalho)
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoLoteService.ts` `sincronizarTodos` (loop `for (const lote of lotes)`)
- **Evidência (objetiva)**:
  ```
  for (const lote of lotes) {
      resultados.push(await this.processarLote(lote, porLote.get(lote.id), agora));
  }
  ```
  Sem try/catch. As leituras do Conexos não lançam, mas `aplicarSincronizacao`/`tocarSincronizacao` e `getLoteComItens` (pool, deadlock, timeout) podem. O job cai no `catch` e devolve exit 1, sem processar os lotes restantes.
- **Impacto técnico**: um lote "venenoso" (ex.: violação de CHECK) bloqueia a sincronização de todos os lotes ordenados depois dele, toda hora, até alguém intervir.
- **Impacto de negócio**: lotes pagos continuam como REMESSA_GERADA; a analista vê status defasado. Mitigado: exit 1 gera alerta e o botão manual reprocessa lote a lote.
- **Métrica de baseline**: 0/1 loops por lote com isolamento (nº de lotes ativos em produção: não medível localmente).

### F-fault-tolerance-2: conciliação descarta o resultado do fechamento por lote (in-delta)

- **Severidade**: P2
- **Tactic violada**: Comparison / Sanity Checking do resultado
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts` (passo 4, `await this.sincronizacao.aplicarEventosRetorno(loteId, eventos)`) e `ledger.settle` seguinte
- **Evidência (objetiva)**:
  ```
  for (const [loteId, eventos] of eventosPorLote) {
      await this.sincronizacao.aplicarEventosRetorno(loteId, eventos);
  }
  ...
  lotesAfetados: [...lotesAfetados]   // inclui lotes pulados por conflito
  ```
  A atomicidade "1 transação por arquivo" virou "1 por lote": conflito de versão num lote deixa-o sem fechar e o ledger é liquidado (`settled`, se a varredura foi completa), então novo clique recebe o curto-circuito `jaConciliado`.
- **Impacto técnico**: lote pulado fica sem fechar e a resposta HTTP não avisa. Quem cura é o job horário (convergência), não a conciliação.
- **Impacto de negócio**: a tela informa "lotes afetados" que podem não ter transicionado; janela de até 1h (ou até o próximo dia útil fora de 11–22 UTC) de divergência visual. Sem perda de dinheiro (L11 é read-only e o ERP já baixou).
- **Métrica de baseline**: 1 chamada com retorno ignorado; convergência <= 60 min dentro da janela do cron.

### F-fault-tolerance-3: transição de status/situação sem linha de trilha de auditoria (in-delta, padrão herdado)

- **Severidade**: P1
- **Tactic violada**: Repair State (auditabilidade) — invariante de audit-trail da proposta
- **Localização**: `LotePagamentoRepository.aplicarSincronizacao`; `SincronizacaoLoteService.registrarDesfecho`
- **Evidência (objetiva)**:
  ```
  UPDATE lote_pagamento SET status = COALESCE($para, status), versao = versao + 1 ...
  UPDATE lote_pagamento_item SET situacao = ..., bor_cod = ..., pago_em = ...
  ```
  Nenhum INSERT de trilha na mesma transação (o único audit do lote é `lote_pagamento_item_destino_audit`, de destino manual). O "quem/quando/o quê" vive em `LogService` e em `job_run.metricas`; nem o ator do "Sincronizar agora" é guardado. Campos ausentes são sobrescritos com NULL por decisão, então o estado anterior se perde.
- **Impacto técnico**: não dá para reconstruir, a partir do banco, por que o lote foi a BAIXADO nem qual leitura do fin064 o sustentou.
- **Impacto de negócio**: a auditoria de "quem/quando marcou o lote como pago" depende de logs. Compensado parcialmente por `pago_observado_em`, `baixa_fonte`, `sincronizado_em` no item — por isso P1 e não P0.
- **Métrica de baseline**: 0 linhas de audit por transição de lote; 2 tipos de UPDATE sem trilha por passada com mudança.

### F-fault-tolerance-4: `UPDATE` de item sem checar linhas afetadas dentro da transação (in-delta)

- **Severidade**: P3
- **Tactic violada**: Sanity Checking
- **Localização**: `LotePagamentoRepository.aplicarSincronizacao` (loop `tx.update` dos itens)
- **Evidência (objetiva)**: o retorno de `tx.update` dos itens é descartado; item removido entre leitura e gravação passa como `APLICADO` com a transição do lote já gravada.
- **Impacto técnico**: raro (itens imutáveis fora de RASCUNHO), mas o lote pode transicionar com item não atualizado.
- **Impacto de negócio**: desprezível hoje; risco latente se surgir remoção/edição de item pós-remessa.
- **Métrica de baseline**: 0 checagens de linhas afetadas em N UPDATEs por lote.

Pontos positivos verificados (sem finding): I11c respeitado ponta a ponta (tri-estado, sem `catch => false`); `FALHA_LEITURA` com 100% de itens ilegíveis não grava nada; exit 1 quando todas as leituras falham (lição de 23/09); workflow com `concurrency` sem cancelamento e passo de alerta; nenhuma escrita no ERP (sem risco de dupla execução financeira); rollback da migration 0069 presente e SQL idempotente.

## 5. Cards Kanban

### [fault-tolerance-1] Isolar falha por lote em `sincronizarTodos`

- **Problema**
  > Uma exceção de banco em um lote interrompe o laço e impede a sincronização dos demais na mesma passada; o job só reporta exit 1.

- **Melhoria Proposta**
  > Envolver `processarLote` em try/catch por lote, contar como resultado `ERRO` no `ResumoSincronizacao`, logar e seguir. O job fecha PARTIAL (ou ERROR se todos falharem). Tocar `SincronizacaoLoteService.ts` e `SincronizarLotesSispagJob.ts` (+ testes).

- **Resultado Esperado**
  > Um lote defeituoso não atrasa os demais: lotes não processados após uma exceção, de "todos os restantes" para 0.

- **Tactic alvo**: Recovery (forward) / isolamento de falha
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Lotes não processados após uma exceção: N restantes → 0
- **Risco de não fazer**: um lote com dado inesperado trava a sincronização horária inteira até intervenção manual.
- **Dependências**: nenhuma

### [fault-tolerance-2] Propagar o desfecho do fechamento por lote na conciliação L9/L10

- **Problema**
  > `ConciliacaoRetornoService` ignora o resultado de `aplicarEventosRetorno`; lote pulado por conflito aparece em `lotesAfetados` e o ledger liquida.

- **Melhoria Proposta**
  > Coletar o resultado por lote, devolver `lotesFechados`/`lotesPulados` na resposta e, havendo pulado ou exceção, chamar `ledger.fail` (como na varredura incompleta) para permitir nova passada.

- **Resultado Esperado**
  > Resposta HTTP e ledger refletem o que foi de fato gravado; lote pulado deixa de ser silencioso.

- **Tactic alvo**: Comparison / Reconcile
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Resultados de fechamento propagados: 0/1 → 1/1
- **Risco de não fazer**: a analista acredita que o lote fechou; a defasagem só some no próximo cron.
- **Dependências**: nenhuma

### [fault-tolerance-3] Gravar trilha de auditoria da transição de lote e da situação dos itens

- **Problema**
  > Transições de status e mudanças de situação de item pela sincronização não deixam linha de trilha (quem/quando/de-para/prova) no banco; só logs.

- **Melhoria Proposta**
  > Criar `lote_pagamento_transicao_audit` (lote, de, para, origem `SINCRONIZACAO_CRON|MANUAL|CONCILIACAO`, ator, evidência resumida, em) e inserir dentro de `aplicarSincronizacao`, na mesma transação; passar o ator do "Sincronizar agora". Migration + rollback.

- **Resultado Esperado**
  > 100% das transições reconstruíveis a partir do banco.

- **Tactic alvo**: Repair State (audit trail)
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Transições com linha de trilha: 0% → 100%
- **Risco de não fazer**: numa disputa sobre "quem marcou este lote como pago", a resposta depende de logs rotativos.
- **Dependências**: nenhuma (cruza com Security/auditabilidade)

### [fault-tolerance-4] Verificar linhas afetadas nos UPDATEs de item

- **Problema**
  > O retorno de `tx.update` dos itens é ignorado em `aplicarSincronizacao`.

- **Melhoria Proposta**
  > Se `afetadas !== 1` para algum item, abortar a transação (retornar `CONFLITO`) e logar.

- **Resultado Esperado**
  > Nenhuma transição gravada com item não atualizado.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - UPDATEs de item checados: 0% → 100%
- **Risco de não fazer**: inconsistência silenciosa se itens passarem a ser mutáveis pós-remessa.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta de `sync-status-lote-sispag`; nenhum P0 (sem escrita financeira no ERP no delta; I11b/I11c/I11h e transação por lote confirmados no código). Sem SQS/DLQ/`infra/` neste repo: itens D10–D11 não se aplicam.
- Timeout efetivo por chamada e Idempotency-Key em endpoints financeiros pré-existentes não foram medidos (fora do delta). Cruza com Availability/Performance (fan-out 4, sessões do robô, cron :35 coincidindo com `reconciliar-nde`).
- Cruzamentos: F-fault-tolerance-3 com Security (auditabilidade); testes de reprocesso (`SincronizacaoLoteService.test.ts`, integração 0069) com Testability.
