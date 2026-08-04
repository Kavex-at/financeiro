---
qa: Testability
qa_slug: testability
run_id: 2026-08-03-0904
agent: qa-testability
generated_at: 2026-08-03T09:04:00Z
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review

> Escopo REAL: delta de `fix/sn-titulo-condicao-fail-closed` contra `fix/sn-cond-pgto-finalizacao`
> (3 arquivos: `RecebimentoNumerarioService.{ts,test.ts}` + `recebimentos.e2e.falhas.test.ts`).
> Flag `--quick` ATIVA: sem coverage; contagem por leitura de código. Restrição dura respeitada:
> `*.integration.test.ts` (7 arquivos opt-in que batem no ERP HML real) NÃO executados nesta revisão.
> Nada de Terraform/Lambda no repo (Express+Render+Supabase, ver CLAUDE.md).

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor que altera a etapa SN da Frente IV (Recebimentos) | Refatora `completarSnAdiantamento` (ordem item/condição + PUT condicional + verificação pós-PUT) | `RecebimentoNumerarioService.ts` (1400 LOC) e sua suíte unit (1128 LOC) + 1 assert de ordem no `recebimentos.e2e.falhas.test.ts` | Suíte padrão local (`npx jest`, 97 suites / 1017 testes verdes, ignora `*.integration.test.ts`) | A suíte detecta imediatamente qualquer regressão nas 6 invariantes novas (aplica-sob-pendência; ordem item→validações→PUT; ignora pendência de outro assunto; ignora aviso `fdvVldErr:1`; fail-closed título destruído; com194 fora do ar não bloqueia) sem depender do ERP real | 6 asserções específicas em <15s de execução; oráculo do ERP defendido por 2 testes `hmlTitulo*.integration.test.ts` opt-in (humano dispara, cria docs 736/737 reais) |

Contexto crítico do delta: o comportamento foi **descoberto por medição direta no ERP HML** (`docs/e2e/gap-titulos-diagnostico.md`, docs 734/735/736/737). Os mocks unit **codificam** a medição — o oráculo vive fora do código-fonte e envelhece silenciosamente se o ERP mudar campo/mensagem. Esta revisão dá peso especial a esse risco.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ramos NOVOS do delta cobertos por teste unit | 6/6 (aplica; ordem; outro-assunto; aviso; fail-closed título; com194 down) | 6/6 | ✅ | `RecebimentoNumerarioService.test.ts:371-458` |
| Novos `describe` blocks focados na mudança | 1 (`condição de pagamento só quando a com194 exige`) | ≥1 | ✅ | `RecebimentoNumerarioService.test.ts:371` |
| `it` blocks totais no arquivo central de teste | 49 (era 43; +6) | — | ✅ | `grep '^    it(' RecebimentoNumerarioService.test.ts` |
| Tamanho do arquivo de teste central | 1128 LOC | ≤500 LOC (Bass — Limit Structural Complexity) | ❌ | `_shared-metrics.md:37` |
| Tamanho do arquivo de produção central | 1400 LOC | ≤500 LOC/classe | ❌ | `_shared-metrics.md:36` |
| Assertivas de ordem via `invocationCallOrder` no delta | 1 (`itemOrder < validacoesOrder < putOrder`) | ≥1 por regra de ordem | ✅ | `RecebimentoNumerarioService.test.ts:402-412` |
| Assertivas específicas vs frouxas no delta (por `it` do `describe` novo) | 6/6 usam `.toContain` / `.toEqual(expect.objectContaining(...))` / `.toHaveBeenCalledWith` — nada `.toHaveBeenCalled()` genérico onde há payload | ≥5/6 específicas | ✅ | `RecebimentoNumerarioService.test.ts:388-457` |
| Asserção de LOG na degradação com194 (`logService.warn`) | **AUSENTE** — teste "com194 indisponível" verifica comportamento mas NÃO o `warn` (o precedente do arquivo, linha 1080, mostra que a asserção é possível e usada em outros pontos) | Presente (observabilidade da degradação silenciosa) | ❌ | `RecebimentoNumerarioService.test.ts:449-457` vs `:1080` |
| Fixtures gravadas do ERP (Recordable Test Cases) para as mensagens da com194 | 0 (apenas constantes hard-coded `VALIDACAO_CONDICAO`) | ≥1 fixture serializada por endpoint chave | ❌ | `RecebimentoNumerarioService.test.ts:373-379` |
| Integration test cobrindo o PATH NOVO fim-a-fim (com194 exige condição → PUT sucede → título preservado) | 0 — os `hmlTituloCondicao*` medem a AUSÊNCIA do PUT (variantes A/B); nenhum exercita o caminho positivo do fix | ≥1 | ⚠️ | `Glob src/backend/routes/recebimentos.e2e.hmlTitulo*.integration.test.ts` |
| CI gate para integration tests (dispara opt-in em cron?) | 0 (humano dispara — HANDOFF explicita) | Cron semanal em HML ou pré-release | ⚠️ | `jest.config.cjs:7` (`\.integration\.test\.ts$` ignored) |
| Coverage threshold em `domain/service/` | lines ≥88%, branches ≥60% (CI gate presente) | Presente | ✅ | `jest.config.cjs:34-44` |
| Suíte padrão verde após o delta | 97 suites / 1017 testes | verde | ✅ | `_shared-metrics.md:44` |
| Falhas de lint no arquivo central (regressão do delta) | 0 (pré-existente: `noExcessiveCognitiveComplexity` em `classificarAlocacao`, também na base) | 0 regressões | ✅ | `_shared-metrics.md:62` |

> ⚠️ **Não medível localmente (com `--quick`)**: cobertura de linhas/branches específica do delta (sem `--coverage`). Recomendação: rodar `npx jest --coverage --testPathPatterns RecebimentoNumerarioService` antes de merge para confirmar que `applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition` e `stripAccents` ficam ≥90% linhas.

> ⚠️ **Não medível localmente (restrição dura)**: se os 6 `hmlTitulo*.integration.test.ts` ainda passam contra o HML atual. Só o humano roda, e cada rodada cria documento real (736/737 já são resíduos). O oráculo é **stale por design** entre disparos.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | tsyringe injeta `ConexosNdeFiscalClient`, `ConexosGerDocProcessoClient`, `ConexosFin014Client`, `ConexosNdeClient`, repos, log e env. Todos substituídos por mocks no teste via construtor direto (`new RecebimentoNumerarioService(...)`, sem `container.resolve`). O seam do delta (`listValidacoes`) é acionado via `m.fiscal.listValidacoes` puramente. | ✅ presente | `RecebimentoNumerarioService.test.ts:177-190`; ports em `interface/recebimentos/ports.ts` |
| Recordable Test Cases | Mocks unit são **constantes hand-coded** transcritas de uma medição no ERP (doc 18342, HML docs 734–737). Não há fixture serializada (`.json`/`.har`) versionada que possa ser re-executada quando o ERP muda campo. Se o ERP passar a devolver `fdvEspErr: "COND. DE PAGTO ..."`, o regex `/CONDICAO DE PAGAMENTO/` retorna `false` e a etapa vira no-op silenciosa — a suíte segue verde. | ⚠️ parcial | Constante em `RecebimentoNumerarioService.test.ts:373-379`; regex em `RecebimentoNumerarioService.ts:60`; HAR do colega existe mas fora do teste (`ontology/_inbox/com299-sn-generation-har.md`) |
| Sandbox | Dois níveis: (1) mocks tsyringe (rápidos, cobrem lógica); (2) `*.integration.test.ts` opt-in contra HML real (verificam o oráculo mas criam documentos reais — 734–737 são resíduos vivos). Ausente: um ERP fake HTTP local reprogramável (existe para o e2e falhas — `armarCenario` — mas não é usado pelo serviço). | ⚠️ parcial | Fake ERP HTTP em `recebimentos.e2e.falhas.test.ts:799-810` (via `armarCenario({com194Rows: [...]})`); ausência de uso no service test |
| Executable Assertions | **Embutida no CÓDIGO-FONTE** (não só no teste): `RecebimentoNumerarioService.ts:508-518` verifica `mnyTitValor === docMnyValor` pós-PUT e lança erro nomeado se o invariante quebrou. Isto é *o* aumento de testabilidade do delta — a asserção viaja com o serviço em produção, não fica confinada ao unit test. | ✅ presente | `RecebimentoNumerarioService.ts:500-518` |
| Abstract Data Sources | `ConexosNdeFiscalClient.listValidacoes` é o data source abstrato — teste troca sem tocar em HTTP, DB ou clock. Repositório (`markError`) idem. | ✅ presente | `RecebimentoNumerarioService.test.ts:384` |
| Limit Structural Complexity | O delta DECOMPÕE `completarSnAdiantamento` em três privates nomeados (`addLineItem`, `applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition`) + helper `stripAccents` — ganho localizado. Mas a classe cresceu para 1400 LOC e o teste para 1128 LOC. `classificarAlocacao` já dispara `noExcessiveCognitiveComplexity` (pré-existente). O grande refactor extrair-etapa-em-classe segue pendente. | ⚠️ parcial | `RecebimentoNumerarioService.ts:451-621`; métrica LOC em `_shared-metrics.md:34-38` |
| Limit Non-Determinism | O delta **não introduz** não-determinismo (sem `Math.random`, sem `new Date()` novo, sem network real). Herda `new Date()` no `SnPayloadBuilder` (fora do delta) — asserção `typeof docDtaEmissao === 'number'` na linha 332. Sem clock injetado, mas isto é dívida pré-existente. Não regride. | ✅ presente (para o delta) | `RecebimentoNumerarioService.test.ts:332`; delta em si sem `Date`/`Math.random` |

## 4. Findings (achados)

### F-testability-1: `lastIndexOf` no `recebimentos.e2e.falhas.test.ts` mascara desaparecimento da 1ª chamada com194

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (asserção agora prova invariante mais fraco do que aparenta)
- **Localização**: `src/backend/routes/recebimentos.e2e.falhas.test.ts:823-830`
- **Evidência (objetiva)**:
  ```typescript
  // "O `lastIndexOf` é proposital: a etapa da SN também consulta a com194 [...]
  //  então o PRIMEIRO com194 do log é anterior à homologação."
  const idxCom194 = paths.lastIndexOf('POST /api/com194/documento/list');
  expect(idxHomolog).toBeGreaterThan(-1);
  expect(idxCom194).toBeGreaterThan(idxHomolog);
  ```
  A troca `indexOf` → `lastIndexOf` foi feita porque o delta introduziu uma 2ª chamada à com194 na etapa SN (verificar se a condição é exigida). O comentário anota isso, mas a asserção resultante — "ALGUMA com194 veio depois da homologação" — é trivialmente verdadeira desde que EXISTA a chamada pós-homologação. Se um refactor futuro **remover** a nova chamada da etapa SN, o teste continua verde; se **remover** a chamada pós-homologação (a que o Cenário 1 pretende defender), o `lastIndexOf` acha a da SN (< homologação) e a asserção `>` finalmente falha — mas com mensagem confusa ("ordering", não "missing").
- **Impacto técnico**: teste com falso-positivo silencioso em uma direção (some a chamada SN) e mensagem de erro enganosa na outra (some a chamada pós-homologação). O teste não mais defende o invariante "existem DUAS chamadas à com194, uma em cada etapa".
- **Impacto de negócio**: se a etapa SN parar de consultar a com194, a condição-condicional nunca é aplicada mesmo em cliente que exige (produção: pessoa 194) → SNs finalizam sem parcela → `fin014` sem título para baixar → recebimento em revisão humana permanente. O caso é o motivador da mudança, e o teste que deveria protegê-lo foi enfraquecido.
- **Métrica de baseline**: 1 asserção de invariante em `_shared-metrics.md:44` (o Cenário 1 do e2e falhas). Fortaleza atual: fraca (só valida existência). Fortaleza desejada: `paths.filter(p => p === 'POST /api/com194/documento/list').length === 2` + `primeira < homolog < segunda`.

### F-testability-2: mocks codificam o oráculo do ERP sem mecanismo de detecção de drift

- **Severidade**: P1
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:59-60`, `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:373-379`
- **Evidência (objetiva)**:
  ```typescript
  // Source (regex hard-coded, casada sem acentos):
  const CONDICAO_PAGAMENTO_REGEX = /CONDICAO DE PAGAMENTO/;

  // Test (constante hard-coded transcrita da medição em produção do doc 18342):
  const VALIDACAO_CONDICAO = {
      fdvCodSeq: 2, fdvVldErr: 2,
      fdvEspErr: 'CONDIÇÃO DE PAGAMENTO DO DOCUMENTO DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA. ...'
  };
  ```
  O oráculo do comportamento vive em `docs/e2e/gap-titulos-diagnostico.md` (medição humana). Nada na suíte padrão detecta divergência quando o ERP altera:
  - a redação (`"COND. DE PAGTO"`, `"CONDIÇÃO PGTO"`, ausência de acentos na origem, etc.),
  - o campo (`fdvEspObs` em vez de `fdvEspErr` — a regex já casa os dois via concatenação, mas nenhum teste exercita essa transposição),
  - o código de bloqueio (`fdvVldErr === 3`).
  Os 2 `hmlTituloCondicao.integration.test.ts` / `hmlTitulos.integration.test.ts` verificariam o oráculo, mas: (a) são opt-in humano; (b) o handoff explicita que cada rodada cria documento real (736/737 vivos); (c) o path POSITIVO do fix (com194 exige → PUT → título preservado) **não** está coberto por integration test — os `hmlTitulo*` existentes exercitam a AUSÊNCIA do PUT (variantes A/B do documento sem exigência) e as medições diagnósticas do zero. Não há teste de integração que valide "quando o ERP exige, o serviço aplica corretamente".
- **Impacto técnico**: se o ERP alterar mensagem/campo, `requiresRegisteredPaymentCondition` volta silenciosamente `false` para 100% dos casos → serviço nunca aplica o PUT. Suíte verde. Detecta-se em produção quando um cliente que exige a condição (perfil da pessoa 194) tenta processar.
- **Impacto de negócio**: exatamente a regressão que causou os docs 731 (SKYJACK com condição da BONDUELLE) e a origem do fix. Silenciar essa detecção reintroduz o bug com sinal de fumaça idêntico: SN finalizada mas fin014 sem título — R$ do cliente parado em revisão humana até intervenção manual.
- **Métrica de baseline**: 0 fixtures serializadas; 0 integration tests cobrindo o path positivo do delta; 1 integration test opt-in que mede casos vizinhos (`hmlTituloCondicao`).

### F-testability-3: fail-closed pós-PUT tem cobertura de branch parcial (só `mnyTitValor === 0`)

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (asserção presente, ramificação sub-testada)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:508-518`, `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:431-447`
- **Evidência (objetiva)**:
  ```typescript
  // Source: dois motivos para falhar (composto em uma condição):
  if (!(titulo > 0) || titulo !== valorDoc) { throw new Error(...) }

  // Test: só cobre "titulo === 0 e valorDoc === 15000" (o caso do doc 735 do HML).
  (m.gerDoc.getDocumento as jest.Mock)
      .mockResolvedValueOnce({...})
      .mockResolvedValueOnce({...})
      .mockResolvedValue({ docCod: 18200, docMnyValor: 15000, mnyTitValor: 0 });
  ```
  Não testado:
  - `titulo > 0 && valorDoc > 0 && titulo !== valorDoc` (parcela parcial — o PUT regenerou algo, mas divergente),
  - `titulo === valorDoc === 0` (o PUT zerou os dois — segurado por `!(titulo > 0)`, mas nenhum teste confirma que o path é este e não o outro),
  - arredondamento (`titulo = 15000.001`, `valorDoc = 15000.005` — ambos `round2` para 15000, deveria passar; caso limite não exercitado).
- **Impacto técnico**: se a lógica composta for reescrita como `if (titulo !== valorDoc)` num refactor, o cenário `mnyTitValor: 0, docMnyValor: 0` (documento inteiramente zerado) passa por invariante-verdadeiro em vez de disparar erro. Suíte verde.
- **Impacto de negócio**: um documento zero-zero é justamente o "PUT destruiu TUDO" (destruiu título E valor). Deixar passar significa `finalizarDocumento` com doc zerado → recusa fiscal → alocação em erro com mensagem genérica em vez do erro específico deste fail-closed.
- **Métrica de baseline**: 1 caso testado / 3 combinações distintas de (titulo, valorDoc) que deveriam disparar o erro.

### F-testability-4: teste "com194 indisponível" não asserta o `logService.warn` da degradação

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (não asserta o efeito observável esperado)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:449-457`, `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:543-556`
- **Evidência (objetiva)**:
  ```typescript
  it('a com194 indisponível não bloqueia: segue sem PUT ...', async () => {
      const m = comValidacao([]);
      (m.fiscal.listValidacoes as jest.Mock).mockRejectedValue(new Error('com194 fora do ar'));
      const out = await buildService(m).processarAlocacao(baseInput());
      expect(out.status).toBe('settled');
      expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
      expect(m.gerDoc.finalizarDocumento).toHaveBeenCalled();
      // AUSENTE: expect(logStub.warn).toHaveBeenCalledWith(expect.objectContaining({...}))
  });
  ```
  O código-fonte emite um `logService.warn` explícito ao degradar (linhas 543-554), com mensagem e `txnId`/`docCod`. O teste não verifica. O precedente do próprio arquivo — `RecebimentoNumerarioService.test.ts:1080-1082` — mostra que o padrão de asserção sobre `logStub.warn` é usado em outros pontos:
  ```typescript
  expect(logStub.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('docMnyValor=0') }),
  );
  ```
- **Impacto técnico**: se o `logService.warn` for removido num refactor, a degradação silenciosa se torna literalmente silenciosa — nenhum aviso ao analista de que a checagem foi pulada. Suíte verde.
- **Impacto de negócio**: quando a com194 estiver fora do ar, o serviço decide "não mexer" (correto) mas o analista precisa saber por que a alocação virou "revisão humana" um passo depois. Sem o warn, ele só vê "finalização recusada" sem trilha da razão-raiz.
- **Métrica de baseline**: 0/1 asserções de log no teste de degradação; precedente já existe no mesmo arquivo (1080).

### F-testability-5: teste FAIL-CLOSED depende da ORDEM exata de 3 chamadas a `getDocumento` — acoplamento frágil

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (o teste depende de detalhes internos que a interface pública não obriga)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:431-447`; source em `RecebimentoNumerarioService.ts:484,503,596` (3 sites)
- **Evidência (objetiva)**:
  ```typescript
  (m.gerDoc.getDocumento as jest.Mock)
      .mockResolvedValueOnce({...}) // (1) montar o item
      .mockResolvedValueOnce({...}) // (2) montar o PUT
      .mockResolvedValue({ ..., mnyTitValor: 0 }); // (3) VERIFICAR o efeito do PUT
  ```
  A ordenação `getDocumento` × 3 é derivada da estrutura interna (addLineItem → getDocumento; applyPaymentCondition → getDocumento; verify → getDocumento). Qualquer refactor que reordene ou memoize essas leituras faz o teste retornar mocks aos passos errados — pode dar verde (falso-positivo) ou vermelho por motivo alheio à invariante testada.
- **Impacto técnico**: teste protege a invariante certa hoje, mas por acidente de layout interno. Manutenção do serviço vira campo minado (mudar uma leitura de doc quebra o teste do fail-closed).
- **Impacto de negócio**: baixo (é dor de manutenção, não de produção); mas típico dos "testes que não deixam refatorar" que Bass usa como caso patológico da Testability.
- **Métrica de baseline**: 3 `getDocumento` sites no source; teste depende da ORDEM entre eles.

### F-testability-6: 6ª chamada nova aumenta o "arquivo monstro" — a etapa SN merece classe própria

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` (1400 LOC, 1 classe)
- **Evidência (objetiva)**: métricas do `_shared-metrics.md:34-38`; delta adiciona 128 linhas de código + 148 de teste — todas ao mesmo par de arquivos. `classificarAlocacao` já era flagged por `noExcessiveCognitiveComplexity` (baseline). A decomposição LOCAL do delta (`addLineItem`, `applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition`, `stripAccents`) é boa; a extração para `RecebimentoNumerarioSnEtapa` (classe dedicada, testável em isolamento sem o restante do orquestrador) seria a próxima jogada.
- **Impacto técnico**: a suíte unit central já leva o teste ao limite de escaneabilidade (1128 LOC). O próximo tweak da etapa SN paga mais imposto.
- **Impacto de negócio**: entrega mais lenta a cada mudança na Frente IV — hoje a SN é o hotspot de aprendizagem sobre o ERP; a cada medição nova, todo mundo abre 2.5k linhas.
- **Métrica de baseline**: 1400 LOC (source) + 1128 LOC (teste) contra o alvo Bass de ≤500 por classe.

## 5. Cards Kanban

### [testability-1] Fortalecer a asserção de ordem no `recebimentos.e2e.falhas.test.ts` Cenário 1

- **Problema**
  > O delta introduziu uma 2ª chamada à com194 (etapa SN, antes da homologação). A adaptação foi trocar `indexOf` por `lastIndexOf` na asserção. O teste passou a provar "existe pelo menos uma com194 depois da homologação", NÃO "existem duas, uma antes e uma depois". Se algum refactor remover a nova chamada da SN, o teste segue verde e a condição-condicional nunca dispara — reintroduzindo o bug do doc 731 sem sinal.

- **Melhoria Proposta**
  > Substituir a asserção por: contar as ocorrências (`paths.filter(p => p === 'POST /api/com194/documento/list').length === 2`), afirmar que a primeira ocorreu ANTES da homologação e a segunda DEPOIS. Adicionar comentário curto explicando as duas etapas. Tactic Bass: Executable Assertions (invariante forte, não conjunto trivial).

- **Resultado Esperado**
  > Cenário 1 do e2e falhas defende o invariante "há duas consultas à com194, em etapas distintas". Métrica: fortaleza da asserção passa de 1 (existência) para 3 (contagem exata + ordem 1ª<homolog + 2ª>homolog).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Asserções distintas sobre com194 no Cenário 1: 1 → 3
  - Testes que sobrevivem a "removi a chamada com194 da etapa SN": 0 falhas → ≥1 falha
- **Risco de não fazer**: reintrodução silenciosa do bug do doc 731; regressão só detectada em produção pelo cliente que exige a condição sugerida.
- **Dependências**: nenhuma.

### [testability-2] Congelar o oráculo do ERP com fixtures gravadas + contract test opt-in

- **Problema**
  > A regex `CONDICAO_PAGAMENTO_REGEX = /CONDICAO DE PAGAMENTO/` e o discriminador `fdvVldErr === 2` foram destilados de UMA medição real (doc 18342). Os mocks unit codificam a mesma medição. Se o ERP alterar campo ou redação, a suíte segue verde e `requiresRegisteredPaymentCondition` vira no-op silencioso — reintroduzindo a origem do fix. Os `hmlTitulo*.integration.test.ts` opt-in medem casos VIZINHOS (docs sem exigência), não o path POSITIVO do delta.

- **Melhoria Proposta**
  > Gravar a resposta real da com194 (doc 18342 ou equivalente atual em HML de um cliente que EXIGE a condição, como a pessoa 194 em produção) como fixture JSON versionada em `src/backend/domain/service/recebimentos/__fixtures__/com194-condicao-pagamento.json`. Referenciar essa fixture nos testes unit (em vez da constante inline) para que qualquer atualização passe por edição consciente. Criar um teste `*.integration.test.ts` opt-in `hmlCondicaoRequerida.integration.test.ts` que exercita o path positivo (com194 exige → PUT → título preservado === docMnyValor), gerando exatamente 1 documento por rodada com log explícito do resíduo. Tactics Bass: Recordable Test Cases + Sandbox.

- **Resultado Esperado**
  > Oracle drift do ERP tem detecção intencional. Métrica: fixtures serializadas passam de 0 → 1; integration tests cobrindo o path POSITIVO do delta passam de 0 → 1.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — inclui capturar HAR, versionar, escrever integration test com cleanup do resíduo)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Fixtures gravadas do ERP para mensagens da com194: 0 → 1
  - Integration tests que exercitam o path POSITIVO do fix: 0 → 1
  - Constantes hard-coded no teste unit: substituídas por `require('./__fixtures__/...')`
- **Risco de não fazer**: bug do doc 731 reintroduzido no próximo mês que o ERP alterar a mensagem — silenciosamente, com detecção apenas quando um cliente do perfil da pessoa 194 tenta uma alocação.
- **Dependências**: acesso a HML/produção para uma pessoa que atualmente exige a condição (o SKYJACK do HML não exige — devolve `count: 0`, como documentado no `gap-titulos-diagnostico.md`).

### [testability-3] Completar as ramificações do fail-closed pós-PUT

- **Problema**
  > A condição `!(titulo > 0) || titulo !== valorDoc` tem 3 caminhos distintos de erro; o teste cobre 1 (título zerado, valor mantido). Cenários "ambos zero" e "título parcial (parcela regenerada divergente)" não são exercitados. Refactor futuro que simplifique a expressão pode passar por invariante-verdadeiro num caso real.

- **Melhoria Proposta**
  > Adicionar 2 casos ao `describe('condição de pagamento só quando a com194 exige')`: (a) `mnyTitValor: 0, docMnyValor: 0` (documento zerado); (b) `mnyTitValor: 7500, docMnyValor: 15000` (parcela parcial). Ambos devem cair no fail-closed com mensagem que discrimina o motivo. Tactic Bass: Executable Assertions.

- **Resultado Esperado**
  > Branch coverage do fail-closed sobe. Métrica: casos testados de invariante quebrado passam de 1/3 → 3/3.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Cenários de fail-closed testados: 1 → 3
  - Cobertura de branch em `applyPaymentConditionIfRequired`: (medir com `--coverage` no PR)
- **Risco de não fazer**: silenciar futura regressão em documento zero-zero (o "PUT destruiu tudo").
- **Dependências**: nenhuma.

### [testability-4] Asserção sobre `logService.warn` no teste de com194 indisponível

- **Problema**
  > O código emite `logService.warn` explícito quando a com194 está fora do ar (para o analista saber por que a checagem foi pulada). O teste não verifica. O precedente `RecebimentoNumerarioService.test.ts:1080` mostra que o padrão está em uso em outros pontos do mesmo arquivo.

- **Melhoria Proposta**
  > Adicionar ao teste "com194 indisponível" a asserção sobre `logStub.warn` com `expect.objectContaining({ type: LOG_TYPE.BUSINESS_WARN, message: expect.stringContaining('com194 unavailable') })`. Tactic Bass: Executable Assertions (observabilidade da degradação).

- **Resultado Esperado**
  > Degradação silenciosa deixa de ser silenciosa por acidente. Métrica: asserções de log no teste de degradação passam de 0 → 1.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — literalmente 3 linhas)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Asserção `logStub.warn` no bloco de degradação com194: 0 → 1
- **Risco de não fazer**: analista sem trilha de "por que essa alocação virou revisão humana" quando a com194 estiver instável.
- **Dependências**: nenhuma.

### [testability-5] Desacoplar o teste de FAIL-CLOSED da ordem interna de `getDocumento`

- **Problema**
  > O teste do PUT-destrutivo depende da ordem exata de 3 chamadas a `getDocumento` (uma para addLineItem, outra para PUT, terceira para verify). Qualquer refactor que memoize ou reordene essas leituras faz o teste devolver mock ao passo errado — verde ou vermelho por acidente estrutural.

- **Melhoria Proposta**
  > Trocar `mockResolvedValueOnce` sequencial por `mockImplementation((args) => ...)` que devolve o mock apropriado com base em algum discriminador do input (por exemplo, contagem de invocações OU o estado esperado naquele ponto do fluxo). Alternativa mais limpa: extrair `applyPaymentConditionIfRequired` para classe própria testável em isolamento (converge com o card testability-6). Tactic Bass: Limit Structural Complexity (o teste depende de detalhes que a interface pública não obriga).

- **Resultado Esperado**
  > Refactor da etapa SN pode reordenar leituras sem quebrar o teste do fail-closed. Métrica: acoplamento do teste a `mockResolvedValueOnce` sequenciais: 3 → 0.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Uso de `mockResolvedValueOnce` sequencial no teste de fail-closed: 3 → 0
- **Risco de não fazer**: refactor futuro da etapa SN vira campo minado.
- **Dependências**: opcional — casa bem com testability-6.

### [testability-6] Extrair a etapa SN do `RecebimentoNumerarioService` para classe própria

- **Problema**
  > O arquivo central do delta cresceu para 1400 LOC (source) + 1128 LOC (test), 1 classe única. `classificarAlocacao` já dispara `noExcessiveCognitiveComplexity` (pré-existente). O delta decompôs `completarSnAdiantamento` em 3 privates — bom, mas dentro da mesma classe monolítica. A cada medição nova sobre o ERP, o time abre 2.5k linhas.

- **Melhoria Proposta**
  > Extrair uma classe `RecebimentoNumerarioSnEtapa` (injetável, testável em isolamento) que possua `addLineItem`, `applyPaymentConditionIfRequired`, `requiresRegisteredPaymentCondition`, `escolherCondicaoPagamento` e helpers. O orquestrador `RecebimentoNumerarioService` recebe a nova classe via construtor. O teste da etapa SN passa a um arquivo `RecebimentoNumerarioSnEtapa.test.ts` (~300 LOC previstas) — o `RecebimentoNumerarioService.test.ts` reduz-se aos testes do orquestrador. Tactic Bass: Limit Structural Complexity.

- **Resultado Esperado**
  > Testes da etapa SN passam a ser lidos como uma unidade coerente. Métrica: arquivo de teste da etapa SN em isolamento passa a existir (0 → 1); LOC do teste central cai de 1128 → ≤600 estimado; próximo tweak da etapa SN abre 300 LOC em vez de 2528.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-6, F-testability-5 (convergem)
- **Métricas de sucesso**:
  - LOC do arquivo `RecebimentoNumerarioService.ts`: 1400 → ≤900
  - LOC do arquivo `RecebimentoNumerarioService.test.ts`: 1128 → ≤600
  - Classes injetáveis para a Frente IV: 1 → 2
- **Risco de não fazer**: fricção de manutenção cresce a cada medição nova sobre o ERP; a Frente IV é a que mais aprende sobre a realidade do Conexos hoje.
- **Dependências**: convém encadear com testability-5 (o refactor resolve o acoplamento do teste do fail-closed de graça).

## 6. Notas do agente

- Decisão de escopo: revisão restrita ao delta dos 3 arquivos (per o prompt). Não avaliei coverage numérica (`--quick`) nem executei os 7 `*.integration.test.ts` (restrição dura — criam docs financeiros reais). O único ponto onde essa restrição me preocupa é o card [testability-2]: sem rodar o `hmlTituloCondicao.integration.test.ts` não sei se AINDA passa contra o HML atual — o handoff nota que sim, mas o oráculo é stale por design entre disparos humanos.
- Cross-QA a sinalizar ao `qa-consolidator`:
  - **Fault Tolerance**: F-testability-1 e F-testability-4 são também gaps de detecção de falha silenciosa (a suíte falha em observar a degradação que o código-fonte já emite corretamente).
  - **Integrability**: F-testability-2 (fixture da com194) é uma forma de contract test com o ERP — casa com qualquer card de integrabilidade que ataque o mesmo problema.
  - **Modifiability**: F-testability-5 e F-testability-6 são custo de mudança direto — o próximo tweak da etapa SN paga o preço.
