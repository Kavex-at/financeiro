---
name: BoletoDda
type: entity
ontology_version: "0.40.0"
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
  - src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  - src/backend/migrations/0083_titulo_doc_esp_numero.sql
  - src/frontend/app/sispag/components/BoletosDdaTab.tsx
  - src/frontend/app/sispag/components/ddaDefasado.ts
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
  - "BoletoDda 0..N—0..N TituloAPagar (candidatos — SUGESTÃO calculada, não persistida: regra em camadas I15c; só o que o ERP não associou)"
  - "BoletoDda 0..N—N DecisaoSugestaoBoleto (snapshot por ddcCod/ditCod; decisão humana registrada, ADR-0068, planned)"
last_review: 2026-10-14
universality_evidence:
  - "ontology/_inbox/sispag-boleto-dda-sondagem.md — pool fin124 medido em PRD: 100% dos itens com barras de 44 dígitos, ~0% com vínculo"
  - "ontology/_inbox/sispag-boleto-dda-tab.md — casos PEDRONI 34697/1 e ADP 5046/1 (2026-09-23): boleto 1 dia depois do título, Conexos não associou"
  - "Conceito universal de pagamentos no Brasil: DDA (Débito Direto Autorizado) entrega ao pagador os boletos registrados contra o seu CNPJ"
  - "ontology/_inbox/sispag-sugestao-boleto-dda-interview.md — medição PRD 2026-10-13: o ERP associa valor exato + dia exato, 0 divergências em ~250 associados; ~836 de ~1090 títulos BOLETO sem DDA"
---

# BoletoDda (pool de boletos DDA do `fin124` — snapshot local)

> **Aprovada em 2026-09-25** na revisão do PR #85 (feature `sispag-boletos-dda-tab`).

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
| `CANDIDATO` | Livre, e **um** título aberto cai nas camadas de I15c (\|Δvalor\| ≤ R$ 0,05 e mesmo dia; ou valor igual e 1–5 dias depois), sem estar reservado por título que o ERP já sinalizou (I15e). **Alvo da v0.40.0 (ADR-0068, planned):** os limites vêm de `business-rules/sugestao-boleto-dda-sispag.md`; a janela "valor exato ±3 dias" (`JANELA_CANDIDATO_DIAS`), ainda vigente no código, deixa de ser a regra (ela inclui dias ANTES do título, que são vencidos — I15h). **open_gap:** código ainda na janela antiga. |
| `AMBIGUO` | Livre, e **mais de um** título casa. Típico de cobrança recorrente de mesmo valor. |
| `SEM_TITULO` | Livre, e nenhum título aberto casa. |

Invariantes:

- **I-DDA1 — candidato é sugestão.** Nunca é gravado nem enviado ao Conexos. Casar por valor não
  é confiável (a PEDRONI tem ~18 boletos de R$ 1.412,00 no pool).
- **I-DDA2 — título vinculado sai da disputa.** Título que o Conexos já ligou a um boleto não é
  candidato de nenhum outro.
- **I-DDA3 — diferença de valor e de vencimento é exposta, com sinal.** `diferencaDias` = vencimento
  do boleto − vencimento do título; `diferencaValor` = valor do boleto − valor do título.
  **Fato medido (2026-10-13, PRD):** o ERP associa **valor exato e dia exato** — 0 divergências entre
  ~250 títulos com `titVldReflexoDdaAssoc = 1`. Os dois casos de 2026-09-23 (+1 dia: PEDRONI 34697/1,
  ADP 5046/1) não foram associados por isso. (Substitui a hipótese "exige vencimento idêntico — não
  confirmada".) Consequência: tudo o que sobra "sem DDA" é, por construção, o que o ERP **não**
  consegue associar (centavos, dias, conta emissora desconhecida) — é o território da sugestão.
- **I-DDA4 — a sugestão tem camadas e decisão humana registrada** (ADR-0068, I15, planned). Ver
  `business-rules/sugestao-boleto-dda-sispag.md`. I-DDA1 (candidato não é gravado) permanece:
  a sugestão é calculada; o que se persiste é a **decisão** (`DecisaoSugestaoBoleto`) e o **par**
  (`ConfirmacaoEmissorBoleto`), nunca o candidato.

## Sincronização

Três gatilhos, todos incrementais (arquivos novos + releitura dos importados nos últimos 60 dias —
é neles que o Conexos ainda grava vínculo):

- **Ingestão de pagamentos (ADR-0067)** — antes de ler os títulos, em toda rodada (cron 07h/12h/16h
  BRT e abertura da tela). Com prazo de 60 s; falha, lock ocupado e prazo estourado **não** derrubam
  a ingestão (`dda.estado`: `sincronizado`/`parcial`/`ocupada`/`falhou`).
- Botão "Atualizar DDA" (admin) — sem prazo.
- Job avulso `npm run job:ingest-boletos-dda` — carga completa, sem prazo.

Supersede a decisão de 2026-09-24 ("sem cron"): o pool ficou 5 dias parado (08–13/10/2026) sem
ninguém ver. A aba mostra aviso quando o pool está parado há mais de 8 h em dia útil.

**Não há beneficiário no item DDA** (sonda PRD 2026-10-13: 15 campos, nenhum nome/CNPJ do emissor).
O emissor só se deriva do código de barras (banco + agência + conta). `titulo_a_pagar.doc_esp_numero`
(0083) guarda o número do documento do fornecedor para confirmar casamentos — **sinal de apoio**
(I15f, nunca suficiente). Layout real da chave do emissor só para 341 e 237 (84 % dos casos
medidos); demais bancos usam chave genérica (I15i).

## Acesso

`GET /sispag/boletos-dda` é `sispag:ver` desde a ADR-0053 (era `admin`); `POST
/sispag/boletos-dda/sincronizar` segue como está no código. O payload do GET carrega `linhaDigitavel`
**sem auditoria** — estado conhecido e aceito (emenda de 2026-10-14 à ADR-0068).

**Sugestão por título (ADR-0068, planned):** `sispag:ver` vê a sugestão e copia a linha digitável
(sempre auditado); confirmar, rejeitar e revogar exigem `sispag:executar`.
