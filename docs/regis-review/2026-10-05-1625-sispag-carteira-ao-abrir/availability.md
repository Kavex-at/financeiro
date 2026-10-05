---
qa: Availability
qa_slug: availability
run_id: 2026-10-05-1625
agent: qa-availability
generated_at: 2026-10-05T16:40:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta sispag-carteira-ao-abrir)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/sispag` (e o cron do GitHub, que atrasa 2–5 h) | Carteira gravada com mais de 30 min, ou o Conexos recusando a ingestão (403 do robô, sessão esgotada) | `CarteiraAtualizacaoService`, rota `POST /sispag/carteira/atualizar`, hook `useCarteiraAoAbrir` | Operação normal, Express/Render, várias pessoas abrindo a tela ao mesmo tempo | Mostra o que está gravado (stale-while-revalidate). Roda no máximo uma ingestão (TTL, lock, cooldown). Falha vira aviso, não tela quebrada | 0 ingestões concorrentes; no máximo 1 tentativa a cada 5 min após falha; tela utilizável com dado gravado em 100% dos casos de falha do ERP |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Suítes/testes backend | 198 / 3644 passam | 100% | ✅ | `_shared-metrics.md` |
| Suítes/testes frontend (sispag+lib) | 16 / 197 passam | 100% | ✅ | `_shared-metrics.md` |
| Freios contra rajada no Conexos | 3 (TTL 30 min, lock da ingestão, cooldown 5 min pós-falha) | ≥ 2 | ✅ | `CarteiraAtualizacaoService.ts:78-96,108` |
| Duração da ingestão (síncrona) | ~9 s (7 filiais, ~1,4 mil títulos) | < 30 s | ✅ | log do cron de 04/10 |
| Espera máxima do hook em `em_andamento` | 6 × 8 s ≈ 48 s | > duração da ingestão | ✅ | `useCarteiraAoAbrir.ts:7-9` |
| Timeout explícito na chamada `fetch` do front à rota nova | ausente em `atualizarCarteiraSeDefasada` (depende de `apiFetch`, não auditado) | explícito | ⚠️ | `lib/sispag.ts:899-913` |
| Atraso do cron agendado | 2–5 h (07:00 BRT saiu 11:29–13:48 BRT) | < 15 min | ❌ (mitigado pelo delta) | `_shared-metrics.md` |
| Reaper a cada 15 min pedido | rodou a cada ~3–6 h | 15 min | ❌ (fora do delta) | `_shared-metrics.md` |
| Backend: ocorrências de `shared_account_id` | N/A: sem `infra/` nem tenants | 0 | N/A | CLAUDE.md |
| Alarmes / DLQ / razão de Executors | ⚠️ **Não medível localmente**: não existe `infra/`; delta não cria fila nem client externo novo | — | ⚠️ | — |
| MTTR real / tempo de dado velho visto pelo analista | ⚠️ **Não medível localmente**: requer logs de produção. Recomendação: registrar `idadeMin` devolvido pela rota como métrica | — | ⚠️ | — |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Ausente no delta | ❌ ausente | — |
| Heartbeat | Cron só 3x/dia; não é heartbeat da carteira | ❌ ausente | `ingest-sispag.yml` |
| Monitor | `pagamento_ingestao_run` audita cada run; sem alarme | ⚠️ parcial | `CarteiraAtualizacaoService.ts:82` |
| Timestamp | `findLatestSuccessFinishedAt` e `idadeMin` medem a idade do dado | ✅ presente | `:70-76` |
| Sanity Checking | Valor inválido ou ≤ 0 de TTL/cooldown cai no default | ✅ presente | `EnvironmentProvider.ts` (`readMinutos`) |
| Condition Monitoring | Run `running` > 10 min tratada como morta | ✅ presente | `:13,83` |
| Voting | Sem componentes replicados | N/A | Um único ingestor por desenho |
| Exception Detection | `IngestLockBusyError` distinguido de falha real; demais erros sobem | ✅ presente | `:106-111` |
| Self-Test | Ausente | ❌ ausente | — |
| Active Redundancy | Sem réplica | N/A | Servidor único em Render |
| Passive Redundancy | O cron é a segunda via de atualização (3x/dia em dias úteis) | ⚠️ parcial | `ingest-sispag.yml` |
| Spare | Ausente | ❌ ausente | — |
| Exception Handling | Falha vira `falha_recente` ou aviso, sem derrubar a tela | ✅ presente | `useCarteiraAoAbrir.ts:49-53,65-69` |
| Rollback | A ingestão é anti-fantasma por filial, sem rollback novo | ⚠️ parcial | `_shared-metrics.md` |
| Software Upgrade | Fora do escopo | N/A | Sem mudança de runtime no delta |
| Retry | Hook reconfere 6x com espera de 8 s apenas em `em_andamento`; sem retry de erro HTTP (correto, evita martelar) | ⚠️ parcial | `useCarteiraAoAbrir.ts:42-58` |
| Ignore Faulty Behavior | Cooldown pós-falha ignora novas tentativas por 5 min | ✅ presente | `:86-96` |
| Degradation | Stale-while-revalidate: a tela serve o gravado se o ERP falha | ✅ presente | `useCarteiraAoAbrir.ts:16-19` |
| Reconfiguration | TTL e cooldown ajustáveis por env | ⚠️ parcial | `EnvironmentVars.ts` |
| Shadow | Sem modo sombra | N/A | Sem componente reintroduzido |
| State Resynchronization | Ao terminar, `aoAtualizar` recarrega o painel | ✅ presente | `useCarteiraAoAbrir.ts:46,61` |
| Escalating Restart | Ausente | ❌ ausente | — |
| Non-Stop Forwarding | N/A | N/A | Sem roteamento redundante |
| Removal from Service | Run presa não bloqueia mais; sem desligar filial doente | ⚠️ parcial | `:13` |
| Transactions | Ingestão com lock advisory e run auditada | ✅ presente | `IngestLockBusyError` |
| Predictive Model | Ausente | N/A | Prematuro para o volume |
| Exception Prevention | Lock, TTL e cooldown evitam ingestão simultânea | ✅ presente | `:78-96` |
| Increase Competence Set | Rota não forma lote; só lê o ERP (I1) | ✅ presente | `routes/sispag.ts:601-604` |

## 4. Findings (achados)

### F-availability-1: Run `running` morta bloqueia a tela por até 10 min, sem sair do estado

- **Severidade**: P2 (sem baseline de ocorrência em produção)
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:13,83-85`
- **Evidência (objetiva)**:
  ```
  if (ultima?.status === 'running' && agora - Date.parse(ultima.startedAt) < RUN_PRESA_MS) → em_andamento
  ```
  O hook desiste após 6 × 8 s ≈ 48 s; a janela de run presa é de 10 min (12x maior).
- **Impacto técnico**: Se o processo cair entre `createRun` e `finishRun`, durante 10 min toda abertura de tela responde `em_andamento`, e o hook gasta ~48 s e termina em `ocioso` sem aviso ao analista.
- **Impacto de negócio**: O analista vê a carteira velha sem saber que a atualização não vai acontecer. Fica sem a informação de idade do dado.
- **Métrica de baseline**: janela do backend 10 min contra espera do front ≈ 48 s. A frequência de runs mortas em produção não é medível localmente.

### F-availability-2: Esgotar as tentativas termina em `ocioso` sem aviso

- **Severidade**: P2
- **Tactic violada**: Exception Handling (Degradation sem sinalização)
- **Localização**: `src/frontend/app/sispag/useCarteiraAoAbrir.ts:42-64`
- **Evidência (objetiva)**: depois de 6 respostas `em_andamento` o laço sai e executa `setSituacao('ocioso')`, sem `aviso`. A resposta traz `idadeMin`, mas o hook não a expõe.
- **Impacto técnico**: Falha silenciosa do refresh, e o dado exibido pode estar defasado sem indicação.
- **Impacto de negócio**: Decisão sobre títulos a pagar tomada com carteira velha sem o analista saber. Sobre este ponto, o cron atrasa 2–5 h (medido), então a idade é relevante.
- **Métrica de baseline**: 0 avisos de idade da carteira na UI; cron atrasa 2–5 h.

### F-availability-3: Chamada `fetch` da rota síncrona sem timeout/abort explícito

- **Severidade**: P2
- **Tactic violada**: Exception Prevention
- **Localização**: `src/frontend/lib/sispag.ts:899-913`
- **Evidência (objetiva)**: nenhum `AbortSignal` ou `timeout` em `atualizarCarteiraSeDefasada`; o `apiFetch` não foi auditado neste delta. A rota é síncrona (~9 s medidos) e depende do Conexos.
- **Impacto técnico**: Se o Conexos pendurar, a requisição fica aberta até o limite do Render/navegador, com `situacao='atualizando'` indefinida. O servidor também não impõe timeout nessa chamada.
- **Impacto de negócio**: Indicador de "atualizando" preso. Sem perda de dado, pois o painel gravado continua visível.
- **Métrica de baseline**: timeout explícito presente em 0 de 1 chamada nova; duração normal ~9 s.

## 5. Cards Kanban

### [availability-1] Avisar a idade da carteira quando o refresh não conclui

- **Problema**
  > Ao esgotar as 6 reconferências ou diante de uma run presa de até 10 min, o hook termina em `ocioso` sem aviso, embora a rota já devolva `idadeMin` (F-availability-1/2).
- **Melhoria Proposta**
  > Expor `idadeMin`/`ultimaIngestaoEm` no hook e mostrar o aviso "carteira de N min atrás, atualização em andamento" quando as tentativas acabarem. Avaliar reduzir `RUN_PRESA_MS` ou alinhá-lo com a espera do front. Tactic: Degradation.
- **Resultado Esperado**
  > O analista sempre sabe a idade do dado: avisos de idade na UI 0 → 1 por refresh não concluído.
- **Tactic alvo**: Degradation
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - Refresh sem conclusão com aviso de idade: 0% → 100%
- **Risco de não fazer**: Decisões de pagamento com dado velho sem sinalização, enquanto o cron segue atrasando 2–5 h.
- **Dependências**: nenhuma

### [availability-2] Impor timeout/abort na chamada de atualização da carteira

- **Problema**
  > `atualizarCarteiraSeDefasada` não define timeout e a rota síncrona depende do Conexos (F-availability-3).
- **Melhoria Proposta**
  > `AbortSignal.timeout` de ~60 s no front (acima do ~9 s medido e do laço de 48 s) e confirmar o timeout do lado do servidor. Tactic: Exception Prevention.
- **Resultado Esperado**
  > Estado "atualizando" tem limite. Chamadas novas sem timeout: 1 → 0.
- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Tempo máximo em `atualizando`: indefinido → ≤ 60 s
- **Risco de não fazer**: Indicador preso quando o Conexos pendurar, mascarando a falha.
- **Dependências**: nenhuma

### [availability-3] Instrumentar idade da carteira e resultado do refresh

- **Problema**
  > Não há métrica de produção para MTTR nem para a idade do dado vista pelo analista, e o cron atrasa 2–5 h (medido).
- **Melhoria Proposta**
  > Logar via `LogService` o estado devolvido (`fresca`/`atualizada`/`em_andamento`/`falha_recente`) e `idadeMin`, para derivar a taxa de falha e a idade na abertura. Tactic: Monitor.
- **Resultado Esperado**
  > Taxa de `falha_recente` e p95 de `idadeMin` consultáveis: hoje não medível → medível.
- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Estados do refresh registrados: 0% → 100% das chamadas
- **Risco de não fazer**: Continuar sem número para defender investimento em disponibilidade da carteira.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito aos commits do delta. Sem `infra/`, DLQ, alarmes e razão de Executors são não medíveis e foram omitidos como achados.
- Ponto positivo: TTL, lock e cooldown protegem o Conexos de uma ingestão por abertura de tela; a falha degrada para o dado gravado.
- Cross-QA: o atraso do cron (2–5 h) e o reaper a cada 3–6 h são de deployability. Os três achados são P2 por falta de baseline de ocorrência em produção.
