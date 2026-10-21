# Shared metrics — Regis-Review reduzido, sispag-situacao-pagamento (PR #128)

- run_id: 2026-10-21-1458; escopo: delta `origin/main..HEAD` (16 commits), QAs: testability, modifiability, fault-tolerance
- Worktree: .claude/worktrees/sispag-situacao-pagamento, branch worktree-sispag-situacao-pagamento, HEAD 737d010

## Delta
```
 61 files changed, 7235 insertions(+), 33 deletions(-)
```

### Arquivos de produção alterados (linhas + / -)
```
51	1	src/backend/domain/client/ConexosSispagClient.ts
31	8	src/backend/domain/errors/TituloNaoElegivelError.ts
10	0	src/backend/domain/interface/sispag/SispagInterface.ts
162	0	src/backend/domain/interface/sispag/SituacaoPagamento.ts
12	0	src/backend/domain/libs/calendar/BankingCalendar.ts
20	0	src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.ts
19	10	src/backend/domain/repository/sispag/TituloAPagarRepository.ts
10	0	src/backend/domain/service/sispag/BoletoSuggestionService.ts
43	1	src/backend/domain/service/sispag/FormacaoLotesService.ts
55	1	src/backend/domain/service/sispag/IngestaoPagamentosService.ts
135	0	src/backend/domain/service/sispag/LotePagamentoService.ts
30	5	src/backend/domain/service/sispag/SispagPainelService.ts
352	0	src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts
195	0	src/backend/domain/service/sispag/SituacaoPagamentoService.ts
103	0	src/backend/jobs/validate-situacao-pagamento-v1.ts
15	0	src/backend/migrations/0089_sispag_titulo_tipo.sql
1	1	src/backend/package.json
33	0	src/backend/routes/sispag.ts
78	0	src/frontend/app/sispag/page.tsx
170	0	src/frontend/app/sispag/situacao/AcaoDoTitulo.tsx
61	0	src/frontend/app/sispag/situacao/BarraSelecaoLotes.tsx
136	0	src/frontend/app/sispag/situacao/CardsSituacao.tsx
88	0	src/frontend/app/sispag/situacao/FaixaBloqueadosHoje.tsx
166	0	src/frontend/app/sispag/situacao/FiltroSituacaoBarra.tsx
67	0	src/frontend/app/sispag/situacao/PreviaLotesAutomaticos.tsx
72	0	src/frontend/app/sispag/situacao/RegrasSituacao.tsx
118	0	src/frontend/app/sispag/situacao/ResultadoLotesDialog.tsx
427	0	src/frontend/app/sispag/situacao/TabelaTitulos.tsx
265	0	src/frontend/app/sispag/situacao/TitulosAbaSituacao.tsx
31	0	src/frontend/app/sispag/situacao/VencimentoCelula.tsx
129	0	src/frontend/app/sispag/situacao/filtrosAtivos.ts
35	0	src/frontend/app/sispag/situacao/resultadoLotes.ts
132	0	src/frontend/app/sispag/situacao/rotulos.ts
79	0	src/frontend/app/sispag/situacao/selecao.ts
308	0	src/frontend/app/sispag/situacao/situacaoTitulos.ts
93	0	src/frontend/app/sispag/situacao/useCriarLotesPorFilial.ts
138	0	src/frontend/app/sispag/situacao/useTabelaTitulos.ts
284	0	src/frontend/components/ui/column-header-filter.tsx
148	0	src/frontend/lib/sispag.ts
1	1	src/frontend/package.json
```

### Testes alterados
```
49	0	src/backend/domain/client/ConexosSispagClient.test.ts
9	0	src/backend/domain/libs/calendar/BankingCalendar.test.ts
27	0	src/backend/domain/repository/sispag/TituloAPagarRepository.test.ts
112	3	src/backend/domain/service/sispag/FormacaoLotesService.test.ts
66	0	src/backend/domain/service/sispag/IngestaoPagamentosService.test.ts
228	0	src/backend/domain/service/sispag/LotePagamentoService.test.ts
68	0	src/backend/domain/service/sispag/SispagPainelService.test.ts
567	0	src/backend/domain/service/sispag/SituacaoPagamentoResolver.test.ts
344	0	src/backend/domain/service/sispag/SituacaoPagamentoService.test.ts
3	2	src/backend/http/routePermissions.test.ts
23	0	src/backend/migrations/0089_sispag_titulo_tipo.test.ts
88	0	src/backend/routes/sispag.test.ts
88	0	src/frontend/app/sispag/page.situacao.test.tsx
382	0	src/frontend/app/sispag/situacao/TitulosAbaSituacao.test.tsx
73	0	src/frontend/app/sispag/situacao/filtrosAtivos.test.ts
59	0	src/frontend/app/sispag/situacao/rotulos.test.ts
69	0	src/frontend/app/sispag/situacao/selecao.test.ts
265	0	src/frontend/app/sispag/situacao/situacaoTitulos.test.ts
125	0	src/frontend/components/ui/column-header-filter.test.tsx
34	0	src/frontend/lib/sispag.test.ts
```

## Tamanho dos arquivos novos/centrais (wc -l)
```
   567 src/backend/domain/service/sispag/SituacaoPagamentoResolver.test.ts
   352 src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts
   344 src/backend/domain/service/sispag/SituacaoPagamentoService.test.ts
   195 src/backend/domain/service/sispag/SituacaoPagamentoService.ts
   551 src/backend/domain/service/sispag/SispagPainelService.ts
   832 src/backend/domain/service/sispag/LotePagamentoService.ts
   197 src/backend/domain/service/sispag/FormacaoLotesService.ts
  1651 src/backend/routes/sispag.ts
   170 src/frontend/app/sispag/situacao/AcaoDoTitulo.tsx
    61 src/frontend/app/sispag/situacao/BarraSelecaoLotes.tsx
   136 src/frontend/app/sispag/situacao/CardsSituacao.tsx
    88 src/frontend/app/sispag/situacao/FaixaBloqueadosHoje.tsx
    73 src/frontend/app/sispag/situacao/filtrosAtivos.test.ts
   129 src/frontend/app/sispag/situacao/filtrosAtivos.ts
   166 src/frontend/app/sispag/situacao/FiltroSituacaoBarra.tsx
    67 src/frontend/app/sispag/situacao/PreviaLotesAutomaticos.tsx
    72 src/frontend/app/sispag/situacao/RegrasSituacao.tsx
   118 src/frontend/app/sispag/situacao/ResultadoLotesDialog.tsx
    35 src/frontend/app/sispag/situacao/resultadoLotes.ts
    59 src/frontend/app/sispag/situacao/rotulos.test.ts
   132 src/frontend/app/sispag/situacao/rotulos.ts
    69 src/frontend/app/sispag/situacao/selecao.test.ts
    79 src/frontend/app/sispag/situacao/selecao.ts
   265 src/frontend/app/sispag/situacao/situacaoTitulos.test.ts
   308 src/frontend/app/sispag/situacao/situacaoTitulos.ts
   427 src/frontend/app/sispag/situacao/TabelaTitulos.tsx
   382 src/frontend/app/sispag/situacao/TitulosAbaSituacao.test.tsx
   265 src/frontend/app/sispag/situacao/TitulosAbaSituacao.tsx
    93 src/frontend/app/sispag/situacao/useCriarLotesPorFilial.ts
   138 src/frontend/app/sispag/situacao/useTabelaTitulos.ts
    31 src/frontend/app/sispag/situacao/VencimentoCelula.tsx
  2687 src/frontend/lib/sispag.ts
   284 src/frontend/components/ui/column-header-filter.tsx
 11023 total
```

## Gates (medidos nesta sessão, 2026-10-21)
- Backend: typecheck 0 erros; lint 0 erros (112 warnings, baseline); jest 280 suítes / 5.255 testes ✅
- Frontend: typecheck 0 erros; lint 0 erros (20 warnings, nenhum em app/sispag/situacao); jest 112 suítes / 1.228 testes ✅
- CI do PR (HEAD 737d010): Backend SQL (Postgres 17) ✅, Frontend ✅, Vercel ✅
- PatternGuardian ✅ (0 violações); DesignSystemReviewer ✅
- Não medido: cobertura (não rodada); validação ao vivo do leitor com298/list (depende do robô)
