---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-06-1506-sispag-lotes-vencimento-mover
agent: qa-modifiability
generated_at: 2026-10-06T15:30:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review (delta 1e68bd7..HEAD)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista / Kavex | Mudar a regra de agrupamento de lotes (ex.: filial x vencimento -> filial x vencimento x banco) ou o teto de 25 | `FormacaoLotesService` | Desenvolvimento | Alteração localizada em `agrupar`/`fatiar` | 1 arquivo de produção + 1 teste; 0 mudanças em repositório/frontend |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `LotePagamentoService.ts` | 651 (era 607, +44) | <= 600 | ❌ (já estava acima) | `wc -l` |
| LOC `LotePagamentoRepository.ts` | 1144 (era 1060, +84) | <= 600 | ❌ | `wc -l` |
| LOC `app/sispag/page.tsx` | 1332 (era 1333, -1) | <= 600 | ❌ (delta neutro) | `wc -l` |
| LOC `LoteCard.tsx` (não tocado) | 1127 | <= 600 | ❌ | `wc -l` |
| LOC arquivos novos (hook, dialog, moverParaLote, erro) | 112 / 99 / 54 / 26 | <= 150 | ✅ | `wc -l` |
| LOC `FormacaoLotesService.ts` | 168 | <= 400 | ✅ | `wc -l` |
| Imports `LotePagamentoService.ts` | 26 | <= 15 | ⚠️ (+1 no delta) | `grep -c ^import` |
| Violações de camada no delta | 0 (service -> repo; rota só chama service) | 0 | ✅ | diff |
| Constantes de negócio hardcoded novas | 0 (reuso de `HORIZONTE_DIAS=7`, `MAX_TITULOS_POR_LOTE=25` já existentes) | 0 novas | ✅ | `FormacaoLotesService.ts:18-20` |
| Lógica de UI extraída p/ função pura testável | sim (`moverParaLote.ts` + teste, `useCriarLoteManual`) | sim | ✅ | diff |

Top-10 maiores arquivos / fan-in global: não recoletado (fora do delta); ver run anterior. Seams relevantes do delta: Repository 1144, page 1332, Service 651.

## 3. Tactics — Cobertura (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Frontend extraiu hook/dialog/função pura; backend continua inchando Service/Repository | ⚠️ parcial | page.tsx -1 LOC; Repository +84 |
| Increase Semantic Coherence | `fatiar`/`agrupar`/`retirarDaOrigem` pequenos e nomeados; `incluirTitulo` agora mistura incluir+mover+bloqueio | ⚠️ parcial | `LotePagamentoService.ts:277-340` |
| Encapsulate | Erro de domínio tipado `TitleInCommittedBatchError`; SQL de mover atrás de métodos do repo | ✅ | `TitleInCommittedBatchError.ts` |
| Use an Intermediary | `BankingCalendar` injetado para o dia de vencimento | ✅ | `FormacaoLotesService.ts:41` |
| Restrict Dependencies | Camadas respeitadas | ✅ | diff |
| Refactor | `incluirTitulo` ganhou ramo; complexidade subiu | ⚠️ parcial | idem |
| Abstract Common Services | `retirarDaOrigem` reaproveita `removerItemDeRascunho`/`marcarManual`/`tocarLote`/`cancelarSeVazio` | ✅ | `LotePagamentoService.ts:350-368` |
| Defer Binding | Teto (25) e horizonte (7) seguem constantes de módulo; chave de agrupamento é string embutida | ⚠️ ausente (aceitável: regra estável por ADR-0064) | `FormacaoLotesService.ts:18-20,138` |

## 4. Findings

### F-modifiability-1: Service e Repository SISPAG seguem crescendo acima de 600 LOC
- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `LotePagamentoService.ts` (651), `LotePagamentoRepository.ts` (1144)
- **Evidência**: 607 -> 651 e 1060 -> 1144 neste delta; service com 26 imports.
- **Impacto técnico**: cada feature de lote toca os mesmos dois arquivos; conflito de merge e custo de leitura crescentes.
- **Impacto de negócio**: features SISPAG mais lentas, maior risco de regressão em fluxo de pagamento.
- **Métrica de baseline**: 651 LOC (alvo <= 600); repo 1144 (alvo <= 600).

### F-modifiability-2: `incluirTitulo` acumula três responsabilidades (bloquear comprometido, incluir, mover)
- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `LotePagamentoService.ts:277-340`
- **Evidência**: `origem` mutável capturada por closure dentro da transação; audit ramifica por `origem`.
- **Impacto técnico**: próximo ramo (ex.: mover entre filiais) exige editar o mesmo método; fica frágil.
- **Impacto de negócio**: baixo agora; sobe se mover ganhar regras.
- **Métrica de baseline**: 1 método, 3 caminhos; complexidade cognitiva não medida (lint não rodado neste review).

### F-modifiability-3: Chave de agrupamento e teto de lote embutidos em constantes de módulo
- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `FormacaoLotesService.ts:18-20,138`
- **Evidência**: `` `${t.filCod}:${dia}` ``; `MAX_TITULOS_POR_LOTE = 25`.
- **Impacto técnico**: mudança de regra = redeploy.
- **Impacto de negócio**: ajuste de regra pela operação depende de release.
- **Métrica de baseline**: 2 constantes, 0 externalizadas (já eram constantes antes do delta).

## 5. Cards Kanban

### [modifiability-1] Extrair mover/retirar de lote para serviço/repositório dedicado
- **Problema**
  > `LotePagamentoService` (651 LOC, 26 imports) e `LotePagamentoRepository` (1144 LOC) crescem a cada feature SISPAG; o delta somou +44 e +84.
- **Melhoria Proposta**
  > Split Module: mover `retirarDaOrigem` + `incluirTitulo(mover)` para `LoteMovimentacaoService` e queries de comprometido/remoção para repositório próprio, no próximo `/feature-tweak` que tocar esses arquivos.
- **Resultado Esperado**
  > Service 651 -> <= 450 LOC; repo 1144 -> <= 800 LOC.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1, F-modifiability-2
- **Métricas de sucesso**:
  - LOC service: 651 -> <= 450
  - Imports service: 26 -> <= 18
- **Risco de não fazer**: arquivos passam de 800/1300 LOC em 6 meses; toda mudança SISPAG conflita.
- **Dependências**: nenhuma

### [modifiability-2] Isolar o fluxo mover de `incluirTitulo`
- **Problema**
  > Três caminhos num método com variável mutável por closure.
- **Melhoria Proposta**
  > Refactor: `incluirTitulo` delega para `moverTitulo` quando `mover`; transação compartilhada via helper. Verificar `npm run lint` por complexidade > 15.
- **Resultado Esperado**
  > Método com 1 responsabilidade; sem `let origem` mutável.
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Caminhos por método: 3 -> 1
- **Risco de não fazer**: próximas regras de mover aumentam a complexidade.
- **Dependências**: modifiability-1 (opcional)

### [modifiability-3] Externalizar teto e horizonte de formação de lotes
- **Problema**
  > Teto 25 e horizonte 7d fixos em código.
- **Melhoria Proposta**
  > Defer Binding: ler via `EnvironmentProvider` com default atual, só se a operação pedir ajuste frequente.
- **Resultado Esperado**
  > Ajuste sem redeploy.
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Constantes de negócio hardcoded: 2 -> 0
- **Risco de não fazer**: baixo.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; top-10 globais de LOC/fan-in não recoletados.
- Lint de complexidade cognitiva não executado; F-2 é estimativa por leitura.
- Cross-QA: Split Module em Service/Repository liga a Testability; constantes (F-3) ligam a Deployability.
- Ponto positivo: ADR-0064 + testes novos (service, painel, rota, moverParaLote) mantêm a mudança localizada; nenhum P0/P1.
