---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-08-1834
agent: qa-fault-tolerance
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 8.0
findings_count: 5
cards_count: 4
---

# Fault Tolerance — Regis-Review

> **Escopo do delta.** 10 arquivos, +558/−19, **100% `src/frontend/` + 1 doc de ontologia**
> (`_shared-metrics.md`). Zero linhas de `src/backend/`, zero migrations, zero jobs, zero infra.
> Isso restringe o eixo de Fault Tolerance a **honestidade da UI sob falha parcial** — o que
> o delta pretendia consertar. SQS/DLQ/Lambda/idempotência no consumidor **não são medíveis
> aqui** (não existe `infra/`) e não geram finding.
>
> **Por que essa QA importa neste delta.** O caminho anterior convertia toda falha em
> conteúdo plausível numa tela onde a analista decide baixa de adiantamento. Isso é o
> financeiro-equivalente exato de "no double-execution / no silent data loss": o dado da
> tela era **silenciosa e sistematicamente falso** em três estados que o operador não
> conseguia distinguir. O fix é o objeto natural desta QA.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Backend Express (Render) | 500/timeout/rede/401 em `GET /permutas/gestao`, OU resposta legítima com carteira vazia, OU `NEXT_PUBLIC_DEMO_MODE=true` | `src/frontend/lib/api.ts::fetchGestaoPermutas` + painel `app/permutas/page.tsx` | Operação normal (analista decidindo baixa PROFORMA × INVOICE, `fin010`) | Cada um dos 3 casos é distinguível pelo operador: vazio real → KPIs zerados; falha → banner com retry preservando último snapshot real; demo → banner destrutivo permanente. Sessão expirada não vira banner nem fixture — sobe para o `SessionExpiredModal` | 0 caminhos silenciosos convertendo falha em conteúdo (baseline: 3); 100% dos casos com sinal visual distinto; `assertDemoEnv()` estoura no import se o flag ligado escapar para build deployado |

Cenário-negativo que o delta fecha: analista aprovando uma baixa de adiantamento olhando para 227 linhas de dados **reais mas antigos** (exportadores nominais, valores em USD), acreditando ser a carteira viva. Falha silenciosa de **integridade de apresentação** — o financeiro-equivalente de uma escrita duplicada, só que na camada de leitura.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Caminhos de `fetchGestaoPermutas` que convertem falha/vazio em fixture SEM sinalizar | **0** (fora de demo) | 0 | ✅ | `src/frontend/lib/api.ts:63-121` |
| Caminhos que convertem falha em fixture COM sinalização (demo explícito) | 2 (linha 96 + 118), ambos marcam `fonte: 'fixture'` | ≥1, marcado | ✅ | `src/frontend/lib/api.ts:96,118` + tipo `fonte` em `src/frontend/lib/types.ts:236` |
| `SessionExpiredError` propagada em vez de mascarada | Sim — `catch (err) { if (isDemoMode()) return fixture; throw err }` + `usePermutasData` filtra com `isSessionExpiredError` | Sim | ✅ | `src/frontend/lib/api.ts:113-119`, `src/frontend/app/permutas/components/usePermutasData.ts:47,74` |
| Testes cobrindo os 3 estados (vazio real, falha HTTP, falha rede, 401, demo em vazio, demo em falha) | 7 casos em `permutas-fonte-dado.test.ts` | ≥5 | ✅ | `src/frontend/__tests__/permutas-fonte-dado.test.ts` |
| Fail-fast: `assertDemoEnv()` estourando em `NEXT_PUBLIC_ENV≠local` | Sim, chamado no import de `api.ts:22`; testes cobrem `prd` e env ausente | Sim | ✅ | `src/frontend/lib/features.ts:44-53`, `src/frontend/__tests__/features-demo-mode.test.ts` |
| Preservação do último snapshot real em falha de refresh (Recovery: Repair State / Reintroduction) | Sim — `usePermutasData.load()` não zera `data` no `catch`; banner `stale` diz "podem estar desatualizadas" | Sim, com sinal | ✅ | `src/frontend/app/permutas/components/usePermutasData.ts:39-52`, `banners.tsx:53-79` |
| Timestamp de última carga bem-sucedida (`geradoEm`) visível ao operador | Sim, renderizado no cabeçalho do painel | Sim | ✅ | `src/frontend/app/permutas/page.tsx:650-655` |
| Timeout / `AbortSignal` na chamada do painel | **0** — `apiFetch` e `fetchGestaoPermutas` não passam `AbortSignal` nem cancelam por deadline | Timeout finito | ❌ | `grep -rn "AbortSignal\|AbortController" src/frontend/lib` → 0 hits; `src/frontend/lib/http.ts:20-32` |
| Threshold de "obsolescência inaceitável" no banner stale | **0** — texto é qualitativo ("podem estar desatualizadas"), sem comparar `Date.now()` com `geradoEm` | Alerta escalonado (≥Nmin) | ⚠️ | `src/frontend/app/permutas/components/banners.tsx:53-79` |
| App Router error boundary (`app/**/error.tsx` ou `global-error.tsx`) | **0 arquivos** | ≥1 (`app/error.tsx`) | ⚠️ | `find src/frontend/app -name "error.tsx" -o -name "global-error.tsx"` → vazio |
| Teste garantindo que `assertDemoEnv()` roda no import de `api.ts` (não só isolado em `features.ts`) | **0** — o unit test importa `features.ts` diretamente | ≥1 assertion integrada | ⚠️ | `src/frontend/__tests__/features-demo-mode.test.ts` só testa `assertDemoEnv` em isolamento |
| Mirror `lib/recebimentos.ts` — `fetchPainelRecebimentos` cai em fixture silenciosamente | **Não** — já corrigido em fatia anterior (`sed -n '829-836'`), erro propaga, "NÃO cai mais em fixture" | Sem fixture-como-fallback | ✅ | `src/frontend/lib/recebimentos.ts:829-869` |

> ⚠️ **Não medível localmente** (declarado explicitamente): idempotência de writes SQS, DLQ, timeouts em `RetryExecutor`, sanity checking em clients externos, stuck-state reaper. Todos vivem em `src/backend/` ou `infra/`, e este delta é **frontend-only**. Não são finding — são fora do escopo do delta.

## 3. Tactics — Cobertura no delta

Bass & Clements' Fault Tolerance tactics, mapeadas ao que o delta efetivamente introduz ou toca:

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Avoid Faults — Substitution** | `assertDemoEnv()` substitui um deploy silenciosamente configurável por um crash no import — modo demo em `NEXT_PUBLIC_ENV≠local` NÃO SOBE | ✅ presente | `src/frontend/lib/features.ts:44-53`, chamada no topo de `api.ts:22` |
| **Avoid Faults — Replacement / Predictive Model / Increase Competence Set** | N/A | N/A | Não há substituição em runtime nem modelo preditivo neste delta |
| **Detect Faults — Sanity Checking** | `fetchGestaoPermutas` distingue `vazia` de `!res.ok`; extrai `json.error` do corpo se houver, propaga em mensagem — em vez de tratar tudo como o mesmo `null` | ✅ presente | `src/frontend/lib/api.ts:70-96` |
| **Detect Faults — Comparison** | O tipo `fonte: 'banco' \| 'fixture'` é comparado em `DemoDataBanner` (`fonte !== 'fixture'` → `null`), e a análise `banco vs fixture` agora chega à tela | ✅ presente | `src/frontend/lib/types.ts:236`, `banners.tsx:23-40` |
| **Detect Faults — Timestamp** | `geradoEm` renderizado no painel; `LoadErrorBanner` sinaliza `stale` quando há falha após carga bem-sucedida | ⚠️ parcial | `page.tsx:650-655`, `banners.tsx:73-77` — o timestamp existe mas o banner NÃO faz comparação de idade (só existência de dado prévio) |
| **Detect Faults — Timeout** | **Ausente.** `apiFetch` e `fetchGestaoPermutas` não passam `AbortSignal`; um backend pendurado deixa `loading=true` indefinidamente | ❌ ausente | `grep -rn "AbortSignal\|AbortController" src/frontend/lib` → 0 hits |
| **Detect Faults — Condition Monitoring** | Não há monitor de idade do último `geradoEm`; se o refresh falhar por horas, o texto do banner é o mesmo | ❌ ausente | `banners.tsx:53-79` |
| **Detect Faults — Self-Test** | Fail-fast do `assertDemoEnv()` no import é um self-test de configuração — se o flag chegou na build errada, o módulo estoura | ✅ presente | `src/frontend/lib/features.ts:44-53` |
| **Detect Faults — Voting** | N/A | N/A | Não há redundância de fontes para votar |
| **Contain Faults — Redundancy** | Preservação do último snapshot bem-sucedido em memória (`usePermutasData.data` não é zerado no `catch` do refresh) é redundância temporal do dado | ✅ presente | `usePermutasData.ts:39-52` |
| **Contain Faults — Recovery (forward)** | Botão "Tentar novamente" no `LoadErrorBanner` e no `EmptyState` de falha inicial; erro propaga até o estado da UI em vez de virar dado | ✅ presente | `banners.tsx:73-79`, `page.tsx:734-743` |
| **Contain Faults — Recovery (backward) / Reintroduction** | Falha de refresh mantém o snapshot anterior visível — reintroduce state por retenção do último bom | ✅ presente | `usePermutasData.ts:39-52` |
| **Recover State — Rollback** | Optimistic updates fora de escopo — o delta é read-only (painel + banners). N/A no delta | N/A | — |
| **Recover State — Repair State** | Retry manual repovoa o estado com nova carga; se falhar, o snapshot anterior segue vigente | ✅ presente | `page.tsx:726` |
| **Recover State — Idempotent Replay** | GET idempotente por natureza; retry seguro | ✅ presente | `apiFetch` GET simples |
| **Recover State — Compensating Transaction** | N/A no delta (não há escrita) | N/A | — |
| **Recover State — Reconcile** | N/A localmente; a reconciliação real vive no backend (fora do delta) | N/A | — |
| **Recover State — Quarantine** | `SessionExpiredError` roteado ao `SessionExpiredModal` em vez de misturado no estado de erro genérico — quarentena por tipo de falha | ✅ presente | `usePermutasData.ts:47,74`, `http.ts:11-19` |

## 4. Findings (achados)

### F-fault-tolerance-1: sem timeout / `AbortSignal` no `fetchGestaoPermutas` — backend pendurado deixa a UI presa

- **Severidade**: P2 (débito técnico defensável — o botão de retry mitiga)
- **Tactic violada**: Detect Faults — Timeout
- **Localização**: `src/frontend/lib/http.ts:20-32`, `src/frontend/lib/api.ts:66-121`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "AbortSignal\|AbortController" src/frontend/lib
  (0 matches)
  ```
  ```ts
  // lib/http.ts:20-32 — apiFetch não aceita nem repassa AbortSignal
  export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init)   // fetch sem deadline
    if (res.status === 401) { … }
    return res
  }
  ```
- **Impacto técnico**: se o backend (Render) começa a responder muito devagar em vez de errar, `loading` fica `true` indefinidamente, o botão "Tentar novamente" fica desabilitado (`disabled={loading}` em `banners.tsx:78`) e o painel entra em zumbi silencioso. Bass Timeout tactic é o mecanismo canônico para transformar "pendurado" em "detectado".
- **Impacto de negócio**: analista sem sinal de que o painel está travado — a UX degrada para "espera indeterminada", que ainda é melhor que o comportamento antigo (fixture plausível), mas fica aquém do que o `LoadErrorBanner` promete quando finalmente falha.
- **Métrica de baseline**: 0 chamadas com `AbortSignal` em `src/frontend/lib/`; 0 timeouts declarados. Alvo: 1 timeout finito (ex.: 30s) na chamada de `/permutas/gestao`.

### F-fault-tolerance-2: sem App Router error boundary (`app/error.tsx`) — depende integralmente do `try/catch` do hook

- **Severidade**: P2 (o delta em si é seguro; a pré-condição não é)
- **Tactic violada**: Contain Faults — Recovery / Reintroduction (Escalating Restart)
- **Localização**: `src/frontend/app/` (ausência)
- **Evidência (objetiva)**:
  ```
  $ find src/frontend/app -name "error.tsx" -o -name "global-error.tsx"
  (vazio)
  $ grep -rn "ErrorBoundary\|componentDidCatch" src/frontend --include="*.tsx"
  (vazio)
  ```
  O delta funciona porque **cada chamada de `fetchGestaoPermutas` em `usePermutasData` está dentro de um `try/catch`** (efeito de mount: `.catch(...)`; `load()`: `try/finally` com captura em `err`). Uma regressão que remova esse `catch` faz o throw viajar até o React render e — sem `error.tsx` — pinta a tela de branco.
- **Impacto técnico**: acoplamento silencioso — o correto tratamento de falha depende de disciplina em cada `useEffect`/handler. Não há rede de proteção última.
- **Impacto de negócio**: uma futura fatia que consuma `fetchGestaoPermutas` sem `try/catch` (por descuido) tem a chance de fazer o painel de baixa engolir a rota inteira em vez de mostrar um erro navegável.
- **Métrica de baseline**: 0 `error.tsx` no `app/` (`§2.3` do backlog já sinalizava). Alvo: 1 (`src/frontend/app/error.tsx`) que renderize `LoadErrorBanner` + `EmptyState` de falha e log estruturado.

### F-fault-tolerance-3: sem threshold de idade para "dado obsoleto" — banner é qualitativo

- **Severidade**: P3 (melhoria opcional; `geradoEm` já é renderizado em outro lugar)
- **Tactic violada**: Detect Faults — Condition Monitoring / Timestamp (parcial)
- **Localização**: `src/frontend/app/permutas/components/banners.tsx:53-79`
- **Evidência (objetiva)**:
  ```tsx
  // banners.tsx:73-77 — texto sem comparação temporal
  {stale
    ? 'Não foi possível atualizar a gestão de permutas — os números abaixo são da última carga bem-sucedida e podem estar desatualizados.'
    : 'Não foi possível carregar a gestão de permutas.'}
  ```
  O `data.geradoEm` é rendered em `page.tsx:650-655`, mas o banner de erro **não menciona há quanto tempo** o snapshot é. Se o refresh falha por 4h, o texto é idêntico ao de 4 minutos.
- **Impacto técnico**: analista precisa cruzar visualmente o cabeçalho de `últ. ingestão` com o banner para dimensionar a obsolescência.
- **Impacto de negócio**: para uma janela pequena (minutos) a UX está boa; para uma janela longa (horas), a mesma frase que era "razoável" passa a ser "perigosamente branda" — a analista pode acabar decidindo baixa em cima de um snapshot muito velho sem que a tela dê o alerta apropriado.
- **Métrica de baseline**: 0 comparações `Date.now() - geradoEm` no delta. Alvo: banner com escalonamento (≥15min → "desatualizado"; ≥60min → destrutivo, mesma paleta do `DemoDataBanner`).

### F-fault-tolerance-4: `assertDemoEnv()` no import de `api.ts` não tem teste de integração

- **Severidade**: P2 (o assert é a barreira de segurança contra o pior cenário; sem teste que o amarre ao callsite, uma remoção acidental não sinaliza)
- **Tactic violada**: Detect Faults — Self-Test (regressão silenciosa)
- **Localização**: `src/frontend/__tests__/features-demo-mode.test.ts`, `src/frontend/lib/api.ts:22`
- **Evidência (objetiva)**:
  ```ts
  // api.ts:22 — a única chamada de assertDemoEnv() no callpath quente
  assertDemoEnv()
  ```
  Os 6 testes de `features-demo-mode.test.ts` importam `features.ts` **diretamente** e invocam `assertDemoEnv()` como função. Nenhum verifica que **importar `api.ts`** em `NEXT_PUBLIC_ENV≠local` com `NEXT_PUBLIC_DEMO_MODE=true` estoura. Se alguém remove a linha 22, o gate desaparece sem quebrar um teste.
- **Impacto técnico**: o self-test crítico está protegido só por revisão de código, não por gate automatizado.
- **Impacto de negócio**: o próprio commit diz que "deployar demo ligado é da mesma família de erro que deployar sem gate de autenticação". Um gate de segurança dessa categoria merece um teste de integração equivalente ao que se espera para `assertAuthEnv()`.
- **Métrica de baseline**: 0 testes que exercitam `import('@/lib/api')` com env inválido. Alvo: 1 (`await expect(import('@/lib/api')).rejects.toThrow(/NEXT_PUBLIC_DEMO_MODE/)`).

### F-fault-tolerance-5: (positivo — sem card) o fix efetivamente fecha os 3 caminhos silenciosos

- **Severidade**: N/A (observação de auditoria)
- **Tactic reforçada**: Detect Faults — Sanity Checking + Comparison + Recover State — Quarantine
- **Localização**: `src/frontend/lib/api.ts:63-121`
- **Evidência (objetiva)**: `git diff` do commit `27023a9` mostra que **três estados** (empty legítimo, falha HTTP/rede/401, demo explícito) passaram a ter comportamentos distintos e sinais visuais distintos; o `catch` deixou de engolir `SessionExpiredError` (o `isDemoMode()` gate garante que apenas em demo há fallback, e a `SessionExpiredError` não é interceptada em `usePermutasData` — só filtrada do estado local para deixar o modal assumir).
- **Métrica de baseline pré-fix**: 3 caminhos silenciosos → **0**. 7 testes fixam a invariante em `permutas-fonte-dado.test.ts`, 6 em `features-demo-mode.test.ts`.

## 5. Cards Kanban

### [fault-tolerance-1] Adicionar timeout no `fetchGestaoPermutas` (e no `apiFetch` como um todo)

- **Problema**
  > `fetchGestaoPermutas` não passa `AbortSignal`; se o backend Express (Render) fica lento sem errar, o painel de permutas fica em `loading=true` indefinidamente e o botão "Tentar novamente" fica desabilitado. `grep -rn "AbortSignal" src/frontend/lib` retorna vazio — não há mecanismo de deadline no cliente HTTP.

- **Melhoria Proposta**
  > Estender `apiFetch` (`src/frontend/lib/http.ts`) para aceitar um `timeoutMs` opcional (default configurável, ex.: 30s) e usar `AbortController` internamente; propagar o `AbortError` como um `Error` de operador (`'Tempo esgotado ao consultar o backend.'`) capturado pelo `LoadErrorBanner`. Tactic Bass: **Detect Faults — Timeout**.

- **Resultado Esperado**
  > Uma requisição que ultrapasse `timeoutMs` aborta, o hook cai em `error` e o banner retry aparece — a UI não fica presa em espera indeterminada.

- **Tactic alvo**: Detect Faults — Timeout
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Chamadas com deadline: 0 → 100% das rotas de leitura críticas (`permutas/gestao`, `recebimentos/painel`)
  - Tempo máximo em `loading=true` sem sinal de erro: ∞ → ≤ `timeoutMs` (ex.: 30s)
- **Risco de não fazer**: incidente de "backend lento, painel morto" trata o mesmo modo de falha que o fix acabou de resolver, só que num outro registro — hazard permanece, mudou de forma.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Criar `app/error.tsx` como rede de proteção última do App Router

- **Problema**
  > Não existe `app/error.tsx` nem `global-error.tsx` em `src/frontend/app`. O fix depende de que cada chamada de `fetchGestaoPermutas` esteja dentro de um `try/catch` do hook — uma remoção acidental faria o throw viajar até o render e pintar a tela de branco.

- **Melhoria Proposta**
  > Criar `src/frontend/app/error.tsx` (Client Component conforme docs Next.js App Router) que renderize um `EmptyState` + botão de retry usando o próprio `reset()` do Next, e um log estruturado do erro (via `console.error` por ora, integração de telemetria fica no backlog). Considerar `app/permutas/error.tsx` escopado para não substituir a navbar. Tactic Bass: **Contain Faults — Reintroduction (Escalating Restart)**.

- **Resultado Esperado**
  > Um throw dentro de qualquer componente do `app/` cai num boundary com retry navegável em vez de white-screen.

- **Tactic alvo**: Contain Faults — Reintroduction (Escalating Restart)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Arquivos `error.tsx` em `src/frontend/app/`: 0 → ≥1
  - Cobertura de teste do boundary: 0 → ≥1 caso (throw controlado em criança + retry)
- **Risco de não fazer**: uma regressão de disciplina em qualquer futura chamada de `fetchGestaoPermutas`/`fetchPainelRecebimentos` reintroduz o modo de falha "painel morto" — o delta atual protege por convenção, não por barreira.
- **Dependências**: nenhuma; complementa o card `fault-tolerance-1`.

### [fault-tolerance-3] Escalonar o banner `stale` com idade do último `geradoEm`

- **Problema**
  > `LoadErrorBanner` (`stale=true`) diz "podem estar desatualizados" sem comparar `Date.now()` com `data.geradoEm`. Um refresh que falha por 4 minutos e um que falha por 4 horas usam a mesma frase, com o mesmo tom, na mesma cor.

- **Melhoria Proposta**
  > Passar `geradoEm` ao `LoadErrorBanner` e escalonar o texto/severidade a partir de um threshold: <15min = tom informativo, ≥15min = "desatualizado há N min", ≥60min = mesma paleta destrutiva do `DemoDataBanner`. Tactic Bass: **Detect Faults — Condition Monitoring** com **Timestamp**.

- **Resultado Esperado**
  > O grau de risco de decidir baixa com o snapshot atual fica visível na própria tela, sem exigir cruzamento manual com o cabeçalho.

- **Tactic alvo**: Detect Faults — Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Comparações `Date.now() − geradoEm` no banner: 0 → 1
  - Cobertura de teste: 0 → ≥3 casos (fresh, warn, danger)
- **Risco de não fazer**: baixo no curto prazo — mitigado pelo `geradoEm` já visível — mas a UX degrada silenciosamente na cauda longa (falhas de refresh que duram horas em jornadas de fim de mês).
- **Dependências**: depende só do `data.geradoEm` que já é propagado do backend.

### [fault-tolerance-4] Amarrar `assertDemoEnv()` ao import de `api.ts` via teste de integração

- **Problema**
  > A barreira de segurança que impede um build deployado subir com o fixture ligado (`assertDemoEnv()`) é chamada só num lugar (`src/frontend/lib/api.ts:22`), e nenhum teste garante que ela permaneça lá. `features-demo-mode.test.ts` só chama a função diretamente. Remover a linha 22 não quebra teste algum.

- **Melhoria Proposta**
  > Adicionar em `src/frontend/__tests__/permutas-fonte-dado.test.ts` (ou arquivo próprio) um caso que faz `process.env.NEXT_PUBLIC_ENV = 'prd'`, `process.env.NEXT_PUBLIC_DEMO_MODE = 'true'`, `jest.resetModules()`, e espera `await expect(import('@/lib/api')).rejects.toThrow(/NEXT_PUBLIC_DEMO_MODE/)`. Tactic Bass: **Detect Faults — Self-Test** amarrada por regressão.

- **Resultado Esperado**
  > Remover ou neutralizar `assertDemoEnv()` em `api.ts` quebra um teste, em vez de silenciosamente reabrir o pior caminho.

- **Tactic alvo**: Detect Faults — Self-Test
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Testes que amarram `assertDemoEnv()` ao callsite: 0 → 1
- **Risco de não fazer**: um refactor futuro que separe `api.ts` em módulos ou "limpe imports não usados" apaga a chamada sem sinal — e reintroduz o modo de falha "deploy demo silencioso" que o próprio commit compara ao bypass de autenticação.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo consciente: nenhum finding foi criado sobre SQS/DLQ/Lambda/idempotência de write — o delta é 100% `src/frontend/` e `infra/` não existe (declarado em `_shared-metrics.md`). Tratei essas tactics como não medíveis, não como ausentes.
- O throw introduzido pelo fix **não** é um novo hazard de white-screen na prática: ambas as chamadas de `fetchGestaoPermutas` em `usePermutasData` estão dentro de `try/catch`/`.catch`. A ausência de `error.tsx` foi anotada como P2 preventivo (F-fault-tolerance-2), não como P0 aberto pelo delta.
- Cross-QA: (a) F-fault-tolerance-1 (Timeout) tangencia Performance/Availability; (b) F-fault-tolerance-4 (self-test do gate) tangencia Security (mesmo espírito do `assertAuthEnv()`) e Testability; (c) F-fault-tolerance-2 (error boundary) tangencia Modifiability. O consolidator deve costurar.
- Métrica que tentei coletar e descartei: proporção de tenants isolados em falha (`§C-12` do prompt) — sem `infra/`/EnvironmentProvider ativo em runtime relevante, não é medível.
