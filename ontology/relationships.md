# Relacionamentos entre Entidades

> Relações do domínio. Atualizado pelo `OntologyCurator` a cada entidade/relação aceita.
> Sync 2026-06-21 (commit df90fa6): adiciona `Permuta` (alocação) e `ClienteFiltro` (ADR-0007/0008/0009).
> Sync 2026-08-06 (ADR-0030): adiciona a seção **transversal** de identidade e autoria (`Usuario`).

## Frente I — Permutas

| Origem | Relação | Destino | Cardinalidade |
|--------|---------|---------|---------------|
| `Adiantamento` | vinculado por `priCod` a | `Invoice` | 1—1 na permuta automática (P0-6: 1 invoice FINALIZADA); N:M → casamento-manual/permuta-manual |
| `Adiantamento` | tem declaração (Gate 4) | `DeclaracaoImportacao` | 1—1 (D.I XOR DUIMP, I2) — dispensada na permuta-manual (cliente-filtro) |
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

## Transversal — Identidade e autoria (todas as frentes)

> Adicionado 2026-08-06 (ADR-0030, feature `supabase-auth`). `Usuario` é a primeira entidade
> **transversal** da ontologia: não pertence a uma frente, atravessa as quatro.

| Origem | Relação | Destino | Cardinalidade |
|--------|---------|---------|---------------|
| `Usuario` | custodiado por (identidade externa, via `authUserId`) | `auth.users` (GoTrue, **EXTERNO**) | 1—1 · `NULL` enquanto pendente de migração |
| `Usuario` | opera o ERP como (credencial cifrada embutida) | `CredencialConexos` | 0..1—1 · ausente ⇒ degrada para o **usuário-robô** |
| `Usuario` | **executou** (`executado_por`) | `Permuta`, `Recebimento`, `SolicitacaoNumerario` | 1—N · **por valor (`username`), SEM FK** |
| `Usuario` | **criou** (`criado_por`) | `Permuta` (alocação), `LotePagamento`, `ClienteFiltro` | 1—N · **por valor (`username`), SEM FK** |
| `Usuario` | **cadastrou** (`created_by`) | `Usuario` | 1—N · **por valor (`username`), SEM FK** |

> **A relação é semântica, não referencial.** As colunas de auditoria são `TEXT` **sem FK** — apagar a
> linha do `Usuario` não quebraria nada *sintaticamente*, ela apenas deixaria de ser **resolvível**. É
> exatamente por isso que **I-Usuario-2** (`username` imutável) e **I-Usuario-3** (sem hard-delete)
> precisam ser explícitos na ontologia, em vez de confiados ao banco.
>
> Pelo mesmo motivo, o ator é **sempre o `username`, nunca o `sub`** do provedor de identidade
> (I-Usuario-1) — é o que mantém a trilha contínua através de qualquer troca de IdP. Ver
> `business-rules/ator-da-trilha-de-auditoria.md`.
