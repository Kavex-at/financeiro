# SISPAG — boleto agrupado (1 boleto → N títulos): ponta a ponta PROVADO em HML (2026-10-19)

> Pergunta do maintainer: a analista hoje paga à mão o boleto que agrupa vários títulos e baixa cada
> título (a soma tem que bater). Deixar fora do SISPAG não é opção. Desenho proposto: pagar o boleto
> sem associar a título, guardar o grupo e, no retorno, baixar cada título do grupo.
>
> **Resposta: o Conexos já faz isso nativamente, pelo BORDERÔ do `fin010`.** Um borderô EM CADASTRO
> com uma baixa por título vira UM item do lote SISPAG (sem `docCod/titCod`, com `borCod`); o código
> de barras vai nesse item; o `.REM` paga o boleto uma vez; o retorno finaliza o borderô e baixa os N
> títulos. Nenhum livro paralelo do nosso lado é necessário para a baixa.
>
> Job: `src/backend/jobs/probe-hml-boleto-agrupado.ts` (fases; só HML; barras sintéticas; usuário
> MPS_FRANCINEI). Medição dos casos em PRD: memória `boleto-agrupado-n1-e-1n-medicao`.

## Ciclo executado (filial 2, banco 4/Itaú)

Grupo: AR SOLUÇÕES (`pesCod 121`, credor que agrupa em PRD) — títulos **552/1** e **558/1**, R$ 1.173,47
cada, total **R$ 2.346,94**. Data de débito 20/10/2026.

| # | Passo | Chamada | Resultado |
|---|---|---|---|
| 1 | Borderô EM CADASTRO | `POST fin010` `{filCod, borVldTipo 2, borVldFinalizado 0, frontModelName 'bordero', borDtaMvto, gerNum 38}` | **borCod 252** |
| 2 | Uma baixa por título | `fin010/baixas/validacao/tituloBaixa` → `POST fin010/baixas` (`responseData` + chave + `gerNum`, juros/multa/desconto 0, `bxaVldCcorrente 0`, `bxaVldCorrenteDc 1`) | 2 baixas; `vlrTotalLiquido 2.346,94`; **títulos continuam em aberto** |
| 3 | Lote | `criarLote` (débito 20/10) | **flp 48** |
| 4 | Borderô aparece pendente | `fin015/finItemSispag/borderosPendentes/list/2/4/48` | `{borCod 252, pesCod 121, dpeNomPessoa AR…, vlrTotal 2346.94, itemy 0}` |
| 5 | Importar como item | `borderosPendentes/importar` `{items:[{...linha, filCodLote, bncCod, flpCod, itemy: 1}], op 1, bncCodFin015}` | item **seq 1, sem docCod/titCod, borCod 252**, valor 2.346,94, modalidade 4 |
| 6 | Código de barras (sintético, banco 422) | `validarCodigoBarras` → `confirmarCodigoBarras` → `PUT finItemSispag` com `itsVldModalidade 7` | item modalidade 7, barra `42291…4694`, pagamento 2.346,94 |
| 7 | Finalizar lote | `finalizarLote` | **OK** — a barra igual ao total do borderô passa |
| 8 | Remessa | `gerarRemessa` | `PG191081.REM`: **um J**, valor título 2.346,94 = **valor pagamento 2.346,94**, seu número `02 0004 0000048 0000001` |
| 9 | Retorno sintético `00` | `carregar` + `processar` (gar 7) | **552/1 e 558/1 `vldPago 1`, `totalAberto 0`; borderô 252 `borVldFinalizado 1`** (finalizado pelo retorno, com lote contábil) |

## Regras descobertas

1. **`fin146` (Baixa Agrupada) NÃO serve:** `finalizar` baixa os títulos na hora (borderô 251
   `borVldFinalizado 1`, títulos `vldPago 1`) e o borderô não fica pendente para o SISPAG. Desfeito com
   `POST fin146/cancelar/1` (títulos voltam a aberto). É a baixa "depois de pagar", não o pagamento.
2. **O borderô precisa estar na conta financeira (`gerNum`) da conta pagadora do lote.** Com `gerNum 37`
   (Itaú ag. 2000) o borderô não aparece nos pendentes do lote; com **`gerNum 38`** (Itaú ag. 0641 conta
   55.795-4) aparece. O filtro NÃO é a filial (borderô da filial 1 aparece em lote da filial 2).
   Mapear conta pagadora → `gerNum` por filial antes de produção.
3. **O favorecido é derivado das baixas** (`pesCod`/`dpeNomPessoa` do pendente): um borderô agrupado =
   um fornecedor. Grupo com fornecedores diferentes não cabe num borderô.
4. **`itemy: 1` é o "selecionado" do import.** Com `itemy 0` (como a lista devolve) o `importar` responde
   `SUCESSO` e **não importa nada**. Eco do DTO projetado: `vlrTotal, dpeNomPessoa, bncCod, borVldTipo,
   filCod, filCodLote, borCod, pesCod, pesCodCont, flpCod, itemy`.
5. **Modalidade:** o item do borderô nasce com modalidade 4. Barra do **mesmo banco** da conta (341)
   exige "título próprio" (`FIN_015.TITULO_DEVE_SER_MODALIDADE_TITULO_PROPRIO` com 7); barra de **outro
   banco** (422, como a PEDRONI) aceita 7.
6. **O valor de pagamento do J sai do borderô**, não de um título — o oposto do achado dos centavos
   (`sispag-centavos-hml-achados.md`, onde o J paga o aberto do título). Por isso aqui barra = pagamento.
7. **O parser do retorno trata item de borderô** (`ger015.gtbLngSql`: `BOR_COD` não nulo → confere
   `FIN_BORDERO` → `FIN_TITULO_RETBANCO` com `BOR_COD` → `PRC_BAIXA_RETORNO_PAGFOR('BAIXAR')`).
   Chave do J nas posições 183–202 (`fil(2) bnc(4) flp(7) its(7)`), ocorrência em 231.
8. **Artefato do `.RET` sintético:** devolver a linha **J-52** faz o `processar` falhar com "O ARQUIVO NÃO
   É UM ARQUIVO DO RETORNO GERADO PELO SISTEMA" (o J-52 não tem a chave em 183–202). Omitido (`SEM_J52=1`),
   processa. É limite do nosso sintético, não do fluxo; a primeira tentativa (gar 6) ficou carregada e
   não processada (atômico, nada gravado).
9. `vldHasRemessaPgto` do borderô vira 1 quando a remessa é gerada — sinal de "já foi para o banco".

## Estado deixado em HML

- `fin146` bagCod 1: CANCELADO (situação 2); borderô 251 é o rastro dele.
- Borderô **252** (fil 2): FINALIZADO pelo retorno; títulos **552/1 e 558/1 pagos** em HML.
- Lote **flp 48** (fil 2): finalizado, `PG191081.REM`; retornos gar 6 (não processado) e gar 7 (processado).

## Em aberto (antes de desenhar a feature)

- **Permissão do robô CLONEX em PRD:** `fin010` borderô/baixa (a Frente I já usa) e
  `borderosPendentes/importar` no `fin015` — conferir.
- **`.RET` real do Itaú com item de borderô:** confirmar em PRD (o primeiro boleto agrupado real).
- **Caso 2 (N boletos → 1 título, VIBE LOG):** o mesmo borderô aceita **baixa parcial**? Duas baixas
  parciais do mesmo título em dois borderôs, um por boleto, evitaria o `fin070` (que devolve à aprovação).
  Não testado.
- **Nossa camada:** lote local hoje é por título (`lote_pagamento_item` exige `doc_cod/tit_cod`); guarda
  I16, vínculo ADR-0071, sugestão ADR-0068 e conciliação do retorno precisam de um item "borderô".
- **Filial do borderô × filial do lote:** o item herdou `filCod 2` do borderô; testar grupo de títulos da
  filial 1 com lote da filial 2 (o caso INTERNACIONAL cruza filiais; invariante do retorno §4 de
  `sispag-fin052-retorno-provado-hml.md`).
