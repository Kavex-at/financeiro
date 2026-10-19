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

## Estado deixado em HML
Lotes de teste **flp 42** (rascunho, finalizar recusado), **43, 44, 45** (finalizados, `PG191071–73.REM`).
Títulos 753/1, 748/1, 607/1, 15/5. Nenhum cadastro de título alterado.
