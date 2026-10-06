# tasks.md — SISPAG: lotes automáticos por vencimento + mover títulos para lote manual

> `/feature-tweak LotePagamento` — Grupo A do lote paralelo A/B/C de melhorias SISPAG (2026-10-06).
> Escopo decidido pelo usuário (entrevista dispensada). Branch `feat/sispag-lotes-vencimento-mover`.
> ADR-0064. `entity_changed = false` (nenhuma entidade/propriedade persistida nova; muda regra de
> formação e ganha uma variante da ação `incluirTituloNoLote`).

## Decisões do usuário

1. Lotes automáticos agrupam por **filial × dia de vencimento**. *(Revisto após QA, 2026-10-06: sem
   teto de 25; cada grupo vira no máximo dois lotes, boletos / resto, nunca mistos. Ver T6.)*
2. "Retirar" um a um deixa de ser o fluxo principal: na aba Títulos a analista seleciona títulos,
   **inclusive os que já estão num lote RASCUNHO**, clica "Criar lote", confirma a lista de quem sai
   de qual lote, e os títulos **movem** para o novo lote manual. Títulos em lote FINALIZADO ou com
   remessa gerada **não** se movem (UI explica). Lote de origem vazio → cancelado; lote automático
   que perde item → manual.

## T1 — Formação por filial × vencimento, boletos juntos no fatiamento

Arquivos: `domain/service/sispag/FormacaoLotesService.ts` (+ teste).

- Chave de grupo `filCod:AAAA-MM-DD` (dia civil UTC do vencimento, `BankingCalendar.fromErpEpoch`,
  mesma regra do resto do SISPAG).
- Grupo ≤ 25: um lote (misto permitido).
- Grupo > 25: k = ⌈n/25⌉ lotes (o número mínimo; o teto não muda). Se ⌈b/25⌉ + ⌈m/25⌉ = k
  (b boletos, m não-boletos), boletos e não-boletos saem em lotes separados (zero mistos); senão,
  boletos primeiro e contíguos, fatiados de 25 em 25 (no máximo um lote misto).

Aceite:
- Mesma filial, dois vencimentos → dois lotes; mesma filial e dia → um lote.
- 30 títulos (15 boletos, 15 não) no mesmo dia → 2 lotes, um só-boleto e um só-não-boleto.
- 30 títulos (28 boletos, 2 não) → 2 lotes: 25 boletos; 3 boletos + 2 não (um misto).
- A conta pagadora continua resolvida uma vez por filial na rodada.

## T2 — Backend: incluir com `mover` (move atômico do lote RASCUNHO de origem)

Arquivos: `LotePagamentoService.ts`, `LotePagamentoRepository.ts`, `SispagInterface.ts`,
`routes/sispag.ts` (+ testes).

- `IncluirTituloInput.mover?: boolean`; `POST /sispag/lotes/:id/itens` aceita `mover` no body (Zod).
- Com `mover=true` e o título num OUTRO lote RASCUNHO: na MESMA transação/lock do título, remove o
  item da origem (só se a origem ainda for RASCUNHO, senão `LoteEstadoInvalidoError`), descarta as
  alertas vivas do item na origem, marca a origem manual, bumpa a versão da origem, inclui no
  destino e **cancela a origem se ficou vazia**. Todas as validações do incluir seguem (RASCUNHO no
  destino, mesma filial, bloqueio de duplicidade, re-leitura Conexos).
- Sem `mover`, título em outro RASCUNHO segue `TituloEmOutroLoteError` (I3 intacta).
- Título em lote FINALIZADO / REMESSA_GERADA → `TitleInCommittedBatchError` (409), com ou sem
  `mover` (fecha a extensão de I3 a lotes comprometidos que a regra já descrevia).

Aceite: testes de serviço para mover (origem automática → manual; origem vazia → cancelada; origem
saiu de RASCUNHO → erro, nada incluído), recusa sem `mover`, recusa em lote comprometido; rota
repassa `mover`.

## T3 — Painel: título em lote comprometido

Arquivos: `SispagPainelService.ts`, `LotePagamentoRepository.ts`, `SispagInterface.ts`.

- `TituloAPagar.loteComprometido?: { id, status }` para títulos em lote FINALIZADO/REMESSA_GERADA.

Aceite: teste do painel projeta o campo.

## T4 — Frontend: seleção inclui títulos em RASCUNHO; confirmação de mover

Arquivos: `app/sispag/components/MoverParaLoteDialog.tsx` (novo), `useCriarLoteManual.ts` (novo,
hook com a orquestração), `moverParaLote.ts` (puro, testado), `lib/sispag.ts`, `page.tsx` (mínimo).

- Checkbox habilitado para título livre ou em lote RASCUNHO; desabilitado com explicação para lote
  comprometido.
- "Criar lote" com algum selecionado em lote RASCUNHO abre a confirmação: por lote de origem, os
  títulos que saem, se o lote vira manual ou se fica vazio e é cancelado. Confirmar cria o lote e
  inclui com `mover: true` só os títulos que estavam em lote quando a analista confirmou.
- "Retirar do lote" por título continua (barato, já existe).

Aceite: testes puros do agrupamento da confirmação; typecheck/lint/test verdes.

## T5 — Ontologia/ADR

ADR-0064; `business-rules/nao-duplicacao-titulo-lote.md` (mover + comprometido), regra de formação
na action/ADR-0018 emendada; CHANGELOG da ontologia; `_coverage.json` versão.

## T6 — Revisão pós-QA (2026-10-06)

- Formação: sem `MAX_TITULOS_POR_LOTE`; grupo filial × dia → no máx. dois lotes (boletos / resto).
  Aceite: 60 títulos (58 boletos) → 2 lotes de 58 e 2; 10 mistos → 2 lotes; só boletos → 1 lote.
- `rotuloVencimentoLote` (puro, testado) no cabeçalho do LoteCard RASCUNHO e na confirmação de mover.
- Checkbox "selecionar todos" no cabeçalho da aba de títulos (`selecionarTodos.ts`, puro, testado):
  todas as páginas do filtro, pula lote comprometido, indeterminado, desabilitado com mais de uma
  filial.
