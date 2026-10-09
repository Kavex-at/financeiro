---
qa: Availability
qa_slug: availability
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-availability
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 2
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (`sispag:executar`) digitando no diálogo de pedido de autorização | Conexos `cmn025/list` lento, fora do ar ou recusando sessão (teto de sessões / Bad Credentials) durante a busca | `PayeeSearchService.buscar` → `ConexosSispagClient.buscarPessoas` → `ConexosBaseClient.runWithRetry` | Operação normal, dia útil; tenant único em Render | Busca falha de forma visível ao analista (mensagem de erro no diálogo), sem escrita parcial; o pedido de autorização continua possível por outro caminho (código do favorecido) e o resto do SISPAG segue intacto | 0 escritas locais/ERP por busca; erro mostrado ao usuário em ≤ tempo do retry (2 retries, 500 ms + jitter 200 ms, timeout axios 40 s por chamada) |

A feature é **read-only** (nenhuma escrita no Conexos nem no banco): o risco de disponibilidade é de leitura (degradação da UX e consumo do teto de sessões do Conexos), não de perda de dado financeiro ou execução dupla.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas (local/ERP) introduzidas pelo delta | 0 (busca e prévia são GET/POST de leitura; `buscar` só chama `buscarPessoas` + `listarVigentesPorPesCods`) | 0 | ✅ | `PayeeSearchService.ts:50-88`; `sispag.ts` rotas `/busca` e `/destino-atual` |
| Chamada externa nova passa por Executor | 1/1 caminho (`buscarPessoas` → `base.runWithRetry`, `ConexosSispagClient.ts` bloco `ler`) | ≥80% | ✅ | `grep runWithRetry`; `ConexosBaseClient.ts:154-162,221` |
| Retry com backoff/jitter e gate de recusa determinística | retries 2, delay 500 ms, jitter 200 ms, `shouldRetry` exclui 4xx≠408/429 | com jitter | ✅ | `ConexosBaseClient.ts:154-162` |
| Timeout explícito no cliente HTTP Conexos | 40 000 ms (herdado, `services/conexos.ts:121`) | 100% dos clientes | ✅ (herdado) | `grep -n timeout src/backend/services/conexos.ts` |
| Pior caso de latência de uma busca por documento | até 2 leituras × (1+2 tentativas) × 40 s ≈ 240 s teórico; busca por texto: 2 leituras idem. Não medido ao vivo | p95 < 5 s | ⚠️ Não medido | cálculo a partir de `ConexosSispagClient.buscarPessoas` e `ConexosBaseClient.ts:154` |
| Limite de taxa na rota de busca | só debounce 350 ms no frontend; sem rate limit no backend | limite por usuário | ⚠️ | `_shared-metrics.md`; `grep rateLimit src/backend` (só Supabase/Password) |
| Cancelamento de requisição obsoleta (frontend) | `AbortController` na busca e na prévia | presente | ✅ | `SolicitarAutorizacaoDialog.tsx:136,157` |
| Idempotência / estado | N/A: leitura pura | — | ✅ | — |
| Referências a `shared_account_id` no delta | 0 | 0 | ✅ | `grep` no delta (sem `infra/`) |
| Silent catch novo no backend | 0 (falha de rede sobe; linhas inválidas viram `undefined` por Zod `safeParse`, intencional) | 0 | ✅ | `ConexosSispagClient.ts` `mapPessoa` |
| Gates (typecheck/lint/testes) | 0 erros; backend 225 suites/4.016 testes; frontend 88 suites | verde | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: latência real e taxa de erro de `cmn025/list` sob `#LIKE`, e MTTR. Requer produção/HML (HML recusou o usuário do `.env`; sonda em produção derrubaria sessão viva). Recomendação: logar duração e resultado de `buscarPessoas` e acompanhar p95 antes de qualquer SLO.
>
> ⚠️ **Não medível localmente**: alarmes CloudWatch, DLQ e `infra/` — não existem neste repo (Render/Vercel). Métricas de Terraform não se aplicam.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum no delta; sem health check do Conexos na busca | ❌ ausente | — |
| Heartbeat | N/A: não há processo novo de longa duração; busca é sob demanda | N/A | — |
| Monitor | Logs do retry (`shouldLog: true`); sem métrica/alarme da busca | ⚠️ parcial | `ConexosBaseClient.ts:157` |
| Timestamp | N/A: leitura sem ordenação de eventos | N/A | — |
| Sanity Checking | Zod em body (`BuscaFavorecidoSchema`), query e nas linhas do `cmn025` (`pessoaRowSchema`, `documentoSchema`) | ✅ presente | `schemas.ts:56-65`; `ConexosSispagClient.ts:220-232` |
| Condition Monitoring | Sem monitoramento de condição do teto de sessões Conexos no delta | ❌ ausente | — |
| Voting | N/A: fonte única (ERP) | N/A | — |
| Exception Detection | Falha de rede sobe até `asyncHandler`; frontend trata `erro` e `FALHA_LEITURA` | ✅ presente | `SolicitarAutorizacaoDialog.tsx:142-145,418` |
| Self-Test | Sonda read-only `probe-cmn025-busca-hml.ts` (manual, recusa base não-HML) | ⚠️ parcial | `src/backend/jobs/probe-cmn025-busca-hml.ts` |
| Active Redundancy | N/A: fonte única do cadastro de pessoas é o Conexos | N/A | — |
| Passive Redundancy | N/A idem | N/A | — |
| Spare | N/A: Render single instance, fora do escopo do delta | N/A | — |
| Exception Handling | Retry + erro tipado ao usuário; sem tradução de 5xx do ERP para mensagem específica | ⚠️ parcial | `ConexosBaseClient.ts:154-162` |
| Rollback | N/A: sem escrita para reverter | N/A | — |
| Software Upgrade | N/A no delta (deploy Render) | N/A | — |
| Retry | `RetryExecutor` 2× com jitter e gate de recusa determinística | ✅ presente | `ConexosBaseClient.ts:154-162` |
| Ignore Faulty Behavior | Linhas de pessoa fora do schema são descartadas, não derrubam a busca | ✅ presente | `ConexosSispagClient.ts` `mapPessoa` |
| Degradation | Falha na busca não impede o fluxo: pedido por código ainda existe; prévia com `FALHA_LEITURA` exibida sem bloquear | ⚠️ parcial | `SolicitarAutorizacaoDialog.tsx:418` |
| Reconfiguration | N/A no delta | N/A | — |
| Shadow | N/A: sem componente novo a reintroduzir | N/A | — |
| State Resynchronization | N/A: sem estado novo | N/A | — |
| Escalating Restart | N/A: Render gere o processo | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | Sem feature flag/kill switch para desligar a busca se o Conexos degradar | ❌ ausente | — |
| Transactions | N/A: sem escrita | N/A | — |
| Predictive Model | N/A | N/A | — |
| Exception Prevention | Texto mínimo 3 letras, `max(100)`, página ≤20, debounce 350 ms, curingas `%`/`_` neutralizados | ✅ presente | `PayeeSearchService.ts:11,44-46`; `ConexosSispagClient.ts` `BUSCA_PESSOAS_LIMITE` |
| Increase Competence Set | Cache/negative-cache de buscas repetidas ausente | ❌ ausente | — |

## 4. Findings (achados)

### F-availability-1: Busca consome sessões do Conexos sem limite de taxa no backend

- **Severidade**: P2
- **Tactic violada**: Exception Prevention / Removal from Service
- **Localização**: `src/backend/routes/sispag.ts` (rota `POST /favorecidos-autorizados/busca`); `ConexosSispagClient.ts` `buscarPessoas`
- **Evidência (objetiva)**:
  ```
  busca = 1–2 leituras cmn025 por termo (_shared-metrics.md); debounce 350 ms só no frontend;
  CandidatosQuery já documenta "teto de sessões do Conexos" como restrição.
  ```
- **Impacto técnico**: vários analistas (ou cliente mal-comportado) digitando geram rajadas de leituras ao ERP, competindo pelo teto de sessões com a ingestão e o sync do SISPAG.
- **Impacto de negócio**: busca de conveniência poderia atrasar a carteira SISPAG/remessa em horário crítico.
- **Métrica de baseline**: 0 limites de taxa no backend; ≥1 leitura por requisição, até 2 por termo. Sem número de concorrência real medido, então rebaixado a P2.

### F-availability-2: Latência de pior caso da busca sem orçamento (retry × timeout 40 s)

- **Severidade**: P2
- **Tactic violada**: Exception Handling / Degradation
- **Localização**: `ConexosBaseClient.ts:154-162`, `services/conexos.ts:121`
- **Evidência (objetiva)**:
  ```
  retries: 2, timeout: 40000, até 2 leituras seriais → teórico ≈ 2 × 3 × 40 s = 240 s
  ```
- **Impacto técnico**: Conexos pendurado mantém a requisição Express aberta por minutos; o frontend aborta ao digitar de novo, mas o backend não cancela a leitura em curso.
- **Impacto de negócio**: diálogo "travado" e conexões ocupadas durante lentidão do ERP.
- **Métrica de baseline**: pior caso teórico 240 s vs alvo interativo < 10 s; latência real não medida.

### F-availability-3: Sem kill switch nem métrica da busca

- **Severidade**: P3
- **Tactic violada**: Removal from Service / Monitor
- **Localização**: delta inteiro (rotas e serviço)
- **Evidência (objetiva)**:
  ```
  grep de flag/alarme no delta: 0 ocorrências; operador só vê o log do retry
  ```
- **Impacto técnico**: se `#LIKE` se mostrar lento em produção, só um deploy desliga a busca.
- **Impacto de negócio**: baixo; fluxo alternativo por código permanece.
- **Métrica de baseline**: 0 flags/métricas dedicadas.

## 5. Cards Kanban

### [availability-1] Limitar taxa e orçamento de tempo da busca de favorecido

- **Problema**
  > A busca dispara 1–2 leituras `cmn025` por termo sem limite de taxa no backend, e o pior caso teórico de uma leitura é 3 tentativas × 40 s. Em lentidão do Conexos, a rota prende requisições e disputa o teto de sessões com a carteira SISPAG.

- **Melhoria Proposta**
  > Exception Prevention: rate limit por usuário na rota `/busca` e `/destino-atual`; orçamento total de tempo (ex.: deadline de ~10 s com `AbortSignal` repassado a `buscarPessoas`), sem retry após o deadline. Tocar `routes/sispag.ts`, `PayeeSearchService`, `ConexosSispagClient.buscarPessoas`.

- **Resultado Esperado**
  > Latência máxima da busca limitada (240 s teórico → ≤ 10 s) e taxa de leituras por usuário limitada; erro claro ao analista ao estourar.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - Pior caso da busca: 240 s teórico → ≤ 10 s
  - Limite de taxa no backend: 0 → 1 por usuário
- **Risco de não fazer**: em dia de lentidão do ERP, a busca de conveniência degrada a carteira SISPAG por contenção de sessões.
- **Dependências**: medir p95 real de `cmn025/list` (ver card 2).

### [availability-2] Instrumentar duração/resultado da busca e prever kill switch

- **Problema**
  > Não há métrica de duração/erro de `buscarPessoas` nem como desligar a busca sem deploy; a semântica e a latência do `#LIKE` nunca foram medidas ao vivo.

- **Melhoria Proposta**
  > Monitor: logar duração, nº de leituras e `truncado` via `LogService` em `PayeeSearchService`; flag de configuração (`EnvironmentProvider`) para desligar a busca e cair no pedido por código. Rodar a sonda `probe-cmn025-busca-hml` em HML com credencial válida.

- **Resultado Esperado**
  > p95 e taxa de erro observáveis (hoje: não medidos) e desligamento da busca em minutos sem deploy.

- **Tactic alvo**: Monitor / Removal from Service
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Métrica de duração da busca: ausente → p95 reportado
  - Kill switch: 0 → 1
- **Risco de não fazer**: decisão de SLO sem dado; incidente exige deploy para desligar.
- **Dependências**: credencial HML válida.

## 6. Notas do agente

- Escopo: delta read-only; sem P0/P1 (sem escrita, sem execução dupla, sem fan-out entre tenants; sem baseline numérico de impacto).
- Não existe `infra/`: DLQ, alarmes e blast radius multi-conta não medíveis; timeouts verificados só em `services/conexos.ts:121`.
- Cross-QA: rate limit e `Cache-Control: no-store` tocam qa-security/performance; retry×timeout toca qa-fault-tolerance.
