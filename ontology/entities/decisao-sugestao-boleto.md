---
name: DecisaoSugestaoBoleto
type: entity
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties: [id, filCod, docCod, titCod, pesCod, credor, ddcCod, ditCod, numeroBoleto, codbarMascarado, valorTitulo, vencimentoTitulo, valorBoleto, vencimentoBoleto, deltaValor, deltaPercentual, deltaDias, sinais, tier, emissorChave, decisao, decididoPor, decididoEm, motivo, confirmacaoEmissorId]
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
> uma pessoa olhou a sugestão (título × boleto) e a **confirmou** ou **rejeitou**. É o ponto de
> ancoragem do passo 2 (bind) e a trilha de auditoria do passo 1. Code-facing:
> `BoletoSuggestionDecision`. Tabela proposta: `sispag_decisao_sugestao_boleto`.
> **Status: planned** — ontologia à frente do código.

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
| `decisao` | `CONFIRMADA \| REJEITADA` | Imutável. |
| `decididoPor` · `decididoEm` | string · Date | `sispag:executar`. Nunca `sistema`. |
| `motivo` | string? | Obrigatório em `REJEITADA`. |
| `confirmacaoEmissorId` | string? | Preenchido em `CONFIRMADA`. |

## Unicidade

- No máximo **1 `CONFIRMADA` ativa por título** e **1 por boleto** (`ddcCod`,`ditCod`): índices únicos
  parciais. "Ativa" = o par ainda `VIGENTE` e nem o título nem o boleto ganharam vínculo/baixa no ERP
  (estado derivado, não persistido). Outro boleto para o mesmo título exige revogar o par antes.
- `REJEITADA` é por (título, boleto): esconde **aquele** boleto para **aquele** título; outro
  candidato aparece de novo. Não "envenena" o par do emissor.

## Derivados (não persistidos)

`ATIVA` (confirmada com par vigente e sem vínculo ERP) · `SUPERADA_PELO_ERP` (o Conexos associou o
título a um boleto — o que vale é o ERP) · `PAR_REVOGADO` (par `REVOGADA`: a decisão fica como
histórico, mas não vale para nada no passo 2; decisão ainda não aplicada no ERP é cancelada pela
revogação — ADR-0068, Q-E).
