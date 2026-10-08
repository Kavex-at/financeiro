---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-fault-tolerance
generated_at: 2026-10-08T20:30:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista / sistema (cron, retry de HTTP) | Falha parcial: fin064/Conexos indisponível no finalizar ou na geração da remessa; favorecido revogado ou com destino alterado entre finalizar e remessa; duplo clique em finalizar | `LotePagamentoService.finalizarLote`, `VerificacaoTedPixService.retirar`, `RemessaService.exigirFavorecidosAutorizados` (guarda L8), `AuthorizedPayeeService.abrirReaprovacao` (F4) | Produção, Conexos instável, lote em RASCUNHO/FINALIZADO | Falha fechada: item não verificável fica PENDENTE e barra o finalizar; item não autorizado é retirado com evento de auditoria na mesma transação; L8 barra o lote inteiro antes de qualquer escrita no ERP ou linha de ledger | 0 remessas TED/PIX com favorecido não autorizado; 0 itens removidos sem evento `ITEM_REMOVIDO_SISTEMA`; 0 lote nativo órfão causado pela guarda |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas multi-tabela da feature dentro de `withTransaction` | 100% (AuthorizedPayeeService 6/6 mutações; `retirar` = descarte de alerta + DELETE + bump de versão + evento) | 100% | ✅ | grep `withTransaction` em AuthorizedPayeeService.ts, VerificacaoTedPixService.ts:329, LotePagamentoRepository.ts:806-835 |
| Mutação de estado com evento de auditoria pareado na mesma tx | 100% nos caminhos novos (`registrarEvento` dentro do `tx`) | 100% | ✅ | AuthorizedPayeeService.ts:127-160, 203, 451-490, 499-530 |
| Falha de leitura vira bloqueio (fail-closed) | Sim: finalizar -> PENDENTE -> `PaymentCheckPendingError`; L8 -> `FALHA_LEITURA` -> `PayeeNotAuthorizedAtRemittanceError` | Sim | ✅ | VerificacaoTedPixService.ts:206-232; RemessaService.ts:1245-1291 |
| Guarda L8 antes de escrita no ERP/ledger | Sim (linha 396, antes de `resolverDataDebito`, `listContasCorrentes`, criarLote) | Sim | ✅ | RemessaService.ts:396-403 |
| Controle de concorrência no finalizar | Optimistic lock por `versao` (checado antes da verificação) | Presente | ✅ | LotePagamentoService.ts:451-456 |
| Idempotency-Key em endpoints financeiros | 0 de 2 (finalizar, gerar remessa); mitigado por `versao` e por estado | 100% nos de escrita financeira | ⚠️ | routes/sispag.ts (sem header) |
| Job reaper de estado preso / reconciliação com Conexos para esta feature | Ausente | Presente | ⚠️ | `ls src/backend/jobs` (só validate/aposentar/probe) |
| Testes de reprocesso da feature | Cobertos: reapproval, fail-closed, BatchEmptied, resume sem L8 (RemessaService.test.ts, VerificacaoTedPixService.test.ts, integração SQL) | Todos os cenários modelados | ✅ | gates em _shared-metrics.md (3967 testes, test:sql) |
| Timeouts de clientes externos | ⚠️ Não medível neste delta (clientes não tocados); ver qa-availability | 100% | ⚠️ | n/a |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | `verificarDestinoAutorizado` compara fingerprint do destino ao vivo com o aprovado; Zod em `DestinoManualSchema` | ✅ presente | AuthorizedPayeeRule.ts, DestinoManualValidator.ts |
| Comparison | Impressão digital do destino aprovado x observado (F4, L8) | ✅ presente | PayeeFingerprint.ts; abrirReaprovacao |
| Condition Monitoring | Alerta `SISPAG_DESTINO_ALTERADO` com dedup por favorecido+modalidade | ✅ presente | AuthorizedPayeeService.ts:~535 |
| Timestamp | `ultimaConferenciaEm`, `decididoEm`, eventos com ator/quando | ✅ presente | abrirReaprovacao |
| Timeout | Não alterado pelo delta | N/A | clientes fora do escopo |
| Quarantine | Item sem autorização é retirado do lote; autorização em REAPROVACAO_PENDENTE deixa de valer até nova aprovação (solicitante limpo, sistema não aprova) | ✅ presente | removerItemPeloSistema; abrirReaprovacao |
| Recovery (forward) | Retiradas persistem (com evento); lote segue RASCUNHO e o analista reprocessa; sem compensação em ERP (escolha explícita: nada é escrito antes da guarda) | ✅ presente | LotePagamentoService.ts:437-443 |
| Rollback | Transações por mutação; guarda L8 antes de qualquer escrita evita ter o que desfazer | ✅ presente | RemessaService.ts:396 |
| Idempotent Replay | `CONFIRMAR` reusa a autorização vigente; `setFavorecidoAutorizadoItem` idempotente na retomada; `removerItemPeloSistema` devolve false se já removido | ✅ presente | AuthorizedPayeeService.ts:123-145; RemessaService.ts:1208-1223 |
| Reconcile | Sem job que releia fin064 periodicamente para antecipar F4 fora do fluxo do analista | ⚠️ parcial | só na conferência manual e no finalizar |
| Exception Handling / Reintroduction (State Resync) | Retomada ADR-0039 usa destino congelado | ✅ presente | RemessaService.ts:1208 |
| Voting / Redundancy / Substitution | N/A: sem réplica; fonte única de verdade é o fin064 | N/A | n/a |

## 4. Findings

### F-fault-tolerance-1: Janela de TOCTOU entre a guarda L8 e a escrita no ERP

- **Severidade**: P2
- **Tactic violada**: Sanity Checking (checagem não atômica com a escrita)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:396-403`
- **Evidência (objetiva)**:
  ```
  const autorizacoes = flpCodExistente === undefined ? await this.exigirFavorecidosAutorizados(lote) : undefined;
  ... depois: listContasCorrentes, criarLote/importar no fin015 (várias chamadas ao Conexos)
  ```
- **Impacto técnico**: revogação ou mudança de destino ocorrida entre a leitura do fin064 e o import no fin015 (segundos a minutos) não é vista; o destino enviado vem de leitura posterior, não da verificada.
- **Impacto de negócio**: risco residual baixo, a janela é curta e o pagamento ainda passa por conferência no banco; é inerente a ERP sem transação distribuída.
- **Métrica de baseline**: 1 janela por geração de remessa; 0 releituras entre a guarda e o import.

### F-fault-tolerance-2: Retomada pula a guarda L8 (destino congelado)

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring
- **Localização**: `RemessaService.ts:396-403`
- **Evidência (objetiva)**:
  ```
  // Só enquanto não existe lote nativo: numa retomada (ADR-0039) vale o destino congelado
  ```
- **Impacto técnico**: se o favorecido for revogado entre a 1ª tentativa e a retomada, a remessa sai com o destino aprovado no momento do congelamento. A escolha está documentada (evita lote órfão no fin015) e é forward recovery coerente, mas não há alerta ao analista.
- **Impacto de negócio**: pagamento a favorecido revogado nesse intervalo, só detectável depois.
- **Métrica de baseline**: 0 verificações de revogação na retomada.

### F-fault-tolerance-3: finalizarLote não é atômico; retiradas persistem se o finalizar falhar depois

- **Severidade**: P2
- **Tactic violada**: Rollback / Compensating Transaction
- **Localização**: `LotePagamentoService.ts:443-512`
- **Evidência (objetiva)**:
  ```
  verificarItens(RETIRAR) -> (retiradas commitadas, uma tx por item) -> exigirDuplicidadesTratadas -> transicionar(versao + retirados.length)
  ```
- **Impacto técnico**: se houver duplicidade aberta ou conflito de versão após as retiradas, o lote fica RASCUNHO com itens a menos. É intencional e auditado (evento por item), mas o `versao + retirados.length` assume um bump por retirada; qualquer outro bump concorrente gera `LoteVersaoConflitoError` espúrio.
- **Impacto de negócio**: analista vê o lote mudar sem ter finalizado; reprocessamento manual, sem perda de dinheiro.
- **Métrica de baseline**: 1 caminho de falha parcial documentado; 0 teste de conflito de versão pós-retirada identificado neste review.

### F-fault-tolerance-4: Falha de leitura do título na L8 é engolida sem log da causa

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `RemessaService.ts:1246-1250`
- **Evidência (objetiva)**:
  ```
  .getTituloAPagar(item.filCod, item.docCod, item.titCod).catch(() => null);
  ```
- **Impacto técnico**: o resultado é fail-closed (`FALHA_LEITURA`), correto, mas a causa (timeout, 401, 404) se perde; o log final traz só `motivo=FALHA_LEITURA`. Leituras seriais (N+1) por item também alongam a janela do F-1.
- **Impacto de negócio**: diagnóstico mais lento quando o Conexos oscila.
- **Métrica de baseline**: 0 logs de erro por item na leitura; N chamadas seriais por lote.

Sem finding P0: nenhum defeito concreto introduzido pelo delta que leve dinheiro a destino não autorizado, perda de dados ou indisponibilidade. A ausência de reaper/reconciliação é pré-existente e não específica desta feature.

## 5. Cards Kanban

### [fault-tolerance-1] Registrar a causa da falha de leitura na guarda L8 e ler títulos em paralelo limitado

- **Problema**
  > O `.catch(() => null)` na guarda L8 descarta o erro do Conexos; o analista só vê `FALHA_LEITURA`. As leituras são seriais.
- **Melhoria Proposta**
  > Logar `logService.warn` com a causa por item no catch (mantendo fail-closed) e usar leitura com concorrência limitada. Tocar `RemessaService.exigirFavorecidosAutorizados`.
- **Resultado Esperado**
  > Causa visível no log; tempo da guarda cai com N itens. Logs de causa: 0 -> 1 por falha.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4, F-fault-tolerance-1
- **Métricas de sucesso**:
  - Falhas de leitura com causa no log: 0% -> 100%
- **Risco de não fazer**: diagnóstico lento em incidente do Conexos.
- **Dependências**: nenhuma

### [fault-tolerance-2] Reverificar o favorecido na retomada e alertar sobre revogação

- **Problema**
  > Na retomada com lote nativo existente a L8 não roda; revogação posterior ao congelamento não é detectada.
- **Melhoria Proposta**
  > Na retomada, consultar só o estado da autorização (banco local, sem ERP): se revogada/rejeitada, não enviar o arquivo e emitir alerta ao analista (forward recovery explícito, sem desfazer o lote nativo). Documentar em runbook.
- **Resultado Esperado**
  > Retomadas com favorecido revogado: não detectadas -> 100% sinalizadas.
- **Tactic alvo**: Condition Monitoring / Forward Recovery
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-1
- **Métricas de sucesso**:
  - Retomadas com checagem de revogação: 0% -> 100%
- **Risco de não fazer**: pagamento a favorecido revogado em retomada.
- **Dependências**: decisão de produto sobre bloquear ou apenas alertar

### [fault-tolerance-3] Tornar o finalizar robusto ao bump de versão e testar a falha parcial

- **Problema**
  > `versao + retirados.length` assume bumps exclusivos das retiradas e o caminho "retirou e falhou depois" não tem teste dedicado.
- **Melhoria Proposta**
  > Reler a versão do lote após as retiradas em vez de calcular, e cobrir com teste de duplicidade aberta e de conflito pós-retirada. Tocar `LotePagamentoService.finalizarLote`.
- **Resultado Esperado**
  > Zero conflitos espúrios; cenário parcial coberto: 0 -> 2 testes.
- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Testes do caminho parcial: 0 -> 2
- **Risco de não fazer**: falsos conflitos de versão confundem o analista.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só os fluxos citados (finalizarLote, L8, F4, fail-closed); não auditei idempotência de SQS (não há SQS neste repo) nem reaper/reconciliação geral (pré-existente, cross-QA com Availability).
- Cross-QA: trilha de auditoria (eventos pareados) com Security; testes de reprocesso com Testability; timeouts com Availability/Performance.
- Não executei os testes; baseei-me nos gates de _shared-metrics.md.
