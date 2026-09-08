---
type: regis-review-report
run_id: 2026-09-08-1834-permutas-fixture-fonte
generated_at: 2026-09-08T18:41:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: delta review (commit 27023a9 — 10 arquivos, +558/−19, 100% src/frontend/ + 1 doc de ontologia)
total_findings: 31
total_cards: 27
total_p0: 0
total_p1: 4
total_p2: 15
total_p3: 8
overall_score: 7.5
gate_verdict: PASS (0 P0 — P1/P2/P3 seguem para inbox como follow-ups)
---

# Regis-Review — financeiro — 2026-09-08-1834-permutas-fixture-fonte

> **Escopo desta run.** Review de DELTA — commit `27023a9`, 10 arquivos, +558/−19, 100%
> `src/frontend/` + 1 doc de ontologia. Nenhuma linha de `src/backend/`, `infra/` (inexistente
> neste repo — Terraform/SSM/Lambda são estado-**alvo** por CLAUDE.md), migrations, rotas ou
> jobs foi tocada. O relatório julga o delta pelo que ele efetivamente toca; dívidas
> pré-existentes só entram quando o delta as **agrava** ou quando o mesmo caminho de código as
> torna materialmente mais custosas.
>
> **Contexto do fix.** Fecha o achado `1.1` de
> `ontology/_inbox/backlog-melhorias-2026-09-02.md` (P0 · confiança): `fetchGestaoPermutas`
> servia `gestaoPermutasFixture` (227 linhas de exportadores reais sondados no Conexos +
> valores USD) tanto em falha do backend quanto em carteira legitimamente vazia — sem
> sinalizar — na tela onde a analista decide baixa de adiantamento (`fin010`). O tipo já
> carregava `fonte: 'banco' | 'fixture'` e ninguém lia. Consequência lateral também corrigida:
> o `catch` engolia `SessionExpiredError`, virando fixture em vez de disparar o
> `SessionExpiredModal`.

## 0. Veredito do gate

**PASS.** Zero findings P0 entre as 8 QAs. Segundo o CLAUDE.md (Green criteria §8, Inviolable
Rule #11), só P0 re-entra no loop do AutoLoopRunner; P1/P2/P3 viram follow-ups em
`ontology/_inbox/permutas-fixture-fonte-regis-followups.md`. O feature está autorizado a seguir
para rebase + bump de versão + PR.

O que **não** significa: o repo está saudável. Significa que **este delta** não deixou nenhum
buraco crítico aberto pela sua própria conta. Os P1 que aparecem abaixo (4 cards) são
majoritariamente **dívidas pré-existentes** que este delta **agravou ou tornou visíveis**, e
uma delas — falta de `npm run build` no CI frontend — protege exatamente o guard novo que o
delta introduziu.

## 1. Executive scorecard

**Ponderação (pesos justificados pelo perfil do domínio — SaaSo de automação financeira
executando escritas reais: permuta/baixa Conexos, remessa SISPAG via Nexxera, upload GED):**

| QA | Peso |
|---|---|
| Security | 1.5 |
| Fault Tolerance | 1.3 |
| Availability | 1.2 |
| Modifiability | 1.2 |
| Testability | 1.0 |
| Performance | 1.0 |
| Integrability | 0.9 |
| Deployability | 0.9 |
| **Total** | **9.0** |

**Cálculo do overall score:** (7.5×1.5 + 8.0×1.3 + 8.0×1.2 + 8.0×1.2 + 7.0×1.0 + 7.0×1.0 +
7.0×0.9 + 7.5×0.9) / 9.0 = **7.54 ≈ 7.5**.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8.0 | 0 | 0 | 2 | 1 | F-availability-1: `apiFetch` sem timeout — backend pendurado deixa spinner infinito |
| Deployability | 7.5 | 0 | 1 | 2 | 0 | F-deployability-1: CI frontend não roda `next build` — regressão no `assertDemoEnv()` passa verde |
| Integrability | 7.0 | 0 | 1 | 2 | 2 | F-integrability-1: FE consome resposta sem Zod — contrato duplicado à mão entre BE/FE |
| Modifiability | 8.0 | 0 | 0 | 2 | 3 | F-modifiability-1: `permutas/page.tsx` continua em 1065 LOC (dívida pré-existente, delta +27) |
| Performance | 7.0 | 0 | 1 | 1 | 1 | F-performance-1: `apiFetch` sem timeout — o fix agravou exposição de "loading eterno" |
| Fault Tolerance | 8.0 | 0 | 0 | 3 | 1 | F-fault-tolerance-4: `assertDemoEnv()` no callsite não tem teste de integração |
| Security | 7.5 | 0 | 0 | 2 | 1 | F-security-1: fixture com 8 nomes reais de exportadores viaja no bundle client (3 chunks / ~91 KB) |
| Testability | 7.0 | 0 | 1 | 1 | 2 | F-testability-1: `usePermutasData` (dono do novo estado `error`) fica em 0% de cobertura |
| **Overall** | **7.5** | **0** | **4** | **15** | **8** | — |

**Interpretação da escala** (idêntica para todos os QAs):
- **0–3**: risco estrutural — bloqueia escalonamento.
- **4–6**: dívida defensável — endereçar nesta janela de planejamento.
- **7–8**: saudável com oportunidades pontuais.
- **9–10**: estado-da-arte para o estágio atual.

Todos os 8 eixos ficam em 7.0–8.0 — a leitura é **"saudável, com oportunidades pontuais
concentradas em três causas-raiz cross-QA"** (seção 3). Nenhuma QA está no vermelho.

## 2. Top 10 risks (cross-QA)

Ranqueados por *severidade × business impact × leverage*. Cada linha explicita as citações
e cards que a resolvem — leia como a agenda de contratação da próxima janela.

### R-1: `assertDemoEnv()` está no callsite errado — o guard novo não protege o que deveria

- **QA(s) afetados**: Fault Tolerance · Security
- **Findings de origem**: F-fault-tolerance-4 (P2), F-security-2 (P2)
- **Evidência sintetizada**: `assertAuthEnv()` é chamado no topo do `AuthProvider.tsx`, que
  o `app/layout.tsx` (root) importa — logo dispara em **toda rota**. `assertDemoEnv()` é
  chamado apenas no topo de `lib/api.ts` — dispara **só quando o import de `api.ts` é
  induzido** por uma rota de dados. Um build misconfigurado (`NEXT_PUBLIC_DEMO_MODE=true` +
  `NEXT_PUBLIC_ENV=prd`) **renderiza `/login` e a home normalmente e só estoura ao abrir
  `/permutas`**. O próprio comentário em `features.ts:44` reivindica paridade com
  `assertAuthEnv()` que factualmente não existe. Nenhum teste amarra a chamada ao callsite:
  os 6 casos de `features-demo-mode.test.ts` importam `features.ts` diretamente e chamam a
  função — remover a linha 22 de `api.ts` não quebra teste algum.
- **Impacto técnico**: o único guard novo que o delta introduziu para proteger o pior
  cenário (dado falso com nomes reais em prd) é lazy e não amarrado — janela onde QA smoke
  pode declarar "verde" enquanto a rota de dinheiro está armada.
- **Impacto de negócio**: promove o cenário exato que motivou o fix. O delta corrigiu a
  renderização de fixture como banco; se o guard falhar silenciosamente, o problema volta
  com a mesma severidade original (P0 · confiança).
- **Card(s) Kanban relacionados**: `security-2` (mover `assertDemoEnv()` para o root
  layout), `fault-tolerance-4` (teste de integração amarrando `assertDemoEnv` ao import de
  `api.ts`). **Combinar em um único stroke — mesma linha de código, dois eixos de defesa.**
- **Custo de inação em 6 meses**: 1 incidente de deploy misconfigurado equivale a
  reintroduzir 1.1 em produção. Premissa: sem gate no CI (R-4) e sem teste de callsite,
  probabilidade de vazamento cresce com a rotação de operadores de deploy. **Este é o
  risco de maior leverage do run — cheap, novo, e o guard-mãe.**

### R-2: `apiFetch` sem timeout / `AbortSignal` — o fix trocou "dado errado rápido" por "loading eterno"

- **QA(s) afetados**: Performance (P1) · Availability (P2) · Fault Tolerance (P2)
- **Findings de origem**: F-performance-1 (P1), F-availability-1 (P2), F-fault-tolerance-1 (P2)
- **Evidência sintetizada**: `grep -rn "AbortController|AbortSignal" src/frontend --include="*.ts" --include="*.tsx" | grep -v .test` → **0 ocorrências em todo o frontend** (62 chamadas de fetch). `lib/http.ts:29-35` é o corpo inteiro do wrapper e não passa `signal`. **Antes do delta**, backend pendurado virava `gestaoPermutasFixture` em ~0ms (comportamento errado, rápido); **depois do delta**, o `catch` propaga corretamente **quando a promessa rejeita** — mas se o backend pendura sem rejeitar (Render em cold start, pool RDS travado, proxy mudo), `loading=true` fica até o navegador cortar a conexão TCP (Chrome desktop: potencialmente 60–120s ou nunca). O `disabled={retrying}` em `banners.tsx:78` desabilita o próprio botão de retry.
- **Impacto técnico**: o QA que o delta pretendia melhorar (fault-tolerance da UI) fica incompleto — Timeout como sub-tactic de Detect Faults é o mecanismo canônico Bass para "pendurado" virar "detectado", e ele está ausente.
- **Impacto de negócio**: a troca é "confiança falsa mas rápida" por "honestidade lenta". A analista, em janela de incidente do Render, fica sem ferramenta para decidir baixa de adiantamento e acaba dando F5 na aba — que também limpa o snapshot preservado, perdendo a vantagem do banner `stale` que o próprio delta introduziu.
- **Card(s) Kanban relacionados**: `performance-1` (com `AbortController` + `ApiTimeoutError`), `availability-1` (deadline explícito de 15s), `fault-tolerance-1` (timeout no `fetchGestaoPermutas`). **Três cards, mesma linha de código em `lib/http.ts`.**
- **Custo de inação em 6 meses**: cada incidente de latência Render (histórico: cold starts de 5–15s são comuns em free tier) vira "app quebrou" percebido, mesmo sem quebrar. Sem medição de MTTR percebido (F-availability-3), esse custo fica invisível para priorização.

### R-3: fixture com 8 nomes reais de exportadores viaja no bundle client de produção

- **QA(s) afetados**: Security (P2) · Performance (P2)
- **Findings de origem**: F-security-1 (P2), F-performance-2 (P2)
- **Evidência sintetizada**: `lib/api.ts:19` faz `import { gestaoPermutasFixture } from './permutas-fixture'` estaticamente. `permutas-fixture.ts` tem 227 linhas / 6.441 bytes com 8 nomes reais probados no Conexos (DBP PIPING CO., LTD; QINGDAO COVENANT PIPELINE CO LTD; CENTENO INTERNATIONAL LIMITED; PANTECH STAINLESS ALLOY INDUSTRIES; NORMET OY; DAH SOLAR CO LTD; JINDAL STAINLESS LIMITED; SUN MARK STAINLESS PVT LTD) + valores USD plausíveis. Build atual (`.next/static/chunks/`): **3 chunks (~91 KB) contêm a string "DBP PIPING"** — mesmo com `NEXT_PUBLIC_DEMO_MODE=false` no build. `assertDemoEnv()` evita que o fixture seja *renderizado*, não que o *código* viaje. Chunks estáticos são servidos sem authz pela Vercel.
- **Impacto técnico**: viola Limit Exposure (Bass). Sem correlato de dep produtivo — o fixture é dead code em qualquer build deployado.
- **Impacto de negócio**: nomes de fornecedor da Columbia Trading são informação comercial sensível (mapa de suppliers, exposição por país, mix). Publicá-los no HTML servido é vazá-los para qualquer visitante autenticado ou não. Também compromete a promessa multi-tenant do estado-alvo: se amanhã o mesmo frontend for de outro cliente, o bundle sobe com nomes do cliente errado embutidos.
- **Card(s) Kanban relacionados**: `security-1` (dynamic import + pseudonimizar), `performance-2` (dynamic import). **Mesmo fix (dynamic import atrás de `isDemoMode()`) resolve os dois.**
- **Custo de inação em 6 meses**: baixa probabilidade de exploração ativa; alta certeza de reincidência do padrão. As Frentes III (GED) e IV (Recebimentos) também "ancoraram em dados reais" para fixture — se este delta não fecha o padrão, ele consolida como norma.

### R-4: CI frontend não executa `next build` — o gate do guard novo não é acionado no PR

- **QA(s) afetados**: Deployability (P1)
- **Findings de origem**: F-deployability-1 (P1)
- **Evidência sintetizada**: `.github/workflows/ci.yml:32-46` (job `frontend`) tem apenas `npm ci`, `typecheck`, `lint`, `test`. O job `backend` (linhas 14-30) faz `npm run build`. `assertDemoEnv()` só dispara quando `lib/api.ts` é importado — nos testes é induzido, no `next build` real (SSG das 12 rotas prerenderizadas) é o gate verdadeiro. **Como o CI não roda `next build`, o gate fica delegado à Vercel** — descoberto depois do merge, não no PR.
- **Impacto técnico**: uma regressão futura em `isDemoMode()` (ex.: `=== 'true'` virar `Boolean(...)`) ou em `assertDemoEnv()` (ex.: reordenar checks) passa verde no CI e só quebra na Vercel — perdendo o valor de shift-left do fail-fast.
- **Impacto de negócio**: MTTR de deploys quebrados aumenta em ~15 min por incidente (ciclo `revert → PR → merge → build`). Para o piloto Columbia em que a Vercel é o prd, cada descoberta pós-merge é pura fricção evitável.
- **Card(s) Kanban relacionados**: `deployability-1` (adicionar `- run: npm run build` no job `frontend` do `ci.yml`).
- **Custo de inação em 6 meses**: cresce com número de módulos com throw-on-import (o padrão vai se expandir — `assertSispagEnv`, `assertBillingMockEnv` etc. já se prenunciam pela duplicação em `features.ts` + `auth/env.ts`).

### R-5: FE consome `GET /permutas/gestao` sem validação de schema no boundary

- **QA(s) afetados**: Integrability (P1)
- **Findings de origem**: F-integrability-1 (P1)
- **Evidência sintetizada**: `lib/api.ts:92` faz `(await res.json()) as Partial<GestaoPermutasResponse>`. `grep -rn "from 'zod'|z\.object" src/frontend --include="*.ts" --include="*.tsx" | wc -l` = **0**. **22 sítios em 5 wrappers** de API usam cast `as Partial<T>` para narrow. O contrato é duplicado à mão entre `src/backend/domain/interface/permutas/Gestao.ts` (177 LOC) e `src/frontend/lib/types.ts:232-262` (30 LOC) — comentário do próprio código: "espelham EXATAMENTE".
- **Impacto técnico**: um rename de campo no BE (ex.: `pendentes` → `adiantamentosPendentes`), um novo `StatusElegibilidade` (ex.: `revisao-fiscal`), ou um `null` num campo tipado como `string` — nada disso quebra o typecheck do FE. TypeScript aceita silenciosamente e o UI vira KPI errado ou lista vazia. O delta corrigiu o mascaramento de fixture; a **detecção** de contrato quebrado continua sem cobertura.
- **Impacto de negócio**: com as 4 frentes convergindo (Permutas + SISPAG + GED + Recebimentos) tudo consumindo o mesmo padrão de wrapper, cada refactor no BE pode chegar em prod como regressão sutil — sem sinal na tela.
- **Card(s) Kanban relacionados**: `integrability-1` (Zod no boundary de `fetchGestaoPermutas`), `integrability-2` (colapsar duplicação BE↔FE — combina naturalmente via `z.infer`).
- **Custo de inação em 6 meses**: cada nova feature que renomeia campo no BE tem chance não-zero de virar bug de produção invisível ao CI. Multiplicado pelas 4 frentes, é dívida que compõe.

### R-6: `usePermutasData` — dono do novo estado `error` — fica em 0% de cobertura

- **QA(s) afetados**: Testability (P1)
- **Findings de origem**: F-testability-1 (P1)
- **Evidência sintetizada**: `jest --coverage`:
  ```
  app/permutas/components
    banners.tsx           | 100 | 100 | 100 | 100 |
    usePermutasData.ts    |   0 |   0 |   0 |   0 | 3-82
  ```
  O hook **é o dono do `error` state** (`usePermutasData.ts:26`) e das duas ramificações que o alimentam: `load` (refresh — preserva `data`, seta `error`) e o `useEffect` de carga inicial (limpa `data`, seta `error`). Os testes do delta atacam **dependências** do hook, nunca o hook em si. Quem verifica que `SessionExpiredError` **não** entra em `error`? Que o `.finally(setLoading(false))` executa mesmo com throw? Ninguém.
- **Impacto técnico**: mudar a ordem de `setError`/`setLoading`, esquecer o `isSessionExpiredError` guard, ou mudar "preserva `data` anterior" no refresh — tudo passa o CI verde e só é notado em produção. É a **exata classe de bug que este commit acabou de corrigir**.
- **Impacto de negócio**: reincidência do defeito 1.1 fica a uma refatoração de distância. Como o hook é orquestrador de dois banners novos + modal de sessão, é o lugar de maior ganho por linha de teste.
- **Card(s) Kanban relacionados**: `testability-1` (5 casos com `renderHook`).
- **Custo de inação em 6 meses**: probabilidade não-zero de reinserir o padrão "vazio → fixture" ou "catch → engole SessionExpired" em qualquer PR que toque o hook.

### R-7: contrato `GestaoPermutasResponse` duplicado à mão entre BE e FE

- **QA(s) afetados**: Integrability (P2) · Modifiability (indireto, via ripple de contrato)
- **Findings de origem**: F-integrability-2 (P2)
- **Evidência sintetizada**: `src/backend/domain/interface/permutas/Gestao.ts` (177 LOC) + `src/frontend/lib/types.ts:232-262` (30 LOC) com o comentário explícito "espelham EXATAMENTE". Nada além da disciplina do dev garante a sincronia. Um consumidor terceiro (job de export, mobile) copiaria a 3ª vez.
- **Impacto técnico**: MTTR de mudança de contrato = 2 arquivos, 2 timelines de dev. Entre um passo e outro, dessincronia silenciosa.
- **Impacto de negócio**: cresce linearmente com número de contratos wire — Recebimentos, SISPAG e GED terão os seus. Sem colapsar agora, o padrão consolida.
- **Card(s) Kanban relacionados**: `integrability-2` (path shared via alias TS, ou `z.infer` se `integrability-1` entrar antes — o que é o ideal).
- **Custo de inação em 6 meses**: cada nova frente adiciona 2 arquivos de types por endpoint. 4 frentes × ~4 endpoints por frente = ~32 arquivos duplicados a manter em sincronia manual.

### R-8: composição de estados em `permutas/page.tsx` (0% de 1065 LOC) sem teste de componente

- **QA(s) afetados**: Testability (P2) · Modifiability (P2)
- **Findings de origem**: F-testability-2 (P2), F-modifiability-1 (P2)
- **Evidência sintetizada**: `page.tsx:724-744` é a montagem que este PR desenhou: `DemoDataBanner` sempre no topo, `LoadErrorBanner` só se `data` existir (falha de refresh preserva a carteira), `EmptyState` com `AlertTriangle` se `!data` (falha de carga inicial). Banners têm 100% de cobertura em isolamento; a **matriz de estados que decide qual banner aparece em qual combinação** (`data × loading × error × fonte`) não tem teste algum. `page.tsx` = 1065 LOC / 35 imports (delta +27 LOC / +1 import).
- **Impacto técnico**: a invariante escrita em `ontology/ui-flows/fonte-do-dado-permutas.md` fica documentada, não executável. Refatorar o topo da página (extrair para subcomponente, mover para layout, condicionar por outra flag) não tem rede — só o typecheck defende.
- **Impacto de negócio**: dois riscos compostos — reincidência do 1.1 numa refactor futura do topo + custo de PR paralelos em `page.tsx` (imposto de arquivo grande).
- **Card(s) Kanban relacionados**: `testability-2` (extrair `PermutasHeader` + matriz 4 combinações), `modifiability-4` (split de `page.tsx` — refactor separado, M effort).
- **Custo de inação em 6 meses**: `sispag/page.tsx` (1068 LOC), `recebimentos/page.tsx` (727 LOC), `AlocarProcessosDialog.tsx` (928 LOC) — o padrão "página gigante" já é a norma. Sem sair da primeira agora, a norma consolida.

### R-9: banner de erro + retry duplicado entre Permutas e Recebimentos

- **QA(s) afetados**: Modifiability (P2) · Integrability (design-system-as-contract)
- **Findings de origem**: F-modifiability-2 (P2)
- **Evidência sintetizada**: `permutas/components/banners.tsx:44-79` (novo do delta) vs `recebimentos/page.tsx:380-410` (pré-existente). Mesma semântica — "banner destrutivo com retry, dado prévio preservado". Variação visual mínima (`bg-danger/5` vs `bg-danger-subtle`). Uma 3ª tela (SISPAG hoje não tem) tenderá a copiar-colar um dos dois.
- **Impacto técnico**: bug fix na UX de erro (aria-live, contraste, ícone) hoje custa 2 arquivos. Custo por banner novo em SISPAG ≈ 30min copiando vs 5min consumindo `components/ui/RetryErrorBanner`.
- **Impacto de negócio**: design system diverge devagar. Não bloqueia mas erode.
- **Card(s) Kanban relacionados**: `modifiability-1` (extrair para `components/ui/`).
- **Custo de inação em 6 meses**: 3 telas com o mesmo banner em 3 arquivos diferentes.

### R-10: sem App Router error boundary — o delta funciona por convenção do `try/catch`

- **QA(s) afetados**: Fault Tolerance (P2)
- **Findings de origem**: F-fault-tolerance-2 (P2)
- **Evidência sintetizada**: `find src/frontend/app -name "error.tsx" -o -name "global-error.tsx"` → vazio. `grep -rn "ErrorBoundary|componentDidCatch" src/frontend --include="*.tsx"` → 0. O delta funciona porque cada chamada de `fetchGestaoPermutas` em `usePermutasData` está dentro de `try/catch`. Uma regressão que remova esse `catch` faz o throw viajar até o render e — sem `error.tsx` — pinta a tela de branco.
- **Impacto técnico**: rede de proteção última ausente; correta manipulação de falha depende de disciplina em cada `useEffect`/handler.
- **Impacto de negócio**: baixo enquanto o hook único é o consumidor; cresce com número de consumidores de `fetchGestaoPermutas`/`fetchPainelRecebimentos`.
- **Card(s) Kanban relacionados**: `fault-tolerance-2` (criar `app/error.tsx` + teste).
- **Custo de inação em 6 meses**: 1 white-screen em qualquer trecho de código futuro que chame um wrapper sem try/catch.

## 3. Cross-cutting findings

Três causas-raiz aparecem em múltiplos QAs. Consolidar aqui evita duplicar em 3 cards.

### CC-1: **timeout ausente em `apiFetch`** (Detect Faults / Bound Execution Times)

- **Aparece em**: Availability, Fault Tolerance, Performance
- **Findings de origem**:
  - F-availability-1 (P2) — spinner infinito em backend pendurado
  - F-fault-tolerance-1 (P2) — Detect Faults / Timeout ausente
  - F-performance-1 (P1) — fix agravou exposição de "loading eterno"
- **Diagnóstico unificado**: `lib/http.ts:29-35` faz `fetch()` sem `signal` nem deadline. Este gap **precede o delta** (backlog §2.2 P1), mas o delta o **agravou operacionalmente** — antes um backend pendurado virava fixture em ~0ms; agora vira `loading=true` até o navegador cortar (60–120s em Chrome, se cortar). O botão de retry fica `disabled={retrying}` durante esse período, então a analista fica sem saída além do F5 (que perde o snapshot preservado).
- **Recomendação consolidada**: **um único card resolve os três** — `performance-1`/`availability-1`/`fault-tolerance-1` são o mesmo fix em `lib/http.ts`. Adicionar `AbortController` com timeout configurável (default 20–30s para reads), traduzir `AbortError` em `ApiTimeoutError` com mensagem específica no `LoadErrorBanner`. Compor com `AbortSignal.any([external, timeoutCtrl.signal])` para não pisar em `init.signal` de callers. **Efeito colateral positivo**: destrava F-availability-1 e F-availability-3 (emissão de sinal client-side) de virarem P1 no próximo review, porque passam a ter baseline mensurável.

### CC-2: **`permutas-fixture.ts` ships no bundle client** (Limit Exposure / Reduce Overhead)

- **Aparece em**: Security, Performance
- **Findings de origem**:
  - F-security-1 (P2) — 8 nomes reais de exportadores expostos em `.next/static/chunks/*.js`
  - F-performance-2 (P2) — ~1.8–2.5 KB gzip estimados de dead code por primeiro-load em prd
- **Diagnóstico unificado**: `lib/api.ts:19` importa o fixture estaticamente. Turbopack inclui o módulo em qualquer chunk que precise de qualquer coisa de `lib/api.ts` — 3 chunks do build atual carregam a string "DBP PIPING". O guard `assertDemoEnv()` protege *renderização*, não *distribuição do código*. **Este gap precede o delta** — o delta não o introduziu nem o corrigiu; apenas o tornou mais visível ao formalizar que "o fixture só é aceitável em `local` com opt-in explícito" (portanto o código dele também deveria ser local-only).
- **Recomendação consolidada**: **um único fix serve para os dois QAs** — `security-1`/`performance-2` = dynamic import dentro dos dois branches de `isDemoMode()` (`api.ts:96,118`). Como `NEXT_PUBLIC_DEMO_MODE=false` em prd, o Next isola o fixture num chunk que nunca carrega. Pseudonimização (`security-1`, opção 2) é belt-and-suspenders. Adicionar `check-bundle.mjs` no CI para garantir que "DBP PIPING" não aparece em nenhum chunk quando `NEXT_PUBLIC_DEMO_MODE≠true` no build.

### CC-3: **`assertDemoEnv()` — o guard-mãe está no callsite errado e sem teste de amarração**

- **Aparece em**: Fault Tolerance, Security (**risco NOVO introduzido pelo delta**)
- **Findings de origem**:
  - F-fault-tolerance-4 (P2) — Self-Test tactic sem teste que amarre a chamada ao callsite
  - F-security-2 (P2) — cobertura assimétrica com `assertAuthEnv()` (root layout vs `lib/api.ts`)
- **Diagnóstico unificado**: dos três CCs, este é o **único inteiramente atribuível ao delta** — os outros dois são dívidas pré-existentes que o delta agravou ou tornou visíveis. O guard novo (`assertDemoEnv()`) foi projetado como par simétrico de `assertAuthEnv()` (o comentário em `features.ts:44` afirma "espelhando `assertAuthEnv()`") mas o padrão é **assimétrico na prática**: `assertAuthEnv()` roda no `AuthProvider.tsx`, importado pelo `app/layout.tsx` (root) → dispara em toda rota. `assertDemoEnv()` roda no topo de `lib/api.ts` → dispara só quando alguma rota importa esse módulo. Um build com `DEMO=true, ENV=prd` renderiza login/home e só estoura ao abrir `/permutas`. Além disso, nenhum teste amarra a chamada ao callsite — os 6 casos existentes chamam `assertDemoEnv()` em isolamento; remover `api.ts:22` não quebra teste algum.
- **Recomendação consolidada**: **dois cards, uma sequência lógica** — `security-2` move a chamada para o root layout (via `AuthProvider` ou um `lib/env-guards.ts` agregador). `fault-tolerance-4` adiciona teste de import (`await expect(import('@/lib/api')).rejects.toThrow(/NEXT_PUBLIC_DEMO_MODE/)` com `resetModules`). Combinar com `modifiability-2` (`createEnvGuard()`) unifica os dois pares atuais (`features.ts` + `auth/env.ts`) e prepara para futuras flags perigosas. **Este é o quick win de maior leverage do run — cheap, novo, e protege exatamente a barreira que o delta introduziu.**

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2, alta razão impacto/esforço:

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `security-2` | Security | S | P2 | `assertDemoEnv()` no root layout — build misconfigurado estoura em toda rota, não só em `/permutas`. Guards em paridade (1 → 2 no root). |
| `fault-tolerance-4` | Fault Tolerance | S | P2 | Teste de integração amarrando `assertDemoEnv()` ao import de `api.ts` — remover a linha 22 quebra teste, em vez de silenciosamente reabrir o pior caminho. |
| `deployability-1` | Deployability | S | **P1** | `- run: npm run build` no job `frontend` do `ci.yml`. Regressão no guard falha em PR review, não em produção. 12 rotas prerenderizadas exercitadas por PR. |
| `performance-1` / `availability-1` / `fault-tolerance-1` | Performance/Availability/FT | S | **P1** (perf) / P2 (avail, FT) | `AbortController` + timeout configurável em `apiFetch`. Backend pendurado → banner em ≤30s. `grep AbortController` 0 → ≥1. **Um fix, três QAs.** |
| `integrability-1` | Integrability | S | **P1** | Zod schema no boundary de `fetchGestaoPermutas`. Rename/enum novo do BE vira erro nomeado no console + banner, em vez de KPI errado silencioso. 22 → 21 sítios com cast `as Partial<T>`; 0 → 1 arquivo com Zod. |
| `testability-1` | Testability | S | **P1** | 5 testes de hook via `renderHook`. Cobertura `usePermutasData.ts` 0% → ≥80%. Regressão do 1.1 passa a estourar no CI. |
| `security-1` / `performance-2` | Security/Performance | S | P2 | Dynamic import + pseudonimizar fixture. 3 chunks contêm "DBP PIPING" → 0. ~91 KB de dead code em prd → 0. **Um fix, dois QAs.** |
| `availability-2` | Availability | S | P2 | Emitir evento client-side quando `LoadErrorBanner` aparecer. Base para MTTR percebido — destrava priorização de `performance-1`/`fault-tolerance-1` com número real. |
| `deployability-2` | Deployability | S | P2 | Runbook de 1 página para os dois fail-fasts. Recuperação de "flag errada no painel" de "descobrir sozinho" para 3 passos. |
| `modifiability-1` | Modifiability | S | P2 | Extrair `LoadErrorBanner` para `components/ui/`. 2 sítios de banner erro+retry → 1. Fan-in 1 → 2. |
| `fault-tolerance-2` | Fault Tolerance | S | P2 | Criar `app/error.tsx` (App Router error boundary). White-screen deixa de ser modo de falha. |
| `integrability-3` | Integrability | S | P2 | Remover fallback `totais ?? {…}` em `api.ts:103-113`. 1 função de agregação em 2 sítios → 1 (só BE). |

**Sprint proposta pós-aprovação (12 cards / 2 semanas para o time atual):** os 4 P1 (`deployability-1`, `integrability-1`, `performance-1`, `testability-1`) + os 2 cards do CC-3 (`security-2`, `fault-tolerance-4`, ambos P2 mas maior leverage) + os 2 cards do CC-2 (`security-1`, `performance-2`, resolvem-se juntos) — 8 cards, tudo esforço S. Sobra folga para `availability-2` (sinal client-side, destrava métricas) e `deployability-2` (runbook).

## 5. Strategic moves (M / L / XL)

Cards de maior fôlego. "Por que vale" amarrado a um número — não a boa prática.

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `integrability-2` | Integrability | M | Abstract Common Services | Colapsa 177 LOC BE + 30 LOC FE em 1 arquivo autoritativo. MTTR de mudança de contrato: 2 arquivos → 1. Se combinado com `integrability-1` (Zod), o `z.infer` faz os tipos "de graça". Com 4 frentes convergindo (~32 contratos wire duplicados na cauda), o custo evitado é linear no nº de contratos × frequência de mudança. |
| `modifiability-4` | Modifiability | M | Split Module | `page.tsx` de 1065 → ≤400 LOC, 35 → ≤20 imports. **`sispag/page.tsx` (1068 LOC), `recebimentos/page.tsx` (727 LOC), `AlocarProcessosDialog.tsx` (928 LOC)** — o padrão "página gigante" já é a norma do repo; sair da primeira normaliza a saída das outras. Custo de PR paralelos em abas diferentes cai (medido em conflitos de rebase). |
| `testability-2` | Testability | M | Limit Structural Complexity + Executable Assertions | Extrai `PermutasHeader` (composição dos 3 estados) para subcomponente com matriz 4 combinações `data × error × fonte`. **A invariante `ontology/ui-flows/fonte-do-dado-permutas.md` deixa de ser documentação e vira teste.** Reduz a probabilidade de reincidência do 1.1 a essencialmente zero (o refactor precisaria remover a suíte). |
| `deployability-3` | Deployability | M | Package Dependencies | Verificação programática de env vars da Vercel via API antes de promover. Erros de configuração viram falha de CI (shift-left) em vez de build vermelho na Vercel (shift-right). Cheque pró-ativo em vez de reativo. Custo evitado: ~15 min por incidente × frequência de mudança de flags no painel. |
| `integrability-4` | Integrability | M | Restrict Communication Paths | MSW ou provider substitui a mistura I/O + fonte de dado no wrapper HTTP. `api.ts` deixa de crescer 1 branch por endpoint com demo. Ganho não é immediate (só 1 endpoint hoje), mas a cauda é linear no nº de endpoints × frentes que precisarão de demo. |

## 6. O que está bem (e por quê)

Reunião defensiva costuma cair em "tudo está ruim". Ancorar os pontos onde o sistema **acerta** é obrigatório e alimenta credibilidade do resto do relatório.

1. **O fix em si é limpo e cobre o defeito 1.1 na origem** — `fetchGestaoPermutas` deixou de ter 2 caminhos silenciosos (falha + vazio → fixture) e passou a ter 3 caminhos com sinal distinto (`fonte: 'banco'` populado → tela normal; `fonte: 'banco'` vazio → EmptyState; `fonte: 'fixture'` → `DemoDataBanner` obrigatório; falha propagada → `LoadErrorBanner` com dado preservado). Tactic Bass reforçada: **Detect Faults — Sanity Checking + Comparison** e **Recover State — Quarantine** (`SessionExpiredError` sobe para o modal em vez de virar fixture). Evidência: `git show 27023a9 -- src/frontend/lib/api.ts`, 3 novas suítes de teste (`permutas-fonte-dado.test.ts`, `features-demo-mode.test.ts`, `banners.test.tsx` — 20 casos passando).

2. **Fail-fast por opt-in explícito com blast-radius em build time** — `assertDemoEnv()` + `.env.example` de 9 linhas + comentário em `features.ts:22-28` documentando que o binding é build-time (aceitável para demo). Tactic Bass: **Change Default Settings** — default OFF em toda parte, inclusive `local`. Vetor de "dados falsos em prd" fica com um único ponto de falha, verificável.

3. **Degradation preservando o último snapshot bom** — `usePermutasData.load()` não faz `setData(null)` no `catch`; `LoadErrorBanner` com `stale=true` sinaliza que o número visível é da última carga bem-sucedida. Tactic Bass: **Contain Faults — Redundancy** (temporal) + **Recovery / Reintroduction**. Analista mantém contexto de trabalho durante incidente transitório.

4. **Consistência do padrão FE — `recebimentos` migrou antes, `permutas` completa a norma** — o padrão "vazio → fixture / catch → fixture" foi removido de `recebimentos` em ciclo anterior; o delta aplica a mesma disciplina em `permutas`. Dois wrappers de painel agora se comportam iguais diante de resposta vazia e falha. Reforço de **Adhere to Standards**. Evidência: `lib/recebimentos.ts:823-830` + `lib/api.ts:63-121`.

5. **Testes das seams puras a 100%** — `lib/features.ts` (novo) e `banners.tsx` (novo) em 100/100/100/100 (linhas/branches/funcs/statements). 20 casos novos em 3 suítes. `permutas-fonte-dado.test.ts` cobre os 3 caminhos de `fetchGestaoPermutas` + `SessionExpiredError` + demo em vazio + demo em falha. Tactic Bass: **Specialized Interfaces + Executable Assertions**. Isso é acima da média do repo (thresholds globais em 20/9/14).

6. **Ontologia como pré-condição, não pós-fato** — `ontology/ui-flows/fonte-do-dado-permutas.md` codifica a invariante "o que está na tela é o que está no banco". A tela agora **executa** a invariante (via `DemoDataBanner` obrigatório em `fonte='fixture'`); a ontologia **documenta** que assim deve permanecer. O ciclo `/feature-tweak` reforçado.

7. **Delta cirúrgico, sem contaminação de escopo** — 10 arquivos, +558/−19, zero linhas em `src/backend/`, zero migrations, zero mudanças em outras rotas. Score alto em Modifiability (8.0) reflete o `Reduce Coupling — Encapsulate`: a mudança de fonte cai num único `fetchGestaoPermutas`, um único `lib/features.ts`, um único `banners.tsx`.

8. **`SessionExpiredError` deixa de ser engolida** — antes o `catch` transformava 401 em fixture; agora `usePermutasData.ts:47,74` filtra `isSessionExpiredError` do estado local, deixando o `SessionExpiredModal` (via `emitSessionExpired()` em `http.ts:11`) assumir. Tactic Bass: **Recover State — Quarantine** por tipo de falha. Consequência real do fix que passou despercebida no PR title mas é auditável no diff.

## 7. Limitações da análise

### O que não é medível localmente neste repo

- **`infra/` não existe.** Toda tactic dependente de IAM, KMS, CloudTrail, GuardDuty, VPC, Security Groups, API Gateway authorizer, X-Ray, CloudWatch, DLQ, EventBridge, tenant blast-radius, drift detection Terraform ou "per-tenant SSM validation" é declarada **não medível**, não como finding. CLAUDE.md marca toda essa camada como estado-**alvo**.
- **Métricas de produção não coletadas neste run**: MTTR real do `/permutas/gestao`, uptime, p50/p95 de latência, taxa de 5xx, `deploy success rate` histórico da Vercel/Render, `lead time commit→prd` real, taxa de flaky em CI. Requer instrumentação server-side + observabilidade agregadora — o card `availability-2` é o primeiro passo para gerar o baseline.
- **Bundle-per-route (First Load JS) do Next 15**: `next build` foi executado no gate, mas o resumo textual por rota não foi persistido em `_shared-metrics.md`. A estimativa ~1.8–2.5 KB gzip do fixture (F-performance-2) é upper-bound com base na fonte de 6.441 bytes minificável.
- **`npm audit` do frontend**: fora do escopo de delta review (é gate do `/regis-review` completo, não do delta). Nenhum sinal de vulnerabilidade nova neste run.

### O que o pipe não cobre

- Threat modeling formal (STRIDE/PASTA) — este QA-Security é postura declarada no delta, não audit completo do repo.
- Chaos engineering / fault injection em produção — sem `infra/`, sem SQS, sem DLQ, não há substrato.
- Custo cloud, UX humana em jornada completa, acessibilidade WCAG (o `DesignSystemReviewer` cobre parcialmente).
- Análise de dependências transitivas (Renovate/Dependabot delegado).

### Correção fold-in do orquestrador — comentário de header de `recebimentos.ts` obsoleto

Durante a consolidação, o orquestrador sinalizou que `qa-fault-tolerance` e `qa-integrability` estão corretos em reportar que `lib/recebimentos.ts` **já não tem** mais o padrão "vazio → fixture" (ele lança e sempre retorna `fonte: 'banco'`; o fixture é test-only). O comentário `recebimentos.ts:9-11` que ainda menciona o fallback antigo está **obsoleto e ativamente enganoso** para quem lê pela primeira vez. **Não há card específico nas 8 QAs para isso** — o cross-QA F-integrability-5 é positivo (observa que o padrão está consistente), não emite card corretivo. Recomendação do consolidator: pequeno card doc-only em `ontology/_inbox/permutas-fixture-fonte-regis-followups.md` com título "atualizar header doc de `lib/recebimentos.ts` — fallback removido em ciclo anterior" (esforço trivial, XS, P3). Não conta nos 27 cards; entra como follow-up de higiene.

### Cards renomeados / editados pelo consolidator

**Nenhum.** Os 27 cards estão copiados verbatim das 8 seções QA em `KANBAN.md`. Os IDs (`{slug}-N`) foram preservados. As agrupações de "quick wins" e "strategic moves" em `REPORT.md` referem-se aos mesmos IDs — nenhum renomear, nenhuma edição de conteúdo.

### Janela temporal

Snapshot do dia **2026-09-08** (base `origin/main @ dc994c8`, delta `27023a9`). Código é vivo — refazer com `/regis-review` no próximo delta que toque `src/frontend/lib/api.ts`, `lib/http.ts`, ou introduzir uma nova frente que consuma o mesmo padrão.

## 8. Ações recomendadas

Ordem de execução para os 30 dias seguintes. Todo item referencia card(s).

1. **Fechar CC-3 antes de qualquer feature nova** — mover `assertDemoEnv()` para o root layout (`security-2`) e amarrar por teste de integração (`fault-tolerance-4`). É o único risco 100% atribuível a este delta, esforço S, e protege exatamente a barreira que o delta introduziu.

2. **Fechar CC-1 (timeout) num único stroke em `lib/http.ts`** — `performance-1` / `availability-1` / `fault-tolerance-1`. Um fix, três QAs, um dos P1 do run. Adicionar em paralelo `availability-2` (emitir sinal client-side) para gerar o baseline de MTTR percebido que hoje não existe.

3. **Fechar CC-2 (fixture no bundle) num único stroke em `lib/api.ts:19`** — `security-1` / `performance-2`. Dynamic import + (opcional) pseudonimização. Zero nomes reais no HTML servido pela Vercel; ~91 KB de dead code fora do primeiro-load.

4. **Adicionar `- run: npm run build` no job `frontend` do CI** (`deployability-1`, único outro P1 do run) — 1 linha de YAML que restaura o gate no PR e protege TODOS os fail-fasts existentes e futuros de regressão silenciosa. É a mudança de menor esforço e maior leverage no run.

5. **Fechar o P1 de contrato** (`integrability-1`, Zod no boundary de `fetchGestaoPermutas` + `testability-1`, testes de hook para `usePermutasData`) — os dois P1 restantes. Sequenciar: `testability-1` primeiro (destrava a rede de segurança do próprio hook onde vivia o defeito 1.1); `integrability-1` em seguida (destrava `integrability-2` via `z.infer` no ciclo seguinte).
