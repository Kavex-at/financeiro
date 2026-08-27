---
name: TituloAPagar
type: entity
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0024_pagamento_ingestao.sql
  - src/backend/migrations/0030_remove_internacional.sql
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/repository/sispag/PagamentoIngestaoRunRepository.ts
  - src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/backend/routes/sispag.ts
  - src/backend/jobs/ingest-pagamentos.ts
  - src/frontend/app/sispag/page.tsx
properties:
  - docCod
  - titCod
  - filCod
  - credor
  - pesCod
  - valor
  - moeda
  - vencimento
  - aprovado
  - pago
  - banco
  - numRemessa
  - tpdCod
  - prontoParaRemessa
  - temBoleto
  - ativo
  - ingestaoRunId
  - atualizadoEm
relationships:
  - "TituloAPagar N—1 Filial (via filCod — a filial que originou o título a pagar)"
  - "TituloAPagar N—1 PagamentoIngestaoRun (via ingestaoRunId — a run que gravou/atualizou este título)"
  - "TituloAPagar N—1 LotePagamento (via ItemLote — um título elegível pode ser incluído em um lote candidato RASCUNHO)"
  - "TituloAPagar 1—1 (contexto) Borderô a-pagar / Lote SISPAG nativos (fin010/fin015 — leitura de contexto no painel, não vínculo próprio)"
last_review: 2026-08-27
universality_evidence:
  - "docs/proposta/Proposta_Kavex_Columbia_Financeiro.md — Frente II (SISPAG): pagamentos de importação a vencer/aprovados"
  - "ADR-0021 — SISPAG é DOMÉSTICO: pagamento ao exterior é câmbio manual da tesouraria (não passa pelo SISPAG); internacional (com298 ufEspSigla='EX') é FILTRADO na ingestão e nunca entra na carteira (supersede ADR-0017 / aposenta a classe internacional e o I7)"
  - "ontology/_inbox/sispag-briefing.md §2 — sondagem read-only Conexos PRD (2026-07-07): fin064 Gestão de Pagamentos, 2.100 (fil1) / 18.234 (fil2) títulos reais"
  - "ontology/_inbox/sispag-native-vs-nexxera.md §2.5/§3 — 'aprovado para baixa' = flags de alçada titVld1/2/3libera (com308), doc 100 título 1 R$135.724,80 aprovado nos 3 níveis"
  - "ADR-0016 — a carteira de pagamentos vira PERSISTIDA (cadência diária, espelha a ingestão de Permutas): base durável do painel diário"
  - "Conceito universal de comex/financeiro: um título a pagar (fornecedor, valor, vencimento) aprovado pela alçada é candidato a pagamento no prazo — evita multa/juros"
---

# TituloAPagar (carteira de pagamento SISPAG — PERSISTIDA)

> **Carteira persistida** de títulos a pagar do ERP Conexos (Escopo II — SISPAG). Um título a
> pagar é uma obrigação financeira de importação (credor, valor, vencimento) que, uma vez
> **aprovada pela alçada de liberação**, é candidata a entrar no pagamento diário. Os **dados
> básicos** da carteira são **ingeridos e persistidos** por nós (`titulo_a_pagar`, migration 0024)
> numa cadência diária (cron + trigger manual), espelhando a ingestão de Permutas. O painel diário
> lê do **banco**; o **detalhe pesado de remessa** (banco/conta/modalidade/barras/PIX/CNPJ) continua
> lido **AO VIVO no envio** (Fatia 3, anti-drift). É o insumo do painel e da montagem de lote.

## Definição de domínio

Um `TituloAPagar` é a unidade da **carteira de pagamentos** do ERP: o que a trading deve a um
fornecedor/credor, com um valor e um vencimento. A operação SISPAG existe para que **nenhum título
aprovado deixe de sair no prazo** (evitar multa/juros). O painel expõe a janela relevante (a vencer +
vencidos, com aging); a analista monta o lote a partir dos títulos **aprovados e não pagos**.

Esta entidade **lê e persiste** os dados básicos da carteira; **não modifica** o título no ERP (I1 —
read-only no Conexos). A única escrita é no **banco próprio** (Postgres). A baixa/remessa efetiva
segue fora de escopo (ver ADR-0015 e ADR-0016 — a Fatia de transporte).

## Persistência (ADR-0016 — mudança nesta fatia)

- **Antes (ADR-0015, spike):** read model *read-through*, **não persistido** — o painel lia a
  carteira ao vivo do Conexos a cada request.
- **Agora (ADR-0016):** os **dados básicos** são **persistidos** em `titulo_a_pagar` (migration
  0024), chave natural `(fil_cod, doc_cod, tit_cod)`, atualizados por **UPSERT** a cada ingestão. O
  painel passa a ler do banco (rápido, estável, com auditoria de cadência). O **detalhe de remessa**
  permanece **live no envio** (anti-drift) — não é persistido aqui.
- A ingestão (cron `job:ingest-pagamentos` + manual `POST /sispag/ingestao`) é a ação
  [`ingerirPagamentos`](../actions/sispag/ingerir-pagamentos.md); cada rodada grava uma run de
  auditoria em `pagamento_ingestao_run`.

## Propriedades

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `docCod` | string | `fin064`/`com298.docCod` → `doc_cod` | Documento a-pagar. Parte da chave natural `filCod:docCod:titCod`. |
| `titCod` | string | `fin064`/`com308` → `tit_cod` | Código do título dentro do documento (um doc pode ter N títulos/parcelas). |
| `filCod` | number | `fin064` → `fil_cod` | **Invariante multi-filial** — filial que originou o título. Chave do agrupamento de lote (I4). Nunca `null`. |
| `credor` | string? | `fin064` → nome do fornecedor/credor | Exibição. A quem se paga. |
| `pesCod` | string? | `fin064`/`imp021` → `pes_cod` | Código da pessoa (fornecedor/credor). Roteamento/identidade. |
| `valor` | number? | `fin064`/`com308` → `titMnyValor` (ou saldo a pagar) | Valor do título (moeda em `moeda`). Snapshot no `ItemLote` no momento da inclusão. |
| `moeda` | string? | `com298.moeEspSigla` | Moeda do título. |
| `vencimento` | Date? | `fin064`/`com308` → `titDtaVencimento` | Data de vencimento — base do aging e da janela do painel (−15d..+45d). |
| `aprovado` | boolean | derivado na ingestão: `titVld1libera ∧ titVld2libera ∧ titVld3libera` (`com308`, alçada) → `aprovado` | **"Aprovado para baixa"** — passou por **todos os níveis de alçada** que a Columbia usa. Gate de elegibilidade do lote (I2). **Persistido** (era o derivado `liberado` no read model do ADR-0015). Ver `business-rules/elegibilidade-titulo-lote.md`. |
| `pago` | boolean | derivado: título já quitado (`vldPago`/baixa `fin010`) ou saldo = 0 → `pago` | Título já pago **não** entra no lote (I2). |
| `banco` | string? | `fin064` → banco/conta do título (`bncCod`/`ccoCod`) → `banco` | Banco/conta destino. **Metadado** nesta fatia (o agrupamento é por filial; ver ADR-0015). |
| `numRemessa` | string? | `fin064` → `titNumRemessa` → `num_remessa` | Nº da remessa quando o título já saiu (contexto). |
| `tpdCod` | string? | `com298` → `tpd_cod` | Tipo de documento. |
| `prontoParaRemessa` | boolean | **heurística** da ingestão (ver abaixo) → `pronto_para_remessa` | **INFORMATIVO** — tem modalidade + destino (banco/conta, barras ou PIX)? Palpite de completude. A **validação autoritativa** acontece **no envio, ao vivo** (Fatia 3). **Não** é gate de elegibilidade. |
| `temBoleto` | boolean | **flag de DDA** do grid de pendentes (`fin015` → `titVldReflexoDdaAssoc`) → `tem_boleto` | O Conexos tem um **boleto DDA** (`fin124`) casado com este título. É o único vínculo pagamento↔boleto que existe — o código de barras **não está no título**. Alimenta a coluna "Boleto" do painel e habilita a modalidade BOLETO. Ver ADR-0040. |

> **`internacional` REMOVIDO (ADR-0021, 2026-07-18).** O SISPAG é **doméstico**: pagamento ao exterior é
> **câmbio manual da tesouraria** (Itaú→BB), não passa pelo SISPAG. Títulos internacionais são
> **filtrados na ingestão** (`com298.ufEspSigla='EX'`) e **nunca entram** na carteira — logo não há mais
> classe/coluna `internacional`. Ver "Internacional fora do escopo" abaixo e a migration
> `0030_remove_internacional.sql`.
| `ativo` | boolean | anti-fantasma: título fora da run mais recente → `ativo=false` | Título que **some** da run de ingestão mais recente é marcado **inativo** (some do painel). Ver "Anti-fantasma". |
| `ingestaoRunId` | string? (UUID) | FK → `pagamento_ingestao_run.id` | A run que gravou/atualizou este título (auditoria de cadência). |
| `atualizadoEm` | Date | `atualizado_em` (UPSERT) | Quando o registro foi atualizado pela última vez. |

## `aprovado` (aprovado pela alçada) — evidência

- A aprovação para pagamento **não** é um único campo: são as flags de **alçada de liberação**
  `titVld1libera` / `titVld2libera` / `titVld3libera` (`com308`), com
  `titTim*libera`/`titUsn*libera` registrando **quando/quem** em cada nível. Governadas por `fin102`
  (bloqueio), `fin103` (liberação), `fin106` (alçadas), `fin007/liberar`.
- **Quantos níveis a Columbia usa de fato** é pergunta operacional aberta (Flávia). A ingestão
  computa `aprovado` como o **AND das flags presentes** e **persiste** o booleano — recalibrável por
  tenant/config sem mudar a estrutura.
- Downstream (não modelado aqui): `titVldEnviaBanco` / `titDtaEnvioBanco` / `titVldRetBanco` /
  `titNumRemessa` / `vldBordero` rastreiam remessa→envio→retorno→baixa (Fatia de transporte).

## `temBoleto` — vem do DDA, NÃO do `titEspCodbar` (ADR-0040)

- **Era** `Boolean(fin064.titEspCodbar)`. Medido em produção (2026-08-27): `titEspCodbar` é
  **null em 100%** dos títulos — 0 de 2000 no `fin064`, 0 de 2173 no grid de pendentes do
  `fin015`, 0 de 50 no `com308`. A auto-detecção de boleto **nunca disparou**.
- **É** o flag `titVldReflexoDdaAssoc` do grid de pendentes: o ERP sinaliza ali quais títulos ele
  casou com um boleto do arquivo DDA (`fin124`). Medido em PRD: 54/173 (fil 1), 136/500 (fil 2),
  24/500 (fil 4), 152/500 (fil 6).
- **Quem preenche:** a ingestão (`ConexosSispagWriteClient.listarTitulosComBoletoDda`), por
  filial. O grid exige um `flpCod`, então usa-se o **lote nativo mais recente da conta apenas
  como contexto de leitura** — ele não é modificado, e o grid lista os pendentes da filial
  inteira. Filial sem lote nenhum degrada para `false` com `BUSINESS_WARN`.
- **O código de barras em si não é persistido** (nem existe do nosso lado). Quem o anexa ao item
  é o ERP, no import, quando pedimos a associação. Ver ADR-0040 e
  `business-rules/boleto-exige-codigo-de-barras.md`.

## `prontoParaRemessa` — heurística INFORMATIVA (não-autoritativa)

- Calculado na ingestão como um **palpite** de completude: o título tem os elementos mínimos para
  virar uma linha de remessa (modalidade + destino: banco/conta, código de barras ou PIX)?
- É **informativo** — serve para dar visibilidade ("provavelmente pronto" vs "falta dado") no painel.
  **Não** decide elegibilidade de lote (isso é `aprovado + não pago`, I2) e **não** substitui a
  validação de envio.
- A **validação autoritativa** do que pode virar remessa acontece **na Fatia de transporte, ao vivo
  no envio**, com o detalhe completo lido do ERP no momento — evita drift entre o palpite persistido
  e a realidade do ERP na hora de gerar o arquivo.

## Internacional fora do escopo (ADR-0021) — filtro-out na ingestão

- O SISPAG (Frente II) é **doméstico** por natureza: cuida de boleto/PIX/TED nacional (CNAB via
  `fin015`). **Pagamento ao exterior é câmbio** (contrato de câmbio + SWIFT em moeda estrangeira,
  módulos `log009`/`imp*` do Comércio Exterior), feito **manualmente pela tesouraria** (Itaú→BB) — **não
  passa pela remessa SISPAG**.
- Por isso um título internacional **nunca entra** na carteira `TituloAPagar`: na ingestão,
  `ConexosSispagClient.listExteriorDocCods(filCod)` (`com298`, `ufEspSigla='EX'`, READ-ONLY) é usado como
  **filtro-out** — os docs do exterior são **excluídos** da carteira, não marcados com um booleano.
- Consequência (ADR-0021, supersede ADR-0017): a propriedade/coluna `internacional` foi **removida** de
  `TituloAPagar` e `ItemLote`; o invariante **I7** (lote uniforme nacional × internacional), o erro
  `LoteTipoConflitoError` e o método autoritativo `isDocInternacional` foram **aposentados**. A migration
  `0030_remove_internacional.sql` purga o legado internacional já ingerido e dropa as colunas (reverte a
  migration 0025 do ADR-0017). A automação do câmbio, se for feita, é uma **frente futura separada**.
  READ-ONLY no ERP (I1) mantido.

## Anti-fantasma (`ativo`)

- A carteira do ERP muda entre rodadas: um título pago/cancelado/removido **desaparece** da leitura.
- A ingestão faz **UPSERT** dos títulos da run atual e, ao final, chama
  `TituloAPagarRepository.marcarInativosForaDaRun(runId)` — todo título cuja última run **não** é a
  atual vira `ativo = false` e **some do painel** (`listAtivos` filtra `ativo = true`).
- Evita "títulos-fantasma" (linhas obsoletas que persistiriam para sempre). Espelha a doutrina de
  snapshot/stale de Permutas.

## Fonte e persistência

- **Leitura (READ-ONLY no Conexos, I1):** `ConexosSispagClient.listTitulosAPagar(...)` (`mapTitulo`
  compartilhado; `prontoParaRemessa` heurístico; `pesCod`/`tpdCod`) — carteira `fin064` enriquecida
  com alçada `com308`. Nenhuma escrita no ERP.
- **Escrita (LOCAL):** `TituloAPagarRepository.upsertMany` + `marcarInativosForaDaRun` +
  `listAtivos`; `PagamentoIngestaoRunRepository` grava a run de auditoria. Toda a mutação é no
  Postgres próprio.

## Fora de escopo (esta fatia)

- Nenhuma escrita no ERP. O título nunca é liberado/baixado/enviado por nós aqui — isso é a Fatia de
  transporte (`fin015` gerar remessa / `fin052` retorno / `fin010` baixa), gated como em Permutas.
  Ver ADR-0015 e ADR-0016.
- O **detalhe de remessa** não é persistido (anti-drift) — lido ao vivo só no envio.
