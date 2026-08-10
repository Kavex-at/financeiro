---
name: conexos-com299-gerdoc
type: integration
direction: read-write (READ: listagem de SNs por processo, com299/list — HAR-confirmado; WRITE REAL na trilha recebimentos — gated CONEXOS_WRITE_ENABLED + CONEXOS_DRY_RUN, default dry-run)
ontology_version: "0.13"
implementation_status: implemented
status: stable
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/service/recebimentos/SnPayloadBuilder.ts
  - src/backend/domain/client/ConexosGerDocProcessoClient.ts
  - src/backend/domain/client/ConexosNdeFiscalClient.ts
  - src/backend/domain/interface/recebimentos/GerDocProcesso.ts
  - src/backend/domain/interface/recebimentos/constants.ts
  - src/backend/routes/recebimentos.ts
endpoints_read:
  - "com299/list (POST /api/com299/list — LISTAR as SNs de um processo; filterList={priCod#EQ, docVldTipo#EQ:9, docVldTipoAdto#EQ:1, vldStatus#IN:['1','3']}, ordenado docCod desc, paginado; envelope {count,pageNumber,rows[]}; rows[].docCod/docEspNumero/docDtaEmissao/tpdDesNome|gcdDesNome/gcdCod/vldStatus/mnyBruto/docMnyValor. Discriminador SN = docVldTipo=9 AND docVldTipoAdto=1 (NC/ND é docVldTipoAdto=0 → excluída). Alimenta o ramo 'SN existente' de gerarSolicitacaoNumerario (ADR-0027) E a 1ª rota de resolução do gcd no gate 3 — o gcdCod da SN mais recente do processo (ADR-0034). HAR-confirmado 2026-08-03; gcdCod confirmado 2026-08-10)"
endpoints_write:
  - "com299 (POST /api/com299 + comDocProdutos + calculaValorLiquidoDocumento + finalizaDocumento — Solicitação de Numerário; REAL gated)"
  - "com299 PUT (condição de pagamento do cadastro da pessoa) — CONDICIONAL: só sob validação BLOQUEANTE da com194 (fdvVldErr===2) e sempre verificado (mnyTitValor === docMnyValor). Ver banner 'CICLO DE VIDA DO TÍTULO' + ADR-0025."
  - "fin014 (POST /api/fin014 borderô + baixas/validacao/tituloBaixa + baixas + finalizar/{borCod} — baixa do crédito; conta = transacao.gerNum)"
last_review: 2026-08-10
open-gap:
  - "gcdCod-por-filial-nao-mapeado (P1, ADR-0034) — o gcd da SN é resolvido em runtime (histórico do processo → SN_GCD_COD_BY_FIL → nome), então NÃO depende mais de um código fixo. Confirmados: filial 1/2 → 150 (ENCOMENDA) / 151 (TERCEIROS); filial 4 → 185 (ADIANTAMENTO DE CLIENTES). As demais filiais NÃO foram sondadas: um processo SEM histórico de SN numa filial sem entrada no mapa e sem config com nome de SN fica BLOCKED_ELEGIBILIDADE (fail-closed, por decisão). Sondar e cadastrar sob demanda."
  - "sn-list-saldo-document-level (P1, ADR-0027) — com299/list é DOCUMENT-level: devolve mnyBruto (solicitado) e docMnyValor (valor do doc), mas NÃO o saldo REMANESCENTE por-título. O 'Saldo' do mockup e o TETO do I-Receb-3 vêm da leitura do título (lov/TituloBorderoReceber) que a baixa fin014 já executa — o enforcement do teto ≤ saldo é a baixa/título, não o valor da lista. A lista NÃO deve ser usada como fonte do saldo."
  - "encomenda-percentuais (P1, §7 Q4) — a regra de % da encomenda (0,1%/0,9%) é NÃO-RESOLVIDA; a SN usa o valor cru da transação por ora."
  - "gerdoc-payload-fields (P1) — campos de rateio (items[] TmpCom068DTOItem: prjCod/ctpCod/tpcCod/cfoEspCod) e docTip/docVldTipo precisam de confirmação no HAR real."
  - "regeneracao-parcelas-com032 (P2, ADR-0025) — se algum cliente real cair no caso BLOQUEANTE e o PUT da condição destruir as parcelas, a etapa falha fechada; regenerar as parcelas exigiria a tela com032 ('Financeiro'), cujo HAR NÃO foi capturado. Deliberadamente não implementado."
  - "divergencia-hml-producao-pgtCod (P2) — em produção (SN 18345) o PUT da condição NÃO destruiu as parcelas; no HML destrói. Causa provável: a condição de produção tem regra de parcelamento, a 101 do HML não. Não confirmado."
---

> ## ⚠️ CORREÇÃO DE CONTRATO (HAR-confirmado 2026-07-30 — prod filial 2, doc 18202; `/home/inteli/com299/`)
>
> **`gerDocProcesso` NÃO EXISTE nesta versão do Conexos.** com299 é **REST CRUD genérico** — a criação de
> uma SN é **multi-call**, não um único save-handler. Este doc (endpoints_write acima) está OBSOLETO; a
> sequência real é:
>
> 1. `POST /api/com299` — cria o **cabeçalho** (finDoc). ACL `checkInsert(view:"com299")`. Retorna `docCod`.
> 2. `POST /api/com299/comDocProdutos` — cria a(s) **linha(s) de rateio** (o rateio vive na LINHA, não no
>    cabeçalho). PUT/DELETE por `.../{docCod}/{prdCod}/{dprCodSeq}`.
> 3. `GET /api/com299/calculaValorLiquidoDocumento/{docCod}` — o **servidor** soma o líquido das linhas e
>    sobrescreve `docMnyValor` (`finDocOverwrite`). Não há % de encomenda client-side.
> 4. `POST /api/com299/finalizaDocumento/{docCod}` — finaliza. ACL action `FINALIZAR DOCUMENTO`.
>
> **Valores reais (era placeholder):** `gcdCod=150` ("SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA"); `docTip=1`;
> `docVldTipo=9` (`docVldTipoAdto=1`); `moeCod=null` (BRL implícito — a suposição 790 não vale); `tpdCod=3`,
> `gerNum=210`, `pgtCod=1`, `espSerie="SN"`, `vldTpNf="00"`.
>
> **Rateio (linha `comDocProdutos`, PROCESSO-derivado — varia por doc):** `prjCod`, `ctpCod`(+`ctpEspConta`),
> `tpcCod`, `cfoEspCod`, `ccuCod`, `prdCod`, `undCod`, `ungCod`. Amostra 18202: `prjCod=1, ctpCod=690
> (ADIANTAMENTO DE CLIENTE ENCOMENDA / 330037), tpcCod=107, cfoEspCod=9999A2, ccuCod=30, prdCod=2, undCod=3,
> ungCod=4`. Header `docMnyValor == Σ dprPreTotalLiquido` (linha única 100%).
>
> **Sucesso ≠ HTTP 200:** validações in-band via `docVldComvalidacoes` (1=ok, 2=aviso, else=erro). Handle de
> reconciliação = **`docCod`** (create redireciona `cadastro/{docCod}`).
>
> **Validações prévias (todas `.../validate/...`):** `processo`, `data`, `pessoa`, `gerNum`,
> `endDocFederal`; `comDocProdutos/validaCfopProduto`; `validaDocFederalAmazonas`. Pickers: psq018/psq027.
>
> **ACL (view `com299`):** `checkInsert`/`checkUpdate`/`checkDelete` + actions `FINALIZAR DOCUMENTO` /
> `ESTORNAR DOCUMENTO`. A conta-robô precisa de **create + edit** (e finalizar/estornar p/ fechar docs).
>
> **Gaps que restam:** (a) FONTE dos códigos de rateio por-processo (são process-derived — de onde vêm?);
> (b) serialização exata do create body (interceptor do runbook, passo 7). Ver `FINDINGS.md`.
>
> **% da encomenda RESOLVE-SE** a "lançar as linhas de rateio, servidor totaliza" — não é cálculo client-side.
> O guard `ENCOMENDA_PERCENTUAIS_RESOLVED` deve ser reenquadrado como "fonte dos códigos de rateio confirmada".

# Integração: Conexos com299 — Solicitação de Numerário (+ baixa fin014)

> ## ✅ ESCRITA REAL (v0.12, 2026-08-01) — a trilha recebimentos saiu do DRY-RUN
>
> O painel `/recebimentos` ("Alocar processos" → "Processar") **executa a escrita REAL** (gated
> `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`, default dry-run) via `RecebimentoNumerarioService`:
> gera a SN (com299) + **finaliza**, dá a **baixa `fin014`** (conta = `transacao.gerNum`, a conta
> do próprio pagamento), emite a nota de débito (com297 + produto 41978) e conclui a **cauda fiscal**
> (com300 → com131 → com297-homologar → poll SEFAZ — ver `integrations/conexos-nde-fiscal.md`).
> O antigo seam `SolicitacaoNumerarioService.enviarAoErp` (`NotImplementedError`) foi **RETIRADO**;
> o builder do payload é compartilhado (`SnPayloadBuilder`) entre a rota dry-run e o orquestrador.
> **Split-safe:** um pagamento gera 1..N SNs (uma por processo), Σ valor ≤ `transacao.valor`;
> idempotência `sn-real:{txnId}:{priCod}:{valor}`. Ver `actions/recebimentos/gerar-solicitacao-numerario.md`.
>
> A seção abaixo (redigida na iteração DRY-RUN) permanece como registro do contrato com299 e dos
> gaps de rateio; o gcdCod/rateio por-processo continuam instância/config do tenant.

> ## ⚠️ CORREÇÃO DE CONTRATO (execução REAL no HML, 2026-08-03 — SN nº 731, `docs/e2e/fase-b-resultado-hml.md`)
>
> **Vigência parcial:** os fatos 1/1b/2 abaixo continuam válidos, mas o passo da condição de pagamento que
> eles descrevem **deixou de ser incondicional e mudou de posição** no mesmo dia — ver o banner seguinte
> ("CICLO DE VIDA DO TÍTULO") e o ADR-0025. Leia os dois juntos.
>
> Dois fatos do ERP medidos numa escrita real, ambos com HTTP 200 enganoso:
>
> 1. **`lov/CondPgtoPessoa` IGNORA o filtro `pesCod`** — devolve a lista **GLOBAL** de condições,
>    **paginada** (`sortBy: pgtDesNome asc`). Consequência: "a primeira `pgtDesNome` que contenha
>    DUPLICATA" é a condição de **outro cliente** (o doc 731 do SKYJACK recebeu
>    `pgtCod 103 "BONDUELLE - DUPLICATA"`). O serviço casa `pgtDesNome` contra o `dpeNomPessoa` **do
>    documento** (prefixo em fronteira de token, os dois nomes vêm abreviados/truncados do ERP). Sem
>    condição do próprio cliente → **fail-closed** (não se grava a de terceiro num documento financeiro).
> 1b. **O ERP IGNORA também o `pageSize` que pedimos** (2ª rodada HML, mesmo dia, pesCod 232): body com
>    `pageSize: 500` → resposta `count: 86` com **50 linhas**. Ele impõe a própria página, então
>    **a paginação se guia pelo `count` do envelope**, nunca por "página menor que o pedido ⟹ acabou" —
>    esse critério parava na 1ª página e nunca chegava à 2ª, onde estava a
>    `101 "SKYJACK BRASIL - DUPLICATA"`. Para em página VAZIA, ao alcançar o `count`, ou no teto de páginas.
> 2. **Finalização: sucesso ⟺ `docVldFinalizado === 1` na RELEITURA.** `validate/finalizacaoDocumento`
>    e `finalizaDocumento` voltaram **200** e o documento ficou `docVldFinalizado: 0`, sem título
>    (`mnyTitValor: 0`) — o erro só apareceu uma etapa depois, no fin014, apontando para o lugar
>    errado. O `finalizarDocumento` relê o doc (`GET {tela}/{docCod}`) e falha-fechado na própria
>    etapa, com o `docCod` na mensagem — mesma doutrina de discriminador por-etapa da leg fiscal
>    (`integrations/conexos-nde-fiscal.md`).

> ## ⚠️ CICLO DE VIDA DO TÍTULO + SEQUÊNCIA VIGENTE DA SN (medido no HML 2026-08-03, docs 732–737)
>
> Fonte: `docs/e2e/gap-titulos-diagnostico.md` (medições passo a passo, `recebimentos.e2e.hmlTitulo*`).
> Decisão: **ADR-0025** (condicional + fail-closed). Este banner **emenda** o anterior.
>
> ### 1. O ciclo de vida do título a receber (o que o ERP faz sozinho)
>
> | Evento | Efeito MEDIDO no documento |
> |---|---|
> | `POST com299/gerDocProcesso` (geração) | **o título NASCE**, com o valor do header (`mnyTitValor == docMnyValor`) |
> | `POST com299/comDocProdutos` (linha de item) | **PRESERVA** o título; materializa `mnyBruto` (doc 735) |
> | `PUT com299` trocando `pgtCod` (condição) | **DESTRÓI as parcelas** (`mnyTitValor → 0`) e **NÃO as regenera** — nem reaplicando a MESMA condição. O PUT também recalcula `docMnyValor` a partir das linhas: aplicado ANTES do item, zerava junto o valor do documento (doc 734) |
> | `finalizaDocumento` **sem nenhum PUT de condição** | fecha: `docVldFinalizado: 1` e o título aparece em `lov/TituloBorderoReceber` — o LOV que a `etapaFin014` consulta (docs 736/737) |
>
> **Nenhuma tela extra materializa o título.** O diagnóstico anterior ("a automação nunca gera os títulos,
> falta a tela com032 Financeiro") estava **errado**: o ERP gera o título na geração; o que existia era um
> passo NOSSO que o destruía. O ERP **ignora** o `pgtCod` enviado no header da geração.
>
> ### 2. `vldRwCondpgt` NÃO é gatilho de regeneração — afirmação anterior INVÁLIDA
>
> `vldRwCondpgt: 1` **já vem no GET** do documento, ao lado de `vldRwPlanfin: 1` e `right: "RW"`: é **flag de
> permissão** (o campo é editável), **não** comando de reescrita das parcelas. Enviá-la no PUT não regenera
> coisa alguma. A receita registrada em `_inbox/com299-sn-generation-har.md` (seção "IMPLEMENTADO
> 2026-08-02", passo com `vldRwCondpgt:1`) está **superada** neste ponto.
>
> ### 3. Sequência VIGENTE da SN (com299), pós-geração
>
> 1. `POST com299/comDocProdutos` — **linha de item PRIMEIRO** (valor alocado; preserva o título).
> 2. `POST com194/documento/list` (`filterList: {docTip, docCod, fdvVldTperr: 1}`) — **o ERP** diz se exige a
>    condição do cadastro: validação **BLOQUEANTE** (`fdvVldErr === 2`) cujo texto menciona condição de
>    pagamento. Leitura **best-effort**: com194 indisponível ⇒ segue **sem** o PUT (não mexer no documento
>    íntegro), e a finalização continua sendo o discriminador seguinte.
> 3. **Só nesse caso:** `lov/CondPgtoPessoa` (paginado pelo `count` do envelope; casar `pgtDesNome` contra o
>    `dpeNomPessoa` DO DOCUMENTO; sem condição do próprio cliente ⇒ **fail-closed**) → `GET com299/{docCod}`
>    → `PUT com299` com `pgtCod`/`pgtDesNome`.
> 4. **Discriminador OBRIGATÓRIO do passo 3:** reler o documento e exigir `mnyTitValor === docMnyValor` (e
>    `> 0`). Se o PUT destruiu as parcelas, a etapa **falha aqui**, nomeando a causa — nunca se manda
>    finalizar um documento sem título (a finalização seria recusada com "O TOTAL DOS TÍTULOS … NÃO CONFERE"
>    e o `fin014` não acharia o que baixar). É o mesmo princípio de **discriminador próprio por etapa** da
>    leg fiscal (`integrations/conexos-nde-fiscal.md`): 200 nunca é sucesso.
> 5. `validate/finalizacaoDocumento` → `finalizaDocumento` → releitura `docVldFinalizado === 1`.
>
> ### 4. A exigência da condição "sugestiva" é POR-PESSOA (config do tenant, não invariante)
>
> Quem exige a condição sugerida é o **cadastro da pessoa**, não o tipo de documento: a pessoa 194 em
> produção exige ("L-FOUNDERS - DUPLICATA"); o SKYJACK (232) no HML **não tem nenhuma** e a com194 devolve
> `count: 0` — nem aviso. Por isso o passo **não pôde ser removido de vez** (quebraria clientes cujo cadastro
> a exige) e por isso quem decide é o ERP, não uma premissa nossa. Os VALORES (pessoa, `pgtCod`, nome da
> condição) são **dados do tenant** — não entram na ontologia.
>
> ### 5. Risco conhecido: HML ≠ produção neste ponto
>
> Em produção (SN 18345, ordem antiga) o PUT **não** destruiu as parcelas; no HML **destrói**. Hipótese mais
> provável: a condição de pagamento envolvida (a de produção tem regra de parcelamento; a `101` do HML,
> aparentemente não) — **não confirmado**. A correção não assume nenhum dos dois comportamentos: verifica o
> resultado e falha fechado.

## Listagem de SNs por processo — `com299/list` (READ, HAR-confirmado 2026-08-03, ADR-0027)

Antes de "Processar", a analista pode **reutilizar** uma SN **já existente** do processo em vez de mintar
uma nova (ação `listarSolicitacoesNumerario`). A leitura:

`POST /api/com299/list`, corpo `filterList = { "priCod#EQ": priCod, "docVldTipo#EQ": 9,
"docVldTipoAdto#EQ": 1, "vldStatus#IN": ["1","3"] }`, ordenado `docCod` desc, **paginado**. Envelope
`{ count, pageNumber, rows: [...] }`.

| Campo (UI) | `rows[]` | Papel |
|------------|----------|-------|
| `docCod` | `docCod` | handle da seleção (referência da SN escolhida na baixa) |
| `numero` | `docEspNumero` | nº humano (ex.: "26.0141") |
| `data` | `docDtaEmissao` | data de emissão (epoch ms) |
| `descricao` | `tpdDesNome` / `gcdDesNome` | descrição (ex.: "Frete internacional") |
| `status` | `vldStatus` (1/3) | rótulo Aberta / Parcial |
| `solicitado` | `mnyBruto` | valor solicitado da SN |
| (valor do doc) | `docMnyValor` | valor do documento |

- **Discriminador SN:** `docVldTipo=9` **E** `docVldTipoAdto=1`. Uma **NC/ND** no mesmo processo é
  `docVldTipoAdto=0` e por isso **excluída** — a analista só baixa contra uma SN, nunca contra uma nota.
- **⚠️ SALDO não vem daqui (document-level).** `com299/list` devolve o **valor do documento**
  (`mnyBruto`/`docMnyValor`), **não** o saldo remanescente por-título. O "Saldo" do mockup e o **teto do
  I-Receb-3** vêm da leitura do título (`lov/TituloBorderoReceber`) que a **baixa `fin014` já executa** —
  o **enforcement** do teto ≤ saldo é a baixa/título, não a lista. Ver
  `business-rules/alocacao-sn-existente.md`.

## Baixa fin014 (nova superfície — REAL)

Após a SN finalizada, a trilha recebimentos executa a baixa do crédito no `fin014`:
`POST /api/fin014` (borderô) → `baixas/validacao/tituloBaixa` (com o `docCod` da SN) → `POST
/api/fin014/baixas` (`postGenericOnce`) → `finalizar/{borCod}`. **Conta financeira = `transacao.gerNum`**
(a conta em que o pagamento entrou — derivada, não escolhida; `FIN014_CONTA_FINANCEIRA` NÃO é usado
nesta trilha). Progresso gravado na trilha estendida (`fin014_bor_cod`, etapa `fin014`/`fin014-done`).

## Endpoint (write — dry-run)

| Endpoint | Uso | Método | Posture |
|----------|-----|--------|---------|
| `com299/gerDocProcesso` | gerar Solicitação de Numerário (encomenda) a partir de um processo | `POST /api/com299/gerDocProcesso` | **DRY-RUN** — payload construído e devolvido; **nenhum POST** |

## Configuração de Documento (gcd)

> **O nome da config NÃO é contrato.** Ele varia por filial/tenant e **não pode** ser a chave de
> resolução — ver **ADR-0034**. O `gcdCod` é resolvido em runtime, nesta ordem, sempre **dentro** da
> lista `lov/ConfigDocProcesso` (a autoridade sobre o que o processo aceita):
> **1)** histórico de SNs do próprio processo (`com299/list` → `gcdCod`); **2)** mapa filial → gcd
> (`SN_GCD_COD_BY_FIL`); **3)** nome (`/SOLICITAÇÃO DE NUMERÁRIO/i`, desempate `SN_GCD_COD` → ENCOMENDA).

| Filial | `gcdCod` | `gcdDesNome` | Evidência |
|--------|----------|--------------|-----------|
| 1 / 2 | `150` | `SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA` | HAR 2026-08-02 (proc 3254) |
| 1 / 2 | `151` | `SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS` | probe 2026-08-03 (proc 3478) |
| **4** | **`185`** | **`ADIANTAMENTO DE CLIENTES`** | probe 2026-08-10 (proc 699; 7 SNs existentes) |

- ⚠️ **`gcd 150` NÃO é universal.** Na **filial 4** o `150` é
  `"IMPLANTAÇÃO DE SALDO FINANCEIRO - CLIENTES NACIONAIS ENCOMENDA"` — outro documento, e o nome dele
  casa `/ENCOMENDA/i`. Por isso o `SN_GCD_COD` global só desempata **entre configs já filtradas por nome
  de SN**, nunca sozinho: gerar com ele criaria o documento errado, de forma irreversível.
- Na filial 4 nenhuma das **29** configs que o processo 699 aceita contém "Solicitação de Numerário" —
  resolver por nome dava `0 de 29` e bloqueava um processo comprovadamente elegível.
- O `SN_GCD_COD` (env, hoje `150`) mantém o default `0` como sentinela "não confirmado".

## Payload — `GerDocProcessoSelectionDTOCab` (swagger)

Campos-chave (nomes de wire em português espelham o ERP — permitido por CLAUDE.md):

| Campo | Tipo | Origem (dry-run) |
|-------|------|------------------|
| `filCod` | int | filial do processo/transação |
| `docTip` / `docVldTipo` | str | `SN` (placeholder — confirmar no HAR) |
| `priCod` ("Processo") | int | processo escolhido |
| `priEspRefcliente` ("Referência Externa") | str | do processo |
| `pesCod` / `dpeNomPessoa` | int / str | cliente do processo |
| `gcdCod` / `gcdDesNome` | int / str | config "Solicitação de Numerário - Encomenda" (`gcdCod` placeholder) |
| `docDtaEmissao` / `dtaVencimento` | str | data de referência (now) |
| `valor` | number | **valor CRU da transação** (regra de % da encomenda não-resolvida) |
| `moeCod` | int | moeda do processo |
| `items[]` (`TmpCom068DTOItem`: `prjCod`, `ctpCod`, `tmpMnyValor`, `ctpDesNome`, `tpcCod`, `cfoEspCod`, `total`) | array | rateio — uma parcela com o total; códigos de rateio = 0 (placeholder, confirmar no HAR) |

## Posture DRY-RUN (por que não há write ao vivo)

- O `gcdCod` exato e vários campos do payload (rateio/docTip) ainda **não** foram confirmados por HAR
  real com credenciais de **homologação**. Enviar um documento com códigos placeholder ao ERP seria
  um efeito colateral irreversível com dados errados.
- Por isso `SolicitacaoNumerarioService.enviarAoErp` lança `NotImplementedError` — o caminho de
  escrita existe só como **seam** pronto para ser cabeado quando o contrato fechar (homologação-first,
  espelhando o gating dry-run de Permutas/`executarRecebimento`).

## Como sair do dry-run (próxima fatia)

1. Capturar um `gerDocProcesso` real no HAR (HML) → confirmar `gcdCod`, `docTip`/`docVldTipo` e os
   campos de rateio (`items[]`).
2. Resolver a regra de **percentuais da encomenda** (§7 Q4) → substituir o "valor cru" pelo cálculo.
3. Implementar `enviarAoErp` (reusar o handshake/write-ahead/dry-run gate do `ConexosBaixaClient`),
   atrás de um write-enabled + dry-run gate (homologação-first).
