---
name: lote-pagamento
type: state-machine
entity: LotePagamento
ontology_version: "0.31.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0023_lote_pagamento.sql
  - src/backend/migrations/0026_lote_automatico.sql
  - src/backend/migrations/0027_lote_retornado.sql
  - src/backend/migrations/0031_sispag_modalidade.sql
  - src/backend/migrations/0049_sispag_remessa_retorno.sql
  - src/backend/migrations/0050_conciliacao_execucao.sql
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/ConciliacaoRetornoService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/client/ConexosSispagRetornoClient.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/client/ConexosTitulosClient.ts
  - src/backend/domain/service/sispag/SincronizacaoLoteService.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
  - src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts
  - src/backend/jobs/formar-lotes.ts
  - src/backend/jobs/reaper-sispag-reconciling.ts
  - src/backend/jobs/sincronizar-lotes-sispag.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-09-29
states: [RASCUNHO, FINALIZADO, REMESSA_GERADA, RETORNADO, BAIXADO, CANCELADO]
out_of_scope_states: [ENVIADO, PROCESSANDO]
---

# Ciclo de vida — `LotePagamento` (lote de pagamento SISPAG)

> **Vigência:** 2026-07-07 (v0.5.0, ADR-0015 — Fatias 1+2: montagem e gate, estado 100% local);
> 2026-07-08 (v0.8.0, ADR-0018 — formação automática e L6 desfazer-vencidos); 2026-07-08 (v0.9.0,
> ADR-0019 — `RETORNADO` + L7 `marcarRetorno` manual); **2026-08-25 (Fatia 3 — REMESSA e
> CONCILIAÇÃO, migrations `0049`/`0050`): novos estados `REMESSA_GERADA` e `BAIXADO`, novas
> transições L8 `gerarRemessa` e L9/L10 `conciliarRetorno`; ADR-0039 — a retomada de uma execução
> órfã consulta o estado no ERP em vez de exigir conserto manual no `fin015`.**
> **2026-09-29 (ADR-0055) — o status do lote passa a seguir a baixa do título.** Nova transição L11
> `sincronizarStatus` (read-only no ERP); o fechamento de L9/L10/L11 é uma **única** função
> (`business-rules/sincronizacao-status-lote-sispag.md`, I11); L7 `marcarRetorno` **aposentada**.
>
> **O que mudou de essencial na Fatia 3:** até a v0.9 esta máquina era **puramente local** — o
> invariante I1 dizia que ela **não tocava o ERP**. Isso acabou. De `FINALIZADO` em diante cada
> transição corresponde a uma **escrita no Conexos** (`fin015` na remessa, `fin052`→`fin010` na
> conciliação), nenhuma delas idempotente. Por isso as transições novas não são só `UPDATE ... SET
> status`: cada uma tem **ledger write-ahead** próprio (`remessa_execucao`, `conciliacao_execucao`)
> e um caminho de retomada. Ver `business-rules/retomada-remessa-sispag.md`.

## Estados (constantes tipadas)

Fonte: `LOTE_STATUS` em `src/backend/domain/interface/sispag/SispagInterface.ts`; CHECK em
`0049_sispag_remessa_retorno.sql`.

| Constante (TS) | Valor | Significado |
|----------------|-------|-------------|
| `RASCUNHO` | `RASCUNHO` | Lote em montagem — a analista inclui/remove títulos, define a forma de pagamento de cada item e a conta pagadora. Aberto para edição. Estado inicial. |
| `FINALIZADO` | `FINALIZADO` | A analista finalizou o lote (gate). Registra `finalizadoPor`/`finalizadoEm`. **Reversível** por `reabrirLote` (L4) — e só aqui: depois da remessa não há volta local. É o **único** estado do qual `gerarRemessa` (L8) parte. |
| `REMESSA_GERADA` | `REMESSA_GERADA` | O `.REM` (CNAB 240) existe no Conexos: o lote nativo do `fin015` foi criado, os títulos importados, o lote nativo finalizado e o arquivo gerado. Guarda `native_fil_cod`/`native_bnc_cod`/`native_flp_cod`, `native_gab_cod`, `remessa_arquivo`, `remessa_num`, `remessa_gerada_em`. **Não é "enviado"** — ver nota abaixo. |
| `RETORNADO` | `RETORNADO` | Algum item tem **rejeição lida** no `fin052` (`fbeVldTpret = 2`). **Exige tratamento humano** (sanear cadastro e reenviar). Item sem baixa e varredura incompleta **não** levam mais a `RETORNADO` (ADR-0055): o lote espera em `REMESSA_GERADA`. Re-sincronizável (L9/L10/L11 partem dele). |
| `BAIXADO` | `BAIXADO` | **Todo** item tem o título pago no `fin064` (`vldPago = 1` e `aberto = 0`), **qualquer que seja a origem da baixa** (remessa, `fin010` manual, processamento nativo do `fin052`), e nenhum item tem rejeição lida. **Terminal**: estorno posterior não reabre, vira divergência no item (I11f). |
| `CANCELADO` | `CANCELADO` | Lote descartado pela analista **antes da remessa**. Libera os títulos (deixam de ocupar a chave UNIQUE de I3). **Terminal.** |

Tipo: `LotePagamentoStatus = 'RASCUNHO' | 'FINALIZADO' | 'REMESSA_GERADA' | 'RETORNADO' | 'BAIXADO' | 'CANCELADO'`
(constantes tipadas via `LOTE_STATUS` — nunca strings cruas; princípio P3 da ontologia).

> **Por que `REMESSA_GERADA` e não `ENVIADO`.** O Conexos **não transmite** remessa de pagamento.
> Gerar o arquivo não é enviá-lo: o transporte até o banco (pasta de rede → VAN Nexxera) é
> **externo e manual**, e o sistema não observa esse passo. Nomear o estado de `ENVIADO` afirmaria
> algo que não sabemos. Na tela de arquitetura esse trecho aparece explicitamente como `lacuna`
> (`macro-sispag-transporte` → `macro-sispag-retorno`, `tipo: 'gap'`).
>
> **`PROCESSANDO`** continua fora de escopo pelo mesmo motivo: modelaria o tempo dentro do banco,
> que não é observável daqui.

## Transições

Cada transição é uma **ação nomeada** com regra explícita e registro de vigência. Toda transição
grava ator + timestamp (auditoria, I5) e é feita sob **optimistic lock** por `versao` (I6) —
`transicionarStatus({ id, de[], para, versaoEsperada })`, que distingue conflito de versão
(`LoteVersaoConflitoError`) de estado incompatível (`LoteEstadoInvalidoError`).

| # | De → Para | Ação (gatilho) | Regra | Vigência |
|---|-----------|----------------|-------|----------|
| L1 | `(novo) → RASCUNHO` | `criarLoteCandidato` (manual) / `formarLotesAutomaticos` (cron) | Abre um lote **RASCUNHO** para **uma** filial (`filCod`). Manual: analista abre vazio (`automatico=false`). Cron: cria já preenchido (`automatico=true`) agrupando títulos a-vencer ≤7d por **filial** (I4), para revisão (internacional fora do escopo — ADR-0021). Ver `actions/sispag/gerenciar-lote-candidato.md` e `actions/sispag/formar-lotes-automaticos.md`. | 2026-07-08 |
| L2 | `RASCUNHO → RASCUNHO` | `incluirTitulo` / `removerTitulo` / `atualizarModalidadeItem` (A2) / `atualizarContaPagadora` (A3) | Item só entra se **aprovado + não pago** (I2, `elegibilidade-titulo-lote`), da **mesma filial** (I4, `lote-uma-filial`) e **não em outro RASCUNHO** (I3, `nao-duplicacao-titulo-lote`). Modalidade e conta pagadora do item **só** mudam em RASCUNHO. O destino **não** é editado no item (ADR-0061): vem do cadastro ou de uma `ExcecaoDestino` aprovada (I10, I12) e congela depois do import no lote nativo (I10f). Auto-transição (edição do agregado). | 2026-07-07; destino manual em 2026-09-28 |
| L3 | `RASCUNHO → FINALIZADO` | `finalizarLote` **(GATE)** | O lote tem **≥1 item** e **todo item tem forma de pagamento definida** (A2 — `ModalidadePendenteError` se houver pendente) e **todo item TED/PIX tem destino resolvível** (I10a/I12f — cadastro primeiro, ou exceção `APROVADA`). Registra `finalizadoPor`/`finalizadoEm`. Ver `actions/sispag/finalizar-lote.md`. | 2026-07-07; revisão obrigatória de modalidade em 2026-07-18 (migration `0031`); destino TED/PIX em 2026-09-28 (ADR-0054); revisado em 2026-10-05 (ADR-0061) |
| L4 | `FINALIZADO → RASCUNHO` | `reabrirLote` | Reversão do gate. **Só a partir de FINALIZADO** — uma vez gerada a remessa não há reabertura local (o `.REM` já existe no ERP; desfazer é decisão humana no `fin015`). | 2026-07-07 |
| L5 | `{RASCUNHO, FINALIZADO} → CANCELADO` | `cancelarLote` | Descarta o lote candidato (decisão da analista). Libera os títulos (saem da UNIQUE de I3). **Terminal.** **Não alcança `REMESSA_GERADA`/`RETORNADO`/`BAIXADO`**: cancelar depois da remessa exigiria desfazer o lote nativo e o arquivo, e isso não é uma transição nossa. | 2026-07-07 |
| L6 | `RASCUNHO → (deletado)` | `formarLotesAutomaticos` (desfazer-vencidos) | **Só lote `automatico=true` em RASCUNHO.** Um auto-lote que passou a conter **≥1 título VENCIDO** é **DESFEITO (deletado)** e seus títulos liberados (`desfazerAutomaticosVencidos`). **Distinto de `CANCELADO`.** Nunca atinge lote **manual** nem estados posteriores. Ver ADR-0018. | 2026-07-08 |
| ~~L7~~ | ~~`FINALIZADO → RETORNADO`~~ | ~~`marcarRetorno`~~ **APOSENTADA** | Botão removido do `LoteCard`; `POST /sispag/lotes/:id/retorno` responde **410 Gone**. Nenhum lote em `RETORNADO` em produção (2026-09-29), então sem limpeza de dados. O número L7 não é reaproveitado. | 2026-07-08; aposentada em 2026-09-29 (ADR-0055) |
| L8 | `FINALIZADO → REMESSA_GERADA` | `gerarRemessa` (`RemessaService`) | **Primeira escrita no ERP.** Dirige o lote nativo do `fin015` na ordem `criarLote → importarTitulos → finalizarLote → gerarRemessa`, e persiste as chaves nativas. Serializada por **advisory lock por lote** + ledger `remessa_execucao` (write-ahead). Gated por `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` — dry-run monta e loga o payload sem POST, e **não** transiciona. Ver `business-rules/retomada-remessa-sispag.md` e ADR-0039. **Desde 2026-09-22 (ADR-0049) recebe a `dataDebito`** escolhida pela analista (default hoje BRT), validada contra I8a **antes** de qualquer escrita e persistida no write-ahead; com lote nativo já existente, a data é a persistida (I8b) e não se aceita outra. Ver `business-rules/data-debito-remessa-sispag.md`. | 2026-08-25; data de débito escolhível em 2026-09-22 |
| L9 | `{REMESSA_GERADA, RETORNADO} → BAIXADO` | `conciliarRetorno` (`ConciliacaoRetornoService`, admin, `processar=true`) | **Escreve no ERP** (`processar` do `fin052`) e em seguida aplica o **mesmo fechamento de L11** (I11). Mantida como caminho administrativo. | 2026-08-25; fechamento por I11 em 2026-09-29 |
| L10 | `{REMESSA_GERADA, RETORNADO} → RETORNADO` | `conciliarRetorno` (`ConciliacaoRetornoService`, admin) | Idem L9, destino `RETORNADO` quando há rejeição lida. | 2026-08-25; fechamento por I11 em 2026-09-29 |
| L11 | `{REMESSA_GERADA, RETORNADO} → BAIXADO \| RETORNADO \| (mesmo)` | `sincronizarStatus` (cron agendado + "Sincronizar agora") | **Read-only no ERP**: nunca chama `carregar`/`processar`. Lê o título no `fin064` por `docCod`, os eventos do `fin052` e, se legível, as baixas do título (`com308`, PSQ_018); deriva a `situacao` de cada item e decide o destino pelo quadro abaixo. Falha de leitura **não decide** (I11c). Sem mudança observada, **não** incrementa `versao` (I11h). Escritas locais **não** passam por `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` (I11g). | 2026-09-29 (ADR-0055) |

```
          L1  criarLoteCandidato (manual) / formarLotesAutomaticos (cron)
                              │
                              ▼
                        ┌───────────┐      L6 desfazer-vencidos (só auto-lote
     L2 editar ────────▶│  RASCUNHO │─────▶ com título vencido) → linha DELETADA
     (incluir/remover   └───────────┘
      título, A2        │        ▲
      modalidade,       │        │  L4 reabrirLote
      A3 conta)      L3 │        │
        finalizarLote   ▼        │
                     ┌──────────────┐
                     │  FINALIZADO  │
                     └──────────────┘
                        │
      L8 gerarRemessa   │   (L7 marcarRetorno: APOSENTADA em 2026-09-29)
      (fin015 + ledger) │
                        ▼
                ┌────────────────┐
                │ REMESSA_GERADA │◀─┐  permanece enquanto há item sem baixa
                └────────────────┘──┘  (AGENDADO / SEM_RETORNO)
                        │
   ┄┄ transporte ao banco (pasta de rede → VAN Nexxera): EXTERNO
      e MANUAL. O Conexos NÃO transmite → não existe estado ENVIADO
                        │
      L11 sincronizarStatus (read-only)  ·  L9/L10 conciliarRetorno (admin, processa)
      mesmo fechamento I11
                  ┌─────┴─────┐
   todo título    │           │  rejeição LIDA no fin052
   pago (fin064), │           │  (fbeVldTpret = 2)
   sem rejeição   ▼           ▼
            ┌───────────┐   ┌───────────────┐
            │  BAIXADO  │◀──│   RETORNADO   │──┐  RETORNADO → RETORNADO
            │ (terminal)│   │ (exige olho   │◀─┘  (nova sincronização)
            └───────────┘   │    humano)    │
                            └───────────────┘

   L5 cancelarLote: {RASCUNHO, FINALIZADO} → CANCELADO (terminal).
      NÃO alcança REMESSA_GERADA / RETORNADO / BAIXADO — depois da remessa,
      desfazer é decisão humana no fin015, não transição nossa.
```

> **L7 aposentada (ADR-0055, 2026-09-29).** Era um beco sem saída: levava o lote a `RETORNADO` sem
> `.REM`, sem chave nativa e sem baixa, e dali nenhuma transição o tirava. O botão saiu e a rota
> responde `410`. O retorno real chega por L11 (e, administrativamente, por L9/L10).

## Quando o lote FECHA (L9 / L10 / L11 — uma só função, I11)

A decisão é por **item** primeiro, depois por lote. Situação do item (derivada; precedência de cima
para baixo, I11d):

| Evidência lida | `situacao` do item |
|---|---|
| Algum evento do `fin052` com `fbeVldTpret = 2` para o item | `REJEITADO` |
| Título no `fin064` com `vldPago = 1` **e** `aberto = 0` | `PAGO` |
| Evento `BD` (agendado) ou `00` (efetuado) no `fin052`, título ainda não pago | `AGENDADO` |
| Nenhuma das anteriores | `SEM_RETORNO` |

| Situação dos itens | Destino do lote |
|---|---|
| Algum `REJEITADO` | `RETORNADO` |
| **Todos** `PAGO` | `BAIXADO` |
| Qualquer outra combinação | **permanece** onde está (`REMESSA_GERADA`, ou `RETORNADO` se já estava) |
| Leitura do `fin064` de algum item falhou | **permanece** (I11c); o item guarda a última situação observada |

Item `REJEITADO` cujo título aparece pago (pago à mão fora da remessa) **continua `REJEITADO`** e o
lote fica em `RETORNADO`; o item é marcado com `divergencia` e gera `Alerta`
`sispag-baixa-divergente` (decisão do usuário, 2026-09-29; ADR-0055 D5).

**O que mudou (ADR-0055).** Antes, o lote só fechava com `bxa_cod_seq` copiado da linha de detalhe
do `fin052` **e** varredura completa de eventos; qualquer lacuna o mandava para `RETORNADO`. Em
produção isso nunca fechou nada: o retorno de 24/09 foi processado nativamente só com o evento
`BD`, e a baixa foi feita à mão no `fin010` horas depois. Agora a evidência de pagamento é o
**título**, não o arquivo. A varredura incompleta do `fin052` perde o poder de bloquear `BAIXADO`
**quando a baixa está confirmada no título**: o dinheiro saiu, qualquer que tenha sido o caminho.
Ela continua sem poder afirmar *ausência* de rejeição; por isso só a rejeição **lida** veta, e o que
não foi lido não produz `REJEITADO` nem `PAGO`.

`00` sem baixa no título é `AGENDADO`, não `PAGO`: o banco confirmou, o ERP ainda não baixou, e a
ontologia não afirma pagamento que o ERP não registra.

**A transição acontece na MESMA transação de banco** que grava a situação dos itens (herdado de
L9/L10). Sem isso, uma queda no meio do laço deixaria itens atualizados e o lote no estado anterior.

## Auto-lotes: criados e desfeitos pelo cron (ADR-0018)

A propriedade `automatico` particiona quem move o lote:

- **Lote automático** (`automatico=true`, criado por `formarLotesAutomaticos`): nasce **RASCUNHO** já
  preenchido e é **efêmero/re-formável** — a cada rodada o cron **desfaz** (L6, deleta) os auto-lotes
  RASCUNHO que contêm título vencido e **re-forma** a partir do pool a-vencer. A analista ainda o
  edita (L2), finaliza (L3), reabre (L4) ou cancela (L5) normalmente enquanto RASCUNHO — se ela
  finalizar, ele deixa de ser candidato do cron (só RASCUNHO auto é desfeito).
- **Lote manual** (`automatico=false`, criado por `criarLoteCandidato`): o cron **nunca** o toca — nem
  cria, nem desfaz. Só a analista o move.

**`DESFAZER` (L6) ≠ `CANCELADO` (L5):** `CANCELADO` é um **estado terminal** que a analista escolhe e
que fica registrado (auditoria). `DESFAZER` é o cron **deletando** a linha de um auto-lote efêmero cujo
título venceu — não é um estado, é a ausência do lote (será re-formado se ainda houver elegíveis). Não
se criou um status `VENCIDO`: modelar o vencimento como estado do lote seria modelar antes da hora — o
auto-lote é derivável a cada rodada.

## O estado que NÃO está nesta máquina: a execução em voo

De L8 em diante existe um segundo eixo de estado, que **não** é o `status` do lote: o do **ledger**
(`remessa_execucao.status` / `conciliacao_execucao.status` ∈ `pending | reconciling | settled | error`).
Ele responde uma pergunta diferente — *"a escrita no ERP valeu?"* — e é escrito **antes** do POST/PUT.

Isso importa aqui por uma razão: **um lote pode estar em `FINALIZADO` com uma remessa em voo.** O
`status` sozinho não diz se é seguro tentar de novo; quem diz é o ledger + o estado consultado no
ERP. As duas doutrinas convivem:

- **Onde o ERP expõe estado verificável** daquela escrita — `flpVldStatus` + `titulosCount` +
  `finItemSispag/list` no `fin015`, `processadoEm` no `fin052` — a retomada **consulta** e pula só o
  que já está lá (ADR-0039).
- **Onde não expõe**, continua **fail-closed**: `RemessaEmDuvidaError` / `ConciliacaoEmDuvidaError`,
  e olho humano. Falha de leitura **nunca** é tratada como ausência.

Ledger e máquina de estados são ortogonais de propósito: transicionar o lote sem o ledger duplicaria
pagamento; o ledger sem a máquina não diria à analista onde o lote está. Trilha visível em
`GET /sispag/execucoes` e no job `reaper-sispag-reconciling`.

## Decisões de modelagem (ADR-0015, ADR-0018, ADR-0019, ADR-0039, ADR-0055)

- **Reversibilidade acabou onde nasceu o downstream.** A v0.5 registrou que `finalizarLote` era
  reversível *"porque não há downstream nesta fatia"* e que isso ficaria gated quando o transporte
  chegasse. Chegou: `reabrirLote` (L4) e `cancelarLote` (L5) param em `FINALIZADO`. De
  `REMESSA_GERADA` em diante o artefato existe no ERP e desfazê-lo é decisão humana, não transição.
- **`BAIXADO` é terminal e conservador.** Fecha só com evidência positiva de pagamento no **título**
  (`fin064`) para **todos** os itens. Estorno posterior não reabre: vira `divergencia` no item e
  `Alerta` (ADR-0055, I11f). Lote com rejeição fica em `RETORNADO` de propósito: exige sanear
  cadastro e reenviar, e não é uma conciliação concluída.
- **Não se criou um estado para "parcialmente pago".** Um lote com rejeição *é* `RETORNADO`; qual
  item caiu está no item (`rejeitado`, `retorno_evento`, `retorno_descricao`), não no lote. Promover
  isso a estado do agregado duplicaria informação que já é derivável. Reafirmado na ADR-0055:
  "agendado no banco, aguardando baixa" também é situação do item, não estado do lote.
- **Agrupamento por filial (I4)** segue valendo, agora com força de invariante de conciliação: o
  parser do `.RET` exige filial do título = filial do lote, e item cross-filial **nunca** concilia
  (provado em HML, lote 26). O que era compatibilidade com o `fin015` virou requisito duro.
- **Chave nativa é composta, sempre.** O ERP **recicla** `flpCod` de lotes que deixaram de existir;
  o número sozinho não identifica nada de forma estável. A busca do lote local pelo retorno é por
  `(native_fil_cod, native_bnc_cod, native_flp_cod)`. A filial da chave é a **da linha do `.RET`**,
  não a do arquivo: um mesmo arquivo de retorno mistura filiais (gar 9: fil 1/flp 8 e fil 2/flp 24,
  ADR-0055).

## Relação com o painel e o ERP

O invariante I1 da v0.5 (*"esta máquina é puramente local, não toca o ERP"*) **vale apenas até
`FINALIZADO`**. A montagem (L1–L6) continua 100% local: nenhuma escrita no Conexos, e o painel
(`montarPainelPagamentos`) mostra os lotes nativos apenas como **contexto**.

De L8 em diante a máquina **dirige** o lote nativo do `fin015` e **observa** o resultado no ERP.
O que ela guarda que o ERP não guarda é o elo **lote → item → título**; o elo **título → borderô →
baixa** o ERP guarda, e é legível por título no `com308` (PSQ_018, `listBaixasTitulo`) quando o
usuário tem permissão. Medido em 2026-08-20: `borCod` nulo no `finItemSispag` e
`vldHasRemessaPgto = 0` mesmo em baixa de remessa, então o `fin015` não serve de ponte, mas o
título serve. Em 2026-09-24 a baixa do 38682/1 (borderô 22320) não passou por retorno nenhum: o
`fin052` não teria o vínculo para copiar. Por isso `borCod`/`bxaCodSeq` no item são
**enriquecimento** com fonte registrada (`baixaFonte`), nunca a prova de pagamento.
