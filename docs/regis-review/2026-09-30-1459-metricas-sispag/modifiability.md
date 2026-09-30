---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-modifiability
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review

Escopo: delta de `fix/metricas-sispag` vs `origin/main`. Problemas pré-existentes fora do delta estão marcados como tal e não pontuam.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Acrescentar uma nova frente (ou métrica) às métricas do ciclo | `metricas.metricas_ciclo` (migration), `lib/metricas.ts`, `app/metricas/page.tsx` | Desenvolvimento, pipeline `/feature-new` | Mudança localizada, sem recopiar código não relacionado | Arquivos tocados por métrica nova; linhas copiadas sem alteração |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de produção tocados pelo delta | 4 (1 migration, 1 repo, 2 frontend) | localizado | ✅ | `git diff --stat origin/main HEAD` |
| Migration 0070 (LOC) | 264 | <= 600 | ✅ | `wc -l` |
| Definições completas de `metricas.metricas_ciclo` no histórico | 3 (0058, 0065, 0070) | 1 fonte viva | ⚠️ | `grep CREATE OR REPLACE src/backend/migrations` |
| Linhas divergentes 0065 -> 0070 (corpo da função, limite superior) | 95 linhas em diff textual (SISPAG CTE + chaves + comentários) | só o delta | ⚠️ | `diff` dos corpos |
| Pontos do frontend tocados por métrica nova | 5 (`METRICA`, KPI, `TableHead`, célula, skeleton) | 1 (registry) | ⚠️ | diff de `page.tsx` e `lib/metricas.ts` |
| `RemessaExecucaoRepository.ts` delta | +6 linhas, 2 UPDATEs | localizado | ✅ | diff |
| Violações de camada no delta | 0 | 0 | ✅ | leitura do diff |
| Ciclos de dependência introduzidos | 0 (nenhum import novo) | 0 | ✅ | diff |
| Testes do delta | repo unit (+3), migration unit + integration (Postgres real), page test | presente | ✅ | `_shared-metrics.md` |
| Cognitive complexity nova > 15 | 0 (lint sem erros; 75 warnings pré-existentes) | 0 | ✅ | `_shared-metrics.md` |
| Top-10 maiores arquivos / fan-in do repo inteiro | ⚠️ **Não medível no escopo**: gate de feature, não varredura do repo. Apêndices abaixo cobrem só o delta | — | ⚠️ | — |

### Apêndice A — maiores arquivos do delta

| # | Arquivo | LOC |
|---|---|---|
| 1 | `src/backend/migrations/0070_metricas_ciclo_sispag.sql` | 264 |
| 2 | `src/frontend/app/metricas/page.tsx` | 254 |
| 3 | `src/frontend/lib/metricas.ts` | 130 |
| 4 | `src/backend/migrations/vwMetricasCiclo.integration.test.ts` (teste, +167) | — |
| 5 | `RemessaExecucaoRepository.ts` (+6) | — |

### Apêndice B — fan-in dos módulos tocados

| Módulo | Dependentes | Observação |
|---|---|---|
| `metricas.metricas_ciclo` (função SQL) | view `vw_metricas_ciclo` + consumidor de métricas | contrato de 9 colunas preservado; CTEs antigas idênticas |
| `RemessaExecucaoRepository` | serviços SISPAG de remessa | mudança aditiva, assinatura inalterada |
| `METRICA` (frontend) | `page.tsx`, testes | consts aditivas |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | 0070 é uma função única (~215 linhas) com uma CTE por frente | ⚠️ parcial | `0070:50-264` |
| Increase Semantic Coherence | `encerrado_em` centraliza a "data do evento" nas frentes (ADR-0052); o repositório só carimba | ✅ presente | diff do repo |
| Encapsulate | contrato da função (9 colunas) estável; front lê por chave (`porChave`) | ✅ presente | header da 0070 |
| Use an Intermediary | função SQL entre tabelas e API; `porChave` no front | ✅ presente | 0058/0070 |
| Restrict Dependencies | nenhum import novo; sem GRANT/SECURITY DEFINER | ✅ presente | diff |
| Refactor | corpo inteiro recopiado por migration (3 cópias) | ⚠️ parcial | F-modifiability-1 |
| Abstract Common Services | lógica de semana/piso/grade repetida por CTE de frente, sem helper SQL | ⚠️ parcial | 0070 |
| Defer Binding (configuration files, polymorphism, registry) | chaves e colunas hardcoded no front; regra AGENDADO/PAGO no SQL | ⚠️ parcial | F-modifiability-2/3 |

## 4. Findings (achados)

### F-modifiability-1: Padrão "copiar a função inteira por migration" (CREATE OR REPLACE)

- **Severidade**: P2
- **Tactic violada**: Refactor / Abstract Common Services
- **Localização**: `src/backend/migrations/0058`, `0065`, `0070` (`metricas.metricas_ciclo`)
- **Evidência (objetiva)**:
  ```
  CREATE OR REPLACE FUNCTION metricas.metricas_ciclo em 3 migrations;
  diff 0065->0070: 95 linhas divergentes; 0070 tem 264 linhas
  ```
- **Impacto técnico**: cada frente nova exige recopiar ~215 linhas; a definição vigente só se descobre lendo a última migration; risco de a cópia reverter silenciosamente uma correção (a 0070 afirma "byte a byte" para Permutas/Recebimentos, garantido só por teste). Migrations são imutáveis, então o ônus é prospectivo. Padrão herdado (0058 -> 0065), a 0070 o repete.
- **Impacto de negócio**: custo por frente nova cresce linearmente; risco de regressão nos números de Permutas ao adicionar frentes.
- **Métrica de baseline**: 3 cópias; 95 linhas divergentes de ~215. Sem incidente registrado, portanto P2.

### F-modifiability-2: KPIs e colunas do histórico hardcoded por métrica no frontend

- **Severidade**: P2
- **Tactic violada**: Defer Binding
- **Localização**: `src/frontend/app/metricas/page.tsx:126-170, 188-217, 243-252`, `src/frontend/lib/metricas.ts:41-46`
- **Evidência (objetiva)**: adicionar SISPAG exigiu editar 5 pontos (const `METRICA`, `SimpleKPI` x2, `TableHead` x2, células x2, skeleton `length: 6`, `columns: 7`, `KPIGrid columns={2}`). Contagens do skeleton são números mágicos que podem divergir do conteúdo real.
- **Impacto técnico**: 5 pontos sincronizados à mão por métrica.
- **Impacto de negócio**: baixo (2 métricas por frente); esforço S por frente.
- **Métrica de baseline**: 5 edições por frente; 2 contagens de skeleton derivadas à mão.

### F-modifiability-3: Regra de aceite (AGENDADO/PAGO) embutida no SQL da função

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `0070_metricas_ciclo_sispag.sql` (CTE SISPAG)
- **Evidência (objetiva)**: `situacao` em {AGENDADO, PAGO} como literal; mudar exige nova migration (F-1). Rigidez intencional (ADR-0056: série recalculável, decisão do ColettoG).
- **Impacto técnico**: mudança de regra = nova migration com recópia.
- **Impacto de negócio**: raro.
- **Métrica de baseline**: 2 literais de status; 0 configuráveis.

Pontos positivos sem finding: no repositório, `CASE ... status = 'settled'` imobiliza o 1º encerramento com +6 linhas, testado; nenhum acoplamento novo entre camadas; backfill documentado e reversível (10 linhas).

## 5. Cards Kanban

### [modifiability-1] Isolar a definição de cada frente em metricas_ciclo

- **Problema**
  > Cada frente nova recopia a função inteira (3 cópias, 264 linhas na última) e a versão vigente só se descobre lendo a migration mais recente.
- **Melhoria Proposta**
  > Refactor: extrair cada frente para função SQL própria (`metricas.frente_permutas(...)`, `frente_sispag(...)`) e deixar `metricas_ciclo` como união. A próxima frente edita só a função dela. Alternativa mínima: teste de contrato comparando as CTEs antigas com a versão anterior.
- **Resultado Esperado**
  > Nova frente = 1 função nova + 1 linha na união, sem recopiar CTEs alheias.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1, F-modifiability-3
- **Métricas de sucesso**:
  - Linhas recopiadas por nova frente: ~215 -> < 40
- **Risco de não fazer**: a próxima frente adiciona nova cópia de ~250 linhas e mais risco de regressão em Permutas.
- **Dependências**: nenhuma; fazer junto com a próxima frente de métrica.

### [modifiability-2] Registry de métricas no frontend

- **Problema**
  > KPIs, colunas do histórico e skeleton são escritos à mão por métrica (5 pontos por frente).
- **Melhoria Proposta**
  > Defer Binding: array `FRENTES = [{titulo, pctKey, rsKey, rotulo}]` em `lib/metricas.ts`; `page.tsx` mapeia KPI, colunas e skeleton (`length`/`columns` derivados) a partir dele.
- **Resultado Esperado**
  > Nova frente = 1 entrada no array.
- **Tactic alvo**: Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Pontos editados por frente: 5 -> 1
- **Risco de não fazer**: divergência skeleton/tabela a cada frente nova; custo pequeno mas recorrente.
- **Dependências**: nenhuma.

### [modifiability-3] Teste que amarra as chaves do frontend às da função SQL

- **Problema**
  > As chaves (`sispag_titulos_aceitos_pct`, ...) existem em dois lugares (SQL e `METRICA`) sem verificação cruzada.
- **Melhoria Proposta**
  > Encapsulate: teste que compara o conjunto de chaves devolvido pela função (test:sql) com `METRICA`, nos dois sentidos.
- **Resultado Esperado**
  > Chave renomeada num lado quebra o CI, não a tela.
- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Chaves com verificação cruzada: 0 -> 10
- **Risco de não fazer**: KPI mostra "—" silenciosamente após renomear.
- **Dependências**: modifiability-2 (opcional).

## 6. Notas do agente

- Escopo restrito ao delta; top-10 arquivos e fan-in do repo inteiro não foram varridos (não atribuíveis ao delta), apêndices refletem só o delta.
- "95 linhas divergentes" vem de `diff` textual (inclui comentários/reindentação), limite superior do delta real.
- Cross-QA: F-1 liga a Testability (equivalência das CTEs antigas só garantida por teste) e Deployability (migrations imutáveis; rollback = reaplicar a função da 0065).
- Score 7: delta localizado e testado, sem violação de camada; reduzido por sincronização manual repetida (SQL e front).
