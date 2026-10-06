---
qa: Availability
qa_slug: availability
run_id: 2026-10-06-1356
agent: qa-availability
generated_at: 2026-10-06T14:10:00Z
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

Escopo: DELTA da feature `sispag-verificacoes-ted-pix` (`--quick`, sem `infra/`). Itens de infra (DLQ, alarmes, dashboards, `shared_account_id`) não se aplicam: o runtime atual é Express/Render + GitHub Actions.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP (`fin064`, `cmn025`) / sessão Conexos expirada ou lenta | Leitura ao vivo falha ou trava durante `finalizarLote` e durante o cron semanal `calcular-perfil-canal` | `VerificacaoTedPixService`, `LotePagamentoService.finalizarLote`, `PerfilCanalService`, `RemessaService` | Operação normal, horário comercial (analista finalizando) e domingo 06:17 UTC (job) | Falha de leitura vira item `PENDENTE` (nunca "sem duplicata"); finalização é barrada com `PaymentCheckPendingError`; job não grava perfil parcial e sai com exit ≠ 0; remessa exige 2ª pessoa (L12/L13) | 0 remessas enviadas com duplicidade não verificada; 0 perfis parciais gravados; analista retoma sem retrabalho após a fonte voltar |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas Conexos novas do delta via `runWithRetry` (RetryExecutor) | 100% das leituras em `ConexosSispagClient` e `ConexosPagamentosRealizadosClient` (10 call sites) | ≥80% | ✅ | `grep runWithRetry domain/client/ConexosSispagClient.ts domain/client/ConexosPagamentosRealizadosClient.ts` |
| Timeout explícito no cliente HTTP do Conexos (base) | 0 ocorrências de `timeout`/`AbortSignal` em `ConexosBaseClient.ts`; só `BcbClient` (10s) e `SupabaseAuthClient` têm | 100% dos clientes externos | ❌ | `grep -rn "timeout\|AbortSignal" src/backend/domain/client/*.ts` |
| Falha de leitura tratada como "pendente" (fail-closed) | Sim: `lerFilial` devolve `{ok:false}` → `pendente()`; `PaymentCheckPendingError` barra o gate | presente | ✅ | `VerificacaoTedPixService.ts:197-221,238` |
| Job semanal não grava em rodada parcial | Sim (documentado no workflow, `falhou()` coleta falhas, exit ≠ 0) | presente | ✅ | `.github/workflows/calcular-perfil-canal.yml:1-12`; `PerfilCanalService.ts:130-200` |
| Guarda de transição de estado (conferência) | `conferir` só em FINALIZADO; `UPDATE ... WHERE conferido_por IS NULL` + `versao`; remessa exige `conferidoPor` | presente | ✅ | `ConferenciaLoteService.ts:35-51`; `LotePagamentoRepository.ts:756-759`; `RemessaService.ts:256` |
| Idempotência de alerta/bloqueio/pendência | Índices únicos parciais + `ON CONFLICT DO NOTHING` | presente | ✅ | `0076:83`, `0077:52,75,94`; `BloqueioDuplicidadeRepository.ts:116` |
| Atomicidade da verificação por item | `withTransaction` agrupa pendência + alertas + marca de estado | presente | ✅ | `VerificacaoTedPixService.ts:~262-285` |
| Catches silenciosos no delta | 2 (best-effort com comentário): `CalcularPerfilCanalJob.ts:48`, `IngestaoPagamentosService.ts:288`; ambos sucedidos por log/staleness | 0 sem justificativa | ⚠️ | grep `catch {` nos arquivos do delta |
| Gates (typecheck/test backend) | typecheck exit 0; 223 suites / 4006 testes verdes; test:sql 101 verdes | verde | ✅ | `_shared-metrics.md` |
| Tamanho da janela de leitura síncrona no `finalizarLote` | ⚠️ Não medível localmente: latência real do `fin064` por filial e nº de filiais por lote. Requer logs de produção (Render). Recomendação: emitir duração da verificação em `LogService` e dashboardar p95. | p95 < 10s | ⚠️ | n/a |
| MTTR / tempo `candidato → conciliado` | ⚠️ **Não medível localmente**: MTTR real. Requer logs de produção. Recomendação: instrumentar duração das transições do lote SISPAG. | definir | ⚠️ | n/a |
| DLQ, alarmes CloudWatch, `shared_account_id` | ⚠️ Não medível (sem `infra/`) | — | ⚠️ | CLAUDE.md "Layout" |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum health-check ativo de Conexos/Nexxera no delta | ❌ ausente | n/a |
| Heartbeat | Job semanal registra `job_run` e staleness (`stalenessLimits.ts`, `JobRunReadModel`) detecta run morta/ausente | ⚠️ parcial | `domain/interface/operacao/stalenessLimits.ts` (delta) |
| Monitor | Logs estruturados + staleness do perfil; sem alarme/dashboard (não há infra) | ⚠️ parcial | `CalcularPerfilCanalJob.ts:36-60` |
| Timestamp | `conferido_em`, `devolvido_em`, eventos de verificação (`VerificacaoEventoRepository`) | ✅ presente | `LotePagamentoRepository.ts:756` |
| Sanity Checking | Conferência por 2ª pessoa (`SelfConferenceError`), guarda FINALIZADO, titularidade do destino | ✅ presente | `ConferenciaLoteService.ts:35`; `ConferenciaLoteRule.ts` |
| Condition Monitoring | Perfil sem produção ⇒ exit ≠ 0; "zero é leitura vazia" | ✅ presente | workflow header |
| Voting | Não aplicável a este fluxo (sem réplicas computando o mesmo resultado) | N/A | — |
| Exception Detection | Erros tipados (`DuplicateHoldError`, `PaymentCheckPendingError`, etc.); leitura falha ⇒ pendente | ✅ presente | `domain/errors/*` |
| Self-Test | `validate-sispag-verificacoes-ted-pix-v1.ts` (script de validação manual) | ⚠️ parcial | `jobs/validate-sispag-verificacoes-ted-pix-v1.ts` |
| Active Redundancy | N/A: Conexos é fonte única e externa, sem réplica | N/A | — |
| Passive Redundancy | N/A: idem | N/A | — |
| Spare | N/A: sem infra própria | N/A | — |
| Exception Handling | Catch por filial/conta/borderô acumula `falhas`; erros de domínio mapeados na rota | ✅ presente | `PerfilCanalService.ts:144,175,195` |
| Rollback | Transações Postgres por item; `devolverLote` limpa conferência (`conferido_por = NULL`) ao voltar a RASCUNHO | ✅ presente | `LotePagamentoRepository.ts:641,789` |
| Software Upgrade | Migrations 0076-0079 aditivas com `IF NOT EXISTS`; flags por modalidade (TED/PIX/exceção) permitem ligar/desligar | ✅ presente | `RemessaService.ts:258-266` |
| Retry | `RetryExecutor` via `runWithRetry` nas leituras; escritas irreversíveis em tentativa única (correto) | ✅ presente | `ConexosBaseClient.ts:221` |
| Ignore Faulty Behavior | Itens com leitura falha ficam fora do envio (pendente) em vez de passarem | ✅ presente | `VerificacaoTedPixService.ts:238` |
| Degradation | Item sem dado de pagamento vai à fila de pendências de cadastro; lote não é perdido | ✅ presente | `PendenciaCadastroService`, `retirarSemDado` |
| Reconfiguration | Kill-switch `sispagLiveWriteEnabled` + flags; sem reconfiguração automática | ⚠️ parcial | `RemessaService.ts:267-272` |
| Shadow | Dry-run da remessa (`dryRun`) como modo sombra | ⚠️ parcial | `RemessaService.ts:468` |
| State Resynchronization | Re-verificação a cada finalização; retomada de remessa em `reconciling` | ✅ presente | `RemessaService.ts:310,373` |
| Escalating Restart | N/A: sem processos de longa duração no delta (job one-shot em Actions) | N/A | — |
| Non-Stop Forwarding | N/A: sem plano de dados separado | N/A | — |
| Removal from Service | Alerta/bloqueio de duplicidade retira título do lote (`titulo_bloqueio_duplicidade`) | ✅ presente | `BloqueioDuplicidadeRepository.ts` |
| Transactions | `withTransaction` + optimistic lock `versao` + índices únicos | ✅ presente | `LotePagamentoService.ts:113,160` |
| Predictive Model | Perfil de canal é preditivo de negócio, não de falha | N/A | — |
| Exception Prevention | Zod nos boundaries do cliente; guardas de estado antes de agir | ✅ presente | `ConexosPagamentosRealizadosClient.ts:18-24` |
| Increase Competence Set | Leitura vazia/incompleta classificada como pendente (cobre casos que antes seriam "sem duplicata") | ✅ presente | `VerificacaoTedPixService.ts:230-236` |

## 4. Findings (achados)

### F-availability-1: Cliente Conexos sem timeout explícito, agora no caminho síncrono do `finalizarLote`

- **Severidade**: P1
- **Tactic violada**: Exception Detection / Timestamp (detecção de hang) e Degradation
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts` (sem `timeout`); chamadas novas em `VerificacaoTedPixService.ts:197-221` e `LotePagamentoService.ts:416-426`
- **Evidência (objetiva)**:
  ```
  grep -rn "timeout|AbortSignal" src/backend/domain/client/*.ts (sem testes)
  -> BcbClient.ts:57 (10_000), SupabaseAuthClient.ts:339; nenhuma ocorrência em ConexosBaseClient.ts
  ```
- **Impacto técnico**: o delta adiciona uma leitura ao vivo `fin064` por filial dentro da requisição HTTP de finalização. Um Conexos lento prende a requisição e a sessão do analista sem limite próprio (depende do timeout do Render/browser) e ocupa a sessão Conexos compartilhada.
- **Impacto de negócio**: analista não finaliza o lote no horário de corte do pagamento; não há erro claro, só espera.
- **Métrica de baseline**: 0 de 1 cliente Conexos com timeout explícito (0%); alvo 100%. Latência real não medível localmente.

### F-availability-2: Leitura do fin064 serial por filial dentro de uma requisição, sem orçamento total de tempo

- **Severidade**: P2
- **Tactic violada**: Degradation
- **Localização**: `VerificacaoTedPixService.ts:197-221` (cache por filial), `jobs`/rota `routes/sispag.ts`
- **Evidência (objetiva)**:
  ```
  leituras.get(filCod) ... await this.sispag.listTitulosParaDuplicidade(filCod, config.duplicidadeDesde)
  ```
- **Impacto técnico**: o custo cresce com o nº de filiais do lote e o tamanho da janela `duplicidadeDesde`; não há deadline global por verificação.
- **Impacto de negócio**: finalização lenta em lotes multi-filial; em falha parcial, itens ficam PENDENTES e exigem nova tentativa manual (comportamento seguro, porém com atrito).
- **Métrica de baseline**: ⚠️ não medível localmente (nº filiais/lote, latência fin064).

### F-availability-3: Sem alarme ativo para falha do job semanal `calcular-perfil-canal`

- **Severidade**: P2
- **Tactic violada**: Monitor / Heartbeat
- **Localização**: `.github/workflows/calcular-perfil-canal.yml`; `stalenessLimits.ts`
- **Evidência (objetiva)**: o workflow depende de exit ≠ 0 e staleness; sem notificação externa documentada além do status do Actions. Já houve precedente: ingestão fechou "success" com 0 títulos em 23/09 (citado no próprio workflow).
- **Impacto técnico**: perfil desatualizado degrada silenciosamente o alerta de "canal habitual" (não barra pagamento).
- **Impacto de negócio**: alerta de canal habitual perde precisão; risco baixo porque não barra nem libera pagamento.
- **Métrica de baseline**: cadência semanal; staleness é o único detector (1 mecanismo).

### F-availability-4: Catches best-effort silenciosos no fechamento de run

- **Severidade**: P3
- **Tactic violada**: Exception Detection
- **Localização**: `CalcularPerfilCanalJob.ts:48`, `IngestaoPagamentosService.ts:288`
- **Evidência (objetiva)**: `} catch { // best-effort ... }` sem log nos dois pontos
- **Impacto técnico**: falha ao fechar a run some; compensada por staleness.
- **Impacto de negócio**: diagnóstico mais lento.
- **Métrica de baseline**: 2 catches sem log no delta.

## 5. Cards Kanban

### [availability-1] Definir timeout e deadline nas leituras Conexos do caminho síncrono

- **Problema**
  > `ConexosBaseClient` não define timeout (0 de 1 cliente Conexos), e `finalizarLote` agora faz leituras ao vivo do `fin064` na requisição do analista. Um Conexos lento pende a finalização sem erro claro.

- **Melhoria Proposta**
  > Aplicar `AbortSignal.timeout` (ex.: 15-20s) em `ConexosBaseClient` para leituras (escritas irreversíveis seguem em tentativa única) e um deadline total para `VerificacaoTedPixService`; ao estourar, marcar o item PENDENTE (já é o comportamento fail-closed). Tactic: Exception Detection + Degradation.

- **Resultado Esperado**
  > Finalização responde em tempo limitado com itens PENDENTES e mensagem clara. Clientes Conexos com timeout: 0% → 100%.

- **Tactic alvo**: Exception Detection / Degradation
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - Clientes Conexos com timeout explícito: 0% → 100%
  - p95 da verificação em `finalizarLote`: sem medida → medido e < 10s
- **Risco de não fazer**: em dia de corte de pagamento, um Conexos degradado trava a finalização sem diagnóstico e ocupa a sessão compartilhada.
- **Dependências**: nenhuma (checar impacto do timeout em leituras paginadas longas de outros jobs).

### [availability-2] Instrumentar duração da verificação e alertar falha do job de perfil

- **Problema**
  > Não há métrica de duração da verificação TED/PIX nem notificação ativa de falha do cron semanal; só staleness e status do Actions.

- **Melhoria Proposta**
  > Logar duração por filial e total em `LogService` (campo estruturado) e adicionar passo `if: failure()` de notificação no workflow `calcular-perfil-canal.yml`. Tactic: Monitor.

- **Resultado Esperado**
  > MTTR e p95 passam a ser medíveis; falha do job notifica em minutos, não na próxima leitura de staleness.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2, F-availability-3
- **Métricas de sucesso**:
  - Métricas de duração disponíveis: 0 → 2 (por filial, total)
  - Detectores de falha do job: 1 (staleness) → 2 (staleness + notificação)
- **Risco de não fazer**: perfil defasado e lentidão passam despercebidos até reclamação do analista.
- **Dependências**: availability-1 (para o p95 fazer sentido com timeout)

### [availability-3] Logar falhas ao fechar run em vez de engolir

- **Problema**
  > Dois `catch` best-effort no fechamento de run descartam o erro sem log.

- **Melhoria Proposta**
  > Trocar por `logService.warn` com `runId` e erro redigido, mantendo o não-regresso do status. Tactic: Exception Detection.

- **Resultado Esperado**
  > Catches sem log no delta: 2 → 0.

- **Tactic alvo**: Exception Detection
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Catches silenciosos no delta: 2 → 0
- **Risco de não fazer**: diagnóstico lento de runs presas.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; modo `--quick` (nenhum teste rodado, usei `_shared-metrics.md`). Nada executado contra Conexos.
- Ponto forte do delta: tudo fail-closed (leitura falha ⇒ PENDENTE, nunca "sem duplicata"), conferência e remessa com guardas de estado e locks otimistas, índices únicos para idempotência. Nenhum P0 identificado.
- Cross-QA: timeout/deadline também é Performance; ausência de alarmes toca Deployability/Observabilidade.
