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
