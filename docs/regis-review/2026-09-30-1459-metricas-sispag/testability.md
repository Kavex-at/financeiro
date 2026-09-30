---
qa: Testability
qa_slug: testability
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-testability
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev/CI | Mudança na view `metricas.metricas_ciclo` (0070) ou em `RemessaExecucaoRepository.settle/fail` | Migration 0070, repositório de remessa, página `/metricas` | PR com Postgres 17 em service container (`METRICAS_CICLO_TEST_DSN`) | Regressão de regra (quem conta, em qual semana) falha no CI antes do merge | 100% dos casos SISPAG do delta cobertos por asserção em Postgres real; 0 regras verificadas só por regex |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (delta) | Migration 0070: 264 LOC SQL, 4 testes de integração SISPAG em PG real + 6 guardas estáticas; repo: +3 testes (só texto SQL); frontend: +2 testes. Cobertura % por diretório: ⚠️ não medida (escopo = delta; suíte cheia não reexecutada) | ≥80% linhas em service/repository | ⚠️ | `git diff origin/main HEAD`, `_shared-metrics.md` |
| Suítes/testes globais | BE 178 suites / 3242 testes ✅; test:sql 4 suites / 48 testes ✅; FE 64 suites / 658 testes ✅ | 100% verde | ✅ | `_shared-metrics.md` |
| Razão de arquivos de teste (global, pré-existente) | 196 test / (backend total) — ver shared; FE 64 test files | ≥0,5 | ⚠️ não recalculado | `_shared-metrics.md` |
| Casos SISPAG pedidos vs. cobertos em PG real | 6/7: situacoes (AGENDADO/PAGO/REJEITADO/SEM_RETORNO/NULL), CANCELADO, dry-run, erro, execução dupla, aceite tardio, sem-impacto nas outras frentes, backfill. Faltam: retry que liquida após erro (só regex), borda de fuso da semana | 7/7 | ⚠️ | `vwMetricasCiclo.integration.test.ts` |
| Integração em CI | `npm run test:sql` presente no CI com DSN de service container | presente e bloqueante | ✅ | `.github/workflows/ci.yml:60-62` |
| Testes do repositório contra PG real | 0 de 3 novos (`settle`/`fail`/intermediárias assertam regex do texto SQL) | ≥1 por SQL com CASE/COALESCE | ⚠️ | `RemessaExecucaoRepository.test.ts` |
| Leituras de tempo não injetáveis no delta | 0 no TS; SQL usa `now()` (dentro do DB) e o teste injeta `AGORA` como parâmetro | 0 | ✅ | `SELECT_LINHAS, [SERIE, AGORA]` |
| Rede real em testes do delta | 0 | 0 | ✅ | diff |
| Isolamento entre casos | transação desfeita (`emTransacao`), sem estado compartilhado | sem estado compartilhado | ✅ | integration.test.ts |
| Property-based (delta) | 0 | opcional | ⚠️ (P3) | diff |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Função `metricas_ciclo(serie, agora)` recebe `agora` como parâmetro; permite congelar o tempo | ✅ presente | `SELECT_LINHAS, [SERIE, AGORA]` |
| Recordable Test Cases | Semeadura determinística por SQL (`semearSispag`); fixtures de retorno SISPAG existem em `domain/interface/sispag/__fixtures__` (untracked, fora do delta) | ✅ presente | integration.test.ts |
| Sandbox | Postgres 17 real em service container, transação desfeita por caso | ✅ presente | ci.yml:60; `emTransacao` |
| Executable Assertions | Guardas estáticas (colunas idênticas à 0058, 0070 = 0065 + linhas acrescentadas, única escrita = backfill) protegem contrato | ✅ presente | vwMetricasCiclo.test.ts |
| Abstract Data Sources | Repositório recebe `db` e `identity` injetados (`buildDb()`); a view é lida por `SELECT_LINHAS` | ✅ presente | RemessaExecucaoRepository.test.ts |
| Limit Structural Complexity | View de 264 LOC SQL com CTEs; comportamento verificado por integração, regex só para contrato | ⚠️ parcial | 0070_metricas_ciclo_sispag.sql |
| Limit Non-Determinism | `agora` injetado; sem `Date`/random no delta; `now()` no `settle/fail` só verificado por texto | ⚠️ parcial | RemessaExecucaoRepository.ts |

## 4. Findings

### F-testability-1: `settle`/`fail` (CASE de `encerrado_em`) só verificados por regex, não por PG real

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/sispag/RemessaExecucaoRepository.test.ts` (+34 linhas); `RemessaExecucaoRepository.ts`
- **Evidência (objetiva)**:
  ```
  expect(sql).toMatch(/encerrado_em = CASE WHEN status = 'settled'\s+THEN COALESCE(encerrado_em, now()) ELSE now() END/)
  ```
  A semântica depende do "valor anterior do status no SET" (comentário no código); um regex não prova isso. O cenário error -> retry -> settled (sobrescreve) e settled -> settled (imóvel) não têm caso em PG real. A integração só semeia `encerrado_em` já pronto.
- **Impacto técnico**: uma reescrita equivalente do texto quebra o teste sem quebrar o comportamento (falso-negativo de manutenção); uma mudança de comportamento com o mesmo texto passaria.
- **Impacto de negócio**: a semana em que a remessa "nasce" no painel depende desse carimbo; erro aqui move R$ entre semanas do relatório de ciclo.
- **Métrica de baseline**: 0 de 3 testes novos do repositório executam o SQL; 0 casos em PG real do `settle`. (Estilo do arquivo é texto SQL — pré-existente; por isso P2.)

### F-testability-2: Borda de fuso horário da semana não testada

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `vwMetricasCiclo.integration.test.ts` (casos SISPAG)
- **Evidência (objetiva)**: todas as datas semeadas caem no meio do dia (10:00–20:00 -03). A guarda estática confere `AT TIME ZONE 'America/Sao_Paulo'`, mas nenhuma remessa encerra perto do limite da janela (ex.: 2026-09-25 23:59 -03 vs 26/09 00:01 UTC).
- **Impacto técnico**: `encerrado_em` em `timestamptz` cruzando meia-noite UTC vs. local pode ir para a semana errada sem teste falhar.
- **Impacto de negócio**: título contado na semana errada nos relatórios semanais; as remessas rodam à tarde no BRT (~16h, ~UTC 19h), então o risco é baixo hoje.
- **Métrica de baseline**: 0 casos de borda de janela nos 4 casos SISPAG.

### F-testability-3: Idempotência da 0070 e retry `COALESCE(encerrado_em, criado_em)` sem caso

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `vwMetricasCiclo.integration.test.ts` (backfill)
- **Evidência (objetiva)**: o teste de backfill roda a migration uma vez; não roda duas (o `WHERE encerrado_em IS NULL` protege, mas por texto). O fallback para `criado_em` (linha `settled` com `encerrado_em` NULL, em voo pós-deploy) também não é exercitado na view. Frontend: nenhum caso para `parcial` da semana corrente do SISPAG.
- **Impacto técnico**: baixo; guardas estáticas cobrem parte.
- **Impacto de negócio**: baixo (migração já validada em produção read-only: 2 e 11 títulos).
- **Métrica de baseline**: 1 execução da 0070 por teste; 0 casos de `encerrado_em` NULL em linha `settled` na view.

## 5. Cards Kanban

### [testability-1] Cobrir `settle`/`fail` em Postgres real

- **Problema**
  > O carimbo `encerrado_em` (que define a semana das métricas SISPAG) só é validado por regex de texto SQL; o comportamento "1º encerramento imóvel, retry sobrescreve erro" não roda em PG real.

- **Melhoria Proposta**
  > Adicionar em `vwMetricasCiclo.integration.test.ts` (ou nova suíte `test:sql`) 3 casos: pending->settle carimba; settle->settle não move; error->settle sobrescreve. Tactic: Sandbox.

- **Resultado Esperado**
  > Casos de `settle`/`fail` em PG real 0 -> 3; regex passa a ser complementar.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos de integração do repositório de remessa: 0 -> 3
- **Risco de não fazer**: refatoração do SQL passa no regex e move título de semana sem alarme.
- **Dependências**: nenhuma

### [testability-2] Caso de borda de fuso na semana do SISPAG

- **Problema**
  > Nenhuma remessa semeada fica perto do limite semanal; a conversão para `America/Sao_Paulo` só é verificada por regex.

- **Melhoria Proposta**
  > Semear remessa encerrada 23:59 -03 no último dia da semana B e outra 00:01 -03 na semana C; assertar semanas distintas.

- **Resultado Esperado**
  > Casos de borda de janela no SISPAG: 0 -> 2.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos de borda de fuso: 0 -> 2
- **Risco de não fazer**: erro de semana em remessa noturna, só visto pelo analista.
- **Dependências**: nenhuma

### [testability-3] Fechar lacunas menores (idempotência 0070, fallback criado_em, parcial no FE)

- **Problema**
  > Rodar a 0070 duas vezes, linha `settled` com `encerrado_em` NULL e `parcial` do SISPAG na página não têm caso.

- **Melhoria Proposta**
  > 1 caso de reexecução do backfill, 1 caso do fallback na view, 1 caso FE de semana parcial.

- **Resultado Esperado**
  > Casos SISPAG em PG real 4 -> 6; testes FE de SISPAG 2 -> 3.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Casos SISPAG na integração: 4 -> 6
- **Risco de não fazer**: baixo; lacuna residual.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta; suítes completas não reexecutadas (números do `_shared-metrics.md`). Cobertura % por diretório não coletada.
- Ponto forte: os casos exigidos (situacoes, CANCELADO, dry-run, erro, execução dupla, aceite tardio, outras frentes intactas, backfill) têm asserção em PG real em transação desfeita; nenhum P0/P1.
- Cross-QA: `agora` injetável (Modifiability); `test:sql` no CI (Deployability); fixtures de retorno SISPAG (Integrability).
