---
qa: Testability
qa_slug: testability
run_id: 2026-10-29-1628
agent: qa-testability
generated_at: 2026-10-29T16:28:00-03:00
scope: backend+frontend
score: 8
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev tocando ADR-0080 (confirmar-em-conjunto / I15t) | Nova regra de irmãos, novo endpoint em lote, novo componente FE, novo caminho de ajuste de centavos em sequência | `ConfirmacaoEmConjuntoService`, `RegraIrmaosConjunto`, `AjusteCentavosTituloService.executarEmSequencia`, `ConfirmacaoEmConjuntoSecao.tsx`, rota `/sispag/sugestoes-boleto/confirmar-em-conjunto` | PR em worktree, gates obrigatórios (typecheck/lint/jest/PatternGuardian/DesignReviewer) + Regis-Review | Teste de cada invariante I15t(1)–(7) por costura unitária com DI via construtor + motor real para elegibilidade; teste de edge do envelope de rota; cobertura FE do fluxo da gaveta | ≥1 teste por invariante I15t citado; 0 chamadas de rede/DB nos unit tests; falhas de linha isoladas asseguradas sem efeito dominó; teto `CONFIRMACAO_CONJUNTO_MAXIMO=30` coberto antes e depois (I15t(3)); dupla da fila do ajuste coberta em sequência real (I15t(6)) |

> Diff: 18 arquivos / +623/−21 LOC, 7 arquivos novos de teste e 4 arquivos de teste modificados. Métricas colhidas no `_shared-metrics.md`.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes novos exercitando `ConfirmacaoEmConjuntoService` (orquestração do conjunto) | 13 cases | ≥1 por invariante I15t(1)–(7) + 1 por motivo de recusa | ✅ | `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.test.ts` (jest, 13 passes) |
| Testes exercitando `RegraIrmaosConjunto` sobre o **motor real** (não mock) | 18 cases | ≥10, com motor real | ✅ | `src/backend/domain/service/sispag/RegraIrmaosConjunto.test.ts` L15-L27 (constrói `MotorSugestaoBoleto` real + `BankingCalendar.withClock(() => fixedDate)`) |
| Testes de componente FE do fluxo da gaveta (Testing Library) | 7 cases | ≥5 cobrindo "nada marcado", 422, teto, resultado por linha, resumo | ✅ | `src/frontend/app/sispag/components/ConfirmacaoEmConjuntoSecao.test.tsx` (7 passes) |
| Testes do client HTTP FE | 3 cases (URL/método/corpo + GET no-store + 422) | ≥3 | ✅ | `src/frontend/lib/sispag.confirmacaoEmConjuntoApi.test.ts` |
| Testes da rota em lote (edge envelope) | 2 cases (`/titulo/irmaos`, `/confirmar-em-conjunto`) + 1 permissão | ≥3 | ✅ | `src/backend/routes/sispag.sugestaoBoleto.test.ts` L775-L870 e `http/routePermissions.test.ts` |
| Testes exercitando a fila sequencial do ajuste de centavos | 4 cases (`agendarEmSequencia` vazio + `executarEmSequencia` 3) | ≥3 cobrindo fila-só-de-decisão-nova, erro-por-pedido e varredura final | ✅ | `AjusteCentavosTituloService.test.ts` L925-L975 |
| Modo de injeção dos novos services nos testes (DI por construtor, não `container.resolve`) | 100% dos testes novos (ConfirmacaoEmConjuntoService / RegraIrmaosConjunto) | 100% | ✅ | `ConfirmacaoEmConjuntoService.test.ts` L67-L75 `new ConfirmacaoEmConjuntoService(...)`; nenhum `container.resolve` nos novos testes |
| Chamadas de rede reais em unit tests novos | 0 | 0 | ✅ | `grep -n "axios\\.\\|fetch(" <novos *.test.ts(x)>` → só `apiFetch` mockado |
| Sítios de `Date.now()` / `new Date()` em código novo de produção não-abstraído | 0 em `RegraIrmaosConjunto.ts`; 0 em `ConfirmacaoEmConjuntoService.ts` | 0 (usar `BankingCalendar`) | ✅ | `grep -n "new Date\\|Date.now" src/backend/domain/service/sispag/{RegraIrmaosConjunto,ConfirmacaoEmConjuntoService}.ts` → 0 ocorrências |
| Sítios de randomness em código novo de produção não-injetado | 1 (`randomUUID()` para `conjunto.id` em `ConfirmacaoEmConjuntoService.ts:106`) | 0 (ou injeção via provider) | ⚠️ | `ConfirmacaoEmConjuntoService.ts:106`. Impacto baixo: o teste contorna comparando "set de ids tem tamanho 1" (ConfirmacaoEmConjuntoService.test.ts L108-L109), mas não é controlável. |
| Integration test (Jest + Postgres real / Conexos stub) do caminho em lote | 0 (apenas run manual descrito em `_shared-metrics.md:45`) | ≥1 cenário feliz + ≥1 cenário "lote finalizado no meio" | ❌ | Não há `*.integration.test.ts` cobrindo `ConfirmacaoEmConjuntoService`. O único integration test em `domain/service/sispag/` é `GrupoBoletoService.integration.test.ts`, não relacionado. |
| LOC do maior arquivo de teste tocado pelo diff | `BoletoSuggestionService.test.ts` 1974 LOC; `AjusteCentavosTituloService.test.ts` 975 LOC; `sispag.sugestaoBoleto.test.ts` 865 LOC | ≤500 LOC (heurística Bass "Limit Structural Complexity") | ⚠️ | `wc -l` |
| `ajuste.agendarEmSequencia` fire-and-forget (`void this.executarEmSequencia(...)`) | Testado só na forma aguardável (`executarEmSequencia`), nunca o `void` em si | 1 teste assertando que a promise rejeitada é logada e não vira `unhandledRejection` | ⚠️ | `AjusteCentavosTituloService.ts:313-316`; `AjusteCentavosTituloService.test.ts` não cobre o descarte da promise |
| Cobertura global backend/frontend (lines/branches) do diff | ⚠️ Não medível localmente neste `--quick`: só suítes afetadas rodaram (ConfirmacaoEmConjuntoService 13, BoletoSuggestionService 127, routes 50, routePermissions 534). | Baseline numérico via `npm test -- --coverage` em sessão não-quick | ⚠️ | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `BoletoSuggestionService.cenarioParaConjunto()` + `confirmar(..., cenario)` existem **só** para permitir o conjunto reusar o motor com um cenário pré-computado; `AjusteCentavosTituloService.executarEmSequencia` é a mesma superfície do `agendar...` só que `await`-able para teste. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:113`; `AjusteCentavosTituloService.ts:313-355` |
| Recordable Test Cases | Fixtures de código de barras construídos inline (helper `dvGeral` em `RegraIrmaosConjunto.test.ts:31`) e cenários de resultado da rota construídos no FE test. Nenhum snapshot de resposta Conexos gravado — mas o diff não toca client externo. | ✅ presente (dentro do escopo) | `RegraIrmaosConjunto.test.ts:31-40`; `ConfirmacaoEmConjuntoSecao.test.tsx:63-79` |
| Sandbox | `AjusteCentavosTituloService.ts` já respeita `ServerProcessMarker` + `SISPAG_LIVE_WRITE_ENABLED` / `shadow`; o `executarEmSequencia` herda isso. Baseline manual rodou em "disposable clone of local PRD copy, Conexos stub, writes off" (_shared-metrics.md:45). | ✅ presente | `_shared-metrics.md:45`; CLAUDE.md "Ajuste de centavos (ADR-0074)". |
| Executable Assertions | `BatchConfirmationTooLargeError`, `TitleSuggestionNotFoundError` e `isHandlerError(err) && err.statusCode < 500` como classificação determinística; recusa carrega `motivo` em pt-BR. Teste assegura que erro inesperado vira "Não foi possível confirmar este título agora. Tente de novo." e **não vaza mensagem bruta** (`expect(JSON.stringify(r)).not.toContain('connection reset')`). | ✅ presente | `ConfirmacaoEmConjuntoService.ts:189-199`; `ConfirmacaoEmConjuntoService.test.ts:163` |
| Abstract Data Sources | DI via tsyringe em todos os construtores novos (`@inject(BoletoDdaRepository)`, `@inject(LotePagamentoRepository)` …) — e os testes montam direto com `new ConfirmacaoEmConjuntoService(sugestoes as never, ...)` sem container. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:49-58`; `ConfirmacaoEmConjuntoService.test.ts:67-75` |
| Limit Structural Complexity | `ConfirmacaoEmConjuntoService.ts` 208 LOC, foco único (orquestração do conjunto); `RegraIrmaosConjunto.ts` 195 LOC, só elegibilidade. Mas os testes host **crescem**: `BoletoSuggestionService.test.ts` já em 1974 LOC, `AjusteCentavosTituloService.test.ts` em 975 LOC. | ⚠️ parcial | `wc -l` |
| Limit Non-Determinism | Tempo abstraído via `BankingCalendar.withClock(() => fixedDate)` nos testes de regra; nenhum `new Date()` em código de produção novo. **Exceção**: `randomUUID()` para `conjunto.id` sem provider injetável (impacto baixo — teste contorna por "set-size=1"). O fire-and-forget `void this.executarEmSequencia(...)` cria uma janela de rejeição-não-observada se um bug síncrono surgir no futuro. | ⚠️ parcial | `ConfirmacaoEmConjuntoService.ts:106`, `AjusteCentavosTituloService.ts:313-316` |

## 4. Findings

### F-testability-1: Caminho em lote sem integration test contra Postgres + Conexos stub

- **Severidade**: P1
- **Tactic violada**: Sandbox / Recordable Test Cases
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts` (todo o fluxo `confirmarEmConjunto`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "integration" src/backend/domain/service/sispag/ | grep -i "conjunto"
  (vazio)
  $ ls src/backend/domain/service/sispag/*.integration*
  src/backend/domain/service/sispag/GrupoBoletoService.integration.test.ts  (não cobre I15t)
  ```
  Baseline só existe como run manual descrito em `_shared-metrics.md:45` ("disposable clone of local PRD copy, Conexos stub, writes off ... POST 30 rows 36.5 s → 1.3 s com um cenário por batch").
- **Impacto técnico**: regressões em `BoletoSuggestionService.confirmar` chamado 30× por conjunto (que é o único consumidor desse padrão de uso) só caem no gate manual; o decaimento 36.5s → 1.3s do cenário-por-batch não tem assertion automatizada que detecte reintrodução de N recomputes.
- **Impacto de negócio**: analista acha que 30 confirmações caíram em 1.3s em HML; se uma mudança futura regredir para 36.5s em PRD, a Columbia percebe só na ponta (gaveta trava 36s). Confirmação em conjunto é frente SISPAG hot path.
- **Métrica de baseline**: 0 integration tests cobrindo o endpoint `/confirmar-em-conjunto`; 1 run manual (não repetível em CI).

### F-testability-2: `randomUUID()` para `conjunto.id` não injetável

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:106`
- **Evidência (objetiva)**:
  ```
  const conjunto: ContextoConjunto = {
      id: randomUUID(),
      ...
  };
  ```
  Teste contorna comparando "size do Set de ids == 1" (`ConfirmacaoEmConjuntoService.test.ts:108`), mas não consegue asserir **qual** id foi gravado no log/trilha.
- **Impacto técnico**: impossível assertar o id exato propagado para `confirmar(..., conjunto)` e para o log `conjuntoId` (L142) — qualquer futuro teste de rastreabilidade cross-service tem de improvisar.
- **Impacto de negócio**: baixo. Trilha funciona em PRD; é dívida de testabilidade, não de correção.
- **Métrica de baseline**: 1 sítio de randomness não-injetado em código novo.

### F-testability-3: `agendarEmSequencia` fire-and-forget sem teste do descarte da promise

- **Severidade**: P2
- **Tactic violada**: Executable Assertions / Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:313-316`
- **Evidência (objetiva)**:
  ```
  public agendarEmSequencia = (pedidos: Array<Omit<PedidoAjuste, 'gatilho'>>): void => {
      if (pedidos.length === 0) return;
      void this.executarEmSequencia(pedidos);
  };
  ```
  O test file `AjusteCentavosTituloService.test.ts:925-975` exercita só `executarEmSequencia` await-able; o `void` fire-and-forget em si não tem assertion ("se `executarEmSequencia` rejeitar sincronamente, ninguém observa").
- **Impacto técnico**: um erro de programação que faça `executarEmSequencia` lançar antes do primeiro `await` escapa para `unhandledRejection`. O caminho feliz interno já loga por pedido, mas a casca sincrônica não é defendida.
- **Impacto de negócio**: baixo hoje (fluxo testado em HML). Médio se outro call-site chamar `agendarEmSequencia` em contexto onde unhandledRejection derruba o worker.
- **Métrica de baseline**: 1 fire-and-forget em código novo; 0 testes dele.

### F-testability-4: Arquivos de teste no entorno do SISPAG passando dos 1000 LOC

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.test.ts` (1974 LOC), `src/backend/domain/service/sispag/AjusteCentavosTituloService.test.ts` (975 LOC), `src/backend/routes/sispag.sugestaoBoleto.test.ts` (865 LOC), `src/backend/http/routePermissions.test.ts` (518 LOC)
- **Evidência (objetiva)**:
  ```
  $ wc -l src/backend/domain/service/sispag/BoletoSuggestionService.test.ts
    1974
  ```
- **Impacto técnico**: cada nova feature SISPAG acrescenta um `describe` nestes mesmos arquivos (I15t agora, I15u/I15v depois). O custo marginal de ler/debugar sobe linearmente; tempo de startup do suite também.
- **Impacto de negócio**: cresce o tempo-por-feature SISPAG. Direta consequência do fluxo "cada tweak costura num monolito".
- **Métrica de baseline**: 1974 LOC no maior arquivo de teste tocado; limite heurístico Bass = 500 LOC.

### F-testability-5: Falta de teste da `BatchConfirmationTooLargeError` no envelope de erro da rota

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/errors/BatchConfirmationTooLargeError.ts`, `src/backend/routes/sispag.sugestaoBoleto.test.ts:787-865`
- **Evidência (objetiva)**: o teste de rota mocka `confirmarEmConjunto` e cobre `/titulo/irmaos` + o 400 do query inválido; não há assertion de que, em caso de `BatchConfirmationTooLargeError`, a rota devolve 422 com `code: 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE'` e `retryable: false`. O FE test (`ConfirmacaoEmConjuntoSecao.test.tsx:168-187`) assume esse contrato.
- **Impacto técnico**: a URL/código/retryable é contrato entre FE e BE; mudança acidental em route handler quebra o diálogo em prod sem suite reclamar.
- **Impacto de negócio**: baixo (teto 30 raramente batido), mas é o único erro de negócio esperado nesse endpoint.
- **Métrica de baseline**: 1 contrato de erro BE→FE sem teste de ponta a ponta no envelope.

## 5. Cards Kanban

### [testability-1] Adicionar integration test do `confirmar-em-conjunto` em Postgres + Conexos stub

- **Problema**
  > O caminho em lote (até 30 títulos por POST) só tem baseline numérico manual (36.5s → 1.3s via "um cenário por conjunto"). Nenhum teste automatizado protege a propriedade "um `cenarioParaConjunto()` por POST, N `confirmar()` reusando-o", e a regressão só aparece na gaveta do analista em PRD.

- **Melhoria Proposta**
  > Criar `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.integration.test.ts` seguindo o estilo de `GrupoBoletoService.integration.test.ts`: Postgres em docker (ou PRD-copy local, igual à sessão da baseline), `ConexosClient` stub, dois cenários — (a) 30 linhas no caminho feliz (asserir `cenarioParaConjunto` chamado 1×, `confirmar` 30×, resultado 30× `CONFIRMADA`) e (b) um lote local virando `FINALIZADO` no meio (asserir `RECUSADA` + "lote já finalizado"). Tactic Bass: Sandbox.

- **Resultado Esperado**
  > Integration tests do caminho `/confirmar-em-conjunto`: 0 → 2. Regressão de "cenário por linha" (36.5s) detectada automaticamente (`cenarioParaConjunto` chamado > 1).

- **Tactic alvo**: Sandbox
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Integration tests em `ConfirmacaoEmConjuntoService`: 0 → 2
  - Nº de chamadas a `cenarioParaConjunto` por POST assertado em CI: 0 → 1 (igual a 1)
- **Risco de não fazer**: regressão de performance (ex.: alguém reintroduzir cenário por linha) só aparece em PRD; analista fica 36s esperando a gaveta. Mesmo risco se o lock de "lote finalizado no meio" for removido num refactor.
- **Dependências**: nenhuma (a Postgres local já é usada por `GrupoBoletoService.integration.test.ts`).

### [testability-2] Expor `UuidProvider` injetável e usá-lo no `conjunto.id`

- **Problema**
  > `ConfirmacaoEmConjuntoService.ts:106` chama `randomUUID()` direto; o `conjunto.id` é o campo de trilha de log (`conjuntoId` em L142) e carrega todo rastreamento cross-service. Teste tem de contornar com `size===1` em vez de asserir identidade.

- **Melhoria Proposta**
  > Criar `src/backend/domain/libs/uuid/UuidProvider.ts` (`@singleton() @injectable()`, `generate = () => randomUUID()`); injetar no construtor e usar em `conjunto.id`. Tactic Bass: Limit Non-Determinism (via Abstract Data Sources).

- **Resultado Esperado**
  > Testes conseguem fixar `conjuntoId` e asserir no log/trilha diretamente. Sítios de randomness não-injetados em código novo: 1 → 0.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Chamadas de `randomUUID` fora de provider em código novo: 1 → 0
  - Testes que asseguram `log.conjuntoId === fixedUuid`: 0 → ≥1
- **Risco de não fazer**: baixo isolado; vira padrão silencioso que outras features SISPAG replicam.
- **Dependências**: nenhuma.

### [testability-3] Testar o descarte do fire-and-forget de `agendarEmSequencia`

- **Problema**
  > `AjusteCentavosTituloService.agendarEmSequencia` descarta a promise com `void`. Se um bug sincrônico levar `executarEmSequencia` a lançar antes do primeiro `await`, ninguém observa. Nenhum teste exercita essa casca.

- **Melhoria Proposta**
  > Em `AjusteCentavosTituloService.test.ts`, acrescentar: (a) um `it` que faz o `agendar...` chamar a versão "await-able" e falhar antes do primeiro await (mockar `ajustar` com um throw síncrono via jest.spyOn), capturando `process` para asserir que nenhum `unhandledRejection` sobe; (b) wrap do `void` com `.catch(err => this.logService.error(...))` no production code para fechar o buraco. Tactic Bass: Executable Assertions.

- **Resultado Esperado**
  > Erro síncrono dentro de `executarEmSequencia` passa a ser logado em `BUSINESS_WARN` e assertado em teste. Fire-and-forgets não-defendidos em código novo: 1 → 0.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Testes de descarte de promise em `agendarEmSequencia`: 0 → 1
  - Chamadas a `.catch` protegendo fire-and-forget: 0 → 1
- **Risco de não fazer**: em caso raro de bug sincrônico, worker Express cai com `unhandledRejection`; o conjunto já disse "OK" ao FE, mas o ajuste não roda nem loga.
- **Dependências**: nenhuma.

### [testability-4] Partir os test files SISPAG acima de 1000 LOC por eixo

- **Problema**
  > `BoletoSuggestionService.test.ts` (1974 LOC) e `AjusteCentavosTituloService.test.ts` (975 LOC) são o monólito onde cada nova invariante SISPAG costura mais um `describe`. O diff adicionou 127 passes em um e 38 no outro. O custo marginal de leitura/edição cresce linearmente; já é a fonte principal de merge-conflict interno nos ciclos SISPAG.

- **Melhoria Proposta**
  > Separar os `describe` por invariante / eixo em sibling files (ex.: `BoletoSuggestionService.confirmar.test.ts`, `BoletoSuggestionService.cenario.test.ts`, `BoletoSuggestionService.desfecho.test.ts`), reusando helpers em `__fixtures__`. Tactic Bass: Limit Structural Complexity.

- **Resultado Esperado**
  > Maior test file em `domain/service/sispag/` cai de 1974 LOC para ≤700 LOC. Tempo de edição de teste SISPAG por feature cai (observável em merge-conflict rate).

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Maior test file em `domain/service/sispag/`: 1974 → ≤700 LOC
  - Nº de arquivos de teste por serviço SISPAG hot: 1 → 3–4
- **Risco de não fazer**: toda feature SISPAG seguinte (ADR-0081, 0082…) acresce 100–300 LOC no mesmo arquivo; chegada aos 3000 LOC em 2–3 ciclos. Review desatenta.
- **Dependências**: nenhuma. Pode ser feito num `/feature-tweak` dedicado.

### [testability-5] Teste de contrato de erro BE→FE para `BatchConfirmationTooLargeError`

- **Problema**
  > O FE assume `{ error, code: 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE', retryable: false, status: 422 }` (`ConfirmacaoEmConjuntoSecao.test.tsx:170-178`), mas nenhum teste de BE confirma que a rota devolve exatamente esse envelope quando o service lança `BatchConfirmationTooLargeError`. É um contrato implícito.

- **Melhoria Proposta**
  > Acrescentar em `src/backend/routes/sispag.sugestaoBoleto.test.ts` um `it` que mocka `confirmarEmConjunto` para rejeitar com `new BatchConfirmationTooLargeError({ pedidas: 31, maximo: 30 })` e assegura `status === 422`, `body.code === 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE'`, `body.retryable === false`, e `body.error` com a frase pt-BR exata que o FE assume. Tactic Bass: Executable Assertions / Specialized Interfaces.

- **Resultado Esperado**
  > Contrato de erro em lote assegurado em CI. Mudar o code/retryable sem atualizar o FE passa a quebrar o teste.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Testes de envelope de erro para `/confirmar-em-conjunto`: 0 → 1
- **Risco de não fazer**: refactor do handler muda silenciosamente o envelope; diálogo FE deixa de mostrar "no máximo 30" e exibe a mensagem genérica.
- **Dependências**: nenhuma.

## 6. Notas do agente

- `--quick` ativo: não rodei `npm test -- --coverage`. Baseline numérico veio do `_shared-metrics.md` + inspeção dos test files tocados.
- Pontos fortes do diff que **não** viram card (mas vale registrar para o consolidator): `RegraIrmaosConjunto.test.ts` roda o motor **real** em vez de mock (18 cases), e `BankingCalendar.withClock` é usado em todos os pontos sensíveis a tempo. Isso é tactic "Limit Non-Determinism" exemplar e eleva o score do diff.
- Cross-QA: F-testability-1 (Sandbox / integration) toca também **Deployability** (gate antes do deploy) e **Performance** (defender o ganho 36.5s → 1.3s). F-testability-3 (`void` fire-and-forget) toca **Fault Tolerance** (unhandledRejection). F-testability-5 (contrato de erro) toca **Integrability** (contratos BE↔FE).
- Teste do caminho "fila de ajuste roda em segundo plano, resposta volta na hora" é observação cross-QA com **Performance** (p95 do POST do conjunto não inclui tempo de `fin070`).
