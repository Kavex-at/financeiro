---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-06-1500
agent: qa-modifiability
generated_at: 2026-10-06T15:00:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review (delta sispag-remessa-download-export)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Adicionar coluna ao export de títulos ou campo ao cabeçalho do lote | `RemessaTitulosExportService`, `LotePagamentoRepository` (projeção) | Desenvolvimento | Mudança localizada em 1 constante/array + teste | <= 2 arquivos de produção tocados |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `RemessaTitulosExportService.ts` (novo) | 211 | <= 400 | ✅ | `wc -l` |
| LOC `RemessaService.ts` | 1665 (delta ~+30) | <= 600 | ❌ | `wc -l` |
| LOC `LotePagamentoRepository.ts` | 1087 (delta ~+40) | <= 600 | ❌ | `wc -l` |
| LOC `routes/sispag.ts` | 1206 (delta ~+45) | <= 600 | ❌ | `wc -l` |
| LOC `frontend/lib/sispag.ts` | 1611 (delta ~+35) | <= 600 | ❌ | `wc -l` |
| LOC `LoteCard.tsx` | 1167 (delta ~+45) | <= 600 | ❌ | `wc -l` |
| Projeções SQL duplicadas de cabeçalho de lote | 1 (`LOTE_HEADER_COLUMNS`; eram 2) | 1 | ✅ | diff do repositório |
| Violações de camada no delta | 0 (rota -> service -> repo) | 0 | ✅ | leitura do diff |
| Constantes de regra hardcoded no delta | 2 (`OFFSET_BRT_MS`, `MAX_LOTES_EXPORT`) | 0 | ⚠️ | `RemessaTitulosExportService.ts:20` |

⚠️ **Não medível no escopo**: top-10 maiores arquivos e top-10 fan-in globais, complexidade cognitiva do Biome e ciclos. O escopo foi restrito ao diff, e os 5 arquivos acima são os do delta que já excedem 600 LOC.

## 3. Tactics

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Export em service novo e separado (bom); 5 arquivos do delta seguem > 1000 LOC | ⚠️ parcial | tabela 2 |
| Increase Semantic Coherence | Export isolado; `baixarArquivo` mistura grade + fallback gabCod | ⚠️ parcial | `RemessaService.ts` `baixarArquivo` |
| Encapsulate | Projeção única `LOTE_HEADER_COLUMNS`; `comItens` privado | ✅ presente | `LotePagamentoRepository.ts:27-37` |
| Use an Intermediary | `montarPlanilha` separado de `serializar` | ✅ presente | `RemessaTitulosExportService.ts` |
| Restrict Dependencies | Rota depende só de services; erros via `respondLoteError` | ✅ presente | `routes/sispag.ts` |
| Refactor | `comItens` elimina duplicação; `LoteHeaderRow` ainda mantido à mão em paralelo à SELECT | ⚠️ parcial | repositório |
| Abstract Common Services | Mesmo desenho do `RelatorioExportService`, sem serializador XLSX compartilhado | ⚠️ parcial | `serializar` |
| Defer Binding | DI tsyringe; teto e fuso como constantes de código | ⚠️ parcial | `OFFSET_BRT_MS` |

## 4. Findings

### F-modifiability-1: Arquivos já gigantes continuam crescendo
- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `RemessaService.ts`, `LotePagamentoRepository.ts`, `routes/sispag.ts`, `frontend/lib/sispag.ts`, `LoteCard.tsx`
- **Evidência (objetiva)**:
  ```
  1665 / 1087 / 1206 / 1611 / 1167 LOC; o delta somou ~200 linhas de produção a eles
  ```
- **Impacto técnico**: toda feature SISPAG toca os mesmos 5 arquivos (conflito de merge, revisão cara).
- **Impacto de negócio**: lead time crescente em mudanças SISPAG.
- **Métrica de baseline**: 5 arquivos > 1000 LOC (alvo máx 600).

### F-modifiability-2: Serialização XLSX duplicada entre exports
- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `RemessaTitulosExportService.ts` (`serializar`), `RelatorioExportService` (Permutas)
- **Evidência (objetiva)**:
  ```
  Ambos montam Workbook/colunas/totais com exceljs; PlanilhaExport mora em interface SISPAG
  ```
- **Impacto técnico**: novo formato ou estilo exige editar N serviços.
- **Impacto de negócio**: baixo hoje (2 exports).
- **Métrica de baseline**: 2 serializadores quase idênticos.

### F-modifiability-3: Regra de fuso e teto de lotes hardcoded
- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `RemessaTitulosExportService.ts:20` (`OFFSET_BRT_MS`), `MAX_LOTES_EXPORT`
- **Evidência (objetiva)**:
  ```
  const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;  // BankingCalendar já injetado no mesmo service
  ```
- **Impacto técnico**: segundo local com conhecimento de fuso; teto exige redeploy.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 2 constantes de regra.

### F-modifiability-4: `baixarArquivo` com dois caminhos de identidade no mesmo método
- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `RemessaService.ts` `baixarArquivo`
- **Evidência (objetiva)**:
  ```
  Grade (flpCod) + fallback gabCod + erro tipado em ~45 linhas, dentro de service de 1665 LOC
  ```
- **Impacto técnico**: uma nova fonte de arquivo (ex. cache local) agrava a ramificação.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 3 saídas (grade, gabCod, erro) em 1 método.

## 5. Cards Kanban

### [modifiability-1] Fatiar RemessaService, LotePagamentoRepository, routes/sispag, lib/sispag e LoteCard

- **Problema**
  > Cinco arquivos do SISPAG têm 1087-1665 LOC e receberam mais ~200 linhas neste delta; toda feature os toca.
- **Melhoria Proposta**
  > Split Module: extrair `RemessaDownloadService` (baixarArquivo + fallback), router `sispag/remessas.ts`, repositório de leitura de lotes (listLotes/listLotesPorIds/projeção), subcomponentes de `LoteCard` e `lib/sispag/` por domínio. Fazer proporcionalmente a cada tweak.
- **Resultado Esperado**
  > Arquivos > 600 LOC no SISPAG: 5 → 0.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: L
- **Findings relacionados**: F-modifiability-1, F-modifiability-4
- **Métricas de sucesso**:
  - max LOC por arquivo SISPAG: 1665 → 600
- **Risco de não fazer**: conflitos e regressões crescentes nas frentes do SISPAG.
- **Dependências**: nenhuma

### [modifiability-2] Reusar BankingCalendar para fuso e extrair serializador XLSX comum

- **Problema**
  > Offset BRT hardcoded e serialização exceljs duplicada com Permutas.
- **Melhoria Proposta**
  > Abstract Common Services: `XlsxPlanilhaWriter` compartilhado; datas via `BankingCalendar`.
- **Resultado Esperado**
  > Serializadores XLSX: 2 → 1; offsets locais: 1 → 0.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2, F-modifiability-3
- **Métricas de sucesso**:
  - serializadores XLSX: 2 → 1
- **Risco de não fazer**: divergência de formatação e fuso entre planilhas.
- **Dependências**: nenhuma

### [modifiability-3] Externalizar o teto de lotes do export

- **Problema**
  > `MAX_LOTES_EXPORT` é constante de código; ajustar exige redeploy.
- **Melhoria Proposta**
  > Defer Binding: ler via `EnvironmentProvider` com o default atual.
- **Resultado Esperado**
  > Ajuste sem alteração de código.
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - constantes de regra hardcoded no export: 2 → 1
- **Risco de não fazer**: baixo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Nenhum P0/P1: o delta é bem localizado (projeção única, service novo coeso, camadas respeitadas).
- Escopo = diff; top-10 fan-in e maiores arquivos globais não coletados (declarado na seção 2).
- Cross-QA: Split Module e Testability (arquivos de 1000+ LOC); constantes hardcoded e Deployability.
