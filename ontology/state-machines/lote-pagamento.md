---
name: lote-pagamento
type: state-machine
entity: LotePagamento
ontology_version: "0.19.1"
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
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
  - src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts
  - src/backend/jobs/formar-lotes.ts
  - src/backend/jobs/reaper-sispag-reconciling.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-08-25
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
| `RETORNADO` | `RETORNADO` | O `.RET` foi conciliado, mas o lote **não fechou**: houve rejeição, ou algum item não tem baixa, ou a varredura de eventos veio incompleta. **Exige tratamento humano** (sanear cadastro e reenviar). É re-conciliável (L9/L10 partem dele também). |
| `BAIXADO` | `BAIXADO` | Todo item não-rejeitado tem baixa confirmada no `fin010` (`bxa_cod_seq`), sem nenhuma rejeição e com varredura completa. **Terminal.** |
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
| L2 | `RASCUNHO → RASCUNHO` | `incluirTitulo` / `removerTitulo` / `atualizarModalidadeItem` (A2) / `atualizarContaPagadora` (A3) | Item só entra se **aprovado + não pago** (I2, `elegibilidade-titulo-lote`), da **mesma filial** (I4, `lote-uma-filial`) e **não em outro RASCUNHO** (I3, `nao-duplicacao-titulo-lote`). Modalidade e conta pagadora **só** mudam em RASCUNHO. Auto-transição (edição do agregado). | 2026-07-07 |
| L3 | `RASCUNHO → FINALIZADO` | `finalizarLote` **(GATE)** | O lote tem **≥1 item** e **todo item tem forma de pagamento definida** (A2 — `ModalidadePendenteError` se houver pendente). Registra `finalizadoPor`/`finalizadoEm`. Ver `actions/sispag/finalizar-lote.md`. | 2026-07-07; revisão obrigatória de modalidade em 2026-07-18 (migration `0031`) |
| L4 | `FINALIZADO → RASCUNHO` | `reabrirLote` | Reversão do gate. **Só a partir de FINALIZADO** — uma vez gerada a remessa não há reabertura local (o `.REM` já existe no ERP; desfazer é decisão humana no `fin015`). | 2026-07-07 |
| L5 | `{RASCUNHO, FINALIZADO} → CANCELADO` | `cancelarLote` | Descarta o lote candidato (decisão da analista). Libera os títulos (saem da UNIQUE de I3). **Terminal.** **Não alcança `REMESSA_GERADA`/`RETORNADO`/`BAIXADO`**: cancelar depois da remessa exigiria desfazer o lote nativo e o arquivo, e isso não é uma transição nossa. | 2026-07-07 |
| L6 | `RASCUNHO → (deletado)` | `formarLotesAutomaticos` (desfazer-vencidos) | **Só lote `automatico=true` em RASCUNHO.** Um auto-lote que passou a conter **≥1 título VENCIDO** é **DESFEITO (deletado)** e seus títulos liberados (`desfazerAutomaticosVencidos`). **Distinto de `CANCELADO`.** Nunca atinge lote **manual** nem estados posteriores. Ver ADR-0018. | 2026-07-08 |
| L7 | `FINALIZADO → RETORNADO` | `marcarRetorno` **(LEGADO — ver aviso)** | Marca manualmente "retorno do Nexxera recebido". Nasceu como **simulação** (ADR-0019), quando a conciliação real ainda não existia. Continua exposta (`POST /sispag/lotes/:id/retorno`, botão "Marcar retorno recebido" no `LoteCard`) e **pula `REMESSA_GERADA`** — nenhum arquivo, nenhuma baixa, nenhum vínculo com o `fin010`. | 2026-07-08 (obsoleta desde 2026-08-25) |
| L8 | `FINALIZADO → REMESSA_GERADA` | `gerarRemessa` (`RemessaService`) | **Primeira escrita no ERP.** Dirige o lote nativo do `fin015` na ordem `criarLote → importarTitulos → finalizarLote → gerarRemessa`, e persiste as chaves nativas. Serializada por **advisory lock por lote** + ledger `remessa_execucao` (write-ahead). Gated por `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` — dry-run monta e loga o payload sem POST, e **não** transiciona. Ver `business-rules/retomada-remessa-sispag.md` e ADR-0039. | 2026-08-25 |
| L9 | `{REMESSA_GERADA, RETORNADO} → BAIXADO` | `conciliarRetorno` (`ConciliacaoRetornoService`) | Fecha o lote **somente se**: todo item não-rejeitado tem `bxa_cod_seq`, **nenhum** item rejeitado e a **varredura de eventos foi completa**. Ver o quadro de fechamento abaixo. | 2026-08-25 |
| L10 | `{REMESSA_GERADA, RETORNADO} → RETORNADO` | `conciliarRetorno` (`ConciliacaoRetornoService`) | Mesma chamada de L9, destino diferente: qualquer rejeição, item sem baixa **ou varredura incompleta** para o lote em `RETORNADO`. `RETORNADO → RETORNADO` é legítimo — é a **segunda passada** depois de refazer uma varredura que falhou. | 2026-08-25 |

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
                        │        │
      L8 gerarRemessa   │        │  L7 marcarRetorno  ⚠ LEGADO — beco sem saída
      (fin015 + ledger) │        └───────────────────────────────────┐
                        ▼                                            │
                ┌────────────────┐                                   │
                │ REMESSA_GERADA │                                   │
                └────────────────┘                                   │
                        │                                            │
   ┄┄ transporte ao banco (pasta de rede → VAN Nexxera): EXTERNO ┄┄   │
      e MANUAL. O Conexos NÃO transmite → não existe estado ENVIADO   │
                        │                                            │
      L9 / L10  conciliarRetorno (fin052 → baixas no fin010)          │
                  ┌─────┴─────┐                                      │
   tudo baixado,  │           │  rejeição / item sem baixa /         │
   sem rejeição,  │           │  varredura INCOMPLETA                │
   varredura ok   ▼           ▼                                      ▼
            ┌───────────┐   ┌───────────────┐ ◀──────────────────────┘
            │  BAIXADO  │◀──│   RETORNADO   │──┐  L10: RETORNADO → RETORNADO
            │ (terminal)│L9 │ (exige olho   │◀─┘  é a 2ª passada (refazer a
            └───────────┘   │    humano)    │     varredura que falhou)
                            └───────────────┘

   L5 cancelarLote: {RASCUNHO, FINALIZADO} → CANCELADO (terminal).
      NÃO alcança REMESSA_GERADA / RETORNADO / BAIXADO — depois da remessa,
      desfazer é decisão humana no fin015, não transição nossa.
```

> ⚠️ **L7 é dívida viva, e é um beco sem saída.** O caminho correto hoje é
> `FINALIZADO → REMESSA_GERADA → RETORNADO/BAIXADO`. O botão "Marcar retorno recebido" ainda
> aparece na tela **ao lado** de "Gerar remessa (.REM)" — ambos condicionados a
> `status === FINALIZADO` em `LoteCard.tsx` — e leva o lote a `RETORNADO` **sem** que exista
> `.REM`, `borCod` ou `bxa_cod_seq`.
>
> O lote resultante *parece* conciliado e não tem rastreabilidade nenhuma. Pior: dali **não sai
> mais**. `gerarRemessa` (L8), `reabrirLote` (L4) e `cancelarLote` (L5) exigem todos `FINALIZADO`;
> e L9/L10 nunca o alcançam, porque sem remessa ele não tem chave nativa
> (`native_flp_cod` nulo) e `findByChaveNativa` jamais casa uma linha do `.RET` com ele. Um clique
> no botão errado tranca o lote em `RETORNADO` para sempre, e a única saída é SQL na mão.
>
> **Follow-up aberto:** remover a ação, ou restringi-la a ambiente de teste.

## Quando a conciliação FECHA o lote (L9 vs. L10)

`transicionarLote` decide o destino por três perguntas, nesta ordem:

| Condição observada | Destino |
|--------------------|---------|
| Todo item não-rejeitado tem `bxaCodSeq` **e** nenhum item rejeitado **e** varredura completa | `BAIXADO` |
| Algum item rejeitado (`fbeVldTpret = 2`) | `RETORNADO` |
| Algum item não-rejeitado **sem** `bxaCodSeq` | `RETORNADO` |
| **Varredura incompleta** (algum código de evento não pôde ser lido) | `RETORNADO` |

A quarta linha é a que não é óbvia e é a que custa dinheiro: o `fin052` exige o código do evento
**exato** como filtro (não aceita `#IN` nem `#LIKE`), então a leitura do detalhe é uma varredura
código a código. Se uma dessas leituras falha, **"não vi rejeição" não é "não houve rejeição"** — a
linha perdida pode ser justamente a da recusa do banco, e fechar o lote em `BAIXADO` reportaria
como pago um dinheiro que não saiu. Por isso o teto vira `RETORNADO` e o ledger fica em `error`
(não `settled`), para que a segunda passada seja permitida.

**A transição acontece na MESMA transação de banco** que grava o resultado dos itens
(`registrarConciliacaoItem`). Sem isso, uma queda no meio do laço deixava parte dos itens com baixa
gravada e o lote ainda em `REMESSA_GERADA` — um estado que nenhum código sabe ler.

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

## Decisões de modelagem (ADR-0015, ADR-0018, ADR-0019, ADR-0039)

- **Reversibilidade acabou onde nasceu o downstream.** A v0.5 registrou que `finalizarLote` era
  reversível *"porque não há downstream nesta fatia"* e que isso ficaria gated quando o transporte
  chegasse. Chegou: `reabrirLote` (L4) e `cancelarLote` (L5) param em `FINALIZADO`. De
  `REMESSA_GERADA` em diante o artefato existe no ERP e desfazê-lo é decisão humana, não transição.
- **`BAIXADO` é terminal e conservador.** Fecha só com evidência positiva de baixa (`bxa_cod_seq`)
  para **todos** os itens não-rejeitados. Lote com rejeição fica em `RETORNADO` de propósito: exige
  sanear cadastro e reenviar, e não é uma conciliação concluída.
- **Não se criou um estado para "parcialmente pago".** Um lote com rejeição *é* `RETORNADO`; qual
  item caiu está no item (`rejeitado`, `retorno_evento`, `retorno_descricao`), não no lote. Promover
  isso a estado do agregado duplicaria informação que já é derivável.
- **Agrupamento por filial (I4)** segue valendo, agora com força de invariante de conciliação: o
  parser do `.RET` exige filial do título = filial do lote, e item cross-filial **nunca** concilia
  (provado em HML, lote 26). O que era compatibilidade com o `fin015` virou requisito duro.
- **Chave nativa é composta, sempre.** O ERP **recicla** `flpCod` de lotes que deixaram de existir;
  o número sozinho não identifica nada de forma estável. A busca do lote local pelo retorno é por
  `(native_fil_cod, native_bnc_cod, native_flp_cod)`.

## Relação com o painel e o ERP

O invariante I1 da v0.5 (*"esta máquina é puramente local, não toca o ERP"*) **vale apenas até
`FINALIZADO`**. A montagem (L1–L6) continua 100% local: nenhuma escrita no Conexos, e o painel
(`montarPainelPagamentos`) mostra os lotes nativos apenas como **contexto**.

De L8 em diante a máquina passa a **dirigir** o lote nativo do `fin015` e a **absorver** o resultado
do `fin052`/`fin010`. Ela não *espelha* o estado do ERP — ela guarda o que o ERP não guarda: o elo
lote → borderô → baixa. Medido em produção (2026-08-20): nos lotes com retorno processado, todos os
itens têm `borCod` nulo no `finItemSispag`, e `vldHasRemessaPgto` do borderô vem 0 mesmo para baixa
originada de remessa. O vínculo só existe na linha de detalhe do retorno — e some se ninguém copiar.
