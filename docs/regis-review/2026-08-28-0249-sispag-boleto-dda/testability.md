---
qa: Testability
qa_slug: testability
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-testability
generated_at: 2026-08-28T02:49:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta sispag-boleto-dda)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedora reverte silenciosamente a associação DDA no import (ou coerce `titEspCodbar ?? ''` volta) | `git commit` + `npm test` na CI | `ConexosSispagWriteClient.importarTitulos` + `RemessaService.montarItensImport` | Feature branch pré-merge; unidade sem ERP | ≥1 teste unitário FALHA e nomeia a regressão sem exigir subir HML | Regressão de escrita ao ERP é pegada em < 5 s pelo Jest local; 0 quebras em produção ligadas a este delta |

## 2. Métricas observadas

### 2.1 Cobertura por arquivo tocado no delta (Métrica-âncora)

| Arquivo | LOC fonte | LOC teste | Ratio | Testes | Alvo (Bass ≥ 0.5) | Status | Fonte |
|---|---|---|---|---|---|---|---|
| `ConexosSispagWriteClient.ts` | 755 | 755 | **1.00** | 37 `it()` | ≥ 0.5 | ✅ | `wc -l` + `grep -c '^\s*it('` |
| `RemessaService.ts` | 971 | 1011 | **1.04** | 47 `it()` | ≥ 0.5 | ✅ | idem |
| `IngestaoPagamentosService.ts` | 207 | 225 | **1.09** | 11 `it()` | ≥ 0.5 | ✅ | idem |
| `SispagPainelService.ts` | 390 | 377 | **0.97** | 19 `it()` | ≥ 0.5 | ✅ | idem |
| `LoteCard.tsx` (frontend) | 503 | 0 | **0.00** | 0 | ≥ 0.3 | ⚠️ | `find src/frontend/app/sispag -name '*.test.tsx'` |
| `app/sispag/page.tsx` | 1068 | 0 | **0.00** | 0 | ≥ 0.3 | ⚠️ | idem |
| `lib/sispag.ts` | 619 | 0 | **0.00** | 0 | ≥ 0.3 | ⚠️ | idem |

> Contexto: o repo tem 123 arquivos de teste backend / ~500+ fontes → ratio global ~0.24. Os arquivos deste delta estão MUITO acima da média — o delta é um dos mais bem testados que passaram pelo Regis-Review neste repo.

### 2.2 Métricas específicas do delta

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes novos vs delta (BE) | +24 (1476 → 1500) | ≥ 1 por caminho crítico novo | ✅ | `_shared-metrics.md` |
| Testes novos por caminho novo do WriteClient | 9 (associarDda × 2 níveis, allowlist × 2, laço, propagação 1-por-item, listarTitulosComBoletoDda × 2) | ≥ 6 | ✅ | inspeção do `describe('boleto DDA …')` |
| Testes novos do RemessaService (boleto) | 6 (DDA presente/ausente, mensagem nomeia título, titEspCodbar null, item não-boleto, lote misto) | ≥ 4 | ✅ | inspeção |
| `expect(...).not.toHaveBeenCalled()` em caminhos de gate | 12 usos em arquivos do delta | ≥ 1 por gate financeiro | ✅ | `grep -c 'not.toHaveBeenCalled' <arquivos>` |
| Fixtures de contrato atualizadas para o novo shape | 1/1 (`fin015-titulo-pendente.json` inclui `titVldReflexoDdaAssoc`/`Desassoc`) | 100% dos campos novos lidos pelo código | ✅ | `cat 2026-08-25-fin015-titulo-pendente.json` + `contrato.test.ts:52-53` |
| Fixture do envelope `QUESTION` do ERP | 0 (não capturada) | 1 (chave `id`, `answers` map) | ⚠️ | `ls src/backend/domain/interface/sispag/__fixtures__/` |
| Testes de HTTP real em unit suites | 0 | 0 | ✅ | `grep -rn 'axios\.\\|fetch(' src/backend/domain --include='*.test.ts' \| grep -v mock` |
| Testes com estado compartilhado (`beforeAll` sem reset) | 0 nos 4 arquivos do delta | 0 | ✅ | `grep -n 'beforeAll' <arquivos>` |
| Non-determinismo (Date.now/new Date) em fonte tocada | 4 leituras (`IngestaoPagamentos:112`, `SispagPainel:85/153`, `RemessaService:948`) sem `ClockProvider` | 0 (via provider) | ⚠️ | `grep 'Date.now\\|new Date()' <fontes>` |
| Randomness (Math.random/UUID) em fonte tocada | 0 | 0 | ✅ | `grep -rn 'Math.random\\|randomUUID' <fontes>` |
| Coverage gate no CI | ⚠️ **Não medível localmente** — `--quick`; `jest.config` não tem `coverageThreshold` | ≥ 70% lines nos services do SISPAG | ⚠️ | `grep 'coverageThreshold' src/backend/jest.config.*` |

> ⚠️ **Não medível localmente**: cobertura de linhas exata dos arquivos do delta (bloco `--quick` proíbe rodar `--coverage`). Métrica-âncora usada: LOC-de-teste / LOC-de-fonte. As 4 unidades tocadas todas ≥ 0.97 é um sinal forte, mas não substitui coverage. Recomendação: rodar `npm test -- --coverage --testPathPattern=sispag` no gate final.

### 2.3 Análise de FORÇA dos novos testes (Bass: teste que passa mesmo revertendo a fonte é ruído)

| Teste novo | Detecta a regressão específica? | Como sei |
|---|---|---|
| `não manda mais titEspCodbar VAZIO` (`RemessaService.test.ts:962-973`) | ✅ Sim | Se alguém readicionar `titEspCodbar: raw.titEspCodbar ?? ''` (linha 936 do fonte antigo), o `raw.titEspCodbar = null` vira `''` no spread e `expect(itens[0].titEspCodbar).toBeNull()` falha. **Prova que o teste morde a regressão exata que causou o bug em PRD.** |
| `envelope com 2 perguntas não é auto-respondível` (`ConexosSispagWriteClient.test.ts:322-343`) | ✅ Sim | Guarda `questions.length !== 1` em `perguntaAutoRespondivel:577`. Reverter para `some()` faria `postGenericOnce` ser chamado 2×; o teste asserta `toHaveBeenCalledTimes(1)` + `ErpPerguntaError`. |
| `pergunta repetida não vira laço` (`ConexosSispagWriteClient.test.ts:345-358`) | ✅ Sim | Mocka a mesma pergunta 2× e exige exatamente 2 POSTs + `ErpPerguntaError`. Se alguém trocar o `catch` interno por um `while`, o teste chama 3× e falha. |
| `responde YES à pergunta e reenvia o MESMO body` (`:276-295`) | ✅ Sim | Asserta `answers: { '1': 'YES' }` chaveado pelo `id` E `items` idênticos entre 1º e 2º POST. Regressão para chaveamento por `key` ou array quebra o `.toMatchObject`. |
| `BOLETO SEM boleto DDA → erro antes de escrita` (`RemessaService.test.ts:935-949`) | ✅ Sim | `expect(write.importarTitulos).not.toHaveBeenCalled()` + `.gerarRemessa).not.toHaveBeenCalled()` — o gate é comprovado ANTES de qualquer POST no ERP. |
| `lote misto → uma chamada por grupo` (`:983-1010`) | ✅ Sim | `flags = write.importarTitulos.mock.calls.map(([p]) => p.associarDda)` → `[false, true]`. Reverter para uma chamada única falha por `toHaveBeenCalledTimes(2)`. |
| `IngestaoPagamentosService: banco sai da conta pagadora da FILIAL` (`:192-198`) | ✅ Sim | Chama `listBoletoDda` verificando `{ filCod: 2, bncCod: 7 }` — se alguém fixar `bncCod: 4`, o `toHaveBeenCalledWith` quebra. |

**Veredito**: os 24 testes novos são FORTES no sentido de Bass — cada um vincula um comportamento não-trivial a uma asserção que morde a regressão exata que o teste supõe estar defendendo.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | Todos os 4 arquivos do delta expõem seams via constructor injection (tsyringe). Testes constroem `new SomeService(mocksAsAny)` — não `container.resolve()`. | ✅ presente | `RemessaService.test.ts:176-184`; `ConexosSispagWriteClient.test.ts:15-16`; `IngestaoPagamentosService.test.ts:80-89` |
| **Record/Playback (Recorded Test Cases)** | Fixtures reais capturadas em PRD, redigidas, persistidas em `__fixtures__/*.json` e cobertas por `contrato.test.ts`. Fixture `2026-08-25-fin015-titulo-pendente.json` foi atualizada para incluir os campos DDA novos. | ✅ presente | `src/backend/domain/interface/sispag/__fixtures__/`; `contrato.test.ts:52-53` |
| **Localize State Storage** | Testes reconstroem o mundo por caso via builders (`buildBase`, `buildLoteRepo`, `buildWrite`, `buildLedger`). Nenhum `beforeAll` compartilhando fixture entre `it()`s. | ✅ presente | Contagem: 0 `beforeAll` nos 4 arquivos; helpers em cada arquivo (linhas 8-14, 75-141, etc.) |
| **Abstract Data Sources** | `ConexosBaseClient` é injetado como mock nos testes do write client (isola-se do HTTP real). `PostgreeDatabaseClient` idem via `buildDb`. | ✅ presente | `ConexosSispagWriteClient.test.ts:8-16`; `RemessaService.test.ts:160-165` |
| **Sandbox** | Sondas em `src/backend/jobs/probe-*.ts` executam contra HML real com guard `if (!BASE.includes('-hml')) process.exit(1)`. 7 sondas novas neste delta, 3 delas ESCREVEM em HML. | ✅ presente (com ressalva P2 em `deployability`) | `probe-dda-assoc-write-hml.ts:30-34`; `probe-dda-answer-shape-hml.ts:23-27` |
| **Executable Assertions** | Uso disciplinado de `expect(...).not.toHaveBeenCalled()` para provar que gates BLOQUEIAM antes de qualquer escrita ao ERP. 12 usos nos arquivos do delta em pontos financeiramente críticos. | ✅ presente | `RemessaService.test.ts:216-217, 233, 273-274, 355, 442, 482, 513, 810, 822, 887, 947-948`; `ConexosSispagWriteClient.test.ts:319, 342, 411` |
| **Limit Structural Complexity** | Testes seguem 1 comportamento = 1 `it()`; builders privados evitam mock-scaffolding repetido; describes aninhados por cenário. | ✅ presente | `RemessaService.test.ts` — 10 `describe` aninhados, 47 `it()`, cada um ≤ ~40 LOC |
| **Limit Nondeterminism (tempo)** | Fontes tocadas fazem 4 leituras diretas de `Date.now()`/`new Date()` sem `ClockProvider`. Os testes contornam com timestamps fixos (`1_790_000_000_000`) e mocks de `runRepo.findLatestSuccessFinishedAt`, mas a fonte segue não-controlável. | ⚠️ parcial | `IngestaoPagamentosService.ts:112`; `SispagPainelService.ts:85,153`; `RemessaService.ts:948` — nenhum via provider injetável |
| **Limit Nondeterminism (rede)** | 0 chamadas HTTP reais em unit tests. Todas as escritas ao Conexos são via mock do `ConexosBaseClient.postGenericOnce`. | ✅ presente | `grep -rn 'axios\\|fetch(' src/backend/domain --include='*.test.ts'` → 0 hits fora de mock |
| **Limit Nondeterminism (ordem)** | Testes de ordem usam `mock.invocationCallOrder` explicitamente. Nenhum teste depende de ordem de `describe` externo. | ✅ presente | `RemessaService.test.ts:317-319` (marca d'água antes de criarLote); `:696-706` (flpCod antes de import) |

## 4. Findings

### F-testability-1: Payload de boleto DDA não asserta ausência de `pctCodSeq`/`itsNumBanco`/`conta`

- **Severidade**: P2 (médio — regressão silenciosa em campo de destino do pagamento)
- **Tactic violada**: Executable Assertions (o teste existe mas não morde o cenário)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.test.ts:922-933` (teste positivo) vs. `RemessaService.ts:918-927` (código que decide não incluir os campos de conta)
- **Evidência (objetiva)**:
  ```ts
  // O teste existente asserta associarDda:true, mas NÃO asserta que os campos de conta sumiram
  expect(write.importarTitulos).toHaveBeenCalledWith(
      expect.objectContaining({ associarDda: true }),
  );
  // Se alguém reverter para SEMPRE chamar listContasFavorecido (removendo a guarda `!associarDda`
  // em RemessaService:889), o boleto voltaria a levar pctCodSeq/itsNumBanco/conta no payload
  // — e o ERP possivelmente rejeitaria ou mixaria a modalidade. Este teste seguiria VERDE.
  ```
- **Impacto técnico**: um refactor bem-intencionado que "unificasse" o `montarItensImport` para boleto e não-boleto reintroduziria a chamada `listContasFavorecido` para boleto e adicionaria os campos `pct*` ao payload. Sem asserção negativa, a regressão passa nos testes e vai para PRD.
- **Impacto de negócio**: baixo-médio. O ERP possivelmente aceitaria (mandar campo extra num payload aceitável), mas fica dependente da tolerância do ERP a campos extras — e o ADR-0040 diz explicitamente que boleto DDA "não tem favorecido com conta corrente".
- **Métrica de baseline**: 0 `expect(itens[0]).not.toHaveProperty('pctCodSeq')` em testes de boleto DDA. Alvo: 1.

### F-testability-2: Re-POST com falha NÃO-QUESTION não tem teste dedicado

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (caminho de exceção não coberto)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:556-566` (segundo POST dentro do catch)
- **Evidência (objetiva)**:
  ```ts
  try {
      await this.base.postGenericOnce<unknown>(
          path,
          { ...body, answers: { [idPergunta]: 'YES' } },
          { filCod },
      );
  } catch (causeAposResposta) {
      throw this.toConexosError(path, causeAposResposta);   // ← este catch só é testado
                                                            //   com QUESTION repetida
  }
  ```
  Testes existentes cobrem: (a) 2º POST OK; (b) 2º POST devolve QUESTION igual → `ErpPerguntaError`. **Não coberto**: 2º POST devolve `VALIDATION_LIST` ou 500 (`AxiosError` genérico). O ledger foi persistido como `reconciling`, e a orquestração espera que o erro suba como `ConexosError` — se `toConexosError` transformar em outra coisa, a retomada pode divergir.
- **Impacto técnico**: se um bug fizer o 2º POST devolver `VALIDATION` (ex.: pergunta respondida `YES` mas o item ficou inconsistente por concorrência), o wrapping é feito por `toConexosError` — que também detecta `QUESTION` primeiro. O caminho está estruturalmente correto por construção, mas não há prova executável.
- **Impacto de negócio**: baixo — o comportamento parece correto por inspeção; sem teste, uma refatoração futura pode divergir.
- **Métrica de baseline**: 0 testes cobrindo `postGenericOnce.mockRejectedValueOnce(perguntaBarcode).mockRejectedValueOnce(validationError({type:'VALIDATION_LIST',…}))`. Alvo: 1.

### F-testability-3: Fixture do envelope `QUESTION` do ERP não está no contract test

- **Severidade**: P3 (baixo — cross-QA com integrability-*)
- **Tactic violada**: Record/Playback
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/` — 17 JSONs, nenhum é uma resposta `type:'QUESTION'`
- **Evidência (objetiva)**:
  ```bash
  $ ls src/backend/domain/interface/sispag/__fixtures__/ | grep -i question
  # (vazio)
  ```
  O contrato do endpoint `importarTitulos` inclui uma variante `400 {type:'QUESTION', questions:[{id, key, answerList}]}` — este é o SHAPE mais sensível do delta (o `id` como chave de `answers` foi descoberto em HML no dia 2026-08-27; se o ERP mudar para chaveamento por `key`, o teste unitário mockado continua verde porque estamos "de acordo com nós mesmos"). Um fixture real deste envelope, coberto por `contrato.test.ts`, é o único mecanismo que morde essa deriva.
- **Impacto técnico**: se o Conexos migrar o campo `id` para `questionId` ou mudar o wrapping de `answers`, a próxima remessa de boleto DDA em PRD estoura sem nenhum teste vermelho no CI.
- **Impacto de negócio**: alto-condicional. Baixa probabilidade (ERPs raramente mudam contratos), mas se acontecer o `.REM` sai sem código de barras e o banco rejeita o lote inteiro.
- **Métrica de baseline**: 0/1 fixtures de envelope QUESTION. Alvo: 1 (`2026-08-27-fin015-question-barcode.json` + entrada em `CONTRATOS`).

### F-testability-4: `listarTitulosComBoletoDda` sob truncamento de `maxPaginas` não tem teste

- **Severidade**: P3 (baixo — impacto operacional condicional a filial > 20k pendentes)
- **Tactic violada**: Limit Nondeterminism (silent truncation)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:439-462`
- **Evidência (objetiva)**:
  ```ts
  public listarTitulosComBoletoDda = async (params: {
      filCod: number; bncCod: number; maxPaginas?: number;
  }): Promise<Set<string>> => {
      // ...
      const pendentes = await this.listarTitulosPendentes({
          filCod, bncCod, flpCod: contexto,
          ...(maxPaginas !== undefined ? { maxPaginas } : {}),
      });
      return new Set(pendentes.filter((p) => p.temBoletoDda).map(...));
  }
  ```
  Se `listarTitulosPendentes` bater `maxPaginas = 40` (default) e truncar em 20k linhas, o Set devolvido está incompleto. `listarTitulosPendentes` chama `console.warn`, e existem 5 testes para essa truncagem — mas nenhum prova que o CHAMADOR (`listarTitulosComBoletoDda`) propaga o aviso ou fal-closes. A ingestão marca `temBoleto:false` calado, e a analista tenta boleto → `BoletoSemCodigoBarrasError` na geração.
- **Impacto técnico**: em filiais grandes, títulos que TÊM boleto DDA aparecem como "sem boleto" na tela, a analista escolhe TED, o pagamento sai por outro rail. Não é perda, mas é degradação silenciosa.
- **Impacto de negócio**: baixo em Columbia hoje (medido: fil 2 = ~2020 pendentes = 5 páginas). Cresce linearmente com a carteira.
- **Métrica de baseline**: 1 teste (`listarTitulosPendentes:550-566` cobre a truncagem); 0 testes de propagação para `listarTitulosComBoletoDda`. Alvo: 1 (`chama com maxPaginas=1, retorna Set incompleto, e o chamador CONSEGUE detectar (log/flag/throw)`).

### F-testability-5: Nova coluna "Boleto" e aviso de LoteCard sem teste frontend

- **Severidade**: P3 (baixo — pattern pré-existente de todo `app/sispag/`)
- **Tactic violada**: Specialized Interfaces (frontend)
- **Localização**: `src/frontend/app/sispag/page.tsx:718-739` (coluna Boleto) + `src/frontend/app/sispag/components/LoteCard.tsx:420-424` (aviso "sem boleto DDA — a remessa sairia sem código de barras")
- **Evidência (objetiva)**:
  ```bash
  $ find src/frontend/app/sispag -name '*.test.tsx'
  # (vazio — 0 arquivos)
  $ find src/frontend/app/recebimentos -name '*.test.tsx' | wc -l
  6
  ```
  A pasta `app/sispag/` inteira nunca teve teste — 1590 LOC de UI (page + LoteCard + AdicionarTituloDialog + IngestaoDialog) sem 1 `render()`. O delta não CRIOU essa dívida, mas também não deu passo em direção a saná-la. Recebimentos, que é a frente mais nova, tem 6 arquivos de teste para 4 componentes.
- **Impacto técnico**: mudanças em `LoteCard.tsx` (que já é 503 LOC) são cegas. O novo aviso condicional (`i.modalidade === 'BOLETO'` ternário dentro de outro ternário) é frágil.
- **Impacto de negócio**: o teste manual da analista pega bugs de UI; a ausência aumenta o custo de cada revisão.
- **Métrica de baseline**: 0 testes em `src/frontend/app/sispag/` para 3 componentes / 1590 LOC. Alvo mínimo: 1 teste por componente (3 arquivos).

## 5. Cards Kanban

### [testability-1] Asserção negativa: boleto DDA não deve levar `pctCodSeq`/`conta` no payload

- **Problema**
  > O teste `'BOLETO com boleto DDA → import pede a associação ao ERP'` asserta apenas `associarDda:true`, mas não prova que o payload OMITE os campos de conta do favorecido (`pctCodSeq`, `itsNumBanco`, `conta`, `agencia`). Reverter a guarda `!associarDda` em `RemessaService.ts:889` (que evita chamar `listContasFavorecido` para boleto) passaria pelo CI verde.

- **Melhoria Proposta**
  > Adicionar em `RemessaService.test.ts` (após o teste `'BOLETO com boleto DDA → import pede a associação ao ERP'`) uma asserção negativa explícita sobre o payload de importação: `expect(payload.itens[0]).not.toHaveProperty('pctCodSeq')` e `expect(payload.itens[0]).not.toHaveProperty('conta')`. Também asserta positivamente que `listContasFavorecido` **não foi chamado** para o boleto. Tactic Bass: Executable Assertions.

- **Resultado Esperado**
  > Regressão que reintroduza `listContasFavorecido` no caminho de boleto DDA é pega em `npm test` local, sem depender de HML.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Asserções negativas sobre payload de boleto DDA: 0 → 3 (pctCodSeq, itsNumBanco, conta)
  - `expect(sispag.listContasFavorecido).not.toHaveBeenCalled()` em teste de boleto DDA: 0 → 1
- **Risco de não fazer**: um refactor de "unificar caminhos" reintroduz campos que o ADR-0040 diz não deverem ir; ERP possivelmente aceita mas silencia; auditoria fica confusa.
- **Dependências**: nenhuma.

### [testability-2] Teste do re-POST com falha não-QUESTION

- **Problema**
  > O caminho `catch (causeAposResposta)` em `ConexosSispagWriteClient.ts:563-566` só é exercido com QUESTION repetida ou sucesso. Um 2º POST devolvendo `VALIDATION_LIST` ou 500 tem comportamento correto por inspeção, mas sem teste — qualquer refatoração de `toConexosError` pode divergir sem sinal.

- **Melhoria Proposta**
  > Em `ConexosSispagWriteClient.test.ts`, adicionar dois casos no describe `'boleto DDA'`: (a) `postGenericOnce.mockRejectedValueOnce(perguntaBarcode).mockRejectedValueOnce(validationError({type:'VALIDATION_LIST',messages:[{vars:{msg:'algo'}}]}))` → asserta `ConexosError` com a msg do ERP; (b) mesmo, mas com um erro axios sem `response.data` → asserta `ConexosError` genérico.

- **Resultado Esperado**
  > O caminho de erro do segundo POST tem cobertura por asserção, protegendo o contrato "sempre sobe como `ConexosError` (não como Error cru) quando não é pergunta".

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes cobrindo 2º POST com erro não-QUESTION: 0 → 2
  - Ramos do `catch (causeAposResposta)` exercidos: 0/2 → 2/2
- **Risco de não fazer**: uma refatoração futura de `toConexosError` (por exemplo, para logar antes de embrulhar) pode alterar o tipo do erro que sobe da retomada, sem alerta local.
- **Dependências**: nenhuma.

### [testability-3] Fixture real do envelope QUESTION coberta pelo contract test

- **Problema**
  > O envelope `{type:'QUESTION', questions:[{id, key, answerList}]}` é o shape MAIS sensível do delta (`id` como chave de `answers` foi descoberto ao vivo em 2026-08-27). Existe zero fixture real desse shape em `__fixtures__/` e zero entrada em `contrato.test.ts:CONTRATOS`. Se o Conexos renomear `id` ou mudar o wrapping de `answers`, o `.REM` de boleto DDA sai sem código de barras em PRD e nada acusa antes.

- **Melhoria Proposta**
  > Capturar (via `probe-dda-answer-shape-hml.ts` — já escreve para `/tmp/`), redigir e commitar `__fixtures__/2026-08-27-fin015-question-barcode.json`. Adicionar entrada em `CONTRATOS` de `contrato.test.ts` com `campos: ['type', 'questions[0].id', 'questions[0].key', 'questions[0].answerList[0].id']` (adaptar o `carregar` para aceitar shape aninhado). Tactic Bass: Record/Playback. Cross-QA: reforça `integrability-*` (mesmo achado por lá).

- **Resultado Esperado**
  > Mudança contratual do envelope QUESTION do Conexos vira CI vermelho antes de mover dinheiro.

- **Tactic alvo**: Record/Playback (Recorded Test Cases)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 2h — a sonda já existe)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Fixtures de envelope QUESTION: 0 → 1
  - Campos do envelope cobertos por `contrato.test.ts`: 0 → 4
- **Risco de não fazer**: baixa probabilidade × alto impacto — se o Conexos mudar `id` → `questionId`, o teste unitário permanece verde (mocka o que ele mesmo desenhou); a quebra vira incidente em PRD.
- **Dependências**: `integrability-*` (podem compartilhar a fixture; alinhar naming).

### [testability-4] Teste de propagação de truncamento em `listarTitulosComBoletoDda`

- **Problema**
  > `listarTitulosPendentes` alerta via `console.warn` quando trunca em `maxPaginas`. Existem 5 testes disso — mas nenhum prova que o CHAMADOR `listarTitulosComBoletoDda` sinaliza o problema. Em filial > 20k pendentes, títulos com boleto DDA aparecem como "sem boleto" na tela; a analista escolhe TED e o pagamento sai por outro rail sem que ninguém saiba.

- **Melhoria Proposta**
  > Em `ConexosSispagWriteClient.test.ts` (dentro de `describe('listarTitulosComBoletoDda')`), adicionar caso: `gridDe(10_000)` + `maxPaginas: 2` + asserção de que ou (a) `console.warn` foi chamado pelo caminho de baixo, ou (b) o método retorna sinal de truncamento (novo). Se a decisão for (b), estender o retorno para `{ chaves: Set<string>, truncado: boolean }` — decisão do card `performance-*` associado.

- **Resultado Esperado**
  > A truncagem silenciosa vira sinal auditável nos serviços consumidores; ingestão e painel podem decidir logar warning específico do "boleto DDA incompleto".

- **Tactic alvo**: Limit Nondeterminism
- **Severidade**: P3
- **Esforço estimado**: S (teste) / M (se mudar o contrato do método)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Teste de truncagem em `listarTitulosComBoletoDda`: 0 → 1
  - Sinais auditáveis de truncagem no caminho DDA: 0 → 1 (log ou flag)
- **Risco de não fazer**: crescimento da carteira leva a boletos "sumindo" da tela sem ninguém notar.
- **Dependências**: cross-QA com `performance-3` (paginação já é finding de lá) e `fault-tolerance-*`.

### [testability-5] Fatia mínima de teste de UI para `app/sispag/`

- **Problema**
  > A pasta `src/frontend/app/sispag/` tem 1590 LOC de UI e 0 testes — pattern pré-existente que este delta não sanou nem piorou, mas a nova coluna "Boleto" (`page.tsx:718-739`) e o aviso condicional em `LoteCard.tsx:420-424` estão sem asserção. Recebimentos, frente vizinha, tem 6 arquivos de teste.

- **Melhoria Proposta**
  > Criar `src/frontend/app/sispag/page.test.tsx` cobrindo os 2 caminhos da coluna Boleto: (a) `t.temBoleto = true` renderiza badge com `<Barcode>` e texto "boleto"; (b) `t.temBoleto = false` renderiza texto "sem boleto" com o tooltip. Criar `LoteCard.test.tsx` cobrindo o aviso `'sem boleto DDA — a remessa sairia sem código de barras'` quando `modalidade === 'BOLETO'` e não está em `avail`. Espelhar a estrutura de `recebimentos/components/NdeTable.test.tsx`.

- **Resultado Esperado**
  > Cria a base para novos testes de frontend do SISPAG; a coluna Boleto e o aviso de LoteCard passam a ter regressão detectável sem depender de QA manual.

- **Tactic alvo**: Specialized Interfaces (frontend)
- **Severidade**: P3
- **Esforço estimado**: M (2-3h para os 2 arquivos + setup)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Arquivos de teste em `src/frontend/app/sispag/`: 0 → 2
  - Testes cobrindo a coluna Boleto: 0 → 2
  - Testes cobrindo o aviso condicional de LoteCard: 0 → 1
- **Risco de não fazer**: a próxima mudança em `LoteCard.tsx` (503 LOC, complexidade cognitiva alta) é cega; a coluna Boleto pode quebrar por refactor sem que ninguém saiba até a analista abrir a tela.
- **Dependências**: nenhuma; padrão de teste já está em `recebimentos/`.

## 6. Notas do agente

- **Decisão de escopo**: foquei nos 4 arquivos citados (`ConexosSispagWriteClient`, `RemessaService`, `IngestaoPagamentosService`, `SispagPainelService`) e nos 2 arquivos frontend tocados; não abri finding por `Date.now()` sem `ClockProvider` porque é dívida pré-existente do template (todo o repo faz assim) — vai em modifiability.
- **Coverage `--quick`**: não rodei `jest --coverage`. Ancorei a análise em LOC-de-teste / LOC-de-fonte por unidade (métrica 2.1) + contagem de `it()` + leitura dos testes para provar mordida. Se coverage for exigido, rodar apenas nos 4 arquivos: `npm test -- --coverage --collectCoverageFrom='src/backend/domain/{service/sispag,client}/**/*.ts' --testPathPattern='sispag|SispagWrite'`.
- **Cross-QA (para o consolidator)**:
  - F-testability-3 (fixture QUESTION) sobrepõe com `integrability-*` — mesmo dado, provavelmente mesmo card lá.
  - F-testability-4 (truncagem silenciosa) sobrepõe com `performance-3` (paginação) e `fault-tolerance-*` (fail-closed silencioso).
  - Sondas em `jobs/` (Sandbox tactic) sobrepõem com `deployability` (código de teste comitado no repo de produção; guard `-hml` é suficiente mas não é policy).
  - Ausência de `coverageThreshold` no `jest.config` sobrepõe com `deployability` (gate no CI).
- **Sinal positivo**: `contrato.test.ts` FOI atualizado no delta (fixture `2026-08-25-fin015-titulo-pendente.json` inclui os dois novos campos DDA). É um dos poucos repositórios em que o contract test move em passo com o código — vale explicitar em REPORT.md como boa prática replicável.
