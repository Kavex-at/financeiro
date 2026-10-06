# Shared metrics — feature sispag-verificacoes-ted-pix (--quick, delta vs origin/main)

Repo layout: src/backend, src/frontend. No infra/ (Terraform not measurable).

## Delta (git diff --stat origin/main...HEAD)
```
 137 files changed, 14901 insertions(+), 276 deletions(-)
  .github/workflows/calcular-perfil-canal.yml
  src/backend/domain/client/ConexosPagamentosRealizadosClient.test.ts
  src/backend/domain/client/ConexosPagamentosRealizadosClient.ts
  src/backend/domain/client/ConexosSispagClient.test.ts
  src/backend/domain/client/ConexosSispagClient.ts
  src/backend/domain/errors/ConferenceRequiredError.ts
  src/backend/domain/errors/DuplicateHoldError.ts
  src/backend/domain/errors/DuplicateResolutionError.ts
  src/backend/domain/errors/ItemsRemovedByCheckError.ts
  src/backend/domain/errors/PaymentCheckPendingError.ts
  src/backend/domain/errors/PendingDuplicateAlertError.ts
  src/backend/domain/errors/ReturnReasonRequiredError.ts
  src/backend/domain/errors/SelfConferenceError.ts
  src/backend/domain/interface/auth/Permission.ts
  src/backend/domain/interface/operacao/JobRun.ts
  src/backend/domain/interface/operacao/stalenessLimits.ts
  src/backend/domain/interface/sispag/SispagInterface.ts
  src/backend/domain/libs/environment/EnvironmentProvider.test.ts
  src/backend/domain/libs/environment/EnvironmentProvider.ts
  src/backend/domain/libs/environment/model/EnvironmentVars.ts
  src/backend/domain/libs/sispag/ConferenciaLoteRule.test.ts
  src/backend/domain/libs/sispag/ConferenciaLoteRule.ts
  src/backend/domain/repository/sispag/AlertaItemLoteRepository.test.ts
  src/backend/domain/repository/sispag/AlertaItemLoteRepository.ts
  src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.test.ts
  src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.ts
  src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts
  src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  src/backend/domain/repository/sispag/PendenciaCadastroRepository.test.ts
  src/backend/domain/repository/sispag/PendenciaCadastroRepository.ts
  src/backend/domain/repository/sispag/PerfilCanalFornecedorRepository.test.ts
  src/backend/domain/repository/sispag/PerfilCanalFornecedorRepository.ts
  src/backend/domain/repository/sispag/TituloAPagarRepository.test.ts
  src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  src/backend/domain/repository/sispag/VerificacaoEventoRepository.test.ts
  src/backend/domain/repository/sispag/VerificacaoEventoRepository.ts
  src/backend/domain/repository/sispag/VerificacaoTedPix.integration.test.ts
  src/backend/domain/service/auth/EffectivePermissionCalculator.test.ts
  src/backend/domain/service/operacao/JobRunReadModel.test.ts
  src/backend/domain/service/operacao/JobRunReadModel.ts
  src/backend/domain/service/sispag/ChannelProfileCalculator.test.ts
  src/backend/domain/service/sispag/ChannelProfileCalculator.ts
  src/backend/domain/service/sispag/ConferenciaLoteService.test.ts
  src/backend/domain/service/sispag/ConferenciaLoteService.ts
  src/backend/domain/service/sispag/DuplicateDetector.test.ts
  src/backend/domain/service/sispag/DuplicateDetector.ts
  src/backend/domain/service/sispag/DuplicateResolutionService.test.ts
  src/backend/domain/service/sispag/DuplicateResolutionService.ts
  src/backend/domain/service/sispag/IngestaoPagamentosService.test.ts
  src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  src/backend/domain/service/sispag/LotePagamentoApiView.ts
  src/backend/domain/service/sispag/LotePagamentoService.test.ts
  src/backend/domain/service/sispag/LotePagamentoService.ts
  src/backend/domain/service/sispag/PendenciaCadastroService.test.ts
  src/backend/domain/service/sispag/PendenciaCadastroService.ts
  src/backend/domain/service/sispag/PerfilCanalService.test.ts
  src/backend/domain/service/sispag/PerfilCanalService.ts
  src/backend/domain/service/sispag/RemessaService.test.ts
  src/backend/domain/service/sispag/RemessaService.ts
  src/backend/domain/service/sispag/SispagPainelService.test.ts
  src/backend/domain/service/sispag/SispagPainelService.ts
  src/backend/domain/service/sispag/VerificacaoTedPixService.test.ts
  src/backend/domain/service/sispag/VerificacaoTedPixService.ts
  src/backend/domain/service/sispag/__fixtures__/fin064-fil4-6173-6702.json
  src/backend/http/routePermissions.test.ts
  src/backend/jobs/CalcularPerfilCanalJob.ts
  src/backend/jobs/calcular-perfil-canal.test.ts
  src/backend/jobs/calcular-perfil-canal.ts
  src/backend/jobs/probe-canal-por-fornecedor.ts
  src/backend/jobs/probe-duplicidade-titulos.ts
  src/backend/jobs/probe-titulo-detalhe.ts
  src/backend/jobs/validate-sispag-verificacoes-ted-pix-v1.ts
  src/backend/migrations/0068_sispag_aprovar_destino.test.ts
  src/backend/migrations/0069_sispag_item_situacao_sincronizacao.integration.test.ts
  src/backend/migrations/0075_sispag_excecao_destino.test.ts
  src/backend/migrations/0076_sispag_alerta_item_lote.sql
  src/backend/migrations/0076_sispag_alerta_item_lote.test.ts
  src/backend/migrations/0077_sispag_bloqueio_pendencia.sql
  src/backend/migrations/0077_sispag_bloqueio_pendencia.test.ts
  src/backend/migrations/0078_sispag_perfil_canal_conferencia.integration.test.ts
  src/backend/migrations/0078_sispag_perfil_canal_conferencia.sql
  src/backend/migrations/0078_sispag_perfil_canal_conferencia.test.ts
  src/backend/migrations/0079_permissoes_sispag_conferir_cadastro.sql
  src/backend/migrations/0079_permissoes_sispag_conferir_cadastro.test.ts
  src/backend/package.json
  src/backend/routes/sispag.test.ts
  src/backend/routes/sispag.ts
  src/backend/routes/sispag.verificacao.test.ts
  src/frontend/__tests__/permissoes-api.test.ts
  src/frontend/app/sispag/components/ConferenciaLoteDialog.test.tsx
  src/frontend/app/sispag/components/ConferenciaLoteDialog.tsx
  src/frontend/app/sispag/components/LoteCard.test.tsx
  src/frontend/app/sispag/components/LoteCard.tsx
  src/frontend/app/sispag/components/LoteCard.verificacao.test.tsx
  src/frontend/app/sispag/components/ResolverDuplicidadeDialog.test.tsx
  src/frontend/app/sispag/components/ResolverDuplicidadeDialog.tsx
  src/frontend/app/sispag/pendencias-cadastro/page.test.tsx
  src/frontend/app/sispag/pendencias-cadastro/page.tsx
  src/frontend/components/nav/app-nav.test.tsx
  src/frontend/components/nav/app-nav.tsx
  src/frontend/lib/auth/AuthProvider.tsx
  src/frontend/lib/permissoes.test.ts
  src/frontend/lib/permissoes.ts
  src/frontend/lib/sispag.ts
  src/frontend/lib/sispag.verificacao.test.ts
```

## Backend LOC by layer (non-test .ts)
```
domain/service: 24402
domain/repository: 9930
domain/client: 8956
domain/libs: 2804
routes: 4271
jobs: 15579
migrations: 479
```
Backend test files: 248
Frontend LOC (non-test ts/tsx): 30330
Frontend test files: 83
Terraform modules: ⚠️ Não medível (sem infra/)
Tenants: ⚠️ Não medível (sem infra/)

## Deps
src/backend/package.json 16 deps, 14 devDeps
src/frontend/package.json 24 deps, 17 devDeps

## Gates (measured 2026-10-06 by orchestrator)
- Backend npm test (jest): 223 suites, 4006 tests passed
- Frontend npm test: 83 suites, 837 tests passed
- Backend npm run test:sql (local test container): 11 suites, 101 tests passed (AutoLoopRunner report)

## Backend lint (tail)
```
  
  i Please refactor this function to reduce its complexity score from 28 to the max allowed complexity 15.
  

The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 66.
Checked 718 files in 1152ms. No fixes applied.
Found 86 warnings.
```
## Backend typecheck (tail)
```
exit=0
```
