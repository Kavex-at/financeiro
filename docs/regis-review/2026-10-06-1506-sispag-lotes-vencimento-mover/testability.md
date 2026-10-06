---
qa: Testability
qa_slug: testability
run_id: 2026-10-06-1506
agent: qa-testability
generated_at: 2026-10-06T15:30:00-03:00
scope: all
score: 6.5
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review (delta 1e68bd7..HEAD, sispag-lotes-vencimento-mover)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/AutoLoopRunner | Mudança na regra de mover título entre lotes (ADR-0064) | LotePagamentoService.incluirTitulo, LotePagamentoRepository (SQL novo), UI de mover | CI/unit | Regressão detectada por teste sem DB real | 100% dos ramos da regra com teste; SQL novo exercitado ao menos uma vez em PG real |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| #1 Cobertura por camada (delta) — service | 4 arquivos de service alterados, 4 com teste alterado (100%) | ≥80% linhas | ✅ (qualitativo; coverage run não executado, escopo delta) | diff --stat |
| #1 repository (delta) | 0 de 1 arquivo com teste; 4 métodos SQL novos, 0 testes de integração | ≥1 integração por repo com SQL complexo | ❌ | diff --stat |
| #1 routes (delta) | 1/1 com teste (+32 linhas) | >0 | ✅ | routes/sispag.test.ts |
| #1 frontend helpers puros | moverParaLote.ts testado (72 linhas de teste) | >0 | ✅ | moverParaLote.test.ts |
| #1 frontend hook/componente | useCriarLoteManual.ts (112 LOC) e MoverParaLoteDialog.tsx (99 LOC): 0 testes | >0 | ❌ | diff --stat |
| Ramos novos de incluirTitulo testados | 5 casos (mover feliz, origem não-rascunho, sem mover/I3, solto, comprometido) | todos | ⚠️ falta asserção do caso "origem fica vazia -> cancelada" | LotePagamentoService.test.ts |
| Leitura de tempo/aleatoriedade nova no source | 0 `Date`/random no delta de FormacaoLotesService | 0 | ✅ | grep no diff |
| Transição RASCUNHO->CANCELADO (origem vazia) | só via mock do repo | 100% real | ⚠️ | service test |

## 3. Tactics

| Tactic | Implementação | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Repo com métodos pequenos e nomeados (`loteComprometidoComTitulo`, `removerItemDeRascunho`), mockáveis via DI | ✅ | LotePagamentoRepository.ts |
| Recordable Test Cases | N/A: sem cliente externo novo no delta | N/A | — |
| Sandbox | PG real para o SQL novo ausente | ❌ | sem teste de integração |
| Executable Assertions | rowCount 0 em `removerItemDeRascunho` aborta o movimento | ✅ | LotePagamentoService.retirarDaOrigem |
| Abstract Data Sources | Repo/DB injetados; `withAdvisoryLock`/`withTransaction` mockáveis | ✅ | tests do service |
| Limit Structural Complexity | `incluirTitulo` ganhou 3 ramos aninhados na transação; `retirarDaOrigem` extraído | ⚠️ | LotePagamentoService.ts |
| Limit Non-Determinism | Sem relógio/random novo; `now()` fica no SQL de `cancelarSeVazio` | ✅ | diff |

## 4. Findings

- F1 (P1): 4 métodos SQL novos (`loteComprometidoComTitulo`, `listTitulosEmLotesComprometidos`, `removerItemDeRascunho`, `cancelarSeVazio`) sem teste real. O guard de "título comprometido" impede mover pagamento já a caminho do banco; os testes de service o provam só com repo mockado, então `ANY($status)` com array em parâmetro nomeado, o `DELETE ... USING` e o `NOT EXISTS` nunca foram executados. Erro de SQL passa verde.
- F2 (P1): corrida do mover (origem sai de RASCUNHO no meio) testada só com stub retornando 0; a atomicidade (rollback do DELETE se o INSERT falhar) não é verificável sem PG.
- F3 (P2): `useCriarLoteManual` (fluxo de mover, tratamento do erro de lote comprometido) e `MoverParaLoteDialog` sem teste de componente; só os helpers puros estão cobertos.
- F4 (P2): caso "origem fica vazia -> cancelada" (`origemCancelada: true`, audit `moverTitulo` vs `incluirTitulo`) sem asserção dedicada entre os 5 casos.
- F5 (P3): sem teste de propriedade para o agrupamento filial x vencimento com boletos juntos (`fast-check` só é usado no frontend).

Nenhum P0: o caminho de escrita novo tem teste unitário nos ramos principais; rota e painel cobertos.

## 5. Cards Kanban

### [P1] Teste de integração do SQL de lotes comprometidos e mover
**Problema:** 4 métodos SQL novos sem execução em Postgres; o guard de lote comprometido só é provado com mock.
**Melhoria Proposta:** suíte `describe('integration: LotePagamentoRepository')` contra PG de teste cobrindo os 4 métodos, incluindo rollback transacional do mover.
**Resultado Esperado:** casos de integração do repo 0 -> 6; métodos SQL novos executados em PG real 0/4 -> 4/4.

### [P1] Teste de atomicidade/concorrência do mover
**Problema:** rowCount 0 e rollback apenas simulados.
**Melhoria Proposta:** caso de integração com dois `incluirTitulo` concorrentes sobre o mesmo título e origem finalizada em paralelo.
**Resultado Esperado:** cenários de corrida testados 0 -> 2; itens duplicados em lotes 0.

### [P2] Testes de componente para hook e dialog de mover
**Problema:** `useCriarLoteManual` e `MoverParaLoteDialog` (211 LOC) sem teste.
**Melhoria Proposta:** Testing Library: mover confirmado, erro de lote comprometido, origem vazia.
**Resultado Esperado:** arquivos de teste em `app/sispag/components` +2; casos +6; cobertura do diretório ~35% -> >=70%.

### [P3] Property test de agrupamento filial x vencimento
**Problema:** só exemplos fixos.
**Melhoria Proposta:** fast-check para invariantes (nenhum lote mistura filial/vencimento; boletos ficam juntos ao dividir).
**Resultado Esperado:** property tests em FormacaoLotesService 0 -> 2.

## 6. Cross-QA

- Fault Tolerance: atomicidade do mover e transições do lote (RASCUNHO->CANCELADO).
- Deployability: sem gate de integração com PG no CI para o repositório.
- Modifiability: relógio fica no SQL (`now()`), sem ClockProvider.
