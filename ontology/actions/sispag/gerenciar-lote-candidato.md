---
name: gerenciarLoteCandidato
type: action
entity: LotePagamento
ontology_version: "0.5"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0023_lote_pagamento.sql
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
last_review: 2026-09-22
preconditions:
  - "Requer papel admin (requireRole('admin')) nas mutações."
  - "criar: filCod válido; incluir: título aprovado (liberado) + não pago + mesma filial do lote + não em outro RASCUNHO."
  - "Lote em RASCUNHO para incluir/remover (FINALIZADO/CANCELADO não editam)."
postconditions:
  - "criarLoteCandidato → novo lote RASCUNHO para uma filial (L1); banco/conta opcionais."
  - "incluirTituloNoLote → ItemLote criado com snapshot de valor/venc/credor; título passa a ocupar a UNIQUE parcial de I3."
  - "incluirTituloNoLote → se o título tinha retenção ativa da formação automática, ela é liberada na mesma transação (motivoRemocao='incluido-no-lote', autor = quem incluiu; ADR-0050 D4)."
  - "removerTituloDoLote → ItemLote removido; título liberado da UNIQUE de I3. Pela aba de títulos ('Retirar do lote') retém na mesma transação (reterTituloDaFormacao, ADR-0050). Pela lixeira da tela do lote retém SÓ se o lote era automático (automatico lido antes do marcarManual, mesma transação); lote manual não retém."
  - "listarLotesCandidatos → lê os lotes locais (filtro status/filial). Nenhuma escrita no ERP (I1)."
side_effects:
  - "Escrita LOCAL (Postgres): lote_pagamento / lote_pagamento_item + auditoria (criado_por/incluido_por). Nenhuma escrita no ERP (I1)."
  - "Optimistic lock via versao (I6) — inclusão/remoção concorrente é segura."
---

# gerenciarLoteCandidato — criar / incluir / remover / listar (Fatia 2)

> **Vigência:** 2026-07-07 (v0.5.0, ADR-0015). Agrupa as operações de **montagem** do lote
> candidato: abrir (`criarLoteCandidato`), ajustar (`incluirTituloNoLote`/`removerTituloDoLote`) e
> listar (`listarLotesCandidatos`). Tudo **LOCAL** (Postgres) — **zero escrita no ERP** (I1). A
> transição de status FINALIZADO é a ação separada `finalizarLote` (o gate).

## Operações (rotas)

- `POST /sispag/lotes` → `criarLoteCandidato` (L1): abre um lote `RASCUNHO` para um `filCod`
  (banco/conta opcionais, metadado). `requireRole('admin')`.
- `POST /sispag/lotes/:id/itens` → `incluirTituloNoLote` (L2): inclui um título elegível.
- `DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod` → `removerTituloDoLote` (L2).
- `GET /sispag/lotes` → `listarLotesCandidatos`: lê os lotes locais (filtro `status`/`filCod`).
  Leitura autenticada.

Contrato: Zod no boundary, SQL parametrizado, `requireRole('admin')` nas mutações, auditoria
persistida.

## Regras de inclusão (as três invariantes do agregado)

Ao `incluirTituloNoLote`, o título candidato é validado contra:

1. **I2 — elegibilidade:** o `TituloAPagar` deve estar **`liberado` (aprovado na alçada) e não
   `pago`**. Não-aprovado/pago → bloqueado com mensagem. Ver
   `business-rules/elegibilidade-titulo-lote.md`.
2. **I4 — uma filial por lote:** o `filCod` do título = `filCod` do lote. Filial diferente →
   bloqueado (abrir outro lote). Ver `business-rules/lote-uma-filial.md`.
3. **I3 — não-duplicação:** o título (`filCod:docCod:titCod`) não pode estar em **outro lote
   RASCUNHO**. Colisão na UNIQUE parcial → bloqueado. Ver
   `business-rules/nao-duplicacao-titulo-lote.md`.

Passando os três, cria-se um `ItemLote` com **snapshot** de `valor`/`vencimento`/`credor` (congela
o que a analista viu) + `incluido_por` (auditoria).

A retenção da formação automática (I8, ADR-0050) **não** barra a inclusão. Se o título estava retido,
a inclusão libera a retenção na mesma transação: lotar à mão é a forma prevista de encerrá-la.

## Remoção a partir da aba de títulos (ADR-0050)

"Retirar do lote" na aba "Títulos a pagar" é `removerTituloDoLote` + retenção do título, atômicos
(ação [`reterTituloDaFormacao`](./reter-titulo-da-formacao.md)). Sem a retenção, o próximo cron
re-lotaria o título.

A lixeira dentro do lote (`removerTituloDoLote` pela tela do lote) também retém, **só quando o lote é
automático** (P1-1 em `_inbox/sispag-retirar-titulo-lote-gap.md`, respondida em 2026-09-22). A ordem
importa: `automatico` é lido **antes** de `marcarManual` virar o lote para manual, e a remoção, o
`marcarManual` e a retenção vão na mesma transação. Num lote manual a remoção continua sem reter: a
analista está rearranjando o próprio lote.

## Segurança / consistência

- `requireRole('admin')` nas mutações; leitura autenticada — espelha Permutas.
- **Idempotência/concorrência (I6):** `versao` (optimistic lock) no lote — duas analistas
  incluindo o mesmo título competem na UNIQUE de I3 (uma ganha, a outra recebe o bloqueio), sem
  dupla-inclusão. A UNIQUE parcial é a rede de segurança real (não só o check em app).
- **I1 (sem escrita no ERP):** todas as operações gravam **só** no Postgres local. O
  `ConexosSispagClient` permanece read-only.

## Por que está na ontologia (universalidade)

Universal: montar um lote de pagamento incluindo/removendo títulos aprovados, com auditoria de
quem-montou, é o núcleo do human-in-the-loop de qualquer operação SISPAG (o lote nativo do
`fin015` já prova o conceito — por filial/banco, com analista). A estrutura (agregado
lote+itens, snapshot, as 3 invariantes) é do domínio; os valores (níveis de alçada, IDs de
filial/banco) são config do tenant.
