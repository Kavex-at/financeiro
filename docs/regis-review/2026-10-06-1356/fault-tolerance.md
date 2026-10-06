---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-06-1356
agent: qa-fault-tolerance
generated_at: 2026-10-06T14:30:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

Escopo: DELTA da feature sispag-verificacoes-ted-pix (--quick). Leitura estática, nada executado contra o Conexos.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG / job de verificação / job semanal de perfil | Leitura do fin064/cadastro Conexos falha no meio da verificação; ou finalizar/devolver/conferir/remover chegam concorrentes sobre o mesmo lote | `VerificacaoTedPixService`, `LotePagamentoService.finalizarLote`, `ConferenciaLoteService`, `RemessaService`, `PerfilCanalService` | Operação normal, Conexos instável, múltiplos analistas | Falha fechada: item PENDENTE e finalizar bloqueia; escrita multi-tabela atômica; conflito de versão rejeitado sem gravar; perfil não grava nada em falha parcial | 0 itens aprovados com leitura falha; 0 remoções sem evento+pendência; 0 remessa de lote TED/PIX não conferido |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas multi-tabela do delta dentro de `withTransaction` (remoção+alerta+pendência+evento; marcar+alertas+pendência; conferir+evento; devolver+evento) | 4/4 | 100% | ✅ | `VerificacaoTedPixService.ts` retirarSemDado/verificarItem; `LotePagamentoRepository.ts` conferir/devolver/removerItemPeloSistema |
| Mutações do lote com optimistic lock (`versao`) em SQL no delta | conferir, devolver, transicionar, aplicarSincronizacao: 4/4 (removerItemPeloSistema só bumpa, não confere) | 100% | ⚠️ | `LotePagamentoRepository.ts:744-791, 964-985` |
| Mutações novas com evento de auditoria na mesma transação | conferir, devolver, remoção sistema: 3/3 | 100% | ✅ | `eventos.registrar(..., tx)` |
| Resultado de `removerItemPeloSistema` (boolean) consumido pelo chamador | 0/1 | 1/1 | ❌ | `VerificacaoTedPixService.ts` retirarSemDado |
| Guard de conferência antes de chamada ao ERP na remessa | 1/1 (antes de qualquer chamada) | 1/1 | ✅ | `RemessaService.ts:256` |
| Endpoints financeiros do delta com Idempotency-Key | remessa/ingestão honram; conferir/devolver/finalizar protegidos por `versao` (idempotência por CAS) | 100% | ⚠️ | `routes/sispag.ts:802,1010` |
| Falhas de leitura Conexos tratadas como pendente (não vazio) | 3/3 (fin064, cadastro, perfil) | 100% | ✅ | `lerFilial`, `verificarItem`, `PerfilCanalService.falhou` |
| Job reaper de itens PENDENTE parados / reconciliação SISPAG x Conexos | ⚠️ Não medível no delta: o re-verificar depende de ação do analista/ciclo; não há job dedicado | presente | ⚠️ | glob `jobs/` |
| Testes de cenários de falha/conflito (suites do delta) | 223 suites backend verdes; 101 SQL | — | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | fin064 sem favorecido/título vira PENDENTE com motivo, não OK | ✅ presente | `VerificacaoTedPixService.ts` verificarItem |
| Condition Monitoring | warn por item pendente; contagem `falhasLeitura` no job de perfil | ✅ presente | `PerfilCanalService.ts:120-130` |
| Timestamp / versão | `versao` + `status` no WHERE (CAS) | ✅ presente | `LotePagamentoRepository.ts` |
| Comparison | duplicidade (DuplicateDetector) e canal habitual | ✅ presente | `DuplicateDetector.ts` |
| Timeout | herdado dos clients Conexos; não alterado no delta | ⚠️ parcial | cross-ref Availability |
| Recovery (forward) | falha fechada + fila de pendência de cadastro + devolução de lote | ✅ presente | `PendenciaCadastroService`, `devolver` |
| Rollback (backward) | transações pg em todas as escritas multi-tabela do delta | ✅ presente | `withTransaction` |
| Idempotent Replay | conferir exige `conferido_por IS NULL`; remoção DELETE é idempotente; abrirOuAcrescentar acumula | ✅ presente | repo conferir |
| Compensating Transaction | N/A: escrita local, sem write externo novo no delta; remessa mantém forward recovery | N/A | — |
| Reconcile | alertas reconciliadas por passada (mantém/abre/OBSOLETA); pendência auto-resolve | ✅ presente | `reconciliarAlertas`, `resolverDoFavorecido` |
| Quarantine | alerta de duplicidade bloqueia finalizar; item PENDENTE bloqueia | ✅ presente | `exigirDuplicidadesTratadas` |
| Reintroduction (State Resync) | job de perfil só grava se completo; reexecutável | ✅ presente | `PerfilCanalFornecedorRepository.ts:70` |
| Voting / Redundancy / Self-Test / Predictive Model | N/A: sem réplica ativa; perfil de canal é heurística informativa | N/A | — |

## 4. Findings

### F-fault-tolerance-1: remoção pelo sistema ignora retorno `false` e segue descartando alertas e abrindo pendência RETIRADO

- **Severidade**: P1
- **Tactic violada**: Sanity Checking / Repair State
- **Localização**: `src/backend/domain/service/sispag/VerificacaoTedPixService.ts` (retirarSemDado); `LotePagamentoRepository.ts` removerItemPeloSistema
- **Evidência (objetiva)**:
  ```
  await this.alertaRepo.descartarDoItem(loteId, chave, SISPAG_SYSTEM_ACTOR, tx);
  await this.loteRepo.removerItemPeloSistema({ loteId, ...chave }, tx);   // retorno boolean ignorado
  await this.pendenciaRepo.abrirOuAcrescentar({... desfecho: RETIRADO }, tx);
  ```
  O DELETE é guardado por `l.status = 'RASCUNHO'`; se o analista finalizou entre a leitura e a remoção, devolve `false` e nada é removido, mas as alertas do item foram descartadas e a pendência diz "retirado".
- **Impacto técnico**: item permanece em lote FINALIZADO sem dado de pagamento, com alertas de duplicidade descartadas e pendência afirmando remoção. Quebra a invariante "ou comita tudo ou nada".
- **Impacto de negócio**: título sem destino pode seguir para remessa com o gate de duplicidade já neutralizado; trilha de auditoria desmente o estado real. O envio reconfere o destino ao vivo (I10a), o que mitiga o pior caso.
- **Métrica de baseline**: 1 callsite, 0 verificações do retorno; janela = tempo entre a leitura do lote e a transação (uma rodada de verificação).

### F-fault-tolerance-2: guarda de conferência da remessa lê o lote antes das chamadas ao ERP; devolução concorrente só é detectada no fim

- **Severidade**: P2
- **Tactic violada**: Timestamp (checagem de versão tardia) / Compensating Transaction
- **Localização**: `RemessaService.ts:256` e `:716-727`
- **Evidência (objetiva)**:
  ```
  if (this.conferencia.exigeConferencia(lote) && !lote.conferidoPor) throw ...  // leitura inicial
  ... setRemessaGerada(...) ; transicionar({ versaoEsperada: lote.versao })       // CAS só no fim
  ```
  `devolver` bumpa `versao`; a transição falha, mas o `.REM` já foi gerado no ERP e `setRemessaGerada` já gravou (duas escritas não atômicas, preexistente).
- **Impacto técnico**: remessa órfã no ERP com lote de volta em RASCUNHO; o ledger/chave de idempotência impede duplo envio, mas o estado local diverge.
- **Impacto de negócio**: retrabalho manual do analista para reconciliar gabCod; sem dinheiro movido (o envio ao banco é etapa posterior).
- **Métrica de baseline**: 1 janela de corrida (devolver x gerar remessa), 0 testes cobrindo-a; 0 pagamentos expostos.

### F-fault-tolerance-3: finalizar verifica pendências/alertas e transiciona sem lock que cubra a criação de alerta

- **Severidade**: P2
- **Tactic violada**: Timestamp / Quarantine
- **Localização**: `LotePagamentoService.ts` finalizarLote (~linhas 415-427); `reconciliarAlertas` não bumpa `versao`
- **Evidência (objetiva)**: gate (`exigirDuplicidadesTratadas`) e `transicionar` são operações distintas; alerta nova inserida por rodada de verificação concorrente após o gate não altera `versao`.
- **Impacto técnico**: TOCTOU de milissegundos a segundos; lote finalizado com alerta aberta.
- **Impacto de negócio**: duplicidade pode passar sem tratamento; a conferência de segunda pessoa (L12) é a segunda barreira.
- **Métrica de baseline**: 1 gate sem CAS no mesmo statement; 0 testes de concorrência.

### F-fault-tolerance-4: sem reaper/reconciliação para itens PENDENTE ou conferência esquecida

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: ausência em `src/backend/jobs/` para o delta
- **Evidência (objetiva)**: item PENDENTE só sai ao reverificar manualmente; lote FINALIZADO sem conferência não gera alerta de envelhecimento.
- **Impacto técnico**: falha fechada correta, mas sem detecção de estagnação.
- **Impacto de negócio**: lote travado em silêncio até o analista notar (atraso de pagamento, risco de multa).
- **Métrica de baseline**: 0 jobs de estagnação para o delta (1 job de perfil semanal apenas).

## 5. Cards Kanban

### [fault-tolerance-1] Tratar retorno falso da remoção pelo sistema e abortar a transação

- **Problema**
  > `retirarSemDado` ignora o `false` de `removerItemPeloSistema`; com lote finalizado no meio, descarta alertas e abre pendência RETIRADO sem remover o item.

- **Melhoria Proposta**
  > Se o retorno for `false`, lançar dentro do `withTransaction` (rollback) e tratar como item não verificável nesta passada (PENDENTE/skip). Teste de integração com lote FINALIZADO. Tactic: Rollback.

- **Resultado Esperado**
  > Estado nunca divergente entre item, alertas e pendência; callsites que ignoram o retorno: 1 → 0.

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Retorno verificado: 0/1 → 1/1
  - Teste de corrida finalizar x remoção: 0 → 1
- **Risco de não fazer**: pendências e alertas que mentem sobre o lote, corroendo a confiança na trilha de auditoria.
- **Dependências**: nenhuma

### [fault-tolerance-2] Fechar as janelas de corrida de finalizar e remessa com checagem atômica

- **Problema**
  > Gate de duplicidade (finalizar) e guarda de conferência (remessa) são lidos antes da escrita e o CAS só cobre `versao`; devolução/alerta concorrentes escapam até o fim do fluxo.

- **Melhoria Proposta**
  > Incluir `NOT EXISTS` de alerta aberta no UPDATE de finalizar (ou bumpar `versao` ao criar alerta) e `conferido_por IS NOT NULL` no UPDATE de `REMESSA_GERADA`; reordenar para reler `versao` antes do ERP. Tactic: Timestamp / Sanity Checking.

- **Resultado Esperado**
  > Corridas cobertas por teste SQL; remessas órfãs por devolução concorrente: 1 janela → 0.

- **Tactic alvo**: Timestamp
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-3
- **Métricas de sucesso**:
  - Testes de concorrência no delta: 0 → 2
- **Risco de não fazer**: incidente raro, mas caro de reconciliar manualmente.
- **Dependências**: fault-tolerance-1 (padrão de falha)

### [fault-tolerance-3] Alertar lotes com item PENDENTE ou conferência parada há mais de N horas

- **Problema**
  > Falha fechada correta, mas sem detecção de estagnação para itens PENDENTE e lotes FINALIZADOS sem conferência.

- **Melhoria Proposta**
  > Job agendado (padrão `detect-staleness`) que lista lotes nessas condições e registra em JobRun/alerta ao analista. Tactic: Condition Monitoring.

- **Resultado Esperado**
  > Lotes estagnados detectados em ≤ 1 ciclo; jobs de estagnação: 0 → 1.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Tempo de detecção de lote parado: indefinido → ≤ 4h
- **Risco de não fazer**: pagamentos atrasados sem visibilidade.
- **Dependências**: nenhuma

## 6. Notas do agente

- Pontos fortes: falha fechada consistente, transações atômicas com evento, CAS por `versao` em conferir/devolver (a corrida conferência x reabertura é resolvida em SQL: o `UPDATE ... WHERE versao` e `status='FINALIZADO'` faz um dos dois perder com `LoteVersaoConflitoError`).
- Nenhum P0 evidenciado; envio reconfere destino ao vivo, o que limita dano financeiro.
- Cross-QA: auditoria (Security), testes de corrida (Testability), timeouts dos clients (Availability/Performance). Não medi nada contra o Conexos.
