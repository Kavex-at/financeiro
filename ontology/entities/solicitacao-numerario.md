---
name: SolicitacaoNumerario
type: entity
ontology_version: "0.13"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/interface/permutas/SolicitacaoNumerario.ts
  - src/backend/domain/client/ConexosGerDocProcessoClient.ts
  - src/backend/domain/client/ConexosFin014Client.ts
  - src/backend/domain/interface/permutas/Fin014Recebimento.ts
  - src/backend/domain/errors/NumerarioGapError.ts
  - src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts
  - src/backend/domain/repository/permutas/NumerarioExecucaoRepository.ts
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/service/recebimentos/SnPayloadBuilder.ts
  - src/backend/domain/service/recebimentos/ContingenciaDecider.ts
  - src/backend/domain/client/ConexosNdeFiscalClient.ts
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/interface/recebimentos/NdeFiscal.ts
  - src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts
  - src/backend/migrations/0042_solicitacao_numerario_execucao_fiscal.sql
properties:
  - origem
  - adiantamentoDocCod
  - txnId
  - priCod
  - pesCod
  - filCod
  - gcdCod
  - valor
  - moeda
  - contaFinanceira
  - docCod
  - itens
  - ndDocCod
  - etapa
  - revisaoHumana
  - ndeAutorizado
relationships:
  - "SolicitacaoNumerario N—1 Adiantamento (permuta: gerada a partir do adiantamento processado; via adiantamentoDocCod)"
  - "SolicitacaoNumerario N—1 TransacaoBancaria (recebimento: gerada a partir de um pagamento alocado a um processo; via txnId — split-capable, 1..N alocações por pagamento)"
  - "SolicitacaoNumerario 1—1 documento ERP com299 (docCod retornado pelo gerDocProcesso)"
  - "SolicitacaoNumerario 1—N item de rateio (contasProj: prjCod × ctpCod × tpcCod × cfoEspCod)"
  - "SolicitacaoNumerario 1—1 NotaDebitoEletronica (recebimento: NDe com297 terminal, docCod=ndDocCod, homologada+autorizada na SEFAZ)"
  - "SolicitacaoNumerario N—1 Recebimento (recebimento: uma alocação pode SELECIONAR uma SN JÁ EXISTENTE do processo — reutiliza docCod em vez de gerar; a baixa fin014 + NDe correm contra ela; ADR-0027)"
last_review: 2026-08-03
universality_evidence:
  - "docs-contexto/03_ontologia_financeiro.md — Frente I (adiantamento ↔ invoice) + Frente IV (recebimentos)"
  - "Tela Conexos com068 'GERAÇÃO DE DOCUMENTOS' → documento gcdDesNome='SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA'"
  - "Engenharia reversa do bundle com068 + probes read-only (validaConfigDoc/contasProj) no tenant Columbia (2026-07-31, filCod=2/priCod=2768/pesCod=5010) — captura do body gerDocProcesso via interceptor bloqueante (nenhum documento criado)"
  - "HAR REAL de produção (Columbia, doc 18337, filCod=2, 2026-08-01) confirmando a cauda fiscal terminal (com300 fisVldTipoNfDebito=6 → com131 SINIEF → com297 homologar → poll SEFAZ vldAutorizado) — ver integrations/recebimentos-numerario-real-fiscal-spec.md"
  - "Conceito universal de comex: requisição de numerário vinculada a um processo de importação, gerada TANTO de um adiantamento (permuta) QUANTO de um pagamento de cliente alocado (recebimento)"
  - "HAR REAL (Columbia, 2026-08-03) da listagem de SNs por processo: POST /api/com299/list, filterList priCod#EQ + docVldTipo#EQ:9 + docVldTipoAdto#EQ:1 + vldStatus#IN:['1','3'], ordenado docCod desc — confirma que a SN de um processo é LISTÁVEL/SELECIONÁVEL, não só escrita (ADR-0027)"
---

# SolicitacaoNumerario (SN — ENCOMENDA)

> Documento de **requisição de numerário** gerado no ERP Conexos (tela `com068`,
> `com299/gerDocProcesso`) a partir de **DUAS origens**: (I) um `Adiantamento` de permuta
> sendo processado (Frente I); (II) um pagamento (`TransacaoBancaria`) de cliente **alocado
> a um processo** (Frente IV — recebimentos). Substitui a baixa `fin010` como efeito do
> botão **"Processar"** (decisão 2026-07-31).

## Definição de domínio

Uma `SolicitacaoNumerario` é o documento "SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA"
(`gcdCod=150`, `docTip=1`, `globalDocVldTipo=9`) criado no Conexos para um processo de
importação (`priCod`) e uma pessoa (`pesCod`). O rateio (`itens`) é servido pelo próprio
ERP (`contasProj/list`), não é constante.

## SN existente × nova (afordância de LEITURA — v0.13, ADR-0027)

Uma `SolicitacaoNumerario` deixa de ser um documento que o sistema só **escreve**: as SNs
**já existentes** de um processo são **listáveis** e **selecionáveis** pela analista. Ao alocar
um pagamento a um processo há duas rotas:

- **Criar novo SN** — fluxo completo inalterado (com299 gera + completa + finaliza → fin014 → com297).
- **Selecionar SN existente** — **NÃO** gera com299 nem completa o documento; referencia o `docCod`
  da SN escolhida e corre **apenas** a baixa `fin014` + a NDe `com297` contra ela. Ver o ramo em
  `actions/recebimentos/gerar-solicitacao-numerario.md` e o invariante em
  `business-rules/alocacao-sn-existente.md` (I-Receb-3).

### Projeção de leitura (por SN do processo — HAR-confirmado 2026-08-03)

`POST /api/com299/list` (mesma família/host do com299 de escrita), `filterList = { "priCod#EQ": priCod,
"docVldTipo#EQ": 9, "docVldTipoAdto#EQ": 1, "vldStatus#IN": ["1","3"] }`, ordenado por `docCod` desc,
paginado. **Discriminador SN:** `docVldTipo=9` **E** `docVldTipoAdto=1` — uma NC/ND no mesmo processo
é `docVldTipoAdto=0` e por isso **excluída**. Envelope `{ count, pageNumber, rows: [...] }`.

| Campo (UI) | Papel | Origem (wire) |
|------------|-------|---------------|
| `docCod` | chave interna do documento (handle da seleção) | `rows[].docCod` |
| `numero` | nº humano da SN (ex.: "26.0141") | `rows[].docEspNumero` |
| `data` | data de emissão | `rows[].docDtaEmissao` (epoch ms) |
| `descricao` | descrição (ex.: "Frete internacional") | `rows[].tpdDesNome` / `rows[].gcdDesNome` |
| `status` | Aberta / Parcial (/ quitada) | derivado de `rows[].vldStatus` (1/3) |
| `solicitado` | valor solicitado da SN | `rows[].mnyBruto` |
| (valor do doc) | valor do documento | `rows[].docMnyValor` |

> **⚠️ `com299/list` é DOCUMENT-level.** O **saldo remanescente por-título** — o "Saldo" do mockup e o
> **teto do I-Receb-3** — **NÃO** vem nesta resposta: ele vem da leitura do título no `fin014`
> (`lov/TituloBorderoReceber`) que a **própria baixa já executa**. A listagem mostra o **valor do
> documento** (`mnyBruto`/`docMnyValor`); o **ponto de enforcement** do teto ≤ saldo é a
> baixa/título, não o valor da lista. Ver `business-rules/alocacao-sn-existente.md`.
>
> **Valores** (rótulos de status, formato do `numero`, códigos `gcdCod`/tenant) são **instância/config
> do tenant** — só os campos abstratos entram na ontologia.

**Duas origens (`origem`):**
- **`adiantamento` (Frente I / permuta):** `valor` = `valorASerUsado` do adiantamento (moeda
  negociada, sem conversão). Uma SN por adiantamento; idempotência `numerario:{docCod}:{valor}`.
- **`recebimento` (Frente IV):** gerada de uma **alocação** de um pagamento a um processo.
  **Split-capable:** um pagamento gera **1..N** SNs (uma por processo), com **Σ valor ≤
  transacao.valor**. A conta da baixa `fin014` é a **conta do próprio pagamento**
  (`transacao.gerNum`), derivada — não escolhida. Idempotência `sn-real:{txnId}:{priCod}:{valor}`.
  Trilha terminal com a **NDe fiscal** (com297 homologada + autorizada na SEFAZ).

**Escrita irreversível:** o `POST com299/gerDocProcesso` cria um documento real e não é
idempotente — a geração é gated (`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`, default
dry-run) e protegida por trilha write-ahead (`NumerarioExecucaoRepository`), espelhando a
doutrina da baixa `fin010`.

## Propriedades

| Propriedade | Tipo | Imutável | Origem (wire) | Notas |
|-------------|------|----------|---------------|-------|
| `origem` | enum | sim | trilha (`adiantamento` \| `recebimento`) | Discrimina Frente I (permuta) × Frente IV (recebimento). Muda a fonte do `valor`, da conta e a chave de idempotência. |
| `adiantamentoDocCod` | string? | sim | request (`:docCod` da rota, origem permuta) | Adiantamento processado. Chave da idempotência na trilha permuta. |
| `txnId` | string? | sim | request (`:txnId` da rota, origem recebimento) | Pagamento (`TransacaoBancaria`) alocado. Parte da chave `sn-real:{txnId}:{priCod}:{valor}`. |
| `priCod` | number | sim | `Adiantamento.priCod` \| processo alocado | Processo de importação. Seed da derivação server-side. |
| `pesCod` | number | sim | processo/adiantamento | Pessoa do processo. |
| `filCod` | number | sim | processo/adiantamento | Filial (invariante multi-filial). Header `Cnx-filCod`. |
| `gcdCod` | number | sim | constante `150` (ENCOMENDA) | Tipo do documento. `validaConfigDocPessoa` retorna null p/ pessoa sem default → 150 é alvo deliberado, não derivado. |
| `valor` | number | não | request (permuta: `valorASerUsado`; recebimento: valor da alocação) | Valor da SN. Recebimento: split, Σ ≤ `transacao.valor`. |
| `moeda` | string? | não | moeda negociada / `moeCod` | Moeda negociada (ex.: USD). |
| `contaFinanceira` | number? | não | recebimento: `transacao.gerNum` | Conta da baixa `fin014`. Recebimento = a conta do PRÓPRIO pagamento (derivada). Permuta = `FIN014_CONTA_FINANCEIRA`. |
| `docCod` | number? | não | resposta `data.messages[i].vars.docCod` | Handle do ERP da SN. Ausente até a geração real (dry-run/erro). |
| `itens` | rateio[] | não | `com299/gerDoc/contasProj/list/{gcd}/{pes}/{end}` | Rateio server-supplied: `prjCod, ctpCod, tpcCod, cfoEspCod, total(%)`; `tmpMnyValor = round2(valor × total/100)`, Σ == valor. |
| `ndDocCod` | number? | não | com297 (recebimento) | docCod da nota de débito eletrônica terminal. |
| `etapa` | enum? | não | trilha (recebimento) | Progresso retomável: `sn\|sn-finalizar\|fin014\|fin014-done\|nota-debito\|fiscal-done\|obs-done\|homologado\|concluido\|error`. |
| `revisaoHumana` | boolean | não | homologação com297 (`docVldComvalidacoes===2`) | Homologado COM validações pendentes → revisão humana (erros via com194). |
| `ndeAutorizado` | boolean | não | poll SEFAZ com297 (`vldAutorizado`) | NDe autorizada pela SEFAZ (assíncrono; timeout ≠ erro). |

## Fonte de derivação (Conexos, read-only antes da escrita)

1. `com299/gerDoc/validaConfigDoc` (gcdCod=150) → `tpcCod`, `cfoEspCod`, `gcdVldFormaRateio`, `gcdVldTela`, `gcdVldPropria`, `fisEspSerie`.
2. `com299/gerDoc/contasProj/list/{gcd}/{pes}/{end}` → linhas de rateio (`itens`).
3. Header (`pdcDocFederal`, `endCodFis`, `priEspRefcliente`, `dpeNomPessoa`) — resolvido do adiantamento/processo (gap aberto: confirmar a chamada exata por probe HAR).

## Escrita (irreversível)

- `com299/gerDocProcesso/valida` (pré-cheque obrigatório; aborta em `messages[].valid==='ERRO'`).
- `com299/gerDocProcesso` (`postGenericOnce`, tentativa única) → `docCod`. **POST-once**: header + `itens[]` num só body.
- `200 ≠ sucesso`: validações de negócio chegam em `messages` (AVISO = gerado com aviso, ERRO = falha).

## Materialização do título a receber (medido no ERP — 2026-08-03, ADR-0025)

> Vigente na trilha **recebimentos** (Frente IV), onde a SN é completada antes de finalizar. A trilha
> permuta (Frente I) ainda gera+finaliza sem completação — herda estas regras quando/se for promovida.

O **título a receber da SN não é criado por nós**: nasce na própria **geração** do com299, com o valor do
header. A linha de item (`comDocProdutos`) o **preserva**; o `PUT com299` que troca a **condição de
pagamento** (`pgtCod`) **destrói as parcelas e não as regenera**. Consequências travadas:

1. A **linha de item vem antes** de qualquer ajuste de condição de pagamento.
2. O ajuste da condição é **condicional**: só quando a `com194` acusa validação **bloqueante**
   (`fdvVldErr === 2`) mencionando condição de pagamento — quem exige é o **cadastro da pessoa**
   (por-pessoa, dado do tenant), não o tipo de documento.
3. Se aplicado, o efeito é **verificado** (`mnyTitValor === docMnyValor`, `> 0`); divergência ⇒ a etapa
   **falha fechada** em vez de finalizar um documento sem título (o `fin014` não teria o que baixar).

Detalhe do contrato, medições e riscos (HML × produção) em
`integrations/conexos-com299-gerdoc.md` (banner "CICLO DE VIDA DO TÍTULO") e `docs/e2e/gap-titulos-diagnostico.md`.

## Fluxo de 3 telas — trilha PERMUTA (Frente I, guia "telas Conexos")

> A trilha **recebimento** (Frente IV) roda o MESMO encadeamento com a cauda fiscal já REAL —
> ver `actions/recebimentos/gerar-solicitacao-numerario.md`, `integrations/conexos-com299-gerdoc.md`
> e `integrations/conexos-nde-fiscal.md`. A seção abaixo descreve a trilha permuta (Tela 3 ainda
> GAP fail-closed nela).

O "Processar" (permuta) dispara um fluxo de 3 documentos no ERP (orquestrado por adiantamento, gated,
write-ahead + retomada anti-duplicação):

1. **Tela 1 — com299 (SN):** gera a SN (`gerDocProcesso`, datas/`docEspNumero`=data do dia) +
   **finaliza** (`validate/finalizacaoDocumento` → `finalizaDocumento`). **CONFIRMADO.**
   > A **completação** do documento antes de finalizar (linha de item → condição de pagamento
   > condicional → verificação do título) só existe hoje na trilha **recebimentos**
   > (`RecebimentoNumerarioService.completarSnAdiantamento`). A trilha permuta gera e finaliza direto —
   > se ela vier a materializar título/parcelas, herda as mesmas regras (ver "Materialização do título a
   > receber" abaixo e ADR-0025).
2. **Tela 2 — fin014 (recebimento do crédito):** borderô (`POST /api/fin014`, `gerNum`=conta FIN_134) →
   validar título (`baixas/validacao/tituloBaixa` com o `docCod` da SN) → gravar baixa
   (`POST /api/fin014/baixas`, `postGenericOnce`) → finalizar (`finalizar/{borCod}`). **REAL** (espelha
   fin010; `ConexosFin014Client`). Conta financeira = `FIN014_CONTA_FINANCEIRA` (fail-closed se ausente).
3. **Tela 3 — com297 (nota de débito):** resolve o gcd por nome ("NOTA DE DÉBITO ELETRÔNICA") →
   gera (`com297/gerDocProcesso`) → adiciona `Produto=41978` (`com297/comDocProdutos`). O restante —
   fiscal "Pagamento antecipado" + gerar observações + homologar (`enviaConferencia/homologaNfe`) —
   é **GAP fail-closed** (submenus "Mais Ações" ausentes do bundle; um HAR fecha).

Retomada anti-duplicação: SN/fin014/com297 já criados (`doc_cod`/`fin014_bor_cod`/`nd_doc_cod` na
trilha) NÃO são recriados — a re-execução avança para a etapa pendente. Dry-run monta/loga os payloads
das 3 telas para preview.

## Fora de escopo

- Não reconcilia a permuta (fin010) — Processar gera a SN (caminho novo) OU baixa contra
  uma SN existente selecionada (ADR-0027). O endpoint `/reconciliar` permanece no backend,
  apenas desligado da UI.
- Currency handling: a SN captada tinha `valor` em BRL (`moeCod=null`); usamos a moeda
  negociada por decisão — se o ERP recusar, revisitar `moeCod` (gap aberto).
- Telas 2 (fin014) e 3 (com297) **na trilha permutas**: estrutura + payloads previstos existem, mas
  as ESCRITAS seguem fail-closed até os HARs serem capturados (GAP). **Na trilha recebimentos (Frente
  IV, v0.12) essa cauda já é REAL e implementada** — fin014 (conta = `transacao.gerNum`) + com297
  (NDe + produto 41978) + fiscal com300 (`fisVldTipoNfDebito=6`) + observações SINIEF com131 +
  homologar com297 + poll SEFAZ. Ver `actions/recebimentos/gerar-solicitacao-numerario.md`,
  `integrations/conexos-nde-fiscal.md` e `integrations/recebimentos-numerario-real-fiscal-spec.md`.
  A promoção da trilha permutas para reusar essa cauda é follow-up.
