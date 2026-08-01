---
name: conexos-com299-gerdoc
type: integration
direction: write (DRY-RUN-only — nenhum POST alcançável até HML/HAR)
ontology_version: "0.11"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts
  - src/backend/domain/interface/recebimentos/GerDocProcesso.ts
  - src/backend/domain/interface/recebimentos/constants.ts
  - src/backend/routes/recebimentos.ts
endpoints_write:
  - "com299/gerDocProcesso (POST /api/com299/gerDocProcesso — Solicitação de Numerário; DRY-RUN, não enviado)"
last_review: 2026-07-28
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

# Integração: Conexos com299 — gerDocProcesso (Solicitação de Numerário) — DRY-RUN

> **Superfície de ESCRITA planejada, DESABILITADA nesta iteração.** O painel `/recebimentos`
> ("Alocar" → "Processar") gera uma **Solicitação de Numerário (encomenda)** montando o payload do
> `POST /api/com299/gerDocProcesso`, mas **NÃO envia** ao Conexos: o service devolve
> `{ dryRun: true, docConfig, payload }` e o seam de envio real lança `NotImplementedError`. Não há
> caminho de escrita ao ERP alcançável até a confirmação HML/HAR. Ver
> `actions/recebimentos/gerar-solicitacao-numerario.md`.

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
