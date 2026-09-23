# tasks.md — SISPAG: retirar o título do lote pela aba de títulos

> `/feature-tweak sispag "retirar um título do lote pela aba de títulos"`
> Branch: `fix/sispag-reter-titulo-lote` · Ontologia v0.28.0 · ADR-0050
> `entity_changed = false` (emendas em `gerenciarLoteCandidato` e `montarPainelPagamentos`).

> **Simplificado em 2026-09-23.** A primeira versão desta lista também retinha o título da formação
> automática (tabela `titulo_retencao_formacao`, migration 0062, invariante na formação, badge,
> "Liberar", confirmação na lixeira). O usuário retirou a retenção antes do merge: o problema era de
> UX. As tasks abaixo são o que ficou.

## Estado de partida

- O painel marca só `emLote: boolean`; a linha não sabe em qual lote o título está.
- Tirar um título de um lote exige abrir a aba "Lotes candidatos", achar o lote e usar a lixeira.

---

### Task 1: Painel projeta o lote na linha do título

**Files:** `LotePagamentoRepository.ts` (+test), `SispagPainelService.ts` (+test), `SispagInterface.ts`

- `listTitulosEmRascunho` devolve também `loteId` e `automatico`.
- Cada título em lote RASCUNHO carrega `loteRascunho: { id, automatico }`, além de `emLote`.
- Teste cobre título em lote, título fora de lote e mesma chave em outra filial.

### Task 2: `retirarDoLote` no serviço e a rota

**Files:** `LotePagamentoService.ts` (+test), `TituloForaDeLoteError.ts`, `routes/sispag.ts` (+test)

- `retirarDoLote({ filCod, docCod, titCod, ator })` acha o lote RASCUNHO do título
  (`loteRascunhoComTitulo`) e delega a `removerTitulo`; sem lote → `TituloForaDeLoteError` (409).
- `POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote`, `requireRole('admin')`, chave
  validada com Zod (400), autor do JWT, devolve `{ lote }`.

### Task 3: Frontend

**Files:** `lib/sispag.ts` (+test), `page.tsx`, `LoteCard.tsx`, `RetirarDoLoteDialog.tsx`,
`loteDoTitulo.ts` (+test)

- `retirarDoLote(chave)` faz POST na rota nova com `encodeURIComponent` na chave.
- A linha em lote RASCUNHO mostra o lote como link: abre "Lotes candidatos" na página do lote, rola
  até o card, abre-o e o destaca.
- "Retirar do lote" abre confirmação (credor, documento, valor, lote) e, confirmada, recarrega painel
  e lotes; erro vira toast com a mensagem do backend.
- A lixeira dentro do lote não muda.

## Definition of Done

- `npm run typecheck`, `npm run lint` e `npm test` verdes em `src/backend` e `src/frontend`.
- PatternGuardian e DesignSystemReviewer aprovados.

## QA manual (dev)

1. Na aba de títulos, um título em lote mostra "Lote automático"/"Lote manual"; o link leva ao card.
2. "Retirar do lote" → o título sai do lote, fica selecionável, e um lote automático vira manual.
3. Incluir o mesmo título em outro lote logo em seguida funciona.
