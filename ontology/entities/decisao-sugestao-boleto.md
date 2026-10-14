---
name: DecisaoSugestaoBoleto
type: entity
ontology_version: "0.42.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/migrations/0084_sispag_sugestao_boleto.sql"
  - "src/backend/domain/interface/sispag/SugestaoBoleto.ts"
  - "src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts"
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
properties: [id, filCod, docCod, titCod, pesCod, credor, ddcCod, ditCod, numeroBoleto, codbarMascarado, valorTitulo, vencimentoTitulo, valorBoleto, vencimentoBoleto, deltaValor, deltaPercentual, deltaDias, sinais, tier, emissorChave, decisao, decididoPor, decididoEm, motivo, confirmacaoEmissorId, anuladaPor, anuladaEm, motivoAnulacao, versao]
relationships:
  - "DecisaoSugestaoBoleto N—1 TituloAPagar (chave filCod/docCod/titCod; vínculo lógico, sem escrita no título)"
  - "DecisaoSugestaoBoleto N—1 BoletoDda (chave ddcCod/ditCod; snapshot — o pool pode mudar)"
  - "DecisaoSugestaoBoleto N—0..1 ConfirmacaoEmissorBoleto (a confirmação que esta decisão criou ou reutilizou; só quando decisao = CONFIRMADA)"
last_review: 2026-10-14
universality_evidence:
  - "Mesmas fontes de ConfirmacaoEmissorBoleto (entrevista 2026-10-14; sondagens PRD 2026-10-13/14)"
  - "Conceito universal: toda conciliação assistida guarda QUEM aprovou QUAL par com QUE evidência (trilha de auditoria)"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante)"
---

# DecisaoSugestaoBoleto

> **Origem:** ADR-0068 (Q1 = "par + registro por título", confirmada). Registro **imutável** de que
> uma pessoa olhou a sugestão (título × boleto) e a **confirmou** ou **rejeitou**. A confirmação
> tem saída: **`ANULADA`** (I15l, emenda 2026-10-14 (2)) — terminal, só a partir de `CONFIRMADA`. É o ponto de
> ancoragem do passo 2 (bind) e a trilha de auditoria do passo 1. Code-facing:
> `BoletoSuggestionDecision`. Tabela proposta: `sispag_decisao_sugestao_boleto`.
> **Status: implemented (v0.66.0, migration 0084)** — ontologia à frente do código.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `filCod` · `docCod` · `titCod` | number | Chave do título (a mesma de `TituloAPagar`). |
| `pesCod` · `credor` | number · string | Snapshot do credor do título. |
| `ddcCod` · `ditCod` | number | Chave do item no `fin124`. Snapshot: no passo 2 o boleto é **relido ao vivo**. |
| `numeroBoleto` · `codbarMascarado` | string? · string | `ditEspNumero` do boleto; barras só mascaradas (emissor + últimos dígitos). A linha digitável completa não é persistida. |
| `valorTitulo` · `vencimentoTitulo` · `valorBoleto` · `vencimentoBoleto` | number · Date · number · Date | Snapshot na hora da decisão. Datas como data civil (UTC meia-noite, BRT). |
| `deltaValor` · `deltaPercentual` · `deltaDias` | number · number · number | **Com sinal**, boleto − título (mesma convenção de `diferencaDias`). Mostrados e gravados; **nunca** abençoados pelo par (I15d). |
| `sinais` | lista | Ex.: `VALOR_IGUAL`, `VALOR_ATE_5_CENTAVOS`, `MESMO_DIA`, `DIAS_DEPOIS`, `NUMERO_IGUAL`, `EMISSOR_CONFIRMADO`. |
| `tier` | `CONHECIDO \| FORTE \| ATENCAO` | Derivado na hora da decisão (regra I15c). |
| `emissorChave` | string | Chave do emissor derivada do `codbar` do boleto (par com `pesCod`). |
| `decisao` | `CONFIRMADA \| REJEITADA \| ANULADA` | `CONFIRMADA → ANULADA` é a única transição; `REJEITADA` e `ANULADA` são terminais. Ver "Estados". |
| `decididoPor` · `decididoEm` | string · Date | `sispag:executar`. Nunca `sistema`. |
| `motivo` | string? | Obrigatório em `REJEITADA`. |
| `confirmacaoEmissorId` | string? | Preenchido em `CONFIRMADA` (e mantido em `ANULADA`, como histórico). |
| `anuladaPor` · `anuladaEm` · `motivoAnulacao` | string? · Date? · string? | Todos preenchidos em `ANULADA` e só nela (CHECK). `anuladaPor` nunca `sistema`/`unknown`. Motivo de 10 a 500 caracteres; na cascata é `par revogado: <motivo da revogação>`. |
| `versao` | number | Lock otimista da anulação (`UPDATE ... WHERE versao = ? AND decisao = 'CONFIRMADA'`). |

## Estados (I15l)

```
CONFIRMADA ──anularDecisaoSugestaoBoleto──▶ ANULADA        (terminal)
CONFIRMADA ──revogarConfirmacaoEmissor (cascata)──▶ ANULADA
REJEITADA                                                  (terminal, intocada)
```

`ANULADA` libera o título e o boleto: os índices únicos valem só para `decisao = 'CONFIRMADA'`.
Pode haver várias `ANULADA` para o mesmo (título, boleto); cada uma é uma confirmação desfeita, com
quem, quando e por quê. Reconfirmar cria linha nova.

## Confirmação órfã (derivada, não persistida)

`CONFIRMADA` ativa cujo boleto deixou de estar livre no pool (arquivo cancelado, vinculado pelo ERP)
ou cujo título o ERP já sinalizou (`temBoleto`) **continua `CONFIRMADA` no banco**, mas a listagem a
devolve com `orfa = true` e `motivoOrfa` (pt-BR), `confirmavel = false`, para a tela oferecer
"Anular confirmação". Título pago, inativo ou fora da carteira não aparece (nada a fazer na tela), e
a decisão dele não reserva o boleto; ainda pode ser anulada pela rota.

## Unicidade

- No máximo **1 `CONFIRMADA` ativa por título** e **1 por boleto** (`ddcCod`,`ditCod`): índices únicos
  parciais. "Ativa" = o par ainda `VIGENTE` e nem o título nem o boleto ganharam vínculo/baixa no ERP
  (estado derivado, não persistido). Outro boleto para o mesmo título exige revogar o par antes.
- `REJEITADA` é por (título, boleto): esconde **aquele** boleto para **aquele** título; outro
  candidato aparece de novo. Não "envenena" o par do emissor.

## Derivados (não persistidos)

`ATIVA` (confirmada com par vigente e sem vínculo ERP) · `ORFA` (confirmada, mas o boleto saiu do
pool ou o ERP sinalizou o título — I15l) · `SUPERADA_PELO_ERP` (o Conexos associou o título a um
boleto — o que vale é o ERP). **Revogar o par ANULA, na mesma transação, toda decisão `CONFIRMADA`
dele** (ADR-0068, Q-E, implementada em 2026-10-14): a decisão fica `ANULADA`, nunca `CONFIRMADA`
sob par `REVOGADA`.

**Aplicação no ERP (ADR-0071, `planned`) — derivado, não persistido:** `aplicacao` =
`NAO_APLICADA | SIMULADA(lote) | APLICADA(lote, flpCod) | FALHOU(motivo)`, lida da trilha
(`VINCULO_SIMULADO`/`VINCULO_APLICADO`/`VINCULO_FALHOU`) e de `ItemLote.vinculoCodigoBarras`. **Não existe**
estado `APLICADO_NO_ERP` (a aplicação é por remessa × tentativa; a decisão sobrevive a lote cancelado).
`decisao` segue `CONFIRMADA | REJEITADA | ANULADA`.
