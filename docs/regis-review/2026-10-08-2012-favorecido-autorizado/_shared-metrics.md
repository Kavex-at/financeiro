# Shared metrics — 2026-10-08-2012-favorecido-autorizado (escopo: delta da feature sispag-favorecido-autorizado)

## Diff vs origin/main
 193 files changed, 10515 insertions(+), 11709 deletions(-)

## Backend LOC (sem testes)
  79383 total
## Backend test files
248
## Frontend LOC
  31314 total
## Frontend test files
86
## Gates
- backend: typecheck 0 errors; lint 0 errors; jest 223 suites / 3967 tests passed; test:sql (0080, AuthorizedPayeeRepository, VerificacaoTedPix) passed on local Postgres 17
- frontend: typecheck 0; lint 0 errors (21 warnings); jest 86 suites / 866 tests
## Terraform
⚠️ Não medível: não existe infra/ neste repo
## Arquivos tocados pela feature
src/backend/.env.example
src/backend/domain/errors/AuthorizedPayeeActiveExistsError.ts
src/backend/domain/errors/AuthorizedPayeeErrors.test.ts
src/backend/domain/errors/AuthorizedPayeeNotFoundError.ts
src/backend/domain/errors/AuthorizedPayeeStateError.ts
src/backend/domain/errors/AuthorizedPayeeVersionConflictError.ts
src/backend/domain/errors/BatchEmptiedByCheckError.ts
src/backend/domain/errors/ChavePixTitularNaoVerificavelError.ts
src/backend/domain/errors/ConferenceRequiredError.ts
src/backend/domain/errors/DestinoManualInvalidoError.ts
src/backend/domain/errors/DestinoTitularDivergenteError.ts
src/backend/domain/errors/ExcecaoAprovacaoProprioCadastranteError.ts
src/backend/domain/errors/ExcecaoDesabilitadaError.ts
src/backend/domain/errors/ExcecaoEstadoInvalidoError.ts
src/backend/domain/errors/ExcecaoMotivoObrigatorioError.ts
src/backend/domain/errors/ExcecaoNaoEncontradaError.ts
src/backend/domain/errors/ExcecaoSemPermissaoError.ts
src/backend/domain/errors/ExcecaoTitularidadeError.ts
src/backend/domain/errors/ItemsRemovedByCheckError.ts
src/backend/domain/errors/PayeeApprovalBySolicitorError.ts
src/backend/domain/errors/PayeeDecisionReasonRequiredError.ts
src/backend/domain/errors/PayeeDestinationChangedSinceShownError.ts
src/backend/domain/errors/PayeeNotAuthorizedAtRemittanceError.ts
src/backend/domain/errors/PayeeReapprovalNotConfirmedError.ts
src/backend/domain/errors/PayeeWithoutPaymentDataError.ts
src/backend/domain/errors/PaymentModalityUnavailableError.ts
src/backend/domain/errors/ReturnReasonRequiredError.ts
src/backend/domain/errors/SelfConferenceError.ts
src/backend/domain/interface/auth/Permission.ts
src/backend/domain/interface/operacao/Alerta.ts
src/backend/domain/interface/sispag/AuthorizedPayeeInterface.ts
src/backend/domain/interface/sispag/DestinoManualSchema.ts
src/backend/domain/interface/sispag/SispagInterface.ts
src/backend/domain/libs/environment/EnvironmentProvider.test.ts
src/backend/domain/libs/environment/EnvironmentProvider.ts
src/backend/domain/libs/environment/model/EnvironmentVars.ts
src/backend/domain/libs/sispag/AuthorizedPayeeRule.test.ts
src/backend/domain/libs/sispag/AuthorizedPayeeRule.ts
src/backend/domain/libs/sispag/ConferenciaLoteRule.test.ts
src/backend/domain/libs/sispag/ConferenciaLoteRule.ts
src/backend/domain/libs/sispag/DestinoManualValidator.test.ts
src/backend/domain/libs/sispag/DestinoManualValidator.ts
src/backend/domain/libs/sispag/ExcecaoDestinoRule.test.ts
src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts
src/backend/domain/libs/sispag/MaskDestino.test.ts
src/backend/domain/libs/sispag/MaskDestino.ts
src/backend/domain/libs/sispag/PayeeFingerprint.test.ts
src/backend/domain/libs/sispag/PayeeFingerprint.ts
src/backend/domain/repository/sispag/AlertaItemLoteRepository.test.ts
src/backend/domain/repository/sispag/AuthorizedPayeeRepository.integration.test.ts
src/backend/domain/repository/sispag/AuthorizedPayeeRepository.test.ts
src/backend/domain/repository/sispag/AuthorizedPayeeRepository.ts
src/backend/domain/repository/sispag/ExcecaoDestinoRepository.integration.test.ts
src/backend/domain/repository/sispag/ExcecaoDestinoRepository.test.ts
src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts
src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts
src/backend/domain/repository/sispag/LotePagamentoRepository.ts
src/backend/domain/repository/sispag/PendenciaCadastroRepository.test.ts
src/backend/domain/repository/sispag/PendenciaCadastroRepository.ts
src/backend/domain/repository/sispag/PerfilCanalFornecedorRepository.ts
src/backend/domain/repository/sispag/VerificacaoEventoRepository.ts
src/backend/domain/repository/sispag/VerificacaoTedPix.integration.test.ts
src/backend/domain/service/auth/EffectivePermissionCalculator.test.ts
src/backend/domain/service/sispag/AuthorizationCandidatesService.test.ts
src/backend/domain/service/sispag/AuthorizationCandidatesService.ts
src/backend/domain/service/sispag/AuthorizedPayeeService.test.ts
src/backend/domain/service/sispag/AuthorizedPayeeService.ts
src/backend/domain/service/sispag/ConferenciaLoteService.test.ts
src/backend/domain/service/sispag/ConferenciaLoteService.ts
src/backend/domain/service/sispag/DestinoPagamentoResolver.test.ts
src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
src/backend/domain/service/sispag/DuplicateResolutionService.test.ts
src/backend/domain/service/sispag/ExcecaoDestinoService.integration.test.ts
src/backend/domain/service/sispag/ExcecaoDestinoService.test.ts
src/backend/domain/service/sispag/ExcecaoDestinoService.ts
src/backend/domain/service/sispag/ExcecaoSubstituicaoService.test.ts
src/backend/domain/service/sispag/ExcecaoSubstituicaoService.ts
src/backend/domain/service/sispag/LotePagamentoApiView.ts
src/backend/domain/service/sispag/LotePagamentoService.test.ts
src/backend/domain/service/sispag/LotePagamentoService.ts
src/backend/domain/service/sispag/PendenciaCadastroService.test.ts
src/backend/domain/service/sispag/PendenciaCadastroService.ts
src/backend/domain/service/sispag/RemessaService.test.ts
src/backend/domain/service/sispag/RemessaService.ts
src/backend/domain/service/sispag/SispagPainelService.test.ts
src/backend/domain/service/sispag/SispagPainelService.ts
src/backend/domain/service/sispag/VerificacaoTedPixService.test.ts
src/backend/domain/service/sispag/VerificacaoTedPixService.ts
src/backend/http/routePermissions.test.ts
src/backend/http/schemas.ts
src/backend/jobs/aposentar-excecoes-substituidas.ts
src/backend/jobs/probe-destino-manual-uso.ts
src/backend/jobs/validate-sispag-favorecido-autorizado-v1.ts
src/backend/migrations/0068_sispag_aprovar_destino.test.ts
src/backend/migrations/0069_sispag_item_situacao_sincronizacao.test.ts
src/backend/migrations/0074_papel_analista.test.ts
src/backend/migrations/0075_sispag_excecao_destino.test.ts
src/backend/migrations/0076_sispag_alerta_item_lote.test.ts
src/backend/migrations/0077_sispag_bloqueio_pendencia.test.ts
src/backend/migrations/0079_permissoes_sispag_conferir_cadastro.test.ts
src/backend/migrations/0080_sispag_favorecido_autorizado.integration.test.ts
src/backend/migrations/0080_sispag_favorecido_autorizado.sql
src/backend/migrations/0080_sispag_favorecido_autorizado.test.ts
src/backend/migrations/rollbacks.test.ts
src/backend/migrations/rollbacks/0080_sispag_favorecido_autorizado.rollback.sql
src/backend/routes/sispag.favorecidos.test.ts
src/backend/routes/sispag.test.ts
src/backend/routes/sispag.ts
src/backend/routes/sispag.verificacao.test.ts
src/frontend/__tests__/editar-acesso-dialog.test.tsx
src/frontend/__tests__/permissoes-api.test.ts
src/frontend/app/perfil/alvo.test.ts
src/frontend/app/sispag/components/ConferenciaLoteDialog.test.tsx
src/frontend/app/sispag/components/ConferenciaLoteDialog.tsx
src/frontend/app/sispag/components/GerarRemessaDialog.test.tsx
src/frontend/app/sispag/components/GerarRemessaDialog.tsx
src/frontend/app/sispag/components/LoteCard.test.tsx
src/frontend/app/sispag/components/LoteCard.tsx
src/frontend/app/sispag/components/LoteCard.verificacao.test.tsx
src/frontend/app/sispag/excecoes/components/AprovarExcecaoDialog.tsx
src/frontend/app/sispag/excecoes/components/CadastrarExcecaoDialog.tsx
src/frontend/app/sispag/excecoes/components/Dialogos.test.tsx
src/frontend/app/sispag/excecoes/components/ExcecoesTable.test.tsx
src/frontend/app/sispag/excecoes/components/ExcecoesTable.tsx
src/frontend/app/sispag/excecoes/page.test.tsx
src/frontend/app/sispag/excecoes/page.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/AutorizacoesTab.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/AutorizacoesTable.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/CandidatosTab.test.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/CandidatosTab.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/DecidirAutorizacaoDialog.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/MotivoAutorizacaoDialog.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/RevelarDestinoButton.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/SeloConferencia.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/SolicitarAutorizacaoDialog.tsx
src/frontend/app/sispag/favorecidos-autorizados/components/formatar.ts
src/frontend/app/sispag/favorecidos-autorizados/page.test.tsx
src/frontend/app/sispag/favorecidos-autorizados/page.tsx
src/frontend/app/sispag/page.test.tsx
src/frontend/app/sispag/page.tsx
src/frontend/app/sispag/pendencias-cadastro/page.test.tsx
src/frontend/app/sispag/pendencias-cadastro/page.tsx
src/frontend/components/nav/app-nav.test.tsx
src/frontend/components/nav/app-nav.tsx
src/frontend/lib/permissoes.test.ts
src/frontend/lib/permissoes.ts
src/frontend/lib/sispag.test.ts
src/frontend/lib/sispag.ts
src/frontend/lib/sispag.verificacao.test.ts
