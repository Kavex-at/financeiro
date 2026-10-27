---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-27-1803-sispag-vinculo-data-divergente
agent: qa-fault-tolerance
generated_at: 2026-10-27T18:03:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 2
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista do SISPAG confirmando sugestão com Δ ∈ [-10,-1]∪[6,10] e valor igual | A tela caiu, o pool DDA mudou entre leitura e confirmação, ou o POST foi reenviado | `BoletoSuggestionService.confirmar` + decisão + reconhecimento + evento, numa transação Postgres | Operação normal, sob single-flight do cache do cenário | Reconhecimento tipado é conferido contra o Δ/valor RECALCULADOS ao vivo e gravado na MESMA transação que a decisão e o evento; se o motor mudou, falha fechada (`DivergenceAcknowledgementStaleError`) sem gravar | 0 decisões `CONFIRMADA` com `reconhecimento` desatualizado; 0 decisões sem o evento `DECISAO_CONFIRMADA` pareado; invariante `reconhecimento_tudo_ou_nada` cumprida pelo CHECK |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escrita de ack + decisão + evento na mesma transação | 100% (único call-site: `BoletoSuggestionService.confirmar`) | 100% | ✅ | `src/backend/domain/service/sispag/BoletoSuggestionService.ts:351-465` |
| Ack conferido contra avaliação RECALCULADA (anti-TOCTOU) | sim | sim | ✅ | `ConferenciaReconhecimento.ts:46-75`; `BoletoSuggestionService.ts:305-331` |
| Invariante tudo-ou-nada do reconhecimento no schema | CHECK presente | CHECK | ✅ | `migrations/0091_sispag_reconhecimento_divergencia.sql:43-63` |
| Invariante caminho-coerente do vínculo (`DATA_DIVERGENTE ⇒ reconhecimento_id`) | CHECK presente | CHECK | ✅ | `migrations/0091_...sql:124-144` |
| FK `vinculo_reconhecimento_id → sispag_decisao_sugestao_boleto(id)` | ON DELETE default (RESTRICT) | RESTRICT | ✅ | `migrations/0091_...sql:108-109` |
| Fail-closed na tela quando validade do ack é desconhecida (`reconhecimentoValido` ausente) | `undefined → UI trata como inválido` | fail-closed | ✅ | `BoletoSuggestionService.ts:496-510`; `SugestaoBoletoPainel.tsx` |
| `prazoBoleto` fail-closed (sem desfecho → prazo = vencimento do título, nunca puxa) | sim | sim | ✅ | `PrazoBoletoCalculador.ts:32-53` |
| Fator-de-vencimento recusa empate / fora de tolerância | retorna `undefined` | fail-closed | ✅ | `FatorVencimentoBoleto.ts:37-52` |
| Idempotência de `confirmar` sob redelivery/duplo-POST | garantida pelo `inserirDecisao` (unicidade por `(ddcCod,ditCod)` + `mesmoTitulo` → `criada:false`) | idempotente | ✅ | `BoletoSuggestionService.ts:260-275, 404-425` |
| Cobertura de testes do caminho novo (ack + stale + órfã) | 312 suites / 6140 testes verdes (back) | verde | ✅ | `_shared-metrics.md` |
| Reaper de ack órfão (reconhecimento invalidado persistido mas situação virou órfã) | derivada por leitura (`SITUACAO_ORFA` + `MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO`), sem job | não medível no delta | ⚠️ | `SugestaoBoletoRepository.ts`; motor |
| `ajusteCentavos.agendarAposConfirmar` é fire-and-forget pós-commit | sem fila durável; perda em crash do processo é possível (pré-existente, ADR-0074) | — (fora de escopo do delta) | ⚠️ | `BoletoSuggestionService.ts:468-477` |

> ⚠️ **Não medível no delta**: taxa real de `DivergenceAcknowledgementStaleError` em produção. Requer CloudWatch/log central (hoje não há). Recomendação: contar a emissão desse erro no `LogService` e emitir métrica no painel de operação.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod no body da rota + CHECKs no schema (tipo, motivo 10–500, tudo-ou-nada, caminho coerente) | ✅ | `migrations/0091_...sql:30-144`; `routes/sispag.ts` |
| Comparison | Ack conferido com `(deltaDiasVisto, valorBoletoVisto) == (Δ, valor) de agora` | ✅ | `ReconhecimentoDivergencia.ts`; `ConferenciaReconhecimento.ts:66-75` |
| Timestamp | `reconhecido_em` do servidor; `anuladaEm` ordena anulações; `sincronizadoEm` do DDA | ✅ | migration 0091; `BoletoSuggestionService.ts:730` |
| Timeout | N/A no delta — nenhuma chamada externa nova; o fluxo é 100% Postgres local | N/A | — |
| Condition Monitoring | Validade do ack derivada a cada listagem via `SITUACAO_ORFA + MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO` | ✅ | `BoletoSuggestionService.ts:496-510` |
| Self-Test | Testes HML (`probe-hml-vinculo-data-divergente*`) e `hmlDataDivergenteCasos.ts` cobrem Δ=-10,-1,6,10 e empate de fator | ✅ | `jobs/probe-hml-...ts`; `jobs/hmlDataDivergenteCasos.test.ts` |
| Voting | N/A — não há réplicas | N/A | — |
| Redundancy | N/A no delta | N/A | — |
| Recovery — Rollback | `db.withTransaction` cobre decisão + evento + ack; falha em qualquer passo não grava nada parcial | ✅ | `BoletoSuggestionService.ts:351-465` |
| Recovery — Repair State | Analista anula a decisão (`anularDecisao`, idempotente) e refaz com ack novo | ✅ | `BoletoSuggestionService.ts:712-760` |
| Idempotent Replay | `inserirDecisao` devolve `{criada:false, decisao}` quando o par `(ddcCod,ditCod)` já existe; `confirmar` reavalia `reconhecimentoValido` | ✅ | `BoletoSuggestionService.ts:260-275, 404-425` |
| Compensating Transaction | `revogarPar` → cascata de anulações do par na mesma transação | ✅ | `BoletoSuggestionService.ts:646-686` |
| Reconcile | Validade do reconhecimento recomputada contra o motor a cada listagem (não há job dedicado) | ⚠️ parcial | `validadeDoReconhecimento` |
| Quarantine | `SITUACAO_ORFA` isola decisão com ack invalidado da listagem ativa | ✅ | motor + `MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO` |
| Substitution / Replacement / Predictive Model / Increase Competence Set | N/A no delta | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: `validadeDoReconhecimento` engole todos os erros silenciosamente

- **Severidade**: P2
- **Tactic violada**: Sanity Checking (log de falha vs. mascaramento)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:496-510`
- **Evidência (objetiva)**:
  ```ts
  try {
      const { valor: cenario } = await this.cache.obter(this.calcularCenario);
      ...
  } catch {
      return {};
  }
  ```
- **Impacto técnico**: um defeito no `calcularCenario` (ex.: query nova quebrada) faz TODAS as confirmações de decisão com ack retornarem `reconhecimentoValido = undefined`, que a tela trata como inválido (fail-closed). Comportamento correto, porém mudo — não há log do motivo.
- **Impacto de negócio**: a tela esconde o ack sem razão aparente; incidente silencioso. Analista reabre caso que já estava decidido.
- **Métrica de baseline**: 1 call-site `catch {}` sem `logService.warn`.

### F-fault-tolerance-2: Rota `confirmar` não exige `Idempotency-Key` no header

- **Severidade**: P3
- **Tactic violada**: Idempotent Replay (defesa em profundidade)
- **Localização**: `src/backend/routes/sispag.ts` (handler de `POST /sispag/sugestao-boleto/confirmar`) vs. `src/backend/routes/sispag.ts:1417-1425` (há `Idempotency-Key` em `remessa`/`conciliar`).
- **Evidência (objetiva)**:
  ```
  grep -n "Idempotency-Key" routes/sispag.ts
  → só em formacao, remessa, conciliar; AUSENTE no bloco de confirmação de sugestão
  ```
- **Impacto técnico**: duplo-POST acidental é hoje absorvido pela unicidade de `(ddcCod,ditCod)` + ramo `mesmoTitulo` no serviço; já é idempotente de facto. Faltar o header apenas tira defesa-em-profundidade e observabilidade da retentativa.
- **Impacto de negócio**: nenhum em condições normais; marginal em cenários de proxy que retransmite.
- **Métrica de baseline**: 0 de 1 endpoint de confirmação com `Idempotency-Key` opt-in.

### F-fault-tolerance-3: Reconciliação periódica da validade do ack é derivada, sem reaper

- **Severidade**: P3
- **Tactic violada**: Reconcile
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:496-510`, `MotorSugestaoBoleto.ts`
- **Evidência (objetiva)**: a validade só é recomputada quando o motor roda (listagem/`contextoPorTitulo`). Não há job que varra decisões `CONFIRMADA` com `reconhecimento_tipo IS NOT NULL` para contagem/alerta de ack invalidado.
- **Impacto técnico**: um título cuja validade virou falsa só é visto pelo analista ao abrir a aba. Até lá, o relatório agregado (se existir) não conhece a órfã.
- **Impacto de negócio**: baixo — o fluxo de pagamento depende da tela, não de relatórios agregados neste momento. Fase 2 (vínculo real) pode escalar isso.
- **Métrica de baseline**: 0 jobs/`EventBridge` que varrem `reconhecimento` invalidado; 1 call-site derivado.

## 5. Cards Kanban

### [fault-tolerance-1] Logar o motivo do fail-closed de `validadeDoReconhecimento`

- **Problema**
  > Quando `calcularCenario` lança, o serviço devolve `{}` sem logar — a tela mostra "reconhecimento inválido" sem motivo. Hoje nenhum alarme dispara.
- **Melhoria Proposta**
  > No `catch`, emitir `logService.warn({type: BUSINESS_WARN, message: 'validade_reconhecimento_indefinida', data: {decisaoId, erro}})`. Manter o retorno `{}` (fail-closed na tela).
- **Resultado Esperado**
  > 100% das vezes em que `reconhecimentoValido` sai `undefined` por erro ficam no log central, com `decisaoId` e `erro`.
- **Tactic alvo**: Sanity Checking (observabilidade)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Erros silenciados em `validadeDoReconhecimento`: 100% → 0%
- **Risco de não fazer**: incidente silencioso durante fase 2 do ADR-0078, quando o `vinculo_caminho = DATA_DIVERGENTE` passa a depender diretamente desse derivado.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Aceitar `Idempotency-Key` na rota de confirmação de sugestão

- **Problema**
  > A rota `POST /sispag/sugestao-boleto/confirmar` não lê `Idempotency-Key`. A idempotência de facto está no serviço (unicidade `(ddcCod,ditCod)`), mas sem o header o cliente não distingue "retransmitido" de "primeiro envio".
- **Melhoria Proposta**
  > Padronizar com `formacao`/`remessa`/`conciliar`: ler o header e propagar para o `LogService` (`idempotencyKey` no `data`) para correlação de retentativas; comportamento do serviço não muda.
- **Resultado Esperado**
  > Toda confirmação registra `idempotencyKey`; dashboard pode medir taxa de retransmissão.
- **Tactic alvo**: Idempotent Replay
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Rotas de escrita SISPAG honrando `Idempotency-Key`: 3/4 → 4/4
- **Risco de não fazer**: perda de observabilidade de duplo-POST acidental em proxies.
- **Dependências**: nenhuma.

> F-fault-tolerance-3 fica sem card: a derivação por leitura já endereça o caso de uso atual e a Fase 2 pode trazer requisitos específicos de job. Registrado como inbox-material no `qa-consolidator`.

## 6. Notas do agente

- Escopo delta-only, modo `--quick`: só o que mudou em `origin/main...HEAD`. Dívidas pré-existentes (fire-and-forget do `ajusteCentavos`, ausência de DLQ no Express legado) estão registradas em `migration-debt.md` e não foram pontuadas.
- Phase 2 (vínculo real do `vinculo_caminho = DATA_DIVERGENTE`) ainda não é código em `src/`; a invariante do schema (`lote_pagamento_item_vinculo_caminho_coerente_check`) já fecha a porta no banco.
- Cross-QA: `Idempotency-Key` ⇒ Availability/Performance; CHECK de tudo-ou-nada + FK ⇒ Security (auditabilidade do ack); cobertura HML do probe ⇒ Testability.
