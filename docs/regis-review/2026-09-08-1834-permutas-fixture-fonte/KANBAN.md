---
type: regis-review-kanban
run_id: 2026-09-08-1834-permutas-fixture-fonte
total: 27
counts: { p0: 0, p1: 4, p2: 15, p3: 8 }
gate_verdict: PASS (0 P0)
---

# Kanban — financeiro — 2026-09-08-1834-permutas-fixture-fonte

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado copiados verbatim das 8 seções QA.
> Ordem: P0 (nenhum neste run) → P1 (S) → P2 (S → M) → P3 (S → M).
> Escopo: DELTA `permutas-fixture-fonte` (commit `27023a9`, 10 arquivos, +558/−19, 100% `src/frontend/` + 1 doc de ontologia).

---

## P0 — Crítico

_Nenhum finding P0 neste run. Gate do CLAUDE.md passa; feature autorizado a seguir para rebase + bump de versão + PR._

---

## P1 — Alto

### [deployability-1] Adicionar `npm run build` ao job frontend do CI

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> O guard `assertDemoEnv()` só dispara quando algum entry importa `lib/api.ts`. Em jest testes esse import é induzido; em CI, o job frontend nunca roda `next build`, então a garantia de "o guard tranca o deploy" recai inteiramente na Vercel. Uma regressão que quebrasse silenciosamente o guard passaria verde no CI e só quebraria depois do merge.

**Melhoria Proposta**
> Acrescentar step `- run: npm run build` no job `frontend` do `.github/workflows/ci.yml`, imediatamente após `npm test`. Isso ativa o SSG do Next.js sobre as 12 rotas atuais e força o `import 'reflect-metadata'`-like efeito do `assertDemoEnv()`. Tactic Bass: **Script Deployment Commands** (aproximar CI da produção).

**Resultado Esperado**
> CI frontend com 5 steps executados por PR (typecheck, lint, test, build, cache). Regressão no guard falha em PR review, não em produção. Steps automatizados no CI frontend: 4 → 5. `next build` executado em cada PR: 0 → 1.

**Métricas de sucesso**
- Steps automatizados no CI frontend: 4 → 5
- Rotas prerenderizadas exercidas por PR: 0 → 12
- `assertDemoEnv()` exercitado por PR via `next build`: não → sim

**Risco de não fazer**
> Deploys quebrados serão detectados pela Vercel, não pelo review. Para um piloto em que a Vercel é o "prd", isso significa que o time descobre o erro depois do merge, refazendo o ciclo `revert → PR → merge → build` (perde ~15 min por incidente).

**Dependências**: Nenhuma — mudança isolada no `ci.yml`.

---

### [integrability-1] Validar no boundary FE↔BE a resposta de `/permutas/gestao` com Zod

**QA**: Integrability
**Tactic alvo**: Adhere to Standards (contract validation) + Tailor Interface
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> `fetchGestaoPermutas` faz `(await res.json()) as Partial<GestaoPermutasResponse>` (`api.ts:92`). O contrato é duplicado à mão entre BE e FE ("espelham EXATAMENTE"); nenhum guardião checa que o wire bate com o tipo. Um rename ou um novo `StatusElegibilidade` no backend chega mudo no cliente e vira KPI errado silenciosamente. Backlog `ontology/_inbox/backlog-melhorias-2026-09-02.md` §3.4 já registra o débito como P1; o delta corrigiu o mascaramento de dado, mas não fechou a detecção.

**Melhoria Proposta**
> Introduzir Zod no wrapper. Definir `gestaoPermutasResponseSchema` compartilhado (ou colocado em `src/frontend/lib/schemas/permutas.ts` e re-derivar o `type` via `z.infer`). Trocar o cast por `schema.safeParse(json)`, com log estruturado em `success=false` e `throw` (tratado pelo `LoadErrorBanner`). Iniciar por `/permutas/gestao` (endpoint corrigido no delta, tem cobertura de teste). Estender depois ao restante de `lib/api.ts` e `lib/recebimentos.ts` — não escopo deste card.

**Resultado Esperado**
> 1 wrapper (`fetchGestaoPermutas`) validando resposta contra schema; 0 casts `as Partial<T>` nesse wrapper; se BE renomear campo ou emitir enum novo, cliente falha ruidosamente com nome do campo no console + banner ao invés de KPI errado.

**Métricas de sucesso**
- Arquivos FE usando Zod: 0 → ≥1
- Casts `as Partial<T>` em `fetchGestaoPermutas`: 1 → 0
- Teste de contrato explícito (payload de shape inválido → erro nomeado): 0 → 1

**Risco de não fazer**
> Refactor de campo no BE (esperado quando as 4 frentes convergirem) chega em prod como carteira vazia ou KPI errado, sem sinal na tela — regressão sutil que o próprio delta buscou evitar.

**Dependências**: nenhuma; se `zod` ainda não estiver em `package.json` do FE, adicionar. **Cross-QA**: overlap com Security (F-security-Validate-Input) e Fault-Tolerance (F-fault-tolerance-Validate-External-Boundary) — flag conjunta para o consolidator.

---

### [performance-1] `apiFetch`: impor timeout com `AbortController` para acabar com o "loading eterno" em backend pendurado

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> `src/frontend/lib/http.ts:29-35` faz um `await fetch(input, init)` sem passar `signal` nem envelope de timeout. `grep AbortController` em `src/frontend/` retorna 0 matches. Antes do fix `permutas-fixture-fonte`, um backend pendurado virava fixture em ~0ms (comportamento errado, rápido); com o fix, a exceção sobe e `usePermutasData.load` mantém `loading=true` até o navegador desistir da conexão TCP — em Chrome desktop, potencialmente 60–120s ou nunca. A analista fica sem retry útil (`retrying=loading=true` desabilita o botão) até recarregar a aba. O gap é pré-existente (backlog §2.2 P1), mas o delta subiu o custo operacional dele.

**Melhoria Proposta**
> Adicionar timeout configurável ao `apiFetch` via `AbortController`, com default sensato (20–30s para reads, mais para uploads) e ponto de extensão via `init.signal` de fora. Compose em vez de sobrescrever (se o caller passar `signal`, usar `AbortSignal.any([external, timeoutCtrl.signal])`). Traduzir `AbortError`/`TimeoutError` em uma classe própria (`ApiTimeoutError`) para o `LoadErrorBanner` mostrar mensagem específica ("O backend não respondeu em 30s"). Bass: **Bound Execution Times**. Tocar `src/frontend/lib/http.ts` (wrapper) e opcionalmente `src/frontend/lib/api.ts` (mensagens específicas).

**Resultado Esperado**
> Backend pendurado ou lento além do budget → banner de falha visível em ≤ 30s, botão de retry habilitado, analista tem saída sem F5. Métrica observável: tempo mediano até estado terminal (dados OU banner de erro) em backend pendurado passa de "indefinido / até o navegador cortar" para "≤ 30s ± jitter". Contagem de `AbortController` em `src/frontend/` passa de 0 → ≥ 1 (em `apiFetch`).

**Métricas de sucesso**
- `grep -rn "AbortController" src/frontend/lib/http.ts`: 0 → ≥ 1
- Tempo até estado terminal em backend pendurado (medido em teste de integração com endpoint que segura resposta): **indefinido** → **≤ 30s**
- Testes cobrindo `ApiTimeoutError` bubble-up em `usePermutasData`: 0 → ≥ 1

**Risco de não fazer**
> Em qualquer janela de incidente do backend (deploy do Render, 504 do proxy, hang no pool do Postgres), a analista vê "loading" eterno na única tela que decide baixa de adiantamento — troca "dado errado rápido" (comportamento pré-delta) por "sem dado, sem sinal, sem saída". Custo operacional escala com número de analistas e frequência de incidentes.

**Dependências**: nenhuma (independente); é o mesmo item catalogado em `ontology/_inbox/backlog-melhorias-2026-09-02.md` §2.2. **Cross-QA (consolidador)**: o mesmo fix satisfaz `[availability-1]` e `[fault-tolerance-1]` — combinar em um único stroke.

---

### [testability-1] Adicionar testes de hook para `usePermutasData` — a nova seam do `error` fica auditável

**QA**: Testability
**Tactic alvo**: Specialized Interfaces + Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> `usePermutasData` (`src/frontend/app/permutas/components/usePermutasData.ts:1-82`) ficou em **0% de cobertura** mesmo depois de virar o dono do novo estado `error` — o hook é onde o guard `isSessionExpiredError` decide se a falha vira banner ou modal, e o commit `27023a9` só corrige o defeito 1.1 se essa lógica não regredir. Os testes atuais atacam as dependências (o `fetchGestaoPermutas` em `permutas-fonte-dado.test.ts` e o `SessionExpiredError` em `lib/http`) — o hook em si nunca é montado.

**Melhoria Proposta**
> Adicionar `src/frontend/app/permutas/components/usePermutasData.test.tsx` com `@testing-library/react-hooks` ou `renderHook` do `@testing-library/react`, cobrindo: (a) carga inicial de sucesso; (b) carga inicial com `Error` cru → `error` populado, `loading` false; (c) carga inicial com `SessionExpiredError` → `error` fica `null` (o modal é o dono); (d) `load()` de refresh com falha preserva `data` anterior e seta `error`; (e) unmount durante `fetch` pendente não gera `setState`. Tactic Bass alvo: **Specialized Interfaces** — o hook já é a seam, só falta exercitá-la.

**Resultado Esperado**
> Cobertura `usePermutasData.ts` **0% → ≥ 80% linhas** e cada uma das 5 combinações críticas com pelo menos 1 caso; regressão do bug do commit `27023a9` passa a estourar no CI.

**Métricas de sucesso**
- Cobertura `usePermutasData.ts` (lines): 0 → ≥ 80
- Testes exercitando o hook: 0 → ≥ 5 casos
- Branches do delta (guards de `SessionExpiredError` + `mensagemDeFalha` + `active` flag) cobertas: 0/5 → 5/5

**Risco de não fazer**
> Reincidência do defeito 1.1 (fixture servido como carteira) a uma refatoração de distância; o CI verde não defende a invariante "o que está na tela é o que está no banco".

**Dependências**: nenhuma.

---

## P2 — Médio

### [availability-1] Adicionar deadline explícito (timeout/`AbortController`) ao `apiFetch`

**QA**: Availability
**Tactic alvo**: Exception Detection (Timeout)
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> `apiFetch` (`src/frontend/lib/http.ts:29-36`) chama `fetch()` sem `signal` nem deadline. Se o backend aceita a conexão mas trava (cold start Render, pool RDS saturado, proxy intermediário mudo), o painel de permutas fica em `loading=true` indefinidamente — o `catch` que abre o banner de retry só dispara depois de o fetch rejeitar. O delta atual melhora o comportamento em ERRO, mas não em SILÊNCIO.

**Melhoria Proposta**
> Instrumentar `apiFetch` com `AbortController` e um deadline default (proposta: 15 s para leituras interativas, override por chamada). Traduzir `AbortError` em um `Error` com mensagem em pt-BR ("O backend demorou mais que o esperado — tentar de novo?"). Cobrir com teste em `src/frontend/__tests__/` que valida que uma promessa nunca-resolvida vira erro em ≤15 s. Tactic Bass: Exception Detection / Timeout.

**Resultado Esperado**
> 100% das chamadas de `apiFetch` respeitam um deadline. `loading` termina em ≤15 s mesmo com backend pendurado; o banner de retry aparece e o operador tem controle.
> - Chamadas de `apiFetch` sem `signal`: 62 → 0.
> - Tempo máximo de spinner sem sinal de erro: ilimitado → ≤15 s.

**Métricas de sucesso**
- `grep -c 'AbortController\|signal:' src/frontend/lib/http.ts`: 0 → 1
- Teste "backend pendurado → erro em ≤15 s": ausente → presente e verde

**Risco de não fazer**
> Um incidente de latência do Render vira um "app quebrou" percebido pela analista, quando na verdade é só um endpoint lento. Perde-se a chance de mostrar o banner de retry que este delta acabou de introduzir.

**Dependências**: nenhuma. **Cross-QA**: sobrepõe `[performance-1]` e `[fault-tolerance-1]` — mesma linha em `lib/http.ts`.

---

### [availability-2] Emitir sinal client-side quando `LoadErrorBanner` aparecer (base para MTTR percebido)

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-3, F-availability-1, F-availability-2

**Problema**
> O delta introduz `LoadErrorBanner` para tornar visível a falha, mas o evento não é registrado em nenhum sink. Sem esse registro, é impossível quantificar disponibilidade percebida pela analista, priorizar `availability-1` com números reais ou fechar o loop com backend/infra. `_shared-metrics.md` declara MTTR "não medível" — parte disso é opção nossa, não só ausência de `infra/`.

**Melhoria Proposta**
> Adicionar uma emissão leve (fetch fire-and-forget para um endpoint de telemetria já existente, ou console estruturado consumido por Render logs) quando `usePermutasData.load()` cai no `catch`. Payload: `{ endpoint, httpStatus, message, elapsedMs, ts }`. Excluir `SessionExpiredError` (já tem seu próprio caminho). Tactic Bass: Monitor.

**Resultado Esperado**
> Cada aparição do `LoadErrorBanner` deixa rastro. Passa a existir uma métrica auditável: "N falhas percebidas por semana no painel de permutas".
> - Eventos emitidos por falha: 0 → 1 por incidente.
> - Semanas com dado auditável de disponibilidade percebida: 0 → todas.

**Métricas de sucesso**
- Eventos client-side de falha de `fetchGestaoPermutas` roteados a um sink: 0 → 1/ocorrência
- Dashboard/relatório referenciando esses eventos: ausente → 1

**Risco de não fazer**
> Continuar sem número para defender qualquer investimento em disponibilidade (timeout, backoff, alarme). O F-availability-1 fica em P2 para sempre por falta de baseline.

**Dependências**: nenhuma (implementação com `console.warn` estruturado é suficiente na Fase 1; migrar para sink dedicado quando existir)

---

### [deployability-2] Escrever runbook curto para os dois fail-fasts (`assertAuthEnv` + `assertDemoEnv`)

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> Ambos os guards estouram no build quando uma variável de deploy está errada — mas o repo não tem documentação de como recuperar. Alguém novo no time enfrenta um build vermelho na Vercel com uma mensagem em inglês pedindo `NEXT_PUBLIC_ENV=local` e precisa raciocinar sozinho sobre "revert commit" vs "muda variável no painel".

**Melhoria Proposta**
> Criar `docs/runbooks/frontend-env-guards.md` (ou anexar em `docs/deploy/`). Conteúdo: (a) sintoma na Vercel — mensagem exata do throw; (b) causa provável — flag ligado fora de `local`; (c) recuperação em 3 passos (Vercel dashboard → project → env vars → remover `NEXT_PUBLIC_DEMO_MODE` OU setar `NEXT_PUBLIC_ENV=local`; disparar rebuild); (d) prevenção — checklist antes de tocar env do painel. Tactic Bass: **Rollback** (procedimento explícito).

**Resultado Esperado**
> Runbook consultável no repo. Recuperação de "flag errado no painel" cai de "descobrir sozinho" para 3 passos com timing conhecido. Runbooks presentes: 0 → 1.

**Métricas de sucesso**
- Runbooks de fail-fast documentados: 0 → 1
- Tempo mediano de recuperação estimado: desconhecido → alvo declarado ≤5 min (a validar em incidente real)

**Risco de não fazer**
> Recuperação vira conhecimento tribal — quando o engenheiro que criou o guard sai de férias, a próxima demo com o flag mal configurado vira uma hora perdida.

**Dependências**: Nenhuma.

---

### [fault-tolerance-1] Adicionar timeout no `fetchGestaoPermutas` (e no `apiFetch` como um todo)

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> `fetchGestaoPermutas` não passa `AbortSignal`; se o backend Express (Render) fica lento sem errar, o painel de permutas fica em `loading=true` indefinidamente e o botão "Tentar novamente" fica desabilitado. `grep -rn "AbortSignal" src/frontend/lib` retorna vazio — não há mecanismo de deadline no cliente HTTP.

**Melhoria Proposta**
> Estender `apiFetch` (`src/frontend/lib/http.ts`) para aceitar um `timeoutMs` opcional (default configurável, ex.: 30s) e usar `AbortController` internamente; propagar o `AbortError` como um `Error` de operador (`'Tempo esgotado ao consultar o backend.'`) capturado pelo `LoadErrorBanner`. Tactic Bass: **Detect Faults — Timeout**.

**Resultado Esperado**
> Uma requisição que ultrapasse `timeoutMs` aborta, o hook cai em `error` e o banner retry aparece — a UI não fica presa em espera indeterminada.

**Métricas de sucesso**
- Chamadas com deadline: 0 → 100% das rotas de leitura críticas (`permutas/gestao`, `recebimentos/painel`)
- Tempo máximo em `loading=true` sem sinal de erro: ∞ → ≤ `timeoutMs` (ex.: 30s)

**Risco de não fazer**
> Incidente de "backend lento, painel morto" trata o mesmo modo de falha que o fix acabou de resolver, só que num outro registro — hazard permanece, mudou de forma.

**Dependências**: nenhuma. **Cross-QA**: sobrepõe `[performance-1]` e `[availability-1]` — mesma linha em `lib/http.ts`, um fix resolve os três.

---

### [fault-tolerance-2] Criar `app/error.tsx` como rede de proteção última do App Router

**QA**: Fault Tolerance
**Tactic alvo**: Contain Faults — Reintroduction (Escalating Restart)
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> Não existe `app/error.tsx` nem `global-error.tsx` em `src/frontend/app`. O fix depende de que cada chamada de `fetchGestaoPermutas` esteja dentro de um `try/catch` do hook — uma remoção acidental faria o throw viajar até o render e pintar a tela de branco.

**Melhoria Proposta**
> Criar `src/frontend/app/error.tsx` (Client Component conforme docs Next.js App Router) que renderize um `EmptyState` + botão de retry usando o próprio `reset()` do Next, e um log estruturado do erro (via `console.error` por ora, integração de telemetria fica no backlog). Considerar `app/permutas/error.tsx` escopado para não substituir a navbar. Tactic Bass: **Contain Faults — Reintroduction (Escalating Restart)**.

**Resultado Esperado**
> Um throw dentro de qualquer componente do `app/` cai num boundary com retry navegável em vez de white-screen.

**Métricas de sucesso**
- Arquivos `error.tsx` em `src/frontend/app/`: 0 → ≥1
- Cobertura de teste do boundary: 0 → ≥1 caso (throw controlado em criança + retry)

**Risco de não fazer**
> Uma regressão de disciplina em qualquer futura chamada de `fetchGestaoPermutas`/`fetchPainelRecebimentos` reintroduz o modo de falha "painel morto" — o delta atual protege por convenção, não por barreira.

**Dependências**: nenhuma; complementa o card `fault-tolerance-1`.

---

### [fault-tolerance-4] Amarrar `assertDemoEnv()` ao import de `api.ts` via teste de integração

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Self-Test
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> A barreira de segurança que impede um build deployado subir com o fixture ligado (`assertDemoEnv()`) é chamada só num lugar (`src/frontend/lib/api.ts:22`), e nenhum teste garante que ela permaneça lá. `features-demo-mode.test.ts` só chama a função diretamente. Remover a linha 22 não quebra teste algum.

**Melhoria Proposta**
> Adicionar em `src/frontend/__tests__/permutas-fonte-dado.test.ts` (ou arquivo próprio) um caso que faz `process.env.NEXT_PUBLIC_ENV = 'prd'`, `process.env.NEXT_PUBLIC_DEMO_MODE = 'true'`, `jest.resetModules()`, e espera `await expect(import('@/lib/api')).rejects.toThrow(/NEXT_PUBLIC_DEMO_MODE/)`. Tactic Bass: **Detect Faults — Self-Test** amarrada por regressão.

**Resultado Esperado**
> Remover ou neutralizar `assertDemoEnv()` em `api.ts` quebra um teste, em vez de silenciosamente reabrir o pior caminho.

**Métricas de sucesso**
- Testes que amarram `assertDemoEnv()` ao callsite: 0 → 1

**Risco de não fazer**
> Um refactor futuro que separe `api.ts` em módulos ou "limpe imports não usados" apaga a chamada sem sinal — e reintroduz o modo de falha "deploy demo silencioso" que o próprio commit compara ao bypass de autenticação.

**Dependências**: nenhuma. **Cross-QA (consolidator)**: par natural com `[security-2]` — o mesmo par de defesa do guard novo.

---

### [integrability-3] Mover a agregação `totais` para 100% server-side

**QA**: Integrability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> `fetchGestaoPermutas` recomputa `totais` caso o backend omita (`api.ts:103-113`), replicando a lógica de `GestaoPermutasService.ts:199-208`. Hoje o BE sempre emite — o ramo é código morto. Amanhã, quando um `StatusElegibilidade` novo for introduzido, o ramo do FE devolve contagem stale sem alerta.

**Melhoria Proposta**
> Remover o fallback `?? { … }` no `api.ts:103`. Se o schema (F-1) obrigar `totais` presente, o Zod já cobre. Caso contrário, `throw new Error('resposta sem totais')` com log estruturado — a tela cai no `LoadErrorBanner`, que é o comportamento correto quando o contrato quebra. Alternativa suave: manter o fallback só em `NEXT_PUBLIC_DEMO_MODE=true`.

**Resultado Esperado**
> 1 função de agregação, no BE. FE virou renderer.

**Métricas de sucesso**
- Duplicação de lógica de contagem BE↔FE: 2 sítios → 1
- LOC no `api.ts` do bloco `totais`: 11 → 0

**Risco de não fazer**
> Adição de status vira KPI incorreto no dia em que o BE deixar de emitir `totais` (uma refactor bem-intencionada).

**Dependências**: `integrability-1` (validação de schema torna a remoção segura).

---

### [modifiability-1] Extrair `LoadErrorBanner` para `components/ui/` e consolidar o banner de erro de Recebimentos

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-2, F-modifiability-4, F-modifiability-5

**Problema**
> O delta criou `LoadErrorBanner` em `app/permutas/components/banners.tsx:44-79` com o shape "banner destrutivo + retry + dado prévio preservado". `app/recebimentos/page.tsx:380-410` já fazia a mesma coisa inline há mais de um ciclo, com variação visual mínima (`bg-danger/5` vs `bg-danger-subtle`). Um bug fix na UX de erro custa 2 arquivos hoje; uma 3ª tela (SISPAG) copia-cola.

**Melhoria Proposta**
> Aplicar **Abstract Common Services**: mover `LoadErrorBanner` para `src/frontend/components/ui/RetryErrorBanner.tsx`, com props genéricas (`message, onRetry, retrying, stale`). Refatorar o bloco inline de `app/recebimentos/page.tsx:380-410` para consumi-lo. Manter `DemoDataBanner` em `app/permutas/components/` (permutas-específico). Alinhar a variação de background com `patterns.md §Error states`.

**Resultado Esperado**
> 1 componente em `components/ui/`, 2 consumidores (permutas + recebimentos), 0 blocos inline. Um bug fix futuro na UX de erro toca 1 arquivo.

**Métricas de sucesso**
- Sítios com o shape "banner erro + retry": 2 → 1
- Fan-in de `RetryErrorBanner`: — → 2
- LOC em `app/recebimentos/page.tsx`: 727 → ~700 (−27)

**Risco de não fazer**
> Em 6 meses SISPAG ganha o mesmo banner por copy-paste; drift visual entre 3 telas; correção de acessibilidade (`aria-live`, contraste) exige N PRs.

**Dependências**: nenhuma — pode entrar como `/feature-tweak` isolado.

---

### [performance-2] Dynamic-import do `gestaoPermutasFixture` atrás de `isDemoMode()`

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> `src/frontend/lib/api.ts:19` faz `import { gestaoPermutasFixture } from './permutas-fixture'` no topo do módulo. `permutas-fixture.ts` tem 227 linhas / 6.441 bytes de dados de exportadores reais (DBP PIPING, CENTENO, QINGDAO COVENANT etc.). Como `lib/api.ts` é a espinha da UI, o bundler inclui o fixture nos chunks que compõem qualquer tela que use a API — confirmado: strings do fixture aparecem em 3 chunks distintos do `.next/static/chunks/`. `assertDemoEnv()` (`features.ts:52`) garante que o modo demo só vale em `local`, então em qualquer build deploiado (Vercel, prod ou staging) o fixture é dead code — pago por todo usuário, todo primeiro-load.

**Melhoria Proposta**
> Trocar o import estático por dinâmico dentro dos dois braços que realmente usam:
> ```ts
> if (vazia && isDemoMode()) {
>   const { gestaoPermutasFixture } = await import('./permutas-fixture')
>   return gestaoPermutasFixture
> }
> ```
> Idem no `catch`. Como `isDemoMode()` retorna `false` em produção (fixado pelo build via `NEXT_PUBLIC_DEMO_MODE`), o Next/Turbopack isolará o fixture num chunk separado que só carrega em demo. Bass: **Reduce Overhead / Bundle Leanness**. Tocar `src/frontend/lib/api.ts` (linhas 19, 96, 118) e revisar se algum outro path futuro deva usar o mesmo padrão.

**Resultado Esperado**
> Chunks de produção deixam de conter as strings de exportadores do fixture. Consumidores runtime em produção: 0. Custo por primeiro-load: diminui em ~1.8–2.5 KB gzip estimado (não isolado — é upper bound). Métrica observável: `grep -l "DBP PIPING" .next/static/chunks/*.js` passa de 3 chunks → 1 chunk (ou 0, se `isDemoMode()=false` for const-inlineado no build) desde que o build seja feito com `NEXT_PUBLIC_DEMO_MODE` diferente de `'true'`.

**Métricas de sucesso**
- Chunks que contêm strings do fixture com build de produção (`NEXT_PUBLIC_DEMO_MODE!=true`): 3 → 0 (ideal) ou 1 (chunk isolado, lazy)
- Tamanho gzip do bundle de `/permutas` primeiro-load: −~1.8 a −2.5 KB (medir com `next build` antes/depois)

**Risco de não fazer**
> O débito é pequeno em absoluto mas viola o princípio declarado em `features.ts:36-44` — "dado falso na tela nunca é o comportamento desejado por omissão". Se o dado é proibido em produção, o código dele também deveria ser. Custo real cresce se novos fixtures forem adicionados no mesmo padrão.

**Dependências**: nenhuma; refactor local em `api.ts`. **Cross-QA (consolidator)**: mesmo fix satisfaz `[security-1]`.

---

### [security-1] Não publicar nomes reais de exportadores no bundle client de produção

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-1

**Problema**
> `lib/permutas-fixture.ts` traz 8 nomes reais de fornecedores (DBP PIPING, QINGDAO COVENANT, CENTENO INTERNATIONAL, PANTECH, NORMET OY, DAH SOLAR, JINDAL STAINLESS, SUN MARK) e valores em USD sondados no Conexos real. `lib/api.ts` faz `import { gestaoPermutasFixture } from './permutas-fixture'` estaticamente, então o fixture viaja no bundle client mesmo com `NEXT_PUBLIC_DEMO_MODE=false`. O build atual (`.next/static/chunks/*.js`) tem 3 chunks contendo "DBP PIPING" (~91 KB). Nomes de fornecedor da Columbia são informação comercial; publicá-los no bundle é vazá-los para qualquer visitante do site (chunks estáticos costumam servir sem authz na Vercel). O delta corrigiu o comportamento de *renderização*, mas não removeu o material do bundle.

**Melhoria Proposta**
> Duas opções (a preferida é a primeira):
> 1) **Dynamic import gated**: trocar o `import { gestaoPermutasFixture } from './permutas-fixture'` no topo de `lib/api.ts` por `await import('./permutas-fixture')` dentro do branch `if (isDemoMode())`. Com bundler moderno, o fixture cai em chunk separado e o bundler o carrega SÓ quando demo mode está ligado no build. Bass: **Limit Exposure**.
> 2) **Pseudonimizar**: substituir os 8 nomes reais por rótulos fictícios (`EXPORTADOR ALPHA`, `FORNECEDOR BETA`, etc.) e valores redondos. Preserva o "aparência de dado real" para demo sem vazar o mapa de fornecedores. Combinável com (1).
> Arquivos a tocar: `src/frontend/lib/api.ts`, `src/frontend/lib/permutas-fixture.ts`. Adicionar teste que confirma que o chunk `.next` de uma build com demo OFF **não** contém string "DBP PIPING" (pode ser um `check-bundle.mjs` no CI).

**Resultado Esperado**
> Nomes de fornecedor da Columbia não circulam no bundle client de builds de produção. `grep -l "DBP PIPING" .next/static/chunks/*.js` retorna 0.

**Métricas de sucesso**
- Chunks do bundle contendo "DBP PIPING": 3 → 0
- Bytes de fixture no bundle client (demo OFF): ~91 KB → 0
- Nomes reais no `permutas-fixture.ts`: 8 → 0 (se optar por pseudonimizar)

**Risco de não fazer**
> Relacionamentos comerciais da Columbia expostos no HTML servido pela Vercel. Em 6 meses o repo pode ter mais fixtures da mesma safra (Frente III/IV também "ancoraram" em dados reais); a prática vira norma.

**Dependências**: nenhuma. **Cross-QA (consolidator)**: mesmo fix satisfaz `[performance-2]`.

---

### [security-2] Chamar `assertDemoEnv()` no root layout, alinhando com `assertAuthEnv()`

**QA**: Security
**Tactic alvo**: Change Default Settings
**Esforço**: S
**Findings**: F-security-2, F-security-1 (mitigação secundária)

**Problema**
> `assertAuthEnv()` roda no topo do módulo `AuthProvider.tsx`, que é importado pelo root layout (`app/layout.tsx`) — logo é executado em TODA rota. `assertDemoEnv()` roda no topo de `lib/api.ts` — logo só é executado em rotas que importam esse módulo. O próprio comentário em `features.ts` reivindica paridade ("Fail-fast, espelhando `assertAuthEnv()`"), mas ela não existe: um build com `DEMO=true, ENV=prd` renderiza `/login` e a home normalmente e só quebra ao abrir `/permutas`. Isso abre janela onde o QA smoke pode declarar "verde" enquanto a rota crítica está armada.

**Melhoria Proposta**
> Mover a chamada `assertDemoEnv()` para o mesmo lugar de `assertAuthEnv()` — topo de `AuthProvider.tsx` (ou de um módulo carregado pelo root layout, ex.: `src/frontend/app/layout.tsx` importando um novo `lib/env-guards.ts` que agrega os dois asserts). Manter a chamada em `lib/api.ts` como cinto-e-suspensório é aceitável. Bass: **Change Default Settings**.
> Adicionar teste E2E (Playwright / smoke) que roda `NEXT_PUBLIC_DEMO_MODE=true NEXT_PUBLIC_ENV=prd next build` e valida que qualquer navegação estoura na primeira rota renderizada — não só em `/permutas`.

**Resultado Esperado**
> Um build misconfigurado com `DEMO=true, ENV≠local` estoura na primeira rota renderizada, independente de qual seja. Guards fail-fast em coverage paridade com autenticação.

**Métricas de sucesso**
- Rotas onde `assertDemoEnv()` NÃO roda: N → 0
- Guards executados no root layout: 1 → 2

**Risco de não fazer**
> Um deploy acidental com demo ligado renderiza login e home antes de estourar; QA visual pode dar "verde"; a hora que estoura é a hora que o analista tenta trabalhar.

**Dependências**: nenhuma. **Cross-QA (consolidator)**: par natural com `[fault-tolerance-4]` — juntos são a defesa do guard novo.

---

### [deployability-3] Verificação programática das variáveis de deploy da Vercel antes de promover para prd

**QA**: Deployability
**Tactic alvo**: Package Dependencies
**Esforço**: M
**Findings**: F-deployability-3

**Problema**
> O guard `assertDemoEnv()` é reativo: quebra o build quando a variável está errada. Isso protege prd de servir dados falsos, mas o operador só descobre o erro *depois* de tentar deployar. Para uma equipe pequena em piloto, cada erro de configuração custa 3-5 min de rebuild inútil.

**Melhoria Proposta**
> Acrescentar step opcional no `ci.yml` (ou script em `scripts/check-vercel-env.mjs`) que, usando o Vercel CLI/API (`vercel env ls`), leia as env vars do projeto e reprove o CI se `NEXT_PUBLIC_DEMO_MODE=true` estiver setado para `preview` ou `production`. Tactic Bass: **Package Dependencies** (o `.env.example` é o contrato — validá-lo contra o painel fecha o loop).

**Resultado Esperado**
> Erros de configuração de painel viram falha de CI antes do build. Cheque pró-ativo em vez de reativo. Config-checks no CI: 0 → 1.

**Métricas de sucesso**
- Env vars validadas por CI: 0 → 2 (`NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_DEV_AUTH_BYPASS`)
- Reprovação de config errada shift-left: build (na Vercel) → PR (no GitHub)

**Risco de não fazer**
> Baixo — o fail-fast já protege prd. O ganho é DX, não segurança de dados.

**Dependências**: Token Vercel disponível como secret do GitHub Actions da org.

---

### [integrability-2] Colapsar a duplicação `interface/permutas/Gestao.ts` ↔ `lib/types.ts`

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: M
**Findings**: F-integrability-2, F-integrability-1

**Problema**
> O contrato `GestaoPermutasResponse` (e amigos) vive em dois arquivos que "espelham EXATAMENTE" um ao outro (`src/backend/domain/interface/permutas/Gestao.ts:1-4`, `src/frontend/lib/types.ts:232-262`). Nada além da disciplina do dev garante a sincronia; um consumidor terceiro (job/relatório/mobile) copiaria uma terceira cópia. MTTR de mudança de contrato dobra.

**Melhoria Proposta**
> Duas rotas realistas no monorepo atual (não há workspace publicado):
> 1. **Publicar o `interface/permutas/*.ts` do BE em `src/shared/contracts/`** e importar tanto do FE quanto do BE via path relativo/alias TS. Requer ajuste de `tsconfig` e do `paths` do Next. Mais barato; casa com CLAUDE.md.
> 2. **Emitir os tipos a partir do schema Zod** (combina com integrability-1): `z.infer` no BE e no FE, um único arquivo. Mais caro, mas destranca F-1.
> Escolher (2) se o backlog aprovar Zod primeiro; senão (1).

**Resultado Esperado**
> 1 arquivo autoritativo (BE + FE) para o wire de `/permutas/gestao`. Mudança de campo = 1 edit + tsc rebate os dois consumidores.

**Métricas de sucesso**
- Sítios com definição de `GestaoPermutasResponse`: 2 → 1
- LOC de types duplicados (~30 linhas por contrato) → 0
- Nº de contratos wire duplicados no repo (Gestao, Recebimentos, SISPAG…): auditar; alvo global 0

**Risco de não fazer**
> Drift silencioso quando as 4 frentes evoluírem em paralelo (Permutas / SISPAG / GED / Recebimentos).

**Dependências**: idealmente sequenciar após integrability-1 (Zod → `z.infer` = types "de graça").

---

### [modifiability-4] Split de `app/permutas/page.tsx` — extrair as 5 abas para arquivos irmãos

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-1

**Problema**
> `page.tsx` tem 1065 LOC e 35 imports pós-delta (crescimento líquido de +27 neste fix). O delta fez a coisa certa extraindo `banners.tsx` e `usePermutasData.ts`, mas o arquivo raiz continua bem acima do corte p95 de 600. Feature nova em permutas paga um imposto grande de navegação e conflito de rebase.

**Melhoria Proposta**
> Aplicar **Split Module**: extrair a definição de cada aba (composição do JSX + handlers específicos da aba) de dentro de `GestaoPermutasPage()` para `app/permutas/components/PainelGeral.tsx`, `PainelAutomaticas.tsx`, `PainelMultiplas.tsx`, etc. `page.tsx` fica com o hook, os dialogs dinâmicos e o `<Tabs>` orquestrador. Não mexer nas `AbaAutomaticas.tsx`/`AbaMultiplas.tsx`/... existentes — o alvo é o wrapper de aba, não os componentes de linha.

**Resultado Esperado**
> `page.tsx` ≤ 400 LOC, ≤ 20 imports. Cada aba fica testável isoladamente e o custo de PR paralelos em abas diferentes cai.

**Métricas de sucesso**
- LOC de `page.tsx`: 1065 → ≤ 400
- Imports em `page.tsx`: 35 → ≤ 20
- Suítes de teste por aba: 0 (hoje) → 1 por aba

**Risco de não fazer**
> 3 outras telas idem (`sispag/page.tsx` 1068, `recebimentos/page.tsx` 727, `recebimentos/components/AlocarProcessosDialog.tsx` 928) já sinalizam que o padrão "página gigante" é a norma do repo — sem sair da primeira agora a norma consolida.

**Dependências**: nenhuma técnica. Deve ser um `/feature-tweak` próprio, **não** encaixado num fix urgente.

---

### [testability-2] Teste de composição para `app/permutas/page.tsx` — a matriz `data × error × fonte`

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity + Executable Assertions
**Esforço**: M
**Findings**: F-testability-2

**Problema**
> A composição que este PR desenhou — `DemoDataBanner` sempre no topo, `LoadErrorBanner` só se `data` existir, `EmptyState` com `AlertTriangle` se `!data` (`app/permutas/page.tsx:724-744`) — vive num arquivo de 1059 LOC com 0% de cobertura. Os banners têm 100% em isolamento; a matriz de estados que decide qual aparece em qual cenário não tem teste.

**Melhoria Proposta**
> Extrair a montagem dos 3 estados para um subcomponente `PermutasHeader` (ou similar) — não a página inteira, só o bloco `l.724-744` que compõe banners + empty-state — e adicionar `PermutasHeader.test.tsx` com uma matriz explícita: (a) `data.fonte='banco' + error=null` → nenhum banner; (b) `data.fonte='fixture'` → `DemoDataBanner` visível; (c) `data≠null + error='API 500'` → `LoadErrorBanner` visível com dados preservados; (d) `data=null + error='API 500'` → `EmptyState` com `AlertTriangle`. Tactic Bass alvo: **Limit Structural Complexity** (fatia a página grande) + **Executable Assertions** (a invariante `ontology/ui-flows/fonte-do-dado-permutas.md` vira teste).

**Resultado Esperado**
> Subcomponente `PermutasHeader` com cobertura ≥ 90% linhas; 4 combinações críticas de estado (`data × error × fonte`) 0/4 → 4/4 testadas; `page.tsx` reduz em ~20 LOC de composição.

**Métricas de sucesso**
- Combinações `data × error × fonte` cobertas: 0/4 → 4/4
- LOC de `page.tsx`: 1059 → ~1039 (a composição sai)
- Cobertura do subcomponente extraído: — → ≥ 90 lines

**Risco de não fazer**
> A invariante "o que está na tela é o que está no banco" fica só na ontologia; a próxima refatoração do topo da página pode reintroduzir o defeito 1.1.

**Dependências**: nenhuma; independente de [testability-1].

---

## P3 — Baixo

### [availability-3] Documentar política explícita de retry (manual vs. automático) para painéis human-in-loop

**QA**: Availability
**Tactic alvo**: Increase Competence Set
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> O delta escolheu retry manual (botão), e a escolha é sólida para um painel onde a analista decide baixa de adiantamento, mas não está escrita em lugar nenhum. Novas telas do mesmo domínio (Recebimentos, SISPAG, GED) tendem a copiar padrões sem entender a razão — corre-se o risco de alguém adicionar retry automático agressivo no `RetryExecutor` do backend + retry automático no cliente e criar contenção sobre o Render.

**Melhoria Proposta**
> Adicionar seção em `docs/design-system/patterns.md` §Error states (ou complementar `ontology/ui-flows/fonte-do-dado-permutas.md`) explicitando: (a) painéis human-in-loop = retry manual; (b) exceção: chamadas idempotentes leves com deadline curto podem ter 1 retry automático com jitter; (c) mutações permanecem sem retry automático no cliente. Tactic Bass: Increase Competence Set.

**Resultado Esperado**
> Próximo `/feature-new` de painel financeiro parte da política escrita, não de um chute copiado. Reduz retrabalho em revisão.
> - Documento de política de retry cliente-side: ausente → presente.
> - Referência cruzada nos docblocks de `usePermutasData` / `apiFetch`: 0 → 2.

**Métricas de sucesso**
- Seção "Retry policy" em `docs/design-system/patterns.md`: ausente → presente
- PRs futuros no domínio citam a política: baseline 0 → objetivo ≥1 na próxima feature de painel

**Risco de não fazer**
> Proliferação de padrões inconsistentes nos painéis IV (Recebimentos) e II (SISPAG) — cada tela decidindo por conta própria se refetcha em background, se retorna dado stale, se re-empilha requisições no clique múltiplo.

**Dependências**: nenhuma

---

### [fault-tolerance-3] Escalonar o banner `stale` com idade do último `geradoEm`

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults — Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> `LoadErrorBanner` (`stale=true`) diz "podem estar desatualizados" sem comparar `Date.now()` com `data.geradoEm`. Um refresh que falha por 4 minutos e um que falha por 4 horas usam a mesma frase, com o mesmo tom, na mesma cor.

**Melhoria Proposta**
> Passar `geradoEm` ao `LoadErrorBanner` e escalonar o texto/severidade a partir de um threshold: <15min = tom informativo, ≥15min = "desatualizado há N min", ≥60min = mesma paleta destrutiva do `DemoDataBanner`. Tactic Bass: **Detect Faults — Condition Monitoring** com **Timestamp**.

**Resultado Esperado**
> O grau de risco de decidir baixa com o snapshot atual fica visível na própria tela, sem exigir cruzamento manual com o cabeçalho.

**Métricas de sucesso**
- Comparações `Date.now() − geradoEm` no banner: 0 → 1
- Cobertura de teste: 0 → ≥3 casos (fresh, warn, danger)

**Risco de não fazer**
> Baixo no curto prazo — mitigado pelo `geradoEm` já visível — mas a UX degrada silenciosamente na cauda longa (falhas de refresh que duram horas em jornadas de fim de mês).

**Dependências**: depende só do `data.geradoEm` que já é propagado do backend.

---

### [modifiability-2] Fatorar `createEnvGuard()` para unificar `features.ts` e `auth/env.ts`

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> Pós-delta o repo tem **dois** pares quase idênticos: `isDevAuthBypass`+`assertAuthEnv` (`lib/auth/env.ts`) e `isDemoMode`+`assertDemoEnv` (`lib/features.ts`). Ambos duplicam a constante `LOCAL_ENV`, o teste `if (flag && env !== 'local') throw`, e a mensagem de erro. O comentário em `features.ts:44` reconhece explicitamente o espelhamento. Uma 3ª flag perigosa (ex.: mock de billing amanhã) fará 3 cópias.

**Melhoria Proposta**
> Aplicar **Abstract Common Services**: criar `src/frontend/lib/env-guard.ts` com `createEnvGuard({ flagName, description, whenNonLocalThrows })` que devolve `{ isEnabled, assertEnv }`. `features.ts` e `auth/env.ts` passam a chamar a fábrica. Manter a semântica exata dos dois erros atuais (mensagens específicas — a lib repassa o `description`).

**Resultado Esperado**
> 1 módulo `env-guard.ts` (~30 LOC) + `features.ts` e `auth/env.ts` reduzidos a ~15 LOC cada. Padrão consolidado, pronto para a 3ª flag perigosa.

**Métricas de sucesso**
- Sítios com o shape `is*Enabled`+`assert*Env`+`LOCAL_ENV` duplicado: 2 → 1
- LOC combinada `features.ts`+`auth/env.ts`: 101 → ~70

**Risco de não fazer**
> Cada flag `NEXT_PUBLIC_*` perigosa nova replica ~10 linhas + o risco de esquecer o `assert…Env()` no consumidor; convenção não fica óbvia para quem entra depois.

**Dependências**: nenhuma.

---

### [modifiability-3] Genericar `DemoDataBanner` para desacoplar do tipo `GestaoPermutasResponse`

**QA**: Modifiability
**Tactic alvo**: Restrict Dependencies
**Esforço**: S
**Findings**: F-modifiability-4

**Problema**
> `banners.tsx:23` importa `GestaoPermutasResponse` de `lib/types` só para descrever o prop `fonte`. O componente lógico só precisa saber se `fonte === 'fixture'`.

**Melhoria Proposta**
> Aplicar **Restrict Dependencies**: trocar a assinatura para `{ fonte: 'fixture' \| 'banco' }` (union literal). Remover o import de `GestaoPermutasResponse`. Manter `DemoDataBanner` em `app/permutas/components/` — o texto do banner segue permutas-específico ("carteira"), mas o **tipo** deixa de vazar.

**Resultado Esperado**
> `banners.tsx` fica sem import de tipo de domínio. Pré-requisito ergonômico para uma futura mudança do enum de fonte (ex.: acrescentar `'cache'`) não obrigar a mexer no banner.

**Métricas de sucesso**
- Imports de tipos de domínio em `banners.tsx`: 1 → 0

**Risco de não fazer**
> Qualquer reuso futuro do componente arrasta o tipo permutas junto.

**Dependências**: nenhuma; combinável com o card modifiability-1.

---

### [performance-3] Retry granular no `load()`: só re-chamar o que falhou

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-3

**Problema**
> `usePermutasData.load` (`usePermutasData.ts:43-58`) sempre dispara `fetchGestaoPermutas()` (síncrono) E `void carregarStatus()` (best-effort). Se a última falha foi só no `/permutas/status`, o `/gestao` é refeito por igual. `/status` bate no Conexos, que em produção pode custar 2–10s p99 (CLAUDE.md — "Conexos pode ser lento"), então retry cego amplifica lentidão do Conexos.

**Melhoria Proposta**
> Distinguir `error` de `/gestao` de `error` de `/status`; o botão "Tentar novamente" só re-executa o endpoint que falhou. Duas opções: (a) split de estados (`errorGestao` / `errorStatus`, dois retries separados); (b) `load()` aceitar um argumento `{ scope: 'all' | 'gestao' | 'status' }`. (b) é mais barato e mantém a API do hook enxuta. Bass: **Increase Resource Efficiency**. Tocar `src/frontend/app/permutas/components/usePermutasData.ts` e o callsite `LoadErrorBanner` em `page.tsx:726`.

**Resultado Esperado**
> Retry re-executa 1 endpoint em vez de 2 quando só um falhou. Métrica observável: chamadas por retry, se a falha foi só em `/status`: 2 → 1 (redução de 50% no fan-out de retry). Latência de retry (dominada pelo Conexos): variável — não medível localmente, mas o pior caso deixa de dobrar chamadas ao ERP.

**Métricas de sucesso**
- Chamadas por retry quando só `/status` falhou: 2 → 1
- Testes cobrindo retry granular no `usePermutasData`: 0 → ≥ 1

**Risco de não fazer**
> Baixo — é otimização de borda; o custo atual é limitado pelas latências reais de `/gestao` (cheap por design) e `/status` (lazy, best-effort). Vira dor real só se o volume de retries crescer OU se o Conexos entrar em degradação prolongada.

**Dependências**: nenhuma

---

### [security-3] Não jogar mensagem de erro do backend crua no banner

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-3

**Problema**
> `lib/api.ts` compõe `Error("API ${res.status} — ${j.error}")` em 8 fetchers e o `LoadErrorBanner` renderiza esse texto entre parênteses para o operador. Se o backend responde `{ error: "PostgresError: ..." }` ou um traceback, o operador vê. Não é XSS (React escapa), mas é vazamento passivo de stack (nomes de tabela, biblioteca, path de arquivo).

**Melhoria Proposta**
> No frontend: manter só `API ${status}` na `Error.message` e mover o `j.error` para `console.warn`/telemetria. Alternativa mais leve: mapear `res.status` para uma mensagem humana em pt-BR (`500 → 'erro interno no backend'`, `502/503/504 → 'backend indisponível'`, `401 → já tratado pelo SessionExpiredModal`) e usar `j.error` só quando ele vier de um erro *de negócio* explícito (ex.: 409 de ingestão em andamento, 422 de saldo — que já têm tratamento próprio). No backend (fora deste delta, mas necessário como par): sanitizar o `error` do JSON antes de responder — nunca mandar stack. Bass: **Limit Exposure**.
> Arquivos a tocar: `src/frontend/lib/api.ts` (pattern `if (!res.ok)`), `src/frontend/app/permutas/components/banners.tsx` (opcional: mudar a formatação).

**Resultado Esperado**
> Mensagens de erro que chegam ao operador têm forma humana (`erro interno no backend`) em pt-BR, sem trecho do backend. Detalhes ficam em `console` / telemetria para debug.

**Métricas de sucesso**
- Sítios em `lib/api.ts` que fazem `throw new Error("API ${status} — ${j.error}")`: 8 → 0 (ou mapa curado)
- Mensagens de erro renderizadas ao usuário contendo trecho verbatim do backend: >0 → 0

**Risco de não fazer**
> Reconhecimento passivo de stack backend em cada erro de produção. Baixo isoladamente, real em conjunto com outros achados (F-security-1).

**Dependências**: pareamento com uma passagem de sanitização no Express (fora deste delta).

---

### [testability-3] Helper `withMockedEnv` para sandboxear `NEXT_PUBLIC_*` uma vez só

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> O padrão `envOriginal` + `jest.resetModules()` + restauração está replicado em `__tests__/features-demo-mode.test.ts` e `__tests__/permutas-fonte-dado.test.ts`. O padrão é correto, mas cada nova suíte que mexer em `NEXT_PUBLIC_*` reimplementa as três coisas — omissão de qualquer uma delas volta o leakage entre suítes.

**Melhoria Proposta**
> Extrair um helper `withMockedEnv(overrides: Record<string, string \| undefined>)` em `src/frontend/__tests__/helpers/env.ts` que faz snapshot no `beforeEach`, aplica overrides, chama `jest.resetModules()` e restaura no `afterEach`/`afterAll`. Migrar as duas suítes existentes. Tactic Bass alvo: **Sandbox** encapsulada.

**Resultado Esperado**
> 1 helper compartilhado; 2 suítes usam o helper em vez do padrão in-line; teste novo de env-flag passa a pedir 1 linha (`withMockedEnv({ NEXT_PUBLIC_DEMO_MODE: 'true' })`) em vez de 10.

**Métricas de sucesso**
- Duplicação do bloco env-sandbox: 2 cópias → 0
- Suítes que dependem do helper: 0 → 2

**Risco de não fazer**
> Baixo hoje; débito preventivo — cresce linearmente com o número de flags `NEXT_PUBLIC_*` (já existem `SISPAG_ENABLED`, `DEMO_MODE`, `API_URL`, `ENV`).

**Dependências**: nenhuma.

---

### [integrability-4] Extrair fixture de demo do wrapper HTTP

**QA**: Integrability
**Tactic alvo**: Restrict Communication Paths + Abstract Common Services
**Esforço**: M
**Findings**: F-integrability-4, F-integrability-5

**Problema**
> `fetchGestaoPermutas` importa `gestaoPermutasFixture` e escolhe fonte de dado dentro do wrapper HTTP (`api.ts:19,99,115`). Isso mistura I/O com "modo demo" e cria dependência ativa entre a camada de rede e um dataset de teste — qualquer novo consumidor do endpoint reimporta o fixture ou reimplementa o `isDemoMode()`.

**Melhoria Proposta**
> Trocar o branch por MSW (`msw` handlers ligados quando `NEXT_PUBLIC_DEMO_MODE=true`), ou por uma injeção via `dataSourceProvider` que decide entre HTTP e in-memory. Um `fetchGestaoPermutas` puro apenas fala com o backend; o modo demo é resolvido antes de chegar em `fetch`.

**Resultado Esperado**
> Wrapper HTTP com uma responsabilidade só: rede. Fixture consumido por handler MSW ou provider — reusável, testável, e sem crescer o `api.ts` a cada endpoint que precise de demo.

**Métricas de sucesso**
- Imports de `permutas-fixture` em `lib/api.ts`: 1 → 0
- Nº de endpoints que precisariam de branch `isDemoMode()` no wrapper: N → 0

**Risco de não fazer**
> Cada novo endpoint que precise de demo repete o padrão; quando novas telas surgirem em Permutas/SISPAG/GED com `NEXT_PUBLIC_DEMO_MODE`, o `api.ts` acumula branches.

**Dependências**: baixo. Independente de F-1/F-2/F-3.

---

## Rodapé — nota sobre findings sem card

- **F-fault-tolerance-5** (positivo, sem card): observação de auditoria confirmando que o fix efetivamente fecha os 3 caminhos silenciosos. Está em `fault-tolerance.md §4`.
- **F-integrability-5** (P3, observacional, sem card): reforço positivo — o padrão `recebimentos` já migrou antes; `permutas` completa a norma. Registrado em `integrability.md §4`.
- **F-testability-3** (P3, threshold global desatualizado, deliberadamente sem card): o consolidator concorda com a justificativa do agent — rebater floor global toda vez que um arquivo sobe a 100 é anti-padrão. Solução correta é threshold por diretório, escopo do próximo review de cobertura, não deste delta. Registrado em `testability.md §5` como "sem card".
- **F-modifiability-5** (P3, sem card explícito): rebaixado pelo agent porque `LoadErrorBanner` ainda tem fan-in 1; será absorvido por `[modifiability-1]` quando executado.
- **F-availability-2** (P3): apenas documentação; virou card `[availability-3]`.

## Rodapé — follow-up do consolidator não-verbatim (não conta nos 27)

Durante a consolidação foi observado que `src/frontend/lib/recebimentos.ts:9-11` ainda contém um comentário de header afirmando que existe um fallback para fixture — o que era verdade em ciclo anterior, mas é falso hoje (o arquivo lança e sempre retorna `fonte: 'banco'`). Recomendação: pequeno card doc-only, esforço XS, P3, adicionado ao inbox de follow-ups (`ontology/_inbox/permutas-fixture-fonte-regis-followups.md`). **Não integra os 27 cards deste run** — nenhuma das 8 QAs emitiu card corretivo para esse comentário; F-integrability-5 é uma observação positiva, não corretiva.
