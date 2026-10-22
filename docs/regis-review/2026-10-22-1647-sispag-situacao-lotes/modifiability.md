---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-22-1647-sispag-situacao-lotes
agent: qa-modifiability
generated_at: 2026-10-22T17:40:00-03:00
scope: all
score: 7
findings_count: 6
cards_count: 5
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Equipe Kavex (próximas fatias SISPAG — ex.: nova pendência, novo motivo de bloqueio, novo dono) | Pedido para acrescentar/alterar uma pendência do lote em rascunho (um novo caso de I20c/d/e) | Camada de contrato (`SituacaoPagamento.ts`, `lib/sispag.ts`), resolver puro (`ProntidaoLoteResolver.ts`), guarda da finalização (`LotePagamentoService.exigirSituacoesPagaveis`) e UI (`SeloProntidao`, `PendenciasDoLote`, `FinalizarProntos`) | Desenvolvimento, código novo DDD/Lambda-ready, pipeline `/feature-tweak` + Regis-Review | Mudar o perfil, acrescentar a constante tipada, estender o `PERFIL` do resolver e o espelho FE; a UI pega o novo rótulo/efeito pelo contrato | ≤ 4 arquivos tocados em dia normal; 0 regressões em `jest`; teste de paridade BE↔FE verde sem conflito manual |

Fatos observáveis desta fatia (ADR-0076): o cálculo é puro (`ProntidaoLoteResolver` sem I/O) e todas as pendências nascem como constantes tipadas em UM arquivo canônico (`SituacaoPagamento.ts`), espelhado em `lib/sispag.ts` com teste de paridade — a mudança seguinte é um append a essa tabela. O custo real da próxima alteração está em dois pontos antigos que esta fatia continuou a inchar: `LotePagamentoService.ts` (956 LOC) e `src/frontend/app/sispag/page.tsx` (1.905 LOC).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `LotePagamentoService.ts` (após delta) | 956 | ≤ 600 | ⚠️ | `wc -l src/backend/domain/service/sispag/LotePagamentoService.ts` |
| LOC `src/frontend/app/sispag/page.tsx` | 1.905 | ≤ 600 | ❌ | `wc -l src/frontend/app/sispag/page.tsx` |
| LOC `src/frontend/lib/sispag.ts` | 2.749 | ≤ 800 | ❌ | `wc -l src/frontend/lib/sispag.ts` |
| LOC `src/frontend/app/sispag/components/LoteCard.tsx` | 1.151 | ≤ 400 | ❌ | `wc -l src/frontend/app/sispag/components/LoteCard.tsx` |
| LOC `ProntidaoLoteResolver.ts` (novo, puro, DI-friendly) | 259 | ≤ 400 | ✅ | `wc -l src/backend/domain/service/sispag/ProntidaoLoteResolver.ts` |
| LOC `ProntidaoLoteService.ts` (novo, orquestração) | 68 | ≤ 200 | ✅ | `wc -l src/backend/domain/service/sispag/ProntidaoLoteService.ts` |
| Biome `noExcessiveCognitiveComplexity` em arquivos tocados do delta | 1 (pré-existente: `incluirTitulo` complexidade 17 @ `LotePagamentoService.ts:470`) | 0 | ⚠️ | `npx biome check --max-diagnostics=250` |
| Biome `noExcessiveCognitiveComplexity` no backend inteiro | 111 avisos | tendência decrescente | ⚠️ | `npx biome check --max-diagnostics=400 \| grep -c noExcessiveCognitiveComplexity` |
| Novas pendências do lote adicionadas via tabela PERFIL (defer binding por dados) | 10 constantes em 1 tabela (`ProntidaoLoteResolver.PERFIL`) | ≥ 1 (lookup table) | ✅ | `src/backend/domain/service/sispag/ProntidaoLoteResolver.ts:50-128` |
| Duplicação da helper `chaveDe` / `chaveItem` em `src/backend/domain/service/sispag/` | 11 cópias (2 novas: `ProntidaoLoteService.ts:9`, `ProntidaoLoteResolver.ts:28`) | 1 utilitário compartilhado | ⚠️ | `grep -rn "const chaveDe\|const chaveItem" src/backend/domain/service/sispag` |
| Fan-in `LotePagamentoService` em `src/backend/domain/service` + `routes` + `jobs` | 8 arquivos (não-teste) | — (métrica informativa) | ✅ | `grep -rln LotePagamentoService src/backend/domain src/backend/routes src/backend/jobs` |
| Fan-in `SituacaoPagamentoService` em `src/backend` | 12 arquivos | — | ✅ | `grep -rln SituacaoPagamentoService src/backend` |
| Contrato de pendência duplicado BE↔FE | 11 códigos espelhados em `src/backend/domain/interface/sispag/SituacaoPagamento.ts` ↔ `src/frontend/lib/sispag.ts` | 1 (contrato único) | ⚠️ | `src/backend/domain/interface/sispag/SituacaoPagamento.ts:141-194`; `src/frontend/lib/sispag.ts` (diff `origin/main..HEAD`) |
| Ontologia `prontidao-lote` indexada com `related_files` apontando para implementação | sim (6 arquivos) | sim | ✅ | `ontology/business-rules/prontidao-lote.md:10-16` |
| Cobertura ontológica (`_coverage.json`) atualizada no delta | business_rules 31→32, implemented 18→19, with_tests 15→16 | sincronizado com o código | ✅ | `ontology/_coverage.json` (string note v0.47.0) |
| Repository SQL: nova consulta `titulosComAjusteNaoTerminalNosLotes` reaproveita a lista `ETAPAS_AJUSTE_TERMINAIS` da consulta por lote (defer binding por constante de módulo) | 1 fonte de verdade, 2 consultas | 1 fonte | ✅ | `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (diff: `const ETAPAS_AJUSTE_TERMINAIS` + `$terminais`) |
| Loop sequencial `conexos.getTituloAPagar` por item em `exigirSituacoesPagaveis` (sem batch nem concorrência) | N chamadas sequenciais por lote finalizado | N em paralelo bounded ou endpoint em lote | ⚠️ | `src/backend/domain/service/sispag/LotePagamentoService.ts:761-786` |
| "Finalizar em massa" implementado no cliente (sequencial, sem endpoint novo, sem Idempotency-Key) | Loop em `src/frontend/app/sispag/lotes/prontidaoLotes.ts:102-122` | depende de política (ver cross-QA fault-tolerance) | ⚠️ | `src/frontend/app/sispag/lotes/FinalizarProntos.tsx:61-64` + `prontidaoLotes.ts:102-122` |

### Apêndice 2.a — Top-10 maiores arquivos tocados pelo delta (produção)

| LOC | Arquivo |
|---:|---|
| 2.749 | `src/frontend/lib/sispag.ts` |
| 1.905 | `src/frontend/app/sispag/page.tsx` |
| 1.151 | `src/frontend/app/sispag/components/LoteCard.tsx` |
| 956 | `src/backend/domain/service/sispag/LotePagamentoService.ts` |
| 259 | `src/backend/domain/service/sispag/ProntidaoLoteResolver.ts` |
| 251 | `src/backend/domain/service/sispag/SituacaoPagamentoService.ts` |
| 236 | `src/backend/domain/interface/sispag/SituacaoPagamento.ts` |
| 218 | `src/frontend/app/sispag/lotes/PendenciasDoLote.tsx` |
| 199 | `src/frontend/app/sispag/situacao/AcaoDoTitulo.tsx` |
| 155 | `src/frontend/app/sispag/lotes/FinalizarProntos.tsx` |

### Apêndice 2.b — Top-10 fan-in (serviços e contrato tocados pelo delta)

Contagem de arquivos **não-teste** sob `src/backend/domain/*`, `src/backend/routes/*` e `src/backend/jobs/*` que importam cada símbolo.

| Fan-in | Símbolo | Fonte |
|---:|---|---|
| 99 arquivos | `SispagInterface.ts` + `SituacaoPagamento.ts` (contrato de domínio SISPAG) | `grep -rln "from.*SispagInterface\|from.*SituacaoPagamento'" src/backend` |
| 12 | `SituacaoPagamentoService` | `grep -rln SituacaoPagamentoService src/backend` |
| 8 | `LotePagamentoService` | `grep -rln LotePagamentoService src/backend/domain src/backend/routes src/backend/jobs` |
| 3 | `ProntidaoLoteService` (`routes/sispag.ts`, 2 testes de rota) | `grep -rln ProntidaoLoteService src/backend` |
| 2 | `ProntidaoLoteResolver` (`ProntidaoLoteService.ts` + teste) | `grep -rln ProntidaoLoteResolver src/backend` |
| 1 | `BatchHasBlockedItemsError` (apenas `LotePagamentoService`) | `grep -rln BatchHasBlockedItemsError src/backend` |

> O **contrato** `SituacaoPagamento`/`SispagInterface` tem fan-in muito alto (99 arquivos). Qualquer renomeação ou mudança de forma propaga por quase todo o módulo SISPAG — por isso a mudança desta fatia foi feita por **extensão aditiva** (novos símbolos `ESTADO_PRONTIDAO`, `EFEITO_PENDENCIA`, `PENDENCIA_LOTE`, `ACAO_PENDENCIA_LOTE`, `PendenciaLote`, `ProntidaoLote` e `DONO_PAGAMENTO.CADASTRO`), que é o movimento certo para preservar modificabilidade. Mantê-lo aditivo exige disciplina nas próximas fatias.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `ProntidaoLoteResolver` isolou a regra pura (259 LOC) de `ProntidaoLoteService` (orquestração, 68 LOC) e `LotePagamentoService.exigirSituacoesPagaveis` (guarda), em vez de empilhar tudo em `LotePagamentoService`. Mas `LotePagamentoService` ainda cresceu para 956 LOC e `src/frontend/app/sispag/page.tsx` para 1.905 LOC. | ⚠️ parcial | `src/backend/domain/service/sispag/ProntidaoLoteResolver.ts`, `ProntidaoLoteService.ts`; `LotePagamentoService.ts` (956 LOC) |
| Increase Semantic Coherence | O resolver só sabe de "pendência do lote" (uma tabela `PERFIL` para 9 códigos). `ProntidaoLoteService` só faz a orquestração (contexto + mapa por lote). `SituacaoPagamentoService` ganhou `avaliarVivos` e `avaliarGravados` que reutilizam `carregarContexto` sem duplicar motivos. | ✅ presente | `ProntidaoLoteResolver.ts:50-128`, `ProntidaoLoteService.ts:30-67`, `SituacaoPagamentoService.ts:181-250` |
| Encapsulate | Novo tipo de erro `BatchHasBlockedItemsError` encapsula o shape da recusa de finalização (422, código estável, `userMessage` pronto). `OrientacaoNoConexos` extraído de `AcaoDoTitulo.tsx` e reusado por `PendenciasDoLote.tsx` sem copiar o popover. | ✅ presente | `src/backend/domain/errors/BatchHasBlockedItemsError.ts`; `src/frontend/app/sispag/situacao/AcaoDoTitulo.tsx:155-199` (extração do `OrientacaoNoConexos`) |
| Use an Intermediary | `GET /sispag/lotes` passou a chamar `ProntidaoLoteService.comProntidao(await listarLotes(...))` como pipeline: a rota não sabe de "prontidão", só compõe. O resolver puro é intermediário entre serviços de domínio (nenhum I/O dele). | ✅ presente | `src/backend/routes/sispag.ts` (diff) |
| Restrict Dependencies | Camadas DDD preservadas: `ProntidaoLoteResolver` só depende de interfaces de domínio; `ProntidaoLoteService` depende do resolver + repos; rota depende dos services. Zero import de `lambda/` em `domain` e vice-versa. | ✅ presente | `grep -rn "from '.*lambda/'" src/backend/domain` = 0 |
| Refactor | `avaliarVivo` foi colapsado para delegar a `avaliarVivos` ([{chave,vivo}]) — eliminou o path duplicado e passou o batch a ser o caminho principal. Lista `ETAPAS_AJUSTE_TERMINAIS` extraída para constante de módulo e reusada pela nova `titulosComAjusteNaoTerminalNosLotes`. | ✅ presente | `SituacaoPagamentoService.ts:173-230` (diff); `LotePagamentoRepository.ts` (`ETAPAS_AJUSTE_TERMINAIS` + `$terminais`) |
| Abstract Common Services | Falta: a helper `chaveDe`/`chaveItem` foi copiada em 11 arquivos de `src/backend/domain/service/sispag/` (2 cópias novas no delta). | ⚠️ parcial | `grep -rn "const chaveDe\|const chaveItem" src/backend/domain/service/sispag` → 11 ocorrências |
| Defer Binding (lookup table) | Perfis das pendências vêm de uma tabela de dados `PERFIL`: acrescentar uma pendência nova é um `PENDENCIA_LOTE.X` + uma entrada; `ESTADO_PRONTIDAO`, `EFEITO_PENDENCIA`, `DONO_PAGAMENTO`, `ACAO_PENDENCIA_LOTE` são `as const` dicionários. Lista de etapas terminais do ajuste virou `ETAPAS_AJUSTE_TERMINAIS` injetada no SQL via `$terminais`. | ✅ presente | `ProntidaoLoteResolver.ts:43-128`; `SituacaoPagamento.ts:127-161`; `LotePagamentoRepository.ts` (constante + `$terminais`) |
| Defer Binding (polymorphism / plugin) | `tsyringe` já é o esqueleto; esta fatia não introduz interface nova com múltiplas implementações. Nenhum ponto do delta exige — "pendência" é um tipo discriminado por `codigo`, não polimorfismo. | N/A | Não há cenário no delta que peça seleção de implementação em runtime. |
| Defer Binding (configuration) | A guarda `exigirSituacoesPagaveis` roda determinística (ADR-0076, não há flag). As flags de tenant (`sispagFavorecidoAutorizadoEnabled`, `sispagTedEnabled`, `sispagPixEnabled`) continuam externalizadas no `EnvironmentProvider` e são lidas por `exigirModalidadeDisponivel`. | ✅ presente | `LotePagamentoService.ts:713-718` |

Nenhum ciclo de dependência novo foi introduzido no delta (`ProntidaoLoteResolver` → interfaces; `ProntidaoLoteService` → `SituacaoPagamentoService`+`LotePagamentoRepository`; `LotePagamentoService` → `SituacaoPagamentoService` — grafo acíclico).

## 4. Findings

### F-modifiability-1: `LotePagamentoService.ts` ultrapassa 950 LOC e já carrega 1 aviso Biome de complexidade

- **Severidade**: P1 (alto — degrada o custo da próxima fatia que tocar `incluirTitulo` ou `finalizarLote`)
- **Tactic violada**: Split Module / Reduce Size of Module
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:1-956` (foco: `exigirSituacoesPagaveis` 727-742, `lerItensAoVivo` 753-786, `bloqueioDaAvaliacao` 788-815, somados a `incluirTitulo` 380-525 com complexidade 17)
- **Evidência (objetiva)**:
  ```
  wc -l src/backend/domain/service/sispag/LotePagamentoService.ts → 956 (era 832 na main, +109 no delta)
  npx biome check --max-diagnostics=250 → "LotePagamentoService.ts:470:52 lint/complexity/noExcessiveCognitiveComplexity ... Excessive complexity of 17 detected (max: 15)"
  Métodos públicos no agregado: criarLote, atualizarContaPagadora, atualizarModalidadeItem, listarLotes, getLote, criarLotesPorFilial, incluirTitulo, removerTitulo, retirarDoLote, finalizarLote, reabrirLote, cancelarLote (12 ações).
  ```
- **Impacto técnico**: cada nova regra do finalizar (próximas fatias I20+ ou mudança do contrato Conexos) continua empilhando em `LotePagamentoService`. A próxima fatia que acrescentar outra guarda tende a repetir o padrão `exigirX` como método privado dentro desta classe.
- **Impacto de negócio**: o tempo de diff + revisão de PR em `LotePagamentoService` é o maior do SISPAG; `/feature-tweak` nessa classe é o cenário com maior taxa de regressão humana (12 ações compartilham repositórios, lock, auditoria e verificação TED/PIX no mesmo arquivo).
- **Métrica de baseline**: 956 LOC (alvo ≤ 600); 1 aviso de complexidade cognitiva 17 (alvo 0).

### F-modifiability-2: `src/frontend/app/sispag/page.tsx` virou um god-component de 1.905 LOC

- **Severidade**: P1 (alto — toda alteração de aba, filtro ou ordenação do SISPAG passa aqui)
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/frontend/app/sispag/page.tsx:1-1905` (46 imports no topo; o componente `SispagPanel` orquestra aba de títulos, aba de lotes RASCUNHO/FINALIZADOS, filtro de prontidão, filtro de favorecidos, filtro de boletos DDA e ação de "finalizar prontos")
- **Evidência (objetiva)**:
  ```
  wc -l src/frontend/app/sispag/page.tsx → 1905
  grep -c '^import ' src/frontend/app/sispag/page.tsx → 46
  Novos estados agregados no delta: filtroProntidao, ordemLotes, lotesRascunhoOrdenados, candidatosVisiveis (page.tsx:528-540)
  ```
- **Impacto técnico**: o componente concentra o estado de 4 abas e os efeitos de recarregamento. Adicionar uma nova aba ou um novo filtro continua forçando a edição deste arquivo e aumenta a chance de merge-conflict com qualquer feature paralela do SISPAG.
- **Impacto de negócio**: PRs do SISPAG que tocam a tela principal são serializados — qualquer trabalho paralelo nessa página gera conflito; isso aumenta o tempo de ciclo de qualquer fatia SISPAG, que é o maior frente do produto (`Permutas`, `SISPAG`, `Popula GED`, `Recebimentos`).
- **Métrica de baseline**: 1.905 LOC (alvo ≤ 600); 46 imports (alvo ≤ 15).

### F-modifiability-3: `src/frontend/lib/sispag.ts` tornou-se catálogo de 2.749 LOC com contrato duplicado do backend

- **Severidade**: P2 (médio — hoje há teste de paridade; o risco cresce com cada constante nova)
- **Tactic violada**: Abstract Common Services / Encapsulate
- **Localização**: `src/frontend/lib/sispag.ts:1-2749`; espelho de `src/backend/domain/interface/sispag/SituacaoPagamento.ts` + `SispagInterface.ts`
- **Evidência (objetiva)**:
  ```
  wc -l src/frontend/lib/sispag.ts → 2749
  Delta: +62 LOC de espelho (ESTADO_PRONTIDAO, EFEITO_PENDENCIA, PENDENCIA_LOTE, ACAO_PENDENCIA_LOTE, DONO_PAGAMENTO.CADASTRO, PendenciaLote, ProntidaoLote)
  O arquivo é importado por 7 outros arquivos do delta (page.tsx, LoteCard.tsx, PendenciasDoLote.tsx, SeloProntidao.tsx, FinalizarProntos.tsx, prontidaoLotes.ts, AcaoDoTitulo.tsx).
  ```
- **Impacto técnico**: cada constante tipada do contrato é escrita duas vezes (BE em `SituacaoPagamento.ts`, FE em `lib/sispag.ts`). Hoje um teste de paridade (`src/frontend/lib/sispag.test.ts` +8 linhas no delta) impede drift silencioso, mas a cada novo código a lista a manter cresce.
- **Impacto de negócio**: um esquecimento no espelho é bloqueado pelo teste de paridade, mas também bloqueia o PR; a cada rodada o custo marginal de uma nova pendência é 2× o esperado (dois arquivos + o teste).
- **Métrica de baseline**: 11 códigos (`PENDENCIA_LOTE`) + 2 ações (`ACAO_PENDENCIA_LOTE`) + 5 dicionários duplicados; `lib/sispag.ts` cresce em cerca de +60 LOC por fatia desta ordem.

### F-modifiability-4: helper `chaveDe`/`chaveItem` copiada em 11 arquivos de `domain/service/sispag/`

- **Severidade**: P2 (médio — baixo risco imediato, custo acumulativo)
- **Tactic violada**: Abstract Common Services
- **Localização**: `grep -rn "const chaveDe\|const chaveItem" src/backend/domain/service/sispag` → 11 ocorrências; 2 novas no delta: `ProntidaoLoteService.ts:9`, `ProntidaoLoteResolver.ts:28`
- **Evidência (objetiva)**:
  ```
  src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts:130
  src/backend/domain/service/sispag/ProntidaoLoteService.ts:9           ← novo
  src/backend/domain/service/sispag/SituacaoPagamentoService.ts:26
  src/backend/domain/service/sispag/RemessaService.ts:1345
  src/backend/domain/service/sispag/RemessaService.ts:1574
  src/backend/domain/service/sispag/SispagPainelService.ts:132
  src/backend/domain/service/sispag/ProntidaoLoteResolver.ts:28         ← novo
  src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts:166
  src/backend/domain/service/sispag/LotePagamentoService.ts:80          (chaveItem)
  src/backend/domain/service/sispag/RetiradaCodigoBarrasService.ts:106
  src/backend/domain/service/sispag/TitulosAPagarExportService.ts:43
  ```
- **Impacto técnico**: uma mudança futura no formato da chave (ex.: zero-padding do `titCod`, inclusão do tipo de documento) exige editar 11 arquivos. É o tipo de "clone silencioso" que a convenção de linter não pega.
- **Impacto de negócio**: baixo hoje. Alto quando o Conexos mudar a composição da chave natural ou quando a formação automática precisar de um `chaveDeFromTitulo(TituloAPagar)` com normalização diferente.
- **Métrica de baseline**: 11 cópias (alvo 1).

### F-modifiability-5: `exigirSituacoesPagaveis` relê `fin064` item a item em loop sequencial

- **Severidade**: P2 (médio — latência; vira P1 quando um lote típico passar de ~10 itens)
- **Tactic violada**: Encapsulate / Defer Binding (abstração de I/O)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:761-786` (`lerItensAoVivo`)
- **Evidência (objetiva)**:
  ```typescript
  // LotePagamentoService.ts:761-764
  for (const item of itens) {
      const vivo = await this.conexos
          .getTituloAPagar(item.filCod, item.docCod, item.titCod)
          .catch(() => undefined);
  ```
- **Impacto técnico**: a leitura ao vivo é sequencial e serializa o `finalizarLote` em O(N) chamadas ao Conexos; não há abstração de "ler N em paralelo com cap" ou "um `getTitulosAPagar` em lote" — qualquer troca para batch exige editar aqui, não um `Executor`. O cliente de "finalizar os N prontos" (`FinalizarProntos`) então enfileira isso em sequência: tempo total = Σ Σ.
- **Impacto de negócio**: tempo de "Finalizar os N lotes prontos" cresce com o produto do nº de lotes × nº de itens. Em uma rodada típica (10 lotes × 10 itens) são 100 chamadas Conexos sequenciais antes do primeiro envio.
- **Métrica de baseline**: 1 chamada ao Conexos por item, sem paralelismo, dentro de uma transação não aberta ainda (OK) mas antes do advisory lock da verificação TED/PIX (não é possível paralelizar sem alterar aqui).

### F-modifiability-6: ontologia atualizada; mas `related_files` do `prontidao-lote.md` não inclui o novo resolver

- **Severidade**: P3 (baixo — ontologia é a bússola de modificabilidade; drift pequeno custa barato)
- **Tactic violada**: Defer Binding (ontologia como registro de "onde está a regra")
- **Localização**: `ontology/business-rules/prontidao-lote.md:10-16`
- **Evidência (objetiva)**:
  ```
  related_files:
    - src/backend/domain/service/sispag/LotePagamentoService.ts
    - src/backend/domain/service/sispag/SituacaoPagamentoService.ts
    - src/backend/domain/interface/sispag/SispagInterface.ts
    - src/frontend/lib/sispag.ts
    - src/frontend/app/sispag/components/LoteCard.tsx
    - src/frontend/app/sispag/page.tsx
  ```
  Faltam: `ProntidaoLoteResolver.ts` (coração da regra, 259 LOC), `ProntidaoLoteService.ts`, `errors/BatchHasBlockedItemsError.ts`, `interface/sispag/SituacaoPagamento.ts` (contrato I20), e os 4 novos componentes em `src/frontend/app/sispag/lotes/`.
- **Impacto técnico**: `CodebaseNavigator` e qualquer busca "o que implementa `prontidao-lote`?" perde 8 arquivos. Modificabilidade cega: a próxima edição vai pela porta errada.
- **Impacto de negócio**: baixo. Alto na soma: foi assim que começou a dívida do template.
- **Métrica de baseline**: 6 arquivos listados / 14 arquivos de produção da regra ≈ 43 % de cobertura declarada.

## 5. Cards Kanban

### [modifiability-1] Dividir LotePagamentoService em agregado + verificações

- **Problema**
  > `src/backend/domain/service/sispag/LotePagamentoService.ts` tem 956 LOC, 12 ações públicas e um aviso de complexidade cognitiva 17 em `incluirTitulo` que o delta não resolveu. A fatia atual acrescentou mais 4 métodos privados de guarda (`exigirSituacoesPagaveis`, `lerItensAoVivo`, `bloqueioDaAvaliacao`, `identificacao`) empilhados sobre `finalizarLote`. A próxima regra de finalização continua caindo aqui.
- **Melhoria Proposta**
  > Aplicar **Split Module**: extrair a montagem/guardas do `finalizarLote` (hoje três guardas: `exigirSituacoesPagaveis`, `exigirDuplicidadesTratadas`, `exigirModalidadeDisponivel`) para um `LoteFinalizacaoVerificador` injetável. Mesmo movimento para `incluirTitulo` (que tem a complexidade sinalizada): isolar a transação em um helper `IncluirTituloEmLote` com `withAdvisoryLock` + `retirarDaOrigem` encapsulados. O serviço fica como fachada do agregado; cada verificador tem seus próprios testes.
- **Resultado Esperado**
  > `LotePagamentoService.ts` abaixo de 600 LOC; `incluirTitulo` sem aviso de complexidade (de 17 → ≤ 15); cada verificador testável em isolamento, sem mockar o repositório inteiro.
- **Tactic alvo**: Split Module
- **Severidade**: P1
- **Esforço estimado**: M (3–5d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC `LotePagamentoService.ts`: 956 → ≤ 600
  - Avisos `noExcessiveCognitiveComplexity` neste arquivo: 1 → 0
  - Testes verdes: 282/282 → 282/282 (sem regressão)
- **Risco de não fazer**: cada nova fatia SISPAG empilha +100 LOC aqui; em 6 meses o arquivo passa de 1.200 LOC e vira o gargalo de PR do produto.
- **Dependências**: nenhuma; `tsyringe` já suporta a composição.

### [modifiability-2] Quebrar `src/frontend/app/sispag/page.tsx` em roteador de abas + 4 páginas de aba

- **Problema**
  > `page.tsx` tem 1.905 LOC, 46 imports e orquestra o estado de 4 abas (títulos, lotes RASCUNHO, lotes FINALIZADOS, boletos DDA) + 4 filtros + 3 callbacks de recarregamento. Esta fatia precisou pôr `filtroProntidao`, `ordemLotes`, `lotesRascunhoOrdenados`, `candidatosVisiveis` no mesmo componente. É o maior fonte de merge-conflict do SISPAG.
- **Melhoria Proposta**
  > **Split Module** por aba: `app/sispag/page.tsx` vira só o roteador (abas + estado compartilhado estreito — permissões, erros globais, recarregadores). Cada aba vira seu próprio componente em `app/sispag/<aba>/`: `TitulosAPagar.tsx`, `LotesCandidatos.tsx` (recebe o filtro de prontidão e `FinalizarProntos`), `LotesFinalizados.tsx`, `BoletosDda.tsx`. Estado por aba fica dentro da aba; o roteador só cuida do switcher.
- **Resultado Esperado**
  > `page.tsx` ≤ 400 LOC; cada aba ≤ 500 LOC; features paralelas do SISPAG deixam de colidir no mesmo arquivo.
- **Tactic alvo**: Split Module
- **Severidade**: P1
- **Esforço estimado**: L (1–2 sem)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC `page.tsx`: 1.905 → ≤ 400
  - Imports em `page.tsx`: 46 → ≤ 15
  - Testes verdes mantidos (114 suites)
- **Risco de não fazer**: toda feature SISPAG paralela paga o custo do rebase; dois PRs simultâneos no SISPAG passam a sempre conflitar.
- **Dependências**: alinhar com o design system (nenhuma mudança visual esperada).

### [modifiability-3] Gerar `src/frontend/lib/sispag.ts` a partir do contrato do backend

- **Problema**
  > `src/frontend/lib/sispag.ts` tem 2.749 LOC espelhando `src/backend/domain/interface/sispag/*.ts`. O delta precisou adicionar 11 códigos de pendência + 2 ações + 1 dono + 2 tipos nos dois lados. Hoje há um teste de paridade, mas a cada fatia o custo marginal continua sendo 2× (BE + FE + teste).
- **Melhoria Proposta**
  > **Abstract Common Services**: expor as constantes e tipos do contrato por um pacote compartilhado (ou gerar `lib/sispag.ts` a partir do backend via `tsc --emitDeclarationOnly` ou um script `scripts/sync-contrato-sispag.ts` acionado por `npm run build`). O teste de paridade atual (`src/frontend/lib/sispag.test.ts`) deixa de "detectar drift" e passa a "garantir identidade".
- **Resultado Esperado**
  > 1 fonte de verdade do contrato SISPAG; adicionar uma pendência passa a tocar 1 arquivo (`SituacaoPagamento.ts`), não 2.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M (3–5d; precisa decidir pacote compartilhado vs. codegen)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Nº de arquivos editados para acrescentar uma constante de pendência: 3 → 1
  - LOC `lib/sispag.ts`: 2.749 → gerado (não editado à mão)
- **Risco de não fazer**: a cada fatia que acrescenta um motivo/pendência/dono/ação, o espelho cresce e aumenta a superfície de bug "faltou copiar no FE".
- **Dependências**: definir a camada compartilhada (não há monorepo workspace nem publicação de pacote hoje).

### [modifiability-4] Centralizar a helper `chaveDe` do SISPAG

- **Problema**
  > A helper `const chaveDe = (t) => '${t.filCod}:${t.docCod}:${t.titCod}'` existe em 11 arquivos de `src/backend/domain/service/sispag/`, dois deles criados neste delta (`ProntidaoLoteService.ts:9`, `ProntidaoLoteResolver.ts:28`). Qualquer mudança no formato da chave natural (ex.: padding, tipo de documento) exige editar 11 lugares.
- **Melhoria Proposta**
  > **Abstract Common Services**: extrair para `src/backend/domain/core/chaveTitulo.ts` (ou `interface/sispag/ChaveTitulo.ts`) um `chaveTitulo(t: ChaveTitulo): string` + eventual `chaveTituloInversa(string): ChaveTitulo`. Importar nas 11 fontes; manter o alias local nas classes só quando o nome compacto for necessário.
- **Resultado Esperado**
  > 1 cópia; mudança de formato = 1 patch.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d, mecânico)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Cópias de `chaveDe`/`chaveItem` em `src/backend/domain/service/sispag/`: 11 → 1
- **Risco de não fazer**: baixo hoje; vira P1 na próxima mudança no formato do `titCod` ou introdução de `tenantId` na chave natural.
- **Dependências**: nenhuma.

### [modifiability-5] Encapsular a leitura ao vivo do `fin064` em um `LeitorTitulosAoVivo`

- **Problema**
  > Em `LotePagamentoService.lerItensAoVivo` (linhas 753-786), a releitura do `fin064` roda item a item em `for … of itens`, com `catch(() => undefined)` embutido. Não há abstração de "ler N com cap de concorrência" nem suporte a um endpoint em lote. O cliente de "finalizar os N prontos" (`FinalizarProntos`) sequencia essa sequência: tempo total = Σ Σ chamadas Conexos. Qualquer troca para batch exige editar aqui, não um helper reutilizável.
- **Melhoria Proposta**
  > Extrair a leitura para `LeitorTitulosAoVivo.ler(chaves): Promise<Array<{item,vivo?,erro?}>>` injetável, com estratégia default sequencial e substituível por "paralelo bounded" via `EnvironmentProvider`. A guarda `exigirSituacoesPagaveis` só consome o resultado; a mesma abstração fica disponível para `incluirTitulo` e para uma eventual futura "revalidar sem finalizar". **Encapsulate** + preparo para **Defer Binding (configuration)** da concorrência.
- **Resultado Esperado**
  > A troca para paralelismo ou endpoint-em-lote vira um PR de 1 arquivo. `finalizarLote` continua inalterado.
- **Tactic alvo**: Encapsulate / Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S (1–2d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Call sites de `conexos.getTituloAPagar` para releitura de item de lote: 1 (centralizado) → 1 (abstraído)
  - Latência de `finalizarLote` para 10 itens com paralelismo = 4: baseline Σ(1..10) → ~ceil(10/4) chamadas no caminho crítico
- **Risco de não fazer**: a dívida de latência da "finalização em massa" só cresce; mudar a política de concorrência depois significa editar o service inchado do card modifiability-1.
- **Dependências**: pode andar antes OU depois do modifiability-1; não bloqueia.

> Finding F-modifiability-6 (ontologia `prontidao-lote.md` com `related_files` incompleto) é tratado em `ontology/_inbox/sispag-situacao-lotes-regis-followups.md` como ajuste de P3 — não ganha card de Kanban dedicado, mas fica rastreável no inbox.

## 6. Notas do agente

- Escopo: só o delta `origin/main..HEAD` (ADR-0076 / `prontidao-lote` I20). Hotspots pré-existentes do SISPAG (page.tsx 1.905 LOC, lib/sispag.ts 2.749 LOC, LotePagamentoService 956 LOC) estão incluídos porque **este delta os continuou a inchar** — a métrica importa para o próximo mantenedor.
- Cross-QA:
  - **modifiability-1** (Split `LotePagamentoService`) → **Testability**: hoje testar uma guarda nova exige instanciar o serviço inteiro com 10 mocks; dividir reduz a árvore de mocks por teste.
  - **modifiability-5** (`LeitorTitulosAoVivo`) → **Fault-tolerance** e **Performance**: a leitura sequencial é parte do mesmo problema de "Finalizar os N prontos" no cliente sem Idempotency-Key que fault-tolerance QA avaliará.
  - **modifiability-3** (contrato BE↔FE duplicado) → **Integrability**: a parity test atual é o único portão; se um dia a entrega do FE sair do mesmo repo, a dívida sobe de P2 para P1.
  - **modifiability-6** (ontologia) → **Deployability**: `/retro-ontology` e `/feature-tweak` dependem de `_index.json` e `related_files` corretos; drift aqui é débito que explode junto com o volume de regras.
- Métricas não medíveis localmente: tempo real de `finalizarLote` em produção (requer CloudWatch/Render metrics) — recomendação: instrumentar `logService.info` já existente com `duracaoMs` e o número de itens para possibilitar o acompanhamento do card modifiability-5.
