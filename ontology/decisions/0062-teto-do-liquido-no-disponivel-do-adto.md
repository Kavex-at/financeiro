---
adr_number: 0062
title: O líquido de cada baixa de permuta nunca excede o disponível vivo do adiantamento; excesso de centavos é absorvido na variação
date: 2026-10-05
status: accepted
type: change
related_entities: [Permuta, Adiantamento]
related_actions: [reconciliarPermuta]
related_business_rules: [fin010-write-contract]
related_integrations: [conexos]
amends_decisions: [0020]
evidence:
  - borderô 23184 (fil 2, adto 29469 × invoice 32539, 2 títulos) recusado no Finalizar em 2026-10-05
  - borderô 23188 (fil 2, adto 31117 × invoices 39082/39083, N:M) com o mesmo excesso de 0,01 na perna 2
  - borderô 16596 (fil 2, adto 17894 × invoice 25337) recusado no gravar em 2026-07-13
  - varredura de permuta_alocacao_execucao em produção (2026-10-05): 3 de 196 execuções reais com excesso 0,01
---

# ADR 0062: teto do líquido no disponível vivo do adiantamento (I-Write-10)

**Branch:** `fix/permuta-centavos-adto`. `entity_changed = false` (regra nova no contrato de escrita,
nenhuma entidade, estado ou ação nova).

## Contexto

A ADR-0020 criou a âncora I-Write-6: quando a baixa consome o adto inteiro e a invoice tem título
único, o líquido fecha no `bxaMnyValorPermuta` do ERP. Dois casos ficaram de fora de propósito, com
a premissa de que neles o rateio por taxa deixaria apenas um saldo legítimo:

1. **Perna N:M.** O gate `fullConsumeAdto` compara o alocado da perna com o saldo **total** do adto.
   A última perna, que consome o restante, nunca passa no gate.
2. **Invoice multi-título.** Cada título arredonda `round2(usd × taxa)` e a sua fração da variação
   separadamente.

A premissa falhou nos dois casos. Os arredondamentos podem somar **para cima**, e então o líquido
fica 0,01 acima do que o adto tem. O ERP recusa, no gravar ou só no Finalizar, e o borderô fica
preso "Em aberto" sem poder ser aprovado.

Em 2026-10-05, a analista não conseguiu aprovar o borderô 23184: "O TOTAL PERMUTADO DE ADIANTAMENTO
(49.873,83) É MAIOR QUE O VALOR DISPONÍVEL (49.873,82)". O borderô 23188, do mesmo dia, carrega o
mesmo excesso na perna 2. O 16596, de julho, morreu no gravar com `Generic.ERROR_MESSAGE`.

A descoberta que viabiliza a regra: no passo 3, o `bxaMnyValorPermuta` é o disponível **vivo** do
adto naquele borderô e já desconta o que foi gravado antes no mesmo `borCod`. Na perna 2 do 23188
ele veio 35.484,31 (85.685,99 − 50.201,68); no título 2 do 23184, veio 28.499,32 (49.873,82 −
21.374,50). Portanto existe, em toda baixa, um número do ERP contra o qual limitar.

## Decisão

Em toda baixa, depois da âncora I-Write-6 e antes do passo 4, se
`excesso = (bxaMnyValor + juros − desconto) − bxaMnyValorPermuta` for maior que zero e no máximo
R$1,00 (`ToleranciaResiduo.LIMITE_BRL`), o excesso sai da conta de variação já em uso:
`juros −= excesso` ou `desconto += excesso`.

- **Só para baixo.** Líquido abaixo do disponível não é tocado: o saldo restante da perna parcial é
  legítimo, e fechar para cima continua sendo exclusividade de I-Write-6.
- **Mesmo teto absoluto da âncora.** Excesso acima de R$1,00 não é arredondamento. Nesse caso nada é
  ajustado, sai um BUSINESS_WARN e o ERP recusa como antes, para conferência manual.
- **Juros nunca negativo.** Se o juros for menor que o excesso, nada é ajustado (BUSINESS_WARN).

## Alternativas consideradas

1. **Estender a âncora I-Write-6 (fechar no disponível também para cima) na última perna e na
   multi-título.** Rejeitada: exige decidir "esta é a última perna", o que depende de ordem e do
   saldo restante calculado. Na multi-título, a âncora mudaria o arredondamento de baixas que hoje
   fecham certas, decisão que a ADR-0020 e o follow-up P3 de `permuta-parcela-emaberto` deixaram
   para o time.
2. **Recusar antes de gravar** (fail-closed no excesso). Rejeitada: o excesso é ruído de centavo
   conhecido e a variação real é exatamente essa diferença. Recusar trocaria um borderô travado por
   uma permuta que nunca roda.
3. **Corrigir só os borderôs afetados à mão.** Necessário para os três existentes, mas insuficiente
   sozinho, porque novos casos continuariam surgindo.

## Consequências

- Na última perna N:M e nos títulos de invoice multi-título, `bxaMnyJuros`/`bxaMnyDesconto` mudam
  em até R$1,00 quando os arredondamentos somariam acima do adto. No caso medido, foi R$0,01.
- O comentário do payload (`bxaEspComplemento`) já usa a variação efetivamente lançada, então
  continua batendo com os valores.
- Os borderôs 23184 e 23188 (abertos) e o 16596 (erro) não são corrigidos por este código: precisam
  de ajuste no Conexos ou de exclusão e refação.
