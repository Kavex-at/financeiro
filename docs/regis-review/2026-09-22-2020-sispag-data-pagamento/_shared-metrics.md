# Shared metrics — 2026-09-22-2020-sispag-data-pagamento

Scope: **backend + frontend**, `--quick`, delta da branch `fix/sispag-data-pagamento`
(`git diff origin/main...HEAD`). Pipeline: `/feature-tweak sispag-data-pagamento` (ADR-0049).

## Delta (código)

```
 src/backend/domain/errors/DebitDateErrors.test.ts          |  68 +
 src/backend/domain/errors/DebitDateFrozenError.ts          |  52 +
 src/backend/domain/errors/DebitDateOutsideWindowError.ts   |  80 +
 src/backend/domain/interface/sispag/SispagInterface.ts     |  44 +
 src/backend/domain/libs/calendar/BankingCalendar.test.ts   | 120 +
 src/backend/domain/libs/calendar/BankingCalendar.ts        | 138 +
 src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts |  51 +
 src/backend/domain/repository/sispag/LotePagamentoRepository.ts      |  25 +-
 src/backend/domain/service/sispag/DebitDateService.test.ts | 241 +
 src/backend/domain/service/sispag/DebitDateService.ts      | 194 +
 src/backend/domain/service/sispag/RemessaService.test.ts   | 321 +-
 src/backend/domain/service/sispag/RemessaService.ts        | 101 +-
 src/backend/jobs/execute-fin015-prd.ts                     |   6 +-
 src/backend/jobs/validate-retomada-remessa-v1.ts           |  10 +-
 src/backend/migrations/0061_lote_data_debito.sql           |  13 +
 src/backend/routes/sispag.test.ts                          | 150 +
 src/backend/routes/sispag.ts                               |  43 +
 src/frontend/app/sispag/components/GerarRemessaDialog.test.tsx | 222 +
 src/frontend/app/sispag/components/GerarRemessaDialog.tsx  | 266 +
 src/frontend/app/sispag/components/LoteCard.tsx            |  50 +-
 src/frontend/app/sispag/page.tsx                           |  15 +
 src/frontend/lib/sispag.test.ts                            |  93 +-
 src/frontend/lib/sispag.ts                                 |  90 +-
```

Mudança: a data de débito da remessa SISPAG (`flpDtaCredito` do `criarLote` no fin015) deixa de ser
`hojeUtc()` (meia-noite UTC — pulava um dia depois das 21h de Brasília) e passa a ser escolhida pela
analista dentro da janela `[hoje BRT, menor vencimento dos itens] ∩ dias úteis bancários` (I8a),
validada antes de qualquer escrita, persistida em `lote_pagamento.data_debito` antes do `criarLote`
e congelada enquanto o lote nativo existir (I8b). Calendário bancário calculado em código
(`BankingCalendar`, Páscoa por algoritmo). Nova rota `GET /sispag/lotes/:id/remessa/janela`;
`POST .../remessa` aceita `dataDebito` (Zod). Diálogo "Gerar remessa" no frontend.

## Backend

| Métrica | Valor |
|---|---|
| LOC não-teste (`.ts`) | 57 349 |
| Arquivos de teste | 159 |
| `npm run typecheck` | exit 0 |
| `npm run lint` (Biome) | exit 0 — 0 erros, 73 warnings (complexidade cognitiva, pré-existentes; `RemessaService.gerarRemessaSerializado` já era o maior) |
| `npm test` | 144 suites passando |

## Frontend

| Métrica | Valor |
|---|---|
| LOC não-teste (`.ts`/`.tsx`) | 21 917 |
| Arquivos de teste | 48 suites |
| `npm run typecheck` | exit 0 |
| `npm run lint` (ESLint) | exit 0 — 0 erros, 20 warnings (nenhum nos arquivos novos) |
| `npm test` | 48 suites passando |

## Infra

- `infra/`: Não medível — não existe neste repo (deploy via Render hook).
- `--quick`: sem coverage, sem npm audit profundo.
- Nenhuma escrita no ERP Conexos foi executada; a verificação ao vivo em HML fica como roteiro de QA.
