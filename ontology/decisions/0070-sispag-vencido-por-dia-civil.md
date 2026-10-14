---
adr_number: 0070
title: SISPAG — título que vence hoje não é vencido (vencido por dia civil de Brasília)
date: 2026-10-14
status: accepted
type: clarification
related_entities: [TituloAPagar, LotePagamento]
related_business_rules: [data-debito-remessa-sispag, elegibilidade-titulo-lote]
continues: [0049, 0064]
evidence:
  - "medição PRD read-only 2026-10-14 13:44 BRT: 92 títulos aprovados e não pagos com vencimento 14/10 (R$ 1.474.343,69) satisfaziam `vencimento < now()`; 15 lotes automáticos RASCUNHO / 79 itens seriam desfeitos na próxima formação, todos só por títulos de hoje; elegíveis para formação: 0 pelo código, 12 pelo dia civil"
  - "titulo_a_pagar.vencimento = 00:00Z em 100% das linhas (memória datas-conexos-sao-utc-meia-noite)"
---

# ADR 0070: vencido por dia civil de Brasília

**Branch:** `fix/sispag-vencimento-hoje`. `/feature-tweak --urgent` (sem entrevista, sem Regis-Review e
sem Ground-Truth; este ADR é o retroativo exigido em 24h). `entity_changed = false`.
**Status da implementação:** `implemented` (app v0.66.2, ontologia v0.40.3).

## Contexto

O Conexos grava o vencimento como a meia-noite UTC do dia civil (às vezes 15:00Z). Três pontos do
SISPAG comparavam esse epoch com o **instante** atual:

| Ponto | Código antigo | Efeito a partir das 09:00 BRT (12:00Z) |
|-------|---------------|----------------------------------------|
| Aging do painel | `Math.round((vencimento − Date.now()) / dia)` | vence hoje → "vencido 1d", conta no KPI Vencidos, sai do filtro "A vencer" |
| Elegibilidade da formação | `vencimento >= now()` | título de hoje nunca entra em lote automático |
| Limpeza da formação | `DELETE … WHERE vencimento < now()` | **apaga** o lote automático RASCUNHO que contém título de hoje |

A terceira é destrutiva: o botão "Formar lotes automáticos" (ou a rodada das 07:00) desfazia o lote,
e a segunda impedia remontá-lo. A regra R2 aceita débito no próprio dia do vencimento, então o
título que vence hoje é **a vencer**.

## Decisão

1. **Vencido = dia de vencimento antes de hoje**, comparando **dias civis**: hoje é a data de
   Brasília (`BankingCalendar.todayBrt`); o dia do vencimento é o do epoch do ERP pelo relógio UTC
   (`fromErpEpoch`, mesma semântica do export e da data de débito).
2. `diasAteVencimento` = diferença em dias civis (vence hoje = 0).
3. As consultas recebem `hoje` (o dia civil codificado como o ERP, 00:00Z) como parâmetro: a
   elegibilidade é `vencimento >= $hoje AND vencimento < $hoje + (maxDias + 1) dias` (janela
   `hoje..hoje+7` inclusive); a limpeza é `vencimento < $hoje`. O "hoje" é decidido no service, não
   no SQL.

Não muda regra de negócio: a ontologia já dizia "só a vencer, vencidos desfazem o lote". Ela apenas
não definia "vencido", e o código preencheu a lacuna com o instante. A definição entra em
`formar-lotes-automaticos.md` e `montar-painel-pagamentos.md`.

## Consequências

- O título de hoje fica em "A vencer" o dia inteiro, inclusive das 21h às 24h de Brasília (quando o
  dia UTC já virou), e passa a vencido à meia-noite de Brasília.
- Lotes já desfeitos por este bug não são restaurados; os títulos que ainda vencem hoje ou depois
  voltam na próxima formação.
- Provas: testes unitários com relógio fixo em 00:30, 09:00, 13:44, 21:30 e 23:59 BRT; teste de
  integração em Postgres real (`VencimentoCivil.integration.test.ts`) com as bordas ontem / hoje
  00:00Z / hoje 15:00Z / hoje+7 / hoje+8 e a limpeza de lotes.
- Lição registrada em `CLAUDE.md` (Gotchas): vencimento do Conexos é dia civil, não instante.

## Dispensas do `--urgent`

Sem entrevista (o diagnóstico veio da sessão `sispag boletos dda flag`, com medição em PRD), sem
Regis-Review e sem Ground-Truth Validation. PatternGuardian rodou: PASS.
