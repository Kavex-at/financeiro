# SISPAG fin015 — perna de IDA PROVADA ponta-a-ponta em HML (2026-08-20)

> Fecha o gap aberto desde 2026-07-11 em [`sispag-fin015-write-tools.md`](./sispag-fin015-write-tools.md)
> §"O que falta" item 4 ("fechar o `importar` com dado real"). O ciclo
> `criarLote → importar → finalizar → gerarRemessa → download` rodou inteiro ao vivo em
> `columbiatrading-hml.conexos.cloud` e produziu um CNAB 240 válido.
>
> **Artefato:** lote `flp 26` (fil 1, bnc 4/Itaú) → `PG200893.REM`, `gabCod 46`, 1210 chars,
> 5 registros de 240 posições. Salvo em `/tmp/claude-1000/fin015-remessa/`.

## 1. O `importarTitulos` — shape correto (era o único elo não provado)

O endpoint **não recebe um `FinItemSispag` inteiro**: projeta um DTO de **seleção**. Quatro campos
precisam ir **ao mesmo tempo no nível da requisição E dentro de cada item**:

| campo | valor | observação |
|---|---|---|
| `op` | `1` | operação da seleção |
| `bncCodFin015` | banco do **LOTE** | ≠ `bncCod` do item |
| `titVldReflexoDdaAssoc` | `0` | reflexo DDA associar |
| `titVldReflexoDdaDesassoc` | `0` | reflexo DDA desassociar |

Presentes em só um dos dois lados → `400 SELECTION_ERROR` listando-os como vazios (o eco do erro
mostra o DTO projetado — 15 campos — e é a melhor documentação que existe deste endpoint).

**Corrigido em** `ConexosSispagWriteClient.importarTitulos` (o client mandava só `{ items }`).

### 1.1 Identidade do item — `filCod` ≠ `filCodLote`
`filCod` é a filial do **TÍTULO**; `filCodLote`, a do **LOTE**. O `titulosPendentes/list` devolve
títulos de **mais de uma filial**. Forçar as duas iguais → `400 VALIDATION: Not Found: FinTituloPag
(docTip, titCod, docCod, filCod)`. A chave tem que ir **verbatim** do grid de pendentes.

### 1.2 Protocolo de PERGUNTA do ERP (não tratado)
Quando o favorecido não tem conta ativa no banco do lote, o ERP responde **400 com uma pergunta**:
```json
{"type":"QUESTION","questions":[{"key":"FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO",
  "parameterValueList":{"bncDesNome":"ITAÚ","pesCod":"14"},
  "answerList":[{"id":"YES","type":"SIMPLE"},{"id":"ABORT","key":"NO","type":"ABORT"}]}]}
```
Hoje isso vira `ConexosError`. O serviço de orquestração precisa **decidir e responder** (o `YES`
altera a modalidade do título). **Gap para a analista:** responder `YES` automaticamente é aceitável,
ou exige decisão humana? Ver §5.

## 2. Onde mora o DESTINO de pagamento — NÃO é o `fin064`

Sondagem read-only (`jobs/probe-fin064-destino.ts`) mediu **0% de preenchimento**:

| ambiente | títulos amostrados | com conta | com barras | com PIX | com modalidade |
|---|---|---|---|---|---|
| HML (fil 1,2,4,6) | 561 | 0 | 0 | 0 | 0 |
| **PRD** (fil 1,2,4,6) | **2000** | **0** | **0** | **0** | **0** |

Os campos `pct*`/`its*` do `fin064` são um **LEFT JOIN no item SISPAG** — só populam **depois** que o
título entra num lote. A conta do favorecido mora em **`CmnPessoasCtcorr`** (`cmn025/ctcorr/list`,
filtro `pesCod#EQ`), com `pctCodSeq`, `pctNumBanco`, `pctEspNumAgencia`, `pctEspNumContaBanc`,
`pctVldDefault`, `pctVldStatus`. **`pctCodSeq` é o que o `FinItemSispag` referencia.**

Confirmado: `pesCod 1507` em HML → `pctCodSeq=1, banco=341, ag=292, cc=46030-0` — idêntico ao destino
do item real lido no lote `flp 2`.

> **Cobertura parcial é a regra:** em PRD, 1 de 5 favorecidos amostrados tinha conta cadastrada. Título
> cujo favorecido não tem conta **não vai por TED/crédito** — precisa boleto, PIX ou saneamento de cadastro.
> Isso é operação, não bug, e o painel precisa mostrar.

### 2.1 Bug corrigido: `modalidadesDisponiveis` era SEMPRE vazio
`ConexosSispagClient.mapTitulo` derivava TED/CRÉDITO de `pctNumBanco && pctEspNumContaBanc` do `fin064`
— sempre nulos. Logo `GET /sispag/lotes/:id/modalidades-disponiveis` devolvia `[]` para todo item,
em produção, desde sempre. Corrigido: `listContasFavorecido` (novo, `cmn025/ctcorr`) e
`SispagPainelService.modalidadesDisponiveisDoLote` passou a combinar as duas fontes.

## 3. A regra que trava o `finalizarLote` — é o ITEM, não o título

A mensagem *"ESTE REGISTRO NÃO PODE SER FINALIZADO. EXISTEM TÍTULOS QUE IRÃO VENCER ANTES DA DATA DE
PAGAMENTO DESTE LOTE"* **não** compara o vencimento do título com a data de débito. Compara:

```
itsDtaPgto (do ITEM)  >=  flpDtaCredito (do LOTE)
```

E **`itsDtaPgto` é um SNAPSHOT gravado no import**. Se o vencimento do título mudar depois, o item fica
defasado e o lote trava — sem que nada no título indique o problema. `PUT fin015/finItemSispag`
reedita o item.

**Consequência de negócio (importante):** com R1 (`flpDtaCredito >= hoje`) e esta regra juntas, um
título **já vencido não entra em lote fin015**. Isso explica estruturalmente o achado de
[`sispag-native-vs-nexxera.md`](./sispag-native-vs-nexxera.md) §2.6 Q1: **>99% das baixas a-pagar são
diretas** — o caminho SISPAG simplesmente **não aceita atrasado**.

> **Gap para a analista:** como a Columbia paga título vencido hoje? Se é baixa direta no `fin010`,
> o SISPAG só cobre a fatia a-vencer, e o painel precisa dizer isso em vez de sugerir lote para
> título vencido (que é a maioria da carteira).

## 4. `gerarRemessa` reportava sucesso como falha

O parser marcava `sucesso` só quando `valid === 'SUCESSO'`. Na geração provada o corpo veio **sem esse
campo** e a remessa **foi gerada** → `{"sucesso": false}` num caso de sucesso. Falha de negócio no ERP
vem como **400** (`VALIDATION_LIST` → `ConexosError`), então **chegar ao parse já é o sucesso**.
Corrigido. Defesa em profundidade: o orquestrador confirma via `listarArquivosRemessa`.

## 5. Gaps abertos para a analista
1. **`QUESTION` do ERP** (§1.2) — responder `YES` automático ou exigir humano?
2. **Título vencido** (§3) — o SISPAG cobre só o a-vencer? Como é o caminho do atrasado hoje?
3. **Favorecido sem conta** (§2) — sanear cadastro, ou rotear para boleto/PIX?
4. **Roteamento de conta pagadora** — Itaú é default empírico; quando Santander?

## 6. Harnesses (todos com guard anti-PRD; nenhum roda sozinho)
| job | o que faz | escreve? |
|---|---|---|
| `probe-fin015-import.ts` | lê itens de um lote populado e faz o diff com o grid de pendentes | não |
| `probe-fin064-destino.ts` | mede cobertura de destino no `fin064` + contas em `cmn025` | não |
| `validate-fin015-import.ts` | `criarLote` → destino → `validacao` → `importar` | HML, opt-in |
| `validate-fin015-remessa.ts` | `finalizar` → `gerarRemessa` → baixa e imprime o CNAB | HML, opt-in |
| `seed-hml-vencimento.ts` | empurra vencimento via `fin026` (backup + `REVERTER=1`) | HML, opt-in |
| `cleanup-fin015-testes.ts` | cancela lotes de teste | HML, opt-in |

### Estado deixado em HML
- **flp 26** — FINALIZADO com `PG200893.REM` gerado (a evidência).
- **flp 22–25, 27** — rascunhos. `cancelarLote` **só aceita lote finalizado** e a API **não tem DELETE
  para rascunho** — logo rascunho de teste é resíduo permanente. Levar em conta ao testar em PRD.
- **Vencimentos alterados** (docs 813 e 820, filial 2 → 2026-10-04). Backups em disco; `REVERTER=1` desfaz.

## 7. O que a Fatia 3 ainda precisa
`RemessaService` de orquestração: gating `conexosWriteEnabled`/`conexosDryRun`, ledger write-ahead
idempotente, auditoria, mapeamento `lote_pagamento` ↔ chaves nativas (`native_flp_cod`/`native_gab_cod`,
migration), tratamento do `QUESTION`, e a transição de status. As **ferramentas** estão prontas e
provadas — falta o fluxo.
