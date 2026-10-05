---
qa: Performance
qa_slug: performance
run_id: 2026-10-05-1625
agent: qa-performance
generated_at: 2026-10-05T16:40:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (vários, mesmo escritório/IP) | Abre `/sispag` com carteira > 30 min | `POST /sispag/carteira/atualizar` → `CarteiraAtualizacaoService` → `IngestaoPagamentosService` (7 filiais, Conexos) | Express/Render, pool pg, Conexos com sessão limitada | A tela mostra o gravado; um único refresh roda; os demais veem `em_andamento` e reconferem | 1 ingestão por janela de TTL; request do refresh ≈ 9–10 s; painel recarrega 1 vez; 0 requests 429 para o analista |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Duração da ingestão (7 filiais, ~1,4 mil títulos) | ~9 s (15:02:40 → 15:02:49) | ≤ 10 s numa request HTTP | ✅ | `_shared-metrics.md` (log do cron 04/10) |
| Pior caso do refresh síncrono | Não medível localmente: só há 1 amostra (9 s); p99 do Conexos 2–10 s por chamada x 7 filiais pode passar de 30 s | p95 < 30 s | ⚠️ | Requer log de produção de `pagamento_ingestao_run` (finished_at − started_at) |
| Timeout no request do refresh | Nenhum explícito na rota nem no `apiFetch` do front | Bound explícito | ❌ | `routes/sispag.ts:605-618`; `frontend/lib/sispag.ts:899-903`; sem `server.timeout` em `http/` |
| Requests por abertura (caminho com espera) | até 6 POSTs em ~40 s (5 esperas x 8 s) | ≤ 10/min por IP (`heavyRouteLimiter`) | ⚠️ | `useCarteiraAoAbrir.ts:7-9,42`; `http/rateLimit.ts:123-130` |
| Queries de decisão por chamada | 2–3 (último sucesso, última run) + `getEnvironmentVars` | índices cobrindo | ✅ (tabela ~3 linhas/dia) | `CarteiraAtualizacaoService.ts:66-82` |
| Índice de `started_at` em `pagamento_ingestao_run` | ausente (só `finished_at DESC`) | — | ⚠️ P3 | `migrations/0024_pagamento_ingestao.sql:23` |
| Recargas do painel por abertura | 1 (só se `atualizada`, ou `fresca` após espera) | ≤ 1 | ✅ | `useCarteiraAoAbrir.ts:45-47,61` |
| Timers manuais no delta | 1 (`setTimeout` de espera no hook do front) | 0 no backend | ✅ (front, fora da regra de Executors do backend) | `useCarteiraAoAbrir.ts:13` |
| Bundle/cold start Lambda | Não medível: sem `infra/`, runtime é Express | — | ⚠️ | `--quick` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | TTL 30 min + cooldown 5 min após falha; cron 3x/dia | ✅ presente | `CarteiraAtualizacaoService.ts:67-68,78,86-96` |
| Limit Event Response | Lock da ingestão + `em_andamento`; ausência de single-flight local (apenas lock no banco) | ⚠️ parcial | `:83-85,108` |
| Prioritize Events | Formação de lote fica fora da abertura; sem priorização do refresh sobre outras requests | ⚠️ parcial | ADR-0060 decisão 4 |
| Reduce Overhead | Fresca devolve sem tocar o Conexos; 2 SELECTs por chamada | ✅ presente | `:70-80` |
| Bound Execution Times | Nenhum deadline na ingestão síncrona nem no fetch do cliente | ❌ ausente | `routes/sispag.ts:613`; `lib/sispag.ts:900` |
| Increase Resource Efficiency | Reaproveita a ingestão existente; run MORTA expira em 10 min | ✅ presente | `:13,83` |
| Increase Resources | N/A: Render com instância fixa, sem alvo de concorrência a dimensionar nesta feature | N/A | — |
| Increase Concurrency | N/A: ingestão por filial é serial/paralela dentro do serviço existente, fora do delta | N/A | — |
| Maintain Multiple Copies of Computations | N/A: refresh único é o objetivo | N/A | — |
| Maintain Multiple Copies of Data | Carteira gravada serve de cópia stale-while-revalidate | ✅ presente | `useCarteiraAoAbrir.ts:16-18` |
| Bound Queue Sizes | Polling limitado a 6 tentativas (~48 s) | ✅ presente | `useCarteiraAoAbrir.ts:9` |
| Schedule Resources | Rate limit por IP; cron dedicado | ⚠️ parcial | `rateLimit.ts:123` |
| Cache strategy / Index discipline | TTL via `finished_at` indexado; `started_at` sem índice | ⚠️ parcial | migração 0024 |

## 4. Findings

### F-performance-1: Refresh síncrono sem teto de duração (Bound Execution Times)

- **Severidade**: P2 (rebaixado: só 1 amostra de duração; p99 não medido)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/routes/sispag.ts:605-618`, `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:99`, `src/frontend/lib/sispag.ts:899-903`
- **Evidência (objetiva)**:
  ```
  const run = await this.ingestao.executar({ triggeredBy: input.triggeredBy });   // sem deadline
  const res = await apiFetch(`${API}/sispag/carteira/atualizar`, { method: 'POST', ... }) // sem AbortSignal
  ```
- **Impacto técnico**: com Conexos lento (2–10 s p99 por chamada x 7 filiais), a request pode passar do timeout do proxy (Render ~100 s) ou de qualquer timeout do cliente; a ingestão segue no servidor e o front mostra `falhou` embora o dado se atualize.
- **Impacto de negócio**: o analista vê "falha ao atualizar" com carteira que de fato foi atualizada; reabre e dispara retentativa.
- **Métrica de baseline**: ~9 s (n=1); pior caso não medível localmente.

### F-performance-2: heavyRouteLimiter por IP (10/min) compartilhado com o polling

- **Severidade**: P2
- **Tactic violada**: Schedule Resources
- **Localização**: `src/backend/routes/sispag.ts:608`, `src/backend/http/rateLimit.ts:123-130`, `src/frontend/app/sispag/useCarteiraAoAbrir.ts:7-9`
- **Evidência (objetiva)**: cada abertura com ingestão em curso emite até 6 POSTs em ~48 s; o limiter conta 10/min por IP, compartilhado com `/ingestao`, remessa e demais rotas pesadas. Dois analistas atrás do mesmo NAT abrindo a tela juntos = 12 POSTs na janela.
- **Impacto técnico**: 429 vira `falhou` no hook (erro genérico `API 429`), sem diferenciar de falha real.
- **Impacto de negócio**: ruído na tela do analista; pode bloquear também uma ação pesada legítima (remessa) no mesmo minuto.
- **Métrica de baseline**: pior caso teórico 6 POSTs/abertura contra teto 10/min/IP; ocorrência real não medível localmente.

### F-performance-3: Thundering herd só contido pelo lock, sem single-flight local e com janela de corrida

- **Severidade**: P3
- **Tactic violada**: Limit Event Response
- **Localização**: `CarteiraAtualizacaoService.ts:70-99`
- **Evidência (objetiva)**: checagem (TTL, run em andamento) e `executar` não são atômicas; duas aberturas simultâneas passam a checagem e a perdedora cai em `IngestLockBusyError` → `em_andamento` (`:108`). Funciona e é testado, mas cada perdedora gasta 2–3 queries e depois polling de 8 s.
- **Impacto técnico**: custo extra pequeno (queries sobre tabela de ~3 linhas/dia); sem carga extra ao Conexos.
- **Impacto de negócio**: nenhum perceptível hoje.
- **Métrica de baseline**: ≤ 1 ingestão por janela (garantido pelo lock); contenção medida: não medível.

### F-performance-4: Sem índice em `started_at` para `listRecentRuns`

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (index discipline)
- **Localização**: `src/backend/domain/repository/sispag/PagamentoIngestaoRunRepository.ts:74-83`, `migrations/0024_pagamento_ingestao.sql:23`
- **Evidência (objetiva)**: `ORDER BY started_at DESC LIMIT 1` com índice só em `finished_at`.
- **Impacto técnico**: seq scan + sort numa tabela de ~1 mil linhas/ano: irrelevante hoje.
- **Impacto de negócio**: nenhum até a tabela crescer.
- **Métrica de baseline**: ~3 runs/dia (≈1,1 mil/ano), custo desprezível.

## 5. Cards Kanban

### [performance-1] Dar teto de duração ao refresh da carteira e tratar timeout como "em andamento"

- **Problema**
  > O refresh síncrono (~9 s, n=1) roda sem deadline no servidor e sem `AbortSignal` no cliente. Com Conexos lento a request pode estourar o proxy e a tela mostra falha, mesmo com a ingestão concluindo no servidor.

- **Melhoria Proposta**
  > Bound Execution Times: `AbortSignal.timeout(~45 s)` em `atualizarCarteiraSeDefasada`; no hook, abort/timeout vira reconferência (a próxima chamada responde `em_andamento`/`fresca`) em vez de `falhou`. Registrar duração da run em log para obter o p95 real.

- **Resultado Esperado**
  > 0 mensagens "falha ao atualizar" quando a ingestão conclui; p95 da duração do refresh medido (hoje: 1 amostra, 9 s) e documentado no ADR-0060.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Falsos "falhou" por timeout: não medido → 0
  - p95 de `finished_at − started_at`: não medido → registrado
- **Risco de não fazer**: Conexos lento num dia de fechamento gera falhas aparentes e reaberturas repetidas.
- **Dependências**: nenhuma

### [performance-2] Isolar o polling do refresh do limiter pesado e distinguir 429

- **Problema**
  > O polling (até 6 POSTs/abertura) divide o `heavyRouteLimiter` (10/min/IP) com rotas pesadas; vários analistas no mesmo IP podem receber 429 exibido como falha.

- **Melhoria Proposta**
  > Schedule Resources: trocar o polling por `GET /sispag/carteira/estado` (leve, sem limiter pesado) ou limiter próprio para `/carteira/atualizar`; no hook, tratar 429 como "tentar depois" e não `falhou`.

- **Resultado Esperado**
  > POSTs pesados por abertura: até 6 → 1; 429 visíveis ao analista: 0.

- **Tactic alvo**: Schedule Resources
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - POSTs contra o limiter por abertura: 6 (pior caso) → 1
  - Respostas 429 em `/sispag/carteira/atualizar`: não medido → 0
- **Risco de não fazer**: remessa de um analista bloqueada por 1 min porque colegas abriram a tela.
- **Dependências**: nenhuma

### [performance-3] Índice em `started_at` e single-flight local (baixa prioridade)

- **Problema**
  > `listRecentRuns` ordena por `started_at` sem índice; a corrida de abertura simultânea depende só do lock do banco.

- **Melhoria Proposta**
  > Migration `CREATE INDEX ... ON pagamento_ingestao_run (started_at DESC)`; opcional: promise compartilhada por processo para aberturas concorrentes.

- **Resultado Esperado**
  > Plano da query com index scan; queries de decisão perdedoras por corrida: 2–3 → 0 no mesmo processo.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3, F-performance-4
- **Métricas de sucesso**:
  - Plano `listRecentRuns`: Seq Scan → Index Scan
- **Risco de não fazer**: nenhum relevante em 6 meses (~550 linhas).
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; `--quick`, sem infra/Terraform (inexistente) nem bundle Lambda (runtime Express).
- Não medível: p95/p99 do refresh e taxa de 429 em produção. Recomendo instrumentar duração de run (já há `started_at`/`finished_at`).
- Cross-QA: timeout do fetch e do Conexos toca Availability/Fault Tolerance; índice como migration toca Modifiability; 429 do limiter toca Security (limiter por IP).
- Pontos fortes: TTL + cooldown + lock + run MORTA com expiração de 10 min tornam o thundering herd inofensivo para o Conexos; 1 recarga de painel por abertura.
