---
name: BloqueioDuplicidade
type: entity
ontology_version: "0.36.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
properties: [id, filCod, docCod, titCod, pesCod, alertaId, loteIdOrigem, motivo, estado, marcadoPor, marcadoEm, encerradoEm, desfeitoPor, desfeitoEm, motivoDesfazer]
relationships:
  - "BloqueioDuplicidade N—1 TituloAPagar (via filCod:docCod:titCod; no máximo 1 ATIVO por título)"
  - "BloqueioDuplicidade 0..1—1 AlertaItemLote (a alerta de duplicidade resolvida como RETIRADA que o criou)"
last_review: 2026-10-05
universality_evidence:
  - "probe-duplicidade-titulos.ts: fil 4, docs 6173 × 6702 (duplicata real em PRD); a correção é cancelar um dos documentos no ERP, ato humano fora da solução"
  - "Conceito universal: título identificado como duplicado fica retido do pagamento até o documento ser cancelado no ERP (bloqueio de pagamento por suspeita, comum em contas a pagar)"
---

# BloqueioDuplicidade

> **Origem:** ADR-0063 (2026-10-05). Marca **local** num título a pagar que a analista **retirou do
> lote por duplicidade**: "retirado por duplicidade — cancelamento pendente no Conexos". Regra I13g
> em `business-rules/verificacao-ted-pix-sispag.md`. Code-facing: `DuplicateHold`; tabela proposta
> `sispag_bloqueio_duplicidade`.

**Por que não é coluna de `titulo_a_pagar`:** a ingestão faz UPSERT do título a cada rodada e
apagaria a marca. Como `ExcecaoPermuta` (ADR-0047), a decisão humana vive em tabela própria e
sobrevive à re-leitura do ERP.

**Não é a retenção retirada da ADR-0050.** Lá, o título que a analista tirou podia voltar a um lote
automático sem problema. Aqui o título é possivelmente uma dívida já paga (ou a pagar) em outro
documento: voltar a um lote é o risco que a marca existe para impedir.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `filCod` · `docCod` · `titCod` | — | O título bloqueado. **No máximo 1 `ATIVO` por título.** |
| `pesCod` | string | Favorecido (exibição/filtro). |
| `alertaId` | string | A `AlertaItemLote` resolvida como `RETIRADA`. |
| `loteIdOrigem` | string | Lote de onde saiu. |
| `motivo` | string | Obrigatório (o que a analista viu; costuma citar a contraparte). |
| `estado` | enum | `ATIVO \| ENCERRADO \| DESFEITO` (constante `DUPLICATE_HOLD_STATE`). |
| `marcadoPor` · `marcadoEm` | string · Date | Username canônico autenticado. |
| `encerradoEm` | Date? | Quando a ingestão viu o título sumir do `fin064` (`ativo = false`) ou cancelado. Ator `sistema`. |
| `desfeitoPor` · `desfeitoEm` · `motivoDesfazer` | — | Desfazer pela analista, com motivo, auditado. |

## Ciclo de vida

| De → Para | Gatilho |
|---|---|
| `(novo) → ATIVO` | `resolverAlertaDuplicidade` com `RETIRAR` |
| `ATIVO → ENCERRADO` | `ingerirPagamentos` marca o título `ativo = false` (sumiu do `fin064`) ou o lê cancelado |
| `ATIVO → DESFEITO` | `resolverAlertaDuplicidade` (operação desfazer bloqueio), com motivo |

Enquanto `ATIVO`: fora de `formarLotesAutomaticos`, `incluirTituloNoLote` recusa
(`DuplicateHoldError`), e a aba "Títulos a pagar" mostra a marca. Nenhuma escrita no Conexos.
