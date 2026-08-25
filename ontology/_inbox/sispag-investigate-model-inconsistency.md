# /investigate — `MODEL_INCONSISTENCY` no `titulosPendentes/importar`

> Aberto por pedido do Yuri em 2026-08-25, depois que o gate de retomada reprovou com esse
> erro **também no caminho normal**, não só na retomada. Investigação ao vivo em HML.

## Sintoma

```
POST fin015/finItemSispag/titulosPendentes/importar → 400
{"type":"SELECTION_ERROR","validation":{"main":{"messages":[
  {"message":"Generic.MODEL_INCONSISTENCY"},{"message":"Generic.MODEL_INCONSISTENCY"}]}}}
```

Sempre **uma mensagem por item enviado**.

## Root cause — o endpoint aceita UM item por chamada

Medido isolando o import (HML, filial 2, banco 4):

| Chamada | Resultado |
|---|---|
| 2 itens no mesmo `items[]` | **400** `MODEL_INCONSISTENCY` ×2 |
| os mesmos 2 itens, 1 por chamada | **200** nas duas, e ambos ficam no lote |

O nome do campo (`items`, plural) e a nossa leitura do DTO sugeriam lote. **A validação
original de 2026-08-20 passou porque foi feita com UM título só** — e por isso o defeito
sobreviveu a todos os gates.

**Impacto real:** qualquer `lote_pagamento` com 2+ títulos falhava. Não é caso de borda —
é o caso normal. A Columbia bateria nisto na primeira remessa de verdade.

**Corrigido** em `ConexosSispagWriteClient.importarTitulos`: quebra em uma chamada por item.
Não é atômico e não finge ser — falha no meio propaga, e é exatamente o cenário de import
parcial que a retomada trata. 4 testes de regressão.

## Achado 2 — `titulosCount` NÃO é a contagem de itens

Medido: `flp 28` tem **3 itens reais** e reporta `titulosCount = 1`. `flp 27` tem 2 e
reporta 1. Em produção, **todos** os lotes reportam 1. O campo que bate é `soma`.

Eu usava `estado.titulosCount >= esperados` para decidir se o import já tinha entrado —
o que nunca seria verdade para lote com 2+ títulos. **Corrigido**: `titulosCount` vale só
como booleano "tem alguma coisa?"; quem responde QUAIS é `listarChavesDoLote`.

## Achado 3 — RETRATADO: a chave nativa É única. O bug era meu.

**Primeira conclusão (ERRADA):** vi 30 `flpCod` repetidos na filial 2 banco 4, `getLoteNativo`
devolvendo um gêmeo cancelado enquanto o outro tinha R$ 33.184,53, e classifiquei como P0 —
"a chave `(filCod, bncCod, flpCod)` não é única, a conciliação pode gravar no lote errado".

**O que o diff completo mostrou:** entre os "gêmeos", o campo que difere é o **`filCod`**.

```
flpCod 5:  filCod=2 (cancelado, soma 0)  |  filCod=1 (finalizado, R$ 33.184,53)
flpCod 3:  filCod=7  |  filCod=1  |  filCod=2
```

São lotes de **filiais diferentes**. A chave é única — eu é que estava listando errado.

**A causa raiz, que É um defeito nosso:** `listarLotesNativos` mandava
`filterList: { 'bncCod#EQ': bncCod }` e passava `filCod` apenas em `opts`. Mas o `filCod` de
`opts` é o **contexto de sessão**, não um filtro de dados — o `fin015/list` devolvia lotes de
todas as filiais.

Medido:

| Consulta | Linhas | Filiais | `(fil,bnc,flp)` repetidos |
|---|---|---|---|
| `{bncCod#EQ:4}` | 74 | 1, 2, 7 | **0** |
| `{bncCod#EQ:4, filCod#EQ:2}` | 30 | só 2 | **0** |

Zero repetições nos dois casos: as "repetições" que eu vi eram só a coincidência de números
entre filiais.

**O dano real** (menor que o alarme, mas concreto) era na **marca d'água**: o conjunto de
"lotes conhecidos" vinha contaminado com `flpCod` de outras filiais. Um órfão cujo número já
existisse em outra filial ficava invisível, o `adotarPorMarcaDagua` não achava candidato e o
retry **criava um segundo lote** — exatamente o que o mecanismo evita. Foi isso que fez o
cenário C1 do gate falhar com *"usou flp 30 · 1 lote novo"*.

**Corrigido:** `filCod#EQ` no `filterList`, com teste.

`getLoteNativo` foi verificado à parte e está correto: em 8 lotes de 2 bancos, o que ele
devolve pelo path `fin015/{fil}/{bnc}/{flp}` bate com a linha da `list` em status e soma.

### Hipóteses testadas e descartadas

| # | Hipótese | Veredito |
|---|---|---|
| H1 | Existe coluna de chave que não estamos lendo | **descartada** — o diff mostrou que o que difere é `filCod` |
| H2 | A `list` é um join que duplica linhas do mesmo lote | **descartada** — são lotes distintos, de filiais distintas |
| H3 | `flpCod` é sequência anual e os gêmeos são de anos diferentes | **descartada** — mesmo período, filiais diferentes |
| H4 | O path `fin015/{fil}/{bnc}/{flp}` está incompleto | **descartada** — bate com a `list` em 8/8 |
| H5 | O ERP concilia por `fil+bnc+flp` (está no CNAB), logo a chave é essa | **CONFIRMADA** |

H5 era a pista que eu tinha e não segui: o CNAB carrega `filCod+bncCod+flpCod+itsCodSeq` no
"uso da empresa". Se o próprio ERP se reconcilia por esses campos, eles **têm** que identificar
o lote — a dúvida deveria ter recaído sobre a minha consulta desde o começo.

## Estado da retomada depois disto

| Mecanismo | Situação |
|---|---|
| Import um-por-chamada | corrigido e testado |
| `titulosCount` | corrigido |
| Adoção por marca d'água | provada ao vivo, mas **apoiada numa chave ambígua** |
| Detecção de "lote cancelado" (T2) | **suspeita** — pode ler o gêmeo errado |
| Conciliação por chave nativa | **suspeita** — mesma ambiguidade |

## Recomendação

1. Nada a perguntar à Columbia — a chave está resolvida e é `(filCod, bncCod, flpCod)`.
2. **Auditar as outras chamadas de `fin015/list`** no código: onde mais passamos `filCod`
   só em `opts` achando que filtra? Este defeito pode estar repetido.
3. O gate ao vivo continua com C2 e C3 sem executar — a causa agora é plumbing do próprio
   job de teste (o pool guarda `docCod` sem `filCod`, e `docCod` se repete entre filiais).

## Reprodução

`fin015/list` com `filterList: {"bncCod#EQ": 4}` e `filCod: 2`, agrupando as linhas por
`flpCod` — os repetidos são o achado 3. O filtro `bncCod#EQ` É respeitado (74 de 102 linhas),
então a repetição não vem de mistura de bancos.
