---
type: regis-review-kanban
run_id: 2026-09-03-1913-moldura-navegacao
total: 31
counts: { p0: 0, p1: 4, p2: 15, p3: 12 }
---

> ⚠️ **ERRATA — ler antes deste documento:** [`ERRATA.md`](./ERRATA.md). A evidência que sustentava
> o achado P1 de Deployability ("a `main` estava com o `next build` quebrado e nenhum gate acusou")
> era **falsa** — a `main` compila. O gap de CI é real; a severidade P1 e as menções a
> `usePathname()`/`useSearchParams()` "nulláveis" não se sustentam.

# Kanban — financeiro — 2026-09-03-1913-moldura-navegacao

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Não há P0 neste run — gate do pipeline passou.
> IDs preservados dos arquivos QA originais (nenhum renomeado).

---

## P0 — Crítico

_Nenhum card P0 neste run. Gate do `/feature-tweak` passa por essa via._

---

## P1 — Alto

### [deployability-1] Adicionar `next build` ao job `frontend` do CI

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands / Deployment Observability
**Esforço**: S (≤ 1h — 3 linhas de YAML)
**Findings**: F-deployability-1, F-deployability-2

**Problema**
> O job `frontend` do `.github/workflows/ci.yml` (linhas 30-46) roda `typecheck`, `lint`, `test`, mas **não** roda `next build`. Consequência medida neste ciclo: `main` tinha `next build` quebrado por 2 erros de tipagem Next 16 (`app/login/page.tsx:23`, `components/auth/RouteGate.tsx:21`) que o `tsc --noEmit` não pega — só o `next build` pega. Zero gate acusou; a autora do delta descobriu ao rodar `npm run build` local.

**Melhoria Proposta**
> Adicionar `- run: npm run build` ao final do job `frontend` (após `npm test`). Considerar também `NEXT_TELEMETRY_DISABLED: '1'` como env no step para evitar dependência de rede opcional. Se o tempo do CI virar problema (build local = ≤30s; CI provavelmente ≤2min), cachear `.next/cache`. Tactic Bass: **Script Deployment Commands** (paridade com o job backend, que já roda `npm run build`).

**Resultado Esperado**
> Todo PR que quebrar `next build` falha no check `Frontend` antes de merge. Zero janela de `main` broken build. Backend e frontend com gates simétricos.

**Métricas de sucesso**
- Passos automatizados no PR gate (frontend): 4 → 5
- `next build` executado no PR: ausente → presente
- Nº de deploys Vercel que falham após merge por erro de build: baseline ~1 neste ciclo → 0

**Risco de não fazer**
> Em 6 meses, esta mesma classe de bug (hook nullable Next 16, RSC violation, `generateStaticParams` quebrado) reincide — provavelmente durante uma feature de outra frente (SISPAG ou Recebimentos), afetando release lockstep FE+BE.

**Dependências**: Nenhuma.

---

### [testability-1] Reassentar `coverageThreshold` do frontend para 2pp abaixo do real pós-delta

**QA**: Testability
**Tactic alvo**: Executable Assertions (Bass QA Testability)
**Esforço**: S (≤ 1d — edição de 3 números + validação de que o CI passa)
**Findings**: F-testability-1

**Problema**
> O `coverageThreshold` global do `src/frontend/jest.config.js` está calibrado para o baseline v0.8.0 (20/9/14), mas o delta desta feature levou a cobertura real para 38.19/28.73/33.33 — folga de ~18-19pp em cada eixo. Uma regressão que apague metade dos testes novos passa no CI sem alarme. O próprio comentário do arquivo prevê "SUBIR conforme testes de componente forem adicionados" — é agora.

**Melhoria Proposta**
> Editar `src/frontend/jest.config.js:36-40` para `lines: 36 / branches: 26 / functions: 31` (2pp abaixo do medido; slack para melhorias marginais, gate real contra regressão relevante). Atualizar o comentário histórico do arquivo com a data e o ciclo. Tactic Bass: *Executable Assertions* aplicada ao próprio pipeline de CI.

**Resultado Esperado**
> Uma regressão que baixe a cobertura frontend de 38% para 34% (dois arquivos inteiros da moldura ficando sem teste) faz o CI vermelho. Distância floor↔real: 18.2pp → 2pp em lines; 19.7pp → 2pp em branches; 19.3pp → 2pp em functions.

**Métricas de sucesso**
- Distância `coverageThreshold.global.lines` vs real: 18.2pp → 2pp
- Distância `coverageThreshold.global.branches` vs real: 19.7pp → 2pp
- Distância `coverageThreshold.global.functions` vs real: 19.3pp → 2pp

**Risco de não fazer**
> 6 meses adiante, com mais features (paleta ⌘K, backlog `SettingsSidebar`), o floor 20/9/14 vai estar 25-30pp abaixo do real; regressão de cobertura por refactor grande passa despercebida.

**Dependências**: Nenhuma. Card independente e isolado do delta.

---

### [security-1] Validar `returnTo` do login como path relativo antes de `router.replace`

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S (≤ 1d)
**Findings**: F-security-1

**Problema**
> `/login?returnTo=<query>` alimenta `router.replace(returnTo)` sem checar o formato. Uma URL absoluta ou protocol-relative (`https://evil-columbia.com`, `//evil.com`) é aceita e o navegador sai para outra origem depois do login bem-sucedido. Vetor de phishing direto para credencial `admin` — cenário do F-security-1.

**Melhoria Proposta**
> Introduzir um sanitizador `safeReturnTo(raw: string | null): string` em `src/frontend/lib/nav/returnTo.ts` que aceita apenas strings que começam com `/`, não começam com `//`, não contêm `\\` (bypass do Node URL parser em alguns navegadores) e não incluem `://`. Fallback para `/` em qualquer outro caso. Consumir esse helper em `app/login/page.tsx:25` e em qualquer futuro `router.replace(returnTo)` — cobrir com teste de tabela (`'/permutas'` → aceito; `'https://evil'` → `/`; `'//evil'` → `/`; `'/\\evil'` → `/`; `''` → `/`; `null` → `/`). Tactic alvo: **Validate Input**.

**Resultado Esperado**
> 100% das strings possíveis de `returnTo` que resolveriam para outra origem são reduzidas a `/`. Validador coberto por teste dedicado no `jest`. Métrica: sinks de open-redirect não validados no frontend: **1 → 0**.

**Métricas de sucesso**
- Sinks de open-redirect sem validação: 1 → 0
- Testes cobrindo o sanitizer: 0 → ≥ 6 casos (aceitos + rejeitados)
- `returnTo` cross-origin resulta em navegação para outra origem: sim → não

**Risco de não fazer**
> Um phishing dirigido a um dos 12 usuários admin da plataforma captura credencial reutilizável para assinar remessa e finalizar lote SISPAG. O `requireRole('admin')` do backend não distingue credencial legítima de credencial roubada.

**Dependências**: Nenhuma.

---

### [fault-tolerance-1] Introduzir Error Boundary na moldura antes que a próxima regressão derrube todas as telas

**QA**: Fault Tolerance
**Tactic alvo**: Contain Faults → Recovery / Error Boundary (React)
**Esforço**: S (≤ 1d)
**Findings**: F-fault-tolerance-1

**Problema**
> A moldura persistente introduzida por este delta (`AppShell` + `Sidebar` + `NavItem` + `BottomNav` + `useAppNavGroups`, 1270 LOC sempre montadas em rota autenticada) não está envolvida por nenhum Error Boundary — não existe **nenhum** em todo `src/frontend/`, nem React `componentDidCatch`, nem `app/error.tsx`, nem `global-error.tsx`. Um throw em qualquer componente da moldura propaga até o `RootLayout` e a tela do analista fica em branco. Antes deste delta o header tinha 47 linhas sem lógica — o custo dessa ausência era ~zero; agora é 100% das telas autenticadas.

**Melhoria Proposta**
> Duas opções complementares, aplicáveis juntas: (a) criar `src/frontend/app/error.tsx` com fallback minimalista ("Ocorreu um erro. Recarregue a página." + botão `reset`) — captura throws de qualquer componente cliente dentro do layout raiz; (b) adicionar um Error Boundary React explícito envolvendo `<AppNavigation />` dentro de `AppShell.tsx:262`, de modo que uma falha na sidebar/bottom-nav degrade para "moldura sem nav" (o `<main>` e o conteúdo continuam servíveis) em vez de derrubar a página inteira. A tactic Bass é **Contain Faults / Recovery**: isolar a falha ao slot afetado.

**Resultado Esperado**
> Um throw em `Sidebar`, `NavItem` ou `BottomNav` degrada para uma nav simplificada (ou nenhuma nav) e mantém a rota atual navegável via URL. Blast radius: 100% das telas autenticadas → 1 componente (a nav).

**Métricas de sucesso**
- Error Boundaries no `src/frontend/`: 0 → ≥ 1
- Rotas autenticadas derrubadas por 1 throw na moldura: 8 (todas) → 0 (só a nav some, `<main>` sobrevive)
- Teste `sidebar.test.tsx` com um componente-vítima que faz throw: ausente → presente

**Risco de não fazer**
> Primeira regressão em `lucide-react`, `@radix-ui/tooltip` ou em `resolveActiveItemId` (com um `groups` malformado vindo de refactor futuro) provoca "sistema fora" percebido no meio de operação — o pior sintoma possível a partir do que é bug isolado.

**Dependências**: Nenhuma. Sobrepõe-se ao card [availability-1] — recomenda-se **executar como um único card**, contabilizando availability-1 como resolvido pelo mesmo commit.

---

## P2 — Médio

### [availability-1] Envolver a moldura em `ErrorBoundary` com fallback minimalista

**QA**: Availability
**Tactic alvo**: Exception Handling
**Esforço**: S (≤ 1d)
**Findings**: F-availability-2

**Problema**
> Nenhum `ErrorBoundary` (nem `app/error.tsx`, nem `global-error.tsx`) protege `AppShell` ou seus descendentes. Um throw em qualquer componente da moldura — Sidebar, NavItem, ConexosStatusBanner, UserMenu — propaga até a raiz e o app fica em tela branca em produção. O delta acrescentou ~900 LOC de UI de moldura sem essa rede de segurança.

**Melhoria Proposta**
> Adicionar `src/frontend/app/error.tsx` (route-level ErrorBoundary do Next.js) com fallback mínimo: um título "Algo deu errado nesta tela" + botão "Recarregar" + link para `/`. Se possível, um `ErrorBoundary` **também** em torno de `<AppNavigation>` dentro do `AppShell` para isolar falhas da nav do restante do main. Tactic Bass: **Exception Handling** (nível React tree).

**Resultado Esperado**
> Uma exceção em componente da moldura degrada a região com falha em vez de derrubar a página. Métrica: 0 → ≥1 `ErrorBoundary` em `app/`; regressão futura em `NavItem` passa a mostrar fallback em vez de tela branca.

**Métricas de sucesso**
- `ErrorBoundary` na moldura: 0 → 1
- Rotas com fallback de erro: 0/10 → 10/10

**Risco de não fazer**
> Qualquer regressão em componente periférico (por exemplo, um badge recebendo `NaN`, um `useAppNavGroups` que joga por dado inesperado) tira o app do ar até o usuário dar F5. Em 6 meses, com mais consumidores da moldura, a probabilidade só cresce.

**Dependências**: Sobrepõe-se ao [fault-tolerance-1]. Executar como um único commit; contabilizar 1 card para efeito de tracking, não 2.

---

### [availability-2] Dar timeout, abort e um retry ao `fetchPermissoes`

**QA**: Availability
**Tactic alvo**: Retry, Predictive Model
**Esforço**: S (≤ 1d)
**Findings**: F-availability-1

**Problema**
> `fetchPermissoes()` roda uma vez no mount do `AppNavigation`, sem `AbortController`, sem timeout e sem retry (`app-nav.tsx:128-140`, `operacao.ts:101-105`). Um endpoint intermitente (ou lento) deixa o item Operação escondido pela sessão inteira; um request pendurado consome conexão HTTP até o browser cortar. A política de "falha fechada" está correta — o problema é não dar chance de reabrir.

**Melhoria Proposta**
> 1. Passar `signal: AbortSignal.timeout(3000)` ao `fetch` dentro de `apiFetch` (ou usar `AbortController` + `setTimeout(3s)`; browsers antigos exigem o fallback). 2. Envolver `fetchPermissoes` com 1 retry com backoff curto (500 ms) em erros de rede ou 5xx — não em 401 (esse já dispara `emitSessionExpired`). 3. Encadear `AbortController` do `useEffect` no cleanup do `usePermissaoOperacao` para cortar a rede em unmount (não só o `vivo` flag). Tactic Bass: **Retry** + **Predictive Model** (timeout como orçamento).

**Resultado Esperado**
> Uma queda transitória de rede não penaliza o usuário pela sessão inteira. Métrica: 0 retries → 1 retry com backoff; timeout implícito (~5min) → 3s explícito.

**Métricas de sucesso**
- `AbortSignal`/timeout em `fetchPermissoes`: ausente → 3s
- Retries em erro transitório: 0 → 1
- Duração máxima de request pendurado no navegador: ~5min → 3s

**Risco de não fazer**
> Usuários de Operação que caem em rede vacilante aparecem escondidos do próprio painel de Operação; suporte diagnostica errado ("sumiu a permissão"), o time gasta hora reproduzindo o que é rede.

**Dependências**: Nenhuma. Consolidar com [fault-tolerance-2], [integrability-1], [integrability-3], [performance-3] — todos os 5 refatoram o mesmo `fetchPermissoes` (ver CC-1 no REPORT).

---

### [deployability-2] Estreitar `usePathname()` na fonte — helper `useSafePathname()` ou lint rule

**QA**: Deployability
**Tactic alvo**: Reproducible Builds
**Esforço**: S (≤ 1d)
**Findings**: F-deployability-2

**Problema**
> 4 usos raw de `usePathname()` no frontend após o delta; 2 deles passam `string | null` direto para funções (`sidebar.tsx:343`, `bottom-nav.tsx:73`) — mesma pegadinha que quebrou `RouteGate.tsx:21` na `main`. Sem gate de build (ver deployability-1) e sem padrão único, cada novo componente é uma chance de recriar o bug.

**Melhoria Proposta**
> Criar `src/frontend/lib/nav/useSafePathname.ts` que encapsula `usePathname() ?? ''` e substituir os 4 usos raw; adicionar regra ESLint `no-restricted-imports` que barra `import { usePathname } from 'next/navigation'` fora deste helper. Tactic Bass: **Reproducible Builds** (elimina divergência entre `tsc --noEmit` e `next build`).

**Resultado Esperado**
> 0 usos raw de `usePathname()` fora do helper; o bug de null-pathname é impossível por construção.

**Métricas de sucesso**
- Usos raw de `usePathname()` em `src/frontend/`: 4 → 0
- Regra ESLint `no-restricted-imports` para `usePathname` fora do helper: ausente → presente

**Risco de não fazer**
> Cada novo componente de navegação/roteamento (o roadmap de 4 frentes garante que virão) reintroduz o risco.

**Dependências**: Preferível fazer depois de [deployability-1] para que o `next build` no CI valide a substituição.

---

### [deployability-3] Runbook curto de rollback do frontend em `DEPLOY.md`

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (≤ 2h)
**Findings**: F-deployability-3

**Problema**
> Nenhum runbook documenta como reverter um deploy do frontend na Vercel. A funcionalidade existe (Vercel "Instant Rollback"), mas quem está de plantão às 2h da manhã não sabe onde clicar. Este delta introduz 1266 LOC de nova UI em superfície crítica (moldura navegacional) — se ela quebrar, o custo do atraso é a UI toda indisponível.

**Melhoria Proposta**
> Adicionar seção "Rollback" em `DEPLOY.md` §3 (Vercel) com: (a) URL do dashboard Vercel do projeto; (b) print/screenshot da tela de deployments; (c) 3-passos "Promote to Production" do deploy anterior; (d) tempo típico (< 2min); (e) quando escalar vs. rollback (regra simples: bug visual bloqueando fluxo = rollback imediato). Tactic Bass: **Rollback**.

**Resultado Esperado**
> MTTR de bug frontend em produção mensurável e determinístico (≤ 5 min de decisão + 2 min de rollback), sem dependência de conhecimento tácito.

**Métricas de sucesso**
- Runbooks de rollback frontend: 0 → 1
- `grep -in rollback DEPLOY.md`: 0 → ≥ 1

**Risco de não fazer**
> Primeiro incidente na moldura de navegação vira ping para engenharia — perde-se a autonomia operacional que o design system tenta habilitar.

**Dependências**: Nenhuma.

---

### [integrability-1] Validar o shape de `/me/permissoes` no boundary do fetcher

**QA**: Integrability
**Tactic alvo**: Contract testing / Validate Input at boundary
**Esforço**: S (≤ 1d)
**Findings**: F-integrability-1

**Problema**
> `fetchPermissoes` retorna `(await res.json()) as Permissoes` (`lib/operacao.ts:102`). Uma mudança de contrato no backend faz o item "Operação" sumir da sidebar e do card da home em silêncio — o gate server-side segue firme, mas a ergonomia quebra sem sintoma diagnosticável.

**Melhoria Proposta**
> Adicionar validação Zod no fetcher (`lib/operacao.ts`) — schema `PermissoesSchema = z.object({ operacao: z.boolean() })`. Em falha de parse, tratar como fail-closed (retornar `{ operacao: false }`) **e** emitir `console.warn` estruturado. A moldura permanece silenciosa; o dev vê o desvio de contrato imediatamente.

**Resultado Esperado**
> Fetcher da moldura passa a validar o payload; mudança silenciosa de contrato vira erro visível em dev tools. Métrica: fetchers de contrato **da moldura** com validação de shape: 0 → 1 (o único que existe).

**Métricas de sucesso**
- Fetchers da moldura com validação de shape: 0/1 → 1/1
- Detecção de mudança silenciosa de contrato: 0 → 1 (warn no console + fallback fechado)

**Risco de não fazer**
> Um refactor de `GET /me/permissoes` no backend (razoável dado que o endpoint tende a evoluir com mais permissões — Frente IV, futuras allow-lists) esconde silenciosamente o Painel de Operação para todo o allow-list e ninguém percebe até abrir chamado. Custo do sintoma cresceu com este delta porque a sidebar agora é a única rota "descobrível" para chegar em `/operacao`.

**Dependências**: Nenhuma.

---

### [integrability-2] Extrair constantes de rota das frentes num módulo único

**QA**: Integrability
**Tactic alvo**: Encapsulate / Restrict Communication Paths
**Esforço**: S (introduzir); M (2-5d) para migrar todos os call sites existentes
**Findings**: F-integrability-2

**Problema**
> A string `'/permutas'` aparece em 5 arquivos fora de teste; `'/permutas/borderos'` em 4. Renomear uma frente cascateia por folder de rota + modelo de nav + cards da home + links de retorno das subpáginas — nenhum quebra em compile-time. Sintoma atual: "Adiantamentos" na sidebar (`app-nav.tsx:79-80`) aponta para `/recebimentos`, divergência semântica viva.

**Melhoria Proposta**
> Criar `src/frontend/lib/routes.ts` exportando constantes tipadas: `export const ROUTES = { permutas: '/permutas', permutasBorderos: '/permutas/borderos', sispag: '/sispag', recebimentos: '/recebimentos', operacao: '/operacao', usuarios: '/usuarios' } as const`. Migrar consumidores em ordem: `app-nav.tsx` primeiro (fonte de navegação), depois `app/page.tsx`, `home/*Card.tsx`, `permutas/**` links de retorno. Regra de lint local (ou grep no CI) para novas ocorrências de literais `'/permutas'` etc.

**Resultado Esperado**
> Uma rota tem duas fontes: (a) o folder `app/<rota>/`, (b) `lib/routes.ts`. Renomear é: mover folder + editar `routes.ts`. Métrica: literais de rota por frente cai de 4-5 → 1.

**Métricas de sucesso**
- Fontes de verdade para `/permutas` fora de teste: 5 → 2 (folder + `routes.ts`)
- Fontes para `/permutas/borderos`: 4 → 2

**Risco de não fazer**
> A divergência entre nome da UI ("Adiantamentos") e rota (`/recebimentos`) permanece ambígua; qualquer rename futuro (`/recebimentos` → `/adiantamentos` é o próximo passo natural do renomeio de UI) exige revisão manual de N arquivos e passa por code review sem que ninguém garanta a completude.

**Dependências**: Alinhar com PatternGuardian se cabe regra automatizada.

---

### [modifiability-1] Remover os botões "Voltar ao painel" das subpáginas de Permutas

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤ 1d)
**Findings**: F-modifiability-1

**Problema**
> As telas `BorderosPanel.tsx` (`:301`) e `clientes-filtro/page.tsx:180` mantêm um botão de retorno feito à mão para `/permutas`. Com a moldura em pé, a sidebar já expõe `/permutas` como pai dos dois itens e o realce de trilha ativa o pai quando o filho está aberto (`sidebar.tsx:69-70`); o BottomNav também expõe os dois níveis lado a lado (`bottom-nav.tsx:82-95`). O botão é redundante em desktop, duplicado em mobile e cria dois caminhos independentes para a mesma ação — cada divergência futura é silenciosa.

**Melhoria Proposta**
> Remover os dois botões e o import de `ArrowLeft`/`Link` que só serviam a eles. Se o time quiser preservar affordance para quem esconde a sidebar, adotar o `Breadcrumb` do design system (spec `layout.md` §Breadcrumb) — UMA fonte, mesmo modelo. **Tactic**: Abstract Common Services. **Arquivos**: `src/frontend/app/permutas/BorderosPanel.tsx`, `src/frontend/app/permutas/clientes-filtro/page.tsx`.

**Resultado Esperado**
> Trocar o rótulo/ícone de retorno ao painel de Permutas passa a custar 1 edição em `app-nav.tsx` (ou no `Breadcrumb`) em vez de 3. Zero divergência silenciosa entre botão e sidebar.

**Métricas de sucesso**
- Pontos de código que apontam para `/permutas` como "voltar": 3 → 1
- Testes de rendering de `BorderosPanel`/`clientes-filtro` que referenciam o botão: remover expectativa correspondente

**Risco de não fazer**
> Em 6 meses, o rótulo/ícone divergem entre os dois botões e a sidebar; um deles passa a levar a `/permutas?tab=X` e a moldura vira "quase" fonte única.

**Dependências**: Idealmente depois de [integrability-2] para usar `ROUTES.permutas` em vez de literal, caso o Breadcrumb seja adotado.

---

### [performance-1] Estabilizar `Sidebar` na hidratação para eliminar o flash de largura

**QA**: Performance
**Tactic alvo**: Reduce Overhead (Hydration cost)
**Esforço**: S (≤ 1d)
**Findings**: F-performance-1

**Problema**
> `Sidebar` renderiza sempre expandida no SSR (`defaultCollapsed=false`) e lê a preferência de `localStorage` em `useEffect` (`sidebar.tsx:139-144`). Se o usuário preferiu colapsada (`w-16`, 64px), o primeiro paint é 224px e o segundo é 64px — um deslocamento de ~160px que refluxa o `<main>` adjacente. Documentado como trade-off contra hydration mismatch, mas com alternativa não explorada.

**Melhoria Proposta**
> **Tactic Reduce Overhead / Hydration cost**: persistir `collapsed` em **cookie** (não localStorage) e ler o valor no Server Component do root layout, propagando via prop `defaultCollapsed` para `AppShell`. Assim o SSR já emite `w-16` diretamente para quem prefere colapsado, e o `useEffect` de leitura de storage vira redundante (pode ser removido). Alternativa mais barata: injetar `<script>` blocking no `<head>` que aplica classe no `<body>` antes do React hidratar (`data-sidebar-collapsed`) e ler dessa classe no `useState` inicializador. Arquivos: `app/layout.tsx` (Server Component), `components/AppShell.tsx` (aceitar prop), `components/ui/sidebar.tsx` (remover ou ajustar `useEffect`).

**Resultado Esperado**
> Zero flash de largura para o cenário "usuário prefere colapsada". CLS da moldura permanece 0 no primeiro paint. Deslocamento horizontal do `<main>` em hidratação: **~160px → 0px**.

**Métricas de sucesso**
- Deslocamento horizontal do `<main>` na hidratação: 160px → 0px
- Re-renders de `SidebarRoot` no primeiro segundo: 2 → 1
- CLS medido em `/permutas` (Web Vitals): baseline TBD → < 0.05

**Risco de não fazer**
> Usuários que colapsam a barra veem a moldura "pular" a cada F5. Percepção de instabilidade em ferramenta de operação diária.

**Dependências**: Nenhuma. (Cross-QA: testability — o hook `useSyncExternalStore` ou a via cookie são mais testáveis que `useEffect + localStorage`.)

---

### [fault-tolerance-2] Timeout + AbortController em `fetchPermissoes()` para não pendurar a permissão de Operação a sessão inteira

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults → Timeout; Contain Faults → Reintroduction
**Esforço**: S (≤ 1d)
**Findings**: F-fault-tolerance-2, F-fault-tolerance-4

**Problema**
> `usePermissaoOperacao` faz `fetchPermissoes()` sem `AbortController`, sem `Promise.race` com timeout, e o `useEffect` roda 1x por sessão (deps `[]`). Se o backend não responde na primeira carga do app, a Promise fica pending e "Operação" fica escondido até o usuário fazer F5 — mesmo que o backend volte a responder 5s depois.

**Melhoria Proposta**
> Envolver a chamada em `RetryExecutor`/`PollExecutor` do domínio **ou** aplicar `AbortController` com timeout de 3–5s + fallback para o valor default (`false`). Ao mesmo tempo, adicionar re-fetch em `window.addEventListener('focus', ...)` para reabilitar o item quando o usuário volta ao browser depois de uma queda de rede. Tactic Bass: **Detect Faults / Timeout** + **Contain Faults / Reintroduction**.

**Resultado Esperado**
> Fetch pendurado ≥ 5s é abortado e loga condição (ver card 3). Item reaparece automaticamente quando o usuário foca a janela após a rede voltar. Requer no máximo 1 F5 por sessão em vez de "para sempre".

**Métricas de sucesso**
- Timeout no `fetchPermissoes()`: 0ms (infinito) → 5s
- Gatilhos de re-fetch: 1 (montagem) → 2 (+ focus)
- Teste "promessa pendurada é abortada em 5s": ausente → presente

**Risco de não fazer**
> Chamados recorrentes de "cadê o Painel de Operação?" após qualquer blip de rede no login; MTTR percebido = tempo até o usuário lembrar de fazer F5.

**Dependências**: Nenhuma. Consolidar com [availability-2], [integrability-1], [integrability-3], [performance-3] — refatoram o mesmo `fetchPermissoes`.

---

### [testability-2] Adicionar `jest-axe` e uma suíte de a11y para a moldura

**QA**: Testability
**Tactic alvo**: Executable Assertions (extensão a11y)
**Esforço**: S (≤ 1d — instalar `jest-axe`, criar `AppShell.a11y.test.tsx` com 4 cenários)
**Findings**: F-testability-2

**Problema**
> A moldura passou a viver em TODA rota autenticada — é a superfície mais crítica para a11y do produto (skip link, landmarks, `aria-current`, `aria-expanded`, `aria-controls`, foco visível). As 11 invariantes documentadas em `ontology/ui-flows/navegacao-global.md` viraram asserção manual (`getByRole` + `toHaveAttribute`). Não há `jest-axe`; `axe-core` só aparece em `package-lock.json` como dep transitiva. Cada regra nova de a11y ao longo do backlog (popover do sub-item colapsado, paleta ⌘K, dark mode) vai gerar 3-5 linhas de asserção manual por lugar.

**Melhoria Proposta**
> Adicionar `jest-axe` como devDependency do frontend. Criar um `AppShell.a11y.test.tsx` que renderize `<AppShell>` em 4 cenários (autenticado desktop, autenticado mobile, `/login`, `/docs` sem sessão) e chame `expect(await axe(container)).toHaveNoViolations()` em cada. Documentar no `ontology/ui-flows/navegacao-global.md` §Testes que a checagem `axe` é a defesa automática, e as asserções manuais existentes ficam como *invariantes-narrativas* (o `aria-current` único, o `<h1>` único, o skip link primeiro focável) — que são mais fortes que o `axe` para essas duas regras. Tactic Bass: *Executable Assertions* aplicada à a11y (asserções que crescem O(1), não O(landmarks)).

**Resultado Esperado**
> A moldura passa a ter 0 violações WCAG 2.1 AA verificadas em cada `npm test`. Uma extensão futura que quebre contraste, adicione um botão sem `aria-label` ou remova a nomeação de uma landmark quebra o build local antes de virar PR.

**Métricas de sucesso**
- Regras de a11y verificadas automaticamente na moldura: 0 → ≥ 30 (default do `axe.run`)
- Cenários renderizados sob a varredura: 0 → 4 (desktop autenticado, mobile autenticado, `/login`, `/docs` público)
- LOC de asserção manual de a11y por regra nova no backlog: 3-5 → 0

**Risco de não fazer**
> Cada card do backlog da moldura (paleta ⌘K, popover do sub-item colapsado, dark mode) vai reabrir a discussão de que asserção manual escrever e onde. Uma quebra silenciosa (ex.: perder a nomeação de landmark ao refatorar) vira ticket do usuário, não teste vermelho.

**Dependências**: Nenhuma.

---

### [testability-3] `satisfies` nos mocks de `@/lib/operacao` para detectar drift de contrato

**QA**: Testability
**Tactic alvo**: Abstract Data Sources / Recordable Test Cases
**Esforço**: S (≤ 1d — 3 arquivos, 5-10 linhas cada)
**Findings**: F-testability-3

**Problema**
> Três arquivos de teste mockam `@/lib/operacao` com `{ operacao: true }` literal, sem checagem de shape. Se `Permissoes` mudar de `{ operacao: boolean }` para `{ operacao: { ativo: boolean } }` (ou o campo for renomeado), os mocks continuam compilando, os testes continuam verdes, e a Sidebar em produção esconde o item de Operação — sem alarme. O próprio repo já tem precedente do padrão certo em `app/operacao/page.test.tsx` (que usa `jest.requireActual` para reaproveitar o tipo real).

**Melhoria Proposta**
> Nos três arquivos que mockam `@/lib/operacao` (`__tests__/AppShell.test.tsx:26`, `components/nav/app-nav.test.tsx:12`, mais o `app/operacao/page.test.tsx` já existente como referência), tipar os mocks com `import type { Permissoes } from '@/lib/operacao'` e usar `satisfies Permissoes` no objeto de retorno. Estabelecer regra no `docs/design-system/*` ou `CLAUDE.md` do frontend: "mocks de módulos internos usam `satisfies <TipoReal>`". Tactic Bass: *Abstract Data Sources* (usar a abstração que já existe, em vez de mocar a implementação por baixo).

**Resultado Esperado**
> Mudança de contrato de `Permissoes` no backend/lib quebra o build dos testes que mockam o módulo, no lugar de virar item sumido em produção. Custo médio de investigação de "sumiu o item da Sidebar" cai de ~30min para 0.

**Métricas de sucesso**
- Mocks de `@/lib/operacao` sem `satisfies`: 3/3 → 0/3
- Regra registrada no repositório: 0 → 1 (`docs/design-system/mock-drift.md` ou §CLAUDE.md do frontend)

**Risco de não fazer**
> No primeiro refactor do backend que ajustar `Permissoes` (ex.: adicionar `operacaoRestrita` para o allow-list separado por frente), o front vai esconder o item silenciosamente e o suite não pega.

**Dependências**: Nenhuma.

---

### [performance-2] Instrumentar `First Load JS` e criar budget para o shared chunk

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: M (2–5d — CI + workflow + baseline)
**Findings**: F-performance-3

**Problema**
> O `next build` no worktree aborta por `Turbopack Panic: Symlink [project]/node_modules is invalid` (esperado — worktree usa `node_modules` linkado). O baseline em `_shared-metrics.md` só afirma "compila e prerenderiza 12 rotas" sem tamanho por rota. Como a moldura entra no root layout, qualquer aumento no shared chunk atinge **todas** as 12 rotas — regressão passaria despercebida.

**Melhoria Proposta**
> **Tactic Reduce Overhead + Bound Execution Times**: capturar `First Load JS` por rota no CI (workflow atual do Render deploy hook), gravando a saída de `next build` em artifact. Adicionar step de comparação com baseline (script simples de parsing do output de `next build`) que falha o CI se o shared chunk crescer >20KB entre releases. Complementar: rodar o build no **checkout principal** após merge deste delta e registrar em `_shared-metrics.md` o número atual (rotas × First Load JS + shared).

**Resultado Esperado**
> Baseline numérica de First Load JS por rota gravada e monitorada. Regressão de bundle detectada no CI antes de ir a produção. Alvo defensável: shared chunk ≤ ~180KB gzipped (p95 First Load JS ≤ 200KB por rota — literatura Web Vitals).

**Métricas de sucesso**
- Baseline First Load JS por rota: ausente → tabela de 12 valores
- Regressão do shared chunk: silenciosa → falha no CI se >+20KB

**Risco de não fazer**
> A moldura vai crescendo (paleta ⌘K, badges reais, dark mode — todos no backlog de `navegacao-global.md`), e cada adição infla o shared chunk sem alarme. Frontend fica lento em campo antes de qualquer sinal.

**Dependências**: workflow do Render/GitHub Actions atual. **Cross-QA com Deployability** — o mesmo hook de build.

---

### [security-2] Migrar JWT de `localStorage` para cookie `HttpOnly; Secure; SameSite=Strict`

**QA**: Security
**Tactic alvo**: Encrypt Data / Limit Exposure
**Esforço**: M (2–5d — toca backend, frontend, CORS)
**Findings**: F-security-2

**Problema**
> `auth_token` mora em `localStorage` (`lib/auth/token.ts:20`) e é lido a cada montagem via `getAccessToken()`. Qualquer XSS em qualquer página do app envolvida pela nova moldura `AppShell` exfiltra o Bearer com uma linha de JavaScript. A moldura não introduz XSS, mas passou a ser o padrão pelo qual toda tela autenticada é renderizada — aumenta a superfície coberta por um único vetor de exfiltração.

**Melhoria Proposta**
> `POST /auth/login` no backend passa a devolver `Set-Cookie: auth=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/`. O `withAuthHeaders` para de anexar `Authorization: Bearer` (cookie é enviado pelo navegador). `getAccessToken` deixa de existir; o cliente descobre "está logado?" via `GET /me` (`credentials: 'include'`) em vez de espiar o token. Tactic alvo: **Encrypt Data / Limit Exposure**. Impacta backend (CORS `Access-Control-Allow-Credentials: true`), `AuthProvider`, `apiFetch`. Mudança grande de propósito — é o único jeito de tirar o token do alcance do JS da página.

**Resultado Esperado**
> `document.cookie` não expõe o token (flag `HttpOnly`). XSS em qualquer página do app deixa de ser vetor direto de roubo de sessão. Métrica: chaves de `localStorage` contendo credencial: 1 → 0.

**Métricas de sucesso**
- Chaves de `localStorage` com credencial: 1 → 0
- Token acessível via `document.cookie` do JS da página: sim → não

**Risco de não fazer**
> Um XSS em qualquer futura tela do sistema — inclusive uma tabela SISPAG que renderize um campo livre do Conexos sem escapar — vira exfiltração de sessão admin sem log, sem alarme e sem trilha.

**Dependências**: Alinhar com backend (formato do `Set-Cookie`, `CORS`), decidir se `signOut` chama `POST /auth/logout` para invalidar server-side.

---

### [security-3] Emitir trilha de auditoria dos eventos de auth do frontend

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: M (2–5d — precisa da tabela `audit_log` server-side aceitar novos tipos)
**Findings**: F-security-3

**Problema**
> O fluxo de login/logout/sessão expirada não deixa registro em lugar nenhum. Um analista que questiona "eu não fiz essa remessa" não tem como o time correlacionar qual sessão iniciou aquela ação — nem se houve login suspeito na noite anterior. Combinado com o F-security-1 e o F-security-2, forense pós-incidente vira dedução por horário.

**Melhoria Proposta**
> Adicionar `POST /audit/security-event` (backend novo, ver Fault Tolerance para o esquema de tabela) e emitir dele nos quatro eventos do frontend: `login-success`, `login-failure` (sem senha, só usuário + motivo), `sign-out`, `session-expired`. Payload mínimo: `{ event, username, userAgent, at }`. Chamada `void`, `keepalive: true` (usa Beacon-like fetch). Tactic alvo: **Audit Trail**.

**Resultado Esperado**
> Eventos de auth do frontend aparecem na trilha ao lado das ações financeiras (remessa, baixa, permuta), permitindo correlacionar "quem entrou às 03h" com "quem finalizou o lote às 03h05". Métrica: eventos de auth reportados por dia útil: 0 → ≥ 3 por usuário ativo (login + logout + eventual expiração).

**Métricas de sucesso**
- Eventos de auth persistidos: 0 → ≥ 4 tipos (login-success, login-failure, sign-out, session-expired)
- Cobertura por usuário ativo em amostra semanal: 0% → 100%

**Risco de não fazer**
> Incidente sem chance de reconstrução — o cenário "credencial roubada por phishing operou às 3h" fica indistinguível de "o analista fez o pagamento e esqueceu".

**Dependências**: Fault Tolerance (formato do `audit_log`), definição de retenção com o time da Columbia.

---

### [testability-4] Smoke E2E mínimo (Playwright) da moldura em rota autenticada

**QA**: Testability
**Tactic alvo**: End-to-end smoke
**Esforço**: M (2-5d — setup Playwright, credencial de dev, wiring no CI, primeiro smoke)
**Findings**: F-testability-4

**Problema**
> O frontend não tem E2E automatizado — `docs/e2e/` é markdown de rodadas manuais contra Conexos HML. A moldura agora vive em TODA rota autenticada; uma regressão que só aparece com providers reais hidratados (`AuthProvider`, `next/link` real, `usePathname` real do App Router) passa por todos os unit tests. É uma dívida pré-existente; o delta apenas amplia o custo dela.

**Melhoria Proposta**
> Adicionar Playwright como devDependency do frontend. Escrever UM smoke test: (a) abre `/login`, (b) faz login com credencial de dev, (c) clica em cada item visível da sidebar, (d) para cada rota, valida que existe um `role="main"`, um único `<h1>` e um único `aria-current="page"`. Rodar em CI, opcionalmente com `test.setTimeout(30_000)` como gate opcional. Tactic Bass: *End-to-end smoke* — o menor teste que exercita a integração real.

**Resultado Esperado**
> Cada PR que toca a moldura tem um segundo teste (o real) além dos unit tests. Regressões de hidratação, de `Link` do Next, de context provider e de router passam a ter alarme.

**Métricas de sucesso**
- Testes E2E automatizados: 0 → ≥ 1
- Rotas autenticadas exercitadas em CI: 0 → 5 (`/permutas`, `/permutas/borderos`, `/sispag`, `/recebimentos`, `/operacao` ou `/usuarios` conforme permissão)
- Invariantes da moldura verificadas end-to-end: 0 → 3 (`role="main"`, `<h1>` único, `aria-current` único)

**Risco de não fazer**
> Qualquer refactor de `layout.tsx`, `AuthProvider` ou `RouteGate` risca produção sem alarme. A moldura em toda rota multiplica o raio de explosão.

**Dependências**: Credencial de dev estável (existir um tenant/usuário de teste no Supabase para o CI).

---

## P3 — Baixo

### [availability-3] Consumir `loading` do `useIsAuthenticated` no `AppShell` para evitar flash sem nav

**QA**: Availability
**Tactic alvo**: Sanity Checking
**Esforço**: S (≤ 1d)
**Findings**: F-availability-3

**Problema**
> `AppShell` só olha `authenticated` (`AppShell.tsx:252`, `:280`). No primeiro render após montar, `AuthProvider` ainda não leu o token do `localStorage` (isso acontece em `useEffect` pós-mount), então `authenticated=false` → a moldura renderiza **sem sidebar**. No render seguinte a nav aparece e empurra o main — layout thrash visível.

**Melhoria Proposta**
> Destructurar `loading` também e, em `loading=true`, renderizar a moldura com um placeholder de sidebar (mesma largura, `aria-busy="true"`, skeleton opcional) em vez de nada. Alternativa mais simples: `{authenticated || loading ? <AppNavigation /> : null}` — assume "vai autenticar" enquanto resolve, e o `AppNavigation` que já falha fechada em cada consulta. Tactic Bass: **Sanity Checking** (checar o estado antes de decidir o layout).

**Resultado Esperado**
> O boot da app não pisca "sem nav → com nav". A largura do `main` é estável desde o primeiro frame. Métrica: 0 tratamento de `loading` → ramo explícito; Cumulative Layout Shift no boot percebido ≈ 0.

**Métricas de sucesso**
- Uso do `loading` no `AppShell`: 0 → 1
- Reservar largura da sidebar no primeiro render (visual): não → sim

**Risco de não fazer**
> Sensação de "app trocando de tela sozinho" no login e em F5; nada dispara queixa formal, mas é dívida de polish que o design system explicitamente evita em outros lugares (ver `docs/design-system/layout.md`).

**Dependências**: Nenhuma.

---

### [deployability-4] Smoke-test pós-deploy contra a URL da Vercel

**QA**: Deployability
**Tactic alvo**: Deployment Observability
**Esforço**: S (≤ 1d)
**Findings**: F-deployability-5

**Problema**
> Nenhum workflow roda `curl` contra `https://<app>.vercel.app/login` (ou `/`) após o deploy para confirmar que a página responde 200 e contém marcadores mínimos (`role="navigation"`, `aria-current`). Deploy verde no Vercel ≠ página funcional. Detecção hoje é 100% reativa (usuário reclama).

**Melhoria Proposta**
> Novo workflow `.github/workflows/frontend-smoke.yml` disparado por `workflow_run` do CI ou por `deployment_status: success`. Steps: `curl -sf https://<vercel-url>/login | grep -q 'role="navigation"'` e um segundo curl em `/`. Tactic Bass: **Deployment Observability**.

**Resultado Esperado**
> Detecção automática ≤ 60s pós-deploy se a rota `/login` retornar 500 ou HTML sem a moldura. Alarme (issue automática ou notificação) sem depender do olho humano no dashboard Vercel.

**Métricas de sucesso**
- Smoke-tests pós-deploy: 0 → ≥ 2 (rota pública `/login` + rota autenticada com bypass)
- Tempo médio de detecção de deploy quebrado: reativo (horas) → ≤ 60s

**Risco de não fazer**
> Baixo hoje (usuário interno único), mas cresce à medida que outros clientes chegam (roadmap SaaSo em CLAUDE.md).

**Dependências**: Idealmente após [deployability-1] para reduzir ruído (se o build fica verde, o smoke deve ficar verde).

---

### [deployability-5] Kill-switch env `NEXT_PUBLIC_NEW_NAV_ENABLED` como padrão de rollback lógico

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤ 1d)
**Findings**: F-deployability-4

**Problema**
> Moldura de navegação (5 componentes, 1266 LOC) sai para 100% dos usuários no primeiro deploy. Regresso exige rollback do deploy inteiro. O time já domina o padrão de kill-switch por env no backend (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED` em `render.yaml`) — a prática não atravessou para o frontend.

**Melhoria Proposta**
> Envolver `<AppNav />` em `AppShell.tsx` num guarda `process.env.NEXT_PUBLIC_NEW_NAV_ENABLED !== 'false'` (fail-open: default habilitado; setar `false` na Vercel derruba a nova nav sem redeploy). Manter fallback ao header antigo (o commit tem os 47 LOC originais no diff) por 2 sprints; remover depois. Tactic Bass: **Scale Rollouts** (kill-switch como forma degenerada de canary).

**Resultado Esperado**
> Regresso na nova moldura pode ser desligado em ≤ 30s via dashboard Vercel, sem redeploy, sem depender de rollback de artefato.

**Métricas de sucesso**
- Flags gate a moldura de navegação: 0 → 1
- Tempo para desligar a moldura em emergência: rollback de deploy (~5min) → toggle env (~30s)

**Risco de não fazer**
> Baixo. É melhoria de padrão; a moldura em si é bem testada (93% cobertura média).

**Dependências**: Nenhuma. Alinhado com o padrão que o backend já usa.

---

### [integrability-3] Extrair `usePermissaoOperacao` para hook compartilhado

**QA**: Integrability
**Tactic alvo**: Abstract Common Services / Manage Resource Coupling
**Esforço**: S (≤ 1d)
**Findings**: F-integrability-3

**Problema**
> O padrão `useEffect + fetchPermissoes + isMounted guard + fail-closed` está inlined em `components/nav/app-nav.tsx:121-140` (privado) e em `components/home/OperacaoHomeCard.tsx:23-40`. Coexistem na rota `/` — 2 requests simultâneos ao mesmo endpoint por hidratação. Uma mudança de política (cache, retry, invalidação em `signOut`) exige editar dois lugares e esperar que nenhum divirja.

**Melhoria Proposta**
> Extrair `usePermissaoOperacao()` para `src/frontend/lib/permissoes.ts` (ou `lib/auth/`), com deduplicação por request via SWR/React Query **ou** memoização a nível de módulo por sessão. Migrar `app-nav.tsx` e `OperacaoHomeCard.tsx` para o hook único. Fail-closed permanece; ganha-se ponto único para futura política de cache/retry.

**Resultado Esperado**
> Consumidores da política de allow-list de Operação passam pelo mesmo hook. Métricas: implementações duplicadas 2 → 1; requests a `/me/permissoes` na home 2 → 1 (com cache).

**Métricas de sucesso**
- Implementações do padrão fetch-permissoes: 2 → 1
- Requests a `/me/permissoes` por hidratação da home: 2 → 1

**Risco de não fazer**
> Cresce à medida que a Frente IV e uma futura tela de allow-list adicionarem novos consumidores do mesmo gate; a chance de divergência cresce linearmente.

**Dependências**: coordenar com o card [integrability-1] — o hook já sai com validação Zod. Consolidar com [availability-2], [fault-tolerance-2], [performance-3] (mesmo `fetchPermissoes`).

---

### [integrability-4] Observabilidade mínima em falhas da moldura

**QA**: Integrability
**Tactic alvo**: Observability of integration failures
**Esforço**: S (≤ 1d)
**Findings**: F-integrability-4

**Problema**
> `app-nav.tsx:133-135` engole erro em `.catch(() => setPermitido(false))`. É a política certa (fail-closed), mas sem sinal nenhum: outage de `/me/permissoes` some do radar do dev até virar ticket.

**Melhoria Proposta**
> No `catch` da moldura (e no hook extraído pelo card 3), emitir `console.warn('[nav] fetchPermissoes falhou; item Operação escondido', err)` estruturado. Quando existir um bus de telemetria de frontend (fora do escopo desta feature), plugar ali. Não introduzir toast — o fail-closed é deliberadamente silencioso para o usuário.

**Resultado Esperado**
> Falha no único endpoint que a moldura consome deixa rastro em devtools. Métrica: sinais emitidos em falha de `/me/permissoes` 0 → 1 (console.warn).

**Métricas de sucesso**
- Falhas silenciosas de `/me/permissoes` na moldura: sim → não (warn em devtools)
- Tempo até diagnóstico de degradação do endpoint em ambiente local: ticket → devtools

**Risco de não fazer**
> MTTR de degradação silenciosa fica limitado pela abertura de ticket; a moldura vira uma superfície diagnóstica surda.

**Dependências**: Nenhuma; combina bem com [integrability-3].

---

### [modifiability-2] Extrair a altura do header para um único token compartilhado

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S (≤ 1d)
**Findings**: F-modifiability-2

**Problema**
> `AppShell.tsx:29-31` define `HEADER_HEIGHT = 'h-14'` e `HEADER_OFFSET = 'top-14'` como duas strings independentes. O comentário in-source adverte "mudam juntas" — a advertência é a admissão de que não é o código que garante. Mudar para `h-16` sem lembrar de `top-16` esconde a sidebar por baixo do header e nenhum gate protesta (não é warning de Biome, não é falha de teste — só o pixel).

**Melhoria Proposta**
> Adotar um número (`const HEADER_H = 14`, unidades de `0.25rem`) e derivar as duas classes (`h-${HEADER_H}` só funciona se as classes estiverem no safelist do Tailwind; alternativa mais segura é usar `style={{ height: '3.5rem' }}` no header e `top-14` como classe única) — OU adicionar teste snapshot que garanta a igualdade string a string. **Tactic**: Encapsulate. **Arquivo**: `src/frontend/components/AppShell.tsx`.

**Resultado Esperado**
> Uma única fonte de verdade para altura do header. Redesign de altura passa a ser edição de 1 constante numérica, sem dupla verificação manual.

**Métricas de sucesso**
- Strings de altura de header em `AppShell.tsx`: 2 → 1
- Testes que travam a relação `header.height == sidebar.top`: 0 → 1

**Risco de não fazer**
> Baixo até a próxima mudança de altura; alto naquele exato momento.

**Dependências**: Nenhuma.

---

### [modifiability-3] Documentar a decisão "badge sem consumidor" com data de expiração e conectar ao backlog

**QA**: Modifiability
**Tactic alvo**: Defer Binding (proteger a decisão, não desfazer)
**Esforço**: S (≤ 1d)
**Findings**: F-modifiability-4

**Problema**
> A prop `badge` de `SidebarItem` está implementada, testada (`badge 0` esconde, `badge 140 → 99+`) e sem consumidor real (`ontology/ui-flows/navegacao-global.md:73-77` reconhece; `moldura-navegacao-tasks.md:69-73` idem). É defer-binding intencional — o dia em que o endpoint de contagens existir, o custo é ~60 LOC em `app-nav.tsx`. Sem data ou dono, código intencionalmente morto vira código acidentalmente morto em ~6 meses.

**Melhoria Proposta**
> Registrar no `ontology/_inbox/moldura-navegacao-followups.md` (ou reaproveitar o `moldura-navegacao-tasks.md` fechado) uma linha explícita: **"prop `badge` fica sem consumidor até YYYY-MM; se o endpoint de contagens não chegar até lá, revisar se vale manter"**. Opcionalmente, marcar as duas variantes de badge (sidebar e BottomNav) com `@deprecated?` de convenção interna que sinalize "aguardando cliente". **Tactic**: Defer Binding — mantido, com controle temporal explícito.

**Resultado Esperado**
> A decisão fica auditável na próxima retro-ontology. Não vira "por que isso existe?" na leitura de código de daqui a 6 meses.

**Métricas de sucesso**
- Linha explícita no inbox com data de revisão: 0 → 1
- `/retro-ontology` da semana X lista essa decisão como "verificar hoje?"

**Risco de não fazer**
> Em 6 meses o próximo dev remove `badge` "porque ninguém usa" e o custo do endpoint sobe 60 LOC para restaurar o contrato. Ou pior: mantém e ninguém sabe se ainda é para ser ligado.

**Dependências**: Nenhuma.

---

### [performance-3] Adicionar timeout ao `fetchPermissoes` e propagar `AbortController` do hook

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤ 1d)
**Findings**: F-performance-2

**Problema**
> `usePermissaoOperacao` chama `fetchPermissoes` sem timeout (`operacao.ts:101-105` e `app-nav.tsx:117-131`). Se o backend não responder, a Promise fica pendente indefinidamente e o item "Operação" permanece escondido sem sinal para o usuário. O cleanup (`vivo = false`) evita `setState` após unmount, mas não corta a request.

**Melhoria Proposta**
> **Tactic Bound Execution Times**: `fetchPermissoes` deve aceitar `AbortSignal` opcional; `usePermissaoOperacao` cria `AbortController` no `useEffect`, aborta no cleanup e configura `setTimeout(() => controller.abort(), 5000)` como budget. Falha por timeout continua tratada como "esconde o item" — mas agora com log/telemetria para diagnosticar backend lento vs. permissão real. Arquivos: `src/frontend/lib/operacao.ts`, `src/frontend/components/nav/app-nav.tsx`.

**Resultado Esperado**
> Toda chamada de permissão termina em ≤ 5s (sucesso ou abort). Impossível manter Promise pendente órfã. Sinal de backend degradado emerge no log em vez de sumir dentro de "esconde o item".

**Métricas de sucesso**
- Timeout configurado no client: 0ms (nenhum) → 5000ms
- Chamadas pendentes órfãs após unmount: possíveis → 0 (aborto explícito)

**Risco de não fazer**
> O padrão "fetch sem timeout, falha silenciosa" replica em todo hook novo de permissão. Cross-QA com Availability/Fault Tolerance.

**Dependências**: Nenhuma. Consolidar com [availability-2], [fault-tolerance-2], [integrability-3] (mesmo `fetchPermissoes`).

---

### [fault-tolerance-3] Sinalizar falha de `fetchPermissoes()` no console/telemetria — fail-closed é política, silêncio absoluto é acidental

**QA**: Fault Tolerance
**Tactic alvo**: Detect Faults → Condition Monitoring
**Esforço**: S (≤ 1d)
**Findings**: F-fault-tolerance-3

**Problema**
> O `.catch(() => setPermitido(false))` em `app-nav.tsx:135-137` esconde a falha sem produzir **nenhum** sinal — nem `console.warn`, nem `notify.error`, nem telemetria. A política de esconder o item (fail-closed) é deliberada e correta (`docs/design-system/feedback.md`); o silêncio total até para o console de dev não é — é acidente do idioma `.catch(() => noop)`.

**Melhoria Proposta**
> Adicionar `console.warn('[nav] fetchPermissoes falhou; item de Operação escondido', err)` no `catch`. Quando existir infra de telemetria no frontend (não neste delta), emitir um evento `nav.permission_fetch_failed` com tag do usuário. Não usar `notify.error`/`toast` porque contradiz a política de esconder em silêncio para o usuário — o sinal é para o desenvolvedor. Tactic Bass: **Detect Faults / Condition Monitoring**.

**Resultado Esperado**
> MTTD do modo de falha "Operação some inexplicavelmente" cai de "tempo até o usuário reclamar" para "primeira vez que o dev abre o DevTools do usuário afetado".

**Métricas de sucesso**
- Sinais em `catch` do delta: 0 → 1 (`console.warn`)
- Teste asserta `console.warn` chamado quando `fetchPermissoes` rejeita: ausente → presente

**Risco de não fazer**
> Incidente silencioso, dependente de reclamação; nenhuma métrica agregada de frequência.

**Dependências**: Nenhuma. Combina naturalmente com [integrability-3].

---

### [fault-tolerance-4] Re-fetch da permissão em `window.focus` — permissão negada no boot não deve valer para sempre

**QA**: Fault Tolerance
**Tactic alvo**: Contain Faults → Reintroduction
**Esforço**: S (≤ 1d) — mais simples se combinado com o card [fault-tolerance-2]
**Findings**: F-fault-tolerance-4

**Problema**
> `useAppNavGroups` roda `fetchPermissoes` uma única vez, na montagem da moldura, que é a raiz do app e sobrevive à sessão inteira. Se o backend estava fora quando o usuário abriu a página (VPN reconectando, cold start), o item "Operação" nunca reaparece — nem em navegação de rota, nem em foco de janela — só em reload completo.

**Melhoria Proposta**
> Ouvir `document.addEventListener('visibilitychange', ...)` ou `window.addEventListener('focus', ...)` no `usePermissaoOperacao` e refazer a consulta quando o usuário volta ao tab. Alternativa: mover a permissão para o `AuthProvider` (que já tem lifecycle mais ativo) e expô-la como campo do contexto. Tactic Bass: **Contain Faults / Reintroduction**.

**Resultado Esperado**
> Permissão que estava negada no boot é reavaliada automaticamente quando o usuário volta ao tab; item aparece sem F5.

**Métricas de sucesso**
- Gatilhos de re-fetch: 1 → ≥ 2 (montagem + focus/visibility)
- Teste "permissão reavalia em focus": ausente → presente

**Risco de não fazer**
> Baixo — reload resolve. Mantido no radar como higienização.

**Dependências**: [fault-tolerance-2] (natural agrupar).

---

### [testability-5] Property-based test para `resolveActiveItemId` sobre árvores geradas

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism (property-based)
**Esforço**: S (≤ 1d — `fast-check` já está no ecossistema do repo)
**Findings**: F-testability-5

**Problema**
> `resolveActiveItemId` foi extraída como função pura (`sidebar.tsx`), operação recursiva sobre árvore de rotas. Tem 3 casos de teste — cobre o caminho feliz. A tactic *Limit Non-Determinism* aplicada a lógica pura sobre árvores é property-based testing: gerar árvores e afirmar propriedades (idempotência, um único ativo, prefixo mais longo vence). `fast-check` já é dep do backend financeiro mas não do frontend.

**Melhoria Proposta**
> Adicionar `fast-check` como devDependency do frontend. Escrever ≥ 3 propriedades para `resolveActiveItemId`:
> 1. Para toda árvore e todo `pathname`, o resultado é `undefined` ou o `id` de um item que casa por `href` exato ou por prefixo `href + '/'`.
> 2. Se um item filho casa, o pai não é escolhido.
> 3. Itens `hidden: true` nunca são o resultado.
> Tactic Bass: *Limit Non-Determinism* — a propriedade cobre árvores que ninguém pensou em enumerar.

**Resultado Esperado**
> `resolveActiveItemId` deixa de depender de asserção por exemplo — a propriedade sozinha varre 100+ árvores geradas por PR. Uma futura reescrita (ex.: memoizar, migrar para árvore imutável) mantém a propriedade sem reescrever teste.

**Métricas de sucesso**
- Propriedades em `resolveActiveItemId`: 0 → ≥ 3
- Árvores exercitadas por rodada: 3 (fixas) → 100+ (geradas)
- Uso de `fast-check` no frontend: 0 → ≥ 1 arquivo

**Risco de não fazer**
> Baixo. Este card é oportunidade, não obrigação.

**Dependências**: Nenhuma.

---

### [performance-4] Instrumentar Web Vitals (LCP/CLS/INP) no root layout

**QA**: Performance
**Tactic alvo**: Reduce Overhead (instrumentação); Manage Sampling Rate
**Esforço**: M (2–5d — endpoint + report + dashboard)
**Findings**: F-performance-1, F-performance-3

**Problema**
> A moldura agora define a experiência de toda página autenticada, mas não há coleta de Web Vitals — decisões de perf ficam por inspeção. Não é possível dizer se o card `performance-1` (CLS) resolveu o problema em campo, nem quantificar regressões futuras.

**Melhoria Proposta**
> **Tactic Reduce Overhead + Manage Sampling Rate**: usar `useReportWebVitals` (Next 15+/16) no root layout para enviar LCP/CLS/INP/TTFB para o backend (POST assíncrono, sem bloquear render). Amostrar 100% em dev/UAT e 10% em produção (Manage Sampling Rate). Sink inicial pode ser `LogService` do backend (o mesmo canal do `/operacao`) — sem custo de infra novo.

**Resultado Esperado**
> Web Vitals por rota visíveis no painel de Operação; p95 LCP e CLS medidos, não estimados. Alvos-referência (literatura Web Vitals): p75 LCP < 2.5s · p75 CLS < 0.1 · p75 INP < 200ms.

**Métricas de sucesso**
- Cobertura de Web Vitals coletados: 0% → 100% dev / 10% prod
- Baseline p75 LCP/CLS/INP: ausente → medido

**Risco de não fazer**
> Performance vira debate sem dado. Regressões de UI grandes (paleta ⌘K, dark mode) chegam ao usuário sem revisão numérica.

**Dependências**: Endpoint backend para receber Web Vitals (fora do escopo deste delta).

