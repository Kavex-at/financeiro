---
name: BoletoDda
type: entity
ontology_version: "0.29"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0062_boleto_dda.sql
  - src/backend/domain/interface/sispag/BoletoDda.ts
  - src/backend/domain/client/ConexosDdaClient.ts
  - src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts
  - src/backend/domain/repository/sispag/BoletoDdaRepository.ts
  - src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts
  - src/backend/domain/service/sispag/BoletoDdaService.ts
  - src/backend/routes/sispag.ts
  - src/backend/jobs/ingest-boletos-dda.ts
  - src/frontend/app/sispag/components/BoletosDdaTab.tsx
properties:
  - ddcCod
  - ditCod
  - numero
  - valor
  - vencimento
  - codbar
  - linhaDigitavel
  - bancoEmissor
  - filCod
  - docCod
  - titCod
  - flpCod
  - situacao
  - candidatos
relationships:
  - "BoletoDda N—1 ArquivoDda (via ddcCod — o arquivo DDA do banco importado no fin124)"
  - "BoletoDda 0..1—1 TituloAPagar (via filCod/docCod/titCod — vínculo gravado PELO CONEXOS na associação do fin015; nunca por nós)"
  - "BoletoDda 0..N—0..N TituloAPagar (candidatos — SUGESTÃO calculada, não persistida: mesmo valor, vencimento a ±3 dias)"
last_review: 2026-09-24
universality_evidence:
  - "ontology/_inbox/sispag-boleto-dda-sondagem.md — pool fin124 medido em PRD: 100% dos itens com barras de 44 dígitos, ~0% com vínculo"
  - "ontology/_inbox/sispag-boleto-dda-tab.md — casos PEDRONI 34697/1 e ADP 5046/1 (2026-09-23): boleto 1 dia depois do título, Conexos não associou"
  - "Conceito universal de pagamentos no Brasil: DDA (Débito Direto Autorizado) entrega ao pagador os boletos registrados contra o seu CNPJ"
---

# BoletoDda (pool de boletos DDA do `fin124` — snapshot local)

> Boleto registrado contra a Columbia no **DDA** do banco pagador e importado no Conexos pela tela
> **`fin124` — Importação de Arquivo DDA**. É de onde vem o código de barras que o segmento J da
> remessa SISPAG precisa: o título (`fin064`) não tem barras próprias.

## O que é e o que não é

- **É** uma cópia local, somente leitura, do pool `fin124` (tabelas `boleto_dda_arquivo` e
  `boleto_dda`, migration 0062), para a aba **"Boletos DDA (fin124)"** do SISPAG.
- **Não é** o vínculo boleto↔título. Esse vínculo é do **Conexos**: ele o grava no item do fin124
  quando o fin015 importa o título com `titVldReflexoDdaAssoc = 1`. Nós só o lemos.
- **Não é** documento que emitimos. Nenhuma escrita no fin124 (`importar`/`cancelar` não são usados).

## Pool global

O pool é da **conta pagadora**, não da filial: o header `Cnx-filCod` não o escopa. Um boleto só
ganha filial quando é vinculado (ou, na aba, pelo candidato único).

## Situação (derivada, não persistida)

| Situação | Regra |
|---|---|
| `VINCULADO` | O Conexos preencheu `docCod`/`titCod` no item do fin124. |
| `CANDIDATO` | Livre, e **um** título aberto tem o mesmo valor (ao centavo) com vencimento a ±3 dias. |
| `AMBIGUO` | Livre, e **mais de um** título casa. Típico de cobrança recorrente de mesmo valor. |
| `SEM_TITULO` | Livre, e nenhum título aberto casa. |

Invariantes:

- **I-DDA1 — candidato é sugestão.** Nunca é gravado nem enviado ao Conexos. Casar por valor não
  é confiável (a PEDRONI tem ~18 boletos de R$ 1.412,00 no pool).
- **I-DDA2 — título vinculado sai da disputa.** Título que o Conexos já ligou a um boleto não é
  candidato de nenhum outro.
- **I-DDA3 — diferença de vencimento é exposta.** `diferencaDias` = vencimento do boleto −
  vencimento do título. Os dois casos medidos em 2026-09-23 tinham +1 dia, e o Conexos não associou
  nenhum dos dois (hipótese: exige vencimento idêntico — não confirmada).

## Sincronização

Manual (botão "Atualizar DDA", admin) ou job `npm run job:ingest-boletos-dda`. Incremental:
arquivos novos + releitura dos importados nos últimos 60 dias (é neles que o Conexos ainda grava
vínculo). Sem agendamento por decisão de 2026-09-24.

## Acesso

`GET /sispag/boletos-dda` e `POST /sispag/boletos-dda/sincronizar` exigem `admin`: o código de
barras carrega banco, agência e conta do cedente (mesmo guard das linhas digitáveis do lote).
