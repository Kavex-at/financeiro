---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-modifiability
generated_at: 2026-08-03T18:47:00Z
scope: feature-delta (ADR-0027 — selecionar SN existente antes de Processar)
score: 6
findings_count: 5
cards_count: 5
---

# Modifiability — Regis-Review (feature-scoped, ADR-0027)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta ADR-0027)

Tabela canônica das 6 colunas de Bass & Clements:

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor/analista de negócio | Nova exigência sobre o painel de seleção de SN (ex.: paginar as SN, filtrar por valor mínimo, esconder SN já baixadas, permitir preview do título antes de Processar) | `AlocarProcessosDialog.tsx` (735 LOC, 14 `useState`, 3 `useEffect`, 2 `useMemo`), `RecebimentoNumerarioService.etapaSn` (branch `snSelecionada`), rota `POST solicitacao-numerario` | Desenvolvimento (feature branch) — feature já verde (typecheck + lint + tests), mas com 3 warnings de `noExcessiveCognitiveComplexity` no dialog e 1 pré-existente na rota | Alteração deve ser localizada ao painel-direito (SN) sem tocar o painel-esquerdo (processos) nem o `processar()` monolítico | Files touched ≤ 2 por mudança de UI do painel-SN; cognitive complexity do componente-alvo ≤ 15 depois de qualquer refactor; ripple no service ≤ 1 arquivo por mudança na branch `snSelecionada`. Hoje **falha nos 3**: 1 mudança de estado da UI força tocar todo o `AlocarProcessosDialog` (complexity 115); a rota do POST está em cognitive 20 pré-existente que este PR não aliviou. |

Cenário concreto candidato aos próximos 30 dias (já sinalizado nos comentários do próprio código): (a) o teto de valor da alocação virar validador que lê o título real (`fin014.listTitulosBorderoReceber`) ao selecionar uma SN, (b) o `statusLabel` deixar de ser best-effort (comentário explícito no `SOLICITACAO_NUMERARIO_STATUS_LABEL`), (c) filtrar SNs "sem saldo restante" no painel direito. Nenhuma dessas mudanças é hoje localizada.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `AlocarProcessosDialog.tsx` | 733 | ≤ 400 (feature-component target); ≤ 600 hard cap | ❌ | `wc -l src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx` |
| Cognitive complexity do componente `AlocarProcessosDialog` (função raiz) | **115** | ≤ 15 | ❌ | `npx @biomejs/biome lint app/recebimentos/components/AlocarProcessosDialog.tsx` — linha 188 |
| Cognitive complexity de `processar()` (handler do botão) | **22** | ≤ 15 | ❌ | Biome — linha 329 |
| Cognitive complexity do render `processos.map(...)` (painel esquerdo) | **19** | ≤ 15 | ❌ | Biome — linha 532 |
| `React.useState` no componente | 14 | ≤ 7 (heurística: além disso, é `useReducer`/split) | ❌ | grep `React.useState` no arquivo |
| `React.useEffect` no componente | 3 | ≤ 3 (limite prático — cada um coordena um recurso remoto) | ⚠️ | grep `React.useEffect` |
| Cognitive complexity do POST `solicitacao-numerario` handler (rota) | **20** (pré-existente, `routes/recebimentos.ts:445`) | ≤ 15 | ❌ | `npx biome lint routes/recebimentos.ts` |
| Cognitive complexity de `classificarAlocacao` (service) | **20** (pré-existente, `RecebimentoNumerarioService.ts:915`) | ≤ 15 | ❌ | Biome — `RecebimentoNumerarioService.ts:915` |
| LOC `RecebimentoNumerarioService.ts` | 1478 | ≤ 600 hard cap | ❌ (pré-existente — fora do escopo desta feature; sinalizado só para o mapa de risco cross-QA) | `wc -l` |
| Delta LOC do `AlocarProcessosDialog.tsx` neste PR | +276 líquidas (435 insertions / 159 deletions) | ≤ 150 para uma mudança de UX localizada | ❌ | `_shared-metrics.md` |
| Delta LOC do `RecebimentoNumerarioService.ts` (branch `snSelecionada`) | +≈35 líquidas (guard + comentários no `etapaSn`) | ≤ 40 (proporcional ao invariante novo) | ✅ | `_shared-metrics.md`, leitura do `etapaSn` (linhas 350-462) |
| Import fan-in do novo DTO `SolicitacaoNumerarioListItem` | 4 arquivos (client, rota via re-export, lib FE, componente FE) | ≤ 5 | ✅ | `grep -rln "SolicitacaoNumerarioListItem" src/` |
| Sub-componentes internos do dialog | 2 (`ResultadoAlocacao`, `SnStatusBadge`) | ≥ 4 (dado o tamanho — extrair painel-esquerdo e painel-direito) | ❌ | Leitura direta |
| Testes tocados pela feature | 4 (dialog 393 LOC, service 1220 LOC, rota 571 LOC, client 786 LOC) | — | ✅ (cobertura acompanhou a mudança) | `wc -l` dos `*.test.*` |

> ⚠️ **Não medível localmente**: acoplamento efetivo entre estado do painel-esquerdo e painel-direito (só quantificável por refactor experimental — split real do componente). Recomendação: rodar o refactor do card `modifiability-1` num spike e re-medir.

## 3. Tactics — Cobertura no delta ADR-0027

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | O `AlocarProcessosDialog` NÃO foi splittado apesar do crescimento (+276 LOC líquidas, chegou a 733). Só `ResultadoAlocacao` e `SnStatusBadge` foram extraídos — o resto (painel-esquerdo, painel-direito, `processar()`, 14 `useState`, 3 `useEffect`) continua monolítico. Bass: "when the module grows too large, split it along axes of change." O eixo de mudança óbvio é painel-esquerdo (processos) × painel-direito (SN) — os dois painéis já existem no layout mas compartilham TODO o estado. | ❌ ausente | `AlocarProcessosDialog.tsx:188-733`; complexity 115 |
| **Increase Semantic Coherence** | O dialog acumula 4 responsabilidades: (1) resolução de cliente + sugestão pelo histórico do extrato, (2) listagem de processos e seleção, (3) listagem/seleção de SN e "criar novo", (4) cálculo de saldo/split e processamento. Cada nova exigência da feature toca todas. | ❌ | `AlocarProcessosDialog.tsx:246-374` — três `useEffect` sequencialmente dependentes (`open→clientes→processos→sns`) mais o `processar()` que consome todos os estados |
| **Encapsulate** | Bem-feito no back: `SnPayloadBuilder`, `ContingenciaDecider`, `ErpErrorInterpreter`, `NumerarioAclChecker` estão isolados; o novo `listSNsByProcesso` respeita a camada `Client`. O DTO `SolicitacaoNumerarioListItem` é a projeção lógica correta (nomes em inglês, data ISO, `descricao` derivada) — encapsula a linha crua do `com299/list`. | ✅ presente | `ConexosGerDocProcessoClient.ts:1049-1131`; `SolicitacaoNumerarioListItem.ts:1-113` |
| **Use an Intermediary** | O `Client → Service → Route → FE lib` está preservado; a rota `GET /processos/:priCod/sns` é intermediária entre o FE e o `ConexosGerDocProcessoClient` (respeitando authz por-filial). ✅ para o back; ⚠️ para o front — o dialog fala DIRETO com `fetchSNsDoProcesso`/`fetchClientes`/`fetchProcessosParaTransacao`/`processarSolicitacaoNumerario`, sem um hook intermediário que encapsule os 3 estados de loading + erro correlatos. | ⚠️ parcial | `AlocarProcessosDialog.tsx:246-327` |
| **Restrict Dependencies** | O `snSelecionadaDocCod` atravessa 5 camadas literalmente (FE state → FE lib `AlocacaoRequest` → HTTP body → Zod schema da rota → `ProcessarAlocacaoInput` → `EscritaCtx` → `etapaSn`). Cada camada replica o comentário "ADR-0027". Isso É a arquitetura, mas o mesmo campo com o mesmo comentário indica que uma abstração está faltando (um `AlocacaoIntent` tipado que carregue os dois modos: `criarNovo` \| `usarExistente(docCod)`). Sem ela, adicionar um terceiro modo (ex.: "usar existente e re-finalizar") vai replicar o mesmo `?:` em 5 lugares. | ⚠️ parcial | `recebimentos.ts:424` (Zod); `recebimentos.ts:529-531`; `RecebimentoNumerarioService.ts:117-124`, `295-297`, `355-357`, `1472-1475` (`EscritaCtx`) |
| **Refactor** | O branch `snSelecionada` no `etapaSn` (linhas 418-462) foi implementado como GUARD (uma flag booleana + dois `if !snSelecionada`), NÃO como polimorfismo. É a menor mudança possível, mas amplia a cognitive complexity da função e enterra dois invariantes ("não gerar SN existente", "não re-finalizar SN existente") numa mesma função. | ⚠️ parcial | `RecebimentoNumerarioService.ts:418-462` |
| **Abstract Common Services** | O padrão `useEffect + AbortController-style (`let cancelado = false`) + setLoading + setErro` é REPETIDO 3 vezes no dialog (linhas 246-273, 277-301, 305-324) com detalhes ligeiramente diferentes (o 3º usa `eslint-disable exhaustive-deps`). É o candidato clássico para um hook `useRemoteResource<T>()`. | ❌ ausente | `AlocarProcessosDialog.tsx:246-327` |
| **Defer Binding** | O sentinela `CRIAR_NOVO_SN = 'novo'` é uma constante local (bom — não é magic string espalhada). O `snDocCod` é opcional em toda a cadeia (bom — permite o modo dual sem forçar migração de callers). N/A para configuração externa: a decisão "criar novo × usar existente" é do analista em tempo de execução, não configuração. | ✅ presente | `AlocarProcessosDialog.tsx:42`, `recebimentos.ts:424`, `RecebimentoNumerarioService.ts:121` |

## 4. Findings (achados)

### F-modifiability-1: `AlocarProcessosDialog` cresceu para 733 LOC com cognitive complexity 115 na função raiz

- **Severidade**: P1
- **Tactic violada**: Split Module + Increase Semantic Coherence
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:188-733`
- **Evidência (objetiva)**:
  ```
  app/recebimentos/components/AlocarProcessosDialog.tsx:188:17 lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 115 detected (max: 15).
  ```
  14 `useState`, 3 `useEffect`, 2 `useMemo`. Duas subresponsabilidades COMPLETAS coexistem no mesmo componente (painel esquerdo = processos; painel direito = SN + valor + Processar), acopladas via `processoSelecionado`, `snEscolhida`, `resultados`, `valores`, `saldoRestante`. Delta do PR: +276 LOC líquidas (435 insertions / 159 deletions em um único arquivo — `_shared-metrics.md`).
- **Impacto técnico**: qualquer mudança de UX no painel de SN (paginação, filtro por status, preview do título) obriga a reler as 733 linhas e a raciocinar sobre 14 estados globais do componente. Testar isoladamente uma das metades é impossível hoje — o `AlocarProcessosDialog.test.tsx` (393 LOC) já tem que montar o dialog inteiro para cada cenário.
- **Impacto de negócio**: a Frente IV está entregando UX iterativamente (o `saldoRestante`, o multi-filial, o `snDocCod` seletivo, o `gerNum` guard, o `preflight` foram todos incrementais neste componente). Enquanto ele for monolítico, cada iteração custa retrabalho de raciocínio sobre estado compartilhado — o próximo requisito ("teto por título real") vai forçar mais um `useState` + um `useEffect` + um branch novo no `processar()`.
- **Métrica de baseline**: complexity 115 (target 15); 733 LOC (target 400 feature-component / 600 hard-cap); 14 `useState` em um componente.

### F-modifiability-2: `processar()` (handler do botão) em cognitive complexity 22, com branch dual embutido

- **Severidade**: P2
- **Tactic violada**: Refactor + Increase Semantic Coherence
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:329-374`
- **Evidência (objetiva)**:
  ```
  app/recebimentos/components/AlocarProcessosDialog.tsx:329:48 lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 22 detected (max: 15).
  ```
  A função mistura: (a) construção do request (spread condicional do `snDocCod`), (b) chamada HTTP, (c) commit do valor efetivo em `valores[priCod]`, (d) tripla decisão sobre toast (`error`/`dry-run`/sucesso × "SN existente vs. criar novo"), (e) fallback de erro. Cada nova modalidade de alocação adiciona ao menos 2 branches aqui.
- **Impacto técnico**: o toast final tem 3 branches (linhas 351-364) e um deles depende de `snDocCod !== undefined` (herdado de `snEscolhida`). Uma alteração no copy do toast, ou o acréscimo de um 4º modo, vai piorar essa árvore.
- **Impacto de negócio**: mensagens ao analista são visíveis (o toast é o feedback do "Processar", ação real que gera dinheiro no ERP). Uma regressão no branch errado do toast pode passar por revisão sem detectar.
- **Métrica de baseline**: cognitive complexity 22 (target 15) numa função que já é o hot-spot de negócio do componente.

### F-modifiability-3: os três `useEffect` do dialog repetem o padrão `cancelado + setLoading + setErro` sem hook abstrato

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:246-273`, `277-301`, `305-324`
- **Evidência (objetiva)**:
  ```
  // 3 blocos com a mesma forma:
  let cancelado = false
  setCarregandoX(true); setErro(null); ...
  fetchX().then(...).catch(...).finally(...)
  return () => { cancelado = true }
  ```
  O terceiro (`fetchSNsDoProcesso`) precisou de `eslint-disable-next-line react-hooks/exhaustive-deps` (linha 326-327) porque a dep `sns` inflaria a re-execução — sintoma clássico de que o padrão não é abstrato o suficiente.
- **Impacto técnico**: a próxima leitura remota (ex.: buscar o título real da SN selecionada) vai copiar o mesmo bloco → 4x repetição e 4 flags de loading independentes.
- **Impacto de negócio**: baixo direto, mas eleva o custo cognitivo de cada novo estado (é o principal contribuinte ao score 115 do F-modifiability-1).
- **Métrica de baseline**: 3 blocos idênticos hoje; 4º inevitável se a próxima feature (validador de título) for aditiva sem refactor.

### F-modifiability-4: `snSelecionadaDocCod` atravessa 5 camadas como `?:` opcional em vez de um discriminador tipado

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies + Refactor
- **Localização**:
  - `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:344-346`
  - `src/frontend/lib/recebimentos.ts:426-432` (`AlocacaoRequest.snDocCod?`), `588`
  - `src/backend/routes/recebimentos.ts:419-424` (Zod), `529-531`
  - `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:115-124` (`ProcessarAlocacaoInput.snSelecionadaDocCod?`), `295-297`, `355-357`, `418-462` (`etapaSn`)
- **Evidência (objetiva)**:
  ```typescript
  // service, linha 418-462 (etapaSn)
  const snSelecionada = ctx.snSelecionadaDocCod !== undefined;
  let snDocCod = snDocCodIn;
  if (snDocCod === undefined) { /* gera + finaliza */ }
  if (!snSelecionada && (existente?.etapa === undefined || existente.etapa === 'sn')) {
      /* finaliza */
  }
  ```
  A branch está correta (não re-finalizar SN existente é o invariante I-Receb-3), mas a semântica "criar novo vs. usar existente" está codificada como AUSÊNCIA de um campo — não como um tipo. Um terceiro modo ("usar existente e re-finalizar", "usar existente mas só simular fin014") multiplica o mesmo `?:` em 5 lugares.
- **Impacto técnico**: mudar a assinatura para um discriminated union (`{ modo: 'novo' } | { modo: 'existente'; docCod: number }`) força TypeScript a exigir exaustividade em cada camada — hoje um branch novo pode ser esquecido silenciosamente (o `if (snDocCod === undefined)` continua compilando).
- **Impacto de negócio**: o próprio ADR-0027 já sinaliza que a decisão "criar novo" é o default e a "usar existente" é o novo caminho — a próxima iteração provável (ex.: "usar existente + adicionar item complementar") vira um terceiro modo. Sem o discriminador, a mudança será propensa a bug de omissão.
- **Métrica de baseline**: 1 invariante distribuído por 5 arquivos como spread condicional; 0 checagem de exaustividade estática.

### F-modifiability-5: POST `solicitacao-numerario` handler em cognitive complexity 20 (pré-existente, este PR não aliviou)

- **Severidade**: P2
- **Tactic violada**: Split Module (extract-function)
- **Localização**: `src/backend/routes/recebimentos.ts:441-537`
- **Evidência (objetiva)**:
  ```
  routes/recebimentos.ts:445:35 lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 20 detected (max: 15).
  ```
  O handler acumula: (a) parse Zod, (b) load da transação + guard de `gerNum`, (c) authz por-filial com try/catch dedicado, (d) resolução de dryRun via env, (e) pré-flight de ACL condicional, (f) dispatch do service com 7 spreads condicionais. O PR ADR-0027 adicionou o `snDocCod` no schema e no dispatch (linhas 419-424 e 529-531), o que empurrou a complexidade sem que ela fosse aliviada.
- **Impacto técnico**: o próximo campo opcional (dryRunOverride, snDocCod, e o próximo…) vai piorar o número. A extração natural: helper `carregarTransacaoOu422(txnId, res) → transacao | null` + helper `mapearProcessoFields(parsed) → RecebimentoNumerarioProcessoFields` retiraria ~40% da complexidade.
- **Impacto de negócio**: baixo direto (o handler funciona), mas cada evolução da rota — e há várias planejadas: parcelas por título, header `Idempotency-Key` neste handler igual `POST /pipeline/run`, resposta com `revisaoHumana` mais rica — vai aterrissar aqui.
- **Métrica de baseline**: complexity 20 (target 15); 96 LOC no corpo do handler (linhas 441-537); +≈9 LOC adicionadas pelo ADR-0027.

## 5. Cards Kanban

### [modifiability-1] Splittar `AlocarProcessosDialog` em painel-esquerdo (Processos) + painel-direito (SN + Processar) + hook de coordenação

- **Problema**
  > O componente cresceu para 733 LOC e cognitive complexity 115 (target 15) — três warnings do Biome no arquivo. 14 `useState`, 3 `useEffect` e 2 `useMemo` num único componente. Cada requisito novo da Frente IV (multi-filial, `saldoRestante`, `snDocCod` seletivo, `gerNum` guard, pré-flight) aterrissou aqui. A próxima iteração provável (teto por título real, paginação de SN, filtro de SN sem saldo) vai amplificar.

- **Melhoria Proposta**
  > **Split Module** ao longo do eixo estrutural já visível no layout: `AlocarProcessosDialog` (shell + cabeçalho + saldo + seletor de cliente + 2 grid) delega para `<ProcessosPanel processos onSelect selected/>` (painel esquerdo, encapsula o `radiogroup` de processos e os badges de "Processado") e `<SolicitacaoNumerarioPanel processo sns snEscolhida onSnChange valor onValorChange onProcessar processando resultado/>` (painel direito, encapsula radio de "Criar novo" + lista + MoneyInput + botão Processar + ResultadoAlocacao). Extrair `useAlocacaoOrchestrator({ transacao, open })` como hook que devolve `{ clientes, pesCod, processos, sns, processar, saldoRestante, valores, resultados }`. Mover o `processar()` (F-modifiability-2) para dentro do hook e devolvê-lo já parametrizado.

- **Resultado Esperado**
  > Cada mudança de UX no painel direito toca ≤ 2 arquivos (`SolicitacaoNumerarioPanel.tsx` + teste). Cognitive complexity de cada componente ≤ 15. Testes do painel direito podem montar o componente isoladamente com props mockadas — sem carregar clientes/processos.

- **Tactic alvo**: Split Module + Increase Semantic Coherence + Use an Intermediary (o hook)
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — refactor de UI com testes existentes já cobrindo os cenários)
- **Findings relacionados**: F-modifiability-1, F-modifiability-2, F-modifiability-3
- **Métricas de sucesso**:
  - Cognitive complexity `AlocarProcessosDialog` raiz: 115 → ≤ 15
  - LOC `AlocarProcessosDialog.tsx`: 733 → ≤ 250 (shell)
  - Novos arquivos: `ProcessosPanel.tsx` ≤ 180 LOC, `SolicitacaoNumerarioPanel.tsx` ≤ 220 LOC, `useAlocacaoOrchestrator.ts` ≤ 200 LOC
  - Warnings Biome `noExcessiveCognitiveComplexity` no dialog: 3 → 0
- **Risco de não fazer**: o próximo requisito (validador de teto por título; paginação de SN quando o processo tiver > 50) vai adicionar 4º `useEffect` + 3º branch no `processar()` e empurrar a complexity acima de 130. Aos 6 meses o componente vira zona proibida de mexer sem quebrar cenários vizinhos (o teste do dialog já é 393 LOC).
- **Dependências**: nenhuma — testes atuais servem como safety net do refactor.

### [modifiability-2] Extrair `useRemoteResource<T>()` para os três `useEffect` de fetch do dialog

- **Problema**
  > Três `useEffect` no dialog repetem o padrão `let cancelado; setLoading(true); setErro(null); fetchX().then...catch...finally(setLoading(false))` com pequenas divergências (o terceiro precisou de `eslint-disable exhaustive-deps` porque `sns` inflaria a re-execução). Cada fetch novo copia o padrão + adiciona um par `useState<boolean>` + um `useState<string|null>` de erro. Contribui direto para a complexity 115 do F-modifiability-1.

- **Melhoria Proposta**
  > **Abstract Common Services**: criar `useRemoteResource<T, K>({ key, fetch, enabled }) => { data, loading, error, refetch }` (`src/frontend/lib/useRemoteResource.ts`), aplicar aos três fetches (`fetchClientes`, `fetchProcessosParaTransacao`, `fetchSNsDoProcesso`). Manter o pattern `cancelado` internamente. O SN por `priCod` vira cache do próprio hook (elimina o `Record<number, SN[]>` explícito e o `eslint-disable`).

- **Resultado Esperado**
  > 6 `useState` (`loading`/`erro` × 3 recursos) → 0 (encapsulados no hook). Adicionar um 4º fetch (ex.: título real da SN selecionada para validar teto) custa 1 linha, não um bloco.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — refactor mecânico com cobertura de testes existente)
- **Findings relacionados**: F-modifiability-3, F-modifiability-1
- **Métricas de sucesso**:
  - `useState` no dialog: 14 → ≤ 8 (ganho direto de 6, mais outros que ficam encapsulados)
  - Ocorrências de `eslint-disable-next-line react-hooks/exhaustive-deps` no dialog: 1 → 0
  - Linhas dedicadas a coordenar fetches remotos no dialog: ≈80 → ≈15
- **Risco de não fazer**: cada novo requisito de leitura remota (teto por título, refresh de SN, refresh de processos após aloc) copia o mesmo bloco, agravando o F-modifiability-1.
- **Dependências**: se feita ANTES do card 1, reduz o escopo dele. Recomendo esta ordem.

### [modifiability-3] Trocar `snSelecionadaDocCod?: number` por um `AlocacaoIntent` tipado (discriminated union) atravessando FE → HTTP → service

- **Problema**
  > O invariante "criar novo SN vs. usar existente" está codificado como AUSÊNCIA de um campo opcional (`snDocCod?`) replicado em 5 lugares com comentários iguais ("ADR-0027"). O `etapaSn` computa `snSelecionada = ctx.snSelecionadaDocCod !== undefined` e usa isso como flag em dois `if`. Adicionar um terceiro modo (ex.: "usar existente + re-finalizar" ou "usar existente + adicionar item complementar") vai multiplicar os `?:` em todas as 5 camadas sem que o TypeScript force exaustividade.

- **Melhoria Proposta**
  > **Refactor + Restrict Dependencies**: introduzir `type AlocacaoIntent = { modo: 'novo' } | { modo: 'existente'; docCod: number }` em `src/backend/domain/interface/recebimentos/AlocacaoIntent.ts` e em `src/frontend/lib/recebimentos.ts`. Substituir o campo opcional em: (1) `AlocarProcessosDialog.processar()` (mapeia `snEscolhida === CRIAR_NOVO_SN` → `{ modo: 'novo' }`, senão → `{ modo: 'existente', docCod }`), (2) `AlocacaoRequest.intent`, (3) Zod do handler POST (discriminated union), (4) `ProcessarAlocacaoInput.intent`, (5) `EscritaCtx.intent`. No `etapaSn`, `switch (ctx.intent.modo)` — o `default` inalcançável vira erro de compilação se um novo modo for adicionado.

- **Resultado Esperado**
  > Um novo modo de alocação (o próximo do roadmap) é adicionado tocando 1 tipo + 5 `switch` que o compilador exige. Zero risco de omitir um layer.

- **Tactic alvo**: Refactor + Restrict Dependencies + Defer Binding
- **Severidade**: P2
- **Esforço estimado**: M (2–3d — mudança de tipo atravessando FE + rota + service + 4 arquivos de teste)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Campos opcionais espalhados por `snDocCod`/`snSelecionadaDocCod`: 5 → 0
  - Exaustividade estática garantida: sim (via `never` no default do switch)
  - Novo teste "adicionar 3º modo" quebra em compilação nos 5 lugares certos (validado no PR do refactor)
- **Risco de não fazer**: quando surgir o 3º modo (o comentário em `AlocacaoIntent` sinaliza que já está no radar), a implementação vai esquecer uma das 5 camadas — 90% de chance de bug silencioso em pelo menos uma.
- **Dependências**: independente. Ganha se rodar depois do card 1 (o `processar()` já estará numa função menor).

### [modifiability-4] Extrair helpers do POST `solicitacao-numerario` handler para baixar a cognitive complexity

- **Problema**
  > O handler está em cognitive complexity 20 (target 15) por warning pré-existente do Biome — este PR adicionou o campo `snDocCod` (linhas 419-424 e 529-531) sem aliviar. Acumula parse Zod + load transação + guard 422 + authz try/catch + resolução de dryRun + pré-flight de ACL condicional + dispatch com 7 spreads condicionais em 96 LOC.

- **Melhoria Proposta**
  > **Split Module (extract-function)**: extrair (a) `carregarTransacaoOu422(txnId, res) → TransacaoBancaria | null` (encapsula o 404 e o 422 de `gerNum` ausente), (b) `mapearProcessoFields(parsed) → RecebimentoNumerarioProcessoFields` (encapsula os 5 spreads condicionais), (c) `resolverAcessoOu403(user, filCod, res) → boolean` (encapsula o try/catch de authz reutilizado em todas as rotas — hoje repetido em 5 handlers deste arquivo). Handler-alvo fica com ≈ 40 LOC lineares.

- **Resultado Esperado**
  > Cognitive complexity ≤ 12; adicionar um 3º campo opcional custa 1 spread no dispatch, não amplifica a árvore de `if`.

- **Tactic alvo**: Split Module + Abstract Common Services (o `resolverAcessoOu403` é o padrão MAIS repetido do arquivo — 5 ocorrências)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Cognitive complexity POST handler: 20 → ≤ 12
  - Ocorrências de `try { assertUserCanActOnFilial } catch (err) { if (err instanceof FilialForbiddenError) { res.status(403).json(...); return } throw err }` no arquivo: 5 → 0 (todas via helper)
  - Warnings Biome `noExcessiveCognitiveComplexity` em `routes/recebimentos.ts`: 1 → 0
- **Risco de não fazer**: as próximas features (parcelas por título, header `Idempotency-Key`, resposta enriquecida) vão aterrissar aqui e empurrar a complexity acima de 25.
- **Dependências**: nenhuma.

### [modifiability-5] Reforçar o teste do `etapaSn` no modo "SN existente" para blindar o guard `snSelecionada`

- **Problema**
  > O guard `if (!snSelecionada && (existente?.etapa === undefined || existente.etapa === 'sn'))` (linha 452) codifica DOIS invariantes acoplados: (a) não re-gerar uma SN existente, (b) não re-finalizar uma SN já finalizada. Se algum refactor futuro (por exemplo o card 3, ou uma retomada de "SN em rascunho selecionada pelo analista") mexer nesse `if`, o risco de re-finalizar um documento pronto ou de re-gerar SN duplicada (viola I-Receb-3) é real.

- **Melhoria Proposta**
  > **Increase Semantic Coherence**: garantir dois testes de contrato no `RecebimentoNumerarioService.test.ts`: (1) `snSelecionadaDocCod` presente → `gerDocClient.gerarDocProcesso` NUNCA chamado E `gerDocClient.finalizarDocumento` NUNCA chamado, e (2) retomada com `existente.etapa === 'sn-finalizar'` e `snSelecionadaDocCod` presente → mesmo assim NÃO re-finaliza. Ambos são golden-tests do invariante; qualquer refactor do `etapaSn` que quebre um deles é acusado de imediato. Se já existirem (o arquivo cresceu +30 linhas neste PR — `_shared-metrics.md`), promovê-los a um `describe('invariantes ADR-0027')` explícito.

- **Resultado Esperado**
  > O invariante "SN selecionada nunca é regenerada nem re-finalizada" fica testável em ≤ 20 LOC e resistente a refactor do card 3.

- **Tactic alvo**: (não é uma tactic Bass canônica, é reforço de testabilidade em suporte a Modifiability — Bass reconhece isso como "test cases as executable specifications" no capítulo Modifiability × Testability)
- **Severidade**: P3
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Testes explicitamente rotulados como "invariantes ADR-0027": 0 → ≥ 2
  - Cobertura de mutação do `etapaSn` no branch `snSelecionada`: verificável em spike com Stryker (opcional)
- **Risco de não fazer**: quando o card 3 (discriminated union) rodar, o risco de deslizar num dos 5 pontos de refactor é o cenário canônico de bug silencioso — o teste do invariante é a rede de segurança.
- **Dependências**: independente; recomendo rodar ANTES do card 3.

## 6. Notas do agente

- **Escopo respeitado**: revisei APENAS os 9 arquivos do delta (`_shared-metrics.md`). Não auditei repo. Warnings pré-existentes (`classificarAlocacao` em complexity 20; `RecebimentoNumerarioService.ts` em 1478 LOC) só foram citados para cross-QA — não viraram cards, pois estão fora do escopo do ADR-0027.
- **Métricas não-medíveis**: acoplamento efetivo entre painéis (só quantificável pelo próprio refactor); cobertura de mutação (Stryker não instalado). Ambos estão declarados nos cards como validação pós-facto.
- **Cross-QA para o consolidator**:
  - **Modifiability × Testability**: o card 1 (split do dialog) destrava testes isolados do painel-SN — hoje o `AlocarProcessosDialog.test.tsx` (393 LOC) tem que montar o dialog inteiro para cada cenário; alertar `qa-testability`.
  - **Modifiability × Security**: o card 4 propõe extrair `resolverAcessoOu403` — o padrão de authz por-filial está copiado 5x no `routes/recebimentos.ts`; drift silencioso entre as 5 cópias é risco de segurança (uma cópia esquecida = handler sem authz). Alertar `qa-security`.
  - **Modifiability × Integrability**: o discriminated union do card 3 estabiliza o boundary FE↔HTTP↔service para o ADR-0027 (hoje é implícito por ausência de campo); alertar `qa-integrability`.
