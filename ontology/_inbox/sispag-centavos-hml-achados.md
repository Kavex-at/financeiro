# SISPAG — boleto com diferença de centavos: achados em HML (2026-10-19)

> Decisão do maintainer (2026-10-19): **o valor do boleto é o verdadeiro.** Boleto acima do título ⇒ a
> diferença é juros/tarifa; abaixo ⇒ desconto. A analista deve conseguir pagar sem bloqueio; fallback
> para diferença maior fica para discutir. Ajustar o **título** antes do vínculo é aceitável se o ERP
> permitir (permissão; o título volta para aprovação?). A Columbia revisa o caso NELSON em paralelo.

## Tamanho do problema (PRD, somente leitura, 2026-10-19)

1.056 títulos BOLETO (`forma_pagamento_conexos = 6`) ativos sem vínculo DDA. **126** só têm candidato a
1–5 centavos: **125 acima**, 1 abaixo. NELSON HEUSI = 119 (título R$ 462,49 × boleto R$ 462,50, mesmo
vencimento em 118/118; o valor do título não tem 3ª casa escondida). 103 dos 118 NELSON têm **um único**
boleto com o mesmo número de documento.

## Experimentos (job `src/backend/jobs/probe-hml-vinculo-centavos.ts`, filial 2, banco 4)

| Caso | Barra × aberto | Declaração no item | `finalizar` | J do `.REM` |
|---|---|---|---|---|
| A2 (flp 42) | +0,01 | `itsMnyRecbrac = 0,01` (persiste) | **recusa** ("VALOR DE PAGAMENTO MAIOR QUE O VALOR EM ABERTO") | — |
| B0 (flp 43) | −0,01 | nenhuma | aceita | barra 154,22, **pagamento 154,23** |
| B1 (flp 44) | −0,01 | `titMnyDesconto = 0,01` (não persiste) | aceita | barra 563,09, **pagamento 563,10** |
| B2 (flp 45) | −0,01 | `itsMnyValor = 199,99` (persiste) | aceita | barra 199,99, **pagamento 200,00** |

Somam-se aos de 2026-10-14 (`chore/sispag-hml-bind-experimentos`, #7/#9/#10): acima do aberto nenhum
campo do item destrava (`titMnyJuros`, `itsMnyOutros`, `itsMnyValor`, `titMnyLiquido`), e `PUT fin026`
é aceito mas não altera o valor do título.

`confirmaCodigoBarras` com juros/desconto ≠ 0 só soma/subtrai da barra (`barra + juros − desconto`): não
concilia com o título.

## Conclusões

1. **O valor de pagamento do J sai do TÍTULO, não do item.** Mesmo com `itsMnyVlrPgto` e `itsMnyValor` =
   barra, o `.REM` manda pagar o aberto do título. Boleto **abaixo** finaliza, mas o arquivo pede ao banco
   1 centavo **a mais** que o valor de face da barra (recusa ou pagamento divergente no banco).
2. **Nenhum ajuste no item resolve, em nenhuma direção.** O único caminho via SISPAG é o **título** ter
   aberto = valor do boleto antes do vínculo (a opção "ajustar o título" do maintainer).
3. **Rede de segurança ausente:** `RemessaCnabValidator` não compara o valor da barra (pos 10–19) com o
   valor de pagamento do J. Hoje o vínculo exige igualdade (I17b), então não há exposição; qualquer
   relaxamento precisa dessa guarda antes.

## Caminhos nativos para ajustar o título (levantados na spec, não testados)

- **Desconto (boleto abaixo):** `POST fin062` (`FinDesconto`: título, `dfcMnyValor`, `gerNum`, obs) cria
  solicitação; `fin063/aprovarDesconto` | `recusarDesconto` libera. `GET fin062/validacao/contaFinanceiraDesconto`
  sugere exigência de conta de desconto. HML filial 2 tem **0** solicitações: não observável sem escrever.
  A provar: o desconto aprovado reduz o `fin064.totalAberto` antes do pagamento? Quem aprova? Mexe na
  liberação (`titVld1/2/3libera`, `fin007/liberar`)?
- **Acréscimo (boleto acima, 125 de 126 casos):** **nenhum endpoint encontrado** para título a pagar.
  `FinTituloConfigAcoesDTO.ftsMnyAcrescimo` só aparece nas ações do `fin085` (cobrança/renegociação,
  aparentemente contas a receber). `fin064/eventos` é anotação de follow-up (sem campo de valor).
  **Pergunta para a Columbia/Conexos:** como o financeiro lança acréscimo num título a pagar hoje, pela tela?

## Teste do desconto nativo `fin062` (HML, 2026-10-19, `jobs/probe-hml-desconto-fin062.ts`)

Autorizado pelo maintainer. Títulos 640/1 (R$ 620,62) e 642/1 (R$ 1.146,24), filial 2, ambos a pagar
(`docTip = 2`), vencidos (dez/2025), liberados (`vldLib = 1` no `fin064`; não há registro `fin007`).

| Passo | Resultado |
|---|---|
| `GET fin062/validacao/contaFinanceiraDesconto/{doc}/{tit}/{docTip}` | `docTip 2` ⇒ `{"titCod":1}` (título existe; **não sugere conta**); `docTip 0/1/3` ⇒ `RECORDNOTFOUND` |
| `POST fin062` sem `gerNum`, obs minúscula | 400: `gerNum` **obrigatório**; `dfcEspObsSol` tem de ser **MAIÚSCULA** |
| `POST fin062` com `gerNum = 94`, obs maiúscula | 400: `docCod` **`Generic.NOT_VALID`** (640 e 642) — a conta passou, o título não |
| `fin062/list`, `fin063/list` (filial 2) | 0 registros: nenhum exemplo de solicitação aceita em HML |
| `ger036/planoContasFin/list` | 0 linhas (com `serviceName` `ger036` ou `fin062`): plano de contas não legível por esta via |

**Nada foi gravado**: as duas inserções foram recusadas na validação; `totalAberto` e `vldLib` iguais
antes e depois.

**Conclusão:** o `fin062` recusa estes títulos a pagar por regra de negócio não documentada na spec.
Hipóteses (não distinguíveis sem outra escrita): (a) a tela é só para contas a **receber** (desconto
concedido a cliente); (b) só aceita título **a vencer**; (c) só aceita título **não liberado**. HML não tem
título a pagar a vencer livre (o 637 foi consumido em 14/10); testar (b) exigiria `PUT
fin026/alteraDataVencimento` num título de HML — escrita diferente, pede OK próprio. **Pergunta para a
Columbia:** usam a tela de solicitação de desconto (fin062/fin063) em título a pagar? Em quais títulos?

### Hipótese (b) "só título a vencer" — testada e descartada (autorizado pelo maintainer)

- `PUT fin026/alteraDataVencimento` é endpoint de **seleção**: a row solta volta
  `SELECTION_ERROR / NENHUM_REGISTRO_SELECIONADO`; **`{ items: [row com titDtaVencimento novo] }`** é aceito.
- 640/1 movido de 10/12/2025 para **30/10/2026**: `titVld1/2/3Libera` e `vldLib` **continuaram 1** —
  alterar vencimento **não devolve o título à aprovação** (horários/usuários de liberação seguem nulos em HML).
- Com o título a vencer, `POST fin062` continua `docCod NOT_VALID`. Restam (a) só contas a **receber** ou
  (c) só título **não liberado**. Vencimento **restaurado** para 10/12/2025 (backup da row em disco).
- Achado lateral útil: existe caminho de escrita no título a pagar via `fin026` para **data**; para
  **valor**, o `PUT fin026` aceita e ignora (HML #9 de 14/10).

## Renegociação de Pagamentos `fin070` — o caminho nativo que MUDA o título (HML, 2026-10-19)

Autorizado pelo maintainer. Job `src/backend/jobs/probe-hml-renegociacao-fin070.ts`. Título 536/1
(R$ 53,53, HAI INTERNATIONAL, venc. 02/12/2025), renegociação **frnCod 3**, usuário **MPS_FRANCINEI**
(o mesmo do backend em PRD).

| Passo | Corpo | Resultado |
|---|---|---|
| `POST fin070` | `pesCod` (= `pesCodFor` do fin064), `frnVldTipo 2`, `frnVldTpop 0`, `frnDtaReneg`, obs MAIÚSCULA | ok, frnCod 3 |
| `POST fin070/titulos` | título 536/1 (+ `titMnyJuros` é **ignorado**) | ok, `mnyValorTotal` 53,53 |
| `POST fin070/titulos/composicao` com 53,54 | `frgMnyValor`, `frgDtaVencimento`, `frgEspNumero`, `pgtCod 1`, `dupEspOrdem` | **recusa** `FIN_070.O_TOTAL_DOS_TITULOS_A_SEREM_GERADOS…E_MAIOR_QUE_O_VALOR_EM_ABERTO` |
| idem com 53,53 (+ `rgMnyValorJuros` ignorado) | — | ok |
| `PUT fin070` com `frnMnyValor 0,01` e `frnVldTpop 0` | — | recusa `FIN_070.TIPO_OP_NAO_PERMITE_VALOR` |
| **`PUT fin070` com `frnMnyValor 0,01` e `frnVldTpop 1`** | — | **ok: o ERP lança `rgMnyValorJuros 0,01`; título e composição passam a `mnyValorTotal` 53,54** |
| `PUT fin070/finalizar/3` | — | ok |

**Resultado:** 536/1 consumido (some do `fin064`); nasce **536/2**: `titMnyValor 53,53` + **`titMnyJuros 0,01`**,
**`totalLiquido 53,54`**, `totalAberto 53,53`, venc. 30/10/2026, **`vldLib 0`**. `fin026` mostra
`titVld1/2/3Libera = 1`, mas o título **não aparece nos pendentes do SISPAG** (`fin015`).

**Aprovação:** 536/2 nasce **bloqueado na Liberação de Títulos (`fin103`)** pela regra **19
"ADIANTAMENTOS_OPERAÇÕES"** (bloqueio no instante do finalizar), `titMnyTotal 53,54`,
`ftbMnyValorLiberado 53,53`, `alcadaUsuario 1` (o usuário do backend tem alçada para liberar).
Ou seja: **renegociar devolve o título à aprovação** — volta ao fluxo normal de bloqueio/liberação.
(A renegociação 2 do suporte, `tpop 0`, gerou 15/4 e 15/5 já liberados: a regra de bloqueio
provavelmente depende do tipo de documento/valor, não de toda renegociação. A confirmar.)

### Liberação e vínculo — PONTA A PONTA OK (autorizado pelo maintainer)

1. **Liberar:** regra 19 tem um comando ativo, `fbaCod 3` "APROVAR" (alçada CONTROLLER), lido em
   `fin106/finBloqCmd/list/19`. `POST fin103/validaSelecionado` e **`POST fin103/aplicarComando` com
   `{ items: [ <linha do fin103/list> + fbaCod: 3 ] }`** ⇒ `SUCESSO`; bloqueio `ftbVldStatus 2`, `fin064.vldLib 1`,
   536/2 aparece nos pendentes do SISPAG (`titMnyValor 53,53`, `titMnyJuros 0,01`).
2. **Vínculo de boleto sintético de R$ 53,54 ao 536/2 (lote flp 46, `PG191074.REM`), nada declarado no item:**
   - o `importar` já traz o item com `itsMnyValor = itsMnyVlrPgto = titMnyLiquido = 53,54` e `titMnyJuros 0,01`;
   - `validacao → confirma (53,54) → PUT` ok; **`finalizar` ACEITA**;
   - **J: barra 53,54 · valor do título 53,53 · mora/multa 0,01 · pagamento 53,54.**

**Conclusões para o desenho:**
- O caminho para boleto ACIMA do título existe e é nativo: **renegociar (`fin070`, `frnVldTpop 1`,
  `frnMnyValor` = diferença) → liberar (`fin103`) → vincular com valor igual ao LÍQUIDO**. O centavo vira
  juros no título e mora/multa no J; o banco paga o valor de face do boleto.
- **I17b precisa mudar de régua:** o `finalizar` compara com o líquido (valor + juros − desconto), não com
  `fin064.totalAberto` (que fica 53,53). Comparar com `totalLiquido` do fin064 (53,54 no 536/2).
- **O título muda de `titCod`** (536/1 → 536/2): carteira local, decisão `CONFIRMADA` e par de sugestão
  apontam para o título antigo e precisam seguir o novo.
- **O título novo volta à aprovação** quando há regra de bloqueio aplicável (regra 19 aqui); o usuário do
  backend tem alçada para o comando APROVAR, mas aprovar por conta da analista é decisão de produto.

### Desconto (boleto ABAIXO) — PONTA A PONTA OK (autorizado pelo maintainer)

Título 540/1 (R$ 178,78, AR SOLUCOES, `pesCodFor 121`), renegociação **frnCod 4**: mesmos passos com
**`frnVldTpop 2`** + `frnMnyValor 0,01` ⇒ `mnyValorTotal` 178,77 (o campo segue `rgMnyValorJuros 0,01`, mas
subtrai). Finalizar ⇒ **540/2**: `titMnyValor 178,78`, **`titMnyDesconto 0,01`**, `totalLiquido 178,77`,
`totalAberto 178,78`, bloqueado na regra 19 ⇒ liberado com `fbaCod 3`. Boleto sintético de **R$ 178,77**
(lote flp 47, `PG191075.REM`): `importar` traz o item a 178,77; `finalizar` aceita;
**J: barra 178,77 · valor do título 178,78 · desconto/abatimento 0,01 · pagamento 178,77.**

**`frnVldTpop`:** `0` = sem ajuste (recusa valor) · **`1` = acréscimo (juros)** · **`2` = desconto**.

**Em aberto:** cancelamento das renegociações 3 e 4 (536/2 e 540/2 já estão em lotes finalizados).

## Estado deixado em HML
Lotes de teste **flp 42** (rascunho, finalizar recusado), **43, 44, 45** (finalizados, `PG191071–73.REM`).
Títulos 753/1, 748/1, 607/1, 15/5. Nenhum cadastro de título alterado.
