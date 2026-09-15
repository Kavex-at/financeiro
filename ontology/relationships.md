# Relacionamentos entre Entidades

> **Frente I — Permutas.** Relações do domínio. Atualizado pelo `OntologyCurator` a cada
> entidade/relação aceita. Sync 2026-06-21 (commit df90fa6): adiciona `Permuta` (alocação) e
> `ClienteFiltro` (ADR-0007/0008/0009).

## Frente I — Permutas

| Origem | Relação | Destino | Cardinalidade |
|--------|---------|---------|---------------|
| `Adiantamento` | vinculado por `priCod` a | `Invoice` | 1—1 na permuta automática (P0-6: 1 invoice FINALIZADA); N:M → casamento-manual/permuta-manual |
| `Adiantamento` | tem declaração (Gate 4) | `DeclaracaoImportacao` | 1—1 (D.I XOR DUIMP, I2) — dispensada na permuta-manual (cliente-filtro) |
| `Adiantamento` | marcado por (via `docCod`) | `ExcecaoPermuta` | 1—N (no máximo 1 ativa; soft-delete) — `BLOQUEADA/sem-saldo-permutar` → `JA_PERMUTADO` (T7, ADR-0047) |
| `Adiantamento` | roteado por (via `pesCod`) | `ClienteFiltro` | N—1 (importador cadastrado → permuta-manual, ADR-0007) |
| `PermutaCandidata` | tem lado-débito | `Adiantamento` | 1—1 |
| `PermutaCandidata` | tem lado-crédito (quando casada) | `Invoice` | 1—1 (casada = exatamente 1 invoice FINALIZADA, P0-6) |
| `PermutaCandidata` | tem data-base via | `DeclaracaoImportacao` | 1—1 (existência/XOR; data-base P0-4 RESOLVIDO) |
| `PermutaCandidata` | tem cálculo derivado | `VariacaoCambial` | 1—1 (classificação por TAXA de câmbio, P0-1) |
| `PermutaCandidata` | origina (permuta-manual/casamento-manual) | `Permuta` | 1—* (alocações N:M, ADR-0008) |
| `Permuta` | tem lado-débito (link livre) | `Adiantamento` | N—1 (via `adiantamentoDocCod`) |
| `Permuta` | tem lado-crédito (link livre, pode ser cross-process) | `Invoice` | N—1 (via `invoiceDocCod`) |
| `Permuta` | tem variação (valor parcial, taxa da invoice) | `VariacaoCambial` | 1—1 |

> **Fase 3 (fora de escopo):** a `Permuta` consumada (alocação) **já é modelada** (`permuta_alocacao`,
> READ-ONLY). O que falta é a **baixa efetiva** no ERP via a ação `reconciliarPermuta` (escrita
> `fin010`) — caminho de write-back não validado (risco #1, ADR-0002/0003 O3). Por isso `Permuta` é
> `partial`.
