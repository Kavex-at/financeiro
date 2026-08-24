# Métricas compartilhadas — 2026-08-24-1830-sispag-remessa-retorno

> Escopo: **branch `fix/sispag-fin015-import-shape` (PR #60)**, frente SISPAG.
> Layout: este repo usa `src/backend`/`src/frontend` (o skill assume `backend/src`). **Não há `infra/`** — Terraform/tenants não se aplicam (deploy é Render, ver DEPLOY.md).

## Delta sob review
```
 .../domain/service/sispag/RemessaService.test.ts   | 393 ++++++++++++++++
 .../domain/service/sispag/RemessaService.ts        | 467 +++++++++++++++++++
 .../service/sispag/RetornoOrquestracaoService.ts   | 198 --------
 .../service/sispag/SispagPainelService.test.ts     |  85 ++++
 .../domain/service/sispag/SispagPainelService.ts   |  65 ++-
 src/backend/jobs/cleanup-fin015-testes.ts          |  96 ++++
 src/backend/jobs/execute-fin015-prd.ts             | 432 +++++++++++++++++
 src/backend/jobs/ingest-pagamentos.ts              |   5 +
 src/backend/jobs/preflight-fin015-prd.ts           | 224 +++++++++
 src/backend/jobs/probe-baixa-conta-financeira.ts   | 189 ++++++++
 src/backend/jobs/probe-fin015-import.ts            | 257 ++++++++++
 src/backend/jobs/probe-fin052-hml.ts               |   6 +-
 src/backend/jobs/probe-fin052-retorno.ts           | 391 ++++++++++++++++
 src/backend/jobs/probe-fin064-destino.ts           | 225 +++++++++
 src/backend/jobs/processar-ret-fin052.ts           | 139 ++++++
 src/backend/jobs/seed-hml-param-filial.ts          | 131 ++++++
 src/backend/jobs/seed-hml-vencimento.ts            | 233 +++++++++
 src/backend/jobs/sintetizar-ret-fin052.ts          | 175 +++++++
 src/backend/jobs/validate-fin015-import.ts         | 518 +++++++++++++++++++++
 src/backend/jobs/validate-fin015-remessa.ts        | 230 +++++++++
 src/backend/jobs/validate-fin052-tools.ts          |   2 +
 .../migrations/0049_sispag_remessa_retorno.sql     | 105 +++++
 src/backend/package.json                           |   5 +-
 src/backend/routes/sispag.ts                       | 111 +++++
 src/frontend/app/sispag/components/LoteCard.tsx    | 159 ++++++-
 src/frontend/app/sispag/page.tsx                   | 160 +++++--
 src/frontend/lib/auth/AuthProvider.tsx             |  17 +-
 src/frontend/lib/sispag.ts                         | 225 ++++++++-
 src/frontend/package.json                          | 110 ++---
 47 files changed, 6746 insertions(+), 337 deletions(-)
```

## Arquivos do delta (SISPAG)
```
ontology/_inbox/sispag-fin015-ida-provada-hml.md
ontology/_inbox/sispag-fin052-retorno-provado-hml.md
src/backend/domain/client/ConexosSispagClient.ts
src/backend/domain/client/ConexosSispagRetornoClient.test.ts
src/backend/domain/client/ConexosSispagRetornoClient.ts
src/backend/domain/client/ConexosSispagWriteClient.test.ts
src/backend/domain/client/ConexosSispagWriteClient.ts
src/backend/domain/interface/sispag/Fin015Write.ts
src/backend/domain/interface/sispag/Fin052Retorno.ts
src/backend/domain/interface/sispag/RemessaExecucao.ts
src/backend/domain/interface/sispag/SispagInterface.ts
src/backend/domain/repository/sispag/LotePagamentoRepository.ts
src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
src/backend/domain/service/sispag/ConciliacaoRetornoService.test.ts
src/backend/domain/service/sispag/ConciliacaoRetornoService.ts
src/backend/domain/service/sispag/RemessaService.test.ts
src/backend/domain/service/sispag/RemessaService.ts
src/backend/domain/service/sispag/RetornoOrquestracaoService.ts
src/backend/domain/service/sispag/SispagPainelService.test.ts
src/backend/domain/service/sispag/SispagPainelService.ts
src/backend/migrations/0049_sispag_remessa_retorno.sql
src/backend/routes/sispag.ts
src/frontend/app/sispag/components/LoteCard.tsx
src/frontend/app/sispag/page.tsx
src/frontend/lib/sispag.ts
```

## LOC do backend por camada
```
domain/service          13764 LOC em  50 arquivos
domain/repository        5161 LOC em  20 arquivos
domain/client            6606 LOC em  20 arquivos
domain/interface         4533 LOC em  41 arquivos
routes                   2520 LOC em   7 arquivos
jobs                     6473 LOC em  37 arquivos
migrations               1780 LOC em  54 arquivos
```

## Testes
```
backend:  264 arquivos · 1330 testes · 105 suítes (verde, .env fora)
frontend: 211 arquivos · 189 testes · verde
⚠️ recebimentos.e2e.* FALHA com .env presente (CONEXOS_DRY_RUN=false vs suíte que testa dry-run default) — pré-existente
```

## Typecheck e lint
```
backend  tsc --noEmit: limpo
frontend tsc --noEmit: limpo
biome: aplicado em todos os arquivos do delta
```

## Dependências
```
src/backend/package.json: 16 deps + 14 devDeps
src/frontend/package.json: 23 deps + 17 devDeps
```

## Contexto de risco (do trabalho ao vivo)
- As 3 escritas do `fin015` NÃO são idempotentes — retry duplica lote de pagamento.
- `CONEXOS_WRITE_ENABLED=true` + `CONEXOS_DRY_RUN=false` no ambiente: 'Gerar remessa' escreve de verdade.
- `CONEXOS_DRY_RUN` é flag GLOBAL (Permutas e Recebimentos também) — não dá para isolar o SISPAG.
- Migration 0049 JÁ aplicada na Supabase compartilhada (aditiva).
- Falha no import deixa rascunho órfão no `fin015`; a API não deleta rascunho.
- `LOGIN_ERROR_MAX_SESSIONS` observado: cada operação abre sessão; escrita atribuída a pessoa real, não robô.
- Perna de retorno validada só com `.RET` SINTÉTICO; nunca rodou pelo caminho da tela.
