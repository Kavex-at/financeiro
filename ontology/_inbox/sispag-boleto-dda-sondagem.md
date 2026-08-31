# SISPAG — de onde vem o código de barras do boleto (sondagem read-only, 2026-08-27)

> Origem: pedido do Yuri — "tratar boleto diferente de PIX/TED; vincular pagamento a boleto;
> o código de barras precisa sair na remessa. A Columbia diz que a informação está no `fin124`."
> Método: quatro sondas read-only contra **PRD** (`jobs/probe-fin124-dda.ts`,
> `probe-fin015-boleto-vinculo.ts`, `probe-boleto-fonte.ts`, `probe-com308-codbar.ts`).
> Nenhuma escrita — só `/list`.

## TL;DR

1. O código de barras **não existe no título** — em lugar nenhum, em nenhum momento antes do
   import no lote. Medido em 3 fontes independentes, todas 0%.
2. O `fin124` (Importação de Arquivo DDA) tem **100% dos itens com barras**, mas **0% de vínculo**
   com documento/título. E **não é por filial**: as 4 filiais devolvem o mesmo pool global.
3. O vínculo que o ERP conhece está no **grid de pendentes do `fin015`**, no flag
   `titVldReflexoDdaAssoc` — e nós mandamos **`0` hardcoded** no import, ou seja, dizemos ao ERP
   para **não** associar o boleto.
4. Achado colateral (defeito): `MODALIDADE_NATIVA.BOLETO = 7` está **errado para 89% dos boletos
   reais**. Medido: **6 = boleto do mesmo banco (Itaú 341)**, **7 = boleto de outro banco**.

## 1. O barcode não está no título — três medições

| Fonte | O que foi lido | Amostra | Com `titEspCodbar` |
|---|---|---|---|
| `fin064/list` (carteira) | probe-fin064-destino, 2026-08-19 | 2000 (PRD, fil 1/2/4/6) | **0 (0%)** |
| `fin015/…/titulosPendentes/list` (grid de import) | probe-boleto-fonte Q1, 2026-08-27 | 2173 (PRD, 4 filiais) | **0 (0%)** |
| `com308.finTituloFin` (título a-pagar) | probe-com308-codbar, 2026-08-27 | 50 (PRD, fil 1/2) | **0 (0%)** |

O campo **existe** nas três respostas (não é `fieldList` faltando — o com308 foi lido com
`fieldList: []` e devolve `titEspCodbar` entre as 90 chaves). Vem **null**.

Onde ele aparece: **`FinItemSispag.itsNumCodbar`**, depois que o item entra no lote.

| Modalidade | Itens | Com barras | `vldVinculoDda=1` |
|---|---|---|---|
| 1 (crédito em conta / TED) | 16 | 0 (0%) | 0 |
| **6 (boleto mesmo banco)** | 41 | **41 (100%)** | 11 |
| **7 (boleto outro banco)** | 8 | **8 (100%)** | 6 |

> Conclusão: o barcode é **fornecido no import** — não lido do título. Ou a analista digita/escaneia
> na tela do `fin015`, ou o ERP puxa do DDA na associação. Nunca esteve disponível para nós antes.

## 2. `fin124` — o pool de boletos DDA

`POST /fin124/list` + `POST /fin124/itens/list/{ddcCod}` (ambos leitura). Medido em PRD:

- **143 arquivos**, todos `ddcVldStatus = 1`. Cadência ~diária (`VAR_341_0641_55795_DDMMAA00.RET`).
- 3 arquivos mais recentes = **297 itens**.
- **`ditEspCodbar`: 297/297 (100%)** — 44 dígitos (código de barras).
- **`docCod`/`titCod`/`filCod`/`bncCod`/`flpCod`: 0/297 (0%)** — todos null. Bate com a tela do
  print: as colunas "Cód. Documento" e "Título" estão vazias.
- **Não é por filial.** As filiais 1, 2, 4 e 6 devolvem **os mesmos 143 arquivos e os mesmos 297
  itens**. O header `Cnx-filCod` não escopa o `fin124` — o pool DDA é da **conta pagadora**
  (Itaú ag 0641 / cc 55795), não da filial.

### Casar por valor+vencimento é fraco
Contra a carteira `fin064` de cada filial, dos 297 itens sem vínculo apenas
**11 (fil 1) / 60 (fil 2) / 18 (fil 4) / 7 (fil 6)** teriam candidato **único**. Como o pool é
global e a comparação foi por filial, parte desses 96 é **ambígua entre filiais** — o mesmo item
DDA casa em mais de uma carteira. Matching nosso por valor+vencimento **não é confiável**.

## 3. O vínculo que o ERP conhece: `titVldReflexoDdaAssoc`

No grid de pendentes do `fin015` (`TituloPendenteDTO`), medido em PRD:

| Filial | Pendentes lidos | `titVldReflexoDdaAssoc = 1` |
|---|---|---|
| 1 | 173 | **54** |
| 2 (flp 10) | 500 | **136** |
| 4 | 500 | **24** |
| 6 | 500 | **152** |

O ERP **já sabe** quais títulos têm boleto DDA — o par `titVldReflexoDdaAssoc` /
`titVldReflexoDdaDesassoc` é o mecanismo de associação, e `FinItemSispag.vldVinculoDda` registra
o resultado no item.

**`RemessaService.montarItensImport` manda `titVldReflexoDdaAssoc: 0` e
`titVldReflexoDdaDesassoc: 0` fixos** (o objeto `selecao`). Estamos instruindo o ERP a **não**
associar o boleto — e depois mandando `titEspCodbar: ''` porque o título não tem barras.

## 4. Defeito medido: a modalidade do boleto está errada

`RemessaService.MODALIDADE_NATIVA.BOLETO = 7`. Cruzando modalidade × banco emissor do barcode
nos itens reais (probe-boleto-fonte Q2):

| Modalidade | Banco emissor (3 primeiros dígitos) | Itens | Tamanho |
|---|---|---|---|
| **6** | 341 (Itaú — o banco do lote) | **32** | 47 |
| **7** | 748 (Sicredi) | 3 | 47 |
| **7** | 237 (Bradesco) | 1 | 47 |

**6 = boleto do mesmo banco; 7 = boleto de outro banco.** 32 de 36 boletos reais (89%) são Itaú,
ou seja modalidade **6**. Todo boleto que gerarmos hoje sai como 7.

Nota de formato: `itsNumCodbar` tem **47 dígitos** (linha digitável), enquanto `ditEspCodbar` do
`fin124` tem **44** (código de barras). A conversão 44↔47 é determinística, mas é conversão —
não dá para repassar o campo cru de um para o outro.

## 5. MECANISMO PROVADO AO VIVO (HML, 2026-08-27) — `probe-dda-assoc-write-hml.ts` + `probe-dda-answer-shape-hml.ts`

**P0-2 respondida: SIM — mas passa por uma PERGUNTA do ERP.**

```
POST titulosPendentes/importar  { …item, titVldReflexoDdaAssoc: 1 }
  → 400 { "type":"QUESTION", "questions":[{ "id":"1",
          "key":"FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO",
          "answerList":[{"id":"YES",…},{"id":"NO",…}] }] }

re-POST do MESMO body + { "answers": { "1": "YES" } }
  → 200 { "messages":[{ "valid":"SUCESSO", "message":"Generic.PROCEDIMENTO_SUCESSO" }] }
```

Resultado medido no item (fil 2, flp 24, doc 452/1):

| campo | valor |
|---|---|
| `itsNumCodbar` | `745…` — 47 dígitos, banco emissor **745**. Valor redigido: é boleto real de fornecedor (o barcode carrega valor e vencimento). |
| `vldVinculoDda` | **1** |
| `itsVldModalidade` | **7** — *mandamos 6; o ERP sobrescreveu* |

### O protocolo de resposta a QUESTION (não documentado em lugar nenhum)
`answers` é um **`Map<String,String>` chaveado pelo `id` da pergunta** — não pelo `key`, não um
array. Descoberto porque a tentativa com array devolveu
`JSON parse error: Cannot deserialize value of type LinkedHashMap<String,String> from Array value`,
que entregou o tipo do campo no DTO Java. Sete outros shapes (`answerList`, `questions[].answer`,
`questionsAnswer`, `answer`, `questionAnswerList`, …) devolvem a mesma QUESTION.

**Propriedade de segurança medida:** o POST que devolve `QUESTION` **não importa nada** — a
contagem de itens do lote ficou em 1 antes e passou a 2 só após o re-POST com a resposta. A
pergunta é um pré-commit, não uma escrita parcial.

### Consequência para a modalidade
O ERP **deriva `itsVldModalidade` do banco emissor do barcode** (745 → 7 = outro banco), ignorando
o que mandamos. Ou seja: para boleto com DDA associado, não devemos adivinhar a modalidade —
o ERP decide, e decide certo. `MODALIDADE_NATIVA.BOLETO = 7` só importa para boleto SEM DDA.

## 5.1 Prova ponta a ponta (HML, 2026-08-31)

O que faltava era ligar "o ERP grava `itsNumCodbar`" a "o barcode sai no arquivo". Feito pelo
**nosso** client (`importarTitulos` com `associarDda`, auto-resposta inclusa):

| passo | resultado |
|---|---|
| `criarLote` (débito = hoje) | `flp 34`, fil 2, bnc 4 |
| `importarTitulos({ associarDda: true })` | doc 453/1 importado; pergunta do ERP auto-respondida |
| item no ERP | modalidade **6** · `vldVinculoDda = 1` · barras 47 díg. iniciando **341** |
| `gerarRemessa` | `PG310801.REM` |
| segmento J do arquivo | **44 dígitos, DV módulo-11 válido**, R$ 5.720,68, banco 341 |

O barcode do `.REM` é o mesmo `ditEspCodbar` do item DDA do `fin124`, e o valor bate com o do
título. **Cadeia fechada sem inferência.**

### Auditoria dos `.REM` REAIS de produção (read-only)

Varredura de todos os arquivos gerados nas filiais 1/2/4/6: **61 segmentos J · 61 com 44
dígitos · 60 com DV válido · 0 vazios**.

> ⚠️ **Armadilha de medição:** cada boleto emite DOIS registros com `J` na posição 14 — o
> segmento J e o **J-52** (complemento, CNPJ do favorecido/pagador), que não carrega barras.
> Contar os dois juntos produz um falso "50% dos segmentos J estão vazios". Filtrar por
> posições 18-19 ≠ `52`.

**O único DV inválido** está em `PG121101.REM` (fil 2, lote 4): banco 341, R$ 37.567,14 — um
arquivo que **já foi ao banco**. Veio do caminho manual, onde alguém digita 47 dígitos. É o
argumento empírico a favor do caminho DDA: o ERP copia do arquivo do banco e não erra assim.
Vale avisar a Columbia sobre esse pagamento específico.

## 6. Perguntas ainda abertas

- **P0-1.** Quem popula `titVldReflexoDdaAssoc = 1`? (Rotina do ERP no import do DDA, provavelmente
  — o flag aparece em 2 de 289 pendentes em HML e em 54–152 por filial em PRD, sem ninguém da
  Kavex ter tocado.) Não bloqueia: o flag é leitura, e o gate é a pergunta do ERP.
- **P1.** Nos itens boleto reais com barras mas sem `vldVinculoDda` (73% em PRD): a analista digita
  o barcode na tela do `fin015`. Confirmar com a Flávia — define se o caminho DDA cobre tudo ou
  se sobra um resíduo manual.
- **⚠️ Deixado em HML:** item doc 452/1 importado no lote de teste `flp 24` (fil 2, bnc 4).

## 7. Ferramentas deixadas no repo

`jobs/probe-fin124-dda.ts`, `jobs/probe-fin015-boleto-vinculo.ts`, `jobs/probe-boleto-fonte.ts`,
`jobs/probe-com308-codbar.ts` — read-only, guard de PRD por `PROBE_PRD=1`.
`jobs/probe-dda-associado-hml.ts` (read-only, HML), `jobs/probe-dda-assoc-write-hml.ts` e
`jobs/probe-dda-answer-shape-hml.ts` — **escrevem**, e recusam qualquer base que não seja `-hml`.
