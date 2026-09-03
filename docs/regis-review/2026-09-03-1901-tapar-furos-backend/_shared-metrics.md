# Métricas compartilhadas — run 2026-09-03-1901-tapar-furos-backend

**Escopo:** `backend`, **restrito ao delta** do tweak `fix/tapar-furos-backend` (commit `e575221`).
**Flags:** `--quick`.
**Worktree:** `/home/inteli/kavex-worktrees/tapar-furos-backend`

> Este NÃO é um review do repositório inteiro. É o gate pós-implementação de um tweak de 5 arquivos.
> Findings devem se ater ao delta; contexto de repo entra só como pano de fundo para julgar o delta.

## Delta sob review

| Arquivo | Natureza |
|---|---|
| `src/backend/domain/client/database/PostgreeDatabaseClient.ts` | modificado — handler de `error` do pool agora chama `end()`; novo `public close()` |
| `src/backend/domain/client/database/PostgreeDatabaseClient.test.ts` | modificado — mock de `pg` passa a capturar listeners; +7 testes |
| `src/backend/http/gracefulShutdown.ts` | **NOVO** — handler SIGTERM/SIGINT (drain → closePool → exit 0) |
| `src/backend/http/gracefulShutdown.test.ts` | **NOVO** — 8 testes |
| `src/backend/index.ts` | modificado — captura o retorno de `app.listen`, registra o shutdown |
| `src/backend/package.json` | modificado — scripts `lint`/`lint:fix`/`build` deixam de usar `npx` |

## Os três achados corrigidos

- **BE-05 (Crítico):** o handler de `error` do pool zerava a referência sem `pool.end()`. O pool
  quebrado ia para o GC ainda segurando até `poolMaxConnections = 5` sessões no Supabase, e a
  `init()` seguinte abria mais 5. Agravante: `'too many clients'` e `'MaxClientsInSessionMode'`
  estão na lista `transientErrorPatterns` do próprio cliente — o handler que existia para recuperar
  do esgotamento de conexões era o que o acelerava.
- **BE-06 (Importante):** nenhum handler de SIGTERM/SIGINT. Todo deploy no Render manda SIGTERM;
  requisição em voo interrompida entre `createRun` e `finishRun` deixa execução órfã em
  `reconciling` — o mesmo estado que `.github/workflows/reaper-sispag.yml` varre a cada 15 min.
- **BE-09 (Importante):** `npm run lint` era `npx biome check .` e saía **0 em silêncio** sem
  `node_modules`; o gate reportava verde sem examinar uma linha. Morde em todo worktree novo, que é
  o fluxo obrigatório do pipe (Inviolable Rule #10).

## Baseline do repositório (contexto)

| Métrica | Valor | Fonte |
|---|---|---|
| LOC backend (sem testes) | 51.999 | `find src/backend -name '*.ts' -not -name '*.test.ts' \| xargs wc -l` |
| Arquivos de teste backend | 138 | `find src/backend -name '*.test.ts' \| wc -l` |
| Arquivos de teste frontend | 26 | idem em `src/frontend` |
| LOC `domain/service` | 15.603 | `wc -l` por camada |
| LOC `domain/repository` | 5.722 | idem |
| LOC `domain/client` | 7.382 | idem |
| LOC `domain/libs` | 1.527 | idem |
| LOC `http` | 925 | idem |
| LOC `routes` | 2.757 | idem |
| LOC `jobs` | 10.188 | idem |
| Deps backend | 16 prod / 14 dev | `src/backend/package.json` |
| Deps frontend | 23 prod / 17 dev | `src/frontend/package.json` |
| Módulos Terraform | ⚠️ **Não medível**: `infra/` não existe neste repo (deploy via Render hook). Ver CLAUDE.md §"Estado Atual vs. Alvo". |
| Tenants provisionados | ⚠️ **Não medível**: mesma razão. |

## Gates executados neste run (valores reais)

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `cd src/backend && npm run typecheck` | ✅ exit 0 |
| Lint | `cd src/backend && npm run lint` | ✅ exit 0 — `Checked 449 files`, 66 warnings (mesmo total do baseline pré-delta com 447 arquivos: o delta não introduziu warning) |
| Testes | `cd src/backend && npm test -- --coverage` | ✅ exit 0 — **124 suítes, 1745 testes, 0 falhas** |
| Cobertura global | idem | 90,39% stmts / 71,54% branches / 89,63% funcs / 91,43% lines — thresholds do `jest.config.cjs` (global 72/54/78) satisfeitos |
| Cobertura `domain/service` | idem | 91,17% stmts / 64,28% branches — threshold (88/60) satisfeito |
| Cobertura `http/gracefulShutdown.ts` | idem | 93,61% stmts / 58,82% branches / 90% funcs / 100% lines |
| PatternGuardian | agent | ✅ 6 arquivos, **0 violações** |

## Validação empírica do BE-09 (reprodução controlada)

Reproduzido com o `package.json` **real** copiado para um diretório sem `node_modules`:

| Versão | Script | Exit | Saída |
|---|---|---|---|
| ANTES (`HEAD~1`) | `npx biome check .` | **0** | *(nenhuma)* — falso verde |
| DEPOIS | `biome check .` | **127** | `sh: 1: biome: not found` |

Com `node_modules` presente, `npm run lint` segue exit 0 e imprime `Checked 449 files`.

## Notas para os agents

- `--quick`: não rodar `terraform plan` (não há infra), nem `npm audit` profundo.
- Camada Lambda (`src/backend/lambda/`) **não existe** — o runtime é Express. Tactics que dependam
  de Lambda/EventBridge/SQS são `N/A` com justificativa, não findings.
- O jobs runner é GitHub Actions cron (`.github/workflows/`), não EventBridge.
