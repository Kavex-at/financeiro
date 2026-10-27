# Shared metrics — 2026-10-27-1803-sispag-vinculo-data-divergente (reduced Regis-Review, delta only)

Worktree: `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-vinculo-data-divergente`
Delta: `git diff origin/main...HEAD` (base dc4d2b9d, head 532dd766, v0.76.0, ADR-0078, migration 0091, rules I15r/I17p/I17q).

## Files changed (src only)
```
 .../libs/boleto/FatorVencimentoBoleto.test.ts      |  56 +++
 .../domain/libs/boleto/FatorVencimentoBoleto.ts    |  62 +++
 .../domain/libs/boleto/PrazoFinalBoleto.test.ts    |  32 ++
 src/backend/domain/libs/boleto/PrazoFinalBoleto.ts |  31 ++
 .../libs/boleto/ReconhecimentoDivergencia.test.ts  |  54 +++
 .../libs/boleto/ReconhecimentoDivergencia.ts       |  28 ++
 .../AjusteCentavosExecucaoRepository.test.ts       |  27 ++
 .../repository/sispag/LotePagamentoRepository.ts   |  26 +-
 .../sispag/SugestaoBoletoRepository.test.ts        |  52 +++
 .../repository/sispag/SugestaoBoletoRepository.ts  |  40 +-
 .../sispag/VinculoCodigoBarras.repository.test.ts  |  81 ++++
 .../service/sispag/BoletoSuggestionService.test.ts | 173 +++++++-
 .../service/sispag/BoletoSuggestionService.ts      | 125 +++++-
 .../service/sispag/ConferenciaReconhecimento.ts    |  93 ++++
 .../domain/service/sispag/DebitDateService.test.ts |  72 ++++
 .../domain/service/sispag/DebitDateService.ts      |  35 +-
 .../service/sispag/MotorSugestaoBoleto.test.ts     |  92 +++-
 .../domain/service/sispag/MotorSugestaoBoleto.ts   |  31 +-
 .../service/sispag/PrazoBoletoCalculador.test.ts   | 265 ++++++++++++
 .../domain/service/sispag/PrazoBoletoCalculador.ts |  91 ++++
 .../service/sispag/RegraSugestaoBoleto.test.ts     | 111 ++++-
 .../domain/service/sispag/RegraSugestaoBoleto.ts   |  46 +-
 .../service/sispag/SituacaoPagamentoResolver.ts    |  18 +-
 .../sispag/SituacaoPagamentoService.test.ts        |  97 ++++-
 .../service/sispag/SituacaoPagamentoService.ts     |  48 ++-
 .../sispag/VinculoCodigoBarrasService.test.ts      |  24 ++
 .../service/sispag/VinculoCodigoBarrasService.ts   |   2 +-
 src/backend/jobs/hmlDataDivergenteCasos.test.ts    |  98 +++++
 src/backend/jobs/hmlDataDivergenteCasos.ts         | 114 +++++
 .../jobs/probe-hml-vinculo-data-divergente-rem.ts  | 468 +++++++++++++++++++++
 .../probe-hml-vinculo-data-divergente-remessa.ts   | 112 +++++
 .../jobs/probe-hml-vinculo-data-divergente.ts      | 154 +++++++
 .../0091_sispag_reconhecimento_divergencia.sql     | 150 +++++++
 .../0091_sispag_reconhecimento_divergencia.test.ts |  63 +++
 src/backend/migrations/rollbacks.test.ts           |   3 +
 ..._sispag_reconhecimento_divergencia.rollback.sql |  46 ++
 src/backend/package.json                           |   2 +-
 src/backend/routes/sispag.sugestaoBoleto.test.ts   | 127 ++++++
 src/backend/routes/sispag.ts                       |  15 +-
 .../components/ReconhecerDivergenciaDialog.tsx     | 156 +++++++
 .../SugestaoBoletoPainel.desfecho.test.tsx         | 128 ++++++
 .../app/sispag/components/SugestaoBoletoPainel.tsx |  47 ++-
 .../app/sispag/components/filtrosAbas.test.ts      |  13 +
 src/frontend/app/sispag/components/filtrosAbas.ts  |   4 +-
 .../components/sugestaoBoleto.desfecho.test.ts     |  61 +++
 .../app/sispag/components/sugestaoBoleto.ts        |  49 ++-
 .../app/sispag/situacao/FaixaBloqueadosHoje.tsx    |  90 +++-
 src/frontend/app/sispag/situacao/TabelaTitulos.tsx |   6 +-
 .../sispag/situacao/TitulosAbaSituacao.test.tsx    |  59 +++
 .../app/sispag/situacao/TitulosAbaSituacao.tsx     |  10 +-
 .../app/sispag/situacao/VencimentoCelula.tsx       |  22 +-
 .../app/sispag/situacao/prazoTitulo.test.ts        | 105 +++++
 src/frontend/app/sispag/situacao/prazoTitulo.ts    |  64 +++
 .../app/sispag/situacao/situacaoTitulos.test.ts    |  84 +++-
 .../app/sispag/situacao/situacaoTitulos.ts         |  26 +-
 src/frontend/lib/sispag.sugestaoBoleto.test.ts     |   2 +
 src/frontend/lib/sispag.sugestaoBoletoApi.test.ts  |  17 +
 src/frontend/lib/sispag.ts                         |  65 ++-
 src/frontend/package.json                          |   2 +-
 76 files changed, 4706 insertions(+), 115 deletions(-)
```

## Gates (worker run after rebase, 2026-10-27)
- Backend: typecheck clean; lint exit 0 (0 errors, 126 warnings); jest 312 suites / 6140 tests pass.
- Frontend: typecheck clean; lint 0 errors, 21 warnings; jest 123 suites / 1383 tests pass.
- Orchestrator re-check: typecheck clean; 44 suites / 528 tests (ElegibilidadeVinculo, libs/boleto, migrations).

## Context
- Phase 1 only: typed acknowledgement for Δ in [-10,-1]∪[6,10] with equal value; prazoBoleto; 7th due-factor check. Phase 2 (actual binding, flag SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS) is NOT in src and is out of scope.
- Not run: manual QA script (ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md); Saturday-rollover HML probe.
