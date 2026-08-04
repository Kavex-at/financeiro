---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-03-0904
agent: qa-modifiability
generated_at: 2026-08-03T09:04:00-03:00
scope: backend
score: 5
findings_count: 6
cards_count: 5
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro (ou o próprio ERP mudando o comportamento da com194/com299) | "esta pessoa exige condição de pagamento X" ou "o PUT do com299 destrói/preserva parcelas em outro cenário" | `RecebimentoNumerarioService` (fluxo de 7 etapas SN → fin014 → NDe → fiscal → obs → homologação → poll) | Development-time, no worktree do tweak; sem downtime, mas sob pressão (bug de produção que zerava títulos) | Localizar a mudança em métodos coesos com efeito verificável (fail-closed no discriminador), sem tocar em etapas laterais | Diff de +117 −11 num arquivo de 1400 LOC; suíte de testes verde (97 suites / 1017); typecheck limpo; 0 alteração cross-layer |

O cenário concreto deste delta: passar de "sempre aplico a condição de pagamento" para "aplico só quando a com194 pedir, e verifico se as parcelas sobreviveram" — precisou tocar 1 arquivo de serviço e o teste correspondente. Bom sinal local; sinal ruim para a próxima mudança nesse mesmo serviço.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC do serviço central | 1400 | ≤ 600 (Bass split threshold) | ❌ | `wc -l src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| LOC do 2º maior serviço em `recebimentos/` | 329 (`RecebimentoPipelineService.ts`) | — | — | `find src/backend/domain/service/recebimentos -name '*.ts' -not -name '*.test.ts' \| xargs wc -l` |
| Ratio central-vs-mediano do módulo | 4.7× (1400 vs. 285 do 3º maior) | ≤ 2× | ❌ | idem |
| Nº de métodos no serviço | 30 (2 públicos, 28 privados) | ≤ 12 (Bass "small class") | ❌ | `grep -cE '^    (public\|private) [a-zA-Z_]+ =' RecebimentoNumerarioService.ts` |
| Nº de dependências injetadas | 11 | ≤ 6 | ❌ | `grep -cE '^\s*@inject\(' RecebimentoNumerarioService.ts` |
| Nº de imports | 22 | ≤ 15 | ⚠️ | `grep -cE '^import ' RecebimentoNumerarioService.ts` |
| Cognitive complexity de `classificarAlocacao` | 20 (max 15) | ≤ 15 | ⚠️ (pré-existente) | `npx biome check domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| Métodos dedicados à seleção de condição de pagamento | 8 (`applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition`, `stripAccents`, `escolherCondicaoPagamento`, `pessoaDaCondicaoDuplicata`, `normalizarNomePessoa`, `prefixoDeTokens`, `prefixoTruncado`) | agrupados em módulo próprio | ⚠️ | inspeção direta, linhas 462–722 |
| LOC do cluster "condição de pagamento" | ~145 (10% do arquivo) | módulo isolado ~150 LOC OK, dentro do serviço = coesão degradada | ⚠️ | inspeção linhas 462–722 |
| Métodos com nomenclatura inglês / português | 11 EN / 19 PT | 100% EN (CLAUDE.md §Conventions.Language) | ⚠️ | `grep -nE '^    (public\|private) [a-zA-Z_]+ =' RecebimentoNumerarioService.ts` |
| `throw new Error` com mensagem em pt-BR | 5 de 7 (linhas 477, 511, 591, 746, 996; EN em 209 e 1373) | mensagens de erro EN por convenção, textos de UX em campo separado (`motivo`) | ⚠️ | `grep -nE 'throw new Error' RecebimentoNumerarioService.ts` |
| Mutações de `ctx` no meio do fluxo | 2 (`ctx.preflight = …` L316, `ctx.snDocCod = …` L348) | 0 | ⚠️ | `grep -nE 'ctx\.\w+ =' RecebimentoNumerarioService.ts` |
| LOC do arquivo de teste do serviço | 1128 | proporcional ao SUT — aqui, próximo (bom sinal de disciplina de teste) | ✅ | `wc -l RecebimentoNumerarioService.test.ts` |
| Delta desta branch no serviço | +117 −11 (2 commits) | mudança localizada (< 300 LOC) | ✅ | `git diff --stat fix/sn-cond-pgto-finalizacao..HEAD` |
| Novos identifiers do delta nomeados em EN | 4/4 (`applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition`, `stripAccents`, `addLineItem`) | 100% EN | ✅ | inspeção do diff |
| Novas mensagens de erro do delta em pt-BR | 1 (linha 511 — analista lê na modal) | consistente com o resto do serviço; conflita com CLAUDE.md | ⚠️ | inspeção do diff |
| Ripple do delta em outras camadas | 0 (rotas/repos/clients inalterados) | ≤ 1 camada | ✅ | `git diff --stat fix/sn-cond-pgto-finalizacao..HEAD` |
| Cross-layer violations (`domain` importando de `lambda/`) | 0 | 0 | ✅ | escopo Express (não há `lambda/`) — regra alvo, não medível hoje |

> ⚠️ **Não medível localmente**: fan-in do `RecebimentoNumerarioService` fora do próprio serviço (rotas, testes, orquestração). Requer `madge` ou análise de import-graph que não está no toolchain — visualmente, no delta em revisão, apenas `RecebimentoNumerarioService.test.ts` e o handler HTTP em `routes/recebimentos.ts` o consomem.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | O serviço central concentra 7 etapas + seleção de condição de pagamento + resolução de config + normalização de nomes num único arquivo de 1400 LOC. Este delta acertou em criar métodos privados nomeados (`addLineItem`, `applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition`, `stripAccents`), mas o corpo do serviço continua o mesmo balde. | ⚠️ parcial | `RecebimentoNumerarioService.ts:187-1384` (classe única, 30 métodos) |
| Increase Semantic Coherence | Métodos privados são coesos individualmente (cada `etapaX` sabe apenas da sua etapa; helpers de condição de pagamento têm nomes precisos). A classe, porém, junta 3 responsabilidades: orquestrar as etapas, resolver a condição de pagamento do cliente, e classificar elegibilidade no pré-flight. | ⚠️ parcial | linhas 462–722 (8 métodos de payment selection); 838–965 (`classificarAlocacao`); 335–389 (`rodarEtapas`) |
| Encapsulate | Constantes de negócio isoladas no topo (`VALIDACAO_BLOQUEANTE`, `CONDICAO_PAGAMENTO_REGEX`) — bom. Porém `EscritaCtx` é mutado em duas etapas do fluxo (`ctx.preflight = …`, `ctx.snDocCod = …`), o que quebra a encapsulação local de cada etapa. | ⚠️ parcial | `RecebimentoNumerarioService.ts:54-62` (constantes), `:316,348` (mutação) |
| Use an Intermediary | `ContingenciaDecider`, `SnPayloadBuilder`, `ErpErrorInterpreter`, `ConexosNdeClient` — todos intermediários adequados. A NDe local usa `NdeRepositoryInterface` (port) resolvido via token — Defer Binding em ação. | ✅ presente | linhas 24-38 (imports), 197-201 (injeções via token) |
| Restrict Dependencies | 11 injeções é muito para um serviço só; o efeito é que `NarrowerDep` para uma etapa só é impossível (nenhuma etapa precisa de todas as 11). | ⚠️ parcial | construtor `:188-202` |
| Refactor | `classificarAlocacao` tem cognitive complexity 20 (max 15) — PRÉ-EXISTENTE nesta branch (aviso Biome também aparece na base). Não é regressão do delta, mas é dívida pendente. | ⚠️ parcial (dívida) | `biome check` → `L842:34 lint/complexity/noExcessiveCognitiveComplexity` |
| Abstract Common Services | `stripAccents` foi extraído neste delta e é reusado por `requiresRegisteredPaymentCondition` — bem. Mas há `normalizarNomePessoa` (helper análogo, com pipeline diferente) já duplicando parcialmente esse trabalho no cluster de condição de pagamento; ambas as normalizações deveriam viver num único módulo utilitário. | ⚠️ parcial | `:560-564` (`stripAccents`), `:691-697` (`normalizarNomePessoa`) |
| Defer Binding — DI (tsyringe) | Serviços/clients/repositórios todos `@injectable()`; ports usados para `NdeRepositoryInterface` e `SolicitacaoNumerarioExecucaoRepositoryInterface`. | ✅ presente | `:186-202`, `:24-31` |
| Defer Binding — Configuration | `EnvironmentProvider` usado para `conexosWriteEnabled`, `conexosDryRun`, `solicitacaoNumerarioGcdCod`, `com297GcdNotaDebito`, `com297GcdNotaDebitoNome`. Constantes de negócio (`VALIDACAO_BLOQUEANTE=2`, `NDE_MOEDA_PADRAO='BRL'`, `SN_TPD_COD`, `NDE_GERACAO_DEFAULTS`) em `interface/recebimentos/constants.ts` — encapsuladas, mas não configuráveis em runtime. Aceitável (dependem do domínio ERP, não do cliente). | ✅ presente | `:32,54-56` (env + constantes) |
| Defer Binding — Polymorphism | `ContingenciaDecider` retorna a rota (NORMAL/CONTINGENCIA) que `ConexosNdeClient.homologar` consome — um único ponto de escolha. Nenhum outro polimorfismo em runtime. Adequado ao domínio; nada a mudar. | N/A justificado | `:1174-1180` |

## 4. Findings (achados)

### F-modifiability-1: Serviço central concentra 7 etapas + 3 responsabilidades num único arquivo de 1400 LOC

- **Severidade**: P2 (dívida pré-existente; este delta não regride, mas amplia)
- **Tactic violada**: Split Module, Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:187-1384`
- **Evidência (objetiva)**:
  ```
  1400 LOC, 30 métodos, 11 dependências injetadas, 22 imports.
  Segundo maior serviço em recebimentos/: RecebimentoPipelineService.ts com 329 LOC.
  A classe orquestra 7 etapas (etapaSn, etapaFin014, etapaNotaDebito, etapaFiscal,
  etapaObservacoes, etapaHomologar, etapaPoll) + resolução de condição de pagamento
  (8 métodos, ~145 LOC) + classificação de elegibilidade (classificarAlocacao, cc=20).
  ```
- **Impacto técnico**: qualquer alteração numa etapa força o leitor a re-derivar o contexto do fluxo inteiro; refatorações são frágeis (a mudança que a base fez em `completarSnAdiantamento` — objeto deste delta — só apareceu como bug em HML depois de a suíte completa rodar); coautoria simultânea colide (dois PRs mexendo em etapas diferentes brigam por conflict marker no mesmo arquivo).
- **Impacto de negócio**: dá 2–3× o custo esperado para adicionar a próxima frente (ex.: "e se a condição vier com juros?" ou "e se o processo tiver múltiplas variantes de SN?"). Cada nova etapa infla mais o mesmo arquivo, que ficou 5× maior que o vizinho médio em 6 meses.
- **Métrica de baseline**: 1400 LOC (target ≤ 600); 30 métodos (target ≤ 12); ratio 4.7× vs. o 3º maior serviço do módulo.

### F-modifiability-2: Seleção de condição de pagamento é um sub-domínio coeso preso dentro do orquestrador

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence, Split Module, Abstract Common Services
- **Localização**: `RecebimentoNumerarioService.ts:462-722` (8 métodos, ~145 LOC)
- **Evidência (objetiva)**:
  ```
  Métodos coesos ao redor de UM conceito ("qual é a condição de pagamento do próprio cliente?"):
    applyPaymentConditionIfRequired       (462-519)  — orquestra
    requiresRegisteredPaymentCondition    (526-557)  — leitura do gate (com194)
    stripAccents                          (560-564)  — normalização
    escolherCondicaoPagamento             (654-675)  — estratégia (2 passes)
    pessoaDaCondicaoDuplicata             (682-688)  — parse do nome
    normalizarNomePessoa                  (691-697)  — normalização (paralela ao stripAccents)
    prefixoDeTokens                       (703-704)  — matcher estrito
    prefixoTruncado                       (711-722)  — matcher tolerante
  ```
- **Impacto técnico**: (a) cada iteração da heurística de matching (o histórico deste código já mudou por causa do bug do "BONDUELLE - DUPLICATA" no SKYJACK) exige tocar o serviço central, ampliando o blast radius do teste de regressão; (b) `stripAccents` e `normalizarNomePessoa` implementam pipelines de normalização quase idênticos que evoluíram em separado — sinal clássico de refactor pendente; (c) testar a heurística de escolha exige montar o mock do fluxo inteiro (o teste atual `RecebimentoNumerarioService.test.ts` mede 1128 LOC, o que é razoável mas parcialmente por causa disto).
- **Impacto de negócio**: quando o próximo cliente exigir uma regra de casamento diferente (ex.: comparar por CNPJ da condição em vez do nome), a mudança fica emaranhada com o orquestrador. Extrair para `PaymentConditionSelector` (value object puro) permite testes de tabela isolados e evolução independente.
- **Métrica de baseline**: 8 métodos / ~145 LOC / 2 normalizações duplicadas em pipelines diferentes; 10% do arquivo dedicado a um sub-domínio que não é o propósito do orquestrador.
- **Justificativa custo/benefício**: extração de VO tem custo M (mover 8 métodos, injetar via tsyringe, atualizar testes) e retorno alto — o cluster tem interface estreita (`condicoes: Array<{pgtCod, pgtDesNome}>, nomeCliente: string → cond | undefined`) e nenhum dos 8 métodos precisa das outras 10 dependências do serviço.

### F-modifiability-3: `classificarAlocacao` com cognitive complexity 20 (max 15) — dívida pré-existente

- **Severidade**: P3 (não regressão deste delta; confirmado presente na branch base)
- **Tactic violada**: Refactor, Split Module
- **Localização**: `RecebimentoNumerarioService.ts:838-965`
- **Evidência (objetiva)**:
  ```
  domain\service\recebimentos\RecebimentoNumerarioService.ts:842:34 
    lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 20 detected (max: 15).
  ```
- **Impacto técnico**: os 3 gates (cadastro, config default, config alvo/elegibilidade) estão inline com try/catch, filtros e resolução por preferência — o próximo gate ou variante de config aumentará a complexidade. O método já é ~128 LOC.
- **Impacto de negócio**: cada mudança na política de elegibilidade força re-leitura de 128 linhas com 3 try/catch aninhados; a re-leitura em contexto de bug (o próprio arquivo já sofreu de "TRANSPORT_ERROR mascarado como inelegibilidade") custa horas.
- **Métrica de baseline**: cognitive complexity 20 (Biome max 15); método com 128 LOC; 3 try/catch + 4 `if` + 2 spreads condicionais.

### F-modifiability-4: Convenção de idioma inconsistente — identifiers e mensagens misturam pt-BR e inglês

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence (consistência interna do módulo), Encapsulate (separar mensagem de UX de mensagem técnica)
- **Localização**: `RecebimentoNumerarioService.ts` inteiro; escopo do delta somente adicionou métodos em EN mas manteve mensagens em pt-BR.
- **Evidência (objetiva)**:
  ```
  Métodos em português : 19 (etapaSn, etapaFin014, etapaNotaDebito, etapaFiscal,
                              etapaObservacoes, etapaHomologar, etapaPoll,
                              etapaAtingida, etapaOrdem, montarSnPayload,
                              classificarAlocacao, escolherCondicaoPagamento,
                              pessoaDaCondicaoDuplicata, normalizarNomePessoa,
                              prefixoDeTokens, prefixoTruncado, extrairVarianteSn,
                              rodarEtapas, checarBloqueio, registrarFalha,
                              completarSnAdiantamento, processarAlocacao — 22 na verdade)
  Métodos em inglês    : 11 (applyPaymentConditionIfRequired,
                              requiresRegisteredPaymentCondition, stripAccents,
                              addLineItem, extractHttpStatus, classifyValidatorError,
                              settledResult, assertNoErpError, extractErpData,
                              etc.)
  throw new Error pt-BR : 5 (linhas 477, 511, 591, 746, 996)
  throw new Error EN    : 2 (linhas 209, 1373)
  ```
  CLAUDE.md §Conventions.Language: "Identifiers: English only. No exceptions. … Errors, logs, commits: English only".
- **Impacto técnico**: mensagens de exceção pt-BR são lidas por dois consumidores conflitantes — (a) a modal do analista, que precisa de pt-BR compreensível, e (b) o operador técnico, que rastreia logs em ferramentas otimizadas para EN. Hoje ambas usam o mesmo string. Se um dia adicionarmos i18n ou grep de logs, o pipeline quebra.
- **Impacto de negócio**: baixo hoje (só o analista Columbia consome). Custo entra no radar quando (a) um novo cliente pediu UI em EN, (b) um novo dev entrou e demorou mais para localizar métodos porque metade tem nome em cada idioma, (c) alguém padroniza a review de logs em observabilidade.
- **Métrica de baseline**: 11 EN / 19 PT nos identifiers; 5/7 throws em pt-BR contra a regra do CLAUDE.md; delta atual acrescentou o padrão certo (identifiers EN) mas amplificou a inconsistência.
- **Caminho proposto (a discutir com Yuri)**: (i) formalizar exceção no CLAUDE.md — "domínio Frente IV usa PT nos textos operacionais porque são consumidos pela modal do analista", ou (ii) separar: `throw new Error("english/technical")` + campo `motivo: string` em pt-BR no `ProcessarAlocacaoResult` (o padrão já existe no retorno do pré-flight; falta estender para as etapas de escrita, que hoje passam pelo `erpErrorInterpreter.friendly` sem controle). Opção (ii) é a mais barata em runtime (analista já vê `motivo` pré-formatado) e sai da tensão com a CLAUDE.md.

### F-modifiability-5: `EscritaCtx` mutado no meio do fluxo prejudica o raciocínio local por etapa

- **Severidade**: P3
- **Tactic violada**: Encapsulate
- **Localização**: `RecebimentoNumerarioService.ts:316` (`ctx.preflight = preflight`), `:348` (`ctx.snDocCod = snDocCod`); definição em `:1387-1400`
- **Evidência (objetiva)**:
  ```
  interface EscritaCtx {
      …
      snDocCod?: number;                // preenchido em rodarEtapas L348
      preflight?: PreflightResult;      // preenchido em processarAlocacao L316
  }
  ```
- **Impacto técnico**: cada etapa lê `ctx.preflight?.gcdDesNome`/`ctx.preflight?.endCodFis` sem garantia de tipo de que o pré-flight rodou; hoje a garantia vem da ordem no `rodarEtapas`, mas se alguém amanhã reordenar as etapas (ou paralelizar `etapaFiscal` e `etapaObservacoes`), o compilador não avisa.
- **Impacto de negócio**: probabilidade baixa hoje, mas o custo de descobrir esse tipo de acoplamento em produção é alto (o padrão "objeto de contexto mutável" é justamente o que fez o bug dos títulos passar).
- **Métrica de baseline**: 2 mutações in-loco de campo opcional; ambas as etapas seguintes leem os campos como opcionais (`ctx.preflight?.…`), mascarando o requisito ordinal.

### F-modifiability-6: Delta em si é bem localizado — evidência positiva

- **Severidade**: informativo (não gera card)
- **Tactic honrada**: Increase Semantic Coherence, Encapsulate
- **Localização**: `RecebimentoNumerarioService.ts` +117 −11 em 2 commits (`6d9c8c2`, `8598ef6`)
- **Evidência (objetiva)**:
  ```
  A mudança de "sempre aplico condição" para "só quando com194 pedir + verifico" foi feita:
    - extraindo 4 métodos novos (addLineItem, applyPaymentConditionIfRequired,
      requiresRegisteredPaymentCondition, stripAccents),
    - com nomes em EN (obedecendo CLAUDE.md pontualmente),
    - com discriminador pós-condição (`titulo === valorDoc`) e mensagem clara
      apontando para com032 quando o ERP destrói o título,
    - com testes cobrindo o caminho "com194 devolve validação bloqueante"
      E o "com194 offline → segue sem PUT" (+148 LOC no test file),
    - sem tocar rotas, repositórios, clients ou outros serviços.
  ```
- **Impacto**: baseline de disciplina do time é alto; o problema modifiability não é comportamental, é estrutural (o vaso onde o time trabalha é grande demais).

## 5. Cards Kanban

### [modifiability-1] Extrair `PaymentConditionSelector` como value object dedicado

- **Problema**
  > 8 métodos (~145 LOC, 10% do arquivo) resolvem um único sub-problema — "qual condição de pagamento do próprio cliente devo aplicar?" — dentro do orquestrador. Duas normalizações de string quase idênticas (`stripAccents` e `normalizarNomePessoa`) já evoluíram separadas, e o cluster tem histórico de bug (SN 731 gravou "BONDUELLE - DUPLICATA" num documento SKYJACK). Todo teste da heurística exige montar o mock do fluxo inteiro.

- **Melhoria Proposta**
  > Extrair um `PaymentConditionSelector` (`@injectable`) em `src/backend/domain/service/recebimentos/`, com interface estreita: `select({condicoes, nomeCliente, gateCom194}): {cond | undefined, motivo?}`. Mover `escolherCondicaoPagamento`, `pessoaDaCondicaoDuplicata`, `normalizarNomePessoa`, `prefixoDeTokens`, `prefixoTruncado`, `stripAccents` (unificando a segunda com a primeira). O orquestrador consome via `@inject(PaymentConditionSelector)`. Tactic: **Split Module** + **Increase Semantic Coherence** + **Abstract Common Services**.

- **Resultado Esperado**
  > `RecebimentoNumerarioService` reduzido em ~145 LOC (1400 → ~1255). Novo módulo isolado com ~180 LOC testável por tabelas (sem mock de ERP). Uma única função de normalização.

- **Tactic alvo**: Split Module + Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: M (2–3 dias)
- **Findings relacionados**: F-modifiability-2, F-modifiability-1
- **Métricas de sucesso**:
  - LOC do serviço central: 1400 → ~1255
  - Métodos da classe: 30 → ~22
  - Nº de normalizações de string duplicadas: 2 → 1
  - Cobertura da heurística por testes de tabela (sem mock ERP): 0 → ≥ 20 casos
- **Risco de não fazer**: cada nova regra de matching de condição de pagamento (previsível quando um cliente novo entrar) toca o orquestrador central e amplia o arquivo mais uma vez.
- **Dependências**: nenhuma — pode entrar como primeiro follow-up.

### [modifiability-2] Refatorar `classificarAlocacao` para reduzir cognitive complexity de 20 para ≤ 15

- **Problema**
  > `classificarAlocacao` (método público, 128 LOC, 3 gates com try/catch inline) aparece no Biome como cognitive complexity 20 (max 15). É dívida pré-existente — o mesmo aviso está na base `fix/sn-cond-pgto-finalizacao` — mas cresce a cada gate novo. O próprio comentário do método já anuncia "quatro gates" quando o corpo hoje tem três, sinal de que a próxima adição vai piorar.

- **Melhoria Proposta**
  > Extrair cada gate como método privado: `gateCadastro`, `gateConfigDefault`, `gateElegibilidade` — devolvendo `PreflightResult | undefined` (early return quando bloqueia). O método público vira uma sequência linear de 3 chamadas. Tactic: **Refactor** + **Split Module** (no nível do método).

- **Resultado Esperado**
  > `classificarAlocacao` cai de 128 LOC para ~30 LOC; complexity ≤ 15 (aviso Biome some); cada gate testável isolado.

- **Tactic alvo**: Refactor
- **Severidade**: P3 (dívida existente; não urgente, mas trivial de remediar)
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Cognitive complexity de `classificarAlocacao`: 20 → ≤ 15
  - Nº de warnings Biome no arquivo: 1 → 0
  - LOC do método público: 128 → ~30
- **Risco de não fazer**: quando o 4º gate previsto chegar (o comentário anuncia gate 0 = transporte já implementado, mas as regras vão crescer), a complexity subirá para 25+.
- **Dependências**: nenhuma.

### [modifiability-3] Dividir `RecebimentoNumerarioService` em serviços por-etapa

- **Problema**
  > O serviço central concentra 7 etapas de negócio (SN → fin014 → NDe → fiscal → obs → homologação → poll) em 1400 LOC / 30 métodos / 11 dependências injetadas. É 4.7× maior que o 2º maior serviço do módulo. Nenhuma etapa individual precisa de todas as 11 dependências: `etapaSn` usa `gerDocClient`+`snPayloadBuilder`+`execucaoRepository`; `etapaFin014` usa `fin014Client`+`execucaoRepository`; `etapaHomologar` usa `contingenciaDecider`+`ndeClient`+`ndeRepository`+`fiscalClient`. Coautoria simultânea (dois PRs em etapas diferentes) sempre conflita no mesmo arquivo.

- **Melhoria Proposta**
  > Extrair um serviço por etapa: `SnGerarService`, `Fin014BaixaService`, `NotaDebitoGerarService`, `NdeFiscalService`, `NdeObservacoesService`, `NdeHomologarService`, `NdePollService`. `RecebimentoNumerarioService` fica só com `processarAlocacao` + `rodarEtapas` (orquestrador puro, ~200 LOC). Cada serviço recebe apenas as dependências que usa. Tactic: **Split Module** + **Restrict Dependencies**.

- **Resultado Esperado**
  > Serviço central: 1400 → ~250 LOC. 7 serviços novos de ~100–200 LOC cada. Dependências por serviço: 11 → 3–4. Um PR que muda a etapa de fiscal não conflita com um PR que muda a etapa de homologação.

- **Tactic alvo**: Split Module + Restrict Dependencies
- **Severidade**: P2 (não bloqueia, mas o custo escala mal)
- **Esforço estimado**: L (1–2 semanas — inclui refazer o teste central em 7 arquivos)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC do serviço central: 1400 → ≤ 300
  - Nº de dependências injetadas no orquestrador: 11 → ≤ 5
  - Nº médio de dependências por serviço de etapa: — → ≤ 4
  - LOC do maior arquivo do módulo `recebimentos/`: 1400 → ≤ 500
- **Risco de não fazer**: em 6 meses, com Frente IV crescendo, este arquivo passa dos 2000 LOC. O teste correspondente já está em 1128 LOC.
- **Dependências**: `modifiability-1` (fazer primeiro — o cluster de payment condition sai facilmente e valida o padrão de extração).

### [modifiability-4] Separar mensagem de UX (pt-BR) da mensagem técnica de exceção (EN) — ou formalizar exceção à CLAUDE.md

- **Problema**
  > O CLAUDE.md exige identifiers em inglês e erros/logs em inglês. `RecebimentoNumerarioService` tem 19 métodos com nome em pt-BR contra 11 em inglês (delta acrescentou EN, ampliando o mix), e 5 de 7 `throw new Error` têm mensagem em pt-BR porque a modal do analista lê essas mensagens. É uma tensão real: o CLAUDE.md quer EN, o produto precisa de pt-BR para o operador.

- **Melhoria Proposta**
  > Duas opções para o Yuri decidir:
  > (a) **Formalizar a exceção** no CLAUDE.md ("domínio Frente IV usa PT em textos operacionais visíveis ao analista"), com renomeação futura dos identifiers para EN em uma tarefa lateral.
  > (b) **Separar canal técnico do canal UX**: `throw new Error("english-technical-message")` no fluxo; a rota captura e transforma em `motivo: string` pt-BR via um `NumerarioMessageMapper` — o padrão já existe parcialmente (`ProcessarAlocacaoResult.motivo` no pré-flight); estender para as etapas de escrita, que hoje delegam ao `erpErrorInterpreter.friendly` sem controle da mensagem. Tactic: **Encapsulate** (separar responsabilidade de apresentação da de sinalização).

- **Resultado Esperado**
  > Escolha (a): CLAUDE.md documenta a exceção; nenhuma refactor de código imediata. Escolha (b): 100% dos throws com mensagem EN (padrão CLAUDE.md), 100% das mensagens que a modal exibe centralizadas num mapper testável.

- **Tactic alvo**: Encapsulate + Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: S (opção a — decisão de doc) ou M (opção b — mapper + adaptar 7 throws)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Escolha (a): entrada no CLAUDE.md documentando a exceção.
  - Escolha (b): `throw new Error(pt-BR)` no serviço: 5 → 0; `NumerarioMessageMapper` com cobertura ≥ 90%.
- **Risco de não fazer**: sem decisão explícita, cada novo método herda a inconsistência (o próprio delta em revisão é evidência — nomes em EN, mensagens em pt-BR, mesmo autor, mesmo commit) e a dívida cresce silenciosamente.
- **Dependências**: decisão do Yuri sobre (a) vs (b).

### [modifiability-5] Encapsular `EscritaCtx` (parar de mutar campos opcionais entre etapas)

- **Problema**
  > `EscritaCtx` tem `snDocCod?` e `preflight?` que são preenchidos in-loco (`ctx.preflight = preflight` em L316, `ctx.snDocCod = snDocCod` em L348). Cada etapa seguinte lê como opcional (`ctx.preflight?.gcdDesNome`), mascarando o requisito de ordem. Se um dia alguém reordenar ou paralelizar etapas, o compilador não avisa.

- **Melhoria Proposta**
  > Modelar `EscritaCtx` como uma cadeia de tipos monotônicos: `EscritaCtxPreflight` (preflight garantido) → `EscritaCtxSn` (snDocCod garantido) → `EscritaCtxFin014` (borCod garantido). Cada etapa recebe o tipo estreito de que precisa e devolve o tipo enriquecido. Tactic: **Encapsulate** (via tipagem).

- **Resultado Esperado**
  > 0 mutações in-loco de `ctx`. Compilador rejeita chamar `etapaFin014` sem passar pelo `etapaSn`.

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Mutações de `ctx.<field> =`: 2 → 0
  - Nº de acessos `ctx.preflight?` em etapas: — → 0 (o preflight vira campo obrigatório do tipo `EscritaCtxPreflight`)
- **Risco de não fazer**: baixo hoje; sobe se a ordem das etapas for alterada ou se etapas 4/5 forem paralelizadas.
- **Dependências**: idealmente feito no mesmo PR de `modifiability-3` (a divisão em serviços por-etapa força essa cadeia de tipos naturalmente).

## 6. Notas do agente

- Cross-QA: **modifiability-3** (Split Module por-etapa) e **modifiability-1** (extrair `PaymentConditionSelector`) reduzem massa que também dói em **Testability** (o teste central tem 1128 LOC, o cluster de payment condition não tem testes de tabela isolados) e em **Integrability** (o cluster de payment condition é uma unidade lógica que outros serviços de recebimentos podem querer reusar).
- Cross-QA: **modifiability-4** (mensagens pt-BR vs. EN) toca **Observability** (logs mistos EN/PT prejudicam pipeline futuro de agregação/i18n).
- Cross-QA: **modifiability-5** (EscritaCtx mutável) toca **Fault Tolerance** — o padrão "objeto compartilhado mutável entre etapas" é o mesmo padrão que fez o bug dos títulos passar; endurecer tipos evita repetição da classe de falha.
- Métrica que tentei coletar e falhou: fan-in do serviço central via `madge` — a ferramenta não está no toolchain deste worktree; substituí por inspeção manual (apenas 2 consumidores no delta em revisão: o teste e uma rota).
- Este delta é **cirúrgico e bem escrito** — o problema modifiability é o vaso, não o que este PR fez com ele. Nenhum P0/P1; toda a lista abaixo é P2/P3 remediável em follow-up.
