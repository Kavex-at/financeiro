---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-06-1506
agent: qa-integrability
generated_at: 2026-10-06T15:30:00Z
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Integrability — Regis-Review (delta 1e68bd7..HEAD, sispag-lotes-vencimento-mover)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Frontend passa a usar `mover` e novo erro 409 de lote comprometido | Contrato POST /sispag/lotes/:id/itens + `lib/sispag.ts` | Operação normal | Mudança aditiva, retrocompatível, validada por Zod | 0 consumidores quebrados; flag e campo novos opcionais |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas integrações externas no delta | 0 (Conexos/Nexxera/GED intocados) | n/a | ✅ | `git diff --stat` |
| Clients tocados / HTTP direto novo em service | 0 / 0 (`fetch` só em testes de rota) | 0 | ✅ | grep no diff |
| `process.env` novo | 0 | 0 | ✅ | grep no diff |
| Zod no boundary novo | `mover: z.boolean().optional()` (routes/sispag.ts:157) + teste 400 | 100% | ✅ | routes/sispag.ts |
| Retrocompatibilidade do contrato | request opcional; `loteComprometido?` opcional na resposta | aditivo | ✅ | lib/sispag.ts |
| Versionamento da API interna | rota sem /v1 | explícito | ⚠️ | routes/sispag.ts |
| Contract test do payload 409 / `loteComprometido` | 0 de 2 caminhos novos | 2 | ⚠️ | routes/sispag.test.ts |
| Taxa de erro por dependência | ⚠️ Não medível localmente; requer produção/logs | — | ⚠️ | — |

## 3. Tactics

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Regra do mover e a tx ficam no `LotePagamentoService` + repository; rota só repassa | ✅ presente | LotePagamentoService.ts (`retirarDaOrigem`) |
| Use an Intermediary | Erro de domínio `TitleInCommittedBatchError` traduzido a HTTP via HandlerError | ✅ presente | errors/TitleInCommittedBatchError.ts |
| Restrict Communication Paths | Front chama via `lib/sispag.ts` + hook `useCriarLoteManual` | ✅ presente | lib/sispag.ts |
| Adhere to Standards | 409 para conflito; JSON aditivo | ✅ presente | routes/sispag.ts |
| Abstract Common Services | N/A: sem client novo no delta | N/A | — |
| Discover Service | N/A: sem integração nova | N/A | — |
| Tailor Interface | `mover` opcional estende o endpoint em vez de criar outro | ✅ presente | routes/sispag.ts:157 |
| Configure Behavior | Agrupamento por vencimento sem toggle | ⚠️ parcial | FormacaoLotesService.ts |
| Manage Resources | N/A: sem recurso externo | N/A | — |
| Orchestrate | `incluirTitulo` orquestra sai+entra em 1 tx | ✅ presente | LotePagamentoService.ts |
| Manage Resource Coupling | Atomicidade por tx única; `removidos===0` aborta | ✅ presente | `retirarDaOrigem` |
| Contract testing | Request coberto; payload de erro sem fixture | ⚠️ parcial | routes/sispag.test.ts |
| Versioning strategy | Sem versão; mitigado por mudança aditiva | ⚠️ parcial | — |
| Backward-compat shims | Nenhum necessário | ✅ presente | — |
| Observability of integration failures | Auditoria `moverTitulo` com loteOrigem; sem métrica | ⚠️ parcial | LotePagamentoService.ts |

## 4. Findings

### F-integrability-1: Contrato do 409 / `loteComprometido` sem teste de contrato

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/routes/sispag.test.ts`, `src/frontend/lib/sispag.ts`
- **Evidência (objetiva)**:
  ```
  testes novos de rota cobrem só `mover` no request (2); LoteComprometidoRef do front é tipo escrito à mão
  ```
- **Impacto técnico**: renomear `status`/`loteId` no backend quebra o MoverParaLoteDialog em silêncio.
- **Impacto de negócio**: UI pode oferecer mover sobre lote já enviado ao banco (o backend ainda bloqueia).
- **Métrica de baseline**: 0 testes de payload nos 2 novos caminhos.

### F-integrability-2: Formação automática alterada sem flag

- **Severidade**: P3
- **Tactic violada**: Configure Behavior
- **Localização**: `src/backend/domain/service/sispag/FormacaoLotesService.ts`
- **Evidência (objetiva)**:
  ```
  agrupamento filial x vencimento substitui o anterior sem toggle
  ```
- **Impacto técnico**: rollback exige revert de código.
- **Impacto de negócio**: baixo; decisão registrada no ADR-0064.
- **Métrica de baseline**: 0 flags.

## 5. Cards Kanban

### [integrability-1] Cobrir payload 409 e `loteComprometido` com teste de contrato

- **Problema**
  > O front tipa à mão o erro e a projeção do painel; nenhuma fixture liga os dois lados.
- **Melhoria Proposta**
  > Teste de rota que afirma o corpo do 409 `TitleInCommittedBatchError` e teste do painel com `loteComprometido`; reaproveitar a fixture em `moverParaLote.test.ts`.
- **Resultado Esperado**
  > Quebra de contrato falha no CI: 0 → 2 testes de payload.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - testes de payload de erro: 0 → 2
- **Risco de não fazer**: divergência silenciosa UI/API no próximo refactor.
- **Dependências**: nenhuma

### [integrability-2] Avaliar toggle para o agrupamento por vencimento

- **Problema**
  > Mudança de regra de formação sem chave de desligamento.
- **Melhoria Proposta**
  > Opcional: parâmetro via EnvironmentProvider, apenas se a operação pedir.
- **Resultado Esperado**
  > Rollback sem deploy: flags 0 → 1.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - flags: 0 → 1
- **Risco de não fazer**: baixo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Delta puramente interno (service/repo/rota/UI); nenhuma integração externa tocada, custo marginal de integração inalterado.
- Mudança de contrato aditiva e validada por Zod; sem P0/P1.
- Cross-QA: Zod no boundary (Security); atomicidade da tx (Fault Tolerance).
