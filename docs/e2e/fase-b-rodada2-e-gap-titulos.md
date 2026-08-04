# Fase B — rodada 2 (com os fixes) e o GAP DOS TÍTULOS

> Continuação de `fase-b-resultado-hml.md`. Execuções reais contra `columbiatrading-hml`,
> processo SKYJACK pri 186 / filial 2, R$ 123,45. Fixes na branch `fix/sn-cond-pgto-finalizacao`
> (worktree `C:/tmp/sn-condpgto-wt`, commits `fb693fc` + `aebc905`, suíte 97/1005 verde).

## Os dois fixes funcionaram no ERP real ✅

| Fix | Evidência na execução real |
|---|---|
| Condição de pagamento do próprio cliente + paginação por `count` | 2 chamadas ao LOV (`pageNumber` 1 e 2) e o PUT gravou **`pgtCod 101 · "SKYJACK BRASIL - DUPLICATA"`**. Antes gravava `103 · BONDUELLE`. |
| Discriminador da finalização (`docVldFinalizado===1`) | Parou na **etapa `sn`** (antes só quebrava em `fin014`) com: *"Finalização do documento 733 (com299) NÃO efetivada: o ERP respondeu HTTP 200 mas a releitura traz docVldFinalizado=0"*. |

Também confirmado: o ERP **ignora o `pageSize`** enviado (pedimos 500, devolve 50/página, `count: 86`)
— a paginação passou a ser guiada por `count`, como o `ConexosBaseClient.paginate` já fazia.

## O GAP NOVO (P0 do fluxo): a automação nunca gera os TÍTULOS do documento

Ao clicar "Finalizar" na UI do HML no doc 733, o ERP mostra a mensagem que explica tudo:

> **"O TOTAL DOS TÍTULOS: 0.00 NÃO CONFERE COM O TOTAL DO DOCUMENTO: 123.45."**

Estado do doc 733 medido por API: `qtdItens: 1`, `docMnyValor: 123,45`, `mnyBruto: 123,45`,
**`mnyTitValor: 0`**, `docVldFinalizado: 0`; `validate/finalizacaoDocumento` responde `200 {}` (limpo).

Ou seja: o documento tem **item e valor**, mas **nenhum título (parcela) a receber**. A condição de
pagamento diz *como* parcelar; alguém precisa **gerar as parcelas**. O orquestrador
(`RecebimentoNumerarioService.etapaSn` → `completarSnAdiantamento`) faz: condição de pagamento →
linha de item → finalizar. **Falta a etapa de geração dos títulos entre o item e a finalização.**

Na UI essa etapa é o botão **"Financeiro"**, que abre a tela **com032** (modal `com032.viewFinTitulo`,
confirmado no JS público `views/com299.js`). O JS do com032 não é acessível (403 no CDN) e
`com032/list` do doc 733 devolve `count: 0`; `com032/initialValues` → 404. **O contrato de geração
de título ainda não foi capturado.**

### Por que isso não apareceu antes

- O HAR de produção (doc 18342) mostrava a SN já **com** título — a leg de título provavelmente foi
  executada **manualmente pelo analista** na tela, e a automação nunca a implementou.
- Nenhum documento com299 recente do HML tem `mnyTitValor > 0` — o ambiente nunca exercitou esse passo.
- O `fin014` do orquestrador **depende** desse título (`lov/TituloBorderoReceber`), então o fluxo
  automatizado **nunca poderia** ter concluído sozinho. O erro anterior ("SN não gerou título") era
  o sintoma; esta é a causa.

## Próximo passo para destravar (a capturar)

1. **HAR da tela**: abrir o doc 733 no HML → botão **Financeiro** → gerar/salvar o título → capturar
   no DevTools o endpoint + payload (provável `POST com032` com `docTip/docCod/titCod/titEspNumero/
   titMnyValor/titDtaVencimento/...`). Sem esse HAR, qualquer implementação é chute.
2. Com o contrato: nova etapa `etapaTitulos` entre `completarSnAdiantamento` e a finalização,
   com discriminador próprio (reler o doc e exigir `mnyTitValor === docMnyValor`) — mesma doutrina
   dos outros passos. Entrada no pipe: `/feature-new "geração de títulos da SN (com032)"`.
3. Só então a Fase B pode seguir para fin014 → NDe → homologação → SEFAZ.

## Resíduos no HML (inócuos, sem título/baixa/NDe)

- **SN 731** — condição de terceiro (bug antigo), não finalizada.
- **SN 732** — parada pelo fail-closed da condição de pagamento (antes da paginação por `count`).
- **SN 733** — condição CORRETA (SKYJACK 101), item de 123,45, parada na finalização por falta de título.

## Estado do backlog fiscal (inalterado)

`dprVldCstIbsCbs: "-1"` continua sendo enviado em escrita real (RT-001), agora observado em três
documentos. O gate fail-closed de CST **ainda não foi implementado** — segue como item 1 do backlog
do gap report.
