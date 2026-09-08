# moldura-navegacao — follow-ups do Regis-Review

> Run: `docs/regis-review/2026-09-03-1913-moldura-navegacao/` (REPORT.md / KANBAN.md).
> Feature: `feat/moldura-navegacao`, commit `05606a6` + fix P1 do DesignSystemReviewer.
> **Gate: 0 findings P0 → passa.** Pela regra do `/feature-tweak`, P1/P2/P3 **não são
> implementados** nesta rodada; ficam aqui.
>
> Scores: Availability 8 · Deployability 6,0 · Integrability 7 · Modifiability 9 ·
> Performance 8 · Fault Tolerance 7,0 · Security 8 · Testability 7.
> **Overall ponderado 7,6** — "saudável com oportunidades pontuais".
> 31 cards: **0 P0 · 4 P1 · 15 P2 · 12 P3** (contagem do consolidator).
>
> ⚠️ **Errata aplicada depois da consolidação:** `deployability-1` cai de P1 para P2 e
> `deployability-2` é descartado — a evidência que os sustentava era falsa. Ver
> `docs/regis-review/2026-09-03-1913-moldura-navegacao/ERRATA.md`. Fila efetiva de P1: **3**.

## Fechado no merge com `fix/tapar-furos-backend` (2026-09-08)

Quatro cards saíram da fila sem entrar numa rodada nova: dois foram implementados por serem
baratos demais para adiar, e dois já estavam resolvidos do outro lado do merge — o Regis-Review
desta feature não enxergava a branch de backend, então os relatou como abertos.

| Card | Situação | Onde |
|---|---|---|
| `fault-tolerance-1` / `availability-1` — Error Boundary | **IMPLEMENTADO.** `app/error.tsx` (rota, com `reset()` e saída para `/`), `components/ErrorBoundary.tsx` em volta da `AppNavigation` (degrada para moldura sem navegação) e `app/global-error.tsx` (falha do layout raiz, sem nenhum import do design system). 16 testes; os quatro arquivos a 100%. | `app/error.tsx`, `app/global-error.tsx`, `components/ErrorBoundary.tsx`, `components/AppShell.tsx` |
| `security-1` — sanitizar `returnTo` | **IMPLEMENTADO.** `safeReturnTo` recusa `//host`, `/\host`, controle no meio da string e `://`. O login é o consumidor único do valor, e os dois `router.replace(returnTo)` passam pelo helper. 25 testes. | `lib/auth/safe-return-to.ts`, `app/login/page.tsx:26` |
| `testability-1` — reassentar `coverageThreshold` | **PARCIAL.** O card lia o piso como `20/9/14`; o lado backend do merge já o tinha subido para **33/23/28** (card `testability-4` daquele run). O real medido na árvore mesclada, com os testes novos, é **38,88 / 29,52 / 34,25** — resta um ajuste de ~5pp, não os 18pp que o card descrevia. | `src/frontend/jest.config.js` |
| `deployability-3` — runbook de rollback da Vercel | **JÁ FECHADO** pelo outro lado do merge. O `grep rollback → 0 hits` que sustentava o card era verdadeiro nesta branch e falso na outra: `docs/runbooks/rollback.md` §2 é "Reverter o frontend (Vercel), se necessário". | `docs/runbooks/rollback.md` |

**Segue aberto e vale a próxima janela:** `deployability-1` — o job `frontend` do
`.github/workflows/ci.yml` roda `typecheck`, `lint` e `test`, e **não** roda `build`. O job do
backend roda. Três linhas de YAML, e o `next build` cobre a fronteira server/client que o
`tsc --noEmit` não cobre. Verificado de novo em 2026-09-08: o gap continua no YAML.

---

## Como ler esta lista

Duas colunas de julgamento que o Yuri vai querer separar:

- **Herdado** — o problema já existia; a moldura apenas o torna mais caro ou mais visível.
- **Introduzido** — o delta criou ou agravou. São os que pesam na decisão de merge.

---

## P1 — topo da fila

### [security-1] Sanitizar `returnTo` antes do `router.replace` · **S** · herdado
`src/frontend/app/login/page.tsx:23,32,42`. `returnTo = searchParams.get('returnTo') || '/'`
vai direto para `router.replace(returnTo)`. O `router.replace` do `next/navigation` aceita URL
absoluta e protocol-relative → **open redirect**, vetor de phishing plausível numa plataforma cujos
admins assinam remessa SISPAG e finalizam lote.

Fix: helper `safeReturnTo` exigindo `^/(?!/)` e proibindo `://` e `\\`. **≤ 5 linhas.**

> Inteiramente herdado — este delta **não toca** `login/page.tsx`. (Uma edição minha nesse arquivo
> foi revertida; ver `docs/regis-review/2026-09-03-1913-moldura-navegacao/ERRATA.md`.) O pipeline
> manda P1 para o inbox, mas dado o custo e o alvo, vale decidir explicitamente se entra numa PR
> própria em vez de esperar a fila.

### [fault-tolerance-1 / availability-1] Error Boundary na moldura · **S** · **INTRODUZIDO**
`grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" src/frontend/` → **0**.
`find src/frontend -name "error.tsx"` → **0**.

Antes do delta o `AppShell` tinha 47 linhas e nenhuma lógica. Agora a moldura é código com estado,
`localStorage` e fetch, montado em **toda** rota autenticada: um throw nela derruba 100% das telas.
O blast radius saiu de ~0% para 100%. É o agravamento mais real que este delta produz.

Fix: `app/error.tsx` (App Router) + boundary em torno de `AppNavigation`, degradando para a moldura
sem navegação em vez de tela branca.

### [deployability-1] `npm run build` no job `frontend` do CI · **S** · ⚠️ severidade rebaixada
`.github/workflows/ci.yml:30-46` roda `typecheck`, `lint`, `test`. **Não roda `build`.** O job do
backend roda. O gap é real e verificável no YAML.

> **Correção de evidência.** Este card nasceu P1 apoiado numa afirmação minha que era **falsa** —
> que a `main` estava com o `next build` quebrado e nenhum gate acusava. Verificado depois: com os
> arquivos no estado de `origin/main`, `npm run build` termina em **exit 0**. Os erros que eu vi
> vinham de um artefato meu no worktree (`node_modules.symlink/` dentro de `src/frontend/`, que o
> TypeScript passou a tratar como código de primeira parte). Ver
> `docs/regis-review/2026-09-03-1913-moldura-navegacao/ERRATA.md`.
>
> Sem incidente observado, a regra 7 do `qa-section.md` (P0/P1 exigem baseline numérico) rebaixa
> este card para **P2**: é um gate ausente, não um gate que falhou.

Ainda assim vale fazer — é ~3 linhas de YAML, e o `next build` cobre a fronteira server/client que
`tsc --noEmit` não cobre.

### [testability-1] Reassentar o `coverageThreshold` · **S**
`src/frontend/jest.config.js`: floors em `lines 20 / branches 9 / functions 14`. Real pós-delta:
**38,19 / 28,73 / 33,33**. Um piso 18pp abaixo do real não trava regressão nenhuma. Alvo sugerido
pelo agente: 36 / 26 / 31 (2pp abaixo do real). **3 linhas de config.**

### Demais P1
Ver `KANBAN.md` do run. Os quatro acima são os que os agentes cruzaram entre si.

---

## CC-1 — o item de maior alavancagem (cross-cutting)

O consolidator identificou que **`fetchPermissoes` é tocado por 9 cards diferentes**
(`availability-2`, `fault-tolerance-2/3/4`, `performance-3`, `integrability-1/3/4`,
`modifiability-3`). Consolidar a consulta de permissão num único hook em `lib/permissoes.ts` —
com timeout/`AbortController`, validação Zod do shape, `console.warn` no `catch` e dedup entre
`app-nav.tsx` e `OperacaoHomeCard.tsx` — **fecha os nove de uma vez**, em ~2–3 dias.

Se houver orçamento para uma coisa só depois dos P1, é esta.

---

## P2 — débito defensável

| Card | Assunto | Arquivo |
|---|---|---|
| `integrability-1` | Validar o shape de `/me/permissoes` com Zod no boundary (hoje é cast `as Permissoes`) | `lib/operacao.ts:102` |
| `integrability-2` | Extrair `lib/routes.ts` — hoje `/permutas` tem 5 fontes de verdade (folder + modelo de nav + 3 links) | vários |
| `security-2` | JWT em `localStorage`; a moldura em toda rota amplia a superfície de exfiltração por XSS | `lib/auth/token.ts:20` |
| `security-3` | Nenhum evento de auth (`login-success/failure`, `sign-out`, `session-expired`) chega a trilha de auditoria | — |
| `availability-2` / `performance-3` / `fault-tolerance-2` | `fetchPermissoes` sem timeout nem `AbortController` — promessa pendurada esconde Operação a sessão inteira | `components/nav/app-nav.tsx:127-141` |
| `performance-1` | CLS de hidratação da sidebar: SSR renderiza expandida, `localStorage` colapsa depois (224px → 64px) para quem prefere colapsada. Cookie ou `useSyncExternalStore` resolvem | `components/ui/sidebar.tsx:136-143` |
| `performance-2` | Budget de bundle no CI — não foi possível medir o First Load JS por rota (Turbopack aborta com `node_modules` symlinkado no worktree) | — |
| ~~`deployability-2`~~ | **Descartar.** Helper `useSafePathname()` — a premissa era `usePathname()` ser nullável, e não é (`navigation.d.ts:42` declara `: string`). Ver ERRATA | — |
| `deployability-3` | Runbook de rollback da Vercel (`grep rollback` → 0 hits) | `DEPLOY.md` |
| `modifiability-1` | Botões "Voltar ao painel" ficaram redundantes com a sidebar — 3 pontos de código para o mesmo alvo | `app/permutas/BorderosPanel.tsx:301`, `app/permutas/clientes-filtro/page.tsx:180` |
| `testability-2` | `jest-axe` — numa moldura presente em toda rota, a11y hoje é asserção manual por landmark | — |
| `testability-3` | Mocks literais de `@/lib/operacao` sem `satisfies Permissoes`; mudança de contrato passa verde | 3 arquivos de teste |
| `testability-4` | 0 E2E automatizado (`docs/e2e/` é markdown manual); o custo do gap cresceu com a moldura | — |

---

## P3 — melhoria opcional

`integrability-3` (extrair `usePermissaoOperacao` — hoje duplicado em `app-nav.tsx:121` e
`OperacaoHomeCard.tsx:29`, 2 requests na home) · `integrability-4` e `fault-tolerance-3`
(`console.warn` estruturado no `catch` — o fail-closed é deliberado, mas o silêncio total até para
o dev é acidental) · `availability-3` (consumir `loading` do `useIsAuthenticated` no `AppShell`
para eliminar o flash sem nav) · `fault-tolerance-4` (`useEffect` com deps `[]` roda 1× por sessão:
permissão negada no boot fica negada até F5) · `modifiability-2` (`HEADER_HEIGHT`/`HEADER_OFFSET`
são duas strings que mudam juntas por convenção, não por construção) · `modifiability-3` (data de
expiração para a prop `badge` sem consumidor, para não virar código acidentalmente morto) ·
`performance-4` (Sidebar e BottomNav ambos no DOM, ~45 nós — trade-off consciente contra o
mismatch de hidratação) · `deployability-4` (smoke-test pós-deploy) · `deployability-5`
(kill-switch `NEXT_PUBLIC_NEW_NAV_ENABLED`; o backend já domina o padrão no `render.yaml`) ·
`testability-5` (branches de `bottom-nav` 59,6% e `app-nav` 50%; `fast-check` em
`resolveActiveItemId`).

---

## Do DesignSystemReviewer (gate separado, obrigatório por tocar `src/frontend/`)

**Veredito: APROVADO. 0 P0, 1 P1 — já remediado nesta rodada.**

- **P1 (corrigido):** `AppShell.tsx` usava `focus:z-100` cru no skip link. A escala de z-index de
  `docs/design-system/tokens.md` foi materializada em `app/globals.css` e o skip link passou a usar
  `focus:z-[var(--z-max)]`. Justificativa do `--z-max` (que a spec exige no PR): o skip link precisa
  ficar acima de tudo, inclusive do header sticky e de um backdrop de modal.
- **P3 (aberto):** tipografia em valores arbitrários (`text-[10px]` … `text-[13px]`) em
  `nav-item.tsx`, `sidebar.tsx` e `bottom-nav.tsx`. É a densidade de ferramenta de operação, e o
  desvio está documentado — mas quando a escala de tokens for revisada, cabe criar tokens compactos
  formais em vez de arbitrary values.
- **P3 (aberto):** `h-[calc(100dvh-3.5rem)]` em `AppShell.tsx` merece virar token
  (`--app-shell-sidebar-height`) junto com `HEADER_HEIGHT`/`HEADER_OFFSET` (ver `modifiability-2`).

---

## Desvios de spec deste delta (decididos, não achados)

Registrados com motivo em `ontology/ui-flows/navegacao-global.md` §"Desvios deliberados". Os
agentes de Integrability e Modifiability avaliaram e consideraram as justificativas sustentáveis.
O único com dívida funcional pendente é o sub-item com a sidebar colapsada, que não abre popover
lateral — o pai continua navegável e ativo, e os filhos aparecem ao expandir.
