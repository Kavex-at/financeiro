---
name: LotePagamento
type: entity
ontology_version: "0.31.0"
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
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/migrations/0031_sispag_modalidade.sql
  - src/frontend/app/sispag/components/LoteCard.tsx
  - src/backend/migrations/0049_sispag_remessa_retorno.sql
  - src/backend/domain/service/sispag/SincronizacaoLoteService.ts
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
  - dataDebito
  - itens
  - itens[].modalidade
  - itens[].destinoOrigem
  - itens[].excecaoDestinoId
  - itens[].situacao
  - itens[].pagoEm
  - itens[].pagoObservadoEm
  - itens[].valorPago
  - itens[].origemBaixa
  - itens[].baixaFonte
  - itens[].divergencia
  - itens[].sincronizadoEm
relationships:
  - "LotePagamento 1—N ItemLote (agregado — os títulos incluídos, snapshot de valor/venc na inclusão)"
  - "LotePagamento N—1 Filial (via filCod — todos os itens são da MESMA filial, I4)"
  - "ItemLote N—1 TituloAPagar (via filCod:docCod:titCod — o título do ERP incluído no lote)"
  - "ItemLote N—0..1 ExcecaoDestino (a exceção APROVADA usada como destino; ADR-0061; vazio quando o destino vem do cadastro)"
last_review: 2026-10-05
universality_evidence:
  - "docs/proposta/Proposta_Kavex_Columbia_Financeiro.md — Frente II (SISPAG): montar o lote diário de pagamentos, analista revisa e finaliza (human-in-the-loop)"
  - "ADR-0018 — formação AUTOMÁTICA de lotes candidatos (cron pós-ingestão + manual): pré-montar os lotes das obrigações a-vencer é a automação natural sobre a montagem manual; universal em contas-a-pagar de trading com comex"
  - "ontology/_inbox/sispag-native-vs-nexxera.md §1 — 17 lotes fin015 reais (FinLoteSispag por filial/banco/conta, analistas FLAVIA_SANTOS/RENE_DUARTE) — o lote de pagamento é conceito nativo do ERP"
  - "ontology/_inbox/sispag-painel-montagem-interview.md — Eixo 1/2, lote candidato montado pela analista (RASCUNHO→FINALIZADO)"
  - "Conceito universal de financeiro/comex: agrupar títulos a pagar em um lote para revisão e liberação em bloco (o borderô/lote de pagamento)"
  - "dataDebito: o lote nativo do fin015 carrega a data de débito (flpDtaCredito) e o finalizarLote a valida (R1/R2, sispag-fin015-exploration.md:72-76) — todo lote SISPAG/CNAB 240 tem data de pagamento; pedido da Flavia (Columbia) de 2026-09-22, ADR-0049"
  - "modalidade + destino do item: todo item de remessa CNAB 240 tem forma de lançamento (segmento A) e, para TED/PIX, destino (conta ou chave, segmentos A/B); FinItemSispag.itsVldModalidade/pctCodSeq/itsDesChavePix no fin015 (sispag-ted-pix-plan.md §2, 89 itens PRD)"
  - "ExcecaoDestino (ADR-0061; antes destinoManual, ADR-0054): 12/21 favorecidos sem conta e 0 chave PIX no cadastro (PRD 2026-09-28), cadastro desatualizado (Yuri); ADR-0054. Conceito universal (conta/chave do favorecido informada no pagamento); o cadastro do Conexos é a fonte principal e o destino fora dele exige exceção aprovada por 2ª pessoa (controle antifraude, universal em contas a pagar; 1 cliente até agora, gap Q11)"
  - "sincronização pelo título (ADR-0055): o pagamento de um título a pagar é observável no próprio título em qualquer ERP (saldo aberto zero); o arquivo de retorno bancário é uma das origens possíveis da baixa, não a única — caso PG230901.REM, baixa manual do 38682/1 em 24/09"
---

# LotePagamento (lote candidato — agregado local)

> **Agregado NOVO** do Escopo II (SISPAG). Um `LotePagamento` é o **lote candidato** que a
> analista monta a partir dos títulos a pagar aprovados: ela **inclui/remove** títulos e depois
> o **finaliza** (o gate). É **persistido localmente** (`lote_pagamento` + `lote_pagamento_item`).
> Até `FINALIZADO` nada é escrito no Conexos; a partir de L8 o lote dirige o `fin015` (remessa) e,
> depois, **acompanha a baixa dos títulos** no ERP (L11, ADR-0055). Ver
> `state-machines/lote-pagamento.md`.

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
| `status` | enum | `lote_pagamento.status` | `RASCUNHO \| FINALIZADO \| REMESSA_GERADA \| RETORNADO \| BAIXADO \| CANCELADO` — `LOTE_STATUS` (P3; CHECK da 0049). `FINALIZADO` = gate passado, sem remessa. `REMESSA_GERADA` = `.REM` gerado, aguardando a baixa dos títulos. `RETORNADO` = rejeição lida no `fin052`. `BAIXADO` = todo título pago (terminal). Ver `state-machines/lote-pagamento.md`. |
| `automatico` | boolean | `lote_pagamento.automatico` (migration 0026) | **Procedência do lote** — `true` = formado pelo cron `formarLotesAutomaticos`; `false` = montado à mão pela analista (`gerenciarLoteCandidato`). Dirige o **badge "automático"** na UI e, sobretudo, o **escopo do cron**: a formação só cria/desfaz lotes **automáticos RASCUNHO** — lotes manuais e finalizados são **intocáveis** (ADR-0018). Ver `actions/sispag/formar-lotes-automaticos.md`. |
| `criadoPor` | string | `lote_pagamento.criado_por` | Auditoria: quem abriu o lote (`'cron'` nos automáticos, username nos manuais). |
| `finalizadoPor` | string? | `lote_pagamento.finalizado_por` | Auditoria: quem finalizou (gate). `null` enquanto RASCUNHO. |
| `finalizadoEm` | Date? | `lote_pagamento.finalizado_em` | Timestamp da finalização. `null` enquanto RASCUNHO. |
| `versao` | number | `lote_pagamento.versao` | Controle otimista de concorrência (I6 — 2 analistas). Incrementa a cada transição. |
| `dataDebito` | Date? (data civil, sem hora) | `lote_pagamento.data_debito` *(a criar)* | **Data de débito/pagamento** que vai ao `fin015` como `flpDtaCredito`. Escolhida pela analista ao pedir a remessa (L8); default = **hoje no fuso de Brasília**. Tem de cair na janela de I8. `null` até a primeira tentativa de remessa. **Imutável** a partir do momento em que existe lote nativo no `fin015` criado com ela (I8b). Ver `business-rules/data-debito-remessa-sispag.md` e ADR-0049. |
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
| `modalidade` | enum? | `lote_pagamento_item.modalidade` (migration 0031) | Forma de pagamento: `BOLETO \| TED \| PIX \| CREDITO_CONTA`; `null` = "a definir" (bloqueia a finalização, `ModalidadePendenteError`). Escolhida pela analista, só em RASCUNHO (L2); boleto pré-selecionado quando o título tem DDA. **Oferecidas:** `BOLETO`, `TED`, `PIX`. `CREDITO_CONTA` segue válido no enum para item que já o tem, mas **não é oferecido** (commit `fc22dcd`). Mapeamento para o `fin015` (`itsVldModalidade`): TED = **5**, crédito = 1, boleto = derivado pelo ERP da DDA; PIX não tem código próprio, é o conjunto `itsVldChavePix`/`itsDesChavePix`/... (H4). *Existia desde 2026-07-18 e faltava nesta doc.* |
| `destinoOrigem` | enum? (derivado) | — | `CADASTRO` (cmn025 ao vivo) \| `EXCECAO` (`ExcecaoDestino` aprovada, fallback) \| `null` para boleto. Dirige o selo "exceção" na tela. Ver `business-rules/destino-pagamento-sispag.md` e `excecao-destino-sispag.md`. |
| `excecaoDestinoId` | string? | `lote_pagamento_item.excecao_destino_id` *(a criar)* | FK lógica para a `ExcecaoDestino` usada, **gravada quando o destino congela** (I10f); liga o item à exceção sem copiar o valor. `null` quando o destino vem do cadastro. A coluna antiga `destino_*` (ADR-0054) fica inerte. |
| `situacao` | enum (derivado) | — | `AGENDADO \| PAGO \| REJEITADO \| SEM_RETORNO`, derivada pela sincronização (I11d); **não** é estado do lote (decisão "sem estado parcialmente pago"). Constantes tipadas (`ITEM_SITUACAO`). Só existe de `REMESSA_GERADA` em diante. |
| `rejeitado` · `retornoEvento` · `retornoDescricao` | boolean · string? · string? | `rejeitado`, `retorno_evento`, `retorno_descricao` (0049) | Evento do `fin052` **escolhido por precedência** `REJEITADO > 00 > BD > outro` sobre todas as linhas do item (I11d), nunca a última lida. *Existiam desde a 0049 e faltavam nesta doc.* |
| `borCod` · `bxaCodSeq` | number? | `bor_cod`, `bxa_cod_seq` (0049) | Borderô/baixa da baixa do título. **Enriquecimento**, não prova de pagamento. Nulos quando nenhuma fonte legível os trouxe. |
| `baixaFonte` | enum? | `baixa_fonte` *(a criar)* | De onde vieram `borCod`/`bxaCodSeq`: `RETORNO` (linha de detalhe do `fin052`) \| `TITULO` (`com308` baixas, PSQ_018). |
| `origemBaixa` | enum? | `origem_baixa` *(a criar)* | `REMESSA` (baixa ligada a um retorno deste lote) \| `FORA_DO_RETORNO` (baixa no título sem vínculo com o retorno: `fin010` manual ou processamento nativo) \| `NAO_IDENTIFICADA` (pago no `fin064`, PSQ_018 ilegível). Manual × nativo **não** é distinguido (não observável com segurança). |
| `pagoEm` · `valorPago` | Date? · number? | `pago_em`, `valor_pago` *(a criar)* | Data e valor da baixa, do PSQ_018 quando legível; nulos caso contrário. |
| `pagoObservadoEm` | Date? | `pago_observado_em` *(a criar)* | Primeira sincronização que viu o título pago no `fin064`. Não nulo ⇔ a situação `PAGO` foi observada. |
| `divergencia` | boolean + detalhe | `divergencia`, `divergencia_detalhe` *(a criar)* | Contradição observada que a máquina **não** resolve sozinha: título antes pago voltou a aberto (estorno), ou item `REJEITADO` com título pago. Gera `Alerta` `sispag-baixa-divergente` (I11f). |
| `sincronizadoEm` | Date? | `sincronizado_em` *(a criar)* | Última leitura **bem-sucedida** do título. Atualizá-la **não** incrementa `versao` (I11h). |

> **`DestinoManual` retirado (ADR-0061).** O destino fora do cadastro agora é a entidade `ExcecaoDestino` (por favorecido, aprovada por 2ª pessoa): ver `entities/excecao-destino.md`.

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
- **I5 (gate reversível + auditoria):** `finalizarLote` é reversível por `reabrirLote` **só em
  `FINALIZADO`**; depois da remessa não há volta local. Toda transição registra ator + timestamp (a
  sincronização grava o ator `sync`).
- **I6 (concorrência):** montagem/finalização são seguras a 2 analistas via `versao` (optimistic
  lock), espelhando a doutrina de Permutas.
- **I1 (sem escrita no ERP até `FINALIZADO`):** a montagem (L1–L6) é 100% local. L8 escreve no
  `fin015`; L9/L10 no `fin052`. **L11 é read-only no ERP** e nunca baixa, processa ou carrega nada
  (I11a).
- **I8 (janela da data de débito — ADR-0049, 2026-09-22):**
  - **I8a (janela):** `dataDebito ∈ [hoje_BRT, min(vencimento dos itens)] ∩ diasUteisBancarios`.
    `hoje_BRT` = data civil em `America/Sao_Paulo` (nunca meia-noite UTC). O limite superior é o do
    ERP (R2, comparado com o `itsDtaPgto` que o import grava); o inferior é o R1. Data fora da janela é
    **bloqueada**, não corrigida: nenhum título é removido automaticamente — para uma data posterior, a
    analista reabre o lote (L4) e retira o título que define o limite. Janela vazia (título vencido, ou
    nenhum dia útil entre hoje e o menor vencimento) = remessa impossível até o lote ser editado.
  - **I8b (congelamento):** uma vez criado o lote nativo no `fin015` com uma `dataDebito`, ela **não
    muda** — retry e retomada (ADR-0039) reutilizam o valor persistido, nunca o recalculam. Ela é parte
    da assinatura da marca d'água que reconhece o lote órfão. Só volta a ser escolhível se aquele lote
    nativo deixar de existir (cancelado no ERP e confirmado pela analista via `LoteAnteriorCanceladoError`).
  - Ver `business-rules/data-debito-remessa-sispag.md`.

- **I10 (destino de pagamento TED/PIX — ADR-0054, revisada pela ADR-0061, 2026-10-05):** todo item
  TED/PIX tem destino resolvível antes de qualquer escrita (I10a); a tela oferece com a mesma
  função que o envio usa (I10b); TED em qualquer banco (I10c); PIX só com chave (I10d); **cadastro
  primeiro, exceção `APROVADA` como fallback** (I10, I12c); o destino congela depois do import no
  `fin015` (I10f); trilha (I10g); mascaramento (I10h); titularidade bloqueante (I10i); chave PIX do
  cadastro CPF/CNPJ do favorecido tem preferência (I10k). Exceção: dupla validação, permissão
  única `sispag:excecao` (I12). No lote a analista só vê a origem. Ver
  `business-rules/destino-pagamento-sispag.md` e `business-rules/excecao-destino-sispag.md`.
  *(I9 foi proposto e retirado na ADR-0050; o número não é reaproveitado.)*

- **I11 (sincronização pelo título — ADR-0055, 2026-09-29):** pagamento do item = título pago no
  `fin064`, de qualquer origem (I11b); o `fin052` só enriquece e veta por rejeição lida; falha de
  leitura não decide (I11c); precedência de evento por item (I11d); `BAIXADO` terminal, com
  divergência (I11f); escritas locais sem gate de ERP (I11g); sem mudança, sem `versao` (I11h). Ver
  `business-rules/sincronizacao-status-lote-sispag.md`.

## Cardinalidade

Um `LotePagamento` agrega **N** `ItemLote` (1 filial, I4). Um `TituloAPagar` elegível pode estar em
**no máximo 1** lote `RASCUNHO` (I3), mas pode reaparecer num novo lote se o anterior for
`CANCELADO`, ou esteja em qualquer estado não-`RASCUNHO` (I3 só vale entre `RASCUNHO`s).

## Retorno e baixa (ADR-0019 → ADR-0039 → ADR-0055)

`RETORNADO` nasceu (ADR-0019) como simulação manual (`marcarRetorno`, L7). A Fatia 3 (2026-08-25)
trouxe o retorno real (`fin052`) e `BAIXADO`. A ADR-0055 (2026-09-29) muda a **prova**: o lote segue
a baixa dos **títulos** no ERP, de qualquer origem, e L7 foi aposentada (rota `410`). Ver
`state-machines/lote-pagamento.md` e `business-rules/sincronizacao-status-lote-sispag.md`.

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

## Fora de escopo

- Transporte ao banco (pasta de rede → VAN Nexxera): externo e manual, não observado.
- Baixar, processar ou carregar retorno **a partir da sincronização** (I11a).
- Reabrir lote `BAIXADO` por estorno (vira divergência, I11f).
