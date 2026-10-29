---
adr_number: 0080
title: SISPAG — confirmação em conjunto de títulos irmãos escolhidos pela âncora de número
date: 2026-10-29
status: accepted
type: change
related_entities: [DecisaoSugestaoBoleto, ConfirmacaoEmissorBoleto, TituloAPagar, BoletoDda]
related_business_rules: [sugestao-boleto-dda-sispag, ajuste-centavos-titulo-sispag]
continues: [0068, 0072, 0074, 0079]
amends: []
decided_by: yuri
decided_on: 2026-10-29
evidence:
  - ontology/_inbox/sispag-confirmar-em-conjunto-interview.md (entrevista com o maintainer, 2026-10-29)
  - ontology/_inbox/sispag-confirmar-em-conjunto-ontology-diff.md (aprovado pelo maintainer em 2026-10-29)
  - "cópia local de PRD: NELSON HEUSI (pesCod 387) com 108 títulos ativos na filial 2, dezenas de R$ 647,56, cada um com o boleto do mesmo número"
---

# ADR 0080: confirmação em conjunto de títulos irmãos

**Status:** aceito em 2026-10-29 pelo Yuri (maintainer). `/feature-new`. `entity_changed = true`
(ação nova, invariante nova). Ontologia **0.51.0**. Tudo o que é novo nasce `planned`.

## Contexto

A âncora de número (I15s, ADR-0079) faz cada título de credores como NELSON HEUSI casar com o boleto
do mesmo número, mesmo entre dezenas de boletos idênticos. A analista ainda confirma um por um: abre a
gaveta, confere, confirma, abre a próxima. A informação para conferir os irmãos de uma vez já está
calculada no cenário.

## Decisão

Ação nova `confirmarSugestoesEmConjunto` e invariante **I15t** (texto completo na business rule
`sugestao-boleto-dda-sispag`):

| # | Ponto | Decisão |
|---|-------|---------|
| D1 | Elegibilidade | Mesmo `pesCod` e mesma filial; candidato confirmável com `NUMERO_CONFIAVEL`; sem reconhecimento exigido (I15o/I15r); fora: `AMBIGUA`, `DISPUTADA`, confirmados, em grupo (ADR-0077), em lote local finalizado |
| D2 | Seleção | Nada vem marcado; o título de origem é a primeira linha quando elegível |
| D3 | Falha parcial | Linha a linha pelo mesmo `confirmar`, em sequência; resultado por linha; nunca tudo-ou-nada |
| D9 (emenda, 2026-10-29) | Custo do conjunto | Um cenário do motor recalculado do banco por pedido (não o cache), usado por todas as linhas; título, boleto e decisões relidos ao vivo por linha; corridas no mesmo boleto continuam barradas pelos índices únicos |
| D4 | Limite | 30 linhas por pedido (`CONFIRMACAO_CONJUNTO_MAXIMO`), 422 acima |
| D5 | Trilha | `DECISAO_CONFIRMADA` por linha com `detalhe.conjunto = { id, tituloOrigem }`; sem evento do conjunto; sem migration |
| D6 | Aglomerado tipo TIME LOG | Aviso por linha `ESCOLHIDO_SO_PELO_NUMERO` (outro boleto do mesmo emissor, valor e vencimento no pool); continua marcável |
| D7 | Faixa (centavos e +1..+5 dias) | Listada e marcável com aviso `FAIXA_AJUSTE_MANUAL`; a I18a(4) não muda |
| D8 | Ajuste de centavos | O de hoje, um pedido por título, numa fila sequencial do conjunto |

## Alternativas rejeitadas

- **Tudo-ou-nada:** uma linha defasada travaria o conjunto inteiro e seguraria locks por mais tempo;
  cada linha já se protege sozinha com a releitura ao vivo do `confirmar`.
- **Excluir o aglomerado:** sumiria com a maior parte dos títulos do NELSON HEUSI, justamente o caso
  que motivou a ação.
- **Renegociar a faixa neste PR:** é uma escrita nova no `fin070` sem prova em HML para Δdias > 0; fica
  como PR próprio (follow-up P1 do ADR-0079).
- **Disparar os ajustes do conjunto em paralelo:** abriria até 30 renegociações simultâneas no ERP.

## Consequências

- Nenhuma regra de sugestão muda: não sobe tier, não alarga limite (I15d), zero escrita no ERP pela
  confirmação (I15b).
- **Medido na cópia de PRD (2026-10-29, banco descartável, Conexos stub):** com um cenário por linha,
  30 linhas levavam ~36,5 s (~1,4 s de motor por linha: 2.062 títulos, 27 mil boletos). Com D9, 30
  linhas em ~1,3 s; repetir o pedido devolve 30 `JA_CONFIRMADA`. Troca aceita pelo maintainer: a
  linha 5 não vê as linhas 1–4 no cenário (só importaria se dividissem o boleto, o que o banco recusa)
  e o par do emissor criado na linha 1 aparece como `FORTE`, não `CONHECIDO`, na evidência da linha 2.
- NELSON HEUSI, filial 2: 86 títulos elegíveis, 63 com o aviso `ESCOLHIDO_SO_PELO_NUMERO`.
- Pares da faixa confirmados em conjunto seguem pedindo renegociação manual no Conexos até a emenda
  da I18a(4).
