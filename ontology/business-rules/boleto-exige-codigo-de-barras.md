---
name: boleto-exige-codigo-de-barras
type: business-rule
ontology_version: "0.10"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - src/backend/domain/errors/BoletoSemCodigoBarrasError.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
last_review: 2026-08-27
---

# Boleto exige código de barras (fail-closed no envio)

> Um item de lote com `modalidade = BOLETO` só vira linha de remessa se o Conexos tiver um
> **boleto DDA associado** ao título. Sem isso, a geração da remessa **falha** com
> `BoletoSemCodigoBarrasError` — antes de qualquer escrita no ERP.

## A regra

```
modalidade === 'BOLETO'  ∧  ¬temBoletoDda   ⇒   BoletoSemCodigoBarrasError (409)
```

`temBoletoDda` = `titVldReflexoDdaAssoc === 1` na linha do grid de pendentes do `fin015`, lido
**ao vivo no envio**.

## Por que

O código de barras **não existe no título** — 0% de `titEspCodbar` em `fin064` (2000 títulos),
no grid de pendentes (2173) e no `com308` (50), medido em produção. Ele chega ao item só pela
associação do boleto DDA (`fin124`), que o ERP faz quando pedimos.

Sem essa associação, o item entra no lote com barras vazia e o `.REM` sai com **segmento J sem
código de barras**: um pagamento que o banco não liquida, descoberto depois do arquivo pronto —
possivelmente depois de entregue. Falhar antes é mais barato que falhar no banco.

## Por que no ENVIO e não no rascunho

Decisão do Yuri (2026-08-27), coerente com a doutrina anti-drift do SISPAG: o rascunho é onde a
analista pensa, e travar ali a obrigaria a resolver o boleto antes de montar o lote. A validação
autoritativa acontece **ao vivo**, com o estado do ERP no momento do envio — igual a
`prontoParaRemessa` (informativo) × validação real na remessa.

Na UI, o `LoteCard` já sinaliza antes: quando BOLETO está escolhido e não consta das formas
disponíveis, o item aparece com aviso *"sem boleto DDA — a remessa sairia sem código de barras"*.

## Não confundir com "favorecido sem conta"

São dois fail-closed diferentes:

| Situação | Erro | Saída |
|---|---|---|
| BOLETO sem boleto DDA | `BoletoSemCodigoBarrasError` | importar o DDA no `fin124`, ou trocar a forma |
| TED/crédito sem conta ativa | erro de destino (`cmn025`) | cadastrar a conta do favorecido |

**Boleto não precisa de conta do favorecido** — o destino é o próprio código de barras. Exigir
conta para boleto rejeitava justamente o fornecedor que só aceita boleto (o caso comum: em PRD,
1 de 5 favorecidos amostrados tinha conta cadastrada).

## Ver também

- ADR-0040 — o boleto vem da associação DDA do ERP
- `ontology/_inbox/sispag-boleto-dda-sondagem.md` — as medições
- `business-rules/elegibilidade-titulo-lote.md` — I2, elegibilidade do item
