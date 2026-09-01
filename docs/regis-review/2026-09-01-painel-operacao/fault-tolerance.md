---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-01-painel-operacao
agent: qa-fault-tolerance
generated_at: 2026-09-01T00:00:00-03:00
scope: backend
score: 9
findings_count: 6
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Runner do GitHub Actions (cron `35 * * * *`) e navegador do analista, simultâneos | O processo `reconciliar-nde-sefaz` é morto entre `updateNumeroNde` e `setNdeAutorizado`; ou uma aba aberta chama `GET /painel/enriquecimento` no mesmo intervalo em que o cron roda | `RecebimentosPainelService.hidratarNdes` → tabelas `nota_debito_eletronica` e `solicitacao_numerario_execucao`; `job_execucao`; `alerta` | Produção, com Postgres saudável, ERP acessível e sessões Conexos disputadas | O ledger converge: número do SEFAZ e flag `nde_autorizado` ficam consistentes na próxima passagem, sem duplo-crédito nem linha "autorizada e sem número"; alerta correspondente ao incidente aparece exatamente uma vez por janela | 0 NDes com `nde_autorizado=true AND numero_nde IS NULL`; 0 alertas duplicados dentro da mesma janela de dedup; ≤1 run/hora dispensada por `concurrency`; recuperação total na run seguinte (idade ≤ `limiteMs + 1 rodada`) |

> Tradução do cenário: **este slice materializa a doutrina de recuperação por reprocessamento idempotente** — a ordem de escrita (número primeiro, flag depois) é o único mecanismo de contenção; não há transação envolvendo as duas tabelas nem lock aplicativo. O teste da tese está no cruzamento de duas coisas: (a) o cron e o browser tocam o MESMO `hidratarNdes`, e (b) o flag é monotônico (`false → true`, nunca de volta).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ordem de escrita (número antes de flag) preservada em `reconciliar` | 1/1 caminhos | 1/1 | ✅ | `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:632-660` |
| Guarda de idempotência em `hidratarNdes` | Presente (`if (autorizado && nde.ndeAutorizado !== true)`) | Presente | ✅ | `RecebimentosPainelService.ts:498` |
| Dedup de alerta no banco (não só na aplicação) | `UNIQUE ux_alerta_dedup` + `ON CONFLICT DO NOTHING RETURNING` — validado contra Postgres real (2 inserts idênticos → 1 linha, 2º devolve 0) | Trava do banco | ✅ | `migrations/0052_alerta.sql:38-40`; `AlertaRepository.ts:60-77`; nota do próprio autor em `painel-operacao-regis-followups.md` |
| I5 — sink que lança não derruba `NotificacaoService.emitir` | 1 `try/catch` por sink em `entregarSeguro`, retorna `SinkResultado.ok=false` | 100% | ✅ | `NotificacaoService.ts:49-64` |
| I5 — pipeline problemático NÃO aborta o loop do detector | `StalenessDetector.emitirIsolado` isola por incidente; falha vai para `console.error` e o laço segue | Presente | ✅ | `StalenessDetector.ts:66-77` (adicionado mid-review) |
| I5 — `ConfigDoctor.verificarNoBoot` NÃO impede o processo de subir | `emitirSeguro` engole, `diagnosticarConfiguracao` engole | Presente | ✅ | `ConfigDoctor.ts:130-137`; `appContainer.ts:56-68` |
| Job `reconciliar-nde-sefaz` distingue leitura PARCIAL do ERP no status | `status: cobertura ? 'partial' : 'success'` a partir de `filiaisOk/filiaisTentadas` propagados por `hidratarNdes` | Presente | ✅ | `reconciliar-nde-sefaz.ts:52-70` (adicionado mid-review); `RecebimentosPainelService.ts:466-527` |
| Vigia observa a si mesmo (`PIPELINE.OPERACAO_DETECTOR`) | Presente — `detect-staleness` faz `createRun/finishRun` em `job_execucao` e entra no próprio `exporSaude` | Presente | ✅ | `JobRun.ts:16-21`; `stalenessLimits.ts:78-84`; `JobRunReadModel.ts:64-93`; `jobs/detect-staleness.ts` |
| Reaper/detector de linha `job_execucao` presa em `status='running'` | Ausente — nenhum job varre `running AND started_at < now() - X`; `StalenessDetector.alertaDaUltimaRun` só reage a `error`/`partial` | Detecção de stuck-run baseada em `running AND idade > K*limiteMs` | ❌ | `grep -rn "running.*started_at\|stuck\|reaper.*job_execucao" src/backend` → 0 resultados |
| Concorrência entre execuções do cron | `concurrency: group: reconciliar-nde, cancel-in-progress: false` (GH Actions serializa) | 1 execução simultânea | ✅ | `.github/workflows/reconciliar-nde.yml:22-24` |
| Concorrência entre cron e browser tocando o mesmo `hidratarNdes` | Escritas idempotentes (setam sempre o mesmo valor vindo do ERP); flag monotônico; NENHUM lock aplicativo | Escritas convergentes | ✅ | Trace de código: `RecebimentosPainelService.ts:466-527` + `632-660`; escritas em tabelas distintas sem `withTransaction` |
| `alerta-workflow-falhou` cobre a run que MORREU antes de escrever linha de run | Presente (`if: failure()` + script exit 0) | Presente | ✅ | `.github/workflows/reconciliar-nde.yml:60-73`; `jobs/alerta-workflow-falhou.ts` |
| Meta-alerta quando o próprio `alerta-workflow-falhou` falha | Ausente — o script imprime no stderr e sai 0 | Sinal secundário (log agregado / segundo canal) | ⚠️ | `jobs/alerta-workflow-falhou.ts:57-63` |
| Silêncio deliberado em `NotificacaoService.registrarEntrega` sem log | Presente — `catch {}` puro, sem `logService.warn` | Log em `catch` (documentado como best-effort mas sem trilha) | ⚠️ | `NotificacaoService.ts:65-72` |
| `POST /operacao/alertas/:id/reconhecer` seguro contra double-click | SQL `WHERE reconhecido_em IS NULL` — segundo POST é no-op silencioso | Idempotente | ✅ | `routes/operacao.ts:52-64`; `AlertaRepository.ts:100-107` |
| Migrations rodam ANTES do `ConfigDoctor` no boot | Ordem correta em `bootstrapAppContainer` | Antes | ✅ | `appContainer.ts:78-99` |
| Retry de falha transitória de conexão no Postgres cobre `updateNumeroNde` / `setNdeAutorizado` | `RetryExecutor` no `PostgreeDatabaseClient` com 3 tentativas + backoff | ≥3 | ✅ | `PostgreeDatabaseClient.ts:36-45` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — não há componente redundante substituível neste slice (o slice é justamente a criação da observabilidade). | N/A | — |
| Replacement | Sink layer permite trocar `DbAlertSink` por `EmailAlertSink` "num flip de configuração". | ⚠️ parcial | `interface/operacao/AlertSink.ts:9-15`; `operacaoContainer.ts:15-19` |
| Predictive Model | `StalenessDetector` prevê "pipeline parou" comparando idade da última run com limite POR pipeline. | ✅ presente | `StalenessDetector.ts:96-113`; `stalenessLimits.ts:56-91` |
| Increase Competence Set | Detector lista TAMBÉM os pipelines `sem-trilha` (reaper) para não afirmar cobertura que não existe; o próprio detector agora se lista (self-observation via `OPERACAO_DETECTOR`). | ✅ presente | `stalenessLimits.ts:44-52, 78-84`; `JobRunReadModel.ts:64-93` |
| Sanity Checking | `ConfigDoctor` confronta manifesto com ambiente; Zod no boundary de `POST /alertas/:id/reconhecer`. | ✅ presente | `ConfigDoctor.ts:55-99`; `routes/operacao.ts:17` |
| Comparison | `JobRunReadModel.situacao` compara `idadeDesdeUltimoSucessoMs` vs `limiteStalenessMs`; `reconciliar` compara `numeroNde !== nde.numeroNde` para evitar UPDATE desnecessário; `reconciliar-nde-sefaz` compara `filiaisOk < filiaisTentadas` para decidir `partial`. | ✅ presente | `JobRunReadModel.ts:132-135`; `RecebimentosPainelService.ts:637`; `reconciliar-nde-sefaz.ts:52-53` |
| Timestamp | `janela_inicio` truncada ao minuto ancora dedup; `started_at`/`finished_at` em `job_execucao` sustentam a leitura de idade. | ✅ presente | `Alerta.ts:52-58`; `migrations/0053_job_execucao.sql:26-31` |
| Timeout | `lerFilialComPrazo` usa `Promise.race` com `PAINEL_NDE_HIDRATACAO_TIMEOUT_MS`; workflow tem `timeout-minutes: 20`. | ✅ presente | `RecebimentosPainelService.ts:576-600`; `.github/workflows/reconciliar-nde.yml:27` |
| Condition Monitoring | `GET /operacao` expõe saúde de todo pipeline sem depender do ERP (I4); o detector se observa. | ✅ presente | `routes/operacao.ts:32-45`; `JobRunReadModel.ts:64-93` |
| Self-Test | `ConfigDoctor.verificarNoBoot` roda no boot e é best-effort. | ✅ presente | `ConfigDoctor.ts:104-119`; `appContainer.ts:56-68` |
| Voting | N/A — não há redundância consultiva. | N/A | — |
| Redundancy | Três detectores cobrem gaps distintos: `StalenessDetector` (lê tabela de runs), `alerta-workflow-falhou` (cobre run que morreu antes de escrever linha), e o próprio `emitirIsolado` que impede um pipeline problemático de blindar os seguintes na mesma rodada. | ✅ presente | `jobs/alerta-workflow-falhou.ts:9-19`; `jobs/detect-staleness.ts`; `StalenessDetector.ts:66-77` |
| Recovery — Forward | Falhas em sink, em `updateNumeroNde` e no `emitir` de um pipeline específico seguem para a próxima rodada; a NDe permanece candidata; log `BUSINESS_WARN`. | ✅ presente | `RecebimentosPainelService.ts:640-657`; `NotificacaoService.ts:51-64`; `StalenessDetector.ts:66-77` |
| Recovery — Backward | Sem transação envolvendo as duas tabelas — a semântica é "reprocessa a mesma leitura", não "faz rollback". Escolha deliberada, documentada. | ⚠️ intencionalmente ausente | Docstring em `RecebimentosPainelService.ts:629-631` |
| Reintroduction (Shadow / State Resync / Escalating Restart) | Sem shadow, sem resync explícito. O painel serve como "resync de leitura" — computa staleness na LEITURA (I6). | ⚠️ parcial | `JobRunReadModel.ts:96-134` |
| Rollback | N/A no ledger da NDe — o commit point é o flag; escrever "para trás" não faria sentido (o SEFAZ é a fonte da verdade a jusante). | N/A | — |
| Repair State | A própria reconciliação REPARA linhas que ficaram sem número em passagens anteriores (cenário do crash entre updateNumeroNde e setNdeAutorizado). | ✅ presente | `RecebimentosPainelService.ts:632-660` |
| Idempotent Replay | Chave central do slice. `criarSeNovo` idempotente por `ux_alerta_dedup`; `reconciliar` idempotente por comparação + flag monotônico; ordem número→flag garante convergência após crash. | ✅ presente | `AlertaRepository.ts:67-73`; `RecebimentosPainelService.ts:498, 637` |
| Compensating Transaction | N/A — não há operação a compensar. A "compensação" para uma escrita fiscal já emitida no ERP não é modelada e nem seria correta aqui. | N/A | — |
| Reconcile | O próprio job É a tactic de Reconcile — puxa `vldAutorizado` do com297 e alinha o ledger local. | ✅ presente | `jobs/reconciliar-nde-sefaz.ts`; `RecebimentosPainelService.reconciliarNdesComSefaz` |
| Quarantine | N/A neste slice. Alertas `reconhecido_em IS NULL` funcionam como "fila quente", não como quarentena de dados. | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: Linha `job_execucao` presa em `status='running'` não tem varredura ativa

- **Severidade**: P1
- **Tactic violada**: Detect Faults — Condition Monitoring (ausência de detector de stuck-state); Recovery — Repair State (para a própria trilha)
- **Localização**: `src/backend/jobs/reconciliar-nde-sefaz.ts:29-77`; `src/backend/jobs/detect-staleness.ts:32-72`; `src/backend/domain/service/operacao/JobRunReadModel.ts:96-135`; `src/backend/domain/service/operacao/StalenessDetector.ts:116-142`; `src/backend/migrations/0053_job_execucao.sql:16-33`
- **Evidência (objetiva)**:
  ```ts
  // reconciliar-nde-sefaz.ts:29-77 (e mesma forma em detect-staleness.ts)
  const runId = await runRepo.createRun({ pipeline: PIPELINE_NOME, triggeredBy: ... });
  try {
      const r = await service.reconciliarNdesComSefaz();
      await runRepo.finishRun({ runId, status, metricas: {...} });
  } catch (error) {
      await runRepo.finishRun({ runId, status: 'error', errorMessage });
      throw error;
  }
  ```
  Se o processo for morto (SIGKILL do runner, OOM, `timeout-minutes: 20`, evaporação do runner) entre `createRun` e `finishRun`, a linha fica em `status='running'` **para sempre**. Não há job que varra `SELECT ... FROM job_execucao WHERE status='running' AND started_at < now() - interval 'X'`. No schema (`0053_job_execucao.sql`) também não há trigger/constraint que expire.
- **Cenário concreto**: run inicia às 12:35, `createRun` termina às 12:35:02, ERP fica lento, workflow bate `timeout-minutes: 20` às 12:55 → runner morre com SIGKILL antes do `finishRun`. `if: failure()` do workflow **normalmente** dispara `alerta-workflow-falhou` (mitigação parcial). Mas: (a) em `workflow_dispatch` manual sem o step de alerta configurado, nenhuma segunda sinalização acontece; (b) `StalenessDetector.alertaDaUltimaRun` só emite para `status='error'` ou `'partial'` — `'running'` cai fora do switch (linhas 120-141); (c) a única detecção residual é a de staleness (`ultimoSucesso` envelhecendo além de `limiteMs = 3h`), o que só aparece 3h depois do último SUCESSO, não 3h depois da run travada. A janela cega pode chegar a 6h no pior caso.
- **Impacto técnico**: a tela `/operacao` mostra `ultimaRun.status = 'running'` sem `finishedAt`. Como `runsRecentes[0]` é a stuck run, um humano lendo o painel ganha o sinal ("essa run nunca terminou"), mas nenhum alerta é EMITIDO — o canal do painel só lista `alertas` abertos, e essa run stuck não gera alerta. O time depende de olhar a tela na hora certa.
- **Impacto de negócio**: a divergência SEFAZ ↔ ledger volta a se acumular durante a janela cega — exatamente o problema que este slice existe para eliminar (F1 da ADR-0042). A auto-cura ainda ocorre na próxima run bem-sucedida (idempotente por design), mas a promessa de "≤ 1h de defasagem" para leitores diretos do Postgres cai para "até 4h" nesse cenário.
- **Métrica de baseline**: 0 varredura de `running`; 0 lugar em código onde `status = 'running' AND finished_at IS NULL AND started_at < ...` é consultado. Buscas: `grep -rn "running.*started_at\|reaper.*job_execucao\|status.*running.*interval" src/backend` → 0 resultados.

### F-fault-tolerance-2: `NotificacaoService.registrarEntrega` engole falha sem log

- **Severidade**: P2
- **Tactic violada**: Detect Faults — Sanity Checking (silêncio deliberado sem trilha); Recovery — Forward (a documentação promete que a falha "fica registrada"; a promessa não vale se o registro em si falha).
- **Localização**: `src/backend/domain/service/operacao/NotificacaoService.ts:65-72`
- **Evidência**:
  ```ts
  private registrarEntrega = async (id: number, resultados: SinkResultado[]): Promise<void> => {
      try {
          await this.alertaRepository.registrarEntrega(id, resultados);
      } catch {
          // silêncio deliberado: ver docstring.
      }
  };
  ```
  A docstring da classe diz: "vira `SinkResultado.ok=false` gravado no próprio alerta, para que 'o alerta não chegou' seja distinguível de 'não houve alerta'". Se a gravação DESSE registro falha e é silenciada sem log, essa distinção é perdida em silêncio — passa a caber `alerta_id X existe, sink_resultados=[], notificado_em=NULL` sem que ninguém saiba se o sink foi tentado ou não.
- **Cenário concreto**: Postgres momentaneamente indisponível entre o `criarSeNovo` (que caiu no retry do `RetryExecutor` e passou) e o `registrarEntrega` (retry se esgotou). Alerta persistido; sinks entregues; `sink_resultados=[]::jsonb`, `notificado_em=NULL`. Painel mostra alerta ativo, ninguém sabe se foi ou não notificado. O `entregarSeguro` ao menos loga o erro do sink (linha 55-63); aqui não há log nenhum.
- **Impacto técnico**: leitura de `sink_resultados` no futuro dá `[]`, o que também é o estado de "acabou de ser criado antes de o entregarATodos rodar". A distinção "não gravou" vs "ainda não gravou" é indistinguível.
- **Impacto de negócio**: observabilidade do canal de alerta perde o único sinal secundário que tinha.
- **Métrica de baseline**: 0 `logService.warn` ou `console.error` no `catch` do `registrarEntrega`.

### F-fault-tolerance-3: `alerta-workflow-falhou` sai 0 mesmo quando a emissão do alerta falha, sem canal secundário

- **Severidade**: P2
- **Tactic violada**: Detect Faults — Self-Test (o próprio alertador não tem monitoramento).
- **Localização**: `src/backend/jobs/alerta-workflow-falhou.ts:57-63`
- **Evidência**:
  ```ts
  main()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
          // Sai 0 DE PROPÓSITO: o workflow já está falhando, e o passo de alerta não pode
          // mascarar nem duplicar essa falha (I5 no nível do CI).
          console.error('[alerta-workflow-falhou] não foi possível emitir o alerta:', error);
          process.exit(0);
      });
  ```
  A escolha de sair 0 é defensável (não duplicar falha do CI). Mas o `console.error` vai só para os logs do GH Actions — e o step é `continue-on-error: true`, então o operador que abrir o run vê "sucesso" no summary. Se o Postgres estava fora quando o alerter tentou rodar, ninguém sabe que aquele workflow que já estava falhando também não conseguiu alertar.
- **Cenário concreto**: `reconciliar-nde-sefaz` falha às 12:35 (ERP fora). O step "Alertar falha" roda; o `bootstrapAppContainer` tenta `PostgreeDatabaseClient.init()` e falha (DB também caiu, ou credencial do secret do CI expirou). O script imprime erro no stderr e sai 0. O run do workflow aparece FAILED (por causa do step anterior), mas o painel `/operacao` **não** tem alerta — a única evidência é o log do runner. Sem outro canal (e-mail, healthcheck externo), o incidente é invisível para quem não abre o histórico do CI.
- **Impacto técnico**: o alertador de "workflow morreu antes de escrever linha de run" é single-point-of-failure para essa classe de falha.
- **Impacto de negócio**: caso raro, mas o efeito do caso raro é exatamente o cenário que o slice existe para eliminar. Follow-up P1 dos autores (dead-man's switch externo) fecha esse mesmo buraco.
- **Métrica de baseline**: 0 canal secundário de sinalização de "alerter falhou".

### F-fault-tolerance-4: Guarda de idempotência em `hidratarNdes` é checagem de snapshot, não lock — cron e browser fazem escrita dupla (não corrompem)

- **Severidade**: P3
- **Tactic violada**: N/A — é registro de trace, não defeito. Documentado porque o usuário pediu escrutínio direto do cruzamento cron × browser.
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:498, 632-660`
- **Evidência (rastreio de execução)**:
  ```ts
  // hidratarNdes:498
  if (autorizado && nde.ndeAutorizado !== true) {
      await this.reconciliar(nde, numeroNde);
      reconciliadas += 1;
  }
  ```
  A leitura `nde.ndeAutorizado` vem do snapshot obtido por `ndeRepo.listParaPainel(...)` no início do fluxo. Não há `SELECT ... FOR UPDATE` nem advisory lock. Duas leituras concorrentes (cron + browser) veem `false` e ambas passam pela guarda.
- **Rastreio de convergência (por que não corrompe)**:
  1. `updateNumeroNde` — Caller A escreve `numero_nde = 'X'` (vindo do ERP, determinístico). Caller B escreve `numero_nde = 'X'` (mesmo ERP, mesmo valor). Escritas idempotentes.
  2. `setNdeAutorizado(..., true)` — Caller A escreve `true`. Caller B escreve `true`. Flag é monotônico (`grep -rn "setNdeAutorizado.*false" src/backend` → 0 resultados; nunca volta a `false`).
  3. **Ordem preservada em cada caller**: `try { updateNumeroNde } catch { warn; return }` — se A falhou no número, A não escreve o flag; B ainda pode entrar depois e escrever ambos.
- **Cenário de crash validado por leitura de código**:
  - T0: A entra em `reconciliar`, `updateNumeroNde` OK (`numero_nde='180791'`).
  - T1: processo morre. Estado: `numero_nde='180791'`, `nde_autorizado=false`.
  - T2: próximo `hidratarNdes` carrega `nde.numeroNde='180791'`, `nde.ndeAutorizado=false`. Guarda passa.
  - T3: `reconciliar` — `numeroNde ('180791') === nde.numeroNde ('180791')` → **pula** o `updateNumeroNde` (linha 637); vai direto para `setNdeAutorizado(..., true)`. Converge.
- **Pequeno custo aceito**: em concorrência tela+cron, `updateNumeroNde` é chamado 2× por NDe. Postgres serializa por linha; escritas de mesmo valor. Sem impacto de correção.
- **Impacto técnico**: nenhum de correção; 2× tráfego de UPDATE em janela de corrida rara. Se o custo virasse problema, um advisory lock por `idempotencyKey` no `reconciliar` fecharia a corrida sem transação.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: N/A (é confirmação de que o desenho está correto).

### F-fault-tolerance-5: Sem transação envolvendo as duas escritas — escolha deliberada de recuperação por reprocessamento

- **Severidade**: P3
- **Tactic violada**: N/A — é registro do trade-off. Não há gap para fechar.
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:632-660`
- **Evidência**:
  ```ts
  // reconciliar (632-660): NÃO usa PostgreeDatabaseClient.withTransaction
  await this.ndeRepo.updateNumeroNde(idempotencyKey, numeroNde);        // tabela 1
  await this.execucaoRepo.setNdeAutorizado(idempotencyKey, true);       // tabela 2, sem transação
  ```
  `PostgreeDatabaseClient` expõe `withTransaction(fn)` (`PostgreeDatabaseClient.ts:9-19`), então a alternativa existia e foi rejeitada por desenho: o commit point é o flag, e a ordem número→flag mais o guard idempotente é o que garante recuperação. Uma transação de duas escritas em tabelas diferentes só teria valor se houvesse invariante que exigisse "ou os dois ou nenhum" — a ordem escolhida trata o "só o primeiro" como estado transitório recuperável.
- **Impacto técnico**: qualquer refator futuro que **inverter** a ordem (flag antes do número) quebra a recuperação — a linha sai do filtro de candidatas com número ausente. É um invariante frágil, protegido só por comentário e teste (`RecebimentosPainelService.test.ts:585-608`).
- **Impacto de negócio**: nenhum, enquanto a ordem for preservada.
- **Métrica de baseline**: 1 teste ancora o invariante (`test.ts:585-608` — "grava número antes do flag"). Aceitável.

### F-fault-tolerance-6: `reconciliar` percorre NDes em `for ... of` com `await` sequencial

- **Severidade**: P3
- **Tactic violada**: Detect Faults — Timeout (indireto: o total pode encostar no `timeout-minutes: 20` do workflow).
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:481-503`
- **Evidência**:
  ```ts
  for (const nde of ndes) {
      // ...
      if (autorizado && nde.ndeAutorizado !== true) {
          await this.reconciliar(nde, numeroNde);   // sequencial
          reconciliadas += 1;
      }
  }
  ```
  `PAINEL_NDES_CAP` é o teto de leitura, e cada `reconciliar` faz até 2 UPDATEs. Sequencial, cada UPDATE em Postgres saudável é ~10ms — para 500 NDes precisando reconciliação, isso é ~10s. Postgres travado eleva o total.
- **Cenário concreto**: primeira execução após um outage de várias horas — todas as NDes emitidas nesse intervalo precisam ser reconciliadas de uma vez. Sequencial. Somado ao tempo de leitura do ERP (`PAINEL_NDE_HIDRATACAO_BUDGET_MS`), pode encostar em `timeout-minutes: 20`. Se estourar, cai direto em F-fault-tolerance-1 (linha presa em `running`).
- **Impacto técnico**: acopla o tempo de recuperação ao tamanho do backlog linearmente.
- **Impacto de negócio**: menor — auto-cura na próxima run.
- **Métrica de baseline**: 0 uso de `Promise.all` no laço de reconciliação; hidratação de leitura JÁ usa fan-out (`FANOUT_LIMIT_RECEBIMENTOS`), mas a escrita não segue o mesmo padrão.

## 5. Cards Kanban

### [fault-tolerance-1] Detectar e sinalizar `job_execucao` presa em `running`

- **Problema**
  > Qualquer job que use `JobExecucaoRepository` (`reconciliar-nde-sefaz`, `detect-staleness` e futuros) pode morrer entre `createRun` e `finishRun` — SIGKILL do runner, `timeout-minutes: 20`, OOM, `workflow_dispatch` manual sem step de alerta. A linha fica `status='running'` sem `finished_at` indefinidamente. O painel apenas LISTA a run stuck; nenhum `alerta` é emitido (o `StalenessDetector.alertaDaUltimaRun` só reage a `error` e `partial`). A única detecção residual é staleness do último SUCESSO, o que aparece 3–6h depois no pior caso.

- **Melhoria Proposta**
  > Duas partes:
  > 1. Estender `JobRunReadModel.situacao` para reconhecer `running AND started_at < now() - K*limiteMs` como `PARADO` (ou `TRAVADO`, um novo estado — o rótulo importa menos que o alerta). O `StalenessDetector` já emite `job-parado` a partir dessa situação, então a via de alerta reaproveita.
  > 2. Estender `alertaDaUltimaRun` para emitir `job-parado` (não `job-falhou` — não sabemos se falhou) quando `run.status === 'running'` e `now() - started_at > 2 * limiteMs`. Justificativa do 2x: um pipeline que legitimamente demora até `limiteMs` de execução (raro, mas defensável) não deve virar alerta falso.
  > Tactic Bass: **Detect Faults — Condition Monitoring** (stuck-state reaper) + **Recovery — Repair State** para a própria trilha (opcional: um `UPDATE job_execucao SET status='error', error_message='stuck-run-reaped' WHERE ...`, mas isso é reescrita de linha existente — pode ficar de fora e deixar a trilha honesta).

- **Resultado Esperado**
  > Uma run travada gera alerta `job-parado` dentro de `2 * limiteMs` (para o SEFAZ: 6h no pior caso, hoje; alvo: ≤ 6h a partir de `started_at` da run travada, e não a partir do último sucesso), com a mesma dedup por janela que os outros. O painel deixa de depender de o operador estar olhando na hora certa.

- **Tactic alvo**: Detect Faults — Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Latência de detecção de run travada: hoje = idade do último SUCESSO até superar `limiteMs` (worst-case 6h desde o último sucesso, que pode ter sido bem antes do start da run travada) → alvo ≤ `2 * limiteMs` a partir de `started_at` da própria stuck run
  - Cobertura de alertas por status: hoje `{success, partial, error}` → alvo `{success, partial, error, running-travada}`
- **Risco de não fazer**: repetição do próprio defeito que motivou este slice — dias-corridos de defasagem invisível na reconciliação SEFAZ ↔ ledger, num pipeline cuja razão de existir era fechar essa janela.
- **Dependências**: nenhuma — reaproveita infra existente (`StalenessDetector`, `NotificacaoService`, `AlertaRepository`).

### [fault-tolerance-2] Logar a falha de `NotificacaoService.registrarEntrega` mesmo que best-effort

- **Problema**
  > O `catch {}` puro em `registrarEntrega` derruba a última trilha para distinguir "sink não gravou o desfecho" de "sink ainda não gravou". O `entregarSeguro` (mesma classe, linhas acima) já loga a falha de um sink individual; ser assimétrico entre esses dois catchs é inconsistente com a própria docstring da classe, que promete distinção observável.

- **Melhoria Proposta**
  > No `catch` de `registrarEntrega`, chamar `logService.warn({...})` com o `alertaId`, `resultados` (só os campos `sink` e `ok`, não o `erro` que já foi logado por sink) e `cause`. Se preferir minimizar dependência de `logService` aqui, um `console.warn` também resolve — é o registro que importa, não o canal.
  > Tactic Bass: **Recovery — Forward** (o registro do desfecho é a última tactic de forward-recovery para o próprio sistema de alerta).

- **Resultado Esperado**
  > A falha em `registrarEntrega` deixa trilha, e a promessa da docstring "distinguível de 'não houve alerta'" volta a valer.

- **Tactic alvo**: Detect Faults — Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Cobertura de log em `catch` do módulo `NotificacaoService`: hoje 1/2 catches loga → alvo 2/2
- **Risco de não fazer**: incidente onde `sink_resultados=[]` fica indistinguível entre "não tentado ainda" e "tentado e engolido" — degrada exatamente a diagnóstica que este slice construiu.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Fanout paralelo de `reconciliar` em `hidratarNdes`

- **Problema**
  > Após um outage de horas, todas as NDes emitidas nesse intervalo caem no laço `for (const nde of ndes)` com `await` sequencial. Cada `reconciliar` faz até 2 UPDATEs. Sequencial encosta em `timeout-minutes: 20` do workflow para backlogs grandes — e um estouro cai direto em F-fault-tolerance-1.

- **Melhoria Proposta**
  > Trocar o laço sequencial por fanout limitado, coerente com `FANOUT_LIMIT_RECEBIMENTOS` que a leitura já usa. Um `chunk(reconciliáveis, FANOUT_LIMIT_RECEBIMENTOS).forEach(chunk => Promise.all(chunk.map(reconciliar)))` mantém o teto de concorrência que respeita o pool de 5 conexões (`PostgreeDatabaseClient.poolMaxConnections`).
  > Tactic Bass: nenhuma nova — mitiga acoplamento com o Timeout do workflow.

- **Resultado Esperado**
  > Tempo de reconciliação de N NDes deixa de ser linear em N e passa a ser `ceil(N/FANOUT) * writeTime`. Backlog de 500 NDes cai de ~10s para ~1s no caminho feliz.

- **Tactic alvo**: Detect Faults — Timeout (mitigação)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Latência de reconciliação de backlog de 500 NDes (medida local): baseline ≈ N * writeTime (sequencial) → alvo ceil(N/FANOUT) * writeTime
- **Risco de não fazer**: em pós-outage grande, aumenta a probabilidade de estourar `timeout-minutes: 20` e cair em F-fault-tolerance-1.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Canal secundário para "o alertador falhou" (dead-man's switch externo)

- **Problema**
  > `alerta-workflow-falhou` sai 0 em qualquer erro (correto para não duplicar falha do CI). O único registro é `console.error` no runner do GH Actions, e o step é `continue-on-error: true`. Se o Postgres estiver fora exatamente quando o alerter tentar rodar, o incidente é invisível para quem não abre o histórico do CI. Este ponto cego coincide com o P1 dos autores em `painel-operacao-regis-followups.md` (dead-man's switch externo fecha esse E o "GH Actions parou de disparar" com a mesma implementação).

- **Melhoria Proposta**
  > Expor `GET /health/pipelines` (read-only, sem auth ou com token) devolvendo `{ pipeline: { ultimoSucessoEm, situacao } }` para todos os pipelines conhecidos. Apontar um pinger externo (healthchecks.io, cronitor, Better Uptime) para ele com uma expectativa de intervalo, configurado para alertar tanto no **não-200** quanto na **ausência do próprio ping**. Isso cobre: (a) `alerta-workflow-falhou` que não conseguiu emitir; (b) GH Actions que parou de disparar; (c) backend caído (o pinger não recebe 200).
  > Tactic Bass: **Redundancy** + **Detect Faults — Condition Monitoring** externo.

- **Resultado Esperado**
  > O sistema deixa de ter um single-point-of-failure na sua própria observabilidade. Um incidente do próprio alerter aparece em um canal fora do sistema, com latência ≤ 1 intervalo do pinger.

- **Tactic alvo**: Detect Faults — Condition Monitoring (externo)
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Canais de alerting independentes: hoje 1 (`DbAlertSink`) → alvo ≥ 2 (`DbAlertSink` + pinger externo)
  - Cobertura do cenário "alerter falhou": hoje 0 → alvo 1 canal detecta
- **Risco de não fazer**: mantém o P1 já registrado nos follow-ups dos autores; qualquer incidente do próprio subsistema de alerta permanece silencioso.
- **Dependências**: escolha do pinger; endpoint `/health/pipelines` que reaproveite `JobRunReadModel.exporSaude` sem tocar credenciais do ERP (I4 preservado).

## 6. Notas do agente

- **Fechamentos mid-review**: durante este review o autor materializou três correções que teriam virado achados P2:
  (a) `reconciliar-nde-sefaz` passou a distinguir leitura parcial do ERP via `filiaisOk/filiaisTentadas` propagados por `hidratarNdes` e a gravar `status='partial'` quando `cobertura = filiaisOk < filiaisTentadas` (`reconciliar-nde-sefaz.ts:52-70`);
  (b) `StalenessDetector.emitirIsolado` isola falha de emissão POR pipeline — antes, um único `emitir` que jogasse (pool de DB exausto, violação de CHECK) abortaria o laço inteiro e blindaria as pipelines seguintes na mesma rodada (`StalenessDetector.ts:66-77`);
  (c) o próprio detector agora se observa: `PIPELINE.OPERACAO_DETECTOR` entra em `job_execucao` e no `exporSaude`, resolvendo a ambiguidade "alertas: [] = tudo bem?" ou "o vigia morreu?" (`JobRun.ts:16-21`, `stalenessLimits.ts:78-84`, `JobRunReadModel.ts:64-93`, `jobs/detect-staleness.ts:32-72`).
- **Cruzamentos cross-QA**: F-fault-tolerance-1 é também débito de **Testability** (não há teste que exercite a stuck-run) e de **Availability** (é a mesma janela cega que o dead-man's switch dos autores endereça). F-fault-tolerance-3 (dead-man's switch) é reforço técnico do P1 já registrado em `painel-operacao-regis-followups.md` §1 — não é achado novo. O invariante "todo state change tem trilha de audit" (item 15 da inspection plan) é atendido pela própria tabela `alerta` para a frota de operação: a lista de state changes desse subsistema É a tabela.
- **O que NÃO virou finding**: a ordem número→flag em `reconciliar` (verificada por trace: repare em `RecebimentosPainelService.ts:637-651`, o `catch` no `updateNumeroNde` faz `return` antes do `setNdeAutorizado`, então o invariante "flag é commit point" vale); a dedup em `AlertaRepository.criarSeNovo` (validada contra Postgres real segundo o próprio autor, e o schema `UNIQUE ux_alerta_dedup` + `ON CONFLICT DO NOTHING RETURNING` é o mecanismo canônico); I5 do `NotificacaoService` (isolamento por `try/catch` em `entregarSeguro`, verificado); `ConfigDoctor.verificarNoBoot` best-effort (duplo `try/catch` — dentro do `emitirSeguro` e dentro do `diagnosticarConfiguracao`, verificado).
- **Concorrência cron + browser**: analisada e descartada como corrupção — as escritas são idempotentes (mesmo valor do ERP, flag monotônico), a ordem número→flag garante recuperação a partir de qualquer ponto intermediário. Custo aceito: 2× UPDATEs por NDe em janela de corrida. F-fault-tolerance-4 documenta o rastreio.
