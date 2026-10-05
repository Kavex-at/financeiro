---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-fault-tolerance
generated_at: 2026-10-05T21:40:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Fault Tolerance — Regis-Review

Escopo: delta do commit `c099a55` (`limitarAoDisponivelDoAdto`, I-Write-10 / ADR-0062). Auditoria apenas do delta.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Execução de permuta (fin010) | Líquido da baixa (`bxaMnyValor + juros − desconto`) passa R$0,01 do disponível vivo do adto (`bxaMnyValorPermuta`, passo 3) e o ERP recusa no gravar ou no Finalizar | `ReconciliacaoPermutaService.baixarTitulo` → `limitarAoDisponivelDoAdto` (passos 3→4→5) | Operação normal, escrita real habilitada, baixas multi-título/N:M | Excesso ≤ R$1,00 sai da variação em uso (juros ↓ / desconto ↑), só para baixo; excesso maior ou juros negativo: não mexe e emite BUSINESS_WARN | 0 recusas por centavos; 0 divergência no ledger histórico (196 execuções: 192 IDENTICO, 3 FECHADO, 1 FORA_TETO, 0 DIVERGENTE) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Execuções reais com líquido > disponível (antes do fix) | 3 de 196 (1,5%) | 0 | ✅ corrigido pelo delta | `_shared-metrics.md` (ground truth) |
| Execuções históricas que o cap alteraria de forma divergente | 0 de 196 | 0 | ✅ | `validate-permuta-centavos-adto-v1.ts` |
| Caminhos do cap que alteram `bxaMnyValor` / resíduo / `settled` | 0 (cap só toca juros/desconto) | 0 | ✅ | `ReconciliacaoPermutaService.ts:598-609` (resíduo usa `bxaMnyValor`, não o líquido) |
| Testes novos cobrindo o cap | 4 (multi-título, caps, fora de tolerância etc.) | ≥ 1 por ramo | ✅ | `ReconciliacaoPermutaService.test.ts:1433+` |
| Ramo "fora de tolerância" com sinalização durável (não só log) | 0 (apenas `logService.warn`) | durável | ⚠️ | `ReconciliacaoPermutaService.ts` (`limitarAoDisponivelDoAdto`) |
| Ausência de `bxaMnyValorPermuta` com log | 0 (retorno silencioso) | log | ⚠️ | `if (p.bxaMnyValorPermuta === undefined) return` |
| Rollback / idempotência do job de validação | read-only, zero chamadas ao ERP | read-only | ✅ | `validate-permuta-centavos-adto-v1.ts` |
| Infra (DLQ, timeouts) | ⚠️ Não medível: sem `infra/` neste repo | n/a | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Teto absoluto R$1,00 (`ToleranciaResiduo.LIMITE_BRL`), só corta para baixo, bloqueia juros negativo | ✅ presente | `limitarAoDisponivelDoAdto` |
| Comparison | Compara líquido calculado com disponível vivo do ERP (passo 3) antes de gravar | ✅ presente | `excesso = round2(líquido − bxaMnyValorPermuta)` |
| Timestamp | N/A: não relevante ao delta (sem ordenação nova) | N/A | n/a |
| Timeout / Condition Monitoring | Sem chamada nova ao ERP; BUSINESS_INFO/WARN com contexto (adto, invoice, titCod, excesso) | ⚠️ parcial | logs em `limitarAoDisponivelDoAdto` |
| Idempotent Replay | Cap é função pura do estado vivo (passo 3 relido a cada tentativa); `setRequestPayload` grava o payload já limitado | ✅ presente | `ReconciliacaoPermutaService.ts:907-915` |
| Rollback / Compensating Transaction | N/A: fin010 sem undo; política de forward recovery (resíduo → `markParcial`) intacta | N/A | I-Write-8b |
| Repair State / Reconcile | `jurosTotal/descontoTotal` do ledger recebem o valor EFETIVAMENTE postado (pós-cap); resíduo independe do cap | ✅ presente | linhas 598-609 |
| Quarantine / Escalation | Ramo fora de tolerância só loga; confia que o ERP recusa e a analista confere | ⚠️ parcial | F-fault-tolerance-1 |
| Substitution / Predictive Model | Prevenção do erro na origem (cap antes do passo 4) em vez de reagir à recusa | ✅ presente | ADR-0062 |

## 4. Findings (achados)

Conclusão principal: **nenhum P0**. O cap não corrompe o resíduo (calculado sobre `bxaMnyValor` em USD, não sobre o líquido) nem o status `settled`/`parcial`; o ledger registra o juros/desconto realmente enviado; o contabilmente-lançado (comentário, payload, passo 4 e 5) usa os mesmos valores pós-cap.

### F-fault-tolerance-1: Ramo "fora de tolerância" apenas loga, sem sinalização durável

- **Severidade**: P3
- **Tactic violada**: Quarantine
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` (`limitarAoDisponivelDoAdto`, ramo `excesso > limiteResiduo || jurosTeto < 0`)
- **Evidência (objetiva)**:
  ```
  await this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'líquido da baixa acima do disponível ... NÃO ajustado' ...});
  return { juros, desconto };
  ```
  Ground truth: 1 de 196 execuções (borderô 2646, excesso R$921k) cai nesse ramo.
- **Impacto técnico**: segue para o passo 5 sabendo que o ERP deve recusar; se recusar só no Finalizar, o item fica pendente sem marca no ledger além do log.
- **Impacto de negócio**: analista descobre pelo erro do ERP, não por uma fila de exceção; retrabalho pontual (frequência observada 0,5%).
- **Métrica de baseline**: 1/196 execuções (0,5%) no ramo; 0 sinalizações duráveis.

### F-fault-tolerance-2: Ausência de `bxaMnyValorPermuta` desativa o cap sem rastro

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `ReconciliacaoPermutaService.ts` (`if (p.bxaMnyValorPermuta === undefined) return { juros, desconto };`)
- **Evidência (objetiva)**:
  ```
  if (p.bxaMnyValorPermuta === undefined) return { juros, desconto };
  ```
- **Impacto técnico**: se o ERP mudar o contrato do passo 3 e omitir o campo, a proteção some silenciosamente e voltam as recusas por R$0,01.
- **Impacto de negócio**: regressão invisível do defeito de 3/196 (1,5%) execuções.
- **Métrica de baseline**: 0 logs hoje nesse ramo.

## 5. Cards Kanban

### [fault-tolerance-1] Registrar de forma durável baixas acima do disponível fora da tolerância

- **Problema**
  > Quando o líquido excede o disponível do adto em mais de R$1,00 (ou o juros ficaria negativo), o cap só emite BUSINESS_WARN e segue para o ERP, que deve recusar. Observado em 1 de 196 execuções (borderô 2646).

- **Melhoria Proposta**
  > Alternativa: abortar a baixa antes do passo 5 com erro tipado (forward recovery) e encaminhar à fila de exceção da analista, em vez de depender da recusa do ERP. Tactic: Quarantine. Tocar `limitarAoDisponivelDoAdto` e o tratamento do erro em `ReconciliacaoPermutaService`.

- **Resultado Esperado**
  > Item fora de tolerância fica visível na fila de exceção sem depender de ler log: sinalizações duráveis 0 → 100% dos casos.

- **Tactic alvo**: Quarantine
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Casos fora de tolerância com registro durável: 0% → 100%
- **Risco de não fazer**: casos raros continuam dependendo de leitura de log ou do erro do ERP.
- **Dependências**: decisão do produto sobre abortar vs. seguir (ADR-0062).

### [fault-tolerance-2] Logar quando `bxaMnyValorPermuta` vier ausente no passo 3

- **Problema**
  > O cap retorna sem aviso se o ERP omitir `bxaMnyValorPermuta`; uma mudança de contrato desligaria a proteção sem rastro.

- **Melhoria Proposta**
  > Emitir BUSINESS_WARN (uma linha) no retorno antecipado e adicionar teste. Tactic: Condition Monitoring.

- **Resultado Esperado**
  > Desativação do cap observável em log: 0 → 1 evento por ocorrência.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Logs no ramo sem disponível: 0 → 1 por ocorrência
- **Risco de não fazer**: regressão silenciosa do defeito de centavos em 6 meses.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Delta apenas; sem auditoria de SQS, DLQ, reaper ou reconciliação (fora do escopo, sem `infra/`).
- Verificado: o resíduo (`residuoUsd`) e `markParcial/settled` usam `bxaMnyValor` e `restanteUsd`; o cap só altera juros/desconto, que alimentam `jurosTotal/descontoTotal` com o valor realmente postado.
- Cross-QA: testes (Testability) cobrem 4 cenários; log estruturado (Security/auditabilidade) registra a variação absorvida em BUSINESS_INFO.
