# Follow-ups do Regis-Review — coluna "Forma de pagamento" (PR #115)

Origem: `docs/regis-review/2026-10-13-1505-forma-pagamento/` (versão reduzida: modifiability,
testability, performance). Nenhum P0 — itens abaixo **não implementados**, para decisão.

> 2026-10-13: modifiability-1, modifiability-2 e o código morto foram feitos no próprio PR #115,
> a pedido do usuário. O resto segue em aberto.

## P2

- [x] **modifiability-1 — Uma fonte para os rótulos do `titVldPagopor`.** Hoje há três cópias:
  `FORMA_CONEXOS_ROTULO` e `FORMA_ROTULO_TABELA` (`src/frontend/lib/sispag.ts`) e
  `PAGO_POR_CONEXOS_ROTULO` (`src/backend/domain/interface/sispag/PagoPorConexos.ts`). Colapsar as
  duas do frontend e adicionar teste de paridade de códigos com o backend. Tamanho S.
- [x] **modifiability-2 — Código desconhecido não é "sem forma".** Em `formaDePagamento`, um
  código fora do mapa (ex.: 11) cai em `sem-forma`. Dar a ele chip/rótulo próprio (`forma-<n>`,
  "código <n>"). Tamanho S.
- [ ] **testability-1 — Combinações do filtro de categoria.** Cobrir boleto+categoria,
  data+categoria, clique no chip, volta à página 1 e `dicaCategoria`. Tamanho S.
- [ ] **testability-2 — Asserções de página.** `sispag/page.test.tsx` não verifica o cabeçalho
  "Forma de pagamento", os chips nem a dica. Tamanho S.

## P3

- [ ] **patternguardian (6ecf434) — WARN de código desconhecido a cada rodada.** Um código fora de
  `PAGO_POR_CONEXOS_ROTULO` gera um WARN por código por filial em TODA ingestão, sem memória entre
  rodadas. É o lembrete desejado enquanto o rótulo não é cadastrado; se fizer barulho, dedupe ou
  cooldown.

- [x] **modifiability (código morto)** — `rotuloFormaConexos` e `FORMA_CONEXOS_ROTULO` sem chamador
  após o PR #115 (some junto com modifiability-1).
- [ ] **testability-3 — Chip escolhido que desaparece.** Se outro filtro zera a categoria
  escolhida, o chip some e o estado fica: tabela vazia sem chip pressionado. Decidir (voltar a
  "Todos"? manter o chip com 0?) e fixar em teste.
- [ ] **modifiability-3 — Hook de filtro com 3 opt-ins.** `useTabelaFiltro` (em `app/permutas/`,
  importado pelo SISPAG) ganhou `getCategoria`; refatorar e mover para `lib/` quando vier o
  próximo filtro. Tamanho M.
- [ ] **performance-1 — Cópia evitável.** `filtrados` sempre copia o array, mesmo sem chip ativo;
  devolver `semBoleto` direto nesse caso (+ teste de estabilidade de referência). Acessores
  estáveis em `extras` são exigência não verificada (inline anularia os memos).
