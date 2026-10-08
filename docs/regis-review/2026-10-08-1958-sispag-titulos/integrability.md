---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-08-1958-sispag-titulos
agent: qa-integrability
generated_at: 2026-10-08T20:00:00Z
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Novo export/serialização (ou troca da lib xlsx) no SISPAG | `PlanilhaXlsxWriter`, `TitulosAPagarExportService`, rota `/sispag/titulos/exportar` | Dev, delta do commit e832057 | Mudança isolada atrás de um adaptador; contrato de entrada validado na borda | Arquivos tocados para trocar a lib xlsx: 1; clientes externos novos no delta: 0 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clientes externos novos / alterados no delta | 0 (export só local, sem Conexos) | n/a | ✅ | `_shared-metrics.md` |
| Arquivos que importam `exceljs` no delta | 1 (`PlanilhaXlsxWriter.ts`) | 1 | ✅ | `PlanilhaXlsxWriter.ts:1` |
| Validação Zod na borda do novo endpoint | sim (`exportarTitulosAPagarSchema`) | 100% | ✅ | `routes/sispag.ts` (rota `/titulos/exportar`) |
| Services do delta com >2 clientes diretos | 0 (apenas repositórios, Log, Calendar, Writer) | 0 | ✅ | `TitulosAPagarExportService.ts:52-56` |
| axios/fetch em service/repo no delta | 0 | 0 | ✅ | inspeção do delta |
| Teste de contrato com fixture real de integração | n/a (sem integração externa nova) | — | ✅ | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | exceljs encapsulado em `PlanilhaXlsxWriter`, extraído do `RemessaTitulosExportService` e reusado pelos dois exports | ✅ presente | `PlanilhaXlsxWriter.ts:1-20` |
| Use an Intermediary | Projeção `PlanilhaExport` (interface) entre serviço e serializador | ✅ presente | `interface/sispag/RemessaTitulosExport.ts` |
| Restrict Communication Paths | Service só fala com repositórios e writer injetados | ✅ presente | `TitulosAPagarExportService.ts:52-56` |
| Adhere to Standards | POST + chaves `fil:doc:tit`, `.xlsx` com content-type padrão | ✅ presente | `routes/sispag.ts` |
| Abstract Common Services | Writer compartilhado pelos dois exports | ✅ presente | `PlanilhaXlsxWriter.ts` |
| Discover Service | N/A: sem integração externa nova no delta | N/A | — |
| Tailor Interface | Chave compacta transformada em objeto no schema Zod | ✅ presente | `routes/sispag.ts` (`transform`) |
| Configure Behavior | Teto `MAX_TITULOS_EXPORT` constante compartilhada, não configurável | ⚠️ parcial | `interface/sispag/TitulosAPagarExport.ts` |
| Manage Resources | `heavyRouteLimiter` + teto 5000 | ✅ presente | `routes/sispag.ts` |
| Orchestrate | Linear e curto (listAtivos, lotes, filtro, serialização) | ✅ presente | `TitulosAPagarExportService.ts` |
| Manage Resource Coupling | Formato da chave `fil:doc:tit` duplicado em FE e BE | ⚠️ parcial | F-integrability-1 |
| Contract testing | Teste de rota prova 5000 chaves < 100 KB; sem teste de paridade FE/BE | ⚠️ parcial | `routes/sispag.test.ts` |
| Versioning strategy | Rota sem versão (padrão do repo, API interna) | ⚠️ parcial | `routes/sispag.ts` |
| Backward-compat shims | Nenhum necessário | N/A | — |
| Observability of integration failures | Log via `LogService` com `requestId` | ✅ presente | `TitulosAPagarExportService.ts` |

## 4. Findings

### F-integrability-1: Formato da chave `fil:doc:tit` é contrato implícito duplicado entre FE e BE

- **Severidade**: P3
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `src/backend/routes/sispag.ts` (regex do schema), `src/frontend/lib/sispag.ts`
- **Evidência (objetiva)**:
  ```
  .regex(/^\d{1,6}:[^:]{1,40}:[^:]{1,40}$/)  // BE; o FE monta a mesma string
  ```
- **Impacto técnico**: mudança de formato num lado quebra o export sem erro de tipo (só 400 em runtime).
- **Impacto de negócio**: export da aba quebra silenciosamente após refactor; baixo.
- **Métrica de baseline**: 2 definições do formato, 0 teste de paridade.

### F-integrability-2: Teto de export (5000) acoplado por convenção a `TITULOS_CAP` e ao limite de 100 KB do body

- **Severidade**: P3
- **Tactic violada**: Configure Behavior
- **Localização**: `src/backend/domain/interface/sispag/TitulosAPagarExport.ts`, `SispagPainelService.ts`, `src/backend/http/buildApp.ts:56`
- **Evidência (objetiva)**:
  ```
  MAX_TITULOS_EXPORT = 5000 (== TITULOS_CAP); body limit default 100 KB
  ```
- **Impacto técnico**: subir o cap do painel sem subir o do export (ou vice-versa) faz tela e export divergirem.
- **Impacto de negócio**: export parcial em relação ao que o analista vê; baixo hoje (~1,5 mil linhas).
- **Métrica de baseline**: 3 limites acoplados, 1 teste.

## 5. Cards Kanban

### [integrability-1] Centralizar o formato da chave de título

- **Problema**
  > O formato `filCod:docCod:titCod` é definido no regex da rota e montado no FE separadamente (F-integrability-1).
- **Melhoria Proposta**
  > Extrair helper de formatar/parsear chave num módulo de interface do backend e adicionar teste de paridade com o FE.
- **Resultado Esperado**
  > Definições do formato sem teste de paridade: 2 → 0.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Testes de paridade de chave: 0 → 1
- **Risco de não fazer**: quebra silenciosa em refactor futuro da chave.
- **Dependências**: nenhuma

### [integrability-2] Amarrar `MAX_TITULOS_EXPORT` a `TITULOS_CAP`

- **Problema**
  > Os dois tetos valem 5000 por convenção (F-integrability-2).
- **Melhoria Proposta**
  > Importar uma constante única, ou teste que afirme `MAX_TITULOS_EXPORT >= TITULOS_CAP`.
- **Resultado Esperado**
  > Divergência possível entre tela e export: sim → não.
- **Tactic alvo**: Configure Behavior
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Constantes independentes: 2 → 1 (ou 2 com asserção)
- **Risco de não fazer**: export parcial se o cap do painel crescer.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta e832057; `--quick`, sem coverage nem audit.
- O delta não adiciona nem altera cliente externo; a extração do `PlanilhaXlsxWriter` melhora Encapsulate e Abstract Common Services.
- Cross-QA: Zod na borda do endpoint (Security/Fault Tolerance); constante 5000 (Performance).
