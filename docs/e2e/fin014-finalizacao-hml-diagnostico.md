# Diagnóstico — `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` na finalização do `fin014` (HML)

> Sessão de 2026-08-03 (manhã/tarde). Continua o `HANDOFF-proxima-sessao.md`, que **segue válido** para
> tudo que diz respeito ao fix do título da SN. Este documento cobre só o que veio **depois** da Fase B:
> a investigação do erro que travou a última perna do fluxo.
>
> **Conclusão em uma frase:** o erro **não é da nossa integração** — no HML de hoje *nenhum* borderô a
> receber com baixa consegue ser validado ou finalizado, incluindo os criados à mão pela própria UI do
> Conexos com títulos de terceiros anteriores ao projeto.

## 1. O que a Fase B produziu

A Fase B rodou no HML pela rota real e **a correção do título funcionou**:

| Etapa | Resultado |
|---|---|
| Geração da SN no `com299` | OK — documento **738** |
| Linha de item | OK |
| Condição de pagamento | **não tocada** (SKYJACK não dispara a com194) — comportamento esperado |
| Finalização do documento | OK, `docVldFinalizado: 1`, título `titCod 1` de R$ 123,45 |
| `etapaFin014` — criar borderô | OK — borderô **135** |
| `etapaFin014` — gravar baixa | OK |
| `etapaFin014` — **finalizar borderô** | **FALHOU** |

Ou seja: a barreira que travava tudo caiu, e o fluxo avançou até território que nunca tinha sido
exercitado em homologação. O bug novo é progresso, como previsto no handoff anterior.

A assinatura exata da falha:

```
POST /api/fin014/finalizar/135     body: {}
400  {"type":"VALIDATION","messages":[{"message":"CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE"}]}
```

Na UI, isso aparece como o toast **"JÁ EXISTE UM REGISTRO COM ESTE CÓDIGO IDENTIFICADOR!"**.

## 2. A investigação, hipótese por hipótese

Todas as hipóteses abaixo foram **refutadas com medição**. Vale ler a tabela inteira: cada linha
economiza uma rodada de investigação para quem assumir.

| # | Hipótese | Como foi testada | Veredito |
|---|---|---|---|
| 1 | Falta corpo na requisição de finalizar | Comparado com o `fin010`, que finaliza com corpo vazio e funciona | **Refutada** |
| 2 | É a nossa implementação do client | Cliquei em **Finalizar** na UI do Conexos, no borderô 135, interceptando a rede: a UI faz **exatamente a mesma chamada** (`POST /api/fin014/finalizar/135`, corpo `{}`) e recebe o **mesmo 400** | **Refutada** |
| 3 | Colisão na chave do **lote contábil** | Listada a entidade `CtbLote` (tela `ctb006`): 968 lotes, o mais recente é de **30/06/2026**; **não existe nenhum lote em agosto de 2026**. O `lotCod` reinicia por data (12/01 tem RC 1 a 6; 07/01 tem RC 1 a 4), então a chave que a finalização criaria está livre | **Refutada** |
| 4 | Lote órfão deixado por uma tentativa anterior | `POST /api/fin014/lotesContabeis/135` devolve `count: 0` | **Refutada** |
| 5 | `docEspNumero` derivado da data, duplicado | Era a hipótese mais forte da sessão anterior. Pela `fin007`: `"03082026"` tem 3 documentos (736/737/738, todos com `titEspNumero` `"030820261"`), **mas** `"27072026"` tem **um único** documento (730) — e o borderô 133, que usa justamente ele, falha igual | **Refutada** |
| 6 | A nossa sequência de chamadas (chamamos `fin014/baixas/validacao/tituloBaixa`, a UI não) | Montei o borderô **136** inteiramente pela UI — criar, abrir o modal de baixa, confirmar — sem essa chamada. Falhou idêntico | **Refutada** |
| 7 | É específico dos documentos criados pelo nosso fluxo de SN | Montei o borderô **137** com um título antigo e alheio (**ENGEPECAS**, doc 456, R$ 899,33, anterior ao projeto). Falhou idêntico | **Refutada** |

## 3. O achado que amarra tudo

O erro aparece também na ação **Validação**, que é caminho de **leitura**:

```
POST /api/fin014/validacoes/135
400  {"type":"VALIDATION","messages":[{"message":"CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE"}]}
```

Isso muda a natureza do problema: não é "a finalização não consegue criar o lote/lançamento". É algo
mais atrás, no passo de validação.

Essa rota **grava** linhas de resultado de validação — dá para ver o formato na resposta dos borderôs
vazios: `{filCod, borCod, borVldTipo, docCod, titCod, codErr}`. E o comportamento é limpo por categoria:

| Borderô | Estado | Resposta da validação |
|---|---|---|
| 135 (doc 738, nosso) | com baixa | `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` |
| 133 (doc 730, nosso) | com baixa | `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` |
| 136 (doc 736, **feito na UI**) | com baixa | `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` |
| 137 (doc 456, **ENGEPECAS, alheio**) | com baixa | `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` |
| 131, 132, 134 | vazios | `FIN_146.REGISTROS_POSSUEM_ERROS` (normal: sem baixas) |
| 130 | já finalizado | `ESTE BORDERÔ NÃO PODE SER FINALIZADO` (normal) |

**Todo borderô com baixa falha. Nenhum borderô vazio falha.** O padrão é de identificador de registro
de validação colidindo no banco do HML — o sintoma clássico de ambiente restaurado a partir de produção
sem reposicionar a sequência correspondente. É defeito de ambiente, do lado da Conexos.

## 4. Anatomia da finalização (o que ela escreve, quando funciona)

Levantado nos **Lançamentos Contábeis** do borderô **127** (finalizado em 12/01/2026, R$ 8.667.770,33).
Útil para entender o que esperamos ver quando a perna finalmente rodar:

- **Um lote contábil** — chave `(filCod, lotDtaData, lotEspSigla, lotCod)`, no caso `(2, 12/01/2026, "RC", 3)`, criado já fechado (`lotVldFechado: 1`).
- **Dois lançamentos**, com `ctbCod` de sequência global:
  - `49700` — débito R$ 8.667.770,33 na conta `11120001` (BANCO ITAÚ), histórico 8;
  - `49701` — crédito R$ 8.667.770,33 na conta `11210001` (CLIENTES NACIONAIS), histórico 51.

A sigla do lote para baixa a receber é **`RC`**.

## 5. Ferramental descoberto (isto vale muito para a próxima sessão)

Aprendi a operar o Conexos HML programaticamente pelo navegador. Poupa horas de clique e dá acesso de
leitura a praticamente qualquer entidade.

**Pilotar a UI Angular.** Cliques via DOM (`element.click()`) **não** disparam os handlers do AngularJS.
Duas saídas que funcionam:

- `browser_click` com a ref de um `browser_snapshot` (simula clique real);
- chamar o handler pelo escopo, com digest: `angular.element(el).scope().$apply(() => s.moduleBordero.save())`.

Os handlers úteis do `fin014`: `goToCadastro()` (novo borderô), `moduleModais.modalBaixasPermuta(false)`
(modal de baixa), `moduleBaixaPermuta.save`, `moduleBordero.delete()`, `moduleBaixaPermuta.excluir()`.
Os diálogos de confirmação se resolvem com `s.dialogCallback(); s.close('confirm');`.

**Estorvos de layout.** Uma imagem de rodapé e um ícone flutuante (`img.shake`) interceptam cliques;
escondê-los com `display: none !important` destrava.

**Chamar a API autenticada.** `fetch` e `XMLHttpRequest` crus **não funcionam** — o backend exige
cabeçalhos de contexto e devolve `500 Error creating bean with name 'scopedTarget.cnxRequestData'`. O
caminho certo é o `$http` da própria aplicação, que passa pelos interceptadores:

```js
const $http = angular.element(document.body).injector().get('$http');
await $http.post('/api/ctb006/list', { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 40,
  orderList: { orderList: [{ propertyName: 'lotDtaData', order: 'desc' }] } });
```

**Descobrir qual tela expõe qual entidade.** Truque de introspecção: mandar um `orderList` com um campo
inexistente. O erro devolve o nome da classe do modelo.

```
POST /api/{tela}/list  com orderList propertyName: 'zzInexistente'
→ "Field zzInexistente not found on model class info.conexos.model.CtbLote"
```

Mapeamento já levantado: `ctb001` CtbHistorico · `ctb002` CtbPlano · `ctb003` CtbCadCcusto ·
`ctb004` CtbProjeto · **`ctb006` CtbLote** · `ctb008` CtbSiglasLote · `ctb009` CtbFchFiscal ·
`ctb010` (exige filtro `fsqCod`) · `fin001` FinBancos · `fin005` FinCcorrentes · **`fin007` FinTitulo** ·
**`fin010` FinBordero** · `fin015` FinLoteSispag.

**Interceptador de rede** (injetado na página, sobrevive a troca de rota do SPA): envelopa
`XMLHttpRequest` e `fetch` acumulando `{metodo, url, reqBody, status, resBody}` em `window.__cnxLog`.
Foi o que provou que a UI faz a mesma chamada que nós.

## 6. Rotas do `fin014` — correções ao nosso client

A sonda anterior tomou **405** em duas rotas porque o formato estava errado. Os formatos corretos,
capturados da UI:

| Operação | Rota correta |
|---|---|
| Ler borderô | `GET /api/fin014/{filCod}/{borCod}` — **precisa do `filCod`** |
| Criar borderô | `POST /api/fin014` — `{filCod, borVldTipo: 1, borVldFinalizado: 0, borDtaMvto, gerNum}` |
| Listar baixas do borderô | `POST /api/fin014/baixas/list` com `filterList: {"borCod#EQ": "135"}` e `serviceName: "fin014.FinBaixa"` |
| Grid de cheques (não é a lista de baixas) | `POST /api/fin014/baixas/list3/{borCod}` |
| Gravar baixa | `POST /api/fin014/baixas` — exige **`titCod`**; `titEspNumero` sozinho devolve `CnxValidatorCod/required` |
| Validações | `POST /api/fin014/validacoes/{borCod}` |
| Lotes contábeis do borderô | `POST /api/fin014/lotesContabeis/{borCod}` |
| Lançamentos contábeis do borderô | `POST /api/fin014/lancamentosContabeis/{borCod}` |
| Excluir baixa | `DELETE /api/fin014/baixas/{borCod}/{docTip}/{docCod}/{titCod}/{bxaCodSeq}` |
| Excluir borderô | `DELETE /api/fin014/{borCod}` — recusa com `CHILDRECORDFOUND` se ainda houver baixa |
| LOV de títulos abertos | `POST /api/lov/TituloBorderoReceber` — exige `filterList: {exibirTitulos: 1, borVldFinalizado: 0}` |

**Diferença de payload que vale registrar** (não é a causa, mas é divergência real): a UI grava a baixa
com `bxaVldCcorrente: 1` e `bxaVldCorrenteDc: 1`; a nossa gravou o 135 com `bxaVldCcorrente: 0`. O
borderô 137 usou os valores da UI e falhou igual, então isso está descartado como causa — mas convém
alinhar quando a perna voltar a funcionar.

## 7. Resíduos e limpeza no HML

Deixei o ambiente **como estava antes desta sessão**:

- Borderôs **136** e **137** e suas baixas: **excluídos** (confirmado por `RECORDNOTFOUND`).
- Títulos **736** e **737** (SKYJACK, R$ 123,45): de volta à lista de abertos — 20 títulos abertos na filial 2.
- Borderôs **133** e **135**: intactos, ainda `EM CADASTRO`, com baixa e sem finalizar. Documento **738** segue amarrado ao 135.

Nada foi finalizado. Nenhum lançamento contábil foi criado.

## 8. O que isso significa para produção

Duas coisas verdadeiras ao mesmo tempo:

- Em produção essa perna **já funcionou**: o HAR da SN 18345 tem o `fin014/finalizar` retornando OK. E
  a causa provável aqui é estado do banco de homologação, que não se transporta para lá.
- Mas a perna `fin014 → NDe` **continua sem nunca ter sido vista em homologação**, e essa lacuna do
  handoff anterior permanece aberta. A diferença é que agora sabemos *por que* ela não fecha, e que a
  razão não é código nosso.

## 9. Próximos passos propostos

1. **Abrir chamado com a Conexos / NTT.** A evidência forte é que a **própria UI deles falha**. Levar:
   versão `3.65.00.162`, cliente `columbiatrading-hml`, filial 2, usuário `MPS_FRANCINEI`, e o fato de
   que `POST /api/fin014/validacoes/{borCod}` falha sozinho em **qualquer** borderô a receber com baixa,
   inclusive um recém-criado pela UI com título de terceiro.
2. **Testar a mesma montagem na filial 1.** Se o defeito for de dados por filial, a perna roda lá e a
   gente consegue o verde que falta antes de produção. Exige trocar o contexto de filial na sessão e
   verificar se a SN pode nascer na filial 1.
3. **Tratar esse erro como não-retentável no código.** Ele é determinístico, não transitório: retentar
   nunca vai passar. Vale distinguir na política de retry e no ledger — conversa direta com o follow-up
   de *checkpoint intra-etapa* do Regis-Review, apontado por três lentes independentes.
4. **Avaliar a chamada `fin014/baixas/validacao/tituloBaixa`.** A UI não a faz. Não é a causa deste erro,
   mas é uma chamada a mais contra o ERP cuja necessidade não está demonstrada.
5. **Fechar o pipe** (ver §7 do handoff anterior): bump — o Yuri sinalizou **0.20.0**, leitura contra a
   `main`, que inclui os `feat` do colega —, `CHANGELOG.md`, commit `chore(release)`, rebase e PR.

## 10. Decisões que continuam esperando o Yuri

As três do handoff anterior seguem abertas (condição de pagamento sugerida para o SKYJACK no HML para
tornar o ramo condicional testável; idioma das mensagens de erro; `ontology/CHANGELOG.md` parado em
v0.3.0), mais a escolha do próximo passo entre chamado, teste na filial 1, ou os dois.

## 11. Arquivos desta sessão

| Arquivo | Para quê |
|---|---|
| `src/backend/routes/recebimentos.e2e.hmlBordero.integration.test.ts` | sonda de leitura do borderô 135 — as rotas dela precisam ser corrigidas conforme a §6 |
| `C:/tmp/probe-bordero-hml.json` | saída completa daquela sonda |
| `docs/e2e/HANDOFF-proxima-sessao.md` | estado geral do trabalho — **continua sendo a leitura principal** |
| `ontology/_inbox/com299-sn-generation-har.md` | HAR de produção da SN 18345, onde o `fin014/finalizar` deu OK |

---

## 12. Encaminhamento dos §9 (sessão de 2026-08-03, tarde)

### 12.1 — Item 3 (erro não-retentável): **feito**, ADR-0026

Virou `/feature-tweak` próprio, na branch `fix/erp-4xx-nao-retentavel` (worktree `C:/tmp/erp4xx-wt`). O
defeito tinha **duas** manifestações, não uma:

| Onde | Antes | Depois |
|---|---|---|
| `ConexosError` | `retryable = true` e `statusCode = 504` sempre | derivados do status do upstream |
| `ConexosBaseClient` (`RetryExecutor`) | sem `shouldRetry` → default `() => true` | não retenta recusa determinística |

Recusa (4xx exceto 408/429) → `CONEXOS_UPSTREAM_REJECTED`, `retryable: false`, HTTP **502**, e a mensagem
do analista passa a carregar a **razão crua do ERP** em vez de "tente novamente em alguns minutos".
Indisponibilidade (sem resposta, 5xx, 408, 429, timeout declarado) segue retentável em 504.

A regra já **existia** — a política central do `RecebimentoPipelineService` dizia "um 4xx do ERP não é
retryable" — mas nada nunca marcava `retryable: false`. Era comentário, não comportamento.

Detalhe e alternativas recusadas: `ontology/decisions/0026-recusa-deterministica-do-erp.md`.

### 12.2 — Item 4 (`fin014/baixas/validacao/tituloBaixa`): **mantida**, com motivo

A chamada fica. A UI não a faz, mas ela não é redundância:

- é a **única validação do título antes da baixa** — o `assertNoErpError` sobre as `messages` dela é o
  que impede gravar uma escrita irreversível sobre um título que o ERP já tem ressalva;
- devolve o **em-aberto vivo** (`bxaMnyValor`), que é o valor que a baixa grava. O `titMnyAberto` do LOV
  é o mesmo número uma chamada antes — mas uma leitura antes, e é dinheiro;
- é o caminho **provado em produção** (SN 18345). Removê-lo para economizar um GET trocaria uma guarda
  por um round-trip, num passo que movimenta valor.

Fica de follow-up, e **só quando a perna voltar a rodar**, alinhar `bxaVldCcorrente`: a UI grava `1`, a
validação nos devolveu `0` no borderô 135. O borderô 137 usou os valores da UI e falhou igual, então isso
está descartado como causa — mas a divergência é real e não deve ser resolvida no escuro.

### 12.3 — Item 2 (filial 1): **executado — o defeito é do ambiente inteiro**

Rodado em 2026-08-03. **A filial 1 falha idêntico.** O HML está encerrado como fonte de informação para
esta perna; o chamado com a Conexos é o único caminho lá.

| | |
|---|---|
| Controle (filial 2, borderô 135, mesma sessão) | `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` — defeito ainda vivo |
| Filial 1 | borderô **26** criado, `validacao/tituloBaixa` **200**, baixa gravada (`bxaCodSeq 1`, R$ 83,24) |
| `POST fin014/validacoes/26` | `400 CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` |
| Limpeza | baixa excluída, borderô excluído, `RECORDNOTFOUND` confirmado |

Título usado: ORANGE BUSINESS SERVICES, doc 105 / `titCod` 4 / `titEspNumero` `100253` — de terceiro,
preexistente, alheio ao projeto. Conta financeira `gerNum 38` (BANCO ITAÚ ag. 0641 c/c 55.795-4).

**O que este resultado acrescenta ao diagnóstico.** O borderô da filial 1 é o **nº 26**; o da filial 2, o
**135**. Números completamente diferentes, mesma colisão. Isso elimina a última leitura de que o
identificador em conflito derive do borderô, da filial ou dos dados do título. O que colide é uma
sequência **global do ambiente** — a do registro de resultado de validação —, coerente com banco
restaurado de produção sem reposicionar a sequência. É exatamente o argumento a levar no chamado.

Dois achados laterais que valem registro:

- A `validacao/tituloBaixa` devolveu `bxaVldCcorrente: 1` aqui, contra `0` no borderô 135. A divergência
  com a UI (§6) é **dependente de dado**, não bug nosso — some da lista de suspeitas.
- Ela também trouxe `AVISO FIN_014.PESSOA_POSSUI_ADIANTAMENTO` (`docCods: "9"`) junto de `SUCESSO`. O
  `assertNoErpError` corretamente não barra em aviso. Reforça o §12.2: essa chamada é guarda, não enfeite.

Instrumento: `src/backend/routes/recebimentos.e2e.hmlFilial1Bordero.integration.test.ts` — segue válido
para reconferir o ambiente depois que a Conexos mexer nele.

### 12.3.1 — o instrumento (como ele se protege)

`src/backend/routes/recebimentos.e2e.hmlFilial1Bordero.integration.test.ts` monta na filial 1 o mínimo
que discrimina — borderô + baixa sobre um título de terceiro já aberto — chama `validacoes` e **desfaz
tudo**. Nunca chama `finalizar` (escreveria lançamentos contábeis sobre título alheio, irreversível pela
API). Traz um braço de **controle** que remede o borderô 135 na filial 2 na mesma sessão, para que um
verde na filial 1 não seja confundido com "a Conexos consertou o ambiente".

### 12.4 — Itens 1 e 5: seguem com o Yuri

Abrir o chamado com a Conexos/NTT e fechar o pipe (bump, PR) são ações para fora.
