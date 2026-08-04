# com299 SN generation — REAL HAR (doc 18339, filial 2, prod, 2026-08-01)

The reverse-engineered payloads were wrong. The REAL two calls:

## 1. POST /api/com299/gerDocProcesso/valida  (WRAPPER, not the header)
Request body:
```json
{"items":[{"titVldPagopor":null,"gcdCod":150,"items":[{"prjCod":null,"ctpCod":null,"tmpMnyValor":null,"ctpDesNome":null,"tpcCod":null,"tpcDesNome":null,"cfoEspCod":null,"total":null}]}]}
```
Response: `{"messages":[{"valid":"SUCESSO"}]}`
→ valida takes `{items:[{titVldPagopor:null, gcdCod, items:[{one all-null rateio stub}]}]}`. NOT the flat header.

## 2. POST /api/com299/gerDocProcesso  (HEADER ONLY — NO `items` array)
Request body (doc value 100, priCod 3254, pesCod 194):
```json
{"docTip":1,"globalDocVldTipo":9,"frontModelName":"gerDocProcesso","priCod":3254,"priEspRefcliente":"0097LFL/26","endCodFis":2,"dpeNomPessoa":"L - FOUNDERS OF LOYALTY BRASIL MARK","pesCod":194,"gcdCod":150,"valor":100,"gcdVldTela":7,"gcdVldPropria":0,"fisEspSerie":null,"gcdVldFormaRateio":1,"tpcCod":null,"docDtaEmissao":1785542400000,"docDtaMovimento":1785542400000,"docEspNumero":"01082026","pdcDocFederal":"37032037000101","gcdDesNome":"SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA","tpcDesNome":null,"cfoEspCod":null}
```
Response: `{"messages":[{"valid":"SUCESSO","message":"COM_068.DOC_GERADO","vars":{"docCod":"18339"}}]}`

### Key differences vs our broken payload
- **NO `items` array** in gerDocProcesso (we wrongly sent rateio items). `tpcCod:null`, `cfoEspCod:null`, `tpcDesNome:null`, `fisEspSerie:null` for the SN Encomenda.
- **gcdDesNome UPPERCASE**: "SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA".
- Config flags present: `gcdVldTela:7` (FINANCEIRO_A_RECEBER), `gcdVldFormaRateio:1`, `gcdVldPropria:0`.
- **`pdcDocFederal`** (person CNPJ "37032037000101") and **`endCodFis:2`** — NEW fields we don't currently source. Investigate the process/pessoa detail (com299/{docCod} echoes endCod:2, pdcDocFederal; process detail likely has them). If a probe is needed, capture; if not sourceable, they may be optional — but the UI sends them.
- Dates epoch-ms UTC-midnight; docEspNumero = DDMMYYYY of the day.

### listContasProjeto is NOT used for generation
The rateio (contasProjeto) does NOT feed the generation payload for the SN Encomenda. `comDocProdutos/list` after generation returned count:0 (qtdItens:0). So DROP the buildItems/listContasProjeto path in etapaSn — send the header only.

### After generation the UI GETs /com299/{docCod} — echoes gerNum:210, endCod:2, pdcDocFederal, fisCod:1, vldTpNf:"00". (Note vldTpNf here is "00", not "10" — for a NON-fiscal SN. The fiscal vldTpNf "10" applies to the com297 NDe, per the fiscal spec.)

## MISSING STEP FOUND — POST /api/com299/gerDoc/validaProcessoPessoa (sources endCodFis + pdcDocFederal)
Called right after picking the process, BEFORE validaConfigDoc/gerDocProcesso.
Request: {"docTip":1,"frontModelName":"gerDocProcesso","globalDocVldTipo":9,"priCod":3254,"priEspRefcliente":"0097LFL/26"}
Response: {"responseData":{"pesCod":194,"endCodFis":2,"pdcDocFederal":"37032037000101","endEspZipcod":"04506905","endDesLogradouro":"AVENIDA SANTO AMARO","ufEspSigla":"SP","endDesBairro":"VILA NOVA CONCEICAO","endDesCidade":"SÃO PAULO","paDesNome":"BRASIL","endEspNlogradouro":"48","dpeNomPessoa":"..."}}

FIX: call validaProcessoPessoa first → take responseData.endCodFis + responseData.pdcDocFederal.
Pass endCodFis into validaConfigDoc (returns correct gcdVldTela:7 / gcdVldFormaRateio:1) AND into the gerDocProcesso header. Include pdcDocFederal in the gerDocProcesso header. This clears both the `endCodFis REQUIRED` and `CONFIG_DOC_NAO_POSSUI_ITENS` errors.

## Pré-flight de elegibilidade — findings 2026-08-02 (probe + batch READ-ONLY, filial 2 prod)

**`validaConfigDocPessoa` NÃO é o resolver de gcd por-processo.** Com a rota certa
(`com299/gerDoc/validaConfigDocPessoa` — sem o `gerDoc/` dava 405) devolve `{gcdCod:null,gcdDesNome:null}`
para TODO processo, inclusive o comprovadamente gerável 3254. Rebaixado a NOTA (gate 2, não conclui). Dois
bugs que o mascaravam, corrigidos: (a) rota 405; (b) o Zod do boundary LANÇAVA no `gcdDesNome:null`
(`z.string()`) e coagiria `gcdCod:null`→0 (`z.coerce.number()`) → agora `nullish()+transform` (null=ausente).

**O resolver real de elegibilidade é `validaConfigDoc(gcd)` lendo `messages`.** `valid:'ERRO'`
(`COM_068.CFOP_INCOMPATIVEL_OU_ERROS`) = gcd incompatível com o processo; `AVISO` não bloqueia; sem
mensagem = elegível. Novo método `verificarConfigElegivel` + gate 3 do `classificarAlocacao`.

**gcd 150 é POR-FILIAL, não global.** Batch (160 processos, 7 filiais): **135 READY, 25
BLOCKED_ELEGIBILIDADE, 0 CADASTRO, 0 UNKNOWN, 0 TRANSPORT**. Os 25 são 100% da filial 1 — gcd 150 dá
CFOP_INCOMPATIVEL para TODA a filial 1, enquanto filiais 2–7 passam. Probe num processo fil-1: 150
incompatível, mas 188/107/100 elegíveis → filial 1 tem config de SN, só não a 150. **`SN_GCD_COD=150` é o
gcd da SN-Encomenda das filiais 2–7; a filial 1 precisa do SEU gcd** (resolver por NOME
"SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA" no LOV de config — captura pendente). Nota: "elegível" no gate 3
significa só CFOP-compatível, NÃO "é a SN-Encomenda" — por isso o gcd alvo por filial tem de vir do LOV por
nome, não de "qualquer gcd limpo".

**Gate 0 (transporte × domínio).** 405/404/401/403 em qualquer validador → `TRANSPORT_ERROR` (HALT, bug de
rota), nunca disfarçado de (in)elegibilidade. Timeout/5xx/inesperado → `UNKNOWN` (retryable). Foi o 405
mascarado de UNKNOWN que escondeu tudo isso por 3 clientes.

### Pendências (não implementadas)
- **Filial 1 (e qualquer outra ≠ 2)**: capturar o gcd de SN-Encomenda por NOME via LOV de config → tornar
  `SN_GCD_COD` um mapa por-filial (não um escalar). Sem isso, processos da filial 1 ficam BLOCKED_ELEGIBILIDADE.
- Batch acima é AMOSTRA (25/filial, teto 160) — rodar a população inteira antes de números finais ao stakeholder.
- Fiscal: L-FOUNDERS 18337 veio `docVldComvalidacoes:2` + valor zerado — revisar antes de dar a leg como provada.

## Live-proof 2026-08-02 (REAL writes, prod filial 2) — chain reached fin014 baixa

Alvo: L-FOUNDERS 3254 (READY). Resultado: **SN gerada e finalizada de verdade (doc 18340)** + **borderô
fin014 criado (7258)**. Chain parou na baixa do título. Artefatos vivos p/ rollback: SN **18340**
(finalizado), borderô **7258**.

**Provado ao vivo:** com299 gerDocProcesso → 200 + validate/finalizacaoDocumento/18340 + finalizaDocumento
/18340 (SN inteira). fin014 criarBordero → 200.

**Bugs fin014 corrigidos ao vivo (mantidos no código):**
1. `criarBordero`/`validarTituloBaixa`/`gravarBaixa` exigem **`borVldTipo:1`** (a receber; fin010 a-pagar=2).
   Sem ele: 400 `borVldTipo required` e depois NPE `java.lang.Long.toString() because borVldTipo is null`.
2. `criarBordero` mandava `dataMovto:0` (epoch 1970 = período contábil FECHADO →
   `FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE`). Agora = HOJE (meia-noite UTC).

**BLOQUEIO (precisa HAR real da baixa fin014 a receber):** `validarTituloBaixa` com `titCod:1` (hardcoded)
→ 500 `RECORDNOTFOUND: FinBaixa (titCod:1, filCod:2, docTip:1, docCod:18340)`. O `titCod:1` é chute — o
título real da SN tem de vir de um list de títulos (equivalente a-receber do `listTitulosAPagar` =
`com308/financeiroAPagar/list/{docCod}`). Probes read-only de endpoints a-receber deram 405/500 — endpoint
desconhecido. Também não se sabe se o título precisa ser pré-registrado no borderô antes do validarTituloBaixa.
O **GerarSolicitacaoNumerarioService (permutas) tem o MESMO `titCod=1` hardcoded**, mas era DRY-RUN-only —
nunca exercido ao vivo. **PENDENTE: 1 HAR de uma baixa fin014 (a receber) completa** (list de títulos →
validar → gravar → finalizar) para confirmar o titCod real + a sequência.

**Também confirmado:** o gate 3 (validaConfigDoc CFOP) é NECESSÁRIO mas NÃO SUFICIENTE. BUNTECH 459 passou o
pré-flight (READY) mas a geração falhou em `gcdDesNomeProc: Generic.NOT_VALID` p/ "SOLICITAÇÃO DE NUMERÁRIO -
ENCOMENDA". Ou seja: CFOP-compatível ≠ config-nome-válido-p/-o-processo. O "135 READY" do batch é otimista —
o gate real de nome vem do LOV de config (captura getModelConfiguracao pendente).

## HAR fin014 baixa a-receber 2026-08-02 15-55 (workflow real do Yuri) — MODELO ERRADO exposto

Workflow capturado = 100% fin014 "Baixa de Títulos a Receber". ZERO com299/com297/SN. Sequência real:
1. `POST fin014` criar borderô: `{filCod, borVldTipo:1, borVldFinalizado:0, frontModelName:"bordero", gerNum, gerDes, borDtaMvto}` — inclui **gerDes** (descr. da conta) que nosso código NÃO manda.
2. `POST lov/TituloBorderoReceber` — LOV dos títulos a receber ABERTOS. Body `{fieldList:[docTip,docCod,titCod,titEspNumero,priCod,priEspRefcliente,titDtaVencimento,pesCod,dpeNomPessoa,titMnyValor,titMnyTotPago,titMnyAberto,...], filterList:{borVldFinalizado:0, exibirTitulos:1 [, docCod#EQ:<doc>]}, pageNumber, orderBy:"desc", sortBy:"docCod"}`. Fonte do titCod/titEspNumero REAIS.
3. `POST fin014/baixas/validacao/tituloBaixa` `{docCod,titCod,titEspNumero,docTip:1,borCod,borVldTipo:1,filCod}` → `responseData{bxaMnyValor,bxaVldCcorrente,bxaMnyLiquido,...}`.
4. `POST fin014/baixas` gravar `{bxaVldSistema:0,docTip:1,bxaVldAdto:0,bxaVldCcorrente:<da validação>,bxaVldCorrenteDc:1,filCod,borCod,borVldTipo:1,borVldFinalizado:0,gerNum,gerDes,docCod,titCod,titEspNumero,bxaMnyValor,bxaMnyLiquido,...}` → `{bxaCodSeq}`.

**CRÍTICO — a SN gerada (com299) NÃO é um título a receber.** `lov/TituloBorderoReceber` filtrado por
`docCod#EQ:18340` (nossa SN) → **count:0**. O workflow deu baixa num título de INVOICE REAL (docCod 18335,
titEspNumero "18046211", R$215.308 do priCod 3467), não na SN. Logo o modelo "gerar SN → dar baixa no docCod
da SN → NDe" está errado: o que se baixa é o título a receber REAL do processo (a invoice), não a SN.
**PENDENTE (decisão de domínio):** o que a automação deve baixar — o título a receber aberto do processo
(via lov/TituloBorderoReceber filtrado por processo/pessoa)? E onde a SN (com299) e a NDe (com297) entram —
são um sub-fluxo separado, ou a SN precisa de um passo "gerar títulos" p/ virar recebível? Sem isso, a leg
fin014 do RecebimentoNumerarioService não fecha.

## RAIZ CONFIRMADA 2026-08-02 — a SN nasce com docMnyValor:0 (sem valor → sem título)

Read-only `GET com299/18340` → `docMnyValor:0, docVldFinalizado:0, gcdDesNome:null`. `lov/TituloBorderoReceber`
filtrado por docCod 18340 → count:0. Ou seja: a SN é gerada VAZIA (valor 0), por isso dispara
`NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR` e NÃO materializa título a receber — e a fin014 (que adiciona a SN
pelo docCod, guia Tela 2) não acha nada.

O guia "telas Conexos" Tela 1 (com299): "1º **Adicionar** … **Valor total (preencher com o valor alocado)** …
Gerar documento … finalizar". Nosso payload manda o rateio stub com `tmpMnyValor:null`/`total:null`
(header-only), então docMnyValor sai 0. O MODELO original (gerar SN → baixar a SN no fin014 pelo docCod → NDe)
está CERTO; o furo é só materializar o VALOR da SN na geração (o passo "Adicionar + Valor total" da Tela 1),
que provavelmente é o `tmpMnyValor`/`total` do item do rateio (hoje null) e/ou um `docMnyValor` no header.

**PENDENTE p/ fechar:** HAR de UMA geração de SN com valor preenchido (Tela 1: Adicionar → Valor total = X →
Gerar → Finalizar) — p/ ver o campo/rota exatos que setam docMnyValor e criam o título a receber. Sem isso,
não chutar o payload ao vivo (cada tentativa = uma SN órfã). fin014 baixa em si já está 100% mapeada (HAR 15-55).

## Value-fix LIVE 2026-08-02 — FALHOU (docMnyValor no header é IGNORADO)

Tentativa: mandei `docMnyValor:100` no header do gerDocProcesso + `tmpMnyValor/total` no wrapper do valida.
Resultado: doc **18341** nasceu de novo com `docMnyValor:0`, count:0 título. O servidor IGNORA `docMnyValor`
no header. Revertido tudo (código volta só com os fixes provados: classifier + fin014 borVldTipo + data).

**Conclusão:** o valor da SN NÃO entra por campo escalar no header — vem da(s) LINHA(S) DE RATEIO do payload
de geração (o passo "1º Adicionar" da Tela 1), que hoje mandamos como header-only (sem `items`). NÃO chutar a
estrutura do items ao vivo (cada tentativa = SN órfã; já temos 18337/18340/18341 zeradas).

**HAR PRECISO NECESSÁRIO:** uma geração de SN Encomenda no browser (com299, HML ou prod) fazendo o passo do
valor — **1º Adicionar → preencher "Valor total" com um valor (ex.: 100) → Gerar documento → Finalizar** — com
o DevTools gravando. O que importa: o body do `POST com299/gerDocProcesso` (e de qualquer `Adicionar`/rateio
que o preceda) que faz o doc nascer com `docMnyValor` = valor e materializa o título a receber. Aí eu replico
o `items` exato + fecho a leg fin014 (que já está 100% mapeada pelo HAR 15-55).

## HAR SN-gen 2026-08-02 16-37 — a SN é ADIANTAMENTO e nem o fluxo MANUAL fechou

Doc capturado 18342 (feito pelo Yuri no browser) terminou `docMnyValor:0, docVldFinalizado:0`, e
`lov/TituloBorderoReceber(docCod=18342)` = count:0. Ou seja: NEM o fluxo manual materializou um título
baixável. A geração nasceu com valor 100 (1º GET 16:36:36), mas `finalizaDocumento` ZEROU (validações
pendentes).

**A SN é um ADIANTAMENTO:** PUT com299 mostra `docVldTipoAdto:1, tpdDesNome:"SOLICITAÇÃO DE NUMERÁRIO",
gerDes:"ADTO. CLIENTE - EXT."`. Adiantamento (crédito do cliente) NÃO aparece em TituloBorderoReceber
(recebíveis de invoice) — por isso a leg fin014 "baixar a SN" via aquele LOV não fecha.

**com194/documento/list (docCod 18342) → 2 validações que travam:**
1. `fdvVldErr:1 (aviso)`: "A NOTA NÃO POSSUI ITENS CADASTRADOS." → sem item = docMnyValor volta 0.
2. `fdvVldErr:2 (ERRO)`: "CONDIÇÃO DE PAGAMENTO ... DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA. PESSOA:194,
   SUGESTIVA: L-FOUNDERS - DUPLICATA". O doc saiu `pgtCod:1/A VISTA`; a pessoa 194 exige DUPLICATA.

**Sequência real da geração (browser):** validaProcessoPessoa → validaConfigDocPessoa → **lov/ConfigDocProcesso**
(o LOV de config que faltava p/ o gate gcdDesNomeProc!) → validaConfigDoc → [form] → gerDocProcesso/valida
(SUCESSO) → gerDocProcesso (valor 100) → GET (valor 100) → finaliza (ZERA) → PUT com299 (doc inteiro,
docMnyValor 100) → finaliza de novo. Mesmo assim ficou 0/sem título.

**CONCLUSÃO:** a materialização do adiantamento SN precisa de (a) linha de item/valor, (b) condição de
pagamento = a do cadastro da pessoa (DUPLICATA p/ 194), (c) resolução das validações com194 — e isso NÃO está
fechado nem no manual. Reverter-engenharia de um fluxo manual incompleto não resolve. PENDENTE: o PROCESSO DE
NEGÓCIO COMPLETO da Columbia (como o analista finaliza a SN-adiantamento até virar baixável) OU um HAR de uma
SN que REALMENTE terminou com título/adiantamento baixável.

## ✅ FLUXO SN COMPLETO (HAR 17-31, doc 18342 FINALIZADO docMnyValor:100 docVldFinalizado:1)

O que faltava: (1) a LINHA DE ITEM (comDocProdutos) que dá valor ao doc, (2) a CONDIÇÃO DE PAGAMENTO do
cadastro da pessoa (PUT com299), (3) então finalizar. Receita definitiva:

1. `validaProcessoPessoa(priCod)` → endCodFis, pdcDocFederal
2. `validaConfigDoc(gcd 150)` → flags
3. `gerDocProcesso/valida` → SUCESSO (ou QUESTION sem-valor; com item depois o valor materializa)
4. `POST gerDocProcesso` (header, como hoje) → docCod (shell, docMnyValor 0)
5. `POST lov/CondPgtoPessoa` `{fieldList:[pgtCod,pgtDesNome], filterList:{pesCod, fdocTipPgto:1}}` → opções.
   Ex. pes 194 → [{1 A VISTA},{109 "L-FOUNDERS - DUPLICATA"},{8 NÃO FINANCEIRO}]. Escolher a DUPLICATA
   da pessoa (a com194 exige a "SUGESTIVA" do cadastro; NÃO "A VISTA"/"NÃO FINANCEIRO").
6. `PUT com299` (doc INTEIRO do GET com299/{docCod} + `pgtCod`/`pgtDesNome` da escolha) → limpa o ERRO
   "CONDIÇÃO DE PAGAMENTO ... DIFERENTE DA SUGERIDA".
7. `POST lov/ContasProjetoCtb` `{fieldList:[ctpDesNome,ctpEspConta,ctpCod], filterList:{prjCod:1, docTip:1,
   priCod, tpdCod:3, priCodProd:priCod}}` → escolher `ctpCod` onde ctpDesNome="ADIANTAMENTO DE CLIENTE
   ENCOMENDA" (ex. 690). (prjCod:1 = projeto usado; confirmar se fixo.)
8. `POST comDocProdutos/initialValues` `{docCod, priCod, ...}` → template (prdCod:2, tpcCod:33,
   cfoEspCod:"9999A2", undCod:3, dprVldOrigMerc:9, dprVldCstIbsCbs:"-1", qualifier:"FINANCEIRO_RECEBER").
9. `POST comDocProdutos` = template + `dprPreValorun:<valor>` + `prjCod:1` + `ctpCod:<690>` +
   `ctpDesNome:"ADIANTAMENTO DE CLIENTE ENCOMENDA"` + `dprQtdQuantidade:1` → cria item, docMnyValor=<valor>.
10. `validate/finalizacaoDocumento/{docCod}` + `finalizaDocumento/{docCod}` → docVldFinalizado:1,
    docMnyValor:<valor>, docVldComvalidacoes:1 (resta só o AVISO "sem itens" fdvVldErr:1 = não bloqueia).
11. → agora o adiantamento aparece em `lov/TituloBorderoReceber` e a leg fin014 (HAR 15-55) baixa.

Notas: prdCod DA SN = 2 (o 41978 é do PRODUTO da NDe com297, não da SN). `Número do Documento` das SNs
finalizadas = nº do PROCESSO (18319→3360), NÃO a data DDMMYYYY — revisar nosso docEspNumero. REQ FRONTEND
(pedido do Yuri): surfacear as validações com194/erro de finalização pro analista, como a plataforma faz.

## IMPLEMENTADO 2026-08-02 (worktree receb-numerario-real, NÃO commitado — 954 testes verdes)

> **⛔ SUPERSEDIDO EM PARTE (2026-08-03, ADR-0025).** A ordem abaixo — condição de pagamento (1) e linha de
> item (2) — está **invertida** em relação ao vigente, e a menção a `vldRwCondpgt:1` como se reescrevesse a
> condição está **ERRADA**: o campo já vem `1` no GET (flag de PERMISSÃO, ao lado de `vldRwPlanfin:1` /
> `right:"RW"`), não é gatilho de regeneração das parcelas. Medido no HML: o título **nasce na geração** do
> com299, a **linha de item o preserva** e o **PUT que troca o `pgtCod` o destrói sem regenerar**. Vigente:
> item primeiro; condição **só** sob validação bloqueante da com194 (`fdvVldErr===2`) e com verificação
> obrigatória `mnyTitValor === docMnyValor`. Ver `docs/e2e/gap-titulos-diagnostico.md`,
> `integrations/conexos-com299-gerdoc.md` (banner "CICLO DE VIDA DO TÍTULO") e `decisions/0025-*`.
> (Os passos 5/6 da receita "FLUXO SN COMPLETO" acima descrevem o mesmo PUT — leia-os sob a mesma ressalva:
> ele limpa o ERRO da com194, mas ao custo das parcelas; por isso hoje só roda quando o ERRO existe.)

- **SN completion** (`RecebimentoNumerarioService.completarSnAdiantamento`, chamado no `etapaSn` após gerar,
  antes de finalizar): (1) `listCondPgtoPessoa(pesCod)` → escolhe a "&lt;pessoa&gt; - DUPLICATA" → GET doc +
  `atualizarDocumento` (PUT com299, `vldRwCondpgt:1`); (2) `listContasProjetoCtb(prjCod:1, priCod, tpdCod:3)`
  → conta "ADIANTAMENTO DE CLIENTE ENCOMENDA" → `comDocProdutosInitialValues(doc)` (template) →
  `adicionarComDocProduto` com `dprPreValorun:valor, prjCod:1, ctpCod`. Defaults: prjCod=1, tpdCod=3.
- **Novos métodos** no `ConexosGerDocProcessoClient`: listCondPgtoPessoa, listContasProjetoCtb, getDocumento,
  atualizarDocumento (PUT), comDocProdutosInitialValues, adicionarComDocProduto (+ Zod, +5 testes).
- **fin014 baixa reescrita** (`etapaFin014`): criarBordero (captura `gerDes`) → `listTitulosBorderoReceber`
  (lov, filtro docCod) → título REAL (titCod/titEspNumero, NÃO o 1 fixo) → validarTituloBaixa (com
  titEspNumero) → gravarBaixa (payload HAR 15-55: bxaVldSistema:0, bxaVldCcorrente da validação, gerDes,
  titEspNumero) → finalizarBordero. Fail-closed se o LOV vier vazio (SN não materializou título). +3 testes.

**PENDENTE (follow-ups, não bloqueiam):** (a) validação LIVE end-to-end do fluxo completo (SN→título→baixa→
NDe→homologa); (b) gate de elegibilidade via `lov/ConfigDocProcesso` (corrige o overcount de READY do
gcdDesNomeProc); (c) `docEspNumero` = nº do PROCESSO, não a data DDMMYYYY; (d) FRONTEND: surfacear erro de
finalização/com194 ao analista (pedido do Yuri). Regra da condição de pagamento e prjCod=1 são DEFAULTS
(confirmados pelo Yuri) — revisar se algum cliente fugir do padrão.

## Elegibilidade AUTORITATIVA + erro no frontend — IMPLEMENTADO 2026-08-02 (959 testes)

**A config de SN VARIA por processo/filial** (HAR ConfigDocProcesso do Yuri): 3254 → gcd 150
"SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA"; 3478/459 → NÃO têm Encomenda, têm gcd **151 "SN - TERCEIROS"**.
Por isso 459/3478 falhavam `gcdDesNomeProc NOT_VALID`. Correções:
- **Gate 3 reescrito** (`classificarAlocacao`): usa `lov/ConfigDocProcesso` (a lista REAL de configs do
  processo, filtro `priCod/fPesCod/fEndCod`) e RESOLVE a Encomenda POR-PROCESSO (nunca hardcoda 150:
  preferir gcd env como desempate, senão casar por NOME `/SOLICITAÇÃO DE NUMERÁRIO/` + "ENCOMENDA"). Sem
  Encomenda mas COM outra variante (ex. TERCEIROS) → BLOCKED_ELEGIBILIDADE que NOMEIA a variante (não
  auto-gera: conta/rateio próprios). Sem nenhuma SN → BLOCKED. Substitui o gate CFOP (necessário-mas-insuf.).
  Novo client `listConfigDocProcesso`.
- **Erro no frontend mais informativo**: `ErpErrorInterpreter` agora parseia o envelope
  `SELECTION_ERROR`/`VALIDATION` (`validation.main.itemMessages`), com tradução dedicada por item
  (`gcdDesNomeProc` → "processo não aceita esta config"; `endCod`/`pgtCod`). Antes: "Conexos call to
  com299/gerDocProcesso failed"; agora: mensagem específica. `registrarFalha` já surfaca `interpret().friendly`
  em `erro` (o que a modal mostra).

**Decisão de negócio PENDENTE (perguntar ao Yuri):** quando o processo só tem SN-TERCEIROS (não Encomenda),
auto-gerar com TERCEIROS (o Yuri faz manual) OU manter bloqueado-informativo? Hoje: bloqueado-informativo
(seguro; a conta/rateio da TERCEIROS ainda não está mapeada). Se automatizar TERCEIROS: precisa da conta de
projeto dela (equivalente a "ADIANTAMENTO DE CLIENTE ENCOMENDA").

## DECISÃO Yuri 2026-08-02: variantes de SN tratadas AUTOMATICAMENTE (não bloquear)

Gate 3 agora aceita QUALQUER variante de "Solicitação de Numerário" do processo (preferir Encomenda; senão a
1ª variante — ex. TERCEIROS gcd 151) → READY resolvendo o gcd por-processo da ConfigDocProcesso. A geração usa
o gcd/gcdDesNome resolvidos. `completarSnAdiantamento` DERIVA a conta de rateio da VARIANTE: extrai o sufixo
do nome ("... - TERCEIROS" → "TERCEIROS"), procura `ADIANTAMENTO DE CLIENTE <VARIANTE>` no `lov/ContasProjetoCtb`
(match exato → senão contém "ADIANTAMENTO"+variante). FAIL-CLOSED se não achar (não chuta conta contábil).
`SN_CONTA_ADIANTAMENTO_PREFIXO='ADIANTAMENTO DE CLIENTE'`. 960 testes. Só falta HAR real de uma baixa/geração
TERCEIROS p/ confirmar o nome da conta (o match por sufixo é a hipótese; fail-closed protege).

## TERCEIROS live 2026-08-03: falta o "Tipo de Operação" (tpcCod) — não auto-resolvível

Após o fix do cfoEspCod, a geração de 3478 (gcd 151 TERCEIROS) foi a `POST com299/gerDocProcesso` (tpcCod:null)
→ 400 VALIDATION_LIST "NÃO FOI POSSÍVEL FAZER O PREENCHIMENTO DO TIPO DE OPERAÇÃO !!!". ENCOMENDA (gcd 150)
gera com tpcCod:null (servidor auto-preenche); TERCEIROS NÃO. Probe read-only: `validaConfigDoc` devolve
tpcCod=null (3478) / undefined (3254) — NÃO é fonte do tpcCod. Logo o "Tipo de Operação" da TERCEIROS é
SELEÇÃO do analista (o dropdown vazio da com068), não auto-resolvido. PENDENTE p/ automatizar TERCEIROS: HAR
de UMA geração manual TERCEIROS completa (mostra o tpcCod escolhido + o LOV do Tipo de Operação + a conta da
variante). ENCOMENDA segue 100% (proven 18342).

## MILESTONE 2026-08-03: SN+baixa PROVADOS live; NDe (com297) = gap G2 (geração nunca capturada)

L-FOUNDERS 3254 rodou a cadeia INTEIRA ao vivo: SN 18345 gerada+completada(cond.pgto DUPLICATA+item valor
100)+FINALIZADA → título materializado (titCod 4) → fin014 baixa GRAVADA (R$100, borderô 7261) → finalizada.
TUDO que foi construído funciona. Fixes ao longo do caminho: cfoEspCod nullish; NDe payload com pdcDocFederal
+ endCodFis reais (com297 exige, senão "pdcDocFederalFilter;").

**NDe (com297) BLOQUEADA — gap G2 documentado (recebimentos-nde-com297-gap.md):** a leg de GERAÇÃO com297
foi INFERIDA (sem HAR). Eu confundi o Tipo FISCAL "Pagamento antecipado" (com300, pós-geração,
fisVldTipoNfDebito=6) com o NOME da Configuração com297. gcd 248 "NOTA DE DEBITO PAGAMENTO ANTECIPADO" é
rejeitado `gcdDesNomeProc NOT_VALID` p/ o processo 3254; nenhum docTip/globalDocVldTipo em ConfigDocProcesso
surfaca uma config de débito p/ 3254. Revertido o guess do nome. **PENDENTE: 1 HAR de uma geração com297 real
(Tela 3: Processo→Pessoa→Configuração→Número 0→Produto 41978→Valor→Gerar; depois Mais Ações→Fiscal→"Pagamento
antecipado"→Observações)** — mostra o gcd/nome da Configuração + os payloads reais. Aí a leg NDe fecha.

## NDe (com297) RESOLVIDO 2026-08-03 — o bug era globalDocVldTipo (0, não 9)

HAR 23-27 (doc 18347 SUCESSO): a NDe com297 usa **globalDocVldTipo=0** (o SN usa 9). Foi o 9 que fazia o
processo REJEITAR a config 248 (`gcdDesNomeProc NOT_VALID`) e o ConfigDocProcesso não surfaçar débito. gcd
248 "NOTA DE DEBITO PAGAMENTO ANTECIPADO" estava CERTO — só o discriminador estava errado. Payload real da
NDe (header-only, SEM items): globalDocVldTipo 0, gcd 248, gcdVldTela 5, gcdVldPropria 1, gcdVldFormaRateio 1,
tpcCod 120, tpcDesNome "NOTAS DE DEBITO E CREDITO", cfoEspCod "6949ND", fisEspSerie "NFE1", prdCod 41978,
prdDesNome "PAGAMENTO ANTECIPADO", docEspNumero 0 (número), endCodFis+pdcDocFederal reais. Fixes: constante
NDE_GLOBAL_DOC_VLD_TIPO=0 + NDE_CONFIG_NOME; validaConfigDoc/gerarDoc do com297 com gvt 0; validaConfigDoc
schema parseia tpcDesNome; payload com prdDesNome/série/número corretos. Sequência fiscal seguinte
(com300 PUT fiscal → com131 geraObs → com297/homologaNfe) já mapeada no HAR e implementada. GAP G2 fechado.

## NDe geração OK (doc 18348); produto vai no HEADER, não via comDocProdutos (2026-08-03)

globalDocVldTipo=0 destravou a geração com297 (doc 18348 SUCESSO). Próximo erro: `com297/comDocProdutos` →
400 `docVldTipo required`. HAR 23-27 NÃO faz esse POST — o produto (41978) já vai no HEADER do gerDocProcesso
(prdCod/prdDesNome). Removido o `adicionarProduto` do etapaNotaDebito. initialValues do com297 mostra
docVldTipo:7/qualifier:FISCAL_SAIDA (caso um dia precise), mas o fluxo real não adiciona produto. Segue p/
com300 fiscal → com131 obs → com297/homologaNfe (já mapeados no HAR + implementados).

## HOMOLOGAÇÃO NDe — bloqueada por dados FISCAIS (não é bug de automação) 2026-08-03

Chain INTEIRA roda ao vivo até a homologação: SN→completar→finalizar→título→fin014 baixa→NDe geração
(gvt 0)→com300 fiscal (fisVldTipoNfDebito 6)→com131 geraObs→com297/homologaNfe (200). Mas a NDe NÃO
homologa: `GET com297/18348 → docVldNfehom=0`, docVldComvalidacoes=0. com194 do 18348 = 3 validações
BLOQUEANTES (fdvVldErr=2): (1) condição de pagamento ≠ cadastro (pgtCod 8, sugestiva DUPLICATA 109);
(2) tipo de frete ≠ "SEM TRANSPORTE" (transportadora obrigatória); (3) produto 41978 SEM GTIN.
**CHAVE: o doc MANUAL 18347 (que "homologou" no HAR, resp docVldComvalidacoes:2/docVldNfehom:1) HOJE está
docVldNfehom=0 com as MESMAS 3 bloqueantes.** Ou seja, nem o fluxo manual persiste a homologação — a NDe
precisa dos dados fiscais resolvidos primeiro. Dá p/ automatizar (1) condição de pagamento (PUT com297 =
DUPLICATA, como no SN) e talvez (2) tipo de frete SEM TRANSPORTE. Mas (3) GTIN do produto 41978 é CADASTRO
(fora do doc) — bloqueio fiscal/stakeholder. PENDENTE: decisão do Yuri/fiscal sobre GTIN + frete + cond.pgto
da NDe. O resto da automação está PROVADO.

## CORREÇÃO 2026-08-03 (Yuri): docVldComvalidacoes=0 é homologada-com-aviso, NÃO rejeição

O Yuri confirmou que na plataforma as 3 validações (cond. pagamento/frete/GTIN) NÃO bloqueiam — a
homologação ACONTECE (como no HAR, docVldComvalidacoes:2). Nosso código rejeitava o valor `0` (não estava no
enum — gap G3 só conhecia 1 e 2). Corrigido: `NDE_DOC_VLD_COM_VALIDACOES.HOMOLOGADA_VALIDACOES_NAO_BLOQUEANTES
= 0`; o ConexosNdeClient trata 0 igual a 2 (emitida + avisoValidacoesPendentes → revisão humana + com194).
Valores DESCONHECIDOS (ex. 3) ainda RECUSAM (fail-closed). Com isso a chain FECHA: homologa (com revisão
humana pelas validações) → poll SEFAZ. 961 testes.

## FLUXO COMPLETO 2026-08-03: NDe HOMOLOGADA; poll SEFAZ não bloqueia mais o Processar

Run com o fix do docVldComvalidacoes: homologaNfe → docVldComvalidacoes:2 → EMITIDA + revisão humana
(com194: cond.pgto/frete/GTIN). A NDe (18348) FOI HOMOLOGADA. O "Processar" girava porque o etapaPoll fazia
loop de até 5 min (ndePollTimeoutMs) segurando o HTTP, esperando vldAutorizado (SEFAZ é ASSÍNCRONO — não vem
na janela do request). Fix: etapaPoll agora faz UMA leitura best-effort; se autorizado→settle+concluído,
senão devolve homologado (status geral já é `settled`, ndeAutorizado:false) e a autorização reconcilia depois.
etapaHomologar tem guard (não re-homologa no resume). Cadeia INTEIRA fecha: SN→completar→finalizar→título→
fin014 baixa→NDe(gvt0)→com300 fiscal→com131 obs→homologa(revisão humana)→settled. 961 testes.

## AUDITORIA/PERSISTÊNCIA 2026-08-03 — fixes 1/2/3 (965 testes)

1. **NDe como entidade** — `RecebimentoNumerarioService` agora injeta `NdeRepository` e grava um
   `nota_debito_eletronica` na homologação (statusEmissao='emitida', numero_nde, valor, erp_response com o
   docCod, emitida_em/por; idempotente por idempotency_key). Alimenta a aba NDe do painel + auditoria.
2. **markSettled na homologação** — o ledger vira `settled` logo após homologar (trabalho feito); a
   autorização SEFAZ (assíncrona) é só o flag `nde_autorizado`. Antes ficava `reconciling` até o poll. O
   `etapaPoll` virou leitura única (não bloqueia mais o Processar).
3. **Endpoint de auditoria** — `GET /recebimentos/execucoes?txnId=<id>` (todas as alocações da transação)
   ou `?status=error|reconciling|settled|pending&limit=N` (admin). Devolve status/etapa/doc_cod/nd_doc_cod/
   erro_mensagem/erp_response/revisao_humana/nde_autorizado. `listByTxnId`/`listByStatus` no repo.

Tabelas nota_debito_eletronica + solicitacao_numerario_execucao CONFIRMADAS na Supabase compartilhada.
