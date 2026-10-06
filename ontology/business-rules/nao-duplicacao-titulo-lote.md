---
name: nao-duplicacao-titulo-lote
type: business-rule
entity: LotePagamento
ontology_version: "0.5"
implementation_status: planned
invariant: I3
related_files:
  - src/backend/migrations/0023_lote_pagamento.sql
  - src/backend/domain/service/sispag/SispagPainelService.ts
last_review: 2026-07-07
has_canonical_test: false
---

# Regra: nao-duplicacao-titulo-lote (um título não em dois lotes RASCUNHO)

> **Invariante I3 — Não-duplicação.** Um mesmo título (`filCod:docCod:titCod`) **não pode estar em
> dois lotes `RASCUNHO` ao mesmo tempo**. Garantido por **UNIQUE parcial** no banco — não só por
> check em app. Evita que o mesmo pagamento seja montado em dois lotes candidatos (e, na fatia
> futura, enviado/pago em duplicidade).

## Enunciado

```
UNIQUE (fil_cod, doc_cod, tit_cod)  WHERE status = 'RASCUNHO'
```

- A chave do título é `filCod:doc_cod:tit_cod` (espelha a identidade do `TituloAPagar`).
- A UNIQUE é **parcial** (`WHERE status = 'RASCUNHO'`): só lotes em montagem competem. Um lote
  `CANCELADO` (ou, na fatia futura, processado) **libera** o título — ele pode reentrar num novo
  lote. `FINALIZADO` ainda ocupa? **Sim nesta fatia** — enquanto reversível por `reabrirLote`, o
  título de um lote FINALIZADO segue "reservado" (a UNIQUE parcial cobre `RASCUNHO`; o app estende
  a checagem a `FINALIZADO` para não duplicar um título já comprometido). *(A modelagem exata da
  cobertura RASCUNHO+FINALIZADO na UNIQUE é decisão de implementação do TaskScoper — o invariante
  de domínio é "não em dois lotes vivos".)*

## Emenda ADR-0064 (2026-10-06): lotes comprometidos e mover

- **Comprometido:** título num lote `FINALIZADO` ou `REMESSA_GERADA` não entra em outro lote nem se
  move (`TitleInCommittedBatchError`, 409). O painel projeta `loteComprometido { id, status }` e a aba
  de títulos bloqueia a seleção explicando o motivo. `RETORNADO` fica fora (item rejeitado precisa
  voltar a ser pago; em aberto).
- **Mover:** `incluirTitulo` com `mover: true` tira o título do outro lote RASCUNHO e o inclui no
  destino na MESMA transação (a origem só perde o item se ainda for RASCUNHO; vira manual; é cancelada
  se ficar vazia). I3 nunca é violada: em nenhum instante o título está em dois RASCUNHO. Sem
  `mover`, a recusa (`TituloEmOutroLoteError`) segue igual.

## Por que UNIQUE parcial no banco (e não só em app)

Duas analistas incluindo o mesmo título ao mesmo tempo passam ambas no check de app (leem "não
existe") e gravam — dupla-inclusão. A **UNIQUE parcial** é a única rede que fecha essa corrida: uma
grava, a outra recebe violação de constraint (traduzida para bloqueio com mensagem). Espelha a
doutrina de Permutas (`permuta_alocacao` UNIQUE por par) e o I6 (concorrência otimista) — defesa em
profundidade: check em app + constraint no banco.

## Onde atua

- `incluirTituloNoLote` (L2): tenta inserir o `ItemLote`; colisão na UNIQUE → **bloqueado**
  ("título já está no lote candidato #N").
- `cancelarLote` (L5): libera os títulos (saem da UNIQUE), disponíveis para um novo lote.

## Teste canônico (a escrever no TDD)

- `has_canonical_test: false` — caso canônico: incluir título T no lote A (RASCUNHO) → **ok**;
  incluir o mesmo T no lote B (RASCUNHO) → **bloqueado** (`ja-em-lote`); cancelar A → incluir T em B
  → **ok** (liberado). Concorrência: duas inclusões simultâneas de T → exatamente uma vence. Fixado
  pelo TaskScoper/TDD.

## Universalidade

Universal: um título a pagar é **um** compromisso — não pode ser montado/enviado duas vezes. Impedir
que o mesmo pagamento apareça em dois lotes vivos é invariante de qualquer contas-a-pagar. A
estrutura (chave do título + UNIQUE parcial sobre lotes vivos) é do domínio; independe do tenant.
