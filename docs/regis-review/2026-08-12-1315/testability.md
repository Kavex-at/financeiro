---
qa: Testability
qa_slug: testability
run_id: 2026-08-12-1315
agent: qa-testability
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 8
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review

> Escopo: DELTA `fix/nde-descricao-item` (2 commits, `+1458/-13`). Avalio SÓ os testes/mocks/sondas que a
> branch acrescenta ou altera. A baseline da suíte (1132 pass / 14 fail) é herdada de `main` — as 14
> falhas foram reproduzidas em worktree pristino e portanto NÃO são regressão do delta; entram aqui
> como risco de baseline (ver F-testability-6).

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do time (ou Regis-Review) | Adição de um passo fiscal irreversível (etapa 3.5 `dprLngDescrNf`) com 4 fallbacks de descrição + retomada não-monotônica em cima do orquestrador da NDe | `RecebimentoNumerarioService` (+120 LOC de produção) e `ConexosNdeFiscalClient` (+203 LOC, 5 métodos novos) | `npm test` local, PR + CI (jest com `coverageThreshold`) | Cada RAMO novo do fluxo (no-op, vazio→grava, precedência dos 4 fallbacks, fail-closed, retomada obs-done, já-homologado, doc sem itens) tem teste que roda em ≤ 200 ms, isola o serviço via construtor (DI-friendly) e pina COMPORTAMENTO (`dprLngDescrNf` chegou ao ERP; ordem obs relativa preservada), não a implementação | ≥ 1 teste por ramo do delta, 0 chamadas de rede em unit tests, tempo por arquivo ≤ 5 s, discriminadores dos 4 fallbacks distinguíveis por FIXTURE (não colidem no texto) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por camada (delta)** — testes novos vs produção nova | 21 testes / ~323 LOC de produção nova = 6,5 testes por 100 LOC | ≥ 4 testes / 100 LOC em código fiscal irreversível | ✅ | 12 testes em `ConexosNdeFiscalClient.test.ts` + 9 em `RecebimentoNumerarioService.test.ts` (describe "etapa 3.5") contra +203/+120 LOC dos arquivos de produção |
| Ramos NOVOS do serviço com teste dedicado | 8/9 (no-op · vazio→grava · ordem antes-fiscal · preDescr · env fallback · fail-closed · sem-itens · retomada · já-homologado) | 9/9 | ⚠ | Falta ramo do fallback #4 (`NDE_GERACAO_DEFAULTS.produtoNome`) isoladamente distinguível — ver F-testability-1 |
| Ramos NOVOS do client com discriminador de sucesso pinado | 5/5 (eco `fisVldTipoNfDebito===6`, `fisEspObs` não-vazio, eco `dprLngDescrNf` não-vazio, recusa `descricao` vazia, `preDescr` never-throws) | 5/5 | ✅ | `ConexosNdeFiscalClient.test.ts:38-63,83-89,199-233,235-257` |
| Testes que injetam via construtor (não `container.resolve`) | 21/21 = 100 % | ≥ 90 % | ✅ | Ambos os testes novos usam `new Service(...mocks)` / `new Client(buildBase(...))` |
| Chamadas de rede reais em unit tests do delta | 0 | 0 | ✅ | Nenhum `axios.` / `fetch(` nos `.test.ts` do delta; sonda usa `.integration.test.ts` e está no `testPathIgnorePatterns` do jest.config |
| Uso de `new Date()` em CÓDIGO fonte novo do delta | 1 sítio novo (dry-run log em `RecebimentoNumerarioService.ts` — herdado, não do delta 3.5) | 0 sem clock injetável | ⚠ | `grep` não achou `new Date()` NO trecho da etapa 3.5; o serviço já lia data no fin014 (linha 1304) — herdado |
| Randomness em CÓDIGO fonte novo | 0 (o `randomUUID()` já existia na etapa homologar) | 0 sem provider | ✅ | — |
| Baseline red: testes falhando em `npm test` | 14 failing / 1132 passing | 0 red | ❌ | `_shared-metrics.md` — pré-existentes na `main`, verificados em worktree pristino |
| E2E de rota que cobre o ramo "descrição VAZIA → grava do prdDesNome" | 0 / 4 (os 4 e2e route tests só programaram o CAMINHO no-op) | ≥ 1 e2e cobrindo o ramo real (não o feliz) | ⚠ | `recebimentos.e2e.{test,retomada,falhas,gates}.test.ts` — todos devolvem `dprLngDescrNf: 'PAGAMENTO ANTECIPADO'` no fake ERP; não há e2e do ramo escrita |
| Fixture-discriminator collision dos fallbacks #3 e #4 | `prdDesNome` do item = `NDE_GERACAO_DEFAULTS.produtoNome` = `'PAGAMENTO ANTECIPADO'` — MESMA string | strings DISTINTAS por origem, para o teste provar de onde veio | ❌ | Ver F-testability-1 |
| Sonda diagnóstica sob controle | Read-only por allowlist de regex; qualquer verbo fora dispara `throw` antes do wire | manter | ✅ | `recebimentos.e2e.descricaoNfeNde.integration.test.ts:44-51,177-200` |
| CI enforce coverage floor | `coverageThreshold.global.lines=72`, `./domain/service/.lines=88`; `npm test -- --coverage` roda no `.github/workflows/ci.yml:27,46` | manter | ✅ | `src/backend/jest.config.cjs:34-44` |

> ⚠ **Não medível localmente**: `% de cobertura de branch NO delta` isolado — jest emite cobertura por arquivo, não por diff. Para o próximo run vale rodar `npx jest --coverage --changedSince=main --collectCoverageFrom='src/backend/domain/**/*.ts'` na branch e comparar branches por trecho `etapaDescricaoItem`/`resolverDescricaoItem`/`gravarDescricaoItemNde`.

## 3. Tactics — Cobertura no nf-projects (aplicada AO DELTA)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | O client novo expõe cada contrato ERP como método próprio (`lerItemNde`/`gravarDescricaoItemNde`/`preDescricaoProdutoNf`) — testes acoplam a esses seams, não à `ConexosBaseClient` raw | ✅ | `ConexosNdeFiscalClient.ts:257-419` e o teste `buildBase({over})` que troca só o verbo relevante |
| Recordable Test Cases | Sonda `recebimentos.e2e.descricaoNfeNde.integration.test.ts` dumpa o retorno das 6 rotas envolvidas para `<tmp>/nde-descricao-diagnostico.json`; unit tests do delta usam shapes derivados de HAR (doc 18337/18347) explicitados nos comentários | ⚠ parcial | Sonda existe (356 LOC), mas nenhum HAR "gravado" versionado em `__fixtures__` — os shapes vêm inline. Ver F-testability-4 |
| Sandbox | Sonda tem sandbox rígido (allowlist de rotas de leitura; verbos escrevem throwam antes do wire); execução unit sem I/O externo | ✅ | `recebimentos.e2e.descricaoNfeNde.integration.test.ts:177-200` |
| Executable Assertions | Discriminadores de sucesso escritos como asserções no CLIENT (eco `dprLngDescrNf` não-vazio; eco `fisVldTipoNfDebito===6`) — o serviço nunca precisa "adivinhar" se o ERP gravou | ✅ | `ConexosNdeFiscalClient.ts:145-152, 405-413` (asserção) + `ConexosNdeFiscalClient.test.ts:55-63,199-210` (teste) |
| Abstract Data Sources | DB stub no e2e via `PostgreeDatabaseClient` mockado (`buildFakeDb`); serviço testado com repositórios injetáveis (`SolicitacaoNumerarioExecucaoRepositoryInterface`) | ✅ | `RecebimentoNumerarioService.test.ts:203-217`; sonda registra fake DB antes do bootstrap |
| Limit Structural Complexity | `RecebimentoNumerarioService.test.ts` chega a **1692 LOC** — é o teste do orquestrador, mas está próximo do limite prático para leitura humana. A etapa 3.5 acrescentou ~166 LOC nesse mesmo arquivo em vez de um `RecebimentoNumerarioService.etapaDescricaoItem.test.ts` dedicado | ⚠ parcial | `wc -l` do arquivo; ver F-testability-2 |
| Limit Non-Determinism | Delta não introduz `new Date()` nem `Math.random()`/`randomUUID()` NOVOS; o único `new Date()` no fluxo (fin014 borderô, linha 1304) é herdado da main | ✅ (para o delta) | — |

## 4. Findings

### F-testability-1: Colisão de fixture entre fallbacks #3 (`prdDesNome`) e #4 (`NDE_GERACAO_DEFAULTS.produtoNome`) — o teste "descrição VAZIA: grava o prdDesNome" NÃO distingue de onde veio a string

- **Severidade**: P1
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:1528-1584`, `src/backend/domain/interface/recebimentos/constants.ts:364-366`
- **Evidência**:
  ```
  # constants.ts
  NDE_GERACAO_DEFAULTS = { produtoCod: 41978, produtoNome: 'PAGAMENTO ANTECIPADO', ... }

  # RecebimentoNumerarioService.test.ts:1528-1544  (comDescricaoVazia)
  listItensNde -> [{ ..., prdDesNome: 'PAGAMENTO ANTECIPADO' /* sem dprLngDescrNf */ }]

  # RecebimentoNumerarioService.test.ts:1572-1574  (asserção)
  expect(call.descricao).toBe('PAGAMENTO ANTECIPADO'); // ← igual ao NDE_GERACAO_DEFAULTS.produtoNome
  ```
- **Impacto técnico**: uma regressão que suprima o ramo #3 (`item.prdDesNome`) e caia direto no #4 (fallback hardcoded) fica INVISÍVEL para o teste — porque ambos produzem a MESMA string. O `resolverDescricaoItem` tem 4 ramos; o teste de precedência prova ordenação #1>#2 (env) e #2>#3 (`preDescr`), mas nunca prova #3 vs #4. E o ramo #4 (`NDE_GERACAO_DEFAULTS.produtoNome`) NÃO tem teste isolado (sem `prdDesNome`, sem `preDescr`, sem env fallback).
- **Impacto de negócio**: descrição errada no `xProd` da NF-e é o motivo pelo qual a homologação da NDe estava falhando (é o problema que este delta veio consertar). Um teste que dá verde por coincidência de string permite reintroduzir a falha original sem sinal.
- **Métrica de baseline**: fallbacks distinguíveis por FIXTURE = 2/4; ramos #3 e #4 = indistinguíveis com a fixture atual.

### F-testability-2: `RecebimentoNumerarioService.test.ts` cresceu para 1692 LOC ao absorver as 9 asserções da etapa 3.5 — top-1 em tamanho de teste no backend

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts` (1692 LOC totais; describe `etapa 3.5` nas linhas 1526-1691)
- **Evidência**:
  ```
  wc -l → 1692
  ```
- **Impacto técnico**: a próxima etapa (ex. novos ramos fiscais) tende a ser somada aqui pelo mesmo caminho, empurrando o arquivo para ≥ 2 000 LOC. Cada `describe` novo precisa carregar o `buildMocks()`/`baseInput()`/`wireDocCods()` da suíte inteira mentalmente — a etapa 3.5 já reusa `comDescricaoVazia(m)` local ao describe, o que é bom, mas o arquivo continua sendo o pior-caso do repo.
- **Impacto de negócio**: revisões de PR ficam mais lentas e onboarding fica mais custoso; o risco não é regressão silenciosa (o teste continua funcionando), é fricção crescente.
- **Métrica de baseline**: 1692 LOC (top-1 do backend por `find … -name '*.test.ts' -exec wc -l`).

### F-testability-3: Nenhum e2e de rota cobre o ramo "descrição VAZIA → grava do prdDesNome" — o fake ERP dos 4 arquivos e2e só programou o caminho no-op

- **Severidade**: P2
- **Tactic violada**: Sandbox / Recordable Test Cases (defesa em profundidade)
- **Localização**: `src/backend/routes/recebimentos.e2e.test.ts:341-357`, `.retomada.test.ts:348-364`, `.falhas.test.ts:387-404`, `.gates.test.ts:314-330`
- **Evidência**:
  ```
  app.post('/api/:tela/comDocProdutos/list/:docCod/:fisCod', (req, res) => {
      res.json({ count: 1, rows: [{ ..., dprLngDescrNf: 'PAGAMENTO ANTECIPADO' /* já preenchido */ }] });
  });
  ```
- **Impacto técnico**: os 4 arquivos e2e provam apenas que o fluxo NÃO trava quando o ERP devolve descrição preenchida. Se o `etapaDescricaoItem` for reintroduzida sem `if (item.dprLngDescrNf !== undefined) continue`, ele tentaria gravar mesmo com descrição já preenchida (dupla escrita RMW) — os e2e existentes passariam mesmo assim, porque não há teste do ramo "vazio→grava" com o fake ERP simulando o eco.
- **Impacto de negócio**: perde-se defesa em profundidade justamente no ponto onde o serviço faz escrita fiscal. O unit test do serviço cobre; o e2e não.
- **Métrica de baseline**: e2e cobrindo ramo escrita = 0/4; cobertura do ramo "vazio→grava" só pelo unit test.

### F-testability-4: Não há fixture versionada (`__fixtures__/`) do HAR do com297/comDocProdutos — os shapes estão inline nos testes

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.test.ts:128-137` (itemBase inline)
- **Evidência**: o HAR real (doc 18337/18347 mencionado no docstring) não está gravado no repo; o `itemBase` do teste tem 6 campos, e o `ITEM_NDE_SCHEMA.passthrough()` do client permite ~105 campos — o teste não prova que campos LATERAIS reais (que o RMW precisa reenviar) sobrevivem.
- **Impacto técnico**: uma mudança de shape no ERP (ex. campo obrigatório adicionado) só é detectada em execução real. `dprPreValorun: 15000` é o único "extra" no fixture — é uma smoke check do passthrough, não um contract test.
- **Impacto de negócio**: risco de regressão descoberto tarde (em homologação Conexos), não em CI.
- **Métrica de baseline**: fixtures HAR versionadas para o com297/comDocProdutos = 0 (a sonda gera dump mas em `<tmp>/`, fora do VCS).

### F-testability-5: `preDescricaoProdutoNf` não tem teste para o SHAPE "objeto no topo com `dprLngDescrNf`" (só via envelope `{responseData:{…}}`)

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:355-371` (extrator aceita 4 formas), `ConexosNdeFiscalClient.test.ts:235-257` (testa 3 formas + erro)
- **Evidência**:
  ```
  # client aceita:
  #   (a) string crua
  #   (b) { responseData: 'string' }
  #   (c) { responseData: { dprLngDescrNf | descricao | descr } }
  #   (d) { dprLngDescrNf | descricao | descr }  ← esta forma NÃO tem teste
  ```
- **Impacto técnico**: o ramo `textoOuIndefinido(alvo.dprLngDescrNf) ?? … ?? …` no topo do objeto (sem envelope) é acessível apenas por leitura do fonte; se alguém remover a alternativa `o.responseData !== null && typeof o.responseData === 'object' ? … : o` (o fallback para `o`), nada quebra em teste.
- **Impacto de negócio**: baixo — `preDescricaoProdutoNf` é best-effort e nunca lança; um miss aqui cai no fallback #3, então não gera nota errada. Vale apenas fechar o buraco de contrato.
- **Métrica de baseline**: shapes cobertos = 3/4 explícitos + 1 erro = 4/5 do que o client aceita.

### F-testability-6: Baseline red — 14 testes falham em `npm test` antes de qualquer mudança do delta

- **Severidade**: P1
- **Tactic violada**: (não é do delta) Baseline hygiene — a suíte não é confiável como sinal de regressão enquanto tem red permanente
- **Localização**: 14 testes distribuídos na main; conjunto idêntico verificado em worktree pristino
- **Evidência**: `_shared-metrics.md` linha 36 — "1132 passed / 14 failed — as 14 falhas são pré-existentes na main"
- **Impacto técnico**: com a suíte já em red, uma regressão real do delta seria confundida com "falha antiga" no primeiro olhar. O gate `CI` (`.github/workflows/ci.yml`) roda `npm test -- --coverage` — se essas 14 falharem em CI hoje, ou a config está ignorando, ou o CI está red permanentemente (a inspecionar).
- **Impacto de negócio**: cada PR novo carrega ruído de baseline; a resposta esperada "os testes estão verdes" perde valor semântico.
- **Métrica de baseline**: red permanente = 14; taxa de sinal-para-ruído = 1132/(1132+14) = 98,8 %, mas o inverso (uma falha nova no meio das 14 antigas) é indistinguível sem diff manual.

## 5. Cards Kanban

### [testability-1] Distinguir os fallbacks #3 e #4 do `resolverDescricaoItem` por fixture e adicionar o teste isolado do fallback #4

- **Problema**
  > A fixture do teste "descrição VAZIA: grava o prdDesNome" usa `prdDesNome: 'PAGAMENTO ANTECIPADO'`, que é IGUAL ao `NDE_GERACAO_DEFAULTS.produtoNome`. Uma regressão que suprimir o ramo #3 e cair no #4 passa despercebida. Além disso, o ramo #4 (último recurso: nem env, nem `preDescr`, nem `prdDesNome`) não tem teste isolado.

- **Melhoria Proposta**
  > Trocar `prdDesNome` no `comDescricaoVazia` para uma string DISTINTA (ex. `'DESCRICAO CADASTRADA DO PRODUTO'`) e ajustar a asserção correspondente. Adicionar um `it()` novo que zera `prdDesNome` (`prdDesNome: null`), retorna `preDescricaoProdutoNf: undefined` e verifica que o valor gravado é `NDE_GERACAO_DEFAULTS.produtoNome`. Tactic Bass alvo: **Executable Assertions** — o fallback #4 deve ser distinguível na saída, não coincidente.

- **Resultado Esperado**
  > Todos os 4 ramos de `resolverDescricaoItem` distinguíveis por fixture. Ramos com teste isolado: 4/4 (era 3/4). Regressão que suprima o ramo #3 → falha vermelha no teste do #3.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1 h)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Fallbacks distinguíveis por fixture: 2/4 → 4/4
  - Ramos de `resolverDescricaoItem` com teste dedicado: 3/4 → 4/4
- **Risco de não fazer**: se alguém, na próxima refatoração, colapsar os ramos #3 e #4 em um único (o fallback hardcoded) para "simplificar", nada quebra — e a NDe volta a sair com descrição errada em cliente que tem `prdDesNome` no cadastro.
- **Dependências**: nenhuma.

### [testability-2] Extrair a suíte da etapa 3.5 para `RecebimentoNumerarioService.etapaDescricaoItem.test.ts` dedicado

- **Problema**
  > O arquivo `RecebimentoNumerarioService.test.ts` chegou a 1692 LOC (top-1 do backend). A etapa 3.5 acrescentou 166 LOC em um único `describe`, o que preserva a coesão local mas continua empurrando o arquivo raiz para além do humanamente legível em revisão.

- **Melhoria Proposta**
  > Mover o `describe('RecebimentoNumerarioService — descrição de impressão do item da NDe (etapa 3.5)')` para um arquivo próprio (`RecebimentoNumerarioService.etapaDescricaoItem.test.ts`), reusando o mesmo `buildMocks`/`baseInput` via um `__testUtils__/recebimentoNumerarioService.fixtures.ts` (novo). Tactic Bass alvo: **Limit Structural Complexity**.

- **Resultado Esperado**
  > LOC do arquivo raiz: 1692 → ≤ 1550. Nascimento de um arquivo dedicado ≤ 250 LOC. Padrão replicável para as próximas etapas do orquestrador (fiscal, obs, homolog).

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S (≤ 2 h)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - LOC do `RecebimentoNumerarioService.test.ts`: 1692 → 1500 ± 50
  - Novo arquivo `etapaDescricaoItem.test.ts` ≤ 250 LOC
  - Utilitário compartilhado extraído (evita duplicação de `buildMocks`)
- **Risco de não fazer**: fricção crescente em cada PR que tocar o serviço; onboarding cada vez mais custoso.
- **Dependências**: cross-QA com Modifiability (extração do fixture-helper melhora reuso).

### [testability-3] Cobrir o ramo "descrição vazia → grava do prdDesNome" também em e2e de rota (defesa em profundidade)

- **Problema**
  > Os 4 `recebimentos.e2e.*.test.ts` só programaram no fake ERP o caminho no-op (`dprLngDescrNf` já preenchido). O ramo real de escrita — o que o delta veio adicionar — não é exercitado em NENHUM teste que passe por Express + fake ERP.

- **Melhoria Proposta**
  > Adicionar um cenário no `recebimentos.e2e.test.ts` (ou um `recebimentos.e2e.descricaoItem.test.ts` novo, aproveitando o padrão) em que a rota `/api/:tela/comDocProdutos/list/:docCod/:fisCod` devolve `dprLngDescrNf: null` na 1ª chamada e `'PAGAMENTO ANTECIPADO'` (o eco do PUT) depois. Verificar que a requisição `PUT com297/comDocProdutos` chegou ao fake ERP com a descrição preenchida. Tactic Bass alvo: **Sandbox** (fake ERP como sandbox controlado) + defesa em profundidade.

- **Resultado Esperado**
  > E2E de rota cobrindo ramo de escrita da etapa 3.5: 0 → 1. Se a `etapaDescricaoItem` for removida por engano, pelo menos um e2e vira vermelho.

- **Tactic alvo**: Sandbox / defesa em profundidade
- **Severidade**: P2
- **Esforço estimado**: S (2-3 h)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - E2E cobrindo ramo de escrita: 0/4 → 1
  - PUT `com297/comDocProdutos` observado ao menos uma vez na suíte e2e
- **Risco de não fazer**: se um refactor amanhã inverter a condição do guard (`if (item.dprLngDescrNf !== undefined) continue`), os e2e continuam verdes; a NDe volta a gravar dupla no ERP.
- **Dependências**: nenhuma.

### [testability-4] Versionar HAR real do com297/comDocProdutos como fixture (`__fixtures__/`) e derivar os testes do client dela

- **Problema**
  > Os shapes usados nos testes do `ConexosNdeFiscalClient` são compostos inline (`itemBase = { docCod: 18347, ... }`) e não refletem os ~105 campos que o ERP devolve na resposta real. O `.passthrough()` do Zod aceita — o teste com um único campo extra (`dprPreValorun`) é smoke check, não contract test.

- **Melhoria Proposta**
  > Extrair, da sonda `recebimentos.e2e.descricaoNfeNde.integration.test.ts`, os dumps de `com297.itens` / `com297.item.{...}` / `com297.preDescrProdutoNf.{...}` em rodada controlada com PROBE_ND_DOC_COD real, versionar como `src/backend/domain/client/__fixtures__/com297-comDocProdutos.json` e carregar nos testes do client. Tactic Bass alvo: **Recordable Test Cases**.

- **Resultado Esperado**
  > Fixture do HAR real versionada: 0 → 1 (com pelo menos 2 payloads: item preenchido + item vazio). Testes do client passam a validar shape completo — uma mudança de contrato do ERP (novo campo obrigatório, rename) vira teste vermelho em CI.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: M (2-3 dias — depende de rodar a sonda em homologação e sanitizar CNPJ/nomes)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Fixtures HAR versionadas para com297/comDocProdutos: 0 → ≥ 2
  - Campos preservados por `.passthrough()` verificados: 1 (`dprPreValorun`) → ≥ 10 (amostragem do HAR)
- **Risco de não fazer**: mudanças de shape no ERP só são descobertas em produção; o delta acaba dependendo de sonda manual em cada suspeita.
- **Dependências**: acesso ao Conexos de HML com PROBE_ND_DOC_COD válido; overlap com Integrability (fixtures = contract tests).

### [testability-5] Fechar o buraco do shape "objeto no topo com `dprLngDescrNf`" em `preDescricaoProdutoNf`

- **Problema**
  > O extrator do `preDescricaoProdutoNf` aceita 4 formas (string crua, envelope `{responseData:'X'}`, envelope `{responseData:{...}}`, e objeto no topo com `{dprLngDescrNf|descricao|descr}`). O teste cobre 3 formas + erro; a 4ª (objeto no topo, sem envelope) não é exercitada.

- **Melhoria Proposta**
  > Adicionar um caso no `it('preDescricaoProdutoNf: aceita string crua, envelope e objeto — e NUNCA lança')` cobrindo `client({ dprLngDescrNf: 'DIRETO NO TOPO' })` → `'DIRETO NO TOPO'`. Tactic Bass alvo: **Executable Assertions** — todos os ramos do extrator devem ter asserção.

- **Resultado Esperado**
  > Shapes cobertos por `preDescricaoProdutoNf`: 3/4 + erro → 4/4 + erro. Se alguém remover o fallback `o` no `alvo = … ? … : o`, o teste vira vermelho.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤ 30 min)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Ramos do extrator com teste: 3/4 → 4/4
- **Risco de não fazer**: baixo (best-effort nunca lança); é higiene de contrato.
- **Dependências**: nenhuma.

### [testability-6] Fechar as 14 falhas de baseline — a suíte vermelha destrói o valor semântico do CI

- **Problema**
  > `npm test` na `main` limpa reporta 14 failing / 1132 passing (mesmo conjunto reproduzido em worktree pristino). Enquanto isso durar, todo PR carrega ruído de baseline e uma regressão real fica indistinguível de "aquela falha antiga" no primeiro olhar. O gate `.github/workflows/ci.yml` roda `npm test -- --coverage` — ou o CI está red permanente, ou algo está mascarando; qualquer que seja o caso, o sinal está comprometido.

- **Melhoria Proposta**
  > Triar as 14 falhas em uma passada: (a) as que são bugs de produto → cards próprios; (b) as que são flakes de infra (ex. timing/porta em teste de integração) → `.skip` com TODO nomeado e follow-up em `_inbox/`. Manter a suíte verde é PRÉ-REQUISITO para acreditar em qualquer métrica de testabilidade daqui para frente. Tactic Bass alvo: nenhuma específica; é baseline hygiene.

- **Resultado Esperado**
  > `npm test` → 0 failing / 1146+ passing (ou 14 skipped nominados). CI vira sinal confiável de regressão.

- **Tactic alvo**: (baseline hygiene — pré-requisito das demais tactics)
- **Severidade**: P1 (não é do delta, mas afeta a leitura de qualquer futuro delta)
- **Esforço estimado**: M (2-5 dias, depende do que as 14 são)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Testes red na baseline: 14 → 0
  - Ratio green: 1132/1146 = 98,8 % → 100 %
- **Risco de não fazer**: cada PR novo re-negocia o significado de "verde"; testes viram folclore em vez de gate.
- **Dependências**: cross-QA com Deployability (o coverage gate em CI depende de suite verde para ser autoridade).

## 6. Notas do agente

- Escopo restrito ao delta funcionou bem porque a maioria do delta é testes: 3 dos 4 arquivos ADD do backend são `.test.ts` ou `.integration.test.ts`, o que já é sinal de saúde de TDD nesta feature.
- Não rodei `--coverage` isolado do delta (jest não expõe cobertura por diff nativamente) — deixei recomendação de `--changedSince=main` para o próximo run.
- **Cross-QA**: F-testability-3 (e2e do ramo escrita) e F-testability-4 (fixture HAR) se sobrepõem com Integrability (contract tests do ERP). F-testability-6 se sobrepõe com Deployability (o coverage gate do CI depende de suite verde). F-testability-1 (fixture-collision) se sobrepõe com Fault Tolerance (invariante fiscal — descrição errada = homologação recusada).
- Nota de método: 21 testes / 323 LOC de produção é uma densidade de teste alta para o padrão do repo — o time está TDDando de fato esta etapa, o que é o principal ponto positivo do delta.
