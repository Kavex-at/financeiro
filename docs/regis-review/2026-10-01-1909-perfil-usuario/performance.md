---
qa: Performance
qa_slug: performance
run_id: 2026-10-01-1909-perfil-usuario
agent: qa-performance
generated_at: 2026-10-01T19:30:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao feature /perfil)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/perfil` (e trocando período/filtros) | 1 carga da página = `GET /me/perfil` + `/me/atividade` + `/me/historico` em paralelo; cada troca de período dispara 2 consultas de agregados | `AtividadeUsuarioRepository` (HISTORICO_SQL 11 ramos, AGREGADOS_SQL), pool pg (max 5), `/perfil` no Next | Operação normal; ledgers de centenas de linhas hoje, crescendo com o uso | Responder dentro do orçamento sem monopolizar o pool, mantendo plano por índice quando as tabelas crescerem | p95 `/me/historico` ≤ 200 ms e `/me/atividade` ≤ 300 ms; ≤ 4 conexões simultâneas por carga de página |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Execution Time histórico (30d, 11 ramos, prod, sem 0072) | ~0,55 ms (123 buffers) | ≤ 200 ms | ✅ | `docs/perfil-usuario/explain.md` |
| Execution Time agregados (1 semana, prod) | ~0,5 ms (193 buffers) | ≤ 300 ms | ✅ | `docs/perfil-usuario/explain.md` |
| Ramos do histórico com índice (ator, tempo) disponível | 11/11 (provado local com `enable_seqscan=off`) | 11/11 | ✅ | `explain.md`, `0072_idx_atividade_usuario.sql:23-58` |
| Índices novos na 0072 | 11 (`CREATE INDEX IF NOT EXISTS`, sem CONCURRENTLY) | n/a | ⚠️ lock desprezível em centenas de linhas | `0072_idx_atividade_usuario.sql` |
| Queries de agregados por requisição `/me/atividade` | 2 (atual + período anterior), em `Promise.all` | 2 em paralelo, cache curto | ⚠️ | `PerfilService.ts:123-137` |
| `selectMany` sem LIMIT no delta | 0 (`LIMIT $limit`, página 25+1) | 0 | ✅ | `AtividadeUsuarioRepository.ts:201`, `PerfilService.ts:32,170` |
| N+1 no delta | 0 (um SELECT por rota; subselects `SUM` por linha limitadas ao ator/janela) | 0 | ✅ | `AtividadeUsuarioRepository.ts:86,113` |
| Pool pg max | 5 (compartilhado com todo o servidor Express) | folga para 3 rotas paralelas + restante | ⚠️ | `PostgreeDatabaseClient.ts:37,106` |
| Requisições do `/perfil` no mount | 3 (perfil, atividade, histórico); +1 atividade se o período salvo em localStorage difere do padrão | ≤ 3 | ⚠️ | `AtividadeSection.tsx:113-145`, `HistoricoSection.tsx:147-163`, `page.tsx:31-47` |
| Cache-Control das rotas `/me/*` | `no-store` | aceitável (dados pessoais) | ✅ | `routes/me.ts:53,97` |
| Dependências runtime novas no delta (backend) | 0 | ≤ 15 backend | ✅ | `_shared-metrics.md` |
| Timers manuais / busy loops no delta | 0 | 0 | ✅ | leitura do delta |
| Bundle Lambda / cold start / SQS / axios timeouts / First Load JS | ⚠️ **Não medível localmente**: Express sem `infra/`; `--quick` não roda `next build`. O delta não adiciona cliente externo nem handler SQS. Recomendação: medir `next build` no PR de release. | — | n/a | CLAUDE.md (layout) |

## 3. Tactics — Cobertura no feature /perfil

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — leitura sob demanda, sem polling | N/A | não há timers no delta |
| Limit Event Response | Sem debounce explícito nos filtros do histórico; cancelamento só por flag `vivo`, não aborta a requisição | ⚠️ parcial | `HistoricoSection.tsx:147-163` |
| Prioritize Events | N/A — sem filas no delta | N/A | — |
| Reduce Overhead | Filtro de ator e janela dentro de cada ramo; normalização no SQL; agregados numa ida ao banco; sem ORM | ✅ presente | `AtividadeUsuarioRepository.ts:19-23,212` |
| Bound Execution Times | Janela limitada (`janelaHistorico`, padrão 30 dias); página 25; cursor ≤ 512 chars. Sem `statement_timeout` específico | ⚠️ parcial | `PeriodoPerfil.ts:111-121`, `PerfilQuerySchemas.ts:34` |
| Increase Resource Efficiency | Keyset (sem OFFSET); 11 índices (ator, tempo), parciais onde o ator é anulável; índice de expressão `COALESCE` casando com o predicado | ✅ presente | `0072_idx_atividade_usuario.sql`, `AtividadeUsuarioRepository.ts:198-200` |
| Increase Resources | N/A — Render/Supabase, sem escala no delta | N/A | — |
| Increase Concurrency | Atual e anterior em `Promise.all`; identidade/fontes em `Promise.all` | ✅ presente (custo: 2 conexões do pool de 5) | `PerfilService.ts:92,124` |
| Maintain Multiple Copies of Computations | Nenhum cache de agregados; período anterior fechado é imutável e recomputado a cada visita | ⚠️ ausente | `PerfilService.ts:123-137` |
| Maintain Multiple Copies of Data | N/A — sem réplica de leitura | N/A | — |
| Bound Queue Sizes | N/A — sem filas | N/A | — |
| Schedule Resources | N/A | N/A | — |
| Cold start budget / Bundle leanness | Não medível (sem Lambda); delta sem libs pesadas novas no backend | n/a | `_shared-metrics.md` |
| Cache strategy | Período salvo em localStorage por usuário; resposta `no-store`; sem memoização no servidor | ⚠️ parcial | `AtividadeSection.tsx:113-122` |
| Index discipline | Migration versionada no repo com rollback; EXPLAIN com a 0072 só em banco local | ✅ presente | `0072_*.sql`, `rollbacks/0072_*.rollback.sql` |

## 4. Findings (achados)

### F-performance-1: Período anterior recomputado a cada requisição (dobra as consultas de agregados)

- **Severidade**: P3
- **Tactic violada**: Maintain Multiple Copies of Computations
- **Localização**: `src/backend/domain/service/perfil/PerfilService.ts:123-137`; `AtividadeUsuarioRepository.ts:212-316`
- **Evidência (objetiva)**:
  ```
  const [agAtual, agAnterior] = await Promise.all([ agregados(atual), agregados(anterior) ])
  EXPLAIN prod: agregados ~0,5 ms / 193 buffers por chamada
  ```
- **Impacto técnico**: 2 consultas por requisição, cada uma com 3 CTEs e vários subselects, e 2 conexões simultâneas do pool de 5. Hoje o custo é irrisório (~1 ms somado).
- **Impacto de negócio**: nenhum hoje; só importa se os ledgers crescerem ordens de grandeza.
- **Métrica de baseline**: ~0,5 ms por consulta × 2; sem problema mensurável (por isso P3).

### F-performance-2: Pool de 5 conexões com rajada de rotas por carga de página

- **Severidade**: P2
- **Tactic violada**: Increase Concurrency (dimensionamento) / Bound Execution Times
- **Localização**: `PostgreeDatabaseClient.ts:37,106`; `PerfilService.ts:92,124`; `page.tsx:31`, `AtividadeSection.tsx:131`, `HistoricoSection.tsx:147`
- **Evidência (objetiva)**:
  ```
  poolMaxConnections = 5
  mount de /perfil: perfil (2 queries em paralelo) + atividade (2) + histórico (1) = até 5 consultas simultâneas
  ```
- **Impacto técnico**: uma única carga pode ocupar as 5 conexões por alguns ms e enfileirar o resto do servidor (que também atende permutas/SISPAG). Com consultas de ~1 ms a janela é minúscula; vira problema se a latência subir.
- **Impacto de negócio**: risco baixo hoje; contenção apareceria como lentidão em telas de operação.
- **Métrica de baseline**: pico teórico 5/5 conexões por carga de `/perfil`, duração estimada < 10 ms. Não medido sob concorrência real, portanto P2.

### F-performance-3: Segunda busca de atividade quando o período salvo difere do padrão, sem abort

- **Severidade**: P3
- **Tactic violada**: Limit Event Response
- **Localização**: `AtividadeSection.tsx:113-145`; `HistoricoSection.tsx:147-163`
- **Evidência (objetiva)**:
  ```
  consulta inicia em PERIODO_PADRAO; useEffect lê localStorage e chama setConsulta(salvo)
  -> 1º fetch (padrão) descartado por `vivo=false`, mas o servidor já executou 2 agregados
  ```
- **Impacto técnico**: usuários com preferência não-padrão pagam 2 consultas de agregados extras (4 no total) a cada carga; a requisição descartada não é abortada.
- **Impacto de negócio**: desperdício marginal; a leitura pós-hidratação é decisão consciente (comentário no código).
- **Métrica de baseline**: +1 requisição `/me/atividade` (≈ +1 ms de banco) por carga para quem tem período salvo.

### F-performance-4: Plano com os índices da 0072 só observado em banco local com `enable_seqscan=off`

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency (evidência de índice)
- **Localização**: `docs/perfil-usuario/explain.md`; `0072_idx_atividade_usuario.sql`
- **Evidência (objetiva)**:
  ```
  prod: Seq Scan em 9 de 11 ramos (0072 ainda não aplicada), 0,553 ms
  local: índices usados com enable_seqscan=off, ~0,5 ms
  ```
- **Impacto técnico**: o plano com a 0072 não foi observado em prod nem com volume sintético. O `ORDER BY` global ordena todas as linhas dos 11 ramos na janela antes do LIMIT (Sort sobre o Append, sem top-N por ramo). Para um único ator em 30 dias isso é pequeno.
- **Impacto de negócio**: nenhum hoje.
- **Métrica de baseline**: Sort de 11 linhas (Memory 25kB) em prod; sem volume sintético, o ponto de inflexão é desconhecido.

## 5. Cards Kanban

### [performance-1] Medir /perfil sob volume sintético e com a 0072 aplicada em prod

- **Problema**
  > O EXPLAIN de prod foi tirado sem a 0072 e o plano com índices só foi provado em banco local com `enable_seqscan=off`. Não sabemos em que volume o `Sort` global sobre o `Append` de 11 ramos passa a pesar.

- **Melhoria Proposta**
  > Após a 0072 em prod, repetir `validate-perfil-usuario-v1.ts --historico --explain`; em staging, popular os ledgers com 100 mil linhas por tabela (usuário com 5 mil eventos em 30 dias) e registrar plano e p95 de `/me/historico` e `/me/atividade`. Se o p95 estourar, empurrar `ORDER BY ... LIMIT` para dentro de cada ramo. Tactic: Increase Resource Efficiency.

- **Resultado Esperado**
  > Evidência de plano por índice em 11/11 ramos e p95 documentado: hoje ~0,55 ms (centenas de linhas) → ≤ 50 ms com 100 mil linhas por tabela.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Ramos com índice no plano de prod: 0/11 (0072 não aplicada) → 11/11 (ou Seq Scan justificado pelo volume)
  - Execution Time do histórico com 100 mil linhas por tabela: não medido → ≤ 50 ms
- **Risco de não fazer**: a degradação aparece primeiro como lentidão no `/perfil` de quem mais usa a plataforma, sem alerta.
- **Dependências**: 0072 aplicada em prod

### [performance-2] Reduzir a rajada de conexões e consultas redundantes no mount de /perfil

- **Problema**
  > O mount dispara até 5 consultas simultâneas contra um pool de 5, e quem tem período salvo gera uma busca de atividade descartada (2 agregados inúteis).

- **Melhoria Proposta**
  > Adiar o fetch de atividade até a preferência do localStorage ser lida (sem fetch com o período padrão antes disso) e usar `AbortController` nos `useEffect` de busca. Opcionalmente, unir `agregados(atual)` e `agregados(anterior)` num único SQL (duas janelas, uma ida ao banco) para usar 1 conexão. Tactic: Limit Event Response / Reduce Overhead.

- **Resultado Esperado**
  > Requisições `/me/atividade` por carga com período salvo: 2 → 1; conexões simultâneas de pico por carga: 5 → ≤ 4.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2, F-performance-3
- **Métricas de sucesso**:
  - `/me/atividade` por carga com período salvo: 2 → 1
  - Conexões de pool no pico por carga: 5 → ≤ 4
- **Risco de não fazer**: contenção do pool compartilhado se a latência do Supabase subir; custo pequeno, mas cresce com o número de analistas.
- **Dependências**: nenhuma

### [performance-3] Memoizar agregados de períodos fechados (período anterior)

- **Problema**
  > O período anterior é imutável quando fechado, mas é recalculado em toda visita, dobrando as consultas de agregados.

- **Melhoria Proposta**
  > Cache em memória por `(username, inicio, fim)` com TTL (ex.: 10 min) apenas para períodos cujo `fim` já passou; o período atual segue sem cache. Só implementar se o p95 de `/me/atividade` passar de 100 ms após o card performance-1. Tactic: Maintain Multiple Copies of Computations.

- **Resultado Esperado**
  > Consultas de agregados por requisição: 2 → 1 em visitas repetidas (taxa de acerto ≥ 50%); p95 de `/me/atividade` mantido ≤ 100 ms sob volume sintético.

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Agregados executados por requisição com cache quente: 2 → 1
- **Risco de não fazer**: baixo; custo desprezível nos volumes atuais.
- **Dependências**: performance-1 (decidir com número)

## 6. Notas do agente

- Escopo: só o delta de `feat/perfil-usuario`; `--quick`, sem `next build`. Infra/Lambda/SQS/axios/cold start: não medível (sem `infra/`; o delta não toca clientes externos).
- Nenhum P0/P1: não há baseline numérico que demonstre defeito (consultas ~0,5 ms em prod, sem N+1, LIMIT presente, keyset correto).
- Cross-QA: pool de 5 e ausência de `statement_timeout` tocam Availability/Fault Tolerance; migration 0072 versionada com rollback é boa prática de Modifiability.
