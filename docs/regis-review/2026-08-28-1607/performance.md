---
qa: Performance
qa_slug: performance
run_id: 2026-08-28-1607
agent: qa-performance
generated_at: 2026-08-28T17:20:00-03:00
scope: backend
score: 8.5
findings_count: 4
cards_count: 2
---

# Performance — Regis-Review

> Escopo: DELTA de 2 commits sobre `617ca3b` (branch `fix/conexos-fallback-audit`).
> Runtime real é Express + Render (não Lambda), então as tactics de cold-start /
> bundle Lambda são **N/A** para este delta. As tactics medíveis aqui são as de
> **Control Resource Demand** (Reduce Overhead, Limit Event Response) e
> **Manage Resources** (Cache — reaproveitamento de resolução no request scope).

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (com ou sem vínculo Conexos utilizável) executa uma ação que grava no ledger (`beginExecution` / `markSettled` / `markError` / `fail`) | Toda request de escrita agora invoca `ConexosIdentityProvider.currentParams()` uma vez por statement SQL, mais 2 colunas TEXT extras no INSERT/UPDATE, mais (na resolução de sessão) um `LogService.warn` quando o vínculo estiver presente mas inutilizável | `ConexosSessionResolver` (uma vez por request), `ConexosIdentityProvider.currentParams()` (por statement) e os 5 repositórios de execução (`permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao`) | Produção normal (10–50 execuções/dia observadas na baseline), sob operação assistida por analistas (não é hot path de throughput) | Latência da request de escrita permanece dominada pelo I/O do ERP e do Postgres; o overhead adicional do delta é sub-milissegundo por statement; o `warn` sai **no máximo uma vez por request degradada** (cache `state.resolved`) | Overhead adicional por statement SQL: < 50 μs (leitura `AsyncLocalStorage.getStore()` + field access `getCapturedUsnCod()`); custo de escrita adicional: ~20 bytes/linha (2 colunas TEXT, sem índice); volume de log adicional em regime normal (0 vínculos quebrados): 0 linhas/dia; em regime do incidente (1 usuário permanentemente quebrado): ~13 linhas/dia |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Roundtrips extras ao ERP introduzidos por `currentParams()` | 0 (getCapturedUsnCod é `return this.usnCod`, sem I/O) | 0 | ✅ | `src/backend/services/conexos.ts:344-350` |
| Roundtrips extras ao Postgres introduzidos pelo delta | 0 (as 2 colunas entram no mesmo INSERT/UPDATE já existente) | 0 | ✅ | `git diff main..HEAD -- src/backend/domain/repository/**/*.ts` |
| Chamadas a `AsyncLocalStorage.getStore()` por statement SQL de ledger | +1 (era 0 no repositório; o resolver já lê o mesmo store no auth path) | O(1) hash lookup, custo ~0,1 μs em V8 | ✅ | `src/backend/domain/client/ConexosIdentityProvider.ts:47` |
| Colunas TEXT adicionadas por linha de ledger | 2 (`conexos_username` ~15 B, `conexos_usn_cod` ~5 B) → ~20 B/linha | ≤ 100 B/linha (folga vasta) | ✅ | `src/backend/migrations/0051_execucao_identidade_conexos.sql` |
| Índices adicionados pela migration 0051 | 0 | 0 (as colunas não vão a `WHERE` de path quente — só à leitura de auditoria) | ✅ | `src/backend/migrations/0051_execucao_identidade_conexos.sql` (nenhum `CREATE INDEX`) |
| `warn` amplificado — máximo por request degradada | 1 (cache `state.resolved` curto-circuita) | 1 | ✅ | `src/backend/domain/client/ConexosSessionResolver.ts:55-64` |
| Volume estimado de `warn` no cenário do incidente (35 execuções em ~1 mês, 13 num dia único) | ≤ 13 linhas/dia p95, 1–2 linhas/dia mediano | ≤ 1000 linhas/dia (limite plausível de agregador Render) | ✅ | ADR-0041 + `_shared-metrics.md` |
| Volume estimado de `warn` sob falha em massa (chave `CONEXOS_CRED_ENC_KEY` ausente + N usuários vinculados navegando) | 1 warn por request × N usuários × M requests/dia. Ex.: 5 usuários × 200 req/dia = 1000/dia | ≤ 5000 linhas/dia | ⚠️ mitigação recomendada (card `performance-1`) | `src/backend/domain/client/ConexosSessionResolver.ts:97-119` + `conexos-fallback-audit-regis-followups.md:F-1,F-4` |
| Latência bloqueante do `await avisarDegradacao` no path degradado | `LogService.writeLog` = `process.stdout.write(JSON.stringify(...))` sem callback. Em Render (stdout piped ao agregador) `write` retorna imediato exceto sob backpressure; `await` em `async` sem `await` interno = 1 microtask (~1 μs) | < 1 ms sob operação normal | ✅ | `src/backend/domain/service/LogService.ts:22-27` |
| `LogService.getCaller()` — construção de stack por log | `new Error().stack` + regex ~ 1–10 μs; **pré-existente**, não introduzido pelo delta | irrelevante para volume atual | ✅ (não regride) | `src/backend/domain/service/LogService.ts:29-46` |
| N+1 em callers de `beginExecution`/`markSettled`/`markError` | 0 — todos são invocados uma vez por execução top-level, não dentro de loop de itens | 0 | ✅ | `Grep beginExecution src/backend/domain/service` — nenhum caller looped |
| Bundle size do backend (delta) | +2 arquivos (`ConexosIdentityProvider.ts` 56 LOC, `ConexosRequestContext.ts` 13 LOC + interface) | irrelevante (runtime Express, não Lambda) | N/A | — |
| Cold-start budget | ⚠️ **Não medível**: runtime é Express num container Render (warm); não há Lambda cold start neste repo | — | N/A | CLAUDE.md §"Estado Atual vs. Alvo" |
| Pool de conexões Postgres — impacto do delta | 0 (mesmo statement, só 2 params a mais) | pool.max não mexido | ✅ | `PostgreeDatabaseClient.ts` inalterado no delta |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| **Reduce Overhead** | `currentParams()` é O(1) — 1 lookup em `AsyncLocalStorage` + 1 field access em `ConexosService.usnCod`. Não invoca login, não invoca DB, não invoca ERP. As 2 colunas entram no INSERT/UPDATE já existente (sem roundtrip extra) | ✅ presente | `src/backend/domain/client/ConexosIdentityProvider.ts:38-53`; `src/backend/services/conexos.ts:344-350` |
| **Limit Event Response** | `warn` de degradação sai **uma vez por request** (não uma vez por ledger write), porque `state.resolved` cacheia a sessão na primeira chamada e as subsequentes curto-circuitam antes de chegar em `resolveForUser`/`avisarDegradacao` | ✅ presente | `src/backend/domain/client/ConexosSessionResolver.ts:55-64` (`if (state.resolved) return state.resolved`) |
| **Manage Sampling Rate** | Não amostrado — todo request degradado emite 1 linha. Aceito pelo follow-up `F-4` como dívida deliberada (sem estado global de dedup). Card `performance-1` propõe a próxima iteração (dedup por `conexosUsername` em memória) | ⚠️ parcial | `conexos-fallback-audit-regis-followups.md:F-4` |
| **Prioritize Events** | `warn` de I-1 é `LOG_TYPE.BUSINESS_WARN` (não `ERROR`) — não polui o painel de erros e permite alarme dedicado depois (`F-5`) | ✅ presente | `src/backend/domain/client/ConexosSessionResolver.ts:132-146` |
| **Bound Execution Times** | Nenhuma nova operação de I/O no delta que pudesse demorar; timeouts existentes de Conexos (40s) inalterados | N/A no delta | — |
| **Increase Resource Efficiency** | Cache de sessão por request via `state.resolved` (pré-existente, preservado). O delta acrescenta `state.identity` no mesmo store — reutiliza o mecanismo | ✅ presente (preservado) | `src/backend/domain/libs/requestContext/ConexosRequestContext.ts:25-31` |
| **Increase Resources** | N/A — o delta é observabilidade, não muda demanda por recursos | N/A | — |
| **Increase Concurrency** | N/A — path serializado por design (mutex de login pré-existente inalterado) | N/A | — |
| **Maintain Multiple Copies of Computations** | N/A no delta | N/A | — |
| **Maintain Multiple Copies of Data** | `conexos_username`/`conexos_usn_cod` são cópia local de identidade que também vive no ERP, para não depender do ERP para explicar "quem assinou" — trade-off consciente registrado em ADR-0041 | ✅ presente | `ontology/business-rules/identidade-execucao-conexos.md` |
| **Bound Queue Sizes** | N/A — sem fila no delta | N/A | — |
| **Schedule Resources** | N/A — sem scheduler no delta | N/A | — |

## 4. Findings (achados)

### F-performance-1: `warn` de I-1 é emitido por request, sem dedup — amplificação linear sob falha em massa

- **Severidade**: P3 (opcional — cenário atual não estressa; risco só sob configuração ausente + muitos usuários)
- **Tactic violada**: Manage Sampling Rate (parcial)
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:132-146` (`avisarDegradacao`)
- **Evidência (objetiva)**:
  ```
  private avisarDegradacao = async (
      platformUsername: string,
      conexosUsername: string,
      motivo: MotivoDegradacao,
      error: unknown,
  ): Promise<void> => {
      await this.logService.warn({ ... });
  };
  ```
  Sem `Map<username, lastAt>` para deduplicar. `state.resolved` cacheia dentro da MESMA request (evita amplificação por ledger write), mas cada nova request re-emite.
- **Impacto técnico**: Se `CONEXOS_CRED_ENC_KEY` ficar ausente num ambiente (dívida F-1 dos follow-ups) e N usuários vinculados navegarem, o volume vira `N × req/dia`. Para 5 usuários × 200 req/dia = 1000 linhas/dia — ainda muito abaixo de qualquer limite prático, mas ruído.
- **Impacto de negócio**: Ruído no painel de logs; pequeno custo de retenção no agregador. Não afeta latência de usuário.
- **Métrica de baseline**: cenário observado (1 usuário quebrado, 13 execuções no pior dia) → 13 linhas/dia. Alvo com dedup: 1 linha/usuário/hora → ≤ 24 linhas/usuário/dia.

### F-performance-2: overhead por statement do ledger é sub-milissegundo — sem regressão medível

- **Severidade**: P3 (informativo — não é achado; é a evidência que confirma o desenho)
- **Tactic violada**: nenhuma
- **Localização**: `src/backend/domain/client/ConexosIdentityProvider.ts:38-53`
- **Evidência (objetiva)**:
  ```
  public current = (): ConexosExecutionIdentity | undefined => {
      const state = conexosRequestContext.getStore();       // O(1) hash lookup
      if (!state?.identity) return undefined;
      const usnCod = state.resolved?.getCapturedUsnCod() ?? undefined;  // field access
      ...
  };
  ```
  `getCapturedUsnCod()` (em `services/conexos.ts:349`) é `return this.usnCod;` — nenhum I/O, nenhum login.
- **Impacto técnico**: Nenhum. O custo é dominado por 1 hash lookup + 1 field access + spread de 2 params num objeto que já ia para o SQL. Comparado à latência típica de INSERT/UPDATE Postgres via Supabase (5–30 ms), o overhead é < 0,1%.
- **Impacto de negócio**: Nenhum.
- **Métrica de baseline**: overhead < 50 μs por statement; INSERT/UPDATE típico 5–30 ms → overhead < 1 %. Não há alvo — o valor atual já é ótimo.

### F-performance-3: 2 colunas TEXT sem índice não afetam custo de escrita nem de leitura de path quente

- **Severidade**: P3 (informativo)
- **Tactic violada**: nenhuma
- **Localização**: `src/backend/migrations/0051_execucao_identidade_conexos.sql`
- **Evidência (objetiva)**:
  ```
  ALTER TABLE permuta_alocacao_execucao
      ADD COLUMN IF NOT EXISTS conexos_username TEXT,
      ADD COLUMN IF NOT EXISTS conexos_usn_cod  TEXT;
  ```
  Nenhum `CREATE INDEX`. As colunas não aparecem em `WHERE` de path quente (`Grep -rn "WHERE.*conexos_username" src/backend` → 0 ocorrências); só são lidas em SELECT * do próprio ledger para auditoria.
- **Impacto técnico**: ~20 B/linha adicionais. Numa tabela com 35 linhas históricas (baseline do incidente) + crescimento típico de 10–50 execuções/dia, o overhead de storage é irrelevante.
- **Impacto de negócio**: Nenhum.
- **Métrica de baseline**: incremento de storage projetado em 1 ano: 50 exec/dia × 365 × 20 B = ~365 KB. Alvo: sem alarme.

### F-performance-4: `avisarDegradacao` awaited no path degradado — custo bloqueante negligível, mas confirmado

- **Severidade**: P3 (informativo — a intuição de que `await` bloqueia foi verificada e é falso alarme aqui)
- **Tactic violada**: nenhuma
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:104-118` (`resolveForUser`) chama `await this.avisarDegradacao(...)` antes de retornar o robô
- **Evidência (objetiva)**:
  - `LogService.writeLog` (`src/backend/domain/service/LogService.ts:22-27`) faz `process.stdout.write(JSON.stringify(...) + '\n')` **sem callback**, e retorna sem `await` interno. O `async` só existe para uniformizar a interface.
  - `process.stdout.write` em Render (stdout piped) retorna síncrono exceto sob backpressure severa; o `await` da chamada externa colapsa em 1 microtask.
  - No path degradado, o custo dominante é o `service.ensureSid()` que **acabou de falhar** — tipicamente 40s (timeout Conexos) ou 2–10s (login rejeitado). O `warn` que segue é ~1 μs.
- **Impacto técnico**: Nenhum sob operação normal. Sob backpressure de stdout (Render aggregator down), `process.stdout.write` pode enfileirar em buffer interno do Node (`stdout.writableLength` cresce) — não bloqueia thread; apenas RSS cresce.
- **Impacto de negócio**: Nenhum.
- **Métrica de baseline**: latência adicionada pelo `await avisarDegradacao` no path degradado: < 100 μs. Comparado ao custo do `ensureSid` que falhou (2–40 s), é < 0,005 %.

## 5. Cards Kanban

### [performance-1] Deduplicar `warn` de degradação por (conexosUsername, motivo) numa janela horária

- **Problema**
  > O `warn` de I-1 sai **uma vez por request** que degrada para o robô. Em regime normal (~13 linhas/dia no cenário do incidente) o ruído é insignificante, mas se `CONEXOS_CRED_ENC_KEY` ficar ausente num ambiente (dívida `F-1` dos follow-ups) e N usuários vinculados navegarem, o volume vira `N × requests/dia`. O follow-up `F-4` já declara essa dívida como deliberada; este card é a próxima iteração.

- **Melhoria Proposta**
  > Em `ConexosSessionResolver`, manter um `Map<`${conexosUsername}:${motivo}`, number>` em memória (TTL 1 h). `avisarDegradacao` só emite se `Date.now() - lastAt > 3600_000`; senão incrementa um contador (`skipped`) que sai no próximo warn como `data.suppressed = N`. Sem persistência, sem lock — perde no restart, e é isso mesmo. Tactic Bass: **Manage Sampling Rate**. Arquivo único: `src/backend/domain/client/ConexosSessionResolver.ts`.

- **Resultado Esperado**
  > Sob falha em massa (5 usuários vinculados × 200 req/dia × chave ausente), volume de `warn` cai de ~1000 linhas/dia para ~120 linhas/dia (5 usuários × 2 motivos × 24 h × 0,5 emissões/h médio). Sob operação normal, volume permanece idêntico (~13/dia continuam ≤ 24/dia).

- **Tactic alvo**: Manage Sampling Rate
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1 d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Warns/dia sob cenário de falha em massa: ~1000 → ~120
  - Warns/dia sob cenário normal (13 execuções em pico): 13 → 13 (sem regressão)
  - Latência adicionada por warn: < 5 μs (mesmo hash lookup do resolver)
- **Risco de não fazer**: Sob configuração ausente de `CONEXOS_CRED_ENC_KEY` em ambiente novo (staging/dev), painel de logs vira ruidoso; nenhum incidente de produção. Se por 6 meses ninguém provisionar staging, nada acontece.
- **Dependências**: nenhuma

### [performance-2] Métrica dedicada `conexos_fallback_total{conexosUsername, motivo}` para substituir análise por grep de log

- **Problema**
  > Hoje, para saber "quantos usuários estão degradando", o único caminho é `grep BUSINESS_WARN` no agregador de log — trabalhoso, sem alarme, e dependente de retenção. O follow-up `F-5` reconhece que a lacuna de **notificação** ainda está aberta.

- **Melhoria Proposta**
  > Emitir uma métrica (Prometheus/CloudWatch, o que o `LogService` já expor no futuro) `conexos_fallback_total{conexosUsername, motivo}` incrementada em `avisarDegradacao`. Alarme sobre `rate(conexos_fallback_total[15m]) > 0` alerta que existe algum vínculo quebrado; alarme sobre o mesmo com `conexosUsername=~"..."` isola qual. Tactic Bass: **Prioritize Events** + **Manage Sampling Rate** (métrica agrega no lado do coletor). Arquivo primário: `src/backend/domain/client/ConexosSessionResolver.ts`; dependente de uma abstração `MetricService` que ainda não existe.

- **Resultado Esperado**
  > MTTD (mean time to detect) de vínculo quebrado cai de "próxima vez que o Yuri olhar o log" (dias) para 15 min (janela do alarme). Substitui F-5 do follow-up.

- **Tactic alvo**: Prioritize Events (custo agregado, não por linha)
- **Severidade**: P2 (o incidente de 2026-08-25 foi exatamente isso: descoberto tarde porque não havia sinal)
- **Esforço estimado**: M (2–5 d — inclui criar `MetricService` mínimo se ainda não houver)
- **Findings relacionados**: F-performance-1; cruza com Availability e Fault Tolerance
- **Métricas de sucesso**:
  - MTTD de vínculo quebrado: dias → 15 min
  - Ruído no log de warn: `performance-1` já reduz; a métrica substitui a leitura humana do log
- **Risco de não fazer**: Se outro usuário vinculado quebrar (senha rotacionada, credencial revogada), o time só descobre quando alguém reclamar — como aconteceu com MARILYN em 2026-08-25.
- **Dependências**: `performance-1` (dedup) é ortogonal, mas ordem natural é 1 → 2. Longer-term: requer decisão de stack de métricas (StatsD? OTel? CloudWatch EMF via `LogService`?).

## 6. Notas do agente

- Delta é de auditoria/observabilidade e **não** introduz regressão de latência, throughput ou custo mensuráveis. `currentParams()` é O(1) sem I/O; as 2 colunas cabem no INSERT/UPDATE já existente; o `warn` sai no máximo 1×/request via cache `state.resolved`. Score 8.5 reflete "clean delta com uma única melhoria de sampling opcional".
- Métricas de cold-start/bundle Lambda declaradas **N/A**: runtime é Express em Render (warm container) — CLAUDE.md §"Estado Atual vs. Alvo".
- Cross-QA: `performance-2` (métrica dedicada + alarme) sobrepõe fortemente com **Availability** (MTTD do vínculo quebrado) e **Fault Tolerance** (Ping/Echo — o `warn` é o "echo" do fallback silencioso). `performance-1` é puro Performance/sampling. Nenhuma sobreposição com Deployability neste delta.
- Não medi latência de produção (proibido por escopo — `.env` aponta Supabase de produção). Todos os números de custo por statement são derivados de leitura de código + custos conhecidos de V8/Node/Postgres, não de benchmark local.
