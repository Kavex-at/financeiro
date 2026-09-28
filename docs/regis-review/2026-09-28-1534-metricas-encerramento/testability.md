---
qa: Testability
qa_slug: testability
run_id: 2026-09-28-1534-metricas-encerramento
agent: qa-testability
generated_at: 2026-09-28T18:40:00Z
scope: backend
score: 7
findings_count: 1
cards_count: 1
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Engenheiro corrigindo a distorção de R$503 mil medida em 18/09 (ADR-0052) | Migration `0065` muda a coluna `encerrado_em`, escrita por dois repositórios de ledger (`PermutaExecucaoRepository`, `SolicitacaoNumerarioExecucaoRepository`), para datar cada execução pelo encerramento em vez da criação | `markSettled`/`markParcial`/`markError` dos dois repositórios; `migrations/0065_*.sql`; `vw_metricas_ciclo` | Pipeline AutoLoopRunner + CI: job `backend` (unit, mock) e job `backend-sql` (Postgres 17 real, mas restrito ao glob `migrations/*.integration.test.ts`) | A suíte deve provar, com execução real contra Postgres, que o carimbo de encerramento segue a regra (1º `settled`/`parcial` fixa; `error` é sobrescrito por um settle posterior; re-clique não anda) — não só que o texto do SQL contém o `CASE` esperado | Testes de integração (DB real) que invocam `markSettled`/`markParcial`/`markError`: 0 → ≥2; a classe de bug original (2 linhas / R$503.066,69 em 190) fica pega por CI antes do merge, não só por auditoria manual |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por camada tocada pela delta** (proxy por arquivo, `--quick` não rodou `--coverage`) — `domain/repository` unit test ratio | 25/26 arquivos (0,96) | ≥ 0,5 | ✅ | `find src/backend/domain/repository -maxdepth 2 -name '*.ts' \| wc -l` (26) vs `*.test.ts` (25) |
| **Cobertura por camada** — `domain/repository` testes de integração (DB real) | 0/26 arquivos (0,00) | ≥ 1 por repositório com escrita de estado terminal | ❌ | `find src/backend/domain/repository -iname '*.integration.test.ts'` → 0 resultados |
| **Cobertura por camada** — `migrations/` guardas estáticas / integração | 65 `.sql`, 6 arquivos de guarda estática, 1 arquivo de integração (cobre 0058+0060+0065) | ≥ 1 arquivo de integração para migrations com regra de negócio | ✅ (para a `0065`, herdado do job `backend-sql` criado no ciclo anterior) | `find src/backend/migrations -maxdepth 1 -name '*.sql' \| wc -l`; `-iname '*.integration.test.ts'` |
| Testes novos adicionados pela delta | 15 (5 guarda estática `vwMetricasCiclo.test.ts` + 5 integração `vwMetricasCiclo.integration.test.ts` + 3 unit `PermutaExecucaoRepository.test.ts` + 2 unit `SolicitacaoNumerarioExecucaoRepository.test.ts`) | — | ✅ | `git diff --stat origin/main..HEAD` |
| Testes que invocam `markSettled`/`markParcial`/`markError` **contra Postgres real** | 0 | ≥ 2 (1 por repositório) | ❌ | `grep -rn "markSettled\|markParcial\|markError" src/backend --include="*.integration.test.ts"` → só stubs em `routes/*.e2e.*.integration.test.ts` (HML do Conexos, não este ledger) |
| Testes que verificam o mesmo CASE apenas por regex na string do SQL (sem executar) | 5 (3 Permuta + 2 SN) | 0 (deveriam ser suplementados por execução real) | ⚠️ | `PermutaExecucaoRepository.test.ts`, `SolicitacaoNumerarioExecucaoRepository.test.ts` |
| Suite backend completa (herdada, gate já medido) | 153 suites / 2297 testes ✅; `test:sql` 24/24 ✅ | verde | ✅ | `_shared-metrics.md` |
| CI gate para testes de integração SQL | job `backend-sql` (Postgres 17 real), mas glob `test:sql` = `jest migrations/.*\.integration\.test\.ts` — só `migrations/`, não `domain/repository/` | glob deveria alcançar qualquer `*.integration.test.ts` fora de `routes/` (que escreve no HML do Conexos) | ⚠️ | `src/backend/package.json:24`, `.github/workflows/ci.yml:29-60` |

> ⚠️ **Não medível localmente (herdado de `_shared-metrics.md`)**: validação contra o banco de produção (leitura negada ao agente nesta sessão); coverage percentual exato (`--quick`, não rodamos `npm test -- --coverage`) — usamos ratio de arquivos como proxy.

## 3. Tactics — Cobertura no financeiro (aplicado à delta)

| Tactic (Bass) | Implementação atual na delta | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Repositórios recebem `PostgreeDatabaseClient` + `identityProvider` por construtor; testes montam `buildDb()` com `jest.fn()` para `insert/update/selectFirst/selectMany` | ✅ presente | `PermutaExecucaoRepository.test.ts:12-23` |
| Recordable Test Cases | Caso real de produção (id 341: nasceu 10/08, liquidou 14/09, R$150.061,81; id 270: R$353.004,88) reproduzido literalmente como fixture no teste de integração e documentado no cabeçalho da migration | ✅ presente, forte | `0065_metricas_ciclo_data_pelo_encerramento.sql:8-10`; `vwMetricasCiclo.integration.test.ts` (teste "retentativa conta na semana em que liquidou") |
| Sandbox | Postgres 17 via Docker no job `backend-sql`; cada novo caso de integração roda em `BEGIN`/`ROLLBACK` (`emTransacao`), isolado da seed compartilhada do `beforeAll` | ✅ presente | `vwMetricasCiclo.integration.test.ts` (helper `emTransacao`); `.github/workflows/ci.yml:29-60` |
| Executable Assertions | Forte no lado de leitura (a view é executada de verdade contra Postgres e o resultado comparado); fraco no lado de escrita dos dois repositórios — os 5 testes novos ali só casam regex contra o texto literal do SQL, nunca executam o `UPDATE` | ⚠️ parcial | Ver F-testability-1 |
| Abstract Data Sources | `PostgreeDatabaseClient` como fronteira única de acesso a dado, trocável por mock nos testes unitários e por instância real no `describeComBanco` | ✅ presente | `PermutaExecucaoRepository.ts` (injeção de `databaseClient`) |
| Limit Structural Complexity | Delta acrescenta a arquivos de teste já grandes (`PermutaExecucaoRepository.test.ts` 821 linhas totais, `vwMetricasCiclo.integration.test.ts` 564 linhas totais) sem quebrá-los; os blocos novos em si são pequenos e focados | ⚠️ parcial (contexto pré-existente, não bloqueante) | `wc -l` nos 5 arquivos tocados = 2408 linhas totais |
| Limit Non-Determinism | Todos os testes novos usam datas fixas (`SERIE`, `HISTORICO`, `AGORA`, `JANELA_A/B`) — nenhum depende de `Date.now()` real; o `now()` do lado do banco (carimbo de auditoria) é intencional e não tem `ClockProvider` nesta camada, mas os testes não dependem do valor exato, só da presença/ordem | ✅ presente para a delta | `vwMetricasCiclo.integration.test.ts:39-44` |

## 4. Findings (achados)

### F-testability-1: escrita de `encerrado_em` (o núcleo da ADR-0052) só é testada por regex em SQL mockado, nunca executada contra Postgres

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (degradada) / Sandbox (não estendido ao caminho de escrita)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:449-537` (`markSettled`, `markParcial`, `markError`); `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:318-357` (`markSettled`, `markError`); testes em `PermutaExecucaoRepository.test.ts` e `SolicitacaoNumerarioExecucaoRepository.test.ts`
- **Evidência (objetiva)**:
  ```
  # Os 3 novos testes de PermutaExecucaoRepository e os 2 de SolicitacaoNumerarioExecucaoRepository
  # só fazem isto (nenhum executa a query):
  const [sql] = (db.update as jest.Mock).mock.calls[0];
  expect(sql).toMatch(/encerrado_em = CASE WHEN status IN \('settled', 'parcial'\).../);

  # Busca por qualquer teste que chame estes métodos contra um Postgres real:
  $ grep -rn "markSettled\|markParcial\|markError" src/backend --include="*.integration.test.ts"
  routes/recebimentos.e2e.*.integration.test.ts:  markSettled: async () => undefined,   # stub, HML Conexos
  # 0 ocorrências em domain/repository/**/*.integration.test.ts (0 arquivos existem)

  # O único teste de integração que valida a ADR-0052 contorna o repositório e insere a coluna direto:
  INSERT INTO permuta_alocacao_execucao (..., criado_em, encerrado_em)
  VALUES ('p-retentativa', ..., '2026-08-10 09:00:00-03', '2026-09-14 12:43:00-03')
  ```
- **Impacto técnico**: o ramo mais arriscado da mudança — `error` (T1) seguido de retry que liquida em `settled` (T2), onde o `ELSE now()` precisa **sobrescrever** o carimbo antigo, e o ramo irmão onde um re-clique sobre linha já `settled` precisa **preservar** o carimbo via `COALESCE` — nunca roda contra um banco de verdade em nenhum teste. Um refactor futuro do `UPDATE` (reordenar `SET`, trocar para query builder/ORM) pode inverter essa semântica silenciosamente; o teste unitário continua verde porque só casa uma string, e nenhum teste de integração cobre o repositório.
- **Impacto de negócio**: essa é exatamente a lógica que corrige a distorção de R$503.066,69 (2 linhas em 190, medida 18/09) que deu origem à ADR-0052. Uma regressão aqui reintroduz a mesma classe de erro — número da semana publicado à Columbia voltando a ficar mascarado — sem nenhum sinal automático no CI antes do merge. Precedente direto: o job `backend-sql` no CI (`.github/workflows/ci.yml:29`) nasceu de um finding igual do Regis-Review de 2026-09-14 (comentário no próprio workflow), mas seu glob (`test:sql` = `jest migrations/.*\.integration\.test\.ts`, `package.json:24`) só alcança `migrations/`, não `domain/repository/` — mesmo que alguém criasse o teste de integração do repositório hoje, ele não rodaria no `backend-sql` sem também ajustar o glob.
- **Métrica de baseline**: testes de integração (Postgres real) que invocam `markSettled`/`markParcial`/`markError` dos dois repositórios tocados = **0 de 2** repositórios.

## 5. Cards Kanban

### [testability-1] Testar a transição `error → settled` (e o re-clique `settled → settled`) contra Postgres real, não só por regex no SQL mockado

- **Problema**
  > Os dois repositórios de ledger tocados pela delta (`PermutaExecucaoRepository`, `SolicitacaoNumerarioExecucaoRepository`) implementam a regra central da ADR-0052 — carimbar `encerrado_em` no primeiro encerramento e sobrescrevê-lo quando um retry de `error` liquida — mas os 5 testes novos só verificam que o texto do `UPDATE` contém o `CASE` esperado, via mock de `PostgreeDatabaseClient`. Nenhum teste, unitário ou de integração, executa essas queries contra um Postgres real; o único teste de integração que valida o comportamento (`vwMetricasCiclo.integration.test.ts`) insere `encerrado_em` diretamente via SQL, sem passar pelo repositório.

- **Melhoria Proposta**
  > Adicionar, dentro de `vwMetricasCiclo.integration.test.ts` (reaproveitando `describeComBanco` + o helper `emTransacao` já criado nesta delta — assim o teste continua coberto pelo job `backend-sql`/`test:sql` sem mexer no glob), 2 casos que instanciam `PermutaExecucaoRepository` e `SolicitacaoNumerarioExecucaoRepository` com um `PostgreeDatabaseClient` real apontado para o Postgres de teste e chamam a sequência real `beginExecution → markError → markSettled`, then `markSettled` de novo (re-clique). Assertar `encerrado_em`: nasce NULL, vira T1 no `markError`, vira T2 (≠ T1) no `markSettled` seguinte, e permanece T2 após o segundo `markSettled`. Tactic alvo: Executable Assertions (tornar a garantia comportamental) e Sandbox (reusar a transação isolada já existente).

- **Resultado Esperado**
  > Testes de integração (Postgres real) exercitando `markSettled`/`markParcial`/`markError` dos dois repositórios: 0 → 2. Os 5 testes de regex existentes continuam como guarda estática rápida (não removidos), agora suplementados por prova de execução real do ramo `error → settled` que é o motivo de existir da ADR-0052.

- **Tactic alvo**: Executable Assertions / Sandbox
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — infraestrutura (`describeComBanco`, Postgres 17 no CI, `emTransacao`) já existe e é reaproveitada.
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes de integração (DB real) invocando `markSettled`/`markParcial`/`markError`: 0 → 2
  - Cobertura do ramo `error(T1) → settled(T2)` sobrescrevendo `encerrado_em`: não coberto → coberto por execução real
- **Risco de não fazer**: um refactor futuro do `UPDATE` (reordenar `SET`, trocar para query builder) inverte silenciosamente a semântica `COALESCE`/`CASE` e reintroduz a distorção de R$503 mil já medida e corrigida — com CI verde, porque o único teste que hoje pegaria isso (regex de string) só quebra se a string mudar, não se o comportamento mudar.
- **Dependências**: nenhuma — usa infraestrutura já presente na delta (`describeComBanco`, `emTransacao`, job `backend-sql`).

## 6. Notas do agente

- Escopo: avaliei apenas os arquivos do diff `origin/main..HEAD` (migration 0065, os dois repositórios de ledger e seus testes); não reexecutei coverage completo (`--quick`) — usei ratio de arquivos como proxy declarado na Seção 2.
- Cross-QA: F-testability-1 tem overlap direto com **Fault Tolerance** (a transição de estado `error → settled` é justamente um caminho de recuperação de falha) e com **Deployability** (o gate `backend-sql` no CI já nasceu de um finding de testability anterior — precedente de que este time fecha esse tipo de gap rápido).
- Observação não transformada em finding (contexto, não bloqueante): a delta acrescenta ~190 linhas a dois arquivos de teste já grandes (`PermutaExecucaoRepository.test.ts` 821 linhas, `vwMetricasCiclo.integration.test.ts` 564 linhas) sem dividi-los; os blocos novos são pequenos e focados, então não abri card — mas se a próxima ADR tocar os mesmos arquivos, vale revisitar Limit Structural Complexity.
- Pontos fortes registrados (não geram card, mas valem citar no consolidator): Recordable Test Cases é excepcionalmente forte aqui — o caso real de produção (id 341, R$150.061,81) virou fixture literal do teste, com o mesmo número que apareceu no incidente.
