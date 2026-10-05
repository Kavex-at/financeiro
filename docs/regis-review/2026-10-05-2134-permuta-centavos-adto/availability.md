---
qa: Availability
qa_slug: availability
run_id: 2026-10-05-2134
agent: qa-availability
generated_at: 2026-10-05T21:45:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Availability — Regis-Review

> Delta-scoped (commit c099a55, `--quick`). Avalia `limitarAoDisponivelDoAdto` e a interação com `baixarTitulo`. Não é auditoria do repo.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Execução automática de permuta (Front I) | Soma do líquido de uma baixa excede em R$0,01 o `bxaMnyValorPermuta` do adto (arredondamento de taxa), e o ERP recusa no gravar/Finalizar | `ReconciliacaoPermutaService.baixarTitulo` → fin010 passos 3-5 | Operação normal, borderô em montagem | Detectar o excesso antes do passo 4, absorvê-lo na variação cambial (≤ R$1,00) ou, se maior, não mexer e avisar (BUSINESS_WARN) | 3 de 196 execuções reais (1,5%) com recusa por centavos → 0; 0 DIVERGENTE no ledger; nenhuma escrita extra ao ERP |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Typecheck / lint / testes backend | 0 erros / 0 erros (78 warnings pré-existentes) / 3773 testes passando | verde | ✅ | `_shared-metrics.md` |
| Testes novos I-Write-10 | 4 (arquivo: 54 testes) | cobrir teto, excesso > R$1, juros negativo, sem disponível | ✅ | `ReconciliacaoPermutaService.test.ts` |
| Ground truth no ledger de produção | 196 execuções: 192 IDENTICO, 3 FECHADO, 1 FORA_TETO, 0 DIVERGENTE | 0 divergente | ✅ | `jobs/validate-permuta-centavos-adto-v1.ts` (somente leitura) |
| Execuções recusadas pelo ERP por centavos acima do disponível | 3 / 196 (1,5%) antes do fix | 0 | ⚠️ (mitigado pelo delta, não reconfirmado em produção) | `_shared-metrics.md` |
| Chamadas externas novas no delta | 0 (função pura + `logService`) | 0 | ✅ | `ReconciliacaoPermutaService.ts:1010-1056` |
| Cobertura de Executor em IO externo no delta | N/A, delta sem IO novo | — | ✅ | idem |
| DLQ / alarmes / timeouts (Terraform) | ⚠️ **Não medível localmente**: não existe `infra/` (deploy Render). Fora do delta. | ≥5 alarmes, 100% DLQ | ⚠️ | CLAUDE.md |
| Idempotência da baixa | Chave `key` com `setRequestPayload` antes de `gravarBaixaPermuta` (pré-existente, inalterada) | presente | ✅ | `ReconciliacaoPermutaService.ts:~905-910` |
| Guarda de transição de estado | Inalterada pelo delta | — | ✅ | — |
| Referências a `shared_account_id` no delta | 0 | 0 | ✅ | diff do commit |
| MTTR real / taxa de recusa em produção pós-deploy | ⚠️ **Não medível localmente**: requer logs de produção. Recomendação: contar `BUSINESS_INFO 'LIMITADA'` e `BUSINESS_WARN 'fora da tolerância'` por semana no painel de operação. | — | ⚠️ | — |

## 3. Tactics — Cobertura no financeiro (escopo: delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Não tocado pelo delta; sem health-probe de Conexos neste fluxo | N/A | fora do delta |
| Heartbeat | Sem scheduler/heartbeat no escopo | N/A | CLAUDE.md (jobs manuais) |
| Monitor | `BUSINESS_INFO`/`BUSINESS_WARN` estruturados com ctx (adto, invoice, titCod, excesso); sem alarme | ⚠️ parcial | `ReconciliacaoPermutaService.ts:1030-1052` |
| Timestamp | Não aplicável ao delta | N/A | — |
| Sanity Checking | Compara líquido vs disponível vivo do ERP (passo 3) antes de gravar; teto absoluto R$1,00; recusa juros negativo | ✅ presente | `:1018-1043` |
| Condition Monitoring | O disponível é relido a cada baixa (`validarTituloPermuta`) | ✅ presente | `:840-855` |
| Voting | Sem componentes redundantes | N/A | — |
| Exception Detection | `assertNoErpError` nos passos; excesso grande vira WARN, sem swallow | ✅ presente | `:849, 1039` |
| Self-Test | Job `validate-permuta-centavos-adto-v1` reproduz a regra contra o ledger real, só leitura | ✅ presente | `jobs/validate-permuta-centavos-adto-v1.ts` |
| Active Redundancy | Não aplicável (SaaSo Render, sem redundância ativa de ERP) | N/A | — |
| Passive Redundancy | Idem | N/A | — |
| Spare | Idem | N/A | — |
| Exception Handling | Excesso fora da tolerância mantém valores e deixa o ERP recusar; analista confere | ⚠️ parcial | `:1039-1048` |
| Rollback | Delta não altera; sem compensação de baixa já gravada | ❌ ausente (fora do delta) | — |
| Software Upgrade | Fix pontual, ADR-0062, versão bumpada | ✅ presente | ADR 0062 |
| Retry | Não alterado; `bxaMnyValorPermuta` é relido a cada tentativa, então o teto é recalculado | ✅ presente | `:840` |
| Ignore Faulty Behavior | Resíduo ≤ R$1 absorvido na variação (ignora a falha de arredondamento) | ✅ presente | `:1050-1055` |
| Degradation | Item não ajustável cai no WARN + conferência manual da analista | ⚠️ parcial | `:1039` |
| Reconfiguration | Não aplicável | N/A | — |
| Shadow | Job de validação roda a regra em "sombra" sobre o ledger antes do deploy | ✅ presente | `validate-permuta-centavos-adto-v1.ts:54` |
| State Resynchronization | Disponível do adto é lido do ERP a cada baixa, nunca de cache local | ✅ presente | `:840-855` |
| Escalating Restart | Não aplicável | N/A | — |
| Non-Stop Forwarding | Não aplicável | N/A | — |
| Removal from Service | Não tocado | N/A | — |
| Transactions | Gravar baixa é uma chamada; o gate `setRequestPayload` precede. Sem atomicidade multi-perna | ⚠️ parcial | `:900-915` |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | Teto previne a recusa do ERP no Finalizar por centavos (3 casos reais) | ✅ presente | `:875-890` |
| Increase Competence Set | Cobre última perna N:M e invoice multi-título que a âncora não alcançava | ✅ presente | `:870-873` |

## 4. Findings (achados)

### F-availability-1: Excesso fora da tolerância só gera WARN, sem sinal acionável

- **Severidade**: P2
- **Tactic violada**: Monitor
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:1039-1048`
- **Evidência (objetiva)**:
  ```
  if (excesso > limiteResiduo || jurosTeto < 0) { logService.warn(BUSINESS_WARN ...); return { juros, desconto }; }
  ```
  Ledger: 1 FORA_TETO (borderô 2646, excesso R$921k) não tocado.
- **Impacto técnico**: o caminho conhecido de falha (o ERP deve recusar) depende de alguém ler o log. Não é defeito introduzido: o comportamento "não mexer" é deliberado e seguro (não há dupla escrita nem corte indevido).
- **Impacto de negócio**: a analista descobre a recusa só ao Finalizar, com retrabalho. Sem perda financeira.
- **Métrica de baseline**: 1 de 196 execuções (0,5%) em FORA_TETO.

### F-availability-2: Retentativa após gravação parcial reduz o disponível lido e cai no ramo WARN

- **Severidade**: P3
- **Tactic violada**: Rollback
- **Localização**: `ReconciliacaoPermutaService.ts:840-890`
- **Evidência (objetiva)**: o `bxaMnyValorPermuta` já desconta pernas gravadas no mesmo `borCod` (docstring `:1002-1008`). Se uma perna foi gravada e a resposta se perdeu, a releitura mostra disponível menor; o excesso fica igual ao valor da perna (> R$1), então o código só avisa e não altera. O comportamento é seguro (não duplica nem corta), mas o reaproveitamento depende do gate de idempotência pré-existente. Não encontrei defeito exposto.
- **Impacto técnico**: nenhuma regressão; o delta falha de forma fechada.
- **Impacto de negócio**: eventual conferência manual.
- **Métrica de baseline**: 0 casos observados no ledger (0 DIVERGENTE em 196).

## 5. Cards Kanban

### [availability-1] Alarmar BUSINESS_WARN de teto do adto e contar LIMITADA vs FORA_TETO

- **Problema**
  > O ramo "líquido acima do disponível e fora da tolerância" só escreve BUSINESS_WARN. A recusa do ERP é descoberta no Finalizar pela analista (1 de 196 execuções no ledger).

- **Melhoria Proposta**
  > Monitor: expor no painel de operação a contagem semanal de `LIMITADA` (INFO) e `fora da tolerância` (WARN) por tenant, com aviso à analista no borderô afetado. Tocar `LogService`/painel, sem mudar `limitarAoDisponivelDoAdto`.

- **Resultado Esperado**
  > Casos FORA_TETO visíveis antes do Finalizar: 0% visibilidade proativa → 100%.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Borderôs FORA_TETO sinalizados antes do Finalizar: 0% → 100%
- **Risco de não fazer**: retrabalho manual recorrente da analista, sem dado para medir a taxa real.
- **Dependências**: nenhuma.

### [availability-2] Teste de retentativa após perna já gravada (disponível reduzido)

- **Problema**
  > Não há teste que prove que, com disponível já reduzido pela perna gravada, o teto não ajusta nada (excesso > R$1 → só WARN). O comportamento hoje é correto por inspeção.

- **Melhoria Proposta**
  > Exception Handling/Retry: acrescentar um teste em `ReconciliacaoPermutaService.test.ts` em que `bxaMnyValorPermuta` seja menor que o líquido por mais de R$1 e `juros/desconto` voltem intactos, junto da confirmação do gate de idempotência.

- **Resultado Esperado**
  > Cobertura do cenário de retentativa: 0 → 1 teste, protegendo contra ajuste silencioso futuro.

- **Tactic alvo**: Retry
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Testes do cenário de retentativa: 0 → 1
- **Risco de não fazer**: uma mudança futura no teto poderia gravar valor errado numa retentativa sem ser pega.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: só o delta. Sem P0: a função é pura, sem IO novo nem timeout/DLQ/executor novos, falha de forma fechada e valida 0 DIVERGENTE em 196 execuções reais.
- Infra/Terraform não existe no repo (métricas de DLQ, alarmes e timeouts não medíveis); `--quick`, testes não reexecutados (baseline do `_shared-metrics.md`).
- Cross-QA: testability (4 testes novos, job de validação) e fault-tolerance (execução parcial multi-perna sem compensação).
