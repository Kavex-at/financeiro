---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-12-1315
agent: qa-modifiability
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Modifiability — Regis-Review

> Escopo restrito ao delta da branch `fix/nde-descricao-item` sobre `main`
> (2 commits, +1458/-13 LOC). Ler junto de `_shared-metrics.md`.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Fiscal Columbia (regra de negócio) | Cliente novo entra na base cujo cadastro `cmn025.dpeVld1DescrNfe = 4` (Descrição DI) faz o ERP deixar `dprLngDescrNf` vazio → NF-e recusada | `RecebimentoNumerarioService` (cauda fiscal) + `ConexosNdeFiscalClient` (contrato com297 `comDocProdutos`) | Runtime (Express/Render), execução do `processarAlocacao` | Ajuste **localizado** — nova etapa entre 3 e 4, RMW no item, sem tocar máquinas de estado, ontologia, repositórios ou callers | Delta ≤ 1 serviço + 1 client + 1 interface + 1 env; zero mudança de contrato público; retomada de execuções já quebradas sem migração |

Cenário concreto observado no delta: a extensão veio como um caso de "regra nova em regime": +2 métodos privados no orquestrador, +4 métodos no client (a mesma coleção com297 que já servia às validações), +2 interfaces (`ItemNdeResumo`/`ItemNde`), +1 env opcional. Todas as escritas fail-closed antes de irreversibilidade. **Este é o formato ideal de mudança que a arquitetura de `etapa*` foi desenhada para absorver.**

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `RecebimentoNumerarioService.ts` (pós-delta) | 1897 | ≤ 600 (soft cap Bass) | ❌ pré-existente, não regressão | `wc -l src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| LOC delta no serviço orquestrador | +120 (+6,7%) | ≤ +10% em delta cirúrgico sobre arquivo já grande | ✅ | `git diff --stat main -- src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| LOC `ConexosNdeFiscalClient.ts` (pós-delta) | 456 (+203) | ≤ 600 | ✅ | `wc -l src/backend/domain/client/ConexosNdeFiscalClient.ts` |
| Cognitive complexity dos 2 métodos novos no serviço | 5, 4 (aprox., contando branches) | ≤ 15 (Biome) | ✅ | `npm run lint` (0 warnings novas no delta; 32 pré-existentes na main) |
| Fan-out (imports) do serviço | 25 (+0) | ≤ 30 | ✅ | `grep -c "^import " src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| Fan-out (imports) do client fiscal | 6 (+0) | ≤ 15 | ✅ | `grep -c "^import " src/backend/domain/client/ConexosNdeFiscalClient.ts` |
| Superfície pública nova exposta pelo serviço | 0 (dois métodos `private`) | 0 (delta interno) | ✅ | `grep -n "^\s*public " …RecebimentoNumerarioService.ts` |
| Novos consumidores do serviço fora do arquivo | 0 | 0 (mudança encapsulada) | ✅ | `grep -rn "etapaDescricaoItem\|resolverDescricaoItem" src/backend` |
| Magic numbers/strings inline nos métodos novos | 0 (tudo em constantes: `FIS_COD_DEFAULT`, `NDE_GERACAO_DEFAULTS.produtoNome`, `DESCRICAO_IMPRESSAO_MAX`, env `NDE_DESCRICAO_ITEM_FALLBACK`) | 0 | ✅ | leitura de `RecebimentoNumerarioService.ts:1451-1541` |
| Cadeia de fallbacks — branches independentes | 4 (env → `preDescrProdutoNf` → `prdDesNome` → default) | ≤ 5 antes de exigir Strategy | ✅ | leitura de `resolverDescricaoItem` |
| Repetição do padrão RMW no client (com300 + com297) | 2 `putGenericOnce` distintos, cada um com seu Zod e seu discriminador de sucesso | ≥ 3 antes de justificar `Abstract Common Services` | ✅ ainda cedo | `grep "putGenericOnce" src/backend/domain/client/ConexosNdeFiscalClient.ts` |
| Novo env var (`NDE_DESCRICAO_ITEM_FALLBACK`) parametrizado via `EnvironmentProvider` (não `process.env` cru) | Sim | Sim (Rule #8) | ✅ | `src/backend/domain/libs/environment/model/EnvironmentVars.ts:133-142` |
| Delta com302→ledger (novas etapas monotônicas em `etapaOrdem`) | 0 (decisão explícita: idempotência pelo estado do documento) | ver Notas | ✅ documentado em ADR-0036 | `etapaOrdem` inalterado + doc-comment em `etapaDescricaoItem` |
| ADR + business-rule + ontologia acompanham o delta | ADR-0036, `entities/nota-debito-eletronica.md`, `integrations/conexos-nde-fiscal.md`, `_coverage.json`, `_index.json` | 100% quando `entity_changed` for boundary do fiscal | ✅ | `git diff --stat main -- ontology/` |
| Cobertura de teste do delta | +187 (unit service) + +356 (E2E rota) + +133 (client) + +14 (characterization) LOC de teste para +466 LOC de código não-teste | test-to-code ≥ 1:1 em regra fiscal crítica | ✅ | `_shared-metrics.md` diff |

> ⚠️ **Não medível localmente**: impacto em produção da 4ª ordem do fallback (fila `NDE_GERACAO_DEFAULTS.produtoNome`) — requer amostra real de NDes por cliente. Está coberta pela sonda `recebimentos.e2e.descricaoNfeNde.integration.test.ts` e pelo diagnóstico em `_inbox/nde-descricao-produto-nfe-diagnostico.md`.

### Apêndice A — Top-10 maiores arquivos backend (contexto, não regressão do delta)

| # | LOC | Arquivo | Tocado no delta? |
|---|---|---|---|
| 1 | 1897 | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` | ✅ +120 |
| 2 | 1197 | `src/backend/domain/client/ConexosGerDocProcessoClient.ts` | ❌ |
| 3 | 911 | `src/backend/domain/service/permutas/EleicaoPermutasService.ts` | ❌ |
| 4 | 904 | `src/backend/routes/recebimentos.ts` | ❌ |
| 5 | 838 | `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` | ❌ |
| 6 | 784 | `src/backend/routes/permutas.ts` | ❌ |
| 7 | 703 | `src/backend/domain/client/ConexosFinanceiroClient.ts` | ❌ |
| 8 | 650 | `src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts` | ❌ |
| 9 | 641 | `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts` | ❌ |
| 10 | 564 | `src/backend/domain/service/permutas/BorderoGestaoService.ts` | ❌ |

O único top-N tocado é o próprio orquestrador. Split é P1 pré-existente do domínio, herdado da main — este delta o **agrava marginalmente** (7%), não o cria (ver F-modifiability-1).

### Apêndice B — Fan-in dos métodos novos (surface de acoplamento efetivo do delta)

| Método novo | Caller(s) fora do próprio arquivo | Comentário |
|---|---|---|
| `RecebimentoNumerarioService.etapaDescricaoItem` | 0 (privado, chamado por `rodarEtapas`) | Encapsulado |
| `RecebimentoNumerarioService.resolverDescricaoItem` | 0 (privado, chamado por `etapaDescricaoItem`) | Encapsulado |
| `ConexosNdeFiscalClient.listItensNde` | 1 (`RecebimentoNumerarioService.etapaDescricaoItem`) | Contrato mínimo |
| `ConexosNdeFiscalClient.lerItemNde` | 1 (idem) | Contrato mínimo |
| `ConexosNdeFiscalClient.preDescricaoProdutoNf` | 1 (`resolverDescricaoItem`) | Best-effort documentado |
| `ConexosNdeFiscalClient.gravarDescricaoItemNde` | 1 (`etapaDescricaoItem`) | Único ponto de escrita |
| `interface ItemNdeResumo` | 2 (client + service) | Boundary, uso pareado |
| `interface ItemNde` | 1 (client interno para RMW) | Não vaza para o service |

Todos os novos elementos têm fan-in = 1 pela definição (uso pareado client↔service). **Nenhuma superfície pública nova exposta a outros módulos** — se a regra sumir amanhã, é `git revert` limpo, sem quebra em callers.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Não aplicado no delta. `RecebimentoNumerarioService` já é 1897 LOC. O delta é cirúrgico e cabe no padrão `etapa*` existente, mas o teto do arquivo continua estourado. | ⚠️ parcial (herdado) | `wc -l …RecebimentoNumerarioService.ts` |
| **Increase Semantic Coherence** | `etapaDescricaoItem` segue a mesma assinatura, o mesmo vocabulário (`ctx, existente, ndDocCod`), o mesmo helper de retomada (`etapaAtingida`) e o mesmo colaborador (`fiscalClient`) das outras 7 `etapa*`. Zero entidade nova referenciada. `resolverDescricaoItem` é puramente sobre uma coisa (descrição de impressão). | ✅ presente | `RecebimentoNumerarioService.ts:1451-1541` vs `1544-1587` |
| **Encapsulate** | Toda a mecânica do contrato com297 `comDocProdutos` (4 endpoints, chave composta, RMW, `.passthrough()` para 105 campos) vive no `ConexosNdeFiscalClient`. O service consome tipos `ItemNdeResumo` normalizados (nunca `null`), não o wire format cru. | ✅ presente | `ConexosNdeFiscalClient.ts:41-77`, `NdeFiscal.ts:39-83` |
| **Use an Intermediary** | `EnvironmentProvider` intermedeia `NDE_DESCRICAO_ITEM_FALLBACK`; nada de `process.env` no serviço. `ConexosNdeFiscalClient.base` intermedeia sessão/retry/`ensureSid`. | ✅ presente | `EnvironmentProvider.ts:178`, `EnvironmentVars.ts:133-142` |
| **Restrict Dependencies** | Nenhum novo import cruzando layers. Serviço → Client → HTTP base — cadeia DDD preservada. `ItemNde` (105 campos crus) NÃO vaza para o serviço; apenas `ItemNdeResumo` (chave + 2 campos) atravessa a fronteira. | ✅ presente | `grep "ItemNde" src/backend/domain/service/…` = 0 hits (só `ItemNdeResumo`) |
| **Refactor** | Nenhum refactor colateral pedido pelo delta (métodos novos ganham slot ao lado dos existentes; `etapaOrdem` não muda). Refactor de split fica em backlog (ver F-1). | ✅ presente (proporcional) | ausência de mudança em `etapaOrdem`, `rodarEtapas` |
| **Abstract Common Services** | RMW aparece 2x no client (com300 `finDocFiscal` e com297 `comDocProdutos`), com Zod e discriminador de sucesso próprios. Extrair `rmwPut<T>()` genérico neste ponto seria **premature abstraction** (dois usos, prosa distinta em cada, ganho ≤ 10 linhas). | ✅ presente (justificadamente adiado) | `ConexosNdeFiscalClient.ts:139` e `:399` |
| **Defer Binding (configuration)** | `NDE_DESCRICAO_ITEM_FALLBACK` é opcional e lido a cada `processarAlocacao` via `EnvironmentProvider`. Em Render/Express o binding efetivo é "restart-time"; em Lambda (alvo) será "cold-start-time" — o mesmo tier de todos os outros `NDE_*` já existentes. Proporcional ao caso (fiscal quer "OUTRO" texto → raro). | ✅ presente | `EnvironmentVars.ts:133-142`, `RecebimentoNumerarioService.ts:1524-1526` |
| **Defer Binding (polymorphism)** | Cadeia de 4 fallbacks é `if/return` explícito, não Strategy. Bass canon: Strategy só compensa a partir de ~5 opções ou variação por-tenant. Aqui: 4 opções, sem variação por-tenant, cada fonte é diferente em NATUREZA (env, ERP, cadastro, hardcoded). Legibilidade > extensibilidade especulativa. | ✅ presente (adequado) | `resolverDescricaoItem`, `RecebimentoNumerarioService.ts:1520-1541` |
| **Defer Binding (state-machine)** | **Escolha arquitetural explícita:** NÃO adicionar etapa ao ledger (`etapaOrdem`). O gate da nova etapa é o próprio estado do documento (`dprLngDescrNf` vazio ⟺ tem trabalho a fazer). Isso preserva a capacidade de **retomar execuções já paradas em `obs-done`** — que uma etapa monotônica bloquearia. Documentado no ADR-0036 e no doc-comment do método. | ✅ presente (deliberada) | `RecebimentoNumerarioService.ts:1441-1449`; `ontology/decisions/0036-descricao-item-nde-no-documento.md:66-71` |

## 4. Findings (achados)

### F-modifiability-1: `RecebimentoNumerarioService` continua estourando o soft cap de LOC (não é regressão do delta, é herança)

- **Severidade**: P1
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1-1897`
- **Evidência (objetiva)**:
  ```
  main:   1777 LOC
  delta: +120 LOC (+6,7%) → 1897 LOC (3,16x o alvo de 600)
  Métodos privados: 38. Métodos públicos: 2 (processarAlocacao, classificarAlocacao).
  ```
- **Impacto técnico**: cada `/feature-tweak` sobre a cauda fiscal cai neste arquivo; um dia entra em Merge Conflict Hell com um paralelo de Permutas. Testar em unidade exige mockar 8 colaboradores.
- **Impacto de negócio**: velocidade decrescente por feature na frente Recebimentos. Cada mês adiado o split fica mais caro.
- **Métrica de baseline**: 1897 LOC no arquivo (alvo: 600); 38 métodos privados (alvo: ≤ 20).

### F-modifiability-2: Padrão RMW aplicado 2x em `ConexosNdeFiscalClient` sem abstração — legítimo por ora, monitorar

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services (adiada corretamente)
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:139` (com300) e `:399` (com297 `comDocProdutos`)
- **Evidência (objetiva)**:
  ```
  gravarDocFiscal():          GET finDocFiscal → mutate fisVldTipoNfDebito → PUT → assert(fisVldTipoNfDebito===6)
  gravarDescricaoItemNde():   GET comDocProdutos → mutate dprLngDescrNf   → PUT → assert(dprLngDescrNf non-empty)
  ```
- **Impacto técnico**: duas ocorrências não justificam extração (cada RMW tem Zod, endpoint e predicado diferentes). Uma terceira ocorrência do padrão vai justificar `rmwPut<T>({schema, predicate, endpoint, mutator})`.
- **Impacto de negócio**: nenhum a curto prazo. Débito latente.
- **Métrica de baseline**: 2 ocorrências (limiar de refatoração: 3).

### F-modifiability-3: Decisão "sem etapa no ledger" pode ser regredida por um dev futuro que enxergue apenas `etapaOrdem`

- **Severidade**: P3
- **Tactic violada**: Defer Binding (state-machine)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1716-1733` (`etapaOrdem`)
- **Evidência (objetiva)**:
  ```
  etapaOrdem é a fonte da verdade da máquina de estados de execução; alguém lendo apenas
  esse método não veria por que descricao-item NÃO está lá. A justificativa vive no doc-comment
  do método (linha 1441-1449) e na ADR-0036, mas não há breadcrumb no próprio etapaOrdem.
  ```
- **Impacto técnico**: uma "boa-vontade" futura adiciona `'descricao-item-done'` entre `nota-debito` e `fiscal-done` como parece "óbvio" — quebrando a idempotência por-documento que permite retomar execuções paradas em `obs-done`.
- **Impacto de negócio**: regressão silenciosa: execuções travadas ficariam travadas. Nenhum teste de estado atual pega isso.
- **Métrica de baseline**: 0 comentários inline em `etapaOrdem` remetendo a ADR-0036.

### F-modifiability-4: Configuração `NDE_DESCRICAO_ITEM_FALLBACK` é env por-serviço, não por-tenant/cliente

- **Severidade**: P3
- **Tactic violada**: Defer Binding (configuration)
- **Localização**: `src/backend/domain/libs/environment/model/EnvironmentVars.ts:133-142`, `EnvironmentProvider.ts:178`
- **Evidência (objetiva)**:
  ```
  A env é global ao processo. Se dois clientes precisarem de textos diferentes, o modelo
  atual não resolve — só há uma env. Hoje isso não é problema (default = prdDesNome cobre
  100% dos casos observados; a env é fallback do fallback).
  ```
- **Impacto técnico**: se aparecer variação por-cliente, o binding vira insuficiente e precisa migrar para tabela de config por-tenant. Custo baixo pela boa encapsulação (só o `resolverDescricaoItem` toca).
- **Impacto de negócio**: irrelevante hoje. Débito latente proporcional à demanda.
- **Métrica de baseline**: 1 valor global (alvo se demanda surgir: 1 por-cliente).

### F-modifiability-5: Ontologia (ADR + business-rule + `_index.json` + `_coverage.json`) acompanha o delta — nota positiva

- **Severidade**: informativa (sem card)
- **Tactic violada**: nenhuma — evidência de saúde
- **Localização**: `ontology/decisions/0036-descricao-item-nde-no-documento.md`, `ontology/entities/nota-debito-eletronica.md`, `ontology/integrations/conexos-nde-fiscal.md`, `ontology/_coverage.json`, `ontology/_index.json`
- **Evidência (objetiva)**:
  ```
  ADR-0036 declara entity_changed=false explicitamente, amenda 0022+0024, lista alternativas
  descartadas com justificativa fiscal (não só técnica) e enumera consequências operacionais
  (execuções paradas em obs-done, escrita nova no ERP, NDes já homologadas fora de alcance).
  ```
- **Impacto**: quem mexer aqui em 6 meses tem contexto fechado. Este é o padrão que a ontologia deveria produzir sempre.

## 5. Cards Kanban

### [modifiability-1] Anotar em `etapaOrdem` que "descrição-item" NÃO tem etapa própria por design (link ADR-0036)

- **Problema**
  > `etapaOrdem` é a máquina de estados canônica; quem só lê esse método não descobre por que a nova regra de descrição-item ficou fora. Existe risco alto de um dev futuro adicionar `'descricao-item-done'` "porque parece óbvio" e quebrar a idempotência por-documento que permite retomar execuções paradas em `obs-done`.

- **Melhoria Proposta**
  > Adicionar um comentário de 3-4 linhas ACIMA do `Record<SolicitacaoNumerarioEtapa, number>` em `etapaOrdem` (linha 1717) explicando: (a) descricao-item roda ANTES de fiscal-done sem ledger; (b) idempotência vem do estado do DOCUMENTO (`dprLngDescrNf` vazio ⟺ tem trabalho); (c) etapa monotônica AQUI bloquearia retomadas. Ligar textualmente ao ADR-0036 e ao doc-comment de `etapaDescricaoItem`.

- **Resultado Esperado**
  > Zero risco de regressão silenciosa. Comentário curto o suficiente para não poluir; longo o suficiente para bloquear a "boa-vontade" de padronizar. Métrica: um dev novo, lendo apenas `etapaOrdem`, consegue explicar por que `descricao-item` não está lá.

- **Tactic alvo**: Defer Binding (state-machine) — proteger a decisão contra erosão
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Comentários inline em `etapaOrdem` remetendo à ADR-0036: 0 → 1
  - Tempo para um novo dev inferir a decisão sem sair do arquivo: várias leituras → 1 leitura
- **Risco de não fazer**: uma tweak future adiciona `descricao-item-done` na `etapaOrdem`; execuções travadas em `obs-done` deixam de ser consertadas na retomada; problema só aparece nas NDes de clientes com `dpeVld1DescrNfe = 4` — silencioso em CI, visível apenas em campo.
- **Dependências**: nenhuma.

### [modifiability-2] Planejar split de `RecebimentoNumerarioService` extraindo `NdeCaudaFiscalService`

- **Problema**
  > `RecebimentoNumerarioService` está em 1897 LOC, 3,16x o soft cap de 600. Este delta contribui +120 (+6,7%) — não é regressão, mas empurra o problema. 38 métodos privados; a "cauda fiscal" (`etapaNotaDebito`, `etapaDescricaoItem`, `etapaFiscal`, `etapaObservacoes`, `etapaHomologar`, `etapaPoll`) já é um subsistema coeso reconhecível dentro da classe.

- **Melhoria Proposta**
  > Não fazer o split neste delta (escopo é regra fiscal urgente). Registrar em `ontology/_inbox/recebimentos-refactor-cauda-fiscal.md` a proposta: extrair `NdeCaudaFiscalService` com as 6 `etapa*` fiscais + `etapaAtingida` + `etapaOrdem`, injetado no `RecebimentoNumerarioService` que fica apenas com o orquestrador (`rodarEtapas`, `etapaSn`, `etapaFin014`, `classificarAlocacao`). Tactic: **Split Module** + **Increase Semantic Coherence**. Executar no próximo `/feature-tweak` que tocar duas ou mais `etapa*` fiscais.

- **Resultado Esperado**
  > Orquestrador ≤ 900 LOC; `NdeCaudaFiscalService` ≤ 800 LOC. Testes unitários da cauda fiscal ganham autonomia (mockar 1 colaborador em vez de 8). O padrão de `etapa*` continua o mesmo — só ganha um lar próprio.

- **Tactic alvo**: Split Module, Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: L (1-2 sem, inclui migração de testes)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC do orquestrador: 1897 → ≤ 900
  - Métodos privados no orquestrador: 38 → ≤ 20
  - Colaboradores mockados nos testes da cauda fiscal: 8 → 1
- **Risco de não fazer**: o próximo `/feature-tweak` na cauda fiscal (`I-Receb-6`?) adiciona mais 100-200 LOC; testar em unidade fica proibitivo; merge conflicts com paralelos de Permutas viram rotina.
- **Dependências**: só executar quando o próximo delta na cauda fiscal chegar, para amortizar a migração de testes. Não bloqueia este PR.

### [modifiability-3] Monitorar 3ª ocorrência do padrão RMW no client fiscal antes de extrair helper genérico

- **Problema**
  > O padrão "GET objeto inteiro → mutate um campo → PUT objeto inteiro → assert(predicado no eco)" apareceu 2x em `ConexosNdeFiscalClient` (com300 `finDocFiscal` e com297 `comDocProdutos`). Duas ocorrências não justificam abstração — cada RMW tem Zod, endpoint e discriminador de sucesso próprios, e a prosa em cada doc-comment é uma parte importante da documentação do contrato.

- **Melhoria Proposta**
  > **Não abstrair agora.** Registrar em `ontology/_inbox/rmw-conexos-abstraction.md` que a extração de `rmwPut<T>({schema, endpoint, mutator, predicate})` vira P2 quando aparecer a 3ª ocorrência (candidato provável: `PUT com299` na Frente III se ela ganhar campo derivado de cadastro). Tactic: **Abstract Common Services** — mas conforme a regra dos três.

- **Resultado Esperado**
  > Decisão de abstrair não é esquecida. Quando o 3º RMW chegar, existe um follow-up pronto e a extração vem com o delta que precisa dela — não como refactor especulativo.

- **Tactic alvo**: Abstract Common Services (regra dos três)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h para registrar o follow-up; L para a extração quando o 3º RMW chegar)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Follow-up documentado em `_inbox/`: não existe → existe
  - Quando o 3º RMW chegar: extração + 3 chamadas → 1 helper + 3 configurações
- **Risco de não fazer**: 3ª ocorrência entra copiando a 1ª, e ninguém percebe até a 4ª, quando o custo de padronizar retroativamente ficou maior.
- **Dependências**: nenhuma (é registro de intenção).

### [modifiability-4] Preparar caminho para `ndeDescricaoItemFallback` por-cliente se o modelo por-tenant surgir

- **Problema**
  > `NDE_DESCRICAO_ITEM_FALLBACK` é uma env global ao processo. Hoje isso é adequado (o default `prdDesNome` cobre 100% dos casos observados; a env existe só para o fiscal exigir OUTRO texto). Se aparecer variação por-cliente (Columbia diz "PAGAMENTO ANTECIPADO"; Cliente-Y diz "TARIFA DE CÂMBIO"), o modelo não resolve.

- **Melhoria Proposta**
  > **Não implementar por-cliente agora** — não há demanda. Registrar em `ontology/_inbox/nde-descricao-config-por-cliente.md` o caminho previsto: promover `ndeDescricaoItemFallback` para uma tabela `nde_config_por_cliente(cli_cod, descricao_item_fallback)` consultada pelo `resolverDescricaoItem`. Tactic: **Defer Binding (configuration)** — subir o tier de binding só quando a demanda pedir.

- **Resultado Esperado**
  > Sem sobre-engenharia hoje. Quando (se) a demanda surgir, existe um contrato pronto e o único ponto de código a mudar é `resolverDescricaoItem` (ver F-4).

- **Tactic alvo**: Defer Binding (configuration) — deferir o próprio deferimento
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h para registrar; M para implementar se a demanda vier)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Follow-up documentado: 0 → 1
  - Custo estimado da migração se demanda vier: proporcional (apenas `resolverDescricaoItem` toca a env — a boa encapsulação de hoje é o que dá esse custo baixo)
- **Risco de não fazer**: quando a demanda vier, o dev que a receber vai improvisar (talvez um `switch` por `pesCod` inline) em vez de subir o tier corretamente.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Cross-QA: **Testability** — o delta traz +690 LOC de teste vs +466 LOC de código; positivo. Mas `RecebimentoNumerarioService` a 1897 LOC continua duro de testar (F-modifiability-1 ⟷ testability). O split do card 2 quita ambos.
- Cross-QA: **Integrability** — o novo boundary com o com297 `comDocProdutos` (Zod `.passthrough()`, chave composta, RMW) está corretamente encapsulado no client. `preDescricaoProdutoNf` best-effort (nunca lança) reflete a incerteza do swagger do tenant sem contaminar o serviço. Sinalizar ao `qa-integrability` que a duplicação RMW (F-2) é sinal de contrato repetido do ERP, não de código descuidado.
- Cross-QA: **Deployability** — `NDE_DESCRICAO_ITEM_FALLBACK` é env; mudança em produção exige redeploy no Render. Aceitável porque o caminho default (`prdDesNome`) cobre 100% dos casos observados; a env é fallback do fallback. F-modifiability-4 registra o caminho de subir para tabela se necessário.
- Escopo `--quick` foi respeitado: mediu apenas o delta; o Apêndice A é contexto compartilhado com o consolidador, não avaliação da main.
- Não há regressão de modifiability introduzida por este delta. O agravamento marginal (+7% do LOC do orquestrador já oversize) é aceitável dada a coerência total com o padrão `etapa*` existente e o cuidado de encapsular tudo em `private`. Score 8/10 reflete: delta bem-comportado (+1), decisão arquitetural explícita e documentada (+1), oversize herdado do serviço (-2).
