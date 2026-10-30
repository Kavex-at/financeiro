---
qa: Testability
qa_slug: testability
run_id: 2026-10-30-sispag-dda-paridade
agent: qa-testability
generated_at: 2026-10-30T00:00:00Z
scope: all
score: 8
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que mexe no filtro/ordem/totais da aba DDA | Mudança em `PaginacaoBoletoDda`, em `BoletoDdaService.listar` (cache) ou nas colunas de `BoletosDdaTab` | Camada de paginação server-side + cache de consolidação + UI com fetch F1–F4 | Pré-merge, no worktree da feature | Suíte verde confirma o contrato (filtros tipados, totais com R$, F1–F4, I-DDA5) sem subir container; falha fixa o sítio exato | 100% dos critérios do delta observáveis por teste unit/integration local; execução < 25 s por suíte |

Resumo: a feature é "só pagamento de dívida de testabilidade" sob a lente de Bass — o backend ganha filtros, ordem, totais e um cache; a UI é partida em componentes compartilhados. Se os testes não travarem agora as novas superfícies, a próxima mudança no mesmo arquivo paga N× o custo.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Suítes backend tocadas no delta passam | 3/3 (183 testes) | 3/3 | ✅ | `npx jest PaginacaoBoletoDda.test.ts BoletoDdaService.test.ts routes/sispag.test.ts` |
| Suítes frontend do delta passam | 4/4 (112 testes) | 4/4 | ✅ | `npx jest BoletosDdaTab* filtrosBoletosDda.test.ts lib/sispag.test.ts` |
| Suítes Títulos a pagar seguem verdes sem edição | 6/6 (140 testes) e `git diff --name-only` não lista nenhum `*situacao/*.test.*` | 6/6 e zero edições | ✅ | `git -C <wt> diff HEAD --stat -- src/frontend/app/sispag/situacao/*.test.*` + `npx jest app/sispag/situacao/` |
| Testes dedicados ao novo `ConsolidacaoBoletoDdaCache` | 0 (cobertura via `BoletoDdaService.test.ts` descrevendo 5 cenários) | ≥ 1 arquivo próprio cobrindo LRU, geração durante inflight e TTL | ⚠️ | `ls src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache*.test.ts` → vazio |
| Branches novas de `PaginacaoBoletoDda.paginar` com teste | Faixa, filtros de coluna (6 campos), ordem (4 colunas + estável + undefined), facetas, I-DDA5, `amostraHoje`, `hoje` ausente — todas assertadas | 100% das branches do delta | ✅ | `src/backend/domain/service/sispag/PaginacaoBoletoDda.test.ts:185-399` |
| Casos 400 do novo schema Zod em `routes/sispag.ts` | 6 (situações, filial, faixa, coluna, direção, valor < 0) | ≥ 4, incluindo cada união/enum novo | ✅ | `src/backend/routes/sispag.test.ts:1715-1726` |
| Fetch F1–F4 fixados em teste de UI | F1 skeleton + não-sincronizado só quando servidor diz; F2 toast com `description`; F3 mensagem do servidor; F4 abort + `versaoCarteira` + persistência de estado — 1 teste por sub-caso | ≥ 1 teste por defeito | ✅ | `src/frontend/app/sispag/components/BoletosDdaTab.test.tsx:300-468` |
| Testes dedicados aos componentes extraídos (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) | 0; exercitados só indiretamente pela aba DDA e pela aba Títulos | ≥ 1 arquivo por componente de interação (`SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`) | ⚠️ | `find src/frontend/app/sispag/situacao -name 'ChipFiltro.test*' -o -name 'SegmentosComTotal.test*' -o -name 'PaginacaoTabela.test*' -o -name 'PilulasFiltroAtivo.test*'` → vazio |
| Determinismo do novo cache | relógio injetável via `ConsolidacaoBoletoDdaCache.withClock(() => agora)` em teste | relógio injetável | ✅ | `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:35-41`, usado em `BoletoDdaService.test.ts:356-367` |
| Determinismo da virada do dia na aba DDA (`faixa`/`urgentes`) | Serviço injeta `hoje` do `BankingCalendar`; `paginar` recebe `hoje` como parâmetro — sem `new Date()` escondido no caminho do filtro | 0 leituras de relógio não-abstraídas na cadeia do filtro | ✅ | `PaginacaoBoletoDda.ts:97-108` + `BoletoDdaService.ts:85` |
| Teste da política "sincronizar invalida o cache mesmo com mesma marca de pool" | 1 (`BoletoDdaService.test.ts:343-350`) | ≥ 1 | ✅ | mesmo arquivo |
| Teste da LRU do cache (`MAX_ENTRADAS = 4`) | 0 — a constante é módulo-privada e nenhuma suíte dirige mais de 2 chaves | ≥ 1 cenário que ultrapassa o limite | ⚠️ | `ConsolidacaoBoletoDdaCache.ts:7` |
| `arquivosLidos` derivado no servidor com teste | 1 — mock de `listarItens` com 1 falha e 1 adiado (`BoletoDdaService.test.ts:286-297`) | ≥ 1 | ✅ | mesmo arquivo |
| Cobertura (lines) por diretório tocado | ⚠️ **Não medível localmente** sem rodar `npm test -- --coverage` em ambos projetos (bancos/mocks externos) e sem alvo oficial no `jest.config` do repo | 80% lines em `domain/service/sispag`, 80% em `app/sispag/boletos-dda`/`components` | ⚠️ | sem `coverageThreshold` em `src/backend/jest.config.*` nem em `src/frontend/jest.config.*` |

## 3. Tactics — Cobertura no nf-projects

Lente aplicada **ao delta**, não ao repo inteiro.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `PaginacaoBoletoDda.paginar` é pura e exporta `filialDe`, `faixaDe`, `COLUNAS_ORDENAVEIS`, `FAIXAS_FILTRAVEIS`, `SITUACOES_FILTRAVEIS`, `BOLETO_DDA_AMOSTRA_HOJE` — a função de filtro pode ser testada sem container; o Zod da rota reusa as mesmas constantes | ✅ | `PaginacaoBoletoDda.ts:221-385`; usado em `routes/sispag.ts:1540-1587` |
| Specialized Interfaces (cache) | `ConsolidacaoBoletoDdaCache.withClock(clock, ttlMs?)` abre o relógio e o TTL só para teste; `invalidar()` público | ✅ | `ConsolidacaoBoletoDdaCache.ts:35-41`, `69-73` |
| Recordable Test Cases | Fixtures `*.rem` em `src/backend/domain/interface/sispag/__fixtures__` ficaram intocadas (não é o foco do delta); a aba DDA mocka `fetchBoletosDda`/`sincronizarBoletosDda` com builder `pagina()` — não há fixture de resposta DDA versionada em disco | ⚠️ | `src/frontend/app/sispag/components/BoletosDdaTab.test.tsx:67-115` |
| Sandbox | `BoletoDdaService` recebe clientes mockáveis via tsyringe; `build(lockLivre, agora)` constrói o serviço com injeção manual sem container (padrão CLAUDE.md) | ✅ | `BoletoDdaService.test.ts:21-72` |
| Executable Assertions | Zod no boundary (`boletosDdaSchema` validando listas, enums e `ordem`); 6 casos negativos (400) travados em teste | ✅ | `routes/sispag.ts:1543-1587`, `routes/sispag.test.ts:1715-1726` |
| Abstract Data Sources | Repos (`BoletoDdaRepository`, `TituloAPagarRepository`, `LotePagamentoRepository`, `PagamentoIngestaoRunRepository`) injetados; nenhum SQL direto na aba | ✅ | `BoletoDdaService.ts:60-74` |
| Limit Structural Complexity | A UI foi partida em `boletos-dda/*` + componentes compartilhados em `situacao/*` — `BoletosDdaTab.tsx` encolheu (592 linhas de diff removidas). Serviço idem: a consolidação virou método privado reutilizável | ✅ | `boletos-dda/{FaixaBoletosHoje,FiltroSituacaoDdaBarra,TabelaBoletosDda,useTabelaBoletosDda,filtrosBoletosDda,rotulosDda,RegrasBoletoDda}.tsx` |
| Limit Structural Complexity (gap) | Os 5 componentes compartilhados (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) foram extraídos **sem** suíte própria — só se tornam testáveis em isolamento | ⚠️ | `ls src/frontend/app/sispag/situacao` sem `.test.*` para os cinco |
| Limit Non-Determinism | Cache usa `clock` injetável; `hoje` passa como parâmetro em todo o fluxo de filtro; nenhum `Date.now()` ou `new Date()` novo no servidor; teste F4 injeta `AbortController` real | ✅ | `ConsolidacaoBoletoDdaCache.ts:35-41`, `PaginacaoBoletoDda.ts:97-108`, `BoletosDdaTab.test.tsx:395-404` |
| Limit Non-Determinism (gap) | Teste anterior usava `jest.useFakeTimers` + `jest.setSystemTime` em "Vencem em até 2 dias" (removido); o novo depende do servidor devolver `urgentes/urgentesParaConferir` corretos — sem controle de relógio no teste UI | ⚠️ | `BoletosDdaTab.test.tsx:430-454` |

## 4. Findings

### F-testability-1: `ConsolidacaoBoletoDdaCache` não tem suíte própria; LRU e corrida contra `invalidar()` ficam sem rede

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces + Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:1-83`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache*.test.ts
  (vazio)
  ```
  O cache é peça nova com 4 invariantes não-triviais: TTL, single-flight, geração (um `invalidar()` durante um `calcular()` em voo não pode guardar o resultado antigo) e LRU com `MAX_ENTRADAS = 4`. Hoje os cinco testes do serviço cobrem TTL, keying e invalidation, mas:
  - a LRU (`while (this.entradas.size >= MAX_ENTRADAS)` em `:76-80`) só executa com ≥ 5 chaves distintas vivas; nenhum teste chega lá.
  - a proteção `if (this.geracao === geracao)` em `:58` (invalidar durante inflight) não é exercitada.
- **Impacto técnico**: Mudança futura que remove a cláusula de geração ou troca o `Map` por `WeakMap` passa verde; vazamento de memória se a LRU quebrar passa verde.
- **Impacto de negócio**: cache stale pode mostrar grupo "sugerido" quando o analista acabou de confirmar — mesmo sintoma que motivou a ADR‑0067 (emenda 2026-10-30). Reaparece sem alarme.
- **Métrica de baseline**: 0 testes próprios; 2 branches críticas sem cobertura direta.

### F-testability-2: componentes compartilhados extraídos sem suíte unitária

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/frontend/app/sispag/situacao/ChipFiltro.tsx`, `SegmentosComTotal.tsx`, `PilulasFiltroAtivo.tsx`, `PaginacaoTabela.tsx`, `botoesDeCard.ts`
- **Evidência (objetiva)**:
  ```
  $ find src/frontend/app/sispag/situacao -name '*ChipFiltro*.test*' -o -name '*SegmentosComTotal*.test*' -o -name '*PaginacaoTabela*.test*' -o -name '*PilulasFiltroAtivo*.test*'
  (vazio)
  ```
  São hoje contratos entre duas abas (Títulos a pagar e Boletos DDA). Alterar `aria-pressed` ou a chave `onSelecionar` quebra as duas abas, mas o diagnóstico vem da suíte de aba, não do componente — o salto é maior.
- **Impacto técnico**: regressões em um componente aparecem como "quebrou cinco testes de aba" em vez de "quebrou um teste de componente"; o custo de localizar sobe.
- **Impacto de negócio**: menor — ainda há sinal verde→vermelho; só o tempo de triagem aumenta.
- **Métrica de baseline**: 5 componentes, 0 testes dedicados; cobertura 100% indireta via dois arquivos `BoletosDdaTab.test.tsx` e `TitulosAbaSituacao.test.tsx`.

### F-testability-3: `fetchBoletosDda` sem fixture versionada de resposta — builder `pagina()` divergiu silenciosamente antes

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/frontend/app/sispag/components/BoletosDdaTab.test.tsx:67-115`
- **Evidência (objetiva)**: o builder `pagina()` monta `totais`, `facetas`, `amostraHoje` à mão; nenhum fixture lido do backend; `BoletosDdaResposta.totais` é marcado `?` em `lib/sispag.ts:1793` justamente porque "backend anterior à v0.80 não manda". O risco de o builder desalinhar do contrato real do servidor é segurado só pelo tipo (`?`), não por um exemplo gravado.
- **Impacto técnico**: mudança incompatível no servidor pode manter os testes verdes; só o tipo-check pega, e só quando o campo não é opcional.
- **Impacto de negócio**: baixo neste delta porque o `routes/sispag.test.ts` cobre a serialização lado servidor; mas a assimetria vai acumular.
- **Métrica de baseline**: 0 fixtures JSON de resposta DDA; 2 testes com builder manual.

### F-testability-4: teste UI depende dos totais virem prontos do servidor para disparar "Vencem em até 2 dias" e "vencem hoje"

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/frontend/app/sispag/components/BoletosDdaTab.test.tsx:430-468`
- **Evidência (objetiva)**:
  ```ts
  mockFetch.mockResolvedValue(
    pagina([ADP], {
      totais: { ...pagina([ADP]).totais!, urgentes: { qtd: 1, valor: 4815.33 }, urgentesParaConferir: { qtd: 1, valor: 4815.33 } },
    }),
  )
  ```
  O teste anterior usava `jest.useFakeTimers()` + `jest.setSystemTime('2026-09-24T15:00:00Z')` para checar que a UI mandava `vencimentoDe/Ate` corretos (versão antiga). Agora a correção foi delegada ao servidor; o teste UI confia que a resposta do servidor carrega `urgentes`/`hoje` corretos. A lógica de servidor TEM teste (`PaginacaoBoletoDda.test.ts:238-262`), então o buraco é informacional, não de risco.
- **Impacto técnico**: um bug onde o botão "Ver só os urgentes" monta `faixas` erradas na UI com totais corretos passaria pelo teste UI. Baixo porque o filtro final é o servidor, e o server-test cobre `faixas: ['HOJE', '1-2']`.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 1 teste exerce a interação; 0 testes amarram a UI a um relógio controlado para faixas.

### F-testability-5: suíte do delta sem `coverageThreshold` no Jest — não há portão numérico

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (CI gate)
- **Localização**: `src/backend/jest.config.*`, `src/frontend/jest.config.*`
- **Evidência (objetiva)**:
  ```
  $ grep -rn coverageThreshold src/backend src/frontend
  (vazio)
  ```
  O delta aumentou significativamente o volume de código (342 linhas em `PaginacaoBoletoDda.ts`, 83 em `ConsolidacaoBoletoDdaCache.ts`, novas rotas) sem elevar nenhum piso. Em um review centrado em "paridade" seria barato fixar um piso para `domain/service/sispag/*` e `app/sispag/boletos-dda/*`.
- **Impacto técnico**: regressão de cobertura passa muda.
- **Impacto de negócio**: a confiança nos cards verdes é só anedótica.
- **Métrica de baseline**: 0% de threshold declarado; cobertura real do delta não foi medida nesta sessão.

## 5. Cards Kanban

### [testability-1] Suíte própria para `ConsolidacaoBoletoDdaCache`

- **Problema**
  > `ConsolidacaoBoletoDdaCache` é novo em `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:1-83` e carrega 4 invariantes (TTL, single-flight, geração durante inflight, LRU com `MAX_ENTRADAS=4`). Hoje só é exercitado via `BoletoDdaService.test.ts`, que cobre TTL, keying e invalidation — a LRU e a proteção `geracao === geracao` em `:58` ficam sem rede.
- **Melhoria Proposta**
  > Criar `ConsolidacaoBoletoDdaCache.test.ts` ao lado, usando `withClock` já exposto. Cenários mínimos: (a) 5 chaves distintas em TTL → a mais antiga é descartada; (b) `invalidar()` chamado durante um `calcular()` em voo → o valor que a Promise resolver NÃO entra no cache; (c) falha de `calcular` apaga a entrada em voo e não guarda; (d) `obter` concorrente na mesma chave resolve uma única vez. Tactic Bass: *Specialized Interfaces* + *Limit Non-Determinism*.
- **Resultado Esperado**
  > Branches do cache 2 → 4 testadas; testes dedicados ao cache 0 → 4; execução adicional < 1 s.
- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Arquivos de teste cobrindo o cache: 0 → 1
  - Cenários de cache testados: 5 (via serviço) → 9 (5 + 4 dedicados)
- **Risco de não fazer**: uma regressão silenciosa na geração ou na LRU reintroduz o sintoma da ADR-0067 (grupo "sugerido" mostrado após confirmação) sem alarme no CI.
- **Dependências**: nenhuma

### [testability-2] Suíte unitária para os cinco componentes compartilhados extraídos

- **Problema**
  > Componentes `ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela` e `botoesDeCard` passaram a ser contrato entre as abas Títulos a pagar e Boletos DDA, mas nenhum tem suíte própria. Regressão em um componente aparece como "quebrou cinco testes de aba" em vez de "quebrou um teste de componente".
- **Melhoria Proposta**
  > Adicionar `src/frontend/app/sispag/situacao/{ChipFiltro,SegmentosComTotal,PilulasFiltroAtivo,PaginacaoTabela}.test.tsx`. Pelo menos: `aria-pressed`, `onSelecionar` com `valor` certo, exibição de `qtd` e `R$`, foco visível, botão "Remover filtro: X" dispara `onRemover`. Tactic Bass: *Limit Structural Complexity*.
- **Resultado Esperado**
  > Diagnóstico direto quando o contrato quebra: 1 teste vermelho no componente em vez de 5 em abas.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes dedicados aos componentes extraídos: 0 → 4 arquivos
  - Testes de aba falhando numa quebra de componente: ≥ 5 → ≤ 2
- **Risco de não fazer**: tempo de triagem aumenta; a próxima extração (quando a Frente IV reutilizar) herda a opacidade.
- **Dependências**: nenhuma

### [testability-3] Fixture versionada da resposta `BoletosDdaResposta`

- **Problema**
  > `src/frontend/app/sispag/components/BoletosDdaTab.test.tsx:67-115` monta a resposta do servidor com um builder manual. `totais`, `facetas` e `amostraHoje` são opcionais no tipo "porque backend anterior à v0.80 não manda" — o teste pode divergir do que o servidor realmente emite e manter-se verde.
- **Melhoria Proposta**
  > Gravar 1-2 fixtures JSON (ex.: `__fixtures__/boletos-dda-pagina-25.json`), geradas a partir de uma chamada real contra `routes/sispag.ts` em um test harness do backend. O builder `pagina()` passa a `JSON.parse` o fixture e sobrescrever campos. Tactic Bass: *Recordable Test Cases*.
- **Resultado Esperado**
  > Divergência server↔client fica detectável; os campos opcionais podem virar obrigatórios quando o rollout permitir.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Fixtures JSON de resposta DDA: 0 → 2
  - Campos opcionais hoje por compatibilidade (`totais?`, `facetas?`, `amostraHoje?`): 3 → 0 depois do rollout
- **Risco de não fazer**: cresce a dívida de contrato toda vez que o servidor adicionar campo.
- **Dependências**: nenhuma

### [testability-4] Fixar `coverageThreshold` para o escopo da feature

- **Problema**
  > Jest não tem `coverageThreshold` em nenhum dos dois projetos. O delta é grande (`PaginacaoBoletoDda.ts` +342, cache novo, rotas, UI), mas o único portão é "suíte verde".
- **Melhoria Proposta**
  > Em `src/backend/jest.config.*` fixar `coverageThreshold` por *path pattern* para `src/backend/domain/service/sispag/{BoletoDdaService,PaginacaoBoletoDda,ConsolidacaoBoletoDdaCache}.ts` (80/70/80 lines/branches/functions). Em `src/frontend/jest.config.*` idem para `src/frontend/app/sispag/boletos-dda/*`. Ligar no CI do PR. Tactic Bass: *Executable Assertions*.
- **Resultado Esperado**
  > Regressão de cobertura no caminho crítico quebra o PR; o número vira defendível.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - `coverageThreshold` nos arquivos tocados: 0% declarado → 80% lines
  - Cobertura real do delta: ⚠️ não medida nesta sessão → ≥ 80% em `domain/service/sispag/{BoletoDdaService,PaginacaoBoletoDda,ConsolidacaoBoletoDdaCache}.ts`
- **Risco de não fazer**: a próxima feature que raspar o service passa com 40% e ninguém vê.
- **Dependências**: nenhuma

### [testability-5] Teste de UI com relógio controlado para "Vencem em até 2 dias" / "Ver só estes" na faixa de hoje

- **Problema**
  > Hoje o teste UI que exercita "Ver só os urgentes" e "Ver só estes" injeta `totais.urgentes`/`totais.hoje` prontos no mock, sem controlar relógio. A UI atual delega a semântica ao servidor (`faixas: ['HOJE','1-2']`), que **está** testado em `PaginacaoBoletoDda.test.ts:238-262`. Mas o teste UI deixa de amarrar o rótulo exibido ("vencem hoje" / "em até 2 dias") a um dia civil específico.
- **Melhoria Proposta**
  > Adicionar 1 teste em `BoletosDdaTab.test.tsx` que configura `jest.setSystemTime` para `2026-10-30T15:00Z` e checa que a faixa "Boletos não casados que vencem hoje" mostra a data certa, e que o botão "Ver só estes" ainda monta `faixas: ['HOJE']` nessa data. Tactic Bass: *Limit Non-Determinism*.
- **Resultado Esperado**
  > Relação rótulo-exibido ↔ dia civil amarrada por teste. Resistente à troca de fuso.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Testes UI com relógio controlado para a faixa: 0 → 1
- **Risco de não fazer**: baixo — o server-test já cobre a classificação; só a renderização de rótulo em dia-virada fica a descoberto.
- **Dependências**: nenhuma

## 6. Notas do agente

- Testes **estão todos verdes** no worktree: `backend` 3/3 suítes (183), `frontend` 4/4 (112) do delta e 6/6 (140) de Títulos sem edição — a invariante "Títulos verdes sem toque" **está satisfeita** (`git diff --stat` lista zero `*situacao/*.test.*`; só o `TabelaTitulos.tsx` e `FiltroSituacaoBarra.tsx` mudam, para consumir os componentes extraídos).
- Cobertura real por diretório não foi medida: evitei rodar `--coverage` porque o `jest.config` do backend puxa integration suites que dependem de Postgres; recomendei fixar `coverageThreshold` como entrega (card testability-4) para que o número apareça no CI.
- Cross-QA: F-testability-1 (cache sem suíte própria) toca também **Modifiability** — a próxima refatoração do cache não tem rede. F-testability-5 (sem threshold) overlap com **Deployability** (portão de PR). F-testability-3 (fixture) overlap com **Integrability** (contrato server↔client).
- Nota de método: a feature foi "quase-TDD" (testes escritos lado a lado, não antes). Mesmo assim, a cobertura dos defeitos F1–F4 é alta e cada defeito tem teste nomeado — melhor que a média do repo para review reduzido.
