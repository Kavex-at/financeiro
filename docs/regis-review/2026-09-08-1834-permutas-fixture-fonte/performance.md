---
qa: Performance
qa_slug: performance
run_id: 2026-09-08-1834
agent: qa-performance
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 7
findings_count: 3
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Delta 100% `src/frontend/`. Não há Lambda, RDS, SQS, EventBridge nem `infra/`
neste repo — todo o cenário canônico de latência backend é **não medível
localmente**. O cenário relevante ao delta é o front carregando a Gestão de
Permutas:

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia | Abre `/permutas` (carga inicial) OU clica "Tentar novamente" | `usePermutasData` → `fetchGestaoPermutas` → `apiFetch` → `GET /permutas/gestao` (Express no Render) | Produção normal | Painel pinta em `p95 ≤ 1.5s`; em falha de rede/HTTP → banner com retry em `≤ 30s` desde a chamada, sem loading eterno | TTFB `p50 ≤ 400ms`, tempo até estado terminal (dados OU banner de erro) `p95 ≤ 30s` (limite dado pelo timeout do fetch — hoje **não há timeout**, então o limite real é o do stack HTTP do navegador, tipicamente 60–120s) |
| Analista em ambiente demo (`NEXT_PUBLIC_DEMO_MODE=true`, `NEXT_PUBLIC_ENV=local`) | Abre `/permutas` sem backend | `fetchGestaoPermutas` cai no `gestaoPermutasFixture` | Local | Painel pinta imediato com banner "Dados de demonstração" | Tempo até primeiro paint `≤ 200ms`; custo em bundle de produção `= 0 bytes` (fixture só carregado quando demo ligado) — **hoje o fixture é importado estaticamente e paga bytes em todo build** |

O fix corrigiu confiança (o dado na tela agora tem procedência declarada), mas
**introduziu** uma exposição de performance latente: antes, backend pendurado
virava fixture em `~0ms` (comportamento errado, mas rápido); agora vira `loading`
preso até o navegador cancelar a `fetch` sozinho.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `AbortController` usages em `src/frontend/` (fora de teste) | **0** | ≥ 1 em `apiFetch` (timeout configurável) | ❌ | `grep -rn "AbortController\|AbortSignal" src/frontend --include="*.ts" --include="*.tsx" \| grep -v ".test."` → 0 matches |
| `timeout` explícito em wrappers de fetch (`src/frontend/lib/`) | **0** | ≥ 1 em `apiFetch` | ❌ | `grep -rn "timeout" src/frontend/lib --include="*.ts"` → 1 match, num comentário de `sispag.ts:428`; nenhum em `http.ts` |
| Tamanho do fixture em fonte (`lib/permutas-fixture.ts`) | **6.441 bytes** (227 linhas) | irrelevante em local; 0 bytes em produção | ⚠️ | `wc -c src/frontend/lib/permutas-fixture.ts` |
| Import do fixture em `lib/api.ts` | **estático** (`import { gestaoPermutasFixture } from './permutas-fixture'`) | dinâmico atrás de `isDemoMode()` | ❌ | `sed -n '19p' src/frontend/lib/api.ts` |
| Chunks Turbopack que carregam strings do fixture (`DBP PIPING`, `CENTENO INTERNATIONAL`, etc.) | **3 chunks** (`3w7mukm2k1bdh.js`, `1t1gsd32h8hb9.js`, `2wrztmgxb657m.js`) | 0 quando `NEXT_PUBLIC_DEMO_MODE!=true` | ❌ | `grep -l "DBP PIPING" .next/static/chunks/*.js` |
| Tamanho gzip dos 3 chunks acima (contêm fixture + outro código) | 8.017 / 8.525 / 10.576 bytes | — (proxy — não é o custo do fixture isolado) | ⚠️ | `gzip -c … \| wc -c` |
| Custo bruto estimado do fixture no bundle (pós-minify, gzip) | ~1.8–2.5 KB (estimativa a partir da fonte de 6.4KB com dados JSON minificáveis; **não isolado**) | 0 KB fora do modo demo | ⚠️ | estimativa técnica; medição exata exige `next build --profile` + análise de source-maps que não foi rodada |
| Consumidores do fixture fora do delta | **1** (`lib/api.ts` linha 19); `lib/types.ts` só cita no JSDoc | — | ℹ️ | `grep -rn "permutas-fixture" src/frontend --include="*.ts" --include="*.tsx" \| grep -v ".test."` |
| Retry granular (`load()` refaz `/gestao` OU só o que falhou?) | **refaz `/gestao` + dispara `carregarStatus()` (`/permutas/status`)** — full carga | idem (custos ~cheap; ver F-performance-3) | ⚠️ | `src/frontend/app/permutas/components/usePermutasData.ts:44-56` |
| Loading state ligado sem escape enquanto a fetch pende | **até o navegador cortar** (~60–120s em Chrome padrão) | ≤ 30s configurável | ❌ | derivado da ausência de timeout + `setLoading(false)` só no `.finally` |
| Cold start Lambda / RDS pool / SQS batch — QAs backend clássicos | **não medível** | — | ⚠️ | `infra/` não existe (ver `_shared-metrics.md` §Baseline) |
| Índices SQL / N+1 no delta | **não aplicável** | — | ⚠️ | delta é 100% `src/frontend/` |

> ⚠️ **Não medível localmente**: bundle-per-route (First Load JS) individual do
> Next 15 — `next build` foi executado (`_shared-metrics.md`) mas o resumo por
> rota não foi persistido; medir exige rodar `next build` de novo e capturar o
> output, fora do escopo do delta. Recomendação: adicionar `next build |
> tee build.log` a `_shared-metrics.md` num próximo ciclo.
> ⚠️ **Não medível localmente**: p50/p95 reais de `GET /permutas/gestao` em
> produção. Requer RUM ou log de latência do Render. Recomendação: adicionar
> `X-Response-Time` no Express e um logger de latência por rota.

## 3. Tactics — Cobertura no nf-projects

Tactics de Bass & Clements para Performance, aplicadas ao delta:

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A | N/A | Delta não trata evento contínuo — é resposta a interação de UI |
| Limit Event Response | N/A | N/A | idem |
| Prioritize Events | N/A | N/A | idem |
| Reduce Overhead | Fixture é estaticamente importado por `lib/api.ts`, ships em produção mesmo com demo desligado | ❌ ausente | `src/frontend/lib/api.ts:19` |
| Bound Execution Times | `apiFetch` (`src/frontend/lib/http.ts`) NÃO impõe timeout nem passa `AbortSignal`. Como `fetchGestaoPermutas` agora LANÇA em vez de mascarar, um backend pendurado deixa `loading=true` até o navegador cortar sozinho. O delta agravou a exposição a esse gap pré-existente | ❌ ausente | `src/frontend/lib/http.ts:29-35` — corpo inteiro do wrapper, sem `AbortController` |
| Increase Resource Efficiency | Fixture é dado morto em builds de produção (ver Reduce Overhead) | ⚠️ parcial | idem `src/frontend/lib/api.ts:19` |
| Increase Resources | N/A no frontend | N/A | — |
| Increase Concurrency | `carregarStatus()` roda em paralelo à `fetchGestaoPermutas` via `void carregarStatus()`, sem bloquear o paint principal | ✅ presente | `src/frontend/app/permutas/components/usePermutasData.ts:56, 74` |
| Maintain Multiple Copies of Computations | N/A | N/A | — |
| Maintain Multiple Copies of Data | Preserva dado anterior no refresh falho — `LoadErrorBanner` com `stale` (é uma cache-implícita de última carga bem-sucedida) | ✅ presente | `usePermutasData.ts:46-52`, `banners.tsx:44-77` |
| Bound Queue Sizes | N/A no frontend | N/A | — |
| Schedule Resources | N/A | N/A | — |
| **Cold Start Budget** (Lambda) | **não medível** — sem Lambda | ⚠️ | `_shared-metrics.md` |
| **Cache Strategy** | O padrão "preserva dado prévio no refresh" é uma cache de última resposta boa; o `SessionExpiredError` é filtrada corretamente (não polui o estado com erro que não é erro de dado). SSM / config — fora do escopo | ✅ presente | `usePermutasData.ts:46-52` |
| **Index Discipline** (SQL) | N/A no delta | N/A | — |
| **Bundle Leanness** | Fixture (~6.4 KB fonte) inclui em 3 chunks do build; deveria ser dynamic-imported | ❌ ausente | `.next/static/chunks/{3w7mukm2k1bdh, 1t1gsd32h8hb9, 2wrztmgxb657m}.js` |

## 4. Findings (achados)

### F-performance-1: `apiFetch` sem timeout — o fix agravou uma exposição pré-existente de "loading eterno"

- **Severidade**: P1 (alto — degrada QA mensurável do fluxo tocado pelo delta)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/frontend/lib/http.ts:29-35`; consumidor sensibilizado pelo delta: `src/frontend/lib/api.ts:80-121` (`fetchGestaoPermutas`) e `src/frontend/app/permutas/components/usePermutasData.ts:43-58` (`load`)
- **Evidência (objetiva)**:
  ```ts
  // src/frontend/lib/http.ts:29-35 — corpo INTEIRO do wrapper
  export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, init)
    if (res.status === 401) { emitSessionExpired(); throw new SessionExpiredError() }
    return res
  }
  ```
  ```bash
  $ grep -rn "AbortController\|AbortSignal" src/frontend --include="*.ts" --include="*.tsx" | grep -v ".test."
  # (vazio — 0 ocorrências)
  ```
- **Impacto técnico**: antes do delta, `fetchGestaoPermutas` engolia qualquer
  falha (incluindo pendurados) e devolvia `gestaoPermutasFixture` — a analista
  via dados falsos mas rápido. Depois do delta, a falha propaga e alimenta
  `error` no `usePermutasData`; porém, se o backend PENDURA (não retorna e não
  fecha o socket) em vez de errar, a `fetch` só desiste quando o
  navegador/stack cortar (Chrome desktop: sem timeout padrão; alguns proxies
  cortam em 30–60s; TCP RST pode nunca vir). Nesse período, `loading=true`,
  botão "Tentar novamente" fica `disabled={retrying}`, e a analista não tem
  saída além de recarregar a aba. É a mesma família de problema já catalogada
  em `ontology/_inbox/backlog-melhorias-2026-09-02.md` §2.2 (P1) — o delta
  não a criou, mas subiu o custo.
- **Impacto de negócio**: em janela de incidente do backend (Render restart,
  502/504 do proxy, deploy do próprio Express), a analista fica sem
  ferramenta útil para decidir baixa de adiantamento; hoje ela recarregava a
  aba e via a fixture — dado errado mas UI viva. Agora recarrega e vê
  loading eterno. Troca "confiança falsa mas rápida" por "honestidade lenta".
- **Métrica de baseline**: 0 usos de `AbortController` em `src/frontend/`
  (deveria haver ≥ 1 em `apiFetch`); 0 `timeout` configurado; tempo até
  estado terminal em backend pendurado: **indefinido / dependente do stack
  do navegador**. Alvo: ≤ 30s configurável, com mensagem de timeout no
  `LoadErrorBanner`.

### F-performance-2: fixture de demo (`permutas-fixture.ts`) ships no bundle de produção via import estático

- **Severidade**: P2 (médio — débito técnico defensável, custo pequeno em absoluto)
- **Tactic violada**: Reduce Overhead / Bundle Leanness / Increase Resource Efficiency
- **Localização**: `src/frontend/lib/api.ts:19` (import estático); `src/frontend/lib/permutas-fixture.ts` (227 linhas / 6.441 bytes)
- **Evidência (objetiva)**:
  ```ts
  // src/frontend/lib/api.ts:19
  import { gestaoPermutasFixture } from './permutas-fixture'
  // usos: linhas 96 (dentro de try, se vazia && isDemoMode) e 118 (dentro de catch, se isDemoMode)
  ```
  ```bash
  $ wc -c src/frontend/lib/permutas-fixture.ts
  6441 src/frontend/lib/permutas-fixture.ts
  $ grep -l "DBP PIPING" .next/static/chunks/*.js
  .next/static/chunks/3w7mukm2k1bdh.js
  .next/static/chunks/1t1gsd32h8hb9.js
  .next/static/chunks/2wrztmgxb657m.js
  # 3 chunks contêm strings do fixture (exportadores reais)
  ```
- **Impacto técnico**: com `NEXT_PUBLIC_DEMO_MODE` desligado (default em
  todos os ambientes, garantido por `assertDemoEnv()` — `features.ts:52`),
  o fixture é código morto em produção. Ainda assim, um import estático
  no topo de `lib/api.ts` — que é a espinha da UI — faz o bundler incluí-lo
  em qualquer chunk que precise de qualquer coisa de `lib/api.ts`. O
  bundler não sabe que `isDemoMode()` é falso em produção porque o valor
  vem de `process.env.NEXT_PUBLIC_DEMO_MODE` (que o Next 15 injeta no
  build); em teoria o tree-shaking poderia eliminá-lo se `isDemoMode()`
  fosse const-inlineado, mas na prática o fixture aparece em 3 chunks
  do build atual.
- **Impacto de negócio**: custo é pequeno (~1.8–2.5 KB gzip estimado
  isolado dentro dos chunks), mas paga em todo primeiro-load de todo
  usuário em toda tela, incluindo mobile em rede ruim. É o oposto da
  filosofia declarada em `features.ts:36-44` — "default OFF, dado falso
  na tela nunca é o comportamento desejado por omissão". Se o dado é
  proibido, o código dele também deveria ser.
- **Métrica de baseline**: fixture presente em **3 de 155 chunks** do
  `.next/static/chunks/` (`ls .next/static/chunks/*.js | wc -l` = 155);
  fonte de 6.441 bytes; consumidores no runtime de produção = 0.

### F-performance-3: `load()` refaz `/gestao` E `/permutas/status` mesmo quando só um dos dois falhou

- **Severidade**: P3 (baixo — opcional, custo real depende de latência dos endpoints em produção — não medível localmente)
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/frontend/app/permutas/components/usePermutasData.ts:43-58` (`load`)
- **Evidência (objetiva)**:
  ```ts
  const load = React.useCallback(async () => {
    setLoading(true)
    try { setData(await fetchGestaoPermutas()); setError(null) }
    catch (err) { if (!isSessionExpiredError(err)) setError(mensagemDeFalha(err)) }
    finally { setLoading(false) }
    void carregarStatus()          // dispara SEMPRE, mesmo que /gestao tenha caído
  }, [carregarStatus])
  ```
- **Impacto técnico**: no clique de retry, dispara `/gestao` E `/permutas/status`
  incondicionalmente. `carregarStatus` é intencional (é `void` e é
  best-effort, `usePermutasData.ts:35-42`), então não bloqueia a UI, mas gasta
  banda/tempo do backend por retry. Se o único que falhou foi o `/status`
  (não o `/gestao`), ainda assim o `/gestao` é refeito.
- **Impacto de negócio**: mínimo. Endpoint `/gestao` é o "rápido, sem ERP"
  por design (`usePermutasData.ts:29-32`); o `/status` é a carga LAZY que
  bate no Conexos. Em um cenário de Conexos lento (2–10s p99 comum), retry
  cego rebate no Conexos por baixo mesmo se o problema fosse só de rede
  transitória.
- **Métrica de baseline**: 1 endpoint refeito desnecessariamente por
  retry (0 → 1); volume total de requests por retry: **2** (`/gestao`
  síncrono + `/status` fire-and-forget). Latência p50/p95 dos dois
  endpoints em produção: **não medível localmente**.

## 5. Cards Kanban

### [performance-1] `apiFetch`: impor timeout com `AbortController` para acabar com o "loading eterno" em backend pendurado

- **Problema**
  > `src/frontend/lib/http.ts:29-35` faz um `await fetch(input, init)` sem
  > passar `signal` nem envelope de timeout. `grep AbortController` em
  > `src/frontend/` retorna 0 matches. Antes do fix `permutas-fixture-fonte`,
  > um backend pendurado virava fixture em ~0ms (comportamento errado,
  > rápido); com o fix, a exceção sobe e `usePermutasData.load` mantém
  > `loading=true` até o navegador desistir da conexão TCP — em Chrome
  > desktop, potencialmente 60–120s ou nunca. A analista fica sem retry
  > útil (`retrying=loading=true` desabilita o botão) até recarregar a aba.
  > O gap é pré-existente (backlog §2.2 P1), mas o delta subiu o custo
  > operacional dele.

- **Melhoria Proposta**
  > Adicionar timeout configurável ao `apiFetch` via `AbortController`,
  > com default sensato (20–30s para reads, mais para uploads) e ponto
  > de extensão via `init.signal` de fora. Compose em vez de sobrescrever
  > (se o caller passar `signal`, usar `AbortSignal.any([external, timeoutCtrl.signal])`).
  > Traduzir `AbortError`/`TimeoutError` em uma classe própria
  > (`ApiTimeoutError`) para o `LoadErrorBanner` mostrar mensagem específica
  > ("O backend não respondeu em 30s"). Bass: **Bound Execution Times**.
  > Tocar `src/frontend/lib/http.ts` (wrapper) e opcionalmente
  > `src/frontend/lib/api.ts` (mensagens específicas).

- **Resultado Esperado**
  > Backend pendurado ou lento além do budget → banner de falha visível
  > em ≤ 30s, botão de retry habilitado, analista tem saída sem F5. Métrica
  > observável: tempo mediano até estado terminal (dados OU banner de
  > erro) em backend pendurado passa de "indefinido / até o navegador
  > cortar" para "≤ 30s ± jitter". Contagem de `AbortController` em
  > `src/frontend/` passa de 0 → ≥ 1 (em `apiFetch`).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - `grep -rn "AbortController" src/frontend/lib/http.ts`: 0 → ≥ 1
  - Tempo até estado terminal em backend pendurado (medido em teste
    de integração com endpoint que segura resposta): **indefinido** → **≤ 30s**
  - Testes cobrindo `ApiTimeoutError` bubble-up em `usePermutasData`: 0 → ≥ 1
- **Risco de não fazer**: em qualquer janela de incidente do backend
  (deploy do Render, 504 do proxy, hang no pool do Postgres), a analista
  vê "loading" eterno na única tela que decide baixa de adiantamento —
  troca "dado errado rápido" (comportamento pré-delta) por "sem dado,
  sem sinal, sem saída". Custo operacional escala com número de analistas
  e frequência de incidentes.
- **Dependências**: nenhuma (independente); é o mesmo item catalogado
  em `ontology/_inbox/backlog-melhorias-2026-09-02.md` §2.2

### [performance-2] Dynamic-import do `gestaoPermutasFixture` atrás de `isDemoMode()`

- **Problema**
  > `src/frontend/lib/api.ts:19` faz `import { gestaoPermutasFixture }
  > from './permutas-fixture'` no topo do módulo. `permutas-fixture.ts`
  > tem 227 linhas / 6.441 bytes de dados de exportadores reais (DBP
  > PIPING, CENTENO, QINGDAO COVENANT etc.). Como `lib/api.ts` é a
  > espinha da UI, o bundler inclui o fixture nos chunks que compõem
  > qualquer tela que use a API — confirmado: strings do fixture
  > aparecem em 3 chunks distintos do `.next/static/chunks/`.
  > `assertDemoEnv()` (`features.ts:52`) garante que o modo demo só
  > vale em `local`, então em qualquer build deploiado (Vercel, prod
  > ou staging) o fixture é dead code — pago por todo usuário, todo
  > primeiro-load.

- **Melhoria Proposta**
  > Trocar o import estático por dinâmico dentro dos dois braços que
  > realmente usam:
  > ```ts
  > if (vazia && isDemoMode()) {
  >   const { gestaoPermutasFixture } = await import('./permutas-fixture')
  >   return gestaoPermutasFixture
  > }
  > ```
  > Idem no `catch`. Como `isDemoMode()` retorna `false` em produção
  > (fixado pelo build via `NEXT_PUBLIC_DEMO_MODE`), o Next/Turbopack
  > isolará o fixture num chunk separado que só carrega em demo. Bass:
  > **Reduce Overhead / Bundle Leanness**. Tocar `src/frontend/lib/api.ts`
  > (linhas 19, 96, 118) e revisar se algum outro path futuro deva usar
  > o mesmo padrão.

- **Resultado Esperado**
  > Chunks de produção deixam de conter as strings de exportadores do
  > fixture. Consumidores runtime em produção: 0. Custo por primeiro-load:
  > diminui em ~1.8–2.5 KB gzip estimado (não isolado — é upper bound).
  > Métrica observável: `grep -l "DBP PIPING" .next/static/chunks/*.js`
  > passa de 3 chunks → 1 chunk (ou 0, se `isDemoMode()=false` for
  > const-inlineado no build) desde que o build seja feito com
  > `NEXT_PUBLIC_DEMO_MODE` diferente de `'true'`.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Chunks que contêm strings do fixture com build de produção
    (`NEXT_PUBLIC_DEMO_MODE!=true`): 3 → 0 (ideal) ou 1 (chunk
    isolado, lazy)
  - Tamanho gzip do bundle de `/permutas` primeiro-load: −~1.8 a
    −2.5 KB (medir com `next build` antes/depois)
- **Risco de não fazer**: o débito é pequeno em absoluto mas viola o
  princípio declarado em `features.ts:36-44` — "dado falso na tela
  nunca é o comportamento desejado por omissão". Se o dado é proibido
  em produção, o código dele também deveria ser. Custo real cresce
  se novos fixtures forem adicionados no mesmo padrão.
- **Dependências**: nenhuma; refactor local em `api.ts`

### [performance-3] Retry granular no `load()`: só re-chamar o que falhou

- **Problema**
  > `usePermutasData.load` (`usePermutasData.ts:43-58`) sempre dispara
  > `fetchGestaoPermutas()` (síncrono) E `void carregarStatus()`
  > (best-effort). Se a última falha foi só no `/permutas/status`,
  > o `/gestao` é refeito por igual. `/status` bate no Conexos, que
  > em produção pode custar 2–10s p99 (CLAUDE.md — "Conexos pode ser
  > lento"), então retry cego amplifica lentidão do Conexos.

- **Melhoria Proposta**
  > Distinguir `error` de `/gestao` de `error` de `/status`; o botão
  > "Tentar novamente" só re-executa o endpoint que falhou. Duas opções:
  > (a) split de estados (`errorGestao` / `errorStatus`, dois retries
  > separados); (b) `load()` aceitar um argumento `{ scope: 'all' | 'gestao'
  > | 'status' }`. (b) é mais barato e mantém a API do hook enxuta.
  > Bass: **Increase Resource Efficiency**. Tocar
  > `src/frontend/app/permutas/components/usePermutasData.ts` e o
  > callsite `LoadErrorBanner` em `page.tsx:726`.

- **Resultado Esperado**
  > Retry re-executa 1 endpoint em vez de 2 quando só um falhou.
  > Métrica observável: chamadas por retry, se a falha foi só em
  > `/status`: 2 → 1 (redução de 50% no fan-out de retry). Latência
  > de retry (dominada pelo Conexos): variável — não medível
  > localmente, mas o pior caso deixa de dobrar chamadas ao ERP.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Chamadas por retry quando só `/status` falhou: 2 → 1
  - Testes cobrindo retry granular no `usePermutasData`: 0 → ≥ 1
- **Risco de não fazer**: baixo — é otimização de borda; o custo
  atual é limitado pelas latências reais de `/gestao` (cheap por
  design) e `/status` (lazy, best-effort). Vira dor real só se o
  volume de retries crescer OU se o Conexos entrar em degradação
  prolongada.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo é DELTA frontend-only; toda tactic clássica de performance backend
  (cold start Lambda, pool RDS, SQS batch, índices SQL) é declarada
  **não medível** conforme `_shared-metrics.md` — `infra/` não existe neste
  repo (CLAUDE.md: Terraform/AWS é **alvo**, hoje roda Express/Render/Vercel).
- Cross-QA:
  - **Availability + Fault Tolerance**: F-performance-1 (`apiFetch` sem
    timeout) tem overlap direto com Availability — falta de timeout é a
    primeira citation clássica de "single hung dependency pins the whole
    concurrency pool" (Bass). Consolidator: consolidar em uma única
    entrada se qa-availability chegar à mesma conclusão.
  - **Deployability**: F-performance-2 (fixture no bundle) tem overlap
    com bundle-size / build-artifact hygiene — se qa-deployability
    tiver métricas de First Load JS por rota, cross-refernciar.
  - **Modifiability**: nenhum overlap direto no delta.
- Tentei coletar First Load JS por rota do Next 15 build output — o
  `_shared-metrics.md` diz `exit 0, 12 rotas prerenderizadas` mas o
  resumo textual do `next build` não foi persistido. Preservei a
  estimativa (upper-bound 1.8–2.5 KB gzip para o fixture isolado) e
  a marcei como estimativa, não medida — não invento número.
- Score 7/10: o delta em si é neutro-positivo para performance
  (elimina o path "silenciosamente retornar fixture", que é um
  anti-cache que mascarava saúde real); a nota reflete o gap
  pré-existente em `apiFetch` (F-performance-1) que agora dói mais
  na tela, e o pequeno peso de bundle (F-performance-2). Score
  penalizado -3 principalmente por P1 herdado que o delta agravou.
