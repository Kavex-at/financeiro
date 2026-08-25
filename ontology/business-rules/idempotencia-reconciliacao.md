# Business Rule — Idempotência e fault-tolerance da reconciliação (baixa `fin010`)

> Fase 3 (risco arquitetural #1). A baixa no ERP é a **primeira escrita irreversível-por-nós** do sistema
> (o estorno é manual, na UI do `fin010`). Estas regras garantem que uma re-execução, um clique duplo, ou
> uma falha parcial **não** gerem baixa duplicada nem percam o rastro. Ver ADR-0013 e
> `fin010-write-contract.md`.

## Granularidade e chave

- A unidade de execução é o **par adto↔invoice** (espelha a UNIQUE de `permuta_alocacao`).
- `idempotency_key = "permuta:{adiantamentoDocCod}:{invoiceDocCod}"` — UNIQUE em
  `permuta_alocacao_execucao`.

## Máquina de estados da execução (`permuta_alocacao_execucao.status`)

```
            beginExecution (write-ahead)
   (novo) ───────────────────────────────▶ reconciling ──gravarBaixaPermuta ok──▶ settled (terminal)
                                                 │
                                                 └────────── POST falhou ────────▶ error
   error ──(retry: nova chamada)──▶ reconciling ...                                 ▲
   settled ──(re-execução)──▶ PRESERVADO (pulado, idempotência) ────────────────────┘
   dry-run: status 'pending', dry_run=true, sem POST
```

- **`settled` é terminal e preservado.** `beginExecution` NUNCA regride um `settled` (CASE no `ON CONFLICT
  DO UPDATE`). Re-executar um par já liquidado retorna `alreadySettled=true` → **pulado**.
- **`error` e `pending` são reabríveis** — um retry os leva de volta a `reconciling`.

## Write-ahead (ordem obrigatória)

1. `beginExecution` grava `reconciling` **antes** de qualquer chamada ao ERP.
2. Handshake (passos 1–4) + `gravarBaixaPermuta` (passo 5).
3. Sucesso → `markSettled` (com `bxaCodSeq`, `bor_cod`, `valor_baixado`, `erp_response`).
4. Falha → `markError` (com `erro_mensagem` + `erp_response` crua).

**Por que write-ahead e não transação:** o ERP não participa do nosso commit de Postgres. Se o processo
morre **entre** o POST e o `markSettled`, a linha fica em `reconciling` — sinal explícito de "verificar no
ERP se a baixa entrou" (reconciliação manual), em vez de um silêncio que pareceria "não executado".

> **Emendado pela ADR-0039 (2026-08-25), só para o SISPAG.** "Reconciliação manual" continua sendo a
> doutrina aqui, na permuta. No SISPAG, onde o ERP **expõe estado verificável** da escrita
> (`flpVldStatus`/`titulosCount` no fin015, `processadoEm` no fin052), a execução órfã é **retomada por
> consulta** em vez de mandar a pessoa ao ERP — ver `retomada-remessa-sispag.md`. O critério é
> por-escrita, não por-módulo: para a baixa do `fin010` ninguém mediu ainda se existe estado
> consultável equivalente, então aqui nada muda.

## Invariantes

- **I-Recon-1:** no máximo **uma** baixa `settled` por par adto↔invoice (a chave UNIQUE garante).
- **I-Recon-2:** toda transição para `settled` carrega o `bxaCodSeq` confirmado pelo ERP — sem confirmação,
  não há `settled`.
- **I-Recon-3:** nenhuma baixa é gravada se o em-aberto vivo do ERP (`bxaMnyValor`, passo 2) for ≤ 0
  (anti-super-pagamento — o valor vem do ERP, nunca do nosso rascunho).
- **I-Recon-4:** dry-run **não** chama o ERP e **não** cria borderô — zero efeito colateral (seguro até em
  produção).

## Recuperação de linhas `reconciling`/`error` (operacional)

- `GET /permutas/adiantamentos/:docCod/execucoes` expõe o status por par. Linhas `error` mostram a mensagem
  e a resposta do ERP. Linhas `reconciling` "presas" (processo morreu no meio) exigem checagem no `fin010`:
  se a baixa entrou → marcar `settled` manualmente (futuro: endpoint de conciliação); se não → retry.
