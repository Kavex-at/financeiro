---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-30-sispag-dda-paridade
agent: qa-modifiability
generated_at: 2026-10-30T00:00:00Z
scope: all
score: 7.5
findings_count: 6
cards_count: 5
---

# Modifiability — Regis-Review (reduced, feature `sispag-dda-paridade`)

Revisão restrita ao delta não commitado do worktree `sispag-dda-paridade` sobre `origin/main` (v0.79.0). A feature reconstrói a aba "Boletos DDA" seguindo o padrão da aba "Títulos a pagar": pedaços comuns (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) foram extraídos; no backend, `PaginacaoBoletoDda` ganhou filtros/ordenação/facetas de coluna e `ConsolidacaoBoletoDdaCache` entrou como singleton.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista pede paridade visual/funcional entre as duas abas SISPAG | Mudança em UX de filtro/paginação/segmentos precisa valer para as duas | FE `app/sispag/{situacao,boletos-dda,components}`, BE `routes/sispag.ts` + `service/sispag/PaginacaoBoletoDda.ts` | Dev, feature ativa (worktree) | Pedaços compartilhados são **extraídos em um só lugar**, não forkados; mudança em um pedaço atinge as duas abas sem edição dupla | Nº de componentes forkados entre as duas abas = 0; LOC do consumidor principal (`BoletosDdaTab.tsx`) ≤ 400; cost of change de "muda a UI do rodapé de paginação" = 1 arquivo |

## 2. Métricas observadas (delta)

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Componentes shared realmente consumidos pelas duas abas | 5/5 (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) | 5/5 | ✅ | `grep -rn` em `src/frontend/app/sispag/` — ver §5 |
| Forks / duplicatas de UI de filtro-paginação entre as duas abas | 0 | 0 | ✅ | leitura direta de `TabelaTitulos.tsx` × `boletos-dda/TabelaBoletosDda.tsx` |
| LOC `BoletosDdaTab.tsx` (antes vs depois) | 592 (base) → 296 (atual) | ≤ 400 | ✅ | `git diff HEAD --stat` |
| LOC `TabelaBoletosDda.tsx` (novo) | 405 | ≤ 400 | ⚠️ | `wc -l` |
| LOC `PaginacaoBoletoDda.ts` (serviço) | 401 (vs ~140 base) | ≤ 400 | ⚠️ | `wc -l`, `git diff HEAD --stat` |
| LOC `src/backend/routes/sispag.ts` (arquivo acumulador) | 1 976 | ≤ 600 | ❌ | `wc -l` — pré-existente, +52 LOC neste delta |
| Paradigmas de paginação coexistindo em `src/frontend/app/sispag/` | 2 (`PaginacaoTabela` novo + `Paginacao` legado de `app/permutas/components/tabela-filtro`) | 1 por aba (transitório aceitável) | ⚠️ | `grep -n "FiltroBarra\|Paginacao" src/frontend/app/sispag/page.tsx` → linhas 81, 1253, 1648, 1698, 1757, 1873 |
| Localização dos pedaços "shared" | sob `app/sispag/situacao/` (home da outra aba) | sob `app/sispag/shared/` ou `components/filtros/` | ⚠️ | imports `../situacao/ChipFiltro` em `boletos-dda/FiltroSituacaoDdaBarra.tsx:6-7`, `boletos-dda/TabelaBoletosDda.tsx:26-27` |
| Estado da aba guardado em `let` no módulo | 1 (`useTabelaBoletosDda.ts:35`) | 0 (prefere URL/context, como Títulos) | ⚠️ | `src/frontend/app/sispag/boletos-dda/useTabelaBoletosDda.ts:35` |
| Novo singleton `@singleton() @injectable()` com relógio injetável | 1 (`ConsolidacaoBoletoDdaCache`) | padrão `withClock` seguido | ✅ | `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:28-43` |
| Magic numbers em `const` de serviço no delta | 4 (TTL 30 000, MAX_ENTRADAS 4, PRAZO 60 000, FANOUT 3) — todos nomeados | 0 anônimos | ✅ | `ConsolidacaoBoletoDdaCache.ts:5,7`; `BoletoDdaService.ts:36,46` |

> Métricas de cognitive-complexity de Biome e import fan-in global **não medidas** nesta revisão reduzida (fora do escopo do delta).

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação | Status | Evidência |
|---|---|---|---|
| Split Module | `BoletosDdaTab.tsx` foi dividido em `FiltroSituacaoDdaBarra`, `TabelaBoletosDda`, `useTabelaBoletosDda`, `filtrosBoletosDda`, `FaixaBoletosHoje`, `RegrasBoletoDda`, `rotulosDda` | ✅ | `src/frontend/app/sispag/boletos-dda/*` |
| Increase Semantic Coherence | Cada módulo da pasta `boletos-dda/` tem um papel (filtros × tabela × hook × rótulos × regras); `PaginacaoBoletoDda` concentra filtrar+ordenar+paginar+facetar — ainda uma classe só, mas com privados pequenos e puros | ⚠️ | `PaginacaoBoletoDda.ts:219-382` |
| Encapsulate | Novo `ConsolidacaoBoletoDdaCache` singleton, com API `obter/invalidar` e TTL/clock injetáveis via `withClock` | ✅ | `ConsolidacaoBoletoDdaCache.ts:30-85` |
| Use an Intermediary | Hook `useTabelaBoletosDda` intermedia estado dos filtros entre segmentos, chips e colunas (tudo em `situacoes`) — espelha o `useTabelaTitulos` | ✅ | `useTabelaBoletosDda.ts:47-146` |
| Abstract Common Services | `ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard` **são de fato consumidos** pelas duas abas | ✅ | §5, `grep -rn` |
| Restrict Dependencies | Boletos-DDA importa de `../situacao/` (home da outra aba): acoplamento assimétrico — a aba nova depende do nome da pasta da aba antiga | ⚠️ | `boletos-dda/FiltroSituacaoDdaBarra.tsx:6-7` |
| Refactor | Zod + querystring do GET `/boletos-dda` ganhou helper local `listaQuery` (coerência) e a lista de campos cresceu em 9 chaves com padrão consistente | ✅ | `src/backend/routes/sispag.ts:1530-1588` |
| Defer Binding (DI / tsyringe) | Novo cache é `@singleton() @injectable()`; relógio injetável para teste | ✅ | `ConsolidacaoBoletoDdaCache.ts:28-43` |
| Defer Binding (config/plug-in) | Prazo da passada (`BOLETO_DDA_PRAZO_MS = 60_000`) é constante exportada, não configurável via `EnvironmentProvider` — mudar exige redeploy | ⚠️ | `BoletoDdaService.ts:46` |
| Defer Binding (polimorfismo em runtime) | Não há demanda — aba única, repositório único | N/A | — |

## 4. Findings

### F-modifiability-1: pedaços "shared" moram na pasta da outra aba

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies / Increase Semantic Coherence
- **Localização**:
  - `src/frontend/app/sispag/situacao/ChipFiltro.tsx:1-37`
  - `src/frontend/app/sispag/situacao/SegmentosComTotal.tsx:1-59`
  - `src/frontend/app/sispag/situacao/PilulasFiltroAtivo.tsx:1-32`
  - `src/frontend/app/sispag/situacao/PaginacaoTabela.tsx:1-52`
  - `src/frontend/app/sispag/situacao/botoesDeCard.ts:1-8`
  - consumidores: `src/frontend/app/sispag/boletos-dda/FiltroSituacaoDdaBarra.tsx:6-7`, `src/frontend/app/sispag/boletos-dda/TabelaBoletosDda.tsx:26-27`, `src/frontend/app/sispag/components/CardsBoletosDda.tsx:10`
- **Evidência**:
  ```
  // boletos-dda/FiltroSituacaoDdaBarra.tsx
  import { ChipFiltro } from '../situacao/ChipFiltro'
  import { SegmentosComTotal } from '../situacao/SegmentosComTotal'
  ```
- **Impacto técnico**: a nova aba ganha uma dependência de caminho para a aba antiga; mover/renomear `situacao/` arrasta a nova aba junto. Grep por "quem usa Boletos DDA" não cobre esses pedaços porque eles estão em `situacao/`. Quando chegar uma terceira aba (ex.: Autorizações), a tentação é importar de `situacao/` de novo e cristalizar o acoplamento assimétrico.
- **Impacto de negócio**: fricção em revisões futuras, risco de fork por preguiça de mover, custo de change acima do necessário em mudanças de UX transversais.
- **Métrica de baseline**: 5 arquivos shared sob pasta de domínio alheio; 7 pontos de import cruzando a fronteira `situacao/` ↔ `boletos-dda/`.

### F-modifiability-2: `src/backend/routes/sispag.ts` passou de 1 924 → 1 976 LOC

- **Severidade**: P2 (pré-existente, agravado)
- **Tactic violada**: Split Module
- **Localização**: `src/backend/routes/sispag.ts` (arquivo inteiro); delta em `:1527-1636` (schema DDA + rota).
- **Evidência**:
  ```
  $ wc -l src/backend/routes/sispag.ts
  1976
  ```
- **Impacto técnico**: cada rota nova sobe o custo marginal de leitura; já é o maior arquivo do backend por larga margem. O helper `listaQuery` ficou embutido no arquivo em vez de ir para `http/schemas.ts`.
- **Impacto de negócio**: next-feature cost sobe linearmente. Rota DDA custou +52 LOC neste delta.
- **Métrica de baseline**: 1 976 LOC, alvo da regra de modifiability ≤ 600 LOC.

### F-modifiability-3: `PaginacaoBoletoDda` concentra 4 responsabilidades em 401 LOC

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:219-382`
- **Evidência**: a classe tem `paginar` (público), `criterios` (filtros ANTES da situação), `totalizar` (contagem + totais + amostra "hoje"), `facetas` (opções de coluna) e `comFilial` (derivação da filial). Métodos pequenos (≤ 50 LOC cada), mas 4 eixos de mudança no mesmo arquivo.
- **Impacto técnico**: cada nova faceta (ex.: filtro por grupo confirmado, nova faixa de vencimento) toca duas regiões (criterios + totalizar). Testabilidade razoável porque é PURA, mas o arquivo cresce.
- **Impacto de negócio**: baixo hoje; alvo de split quando passar de ~500 LOC ou surgir uma 3ª aba paginada no mesmo molde.
- **Métrica de baseline**: 401 LOC, 4 responsabilidades em uma classe.

### F-modifiability-4: estado da aba em `let` no módulo (`guardado`)

- **Severidade**: P3
- **Tactic violada**: Defer Binding (via escopo controlado) / Testability-coupled
- **Localização**: `src/frontend/app/sispag/boletos-dda/useTabelaBoletosDda.ts:35,55-57`
- **Evidência**:
  ```
  let guardado: EstadoGuardado | undefined
  ...
  React.useEffect(() => { guardado = { filtros, ordem, pagina } }, [filtros, ordem, pagina])
  ```
  Compensado por `esquecerEstadoBoletosDda()` exportado só para testes.
- **Impacto técnico**: estado vive no módulo (não em contexto/URL como em Títulos a pagar), vaza entre instâncias e entre testes se o helper não for chamado; frear com Fast Refresh em dev pode reter estado inesperado. A opção foi deliberada (comentário cita Q7 da entrevista): não vai para URL. Mas é diferente da aba-irmã, aumentando a entropia cognitiva.
- **Impacto de negócio**: baixo; eventual bug de "aba fantasma guardou filtro antigo após logout" em cenário SPA.
- **Métrica de baseline**: 1 variável mutável de módulo; aba-irmã (`useTabelaTitulos`) usa querystring.

### F-modifiability-5: `BOLETO_DDA_PRAZO_MS` é constante compilada

- **Severidade**: P3
- **Tactic violada**: Defer Binding (configuração)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:46`
- **Evidência**: `export const BOLETO_DDA_PRAZO_MS = 60_000;` consumido tanto pela rota (`routes/sispag.ts:1619`) quanto, implicitamente, pela ingestão. Trocar o prazo = deploy.
- **Impacto técnico**: operações não têm botão para esticar o prazo em HML sem build. Dado o acoplamento com SLA do botão "Atualizar DDA", é um valor que o Yuri pode querer bater em prod.
- **Impacto de negócio**: baixo; mitigado pelo mecanismo de `arquivosAdiados`.
- **Métrica de baseline**: 1 constante de regra de negócio não externalizada.

### F-modifiability-6: dois paradigmas de paginação coexistem em `app/sispag/`

- **Severidade**: P3 (transitório esperado; registrar para não cristalizar)
- **Tactic violada**: Abstract Common Services
- **Localização**:
  - novo: `src/frontend/app/sispag/situacao/PaginacaoTabela.tsx` (server-paginated)
  - legado: `src/frontend/app/permutas/components/tabela-filtro.tsx:272` (`FiltroBarra` + `Paginacao`, client-side, usado por `page.tsx:1253,1648,1698,1757,1873` para outras abas SISPAG e também por `recebimentos/*` e `permutas/*`)
- **Evidência**: `grep -rn "FiltroBarra\|Paginacao" src/frontend/app/sispag/page.tsx` — 5 ocorrências do legado permanecem após a extração.
- **Impacto técnico**: mesma tela usa dois contratos (`setPagina(fn)` vs `onPagina(p)`, cliente vs servidor). Qualquer mudança visual precisa ser feita duas vezes até a convergência.
- **Impacto de negócio**: baixo no delta (feature não removeu nada que já funcionava), mas cria débito acumulável.
- **Métrica de baseline**: 2 paginators ativos; 5 pontos legados em `page.tsx` e ≥ 3 em `recebimentos/`.

## 5. Cards Kanban

### [modifiability-1] Mover pedaços shared para `app/sispag/shared/` (ou `components/filtros/`)

- **Problema**
  > Os componentes extraídos (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) são usados pelas duas abas (Títulos a pagar e Boletos DDA), mas moram em `app/sispag/situacao/`, que é a pasta da aba Títulos. A aba nova importa de `../situacao/*` — a nomenclatura esconde o papel compartilhado e cria acoplamento assimétrico.

- **Melhoria Proposta**
  > Mover os cinco arquivos para `app/sispag/shared/` (ou `app/sispag/components/filtros/`) e atualizar imports nos sete pontos conhecidos (`boletos-dda/FiltroSituacaoDdaBarra.tsx:6-7`, `boletos-dda/TabelaBoletosDda.tsx:26-27`, `components/CardsBoletosDda.tsx:10`, `situacao/FiltroSituacaoBarra.tsx:7-9`, `situacao/CardsSituacao.tsx:8`, `situacao/TabelaTitulos.tsx:39-40`). Tactic: **Abstract Common Services** + **Restrict Dependencies**.

- **Resultado Esperado**
  > Nenhuma aba importa de pasta de aba irmã. Grep por consumidores da aba Boletos DDA cobre 100% do que a aba usa.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Imports cruzando `situacao/` ↔ `boletos-dda/`: 7 → 0
  - Pedaços shared sob pasta de aba: 5 → 0
- **Risco de não fazer**: terceira aba (p.ex. Autorizações) herda o acoplamento ou força um segundo fork.
- **Dependências**: nenhuma.

### [modifiability-2] Fatiar `src/backend/routes/sispag.ts` por sub-rota

- **Problema**
  > O arquivo chegou a 1 976 LOC após este delta (+52). Já é o maior arquivo do backend; cada feature nova paga o custo marginal de leitura e navegação. Dentro do delta, o helper `listaQuery` ficou embutido no arquivo em vez de ir para `http/schemas.ts`.

- **Melhoria Proposta**
  > Extrair módulos de rota por área: `routes/sispag/boletos-dda.ts`, `routes/sispag/lotes.ts`, `routes/sispag/autorizacoes.ts`, etc., mantendo um `routes/sispag.ts` que só compõe `Router`. Mover `listaQuery` e os schemas Zod comuns para `http/schemas.ts`. Tactic: **Split Module**.

- **Resultado Esperado**
  > Cada módulo de rota ≤ 400 LOC; `routes/sispag.ts` vira composição ≤ 100 LOC.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC do maior arquivo de rota SISPAG: 1 976 → ≤ 400
  - Nº de arquivos de rota SISPAG: 1 → N (um por área)
- **Risco de não fazer**: curva de LOC continua linear por feature; onboarding fica mais caro a cada ciclo.
- **Dependências**: nenhuma técnica; preferir fazer **fora** desta feature para não ampliar o blast radius da revisão.

### [modifiability-3] Dividir `PaginacaoBoletoDda` em `FiltragemBoletoDda` + `FacetasBoletoDda` + `TotaisBoletoDda`

- **Problema**
  > Uma única classe reúne filtrar/ordenar/paginar/totalizar/facetar. São 4 eixos de mudança; cada nova faceta toca pelo menos dois (`criterios` + `totalizar`). A classe hoje tem 401 LOC e cresce proporcional ao nº de colunas.

- **Melhoria Proposta**
  > Extrair `FacetasBoletoDda` (puro: entra `linhas`, sai `facetas`) e `TotaisBoletoDda` (puro: entra `linhas + hoje`, sai `contagem/totais/amostraHoje`). `PaginacaoBoletoDda` passa a orquestrar: `criterios → filtra → facetas → totais → ordena → pagina`. Tactic: **Increase Semantic Coherence**.

- **Resultado Esperado**
  > Cada classe ≤ 150 LOC; mudar a definição de "urgente" toca só `TotaisBoletoDda`; adicionar nova coluna de facet toca só `FacetasBoletoDda`.

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC máximo entre as três classes: 401 → ≤ 150
  - Nº de classes "puras" cobertas por teste unitário: 1 → 3
- **Risco de não fazer**: cresce a cada novo chip; teste único vira caso-a-caso de 500+ linhas.
- **Dependências**: nenhuma.

### [modifiability-4] Externalizar `BOLETO_DDA_PRAZO_MS` via `EnvironmentProvider`

- **Problema**
  > O prazo da passada da sincronização (60 s) é constante compilada; mudar prazo = deploy. Vai ser batido pelo operador cedo ou tarde (SLA do botão "Atualizar DDA").

- **Melhoria Proposta**
  > Mover para `EnvironmentProvider` como `SISPAG_DDA_PRAZO_MS` (default 60 000), com Zod `coerce.number().int().positive()`. A rota e o job passam a resolver via DI. Tactic: **Defer Binding (configuration)**.

- **Resultado Esperado**
  > Trocar prazo = variável de ambiente; nenhum build.

- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Constantes de regra na rota DDA sem binding deferido: 1 → 0
- **Risco de não fazer**: baixo; sintoma seria pedido de ajuste fino em HML sem janela de deploy.
- **Dependências**: nenhuma.

### [modifiability-5] Consolidar paginadores (`PaginacaoTabela` × `Paginacao` legado)

- **Problema**
  > A pasta `app/sispag/` passa a ter dois paradigmas de paginação ao mesmo tempo: `PaginacaoTabela` (server-side, `onPagina(p)`) e `Paginacao` legado de `app/permutas/components/tabela-filtro.tsx` (client-side, `setPagina(fn)`), consumido ainda por `page.tsx` (5 pontos: linhas 1253, 1648, 1698, 1757, 1873), `recebimentos/*` e `permutas/*`. É transitório esperado mas não registrado.

- **Melhoria Proposta**
  > Mapear as abas que ainda usam o legado e, aba a aba, migrar para `PaginacaoTabela` quando a lista virar server-paginated. Registrar em `ontology/_inbox/migration-debt.md` com a lista das abas pendentes. Tactic: **Abstract Common Services**.

- **Resultado Esperado**
  > Um único contrato de paginação em `app/sispag/`. Mudanças de UX no rodapé = um arquivo.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: M (incremental, aba a aba)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Paginadores ativos em `app/sispag/`: 2 → 1
  - Pontos de uso do `Paginacao` legado em SISPAG: 5 → 0
- **Risco de não fazer**: débito acumulável; cada mudança visual precisa ser feita duas vezes.
- **Dependências**: cada aba migra quando seu backend aceitar paginação por servidor.

## 6. Notas do agente

- Decisão de escopo: revisão restrita ao delta do worktree; não medi fan-in global, cognitive-complexity Biome nem ciclos (fora do escopo da "reduced").
- F-modifiability-2 (tamanho de `routes/sispag.ts`) é **pré-existente**; o delta só agrava em +52 LOC. Mantido como P2 porque a fatura modifiability-wise vence a cada feature DDA.
- F-modifiability-4 (`let guardado`) foi uma decisão deliberada (Q7 da entrevista `sispag-dda-paridade`); registrei como P3 por divergir da aba-irmã (`useTabelaTitulos` persiste em URL) — alerta de **Testability** (vazamento entre renderizações se o helper `esquecerEstadoBoletosDda()` não for chamado).
- Cross-QA: F-modifiability-1 e [modifiability-1] também atingem **Testability** (grep por consumidores da aba fica mais barato); F-modifiability-5 e [modifiability-4] atingem **Deployability** (regra configurável = sem redeploy); F-modifiability-2 e [modifiability-2] atingem **Testability** (arquivo gigante dificulta cobertura focada).
- Pontos positivos do delta: a extração dos 5 pedaços shared é **real** (ambas as abas consomem), `BoletosDdaTab.tsx` encolheu 50% (592 → 296), `ConsolidacaoBoletoDdaCache` segue o padrão `withClock` com single-flight correto. Score 7,5 reflete isso.
