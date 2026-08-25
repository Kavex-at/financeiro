---
name: LotePagamento
type: entity
ontology_version: "0.9"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0023_lote_pagamento.sql
  - src/backend/migrations/0026_lote_automatico.sql
  - src/backend/migrations/0027_lote_retornado.sql
  - src/backend/migrations/0030_remove_internacional.sql
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/routes/sispag.ts
  - src/backend/jobs/formar-lotes.ts
  - src/frontend/app/sispag/page.tsx
properties:
  - id
  - filCod
  - banco
  - conta
  - status
  - automatico
  - criadoPor
  - finalizadoPor
  - finalizadoEm
  - versao
  - itens
relationships:
  - "LotePagamento 1—N ItemLote (agregado — os títulos incluídos, snapshot de valor/venc na inclusão)"
  - "LotePagamento N—1 Filial (via filCod — todos os itens são da MESMA filial, I4)"
  - "ItemLote N—1 TituloAPagar (via filCod:docCod:titCod — o título do ERP incluído no lote)"
last_review: 2026-07-18
universality_evidence:
  - "docs/proposta/Proposta_Kavex_Columbia_Financeiro.md — Frente II (SISPAG): montar o lote diário de pagamentos, analista revisa e finaliza (human-in-the-loop)"
  - "ADR-0018 — formação AUTOMÁTICA de lotes candidatos (cron pós-ingestão + manual): pré-montar os lotes das obrigações a-vencer é a automação natural sobre a montagem manual; universal em contas-a-pagar de trading com comex"
  - "ontology/_inbox/sispag-native-vs-nexxera.md §1 — 17 lotes fin015 reais (FinLoteSispag por filial/banco/conta, analistas FLAVIA_SANTOS/RENE_DUARTE) — o lote de pagamento é conceito nativo do ERP"
  - "ontology/_inbox/sispag-painel-montagem-interview.md — Eixo 1/2, lote candidato montado pela analista (RASCUNHO→FINALIZADO)"
  - "Conceito universal de financeiro/comex: agrupar títulos a pagar em um lote para revisão e liberação em bloco (o borderô/lote de pagamento)"
---

# LotePagamento (lote candidato — agregado local)

> **Agregado NOVO** do Escopo II (SISPAG). Um `LotePagamento` é o **lote candidato** que a
> analista monta a partir dos títulos a pagar aprovados: ela **inclui/remove** títulos e depois
> o **finaliza** (o gate). É **persistido localmente** (`lote_pagamento` + `lote_pagamento_item`),
> **NÃO** no ERP — nesta fatia nada é escrito no Conexos (I1). O lote FINALIZADO é o "pronto para
> processar"; o processamento real (remessa/pasta/Nexxera/baixa) é a **próxima feature** (ADR-0015).

## Por que um agregado local (e não o lote nativo do `fin015`)

O ERP já tem um lote SISPAG nativo (`FinLoteSispag`, por filial/banco/conta) — mas dirigir o
`fin015` é **escrita**, fora de escopo aqui. O `LotePagamento` é o nosso **rascunho de montagem
assistida**: onde a analista compõe o lote candidato com auditoria (quem incluiu/removeu/finalizou)
**antes** de qualquer efeito no ERP. Ele **sobrevive à re-leitura** da carteira (≠ um cálculo por
run) — espelha a doutrina de `permuta_alocacao` (rascunho persistido) da Frente I.

Na próxima fatia, um `LotePagamento` FINALIZADO é o insumo que **dirige** o `fin015` (montar +
gerar remessa) — não um gerador de arquivo paralelo. Ver ADR-0015.

## Formação automática vs. montagem manual (`automatico`, ADR-0018)

Um `LotePagamento` nasce de dois caminhos, discriminados pela propriedade `automatico`:

- **Manual** (`automatico=false`) — a analista abre e preenche o lote à mão (`gerenciarLoteCandidato`).
- **Automático** (`automatico=true`) — o cron `formarLotesAutomaticos` (encadeado após a ingestão) +
  o trigger manual `POST /sispag/lotes/formar` **pré-montam** lotes candidatos a partir da carteira
  persistida: agrupam títulos **a-vencer ≤7d** por **filial** (I4), nascendo **RASCUNHO** em "Lotes
  candidatos" para a analista **revisar** antes de finalizar (badge "automático"). Ver
  `actions/sispag/formar-lotes-automaticos.md`.

> **Internacional fora do escopo (ADR-0021, 2026-07-18).** O SISPAG é **doméstico** — pagamento ao
> exterior é câmbio manual da tesouraria, não passa pela remessa SISPAG. Títulos internacionais são
> filtrados na ingestão e nunca entram na carteira, então **não há mais divisão por classe** no lote: o
> agrupamento automático é **só por filial** (I4), a coluna `internacional` foi removida (migration
> 0030) e o invariante **I7** (lote uniforme nacional × internacional) foi **aposentado**. Ver ADR-0021
> (supersede ADR-0017).

**Comportamento `desfazer-vencidos` (só afeta o automático):** a cada rodada, um lote **automático**
ainda **RASCUNHO** que passou a conter **≥1 título VENCIDO** é **desfeito** (deletado) e seus títulos
**liberados** — só a-vencer é elegível a lote automático. Isso **não** é um status novo (não há
`VENCIDO` na máquina): o auto-lote é **efêmero/re-formável**, distinto do `CANCELADO` (decisão da
analista) e do lote **manual** (que o cron **nunca** toca). Lotes **FINALIZADOS/CANCELADOS** também são
intocáveis. Ver `state-machines/lote-pagamento.md` (transição L6) e ADR-0018.

## Agregado: `LotePagamento` (raiz) + `ItemLote` (membro)

O agregado é a **raiz de consistência**: as invariantes (uma filial por lote I4, não-duplicação
I3, elegibilidade do item I2) são garantidas na fronteira do agregado. O `ItemLote` não existe
fora de um lote.

### Propriedades — `LotePagamento` (`lote_pagamento`)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `id` | string (uuid) | `lote_pagamento.id` | Identidade do lote candidato. |
| `filCod` | number | `lote_pagamento.fil_cod` | **Uma filial por lote** (I4). Todos os itens compartilham este `filCod`. |
| `banco` | string? | `lote_pagamento.banco` | **Metadado opcional** — agrupamento é por filial nesta fatia; banco/conta é informativo (ADR-0015). |
| `conta` | string? | `lote_pagamento.conta` | Metadado opcional (idem `banco`). |
| `status` | enum | `lote_pagamento.status` | `RASCUNHO \| FINALIZADO \| RETORNADO \| CANCELADO` — constantes tipadas. `RETORNADO` (ADR-0019, migration 0027) = retorno do Nexxera recebido; `FINALIZADO` passou a significar **"aguardando o retorno do Nexxera"**. Ver `state-machines/lote-pagamento.md`. |
| `automatico` | boolean | `lote_pagamento.automatico` (migration 0026) | **Procedência do lote** — `true` = formado pelo cron `formarLotesAutomaticos`; `false` = montado à mão pela analista (`gerenciarLoteCandidato`). Dirige o **badge "automático"** na UI e, sobretudo, o **escopo do cron**: a formação só cria/desfaz lotes **automáticos RASCUNHO** — lotes manuais e finalizados são **intocáveis** (ADR-0018). Ver `actions/sispag/formar-lotes-automaticos.md`. |
| `criadoPor` | string | `lote_pagamento.criado_por` | Auditoria: quem abriu o lote (`'cron'` nos automáticos, username nos manuais). |
| `finalizadoPor` | string? | `lote_pagamento.finalizado_por` | Auditoria: quem finalizou (gate). `null` enquanto RASCUNHO. |
| `finalizadoEm` | Date? | `lote_pagamento.finalizado_em` | Timestamp da finalização. `null` enquanto RASCUNHO. |
| `versao` | number | `lote_pagamento.versao` | Controle otimista de concorrência (I6 — 2 analistas). Incrementa a cada transição. |
| `itens` | ItemLote[] | join `lote_pagamento_item` | Os títulos incluídos (agregado). |

### Propriedades — `ItemLote` (`lote_pagamento_item`)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `loteId` | string | `lote_pagamento_item.lote_id` | FK para o lote (raiz do agregado). |
| `filCod` | number | `lote_pagamento_item.fil_cod` | Igual ao `filCod` do lote (I4). Parte da chave de não-duplicação (I3). |
| `docCod` | string | `lote_pagamento_item.doc_cod` | Documento do título. Parte de `filCod:docCod:titCod` (I3). |
| `titCod` | string | `lote_pagamento_item.tit_cod` | Título/parcela. Parte de `filCod:docCod:titCod` (I3). |
| `credor` | string | `lote_pagamento_item.credor` | **Snapshot** no momento da inclusão (exibição estável). |
| `valor` | number | `lote_pagamento_item.valor` | **Snapshot** do valor do título na inclusão. |
| `vencimento` | Date | `lote_pagamento_item.vencimento` | **Snapshot** do vencimento na inclusão. |
| `incluidoPor` | string | `lote_pagamento_item.incluido_por` | Auditoria: quem incluiu o item. |

> **Por que snapshot no item:** o `TituloAPagar` é read-through (muda no ERP entre leituras); o
> `ItemLote` congela valor/venc/credor no instante da inclusão, preservando o que a analista viu
> ao montar o lote (auditoria + estabilidade da tela). O valor autoritativo para o pagamento real
> volta a vir do ERP na próxima fatia (como em Permutas, anti-super-pagamento).

## Invariantes aplicáveis

- **I2 (elegibilidade do item):** um `ItemLote` só existe para um `TituloAPagar` **`liberado` (aprovado)
  e não `pago`**. Ver `business-rules/elegibilidade-titulo-lote.md`.
- **I3 (não-duplicação):** um título (`filCod:docCod:titCod`) **não** pode estar em dois lotes
  `RASCUNHO` ao mesmo tempo — UNIQUE parcial (`WHERE status = 'RASCUNHO'`). Ver
  `business-rules/nao-duplicacao-titulo-lote.md`.
- **I4 (uma filial por lote):** todos os `ItemLote` de um lote têm o mesmo `filCod` do lote —
  compatível com o `fin015` nativo (por filial/banco). Multi-filial = múltiplos lotes. Ver
  `business-rules/lote-uma-filial.md`.
- **~~I7 (lote uniforme nacional × internacional)~~ — APOSENTADO (ADR-0021, 2026-07-18):** o SISPAG é
  **doméstico**; internacional é câmbio manual da tesouraria (fora do escopo) e é **filtrado na
  ingestão**, então não há mistura possível. A coluna `internacional`, o erro `LoteTipoConflitoError`
  e a classificação na inclusão foram **removidos** (migration 0030 purga + drop). Ver
  `business-rules/lote-uniforme-nacional-internacional.md` (retirado) e ADR-0021.
- **I5 (gate reversível + auditoria):** `finalizarLote` é reversível por `reabrirLote` **enquanto**
  não houver etapa downstream (não há nesta fatia). Toda transição registra ator + timestamp.
- **I6 (concorrência):** montagem/finalização são seguras a 2 analistas via `versao` (optimistic
  lock), espelhando a doutrina de Permutas.
- **I1 (sem escrita no ERP):** o lote é rascunho na tabela própria; nenhuma remessa/baixa no ERP.

## Cardinalidade

Um `LotePagamento` agrega **N** `ItemLote` (1 filial, I4). Um `TituloAPagar` elegível pode estar em
**no máximo 1** lote `RASCUNHO` (I3), mas pode reaparecer num novo lote se o anterior for
`CANCELADO` ou (na próxima fatia) processado.

## Retorno do Nexxera (`RETORNADO`, ADR-0019)

O ciclo de vida ganhou o status **`RETORNADO`** ("de volta do Nexxera"), alcançado por `marcarRetorno`
(transição L7, `FINALIZADO → RETORNADO`; ver `state-machines/lote-pagamento.md`). Com isso o `FINALIZADO`
passa a significar **"finalizado pelo analista, aguardando o retorno do Nexxera"** — não mais só "pronto
para processar". **Hoje `marcarRetorno` é acionada MANUALMENTE** (botão "Marcar retorno recebido"),
**simulando** o retorno; o gatilho real será o **robô-poller** do arquivo de retorno (`fin052`) da Fatia 3.
`RETORNADO` é **terminal por ora** — a baixa/conciliação (`fin010`) que o consome é a Fatia 3. Migration
`0027_lote_retornado.sql` recria o CHECK de `status` incluindo `RETORNADO`; `POST /sispag/lotes/:id/retorno`
→ `LotePagamentoService.marcarRetorno` (optimistic-lock por `versao`, I6). READ-only no ERP mantido (I1).

## Recuperação de execução interrompida (ADR-0039)

As escritas do `fin015` e o `processar` do `fin052` **não são idempotentes**: um retry cego
significa um segundo lote de pagamento, ou baixa em cima de baixa. Os dois ledgers write-ahead
(`remessa_execucao` 0049, `conciliacao_execucao` 0050) travam isso.

Desde a ADR-0039, travar deixou de ser o fim: quando o ERP **expõe estado verificável** daquela
escrita, a retomada **consulta** e continua do ponto certo, em vez de exigir conserto manual no
fin015. Onde não expõe, o fail-closed do ADR-0013 continua valendo.

A máquina de retomada, o encoding medido do `flpVldStatus`, a ordem obrigatória do write-ahead
(marca d'água antes do `criarLote`, nome do arquivo antes do `gerarRemessa`) e os três casos que
seguem travando estão em **`business-rules/retomada-remessa-sispag.md`**.

Um caso não trava nem retoma sozinho: **lote cancelado**. O ERP deixa o mesmo `flpVldStatus = 2`
para "cancelei para limpar o órfão" e "cancelei para abortar o pagamento", então quem decide é a
pessoa — `LoteAnteriorCanceladoError` e um segundo clique na tela.

## Fora de escopo (Fatia 1+2)

- Nenhuma escrita no ERP: gerar remessa (`fin015`), pasta de rede, VAN Nexxera, leitura real do retorno
  (`fin052`, hoje simulada por `marcarRetorno`), baixa (`fin010`) e o **scheduler** de cadência diária
  são a **próxima feature** (ADR-0015). O `FINALIZADO`/`RETORNADO` aqui são **gatilhos conceituais**, sem
  downstream real no ERP.
