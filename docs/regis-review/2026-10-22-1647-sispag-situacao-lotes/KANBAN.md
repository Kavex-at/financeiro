---
type: regis-review-kanban
run_id: 2026-10-22-1647-sispag-situacao-lotes
scope: REDUZIDO (3 de 8 QAs: testability, modifiability, fault-tolerance)
total: 13
counts: { p0: 0, p1: 3, p2: 9, p3: 1 }
---

# Kanban — financeiro — 2026-10-22-1647-sispag-situacao-lotes

> Importável para o Kanban do time. Cards com Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
>
> **Notas do consolidator**:
> - `testability-2` + `fault-tolerance-1` **foram merged** no card `finalizar-idempotency`
>   (P1, M) — mesma causa-raiz (`Idempotency-Key` + teste de reentrância no `/finalizar`).
> - F-modifiability-6 (ontologia `related_files` incompleto) foi **resolvido pelo orquestrador
>   antes desta consolidação** — **sem card**.
> - F-testability-1 teve a premissa reajustada (dois testes já cobrem mix em `avaliarVivos`); card
>   `testability-1` abaixo foi reescrito e **downgraded P1 → P2**, esforço S.

---

## P0 — Crítico

_Nenhum card P0 nesta rodada. Inviolable Rule #11 não dispara re-loop._

---

## P1 — Alto

### [finalizar-idempotency] `Idempotency-Key` em `/sispag/lotes/:id/finalizar` + teste de reentrância (MERGED)

**QA**: Fault Tolerance + Testability
**Tactic alvo**: Idempotent Replay + Executable Assertions
**Esforço**: M (2–5d)
**Findings**: F-fault-tolerance-1 ∪ F-testability-2

**Problema**
> O handler `/sispag/lotes/:id/finalizar` (`src/backend/routes/sispag.ts:374-412`) valida apenas
> `{ versao }`; grep por `Idempotency-Key` em `routes/sispag.ts` + `LotePagamentoService.ts` → 0.
> A defesa efetiva contra duplo-POST é o CAS `versao+status` em `LotePagamentoService.ts:626-630,
> 881-920` — correta, mas invisível para o cliente, que recebe 409 em vez de 200 idempotente num
> retry transparente de proxy/browser. Além disso, nem `routes/sispag.test.ts` nem
> `prontidaoLotes.test.ts` nem `prontidaoComponentes.test.tsx` reproduzem o cenário "cliente
> dispara duas vezes seguidas enquanto a 1ª remessa está em curso". O cliente usa
> `finalizarEmSequencia([L1, L1], …)` sem dedupe por `id` em `prontidaoLotes.ts:102-122`.

**Melhoria Proposta**
> (a) Aceitar header `Idempotency-Key` no handler; tabela leve
> `(idempotency_key, lote_id, versao_pedida, resultado, criado_em)` com TTL 24h; na 2ª chamada
> com mesma chave e mesmos parâmetros, devolver o resultado persistido.
> (b) Em `routes/sispag.test.ts`, dentro de `describe('POST /sispag/lotes/:id/finalizar')`,
> acrescentar teste com 2 chamadas concorrentes e assert do comportamento (200 idempotente com
> chave, 409 `LoteEstadoInvalidoError` sem chave).
> (c) Em `prontidaoLotes.test.ts`, case `finalizarEmSequencia([L1, L1], finalizar)` validando
> que a função dedupe por `id` (ou que a 2ª tentativa recebe o estado atualizado).
> Precedente de header `Idempotency-Key` em `/ingestao`, `/remessa` e `/conciliacao`
> (`routes/sispag.ts:1410-1433`). Service: um método paralelo `finalizarLoteIdem(input, key)`
> que embrulhe `finalizarLote`.

**Resultado Esperado**
> Retry transparente devolve 200 com payload original (não mais 409).
> Rotas de escrita financeira com `Idempotency-Key`: 0/1 → 1/1 no delta; total de rotas SISPAG
> com suporte: 3 → 4.
> Testes de duplo-disparo cliente+rota: 0 → 2.

**Métricas de sucesso**
- `# endpoints de escrita financeira aceitando Idempotency-Key` em `routes/sispag.ts`: 0 → 1
- `# testes de rota com 2 chamadas concorrentes` em `routes/sispag.test.ts`: 0 → 1
- `# testes de dedupe por id` em `prontidaoLotes.test.ts`: 0 → 1
- `# 409 "versão conflito"` por chamadas idênticas em janela < 5s (dashboard, pós-mudança): medir

**Risco de não fazer**
> Em janelas de instabilidade (proxy, browser retry), chamadas repetidas levam a 409 mesmo
> quando o backend aplicou a transição. Fricção no analista e desvio de tempo de suporte;
> uma regressão de cliente que permita reentrância pode saturar `fin064` + pool Postgres.

**Dependências**: Nenhuma técnica. Precisa alinhar com a decisão de persistir a tabela de dedupe
no mesmo schema do SISPAG (preferência).

---

### [modifiability-1] Dividir `LotePagamentoService` em agregado + verificações

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M (3–5d)
**Findings**: F-modifiability-1

**Problema**
> `src/backend/domain/service/sispag/LotePagamentoService.ts` tem 956 LOC, 12 ações públicas e um
> aviso de complexidade cognitiva 17 em `incluirTitulo` que o delta não resolveu. A fatia atual
> acrescentou mais 4 métodos privados de guarda (`exigirSituacoesPagaveis`, `lerItensAoVivo`,
> `bloqueioDaAvaliacao`, `identificacao`) empilhados sobre `finalizarLote`. A próxima regra de
> finalização continua caindo aqui.

**Melhoria Proposta**
> Aplicar **Split Module**: extrair a montagem/guardas do `finalizarLote` (hoje três guardas:
> `exigirSituacoesPagaveis`, `exigirDuplicidadesTratadas`, `exigirModalidadeDisponivel`) para um
> `LoteFinalizacaoVerificador` injetável. Mesmo movimento para `incluirTitulo` (que tem a
> complexidade sinalizada): isolar a transação em um helper `IncluirTituloEmLote` com
> `withAdvisoryLock` + `retirarDaOrigem` encapsulados. O serviço fica como fachada do agregado;
> cada verificador tem seus próprios testes.

**Resultado Esperado**
> `LotePagamentoService.ts` abaixo de 600 LOC; `incluirTitulo` sem aviso de complexidade
> (de 17 → ≤ 15); cada verificador testável em isolamento, sem mockar o repositório inteiro.

**Métricas de sucesso**
- LOC `LotePagamentoService.ts`: 956 → ≤ 600
- Avisos `noExcessiveCognitiveComplexity` neste arquivo: 1 → 0
- Testes verdes: 282/282 → 282/282 (sem regressão)

**Risco de não fazer**
> Cada nova fatia SISPAG empilha +100 LOC aqui; em 6 meses o arquivo passa de 1.200 LOC e vira
> o gargalo de PR do produto.

**Dependências**: Nenhuma; `tsyringe` já suporta a composição.

---

### [modifiability-2] Quebrar `src/frontend/app/sispag/page.tsx` em roteador de abas + 4 páginas de aba

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: L (1–2 sem)
**Findings**: F-modifiability-2

**Problema**
> `page.tsx` tem 1.905 LOC, 46 imports e orquestra o estado de 4 abas (títulos, lotes RASCUNHO,
> lotes FINALIZADOS, boletos DDA) + 4 filtros + 3 callbacks de recarregamento. Esta fatia precisou
> pôr `filtroProntidao`, `ordemLotes`, `lotesRascunhoOrdenados`, `candidatosVisiveis` no mesmo
> componente. É o maior fonte de merge-conflict do SISPAG.

**Melhoria Proposta**
> **Split Module** por aba: `app/sispag/page.tsx` vira só o roteador (abas + estado compartilhado
> estreito — permissões, erros globais, recarregadores). Cada aba vira seu próprio componente em
> `app/sispag/<aba>/`: `TitulosAPagar.tsx`, `LotesCandidatos.tsx` (recebe o filtro de prontidão e
> `FinalizarProntos`), `LotesFinalizados.tsx`, `BoletosDda.tsx`. Estado por aba fica dentro da
> aba; o roteador só cuida do switcher.

**Resultado Esperado**
> `page.tsx` ≤ 400 LOC; cada aba ≤ 500 LOC; features paralelas do SISPAG deixam de colidir no
> mesmo arquivo.

**Métricas de sucesso**
- LOC `page.tsx`: 1.905 → ≤ 400
- Imports em `page.tsx`: 46 → ≤ 15
- Testes verdes mantidos (114 suites)

**Risco de não fazer**
> Toda feature SISPAG paralela paga o custo do rebase; dois PRs simultâneos no SISPAG passam a
> sempre conflitar.

**Dependências**: Alinhar com o design system (nenhuma mudança visual esperada).

---

## P2 — Médio

### [modifiability-4] Centralizar a helper `chaveDe` do SISPAG

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d, mecânico)
**Findings**: F-modifiability-4

**Problema**
> A helper `const chaveDe = (t) => '${t.filCod}:${t.docCod}:${t.titCod}'` existe em 11 arquivos
> de `src/backend/domain/service/sispag/`, dois deles criados neste delta
> (`ProntidaoLoteService.ts:9`, `ProntidaoLoteResolver.ts:28`). Qualquer mudança no formato da
> chave natural (ex.: padding, tipo de documento) exige editar 11 lugares.

**Melhoria Proposta**
> **Abstract Common Services**: extrair para `src/backend/domain/core/chaveTitulo.ts`
> (ou `interface/sispag/ChaveTitulo.ts`) um `chaveTitulo(t: ChaveTitulo): string` + eventual
> `chaveTituloInversa(string): ChaveTitulo`. Importar nas 11 fontes; manter o alias local nas
> classes só quando o nome compacto for necessário.

**Resultado Esperado**
> 1 cópia; mudança de formato = 1 patch.

**Métricas de sucesso**
- Cópias de `chaveDe`/`chaveItem` em `src/backend/domain/service/sispag/`: 11 → 1

**Risco de não fazer**
> Baixo hoje; vira P1 na próxima mudança no formato do `titCod` ou introdução de `tenantId` na
> chave natural.

**Dependências**: Nenhuma.

---

### [modifiability-5] Encapsular a leitura ao vivo do `fin064` em um `LeitorTitulosAoVivo`

**QA**: Modifiability
**Tactic alvo**: Encapsulate / Defer Binding
**Esforço**: S (1–2d)
**Findings**: F-modifiability-5

**Problema**
> Em `LotePagamentoService.lerItensAoVivo` (linhas 753-786), a releitura do `fin064` roda item a
> item em `for … of itens`, com `catch(() => undefined)` embutido. Não há abstração de "ler N com
> cap de concorrência" nem suporte a um endpoint em lote. O cliente de "finalizar os N prontos"
> (`FinalizarProntos`) sequencia essa sequência: tempo total = Σ Σ chamadas Conexos. Qualquer
> troca para batch exige editar aqui, não um helper reutilizável.

**Melhoria Proposta**
> Extrair a leitura para `LeitorTitulosAoVivo.ler(chaves): Promise<Array<{item,vivo?,erro?}>>`
> injetável, com estratégia default sequencial e substituível por "paralelo bounded" via
> `EnvironmentProvider`. A guarda `exigirSituacoesPagaveis` só consome o resultado; a mesma
> abstração fica disponível para `incluirTitulo` e para uma eventual futura "revalidar sem
> finalizar". **Encapsulate** + preparo para **Defer Binding (configuration)** da concorrência.

**Resultado Esperado**
> A troca para paralelismo ou endpoint-em-lote vira um PR de 1 arquivo. `finalizarLote`
> continua inalterado.

**Métricas de sucesso**
- Call sites de `conexos.getTituloAPagar` para releitura de item de lote: 1 → 1 (abstraído)
- Latência de `finalizarLote` para 10 itens com paralelismo = 4: baseline Σ(1..10) →
  ~ceil(10/4) chamadas no caminho crítico

**Risco de não fazer**
> A dívida de latência da "finalização em massa" só cresce; mudar a política de concorrência
> depois significa editar o service inchado do card `modifiability-1`.

**Dependências**: Pode andar antes OU depois do `modifiability-1`; não bloqueia.

---

### [modifiability-3] Gerar `src/frontend/lib/sispag.ts` a partir do contrato do backend

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: M (3–5d; precisa decidir pacote compartilhado vs. codegen)
**Findings**: F-modifiability-3

**Problema**
> `src/frontend/lib/sispag.ts` tem 2.749 LOC espelhando `src/backend/domain/interface/sispag/*.ts`.
> O delta precisou adicionar 11 códigos de pendência + 2 ações + 1 dono + 2 tipos nos dois lados.
> Hoje há um teste de paridade, mas a cada fatia o custo marginal continua sendo 2× (BE + FE +
> teste).

**Melhoria Proposta**
> **Abstract Common Services**: expor as constantes e tipos do contrato por um pacote compartilhado
> (ou gerar `lib/sispag.ts` a partir do backend via `tsc --emitDeclarationOnly` ou um script
> `scripts/sync-contrato-sispag.ts` acionado por `npm run build`). O teste de paridade atual
> (`src/frontend/lib/sispag.test.ts`) deixa de "detectar drift" e passa a "garantir identidade".

**Resultado Esperado**
> 1 fonte de verdade do contrato SISPAG; adicionar uma pendência passa a tocar 1 arquivo
> (`SituacaoPagamento.ts`), não 2.

**Métricas de sucesso**
- Nº de arquivos editados para acrescentar uma constante de pendência: 3 → 1
- LOC `lib/sispag.ts`: 2.749 → gerado (não editado à mão)

**Risco de não fazer**
> A cada fatia que acrescenta um motivo/pendência/dono/ação, o espelho cresce e aumenta a
> superfície de bug "faltou copiar no FE".

**Dependências**: Definir a camada compartilhada (não há monorepo workspace nem publicação de
pacote hoje).

---

### [fault-tolerance-2] Orçamento de tempo (deadline) no `finalizarLote` e concorrência limitada em `lerItensAoVivo`

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: M (2–5d)
**Findings**: F-fault-tolerance-2

**Problema**
> O loop em `LotePagamentoService.ts:761-786` executa até ~20 reads sequenciais no Conexos sem
> AbortController nem deadline total; no bulk sequencial do cliente (até ~40 lotes), isso
> serializa e pode exceder timeouts intermediários (proxy, browser), levando a divergência entre
> o que o cliente reporta e o estado real no backend.

**Melhoria Proposta**
> Introduzir um `deadline` por POST (ex.: 15s) via `AbortController` passado ao
> `conexos.getTituloAPagar`. Avaliar `Promise.all` com concorrência limitada (ex.: 5) em vez de
> serial — a fail-closed por item já tolera parciais, basta não impor ordem. Tática Bass: Timeout
> + Condition Monitoring. Arquivos: `src/backend/domain/service/sispag/LotePagamentoService.ts`;
> se preciso, estender assinatura de `ConexosSispagClient.getTituloAPagar` para aceitar
> `AbortSignal`.

**Resultado Esperado**
> Nenhum POST `/finalizar` fica aberto > deadline fixado.
> Tempo p99 do POST com lote de 20 itens: medir (hoje não instrumentado) → ≤ 15s.

**Métricas de sucesso**
- `# wrappers de timeout agregado` em `exigirSituacoesPagaveis`: 0 → 1
- p99 do POST `/finalizar` com lote p90-sized: ser instrumentado e capeado

**Risco de não fazer**
> Na primeira janela de Conexos degradado em pico de volume, o bulk de 40 lotes trava a UI por
> minutos; analistas abrem tickets por "finalização não responde".

**Dependências**: A mudança em `getTituloAPagar` precisa estender para outros chamadores sem
quebrar `runWithRetry`. Faz par com `modifiability-5` (encapsulamento primeiro, política depois).

---

### [fault-tolerance-3] Botão "Parar" no diálogo bulk + `AbortSignal` em `finalizarEmSequencia`

**QA**: Fault Tolerance
**Tactic alvo**: Recovery - Forward
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> `FinalizarProntos` bloqueia o fechar com `if (rodando) return` (`FinalizarProntos.tsx:57`) e
> `finalizarEmSequencia` (`prontidaoLotes.ts:102-122`) é um loop puro sem signal. Analista sem
> controle para interromper um bulk longo.

**Melhoria Proposta**
> Expor `AbortSignal` em `finalizarEmSequencia` e um botão "Parar" no diálogo quando `rodando`
> for `true`. Ao abortar, parar o loop antes do próximo lote (os já finalizados ficam, os não
> iniciados aparecem como "não tentado"). Nada muda no backend. Tática Bass: Recovery - Forward
> (controle do operador). Arquivos: `prontidaoLotes.ts`, `FinalizarProntos.tsx`,
> `prontidaoLotes.test.ts`.

**Resultado Esperado**
> Diálogo bulk aceita parada controlada.
> `# abort paths no bulk sequencial`: 0 → 1

**Métricas de sucesso**
- Teste cobrindo "abort no meio do loop deixa `resultados` consistentes": 0 → ≥1

**Risco de não fazer**
> Fricção crescente conforme o número de lotes prontos simultâneos sobe; interação com
> `fault-tolerance-2` amplifica.

**Dependências**: Nenhuma; alinhado com `fault-tolerance-2` (ambos empurram abortabilidade).

---

### [testability-1] Caso de teste cobrindo falha Conexos em UM item + bloqueio por status em OUTRO no mesmo lote (reajustado)

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S (≤1d)
**Findings**: F-testability-1 (premissa reajustada — ver REPORT §7)

**Problema**
> Em `describe('ADR-0076 I20d')` em `LotePagamentoService.test.ts:666-767`, dois testes já cobrem
> mix por item em `avaliarVivos` (`'item BLOQUEADO recusa com TODOS os itens bloqueados'` usa
> `[bloqueada, pronta]` em linha 717; `'fora da carteira e fonte caída'` usa
> `[{FORA_DA_CARTEIRA}, {pronta+fontesIndisponiveis:['BOLETO']}]` em linha 755). O que **ainda
> falta** é mix no caminho da leitura Conexos: `conexos.getTituloAPagar` resolvendo para um item e
> rejeitando para outro no mesmo lote, combinado com um bloqueio por status em um terceiro item.
> O `catch(() => undefined)` do loop sequencial em `LotePagamentoService.ts:761-786` produz
> "situação não conferida" num item e `BLOQUEADO` por status em outro no mesmo
> `BatchHasBlockedItemsError.details.itens[]` — ordem e correspondência de `identificacao` nunca
> são verificadas sob esse mix.

**Melhoria Proposta**
> Acrescentar 1 case em `describe('ADR-0076 I20d')` com `comItens('1','2','3')` em que
> `conexos.getTituloAPagar` usa `mockResolvedValueOnce(titulo())` + `mockRejectedValueOnce(new Error('503'))`
> + `mockResolvedValueOnce(titulo())`, e `avaliarVivos.mockResolvedValue([pronta, bloqueada])` (os
> dois itens que chegam a `avaliarVivos` após o loop filtrar o item com erro). Assert em
> `error.details.itens` que o item com erro aparece com `rotulo: 'situação não conferida'`, o item
> bloqueado por status aparece com `motivo: 'ALCADA'` e `rotulo: 'Aguardando aprovação'`, e a
> ordem corresponde à `identificacao(item)` por índice. Tactic Bass: **Specialized Interfaces**
> (asserção direta sobre a saída composta por item).

**Resultado Esperado**
> Paralelização futura de `lerItensAoVivo` (previsível quando o lote ultrapassar ~30 itens)
> é pega por teste de ordem/correspondência de identificação sob mix de desfechos no caminho
> Conexos.

**Métricas de sucesso**
- Casos de teste com mix de resultado por item no caminho `conexos.getTituloAPagar` em
  `exigirSituacoesPagaveis`: 0 → 1
- Casos cobrindo ordenação determinística dos itens em `BatchHasBlockedItemsError` sob mix: 0 → 1

**Risco de não fazer**
> A 1ª refatoração de performance (paralelizar `fin064` para lotes grandes) muda a ordem da
> mensagem para a analista e nenhum teste alerta.

**Dependências**: Nenhuma.

---

### [testability-3] Teste de rota garante `prontidao` no payload de `GET /lotes` e `GET /lotes/:id`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-3

**Problema**
> `routes/sispag.test.ts:116-120` mocka `ProntidaoLoteService.comProntidao` como passthrough.
> Nenhum teste de rota verifica que a chave `prontidao` sobrevive à passagem por
> `LotePagamentoApiView.lotes()`/`lote()`. Se o serializador for enxuto num refactor, o campo some
> sem teste de rota reclamando.

**Melhoria Proposta**
> Em `routes/sispag.test.ts`, dentro de `describe('GET /sispag/lotes')` e
> `describe('GET /sispag/lotes/:id')`, acrescentar 1 case por rota com `ProntidaoLoteService`
> mockado devolvendo um lote com `prontidao: { estado: 'COM_PENDENCIA', ... }` e assert
> `expect(corpo.lotes[0].prontidao.estado).toBe('COM_PENDENCIA')`. Tactic Bass: **Executable
> Assertions** na fronteira HTTP.

**Resultado Esperado**
> Mudança no `LotePagamentoApiView` que omita `prontidao` passa a quebrar os tests de rota, não
> só o de página do frontend.

**Métricas de sucesso**
- Rotas com assert explícito sobre o campo `prontidao`: 0 → 2 (GET /lotes + GET /lotes/:id)

**Risco de não fazer**
> Regressão silenciosa que suma o selo "Pronto para finalizar" na listagem; só o teste do
> frontend defende hoje.

**Dependências**: Nenhuma.

---

### [testability-4] Teste de propagação de `fontesIndisponiveis` em `ProntidaoLoteService`

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S (≤1d)
**Findings**: F-testability-6

**Problema**
> `ProntidaoLoteService.ts:51-56` passa `fontesIndisponiveis` de `avaliarGravados` para
> `resolver.avaliar(...)`, e os 4 testes do service sempre têm `fontesIndisponiveis: []` no mock.
> A composição `Service → Resolver` sob fonte caída é verificada no resolver puro, mas não na
> combinação real.

**Melhoria Proposta**
> Adicionar 1 case em `ProntidaoLoteService.test.ts` com mock de `avaliarGravados` devolvendo
> `fontesIndisponiveis: ['DUPLICIDADE']` e assert
> `expect(r[0].prontidao.fontesIndisponiveis).toEqual(['DUPLICIDADE'])` + 1 case com
> `fontesIndisponiveis: ['AJUSTE_CENTAVOS','BOLETO']` cobrindo múltiplas. Tactic Bass: **Recordable
> Test Cases** sobre a composição.

**Resultado Esperado**
> Propagação da fonte caída até a resposta do service passa a ter cobertura direta.

**Métricas de sucesso**
- Casos de `ProntidaoLoteService` com `fontesIndisponiveis` ≠ `[]`: 0 → 2

**Risco de não fazer**
> A tela "Situação incompleta" para listagem (não para inclusão) depende dessa propagação;
> silêncio é possível.

**Dependências**: Nenhuma.

---

### [testability-5] Quebrar `LotePagamentoService.test.ts` por responsabilidade

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M (2–5d)
**Findings**: F-testability-4

**Problema**
> `LotePagamentoService.test.ts` chegou a 1.517 LOC com 95 `it()` cobrindo 7 áreas distintas
> (criar/incluir/finalizar/verificação-TED-PIX/concorrência/CRUD/modalidade). Já existia o card
> `modifiability-3` do review anterior; esta branch acrescentou mais 113 LOC sob o novo
> `describe('ADR-0076 I20d')`.

**Melhoria Proposta**
> Dividir em 3 arquivos: `LotePagamentoService.finalizar.test.ts` (gate + I20d + verificação
> TED/PIX, ~700 LOC), `LotePagamentoService.incluir.test.ts` (incluirTitulo + mover + ADR-0075
> situação de pagamento), `LotePagamentoService.crud.test.ts`
> (criar/retirar/atualizar/modalidade). Extrair `buildRepo/buildDestinoDeps/make` para
> `__fixtures__/LotePagamentoServiceFixtures.ts`. Tactic Bass: **Limit Structural Complexity**.

**Resultado Esperado**
> Dev que mexe só no gate não precisa navegar fixtures de 7 áreas.

**Métricas de sucesso**
- LOC do maior arquivo em `src/backend/domain/service/sispag/LotePagamentoService.*.test.ts`:
  1.517 → ≤ 700
- Fixtures reutilizados em `__fixtures__/`: 0 → 1 arquivo

**Risco de não fazer**
> Custo marginal do próximo teste cresce; `/feature-tweak` do gate SISPAG continua pagando
> pedágio de 1.500 LOC.

**Dependências**: Card `modifiability-3` do review anterior (prefere converter em superset deste).

---

## P3 — Baixo

### [fault-tolerance-4] Expor flag "prontidão em modo degradado" na response de `/sispag/lotes`

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-5

**Problema**
> Quando o catch amplo de `ProntidaoLoteService.comProntidao` dispara, todos os lotes voltam sem
> `prontidao` e sem bandeira dizendo "estamos em modo degradado"; a tela só vê o selo sumir.

**Melhoria Proposta**
> Adicionar `prontidao: { degradado: true, motivo? }` (ou campo no envelope da listagem) quando o
> catch amplo ativa. Preservar o compatível quando `avaliarGravados` degradou parcial via
> `fontesIndisponiveis`. Mostrar banner na aba "Lotes candidatos" quando flag presente. Tática
> Bass: Condition Monitoring. Arquivos: `ProntidaoLoteService.ts`, `routes/sispag.ts`,
> `src/frontend/app/sispag/page.tsx`.

**Resultado Esperado**
> Analista vê "prontidão temporariamente indisponível — tente de novo" em vez de interpretar
> silêncio como "nada a finalizar".
> `# sinalizações de modo degradado na response de /sispag/lotes`: 0 → 1

**Métricas de sucesso**
- Teste de `ProntidaoLoteService` cobrindo "erro no `titulosComAjusteNaoTerminalNosLotes` retorna
  flag degradado": 0 → 1

**Risco de não fazer**
> Incidente silencioso durante blips de DB; usuário aborta operação por falsa percepção de
> "sem lote pronto".

**Dependências**: Pode andar junto com `testability-3` (fronteira HTTP) como 1 PR único.
