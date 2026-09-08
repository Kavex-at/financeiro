# Regis-Review follow-ups — `permutas-fixture-fonte` (run 2026-09-08-1834)

> **Gate: PASSA.** Zero findings **P0** nas 8 QAs. Pelo CLAUDE.md (Inviolable Rule #11), só P0
> re-entra no loop do AutoLoopRunner; P1/P2/P3 viram follow-ups aqui e **não** foram implementados
> nesta fatia.
>
> Relatório completo: `docs/regis-review/2026-09-08-1834-permutas-fixture-fonte/REPORT.md`
> Cards na íntegra (27): `.../KANBAN.md`
> Delta revisado: commit `27023a9` (+ correção `5a20394`, posterior à run).

## Placar

| QA | Score | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Availability | 8,0 | 0 | 0 | 2 | 1 |
| Deployability | 7,5 | 0 | 1 | 2 | 0 |
| Integrability | 7,0 | 0 | 1 | 2 | 2 |
| Modifiability | 8,0 | 0 | 0 | 2 | 3 |
| Performance | 7,0 | 0 | 1 | 1 | 1 |
| Fault Tolerance | 8,0 | 0 | 0 | 3 | 1 |
| Security | 7,5 | 0 | 0 | 2 | 1 |
| Testability | 7,0 | 0 | 1 | 1 | 2 |
| **Overall** | **7,5** | **0** | **4** | **15** | **8** |

## Como ler esta lista

Três agentes chegaram sozinhos aos **mesmos** dois buracos pré-existentes. Convergência
independente é o sinal mais forte que uma run produz, e os cards foram deduplicados: um único
stroke fecha os três. Ler por RISCO, não por QA.

---

## R-1 — O guard do próprio fix está no lugar errado · **o único risco NOVO deste delta**

Cards `security-2` + `fault-tolerance-4` (ambos **P2**, ambos **S**).

`assertDemoEnv()` é chamado só de `lib/api.ts` (módulo). O irmão `assertAuthEnv()` é chamado do
root layout, via `AuthProvider` — ou seja, dispara em **toda** rota. Consequência: um build
mal-configurado (`NEXT_PUBLIC_DEMO_MODE=true`, `NEXT_PUBLIC_ENV=prd`) renderiza `/login` e a home
normalmente e só estoura quando o usuário abre uma rota que consome dados.

Pior: **nenhum teste amarra o callsite.** Remover a linha `assertDemoEnv()` de `api.ts` não quebra
nenhuma suíte, e reabre exatamente o modo de falha silencioso que esta fatia veio fechar.

**Correção:** chamar `assertDemoEnv()` também do root layout (junto do `assertAuthEnv()`), e um
teste que falhe se o callsite sumir. É o card mais barato e mais valioso da run — é o guard que
protege todo o resto.

---

## R-2 — `apiFetch` sem timeout · **o delta não criou, mas encareceu**

Cards `performance-1` (**P1**) ≡ `availability-1` (P2) ≡ `fault-tolerance-1` (P2) — **um único fix**
em `src/frontend/lib/http.ts`.

Baseline medido: **0 ocorrências de `AbortController` em todo o `src/frontend/`** (62/62 chamadas
sem `signal`).

A nuance honesta: antes desta fatia, um backend pendurado virava fixture em ~0ms — *dado errado,
rápido*. Agora a exceção sobe e `usePermutasData` fica em `loading=true` até o navegador desistir
(60–120s, ou nunca). E como o botão de retry usa `disabled={retrying}`, a analista fica **sem
saída** a não ser recarregar a aba. Trocamos "errado e rápido" por "sem dado, sem sinal, sem
saída". O saldo do fix continua positivo — mentir é pior —, mas este item deixou de ser teórico.

**Correção:** `AbortSignal.any([external, timeoutCtrl.signal])`, default 20–30s, e uma
`ApiTimeoutError` própria para o `LoadErrorBanner` dizer "o backend não respondeu em 30s".

---

## R-3 — Nomes reais de clientes viajam no bundle de produção

Cards `security-1` + `performance-2` (ambos **P2**) — o mesmo `dynamic import()` fecha os dois.

`lib/api.ts` importa `permutas-fixture.ts` **estaticamente**, então o fixture entra no bundle mesmo
com o modo demo desligado — e `assertDemoEnv()` garante que em produção ele **nunca** será usado.
É dead code que todo navegador baixa.

Medido no build deste worktree (`grep -rl` em `.next/static/chunks/`): **3 chunks** (37K + 26K +
28K ≈ 91 KB) contendo `DBP PIPING`, `QINGDAO COVENANT`, `CENTENO INTERNATIONAL` e `PANTECH` —
exportadores reais da Columbia, com valores em USD.

Pré-existente ao delta; **não** fechado por ele. Vale decidir também se o fixture deve ser
pseudonimizado na origem, independentemente do carregamento dinâmico.

---

## Demais P1

| Card | QA | Esforço | Em uma linha |
|---|---|---|---|
| `deployability-1` | Deployability | S | O job `frontend` do CI nunca roda `npm run build` (o `backend` roda, `ci.yml:28`); steps 43-46 são só ci/typecheck/lint/test. Uma regressão no `assertDemoEnv()` passa verde no PR e só quebra na Vercel. |
| `integrability-1` | Integrability | S | `fetchGestaoPermutas` faz `as Partial<GestaoPermutasResponse>` sem validar (`api.ts:92`); **0 arquivos FE usam Zod**. Backlog §3.4. |
| `testability-1` | Testability | S | `usePermutasData` ficou em **0% de cobertura** logo depois de virar o dono do novo estado `error` — é lá que `isSessionExpiredError` decide banner vs. modal. |

## P2 / P3

15 P2 e 8 P3 no `KANBAN.md`, já ordenados por prioridade e esforço. Os de maior alavancagem fora
dos riscos acima:

- `modifiability-1` (P2/S) — `LoadErrorBanner` promovido a `components/ui/`: `app/recebimentos/page.tsx:380-410` já implementa o mesmo shape inline.
- `modifiability-4` (P2/M) — `permutas/page.tsx` em **1065 LOC**; dívida pré-existente, o delta somou +27 líquidos.
- `testability-2` (P2) — a composição dos três estados em `page.tsx` (banner + banner + `EmptyState`) não tem teste de componente.
- `integrability-2/3` (P2) — contrato e agregação `totais` duplicados à mão entre BE e FE.
- **Corrigir o cabeçalho de `lib/recebimentos.ts:9-11`**, que ainda afirma que `fetchPainelRecebimentos()` cai num fixture. É falso desde uma fatia anterior — e essa afirmação já induziu a um diagnóstico errado *dentro desta própria fatia* (ver `5a20394` e [[fonte-do-dado-permutas]]).

## Sequência sugerida pelo consolidador

Semana 1: fechar R-1 (`security-2` + `fault-tolerance-4`). Semana 2: os quatro P1, todos S e todos
de arquivo único. 8 cards, ~12 dias.
