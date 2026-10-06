---
qa: Testability
qa_slug: testability
run_id: 2026-10-06-1500-sispag-remessa-download-export
agent: qa-testability
generated_at: 2026-10-06T15:20:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/AutoLoopRunner | Alterar download de remessa ou export XLSX de títulos | RemessaService.baixarArquivo, RemessaTitulosExportService, rota sispag, LoteCard/ExportarTitulosBarra | CI local, sem rede nem Conexos | Regressão detectada por teste unitário determinístico | 100% dos ramos novos com teste; 0 chamadas de rede; suíte backend 4035 / frontend 861 verdes |

## 2. Métricas observadas

Escopo: delta `git diff origin/main HEAD` (20 arquivos, +1401/-25). Cobertura por camada do repositório inteiro não foi rodada (escopo = delta; gates já verdes).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (delta): service | RemessaService (+6 casos nos ramos novos: grade, gabCod, sem gabCod, null), RemessaTitulosExportService (9 casos, round-trip real exceljs) | 80% linhas/ramos | ✅ | `*.test.ts` do diff |
| 1. Cobertura por camada (delta): repository | listLotes projeção + listLotesPorIds: +54 linhas de teste | 80% | ✅ | LotePagamentoRepository.test.ts |
| 1. Cobertura por camada (delta): route | export: 400 parametrizado, 200 xlsx, 422; download: 404 próprio; permissão em routePermissions.test.ts | cobrir ramos | ⚠️ (sem 403 explícito, sem 500 genérico) | routes/sispag.test.ts |
| 1. Cobertura por camada (delta): frontend | LoteCard, ExportarTitulosBarra, lib/sispag: 262 linhas de teste novas | ≥ 1 teste/componente | ✅ | `*.test.tsx` do diff |
| Relação teste/código no delta | 8 arquivos de teste ↔ 12 de fonte (≈ 0,67) | ≥ 0,5 | ✅ | git diff --stat |
| Injeção por construtor | Serviço novo injeta repo, LogService, BankingCalendar (relógio injetável) | sem `new Date()` solto | ✅ | RemessaTitulosExportService.ts:92 |
| Leitura de tempo não abstraída (fonte novo) | 0 `Date.now()`; `new Date(iso)` só parseia dado | 0 | ✅ | grep no serviço |
| Aleatoriedade / rede em testes novos | 0 / 0 | 0 | ✅ | inspeção |
| Teste de integração SQL (Postgres real) | 0 para `listLotesPorIds` / projeção | ≥ 1 por repo com SQL complexo | ⚠️ | repo testado só com mock de pool |
| Gate de cobertura (coverageThreshold) | não verificado no delta | presente | ⚠️ não medido | fora do escopo |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `montarPlanilha` pública separada de `serializar` (testa projeção sem bytes) | ✅ | RemessaTitulosExportService.ts |
| Recordable Test Cases | Fixtures .rem existem para CNAB; nenhuma fixture de resposta do fin015/`baixarRemessa` para o fallback por gabCod | ⚠️ parcial | `__fixtures__/` |
| Sandbox | Conexos mockado via `write`; sem rede | ✅ | RemessaService.test.ts |
| Executable Assertions | Erros tipados (`RemittanceFileUnavailableError`, `RemittanceExportInvalidError`) carregam contexto asserível | ✅ | errors/*.ts |
| Abstract Data Sources | Repositório e BankingCalendar injetados | ✅ | construtor do serviço |
| Limit Structural Complexity | RemessaService.ts já > 1600 linhas; delta adiciona ramo, não complexidade nova relevante | ⚠️ | RemessaService.ts:1620 |
| Limit Non-Determinism | Relógio via BankingCalendar; fuso BRT fixo coberto por teste | ✅ | nomeArquivo/dataHoraBrt |

## 4. Findings

### F-testability-1: Rota de export sem teste de 403 e de erro não-domínio

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/routes/sispag.test.ts` (bloco do export), `src/backend/routes/sispag.ts` (POST /remessas/titulos/exportar)
- **Evidência (objetiva)**: o diff de teste cobre 400 (parametrizado), 200 e 422; permissão só indireta em routePermissions.test.ts; o `throw err` quando `respondLoteError` retorna false não é exercitado.
- **Impacto técnico**: remoção do `exigirPermissao` ou do rethrow passaria na suíte local.
- **Impacto de negócio**: dados de lote (sem destino) expostos a perfil sem `sispag:ver` seria regressão silenciosa.
- **Métrica de baseline**: 2 ramos da rota sem teste direto (403, 500).

### F-testability-2: Projeção SQL de listLotes / listLotesPorIds só com pool mockado

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`, `.test.ts`
- **Evidência (objetiva)**: 0 testes de integração com Postgres real no delta (`grep "integration:"` não aplicável); o teste valida o texto/params da query.
- **Impacto técnico**: erro de coluna/alias na projeção só aparece em runtime.
- **Impacto de negócio**: export de títulos vazio/errado para a revisão do financeiro.
- **Métrica de baseline**: 0 casos de integração.

### F-testability-3: Fallback por gabCod sem fixture gravada da resposta do Conexos

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: RemessaService.test.ts (casos novos)
- **Evidência (objetiva)**: respostas de `listarArquivosRemessa`/`baixarRemessa` são literais inline.
- **Impacto técnico**: drift do contrato do fin015 (página de 20, `gabLngDados` ausente) não é detectado.
- **Impacto de negócio**: download da remessa volta a falhar em produção sem alerta de CI.
- **Métrica de baseline**: 0 fixtures de resposta fin015.

## 5. Cards Kanban

### [testability-1] Cobrir 403 e erro inesperado na rota de export de títulos

- **Problema**
  > A rota POST /sispag/remessas/titulos/exportar não tem teste direto de 403 nem do rethrow de erro não-domínio.
- **Melhoria Proposta**
  > Adicionar 2 casos em `routes/sispag.test.ts`: usuário sem `sispag:ver` → 403 sem chamar o serviço; serviço lançando Error genérico → 500.
- **Resultado Esperado**
  > Ramos da rota de export testados 3/5 → 5/5; teste de rota do delta 4 → 6 casos.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos de teste da rota de export: 4 → 6
- **Risco de não fazer**: regressão de autorização passa despercebida.
- **Dependências**: nenhuma

### [testability-2] Teste de integração Postgres para listLotesPorIds e projeção de listLotes

- **Problema**
  > A projeção SQL nova é validada só com pool mockado.
- **Melhoria Proposta**
  > Criar `describe('integration: LotePagamentoRepository')` contra Postgres de teste (Sandbox), com 3 lotes e itens.
- **Resultado Esperado**
  > Testes de integração em repositórios SISPAG 0 → 3 casos neste repositório.
- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos de integração: 0 → 3
- **Risco de não fazer**: erro de SQL só descoberto em produção.
- **Dependências**: setup de Postgres de teste (docker-compose.test)

### [testability-3] Gravar fixtures de resposta do fin015 para o download de remessa

- **Problema**
  > O fallback por gabCod depende de formato de resposta do Conexos descrito só em literais.
- **Melhoria Proposta**
  > Redigir (como em `redigir-fixture-rem.ts`) uma resposta do fin015 em `__fixtures__` e usá-la nos casos de `baixarArquivo`.
- **Resultado Esperado**
  > Fixtures de resposta fin015: 0 → 2 (grade com 20 itens sem o arquivo; linha sem gabLngDados).
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Fixtures fin015: 0 → 2
- **Risco de não fazer**: drift do contrato não detectado.
- **Dependências**: nenhuma

## 6. Notas do agente

- Nenhum P0: ramos financeiros do delta (download/export são leitura) estão testados e determinísticos; sem rede, sem relógio solto.
- Cobertura global por camada não coletada (escopo no delta; gates verdes informados pelo caller).
- Cross-QA: fixtures do fin015 ↔ Integrability; integração Postgres ↔ Deployability (gate de CI).
