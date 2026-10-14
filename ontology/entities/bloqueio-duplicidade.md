---
name: BloqueioDuplicidade
type: entity
ontology_version: "0.41.0"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
properties: [id, filCod, docCod, titCod, pesCod, origem, alertaId, tituloMantido, codigoMascarado, loteIdOrigem, motivo, estado, marcadoPor, marcadoEm, encerradoEm, desfeitoPor, desfeitoEm, motivoDesfazer]
relationships:
  - "BloqueioDuplicidade N—1 TituloAPagar (via filCod:docCod:titCod; no máximo 1 ATIVO por título)"
  - "BloqueioDuplicidade 0..1—1 AlertaItemLote (a alerta de duplicidade resolvida como RETIRADA que o criou)"
last_review: 2026-10-14
universality_evidence:
  - "probe-duplicidade-titulos.ts: fil 4, docs 6173 × 6702 (duplicata real em PRD); a correção é cancelar um dos documentos no ERP, ato humano fora da solução"
  - "Conceito universal: título identificado como duplicado fica retido do pagamento até o documento ser cancelado no ERP (bloqueio de pagamento por suspeita, comum em contas a pagar)"
  - "ADR-0069 Emenda 1 (origem CODIGO_BARRAS_*): caso PEDRONI, fil 2, 10 títulos de R$ 1.412,00 vencendo 14/10 para 2 boletos DDA; medição PRD de 27 títulos em grupos com mais títulos que boletos. Conceito universal: boleto DDA agrupado por valor+vencimento vale para qualquer pagador com DDA; 1 cliente medido (Columbia), estrutura aceita pelo Francinei não-bloqueante"
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
| `origem` | enum | **ADR-0069 Emenda 1 (`planned`).** `DUPLICIDADE_TITULO` (default das linhas existentes) \| `CODIGO_BARRAS_REPETIDO` \| `CODIGO_BARRAS_ILEGIVEL`. |
| `alertaId` | string? | A `AlertaItemLote` resolvida como `RETIRADA`. Só em `DUPLICIDADE_TITULO` (opcional desde a Emenda 1). |
| `tituloMantido` | `(filCod, docCod, titCod)?` | **Novo.** O item que ficou com o boleto. Só nas origens de código de barras. |
| `codigoMascarado` | string? | **Novo.** 5 primeiros + 4 últimos dígitos; nunca o código completo (I16e). Só nas origens de código de barras. |
| `loteIdOrigem` | string | Lote de onde saiu. |
| `motivo` | string | Obrigatório (o que a analista viu; costuma citar a contraparte). |
| `estado` | enum | `ATIVO \| ENCERRADO \| DESFEITO` (constante `DUPLICATE_HOLD_STATE`). |
| `marcadoPor` · `marcadoEm` | string · Date | Username canônico autenticado; `sistema` nas origens de código de barras. |
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

## Origens e encerramento (ADR-0069 Emenda 1, `planned`)

A entidade passa a ter **origem**. O resto do ciclo (`ATIVO → DESFEITO` pela analista, com motivo e
auditado) é igual; o efeito também (fora de `formarLotesAutomaticos`, `DuplicateHoldError` na inclusão).
Muda só a condição de `ATIVO → ENCERRADO` (ator `sistema`):

| Origem | Nasce de | Encerra sozinho quando |
|---|---|---|
| `DUPLICIDADE_TITULO` | `resolverAlertaDuplicidade(RETIRAR)` (I13g) | inalterado: sumiu do `fin064` ou cancelado |
| `CODIGO_BARRAS_REPETIDO` | retirada automática por código repetido (I16d, ator `sistema`) | o título **mantido** foi pago, cancelado ou saiu do `fin064`/`ativo = false`; **ou** o vínculo DDA que gerou a disputa se desfez (boleto do título retido mudou); **ou** o lote de origem foi cancelado sem remessa gerada |
| `CODIGO_BARRAS_ILEGIVEL` | retirada automática por código lido e descartado (I16d.2) | a ingestão vê a situação do boleto do título mudar (DDA sincronizado/boleto novo) |

Ambas as origens de código de barras também encerram por `DESFEITO`. O sinal "boleto mudou" depende de
`titVldReflexoDdaAssoc`/`fin124` (P1-6): custo a confirmar na implementação; sem ele, vale o desfazer
manual. A marca é criada **na mesma transação** da remoção local do item (I16g, I16d.3), e é o que a
retomada usa para reconhecer resíduo no rascunho nativo (I16h). Uma migration (campo `origem` e campos
novos). **Não** é entidade nova (REJECT-DUPLICATE, ADR-0069 R4).
