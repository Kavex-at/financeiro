---
qa: Testability
qa_slug: testability
run_id: 2026-09-29-0104
agent: qa-testability
generated_at: 2026-09-28T23:30:00-03:00
scope: backend
score: 7.5
findings_count: 6
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Muda a regra de resolução de destino TED/PIX ou o layout CNAB do segmento B | `DestinoPagamentoResolver`, `RemessaService`, `RemessaCnabValidator`, `LotePagamentoRepository` | Pré-merge, CI, sem HML do banco (hipóteses H1, H3–H7 só validáveis em PRD supervisionado) | Testes forçam cada estado (flag ON/OFF, destino manual × ERP, titular divergente) sem rede nem relógio real e falham se o invariante quebrar | 100% das transições de destino cobertas por teste determinístico; regressão detectada em CI em < 5 min; 0 fixtures inventadas passando por "aceitas pelo banco" |

## 2. Métricas observadas

Modo `--quick`: cobertura por linha **não foi reexecutada**. Os números por camada abaixo são razão arquivo-teste/arquivo-fonte, medidos por `find`. A última corrida real (`_shared-metrics.md`) foi 164 suites / 2.570 testes backend, 30 testes SQL e 58 suites / 505 testes frontend, todos verdes.

**Métrica #1 — razão de testes por camada (backend, `src/backend`)**

| Camada | Fonte (.ts) | Testes (.test.ts) | Razão | Alvo | Status |
|---|---|---|---|---|---|
| Total backend | 355 | 180 | 0,51 | ≥ 0,5 | ✅ |
| `domain/service` | 63 | 53 | 0,84 | ≥ 0,5 | ✅ |
| `domain/repository` | 26 | 25 | 0,96 | ≥ 0,5 | ✅ |
| `domain/client` | 22 | 16 | 0,73 | ≥ 0,5 | ✅ |
| `routes` (inclui e2e) | 10 | 27 | 2,7 | ≥ 0,2 | ✅ |
| `jobs` | 68 | 1 | 0,01 | ≥ 0,2 | ❌ (PRE_EXISTING; o probe novo entra nesse balde) |
| Escopo: `service/sispag` | 12 | 11 | 0,92 | ≥ 0,5 | ✅ (o único sem teste é `LotePagamentoApiView`, coberto indiretamente via service/rota) |
| Escopo: `repository/sispag` | 6 | 6 | 1,0 | ≥ 0,5 | ✅ |
| Escopo: `libs/sispag` (novo) | 2 | 2 | 1,0 | ≥ 0,5 | ✅ |

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de linhas por diretório (backend/frontend) | ⚠️ Não medível neste ciclo (`--quick`) | 80% lines / 70% branches em service e repository | ⚠️ | Recomendação: ler o artefato `--coverage` do job de CI |
| Pisos de cobertura no jest (backend) | global 72 lines / 54 branches / 78 functions; `./domain/service/` 88 lines / 60 branches; pisos por arquivo só em `http/*` | ≥ 70% lines nos caminhos críticos | ⚠️ (o piso de branches 60% fica abaixo dos 70% e não há piso por arquivo nos módulos novos de destino) | `src/backend/jest.config.cjs:39-60` |
| Testes de integração com Postgres real | 2 suites / 30 testes (`migrations/*.integration.test.ts`), rodando em job próprio do CI (`test:sql`); a 0066 tem trilha só-inclusão coberta | ≥ 1 por repositório com SQL complexo | ⚠️ (o `LotePagamentoRepository` novo é testado só com pool mockado; o SQL de `destino_manual` é exercitado apenas via migration) | `ci.yml:30-62`, `migrations/0066_sispag_destino_manual.integration.test.ts` |
| Testes novos por unidade do delta | Resolver 19, MaskDestino 10, DestinoManualValidator 14, RemessaCnabValidator 24, routes/sispag 63, InformarDestinoDialog 6 | ≥ 1 `describe` por regra pública | ✅ | `grep -c "it(" …` |
| Paridade flags OFF (byte-idêntico ao main) | Coberta (`describe('flags desligadas = regra do main')`, Resolver:103) | 100% | ✅ | `DestinoPagamentoResolver.test.ts:103` |
| Leituras de tempo sem clock injetável (escopo) | 2 (`SispagPainelService.ts:110`, `IngestaoPagamentosService.ts:166`; ambas `Date.now()`, PRE_EXISTING) | 0 | ⚠️ | `grep "new Date()\|Date.now()"` |
| Sites de aleatoriedade no escopo | 0 | 0 | ✅ | `grep randomUUID\|Math.random` |
| Uso de fake timers nos testes do escopo | 0 arquivos | ≥ 1 onde há leitura de tempo | ⚠️ | `grep useFakeTimers\|setSystemTime` |
| Fixtures de API externa | Existem em `domain/interface/sispag/__fixtures__` (fin005, fin015, fin050, fin064, cmn025, ger015; capturadas por `jobs/capture-fixtures-sispag.ts`). Para TED/PIX: 0 (sem HML) | Presença por cliente e por modalidade | ⚠️ | `find -name '*ixture*'` |
| Maiores arquivos de teste no escopo | `RemessaService.test.ts` 2.057 LOC, `routes/sispag.test.ts` 1.191 LOC | ≤ 500 LOC | ❌ | `find … -exec wc -l` |
| Testes property-based (`fast-check`) no escopo | 0 | ≥ 1 para parsers/validadores | ⚠️ | `grep fast-check` |
| CI executa e bloqueia em testes | Sim (`npm test -- --coverage` em `ci.yml:27` e `:80`, mais `test:sql`) | presente | ✅ | `.github/workflows/ci.yml` |
| Agente TDD | `qa-testability.md` presente; o AutoLoopRunner orquestra TDD | presente | ✅ | `.claude/agents/` |
| Transições de estado do lote testadas | ⚠️ Não medível: a máquina de estados do lote não foi contada transição a transição neste ciclo | 100% | ⚠️ | Recomendação: matriz transição × teste em `ontology/state-machines/` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Flags `SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED` e `SISPAG_PIX_ENABLED` lidas só pelo `EnvironmentProvider`, o que permite forçar cada modo nos testes; `DestinoPagamentoResolver` é uma classe DI isolada; probe read-only para o teste supervisionado | ✅ presente | `DestinoPagamentoResolver.test.ts:77-243`; `jobs/probe-sispag-ted-pix-supervisionado.ts` |
| Recordable Test Cases | Fixtures gravadas para o Conexos (`capture-fixtures-sispag.ts`) e testes de paridade capturados contra o código antigo. Não há gravação de `.REM` TED/PIX aceito pelo banco (nem seria possível sem HML) | ⚠️ parcial | `domain/interface/sispag/__fixtures__/` |
| Sandbox | Sem HML do banco; o Conexos HML é evitado em CI (os `*.integration.test.ts` de `routes/` gravam nele). Postgres real em CI para migrations. O sandbox de fato para TED/PIX é o PRD supervisionado | ⚠️ parcial | `ci.yml:30-36` |
| Executable Assertions | Validação Zod nas bordas (`DestinoManualSchema`), `RemessaCnabValidator` avisa sobre segmento B e forma de lançamento, e há testes afirmando ausência de dado sensível em log, ledger e resposta | ✅ presente | `libs/cnab/RemessaCnabValidator.ts`, `DestinoManualSchema.ts` |
| Abstract Data Sources | Repositories `@injectable` mockados por construtor; `LogService` mockado; pool substituível | ✅ presente | `LotePagamentoService.test.ts:46` |
| Limit Structural Complexity | `RemessaService.gerarRemessaSerializado` com complexidade cognitiva 93 (+2 no delta) e `montarItensImport` 36 (+4); teste de 2.057 LOC | ❌ ausente | `_shared-metrics.md` (lint); `RemessaService.test.ts` |
| Limit Non-Determinism | Sem randomness no escopo, mas há 2 `Date.now()` diretos e nenhum fake timer nos testes do escopo | ⚠️ parcial | `SispagPainelService.ts:110`, `IngestaoPagamentosService.ts:166` |

## 4. Findings

### F-testability-1: nenhum golden de `.REM` TED/PIX validado contra o banco; os testes afirmam a hipótese, não a realidade

- **Classificação**: IN_DELTA
- **Severidade**: P1
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/service/sispag/RemessaService.test.ts`, `src/backend/domain/libs/cnab/RemessaCnabValidator.test.ts`, `domain/interface/sispag/__fixtures__/`
- **Evidência (objetiva)**:
  ```
  Fixtures em __fixtures__/sispag: só respostas Conexos (fin005, fin015, fin050, fin064, cmn025, ger015)
  Nenhum .REM ou retorno TED/PIX gravado; hipóteses H1, H3-H7 "validadas em PRD supervisionado"
  ```
- **Impacto técnico**: os testes de TED/PIX provam consistência interna (o gerador concorda com o validador escrito pela mesma mão). Um erro de layout (posição de campo, forma de lançamento, chave PIX no segmento B) passa verde e só aparece quando o banco rejeita.
- **Impacto de negócio**: os precedentes já registrados são de remessa rejeitada (PG160901.REM em 16/09). Um `.REM` TED/PIX rejeitado em PRD é pagamento parado e retrabalho da Flavia.
- **Métrica de baseline**: 0 de 6 hipóteses do delta (H1, H3–H7) com evidência gravada; 0 goldens TED/PIX contra 2 remessas de conta-corrente aceitas.

### F-testability-2: `RemessaService` concentra complexidade e teste de 2.057 LOC

- **Classificação**: PRE_EXISTING (o delta agravou: complexidade 91→93 e 32→36)
- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts` (`gerarRemessaSerializado`, `montarItensImport`), `RemessaService.test.ts`
- **Evidência (objetiva)**:
  ```
  2057 domain/service/sispag/RemessaService.test.ts   (alvo <= 500)
  gerarRemessaSerializado 91 -> 93 ; montarItensImport 32 -> 36 (Biome, limite 15)
  ```
- **Impacto técnico**: cada combinação nova de flag multiplica os caminhos. O custo de teste por mudança sobe e o setup fica pesado demais para o autor achar o caso certo.
- **Impacto de negócio**: mudanças no envio SISPAG (Frente II) custam mais horas de teste e revisão, e o risco de regressão silenciosa em dinheiro cresce.
- **Métrica de baseline**: teste 2.057 LOC (4,1× o limite); complexidade cognitiva 93 (6,2× o limite de 15).

### F-testability-3: leituras diretas de `Date.now()` sem clock injetável, e nenhum fake timer no escopo

- **Classificação**: PRE_EXISTING
- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `SispagPainelService.ts:110`, `IngestaoPagamentosService.ts:166`
- **Evidência (objetiva)**:
  ```
  domain/service/sispag/SispagPainelService.ts:110:        const now = Date.now();
  domain/service/sispag/IngestaoPagamentosService.ts:166:            const now = Date.now();
  useFakeTimers/setSystemTime em domain/service/sispag e libs: 0 arquivos
  ```
- **Impacto técnico**: qualquer regra de idade, janela ou cutoff que dependa desses pontos só é testável com tolerância ou relógio real (fonte de flake).
- **Impacto de negócio**: risco baixo hoje, mas regras de cutoff SISPAG são sensíveis a horário (lote enviado após o horário do banco).
- **Métrica de baseline**: 2 leituras de tempo não abstraídas; 0 testes com relógio controlado.

### F-testability-4: SQL novo do `LotePagamentoRepository` sem teste de integração próprio

- **Classificação**: IN_DELTA
- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`, `LotePagamentoRepository.test.ts`, `migrations/0066_sispag_destino_manual.integration.test.ts`
- **Evidência (objetiva)**:
  ```
  Integração real (test:sql): 2 suites / 30 testes; a 0066 testa a trilha só-inclusão (UPDATE/DELETE/TRUNCATE recusados)
  O SQL de escrita de destino_manual no repositório roda só contra pool mockado
  ```
- **Impacto técnico**: um erro de nome de coluna, cast ou de parametrização (`$n`) nas queries novas passa verde.
- **Impacto de negócio**: dado de conta/chave PIX gravado errado ou perdido, com a trilha de auditoria (compliance) como vítima.
- **Métrica de baseline**: 0 casos de integração sobre os métodos novos do repositório.

### F-testability-5: pisos de cobertura não protegem os módulos novos e a fronteira de branches está abaixo da meta

- **Classificação**: PRE_EXISTING (o delta adiciona 3 módulos sem piso próprio)
- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jest.config.cjs:39-60`, `src/frontend/jest.config.js`
- **Evidência (objetiva)**:
  ```
  './domain/service/': lines 88, branches 60 ; pisos por arquivo apenas http/*
  coverageThreshold ausente em src/frontend/jest.config.js
  ```
- **Impacto técnico**: `MaskDestino`, `DestinoManualValidator` e `DestinoPagamentoResolver` podem perder ramos sem reprovar o CI, diluídos no bucket global.
- **Impacto de negócio**: o resolver decide se o dinheiro vai para a conta certa; erosão silenciosa nesse arquivo é risco financeiro direto.
- **Métrica de baseline**: 0 pisos por arquivo nos 3 módulos novos; piso de branches 60% contra meta de 70%; piso frontend 0.

### F-testability-6: sem testes property-based nos validadores e mascaradores de dado sensível

- **Classificação**: IN_DELTA
- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/libs/sispag/MaskDestino.ts`, `DestinoManualValidator.ts`
- **Evidência (objetiva)**:
  ```
  fast-check em testes de app/ e lib/ frontend e no backend: 0 arquivos; MaskDestino 10 casos, Validator 14 casos (exemplos fixos)
  ```
- **Impacto técnico**: funções puras com domínio grande de entrada (CPF/CNPJ, chave PIX, conta) são os alvos naturais de propriedade (nunca vaza o valor completo; idempotência da máscara).
- **Impacto de negócio**: um caso de borda que vaze a conta em log é incidente de privacidade.
- **Métrica de baseline**: 0 propriedades; 24 casos por exemplo.

## 5. Cards Kanban

### [testability-1] Gravar goldens de `.REM` TED/PIX após o PRD supervisionado

- **Problema**
  > O delta gera TED/PIX sem nenhum golden aceito pelo banco (0 de 6 hipóteses com evidência gravada). Os testes atuais concordam com o próprio gerador, então um erro de layout só aparece na rejeição em produção.

- **Melhoria Proposta**
  > Depois de cada teste supervisionado (checklist do tasks.md), capturar o `.REM` enviado e o retorno do banco, mascarar dados sensíveis e gravar como fixture (Recordable Test Cases). Adicionar testes golden byte a byte para o TED e o PIX em `RemessaService.test.ts` (ou arquivo à parte) e ligar `RemessaCnabValidator` ao mesmo golden. Manter as flags OFF até o golden existir.

- **Resultado Esperado**
  > Goldens aceitos pelo banco de 0 para ≥ 2 (TED, PIX); hipóteses H1, H3–H7 com evidência gravada de 0/6 para 6/6.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Goldens TED/PIX aceitos pelo banco: 0 → 2
  - Hipóteses com evidência gravada: 0/6 → 6/6
- **Risco de não fazer**: regressão de layout no `.REM` passa verde em CI e só é descoberta com rejeição bancária em PRD.
- **Dependências**: execução do PRD supervisionado (probe `probe-sispag-ted-pix-supervisionado.ts`).

### [testability-2] Extrair fatias de `RemessaService` e quebrar o teste de 2.057 LOC

- **Problema**
  > `gerarRemessaSerializado` tem complexidade cognitiva 93 (+2 no delta) e o teste do arquivo tem 2.057 LOC. Cada flag nova multiplica caminhos, e a suíte fica cara de manter.

- **Melhoria Proposta**
  > Extrair a montagem de itens (`montarItensImport`) e a escolha de forma de lançamento para classes DI menores (Limit Structural Complexity), cada uma com teste próprio; dividir `RemessaService.test.ts` por responsabilidade. Feito de forma proporcional no próximo `/feature-tweak` que tocar o arquivo.

- **Resultado Esperado**
  > Complexidade de `gerarRemessaSerializado` 93 → ≤ 30; maior arquivo de teste do escopo 2.057 → ≤ 800 LOC.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: L
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Complexidade cognitiva de `gerarRemessaSerializado`: 93 → ≤ 30
  - LOC do maior teste do escopo: 2.057 → ≤ 800
- **Risco de não fazer**: a próxima modalidade (ex.: boleto de concessionária) empurra a complexidade acima de 100 e as mudanças passam a exigir revisão manual de todos os caminhos.
- **Dependências**: nenhuma; os testes de paridade (flags OFF = main) protegem a refatoração.

### [testability-3] Introduzir `ClockProvider` injetável nos serviços SISPAG

- **Problema**
  > Existem 2 `Date.now()` diretos (`SispagPainelService.ts:110`, `IngestaoPagamentosService.ts:166`) e nenhum fake timer nos testes do escopo.

- **Melhoria Proposta**
  > Criar `ClockProvider` (`@singleton() @injectable()`) e injetá-lo nesses dois serviços (Limit Non-Determinism); nos testes, usar um clock fixo. Isso cobre o mesmo ponto do card de Modifiability.

- **Resultado Esperado**
  > Leituras de tempo não abstraídas de 2 → 0; testes com relógio controlado de 0 → ≥ 2.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - `Date.now()` direto em service/sispag: 2 → 0
  - Testes com clock injetado: 0 → ≥ 2
- **Risco de não fazer**: a próxima regra de cutoff de horário nasce sem teste determinístico.
- **Dependências**: nenhuma.

### [testability-4] Teste de integração Postgres para o SQL de destino do `LotePagamentoRepository`

- **Problema**
  > As queries novas de `destino_manual` só rodam contra pool mockado (0 casos de integração nos métodos novos), embora o CI já tenha o job `test:sql` com Postgres real.

- **Melhoria Proposta**
  > Adicionar um `LotePagamentoRepository.integration.test.ts` no diretório coberto pelo `test:sql` (Sandbox) cobrindo gravar destino, congelamento após envio, trilha de auditoria e recusa de UPDATE/DELETE.

- **Resultado Esperado**
  > Casos de integração no repositório de 0 → ≥ 6; suites `test:sql` de 2 → 3.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Casos de integração nos métodos novos: 0 → ≥ 6
  - Suites em `test:sql`: 2 → 3
- **Risco de não fazer**: erro de coluna ou cast no SQL novo só aparece em PRD, com destino de pagamento gravado errado.
- **Dependências**: nenhuma (Postgres do CI já existe).

### [testability-5] Pisos de cobertura por arquivo e propriedades nos módulos de destino

- **Problema**
  > Os 3 módulos novos (`MaskDestino`, `DestinoManualValidator`, `DestinoPagamentoResolver`) não têm piso de cobertura próprio, e as funções puras só têm casos por exemplo (24 casos, 0 propriedades).

- **Melhoria Proposta**
  > Medir a cobertura desses arquivos e registrar pisos por arquivo em `jest.config.cjs` (ratchet, como já feito em `http/*`). Adicionar testes `fast-check` para as propriedades "a máscara nunca contém o valor completo" e "o validador é total". Registrar também um piso global no frontend.

- **Resultado Esperado**
  > Pisos por arquivo nos módulos novos de 0 → 3; propriedades de 0 → ≥ 3; piso de branches em `domain/service/` 60% → 70%.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-5, F-testability-6
- **Métricas de sucesso**:
  - Pisos por arquivo nos módulos de destino: 0 → 3
  - Propriedades `fast-check` no escopo: 0 → ≥ 3
- **Risco de não fazer**: os ramos do resolver erodem sem o CI acusar, e dado sensível pode vazar por um caso de borda que os exemplos não cobrem.
- **Dependências**: corrida de cobertura completa (não feita neste ciclo `--quick`).

## 6. Notas do agente

- Escopo: feature `sispag-ted-pix`. O `--quick` impediu uma nova corrida de cobertura; os números por camada são razão de arquivos, não de linhas.
- Cross-QA: `testability-3` (clock) coincide com Modifiability; `testability-1` (goldens/fixtures) coincide com Integrability (contract tests) e com Fault Tolerance (rejeição bancária); o `test:sql` em CI coincide com Deployability.
- Ponto forte a preservar: flags default OFF com testes de paridade contra o main, e a asserção de não vazamento de dado sensível.
- A transição de estado do lote não foi contada transição a transição, e a métrica ficou declarada como não medível.
