---
qa: Availability
qa_slug: availability
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-availability
generated_at: 2026-08-28T16:20:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Render Cron Scheduler (novo `financeiro-ingest-permutas`, `0 9 * * * UTC` = 06:00 BRT) + analista clicando "Ingerir" | Duas ingestões concorrentes no mesmo minuto **ou** falha silenciosa do Conexos `com308/financeiroAPagar/list` durante o fan-out de ~1146 invoices/filial | Job `src/backend/jobs/ingest-permutas.ts` → `IngestaoPermutasService` → `EleicaoPermutasService.hidratarInvoiceNegociada` (com308) → tabela `permuta_invoice` | Produção (Render `starter` cron + backend web único; sem multi-região, sem HML de cron) | (a) o job perdedor do `pg_try_advisory_lock` deve sair como *no-op* sem poluir alertas; (b) surto de erros no com308 degrada o dado (`pago=false` no piso conservador) sem esconder invoice liquidada; (c) frescor da última ingestão bem-sucedida é observável por analista e operador | (a) 0 alertas falso-positivos por corrida cron×analista; (b) MTTD < 1 dia para "cron nunca rodou" (hoje: ∞); (c) taxa de fallback `undefined` em `derivarPagoDosTitulos` visível em métrica (hoje: 0 métricas) |

> Cenário derivado do DELTA sob revisão (`git diff 617ca3b..48abd7b`). O bug original — `pago` vindo da row do `com298/list` que devolve `mnyTitAberto`/`mnyTitPago` null em **1146/1146** INVOICEs da filial 2 (`src/backend/jobs/probe-invoice-pago.ts`, 2026-08-28) — é uma FALHA DE DISPONIBILIDADE DO DADO já corrigida no delta pelo `derivarPagoDosTitulos`. O que resta é observabilidade do novo cron e do fallback.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de `RetryExecutor` no caminho crítico do delta (com308 `list` + `getDetalhe`) | 100% (2/2 endpoints envolvidos usam `base.runWithRetry` ou `base.callList`) | 100% | ✅ | `src/backend/domain/client/ConexosTitulosClient.ts:184-224` |
| INVOICEs com `pago` derivável do wire antigo (`com298/list`) | 0/1146 (0.0%) filial 2 | ≥95% (ou trocar a fonte — feito no delta) | ✅ mitigado pelo fix | `probe-invoice-pago.ts` (PRD 2026-08-28), citado em `ConexosTitulosClient.ts:46-56` |
| Concordância `derivarPagoDosTitulos(com308)` × `getDetalheTitulos` (ground truth) | 30/30 (100%) | ≥99% | ✅ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:88-96` (validado ao vivo) |
| Alertas configurados no cron `financeiro-ingest-permutas` (falha de execução, cron missed run, timeout) | 0 (nenhum `notificationEmail`, `notify:` ou webhook no `render.yaml`) | ≥1 (falha do cron notifica humano) | ❌ | `render.yaml:97-133` — bloco `cron` não declara notificações |
| Tratamento de `IngestLockBusyError` no entrypoint do cron | Não distingue de erro real: `catch → console.error → process.exit(1)` | Exit code 0 (no-op) OU code distinto que o alarme ignore | ❌ | `src/backend/jobs/ingest-permutas.ts:31-38`; erro em si em `src/backend/domain/errors/IngestLockBusyError.ts:14-26` |
| Health check de FRESCOR da ingestão (idade da última run `success`) | Ausente. `formatRunWhen` só formata a data; a UI mostra "últ. ingestão: dd/mm · HHhMM" sem threshold visual, sem alerta backend | Warning na UI quando idade > 24h; alerta operador quando > 48h | ❌ | `src/frontend/app/permutas/components/format.ts:69-80` (formata mas não avalia); `src/frontend/app/permutas/page.tsx:648-655` (renderiza sem sinal) |
| Instrumentação da taxa de fallback conservador (`derivarPagoDosTitulos → undefined` OU `catch {}` do com308) | 0 métricas / 0 contadores. 3 `catch {}` silenciosos no `EleicaoPermutasService.ts` (linhas 563, 622, 858) — os dois primeiros no caminho de hidratação de invoice | ≥1 contador por caminho de fallback (Warn log com `LOG_TYPE.BUSINESS_WARN` já usado em outros pontos do serviço) | ❌ | `grep -n "catch {" src/backend/domain/service/permutas/EleicaoPermutasService.ts` |
| `preDeployCommand` / migração antes do web trocar tráfego | ✅ presente para o serviço web (`npm run migrate && npm run seed:admin`) | Deve existir | ✅ | `render.yaml:24` |
| Env sync entre web e cron (divergência = "pior que não ter cron", conforme o próprio comentário do delta) | Manual: 8 chaves com `sync: false` no cron; validação de paridade com o web é humana | Verificação automática (script de deploy ou lint do blueprint) | ⚠️ | `render.yaml:117-133`, comentários do próprio autor em `render.yaml:82-83` |
| Fan-out do cron sob `MAX_SESSIONS` do Conexos | `FILIAIS_CONCURRENCY=5`, `ADIANTAMENTOS_CONCURRENCY=10` (constantes) — MESMO limite do trigger manual, sem histerese específica para o cron | Explicitar um teto agregado por *tenant Conexos* (hoje só existe por *filial* dentro da run) | ⚠️ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:115-116` |

> ⚠️ **Não medível localmente**: MTTR real e MTTD de "cron não rodou". Requer histórico do Render (Events/Logs) e telemetria (que ainda não existe). Recomendação: instrumentar `findLatestIngestFinishedAt()` como métrica exportada (Prometheus/Datadog/CloudWatch) e criar alerta `age(last_success_ingest) > 24h`. Alternativa leve: cron secundário (ou probe do `/health`) que consulta `permuta_eleicao_run WHERE kind='ingest' AND status='success' ORDER BY finished_at DESC LIMIT 1` e falha se > 24h.

> ⚠️ **Não medível localmente**: taxa de falha real do com308 em PRD que dispara o fallback `derivarPagoDosTitulos → undefined`. Requer logs. Recomendação: substituir os 3 `catch {}` por `logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'com308 indisponível para invoice X — pago em piso conservador' })` — o padrão já existe em `EleicaoPermutasService.ts:190,303,451`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Ping/Echo** | N/A no contexto — não há malha de serviços internos que se pinguem; a única dependência viva é o Conexos, que não expõe echo | N/A | — |
| **Heartbeat** | Ausente para o novo cron. Não há batida periódica do job que o web/monitor possa consumir; a única evidência de vida é `permuta_eleicao_run.finished_at` | ❌ | ausência em `render.yaml:97-133` e `src/backend/jobs/ingest-permutas.ts` |
| **Monitor** | `/health` no serviço web (`render.yaml:22`) monitora processo; NÃO monitora frescor de dados nem cron | ⚠️ parcial | `render.yaml:22`; frescor exposto mas não alertado em `PermutaSnapshotRepository.ts:260-269` |
| **Timestamp** | ✅ `last_ingest_run_id`, `last_seen_at`, `permuta_eleicao_run.finished_at` — trilha completa | ✅ | `PermutaRelationalRepository.ts:268-291`, `PermutaSnapshotRepository.ts:260` |
| **Sanity Checking** | ✅ `derivarPagoDosTitulos` valida `titulos.length > 0` e presença de `valorBrl`/`valorPago` antes de decidir — retorna `undefined` (não `false`) em caso de dado incompleto, evitando conclusão errada | ✅ | `EleicaoPermutasService.ts:104-113` |
| **Condition Monitoring** | Ausente. Não há monitor da condição "idade da última ingestão"; a UI mostra a data mas não sinaliza degradação | ❌ | `src/frontend/app/permutas/page.tsx:648-655` |
| **Voting** | N/A — não há redundância de fonte para o `pago`; o delta consolidou a fonte no com308. `getDetalheTitulos` existe como ground truth mas só é consultado por probe/validate scripts | N/A | — |
| **Exception Detection** | ⚠️ Parcial. `ConexosError` é lançado quando o retry esgota no `getDetalheTitulos` (`ConexosTitulosClient.ts:217-222`), MAS os `catch {}` silenciosos em `EleicaoPermutasService.ts:563,622,858` engolem a exceção sem log, sem contador. A degradação (`pago=false` no piso) é intencional; a INVISIBILIDADE é o defeito | ⚠️ | `grep -n "catch {" src/backend/domain/service/permutas/EleicaoPermutasService.ts` (3 hits) |
| **Self-Test** | Ausente. Não há preflight do próprio job (ex.: chamada de smoke ao com308 antes do fan-out) | ❌ | `src/backend/jobs/ingest-permutas.ts` — vai direto para `service.executar()` |
| **Active Redundancy** | N/A — cron único no Render, sem *stand-by* ativo | N/A | — |
| **Passive Redundancy** | N/A — mesmo motivo | N/A | — |
| **Spare** | N/A no PaaS Render (não há capacidade reserva provisionada) | N/A | — |
| **Exception Handling** | ✅ `ConexosError` tipado; `IngestLockBusyError` tipado; o próprio handler HTTP mapeia para 409. Cabeçalho de erro gravado FORA da transação preserva auditoria | ✅ | `IngestaoPermutasService.ts:172-207`, `IngestLockBusyError.ts:14-26` |
| **Rollback** | ✅ `withTransaction` no ingest; ROLLBACK preserva last-good; comentário explícito no delta | ✅ | `IngestaoPermutasService.ts:53-72` (contexto) |
| **Software Upgrade** | ⚠️ Deploy Render nativo (`autoDeploy: true` no web) — sem canário, sem *blue/green*. Cron é redeployado junto quando o blueprint muda | ⚠️ | `render.yaml:16,22` |
| **Retry** | ✅ `RetryExecutor` via `base.runWithRetry`/`base.callList` no com308 (`ConexosTitulosClient.ts:184,231`) | ✅ | `ConexosTitulosClient.ts:184` |
| **Ignore Faulty Behavior** | ⚠️ USADO como default nos `catch {}` silenciosos — a intenção é degradar (invoice segue visível), mas sem log/contador vira "ignorar sem saber quanto" | ⚠️ | `EleicaoPermutasService.ts:563,622,858` |
| **Degradation** | ✅ Estratégia central do delta: `derivarPagoDosTitulos → undefined` mantém `pago=false` no piso conservador. Comentário no código é explícito: "esconder uma invoice em aberto tira dinheiro do radar; mostrar uma paga só incomoda" | ✅ | `EleicaoPermutasService.ts:88-113,622-627` |
| **Reconfiguration** | N/A no delta | N/A | — |
| **Shadow** | ✅ como *test artifact* — as sondas `probe-invoice-pago.ts` e `validate-invoice-pago-detalhe-v1.ts` rodam READ-ONLY em PRD e comparam LISTA×DETALHE (30/30). Em produção contínua, ausente | ⚠️ | `src/backend/jobs/probe-invoice-pago.ts`, `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts` |
| **State Resynchronization** | ✅ *staleness sweep* (`stale=true` no que não foi visto no run) reintroduz consistência após uma run parcial | ✅ | `PermutaRelationalRepository.ts:460-479` |
| **Escalating Restart** | N/A — cron do Render é one-shot; restart é a próxima execução (24h depois) | N/A | — |
| **Non-Stop Forwarding** | N/A — não há tráfego real-time para *bypassar* | N/A | — |
| **Removal from Service** | ⚠️ Não há kill-switch do cron análogo ao `SISPAG_LIVE_WRITE_ENABLED`/`RECEBIMENTOS_ENABLED`. Para desligar o cron em incidente, é preciso editar o blueprint ou o dashboard do Render | ⚠️ | `render.yaml:97-133`; contrastar com `render.yaml:35,45` |
| **Transactions** | ✅ `pg_try_advisory_lock` + `withTransaction` serializam ingest × trigger manual | ✅ | `IngestaoPermutasService.ts:53-72`, `PostgreeDatabaseClient.ts:147` |
| **Predictive Model** | N/A no escopo do delta | N/A | — |
| **Exception Prevention** | ✅ `derivarPagoDosTitulos` devolve `undefined` explicitamente quando não pode concluir (guarda contra `NaN`/decisão errada); campo `valorPago?` opcional em `TituloAPagar` evita confusão "0 pago" × "não sei" | ✅ | `ConexosTitulosClient.ts:43-56`, `EleicaoPermutasService.ts:104-113` |
| **Increase Competence Set** | ✅ `derivarPagoDosTitulos` amplia o set do sistema para lidar com o defeito estrutural do wire do Conexos (`com298/list` que não popula saldo) sem depender de conserto do fornecedor | ✅ | `EleicaoPermutasService.ts:88-113` |

## 4. Findings (achados)

### F-availability-1: Cron `financeiro-ingest-permutas` sem alerta de falha nem de execução perdida

- **Severidade**: P1
- **Tactic violada**: Monitor / Heartbeat
- **Localização**: `render.yaml:97-133`
- **Evidência (objetiva)**:
  ```
  $ grep -n "notificationEmail\|notify\|slack" render.yaml
  (sem resultado — nenhum canal declarado)

  $ sed -n '99,105p' render.yaml
  - type: cron
    name: financeiro-ingest-permutas
    schedule: '0 9 * * *'
    buildCommand: npm ci && npm run build
    startCommand: npm run job:ingest-permutas
  ```
- **Impacto técnico**: se o Render deixar de disparar o cron (bug de plataforma, plano suspenso, blueprint inválido após próximo deploy) ou se o job falhar recorrentemente, ninguém é notificado. O sintoma reaparece: dados envelhecem, invoices liquidadas voltam a poluir a aba "em aberto" 24h após a última run bem-sucedida.
- **Impacto de negócio**: o próprio delta se apresenta como correção da regressão que a Simone relatou (invoice paga visível na tela). Sem alerta de frescor, a mesma classe de sintoma retorna quando o cron para — e o operador só descobre pelo mesmo canal atual: relato de usuário.
- **Métrica de baseline**: 0 alertas configurados; 1 canal de detecção humano (usuário reclamando). Idade máxima tolerada não formalizada.

### F-availability-2: Cron perdedor do lock exita com código 1 e vira "falha" no Render

- **Severidade**: P2 (rebaixado de P1 por não haver alerta que dispare hoje; passa a P1 no dia em que F-availability-1 for corrigido)
- **Tactic violada**: Exception Handling / Sanity Checking do exit code
- **Localização**: `src/backend/jobs/ingest-permutas.ts:31-38` × `src/backend/domain/errors/IngestLockBusyError.ts:14-26`
- **Evidência (objetiva)**:
  ```typescript
  // ingest-permutas.ts (job entry — não distingue tipos de erro)
  main()
      .then(() => process.exit(0))
      .catch((error) => {
          console.error('[ingest-permutas] ingestion FAILED:', ...);
          process.exit(1);
      });

  // IngestLockBusyError.ts (o próprio erro documenta que NÃO é falha)
  * It is NOT a failure: no data moved, nothing was written. The manual-trigger
  * flow (ADR-0006) deliberately BLOCKS a concurrent run instead of double-firing
  ```
- **Impacto técnico**: se um analista clicar em "Ingerir" entre 06:00 e o fim da run do cron (ou vice-versa), o perdedor sai com code 1. O Render marca a execução do cron como "failed". Quando (F-1) alertas existirem, este será o primeiro falso-positivo — ruído clássico que erode confiança no alerta.
- **Impacto de negócio**: sem F-1 corrigido, o efeito é só ruído nos logs do Render. Com F-1 corrigido, alerta noturno acionando por corrida benigna cansa o operador e a métrica MTTR fica poluída.
- **Métrica de baseline**: 1 erro tipado (`IngestLockBusyError`) tratado idem a `ConexosError`/`TypeError`/etc. no entrypoint do cron. Distinção de exit code = 0 (planejada).

### F-availability-3: Ausência de health check de frescor da ingestão na UI e no backend

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/frontend/app/permutas/components/format.ts:69-80`, `src/frontend/app/permutas/page.tsx:648-655`, `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:260-269`
- **Evidência (objetiva)**:
  ```typescript
  // format.ts — apenas formata, sem julgar frescor
  export function formatRunWhen(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    // ... só retorna "dd/mm · HHhMM"
  }

  // page.tsx — renderiza plain text, sem cor/aviso
  {data?.geradoEm ? (
    <span className="mr-1 whitespace-nowrap text-xs text-muted-foreground"
          title="Conclusão da última ingestão bem-sucedida">
      últ. ingestão: {formatRunWhen(data.geradoEm)}
    </span>
  ) : null}
  ```
- **Impacto técnico**: `findLatestIngestFinishedAt()` já existe (`PermutaSnapshotRepository.ts:260-269`) e já é lido em `GestaoPermutasService.ts:61`. Falta um comparador `age > threshold` que degrade a UI (badge amarelo/vermelho) e/ou um endpoint `/permutas/health` que devolva 503 se `age > 48h`.
- **Impacto de negócio**: sem sinal visual, a analista aceita silenciosamente o carimbo desatualizado — exatamente a condição que produz o sintoma "invoice liquidada aparece" (o dado é retrato do momento da ingestão, conforme o próprio comentário do `render.yaml:82-87`).
- **Métrica de baseline**: 0 thresholds implementados; 1 endpoint candidato faltando (`/permutas/health` ou equivalente); 0 componentes de UI sinalizando degradação.

### F-availability-4: `catch {}` silencioso em 3 pontos do fan-out do com308 apaga a taxa de fallback

- **Severidade**: P2
- **Tactic violada**: Exception Detection / Ignore Faulty Behavior (mal-aplicada)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:563,622,858`
- **Evidência (objetiva)**:
  ```
  $ grep -n "catch {" src/backend/domain/service/permutas/EleicaoPermutasService.ts
  563:                } catch {
  622:        } catch {
  858:            } catch {
  ```
  Os três estão no fan-out do `listTitulosAPagar` do com308. A linha 622 é a que o delta editou e cujo comentário agora diz "segue sem valor negociado e com `pago` no piso conservador". O comportamento é INTENCIONAL (degradação); a AUSÊNCIA DE MÉTRICA não é.
- **Impacto técnico**: um surto de erros do com308 (Conexos MAX_SESSIONS, 5xx, timeout após o RetryExecutor esgotar) degrada silenciosamente TODAS as invoices afetadas — cada uma volta a ser exibida como "em aberto" (piso conservador). Sem contador/warn, o operador não consegue diferenciar "10% de fallback (aceitável)" de "90% de fallback (o com308 caiu)".
- **Impacto de negócio**: cenário exato do sintoma que motivou o delta reaparece — invoices liquidadas na tela — mas por causa nova (indisponibilidade do com308 em vez do bug do `com298/list`). Diagnóstico só via inspeção manual de logs do Conexos.
- **Métrica de baseline**: 3 catches silenciosos vs. ≥6 usos corretos de `logService.warn`/`.error` no MESMO arquivo (linhas 190, 303, 355, 429, 451, 699). Padrão existe; adoção parcial.

### F-availability-5: Fan-out do cron reutiliza limites do trigger manual sem gate específico

- **Severidade**: P3
- **Tactic violada**: Removal from Service (kill-switch) / Reconfiguration
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:115-116`, `render.yaml:97-133`
- **Evidência (objetiva)**:
  ```typescript
  const FILIAIS_CONCURRENCY = 5;
  const ADIANTAMENTOS_CONCURRENCY = 10;
  ```
  Constantes de módulo — o cron das 06:00 usa exatamente o mesmo teto que um analista clicando em "Ingerir" no meio da tarde. Sob `LOGIN_ERROR_MAX_SESSIONS` do Conexos (~3 slots por usuário), o cron pode competir com Recebimentos/SISPAG rodando na mesma janela.
- **Impacto técnico**: um incidente no Conexos que force reduzir carga não pode ser aplicado só ao cron (o menos crítico em tempo real) sem afetar o clique manual. Não há env var equivalente a `PERMUTAS_INGEST_ENABLED` para "pausar o cron sem redeploy".
- **Impacto de negócio**: em incidente Conexos, o operador não tem alavanca fina — ou desliga o cron editando o blueprint (bloqueia ingestão automática por 24h+), ou aceita a competição pelas ~3 sessões. Baixa severidade porque hoje o volume observado (ver DELTA) cabe folgado no fan-out atual.
- **Métrica de baseline**: 0 env vars de gate para o cron (contrastar com `SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED` no `render.yaml:35,45`); 1 constante hardcoded compartilhada.

## 5. Cards Kanban

### [availability-1] Instrumentar alerta de frescor da ingestão de Permutas

- **Problema**
  > O novo cron `financeiro-ingest-permutas` (Render, `0 9 * * *` UTC) roda sem nenhum canal de notificação: `render.yaml:97-133` não declara `notificationEmail`, webhook nem integração. Se o cron parar de disparar ou o job passar a falhar por regressão, ninguém sabe até um usuário reclamar — que é exatamente o canal atual (Simone relatou o sintoma que gerou este delta). O dado envelhece silenciosamente e o `derivarPagoDosTitulos` corrigido no delta perde efeito na prática porque a ingestão para de rodar.

- **Melhoria Proposta**
  > Aplicar **Monitor + Condition Monitoring** de Bass em dois níveis: (1) alerta ao operador quando o cron falha, via `notify:` no `render.yaml` ou integração Render→Slack; (2) *health-check de frescor* no backend — endpoint `GET /permutas/health` (ou expor no `/health` existente) que lê `PermutaSnapshotRepository.findLatestIngestFinishedAt()` e devolve 503 se `age > 24h`. Complementar: badge visual em `src/frontend/app/permutas/page.tsx:648-655` — atualmente só formata a data via `formatRunWhen`, deveria aplicar cor/aviso quando idade > 24h.

- **Resultado Esperado**
  > MTTD de "cron não rodou" cai de ∞ (só por relato) para < 24h (alerta automático). Operador vê o problema antes do usuário. `age(last_success_ingest) > 24h` deixa de ser um estado invisível.

- **Tactic alvo**: Monitor, Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-3
- **Métricas de sucesso**:
  - Canais de notificação do cron: 0 → ≥1
  - Componentes UI que sinalizam idade excessiva: 0 → 1
  - MTTD (estimado) de "cron não rodou": ∞ → < 24h
- **Risco de não fazer**: em 6 meses, próximo incidente silencioso de cron (blueprint editado errado, plano Render suspenso, dependência quebrada em `npm ci`) reproduz o mesmo sintoma da Simone. A correção do `pago` fica invisível porque a ingestão parou.
- **Dependências**: nenhuma

### [availability-2] Cron perdedor do lock deve sair sem sinalizar falha

- **Problema**
  > `src/backend/jobs/ingest-permutas.ts:31-38` trata qualquer erro do `main()` como falha e chama `process.exit(1)`. `IngestLockBusyError` é lançado quando o cron esbarra em outro trigger (analista clicou em "Ingerir" às 06:00) — o próprio erro documenta em `IngestLockBusyError.ts:14-22` que "It is NOT a failure: no data moved, nothing was written". No Render, a execução vira "failed" e polui o histórico. Assim que F-availability-1 for corrigido, cada corrida benigna vira alerta falso-positivo.

- **Melhoria Proposta**
  > No entrypoint do job (`ingest-permutas.ts:31-38`) aplicar **Sanity Checking do exit code**: `catch` que detecta `IngestLockBusyError` e sai com code 0 (com log `info` distinto de erro), enquanto qualquer outro erro segue com code 1. Espelha o padrão do route handler (`routes/permutas.ts` mapeia para HTTP 409 em vez de 500). Passo opcional: se der para configurar o alerta do Render para ignorar código específico, usar code 75 (`EX_TEMPFAIL` da BSD) — mas exit 0 já resolve o essencial.

- **Resultado Esperado**
  > Corrida benigna cron×analista não gera "failed execution" no Render nem alerta ruidoso. Falhas reais (Conexos indisponível, DB fora, bug) continuam com exit 1.

- **Tactic alvo**: Exception Handling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Falso-positivos por corrida cron×analista: 1 por corrida → 0
  - Distinção de exit code entre erro real e lock-busy: ausente → presente
- **Risco de não fazer**: alertas do card `availability-1` nascem ruidosos e são silenciados/ignorados — a plataforma de alerta perde utilidade antes mesmo do primeiro incidente real.
- **Dependências**: idealmente antes de `[availability-1]` para que o alerta nasça limpo; se `[availability-1]` for entregue primeiro, tratar como bloqueador de qualidade do alerta.

### [availability-3] Substituir `catch {}` silenciosos do fan-out com308 por `logService.warn` com métrica

- **Problema**
  > Três `catch {}` sem log em `src/backend/domain/service/permutas/EleicaoPermutasService.ts:563,622,858` — todos no fan-out do `listTitulosAPagar` do com308. A DEGRADAÇÃO é intencional (invoice segue visível com `pago=false` no piso conservador, exatamente como o comentário do delta explica), mas o SILÊNCIO não é: um surto de erros do com308 (Conexos MAX_SESSIONS, timeouts que esgotam o `RetryExecutor`) reproduz o sintoma original — invoices liquidadas na tela — sem nenhum sinal para o operador.

- **Melhoria Proposta**
  > Aplicar **Exception Detection** onde hoje se aplica só **Ignore Faulty Behavior**: substituir cada `catch {}` por `catch (error) { await this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'com308 indisponível para invoice — pago em piso conservador', data: { docCod, filCod, erro: msg } }) }`. O padrão já existe no mesmo arquivo (linhas 190, 303, 355, 429, 451, 699). Contador derivável no futuro via query `SELECT count(*) FROM log WHERE message LIKE 'com308 indisponível%' AND ts > now() - '1d'`.

- **Resultado Esperado**
  > Taxa de fallback do com308 observável em logs. Operador consegue diferenciar "10% de fallback normal" de "90% (com308 caiu)". Diagnóstico do sintoma "invoice liquidada aparece" cai de "olhar logs manuais do Conexos" para "consultar warn no log".

- **Tactic alvo**: Exception Detection
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - `catch {}` silenciosos em `EleicaoPermutasService.ts`: 3 → 0
  - Warns/dia observáveis quando com308 degrada: 0 → n
- **Risco de não fazer**: próxima causa de "invoice liquidada aparece" (indisponibilidade do com308) demora dias para ser diagnosticada — mesma dor da regressão que motivou este delta, em variante nova.
- **Dependências**: nenhuma

### [availability-4] Adotar `Self-Test` (smoke ao com308) no início do cron

- **Problema**
  > O job `ingest-permutas.ts` chama `service.executar()` direto. Se o com308 estiver indisponível na janela do cron (manutenção Conexos, credencial expirada), o job leva minutos varrendo ~1146 invoices/filial e chega ao mesmo estado: fallback conservador em massa, invoices liquidadas na tela, sem sinal claro. Falha rápida com sinal claro > falha lenta e ambígua.

- **Melhoria Proposta**
  > Adicionar **Self-Test** no entrypoint: chamar `listTitulosAPagar({ docCod: <invoice canônica>, filCod: <filial teste> })` **antes** de disparar o fan-out. Se falhar com retries esgotados, sair com exit code distinto (e log claro) sem tocar no modelo relacional. `docCod` canônico pode vir de env var (`INGEST_PERMUTAS_SMOKE_DOC`).

- **Resultado Esperado**
  > Cron que roda com com308 fora falha em segundos com log claro, em vez de gastar minutos e degradar dado em massa. MTTR de incidente Conexos cai por diagnóstico mais rápido.

- **Tactic alvo**: Self-Test
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-4
- **Métricas de sucesso**:
  - Duração de cron durante falha total do com308: minutos → segundos
  - Preflight explícito no cron: 0 → 1
- **Risco de não fazer**: em incidente Conexos, cron degrada o dado por 15+ min antes de falhar, e o `derivarPagoDosTitulos` conservador esconde o fato de o com308 estar down.
- **Dependências**: [availability-3] (o warn do fallback fica mais legível quando o preflight já indicou o problema)

### [availability-5] Kill-switch de env var para o cron de Permutas (Removal from Service)

- **Problema**
  > Não há env var `PERMUTAS_INGEST_ENABLED` que permita ao operador pausar o cron sem redeploy — contraste com `SISPAG_LIVE_WRITE_ENABLED` (`render.yaml:35`) e `RECEBIMENTOS_ENABLED` (`render.yaml:45`), ambos gerenciados no dashboard do Render. Em incidente Conexos, a única alavanca é editar o blueprint (que bloqueia por 24h+ e requer commit).

- **Melhoria Proposta**
  > Aplicar **Removal from Service**: env var `PERMUTAS_INGEST_ENABLED` (default `true`, `sync: false` no blueprint como as outras) lida no `ingest-permutas.ts` antes de bootstrapar o container. Quando `false`, log `info` "cron pausado por env" e exit 0. Dashboard do Render vira a fonte da verdade para pausa emergencial — mesma política dos outros kill-switches.

- **Resultado Esperado**
  > Operador desliga cron em incidente Conexos sem redeploy nem commit. Retomada é reversão do valor no dashboard, sem downtime.

- **Tactic alvo**: Removal from Service
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Tempo para pausar cron em incidente: minutos (edit blueprint + deploy) → segundos (toggle dashboard)
  - Kill-switches por serviço críticos: 2 (SISPAG_LIVE, RECEBIMENTOS) → 3 (+ PERMUTAS_INGEST)
- **Risco de não fazer**: em incidente Conexos concorrente com outras frentes, o operador não tem alavanca de contenção específica; degrada tudo ou nada.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao DELTA da branch `fix/invoice-pago-detalhe` (`git diff 617ca3b..48abd7b`). Não revisei o resto do sistema — tactics presentes em `SispagPainelService` / `IngestaoTransacoesService` foram apenas cruzadas para confirmar padrões (o padrão `logService.warn` do card availability-3 existe amplamente no mesmo arquivo).
- Baseline "1146/1146 INVOICEs com `pago` null" veio do próprio comentário do delta em `ConexosTitulosClient.ts:46-56` e da sonda `probe-invoice-pago.ts`. Não re-executei a sonda (custo: fan-out em PRD).
- MTTR/MTTD reais não medíveis no worktree — dependem de histórico Render/observabilidade que não existem neste tenant. Declarei em `## 2` conforme regra 4 do template.
- Cross-QA: F-availability-1/3/4 têm sobreposição forte com Observability e Testability (freshness endpoint = também testabilidade); o consolidator pode consolidar os cards se `qa-observability` levantar item equivalente.
- Nada apontado como P0: os itens do delta que poderiam ter sido P0 (bug do `pago` do wire, ausência de cron real) já foram corrigidos NO PRÓPRIO delta. A revisão captura o débito residual introduzido pelo novo cron e pelo fallback silencioso — todos P1/P2/P3 com baseline numérico.
