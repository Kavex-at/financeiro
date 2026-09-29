---
name: destino-pagamento-sispag
type: business-rule
entity: LotePagamento
invariant: I10
ontology_version: "0.30.0"
implementation_status: partial
status: active
owners: [yuri]
related_files:
  - src/backend/migrations/0031_sispag_modalidade.sql
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/libs/cnab/RemessaCnabValidator.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
  - src/frontend/app/sispag/components/InformarDestinoDialog.tsx
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/libs/sispag/DestinoManualValidator.ts
  - src/backend/domain/libs/sispag/MaskDestino.ts
  - src/backend/domain/service/sispag/LotePagamentoApiView.ts
  - src/backend/migrations/0066_sispag_destino_manual.sql
last_review: 2026-09-28
has_canonical_test: true
---

# Business Rule — destino de pagamento SISPAG (TED e PIX) (I10)

> **Origem:** tweak `sispag-ted-pix` (2026-09-28). TED saía como crédito em conta, só para conta no
> banco do lote, e PIX nunca era oferecido. Metade dos favorecidos não tem conta no cadastro, nenhum
> tem chave PIX, e o cadastro que existe está desatualizado. Decisão em ADR-0054.

## Onde se aplica

Só a itens com `modalidade ∈ {TED, PIX}`. **Boleto** não tem destino de conta (o destino é o código
de barras; ver `boleto-exige-codigo-de-barras`). **Crédito em conta** não é oferecido (commit
`fc22dcd`); item legado que o tem segue a regra antiga.

## Resolução do destino (a mesma função para oferta e envio)

```
destino(item) =
    item.destinoManual                              se existe     → origem MANUAL
    senão, TED: conta ATIVA do favorecido no cmn025/ctcorr, qualquer banco, default primeiro
           PIX: chave ATIVA do favorecido no cmn025/cmnPessoasPix, default primeiro
                                                                   → origem CADASTRO
    senão: nenhum
```

- **Precedência:** o digitado vence o cadastro (ADR-0054 D2). O cadastro do Conexos está
  desatualizado; a entrada manual existe também para corrigi-lo **naquele item**.
- **O destino digitado não é escrito no cadastro** (ADR-0054 D1). Vai no payload do item do `fin015`
  sem `pctCodSeq`. Destino do cadastro vai por `pctCodSeq` (TED) ou pela chave (PIX).

## Invariantes (I10; D1–D9 do interview)

| # | Regra | Quando |
|---|---|---|
| **I10a** (D1) | Todo item TED/PIX tem destino resolvível **antes do `criarLote`** no `fin015`. Item sem destino barra o envio inteiro, com erro nomeado por item, **antes de qualquer escrita** (como `BoletoSemCodigoBarrasError`). E o `finalizarLote` já barra item TED/PIX sem destino, como barra "modalidade a definir". | finalizar e envio |
| **I10b** (D2) | **Oferta = envio.** A tela só oferece TED/PIX quando `destino(item)` resolve, com a **mesma função** que o envio usa. Divergência entre as duas é bug. | tela e envio |
| **I10c** (D3) | TED aceita conta em **qualquer banco**. O banco do favorecido não precisa ser o do lote. `TED → itsVldModalidade = 5`. | envio |
| **I10d** (D4) | **PIX só com chave**, do cadastro ou digitada. Sem chave, PIX não é oferecido nem enviado. | tela e envio |
| **I10e** (D5) | Digitar ou alterar `destinoManual` só com o lote em **RASCUNHO**, sob `versao` (I6). Reabrir (L4) volta a permitir, salvo I10f. | edição |
| **I10f** (D6) | **Congelamento:** depois do `importarTitulos` no `fin015` com um destino, esse destino **não muda**. Retry e retomada (ADR-0039) reenviam o persistido. O destino entra na assinatura da marca d'água do lote órfão (como a `dataDebito`, I8b). Só volta a ser editável se aquele lote nativo deixar de existir. | retomada |
| **I10g** (D7) | **Trilha:** toda gravação de destino manual registra quem, quando, valor anterior e valor novo, em registro só de inclusão, na nossa base. | edição |
| **I10h** (D8) | **Proteção do dado:** conta e chave são gravadas completas (vão ao ERP) e aparecem **mascaradas** na tela. **Nunca** saem inteiras em log, `LogService.data`, ledger (`remessa_execucao.requestPayload`) ou mensagem de erro. Revelar só para quem está editando. | sempre |
| **I10i** (D9) | **Titularidade (bloqueante):** o `titularDocumento` digitado é **igual** ao CPF/CNPJ do favorecido do título (lido ao vivo do `cmn025` por `pesCod`); diferente = gravação recusada. Chave PIX do tipo CPF/CNPJ: **a própria chave** tem de ser igual. Chave e-mail/telefone/aleatória: mostrar o nome do titular no DICT **se** o H1 provar que `validacao/modalidadePix` o devolve sem efeito colateral. | edição |

> **I10h é requisito de proteção, não estado de domínio.** Está aqui porque sem ele a entrada manual
> não pode existir; a forma (máscara, redação de log) é decisão de implementação.

**Não faz parte:** regra de quatro olhos (quem digitou não finaliza). Retirada em 2026-09-28
(ADR-0054 D3). Uma permissão específica para informar ou substituir destino pode vir depois.

## Formato do destino digitado

| Tipo | Campos | Validação de formato |
|---|---|---|
| TED (`CONTA`) | `bancoCod` (FEBRABAN, 3 dígitos), `agencia`, `agenciaDv?`, `conta`, `contaDv`, `titularDocumento` | dígitos; CPF/CNPJ com DV válido |
| PIX (`CHAVE_PIX`) | `chavePixTipo` (`CPF_CNPJ \| EMAIL \| TELEFONE \| ALEATORIA`, escolhido pela analista), `chavePix`, `titularDocumento` | por tipo: CPF/CNPJ com DV; e-mail; telefone `+55` com DDD; aleatória = UUID (EVP) |

O tipo da chave **não é inferido** (11 dígitos são CPF ou celular). O `titularDocumento` é exigido
também no PIX, para a checagem de I10i.

## Premissas que dependem do HML

| # | Premissa | Se falhar |
|---|---|---|
| H1 | `validacao/modalidadeTed` / `modalidadePix` sem efeito colateral | não chamamos; o `RemessaCnabValidator` fica como única rede; sem nome do DICT |
| **H3** | `fin015` aceita item TED com banco/agência/conta digitados **sem `pctCodSeq`** | **o pipeline para e fala com o usuário** antes de qualquer fallback para a opção A (escrita no `cmn025`) |
| H4 | campos do item PIX e forma/segmentos do `.REM` | PIX fica atrás de feature flag |
| **H5** | `fin015` aceita chave PIX digitada fora do `cmnPessoasPix` | idem H3 |
| H6 | o ERP não sobrescreve `itsVldModalidade = 5` | ajustar o mapeamento ao que ele grava |
| H7 | `fbtCod`/`fbtDesDescr`/`fbtEspCodbanco` (`FinBancosTpcontrib`, `fin055/{bncCod}/{fbtCod}`) são a **finalidade do TED** | sem constante; mandar o que o ERP espera, conforme a sonda |

## Validação no envio (`RemessaCnabValidator`)

A forma de lançamento do segmento A tem de condizer com a modalidade (TED × crédito × PIX; códigos a
confirmar no fixture), com segmento B presente. Um PIX que saísse como crédito em conta é
`RemessaCorrompidaError`.

## Estado da implementação (2026-09-28, `feat/sispag-ted-pix`)

**partial** — implementado e testado ATRÁS DE FLAGS desligadas por padrão (`SISPAG_TED_ENABLED`,
`SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`). Com as três desligadas o envio e a tela
são idênticos ao `main` (testes de paridade no `RemessaService`, `SispagPainelService` e
`LoteCard`). Nada foi provado em produção: H1, H3–H7 e o nome do campo de CPF/CNPJ no `cmn025`
(`CAMPO_DOCUMENTO_FAVORECIDO`) dependem do teste supervisionado do
`ontology/_inbox/sispag-ted-pix-tasks.md`.

Decisões de implementação a registrar:
- Com a flag da modalidade desligada, o item TED/PIX segue a regra do `main` (conta no banco do
  lote, modalidade 1). "PIX nunca resolve" = nunca resolve por **chave**.
- O destino digitado só vale com a flag manual **e** a da modalidade (conta → TED, chave → PIX).
- Congelamento (I10f) no envio: a retomada fixa as referências gravadas no ledger (`pctCodSeq`,
  `cixCod`, id da trilha) desde a marca d'água, ou seja, a partir do `criarLote` — um pouco mais
  cedo que o import. Destino diferente = `DestinoCongeladoError` (cancelar o lote nativo).
- Na edição, o congelamento consulta o lote nativo ao vivo (`getLoteNativo` + itens); leitura
  que falha recusa a edição.

## Ver também

- ADR-0054 — a decisão e o risco da precedência sobre o cadastro
- `entities/lote-pagamento.md` — `ItemLote.modalidade` e `ItemLote.destinoManual`
- `business-rules/boleto-exige-codigo-de-barras.md` — o fail-closed irmão, para boleto
- `business-rules/retomada-remessa-sispag.md` — marca d'água e retomada
- `ontology/_inbox/sispag-ted-pix-interview.md` — casos de teste 1–9
