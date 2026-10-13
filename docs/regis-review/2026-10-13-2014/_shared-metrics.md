# Regis-Review 2026-10-13-2014 — métricas compartilhadas

> Escopo: **delta da branch `worktree-sispag-dda-na-ingestao` contra `origin/main` (5a17d3e, v0.64.0)**.
> Pipeline de feature (`/feature-tweak sispag-dda-na-ingestao`): só os diretórios tocados.
> Worktree: `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-dda-na-ingestao`
> Use SEMPRE caminhos dentro deste worktree. O checkout principal está em outro commit.
> Delta lido com: `git diff 5a17d3e HEAD` (3 commits: 33d9cdc feat, ae8e182 docs, a5c4658 release).

## Delta

26 arquivos, +592/−39. Código de produção tocado:

| Arquivo | LOC atual |
|---|---|
| `src/backend/domain/service/sispag/IngestaoPagamentosService.ts` | 425 |
| `src/backend/domain/service/sispag/BoletoDdaService.ts` | 180 |
| `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` | 250 |
| `src/backend/domain/client/ConexosSispagClient.ts` | (campo `docEspNumero` + mapper) |
| `src/backend/domain/interface/sispag/SispagInterface.ts`, `BoletoDda.ts` | tipos novos |
| `src/backend/jobs/ingest-pagamentos.ts`, `ingest-boletos-dda.ts` | saída do job / comentário |
| `src/backend/migrations/0083_titulo_doc_esp_numero.sql` | 1 coluna nullable |
| `src/frontend/app/sispag/components/BoletosDdaTab.tsx` | 445 |
| `src/frontend/app/sispag/components/ddaDefasado.ts` | 35 |

Testes novos/ajustados: `IngestaoPagamentosService.test.ts` (+4 casos DDA), `BoletoDdaService.test.ts`
(+3), `TituloAPagarRepository.test.ts` (+1), `ConexosSispagClient.test.ts` (+1),
`migrations/0083_*.test.ts` (2), `ddaDefasado.test.ts` (5), `BoletosDdaTab.test.tsx` (+2).

## Baselines medidos neste worktree

| Métrica | Resultado |
|---|---|
| Backend typecheck | limpo |
| Backend lint (biome) | 0 erros, 87 warnings (preexistentes; `runIngestion` complexidade 20, era 31 no meio do ciclo) |
| Backend testes | 230 suites / 4081 testes passando |
| Frontend typecheck/lint | 0 erros de lint; 1 erro de typecheck **ambiental** (`@radix-ui/react-dropdown-menu` ausente no `node_modules` compartilhado, fora do delta) |
| Frontend testes | 88 suites passando; 2 suites falham pelo mesmo módulo ausente (ambiental, fora do delta) |
| Infra / Terraform | não existe (`infra/` ausente) — não medível |

## O que a mudança faz (resumo para os agentes)

`IngestaoPagamentosService.runIngestion` passa a chamar `BoletoDdaService.sincronizar` (pool DDA do
`fin124`) **antes** de ler os títulos, com prazo de 60 s (`DDA_PRAZO_NA_INGESTAO_MS`). Falha, lock
ocupado (`IngestLockBusyError`) e prazo estourado nunca derrubam a ingestão: viram `dda.estado`
(`sincronizado|parcial|ocupada|falhou`) no resultado e aviso em `error_message` da run. Nova coluna
`titulo_a_pagar.doc_esp_numero` (UPSERT com COALESCE). A aba "Boletos DDA" avisa pool parado > 8 h em
dia útil. ADR: `ontology/decisions/0067-sispag-dda-sincroniza-dentro-da-ingestao.md`.
Superfícies que chamam a ingestão: crons (`ingest-sispag.yml` 07h/12h/16h BRT), abertura de tela
(`CarteiraAtualizacaoService`, TTL 30 min) e botão manual.
