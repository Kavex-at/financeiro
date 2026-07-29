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
