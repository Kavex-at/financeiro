---
qa: Performance
qa_slug: performance
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-performance
generated_at: 2026-09-22T20:00:00-03:00
scope: backend + frontend (delta da branch fix/sispag-data-pagamento)
score: 8
findings_count: 2
cards_count: 2
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (UI) | Abre o diálogo "Gerar remessa" (`GET /sispag/lotes/:id/remessa/janela`) e confirma a geração (`POST /sispag/lotes/:id/remessa`) para um lote FINALIZADO | `DebitDateService.computeWindow`, `BankingCalendar`, `LotePagamentoRepository`, `RemessaService.resolverDataDebito` | Operação normal — dezenas de lotes/dia, poucos títulos por lote, janela de débito de poucos dias a ~30 dias (o painel só lista títulos a vencer ≤30d; a formação automática só pega ≤7d) | A janela é calculada e devolvida sem round-trip extra ao Conexos; a data é persistida no Postgres ANTES do `criarLote` do fin015, sem aumentar o número de chamadas ao ERP | 0 chamadas novas ao Conexos introduzidas pelo delta; `GET .../janela` resolve com 2 SELECTs por PK; `POST .../remessa` ganha 1 UPDATE local (não ERP) só no caminho de criação de lote nativo |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas novas ao Conexos introduzidas pelo delta | 0 | 0 (nenhuma nova latência de 2-10s do Conexos no caminho crítico) | ✅ | `git diff origin/main...HEAD -- src/backend/domain/service/sispag/RemessaService.ts` — nenhuma chamada nova a `this.write.*`/`this.sispag.*`; `resolverDataDebito` só lê o `lote` já carregado e chama `this.calendar.todayBrt()` (puro, sem I/O) |
| Queries por requisição `GET /sispag/lotes/:id/remessa/janela` | 2 (header + itens, via `getLoteComItens`) | ≤3 por leitura de detalhe | ✅ | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts:190-212` |
| Queries extras por `POST /sispag/lotes/:id/remessa` (delta) | +1 UPDATE (`setDataDebito`), só no ramo que cria lote nativo | Não aumentar chamadas ao ERP; UPDATE local é aceitável | ✅ | `LotePagamentoRepository.ts:498-508`; `RemessaService.ts:449` |
| Sites de N+1 (`await repo.X()` dentro de loop) no delta | 0 | 0 | ✅ | `computeWindow`/`itemMaisCedo` iteram `lote.itens` (array já em memória, sem I/O); nenhum `for/map` com `await repo.*` dentro |
| Novas dependências de runtime (`package.json`) | 0 | ≤15 (delta não deve crescer o baseline) | ✅ | `git diff origin/main...HEAD -- src/backend/package.json src/frontend/package.json` → vazio |
| Índice necessário para `lote_pagamento.data_debito` | Nenhuma cláusula `WHERE data_debito` no código | N/A — coluna é só exibida/gravada, nunca filtrada | ✅ | `grep -rn "data_debito" src/backend --include="*.ts"` — só `SELECT`/`SET`, nenhum `WHERE data_debito` |
| Recomputações de `BankingCalendar.holidays(year)` sem cache por laço de `computeWindow` | 1 por dia iterado entre `min` e `max` (pior caso observado ~30, pelo teto de 30d do painel; sem cap explícito na API) | Memoizar por ano — O(1) amortizado | ⚠️ | `src/backend/domain/libs/calendar/BankingCalendar.ts:80-93`, `src/backend/domain/service/sispag/DebitDateService.ts:90-95` |
| Latência real (p50/p95) de `GET .../janela` e `POST .../remessa` em produção/HML | — | p95 janela < 200ms; p95 remessa dominado pelo Conexos (2-10s), não pelo delta | ⚠️ **Não medível localmente** | Requer CloudWatch/APM em produção (Render hoje não expõe; alvo Lambda ainda não existe). Recomendação: instrumentar `LogService` com duração de `computeWindow`/`getWindow` quando o `ObservabilityAdvisor` rodar. |
| Bundle/cold start | — | N/A neste ciclo (backend roda em Express/Render, não Lambda) | ⚠️ **Não medível/aplicável** | CLAUDE.md: infra Lambda é estado-alvo, não existe hoje. Ver `_shared-metrics.md` (infra "Não medível — não existe neste repo"). |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Não aplicável a este componente — não há coleta de telemetria por amostragem no delta | N/A — nenhuma fonte de eventos de alta cadência é tocada | — |
| Limit Event Response | `POST /sispag/lotes/:id/remessa` já usa `heavyRouteLimiter` (pré-existente, mantido). `GET .../remessa/janela` (nova) não tem limiter, mas é leitura de 2 SELECTs por PK, mesmo padrão de `GET /lotes/:id` | ✅ presente (consistente com o padrão já usado nas rotas de leitura do arquivo) | `src/backend/routes/sispag.ts:442-453` vs `:458-461` |
| Prioritize Events | N/A — não há fila/priorização de eventos neste delta (é HTTP request/response síncrono) | N/A — fora do escopo do componente | — |
| Reduce Overhead | `BankingCalendar` calcula o calendário bancário **em código** (Páscoa por algoritmo de Meeus/Jones/Butcher), sem tabela externa, sem chamada de rede, sem dependência nova — evita o overhead de uma API de feriados ou de uma tabela a manter | ✅ presente — acerto do delta | `src/backend/domain/libs/calendar/BankingCalendar.ts:26-37` (docstring explícita da decisão) |
| Bound Execution Times | O laço `for (d = min; d <= max; ...)` em `computeWindow` não tem um teto explícito de iterações — depende do `vencimento` do título mais distante do lote, que não é limitado na inclusão manual (`incluirTitulo` só valida `pago`/`liberado`/filial, não a distância do vencimento) | ⚠️ parcial — sem guarda explícita, ainda que o painel só liste títulos a vencer ≤30d na prática | `DebitDateService.ts:89-95`; `LotePagamentoService.ts:161-201` (nenhuma checagem de `diasAteVencimento`) |
| Increase Resource Efficiency | `BankingCalendar.holidays(year)` é recalculado (Páscoa + 2 arrays + sort) a cada chamada de `isBusinessDay`, inclusive dentro do próprio laço de `computeWindow` — sem memoização por ano | ❌ ausente — ver F-performance-1 | `BankingCalendar.ts:80-93` |
| Increase Resources | N/A — infra Lambda/ARM é estado-alvo; hoje roda em Render/Express, fora do escopo deste delta | N/A — justificativa: nenhuma mudança de infra no delta | — |
| Increase Concurrency | N/A — nenhuma mudança de pool de conexões, `reserved_concurrent_executions` ou paralelismo neste delta | N/A | — |
| Maintain Multiple Copies of Computations | N/A — não há replicação de cômputo (ex.: réplica de leitura) relevante a este componente | N/A | — |
| Maintain Multiple Copies of Data | A `data_debito` é fonte única no Postgres, congelada a partir do `criarLote` (I8b) — deliberadamente **não** há cache/cópia paralela dela, o que é correto para a invariante (evita divergência entre cache e ERP) | ✅ presente por design (ausência de cache é a decisão certa aqui) | `LotePagamentoRepository.ts:494-508`; `data-debito-remessa-sispag.md` I8b |
| Bound Queue Sizes | N/A — nenhuma fila SQS é tocada por este delta | N/A | — |
| Schedule Resources | N/A — nenhum job/EventBridge novo; os dois jobs tocados (`execute-fin015-prd.ts`, `validate-retomada-remessa-v1.ts`) são scripts manuais de teste, não scheduler | N/A | `_shared-metrics.md` — mudança nesses arquivos é só trocar `hojeUtc()` local por `BankingCalendar` |

## 4. Findings (achados)

### F-performance-1: `BankingCalendar.holidays(year)` recomputado sem memoização em cada dia do laço de janela

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/libs/calendar/BankingCalendar.ts:80-93` (chamado por `src/backend/domain/service/sispag/DebitDateService.ts:90-95`)
- **Evidência (objetiva)**:
  ```ts
  // BankingCalendar.ts
  public isBusinessDay = (civil: CivilDate): boolean => {
      const date = this.parse(civil);
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) return false;
      return !this.holidays(date.getUTCFullYear()).includes(civil); // recalcula Páscoa + monta 2 arrays + sort() a CADA chamada
  };

  // DebitDateService.ts — laço que chama isBusinessDay uma vez por dia entre min e max
  for (let d = min; d <= max; d = this.calendar.addDays(d, 1)) {
      if (!this.calendar.isBusinessDay(d)) naoUteis.push(d);
  }
  ```
- **Impacto técnico**: `holidays(year)` roda o algoritmo de Páscoa (Meeus/Jones/Butcher) e monta+ordena um array de ~9-10 feriados a cada dia iterado, mesmo quando o ano não muda entre iterações consecutivas. O custo por chamada é baixo (microssegundos), mas é 100% redundante dentro do mesmo `computeWindow` — toda vez que a janela é calculada (a cada `GET .../janela` e a cada `POST .../remessa`), o mesmo ano é recalculado N vezes (N = dias entre `min` e `max`, hoje tipicamente ≤30 pelo teto do painel, mas sem garantia formal — ver F-performance-2).
- **Impacto de negócio**: Nenhum hoje (latência de milissegundos, invisível ao lado dos 2-10s do Conexos). Vira relevante só se a Frente II crescer para lotes com vencimentos muito distantes, ou se `computeWindow` passar a ser chamado em lote (ex.: painel listando a janela de dezenas de lotes de uma vez).
- **Métrica de baseline**: até ~30 recomputações de `holidays(year)` por chamada de `computeWindow` no pior caso observado hoje (janela de 30 dias); 0 dessas recomputações são cacheadas entre si.

### F-performance-2: laço de dias não-úteis sem teto explícito — depende de um dado de negócio não limitado na inclusão manual

- **Severidade**: P3
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/DebitDateService.ts:89-95`; `src/backend/domain/service/sispag/LotePagamentoService.ts:161-201` (`incluirTitulo`)
- **Evidência (objetiva)**:
  ```ts
  // DebitDateService.ts:89-95 — sem cota superior de iterações
  let max = menorVencimento;
  while (!this.calendar.isBusinessDay(max)) max = this.calendar.addDays(max, -1);
  const naoUteis: string[] = [];
  for (let d = min; d <= max; d = this.calendar.addDays(d, 1)) {
      if (!this.calendar.isBusinessDay(d)) naoUteis.push(d);
  }
  ```
  ```ts
  // LotePagamentoService.ts:161-201 — incluirTitulo valida pago/liberado/filial, NÃO a distância do vencimento
  if (titulo.pago) { throw new TituloNaoElegivelError({ ..., motivo: 'ja-pago' }); }
  if (!titulo.liberado) { throw new TituloNaoElegivelError({ ..., motivo: 'nao-liberado' }); }
  // nenhuma checagem de `diasAteVencimento` aqui
  ```
- **Impacto técnico**: hoje o teto prático vem do painel (só lista títulos a vencer ≤30d) e da formação automática (≤7d), não de uma validação de domínio. Se um título com vencimento muito distante (ex.: 1 ano) for incluído manualmente num lote, `computeWindow` itera centenas de dias — ainda microssegundos de CPU, mas é uma garantia ausente, não uma garantia presente.
- **Impacto de negócio**: Baixo hoje; risco cresce se o painel ou a formação automática mudarem de janela (30d → sem limite) sem que alguém revisite este laço.
- **Métrica de baseline**: nenhum caso de produção observado com janela > 30 dias (o painel corta em 30d); ausência de guarda explícita é o achado, não uma degradação medida.

## 5. Cards Kanban

### [performance-1] Memoizar `BankingCalendar.holidays(year)` por ano

- **Problema**
  > `holidays(year)` recalcula a Páscoa e remonta+ordena o array de feriados a cada chamada de `isBusinessDay`, inclusive dentro do mesmo laço de `computeWindow` que itera vários dias do mesmo ano seguidas (F-performance-1). O custo unitário é baixo, mas é trabalho 100% redundante e cresce linearmente com o tamanho da janela.

- **Melhoria Proposta**
  > Tactic **Increase Resource Efficiency**: adicionar um cache `Map<number, CivilDate[]>` por ano em `BankingCalendar` (`private holidaysCache`), populado sob demanda em `holidays(year)`. Como o `BankingCalendar` é `@singleton()`, o cache sobrevive entre requisições no mesmo processo Express — sem invalidação necessária (feriados de um ano não mudam em runtime). Tocar só `src/backend/domain/libs/calendar/BankingCalendar.ts`.

- **Resultado Esperado**
  > Recomputações de `holidays(year)` por chamada de `computeWindow`: até ~30 (pior caso hoje) → 1 por ano distinto na janela (tipicamente 1, no máximo 2 em janelas que cruzam virada de ano). CPU gasta no cálculo de feriados por requisição: reduzida a uma fração fixa, independente do tamanho da janela.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Recomputações de `holidays(year)` por `computeWindow`: N (dias na janela) → 1 por ano distinto
  - Cobertura de teste: `BankingCalendar.test.ts` ganha um caso que chama `isBusinessDay` N vezes no mesmo ano e verifica (via spy/contador) que `easter()` roda 1 vez
- **Risco de não fazer**: Nenhum incidente hoje; se a Frente II passar a calcular janelas de várias dezenas de lotes de uma vez (ex.: um "recalcular todas as janelas" em lote), o custo agregado deixa de ser desprezível.
- **Dependências**: nenhuma

### [performance-2] Explicitar um teto de dias na janela de débito e validar a distância do vencimento na inclusão manual

- **Problema**
  > O laço de `computeWindow` que monta `naoUteis` não tem cota superior de iterações — ele confia que o `vencimento` mais distante do lote seja "razoavelmente próximo", uma garantia que hoje só existe fora do domínio (painel corta em 30d; formação automática em 7d), não dentro de `incluirTitulo` ou `computeWindow` (F-performance-2).

- **Melhoria Proposta**
  > Tactic **Bound Execution Times**: (a) em `DebitDateService.computeWindow`, aplicar um teto explícito (ex.: 90 dias) ao tamanho da janela antes de iterar, devolvendo `vazia` com um motivo dedicado (`JANELA_MUITO_LONGA` ou similar) se excedido — fail-closed, alinhado ao estilo já usado no arquivo ("na dúvida, fecha"); (b) opcionalmente, seria válido debater com o ownership do domínio (`ontology/business-rules/data-debito-remessa-sispag.md`, owner Yuri) se `incluirTitulo` deveria também recusar títulos além de um horizonte de negócio — mas isso é uma decisão de regra de negócio, não só de performance, e fica fora do escopo estritamente técnico deste card.

- **Resultado Esperado**
  > `computeWindow` passa a ter uma cota superior determinística e testável (0 casos de laço > 90 iterações), documentada e coberta por teste em `DebitDateService.test.ts`, em vez de depender implicitamente do comportamento de outras camadas (painel, formação automática).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Teto de iterações do laço de `naoUteis`: indefinido → 90 dias (valor sugerido, a confirmar com o owner de domínio)
  - Teste novo em `DebitDateService.test.ts`: janela com vencimento > teto → `vazia` com motivo dedicado
- **Risco de não fazer**: Baixo isoladamente; some ao risco geral de "regra de domínio garantida só por convenção entre camadas" (mesma classe de risco que motivou a `data-debito-remessa-sispag.md` a existir).
- **Dependências**: nenhuma; card independente do performance-1.

## 6. Notas do agente

- Escopo: revisão **do delta** (`git diff origin/main...HEAD`), `--quick`, sem medição ao vivo (nenhuma escrita no ERP, nenhum script executado). Métricas de latência real (p50/p95) e bundle/cold start ficam "não medível localmente" — infra Lambda é estado-alvo (CLAUDE.md), backend atual roda em Express/Render.
- Nenhum P0/P1 encontrado no delta: a implementação evita N+1, evita chamadas novas ao Conexos, reusa o `lote` já carregado, e calcula o calendário bancário em código (sem rede/tabela) — boa disciplina de performance para uma feature que só toca leitura local + 1 UPDATE extra no caminho de escrita.
- **Cross-QA**: a rota nova `GET /sispag/lotes/:id/remessa/janela` não tem `requireRole('admin')` (diferente de rotas irmãs como `/linhas-digitaveis` e `/contas-pagadoras`, que tratam dado sensível) — isso é achado de **Security**, não de Performance; sinalizar para o `qa-security` conferir se a janela de débito (que expõe `TituloLimitante.credor`/`documento`) merece o mesmo guard. Índices/schema (F-performance-2 tangencia isso) overlap com **Modifiability** se a regra do teto de dias virar constante de domínio versionada na ontologia.
