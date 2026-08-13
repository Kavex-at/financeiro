---
name: conexos-com297-homologacao
type: integration
direction: write (live-capable, gated OFF — homologação fiscal irreversível)
ontology_version: "0.12"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/service/recebimentos/ConexosNdeEmitter.ts
  - src/backend/domain/service/recebimentos/ContingenciaDecider.ts
  - src/backend/domain/interface/recebimentos/HomologacaoNde.ts
  - src/backend/domain/interface/recebimentos/constants.ts
endpoints_write:
  - "com297/homologaNfe/{docCod} (POST — homologa NF-e normal; body {})"
  - "com297/homologaNfeContingencia/{docCod} (POST — homologa em contingência; body {})"
last_review: 2026-08-11
open-gap:
  - "com297-transmissao-nfe (P0 operacional) — homologar NÃO gera/transmite a NF-e. TODA NDe da automação parou em `vldStatus 2` / `vldNfeGerado 0`; as autorizadas (`vldStatus 3`) foram feitas à mão. Falta contratar por HAR o passo que faz `vldNfeGerado` virar 1. Ver ADR-0036"
  - "vldTpNf-distribuicao (P0 gate-before-live) — SEED NDE_NORMAL_TP_NF_CONHECIDOS a partir da distribuição real de vldTpNf; hoje VAZIO (recusa docs normais de propósito)"
  - "com297-doc-generation (P0 p/ fluxo completo) — os endpoints da GERAÇÃO do doc com297 (mintam o docCod) só existem como UI no docx"
  - "homologacao-response-fields (P1) — numeroNde exato + enum completo de docVldComvalidacoes a confirmar no HAR"
  - "acl-com297-homologar (P1) — conceder as ações HOMOLOGAR DOCUMENTO / HOMOLOGAR DOCUMENTO CONTINGENCIA à conta de serviço"
---

# Integração: Conexos com297 — homologação da NDe fiscal (eletrônica)

> **Leg FISCAL da Nota de Débito Eletrônica.** A NDe *eletrônica* é um **documento fiscal de SAÍDA**
> (`com297` = "Fiscais de Saída") **homologado** (autorização SEFAZ). Esta integração cobre o passo
> **TERMINAL** — a **homologação** (contrato completo, engenharia reversa do controller Angular). A
> **GERAÇÃO** do documento com297 (que produz o `docCod`) é uma leg anterior ainda **não contratada**
> (só passos de UI no docx). **Live-capable, mas gated OFF por default.** Corrige a suposição do plano
> §8.B ("NDe = com299 `docVldTipo=7`") — ver ADR-0024.

## Cadeia real (docx `telas Conexos.docx`)

`com299` (gerar doc **financeiro** do adiantamento) → `fin014` (baixa/recebimento do crédito) →
**`com297` (gerar doc fiscal + homologar) = NDe eletrônica**. O `com299` é a leg **financeira**
(`integrations/conexos-com299-gerdoc.md`, Solicitação de Numerário); o `fin014` é a baixa; o `com297`
é a leg **fiscal** — objeto deste arquivo.

## Endpoints (write — live-capable, gated)

| Endpoint | Uso | Método | Body | Posture |
|----------|-----|--------|------|---------|
| `com297/homologaNfe/{docCod}` | homologar NF-e normal | `POST` | `{}` | live-capable, gated OFF |
| `com297/homologaNfeContingencia/{docCod}` | homologar em contingência | `POST` | `{}` | live-capable, gated OFF |

- **`docCod` no PATH**, não no body. O body é literalmente `{}`.
- Qual verbo se aplica é decidido **client-side** (não há rota server-side que escolha) — ver a decisão
  de rota abaixo.

## Decisão de rota — `vldTpNf` (`ContingenciaDecider`)

Fonte: o predicado client-side `finDocIsContingenciaHomologacao` = `["11","12"].indexOf(o.finDoc.vldTpNf) !== -1`.
Ele **falha aberto** (sem `finDoc` → `undefined` → normal). **Não herdamos isso** — invertemos p/
fail-loud (ver `business-rules/homologacao-nde-com297.md`):

| `vldTpNf` (string, normalizado) | Rota | Aviso (UI) |
|---|---|---|
| `"11"` | `homologaNfeContingencia` | DPEC (legado EPEC) |
| `"12"` | `homologaNfeContingencia` | SCAN (legado SVC) |
| ∈ `NDE_NORMAL_TP_NF_CONHECIDOS` (allowlist) | `homologaNfe` | — |
| ausente | **`VldTpNfAusenteError`** | — |
| qualquer outro | **`VldTpNfDesconhecidoError`** | — |

- Comparação **estrita por string** — um `11` numérico de payload REST não casaria; normalize no
  boundary (`normalizeVldTpNf`).
- Rota decidida **no momento do POST** a partir de `vldTpNf` — passe o valor decidido; não deixe um
  read velho escolher o endpoint.
- O aviso DPEC/SCAN (`vldTpNf === "11" ? DPEC : SCAN`) **só** muda o texto do dialog — **não** afeta a
  rota.

## HTTP 200 ≠ sucesso — e `docVldComvalidacoes` também não é o veredito

O `customizedSuccess: true` do controller suprime o toast default justamente p/ permitir um branch
obrigatório. A leitura do controller Angular era:

| `docVldComvalidacoes` | Significado | Resultado |
|---|---|---|
| `1` | sucesso limpo | `emitida` |
| `2` | homologada, mas validações pendentes (abre com194, mostra *aviso*) | `emitida` **com aviso** |
| qualquer outro | falha (com194 + toast de erro) | **`HomologacaoRejeitadaError`** (recusa) |

⚠️ **Medido em produção (2026-08-11) — este campo não separa homologada de recusada.** A NDe 18771
devolveu `0` e o documento ficou **não homologado** (`docVldNfehom: 0`, `vldStatus: 1`); a 18779, mesmo
fluxo e as MESMAS três validações de aviso, devolveu um valor aceito e **homologou**. O `0` foi
admitido como sucesso em 2026-08-03 e foi por essa porta que a execução da DYNAMIS foi reportada como
`settled` sem nota.

**O veredito é o ESTADO GRAVADO:** depois do POST, ler `GET com297/{docCod}` e exigir
`docVldNfehom === 1`. O branch do client segue permissivo (ele não tem como saber); a verificação
autoritativa vive no `RecebimentoNumerarioService`. Ver **ADR-0036**.

## Homologar ≠ transmitir a NF-e

`vldStatus` do com297, medido na população real da `gcd 248` (filial 2):

| `vldStatus` | Estado | Sinais |
|---|---|---|
| `1` | aberto | `docVldNfehom: 0` |
| `2` | **homologado, sem NF-e** | `vldAutorizado: 0`, `docEspNumero: "0"`, `vldNfeGerado: 0` (com300) |
| `3` | autorizado | `vldAutorizado: 1`, `docEspNumero` real, `vldNfeGerado: 1`, `fisVldImpressao: 1` |

Toda NDe que a automação homologou parou em `2` — a 18348 desde 03/08. As autorizadas da mesma
configuração foram feitas à mão. Entre `2` e `3` há um passo que ainda **não** temos contratado
(open-gap `com297-transmissao-nfe`): `homologaNfe` não gera nem transmite a NF-e.

## Tolerância de 15 minutos (janela de recuperação)

A tentativa de homologação carimba `fisTimEmissao`/`fisTimSaida`. Passados **15 minutos**, o com194
levanta `A DATA DE EMISSÃO/MOVIMENTO DA NOTA FISCAL EXCEDEU A TOLERÂNCIA DE 15 MINUTOS` como **ERRO**
e nem a homologação manual passa — só liberando as datas no ERP (`vldDtEmisLiberada`/
`vldDtMovLiberada`) ou cancelando e reemitindo. Por isso uma homologação que não confirma tem de
**falhar alto na hora**: o prazo de conserto é curto e começa a correr no instante da tentativa.

## com194 — severidade e classe

- `fdvVldErr`: **`1` = ERRO (❌, bloqueia)**, **`2` = AVISO (⚠️, não bloqueia)**. A doutrina anterior
  (`VALIDACAO_BLOQUEANTE = 2`) dizia o inverso.
- `fdvVldTperr`: **filtro obrigatório** (sem ele, `Generic.REQUIRED_FILTER_ERROR` / HTTP 400) e não
  aceita lista — as classes `1` e `2` são varridas e unidas. O doc 18737 guarda a sua única validação
  na classe `2`.

## Doutrina de escrita (irreversível/fiscal)

- **`postGenericOnce`** (tentativa ÚNICA, sem 401-retry silencioso e sem `RetryExecutor`) — um re-POST
  poderia homologar 2×. Espelha `ConexosBaixaClient` (fin010) / `ConexosSispagWriteClient` (fin015).
- Falhas de upstream → `HomologacaoRejeitadaError(motivo=upstream)` **não-retryable** (resultado
  ambíguo: o POST pode ter chegado). O pipeline **não** re-tenta; reconcilia pelo ledger write-ahead
  (que recusa re-emitir uma NDe já `emitida`).
- Idempotência: `idempotencyKey = nde:{recebimentoId}` (UNIQUE) — uma NDe por `Recebimento`
  (`business-rules/idempotencia-quitacao-nde.md`).

## Permissão (ACL Conexos)

Antes de qualquer POST, o UI roda `checkActions({view:"com297", action:"HOMOLOGAR DOCUMENTO"})` (ou
`HOMOLOGAR DOCUMENTO CONTINGENCIA`). A conta de serviço da automação precisa dessas ações concedidas
em `com297` — a contingência exige a ação **separada**. Se o servidor re-checa, sem a ação vem 403; se
não re-checa, estaríamos furando um controle do UI. Conceder propriamente (P1).

## Gating de produção (por que não há write ao vivo hoje)

- O `ConexosNdeClient` é **live-capable** (o `postGenericOnce` é real), mas o orquestrador
  (`ConexosNdeEmitter`) só dispara com **escrita ligada** (`conexosWriteEnabled && !conexosDryRun`,
  default OFF) **e** com `Recebimento.emissaoNde` presente (o `docCod` + `vldTpNf`), que só a leg de
  GERAÇÃO com297 (info-gap) produz. Sem `emissaoNde`, o emitter devolve `pendente` (fallback).
- O binding default de `NDE_EMITTER_TOKEN` segue no `NdeEmitterStub`. O swap para `ConexosNdeEmitter`
  é o passo de **go-live**, gated por: escrita ligada · `emissaoNde` fluindo · `NDE_NORMAL_TP_NF_CONHECIDOS`
  seedada · testes do pipeline registrando `LEGACY_CONEXOS_TOKEN`.

## Como sair do gate (próxima fatia)

1. Contratar a **leg de GERAÇÃO** com297 (HAR): gerar-documento (produto `41978`/número `0`), setar
   "Tipo de nota de débito = Pagamento antecipado" (Mais Ações → Fiscal), gerar-observações → produz o
   `docCod` e o `vldTpNf`.
2. **SEED** `NDE_NORMAL_TP_NF_CONHECIDOS` a partir da distribuição real de `vldTpNf`.
3. Confirmar `numeroNde`/`docVldComvalidacoes` num HAR real de homologação (HML).
4. Conceder a ACL `HOMOLOGAR DOCUMENTO [CONTINGENCIA]` à conta de serviço.
5. Ligar a escrita + trocar o token → homologação-first em HML.
