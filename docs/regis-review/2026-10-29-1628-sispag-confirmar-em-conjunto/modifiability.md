---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-29-1628
agent: qa-modifiability
generated_at: 2026-10-29T16:40:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev time (produto/Yuri) | Nova regra de elegibilidade ou novo aviso na confirmação em conjunto (p.ex., incluir filiais do mesmo CNPJ raiz, novo aviso de duplicidade) | `RegraIrmaosConjunto`, `ConfirmacaoEmConjuntoService`, `BoletoSuggestionService.confirmar` | Design-time, feature-flag off | Alteração localizada em `RegraIrmaosConjunto.motivoInelegivel` + schemas; sem tocar `confirmar` nem repos | ≤ 1 arquivo de serviço + 1 teste de regra; sem ripple em SQL; ≤ 4h de implementação

> O que o diff adiciona é bem alinhado: a elegibilidade do conjunto está isolada em `RegraIrmaosConjunto` (pura, 195 LOC, 0 I/O) e é reusada entre listagem e `confirmar` ao vivo. Mudar uma regra do conjunto é hoje uma alteração de um único arquivo.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `BoletoSuggestionService.ts` | 1402 (+87 no diff) | ≤ 600 | ❌ | `wc -l src/backend/domain/service/sispag/BoletoSuggestionService.ts` |
| LOC `AjusteCentavosTituloService.ts` | 1307 (+45 no diff) | ≤ 600 | ❌ | `wc -l` |
| LOC `routes/sispag.ts` | 1927 (+51 no diff) | ≤ 400 | ❌ | `wc -l` |
| LOC `frontend/lib/sispag.ts` | 3169 (+102 no diff) | ≤ 400 | ❌ | `wc -l` |
| LOC `ConfirmacaoEmConjuntoService.ts` (novo) | 208 | ≤ 400 | ✅ | `wc -l` |
| LOC `RegraIrmaosConjunto.ts` (novo) | 195 | ≤ 400 | ✅ | `wc -l` |
| LOC interface `ConfirmacaoEmConjunto.ts` (novo) | 84 | ≤ 200 | ✅ | `wc -l` |
| Cognitive complexity em `BoletoSuggestionService.confirmar` | 16/19/16 (pre-existente, 3 avisos; inalterado vs main) | ≤ 15 | ⚠️ | `npm run lint -- --max-diagnostics=400` |
| Nº warnings cognitivos NOVOS introduzidos | 0 | 0 | ✅ | `npm run lint` (vs main) |
| Fan-in `BoletoSuggestionService` | 10 arquivos → 11 (+ConfirmacaoEmConjuntoService) | — | ⚠️ (acoplamento alto preexistente) | `grep -rln "from .*BoletoSuggestionService" src/backend` |
| Fan-in `AjusteCentavosTituloService` | 6 arquivos (+1 na feature) | — | ✅ | `grep -rln ...` |
| Fan-in `RegraIrmaosConjunto` (novo) | 2 (service + testes) | — | ✅ | idem |
| Violações de camada (handler → repo direto, service → lambda) no diff | 0 | 0 | ✅ | leitura do diff; PatternGuardian PASS |
| SQL novo introduzido | 0 (reusa `TituloAPagarRepository.buscarPorChave`, `LotePagamentoRepository.listTitulosEmLotesAbertos`, `BoletoDdaRepository.listBoletos`) | — | ✅ | diff |
| Magic numbers em serviços novos | 1 (`CONFIRMACAO_CONJUNTO_MAXIMO = 30`), já extraída como constante nomeada na interface, com rastro em ADR-0080 | 0 soltos | ✅ | `src/backend/domain/interface/sispag/ConfirmacaoEmConjunto.ts:13` |
| Novas interfaces TypeScript criadas (CenarioDecisao, ContextoConjunto, IrmaosConjunto, …) | 7 (pt-BR naming de domínio, mas identifiers EN — ok) | — | ✅ | `ConfirmacaoEmConjunto.ts`, `BoletoSuggestionService.ts:105` |
| Mensagens de erro em pt-BR hard-coded em `RegraIrmaosConjunto.motivoInelegivel` | 5 literais | externalizar p/ catálogo quando crescer | ⚠️ | `RegraIrmaosConjunto.ts:69-85` |
| Mudanças de assinatura em API pública (`BoletoSuggestionService.confirmar`) | +1 campo opcional (`conjunto`) + 1 parâmetro opcional (`cenarioDoConjunto`) — retrocompatível | 0 breaking | ✅ | diff |
| Ontology coverage drift (`_coverage.json`) | não medido no diff (feature atualiza `_index.json`, `_coverage.json` e cria `confirmar-sugestoes-em-conjunto.md` + ADR-0080) | 0 drift | ✅ | `git status` + `ontology/CHANGELOG.md` |

> ⚠️ **Não medível localmente**: cost-of-change histórica (dias por mudança) — depende de histórico de PRs do produto SISPAG; recomendação: medir ciclo-tempo em `/retro-ontology` mensal.

### Appendix A — Top-10 maiores arquivos (`src/backend/**`, não-teste)

| # | Arquivo | LOC |
|---|---------|-----|
| 1 | `domain/service/sispag/RemessaService.ts` | 2425 |
| 2 | `domain/service/recebimentos/RecebimentoNumerarioService.ts` | 2415 |
| 3 | `routes/sispag.ts` | 1927 |
| 4 | `domain/repository/sispag/LotePagamentoRepository.ts` | 1757 |
| 5 | `domain/client/ConexosSispagWriteClient.ts` | 1739 |
| 6 | `domain/service/sispag/BorderoGrupoBoletoService.ts` | 1589 |
| 7 | `domain/service/sispag/LotePagamentoService.ts` | 1493 |
| 8 | `domain/service/sispag/BoletoSuggestionService.ts` | **1402 (tocado neste diff)** |
| 9 | `domain/service/sispag/VinculoCodigoBarrasService.ts` | 1369 |
| 10 | `domain/service/sispag/AjusteCentavosTituloService.ts` | **1307 (tocado neste diff)** |

### Appendix B — Fan-in dos serviços tocados / vizinhos

| Serviço | Fan-in (imports em `src/backend`) | Tocado no diff |
|---------|------------------------------------|----------------|
| `LotePagamentoService` | 6 | — |
| `RemessaService` | 5 | — |
| `BoletoSuggestionService` | 10 (+1 c/ a feature) | ✅ (+96/-9) |
| `AjusteCentavosTituloService` | 6 (+1 c/ a feature) | ✅ (+45/0) |
| `VinculoCodigoBarrasService` | 3 | — |
| `ConfirmacaoEmConjuntoService` (novo) | 2 (route + testes) | ✅ |
| `RegraIrmaosConjunto` (novo) | 2 (service + testes) | ✅ |

## 3. Tactics — Cobertura no diff

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | A feature *não* divide `BoletoSuggestionService` (já 1402 LOC); mas evita engordá-lo mais mergulhando a orquestração em `ConfirmacaoEmConjuntoService` e a regra em `RegraIrmaosConjunto`. | ⚠️ parcial | `src/backend/domain/service/sispag/{BoletoSuggestionService,ConfirmacaoEmConjuntoService,RegraIrmaosConjunto}.ts` |
| **Increase Semantic Coherence** | `RegraIrmaosConjunto` concentra a regra de elegibilidade do conjunto numa única classe pura; `ConfirmacaoEmConjuntoService` só orquestra. Cada arquivo novo responde a uma pergunta só. | ✅ presente | `RegraIrmaosConjunto.ts:60-88` (`motivoInelegivel`), `ConfirmacaoEmConjuntoService.ts:90-154` (`confirmarEmConjunto`) |
| **Encapsulate** | O `confirmar` individual permanece a única porta de escrita; o conjunto injeta um `ContextoConjunto` opcional e um `CenarioDecisao` opcional. Nenhum repositório novo, nenhum SQL novo. Baixo acoplamento com o resto. | ✅ presente | `BoletoSuggestionService.ts:252-265` (overload opcional) |
| **Use an Intermediary** | `ConfirmacaoEmConjuntoService` é o intermediário entre a rota e o `confirmar`. Isola o laço, a leitura ao vivo de lotes, o cache de cenário e a fila de ajuste. | ✅ presente | `ConfirmacaoEmConjuntoService.ts:121-128` |
| **Restrict Dependencies** | DDD mantido (route → service → service/repo). PatternGuardian PASS. Nenhum layer-skip. `RegraIrmaosConjunto` é pura (apenas `CodigoBarrasBoleto`). | ✅ presente | diff + PatternGuardian |
| **Refactor** | `confirmar` ganhou dois helpers privados (`exigirElegivelNoConjunto`, `detalheDoConjunto`, `agendarAjusteIndividual`, `cenarioDaDecisao`) que **reduzem** o corpo da função em vez de inchá-lo; é o único refactor local. Mas a função já estava com cognitive complexity 19 em main e **continuou em 19** — o teto `≤15` não foi vencido. | ⚠️ parcial | `BoletoSuggestionService.ts:1247-1300` |
| **Abstract Common Services** | `motivoInelegivel` é reusado pela listagem **e** pelo `confirmar` ao vivo — a mesma regra em duas chamadas, sem duplicação. | ✅ presente | `BoletoSuggestionService.ts:1247-1264` + `RegraIrmaosConjunto.ts:111-125` |
| **Defer Binding — configuration** | `CONFIRMACAO_CONJUNTO_MAXIMO = 30` é uma constante nomeada na *interface*, com ADR-0080 justificando o número. Não é hot-reload nem SSM — ajustável por mudança de código + ADR curta. Pragmaticamente aceitável; porém operá-la por tenant pedirá mudança. | ⚠️ parcial | `ConfirmacaoEmConjunto.ts:13` |
| **Defer Binding — polymorphism** | `tsyringe` segue DI padrão (`@injectable()`), um impl por token. Sem variação em runtime (consistente com o domínio bound). | ✅ presente (uso convencional) | `RegraIrmaosConjunto.ts:53-57`, `ConfirmacaoEmConjuntoService.ts:47-58` |
| **Defer Binding — runtime registration / plugin** | N/A — domínio fechado; nenhuma necessidade de registro de plugins introduzida pela feature. | N/A | — |

## 4. Findings

### F-modifiability-1: `BoletoSuggestionService.ts` passou de ~1315 → 1402 LOC e permanece como "god service" tocado por todo caminho de escrita de SISPAG

- **Severidade**: P2 (débito preexistente, não agravado materialmente pelo diff — +87 LOC)
- **Tactic violada**: Split Module / Reduce Size of Module
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1-1402`
- **Evidência (objetiva)**:
  ```
  wc -l src/backend/domain/service/sispag/BoletoSuggestionService.ts → 1402
  Fan-in: 10 arquivos (now +1 = 11 após feature)
  Alvo: ≤600 LOC por arquivo
  ```
- **Impacto técnico**: cada feature de SISPAG tende a tocar esta classe; alterações em métodos privados (ex.: `cenarioDaDecisao`) convivem com responsabilidades de **listagem**, **confirmar**, **revogar**, **detalhar** e **avaliação**. Risco de regressão silenciosa em métodos não-tocados por falta de isolamento.
- **Impacto de negócio**: cada mudança no serviço central do SISPAG exige regressão ampla (127 testes só do serviço); a feature atual gastou um ciclo inteiro de perf (D9) só porque `confirmar` chamava `sugerirAgora()` 30x no laço — sintoma clássico de método público superusado.
- **Métrica de baseline**: 1402 LOC (alvo 600); 3 funções com cognitive complexity ≥ 16 (`confirmar`, `revogarConfirmacao`, outro em 590) — preexistentes.

### F-modifiability-2: `BoletoSuggestionService.confirmar` continua acima do teto de complexity (19) depois do diff, apesar da extração de helpers

- **Severidade**: P2 (número preexistente, inalterado; o diff **não** piorou; o fato de não ter sido reduzido é oportunidade)
- **Tactic violada**: Refactor
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:277-490` (área de `confirmar`)
- **Evidência (objetiva)**:
  ```
  BoletoSuggestionService.ts:277:34 cognitive complexity 16 (max 15)
  BoletoSuggestionService.ts:374:68 cognitive complexity 19 (max 15)
  BoletoSuggestionService.ts:590:68 cognitive complexity 16 (max 15)
  main: idênticos.
  ```
- **Impacto técnico**: cada nova regra condicional em `confirmar` (I15t agora, I15u amanhã) empilha ramificações. Com 19 já no topo, próxima feature atravessa o teto do Biome e o lint cai de "warning" para gate falso-positivo visual.
- **Impacto de negócio**: curva de dificuldade de leitura cresce em O(n) com invariantes acrescentadas em `confirmar` — PRs de SISPAG levam mais horas de revisão.
- **Métrica de baseline**: cognitive complexity 19 em `confirmar` (alvo 15).

### F-modifiability-3: `routes/sispag.ts` virou monolítico (1927 LOC) e o diff acrescenta mais 2 rotas sem particionar

- **Severidade**: P2
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/routes/sispag.ts:1-1927`
- **Evidência (objetiva)**:
  ```
  wc -l src/backend/routes/sispag.ts → 1927 (alvo ≤400)
  Diff adiciona +51 LOC (duas rotas de I15t) na mesma file.
  ```
- **Impacto técnico**: diffs de rotas sempre viram merge-conflict pt. Toda feature de SISPAG mexe aqui; sem partição por sub-escopo (lotes, sugestões, grupo, retorno, …), a probabilidade de conflito cresce linearmente com o nº de PRs paralelos.
- **Impacto de negócio**: paralelização de analistas/features é freada pela contenção na routes file; o worktree-first mitiga, não resolve.
- **Métrica de baseline**: 1927 LOC em um módulo de rotas (alvo ≤400).

### F-modifiability-4: `frontend/lib/sispag.ts` (3169 LOC) hospeda schemas Zod + fetchers do SISPAG inteiro; o diff empilha +102 LOC

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/frontend/lib/sispag.ts:1-3169`
- **Evidência (objetiva)**:
  ```
  wc -l src/frontend/lib/sispag.ts → 3169 (alvo ≤400)
  Diff: +102 LOC (schemas `IrmaosConjunto`, `ResultadoConjunto`, fetchers)
  ```
- **Impacto técnico**: toda tela SISPAG importa deste único módulo; schema Zod duplicado entre back e front; mudança em qualquer contrato DTO exige editar aqui e em `interface/sispag/*`.
- **Impacto de negócio**: alto risco de drift entre schema Zod do backend e do frontend (contratos replicados "à mão"); custo de change em DTOs é 2x por natureza.
- **Métrica de baseline**: 3169 LOC em um único módulo de API client (alvo ≤400).

### F-modifiability-5: mensagens de recusa do `RegraIrmaosConjunto` e `ConfirmacaoEmConjuntoService` são literais pt-BR embutidos no código

- **Severidade**: P3 (admitido pela ADR-0042 de set/2026; aceitável enquanto o produto for mono-cliente/mono-idioma)
- **Tactic violada**: Defer Binding — configuration externalization (parcial)
- **Localização**: `src/backend/domain/service/sispag/RegraIrmaosConjunto.ts:69-85`; `ConfirmacaoEmConjuntoService.ts:33,166-179`
- **Evidência (objetiva)**:
  ```
  5 literais em `motivoInelegivel`:
    'O título é de outra filial…', 'O título é de outro credor…',
    'O boleto deste título não é confirmável agora.',
    'O boleto não foi escolhido pelo número do documento…',
    'Este título exige reconhecimento da diferença de data…'
  + 2 literais em ConfirmacaoEmConjuntoService (lote finalizado, filial)
  ```
- **Impacto técnico**: cada ajuste de wording passa por PR + typecheck + Biome + jest (hoje); nenhuma reutilização via catálogo. O cliente humano é o analista — texto é parte do contrato de UX.
- **Impacto de negócio**: baixo hoje; aumenta se internacionalizar ou introduzir glossário por cliente.
- **Métrica de baseline**: 7 mensagens pt-BR hard-coded nos arquivos novos.

## 5. Cards Kanban

### [modifiability-1] Dividir `BoletoSuggestionService` por caso de uso (sugerir / confirmar / revogar / cenário)

- **Problema**
  > `BoletoSuggestionService.ts` chegou a 1402 LOC com fan-in 11 e três hotspots de complexity ≥ 16. Toda feature de SISPAG passa por ele; a feature atual precisou de helpers extras só pra não piorar o cognitive em `confirmar`, e um ciclo de perf (D9) foi gasto porque o `confirmar` chamava `sugerirAgora()` 30x no laço.
- **Melhoria Proposta**
  > Aplicar **Split Module**: extrair pelo menos (a) `CenarioSugestoesService` (cache + `sugerirAgora`/`desfechosEmCache`/`cenarioParaConjunto`), (b) `ConfirmacaoSugestaoService` (fluxo de `confirmar` + helpers), (c) `RevogacaoSugestaoService`. Manter `BoletoSuggestionService` apenas como fachada readonly do cenário.
- **Resultado Esperado**
  > `BoletoSuggestionService.ts` ≤ 600 LOC; `confirmar` isolado num arquivo ≤ 400 LOC; cognitive complexity em `confirmar` recuar para ≤ 15.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: L (1–2 sem)
- **Findings relacionados**: F-modifiability-1, F-modifiability-2
- **Métricas de sucesso**:
  - LOC `BoletoSuggestionService.ts`: 1402 → ≤ 600
  - Cognitive complexity em `confirmar`: 19 → ≤ 15
  - Fan-in da fachada mantido 10–11; serviços extraídos com fan-in ≤ 3
- **Risco de não fazer**: a próxima invariante do SISPAG (p.ex. I15u) empurrará `confirmar` para >22 de complexity e vai pedir uma nova rodada de helpers artificiais; curva de change-cost cresce.
- **Dependências**: nenhuma; a feature atual não bloqueia o split.

### [modifiability-2] Particionar `routes/sispag.ts` por sub-escopo

- **Problema**
  > `routes/sispag.ts` tem 1927 LOC e cada feature SISPAG empilha mais rotas. A feature atual acrescentou +51 LOC. Toda PR paralela do SISPAG conflita aqui.
- **Melhoria Proposta**
  > Dividir em `routes/sispag/{lotes,sugestoes,grupo,retorno,painel}.ts` montados por um `router.use()` em `routes/sispag/index.ts`. Mover as duas rotas de I15t para `routes/sispag/sugestoes.ts`.
- **Resultado Esperado**
  > Nenhum arquivo em `routes/sispag/*` acima de 500 LOC; conflitos de merge concentrados por sub-domínio.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - max LOC em `routes/sispag/*`: 1927 → ≤ 500
  - nº de PRs com conflito nessa pasta no último trimestre: medir baseline (não medido localmente) → ↓ 50%
- **Risco de não fazer**: contenção crescente em merges paralelos de SISPAG; o worktree-first só adia o conflito até o rebase.

### [modifiability-3] Compartilhar schemas Zod entre backend e frontend em vez de duplicar em `frontend/lib/sispag.ts`

- **Problema**
  > `frontend/lib/sispag.ts` tem 3169 LOC e redeclara schemas Zod que já existem em `src/backend/domain/interface/sispag/*`. A feature atual duplicou `irmaoConjuntoSchema`, `irmaosConjuntoSchema`, `resultadoConjuntoSchema` (102 LOC). Toda mudança de DTO custa 2x e corre risco de drift.
- **Melhoria Proposta**
  > Mover os schemas Zod para `src/shared/sispag/` (ou publicar via `src/backend/domain/interface/**` consumido pelo FE), e deixar o `frontend/lib/sispag.ts` apenas com fetchers. Alternativa pragmática: gerar os tipos TS do FE a partir dos schemas Zod do BE em build-time.
- **Resultado Esperado**
  > `frontend/lib/sispag.ts` encolhe (fetchers only); zero drift entre contratos; mudança de DTO custa 1 arquivo de schema.
- **Tactic alvo**: Abstract Common Services / Encapsulate
- **Severidade**: P2
- **Esforço estimado**: L (1–2 sem — organização de workspace)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - LOC `frontend/lib/sispag.ts`: 3169 → ≤ 800
  - nº de schemas Zod duplicados entre FE e BE: medir hoje (≥ 20 estimado) → 0
- **Risco de não fazer**: drift silencioso de contrato; bug em produção já aconteceu em features anteriores por diferença de `optional()` entre BE e FE.
- **Dependências**: ADR curta sobre `src/shared/`.

### [modifiability-4] Reduzir cognitive complexity do `confirmar` abaixo de 15 enquanto a extração maior (card 1) não acontece

- **Problema**
  > `BoletoSuggestionService.confirmar` segue em 19 (teto 15). A feature acrescentou chamadas, mas também extraiu 4 helpers; mesmo assim o Biome continua gritando. É possível descer a 15 com uma rodada local de "Replace Conditional with Guard Clause" sem esperar o split do card 1.
- **Melhoria Proposta**
  > **Refactor** local: converter os ramos de exigência (reconhecimento, tier, parVigente, conjunto, divergência de data) numa cadeia de guard clauses pequenas e, se preciso, inlineá-las num `validarAntesDeConfirmar(input, cenario)` isolado.
- **Resultado Esperado**
  > `confirmar` com cognitive complexity ≤ 15; `BoletoSuggestionService.ts` com 0 warnings de `noExcessiveCognitiveComplexity`.
- **Tactic alvo**: Refactor
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Biome warnings em `BoletoSuggestionService.ts`: 3 → 0
  - cognitive em `confirmar`: 19 → ≤ 15
- **Risco de não fazer**: a próxima invariante (I15u, I15v…) estoura o teto; cada warning convive com os já existentes e vira ruído na revisão.
- **Dependências**: nenhuma.

### [modifiability-5] Catalogar mensagens de recusa do SISPAG num único arquivo por sub-escopo

- **Problema**
  > A feature introduziu 7 literais pt-BR de recusa espalhados entre `RegraIrmaosConjunto`, `ConfirmacaoEmConjuntoService`. Hoje é defensável (ADR-0042), mas o catálogo cresce a cada feature e já há outros 20+ equivalentes em `BoletoSuggestionService`.
- **Melhoria Proposta**
  > Criar `domain/interface/sispag/MensagensSispag.ts` com objetos nomeados (`MOTIVO_CONJUNTO.FORA_DA_FILIAL`, `…OUTRO_CREDOR`, `…EXIGE_RECONHECIMENTO`). Consumir pelo nome. Admitir interpolação por template literal pequena.
- **Resultado Esperado**
  > Alteração de wording = 1 arquivo editado + 0 regressão de teste; base para quando o produto quiser i18n/glossário por cliente.
- **Tactic alvo**: Defer Binding — configuration
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - literais pt-BR em `service/sispag/*.ts` fora do catálogo: medir baseline (~40 estimado) → ≤ 5
- **Risco de não fazer**: baixo hoje; vira trabalho de descoberta no dia que entrar i18n ou white-label.
- **Dependências**: nenhuma.

## 6. Notas do agente

- A feature **não introduziu** novos cheiros de modificabilidade; os 4 arquivos "monolíticos" tocados (BoletoSuggestionService, AjusteCentavosTitulo, routes/sispag.ts, frontend/lib/sispag.ts) já eram P2 preexistentes e foram **minimamente agravados** (+87/+45/+51/+102 LOC). As extensões respeitam a camada DDD e usam DI canônico. Score 7 reflete isso: boa decomposição *dentro* do diff (RegraIrmaosConjunto puro, ConfirmacaoEmConjuntoService como intermediário) contra débito preexistente que a feature não corrigiu.
- Cross-QA: F-modifiability-2 (complexity em `confirmar`) atravessa **Testability** — função com complexity 19 é difícil de cobrir exaustivamente; sinalizar ao `qa-testability`.
- Cross-QA: F-modifiability-1 + F-modifiability-3 (god modules em serviço + rotas) atravessam **Deployability** — qualquer mudança redeployar o SISPAG inteiro; mencionar ao `qa-deployability`.
- Cross-QA: F-modifiability-4 (schemas duplicados FE/BE) atravessa **Integrability** — contrato interno sem fonte única; mencionar ao `qa-integrability`.
- Não medível localmente: ciclo-tempo histórico de mudanças no SISPAG; recomenda-se emitir no `/retro-ontology` mensal.
