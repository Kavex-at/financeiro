---
name: BoletoDda
type: entity
ontology_version: "0.53.0"
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
  - src/backend/migrations/0092_boleto_dda_conferencia.sql
  - src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts
  - src/backend/domain/service/sispag/PaginacaoBoletoDda.ts
  - src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts
  - src/backend/domain/errors/EmptyDdaFileError.ts
  - src/frontend/app/sispag/boletos-dda/filtrosBoletosDda.ts
  - src/frontend/app/sispag/boletos-dda/useTabelaBoletosDda.ts
  - src/frontend/app/sispag/boletos-dda/TabelaBoletosDda.tsx
  - src/frontend/app/sispag/boletos-dda/FiltroSituacaoDdaBarra.tsx
  - src/frontend/app/sispag/boletos-dda/FaixaBoletosHoje.tsx
  - src/frontend/app/sispag/components/CardsBoletosDda.tsx
  - src/backend/domain/libs/calendar/JanelaCarteira.ts
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
  - "BoletoDda 0..N—N DecisaoSugestaoBoleto (snapshot por ddcCod/ditCod; decisão humana registrada, ADR-0068, implemented)"
  - "BoletoDda 0..1—0..N GrupoBoleto (boleto que paga N títulos do mesmo credor; no máximo um grupo CONFIRMADO por boleto; ADR-0077, implemented)"
last_review: 2026-10-30
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
ganha filial quando é vinculado. Na aba, a **filial de exibição** é a do vínculo; sem vínculo, a
filial comum a **todos** os candidatos (um ou vários); sem isso, o boleto é **"sem filial"**.

- **I-DDA5 — filtro de filial não deixa passar boleto sem filial** (v0.53.0, feature
  `sispag-dda-paridade`, aprovado por Yuri em 2026-10-30). Filtrar por uma ou mais filiais mostra e
  conta só boletos daquelas filiais; "sem filial" é uma opção própria do filtro, com total. (Antes da
  v0.53.0 o boleto sem filial passava em qualquer filtro e inflava a contagem de cada filial.) A
  filial de exibição é derivada, não persistida, e não altera I-DDA1/I-DDA2.

## Situação (derivada, não persistida)

| Situação | Regra |
|---|---|
| `VINCULADO` | O Conexos preencheu `docCod`/`titCod` no item do fin124. |
| `CANDIDATO` | Livre, e **um** título aberto cai nas camadas de I15c (\|Δvalor\| ≤ R$ 0,05 e mesmo dia; ou valor igual e 1–5 dias depois), sem estar reservado por título que o ERP já sinalizou (I15e). **Regra vigente desde a v0.66.0 (ADR-0068):** os limites vêm de `business-rules/sugestao-boleto-dda-sispag.md`; a janela "valor exato ±3 dias" (`JANELA_CANDIDATO_DIAS`) deixou de ser a regra (ela inclui dias ANTES do título, que são vencidos — I15h). |
| `AMBIGUO` | Livre, e **mais de um** título casa. Típico de cobrança recorrente de mesmo valor. |
| `FORA_JANELA` | Livre, sem candidato, e o vencimento cai fora da janela que a carteira carrega (hoje − 15 a hoje + 45 dias, `JANELA_CARTEIRA_DIAS_*`, a mesma da ingestão; data civil via `BankingCalendar`). O título nunca poderia estar na carteira — não é "sem título". `VINCULADO` ignora a janela. |
| `TITULO_SAIU_CARTEIRA` | Livre, sem candidato, dentro da janela, mas há título **inativo** (`ativo = false`: saiu do fin064) com \|Δvalor\| ≤ R$ 0,05 e \|Δdias\| ≤ 10. Em regra quitado, mas pode ser cancelado, previsão ou renegociado — o rótulo é "Título saiu da carteira", nunca "pago". Carrega o(s) título(s) (`titulosSaidos`). **Escondida da lista padrão ("Todas") e fora de `contagem.todas`**; só pelo filtro próprio. |
| `SEM_TITULO` | Livre, e nenhum título casa (nem aberto, nem saído, e dentro da janela). |

Precedência: `VINCULADO` > `CANDIDATO`/`AMBIGUO` > `FORA_JANELA` > `TITULO_SAIU_CARTEIRA` > `SEM_TITULO`.

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
- **I-DDA4 — a sugestão tem camadas e decisão humana registrada** (ADR-0068, I15, implemented em v0.66.0). Ver
  `business-rules/sugestao-boleto-dda-sispag.md`. I-DDA1 (candidato não é gravado) permanece:
  a sugestão é calculada; o que se persiste é a **decisão** (`DecisaoSugestaoBoleto`) e o **par**
  (`ConfirmacaoEmissorBoleto`), nunca o candidato. **Nota (ADR-0072, `planned`):** o pool (com `sincronizadoEm`) é a base do desfecho derivado `SEM_CANDIDATO` (I15m); defasagem > 8 h (ADR-0067) torna-o "sem candidato no pool de há N h", nunca afirmação absoluta. Desfecho não é persistido.

- **I-DDA8 — uma linha por código de barras.** O mesmo `codbar` aparece em vários arquivos do `fin124`.
  A consolidação colapsa as cópias em UMA linha (a que o Conexos vinculou; senão a do maior `ddcCod`,
  depois `ditCod`) e expõe `arquivos` (arquivos distintos em que apareceu). Sem `codbar` nunca
  colapsa. Contagens e chips contam linhas colapsadas. Medido na PRD de 30/10: 1.941 itens a vencer
  → 1.792 linhas. A decisão/grupo de sugestão é chaveada pelo representante (`ddcCod:ditCod`).

## Sincronização

Quatro gatilhos. Os três primeiros são a **passada completa** (arquivos novos + releitura dos
importados nos últimos 60 dias — é neles que o Conexos ainda grava vínculo):

- **Ingestão de pagamentos (ADR-0067)** — antes de ler os títulos, em toda rodada (cron 05:07, 07:07,
  12:13 e 16:13 BRT — emenda 2026-10-30 da ADR-0060 — e abertura da tela com carteira velha). Com prazo de 60 s; falha, lock ocupado e prazo estourado **não** derrubam
  a ingestão (`dda.estado`: `sincronizado`/`parcial`/`ocupada`/`falhou`).
- Botão "Atualizar DDA" (`sispag:executar`) — com o **mesmo prazo da ingestão** (60 s,
  `DDA_PRAZO_NA_INGESTAO_MS`; emenda 2026-10-30 da ADR-0067): o que está em voo termina, o resto fica
  para a próxima passada (`arquivosAdiados`). O resultado separa arquivos lidos, adiados e com falha.
- Job avulso `npm run job:ingest-boletos-dda` — carga completa, sem prazo.

O quarto é a **conferência rápida** (v0.53.0, feature `sispag-dda-paridade`, aprovada por Gabriel em
2026-10-30):

- **I-DDA6 — conferência rápida ao abrir a tela.** Com a carteira recente (a ADR-0060 não roda a
  ingestão), a abertura confere o `fin124` se a última conferência tem mais de
  `SISPAG_DDA_CONFERENCIA_MIN` (10 min): UMA listagem de arquivos comparada com `boleto_dda_arquivo`.
  Arquivo **novo** → lê e grava os itens. Arquivo **cancelado ou com status/nome trocado** → atualiza
  **só o cabeçalho**. Arquivo que sumiu da listagem → nada (nunca apaga; `warn`). Nada mudou → só
  registra `conferido_em`. Não relê arquivo conhecido: o vínculo que o Conexos grava num arquivo já
  importado **não** aparece aqui (a listagem não traz marca de alteração), só na passada completa.
  Mesmo advisory lock, mesmo prazo (60 s), mesmo teto de leituras e mesma sequência da abertura
  (ADR-0066 §3) da passada completa; falha da conferência nunca muda o estado da carteira.
- **Conferido em.** Toda listagem bem-sucedida do `fin124` (rápida ou completa) grava `conferido_em`
  (`boleto_dda_conferencia`, uma linha, migration 0092). Falha na listagem não grava.
- **I-DDA7 — o aviso "DDA parado" conta da última conferência.** Defasado = mais de 8 h, em dia útil,
  desde `conferido_em` (sem ela, desde o último arquivo gravado). Enquanto a abertura está conferindo
  ou ingerindo, a aba não avisa.

Supersede a decisão de 2026-09-24 ("sem cron"): o pool ficou 5 dias parado (08–13/10/2026) sem
ninguém ver.

**Lista vazia não apaga** (v0.53.0). Se o `fin124` devolve zero itens para um arquivo que tinha itens
no snapshot, o snapshot desse arquivo é mantido e a passada registra `warn` (conta como falha do
arquivo). Arquivo cancelado continua saindo pelo `cancelado_em`.

**Urgência na aba** (v0.53.0). "Vence hoje" e "vence em até 2 dias" usam o vencimento **do boleto**
como dia civil BRT (`BankingCalendar.todayBrt`, ADR-0070) e excluem `VINCULADO`. Faixas iguais às de
Títulos a pagar (`VENCIDO`/`HOJE`/`1-2`/`3-7`/`8+`).

**Não há beneficiário no item DDA** (sonda PRD 2026-10-13: 15 campos, nenhum nome/CNPJ do emissor).
O emissor só se deriva do código de barras (banco + agência + conta). `titulo_a_pagar.doc_esp_numero`
(0083) guarda o número do documento do fornecedor para confirmar casamentos — **sinal de apoio**
(I15f, nunca suficiente). Layout real da chave do emissor só para 341 e 237 (84 % dos casos
medidos); demais bancos usam chave genérica (I15i).

## Acesso

`GET /sispag/boletos-dda` é `sispag:ver` desde a ADR-0053 (era `admin`); `POST
/sispag/boletos-dda/sincronizar` é `sispag:executar`. O payload do GET carrega `linhaDigitavel`
**sem auditoria** — estado conhecido e aceito (emenda de 2026-10-14 à ADR-0068).

**Sugestão por título (ADR-0068, implemented):** `sispag:ver` vê a sugestão e copia a linha digitável
(sempre auditado); confirmar, rejeitar e revogar exigem `sispag:executar`.
