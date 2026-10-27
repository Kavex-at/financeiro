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

---

# Medições do TDD (Task 1), 2026-10-20

> Job: `src/backend/jobs/probe-hml-boleto-agrupado-tdd.ts` (fases `marcadorLer`, `marcador`, `baixas`,
> `v2`, `lote`, `importar`, `v5`, `v3`, `retornoLinha`, `estado`). Só HML (`columbiatrading-hml`,
> `HML_ENV_FILE`, usuário MPS_FRANCINEI), `databaseConnectionString=""`, barras sintéticas
> (`CodigoBarrasSintetico`), código mascarado 5+4 e `splitCodBar` redigido na trilha. Escritas em HML
> sob a autorização do maintainer de 2026-10-20 (tasks, "Respostas do maintainer").
>
> Grupo de teste: DHL GLOBAL FORWARDING (`pesCod 1147`), filial 2, títulos **566/1** e **577/1**
> (R$ 341,00 cada, total **R$ 682,00**), conta Itaú `gerNum 38`, lote nativo **flp 51** (débito 22/10/2026).

## T1 — Marcador de correlação (G2): `borEspNrbanco` serve

- O cabeçalho do `fin010` (40 chaves no `GET fin010/{fil}/{bor}` e na linha do `fin010/list`) **não tem
  campo de observação** (`borEspObs`/`borDesObs` não existem). O único texto livre do cabeçalho é
  **`borEspNrbanco`** ("nº banco"); nas baixas existe `bxaEspComplemento` (por baixa, não serve para achar
  o borderô antes das baixas).
- `POST fin010 {filCod 2, borVldTipo 2, borVldFinalizado 0, frontModelName 'bordero', borDtaMvto 22/10, gerNum 38, borEspNrbanco}`:
  - `"gb-tdd-1020-a"` ⇒ `400 VALIDATION borEspNrbanco constraint not_in_uppercase` (nada criado). **Só maiúsculas.**
  - `"GB-TDD-1020-A"` ⇒ 200, `borCod 253`, eco `borEspNrbanco "GB-TDD-1020-A"`.
  - Tamanho: 16, 18, 20, 25, 30, 40, 50 e 100 caracteres ⇒ `400 higher_than_max_size` (nada criado);
    **15 ⇒ 200** (`borCod 254`, `"GB-LEN15-XXXXXX"`). **Máximo = 15 caracteres.**
- Releitura `GET fin010/2/253` ⇒ `borEspNrbanco "GB-TDD-1020-A"` (igual, sem trim/alteração).
- **Filtrável:** `fin010/list` com `{"borEspNrbanco#EQ": "GB-TDD-1020-A"}` ⇒ `count 1` (só o 253); com
  `#LIKE "%GB-TDD-1020-A%"` ⇒ `count 1`; `fieldList [borCod, borEspNrbanco, gerNum, borVldFinalizado]` aceito.
- O campo **não** vem na linha de `borderosPendentes/list` (eco: `filCod, borVldTipo, borDtaMvto, borCod,
  gerNum, pesCodCont, pesCod, dpeNomPessoa, vlrPrincipal, vlrTotal, juros, desconto, itemy`).
- **Consequência para a I21s/Task 7:** o marcador cabe em 15 caracteres maiúsculos (ex.: `SPG` + id da
  execução em base 36). Risco a registrar: `borEspNrbanco` tem semântica nativa de "nº do banco"; nada
  em HML o usa no `.REM`/retorno, mas não foi gerada remessa com ele preenchido.

## T2 — `borCod` é REUTILIZADO depois do `excluirBordero` (novo, crítico para I21s)

O borderô 254 foi excluído; o `POST fin010` seguinte devolveu **253**. Depois de excluir o 253, os dois
`POST` seguintes devolveram **253 de novo** (marcadores `GB-TDD-1020-C` e `GB-TDD-1020-D`). O ERP numera
por `max(borCod)+1` da filial: um `borCod` guardado no write-ahead pode, depois de uma limpeza (nossa ou
da analista), apontar para **outro** borderô. Reconhecer "o nosso borderô" só pelo `borCod` é inseguro;
a identidade tem de ser `borCod` **e** marcador (`borEspNrbanco`) conferido na releitura.

## T3 — `GET` de borderô inexistente responde 500, não 404

`GET fin010/2/253` (e 254) depois da exclusão ⇒ **`500 {type: RECORDNOTFOUND, "Not Found: FinBordero (borCod: 253, borVldTipo: 2, filCod: 2)"}`**.
`ConexosBaixaClient.getBordero` só trata 404 como ausência (lança `ConexosError` nos outros): a releitura
de ausência da I21q/I21s precisa reconhecer `RECORDNOTFOUND` (ou usar `fin010/list borCod#EQ` ⇒ 0 linhas,
que também foi observado).

## T4 — V2: título com baixa em borderô em cadastro

| Leitura | Antes da baixa | Com baixa no borderô 253 (em cadastro) | Depois da limpeza |
|---|---|---|---|
| `fin064` 566/1 e 577/1 | `totalAberto 341`, `vldPago 0`, `vldPendente 0` | **igual** (`totalAberto 341`, `vldPago 0`, `vldPendente 0`) | igual |
| `fin015 titulosPendentes/list/2/4/51` (`docCod#EQ`) | presente | **AUSENTE** (controle 571/1 e 553/1 presentes) | **presente de novo** |

- A carteira (`fin064`, de onde vem `TituloAPagar`) continua mostrando os títulos **em aberto**; o grid do
  `fin015` os **esconde**. O caminho normal 1:1 (`RemessaService` relê o grid) cairia em "não está mais
  elegível" se um título de grupo fosse para `importarTitulos`.
- **`importarTitulos` avulso com a linha "velha"** (capturada antes da baixa, + `filCodLote/bncCod/flpCod`,
  `itsVldModalidade 7`, `op 1`): o ERP perguntou `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO`
  (respondida YES no HML) e **ACEITOU**: `SUCESSO`, item seq 1 `566/1` modalidade 6 valor 341 no lote 51,
  com a baixa do mesmo título ainda no borderô 253. Item removido em seguida (`DELETE` 200, ausente na
  releitura). **O `importar` não revalida a baixa em borderô:** a proteção contra pagar duas vezes é só o
  grid. Sem a pergunta respondida, a mesma linha falha antes (`SELECTION_ERROR` sem `bncCod/filCodLote/flpCod`;
  com eles, a pergunta FIN_041 que o client de produção não auto-responde).
- Nota para a analista: título com baixa num borderô em cadastro some do grid de pendentes do SISPAG mas
  segue "em aberto" no contas a pagar.

## T5 — V5: modalidade do item de borderô

Item do borderô 253 no lote 51 (nasce modalidade 4, valor 682):

| Barra sintética | Modalidade | `validarCodigoBarras` | `confirmarCodigoBarras` | `PUT finItemSispag` | Item relido |
|---|---|---|---|---|---|
| banco **341** (= conta) `34191…8200` | **6** | OK (`barraVlrPgto 682`) | OK (`itsBncNumCodbancoResult 341`, ITAÚ) | **OK** | modalidade **6**, banco 341, pgto 682 |
| banco 341 | 7 | OK | **`400 FIN_015.TITULO_DEVE_SER_MODALIDADE_TITULO_PROPRIO`** | — | inalterado (6) |
| banco 422 `42293…` | 6 | OK | **`400 FIN_015.TITULO_NAO_PERTENCE_AO_BANCO_EM_USO`** | — | inalterado (6) |
| banco 422 (provado em 2026-10-19) | 7 | OK | OK | OK | modalidade 7 |

**"Título próprio" = 6** confirmado (PI-4/I21o). A recusa da combinação errada vem no `confirmarCodigoBarras`,
antes de qualquer escrita no item. Não foi finalizado lote com a modalidade 6 (a finalização impediria a V3).

## T6 — V3: ordem da limpeza e o `vldHasRemessaPgto`

Ciclo 1 (borderô 253 `GB-TDD-1020-A`, 2 baixas, importado como item seq 1 do lote 51, com barra 341/6):

1. `DELETE fin010/baixas/253/2/566/1/1` **com o item presente** ⇒ **`400 FIN_014.FIN_HAS_REMESSA_PGTO`** (nada mudou).
2. `DELETE fin010/253` **com o item presente** ⇒ **`400 FIN_014.FIN_HAS_REMESSA_PGTO`**.
3. `DELETE fin015/finItemSispag/4/51/1/2/2` ⇒ 200; releitura: item **ausente**; o borderô **volta** aos
   `borderosPendentes` do lote 51.
4. `excluirBaixa` 566/1 e 577/1 ⇒ 200; `excluirBordero 253` ⇒ 200; releitura: `GET` 500 `RECORDNOTFOUND`,
   `fin010/list borCod#EQ 253` ⇒ 0. Títulos de volta ao grid de pendentes.

Ciclo 2 (borderô 253 `GB-TDD-1020-C`, mesmo grupo), lendo a flag a cada passo:

| Momento | `vldHasRemessaPgto` |
|---|---|
| borderô com 2 baixas, fora de lote | **0** |
| logo depois do `borderosPendentes/importar` (lote 51 em rascunho, sem remessa) | **1** |
| depois do `DELETE` do item | **0** |

**A ordem I21q está confirmada** (`DELETE` do item → ausência → `excluirBaixa` × N → `excluirBordero` →
ausência), e o ERP **impõe** essa ordem (`FIN_HAS_REMESSA_PGTO`). O `DELETE` do item voltou 200 com o item
de fato ausente nas duas vezes.

**Mas o H9 estava errado:** `vldHasRemessaPgto` vira 1 no **import** para um lote (não na geração do `.REM`)
e volta a 0 quando o item sai do lote. Ele significa "está num lote do SISPAG", não "já foi para o banco".

## T7 — G4: linha de detalhe do `fin052` para item de borderô (gar 7, só leitura)

Arquivo `PG191081B.RET` (fil 2, bnc 4, gtb 1, gar 7, processado, 0 erros). Varridos os 52 eventos do banco
4 (`fbeEspCod#EQ` um a um): **uma única linha**, no evento `00`:

```json
{"filCod":2,"bncCod":4,"flpCod":48,"itsCodSeq":1,"gtbCodSeq":1,"garCodSeq":7,
 "fbeEspCod":"00","fbeEspDescricao":"PAGAMENTO EFETUADO","fbeVldTipo":2,
 "ardDtaEvento":1792431647000,"ardCodSeq":1,
 "borVldTipo":2,"borCod":252,"borDtaMvto":1792454400000,"borVldFinalizado":1,
 "ardEspObs":"BORDERO: 252 - DATA DE CREDITO: 20/10/2026"}
```

- **Uma linha (o J)**, não uma por baixa. Sem `docTip/docCod/titCod`, sem `bxaCodSeq`, sem `pesCod`/
  `dpeNomPessoa`, sem `itsMnyVlrPgto`, sem `gerNum`.
- Chave para a Task 18: `filCod + bncCod + flpCod + itsCodSeq` (o item nativo) e/ou `borCod` (+ `borVldTipo 2`);
  os N títulos vêm do grupo (local) e a confirmação de pagamento de cada um, do `fin064` (I21r). O valor
  pago não vem na linha: conferir pelo item/borderô.

## Estado deixado em HML (2026-10-20)

- Borderôs de teste **253** (três encarnações: `GB-TDD-1020-A`, `-C`, `-D`) e **254** (`GB-LEN15-XXXXXX`):
  **todos excluídos** (ausência observada no `GET` e no `fin010/list`). O próximo `POST fin010` da filial 2
  deve voltar a devolver 253.
- Títulos **566/1** e **577/1** (DHL, fil 2): em aberto, sem baixa, de volta ao grid de pendentes.
- Lote nativo **flp 51** (fil 2, bnc 4, débito 22/10/2026): **rascunho vazio** (a API não apaga rascunho; o
  mesmo vale para o flp 37). Nenhum lote finalizado, nenhuma remessa nem retorno gerados nesta rodada.
- Inalterados da rodada anterior: borderô 252 finalizado, flp 48, gar 6/7, `fin146` bagCod 1 cancelado.

## O que contradiz a ontologia v0.48.0 (voltar ao maintainer / OntologyCurator)

1. **I21q (guarda `vldHasRemessaPgto = 0`) e H9/linha 8 do `conexos.md`.** A flag é 1 desde o `importar`
   (T6). Lida antes do `DELETE` do item, a guarda bloquearia toda limpeza de borderô importado; lida depois,
   é sempre 0 enquanto o lote não foi finalizado. O sinal de "já foi para o banco" tem de ser o **lote
   nativo** (finalizado / `.REM` gerado), não a flag. O parágrafo "depois de um J rejeitado o borderô fica
   com `vldHasRemessaPgto = 1`" vale só enquanto o item continua no lote rejeitado.
2. **I21s (reconhecer pelo `borCod` do write-ahead).** O `borCod` é reutilizado (T2): `borCod` sozinho pode
   adotar o borderô de outra pessoa. A releitura precisa conferir o marcador `borEspNrbanco` também quando
   o `borCod` é conhecido.
3. **I21l/I21n (sem contradição, só confirmação):** o marcador cabe no `POST fin010`, desde que ≤ 15 e
   maiúsculo; a I21n segue igual (o marcador não aparece em `borderosPendentes`, a correlação ali é pelo `borCod`).
4. **Não contradiz, mas reforça I21k:** o `importarTitulos` aceita título com baixa em borderô em cadastro
   quando recebe a linha (T4). A garantia de não pagar duas vezes é nossa (I21k + grid relido), não do ERP.

> **Decidido pelo maintainer em 2026-10-21** (emenda da ADR-0077, ontologia 0.48.0 emendada no lugar): guarda
> da limpeza = lote nativo (não finalizado e sem `.REM`, lido ao vivo), `vldHasRemessaPgto` deixa de ser guarda;
> identidade = `filCod` + `borCod` + `borTimCad`, **sem** marcador (o item 2 acima, "conferir o marcador", foi
> substituído pelo `borTimCad`; nada é escrito em `borEspNrbanco`); ausência = `fin010/list borCod#EQ` vazio;
> G6 = sem sugestão.

## T8 — Identidade do borderô sem marcador: `borTimCad` + `usnCodCad` (2026-10-21, só leitura)

> HML (`columbiatrading-hml`, `HML_ENV_FILE`), **só leitura**. `FASE=marcadorLer BOR=252` do
> `probe-hml-boleto-agrupado-tdd.ts` + consultas avulsas a `fin010/list` (script descartável, não versionado).

- Cabeçalho do `fin010` (40 chaves) tem dois campos de auditoria gravados pelo ERP: `usnCodCad` (usuário que
  criou; 97 = MPS_FRANCINEI em HML) e `borTimCad` (instante de criação, epoch ms com precisão de segundo).
- Borderô 252: `borTimCad 1792431474000` (19/10 17:37:54Z) e `borDtaFinalizado 1792431647000` (17:40:47Z): o
  `borTimCad` manteve o valor da criação depois das baixas, do `importar` e da finalização pelo retorno.
- Filtros de `fin010/list` (filial 2):

| Filtro | Resultado |
|---|---|
| `usnCodCad#EQ 97` | 200, count 11 |
| `borTimCad#EQ 1792431474000` | 200, count 1 (só o 252) |
| `borTimCad#GE t−60000` + `#LE t+60000` (epoch ms) | 200, count 1 (só o 252) |
| `borTimCad#GE/#LE` em ISO-8601 | 500 `Value … of ENUM ECnxDataType can't be converted to java.util.Date` |
| `borTimCad#GTE/#LTE` · `#BETWEEN [a,b]` | 500 |
| `usnCodCad#EQ 97` + `borTimCad#GE (t − 1 dia)` | 200, count 2 (251 e 252) |

**Conclusão:** identidade = `filCod` + `borCod` + `borTimCad` (o `borCod` reusado ganha outro `borTimCad`);
busca da resposta perdida por janela `#GE/#LE` em epoch ms com `usnCodCad`. Base da emenda de 2026-10-21.

## T9 — Como o `fin010` representa um borderô cancelado (2026-10-21, só leitura)

> HML (`columbiatrading-hml`, `HML_ENV_FILE`), **só leitura**. `FASE=marcadorLer BOR=15|244|252|250|43|85|223|48`
> e a fase nova `FASE=situacaoBorderos FIL=1|2` do `probe-hml-boleto-agrupado-tdd.ts` (varre o `fin010/list`
> tipo 2 da filial e conta as combinações). Pergunta da T13: `BorderoIdentificado` não tinha campo para
> "borderô antigo cancelado" (I21s: antigo ausente **ou cancelado** ⇒ cria um novo).

Contagem de 269 borderôs tipo 2 (fil 2: 230; fil 1: 39) por `borVldFinalizado` × presença dos campos:

| `borVldFinalizado` | `borCodEstornado` | `borCodNovo` | `borDtaStatus`/`usnCodSta` | lote contábil de estorno (`botLotCodEstorno`) | `borDtaFinalizado` | fil 2 | fil 1 |
|---|---|---|---|---|---|---|---|
| 0 | — | — | — | — | — | 6 | 8 |
| 0 | sim | — | — | — | — | 1 (250 ← 248) | 0 |
| 1 | — | — | — / sim | — | sim | 161 | 22 |
| 1 | sim | — | — | — | sim | 2 (223 ← 222, 44 ← 43) | 1 |
| **2** | — / sim | — | **sim** | **sim** | sim | **50** (ex.: 15, 16, 244, 245, 48) | 6 |
| **3** | — / sim | **sim** | sim | sim | sim | **10** (ex.: 43 → 44, 85 → 86) | 2 |

Leitura dos campos (exemplos):

- **`borVldFinalizado = 2` = CANCELADO.** Borderô 244: `borDtaFinalizado` = `borTimCad`, `borDtaStatus 1767857714000`
  com `usnCodSta 97` (quem/quando mudou o status), `botLotCodEstorno 2` + `borLotDtaDataEstorno` (lote contábil que
  estornou a contabilização), `borCodNovo` nulo, `vldHasBaixa 1` (as baixas continuam listadas, sem efeito).
  Bate com o que Permutas já usa desde a Fase 3.1 (`BorderoGestaoService.situacaoDoItem`,
  `ReconciliacaoPermutaService.borderoAindaValido`: "2 = CANCELADO ⇒ a baixa é nula, libera relançamento").
- **`borVldFinalizado = 3` = ESTORNADO, sempre com `borCodNovo`.** Borderô 43: `borCodNovo 44`; o 44 está com
  `borVldFinalizado 1` e `borCodEstornado 43`. O estorno **cria um borderô novo** que herda as baixas; o antigo
  fica 3. Logo `borCodEstornado` não marca "este foi estornado": marca "este nasceu do estorno daquele" (o 250 está
  em cadastro com `borCodEstornado 248`). Nota lateral (fora do escopo, para o maintainer): Permutas trata `borCodEstornado != null` como
  ESTORNADO (`BorderoGestaoService.situacaoDoItem`) e como "baixa nula, libera relançamento"
  (`ReconciliacaoPermutaService.borderoAindaValido`), mas o campo marca o borderô **novo**, que herdou as baixas e
  está vivo (44: finalizado). Se essa leitura liberar o relançamento de uma permuta cujo borderô foi estornado e
  refeito, há risco de baixa em dobro. Não verificado além da leitura do código; vale um `/investigate`.
- Nenhum borderô com `borCodNovo` fora do 3, nem com `borVldFinalizado` fora de 0–3, nas duas filiais.

**Decisão aplicada na T14 (sem regra nova, só a representação):**

- `BorderoIdentificado.situacao` (`SITUACAO_BORDERO`: `em_cadastro`, `finalizado`, `cancelado`, `estornado`,
  `indeterminado`), derivada no client (`ConexosBaixaClient`, pela lib pura `SituacaoBorderoFin010`) de
  `borVldFinalizado` × `borCodNovo`: 0/1/2 só com `borCodNovo` nulo; 3 só com `borCodNovo`; qualquer outra
  combinação (ausente, desconhecida) ⇒ `indeterminado` (fail-closed). Campos `borCodEstornado`/`borCodNovo` expostos.
- Depois de J rejeitado (I21s): antigo `cancelado` ⇒ conta como resolvido, cria um novo sem tocar no antigo;
  `estornado` ⇒ **não** é resolvido (as baixas do grupo seguem vivas no `borCodNovo`; criar outro pagaria duas
  vezes) ⇒ retirada `BORDERO_ANTERIOR_NAO_RESOLVIDO` + `Alerta`, como o `finalizado`; `indeterminado` ⇒ execução
  `indeterminado` + `Alerta`, nada escrito.
- Nosso borderô (retomada/limpeza) fora de `em_cadastro` ⇒ `indeterminado` na preparação e `pendente` na limpeza.

A medição do "cancelado" é conclusiva (os quatro valores têm leitura consistente nos 269 borderôs e com o código
de Permutas; o que não se reconhece cai em `indeterminado`). O que **não** está na regra é o **estornado**: a I21s
fala só de "ausente ou cancelado". Tratá-lo como "não resolvido" é o lado seguro, aplicado e aberto como **G8**
nos "Questions / gaps" do tasks para o maintainer confirmar.

## Task 21 — prova ponta a ponta com o serviço de produção (PENDENTE DE RODADA)

Job: `src/backend/jobs/probe-hml-boleto-agrupado-e2e.ts`. **Nada foi executado em HML ainda.** Preencher por rodada (a trilha fica em `${PROBE_OUT}/trilha.jsonl`, barras só mascaradas 5+4):

| Fase | Data da autorização | Títulos | Resultado (checagens OK/total) | Estado deixado em HML |
|------|---------------------|---------|--------------------------------|-----------------------|
| plano | — | — | — | nada (só leitura) |
| canonico | 2026-10-26 | 833/1 (R$ 100,00) + 834/1 (R$ 150,00), ZEFERINO (221), boleto sintético R$ 250,00 venc. 30/10 | **6/6 OK** | lote nativo finalizado + `.REM` com UM J (barra == pagamento == Σ = 25000 centavos) + retorno `00` sem J-52 processado; borderô **253** finalizado pelo ERP; 833/1 e 834/1 `vldPago 1`; grupo `PAGO`. NÃO reversível |
| falha (V3) | 2026-10-26 | 838/1 (R$ 150,00) + 839/1 (R$ 100,00), ZEFERINO (221), boleto sintético R$ 250,00 venc. 30/10, barra do banco 329 | **4/4 OK** | `confirmaCodigoBarras` recusou (`FIN_015.BANCO_NAO_CADASTRADO`, 329) depois do import; guarda retirou o grupo (`GRUPO_BOLETO_FALHOU`, `BoletoLoteEsvaziadoPorCodigoError`); item, 2 baixas e borderô **254** excluídos e ausentes na releitura do `fin010`; lote nativo **56** ficou em rascunho vazio; 838/1 e 839/1 em aberto. Banco local: grupo `CONFIRMADO`, execução `limpo`, eventos CONFIRMADO → BORDERO_PREPARADO → RETIRADO → BORDERO_LIMPO, marcas `GRUPO_BOLETO` ATIVO. Trilha em `/tmp/hml-boleto-agrupado-e2e/falha/` |
| retomada (1ª rodada, inválida) | 2026-10-26 | 840/1 (R$ 150,00) + 841/1 (R$ 100,00), ZEFERINO (221), boleto sintético R$ 250,00 venc. 30/10 | **1/4, abortada (bug do job)** | 1ª tentativa OK (`POST fin010` valeu, resposta descartada, `GroupBorderoIncompleteError`). Na retomada: "usuário do robô desconhecido: não dá para procurar o borderô pela janela" ⇒ execução `indeterminado` + alerta, **nenhum segundo borderô** (falha fechada correta). Causa: o job chamava `gerarRemessa` FORA de `conexosRequestContext`, então o `usnCod` nunca foi capturado (`conexos_usn_cod` NULL); o servidor sempre roda dentro da request (`http/conexosIdentity.ts`). Corrigido no job (`gerarRemessaComoRequest`). Resíduo: lote nativo **57** em rascunho; um borderô do robô em cadastro sem baixas (gerNum 38, `borDtaMvto` 30/10; `borCod` não registrado porque a resposta foi descartada de propósito); grupo local `165072ac…` indeterminado; 840/841 em aberto em HML |
| retomada (2ª rodada, achou bug) | 2026-10-26 | 836/1 (R$ 150,00) + 844/1 (R$ 100,00), ZEFERINO (221), boleto sintético R$ 250,00 venc. 30/10 | **1/4, abortada — BUG DE PRODUTO** | Com o contexto de request, o `usnCodCad` 97 foi capturado e a janela estreita rodou, mas voltou vazia: **o ERP carimba `borTimCad` com a hora de parede de Brasília codificada como UTC** (borderô 255 criado às 22:52:51Z, `borTimCad` 19:52:52Z = −3 h) e a janela usava o relógio real ⇒ erro de 3 h, toda retomada cairia em `indeterminado`. A varredura ±24 h (F-ft-1) achou 254 e 255 e falhou fechada (nenhum segundo borderô). Correção: `BankingCalendar.toErpInstant` nas duas janelas. Resíduo: lote nativo **58** em rascunho; borderô **255** em cadastro sem baixas; borderô **254** (da 1ª rodada, `borCod` reaproveitado) em cadastro sem baixas; grupo local `edaba90d…` indeterminado; 836/844 em aberto mas consumidos para a prova |
| retomada (3ª rodada, válida) | 2026-10-27 | 846/1 (R$ 150,00) + 845/1 (R$ 100,00), ZEFERINO (221), boleto sintético R$ 250,00, débito 27/10 | **4/4 OK** | 1ª tentativa parou de forma retomável (`GroupBorderoIncompleteError`, `POST fin010` valeu, resposta descartada); a retomada achou o borderô **256** pela janela estreita `borTimCad` (usnCodCad 97, gerNum 38, `toErpInstant`), **1 `POST fin010`**, 1 borderô vivo, remessa `gerada`. Residue: lote nativo **59** finalizado com `PG271001.REM`, borderô **256** com as 2 baixas e o item importado; 845/846 consumidos para a prova (em aberto no ERP, presos a lote/grupo locais). Log `/tmp/hml-boleto-agrupado-e2e-retomada-3.log` |
| v7 (1ª rodada, INVÁLIDA — bug do probe) | 2026-10-27 | 847/1 (R$ 100,00) + 848/1 (R$ 150,00), ZEFERINO (221), boleto sintético R$ 250,00 venc. 05/11, débito 27/10 | **2/4, abortada (FATAL)** | `remessa gerada` OK (borderô **257**, lote nativo **60**, `PG271002.REM` com 1 J). O retorno sintético usou a ocorrência **`AE`**, que o ERP descreve como "DATA DE PAGAMENTO ALTERADA" (informativo, `fbeVldTpret` ≠ 2): não é rejeição ⇒ grupo ficou `EM_REMESSA`, sem Alerta; depois o job caiu ao criar o 2º lote (847/1 está no lote `b3fe004d` com remessa gerada). **A V7 NÃO foi provada.** Residue: lote nativo 60 finalizado + `PG271002.REM`; borderô 257 em cadastro (2 baixas, item importado); retorno garCodSeq **9** carregado e processado só com `AE` (nenhuma baixa esperada: não há `00`); 847/848 consumidos; banco local: lote `b3fe004d` REMESSA_GERADA, lote `c363011a` rascunho vazio, grupo `ef66bdcc` CONFIRMADO. Log `/tmp/hml-boleto-agrupado-e2e-v7.log` |
| v7 (2ª rodada) | — | — | — | pendente: títulos novos; o probe agora lê `fin050` e escolhe um código `tipo 2` + `tpret 2` |

Premissas a confirmar na 1ª rodada: `POS_OC`/código de rejeição do `.RET`, colunas lidas direto no banco local, campos do ledger.


### Achados da rodada de 2026-10-26

- **Defeito achado só pela prova ponta a ponta:** `SituacaoPagamentoResolver.regraBoletoSemDda` tratava título de grupo confirmado (`EM_GRUPO`) como "boleto sem DDA", e o `finalizarLote` recusava o lote do grupo (`BatchHasBlockedItemsError`: "Boleto sem DDA, sem boleto DDA associado"). Corrigido com RED primeiro (3 testes, um por modo de vínculo); `EM_GRUPO` não é bloqueio, o grupo é conferido na remessa. Os testes unitários das Tasks 9 a 18 não pegaram porque nenhum rodava resolver + finalização juntos.
- **Título vencido bloqueia** (`Vencido, venceu há N dias`): os títulos de teste precisam de vencimento de hoje em diante. Títulos antigos da MULTILOG ficaram presos a lotes do Bradesco de 2025 e a renegociação `fin070` não finaliza (`O TÍTULO A RENEGOCIAR ESTÁ ASSOCIADO AO LOTE DE PAGAMENTO 13/14`); o item do `fin015` desses lotes não aparece na listagem, então não há como prever.
- **Rastro em HML (renegociação 9, MULTILOG S/A, em cadastro, não cancelável):** 633/1 a 636/1 com composição para 30/10. Cancelar exige renegociação finalizada.
- **Criação de título de teste pela tela (`com298`):** processo 46, tipo `RECIBO/BOLETO/FATURA/GUIA - OPERACAO - PROV. CTB`, plano `FORNECEDOR NACIONAIS`, armazém `10`, item (conta `ASSESSORIA E CONSULTORIA`), arquivo no GED, título com `Pago Por = BOLETO`, e aprovação no `fin103` (bloqueio 19).


### Achados 2026-10-27

- **Prova da correção do `borTimCad`:** a retomada (`FASE=retomada`, 846/1 + 845/1) passou **4/4**. A janela estreita
  (`borTimCad#GE 1793100520615`, `#LE 1793100761145`, em `toErpInstant`) achou o borderô **256** com 1 `POST fin010`, sem
  cair na varredura. A correção `BankingCalendar.toErpInstant` (cea3dc9c) está **provada em HML**. A varredura ±24 h
  (`retomada-varredura`) segue sem rodada válida depois da correção.
- **Liberação dos títulos de teste:** 845 a 848 nasceram bloqueados na regra 19 (`fin103`); aprovados com `FBA=3`
  (`probe-hml-renegociacao-fin070.ts FASE=liberar`), `fin064.vldLib 1`.
- **Rodada v7 inválida por bug do probe:** `OCORRENCIA_REJEICAO` tinha default `AE`. No Itaú, `AE` = "DATA DE PAGAMENTO
  ALTERADA" (`tpret ≠ 2`); o ERP leu a posição 231 corretamente (`retorno_evento AE`, `rejeitado f`, `SEM_RETORNO`).
  Itaú: 52 códigos, só `00` é pago e 7 rejeitam (`tpret 2`). O produto não tem bug de classificação.
- **Correções (2026-10-27):** o probe agora lê `fin050` (só leitura) ANTES de escrever e escolhe um código com `tipo 2` e
  `tpret 2` (ou valida `OCORRENCIA_REJEICAO`, recusando o que não for rejeição); o código e a descrição vão para a trilha.
  `ConciliacaoRetornoService` passou a contar `pagos` só com `tipoRetorno === 1` (evento informativo não é pago nem
  rejeitado). A fixture de teste de `SincronizacaoLoteService` deixou de chamar `AE` de rejeição (agora `XR`, sintético).
- **Efeito colateral a lembrar:** `pagos` é só informativo (toast do SISPAG, `conciliacao_execucao`, atividade do usuário);
  nenhuma decisão de estado de lote depende dele.
