---
qa: Testability
qa_slug: testability
run_id: 2026-10-08-1958-sispag-titulos
agent: qa-testability
generated_at: 2026-10-08T20:00:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 2
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na exportação de títulos a pagar (filtro de comprometidos, coluna Lote, totais) | `TitulosAPagarExportService`, rota `POST /sispag/titulos/exportar`, aba Títulos do `page.tsx` | Teste unitário local, sem Conexos nem Postgres | Forçar a carteira, os lotes e a data de hoje por injeção e afirmar a planilha produzida | Cada regra do delta coberta por um teste determinístico; suíte verde em < 1 min |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (backend/frontend) | Não medida (`--quick`). Proxy: 225 suites / 4072 testes no backend, 90 suites / 908 testes no frontend, todos verdes | ≥ 80% linhas em `domain/service` | ⚠️ Não medível localmente: exige `npm test -- --coverage`. Recomendação: rodar no próximo ciclo completo | `_shared-metrics.md` |
| Arquivos do delta com teste colocado | 5 de 6 fontes de lógica (service, rota, `ExportarTitulosAPagarBotao`, `filtrosAbas`, `lib/sispag`, `page`). Exceção: `PlanilhaXlsxWriter.ts` | 100% | ⚠️ | `git show --stat e832057` |
| Casos de teste do service novo | 6 `it` (linhas, ordem + chave órfã, pago, coluna Lote, totais em centavos, exportar + log) | ≥ 1 por ramo | ✅ | `TitulosAPagarExportService.test.ts:59-135` |
| Injeção de dependências no service novo | 5 de 5 por construtor (`tituloRepo`, `loteRepo`, `logService`, `calendar`, `writer`) | 100% | ✅ | `TitulosAPagarExportService.ts:51-57` |
| Leituras de relógio não abstraídas no delta | 0 (usa `BankingCalendar.todayBrt()`) | 0 | ✅ | `TitulosAPagarExportService.ts:70,106` |
| Aleatoriedade e rede no delta | 0 | 0 | ✅ | leitura do diff |
| Teste de limite do body (100 KB com 5000 chaves) | Presente | presente | ✅ | `_shared-metrics.md` / `routes/sispag.test.ts` |
| Property-based (`fast-check`) no delta | 0 | opcional | ⚠️ | leitura do diff |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `montar()` é público e separado de `exportar()`, então o teste afirma linhas e totais sem decodificar xlsx | ✅ presente | `TitulosAPagarExportService.ts:74` |
| Recordable Test Cases | Sem fixtures gravadas, mas o delta não toca em cliente externo | N/A: export é read-only e local | `_shared-metrics.md` |
| Sandbox | Repositórios e calendário mockados por construtor | ✅ presente | `TitulosAPagarExportService.test.ts` |
| Executable Assertions | Teste de totais em centavos; contagem de `ignorados` no log | ⚠️ parcial: `ignorados` e duplicatas pouco afirmados | `TitulosAPagarExportService.ts:96-118` |
| Abstract Data Sources | Repositórios por DI; `PlanilhaXlsxWriter` extraído e injetável | ✅ presente | `PlanilhaXlsxWriter.ts` |
| Limit Structural Complexity | Service de 145 linhas, teste de 151; projeção pura separada do serializador | ✅ presente | diff |
| Limit Non-Determinism | Relógio via `BankingCalendar`; sem random nem rede | ✅ presente | `TitulosAPagarExportService.ts:106` |

## 4. Findings

### F-testability-1: `PlanilhaXlsxWriter` extraído sem teste próprio

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/backend/domain/libs/xlsx/PlanilhaXlsxWriter.ts` (29 linhas)
- **Evidência (objetiva)**:
  ```
  Nenhum PlanilhaXlsxWriter.test.ts no delta; coberto só indiretamente por
  TitulosAPagarExportService.test.ts:135 e pelo teste do RemessaTitulosExportService.
  ```
- **Impacto técnico**: uma regressão em formato numérico, data ou linha de totais só aparece de forma indireta, com a falha apontando para o service errado.
- **Impacto de negócio**: dois exports usam a mesma lib (Remessa e Títulos), então um erro de formato afeta ambos e o analista só vê na planilha aberta.
- **Métrica de baseline**: 0 testes diretos para 2 consumidores.

### F-testability-2: ramos de dedupe e lista vazia sem afirmação explícita

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `TitulosAPagarExportService.ts:96-104,118`
- **Evidência (objetiva)**:
  ```
  vistos.has(k) (chave duplicada) e chaves=[] não aparecem entre os 6 `it` (linhas 60-135).
  O teste da linha 81 cobre só a chave fora da carteira.
  ```
- **Impacto técnico**: a regra "chave duplicada conta como ignorada" pode quebrar sem aviso.
- **Impacto de negócio**: baixo; o pior caso é uma planilha com linha duplicada ou o total errado.
- **Métrica de baseline**: 2 ramos sem afirmação direta.

### F-testability-3: cobertura de carteira inteira em memória não é exercitada em escala

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `TitulosAPagarExportService.ts:77-82`
- **Evidência (objetiva)**:
  ```
  listAtivos() relê a carteira toda (~1,5 mil linhas) e filtra em memória; os testes usam poucas linhas.
  ```
- **Impacto técnico**: o teto de 5000 chaves está provado no body da rota, mas não no custo de `montar`.
- **Impacto de negócio**: baixo hoje.
- **Métrica de baseline**: maior caso de teste do service: poucas linhas, contra um teto de 5000.

## 5. Cards Kanban

### [testability-1] Cobrir `PlanilhaXlsxWriter` com teste direto

- **Problema**
  > O writer foi extraído para `domain/libs/xlsx` e serve a dois exports, mas só é exercitado indiretamente (F-testability-1).

- **Melhoria Proposta**
  > Criar `PlanilhaXlsxWriter.test.ts`: serializar uma `PlanilhaExport` pequena, reler o buffer e afirmar cabeçalho, `numFmt` de moeda e data, e a linha de totais. Tactic: Specialized Interfaces.

- **Resultado Esperado**
  > Testes diretos do writer 0 → 3 casos; regressões de formato falham no teste da lib, não no do service.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes diretos do `PlanilhaXlsxWriter`: 0 → 3
- **Risco de não fazer**: um ajuste de formato quebra dois exports e só é percebido na planilha aberta.
- **Dependências**: nenhuma

### [testability-2] Afirmar dedupe, lista vazia e escala em `TitulosAPagarExportService`

- **Problema**
  > Chave duplicada, `chaves=[]` e um caso de 5000 chaves não têm afirmação explícita (F-testability-2, F-testability-3).

- **Melhoria Proposta**
  > Adicionar 3 `it`: duplicata conta como `ignorados` e gera uma linha só; lista vazia gera planilha com total 0; 5000 chaves sobre carteira sintética terminam rápido, em teste de sanidade sem relógio. Opcional: propriedade `fast-check` (total em centavos igual à soma das linhas). Tactic: Executable Assertions.

- **Resultado Esperado**
  > Casos do service 6 → 9; ramos sem afirmação 2 → 0.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2, F-testability-3
- **Métricas de sucesso**:
  - `it` em `TitulosAPagarExportService.test.ts`: 6 → 9
- **Risco de não fazer**: baixo; a regra de dedupe pode mudar sem que nada falhe.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta de e832057; sem cobertura nem auditoria (`--quick`), por isso a métrica 1 está declarada como não medível.
- O delta é bem testável: DI por construtor, relógio via `BankingCalendar`, sem rede nem random, e testes colocados ao lado. Nenhum P0 nem P1.
- Cross-QA: Limit Non-Determinism (calendário injetável) toca Modifiability; o limite de body de 100 KB provado em teste toca Performance.
