---
qa: Testability
qa_slug: testability
run_id: 2026-09-22-2209
agent: qa-testability
generated_at: 2026-09-23T00:00:00-03:00
scope: backend+frontend (delta de sispag-reter-titulo-lote)
score: 7.9
findings_count: 5
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (Columbia/Kavex) durante um `/feature-tweak` sobre a retenção da formação automática (ADR-0050) | Mudar `LotePagamentoService.retirarDoLote`, o índice único parcial da 0062, o CHECK `motivo <= 500`, ou o dialog `RetirarDoLoteDialog` (motivo trim + botão disabled + reset por chave) | `LotePagamentoService` (543 LOC), `RetencaoFormacaoRepository` (105 LOC), `titulo_retencao_formacao` (migration 0062), rotas `POST retirar-do-lote` / `DELETE retencao`, dialog + badge no painel SISPAG | Dev local (`npm test` colocado ao lado do fonte) + CI (`.github/workflows/ci.yml`, `npm test -- --coverage` bloqueando merge, sem Postgres real para o repositório novo) | O suite exercita as invariantes I2/I3/I4/I5/I6/I9 direto na fronteira do serviço, os dois caminhos de retenção (lixeira dentro do lote com `se-automatico` × "Retirar do lote" com `sempre`), a idempotência do `ON CONFLICT ... WHERE removido_em IS NULL` (mockada), o SQL da formação com `NOT EXISTS titulo_retencao_formacao` e as respostas 200/400/401/403/404/409 das rotas | Delta com **3.193 linhas de teste** cobrindo **4.770 linhas** de fonte (razão 0,67; alvo repo global 0,08 medido em 305 test.ts vs. 4.000 ts). Assertions numéricas dentro dos gates (`146 suites / 2.196 testes` backend, `49 / 417` frontend, todos verdes após rebase). Cobertura % **não medida** nesta rodada (`_shared-metrics.md:52`) |

Escopo: avalio o **delta** contra a infraestrutura de teste já existente do repo (Jest + ts-jest colocado ao lado do fonte no backend, Jest + Testing Library no frontend, `test:sql` para integration Postgres, `coverageThreshold` por diretório). Não uso `fast-check` como métrica: **o repo não tem essa dependência** (checado em `src/backend/package.json` e `src/frontend/package.json` — só `@testing-library/*` e `jest-30`). A missão genérica citava, é ruído aqui.

## 2. Métricas observadas

### 2.1 Cobertura estrutural do delta (Métrica #1 — a mais citada num review de testability)

| Camada tocada pelo delta | Fontes (LOC) | Testes (LOC) | Razão | Ratio de arquivos com teste | Status |
|---|---|---|---|---|---|
| `domain/service/sispag/` (LotePagamentoService, SispagPainelService) | 987 | 1.267 | 1,28 | 2/2 | ✅ |
| `domain/repository/sispag/` (LotePagamentoRepository, RetencaoFormacaoRepository, TituloAPagarRepository) | 960 | 523 | 0,54 | 3/3 | ✅ (mock) / ⚠️ (0 integration) |
| `migrations/` (0062_titulo_retencao_formacao.sql) | 70 | 58 | 0,83 | 1/1 estática, 0/1 integration | ⚠️ (idem F-deployability-1) |
| `routes/sispag.ts` | 716 tot. (+109 delta) | 1.012 tot. (+188 delta) | 1,41 | 1/1 | ✅ |
| `domain/errors/` (Retencao, TituloForaDeLote) | 43 | 0 | — | 0/2 | ✅ (só constantes; exercitados via serviço/rota) |
| `frontend/lib/sispag.ts` | 787 (+56 delta) | 221 (+70 delta) | 0,28 (só o delta: 1,25) | 1/1 | ✅ |
| `frontend/app/sispag/components/retencao.ts` (helpers puros) | 46 | 75 | 1,63 | 1/1 | ✅ |
| `frontend/app/sispag/components/RetirarDoLoteDialog.tsx` (dialog stateful) | 133 | 0 | 0 | **0/1** | ⚠️ (F-testability-1) |
| `frontend/app/sispag/components/RetencaoBadge.tsx` (tooltip + aria-label) | 39 | 0 | 0 | **0/1** | ⚠️ (F-testability-1) |
| `frontend/app/sispag/components/LoteCard.tsx` (+87 delta) | 597 tot. | 0 | — | 0/1 | ⚠️ (pré-existente, fora do delta) |
| `frontend/app/sispag/page.tsx` (+154 delta) | 1.229 tot. | 0 | — | 0/1 | ⚠️ (pré-existente, fora do delta) |
| **Total do delta** | **~4.770** | **~3.193** | **0,67** | **9/16 arquivos** | ✅ (bem acima do baseline do repo) |

### 2.2 Baseline global (contexto para as métricas do delta)

| Métrica | Valor atual | Alvo (heurística Bass) | Fonte |
|---|---|---|---|
| Arquivos de teste backend | 305 `.test.ts` vs. 4.000 `.ts` (razão 0,076) | ≥0,20 no médio prazo; ≥0,50 é excelência | `find src/backend -name '*.test.ts' \| wc -l` |
| Arquivos de teste frontend | 234 `.test.ts(x)` vs. 495 `.ts(x)` (razão 0,47) | ≥0,50 | idem para `src/frontend` |
| Integration tests backend (Postgres/HTTP real) | 15 (`vwMetricasCiclo` + 14 de `recebimentos.e2e.*`) | Pelo menos 1 por repositório com DDL não-trivial | `find src/backend -iname '*.integration.test.ts'` |
| `coverageThreshold` global backend | lines 72 / branches 54 / functions 78 (`jest.config.cjs:39-48`) | Ratchet acima do medido; hoje distante do real | `src/backend/jest.config.cjs:39-48` |
| `coverageThreshold` `domain/service/` backend | lines 88 / branches 60 (`jest.config.cjs:44-47`) | Bass 80/70 — atendido | `src/backend/jest.config.cjs` |
| Cobertura % medida nesta rodada | Não medida (`_shared-metrics.md:52`) | Deveria ser medida em toda revisão pós-rebase | `_shared-metrics.md:52` |
| Estilo de teste do serviço (constructor injection vs. `container.resolve` de reais) | 100% constructor injection (`new LotePagamentoService(repo as unknown as ..., …)`) | Padrão do CLAUDE.md ("Test the service layer, not the handler directly") | `LotePagamentoService.test.ts:108-115` |
| Estilo de teste da rota | Container real + `container.registerInstance(Service, mock)`; app HTTP real com `express` e `fetch` | Coerente com o padrão `sispag.test.ts` já existente | `routes/sispag.test.ts:1-72` |
| Não-determinismo introduzido pelo delta (`Math.random`, `Date.now()`, `new Date()` em código de produção) | 1 sítio: `retencao.ts:15` (`new Date(iso)` para formatar a data ISO recebida do backend em pt-BR) | 0 fontes não-determinísticas em produção; tolerável para formatação de string já-ISO | `git diff main...HEAD` filtrado |
| Testes fazendo rede real (`axios`/`fetch` a serviço externo) | 0 no delta (o `fetch` do `routes/sispag.test.ts` bate no servidor local `app.listen(0)`) | 0 em unit tests; ok em integration marcado | `routes/sispag.test.ts:74-84` |
| `describe`/`it` por arquivo do delta | LotePagamentoService.test: 57 · sispag.test: 60 · SispagPainelService.test: 26 · RetencaoFormacaoRepository.test: 4 · retencaoFormacao.test (migration): 7 · retencao.test (FE helpers): 12 | Um por método público × caminho lógico | `grep -cE "\s+(describe\|it)\("` |
| Suítes verdes após rebase | 146 backend / 49 frontend; 2.196 + 417 testes | 100% verde | `_shared-metrics.md:65-66` |

### 2.3 Cobertura das transições da máquina de estado (tactic Executable Assertions)

O ADR-0050 modela um sub-ciclo dentro do lote SISPAG: o título transita `livre → em-lote-rascunho → retido → livre` (via `liberar`) ou `retido → em-lote-rascunho` (via `incluirTitulo`). Cada transição tem teste dedicado no `LotePagamentoService.test.ts:552-747`:

| Transição | Teste que a exerce | Assertion-chave |
|---|---|---|
| lote-automático → título removido → **retido** (P1-1) | `it('lote AUTOMÁTICO: lê automatico ANTES do marcarManual e retém, na mesma transação', …)` | ordem de chamada `lerEstadoParaEdicao` antes de `marcarManual`, mesmo `tx` em todas as escritas |
| lote-manual → título removido → **NÃO retido** | `it('lote MANUAL: remove sem reter', …)` | `retencaoRepo.insertAtiva` não chamado |
| retirar-do-lote (aba de títulos) → **retido sempre** | `it('acha o lote RASCUNHO do título, remove e retém com o motivo, …)` | `insertAtiva` com o motivo trimado, `tocarLote` na mesma tx |
| retido → **incluído no lote** (encerra a retenção, motivo `incluido-no-lote`) | `it('incluirTitulo libera a retenção ativa na MESMA transação (incluido-no-lote)', …)` | `liberarAtiva` recebe o **mesmo tx** que `adicionarItem` |
| retido → **liberado** (motivo `liberado`) | `it('soft delete com motivo liberado e autor', …)` | `motivoRemocao: 'liberado'` |
| liberar sem retenção ativa → **erro** | `it('sem retenção ativa → RetencaoInexistenteError', …)` | tipo do erro |
| item sumiu entre busca e lock → **erro sem retenção** | `it('item sumiu entre a busca e o lock → TituloForaDeLoteError, sem retenção', …)` | rollback implícito via tx |
| lote saiu de RASCUNHO entre leitura e lock → **erro** | `it('lote que saiu de RASCUNHO entre a leitura e o lock é recusado', …)` | `LoteEstadoInvalidoError`, sem escrita |
| falha ao inserir retenção → **rollback da remoção** | `it('falha ao gravar a retenção propaga (a transação desfaz a remoção)', …)` | `tocarLote` não chamado |

**Métrica**: 9 de 9 transições da máquina de retenção têm teste; a distinção `se-automatico` × `sempre` (o ponto sensível de ADR-0050 P1-1, onde uma inversão da ordem de `automatico`/`marcarManual` mataria a retenção da lixeira) é travada por `mock.invocationCallOrder`, não só pelo estado final. ✅ presente.

### 2.4 Métrica de segurança da migração (overlap com Deployability F-1)

| Métrica | Valor atual | Alvo | Status |
|---|---|---|---|
| Guardas estáticas do SQL de 0062 (existência de tabela, chave natural, sem FK, índice parcial, CHECKs, idempotência sem DML) | 7 casos (`migrations/retencaoFormacao.test.ts:15-58`) | ≥6 propriedades estruturais | ✅ |
| Aplicação da 0062 contra Postgres real em CI | 0 (versus 15 `*.integration.test.ts` já existentes no repo, sob o script `test:sql`) | 1 (o pattern `test:sql` já existe) | ⚠️ (idem F-deployability-1) |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** (Control) | `LotePagamentoService` injeta `PostgreeDatabaseClient`, `RetencaoFormacaoRepository`, `LotePagamentoRepository`, `TituloAPagarRepository`, `ConexosSispagClient`, `LogService` via `@inject`. O teste `LotePagamentoService.test.ts:99-117` constrói o serviço com mocks diretos (constructor injection), **nunca** `container.resolve`. Isto isola a lógica do bootstrap real e das dependências externas. | ✅ presente (padrão CLAUDE.md) | `LotePagamentoService.ts:54-63`, `LotePagamentoService.test.ts:99-117` |
| **Recordable Test Cases** (Control) | Fixture-style rows para `RetencaoRow` e para `LotePagamento` embutidos no `test.ts` (`buildRepo()`, `buildRetencaoRepo()`, `titulo()`, `lote()`). Nenhum arquivo `*.fixture.*` como o repo já tem para SISPAG remessa (`src/backend/domain/interface/sispag/__fixtures__/2026-08-24-fin015-remessa-seg-a.rem`), o que é OK: o delta não persiste nem lê arquivo binário. | ✅ presente (adequado ao delta) | `RetencaoFormacaoRepository.test.ts:33-50`, `LotePagamentoService.test.ts:19-97` |
| **Sandbox** (Control) | `withTransaction` e `withAdvisoryLock` são mockados como `(fn) => fn({})` no teste — o serviço roda o corpo, mas nenhuma conexão real é aberta (`LotePagamentoService.test.ts:47-51`). O teste do lock ocupado usa `onBusy()` diretamente (`LotePagamentoService.test.ts:378-411`). | ✅ presente | `LotePagamentoService.test.ts:47-51,378-411` |
| **Executable Assertions** (Observe) | Erros de domínio novos (`TituloForaDeLoteError`, `RetencaoInexistenteError`) são construtores tipados; testes asseguram tipo (`.rejects.toBeInstanceOf`) e código HTTP mapeado (`code: 'TITULO_FORA_DE_LOTE'`, `code: 'RETENCAO_INEXISTENTE'`). O log de negócio (`BUSINESS_INFO`) é asserido em `retirarDoLote` e `liberarRetencao` do lado do serviço; o painel testa que a linha digitável **nunca** aparece nos logs (`SispagPainelService.test.ts:506-518`). | ✅ presente | `routes/sispag.test.ts:511-524,548-561`, `LotePagamentoService.test.ts:696-707` |
| **Abstract Data Sources** (Control) | O `RetencaoFormacaoRepository` recebe `PostgreeDatabaseClient` **e** um `TransactionClient` distinto — os testes mockam os dois separadamente e asseguram que escritas passam pelo tx (`RetencaoFormacaoRepository.test.ts:78-102`). Isso permite testar sem tabela real, mas a semântica do índice parcial e dos CHECKs **não é exercitada** (F-testability-2). | ⚠️ parcial | `RetencaoFormacaoRepository.test.ts:78-137` |
| **Limit Structural Complexity** (Limit) | Nenhum teste do delta > 1.100 LOC (o maior é `sispag.test.ts` com 1.012, dominado pela feature-irmã ADR-0049 já mesclada — o delta adicionou +188). `LotePagamentoService.test.ts` chega a 748 LOC para 543 LOC de fonte; a razão 1,38 indica lógica densa por linha (invariantes I2–I9), não teste inchado. Sem "God test files". | ✅ presente | `wc -l` dos test files (748, 519, 265, 138, 75, 58) |
| **Limit Non-Determinism** (Limit) | 1 uso de `new Date(iso)` em `retencao.ts:15` para formatar data pt-BR (input já ISO, saída determinística). 0 `Math.random` / `crypto.randomUUID` / `Date.now()` novos em produção. Nenhum `beforeAll` compartilhando estado entre `it()` no delta. Nenhum teste faz rede real. | ✅ presente | `git diff main...HEAD -- src \| grep -E "Math.random\|Date.now\|new Date\("` |

**Test the service layer, not the handler**: cumprido — o serviço tem 57 `describe`/`it` em `LotePagamentoService.test.ts`; a rota tem seus próprios 60 casos em `sispag.test.ts` que exercitam o *contrato HTTP*, não a lógica de negócio (tudo mockado com `container.registerInstance`). Zero duplicação: cada regra é testada uma vez, na camada certa.

**TDDGuide agent**: o CLAUDE.md do repo não referencia um `TDDGuide` explícito (só `PatternGuardian`, `AutoLoopRunner`, `SpecVerifier`, `DesignSystemReviewer`). O ciclo TDD é orquestrado pelo `AutoLoopRunner` (green criteria #3: `npm test`). Não é gap desta feature.

## 4. Findings (achados)

### F-testability-1: Componentes do dialog e do badge de retenção sem `*.test.tsx`

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces / Executable Assertions (Observe System State — o dialog encapsula a interface pela qual a analista escreve o motivo, e a regra de UI dele não é asserida por nenhum teste)
- **Localização**: `src/frontend/app/sispag/components/RetirarDoLoteDialog.tsx` (133 LOC), `src/frontend/app/sispag/components/RetencaoBadge.tsx` (39 LOC)
- **Evidência (objetiva)**:
  ```
  # nenhum test.tsx para os dois novos componentes do delta:
  $ ls src/frontend/app/sispag/components/RetirarDoLoteDialog.tsx     -> presente
  $ ls src/frontend/app/sispag/components/RetirarDoLoteDialog.test.tsx -> ausente
  $ ls src/frontend/app/sispag/components/RetencaoBadge.tsx           -> presente
  $ ls src/frontend/app/sispag/components/RetencaoBadge.test.tsx      -> ausente

  # o padrão EXISTE no repo, no mesmo diretório, da feature-irmã ADR-0049:
  $ ls src/frontend/app/sispag/components/GerarRemessaDialog.test.tsx  -> presente (222 LOC)
  ```
- **Regras do dialog não asseridas hoje**:
  - `chave !== chaveAtual` reseta `texto` a cada abertura (evita "vazar" motivo do título anterior);
  - `texto.trim().length > MOTIVO_RETENCAO_MAX (500)` desabilita o botão e liga `aria-invalid`;
  - `onConfirmar(texto.trim())` — trima ANTES de enviar (o backend recusa 501 chars, então overshoot por espaço quebraria);
  - motivo em branco/whitespace-only NÃO é enviado no body (assegurado hoje **apenas** em `lib/sispag.test.ts:178-184`, no lado do cliente HTTP — não no botão do dialog);
  - contador `aria-live="polite"` para leitores de tela.
- **Impacto técnico**: uma regressão que apague o `setTexto('')` do bloco `chave !== chaveAtual` (anti-pattern React "derived state") faria o motivo do título A aparecer ao abrir o dialog do título B — direto no `retencaoRepo.insertAtiva` de outro título. Nenhum teste hoje falha se isso acontecer. Idem: se `onConfirmar(texto)` deixar de trimar, o backend passa a rejeitar strings de 500 chars + 1 espaço com 400 e a analista vê "salvei mas não salvei".
- **Impacto de negócio**: motivo grava a decisão da analista ("fornecedor pediu para segurar", "em negociação"). Aparecer o motivo do TÍTULO ANTERIOR na tela do próximo é registro de auditoria trocado — ADR-0050 D3 diz que essa é a trilha da decisão dela.
- **Métrica de baseline**: 0 de 2 componentes UI novos do delta com teste de componente; 1 de 3 arquivos `.tsx` novos com teste (`retencao.ts` tem, mas é helper puro, não componente). Referência: `GerarRemessaDialog.test.tsx` da feature ADR-0049 (mesma tela, gate anterior) — 222 LOC de teste.

### F-testability-2: `RetencaoFormacaoRepository` e migration 0062 nunca rodam contra Postgres real

- **Severidade**: P2 (converge com F-deployability-1 já registrada nesta rodada)
- **Tactic violada**: Abstract Data Sources / Sandbox — o mock cobre "o repo chama o SQL certo com os params certos", **não** cobre "o Postgres aceita e o índice parcial se comporta"
- **Localização**: `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.test.ts` (138 LOC, 100% mockado), `src/backend/migrations/retencaoFormacao.test.ts` (58 LOC, regex sobre o texto SQL)
- **Evidência (objetiva)**:
  ```
  # nada exercita o índice parcial ou os 3 CHECKs contra um Postgres real:
  $ grep -rn "titulo_retencao_formacao" src/backend --include='*.integration.test.ts'
  (nenhum resultado)

  # o padrão existe e é rotineiro (script `test:sql` em package.json + 15 files):
  $ find src/backend -iname '*.integration.test.ts' | wc -l
  15
  ```
- **Regras que só rodariam de verdade contra Postgres**:
  - `CREATE UNIQUE INDEX ... WHERE removido_em IS NULL` — duas retenções ativas para o mesmo `(fil_cod, doc_cod, tit_cod)` **têm** que ser rejeitadas com uma vez, e permitidas depois que uma delas é `removido_em IS NOT NULL` (release + re-hold);
  - `ON CONFLICT (fil_cod, doc_cod, tit_cod) WHERE removido_em IS NULL DO NOTHING` — a sintaxe do `WHERE` no target do conflito é aceita a partir do PG 15 e o repo roda em 17; um teste real trava a versão suportada;
  - CHECK `motivo IS NULL OR char_length(motivo) <= 500` — `char_length` opera sobre code points, não bytes; um motivo com 500 emojis (2.000 bytes UTF-8) deveria passar;
  - CHECK `(removido_em IS NULL) = (removido_por IS NULL) AND (removido_em IS NULL) = (motivo_remocao IS NULL)` — o *pareamento* dos três campos é a defesa contra um `liberarAtiva` que esqueça de gravar um dos três;
  - `NOT EXISTS (SELECT 1 FROM titulo_retencao_formacao r WHERE r.removido_em IS NULL AND r.fil_cod = t.fil_cod AND …)` no SQL da formação automática (`TituloAPagarRepository.listElegiveisParaFormacao`, testado hoje só por regex).
- **Impacto técnico**: qualquer erro nos itens acima só apareceria em produção, no primeiro boot com a 0062 aplicada. `BootMigrator` limita o dano a "deploy não promovido" (F-deployability-1), mas para o índice parcial existe um cenário pior: se a sintaxe `WHERE` do `ON CONFLICT` fosse rejeitada por alguma versão do driver `pg`, a migration **passaria** (o `CREATE INDEX` é OK) e só o **INSERT** em runtime falharia — o BootMigrator não pega isso, cai em 500 no primeiro `retirarDoLote`.
- **Impacto de negócio**: a analista clica "Retirar do lote", recebe 500, e o título fica sem retenção — na próxima rodada do cron, ele volta ao lote automático. Silenciosamente.
- **Métrica de baseline**: 0 de 1 arquivo novo do delta com integration test contra Postgres real; 15 de ~62 migrations do repo têm integration test (24%); o próprio script `test:sql` está no `package.json`.

### F-testability-3: `page.tsx` (154 linhas de delta) e `LoteCard.tsx` (+87) sem teste de componente

- **Severidade**: P3 (pré-existente — a página já era 1.229 LOC sem teste antes do delta)
- **Tactic violada**: Limit Structural Complexity — arquivos de UI que crescem sem teste viram black-boxes onde qualquer refactor precisa de QA manual
- **Localização**: `src/frontend/app/sispag/page.tsx` (1.229 LOC totais, +154 no delta), `src/frontend/app/sispag/components/LoteCard.tsx` (597 LOC, +87 no delta)
- **Evidência**: nem `page.test.tsx` nem `LoteCard.test.tsx` existem; o repo tem exemplos vizinhos (`app/operacao/page.test.tsx`, `app/permutas/components/banners.test.tsx`, 11 arquivos `.test.tsx` sob `app/`).
- **Impacto técnico**: o `page.tsx` orquestra o estado do dialog `RetirarDoLoteDialog` (abrir/fechar, `salvando`, `onConfirmar` que chama `retirarDoLote` e faz refresh do painel). Uma regressão que não feche o dialog após sucesso, ou que não invalide o cache após `liberarRetencao`, passaria despercebida pelo suite.
- **Impacto de negócio**: baixo — o handler HTTP é testado no `sispag.test.ts` (o efeito no ERP não existe: nada é escrito no Conexos por essa feature). O risco é UX (dialog órfão), não corrupção.
- **Métrica de baseline**: 0 de 2 arquivos com teste de componente; 11/{total tsx do app} no restante do repo.

### F-testability-4: Cobertura % não medida nesta rodada

- **Severidade**: P3 (pré-existente — política do processo, não do delta)
- **Tactic violada**: Executable Assertions / Deployment observability
- **Localização**: `_shared-metrics.md:52` ("Cobertura (%) | não medida nesta rodada")
- **Evidência**: `.github/workflows/ci.yml:27` roda `npm test -- --coverage` — o número existe em CI, mas não foi anexado às métricas do Regis-Review. O `coverageThreshold` do `jest.config.cjs:39-48` **passa** hoje (senão o `146 suites verdes` do `_shared-metrics.md:65` cairia), mas o valor absoluto (72 lines / 54 branches / 78 functions global + 88/60 em `domain/service/`) não é reportado por diretório do delta.
- **Impacto técnico**: sem número, não dá para dizer se `LotePagamentoService.ts` está em 95% (o esperado, dado 748 LOC de teste para 543 LOC de fonte) ou se algum caminho novo escapou. O ratchet do frontend (`jest.config.js` comentário: "Piso que só sobe quando alguém lembra não é gate, é decoração") já reconhece o problema.
- **Impacto de negócio**: baixo — o gate binário (passa/não passa) é suficiente para bloquear regressão; o número exato é só instrumentação.
- **Métrica de baseline**: 0 de 1 rodada de Regis-Review desta feature com cobertura % anexada; o CI a mede, então o custo é só rodar `npm test -- --coverage` e recortar o output.

### F-testability-5: `SispagInterface.ts` — constantes `MOTIVO_REMOCAO_RETENCAO` e `MODALIDADE` sem "guarda de sincronização" com o CHECK do banco

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (guarda de contrato constante-vs-schema)
- **Localização**: `src/backend/domain/interface/sispag/SispagInterface.ts` (+36 LOC no delta, define `MOTIVO_REMOCAO_RETENCAO = { LIBERADO: 'liberado', INCLUIDO_NO_LOTE: 'incluido-no-lote' }`)
- **Evidência**: o CHECK do banco é `motivo_remocao IN ('liberado', 'incluido-no-lote')` (0062:64). Se alguém adicionar `MOTIVO_REMOCAO_RETENCAO.CANCELADO_LOTE = 'cancelado-lote'` e esquecer de rodar uma migration alterando o CHECK, o serviço passa a chamar `liberarAtiva` com um valor que o CHECK rejeita — 500 em produção.
- **Assertion faltando**: um `it('sync constants ↔ CHECK', () => { expect(new Set(Object.values(MOTIVO_REMOCAO_RETENCAO))).toEqual(new Set(MOTIVOS_DA_MIGRATION_0062)))` que leia o texto da 0062 (o pattern já existe em `retencaoFormacao.test.ts`).
- **Impacto técnico**: baixo hoje (só 2 valores, imutáveis por definição do ADR-0050 D4/D5), mas cresce se novos motivos entrarem.
- **Métrica de baseline**: 0 asserts de sincronização entre `SispagInterface.ts` e `0062_titulo_retencao_formacao.sql`.

## 5. Cards Kanban

### [testability-1] Testar `RetirarDoLoteDialog.tsx` (motivo trim, botão disabled, reset por chave, contador a11y)

- **Problema**
  > O dialog que a analista usa para digitar o motivo da retenção (`RetirarDoLoteDialog.tsx`, 133 LOC de estado React + regras de UI) não tem teste. As regras que não estão asseridas incluem: **reset do texto quando muda o título aberto** (`chave !== chaveAtual`), **botão desabilitado quando `texto.trim().length > 500`**, **trim antes de chamar `onConfirmar`**, **`aria-live` do contador**. A feature-irmã ADR-0049 (`GerarRemessaDialog.tsx`, mesma tela) tem 222 LOC de teste — este delta pulou o mesmo passo.

- **Melhoria Proposta**
  > Tactic alvo: *Specialized Interfaces* / *Executable Assertions*. Criar `src/frontend/app/sispag/components/RetirarDoLoteDialog.test.tsx` seguindo o padrão de `GerarRemessaDialog.test.tsx`: `render` + `userEvent`, casos: (i) reset ao mudar de título, (ii) contador atualiza e vira "danger" acima de 500, (iii) confirmar dispara `onConfirmar(texto.trim())`, (iv) botão desabilita quando `salvando`, (v) motivo whitespace-only vai como string vazia. Bônus (P3): teste separado ou junto para `RetencaoBadge.tsx` — o `aria-label` compõe as três linhas do `detalheRetencao(...)` (já testado em `retencao.test.ts`), portanto vale mais assegurar que o `TooltipTrigger` recebe `tabIndex={0}` (foco por teclado).

- **Resultado Esperado**
  > Componentes UI do delta com teste: 0/2 → 2/2 (dialog + badge). Cobertura do diretório `app/sispag/components/` do delta sobe de "helpers puros testados, componentes stateful não" para "todos os componentes novos com teste de comportamento". `RetirarDoLoteDialog.test.tsx` com 5 casos mínimos; `RetencaoBadge.test.tsx` com 2 (tooltip abre por foco de teclado, aria-label contém motivo).

- **Tactic alvo**: Specialized Interfaces / Executable Assertions (Control & Observe)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — o padrão está no repo, é copiar `GerarRemessaDialog.test.tsx` e adaptar)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Arquivos `.test.tsx` no delta: 0 → 2
  - Casos que exercitam reset-por-chave e limite 500 no dialog: 0 → ≥3
- **Risco de não fazer**: uma regressão que apague o `setTexto('')` do reset por chave silenciosamente troca a autoria do motivo entre títulos; nenhum teste hoje falha.
- **Dependências**: nenhuma (já tem `@testing-library/react` no `package.json`).
- **Cross-QA**: overlap com Security (motivo é registro de decisão da analista; misturar entre títulos é falha de trilha de auditoria).

### [testability-2] Integration test da migration 0062 e do `RetencaoFormacaoRepository` contra Postgres real

- **Problema**
  > A migration `0062_titulo_retencao_formacao.sql` cria uma tabela nova com **índice único parcial** (`WHERE removido_em IS NULL`), **três CHECK constraints** (pareamento de nulos, enum de motivo_remocao, tamanho do motivo) e o `RetencaoFormacaoRepository.insertAtiva` usa `ON CONFLICT (…) WHERE removido_em IS NULL DO NOTHING`. Nenhuma dessas regras é exercitada contra um Postgres real: o teste do repo mocka `PostgreeDatabaseClient` e o teste da migration só faz regex sobre o texto SQL. O repo já tem 15 arquivos `*.integration.test.ts` (o script `test:sql` no `package.json`); o padrão está pronto para uso.

- **Melhoria Proposta**
  > Tactic alvo: *Abstract Data Sources* / *Sandbox*. Criar `src/backend/migrations/tituloRetencaoFormacao.integration.test.ts` no padrão de `vwMetricasCiclo.integration.test.ts`: aplica a 0062 num Postgres efêmero, insere uma retenção, prova (i) o índice parcial rejeita a segunda ativa para a mesma chave, (ii) permite reter de novo depois de `removido_em IS NOT NULL`, (iii) `ON CONFLICT DO NOTHING` no `insertAtiva` não vira erro, (iv) o CHECK rejeita `motivo_remocao = 'foobar'`, (v) `char_length(motivo) <= 500` conta code points (500 emojis passa; 501 falha), (vi) o pareamento CHECK rejeita `removido_em IS NOT NULL AND motivo_remocao IS NULL`. Este card **é o mesmo** de F-deployability-1 pelo consolidator — resolver um resolve o outro.

- **Resultado Esperado**
  > Integration tests contra Postgres real para 0062: 0 → 6 casos. Comportamento do índice parcial e dos CHECKs deixa de ser "confiança no que a regex viu" e passa a ser "o Postgres 17 concorda". Se um dia o `pg` driver mudar a semântica do `WHERE` em `ON CONFLICT` (aconteceu na história do PG), o CI pega.

- **Tactic alvo**: Abstract Data Sources (Control System State)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — infra `test:sql` já pronta)
- **Findings relacionados**: F-testability-2, F-deployability-1 (mesmo card no consolidator)
- **Métricas de sucesso**:
  - Integration tests do delta contra Postgres real: 0 → 1 arquivo, ≥6 casos
  - Comportamento do índice parcial testado: não → sim
- **Risco de não fazer**: o único caminho pelo qual um bug no índice parcial aparece hoje é um 500 em produção no primeiro `retirarDoLote` após deploy. `BootMigrator` não pega (o `CREATE INDEX` passa, o `INSERT` no runtime é que falha).
- **Dependências**: nenhuma; usa a mesma infraestrutura de CI que os 15 integration tests já rodam.
- **Cross-QA**: **converge com F-deployability-1** — o consolidator deve deduplicar em um único card, marcando ambos os QAs como beneficiários.

### [testability-3] Anexar cobertura % por diretório do delta ao próximo Regis-Review

- **Problema**
  > `_shared-metrics.md:52` diz "Cobertura (%) — não medida nesta rodada". O CI **já mede** (`npm test -- --coverage` em `.github/workflows/ci.yml:27`), e o `coverageThreshold` do backend já impõe piso de 88 lines / 60 branches em `domain/service/`. Sem anexar o número, nenhum revisor consegue afirmar se `LotePagamentoService.ts` está em 95% (esperado dado o ratio 1,38 de teste-por-fonte) ou se um ramo escapou.

- **Melhoria Proposta**
  > Tactic alvo: *Executable Assertions*. No próximo `/regis-review` pós-rebase, rodar `cd src/backend && npm test -- --coverage --silent 2>&1 | tail -50` e `cd src/frontend && npm test -- --coverage --silent --watchAll=false 2>&1 | tail -50`, recortar as linhas de `domain/service/sispag/`, `domain/repository/sispag/`, `routes/`, `app/sispag/components/` e `lib/sispag.ts`, e anexar em `_shared-metrics.md` na tabela de gates. Bônus: subir o `coverageThreshold` do `domain/service/` para o **medido menos 2 pontos** (ratchet), aplicando o padrão que o frontend `jest.config.js` já documenta.

- **Resultado Esperado**
  > Cobertura % por diretório do delta anexada nas próximas 3 rodadas de Regis-Review. Ratchet do `coverageThreshold` para `domain/service/` reasentado ~2 pontos abaixo do medido — evita a decoração que o próprio comentário do frontend admite.

- **Tactic alvo**: Executable Assertions (Observe System State)
- **Severidade**: P3
- **Esforço estimado**: XS (<1h — só rodar e recortar)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Rodadas de Regis-Review com cobertura % anexada: 0 → ≥3 nas próximas features
  - `coverageThreshold` do `domain/service/` ratchetado após esta feature: não → sim
- **Risco de não fazer**: nenhum imediato; o gate binário CI já protege. O custo é só perder a chance de ver o número real e travar regressão pequena antes que ela vire grande.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo**: avaliei o delta de `sispag-reter-titulo-lote` — a nova tabela `titulo_retencao_formacao` (migration 0062), o `RetencaoFormacaoRepository`, os métodos novos do `LotePagamentoService` (`retirarDoLote`, `liberarRetencao`) e os pontos onde `removerTitulo` e `incluirTitulo` foram estendidos, mais as duas rotas admin (`POST retirar-do-lote`, `DELETE retencao`) e a UI (dialog + badge + integração no `page.tsx`). A ausência de `infra/` neste repo torna as métricas Lambda/Terraform da missão genérica não medíveis; troquei-as por métricas Postgres/Express reais.
- **Nota sobre `fast-check`**: a missão pediu para medir property-based testing. Confirmei que o repo **não tem** `fast-check` como dependência (checado em ambos `package.json`); é ruído da missão genérica. Não gerei card por isso.
- **Nota sobre TDDGuide**: o CLAUDE.md do repo não referencia um `TDDGuide` explícito — o TDD é orquestrado pelo `AutoLoopRunner` (green criteria #3). Não é gap.
- **Cross-QA**:
  - **F-testability-2 converge com F-deployability-1** (`docs/regis-review/.../deployability.md:63-81`) — mesmo card em ambos: adicionar `tituloRetencaoFormacao.integration.test.ts` sob o job `backend-sql`. O consolidator deve deduplicar em um só, atribuído ao dono do backend, com ambos os QAs marcados como beneficiários.
  - **F-testability-1** (dialog sem teste) tem overlap com **Modifiability**: um dialog stateful sem teste é ativo caro de refatorar. Se `qa-modifiability` desta rodada tiver finding sobre o tamanho do `page.tsx` (1.229 LOC), o consolidator pode empacotar junto.
  - **F-testability-5** (sync constants ↔ CHECK) tem overlap com **Integrability**: constantes de domínio que espelham enums no schema são um contrato interno; um teste de guarda é a versão simplificada de "contract test" que a missão cita.
- **Nada rotulado P0**: o delta tem 3.193 linhas de teste (razão 0,67 sobre 4.770 LOC de fonte novo), cobrindo 100% das transições da máquina de retenção (9/9), e todas as invariantes I2–I9 do ADR-0050 têm asserção direta. Os gaps são reais mas laterais: componentes UI (P2, precedente já existe no repo) e integration test da migration (P2, converge com deployability). O único ponto que a arquitetura de teste **não observa** hoje — comportamento real do Postgres — é o mesmo já capturado pela deployability nesta rodada.
- **Score justificado**: 7,9. Base 8,5 pelo volume e alinhamento (constructor-injection, transições completas, log-non-leak testado). −0,4 pelos 3 componentes UI novos sem teste apesar do precedente no mesmo diretório. −0,2 pela ausência de integration test para o repositório novo. +0,0 pela dívida pré-existente (não é regressão desta feature).
