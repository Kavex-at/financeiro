# Shared metrics — Regis-Review `--quick` (delta)

- **Run:** 2026-10-08-1958-sispag-titulos · **Branch:** `fix/sispag-titulos-filtro-export` · **Commit:** `e832057`
- **Escopo:** SOMENTE o delta do commit (gate pós-impl de `/feature-tweak`). Achados fora do delta são pré-existentes e não entram como P0.

## Delta (18 arquivos, +768 / −30)

| Arquivo | Δ |
|---|---|
| src/backend/domain/service/sispag/TitulosAPagarExportService.ts (novo) | +145 |
| src/backend/domain/service/sispag/TitulosAPagarExportService.test.ts (novo) | +151 |
| src/backend/domain/libs/xlsx/PlanilhaXlsxWriter.ts (novo, extraído do RemessaTitulosExportService) | +29 |
| src/backend/domain/interface/sispag/TitulosAPagarExport.ts (novo) | +8 |
| src/backend/domain/service/sispag/RemessaTitulosExportService.ts | +4 / −21 |
| src/backend/routes/sispag.ts (rota `POST /sispag/titulos/exportar`) | +43 |
| src/backend/routes/sispag.test.ts / http/routePermissions.test.ts | +63 / +3 |
| src/frontend/app/sispag/page.tsx (aba Títulos: filtro de comprometidos, motivo do selecionar-todos, botão export) | +46 / −4 |
| src/frontend/app/sispag/components/ExportarTitulosAPagarBotao.tsx (+test) | +52 / +62 |
| src/frontend/app/sispag/components/filtrosAbas.ts (+test) | +10 / +17 |
| src/frontend/lib/sispag.ts (+test) | +19 / +24 |
| src/frontend/app/sispag/page.test.tsx | +69 |

## Baselines medidos (2026-10-08, no worktree)

| Métrica | Valor |
|---|---|
| Backend typecheck | ✅ 0 erros |
| Backend lint (`biome check .`) | ✅ 0 erros, 87 warnings (pré-existentes, nenhum no delta) |
| Backend testes | ✅ 225 suites / 4072 testes |
| Frontend typecheck | ✅ 0 erros |
| Frontend lint | ✅ 0 erros, 18 warnings (nenhum nos arquivos do delta) |
| Frontend testes | ✅ 90 suites / 908 testes |
| Gates anteriores | PatternGuardian PASS (0 P0) · DesignSystemReviewer PASS (0 P0) |

## Fatos de arquitetura relevantes ao delta

- Corpo JSON do Express: limite default **100 KB** (`express.json()` em `src/backend/http/buildApp.ts:56`). Teste em `routes/sispag.test.ts` prova que 5000 chaves compactas `fil:doc:tit` cabem (200).
- Teto do export = 5000 = `TITULOS_CAP` do painel (`SispagPainelService.ts`).
- Export é READ-ONLY e local: lê `titulo_a_pagar` (ativos, sem pagos) + lotes locais; **sem Conexos**. Permissão `SISPAG_VER`, `heavyRouteLimiter`.
- O export relê a carteira inteira (`listAtivos`, ~1.5 mil linhas hoje) e filtra em memória pelas chaves.

## Não medível

- Terraform/tenants: não existe `infra/` neste repo (CLAUDE.md).
- Cobertura / `npm audit` deep: pulados (`--quick`).
