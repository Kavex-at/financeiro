---
adr_number: 0071
title: SISPAG — vínculo do código de barras confirmado ao item do lote (passo 2 do ADR-0068, valor igual)
date: 2026-10-14
status: accepted
type: addition
related_entities: [LotePagamento, DecisaoSugestaoBoleto, ConfirmacaoEmissorBoleto, BoletoDda, BloqueioDuplicidade]
related_business_rules: [vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras, retomada-remessa-sispag]
continues: [0040, 0068, 0069]
evidence:
  - ontology/_inbox/sispag-passo2-vinculo-codbar-proposta.md
  - "experimentos HML 2026-10-14 (branch chore/sispag-hml-bind-experimentos, sispag-passo2-hml-achados.md): importar descarta o codigo; o codigo chega ao item por validacao/codigoBarras -> confirmaCodigoBarras -> PUT fin015/finItemSispag; o ERP nao valida DV nem compara com o titulo; vldVinculoDda continua 0; o finalizar recusa pagamento > fin064.totalAberto; barra de valor igual finaliza e a remessa sai"
  - "medicao PRD (ADR-0068/0069): ~836 titulos 'sem DDA' confirmaveis; caso PEDRONI (guarda I16 e pre-requisito)"
---

# ADR 0071: vínculo do código de barras confirmado ao item (valor igual)

**Branch:** `feat/sispag-passo2-vinculo-codbar`. `/feature-new`. `entity_changed = true`. Ontologia **0.42.0**
(`planned`, à frente do código). Sem código nesta etapa.

> **Reconferido (2026-10-14):** `origin/main` v0.67.0, ontologia 0.41.0, último ADR 0070; número 0071 livre.
> Reconferir antes do ship (versões colidem entre sessões paralelas).

## Contexto
O ADR-0068 deixou o passo 2 (gravar o código de barras do boleto confirmado no item do lote) como
REJECT-PREMATURE até haver prova em HML. A prova existe: o ERP descarta o código no `importar`; só
`validacao/codigoBarras` + `confirmaCodigoBarras` + `PUT fin015/finItemSispag` o grava no item, sem validar
DV nem comparar com o título. Barra de **valor igual** ao aberto finaliza e a remessa sai; acima do aberto é
recusada pelo `finalizar`. O ADR-0069 (guarda I16) é o pré-requisito e está implementado.

## Decisão
Nova regra `vinculo-codbar-item-sispag` (**I17a–l**) e nova ação `vincularCodigoBarrasAoItem`: etapa
`vincular_codbar` da remessa, entre `importar` e a guarda I16, que edita o item do **rascunho** nativo.
Escopo **só valor igual** (centavos) com `0 ≤ Δdias ≤ 5` e barra ≥ data de débito; decisão humana
`CONFIRMADA` não órfã com par vigente; **todas** as verificações são nossas (DV, banco, valor, data, juros 0);
sucesso = releitura; `PUT` em tentativa única. Modos `off/shadow/on` por filial (configuração, não ontologia).

Decisões do maintainer:
- **P0-1:** a decisão humana confirmada + verificações nossas autorizam o vínculo. **I15a emendada:** a
  confirmação passa de "só evidência" a condição **necessária, nunca suficiente** do vínculo com o modo `on`;
  a validação ao vivo (ADR-0040) segue sendo a autoridade **do caminho DDA**. I15b: exceção única, em outra regra.
- **P0-2:** falha pós-import **determinística** retira o item pela maquinaria da I16d, com novo
  `SystemRemovalReason = VINCULO_CODIGO_BARRAS_FALHOU`, e a remessa continua; **transitória/ambígua** aborta e
  retoma (`VinculoCodigoBarrasIncompletoError`), nunca retira (I16c).
- **P0-3:** ordem em PRD: HML V1–V9 → sonda **somente leitura** de permissão do robô → `shadow` em PRD →
  **um** título real controlado. Sem permissão de `PUT` verificada, o código sobe `off`/`shadow`.
- **P1:** janela `[0, +5]` (constante global da I15c); `shadow` visível por endpoint + log; desempate da
  I16d.1 prefere o título com decisão humana vigente quando exatamente um no grupo (fecha o follow-up P1-1(b)
  do ADR-0069); vínculo como colunas de `ItemLote` (1 migration, 0086: **cinco** colunas nullable em `lote_pagamento_item` + 3 tipos de evento na
  trilha `sispag_sugestao_boleto_evento` com `lote_id`/`decisao_id` e índice único parcial de idempotência, e a
  origem `VINCULO_CODIGO_BARRAS_FALHOU` na marca de retenção); endpoint `GET /sispag/lotes/:id/vinculos-previstos`.

Mudanças: 1 regra, 1 ação, 1 propriedade (`ItemLote.vinculoCodigoBarras`), etapa de memória
`vincular_codbar`, emendas em `sugestao-boleto-dda-sispag` (I15a/I15b), `boleto-exige-codigo-de-barras`
(ausência, I16d.1/I16d.2/I16h, enum I13j), `lote-pagamento` (entidade), `decisao-sugestao-boleto` (derivado
`aplicacao`, **sem** estado novo) e `retomada-remessa-sispag`. Sem entidade nova.

## Rejeitado
- **Estado persistido `APLICADO_NO_ERP` na decisão** (REJECT-WORKAROUND): aplicação é por remessa × tentativa;
  lote cancelado reaplica; o estado mentiria. Fica derivado `aplicacao` + trilha.
- **Entidade `VinculoCodigoBarras`** (REJECT-DUPLICATE): trilha + `ItemLote.vinculoCodigoBarras`.
- **Enviar a barra no `importar`** (REJECT-WORKAROUND): o ERP descarta.
- **Delegar DV/valor ao `validacao/codigoBarras`** (REJECT-WORKAROUND): é só decodificador.
- **Alterar o `.REM` depois de gerado** (REJECT-WORKAROUND): diverge do item do ERP e quebra retorno e baixa.
- **Retirar em qualquer falha** (REJECT-WORKAROUND): retiraria título bom; leitura incompleta nunca retira.
- **Vincular boleto acima/abaixo do título** (REJECT-PREMATURE): acima é inviável via SISPAG; abaixo não medido.
- **Tier `ATENCAO` vinculável** e **vínculo automático sem decisão** (REJECT-PREMATURE): I15d / passo 3.
- **Permissão nova `sispag:vincular`** (REJECT-PREMATURE): quem confirma já é `sispag:executar`.
- **Lista de filiais/modo na ontologia** (REJECT-CONFIG): variável de ambiente via `EnvironmentProvider`.

## Consequências
- Risco aceito e explicitado: boleto pago por vínculo pode reaparecer "livre" no `fin124` (sem `docCod/titCod`);
  a decisão `CONFIRMADA` reserva o boleto e a guarda I16 cobre o lote; a lacuna entre lotes vivos segue a do
  ADR-0069 (watchlist). A provar em HML (V6).
- A modalidade do item após o `PUT` (mesmo banco × outro banco; segmento J para emissor ≠ pagador) é
  **desconhecida** até HML V4.
- Universalidade: 1 cliente; revisão com o Francinei não bloqueante (watchlist).
- Verificações HML V1–V9 e V-PRD1/V-PRD2 (permissão do `PUT` no robô; um título real) são pré-condição de
  `on` em PRD. Na implementação conferir `docs-contexto/03_ontologia_financeiro.md` e `CLAUDE.md` (Gotchas:
  "vínculo só no rascunho; `PUT` nunca em lote finalizado").
