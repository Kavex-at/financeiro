---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-08-1958-sispag-titulos
agent: qa-modifiability
generated_at: 2026-10-08T19:58:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 2
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor | Mudar o teto do export ou as colunas da planilha de títulos | Export de títulos a pagar (BE service + rota + FE lib) | Desenvolvimento, pós-merge | Mudança localizada em 1 ponto por regra | Teto alterado em 1 lugar (hoje 3); colunas em 1 service |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC TitulosAPagarExportService (novo) | 145 | ≤ 400 | ✅ | `wc -l` |
| LOC RemessaTitulosExportService (pós-extração) | 194 | ≤ 400 | ✅ | `wc -l` |
| LOC `routes/sispag.ts` (+43 no delta) | 1257 | ≤ 600 | ❌ (pré-existente, delta agrava) | `wc -l` |
| LOC `frontend/app/sispag/page.tsx` (+42 líquido) | 1475 | ≤ 600 | ❌ (pré-existente, delta agrava) | `wc -l` |
| Constantes do teto 5000 duplicadas | 3 (`TITULOS_CAP`, `MAX_TITULOS_EXPORT`, limite da rota) | 1 | ⚠️ | grep |
| Violações de camada no delta | 0 | 0 | ✅ | leitura do delta |
| Warnings de complexidade no delta | 0 | 0 | ✅ | `_shared-metrics.md` |
| Ciclos de dependência no delta | 0 | 0 | ✅ | leitura de imports |

Apêndice A — Top-10 maiores arquivos tocados pelo delta (escopo --quick, não varredura global)

| # | Arquivo | LOC |
|---|---|---|
| 1 | src/frontend/app/sispag/page.tsx | 1475 |
| 2 | src/backend/routes/sispag.ts | 1257 |
| 3 | src/backend/domain/service/sispag/RemessaTitulosExportService.ts | 194 |
| 4 | src/backend/domain/service/sispag/TitulosAPagarExportService.ts | 145 |

Apêndice B — Fan-in: não medido (--quick). Serviço novo tem fan-in 1 (a rota); `PlanilhaXlsxWriter` fan-in 2 (os dois exports).

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Writer XLSX extraído; service próprio. Mas rota e page continuam monolitos >1200 LOC | ⚠️ parcial | `PlanilhaXlsxWriter.ts`; `wc -l` |
| Increase Semantic Coherence | Service só toca `titulo_a_pagar` + lote (read-only) | ✅ | `TitulosAPagarExportService.ts:44-58` |
| Encapsulate | Interface `TitulosAPagarExport` e writer injetado | ✅ | `interface/sispag/TitulosAPagarExport.ts` |
| Use an Intermediary | Service entre rota e repositórios | ✅ | rota -> service |
| Restrict Dependencies | Sem skip de camada | ✅ | delta |
| Refactor | Extração do writer de `RemessaTitulosExportService` | ✅ | commit e832057 |
| Abstract Common Services | `PlanilhaXlsxWriter` compartilhado; `CelulaExport/ColunaExport` reusados | ✅ | imports do service |
| Defer Binding | DI tsyringe; teto 5000 e colunas hardcoded | ⚠️ parcial | `COLUNAS`, `MAX_TITULOS_EXPORT` |

## 4. Findings

### F-modifiability-1: Teto de 5000 duplicado em 3 pontos sem fonte única

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `SispagPainelService.ts:55`, `frontend/lib/sispag.ts:865`, rota `POST /sispag/titulos/exportar`
- **Evidência (objetiva)**:
  ```
  const TITULOS_CAP = 5000;   export const MAX_TITULOS_EXPORT = 5000
  ```
- **Impacto técnico**: alterar o cap do painel sem o do export gera export que trunca ou rejeita silenciosamente; o limite de 100 KB do body também depende do valor.
- **Impacto de negócio**: analista exporta lista diferente da vista.
- **Métrica de baseline**: 3 cópias do valor.

### F-modifiability-2: Delta engorda monolitos de rota e página

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/routes/sispag.ts` (1257), `src/frontend/app/sispag/page.tsx` (1475)
- **Evidência (objetiva)**: `wc -l` acima; delta +43 e +46/-4.
- **Impacto técnico**: cada feature SISPAG toca os mesmos 2 arquivos, causando conflitos de merge e revisão cara.
- **Impacto de negócio**: lead time crescente nas features da Frente II.
- **Métrica de baseline**: 1257 e 1475 LOC vs alvo 600.

### F-modifiability-3: Colunas do export duplicam conhecimento de formato com o export de remessa

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `TitulosAPagarExportService.ts:14-16` (FMT_MOEDA, FMT_DATA, chaveDe)
- **Evidência (objetiva)**: constantes de formato definidas localmente, também presentes no export de remessa.
- **Impacto técnico**: mudança de formato de moeda/data exige edição em 2 serviços.
- **Impacto de negócio**: baixo; inconsistência visual entre planilhas.
- **Métrica de baseline**: 2 cópias.

## 5. Cards Kanban

### [modifiability-1] Centralizar o teto de títulos do painel/export

- **Problema**
  > O 5000 existe em `TITULOS_CAP` (BE), `MAX_TITULOS_EXPORT` (FE) e na validação da rota; divergência causa truncamento silencioso.
- **Melhoria Proposta**
  > Exportar uma constante única no BE (interface sispag) usada por painel e rota; o FE recebe o teto no payload do painel ou mantém espelho com teste de paridade.
- **Resultado Esperado**
  > 3 cópias -> 1 fonte (+1 teste de paridade FE).
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Cópias do teto: 3 -> 1
- **Risco de não fazer**: alteração do cap do painel quebra o export sem falha de teste.
- **Dependências**: nenhuma

### [modifiability-2] Extrair rotas e componentes de títulos de sispag.ts / page.tsx

- **Problema**
  > Rota e página SISPAG superam 1200 LOC e recebem toda feature nova da frente.
- **Melhoria Proposta**
  > Split Module: mover rotas de export para `routes/sispag/exportacao.ts` e a aba Títulos para componente próprio, incrementalmente, no próximo `/feature-tweak` que tocar a área.
- **Resultado Esperado**
  > routes/sispag.ts 1257 -> <600; page.tsx 1475 -> <600.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: L
- **Findings relacionados**: F-modifiability-2, F-modifiability-3
- **Métricas de sucesso**:
  - LOC rota: 1257 -> <600
  - LOC page: 1475 -> <600
- **Risco de não fazer**: conflitos de merge e revisão cada vez mais lentos.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo --quick: só o delta; sem varredura global de fan-in, complexidade ou ciclos.
- Nenhum P0. O delta em si é bem decomposto (service coeso, writer extraído).
- Cross-QA: o teto/limite de body (100 KB) é também Performance/Availability; monolitos grandes afetam Testability.
