---
name: GrupoBoleto
type: entity
ontology_version: "0.48.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []   # a preencher pelo TaskScoper (migration 0089)
properties: [id, filCod, pesCod, credor, emissorChave, ddcCod, ditCod, numeroBoleto, codbarMascarado, valorBoleto, vencimentoBoleto, titulos, somaTitulos, origem, intercambiavel, avisosReconhecidos, confirmacaoEmissorId, estado, confirmadoPor, confirmadoEm, anuladoPor, anuladoEm, motivoAnulacao, pagoObservadoEm, versao, execucao]
relationships:
  - "GrupoBoleto 1—N(≥2) TituloAPagar (via GrupoBoletoTitulo: filCod/docCod/titCod + snapshot de valor líquido e vencimento)"
  - "GrupoBoleto N—1 BoletoDda (ddcCod/ditCod; snapshot, relido ao vivo na remessa)"
  - "GrupoBoleto N—0..1 ConfirmacaoEmissorBoleto (par (pesCod, emissorChave) VIGENTE ou confirmado no mesmo ato)"
  - "GrupoBoleto 1—0..N ItemLote (os N itens locais do lote, um por título, via ItemLote.grupoBoletoId)"
  - "GrupoBoleto 1—0..N borderô fin010 (externo; um por remessa em que o grupo entrou, ou o mesmo reaproveitado depois de J rejeitado; borCod no write-ahead)"
last_review: 2026-10-20
universality_evidence:
  - "Medição PRD 2026-10-19: ~220 casos de 1 boleto → N títulos, 40+ credores (memória boleto-agrupado-n1-e-1n-medicao)"
  - "HML 2026-10-19: o Conexos paga 1 boleto por N títulos nativamente (borderô fin010 em cadastro → 1 item SISPAG com borCod → retorno baixa os N) — _inbox/sispag-boleto-agrupado-hml-achados.md"
  - "Conceito universal: fatura/boleto consolidado de um fornecedor que quita várias obrigações; toda conciliação assistida guarda quem aprovou qual agrupamento"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante)"
---

# GrupoBoleto

> **Origem:** ADR-0077 (2026-10-20). Registro de que **uma pessoa** confirmou que **um** boleto DDA
> paga **N ≥ 2** títulos do mesmo credor, com soma exata ao centavo. É a unidade que entra no lote
> (N `ItemLote` ligados ao grupo) e que vira **um** item nativo no `fin015`, via borderô `fin010`.
> Code-facing: `GroupedBoleto`. Tabelas propostas: `sispag_grupo_boleto` + `sispag_grupo_boleto_titulo`
> (migration 0089). **Status: planned.** Regras: `business-rules/boleto-agrupado-sispag.md` (I21).

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `filCod` | number | Filial de **todos** os títulos (I21d). |
| `pesCod` · `credor` | number · string | Credor único (H3: um borderô = um favorecido). |
| `emissorChave` | string | Do código do boleto; par com `pesCod` (I15g). |
| `ddcCod` · `ditCod` · `numeroBoleto` · `codbarMascarado` | | Boleto do `fin124`. Linha completa nunca persistida (I17j). |
| `valorBoleto` · `vencimentoBoleto` | number · Date | Snapshot; data civil (UTC meia-noite). O `vencimentoBoleto` é a data que vale para a formação automática e para L6 (I21j). |
| `titulos[]` | `{ filCod, docCod, titCod, valorLiquido, vencimento }` | Snapshot na confirmação; relido ao vivo na remessa (I21b/c). |
| `somaTitulos` | number | Σ `valorLiquido`, em centavos igual a `valorBoleto` (I21b). |
| `origem` | `SUGERIDO \| MANUAL` | Sugestão do sistema confirmada, ou composição manual (I21e/I21g). |
| `intercambiavel` | boolean | Partição fixa entre títulos e boletos iguais (I21f). |
| `avisosReconhecidos` | lista | Ex.: `TITULO_VENCE_ANTES_DO_BOLETO` (composição manual, I21g). |
| `confirmacaoEmissorId` | string | Par usado ou criado no ato. |
| `estado` | `CONFIRMADO \| ANULADO \| PAGO` | Ver "Estados". |
| `confirmadoPor` · `confirmadoEm` | string · Date | `sispag:executar`; nunca `sistema`. |
| `anuladoPor` · `anuladoEm` · `motivoAnulacao` | | Preenchidos só em `ANULADO` (CHECK); motivo 10–500. |
| `pagoObservadoEm` | Date? | Sincronização que viu os N títulos pagos (I21r). |
| `versao` | number | Lock otimista. |
| `execucao` | derivado do write-ahead | `{ flpCod, borCod, gerNum, marcador, baixas[{titulo, bxaCodSeq}], etapa }` por remessa. Depois de J rejeitado, o `borCod` antigo fica registrado e é o que a próxima remessa reconhece para reaproveitar (I21s). Forma da tabela: TaskScoper. |

## Estados

| Estado | Entra por | Sai para |
|---|---|---|
| `CONFIRMADO` | `confirmarGrupoBoleto` | `ANULADO` (pessoa, ou cascata da revogação do par) · `PAGO` (sincronização) |
| `ANULADO` | `anularGrupoBoleto` | terminal |
| `PAGO` | `sincronizarStatus` com os N pagos no `fin064` | terminal |

**Situação derivada (não persistida, só exibição):** `DISPONIVEL` (confirmado, sem lote vivo) ·
`EM_LOTE` (N itens num lote `RASCUNHO`/`FINALIZADO`) · `EM_REMESSA` (lote `REMESSA_GERADA`) ·
`REJEITADO` (J rejeitado; o borderô antigo segue em cadastro no ERP; o grupo só volta a uma remessa depois
de a analista resolvê-lo, e a formação automática não o lota enquanto isso, I21r) · `RETIDO` (marca
`BloqueioDuplicidade` `GRUPO_BOLETO` ativa depois de uma retirada na remessa, I21p(3)) · `DIVERGENTE`
(parte paga, I21r) · `ORFAO` (I21u). Rejeição não é estado: segue P1-5(a), "volta a confirmado, sem lote".

## Invariantes aplicáveis

I21a–u (`boleto-agrupado-sispag`); I2/I3/I4 por título (emendados); I11 com consistência de grupo (I11i);
I16a (um código, um item nativo); I17d/e/f/i/j/m (vínculo da barra ao item de borderô, I17o).
