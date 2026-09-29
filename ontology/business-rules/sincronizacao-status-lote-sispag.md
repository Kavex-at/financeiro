---
name: sincronizacao-status-lote-sispag
type: business-rule
entity: LotePagamento
invariant: I11
ontology_version: "0.31.0"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/DecisaoStatusLote.ts
  - src/backend/domain/service/sispag/SincronizacaoLoteService.ts
  - src/backend/domain/service/sispag/ConciliacaoRetornoService.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/client/ConexosTitulosClient.ts
  - src/backend/domain/client/ConexosSispagRetornoClient.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/jobs/sincronizar-lotes-sispag.ts
  - src/backend/migrations/0069_sispag_item_situacao_sincronizacao.sql
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-09-29
has_canonical_test: true
canonical_test: src/backend/domain/service/sispag/DecisaoStatusLote.test.ts
---

# Business Rule — o status do lote SISPAG segue a baixa do título (I11)

> **Vigência:** 2026-09-29 (ADR-0055). Emenda o fechamento de L9/L10 e cria L11
> `sincronizarStatus`. Ver `state-machines/lote-pagamento.md`.

## O princípio

> **O pagamento de um item é um fato do título, não do arquivo de retorno.** O retorno bancário é
> uma das origens possíveis da baixa; a analista pode baixar à mão no `fin010`, e o `fin052` pode
> ser processado nativamente sem gerar borderô. O lote observa o título.

## Hierarquia de evidência

| Nível | Fonte | O que prova | O que **não** prova |
|---|---|---|---|
| 1 — pagamento | `fin064` por `docCod` (`vldPago = 1 ∧ aberto = 0`) | o item foi pago, **qualquer origem** | quem baixou, com que borderô |
| 2 — veto | evento do `fin052` com `fbeVldTpret = 2` | o banco rejeitou o item | que os **outros** itens não foram rejeitados |
| 3 — agenda | evento `BD` / `00` do `fin052` | o banco aceitou/agendou | que o ERP baixou |
| 4 — enriquecimento | `com308` baixas (PSQ_018) · detalhe do `fin052` | `borCod`, `bxaCodSeq`, data, usuário, valor | nada sobre o status: é trilha |

## Invariantes

- **I11a — read-only no ERP.** `sincronizarStatus` só lê. Nunca `carregar`, `processar`, baixar,
  nem abre ledger de execução. O `processar` continua exclusivo de `conciliarRetorno` (admin).
- **I11b — baixa de qualquer origem basta.** Item é `PAGO` se o nível 1 diz pago. Remessa, `fin010`
  manual ou processamento nativo são equivalentes. Com baixa confirmada no título, um evento do
  `fin052` **não lido** (varredura incompleta) **não** impede `BAIXADO`.
- **I11c — falha de leitura não decide.** Leitura do `fin064` que falha (rede, 4xx, 5xx, campo
  ausente, schema inválido) nunca produz "pago" nem "não pago": o item mantém a situação anterior e
  o lote não transiciona nesta passada. Leitura do PSQ_018 que falha (inclusive 403) deixa os
  campos de enriquecimento nulos e **não** bloqueia `BAIXADO`. Evento não lido não produz
  `REJEITADO`.
- **I11d — precedência por item.** Sobre todas as linhas do `fin052` que casam o item (casamento
  pela chave composta com o `filCod` **da linha**), o evento registrado é o de maior precedência:
  `REJEITADO > 00 > BD > outro`. Nunca a última linha lida. `situacao` = `REJEITADO` se há
  rejeição; senão `PAGO` se nível 1; senão `AGENDADO` se `BD`/`00`; senão `SEM_RETORNO`.
- **I11e — fechamento do lote.** Algum `REJEITADO` → `RETORNADO`. Todos `PAGO` → `BAIXADO`.
  Qualquer outra combinação → permanece. Sem estado novo de lote.
- **I11f — `BAIXADO` é terminal; contradição vira divergência.** Se um título antes pago volta a
  aberto (estorno), a sincronização **não** transiciona: marca `divergencia` no item e emite
  `Alerta` `sispag-baixa-divergente`. Item `REJEITADO` cujo título aparece pago (pago fora da
  remessa) **continua `REJEITADO`**, o lote fica em `RETORNADO`, e o item recebe `divergencia` +
  o mesmo `Alerta` (decisão do usuário, 2026-09-29). Resolver é decisão humana.
- **I11g — observação não é escrita no ERP.** As gravações locais da sincronização e da conciliação
  (situação, enriquecimento, transição) **não** são condicionadas a `conexosWriteEnabled`,
  `sispagLiveWriteEnabled` nem `conexosDryRun`; esses gates valem só para escrita no Conexos.
- **I11h — idempotência.** Uma passada que não muda status nem situação de nenhum item **não**
  incrementa `versao` e não emite evento nem alerta. Atualiza apenas `sincronizadoEm`. A transição
  usa o optimistic lock (I6); conflito de versão = pular o lote nesta passada.

## Gatilho

Agendado (cron) + manual ("Sincronizar agora" no card do lote). A cadência é configuração
operacional, não regra: hoje GitHub Actions, dias úteis, de hora em hora.

## Rejeição

Lote em `RETORNADO` aparece destacado na tela e gera `Alerta` `sispag-lote-retornado`. Tratamento:
sanear cadastro e reenviar em lote novo.

## Verificação

- Unitário: tabela de verdade de I11d/I11e, incluindo falha de leitura (I11c), item `REJEITADO` com
  título pago (I11f) e sincronização sem mudança sem bump de `versao` (I11h).
- **Ao vivo (ground truth):** PG230901.REM. O 38682/1 (fil 2/flp 24) deve sair `PAGO` com
  `origemBaixa = FORA_DO_RETORNO` (borderô 22320 se o PSQ_018 for legível); o 4030/7 (fil 1/flp 8)
  conforme o `fin064` do dia. São **dois lotes locais** (um por filial, I4 — `635d9c77`
  fil 2 e `3ea0f6ef` fil 1), cada um com um item: cada lote vai a `BAIXADO` quando o seu título está pago.
