# Diagnóstico — NDe já emitidas em processos POR CONTA E ORDEM DE TERCEIROS

**Aberto em:** 2026-08-07 · **Origem:** ADR-0031 (consequências) · **Prioridade:** P1
**Status:** aberto — não implementado nesta entrega, de propósito.

## O problema

A regra de negócio (`priVldTipo = 2` ⇒ sem NDe) passou a valer **de agora em diante**. Toda alocação
de recebimento executada **antes** desta mudança emitiu NDe incondicionalmente — inclusive nos
processos por conta e ordem de terceiros, onde a nota não era devida.

Essas notas estão **homologadas**. A homologação com297 é um fato fiscal **irreversível**: não há
teardown (ver `business-rules/homologacao-nde-com297.md`). Ou seja, isto **não é corrigível por
código** — é conversa com o cliente sobre o passivo, e possivelmente com a contabilidade.

## O que precisa ser levantado (antes de qualquer conversa)

Quantas, quais e de que valor. O cruzamento é entre o ledger local e o `imp021`:

1. No Postgres, as execuções que emitiram nota:
   ```sql
   SELECT idempotency_key, fil_cod, pri_cod, txn_id, valor, doc_cod, nd_doc_cod, atualizado_em
     FROM solicitacao_numerario_execucao
    WHERE status = 'settled'
      AND nd_doc_cod IS NOT NULL
    ORDER BY atualizado_em;
   ```
2. Para os `pri_cod` distintos daí, ler `imp021.priVldTipo` (mesmo caminho do gate 0.5:
   `ConexosCadastroClient.listProcessos({ filCod, priCods })`).
3. Reter as linhas com `priVldTipo = 2` — são as NDe indevidas.

> **Não dá para responder só com SQL.** O `priVldTipo` nunca foi persistido localmente (só agora
> passou a ser lido, e ainda assim em memória, no pré-flight). O passo 2 depende do ERP.

## Perguntas abertas para o Yuri / cliente

- Qual o tratamento contábil/fiscal das notas já emitidas indevidamente? (cancelamento fora do prazo,
  carta de correção, nota de ajuste — depende de prazo e de já terem sido escrituradas)
- A partir de que data o levantamento importa? (a Frente IV entrou em produção em 2026-08-04 por
  ADR-0028 e o piso de ingestão é 2026-08-03, então a janela é curta — o que é uma boa notícia)
- Vale persistir `pri_vld_tipo` no ledger a partir de agora, para que este cruzamento não precise do
  ERP no futuro? (barato: uma coluna, preenchida no `beginExecution` a partir do pré-flight)

## Por que não foi feito junto

O escopo pedido era a regra. O levantamento é **read-only e sem urgência de código**, mas a decisão do
que fazer com o passivo é do cliente, não da engenharia — e implementar remediação antes dessa
decisão seria chutar. Fica aqui para virar tarefa quando as perguntas acima tiverem resposta.
