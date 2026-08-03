# ADR-0026 — Recusa determinística do ERP não é retentável

- **Status:** aceito
- **Data:** 2026-08-03
- **Contexto de origem:** `/feature-tweak solicitacao-numerario` — diagnóstico do `fin014` no HML
  (`docs/e2e/fin014-finalizacao-hml-diagnostico.md`, §9 item 3)
- **Relacionado:** ADR-0025 (condição de pagamento condicional + fail-closed),
  `ontology/integrations/conexos.md` §"Contrato de leitura de ERRO"

## Contexto

Toda falha de chamada ao Conexos virava um `ConexosError` com `retryable = true` e `statusCode = 504`,
independentemente do que o ERP tinha respondido. Isso valia tanto para um socket derrubado quanto para
um `400 VALIDATION` — um veredito do servidor sobre o conteúdo do pedido.

O caso que expôs o problema: no HML, `POST /api/fin014/finalizar/{borCod}` devolve
`400 CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` para **qualquer** borderô a-receber com baixa (defeito de
ambiente do lado da Conexos — a própria UI deles falha igual, medido em sete hipóteses refutadas). Esse
erro é determinístico: repetir devolve exatamente a mesma resposta.

Duas consequências concretas, ambas medidas:

1. **Chamadas desperdiçadas.** O `RetryExecutor` do `ConexosBaseClient` não tinha `shouldRetry` — o
   default é `() => true` —, então cada 4xx de leitura custava duas chamadas ao ERP. A política central
   do `RecebimentoPipelineService` já **declarava** a regra certa ("um 4xx do ERP não é retryable —
   `retryable === false` desiste na hora"), mas nada nunca marcava `retryable: false`. A regra existia
   como comentário e não como comportamento.
2. **Conselho errado ao analista.** O `userMessage` de qualquer falha era *"O ERP Conexos retornou um
   erro. Tente novamente em alguns minutos."* Numa recusa determinística isso manda o analista insistir
   num caminho que nunca vai abrir, e esconde a razão que o ERP deu.

## Decisão

O `ConexosError` passa a **derivar** a classificação do status do upstream, em vez de assumir uma:

| Situação | `code` | `retryable` | HTTP para fora |
|---|---|---|---|
| Sem resposta (rede, parse, socket) | `CONEXOS_UPSTREAM_ERROR` | `true` | 504 |
| 5xx | `CONEXOS_UPSTREAM_ERROR` | `true` | 504 |
| 408, 429 | `CONEXOS_UPSTREAM_ERROR` | `true` | 504 |
| Demais 4xx | `CONEXOS_UPSTREAM_REJECTED` | **`false`** | **502** |
| Timeout declarado pelo caller | `CONEXOS_UPSTREAM_TIMEOUT` | `true` | 504 |

Três notas sobre as bordas:

- **408 e 429 são 4xx que não são veredito.** Um é o próprio timeout devolvido pelo upstream, o outro é
  "peça de novo mais devagar". A retentativa pode mudar o resultado nos dois.
- **502, não 504, na recusa.** 504 significa "represei um upstream lento". Quando o ERP respondeu — e
  respondeu "não" —, o honesto é *Bad Gateway*. O frontend não ramifica por status (verificado), então a
  mudança de contrato não quebra tela; o que ele lê é `error`/`retryable`.
- **O timeout declarado vence a leitura do status.** Sem veredito do servidor não há recusa a
  classificar: um status encontrado na cadeia de `cause` seria de outra resposta, anterior.

O `userMessage` da recusa carrega a **razão crua do ERP** (`vars.msg` quando existe, senão a key, ex.
`CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE`) e nunca sugere repetir. A key não é bonita, mas é o que o
suporte da Conexos procura no log deles.

O `RetryExecutor` do `ConexosBaseClient` ganha o `shouldRetry` correspondente, para que a economia
aconteça já na camada de transporte e não só na política de pipeline.

## Alternativa considerada e recusada

**Classificar só na leg do `fin014`.** Risco menor para os caminhos que já rodam em produção (SISPAG,
permutas, GED), mas deixaria o mesmo defeito de pé em cinco módulos e manteria a política central como
uma frase que ninguém cumpre — dívida com nome. Decidido pelo Yuri em 2026-08-03: central.

## Consequências

- Uma recusa do ERP falha **na primeira tentativa**, com a razão dele na mensagem. O diagnóstico fica
  mais rápido e o ERP recebe menos carga inútil.
- `CONEXOS_UPSTREAM_REJECTED` é um code novo no contrato de erro da API. Consumidores que casavam
  exaustivamente com os dois codes antigos precisam conhecê-lo.
- Um 401 que escape do retry-em-401 interno do transporte agora **para** em vez de ser retentado. É o
  comportamento desejado: se o re-login não resolveu, insistir não resolve.
- A leitura crua da resposta do ERP passa a ter ponto único (`ErpResponseReader`), compartilhado com o
  `ErpErrorInterpreter`. Foi tê-las duplicadas que permitiu classificação e tradução discordarem sobre o
  mesmo payload.

## Fora de escopo

Não altera a política de idempotência (`ADR-0022`, write-ahead ledger): uma escrita irreversível
continua sendo tentativa única (`postGenericOnce`), independentemente de a falha ser retentável.
