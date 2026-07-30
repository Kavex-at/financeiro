---
name: conexos-fin095-extrato
type: integration
system: Conexos ERP (Tesouraria — Extratos)
ontology_version: "0.12"
implementation_status: implemented
status: active
owners: [yuri]
direction: read
related_files:
  - src/backend/domain/client/ConexosExtratoClient.ts
  - src/backend/domain/service/recebimentos/IngestaoTransacoesService.ts
  - src/backend/domain/service/recebimentos/normalizarLancamento.ts
  - src/backend/jobs/ingest-extratos.ts
endpoints_read:
  - "fin133/list — contas financeiras da filial (gerNum, gerDes, saldos, qtde por lado)"
  - "fin095/list — lançamentos do extrato, filtrados por gerNum + tipo + janela de data"
related_decisions: ["0022", "0023"]
---

## O que esta integração faz

Fonte do **extrato bancário** da Frente IV (Módulo 1). READ-ONLY: a única escrita
da ingestão é o Postgres próprio (`transacao_bancaria`).

Substitui a aposta original de ler a Nexxera direto (ADR-0022 D4) — ver ADR-0023.

## A cadeia

```
fin133/list  {}                             → contas financeiras da filial
   └── gerNum 38 = "BANCO ITAÚ - AG. 0641 CONTA 55.795-4"
       (é a MESMA "Conta Financeira de Baixa" que o fin014 pedirá na Fase 5)

fin095/list  { gerNum, exiVldTipo, exiDtaLcto#GE, exiDtaLcto#LE }
   └── um lançamento por linha
```

Envelope de resposta: `{ count, pageNumber, summary, rows }` — o `paginate` do
`ConexosBaseClient` lê `.rows`.

## Campos do `fin095` que importam

| Campo wire | Vira | Nota |
|---|---|---|
| `extCod` + `exiCodSeq` | `naturalKey` | Identidade do lançamento no extrato |
| `exiDtaLcto` | `dataMovimento` | epoch ms; `parseDate` aplica o shift BR-noon (+15h) |
| `exiVldTipo` | `tipo` | **1 = DÉBITO · 2 = CRÉDITO** |
| `exiMnyLcto` / `exiMnyLctoCr` / `exiMnyLctoDeb` | `valor` | Sempre `abs`; o sinal vive em `tipo`. **Cr/Deb vêm `null` na maioria das linhas** |
| `exiEspHistorico` | `contraparte` (dica) | **Truncado em ~24 chars pelo banco.** Nunca é chave |
| `exiEspNrdocto` | `referenciaBancaria` | ex.: `"20260115128"` |
| `exiEspCategoria` / `…Desc` | `categoria` / `categoriaDesc` | Discriminador do ruído de tesouraria |
| `vldConciliado` | `normalized.conciliadoNoErp` | Conciliação do ERP ≠ a nossa (ADR-0023 D6) |
| `gerNum` (do parâmetro) | `gerNum` | A linha traz `null`; vem da consulta |

## Filtros obrigatórios (descobertos ao vivo)

O Conexos recusa a chamada com `400 VALIDATION` nomeando o filtro que falta:

| Tela | Filtro exigido |
|---|---|
| `fin095` (Extrato Banco) | `gerNum` |
| `fin091` (Extrato Sistema) | `gerNumCcorentes` + `fLcbDtaLctoI` |
| `fin134` (Importação de Extratos) | `vldStatus` |
| `fin135` (Conciliações Geradas) | `gerNum` |
| `fin133` / `fin143` | nenhum |

## Volume medido (produção, filial 1, 90 dias)

- Sem filtro, conta `gerNum 38`: **28.237** lançamentos
- Só crédito, histórico inteiro: **3.835**
- Só crédito, 90 dias, 7 contas com movimento: **1.759**

Por isso o default é `exiVldTipo=2` e a janela é fatiada em blocos de 30 dias: o
`paginate` trunca em `MAX_PAGES × PAGE_SIZE` = 25.000 e devolveria uma lista
incompleta **sem erro**. O `onCapHit` transforma isso em `ExtratoTruncadoError`.

## O que NÃO está aqui

- **`fin134`** lista os ARQUIVOS `.RET` importados, não os lançamentos. Serve para
  auditar a chegada do extrato; não é fonte de transação.
- **`fin143`** ("Importação Nexxera") lista os LOTES que o robô da Nexxera trouxe
  (`ImpLoteExtBanc`: `lebCod`, `lebEspRoboExecCod`, `lebVldSituacao`). É a prova de
  que a Nexxera já entra pelo ERP.
- **`fin014`** (baixa do recebível) é ESCRITA e vive fora deste client — Fase 5,
  gated.

## Limitação operacional

O Conexos limita **sessões simultâneas por usuário** (`LOGIN_ERROR_MAX_SESSIONS`).
Cada processo Node faz login próprio, então o cron da ingestão compete por sessão
com o app rodando e com qualquer job manual. Antes de agendar o cron, provisionar
um usuário de robô dedicado.
