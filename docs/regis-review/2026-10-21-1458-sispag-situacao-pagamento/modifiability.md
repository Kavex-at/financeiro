---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-21-1458
agent: qa-modifiability
generated_at: 2026-10-21T14:58:00-03:00
scope: all
score: 8
findings_count: 7
cards_count: 7
---

# Modifiability — Regis-Review (PR #128, sispag-situacao-pagamento)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista Columbia / produto (Yuri) | Pedido de novo `MOTIVO_PAGAMENTO` ou mudança de rótulo de bloqueio | `SituacaoPagamentoResolver` + contrato espelhado FE/BE + rótulos de chip | Dev, feature ativa em produção com dados de 20+ filiais | A regra é alterada em UM ponto; a tela, a inclusão manual, a formação automática e o `POST /sispag/lotes/por-filial` passam a ler o mesmo motivo sem edição duplicada | Diff tocando ≤ 5 arquivos; type-checker força o fechamento dos `Record<MotivoPagamento, X>`; teste de paridade falha se BE e FE divergirem em valor de enum |

> Alvo canônico Bass para esta família (modificar regra de domínio *leve*): o número de arquivos tocados é o proxy barato do custo. Para esta feature, o número está em 5–6 arquivos — detalhado em §2.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Nº de pontos de verdade da regra "está pagável?" | 1 (`SituacaoPagamentoResolver.avaliar`) | 1 | ✅ | `grep -rn SituacaoPagamentoResolver src/backend --include='*.ts' \| grep -v test` → 5 refs, só 1 cliente (`SituacaoPagamentoService`) |
| Nº de callers do `SituacaoPagamentoService` (painel, inclusão manual, formação auto, por-filial, job) | 4 em produção + 1 job | ≤ 5 | ✅ | `grep -rn SituacaoPagamentoService src/backend` → `SispagPainelService`, `LotePagamentoService`, `FormacaoLotesService`, job validate |
| Nº de arquivos a tocar para adicionar um `MOTIVO_PAGAMENTO` novo | 5 (contrato BE, resolver BE, mirror FE `lib/sispag.ts`, `rotulos.ts`, teste de paridade cobre; +1 se precisa de nova `AcaoPagamento`) | ≤ 6 | ✅ | contagem manual sobre `SituacaoPagamento.ts`, `SituacaoPagamentoResolver.ts`, `src/frontend/lib/sispag.ts`, `src/frontend/app/sispag/situacao/rotulos.ts` |
| Paridade enum BE↔FE testada automaticamente | Sim — `src/frontend/lib/sispag.test.ts:747-772` lê o fonte do backend e compara `ESTADO/MOTIVO/SUGESTAO/DONO/ACAO/FONTE/RESULTADO_LOTE_FILIAL` | Sim | ✅ | `src/frontend/lib/sispag.test.ts:759-771` |
| Paridade **de rótulos** BE (`PERFIL[m].rotulo`) ↔ FE (`ROTULO_MOTIVO[m]`) testada | **Não** — rotulos diferem em ≥3 motivos (`TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `RETIDO_CODBAR`) | Paridade documentada ou teste explícito | ⚠️ | `SituacaoPagamentoResolver.ts:77-126` vs `rotulos.ts:21-31` |
| Janela de formação (dias) com um ponto de verdade | **Duplicada**: `HORIZONTE_DIAS = 7` em `FormacaoLotesService.ts:19` e `JANELA_FORMACAO_DIAS = 7` em `situacaoTitulos.ts:246` | Uma constante contratual ou endpoint que a tela leia | ⚠️ | `grep -rn HORIZONTE_DIAS\|JANELA_FORMACAO` src |
| LOC do maior arquivo novo da fatia | 427 (`TabelaTitulos.tsx`) | ≤ 400 (preferência), ≤ 600 (teto) | ⚠️ | `wc -l src/frontend/app/sispag/situacao/TabelaTitulos.tsx` |
| LOC do maior serviço impactado | 832 (`LotePagamentoService.ts`, +135 no PR) | ≤ 600 | ❌ (herdado; o PR acrescentou 135 LOC a um arquivo que já estava fora do budget) | `wc -l src/backend/domain/service/sispag/LotePagamentoService.ts` |
| Deps injetadas no `SituacaoPagamentoService` | 8 | ≤ 7 (regra prática Kavex) | ⚠️ | `grep -c @inject src/backend/domain/service/sispag/SituacaoPagamentoService.ts` |
| Deps injetadas no `LotePagamentoService` | 11 | ≤ 7 | ❌ (herdado; o PR acrescentou **1** — `situacaoPagamento`) | `grep -c @inject src/backend/domain/service/sispag/LotePagamentoService.ts` |
| Warnings de `noExcessiveCognitiveComplexity` nos arquivos do delta | 0 | 0 | ✅ | `cd src/backend && npm run lint 2>&1 \| grep -B1 cognitive` → zero hit em arquivos do delta |
| Dependências cíclicas no subgrafo `sispag/*` | 0 (resolver não importa do service; service importa do resolver; callers do service são 3 serviços sem reciprocidade) | 0 | ✅ | inspeção manual + `grep -rn "from .*SituacaoPagamentoService"` |
| Imports do maior componente FE | 20 em `TabelaTitulos.tsx` | ≤ 15 (preferência) | ⚠️ | `grep -c '^import' src/frontend/app/sispag/situacao/TabelaTitulos.tsx` |
| Teste de completude das tabelas `rotulos.ts` (todo motivo tem rótulo/dono/ação/efeito) | Presente — `rotulos.test.ts:21-26` | Presente | ✅ | `src/frontend/app/sispag/situacao/rotulos.test.ts` |

### Appendix A — Top-10 maiores arquivos do delta (prod only)

| # | Arquivo | LOC | Papel |
|---|---|---:|---|
| 1 | `src/backend/domain/service/sispag/LotePagamentoService.ts` | 832 | Serviço (herdado, +135 no PR) |
| 2 | `src/backend/domain/service/sispag/SispagPainelService.ts` | 551 | Serviço (herdado, +25 no PR) |
| 3 | `src/frontend/app/sispag/situacao/TabelaTitulos.tsx` | 427 | Componente novo |
| 4 | `src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts` | 352 | **Novo — núcleo da regra** |
| 5 | `src/frontend/app/sispag/situacao/situacaoTitulos.ts` | 308 | Lógica pura FE (filtro/ordem/cards) |
| 6 | `src/frontend/components/ui/column-header-filter.tsx` | 284 | Componente de UI (reusável) |
| 7 | `src/frontend/app/sispag/situacao/TitulosAbaSituacao.tsx` | 265 | Composição da aba |
| 8 | `src/backend/domain/service/sispag/SituacaoPagamentoService.ts` | 195 | Orquestrador I/O da situação |
| 9 | `src/backend/domain/service/sispag/FormacaoLotesService.ts` | 197 | Serviço (herdado, +43 no PR) |
| 10 | `src/frontend/app/sispag/situacao/AcaoDoTitulo.tsx` | 170 | Componente de ação |

### Appendix B — Fan-in dos símbolos centrais da fatia

| Símbolo | Importado por | Observação |
|---|---:|---|
| `SituacaoPagamentoResolver` (BE) | 1 arquivo de produção (`SituacaoPagamentoService`) | Mudar a regra tem alcance mínimo — exatamente o alvo da fatia |
| `SituacaoPagamentoService` (BE) | 4 arquivos de produção (`SispagPainelService`, `LotePagamentoService`, `FormacaoLotesService`, `jobs/validate-situacao-pagamento-v1`) | Fan-in moderado, intencional |
| `MOTIVO_PAGAMENTO` (contrato) | 11 arquivos (BE + FE) | Enum espelhado; paridade testada |
| `ROTULO_MOTIVO` (FE) | 5 arquivos (`FiltroSituacaoBarra`, `RegrasSituacao`, `ResultadoLotesDialog`, `filtrosAtivos`, `situacaoTitulos`) | Tabela de UI complementar ao `PERFIL[*].rotulo` do BE |
| `JANELA_FORMACAO_DIAS` (FE) | 2 arquivos (`situacaoTitulos`, `PreviaLotesAutomaticos`) | Duplica `HORIZONTE_DIAS` do BE |
| `ROTULO_DONO` (FE) | 2 arquivos (`TabelaTitulos`, `filtrosAtivos`) | Record completo, type-checked |
| `ChaveTitulo` util `chaveDe` | definido 3× (resolver, service, painel) | Micro-duplicação (3 cópias idênticas de `${filCod}:${docCod}:${titCod}`) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass & Clements) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | O resolver nasceu puro e pequeno (352 LOC) e **não** foi absorvido pelo painel/lote/formação — foi extraído como classe separada. `SituacaoPagamentoService` (195 LOC) orquestra I/O separado da regra | ✅ presente | `SituacaoPagamentoResolver.ts` + `SituacaoPagamentoService.ts` |
| **Increase Semantic Coherence** | Uma classe por eixo: *regra* (`Resolver`), *carregamento de fontes* (`Service`), *consumo* (3 serviços chamadores). Dentro do resolver, uma `Regra` por motivo (`regraAlcada`, `regraTipoPermuta`, …) | ✅ presente | `SituacaoPagamentoResolver.ts:199-294` |
| **Encapsulate** | O contrato BE↔FE encapsulado em `SituacaoPagamento.ts` + mirror em `src/frontend/lib/sispag.ts`, com teste de paridade por reflexão | ✅ presente | `src/frontend/lib/sispag.test.ts:747-772` |
| **Use an Intermediary** | `SituacaoPagamentoService` é o intermediário entre o resolver puro e os 3 callers; `ContextoSituacaoPagamento` é a interface do contexto que o resolver recebe (desacopla fontes) | ✅ presente | `SituacaoPagamentoResolver.ts:59-68` |
| **Restrict Dependencies** | Resolver não importa de repository/client; depende só de interfaces e libs. DDD mantido: a nova rota (`sispag.ts:272-305`) chama service, não repository | ✅ presente | `SituacaoPagamentoResolver.ts` imports (7 arquivos, nenhum repository/client) |
| **Refactor** | `LotePagamentoService` já tinha 697 LOC + 10 deps antes do PR; recebeu +135 LOC (nova `criarLotesPorFilial`) e +1 dep (`SituacaoPagamentoService`). Não houve refactor compensatório | ⚠️ parcial | `LotePagamentoService.ts:238-325` (bloco novo) |
| **Abstract Common Services** | `chaveDe(t) = ${filCod}:${docCod}:${titCod}` reaparece em 3 arquivos (`Resolver`, `Service`, `PainelService`); tabela de rótulos de motivo existe em dois lugares com texto parcialmente divergente (BE `PERFIL[*].rotulo` ≠ FE `ROTULO_MOTIVO[*]`) | ⚠️ parcial | `SituacaoPagamentoResolver.ts:166-167`; `SituacaoPagamentoService.ts:26-27`; `SispagPainelService.ts:132-133` |
| **Defer Binding — polymorphism / registration** | tsyringe por toda a camada; resolver injetado por token de classe. 0 interfaces com múltiplas impls — intencional (domínio bounded) | ✅ presente | `@injectable()` em todos os serviços novos |
| **Defer Binding — configuration** | Janela da formação (`HORIZONTE_DIAS = 7`), lock advisory (`FORMACAO_LOCK_KEY`), rótulos user-facing, textos de "orientação no Conexos" — todos hardcoded. Mudar um = redeploy | ❌ ausente | `FormacaoLotesService.ts:19,21`; `rotulos.ts:108-126` |

## 4. Findings (achados)

### F-modifiability-1: Rótulo de motivo diverge entre backend (`PERFIL[m].rotulo`) e frontend (`ROTULO_MOTIVO[m]`), sem teste de paridade

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**:
  - `src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts:77-126`
  - `src/frontend/app/sispag/situacao/rotulos.ts:21-31`
  - `src/frontend/lib/sispag.test.ts:747-772` (paridade cobre valores de enum, **não** cobre rótulos)
- **Evidência (objetiva)**:
  ```
  Backend PERFIL              Frontend ROTULO_MOTIVO
  TIPO_PERMUTA     'Título de permuta'          'Permuta ou adiantamento'
  FORMA_NAO_SISPAG 'Forma de pagamento fora…'   'Forma não paga por SISPAG'
  RETIDO_CODBAR    'Retido por código de barras' 'Retido por boleto repetido'
  AJUSTE_CENTAVOS  acao: 'Tentar de novo o ajuste' / ROTULO_ACAO[TENTAR_AJUSTE]: 'Tentar o ajuste de novo'
  DUPLICIDADE      acao: 'Tratar duplicidade'   / ROTULO_ACAO[TRATAR_DUPLICIDADE]: 'Tratar alerta'
  ```
  A linha da tabela usa o `rotulo` que vem do backend (`SituacaoPagamento.rotulo`), mas o chip do filtro, o diálogo de resultado e a tabela de regras usam `ROTULO_MOTIVO`. O usuário vê "Título de permuta" na linha e "Permuta ou adiantamento" no chip — texto diferente para o mesmo estado.
- **Impacto técnico**: Quando a analista pedir "renomear bloqueio X", o dev conserta um lado e esquece o outro — a divergência só aparece em QA visual. Não há teste que falhe. Em 3 motivos a divergência já existe.
- **Impacto de negócio**: Confunde o operador sob pressão (reunião de pagamento às 10:30 — chip diz uma coisa, linha diz outra). Não trava pagamento.
- **Métrica de baseline**: 3 pares de rótulos divergentes de 9 motivos (33%).

### F-modifiability-2: `HORIZONTE_DIAS` (BE) e `JANELA_FORMACAO_DIAS` (FE) são a mesma política em dois arquivos, sem contrato

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services + Defer Binding (configuration)
- **Localização**:
  - `src/backend/domain/service/sispag/FormacaoLotesService.ts:19`
  - `src/frontend/app/sispag/situacao/situacaoTitulos.ts:246`
  - `src/frontend/app/sispag/situacao/PreviaLotesAutomaticos.tsx:52`
- **Evidência**:
  ```
  // BE: const HORIZONTE_DIAS = 7;
  // FE: export const JANELA_FORMACAO_DIAS = 7
  ```
  A tela mostra "Só entram títulos a vencer de hoje a {JANELA_FORMACAO_DIAS} dias" na prévia. Se o produto diminuir para 5 ou subir para 10, o dev precisa lembrar dos dois.
- **Impacto técnico**: Mudança unilateral vira prévia que mente — a analista vê 7 dias listados, mas o servidor forma lote só até 5.
- **Impacto de negócio**: Baixo em frequência (a janela é estável), alto em confiança quando mentir.
- **Métrica de baseline**: 1 constante replicada em 2 arquivos; 0 teste cruzado.

### F-modifiability-3: `LotePagamentoService` cresceu para 832 LOC e 11 deps, sem split

- **Severidade**: P2
- **Tactic violada**: Split Module + Refactor
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts` (832 LOC, 13 métodos públicos)
- **Evidência**:
  ```
  Métodos públicos: criarLote, atualizarContaPagadora, atualizarModalidadeItem,
    listarLotes, getLote, criarLotesPorFilial (NOVO), incluirTitulo, removerTitulo,
    retirarDoLote, finalizarLote, reabrirLote, cancelarLote
  @inject: 11 (repo, tituloRepo, conexos, db, logService, verificacao, contaResolver,
    alertaRepo, bloqueioRepo, environmentProvider, situacaoPagamento)
  ```
  O PR adicionou 135 LOC (`criarLotesPorFilial`, `criarLoteDaFilial`, `recusaDe`, `exigirSituacaoPagavel`) e **+1 dep** (`SituacaoPagamentoService`). O novo caminho orquestra `criarLote → incluirTitulo (N)` com erro-por-item; a cola é curta (orquestração), mas o host já era hotspot.
- **Impacto técnico**: Testes do serviço estão em 1 arquivo de 228 LOC novas + 44 testes totais; cobertura ampla mas qualquer sintoma novo mergulha num arquivo de ~900 LOC.
- **Impacto de negócio**: Baixo hoje — a feature funciona, 44 testes, PatternGuardian verde. Alto se outro endpoint vier (ex.: lote-por-prioridade, lote-por-credor) e o arquivo cruzar 1000 LOC.
- **Métrica de baseline**: 832 LOC (alvo ≤ 600); 11 `@inject` (alvo ≤ 7).

### F-modifiability-4: `TabelaTitulos.tsx` concentra 8 cabeçalhos-de-coluna com JSX repetitivo em 427 LOC

- **Severidade**: P2
- **Tactic violada**: Reduce Size of Module
- **Localização**: `src/frontend/app/sispag/situacao/TabelaTitulos.tsx` (427 LOC, 20 imports)
- **Evidência**: 8 blocos `<ColumnHeaderFilter {...}>` idênticos em formato (ver linhas 145-258), cada um com `comum(c)`, `ativo`, `onLimpar`, filtro interno — ~15 LOC × 8 = 120 LOC só de cabeçalhos. O corpo da linha (`TableBody`) traz outras ~125 LOC, com três ramos condicionais aninhados para `loteRascunho / loteComprometido / retido / acaoPropria` (linhas 294-383).
- **Impacto técnico**: Adicionar uma coluna (ex.: "Banco" ou "Centro de custo") = tocar neste único arquivo e no `useTabelaTitulos` + `situacaoTitulos.ts`. Hoje é factível, mas o arquivo tende a crescer a cada ADR novo.
- **Impacto de negócio**: Baixo — é um componente apresentacional coberto por `TitulosAbaSituacao.test.tsx` (382 LOC).
- **Métrica de baseline**: 427 LOC (alvo ≤ 400); 20 imports; 8 cabeçalhos inline.

### F-modifiability-5: `SituacaoPagamentoService` orquestra 4 fontes com 8 deps, sem fachada

- **Severidade**: P3
- **Tactic violada**: Encapsulate + Reduce Coupling
- **Localização**: `src/backend/domain/service/sispag/SituacaoPagamentoService.ts:46-57`
- **Evidência**:
  ```
  @inject: resolver, bloqueioRepo, ajusteRepo, boleto, env, logService, tituloRepo, calendar
  carregarContexto() faz 4 leituras paralelas (bloqueios/ajustes/desfechos/env)
  ```
  Cada fonte é um `this.ler(fonte, …)` com try/catch que popula `fontesIndisponiveis`. O desenho é consciente (fail-soft por fonte), mas o número de deps acumula.
- **Impacto técnico**: Nova fonte (ex.: "sanção OFAC do credor") = +1 dep e +1 bloco em `carregarContexto`. Sem fachada, cada caller "ouve" o aumento (o service continua sendo o único consumidor, então o impacto é contido — mas a classe cresce).
- **Impacto de negócio**: Zero hoje.
- **Métrica de baseline**: 8 `@inject` (alvo ≤ 7); 4 fontes.

### F-modifiability-6: `chaveDe({filCod, docCod, titCod})` reimplementado em 3 arquivos

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**:
  - `src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts:166-167`
  - `src/backend/domain/service/sispag/SituacaoPagamentoService.ts:26-27`
  - `src/backend/domain/service/sispag/SispagPainelService.ts:132-133`
  - `src/backend/domain/service/sispag/LotePagamentoService.ts:73-74` (`chaveItem` com nome diferente)
  - `src/frontend/app/sispag/situacao/situacaoTitulos.ts:96-97` (`chaveDoTitulo`)
- **Evidência**: 5 cópias idênticas de `` `${filCod}:${docCod}:${titCod}` ``. O FE pode ser perdoado (sem import cross-root), mas as 4 do BE deveriam estar em `SispagInterface` ou um util.
- **Impacto técnico**: Mudar o separador (improvável mas simbólico) exige 5 edits sincronizadas.
- **Impacto de negócio**: Zero.
- **Métrica de baseline**: 5 reimplementações.

### F-modifiability-7: Janela da formação, chaves de advisory lock e textos de orientação ao Conexos hardcoded no código (não configuração)

- **Severidade**: P3
- **Tactic violada**: Defer Binding (configuration)
- **Localização**:
  - `src/backend/domain/service/sispag/FormacaoLotesService.ts:19,21` (`HORIZONTE_DIAS`, `FORMACAO_LOCK_KEY`)
  - `src/frontend/app/sispag/situacao/rotulos.ts:86-126` (`EFEITO_MOTIVO`, `ORIENTACAO_NO_CONEXOS`)
- **Evidência**: Nenhuma leitura via `EnvironmentProvider`/SSM; mudar vocabulário ou janela = redeploy FE+BE em lockstep.
- **Impacto técnico**: Cada ajuste de texto do produto consome um release.
- **Impacto de negócio**: Baixíssimo em frequência; alto em custo-por-pedido quando o produto pede "trocar a palavra 'alçada' por 'liberação'".
- **Métrica de baseline**: 0 constantes de regra de negócio em config; ≥ 3 strings user-facing hardcoded só nesta fatia.

## 5. Cards Kanban

### [modifiability-1] Testar paridade dos rótulos de motivo entre BE (`PERFIL`) e FE (`ROTULO_MOTIVO`)

- **Problema**
  > A linha da tabela usa `situacao.rotulo` vindo do backend (`PERFIL[m].rotulo`), mas o chip do filtro, o diálogo de resultado e a tabela de regras usam `ROTULO_MOTIVO[m]` do frontend. Hoje já há 3 pares divergentes (`TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `RETIDO_CODBAR`) e nada avisa o dev que a divergência existe.

- **Melhoria Proposta**
  > Estender o teste de paridade de `src/frontend/lib/sispag.test.ts` para extrair o `PERFIL` do fonte do resolver (regex, do mesmo jeito que já faz com `PAGO_POR_CONEXOS_ROTULO`) e comparar `PERFIL[m].rotulo` com `ROTULO_MOTIVO[m]`. Documentar a política no cabeçalho de `rotulos.ts`: se o texto for intencionalmente diferente (chip vs linha), listar o motivo e marcar como `rotuloChip` separado. **Tactic**: Abstract Common Services.

- **Resultado Esperado**
  > Divergências de rótulo quebram CI (Backend ou Frontend) em vez de aparecer em QA visual. `3 pares divergentes → 0`.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Pares de rótulos divergentes sem anotação: 3 → 0
  - Teste de paridade cobrindo rótulos: ausente → presente
- **Risco de não fazer**: Divergência silenciosa prolifera a cada motivo novo; retrabalho de QA visual permanente.
- **Dependências**: nenhuma

### [modifiability-2] Unificar `HORIZONTE_DIAS` / `JANELA_FORMACAO_DIAS` em um ponto de verdade

- **Problema**
  > A janela da formação automática está codada como `7` em dois lugares (`FormacaoLotesService.ts:19` e `situacaoTitulos.ts:246`). A tela promete 7 dias na prévia; o servidor forma até 7 dias. Mudar um sem o outro vira prévia mentindo.

- **Melhoria Proposta**
  > Opção A: expor via `GET /sispag/painel` um campo `janelaFormacaoDias` que o FE leia (contrato runtime; vale também pra tirar config do código no futuro). Opção B: colocar a constante em `src/backend/domain/interface/sispag/SispagInterface.ts` e espelhar em `src/frontend/lib/sispag.ts` com teste de paridade. Preferir A — resolve F-modifiability-7 na mesma. **Tactic**: Abstract Common Services + Defer Binding (configuration).

- **Resultado Esperado**
  > A janela vem do servidor; a tela não guarda número. `2 cópias → 1 fonte (BE)`; mudar a janela não exige coordenar FE+BE no mesmo PR.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2, F-modifiability-7
- **Métricas de sucesso**:
  - Cópias da constante: 2 → 1
  - Fonte da janela: código BE+FE → `GET /sispag/painel` (ou `SispagInterface.ts` + paridade)
- **Risco de não fazer**: Produto pede "diminuir para 5 dias" no sprint seguinte; prévia e realidade divergem até o dev lembrar das duas.
- **Dependências**: nenhuma

### [modifiability-3] Planejar o split do `LotePagamentoService` antes do próximo endpoint

- **Problema**
  > `LotePagamentoService.ts` chegou a 832 LOC com 11 deps e 13 métodos públicos: criar/atualizar/listar/get, incluir/remover/retirar, finalizar/reabrir/cancelar e agora `criarLotesPorFilial`. O PR adicionou 135 LOC e 1 dep sem refactor compensatório. O próximo endpoint (ex.: lote-por-prioridade, lote-por-credor) encosta no teto de 1000 LOC.

- **Melhoria Proposta**
  > Candidatos a extração, pela coerência semântica atual:
  > 1. `LoteLifecycleService` — `criarLote`, `finalizarLote`, `reabrirLote`, `cancelarLote`, `atualizarContaPagadora`.
  > 2. `LoteItemService` — `incluirTitulo`, `removerTitulo`, `retirarDoLote`, `exigirSituacaoPagavel`.
  > 3. `LoteQueryService` — `listarLotes`, `getLote`, `loteCompleto`.
  > O `criarLotesPorFilial` fica como orquestrador fino que compõe `LoteLifecycleService.criarLote` + `LoteItemService.incluirTitulo`. **Tactic**: Split Module + Increase Semantic Coherence.

- **Resultado Esperado**
  > `832 LOC em um arquivo → ~3 arquivos de 200–350 LOC`; `11 deps → 4–6 por classe`; o próximo endpoint não cresce o host.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M (refactor + mover testes do suite de 228 LOC do PR + mais 300 LOC prévios)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Maior arquivo: 832 LOC → ≤ 400 LOC
  - `@inject` por classe: 11 → ≤ 6
- **Risco de não fazer**: Em 2 features o arquivo cruza 1000 LOC; qualquer regressão exige snorkel.
- **Dependências**: Alinhar com PatternGuardian para não falhar durante o refactor.

### [modifiability-4] Extrair cabeçalhos de coluna repetidos em `TabelaTitulos.tsx`

- **Problema**
  > `TabelaTitulos.tsx` tem 427 LOC com 8 blocos `<ColumnHeaderFilter>` quase idênticos (credor, documento, valor, vencimento, forma, situação, próxima ação, filial). Cada nova coluna exige copiar ~15 LOC + ir no `useTabelaTitulos`.

- **Melhoria Proposta**
  > Mover a definição de coluna para um array declarativo tipado (`{ id, label, rotulosOrdem?, ativo, onLimpar, renderFiltro }`), iterar no `TableHeader`. A linha do `TableBody` pode seguir em um sub-componente `LinhaDoTitulo` recebendo as mesmas props que já são passadas. **Tactic**: Reduce Size of Module.

- **Resultado Esperado**
  > `427 LOC → ≤ 300 LOC`; adicionar coluna = 1 entrada em um array + 1 clause em `valorDaColuna`.

- **Tactic alvo**: Reduce Size of Module
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - LOC: 427 → ≤ 300
  - Blocos duplicados de cabeçalho: 8 → 1 iterador
- **Risco de não fazer**: Qualquer nova coluna acelera o crescimento do arquivo.
- **Dependências**: Testes já cobrem (`TitulosAbaSituacao.test.tsx`); refactor sem risco funcional.

### [modifiability-5] Encapsular as fontes do `SituacaoPagamentoService` em uma fachada

- **Problema**
  > O service tem 8 `@inject` e cada nova fonte (OFAC, verificação de credor, etc.) vira +1 dep. O padrão `this.ler(fonte, …)` já desacopla erro, mas não desacopla identidade.

- **Melhoria Proposta**
  > Criar `SituacaoContextoLoader` com uma interface que receba `env` e devolva `ContextoCarregado`. O service passa a injetar `[resolver, loader, calendar, tituloRepo, logService]` (5), e o loader concentra bloqueios/ajustes/desfechos/env. **Tactic**: Encapsulate + Use an Intermediary.

- **Resultado Esperado**
  > `8 deps → 5`; nova fonte não aparece na assinatura do service.

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - `@inject` no service: 8 → 5
  - Teste de "fonte indisponível" permanece no loader (não no service)
- **Risco de não fazer**: Baixo; serviço continua operável. Importa quando a quinta fonte entrar.
- **Dependências**: nenhuma

### [modifiability-6] Mover `chaveDe({filCod, docCod, titCod})` para um util

- **Problema**
  > 5 cópias (4 BE + 1 FE) de `` `${filCod}:${docCod}:${titCod}` ``.

- **Melhoria Proposta**
  > Adicionar `export const chaveTitulo = (c: ChaveTitulo): string => ...` em `src/backend/domain/interface/sispag/SispagInterface.ts` e espelhar em `src/frontend/lib/sispag.ts`. **Tactic**: Abstract Common Services.

- **Resultado Esperado**
  > `5 cópias → 1 BE + 1 FE`; busca por "`:${docCod}:${titCod}`" devolve 2 hits.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - Reimplementações: 5 → 2
- **Risco de não fazer**: Zero funcional; só higiene.
- **Dependências**: nenhuma

### [modifiability-7] Externalizar janela, lock-key e textos user-facing para configuração

- **Problema**
  > `HORIZONTE_DIAS = 7`, `FORMACAO_LOCK_KEY = 615243789` e `EFEITO_MOTIVO` / `ORIENTACAO_NO_CONEXOS` são hardcoded. Cada ajuste pedido pelo produto gasta um release.

- **Melhoria Proposta**
  > Janela e textos user-facing: expor via `/sispag/painel` (ou `/sispag/recursos`) em um campo `configSituacao`. Lock-key: deixar como constante compartilhada mas documentar que é imutável (quem muda arrisca double-run). **Tactic**: Defer Binding (configuration).

- **Resultado Esperado**
  > Mudar "renegociar vencimento no Conexos" para "renegociar no fin070" = PR no backend sem reinstalar o FE. Janela ajustada por produto sem redeploy do FE (resolve F-modifiability-2 por tabela).

- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-7
- **Métricas de sucesso**:
  - Strings user-facing hardcoded nesta fatia: 3+ → 0
  - Janela em `GET /sispag/painel`: ausente → presente
- **Risco de não fazer**: Baixa frequência de mudança, mas o custo-por-ciclo é alto quando acontece.
- **Dependências**: `[modifiability-2]` compõe parte desse esforço — fazer juntos.

## 6. Notas do agente

- SSoT da regra "está pagável?" **se sustenta**: `SituacaoPagamentoResolver.avaliar` é o único ponto chamado pelos 4 consumidores (painel, inclusão manual, formação automática, por-filial). `exigirSituacaoPagavel` falha fechada (`throw TituloNaoElegivelError`), então nenhum motivo duplicado pode deixar título bloqueado ser pago — por isso nenhum achado é P0/P1.
- Cross-QA: **F-modifiability-1/6** (Abstract Common Services) toca **Integrability** (contrato BE↔FE). **F-modifiability-3/4** (Reduce Size) toca **Testability** — testes já cobrem, mas arquivo grande = testes caros de ler. **F-modifiability-7** (magic numbers em regra de negócio) toca **Deployability** — cada ajuste de vocabulário = redeploy FE+BE em lockstep.
- Não medi coverage por falta de execução; não auditei `madge` por ausência de ferramenta — confirmei ausência de ciclos por inspeção do subgrafo `sispag/*`.
