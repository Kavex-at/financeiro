---
name: elegibilidade-titulo-lote
type: business-rule
entity: LotePagamento
ontology_version: "0.5"
implementation_status: planned
invariant: I2
related_files:
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/client/ConexosSispagClient.ts
last_review: 2026-09-14
has_canonical_test: false
open-gap:
  - "níveis-de-alçada (Flávia) — quantos níveis titVld1/2/3libera a Columbia usa DE FATO? Nesta fatia liberado = AND das flags presentes; recalibrável por tenant sem mudar a estrutura."
  - "residual-pago-centavos — herdado de Permutas: um título com aberto=centavos conta como pago? Em Permutas foi decidido SÓ para o Gate 3 do adiantamento (ADR-0046, 2026-09-14: aberto ≤ R$1,00), sem estender a títulos SISPAG nem a Invoice.pago. Para o SISPAG segue aberto: estender a tolerância exige decisão própria."
---

# Regra: elegibilidade-titulo-lote (só aprovado + não pago entra no lote)

> **Invariante I2 — Elegibilidade do item.** Um `TituloAPagar` só pode virar `ItemLote` (entrar num
> `LotePagamento`) quando está **aprovado pela alçada (`liberado`)** **E** **não pago**. Caso
> contrário, a inclusão é **bloqueada com mensagem** (visibilidade, não falha silenciosa).

## Enunciado

```
elegivelParaLote(titulo) ⇔
    liberado(titulo) = (titVld1libera==1 ∧ titVld2libera==1 ∧ titVld3libera==1)   ∧
    ¬pago(titulo)
```

- **`liberado` (aprovado para baixa):** o AND das flags de **alçada de liberação**
  `titVld1libera`/`titVld2libera`/`titVld3libera` (`com308`) que a Columbia usa. Um título ainda
  em alguma alçada pendente **não** é elegível. (`fin102` bloqueio / `fin103` liberação / `fin106`
  alçadas / `fin007/liberar` governam essas flags no ERP.)
- **`¬pago`:** o título ainda em aberto (não quitado por baixa `fin010`/borderô). Pagar de novo é o
  risco que a regra evita.

Falha em qualquer conjunto → inclusão **BLOQUEADA** (reportada na UI com o motivo). O painel mostra
esses títulos como visibilidade (aprovado-mas-pago / pendente-de-alçada), não como erro.

## Onde a regra atua (dois pontos)

1. **Na inclusão** (`incluirTituloNoLote`, L2) — barra o título inelegível na porta.
2. **Na finalização** (`finalizarLote`, L3) — **revalida** todos os itens: um título que virou
   `pago` (ou perdeu liberação) entre a inclusão e o gate barra a finalização. Evita finalizar um
   lote com item que "envelheceu" para inelegível.

## Evidência (produção, 2026-07-07)

- "Aprovado para baixa = as flags de alçada de liberação (1–3 níveis)" — confirmado no probe
  read-only (`sispag-native-vs-nexxera.md` §3). Real: doc `100` título `1`, R$ 135.724,80,
  `titVld1/2/3libera=1`, `titVldEnviaBanco=0`, `vldBordero=1` (aprovado nos 3 níveis, ainda não
  enviado) — o caso canônico de elegível.
- Espelha o **Gate 3 de Permutas** (`elegibilidade-permuta.md`): "não pagar/permutar o que já
  saiu". A definição estrita de `pago` (aberto = 0) e o resíduo de centavos são o mesmo dilema —
  ver open-gap `residual-pago-centavos`.

## Teste canônico (a escrever no TDD)

- `has_canonical_test: false` — caso canônico: título com `titVld1/2/3libera=1` + não pago →
  **elegível** (entra no lote); mesmo título com uma flag de alçada = 0 → **bloqueado**
  (`nao-aprovado`); título aprovado mas já pago → **bloqueado** (`ja-pago`). Fixado pelo
  TaskScoper/TDD. Âncora real: doc 100 (aprovado) vs. um título com alçada pendente.

## Universalidade

Universal: só se paga o que foi **aprovado** e ainda está **em aberto** — verdade de qualquer
contas-a-pagar, não só da Columbia. A estrutura (dois gates: aprovação de alçada + não-pago) é do
domínio; **quantos níveis** de alçada e o **teto de resíduo** de "pago" são config/decisão do
tenant (open-gaps).
