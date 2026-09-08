---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-fault-tolerance
generated_at: 2026-09-03T19:20:00-03:00
scope: frontend
score: 7.0
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta `moldura-navegacao`)

O delta é **frontend puro** — não toca fluxo de escrita financeira (permuta em `fin010`, remessa
SISPAG, baixa, GED). O bar canônico deste QA no financeiro (idempotência de escrita monetária,
DLQ, reconciliação com Conexos, trilha de auditoria) **não se aplica** a este delta: aqui a
"falha parcial" é da própria **moldura persistente da aplicação** que passa a existir em toda tela
autenticada.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado navegando no app | `fetchPermissoes()` rejeita, `localStorage` bloqueado, `usePathname()` null, throw dentro de um componente da moldura | `AppShell` + `Sidebar` + `BottomNav` + `NavItem` + `useAppNavGroups` (persistem em toda rota autenticada) | Produção, sessão viva, rede intermitente ou storage bloqueado (modo privado / iframe) | Falha isolada ao slot afetado (o item de Operação some, o colapso vira efêmero); nenhuma tela autenticada fica em branco | 0 tela em branco por falha isolada; 100% dos consumidores de `usePathname()` tratam `null`; 1 `<nav>` sobrevivente por breakpoint |

Cenário concreto que este delta introduziu e que **antes não existia**: uma exceção lançada em
qualquer um dos 5 componentes da moldura (1270 LOC novas, sempre montadas em rota autenticada)
propaga até a raiz da árvore React e derruba a tela inteira, porque **não há Error Boundary em
lugar nenhum de `src/frontend/`**. Antes do delta, o `AppShell.tsx` tinha 47 linhas sem lógica —
o custo de não ter boundary era ~zero. Agora o raio de explosão é 100% das telas autenticadas.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Error Boundaries no `src/frontend/` (React `componentDidCatch`/`getDerivedStateFromError`) | 0 | ≥ 1 envolvendo `AppNavigation` **ou** um `app/error.tsx` na raiz | ❌ | `grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" src/frontend/` → vazio |
| Next.js route error boundaries (`app/**/error.tsx`, `global-error.tsx`) | 0 | ≥ 1 | ❌ | `find src/frontend -name "error.tsx" -o -name "global-error.tsx"` → vazio |
| LOC persistentes em rota autenticada (moldura nova) | 1270 | — (baseline informativa) | ⚠️ | `wc -l` dos 5 arquivos do delta |
| Consumidores de `usePathname()` no delta | 4 (`AppShell`, `Sidebar`, `BottomNav`, `RouteGate`) | 4 com null-safety | ✅ | `grep -n usePathname src/frontend/components/{AppShell.tsx,ui/sidebar.tsx,ui/bottom-nav.tsx,auth/RouteGate.tsx}` |
| Null-safety em `usePathname()` (Next 16 devolve `string \| null`) | 4/4 | 4/4 | ✅ | `RouteGate:21` usa `?? ''`; `AppShell:257` compara `=== '/login'` (null-safe); `Sidebar:344` e `BottomNav:73` passam para `resolveActiveItemId` que trata `null` explicitamente em `sidebar.tsx:55` |
| `try/catch` em acessos a `localStorage` | 2/2 (getItem em `sidebar.tsx:92-99`, setItem em `sidebar.tsx:102-108`) | 2/2 | ✅ | leitura direta + teste `sidebar.test.tsx:159-170` "não quebra quando o localStorage está indisponível" |
| `fetchPermissoes()` com fallback fechado | Sim — `catch` em `app-nav.tsx:135` seta `permitido=false` | Sim | ✅ | `app-nav.tsx:127-141`; teste `app-nav.test.tsx:118-127` "falha fechada: consulta de permissão rejeitada mantém Operação escondida" |
| Timeout na chamada `fetchPermissoes()` | ❌ ausente (promessa pode pendurar indefinidamente) | Timeout ou `AbortController` | ❌ | `app-nav.tsx:127-141` — só `.then`/`.catch`, nenhum `AbortController`, nenhum `Promise.race` |
| Retry / re-fetch da permissão em route change | ❌ ausente (`useEffect` com deps `[]` roda só na montagem inicial da moldura, que é 1x por sessão) | Re-fetch em foco de janela **ou** botão de reload no menu de usuário | ⚠️ | `app-nav.tsx:129`: `React.useEffect(..., [])` — moldura não remonta entre rotas |
| Observabilidade em falha de `fetchPermissoes()` | ❌ ausente (nenhum `console.warn`, nenhum `notify.error`, nenhuma telemetria) | ≥ log estruturado; ideal: telemetria com tag `nav.permission_fetch_failed` | ❌ | `grep -rn "console\|notify\|toast" src/frontend/components/nav/ src/frontend/components/AppShell.tsx` → vazio |
| Testes cobrindo modos de falha do delta | 3 (falha fechada de `fetchPermissoes`, `localStorage` bloqueado, `pathname` null) | +1 (throw dentro da moldura → boundary segura) | ⚠️ | contagem manual em `app-nav.test.tsx`, `sidebar.test.tsx`, `bottom-nav.test.tsx` |
| Isolamento tenant / cross-tenant no delta | N/A | — | ✅ | delta é 100% cliente; nada persistido além de `ds:sidebar:collapsed:v1` (preferência de UI, não dado de tenant) |
| Idempotência de escrita financeira | N/A | — | ✅ | delta não executa nenhuma escrita — nem local nem remota |
| DLQ / SQS / reconciliação Conexos | N/A | — | ✅ | delta não toca backend, fila nem ERP |

## 3. Tactics — Cobertura no delta `moldura-navegacao`

Escopo do delta: componentes de moldura. Muitas tactics do canon Bass Fault Tolerance
(Redundancy, Voting, Rollback, Compensating Transaction, Reconcile, Quarantine, Escalating
Restart) referem-se a fluxos servidor/mensageria — **N/A** neste delta, marcadas abaixo com
justificativa de uma linha.

### Avoid Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — moldura de UI, sem escolha de componente em runtime baseada em risco. | N/A | — |
| Replacement | N/A — sem componentes hot-swap. | N/A | — |
| Predictive Model | Ausente — nenhuma medição de latência/erro de `fetchPermissoes` para prever indisponibilidade. | ❌ | `app-nav.tsx:127-141` |
| Increase Competence Set | Parcial — `readStoredCollapsed` tolera `localStorage` bloqueado (modo privado, iframe); `RouteGate` tolera `pathname` null; `usePermissaoOperacao` tolera fetch rejeitado. | ✅ parcial | `sidebar.tsx:87-108`, `RouteGate.tsx:19-21`, `app-nav.tsx:127-141` |

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Ausente na resposta de `fetchPermissoes()` — o `.then(p => setPermitido(p.operacao))` confia em `p.operacao` ser boolean; um `{}` vindo do backend vira `undefined → false` (aceitável por coincidência: cai no default seguro), mas não há Zod. | ⚠️ parcial | `app-nav.tsx:131` |
| Comparison | N/A — sem réplicas para comparar. | N/A | — |
| Timestamp | N/A — sem stream ordenada. | N/A | — |
| Timeout | ❌ Ausente na chamada `fetchPermissoes()` — sem `AbortController`, sem `Promise.race`. Uma promessa pendurada mantém "Operação" escondido para sempre naquela sessão. | ❌ | `app-nav.tsx:129-140` |
| Condition Monitoring | Ausente — nenhum sinal (console, telemetria) quando `fetchPermissoes` rejeita. Um usuário que "não vê Operação" não deixa rastro no observability. | ❌ | `grep "console\|notify" src/frontend/components/nav/` → vazio |
| Self-Test | N/A — moldura estática. | N/A | — |
| Voting | N/A. | N/A | — |

### Contain Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Redundancy | N/A — moldura é peça única. | N/A | — |
| Recovery — Forward | Parcial: falha no fetch de permissão faz forward para o estado "sem Operação" (fail-closed intencional, `docs/design-system/feedback.md`); falha em `localStorage` faz forward para "colapso efêmero desta sessão". | ✅ | `app-nav.tsx:137-140`, `sidebar.tsx:102-108` |
| Recovery — Backward | N/A — sem transação para desfazer. | N/A | — |
| Reintroduction (Shadow / State Resync / Escalating Restart) | ❌ Ausente — `useEffect` da permissão roda 1x na montagem da moldura (que dura a sessão inteira). Se a rede estava fora no boot e volta em seguida, "Operação" só reaparece após reload completo do navegador. | ❌ | `app-nav.tsx:129` — deps `[]` |
| **Error Boundary (React, transferindo o padrão de containment de UI)** | ❌ **Zero Error Boundaries no `src/frontend/` inteiro**. Nenhum `app/error.tsx`, nenhum `global-error.tsx`, nenhum `componentDidCatch`. Um throw em qualquer um dos 5 componentes da moldura (`AppShell`, `Sidebar`, `NavItem`, `BottomNav`, `useAppNavGroups`) derruba **toda tela autenticada** — o raio de explosão foi ~zero antes do delta (header sem lógica) e é 100% agora. | ❌ | `grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" src/frontend/` = 0; `find src/frontend -name "error.tsx"` = 0 |

### Recover State

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Rollback | N/A — sem transação de estado neste delta. | N/A | — |
| Repair State | Parcial — `usePermissaoOperacao` usa flag `vivo` em cleanup para não fazer `setState` após unmount (evita warning + estado zumbi). | ✅ | `app-nav.tsx:128-142` |
| Idempotent Replay | N/A. | N/A | — |
| Compensating Transaction | N/A. | N/A | — |
| Reconcile | N/A — nenhuma comparação com fonte externa. | N/A | — |
| Quarantine | Parcial (semântico) — o item "Operação" é **isolado** do resto da nav: sua falha não esconde as outras Frentes. Verificado em `app-nav.test.tsx:118-127`. | ✅ | `app-nav.tsx:127-141` |

## 4. Findings

### F-fault-tolerance-1: Zero Error Boundaries — a moldura persistente virou ponto único de falha para 100% das telas autenticadas

- **Severidade**: P1 (alto — degrada QA mensurável: blast radius de falha na UI passa de ~0% para 100% das telas autenticadas)
- **Tactic violada**: Contain Faults → Error Boundary (React) — no framework Bass, "Redundancy/Recovery" para contenção de falha
- **Localização**: ausência em todo `src/frontend/`; impacto concreto em `src/frontend/components/AppShell.tsx:243-286`, `components/ui/sidebar.tsx`, `components/ui/nav-item.tsx`, `components/ui/bottom-nav.tsx`, `components/nav/app-nav.tsx`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" src/frontend/
  (vazio)
  $ find src/frontend -name "error.tsx" -o -name "global-error.tsx"
  (vazio)
  $ wc -l src/frontend/components/{AppShell.tsx,nav/app-nav.tsx,ui/sidebar.tsx,ui/nav-item.tsx,ui/bottom-nav.tsx}
   1270 total
  ```
  `app/layout.tsx:24` monta o `AppShell` **fora** de qualquer boundary. Um throw dentro de `Sidebar`, `NavItem`, `BottomNav` ou `useAppNavGroups` propaga até o `RootLayout` — em produção o Next.js exibe o fallback padrão (tela vazia + reload); em dev, o overlay vermelho. Em ambos, a tela onde o analista está trabalhando **desaparece**.
- **Impacto técnico**: qualquer regressão futura em um dos 5 componentes da moldura (ex.: um ícone `lucide-react` que retorna `undefined` numa versão nova, um `Tooltip` com prop mudada, um throw em `resolveActiveItemId` diante de `groups` malformado) leva junto todas as 8 rotas autenticadas simultaneamente. Antes do delta, o `AppShell.tsx` tinha 47 linhas sem lógica e o custo desta ausência era praticamente zero — é um **agravamento real introduzido por este commit**.
- **Impacto de negócio**: uma tela em branco no meio de uma remessa SISPAG ou de uma baixa não implica perda de dado (a moldura não escreve), mas o analista perde o contexto de tela (filtros aplicados, item selecionado, rascunho de comentário) e precisa navegar de volta pela URL. Em incidente, aumenta MTTR percebido e produz o pior sintoma possível ("o sistema caiu") a partir do que pode ser um bug isolado num ícone.
- **Métrica de baseline**: 0 Error Boundaries / 5 componentes persistentes / 1270 LOC no shell.

### F-fault-tolerance-2: `fetchPermissoes()` sem timeout — promessa pendurada esconde "Operação" para toda a sessão

- **Severidade**: P2 (médio — degrada UX específica, mitigado pelo fail-closed intencional)
- **Tactic violada**: Detect Faults → Timeout
- **Localização**: `src/frontend/components/nav/app-nav.tsx:127-141`
- **Evidência (objetiva)**:
  ```typescript
  React.useEffect(() => {
    let vivo = true
    void fetchPermissoes()
      .then((p) => { if (vivo) setPermitido(p.operacao) })
      .catch(() => { if (vivo) setPermitido(false) })
    return () => { vivo = false }
  }, [])
  ```
  Nenhum `AbortController`, nenhum `Promise.race` com timeout, deps `[]` — o efeito não repete.
- **Impacto técnico**: se o backend não responder (rede caindo, proxy pendurando, DNS lento), a Promise fica pending indefinidamente. `permitido` permanece `false`, e como o `useEffect` só roda na montagem da moldura (que sobrevive a toda navegação), o item nunca reaparece na sessão — só após reload completo do navegador.
- **Impacto de negócio**: um usuário autorizado a operar o painel de Operação perde acesso à página inteira até fazer F5. Não corrompe dado (o gate real é server-side, ADR-0042), mas gera chamado de suporte "cadê o Painel de Operação?".
- **Métrica de baseline**: 0 clientes HTTP no delta com timeout configurado / 1 chamada `fetchPermissoes()` no path da moldura.

### F-fault-tolerance-3: falha de `fetchPermissoes()` é silenciosa — zero observabilidade

- **Severidade**: P3 (baixo — política de fail-closed é deliberada, mas ausência de sinal é débito de debug)
- **Tactic violada**: Detect Faults → Condition Monitoring
- **Localização**: `src/frontend/components/nav/app-nav.tsx:135-137`
- **Evidência (objetiva)**:
  ```typescript
  .catch(() => {
    if (vivo) setPermitido(false)
  })
  ```
  Nenhum `console.warn`, nenhum `notify.error`, nenhuma telemetria. Confirmado por
  `grep -rn "console\|notify\|toast" src/frontend/components/nav/ src/frontend/components/AppShell.tsx` → vazio.
- **Impacto técnico**: quando o item de Operação some para um usuário que deveria vê-lo, não existe rastro em log de navegador, em rede (só a request 500), em telemetria ou em toast. O time só descobre por chamado do usuário. A justificativa da política "esconder em vez de mostrar 404" é boa (`docs/design-system/feedback.md`); a política "esconder em silêncio absoluto até para o console de dev" é acidental.
- **Impacto de negócio**: MTTD (mean time to detect) do modo de falha "Operação some inexplicavelmente" ≈ tempo até o usuário reclamar; sem telemetria, o time nunca sabe se é 1 usuário ou 100.
- **Métrica de baseline**: 0 sinais (log, telemetria, toast) em `catch` do delta.

### F-fault-tolerance-4: sem reintrodução — permissão negada no boot fica negada para toda a sessão

- **Severidade**: P3 (baixo — mitigado por reload; usuário tem workaround simples)
- **Tactic violada**: Contain Faults → Reintroduction
- **Localização**: `src/frontend/components/nav/app-nav.tsx:129` (deps `[]`)
- **Evidência (objetiva)**:
  ```typescript
  React.useEffect(() => { ... }, [])   // roda 1x por sessão
  ```
  A moldura `AppShell` é montada no `RootLayout` (`app/layout.tsx:24`) e **não remonta** entre rotas — só em reload do navegador. Portanto o hook `usePermissaoOperacao` só consulta o backend na primeira carga.
- **Impacto técnico**: se o backend estava indisponível quando o usuário abriu o app (VPN reconectando, cold start do backend) mas volta em 30s, o item "Operação" continua escondido até o usuário fazer F5. Não há re-fetch em `window.focus`, em `visibilitychange` nem em navegação de rota.
- **Impacto de negócio**: baixo — reload é workaround trivial, mas o usuário raramente pensa em fazer reload quando "está funcionando" (o resto do app funciona, só o item de menu sumiu).
- **Métrica de baseline**: 1 fetch por sessão / 0 gatilhos de re-fetch (foco, visibilidade, rota).

## 5. Cards Kanban

### [fault-tolerance-1] Introduzir Error Boundary na moldura antes que a próxima regressão derrube todas as telas

- **Problema**
  > A moldura persistente introduzida por este delta (`AppShell` + `Sidebar` + `NavItem` + `BottomNav` + `useAppNavGroups`, 1270 LOC sempre montadas em rota autenticada) não está envolvida por nenhum Error Boundary — não existe **nenhum** em todo `src/frontend/`, nem React `componentDidCatch`, nem `app/error.tsx`, nem `global-error.tsx`. Um throw em qualquer componente da moldura propaga até o `RootLayout` e a tela do analista fica em branco. Antes deste delta o header tinha 47 linhas sem lógica — o custo dessa ausência era ~zero; agora é 100% das telas autenticadas.

- **Melhoria Proposta**
  > Duas opções complementares, aplicáveis juntas: (a) criar `src/frontend/app/error.tsx` com fallback minimalista ("Ocorreu um erro. Recarregue a página." + botão `reset`) — captura throws de qualquer componente cliente dentro do layout raiz; (b) adicionar um Error Boundary React explícito envolvendo `<AppNavigation />` dentro de `AppShell.tsx:262`, de modo que uma falha na sidebar/bottom-nav degrade para "moldura sem nav" (o `<main>` e o conteúdo continuam servíveis) em vez de derrubar a página inteira. A tactic Bass é **Contain Faults / Recovery**: isolar a falha ao slot afetado.

- **Resultado Esperado**
  > Um throw em `Sidebar`, `NavItem` ou `BottomNav` degrada para uma nav simplificada (ou nenhuma nav) e mantém a rota atual navegável via URL. Blast radius: 100% das telas autenticadas → 1 componente (a nav).

- **Tactic alvo**: Contain Faults → Recovery / Error Boundary (React)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Error Boundaries no `src/frontend/`: 0 → ≥ 1
  - Rotas autenticadas derrubadas por 1 throw na moldura: 8 (todas) → 0 (só a nav some, `<main>` sobrevive)
  - Teste `sidebar.test.tsx` com um componente-vítima que faz throw: ausente → presente
- **Risco de não fazer**: primeira regressão em `lucide-react`, `@radix-ui/tooltip` ou em `resolveActiveItemId` (com um `groups` malformado vindo de refactor futuro) provoca "sistema fora" percebido no meio de operação — o pior sintoma possível a partir do que é bug isolado.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Timeout + AbortController em `fetchPermissoes()` para não pendurar a permissão de Operação a sessão inteira

- **Problema**
  > `usePermissaoOperacao` faz `fetchPermissoes()` sem `AbortController`, sem `Promise.race` com timeout, e o `useEffect` roda 1x por sessão (deps `[]`). Se o backend não responde na primeira carga do app, a Promise fica pending e "Operação" fica escondido até o usuário fazer F5 — mesmo que o backend volte a responder 5s depois.

- **Melhoria Proposta**
  > Envolver a chamada em `RetryExecutor`/`PollExecutor` do domínio **ou** aplicar `AbortController` com timeout de 3–5s + fallback para o valor default (`false`). Ao mesmo tempo, adicionar re-fetch em `window.addEventListener('focus', ...)` para reabilitar o item quando o usuário volta ao browser depois de uma queda de rede. Tactic Bass: **Detect Faults / Timeout** + **Contain Faults / Reintroduction**.

- **Resultado Esperado**
  > Fetch pendurado ≥ 5s é abortado e loga condição (ver card 3). Item reaparece automaticamente quando o usuário foca a janela após a rede voltar. Requer no máximo 1 F5 por sessão em vez de "para sempre".

- **Tactic alvo**: Detect Faults → Timeout; Contain Faults → Reintroduction
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Timeout no `fetchPermissoes()`: 0ms (infinito) → 5s
  - Gatilhos de re-fetch: 1 (montagem) → 2 (+ focus)
  - Teste "promessa pendurada é abortada em 5s": ausente → presente
- **Risco de não fazer**: chamados recorrentes de "cadê o Painel de Operação?" após qualquer blip de rede no login; MTTR percebido = tempo até o usuário lembrar de fazer F5.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Sinalizar falha de `fetchPermissoes()` no console/telemetria — fail-closed é política, silêncio absoluto é acidental

- **Problema**
  > O `.catch(() => setPermitido(false))` em `app-nav.tsx:135-137` esconde a falha sem produzir **nenhum** sinal — nem `console.warn`, nem `notify.error`, nem telemetria. A política de esconder o item (fail-closed) é deliberada e correta (`docs/design-system/feedback.md`); o silêncio total até para o console de dev não é — é acidente do idioma `.catch(() => noop)`.

- **Melhoria Proposta**
  > Adicionar `console.warn('[nav] fetchPermissoes falhou; item de Operação escondido', err)` no `catch`. Quando existir infra de telemetria no frontend (não neste delta), emitir um evento `nav.permission_fetch_failed` com tag do usuário. Não usar `notify.error`/`toast` porque contradiz a política de esconder em silêncio para o usuário — o sinal é para o desenvolvedor. Tactic Bass: **Detect Faults / Condition Monitoring**.

- **Resultado Esperado**
  > MTTD do modo de falha "Operação some inexplicavelmente" cai de "tempo até o usuário reclamar" para "primeira vez que o dev abre o DevTools do usuário afetado".

- **Tactic alvo**: Detect Faults → Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Sinais em `catch` do delta: 0 → 1 (`console.warn`)
  - Teste asserta `console.warn` chamado quando `fetchPermissoes` rejeita: ausente → presente
- **Risco de não fazer**: incidente silencioso, dependente de reclamação; nenhuma métrica agregada de frequência.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Re-fetch da permissão em `window.focus` — permissão negada no boot não deve valer para sempre

- **Problema**
  > `useAppNavGroups` roda `fetchPermissoes` uma única vez, na montagem da moldura, que é a raiz do app e sobrevive à sessão inteira. Se o backend estava fora quando o usuário abriu a página (VPN reconectando, cold start), o item "Operação" nunca reaparece — nem em navegação de rota, nem em foco de janela — só em reload completo.

- **Melhoria Proposta**
  > Ouvir `document.addEventListener('visibilitychange', ...)` ou `window.addEventListener('focus', ...)` no `usePermissaoOperacao` e refazer a consulta quando o usuário volta ao tab. Alternativa: mover a permissão para o `AuthProvider` (que já tem lifecycle mais ativo) e expô-la como campo do contexto. Tactic Bass: **Contain Faults / Reintroduction**.

- **Resultado Esperado**
  > Permissão que estava negada no boot é reavaliada automaticamente quando o usuário volta ao tab; item aparece sem F5.

- **Tactic alvo**: Contain Faults → Reintroduction
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — mais simples se combinado com o card 2
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Gatilhos de re-fetch: 1 → ≥ 2 (montagem + focus/visibility)
  - Teste "permissão reavalia em focus": ausente → presente
- **Risco de não fazer**: baixo — reload resolve. Mantido no radar como higienização.
- **Dependências**: card 2 (natural agrupar).

## 6. Notas do agente

- **Escopo ajustado à realidade do delta.** O bar canônico deste QA no financeiro (idempotência de escrita monetária, DLQ, reconciliação com Conexos, trilha de auditoria) não se aplica: o delta é 100% moldura de UI e não executa nenhuma escrita. A ênfase mudou para **containment de falha na moldura persistente** — e é aí que mora o único achado P1: a ausência de Error Boundary é regressão genuína (antes o header era 47 linhas sem lógica; agora são 1270 LOC sempre montadas).
- **O que a `--quick` cortou:** não instrumentei um throw sintético dentro da moldura para medir empiricamente o blast radius no browser — a evidência é o `grep` (0 boundaries) somado ao mapa de layout (`app/layout.tsx:24` monta `AppShell` no `RootLayout`, fora de qualquer boundary), o que é suficiente para P1.
- **Cross-QA — flags para o consolidator:**
  - **Availability**: o card [fault-tolerance-1] Error Boundary reduz downtime percebido de tela — sobrepõe com o cenário de degradação de Availability.
  - **Testability**: os cards 1, 2 e 3 pedem novos casos de teste (`throw dentro da moldura`, `promessa pendurada`, `console.warn asserta`). O gap "reprocess scenarios covered by tests" da mission genérica manifesta aqui como "modos de falha da moldura cobertos por teste".
  - **Modifiability**: o desvio deliberado "responsividade por CSS em vez de `useBreakpoint()`" (`ontology/ui-flows/navegacao-global.md`) é a mesma escolha que evita mismatch de hidratação — nota de baixo custo para o consolidator.
- **Positivo a registrar (nem todo delta merece review negativo):** o delta traz três exemplos exemplares de defensividade — `readStoredCollapsed`/`writeStoredCollapsed` (try/catch completo, tested), `fetchPermissoes` (fail-closed intencional + isolamento do resto da nav, tested), `usePathname() ?? ''` no `RouteGate` (correção null-safety incluída neste delta). Score 7.0 reflete essa base sólida com o único gap arquitetural sendo a ausência de Error Boundary.
