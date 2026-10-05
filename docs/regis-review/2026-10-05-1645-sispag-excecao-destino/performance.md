---
qa: Performance
qa_slug: performance
run_id: 2026-10-05-1645
agent: qa-performance
generated_at: 2026-10-05T16:45:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG / job de varredura | Finalizar lote com N favorecidos distintos; varredura de K exceções APROVADAS | `DestinoPagamentoResolver`, `SispagPainelService.ofertaComResolver`, `ExcecaoDestinoService.aposentarSubstituidas` | Express/Render hoje, flags TED/PIX/exceção ligadas, Conexos 2-10s p99 | Resolver custa no máximo 1 leitura extra de DB por (favorecido, tipo), memoizada; nenhuma leitura Conexos extra | Leituras Conexos por finalizar = as de antes da feature; `findAprovada` ≤ 2 por favorecido por fluxo; job de K exceções termina em < 5 min |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Leituras Conexos extras introduzidas pela feature (painel/finalizar) | 0 (exceção só lê o DB local; cmn025 já era lido pelo cadastro) | 0 | ✅ | `DestinoPagamentoResolver.ts` (`excecao`, `cadastroVence`, `aprovada`) |
| `findAprovada` por favorecido por fluxo | ≤ 2 (1 por tipo CONTA/PIX, memo `excecao:${pesCod}:${tipo}`) | ≤ 2 | ✅ | `DestinoPagamentoResolver.ts` `aprovada`/`memo` |
| `findAprovada` no painel (leitura) | só no miss do cadastro (`aposentarExcecao` desligado); finalizar liga e consulta também no hit | n/d | ⚠️ | `SispagPainelService.ts:504-525` |
| Índice para `findAprovada` (pes_cod, tipo, estado='APROVADA') | `ux_excecao_destino_aprovada` parcial UNIQUE (cobre exatamente o predicado) | índice | ✅ | `migrations/0075_...sql:99-101` |
| Índice redundante | `idx_excecao_destino_favorecido (pes_cod,tipo,estado)` sobrepõe o parcial | sem redundância | ⚠️ (P3, escrita baixa) | `0075...sql:103` |
| `listAprovadas` / `list` sem LIMIT | 1 site (varredura do job); tabela pequena e limitada pelo UNIQUE parcial (≤ 2 por favorecido) | 0 em API/SQS | ⚠️ (job apenas, não API) | `ExcecaoDestinoRepository.ts:185-197` |
| Concorrência da varredura | 1 (laço sequencial `for … await`); 1 cmn025 por exceção (+1 documento no PIX com chave CPF/CNPJ) | limitada, 4 como no painel | ❌ | `ExcecaoDestinoService.ts:179-215` |
| Concorrência do painel/finalizar | `BoundedConcurrency` limite 4 | 4 | ✅ | `SispagPainelService.ts:69,511-533` |
| Timer manual (setTimeout/setInterval) no escopo | 0 | 0 | ✅ | grep no escopo |
| Contagem de exceções no painel | 2 queries agregadas (GROUP BY + count) por render do painel; falha omitida | ≤ 2, tolerante | ✅ | `SispagPainelService.ts:229-247` |

> ⚠️ **Não medível localmente**: latência p95 do finalizar/painel e duração real da varredura. Requer produção/Conexos. Recomendação: logar `duracaoMs` e `leiturasConexos` em `aposentarSubstituidas` e no finalizar.
> ⚠️ **Não medível**: cold start e bundle (runtime Express/Render, sem Lambda nem `infra/`); `pg Pool` não varia na feature.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — a varredura é manual/sem scheduler (sem frequência a regular) | N/A | `jobs/aposentar-excecoes-substituidas.ts` |
| Limit Event Response | Falha ao aposentar nunca bloqueia; leitura falha = "não oferece" | ✅ | `cadastroVence` try/catch |
| Prioritize Events | N/A — sem filas nesta feature | N/A | — |
| Reduce Overhead | Memo por fluxo (`CacheCadastroDestino`) evita leituras repetidas por favorecido | ✅ | `DestinoPagamentoResolver.ts memo` |
| Bound Execution Times | Fan-out limitado a 4; job sem teto de tempo nem de nº de exceções | ⚠️ | `ExcecaoDestinoService.ts:174` |
| Increase Resource Efficiency | Índice parcial exato; `GROUP BY` agregado em vez de N contagens | ✅ | `0075...sql:99` |
| Increase Resources | N/A (Render) | N/A | — |
| Increase Concurrency | Painel sim (4); job sequencial | ⚠️ | idem |
| Maintain Multiple Copies of Computations | N/A | N/A | — |
| Maintain Multiple Copies of Data | Memo por requisição; sem cache entre requisições (deliberado: cadastro AO VIVO, I10b) | ✅ | docstring do resolver |
| Bound Queue Sizes | N/A — sem SQS | N/A | — |
| Schedule Resources | Job fora do horário de pico, manual | ⚠️ | docstring do job |
| Index discipline | Parcial UNIQUE + estado/favorecido + audit | ✅ | `0075...sql:99-123` |
| Cold start / bundle | Não aplicável hoje | N/A | — |

## 4. Findings

### F-performance-1: Varredura de aposentadoria é sequencial, sem limite e sem medição

- **Severidade**: P2 (sem número de produção; estimativa abaixo não basta para P1)
- **Tactic violada**: Increase Concurrency / Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/ExcecaoDestinoService.ts:174-215`
- **Evidência (objetiva)**:
  ```
  for (const e of aprovadas) { ... await this.resolver.resolve(...) ... await this.repo.getById(e.id) }
  ```
- **Impacto técnico**: K exceções = K leituras cmn025 em série (+K documento no PIX). Estimativa: K=200 × 2s ≈ 400s; no p99 (10s) ≈ 33 min. Cresce linearmente com exceções, sem teto. Cache só ajuda favorecido repetido.
- **Impacto de negócio**: varredura lenta atrasa a aposentadoria; rodando à mão, o operador não sabe se travou.
- **Métrica de baseline**: 1 cmn025/exceção, concorrência 1 (K hoje desconhecido: tabela nova).

### F-performance-2: Finalizar paga o `findAprovada` mesmo quando o cadastro vence

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `DestinoPagamentoResolver.ts` `cadastroVence`/`aprovada`; `LotePagamentoService.ts:392-394`
- **Evidência (objetiva)**: com `aposentarExcecao` + flag, cada favorecido com cadastro válido gera 1 `SELECT ... estado='APROVADA'` por tipo (índice parcial, memoizado).
- **Impacto técnico**: ≤ 2 selects indexados por favorecido distinto; ~1-3 ms cada, ordens de grandeza abaixo de um cmn025. Ocorre uma vez por finalizar, não por render.
- **Impacto de negócio**: desprezível hoje.
- **Métrica de baseline**: ≤ 2 queries/favorecido (analítico, não medido em produção).

### F-performance-3: `list`/`listAprovadas` sem LIMIT e filtro `($x IS NULL OR col=$x)`

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `ExcecaoDestinoRepository.ts:185-197`
- **Evidência (objetiva)**: `WHERE ($estado::text IS NULL OR estado = $estado) ... ORDER BY cadastrado_em DESC, id` sem LIMIT; o padrão `IS NULL OR` impede o planner de usar `idx_excecao_destino_estado` em plano genérico.
- **Impacto técnico**: seq scan de tabela pequena hoje; se a rota de listagem do painel de exceções for exposta sem paginação, cresce com o histórico (REJEITADA/SUBSTITUIDA acumulam).
- **Impacto de negócio**: baixo até a tabela passar de milhares de linhas.
- **Métrica de baseline**: 1 selectMany sem LIMIT na feature; contagem de linhas não medível (sem produção).

### F-performance-4: Índice duplicado `idx_excecao_destino_favorecido`

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `migrations/0075_sispag_excecao_destino.sql:99-104`
- **Evidência (objetiva)**: `(pes_cod,tipo,estado)` é prefixo-útil igual ao parcial `(pes_cod,tipo) WHERE estado='APROVADA'`; serve só a `list({pesCod})`.
- **Impacto técnico**: custo de escrita extra desprezível (escrita rara). Mantê-lo é defensável.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 3 índices na tabela principal, 1 efetivamente redundante para a leitura quente.

## 5. Cards Kanban

### [performance-1] Limitar a concorrência e instrumentar a varredura de exceções

- **Problema**
  > `aposentarSubstituidas` lê o cmn025 de cada exceção APROVADA em série e não registra duração. Com K crescendo, o tempo é linear (K=200 a 2s ≈ 400s; p99 10s ≈ 33 min).
- **Melhoria Proposta**
  > Usar `BoundedConcurrency` (limite 4, igual ao painel) agrupando por (pesCod, filCod) para ler cada favorecido uma só vez; logar `duracaoMs` e nº de leituras Conexos no log final. Cuidado: `cache` é compartilhado, então manter as escritas de `aposentar` idempotentes.
- **Resultado Esperado**
  > Varredura de K=200 exceções: ~400s → ≤ 120s (concorrência 4); duração e contagem de leituras visíveis no log.
- **Tactic alvo**: Increase Concurrency / Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Tempo da varredura (K=200, 2s/leitura): ~400s → ≤ 120s
  - Log com `duracaoMs`: ausente → presente
- **Risco de não fazer**: em 6 meses a varredura leva dezenas de minutos e ninguém sabe se travou.
- **Dependências**: nenhuma.

### [performance-2] Paginar `list` de exceções e trocar o filtro nulo por WHERE dinâmico

- **Problema**
  > `list`/`listAprovadas` não têm LIMIT e usam `($x IS NULL OR …)`, que não aproveita índice com plano genérico; REJEITADA/SUBSTITUIDA acumulam.
- **Melhoria Proposta**
  > Aplicar o Dynamic WHERE do CLAUDE.md com `LIMIT/OFFSET` na listagem exposta pela rota; manter sem LIMIT só a varredura do job, com `estado='APROVADA'` literal (usa o índice parcial).
- **Resultado Esperado**
  > Listagem do painel: 0 selects sem LIMIT em caminho de API; `EXPLAIN` da listagem por estado = Index Scan (hoje não verificado).
- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - `# selectMany sem LIMIT` em API: 1 → 0
- **Risco de não fazer**: listagem degrada de forma silenciosa conforme o histórico cresce.
- **Dependências**: nenhuma.

### [performance-3] Pular `findAprovada` quando o favorecido não tem exceção (opcional)

- **Problema**
  > O finalizar consulta `findAprovada` para todo favorecido cujo cadastro vence (≤ 2 queries/favorecido).
- **Melhoria Proposta**
  > Carregar uma vez o conjunto de `pes_cod` com exceção APROVADA (1 query) no início do fluxo e consultar o Set; remover o índice redundante `idx_excecao_destino_favorecido` só se a listagem não o usar.
- **Resultado Esperado**
  > Queries de exceção por finalizar de N favorecidos: ≤ 2N → 1.
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2, F-performance-4
- **Métricas de sucesso**:
  - Queries `excecao_destino` por finalizar (N=50): ≤ 100 → 1
- **Risco de não fazer**: nenhum relevante; ganho marginal.
- **Dependências**: [performance-2] para decidir sobre o índice.

## 6. Notas do agente

- Escopo: resolver, painel, finalizar, repositório, migration 0075 e job. Sem Lambda/infra: cold start, bundle, SQS e pool não se aplicam (N/A).
- Sem P0/P1: não há baseline de produção (tabela nova). A feature não adiciona leitura Conexos, e a memoização limita o DB a ≤ 2 queries por favorecido.
- Cross-QA: timeout do `ConexosSispagClient` (não confirmado no escopo) é do qa-availability/fault-tolerance; a política de varredura sem scheduler é do qa-deployability; o schema como código (0075) é do qa-modifiability.
