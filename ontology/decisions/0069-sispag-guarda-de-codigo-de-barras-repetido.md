---
adr_number: 0069
title: SISPAG — guarda de código de barras repetido na remessa (um código de barras, um item)
date: 2026-10-14
status: accepted
type: addition
related_entities: [LotePagamento, TituloAPagar, BoletoDda]
related_business_rules: [boleto-exige-codigo-de-barras, verificacao-ted-pix-sispag, sugestao-boleto-dda-sispag]
continues: [0040, 0063, 0068]
evidence:
  - ontology/_inbox/sispag-guarda-codbar-repetido-interview.md
  - ontology/_inbox/sispag-guarda-codbar-repetido-ontology-diff.md
  - "regis-review 2026-10-14-1330, F-6; followups fault-tolerance-5 (sispag-sugestao-boleto-dda-regis-followups.md)"
  - "medição PRD: 27 títulos flagados em grupos com mais títulos que boletos; caso PEDRONI fil 2, 10 títulos de R$ 1.412,00 venc. 14/10, 2 boletos"
  - "experimentos HML 2026-10-14 (branch chore/sispag-hml-bind-experimentos): o ERP não valida o DV do código digitado nem o compara com o título; importar descarta o código do payload; o código só chega ao item via PUT fin015/finItemSispag após validacao/codigoBarras + confirmaCodigoBarras"
---

# ADR 0069: guarda de código de barras repetido

**Branch:** `fix/sispag-guarda-codbar-repetido`. `/feature-tweak`. `entity_changed = true`.
**Status da implementação:** `implemented` (app v0.66.1, ontologia v0.40.2).

> **Reconferido no ship (2026-10-14):** `origin/main` não avançou desde a base (último ADR 0068, ontologia
> 0.40.0 + a 0.40.1 desta branch, app 0.66.0); número 0069 livre.

## Contexto
`titVldReflexoDdaAssoc` é "existe boleto DDA com mesmo valor e vencimento", não reserva 1:1. O ERP anexa o
mesmo código de barras a cada item importado; o `.REM` pagaria o mesmo boleto N vezes. A única guarda era de
ausência (ADR-0040). A duplicidade por título (ADR-0063) não vê isso: são títulos distintos.

Achado de HML (2026-10-14): o ERP **não valida** o dígito verificador de um código digitado nem o compara
com o título; `importar` descarta o código enviado no payload; o código chega ao item só por
`PUT fin015/finItemSispag`, depois de `validacao/codigoBarras` + `confirmaCodigoBarras`. Logo o ERP não é
uma segunda linha de defesa contra código repetido ou malformado.

## Decisão
Nova invariante **I16** em `boleto-exige-codigo-de-barras`: um código de barras normalizado (44 dígitos), um
item. Checada (1) logo após `importarTitulos`, antes de `finalizarLote`, sobre `listarLinhasDigitaveisDoLote`;
(2) nos segmentos J do `.REM` em `RemessaCnabValidator`, como rede. No acerto, aborta com
`BoletoCodigoBarrasRepetidoError` (409), marca o ledger `failed`, deixa o rascunho e a analista retira o
título repetido do lote local; a retomada reaproveita o rascunho. Código presente porém inválido falha
fechado. Nada do código é persistido nem logado em claro (só mascarado). Sem permissão nova; lote manual e
automático compartilham o caminho.

**Derivação e momento.** A unicidade roda sobre o código de 44 dígitos **derivado de `itsNumCodbar` depois
que o item é final**: pós-import e, no passo 2 da ADR-0068, também pós-edição (`PUT finItemSispag`). A guarda
**não pode confiar que o ERP rejeitou** um código malformado. **É pré-requisito do passo 2 da ADR-0068 (o
bind de valor igual).**

## Rejeitado
- **Descartar o item repetido em silêncio / remover do rascunho por API:** viola human-in-the-loop; remoção
  por API não verificada. (REJECT-WORKAROUND)
- **Regra irmã `boleto-codbar-unico`:** mesmo ponto e mesmo fail-closed; vira invariante da regra existente. (REJECT-DUPLICATE)
- **Guarda entre lotes vivos e contra boleto pago:** exige hash salgado persistido + migration. Follow-up
  com ADR próprio. (REJECT-PREMATURE)

## Consequências
Pré-requisito do passo 2 da ADR-0068. Custo: 0 chamadas novas ao ERP (reusa a leitura do lote). Risco
residual: reenvio entre lotes não é detectado até o follow-up.
