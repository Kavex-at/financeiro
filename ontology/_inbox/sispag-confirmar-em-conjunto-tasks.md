# sispag-confirmar-em-conjunto — tasks (ADR-0080, I15t)

## T1 — Regra pura de irmãos (`RegraIrmaosConjunto`)
- Dado o cenário (desfechos), a chave de origem, os títulos em lote local finalizado e o pool de
  boletos, devolve as linhas elegíveis pela I15t(1), a origem primeiro quando elegível, depois por
  vencimento e `docCod`.
- AC: mesmo `pesCod` **e** filial; só `UNICA_SEGURA`/`SO_ATENCAO` com candidato confirmável que tem
  `NUMERO_CONFIAVEL`; fora `exigeReconhecimento ≠ NENHUM`, `CONFIRMADA`, `EM_GRUPO`, lote finalizado
  (`FINALIZADO`/`REMESSA_GERADA`/`RETORNADO`), `AMBIGUA`, `DISPUTADA` etc.
- AC: avisos `FAIXA_AJUSTE_MANUAL` (Δvalor ≠ 0 e Δdias > 0) e `ESCOLHIDO_SO_PELO_NUMERO` (outro
  `codbar` no pool com mesma `emissorChave`, valor e vencimento); `ajusteAutomatico` quando
  0 < |Δ| ≤ R$ 0,05 no mesmo dia.

## T2 — `confirmar` aceita o contexto do conjunto
- `conjunto?: { id, origem, pesCod }`: exige ao vivo `NUMERO_CONFIAVEL`, `exigeReconhecimento =
  NENHUM`, mesmo `pesCod` e filial; senão `BoletoSuggestionNotAvailableError` com motivo pt-BR.
- AC: `DECISAO_CONFIRMADA.detalhe.conjunto = { id, tituloOrigem }`; com `conjunto` o ajuste de
  centavos **não** é agendado pelo `confirmar` (o conjunto agenda). Sem `conjunto`, nada muda.

## T3 — Fila sequencial do ajuste (`AjusteCentavosTituloService.agendarEmSequencia`)
- AC: um `ajustar` por título, um depois do outro; falha de um não impede os seguintes; uma
  retomada por filial no fim; nunca espera o ERP na resposta.

## T4 — `ConfirmacaoEmConjuntoService`
- `listarIrmaos(chave)`: do cache do cenário + lotes + pool.
- `confirmarEmConjunto({ origem, itens, ator })`: dedupe; > 30 ⇒ 422 sem confirmar nada; lote
  finalizado relido por linha; resultado por linha (`CONFIRMADA`/`JA_CONFIRMADA`/`RECUSADA`+motivo);
  erro inesperado de uma linha não para as outras (log `error`); um log `info` do conjunto.

## T5 — Rotas
- `GET /sispag/sugestoes-boleto/titulo/irmaos` (`sispag:ver`, no-store) e
  `POST /sispag/sugestoes-boleto/confirmar-em-conjunto` (`sispag:executar`, limiter), Zod estrito
  (ator no body = 400), 422 acima de 30.

## T6 — Frontend
- Seção "Outros títulos deste fornecedor com número confiável" na gaveta: checkbox por linha (nada
  marcado), título, nº doc, nº boleto, valores, Δ valor, Δ dias, avisos; teto de 30 marcados.
- Botão "Confirmar selecionados (n)" → diálogo de resumo (n, ajuste automático, ajuste manual no
  Conexos, escolhidos só pelo número) → resultado por linha; recarrega a gaveta e a lista.
- Só com `sispag:executar` aparecem as caixas e o botão.

## Gates
typecheck, lint, testes BE/FE, PatternGuardian, DesignSystemReviewer, Regis-Review, rebase, bump.
