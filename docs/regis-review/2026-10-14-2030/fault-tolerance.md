---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-14-2030
agent: qa-fault-tolerance
generated_at: 2026-10-14T20:30:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review (delta sispag-remocao-codbar-repetido)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Processo/rede (crash, 5xx, timeout do Conexos) e analista (desfazer retenção) | Falha entre "remove/marca local" e "DELETE no rascunho nativo" ou entre o DELETE e a releitura; retomada da geração da remessa | `RetiradaCodigoBarrasService.garantir`, `LotePagamentoRepository.retirarItemPorCodigoDeBarras`, `RemessaService.sincronizarComErp`, `DuplicateResolutionService.desfazerBloqueio` | Geração real de remessa SISPAG, lote nativo aberto (ou finalizado na retomada) | Cada passo ou completa, ou fecha: ledger `error`, nada finaliza, resíduo reconhecido e limpo na retomada; nada paga título retirado nem duplica boleto | 0 remessas geradas com item retirado/duplicado dentro do delta; 0 itens perdidos sem trilha |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos locais (remove + marca + evento) em uma única transação | 1/1 | 100% | ✅ | `LotePagamentoRepository.ts:879-960` via `db.withTransaction` (`RetiradaCodigoBarrasService.ts:443-459`) |
| Idempotência da retirada local (reentrada) | 1/1: `DELETE ... RETURNING` vazio => `removido:false`, sem 2ª marca nem 2º evento; `criar` com `ON CONFLICT DO NOTHING` | 100% | ✅ | `LotePagamentoRepository.ts:900-912`, `BloqueioDuplicidadeRepository.ts` (`criar`) |
| Sucesso decidido por ausência observada (não pelo status do DELETE) | 1/1 | 100% | ✅ | `RetiradaCodigoBarrasService.ts:262-279`, `:463-487` |
| DELETE nativo sem retry cego | 1/1 (retry só na releitura) | 100% | ✅ | `RetiradaCodigoBarrasService.ts:130` |
| Falha parcial => ledger `error` + nada finaliza | 3/3 saídas (pendentes, leitura incompleta, aindaRuins) | 100% | ✅ | `RetiradaCodigoBarrasService.ts:223-231`, `:310-318`; `RemessaService.ts:846` |
| Exceção FINALIZADO nativo (não mexe em nada, aborta) | 1/1 | 100% | ✅ | `RetiradaCodigoBarrasService.ts:209-215` |
| Caminhos de desfazer cobertos pelo guard Q10 | 1 sinal (ledger `error` + substring) de 2 estados possíveis (`error`, `reconciling`/crash) | 2/2 | ⚠️ | `DuplicateResolutionService.ts:171-181` |
| Reaper/reconciliação de retenções órfãs | presente apenas via retomada manual da remessa | job | ⚠️ | n/a no delta |
| Falhas P0 (risco real de pagar boleto duplicado/perder título) | 0 | 0 | ✅ | análise acima |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Leitura truncada, item sem `itsCodSeq`, boleto local sem leitura => aborta sem retirar (I16c) | ✅ presente | `RetiradaCodigoBarrasService.ts:372-386` |
| Comparison | Releitura após DELETE confirma ausência; I16a reaplicado sobre a última leitura | ✅ presente | `:266-276`, `:304-318` |
| Condition Monitoring | Par marca ATIVA + evento do sistema reconhece resíduo; terceiro/estranho bloqueia (nunca apaga o que não reconhece) | ✅ presente | `:149-176`, `RemessaService.ts:996-1006` |
| Timestamp / Stuck-state | Sem reaper; só a retomada manual ao reexecutar a remessa | ⚠️ parcial | n/a (fora do delta) |
| Rollback / Compensating Transaction | Local-first + forward recovery documentado (ERP não desfaz; resíduo limpo na retomada) | ✅ presente (escolha explícita) | `:109-126` |
| Idempotent Replay | Retirada local reentrante; ledger por `remessa:{loteId}` | ✅ presente | `LotePagamentoRepository.ts:900-912`, `RemessaService.ts:294` |
| Reconcile | `sincronizarComErp` pergunta ao ERP, etapa `limpar_retirados` só de memória | ✅ presente | `RemessaService.ts:1008-1031` |
| Quarantine | Título retirado fica retido (marca ATIVA) até a analista desfazer; estranho => `indeterminado` | ✅ presente | `BloqueioDuplicidadeRepository.ts` (`criar`) |
| Repair State (guard de undo) | Desfazer bloqueado se a última execução real terminou com limpeza incompleta | ⚠️ parcial | `DuplicateResolutionService.ts:206-218` |
| Audit trail | Evento `ITEM_REMOVIDO_SISTEMA` + `BLOQUEIO_CRIADO` na mesma transação da remoção | ✅ presente | `LotePagamentoRepository.ts:930-950` |

## 4. Findings

### F-fault-tolerance-1: guard Q10 do desfazer não cobre execução órfã (`reconciling`/crash)

- **Severidade**: P1
- **Tactic violada**: Repair State / Quarantine
- **Localização**: `src/backend/domain/service/sispag/DuplicateResolutionService.ts:171-181`, `:206-218`
- **Evidência (objetiva)**:
  ```
  const ultima = execucoes.find((e) => !e.dryRun);
  return ultima?.status === 'error' &&
      (ultima.erroMensagem ?? '').includes(MOTIVO_LEDGER_LIMPEZA_INCOMPLETA);
  ```
  Crash do processo entre a transação local e o DELETE deixa o ledger em `reconciling`/em voo, nunca `error` com o motivo. O guard retorna `false` e o desfazer passa; a marca fica `DESFEITO`, o resíduo no rascunho nativo vira "estranho" (`RemessaService.ts:996-1006`) e o lote nativo cai em `indeterminado`. O título volta a ser elegível enquanto ainda está no rascunho nativo do lote A.
- **Impacto técnico**: o resíduo deixa de ser reconhecido; o lote A fica travado (fecha seguro) e o título pode entrar no lote B. Duplo pagamento só ocorre se alguém finalizar/gerar o rascunho A à mão no ERP.
- **Impacto de negócio**: retrabalho manual e risco residual de pagamento em duplicidade, mitigado por ação humana externa.
- **Métrica de baseline**: 1 de 2 estados de limpeza pendente cobertos pelo guard (apenas `error`; falta `reconciling`).

### F-fault-tolerance-2: reconhecimento da limpeza pendente depende de substring em `erroMensagem`

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `DuplicateResolutionService.ts:176-180`, `BoletoCodigoBarrasRetiradaIncompletaError.ts:49,108`
- **Evidência (objetiva)**: `(ultima.erroMensagem ?? '').includes(MOTIVO_LEDGER_LIMPEZA_INCOMPLETA)`; o fato "há resíduo no rascunho" é inferido de texto livre do ledger, não de estado estruturado; outra execução real posterior (p.ex. `error` por outra causa) esconde a pendência.
- **Impacto técnico**: uma execução posterior com erro diferente apaga o sinal; o guard libera o undo com resíduo ainda no rascunho.
- **Impacto de negócio**: mesmo risco residual do F-1, menos provável.
- **Métrica de baseline**: 1 sinal textual, 0 colunas estruturadas.

### F-fault-tolerance-3: encerramento por "item mantido pago" devolve o repetido ao pool

- **Severidade**: P1 (decisão de projeto declarada; guarda contra boleto pago está fora do escopo)
- **Tactic violada**: Quarantine
- **Localização**: `src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.ts` (`encerrarPorSinaisDeCodigoDeBarras`, SQL `k.ativo = FALSE OR k.pago = TRUE`), chamado em `IngestaoPagamentosService.ts:379`
- **Evidência (objetiva)**: a marca do título retirado vira `ENCERRADO` quando o mantido foi pago; o título retirado, com o mesmo código de barras, volta a ser elegível para novo lote.
- **Impacto técnico**: o mesmo boleto pode ser enviado de novo; contido apenas pela rejeição do banco a boleto já pago e pelas guardas existentes.
- **Impacto de negócio**: tentativa de pagamento duplicado/rejeição de remessa; sem perda de título.
- **Métrica de baseline**: 0 verificações de código de barras contra boleto já pago no delta (declarado fora do escopo).

## 5. Cards Kanban

### [fault-tolerance-1] Fechar o guard de desfazer para execução órfã e usar sinal estruturado

- **Problema**
  > O guard Q10 só olha a última execução real em `error` com texto. Crash entre a transação local e o DELETE deixa `reconciling`, e a analista pode desfazer a retenção com resíduo no rascunho nativo.

- **Melhoria Proposta**
  > Em `DuplicateResolutionService.limpezaPendente`, tratar `reconciling` como pendente também. Preferir o estado estruturado: existe item com par marca ATIVA + evento do sistema cujo `flpCod` nativo ainda o contém (ou coluna `limpeza_pendente` no ledger). Tactic: Repair State / Quarantine.

- **Resultado Esperado**
  > Undo bloqueado em todos os estados de limpeza pendente (1/2 -> 2/2 cobertos), com teste para `reconciling`.

- **Tactic alvo**: Quarantine
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Estados de limpeza pendente cobertos pelo guard: 1/2 -> 2/2
  - Dependência de substring de mensagem: 1 -> 0
- **Risco de não fazer**: lote travado em `indeterminado` e, se finalizado à mão, boleto pago duas vezes.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Teste de crash entre a transação local e o DELETE

- **Problema**
  > A suíte cobre falha do DELETE e releitura, mas não o processo morrendo com o ledger em `reconciling` e retomada seguida de desfazer.

- **Melhoria Proposta**
  > Adicionar teste de integração: kill simulado após `retirarLocal`, retomada, assert de limpeza do resíduo e de recusa do undo antes da limpeza. Tactic: Idempotent Replay.

- **Resultado Esperado**
  > Cenário de crash coberto (0 -> 1 teste).

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Cenários de crash cobertos: 0 -> 1
- **Risco de não fazer**: regressão silenciosa da ordem local-first.
- **Dependências**: fault-tolerance-1.

### [fault-tolerance-3] Não liberar o repetido quando o mantido foi pago sem checar o boleto

- **Problema**
  > O encerramento por "mantido pago" devolve o título retirado ao pool com o mesmo código de barras.

- **Melhoria Proposta**
  > Condicionar o encerramento à guarda contra boleto pago (HMAC/migration já planejada) ou manter a retenção até desfazer manual. Tactic: Quarantine.

- **Resultado Esperado**
  > 0 títulos repetidos liberados sem checagem contra boleto pago.

- **Tactic alvo**: Quarantine
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Encerramentos por "mantido pago" sem checagem: 1 caminho -> 0
- **Risco de não fazer**: tentativa de pagamento do mesmo boleto duas vezes.
- **Dependências**: trabalho de guarda entre lotes/contra boleto pago (fora do escopo).

## 6. Notas do agente

- Sem P0: a ordem local-first -> DELETE -> releitura fecha em toda falha, e a retomada só apaga o que reconhece por par marca + evento; o resto aborta.
- Fora do escopo/não medível: reaper de lotes parados e reconciliação periódica não existem no repo (não há scheduler); fica em P1 pré-existente.
- Cross-QA: guard de undo e trilha do evento tocam Security (auditabilidade) e Testability (cenário de crash).
