---
name: alocacao-sn-existente
type: business-rule
entity: SolicitacaoNumerario
ontology_version: "0.13"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Receb-3
related_files: []
last_review: 2026-08-03
has_canonical_test: false
---

# Regra: alocacao-sn-existente (baixa contra uma SN já existente) — I-Receb-3

> **Invariante I-Receb-3 — Alocação contra SN existente.** Quando uma alocação de recebimento é
> executada contra uma `SolicitacaoNumerario` **já existente** do processo (em vez de gerar uma nova):
> **(a)** o valor alocado **não pode exceder o saldo do título** da SN; **(b)** o caminho existente
> **não cria um segundo documento** (com299 pulado — sem SN duplicada); **(c)** a seleção é
> **confirmada pelo humano** (reafirma o gate human-in-the-loop, ADR-0002/0022). Introduzido pela
> ADR-0027. Enforcement na baixa (`gerarSolicitacaoNumerario`, ramo SN existente).

## Enunciado

```
existing-SN path (docCod selecionado):
  valor_alocado ≤ saldo_do_título(SN)              # (a) teto ≤ saldo
  ¬ criar novo documento com299                    # (b) sem duplicata
  seleção confirmada pela analista                 # (c) human-in-the-loop
```

- **(a) Teto ≤ saldo — o saldo é do TÍTULO, não do documento da lista.** O "Saldo" que limita a
  alocação **não** é o valor que aparece na listagem `com299/list` (esse é **document-level**:
  `mnyBruto`/`docMnyValor`). O saldo remanescente vem da leitura do título
  (`lov/TituloBorderoReceber`) que a **própria baixa `fin014` executa**. Logo o **ponto de
  enforcement** de I-Receb-3 é a **baixa/título**, não o valor da lista — over-allocation contra o
  saldo do título falha na baixa. É uma distinção deliberada: a lista serve para *escolher* a SN, não
  para *validar o teto*.
- **(b) Sem duplicata.** O ramo existente **pula** a geração `com299` e a completação
  (`completarSnAdiantamento`): referencia o `docCod` selecionado. Não se cria um segundo documento para
  a mesma finalidade. A idempotência reusa a chave `sn-real:{txnId}:{priCod}:{valor}`, com o handle
  passando a ser o `docCod` **selecionado** — a re-execução nunca duplica nem a SN nem a baixa.
- **(c) Humano confirma.** "Processar" é **gated na seleção**: a analista escolhe explicitamente
  "Criar novo SN" OU uma SN existente (docCod). Sem seleção, não executa. Reafirma o invariante
  transversal (ADR-0002/0022) — o sistema faz o mecânico, o humano confirma.

## Distinção — I-Receb-3 × I-Receb-1 (invariante-rateio)

Não confundir os dois tetos:

| Invariante | Teto | Onde |
|------------|------|------|
| **I-Receb-1** (`invariante-rateio`) | Σ das alocações ≤ `transacao.valor` (o que entrou no banco) | por pagamento (split) |
| **I-Receb-3** (esta) | valor de UMA alocação ≤ saldo do TÍTULO da SN selecionada | por SN existente |

São **tetos distintos, empilhados**: I-Receb-1 impede distribuir mais do que o crédito recebido;
I-Receb-3 impede baixar contra uma SN existente mais do que o título dela ainda comporta. Uma alocação
pode respeitar I-Receb-1 e ainda violar I-Receb-3 (SN existente quase quitada).

## Teste canônico (a escrever no TDD)

- `has_canonical_test: false` — casos: baixa ≤ saldo do título (ok); baixa > saldo do título →
  **bloqueado na baixa** (I-Receb-3a); ramo existente **não** dispara com299/gerDocProcesso
  (I-Receb-3b, sem documento novo); "Processar" sem seleção → **não executa** (I-Receb-3c).

## Universalidade

Universal: quando um documento de requisição de numerário já existe para um processo, reutilizá-lo tem
de respeitar o que ele ainda comporta (saldo), sem duplicar o documento, com o humano confirmando a
escolha — invariante de qualquer contas-a-receber com encomenda que permita reaproveitar a requisição.
A **estrutura** é do domínio; a fonte concreta do saldo (`lov/TituloBorderoReceber`) e os códigos
(`docVldTipo`/`docVldTipoAdto`) são instância/config do tenant. Ver ADR-0027,
`actions/recebimentos/gerar-solicitacao-numerario.md` e `integrations/conexos-com299-gerdoc.md`.
