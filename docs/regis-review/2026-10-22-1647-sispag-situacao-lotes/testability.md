---
qa: Testability
qa_slug: testability
run_id: 2026-10-22-1647-sispag-situacao-lotes
agent: qa-testability
generated_at: 2026-10-22T19:50:00-03:00
scope: all
score: 7.5
findings_count: 7
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que mexe na regra de prontidão / finalização | PR altera `ProntidaoLoteResolver`, `ProntidaoLoteService`, `LotePagamentoService.exigirSituacoesPagaveis` ou `FinalizarProntos` | Lotes SISPAG em rascunho (regra `prontidao-lote` I20, ADR-0076): selo, filtro, pendências, finalizar-em-massa, guarda `exigirSituacoesPagaveis` no `finalizarLote` | Dev/CI (jest unit + `backend-sql`) | O teste reproduz a quebra em um só describe, local, sem Conexos nem Postgres (unit) e com Postgres descartável (integration) | ≥ 90% das invariantes I20a–I20h cobertas por teste direto; coverage dos arquivos novos ≥ 90% linhas; falha visível em < 60s; zero teste exigindo mock por tipagem para dependência que já tem seam DI |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Casos de teste do `ProntidaoLoteResolver` (puro, sem I/O) | 12 `it()` sobre 11 códigos de pendência + sort/dedupe | ≥ 10 (um por código) | ✅ | `src/backend/domain/service/sispag/ProntidaoLoteResolver.test.ts:67-238` |
| Casos de teste do `ProntidaoLoteService` (orquestração) | 4 (anexa só a RASCUNHO, ajuste por lote, sem RASCUNHO não consulta, falha vira WARN+passthrough) | ≥ 4 | ✅ | `src/backend/domain/service/sispag/ProntidaoLoteService.test.ts:63-106` |
| Novos casos ADR-0076 I20d em `LotePagamentoService.test.ts` | 4 (BLOQUEADO + lê fin064 ao vivo + fail-closed Conexos/sumido/pago + fora-da-carteira/fonte caída) | ≥ 4 | ✅ | `src/backend/domain/service/sispag/LotePagamentoService.test.ts:666-767` |
| Novos casos ADR-0076 em `SituacaoPagamentoService.test.ts` | 3 (`avaliarVivos` ordem, `avaliarVivos` leitura falhou, `avaliarGravados` fontes) | ≥ 3 | ✅ | `src/backend/domain/service/sispag/SituacaoPagamentoService.test.ts:364-423` |
| LOC `LotePagamentoService.test.ts` | 1 517 | ≤ 500 por describe raiz | ❌ | `wc -l` |
| Casos de rota de `GET /lotes` exercitando `comProntidao` (resposta carrega `prontidao`) | 0 — service mockado como passthrough (`comProntidao: async (lotes) => lotes`) | ≥ 1 | ⚠️ | `src/backend/routes/sispag.test.ts:116-120`, `src/backend/routes/sispag.ts:220-247` |
| Casos cobrindo mix de resultados em `exigirSituacoesPagaveis` (item 1 OK, item 2 bloqueia, item 3 OK) | 0 — tests ou todos passam ou todos falham com a MESMA causa | ≥ 2 | ⚠️ | `src/backend/domain/service/sispag/LotePagamentoService.test.ts:715-767`, impl em `LotePagamentoService.ts:753-786` (loop sequencial `for (const item of itens)`) |
| Testes de duplo-disparo em `FinalizarProntos` + endpoint `/lotes/:id/finalizar` (idempotência / otimistic-lock) | 0 — nem o endpoint aceita `Idempotency-Key`, nem o cliente passa um | ≥ 1 cliente + 1 rota | ⚠️ | `src/backend/routes/sispag.ts:374-399` (não lê `req.header('Idempotency-Key')`), `src/frontend/app/sispag/lotes/FinalizarProntos.tsx:61-64`, `src/frontend/app/sispag/lotes/prontidaoLotes.ts:102-122` |
| Property-based tests no delta (dep `fast-check` disponível no repo) | 0 — nenhum `fc.property` em arquivos novos | ≥ 1 no resolver (invariante `barram + saem + prontos ≤ itens.length` e ordenação) | ⚠️ | `grep -rn fast-check src/backend/domain/service/sispag/ProntidaoLote* src/frontend/app/sispag/lotes/*.ts` → vazio |
| Integration tests novos (repos) rodando em `backend-sql` | 2 (`buscarPorChaves` em `TituloAPagarRepository.integration.test.ts:198-214`; `titulosComAjusteNaoTerminalNosLotes` em `AjusteCentavosExecucaoRepository.integration.test.ts:408-425`) | ≥ 1 por método novo com SQL não trivial | ✅ | `src/backend/domain/repository/sispag/*.integration.test.ts` |
| Não-determinismo (clock/random) introduzido no código de produção | 0 — nenhum `new Date()`/`Date.now()`/`Math.random()`/`crypto.randomUUID()` fora de teste nos arquivos novos | 0 | ✅ | `grep -rn 'new Date\|Date.now\|Math.random\|crypto.randomUUID' src/backend/domain/service/sispag/ProntidaoLote* src/frontend/app/sispag/lotes/` |
| Log assertions em caminho de erro (`ProntidaoLoteService.comProntidao` falhou → WARN) | 1 teste explícito | ≥ 1 | ✅ | `ProntidaoLoteService.test.ts:96-106` |
| Coverage % linhas em arquivos novos | ⚠️ **Não medível localmente neste run** (flag `--quick`); estimado alto a partir da contagem de `it()` × caminhos | ≥ 85% | ⚠️ | `--quick` baniu `npm test -- --coverage`; recomenda-se rodar `cd src/backend && npm test -- --coverage --collectCoverageFrom='src/domain/service/sispag/{ProntidaoLote*,SituacaoPagamentoService,LotePagamentoService}.ts'` |

> ⚠️ **Não medível localmente**: coverage por diretório. O protocolo `--quick` deste run bloqueia `jest --coverage`. Recomendação: ativar o gate `coverageThreshold` só nos arquivos do delta (`ProntidaoLoteResolver.ts`, `ProntidaoLoteService.ts`, bloco `exigirSituacoesPagaveis`) no `jest.config.*`, com piso de 90% linhas e 80% branches — é o nicho em que vale a pena enforçar.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `ProntidaoLoteResolver` é puro: recebe `ContextoProntidao` explícito (`situacoes`, `fontesIndisponiveis`, `emAjuste`) sem I/O → teste sem mock | ✅ | `ProntidaoLoteResolver.ts:32-39, 139-163`; `ProntidaoLoteResolver.test.ts` usa `new ProntidaoLoteResolver()` sem container |
| Recordable Test Cases | `avaliarVivos` recebe `vivo` como parâmetro (sem `getTituloAPagar` encapsulado); o teste do service de prontidão mocka `avaliarGravados` como `jest.fn(async (chaves) => ...)` reproduzindo a forma do contrato | ✅ | `ProntidaoLoteService.test.ts:38-49` |
| Sandbox | Integration tests de repo criam/dropam `titulo_a_pagar_repo_it` e `sispag_ajuste_repo_it` com `DROP DATABASE IF EXISTS … WITH (FORCE)` e exigem DSN localhost | ✅ | `TituloAPagarRepository.integration.test.ts:44-64`; `AjusteCentavosExecucaoRepository.integration.test.ts:21-45` |
| Executable Assertions | `exigirSituacoesPagaveis` emite `BatchHasBlockedItemsError` com `itens[]` + `motivo` + `rotulo` por item — assert direto no teste; `prontidaoLotes.contarProntidao` devolve objeto estruturado | ✅ | `LotePagamentoService.test.ts:715-767`; `prontidaoLotes.test.ts:47-53` |
| Abstract Data Sources | DI via tsyringe: `ProntidaoLoteService` recebe `SituacaoPagamentoService`, `LotePagamentoRepository`, `LogService` via `@inject` — teste constrói com mocks em `new ProntidaoLoteService(...)` | ✅ | `ProntidaoLoteService.ts:19-24`; `ProntidaoLoteService.test.ts:54-60` |
| Limit Structural Complexity | `ProntidaoLoteResolver` tem 259 LOC com uma tabela `PERFIL` canônica, mas o teste único vai bem; `LotePagamentoService.test.ts` já estava em 1 404 LOC e cresceu para 1 517 (card `modifiability-3` do ciclo anterior) | ⚠️ | `wc -l src/backend/domain/service/sispag/LotePagamentoService.test.ts` → 1 517 |
| Limit Non-Determinism | Zero `new Date()`/`Math.random()` nos arquivos novos; `BankingCalendar.withClock` já era injetado onde pertinente; o resolver é puramente determinístico (sort estável por efeito/valor) | ✅ | `grep -rn 'new Date\|Date.now\|Math.random' src/backend/domain/service/sispag/ProntidaoLote*` → vazio |

## 4. Findings (achados)

### F-testability-1: `exigirSituacoesPagaveis` lê `fin064` item-a-item sem teste de resultado heterogêneo

- **Severidade**: P1
- **Tactic violada**: Limit Non-Determinism (ordem de resposta por item) + Specialized Interfaces (ausência de assert sobre mistura)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:727-786`; testes em `src/backend/domain/service/sispag/LotePagamentoService.test.ts:715-767`
- **Evidência (objetiva)**:
  ```ts
  // LotePagamentoService.ts:761
  for (const item of itens) {
      const vivo = await this.conexos
          .getTituloAPagar(item.filCod, item.docCod, item.titCod)
          .catch(() => undefined);
      if (vivo === undefined) bloqueados.push({ ... rotulo: 'situação não conferida' });
      else if (vivo === null) bloqueados.push({ ... rotulo: 'título não encontrado no Conexos' });
      else if (vivo.pago)    bloqueados.push({ ... rotulo: 'título já pago no Conexos' });
      else lidos.push({ item, vivo });
  }
  ```
  Os quatro testes do bloco "ADR-0076 I20d" aplicam a MESMA resposta a TODOS os itens (`make(repo, titulo())`, `make(repo, null)`, `getTituloAPagar.mockRejectedValue('503')`, `avaliarVivos.mockResolvedValue([bloqueada, pronta])`). Nenhum caso mistura dentro do mesmo lote (ex.: item 1 sumido, item 2 pago, item 3 OK, item 4 bloqueado por situação): a composição de `bloqueados` com `identificacao(item)` por item nunca é exercitada.
- **Impacto técnico**: um refactor para `Promise.all` paralelizando a leitura (prov. necessário quando um lote tiver 50+ itens — hoje a `exigirSituacoesPagaveis` é O(n) de latência Conexos) muda a ordem de `bloqueados[]` e passa verde. A mensagem para a analista pode ficar não-determinística ("100/1 (ACME): …" aleatório).
- **Impacto de negócio**: a recusa de um lote na finalização em massa pode listar itens em ordem instável, confundindo a analista sobre qual item resolver primeiro — exatamente o cenário que motivou o selo (ADR-0076).
- **Métrica de baseline**: 0 testes com resultado por item heterogêneo em `exigirSituacoesPagaveis`; 1 loop sequencial, 1 `.catch(() => undefined)` sem assert de identificação por índice.

### F-testability-2: `FinalizarProntos` e `/lotes/:id/finalizar` sem `Idempotency-Key` nem teste de duplo-disparo

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (comportamento sob reentrância), Limit Non-Determinism (chave idempotente)
- **Localização**: `src/backend/routes/sispag.ts:374-399` (handler), `src/frontend/app/sispag/lotes/FinalizarProntos.tsx:38-64`, `src/frontend/app/sispag/lotes/prontidaoLotes.ts:102-122`
- **Evidência (objetiva)**:
  ```ts
  // routes/sispag.ts:378-399 — handler finalizar
  asyncHandler(async (req, res) => {
      // ... parsed = versaoSchema; versao + ator; SEM leitura de Idempotency-Key
      const { lote, retirados } = await service.finalizarLote(input);
  ```
  ```ts
  // FinalizarProntos.tsx:61-64
  const confirmar = async () => {
      setFeitos(0);
      setResultados(await finalizarEmSequencia(alvo, finalizar, setFeitos));
  };
  ```
  A proteção efetiva contra duplo-clique vem da transição `RASCUNHO → FINALIZADO` ser idempotente por `versaoEsperada` (optimistic lock). Nenhum teste em `prontidaoLotes.test.ts` nem em `prontidaoComponentes.test.tsx` nem em `routes/sispag.test.ts` reproduz: "cliente dispara duas vezes seguidas o botão enquanto a 1ª remessa de requisições está em curso" — nem para verificar que o 2º lote da 2ª rodada erra com `LoteEstadoInvalidoError`.
- **Impacto técnico**: um teste de regressão novo que adicione `await` no caminho errado (ex.: setar `setFeitos(null)` antes de `setResultados`) permite reentrada do `confirmar` com `alvo` repetido; só o lock no server impede duplicação, mas nada avisa quando essa proteção quebrar.
- **Impacto de negócio**: finalização em massa é a operação CARA (dispara `fin064` ao vivo item-a-item + verificação TED/PIX). Um fluxo que acabe disparando-a 2× em paralelo pode saturar o pool do Postgres e a cota do Conexos — o `fin064` é o endpoint mais contado do tenant.
- **Métrica de baseline**: 0 testes de concorrência cliente / 0 teste de rota com 2 chamadas simultâneas; 0 header `Idempotency-Key` no handler.

### F-testability-3: rota de `GET /lotes` mocka o `ProntidaoLoteService` como passthrough

- **Severidade**: P2
- **Tactic violada**: Executable Assertions na fronteira HTTP
- **Localização**: `src/backend/routes/sispag.test.ts:116-120`; implementação em `src/backend/routes/sispag.ts:220-247`
- **Evidência (objetiva)**:
  ```ts
  // routes/sispag.test.ts:116-120
  beforeEach(() => {
      container.registerInstance(ProntidaoLoteService, {
          comProntidao: async (lotes: unknown[]) => lotes,
      } as never);
  });
  ```
  A rota `GET /sispag/lotes` passa a lista por `apiView().lotes(await ... .comProntidao(await service.listarLotes(parsed.data)))`. Com o mock passthrough, o teste existente verifica apenas que `listarLotes` foi chamada; nada prova que `apiView().lotes()` preserva a chave `prontidao` (há um teste no front, mas no espelho de tipo, não no serializador do backend).
- **Impacto técnico**: um refactor em `LotePagamentoApiView` que não copie a chave `prontidao` passa pelos tests do backend e só é pego pelo teste de página do frontend (que mocka `/api/sispag/lotes`). O gap é a serialização BE.
- **Impacto de negócio**: regressão silenciosa que suma o selo da listagem; a analista perde o filtro "Prontos para finalizar" e não há aviso.
- **Métrica de baseline**: 0 testes de rota validam o campo `prontidao` na resposta JSON.

### F-testability-4: `LotePagamentoService.test.ts` em 1 517 LOC

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (unit de teste)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.test.ts`
- **Evidência (objetiva)**:
  ```
  $ wc -l src/backend/domain/service/sispag/LotePagamentoService.test.ts
  1517
  ```
  O arquivo cresceu de ~1 400 para 1 517 LOC só nesta branch (adicionou o `describe('ADR-0076 I20d')`). Já havia o card `modifiability-3` do review anterior pedindo a quebra. O arquivo mistura 7 áreas: `criarLotesPorFilial`, `incluirTitulo`, `finalizarLote` (gate), `verificação TED/PIX`, `concorrência/CRUD`, `atualizarContaPagadora`, `modalidade (A2)`.
- **Impacto técnico**: cada mudança no gate implica scroll de 1 500 linhas e `buildRepo`/`buildDestinoDeps` compartilhados por 95 `it()` — o custo marginal de um teste novo cresce com N.
- **Impacto de negócio**: dev que mexe no gate paga tempo de contexto cada ciclo; probabilidade de teste duplicado ou de assert em dependência mockada estática aumenta.
- **Métrica de baseline**: 1 517 LOC / 95 `it()`; alvo ≤ 600 LOC por arquivo de teste de service.

### F-testability-5: `fast-check` disponível no repo, não usado no delta apesar do espaço combinatório do resolver

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (invariantes de domínio)
- **Localização**: `src/backend/domain/service/sispag/ProntidaoLoteResolver.ts`; `src/frontend/app/sispag/lotes/prontidaoLotes.ts`
- **Evidência (objetiva)**: `grep -rn 'fast-check' src/backend/domain/service/sispag/ProntidaoLote* src/frontend/app/sispag/lotes/*.ts` → vazio. O resolver tem invariantes naturais: `pendencias.length === sum(doLote.length + porItem.flatMap(...))`, `itensQueVao === itens.length - saem`, `ordem: BARRA antes de SAI`, "SITUACAO_BLOQUEADA e AJUSTE_EM_ANDAMENTO não co-ocorrem na mesma chave" (`ajusteNaSituacao` em `ProntidaoLoteResolver.ts:178-180`).
- **Impacto técnico**: um grep que remova por engano a de-dup `ajusteNaSituacao` passa nos testes case-by-case, mas quebraria uma propriedade.
- **Impacto de negócio**: baixo — regressão caseirinha. Mas o dep já está lá e a oportunidade é barata.
- **Métrica de baseline**: 0 `fc.property` nos arquivos novos; `fast-check` presente em `src/backend/package.json`.

### F-testability-6: `ProntidaoLoteService` propaga `fontesIndisponiveis` do contexto, sem teste com fonte caída via Service real

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases (integração Service↔Resolver sob falha parcial)
- **Localização**: `src/backend/domain/service/sispag/ProntidaoLoteService.ts:37-57`; `src/backend/domain/service/sispag/ProntidaoLoteService.test.ts:38-49`
- **Evidência (objetiva)**:
  ```ts
  // ProntidaoLoteService.test.ts:38-49 — mock padrão retorna fontesIndisponiveis: []
  avaliarGravados: over.avaliarGravados ??
      jest.fn(async (chaves) => ({
          situacoes: new Map(...),
          fontesIndisponiveis: [],
      })),
  ```
  Nenhum dos 4 cases cobre o cenário "fonte caída propaga para o resolver e aparece como `SITUACAO_NAO_CONFERIDA`". O ponto é testado no resolver puro (`ProntidaoLoteResolver.test.ts:151-163`), mas a composição real do service — que passa `fontesIndisponiveis` de `avaliarGravados` para o resolver — não tem assert.
- **Impacto técnico**: refactor que destruture errado (`const { situacoes } = ...` sem `fontesIndisponiveis`) passa verde porque o mock devolve `[]`.
- **Impacto de negócio**: a tela nunca mostraria "Situação incompleta: sem a consulta de duplicidade" num cenário real de fonte caída, só o faria em teste unitário.
- **Métrica de baseline**: 0 testes em `ProntidaoLoteService.test.ts` com `fontesIndisponiveis: ['DUPLICIDADE'|'AJUSTE_CENTAVOS'|'BOLETO']` passando pelo mock do `avaliarGravados` + assert de que o lote devolvido traz essa fonte em `prontidao.fontesIndisponiveis`.

### F-testability-7: integration tests novos não medíveis localmente neste run

- **Severidade**: P3
- **Tactic violada**: Sandbox (acessibilidade local)
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.integration.test.ts`, `src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.integration.test.ts`
- **Evidência (objetiva)**: ambos usam `describeComBanco = ADMIN_DSN ? describe : describe.skip` + `METRICAS_CICLO_TEST_DSN`; o shared-metrics confirma "só rodam no job `backend-sql` do CI; sem Postgres local". `--quick` neste run inibiu rodar o job.
- **Impacto técnico**: dev local sem Postgres não roda esses testes. OK para a maior parte (os testes de SQL hostil pertencem ao CI), mas quando um `buscarPorChaves` quebra em produção o dev precisa esperar o CI — sem docker-compose.test, não há reprodução local trivial.
- **Impacto de negócio**: ciclo mais lento quando um dos tests de SQL quebra.
- **Métrica de baseline**: ausência de `docker-compose.test.yml` ou script `backend/scripts/*test-pg*` que materialize o DSN local; `grep -rn 'docker-compose.test\|scripts/.*test.*pg' .` → vazio no delta.

## 5. Cards Kanban

### [testability-1] Testes de resultado heterogêneo em `exigirSituacoesPagaveis`

- **Problema**
  > O gate `exigirSituacoesPagaveis` em `LotePagamentoService.ts:727-786` percorre `fin064` item-a-item num `for … of` sequencial, cobrindo quatro desfechos por item (ok / Conexos sem resposta / sumido / já pago) e três desfechos de avaliação (`AVALIADA`+bloqueado, `FORA_DA_CARTEIRA`, `LEITURA_FALHOU`). Hoje todos os testes aplicam a MESMA resposta a TODOS os itens: nunca se verifica que `bloqueados[]` carrega a `identificacao` CORRETA quando os itens se misturam no mesmo lote.

- **Melhoria Proposta**
  > Dentro de `describe('ADR-0076 I20d')` em `LotePagamentoService.test.ts`, acrescentar 2 cases com `comItens('1','2','3','4')` em que `conexos.getTituloAPagar` devolve respostas diferentes por chamada (`mockResolvedValueOnce` + `mockRejectedValueOnce`) e `avaliarVivos` devolve array com estados diferentes por índice. Assert em `error.details.itens` nome por nome (titCod + rotulo esperado). Tactic Bass: **Specialized Interfaces** (asserção direta sobre a saída composta por item).

- **Resultado Esperado**
  > Qualquer paralelização futura de `lerItensAoVivo` (previsível quando o lote ultrapassar ~30 itens) é pega por teste de ordem/correspondência de identificação. Métrica: testes com mix heterogêneo em `exigirSituacoesPagaveis` 0 → 2.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos de teste com resultado por item heterogêneo em `exigirSituacoesPagaveis`: 0 → 2
  - Casos cobrindo ordenação determinística dos itens em `BatchHasBlockedItemsError`: 0 → 1
- **Risco de não fazer**: a 1ª refatoração de performance (paralelizar `fin064` para lotes grandes) muda a ordem da mensagem para a analista e nenhum teste alerta.
- **Dependências**: nenhuma.

### [testability-2] Teste de reentrância na "Finalizar os N lotes prontos" + Idempotency-Key opcional no endpoint

- **Problema**
  > `FinalizarProntos` dispara `finalizarEmSequencia` sem chave idempotente (`prontidaoLotes.ts:102-122`) e o endpoint `/sispag/lotes/:id/finalizar` em `routes/sispag.ts:374-399` não lê `Idempotency-Key`. A proteção efetiva vem do optimistic lock + status machine no server, mas isso NUNCA é testado nesta superfície — se um `await` reordenar no `confirmar()` ou se um retry do fetch for adicionado no futuro, dupla finalização paralela do mesmo lote não é pega por teste.

- **Melhoria Proposta**
  > (a) Em `prontidaoLotes.test.ts`, adicionar case que invoca `finalizarEmSequencia([L1, L1], finalizar)` com o mesmo lote repetido e verifica que a 2ª chamada enxerga o estado atualizado (ou que a função dedupe por `id`); (b) em `routes/sispag.test.ts`, teste de rota com duas chamadas concorrentes e assert de `LoteEstadoInvalidoError` na segunda; (c) opcional, aceitar `Idempotency-Key` no handler de `finalizar` (precedente: `/remessa` em `routes/sispag.ts:1410-1433`). Tactic Bass: **Executable Assertions** sobre reentrância; **Limit Non-Determinism** por chave idempotente.

- **Resultado Esperado**
  > Duplo-clique na faixa "Finalizar os N lotes prontos" passa a ter proteção testada (não apenas assumida); regressão no cliente que permita reentrância explode no CI, não em produção. Métrica: testes de duplo-disparo cliente+rota 0 → 2; endpoints com `Idempotency-Key` suportado passam de 3 (`/ingestao`, `/remessa`, `/conciliacao`) para 4.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) se incluir a mudança no handler; S se só o teste
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos cobrindo duplo-disparo cliente+rota: 0 → 2
  - Suporte a `Idempotency-Key` em `/lotes/:id/finalizar`: ausente → presente (opcional, documentado como "cliente que já viu versão N não precisa gerar; o optimistic lock dá a mesma garantia")
- **Risco de não fazer**: um retry client-side genérico ou um `useEffect` mal reordenado dispara duas finalizações do mesmo lote, saturando `fin064` e Postgres.
- **Dependências**: nenhuma técnica; alinhar com fault-tolerance (overlap com cards de retry/idempotência).

### [testability-3] Teste de rota garante `prontidao` no payload de `GET /lotes` e `GET /lotes/:id`

- **Problema**
  > `routes/sispag.test.ts:116-120` mocka `ProntidaoLoteService.comProntidao` como passthrough. Nenhum teste de rota verifica que a chave `prontidao` sobrevive à passagem por `LotePagamentoApiView.lotes()`/`lote()`. Se o serializador for enxuto num refactor, o campo some sem teste de rota reclamando.

- **Melhoria Proposta**
  > Em `routes/sispag.test.ts`, dentro de `describe('GET /sispag/lotes')` e `describe('GET /sispag/lotes/:id')`, acrescentar 1 case por rota com `ProntidaoLoteService` mockado devolvendo um lote com `prontidao: { estado: 'COM_PENDENCIA', ... }` e assert `expect(corpo.lotes[0].prontidao.estado).toBe('COM_PENDENCIA')`. Tactic Bass: **Executable Assertions** na fronteira HTTP.

- **Resultado Esperado**
  > Mudança no `LotePagamentoApiView` que omita `prontidao` passa a quebrar os tests de rota, não só o de página do frontend. Métrica: testes de rota com assert sobre `prontidao` 0 → 2.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Rotas com assert explícito sobre o campo `prontidao`: 0 → 2 (GET /lotes + GET /lotes/:id)
- **Risco de não fazer**: regressão silenciosa que suma o selo "Pronto para finalizar" na listagem; só o teste do frontend defende hoje.
- **Dependências**: nenhuma.

### [testability-4] Teste de propagação de `fontesIndisponiveis` em `ProntidaoLoteService`

- **Problema**
  > `ProntidaoLoteService.ts:51-56` passa `fontesIndisponiveis` de `avaliarGravados` para `resolver.avaliar(...)`, e os 4 testes do service sempre têm `fontesIndisponiveis: []` no mock. A composição `Service → Resolver` sob fonte caída é verificada no resolver puro, mas não na combinação real.

- **Melhoria Proposta**
  > Adicionar 1 case em `ProntidaoLoteService.test.ts` com mock de `avaliarGravados` devolvendo `fontesIndisponiveis: ['DUPLICIDADE']` e assert `expect(r[0].prontidao.fontesIndisponiveis).toEqual(['DUPLICIDADE'])` + 1 case com `fontesIndisponiveis: ['AJUSTE_CENTAVOS','BOLETO']` cobrindo múltiplas. Tactic Bass: **Recordable Test Cases** sobre a composição.

- **Resultado Esperado**
  > Propagação da fonte caída até a resposta do service passa a ter cobertura direta. Métrica: casos no service com `fontesIndisponiveis` não vazia 0 → 2.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Casos de `ProntidaoLoteService` com `fontesIndisponiveis` ≠ `[]`: 0 → 2
- **Risco de não fazer**: a tela "Situação incompleta" para listagem (não para inclusão) depende dessa propagação; silêncio é possível.
- **Dependências**: nenhuma.

### [testability-5] Quebrar `LotePagamentoService.test.ts` por responsabilidade

- **Problema**
  > `LotePagamentoService.test.ts` chegou a 1 517 LOC com 95 `it()` cobrindo 7 áreas distintas (criar/incluir/finalizar/verificação-TED-PIX/concorrência/CRUD/modalidade). Já existia o card `modifiability-3` do review anterior; esta branch acrescentou mais 113 LOC sob o novo `describe('ADR-0076 I20d')`.

- **Melhoria Proposta**
  > Dividir em 3 arquivos: `LotePagamentoService.finalizar.test.ts` (gate + I20d + verificação TED/PIX, ~700 LOC), `LotePagamentoService.incluir.test.ts` (incluirTitulo + mover + ADR-0075 situação de pagamento), `LotePagamentoService.crud.test.ts` (criar/retirar/atualizar/modalidade). Extrair `buildRepo/buildDestinoDeps/make` para `__fixtures__/LotePagamentoServiceFixtures.ts`. Tactic Bass: **Limit Structural Complexity**.

- **Resultado Esperado**
  > Dev que mexe só no gate não precisa navegar fixtures de 7 áreas. Métrica: maior arquivo de teste do serviço LOC 1 517 → ≤ 700; nº de áreas por arquivo 7 → 1.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - LOC do maior arquivo em `src/backend/domain/service/sispag/LotePagamentoService.*.test.ts`: 1 517 → ≤ 700
  - Fixtures reutilizados em `__fixtures__/`: 0 → 1 arquivo
- **Risco de não fazer**: custo marginal do próximo teste cresce; `/feature-tweak` do gate SISPAG continua pagando pedágio de 1 500 LOC.
- **Dependências**: card `modifiability-3` do review anterior (prefere converter em superset deste).

## 6. Notas do agente

- Rodada reduzida (`--quick`): coverage por diretório não foi medido; onde o valor era conhecido via contagem de `it()`/paths usei isso como proxy e marquei a métrica como ⚠️ onde não dava.
- Overlap cross-QA detectado: card `testability-2` (Idempotency-Key no finalizar + teste de reentrância) sobrepõe com **fault-tolerance** (idempotência de escrita) e card `testability-1` (ordem determinística de erro no lote) overlapa com **modifiability** (refatorar `lerItensAoVivo` para `Promise.all` deve preservar a ordem — teste é o enforcer).
- Verifiquei que o delta NÃO introduz não-determinismo (clock/random) em código de produção — o `BankingCalendar.withClock` já era injetável e o resolver é puro.
- Positivos do delta: `ProntidaoLoteResolver` é um exemplar de "Specialized Interfaces" (`ContextoProntidao` explícito, zero I/O), e os integration tests para `buscarPorChaves` / `titulosComAjusteNaoTerminalNosLotes` existem em `backend-sql` — a dívida mora na composição e na fronteira HTTP, não no núcleo.
- Card `testability-5` é o único que materialmente puxa dívida herdada (o `LotePagamentoService.test.ts` já era saturado antes).
