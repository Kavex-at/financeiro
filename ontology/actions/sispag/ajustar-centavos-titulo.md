---
name: ajustarCentavosTitulo
type: action
entity: TituloAPagar
ontology_version: "0.44.0"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/AjusteCentavosTituloService.ts
  - src/backend/domain/libs/boleto/ElegibilidadeAjusteCentavos.ts
  - src/backend/domain/libs/boleto/EtapaAjusteCentavos.ts
  - src/backend/domain/libs/boleto/ModoAjusteCentavos.ts
  - src/backend/domain/client/ConexosRenegociacaoClient.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/client/ConexosSessionResolver.ts
  - src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.ts
  - src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/libs/runtime/ServerProcessMarker.ts
  - src/backend/routes/sispag.ts
  - src/backend/migrations/0087_sispag_ajuste_centavos.sql
last_review: 2026-10-19
has_canonical_test: true
canonical_test: src/backend/domain/service/sispag/AjusteCentavosTituloService.test.ts
preconditions:
  - "Processo do servidor (nunca job/cron); sessão Conexos = credencial do ambiente, explícita, com sonda G1 aprovada (I18f)."
  - "Modo da filial = on; sispagLiveWriteEnabled/conexosWriteEnabled ligados, conexosDryRun desligado (I18l)."
  - "I18a inteira, recalculada ao vivo: decisão CONFIRMADA não órfã, par VIGENTE, número igual, 0 < |Δ| <= LIMITE_VALOR_MESMO_DIA, mesmo vencimento, título aprovado, não pago, sem pagamento parcial, sem juros/desconto prévios, sem ajuste anterior na linhagem, fora de lote finalizado e de rascunho nativo."
  - "Nenhum outro ledger não terminal para o mesmo título de origem (I18h)."
postconditions:
  - "Título novo no mesmo docCod, vencimento original, líquido aberto == valor do boleto; título original consumido (I18d)."
  - "Bloqueio criado pela renegociação liberado, ou ajuste em aguardando_aprovacao_manual com aviso (I18e)."
  - "Decisão antiga ANULADA (TITULO_RENEGOCIADO, sistema) e nova CONFIRMADA no título novo, autor humano herdado, origemDecisaoId (I18j)."
  - "titulo_a_pagar: título novo upsertado ativo, antigo inativo; ItemLote em RASCUNHO trocado para o título novo (I18j(5))."
  - "Ledger concluido (ou concluido_sem_decisao / aguardando_aprovacao_manual / cancelado / recusado / indeterminado), com conexos_username e conexos_usn_cod (I-2)."
side_effects:
  - "Escrita no ERP: fin070 (POST, POST titulos, POST titulos/composicao, PUT, PUT finalizar; PUT cancelar na compensação) e fin103 (validaSelecionado, aplicarComando). Leituras: fin064, fin015 pendentes/rascunho, fin103/list, fin106/finBloqCmd/list."
  - "Trilha só-inclusão: AJUSTE_SIMULADO, TITULO_RENEGOCIADO, DECISAO_TRANSFERIDA, AJUSTE_RECUSADO, AJUSTE_CANCELADO, AJUSTE_FALHOU; trilha do lote: ITEM_TITULO_RENEGOCIADO."
  - "LogService em pt-BR, código sempre mascarado."
---

# ajustarCentavosTitulo

> **Status de implementação (2026-10-19, `partial`).** **Entregue** (código das Tasks 1-12 e 16, modo `off` por
> default): elegibilidade (I18a), régua líquida, executor com compensação e retomada (I18c-j), gatilho pós-commit
> do confirmar, rotas de "tentar de novo" e varredura, bloqueio do `finalizarLote` enquanto roda (I18g, I18k),
> migration `0087`, tela com estado do ajuste e nova tentativa. **Pendente:** os portões **G1** (sonda de leitura
> do login do servidor), **G2/G3** (HML: vencimento passado/hoje e cancelar a renegociação não finalizada),
> **G4** (medição do líquido/pagamento parcial, Task 13) e **G5** (rollout, ver
> `_inbox/sispag-ajuste-centavos-rollout-g5.md`); a rota `cancelarRenegociacao` do `fin070` segue
> `NotImplementedError` atrás de `CANCELAMENTO_FIN070_PROVADO = false`; o default da guarda I17m
> (`MODO_GUARDA_VALOR_J = BLOQUEIA`) aguarda a medição da Task 13. `on` em PRD continua proibido.

ADR-0073. Renegocia no `fin070` o título a pagar cujo boleto confirmado difere em centavos (I18), libera só o
bloqueio que a renegociação criou e faz decisão, carteira e item seguirem o título novo. **Três gatilhos, uma
ação:** após o commit do `confirmarSugestaoBoleto` (assíncrono), "tentar de novo" (`sispag:executar`) e a
varredura de retomada no processo do servidor (I18g). Nunca pela remessa, nunca por cron. Idempotente por
I18h/I18i. **Planned** (modo `off` por default).
