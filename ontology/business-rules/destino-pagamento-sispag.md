---
name: destino-pagamento-sispag
type: business-rule
entity: LotePagamento
invariant: I10
ontology_version: "0.33.0"
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
  - src/backend/migrations/0067_sispag_destino_manual.sql
  - src/backend/migrations/0068_sispag_aprovar_destino.sql
  - src/backend/domain/libs/sispag/DestinoAprovacaoRule.ts
  - src/backend/domain/errors/DestinoAprovacaoPendenteError.ts
  - src/backend/domain/interface/auth/Permission.ts
last_review: 2026-10-05
has_canonical_test: true
---

# Business Rule — destino de pagamento SISPAG (TED e PIX) (I10)

> **Origem:** tweak `sispag-ted-pix` (2026-09-28). TED saía como crédito em conta, só para conta no
> banco do lote, e PIX nunca era oferecido. Metade dos favorecidos não tem conta no cadastro, nenhum
> tem chave PIX, e o cadastro que existe está desatualizado. Decisão em ADR-0054.
>
> **Revisada pela ADR-0061 (2026-10-05):** cadastro primeiro, exceção aprovada como fallback (I12,
> `business-rules/excecao-destino-sispag.md`); D2, D10 e D11 da ADR-0054 estão superseded.

## Onde se aplica

Só a itens com `modalidade ∈ {TED, PIX}`. **Boleto** não tem destino de conta (o destino é o código
de barras; ver `boleto-exige-codigo-de-barras`). **Crédito em conta** não é oferecido (commit
`fc22dcd`); item legado que o tem segue a regra antiga.

## Resolução do destino (a mesma função para oferta e envio)

```
destino(item) =
    1. cadastro:
       TED: conta ATIVA do favorecido no cmn025/ctcorr, qualquer banco, default primeiro
       PIX: chave ATIVA do favorecido no cmn025/cmnPessoasPix, nesta ordem (I10k):
            1. tipo CPF/CNPJ igual ao documento do favorecido (pdcDocFederal)
            2. a default
            3. as demais
            documento indisponível = ordem de antes (default primeiro)   → origem CADASTRO
    2. senão, ExcecaoDestino do favorecido em estado APROVADA, do tipo da modalidade
                                                                          → origem EXCECAO
    3. senão: nenhum
```

- **Precedência (ADR-0061):** o cadastro vence. A exceção `APROVADA` é fallback **só quando o
  cadastro não tem destino válido** para a modalidade; cadastro válido nunca é substituído por
  exceção (segurança/fraude).
- **A exceção nunca é escrita no cadastro** (ADR-0054 D1, mantida). Vai no item do `fin015` sem
  `pctCodSeq`. Destino do cadastro vai por `pctCodSeq` (TED) ou pela chave (PIX).
- **Cadastro ruim ou ausente é problema operacional da Columbia, a corrigir no Conexos.** A exceção
  é ponte, não substituto.

## Invariantes (I10; D1–D9 do interview)

| # | Regra | Quando |
|---|---|---|
| **I10a** (D1) | Todo item TED/PIX tem destino resolvível **antes do `criarLote`** no `fin015`. Item sem destino barra o envio inteiro, com erro nomeado por item, **antes de qualquer escrita** (como `BoletoSemCodigoBarrasError`). E o `finalizarLote` já barra item TED/PIX sem destino, como barra "modalidade a definir". | finalizar e envio |
| **I10b** (D2) | **Oferta = envio.** A tela só oferece TED/PIX quando `destino(item)` resolve, com a **mesma função** que o envio usa. Divergência entre as duas é bug. | tela e envio |
| **I10c** (D3) | TED aceita conta em **qualquer banco**. O banco do favorecido não precisa ser o do lote. `TED → itsVldModalidade = 5`. | envio |
| **I10d** (D4) | **PIX só com chave**, do cadastro ou de exceção aprovada (CPF/CNPJ). Sem chave, PIX não é oferecido nem enviado. | tela e envio |
| **I10e** (ADR-0061) | A exceção **não é editada no item nem no lote**: é cadastrada, aprovada e revogada na entidade `ExcecaoDestino` (I12). No lote a analista só **vê** a origem do destino (`CADASTRO` \| `EXCECAO`). | — |
| **I10f** (D6) | **Congelamento:** depois do `importarTitulos` no `fin015` com um destino, esse destino **não muda**. Retry e retomada (ADR-0039) reenviam o persistido. O destino resolvido (com o `excecaoDestinoId`, quando `EXCECAO`) entra na assinatura da marca d'água do lote órfão (como a `dataDebito`, I8b). Só volta a ser editável se aquele lote nativo deixar de existir. | retomada |
| **I10g** (D7, ADR-0061) | **Trilha:** a trilha só-inclusão passa a registrar também os eventos da exceção (I12e). A tabela `lote_pagamento_item_destino_audit` é mantida como histórico e **deixa de receber linhas novas**; a nova trilha reaproveita o padrão (trigger recusa UPDATE/DELETE/TRUNCATE). | sempre |
| **I10h** (D8) | **Proteção do dado:** conta e chave são gravadas completas (vão ao ERP) e aparecem **mascaradas** na tela. **Nunca** saem inteiras em log, `LogService.data`, ledger (`remessa_execucao.requestPayload`) ou mensagem de erro. Revelar só para quem está editando. | sempre |
| **I10i** (D9) | **Titularidade (bloqueante):** o `titularDocumento` da exceção é **igual** ao CPF/CNPJ do favorecido do título (`pdcDocFederal`, lido ao vivo do `cmn025` por `pesCod`); diferente = gravação recusada. Chave PIX da exceção: **só CPF/CNPJ, e a própria chave** tem de ser igual (ADR-0061; outros tipos fora de escopo). **Chave digitada e-mail/telefone/aleatória: recusada** (titular não conferível — só o DICT sabe; ADR-0054, adendo de 2026-09-29). Reabrir se o H1 provar que `validacao/modalidadePix` devolve o titular. | edição |

| **I10j** (ADR-0054 D10/D11) | **REVOGADA pela ADR-0061.** Substituída por I12b: dupla validação rígida (aprovador ≠ cadastrante), permissão única `sispag:excecao`, TED e PIX. | — |
| **I10k** (ADR-0054 D12) | **Preferência pela chave CPF/CNPJ (do cadastro):** entre as chaves ativas do cadastro, a do tipo CPF/CNPJ igual ao documento do favorecido vem antes da default. A oferta marca esse PIX (`destinos.PIX.chaveCpfCnpjDoFavorecido`) e a tela sugere PIX antes de TED; a analista continua podendo escolher TED. | tela e envio |

> **I10h é requisito de proteção, não estado de domínio.** Está aqui porque sem ele a entrada manual
> não pode existir; a forma (máscara, redação de log) é decisão de implementação.

**Quatro olhos:** o `finalizarLote` não exige pessoa diferente. A dupla validação vale no **destino
fora do cadastro** (exceção, I12b), não na finalização do lote.

## Formato do destino (cadastro da exceção)

| Tipo | Campos | Validação de formato |
|---|---|---|
| TED (`CONTA`) | `bancoCod` (FEBRABAN, 3 dígitos), `agencia`, `agenciaDv?`, `conta`, `contaDv`, `titularDocumento` | dígitos; CPF/CNPJ com DV válido |
| PIX (`CHAVE_PIX`) | `chavePixTipo = CPF_CNPJ` (único aceito, ADR-0061), `chavePix`, `titularDocumento` | CPF/CNPJ com DV válido; chave = `pdcDocFederal` do favorecido |

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

### Adendo (2026-09-29, tarde) — D10–D12

- Permissão `sispag:aprovar_destino` no catálogo (ADR-0053) pela migration `0068`, que troca o
  `CHECK` das duas tabelas de permissão; só o papel `Administrador` a recebe. É avulsa: não implica
  nem é implicada por `sispag:ver`/`sispag:executar` (quem só aprova precisa de `sispag:ver` para
  chegar à tela).
- Rota `POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/destino/aprovar` (só RASCUNHO, `versao`).
  O body leva só a versão; a resposta traz o resumo mascarado, com `aprovacao`
  (`NAO_EXIGIDA`/`PENDENTE`/`APROVADO`), `aprovadoPor`/`aprovadoEm` e o CPF/CNPJ do titular
  **mascarado** (é o que o aprovador confere; o valor inteiro não sai da API, I10h).
- Na tela, o botão "Aprovar destino" só existe para quem tem a permissão (ADR-0053 R11).

### Adendo (2026-10-05) — ADR-0061

- O fluxo por item (`destinoManual`, `InformarDestinoDialog`, rota `.../destino/aprovar`,
  `DestinoAprovacaoRule`, `DestinoAprovacaoPendenteError`) é **retirado** e refatorado para
  `ExcecaoDestino` (código ainda não alterado; ver gap `sispag-excecao-gap.md`, Q4).
- A permissão `sispag:aprovar_destino` (0068) é **substituída** por `sispag:excecao`; a migration
  converte as concessões existentes.
- `SISPAG_DESTINO_MANUAL_ENABLED` passa a significar "exceção de destino habilitada" (nome: gap Q6).
- Mantêm-se `DestinoManualValidator`, `MaskDestino` e I10i. H3/H5 seguem não provadas.

## Ver também

- ADR-0054 — a decisão original (parcialmente superseded)
- ADR-0061 — cadastro primeiro, exceção aprovada
- `business-rules/excecao-destino-sispag.md` — I12
- `entities/lote-pagamento.md` — `ItemLote.modalidade` e `ItemLote.destinoOrigem`/`excecaoDestinoId`
- `business-rules/boleto-exige-codigo-de-barras.md` — o fail-closed irmão, para boleto
- `business-rules/retomada-remessa-sispag.md` — marca d'água e retomada
- `ontology/_inbox/sispag-ted-pix-interview.md` — casos de teste 1–9
