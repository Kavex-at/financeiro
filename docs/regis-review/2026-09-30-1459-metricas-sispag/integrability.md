---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-integrability
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 2
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex / skill externa `kavex-report-ciclo` | Nova frente (SISPAG) entra em `GET /metricas/ciclo`; sync ADR-0055 do Conexos passa a alimentar a métrica | Migration 0070 (`metricas.metricas_ciclo`), `RemessaExecucaoRepository`, `page.tsx`/`lib/metricas.ts` | Produção, série semanal com consumidores externos | Adicionar a frente sem quebrar consumidores existentes; dependência do dado do Conexos explícita e degradando com graça | 0 consumidores quebrados; 2 chaves novas aditivas; arquivos tocados fora da view ≤ 3 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chaves novas no contrato `/metricas/ciclo` | 2 (`sispag_titulos_aceitos_pct`, `sispag_valor_aceito`), aditivas | aditivas, sem renomear | ✅ | `0070_metricas_ciclo_sispag.sql:222-241` |
| Arquivos fora da migration para o frontend expor 1 frente nova | 3 (`lib/metricas.ts`, `page.tsx`, teste) | ≤ 3 | ✅ | `git diff --stat` |
| Chamadas HTTP novas no delta | 0 (só `apiFetch` existente) | wrapper único | ✅ | `lib/metricas.ts:60` |
| Versionamento explícito do contrato `/metricas/ciclo` | ausente (sem `/v1`, sem campo de versão) | presente | ⚠️ pré-existente | `routes/metricas.ts:44` |
| Validação Zod da resposta no frontend (`lib/metricas.ts`) | 0 (chaves lidas por string) | ≥ 1 no boundary | ⚠️ pré-existente | `lib/metricas.ts` |
| Teste contra Postgres real do novo acoplamento (`situacao`) | 48 testes `test:sql` verdes | presente | ✅ | `_shared-metrics.md` |
| Semanas com dado da dependência externa (aceite) | 0 aceitos em 2 semanas (13 títulos enviados) | > 0 após 1º sync | ⚠️ | `_shared-metrics.md` |
| Novas integrações externas / clients no delta | 0 | — | ✅ | `git diff` |
| Métricas A/B/C do plano (clients genéricos, axios, Zod em clients, SSM) | Não medível no delta | — | ⚠️ Não medível: delta não toca clients; medir no full-repo review | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | A view lê `lote_pagamento_item.situacao`, escrito pelo sync Conexos (ADR-0055); o Conexos não vaza para a view, só o estado local persistido | ✅ presente | `0070...sql:125-135` |
| Use an Intermediary | Tabela local `lote_pagamento_item` faz de intermediária entre Conexos e a métrica | ✅ presente | `0070...sql:125` |
| Restrict Communication Paths | Métrica só lê banco; nenhum novo caminho ao Conexos | ✅ presente | `0070...sql` |
| Adhere to Standards | ADR-0052 (datar por encerramento) estendida ao SISPAG | ✅ presente | `RemessaExecucaoRepository.ts:180-183` |
| Abstract Common Services | `encerrado_em` reaproveita o padrão da 0065 (permutas) | ✅ presente | `0070...sql:38-47` |
| Discover Service | N/A — sem novo endpoint/serviço a descobrir | N/A | delta sem infra |
| Tailor Interface | Chaves novas aditivas; front indexa por `porChave`, ignora o que não conhece | ✅ presente | `page.tsx:156-168` |
| Configure Behavior | N/A — sem parâmetro configurável novo (lista {AGENDADO, PAGO} fixa em SQL) | ⚠️ parcial | `0070...sql` (2 ocorrências de `IN ('AGENDADO','PAGO')`) |
| Manage Resources | N/A — sem recurso de integração novo | N/A | — |
| Orchestrate | N/A — sem orquestração nova | N/A | — |
| Manage Resource Coupling | Acoplamento temporal: métrica depende do cron `sincronizar-lotes-sispag`; semana fica sem aceite até rodar, e a nota do frontend/ADR explica | ⚠️ parcial | `page.tsx` tooltip; `_shared-metrics.md` |
| Contract testing | Testes do SQL (unit + integração PG17); nenhum teste pina o JSON de `/metricas/ciclo` consumido pela skill externa | ⚠️ parcial | `vwMetricasCiclo.integration.test.ts` |
| Versioning strategy | Ausente para o contrato de métricas (pré-existente) | ❌ ausente | `routes/metricas.ts:44` |
| Backward-compatibility shims | Não necessários: `CREATE OR REPLACE` com colunas/linhas aditivas; reversão documentada na migration | ✅ presente | `0070...sql:25-28` |
| Observability of integration failures | Sem métrica/alerta se o sync parar de escrever `situacao` (semana fica silenciosamente 0%/NULL) | ⚠️ parcial | F-integrability-1 |

## 4. Findings

### F-integrability-1: Métrica SISPAG depende do cron de sync sem sinal de defasagem

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling / Observability of integration failures
- **Localização**: `src/backend/migrations/0070_metricas_ciclo_sispag.sql:125-160`
- **Evidência (objetiva)**:
  ```
  Leitura read-only em produção: 25/09-02/10 = 11 títulos, 0 aceitos (situacao NULL até o cron rodar)
  ```
- **Impacto técnico**: se o cron falhar (há precedente: Bad Credentials congelou a carteira em 23/09), a view devolve 0% indistinguível de "banco rejeitou tudo".
- **Impacto de negócio**: a skill de report semanal pode publicar "0% aceitos" errado ao gestor.
- **Métrica de baseline**: 11 de 11 títulos da semana corrente sem `situacao` no momento da leitura.

### F-integrability-2: Contrato `/metricas/ciclo` consumido por skill externa sem teste de contrato nem versão (pré-existente, ampliado)

- **Severidade**: P2
- **Tactic violada**: Contract testing / Versioning strategy
- **Localização**: `src/backend/routes/metricas.ts:44`, `src/frontend/lib/metricas.ts:59`
- **Evidência (objetiva)**:
  ```
  chaves lidas por string literal (METRICA.SISPAG_PCT = 'sispag_titulos_aceitos_pct'); 0 schemas Zod; 0 fixture JSON do payload
  ```
- **Impacto técnico**: renomear uma chave no SQL quebra front e skill sem falha de build; o delta soma 2 chaves ao conjunto sem rede.
- **Impacto de negócio**: report semanal com campo vazio, descoberto só na leitura humana.
- **Métrica de baseline**: 2 consumidores (frontend, kavex-report-ciclo), 0 testes de contrato; 2 chaves novas no total.

### F-integrability-3: Lista de situações "aceitas" duplicada em SQL

- **Severidade**: P3
- **Tactic violada**: Configure Behavior
- **Localização**: `src/backend/migrations/0070_metricas_ciclo_sispag.sql` (2× `IN ('AGENDADO', 'PAGO')`)
- **Evidência (objetiva)**: `vwMetricasCiclo.test.ts:297` exige exatamente 2 ocorrências, ou seja, a duplicação é conhecida e travada por teste.
- **Impacto técnico**: novo status do banco/Conexos exige editar duas cláusulas em nova migration.
- **Impacto de negócio**: desprezível hoje.
- **Métrica de baseline**: 2 ocorrências.

## 5. Cards Kanban

### [integrability-1] Pinar o contrato de `/metricas/ciclo` com teste de fixture

- **Problema**
  > O payload é consumido pelo frontend e pela skill `kavex-report-ciclo` por chaves em string, sem schema nem fixture; o delta adiciona 2 chaves nesse conjunto.

- **Melhoria Proposta**
  > Teste de contrato (Contract testing) em `routes/metricas.test.ts` com fixture JSON contendo as chaves esperadas, e Zod no `fetchMetricasCiclo` (`lib/metricas.ts`) que tolere chaves desconhecidas. Registrar as chaves como contrato no ADR-0056.

- **Resultado Esperado**
  > Renomear uma chave quebra o CI. 0 testes de contrato → 1 fixture cobrindo todas as chaves de `METRICA`.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Chaves do contrato cobertas por teste: 0 → 100% (`METRICA`)
- **Risco de não fazer**: renomeação silenciosa quebra o report semanal.
- **Dependências**: nenhuma

### [integrability-2] Sinalizar defasagem do sync no rótulo da métrica SISPAG

- **Problema**
  > Semana sem `situacao` sincronizada aparece como 0% aceito, indistinguível de rejeição total (11/11 títulos sem situação na leitura de 30/09).

- **Melhoria Proposta**
  > Expor na view a contagem de títulos com `situacao IS NULL` no rótulo (ex.: "0 de 11 (11 aguardando sync)") ou não emitir o % enquanto houver pendentes; alerta via Observability existente se o cron ficar parado.

- **Resultado Esperado**
  > Consumidores distinguem "sem dado" de "rejeitado". Semanas ambíguas: hoje 1 de 2 → 0.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1, F-integrability-3
- **Métricas de sucesso**:
  - Títulos sem situação visíveis no rótulo: não → sim
- **Risco de não fazer**: report errado ao gestor após nova falha de credencial do cron.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo só no delta; nenhum client novo, então as métricas A/B/C do plano não se aplicam (não medível no delta).
- Ausência de versionamento/Zod no contrato de métricas é pré-existente; por isso F-integrability-2 é P2 e não P1.
- Cross-QA: F-integrability-1 sobrepõe Availability/Fault Tolerance (cron de sync); F-integrability-2 sobrepõe Testability.
