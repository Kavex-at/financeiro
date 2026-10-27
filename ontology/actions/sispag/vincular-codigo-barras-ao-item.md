---
name: vincularCodigoBarrasAoItem
type: action
entity: LotePagamento
ontology_version: "0.49.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
last_review: 2026-10-26
preconditions:
  - "Modo da filial = on (I17k); kill-switch sispagLiveWriteEnabled ligado."
  - "Item BOLETO no rascunho nativo aberto, sem DDA associado pelo ERP (I17a, I17i)."
  - "DecisaoSugestaoBoleto CONFIRMADA nao orfa, par VIGENTE, relidos ao vivo; tier recalculado CONHECIDO|FORTE (I17a)."
  - "Valor igual em centavos; 0 <= deltaDias <= 5; vencimento da barra >= dataDebito (I17b, I17c)."
  - "(ADR-0078, planned) OU caminho DATA_DIVERGENTE: deltaDias em [-10,-1] U [6,10], reconhecimento valido (I15r), vencimento efetivo da barra (rolado ao proximo dia util) >= dataDebito, data candidata possivel (I8c), modo do caminho = on (I17k, I17p)."
  - "DV, banco, valor, data e juros/desconto = 0 conferidos por nos (I17d, incluindo o 7o check: fator de vencimento x DDA, ADR-0078 implemented Fase 1); codigo nao repetido no rascunho (I17h)."
postconditions:
  - "Item com itsNumCodbar (47), itsNumBanco, bncDesNome, valor e data da barra, observados na releitura (I17e)."
  - "ItemLote.vinculoCodigoBarras preenchido com origem DECISAO_HUMANA, decisaoId, codigo mascarado, aplicadoEm, flpCod."
  - "(ADR-0078, planned) vinculoCodigoBarras tambem registra caminho, deltaDias e reconhecimentoId; guarda de data do .REM (I17q) fail-closed."
  - "Evento VINCULO_APLICADO na trilha (mascarado), unico por (lote, titulo, decisaoId)."
  - "Guarda I16 reavaliada sobre o conjunto final do rascunho (I17h)."
side_effects:
  - "Escrita no ERP: finItemSispag/validacao/codigoBarras, confirmaCodigoBarras e PUT fin015/finItemSispag (tentativa unica)."
  - "Trilha so-inclusao; LogService mascarado; etapa de memoria vincular_codbar da retomada."
  - "Falha deterministica: retirada I16d com motivo VINCULO_CODIGO_BARRAS_FALHOU (I17g(3))."
---

# vincularCodigoBarrasAoItem

ADR-0071 (passo 2 do ADR-0068, valor igual). Chamada **apenas** de `RemessaService.gerarRemessa`, entre
`importar` e a guarda I16; nunca pela UI do passo 1. Sem permissão nova: herda `sispag:executar` de quem
gera a remessa; a decisão já tem autor próprio (I15g). Idempotente por I17f. Falha transitória aborta e
retoma; determinística retira o item e segue (I17g). **Planned.**

**Item de borderô (ADR-0077, `implemented`, I17o).** A mesma ação vincula a barra do boleto agrupado ao item
nativo com `borCod` (sem `docCod/titCod`): elegibilidade pelo `GrupoBoleto CONFIRMADO` não órfão e par
`VIGENTE` (no lugar da decisão por título), valor pela I21b **e** igual a `itsMnyValor` do item (a I17n não
se aplica), modalidade 7/6 pela I21o; independe do modo I17k. Ver `business-rules/boleto-agrupado-sispag.md`.
