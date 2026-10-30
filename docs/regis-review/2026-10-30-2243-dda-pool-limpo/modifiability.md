---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-modifiability
generated_at: 2026-10-30T22:55:00-03:00
scope: backend+frontend (diff da feature dda-pool-limpo apenas)
score: 7
findings_count: 6
cards_count: 6
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Produto (analista Columbia / Yuri) | Nova situação do pool DDA (hoje `TITULO_SAIU_CARTEIRA`; amanhã p.ex. `BLOQUEADO_PELO_BANCO`) ou mexer no limite "±10 dias / ±R$ 0,05" que define "saiu da carteira" | `ConsolidacaoBoletoDda` + `PaginacaoBoletoDda` + `BoletoDdaService` (back) + `rotulosDda`, `filtrosBoletosDda`, `FiltroSituacaoDdaBarra`, `TabelaBoletosDda`, `RegrasBoletoDda`, `CardsBoletosDda`, `lib/sispag.ts` (front) | Dev, feature-tweak isolado | Edição localizada em 1-2 arquivos sem quebrar TS, com testes já cobrindo a transição | Diff ≤ 150 LOC em ≤ 3 arquivos para introduzir ou renomear uma situação; magic number só muda num único ponto; 0 regressões de typecheck/lint |

A feature como posta hoje precisa de 7+ arquivos frontend editados (medido abaixo) para adicionar uma situação — custo de mudança assimétrico vs. o volume de regra que ela carrega.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `ConsolidacaoBoletoDda.ts` | 412 | ≤ 400 | ⚠️ | `wc -l src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts` |
| LOC `PaginacaoBoletoDda.ts` | 425 | ≤ 400 | ⚠️ | `wc -l` idem |
| LOC `BoletoDdaService.ts` | 463 | ≤ 400 | ⚠️ | `wc -l` idem |
| LOC `JanelaCarteira.ts` (novo) | 7 | ≤ 50 | ✅ | arquivo novo |
| Cognitive complexity máx. dos arquivos do diff | **19** em `PaginacaoBoletoDda.totalizar` (:321) | ≤ 15 (Biome `noExcessiveCognitiveComplexity`) | ❌ | `npx biome lint domain/service/sispag/{Consolidacao,Paginacao,BoletoDdaService}.ts` |
| Avisos Biome em arquivos tocados | 1 (totalizar) | 0 | ❌ | idem |
| Fan-out da constante `LIMITE_DIAS_SAIDO` (`export` consumido por `BoletoDdaService` para computar janela de SQL) | 2 (consolidação + service → repo) | 1 (encapsulada atrás de método do próprio consolidador) | ⚠️ | `grep -rn LIMITE_DIAS_SAIDO src/backend` |
| Arquivos frontend tocados pela adição da situação `TITULO_SAIU_CARTEIRA` | 7 (`rotulosDda.ts`, `filtrosBoletosDda.ts`, `FiltroSituacaoDdaBarra.tsx`, `TabelaBoletosDda.tsx`, `RegrasBoletoDda.tsx`, `CardsBoletosDda.tsx`, `lib/sispag.ts`) + 2 backend (`BoletoDda.ts`, `PaginacaoBoletoDda.ts`) = 9 | ≤ 3 (um registry + componente de badge) | ⚠️ | `git diff --name-only --diff-filter=M -- 'src/frontend/**'` + `grep TITULO_SAIU_CARTEIRA` |
| Pontos onde a regra "esconder saídos da lista padrão" aparece | 3 (`paginar` deriva `escondeSaidos`; `facetas` filtra; `totalizar` faz `continue`) | 1 (um filtro declarativo compartilhado) | ⚠️ | leitura de `PaginacaoBoletoDda.ts:237-356` |
| Magic numbers de regra em `ConsolidacaoBoletoDda` (`LIMITE_VALOR_SAIDO_CENTAVOS=5`, `LIMITE_DIAS_SAIDO=10`, `MAX_INFORMATIVOS=5`) | 3 constantes locais, nenhuma externalizada em `EnvironmentProvider` | aceitável como constante de domínio; **deve ter nome + comentário + ponto único de alteração** | ✅ (todas nomeadas e comentadas) | leitura `ConsolidacaoBoletoDda.ts:24,30-31` |
| Repetição do recorte `-(JANELA_CARTEIRA_DIAS_ATRAS + LIMITE_DIAS_SAIDO)` entre service e lib | 1 (inline em `BoletoDdaService.consolidarEscopo:141-142`) | encapsular em `JanelaCarteira` (`janelaDeSaidos()`) | ⚠️ | `BoletoDdaService.ts:140-143` |
| Camadas DDD atravessadas no diff | 0 violações (Repository ↔ Service ↔ Service ↔ Front via `lib/sispag.ts`) | 0 | ✅ | `grep "from '.*lambda/" src/backend/domain` (ausente); `grep "from '.*repository" src/backend/http` (ausente) |

> ⚠️ **Não medível localmente**: fan-in longitudinal real da aba `Boletos DDA` em produção (quantas sprints/release notes essa área toca por mês). Em ausência disso, use o Radar/CHANGELOG como proxy; a feature é "quente" (duas releases em outubro, v0.80.1 e v0.81.0).

### Apêndice — Top arquivos do diff por LOC

| LOC | Arquivo |
|---:|---|
| 463 | `src/backend/domain/service/sispag/BoletoDdaService.ts` |
| 425 | `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts` |
| 412 | `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts` |
|   7 | `src/backend/domain/libs/calendar/JanelaCarteira.ts` (novo) |

### Apêndice — Fan-in das constantes/enums tocados pelo diff

| Símbolo | Fan-in (arquivos que importam) | Papel |
|---|---:|---|
| `BOLETO_DDA_SITUACAO` / `BoletoDdaSituacao` | 9 (back+front) | enum núcleo — toda situação nova explode aqui |
| `JANELA_CARTEIRA_DIAS_*` | 2 (`BoletoDdaService`, `ConsolidacaoBoletoDda`) | **positivo**: antes era literal replicado; a extração em `libs/calendar/JanelaCarteira.ts` é a melhoria estrutural do diff |
| `LIMITE_DIAS_SAIDO` | 2 (`BoletoDdaService` consumindo um "detalhe interno" do consolidador) | encapsulamento vazou |
| `SITUACAO_BADGE` | 3 componentes frontend | OK (Record<Situacao,…> tipa) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `BoletoDdaService` (463 LOC) carrega sincronizar+conferir+listar+`comGrupo`+leitura/log. `comGrupo` é pós-processamento da consolidação, cabe num helper próprio. | ⚠️ parcial | `BoletoDdaService.ts:175-209` |
| Increase Semantic Coherence | `PaginacaoBoletoDda.totalizar` acumula contagem, totais R$, amostraHoje, urgência, grupo em um loop só — múltiplas responsabilidades acopladas. | ⚠️ parcial | `PaginacaoBoletoDda.ts:321-381` (cognitive 19) |
| Encapsulate | `LIMITE_DIAS_SAIDO` é `export`ado para `BoletoDdaService` compor o range de SQL de `listInativosRecentes`. Parâmetro interno da regra "saiu da carteira" vazou um nível acima. | ⚠️ parcial | `ConsolidacaoBoletoDda.ts:31` + `BoletoDdaService.ts:141-142` |
| Use an Intermediary | `BoletoDdaService` orquestra `Consolidacao` + `Paginacao` + `BoletoSuggestionService.gruposPorBoleto()` com fallback silencioso — bom padrão. | ✅ presente | `BoletoDdaService.ts:146-168` |
| Restrict Dependencies | Camadas DDD respeitadas; `PaginacaoBoletoDda` é PURA (sem I/O); `ConsolidacaoBoletoDda` é PURA. | ✅ presente | docstrings `PaginacaoBoletoDda.ts:224`, `ConsolidacaoBoletoDda.ts:62` |
| Refactor | `PaginacaoBoletoDda.totalizar` passou do teto do Biome (19 > 15) com a introdução do bloco `grupo` + `urgência`. | ❌ ausente | biome output acima |
| Abstract Common Services | A união `BoletoDdaSituacao` não tem um "registry" (rótulo + ordem + chave de total + segmento) — a mesma informação se dispersa em `SITUACAO_BADGE`, `ROTULO_SITUACAO_DDA`, `ORDEM_SITUACAO`, `SEGMENTOS`, `segmentoDe`, `situacoesDoSegmento`, `totalDoSegmento`. Cada nova situação toca ≥ 7 arquivos. | ⚠️ parcial | `grep -rn TITULO_SAIU_CARTEIRA src/frontend` + `PaginacaoBoletoDda.ts:158-165` |
| Defer Binding | tsyringe + `@injectable()`/`@inject()` no padrão; `JANELA_CARTEIRA_DIAS_*` extraídos para `libs/calendar/JanelaCarteira.ts` como fonte única — melhoria mensurável do diff. Regras numéricas (`LIMITE_*`) nomeadas e constantes de domínio: aceitável para parâmetros estáveis; se o negócio pedir ajuste frequente, mover para `EnvironmentProvider`. | ✅ presente (com ressalva) | `src/backend/domain/libs/calendar/JanelaCarteira.ts`; `ConsolidacaoBoletoDda.ts:24,30-31` |

## 4. Findings

### F-modifiability-1: `PaginacaoBoletoDda.totalizar` acima do teto de complexidade cognitiva

- **Severidade**: P2
- **Tactic violada**: Refactor
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:321-381`
- **Evidência (objetiva)**:
  ```
  domain/service/sispag/PaginacaoBoletoDda.ts:324:69
    lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 19 detected (max: 15).
  ```
- **Impacto técnico**: um método acumula contagem, totais R$, amostraHoje, grupo (`b.grupo`), urgência (`urgenciaDe`) e desvio para "saiu da carteira" num único loop com três `continue`. Adicionar um novo chip de total ("grupoRecusado", "urgentesComAnexo", etc.) exige entrar nesse laço — ponto único de alteração para N responsabilidades.
- **Impacto de negócio**: cada tweak de card do dashboard (prática do time, releases v0.80/v0.81) paga o custo de reler o laço inteiro para não quebrar outra métrica; risco de regressão silenciosa em `totais.hoje`/`urgentes*` que alimentam o chip "Vencem hoje" da aba.
- **Métrica de baseline**: cognitive complexity 19, teto Biome 15 (`noExcessiveCognitiveComplexity: warn`).

### F-modifiability-2: Regra "esconder saídos da lista padrão" dispersa em 3 pontos

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:72,237-253,322-356`
- **Evidência**:
  ```ts
  const ESCONDIDA_NA_LISTA_PADRAO: BoletoDdaSituacao = BOLETO_DDA_SITUACAO.TITULO_SAIU_CARTEIRA;
  // paginar:
  const escondeSaidos = filtro.situacao === undefined && situacoes === undefined;
  const facetas = this.facetas(escondeSaidos ? linhas.filter((b) => b.situacao !== ESCONDIDA_NA_LISTA_PADRAO) : linhas);
  // filtradas:
  !(escondeSaidos && b.situacao === ESCONDIDA_NA_LISTA_PADRAO) && …
  // totalizar:
  if (b.situacao === ESCONDIDA_NA_LISTA_PADRAO) continue;
  ```
- **Impacto técnico**: para dizer "saiu da carteira some de todo lugar que não pediu explicitamente" o diff precisou de uma derivação (`escondeSaidos`), um pré-filtro para `facetas`, um filtro no `.filter` final e um `continue` no laço de totais. Esquecer um sítio é possível e silencioso (o teste de total passa, o teste de faceta não).
- **Impacto de negócio**: regra de visibilidade acopla backend × UI; qualquer "mas eu quero contar escondidos como X" vira busca manual pelos 3 sítios.
- **Métrica de baseline**: 3 pontos de edição coordenada para a mesma regra; 1 constante de nome, 1 derivação local, 2 filtros + 1 `continue`.

### F-modifiability-3: `LIMITE_DIAS_SAIDO` vazou da consolidação para o service

- **Severidade**: P2
- **Tactic violada**: Encapsulate
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts:31` + `src/backend/domain/service/sispag/BoletoDdaService.ts:32,140-143`
- **Evidência**:
  ```ts
  // ConsolidacaoBoletoDda.ts
  export const LIMITE_DIAS_SAIDO = 10;
  // BoletoDdaService.consolidarEscopo
  this.tituloRepo.listInativosRecentes({
      de:  this.calendar.addDays(hoje, -(JANELA_CARTEIRA_DIAS_ATRAS + LIMITE_DIAS_SAIDO)),
      ate: this.calendar.addDays(hoje,   JANELA_CARTEIRA_DIAS_ADIANTE + LIMITE_DIAS_SAIDO),
  });
  ```
- **Impacto técnico**: um detalhe interno da regra "saiu da carteira" (`±10 dias`) virou API pública da `ConsolidacaoBoletoDda` só porque o service precisa calcular o range do SQL. Reajustar o halo (p.ex. para `±15`) obriga a lembrar que o range do repositório também muda; esquecer deixa a sugestão `TITULO_SAIU_CARTEIRA` encontrando casos que o SQL já descartou (falso-silêncio).
- **Impacto de negócio**: o parâmetro define quando um boleto "parece quitado" na UI — regra visível ao usuário; mudar sem o reflexo no SQL causa inconsistência entre lista e detalhe.
- **Métrica de baseline**: 2 arquivos a tocar junto para 1 regra; 0 testes exercitam a dupla.

### F-modifiability-4: Fan-out alto da enum `BoletoDdaSituacao`

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**:
  - back: `src/backend/domain/interface/sispag/BoletoDda.ts`, `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:158-165,325-350`
  - front: `src/frontend/lib/sispag.ts:1680`, `src/frontend/app/sispag/boletos-dda/rotulosDda.ts`, `filtrosBoletosDda.ts:22-29,32-38,93-118`, `FiltroSituacaoDdaBarra.tsx:16-24,55-70`, `TabelaBoletosDda.tsx:41-50`, `RegrasBoletoDda.tsx:6`, `components/CardsBoletosDda.tsx:52`
- **Evidência**: a mesma informação por situação está em `SITUACAO_BADGE` (label + classes + help), `ROTULO_SITUACAO_DDA` (label curto), `ORDEM_SITUACAO` (ordem de exibição), `SEGMENTOS` (segmento externo), `segmentoDe` + `situacoesDoSegmento` (switches gêmeos), `totalDoSegmento` (switch com `totalDe` por chave), `ORDEM` em `RegrasBoletoDda.tsx`, e a enumeração `|` da união em `lib/sispag.ts`.
- **Impacto técnico**: adicionar a situação `TITULO_SAIU_CARTEIRA` neste diff tocou 7 arquivos frontend e 2 backend. `Record<Situacao,…>` protege parte (`SITUACAO_BADGE`, `ROTULO_SITUACAO_DDA`, `ORDEM_SITUACAO`), mas listas (`ORDEM` em `RegrasBoletoDda`, `SEGMENTOS`, array de ordem em `TabelaBoletosDda`) e switches (`segmentoDe`, `situacoesDoSegmento`, `totalDoSegmento`) ficam fora do typecheck para o caso "faltou entrar na lista/switch com o label e o segmento certos".
- **Impacto de negócio**: cada iteração do produto que acrescenta um estado (previsível: FORA_DO_BLOQUETO, PAGO_SEM_LOTE etc.) paga 9 arquivos. Numa área que teve 2 releases num mês, o atrito acumula.
- **Métrica de baseline**: 7 arquivos frontend + 2 backend editados para a situação deste diff; 3 switches/arrays sem exaustividade garantida pelo TS.

### F-modifiability-5: `BoletoDdaService` responsabilidade dupla (orquestração + folding de grupo)

- **Severidade**: P3
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:175-209` (`comGrupo`)
- **Evidência**: `comGrupo` reescreve a linha consolidada escolhendo entre a representante e as cópias com base no estado do grupo (`CONFIRMADO` > qualquer outro). É uma transformação pura sobre `BoletoDdaConsolidado[]`, o que a torna um co-primo de `ConsolidacaoBoletoDda`, não parte da orquestração de IO.
- **Impacto técnico**: `BoletoDdaService` tem 463 LOC combinando `sincronizar`, `conferir`, `conferirSeVelho`, `executarSincronizacao`, `executarConferencia`, `lerArquivos`, `listar`, `consolidarEscopo`, `gruposOuNenhum`, `comGrupo`. Testar `comGrupo` em isolamento hoje requer o container do service inteiro.
- **Impacto de negócio**: baixo direto; alto cumulativo — qualquer regra nova de "qual cópia ganha o grupo" (I21v evolve) edita o service orquestrador.
- **Métrica de baseline**: 463 LOC > alvo 400; `comGrupo` é 35 LOC auto-contidas sem I/O que poderiam viver em `ConsolidacaoBoletoDda.aplicarGrupo` ou `BoletoDdaGrupoResolver`.

### F-modifiability-6: Recorte `JANELA + LIMITE_DIAS_SAIDO` inline no service

- **Severidade**: P3
- **Tactic violada**: Encapsulate
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:140-143`
- **Evidência**: o par `-25 .. +55` (= `-(15+10) .. +(45+10)`) só existe como aritmética inline; nenhum nome, nenhum teste direto do intervalo.
- **Impacto técnico**: a nova lib `JanelaCarteira` resolveu a janela da carteira; a *janela da busca de inativos* ("carteira + halo de ±10 do matching") ficou de fora. Mudar a janela da carteira automaticamente ajusta a de inativos — bom. Mudar o `LIMITE_DIAS_SAIDO` **não** aparece no nome do recorte — ruim.
- **Impacto de negócio**: baixo. P3 — Melhoria de legibilidade/encapsulamento.
- **Métrica de baseline**: 1 ocorrência inline, 0 referências nomeadas, 0 testes isolados do intervalo.

## 5. Cards Kanban

### [modifiability-1] Quebrar `PaginacaoBoletoDda.totalizar` em passes nomeados

- **Problema**
  > `totalizar` acumula situação, grupo, urgência e amostraHoje no mesmo laço (cognitive complexity 19 no Biome, teto 15). Novo chip = mexer no laço.
- **Melhoria Proposta**
  > Extrair `contarPorSituacao`, `acumularGrupo`, `acumularUrgencia`, `acumularAmostraHoje` como funções locais que recebem o acumulador e a linha. `totalizar` vira a composição delas num único `for`. Tactic Bass: **Refactor**.
- **Resultado Esperado**
  > Complexity ≤ 15; cada passe testável; incluir uma métrica nova = adicionar um `acumulador` (1 ponto de edição).
- **Tactic alvo**: Refactor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Biome `noExcessiveCognitiveComplexity` em `totalizar`: 19 → ≤ 15
  - Avisos Biome em arquivos do diff: 1 → 0
- **Risco de não fazer**: regressão em `totais.urgentes*` passa despercebida porque o laço mistura `continue` de "saiu da carteira", "fora da janela" e faixa não-urgente.
- **Dependências**: nenhuma

### [modifiability-2] Encapsular "esconder saídos da lista padrão" como filtro declarativo

- **Problema**
  > A mesma regra ("sem pedido explícito ⇒ `TITULO_SAIU_CARTEIRA` some das facetas, da lista e dos totais") está escrita em 3 lugares com 3 sintaxes (filtro de facetas, filtro final, `continue` no laço de totais).
- **Melhoria Proposta**
  > Introduzir `visibilidadePadrao(filtro): (b) => boolean` em `PaginacaoBoletoDda`. `paginar` e `facetas` consomem a função; `totalizar` recebe o predicado e pula a linha num único ponto. Tactic Bass: **Increase Semantic Coherence** + **Encapsulate**.
- **Resultado Esperado**
  > Mudar quais situações ficam escondidas por padrão = editar 1 função.
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Pontos de edição coordenada da regra "escondida": 3 → 1
- **Risco de não fazer**: facetas e totais divergirem em releases futuros (contagem bate, chip-count não).
- **Dependências**: nenhuma

### [modifiability-3] Mover `JANELA + LIMITE_DIAS_SAIDO` para a lib de janela

- **Problema**
  > `LIMITE_DIAS_SAIDO` é um parâmetro interno da regra "saiu da carteira" na `ConsolidacaoBoletoDda`, mas foi `export`ado para que `BoletoDdaService` montasse o range SQL de inativos. Mudança no halo exige mudança em 2 arquivos acoplados por conhecimento tácito.
- **Melhoria Proposta**
  > Adicionar em `src/backend/domain/libs/calendar/JanelaCarteira.ts` um `janelaDeInativosParaSaidaDaCarteira(calendar, hoje)` que devolve `{de, ate}` já com o halo somado. `ConsolidacaoBoletoDda` segue com `LIMITE_DIAS_SAIDO` **privado** (não `export`). Service passa a chamar a nova função. Tactic Bass: **Encapsulate** + **Abstract Common Services**.
- **Resultado Esperado**
  > `grep LIMITE_DIAS_SAIDO src/backend` só casa dentro de `ConsolidacaoBoletoDda.ts`. Reajustar `±10` muda em 1 ponto; o SQL acompanha por composição.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3, F-modifiability-6
- **Métricas de sucesso**:
  - Fan-out de `LIMITE_DIAS_SAIDO`: 2 → 1
  - Aritmética inline `JANELA_CARTEIRA_* + LIMITE_DIAS_SAIDO`: 2 ocorrências → 0
- **Risco de não fazer**: ajuste do halo em uma release deixa a sugestão "saiu da carteira" encontrando casos que o repositório já cortou (silent miss).
- **Dependências**: nenhuma

### [modifiability-4] Registry único para `BoletoDdaSituacao` (label + segmento + ordem + chave de total)

- **Problema**
  > Adicionar uma situação neste diff tocou 7 arquivos frontend + 2 backend. A mesma informação (label, help, cor, segmento, chave de total, posição de ordem) está dispersa em `SITUACAO_BADGE`, `ROTULO_SITUACAO_DDA`, `ORDEM_SITUACAO`, `SEGMENTOS`, `segmentoDe`, `situacoesDoSegmento`, `totalDoSegmento`, `ORDEM` do `RegrasBoletoDda`.
- **Melhoria Proposta**
  > Em `src/frontend/app/sispag/boletos-dda/rotulosDda.ts` (fonte única), definir `SITUACOES_DDA: Record<BoletoDdaSituacao, { label; className; help; ordem; segmento; chaveTotal; escondidaNaListaPadrao? }>` e derivar `SITUACAO_BADGE`, `ROTULO_SITUACAO_DDA`, `ORDEM_SITUACAO` (front), `SEGMENTOS`, `segmentoDe`, `situacoesDoSegmento` e `totalDoSegmento` do registry. Trocar os `switch` em `FiltroSituacaoDdaBarra` e `filtrosBoletosDda` por lookups. No backend, derivar `ORDEM_SITUACAO` de uma constante compartilhada em `interface/sispag/BoletoDda.ts` para evitar drift. Tactic Bass: **Abstract Common Services** + **Defer Binding (polymorphism via data)**.
- **Resultado Esperado**
  > Nova situação = acrescentar 1 entrada no registry + eventual regra de hide. Edição em 1 arquivo.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Arquivos frontend tocados para introduzir 1 situação: 7 → ≤ 2
  - Switches gêmeos (`segmentoDe`+`situacoesDoSegmento`+`totalDoSegmento`): 3 → 1 lookup
- **Risco de não fazer**: cada evolução do produto na aba paga retrabalho desproporcional; típico cenário de "esqueceram de atualizar o `ORDEM` do `RegrasBoletoDda`" por não haver exaustividade.
- **Dependências**: nenhuma

### [modifiability-5] Separar `comGrupo` do `BoletoDdaService`

- **Problema**
  > `BoletoDdaService` (463 LOC) mistura orquestração de IO (`sincronizar`, `conferir`, `lerArquivos`) com uma transformação pura (`comGrupo`, 35 LOC) sobre o resultado da consolidação. Teste e mudança de regra do grupo passam pelo container inteiro.
- **Melhoria Proposta**
  > Extrair `comGrupo` para `ConsolidacaoBoletoDda.aplicarGrupo` (ou um `BoletoDdaGrupoResolver` injetável). `BoletoDdaService.consolidarEscopo` compõe `consolidacao.consolidar(...)` → `consolidacao.aplicarGrupo(...)`. Tactic Bass: **Split Module** / **Increase Semantic Coherence**.
- **Resultado Esperado**
  > `BoletoDdaService` ≤ 420 LOC; `comGrupo` testável sem o container; regra de "qual cópia ganha o grupo" num só lugar junto da regra de "qual cópia é representante".
- **Tactic alvo**: Split Module
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - LOC `BoletoDdaService.ts`: 463 → ≤ 420
- **Risco de não fazer**: cumulativo; o service continuará ganhando pós-processamentos (urgência, SLA, exportação) e virará *god service* da aba.
- **Dependências**: pode combinar com [modifiability-3]

### [modifiability-6] Nomear o recorte da janela de inativos

- **Problema**
  > `BoletoDdaService.consolidarEscopo` usa `-(JANELA_CARTEIRA_DIAS_ATRAS + LIMITE_DIAS_SAIDO)` e `+(JANELA_CARTEIRA_DIAS_ADIANTE + LIMITE_DIAS_SAIDO)` sem um nome. O "halo de ±10 do matching" só aparece como aritmética.
- **Melhoria Proposta**
  > Resolver no card [modifiability-3] encapsulando o recorte em `janelaDeInativosParaSaidaDaCarteira`. Fica como P3 independente caso o -3 não entre no sprint.
- **Resultado Esperado**
  > 0 somas inline das constantes de janela em services.
- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Ocorrências de `JANELA_CARTEIRA_* +/- LIMITE_*` em services: 2 → 0
- **Risco de não fazer**: baixo direto; alto se outro service precisar da mesma janela e replicar a aritmética.
- **Dependências**: [modifiability-3]

## 6. Notas do agente

- Escopo respeitado: só os arquivos do diff + `JanelaCarteira.ts` (novo). Não comentei legado Express, outros services, nem o diff do ERP/`ingestaoPagamentos`.
- Melhoria estrutural real do diff: extração de `JANELA_CARTEIRA_DIAS_*` para `libs/calendar/JanelaCarteira.ts`. É o movimento certo e foi feito corretamente.
- Cross-QA — alertar o consolidator:
  - **Testability**: `PaginacaoBoletoDda.totalizar` cognitive 19 e `BoletoDdaService.comGrupo` 35 LOC embutidas no service são o mesmo sintoma visto do lado "difícil de testar em isolamento" (F-modifiability-1, F-modifiability-5).
  - **Integrability**: F-modifiability-3 (vazamento de `LIMITE_DIAS_SAIDO`) acopla consolidador ↔ repositório ↔ service — pertinente ao Integrability (acoplamento de interface).
  - **Deployability**: `LIMITE_*` como constantes de código (não `EnvironmentProvider`) é escolha deliberada (parâmetros estáveis de domínio). Se o produto pedir ajuste frequente em produção, migrar para configuração externa (defer binding em runtime) vira P2 — hoje P3.
- Score 7/10: diff disciplinado, bem comentado, com 1 fuga de regra do Biome, 1 vazamento de encapsulamento e um fan-out de enum que vem subindo com cada situação nova.
