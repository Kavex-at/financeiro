---
name: montarPainelPagamentos
type: action
entity: TituloAPagar
ontology_version: "0.5"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
last_review: 2026-09-23
preconditions:
  - "Leitura autenticada (qualquer usuário autenticado) — sem requireRole nas reads."
  - "ConexosSispagClient é só-leitura (nenhum verbo mutante importado) — I1."
postconditions:
  - "Retorna a carteira de títulos a pagar na janela −15d..+45d (a vencer + vencidos), com aging, liberado (alçada) e pago."
  - "Retorna KPIs (totais por status/aging) + os lotes SISPAG nativos (fin015) e borderôs a-pagar (fin010) como CONTEXTO."
  - "Nenhuma escrita no ERP nem no Postgres (I1) — leitura pura read-through."
side_effects:
  - "Leitura Conexos: fin064 (carteira) + com308 (alçada/detalhe) + fin015 (lotes nativos, contexto) + fin010 (borderôs a-pagar, contexto)."
---

# montarPainelPagamentos — painel diário read-only (Fatia 1)

> **Vigência:** 2026-07-07 (v0.5.0, ADR-0015). Expõe a **visibilidade diária** dos títulos a pagar
> aprovados (a vencer + vencidos, com valor e aging) + KPIs + os lotes nativos e borderôs como
> contexto. É **READ-ONLY** (I1) — nenhuma ação de escrita é oferecida aqui. Já existia no spike
> (`GET /sispag/painel`); esta ação **formaliza** o contrato de leitura na ontologia.

## Operação (file:line)

- `GET /sispag/painel` (`src/backend/routes/sispag.ts`) — leitura autenticada.
- `SispagPainelService.montarPainel({ filCod?, janela? })`
  (`src/backend/domain/service/sispag/SispagPainelService.ts`).
- `ConexosSispagClient.listTitulosAPagar` / `listLotesSispag` / `listBorderosAPagar` (só-leitura).

## Comportamento

- **Janela do painel:** títulos com vencimento em **−15d..+45d** (vencidos recentes + a vencer),
  ordenados por aging (mais urgente primeiro). A janela é parametrizável (config), não hardcode.
- **Enriquecimento por título:** `liberado` (AND das flags de alçada `titVld1/2/3libera`, `com308`)
  e `pago` (quitado no ERP) — os dois gates que definem se o título é **elegível** para o lote
  (I2, `business-rules/elegibilidade-titulo-lote.md`). O painel mostra ambos como visibilidade
  (aprovado-e-pendente vs. bloqueado/pago), não só os elegíveis.
- **KPIs:** totais por status/aging (a vencer, vencidos, aprovados-pendentes, valor total) para a
  leitura de cadência diária.
- **Contexto (abas):** os **lotes SISPAG nativos** (`fin015`) e os **borderôs a-pagar** (`fin010`)
  são lidos e exibidos como contexto — o que o ERP já executa. **Não** participam do nosso ciclo
  de vida de lote candidato (ver `state-machines/lote-pagamento.md`).
- **Lote por título (ADR-0050):** cada linha carrega o lote RASCUNHO em que o título está
  (`loteRascunho { id, automatico }`, além de `emLote`), mostrado como link que abre o card do lote
  na aba "Lotes candidatos". A ação "Retirar do lote" da linha é `removerTituloDoLote`
  ([`gerenciarLoteCandidato`](./gerenciar-lote-candidato.md)).
- **READ-ONLY:** nenhuma escrita no ERP (I1). O botão "montar lote" da tela dispara
  `criarLoteCandidato` (persistência **local**, ver `gerenciar-lote-candidato.md`), não uma
  escrita no Conexos.

## Segurança / consistência

- Reads autenticadas (qualquer usuário); as **mutações** de lote exigem `requireRole('admin')`
  (ver as outras ações SISPAG) — espelha Permutas.
- Zod/guard de identidade nos boundaries do ERP (padrão Regis Integrability) — valida o shape das
  respostas `fin064`/`com308`/`fin015`/`fin010` antes de mapear.
- Banner na tela "sem escrita no ERP" — reforça a natureza read-only da fatia.

## Por que está na ontologia (universalidade)

Universal: dar visibilidade da carteira de pagamentos aprovada, com aging, é o insumo de qualquer
operação SISPAG — o gargalo declarado é **falta de visibilidade + cadência**, não geração de
arquivo. A estrutura (janela, aging, gates liberado/pago, KPIs) é do domínio; os valores (janela
exata, níveis de alçada, IDs de banco) são config do tenant.
