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

## Achado 3 — P0: a chave nativa `(filCod, bncCod, flpCod)` NÃO é única

Este é o mais grave, e não estava no escopo da investigação.

`fin015/list` na filial 2, banco 4: **30 `flpCod` distintos aparecem 2 ou 3 vezes**.

```
flpCod 5 (fil 2, bnc 4):
   ccoCod=2  status=2 (cancelado)   soma=0
   ccoCod=1  status=1 (finalizado)  soma=33.184,53
   getLoteNativo(2,4,5) devolveu → status=2, soma=0   ← o CANCELADO

flpCod 3 (fil 2, bnc 4):
   ccoCod=1  status=3  soma=0
   ccoCod=1  status=1  soma=24.339,02      ← mesmo ccoCod, dois registros
   ccoCod=2  status=2  soma=0
```

Duas consequências, ambas com dinheiro no meio:

1. **`sincronizarComErp` pode ler o lote errado.** Se o gêmeo cancelado for retornado, a
   retomada conclui "lote cancelado" — e com o T2 isso oferece "gerar um lote novo". Se a
   pessoa confirmar, nasce um **pagamento duplicado** de um lote que na verdade está
   finalizado. É o dano exato que o mecanismo existe para evitar.
2. **`LotePagamentoRepository.findByChaveNativa`** casa o retorno `.RET` por
   `(nativeFilCod, nativeBncCod, nativeFlpCod)`. Com a chave ambígua, uma baixa pode ser
   gravada no lote errado.

Nem `ccoCod` fecha a chave: `flpCod 3` tem dois registros com `ccoCod = 1`. Eles diferem
por `flpDtaCredito`, mas não dá para afirmar que a data seja parte da identidade — pode
haver coluna que não estamos lendo. **Não vou adivinhar isto: precisa de resposta do
Conexos ou da Columbia.**

Agrava: `getLoteNativo` usa o path `fin015/{fil}/{bnc}/{flp}`, que **não aceita ccoCod** e
devolveu `ccoCod: undefined` — então nem dá para desambiguar pela resposta.

## Estado da retomada depois disto

| Mecanismo | Situação |
|---|---|
| Import um-por-chamada | corrigido e testado |
| `titulosCount` | corrigido |
| Adoção por marca d'água | provada ao vivo, mas **apoiada numa chave ambígua** |
| Detecção de "lote cancelado" (T2) | **suspeita** — pode ler o gêmeo errado |
| Conciliação por chave nativa | **suspeita** — mesma ambiguidade |

## Recomendação

1. **Antes da primeira remessa real**, fechar a identidade do lote nativo com o Conexos ou
   a Columbia. É pergunta de uma linha: *"o que identifica unicamente um lote no fin015?"*.
2. Enquanto não fechar, considerar **desligar o ramo "lote cancelado → gerar novo"** do T2:
   é o único caminho onde a ambiguidade produz pagamento duplicado sem outra trava.
3. Reavaliar `findByChaveNativa` com a chave correta.

## Reprodução

`fin015/list` com `filterList: {"bncCod#EQ": 4}` e `filCod: 2`, agrupando as linhas por
`flpCod` — os repetidos são o achado 3. O filtro `bncCod#EQ` É respeitado (74 de 102 linhas),
então a repetição não vem de mistura de bancos.
