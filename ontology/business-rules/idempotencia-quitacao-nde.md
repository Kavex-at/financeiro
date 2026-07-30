---
name: idempotencia-quitacao-nde
type: business-rule
entity: Recebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Receb-2
related_files: []
last_review: 2026-07-24
has_canonical_test: false
---

# Regra: idempotencia-quitacao-nde (execução idempotente + reversível) — STUB (Fase 0/5)

> **Invariante I-Receb-2 — Idempotência e reversibilidade da execução.** Uma re-execução, um clique
> duplo ou uma falha parcial **não** podem produzir **duas quitações** nem **duas NDe**; e a execução
> é **reversível** (estorno controlado). **STUB (Fase 0)** — o invariante é travado agora; o contrato
> concreto (write-ahead ledger, ledger de execução, contrato O3 + emissão NDe) é **Fase 5**. Espelha
> `business-rules/idempotencia-reconciliacao.md` (baixa `fin010` de Permutas). Ver
> `actions/recebimentos/executar-recebimento.md` e `entities/nota-debito-eletronica.md`.

## Granularidade e chave

- A unidade de execução é o **`Recebimento`** (ou par recebimento↔recebível, a fixar na Fase 5).
- `idempotency_key` UNIQUE por `Recebimento` (espelha a UNIQUE de `permuta_alocacao_execucao`).
- A `NotaDebitoEletronica.idempotencyKey` UNIQUE garante **uma NDe por recebimento**.

## Write-ahead (ordem obrigatória — SKELETON, Fase 5)

1. Grava a intenção (`executing`) **antes** de qualquer chamada ao ERP (write-ahead ledger
   `recebimento_execucao`, espelha `permuta_alocacao_execucao`).
2. Baixa/quitação no ERP (write O3, parametrizado) **+** emissão da NDe (via Conexos).
3. Sucesso → `settled` (com confirmação do ERP + `numeroNde`). Falha → `error` (resposta crua).

- **`settled` é terminal e preservado:** um retry pula o já `settled` — **nunca** uma segunda quitação
  ou NDe. `error`/`pending` são reabríveis (retry reusa a mesma chave).
- **Por que write-ahead e não transação:** o ERP não participa do commit local (mesmo raciocínio de
  Permutas) — a intenção registrada antes vira sinal explícito de "verificar no ERP" se o processo morre.

## Reversibilidade (estorno)

- Undo controlado (`estornarRecebimento`, R5 da state-machine) para **estorno bancário**, **erro
  operacional** ou **conciliação incorreta**. A política exata (o que estorna no ERP, o que faz com a
  NDe) é **Fase 5**.

## Teste canônico (a escrever no TDD — Fase 5)

- `has_canonical_test: false` — casos: executar 1×; re-executar → **pulado** (0 nova quitação, 0 nova
  NDe); falha no meio → `error` reprocessável; estorno após executado → `estornado`. Fixado na Fase 5.

## Universalidade

Universal: uma escrita financeira irreversível-por-nós (quitação + emissão de documento) precisa ser
idempotente e reversível — invariante de qualquer contas-a-receber automatizado. É a mesma doutrina
(write-ahead + idempotency key + dry-run gate) já validada em Permutas; independe do tenant.
