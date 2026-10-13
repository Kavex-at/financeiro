---
qa: Availability
qa_slug: availability
run_id: 2026-10-13-1518
agent: qa-availability
generated_at: 2026-10-13T15:40:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

Escopo: apenas o delta de `fix/sispag-sync-ao-abrir` contra `origin/main` (modo `--quick`, ADR-0066).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/sispag`, cron do GitHub (que rodou 2–3x/dia em vez de 12) e o botão "Sincronizar lotes" | Várias origens pedem a passada L11 ao mesmo tempo, ou o Conexos trava/rejeita credencial durante a passada | `SincronizacaoPassadaService` (advisory lock + `job_execucao`), rotas `/sispag/lotes/sincronizar*`, `SincronizarLotesSispagJob` | Operação normal, com o cron degradado e o pool Postgres de 5 conexões por processo | Uma passada por vez, leitura sempre servida do que está gravado (stale-while-revalidate), contenção vira `em_andamento`, falha vira `falha_recente` com cooldown | 0 passadas concorrentes; status de lote com idade ≤ 30 min a cada abertura; falha visível ao operador; nenhuma escrita no ERP |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passadas L11 simultâneas permitidas | 1 (`pg_try_advisory_lock`, chave exclusiva 726354820; vale entre servidor e runner) | 1 | ✅ | `SincronizacaoPassadaService.ts:13,85-93`; `PostgreeDatabaseClient.ts:210-231` |
| Conexões do pool ocupadas por passada | 1 cliente dedicado ao lock, mais as consultas da passada, de um pool de 5 | ≤ 50% do pool | ⚠️ não medido sob carga (a trava limita a 1 passada por vez) | `_shared-metrics.md` (pool = 5) |
| Teto de duração da passada sob a trava | Nenhum no delta (típico ~25 s; o GitHub Actions corta em 15 min) | Limite explícito | ⚠️ | `SincronizacaoPassadaService.ts:191-216`; workflow `timeout-minutes: 15` |
| Run `running` presa (processo morto) | Ignorada após 10 min (`RUN_PRESA_MS`) | ≤ 10 min | ✅ | `SincronizacaoPassadaService.ts:20,124-129` |
| Cooldown de falha na abertura | 5 min (`SISPAG_LOTES_SYNC_COOLDOWN_MIN`); o botão forçado ignora | Definido | ✅ | `SincronizacaoPassadaService.ts:130-140` |
| Passada que fecha em `error` vira exit ≠ 0 no cron | Sim ("nenhum título lido" é erro) | Sim | ✅ | `SincronizacaoPassadaService.ts:222-232`; `SincronizarLotesSispagJob.ts` |
| Escrita no ERP no delta | 0 (L11 só lê, I11a) | 0 | ✅ | `SincronizacaoPassadaService.ts:69` |
| Referências a `shared_account_id` no delta | 0 | 0 | ✅ | `git diff origin/main...HEAD` |
| Lacunas de teste de disponibilidade | Testes de unidade cobrem fresca/em_andamento/falha_recente/lock ocupado; backend 4058/4058 | Verde | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: alarmes CloudWatch e DLQ (não existe `infra/`), MTTR real e a idade real do status dos lotes em produção. Recomendação: expor "idade da última passada bem-sucedida" (já derivável de `job_execucao`) no painel de operação.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Ausente no delta | ❌ ausente | n/a |
| Heartbeat | O cron faz o papel de heartbeat, mas degradado (2–3x/dia) | ⚠️ parcial | `sincronizar-lotes-sispag.yml` |
| Monitor | `job_execucao` por passada + logs de início/fim; sem alarme ativo | ⚠️ parcial | `SincronizacaoPassadaService.ts:192-200,248-267` |
| Timestamp | `finishedAt` da última passada é o relógio do TTL | ✅ presente | `SincronizacaoPassadaService.ts:113-122` |
| Sanity Checking | "Todas as leituras falharam" fecha em `error`, não em `success` | ✅ presente | `SincronizacaoPassadaService.ts:222-232` |
| Condition Monitoring | Contadores de falhas de leitura, pulados e eventos não lidos nas métricas da run | ✅ presente | `SincronizacaoPassadaService.ts:233-241` |
| Voting | N/A: leitura de uma só fonte, sem réplicas computando o mesmo resultado | N/A | n/a |
| Exception Detection | try/catch em `rodar` redige a mensagem, fecha a run em `error` e loga | ✅ presente | `SincronizacaoPassadaService.ts:204-215` |
| Self-Test | Ausente | ❌ ausente | n/a |
| Active Redundancy | N/A: processo único por tenant | N/A | n/a |
| Passive Redundancy | Três gatilhos (tela, botão, cron) para a mesma passada; um cobre o outro quando o cron falha | ✅ presente | ADR-0066; workflow |
| Spare | N/A: sem infra própria | N/A | n/a |
| Exception Handling | Contenção (`IngestLockBusyError`) vira `em_andamento`, falha vira `falha_recente`; frontend mostra aviso | ✅ presente | `SincronizacaoPassadaService.ts:167-173`; `useCarteiraAoAbrir.ts` |
| Rollback | N/A: a passada só grava observação do ERP, sem escrita externa a desfazer | N/A | n/a |
| Software Upgrade | N/A fora do escopo do delta | N/A | n/a |
| Retry | Frontend reconfere até 6x a cada 8 s quando `em_andamento`; backend não faz retry interno | ⚠️ parcial | `useCarteiraAoAbrir.ts:6-9` |
| Ignore Faulty Behavior | Run `running` com mais de 10 min é ignorada | ✅ presente | `SincronizacaoPassadaService.ts:124-129` |
| Degradation | Stale-while-revalidate: a tela mostra o dado gravado quando o Conexos falha | ✅ presente | `useCarteiraAoAbrir.ts`; ADR-0066 |
| Reconfiguration | TTL e cooldown configuráveis por env | ✅ presente | `EnvironmentVars.ts:220-227` |
| Shadow | N/A: não há reintrodução de componente | N/A | n/a |
| State Resynchronization | A própria passada L11 ressincroniza o status dos lotes com o ERP | ✅ presente | `SincronizacaoPassadaService.ts:202` |
| Escalating Restart | N/A: sem supervisor próprio (Render reinicia o processo) | N/A | n/a |
| Non-Stop Forwarding | N/A | N/A | n/a |
| Removal from Service | Cooldown de 5 min tira o ERP do caminho após falha | ✅ presente | `SincronizacaoPassadaService.ts:130-140` |
| Transactions | Advisory lock mais run em `job_execucao`; a escrita de lote é de `SincronizacaoLoteService` (fora do delta) | ⚠️ parcial | `PostgreeDatabaseClient.ts:210` |
| Predictive Model | Ausente | ❌ ausente | n/a |
| Exception Prevention | Lock evita passadas concorrentes; Zod/permissão `sispag:ver` nas rotas | ✅ presente | `routes/sispag.ts` |
| Increase Competence Set | Passada tolera falha parcial (`partial`) sem abortar | ✅ presente | `SincronizacaoPassadaService.ts:223-229` |

## 4. Findings

### F-availability-1: passada sob a trava sem prazo máximo

- **Severidade**: P2
- **Tactic violada**: Exception Prevention (timeout) / Ignore Faulty Behavior
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoPassadaService.ts:85-93,191-216`
- **Evidência (objetiva)**:
  ```
  this.db.withAdvisoryLock(KEY, () => this.rodar(...), ...)   // sem deadline em sincronizarTodos()
  const RUN_PRESA_MS = 10 * MIN_MS;                             // libera a run, não a trava
  ```
  Se uma leitura do Conexos pendurar, a trava de sessão fica retida e cada abertura da tela recebe `em_andamento`. O limite é o `timeout-minutes: 15` do cron, ou o tempo que o processo do servidor levar para morrer.
- **Impacto técnico**: uma única chamada travada bloqueia todas as passadas (tela, botão e cron) enquanto durar. O delta não impõe prazo; o timeout do cliente Conexos não foi verificado neste escopo.
- **Impacto de negócio**: status de lote (REMESSA_GERADA → RETORNADO → BAIXADO) fica velho sem sinal claro para a analista.
- **Métrica de baseline**: passada típica ~25 s; teto no delta = ilimitado (cron: 15 min).

### F-availability-2: run `running` de processo morto bloqueia a abertura por até 10 min mesmo com a trava livre

- **Severidade**: P2
- **Tactic violada**: Ignore Faulty Behavior
- **Localização**: `SincronizacaoPassadaService.ts:123-129`
- **Evidência (objetiva)**:
  ```
  if (ultima?.status === RUNNING && agora - startedAt < RUN_PRESA_MS) return EM_ANDAMENTO
  ```
  A decisão de `em_andamento` usa só a linha de `job_execucao`. O lock é de sessão e é liberado quando a conexão morre. O estado real do lock não é consultado.
- **Impacto técnico**: depois de um deploy ou restart no meio da passada, as aberturas dentro de 10 min respondem `em_andamento` sem que ninguém esteja rodando. O botão forçado e o cron não sofrem disso, porque vão direto à trava.
- **Impacto de negócio**: janela curta de dado velho; recupera sozinha.
- **Métrica de baseline**: até 10 min de bloqueio por run morta.

### F-availability-3: falha da passada só é visível a quem abre a tela

- **Severidade**: P3
- **Tactic violada**: Monitor
- **Localização**: `SincronizacaoPassadaService.ts:204-215`; `useCarteiraAoAbrir.ts` (`setAviso`)
- **Evidência (objetiva)**: o resultado `error` vai para `job_execucao`, log e aviso na tela, sem alarme ativo. O cron fica vermelho, mas só roda 2–3x/dia. Sem `infra/`, nenhum alarme foi medido.
- **Impacto técnico**: uma credencial Conexos vencida (caso 23/09) pode passar horas sem notificação fora da tela.
- **Impacto de negócio**: retornos e baixas ficam sem refletir, e a descoberta depende do analista.
- **Métrica de baseline**: 0 alarmes sobre "idade da última passada bem-sucedida".

## 5. Cards Kanban

### [availability-1] Impor prazo máximo à passada L11 sob a trava

- **Problema**
  > A passada L11 roda sob advisory lock sem deadline. Uma leitura pendurada no Conexos retém a trava e todas as aberturas da tela recebem `em_andamento` até o cron de 15 min cortar.
- **Melhoria Proposta**
  > Envolver `sincronizarTodos()` em um deadline (por exemplo 3 min, via `AbortSignal`/`Promise.race`) que feche a run em `error` e libere a trava. Conferir o timeout do cliente Conexos de leitura. Arquivo: `SincronizacaoPassadaService.ts`.
- **Resultado Esperado**
  > Trava retida no máximo pelo prazo configurado (hoje: ilimitado → alvo: ≤ 3 min), com falha registrada e cooldown aplicado.
- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Teto de duração da passada: ilimitado → ≤ 3 min
- **Risco de não fazer**: um incidente de lentidão do Conexos congela a sincronização de status até o processo reiniciar.
- **Dependências**: nenhuma

### [availability-2] Confirmar o estado real da trava antes de responder `em_andamento`

- **Problema**
  > A abertura devolve `em_andamento` com base na linha `running` de `job_execucao`, mesmo quando a trava está livre (processo morto após deploy).
- **Melhoria Proposta**
  > Em `sincronizarSeDefasada`, tratar `running` como indício e deixar a trava decidir: tentar `executarPassada` e converter `IngestLockBusyError` em `em_andamento` (já feito em `rodarOuEmAndamento`). Alternativa: reduzir `RUN_PRESA_MS`.
- **Resultado Esperado**
  > Janela de bloqueio indevido de até 10 min → ≈ 0 após restart.
- **Tactic alvo**: Ignore Faulty Behavior
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Bloqueio após run morta: ≤ 10 min → ≈ 0
- **Risco de não fazer**: dado de lote velho por alguns minutos após cada deploy.
- **Dependências**: nenhuma

### [availability-3] Alertar quando a última passada bem-sucedida passa de um limite

- **Problema**
  > A única notificação de falha é o aviso na tela de quem abre e o cron vermelho, que roda 2–3x/dia.
- **Melhoria Proposta**
  > Expor a idade da última passada `success`/`partial` no painel de operação e notificar quando passar de N horas úteis (Monitor). Reaproveitar os dados de `job_execucao`.
- **Resultado Esperado**
  > Detecção de credencial vencida ou Conexos fora em horas, sem depender de um analista abrir a tela.
- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Alarmes sobre idade da sincronização: 0 → 1
- **Risco de não fazer**: repetir o padrão de 23/09, com falha silenciosa descoberta pelo usuário.
- **Dependências**: painel de operação existente

## 6. Notas do agente

- Escopo restrito ao delta; modo `--quick` (testes não reexecutados, usei `_shared-metrics.md`).
- Não verifiquei o timeout do cliente Conexos de leitura nem `SincronizacaoLoteService` (fora do delta); F-availability-1 depende disso.
- Sem P0/P1: o delta é read-only no ERP e a trava serializa as passadas, então não há risco de escrita duplicada ou de efeito entre tenants.
