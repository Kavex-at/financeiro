---
name: lote-uma-filial
type: business-rule
entity: LotePagamento
ontology_version: "0.5"
implementation_status: planned
invariant: I4
related_files:
  - src/backend/migrations/0023_lote_pagamento.sql
  - src/backend/domain/service/sispag/SispagPainelService.ts
last_review: 2026-10-20
has_canonical_test: false
open-gap:
  - "agrupamento-banco-conta (Flávia) — nesta fatia o lote é por FILIAL só; agrupar também por banco+conta (como o fin015 nativo faz por filial/banco) fica para a fatia de transporte, quando banco/conta vira chave do arquivo de remessa."
---

# Regra: lote-uma-filial (todos os itens de um lote são da mesma filial)

> **Invariante I4 — Uma filial por lote.** Todos os `ItemLote` de um `LotePagamento` têm o **mesmo
> `filCod`** do lote. Um título de outra filial **não** entra — abre-se outro lote. Multi-filial =
> múltiplos lotes.

## Enunciado

```
∀ item ∈ lote.itens :  item.filCod = lote.filCod
```

- O `filCod` é fixado na criação do lote (`criarLoteCandidato`, L1) e é imutável.
- Na inclusão (`incluirTituloNoLote`, L2), `titulo.filCod ≠ lote.filCod` → **bloqueado** com
  mensagem ("título é da filial X; este lote é da filial Y — abra outro lote").

## Por que por filial (compatibilidade com o `fin015` nativo)

O lote SISPAG nativo do ERP (`FinLoteSispag`, `fin015`) é **por filial/banco** — a remessa CNAB
sai por `layoutConta` de uma filial. Modelar nosso lote candidato **por filial** mantém o mapeamento
1:1 com o que a próxima fatia vai dirigir (`finalizarLote` → `fin015`), sem ter que quebrar um lote
multi-filial na hora de gerar a remessa. Evidência: 17 lotes `fin015` reais, cada um de **uma
filial** (fil1=3, fil2=11, fil4=2, fil6=1), bancos Itaú/Santander (`sispag-native-vs-nexxera.md` §1).

## Decisão: filial só (banco/conta = metadado opcional)

Nesta fatia o **agrupamento é por filial**; `banco`/`conta` são **metadados opcionais** do lote
(informativos), **não** chave de agrupamento. Agrupar também por banco+conta (o `fin015` é por
filial/banco) é a pergunta em aberto `agrupamento-banco-conta` (Flávia) — adiada para a fatia de
transporte, quando banco/conta passa a ser a chave do arquivo de remessa. Registrar agora como
metadado deixa a promoção futura barata, sem reseed. Ver ADR-0015.

## Emenda ADR-0077 (`planned`) — boleto agrupado

Os títulos do grupo (`GrupoBoleto`) e o borderô `fin010` que o paga são da filial do lote (I21d). Grupo que
cruza filial não é confirmável nesta entrega ("não suportado, pagar à mão"; sonda V4 no watchlist). Ver
`business-rules/boleto-agrupado-sispag.md`.

## Teste canônico (a escrever no TDD)

- `has_canonical_test: false` — caso canônico: lote da fil 2 + incluir título da fil 2 → **ok**;
  incluir título da fil 4 no mesmo lote → **bloqueado** (`outra-filial`). Fixado pelo TaskScoper/TDD.

## Universalidade

Universal: agrupar pagamentos por unidade organizacional/filial (a que origina a obrigação e cuja
conta paga) é padrão de qualquer contas-a-pagar multi-filial — e é o que o motor nativo já faz. A
estrutura (uma filial por lote) é do domínio; **se também por banco/conta** é decisão do
tenant/fatia futura.
