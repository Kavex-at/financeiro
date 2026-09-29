# Shared metrics — run 2026-09-29-0104

Feature `sispag-ted-pix` (ADR-0054), branch `feat/sispag-ted-pix`, invoked by the AutoLoopRunner as the
post-green Regis-Review gate. **Scope = directories touched by the feature**:

- `src/backend/domain/service/sispag/` (RemessaService, SispagPainelService, LotePagamentoService,
  DestinoPagamentoResolver [new], LotePagamentoApiView [new])
- `src/backend/domain/libs/sispag/` (MaskDestino, DestinoManualValidator — new)
- `src/backend/domain/libs/cnab/RemessaCnabValidator.ts`
- `src/backend/domain/client/ConexosSispagClient.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- `src/backend/domain/errors/Destino*.ts`, `DocumentoFavorecidoIndisponivelError.ts` (new)
- `src/backend/routes/sispag.ts`
- `src/backend/migrations/0066_sispag_destino_manual.sql` (+ test, + integration test)
- `src/backend/jobs/probe-sispag-ted-pix-supervisionado.ts` (new, manual read-only probe, not run)
- `src/frontend/app/sispag/` (InformarDestinoDialog [new], LoteCard), `src/frontend/lib/sispag.ts`

Use `git diff origin/main...HEAD` to separate the feature delta from pre-existing code. Findings about
code outside the delta must be labelled PRE_EXISTING.

## Delta vs origin/main

57 files changed, 7486 insertions(+), 116 deletions(−) (includes ontology docs and tests).

## Size

| Metric | Value |
|---|---|
| Backend non-test LOC in scoped dirs (service/sispag, libs/sispag, libs/cnab, repository/sispag, routes/sispag.ts, ConexosSispagClient.ts) | 8,313 |
| Backend test files (whole repo) | 180 |
| Frontend | see `src/frontend/app/sispag` |
| Terraform / tenants | ⚠️ Não medível: não existe `infra/` neste repo (deploy Render/Vercel, ver CLAUDE.md) |

## Gates measured in this cycle (real runs)

| Gate | Result |
|---|---|
| backend `npm test` | 164 suites / 2,570 tests passing |
| backend `npm run test:sql` (local Postgres 17) | 2 suites / 30 tests passing (inclui a trilha só-inclusão da 0066: UPDATE/DELETE/TRUNCATE recusados) |
| backend `npm run typecheck` | 0 errors |
| backend `npm run lint` (Biome) | 0 errors, 75 warnings (pré-existentes; delta adicionou +2 de complexidade cognitiva em RemessaService.gerarRemessaSerializado 91→93 e montarItensImport 32→36) |
| frontend `npm test` | 58 suites / 505 tests passing |
| frontend `npm run typecheck` | 0 errors |
| frontend `npm run lint` (ESLint) | 0 errors, 19 warnings pré-existentes (nenhum em arquivo tocado) |

## Feature facts relevant to every QA

- Três flags de go-live, **default OFF**, lidas só pelo `EnvironmentProvider`: `SISPAG_TED_ENABLED`,
  `SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`. Com as três OFF o envio é byte-idêntico ao main
  (testes de paridade capturados contra o código antigo).
- Sem HML: hipóteses H1, H3–H7 serão validadas em PRD supervisionado (checklist no tasks.md). O
  Ground-Truth Validation gate foi dispensado por isso.
- Dado sensível (conta, chave PIX, CPF/CNPJ): gravado completo em `lote_pagamento_item.destino_manual` e
  na trilha `lote_pagamento_item_destino_audit`; testes afirmam que não aparece em log, ledger
  (`remessa_execucao.request_payload`), mensagem de erro nem resposta da API.
