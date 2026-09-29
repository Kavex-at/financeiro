---
qa: Testability
qa_slug: testability
run_id: 2026-09-29-2020
agent: qa-testability
generated_at: 2026-09-29T20:40:00-03:00
scope: all
score: 8
findings_count: 6
cards_count: 5
---

# Testability — Regis-Review

> Modo `--quick`: a suíte de cobertura NÃO foi executada. Escopo: delta da feature `sync-status-lote-sispag` (ADR-0055) + diretórios tocados. Cada finding marca **[in-delta]** ou **[pré-existente]**.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na regra de decisão do status do lote (ex.: nova situação de item do Conexos) | `DecisaoStatusLote`, `SincronizacaoLoteService`, `LotePagamentoRepository`, job horário | Desenvolvimento local e CI (`ci.yml`) | Testes forçam cada estado do ERP e do lote sem rede, sem relógio real e sem banco (exceto suíte SQL dedicada), e falham se a regra regride | 100% das linhas da tabela-verdade T1–T8 cobertas; tempo do ciclo de teste do módulo < 30 s; 0 chamadas de rede; piso de cobertura de `domain/service/` (88% linhas) mantido |

## 2. Métricas observadas

| # | Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|---|
| 1 | **Cobertura por camada (proxy de arquivos, coverage não executada — `--quick`)** | ver tabela abaixo | ≥ 0,5 por camada | ⚠️ | `find … -name '*.test.ts'` |
| 2 | Razão global test/fonte backend | 196 / 373 = 0,53 | ≥ 0,5 | ✅ | `find src/backend` |
| 3 | Testes novos no delta | 12 arquivos de teste novos/alterados para 9 arquivos de produção novos (DecisaoStatusLote 28 casos, Service 16 casos T1–T8+extras, Repository 39, Job 7, Rotas +137 linhas, LoteCard +163 linhas, migração unit+integration) | ≥ 1 teste por arquivo novo | ✅ | `git diff origin/main...HEAD --stat` |
| 4 | Arquivos novos de produção sem teste dedicado | 1 (`validate-sync-status-lote-sispag-v1.ts`, sonda manual read-only; deliberado) | 0 | ✅ | diff stat |
| 5 | Injeção via construtor vs `container.resolve` nos testes do delta | 0 `container.resolve` em Service/Job/Rotas; 100% mocks por construtor | 100% construtor | ✅ | `grep -c container.resolve` |
| 6 | Testes de integração com Postgres real | 3 arquivos em `migrations/` (0067, 0069, vwMetricasCiclo); 0069 exercita 4 dos 28 métodos públicos do `LotePagamentoRepository` | ≥ 1 por repositório com SQL complexo | ⚠️ | `find -name '*.integration.test.ts'` |
| 7 | Integração falha ruidosamente no CI sem DSN | sim (`CI=true` sem `METRICAS_CICLO_TEST_DSN` lança) e job `test:sql` com Postgres 17 no `ci.yml` | presente | ✅ | `0069…integration.test.ts:24-40`, `ci.yml:38-62` |
| 8 | Leituras de tempo não abstraídas no delta | 3 (`agora: Date = new Date()` como default de parâmetro em `SincronizacaoLoteService.ts:135,156,177`); o relógio É injetável por parâmetro, mas o job chama `sincronizarTodos()` sem argumento (`SincronizarLotesSispagJob.ts:39`) | 0 não injetáveis | ⚠️ | grep |
| 9 | Aleatoriedade no delta | 0 | 0 | ✅ | grep |
| 10 | Testes com rede real no delta | 0 (clients testados com mock de HTTP) | 0 | ✅ | leitura de `Conexos*Client.test.ts` |
| 11 | Fake timers nos testes do delta | 0 usos; determinismo vem do parâmetro `agora` / constante `AGORA` | n/a | ✅ | grep `useFakeTimers` |
| 12 | Asserções de log em caminhos de erro | Job: `logService.error` asserido; Service: 1 asserção de `warn` (`SincronizacaoLoteService.test.ts:316`) para 3 caminhos degradados (leitura de evento, alerta, PSQ_018 403) | todo caminho de erro | ⚠️ | grep `logService` |
| 13 | Transições da state machine `lote-pagamento` no delta | T1–T8 + REJEITADO/BAIXADO divergente + conflito de versão + tabela-verdade (28 casos) cobrem BAIXADO, RETORNADO, permanência e divergência; L7 aposentada testada (410) | 100% | ✅ | `DecisaoStatusLote.test.ts`, `routes/sispag.test.ts:1408` |
| 14 | Fixtures gravadas de API externa (Recordable Test Cases) | Ausentes para Conexos: `__fixtures__` existem só para `interface/{sispag,permutas,recebimentos}` e `http`; `ConexosSispagClient/TitulosClient.test.ts` usam payloads inline | fixture por client | ⚠️ | `find -name __fixtures__` |
| 15 | Maiores arquivos de teste (pré-existente) | `RemessaService.test.ts` 2218; `LotePagamentoService.test.ts` 1061; `SispagPainelService.test.ts` 739; no delta o maior é `SincronizacaoLoteService.test.ts` 441 | ≤ 500 | ❌ (pré-existente) | `wc -l` |
| 16 | `coverageThreshold` | global 72/54/78 (linhas/branches/funções) + `./domain/service/` 88/60 + pisos por arquivo | presente e ≥ 70% em caminho crítico | ✅ | `src/backend/jest.config.cjs:39-50` |
| 17 | Testes no CI bloqueando PR | `ci.yml` roda `npm test -- --coverage` (backend e frontend) + `npm run test:sql` | presente | ✅ | `ci.yml:27,60,80` |
| 18 | Property-based (`fast-check`) | 0 arquivos de teste usam (front e back) | ≥ 1 na tabela-verdade | ⚠️ | `grep -rln fast-check` |
| 19 | Front do delta | `LoteCard.test.tsx` +163 linhas; `lib/sispag.ts`/`operacao.ts` sem teste dedicado (helpers de fetch) | ≥ 0,5 | ⚠️ | `find frontend/app/sispag frontend/lib` |
| 20 | Agente TDDGuide | ausente em `.claude/agents/` (só `pattern-guardian`) | presente | ⚠️ (pré-existente) | `ls .claude/agents` |
| 21 | Cobertura de linhas/branches por diretório | ⚠️ **Não medível nesta execução** (`--quick`). Recomendação: rodar `cd src/backend && npm test -- --coverage --silent` no ciclo seguinte e registrar por diretório. | 80/70/80 em service e repository | — | — |

**Tabela por camada (Métrica #1, proxy por arquivos; cobertura real não medida):**

| Camada | Testes | Fonte | Razão | Status |
|---|---|---|---|---|
| Backend total | 196 | 373 | 0,53 | ✅ |
| `domain/service` | 57 | 67 | 0,85 | ✅ |
| `domain/service/sispag` | 13 | 14 | 0,93 | ✅ |
| `domain/repository` | 26 | 27 | 0,96 | ✅ |
| `domain/client` | 17 | 22 | 0,77 | ✅ |
| `routes` | 28 | 10 | 2,8 (vários por rota) | ✅ |
| `jobs` | 3 | 71 | 0,04 | ❌ (pré-existente; o job do delta tem teste) |
| Migrações (unit + integração) | 3 int. + unit | 7 | — | ✅ |
| Frontend total | 64 | 137 | 0,47 | ⚠️ |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Serviço recebe `loteRepo`, `sispag`, `titulosClient`, `retorno`, `notificacao`, `logService` por construtor; `DecisaoStatusLote` é função pura sem dependências; `sincronizarLote` isolado do laço | ✅ presente | `SincronizacaoLoteService.test.ts:164-179`, `DecisaoStatusLote.ts` |
| Recordable Test Cases | Casos T1–T8 nomeados a partir de títulos reais do ERP (38682/1, 4030/7) e sonda ground-truth; sem fixtures JSON gravadas dos clients | ⚠️ parcial | `SincronizacaoLoteService.test.ts:186-232`, `validate-sync-status-lote-sispag-v1.ts` |
| Sandbox | Banco descartável criado/derrubado por teste de migração (`CREATE DATABASE … / DROP … WITH (FORCE)`); ERP nunca é escrito (I11a asserido); sonda read-only | ✅ presente | `0069…integration.test.ts:50-95`, teste I11a `:381` |
| Executable Assertions | CHECKs de banco (situação, origem, fonte, tipo de alerta) verificados; trava de versão otimista testada; `LoteVersaoConflitoError` | ✅ presente | `0069…integration.test.ts:106-176` |
| Abstract Data Sources | Repositórios e clients atrás de DI; `pool` injetado no repositório (`new LotePagamentoRepository(pool)`) | ✅ presente | `0069…integration.test.ts:92` |
| Limit Structural Complexity | Decisão extraída em `DecisaoStatusLote` (409 LOC) pura e testável; porém `SincronizacaoLoteService.ts` tem 626 LOC | ⚠️ parcial | diff stat |
| Limit Non-Determinism | `agora` injetável por parâmetro; sem `Math.random`; sem rede; job usa default `new Date()` e não expõe relógio ao teste do job | ⚠️ parcial | `SincronizacaoLoteService.ts:135,156,177` |

## 4. Findings

### F-testability-1: Relógio injetável só por parâmetro default; job e rota não o controlam [in-delta]

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoLoteService.ts:135,156,177`; `src/backend/jobs/SincronizarLotesSispagJob.ts:39`
- **Evidência (objetiva)**:
  ```
  public sincronizarTodos = async (agora: Date = new Date()): Promise<ResumoSincronizacao>
  const resumo = await this.sincronizacao.sincronizarTodos();
  ```
- **Impacto técnico**: os testes do serviço passam `agora` explícito, então a regra está determinística. O job e a rota manual, porém, dependem do relógio real: não há teste que fixe `sincronizado_em`/janela de staleness ponta a ponta.
- **Impacto de negócio**: baixo; o risco é regressão silenciosa de carimbo de sincronização (base do alerta de staleness).
- **Métrica de baseline**: 3 leituras `new Date()` em default de parâmetro; 0 `ClockProvider`.

### F-testability-2: Repositório do delta majoritariamente testado com pool mockado; SQL real cobre 4 de 28 métodos [in-delta]

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (+189 linhas), `LotePagamentoRepository.test.ts` (39 casos), `0069…integration.test.ts`
- **Evidência (objetiva)**:
  ```
  integração 0069 exercita: listLotesSincronizaveis, tocarSincronizacao, aplicarSincronizacao (x2)
  métodos públicos do repositório: 28
  ```
- **Impacto técnico**: os métodos novos de escrita foram cobertos em Postgres real (bom, inclui trava de versão e transação); os demais métodos novos de leitura/filtragem só validam a string SQL contra mock.
- **Impacto de negócio**: SQL que passa no mock mas falha no Postgres só apareceria no cron horário.
- **Métrica de baseline**: 4/28 métodos com teste em banco real (14%).

### F-testability-3: Clients Conexos novos sem fixtures gravadas [in-delta; padrão pré-existente]

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/client/ConexosSispagClient.test.ts`, `ConexosTitulosClient.test.ts`
- **Evidência (objetiva)**:
  ```
  find src/backend -name '__fixtures__' → http, interface/{sispag,permutas,recebimentos}; nenhum em domain/client
  ```
- **Impacto técnico**: payloads inline derivam da leitura manual do ERP; mudança de contrato do Conexos (ex.: campo `fbeVldTpret`, `vldPago`) não é detectada por teste. A sonda `validate-sync-status-lote-sispag-v1.ts` mitiga, mas é manual.
- **Impacto de negócio**: o incidente de 23/09 (credenciais) mostrou que falhas do ERP chegam silenciosas; contrato sem fixture repete o risco.
- **Métrica de baseline**: 0 fixtures gravadas de Conexos em 22 clients.

### F-testability-4: Asserções de log escassas nos caminhos degradados do serviço [in-delta]

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `SincronizacaoLoteService.test.ts:321,416,429`
- **Evidência (objetiva)**:
  ```
  1 asserção de logService.warn no arquivo para 3 caminhos degradados
  ```
- **Impacto técnico**: os testes verificam que a passada continua, mas não que a falha é registrada com contexto (lote, código de evento).
- **Impacto de negócio**: operador não teria pista no log em incidente às 2h.
- **Métrica de baseline**: 1/3 caminhos degradados com asserção de log.

### F-testability-5: Tabela-verdade sem teste de propriedades; `fast-check` sem adoção [in-delta / pré-existente]

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity (verificação de invariantes)
- **Localização**: `DecisaoStatusLote.test.ts`; `grep fast-check` → 0 arquivos
- **Evidência (objetiva)**:
  ```
  28 casos escritos à mão; fast-check: 0 usos em 196+64 arquivos de teste
  ```
- **Impacto técnico**: invariantes como "nunca reabre lote BAIXADO" e "decisão idempotente entre duas passadas" (T4) são candidatas naturais a propriedades sobre combinações de itens.
- **Impacto de negócio**: baixo; mais confiança na regra financeira central.
- **Métrica de baseline**: 0 testes de propriedade.

### F-testability-6: Cobertura estrutural fraca em jobs e testes gigantes [pré-existente]

- **Severidade**: P1 (fora do delta; não bloqueia)
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/jobs/` (3 testes / 71 fontes); `RemessaService.test.ts` (2218 linhas)
- **Evidência (objetiva)**:
  ```
  jobs: 3/71 = 0,04; RemessaService.test.ts 2218 LOC
  ```
- **Impacto técnico**: ~58 jobs compartilham `bootstrapAppContainer` (ver CLAUDE.md, Gotchas) sem teste; o job novo é exceção positiva (7 casos, incluindo "leituras todas falharam → exit 1").
- **Impacto de negócio**: crons de produção sem rede de proteção (cf. run com 0 títulos aparecendo como success).
- **Métrica de baseline**: razão 0,04 em jobs; 1 arquivo > 2000 LOC.

## 5. Cards Kanban

### [testability-1] Cobrir SQL do LotePagamentoRepository em Postgres real

- **Problema**
  > Só 4 dos 28 métodos públicos do repositório são exercitados em banco real; o restante (incluindo leituras novas de sincronização) valida SQL contra pool mockado.
- **Melhoria Proposta**
  > Estender a suíte `test:sql` (Sandbox) com casos para os demais métodos alterados no delta, reutilizando o setup de `0069…integration.test.ts` extraído para helper compartilhado.
- **Resultado Esperado**
  > Métodos do `LotePagamentoRepository` com teste em Postgres real: 4/28 → 12/28; casos de integração do repositório: 5 → 12.
- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Métodos com teste em banco real: 4 → 12
  - Tempo do job `test:sql`: registrar baseline e manter < 2 min
- **Risco de não fazer**: divergência SQL mock/real detectada só no cron horário.
- **Dependências**: nenhuma.

### [testability-2] Gravar fixtures dos clients Conexos usados pela sincronização

- **Problema**
  > `ConexosSispagClient` e `ConexosTitulosClient` são testados com payloads inline; nenhum client do Conexos tem `__fixtures__`.
- **Melhoria Proposta**
  > Gerar fixtures anonimizadas a partir da sonda `validate-sync-status-lote-sispag-v1.ts` (Recordable Test Cases) e usá-las nos testes dos clients e no `SincronizacaoLoteService.test.ts` (T1, T2, T5).
- **Resultado Esperado**
  > Fixtures de client Conexos: 0 → 4 (fin064, PSQ_018, fin052, detalhe de retorno); testes de client baseados em fixture: 0 → 2 arquivos.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Fixtures gravadas de Conexos: 0 → 4
- **Risco de não fazer**: mudança de contrato do ERP passa nos testes e falha em produção.
- **Dependências**: nenhuma.

### [testability-3] Asserir logs nos caminhos degradados e expor o relógio ao job

- **Problema**
  > Falha de leitura de evento, de alerta e PSQ_018 403 só são verificados quanto à continuidade; job e rota usam `new Date()` implícito.
- **Melhoria Proposta**
  > Adicionar `expect(logService.warn/error).toHaveBeenCalledWith(...)` com contexto (loteId, código) nos 3 caminhos; injetar um `ClockProvider` (ou `agora` explícito no job) e fixá-lo no teste do job.
- **Resultado Esperado**
  > Caminhos degradados com asserção de log: 1/3 → 3/3; leituras `new Date()` não injetáveis no delta: 3 → 0.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1, F-testability-4
- **Métricas de sucesso**:
  - Asserções de log no serviço: 1 → 4
  - Leituras de tempo sem injeção: 3 → 0
- **Risco de não fazer**: incidente sem pista de log e regressão de carimbo de sincronização.
- **Dependências**: nenhuma.

### [testability-4] Adicionar testes de propriedade à DecisaoStatusLote

- **Problema**
  > A função pura central tem 28 casos manuais e `fast-check` (já dependência) tem 0 usos.
- **Melhoria Proposta**
  > Escrever propriedades: (a) decisão é idempotente para o mesmo insumo; (b) lote BAIXADO nunca transiciona; (c) rejeição em qualquer item nunca resulta em BAIXADO.
- **Resultado Esperado**
  > Testes de propriedade no repositório: 0 → 3; ≥ 100 execuções geradas por propriedade.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Arquivos com `fast-check`: 0 → 1
- **Risco de não fazer**: combinações raras de itens ficam sem verificação.
- **Dependências**: nenhuma.

### [testability-5] Iniciar cobertura dos jobs de cron e quebrar RemessaService.test.ts [pré-existente]

- **Problema**
  > Razão de teste em `jobs/` é 3/71 (0,04) e `RemessaService.test.ts` tem 2218 linhas.
- **Melhoria Proposta**
  > Extrair o padrão do teste de `sincronizar-lotes-sispag.test.ts` (exit code, run em error, mensagem redigida) como helper e aplicar aos jobs SISPAG (`ingest-sispag`, `reaper-sispag`); dividir o teste da Remessa por responsabilidade.
- **Resultado Esperado**
  > Razão de teste em `jobs/`: 0,04 → 0,10 (3 → 7 arquivos); maior arquivo de teste: 2218 → ≤ 800 linhas.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P1
- **Esforço estimado**: L
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Testes de jobs: 3 → 7
  - Arquivos de teste > 1000 LOC: 2 → 0
- **Risco de não fazer**: crons falhando silenciosamente por mais seis meses.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta e diretórios tocados; `--quick`, então cobertura real não foi medida (métrica 21). Nenhum P0: a regra financeira nova tem tabela-verdade, T1–T8, integração em Postgres real e gate de CI (`ci.yml`, `test:sql`, thresholds).
- Cross-QA: relógio/aleatoriedade injetáveis (Modifiability); fixtures Conexos = contract tests (Integrability); `test:sql` e thresholds como gate (Deployability); transições do lote e conflito de versão (Fault Tolerance).
- O workflow `sincronizar-lotes-sispag.yml` roda `npm run migrate` e o job direto, sem rodar testes; o gate fica no `ci.yml` do PR (adequado).
