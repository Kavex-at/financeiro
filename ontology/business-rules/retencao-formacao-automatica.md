---
name: retencao-formacao-automatica
type: business-rule
entity: TituloAPagar
ontology_version: "0.28.1"
implementation_status: implemented
invariant: I9
related_files:
  - src/backend/migrations/0062_titulo_retencao_formacao.sql
  - src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
last_review: 2026-09-22
has_canonical_test: true
---

# Regra: retencao-formacao-automatica (título retido não entra em lote automático)

> **Invariante I9 (ADR-0050).** A formação automática de lotes (`formarLotesAutomaticos`) **nunca**
> inclui um `TituloAPagar` com retenção ativa. A inclusão **manual** continua permitida e, ao incluir,
> libera a retenção.

## Enunciado

```
elegivelParaFormacao(titulo) ⇔
    ativo ∧ aprovado ∧ ¬pago                        (I2)
  ∧ hoje ≤ vencimento ≤ hoje + maxDias              (ADR-0018 D2; maxDias = config, hoje 7)
  ∧ ¬∃ ItemLote em lote RASCUNHO para o título      (I3, anti-join)
  ∧ ¬retencaoFormacao.ativa(titulo)                 (I9, NOVO)
```

`elegivelParaLote` (I2, inclusão manual) **não** ganha o termo I9.

## Ciclo da retenção

| Evento | Efeito | Quem |
|--------|--------|------|
| "Retirar do lote" (aba de títulos) | remove o `ItemLote` **e** cria a retenção ativa, na mesma transação | analista (JWT) |
| Lixeira dentro de um lote **automático** | idem: remove o item e cria a retenção, na mesma transação; `automatico` é lido **antes** do `marcarManual` | analista (JWT) |
| Lixeira dentro de um lote **manual** | remove o item, **sem** retenção (como antes da ADR-0050) | analista (JWT) |
| `incluirTituloNoLote` | libera a retenção ativa, `motivoRemocao = 'incluido-no-lote'`, na mesma transação da inclusão | quem incluiu |
| "Liberar para lote automático" | libera a retenção ativa, `motivoRemocao = 'liberado'` | analista (JWT) |

No máximo uma retenção ativa por título. Liberar é soft-delete: a linha fica como histórico.

A retenção só nasce ao tirar o título de um lote. Marcá-la num título solto foi proposto e rejeitado
pelo usuário em 2026-09-22 (P1-2 em `_inbox/sispag-retirar-titulo-lote-gap.md`).

## O que a regra NÃO faz

- Não bloqueia inclusão manual nem finalização (`finalizarLote` não a revalida).
- Não expira. Título que fica pago, inativo ou vencido mantém a marca, inerte: a formação já o
  excluiria por I2 ou pela janela.
- Não é gravada em `titulo_a_pagar`. Fica em tabela própria, chave `(fil_cod, doc_cod, tit_cod)`, para
  sobreviver a qualquer re-ingestão ou rebuild da carteira (ADR-0050 D1).
- Não toca o ERP (I1).

## Teste canônico

`TituloAPagarRepository.test.ts` (termo I9 no SQL) e `LotePagamentoService.test.ts`
(bloco "retenção da formação automática"). A re-ingestão não toca a tabela por construção: o UPSERT
escreve só em `titulo_a_pagar`.

Casos cobertos:

- Título elegível e sem retenção → entra no lote automático.
- Mesmo título com retenção ativa → fica fora; a rodada não falha e os demais títulos da filial são
  lotados normalmente.
- Título retido incluído à mão → inclusão aceita, retenção liberada com `incluido-no-lote`, e a
  próxima rodada não o duplica (I3).
- "Retirar do lote" com falha ao gravar a retenção → o item continua no lote (atomicidade).
- Lixeira num lote automático → retém; num lote manual → não retém.
- Re-ingestão (UPSERT + anti-fantasma) → a retenção continua ativa.

## Universalidade

O *payment block* do SAP e o *hold* do Oracle têm a mesma forma: o item em aberto sai da proposta
automática de pagamento e continua pagável à mão. A estrutura é do domínio; quais títulos são retidos,
e por quê, são dados do tenant.
