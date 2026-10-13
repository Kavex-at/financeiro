---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-13-1518
agent: qa-modifiability
generated_at: 2026-10-13T15:40:00-03:00
scope: all
score: 7.5
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review

Escopo: apenas o delta de `fix/sispag-sync-ao-abrir` vs `origin/main` (modo --quick).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Mudar a política de atualização (TTL/cooldown) ou adicionar uma terceira fonte "stale-while-revalidate" na tela SISPAG | `SincronizacaoPassadaService`, `CarteiraAtualizacaoService`, `routes/sispag.ts`, `page.tsx`, `lib/sispag.ts` | Desenvolvimento, build-time | Mudança localizada em 1 service + 1 var de env, sem tocar rota/UI | <= 3 arquivos de produção tocados; 0 redeploy de código para ajustar TTL |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `SincronizacaoPassadaService.ts` (novo) | 270 | <= 600 | ✅ | `wc -l` |
| LOC `SincronizarLotesSispagJob.ts` | 49 (antes ~117 no diff, -68 linhas) | <= 150 | ✅ | `wc -l`, diff |
| LOC `routes/sispag.ts` (delta -> 1270 total) | 1270 (delta líquido ~ -8) | <= 600 | ❌ (pré-existente) | `wc -l` |
| LOC `frontend/lib/sispag.ts` | 1807 (+62 no delta) | <= 600 | ❌ (pré-existente, cresceu) | `wc -l`, `git diff --stat` |
| LOC `frontend/app/sispag/page.tsx` | 1582 (+~75 no delta) | <= 600 | ❌ (pré-existente, cresceu) | `wc -l` |
| Imports do novo service (fan-out) | 10 | <= 15 | ✅ | leitura do arquivo |
| Violações de camada no delta | 0 (rota -> Service; Job -> Service) | 0 | ✅ | leitura do diff |
| Números mágicos de regra de negócio | 0 (TTL/cooldown em env; `RUN_PRESA_MS`=10 min e `RUNS_CONSULTADAS`=5 constantes locais; lock key nomeada) | 0 | ⚠️ (`RUN_PRESA_MS` fixo) | `SincronizacaoPassadaService.ts:15-21` |
| Duplicação de padrão SWR (TTL+cooldown+run) | 2 services (Carteira, Passada) | 1 abstração | ⚠️ | `CarteiraAtualizacaoService.ts`, `SincronizacaoPassadaService.ts` |
| Ciclos de dependência no delta | 0 observados (trace manual) | 0 | ✅ | leitura de imports |
| Cognitive complexity no delta | 0 avisos (biome limpo no delta) | 0 | ✅ | `_shared-metrics.md` |

Apêndice (obrigatório) — top-10 maiores arquivos e top-10 fan-in: ⚠️ **Não medível no escopo --quick**: exige varredura do repo inteiro, fora do delta. Os 3 maiores arquivos tocados pelo delta estão listados acima (`lib/sispag.ts` 1807, `page.tsx` 1582, `routes/sispag.ts` 1270). Fan-in do novo service: 3 consumidores (rotas x2 via `routes/sispag.ts`, Job).

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Corpo da passada extraído do Job para service (job 117 -> 49 LOC); mas rotas/page/lib SISPAG seguem monolíticos | ⚠️ parcial | `SincronizarLotesSispagJob.ts`; `wc -l` |
| Increase Semantic Coherence | Service único com 3 gatilhos (abertura, forçar, cron) e 1 entidade (passada L11) | ✅ presente | `SincronizacaoPassadaService.ts:67-130` |
| Encapsulate | Rotas só conhecem `sincronizarSeDefasada`/`forcar`; lock e run escondidos | ✅ presente | `routes/sispag.ts` diff |
| Use an Intermediary | Service entre Job/rota e `SincronizacaoLoteService`; `PostgreeDatabaseClient.withAdvisoryLock` | ✅ presente | `SincronizacaoPassadaService.ts:74-82` |
| Restrict Dependencies | Camadas respeitadas, sem import de rota no domínio | ✅ presente | diff |
| Refactor | Remoção do botão por lote e unificação em 1 caminho; mas stubs 410 e `sincronizarLote` órfão mantidos | ⚠️ parcial | `routes/sispag.ts` (410), nota do escopo |
| Abstract Common Services | Lógica TTL/cooldown/run duplicada entre Carteira e Passada; no front, hook generalizado (`useRefreshAoAbrir`) | ⚠️ parcial | `CarteiraAtualizacaoService.ts`, `useCarteiraAoAbrir.ts` |
| Defer Binding (config) | TTL e cooldown em `EnvironmentVars`, defaults 30/5 | ✅ presente | `EnvironmentVars.ts:220-227` |
| Defer Binding (polimorfismo/plugin) | Sem token/interface alternativa; relógio injetável apenas para teste | N/A | variabilidade de runtime não é requisito aqui |

## 4. Findings

### F-modifiability-1: Padrão stale-while-revalidate duplicado no backend

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoPassadaService.ts:93-143`; `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts`
- **Evidência (objetiva)**:
  ```
  sispagCarteiraTtlMin / sispagCarteiraCooldownMin   (existente)
  sispagLotesSyncTtlMin / sispagLotesSyncCooldownMin (novo, mesmo default 30/5)
  decisão fresca | em_andamento | falha_recente | roda  replicada em 2 services
  ```
- **Impacto técnico**: uma correção na regra (ex.: tratar run presa, contar `partial`) precisa ser feita duas vezes; divergência silenciosa.
- **Impacto de negócio**: risco de comportamento inconsistente entre carteira e lotes na tela, retrabalho em cada ajuste de política.
- **Métrica de baseline**: 2 implementações da mesma decisão; 4 vars de env para 1 política.

### F-modifiability-2: Arquivos SISPAG gigantes continuam crescendo

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/frontend/lib/sispag.ts` (1807), `src/frontend/app/sispag/page.tsx` (1582), `src/backend/routes/sispag.ts` (1270)
- **Evidência (objetiva)**:
  ```
  lib/sispag.ts +62/-7, page.tsx ~+75 neste delta; todos > 2x o limite de 600 LOC
  ```
- **Impacto técnico**: toda feature SISPAG toca os mesmos 3 arquivos; conflitos de merge e revisão cara.
- **Impacto de negócio**: lead time maior por feature da Frente II.
- **Métrica de baseline**: 3 arquivos, 4659 LOC, max 1807 (alvo 600).

### F-modifiability-3: Resíduos da remoção do botão por lote

- **Severidade**: P3
- **Tactic violada**: Refactor
- **Localização**: `src/backend/routes/sispag.ts` (rota `POST /lotes/:id/sincronizar` 410); `SincronizacaoLoteService.sincronizarLote`
- **Evidência (objetiva)**:
  ```
  router.post('/lotes/:id/sincronizar', ... res.status(410) ...)  // sem chamador
  ```
- **Impacto técnico**: 2 rotas 410 de descontinuação acumulam; `RUN_PRESA_MS` (10 min) fixo no código.
- **Impacto de negócio**: baixo; superfície de API a manter.
- **Métrica de baseline**: 2 rotas 410 no arquivo; 1 constante de regra fora da env.

## 5. Cards Kanban

### [modifiability-1] Extrair política "atualizar se defasada" compartilhada

- **Problema**
  > Carteira e lotes implementam TTL, cooldown e "em andamento" em services separados, com 4 vars de env para uma só política. Ajustar a regra exige tocar dois lugares.
- **Melhoria Proposta**
  > Criar helper/classe `PoliticaDefasagem` (puro, relógio injetável) usada por `CarteiraAtualizacaoService` e `SincronizacaoPassadaService`; mover `RUN_PRESA_MS` para a mesma política. Tactic: Abstract Common Services.
- **Resultado Esperado**
  > Uma única implementação testada da decisão; novas fontes SWR custam 1 service fino.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Implementações da decisão TTL/cooldown: 2 -> 1
- **Risco de não fazer**: A 3ª fonte SWR copia o padrão pela 3ª vez e as regras divergem.
- **Dependências**: nenhuma

### [modifiability-2] Quebrar page/lib/routes SISPAG por subdomínio

- **Problema**
  > `lib/sispag.ts` (1807), `page.tsx` (1582) e `routes/sispag.ts` (1270) acumulam toda a Frente II e cresceram neste delta.
- **Melhoria Proposta**
  > Dividir por subdomínio (carteira, lotes, remessa, retorno) em módulos/rotas/componentes; começar movendo o bloco de sincronização de lotes (hook + botão + cliente) para `app/sispag/lotes/`. Tactic: Split Module.
- **Resultado Esperado**
  > Nenhum arquivo SISPAG > 600 LOC; features tocam 1 subdomínio.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: L (1–2sem)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Max LOC dos 3 arquivos: 1807 -> <= 600
- **Risco de não fazer**: Cada feature SISPAG fica mais cara e conflituosa.
- **Dependências**: aplicar de forma proporcional em `/feature-tweak`

### [modifiability-3] Aposentar stubs 410 e `sincronizarLote` após janela de cache

- **Problema**
  > Rotas 410 e o método por lote sem chamador permanecem como superfície de manutenção.
- **Melhoria Proposta**
  > Após 1 release, remover as rotas 410; reavaliar `sincronizarLote` conforme testes de decisão por lote (intencional hoje). Tactic: Refactor.
- **Resultado Esperado**
  > Menos superfície de API sem chamador.
- **Tactic alvo**: Refactor
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Rotas 410 de sincronização: 2 -> 0
- **Risco de não fazer**: Resíduo de API permanente.
- **Dependências**: nenhuma

## 6. Notas do agente

- Modo --quick: só o delta; top-10 de LOC/fan-in repo-wide não medidos (declarado na seção 2).
- Cross-QA: Split Module em page/routes sobrepõe Testability; `RUN_PRESA_MS` fixo e vars de env tocam Deployability; locks/runs sobrepõem Availability.
- Sem P0/P1: delta bem encapsulado, respeita camadas, config externalizada.
