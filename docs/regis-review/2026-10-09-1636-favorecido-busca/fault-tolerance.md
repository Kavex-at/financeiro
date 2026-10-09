---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-fault-tolerance
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 9
findings_count: 2
cards_count: 1
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista que pede a autorização de um favorecido | Conexos `cmn025/list` lento, fora ou devolvendo linha malformada durante a busca; digitação rápida | `PayeeSearchService`, `ConexosSispagClient.buscarPessoas`, rota `POST .../busca`, `GET .../destino-atual`, `SolicitarAutorizacaoDialog` | Operação normal, Conexos degradado | Falha propagada como erro visível; nenhuma escrita parcial; resposta velha não sobrepõe a nova | 0 escritas (local ou ERP) no delta; 0 estados presos; erro exibido em 100% das falhas de leitura |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas (DB/ERP) introduzidas pelo delta | 0 (busca e prévia são read-only) | 0 para leitura | ✅ | `PayeeSearchService.ts`, `AuthorizedPayeeService.destinoAtual` |
| Endpoints novos que mutam estado sem chave de idempotência | 0 de 2 (ambos read-only) | 0 | ✅ | `routes/sispag.ts` (diff) |
| Leituras Conexos novas sob `runWithRetry` | 1 de 1 (`buscarPessoas`) | 100% | ✅ | `ConexosSispagClient.ts` `ler` |
| Linhas malformadas descartadas em vez de quebrar a busca | sim (`mapPessoa` devolve `undefined`) | sim | ✅ | `ConexosSispagClient.ts` `mapPessoa` |
| Validação Zod da linha do `cmn025` | `pessoaRowSchema` + `documentoSchema` | 100% | ✅ | `ConexosSispagClient.ts` |
| Cancelamento de requisições obsoletas no frontend | `AbortController` na busca e na prévia | presente | ✅ | `SolicitarAutorizacaoDialog.tsx:136,157` |
| Erro de leitura exibido ao usuário | busca e prévia têm estado `erro`; sem laço de nova busca | 100% | ✅ | `SolicitarAutorizacaoDialog.tsx:142-163` |
| Timeout explícito na chamada nova | herdado do `ConexosBaseClient`; não verificado no delta | explícito | ⚠️ | F-fault-tolerance-1 |
| Falha de `listarVigentesPorPesCods` | busca inteira falha (500), sem degradar | aceitável p/ read-only | ⚠️ | `PayeeSearchService.ts` |
| Limite de taxa server-side na busca | 0 (só debounce 350 ms no cliente) | presente | ⚠️ | `_shared-metrics.md` |
| Reaper de estado preso / reconciliação | N/A ao delta (sem estado novo) | N/A | N/A | — |
| Testes de falha (linha inválida, abort, erro) | presentes em `ConexosSispagClient.test.ts`, `SolicitarAutorizacaoDialog.test.tsx`, `PayeeSearchService.test.ts` | presente | ✅ | `_shared-metrics.md` (diálogo 25/25) |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod na linha de pessoa e no documento; descarta o que foge do schema | ✅ presente | `pessoaRowSchema`, `mapPessoa` |
| Timeout | herdado do base client, não alterado | ⚠️ parcial | `ConexosBaseClient` (fora do delta) |
| Condition Monitoring | flag `truncado` sinaliza resultado cortado (count > rows) | ✅ presente | `buscarPessoas` |
| Comparison | duas leituras de documento (dígitos e formatado) como fallback | ✅ presente | `buscarPessoas` |
| Idempotent Replay | retry seguro: leitura pura, sem efeito | ✅ presente | `runWithRetry` em `ler` |
| Rollback / Compensating Transaction | N/A: não há escrita no delta | N/A | — |
| Reconcile / Quarantine / DLQ | N/A: sem fila nem estado novo | N/A | — |
| Redundancy / Escalating Restart | N/A: sem novo processo | N/A | — |
| Audit trail | N/A: leitura sem mutação; a revelação do destino (I14l) é rota não alterada | N/A | — |
| Forward recovery (UI) | erro mostrado, usuário refaz a busca; AbortController evita resposta fora de ordem | ✅ presente | `SolicitarAutorizacaoDialog.tsx` |

## 4. Findings

### F-fault-tolerance-1: Timeout da busca no Conexos não verificado no delta
- **Severidade**: P2
- **Tactic violada**: Timeout
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts` (`buscarPessoas`, `ler`)
- **Evidência (objetiva)**:
  ```
  this.base.runWithRetry(() => this.base.listGenericPaginated(... 'cmn025/list' ...))
  // sem timeout próprio; até 3 leituras sequenciais por busca de documento (2 + fallback formatado)
  ```
- **Impacto técnico**: busca por documento ausente faz 3 leituras sequenciais, cada uma com retry; com Conexos lento as latências se somam.
- **Impacto de negócio**: pedido de autorização travado na tela; sem perda de dado.
- **Métrica de baseline**: pior caso 3 leituras x tentativas de retry por termo (não medido ao vivo; HML recusou a credencial).

### F-fault-tolerance-2: Sem limite de taxa server-side na busca
- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/routes/sispag.ts` (rota `/favorecidos-autorizados/busca`)
- **Evidência (objetiva)**:
  ```
  _shared-metrics.md: "Sem limite de taxa específico na rota de busca além do debounce do frontend"
  ```
- **Impacto técnico**: cliente descuidado pode consumir sessões/limite do Conexos (teto de sessões já sensível).
- **Impacto de negócio**: baixo; rota exige `sispag:executar`.
- **Métrica de baseline**: 0 limites server-side; debounce de 350 ms no cliente.

## 5. Cards Kanban

### [fault-tolerance-1] Confirmar timeout e orçamento de leituras da busca de favorecido

- **Problema**
  > A busca por documento pode fazer até 3 leituras sequenciais ao `cmn025` sob `runWithRetry`, sem timeout verificado no delta. Conexos lento prende o diálogo.

- **Melhoria Proposta**
  > Confirmar o timeout do `ConexosBaseClient` para `listGenericPaginated`; se ausente, definir teto total da busca (tactic Timeout). Opcional: limite de taxa por usuário na rota `/busca`.

- **Resultado Esperado**
  > Busca falha com mensagem em tempo limitado (alvo: no máximo 15 s no pior caso) em vez de esperar indefinidamente.

- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Timeout total da busca: não verificado -> explícito e testado
  - Limite de taxa server-side: 0 -> 1 (opcional)
- **Risco de não fazer**: diálogo travado em incidente do Conexos; baixo, sem corrupção de dado.
- **Dependências**: nenhuma

## 6. Notas do agente

- O delta é inteiramente read-only: sem escrita DB/ERP, fila, DLQ ou estado novo; idempotência, transação, outbox, reaper e reconciliação são N/A. Zero P0/P1.
- Semântica do `#LIKE` e formato de `pdcDocFederal` não medidos ao vivo (HML recusou credencial); a busca degrada para menos resultados, sem erro.
- Cross-QA: timeout e rate limit com Availability e Performance; mascaramento do documento com Security.
