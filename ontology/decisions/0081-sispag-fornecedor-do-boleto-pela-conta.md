---
adr_number: 0081
title: SISPAG — fornecedor do boleto DDA aprendido da conta do beneficiário nas barras
date: 2026-10-30
status: accepted
type: change
related_entities: [BoletoDda, FornecedorContaBoleto, TituloAPagar, DecisaoSugestaoBoleto, ConfirmacaoEmissorBoleto]
related_business_rules: [sugestao-boleto-dda-sispag]
continues: [0068, 0072]
amends: []
decided_by: yuri
decided_on: 2026-10-30
evidence:
  - ontology/_inbox/sispag-fornecedor-boleto-interview.md (decisões do maintainer com a sessão orquestradora, 2026-10-30)
  - "cópia local de PRD de 30/10 (dda_prd_3010): 93 contas de beneficiário, 3 ambíguas, 392 dos 892 boletos sem título nomeados"
---

# ADR 0081: fornecedor do boleto DDA pela conta do beneficiário

**Status:** aceito em 2026-10-30. `/feature-new`. `entity_changed = true` (entidade derivada nova).
Ontologia **0.53.0**.

## Contexto

O `fin124` traz número, barras, valor e vencimento do boleto, mas **não o beneficiário**. A aba
"Boletos DDA" só mostra um credor quando um título casa (vínculo ou candidato): para os boletos
"sem título" a analista não sabe de quem é. O campo livre das barras (posições 20–44) codifica a conta
do beneficiário para os bancos grandes, e essa conta é um identificador estável do fornecedor.

## Decisão

1. **Chave da conta** (`ContaBeneficiariaBoleto`): uma tabela de layouts por banco emissor. Validados:
   237 Bradesco (agência + conta), 341 Itaú (agência + conta), 033 Santander (código do beneficiário),
   001 BB (convênio de 6 ou, com 6 zeros, de 7) e, depois, 748 Sicredi, 422 Safra, 745 Citibank, 104 Caixa, 085 Ailos e 756 Sicoob. Banco fora da tabela **não tem chave**: não se adivinha
   (≠ `CodigoBarrasBoleto.emissor`, que cai numa chave genérica). Acrescentar um banco é dado + teste.
2. **Aprendizado, não cadastro.** `sispag_fornecedor_conta_boleto` (migration 0093) mapeia chave →
   `pes_cod` + credor + `origem` + contagem de evidências + última vez vista. É **derivada**, reconstruída
   por inteiro ao fim de cada `BoletoDdaService.sincronizar` (e nunca na leitura da aba, nem no
   `bootstrapAppContainer`). Falha do aprendizado = WARN e o mapeamento anterior fica.
3. **Três origens, em ordem de confiança (inferência só nomeia com 2+ boletos distintos; as demais valem com 1):** `VINCULADO` (o Conexos ligou o boleto a um título; vale o
   `pes_cod` do título), `CONFIRMADO` (decisão `CONFIRMADA` da analista) e `INFERIDO` (boleto sem vínculo
   cujo valor + dia civil de vencimento batem com **um único** título da carteira, com `pes_cod`). Por
   chave vale só a origem mais confiável presente; a inferência nunca desfaz um vínculo.
4. **Ambiguidade:** a chave que, na origem vencedora, já apontou 2+ `pes_cod` é `ambiguo` e **não é
   nomeada** (nunca por maioria).
5. **Tela:** `BoletoDdaConsolidado.fornecedor?` entra DEPOIS da consolidação (passo de enriquecimento;
   situação e candidatos intocados). Coluna "Fornecedor" com o selo **"provável"** quando `INFERIDO`; o
   nome entra no texto de busca. A chave da conta nunca sai pela API.

## Desvio medido da entrevista

A entrevista dizia "um único título **ativo**". Medido na cópia de PRD, os títulos que já saíram da
carteira (`ativo = false`, 12.280 de 13.726) são justamente os que explicam os boletos antigos: restrito
aos ativos o aprendizado dava 43 contas; sobre toda a história da tabela, 91 (o alvo era ~93). A unicidade
passa a ser "um único título **com aquele valor e aquele dia**" na tabela inteira (ativos e inativos), que
é também mais rígida contra falso positivo.

## Fora de escopo (fase 2, ver o inbox)

Restringir os candidatos ao mesmo credor; boleto = soma de 2–3 títulos; título = soma de vários boletos;
filtro por fornecedor.

## Consequências

- Nenhum write no Conexos. Uma tabela derivada, descartável (o reverse só a derruba).
- A inferência herda o limite da carteira: uma conta de intermediário (várias empresas) vira `ambiguo`
  assim que duas aparecem; até lá, "provável" é o aviso honesto.
