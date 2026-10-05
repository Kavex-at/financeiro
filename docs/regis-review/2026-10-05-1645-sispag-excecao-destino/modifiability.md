---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-05-1645-sispag-excecao-destino
agent: qa-modifiability
generated_at: 2026-10-05T17:00:00-03:00
scope: all
score: 6.5
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Nova regra de destino de pagamento SISPAG (ex.: novo tipo de exceção, ADR-0060 após ADR-0054) | `DestinoPagamentoResolver`, `ExcecaoDestinoService`, `RemessaService`, `routes/sispag.ts`, página `/sispag` | Desenvolvimento, pipeline `/feature-tweak` | Mudança localizada nos serviços de destino, sem tocar remessa/painel/UI além do contrato | ≤ 5 arquivos de produção tocados; 0 funções novas com complexidade > 15 |

## 2. Métricas observadas

Escopo = arquivos de produção da feature (`git diff --name-only origin/main -- src`, sem testes) + novos `Excecao*`.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de produção tocados (src) | 22 (+3 novos Excecao*) | ≤ 15 por feature | ⚠️ | `git diff --name-only origin/main -- src` |
| Max LOC / arquivo no escopo | 1600 (`RemessaService.ts`) | ≤ 600 | ❌ | `wc -l` |
| Arquivos > 600 LOC no escopo | 7 de 13 medidos | 0 | ❌ | `wc -l` |
| LOC dos novos módulos de exceção | 354 / 174 / 474 | ≤ 400 | ✅ (Repository 474 ⚠️) | `wc -l` |
| Cognitive complexity > 15 (escopo prod) | 3 funções: Remessa:225 (93), Remessa:1010 (36), ConciliacaoRetorno:103 (57) | 0 | ❌ (pré-existentes; nenhuma nos arquivos Excecao*) | `npx biome lint` |
| Fan-out máx. | 30 imports (`routes/sispag.ts`); 29 (`RemessaService`) | ≤ 15 | ❌ | `grep -c '^import '` |
| Violação de camada rota → repository/client | 4 imports em `routes/sispag.ts:7-12` | 0 | ❌ (legado Express) | grep |
| Violação domain → lambda | 0 | 0 | ✅ | grep |
| Ciclos | não medido (sem madge) | 0 | ⚠️ não medível | — |
| Magic numbers em Excecao*/Resolver | 0 | 0 | ✅ | grep `const X = NN` |
| Drift de ontologia | `_index.json`/`_coverage.json` modificados no working tree | atualizados | ✅ (amostra não verificada em profundidade) | git status |

Top-10 maiores arquivos (escopo, prod):

| # | Arquivo | LOC | Imports |
|---|---|---|---|
| 1 | `domain/service/sispag/RemessaService.ts` | 1600 | 29 |
| 2 | `src/frontend/app/sispag/page.tsx` | 1296 | 29 |
| 3 | `src/frontend/lib/sispag.ts` | 1265 | 3 |
| 4 | `routes/sispag.ts` | 991 | 30 |
| 5 | `src/frontend/app/sispag/components/LoteCard.tsx` | 923 | 17 |
| 6 | `domain/repository/sispag/LotePagamentoRepository.ts` | 855 | 5 |
| 7 | `domain/service/sispag/SispagPainelService.ts` | 665 | 20 |
| 8 | `domain/interface/sispag/SispagInterface.ts` | 643 | 0 |
| 9 | `domain/repository/sispag/ExcecaoDestinoRepository.ts` | 474 | n/m |
| 10 | `domain/service/sispag/LotePagamentoService.ts` | 484 | 18 |

Top fan-in no escopo (arquivos de produção importadores; o repo inteiro não foi varrido):

| # | Módulo | Fan-in |
|---|---|---|
| 1 | `LotePagamentoRepository` | 9 |
| 2 | `ExcecaoDestinoRepository` | 5 |
| 3 | `SispagPainelService` | 3 |
| 4 | `DestinoPagamentoResolver` | 3 |
| 5 | `LotePagamentoService` | 2 |
| 6 | `RemessaService` | 2 |
| 7 | `ExcecaoDestinoService` | 2 |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Exceção nasceu em 3 módulos próprios (Service, Substituição, Repository); `RemessaService` segue monolítico | ⚠️ parcial | `wc -l` |
| Increase Semantic Coherence | `ExcecaoDestinoService` e `ExcecaoSubstituicaoService` separados; remoção de `DestinoAprovacaoRule` simplificou a regra | ✅ | diff do escopo |
| Encapsulate | `DestinoPagamentoResolver` centraliza a decisão de destino; `LotePagamentoApiView` projeta a visão | ✅ | `DestinoPagamentoResolver.ts` |
| Use an Intermediary | Resolver entre Remessa/Painel e Repository | ✅ | 3 consumidores |
| Restrict Dependencies | Rotas importam repositories/client diretamente | ❌ | `routes/sispag.ts:7-12` |
| Refactor | 3 funções com complexidade 36–93 sem refactor | ❌ | Biome |
| Abstract Common Services | Executors/EnvironmentProvider reaproveitados; flags de destino via `EnvironmentVars` | ✅ | `EnvironmentProvider.ts` |
| Defer Binding | Flags em env (EnvironmentProvider), DI tsyringe; sem tokens/polimorfismo (um destino por vez) | ⚠️ parcial | grep `container.register` |

## 4. Findings

### F-modifiability-1: `RemessaService` é hotspot de mudança (1600 LOC, 2 funções de complexidade 93 e 36)
- **Severidade**: P1
- **Tactic violada**: Split Module / Refactor
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:225`, `:1010`
- **Evidência (objetiva)**: `Excessive complexity of 93 detected (max: 15)`; 1600 LOC, 29 imports; 10 menções a Excecao/destino dentro dele.
- **Impacto técnico**: toda regra de destino ou de remessa passa por aqui; ramificações profundas tornam regressão provável.
- **Impacto de negócio**: cada regra bancária nova custa mais e arrisca remessa errada no pagamento.
- **Métrica de baseline**: 1600 LOC (alvo ≤ 600), complexidade 93 (alvo ≤ 15), 2 consumidores diretos.

### F-modifiability-2: `routes/sispag.ts` pula a camada de serviço
- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/routes/sispag.ts:7-12`, 991 LOC, 30 imports
- **Evidência (objetiva)**: importa `ConexosSispagClient` e 3 repositories diretamente.
- **Impacto técnico**: mudança de esquema ou de client propaga até a rota; a migração para Lambda herda o acoplamento.
- **Impacto de negócio**: aumenta o custo da migração Express→Lambda prevista.
- **Métrica de baseline**: 4 imports proibidos; 30 imports (alvo ≤ 15). Legado listado em migration-debt.

### F-modifiability-3: Frontend SISPAG concentrado em 3 arquivos > 1200 LOC
- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `app/sispag/page.tsx` (1296), `lib/sispag.ts` (1265), `components/LoteCard.tsx` (923)
- **Evidência (objetiva)**: `wc -l`; page.tsx tem 29 imports.
- **Impacto técnico**: o diálogo novo de destino (`InformarDestinoDialog`) foi isolado, mas a tela principal continua monolítica.
- **Impacto de negócio**: toda feature da frente II toca os mesmos arquivos e gera conflitos de merge entre sessões paralelas.
- **Métrica de baseline**: 3 arquivos > 900 LOC.

### F-modifiability-4: `ExcecaoDestinoRepository` (474 LOC) e `LotePagamentoRepository` (855 LOC, 27 métodos públicos, fan-in 9)
- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `domain/repository/sispag/`
- **Evidência (objetiva)**: 27 métodos públicos em um repositório com 9 importadores.
- **Impacto técnico**: qualquer alteração de schema do lote reverbera em 9 arquivos.
- **Impacto de negócio**: baixo no curto prazo; custo cresce a cada frente.
- **Métrica de baseline**: 855 LOC, fan-in 9.

## 5. Cards Kanban

### [modifiability-1] Dividir `RemessaService` por responsabilidade e reduzir complexidade

- **Problema**
  > `RemessaService` tem 1600 LOC e duas funções com complexidade 93 e 36; é o ponto onde toda regra de destino converge.
- **Melhoria Proposta**
  > Split Module em geração de CNAB, resolução de destino/elegibilidade e envio; Refactor das duas funções em passos nomeados (guard clauses, tabelas de regra). Em `domain/service/sispag/`, guiado pelos testes existentes.
- **Resultado Esperado**
  > Max LOC do serviço 1600 → ≤ 600 por arquivo; complexidade 93 → ≤ 15 por função.
- **Tactic alvo**: Split Module, Refactor
- **Severidade**: P1
- **Esforço estimado**: L
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC máx. do módulo: 1600 → ≤ 600
  - Funções com complexidade > 15: 2 → 0
- **Risco de não fazer**: cada regra bancária nova sobre o mesmo arquivo eleva a chance de regressão em remessa real.
- **Dependências**: nenhuma; fazer em `/feature-tweak` dedicado, com a suíte de remessa verde antes.

### [modifiability-2] Mover acesso a repository/client de `routes/sispag.ts` para serviços

- **Problema**
  > A rota importa 3 repositories e 1 client direto, com 30 imports e 991 LOC.
- **Melhoria Proposta**
  > Restrict Dependencies: criar serviços (ou estender os existentes) para essas leituras e quebrar a rota por sub-recurso (lotes, remessa, destino/exceção).
- **Resultado Esperado**
  > Imports proibidos 4 → 0; imports por arquivo 30 → ≤ 15.
- **Tactic alvo**: Restrict Dependencies, Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Violações de camada: 4 → 0
  - Fan-out de `routes/sispag.ts`: 30 → ≤ 15
- **Risco de não fazer**: a migração para Lambda carrega o acoplamento para cada handler.
- **Dependências**: migration-debt (migração proporcional).

### [modifiability-3] Fatiar a tela SISPAG do frontend

- **Problema**
  > `page.tsx`, `lib/sispag.ts` e `LoteCard.tsx` somam 3484 LOC em três arquivos.
- **Melhoria Proposta**
  > Split Module: extrair hooks de dados por aba, dividir `lib/sispag.ts` por domínio (lotes, remessa, destino/exceção), e seguir o padrão do `InformarDestinoDialog`.
- **Resultado Esperado**
  > Arquivos > 900 LOC: 3 → 0.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3, F-modifiability-4
- **Métricas de sucesso**:
  - Max LOC frontend SISPAG: 1296 → ≤ 600
- **Risco de não fazer**: conflitos de merge recorrentes e UI de difícil extensão.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo = arquivos da feature; o fan-in conta só importadores de produção dentro de `src/backend` (grep, sem madge). Ciclos não medidos.
- As 3 funções acima do limite de complexidade são pré-existentes; nenhum módulo `Excecao*` novo gera warning, e eles nasceram em ≤ 474 LOC (positivo).
- Cross-QA: `RemessaService` (Testability: difícil de testar isolado), rotas pulando camada (Integrability); flags de destino em env (Deployability: alterar exige redeploy).
- `InformarDestinoDialog.tsx` aparece no diff mas não existe no worktree (provável rename/remoção); não medido.
