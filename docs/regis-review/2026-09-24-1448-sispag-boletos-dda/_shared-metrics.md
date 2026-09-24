# Shared metrics — `sispag-boletos-dda` (delta vs `origin/main`)

- **Worktree:** `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-boletos-dda-tab`
  (leia os arquivos DAQUI; o checkout principal está em `main` e não tem estes arquivos)
- **Branch:** `worktree-sispag-boletos-dda-tab` — PR #85 (draft), release v0.42.0
- **Feature:** aba "Boletos DDA (fin124)" no SISPAG. Snapshot local, READ-ONLY no ERP, do pool de
  boletos DDA do Conexos (`fin124`, ~162 arquivos / ~24 mil boletos, pool GLOBAL da conta pagadora)
  consolidado contra a carteira `titulo_a_pagar`: VINCULADO / CANDIDATO / AMBIGUO / SEM_TITULO.
  Candidato é sugestão, nunca gravado. Nenhuma escrita no Conexos. Ver `ontology/entities/boleto-dda.md`.
- **Layout:** `src/backend/` e `src/frontend/` (não `backend/src/`). **Não existe `infra/`** —
  métricas de Terraform/tenant são **não medíveis** (deploy via Render hook).
- **Escopo desta revisão (pedido explícito do usuário):** só os QAs necessários — **Security,
  Integrability, Performance**. Os outros 5 NÃO rodam nesta execução.

## Escopo do delta (`git diff --stat origin/main...HEAD`)

```
 src/backend/domain/client/ConexosDdaClient.ts          | 144 (novo)  fin124 list/itens, Zod
 src/backend/domain/interface/sispag/BoletoDda.ts       | 123 (novo)
 src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts   |  63 (novo)  44 → 47 dígitos
 src/backend/domain/repository/sispag/BoletoDdaRepository.ts | 153 (novo)
 src/backend/domain/repository/sispag/LotePagamentoRepository.ts | +29 (listTitulosEmLotesAbertos)
 src/backend/domain/service/sispag/BoletoDdaService.ts  | 140 (novo)  sync incremental + listar
 src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts | 180 (novo, pura)
 src/backend/jobs/ingest-boletos-dda.ts                 |  37 (novo)
 src/backend/migrations/0062_boleto_dda.sql             |  43 (novo, aditiva)
 src/backend/routes/sispag.ts                           | +43  GET /boletos-dda, POST /boletos-dda/sincronizar
 src/frontend/app/sispag/components/BoletosDdaTab.tsx   | 375 (novo)
 src/frontend/app/sispag/components/CandidatosBoletoDialog.tsx | 140 (novo)
 src/frontend/app/sispag/page.tsx                       |  +7
 src/frontend/lib/sispag.ts                             | +85
 + testes: ConexosDdaClient (94), CodigoBarrasBoleto (35), BoletoDdaRepository (83),
   BoletoDdaService (111), ConsolidacaoBoletoDda (149), BoletosDdaTab (151)
 26 files changed, 2371 insertions(+), 5 deletions(-)
```

## Gates medidos nesta branch (2026-09-24, após rebase em origin/main)

| Gate | Resultado |
|---|---|
| Backend typecheck | ✅ 0 erros |
| Backend tests | ✅ 150 suites / 2194 testes |
| Backend lint (biome) | ✅ 0 erros, 73 warnings pré-existentes, **0 nos arquivos novos** |
| Frontend typecheck | ✅ 0 erros |
| Frontend tests | ✅ 51 suites / 419 testes |
| Frontend lint | ✅ 0 erros, 20 warnings pré-existentes, **0 nos arquivos novos** |
| Frontend `next build` | ✅ |

## Medições em execução real (2026-09-24, backend local `npm run dev:local`, Postgres em container)

| Medida | Valor |
|---|---|
| Sync completo (job) | 162 arquivos novos, **24.137 boletos**, **0 falhas** |
| `GET /sispag/boletos-dda?escopo=a-vencer` | 200, **1.665 boletos**, **97 ms** (backend local) |
| `GET /sispag/boletos-dda?escopo=todos` | 200, **24.137 boletos**, **393 ms** (backend local) |
| Sem token | **401** |
| Situações (todos) | SEM_TITULO 23.325 · CANDIDATO 481 · AMBIGUO 300 · VINCULADO 31 |
| Pior ambíguo observado | boleto PEDRONI 329691 com **19 candidatos** |
| Login Conexos | toda sessão nova recebe `LOGIN_ERROR_MAX_SESSIONS` (usuário compartilhado `MPS_FRANCINEI` já com 3 sessões, incl. IPs do servidor de produção); o client se recupera |

## Fatos relevantes para os QAs

- **Migração por NOME:** `MigrationRunner` (`src/backend/migrations/runMigrations.ts`) registra o nome
  completo do arquivo em `schema_migrations`. A v0.41.0 publicou `0062_titulo_retencao_formacao.sql`,
  removido depois (commit 1480b60); este PR adiciona `0062_boleto_dda.sql`. Nomes distintos → ambos
  aplicáveis; o número repetido é só rastreabilidade.
- **Guard de acesso:** as duas rotas novas usam `requireRole('admin')`; a de sincronização também
  `heavyRouteLimiter`. Justificativa: código de barras carrega banco/agência/conta do cedente (LGPD/LC 105),
  mesmo guard de `GET /sispag/lotes/:id/linhas-digitaveis`.
- **Payload:** "Todos" devolve o pool inteiro (24k linhas, com `codbar` + `linhaDigitavel` por linha) e o
  front filtra/pagina no cliente (`useTabelaFiltro`), igual às outras abas.
- **Sync:** `BoundedConcurrency` limite 3, advisory lock próprio (`726354820`), transação por arquivo,
  releitura dos arquivos importados nos últimos 60 dias.
