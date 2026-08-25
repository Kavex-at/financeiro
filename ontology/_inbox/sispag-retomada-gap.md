# GAP — o gate de retomada não pôde rodar completo em HML

> Card T5 do `/feature-tweak sispag "retry ... continue from where the flow stopped"`.
> Data: 2026-08-25. Status: **cobertura parcial, com evidência ao vivo do mecanismo principal.**

## O que o gate deveria provar

Que uma execução interrompida, ao ser repetida, **retoma sem criar um segundo lote de
pagamento**. Critério: a filial de teste termina com exatamente os lotes esperados.

## Por que não rodou completo

`jobs/validate-retomada-remessa-v1.ts` precisa de títulos que sejam, ao mesmo tempo:

1. **pendentes** no grid do `fin015` (não importados em outro lote);
2. com **favorecido que tenha conta no banco do lote** (o import exige);
3. **a vencer** — vencido faz o ERP recusar (data de débito é hoje, regra R2).

Medido em HML (2026-08-25), banco 4 / Itaú (341):

| Filial | Pendentes | Atendem os 3 critérios |
|---|---|---|
| 1 | 321 | **0** |
| 2 | 321 | **0** |
| 4 | 321 | **0** |
| 6 | 321 | **0** |

Relaxando só o critério 3 (aceitando vencidos), a filial 1 tem **2 de 321** — e esses dois
falham no import com `SELECTION_ERROR / Generic.MODEL_INCONSISTENCY`, que é o ERP recusando
data de débito posterior ao vencimento (títulos venciam em nov/2025).

Isto é **dado de homologação, não defeito**: já estava medido que os favorecidos de HML não
têm conta cadastrada (`probe-fin064-destino`, 2026-08-19: 0% em 561 títulos). O gate só
tornou a consequência visível.

## O que FOI provado ao vivo, apesar disso

A adoção por marca d'água — o mecanismo mais novo e o único com julgamento (a regra do
"exatamente um") — **funcionou contra o ERP real**. Log da execução das 15:03 de 2026-08-25:

```
execução órfã encontrada — estado real consultado no ERP
  etapaNoLedger: "criar_lote"  etapaReal: "importar"  motivo: "lote 39 aberto e vazio"
reaproveitando lote nativo de tentativa anterior  flpCod: 39
```

O lote 39 era o órfão plantado de propósito. O serviço **o encontrou pela marca d'água,
adotou, e não criou um segundo lote**. A sequência só parou depois, no import, pelo motivo
de dado acima.

Continua **não provado ao vivo**: import parcial (C2) e remessa-já-gerada (C3).

## Como destravar

Qualquer um dos três resolve:

1. **Cadastrar conta bancária** (banco 341) para 6 favorecidos de títulos a vencer em HML —
   é o caminho mais direto e deixa o gate repetível.
2. **Rodar com `VAL_BNC` de outro banco** onde os favorecidos de HML tenham conta. Não
   verificado se existe; o job aborta dizendo quais bancos a filial tem.
3. **Rodar em produção com `PERMITIR_PRD=1`** — cria lotes reais no ERP da Columbia.
   Não recomendado sem acompanhamento de alguém do financeiro.

## Efeito colateral registrado

As tentativas deixaram **lotes vazios em HML** na filial 1 (flp 28 a 40, aproximadamente).
Não há endpoint de cancelamento de lote no fin015, então eles ficam. O job já foi ajustado
para **reusar** um lote vazio existente como sondagem em vez de criar outro — a varredura das
filiais 2, 4 e 6 rodou sem criar nenhum.

## Decisão pendente para o Yuri

Fechar o PR com cobertura parcial (mecanismo principal provado ao vivo, dois cenários só em
mock), ou segurar até cadastrar contas em HML e rodar o gate inteiro?


---

# Atualização — 2026-08-25, tarde (após semear vencimentos em HML)

## O que foi feito

Não foi preciso cadastrar conta bancária: o favorecido **pesCod 384 (ITAPOA TERMINAIS
PORTUARIOS)** da filial 2 **já tem conta Itaú** (ag. 154, c/c 99758-9) e tinha 7 títulos
pendentes. Faltava só a data.

`jobs/seed-hml-vencimento.ts` (já aprovado nesta feature) empurrou o vencimento de **6
títulos** da filial 2 — docs 378, 388, 606, 614, 618, 643 — para **2026-10-09**. Reversível
por `REVERTER=1`; os vencimentos originais estão em `/tmp/seed-hml-vencimento/`.

## ACHADO QUE MUDOU O CÓDIGO — `flpCod` não é monotônico

Com o pool destravado, o gate rodou e revelou um defeito de **projeto** que nenhum teste
mockado pegaria:

```
órfão plantado no ERP: flp 15  (marca era 40)
```

A marca d'água guardava o **maior** `flpCod` e procurava candidatos **acima** dele. Mas o
ERP **reaproveita buracos de numeração**: um lote novo na filial 2 nasceu com `flp 15`
quando o maior era `40`. Com a regra "maior que", esse órfão seria invisível — e o retry
criaria um segundo lote de pagamento, que é exatamente o dano que o mecanismo existe para
evitar.

**Corrigido:** a marca passou a ser o **CONJUNTO** dos `flpCod` conhecidos, e o candidato é
o que **não estava lá antes**. Teste de regressão em `RemessaService.test.ts`
(*"ADOTA um lote com flpCod MENOR que o máximo"*).

## O que continua bloqueado — e NÃO é a retomada

Com títulos a-vencer e favorecido com conta, `titulosPendentes/importar` responde:

```
400 {"type":"SELECTION_ERROR","validation":{"main":{"messages":[
  {"message":"Generic.MODEL_INCONSISTENCY"},{"message":"Generic.MODEL_INCONSISTENCY"}]}}}
```

Uma mensagem por item. **O discriminador:** o cenário C3 usa o caminho NORMAL (sem
retomada) e falha do mesmo jeito. Logo o problema está no dado/shape do import em HML, não
na lógica de retomada.

Pista levantada e não fechada: a linha do grid de pendentes veio **sem** os campos de
enriquecimento (`pctCodSeq`, `itsNumBanco`, `itsVldModalidade`, `vldOk`, `vldImporta`) na
filial 2, enquanto na filial 1 vinham preenchidos. Como `montarItensImport` os injeta a
partir do `cmn025`, o payload final os tem — então a inconsistência é outra, ainda não
identificada. Vale uma sessão de investigação própria (`/investigate`), com o `importarTitulos`
isolado, sem o resto da sequência.

## Placar do gate

| Cenário | Status | Evidência |
|---|---|---|
| Adoção por marca d'água (C1) | **PROVADO AO VIVO** | log de 15:03 — achou o órfão flp 39, adotou, não criou outro |
| `flpCod` não-monotônico | **DEFEITO ACHADO E CORRIGIDO** | flp 15 abaixo da marca 40 |
| Import parcial (C2) | bloqueado pelo import | falha idêntica no caminho normal |
| Remessa já gerada (C3) | bloqueado pelo import | idem |

## Custo em HML, declarado

- 6 títulos da filial 2 com vencimento alterado (reversível).
- ~10 lotes vazios criados nas filiais 1 e 2 ao longo das tentativas. Não há endpoint de
  cancelamento de lote no fin015. O job já reusa lote vazio como sondagem para não piorar.
- 2 títulos (606, 614) foram consumidos por imports parciais e saíram do grid de pendentes.


---

# FECHADO — 2026-08-25, fim do dia: os três cenários passaram ao vivo

## Placar final

| Cenário | Resultado | Evidência |
|---|---|---|
| C1 · órfão sem `flpCod` (marca d'água) | **✅ VERDE** | `usou flp 12 · 0 lote(s) novo(s)` — adotou o órfão plantado |
| C2 · import parcial | **✅ VERDE** | `flp 13 com 2 chave(s) [2:591:1, 2:633:1] · 1 novo(s)` |
| C3 · remessa já gerada | **✅ VERDE** | `status=skipped arquivo=PG2508006002.R1EM` |

Em nenhuma execução verde a retomada criou um lote a mais do que o esperado — que é o
critério do gate.

## O que destravou o pool

Não foi cadastrar conta bancária. Medindo a cobertura por banco na filial 2:

| Banco do favorecido | Favorecidos | Títulos | Temos conta pagadora? |
|---|---|---|---|
| **237 Bradesco** | 7 | **24** | sim |
| 1 Banco do Brasil | 4 | 12 | sim |
| 755 BofA | 2 | 11 | não |
| 33 Santander | 1 | 1 | sim |
| 341 Itaú | 1 | 1 | sim |

O Itaú, que eu vinha usando, tem a PIOR cobertura de HML. Com `VAL_BNC=7` + o seed de
vencimento, o pool existe sem criar nenhum cadastro.

## Defeitos de PRODUÇÃO achados por este gate

Nenhum deles apareceria em teste mockado.

1. **`importar` aceita um item por chamada.** Qualquer lote com 2+ títulos falhava — no
   caminho normal, não só na retomada.
2. **`flpCod` não é monotônico.** A marca d'água virou conjunto.
3. **`fin015/list` sem `filCod#EQ`.** Contaminava a marca d'água e, no
   `ConexosSispagClient.listLotes` do painel, rotulava lote de outra filial com a filial
   consultada.
4. **Chave do item sem filial.** `docCod` se repete entre filiais (o doc 285 existe na 2 e
   na 4); o `Map` colidia e o título de outra filial sobrescrevia o nosso — importaria
   pagamento de outro fornecedor, com outro valor.
5. **`titulosCount` não conta itens** (vale 1 para qualquer lote não-vazio). Eu usava como
   contagem; e a asserção do próprio gate caiu nessa armadilha antes de eu perceber.

## Custo em HML

- ~30 títulos da filial 2 com vencimento empurrado (reversível via `REVERTER=1`).
- ~13 lotes criados nas filiais 1 e 2. Não há endpoint de cancelamento de lote no fin015.
- Títulos importados nos lotes de teste saem do grid de pendentes de forma permanente.

## Como repetir

```
cd src/backend
CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
databaseConnectionString=<postgres local> \
CONEXOS_WRITE_ENABLED=true CONEXOS_DRY_RUN=false SISPAG_LIVE_WRITE_ENABLED=true \
VAL_FIL=2 VAL_BNC=7 [VAL_ONLY=import-parcial] \
npx tsx jobs/validate-retomada-remessa-v1.ts --executar
```

Cada cenário consome 2 títulos permanentemente. Sem `VAL_ONLY` o job roda os três e precisa
de 6 no pool; com `VAL_ONLY` dá para exercitar um cenário sem gastar o resto. Se o pool
acabar, `jobs/seed-hml-vencimento.ts` renova empurrando vencimentos de títulos cujo
favorecido tenha conta no banco escolhido.
