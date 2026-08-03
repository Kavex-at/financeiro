---
qa: Testability
qa_slug: testability
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-testability
generated_at: 2026-08-03T18:47:00-03:00
scope: all
score: 8
findings_count: 6
cards_count: 4
---

# Testability — Regis-Review (feature-scoped: ADR-0027 select existing SN)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que altera o ramo "SN existente" do settle (bug real ou refactor no `RecebimentoNumerarioService.rodarEtapas`/`etapaSn`, ou na rota `GET /processos/:priCod/sns`, ou no modal `AlocarProcessosDialog`) | Mudança acidental que reintroduziria: (a) geração/finalização da SN quando `snSelecionadaDocCod` está presente (duplicaria o com299), (b) omissão do `snDocCod` no body do POST (ignoraria a seleção), (c) inclusão do `snDocCod` mesmo em "Criar novo SN" (misturaria fluxos), (d) leak de NC/ND (`docVldTipoAdto=0`) na lista de SNs, (e) authz falha no `GET /processos/:priCod/sns` (403 cross-filial) | Client `ConexosGerDocProcessoClient.listSNsByProcesso` (projeção/filtro); rota `recebimentos.ts` (`/processos/:priCod/sns` + threading `snDocCod`); serviço `RecebimentoNumerarioService.etapaSn`; componente FE `AlocarProcessosDialog` | Pré-PR (Jest local + CI Jest), sem Conexos real, sem Postgres real (mocks tsyringe injetados por construtor) | Suite ADR-0027 (client + service + rota + FE dialog) FALHA no CI, PR bloqueia; dev enxerga o teste que quebrou e a linha exata do invariante violado (ex.: "SN existente selecionada: NÃO gera nem finaliza a SN" — service.test:255; "escolher uma SN existente envia snDocCod" — dialog.test:177) | 100% das 4 invariantes-chave do ADR-0027 têm ≥1 teste de regressão dedicado; 115 casos backend + 23 casos FE **passam** localmente; delta introduziu +0 flakes; tempo total das 4 suites < 25s (11.4s BE + 11.0s FE) |

> Regressão real que o teste `service.test:255` (SN existente selecionada) defende: se um refactor voltar a chamar `gerarDocProcesso`+`finalizarDocumento` no ramo `snSelecionadaDocCod !== undefined`, o Conexos mintaria uma SN duplicada em produção (violação de I-Receb-3 e do próprio invariante "não cria SN duplicada" — service.ts:119). Custo de descobrir sem teste: incidente financeiro real + retrabalho de conciliação.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Casos de teste por camada — ADR-0027 delta** | client=27, service=42 (recebimentos), rota=17 (recebimentos + 3 do bloco novo `/processos/:priCod/sns`), FE dialog=23 | ≥1 caso por invariante do ADR (listagem/filtro/exclusão NC-ND/route 200-403-400/service pula geração/service pula finalização/FE gating/FE snDocCod threading) | ✅ | `npx jest --testPathPatterns='(ConexosGerDocProcessoClient\|RecebimentoNumerarioService\.test\|routes/recebimentos\.test)' --silent` → 115 pass; `npx jest --testPathPatterns='AlocarProcessosDialog' --silent` → 23 pass |
| Casos que exercitam o ramo `snSelecionadaDocCod !== undefined` no service | 1 caso dedicado (`RecebimentoNumerarioService.test.ts:255`) + 2 cross-filial confirmatórios | ≥1 caso happy-path que asserte simultaneamente: NÃO chama validarGeracao, NÃO chama finalizarDocumento, gerarDocProcesso chamado 1× SÓ com `tela: 'com297'`, `listTitulosBorderoReceber({docCod: 18202})` | ✅ | `RecebimentoNumerarioService.test.ts:255-283` |
| Casos que exercitam a projeção `listSNsByProcesso` (filtro body + projeção + defensive NC/ND exclusion + statusLabel fallback) | 3 casos (`ConexosGerDocProcessoClient.test.ts:576, 629, 666`) | ≥3 — filtro exato (priCod/docVldTipo/docVldTipoAdto/vldStatus IN), projeção epoch→ISO + statusLabel, guard defensivo `docVldTipoAdto===0` excluído, fallback `SN <n>` para status não mapeado | ✅ | `ConexosGerDocProcessoClient.test.ts:576-687` |
| Casos que exercitam a rota `GET /recebimentos/processos/:priCod/sns` | 4 casos: 200 auth ok, 403 cross-filial, 400 sem filCod, 400 priCod inválido | 200 / 403 / 400 (missing filCod) / 400 (invalid priCod) → todos os 4 mínimos | ✅ | `routes/recebimentos.test.ts:268-341` |
| Casos que exercitam o threading `snDocCod` no POST `/solicitacao-numerario` | 2 casos: `snDocCod` presente → repassado como `snSelecionadaDocCod`; ausente → omitido do payload interno | ambos (presente threaded + ausente omitido) | ✅ | `routes/recebimentos.test.ts:410-440` |
| Casos que exercitam o gating do botão "Processar" no FE (processo + SN escolhidos, valor válido, gerNum presente) | 5 casos — sem processo (sem botão), com processo default (novo=habilitado), valor excede saldo (desabilitado), valor zero (desabilitado), gerNum ausente (desabilitado) | ≥3 dos cenários de gating (processo/valor/gerNum) | ✅ | `AlocarProcessosDialog.test.tsx:163-277` |
| Casos que provam o body do POST FE→BE (`snDocCod` enviado para SN existente, omitido para "Criar novo SN") | 2 casos dedicados + 1 reset ao trocar processo | 2 ("existente envia" + "novo omite") | ✅ | `AlocarProcessosDialog.test.tsx:177, 200, 215` |
| Determinismo — número de chamadas de rede (axios/fetch) reais nos testes do delta | 0 (client mocka `ConexosBaseClient`; service mocka todos os clients; rota mocka o cliente via container; FE mocka `@/lib/recebimentos`) | 0 | ✅ | grep `axios\|fetch(` nos 4 arquivos de teste — só o helper `fetch` do supertest do Express local, não rede externa |
| Determinismo — leitura de tempo/random no delta sem seams | 1 leitura `Date.UTC(2026, 7, 3)` no fixture do client test (input controlado, não determinístico do sistema); zero `new Date()` / `Math.random()` no path novo do service (o `dataReferencia: new Date()` no service já existia — não é delta do ADR-0027) | 0 leituras não-injetáveis introduzidas no delta | ✅ | `ConexosGerDocProcessoClient.test.ts:585,637,672`; service.ts:250 (pré-existente) |
| Tamanho dos test files tocados | client: 786 LOC · service: 1220 LOC · rota: 571 LOC · FE dialog: 393 LOC | Test file ≤ 500 LOC (guideline: > 500 = unidade sob teste está gorda demais) | ⚠️ | `wc -l` — service e client acima; delta ADR-0027 acrescentou 30/113/108/180 linhas, respectivamente — service.test já era largo antes (não é dívida do delta) |
| Sinal do runtime — 3 suites backend do delta rodadas localmente | 3 suites pass / 115 casos pass / 0 fail / 11.44s | 100% pass | ✅ | `npx jest --testPathPatterns=... --silent` (rodado agora) |
| Sinal do runtime — 1 suite FE do delta rodada localmente | 1 suite pass / 23 casos pass / 0 fail / 10.98s | 100% pass | ✅ | `npx jest --testPathPatterns='AlocarProcessosDialog' --silent` (rodado agora) |
| Pre-existing e2e do repo (recebimentos.e2e.*) | 14 fail — INALTERADOS por este feature (falham igualmente no branch base `fix/erp-4xx-nao-retentavel`) | não é escopo do ADR-0027 corrigir | ⚠️ (fora do escopo) | Nota de escopo do prompt do usuário |
| Cobertura de branch `snSelecionadaDocCod` na retomada por ledger | 0 casos que combinem `existente?.docCod` **E** `ctx.snSelecionadaDocCod` (a linha `snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod` — service.ts:357) | ≥1 caso: analista escolheu SN existente X **enquanto** o ledger já tem docCod=Y de uma execução anterior → precedência de X (o "selected wins") | ❌ | Ausência confirmada: `RecebimentoNumerarioService.test.ts:255` só cobre "existente sem ledger prévio" |
| Cobertura FE — helper `fetchSNsDoProcesso` (URL construction + query string + error propagation) | 0 casos diretos (só exercitado transitivamente pelo dialog test com mock do módulo inteiro) | ≥1 caso direto (assert que o URL é `/recebimentos/processos/:priCod/sns?filCod=<n>` e que 500 propaga) | ❌ | `grep -rn "fetchSNsDoProcesso"` — nenhum test file dedicado ao lib |

> ⚠️ **Não medível localmente**: cobertura de linhas/branches oficial das 4 suites (nem no CI atual há relatório de coverage publicado; o Jest do repo não roda com `--coverage` por default). Recomendação: rodar `--coverage --collectCoverageFrom='src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts' --collectCoverageFrom='src/backend/domain/client/ConexosGerDocProcessoClient.ts' --collectCoverageFrom='src/backend/routes/recebimentos.ts'` (backend) e `--collectCoverageFrom='src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx'` (FE) e ancorar um threshold local só para os arquivos do delta (P2, não bloqueante da feature).

## 3. Tactics — Cobertura no delta ADR-0027

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Control Component Interfaces / Specialized Interfaces** | Todo client injetado por construtor: o service test constrói `new RecebimentoNumerarioService(gerDoc, fin014, fiscal, nde, ContingenciaDecider, env, SnPayloadBuilder, repo, ndeRepo, log, ErpErrorInterpreter)` com mocks tsyringe (`jest.Mocked<...>`). A rota resolve pelo `container.registerInstance` no teste. | ✅ presente | `RecebimentoNumerarioService.test.ts:179-192`; `routes/recebimentos.test.ts:274-277` (registra stub via container) |
| **Recordable Test Cases** | O client test usa fixtures inline HAR-fiel (`Date.UTC(2026, 7, 3)` = doc real 731 do HML; `docVldTipoAdto: 0` = NC/ND real do processo) que replicam o wire do Conexos. O comentário do ADR-0027 amarra o filtro à captura real de 2026-08-03. | ✅ presente | `ConexosGerDocProcessoClient.test.ts:582-596` (fixture SN 731); `ConexosGerDocProcessoClient.ts:1038-1047` (fonte HAR do filtro) |
| **Sandbox** | Nenhum teste do delta chama Conexos real, Postgres real ou rede externa. O `bootstrapAppContainer` é mockado no route test (`routes/recebimentos.test.ts:8-10`) — o container fica sob controle do teste. FE dialog mocka `@/lib/recebimentos` inteiro (fetch nunca é chamado). | ✅ presente | `routes/recebimentos.test.ts:8-10`; `AlocarProcessosDialog.test.tsx:20-29` |
| **Executable Assertions (invariant-anchored)** | Cada invariante do ADR-0027 tem asserção nomeada: I-Receb-3 "não duplica SN" → `expect(finalizarDocumento).not.toHaveBeenCalled()` + `gerarDocProcesso.toHaveBeenCalledTimes(1)` + `.tela === 'com297'`; defensive filter NC/ND → `expect(sns).toHaveLength(1)`; authz cross-filial → `expect(res.status).toBe(403)` + `body.code === 'FILIAL_NAO_AUTORIZADA'`; FE gating → `expect(botao).toBeEnabled()` só após seleção. | ✅ presente | service.test:270-282; client.test:661-664; routes.test:307-318; dialog.test:163-175 |
| **Abstract Data Sources** | O `EnvironmentProvider` (env real do backend) é substituído no teste por um stub (`buildEnv({ conexosWriteEnabled: true, ... })`) via container; `TransacaoRepository.findById` é injetado (rota); `ConexosGerDocProcessoClient.listSNsByProcesso` é substituído por `jest.fn()` na rota. Não há caminho "hardcoded to prod source". | ✅ presente | `routes/recebimentos.test.ts:365-383`; service.test:37-51 |
| **Limit Structural Complexity** | Handler (rota) fino: só valida body/query, resolve container, delega. Isso permitiu testar authz+threading sem stub do Conexos. Serviço é o único ponto largo (1220 LOC de test), mas o ADR só encostou 30 linhas (bloco SN-existente); o restante do teste já existia. | ⚠️ parcial | `routes/recebimentos.ts:441-537` (rota fina); `RecebimentoNumerarioService.ts:200+` (service ainda gordo, mas fora do delta) |
| **Limit Non-Determinism** | **Zero** rede/DB/tempo/random novos no path testado. `runWithRetry` do `ConexosBaseClient` é curto-circuitado com `mockImplementation((fn) => fn())` (client.test:10) — retries não flakam o teste. As duas leituras de `Date.UTC(...)` no fixture do client são determinísticas (input do teste, não do sistema). | ✅ presente | `ConexosGerDocProcessoClient.test.ts:10`; ausência de `Math.random`/`crypto.randomUUID` no delta |
| **Built-In Monitors (log-as-assertion)** | O client test asserta o `BUSINESS_WARN` do soft-confirm QUESTION (log.warn chamado 1× com type/data corretos — client.test:132-137). O service test asserta `logStub.info` do "sn-cond-pgto-exigida-pelo-erp" (service.test:543-549). Nada no ramo SN-existente asserta log — trade-off: o ramo é um NO-OP explícito (não escreve log próprio), então não há evento observável a assertar (aceitável). | ✅ presente onde faz sentido | client.test:132-137; service.test:543-549 |

## 4. Findings (achados)

### F-testability-1: Ramo "SN existente + retomada por ledger" tem 0 casos combinados

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (invariante coberto por asserção parcial)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:357` (`snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod`); teste ausente em `RecebimentoNumerarioService.test.ts`
- **Evidência (objetiva)**:
  ```
  # A precedência é "selecionada > ledger" (?? preserva a select):
  let snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod;
  # O único teste do ramo (linha 255) NÃO usa ledger prévio:
  #   (m.repo.findByIdempotencyKey as jest.Mock) mantém o default = null
  ```
- **Impacto técnico**: Se um refactor trocar `??` por `||` sem semântica equivalente, ou se inverter a precedência para `existente?.docCod ?? ctx.snSelecionadaDocCod`, uma re-tentativa que reaproveitasse `docCod=Y` do ledger ignoraria a seleção X do analista — silenciosamente, sem quebrar teste algum. O status voltaria `settled` apontando para a SN errada.
- **Impacto de negócio**: Baixa fin014 executada contra a SN errada (SN antiga do ledger em vez da SN que o analista viu na tela e escolheu). Contabilidade fica ambígua e o analista não descobre pelo happy-path do teste.
- **Métrica de baseline**: 0 casos combinam `snSelecionadaDocCod` **e** `existente.docCod` populado.

### F-testability-2: Helper `fetchSNsDoProcesso` sem teste direto de URL construction

- **Severidade**: P3
- **Tactic violada**: Specialized Interfaces (o wire FE→BE não tem teste próprio)
- **Localização**: `src/frontend/lib/recebimentos.ts:526-539`; teste ausente
- **Evidência (objetiva)**:
  ```
  # A URL é montada com encodeURIComponent 2×:
  `${API}/recebimentos/processos/${encodeURIComponent(String(priCod))}/sns?filCod=${encodeURIComponent(String(filCod))}`
  # Só é exercitado indiretamente pelo dialog.test com jest.mock do módulo inteiro.
  ```
- **Impacto técnico**: Uma troca acidental de `filCod` para query-string sem escape, ou mudança da rota (`/sns` → `/solicitacoes`) só quebra em integração, não em unit test. O 500 do backend é propagado como `throw new Error('API ${res.status}')` mas isso não é assertado em nenhum lugar.
- **Impacto de negócio**: Baixo — o dialog test mocka o módulo inteiro, então o comportamento observável ao usuário é coberto. É um teste "de contrato" que aumentaria confiança em refactor puro do lib.
- **Métrica de baseline**: 0 casos diretos em `src/frontend/lib/recebimentos.test.ts` (arquivo sequer existe para essa função).

### F-testability-3: Sem teste do envelope pageNumber/count paginação em `listSNsByProcesso`

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (paridade com `listCondPgtoPessoa`, que TEM teste específico)
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1049-1117`
- **Evidência (objetiva)**:
  ```
  # listCondPgtoPessoa TEM teste explícito da paginação (count vs. pageSize honrado ou não):
  ConexosGerDocProcessoClient.test.ts:468 ('PAGINA pelo count mesmo quando o ERP IGNORA o pageSize')
  # listSNsByProcesso passa pageSize=50 (padrão) mas NÃO tem teste que meça:
  #   - o que acontece com count > 50 (só chama 1 vez? pagina? trunca?)
  # A implementação usa listGenericPaginated(pageNumber: 1) — 1 chamada só, top-N.
  ```
- **Impacto técnico**: Se um processo tiver > 50 SNs históricas (raro, mas possível em cliente antigo), o analista só vê as 50 mais recentes. O comportamento é INTENCIONAL (comentário do client: "Leitura paginada idempotente → `listGenericPaginated`") mas não está assertado como invariante.
- **Impacto de negócio**: Baixo hoje (processos raramente têm > 50 SNs); risco cresce com tenure do cliente. Analista pode não ver uma SN antiga em rebilling manual e criar uma duplicada.
- **Métrica de baseline**: 0 casos que meçam o comportamento com `count > pageSize` no `listSNsByProcesso` (contra 2 casos análogos no `listCondPgtoPessoa`).

### F-testability-4: FE não valida o `valor` alocado contra o `solicitado`/`valor` da SN escolhida

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (I-Receb-3 "teto ≤ saldo do título" só é enforced no backend, no `fin014.gravarBaixa` — o FE não tem gate próprio)
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:381` (`excedeSaldo = valorSelecionado > saldoRestante + SALDO_TOL` mede contra o saldo do **pagamento**, não da SN)
- **Evidência (objetiva)**:
  ```
  # excedeSaldo compara com saldoRestante da TRANSAÇÃO, não com sn.solicitado/sn.valor:
  const excedeSaldo = valorSelecionado > saldoRestante + SALDO_TOL
  # Nenhum teste do dialog.test tenta: escolher SN existente com solicitado=100 e valor a alocar=15000.
  # O ADR-0027 D4 explicita: "o teto ≤ saldo é imposto na baixa (fin014), não aqui."
  ```
- **Impacto técnico**: **Consistente com o ADR-0027 D4** (o saldo real do título só existe em `lov/TituloBorderoReceber`, não no `com299/list`), então NÃO é bug — mas a decisão fica sem teste que a documente. Um dev futuro pode "consertar" o FE para bloquear pela lista e re-abrir o gap D4.
- **Impacto de negócio**: Contido ao backend hoje (baixa falha com mensagem clara). Se um dev futuro alterar o FE para "bloquear pelo valor da lista", vira UX errada (bloqueia alocações válidas onde o título já foi parcialmente baixado). Um teste-guarda evita esse cenário.
- **Métrica de baseline**: 0 casos que documentem "valor > sn.solicitado é permitido no FE porque o enforcement fica na baixa".

### F-testability-5: Rota `/processos/:priCod/sns` sem teste do caminho de erro do client

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (path de erro)
- **Localização**: `src/backend/routes/recebimentos.ts:366-394`
- **Evidência (objetiva)**:
  ```
  # A rota chama client.listSNsByProcesso(...) sem try/catch próprio — depende do errorMiddleware.
  # Os 4 casos do bloco só cobrem: 200 sucesso, 403 authz, 400 sem filCod, 400 priCod inválido.
  # Não há caso que force o client a lançar ConexosError (500 na origem) e assertar que a rota
  # responde 5xx com mensagem, em vez de vazar o stack.
  ```
- **Impacto técnico**: Uma rota que faz `throw` sem serialização passa o erro cru para o errorMiddleware — comportamento OK, mas não testado no delta. Um refactor que adicione `try/catch` na rota pode silenciar o erro sem quebrar teste.
- **Impacto de negócio**: Baixo — o `errorMiddleware` existe e é usado em outras rotas.
- **Métrica de baseline**: 0 casos no bloco `describe('GET /recebimentos/processos/:priCod/sns...')` que forcem uma falha do client downstream.

### F-testability-6: Test files acima de 500 LOC (pré-existente, não introduzido pelo delta)

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `RecebimentoNumerarioService.test.ts` (1220 LOC), `ConexosGerDocProcessoClient.test.ts` (786 LOC), `routes/recebimentos.test.ts` (571 LOC)
- **Evidência (objetiva)**:
  ```
  wc -l:
     1220 RecebimentoNumerarioService.test.ts
      786 ConexosGerDocProcessoClient.test.ts
      571 routes/recebimentos.test.ts
      393 AlocarProcessosDialog.test.tsx
  ```
- **Impacto técnico**: Test file > 500 LOC = a unidade sob teste (service/client) é grande e concentra muitas invariantes. O ADR-0027 só acrescentou 30/113/108 linhas (service/client/rota), então NÃO é dívida do delta — é um retrato do que já existia.
- **Impacto de negócio**: Neutro para a feature; risco de degradação futura (adicionar caso a um arquivo já enorme é oneroso, e desestimula testar). O delta manteve a proporção (adicionou testes proporcionalmente ao código novo).
- **Métrica de baseline**: 3 test files acima do threshold.

## 5. Cards Kanban

### [testability-1] Adicionar teste combinando `snSelecionadaDocCod` + ledger pré-existente (precedência da seleção)

- **Problema**
  > O ramo "SN existente + retomada por ledger" (`service.ts:357`) usa `??` para dar precedência à seleção do analista sobre o docCod que já está no ledger. Zero testes cobrem esse combined branch — um refactor que troque `??` por `||` ou inverta a ordem quebraria a precedência silenciosamente e a baixa iria contra a SN errada.

- **Melhoria Proposta**
  > Adicionar 1 caso em `RecebimentoNumerarioService.test.ts` no bloco "retomada": stub de `findByIdempotencyKey` retornando `{ docCod: 999, ... }` **junto com** `baseInput({ snSelecionadaDocCod: 18202 })`. Assertar `out.snDocCod === 18202` (não 999) E `fin014.listTitulosBorderoReceber` chamado com `{ docCod: 18202 }`. Tactic Bass: Executable Assertions ancorada no invariante "seleção do humano tem precedência sobre estado persistido" (ADR-0027 D3).

- **Resultado Esperado**
  > O ramo combined (seleção + ledger) fica coberto por teste dedicado. Cobertura do ramo `??`: 0 → 1 caso.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos que combinam `snSelecionadaDocCod` + `existente.docCod` populado: 0 → 1
  - Suite `RecebimentoNumerarioService.test.ts`: 42 → 43 casos
- **Risco de não fazer**: Um dev que "arrume" o `??` para `||` (comportamento sutilmente diferente com `docCod=0`) ou inverta a precedência em uma refatoração passa no CI e chega em produção. Baixa contra SN errada = incidente financeiro que só o analista pega ao conciliar.
- **Dependências**: nenhuma

### [testability-2] Teste-guarda documentando que o FE NÃO valida `valor` contra o `solicitado`/`valor` da SN (ADR-0027 D4)

- **Problema**
  > A decisão D4 do ADR-0027 é explícita: o teto do valor alocado ≤ saldo é enforced na baixa `fin014` (que lê o título via `lov/TituloBorderoReceber`), não no FE — porque `com299/list` é document-level e não carrega o saldo por-título. Essa decisão não tem teste que a documente. Um dev futuro pode achar que "falta gating" e adicionar validação client-side pelo `sn.solicitado`, quebrando alocações válidas onde o título já foi parcialmente baixado.

- **Melhoria Proposta**
  > Adicionar 1 caso em `AlocarProcessosDialog.test.tsx`: escolher SN existente com `snExistente.solicitado = 100`, digitar valor `15000` (< saldo do pagamento), assertar que o botão "Processar" continua **habilitado** (o FE não bloqueia; o backend decide). Comentário do teste amarra ao ADR-0027 D4. Tactic Bass: Executable Assertions ancorada em decisão de arquitetura.

- **Resultado Esperado**
  > A decisão D4 vira asserção. Cobertura do gate "FE não bloqueia por sn.solicitado": 0 → 1 caso; um refactor bem-intencionado que adicione gate client-side quebra este teste.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Casos que documentam ADR-0027 D4 no FE: 0 → 1
  - Suite `AlocarProcessosDialog.test.tsx`: 23 → 24 casos
- **Risco de não fazer**: Dev futuro adiciona validação client-side "óbvia" pelo valor da lista, quebra alocações reais (título parcialmente baixado tem saldo < valor original), analista fica sem conseguir alocar e liga para suporte. Fix requer re-derivar a decisão D4 do zero.
- **Dependências**: nenhuma

### [testability-3] Teste de contrato do helper `fetchSNsDoProcesso` (URL + error propagation)

- **Problema**
  > `fetchSNsDoProcesso` (`src/frontend/lib/recebimentos.ts:526`) monta a URL do backend com dois `encodeURIComponent` e propaga erros HTTP como `throw new Error('API ${res.status}')`. Só é exercitado transitivamente pelo dialog test (que mocka o módulo inteiro) — nenhum teste direto assertaria uma troca acidental da rota (`/sns` → `/solicitacoes`) ou falha de escape.

- **Melhoria Proposta**
  > Criar `src/frontend/lib/recebimentos.test.ts` (ou reutilizar arquivo se existir) com 2 casos: (a) `fetch` mockado devolve `{sns:[snExistente]}` → assert URL é `/recebimentos/processos/3254/sns?filCod=4` (composição correta); (b) `fetch` mockado devolve 500 → assert `await fetchSNsDoProcesso(3254, 4)` rejeita com `Error('API 500')`. Tactic Bass: Specialized Interfaces (contrato do wire FE→BE testado sem UI).

- **Resultado Esperado**
  > O contrato do wire FE→BE do ADR-0027 fica testado sem depender do dialog. Cobertura direta de `fetchSNsDoProcesso`: 0 → 2 casos.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos diretos em `lib/recebimentos.test.ts` para `fetchSNsDoProcesso`: 0 → 2
- **Risco de não fazer**: Baixo. Refactor puro do lib (renomear função, alterar composição da URL) pode passar no CI mesmo quebrando o contrato — só o e2e pega, e o e2e do repo tem 14 fails pré-existentes que mascaram o sinal.
- **Dependências**: nenhuma

### [testability-4] Paginação de `listSNsByProcesso` — decidir e testar (top-N vs. paginação completa)

- **Problema**
  > `listSNsByProcesso` (`ConexosGerDocProcessoClient.ts:1049`) chama `listGenericPaginated({pageNumber: 1, pageSize: 50})` uma única vez — comportamento intencional (top-N por `docCod desc`), mas não assertado como invariante. Se um processo tiver > 50 SNs históricas, o analista só vê as 50 mais recentes; nenhum teste mede isso, ao contrário do `listCondPgtoPessoa` que TEM 3 casos de paginação.

- **Melhoria Proposta**
  > Duas opções — decidir com o Yuri antes de implementar:
  > (a) **Manter top-N** (posição atual): adicionar 1 caso que assert `listGenericPaginated.toHaveBeenCalledTimes(1)` E que documente "top-N desc" no comment.
  > (b) **Paginar completo** (paridade com `listCondPgtoPessoa`): refatorar `listSNsByProcesso` para acumular até `count`, adicionar 2 casos (envelope com count > pageSize; envelope sem count → 1 página só).
  > Tactic Bass: Limit Non-Determinism (comportamento explícito) + Executable Assertions.

- **Resultado Esperado**
  > Comportamento de paginação da nova rota READ fica documentado por teste. Cobertura: 0 → 1 caso (opção a) ou 0 → 2 casos (opção b).

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S (opção a) / M (opção b)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Casos que documentam a paginação de `listSNsByProcesso`: 0 → 1 (a) ou 0 → 2 (b)
- **Risco de não fazer**: Baixo hoje (cliente novo → poucas SNs por processo). Cresce com tenure — em 2 anos, cliente antigo com > 50 SNs históricas pode reciclar uma SN antiga que o analista não vê na tela → duplicata financeira.
- **Dependências**: decisão de produto (Yuri) sobre top-N vs. paginação completa

## 6. Notas do agente

- **Escopo**: audit RESTRITO ao delta do ADR-0027 (9 arquivos, 958 insert / 159 delete conforme `_shared-metrics.md`). Não avaliei o restante do backend/frontend.
- **Runtime confirmado**: rodei localmente as 4 suites — 115 pass (backend, 11.44s) + 23 pass (FE, 10.98s), zero fails. Os 14 e2e fails pré-existentes (`recebimentos.e2e.*`) foram declarados fora de escopo pelo prompt e reproduzem no branch base (`fix/erp-4xx-nao-retentavel`).
- **F-testability-6** (test files > 500 LOC) é pré-existente ao delta — mantive P3 para não inflar o Kanban da feature. O card correspondente já cabe no back-log de "modifiability" do repo.
- **Cross-QA hooks para o consolidator**:
  - F-testability-1 (precedência seleção > ledger) cruza com **Fault Tolerance** (retomada anti-duplicação).
  - F-testability-4 (paginação) cruza com **Integrability** (contrato do `com299/list` do Conexos).
  - F-testability-2 (helper FE sem teste) cruza com **Modifiability** (refactor do lib sem safety net).
