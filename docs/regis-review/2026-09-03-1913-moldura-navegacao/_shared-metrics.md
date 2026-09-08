# Métricas compartilhadas — run 2026-09-03-1913-moldura-navegacao

> Escopo: **frontend only**, restrito ao delta da feature `moldura-navegacao` (branch `feat/moldura-navegacao`, commit 05606a6).
> Worktree: `/home/inteli/kavex-worktrees/moldura-navegacao`. `--quick` ativo.
> Backend e infra **fora de escopo** — o delta não os toca. Não existe `infra/` neste repo (ver CLAUDE.md).

## Delta (git)
```
05606a6 feat(plataforma): a moldura de navegação que o design system já especificava
 ontology/_inbox/moldura-navegacao-tasks.md     | 235 +++++++++++++++
 ontology/ui-flows/navegacao-global.md          |  77 +++++
 src/frontend/__tests__/AppShell.test.tsx       | 125 ++++++++
 src/frontend/app/login/page.tsx                |   4 +-
 src/frontend/components/AppShell.tsx           | 304 +++++++++++++++++--
 src/frontend/components/auth/RouteGate.tsx     |   4 +-
 src/frontend/components/nav/app-nav.test.tsx   | 141 +++++++++
 src/frontend/components/nav/app-nav.tsx        | 155 ++++++++++
 src/frontend/components/ui/bottom-nav.test.tsx | 115 ++++++++
 src/frontend/components/ui/bottom-nav.tsx      | 180 +++++++++++
 src/frontend/components/ui/nav-item.tsx        | 241 +++++++++++++++
 src/frontend/components/ui/sidebar.test.tsx    | 193 ++++++++++++
 src/frontend/components/ui/sidebar.tsx         | 393 +++++++++++++++++++++++++
 13 files changed, 2138 insertions(+), 29 deletions(-)
```

## LOC do delta (fonte, sem teste)
```
  297 src/frontend/components/AppShell.tsx
  155 src/frontend/components/nav/app-nav.tsx
  393 src/frontend/components/ui/sidebar.tsx
  241 src/frontend/components/ui/nav-item.tsx
  180 src/frontend/components/ui/bottom-nav.tsx
 1266 total
```

## LOC dos testes do delta
```
  125 src/frontend/__tests__/AppShell.test.tsx
  141 src/frontend/components/nav/app-nav.test.tsx
  193 src/frontend/components/ui/sidebar.test.tsx
  115 src/frontend/components/ui/bottom-nav.test.tsx
  574 total
```

## Frontend — totais
- Arquivos fonte (ts/tsx, sem teste): 102
- Arquivos de teste: 30
- LOC fonte total:  19690 total
- deps: 23 dependencies, 17 devDependencies

## Infra / backend
- `infra/`: ⚠️ **Não medível** — não existe neste repositório (deploy via Render hook; ver CLAUDE.md §Estado Atual vs. Alvo). Terraform/tenants não aplicável.
- Backend: fora de escopo neste run (delta não toca `src/backend/`).

## Gates medidos (2026-09-03, worktree)

| Gate | Comando | Resultado |
|---|---|---|
| typecheck | `npm run typecheck` | ✅ exit 0, sem erro |
| lint | `npm run lint` | ✅ exit 0 — 18 warnings, 0 errors (13 arquivos; 12 pré-existentes + `sidebar.tsx:142`, todos da regra `react-hooks/set-state-in-effect`) |
| test | `npm test` | ✅ 30 suítes, 233 testes, 0 falhas |
| build | `npm run build` | ✅ compila e prerenderiza 12 rotas (só passou após 2 fixes de null-safety pré-existentes) |

## Cobertura (jest --coverage, frontend)
```
Antes do delta (baseline documentado em jest.config.js): ~20.7% lines / 9.59% branches / 14.85% functions
Depois do delta:                                          38.19% lines / 28.73% branches / 33.33% functions

Arquivos do delta:
  components/AppShell.tsx      97.87% lines | 81.25% branches | 100% functions
  components/nav/app-nav.tsx   100%   lines | 50%    branches | 100% functions
  components/ui/sidebar.tsx    94.64% lines | 83.33% branches | 96.42% functions
  components/ui/nav-item.tsx   90.62% lines | 80.24% branches | 100% functions
  components/ui/bottom-nav.tsx 80.95% lines | 59.61% branches | 50% functions
```

coverageThreshold do `jest.config.js`: global lines 20 / branches 9 / functions 14 — **satisfeito com folga**.

## Rotas prerenderizadas (next build)
```
/ /_not-found /docs/arquitetura /login /operacao /permutas /permutas/borderos
/permutas/clientes-filtro /recebimentos /sispag /usuarios   (todas ○ Static)
```
