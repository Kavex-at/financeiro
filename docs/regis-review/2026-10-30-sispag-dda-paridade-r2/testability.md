---
qa: Testability
qa_slug: testability
run_id: 2026-10-30-sispag-dda-paridade-r2
agent: qa-testability
generated_at: 2026-10-30T00:00:00Z
scope: all
score: 8
findings_count: 7
cards_count: 7
---

# Testability — Regis-Review (R2, delta do ciclo 2)

Escopo: só o delta R2 (uncommitted) do `sispag-dda-paridade`. R1 já ficou documentada em
`docs/regis-review/2026-10-30-sispag-dda-paridade/testability.md`; aqui é o adicional do segundo
turno, com peso em três superfícies novas:

1. **Trava "uma formação automática por dia útil"** (`FormacaoLotesService.formar({automatica})` +
   `JobExecucaoRepository.existeConcluidaDesde` + 4 slots de cron em `ingest-sispag.yml`).
2. **Conferência rápida do DDA (I-DDA6/I-DDA7)** (`BoletoDdaService.conferir`/`conferirSeVelho`,
   `BoletoDdaRepository.listArquivosEstado`/`atualizarCabecalho`/`registrarConferencia`/
   `ultimaConferencia`, migration `0092_boleto_dda_conferencia.sql`,
   `CarteiraAtualizacaoService.conferirDda`).
3. **Guarda contra arquivo vazio do fin124** (`EmptyDdaFileError`, `BoletoDdaRepository.salvarArquivo`
   com `tx.selectFirst` do snapshot, `BoletoDdaService.lerArquivos` separando a contagem).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que mexe na trava diária, no refactor da conferência rápida ou na proteção contra `fin124` devolver `[]` | Edição em `FormacaoLotesService.formar`, `BoletoDdaService.conferir`/`lerArquivos`, `BoletoDdaRepository.salvarArquivo`, `CarteiraAtualizacaoService.atualizarSeDefasada` ou nos crons do workflow | Serviços SISPAG + repositório DDA + migration 0092 + workflow `ingest-sispag.yml` | Pré-merge, no worktree da feature; Postgres HML opcional pelo `test:sql` | Suíte verde confirma (i) trava dentro do lock com 7 fronteiras exercidas; (ii) 10 cenários de `conferir` + `conferirSeVelho`; (iii) `[]` sobre arquivo cheio não apaga nada (unit + integration real) | 100% das branches novas do delta observáveis em teste local em < 20 s; nenhum teste depende de rede ou de `Date.now()` sem override |

Em uma linha: o R2 é majoritariamente defensivo (três invariantes caras: "não forma duas vezes",
"não apaga 40 boletos por engano", "não espera 30 min para ver o DDA do dia"). O custo de uma
regressão aqui vai de "fragmenta lotes" até "esvazia a aba" — isto é, cada invariante vale 1 teste
cru hoje para evitar N horas de incidente depois.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura por camada do delta (test files / source files) — **métrica #1** | serviço: 4/4 (BoletoDda, Carteira, Formacao, ConsolidacaoBoletoDdaCache já existiam/novo); repositório: 2/2 (JobExecucao novo + BoletoDda unit+integration); migration: 1/1 (0092); workflow: 0/1 | 100% | ⚠️ workflow sem teste | `find src/backend -path '*/sispag/*' -newer HEAD~2 -name '*.test.ts'` + `git diff --stat HEAD` |
| Testes dedicados à trava "uma formação por dia útil" | 7 (`FormacaoLotesService.test.ts:669-794`) | ≥ 6 (dia útil ok · já formou · antes 06:30 · 06:30 em ponto · fim-de-semana · manual sem trava · falha fecha trilha) | ✅ | mesmo arquivo |
| Testes dedicados a `JobExecucaoRepository.existeConcluidaDesde` | 2 — parametrização de SQL (`WHERE pipeline/status/started_at`) + linha ausente = `false` | ≥ 2 | ✅ | `src/backend/domain/repository/operacao/JobExecucaoRepository.test.ts:5-29` |
| Testes dedicados ao `BoletoDdaService.conferir`/`conferirSeVelho` (I-DDA6) | 11 cenários no `describe 'I-DDA6'` | ≥ 8 (novo · cabeçalho · nada · gravou · sumido · falha · lock · prazo · empty · intervalo · ingestao-também-marca) | ✅ | `src/backend/domain/service/sispag/BoletoDdaService.test.ts:383-566` |
| Testes dedicados à guarda de `[]` sobre arquivo cheio | 4 unit (`BoletoDdaRepository.test.ts`) + 1 integration (`BoletoDdaRepository.integration.test.ts:185-205`) + 2 pelo serviço | ≥ 1 unit + 1 integration | ✅ | `BoletoDdaRepository.test.ts:49-85`, `.integration.test.ts:185-205` |
| Testes da migration `0092_boleto_dda_conferencia.sql` (idempotência + invariantes) | 2 (aditiva/idempotente + `id = 1`/`conferido_em NOT NULL`) | ≥ 2 | ✅ | `src/backend/migrations/0092_boleto_dda_conferencia.test.ts` |
| Testes do passo de workflow (`.github/workflows/ingest-sispag.yml`) com 4 slots e `if:` em 3 expressões cron | 0 — não há `actionlint` em CI nem fixture do `github.event.schedule` | ≥ 1 (actionlint no CI ou fixture conferindo que o `if:` casa com os `cron:`) | ❌ | `rg actionlint .github/` → vazio; `.github/workflows/ingest-sispag.yml:76-85` |
| Determinismo da trava diária (`FORMACAO_AUTOMATICA_DESDE_MIN_BRT`) | Relógio injetado via `BankingCalendar.withClock(() => new Date(iso))`; fronteiras 06:29:59 e 06:30:00 BRT testadas; corte Z 03:00 (BRT 00:00) testado | 0 `new Date()`/`Date.now()` na cadeia da decisão | ✅ | `FormacaoLotesService.ts:107-120`; `FormacaoLotesService.test.ts:707-731` |
| Determinismo de `conferirSeVelho` | Parâmetro `agora` opcional; teste só exerce o caminho com `agora` explícito | Caminho `agora ?? Date.now()` sem teste direto é P3 — nenhum caller em prod usa o default | ⚠️ | `BoletoDdaService.ts:303`; `BoletoDdaService.test.ts:541-559` |
| Tamanho dos arquivos de teste tocados | `BoletoDdaService.test.ts` 584 LOC (crescimento ~290 no R2); `FormacaoLotesService.test.ts` 794 LOC (crescimento ~130); `BoletosDdaTab.test.tsx` 574 LOC | ≤ 500 LOC por arquivo (CLAUDE.md: "unidade grande demais") | ⚠️ | `wc -l` acima |
| Dependências do construtor de `BoletoDdaService` | 15 (R1 tinha 13, R2 += `ConsolidacaoBoletoDdaCache` + `PagamentoIngestaoRunRepository`) | ≤ 10 — toda nova dependência força atualização de 1 `build()` + N chamadas em teste | ⚠️ | `BoletoDdaService.ts:60-80` |
| `JobExecucaoRepository.existeConcluidaDesde` sem index coberto em teste | sem integration test que valide EXPLAIN com `(pipeline, status, started_at)` | integration opcional em `test:sql` | ⚠️ não medível localmente | `migrations/*job_execucao*.sql` + `JobExecucaoRepository.ts:97-108` |
| Teste do script `jobs/formar-lotes.ts` com flag `--manual` | 0 — a leitura de `process.argv.includes('--manual')` nunca é exercitada | ≥ 1 smoke test (ou refactor em função pura) | ⚠️ | `src/backend/jobs/formar-lotes.ts:21-28` |

> ⚠️ **Não medível localmente**: cobertura `--coverage` por diretório (idem R1) e EXPLAIN da nova
> query de trilha. Requer `jest --coverage` em ambos projetos e Postgres do `test:sql`. Recomendação:
> ativar `coverageThreshold` por diretório em `src/backend/jest.config.*` após o merge.

## 3. Tactics — Cobertura no delta R2

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `FormacaoLotesService` exporta `PIPELINE_FORMACAO_LOTES` e `FORMACAO_AUTOMATICA_DESDE_MIN_BRT`; o teste reusa a constante para asserção direta, sem duplicar string | ✅ | `FormacaoLotesService.ts:33-37`; `FormacaoLotesService.test.ts:10,692` |
| Specialized Interfaces (gap) | `cabecalhoMudou` em `BoletoDdaService.ts:423-428` é module-private (não exportada); toda branch (cancelado, status, nome, importadoEm) é testada só indiretamente pelo `conferir` | ⚠️ parcial | `BoletoDdaService.ts:423-428` |
| Recordable Test Cases | Teste do R2 mocka `ConexosDdaClient` com builders em memória; nenhuma fixture `.json` do `fin124` adicionada apesar da nova guarda contra `[]` | ⚠️ parcial | `BoletoDdaService.test.ts:21-72` |
| Sandbox | `FormacaoLotesService` recebe `JobExecucaoRepository` por `@inject`; teste constrói sem container, injetando `{createRun, finishRun, existeConcluidaDesde}` mock — padrão CLAUDE.md | ✅ | `FormacaoLotesService.test.ts:108-134` |
| Sandbox (DI explodindo) | `BoletoDdaService` chega a 15 deps no R2; `build()` esconde o custo, mas cada nova superfície (p.ex. inserir `BoletoSuggestionService`) obriga atualizar o helper e todos os `make`s derivados | ⚠️ | `BoletoDdaService.ts:60-80` + `BoletoDdaService.test.ts:25-74` |
| Executable Assertions | `0092.sql` tem CHECK `id = 1` e `conferido_em NOT NULL`; migration test fixa que ninguém põe `DROP`/`ALTER` futuro | ✅ | `migrations/0092_boleto_dda_conferencia.sql:12-19`; `.test.ts:16-23` |
| Abstract Data Sources | A guarda de `[]` em `salvarArquivo` lê o snapshot via `tx.selectFirst` (dentro da mesma transação) — testada em integration real contra Postgres (`BoletoDdaRepository.integration.test.ts`) | ✅ | `BoletoDdaRepository.ts:56-66`; `.integration.test.ts:185-205` |
| Limit Non-Determinism (trava diária) | `BankingCalendar.withClock(() => new Date(iso))` injetado em cada caso; fronteira 06:29:59/06:30:00 BRT exercida; corte 03:00Z (= início do dia BRT) testado | ✅ | `FormacaoLotesService.test.ts:707-731` |
| Limit Non-Determinism (conferência) | `conferirSeVelho` aceita `agora`; `ConsolidacaoBoletoDdaCache.withClock` propagado. Default `Date.now()` nunca é exercido em teste (nenhum caller atual omite o `agora`) | ⚠️ | `BoletoDdaService.ts:296-305`; `BoletoDdaService.test.ts:541-559` |
| Limit Structural Complexity (teste) | `BoletoDdaService.test.ts` ultrapassa 580 LOC; o novo `describe 'I-DDA6'` sozinho tem 11 casos. Arquivo precisa ser partido antes do próximo turno | ⚠️ | `wc -l src/backend/domain/service/sispag/BoletoDdaService.test.ts` → 584 |
| CI integration | Suite roda via `npm test` em `src/backend`/`src/frontend`; `actionlint` ausente, então erro de sintaxe no `if:` dos 4 novos crons só é visto quando o schedule falha em produção (e GitHub Actions nem avisa) | ❌ | `.github/workflows/ingest-sispag.yml:30-85`; sem `rg actionlint .github/` |

## 4. Findings

### F-testability-r2-1: workflow com 4 slots de cron e `if:` em 3 expressões não é testado

- **Severidade**: P1
- **Tactic violada**: Specialized Interfaces + Limit Non-Determinism
- **Localização**: `.github/workflows/ingest-sispag.yml:30-85`
- **Evidência**:
  ```yaml
  if: >-
    github.event_name == 'schedule' &&
    (github.event.schedule == '7 8 * * 1-5' ||
     github.event.schedule == '7 10 * * *' ||
     github.event.schedule == '13 15 * * 1-5')
  ```
  Três `schedule` listados; o quarto (`13 19 * * 1-5`, 16:13 BRT) por desenho **não** forma — isso é
  invariante do design, mas nenhuma asserção impede alguém de adicioná-lo por engano, e um erro de
  um dígito em qualquer expressão quebra silenciosamente a formação (os crons do GitHub falham sem
  travar o PR; a fonte de verdade da feature mora numa string de workflow sem lint).
- **Impacto técnico**: expressão cron errada ou `if:` dessincronizado = pipeline passa, formação não
  roda. R1 já tinha a ADR-0060; o R2 acrescenta 2 slots e troca de minuto para `:07`/`:13`.
- **Impacto de negócio**: dia inteiro sem formação automática → analista precisa disparar manual
  pela aba Actions ou pelo botão; silencioso até alguém reclamar.
- **Métrica de baseline**: 0 testes de workflow / 4 slots.

### F-testability-r2-2: `jobs/formar-lotes.ts --manual` sem teste

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/backend/jobs/formar-lotes.ts:21-28`
- **Evidência**:
  ```ts
  const manual = process.argv.includes('--manual');
  const r = await service.formar({
      triggeredBy: manual ? 'manual' : 'cron',
      automatica: !manual,
  });
  ```
  A trava de "uma por dia" depende dessa flag — se o workflow for editado para `-- -manual`,
  `--Manual`, `--MANUAL` ou outro valor, o passo "manual sem trava" vira "automatica sem trava",
  e dois crons na mesma hora formam duas vezes. Nenhum teste exercita o script.
- **Impacto técnico**: regressão invisível; o teste `manual não tem trava` passa só no serviço, não
  no script-cola.
- **Impacto de negócio**: lotes fragmentados em um dia útil comum.
- **Métrica de baseline**: 0 teste no script / 1 flag CLI nova.

### F-testability-r2-3: `BoletoDdaService` com 15 dependências no construtor

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:60-80`
- **Evidência**: R2 adicionou `ConsolidacaoBoletoDdaCache` e `PagamentoIngestaoRunRepository`.
  O helper `build()` do teste cresceu de 13 para 15 campos; qualquer nova dependência futura força
  edição em todos os `describe` existentes (R1 + R2 somam 15+ `build()`-callers no mesmo arquivo).
- **Impacto técnico**: fricção de teste; convite a "resolver pelo container" nos próximos turnos.
- **Impacto de negócio**: nenhum direto; cost multiplier Bassiano acumulando.
- **Métrica de baseline**: 15 deps / alvo ≤ 10.

### F-testability-r2-4: `BoletoDdaService.test.ts` com 584 LOC

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (teste)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.test.ts`
- **Evidência**: 584 LOC; o `describe 'I-DDA6'` sozinho ocupa ~180 LOC, `sispag-dda-paridade` ~90 LOC
  e `fault-tolerance-1` ~35 LOC — tudo convivendo com o teste do R1 do `listar`/`sincronizar`.
- **Impacto técnico**: diff grande em cada mudança; `jest -t` fica obrigatório para iterar.
- **Impacto de negócio**: nenhum direto.
- **Métrica de baseline**: 584 LOC / alvo ≤ 500.

### F-testability-r2-5: `cabecalhoMudou` não exportado e sem teste direto

- **Severidade**: P3
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:423-428`
- **Evidência**:
  ```ts
  const cabecalhoMudou = (atual, novo) =>
      (atual.canceladoEm ?? null) !== (novo.canceladoEm ?? null) ||
      (atual.status ?? null) !== (novo.status ?? null) ||
      (atual.nome ?? null) !== (novo.nome ?? null) ||
      (novo.importadoEm !== undefined && (atual.importadoEm ?? null) !== novo.importadoEm);
  ```
  As 4 branches do OR são exercidas via `conferir` com arquivos preparados, mas falha de uma
  branch não aponta a condição errada — o teste reclama de `arquivosCabecalho` genérico.
- **Impacto técnico**: debug mais lento; adicionar 5ª dimensão (p.ex. `aceitoEm`) sem teste direto
  é fácil.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 4 branches, 0 teste unit da função.

### F-testability-r2-6: `conferirSeVelho` sem teste do default `Date.now()`

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:296-305`
- **Evidência**: `const agora = input.agora ?? Date.now();` — nenhum caller atual omite `agora`,
  mas um teste futuro que o faça fica dependente do relógio real.
- **Impacto técnico**: potencial flake em caller novo.
- **Impacto de negócio**: nenhum hoje.
- **Métrica de baseline**: 1 leitura de relógio não-abstraída coberta por 0 teste.

### F-testability-r2-7: `existeConcluidaDesde` sem integration test / sem index exercitado

- **Severidade**: P3
- **Tactic violada**: Abstract Data Sources
- **Localização**: `src/backend/domain/repository/operacao/JobExecucaoRepository.ts:97-108`
- **Evidência**: query filtra `pipeline`, `status`, `started_at >= $desde`; o unit test só confere o
  SQL textual. Nenhum integration test (nem `test:sql`) exercita a query contra um banco; se o
  índice `(pipeline, status, started_at DESC)` não existir, o custo sobe com `job_execucao` grande.
- **Impacto técnico**: trava diária fica O(N) em `job_execucao` com o tempo.
- **Impacto de negócio**: baixo hoje (tabela pequena), cresce com o uso.
- **Métrica de baseline**: 0 integration test / 1 nova query de leitura hot-path.

## 5. Cards Kanban

### [testability-r2-1] Lintar `ingest-sispag.yml` em CI (actionlint) e fixar o pareamento `cron` ↔ `if:`

- **Problema**
  > O passo de formação do workflow tem 4 slots cron e um `if:` com 3 expressões literais. Erro de
  > um dígito ou de aspas quebra silenciosamente a trava "uma por dia" ou mata a formação por um
  > dia inteiro — e GitHub Actions não trava o PR por isso.
- **Melhoria Proposta**
  > Adicionar `actionlint` (via `rhysd/actionlint-action`) ao workflow de CI já existente; e um
  > teste unit em `src/backend/jobs/formar-lotes.ts` (ou em `scripts/`) que carregue
  > `ingest-sispag.yml` com `yaml` e asserte que o conjunto de `schedule.cron` é igual ao conjunto
  > das expressões no `if:` do passo "Formação automática", exceto o slot documentado como
  > "só ingestão" (`13 19 * * 1-5`).
- **Resultado Esperado**
  > Workflow coberto por lint + 1 teste pareando `cron` ↔ `if:`: `0 teste → 1 teste`; o PR falha
  > quando alguém altera uma expressão sem atualizar a outra.
- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-r2-1
- **Métricas de sucesso**:
  - Testes de workflow: 0 → 1
  - Lint CI (`actionlint`): ausente → presente
- **Risco de não fazer**: Dia útil sem formação automática por erro silencioso de edição; detecção
  só por reclamação do analista.
- **Dependências**: nenhuma.

### [testability-r2-2] Teste do script `jobs/formar-lotes.ts --manual`

- **Problema**
  > A flag `--manual` é lida de `process.argv` no script-cola e decide se a trava "uma por dia"
  > vale. Nenhum teste exercita o script; a decisão é frágil a edições do workflow.
- **Melhoria Proposta**
  > Extrair o parsing para uma função pura (`decidirAutomatica(argv): {automatica: boolean,
  > triggeredBy: 'manual' | 'cron'}`) e testar com 3 casos: sem flag, `--manual`, flag quebrada
  > (`--Manual`). Alternativa: executar o script via `child_process` com `--help`-like dry-run.
- **Resultado Esperado**
  > 1 função pura testada: `0 teste → 3 casos`.
- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-r2-2
- **Métricas de sucesso**:
  - Testes de script: 0 → 3
- **Risco de não fazer**: regressão silenciosa fragmenta lotes num dia útil.
- **Dependências**: nenhuma.

### [testability-r2-3] Partir `BoletoDdaService.test.ts` por responsabilidade

- **Problema**
  > O arquivo chegou a 584 LOC somando `listar`, `sincronizar`, cache F4, fault-tolerance-1 e todo
  > o `describe 'I-DDA6'`. Diff grande, iteração dependente de `jest -t`.
- **Melhoria Proposta**
  > Extrair `BoletoDdaService.conferir.test.ts` (I-DDA6 + `conferirSeVelho`) e
  > `BoletoDdaService.sincronizar.test.ts` (`arquivosLidos`, F4 cache, fault-tolerance-1).
  > Compartilhar o `build()` em um `__fixtures__/boletoDdaServiceBuild.ts`.
- **Resultado Esperado**
  > Arquivo principal: 584 LOC → ≤ 250 LOC; nenhum arquivo novo > 350 LOC.
- **Tactic alvo**: Limit Structural Complexity (teste)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-r2-4, F-testability-r2-3
- **Métricas de sucesso**:
  - LOC do arquivo principal: 584 → ≤ 250
  - Arquivos de teste do serviço DDA: 1 → 3
- **Risco de não fazer**: debt de teste cresce no próximo turno; convite a `container.resolve`.
- **Dependências**: nenhuma.

### [testability-r2-4] Reduzir superfície do construtor de `BoletoDdaService`

- **Problema**
  > 15 dependências — R2 somou `ConsolidacaoBoletoDdaCache` e `PagamentoIngestaoRunRepository`.
  > Cada caller de teste atualiza o `build()`; o próximo turno estressa de novo.
- **Melhoria Proposta**
  > Agrupar deps por responsabilidade em `BoletoDdaReaders` (`listBoletos`, `listAtivos`,
  > `assinaturaTitulosEmLotesAbertos`, `findLatestSuccessFinishedAt`, `ultimaSincronizacao`,
  > `ultimaConferencia`, `listArquivosEstado`) e `BoletoDdaWriters`
  > (`salvarArquivo`, `atualizarCabecalho`, `registrarConferencia`). Mantém DDD; corta mocks.
- **Resultado Esperado**
  > 15 deps → ≤ 10; cada `build()` injeta ≤ 10 mocks.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-r2-3
- **Métricas de sucesso**:
  - Deps do construtor: 15 → ≤ 10
- **Risco de não fazer**: multiplicador do custo-teste cresce; feature nova obriga mexer em todos
  os `make`s.
- **Dependências**: `testability-r2-3` (fazer antes para a extração mapear 1:1).

### [testability-r2-5] Exportar e testar `cabecalhoMudou`

- **Problema**
  > Função module-private com 4 branches no OR; falha pontual não é apontada por teste direto, só
  > via `conferir`.
- **Melhoria Proposta**
  > Exportar como `BoletoDdaService.cabecalhoMudou` (ou mover para `libs/boleto`) e testar as 4
  > branches isoladamente, incluindo a borda `importadoEm === undefined`.
- **Resultado Esperado**
  > 0 testes diretos → 5 cenários (null/null, null/valor, valor/valor igual, 3× campos diferentes).
- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-r2-5
- **Métricas de sucesso**:
  - Testes diretos da função: 0 → 5
- **Risco de não fazer**: adição silenciosa de 5ª dimensão (ex. `aceitoEm`) fica sem defesa.
- **Dependências**: nenhuma.

### [testability-r2-6] Clock injetável em `conferirSeVelho` (remover `Date.now()` default)

- **Problema**
  > `const agora = input.agora ?? Date.now();` só não vaza porque todos os callers passam `agora`
  > hoje. É uma pegadinha para o próximo caller.
- **Melhoria Proposta**
  > Receber `clock: () => number` por injeção de construtor (ou `BankingCalendar.now()`), e remover
  > o default. Caller que estava passando `agora` segue passando. Alinha com Modifiability (R1).
- **Resultado Esperado**
  > 1 leitura `Date.now()` eliminada do source; teste cobre o caminho sem override.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-r2-6
- **Métricas de sucesso**:
  - `Date.now()` em `BoletoDdaService.ts`: 1 → 0
- **Risco de não fazer**: baixo; fica como débito.
- **Dependências**: cross-QA com Modifiability (relógio como injetável).

### [testability-r2-7] Integration test de `JobExecucaoRepository.existeConcluidaDesde`

- **Problema**
  > A trava diária depende de uma query hot-path (lida dentro do lock, 3× por dia útil); só o SQL
  > textual é checado em unit. Sem índice `(pipeline, status, started_at DESC)` a query degrada
  > conforme `job_execucao` cresce (minuto :07 do cron já lento = janela de 2 crons concorrentes).
- **Melhoria Proposta**
  > Adicionar caso em `JobExecucaoRepository.integration.test.ts` (criar se não existir) que
  > popule 10k linhas e assegure que `existeConcluidaDesde` retorna em < 50 ms; conferir index
  > em migration.
- **Resultado Esperado**
  > 0 integration test → 1; p99 da query coberto; índice confirmado.
- **Tactic alvo**: Abstract Data Sources
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-r2-7
- **Métricas de sucesso**:
  - Integration tests do repositório: 0 → 1
  - p99 local da query com 10k linhas: medido ≤ 50 ms
- **Risco de não fazer**: degradação silenciosa; cross-QA com Performance.
- **Dependências**: cross-QA com Performance (índice + p99).

## 6. Cross-QA links

- F-testability-r2-6 ↔ **Modifiability**: `conferirSeVelho`/clock injetável é a mesma recomendação
  do R1 para `ConsolidacaoBoletoDdaCache` — unificar via `ClockProvider` quando/se for criado.
- F-testability-r2-1 ↔ **Deployability**: `actionlint` em CI gate (coverage gate antes do deploy).
- F-testability-r2-7 ↔ **Performance**: p99 da query de trava diária (índice composto).
- Trava diária + lock advisory ↔ **Fault Tolerance**: a state-machine implícita
  "running→success/partial/error" do `job_execucao` tem 100% das transições novas do R2
  cobertas por `FormacaoLotesService.test.ts` (createRun, finishRun success, finishRun error).
