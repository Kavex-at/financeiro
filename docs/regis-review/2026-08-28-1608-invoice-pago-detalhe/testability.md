---
qa: Testability
qa_slug: testability
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-testability
generated_at: 2026-08-28T13:16:38-03:00
scope: backend
score: 6
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (Simone) reporta em 2026-08-25 que invoices já liquidadas aparecem na aba "Invoices em aberto"; a mesma classe de defeito (`isPago` da lista vs. detalhe) já havia sido corrigida no lado ADIANTAMENTO em 01b99bf (2026-06-18) e na busca da alocação em df90fa6 (2026-06-21) | Ingestão universal de INVOICE (`634eef0`, 2026-06-24) foi construída DEPOIS do fix do Gate 3 e herdou o mesmo padrão (`raw.pago` = false, derivado da row do `com298/list` que devolve `mnyTitAberto: null` em 1146/1146 casos) SEM teste de regressão | `hidratarInvoiceNegociada` em `EleicaoPermutasService.ts`; `ConexosTitulosClient.listTitulosAPagar`; mocks hand-typed em `EleicaoPermutasService.test.ts` e `ConexosSubClients.test.ts` | Suíte verde (109/109, 1484/1484) mas WHERE `NOT pago` no banco vira no-op — ~75% da aba é lixo | Suíte deveria falhar assim que a INGESTÃO de INVOICE nasce com o padrão inseguro; o mock precisa reproduzir o payload real do ERP (`mnyTitAberto: null`) e o fluxo precisa ter um contract test que amarra as chaves lidas ao que o wire devolve | **62 dias latentes** entre 2026-06-24 (introdução) e 2026-08-25 (report); **0 fixtures capturados** do wire de Permutas no repo (vs. 16 no SISPAG); teste de regressão pós-fix cobre **5 dos 5 ramos observáveis via serviço** de `derivarPagoDosTitulos` (empty-list não coberto) |

> "Bug de classe conhecida escapou 62 dias porque os mocks do lado invoice foram digitados otimistas (`pago: false` sem `mnyTitAberto: null`) — o teste de regressão do Gate 3 (adiantamento) na linha 515 nunca foi generalizado para invoice. A aba mostrava TODAS as finalizadas da filial 2 (1146), analista via ~75% de lixo. Tempo médio para detectar (MTTD) da classe: mais que a janela do sprint, portanto detecção só vem do usuário. Alvo: ≤ 1 dia via contract test com fixture capturada."

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Suíte backend (delta pós-fix) | 109 suites, 1484 testes, 100% verdes | 100% verde e falha imediata em qualquer regressão da classe | ✅ | `cd src/backend && npm test -- --silent` |
| Testes novos no delta (cobertura da correção) | 8 (6 no `EleicaoPermutasService.test.ts` + 2 no `ConexosSubClients.test.ts`) | ≥ 1 por ramo observável de `derivarPagoDosTitulos` + 1 mapeamento no client | ✅ | `git diff 617ca3b..48abd7b --stat` |
| Ramos de `derivarPagoDosTitulos` cobertos por teste (via serviço) | 5 de 6 — face==pago, face>pago, resíduo centavos, multi-título, título sem `titMnyTotPago`, com308 exceção; **`titulos.length === 0` NÃO exercitado** | 6/6 | ⚠️ | `grep derivarPagoDosTitulos src/backend --include="*.test.ts"` (0 usos diretos; só via `EleicaoPermutasService`) |
| Testes unitários DIRETOS da função pura `derivarPagoDosTitulos` (exportada, custo zero) | 0 | ≥ 6 (um por ramo, sem construir o service inteiro) | ❌ | `grep -rn "derivarPagoDosTitulos(" src/backend --include="*.test.ts"` |
| Fixtures capturadas do wire real em `domain/interface/permutas/__fixtures__/` | **0** | ≥ 8 (com298/list INVOICE, com298/list PROFORMA, com308/list, com298/{doc} detalhe, com297 baixas, com010 aging — os artefatos que a ingestão lê) | ❌ | `ls src/backend/domain/interface/permutas/__fixtures__ 2>/dev/null; echo $?` → exit 2 (dir ausente) |
| Fixtures capturadas em `sispag/__fixtures__/` (baseline do padrão) | 16 JSON + 1 `contrato.test.ts` | — | ✅ | `ls src/backend/domain/interface/sispag/__fixtures__ \| wc -l` |
| Fixtures capturadas em `recebimentos/__fixtures__/` | 4 (.fixture.ts) | — | ✅ | `ls src/backend/domain/interface/recebimentos/__fixtures__` |
| Mocks hand-typed (`mockResolvedValue`/`mockReturnValue`/`mockRejectedValue`) em `domain/service/permutas/*.test.ts` | 269 em 11 arquivos | Cada mock que representa um payload do Conexos deveria hidratar-se do fixture capturado (contract-testable) | ⚠️ | `grep -c "mockResolvedValue\|mockReturnValue\|mockRejectedValue" src/backend/domain/service/permutas/*.test.ts` |
| Contract test amarrando fixtures ao consumo real | 1 (`src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts`) | ≥ 2 (adicionar equivalente em `permutas/`) | ⚠️ | `ls src/backend/domain/interface/*/__fixtures__/contrato.test.ts` |
| Script `capture-fixtures-*` para Permutas | **0** | 1 (`jobs/capture-fixtures-permutas.ts`, análogo ao SISPAG) | ❌ | `ls src/backend/jobs/capture-fixtures-*` → só `sispag` |
| Validadores ao vivo (`validate-*.ts` em `jobs/`) — gates manuais que dependem de credencial PRD | 6 (`validate-conciliacao-retorno-v1`, `validate-extrato-client`, `validate-fin015-import`, `validate-fin015-remessa`, `validate-fin015-tools`, `validate-fin052-tools`, `validate-invoice-pago-detalhe-v1`, `validate-retomada-remessa-v1`) — não rodam em CI, nem existe `npm run validate:*` no `package.json` | Todos migrados para `.integration.test.ts` opt-in via flag env (`PROBE_ALLOW_PRD=1` continua exigido); registro do último run em `docs/regis-review/*/artefatos/` | ⚠️ | `ls src/backend/jobs/validate-*.ts`; `grep -n validate: src/backend/package.json` (vazio) |
| Delta que exercita o `catch` do `hidratarInvoiceNegociada` (com308 fora do ar → piso conservador `pago:false`) | 1 (caso "com308 fora do ar") | ≥ 1 | ✅ | `EleicaoPermutasService.test.ts:1046-1053` |
| `render.yaml` (novo cron `financeiro-ingest-permutas`, `schedule: '0 9 * * *'` UTC = 06:00 SP) — lint/validação | **0** no CI | 1 step (`render blueprint validate` ou JSON-schema check) em `.github/workflows/ci.yml` | ❌ | `grep -rn "render\.yaml\|yamllint\|blueprint" .github/` (vazio) |
| Cobertura configurada (`src/backend/jest.config.cjs`) | lines 72% / branches 54% / functions 78% (global); `./domain/service/` lines 88% / branches 60% | Aumentar branches globais para ≥ 70% assim que Permutas tiver ramo empty-list coberto | ⚠️ | `sed -n '30,50p' src/backend/jest.config.cjs` |
| Teste top-10 por LOC (backend) — `EleicaoPermutasService.test.ts` | 1063 LOC (3º maior) para um service de 950 LOC | Quebrar em subserviços coesos quando ultrapassar 1000 LOC | ⚠️ | `find src/backend -name '*.test.ts' -exec wc -l {} \; \| sort -rn \| head` |
| Delta latente entre introdução do padrão inseguro (`634eef0`, 2026-06-24) e report da Simone (2026-08-25) | 62 dias | ≤ 1 sprint (7d) via contract test que amarra chave/tipo | ❌ | `ontology/_inbox/invoice-pago-detalhe-tasks.md` |
| Frontend do delta | não tocado | — | N/A | `git diff --stat` |
| `infra/` Terraform | não existe | — | N/A | Bootstrap declara `infra/` inexistente |

⚠️ **Não medível localmente**: coverage numérico por linha em `EleicaoPermutasService.ts` (branches específicos) — `--quick` proíbe rodar `npm test -- --coverage` completo (~90s adicional). Cobertura por ramo foi contada por leitura do teste (5/6 ramos observáveis via serviço). Recomendação: rodar `npm test -- --coverage --testPathPattern EleicaoPermutasService` no próximo `--full`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `derivarPagoDosTitulos` foi exportada como função pura (aceita `ReadonlyArray<{valorBrl?; valorPago?}>`) — o validador ao vivo importa a MESMA função da produção em vez de reimplementar a regra | ✅ presente | `EleicaoPermutasService.ts:103`; `validate-invoice-pago-detalhe-v1.ts:7,69` |
| Record/Playback (Recordable Test Cases) | Existe no SISPAG (`jobs/capture-fixtures-sispag.ts` + 16 fixtures redigidas + `contrato.test.ts`); **ausente em Permutas** — os 269 `mockResolvedValue` em `domain/service/permutas/*.test.ts` são shapes hand-typed pelo autor do código, o que permitiu que 1146/1146 INVOICEs com `mnyTitAberto: null` passassem despercebidas | ❌ ausente (na frente afetada pelo delta) | `ls src/backend/jobs/capture-fixtures-*` (só sispag); `ls src/backend/domain/interface/permutas/__fixtures__` (exit 2) |
| Sandbox | Jest com mocks in-process para unidade; `.integration.test.ts` opt-in para PG + Conexos HML/PRD; `validate-*.ts` em `jobs/` com gate `PROBE_ALLOW_PRD=1` bloqueando PRD acidental | ⚠️ parcial | `probe-invoice-pago.ts:29-33`; `validate-invoice-pago-detalhe-v1.ts:29-32` |
| Executable Assertions | 6 novos `expect` no `EleicaoPermutasService.test.ts` afirmam com valores REAIS do wire (doc 14042, face/pago 2032384.41, taxa 5.2647) — não invenções; ground-truth validator (`validate-invoice-pago-detalhe-v1.ts`) exige **0 divergências** contra `getDetalheTitulos`, sem epsilon | ✅ presente | `EleicaoPermutasService.test.ts:989-1063`; `validate-invoice-pago-detalhe-v1.ts:73-97` |
| Abstract Data Sources | Cliente Conexos é @injectable e mockado por construtor (bem); porém a FORMA dos dados que ele devolve é fabricada pelo autor do teste, não abstraída de payload real → o "abstract" é só de origem (in-memory), não de shape | ⚠️ parcial | `EleicaoPermutasService.test.ts:947-1063` |
| Limit Structural Complexity | `EleicaoPermutasService.ts` = 950 LOC / teste = 1063 LOC (3º maior teste do backend) — sinal de service inchado; a extração de `derivarPagoDosTitulos` como função pura foi um bom começo mas o resto (`hidratarInvoiceNegociada`, `computeCandidatas`) permanece dentro da classe | ⚠️ parcial | `wc -l src/backend/domain/service/permutas/EleicaoPermutasService.ts src/backend/domain/service/permutas/EleicaoPermutasService.test.ts` |
| Limit Non-Determinism | Testes do delta são determinísticos (não usam `Date.now`, `Math.random`, network, timers); `validate-invoice-pago-detalhe-v1.ts` depende do estado LIVE do ERP → não-determinístico por design (é validação online) e por isso precisa ser opt-in, não CI | ✅ presente (unit); ⚠️ parcial (validador manual) | `validate-invoice-pago-detalhe-v1.ts:47-97` |

## 4. Findings (achados)

### F-testability-1: Fixtures hand-typed permitiram que a mesma classe de defeito reincidisse 62 dias após ser corrigida em outro caminho

- **Severidade**: P0
- **Tactic violada**: Record/Playback (Recordable Test Cases) + Abstract Data Sources
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts:947-1063` (novo); `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts:515-620` (fix anterior de 2026-06-18); `src/backend/domain/interface/permutas/__fixtures__/` (**inexistente**)
- **Evidência (objetiva)**:
  ```
  # 11 arquivos de teste no domínio Permutas, 269 mocks hand-typed
  $ grep -c "mockResolvedValue\|mockReturnValue\|mockRejectedValue" src/backend/domain/service/permutas/*.test.ts
  ...EleicaoPermutasService.test.ts:72
  ...ReconciliacaoPermutaService.test.ts:59
  ...BorderoGestaoService.test.ts:57
  (soma 11 arquivos = 269)

  # Zero fixture capturada em Permutas — vs. 16 em SISPAG e 4 em Recebimentos
  $ ls src/backend/domain/interface/permutas/__fixtures__
  ls: cannot access '...': No such file or directory   (exit 2)

  $ ls src/backend/domain/interface/sispag/__fixtures__ | wc -l
  17    (16 JSON + contrato.test.ts)

  # O padrão sistêmico existe e está documentado no repo:
  src/backend/jobs/capture-fixtures-sispag.ts (255 LOC, com redação de PII)
  src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts (80+ LOC)
  ```
  A ordem cronológica que caracteriza o falso-negativo:
  1. 2026-06-18 (`01b99bf`) — regressão do Gate 3 corrigida no ADIANTAMENTO; teste em `EleicaoPermutasService.test.ts:515` "Gate 3 (TOTALMENTE PAGO) hydrated from the DETAIL, not the list row" fixou o padrão para adiantamento.
  2. 2026-06-24 (`634eef0`) — ingestão universal de INVOICE (ADR-0014) foi construída SEM aplicar o mesmo tratamento; os mocks novos usaram `pago: false` sem `mnyTitAberto: null`, o que não reproduz o wire real.
  3. 2026-08-25 — Simone reporta "invoices liquidadas na aba em aberto".
  4. 2026-08-28 — sonda `probe-invoice-pago` mede `mnyTitAberto: null em 1146/1146 INVOICEs da filial 2`.
- **Impacto técnico**: qualquer feature que dependa de campo cujo shape difere do wire real fica "verde e quebrada" — o mesmo defeito pode reincidir em qualquer novo caminho que use `listInvoicesFinalizadas`, `listTitulosAPagar` ou irmãos.
- **Impacto de negócio**: 62 dias com a aba "Invoices em aberto" mostrando ~75% de lixo (1146 invoices finalizadas na filial 2 exibidas como pendentes); analista perde confiança na tela e passa a validar cada linha manualmente no ERP, anulando o ganho da automação.
- **Métrica de baseline**: 62 dias entre introdução (2026-06-24) e detecção pelo usuário (2026-08-25); 0 fixture capturado para Permutas; 269 mocks hand-typed nos testes de service da mesma frente.

### F-testability-2: Ramo `titulos.length === 0` de `derivarPagoDosTitulos` não é exercitado

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (cobertura de ramo)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:103-116` (função); `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts:988-1063` (6 casos, nenhum com lista vazia)
- **Evidência (objetiva)**:
  ```typescript
  // EleicaoPermutasService.ts:107 — ramo NÃO coberto:
  if (titulos.length === 0) return undefined;
  ```
  Nenhum `listTitulosAPagar.mockResolvedValue([])` em testes de `EleicaoPermutasService`. O bug real ("com308 responde com sucesso, mas devolve lista vazia") é semanticamente distinto tanto do `catch` (com308 lançou) quanto do "título sem `titMnyTotPago`" — os três terminam em `pago:false`, mas por razões diferentes. Se um dia a semântica divergir (ex.: `undefined` distinto para "sem títulos" vs "com títulos incompletos"), o teste continua verde.
- **Impacto técnico**: a função exportada é a superfície do validador ao vivo (`validate-invoice-pago-detalhe-v1.ts:7`) — cada ramo dela é potencialmente auditado contra PRD, então o custo de um teste direto é baixo e o valor é alto.
- **Impacto de negócio**: um ramo sem teste em código que decide "esta invoice deve aparecer para a analista?" é um ponto cego. Se `listTitulosAPagar` passar a devolver `[]` por qualquer motivo (permissão, filial nova, docCod inválido), toda invoice cai no piso conservador (`pago:false`) sem que o teste sinalize — a aba enche de novo, o mesmo sintoma que este PR corrige.
- **Métrica de baseline**: 5 dos 6 ramos observáveis via serviço testados; 0 unit tests diretos da função pura (que é exportada e importada por 2 chamadores).

### F-testability-3: Validador ao vivo é um gate manual que vai apodrecer

- **Severidade**: P1
- **Tactic violada**: Sandbox (falta de sandbox executável em CI) + Recordable Test Cases (nenhuma fixture congelada substitui o run PRD)
- **Localização**: `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts` (novo, 110 LOC); `src/backend/jobs/validate-conciliacao-retorno-v1.ts`; `src/backend/jobs/validate-extrato-client.ts`; `src/backend/jobs/validate-fin015-import.ts`; `src/backend/jobs/validate-fin015-remessa.ts`; `src/backend/jobs/validate-fin015-tools.ts`; `src/backend/jobs/validate-fin052-tools.ts`; `src/backend/jobs/validate-retomada-remessa-v1.ts`
- **Evidência (objetiva)**:
  ```
  $ grep -n "validate:" src/backend/package.json
  (vazio — nenhum npm script; a única forma de rodar é lembrar do comando exato do header)

  $ grep -rn "validate-" .github/workflows/
  (vazio — CI não executa nem NUNCA vai executar; requer PROBE_ALLOW_PRD e credencial ERP)
  ```
  O validador exige `PROBE_ALLOW_PRD=1` + `CONEXOS_BASE_URL`/`USERNAME`/`PASSWORD` — legítimo (ninguém quer bater PRD sem intenção), mas isso significa que ele NUNCA é executado em CI e que apodrece silenciosamente se `listTitulosAPagar` mudar a assinatura, se a função `derivarPagoDosTitulos` for renomeada, ou se `getDetalheTitulos` for retirado. **Não há promoção do script para `.integration.test.ts` opt-in** — o padrão que o resto do repo já usa (`recebimentos.probe.homologacao.integration.test.ts`, `recebimentos.e2e.hmlWrite.integration.test.ts`, etc., 15+ arquivos `.integration.test.ts` em `src/backend/routes/`).
- **Impacto técnico**: 8 validadores no repo, 0 em CI, 0 no `package.json`, 0 registro do último run bem-sucedido. A "certificação 30/30 concordam" documentada no header do fix é uma medição de um dia; ninguém sabe se ainda vale.
- **Impacto de negócio**: gate manual sem cadência = confiança falsa. O time acredita que "está validado", mas o próximo commit pode ter quebrado a fórmula sem que ninguém saiba.
- **Métrica de baseline**: 8 arquivos `validate-*.ts`; 0 promovidos a `.integration.test.ts`; 0 npm scripts; 0 execuções agendadas.

### F-testability-4: `render.yaml` sem validação — novo cron `0 9 * * *` UTC estreia sem lint

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (deploy-time asserts) + Limit Non-Determinism (erro tipográfico só se descobre no dia do deploy)
- **Localização**: `render.yaml:80-133` (novo bloco cron); `.github/workflows/ci.yml` (sem step de validação de blueprint)
- **Evidência (objetiva)**:
  ```yaml
  # render.yaml:98-101 — cron novo:
  - type: cron
    name: financeiro-ingest-permutas
    ...
    schedule: '0 9 * * *'     # UTC → 06:00 SP; comentário no diff diz isso
    startCommand: npm run job:ingest-permutas
  ```
  ```
  $ grep -rn "yamllint\|yaml-lint\|render\.yaml\|blueprint" .github/
  (vazio)
  ```
  O comentário do diff registra: "`schedule` do Render é UTC. `0 9 * * *` UTC = 06:00 em America/Sao_Paulo (UTC-3)". Correto, mas frágil — DST vira uma semana no meio do ano em algum tenant se a política mudar; erro tipográfico (`0 09 * * *` vs `09 * * * *`) só é pego pelo runtime do Render. Este é o primeiro cron declarado no blueprint, então a rota "deploy quebra, alguém repara" ainda não foi treinada.
- **Impacto técnico**: nenhum contra-teste local; a única defesa é o log do próximo deploy. Combina mal com "a ingestão só acontece quando a analista clica" que existiu por 2 meses até este PR — se o cron nascer errado, a mesma situação de "aba desatualizada" pode voltar.
- **Impacto de negócio**: o cron é a garantia de que o `pago` corrigido é recalculado diariamente. Se ele nunca subir por erro de sintaxe no blueprint, a Simone volta a ver invoices liquidadas na aba, e o fix deste PR fica pela metade sem ninguém perceber.
- **Métrica de baseline**: 1 novo cron no blueprint; 0 gates de validação no CI (`.github/workflows/ci.yml` só roda `npm audit`, `typecheck`, `lint`, `test`, `build` — nada sobre `render.yaml`).

### F-testability-5: `EleicaoPermutasService` cresceu a 950 LOC / teste a 1063 LOC — 3º maior teste do backend

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts` (950 LOC); `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts` (1063 LOC)
- **Evidência (objetiva)**:
  ```
  $ find src/backend -name '*.test.ts' -exec wc -l {} \; | sort -rn | head -3
  2329  RecebimentoNumerarioService.test.ts
  1689  ConexosSubClients.test.ts
  1063  EleicaoPermutasService.test.ts   ← 3º maior
  ```
  A extração de `derivarPagoDosTitulos` como função pura foi o primeiro passo certo; `hidratarInvoiceNegociada`, `computeCandidatas` e `fetchInvoicesBatched` seguem métodos privados de um service já grande. Cada bloco `describe` do teste hoje precisa recompor todo o mundo (`buildConexos`, `buildRepo`, `realServices`) só para exercitar um comportamento — atrito que empurra o autor a repetir o padrão hand-typed em vez de escrever um teste unitário focado.
- **Impacto técnico**: refatorar `EleicaoPermutasService` custa mais que devia porque cada mudança propaga pela árvore de mocks; e a barreira para "adicionar 1 teste" aumenta linearmente com o tamanho do arquivo → o próximo defeito da classe vai também ser reportado antes de testado.
- **Impacto de negócio**: velocidade de reação a defeitos degrada com o tamanho do service; TTR para o próximo bug desta frente será maior que os 3h deste.
- **Métrica de baseline**: `EleicaoPermutasService.test.ts` = 1063 LOC (3º maior); `EleicaoPermutasService.ts` = 950 LOC; 269 mocks no domínio Permutas.

### F-testability-6: A cadeia probe → validate → contract está incompleta — falta o elo de fixture congelada

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/jobs/probe-invoice-pago.ts` (novo, 255 LOC, discovery ao vivo); `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts` (novo, 110 LOC, ground-truth ao vivo); `src/backend/domain/interface/permutas/__fixtures__/` (**ainda inexistente após o PR**)
- **Evidência (objetiva)**: o padrão saudável já demonstrado no SISPAG é probe (`probe-*`) → capture (`capture-fixtures-*.ts` com redação de PII) → contract test (`contrato.test.ts`) → uso nos testes de service. Neste PR, o probe e o validate ao vivo foram feitos (bem), mas o `capture-fixtures-permutas.ts` e o `contrato.test.ts` de permutas **não existem**. O payload real que a sonda descobriu (`mnyTitAberto: null em 1146/1146`, doc 14042 com face/pago 2032384.41) foi transcrito para os mocks à mão em `EleicaoPermutasService.test.ts:989-1063` — cópia manual da evidência que uma fixture capturada preservaria automaticamente.
- **Impacto técnico**: a próxima mudança do schema do ERP não quebra teste — quebra a analista. O ciclo probe→validate→corrigir se repete, quando um contract test com fixture congelada teria o defeito visível no primeiro `npm test` após a mudança do ERP.
- **Impacto de negócio**: tempo médio para detectar mudança de contrato do ERP continua sendo "quando alguém reclama".
- **Métrica de baseline**: 0 fixture de Permutas capturada no repo; 1 job de captura (só SISPAG); 1 contract test no repo (SISPAG); 0 no domínio afetado por este PR.

## 5. Cards Kanban

### [testability-1] Capturar fixtures reais do wire de Permutas e adicionar contract test

- **Problema**
  > O bug `invoice-pago-detalhe` sobreviveu 62 dias (entre a introdução em `634eef0` em 2026-06-24 e o report da Simone em 2026-08-25) porque os 269 mocks hand-typed nos 11 testes de `domain/service/permutas/*.test.ts` sempre desenharam INVOICE com campos preenchidos, quando o `com298/list` real devolve `mnyTitAberto: null` em 1146/1146 casos. O mesmo tipo de fixture congelada que existe em `sispag/__fixtures__/` (16 JSON + `contrato.test.ts`) e em `recebimentos/__fixtures__/` (4 arquivos) **não existe para Permutas**.

- **Melhoria Proposta**
  > Portar o padrão do SISPAG para Permutas: (a) `src/backend/jobs/capture-fixtures-permutas.ts` (análogo estrito ao `capture-fixtures-sispag.ts`, com redação por tipo, ESTRITAMENTE read-only sobre `com298/list` tpdCod=127/128, `com308/.../list/{docCod}`, `getDetalheTitulos`, e o que mais a ingestão lê); (b) `src/backend/domain/interface/permutas/__fixtures__/` com JSON datados + `contrato.test.ts` amarrando os campos consumidos pelo código (`EleicaoPermutasService`, `ConexosTitulosClient`, `ConexosFinanceiroClient`). Tactic: **Record/Playback (Recordable Test Cases)** + **Abstract Data Sources**.

- **Resultado Esperado**
  > Fixtures capturados em `permutas/__fixtures__/` 0 → ≥ 8; `contrato.test.ts` em Permutas 0 → 1; próximo defeito de contrato do ERP detectado por `npm test`, não pela analista. MTTD de mudança de schema Conexos: >30d → ≤1d.

- **Tactic alvo**: Record/Playback, Abstract Data Sources
- **Severidade**: P0
- **Esforço estimado**: M (2-5d) — o job `capture-fixtures-sispag.ts` (255 LOC) é template direto; o esforço real é escolher os endpoints e escrever o contract test.
- **Findings relacionados**: F-testability-1, F-testability-6
- **Métricas de sucesso**:
  - Fixtures em `src/backend/domain/interface/permutas/__fixtures__/`: 0 → ≥ 8
  - Contract test em `permutas/__fixtures__/contrato.test.ts`: 0 → 1 (com ≥ 5 shapes cobertos)
  - Mocks hand-typed em `domain/service/permutas/*.test.ts` substituídos por hidratação a partir de fixture: 0 → ≥ 20% (migração progressiva)
- **Risco de não fazer**: mais uma versão do mesmo bug reincide em 3-6 meses num terceiro caminho (permutas N:M, alocação parcial, etc.); ciclo 2026-06-18 → 2026-06-21 → 2026-06-24 → 2026-08-25 se repete.
- **Dependências**: nenhuma.

### [testability-2] Cobrir `derivarPagoDosTitulos` com unit tests diretos da função pura

- **Problema**
  > `derivarPagoDosTitulos` foi corretamente exportada como função pura (bom seam), mas todos os 6 casos novos passam pelo service completo. O ramo `titulos.length === 0` (com308 respondeu OK mas devolveu `[]`) **não é exercitado** — o teste "com308 fora do ar" cobre o `catch`, e "título sem `titMnyTotPago`" cobre o `some(...) undefined`, mas o caminho "lista vazia" fica sem asserção.

- **Melhoria Proposta**
  > Adicionar `src/backend/domain/service/permutas/derivarPagoDosTitulos.test.ts` (ou bloco dedicado) chamando a função diretamente. 6 casos: lista vazia; face+pago ambos presentes com face==pago; face>pago; múltiplos títulos; título sem `valorBrl`; título sem `valorPago`. Custo por caso ≈ 4 linhas (sem `buildConexos`/`buildRepo`). Tactic: **Executable Assertions**.

- **Resultado Esperado**
  > Ramos de `derivarPagoDosTitulos` cobertos: 5/6 (via service) → 6/6 (diretos, sem construir service). Barreira para adicionar novo caso: 100+ LOC de setup → 4 LOC.

- **Tactic alvo**: Executable Assertions, Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Cobertura de ramo em `derivarPagoDosTitulos`: 5/6 → 6/6
  - Unit tests DIRETOS da função pura: 0 → ≥ 6
- **Risco de não fazer**: pequeno; mas o custo é trivial e a função é hoje "código público" (importada por 2 chamadores, incluindo um validador que a usa como oráculo em PRD).
- **Dependências**: nenhuma.

### [testability-3] Promover os 8 `validate-*.ts` a `.integration.test.ts` opt-in

- **Problema**
  > 8 validadores ao vivo (`validate-conciliacao-retorno-v1`, `validate-extrato-client`, `validate-fin015-*` x3, `validate-fin052-tools`, `validate-invoice-pago-detalhe-v1`, `validate-retomada-remessa-v1`) rodam apenas via `tsx jobs/…` sob variáveis manuais; não têm npm script, não têm cadência, não são executados no CI, e não têm registro de última execução bem-sucedida. Certificações do tipo "30/30 concordam com o ground truth" valem para o dia da execução — depois disso, apodrecem.

- **Melhoria Proposta**
  > Padrão de promoção: cada validador vira `src/backend/routes/<frente>.groundtruth.integration.test.ts` (ou `src/backend/domain/service/<frente>/<nome>.integration.test.ts`), com `describe.skipIf(!process.env.PROBE_ALLOW_PRD)` no topo — quando a env está ausente, o teste faz `skip` limpo; quando presente, executa o mesmo fluxo do validador atual. Adicionar `npm run test:integration:prd` que roda `jest --testPathPattern integration` com a env setada, e um workflow manual (`workflow_dispatch`) no CI que exige aprovação humana para injetar `CONEXOS_*` do secrets. Tactic: **Sandbox** + **Recordable Test Cases**.

- **Resultado Esperado**
  > Validadores executáveis via Jest: 0/8 → 8/8; registro do último run bem-sucedido: 0 → 1 por validador (via `docs/regis-review/*/artefatos/`); assinatura `derivarPagoDosTitulos` (e irmãs) protegida por typecheck do teste — se alguém renomear, o `.integration.test.ts` quebra a build local sem precisar de credencial PRD.

- **Tactic alvo**: Sandbox, Recordable Test Cases
- **Severidade**: P1
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - `validate-*.ts` promovidos a `.integration.test.ts`: 0/8 → 8/8
  - `package.json` scripts para rodar suite integração: 0 → 1 (`test:integration:prd`)
  - Job `workflow_dispatch` no `.github/workflows/`: 0 → 1
- **Risco de não fazer**: gates manuais degradam para "ninguém sabe se ainda funciona"; a certificação "30/30 concordam" perde validade em silêncio.
- **Dependências**: nenhuma.

### [testability-4] Validar `render.yaml` no CI antes que o cron novo apareça em produção

- **Problema**
  > O primeiro cron declarado no `render.yaml` (`financeiro-ingest-permutas`, `schedule: '0 9 * * *'` UTC) estreia sem NENHUM lint ou validação do blueprint. Erro tipográfico no `schedule`, `startCommand` sem npm script correspondente, ou env var faltando só é pego no dia do deploy — e o cron é a garantia de que o `pago` corrigido é recalculado diariamente. Se ele nascer errado, a Simone volta a ver invoices liquidadas na aba, e este PR fica pela metade.

- **Melhoria Proposta**
  > Adicionar step no `.github/workflows/ci.yml`: (a) validação sintática YAML (`yamllint render.yaml`); (b) validação semântica do blueprint contra o JSON Schema oficial do Render (ou, na ausência, `node -e` que carrega e faz `assert` sobre `services[].schedule`, `services[].startCommand` presente em `package.json`, `envVars[].sync === false` só para segredos); (c) `render blueprint launch --dry-run` se o CLI aceitar. Tactic: **Executable Assertions** aplicada ao artefato de deploy.

- **Resultado Esperado**
  > Erros de blueprint pegos em CI antes do merge: 0 → ≥ os detectáveis por schema (schedule inválido, script inexistente, env var não referenciada). Deploy do cron `financeiro-ingest-permutas` protegido; sintoma "aba de invoices desatualizada porque o cron nunca subiu" bloqueado antes de virar defeito.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Step de validação de `render.yaml` em CI: 0 → 1
  - Referências de `startCommand` que existem no `package.json`: hoje sem check → 100% verificadas
- **Risco de não fazer**: cron não sobe silenciosamente; a garantia principal do fix (recalcular `pago` diariamente) deixa de existir sem que ninguém saiba. Cross-QA: **Deployability** (gate before deploy).
- **Dependências**: nenhuma.

### [testability-5] Quebrar `EleicaoPermutasService` (950 LOC) em subserviços coesos

- **Problema**
  > `EleicaoPermutasService.ts` chegou a 950 LOC e seu teste a 1063 LOC (3º maior teste do backend). Cada `describe` do teste precisa recompor todo o container (`buildConexos`, `buildRepo`, `realServices`, `buildEleicao`) para exercitar UM comportamento. Esse atrito empurra o autor a copiar-e-colar o padrão hand-typed em vez de escrever um teste focado — o mesmo padrão que deixou o bug `invoice-pago-detalhe` passar.

- **Melhoria Proposta**
  > Extrair `hidratarInvoiceNegociada`, `computeCandidatas` (fatia de invoice) e `fetchInvoicesBatched` para services próprios (`InvoiceHidratacaoService`, `InvoiceCandidataService`, `InvoiceFetchService`) ou funções puras exportadas, seguindo o precedente de `derivarPagoDosTitulos` deste PR. Cada extração deve vir com teste focado. Tactic: **Limit Structural Complexity**.

- **Resultado Esperado**
  > `EleicaoPermutasService.ts`: 950 LOC → ≤ 500 LOC. Teste principal: 1063 LOC → ≤ 500 LOC. Novos testes focados nos serviços extraídos, cada um com < 300 LOC. Barreira para "adicionar 1 teste": alta → baixa.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: L (1-2 sem)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - LOC `EleicaoPermutasService.ts`: 950 → ≤ 500
  - LOC teste principal: 1063 → ≤ 500
  - Mocks hand-typed no domínio Permutas: 269 → ≤ 180 (queda proporcional à extração)
- **Risco de não fazer**: velocidade de reação a defeitos degrada; TTR do próximo bug da frente será maior. Cross-QA: **Modifiability**.
- **Dependências**: idealmente após `testability-1` (fixtures capturados) para não repetir hand-typing durante a refatoração.

### [testability-6] Fechar o loop probe → capture → contract → service test

- **Problema**
  > O processo canônico do repo é probe (`probe-*.ts` descobre a realidade) → capture (`capture-fixtures-*.ts` congela) → contract test (`contrato.test.ts` amarra ao consumo) → service test (usa a fixture). Neste PR, o probe foi feito (`probe-invoice-pago.ts`, 255 LOC) e o validador ao vivo foi feito (`validate-invoice-pago-detalhe-v1.ts`), mas os passos "capture" e "contract" foram pulados — os números reais do doc 14042 foram transcritos à mão para os mocks. A evidência que a sonda descobriu não sobrevive ao próximo commit.

- **Melhoria Proposta**
  > Institucionalizar o padrão: quando um probe encontra um payload que refuta uma hipótese (como `mnyTitAberto: null em 1146/1146`), a saída do probe deve ser congelada em `permutas/__fixtures__/YYYY-MM-DD-<endpoint>.json` (via `capture-fixtures-permutas.ts` do card testability-1). Adicionar checklist ao template de PR: "Toda mudança que depende de probe/validate ao vivo tem fixture capturada e contract test?" Tactic: **Recordable Test Cases** aplicada ao ciclo de descoberta.

- **Resultado Esperado**
  > Fixtures capturadas por probe: 0 (Permutas) → ≥ 3 no próximo trimestre; discoveries que sobrevivem ao próximo commit: hoje "só se alguém lembrar" → auditável via `git log domain/interface/permutas/__fixtures__/`.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d — é decisão de processo + adição ao template de PR/regis-review)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Fixtures Permutas com origem em probe: 0 → ≥ 3
  - Checklist no template de PR: ausente → presente
- **Risco de não fazer**: cada probe/validate futuro repete o padrão deste PR (evidência não sobrevive), e a próxima classe de defeito reincide.
- **Dependências**: testability-1.

## 6. Notas do agente

- Escopo `--quick` respeitado: rodei `npm test -- --silent` (109/109 suites, 1484/1484 testes, 39s) mas **não** rodei `--coverage`; cobertura de ramo de `derivarPagoDosTitulos` foi contada por leitura do teste (5/6 ramos observáveis via serviço; empty-list é o gap).
- Cross-QA detectados: **Integrability** (contract tests com fixtures capturadas — mesmo padrão do SISPAG); **Deployability** (validação de `render.yaml` no CI); **Fault-Tolerance** (piso conservador `pago:false` protege quando com308 falha, mas o filtro `WHERE NOT pago` no banco vira no-op — estado inválido silenciado por 62d); **Modifiability** (extração de `derivarPagoDosTitulos` como função pura é o modelo para quebrar o resto do service). Consolidator: sinalize a sobreposição do card testability-1 com o card integrability-1 já existente no repo (nome do card canônico já mencionado no header de `capture-fixtures-sispag.ts`).
- Não foi possível medir o registro de última execução dos 8 `validate-*.ts` — não existe convenção de artefato (proposto no card testability-3).
- O delta em si é **acima da média** em disciplina de teste (números reais do wire, função pura extraída, ground-truth validator, 6 casos enumerados); a nota 6 reflete a coexistência com o padrão sistêmico ("hand-typed mocks para Permutas") que fez o defeito passar despercebido por 62 dias.
