# Regis-Review — Permutas `pagamento-parcial` (progresso de pagamento) — DISPENSADO (adiado)

**Branch:** `feat/permutas-multiplas` · **Data:** 2026-06-20 · **App:** v0.3.0 · **Ontologia:** v0.2.4

## Status do gate

Gate **Regis-Review (8-QA) adiado por decisão do Yuri** (opt-out explícito). Mudança pequena,
**read-only no ERP** (não toca o Gate 3 / invariante I3), reaproveita a chamada de detalhe já feita
(zero fan-out novo) e passou nas duas revisões direcionadas:

- **PatternGuardian:** 0 violações (59 checks) — SQL parametrizado no upsert (`$valorTotal_i`/`$valorAberto_i`),
  modifiers explícitos, optional `?:`, sem `!`, DI ok.
- **DesignSystemReviewer:** 0 violações — `text-muted-foreground` (token), reuso de `Campo`/`formatNumber`/
  `moedaCodigo`, consistente com o campo irmão "Saldo a permutar".

## Pendência

Rodar `/regis-review --quick` escopado ao delta antes do merge para `main` (ou registrar dispensa
definitiva no PR). Diretórios: `src/backend/{domain/client,domain/interface/permutas,domain/repository/permutas,domain/service/permutas,migrations}`,
`src/frontend/{app/permutas,lib}`.

## Delta entregue

- BE: `ConexosClient.mapDetalheTitulos`/`getDetalheTitulos` (+`valorTotal`/`valorAberto`), `Adiantamento`/
  `Gestao.PermutaDetalhe` (+2 campos), `EleicaoPermutasService` (hidrata), `IngestaoPermutasService.toAdiantamentoRow`,
  `PermutaRelationalRepository` (AdiantamentoRow + upsert + mapAdiantamentoRow), migration `0010`,
  `GestaoPermutasService.toDetalhe`.
- FE: `lib/utils.progressoPagamento` (+teste), `lib/types.PermutaDetalhe`, `app/permutas/page.tsx`
  (campo "Progresso de pagamento"), `lib/permutas-fixture` (exemplo `nao-pago`).

## Relacionado (NÃO neste escopo — domínio/Fatia 2)

- **`vc-permuta-parcial`** (conexos.md): permuta parcial / variação cambial sobre valor PARCIAL.
- **Desbloquear** um `nao-pago` exige regra do Yuri (override do Gate 3 / I3) + write-back `fin010`.
- ~~`residual-pago-centavos` (P2): teto de resíduo de centavos para "totalmente pago".~~
  **RESOLVIDO em 2026-09-14 (ADR-0046, feature `permutas-saldo-ordem-centavos`).** Decisão do usuário:
  tolerância **absoluta de R$ 1,00 (BRL)**, mesmo teto da âncora I-Write-6. Gate 3 = `|mnyTitAberto| ≤
  R$1,00`; Gate 2 = `valorPermutar > R$1,00` (≤ R$1,00 = sem saldo → `ja-permutado` se `valorPermutado
  > 0`, senão `sem-saldo-permutar`); roteamento de cliente-filtro com os mesmos predicados. Escopo: só a
  elegibilidade do adiantamento. `Invoice.pago` e os títulos do SISPAG seguem estritos. Casos: doc 8721
  (R$ 0,02 em aberto) e 28 adtos INOX com resíduo de USD 0,00–0,02.
