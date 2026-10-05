---
name: finalizarLote
type: action
entity: LotePagamento
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0023_lote_pagamento.sql
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
last_review: 2026-10-05
preconditions:
  - "Requer papel admin (requireRole('admin'))."
  - "Lote em RASCUNHO com ≥1 item; todos os itens ainda elegíveis (liberado + não pago)."
  - "Todo item com modalidade definida (ModalidadePendenteError, migration 0031)."
  - "Todo item TED/PIX com destino resolvível — conta/chave ativa do cadastro cmn025 ou, na falta, ExcecaoDestino APROVADA do favorecido (I10a, I12f; ADR-0054, ADR-0061). Desde a ADR-0063 a verificação retira do lote o item sem destino (I13j) e a finalização não acontece (ItemsRemovedByCheckError)."
  - "verificarItensTedPix roda antes da transição (I13a): nenhum item TED/PIX com verificacaoEstado PENDENTE (PaymentCheckPendingError, I13b) e nenhuma AlertaItemLote de duplicidade ABERTA (PendingDuplicateAlertError, I13f). Alerta de canal habitual não barra."
postconditions:
  - "Lote RASCUNHO → FINALIZADO (L3): registra finalizadoPor + finalizadoEm; incrementa versao."
  - "Lote com ≥1 item TED/PIX fica aguardando conferência por 2ª pessoa (L12 conferirLote) antes do gerarRemessa (L8, I13l; ADR-0063)."
  - "O lote FINALIZADO é o 'pronto para processar' — gatilho CONCEITUAL, SEM downstream nesta fatia (I1)."
  - "Reversível por reabrirLote (L4) enquanto não houver etapa downstream (não há nesta fatia; I5)."
side_effects:
  - "Escrita LOCAL: lote_pagamento.status/finalizado_por/finalizado_em + auditoria. NENHUMA escrita no ERP (I1)."
  - "reabrirLote (L4): FINALIZADO → RASCUNHO (mesma auditoria; limpa a conferência, ADR-0063); cancelarLote (L5): → CANCELADO (terminal, libera títulos da I3)."
  - "Leitura ao vivo no Conexos (fin064, cmn025) pela verificação TED/PIX; escrita local de alertas, pendências de cadastro e remoções pelo sistema (ADR-0063)."
---

# finalizarLote — o GATE (Fatia 2)

> **Vigência:** 2026-07-07 (v0.5.0, ADR-0015). Marca o lote candidato como **FINALIZADO** — o
> gatilho human-in-the-loop que diz "este lote está pronto para processar". Nesta fatia o
> `FINALIZADO` **não tem downstream**: nada é enviado/baixado no ERP (I1). É o ponto de sutura para
> a próxima feature (transporte: pasta de rede + VAN Nexxera → `fin015`/`fin052`), que plugará o
> processamento **depois** deste gate. Cobre também `reabrirLote` e `cancelarLote`.

## Operações (rotas)

- `POST /sispag/lotes/:id/finalizar` → `finalizarLote` (L3): `RASCUNHO → FINALIZADO`.
- `POST /sispag/lotes/:id/reabrir` → `reabrirLote` (L4): `FINALIZADO → RASCUNHO`.
- `POST /sispag/lotes/:id/cancelar` → `cancelarLote` (L5): `{RASCUNHO,FINALIZADO} → CANCELADO`.

Todas `requireRole('admin')`, Zod no boundary, SQL parametrizado, auditoria.

## Regra do gate (L3)

- **Pré:** lote em `RASCUNHO`, com **≥1 item**, e **todos os itens ainda elegíveis** (revalida
  `liberado + não pago` no momento do finalizar — um título que virou pago/bloqueado entre a
  inclusão e a finalização barra o gate com mensagem). Ver
  `business-rules/elegibilidade-titulo-lote.md`.
- **Efeito:** `status = FINALIZADO`, grava `finalizadoPor` + `finalizadoEm`, incrementa `versao`.
- **Sem downstream (I1):** o finalizar **não** dirige o `fin015`, não gera remessa, não escreve na
  pasta de rede, não chama Nexxera, não baixa. É estado local. A próxima fatia lê o `FINALIZADO`
  como insumo.

## Verificação TED/PIX e conferência (ADR-0063)

Antes de transicionar, o gate roda `verificarItensTedPix` sobre todos os itens TED/PIX (I13):
dados de pagamento, duplicidade e canal habitual. Três desfechos barram a finalização: item retirado
pela verificação (`ItemsRemovedByCheckError` — a retirada fica gravada e a analista finaliza de
novo), verificação pendente por leitura falha (`PaymentCheckPendingError`) e alerta de duplicidade
não resolvida (`PendingDuplicateAlertError`). Depois de `FINALIZADO`, lote com TED/PIX só segue para
a remessa após `conferirLote` (L12) por outra pessoa com `sispag:conferir`. Ver
`business-rules/verificacao-ted-pix-sispag.md`.

## Reversibilidade (L4) e cancelamento (L5)

- **`reabrirLote` (L4):** `FINALIZADO → RASCUNHO` — permitido **enquanto não houver etapa
  downstream** (não há nesta fatia; I5). Quando a próxima fatia plugar o processamento, a reabertura
  passará a ser **gated** pelo estado do envio (um lote já enviado ao banco não reabre livre).
  Registrado como decisão explícita (ver ADR-0015): **hoje reversível**, não "reversível sempre".
- **`cancelarLote` (L5):** descarta o lote (`CANCELADO`, terminal) e **libera os títulos** (saem da
  UNIQUE parcial de I3), disponíveis para um novo lote.

## Segurança / consistência

- `requireRole('admin')` — só quem finaliza o lote (na Columbia, a operadora do processo, p.ex.
  Flávia) dispara o gate. Auditoria persistida (quem/quando).
- **Concorrência (I6):** transição via `versao` (optimistic lock) — dois finalizares concorrentes,
  um vence, o outro recebe conflito de versão (sem dupla-finalização).
- **I1:** nenhuma escrita no ERP em toda a ação.

## Por que está na ontologia (universalidade)

Universal: a **finalização humana** de um lote de pagamento (o "de acordo, pode processar") é o
ponto de controle irredutível de qualquer operação SISPAG assistida — separa a montagem (revisável)
do processamento (com efeito no banco). O lote nativo do `fin015` tem seu próprio "finalizar lote";
modelar o gate no nosso agregado é o que permite orquestrar a cadência antes de dirigir o ERP. A
estrutura (gate + reversibilidade condicionada ao downstream) é do domínio; quem finaliza e o
horário de corte são config/operação do tenant.
