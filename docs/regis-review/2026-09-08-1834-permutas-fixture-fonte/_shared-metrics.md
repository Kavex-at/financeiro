# Shared metrics — run 2026-09-08-1834 (delta `permutas-fixture-fonte`)

Coletado uma vez pelo orquestrador do `/regis-review`. **Leia este arquivo antes de coletar
qualquer métrica própria** — não repita o que já está aqui.

## Escopo desta run

**Review de DELTA, não do repositório inteiro.** Invocado ao final do fix
`permutas-fixture-fonte`, conforme o gate pós-implementação do CLAUDE.md.

- Worktree: `.claude/worktrees/permutas-fixture-fonte`
- Branch: `worktree-permutas-fixture-fonte`
- Base: `origin/main` @ `dc994c8`
- Commit do delta: `27023a9`
- Comando do delta: `git diff origin/main...HEAD`

### O delta (10 arquivos, +558 / −19)

| Arquivo | Δ | Natureza |
|---|---|---|
| `src/frontend/lib/api.ts` | +48 / −13 | os três caminhos de `fetchGestaoPermutas` |
| `src/frontend/lib/features.ts` | +36 | `isDemoMode()` + `assertDemoEnv()` |
| `src/frontend/app/permutas/components/banners.tsx` | novo, 80 linhas | `DemoDataBanner` + `LoadErrorBanner` |
| `src/frontend/app/permutas/components/usePermutasData.ts` | +39 / −6 | estado `error` |
| `src/frontend/app/permutas/page.tsx` | +28 / −1 | composição dos estados |
| `src/frontend/.env.example` | +9 | documenta `NEXT_PUBLIC_DEMO_MODE` |
| `src/frontend/__tests__/permutas-fonte-dado.test.ts` | novo | 7 casos |
| `src/frontend/__tests__/features-demo-mode.test.ts` | novo | 6 casos |
| `src/frontend/app/permutas/components/banners.test.tsx` | novo | 7 casos |
| `ontology/ui-flows/fonte-do-dado-permutas.md` | novo | invariante do fluxo |

**O delta é 100% `src/frontend/` + 1 doc de ontologia.** Nenhuma linha de `src/backend/`,
nenhuma migration, nenhum job, nenhuma rota. Agentes de QA cujo objeto é majoritariamente
backend/infra devem dizer isso explicitamente e avaliar o delta pelo que ele de fato toca,
em vez de reprovar por ausência de algo que o delta não tinha como introduzir.

## Baseline do repositório

| Métrica | Valor | Fonte |
|---|---|---|
| Backend — arquivos `.ts` fora de teste | 285 | `find src/backend -name '*.ts' -not -name '*.test.ts' \| wc -l` |
| Backend — arquivos de teste | 137 | `find src/backend -name '*.test.ts' \| wc -l` |
| Frontend — arquivos `.ts`/`.tsx` fora de teste | 107 | `find src/frontend -name '*.ts' -o -name '*.tsx'` (sem `node_modules`, sem `.test.`) |
| Frontend — arquivos de teste | 29 | idem, só `.test.ts`/`.test.tsx` |
| Módulos Terraform | ⚠️ **não medível** | `infra/` **não existe** neste repo |
| Tenants provisionados | ⚠️ **não medível** | idem |

> **`infra/` não existe.** O CLAUDE.md marca toda a camada Terraform/SSM/Lambda como **(alvo)**,
> não como estado atual: o backend roda Express no Render, o frontend na Vercel, auth/DB no
> Supabase. Qualquer métrica de Terraform, tenant, IAM, X-Ray, CloudWatch ou EventBridge é
> **não medível neste repositório** e deve ser declarada como tal — não como finding.

## Gates já executados neste delta (não re-executar)

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `cd src/frontend && npx tsc --noEmit` | exit 0 |
| Lint | `cd src/frontend && npx eslint .` | exit 0 — 0 erros, 17 warnings, **nenhum** em arquivo do delta |
| Testes | `cd src/frontend && npx jest` | **29 suítes / 214 testes**, todas passando |
| Baseline pré-delta | idem, em `origin/main` | 26 suítes / 194 testes → o delta adicionou **+3 suítes / +20 testes** |
| Cobertura | `npx jest --coverage` | floors do `jest.config.js` (lines 20 / branches 9 / functions 14) mantidos |
| Build | `cd src/frontend && npx next build` | exit 0, 12 rotas prerenderizadas |
| DesignSystemReviewer | gate obrigatório de `src/frontend/` | **0 P0, 0 P1**, 1 P2 (ícone do `EmptyState`) — **já aplicado** no commit |

## Contexto do defeito corrigido (para calibrar severidade)

Achado **1.1** de `ontology/_inbox/backlog-melhorias-2026-09-02.md`, classificado **P0 · confiança**.

`fetchGestaoPermutas` devolvia `gestaoPermutasFixture` em dois caminhos sem sinalizar:
backend em falha, e carteira legitimamente vazia. O segundo era o caminho quente. O fixture
tem 227 linhas de dados reais sondados (exportadores nominais, valores em USD). O tipo já
tinha `fonte: 'banco' | 'fixture'` e nenhuma tela lia o campo.

Consequência lateral encontrada durante o fix e também corrigida: o `catch` engolia a
`SessionExpiredError` do `apiFetch`, então sessão expirada virava fixture em vez de abrir o
`SessionExpiredModal`.

## Comandos úteis

```bash
git diff origin/main...HEAD                 # o delta inteiro
git show 27023a9                            # idem, com a mensagem de commit
cd src/frontend && npx jest --coverage      # cobertura
```
