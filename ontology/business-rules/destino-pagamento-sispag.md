---
name: destino-pagamento-sispag
type: business-rule
entity: LotePagamento
invariant: I10
ontology_version: "0.38.0"
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
last_review: 2026-10-08
has_canonical_test: true
---

# Business Rule — destino de pagamento SISPAG (TED e PIX) (I10)

> **Origem:** tweak `sispag-ted-pix` (2026-09-28). TED saía como crédito em conta, só para conta no
> banco do lote, e PIX nunca era oferecido. Metade dos favorecidos não tem conta no cadastro, nenhum
> tem chave PIX, e o cadastro que existe está desatualizado. Decisão em ADR-0054.
>
> **Revisada pela ADR-0061 (2026-10-05):** cadastro primeiro, exceção aprovada como fallback (I12,
> `business-rules/excecao-destino-sispag.md`); D2, D10 e D11 da ADR-0054 estão superseded.
>
> **Revisada pela ADR-0065 (2026-10-08), que supersede a ADR-0061:** a exceção de destino (I12) foi
> **apagada**. O destino é **só o do cadastro** (`cmn025`) e o favorecido precisa estar **autorizado**
> para a modalidade, com o mesmo destino aprovado (I14, `business-rules/favorecido-autorizado-sispag.md`).
> I10d, I10e, I10g, I10h, I10i reescritas; H3/H5 deixam de importar (todo TED vai por `pctCodSeq`,
> todo PIX por chave do `cmnPessoasPix`).

## Onde se aplica

Só a itens com `modalidade ∈ {TED, PIX}`. **Boleto** não tem destino de conta (o destino é o código
de barras; ver `boleto-exige-codigo-de-barras`). **Crédito em conta** não é oferecido (commit
`fc22dcd`); item legado que o tem segue a regra antiga.

## Resolução do destino (a mesma função para oferta, verificação, fingerprint e envio)

```
destino(item) =
    cadastro:
       TED: conta ATIVA do favorecido no cmn025/ctcorr, qualquer banco, default primeiro
       PIX: chave ATIVA do favorecido no cmn025/cmnPessoasPix, nesta ordem (I10k):
            1. tipo CPF/CNPJ igual ao documento do favorecido (pdcDocFederal)
            2. a default
            3. as demais
            documento indisponível = ordem de antes (default primeiro)
    senão: nenhum
```

- **Só o cadastro (ADR-0065).** Nenhum destino fora do `cmn025`; nada é escrito no `cmn025` (ADR-0054
  D1, mantida). Cadastro ruim ou ausente é problema operacional da Columbia, a corrigir no Conexos.
- O destino escolhido é o que o fingerprint da autorização pina (I14b): o resolvedor escolher outra
  conta/chave = "destino mudou".

## Invariantes (I10; D1–D9 do interview)

| # | Regra | Quando |
|---|---|---|
| **I10a** (D1) | Todo item TED/PIX tem destino resolvível e autorizado **antes do `criarLote`** no `fin015`. No `finalizarLote` o item que falha **sai do lote** (I13j); no envio (L8, sem lote nativo) barra o lote inteiro, com erro nomeado por item, **antes de qualquer escrita** (I14e). | finalizar e envio |
| **I10b** (D2) | Com a guarda I14 habilitada (I14k) e a flag da modalidade ligada, a tela oferece TED/PIX **sempre**; ao definir a modalidade o item recebe **aviso** (sem dado, não autorizado, destino mudou) e quem decide é o `finalizarLote` (I13j). A tela mostra o destino mascarado e o selo de conferência (I14l), calculados com a **mesma função** que o envio usa — divergência entre as duas é bug. | tela e envio |
| **I10c** (D3) | TED aceita conta em **qualquer banco**. O banco do favorecido não precisa ser o do lote. `TED → itsVldModalidade = 5`. | envio |
| **I10d** (D4, ADR-0065) | **PIX só com chave do cadastro**, de qualquer tipo (ordem I10k). Sem chave, PIX não é enviado. | tela e envio |
| **I10e** (ADR-0065) | O destino **nunca é editado** no item nem no lote: vem só do `cmn025`. Dado de pagamento é só leitura no lote. | — |
| **I10f** (D6) | **Congelamento:** depois do `importarTitulos` no `fin015` com um destino, esse destino **não muda**. Retry e retomada (ADR-0039) reenviam o persistido, e a guarda I14 de L8 não roda de novo. O destino resolvido entra na assinatura da marca d'água do lote órfão (como a `dataDebito`, I8b); o item grava `favorecidoAutorizadoId` (só rastreio). Só volta a ser editável se aquele lote nativo deixar de existir. | retomada |
| **I10g** (D7, ADR-0065) | **Trilha:** eventos de autorização e de destino vão para a trilha da `FavorecidoAutorizado` (I14j). A tabela `lote_pagamento_item_destino_audit` (ADR-0054) e a trilha da exceção são **dropadas**; a migração **recusa** rodar se alguma delas, ou `excecao_destino`, tiver linhas. | sempre |
| **I10h** (D8, ADR-0065) | **Proteção do dado:** conta e chave aparecem **mascaradas** (banco e agência completos, conta com 4 últimos dígitos; PIX com tipo e trecho). **Nunca** saem inteiras em log, `LogService.data`, ledger (`remessa_execucao.requestPayload`) ou mensagem de erro. Valor completo só pelo botão "revelar", com `sispag:autorizar_favorecido`, lido ao vivo e auditado (I14l). | sempre |
| ~~**I10i**~~ (D9) | **REMOVIDA (ADR-0065).** Era a titularidade bloqueante da exceção. Vira **aviso** na aprovação da autorização PIX quando a chave não é o CPF/CNPJ do favorecido (I14c). | — |

| **I10j** (ADR-0054 D10/D11) | **REVOGADA pela ADR-0061.** Substituída por I12b, que a ADR-0065 também apagou; a dupla validação hoje é a da autorização do favorecido (I14c). | — |
| **I10k** (ADR-0054 D12) | **Preferência pela chave CPF/CNPJ (do cadastro):** entre as chaves ativas do cadastro, a do tipo CPF/CNPJ igual ao documento do favorecido vem antes da default. A oferta marca esse PIX (`destinos.PIX.chaveCpfCnpjDoFavorecido`) e a tela sugere PIX antes de TED; a analista continua podendo escolher TED. | tela e envio |

> **I10h é requisito de proteção, não estado de domínio.** Está aqui porque sem ele a entrada manual
> não pode existir; a forma (máscara, redação de log) é decisão de implementação.

**Quatro olhos:** o `finalizarLote` não exige pessoa diferente. A dupla validação vale na **autorização
do par (favorecido, destino)** (I14c), uma vez por destino, não por lote.

## Premissas que dependem do HML

| # | Premissa | Se falhar |
|---|---|---|
| H1 | `validacao/modalidadeTed` / `modalidadePix` sem efeito colateral | não chamamos; o `RemessaCnabValidator` fica como única rede; sem nome do DICT |
| ~~**H3**~~ (irrelevante, ADR-0065) | `fin015` aceita item TED com banco/agência/conta digitados **sem `pctCodSeq`** | **o pipeline para e fala com o usuário** antes de qualquer fallback para a opção A (escrita no `cmn025`) |
| H4 | campos do item PIX e forma/segmentos do `.REM` | PIX fica atrás de feature flag |
| ~~**H5**~~ (irrelevante, ADR-0065) | `fin015` aceita chave PIX digitada fora do `cmnPessoasPix` | idem H3 |
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

### Adendo (2026-10-05) — ADR-0063

- **I10a no `finalizarLote` muda de forma:** o item TED/PIX sem destino resolvível (sem cadastro e
  sem exceção `APROVADA`) **sai do lote** pela verificação TED/PIX e abre `PendenciaCadastro`
  (I13j); a finalização não acontece naquela tentativa (`ItemsRemovedByCheckError`). No **envio**
  (`gerarRemessa`) I10a segue barrando como antes.
- Com exceção `APROVADA` o item fica, mas a pendência de cadastro é aberta do mesmo jeito.
- **I10b × I13j (gap Q1 — resolvido, opção a):** a escolha de TED/PIX é livre (com a flag ligada);
  a verificação retira o item sem destino e abre a pendência. Ver `_inbox/sispag-verificacoes-ted-pix-gap.md`.

### Adendo (2026-10-08) — ADR-0065

- A exceção de destino (ADR-0061, I12) foi **apagada**: entidade, trilha, tabelas, tela
  `/sispag/excecoes`, `sispag:excecao` (convertida em `sispag:autorizar_favorecido`),
  `SISPAG_EXCECAO_DESTINO_ENABLED`/`SISPAG_DESTINO_MANUAL_ENABLED`, `ExcecaoDesabilitadaError`,
  `DestinoManualValidator` (se só servia à exceção) e o alerta `SISPAG_EXCECAO_DIVERGENCIA`.
- Os adendos de 2026-10-05 acima ficam como histórico; o que eles dizem sobre exceção e
  `PendenciaCadastro` não vale mais.

## Ver também

- ADR-0054 — a decisão original (parcialmente superseded)
- ADR-0061 — cadastro primeiro, exceção aprovada (superseded pela ADR-0065)
- ADR-0065 — favorecido autorizado
- `business-rules/favorecido-autorizado-sispag.md` — I14
- `entities/lote-pagamento.md` — `ItemLote.modalidade` e `ItemLote.favorecidoAutorizadoId`/`autorizacaoAviso`
- `business-rules/boleto-exige-codigo-de-barras.md` — o fail-closed irmão, para boleto
- `business-rules/retomada-remessa-sispag.md` — marca d'água e retomada
- `ontology/_inbox/sispag-ted-pix-interview.md` — casos de teste 1–9
