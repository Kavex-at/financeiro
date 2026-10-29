---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-29-sispag-grupo-na-carteira
agent: qa-modifiability
generated_at: 2026-10-29T00:00:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Modifiability — Regis-Review (reduzido ao delta `sispag-grupo-na-carteira`)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Produto / ADR-0077 emenda 2026-10-29 | Nova regra: a sugestão de grupo (I21v) tem de aparecer na carteira de títulos sem outra rodada de I/O | `BoletoSuggestionService.sugerirAgora`, `MotorSugestaoBoleto.analisar`, novo `CenarioGrupoBoleto` | dev + HML (cache 30 s em pé, lock vivo na confirmação) | Reaproveitar o cenário já lido pelo 1:1, injetar o `MotorGrupoBoleto` puro, marcar títulos como `GRUPO_SUGERIDO` sem tirar o 1:1 forte | LOC adicionado ≤ 300 nos dois seams; fan-out de `BoletoSuggestionService` ≤ 15 % extra; 0 novas chamadas Conexos; nenhuma trincha de leitura dedicada ao grupo na carteira |

Alvo defendido: o acréscimo é informativo (ponteiro) e usa infra existente — a cada emenda do ADR‑0077, o custo marginal da próxima mudança não cresce mais que o LOC do próprio ADR. O delta cumpre o alvo em intenção; o preço é continuar engordando dois arquivos já grandes (ver findings).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `BoletoSuggestionService.ts` | 1477 | ≤ 600 (p95 do repo) | ❌ | `wc -l src/backend/domain/service/sispag/BoletoSuggestionService.ts` |
| LOC `MotorSugestaoBoleto.ts` | 1374 | ≤ 600 | ❌ | `wc -l …/MotorSugestaoBoleto.ts` |
| LOC `GrupoBoletoService.ts` | 828 | ≤ 600 | ⚠️ | `wc -l …/GrupoBoletoService.ts` |
| LOC `CenarioGrupoBoleto.ts` (novo) | 76 | ≤ 150 | ✅ | `wc -l …/CenarioGrupoBoleto.ts` |
| Imports em `BoletoSuggestionService.ts` (fan-out) | 41 | ≤ 15 | ❌ | `grep -c '^import ' …` |
| Imports em `MotorSugestaoBoleto.ts` | 10 | ≤ 15 | ✅ | idem |
| Crescimento LOC backend no delta | +268 linhas em `service/sispag/` | ≤ 300 | ✅ | `git diff --stat HEAD -- src/backend/domain/service/sispag` |
| Novas dependências injetadas em `BoletoSuggestionService` | +2 (`MotorGrupoBoleto`, `BloqueioDuplicidadeRepository`) | 0 (seam já saturado) | ⚠️ | `BoletoSuggestionService.ts:181-184` |
| Novas constantes/estados compartilhados | +2 (`SITUACAO_SUGESTAO_TITULO.GRUPO_SUGERIDO`, `SUGESTAO_BOLETO_SEM_DDA.GRUPO_SUGERIDO`) | — | ⚠️ | `SugestaoBoleto.ts:331-335`, `SituacaoPagamento.ts:51-55` |
| Testes dedicados ao novo acoplamento | 1 arquivo (`MotorSugestaoBoleto.grupoSugerido.test.ts`) + 2 cenários em `BoletoSuggestionService.test.ts` | ≥ 1 por regra I21v/I21w | ✅ | `git status -s` |

> ⚠️ **Não medível localmente**: fan-in real de `BoletoSuggestionService` em runtime (listagem única cacheada). Requer *tracing* em HML.

### Apêndice 2.A — Arquivos mais pesados do seam SISPAG (contexto para o consolidator)

| # | Arquivo | LOC | Delta no PR |
|---|---|---:|---:|
| 1 | `src/backend/domain/service/sispag/BoletoSuggestionService.ts` | 1477 | +75 |
| 2 | `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` | 1374 | +131 |
| 3 | `src/backend/domain/service/sispag/GrupoBoletoService.ts` | 828 | −17 (DRY: foi para `CenarioGrupoBoleto`) |
| 4 | `src/backend/domain/service/sispag/CenarioGrupoBoleto.ts` | 76 | novo |

### Apêndice 2.B — Fan-in dos seams tocados (serviços que importam, pelo diff)

| Serviço | Fan-in observado nesta mudança | Nota |
|---|---|---|
| `BoletoSuggestionService` | consumido pelo `sispag` route + `page.tsx` (listagem cacheada) | é O ponto único da listagem; qualquer regra nova cai aqui |
| `MotorSugestaoBoleto` | injetado por `BoletoSuggestionService` apenas | isolado — bom |
| `MotorGrupoBoleto` | agora **dois** consumidores (`GrupoBoletoService` e `BoletoSuggestionService`) | fan-in dobrou no delta |
| `CenarioGrupoBoleto` | dois consumidores desde o nascimento | justifica a extração |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Extração correta de `CenarioGrupoBoleto` (76 LOC) tira duplicação de montagem; porém `BoletoSuggestionService` (1477) e `MotorSugestaoBoleto` (1374) continuam crescendo | ⚠️ parcial | `CenarioGrupoBoleto.ts:33-58`; `BoletoSuggestionService.ts` acima de 1k há mais de um ciclo |
| Increase Semantic Coherence | `MotorSugestaoBoleto` passa a dominar duas responsabilidades: alocar 1:1 **e** reconciliar as saídas do `MotorGrupoBoleto` (nova `sugestoesValidas`, `aplicarGrupoSugerido`, `marcarGrupoSugerido`) | ⚠️ parcial | `MotorSugestaoBoleto.ts:349-417, 510-534` |
| Encapsulate | `CenarioGrupoBoleto.montar` encapsula a tradução DB → `EntradaMotorGrupo` que antes vivia no `GrupoBoletoService`. `CenarioGrupoBoleto.paraMotor1a1` esconde o shape consumido pelo 1:1 | ✅ presente | `CenarioGrupoBoleto.ts:34-75`; `GrupoBoletoService.ts:813-828` |
| Use an Intermediary | O par `CenarioGrupoBoleto` + `GrupoSugeridoChaveado` desacopla o motor 1:1 do shape do motor de grupo (não há import cruzado além do type) | ✅ presente | `CenarioGrupoBoleto.ts:9`; `MotorSugestaoBoleto.ts:16, 82-85` |
| Restrict Dependencies | `BoletoSuggestionService` ganha **2** novas injeções (`MotorGrupoBoleto`, `BloqueioDuplicidadeRepository`) num construtor que já tinha ~15 deps | ⚠️ parcial | `BoletoSuggestionService.ts:181-184` |
| Refactor | `GrupoBoletoService.montarCenario` encolheu de ~30 linhas para 15, apontando para o shared helper. Movimento no sentido certo | ✅ presente | `GrupoBoletoService.ts:813-828` (−17 LOC) |
| Abstract Common Services | `CenarioGrupoBoleto.montar` é o abstract common agora servindo **dois** consumidores. Textbook — a tactic foi aplicada no primeiro re-uso, não depois | ✅ presente | `CenarioGrupoBoleto.ts:33` |
| Defer Binding | `MotorGrupoBoleto` chega por tsyringe (`@inject`), e o cenário é construído por função estática pura — fácil trocar a implementação sem tocar no 1:1. Falha de leitura de `marcas` desliga só a sugestão de grupo (feature-flag implícita) | ✅ presente | `BoletoSuggestionService.ts:182, 1095-1114` |

## 4. Findings

### F-modifiability-1: `BoletoSuggestionService` passou de 1402 → 1477 LOC e ganhou 2 injeções; o seam é o principal risco de modificabilidade do SISPAG

- **Severidade**: P1
- **Tactic violada**: Split Module, Restrict Dependencies
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:168-188, 1092-1200`
- **Evidência (objetiva)**:
  ```
  wc -l BoletoSuggestionService.ts → 1477
  grep -c '^import ' BoletoSuggestionService.ts → 41
  @inject count no construtor → ~17 (2 novos neste delta: MotorGrupoBoleto, BloqueioDuplicidadeRepository)
  ```
- **Impacto técnico**: toda feature nova de SISPAG cai nesse arquivo (confirmação em conjunto, DPS, agora grupo sugerido). Já há 5 campos opcionais em `EntradaMotorSugestao` que são atalhos funcionais ("ancoraDesligada", "gruposSugeridos", etc.). O próximo /feature-tweak paga tempo lendo o módulo inteiro para localizar o ponto certo e o PatternGuardian não detecta tamanho.
- **Impacto de negócio**: cada ciclo cresce o tempo de review do Regis-Review no mesmo arquivo. Em 2–3 features, o teste `BoletoSuggestionService.test.ts` começa a passar de 5 s e qualquer *flake* pára a esteira — risco direto ao SLA de liberar remessa até 15:00.
- **Métrica de baseline**: 1477 LOC (p95 do repo = ~400); 41 imports (alvo ≤ 15); 2 novas deps injetadas (deveria ser 0 nesse seam).

### F-modifiability-2: `MotorSugestaoBoleto` absorveu a lógica de reconciliação com o motor de grupos (+131 LOC) e virou co-dono do resultado do `MotorGrupoBoleto`

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts:349-417, 434-507, 510-534`
- **Evidência (objetiva)**:
  ```
  wc -l MotorSugestaoBoleto.ts → 1374 (antes do delta ~1243)
  3 novos métodos privados que operam exclusivamente sobre gruposSugeridos:
    aplicarGrupoSugerido, marcarGrupoSugerido, sugestoesValidas
  1 nova constante de domínio: SITUACOES_QUE_MANTEM
  1 novo campo em Preparo: grupoSugeridoDoTitulo
  ```
- **Impacto técnico**: a próxima emenda da ADR‑0077 (ex.: tornar o grupo "confirmável automático" quando sinal for FORTE) tende a ser codificada aqui ao invés de no `MotorGrupoBoleto`, porque o preparo já conhece o ponteiro. Isso vai acumular regra de grupo dentro do motor 1:1.
- **Impacto de negócio**: motor 1:1 e motor de grupo são as duas peças que o produto cita por nome. Fundí-los subrepticiamente aumenta o custo de qualquer teste A/B futuro (ex.: variar a tolerância do grupo sem mexer no 1:1).
- **Métrica de baseline**: 1 arquivo com 2 responsabilidades claras; `sugestoesValidas` chama `this.avaliar` em O(|elegiveis| × |gruposSugeridos|) sem cache — hoje negligenciável, mas é o ponto onde a complexidade pode escalar silenciosamente.

### F-modifiability-3: `sugestoesValidas` depende de detalhes privados do motor 1:1 (função `avaliar`, tabela `FORCA`) para decidir se um grupo entra ou não

- **Severidade**: P2
- **Tactic violada**: Encapsulate, Restrict Dependencies (acoplamento intra-arquivo mas inter-feature)
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts:515-534`
- **Evidência (objetiva)**:
  ```
  return !elegiveis.some(
      (e) =>
          !doGrupo.has(e.chave) &&
          (FORCA[this.avaliar(e, boleto, pares).resultado] ?? 9) <= 1,
  );
  ```
  A regra "não roube um 1:1 forte alheio" é expressa reusando o avaliador do 1:1. É elegante, mas qualquer troca da heurística 1:1 (ADR futura) altera **em silêncio** o conjunto de grupos aceitos.
- **Impacto técnico**: a regra I21v é funcional mas invisível quando se olha o motor de grupo. O analista que vier ler "por que esse grupo não aparece?" vai bater no `MotorGrupoBoleto.sugerir` e não achar a resposta.
- **Impacto de negócio**: debug lento no primeiro incidente ("por que o grupo sumiu da carteira hoje?"). Tende a virar bilhete para o Yuri.
- **Métrica de baseline**: 1 regra cross-motor sem log, sem teste nomeado "não rouba 1:1 forte alheio" (o teste existe implícito em `MotorSugestaoBoleto.grupoSugerido.test.ts` mas o nome e a localização estão no lado 1:1).

### F-modifiability-4: `SITUACAO_SUGESTAO_TITULO` e `SUGESTAO_BOLETO_SEM_DDA` crescem em dois lugares (BE + FE) a cada estado novo

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/interface/sispag/SugestaoBoleto.ts:331-335`; `src/backend/domain/interface/sispag/SituacaoPagamento.ts:51-55`; `src/frontend/lib/sispag.ts:38-44, 2399-2406`; `src/frontend/app/sispag/components/sugestaoBoleto.ts:119-168`
- **Evidência (objetiva)**:
  ```
  Para introduzir GRUPO_SUGERIDO foi preciso editar:
    SituacaoPagamento.ts  (BE enum)
    SugestaoBoleto.ts     (BE enum)
    SituacaoPagamentoResolver.ts (BE: 3 mapas)
    sispag.ts             (FE enum + schema zod)
    sugestaoBoleto.ts     (FE: ROTULO_SITUACAO, TOM_SITUACAO, SITUACAO_SEM_PAINEL)
    rotulos.ts            (FE: um label a mais)
  ```
- **Impacto técnico**: a cada estado novo da máquina de sugestão o custo marginal é fixo em ~6 arquivos. Nenhum é difícil, mas o esquecimento de um (ex.: `TOM_SITUACAO`) resulta em caixa cinza no front sem erro de compilação.
- **Impacto de negócio**: pequeno agora, significativo quando a Frente IV também usar máquinas análogas.
- **Métrica de baseline**: 6 edições paralelas por estado novo; 0 testes de "cobertura exaustiva do enum" nos mapas do FE.

### F-modifiability-5: Falha de leitura de `BloqueioDuplicidadeRepository.listAtivos` apenas emite `BUSINESS_WARN` e volta ao 1:1 antigo, mas o payload da listagem não sinaliza "degradada"

- **Severidade**: P3
- **Tactic violada**: Defer Binding (feature flag implícita sem contrato)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1095-1134, 1170-1180`
- **Evidência (objetiva)**:
  ```
  marcas === undefined → gruposSugeridos = [] → listagem some com a sugestão de grupo
  mas o cliente não recebe nenhuma flag "sugestao_grupo_degradada"
  ```
- **Impacto técnico**: a próxima emenda que condicionar UI à degradação (ex.: faixa amarela "sugestão de grupo offline") precisará reemitir dado que já foi perdido no caminho.
- **Impacto de negócio**: silêncio parcial em incidente — a analista não vê que "não há grupo sugerido hoje" é por falha, e não por ausência de candidato.
- **Métrica de baseline**: 1 branch de degradação sem contrato visível no payload (`ListagemSugestoes`).

## 5. Cards Kanban

### [modifiability-1] Fatiar `BoletoSuggestionService` em agregador + extratores de cenário

- **Problema**
  > `BoletoSuggestionService` chegou a 1477 LOC e 41 imports; concentra sincronização, cache, confirmação, ancoragem DPS e agora grupo sugerido. Cada feature SISPAG volta aqui.
- **Melhoria Proposta**
  > Aplicar **Split Module** extraindo o leitor-de-cenário (`sugerirAgora` + `calcularCenario` + dependências de repositório) para um `SugestaoCenarioLoader` injetável; manter em `BoletoSuggestionService` só o contrato público (`listar`, `confirmar`, `anular`, `reconhecer`). Mover `marcasOuNenhuma`, `dpsLidosOuNenhum`, `numerosOuDesligado` para o loader.
- **Resultado Esperado**
  > `BoletoSuggestionService.ts` < 900 LOC; novo `SugestaoCenarioLoader.ts` ~400 LOC; nenhuma mudança de contrato externo.
- **Tactic alvo**: Split Module
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC `BoletoSuggestionService.ts`: 1477 → < 900
  - Injeções no construtor: 17 → ≤ 10
- **Risco de não fazer**: em 2 features o arquivo passa de 1700 LOC e vira *bus factor* do Yuri.
- **Dependências**: nenhuma; feito em `/feature-tweak` dedicado.

### [modifiability-2] Mover a reconciliação grupo-vs-1:1 para fora do `MotorSugestaoBoleto`

- **Problema**
  > `aplicarGrupoSugerido` / `marcarGrupoSugerido` / `sugestoesValidas` colocam o conhecimento do motor de grupos dentro do motor 1:1. O arquivo cresceu de 1243 → 1374 e passou a ter duas responsabilidades.
- **Melhoria Proposta**
  > Aplicar **Increase Semantic Coherence**: criar `ReconciliadorGrupoE1a1` (puro) que recebe `{sugestoes, desfechos, gruposSugeridos}` do motor 1:1 e devolve a versão marcada. `MotorSugestaoBoleto` volta a desconhecer `GrupoSugeridoRef` fora do shape de entrada; o reconciliador tem seu próprio arquivo e teste.
- **Resultado Esperado**
  > `MotorSugestaoBoleto.ts` < 1200 LOC; reconciliador < 200 LOC e testável sem *fixtures* 1:1.
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC `MotorSugestaoBoleto.ts`: 1374 → < 1200
  - Métodos privados sobre `gruposSugeridos` no motor 1:1: 3 → 0
- **Risco de não fazer**: próxima regra de interação grupo×1:1 engorda o motor 1:1 inevitavelmente.

### [modifiability-3] Explicitar a regra "sugestão de grupo não rouba 1:1 forte alheio"

- **Problema**
  > `sugestoesValidas` reusa `this.avaliar` + `FORCA` para decidir. A regra I21v fica dependente de internals do avaliador 1:1 e invisível quando se procura "por que o grupo sumiu".
- **Melhoria Proposta**
  > **Encapsulate**: expor um predicado explícito `rouba1a1Forte(boleto, titulosForaDoGrupo, pares)` em `RegraSugestaoBoleto` (ou análogo) com teste nomeado; `sugestoesValidas` chama o predicado. Logar com `LOG_TYPE.BUSINESS_WARN` o grupo descartado com motivo "colidiria com 1:1 forte alheio".
- **Resultado Esperado**
  > Grep por "rouba 1:1 forte" encontra 1 função, 1 teste, 1 log — o incidente futuro resolve em minutos.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Teste nomeado presente: 0 → 1
  - Log de grupo descartado por colisão: ausente → emitido

### [modifiability-4] Centralizar o mapa de estados `SituacaoSugestaoTitulo`

- **Problema**
  > Adicionar `GRUPO_SUGERIDO` custou 6 edições paralelas (2 BE, 4 FE). Nenhum teste força cobertura exaustiva dos mapas (`ROTULO_SITUACAO`, `TOM_SITUACAO`, `SITUACAO_SEM_PAINEL`, `rotulos.ts`).
- **Melhoria Proposta**
  > **Abstract Common Services**: tipar `ROTULO_SITUACAO` e `TOM_SITUACAO` com `Record<SituacaoSugestaoTitulo, …>` (TypeScript já pede exhaustive) e adicionar teste `expect(Object.keys(ROTULO_SITUACAO)).toEqual(SITUACOES_SUGESTAO_TITULO)` em `sugestaoBoleto.test.ts`.
- **Resultado Esperado**
  > Adicionar um estado novo passa de 6 edições para 4; esquecer `TOM_SITUACAO` quebra `npm run typecheck`.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Teste de exaustividade: 0 → 1
  - Tempo médio de adicionar estado (observacional): 2 h → 30 min

### [modifiability-5] Expor flag `sugestaoGrupoDegradada` no payload da listagem

- **Problema**
  > Quando a leitura de `BloqueioDuplicidadeRepository.listAtivos` falha, a listagem volta ao 1:1 antigo sem avisar o cliente; a tela não distingue "não há grupo hoje" de "fallback silencioso".
- **Melhoria Proposta**
  > **Defer Binding** com contrato: incluir `sugestaoGrupoDegradada?: true` em `ListagemSugestoes`, setado quando `marcasOuNenhuma` retornar `undefined`. FE pinta uma faixa amarela discreta no painel.
- **Resultado Esperado**
  > Incidente futuro: analista vê imediatamente que a sugestão de grupo está off; não liga para o Yuri.
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Branch de degradação observável no payload: 0 → 1

## 6. Notas do agente

- Escopo restrito ao delta (base = `adfaf786`, v0.78.0). Não revisei o legado SISPAG além do que o delta tocou.
- Pontos positivos do delta: `CenarioGrupoBoleto` é um **Abstract Common Services** aplicado no primeiro re-uso (textbook), reduz `GrupoBoletoService` em 17 LOC e padroniza a entrada do `MotorGrupoBoleto`. O fallback `marcasOuNenhuma` segue o padrão `dpsLidosOuNenhum` existente — defer-binding consistente.
- Nenhum **P0** encontrado — não há defeito funcional concreto nesta mudança; os riscos são de erosão arquitetural (dois seams grandes continuam crescendo).
- Cross-QA:
  - F-modifiability-1 e [modifiability-1] sobrepõem com **Testability** (arquivo de 1477 LOC já paga tempo em `BoletoSuggestionService.test.ts`).
  - F-modifiability-2/3 sobrepõem com **Performance** — `sugestoesValidas` é O(|elegiveis|·|gruposSugeridos|) sem cache (hoje negligenciável, no horizonte não).
  - F-modifiability-5 sobrepõe com **Observability/Availability** — degradação silenciosa é falso-OK.
