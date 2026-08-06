# ADR-0030 — Borderô órfão: limpar no produtor, recusar no consumidor

- **Status:** aceito
- **Data:** 2026-08-06
- **Frentes afetadas:** I (Permutas). Nenhuma outra frente muda.
- **Contexto de produção:** `POST /fin010/finalizar/18538` → `"ESTE BORDERÔ NÃO POSSUI ITENS.\n18538."`
- **Regra alterada:** `business-rules/fin010-write-contract.md` (novo **I-Write-7**)

## Contexto

O contrato de escrita do `fin010` (I-Write-1..6) é um **handshake de 5 chamadas**, e o **passo 1 cria o
borderô** — antes, portanto, de qualquer baixa existir. A consequência nunca tinha sido escrita: se as
baixas seguintes falharem, o borderô **permanece no ERP sem item nenhum**.

Em 2026-08-06 a Simone encontrou dois borderôs travados no painel. Um deles, o **18538**, era esse casco:
aparecia como `EM_CADASTRO`, o botão "Aprovar" estava habilitado, e o ERP recusava a finalização com
`"ESTE BORDERÔ NÃO POSSUI ITENS."` — um texto que diz o que está errado mas não o que fazer.

> O outro borderô do mesmo episódio (**15181**) **não** é órfão: está em **período contábil fechado**
> (`FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE`). Esse caso é matéria da contabilidade — reabrir o
> período — e **não** tem correção em código. Registrado aqui só para não confundir os dois sintomas,
> que chegaram juntos no mesmo log.

## Decisão

Duas guardas, uma de cada lado do ciclo de vida (ver I-Write-7):

**1. Produtor — limpar o casco.** Ao fim de `reconciliar`, se o borderô foi criado *naquela chamada* e
nenhuma alocação terminou `settled`, ele é removido do ERP e do cache.

**2. Consumidor — recusar a aprovação vazia.** `finalizarBordero` rejeita borderô sem item **antes** do
POST, com mensagem que aponta a saída ("use Excluir"). O front espelha desabilitando "Aprovar".

### Por que a limpeza é no FIM do loop, e não na primeira falha

O intent original dizia "limpar quando a **primeira** baixa falha". Está errado: por **I-Write-3** o
`borCod` é **compartilhado** por todas as alocações do mesmo `reconciliar`. Se a baixa 1 falha e a
baixa 2 tem sucesso, o borderô **tem** item — não é órfão. Apagar na primeira falha destruiria um
borderô que a alocação seguinte usaria, e deixaria `borCod` apontando para um borderô morto.

O predicado correto é **"criado aqui **e** zero baixas `settled` ao fim do loop"**.

### Por que a contagem vem do ERP, e não da trilha

`listComBordero` não filtra status: a trilha guarda linhas **`error` com `bor_cod` preenchido** (o
`setBorCod` persiste o borCod *antes* do handshake, de propósito — I-Write-4). Um casco vazio portanto
aparece na trilha com N linhas e **zero** baixas no ERP. Contar linhas da trilha daria o casco como
"cheio" e a guarda passaria batido justamente no caso que ela existe para pegar (o 18538).

Fonte da verdade: **`listBaixas` no ERP**. No front, onde não há chamada ao ERP, o predicado
equivalente é "nenhuma baixa `settled`" — `baixas.length` sozinho tem o mesmo defeito.

### Por que a limpeza é best-effort

A limpeza é **higiene, não a operação**. O que o analista precisa ver é o **erro da baixa**. Se o
`excluirBordero` falhar (ex.: período fechado — exatamente o caso 15181), isso vira `BUSINESS_WARN` e
o erro original sobrevive intacto. E se o ERP relatar item no borderô (baixa parcial que entrou antes
do erro), **não apaga**: apagar levaria embora uma baixa real.

## Escopo deliberadamente fora

**Órfãos que já existem em produção não são varridos por esta mudança** (decisão Yuri, 2026-08-06). A
mudança **previne** novos cascos e **bloqueia** a aprovação dos existentes; remover os que já existem é
feito pelo botão "Excluir" do painel, que já funciona para borderô vazio. Uma varredura em massa seria
um caminho de escrita nova sobre borderôs antigos — risco desproporcional ao problema.

## Consequências

- Uma chamada extra ao ERP (`listBaixas`) por aprovação, e mais uma no caminho de falha total da baixa.
  Nenhuma no caminho feliz da reconciliação.
- O painel deixa de oferecer uma ação que o ERP sempre recusaria.
- Borderôs órfãos deixam de se acumular; os que existem hoje continuam listados até serem excluídos.

## Alternativas descartadas

- **Criar o borderô só na 1ª baixa bem-sucedida (lazy).** Resolveria na raiz, mas o passo 2 do handshake
  (`validacao/tituloBaixa`) **exige `borCod`** — o ERP não valida título sem borderô. Inviável sem mudar
  o contrato do ERP.
- **Confiar na contagem da trilha.** Mais barato (sem ida ao ERP), mas erra exatamente no caso-alvo,
  como descrito acima.
- **Apagar na primeira falha.** É o intent literal; quebra o caso misto (ver acima).
