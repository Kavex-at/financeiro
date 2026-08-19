---
name: conexos-aprovacao-trilha
type: integration
system: Conexos ERP
ontology_version: "0.10"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosAprovacoesClient.ts
  - src/backend/domain/client/ConexosAprovacoesClient.test.ts
  - src/backend/domain/interface/aprovacoes/ports.ts
  - src/backend/jobs/probe-aprovacoes-trilha.ts
last_review: 2026-08-19
---

# Integração — trilha de aprovação no Conexos (`psq014` + `fin026`)

> **Todo o conteúdo deste documento foi verificado contra a PRODUÇÃO** em 2026-08-18/19, por sonda
> read-only (`src/backend/jobs/probe-aprovacoes-trilha.ts`). Não há hipótese não marcada.
> **Read-only absoluto (I1)** — nenhum verbo de escrita é usado ou permitido nesta integração.

## Os dois endpoints

### 1. Universo de títulos — `POST psq014/list`

Tela de **pesquisa** de documentos a pagar/receber. Cobre o **histórico**.

```jsonc
{
  "filterList": {
    "filCod#EQ": 2,
    "docTip#EQ": 2,              // 1 = SAÍDA A RECEBER, 2 = ENTRADA A PAGAR
    "docDtaEmissao#GE": 1754006400000   // epoch MILISSEGUNDOS
  },
  "pageNumber": 1,
  "pageSize": 500,
  "serviceName": "psq014",
  "orderList": { "orderList": [{ "propertyName": "docCod", "order": "asc" }] }
}
```

Resposta: `{ count, pageNumber, rows: DocsPagarReceberDTO[] }`.
Campos usados: `filCod`, `docCod`, `titCod`, `docEspNumero`, `titEspNumero`, `pesCod`,
`dpeNomPessoa`, `titMnyValor`, `docDtaEmissao`, `titDtaVencimento`, `docVldFinalizado`,
`usnDesNomeFimDoc`.

> **Por que `psq014` e não `fin026/list`:** `fin026` projeta a **carteira corrente**. O doc 4156, que
> tem trilha completa, **não aparece** nele. Como o valor da Frente V está no histórico, o universo
> tem de vir da pesquisa.

### 2. Trilha de um título — `POST fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`

Corpo `CnxListRequest` com `filterList` vazio basta. Resposta: `{ count, rows: FinTituloBloq[] }`.

Equivalente exato, mesmo payload: `POST com308/financeiroAPagar/infoTitulo/list/{docCod}/{titCod}`.

Campos preenchidos numa etapa (verificado):

| Campo | Exemplo | Mapeia para |
|-------|---------|-------------|
| `fblCod` / `ftbCod` | 6 / 1 | chave da etapa |
| `fblDesNome` | `CONTROLLER` | `EtapaAprovacao.nome` |
| `aprovador` | `COMPRAS` | `EtapaAprovacao.alcada` |
| `fbaDesNome` | `LIBERAR` | `EtapaAprovacao.acao` |
| `usnDesNomeCmd` | `DANILO_LARA` | `EtapaAprovacao.responsavelNome` |
| `ftbVldStatus` | `2` | `EtapaAprovacao.statusErp` |
| `ftbTimBloq` | `1778753566000` | `EtapaAprovacao.recebidoEm` |
| `ftbTimCmd` | `1778838100000` | `EtapaAprovacao.agidoEm` |

**Campos que o schema declara mas NÃO vêm nesta projeção:** `docDtaFinalizacao`, `usnCodCmd`,
`acdCod`, `wffUuid`, `fbaVldAcao`, `motCodCanc`. Dependem de **PV-07** (acesso ao `fin103`).

## Armadilhas verificadas — leia antes de escrever qualquer cliente

| # | Armadilha | Consequência se ignorada |
|---|-----------|--------------------------|
| 1 | **Datas são epoch ms.** String ISO é recusada: `Value '2026-01-01' of ENUM ECnxDataType can't be converted to java.util.Date` | 500 no filtro de janela |
| 2 | **`#BETWEEN` não existe.** Só `#EQ` `#IN` `#LIKE` `#GE` `#GT` `#LE` `#LT` | 500: *"não está de acordo com as especificações de filtro de ListRequest"* |
| 3 | **Campos `Tim*` têm hora; campos `Dta*` são data pura** (meia-noite). Confirmado pelo `configList`: `titTim1Libera → DATETIME`, `titDtaVencimento → DATE` | Perda silenciosa de precisão na duração |
| 4 | **Grafia varia por endpoint e não é intercambiável.** `fin026/list` → `titVld1Libera`; `fin026/infoTitulo` → `titVld1libera` | 500: `titVld1libera (FinTituloFin026)` |
| 5 | **`filCod` errado devolve `count: 0` SEM ERRO** | **Falso negativo mudo.** O doc 4156 é da filial 1; consultado como filial 2 responde vazio. Observado na prática — I5 existe por causa disto |
| 6 | **`fin103/list` exige `filCod#EQ`** e hoje devolve vazio por falta de acesso à tela | PV-07 |
| 7 | **`psq014/infoTitulo/list` exige** `fExibirPrevisao` **e** `fExibirRenegociados` | 400 VALIDATION |
| 8 | **Path literal, nunca `listGenericPaginated`** — o helper posta em `/{serviceName}`, que em várias telas é a rota de escrita | Risco de POST em endpoint de criação |

## Endpoints de escrita — proibidos nesta frente

Documentados só para que ninguém os use por engano:
`PUT com308..com311/.../infoTitulo/trocaBloqueio`, `POST com308/infoTitulo/regerarBloqueios`,
`POST fin103/aplicarComando`, `POST fin103/bloqueioManual`, `POST fin063/aprovarDesconto`.

**Nenhum deles é chamado pela Frente V.** O port `TrilhaAprovacaoGatewayInterface` expõe apenas
métodos de leitura — a superfície do contrato torna a escrita inexpressável.

## Custo e evolução

| Cenário | Custo da varredura |
|---------|--------------------|
| **Hoje** (sem `fin103`) | 1 chamada de universo por página + **1 chamada por título** |
| **Com PV-07 resolvida** | Varredura paginada de `fin103/list` — duas ordens de grandeza menos |

Por isso o acesso ao ERP fica atrás de um **port**: trocar a implementação quando o acesso sair não
deve tocar no job nem no serviço.

## Autenticação e sessão

Herda o padrão do projeto: `ConexosBaseClient` + `legacyConexosAdapter`, com sessão resolvida por
chamada (`ConexosSessionResolver` — usuário logado ou robô, ADR-0007). Fora de request (job/cron),
cai no robô.
