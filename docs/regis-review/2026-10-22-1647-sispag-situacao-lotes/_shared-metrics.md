# Shared metrics — run 2026-10-22-1647-sispag-situacao-lotes

**Escopo:** review REDUZIDO (testability, modifiability, fault-tolerance) do delta `origin/main..HEAD` da
branch `worktree-sispag-situacao-lotes` (PR C do plano `sispag-situacao-pagamento`, ADR-0076, regra
`prontidao-lote` I20). Os outros cinco QAs não rodam nesta rodada por escolha de escopo.

## Delta

35 arquivos, +2.699 / −67 (diff `origin/main..HEAD`, 2026-10-22).

| Camada | Arquivos (produção) | Testes |
|---|---|---|
| Backend serviço | `ProntidaoLoteResolver.ts` (259, novo, puro), `ProntidaoLoteService.ts` (68, novo), `SituacaoPagamentoService.ts` (+`avaliarVivos`, `avaliarGravados`), `LotePagamentoService.ts` (+guarda `exigirSituacoesPagaveis` no `finalizarLote`) | `ProntidaoLoteResolver.test.ts` (12), `ProntidaoLoteService.test.ts` (4), +4 em `LotePagamentoService.test.ts`, +3 em `SituacaoPagamentoService.test.ts` |
| Backend repo | `TituloAPagarRepository.buscarPorChaves` (unnest), `LotePagamentoRepository.titulosComAjusteNaoTerminalNosLotes` (etapas terminais compartilhadas via `$terminais`) | +1 integração SQL em cada (só rodam no job `backend-sql` do CI; sem Postgres local) |
| Backend contrato/erro/rota | `SituacaoPagamento.ts` (+ESTADO_PRONTIDAO, EFEITO_PENDENCIA, PENDENCIA_LOTE, ACAO_PENDENCIA_LOTE, DONO_PAGAMENTO.CADASTRO), `BatchHasBlockedItemsError` (422), `routes/sispag.ts` (GET /lotes e /lotes/:id chamam `comProntidao`) | rotas: serviço mockado como passthrough |
| Frontend | `app/sispag/lotes/` (5 arquivos novos), `LoteCard.tsx` (+30), `page.tsx` (+61), `AcaoDoTitulo.tsx` (extração de `OrientacaoNoConexos`), `lib/sispag.ts` (espelho do contrato) | `prontidaoLotes.test.ts` (4), `prontidaoComponentes.test.tsx` (20), +2 em `page.test.tsx`, paridade BE↔FE (+4 constantes) |

## Gates (medidos nesta branch)

- Backend: typecheck 0 erros; `jest` 282 suites / 5.290 testes verdes; biome nos arquivos tocados: 1 warning pré-existente (`incluirTitulo`, complexidade).
- Frontend: typecheck 0; lint 0 erros / 20 warnings (mesmo baseline da `main`); `jest` 114 suites / 1.255 testes verdes.
- PatternGuardian: PASS. DesignSystemReviewer: PASS (1 nota cosmética, `ring-[3px]`, igual ao padrão existente).

## Tamanho dos hotspots

- `LotePagamentoService.ts`: 832 → ~940 LOC (já card `modifiability-3` do review anterior).
- `page.tsx` (SISPAG): ~1.600 LOC.
- `LoteCard.tsx`: 1.121 → 1.151 LOC.

## Comportamento novo a examinar

1. `finalizarLote` passa a ler o `fin064` ao vivo **por item** (sequencial) antes da verificação TED/PIX; falha de leitura de um item barra o lote (fail-closed).
2. A prontidão da listagem degrada para "sem prontidão" (lista sem selo) se o contexto falhar; fonte de situação caída vira pendência `SITUACAO_NAO_CONFERIDA` que barra.
3. Finalizar em massa é sequencial no cliente, sem endpoint novo nem Idempotency-Key; resultado por lote.
