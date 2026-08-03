---
name: conexos-com299-gerdoc
type: integration
direction: write (REAL na trilha recebimentos — gated CONEXOS_WRITE_ENABLED + CONEXOS_DRY_RUN, default dry-run)
ontology_version: "0.12"
implementation_status: implemented
status: stable
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/service/recebimentos/SnPayloadBuilder.ts
  - src/backend/domain/interface/recebimentos/GerDocProcesso.ts
  - src/backend/domain/interface/recebimentos/constants.ts
  - src/backend/routes/recebimentos.ts
endpoints_write:
  - "com299 (POST /api/com299 + comDocProdutos + calculaValorLiquidoDocumento + finalizaDocumento — Solicitação de Numerário; REAL gated)"
  - "fin014 (POST /api/fin014 borderô + baixas/validacao/tituloBaixa + baixas + finalizar/{borCod} — baixa do crédito; conta = transacao.gerNum)"
last_review: 2026-08-03
open-gap:
  - "gcdCod-solicitacao-numerario-encomenda (P0 p/ HML) — o código EXATO da Configuração de Documento 'Solicitação de Numerário - Encomenda' precisa ser confirmado via HML/HAR; hoje é PLACEHOLDER (gcdCod=0)."
  - "encomenda-percentuais (P1, §7 Q4) — a regra de % da encomenda (0,1%/0,9%) é NÃO-RESOLVIDA; a SN usa o valor cru da transação por ora."
  - "gerdoc-payload-fields (P1) — campos de rateio (items[] TmpCom068DTOItem: prjCod/ctpCod/tpcCod/cfoEspCod) e docTip/docVldTipo precisam de confirmação no HAR real."
---

> ## ⚠️ CORREÇÃO DE CONTRATO (HAR-confirmado 2026-07-30 — prod filial 2, doc 18202; `/home/inteli/com299/`)
>
> **`gerDocProcesso` NÃO EXISTE nesta versão do Conexos.** com299 é **REST CRUD genérico** — a criação de
> uma SN é **multi-call**, não um único save-handler. Este doc (endpoints_write acima) está OBSOLETO; a
> sequência real é:
>
> 1. `POST /api/com299` — cria o **cabeçalho** (finDoc). ACL `checkInsert(view:"com299")`. Retorna `docCod`.
> 2. `POST /api/com299/comDocProdutos` — cria a(s) **linha(s) de rateio** (o rateio vive na LINHA, não no
>    cabeçalho). PUT/DELETE por `.../{docCod}/{prdCod}/{dprCodSeq}`.
> 3. `GET /api/com299/calculaValorLiquidoDocumento/{docCod}` — o **servidor** soma o líquido das linhas e
>    sobrescreve `docMnyValor` (`finDocOverwrite`). Não há % de encomenda client-side.
> 4. `POST /api/com299/finalizaDocumento/{docCod}` — finaliza. ACL action `FINALIZAR DOCUMENTO`.
>
> **Valores reais (era placeholder):** `gcdCod=150` ("SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA"); `docTip=1`;
> `docVldTipo=9` (`docVldTipoAdto=1`); `moeCod=null` (BRL implícito — a suposição 790 não vale); `tpdCod=3`,
> `gerNum=210`, `pgtCod=1`, `espSerie="SN"`, `vldTpNf="00"`.
>
> **Rateio (linha `comDocProdutos`, PROCESSO-derivado — varia por doc):** `prjCod`, `ctpCod`(+`ctpEspConta`),
> `tpcCod`, `cfoEspCod`, `ccuCod`, `prdCod`, `undCod`, `ungCod`. Amostra 18202: `prjCod=1, ctpCod=690
> (ADIANTAMENTO DE CLIENTE ENCOMENDA / 330037), tpcCod=107, cfoEspCod=9999A2, ccuCod=30, prdCod=2, undCod=3,
> ungCod=4`. Header `docMnyValor == Σ dprPreTotalLiquido` (linha única 100%).
>
> **Sucesso ≠ HTTP 200:** validações in-band via `docVldComvalidacoes` (1=ok, 2=aviso, else=erro). Handle de
> reconciliação = **`docCod`** (create redireciona `cadastro/{docCod}`).
>
> **Validações prévias (todas `.../validate/...`):** `processo`, `data`, `pessoa`, `gerNum`,
> `endDocFederal`; `comDocProdutos/validaCfopProduto`; `validaDocFederalAmazonas`. Pickers: psq018/psq027.
>
> **ACL (view `com299`):** `checkInsert`/`checkUpdate`/`checkDelete` + actions `FINALIZAR DOCUMENTO` /
> `ESTORNAR DOCUMENTO`. A conta-robô precisa de **create + edit** (e finalizar/estornar p/ fechar docs).
>
> **Gaps que restam:** (a) FONTE dos códigos de rateio por-processo (são process-derived — de onde vêm?);
> (b) serialização exata do create body (interceptor do runbook, passo 7). Ver `FINDINGS.md`.
>
> **% da encomenda RESOLVE-SE** a "lançar as linhas de rateio, servidor totaliza" — não é cálculo client-side.
> O guard `ENCOMENDA_PERCENTUAIS_RESOLVED` deve ser reenquadrado como "fonte dos códigos de rateio confirmada".

# Integração: Conexos com299 — Solicitação de Numerário (+ baixa fin014)

> ## ✅ ESCRITA REAL (v0.12, 2026-08-01) — a trilha recebimentos saiu do DRY-RUN
>
> O painel `/recebimentos` ("Alocar processos" → "Processar") **executa a escrita REAL** (gated
> `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`, default dry-run) via `RecebimentoNumerarioService`:
> gera a SN (com299) + **finaliza**, dá a **baixa `fin014`** (conta = `transacao.gerNum`, a conta
> do próprio pagamento), emite a nota de débito (com297 + produto 41978) e conclui a **cauda fiscal**
> (com300 → com131 → com297-homologar → poll SEFAZ — ver `integrations/conexos-nde-fiscal.md`).
> O antigo seam `SolicitacaoNumerarioService.enviarAoErp` (`NotImplementedError`) foi **RETIRADO**;
> o builder do payload é compartilhado (`SnPayloadBuilder`) entre a rota dry-run e o orquestrador.
> **Split-safe:** um pagamento gera 1..N SNs (uma por processo), Σ valor ≤ `transacao.valor`;
> idempotência `sn-real:{txnId}:{priCod}:{valor}`. Ver `actions/recebimentos/gerar-solicitacao-numerario.md`.
>
> A seção abaixo (redigida na iteração DRY-RUN) permanece como registro do contrato com299 e dos
> gaps de rateio; o gcdCod/rateio por-processo continuam instância/config do tenant.

> ## ⚠️ CORREÇÃO DE CONTRATO (execução REAL no HML, 2026-08-03 — SN nº 731, `docs/e2e/fase-b-resultado-hml.md`)
>
> Dois fatos do ERP medidos numa escrita real, ambos com HTTP 200 enganoso:
>
> 1. **`lov/CondPgtoPessoa` IGNORA o filtro `pesCod`** — devolve a lista **GLOBAL** de condições,
>    **paginada** (`sortBy: pgtDesNome asc`). Consequência: "a primeira `pgtDesNome` que contenha
>    DUPLICATA" é a condição de **outro cliente** (o doc 731 do SKYJACK recebeu
>    `pgtCod 103 "BONDUELLE - DUPLICATA"`). O serviço casa `pgtDesNome` contra o `dpeNomPessoa` **do
>    documento** (prefixo em fronteira de token, os dois nomes vêm abreviados/truncados do ERP). Sem
>    condição do próprio cliente → **fail-closed** (não se grava a de terceiro num documento financeiro).
> 1b. **O ERP IGNORA também o `pageSize` que pedimos** (2ª rodada HML, mesmo dia, pesCod 232): body com
>    `pageSize: 500` → resposta `count: 86` com **50 linhas**. Ele impõe a própria página, então
>    **a paginação se guia pelo `count` do envelope**, nunca por "página menor que o pedido ⟹ acabou" —
>    esse critério parava na 1ª página e nunca chegava à 2ª, onde estava a
>    `101 "SKYJACK BRASIL - DUPLICATA"`. Para em página VAZIA, ao alcançar o `count`, ou no teto de páginas.
> 2. **Finalização: sucesso ⟺ `docVldFinalizado === 1` na RELEITURA.** `validate/finalizacaoDocumento`
>    e `finalizaDocumento` voltaram **200** e o documento ficou `docVldFinalizado: 0`, sem título
>    (`mnyTitValor: 0`) — o erro só apareceu uma etapa depois, no fin014, apontando para o lugar
>    errado. O `finalizarDocumento` relê o doc (`GET {tela}/{docCod}`) e falha-fechado na própria
>    etapa, com o `docCod` na mensagem — mesma doutrina de discriminador por-etapa da leg fiscal
>    (`integrations/conexos-nde-fiscal.md`).

## Baixa fin014 (nova superfície — REAL)

Após a SN finalizada, a trilha recebimentos executa a baixa do crédito no `fin014`:
`POST /api/fin014` (borderô) → `baixas/validacao/tituloBaixa` (com o `docCod` da SN) → `POST
/api/fin014/baixas` (`postGenericOnce`) → `finalizar/{borCod}`. **Conta financeira = `transacao.gerNum`**
(a conta em que o pagamento entrou — derivada, não escolhida; `FIN014_CONTA_FINANCEIRA` NÃO é usado
nesta trilha). Progresso gravado na trilha estendida (`fin014_bor_cod`, etapa `fin014`/`fin014-done`).

## Endpoint (write — dry-run)

| Endpoint | Uso | Método | Posture |
|----------|-----|--------|---------|
| `com299/gerDocProcesso` | gerar Solicitação de Numerário (encomenda) a partir de um processo | `POST /api/com299/gerDocProcesso` | **DRY-RUN** — payload construído e devolvido; **nenhum POST** |

## Configuração de Documento (gcd)

- **`gcdDesNome = "Solicitação de Numerário - Encomenda"`** — o `gcd` (Configuração de Documento)
  usado.
- **`gcdCod` — PLACEHOLDER (`0`).** Precisa ser confirmado via **HML/HAR** antes de qualquer envio.
  Constante: `SOLICITACAO_NUMERARIO_DOC_CONFIG` em `constants.ts`.

## Payload — `GerDocProcessoSelectionDTOCab` (swagger)

Campos-chave (nomes de wire em português espelham o ERP — permitido por CLAUDE.md):

| Campo | Tipo | Origem (dry-run) |
|-------|------|------------------|
| `filCod` | int | filial do processo/transação |
| `docTip` / `docVldTipo` | str | `SN` (placeholder — confirmar no HAR) |
| `priCod` ("Processo") | int | processo escolhido |
| `priEspRefcliente` ("Referência Externa") | str | do processo |
| `pesCod` / `dpeNomPessoa` | int / str | cliente do processo |
| `gcdCod` / `gcdDesNome` | int / str | config "Solicitação de Numerário - Encomenda" (`gcdCod` placeholder) |
| `docDtaEmissao` / `dtaVencimento` | str | data de referência (now) |
| `valor` | number | **valor CRU da transação** (regra de % da encomenda não-resolvida) |
| `moeCod` | int | moeda do processo |
| `items[]` (`TmpCom068DTOItem`: `prjCod`, `ctpCod`, `tmpMnyValor`, `ctpDesNome`, `tpcCod`, `cfoEspCod`, `total`) | array | rateio — uma parcela com o total; códigos de rateio = 0 (placeholder, confirmar no HAR) |

## Posture DRY-RUN (por que não há write ao vivo)

- O `gcdCod` exato e vários campos do payload (rateio/docTip) ainda **não** foram confirmados por HAR
  real com credenciais de **homologação**. Enviar um documento com códigos placeholder ao ERP seria
  um efeito colateral irreversível com dados errados.
- Por isso `SolicitacaoNumerarioService.enviarAoErp` lança `NotImplementedError` — o caminho de
  escrita existe só como **seam** pronto para ser cabeado quando o contrato fechar (homologação-first,
  espelhando o gating dry-run de Permutas/`executarRecebimento`).

## Como sair do dry-run (próxima fatia)

1. Capturar um `gerDocProcesso` real no HAR (HML) → confirmar `gcdCod`, `docTip`/`docVldTipo` e os
   campos de rateio (`items[]`).
2. Resolver a regra de **percentuais da encomenda** (§7 Q4) → substituir o "valor cru" pelo cálculo.
3. Implementar `enviarAoErp` (reusar o handshake/write-ahead/dry-run gate do `ConexosBaixaClient`),
   atrás de um write-enabled + dry-run gate (homologação-first).
